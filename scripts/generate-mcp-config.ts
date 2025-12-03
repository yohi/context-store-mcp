#!/usr/bin/env tsx

/**
 * MCP Configuration Generator for Context Store
 * 
 * This script generates MCP client configuration files for various AI clients
 * (Claude Desktop, Cursor, etc.) with support for both Docker and local Node.js execution.
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface MCPConfig {
  mcpServers: {
    [key: string]: {
      command: string;
      args: string[];
      env?: Record<string, string>;
    };
  };
}

interface GeneratorOptions {
  mode: 'docker' | 'local';
  outputPath?: string;
  clientType: 'claude-desktop' | 'cursor' | 'generic';
  liteMode?: boolean;
}

class MCPConfigGenerator {
  private options: GeneratorOptions;

  constructor(options: GeneratorOptions) {
    this.options = options;
  }

  /**
   * Detect the user's environment and suggest appropriate configuration
   */
  private detectEnvironment(): {
    hasDocker: boolean;
    hasNode: boolean;
    nodeVersion?: string;
    platform: string;
  } {
    let hasDocker = false;
    let hasNode = false;
    let nodeVersion: string | undefined;

    try {
      execSync('docker --version', { stdio: 'ignore' });
      hasDocker = true;
    } catch {
      // Docker not available
    }

    try {
      const version = execSync('node --version', { encoding: 'utf-8' }).trim();
      hasNode = true;
      nodeVersion = version;
    } catch {
      // Node not available
    }

    return {
      hasDocker,
      hasNode,
      nodeVersion,
      platform: os.platform(),
    };
  }

  /**
   * Generate Docker-based MCP configuration
   */
  private generateDockerConfig(): MCPConfig {
    const env: Record<string, string> = {
      POSTGRES_HOST: 'host.docker.internal',
      POSTGRES_PORT: '5432',
      POSTGRES_USER: 'context_store',
      POSTGRES_PASSWORD: 'your_password_here',
      POSTGRES_DB: 'context_store',
    };

    if (this.options.liteMode) {
      env.LITE_MODE = 'true';
      env.ENABLE_GRAPH_STORE = 'false';
      env.ENABLE_REDIS_CACHE = 'false';
    }

    return {
      mcpServers: {
        'context-store': {
          command: 'docker',
          args: [
            'run',
            '--rm',
            '-i',
            '--network', 'host',
            '-e', 'POSTGRES_HOST',
            '-e', 'POSTGRES_PORT',
            '-e', 'POSTGRES_USER',
            '-e', 'POSTGRES_PASSWORD',
            '-e', 'POSTGRES_DB',
            ...(this.options.liteMode ? [
              '-e', 'LITE_MODE',
              '-e', 'ENABLE_GRAPH_STORE',
              '-e', 'ENABLE_REDIS_CACHE',
            ] : []),
            'context-store-mcp:latest',
          ],
          env,
        },
      },
    };
  }

  /**
   * Generate local Node.js-based MCP configuration
   */
  private generateLocalConfig(): MCPConfig {
    const projectRoot = path.resolve(__dirname, '..');
    const env: Record<string, string> = {
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5432',
      POSTGRES_USER: 'context_store',
      POSTGRES_PASSWORD: 'your_password_here',
      POSTGRES_DB: 'context_store',
    };

    if (this.options.liteMode) {
      env.LITE_MODE = 'true';
      env.ENABLE_GRAPH_STORE = 'false';
      env.ENABLE_REDIS_CACHE = 'false';
    }

    return {
      mcpServers: {
        'context-store': {
          command: 'node',
          args: [path.join(projectRoot, 'dist', 'index.js')],
          env,
        },
      },
    };
  }

  /**
   * Get the default configuration path for the specified client type
   */
  private getDefaultConfigPath(): string {
    const homeDir = os.homedir();
    const platform = os.platform();

    switch (this.options.clientType) {
      case 'claude-desktop':
        if (platform === 'darwin') {
          return path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        } else if (platform === 'win32') {
          return path.join(homeDir, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
        } else {
          return path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json');
        }

      case 'cursor':
        if (platform === 'darwin') {
          return path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'mcp.json');
        } else if (platform === 'win32') {
          return path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'mcp.json');
        } else {
          return path.join(homeDir, '.config', 'Cursor', 'User', 'globalStorage', 'mcp.json');
        }

      case 'generic':
      default:
        return path.join(process.cwd(), 'mcp-config.json');
    }
  }

  /**
   * Merge new configuration with existing configuration if it exists
   */
  private mergeWithExisting(newConfig: MCPConfig, existingPath: string): MCPConfig {
    if (!fs.existsSync(existingPath)) {
      return newConfig;
    }

    try {
      const existingContent = fs.readFileSync(existingPath, 'utf-8');
      const existingConfig = JSON.parse(existingContent) as MCPConfig;

      // Merge mcpServers
      return {
        mcpServers: {
          ...existingConfig.mcpServers,
          ...newConfig.mcpServers,
        },
      };
    } catch (error) {
      console.warn(`Warning: Could not parse existing config at ${existingPath}. Creating new config.`);
      return newConfig;
    }
  }

  /**
   * Generate and save the MCP configuration
   */
  public generate(): void {
    const env = this.detectEnvironment();

    // Validate environment
    if (this.options.mode === 'docker' && !env.hasDocker) {
      console.error('Error: Docker is not available on this system.');
      console.error('Please install Docker or use --mode=local');
      process.exit(1);
    }

    if (this.options.mode === 'local' && !env.hasNode) {
      console.error('Error: Node.js is not available on this system.');
      console.error('Please install Node.js or use --mode=docker');
      process.exit(1);
    }

    // Generate configuration
    const config = this.options.mode === 'docker'
      ? this.generateDockerConfig()
      : this.generateLocalConfig();

    // Determine output path
    const outputPath = this.options.outputPath || this.getDefaultConfigPath();
    const outputDir = path.dirname(outputPath);

    // Merge with existing config if present
    const finalConfig = this.mergeWithExisting(config, outputPath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write configuration
    fs.writeFileSync(outputPath, JSON.stringify(finalConfig, null, 2), 'utf-8');

    console.log('✓ MCP configuration generated successfully!');
    console.log(`  Output: ${outputPath}`);
    console.log(`  Mode: ${this.options.mode}`);
    console.log(`  Lite Mode: ${this.options.liteMode ? 'enabled' : 'disabled'}`);
    console.log('');
    console.log('Environment detected:');
    console.log(`  Docker: ${env.hasDocker ? '✓' : '✗'}`);
    console.log(`  Node.js: ${env.hasNode ? `✓ (${env.nodeVersion})` : '✗'}`);
    console.log(`  Platform: ${env.platform}`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Edit the configuration file to set your database credentials');
    console.log('  2. Restart your MCP client (Claude Desktop, Cursor, etc.)');
    console.log('  3. The Context Store MCP server should now be available');
    console.log('');
    console.log('For troubleshooting, see: README.md#lite-mode');
  }
}

// CLI interface
function main() {
  const args = process.argv.slice(2);
  
  let mode: 'docker' | 'local' = 'local';
  let outputPath: string | undefined;
  let clientType: 'claude-desktop' | 'cursor' | 'generic' = 'claude-desktop';
  let liteMode = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--mode' || arg === '-m') {
      const value = args[++i];
      if (value !== 'docker' && value !== 'local') {
        console.error('Error: --mode must be either "docker" or "local"');
        process.exit(1);
      }
      mode = value;
    } else if (arg === '--output' || arg === '-o') {
      outputPath = args[++i];
    } else if (arg === '--client' || arg === '-c') {
      const value = args[++i];
      if (value !== 'claude-desktop' && value !== 'cursor' && value !== 'generic') {
        console.error('Error: --client must be one of: claude-desktop, cursor, generic');
        process.exit(1);
      }
      clientType = value;
    } else if (arg === '--lite-mode' || arg === '-l') {
      liteMode = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: generate-mcp-config [options]');
      console.log('');
      console.log('Options:');
      console.log('  -m, --mode <mode>        Execution mode: "docker" or "local" (default: local)');
      console.log('  -c, --client <client>    Client type: "claude-desktop", "cursor", or "generic" (default: claude-desktop)');
      console.log('  -o, --output <path>      Output path for config file (default: auto-detected)');
      console.log('  -l, --lite-mode          Enable Lite Mode (PostgreSQL only)');
      console.log('  -h, --help               Show this help message');
      console.log('');
      console.log('Examples:');
      console.log('  # Generate config for Claude Desktop with Docker');
      console.log('  npm run generate-config -- --mode docker --client claude-desktop');
      console.log('');
      console.log('  # Generate config for Cursor with local Node.js in Lite Mode');
      console.log('  npm run generate-config -- --mode local --client cursor --lite-mode');
      console.log('');
      console.log('  # Generate config to custom path');
      console.log('  npm run generate-config -- --output ./my-config.json');
      process.exit(0);
    } else {
      console.error(`Error: Unknown option: ${arg}`);
      console.error('Use --help for usage information');
      process.exit(1);
    }
  }

  const generator = new MCPConfigGenerator({
    mode,
    outputPath,
    clientType,
    liteMode,
  });

  generator.generate();
}

// Run main if this is the entry point
// In ES modules, check if this file is being run directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = import.meta.url.slice(7); // Remove 'file://'
  const scriptPath = process.argv[1];
  if (modulePath === scriptPath || modulePath.endsWith(scriptPath)) {
    main();
  }
}

export { MCPConfigGenerator, GeneratorOptions, MCPConfig };
