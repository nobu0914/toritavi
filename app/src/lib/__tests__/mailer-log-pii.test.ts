// 送信失敗のときに、**宛先アドレスがログへ流れないこと。**
//
// 出所: 2026-09-06 データ保護監査 レーン 7（JR000218）。
// `email-change-notice` は失敗時に `detail` を `console.error` へ出し、
// それが Vercel のログに残る。`detail` の中身は **Resend の応答本文**で、
// 失敗理由に宛先が入ることがある。
//
// 🔴 **「本文に宛先を出さない」というコメントだけがあって、実装が無かった。**
//    こちらが `to` を足していないことは、相手が足してこないことを意味しない。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sendMail } from "../mailer.ts";

const VICTIM = "kijiatora.regi@gmail.com";

/** `fetch` を差し替えて 1 回だけ応答を返す。戻り値で元に戻す。 */
function stubFetch(impl: () => Promise<Response> | never): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => impl()) as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

function withKey<T>(fn: () => T): T {
  const prev = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test_key";
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prev;
  }
}

describe("送信失敗のログに宛先が残らない", () => {
  test("🔴 プロバイダが応答本文に宛先を入れてきても、伏せられる", async () => {
    const restore = stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            statusCode: 422,
            message: `Invalid \`to\` field: ${VICTIM} is not a valid address`,
          }),
          { status: 422 },
        ),
    );
    try {
      const r = await withKey(() =>
        sendMail({ to: VICTIM, subject: "s", text: "t" }),
      );
      assert.equal(r.ok, false);
      const detail = r.ok ? "" : (r.detail ?? "");
      assert.ok(detail.includes("422"), "状態コードは残す（原因の切り分けに要る）");
      assert.ok(
        !detail.includes(VICTIM),
        `宛先がそのまま残った: ${detail}`,
      );
      assert.ok(
        detail.includes("[メール省略]"),
        `伏せた印が無い（素通りしている）: ${detail}`,
      );
    } finally {
      restore();
    }
  });

  // 🔴 これが「伏せてから切る」を釘付けにする。
  //    先に 200 文字で切ると、境界で `user@exa` のような**断片**が残る。
  //    断片は `EMAIL_RE`（末尾に `\.[a-z]{2,}` が要る）に当たらないので、
  //    そのあと伏せても手遅れになる。
  test("🔴 200 文字の境界にアドレスがあっても、断片が残らない", async () => {
    // 🔴 **切れ目が `@` の「後ろ」に来るように詰める。**
    //    ここを間違えると（`@` より手前で切れると）断片に `@` が入らず、
    //    **順序を逆にしても緑のまま通る**。最初に書いたときそれで素通りした。
    //    アドレスは 24 文字・`@` は 13 文字目。182 文字目から置けば
    //    `@` は 195、200 で切ると `kijiatora.regi@gma` が残る ——
    //    末尾に `.tld` が無いので EMAIL_RE には当たらない。
    const pad = "x".repeat(181);
    const body = `${pad} ${VICTIM} tail`;
    // 前提の検算。詰め物やアドレスを変えたら、ここで落ちる。
    const at = body.indexOf("@");
    assert.ok(at < 200, `切れ目が @ の手前にある（この配置では何も検出できない）: @=${at}`);
    assert.ok(
      body.indexOf(VICTIM) + VICTIM.length > 200,
      "アドレスが 200 文字以内に収まっている（境界を跨いでいない）",
    );
    const restore = stubFetch(async () => new Response(body, { status: 500 }));
    try {
      const r = await withKey(() =>
        sendMail({ to: VICTIM, subject: "s", text: "t" }),
      );
      const detail = r.ok ? "" : (r.detail ?? "");
      assert.ok(
        !/@/.test(detail),
        `アドレスの断片が残った（切ってから伏せている）: ${detail}`,
      );
    } finally {
      restore();
    }
  });

  test("例外で落ちたときも伏せる", async () => {
    const restore = stubFetch(() => {
      throw new Error(`connect failed while sending to ${VICTIM}`);
    });
    try {
      const r = await withKey(() =>
        sendMail({ to: VICTIM, subject: "s", text: "t" }),
      );
      assert.equal(r.ok, false);
      const detail = r.ok ? "" : (r.detail ?? "");
      assert.ok(!detail.includes(VICTIM), `宛先が残った: ${detail}`);
    } finally {
      restore();
    }
  });

  test("鍵が無いときは送ったことにしない（既存の約束）", async () => {
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const r = await sendMail({ to: VICTIM, subject: "s", text: "t" });
      assert.equal(r.ok, false);
      assert.equal(r.ok ? "" : r.reason, "not_configured");
    } finally {
      if (prev !== undefined) process.env.RESEND_API_KEY = prev;
    }
  });
});
