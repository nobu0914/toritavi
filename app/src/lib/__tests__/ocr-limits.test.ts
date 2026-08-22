// 消費件数・トークン見積り・原価の計算。**数字が仕様どおりか。**
//
// 確定仕様（2026-08-22）: PDF は 5 ページごとに 1 件。
//   1-5 → 1 / 6-10 → 2 / 11-15 → 3 / 16-20 → 4
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  actualCostCents,
  estimateCostCents,
  estimateImageTokens,
  estimateTextTokens,
  MAX_COST_CENTS_PER_REQUEST,
  MAX_INPUT_TOKENS,
  pdfUnits,
  TOKENS_PER_PDF_PAGE,
} from "../ocr-limits.ts";

describe("PDF のページ → 消費件数", () => {
  test("境界がすべて仕様どおり", () => {
    const table: Array<[number, number]> = [
      [1, 1], [5, 1],
      [6, 2], [10, 2],
      [11, 3], [15, 3],
      [16, 4], [20, 4],
    ];
    for (const [pages, units] of table) {
      assert.equal(pdfUnits(pages), units, `${pages} ページ → ${units} 件のはず`);
    }
  });

  test("0 ページや負値でも 1 件を下回らない（0 件で通さない）", () => {
    assert.equal(pdfUnits(0), 1);
    assert.equal(pdfUnits(-3), 1);
  });
});

describe("トークン見積り", () => {
  test("画像は長辺 1568px に丸めた面積で頭打ちになる", () => {
    // 巨大な画像でも、縮小後の面積が上界。
    const huge = estimateImageTokens(10000, 10000);
    const capped = estimateImageTokens(1568, 1568);
    assert.equal(huge, capped, "縮小後の上界を超えている");
    assert.ok(huge < 3400, `画像 1 枚が ${huge} トークンは高すぎる`);
  });

  test("小さい画像は小さく見積もる", () => {
    assert.ok(estimateImageTokens(100, 100) < estimateImageTokens(1000, 1000));
  });

  test("テキストは文字数より多めに見積もる（日本語で下振れしない）", () => {
    // 🔴 見積りが実費を下回ると予算をすり抜ける。**必ず上振れさせる。**
    assert.ok(estimateTextTokens(1000) >= 1000);
  });
});

describe("原価", () => {
  test("入力の上限に達したときが 1 リクエストの最大原価", () => {
    assert.equal(MAX_COST_CENTS_PER_REQUEST, estimateCostCents(MAX_INPUT_TOKENS));
    // 運用の説明に使う数字。桁が変わったら気づけるように固定する。
    assert.equal(MAX_COST_CENTS_PER_REQUEST, 25);
  });

  test("見積りは実費を下回らない（同じトークン数なら）", () => {
    const tokens = 30_000;
    assert.ok(
      estimateCostCents(tokens) >= actualCostCents(tokens, 4096),
      "見積りが実費より小さいと予算を超える",
    );
  });

  test("端数は切り上げる（0 円にしない）", () => {
    assert.ok(actualCostCents(1, 0) >= 1);
  });
});

describe("🔴 見積りは実費の上界でなければならない", () => {
  test("PDF 1 ページの見積りが公称の上界（テキスト 3,000 + 画像 1,568）を下回らない", () => {
    // 2026-08-22 の外部調査で、当初の 3,000 では足りないことが分かった。
    // 下回ると、予約した額より実費が大きくなり予算の判定をすり抜ける。
    const OFFICIAL_MAX_PER_PAGE = 3000 + 1568;
    assert.ok(
      TOKENS_PER_PDF_PAGE >= OFFICIAL_MAX_PER_PAGE,
      `${TOKENS_PER_PDF_PAGE} は公称の上界 ${OFFICIAL_MAX_PER_PAGE} を下回る`,
    );
  });
});
