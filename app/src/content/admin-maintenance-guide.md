# 管理者向け 運用・メンテナンスガイド

管理画面（<https://curlew.coyoteandpowell.com/admin>）に載せる運用リファレンス。
各機能の「何をするか／状態確認／よく使う操作／構成」を端的にまとめる。

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
