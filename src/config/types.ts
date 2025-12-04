/**
 * Configuration types for Context Store MCP
 */

/**
 * Embedding provider types
 */
export type EmbeddingProvider = 'openai' | 'local-cli' | 'custom-api';

/**
 * Lite mode configuration interface
 */
export interface LiteModeConfig {
  /** Whether Lite mode is enabled (PostgreSQL only) */
  liteMode: boolean;
  
  /** Whether Neo4j graph store is enabled */
  enableGraphStore: boolean;
  
  /** Whether Redis cache is enabled */
  enableRedisCache: boolean;
  
  /** Embedding provider to use */
  embeddingProvider: EmbeddingProvider;
  
  /** CLI command for local embedding generation (when provider is 'local-cli') */
  embeddingCliCommand?: string;
  
  /** API endpoint for custom embedding service (when provider is 'custom-api') */
  embeddingApiEndpoint?: string;
}

/**
 * Full system configuration interface
 */
export interface SystemConfig extends LiteModeConfig {
  /** PostgreSQL configuration */
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  
  /** Neo4j configuration (optional in Lite mode) */
  neo4j?: {
    uri: string;
    user: string;
    password: string;
    database?: string;
  };
  
  /** Redis configuration (optional in Lite mode) */
  redis?: {
    host: string;
    port: number;
    password?: string;
  };
  
  /** OpenAI API configuration */
  openai?: {
    apiKey: string;
  };
  
  /** Logging configuration */
  logging: {
    level: string;
  };
}
