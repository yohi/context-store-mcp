/**
 * 記憶ドメインの型定義とインターフェース
 * design.mdのMemory Manager仕様に基づく
 */

// 記憶タイプの分類
export type MemoryType = 'episodic' | 'semantic' | 'procedural';

// 記憶の一意な識別子
export type MemoryId = string; // UUID形式

// 記憶エラーの型
export type MemoryError =
  | { type: 'STORAGE_ERROR'; message: string }
  | { type: 'INVALID_CONTENT'; message: string }
  | { type: 'MEMORY_NOT_FOUND'; message: string }
  | { type: 'QUOTA_EXCEEDED'; message: string };

// 失敗する可能性のある操作の結果型
export type Result<T, E> = { success: true; value: T } | { success: false; error: E };

// 記憶メタデータ構造
// 注意: memoryTypeはmetadataではなく、トップレベルのMemory.memoryTypeに格納されます。
// これは単一の信頼できる情報源（SSOT）を維持し、不整合を防ぐためです。
export interface MemoryMetadata {
  source?: string;
  timestamp?: Date;
  tags?: string[];
  userId?: string;
  projectId?: string;
}

// 完全な記憶エンティティ
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
  deletedAt?: Date | null; // 論理削除されたタイムスタンプ（GDPR準拠）
  version: number; // バージョン番号（1から開始）
}

// 記憶履歴エントリ（以前のバージョンのスナップショット）
export interface MemoryHistoryEntry {
  id: string; // 履歴エントリのUUID
  memoryId: MemoryId;
  version: number;
  content: string;
  metadata: MemoryMetadata;
  timestamp: Date; // このバージョンがアーカイブされた日時（その時点での記憶のupdatedAt）
}

// 新しい記憶を保存するためのパラメータ
export interface StoreMemoryParams {
  content: string;
  memoryType?: MemoryType; // オプション、デフォルトは 'semantic'
  metadata?: MemoryMetadata;
}

// 既存の記憶を更新するためのパラメータ
// 不変フィールド（id, createdAt）とシステム管理フィールド
// （updatedAt, lastAccessedAt, accessCount, version）を除外し、変更を防止します
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

// Memory Managerサービスインターフェース
export interface MemoryManagerService {
  storeMemory(params: StoreMemoryParams): Promise<Result<MemoryId, MemoryError>>;
  updateMemory(id: MemoryId, updates: UpdateMemoryParams): Promise<Result<boolean, MemoryError>>;
  deleteMemory(id: MemoryId): Promise<Result<boolean, MemoryError>>;
  mergeMemories(ids: MemoryId[]): Promise<Result<MemoryId, MemoryError>>;
  getMemoryHistory(id: MemoryId): Promise<MemoryHistoryEntry[]>;
  revertToVersion(memoryId: MemoryId, version: number): Promise<Result<boolean, MemoryError>>;

  // 類似検索（要件: 1.3 - 類似記憶の自動検出）
  findSimilarMemories(content: string, limit?: number): Promise<Memory[]>;
  suggestMerges(memoryId: MemoryId): Promise<Memory[]>;

  // 記憶管理操作
  performGarbageCollection(): Promise<void>;
  optimizeStorage(): Promise<void>;

  // 記憶リンク操作（要件: 3.5 - タイプ間リンクの生成と維持）
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

  // タイプフィルタリング付き検索（要件: 3.6 - タイプフィルタリング機能）
  searchMemories(params: SearchParams): Promise<Memory[]>;

  // ユーザーによる記憶タイプの上書き（要件: 3.4 design.md 決定2）
  overrideMemoryType(
    memoryId: MemoryId,
    newType: MemoryType
  ): Promise<Result<boolean, MemoryError>>;

  // 整合性調整のためにすべての記憶IDを取得（要件: 5.4 - 整合性監視）
  getAllMemoryIds(): Promise<MemoryId[]>;
}

// 記憶分類タイプ（要件: 3.4）
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

// 学習/評価用のラベル付きサンプル
export interface LabeledSample {
  content: string;
  trueType: MemoryType;
}

// 追加メタデータ付きの学習サンプル
export interface TrainingSample extends LabeledSample {
  metadata?: Record<string, unknown>;
}

// 分類器評価のための精度メトリクス
export interface AccuracyMetrics {
  overall: number; // 全体的な精度
  perType: Record<MemoryType, number>; // タイプごとの精度
  confusionMatrix: number[][]; // 混同行列
}

// 分類統計
export interface ClassificationStats {
  totalClassified: number;
  userOverrideRate: number; // ユーザー上書き率（未実装）
  averageConfidence: number;
  lowConfidenceCount: number;
}

// Memory Classifierサービスインターフェース（要件: 3.1, 3.2, 3.3, 3.4）
export interface MemoryClassifierService {
  classifyContent(content: string): Promise<MemoryClassification>;
  getConfidenceScore(content: string, type: MemoryType): Promise<number>;
  trainClassifier(samples: TrainingSample[]): Promise<void>;

  // 精度測定
  evaluateAccuracy(testSamples: LabeledSample[]): Promise<AccuracyMetrics>;
  getClassificationStats(): Promise<ClassificationStats>;
}

// 記憶リンクタイプ（要件: 3.5 - タイプ間の関係）
export type MemoryLinkType =
  | 'REFERENCES' // 一般的な参照
  | 'DERIVED_FROM' // 派生関係
  | 'CONTRADICTS' // 矛盾関係
  | 'SUPPORTS' // 支持関係
  | 'PREREQUISITE' // 前提条件
  | 'NEXT_STEP'; // シーケンスの次のステップ

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

// タイプフィルタリング付き検索パラメータ（要件: 3.6）
export interface SearchParams {
  query?: string;
  memoryTypes?: MemoryType[]; // 記憶タイプでフィルタリング
  tags?: string[];
  limit?: number;
  userId?: string;
  projectId?: string;
}
