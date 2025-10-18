/**
 * MCP Server Entry Point
 * MCPサーバーのメインエントリーポイント
 */

<<<<<<< HEAD
import { fileURLToPath } from 'node:url';
=======
import { fileURLToPath } from 'url';
import { resolve } from 'path';
>>>>>>> feature/phase1__project-foundation
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
<<<<<<< HEAD
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
=======
// Windows互換性のため、import.meta.urlをファイルシステムパスに変換して比較
const currentFilePath = fileURLToPath(import.meta.url);
const executedFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFilePath === executedFilePath) {
>>>>>>> feature/phase1__project-foundation
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
