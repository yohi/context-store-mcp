/**
 * Custom API Embedding Provider
 * 
 * Sends HTTP requests to a custom API endpoint for embedding generation
 * Requirements: 10.3
 */

import type { EmbeddingProvider } from './types.js';

/**
 * Custom API embedding provider implementation
 * Sends POST requests to a custom API endpoint
 */
export class CustomAPIEmbeddingProvider implements EmbeddingProvider {
  private endpoint: string;
  private dimensions: number;
  private timeout: number;

  constructor(endpoint: string, dimensions: number = 1536, timeout: number = 30000) {
    if (!endpoint || endpoint.trim().length === 0) {
      throw new Error('API endpoint cannot be empty');
    }
    
    // Validate URL format
    try {
      new URL(endpoint);
    } catch (error) {
      throw new Error(`Invalid API endpoint URL: ${endpoint}`);
    }
    
    this.endpoint = endpoint;
    this.dimensions = dimensions;
    this.timeout = timeout;
  }

  /**
   * Generate embedding by calling custom API
   * Expected API request format: POST with JSON body {"text": "..."}
   * Expected API response format: JSON with "embedding" field containing number array
   * Example: {"embedding": [0.1, 0.2, ...]}
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        // Send POST request to custom API
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Check response status
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `API request failed with status ${response.status}: ${errorText.substring(0, 200)}`
          );
        }

        // Parse JSON response
        let result: unknown;
        try {
          result = await response.json();
        } catch (parseError) {
          throw new Error(
            `Failed to parse API response as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
          );
        }

        // Extract embedding array from result
        const embedding = this.extractEmbedding(result);

        // Validate dimensions
        if (embedding.length !== this.dimensions) {
          throw new Error(
            `Unexpected embedding dimensions: expected ${this.dimensions}, got ${embedding.length}`
          );
        }

        // Validate all values are finite numbers
        for (let i = 0; i < embedding.length; i++) {
          if (!Number.isFinite(embedding[i])) {
            throw new Error(`Invalid embedding value at index ${i}: ${embedding[i]}`);
          }
        }

        return embedding;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`API request timed out after ${this.timeout}ms`);
        }
        throw new Error(`Custom API embedding generation failed: ${error.message}`);
      }
      throw new Error(`Custom API embedding generation failed: ${String(error)}`);
    }
  }

  /**
   * Extract embedding array from API response
   * Supports multiple JSON formats:
   * - {"embedding": [numbers]}
   * - {"embeddings": [[numbers]]}
   * - {"data": [{"embedding": [numbers]}]}
   * - [numbers] (direct array)
   */
  private extractEmbedding(result: unknown): number[] {
    // Direct array format
    if (Array.isArray(result)) {
      return this.validateNumberArray(result);
    }

    // Object format
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>;

      // Format: {"embedding": [numbers]}
      if ('embedding' in obj && Array.isArray(obj['embedding'])) {
        return this.validateNumberArray(obj['embedding']);
      }

      // Format: {"embeddings": [[numbers]]} - take first embedding
      if ('embeddings' in obj && Array.isArray(obj['embeddings'])) {
        const embeddings = obj['embeddings'] as unknown[];
        if (embeddings.length > 0 && Array.isArray(embeddings[0])) {
          return this.validateNumberArray(embeddings[0] as unknown[]);
        }
      }

      // Format: {"data": [{"embedding": [numbers]}]} - OpenAI-like format
      if ('data' in obj && Array.isArray(obj['data'])) {
        const data = obj['data'] as unknown[];
        if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
          const firstItem = data[0] as Record<string, unknown>;
          if ('embedding' in firstItem && Array.isArray(firstItem['embedding'])) {
            return this.validateNumberArray(firstItem['embedding']);
          }
        }
      }
    }

    throw new Error(
      'API response does not match expected format. Expected JSON with "embedding" field containing number array.'
    );
  }

  /**
   * Validate and convert array to number array
   */
  private validateNumberArray(arr: unknown[]): number[] {
    const numbers: number[] = [];
    
    for (let i = 0; i < arr.length; i++) {
      const value = arr[i];
      const num = Number(value);
      
      if (!Number.isFinite(num)) {
        throw new Error(`Invalid number at index ${i}: ${value}`);
      }
      
      numbers.push(num);
    }
    
    return numbers;
  }

  /**
   * Check if custom API is available
   * Attempts to call the API with a test input
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Try to generate a simple embedding to test availability
      await this.generateEmbedding('test');
      return true;
    } catch (error) {
      console.warn('Custom API embedding provider is not available:', error);
      return false;
    }
  }
}
