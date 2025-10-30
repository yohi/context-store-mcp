-- APIキー管理用スキーマ
-- セキュアなAPIキー管理のための永続化層

-- ========================================
-- APIキーテーブル
-- ========================================

-- api_keysテーブル: APIキーの情報を格納
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_prefix VARCHAR(50) NOT NULL, -- 表示用プレフィックス（例: csm_v1_7YHF）
    hashed_key VARCHAR(64) NOT NULL UNIQUE, -- HMAC-SHA256ハッシュ（16進数）
    name VARCHAR(255) NOT NULL, -- キー名（ユーザー識別用）
    user_id UUID, -- オプション: ユーザーID（外部システム連携用）
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    scopes JSONB NOT NULL DEFAULT '["read", "write"]', -- 権限スコープ
    metadata JSONB DEFAULT '{}' -- 拡張可能なメタデータ
);

-- ========================================
-- APIキー使用ログテーブル
-- ========================================

-- api_key_usage_logテーブル: APIキーの使用履歴
CREATE TABLE IF NOT EXISTS api_key_usage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    endpoint VARCHAR(255), -- アクセスされたエンドポイント
    ip_address INET, -- リクエスト元IPアドレス
    user_agent TEXT, -- ユーザーエージェント
    success BOOLEAN NOT NULL DEFAULT true, -- リクエストの成否
    error_message TEXT -- エラー発生時のメッセージ
);

-- ========================================
-- APIキーローテーション履歴テーブル
-- ========================================

-- api_key_rotation_historyテーブル: キーローテーションの履歴
CREATE TABLE IF NOT EXISTS api_key_rotation_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    old_key_id UUID NOT NULL, -- 古いキーのID
    new_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    rotated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reason TEXT, -- ローテーションの理由
    grace_period_ms INT -- 猶予期間（ミリ秒）
);

-- ========================================
-- インデックス作成
-- ========================================

-- api_keysテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_api_keys_hashed_key ON api_keys(hashed_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);
CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON api_keys(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_created_at ON api_keys(created_at);

-- api_key_usage_logテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_api_key_usage_api_key_id ON api_key_usage_log(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_used_at ON api_key_usage_log(used_at);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_cleanup ON api_key_usage_log(used_at) WHERE used_at < NOW() - INTERVAL '90 days';

-- api_key_rotation_historyテーブルのインデックス
CREATE INDEX IF NOT EXISTS idx_api_key_rotation_old_key_id ON api_key_rotation_history(old_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_rotation_new_key_id ON api_key_rotation_history(new_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_rotation_rotated_at ON api_key_rotation_history(rotated_at);

-- ========================================
-- 自動クリーンアップ用の関数とトリガー
-- ========================================

-- 期限切れキーの自動ステータス更新関数
CREATE OR REPLACE FUNCTION update_expired_api_keys()
RETURNS void AS $$
BEGIN
    UPDATE api_keys
    SET status = 'expired'
    WHERE expires_at IS NOT NULL
      AND expires_at <= NOW()
      AND status = 'active';
END;
$$ LANGUAGE plpgsql;

-- 定期実行用のコメント（手動またはcron設定）
COMMENT ON FUNCTION update_expired_api_keys() IS
'期限切れのAPIキーを自動的にexpiredステータスに更新します。定期的に実行してください（例: 1時間ごと）。';

-- ========================================
-- 確認メッセージ
-- ========================================

DO $$
BEGIN
  RAISE NOTICE 'API Keys schema created successfully';
  RAISE NOTICE 'Tables created: api_keys, api_key_usage_log, api_key_rotation_history';
  RAISE NOTICE 'All indexes created successfully';
  RAISE NOTICE 'Function created: update_expired_api_keys()';
END $$;
