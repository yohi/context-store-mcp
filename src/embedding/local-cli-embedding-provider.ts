/**
 * Local CLI Embedding Provider
 * 
 * Executes a local CLI command to generate embeddings
 * Supports tools like gemini-cli, claude-code, cursor-cli, etc.
 * Requirements: 10.2
 */

import { spawn } from 'child_process';
import type { EmbeddingProvider } from './types.js';

/**
 * Local CLI embedding provider implementation
 * Executes a CLI command and parses JSON output from stdout
 */
export class LocalCLIEmbeddingProvider implements EmbeddingProvider {
  private executable: string;
  private initialArgs: string[];
  private dimensions: number;

  constructor(executable: string, initialArgs: string[] = [], dimensions: number = 1536) {
    if (!executable || executable.trim().length === 0) {
      throw new Error('Executable cannot be empty');
    }
    this.executable = executable;
    this.initialArgs = initialArgs;
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

    return new Promise((resolve, reject) => {
      // Combine initial arguments with the user text
      const args = [...this.initialArgs, text];

      const child = spawn(this.executable, args);

      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout;
      const timeout = 30000; // 30 second timeout, consistent with previous exec options

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill(); // Kill the child process if timeout occurs
          reject(new Error(`CLI embedding command timed out after ${timeout / 1000} seconds`));
        }, timeout);
      }

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId); // Clear timeout if process finishes
        if (code !== 0) {
          reject(new Error(`CLI embedding command exited with code ${code}\nStderr: ${stderr}`));
          return;
        }

        if (stderr && stderr.trim().length > 0) {
          console.warn('CLI embedding command stderr:', stderr);
        }

        let result: unknown;
        try {
          result = JSON.parse(stdout);
        } catch (parseError) {
          reject(
            new Error(
              `Failed to parse CLI output as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}\nOutput: ${stdout.substring(0, 200)}`
            )
          );
          return;
        }

        try {
          const embedding = this.extractEmbedding(result);

          if (embedding.length !== this.dimensions) {
            reject(
              new Error(
                `Unexpected embedding dimensions: expected ${this.dimensions}, got ${embedding.length}`
              )
            );
            return;
          }

          for (let i = 0; i < embedding.length; i++) {
            if (!Number.isFinite(embedding[i])) {
              reject(new Error(`Invalid embedding value at index ${i}: ${embedding[i]}`));
              return;
            }
          }
          resolve(embedding);
        } catch (extractError) {
          reject(extractError);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId); // Clear timeout if process errors out
        reject(new Error(`Failed to start CLI embedding command: ${err.message}`));
      });
    });
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
