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

/**
 * MCPサーバーインスタンスを作成して設定する
 */
export function createContextStoreServer(): Server {
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
        // 記憶保存ツール - コンテンツを保存
        if (!('content' in args)) {
          throw new Error('Missing required parameter: content');
        }
        // args.metadata is optional
        return {
          content: [{ type: 'text', text: 'Memory stored successfully' }],
        };
      }

      case 'search_memory': {
        // 記憶検索ツール - クエリで検索
        if (!('query' in args)) {
          throw new Error('Missing required parameter: query');
        }
        // args.filters is optional
        return {
          content: [{ type: 'text', text: 'Search results' }],
        };
      }

      case 'delete_memory': {
        // 記憶削除ツール - IDで削除
        if (!('id' in args)) {
          throw new Error('Missing required parameter: id');
        }
        return {
          content: [{ type: 'text', text: 'Memory deleted successfully' }],
        };
      }

      case 'update_memory': {
        // 記憶更新ツール - IDとコンテンツで更新
        if (!('id' in args)) {
          throw new Error('Missing required parameter: id');
        }
        if (!('content' in args)) {
          throw new Error('Missing required parameter: content');
        }
        return {
          content: [{ type: 'text', text: 'Memory updated successfully' }],
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
