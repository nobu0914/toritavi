# 管理者向け 運用・メンテナンスガイド

管理画面（<https://curlew.coyoteandpowell.com/admin>）に載せる運用リファレンス。
各機能の「何をするか／状態確認／よく使う操作／構成」を端的にまとめる。

> **このファイルが原本。** 編集したら `bash tool/sync_admin_guides.sh` で
> 管理画面（toritavi/app/src/content/）へ反映し、Web をデプロイする。
> `##` 見出し1つが管理画面のタブ1枚になる。

---

## スキャン画像・添付ファイルの自動削除（保持ポリシー）

スキャンした生画像とユーザー添付ファイルを、保持期限を過ぎたらサーバ側で自動削除する仕組み。**消すのはファイル（画像・PDF）のみ**で、OCR抽出テキスト・旅程/予定は残る。

### 削除ルール

| 種別 | 削除到来日 |
|---|---|
| 日付のある旅程 | 「旅程終了日 + 60日」と「登録日 + 60日」の**遅い方** |
| 日付のない旅程 | 登録日（`created_at`、無ければ `updated_at`）+ 90日 |
| 日付が一切ない旅程 | 対象外（消さない） |

- 起点は原則「旅程終了日」。ただし**登録から60日**は必ず残す（過去旅程を後から登録しても即消えない床）。
- ユーザー操作（予定/旅程削除）・退会では即時削除（本仕組みとは別系統）。

### 状態確認（これ1行）

```sql
select * from public.toritavi_retention_status;
```

| 列 | 見方 |
|---|---|
| `cron_active` | `true` なら稼働中 |
| `cron_schedule` | `20 3 * * *`（毎日 03:20 UTC = JST 12:20）|
| `pending_steps` | 今の削除対象 予定数（次回で消える見込み。0が平常）|
| `last_run_status` | `succeeded` が正常。`failed` は要対応 |
| `last_run_at` | 直近実行時刻（UTC）|
| `last_run_message` | 失敗時の手掛かり |

### よく使う操作（すべて SQL Editor）

**今すぐ削除を走らせる**（次回を待たない）
```sql
select net.http_post(
  url     := 'https://hugiyycgsmzhuldewwux.functions.supabase.co/purge-scan-images',
  headers := jsonb_build_object('Content-Type','application/json','x-purge-secret',
    (select decrypted_secret from vault.decrypted_secrets where name='purge_scan_images_secret')),
  body := '{}'::jsonb
);
```

**一時停止 / 再開**
```sql
update cron.job set active = false where jobname = 'purge-scan-images-daily';  -- 停止
update cron.job set active = true  where jobname = 'purge-scan-images-daily';  -- 再開
```

**完全に外す**
```sql
select cron.unschedule('purge-scan-images-daily');
```

**保持日数を変える**（例: 60→90日）
関数の既定値を変える。`supabase/scan_image_retention.sql` の
`toritavi_expired_scan_steps(retention_days int default 60, dateless_retention_days int default 90, upload_grace_days int default 60, ...)`
の既定値を編集して RPC を再適用。単発で試すだけなら Edge Function にクエリを付けて呼ぶ：
`.../purge-scan-images?dry_run=true&retention_days=90`。

**中身を事前確認（何が消えるか）** — 消さずに件数だけ
```
GET/POST https://hugiyycgsmzhuldewwux.functions.supabase.co/purge-scan-images?dry_run=true
ヘッダ: x-purge-secret: <PURGE_SECRET>
```

### 失敗したとき（`last_run_status = failed`）

1. `last_run_message` を確認。
2. よくある原因: シークレット不一致（Function Secrets と Vault の `purge_scan_images_secret` を揃える）／関数未デプロイ。
3. 再配線は `supabase/deploy_retention.sh`（`SUPABASE_PROJECT_REF` と `PURGE_SECRET` を export して実行）。

### 構成メモ

| 項目 | 値 |
|---|---|
| プロジェクト | genbox2 / `hugiyycgsmzhuldewwux` |
| Edge Function | `purge-scan-images`（`--no-verify-jwt`。`x-purge-secret` で認証）|
| cron ジョブ | `purge-scan-images-daily`（jobid=1, `20 3 * * *`）|
| シークレット | `PURGE_SECRET`（Function Secrets ＋ Vault `purge_scan_images_secret`。**リポジトリ非保存**）|
| ソース | `supabase/scan_image_retention.sql`（RPC＋ビュー）, `supabase/functions/purge-scan-images/`, `supabase/deploy_retention.sh` |
| 詳細仕様 | `docs/scan-image-retention.md` |

> 削除対象は「本人フォルダ `{uid}/{stepId}/` 配下のファイルのみ」。所有者 uid でパスを組むため、他ユーザーのデータには構造上到達しない。

---

## バックアップと復旧（DB・写真）

ユーザーのデータが消えたときに**戻せる**ための仕組み。Supabase 無料プランには自動バックアップが無く、**写真（Storage）はプランに関わらず Supabase の自動バックアップの対象外**。そのため DB と写真の両方を、Supabase とは別事業者（Cloudflare R2）へ日次で退避している。

> **最重要の前提**: スキャン画像は 2026-07 に DB 行内 base64 から Storage へ移行した。
> この結果、**Postgres のバックアップだけでは写真が戻らない**。R2 への退避が写真の生命線。

### 状態確認（これ1行）

```bash
bash tool/data_safety_check.sh
```

| 出力 | 見方 |
|---|---|
| バックアップの鮮度 | 最新ダンプが48時間以内なら ✅。古ければバックアップが止まっている |
| 容量のヘッドルーム | R2 無料枠10GBに対する使用率。50%で警告、80%で ❌ |
| データの急減 | 前回実行時との件数比較。20%減で警告、**50%減で ❌** |
| 孤児オブジェクト | 削除済みステップの写真の残存数 |

### よく使う操作

**手動でバックアップを走らせる**（次回03:00を待たない）
```bash
bash tool/backup_run.sh
```

**設定と疎通だけ確認**（書き込みしない。設定を変えたときに使う）
```bash
bash tool/backup_run.sh --check
```

**R2上の世代と容量を見る**
```bash
bash tool/backup_run.sh --list
```

**自動実行の状態確認 / 登録 / 解除**
```bash
bash tool/backup_schedule.sh status
bash tool/backup_schedule.sh install    # 毎日03:00
bash tool/backup_schedule.sh uninstall
```

### 復旧手順（事故が起きたとき）

1. **まず現状を保全** — 追加の書き込みを止める（必要なら該当機能を止める）
2. **本番へ直接復元しない。** 必ず別の復元先（新規プロジェクト or ローカル）へ入れて中身を確認する
3. R2 から対象世代のダンプを取得し復元 → 件数を本番の基準値と突き合わせる
4. 写真は R2 の `storage/step-attachments/` から該当パスのみ戻す
5. 確認できたものだけを本番へ反映する

詳細手順・訓練の記録は `docs/BACKUP_RESTORE.md`。

### リストア訓練（四半期ごと・必須）

**復元したことのないバックアップはバックアップではない。** 四半期に一度、実際に復元して確認する。

- 直近の実施: **2026-07-20 成功**（件数完全一致・復元エラー0件・写真26件差分0）
- 訓練で分かった実務メモ:
  - ローカル復元時は Supabase 固有ロール（`anon` / `authenticated` / `service_role` 等）を先に作らないと権限エラーが出る
  - 写真は件数一致では不十分。**「DBの参照パス → 実ファイル」の到達性**まで見る
  - ダンプには全ユーザーの個人情報が含まれる。**訓練後は復元先DBと一時ファイルを必ず消す**

### 構成メモ

| 項目 | 値 |
|---|---|
| 退避先 | Cloudflare R2 バケット `curlew-backup`（非公開・無料枠10GB）|
| 対象 | Postgres 全体（ダンプ）＋ Storage `step-attachments` / `toritavi-avatars` |
| 頻度 | 毎日 03:00（launchd。端末スリープ中は起動後に補完実行）|
| 世代保持 | DBダンプ30日 / 写真は常に最新 |
| 設定 | `tool/.env.backup`（**git管理外・本番の秘密鍵と同格**）|
| ソース | `tool/backup_run.sh`, `tool/backup_schedule.sh`, `tool/data_safety_check.sh` |
| 手順書 | `docs/BACKUP_RESTORE.md` |

> 写真の同期は `sync` ではなく `copy`。本番バケットが事故で空になった場合に、バックアップ側まで道連れで消えるのを防ぐため。

---

## 安全装置（課金の暴走・データ消失の歯止め）

事故は「上限が無い」ことより、**壊れているのに気づかない**ことで起きる。歯止めは「上限」と「検知」の2層で持つ。

### 課金の暴走に対する歯止め

| 対象 | 装置 | 効果 |
|---|---|---|
| Cloudflare R2 | Budget Alert **$1** | 無料枠を超えて課金が発生した瞬間にメール通知 |
| Anthropic API（OCR） | 月予算 **$20**（`AI_OCR_BUDGET_MONTHLY_CENTS`）| 超過で全体を 503 停止 |
| Anthropic API（コンシェルジュ） | 月予算 **$50**（`AI_CONCIERGE_BUDGET_MONTHLY_CENTS`）| 同上 |
| 利用者単位 | 日次リクエスト/トークン上限・分間レート | 1人が使い切れないようにする（429）|

> **通知は停止ではない。** Cloudflare にも Supabase にもハードな支出上限は無い。
> **実際に止められる唯一の歯止めは Anthropic Console の支出上限**なので、必ず設定しておく。
> アプリ側の予算は「Curlew が記録した分」しか見ておらず、キー漏洩など想定外の経路には効かない。

### データ消失に対する歯止め

| 層 | 装置 |
|---|---|
| 削除の可逆化 | 論理削除（`deleted_at`）＋ undo 導線。写真は削除時点では消さない |
| 物理削除の制限 | `purge_soft_deleted()` は service_role 専用・7日未満の指定を拒否 |
| 退避 | R2 への日次バックアップ（前のタブ参照）|
| 検知 | `tool/data_safety_check.sh`（鮮度・容量・急減・孤児）|

### 定期の確認

```bash
bash tool/security_check.sh     # フル（上記の検知を含む）
```

検知は**実行して初めて機能する**。日次バックアップとは別に、週次でこのチェックを回すこと。

### まだ無い歯止め（既知の残課題）

- **ステージング環境が無い** — マイグレーションが本番一発勝負。`docs/MIGRATION_GUIDE.md` のチェックリストで代替している
- **クラウド側に強制停止は無い** — R2・Supabase とも通知止まり
- 詳細は `docs/SAFETY_LIMITS.md`

---

## スキーマ変更（マイグレーション）の進め方

リリース後は**古いバージョンのアプリが数ヶ月間使われ続ける**。スキーマは常に「1〜2世代前のアプリが壊れない」状態を保つ必要がある。そのための型が expand-contract。

### 原則: 1リリースにつき「追加」だけ

```
①拡張 (expand)   新カラム/新関数を追加する。旧コードも動き続ける   ← 安全・可逆
②移行 (migrate)  新旧どちらでも動くコードをデプロイ／アプリを配布
③検証 (verify)   実データで新経路が動いていることを件数で確認
④収縮 (contract) 旧カラム/旧権限を削除する                        ← ここだけ不可逆
```

**`DROP COLUMN` / `DROP TABLE` / `RENAME` / `REVOKE` は必ず④で行う。** ①〜③と同じリリースに混ぜない。混ぜると、まだ更新していない利用者のアプリがその瞬間に壊れ、しかも切り戻せない。

### 変更前チェックリスト

- [ ] **バックアップの存在を確認**（特に不可逆な④の前は必須）
- [ ] 現在の件数を控える（`supabase/inventory.sql`）
- [ ] 旧バージョンのアプリが壊れないか確認（カラム追加はOK。NOT NULL追加・削除・改名はNG）
- [ ] 再実行しても安全か（`IF NOT EXISTS` / `CREATE OR REPLACE`）

### 適用台帳（どれが本番に入っているか）

適用状態を記録する仕組みが無いと「どれが入っているか」が分からなくなり、それ自体が事故要因になる。**適用したら必ず記録する。**

| No | ファイル | 状態 |
|---|---|---|
| 001–018 | （既存）| 適用済みとみなす（台帳導入前）|
| 019 | `019_ai_usage_server_only.sql` | **完了(2026-07-20)**。フェーズ1→デプロイ→フェーズ2まで実施済 |
| 020 | `020_soft_delete.sql` | **適用済(2026-07-20)** |

台帳の本体は `docs/MIGRATION_GUIDE.md`。

### やってはいけないこと

- 本番にいきなり `DROP` / `TRUNCATE` / 条件なし `UPDATE` を打つ
- バックアップの存在を確認せずに不可逆な変更を適用する
- 拡張と収縮を同じリリースに混ぜる
- アプリのリリースより先に、旧アプリが依存するものを消す
