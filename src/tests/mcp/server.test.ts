import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createContextStoreServer } from '../../mcp/server.js';
import { MemoryManager } from '../../memory/memory-manager.js';
import type { VectorStoreAdapter } from '../../storage/vector-store-adapter.js';
import { MockStorageAdapter, MockTransactionCoordinator, MockVectorStoreAdapter } from '../mocks/index.js';

// Mock Transport to capture messages
class MockTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  public sentMessages: JSONRPCMessage[] = [];

  async start(): Promise<void> { }

  async send(message: JSONRPCMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  async close(): Promise<void> {
    if (this.onclose) {
      this.onclose();
    }
  }

  // Helper to simulate incoming message
  receive(message: JSONRPCMessage) {
    if (this.onmessage) {
      this.onmessage(message);
    }
  }
}

describe('MCP Server Core Features', () => {
  let server: Server;
  let cleanup: () => Promise<void>;
  let transport: MockTransport;
  let mockVectorStore: VectorStoreAdapter;
  let mockStorage: MockStorageAdapter; // Declared globally
  let mockTransactionCoordinator: MockTransactionCoordinator; // Declared globally
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    // 環境変数を保存して、テスト用の値を設定
    originalEnv = { ...process.env };

    // EMBEDDING_PROVIDER が openai の場合、OPENAI_API_KEY が必要
    if (!process.env['OPENAI_API_KEY']) {
      process.env['OPENAI_API_KEY'] = 'test-api-key-for-testing-only';
    }
    mockVectorStore = new MockVectorStoreAdapter() as VectorStoreAdapter;

    mockStorage = new MockStorageAdapter(); // Initialized
    mockTransactionCoordinator = {
      storedVersions: new Map<string, any[]>(), // For saveMemoryVersion mock
      storeMemoryWithSaga: vi.fn().mockImplementation(async (entity) => {
        const memory = {
          id: entity.id,
          content: entity.content,
          memoryType: entity.memoryType,
          metadata: entity.metadata,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastAccessedAt: new Date(),
          accessCount: 0,
          importanceScore: 0,
          isDeleted: false,
          isProtected: false,
          version: 1,
          deletedAt: null
        };
        mockStorage.memories.set(entity.id, memory);
        return { status: 'ok', memoryId: entity.id };
      }),
      updateMemoryWithSaga: vi.fn().mockImplementation(async (entity) => {
        const existing = mockStorage.memories.get(entity.id);
        if (existing) {
          mockStorage.memories.set(entity.id, {
            ...existing,
            ...entity, // Apply all properties from entity
            version: (existing.version || 1) + 1,
            updatedAt: new Date()
          });
        }
        return { status: 'ok', memoryId: entity.id };
      }),
      deleteMemoryWithSaga: vi.fn().mockImplementation(async (id) => {
        const existing = mockStorage.memories.get(id);
        if (existing) {
          mockStorage.memories.set(id, { ...existing, isDeleted: true, deletedAt: new Date() });
        }
        return { status: 'ok', memoryId: id };
      }),
      saveMemoryVersion: vi.fn().mockImplementation(async (memoryData, versionNumber) => {
        const memoryId = memoryData.id;
        const currentVersions = mockTransactionCoordinator.storedVersions.get(memoryId) || [];
        currentVersions.push({
          memoryId: memoryId,
          version: versionNumber,
          content: memoryData.content,
          metadata: memoryData.metadata,
          timestamp: new Date(),
          id: `history-${memoryId}-v${versionNumber}`
        });
        mockTransactionCoordinator.storedVersions.set(memoryId, currentVersions);
      }),
      getMemory: vi.fn().mockImplementation(async (id: string) => mockStorage.getMemory(id)),
      getMemoryVersions: vi.fn().mockImplementation(async (memoryId: string) => mockTransactionCoordinator.storedVersions.get(memoryId) || []),
      getMemoryVersion: vi.fn().mockImplementation(async (memoryId: string, version: number) => {
        const versions = mockTransactionCoordinator.storedVersions.get(memoryId);
        if (!versions) {
          return null;
        }
        return versions.find((entry: any) => entry.version === version) || null;
      }),
      findSoftDeletedMemories: vi.fn().mockResolvedValue([]),
      hardDeleteMemory: vi.fn().mockResolvedValue({ status: 'ok' }),
      deleteLowImportanceMemories: vi.fn().mockResolvedValue(0),
      getDatabaseSize: vi.fn().mockResolvedValue(0),
    } as any;

    // Inject mock VectorStore into MemoryManager, and inject manager into Server
    const memoryManager = new MemoryManager({
      storage: mockStorage,
      vectorStore: mockVectorStore,
      transactionCoordinator: mockTransactionCoordinator as unknown as any // Pass the initialized mock
    });
    const context = createContextStoreServer({ memoryManager });
    server = context.server;
    cleanup = context.cleanup;

    transport = new MockTransport();
    await server.connect(transport);
  });

  afterEach(async () => {
    await cleanup();
    // 環境変数を元に戻す
    process.env = originalEnv;
  });

  it('should handle initialization handshake', async () => {
    // Simulate initialize request
    transport.receive({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    });

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 10));

    const response = transport.sentMessages.find(m => (m as any).id === 1);
    expect(response).toBeDefined();
    expect((response as any).result).toBeDefined();
    expect((response as any).result.serverInfo.name).toBe('context-store-mcp');
  });

  it('should list available tools', async () => {
    // Initialize first
    transport.receive({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    transport.receive({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });

    // Request tools list
    transport.receive({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const response = transport.sentMessages.find(m => (m as any).id === 2);
    expect(response).toBeDefined();
    const result = (response as any).result;
    expect(result.tools).toBeDefined();

    // Current tools: store, search, delete, update, suggest_memory_merges, merge_memories (6 tools)
    expect(result.tools).toHaveLength(6);

    const toolNames = result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('store_memory');
    expect(toolNames).toContain('search_memory');
    expect(toolNames).toContain('delete_memory');
    expect(toolNames).toContain('update_memory');
    expect(toolNames).toContain('suggest_memory_merges');
    expect(toolNames).toContain('merge_memories');
  });

  it('should handle store_memory tool call', async () => {
    // Initialize
    transport.receive({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    transport.receive({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });

    // Call tool
    transport.receive({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'store_memory',
        arguments: {
          content: 'test memory content'
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const response = transport.sentMessages.find(m => (m as any).id === 2);
    expect(response).toBeDefined();
    expect((response as any).error).toBeUndefined();
    expect((response as any).result.content[0].text).toContain('successfully');
    expect((response as any).result.content[0].text).toContain('ID:');
  });

  it('should suggest merges for similar memories', async () => {
    // Initialize
    transport.receive({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    transport.receive({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });

    // 1. Store Memory A
    transport.receive({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'store_memory',
        arguments: {
          content: 'Project Alpha kickoff meeting notes.',
          metadata: { tags: ['project-alpha', 'meeting'] }
        }
      }
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    const res1 = transport.sentMessages.find(m => (m as any).id === 2);
    const id1 = (res1 as any).result.content[0].text.match(/ID: ([a-f0-9-]+)/)[1];

    // 2. Store Memory B (Similar)
    transport.receive({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'store_memory',
        arguments: {
          content: 'Minutes from Project Alpha kickoff.',
          metadata: { tags: ['project-alpha', 'meeting'] }
        }
      }
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    const res2 = transport.sentMessages.find(m => (m as any).id === 3);
    const id2 = (res2 as any).result.content[0].text.match(/ID: ([a-f0-9-]+)/)[1];

    // Configure mock to return id2 as high similarity match
    (mockVectorStore.searchSimilar as any).mockResolvedValue([
      { id: id2, similarity: 0.95, content: 'Minutes from Project Alpha kickoff.', metadata: { tags: ['project-alpha', 'meeting'] } }
    ]);

    // 3. Suggest Merges for A
    transport.receive({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'suggest_memory_merges',
        arguments: {
          memoryId: id1
        }
      }
    });
    await new Promise(resolve => setTimeout(resolve, 10));

    const res3 = transport.sentMessages.find(m => (m as any).id === 4);
    expect(res3).toBeDefined();

    const outputText = (res3 as any).result.content[0].text;

    // Deterministic assertion: must contain the suggested ID
    expect(outputText).toContain(id2);
  });

  it('should merge memories successfully', async () => {
    // Initialize
    transport.receive({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    transport.receive({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });

    // 1. Store Memory A
    transport.receive({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'store_memory',
        arguments: { content: 'Memory Part 1' }
      }
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    const id1 = (transport.sentMessages.find(m => (m as any).id === 2) as any).result.content[0].text.match(/ID: ([a-f0-9-]+)/)[1];

    // 2. Store Memory B
    transport.receive({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'store_memory',
        arguments: { content: 'Memory Part 2' }
      }
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    const id2 = (transport.sentMessages.find(m => (m as any).id === 3) as any).result.content[0].text.match(/ID: ([a-f0-9-]+)/)[1];

    // 3. Merge A and B
    transport.receive({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'merge_memories',
        arguments: {
          memoryIds: [id1, id2]
        }
      }
    });
    await new Promise(resolve => setTimeout(resolve, 10));

    const res4 = transport.sentMessages.find(m => (m as any).id === 4);
    expect(res4).toBeDefined();
    expect((res4 as any).result.content[0].text).toContain('merged successfully');

    // 4. Verify original memories are deleted
    transport.receive({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'search_memory', // search doesn't return deleted
        arguments: { query: 'Memory Part 1' }
      }
    });
    await new Promise(resolve => setTimeout(resolve, 10));

    const res5 = transport.sentMessages.find(m => (m as any).id === 5);
    expect(res5).toBeDefined();
    const searchResult = JSON.parse((res5 as any).result.content[0].text);

    // Should find the merged memory
    expect(searchResult.length).toBeGreaterThan(0);

    // Should NOT find original IDs
    const foundIds = searchResult.map((m: any) => m.id);
    expect(foundIds).not.toContain(id1);
    expect(foundIds).not.toContain(id2);
  });
});