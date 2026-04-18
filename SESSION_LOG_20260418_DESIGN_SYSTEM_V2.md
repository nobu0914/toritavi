# セッションログ 2026-04-18 Design System v2 全面適用

## セッション概要
- **日付**: 2026-04-18（継続セッション）
- **テーマ**: Design System v2 の設計拡張 → 本体適用 → 検証 → デプロイ
- **対象URL**: https://toritavi.com/
- **前提**: 前セッションで認証導線と公開面セキュリティ対応は完了済み

---

## 実施内容

### 1. デザインシステム v2 の拡張（mock/design-system-v2.html）
- 617行 → 3729行に拡張
- 全12セクション構成
  - Color / Typo / Radius / Icons / Components / Toritavi-Content
  - Auth-States / Scan-OCR / System-Feedback / Journey-Detail / Previews / Guidelines
- Grocery Shop Mobile App UI Kit 風フラットアイコン 47種を SVG スプライトで実装
- 日英切り替え機能を追加（`[data-ja]`/`[data-en]` + body.lang-ja/en、JSで永続化）
- ChatGPT によるブラッシュアップ指摘に対応
  - auth-card のハードコード 12px → `var(--r-md)`
  - auth-title `fw-bold` → `fw-heavy` (800) に統一
  - アイコン専用ボタンに aria-label を追加（戻る/閉じる/通知/電話/メッセージ/パスワード表示）
  - scan のカテゴリラベルを実装と一致させた（列車→鉄道）
  - `--btn-h-sm/md/lg` トークンを追加

### 2. アカウント下層ページのモック作成（mock/account-subpages.html）
- 新規作成 ~1300 行
- 4 サブページ設計: profile（ログイン/ゲスト）、通知、ヘルプ、データ管理
- プロフィール画像変更フロー: アクションシート → トリミングUI → アップロード進捗
- 破壊的アクション向けの Confirm Dialog パターン

### 3. 本体適用（Phase 1〜3）
#### Phase 1: トークン基盤
- `app/src/app/design-tokens.css` を新規作成（~230 行）
- DS トークン一式 + Mantine ブリッジ（red→danger / teal→success / blue→info / gray→neutral / violet→test / orange→accent）
- Mantine Button / TextInput / Alert / Modal へのコンポーネント級 override を定義
- `app/src/app/theme.ts` を書き直し（brand を DS ink スケールに、accent を DS accent スケールに）
- `app/src/app/globals.css` を `var(--font-sans)` / `var(--bg)` / `var(--text)` ベースに
- `app/src/app/layout.tsx` の `themeColor` を `#0F1B2D` に、`statusBarStyle` を `black-translucent` に

#### Phase 2: 画面適用（5 画面を順番で）
- TOP → Journey 詳細 → 登録(/scan) → 反映(/trips/new) → ログイン・新規登録
- それぞれ module.css を DS 準拠で書き換え
- Journey cover は `primary=hero-gradient-primary` / `dark=ink-700→900` / `muted=n-100→200` の variant で切替
- Journey badge は `data-state` 属性で状態ごとに色分け
- Journey 詳細ヒーローは `--hero-gradient` 適用
- Timeline の状態バッジはインラインスタイル廃止、`data-state` 属性に統一

#### Phase 3: A案（全面ロールアウト）
- 残コンポーネント + Mantine ブリッジを全域適用
- `sed` で `var(--mantine-color-*)` を一括置換し、生 Mantine 色参照を 0 件に

### 4. 個別バグ修正と調整
- **AppHeader**: `mantine-blue-7` → DS `ink-800` に変更し、ヘッダー左右の余白を `100vw + calc(50% - 50vw)` のフルブリード手法で解消
- **TabBar**: アクティブインジケータとテキストの重なりを解消
  - 最終形: `gap:6px` / `padding:16px 4px 8px` / `::before top:4px, height:62px`, `z-index:-1 + isolation:isolate`
- **j-flow アウトライン**: 上辺の切れ対策で `padding:6px 0 4px + margin:-6px 0 0 + overflow-y:visible`
- **`/scan` 画面が青すぎる問題**: 入力カードのラベル色を `info-700` → `ink-800` に変更、アイコンのみ `info-700` を残し DS 原則「Accent は点で使う」に準拠
- **GuestBanner 削除**: ユーザー指示でゲストモードテロップを撤去
  - `app/src/app/layout.tsx` の import と `<GuestBanner />` レンダーを削除
  - `app/src/components/GuestBanner.tsx` ファイルごと削除

### 5. 機能バグ修正
#### 会員ユーザーで予定が反映されない問題（3 連鎖のサイレント失敗）
- **`app/src/lib/store-supabase.ts`**: `addJourney` / `updateJourney` で Supabase の `{ error }` を受け取っていなかった。`jErr`/`sErr`/`uErr`/`dErr` を throw するよう修正
- **`app/src/app/scan/page.tsx`**: `} catch { setRegistering(false); }` の空 catch を、赤トースト表示付きの catch に置き換え
- **`app/src/app/TripsClient.tsx`**: `if (!isGuestMode()) return;` でログイン時に再取得をスキップしていた。常に `getJourneysClient()` で再取得するよう修正

### 6. 検証と動作テスト
- TypeScript: 0 エラー
- ESLint: 新規エラーなし（既存の pdfjs バンドル / LoadingOverlay の警告のみ）
- Production build: 21 ルート成功（static 18 + dynamic 3）
- DS コンプライアンス: ソースに生 `var(--mantine-color-*)` 参照 0 件
- HTTP スモークテスト
  - 公開 auth ルート (`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`) → 200
  - 保護ルート (`/`, `/scan`, `/trips/new`, `/alerts`, `/unfiled`, `/account`, `/auth/callback`) → 307 redirect to `/login`（proxy middleware 動作確認済）
  - `/api/ocr` GET → 405, 空 POST → 500（想定通り）
  - 静的 (`robots.txt`, `security.txt`, `manifest.json`) → 200

### 7. デプロイ
- `0e64e03 Remove GuestBanner sticky banner + verified test suite` を main へ push
- Vercel 自動デプロイで `https://toritavi.com` へ反映

---

## ブラウザでの手動確認推奨項目
- 実ログイン → `/scan` で予定登録 → TOP に反映されるか
- 失敗時に赤トーストが出るか
- ゲストモードでサンプルデータが表示されるか
- 各画面の視覚的整合性（DS 準拠）

---

## 主要成果物
- `mock/design-system-v2.html`（3729 行）
- `mock/account-subpages.html`（新規 ~1300 行）
- `app/src/app/design-tokens.css`（新規 ~230 行）
- `app/src/app/theme.ts`（DS スケール書き直し）
- `app/src/app/layout.tsx`（DS ベース）
- `app/src/app/page.module.css`（TOP DS 準拠）
- `app/src/app/trips/[id]/page.module.css` + `TripDetailClient.tsx`（Journey 詳細 DS 準拠）
- `app/src/app/scan/page.module.css` + `page.tsx`（Scan DS 準拠 + エラートースト）
- `app/src/lib/store-supabase.ts`（エラー伝搬修正）
- `app/src/app/TripsClient.tsx`（ログイン時再取得）
- `app/src/components/AppHeader.tsx`（ink-800 フルブリード）
- `app/src/components/TabBar.module.css`（アクティブ重なり修正）

---

## 次回アクション候補
- 実ブラウザでの全画面目視確認（DS 準拠の整合性検証）
- Supabase RLS 検証
- 認証後ページの認可テスト
- パスワード再設定 / メール認証トークン再利用確認
- ゲストモードと本会員データ分離確認
- preview deployment での CORS 挙動確認
