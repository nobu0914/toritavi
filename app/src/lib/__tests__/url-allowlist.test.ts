/**
 * 🔴 **コンシェルジュを降ろした理由そのものを検査する。**
 *
 * 2026-08-01 に画面ごと削除し、08-14 にフラグを閉じた理由が
 * 「AI が実在しない URL を出しうるのに誰も検査していない」だった。
 *
 * 🔴 **プロンプトの指示は担保ではない。** `info_ai_service.dart` は
 * 「実在する公式・著名サイトのURLのみ。不確かなら出さない」と書いていたが、
 * それでも「担保が無い」と判定されていた。**仕組みで落とす。**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedUrl,
  stripDisallowedUrls,
  ALLOWED_HOST_SUFFIXES,
} from "../url-allowlist.ts";

test("行政のドメインは通す", () => {
  for (const u of [
    "https://www.mofa.go.jp/j_info/visit/visa/",
    "https://www.jma.go.jp/bosai/",
    "https://www.tokyo.lg.jp/",
    "https://travel.state.gov/content/travel.html",
    "https://www.gov.uk/foreign-travel-advice",
    "https://www.canada.ca/en.html",
    "https://www.gc.ca/",
    "https://www.smartraveller.gov.au/",
    "https://www.govt.nz/",
  ]) {
    assert.equal(isAllowedUrl(u), true, `🔴 落としてはいけない: ${u}`);
  }
});

test("🔴 それ以外は落とす（実在するかに関わらず）", () => {
  for (const u of [
    "https://example.com/visa",
    "https://www.google.com/search?q=visa",
    "https://ana.co.jp/",
    "https://www.booking.com/",
    "https://mofa.go.jp.evil.com/", // 🔴 似せた宛先
    "https://notreal-embassy.info/",
  ]) {
    assert.equal(isAllowedUrl(u), false, `🔴 通してはいけない: ${u}`);
  }
});

test("🔴 https 以外は落とす", () => {
  assert.equal(isAllowedUrl("http://www.mofa.go.jp/"), false);
  assert.equal(isAllowedUrl("ftp://www.mofa.go.jp/"), false);
  assert.equal(isAllowedUrl("javascript:alert(1)"), false);
});

test("🔴 壊れた URL・IP 直打ちは落とす（判定できないものは通さない）", () => {
  for (const u of ["", "not a url", "https://", "https://203.0.113.9/", "https://[::1]/"]) {
    assert.equal(isAllowedUrl(u), false, `🔴 通してはいけない: ${u}`);
  }
});

test("🔴 末尾一致が広すぎないこと（.gov を含むだけの別ドメイン）", () => {
  assert.equal(isAllowedUrl("https://fake-gov.example/"), false);
  assert.equal(isAllowedUrl("https://govfake.com/"), false);
  // `.gov` で終わるものは通す。
  assert.equal(isAllowedUrl("https://www.usa.gov/"), true);
});

test("マークダウンのリンクは、許可外なら表示文だけ残す", () => {
  const r = stripDisallowedUrls(
    "詳しくは [こちら](https://example.com/x) と [外務省](https://www.mofa.go.jp/) を。",
  );
  assert.equal(
    r.text,
    "詳しくは こちら と [外務省](https://www.mofa.go.jp/) を。",
  );
  assert.deepEqual(r.removed, ["https://example.com/x"]);
});

test("🔴 黙って消さない（文が壊れない）", () => {
  // 表示文が残るので「こちらをご覧ください」が意味を保つ。
  const r = stripDisallowedUrls("[公式サイト](https://fake.example/) をご覧ください");
  assert.ok(r.text.includes("公式サイト"));
  assert.ok(!r.text.includes("fake.example"));
});

test("素の URL も落とす", () => {
  const r = stripDisallowedUrls("参考: https://example.com/a と https://www.gov.uk/b");
  assert.ok(!r.text.includes("example.com"));
  assert.ok(r.text.includes("https://www.gov.uk/b"));
});

test("許可されたものだけなら、文章は変わらない", () => {
  const src = "https://www.mofa.go.jp/ と [気象庁](https://www.jma.go.jp/) を見てください。";
  const r = stripDisallowedUrls(src);
  assert.equal(r.text, src);
  assert.deepEqual(r.removed, []);
});

test("URL が 1 つも無い文章は素通し", () => {
  const src = "出発の 3 日前までに手続きを済ませてください。";
  assert.equal(stripDisallowedUrls(src).text, src);
});

test("🔴 許可リストは行政に限られている（商用が紛れていない）", () => {
  // 足すときに「たぶん公式」で商用ドメインが入るのを止める。
  for (const suf of ALLOWED_HOST_SUFFIXES) {
    assert.ok(
      /\.(go\.jp|lg\.jp|gov|gov\.uk|gc\.ca|canada\.ca|gov\.au|govt\.nz|who\.int|icao\.int|un\.org)$/.test(
        suf,
      ),
      `🔴 行政・国際機関以外が許可リストに入っている: ${suf}`,
    );
  }
});
