/**
 * Local CLI Embedding Provider
 * 
 * Executes a local CLI command to generate embeddings
 * Supports tools like gemini-cli, claude-code, cursor-cli, etc.
 * Requirements: 10.2
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { EmbeddingProvider } from './types.js';

const execAsync = promisify(exec);

/**
 * Local CLI embedding provider implementation
 * Executes a CLI command and parses JSON output from stdout
 */
export class LocalCLIEmbeddingProvider implements EmbeddingProvider {
  private command: string;
  private dimensions: number;

  constructor(command: string, dimensions: number = 1536) {
    if (!command || command.trim().length === 0) {
      throw new Error('CLI command cannot be empty');
    }
    this.command = command;
    this.dimensions = dimensions;
  }

  /**
   * Generate embedding by executing CLI command
   * Expected CLI output format: JSON with "embedding" field containing number array
   * Example: {"embedding": [0.1, 0.2, ...]}
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    try {
      // Escape text for shell command
      const escapedText = text.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
      
      // Execute CLI command with text as argument
      const fullCommand = `${this.command} "${escapedText}"`;
      
      const { stdout, stderr } = await execAsync(fullCommand, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
        timeout: 30000, // 30 second timeout
      });

      // Log stderr if present (may contain warnings)
      if (stderr && stderr.trim().length > 0) {
        console.warn('CLI embedding command stderr:', stderr);
      }

      // Parse JSON output from stdout
      let result: unknown;
      try {
        result = JSON.parse(stdout);
      } catch (parseError) {
        throw new Error(
          `Failed to parse CLI output as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}\nOutput: ${stdout.substring(0, 200)}`
        );
      }

      // Extract embedding array from result
      const embedding = this.extractEmbedding(result);

      // Validate dimensions
      if (embedding.length !== this.dimensions) {
        throw new Error(
          `Unexpected embedding dimensions: expected ${this.dimensions}, got ${embedding.length}`
        );
      }

      // Validate all values are finite numbers
      for (let i = 0; i < embedding.length; i++) {
        if (!Number.isFinite(embedding[i])) {
          throw new Error(`Invalid embedding value at index ${i}: ${embedding[i]}`);
        }
      }

      return embedding;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`CLI embedding generation failed: ${error.message}`);
      }
      throw new Error(`CLI embedding generation failed: ${String(error)}`);
    }
  }

  /**
   * Extract embedding array from CLI output
   * Supports multiple JSON formats:
   * - {"embedding": [numbers]}
   * - {"embeddings": [[numbers]]}
   * - {"data": [{"embedding": [numbers]}]}
   * - [numbers] (direct array)
   */
  private extractEmbedding(result: unknown): number[] {
    // Direct array format
    if (Array.isArray(result)) {
      return this.validateNumberArray(result);
    }

    // Object format
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>;

      // Format: {"embedding": [numbers]}
      if ('embedding' in obj && Array.isArray(obj['embedding'])) {
        return this.validateNumberArray(obj['embedding']);
      }

      // Format: {"embeddings": [[numbers]]} - take first embedding
      if ('embeddings' in obj && Array.isArray(obj['embeddings'])) {
        const embeddings = obj['embeddings'] as unknown[];
        if (embeddings.length > 0 && Array.isArray(embeddings[0])) {
          return this.validateNumberArray(embeddings[0] as unknown[]);
        }
      }

      // Format: {"data": [{"embedding": [numbers]}]} - OpenAI-like format
      if ('data' in obj && Array.isArray(obj['data'])) {
        const data = obj['data'] as unknown[];
        if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
          const firstItem = data[0] as Record<string, unknown>;
          if ('embedding' in firstItem && Array.isArray(firstItem['embedding'])) {
            return this.validateNumberArray(firstItem['embedding']);
          }
        }
      }
    }

    throw new Error(
      'CLI output does not match expected format. Expected JSON with "embedding" field containing number array.'
    );
  }

  /**
   * Validate and convert array to number array
   */
  private validateNumberArray(arr: unknown[]): number[] {
    const numbers: number[] = [];
    
    for (let i = 0; i < arr.length; i++) {
      const value = arr[i];
      const num = Number(value);
      
      if (!Number.isFinite(num)) {
        throw new Error(`Invalid number at index ${i}: ${value}`);
      }
      
      numbers.push(num);
    }
    
    return numbers;
  }

  /**
   * Check if CLI command is available
   * Attempts to execute the command with a test input
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Try to generate a simple embedding to test availability
      await this.generateEmbedding('test');
      return true;
    } catch (error) {
      console.warn('Local CLI embedding provider is not available:', error);
      return false;
    }
  }
}
