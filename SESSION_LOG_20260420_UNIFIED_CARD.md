# Session Log — 2026-04-20 (Step Detail unified card + Mac mini 移行検討)

## Theme
Step Detail Drawer を「モーダル内のカード」から「カード自体が浮かぶ UI」に再設計。加えて Mac mini への開発環境移行を検討したが、Codex の遠隔体験が Claude Code に劣るため一旦保留。

## Commits（順）
1. `ca24c6e` Step detail: unified card — ticket is the floating panel (view mode)
2. `ad768f3` Step detail view: drop sheet header, enforce full-width ticket

## 変更サマリ

### Step Detail Drawer: ユニファイドカード化（view モードのみ）
- **Before**: Mantine Drawer の白い枠（16px padding + 16px 角丸）の中に、黒い Ticket カードが配置される二重構造。
- **After (view モード)**: Drawer 枠の `border-radius` を 20px に揃え、body padding を 0 に、Ticket の `max-width / margin / box-shadow` を削除。結果、Ticket 自体が Drawer の上辺（20px 角）にフィットし、**ticket が 1 枚の浮き出しカード**になる。
- **SheetHeader 全廃（view モードのみ）**: 上部の ∨ / タイトル / ⋮ バーを削除。close は下部「閉じる」、メニュー操作は下部「操作する」に集約（機能は完全温存）。
- **右ズレ対策**: `.body[data-mode="view"]` に `overflow-x: hidden`, `width: 100%` を追加。Ticket 側も `width: 100%` 強制。
- **編集モード**は従来の 16px padded + SheetHeader レイアウトを維持（`data-mode` で分岐）。

### Mac mini 移行検討
- 一通りの移行手順（秘密情報退避 → ツール再セットアップ → Claude メモリ移植 → 動作確認）を作成し、Step 1/8〜2/8 まで実行（`.env.local` と `.claude/projects/...` を Dropbox の `migration/` 配下へ）。
- **判断**: Codex CLI は Claude Code のブラウザ Remote Control に相当する遠隔 UI を持たず、iPhone からのアプリ開発体験が落ちる。Mac mini を遠隔拠点にすると不便 → **移行は保留**。
- Dropbox 上の `~/Dropbox/Dev/migration/` は残置（再開時に使える）。不要になったら削除する方針。

### 補足メモ
- Mantine TextInput の iOS クラッシュ（`variant="unstyled"` + `classNames` の組み合わせで useState 初期化失敗）は前セッションで plain `<input>` 化で解決済み。他入力にも波及するリスクは残るので、iOS で同種エラー出たら同じパターンで倒す。
- Ticket の `.ticket-perf::before / ::after` は `left: -28px / right: -28px` で外側にはみ出すデザインだが、`.ticket { overflow: hidden }` で半円が見える形に切り取られる（仕様通り）。

## Pending / 次回候補
- §16 Phase 1 の Undo Toast（`step.previous` 書き込み済、UI 未接続）
- §17 Bulk Ingest 実装着手
- Step Detail Drawer の view モードを iPhone 実機で確認（右ズレ完全解消の確認）
- Concierge フラット化の実機 A/B 判断
- Mac mini 移行は開発方式が変わった時に再検討（例: Codex にも browser remote が来た時）

## 参照
- DS v2 §16（Step マージ）/ §17（Bulk Ingest）モックは `mock/design-system-v2.html` 最下段
- 前セッション: `SESSION_LOG_20260420_STEP_MERGE.md`
