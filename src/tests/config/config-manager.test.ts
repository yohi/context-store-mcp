/**
 * Tests for ConfigManager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../../config/config-manager.js';
import type { EmbeddingProvider } from '../../config/types.js';

describe('ConfigManager', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Set default API key for tests to avoid validation errors
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Lite Mode Configuration', () => {
    it('should enable Lite mode when LITE_MODE=true', () => {
      process.env['LITE_MODE'] = 'true';
      const config = new ConfigManager();

      expect(config.isLiteMode()).toBe(true);
    });

    it('should disable Lite mode by default', () => {
      delete process.env['LITE_MODE'];
      const config = new ConfigManager();

      expect(config.isLiteMode()).toBe(false);
    });

    it('should disable graph store when ENABLE_GRAPH_STORE=false', () => {
      process.env['ENABLE_GRAPH_STORE'] = 'false';
      const config = new ConfigManager();

      expect(config.isGraphStoreEnabled()).toBe(false);
    });

    it('should disable Redis cache when ENABLE_REDIS_CACHE=false', () => {
      process.env['ENABLE_REDIS_CACHE'] = 'false';
      const config = new ConfigManager();

      expect(config.isRedisCacheEnabled()).toBe(false);
    });

    it('should disable graph store and Redis in Lite mode by default', () => {
      process.env['LITE_MODE'] = 'true';
      const config = new ConfigManager();

      expect(config.isGraphStoreEnabled()).toBe(false);
      expect(config.isRedisCacheEnabled()).toBe(false);
    });

    it('should allow explicit override of graph store in Lite mode', () => {
      process.env['LITE_MODE'] = 'true';
      process.env['ENABLE_GRAPH_STORE'] = 'true';
      const config = new ConfigManager();

      expect(config.isGraphStoreEnabled()).toBe(true);
    });
  });

  describe('Boolean Environment Variable Parsing', () => {
    it('should parse "true" as true', () => {
      process.env['LITE_MODE'] = 'true';
      const config = new ConfigManager();
      expect(config.isLiteMode()).toBe(true);
    });

    it('should parse "1" as true', () => {
      process.env['LITE_MODE'] = '1';
      const config = new ConfigManager();
      expect(config.isLiteMode()).toBe(true);
    });

    it('should parse "yes" as true', () => {
      process.env['LITE_MODE'] = 'yes';
      const config = new ConfigManager();
      expect(config.isLiteMode()).toBe(true);
    });

    it('should parse "false" as false', () => {
      process.env['LITE_MODE'] = 'false';
      const config = new ConfigManager();
      expect(config.isLiteMode()).toBe(false);
    });

    it('should parse "0" as false', () => {
      process.env['LITE_MODE'] = '0';
      const config = new ConfigManager();
      expect(config.isLiteMode()).toBe(false);
    });

    it('should parse "no" as false', () => {
      process.env['LITE_MODE'] = 'no';
      const config = new ConfigManager();
      expect(config.isLiteMode()).toBe(false);
    });

    it('should handle case-insensitive values', () => {
      process.env['LITE_MODE'] = 'TRUE';
      const config = new ConfigManager();
      expect(config.isLiteMode()).toBe(true);
    });

    it('should use default value for invalid boolean', () => {
      process.env['LITE_MODE'] = 'invalid';
      const config = new ConfigManager();
      expect(config.isLiteMode()).toBe(false); // Default is false
    });
  });

  describe('Integer Environment Variable Parsing', () => {
    it('should parse valid integer', () => {
      process.env['POSTGRES_PORT'] = '9999';
      const config = new ConfigManager();
      expect(config.getConfig().postgres.port).toBe(9999);
    });

    it('should use default value for invalid integer', () => {
      process.env['POSTGRES_PORT'] = 'invalid-port';
      const config = new ConfigManager();
      // Default is 5432
      expect(config.getConfig().postgres.port).toBe(5432);
    });

    it('should use default value for undefined integer', () => {
      delete process.env['POSTGRES_PORT'];
      const config = new ConfigManager();
      // Default is 5432
      expect(config.getConfig().postgres.port).toBe(5432);
    });
  });

  describe('Embedding Provider Configuration', () => {
    it('should default to OpenAI provider', () => {
      delete process.env['EMBEDDING_PROVIDER'];
      const config = new ConfigManager();
      const provider = config.getEmbeddingProvider();

      expect(provider.provider).toBe('openai');
    });

    it('should use local-cli provider when specified', () => {
      process.env['EMBEDDING_PROVIDER'] = 'local-cli';
      process.env['EMBEDDING_CLI_COMMAND'] = 'gemini-cli embed';
      const config = new ConfigManager();
      const provider = config.getEmbeddingProvider();

      expect(provider.provider).toBe('local-cli');
      expect(provider.cliCommand).toBe('gemini-cli embed');
    });

    it('should use custom-api provider when specified', () => {
      process.env['EMBEDDING_PROVIDER'] = 'custom-api';
      process.env['EMBEDDING_API_ENDPOINT'] = 'http://localhost:8080/embeddings';
      const config = new ConfigManager();
      const provider = config.getEmbeddingProvider();

      expect(provider.provider).toBe('custom-api');
      expect(provider.apiEndpoint).toBe('http://localhost:8080/embeddings');
    });

    it('should handle case-insensitive provider names', () => {
      process.env['EMBEDDING_PROVIDER'] = 'LOCAL-CLI';
      const config = new ConfigManager();
      const provider = config.getEmbeddingProvider();

      expect(provider.provider).toBe('local-cli');
    });

    it('should default to OpenAI for invalid provider', () => {
      process.env['EMBEDDING_PROVIDER'] = 'invalid-provider';
      const config = new ConfigManager();
      const provider = config.getEmbeddingProvider();

      expect(provider.provider).toBe('openai');
    });

    it('should throw error if OPENAI_API_KEY is missing when provider is openai', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['EMBEDDING_PROVIDER'] = 'openai';
      delete process.env['OPENAI_API_KEY'];

      expect(() => new ConfigManager()).toThrow(/OPENAI_API_KEY is not set/);
    });

    it('should throw error if OPENAI_API_KEY is missing when provider defaults to openai', () => {
      process.env['NODE_ENV'] = 'production';
      delete process.env['EMBEDDING_PROVIDER'];
      delete process.env['OPENAI_API_KEY'];

      expect(() => new ConfigManager()).toThrow(/OPENAI_API_KEY is not set/);
    });
  });

  describe('PostgreSQL Configuration', () => {
    it('should use default PostgreSQL values', () => {
      // Ensure environment variables don't interfere with default values
      delete process.env['POSTGRES_HOST'];
      delete process.env['POSTGRES_PORT'];
      delete process.env['POSTGRES_DB'];
      delete process.env['POSTGRES_USER'];
      delete process.env['POSTGRES_PASSWORD'];

      const config = new ConfigManager();
      const systemConfig = config.getConfig();

      expect(systemConfig.postgres.host).toBe('localhost');
      expect(systemConfig.postgres.port).toBe(5432);
      expect(systemConfig.postgres.database).toBe('context_store');
      expect(systemConfig.postgres.user).toBe('context_store_user');
    });

    it('should use custom PostgreSQL values from environment', () => {
      process.env['POSTGRES_HOST'] = 'db.example.com';
      process.env['POSTGRES_PORT'] = '5433';
      process.env['POSTGRES_DB'] = 'custom_db';
      process.env['POSTGRES_USER'] = 'custom_user';
      process.env['POSTGRES_PASSWORD'] = 'secret';

      const config = new ConfigManager();
      const systemConfig = config.getConfig();

      expect(systemConfig.postgres.host).toBe('db.example.com');
      expect(systemConfig.postgres.port).toBe(5433);
      expect(systemConfig.postgres.database).toBe('custom_db');
      expect(systemConfig.postgres.user).toBe('custom_user');
      expect(systemConfig.postgres.password).toBe('secret');
    });
  });

  describe('Neo4j Configuration', () => {
    it('should include Neo4j config when graph store is enabled', () => {
      process.env['ENABLE_GRAPH_STORE'] = 'true';
      process.env['NEO4J_URI'] = 'bolt://neo4j.example.com:7687';
      process.env['NEO4J_USER'] = 'neo4j_user';
      process.env['NEO4J_PASSWORD'] = 'neo4j_pass';

      const config = new ConfigManager();
      const systemConfig = config.getConfig();

      expect(systemConfig.neo4j).toBeDefined();
      expect(systemConfig.neo4j?.uri).toBe('bolt://neo4j.example.com:7687');
      expect(systemConfig.neo4j?.user).toBe('neo4j_user');
      expect(systemConfig.neo4j?.password).toBe('neo4j_pass');
    });

    it('should not include Neo4j config when graph store is disabled', () => {
      process.env['ENABLE_GRAPH_STORE'] = 'false';

      const config = new ConfigManager();
      const systemConfig = config.getConfig();

      expect(systemConfig.neo4j).toBeUndefined();
    });
  });

  describe('Redis Configuration', () => {
    it('should include Redis config when cache is enabled', () => {
      process.env['ENABLE_REDIS_CACHE'] = 'true';
      process.env['REDIS_HOST'] = 'redis.example.com';
      process.env['REDIS_PORT'] = '6380';
      process.env['REDIS_PASSWORD'] = 'redis_pass';

      const config = new ConfigManager();
      const systemConfig = config.getConfig();

      expect(systemConfig.redis).toBeDefined();
      expect(systemConfig.redis?.host).toBe('redis.example.com');
      expect(systemConfig.redis?.port).toBe(6380);
      expect(systemConfig.redis?.password).toBe('redis_pass');
    });

    it('should not include Redis config when cache is disabled', () => {
      process.env['ENABLE_REDIS_CACHE'] = 'false';

      const config = new ConfigManager();
      const systemConfig = config.getConfig();

      expect(systemConfig.redis).toBeUndefined();
    });
  });

  describe('getLiteModeConfig', () => {
    it('should return Lite mode specific configuration', () => {
      process.env['LITE_MODE'] = 'true';
      process.env['EMBEDDING_PROVIDER'] = 'local-cli';
      process.env['EMBEDDING_CLI_COMMAND'] = 'gemini-cli embed';

      const config = new ConfigManager();
      const liteConfig = config.getLiteModeConfig();

      expect(liteConfig.liteMode).toBe(true);
      expect(liteConfig.enableGraphStore).toBe(false);
      expect(liteConfig.enableRedisCache).toBe(false);
      expect(liteConfig.embeddingProvider).toBe('local-cli');
      expect(liteConfig.embeddingCliCommand).toBe('gemini-cli embed');
    });
  });
});
