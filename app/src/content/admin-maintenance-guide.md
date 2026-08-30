# 管理者向け 運用・メンテナンスガイド

管理画面（<https://junros.coyoteandpowell.com/admin>）に載せる運用リファレンス。
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
| プロジェクト | JUNROS / `hugiyycgsmzhuldewwux` |
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
| Anthropic API（OCR） | **DB の `toritavi_ai_budget_limits`**（audience 別） | 超過で 429。🔴 `AI_OCR_BUDGET_MONTHLY_CENTS` は **OCR に効かない**（2026-08-30 実測。この env を読む関数はコンシェルジュ専用） |
| Anthropic API（コンシェルジュ） | 月予算 **$50**（`AI_CONCIERGE_BUDGET_MONTHLY_CENTS`）| 同上 |
| 利用者単位 | 日次リクエスト/トークン上限・分間レート | 1人が使い切れないようにする（429）|

> **通知は停止ではない。** Cloudflare にも Supabase にもハードな支出上限は無い。
> ただし **Anthropic の課金はチャージ制（プリペイド・自動課金なし）** のため、
> 残高が尽きればAPIが止まる。**残高そのものが最終的なハードリミット**であり、
> 想定外の高額請求は構造的に起こらない。
> ⚠️ **自動チャージを有効にするとこの保護が失われる。** 有効化する場合は
> Anthropic Console で支出上限を必ず設定すること。

### データ消失に対する歯止め

| 層 | 装置 |
|---|---|
| 削除の可逆化 | 論理削除（`deleted_at`）＋ undo 導線。写真は削除時点では消さない |
| 物理削除の制限 | `purge_soft_deleted()` は service_role 専用・7日未満の指定を拒否 |
| 退避 | R2 への日次バックアップ（前のタブ参照）。**launchd 毎日 03:00** |
| 検知 | `tool/data_safety_check.sh`（鮮度・容量・急減・孤児）。**launchd 毎日 04:00** |

退避の**後**に検知を置いている。同時刻だと、検知が今日の退避を見る前に走って鮮度を誤判定しうる。

### 状態確認（これ1つ）

```bash
bash tool/backup_schedule.sh status
```

見るのは **`last exit code`**。**登録されていることと動いていることは別。**

> **2026-07-21〜27 の 7 日間、退避は毎晩起動して毎晩失敗していた。**
> launchd の PATH に `/opt/homebrew/bin` が無く `rclone` が見つからず、
> **ダンプだけ作って捨てていた**（写真は 1 枚も退避されていなかった）。
> 手で叩くと PATH があるので通り、`--check` も ✅ を返し続けていた。
> **ログは失敗しても増える**ので、更新時刻を見ても稼働中に見えた。
> いまは失敗時に macOS 通知が出て、成功したときだけ
> `tool/.backup-last-success` に時刻が書かれる。

### 手動で回すもの

```bash
bash tool/security_check.sh     # セキュリティ側のフルチェック
```

こちらは自動化していない。週次で回すこと。

### 課金が反映されないとき（2026-08-30 追加）

**「払ったのに Pro にならない」「解約したのに Pro のまま」は、止まらずに
静かに起きる。** 落ちも警告も出ないので、利用者の申告で初めて分かる。
見る順はこの 3 つ。

| # | 見るもの | どこで | 正常 |
|---|---|---|---|
| 1 | RevenueCat の `app_user_id` | RevenueCat → Customers | **Supabase の UUID**。`$RCAnonymousID:…` なら課金だけ成立して権利が届いていない |
| 2 | webhook の応答 | RevenueCat → Webhooks の送信履歴 | **200**。401 は HMAC、500 は Supabase 側 |
| 3 | `toritavi_user_plan` の行 | SQL Editor | `plan` と `updated_at` |

```sql
select u.email, p.plan, p.updated_at, p.last_event_id
from toritavi_user_plan p join auth.users u on u.id = p.user_id
order by p.updated_at desc limit 20;
```

> **`last_event_id` は「どのイベントがこの行を最後に動かしたか」。**
> RevenueCat の Webhooks 送信履歴でその id を引けば、**どこで止まったか**が
> 分かる。`null` は「手で入れた行」か「この列を足す前の行」。

> 🔴 **`updated_at` は受信時刻ではなく、RevenueCat のイベント発生時刻。**
> 配送順は保証されず、5xx で失敗したイベントは何時間も再送される。
> 遅れて届いた `EXPIRATION` が `RENEWAL` の後ろに並ぶと契約中の人が
> free に落ちるため、**この列より古いイベントは適用しない**。
> webhook の応答に `applied: false` が出るのはそのため —— **異常ではない。**

> 🔴 **`TRANSFER` は渡した側も free に落とす。** 同じ Apple ID を別
> アカウントで復元すると権利は移る。「急に Pro でなくなった」の正体が
> これのことがある。
>
> 🔴 **逆に「移ったのに Pro にならない」も起きる。承知のうえの空白。**
> `TRANSFER` のペイロードには `entitlement_ids` が無く、移った権利が
> 有効かを判断できないため、**受け取った側への付与はしていない**
> （無条件に付与すると、払っていない人に配ることになる）。
> **次の `RENEWAL` で自動的に pro になる**（最長 1 か月）。
> 問い合わせが来たら手で行を入れて救済する:
>
> ```sql
> insert into toritavi_user_plan (user_id, plan, updated_at)
> values ('<user_id>', 'pro', 'epoch'::timestamptz)
> on conflict (user_id) do update
>   set plan = 'pro', updated_at = 'epoch'::timestamptz;
> ```
>
> 🔴 **`updated_at` に `now()` を書かないこと。** この列は webhook の
> 順序の正本で、「今」を書くと**それより古いイベントが以後すべて
> 落ちる**（200 を返すので再送もされない）。
>
> 経緯は `docs/feature-flags.md` §4-1（リポジトリ側）。

#### 503 が返るようになった（`plan_unavailable`）

`/api/ocr` と `/api/ai-usage` は、**プランを読めなかったとき 503** を返す。
以前は読み取り失敗を黙って `free` に変換していたので、**Pro 契約者が
429「今月の上限に達しました」で止まっていた。**

🔴 **503 は 2 つの意味を持つ。`error` フィールドで見分ける。**

| `error` | 意味 | 対応 |
|---|---|---|
| `plan_unavailable` | **Supabase の読み取り失敗**（サービスは動いている） | DB の状態を見る。継続するなら Supabase 側の障害 |
| （AI モードの停止） | **こちらが意図的に止めている** | 非常停止スイッチの状態を見る |

**429 と 503 を同じ扱いにしないこと。** 429 は「その人の枠」、
503 は「こちらの都合」。混ぜると、残数があるのに諦める利用者が出る。

### まだ無い歯止め（既知の残課題）

- **ステージング環境が無い** — マイグレーションが本番一発勝負。`docs/MIGRATION_GUIDE.md` のチェックリストで代替している
- **クラウド側に強制停止は無い** — R2・Supabase とも通知止まり
- **`toritavi_user_plan` に手で入れた `pro` の行が 2 つある** —— 開発者本人
  （`kijiatora.regi@`・2026-07-23）と**提出用スクリーンショットの撮影用**
  （`020w5dhf@coyoteandpowell.com`・2026-08-30）。**どちらも課金ではない。**
  監査で「払っていないのに pro」を見つけたら、まずこの 2 行を疑う
  （経緯は Vault の `Infra/_index.md`）
- 詳細は `docs/SAFETY_LIMITS.md`

---

## 認証メール・パスワード再設定の検査

登録の確認メール・パスワード再設定は、**壊れていても本人が困るまで誰も気づかない**。しかも壊れるのはコードではなく、Supabase の管理画面に貼った文面や設定のほうが多い。だから検査を用意してある。

### 実行

```bash
cd ~/Dev/toritavi/app
npx tsx scripts/check-auth-email.ts          # 静的のみ。ネットワーク不要
npx tsx scripts/check-auth-email.ts --live   # 本番の経路も叩く
```

**`--live` でもメールは 1 通も送らない。** 緑なら exit 0、赤なら exit 1。

### 検査そのものを疑うとき

```bash
bash scripts/check-auth-email.selftest.sh
```

**「異常なし」は、本当に無事なのか、検査が死んでいるのか、区別がつかない。**
これは上の 3 つを含む欠陥を 1 件ずつわざと注入して、**赤くなることを確かめる**。
対象ファイルは終了時に必ず git から復元する（作業ツリーが汚れているときは実行を拒否）。

検査を骨抜きにして回すと 6 件すべてが「壊したのに緑のまま」で落ちることも
確認済み。**検査の実装が死んだら、この自己検査が気づく。**

### 何を見ているか

| 層 | 内容 |
|---|---|
| 正本テンプレート | 4 種そろっているか／件名が `【JUNROS】`／社名が `合同会社 Coyote and Powell`／`株式会社` が無い／`toritavi`・`curlew`・`GenBox` が本文に出ない／`{{ .ConfirmationURL }}` が 2 か所／閉じタグの後ろに余分な `>` が無い／`div`・`p` の開閉一致 |
| 本番の経路（`--live`）| `/forgot-password` が開く／`/auth/callback` が code 無しを弾く／`/reset-password` が開く／旧ドメインが 307 で `junros` へ転送（POST 保持）|

> **2026-07-27 に、この検査が拾うはずだったものが実際に 3 つ壊れていた。**
> ① Supabase 側のテンプレート 4 種が **GenBox（別サービス）のまま**で、
> 登録した人全員に「GenBox — 取引ファイル管理システム」が届いていた
> ② 正本の社名が `株式会社コヨーテ・アンド・パウエル`。法務ページ 4 種は
> すべて `合同会社 Coyote and Powell` で、**このファイルだけが外れていた**
> ③ 貼り付け時にエディタが `</div>` の後ろへ `>` を 1 つ自動補完していた

### アプリ側の通し検査（iOS Simulator・自動）

通常版の JUNROS を Simulator に入れ、**画面だけを見て操作する**。内部の Widget テストではないので、Supabase の設定・メールの実配信・ディープリンクでの復帰まで通る。

```bash
cd ~/Dev/toritavi_app
python3 tool/verify/account_ui_e2e.py smoke --skip-build   # データを変えない
python3 tool/verify/account_ui_e2e.py lifecycle --allow-account-changes --delete human
```

`lifecycle` は 9 段を 1 本で通す —— 新規登録 → 確認メール受信 → リンクでアプリへ復帰 → ログアウト → ログイン・ログアウト → 再発行メール → 新パスワード設定 → 旧パスワード拒否・新パスワードでログイン → 退会確認 → **退会（人が押す）** → 退会後はログイン不可。

**退会の最終確定だけは人が押す。**「上記に同意します」→「削除する」を押すのを 11 分待つ。無人で回すには `--delete auto --confirm-delete DELETE-DISPOSABLE-ACCOUNT` が要る（永久削除なので明示語を要求している）。

要るもの: Maestro / OpenJDK 17 / `tool/.env.verify` の使い捨て検証アカウント。結果は `reports/account-ui-e2e.txt` に**追記**される（資格情報・メールアドレス・ワンタイムリンクは書かない）。末尾に**通したフローと通していないフロー**が機械的に並ぶので、「どこまで見たか」が残る。

#### 始める前に整える 2 つ

| | なぜ |
|---|---|
| **使い捨てアドレスが未登録であること** | 登録済みだと確認メールが送られない（enumeration protection）。**「メールが来ない」がアプリの不具合に見える。** `lifecycle` は退会で終わるので、通しきれば次回はそのまま回せる |
| **Keychain を消してから始める** | 🔴 **アプリを削除してもログアウトしない**（iOS は Keychain をアプリ削除で消さない）。ランナーが毎回 `simctl keychain reset` する |

#### 落ちたとき、まずアプリを疑わない

2026-08-27 に環境を作ったとき、**止まった原因はほとんど検査側だった。**

| 症状 | 実際の原因 |
|---|---|
| 再設定画面が出ない | iOS の「"JUNROS" で開きますか？」を誰も押していない。押さないとリンクはアプリへ届かない |
| ログインが成功しない | 下部タブの実名は `アカウント\nタブ: 3/3`。Maestro の文字指定は**完全一致**なので `"アカウント"` では当たらない |
| 分岐が効かない | `when: visible:` も完全一致。**黙って飛ばされる** |
| ログイン画面が出ない | Keychain にセッションが残っている |
| 画面照合が外れる | ログイン直後の通知許諾ダイアログが裏を隠している |
| 人が押す前に落ちる | 待ち時間が**フロー側とランナー側の 2 か所**にある。短いほうが黙って勝つ |

#### この検査でも分からないこと

- **Web の再設定経路**（`/forgot-password` → メール → `/reset-password`）。下の手順で人がやる
- **配信ビルドの見え方**。検査しているのは debug ビルドで、release と出るものが違いうる

---

### この検査で分からないこと

**Web でメールが実際に届くか**と、**ブラウザでリンクを踏んで再設定画面に着くか**。ここは人がやる（アプリ側は上の通し検査で自動化した）。

1. `https://junros.coyoteandpowell.com/forgot-password` で自分宛に送信
2. **申請したのと同じブラウザで**リンクを開く
3. `/reset-password` に着けば成功

> **手順 2 は「同じブラウザ」でないと必ず失敗する。**
> いまのリンクは PKCE で、`code_verifier` が申請したブラウザにしか無い。
> 2026-07-27 の実測では、Firefox で申請 → Chrome で開く = 失敗、
> Firefox で完結 = 成功だった。
>
> **これはテスト手順の都合ではなく、利用者にも起きる。**
> 「PC で申請 → スマホでメールを開く」が動かない。
> `{{ .TokenHash }}` ＋ `/auth/confirm` の `verifyOtp` に寄せれば、
> 端末をまたげるようになり、同時にこの検査で最後まで自動で追えるようになる。
> **未対応。**

### テンプレートを貼り直すとき

正本は `~/Dev/toritavi/app/src/lib/email-templates.ts`。閲覧とコピーは `/admin/email-templates`。貼り付け先は Supabase → Authentication → Emails → Templates。

**4 つ全部やること。** 1 つ残すとその経路だけ別の文面で届き続ける。貼ったら上の検査を回す。

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
| 001–016 | （既存）| 適用済みとみなす（台帳導入前）|
| 017 | `017_admin_moderation.sql` | **適用済(2026-07-21)**。⚠️ 台帳では「適用済み」と丸められていたが実際は未適用だった |
| 018 | `018_ad_analytics.sql` | **適用済(2026-07-21)**。適用前にファイルを改訂（重複列と seed を削除） |
| 019 | `019_ai_usage_server_only.sql` | **完了(2026-07-20)**。フェーズ1→デプロイ→フェーズ2まで実施済 |
| 020 | `020_soft_delete.sql` | **適用済(2026-07-20)** |

台帳の本体は `docs/MIGRATION_GUIDE.md`。

### やってはいけないこと

- 本番にいきなり `DROP` / `TRUNCATE` / 条件なし `UPDATE` を打つ
- バックアップの存在を確認せずに不可逆な変更を適用する
- 拡張と収縮を同じリリースに混ぜる
- アプリのリリースより先に、旧アプリが依存するものを消す
