# CLAUDE.md

## プロジェクト情報

- **メール転送の取り込み**（2026-10-08・段階 1）: `app/src/app/api/inbound-mail/route.ts` が Cloudflare の Email Worker（`app/workers/inbound-mail/`・別に wrangler で出す）から生の MIME を受け、`toritavi_inbox_items` ／ `toritavi-inbox` に置く。**ここで AI は呼ばない。** 停止は環境変数 `MAIL_IMPORT_ENABLED`（`"true"` 以外は 503＝閉）。署名の秘密 `INBOUND_MAIL_SECRET` は Vercel と Worker に同じ値（🔴 環境変数の変更は利用者の許可を得てから）。30 日の掃除は `app/src/app/api/cron/purge-inbox`。設計の正本は `toritavi_app/docs/mail-import-design.md` §11

## 最重要 UI 運用ルール
- 画面修正を指示されたら、実装前に必ず `mock/design-system-v2.html` を参照すること（これが現在の source of truth）。必要に応じて `mock/index.html`、`mock/journey-flow-v2.html`、`mock/account-subpages.html` も参照。旧 `mock/_archive/` 配下は参照しないこと（レガシー、2026-04-21 退避）
- デザインシステムやモックに既存 UI パターンがある場合は、それを優先して使うこと
- デザインシステムにあるのに独自 UI を勝手に作らないこと
- 再開時は着手前チェックとして、必ず `CLAUDE.md`、`CODEX_MEMORY.md`、`HANDOVER.md` を確認し、このルールを先に思い出してから進めること
