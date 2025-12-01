import { vi } from 'vitest';
import { randomUUID } from 'crypto';

let inMemoryNodes: Map<string, any>; // Shared state for the mock
let inMemoryRelationships: Map<string, any>;

export const resetNeo4jMockState = () => {
  inMemoryNodes = new Map<string, any>();
  inMemoryRelationships = new Map<string, any>();
  console.log('--- Neo4j Mock State Reset ---'); // Keep commented for now
};

resetNeo4jMockState(); // Initial reset when the mock module is first loaded

const mockDriverInstance = {
  session: vi.fn().mockImplementation(() => {
    const mockSession = {
              run: vi.fn().mockImplementation((query, params) => {
                console.log('Mock Session Run:', { query, params, inMemoryNodesSize: inMemoryNodes.size }); // Keep commented for now
                            // Simulate OPTIONAL MATCH existence check query
                            if (query.includes('OPTIONAL MATCH (a {id: $from})') && query.includes('RETURN a IS NOT NULL AS fromExists, b IS NOT NULL AS toExists')) {
                                                
                                                      // Construct keys for the record
                                                
                                                      const keys = ['fromExists', 'toExists'];
                                                
                                                      // Construct fields for the record
                                                
                                                      const fields = [fromExists, toExists];
                                                
                                          
                                                
                                                      const mockRecord = {
                                                
                                                        keys: keys,
                                                
                                                        length: fields.length, // Required by some internal checks in neo4j-driver
                                                
                                                        _fields: fields,       // Directly store fields, similar to real driver Record
                                                
                                                        get: vi.fn().mockImplementation((key) => {
                                                
                                                          const index = keys.indexOf(key);
                                                
                                                          if (index !== -1) {
                                                
                                                            return fields[index];
                                                
                                                          }
                                                
                                                          return undefined;
                                                
                                                        }),
                                                
                                                        toObject: vi.fn().mockImplementation(() => {
                                                
                                                          const obj = {};
                                                
                                                          keys.forEach((k, idx) => { obj[k] = fields[idx]; });
                                                
                                                          return obj;
                                                
                                                        })
                                                
                                                      };                              return Promise.resolve({ records: [mockRecord] });
                            }          const mockRecord = {
            get: (key) => {
              if (key === 'fromExists') return fromExists;
              if (key === 'toExists') return toExists;
              return undefined;
            }
          };
          return Promise.resolve({ records: [mockRecord] });
        }

        // Simulate Node Creation Query: CREATE (n:Label $props) RETURN n.id AS id
        if (query.includes('CREATE (n') && query.includes('$props)') && query.includes('RETURN n.id AS id')) {
          const nodeId = params.props.id; // Access id from props
                      inMemoryNodes.set(nodeId, params.props);
          return Promise.resolve({ records: [{ get: (key) => (key === 'id' ? nodeId : undefined) }] });
        }

        // Simulate Relationship Creation Query: MATCH (a {id: $fromId}), (b {id: $toId}) CREATE (a)-[r:$type]->(b) SET r = $props, r.edgeId = $edgeId RETURN r
        if (query.includes('CREATE (a)-[r') && query.includes('SET r = $props, r.edgeId = $edgeId') && query.includes('RETURN r')) {
          const relId = params.edgeId; // Use edgeId from params as it's generated by the adapter
          const fromNodeId = params.from;
          const toNodeId = params.to;
          const relType = params.type;
          const properties = params.props;
                      inMemoryRelationships.set(relId, { id: relId, from: fromNodeId, to: toNodeId, type: relType, properties });
                    // Simulate Neo4j record structure for RETURN r
          return Promise.resolve({ records: [{ get: (key) => (key === 'r' ? { elementId: relId, properties: properties, type: relType } : undefined) }] });
        }

        // Simulate Node Existence Check Query: MATCH (n {id: $id}) RETURN n
        if (query.includes('MATCH (n {id: $id}) RETURN n')) {
          const nodeId = params.id;
          if (inMemoryNodes.has(nodeId)) {
            const nodeProps = inMemoryNodes.get(nodeId);
            return Promise.resolve({
              records: [{ get: (key) => (key === 'n' ? { properties: nodeProps } : undefined) }]
            });
          }
          return Promise.resolve({ records: [] });
        }

        // Simulate Relationship Retrieval Query: MATCH (n)-[r]-(m) WHERE id(n) = $id ... RETURN r, type(r) AS relType, id(r) AS relId, startNode(r) AS startNode, endNode(r) AS endNode
        if (query.includes('RETURN r, type(r) AS relType')) {
          const searchNodeId = params.id;
          const direction = params.direction || 'both'; // Assume 'both' if not specified

          const results = Array.from(inMemoryRelationships.values()).filter(rel => {
            if (direction === 'outgoing') return rel.from === searchNodeId;
            if (direction === 'incoming') return rel.to === searchNodeId;
            return rel.from === searchNodeId || rel.to === searchNodeId;
          }).map(rel => ({
            get: (key) => {
              if (key === 'r') return { elementId: rel.id, properties: rel.properties };
              if (key === 'relType') return rel.type;
              if (key === 'relId') return rel.id;
              if (key === 'startNode') return { elementId: rel.from };
              if (key === 'endNode') return { elementId: rel.to };
              return undefined;
            },
            _fields: [
              { elementId: rel.id, properties: rel.properties },
              rel.type,
              rel.id,
              { elementId: rel.from },
              { elementId: rel.to }
            ]
          }));
          return Promise.resolve({ records: results });
        }
        
        // Simulate DELETE queries for nodes (e.g., from GraphStoreAdapter.deleteNode)
        if (query.includes('DETACH DELETE')) {
            const nodeIdToDelete = params.id;
            const nodesBefore = inMemoryNodes.size;
            inMemoryNodes.delete(nodeIdToDelete);
            // Also delete relationships connected to this node
            inMemoryRelationships.forEach((rel, key) => {
                if (rel.from === nodeIdToDelete || rel.to === nodeIdToDelete) {
                    inMemoryRelationships.delete(key);
                }
            });
            return Promise.resolve({ records: [{ get: () => (nodesBefore - inMemoryNodes.size > 0 ? 1 : 0) }] });
        }


                  console.warn('Unhandled Cypher query in mockSession.run:', query, params);
                  return Promise.resolve({ records: [] });
                }),      close: vi.fn().mockResolvedValue(undefined),
      executeWrite: vi.fn().mockImplementation(async (cb) => {
        const txc = mockSession; // Pass mockSession as the TransactionContext
        const result = await cb(txc);
        return result;
      }),
      executeRead: vi.fn().mockImplementation(async (cb) => {
        const txc = mockSession; // Pass mockSession as the TransactionContext
        const result = await cb(txc);
        return result;
      }),
    };
    return mockSession;
  }),
  close: vi.fn().mockResolvedValue(undefined),
  verifyConnectivity: vi.fn().mockResolvedValue(undefined),
};

export default {
  driver: vi.fn().mockReturnValue(mockDriverInstance),
  auth: { basic: vi.fn() },
};