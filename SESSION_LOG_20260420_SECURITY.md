# セッションログ 2026-04-20 セキュリティ再チェック

## セッション概要
- **日時**: 2026-04-20
- **テーマ**: `toritavi.com` 公開面の非破壊セキュリティ再チェック
- **対象URL**:
  - `https://toritavi.com/`
  - `/login`
  - `/signup`
  - `/forgot-password`
  - `/reset-password`
  - `/verify-email`
  - `/scan`
  - `/alerts`
  - `/account`
  - `/unfiled`
  - `/robots.txt`
  - `/.well-known/security.txt`
  - `/api/ocr`
- **前提**:
  - 公開面のみを `curl` ベースで確認
  - 非破壊・低負荷のヘッダー確認と CORS 確認のみ
  - ログイン後ページ、認可、RLS、侵入的テスト、負荷試験は未実施

---

## 実施内容

### 1. 主要公開ページのヘッダー再確認
- `/`、`/login`、`/signup`、`/forgot-password`、`/reset-password`、`/verify-email` のヘッダーを確認
- 主要セキュリティヘッダーの継続付与を確認

### 2. 匿名アクセス制御の確認
- `/scan`、`/alerts`、`/account`、`/unfiled` への匿名アクセスが `/login` にリダイレクトされることを確認

### 3. HTTP→HTTPS リダイレクト確認
- `http://toritavi.com/` が `https://toritavi.com/` へ `308 Permanent Redirect` することを確認

### 4. 公開ファイル確認
- `/robots.txt` の内容確認
- `/.well-known/security.txt` の内容確認

### 5. CORS / OCR API 再確認
- `OPTIONS /api/ocr` を cross-origin で確認
- `POST /api/ocr` を `Origin: https://evil.example` 付きで送信し、`403 Forbidden` を確認

---

## 確認できた良い点

### HTTPS / 基本ヘッダー
- HTTP は HTTPS へ 308 redirect
- `Strict-Transport-Security` は有効
- 以下を再確認
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy`
  - `Content-Security-Policy`

### 匿名アクセス制御
- 以下は匿名時に `/login` へ 307 redirect
  - `/scan`
  - `/alerts`
  - `/account`
  - `/unfiled`

### 公開ファイル
- `/robots.txt` は 200
- `/.well-known/security.txt` は 200
- `security.txt` の内容:
  - `Contact: mailto:security@toritavi.com`
  - `Expires: 2027-04-18T00:00:00.000Z`
  - `Preferred-Languages: ja, en`

### OCR API
- cross-origin `POST /api/ocr` は 403 を維持
- これは前回確認した改善が継続している状態

### Cookie
- 今回確認した公開認証ページでは、レスポンスヘッダー上の `Set-Cookie` は未検出

---

## 主な懸念点

### 1. CSP がまだ緩い
- **深刻度**: Medium
- 公開HTMLの `Content-Security-Policy` で、`script-src` に以下が残っている
  - `'unsafe-inline'`
  - `'unsafe-eval'`
- 確認対象:
  - `/login`
  - `/signup`
  - `/forgot-password`
  - `/reset-password`
  - `/verify-email`
- CSP 自体は入っているが、XSS 緩和としてはまだ弱い

### 2. `Vary` の扱いに一貫性がない
- **深刻度**: Low
- `Vary: Origin` を確認できたのは:
  - `/` の 307
  - `/robots.txt`
  - `/.well-known/security.txt`
  - `/api/ocr`
- 一方、HTML応答では以下の `Vary` のみ確認
  - `rsc`
  - `next-router-state-tree`
  - `next-router-prefetch`
  - `next-router-segment-prefetch`
- `Access-Control-Allow-Origin: https://toritavi.com` を返している設計としては、一貫性の整理余地あり

---

## 補足観察

### `OPTIONS /api/ocr`
- `204 No Content`
- `Allow: OPTIONS, POST`
- `Access-Control-Allow-Origin: https://toritavi.com`
- `Vary: Origin`

### `POST /api/ocr` with evil origin
- `403 Forbidden`
- body: `{"error":"Forbidden"}`

### `robots.txt`
- 以下が `Disallow`
  - `/api/`
  - `/auth/`
  - `/trips/`
  - `/scan`
  - `/account`
  - `/alerts`
  - `/unfiled`
  - `/reset-password`
  - `/forgot-password`
  - `/verify-email`

---

## 今回の結論
- 公開面の基本防御は維持されている
- 今回の範囲では重大な公開設定ミスは未確認
- ただし次の優先課題は明確
  1. 本番CSPから `'unsafe-eval'` を外せるか確認
  2. `'unsafe-inline'` を nonce / hash ベースへ寄せる方針整理
  3. `Origin / Vary` の扱いを一貫化

---

## 次回の推奨アクション
1. 本番CSPから `unsafe-eval` を外せるか検証
2. `unsafe-inline` を削減できる箇所の棚卸し
3. HTML 応答で `Access-Control-Allow-Origin` を返す必要性の整理
4. `Vary: Origin` を付ける / 付けない方針の統一
5. ログイン後ページの認可確認
6. Supabase RLS の検証
7. パスワード再設定トークン再利用テスト
8. メール認証リンク再利用テスト
9. ゲストモードと会員データ分離確認

---

# 追加: 非破壊セキュリティ検査レポート（ラウンド2）
実施日: 2026-04-20
対象: https://toritavi.com
対象アカウント: テスト用会員アカウント 1 件
検査方針: 非破壊。ログイン、認証後ルート保護、アカウント配下ページ、recovery セッション固定、破壊系 API の safe method 確認のみ。データ削除・アカウント削除・他人データ変更・高負荷試験は未実施。

## 今回の結論
今回の非破壊範囲では、重大な認証/認可崩れは未確認でした。
新規のアカウント下層ページも含め、未ログイン時は `/login` へ閉じ、ログイン時は到達可能という基本ガードは成立していました。
また、recovery セッションを `/reset-password` に固定する挙動も確認できました。

## 実施内容

### 1. 認証確認
- Supabase の password login でテストアカウントの認証に成功
- 有効な会員セッション Cookie を取得して、その Cookie で本番ルート保護を確認

### 2. 未ログイン時の保護ルート確認
以下は未ログイン時に `307 -> /login` を確認:
- `/`
- `/scan`
- `/alerts`
- `/unfiled`
- `/account`
- `/account/profile`
- `/account/notifications`
- `/account/help`
- `/account/data`

### 3. 未ログイン時の公開 auth ルート確認
以下は未ログイン時に `200` を確認:
- `/login`
- `/signup`
- `/forgot-password`
- `/reset-password`
- `/verify-email`

### 4. ログイン時の保護ルート確認
以下はログイン時に `200` を確認:
- `/`
- `/scan`
- `/alerts`
- `/unfiled`
- `/account`
- `/account/profile`
- `/account/notifications`
- `/account/help`
- `/account/data`

### 5. ログイン時の公開 auth ルート確認
以下はログイン時に `307 -> /` を確認:
- `/login`
- `/signup`
- `/forgot-password`

### 6. recovery セッション固定確認
`toritavi_recovery=1` を持つ認証済みセッションで確認:
- `/account` へ行くと `307 -> /reset-password`
- `/reset-password` は `200`
→ recovery セッションを通常画面へ流さず、`/reset-password` に固定する保護は有効

### 7. 破壊系 API の safe method 確認
`/api/account/delete` について:
- `GET /api/account/delete` → `405`
- `OPTIONS /api/account/delete` → `204`
- `Allow: OPTIONS, POST`
→ safe method で誤って削除処理が走らないことを確認

## コード上も確認した点

### `app/src/app/account/data/page.tsx`
- 危険操作は `ConfirmDialog` 経由
- 対象:
  - ログアウト
  - 端末内キャッシュ削除
  - すべての旅程データ削除
  - アカウント削除
  - ゲストモード終了

### `app/src/app/api/account/delete/route.ts`
- `POST` 専用
- リクエストのセッション Cookie から `sb.auth.getUser()` で本人確認
- 未認証時は `401 Unauthorized`
- service role client が無い場合は `500`
- avatar cleanup は best-effort
- その後 `admin.auth.admin.deleteUser(user.id)` を実行する構造
- 最後に `sb.auth.signOut()` を best-effort で実施

### `app/src/app/account/profile/page.tsx`
- ゲスト / ログイン済みで UI 分岐あり
- 画像削除には確認ダイアログあり
- 画像アップロード失敗時トーストあり
- ゲストでは画像変更不可

## 今回の範囲での評価
- 認証後ページ保護: PASS
- 新規アカウント配下ページのルート保護: PASS
- recovery セッション固定: PASS
- 破壊系 API の safe method 制御: PASS
- 明白な公開面の認証/認可崩れ: 未確認

## 残リスク / 未確認事項
今回の非破壊検査では以下は未確認または未完:
- 2アカウントを使ったクロスアクセス確認
  - 他人の Journey ID / URL を知っている場合に閲覧・更新できないことの確認
- パスワード再設定リンクの再利用確認
- メール認証リンクの再利用確認
- 実ブラウザ操作での ConfirmDialog 表示確認
- プロフィール画像アップロード UI の実ブラウザ確認
- アカウント削除・全データ削除の実動確認
- OCR / scan の認可境界確認
- `style-src 'unsafe-inline'` の削減
- HTML 応答での `Access-Control-Allow-Origin` と `Vary: Origin` の方針整理

## 次に推奨する非破壊テスト
1. テスト用アカウントを 2 つ使って cross-user データ分離確認
2. recovery / verify-email のリンク再利用確認
3. 実ブラウザで `/account/profile` `/account/data` の確認ダイアログを目視確認
4. プロフィール画像アップロードの成功/失敗ハンドリング確認
5. `/scan` と OCR 関連ルートの会員/ゲスト境界確認

## リリース前に別環境でやりたい踏み込み検査
本番ではなく staging / preview / 専用検証環境で実施推奨:
- IDOR テスト
- XSS 注入確認
- パスワード再設定トークン再利用
- メール認証リンク再利用
- 画像アップロード境界値テスト
- レート制限確認
- アカウント削除・全削除の実動確認
- Supabase RLS / Storage policy の再監査

## 補足
今回はブラウザ UI 自動操作ではなく、HTTP 応答確認 + 実装コード確認を組み合わせた非破壊検査。
したがって、ルート保護と API メソッド制御には一定の確度がある一方、UI 上の押下体験や表示崩れ、確認ダイアログの見え方までは未確定。
