# Toritavi 認証セットアップ手順（Phase 1）

Phase 1 で実装した認証機能を動かすために、Supabaseダッシュボード側で必要な作業をまとめます。
Google OAuth は Phase 2 で有効化するため、今回はメール/パスワードのみの設定で動作確認できます。

---

## 1. SQL マイグレーション実行

Supabase Dashboard → SQL Editor で以下を実行します。

**ファイル**: `supabase_migrations/001_add_user_id.sql`

このマイグレーションは以下を行います：
- 既存の `toritavi_journeys` / `toritavi_steps` のデータを **削除**（TRUNCATE）
- `user_id` 列を両テーブルに追加（`NOT NULL`、`auth.users` への FK）
- Row Level Security 有効化
- 自分のデータしか見えない/変更できないポリシーを追加

> ⚠️ `TRUNCATE` が含まれるため、実行前にバックアップは不要だが確認してください（genbox2共用プロジェクトのため、他プロジェクトに `toritavi_*` 以外のテーブルが影響を受けることはありません）。

---

## 2. Supabase Auth 設定

### 2-1. Email Provider の確認

Dashboard → Authentication → Providers → **Email** を開き、有効化されていることを確認。

- **Confirm email**: ON（デフォルト）
- **Secure email change**: ON（デフォルト）

### 2-2. Site URL / Redirect URL の設定

Dashboard → Authentication → URL Configuration

| 項目 | 値 |
|---|---|
| **Site URL** | `https://app-lime-seven-80.vercel.app` |
| **Redirect URLs** | `https://app-lime-seven-80.vercel.app/auth/callback`<br>`http://localhost:3000/auth/callback`（開発用） |

> Vercel Preview ドメインも使うなら、`https://*.vercel.app/auth/callback` を Redirect URLs に追加。

### 2-3. メールテンプレートの日本語化（任意）

Dashboard → Authentication → Email Templates

- **Confirm signup** / **Reset password** などの件名・本文を日本語に差し替えると体験が良くなります（後回しでOK）。

---

## 3. 動作確認（Phase 1）

Vercel デプロイ完了後、以下のフローを一通り試してください。

### ✅ 新規登録 → メール認証 → ログイン
1. `/signup` にアクセス（未ログイン時は自動で来る）
2. メールアドレス + パスワード（英字+数字、8文字以上）で登録
3. 登録したメール受信箱で Supabase からの確認メールを開き、リンクをタップ
4. `/auth/callback` 経由で `/`（旅程画面）に着地すれば成功
5. 一度ログアウト（アカウント画面）→ `/login` で再ログインできることを確認

### ✅ パスワード再設定
1. `/login` → 「パスワードをお忘れですか？」をタップ
2. 登録済みメールアドレスを入力 → メール送信
3. メールのリンクをタップ → `/reset-password` に着地
4. 新パスワードを設定 → `/login` に戻る
5. 新パスワードでログインできれば成功

### ✅ ゲストモード（会員登録なし）
1. `/login` → 「ゲストで試す」
2. サンプル Journey 3 件が表示される
3. 上部に黄色い「ゲストモード（データは端末内のみ）」バナーが出る
4. アカウント画面から「本登録する」で `/signup` に遷移できる
5. アカウント画面の「ゲストモードを終了」でサンプルデータが消える

### ✅ 認証必須ページの保護
1. 未ログイン & 非ゲスト時に `/` や `/scan` に直接アクセス → `/login` にリダイレクトされる
2. ログイン済み時に `/login` に直接アクセス → `/` に戻される

---

## 4. Phase 2 で対応予定

### Google ログイン

以下を事前に準備しておくと Phase 2 で組み込みやすくなります（Phase 2着手時に案内します）：

1. **Google Cloud Console** で OAuth クライアント作成
   - Application type: Web application
   - Authorized redirect URI: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
     - `<PROJECT_REF>` は Supabase project の ref（dashboard URL に含まれる）
   - 発行された Client ID / Client Secret を控える
2. **Supabase Dashboard** → Authentication → Providers → **Google** を有効化
   - Client ID と Client Secret を貼り付け
3. `Google でログイン（準備中）` ボタンを活性化するコード変更（Phase 2 でこちらが対応）

---

## 5. アーキテクチャメモ

### データストア分離

| モード | ストア | 永続化先 |
|---|---|---|
| ログイン済み | `store-client.ts` / `store-server.ts` | Supabase（RLS で user_id で自動フィルタ） |
| ゲスト | `store-guest.ts` | ブラウザ localStorage |

`@/lib/store-client` がゲスト判定を内包して透過的に切替します。Server Components（`page.tsx`）は `@/lib/store-server` を使用します（ゲストは cookie 検知で Client に委譲）。

### ルート保護

`src/middleware.ts` が全リクエストに対して：
1. `toritavi_guest=1` cookie → そのまま通す
2. Supabase session あり → そのまま通す / `/login` 系は `/` へ
3. どちらもなし & 保護パス → `/login` へリダイレクト

保護対象: `/`, `/scan`, `/alerts`, `/unfiled`, `/account`, `/trips/*`
公開対象: `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`, `/auth/callback`
