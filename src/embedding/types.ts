/**
 * Embedding service types and interfaces
 * 
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */

/**
 * Embedding provider interface
 * All embedding providers must implement this interface
 */
export interface EmbeddingProvider {
  /**
   * Generate embedding vector for the given text
   * @param text - Text to generate embedding for
   * @returns Promise resolving to embedding vector (1536 dimensions)
   * @throws Error if embedding generation fails
   */
  generateEmbedding(text: string): Promise<number[]>;

  /**
   * Check if the embedding provider is available and properly configured
   * @returns Promise resolving to true if available, false otherwise
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Embedding provider configuration
 */
export interface EmbeddingProviderConfig {
  /** Provider type */
  provider: 'openai' | 'local-cli' | 'custom-api';
  
  /** OpenAI API key (for openai provider) */
  openaiApiKey?: string;
  
  /** CLI command to execute (for local-cli provider) */
  cliCommand?: string;
  
  /** API endpoint URL (for custom-api provider) */
  apiEndpoint?: string;
  
  /** Embedding model name (default: text-embedding-3-small) */
  embeddingModel?: string;
  
  /** Expected embedding dimensions (default: 1536) */
  dimensions?: number;
}
