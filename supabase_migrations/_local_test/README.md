# ローカルでマイグレーションを試す（スキーマのみ）

`MIGRATION_GUIDE.md` §4-2 の「バックアップからローカル復元して試す」を、
**本番データを持ち出さずに**軽くやるための足場。

## これで分かること / 分からないこと

| 分かる | 分からない |
|---|---|
| SQL が構文として通るか | 実データで壊れないか |
| 既存マイグレーションの上に載るか | 件数の想定が現実と合っているか |
| 関数の挙動（加算・拒否・キーの算出） | RLS が実際の JWT で意図どおり効くか |
| バックフィルの正しさと冪等性 | Supabase 固有の拡張・トリガの影響 |

**不可逆な変更（`DROP` / バックフィル / 条件付き `UPDATE`）を本番へ流す前には、
これに加えて §4-2 の実データ復元も行うこと。** ここで通ることは必要条件であって
十分条件ではない。

## 使い方

```bash
BIN=/opt/homebrew/opt/postgresql@17/bin
DATA=/tmp/pgtest_data
SOCK=/tmp/pgt55432   # ⚠️ ソケットのパスは 103 バイト以内。深い階層に置くと起動しない

mkdir -p "$SOCK"
$BIN/initdb -D "$DATA" -U postgres --auth=trust
LC_ALL=C $BIN/pg_ctl -D "$DATA" -o "-p 55432 -k $SOCK" -l /tmp/pg.log start
# ⚠️ LC_ALL=C が要る。ロケール未設定だと
#    「postmasterは起動処理中はマルチスレッドで動作します」で落ちる

P="$BIN/psql -h $SOCK -p 55432 -U postgres -v ON_ERROR_STOP=1"
$P -d postgres -c "DROP DATABASE IF EXISTS mtest;" -c "CREATE DATABASE mtest;"
$P -d mtest -f _local_test/00_supabase_stub.sql
for f in 005_ocr_usage 013_ai_usage_hardening 019_ai_usage_server_only; do
  $P -d mtest -f "$f.sql"
done
$P -d mtest -f _local_test/verify_021.sql

# 後片付け
$BIN/pg_ctl -D "$DATA" stop && rm -rf "$DATA" "$SOCK"
```

## ファイル

| ファイル | 内容 |
|---|---|
| `00_supabase_stub.sql` | Supabase 固有の前提だけを最小再現（`anon`/`authenticated`/`service_role` ロール、`auth.users`、`auth.uid()`、コンシェルジュ側のテーブル）。**本番データは一切含まない** |
| `verify_021.sql` | 021 の検証 10 項目。バックフィルの一致と冪等性、`p_units` の加算と範囲外拒否、JST キー、新旧シグネチャの共存、RLS |

`verify_021.sql` の項目 8 は、**021 が直した穴を再現して見せる**もの。
UTC 18:00（= JST 翌日 03:00）の時点で JST キーと UTC キーが 1 日ずれることを示す。
これが毎日 9 時間、書く行と読む行を食い違わせて上限を無効にしていた。
