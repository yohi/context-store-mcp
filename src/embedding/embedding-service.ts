/**
 * Embedding Service
 * 
 * Manages embedding generation with multiple provider support
 * Handles provider selection, error handling, and fallback logic
 * Requirements: 10.1, 10.4, 10.5, 11.3
 */

import type { EmbeddingProvider, EmbeddingProviderConfig } from './types.js';
import { OpenAIEmbeddingProvider } from './openai-embedding-provider.js';
import { LocalCLIEmbeddingProvider } from './local-cli-embedding-provider.js';
import { CustomAPIEmbeddingProvider } from './custom-api-embedding-provider.js';

/**
 * Embedding service class
 * Provides a unified interface for embedding generation across multiple providers
 */
export class EmbeddingService {
  private provider: EmbeddingProvider | null;
  private config: EmbeddingProviderConfig;

  constructor(config: EmbeddingProviderConfig) {
    this.config = config;
    this.provider = this.createProvider(config);
  }

  /**
   * Create embedding provider based on configuration
   * Returns null if provider cannot be created (graceful degradation)
   */
  private createProvider(config: EmbeddingProviderConfig): EmbeddingProvider | null {
    try {
      switch (config.provider) {
        case 'openai':
          if (!config.openaiApiKey) {
            console.warn('OpenAI API key not provided. Embedding generation will be disabled.');
            return null;
          }
          return new OpenAIEmbeddingProvider(
            config.openaiApiKey,
            config.embeddingModel,
            config.dimensions
          );

        case 'local-cli':
          if (!config.cliCommand) {
            console.warn('CLI command not provided. Embedding generation will be disabled.');
            return null;
          }
          return new LocalCLIEmbeddingProvider(config.cliCommand, config.dimensions);

        case 'custom-api':
          if (!config.apiEndpoint) {
            console.warn('API endpoint not provided. Embedding generation will be disabled.');
            return null;
          }
          return new CustomAPIEmbeddingProvider(config.apiEndpoint, config.dimensions);

        default:
          console.warn(`Unknown embedding provider: ${config.provider}. Using OpenAI as default.`);
          if (!config.openaiApiKey) {
            console.warn('OpenAI API key not provided. Embedding generation will be disabled.');
            return null;
          }
          return new OpenAIEmbeddingProvider(
            config.openaiApiKey,
            config.embeddingModel,
            config.dimensions
          );
      }
    } catch (error) {
      console.error('Failed to create embedding provider:', error);
      return null;
    }
  }

  /**
   * Generate embedding for the given text
   * Returns null if embedding generation fails (graceful degradation)
   * 
   * Requirements:
   * - 10.1: Provider selection based on configuration
   * - 10.5: Error handling and graceful degradation
   * - 11.3: Continue operation without embedding service
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    // If no provider is available, return null (graceful degradation)
    if (!this.provider) {
      console.warn('No embedding provider available. Skipping embedding generation.');
      return null;
    }

    try {
      const embedding = await this.provider.generateEmbedding(text);
      return embedding;
    } catch (error) {
      // Log error but don't throw - allow memory storage without embedding
      console.error('Embedding generation failed:', error);
      console.warn('Memory will be stored without vector embedding.');
      return null;
    }
  }

  /**
   * Check if embedding service is available
   * Returns false if provider is not configured or not available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.provider) {
      return false;
    }

    try {
      return await this.provider.isAvailable();
    } catch (error) {
      console.warn('Failed to check embedding provider availability:', error);
      return false;
    }
  }

  /**
   * Get the current provider type
   */
  getProviderType(): string {
    return this.config.provider;
  }

  /**
   * Check if provider is configured (not necessarily available)
   */
  isConfigured(): boolean {
    return this.provider !== null;
  }
}
