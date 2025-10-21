import { describe, it, expect } from 'vitest';

/**
 * sanitizeProperties のロジックをテスト用に抽出
 */
function sanitizeProperties<T extends Record<string, unknown>>(properties: T): Partial<T> {
  const sanitized: Partial<T> = {};

  for (const [key, value] of Object.entries(properties)) {
    // undefined, null, NaN を除外
    if (value === undefined || value === null || (typeof value === 'number' && isNaN(value))) {
      continue;
    }
    sanitized[key as keyof T] = value as T[keyof T];
  }

  return sanitized;
}

describe('Property Sanitization Logic', () => {
  it('should remove undefined values', () => {
    const props = {
      id: 'test-id',
      name: 'Test',
      description: undefined,
      age: 25,
    };

    const result = sanitizeProperties(props);

    expect(result).toEqual({
      id: 'test-id',
      name: 'Test',
      age: 25,
    });
    expect(result).not.toHaveProperty('description');
  });

  it('should remove null values', () => {
    const props = {
      id: 'test-id',
      name: 'Test',
      metadata: null,
      age: 25,
    };

    const result = sanitizeProperties(props);

    expect(result).toEqual({
      id: 'test-id',
      name: 'Test',
      age: 25,
    });
    expect(result).not.toHaveProperty('metadata');
  });

  it('should remove NaN values', () => {
    const props = {
      id: 'test-id',
      name: 'Test',
      score: NaN,
      age: 25,
    };

    const result = sanitizeProperties(props);

    expect(result).toEqual({
      id: 'test-id',
      name: 'Test',
      age: 25,
    });
    expect(result).not.toHaveProperty('score');
  });

  it('should handle all types of invalid values together', () => {
    const props = {
      id: 'test-id',
      name: 'Test',
      undefinedField: undefined,
      nullField: null,
      nanField: NaN,
      validNumber: 0,
      validString: '',
      validBoolean: false,
    };

    const result = sanitizeProperties(props);

    expect(result).toEqual({
      id: 'test-id',
      name: 'Test',
      validNumber: 0,
      validString: '',
      validBoolean: false,
    });
    expect(result).not.toHaveProperty('undefinedField');
    expect(result).not.toHaveProperty('nullField');
    expect(result).not.toHaveProperty('nanField');
  });

  it('should preserve valid falsy values (0, empty string, false)', () => {
    const props = {
      id: 'test-id',
      count: 0,
      name: '',
      active: false,
    };

    const result = sanitizeProperties(props);

    expect(result).toEqual({
      id: 'test-id',
      count: 0,
      name: '',
      active: false,
    });
  });

  it('should handle empty object', () => {
    const props = {};

    const result = sanitizeProperties(props);

    expect(result).toEqual({});
  });

  it('should handle partial properties with only invalid values', () => {
    const props = {
      undefinedField: undefined,
      nullField: null,
      nanField: NaN,
    };

    const result = sanitizeProperties(props);

    expect(result).toEqual({});
  });

  it('should preserve nested objects and arrays', () => {
    const props = {
      id: 'test-id',
      metadata: { key: 'value' },
      tags: ['tag1', 'tag2'],
      invalidField: undefined,
    };

    const result = sanitizeProperties(props);

    expect(result).toEqual({
      id: 'test-id',
      metadata: { key: 'value' },
      tags: ['tag1', 'tag2'],
    });
    expect(result).not.toHaveProperty('invalidField');
  });
});
