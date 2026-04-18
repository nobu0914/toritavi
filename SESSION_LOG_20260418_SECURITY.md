# セッションログ 2026-04-18 セキュリティ確認

## セッション概要
- **期間**: 2026-04-17 〜 2026-04-18
- **テーマ**: 認証機能の指示整理と `toritavi.com` 公開面の非破壊セキュリティ再テスト
- **対象URL**: `https://toritavi.com/`
- **前提**: 公開面のみを `curl` ベースで確認。侵入的テスト、負荷試験、ログイン後の認可テストは未実施

---

## 実施内容

### 1. 認証機能の要求整理
- 会員登録、ログイン、Google認証、メール認証、パスワード再設定を含む指示概要を作成
- Claude Code に渡せる開発指示書を作成
- 会員登録不要でサンプルデータを触れる「テストモード導線」を要件に追記

### 2. セキュリティチェック計画の作成
- `toritavi.com` 向けのセキュリティチェックプランを作成
- その後、診断会社や Claude Code に渡せる「セキュリティ診断依頼書」形式に整理

### 3. 初回の公開面テスト
- `https://toritavi.com/` の HTTP/HTTPS、`/login`、`/signup`、`/forgot-password` を確認
- 初期所見として以下を指摘
  - セキュリティヘッダー不足
  - `access-control-allow-origin: *` の露出
  - `robots.txt` / `/.well-known/security.txt` 未整備

### 4. ユーザー修正後の再テスト
- ユーザーからの対応報告を受けて再テスト
- 以下を確認
  - `Content-Security-Policy`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy`
  - `/.well-known/security.txt` と `/robots.txt` の 200 応答
  - `/api/ocr` への cross-origin POST が 403

### 5. CORS 残課題の再々テスト
- ユーザーから「`access-control-allow-origin: *` を `https://toritavi.com` に上書きした」と報告あり
- 再テスト結果
  - `/login`, `/signup`, `/forgot-password`, `/robots.txt`, `/.well-known/security.txt`, `/` の 307 応答で `access-control-allow-origin: https://toritavi.com`
  - 今回確認した範囲では `access-control-allow-origin: *` は未検出
  - `/api/ocr` の cross-origin POST 403 は維持

---

## 確認結果の要点

### 改善確認済み
- HTTPS 強制と HSTS は有効
- 認証関連ページへ主要セキュリティヘッダーが付与済み
- `security.txt` と `robots.txt` は公開済み
- `/api/ocr` の cross-origin POST は 403 で拒否
- 公開面での `access-control-allow-origin: *` は今回確認範囲では解消

### 残課題
- `Vary: Origin` は `/robots.txt`、`/.well-known/security.txt`、`/` の 307 応答では確認できたが、`/login`、`/signup`、`/forgot-password` の HTML 応答では確認できなかった
- `CSP` が Mantine v7 / Next.js 16 の実ブラウザ表示に影響していないかは未確認
- preview deployment で `ACAO: https://toritavi.com` 固定が支障にならないか未確認
- 認可、Supabase RLS、メール認証、パスワード再設定トークン、ゲストモード分離の検証は未着手

---

## Claude Code への共有文面
- セキュリティ再テスト結果は、コピペしやすいプレーンテキスト形式で複数回整形して回答済み
- 最新版では以下を共有した
  - `access-control-allow-origin: *` は未検出
  - `access-control-allow-origin: https://toritavi.com` を確認
  - `/api/ocr` の 403 は維持
  - `Vary: Origin` は HTML では未確認

---

## 次回の推奨アクション
1. preview deployment の実URLで CORS ヘッダー確認
2. 実ブラウザで `/login`、`/signup`、`/forgot-password` の表示と操作確認
3. 認証後ページの認可テストと Supabase RLS 検証
4. メール認証リンク、パスワード再設定トークンの再利用・期限切れテスト
5. ゲストモードと本会員データの分離確認
