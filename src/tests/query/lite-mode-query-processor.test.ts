import { describe, test, expect, beforeEach, vi } from 'vitest';
import { LiteModeQueryProcessor } from '../../query/lite-mode-query-processor';
import type { Memory } from '../../memory/types';

describe('LiteModeQueryProcessor', () => {
  let processor: LiteModeQueryProcessor;
  let mockHybridSearch: any;

  beforeEach(() => {
    processor = new LiteModeQueryProcessor();
    
    // Mock hybridSearch
    mockHybridSearch = vi.fn();
    
    // Spy on hybridSearch to inject mock
    vi.spyOn(processor as any, 'hybridSearch').mockImplementation(mockHybridSearch);
  });

  test('searchByFilePath should use strict matching', async () => {
    // We access the private method via any cast to test its logic directly
    const searchByFilePath = (processor as any).searchByFilePath.bind(processor);
    
    // Setup mock response for hybridSearch(filePath)
    mockHybridSearch.mockResolvedValue([
        {
            memory: { id: '1', metadata: { lite_mode_metadata: { filePath: 'src/target.ts' } } },
            scores: { combined: 1 }
        },
        {
            memory: { id: '2', metadata: { lite_mode_metadata: { filePath: 'src/target.ts/child' } } },
            scores: { combined: 1 }
        },
        {
            memory: { id: '3', metadata: { lite_mode_metadata: { filePath: 'src/target.ts_extra' } } },
            scores: { combined: 1 }
        },
        {
            memory: { id: '4', metadata: { lite_mode_metadata: { filePath: 'src/target_other.ts' } } },
            scores: { combined: 1 }
        },
        {
            memory: { id: '5', metadata: { lite_mode_metadata: { filePath: 'src/target/other.ts' } } },
             scores: { combined: 1 }
        }
    ]);

    // Test with exact file path
    const filteredMemories = await searchByFilePath('src/target.ts', 10);
    
    const ids = filteredMemories.map((m: Memory) => m.id);
    
    // Expectations based on strict matching:
    expect(ids).toContain('1'); // Exact match: 'src/target.ts' === 'src/target.ts'
    expect(ids).toContain('2'); // Child path: 'src/target.ts/child'.startsWith('src/target.ts/') -> true
    
    // Should exclude:
    expect(ids).not.toContain('3'); // 'src/target.ts_extra'.startsWith('src/target.ts/') -> false
    expect(ids).not.toContain('4'); // 'src/target_other.ts'
    expect(ids).not.toContain('5'); // 'src/target/other.ts'.startsWith('src/target.ts/') -> false
  });

  test('searchByFilePath should handle directory path', async () => {
    const searchByFilePath = (processor as any).searchByFilePath.bind(processor);

    mockHybridSearch.mockResolvedValue([
        {
            memory: { id: '1', metadata: { lite_mode_metadata: { filePath: 'src/target/file.ts' } } },
            scores: { combined: 1 }
        },
        {
             memory: { id: '2', metadata: { lite_mode_metadata: { filePath: 'src/target/subdir/file.ts' } } },
             scores: { combined: 1 }
        },
        {
             memory: { id: '3', metadata: { lite_mode_metadata: { filePath: 'src/target_extra/file.ts' } } },
             scores: { combined: 1 }
        }
    ]);

    const filteredMemories = await searchByFilePath('src/target', 10);
    const ids = filteredMemories.map((m: Memory) => m.id);

    expect(ids).toContain('1'); // 'src/target/file.ts'.startsWith('src/target/') -> true
    expect(ids).toContain('2'); // 'src/target/subdir/file.ts'.startsWith('src/target/') -> true
    expect(ids).not.toContain('3'); // 'src/target_extra/...'
  });
});