/**
 * Memory domain types and interfaces
 * Based on design.md Memory Manager specification
 */

// Memory type classification
export type MemoryType = 'episodic' | 'semantic' | 'procedural';

// Unique identifier for memories
export type MemoryId = string; // UUID format

// Memory error types
export type MemoryError =
  | { type: 'STORAGE_ERROR'; message: string }
  | { type: 'INVALID_CONTENT'; message: string }
  | { type: 'MEMORY_NOT_FOUND'; message: string }
  | { type: 'QUOTA_EXCEEDED'; message: string };

// Result type for operations that can fail
export type Result<T, E> = { success: true; value: T } | { success: false; error: E };

// Memory metadata structure
// Note: memoryType is stored at top-level Memory.memoryType, not in metadata
// to maintain single source of truth and prevent drift
export interface MemoryMetadata {
  source?: string;
  timestamp?: Date;
  tags?: string[];
  userId?: string;
  projectId?: string;
}

// Complete memory entity
export interface Memory {
  id: MemoryId;
  content: string;
  memoryType: MemoryType;
  metadata: MemoryMetadata;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
  importanceScore: number;
  isDeleted: boolean;
  isProtected: boolean;
  deletedAt?: Date | null; // Timestamp when soft-deleted (GDPR compliance)
  version: number; // Version number (starts at 1)
}

// Memory history entry (snapshot of previous version)
export interface MemoryHistoryEntry {
  id: string; // UUID for history entry
  memoryId: MemoryId;
  version: number;
  content: string;
  metadata: MemoryMetadata;
  timestamp: Date; // When this version was archived (updatedAt of the memory at that time)
}

// Parameters for storing a new memory
export interface StoreMemoryParams {
  content: string;
  memoryType?: MemoryType; // Optional, defaults to 'semantic'
  metadata?: MemoryMetadata;
}

// Parameters for updating an existing memory
// Excludes immutable fields (id, createdAt) and system-managed fields
// (updatedAt, lastAccessedAt, accessCount, version) to prevent modification
export type UpdateMemoryParams = Partial<
  Pick<
    Memory,
    | 'content'
    | 'memoryType'
    | 'metadata'
    | 'importanceScore'
    | 'isDeleted'
    | 'isProtected'
    | 'deletedAt'
  >
>;

// Memory Manager service interface
export interface MemoryManagerService {
  storeMemory(params: StoreMemoryParams): Promise<Result<MemoryId, MemoryError>>;
  updateMemory(id: MemoryId, updates: UpdateMemoryParams): Promise<Result<boolean, MemoryError>>;
  deleteMemory(id: MemoryId): Promise<Result<boolean, MemoryError>>;
  mergeMemories(ids: MemoryId[]): Promise<Result<MemoryId, MemoryError>>;
  getMemoryHistory(id: MemoryId): Promise<MemoryHistoryEntry[]>;

  // Similarity search (Requirements: 1.3 - 類似記憶の自動検出)
  findSimilarMemories(content: string, limit?: number): Promise<Memory[]>;

  // Memory management operations
  performGarbageCollection(): Promise<void>;
  optimizeStorage(): Promise<void>;

  // Memory link operations (Requirements: 3.5 - タイプ間リンクの生成と維持)
  createLink(
    from: MemoryId,
    to: MemoryId,
    linkType: MemoryLinkType,
    strength?: number,
    createdBy?: 'user' | 'system',
    reasoning?: string
  ): Promise<Result<string, MemoryError>>; // Returns linkId
  getLinks(memoryId: MemoryId): Promise<MemoryLink[]>;
  deleteLink(linkId: string): Promise<Result<boolean, MemoryError>>;

  // Search with type filtering (Requirements: 3.6 - タイプフィルタリング機能)
  searchMemories(params: SearchParams): Promise<Memory[]>;

  // User override memory type (Requirements: 3.4 design.md 決定2)
  overrideMemoryType(
    memoryId: MemoryId,
    newType: MemoryType
  ): Promise<Result<boolean, MemoryError>>;

  // Get all memory IDs for reconciliation (Requirements: 5.4 - 整合性監視)
  getAllMemoryIds(): Promise<MemoryId[]>;
}

// Memory Classification types (Requirements: 3.4)
export interface MemoryClassification {
  primaryType: MemoryType;
  confidence: number; // 0.0 - 1.0
  suggestedTypes: Array<{
    type: MemoryType;
    confidence: number;
  }>;
  features: {
    ruleBasedScore: number;
    embeddingScore: number;
    detectedKeywords: string[];
  };
}

// Labeled sample for training/evaluation
export interface LabeledSample {
  content: string;
  trueType: MemoryType;
}

// Training sample with additional metadata
export interface TrainingSample extends LabeledSample {
  metadata?: Record<string, unknown>;
}

// Accuracy metrics for classifier evaluation
export interface AccuracyMetrics {
  overall: number; // Overall accuracy
  perType: Record<MemoryType, number>; // Per-type accuracy
  confusionMatrix: number[][]; // Confusion matrix
}

// Classification statistics
export interface ClassificationStats {
  totalClassified: number;
  userOverrideRate: number; // User override rate (not implemented yet)
  averageConfidence: number;
  lowConfidenceCount: number;
}

// Memory Classifier service interface (Requirements: 3.1, 3.2, 3.3, 3.4)
export interface MemoryClassifierService {
  classifyContent(content: string): Promise<MemoryClassification>;
  getConfidenceScore(content: string, type: MemoryType): Promise<number>;
  trainClassifier(samples: TrainingSample[]): Promise<void>;

  // Accuracy measurement
  evaluateAccuracy(testSamples: LabeledSample[]): Promise<AccuracyMetrics>;
  getClassificationStats(): Promise<ClassificationStats>;
}

// Memory Link types (Requirements: 3.5 - Cross-type relationships)
export type MemoryLinkType =
  | 'REFERENCES' // General reference
  | 'DERIVED_FROM' // Derivation relationship
  | 'CONTRADICTS' // Contradiction relationship
  | 'SUPPORTS' // Support relationship
  | 'PREREQUISITE' // Prerequisite condition
  | 'NEXT_STEP'; // Next step in sequence

export interface MemoryLink {
  linkId: string; // UUID
  fromMemoryId: MemoryId;
  toMemoryId: MemoryId;
  linkType: MemoryLinkType;
  strength: number; // 0.0 - 1.0
  metadata: {
    createdAt: Date;
    createdBy: 'user' | 'system';
    reasoning?: string;
  };
}

// Search parameters with type filtering (Requirements: 3.6)
export interface SearchParams {
  query?: string;
  memoryTypes?: MemoryType[]; // Filter by memory types
  tags?: string[];
  limit?: number;
  userId?: string;
  projectId?: string;
}
