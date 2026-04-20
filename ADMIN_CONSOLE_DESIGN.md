# Toritavi Admin Console — 設計メモ（MVP）

実装日: 2026-04-20
スコープ: read-heavy / ops-light MVP。危険操作は一切持たない。

---

## アーキテクチャ要点

### 認可は 3 層
1. **middleware (`app/src/proxy.ts`)**: `/admin` と `/admin/*` を保護リストへ追加。ログイン必須を担保。**guest cookie によるバイパスは /admin では無効**（上書き）。
2. **server layout (`app/src/app/admin/layout.tsx`)**: `requireAdmin("support_viewer")` を呼び、admin_members に行がないユーザーは `/login` へ返す。ロール不足（将来の上位要求）は `/?admin_denied=1` へ返す。
3. **各 API route (`/api/admin/*`)**: layout と同じ `requireAdmin()` を独立に呼ぶ。middleware や layout を信用しない二重チェック。

### Service-role の閉じ込め
- `@/lib/supabase-service`, `@/lib/admin-auth`, `@/lib/admin-audit`, `@/lib/admin-queries` はいずれも `import "server-only"`。client bundle には絶対に入らない。
- role 判定の DB 参照は **session-aware client** で行う。`toritavi_admin_members` RLS が自己 SELECT のみ許可しているため、service-role 無しで「自分は admin か？」が引ける。
- service-role は以下でのみ使用:
  - auth.users の list/get（Supabase admin API）
  - 全ユーザー横断の集計
  - `toritavi_admin_audit_logs` の書込み・読取り（RLS は deny-all）

### 監査ログ
- `toritavi_admin_audit_logs` は RLS で完全に閉じる（policy 無し）。書き込み・読み取りは service-role 経由のみ。
- 記録対象（MVP）:
  - `admin.dashboard.viewed` — /admin アクセス
  - `admin.user.viewed` — /admin/users/[id] アクセス（page と API 両方で記録）
- IP は SHA-256 先頭 32 文字でハッシュ化して保存。生 IP は残さない。

---

## ファイル一覧

### 新規 migration
- `supabase_migrations/009_admin_members.sql` — 役職テーブル + 自己 SELECT RLS + seed 手順（コメント）
- `supabase_migrations/010_admin_audit_logs.sql` — 監査ログテーブル + RLS deny-all + インデックス

### server-only libs
- `app/src/lib/admin-auth.ts` — `requireAdmin()`, `getAdminContext()`, `AdminAuthError`
- `app/src/lib/admin-audit.ts` — `recordAuditLog()`, `fetchRecentAuditLogs()`
- `app/src/lib/admin-queries.ts` — `fetchAdminSummary()`, `fetchAdminUserList()`, `fetchAdminUserDetail()`, `maskEmail()`

### middleware
- `app/src/proxy.ts` — `/admin` を PROTECTED_PATHS へ追加 + guest bypass の無効化

### UI
- `app/src/app/admin/layout.tsx` — server 認可 + `<AdminShell>` ラップ
- `app/src/components/admin/AdminShell.tsx` — 左サイドバー（固定 240px）+ 上部ヘッダー（email/ロール/ログアウト）、`position: fixed; inset: 0` で body の 430px cap を突破
- `app/src/app/admin/page.tsx` — ダッシュボード（KPI 8 タイル + 最近の操作 + アラート placeholder）
- `app/src/app/admin/users/page.tsx` — 一覧（masked email / ページング 100件/pg / email・user_id 検索）
- `app/src/app/admin/users/[id]/page.tsx` — 詳細（基本情報 / 設定 / 使用量 / 直近 journey / 対象の audit log）
- `app/src/app/admin/security/page.tsx` — 監査ログ + アクション別集計 + 3 枠 placeholder

### API
- `app/src/app/api/admin/summary/route.ts` — GET
- `app/src/app/api/admin/users/route.ts` — GET（raw email は返さない、必ず masked）
- `app/src/app/api/admin/users/[id]/route.ts` — GET（raw email は返さない、viewed を audit）
- `app/src/app/api/admin/security/route.ts` — GET

---

## セットアップ手順（本番への入れ方）

1. **migration 009, 010 を Supabase SQL Editor で実行**
2. **初期 super_admin を seed**（migration 009 の末尾コメント参照）:
   ```sql
   INSERT INTO toritavi_admin_members (user_id, role, created_by)
   SELECT id, 'super_admin', id
     FROM auth.users
    WHERE email = 'kijiatora.regi@gmail.com'
   ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
   ```
3. `SUPABASE_SERVICE_ROLE_KEY` が本番 Vercel env に設定済みであることを再確認（account 削除で既に使用中）
4. デプロイ → `https://toritavi.com/admin` で動作確認

---

## 今回実装した範囲（MVP）

- ✅ `toritavi_admin_members` / `toritavi_admin_audit_logs` スキーマ
- ✅ role 判定基盤（support_viewer / support_operator / super_admin の rank 比較）
- ✅ /admin route guard（middleware + layout + API の三重チェック）
- ✅ admin 専用 layout（consumer 側の AppHeader / TabBar とは完全に分離）
- ✅ `/admin` ダッシュボード（8 KPI + 最近操作 + アラート placeholder）
- ✅ `/admin/users` 一覧（email mask + UUID/email 検索 + ページング）
- ✅ `/admin/users/[id]` 詳細（user_settings / usage / recent journey / 対象 audit log）
- ✅ `/admin/security`（監査ログ + アクション別集計 + 3 placeholder）
- ✅ 4 本の API route（`summary` / `users` / `users/[id]` / `security`）
- ✅ 監査ログ記録（dashboard viewed / user viewed）、IP は SHA-256 ハッシュ化

---

## 次フェーズに回した範囲

### 画面
- `/admin/journeys` 一覧
- `/admin/journeys/[id]` 詳細
- `/admin/ocr` メトリクス（月次時系列、ユーザー別ランキング）
- `/admin/concierge` メトリクス
- `/admin/settings`（admin_members 編集 UI、role 変更、メンバー追加）
- `/admin/audit` 専用ページ（現状は /admin/security に同居）

### 機能
- 管理メモ欄（`toritavi_admin_user_notes` 相当を用意）
- 操作 CTA（メール変更補助 / パスワード強制リセット / 個別 journey の閲覧・編集）
  - 追加時は **必ず** `ConfirmDialog` + 監査ログ + super_admin 制限
- Security ダッシュボードの実データ化:
  - アカウント削除 試行（/api/account/delete 呼出しをイベント化する必要あり）
  - OCR / Concierge rate-limit hit（既存の usage カウンタから再構成）
  - 401/403 counter（middleware で軽量計測）
- `toritavi_admin_audit_logs` 表示のフィルタ UI（actor / action / target 絞り込み）
- Vercel Analytics / Sentry 連携（観測性）
- CSV エクスポート（利用者リスト等）

### セキュリティ強化
- Rate limiting on `/api/admin/*`（例: 1 IP から 120 req/min を超えたら 429）
- 重要操作に 2FA 要求（再認証）
- IP allow-list（super_admin のみ）
- Audit log の改ざん検知（hash chain）

---

## 今回採用しなかった設計上の選択肢（記録）

| 候補 | 採用せず | 理由 |
|---|---|---|
| middleware で role 判定 | × | Edge runtime で毎回 DB を叩く副作用 + middleware だけ突破できたら終わるので二重防御を優先 |
| super_admin を環境変数で自動昇格 | × | 監査できず、ROTATE 時に事故る。手動 SQL seed が最も透明 |
| 一覧で raw email 表示 | × | PII 漏洩ベクタ減らす。詳細で必要な時だけ unmask |
| page が `/api/admin/*` を HTTP で叩く | × | 同一プロセスで無駄。page は lib を直接呼び、API route は外部向けの同等ラッパー |
| admin 用 TabBar 再利用 | × | デザインシステム v2 は consumer 向け。admin は desktop-first の独立シェル |

---

## 既知の限界

1. **大規模ユーザー時のスケール**: `fetchAdminSummary` と `fetchAdminUserList` の検索パスで `admin.auth.admin.listUsers` を perPage=1000 で回している。ユーザー数が数千を超えたら、独自の `toritavi_user_profiles`（email インデックス付き）への移行が必要。
2. **当日アクティブ判定**: `last_sign_in_at` ベース。セッション更新のたびに書き換わるので、厳密な「当日ログイン」ではなく「直近更新が当日」に近い。
3. **集計は UTC**: ダッシュボードの "当日" は UTC 基準。JST 運用なら要変更。
4. **監査ログの retention 未定**: 無限に積もるので、30〜90 日で pruning するジョブが必要（次フェーズ）。
