/**
 * App Attest の検証を、**実物の attestation** で固定する。
 *
 * fixture は `node-app-attest` が同梱している本物（別アプリのもの）を
 * `node_modules` から読む。**リポジトリに写さない** —— 写すと版が固定され、
 * ライブラリを上げたときに「古い写しを検査している」状態になる。
 * バージョンは 1.0.1 に固定してあるので消えることはない。
 * （消えたらこの検査は**落ちる**。黙って素通りはしない。）
 *
 * 🔴 ここで守るのは **「検証したつもりで通す」経路を作らない**こと。
 *    投げないことと、判定できなければ必ず `failed` になること。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { verifyAppAttest, APP_BUNDLE_ID } from "../attest.ts";

type Fixture = { attestation: string; challenge: string; keyId: string };
const load = (env: "development" | "production"): Fixture =>
  JSON.parse(
    readFileSync(
      `node_modules/node-app-attest/test/fixtures/attestation-${env}.json`,
      "utf8",
    ),
  );

/** fixture のアプリ（JUNROS ではない）。 */
const TEAM = "V8H6LQ9448";
const BUNDLE = "io.uebelacker.AppAttestExample";

const call = (f: Fixture, o: Parameters<typeof verifyAppAttest>[1] = {}) =>
  verifyAppAttest(
    { attestation: f.attestation, keyId: f.keyId, challenge: Buffer.from(f.challenge, "base64") },
    { teamId: TEAM, bundleId: BUNDLE, ...o },
  );

describe("正しい attestation", () => {
  test("本番の attestation は通る", () => {
    const r = call(load("production"));
    assert.equal(r.state, "attested");
    assert.match(r.publicKey ?? "", /BEGIN PUBLIC KEY/);
  });

  test("開発の attestation は allowDevelopment を付ければ通る", () => {
    assert.equal(call(load("development"), { allowDevelopment: true }).state, "attested");
  });
});

describe("🔴 落ちるべきものが落ちる", () => {
  test("🔴 開発の attestation は、既定では通らない", () => {
    // ここが通ると、**開発証明書で署名した改造アプリを受け入れる**。
    const r = call(load("development"));
    assert.equal(r.state, "failed", "開発環境の attestation が本番で通っている");
  });

  test("🔴 Team ID が違えば落ちる", () => {
    assert.equal(call(load("production"), { teamId: "XXXXXXXXXX" }).state, "failed");
  });

  test("🔴 バンドル ID が違えば落ちる", () => {
    assert.equal(call(load("production"), { bundleId: "com.example.other" }).state, "failed");
  });

  test("🔴 チャレンジが違えば落ちる（使い回しを防ぐ要）", () => {
    const f = load("production");
    const r = verifyAppAttest(
      { attestation: f.attestation, keyId: f.keyId, challenge: Buffer.from("wrong-challenge") },
      { teamId: TEAM, bundleId: BUNDLE },
    );
    assert.equal(r.state, "failed");
  });

  test("🔴 keyId が違えば落ちる", () => {
    const f = load("production");
    const r = verifyAppAttest(
      {
        attestation: f.attestation,
        keyId: Buffer.alloc(32).toString("base64"),
        challenge: Buffer.from(f.challenge, "base64"),
      },
      { teamId: TEAM, bundleId: BUNDLE },
    );
    assert.equal(r.state, "failed");
  });

  test("🔴 attestation を 1 バイト書き換えたら落ちる", () => {
    const f = load("production");
    const b = Buffer.from(f.attestation, "base64");
    b[b.length - 1] ^= 0xff;
    const r = verifyAppAttest(
      { attestation: b.toString("base64"), keyId: f.keyId, challenge: Buffer.from(f.challenge, "base64") },
      { teamId: TEAM, bundleId: BUNDLE },
    );
    assert.equal(r.state, "failed");
  });
});

describe("🔴 例外を外へ出さない", () => {
  test("壊れた入力でも投げずに failed", () => {
    for (const bad of ["", "not-base64!!", "AAAA"]) {
      let r;
      assert.doesNotThrow(() => {
        r = verifyAppAttest(
          { attestation: bad, keyId: "x", challenge: Buffer.from("c") },
          { teamId: TEAM, bundleId: BUNDLE },
        );
      }, `"${bad}" で投げた`);
      assert.equal(r!.state, "failed");
    }
  });

  test("🔴 Team ID が未設定なら failed（黙って通さない）", () => {
    const f = load("production");
    const r = verifyAppAttest(
      { attestation: f.attestation, keyId: f.keyId, challenge: Buffer.from(f.challenge, "base64") },
      { teamId: undefined, bundleId: BUNDLE },
    );
    assert.equal(r.state, "failed");
    assert.equal(r.reason, "no_team_id");
  });

  test("理由に内部構造をそのまま載せない（80 字で切る）", () => {
    const r = verifyAppAttest(
      { attestation: "AAAA", keyId: "x", challenge: Buffer.from("c") },
      { teamId: TEAM, bundleId: BUNDLE },
    );
    assert.ok((r.reason ?? "").length <= 80);
  });
});

describe("🔴 検証の前提を env で緩められない", () => {
  /** コメントを除いた原文（理由を書いたコメント自体を拾わないため）。 */
  const code = readFileSync("src/lib/attest.ts", "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

  test("バンドル ID は定数（env で差し替えられない）", () => {
    // 差し替えられると、**別のアプリの attestation を受け入れる**。
    assert.equal(APP_BUNDLE_ID, "com.toritavi.app");
    assert.ok(
      /APP_BUNDLE_ID\s*=\s*"com\.toritavi\.app"/.test(code),
      "APP_BUNDLE_ID が literal でない",
    );
    const envReads = (code.match(/process\.env/g) ?? []).length;
    assert.equal(
      envReads,
      1,
      `process.env を ${envReads} 回読んでいる。**Team ID の 1 回だけ**が正しい` +
        "（バンドル ID や allowDevelopment を env で緩めない）",
    );
  });

  test("開発環境の許可は、明示的に true を渡したときだけ", () => {
    assert.ok(
      /allowDevelopmentEnvironment:\s*opts\.allowDevelopment === true/.test(code),
      "🔴 開発環境の attestation を無条件に許している",
    );
  });
});
