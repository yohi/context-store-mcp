/**
 * Embedding module exports
 */

export { EmbeddingService } from './embedding-service.js';
export { OpenAIEmbeddingProvider } from './openai-embedding-provider.js';
export { LocalCLIEmbeddingProvider } from './local-cli-embedding-provider.js';
export { CustomAPIEmbeddingProvider } from './custom-api-embedding-provider.js';
export type { EmbeddingProvider, EmbeddingProviderConfig } from './types.js';
