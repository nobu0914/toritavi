# Toritavi 引き継ぎドキュメント

## 概要
toritavi は Journey（目的ある外出・旅行）を管理する Web アプリケーション。
TripIt がスケジュールを整理するのに対し、toritavi は「次に何をすべきか」を駆動する。

- **技術スタック**: Next.js 16.2.3 (Turbopack) + Mantine v7 + TypeScript
- **データ永続化**: localStorage（将来的にはバックエンド/DB）
- **将来計画**: Webアプリ → モバイルアプリ化

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
    │   │   ├── layout.tsx        # ルートレイアウト（MantineProvider, Notifications）
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
    │   │   ├── TabBar.tsx        # 共通タブバー（fixed, 4タブ）
    │   │   └── TabBar.module.css
    │   └── lib/
    │       ├── types.ts          # データ型定義
    │       ├── store.ts          # localStorage CRUD
    │       └── helpers.ts        # カテゴリアイコン, 日付フォーマット等
    └── AGENTS.md
```

---

## データモデル（types.ts）

```typescript
// ステップのステータス
type StepStatus = "未開始" | "進行中" | "完了" | "遅延" | "キャンセル";

// ステップのカテゴリ
type StepCategory = "列車" | "飛行機" | "バス" | "車" | "徒歩"
                  | "宿泊" | "商談" | "食事" | "観光" | "その他";

// ステップの入力元
type StepSource = "撮影" | "アップロード" | "メール" | "手入力";

// 付帯情報
type Information = { id: string; label: string; value: string; };

// ステップ（具体的なアクション）
type Step = {
  id: string;
  category: StepCategory;
  title: string;
  time: string;
  detail?: string;       // 区間・場所
  confNumber?: string;   // 確認番号
  memo?: string;
  source?: StepSource;   // 入力元
  status: StepStatus;
  information: Information[];
};

// ジャーニー（旅行・外出の単位）
type Journey = {
  id: string;
  title: string;
  startDate: string;  // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  memo?: string;
  steps: Step[];
  createdAt: string;   // ISO string
  updatedAt: string;   // ISO string
};
```

---

## store.ts API

```typescript
getJourneys(): Journey[]           // 全件取得
getJourney(id: string): Journey    // 1件取得
addJourney(journey: Journey): void // 追加
updateJourney(id, updates): void   // 更新
deleteJourney(id: string): void    // 削除
generateId(): string               // UUID生成
getJourneyDraft(): JourneyDraft | null
saveJourneyDraft(draft: JourneyDraft): void
clearJourneyDraft(): void
seedSampleJourneys(): Journey[]
```

localStorage キー: `toritavi_journeys`
下書きキー: `toritavi_journey_draft`

---

## helpers.ts ユーティリティ

- `getCategoryIcon(category)` — カテゴリに対応する Tabler アイコン
- `getSourceIcon(source)` — 入力元アイコン
- `getSourceLabel(source)` — 入力元の表示ラベル（撮影→OCR等）
- `formatDateJP(dateStr)` — `4月15日 (火)` 形式
- `formatDateRange(start, end)` — 範囲表示
- `daysUntil(dateStr)` — `3日後` / `今日` / `完了`

---

## 各ページの状態と実装内容

### トップページ `/` (page.tsx)
- localStorage から Journey 一覧を読み込み
- `toritavi_journeys` が空ならサンプル Journey 3 件を自動投入
- Upcoming / Past セグメントコントロールで切替
- 各 Journey をカード表示（タイトル, 日付, ステップ数, カテゴリアイコン, 残日数バッジ）
- FAB（+）ボタン → /trips/new へ遷移
- **空状態メッセージあり**

### 新規作成 `/trips/new` (trips/new/page.tsx)
- `mock/index.html` の `s-new` に寄せた UI を実装中
- タイトル入力（モック準拠の `form-sec` 風）
- ステップリスト（未登録=4ボタン / 登録済み=情報行表示）
- 未登録ステップの4アクション: 撮影, アップロード, メール, 手入力
  - 「手入力」→ モーダル（カテゴリ/タイトル/時間/詳細/確認番号）
  - 「撮影」→ カメラモーダル（プレビュー枠, OCR説明）
  - アップロード/メール → 未実装（onClickなし）
- 登録済みステップ: 緑枠カード, アイコン付き情報行, サムネイル枠, ソースバッジ
- ステップ間コネクター（+）で途中挿入可能
- フッター: 「下書き保存」＋「作成」
- 下書き保存/復元は `toritavi_journey_draft` で実装済み
- **モック完全一致ではまだない。次回もここを優先確認**

### Journey詳細 `/trips/[id]` (trips/[id]/page.tsx)
- タイムラインUIへ戻し済み
- ヒーロー領域（タイトル, 日付範囲, 概要）
- タイムラインUI（時刻列 → ドット＋縦線 → ステップカード）
  - ドット色: 完了=teal, 進行中=blue(影付き), 未開始=白枠
  - 線色: ステータスに連動
- ステップカード: カテゴリアイコン, タイトル, 時間, 詳細, 確認番号, ステータスバッジ
- ステップ操作（…メニュー）: ステータス変更, 編集, 削除
- カードクリック → 編集モーダル
- Journey 自体の編集モーダルあり（タイトル/日付/メモ）
- ヘッダー（…メニュー）→ Journey削除
- FAB（+）→ ステップ追加
- **こちらもモック完全一致ではまだない**

### Alerts `/alerts` — 静的モックデータ（3件）
### Unfiled `/unfiled` — 空状態表示
### Account `/account` — 静的モックデータ

---

## UI共通ルール

- **ヘッダー**: sticky, blue.7背景, 白文字, z-index:100
- **TabBar**: fixed bottom, 白背景, 4タブ（Trips/Alerts/Unfiled/Account）, z-index:200
- **FAB**: z-index:300（TabBarの上）
- **body**: max-width:430px, margin:0 auto, gray.0背景
- **デザインシステム**: Mantine v7 のデフォルトカラー（Open Color ベース）

---

## 未実装・要対応事項

1. **モック完全一致** — `trips/new` と `trips/[id]` がまだ `mock/index.html` と完全一致ではない
2. **日付入力の扱い** — モックは新規作成で日付入力を見せていないが、データモデル上は `startDate/endDate` が必須
3. **撮影/OCR** — カメラモーダルは表示のみ。実際のカメラ起動やOCR処理は未実装
4. **アップロード** — ファイルアップロード機能未実装
5. **メール取込** — メール転送→パース機能未実装
6. **TabBar右端** — スマホ幅で右端が途切れる問題（未解決）
7. **Alerts** — 静的データ。通知システム未実装
8. **Account** — 静的データ。認証・ユーザー管理未実装
9. **ステップ並べ替え** — ドラッグ&ドロップ未実装

---

## 直近の作業サマリ（2026-04-11）

- `会話・作業の履歴を確認して` 指示で `CODEX_MEMORY.md` と `HANDOVER.md` を確認し、現状を棚卸し
- その後、優先課題として `日付入力 / Journey編集UI / 下書き保存` を着手
- 実装の途中で、ユーザーから「UIが違う」「タイムライン表示だった」「design-system-mantine.html をちゃんと参照して」と修正依頼あり
- これを受けて `mock/index.html` と `mock/design-system-mantine.html` を再確認し、見た目をモック基準へ戻す方針に転換
- `trips/new` は `s-new` モックをかなり直接的に React 化
- `trips/[id]` はタイムライン表示を復元し、編集モーダルもフォーム風に調整
- `npm run lint` と `npm run build` は最終時点で通過

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
