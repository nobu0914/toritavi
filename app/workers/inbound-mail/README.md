# junros-inbound-mail（メール転送の受け口）

`trips-<16 文字>@junros.com` に届いたメールを、**生の MIME のまま**
署名を付けて `https://junros.coyoteandpowell.com/api/inbound-mail` へ渡す
Cloudflare Email Worker。

設計の正本: `~/Dev/toritavi_app/docs/mail-import-design.md` §11。
DB: `~/Dev/toritavi_app/supabase/mail_import.sql`。

## やること・やらないこと

| やる | やらない |
|---|---|
| 宛先が `trips-<トークン>@junros.com` の形か見る（違えば拒否） | MIME を解く（CPU 10 ms を守る） |
| 4,000,000 バイトを超えたら拒否 | 本文のハッシュ（同上） |
| 長さ・宛先・送信元に HMAC 署名して POST | 返信・転送（迷惑メールの踏み台にならない） |
| 一時的な失敗は例外を投げて再送させる | R2・KV・D1 などの保存（**従量課金に触れない**） |
| | 宛先・送信元・件名をログに出す |

## 🔴 費用

**無料プランだけ。** Workers Free（1 日 10 万リクエスト・CPU 10 ms）を
超えると**止まるだけで請求は来ない**。R2 は 2026-10-07 に解約済みで、
ここでも使わない。**Workers Paid に上げない。**

## 前提（順番を守る）

`mail_import.sql` の冒頭の「適用順」が正本。要約:

1. `mail_import.sql` を人が Supabase SQL Editor で流す
2. サーバ（`/api/inbound-mail`）がデプロイ済み。**`MAIL_IMPORT_ENABLED` は未設定のまま**
3. このページの手順で Worker を出し、Email Routing の宛先にする
4. 試験送信が通ってから、Vercel の `MAIL_IMPORT_ENABLED=true` → アプリの `kMailImportEnabled`

> 🔴 **逆にすると、アプリがアドレスを出しても受け取る側が無く、転送したメールが黙って消える。**

## デプロイ（`junros.com` のゾーンが Cloudflare にできてから）

```bash
cd ~/Dev/toritavi/app/workers/inbound-mail   # main に入った後のパス
npm test                                     # 純粋な部品の検査（依存なし）

npx wrangler@4 login                         # 初回だけ。ブラウザが開く
npx wrangler@4 deploy                        # Worker を出す（routes なし）
npx wrangler@4 secret put INBOUND_MAIL_SECRET
#   → Vercel の INBOUND_MAIL_SECRET と同じ値を貼る（表示しない・どこにも書かない）
```

> 🔴 **秘密は Vercel 側にも同じ値を入れる。** Vercel の環境変数の変更は
> 利用者の許可が要る（`toritavi_app/CLAUDE.md` §4）。値はその場で生成して
> 両方に貼り、残さない（例: `openssl rand -hex 32`）。

## Email Routing の設定（ダッシュボード）

1. Cloudflare → `junros.com` → **Email** → **Email Routing** → 有効にする
   （MX と SPF の TXT レコードを Cloudflare が足す。**ゾーンが Cloudflare に
   ある前提**。お名前.com 側でネームサーバを Cloudflare に向けておく）
2. **Routing rules** → **Catch-all address** → 編集
   - Action: **Send to a Worker**
   - Destination: `junros-inbound-mail`
   - 有効（Enabled）にする
3. 個別のアドレス（`info@` など）を作る場合は、それだけ別のルールにする。
   **catch-all は `trips-` 以外を Worker が拒否する**ので、他のアドレスへの
   メールは送信者に差し戻る

## 試験送信

**サーバの `MAIL_IMPORT_ENABLED` が閉じている間に**やる。閉じていると
サーバは 503 を返し、Worker は例外を投げ、送信側は**再送を続ける**
（メールは失われない）。

1. **宛先の形が違う → 拒否されること**
   - 普段のメールから `hello@junros.com` へ送る → 数分で「宛先不明」の差し戻しが届く
2. **形が合っている → サーバまで届くこと**
   - アプリ（`kMailImportEnabled` を手元で true にしたビルド）か SQL で自分の
     アドレスを出す（`select token from toritavi_mail_aliases where user_id = '…'`
     —— **本番 DB の読み取りは人が行う**）
   - そのアドレスへ PDF 付きのメールを 1 通送る
   - Cloudflare → Workers → `junros-inbound-mail` → **Logs**（リアルタイム）で
     `upstream status 503` が出る ＝ 署名まで通って、停止中で止まっている
   - `401` が出たら秘密の入れ違い。`npx wrangler@4 secret put` をやり直す
3. **開ける**: Vercel の `MAIL_IMPORT_ENABLED=true`（許可を得てから）→ 再デプロイ
   - 送信側の再送（数分〜数十分おき）で同じメールが入る
   - `toritavi_inbox_items` に 1 行、`toritavi-inbox` に `{user_id}/{item_id}/1.pdf`
   - Vercel のログに `[inbound-mail] accepted status=pending … attachments=1`
4. **Gmail の自動転送**: Gmail の設定 → 転送 → 転送先に自分のアドレスを追加
   → 受信箱に `forward_confirm` の行（確認コードだけ）ができること

## 応答の約束（サーバと Worker）

| サーバの応答 | Worker | 送信者から見て |
|---|---|---|
| 200 | 何もしない | 届いた（捨てられた場合も同じ） |
| 401 | **例外**（設定の誤り。捨てるより再送） | 一時エラー → 再送 |
| 413 など 4xx | 何もしない | 届いた |
| 5xx・通信不可 | **例外** | 一時エラー → 再送 |
| （宛先の形が違う・4 MB 超） | `setReject` | 恒久エラー → 差し戻し |

> `[要確認]` **例外を投げたとき、Email Routing が送信側に「一時エラー（4xx）」を
> 返すことは、公式の文書で確かめられていない**（2026-10-08 時点の Runtime API の
> ページに記載なし）。試験送信の 2 で、停止中に送ったメールが**開けた後に届く**
> ことを実測で確かめる。届かなければ「例外＝恒久エラー」で、停止中のメールは
> 失われる —— その場合は開ける前に Worker を Email Routing から外しておく運用にする。

## 検査

```bash
npm test     # 宛先の判定・署名・応答の解釈（node --test・依存なし）
```

サーバ側の `src/lib/__tests__/inbound-mail-worker-contract.test.ts` が、
**この Worker の署名をサーバの検証が通すこと**を見張る（形がずれると
全メールが 401 になるため）。
