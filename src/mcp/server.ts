/**
 * MCP Server Entry Point
 * MCPサーバーのメインエントリーポイント
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export async function main(): Promise<void> {
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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Context Store MCP Server started');
}

// 直接実行時のエントリーポイント
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
