# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Context Store MCP is an **MCP-based long-term memory system for AI agents**. It provides persistent memory capabilities across sessions with intelligent search using vector similarity (PostgreSQL + pgvector) and graph traversal (Neo4j).

**Core Features:**
- Multi-type memory classification (episodic, semantic, procedural)
- Hybrid search combining semantic similarity and structural relationships
- MCP standard compliance for universal AI agent compatibility
- High-performance storage with PostgreSQL, Neo4j, and Redis

## Common Commands

### Development
```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Development mode with watch
npm run dev

# Start production server
npm start
```

### Testing
```bash
# Run all tests
npm test

# Run specific test file
npm test src/tests/mcp/lru-cache.test.ts

# Coverage report
npm run test:coverage
```

### Code Quality
```bash
# Type checking (no emit)
npm run typecheck

# Lint check
npm run lint

# Lint with auto-fix
npm run lint:fix

# Format code
npm run format

# Format check only
npm run format:check
```

### Database & Environment
```bash
# Start infrastructure (PostgreSQL + pgvector, Neo4j, Redis)
docker-compose up -d

# Environment setup
cp .env.example .env
# Edit .env with your configuration
```

## Architecture

### High-Level Design

**MCP Layer** → **Memory Manager** → **Storage Layer (PostgreSQL + Neo4j + Redis)**

- **MCP Server** (`src/mcp/server.ts`): MCP protocol implementation, tools and resources API
- **Memory Manager**: Orchestrates storage, retrieval, and classification
- **Memory Type Classifier**: Auto-classifies content into episodic/semantic/procedural
- **Query Processor**: Executes hybrid search (vector + graph)
- **Storage Adapters**:
  - PostgreSQL + pgvector for vector embeddings
  - Neo4j for relationship graphs
  - Redis for caching

### Key Design Patterns

**Hybrid Storage with Single Source of Truth:**
- PostgreSQL is the **master database** (memories, content, vectors)
- Neo4j is **secondary** (stores only relationships and node IDs)
- Data consistency via Saga pattern with compensating transactions
- Eventual consistency between stores (max 5min lag, reconciled daily)

**Error Handling:**
- Exponential backoff retry (100ms → 30s, max 3 attempts)
- Circuit breaker pattern for DB connections (5 failures → open circuit)
- Graceful degradation (read-only mode on Neo4j failure)

**Performance Optimizations:**
- LRU cache for hot contexts (`src/mcp/lru-cache.ts`)
- Rate limiting to prevent overload
- Timeout controller with P95 < 2s target
- Lazy loading and async background processing

### Memory Types

**Episodic Memory**: Event-based memories with timestamps (conversations, decisions)
**Semantic Memory**: Knowledge and facts (specifications, definitions, concepts)
**Procedural Memory**: How-to knowledge with dependencies (implementation steps, workflows)

Classification is **automatic** via content analysis (keywords, syntax, embeddings) with 70%+ target accuracy.

### Search Mechanics

**Semantic Search** (PostgreSQL + pgvector):
- Generates embeddings via OpenAI API (text-embedding-3-small, 1536D)
- Cosine similarity with threshold ≥ 0.7
- HNSW index for fast approximate nearest neighbor search

**Graph Search** (Neo4j):
- Relationship types: REFERENCES, DERIVED_FROM, CONTRADICTS, SUPPORTS, PREREQUISITE, NEXT_STEP
- Cypher pattern matching for structural queries
- PageRank/centrality for importance scoring

**Hybrid Search**:
- Final score = 0.7 × semantic_score + 0.3 × structural_score
- Weights configurable per query
- Results merged and ranked by combined score

**A/B Testing & Statistical Validation**:
- Welch's t-test for statistical significance (unequal variance support)
- Regularized incomplete beta function via Lentz's continued fraction expansion
- Log-gamma function via Lanczos approximation
- **Sample size requirements**:
  - Minimum: n ≥ 2 queries (enforced)
  - Recommended: n ≥ 30 queries for reliable p-values
  - Warning issued for n < 30 (t-distribution approximation accuracy degrades)
- **Limitations**:
  - Small sample (n < 30): Normal distribution assumption may not hold
  - P-value approximation: Uses erf-based CDF (not exact)
  - Production use: Consider external libraries (jstat, simple-statistics) for rigorous testing
- See `src/query/search-quality-evaluator.ts:368-408` for implementation details

### Test Database Safety

**Critical**: Tests use `context_store_test` database by default to prevent production data corruption.

Safety checks in test setup:
1. Rejects production DB name (`context_store`)
2. Requires "test" in database name (case-insensitive)
3. Enforces explicit `POSTGRES_DB` in CI environments

Never set `POSTGRES_DB=context_store` when running tests.

## File Structure

```
src/
├── index.ts                   # Main entry point
├── mcp/                       # MCP server implementation
│   ├── server.ts             # MCP protocol handler
│   ├── lru-cache.ts          # O(1) LRU cache with TTL
│   ├── rate-limiter.ts       # Request rate limiting
│   ├── circuit-breaker.ts    # Failure protection
│   ├── timeout-controller.ts # Timeout management
│   ├── performance-metrics.ts# Metrics collection
│   └── errors.ts             # Error types & handlers
└── tests/                     # Test suite
    ├── mcp/                  # MCP layer tests
    └── database/             # Database tests

.kiro/                         # Kiro spec-driven development
├── steering/                 # Project-wide guidelines
│   ├── product.md           # Product context
│   ├── tech.md              # Tech stack decisions
│   └── structure.md         # Code organization
└── specs/                    # Feature specifications
    └── context-store-mcp/
        ├── spec.json        # Metadata and status
        ├── requirements.md  # Requirements doc
        ├── design.md        # Technical design
        └── tasks.md         # Implementation tasks
```

## Kiro Spec-Driven Development Workflow

This project follows **Kiro-style specification-driven development**:

### Phase 1: Specification
1. `/kiro:spec-init [description]` - Initialize feature spec
2. `/kiro:spec-requirements [feature]` - Generate requirements
3. `/kiro:spec-design [feature]` - Create technical design
4. `/kiro:spec-tasks [feature]` - Generate implementation tasks

### Phase 2: Implementation
- `/kiro:spec-impl [feature] [task-number]` - Execute task with TDD
- `/kiro:spec-status [feature]` - Check progress

### Branch Strategy
- **Phase branches**: `feature/phaseX__description`
- **Task branches**: `feature/phaseX-taskY__description`
- Always branch from **previous task branch**, not master (prevents regressions)

Example:
```bash
# Phase 1 start
git checkout -b feature/phase1__project-foundation

# Task 1
git checkout -b feature/phase1-task1__setup-project
/kiro:spec-impl context-store-mcp 1.1
# ... implement, test, commit ...

# Task 2 (branch from task 1!)
git checkout -b feature/phase1-task2__docker-setup
/kiro:spec-impl context-store-mcp 1.2
```

### Task Completion Checklist
- [ ] Update `.kiro/specs/[feature]/spec.json`
- [ ] Update `.kiro/specs/[feature]/tasks.md` (mark completed)
- [ ] Run `coderabbit --prompt-only` for review
- [ ] New branch created from **previous task branch**
- [ ] Commit message format: `feat(taskX): description`

## Important Notes

### TypeScript Configuration
- **Strict mode enabled** with comprehensive type checking
- Path alias: `@/*` → `src/*`
- Target: ES2022, ESM modules
- Output: `dist/` with source maps and declarations

### Data Consistency
When modifying storage logic:
1. PostgreSQL changes first (it's the source of truth)
2. Neo4j sync can fail gracefully (reconciled by background worker)
3. Use transactions within PostgreSQL, Saga pattern across stores
4. Check `sync_failures` table for cross-DB consistency issues

### Performance Targets
- Search latency P95 < 2s
- Throughput 1000 req/sec
- Availability 99.9% SLA
- LRU cache O(1) operations

### Security
- Encryption at rest (PostgreSQL TDE)
- TLS 1.3 for transport
- GDPR-compliant deletion (soft → hard delete with audit trail)
- Audit logs tamper-evident (Merkle tree hashes)

## Current Development Status

**Phase**: Task 2.3 completed (LRU cache eviction)
**Branch**: `feature/phase2-task3__lru-cache-eviction`
**Next**: Task 3.1 - Memory management service implementation

Completed:
- ✅ Project foundation (1.1, 1.2, 1.3)
- ✅ Error handling & SLA compliance (2.2)
- ✅ LRU cache with O(1) performance (2.3)

Pending:
- ⏳ MCP server core implementation (2.1)
- ⏳ Memory management service (3.1+)
- ⏳ Vector & graph search (5.1+, 6.1+)
