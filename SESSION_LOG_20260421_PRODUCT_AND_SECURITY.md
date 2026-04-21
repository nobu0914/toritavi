# セッションログ 2026-04-21 プロダクト設計 / 非破壊セキュリティ検査

## セッション概要
- **日付**: 2026-04-21
- **テーマ**:
  - Toritavi のサービス仕様とアカウント下層ページ仕様の整理
  - 管理者画面 (`/admin`) の設計
  - Journey 起点フロー比較（案 A / B / C）の判断
  - 認証後の非破壊セキュリティ検査
  - 会話・作業履歴の保存

---

## 1. サービス仕様 / 画面仕様の整理
- `HANDOVER.md`、`SETUP_AUTH.md`、各種セッションログを参照し、Toritavi の現行仕様を整理した
- アカウント下層ページ仕様として、以下を再整理した
  - `/account/profile`
  - `/account/notifications`
  - `/account/help`
  - `/account/data`
- それぞれの目的、UI 構成、ゲスト/会員差分、確認ダイアログ、プロフィール画像フローを文章化した
- 上記内容を Claude Code に渡せるコピペ形式へ整形した

---

## 2. 非破壊セキュリティ検査

### 実施方針
- 提供されたテストアカウントで認証
- データ削除や他者データ変更は行わない
- 認証後ページ保護、アカウント配下、recovery session 固定、破壊系 API の safe method のみ確認

### 実施内容
- Supabase password login でテストアカウント認証に成功
- 認証 Cookie を再現し、本番ルート保護を確認

### 未ログイン時に `307 -> /login` を確認したルート
- `/`
- `/scan`
- `/alerts`
- `/unfiled`
- `/account`
- `/account/profile`
- `/account/notifications`
- `/account/help`
- `/account/data`

### 未ログイン時に `200` を確認した公開 auth ルート
- `/login`
- `/signup`
- `/forgot-password`
- `/reset-password`
- `/verify-email`

### ログイン時に `200` を確認した保護ルート
- `/`
- `/scan`
- `/alerts`
- `/unfiled`
- `/account`
- `/account/profile`
- `/account/notifications`
- `/account/help`
- `/account/data`

### ログイン時に `307 -> /` を確認した auth ルート
- `/login`
- `/signup`
- `/forgot-password`

### recovery session 固定
- `toritavi_recovery=1` を持つ認証済みセッションで `/account` に行くと `307 -> /reset-password`
- 同条件で `/reset-password` は `200`
- recovery session を通常画面へ流さない保護が効いていることを確認

### 破壊系 API の safe method 確認
- `GET /api/account/delete` → `405`
- `OPTIONS /api/account/delete` → `204`
- `Allow: OPTIONS, POST`

### 結論
- 今回の非破壊範囲では重大な認証/認可崩れは未確認
- 新規アカウント配下ページを含め、基本ルート保護は成立している

---

## 3. 管理者画面設計
- 管理者画面は `/account` の拡張ではなく、`/admin` 配下の独立運用コンソールとして切る方針が妥当と整理した
- 理由:
  - 一般ユーザー UI と権限面を明確に分離できる
  - service-role 前提の server-only 実装に寄せやすい
  - 監査ログや複数ロールへ拡張しやすい

### 推奨セクション
- `/admin`
- `/admin/users`
- `/admin/users/[id]`
- `/admin/security`

### 将来拡張候補
- `/admin/journeys`
- `/admin/journeys/[id]`
- `/admin/ocr`
- `/admin/concierge`
- `/admin/settings`
- `/admin/audit`

### 権限方針
- `support_viewer`
- `support_operator`
- `super_admin`

### 追加推奨テーブル
- `toritavi_admin_members`
- `toritavi_admin_audit_logs`

### MVP 方針
- read-heavy / ops-light
- まずは Dashboard / Users / Security から
- 強い破壊操作や直接編集 UI は後回し

### 成果物
- 管理者画面設計を Claude Code 向けのコピペ指示文へ整形した

---

## 4. Journey 起点フローの比較と判断

### 背景
- 現状は OCR / チケット読み取りから直接 Step 作成へ進むため、Journey タイトルや全体文脈を作りにくい
- ユーザーの思考単位は「旅程全体」だが、UI の開始単位が「1枚の書類」になっており、操作が難しく感じやすい

### 比較対象
- **案 A**: OCR 後に `新規 / 既存 / 未整理` の受け皿を聞く
- **案 B**: 先に Journey を作ってから OCR を行う
- **案 C**: OCR 結果を Journey 下書きとして見せる

### 判断
- 最も現実的なのは **案 A**
- 理由:
  - 既存の OCR 起点導線を壊しすぎない
  - OCR 後に Journey 文脈へ意識を戻せる
  - `未整理` への逃げ道を自然に持てる
  - MVP として実装しやすい
- **案 B** は筋は良いが入口が重くなる
- **案 C** は理想形に近いが OCR 品質依存が高く、将来拡張向き

### DS / mock 運用に対する評価
- `mock/design-system-v2.html#ds-tab-review` の review タブ運用は妥当
- 正式 DS と検討中フローを分離できている
- `mock/journey-flow-v2.html` を独立 HTML として持ち、iframe 埋め込みでレビューできるのは運用上わかりやすい

### 成果物
- Journey 起点フロー改善案を Claude Code 向けのコピペ指示文へ整形した
- 指示では「実装前に DS / mock で比較サンプルを作ること」を明示した

---

## 5. ワークツリー状況
2026-04-21 時点で、Journey 起点フローと未整理対応に関連する未コミット変更が存在:
- `app/src/app/trips/new/page.tsx`
- `app/src/components/ScanFlow.tsx`
- `app/src/lib/store-client.ts`
- `app/src/lib/store-guest.ts`
- `app/src/lib/store-supabase.ts`
- `mock/design-system-v2.html`
- `app/src/components/DestinationSelector.tsx`
- `app/src/components/JourneyPicker.tsx`
- `app/src/lib/journey-title-suggestions.ts`
- `mock/journey-flow-v2.html`
- `supabase_migrations/011_unfiled_steps.sql`

---

## 6. 次回の推奨アクション
1. Journey 起点フロー案 A を軸に mock の最終判断を行う
2. `ScanFlow` に `new / existing / unfiled` の 3 分岐を入れる実装を進める
3. `buildTitleSuggestions(ocr)` 相当のタイトル候補生成を詰める
4. `/admin` 配下の管理者画面 MVP 設計を具体化し、role / audit log を先に固める
5. 非破壊検査の次段階として、2アカウントでの cross-user 分離確認を実施する
