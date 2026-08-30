/**
 * `/api/guest/attest` の契約をソースで固定する。
 *
 * 実行時の検査（HTTP を通した往復）は route-harness で書けるが、
 * ここで見たいのは**設計上の約束**で、実行時には現れにくいものが多い ——
 * 「チャレンジを必ず捨てる」「書き込みは service client」など。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/app/api/guest/attest/route.ts", "utf8");
/** コメントを除いた原文（理由を書いたコメント自体を拾わないため）。 */
const code = src
  .split("\n")
  .filter((l) => {
    const t = l.trimStart();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  })
  .join("\n");

describe("誰が呼べるか", () => {
  test("認証必須", () => {
    assert.ok(code.includes("authenticateRequest"), "認証していない");
    assert.equal(
      (code.match(/status: 401/g) ?? []).length,
      2,
      "GET / POST の両方で未認証を弾いていない",
    );
  });

  test("🔴 会員（非匿名）は弾く", () => {
    // 通すと会員の行に attested が立ち、読み方が二重になる。
    assert.equal(
      (code.match(/!auth\.isAnonymous/g) ?? []).length,
      2,
      "GET / POST の両方で匿名以外を弾いていない",
    );
  });
});

describe("🔴 チャレンジは 1 回限り・短命", () => {
  test("寿命がある", () => {
    assert.ok(/CHALLENGE_TTL_MS\s*=/.test(code), "寿命が定義されていない");
    assert.ok(
      /Date\.now\(\) - issuedAt < CHALLENGE_TTL_MS/.test(code),
      "新鮮さを見ていない",
    );
  });

  test("🔴 成否にかかわらず捨てる", () => {
    // 残すと、同じチャレンジで何度でも試せる。
    // `challenge: null` は**検証の前に**組み立てる patch に入っていること。
    const patchAt = code.indexOf("challenge: null");
    const verifyAt = code.indexOf("verifyAppAttest(");
    assert.ok(patchAt > 0, "チャレンジを捨てていない");
    assert.ok(
      verifyAt > 0 && patchAt > verifyAt,
      "捨てる処理が検証より前にある（成功時だけ捨てる形になっていないか確認）",
    );
    // 成功分岐の中だけで捨てていないこと。
    const successBranch = code.slice(code.indexOf('result.state === "attested"'));
    assert.ok(
      !/^\s*const patch/m.test(successBranch),
      "patch の組み立てが成功分岐の中にある",
    );
  });
});

describe("🔴 書き込みは service client だけ", () => {
  test("upsert は service client 経由", () => {
    // 利用者は 028 の RLS で書けない。書けたら attested を自分で立てられる。
    assert.ok(code.includes("createServiceClient"), "service client を使っていない");
    const upserts = (code.match(/\.upsert\(/g) ?? []).length;
    const svcUses = (code.match(/svc\s*\n?\s*\.from\(|svc\.from\(/g) ?? []).length;
    assert.ok(upserts >= 1, "upsert が無い");
    assert.ok(svcUses >= upserts, "svc 以外の client で書いている疑い");
  });
});

describe("🔴 黙って「通った」と言わない", () => {
  test("記録に失敗したら 503（attested:true を返さない）", () => {
    assert.ok(
      /grant write failed/.test(src) && /upErr/.test(code),
      "書き込み失敗を握りつぶしている",
    );
    const upErrAt = code.indexOf("if (upErr)");
    const okAt = code.lastIndexOf("attested: true");
    assert.ok(upErrAt > 0 && upErrAt < okAt, "成功を返す前に書き込み失敗を見ていない");
  });

  test("🔴 落ちた理由を利用者へ返さない", () => {
    // 何を直せば通るかを教えることになる。
    assert.ok(
      !/reason:\s*result\.reason/.test(code),
      "検証の失敗理由をレスポンスに載せている",
    );
  });
});

describe("開発環境の受け入れ", () => {
  test("🔴 既定では受けない（env で明示したときだけ）", () => {
    assert.ok(
      /APPLE_APPATTEST_ALLOW_DEV === "1"/.test(code),
      "開発環境の attestation を無条件に受けている",
    );
  });
});
