import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createContextStoreServer } from '../../mcp/server.js';

// Mock Transport to capture messages
class MockTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  
  public sentMessages: JSONRPCMessage[] = [];

  async start(): Promise<void> {}

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
  let transport: MockTransport;

  beforeEach(async () => {
    server = createContextStoreServer();
    transport = new MockTransport();
    await server.connect(transport);
  });

  afterEach(async () => {
    await server.close();
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
    expect(result.tools).toHaveLength(4);
    
    const toolNames = result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('store_memory');
    expect(toolNames).toContain('search_memory');
    expect(toolNames).toContain('delete_memory');
    expect(toolNames).toContain('update_memory');
  });

  it('should list available resources', async () => {
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

    // Request resources list
    transport.receive({
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/list'
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const response = transport.sentMessages.find(m => (m as any).id === 2);
    expect(response).toBeDefined();
    const result = (response as any).result;
    expect(result.resources).toBeDefined();
    expect(result.resources).toHaveLength(2);
    
    const resourceNames = result.resources.map((r: any) => r.name);
    expect(resourceNames).toContain('memory_stats');
    expect(resourceNames).toContain('memory_types');
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
  });

  it('should handle store_memory tool call with metadata', async () => {
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
          content: 'test memory content',
          metadata: {
            source: 'user',
            tags: ['test']
          }
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const response = transport.sentMessages.find(m => (m as any).id === 2);
    expect(response).toBeDefined();
    expect((response as any).error).toBeUndefined();
    expect((response as any).result.content[0].text).toContain('successfully');
  });

  it('should handle search_memory tool call with filters', async () => {
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
        name: 'search_memory',
        arguments: {
          query: 'test query',
          filters: {
            limit: 5,
            tags: ['important']
          }
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const response = transport.sentMessages.find(m => (m as any).id === 2);
    expect(response).toBeDefined();
    expect((response as any).error).toBeUndefined();
    expect((response as any).result.content[0].text).toContain('Search results');
  });

  it('should return error for missing arguments in store_memory', async () => {
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

    // Call tool with missing content
    transport.receive({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'store_memory',
        arguments: {} // Missing content
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const response = transport.sentMessages.find(m => (m as any).id === 2);
    expect(response).toBeDefined();
    expect((response as any).error).toBeDefined();
    // Note: SDK might wrap the error, checking message
    expect((response as any).error.message).toContain('Missing required parameter');
  });

  it('should return error for unknown tool', async () => {
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

    // Call unknown tool
    transport.receive({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'unknown_tool',
        arguments: {}
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const response = transport.sentMessages.find(m => (m as any).id === 2);
    expect(response).toBeDefined();
    expect((response as any).error).toBeDefined();
    expect((response as any).error.message).toContain('Unknown tool');
  });
});