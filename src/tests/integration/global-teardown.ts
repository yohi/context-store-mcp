/**
 * Global Teardown for Integration Tests
 * テスト完了後のクリーンアップ処理
 */

import { execSync } from 'child_process';
import { resolve } from 'path';

export default async function teardown() {
    console.log('\n🧹 Cleaning up integration test environment...');

    try {
        // Docker Composeの停止とボリューム削除
        const composeFile = resolve(__dirname, '../../../docker-compose.test.yml');
        execSync(`docker-compose -f ${composeFile} down -v`, { stdio: 'inherit' });

        console.log('✅ Integration test environment cleaned up');
    } catch (error) {
        console.error('❌ Failed to clean up integration test environment:', error);
        // テスト自体の結果には影響させないため、エラーは投げない
    }
}
