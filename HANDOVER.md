# Toritavi 引き継ぎドキュメント

## 概要
toritavi は Journey（目的ある外出・旅行）を管理する Web アプリケーション。
TripIt がスケジュールを整理するのに対し、toritavi は「次に何をすべきか」を駆動する。

- **技術スタック**: Next.js 16.2.3 (Turbopack) + Mantine v7 + TypeScript
- **データ永続化**: localStorage（将来的にはバックエンド/DB）
- **将来計画**: Webアプリ → モバイルアプリ化
- **本番URL**: https://app-lime-seven-80.vercel.app
- **リポジトリ**: https://github.com/nobu0914/toritavi

---

## デプロイ

- **ホスティング**: Vercel (Hobby)
- **自動デプロイ**: GitHub連携済み。mainへのpushで自動ビルド・デプロイ
- **Root Directory**: `app`
- **手動デプロイ不要**: `vercel --prod` は不要

```
コード変更 → git push origin main → Vercel自動ビルド → 本番反映
```

PC（VSCode）からでもスマホ（claude.ai/code）からでも、pushすれば自動で本番に反映される。

---

## ディレクトリ構成

```
Toritavi/
├── CLAUDE.md              # プロジェクト指示
├── HANDOVER.md            # このファイル
├── mock/                  # デザインモック HTML
│   ├── index.html         # 全画面モック（参照用）
│   ├── design-system.html
│   └── design-system-mantine.html
└── app/                   # Next.js アプリ本体
    ├── package.json
    ├── next.config.ts
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx        # ルートレイアウト（MantineProvider, PullToRefresh）
    │   │   ├── page.tsx          # トップ: Journey一覧（Upcoming/Past切替）
    │   │   ├── globals.css       # body max-width:430px 中央揃え
    │   │   ├── theme.ts          # Mantine テーマ設定
    │   │   ├── trips/
    │   │   │   ├── new/page.tsx  # 新規Journey作成
    │   │   │   └── [id]/page.tsx # Journey詳細（タイムラインUI）
    │   │   ├── alerts/page.tsx   # アラート（モック静的データ）
    │   │   ├── unfiled/page.tsx  # 未整理（空状態表示）
    │   │   └── account/page.tsx  # アカウント（モック静的データ）
    │   ├── components/
    │   │   ├── AppHeader.tsx     # 共通ヘッダー（sticky, 戻るボタン対応）
    │   │   ├── TabBar.tsx        # 共通タブバー（fixed, 4タブ, 日本語）
    │   │   ├── TabBar.module.css
    │   │   ├── StepEditModal.tsx     # ステップ編集モーダル（共通）
    │   │   ├── StepEditModal.module.css
    │   │   └── PullToRefresh.tsx     # プルトゥリフレッシュ
    │   └── lib/
    │       ├── types.ts          # データ型定義
    │       ├── store.ts          # localStorage CRUD
    │       └── helpers.ts        # カテゴリアイコン, 日付フォーマット等
    └── AGENTS.md
```

---

## データモデル（types.ts）

```typescript
type StepStatus = "未開始" | "進行中" | "完了" | "遅延" | "キャンセル";
type StepCategory = "列車" | "飛行機" | "バス" | "車" | "徒歩"
                  | "宿泊" | "商談" | "食事" | "観光" | "その他";
type StepSource = "撮影" | "アップロード" | "メール" | "手入力";

type Information = { id: string; label: string; value: string; };

type Step = {
  id: string;
  category: StepCategory;
  title: string;
  time: string;
  detail?: string;
  confNumber?: string;
  memo?: string;
  source?: StepSource;
  status: StepStatus;
  information: Information[];
};

type Journey = {
  id: string;
  title: string;
  startDate: string;  // YYYY-MM-DD
  endDate: string;
  memo?: string;
  steps: Step[];
  createdAt: string;
  updatedAt: string;
};
```

---

## 各ページの状態と実装内容

### トップページ `/` (page.tsx)
- localStorage から Journey 一覧を読み込み
- `toritavi_journeys` が空ならサンプル Journey 3 件を自動投入
- Upcoming / Past セグメントコントロールで切替（モック `.seg` 準拠）
- 各 Journey をカード表示（カバー: タイトル+日付 / ボディ: plans数+カテゴリアイコン+残日数バッジ）
- FAB（+）ボタン → /trips/new へ遷移（現在黄色 #fab005）
- **スケルトンUI**: データ読み込み中にカード3枚分のプレースホルダー表示
- **空状態メッセージあり**

### 新規作成 `/trips/new` (trips/new/page.tsx)
- `mock/index.html` の `s-new` に準拠した UI
- タイトル入力（form-sec 風）
- ステップリスト（未登録=4ボタン / 登録済み=情報行表示）
- 未登録ステップの4アクション: 撮影, アップロード, メール, 手入力
  - 「手入力」→ StepEditModal（共通コンポーネント）
  - 「撮影」→ カメラモーダル（プレビュー枠, OCR説明）
  - アップロード/メール → 未実装（onClickなし）
- 登録済みステップ: 緑枠カード, アイコン付き情報行, サムネイル枠, ソースバッジ
- ステップ間コネクター（+）で途中挿入可能
- フッター: 「下書き保存」＋「作成」（プレーンbutton）
- **サンプルデータ3件**: 列車/商談/宿泊の登録済み + 1件未登録
- 下書き保存/復元は localStorage で実装済み

### Journey詳細 `/trips/[id]` (trips/[id]/page.tsx)
- **スケルトンUI**: データ読み込み中にヘッダー+タイムライン形状のプレースホルダー
- ヒーロー領域（タイトル, 日付範囲, カテゴリ別カウント）
- ヘッダーとヒーロー間に白ライン（border-top）
- タイムラインUI（時刻列 → ドット＋縦線 → ステップカード）
  - ドット色: 完了=teal, 進行中=blue(影付き), 未開始=白枠
  - 線色: ステータスに連動
- ステップカード: カテゴリアイコン, タイトル, 時間, 詳細, Conf#（別行表示）, ステータスバッジ
- ステップ操作（…メニュー）: ステータス変更, 編集, 削除
- カードクリック → StepEditModal（共通コンポーネント）
- Journey 自体の編集モーダルあり（タイトル/日付/メモ）
- ヘッダー（…メニュー）→ Journey削除
- **FAB なし**（削除済み）

### Alerts `/alerts` — モック準拠のアラートカード（ドット+タイトル+説明+時間）3件
### Unfiled `/unfiled` — モック準拠の空状態（アイコン+テキスト）
### Account `/account` — モック準拠（プロフィール+Stats+メニュー）

---

## 共通コンポーネント

### StepEditModal
- 新規作成・詳細編集の両方で使用する統一モーダル
- form-sec スタイル（gray-0背景, 独自ヘッダー, form-row区切り）
- フィールド順: カテゴリ → タイトル → 詳細・場所 → 時刻|確認番号（横並び）
- ボタン文言: 新規「保存」/ 編集「更新」

### PullToRefresh
- layout.tsx で全画面を包む
- スマホで画面最上部から下スワイプ → 「引っ張って更新」→「離すと更新」→ リロード

---

## UI共通ルール

- **ヘッダー**: sticky, blue-7背景, 白文字, z-index:100
- **TabBar**: fixed bottom, 白背景, 4タブ（旅程/通知/未整理/アカウント）, z-index:200, 上部にアクティブライン
- **FAB**: z-index:150（TabBarの下）, border-radius:50%
- **body**: max-width:430px, margin:0 auto, gray-0(#f8f9fa)背景
- **フォント**: システムフォントスタック（-apple-system, BlinkMacSystemFont, ...）
- **デザインシステム**: Mantine v7 のデフォルトカラー（Open Color ベース）
- **primary色**: blue-7 (#1c7ed6)

---

## 未実装・要対応事項

1. **撮影/OCR** — カメラモーダルは表示のみ。実際のカメラ起動やOCR処理は未実装
2. **アップロード** — ファイルアップロード機能未実装
3. **メール取込** — メール転送→パース機能未実装
4. **日付入力の扱い** — モックは新規作成で日付入力を見せていないが、データモデル上は startDate/endDate が必須
5. **Alerts** — 静的データ。通知システム未実装
6. **Account** — 静的データ。認証・ユーザー管理未実装
7. **ステップ並べ替え** — ドラッグ&ドロップ未実装

---

## 作業サマリ（2026-04-11 スマホ claude.ai/code セッション）

- **FABボタン色変更（テスト）**: 青→黄色（`#fab005`）→オレンジ（`#f76707`）
- **Journey作成完了トースト通知の追加**: sessionStorage経由、Mantine notifications使用
- **Vercelデプロイフロー確認**: mainへのpush→自動デプロイを確認
- **マルチデバイス運用**: PC/スマホの並行運用を確認

## 作業サマリ（2026-04-11 第2セッション PC）

- モック（mock/index.html）との完全一致作業を実施
  - 全ページ（トップ/詳細/新規/Alerts/Unfiled/Account）をモック準拠に書き換え
  - AppHeader, TabBar の色・レイアウト・サイズをモック完全一致
  - 背景色、フォント、シャドウをモック準拠に修正
- StepEditModal を共通コンポーネントとして切り出し、新規作成と詳細編集のUIを統一
- スケルトンUI追加（トップ/詳細ページ）
- PullToRefresh 追加（全画面対応）
- ハイドレーションエラー・Lintエラーの修正
- Vercel デプロイ環境構築（GitHub連携、自動デプロイ）
- スマホ（claude.ai/code）からの操作環境構築

## 作業サマリ（2026-04-10 スマホ claude.ai/code セッション）

- **FABボタン色変更**: トップページ `/` の新規作成ボタン（FAB）の背景色を青（`var(--mantine-color-blue-7)`）→ 黄色（`#fab005`）に変更
  - 対象ファイル: `app/src/app/page.tsx:274`
  - CSS変数では反映されなかったため、直接HEXカラーコードを指定
- **デプロイ確認**: Vercel（mainブランチ自動デプロイ）で本番反映を確認
- **マルチデバイス運用テスト**: PC（VSCode拡張）とスマホ（claude.ai/code）の2セッション並行運用を確認
  - 会話履歴は各セッション独立
  - コードはGit経由で共有される
  - 経緯を残すには HANDOVER.md やメモリファイルに記録が必要

---

## 開発サーバー起動

```bash
cd /Users/mbneo512gb/Dev/Toritavi/app
npm run dev
# http://localhost:3000
```

---

## 仮想開発チーム

回答は6名の仮想チーム形式で行うこと（詳細はメモリ参照）:
- PM（Paul Parker）→ Engineer（Emma Evans）→ QA（Quinn Quinn）→ UX（Uma Underwood）→ Security（Steve Smith）→ Operations（Olivia Ortiz）
