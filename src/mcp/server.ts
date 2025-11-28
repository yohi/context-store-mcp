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
import { MemoryManager } from '../memory/memory-manager.js';
import type { MemoryType } from '../memory/types.js';
import { GarbageCollectionJob } from '../monitoring/garbage-collection-job.js';

/**
 * MCPサーバーインスタンスを作成して設定する
 */
export function createContextStoreServer(deps?: { memoryManager?: MemoryManager }): Server {
  // MemoryManagerの初期化
  // 注入されたインスタンスがあればそれを使用し、なければ新規作成する
  const memoryManager = deps?.memoryManager ?? new MemoryManager();

  // ガベージコレクションジョブの初期化と開始 (5分間隔)
  const gcJob = new GarbageCollectionJob(memoryManager);
  gcJob.start();

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
          const content = args.content as string;
          if (!content) throw new Error('Missing required parameter: content');
          
          const metadata = (args.metadata as any) || {};
          
          // memoryTypeの処理
          let memoryType: MemoryType | undefined;
          if (metadata.memoryType) {
            memoryType = metadata.memoryType as MemoryType;
            // metadataからは削除しておく（MemoryManagerが一元管理するため）
            delete metadata.memoryType;
          }

          const result = await memoryManager.storeMemory({
            content,
            metadata,
            memoryType,
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
          const query = args.query as string; 
          const filters = (args.filters as any) || {};

          const results = await memoryManager.searchMemories({
            tags: filters.tags,
            memoryTypes: filters.memoryTypes,
            limit: filters.limit,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
          };
        }

        case 'delete_memory': {
          // 記憶削除ツール
          const id = args.id as string;
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
          const id = args.id as string;
          if (!id) throw new Error('Missing required parameter: id');

          const updates: any = {};
          if (args.content) updates.content = args.content;
          if (args.metadata) updates.metadata = args.metadata;

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
          const memoryId = args.memoryId as string;
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
          const memoryIds = args.memoryIds as string[];
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

  return server;
}

export async function main(): Promise<void> {
  const server = createContextStoreServer();

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
