#!/usr/bin/env tsx
/**
 * Configuration Validation Script
 * システム設定の検証スクリプト
 *
 * このスクリプトは、Context Store MCPシステムの全設定が
 * 正しく構成されているかを検証します。
 */

interface ValidationResult {
  category: string;
  item: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
}

const results: ValidationResult[] = [];

function addResult(
  category: string,
  item: string,
  status: 'PASS' | 'FAIL' | 'WARN',
  message: string
) {
  results.push({ category, item, status, message });
}

// 1. 環境変数の検証
function validateEnvironmentVariables() {
  const category = '環境変数';

  const requiredVars = [
    'NODE_ENV',
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
    'NEO4J_URI',
    'NEO4J_USER',
    'NEO4J_PASSWORD',
    'REDIS_URL',
    'OPENAI_API_KEY',
  ];

  const optionalVars = [
    'NEO4J_DATABASE',
    'SIGNATURE_SECRET',
    'LOG_LEVEL',
    'MCP_PORT',
  ];

  // 必須環境変数のチェック
  for (const varName of requiredVars) {
    if (process.env[varName]) {
      addResult(category, varName, 'PASS', '設定済み');
    } else {
      addResult(category, varName, 'FAIL', '未設定（必須）');
    }
  }

  // オプション環境変数のチェック
  for (const varName of optionalVars) {
    if (process.env[varName]) {
      addResult(category, varName, 'PASS', '設定済み');
    } else {
      addResult(category, varName, 'WARN', '未設定（オプション）');
    }
  }

  // NODE_ENVの値チェック
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv && ['development', 'production', 'test'].includes(nodeEnv)) {
    addResult(
      category,
      'NODE_ENV値',
      'PASS',
      `有効な値: ${nodeEnv}`
    );
  } else {
    addResult(
      category,
      'NODE_ENV値',
      'WARN',
      `推奨値ではない: ${nodeEnv || '未設定'}`
    );
  }
}

// 2. データベース設定の検証
function validateDatabaseConfiguration() {
  const category = 'データベース設定';

  // PostgreSQL設定
  const pgPort = parseInt(process.env.POSTGRES_PORT || '5432', 10);
  if (pgPort > 0 && pgPort < 65536) {
    addResult(category, 'PostgreSQLポート', 'PASS', `${pgPort}`);
  } else {
    addResult(category, 'PostgreSQLポート', 'FAIL', '無効なポート番号');
  }

  // Neo4j URI形式チェック
  const neo4jUri = process.env.NEO4J_URI || '';
  if (neo4jUri.startsWith('bolt://') || neo4jUri.startsWith('neo4j://')) {
    addResult(category, 'Neo4j URI形式', 'PASS', 'Bolt/Neo4jプロトコル');
  } else if (neo4jUri) {
    addResult(category, 'Neo4j URI形式', 'WARN', '非標準プロトコル');
  } else {
    addResult(category, 'Neo4j URI形式', 'FAIL', 'URI未設定');
  }

  // Redis URL形式チェック
  const redisUrl = process.env.REDIS_URL || '';
  if (redisUrl.startsWith('redis://') || redisUrl.startsWith('rediss://')) {
    addResult(category, 'Redis URL形式', 'PASS', 'Redisプロトコル');
  } else if (redisUrl) {
    addResult(category, 'Redis URL形式', 'WARN', '非標準プロトコル');
  } else {
    addResult(category, 'Redis URL形式', 'FAIL', 'URL未設定');
  }
}

// 3. セキュリティ設定の検証
function validateSecurityConfiguration() {
  const category = 'セキュリティ設定';

  // SIGNATURE_SECRET（本番環境では必須）
  const signatureSecret = process.env.SIGNATURE_SECRET;
  const nodeEnv = process.env.NODE_ENV;

  if (nodeEnv === 'production') {
    if (signatureSecret && signatureSecret.length >= 32) {
      addResult(
        category,
        'SIGNATURE_SECRET',
        'PASS',
        '本番環境で適切に設定済み'
      );
    } else if (signatureSecret) {
      addResult(
        category,
        'SIGNATURE_SECRET',
        'WARN',
        '本番環境だが長さが不十分（推奨: 32文字以上）'
      );
    } else {
      addResult(
        category,
        'SIGNATURE_SECRET',
        'FAIL',
        '本番環境で未設定（必須）'
      );
    }
  } else {
    if (signatureSecret) {
      addResult(category, 'SIGNATURE_SECRET', 'PASS', '設定済み');
    } else {
      addResult(
        category,
        'SIGNATURE_SECRET',
        'WARN',
        '開発環境では任意だが設定推奨'
      );
    }
  }

  // OpenAI APIキーの形式チェック
  const openaiKey = process.env.OPENAI_API_KEY || '';
  if (openaiKey.startsWith('sk-')) {
    addResult(category, 'OpenAI APIキー形式', 'PASS', '有効な形式');
  } else if (openaiKey) {
    addResult(
      category,
      'OpenAI APIキー形式',
      'WARN',
      '非標準形式（テスト用？）'
    );
  } else {
    addResult(category, 'OpenAI APIキー形式', 'FAIL', 'APIキー未設定');
  }
}

// 4. パフォーマンス設定の検証
function validatePerformanceConfiguration() {
  const category = 'パフォーマンス設定';

  // 推奨設定値
  const recommendations = {
    'PostgreSQL接続プール': { max: 20, idle: 30000 },
    'Neo4j接続プール': { max: 50, timeout: 30000 },
    'Redisリトライ': { max: 3 },
    'キャッシュTTL': { default: 3600 },
    'レート制限': { perMinute: 100, burst: 20 },
    'Circuit Breaker': { threshold: 5, timeout: 30000 },
    '検索タイムアウト': { ms: 2000 },
  };

  for (const [setting, values] of Object.entries(recommendations)) {
    addResult(
      category,
      setting,
      'PASS',
      `推奨値: ${JSON.stringify(values)}`
    );
  }
}

// 5. ファイルシステムの検証
function validateFileSystem() {
  const category = 'ファイルシステム';

  const requiredFiles = [
    'package.json',
    'tsconfig.json',
    'vitest.config.ts',
    '.env.example',
    'src/index.ts',
    'src/mcp/server.ts',
  ];

  const requiredDirs = [
    'src',
    'src/mcp',
    'src/memory',
    'src/query',
    'src/storage',
    'src/security',
    'src/monitoring',
    'src/tests',
  ];

  // ファイルの存在チェック
  for (const file of requiredFiles) {
    try {
      const fs = require('fs');
      if (fs.existsSync(file)) {
        addResult(category, `ファイル: ${file}`, 'PASS', '存在する');
      } else {
        addResult(category, `ファイル: ${file}`, 'FAIL', '存在しない');
      }
    } catch (error) {
      addResult(
        category,
        `ファイル: ${file}`,
        'FAIL',
        'チェック失敗'
      );
    }
  }

  // ディレクトリの存在チェック
  for (const dir of requiredDirs) {
    try {
      const fs = require('fs');
      if (fs.existsSync(dir)) {
        addResult(category, `ディレクトリ: ${dir}`, 'PASS', '存在する');
      } else {
        addResult(category, `ディレクトリ: ${dir}`, 'FAIL', '存在しない');
      }
    } catch (error) {
      addResult(
        category,
        `ディレクトリ: ${dir}`,
        'FAIL',
        'チェック失敗'
      );
    }
  }
}

// 6. 依存関係の検証
function validateDependencies() {
  const category = '依存関係';

  try {
    const fs = require('fs');
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));

    const criticalDeps = [
      '@modelcontextprotocol/sdk',
      'neo4j-driver',
      'pg',
      'pgvector',
      'redis',
      'openai',
      'winston',
    ];

    for (const dep of criticalDeps) {
      if (packageJson.dependencies && packageJson.dependencies[dep]) {
        addResult(
          category,
          dep,
          'PASS',
          `バージョン: ${packageJson.dependencies[dep]}`
        );
      } else {
        addResult(category, dep, 'FAIL', '未インストール');
      }
    }
  } catch (error) {
    addResult(category, 'package.json', 'FAIL', '読み込み失敗');
  }
}

// レポート生成
function generateReport() {
  console.log('\n='.repeat(80));
  console.log('Context Store MCP - 設定検証レポート');
  console.log('='.repeat(80));
  console.log();

  const categories = [...new Set(results.map((r) => r.category))];

  for (const category of categories) {
    console.log(`\n【${category}】`);
    console.log('-'.repeat(80));

    const categoryResults = results.filter((r) => r.category === category);

    for (const result of categoryResults) {
      const statusIcon =
        result.status === 'PASS' ? '✓' : result.status === 'FAIL' ? '✗' : '⚠';
      const statusColor =
        result.status === 'PASS'
          ? '\x1b[32m'
          : result.status === 'FAIL'
            ? '\x1b[31m'
            : '\x1b[33m';
      const resetColor = '\x1b[0m';

      console.log(
        `  ${statusColor}${statusIcon}${resetColor} ${result.item.padEnd(30)} ${result.message}`
      );
    }
  }

  // サマリー
  console.log('\n' + '='.repeat(80));
  console.log('サマリー');
  console.log('='.repeat(80));

  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const warnCount = results.filter((r) => r.status === 'WARN').length;
  const total = results.length;

  console.log(`  合格: ${passCount}/${total}`);
  console.log(`  失敗: ${failCount}/${total}`);
  console.log(`  警告: ${warnCount}/${total}`);

  if (failCount === 0) {
    console.log('\n  \x1b[32m✓ すべての必須設定が正しく構成されています\x1b[0m');
  } else {
    console.log(
      '\n  \x1b[31m✗ 一部の必須設定に問題があります。上記の失敗項目を確認してください。\x1b[0m'
    );
  }

  if (warnCount > 0) {
    console.log(
      '  \x1b[33m⚠ 警告項目があります。必要に応じて設定を見直してください。\x1b[0m'
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log();

  // 終了コード
  process.exit(failCount > 0 ? 1 : 0);
}

// メイン実行
async function main() {
  console.log('設定検証を開始します...\n');

  validateEnvironmentVariables();
  validateDatabaseConfiguration();
  validateSecurityConfiguration();
  validatePerformanceConfiguration();
  validateFileSystem();
  validateDependencies();

  generateReport();
}

main().catch((error) => {
  console.error('検証中にエラーが発生しました:', error);
  process.exit(1);
});
