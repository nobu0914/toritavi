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
