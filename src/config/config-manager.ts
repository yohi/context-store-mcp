/**
 * Configuration Manager for Context Store MCP
 * Handles environment variable parsing and Lite mode configuration
 */

import type { LiteModeConfig, SystemConfig, EmbeddingProvider } from './types.js';

/**
 * ConfigManager class
 * Manages system configuration from environment variables
 */
export class ConfigManager {
  private config: SystemConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from environment variables
   * @returns Complete system configuration
   */
  loadConfig(): SystemConfig {
    // Parse Lite mode settings
    const liteMode = this.parseBooleanEnv('LITE_MODE', false);
    const enableGraphStore = this.parseBooleanEnv('ENABLE_GRAPH_STORE', !liteMode);
    const enableRedisCache = this.parseBooleanEnv('ENABLE_REDIS_CACHE', !liteMode);

    // Parse embedding provider settings
    const embeddingProvider = this.parseEmbeddingProvider();
    const embeddingCliCommand = process.env['EMBEDDING_CLI_COMMAND'];
    const embeddingApiEndpoint = process.env['EMBEDDING_API_ENDPOINT'];

    // Validate embedding provider configuration
    this.validateEmbeddingConfig(embeddingProvider, embeddingCliCommand, embeddingApiEndpoint);

    // Parse PostgreSQL configuration (required)
    const postgres = {
      host: process.env['POSTGRES_HOST'] || 'localhost',
      port: this.parseIntEnv('POSTGRES_PORT', 5432),
      database: process.env['POSTGRES_DB'] || 'context_store',
      user: process.env['POSTGRES_USER'] || 'context_store_user',
      password: process.env['POSTGRES_PASSWORD'] || '',
    };

    // Parse Neo4j configuration (optional in Lite mode)
    const neo4j = enableGraphStore ? {
      uri: process.env['NEO4J_URI'] || 'bolt://localhost:7687',
      user: process.env['NEO4J_USER'] || 'neo4j',
      password: process.env['NEO4J_PASSWORD'] || '',
      ...(process.env['NEO4J_DATABASE'] && { database: process.env['NEO4J_DATABASE'] }),
    } : undefined;

    // Parse Redis configuration (optional in Lite mode)
    const redis = enableRedisCache ? {
      host: process.env['REDIS_HOST'] || 'localhost',
      port: this.parseIntEnv('REDIS_PORT', 6379),
      ...(process.env['REDIS_PASSWORD'] && { password: process.env['REDIS_PASSWORD'] }),
    } : undefined;

    // Parse OpenAI configuration
    const openai = process.env['OPENAI_API_KEY'] ? {
      apiKey: process.env['OPENAI_API_KEY'],
    } : undefined;

    // Parse logging configuration
    const logging = {
      level: process.env['LOG_LEVEL'] || 'info',
    };

    const config: SystemConfig = {
      liteMode,
      enableGraphStore,
      enableRedisCache,
      embeddingProvider,
      postgres,
      logging,
    };

    if (embeddingCliCommand) {
      config.embeddingCliCommand = embeddingCliCommand;
    }

    if (embeddingApiEndpoint) {
      config.embeddingApiEndpoint = embeddingApiEndpoint;
    }

    if (neo4j) {
      config.neo4j = neo4j;
    }

    if (redis) {
      config.redis = redis;
    }

    if (openai) {
      config.openai = openai;
    }

    return config;
  }

  /**
   * Check if Lite mode is enabled
   * @returns true if Lite mode is enabled
   */
  isLiteMode(): boolean {
    return this.config.liteMode;
  }

  /**
   * Check if graph store is enabled
   * @returns true if Neo4j graph store is enabled
   */
  isGraphStoreEnabled(): boolean {
    return this.config.enableGraphStore;
  }

  /**
   * Check if Redis cache is enabled
   * @returns true if Redis cache is enabled
   */
  isRedisCacheEnabled(): boolean {
    return this.config.enableRedisCache;
  }

  /**
   * Get embedding provider configuration
   * @returns Embedding provider configuration
   */
  getEmbeddingProvider(): {
    provider: EmbeddingProvider;
    cliCommand?: string;
    apiEndpoint?: string;
  } {
    const result: {
      provider: EmbeddingProvider;
      cliCommand?: string;
      apiEndpoint?: string;
    } = {
      provider: this.config.embeddingProvider,
    };

    if (this.config.embeddingCliCommand) {
      result.cliCommand = this.config.embeddingCliCommand;
    }

    if (this.config.embeddingApiEndpoint) {
      result.apiEndpoint = this.config.embeddingApiEndpoint;
    }

    return result;
  }

  /**
   * Get the full system configuration
   * @returns Complete system configuration
   */
  getConfig(): SystemConfig {
    return { ...this.config };
  }

  /**
   * Get Lite mode specific configuration
   * @returns Lite mode configuration
   */
  getLiteModeConfig(): LiteModeConfig {
    const result: LiteModeConfig = {
      liteMode: this.config.liteMode,
      enableGraphStore: this.config.enableGraphStore,
      enableRedisCache: this.config.enableRedisCache,
      embeddingProvider: this.config.embeddingProvider,
    };

    if (this.config.embeddingCliCommand) {
      result.embeddingCliCommand = this.config.embeddingCliCommand;
    }

    if (this.config.embeddingApiEndpoint) {
      result.embeddingApiEndpoint = this.config.embeddingApiEndpoint;
    }

    return result;
  }

  /**
   * Parse boolean environment variable
   * @param key Environment variable key
   * @param defaultValue Default value if not set
   * @returns Parsed boolean value
   */
  private parseBooleanEnv(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];

    if (value === undefined) {
      return defaultValue;
    }

    const normalized = value.toLowerCase().trim();

    // Handle invalid values with warning
    if (!['true', 'false', '1', '0', 'yes', 'no'].includes(normalized)) {
      console.warn(
        `Invalid boolean value for ${key}: "${value}". Using default: ${defaultValue}`
      );
      return defaultValue;
    }

    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  /**
   * Parse integer environment variable
   * @param key Environment variable key
   * @param defaultValue Default value if not set or invalid
   * @returns Parsed integer value
   */
  private parseIntEnv(key: string, defaultValue: number): number {
    const value = process.env[key];

    if (value === undefined) {
      return defaultValue;
    }

    const parsed = parseInt(value, 10);

    if (isNaN(parsed)) {
      console.warn(
        `Invalid integer value for ${key}: "${value}". Using default: ${defaultValue}`
      );
      return defaultValue;
    }

    return parsed;
  }

  /**
   * Parse embedding provider from environment variable
   * @returns Embedding provider type
   */
  private parseEmbeddingProvider(): EmbeddingProvider {
    const provider = process.env['EMBEDDING_PROVIDER']?.toLowerCase().trim();

    if (!provider) {
      return 'openai'; // Default to OpenAI
    }

    const validProviders: EmbeddingProvider[] = ['openai', 'local-cli', 'custom-api'];

    if (!validProviders.includes(provider as EmbeddingProvider)) {
      console.warn(
        `Invalid EMBEDDING_PROVIDER: "${provider}". Valid options: ${validProviders.join(', ')}. Using default: openai`
      );
      return 'openai';
    }

    return provider as EmbeddingProvider;
  }

  /**
   * Validate embedding provider configuration
   * @param provider Embedding provider type
   * @param cliCommand CLI command (for local-cli provider)
   * @param apiEndpoint API endpoint (for custom-api provider)
   */
  private validateEmbeddingConfig(
    provider: EmbeddingProvider,
    cliCommand?: string,
    apiEndpoint?: string
  ): void {
    if (provider === 'openai' && !process.env['OPENAI_API_KEY']) {
      if (process.env['NODE_ENV'] === 'test') {
        console.warn(
          'EMBEDDING_PROVIDER is set to "openai" but OPENAI_API_KEY is not set. ' +
          'In test environment, this will be logged as a warning, but in production it will throw an error.'
        );
      } else {
        throw new Error(
          'EMBEDDING_PROVIDER is set to "openai" but OPENAI_API_KEY is not set. ' +
          'Please set OPENAI_API_KEY environment variable.'
        );
      }
    }

    if (provider === 'local-cli' && !cliCommand) {
      console.warn(
        'EMBEDDING_PROVIDER is set to "local-cli" but EMBEDDING_CLI_COMMAND is not set. ' +
        'Embedding generation may fail.'
      );
    }

    if (provider === 'custom-api' && !apiEndpoint) {
      console.warn(
        'EMBEDDING_PROVIDER is set to "custom-api" but EMBEDDING_API_ENDPOINT is not set. ' +
        'Embedding generation may fail.'
      );
    }
  }
}
