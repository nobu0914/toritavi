# Session Log — 2026-04-20 (Security Hardening: CRITICAL RLS 穴 + CSP nonce 化)

## Theme
外部セキュリティ監査（同日実施）の指摘項目を起点に、公開面の残課題を段階的に潰した。最大の収穫は **匿名ユーザーが全ユーザーの旅程データを閲覧・改変可能だった RLS の穴（CRITICAL）** の発見と修正。

## Commits（順）
1. `92cb4f8` Security: OCR auth check + auth/callback open-redirect guard
2. `d4b0b3f` Security: OCR rate limits — monthly budget / daily / per-minute
3. `85b3f10` Security: drop unsafe-eval in prod CSP + append Vary: Origin on HTML
4. `57d5d8e` Security: guest/member data isolation — prevent cross-user leak
5. `36e454e` docs: security audit SQL queries for RLS / tokens / usage verification
6. `ba7d2f0` Security (CRITICAL): drop leftover anon-access RLS policies
7. `7381616` Security: CSP nonce (script-src) — drop unsafe-inline in production

## 致命的発見（ba7d2f0）
`pg_policies` 監査で **`Allow anonymous access to journeys` / `Allow anonymous access to steps`** の 2 ポリシーが残留していた:
- `roles = {public}`, `qual = true`, `with_check = true`, `FOR ALL`
- PostgreSQL の RLS は複数ポリシーを OR で結合するため、`toritavi_journeys_own` の `auth.uid() = user_id` 制限を**完全に無効化**
- **状況**: 匿名ユーザーが全ユーザーの旅程・搭乗者名・確認番号・宿泊先を SELECT/INSERT/UPDATE/DELETE 可能
- **原因**: `001_add_user_id.sql` が DROP 対象を `"allow all"` という誤名で指定していた。実名は `"Allow anonymous access to ..."` で生き残った
- **対応**: `006_drop_anon_policies.sql` を作成し live DB で実行、pg_policies で対象 2 行が authenticated スコープのみになったことを確認

## 変更サマリ（主要）

### OCR API（92cb4f8 / d4b0b3f）
- **認証必須化**: `sb.auth.getUser()` → 401 で拒否。Origin ヘッダは curl で偽装可能なので、元の Origin 許可だけでは Anthropic スペンドを任意に焼ける状態だった
- **レート制限 3 段**:
  - 月予算 $20（全ユーザー合算、`toritavi_ocr_budget`）
  - 日次: 50 req / 500k token（per user, `toritavi_ocr_usage`）
  - 分レート: 5 req/min（`toritavi_ocr_events` に timestamp を積んで window クエリ）
- 全て env で上書き可 (`OCR_BUDGET_MONTHLY_CENTS` 他)
- 使用量は `increment_ocr_usage` RPC（SECURITY DEFINER + auth.uid() チェック）で原子的に記録
- `005_ocr_usage.sql` で schema 作成済

### Auth callback open redirect（92cb4f8）
- `/auth/callback?next=//evil.com` で `redirect("${origin}${next}")` → プロトコル相対 URL 解釈で `https://evil.com` へ誘導可能（フィッシング悪用）
- `next` を `^/(?!/)` で validate して、`/` 単スラッシュ始まりの同一オリジン path のみ許可

### CSP（85b3f10 / 7381616）
- `unsafe-eval` を `NODE_ENV === "production"` 時に除外（React dev/HMR のみ許可）
- `unsafe-inline`（script-src）を削除し、**Next.js 16 公式パターンで nonce 化**:
  - `proxy.ts` で `crypto.getRandomValues(16byte)` → base64 nonce
  - `x-nonce` を forwarded request header にセット → Next.js が自動でインラインスクリプトに `nonce=""` 付与
  - `'strict-dynamic'` を追加（信頼スクリプトが読む子スクリプトも連鎖許可）
  - root layout に `dynamic = "force-dynamic"` を設定（静的プリレンダだと build 時に nonce が焼き込まれ、runtime の nonce と一致しなくなるため）
  - style-src は `'unsafe-inline'` のまま（Mantine v7 SSR 依存）— 将来課題
- `upgrade-insecure-requests` も同時に追加
- ローカルで `npm run build && npm run start` 実行、`curl /login` で全 3 script タグに同一 nonce 付与を確認

### ゲスト/会員データ分離（57d5d8e）
- `/auth/callback` は server route で localStorage を触れないため、signup 直後 `toritavi_guest` フラグが残ったまま → ログイン済みなのに guest localStorage データが見える
- **修正**:
  - `store-client.ts`: 認証チェックを先に。認証済みなら自動で `disableGuestMode()` + `clearGuestData()`
  - `login/page.tsx` 成功時 + `handleGuest`、`account/page.tsx` サインアウト時にも `clearGuestData()`
- 共有端末で前ユーザーのゲスト旅程が次ユーザーに見えるリスクを解消

### Vary: Origin 不整合（部分対応）
- 監査で HTML ルートに `Vary: Origin` が乗っていないと指摘
- `withSecHeaders` で `headers.append("Vary", "Origin")` したが、**Next.js の RSC 用 Vary（`rsc, next-router-state-tree, ...`）が middleware 後に set で上書き**するため HTML には反映されない
- ACAO は `https://toritavi.com` 固定（リクエスト Origin で変化しない）なので、キャッシュが原因の情報漏洩は発生しない。**実害なし**と判断して深追い保留

## 監査 SQL（36e454e）
`supabase_migrations/_security_audit_queries.sql` に 8 ブロックのクエリを追加:
- A: RLS 有効化
- B: ポリシー一覧（ここで CRITICAL 発見）
- C: 各ユーザー行数
- D: 他人行アクセス不可のテスト手順
- E: OCR / Concierge 使用量
- F: RPC GRANT 状況（anon に漏れてないか）
- G: `auth.one_time_tokens` で password reset / email verify の単回使用挙動
- H: セッション状況

## 検証結果
- A: 9 テーブル全て `rowsecurity = true` ✅
- B: 監査で `Allow anonymous access to *` 発見 → 削除後は 2 ポリシーのみ（authenticated スコープ）✅
- F: `increment_*_usage` は `authenticated / postgres / service_role` のみ、`anon` / `public` 漏れなし ✅
- G: `recovery_token` 1 件（2 日前の未使用 / 期限切れ）、消費済みは自動削除されるので単回使用が機能している ✅

## Next.js 16 の nonce 実装上の注意
- **全ページ動的レンダリング必須**: 静的プリレンダだと nonce が焼き込まれてしまう。root layout に `export const dynamic = "force-dynamic"`
- **Vercel Edge キャッシュ無効化**: Supabase 認証で既にユーザー別なので実害は限定的
- **Next docs 手順**: `requestHeaders.set('x-nonce', nonce)` + `requestHeaders.set('CSP', ...)` + `response.headers.set('CSP', ...)` の 3 点。docs 通りに実装

## Pending / 次回候補
- **style-src `unsafe-inline`** 撤去: Mantine v7 の CSS-in-JS のレンダラ側対応が必要、工数大。XSS 注入経路（`innerHTML` 等）は現状無いので緊急性低
- **Vary: Origin** の HTML 反映: Vercel / Next.js の RSC Vary 処理をバイパスする方法を調査（優先度低）
- §16 Step マージの Undo Toast 実装
- §17 Bulk Ingest 実装着手

## 参照
- Next.js 16 docs: `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`
- 監査クエリ: `supabase_migrations/_security_audit_queries.sql`
- RLS 修正: `supabase_migrations/006_drop_anon_policies.sql`
