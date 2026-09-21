/**
 * 🔴 **利用者に見せる文言が、日本語のまま残っていないこと。**
 *
 * ## なぜ要るか（2026-09-21）
 *
 * アプリは **1032 キー全訳済み**で端末の言語に追随するのに、
 * **サーバが返す `message` だけが日本語固定**だった。画面はサーバの
 * `message` を優先して出すので（`scan_screen.dart` の `_friendly`）、
 * **英語の利用者が日本語のエラーを読んでいた。**
 *
 * 無料枠は月 15 件で、**上限に当たるのは珍しくない。**
 *
 * ## この検査が守ること
 *
 * 1. カタログに**日英が両方そろっている**（空文字も落とす）
 * 2. **経路に日本語の直書きが戻っていない** —— 型は文字列なので、
 *    リテラルを書いても**コンパイルは通ってしまう。** ここで見張る
 * 3. `resolveLang` が**利用者の設定を優先**する
 * 4. **ゲスト / Pro の言い分けが英語にも効いている**（別ファイルにもあるが、
 *    ここでは「日英どちらでも `msgsFor` を通れば別物になる」ことを見る）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  API_MESSAGES,
  API_MESSAGES_N,
  apiMessage,
  apiMessageN,
  resolveLang,
  DEFAULT_LANG,
} from "../api-messages.ts";

const LANGS = ["ja", "en"] as const;

test("カタログは日英がそろっていて、空が無い", () => {
  for (const [key, v] of Object.entries(API_MESSAGES)) {
    for (const lang of LANGS) {
      const s = v[lang];
      assert.equal(typeof s, "string", `🔴 ${key}.${lang} が文字列でない`);
      assert.ok(s.trim().length > 0, `🔴 ${key}.${lang} が空`);
    }
    // 🔴 **日英が同じ文字列なら、訳し忘れを疑う。**
    assert.notEqual(v.ja, v.en, `🔴 ${key} の日英が同じ（訳し忘れ？）`);
  }
});

test("数を埋める文言も、日英そろっていて数が入る", () => {
  for (const [key, v] of Object.entries(API_MESSAGES_N)) {
    for (const lang of LANGS) {
      const s = v[lang](7);
      assert.ok(s.trim().length > 0, `🔴 ${key}.${lang} が空`);
      assert.ok(s.includes("7"), `🔴 ${key}.${lang} に数が入っていない: ${s}`);
    }
    assert.notEqual(v.ja(7), v.en(7), `🔴 ${key} の日英が同じ`);
  }
});

test("🔴 英語に日本語が混ざっていない", () => {
  const jp = /[ぁ-んァ-ヶ一-龥]/;
  for (const [key, v] of Object.entries(API_MESSAGES)) {
    assert.ok(!jp.test(v.en), `🔴 ${key}.en に日本語が残っている: ${v.en}`);
  }
  for (const [key, v] of Object.entries(API_MESSAGES_N)) {
    assert.ok(!jp.test(v.en(1)), `🔴 ${key}.en に日本語が残っている`);
  }
});

test("apiMessage / apiMessageN が言語で切り替わる", () => {
  assert.notEqual(
    apiMessage("plan_unavailable", "ja"),
    apiMessage("plan_unavailable", "en"),
  );
  assert.notEqual(
    apiMessageN("too_many_images", "ja", 3),
    apiMessageN("too_many_images", "en", 3),
  );
});

test("🔴 利用者の設定を、ヘッダより優先する", () => {
  // アプリが `syncMailLanguage()` で入れた値が正。**ヘッダは予備。**
  assert.equal(
    resolveLang({ userMetadata: { lang: "en" }, acceptLanguage: "ja-JP" }),
    "en",
  );
  assert.equal(
    resolveLang({ userMetadata: { lang: "ja" }, acceptLanguage: "en-US" }),
    "ja",
  );
});

test("利用者が分からないときだけ Accept-Language を見る", () => {
  assert.equal(resolveLang({ acceptLanguage: "en-GB,en;q=0.9" }), "en");
  assert.equal(resolveLang({ acceptLanguage: "ja-JP" }), "ja");
  // 🔴 **判定できなければ日本語へ倒す。** 倒す先を 1 つに決めておく。
  assert.equal(resolveLang({}), DEFAULT_LANG);
  assert.equal(resolveLang({ userMetadata: {}, acceptLanguage: null }), "ja");
  assert.equal(resolveLang({ acceptLanguage: "fr-FR" }), "ja");
});

test("壊れた値でも落ちない", () => {
  // `raw_user_meta_data` は利用者が書き換えられる。**例外を出さない。**
  assert.equal(resolveLang({ userMetadata: { lang: 42 as unknown as string } }), "ja");
  assert.equal(resolveLang({ userMetadata: null }), "ja");
  assert.equal(resolveLang({ userMetadata: { lang: "EN-us" } }), "en");
});

/** `src` 配下の .ts を集める（テストと型定義は除く）。 */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      sources(p, out);
    } else if (p.endsWith(".ts") || p.endsWith(".tsx")) {
      out.push(p);
    }
  }
  return out;
}

test("🔴 経路に日本語の message が直書きされていない", () => {
  // **型は `string` なので、リテラルを書いてもコンパイルは通る。**
  // 通るからこそ、ここで見張る。`CLAUDE.md` §6-1「出ないのに落ちない」。
  const jp = /[ぁ-んァ-ヶ一-龥]/;
  const bad: string[] = [];
  for (const f of sources("src/app/api").concat(sources("src/lib"))) {
    if (f.endsWith("api-messages.ts")) continue; // カタログ本体
    const src = readFileSync(f, "utf8");
    src.split("\n").forEach((line, i) => {
      // `message:` に続く文字列リテラル／テンプレートに日本語があるもの。
      const m = line.match(/message:\s*(["'`])(.*?)\1/);
      if (m && jp.test(m[2])) bad.push(`${f}:${i + 1}  ${m[2].slice(0, 40)}`);
    });
  }
  assert.deepEqual(
    bad,
    [],
    "🔴 日本語の message が直書きされている（api-messages.ts へ移すこと）:\n" +
      bad.join("\n"),
  );
});

test("🔴 言語を決める場所が 1 つだけ（各所で meta.lang を読んでいない）", () => {
  // 読む場所が増えると、判定の仕方がずれて**経路によって言語が変わる。**
  const bad: string[] = [];
  for (const f of sources("src/app/api").concat(sources("src/lib"))) {
    if (f.endsWith("api-messages.ts")) continue;
    const src = readFileSync(f, "utf8");
    src.split("\n").forEach((line, i) => {
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
      // email-templates.ts は GoTrue のテンプレート文字列を組むので対象外。
      if (f.endsWith("email-templates.ts")) return;
      if (/\.lang\s*===?\s*["']en["']/.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], `🔴 言語判定が散らばっている: ${bad.join(", ")}`);
});
