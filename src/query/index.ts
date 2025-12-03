/**
 * Query Module Exports
 */

export { QueryProcessor } from './query-processor.js';
export { LiteModeQueryProcessor } from './lite-mode-query-processor.js';
export type {
  SearchQuery,
  SearchFilters,
  TimeFilter,
  RelativeTimeValue,
  ParsedQuery,
  QueryIntent,
  TimeRange,
  MetadataFilter,
  QueryPlan,
  SearchStrategy,
  QueryStep,
  QueryStepType,
  OptimizedQueryPlan,
  QueryResult,
  QueryError,
  HybridSearchOptions,
  HybridSearchResult,
  CacheableQuery,
  CacheStats,
  SearchEvaluationDataset,
  SearchQualityMetrics,
  AnnotationTask,
  RelevanceFeedback,
  SearchVariant,
  ABTestResult,
  SearchLogEntry,
  UserFeedbackLog,
} from './types.js';
export type {
  SearchWeights,
  SearchContext,
  ExtendedSearchResult,
} from './lite-mode-query-processor.js';
