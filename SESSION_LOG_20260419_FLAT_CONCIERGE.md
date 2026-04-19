# Session Log — 2026-04-19 (Flat Concierge & Journey Detail polish)

## Theme
Journey Detail のタイムライン表現と、TOP 導線、Concierge UI のフラット化。

## Commits (順)
1. `9298f80` Trip detail: category icon on each step + hide 未開始/次 badge
2. `f8408f2` Trip detail: step action bar — +予定追加 opens drawer, drop タクシー, right-align
3. `397577d` Trip detail: inter-step +予定追加 inserts after anchor, not bottom
4. `6b24917` TOP: drop 'ジャーニー ワークスペース' label and 'ジャーニー' section heading
5. `fd211ad` TOP empty state: 'まだ予定はありません' + 予定を登録する CTA → /scan
6. `cb437ec` Concierge: DS v2.1 Flat — drop fills, role labels + left stripes

## 変更サマリ

### Journey Detail (app/src/app/trips/[id]/)
- 各ステップ時間行に **カテゴリアイコン**（✈︎ 🛏 🚆 💼 等）を追加。`getCategoryIcon` を再利用、22px 円チップ `--n-100`。
- 右側バッジは「未開始」「次」を **非表示**。進行中 / 完了 / 遅延 / キャンセルのときだけ描画。
- ステップ間アクションバー: **+予定追加** が `openNewStep(step.id)` で Drawer 起動、**タクシー** 削除、`justify-content: flex-end` で右揃え。`IconPhone` import も整理。
- **アンカー挿入**: `anchorStepId` を state で保持し、追加完了時に新ステップで time が空なら `anchor.time + N 分` を割り当て、`sortStepsByTime` によりタイムライン上でアンカー直後に並ぶ。OCR/手入力で時刻が付いた場合は尊重（上書きしない）。
- 画面下部の大きな +予定を追加 は従来通り末尾扱い。

### TOP (app/src/app/TripsClient.tsx)
- ヒーロー上部「ジャーニー ワークスペース」ラベル + ベルを削除。
- リスト上セクション見出し「ジャーニー」を削除（検索時は「検索結果」だけ表示）。
- 空状態: タイトルを「まだ予定はありません」に、説明文を **予定を登録する** ピル CTA に置換（→ `/scan`）。

### Concierge 再設計 (DS v2.1 Flat)
虚擬チーム (PM/Eng/QA/UX/Sec/Ops) でレビュー後に以下方針確定して実装:
1. **吹き出し塗りゼロ** — 左 3px stripe のみ（ink-800 / info-500 / accent-500）
2. **アバター廃止** — 上部に `YOU` / `CONCIERGE` / `PROPOSAL` の 10px bold eyebrow
3. **送信ボタン** 正方形 `radius: 2px` `ink-800`
4. **Suggested chip** borderless divider list に（下線のみ + `›`）
5. **Tool Card** 塗り落とし — accent stripe のみ、`PROPOSAL` eyebrow、CONFIRMED/DECLINED 切替
6. モック `mock/design-system-v2.html` に **§15.3b / §15.4b** を現行 §15.3 / §15.4 と**併記**（ロールバック余地）。

### 背景で入った設計メモ
- 「未開始」の日本語表記は視覚ノイズが大きい → v2 Journey Detail では省略が正解、と判断。
- アンカー挿入ロジックは "時刻ベースソート" が動線の real driver なので、ID ベースで splice するのではなく時刻を調整するアプローチにした（OCR の時刻を尊重しつつ、空のときだけ調整）。

## Pending / 次回候補
- Concierge フラット化の iPhone 実機確認（Vercel 反映後）
- A/B: 現行 v2 vs v2.1 Flat のユーザー反応を 1 週間ほど観察したい（モック両方残してある）
- Phase 2 Concierge: 履歴一覧 / set_status tool / Journey 詳細からの起動 / Sonnet エスカレーション

## 参照
- DS v2 §14 自動リンク (StepDetailDrawer) — 別機能なので混同注意
- DS v2 §15.3b / §15.4b フラット (mock/design-system-v2.html)
