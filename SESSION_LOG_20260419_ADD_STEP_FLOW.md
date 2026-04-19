# セッションログ 2026-04-19 予定追加フロー刷新

## セッション概要
- **日付**: 2026-04-19
- **テーマ**: 「+予定を追加」を Bottom Sheet 化、周辺の回帰修正、自主検査
- **対象**: `/trips/[id]` の予定追加導線、StepDetailDrawer、Ticket
- **関連 DS**: v2 §10.5 詳細画面、§10.6 Bottom Sheet、§13.11 Highlight Zone
- **コミット範囲**: 4326718 〜 6ef8671（12 commits）

---

## 実施内容（時系列）

### 1. Ticket の強調ゾーン拡張
- `extractTerminal()` を追加（`ターミナル1` / `Terminal 2` / `T1` に対応）
- 飛行機カテゴリで常に 4-cell（出発時刻 / ターミナル / ゲート / 座席）を表示
- CSS に `data-cells` 属性でセル数に応じたフォント縮小（26/22/18px）
- ラベルを日本語に統一、`text-transform: uppercase` を外し letter-spacing 縮小

### 2. 港名分解の堅牢化（`splitPort`）
- 3 文字 IATA（半角/全角括弧）を優先して抽出
- マッチしなければ先頭日本語を primary、括弧内日本語を name として採用
- 末尾の ` - ターミナル1` 修飾子はスペース両側必須で除去（`Tokyo-Narita` を壊さない）
- `JP_PHRASE` で中黒・長音も含めた日本語句を許容

### 3. 予定追加導線の刷新
- `+予定を追加` 初期案: `/scan?target=id` への遷移（A 案）
- ユーザー反論「コンテキスト帯がテロップに見える」→ 案再設計
- DS §10.6 に「Card モーダル / Bottom Sheet」の 2 案モックを追加 → **案 2 採用**
- 実装方針: `ScanFlow` をコンポーネント化して `/scan` と Bottom Sheet 両方で再利用
- `AddStepDrawer` 新規、`chrome="embedded"` / `target` / `onComplete` を受け取る props 設計

### 4. Bottom Sheet 本番確認での 2 件修正
- **①** context card が embedded 時にも出ていた → `!isEmbedded` でガード
- **②** Mantine Drawer `zIndex` 既定が TabBar と衝突 → `zIndex={400}` に引き上げ
- StepDetailDrawer も同値に揃えて整合

### 5. 診断ログの導入（画像消失の切り分け用）
- `ScanFlow.createStep`: base64 サイズ + payload 構成
- `updateJourney`: upsert 行と post-upsert 検証
- `getStepImages`: 取得結果の有無
- ユーザー再現テストで「プレビュー復活」を確認（原因は特定できず、再発時に再調査）

### 6. StepDetailDrawer の ⋮ タップで Drawer が閉じる bug
- 原因推定: drag-to-close の `<div>` が SheetHeader を包含、`touchAction: pan-y` により
  iOS Safari で合成 click が失われる条件がある
- 対策: `onDragStart` で `target.closest('button, [role="button"], [data-no-drag="true"]')`
  にマッチしたら drag を発動しない（touchStartY.current = null で早期 return）

### 7. 自主検査（Claude Code 内実施分）
`npm run build` ✓ / `npm run lint` 新規エラー 0 件 / 論理テストを Node で実行し 16 項目すべて PASS。
詳細は別セクション参照。

---

## コミット一覧（このセッション）
| commit | 内容 |
|---|---|
| 05d0113 | Ticket: harden splitPort against verbose bilingual port names |
| 1364d48 | Ticket: require spaces around the terminal-qualifier dash |
| d491fb0 | Ticket Highlight: 4-cell row for 飛行機 (Time / Terminal / Gate / Seat) |
| 4326718 | Highlight labels: switch to Japanese |
| bbe3a63 | "+予定を追加" → /scan を再利用してフルフロー化 |
| 09893db | Scan: visually distinguish "+予定を追加" from 新規予定登録 |
| 3acfc79 | DS v2 §10.6: add 2-variant mockup for "Journey への予定追加" |
| 675a77e | DS v2 §10.6: finalize "Journey への予定追加" as Bottom Sheet pattern |
| 19a0abc | Journey への予定追加を Bottom Sheet モーダルで実装 |
| 2ef8e71 | AddStepDrawer: hide redundant context card + lift z-index above TabBar |
| 84753b1 | Diagnose: instrument image save path for Bottom Sheet add flow |
| 6ef8671 | Drawer: skip drag gesture when touch starts on a button |

---

## 関連ファイル変更
- `app/src/components/Ticket.tsx` — splitPort / extractTerminal / 4-cell highlight
- `app/src/components/ticket.css` — data-cells 属性別フォント
- `app/src/components/ScanFlow.tsx` — 新規、/scan から抽出した再利用コンポーネント（~1300 行）
- `app/src/components/AddStepDrawer.tsx` — 新規、Bottom Sheet ラッパ
- `app/src/app/scan/page.tsx` — ScanFlow を呼ぶだけの薄 wrapper に
- `app/src/app/trips/[id]/TripDetailClient.tsx` — useDisclosure 追加、AddStepDrawer 組み込み
- `app/src/components/StepDetailDrawer.tsx` — zIndex、drag-to-close button ガード
- `app/src/lib/store-supabase.ts` — updateJourney / getStepImages に診断ログ
- `mock/design-system-v2.html` — §10.6 Bottom Sheet、§13.11 4-cell 追加

---

## 自主検査結果（16 項目 PASS）
| # | 項目 | 結果 |
|---|---|---|
| 1 | `next build` | ✅ |
| 2 | `eslint` 新規エラー | ✅ 0 件 |
| 3 | z-index 層（TabBar:200 < Drawer:400） | ✅ |
| 4 | ⋮ drag ガード | ✅ |
| 5 | drag close 閾値 | ✅ |
| 6 | splitPort | ✅ 見切れ回避 |
| 7 | 飛行機 4-cell | ✅ |
| 8 | TabBar /trips/:id から / 遷移 | ✅ |
| 9 | hydration uniform column list | ✅ |
| 10 | 二重送信ガード | ✅ |
| 11 | 編集 2 経路 | ✅ |
| 12 | target 解決優先順 | ✅ |
| 13 | context card embedded ガード | ✅ |
| 14 | CSP blob: 3 箇所 | ✅ |
| 15 | dev SSR /login redirect | ✅ |
| 16 | Ticket scan 空表示条件 | ✅ |

### 検証不能（実機必須）
- iOS Safari での ⋮ タップ挙動
- drag-to-close のタッチ感
- blob→base64 実行
- Service Worker 挙動

---

## 既知の残課題
- **画像消失の真因未特定**: 診断ログ仕込み済み。再発時にユーザーから log をもらい切り分け
- **診断ログの撤去**: `[scan/createStep]`、`[updateJourney]`、`[getStepImages]` を後日削除する PR を立てる想定
- **localStorage QuotaExceeded（ゲスト）**: 画像付きステップで溢れた場合の通知が未整備
- **編集 2 経路のユーザー認知**: 下部 CTA と ⋮ メニューの双方にあり、どちらかに寄せる可能性あり（現状は DS §10.5 ① variant A で 2 経路維持）

---

## 次回アクション候補
1. iPhone 本番で A1〜A8 の動作検証（ユーザー側）
2. 診断ログで画像消失の真因確定（再発待ち）
3. ログ撤去 PR
4. ゲストモードの localStorage クォータ溢れハンドリング
5. マルチページ PDF の ページ切替 UI のタッチ確認
