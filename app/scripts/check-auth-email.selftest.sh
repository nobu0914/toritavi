#!/usr/bin/env bash
# ============================================================================
# 検査プログラムそのものを検査する。
#
# ## なぜ要るのか
#
# **緑のコードしか見たことのない検査は、まだ何も証明していない。**
# `check-auth-email.ts` は「今は異常なし」と言うが、それは
#   (a) 本当に壊れていない
#   (b) 検査が壊れていて何も見ていない
# のどちらでも同じ出力になる。区別するには**わざと壊して赤くなるか**を見るしかない。
#
# ここで注入するのは、2026-07-27 に**実際に起きた**欠陥と同じ形:
#   1. 社名が `株式会社コヨーテ・アンド・パウエル`（法務ページは合同会社）
#   2. 本文に旧サービス名 `GenBox` が残る
#   3. 閉じタグの後ろにエディタの自動補完で `>` が 1 つ増える
#   4. `{{ .ConfirmationURL }}` が 1 か所だけになる（ボタンだけ／素URLだけ）
#   5. 件名の 【JUNROS】 が別ブランドになる
#   6. `</div>` が 1 つ欠ける
#
# ## 使い方
#
#   bash scripts/check-auth-email.selftest.sh
#
# 対象ファイルを一時的に書き換えて実行し、**必ず git から復元する**（trap）。
# 途中で止めても復元される。作業ツリーが汚れているときは実行を拒否する。
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

TARGET="src/lib/email-templates.ts"
CHECK="scripts/check-auth-email.ts"

# **汚れた作業ツリーでは走らせない。** 復元は `git checkout` に頼っているので、
# 未コミットの変更があると、それごと巻き戻して利用者の作業を消す。
if ! git diff --quiet -- "$TARGET"; then
  echo "❌ $TARGET に未コミットの変更がある。復元で失う可能性があるため中止する。"
  exit 2
fi

restore() { git checkout -- "$TARGET" 2>/dev/null; }
trap restore EXIT

pass=0
fail=0

# $1 = 説明 / $2 = 注入する perl 式 / $3 = 赤になったときに出るはずの語
expect_red() {
  local desc=$1 mutation=$2 expect=$3
  restore
  perl -0777 -pi -e "$mutation" "$TARGET"

  if git diff --quiet -- "$TARGET"; then
    echo "⚠️  [$desc] 注入が効いていない（ファイルが変わっていない）。式を見直すこと"
    fail=$((fail + 1)); return
  fi

  local out rc
  out=$(npx tsx "$CHECK" 2>&1); rc=$?

  if [[ $rc -eq 0 ]]; then
    echo "❌ [$desc] **壊したのに緑のまま。検査が見落としている**"
    fail=$((fail + 1))
  elif ! grep -q "$expect" <<<"$out"; then
    echo "⚠️  [$desc] 赤にはなったが、想定と違う理由（'$expect' が出ていない）"
    echo "$out" | grep "^❌" | sed 's/^/      /' | head -3
    fail=$((fail + 1))
  else
    echo "✅ [$desc] 検知した"
    pass=$((pass + 1))
  fi
}

echo "════ 検査プログラムの自己検査 ════"
echo "（$TARGET を一時的に壊して、赤くなるかを見る。終了時に必ず復元する）"
echo

expect_red "① 社名が株式会社に戻る" \
  's/合同会社 Coyote and Powell/株式会社コヨーテ・アンド・パウエル/' \
  "株式会社"

expect_red "② 旧サービス名 GenBox が残る" \
  's/メールアドレスの確認<\/div>/GenBox<\/div>/' \
  "GenBox"

expect_red "③ 閉じタグの後ろに余分な >" \
  's/<\/p>\n<\/div>`/<\/p>\n<\/div>>`/' \
  "余分な >"

expect_red "④ ConfirmationURL が 1 か所だけ" \
  's/\{\{ \.ConfirmationURL \}\}<\/p>/-<\/p>/' \
  "ConfirmationURL"

expect_red "⑤ 件名が別ブランド" \
  's/【JUNROS】メールアドレスの確認/【Curlew】メールアドレスの確認/' \
  "件名"

expect_red "⑥ div の閉じが 1 つ足りない" \
  's/<div style="font-size:17px;font-weight:700">メールアドレスの確認<\/div>/<div style="font-size:17px;font-weight:700">メールアドレスの確認/' \
  "div の開閉"

restore
echo
echo "════ 復元後、素の状態で緑に戻るか ════"
if npx tsx "$CHECK" >/dev/null 2>&1; then
  echo "✅ 復元後は緑"
  pass=$((pass + 1))
else
  echo "❌ **復元できていない。** git status を確認すること"
  fail=$((fail + 1))
fi

echo
echo "════════════════════════════"
if [[ $fail -eq 0 ]]; then
  echo "🟢 自己検査 $pass 件すべて通過 —— 検査は実際に欠陥を捕まえる"
  exit 0
fi
echo "🔴 $fail 件が想定どおりに動かない（通過 $pass 件）"
exit 1
