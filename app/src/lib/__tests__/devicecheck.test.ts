/**
 * DeviceCheck の境界を固定する。**Apple へは通信しない**（fetch を差し替える）。
 *
 * ここで守るのは 3 つ:
 *   ① 2 bit ⇄ 件数の対応が壊れないこと（ここが唯一の対応表）
 *   ② 「記録が無い（初回）」と「Apple に届かなかった」を**混同しない**こと
 *   ③ 設定漏れを「0 件使用」に化けさせないこと
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  bitsToUsed,
  usedToBits,
  deviceCheckConfigured,
  deviceCheckJwt,
  queryGuestUsed,
  setGuestUsed,
  type DeviceCheckEnv,
} from "../devicecheck.ts";

/** 検査用の P-256 鍵（Apple の本物ではない）。 */
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const P8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const ENV: DeviceCheckEnv = {
  APPLE_TEAM_ID: "TEAM123456",
  APPLE_DEVICECHECK_KEY_ID: "KEY1234567",
  APPLE_DEVICECHECK_P8: P8,
};

describe("2 bit と件数の対応", () => {
  test("0〜3 が往復する", () => {
    for (const used of [0, 1, 2, 3] as const) {
      const { bit0, bit1 } = usedToBits(used);
      assert.equal(bitsToUsed(bit0, bit1), used, `${used} が往復しない`);
    }
  });

  test("🔴 3 件がちょうど上限（4 状態に収まる）", () => {
    assert.deepEqual(usedToBits(3), { bit0: true, bit1: true });
    assert.equal(bitsToUsed(true, true), 3);
  });
});

describe("JWT", () => {
  test("3 つの部分に分かれ、ヘッダに kid と ES256 が入る", () => {
    const jwt = deviceCheckJwt(ENV, 1_700_000_000);
    const [h, p, s] = jwt.split(".");
    assert.equal(jwt.split(".").length, 3);
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    assert.equal(header.alg, "ES256");
    assert.equal(header.kid, "KEY1234567");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    assert.equal(payload.iss, "TEAM123456");
    assert.equal(payload.iat, 1_700_000_000);
    // ES256 の署名は raw r||s = 64 バイト。DER のままだと Apple が弾く。
    assert.equal(Buffer.from(s, "base64url").length, 64, "署名が P1363 形式でない");
  });

  test("🔴 `\\n` が literal で入っていても読める", () => {
    const escaped = { ...ENV, APPLE_DEVICECHECK_P8: P8.replace(/\n/g, "\\n") };
    assert.doesNotThrow(() => deviceCheckJwt(escaped, 1));
  });

  test("設定が無ければ投げる（黙って空の JWT を作らない）", () => {
    assert.throws(() => deviceCheckJwt({}, 1));
  });
});

describe("設定の有無", () => {
  test("3 つ揃って初めて configured", () => {
    assert.equal(deviceCheckConfigured(ENV), true);
    for (const k of Object.keys(ENV)) {
      const partial = { ...ENV, [k]: undefined };
      assert.equal(deviceCheckConfigured(partial), false, `${k} 欠けで true`);
    }
  });

  test("🔴 未設定は「0 件使用」ではなく not_configured", async () => {
    const r = await queryGuestUsed("tok", { env: {} });
    assert.deepEqual(r, { ok: false, reason: "not_configured" });
  });
});

describe("読み取り", () => {
  const okJson = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200 });

  test("bit を件数に直して返す", async () => {
    const r = await queryGuestUsed("tok", {
      env: ENV,
      fetchImpl: async () => okJson({ bit0: true, bit1: true }),
    });
    assert.deepEqual(r, { ok: true, used: 3, known: true });
  });

  test("🔴 記録の無い端末は used=0 / known=false（初回は正常）", async () => {
    // Apple は 200 + 本文 "Failed to find bit state" を返す。
    const r = await queryGuestUsed("tok", {
      env: ENV,
      fetchImpl: async () => new Response("Failed to find bit state", { status: 200 }),
    });
    assert.deepEqual(r, { ok: true, used: 0, known: false });
  });

  test("🔴 401 は unauthorized（「使っていない」に化けさせない）", async () => {
    const r = await queryGuestUsed("tok", {
      env: ENV,
      fetchImpl: async () => new Response("", { status: 401 }),
    });
    assert.deepEqual(r, { ok: false, reason: "unauthorized" });
  });

  test("🔴 通信できないときは unavailable", async () => {
    const r = await queryGuestUsed("tok", {
      env: ENV,
      fetchImpl: async () => {
        throw new Error("network");
      },
    });
    assert.deepEqual(r, { ok: false, reason: "unavailable" });
  });

  test("Bearer と device_token を送っている", async () => {
    let seen: { auth?: string; body?: string } = {};
    await queryGuestUsed("TOKEN_ABC", {
      env: ENV,
      fetchImpl: async (_u, init) => {
        const h = (init?.headers ?? {}) as Record<string, string>;
        seen = { auth: h.authorization, body: String(init?.body) };
        return okJson({ bit0: false, bit1: false });
      },
    });
    assert.match(seen.auth ?? "", /^Bearer ey/);
    assert.match(seen.body ?? "", /"device_token":"TOKEN_ABC"/);
  });
});

describe("書き込み", () => {
  test("件数を bit にして送る", async () => {
    let body = "";
    const ok = await setGuestUsed("tok", 2, {
      env: ENV,
      fetchImpl: async (_u, init) => {
        body = String(init?.body);
        return new Response("", { status: 200 });
      },
    });
    assert.equal(ok, true);
    assert.match(body, /"bit0":false/);
    assert.match(body, /"bit1":true/);
  });

  test("🔴 失敗したら false を返す（黙って成功と言わない）", async () => {
    assert.equal(
      await setGuestUsed("tok", 1, {
        env: ENV,
        fetchImpl: async () => new Response("", { status: 500 }),
      }),
      false,
    );
    assert.equal(
      await setGuestUsed("tok", 1, {
        env: ENV,
        fetchImpl: async () => {
          throw new Error("boom");
        },
      }),
      false,
    );
    assert.equal(await setGuestUsed("tok", 1, { env: {} }), false);
  });
});
