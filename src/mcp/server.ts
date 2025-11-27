/**
 * MCP Server Entry Point
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
import pg from 'pg';
import neo4j from 'neo4j-driver';
import { MemoryManager } from '../memory/memory-manager.js';
import type { Memory } from '../memory/types.js';
import { TransactionCoordinator } from '../storage/transaction-coordinator.js';
import { VectorStoreAdapter } from '../storage/vector-store-adapter.js';
import { GraphStoreAdapter } from '../storage/graph-store-adapter.js';
import { QueryProcessor } from '../query/query-processor.js';
import { GarbageCollectionJob } from '../monitoring/garbage-collection-job.js';

/**
 * MCPサーバーインスタンスを作成して設定する
 */
export function createContextStoreServer(
  memoryManager: MemoryManager,
  queryProcessor: QueryProcessor
): Server {
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
                description: '検索クエリ',
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
                description: '新しい内容',
              },
            },
            required: ['id', 'content'],
          },
        },
        {
          name: 'get_memory_history',
          description: '記憶の変更履歴を取得します',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: '履歴を取得する記憶のID',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'revert_memory',
          description: '記憶を特定のバージョンに戻します',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'ロールバックする記憶のID',
              },
              version: {
                type: 'number',
                description: '戻すバージョン番号',
              },
            },
            required: ['id', 'version'],
          },
        },

        {
          name: 'suggest_merges',
          description: '統合可能な記憶の候補を提案します',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'ベースとなる記憶のID',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'merge_memories',
          description: '複数の記憶を1つに統合します',
          inputSchema: {
            type: 'object',
            properties: {
              ids: {
                type: 'array',
                items: { type: 'string' },
                description: '統合する記憶のIDリスト',
              },
            },
            required: ['ids'],
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

    switch (name) {
      case 'store_memory': {
        // 記憶保存ツール
        const content = args['content'] as string;
        const metadata = args['metadata'] as any;

        if (!content) {
          throw new Error('Missing required parameter: content');
        }

        const result = await memoryManager.storeMemory({
          content,
          metadata,
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
        const query = args['query'] as string;
        const filters = args['filters'] as any; // Raw filters from tool arguments

        if (!query) {
          throw new Error('Missing required parameter: query');
        }

        const hybridSearchOptions: HybridSearchOptions = {
          limit: filters?.limit || 10,
        };

        const searchFilters: SearchFilters = {};

        if (filters?.memoryTypes && Array.isArray(filters.memoryTypes)) {
          searchFilters.memoryTypes = filters.memoryTypes;
        }

        if (filters?.tags && Array.isArray(filters.tags)) {
          searchFilters.tags = filters.tags;
        }

        if (filters?.timeRange) {
          try {
            const startDate = new Date(filters.timeRange.start);
            const endDate = new Date(filters.timeRange.end);
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
              throw new Error('Invalid date format in timeRange');
            }
            searchFilters.timeRange = {
              type: 'absolute',
              start: startDate,
              end: endDate,
            };
          } catch (e) {
            console.warn(`Failed to parse timeRange filter: ${e}. Skipping time filter.`);
            // Continue without time filter if parsing fails
          }
        }

        // Only add searchFilters if there are actual filters to apply
        if (Object.keys(searchFilters).length > 0) {
          hybridSearchOptions.filters = searchFilters;
        }

        // QueryProcessorを使用したハイブリッド検索
        const results = await queryProcessor.hybridSearch(query, hybridSearchOptions);

        const formattedResults = results.map(r => {
          const m = r.memory;
          const scores = r.scores;
          return `ID: ${m.id}
Type: ${m.memoryType}
Score: ${scores.combined.toFixed(3)} (Semantic: ${scores.semantic.toFixed(3)}, Structural: ${scores.structural.toFixed(3)})
Content: ${m.content.substring(0, Math.min(m.content.length, 200))}...`; // Ensure content substring doesn't go out of bounds
        }).join('\n---\n');

        return {
          content: [{ type: 'text', text: results.length > 0 ? formattedResults : 'No matching memories found.' }],
        };
      }

      case 'delete_memory': {
        // 記憶削除ツール
        const id = args['id'] as string;

        if (!id) {
          throw new Error('Missing required parameter: id');
        }

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
        const content = args['content'] as string;

        if (!id) {
          throw new Error('Missing required parameter: id');
        }
        if (!content) {
          throw new Error('Missing required parameter: content');
        }

        const result = await memoryManager.updateMemory(id, { content });

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

      case 'get_memory_history': {
        // 記憶履歴取得ツール
        const id = args['id'] as string;

        if (!id) {
          throw new Error('Missing required parameter: id');
        }

        const history = await memoryManager.getMemoryHistory(id);

        if (history.length === 0) {
          return {
            content: [{ type: 'text', text: 'No history found for this memory.' }],
          };
        }

        const formattedHistory = history.map(h =>
          `Version: ${h.version}
Timestamp: ${h.timestamp.toISOString()}
Content: ${h.content.substring(0, 100)}...`
        ).join('\n---\n');

        return {
          content: [{ type: 'text', text: formattedHistory }],
        };
      }

      case 'revert_memory': {
        // 記憶ロールバックツール
        const id = args['id'] as string;
        const version = args['version'] as number;

        if (!id) {
          throw new Error('Missing required parameter: id');
        }
        if (version === undefined) {
          throw new Error('Missing required parameter: version');
        }

        const result = await memoryManager.revertToVersion(id, version);

        if (!result.success) {
          return {
            content: [{ type: 'text', text: `Error reverting memory: ${result.error.message}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: `Memory reverted to version ${version} successfully` }],
        };
      }

      case 'suggest_merges': {
        // マージ提案ツール
        const id = args['id'] as string;

        if (!id) {
          throw new Error('Missing required parameter: id');
        }

        const suggestions = await memoryManager.suggestMerges(id);

        if (suggestions.length === 0) {
          return {
            content: [{ type: 'text', text: 'No merge suggestions found.' }],
          };
        }

        const formattedSuggestions = suggestions.map(m =>
          `ID: ${m.id}
Type: ${m.memoryType}
Content: ${m.content.substring(0, 100)}...`
        ).join('\n---\n');

        return {
          content: [{ type: 'text', text: formattedSuggestions }],
        };
      }

      case 'merge_memories': {
        // マージ実行ツール
        const ids = args['ids'] as string[];

        if (!ids || !Array.isArray(ids) || ids.length < 2) {
          throw new Error('Missing required parameter: ids (must be an array of at least 2 IDs)');
        }

        const result = await memoryManager.mergeMemories(ids);

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

  return server;
}

export async function main(): Promise<void> {
  // 環境変数のチェック
  const postgresUrl = process.env['POSTGRES_URL'] || process.env['DATABASE_URL'];
  const neo4jUri = process.env['NEO4J_URI'];
  const neo4jUser = process.env['NEO4J_USER'];
  const neo4jPassword = process.env['NEO4J_PASSWORD'];
  const openaiApiKey = process.env['OPENAI_API_KEY'];

  if (!postgresUrl) {
    console.error('Error: POSTGRES_URL or DATABASE_URL environment variable is required');
    process.exit(1);
  }
  if (!neo4jUri || !neo4jUser || !neo4jPassword) {
    console.error('Error: NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD environment variables are required');
    process.exit(1);
  }
  if (!openaiApiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  // データベース接続の初期化
  const pool = new pg.Pool({
    connectionString: postgresUrl,
  });

  const driver = neo4j.driver(
    neo4jUri,
    neo4j.auth.basic(neo4jUser, neo4jPassword)
  );

  // アダプターとコーディネーターの初期化
  const vectorStore = new VectorStoreAdapter({
    pool,
    openaiApiKey,
  });

  const graphStore = new GraphStoreAdapter({
    uri: neo4jUri,
    username: neo4jUser,
    password: neo4jPassword,
  });

  const transactionCoordinator = new TransactionCoordinator({
    postgresPool: pool,
    neo4jDriver: driver,
  });

  // QueryProcessorの初期化
  const queryProcessor = new QueryProcessor({
    vectorAdapter: vectorStore,
    graphAdapter: graphStore,
  });

  // MemoryManagerの初期化
  const memoryManager = new MemoryManager({
    vectorStore,
    graphStore,
    transactionCoordinator,
    // TODO: Classifier integration
  });

  const server = createContextStoreServer(memoryManager, queryProcessor);

  // ガベージコレクションジョブの初期化と開始
  const gcJob = new GarbageCollectionJob(memoryManager);
  gcJob.start();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Context Store MCP Server started');

  // グレースフルシャットダウン
  const cleanup = async () => {
    console.error('Shutting down...');
    gcJob.stop();
    await pool.end();
    await driver.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
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
