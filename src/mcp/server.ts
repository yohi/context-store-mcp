/**
 * MCPサーバーエントリーポイント
 * MCPサーバーのメインエントリーポイント
 */

import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MemoryManager } from '../memory/memory-manager.js';
import type { MemoryType } from '../memory/types.js';
import { GarbageCollectionJob } from '../monitoring/garbage-collection-job.js';
import { ConfigManager } from '../config/config-manager.js';
import { ErrorHandler, Neo4jConnectionError, EmbeddingServiceError } from './error-handler.js';

import { Pool } from 'pg';
import neo4j, { Driver } from 'neo4j-driver';
import { PostgresStorageAdapter } from '../storage/postgres-store-adapter.js';
import { VectorStoreAdapter } from '../storage/vector-store-adapter.js';
import { TransactionCoordinator } from '../storage/transaction-coordinator.js';
import { EmbeddingService } from '../embedding/embedding-service.js';
import type { EmbeddingProviderConfig } from '../embedding/types.js';

/**
 * MCPサーバーインスタンスを作成して設定する
 * @returns サーバーインスタンスとクリーンアップ関数
 */
export function createContextStoreServer(deps?: { memoryManager?: MemoryManager }): {
  server: Server;
  cleanup: () => Promise<void>;
} {
  // ConfigManagerの初期化
  const configManager = new ConfigManager();
  const config = configManager.getConfig();
  const errorHandler = new ErrorHandler(console);

  console.error('Starting Context Store MCP Server...');
  console.error(`Mode: ${config.liteMode ? 'Lite' : 'Full'}`);
  console.error(`Graph Store: ${config.enableGraphStore ? 'Enabled' : 'Disabled'}`);
  console.error(`Redis Cache: ${config.enableRedisCache ? 'Enabled' : 'Disabled'}`);
  console.error(`Embedding Provider: ${config.embeddingProvider}`);

  // MemoryManagerの初期化
  let memoryManager = deps?.memoryManager;

  // リソースのクリーンアップ用に外側のスコープで宣言
  let pool: Pool | undefined;
  let neo4jDriver: Driver | undefined;

  if (!memoryManager) {
    // DB接続プールの作成
    if (!process.env['DATABASE_URL']) {
      throw new Error('DATABASE_URL environment variable is required but not set.');
    }

    pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    const storage = new PostgresStorageAdapter(pool);

    // VectorStoreの初期化 (埋め込みプロバイダーが利用可能な場合)
    let vectorStore: VectorStoreAdapter | undefined;

    // Liteモードでは埋め込みプロバイダーの設定に基づいて初期化
    try {
      // EmbeddingServiceの設定を構築
      const embeddingConfig: EmbeddingProviderConfig = {
        provider: config.embeddingProvider,
        dimensions: 1536,
        ...(process.env['OPENAI_API_KEY'] && { openaiApiKey: process.env['OPENAI_API_KEY'] }),
        ...(process.env['EMBEDDING_CLI_COMMAND'] && { cliCommand: process.env['EMBEDDING_CLI_COMMAND'] }),
        ...(process.env['EMBEDDING_API_ENDPOINT'] && { apiEndpoint: process.env['EMBEDDING_API_ENDPOINT'] }),
      };

      // EmbeddingServiceを作成
      const embeddingService = new EmbeddingService(embeddingConfig);

      // プロバイダーが設定されているか確認
      if (!embeddingService.isConfigured()) {
        const error = new EmbeddingServiceError(
          `Embedding provider '${config.embeddingProvider}' could not be initialized. ` +
          `Please check your configuration and environment variables.`
        );
        errorHandler.handleError(error, {
          operation: 'initialize_embedding_service',
          component: 'server',
        });
      } else {
        // EmbeddingProviderを取得してVectorStoreAdapterを初期化
        // Note: embeddingService.providerはprivateなので、代わりにラッパーを作成
        const embeddingProvider = {
          generateEmbedding: async (text: string) => {
            const result = await embeddingService.generateEmbedding(text);
            if (result === null) {
              throw new Error('Embedding generation returned null');
            }
            return result;
          },
          isAvailable: () => embeddingService.isAvailable(),
        };

        vectorStore = new VectorStoreAdapter({
          pool,
          embeddingProvider,
          dimensions: 1536,
        });
        console.error(`Vector store initialized with ${config.embeddingProvider} provider`);
      }
    } catch (error) {
      const embeddingError = new EmbeddingServiceError(
        `Failed to initialize vector store: ${error instanceof Error ? error.message : String(error)}`
      );
      errorHandler.handleError(embeddingError, {
        operation: 'initialize_vector_store',
        component: 'server',
      });
    }

    // Neo4jドライバーの初期化（Liteモードまたは無効化されている場合はスキップ）
    if (config.enableGraphStore && process.env['NEO4J_URI'] && process.env['NEO4J_USER'] && process.env['NEO4J_PASSWORD']) {
      try {
        neo4jDriver = neo4j.driver(
          process.env['NEO4J_URI'],
          neo4j.auth.basic(process.env['NEO4J_USER'], process.env['NEO4J_PASSWORD'])
        );
        console.error('Neo4j driver initialized successfully');
      } catch (error) {
        const neo4jError = new Neo4jConnectionError(
          error instanceof Error ? error.message : 'Failed to initialize Neo4j driver'
        );
        errorHandler.handleError(neo4jError, {
          operation: 'initialize_neo4j',
          component: 'server',
        });
      }
    } else {
      console.error('Neo4j initialization skipped (Lite mode or disabled)');
    }

    // TransactionCoordinatorの初期化
    let transactionCoordinator: TransactionCoordinator | undefined;
    if (neo4jDriver) {
      transactionCoordinator = new TransactionCoordinator({
        postgresPool: pool,
        neo4jDriver: neo4jDriver,
      });
    }

    // MemoryManager設定オブジェクトを構築（undefinedプロパティを除外）
    const memoryManagerConfig: {
      storage: PostgresStorageAdapter;
      vectorStore?: VectorStoreAdapter;
      transactionCoordinator?: TransactionCoordinator;
    } = { storage };
    if (vectorStore) memoryManagerConfig.vectorStore = vectorStore;
    if (transactionCoordinator) memoryManagerConfig.transactionCoordinator = transactionCoordinator;

    memoryManager = new MemoryManager(memoryManagerConfig);
  }

  // ガベージコレクションジョブの初期化と開始 (5分間隔)
  const gcJob = new GarbageCollectionJob(memoryManager);
  gcJob.start();

  // クリーンアップ関数の定義
  const cleanup = async (): Promise<void> => {
    console.error('Shutting down Context Store MCP Server...');

    // GCジョブを停止
    gcJob.stop();

    // MemoryManagerのリソースをクリーンアップ
    // 注意: サーバがMemoryManagerにストレージを渡した場合 (ownsStorage = false)、
    // dispose() は共有ストレージ/プールを閉じません。
    // dispose() がストレージ/プールを閉じるのは、MemoryManagerが自身のストレージ/プールを作成した場合のみです。
    try {
      await memoryManager.dispose();
    } catch (error) {
      console.error('Error disposing MemoryManager:', error);
    }

    // データベース接続をクローズ（依存関係がない場合のみ）
    // 注意: MemoryManagerが自身のPoolを作成した場合、dispose()で既にクローズされている
    if (!deps?.memoryManager) {
      // Poolのクローズ（サーバーが直接作成した場合のみ）
      if (pool) {
        try {
          await pool.end();
          console.error('PostgreSQL connection pool closed');
        } catch (error) {
          console.error('Error closing PostgreSQL pool:', error);
        }
      }

      // Neo4jドライバーのクローズ
      if (neo4jDriver) {
        try {
          await neo4jDriver.close();
          console.error('Neo4j driver closed');
        } catch (error) {
          console.error('Error closing Neo4j driver:', error);
        }
      }
    }

    console.error('Context Store MCP Server shutdown complete');
  };

  const server = new Server(
    {
      name: 'context-store-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // ツールリストハンドラー
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'store_memory',
          description: '記憶を保存します',
          inputSchema: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: '記憶する内容',
              },
              metadata: {
                type: 'object',
                description: 'メタデータ (source, timestamp, tags, memoryType)',
                properties: {
                  source: { type: 'string' },
                  timestamp: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  memoryType: {
                    type: 'string',
                    enum: ['episodic', 'semantic', 'procedural'],
                  },
                },
              },
            },
            required: ['content'],
          },
        },
        {
          name: 'search_memory',
          description: '記憶を検索します',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: '検索クエリ (現在、実装上の制約によりタイプフィルタ等のみ機能します)',
              },
              filters: {
                type: 'object',
                description: '検索フィルタ',
                properties: {
                  timeRange: {
                    type: 'object',
                    properties: {
                      start: { type: 'string' },
                      end: { type: 'string' },
                    },
                  },
                  memoryTypes: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  tags: { type: 'array', items: { type: 'string' } },
                  limit: { type: 'number' },
                },
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'delete_memory',
          description: '記憶を削除します',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: '削除する記憶のID',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'update_memory',
          description: '記憶を更新します',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: '更新する記憶のID',
              },
              content: {
                type: 'string',
                description: '新しい内容 (オプション)',
              },
              metadata: {
                type: 'object',
                description: '新しいメタデータ (オプション)',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'suggest_memory_merges',
          description: '指定された記憶に対するマージ（統合）候補を提案します',
          inputSchema: {
            type: 'object',
            properties: {
              memoryId: {
                type: 'string',
                description: 'ベースとなる記憶のID',
              },
            },
            required: ['memoryId'],
          },
        },
        {
          name: 'merge_memories',
          description: '複数の記憶を統合して新しい記憶を作成し、元の記憶を削除します',
          inputSchema: {
            type: 'object',
            properties: {
              memoryIds: {
                type: 'array',
                items: { type: 'string' },
                description: '統合する記憶のIDリスト（2つ以上）',
                minItems: 2,
              },
            },
            required: ['memoryIds'],
          },
        },
      ],
    };
  });

  // ツール呼び出しハンドラー
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // 引数の基本検証
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments: must be an object');
    }

    try {
      switch (name) {
        case 'store_memory': {
          // 記憶保存ツール
          const content = args['content'] as string;
          if (!content) throw new Error('Missing required parameter: content');

          const metadata = (args['metadata'] as Record<string, unknown>) || {};

          // memoryTypeの処理
          let memoryType: MemoryType | undefined;
          if (metadata['memoryType']) {
            memoryType = metadata['memoryType'] as MemoryType;
            // metadataからは削除しておく（MemoryManagerが一元管理するため）
            delete metadata['memoryType'];
          }

          const result = await memoryManager.storeMemory({
            content,
            metadata,
            ...(memoryType ? { memoryType } : {}),
          });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `Error storing memory: ${result.error.message}` }],
              isError: true,
            };
          }

          return {
            content: [{ type: 'text', text: `Memory stored successfully. ID: ${result.value}` }],
          };
        }

        case 'search_memory': {
          // 記憶検索ツール
          // 現在のMemoryManager.searchMemoriesはメタデータフィルタのみ対応
          // ベクトル検索は findSimilarMemories だが、統合的な検索インターフェースは未完成
          // ここでは簡易的に searchMemories を使用

          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          // const query = args['query'] as string;
          const filters = (args['filters'] as Record<string, unknown>) || {};

          const searchParams: any = {};
          if (filters['tags']) searchParams.tags = filters['tags'] as string[];
          if (filters['memoryTypes']) searchParams.memoryTypes = filters['memoryTypes'] as MemoryType[];
          if (filters['limit']) searchParams.limit = filters['limit'] as number;

          const results = await memoryManager.searchMemories(searchParams);

          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
          };
        }

        case 'delete_memory': {
          // 記憶削除ツール
          const id = args['id'] as string;
          if (!id) throw new Error('Missing required parameter: id');

          const result = await memoryManager.deleteMemory(id);

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `Error deleting memory: ${result.error.message}` }],
              isError: true,
            };
          }

          return {
            content: [{ type: 'text', text: 'Memory deleted successfully' }],
          };
        }

        case 'update_memory': {
          // 記憶更新ツール
          const id = args['id'] as string;
          if (!id) throw new Error('Missing required parameter: id');

          const updates: any = {};
          if (args['content']) updates.content = args['content'];
          if (args['metadata']) updates.metadata = args['metadata'];

          const result = await memoryManager.updateMemory(id, updates);

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `Error updating memory: ${result.error.message}` }],
              isError: true,
            };
          }

          return {
            content: [{ type: 'text', text: 'Memory updated successfully' }],
          };
        }

        case 'suggest_memory_merges': {
          // マージ提案ツール
          const memoryId = args['memoryId'] as string;
          if (!memoryId) throw new Error('Missing required parameter: memoryId');

          const suggestions = await memoryManager.suggestMerges(memoryId);

          if (suggestions.length === 0) {
            return {
              content: [{ type: 'text', text: 'No merge suggestions found.' }],
            };
          }

          // 提案を見やすく整形
          const formattedSuggestions = suggestions.map(m => ({
            id: m.id,
            type: m.memoryType,
            preview: m.content.substring(0, 100) + (m.content.length > 100 ? '...' : ''),
            tags: Array.isArray(m.metadata?.tags) ? m.metadata.tags : (m.metadata?.tags ? [m.metadata.tags] : []),
            timestamp: m.createdAt
          }));

          return {
            content: [{
              type: 'text',
              text: `Found ${suggestions.length} potential merge candidates:\n${JSON.stringify(formattedSuggestions, null, 2)}`
            }],
          };
        }

        case 'merge_memories': {
          // マージ実行ツール
          const memoryIds = args['memoryIds'] as string[];
          if (!memoryIds || !Array.isArray(memoryIds) || memoryIds.length < 2) {
            throw new Error('Missing required parameter: memoryIds (must be an array of at least 2 IDs)');
          }

          const result = await memoryManager.mergeMemories(memoryIds);

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `Error merging memories: ${result.error.message}` }],
              isError: true,
            };
          }

          return {
            content: [{ type: 'text', text: `Memories merged successfully. New Memory ID: ${result.value}` }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Internal Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  // リソースリストハンドラー
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'memory://stats',
          name: 'memory_stats',
          description: 'メモリの統計情報',
          mimeType: 'application/json',
        },
        {
          uri: 'memory://types',
          name: 'memory_types',
          description: 'メモリのタイプ一覧',
          mimeType: 'application/json',
        },
      ],
    };
  });

  return { server, cleanup };
}

export async function main(): Promise<void> {
  const { server, cleanup } = createContextStoreServer();

  // シグナルハンドラーの設定
  const handleShutdown = async (signal: string) => {
    console.error(`\nReceived ${signal}, shutting down gracefully...`);
    try {
      await cleanup();
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Context Store MCP Server started');
}

// 直接実行時のエントリーポイント
// Windows互換性のため、import.meta.urlをファイルシステムパスに変換して比較
const currentFilePath = fileURLToPath(import.meta.url);
const executedFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFilePath === executedFilePath) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
