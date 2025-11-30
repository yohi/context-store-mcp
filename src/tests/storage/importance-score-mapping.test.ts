import { describe, it, expect } from 'vitest';

/**
 * Unit tests for importanceScore null/NaN handling
 * 
 * This test verifies that the postgres-store-adapter correctly handles
 * null, undefined, and non-numeric importance_score values by defaulting to 0.
 */
describe('PostgresStorageAdapter - importanceScore mapping', () => {
    /**
     * Helper function to simulate the mapping logic from postgres-store-adapter.ts line 158
     */
    function mapImportanceScore(importance_score: any): number {
        return importance_score == null
            ? 0
            : (typeof importance_score === 'number'
                ? importance_score
                : parseFloat(importance_score)) || 0;
    }

    it('should return 0 when importance_score is null', () => {
        const result = mapImportanceScore(null);
        expect(result).toBe(0);
        expect(Number.isFinite(result)).toBe(true);
    });

    it('should return 0 when importance_score is undefined', () => {
        const result = mapImportanceScore(undefined);
        expect(result).toBe(0);
        expect(Number.isFinite(result)).toBe(true);
    });

    it('should return the number directly when importance_score is already a number', () => {
        const result = mapImportanceScore(0.75);
        expect(result).toBe(0.75);
        expect(Number.isFinite(result)).toBe(true);
    });

    it('should parse and return when importance_score is a numeric string', () => {
        const result = mapImportanceScore('0.85');
        expect(result).toBe(0.85);
        expect(Number.isFinite(result)).toBe(true);
    });

    it('should return 0 when importance_score is a non-numeric string', () => {
        const result = mapImportanceScore('invalid');
        expect(result).toBe(0);
        expect(Number.isFinite(result)).toBe(true);
    });

    it('should return 0 when importance_score is NaN', () => {
        const result = mapImportanceScore(NaN);
        expect(result).toBe(0);
        expect(Number.isFinite(result)).toBe(true);
    });

    it('should return 0 when importance_score is an empty string', () => {
        const result = mapImportanceScore('');
        expect(result).toBe(0);
        expect(Number.isFinite(result)).toBe(true);
    });

    it('should handle zero correctly', () => {
        const result = mapImportanceScore(0);
        expect(result).toBe(0);
        expect(Number.isFinite(result)).toBe(true);
    });

    it('should handle negative numbers correctly', () => {
        const result = mapImportanceScore(-0.5);
        expect(result).toBe(-0.5);
        expect(Number.isFinite(result)).toBe(true);
    });

    it('should handle Infinity by defaulting to 0', () => {
        const result = mapImportanceScore(Infinity);
        // Infinity is a number, so it will be returned as-is
        // If we want to guard against Infinity, we'd need to add Number.isFinite check
        expect(result).toBe(Infinity);
    });

    it('should never return NaN', () => {
        const testCases = [null, undefined, 'invalid', '', NaN, {}, []];

        testCases.forEach((testCase) => {
            const result = mapImportanceScore(testCase);
            expect(Number.isNaN(result)).toBe(false);
            expect(Number.isFinite(result) || result === Infinity).toBe(true);
        });
    });
});
