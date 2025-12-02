/**
 * OpenAI Embedding Provider
 * 
 * Wraps existing OpenAI API embedding generation logic
 * Requirements: 10.4
 */

import OpenAI, { APIError, APIConnectionError, RateLimitError } from 'openai';
import type { EmbeddingProvider } from './types.js';

/**
 * OpenAI embedding provider implementation
 * Uses OpenAI's text-embedding-3-small model by default
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;
  private dimensions: number;

  constructor(apiKey: string, model: string = 'text-embedding-3-small', dimensions: number = 1536) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.dimensions = dimensions;
  }

  /**
   * Generate embedding using OpenAI API
   * Implements exponential backoff retry for rate limit errors
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    const maxRetries = 5;
    const baseDelay = 1000; // 1 second
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: text,
          encoding_format: 'float',
        });

        if (!response.data || response.data.length === 0) {
          throw new Error('No embedding data returned from OpenAI API');
        }

        const firstEmbedding = response.data[0];
        if (!firstEmbedding) {
          throw new Error('Invalid embedding data structure from OpenAI API');
        }

        const embedding = firstEmbedding.embedding;

        // Validate dimensions
        if (embedding.length !== this.dimensions) {
          throw new Error(
            `Unexpected embedding dimensions: expected ${this.dimensions}, got ${embedding.length}`
          );
        }

        return embedding;
      } catch (error) {
        // Determine if error is retryable
        const isRetryableError =
          error instanceof RateLimitError ||
          error instanceof APIConnectionError ||
          (error instanceof APIError &&
            (error.status === 429 || (error.status !== undefined && error.status >= 500)));

        if (!isRetryableError) {
          // Non-retryable error, throw immediately
          if (error instanceof APIError) {
            throw new Error(
              `OpenAI API error: ${error.message} (status: ${error.status}, code: ${error.code})`
            );
          }
          throw error;
        }

        lastError = error as Error;

        // If this was the last retry, break
        if (attempt === maxRetries - 1) {
          break;
        }

        // Calculate exponential backoff with jitter
        const exponentialDelay = baseDelay * Math.pow(2, attempt);
        const jitter = Math.random() * 200 - 100; // -100ms to +100ms
        const delayMs = Math.max(0, exponentialDelay + jitter);

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // All retries failed
    throw new Error(
      `OpenAI API rate limit exceeded after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Check if OpenAI API is available
   * Performs a simple API call to verify connectivity
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Try to generate a simple embedding to test availability
      await this.generateEmbedding('test');
      return true;
    } catch (error) {
      console.warn('OpenAI embedding provider is not available:', error);
      return false;
    }
  }
}
