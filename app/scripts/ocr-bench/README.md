# OCR ベンチ

`/api/ocr` の **プロンプトと読み取り精度**を、実データでまとめて回すための道具。

## なぜ要るか

ユニットテストはコードの分岐しか守れない。OCR で実際に壊れるのは

- プロンプトの文面が二通りに読める（同じ入力で結果が揺れる）
- ある規則を足したら、別の規則が効かなくなった
- 特定のカテゴリ・言語・書式だけ落ちる

で、いずれも**コードを変えずに壊れる**。だから実データを一括で通して
正解と突き合わせる場所が要る。

## 大事な前提

`run.ts` は `src/lib/ocr-prompt.ts` を **import する**。文面をここへ写さない。
写すと「直したはずの規則がベンチにだけ残る」形の食い違いが起きる
（`increment_ocr_usage` で実際に起きた形）。

ベンチは Anthropic API を直接叩く。**本番の `/api/ocr` は経由しない**ので、
利用者の OCR クォータを消費せず、`ai_usage` にも記録しない。
逆に言うと、認証・クォータ・レート制限・保存の配線はここでは検証できない。
そこは実機／シミュレータでの通し確認の担当。

## 使い方

```bash
# 1) 入力を「アプリが実際に送るバイト列」に揃える（JPEG q82・短辺2000上限）
python3 scripts/ocr-bench/prepare.py <データroot> /tmp/ocr-bench

# 2) 走らせる
ANTHROPIC_API_KEY=... npx tsx scripts/ocr-bench/run.ts /tmp/ocr-bench /tmp/ocr-bench/out

# 3) 採点
python3 scripts/ocr-bench/score.py /tmp/ocr-bench /tmp/ocr-bench/out
```

`--only <部分一致>` で絞れる。`--repeat N` は同じ入力を N 回投げて
**揺れ**を見る（プロンプトの曖昧さはこれでしか見つからない）。
