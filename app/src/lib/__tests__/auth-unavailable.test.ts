// ============================================================================
// 🔴 **認証基盤が答えられないことを「未認証（401）」にしない**（2026-10-24・夜間検査 5-3）。
//
// `authenticateRequest` は `const { data } = await sb.auth.getUser(token);
// if (!data.user) return null;` で、`error` を見ていなかった。
// @supabase/auth-js 2.103.0 は、通信の失敗や GoTrue の 502/503/504 を**投げずに**
// `{ data: { user: null }, error: AuthRetryableFetchError }` で返す
// （`GoTrueClient._getUser` の catch と `lib/fetch.js` の `handleError`）。
//
// その結果、GoTrue が落ちている間 `/api/account/delete` は 401 を返す。
// アプリは「新しいトークンで 401」＝「もう消えている」と読み、
// **アカウントが残ったまま端末の控えを消して「削除しました」と出す**
// （`auth_repository.dart` の `decideDelete`）。
//
// 固定すること:
//   1. 本物の `authenticateRequest` が、GoTrue の 5xx・通信断を
//      `AuthUnavailableError` にする（null にしない）
//   2. GoTrue が「この資格情報は通らない」と**はっきり答えた**ときは従来どおり null
//   3. 退会はそのとき 503 を返し、**何も消さない**
//   4. `authenticateRequest` を呼ぶすべての API が 503 に変える（401 の場合は 401 のまま）
// ============================================================================
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { NextRequest } from "next/server";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from "@supabase/supabase-js";
import { AuthUnavailableError, userFromGetUser } from "../auth-unavailable.ts";
import { CONCIERGE_ENABLED } from "../concierge-flags.ts";
import { EMAIL_CHANGE_NOTICE_ENABLED } from "../email-notice-flags.ts";
import { GUEST_MODE_ENABLED } from "../guest-quota.ts";
import { POST as deletePost } from "../../app/api/account/delete/route.ts";
import { POST as consentPost, DELETE as consentDelete } from "../../app/api/account/consent/route.ts";
import { POST as emailNoticePost } from "../../app/api/account/email-change-notice/route.ts";
import { GET as aiUsageGet } from "../../app/api/ai-usage/route.ts";
import { POST as conciergePost } from "../../app/api/concierge/route.ts";
import { GET as attestGet, POST as attestPost } from "../../app/api/guest/attest/route.ts";
import { POST as ocrPost } from "../../app/api/ocr/route.ts";
import { POST as pushTestPost } from "../../app/api/push/test/route.ts";
import { makeRequest } from "./support/route-harness.ts";
import { fakeDb, resetInjections } from "./support/fake-db.ts";

// 本物の `supabase-server.ts` は URL と鍵を**読み込んだ時点で**拾うので、先に置いてから読む。
// （ルートが import する `@/lib/supabase-server` はスタブ。ここだけ相対で本物を読む）
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.ANTHROPIC_API_KEY = "test-key-not-used";
const { authenticateRequest: realAuthenticateRequest } = await import("../supabase-server.ts");

const UID = "34343434-3434-4343-8343-343434343434";
const BEARER = { authorization: "Bearer test.header.payload" };
const realFetch = globalThis.fetch;

/** GoTrue（`/auth/v1/user`）だけを差し替える。ほかの宛先に出たら落とす。 */
function stubGoTrue(respond: () => Response | Promise<Response>) {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    if (!url.startsWith("https://auth-test.supabase.co/auth/v1/user")) {
      throw new Error(`unexpected fetch in test: ${url}`);
    }
    return respond();
  }) as typeof fetch;
  return seen;
}

function apiJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" },
  });
}

const GOTRUE = {
  down503: () => new Response("upstream connect error", { status: 503 }),
  down502: () => new Response("bad gateway", { status: 502 }),
  networkError: (): Response => {
    throw new TypeError("fetch failed");
  },
  internal500: () => apiJson(500, { code: "unexpected_failure", msg: "internal error" }),
  badJwt: () => apiJson(403, { code: "bad_jwt", msg: "invalid JWT: unable to parse or verify signature" }),
  userGone: () => apiJson(403, { code: "user_not_found", msg: "User from sub claim in JWT does not exist" }),
  ok: () =>
    apiJson(200, {
      id: UID,
      aud: "authenticated",
      role: "authenticated",
      is_anonymous: false,
      user_metadata: { lang: "ja" },
      app_metadata: {},
      created_at: "2026-09-01T00:00:00Z",
    }),
};

/** auth-js が通信断を console.error に出すので、検査の出力を汚さないよう黙らせる。 */
function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const orig = { error: console.error, warn: console.warn };
  console.error = () => {};
  console.warn = () => {};
  return fn().finally(() => {
    console.error = orig.error;
    console.warn = orig.warn;
  });
}

beforeEach(() => resetInjections());
afterEach(() => {
  globalThis.fetch = realFetch;
  resetInjections();
});

describe("本物の authenticateRequest（GoTrue の応答を差し替える）", () => {
  for (const [name, respond, status] of [
    ["GoTrue が 503", GOTRUE.down503, 503],
    ["GoTrue が 502", GOTRUE.down502, 502],
    ["GoTrue が 500", GOTRUE.internal500, 500],
    ["通信が届かない", GOTRUE.networkError, 0],
  ] as const) {
    test(`🔴 ${name} → AuthUnavailableError（null＝未認証にしない）`, async () => {
      const seen = stubGoTrue(respond);
      const err = await quiet(() =>
        realAuthenticateRequest(makeRequest({ headers: BEARER }) as Request).then(
          (v) => ({ returned: v }),
          (e: unknown) => e,
        ),
      );
      assert.equal(seen.length, 1, "GoTrue に問い合わせていない");
      assert.ok(
        err instanceof AuthUnavailableError,
        `🔴 認証基盤が答えられないのに未認証として扱った: ${JSON.stringify(err)}`,
      );
      assert.equal(err.status, status);
    });
  }

  test("GoTrue が「この JWT は通らない」と答えたら null（従来どおり 401 になる）", async () => {
    stubGoTrue(GOTRUE.badJwt);
    assert.equal(await realAuthenticateRequest(makeRequest({ headers: BEARER }) as Request), null);
  });

  test("GoTrue が「この利用者はいない」と答えたら null（退会済みの冪等な 401 は残す）", async () => {
    stubGoTrue(GOTRUE.userGone);
    assert.equal(await realAuthenticateRequest(makeRequest({ headers: BEARER }) as Request), null);
  });

  test("利用者が返れば、その人として通す", async () => {
    stubGoTrue(GOTRUE.ok);
    const auth = await realAuthenticateRequest(makeRequest({ headers: BEARER }) as Request);
    assert.equal(auth?.userId, UID);
    assert.equal(auth?.isAnonymous, false);
    assert.deepEqual(auth?.userMetadata, { lang: "ja" });
  });
});

describe("getUser の結果の読み分け（auth-js の本物のエラー型で）", () => {
  const user = { id: UID };
  test("利用者がいれば返す", () => {
    assert.equal(userFromGetUser({ data: { user }, error: null }), user);
  });
  for (const [name, error] of [
    ["AuthSessionMissingError（セッションが無い）", new AuthSessionMissingError()],
    ["AuthApiError 401", new AuthApiError("no auth", 401, "no_authorization")],
    ["AuthApiError 403 bad_jwt", new AuthApiError("bad jwt", 403, "bad_jwt")],
    ["AuthApiError 404", new AuthApiError("not found", 404, "user_not_found")],
  ] as const) {
    test(`${name} → null（はっきり断られた）`, () => {
      assert.equal(userFromGetUser({ data: { user: null }, error }), null);
    });
  }
  for (const [name, error] of [
    ["AuthRetryableFetchError 0（通信断）", new AuthRetryableFetchError("fetch failed", 0)],
    ["AuthRetryableFetchError 504", new AuthRetryableFetchError("timeout", 504)],
    ["AuthApiError 500", new AuthApiError("internal", 500, "unexpected_failure")],
    ["AuthApiError 429（混んでいる）", new AuthApiError("rate limited", 429, "over_request_rate_limit")],
    ["AuthUnknownError（応答が読めない）", new AuthUnknownError("bad json", new Error("x"))],
  ] as const) {
    test(`🔴 ${name} → AuthUnavailableError`, () => {
      assert.throws(() => userFromGetUser({ data: { user: null }, error }), AuthUnavailableError);
    });
  }
});

describe("🔴 退会: GoTrue が落ちている間は 503 を返し、何も消さない", () => {
  function setupDelete() {
    const db = fakeDb(() => ({ data: null, error: null }));
    let deleteUserCalls = 0;
    let storageCalls = 0;
    const admin = {
      ...db.client,
      storage: {
        from: () => {
          storageCalls += 1;
          return { list: async () => ({ data: [], error: null }), remove: async () => ({ error: null }) };
        },
      },
      auth: {
        admin: {
          deleteUser: async () => {
            deleteUserCalls += 1;
            return { error: null };
          },
        },
      },
    };
    const g = globalThis as Record<string, unknown>;
    g.__toritaviTestAdmin = admin;
    // ルートの `@/lib/supabase-server` はスタブなので、本物へつなぐ
    g.__toritaviTestAuth = (req: Request) => realAuthenticateRequest(req);
    return {
      db,
      deleted: () => ({ deleteUserCalls, storageCalls, dbCalls: db.calls.length }),
    };
  }

  test("🔴 GoTrue 503 → 503・消す処理に 1 つも入らない", async () => {
    stubGoTrue(GOTRUE.down503);
    const s = setupDelete();
    const res = await quiet(() => deletePost(makeRequest({ headers: BEARER }) as NextRequest));
    assert.equal(
      res.status,
      503,
      "🔴 認証基盤の障害を 401 で返した —— アプリは「もう消えている」と読んで端末を掃除する",
    );
    assert.deepEqual(s.deleted(), { deleteUserCalls: 0, storageCalls: 0, dbCalls: 0 });
  });

  test("🔴 通信が届かない → 503・何も消さない", async () => {
    stubGoTrue(GOTRUE.networkError);
    const s = setupDelete();
    const res = await quiet(() => deletePost(makeRequest({ headers: BEARER }) as NextRequest));
    assert.equal(res.status, 503);
    assert.deepEqual(s.deleted(), { deleteUserCalls: 0, storageCalls: 0, dbCalls: 0 });
  });

  test("はっきり断られたら従来どおり 401・何も消さない", async () => {
    stubGoTrue(GOTRUE.badJwt);
    const s = setupDelete();
    const res = await deletePost(makeRequest({ headers: BEARER }) as NextRequest);
    assert.equal(res.status, 401);
    assert.deepEqual(s.deleted(), { deleteUserCalls: 0, storageCalls: 0, dbCalls: 0 });
  });
});

// ---- すべての入口 ----

type Handler = (req: NextRequest) => Promise<{ status: number; json(): Promise<unknown> }>;
const APP_ORIGIN = { origin: "https://junros.coyoteandpowell.com" };

const ROUTES: { name: string; run: Handler; headers?: Record<string, string>; skip?: string | false }[] = [
  { name: "POST /api/account/delete", run: deletePost as Handler },
  { name: "POST /api/account/consent", run: consentPost as Handler },
  { name: "DELETE /api/account/consent", run: consentDelete as Handler },
  {
    name: "POST /api/account/email-change-notice",
    run: emailNoticePost as Handler,
    skip: EMAIL_CHANGE_NOTICE_ENABLED ? false : "EMAIL_CHANGE_NOTICE_ENABLED = false のあいだは認証より前で 404",
  },
  { name: "GET /api/ai-usage", run: aiUsageGet as Handler },
  {
    name: "POST /api/concierge",
    run: conciergePost as Handler,
    skip: CONCIERGE_ENABLED ? false : "CONCIERGE_ENABLED = false のあいだは 404",
  },
  {
    name: "GET /api/guest/attest",
    run: attestGet as Handler,
    skip: GUEST_MODE_ENABLED ? false : "GUEST_MODE_ENABLED = false のあいだは認証より前で 404",
  },
  {
    name: "POST /api/guest/attest",
    run: attestPost as Handler,
    skip: GUEST_MODE_ENABLED ? false : "GUEST_MODE_ENABLED = false のあいだは認証より前で 404",
  },
  { name: "POST /api/ocr", run: ocrPost as Handler },
  // 管理コンソール用（Origin が無い書き込みは拒否される）
  { name: "POST /api/push/test", run: pushTestPost as Handler, headers: APP_ORIGIN },
];

describe("🔴 authenticateRequest を呼ぶすべての API", () => {
  for (const r of ROUTES) {
    test(`${r.name}: 認証基盤が答えない → 503`, { skip: r.skip }, async () => {
      (globalThis as Record<string, unknown>).__toritaviTestAdmin = fakeDb(() => ({ data: null, error: null })).client;
      (globalThis as Record<string, unknown>).__toritaviTestAuth = () => {
        throw new AuthUnavailableError("GoTrue 503", 503);
      };
      const res = await quiet(() => r.run(makeRequest({ headers: r.headers, body: "{}" }) as NextRequest));
      assert.equal(res.status, 503, `🔴 ${r.name} が認証基盤の障害を ${res.status} で返した`);
      assert.deepEqual(await res.json(), { error: "auth_unavailable" });
    });

    test(`${r.name}: 未認証は従来どおり 401`, { skip: r.skip }, async () => {
      (globalThis as Record<string, unknown>).__toritaviTestAdmin = fakeDb(() => ({ data: null, error: null })).client;
      (globalThis as Record<string, unknown>).__toritaviTestAuth = () => null;
      const res = await r.run(makeRequest({ headers: r.headers, body: "{}" }) as NextRequest);
      assert.equal(res.status, 401);
    });
  }

  // 🔴 新しい入口を足したときに、503 への読み替えを忘れたら落ちる。
  //    上の表に載せ忘れても、ここで拾う。
  test("🔴 src/app の authenticateRequest の呼び出しは、すべて 503 に読み替えている", () => {
    const appDir = fileURLToPath(new URL("../../app", import.meta.url));
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n)) files.push(p);
      }
    };
    walk(appDir);
    const offenders: string[] = [];
    let wired = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const calls = src.match(/authenticateRequest\(/g)?.length ?? 0;
      const mapped = src.match(/authenticateRequest\(request\)\.catch\(authUnavailableTo503\)/g)?.length ?? 0;
      if (calls !== mapped) offenders.push(`${path.relative(appDir, f)} (${mapped}/${calls})`);
      wired += mapped;
    }
    assert.deepEqual(offenders, [], "🔴 認証基盤の障害を 503 に読み替えていない入口がある");
    // 表（ROUTES）と数が揃っていること —— 表から漏れた入口は、動かして確かめていない
    assert.equal(wired, ROUTES.length, "ROUTES の表と、実際の呼び出しの数が合わない");
  });
});
