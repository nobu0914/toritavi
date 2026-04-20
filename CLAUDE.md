# CLAUDE.md

## プロジェクト情報

## 最重要 UI 運用ルール
- 画面修正を指示されたら、実装前に必ず `mock/design-system-v2.html` を参照すること（これが現在の source of truth）。必要に応じて `mock/index.html`、`mock/journey-flow-v2.html`、`mock/account-subpages.html` も参照。旧 `mock/_archive/` 配下は参照しないこと（レガシー、2026-04-21 退避）
- デザインシステムやモックに既存 UI パターンがある場合は、それを優先して使うこと
- デザインシステムにあるのに独自 UI を勝手に作らないこと
- 再開時は着手前チェックとして、必ず `CLAUDE.md`、`CODEX_MEMORY.md`、`HANDOVER.md` を確認し、このルールを先に思い出してから進めること
