# Claude Code Spec-Driven Development

Kiro-style Spec Driven Development implementation using claude code slash commands, hooks and agents.

## Project Context

### Paths
- Steering: `.kiro/steering/`
- Specs: `.kiro/specs/`
- Commands: `.claude/commands/`

### Steering vs Specification

**Steering** (`.kiro/steering/`) - Guide AI with project-wide rules and context
**Specs** (`.kiro/specs/`) - Formalize development process for individual features

### Active Specifications
- Check `.kiro/specs/` for active specifications
- Use `/kiro:spec-status [feature-name]` to check progress

#### Current Specifications
- **context-store-mcp**: AIエージェント向けMCPベース長期記憶システム - セッションを越えて情報を永続保存し、文脈に応じた検索を可能にする

## Development Guidelines
- Think in English, generate responses in English

## Workflow

### Phase 0: Steering (Optional)
`/kiro:steering` - Create/update steering documents
`/kiro:steering-custom` - Create custom steering for specialized contexts

Note: Optional for new features or small additions. You can proceed directly to spec-init.

### Phase 1: Specification Creation
1. `/kiro:spec-init [detailed description]` - Initialize spec with detailed project description
2. `/kiro:spec-requirements [feature]` - Generate requirements document
3. `/kiro:spec-design [feature]` - Interactive: "Have you reviewed requirements.md? [y/N]"
4. `/kiro:spec-tasks [feature]` - Interactive: Confirms both requirements and design review

### Phase 2: Progress Tracking
`/kiro:spec-status [feature]` - Check current progress and phases

## Development Rules
1. **Consider steering**: Run `/kiro:steering` before major development (optional for new features)
2. **Follow 3-phase approval workflow**: Requirements → Design → Tasks → Implementation
3. **Approval required**: Each phase requires human review (interactive prompt or manual)
4. **No skipping phases**: Design requires approved requirements; Tasks require approved design
5. **Update task status**: Mark tasks as completed when working on them
6. **Keep steering current**: Run `/kiro:steering` after significant changes
7. **Check spec compliance**: Use `/kiro:spec-status` to verify alignment

## Steering Configuration

### Current Steering Files
Managed by `/kiro:steering` command. Updates here reflect command changes.

### Active Steering Files
- `product.md`: Always included - Product context and business objectives
- `tech.md`: Always included - Technology stack and architectural decisions
- `structure.md`: Always included - File organization and code patterns

### Custom Steering Files
<!-- Added by /kiro:steering-custom command -->
<!-- Format:
- `filename.md`: Mode - Pattern(s) - Description
  Mode: Always|Conditional|Manual
  Pattern: File patterns for Conditional mode
-->

### Inclusion Modes
- **Always**: Loaded in every interaction (default)
- **Conditional**: Loaded for specific file patterns (e.g., "*.test.js")
- **Manual**: Reference with `@filename.md` syntax

## Branch-Based Development Flow

### Branch Naming Conventions
**必ず**以下の命名規則を守ること：

- **Phase毎のブランチ（親ブランチ）**: `feature/phaseX__[[description]]`
  - 例: `feature/phase1__project-foundation`
- **Task毎のブランチ（作業ブランチ）**: `feature/phaseX-taskY__[[description]]`
  - 例: `feature/phase1-task1__setup-project-structure`

### 作業フロー

#### Phase開始時
1. masterまたは直前の作業ブランチからPhaseの親ブランチを作成
   ```bash
   git checkout -b feature/phase1__description-PHASE1
   ```

#### Task作業サイクル
各Task毎に以下を実施：

1. **作業ブランチ作成**
   - **重要**: 必ず直前の作業ブランチから作成（デグレ防止）
   ```bash
   git checkout -b feature/phase1-task1__description-TASK1
   ```

2. **タスク実装**
   ```bash
   /kiro:spec-impl [feature-name] [task-number]
   ```
   - 例: `/kiro:spec-impl context-store-mcp 1.1`

3. **コードレビュー**
   ```bash
   coderabbit --prompt-only
   ```
   - バックグラウンドで実行し、指摘事項を修正

4. **コミット・プッシュ**
   ```bash
   git add .
   git commit -m "feat(taskX): description"
   git push origin feature/phase1-task1__description-TASK1
   ```

5. **次のタスクへ**
   - 直前の作業ブランチから新しい作業ブランチを作成
   ```bash
   git checkout -b feature/phase1-task2__description-TASK2
   ```

#### Phase完了時
1. `/init` を実行してCLAUDE.mdを更新
2. `/clear` でコンテキストをクリア
3. 直前の作業ブランチから次Phaseの親ブランチを作成
   ```bash
   git checkout -b feature/phase2__description-PHASE2
   ```

### 作業フロー詳細例

```bash
# Phase 1開始
01. git checkout master
    git checkout -b feature/phase1__description-PHASE1

# Task 1
02. git checkout -b feature/phase1-task1__description-TASK1
03. /kiro:spec-impl context-store-mcp 1.1
04. coderabbit --prompt-only  # バックグラウンド実行
05. git add . && git commit -m "feat(task1): ..." && git push

# Task 2
06. git checkout -b feature/phase1-task2__description-TASK2
07. /kiro:spec-impl context-store-mcp 1.2
08. coderabbit --prompt-only  # バックグラウンド実行
09. git add . && git commit -m "feat(task2): ..." && git push

# Phase 1完了・Phase 2へ
10. /init
    /clear
11. git checkout -b feature/phase2__description-PHASE2

# Task 3（Phase 2-Task 1）
12. git checkout -b feature/phase2-task1__description-TASK3
13. /kiro:spec-impl context-store-mcp 2.1
14. coderabbit --prompt-only  # バックグラウンド実行
15. git add . && git commit -m "feat(task3): ..." && git push

# ...最終Phase・最終Taskまで継続
```

### タスク完了後のチェックリスト

各タスク完了時に**必ず**以下を確認：

- [ ] `.kiro/specs/[feature-name]/spec.json` を更新している
- [ ] `.kiro/specs/[feature-name]/tasks.md` を更新している
- [ ] 次Task（あるいはPhase）用の作業ブランチ（Phaseの場合は親ブランチ）を命名規則通り作成している
- [ ] **新しいブランチは直前の作業ブランチから作成している**（デグレ防止）
- [ ] coderabbitでコードレビューを実施し、指摘事項を修正している
- [ ] コミットメッセージが適切（`feat(taskX): description`形式）

### 重要な注意事項

1. **ブランチ作成元**: 必ず直前の作業ブランチから新しいブランチを作成すること
   - ❌ 誤り: masterから毎回作成
   - ✅ 正解: feature/phase1-task1 → feature/phase1-task2 → feature/phase1-task3

2. **デグレ防止**: 直前の作業内容を含めるため、ブランチの親を正しく設定

3. **Phase完了時**: `/init` → `/clear` を実行してコンテキストをリフレッシュ

4. **コードレビュー**: 各タスク完了後、必ずcoderabbitを実行

5. **命名規則**: ブランチ名は必ず `feature/phaseX-taskY__description` 形式に従う
