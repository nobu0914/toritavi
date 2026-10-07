// ============================================================================
// 🔴 **メール転送の受信箱を 30 日で消す cron。** 順序と「失敗したら残す」を固定する。
//
// 1. **Storage → 行の順。** 逆にすると添付がどこにあるか引けなくなる
// 2. **Storage で失敗した行は消さない**（次回に回す）
// 3. **秘密が無ければ動かさない**（消す処理）
// 4. **vercel.json に登録されている**（作ったのに一度も走らない、を塞ぐ）
// 5. 表がまだ無い（SQL 未適用）間は 200 ＋警告。毎日 500 で本物の失敗を埋めない
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import type { NextRequest } from "next/server";

import { GET } from "../../app/api/cron/purge-inbox/route.ts";
import { makeRequest } from "./support/route-harness.ts";

const g = globalThis as { __toritaviTestAdmin?: unknown };
const orig = { log: console.log, warn: console.warn, error: console.error };

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
});
afterEach(() => {
  Object.assign(console, orig);
  delete g.__toritaviTestAdmin;
});

const req = (auth = "Bearer cron-secret") =>
  makeRequest({ headers: { authorization: auth } }) as NextRequest;

type Row = { id: string; user_id: string; expires_at: string };

function fakeAdmin(opts: {
  rows: Row[];
  files: Record<string, string[]>;
  removeFailFor?: string;
  selectError?: { code: string; message: string };
}) {
  const calls: string[] = [];
  const deleted: string[] = [];
  const admin = {
    from(table: string) {
      assert.equal(table, "toritavi_inbox_items");
      let cutoff = "";
      let ids: string[] = [];
      let isDelete = false;
      const b = {
        select: () => b,
        lt: (_c: string, v: string) => ((cutoff = v), b),
        order: () => b,
        limit: () => b,
        delete: () => ((isDelete = true), b),
        in: (_c: string, v: string[]) => ((ids = v), b),
        then(res: (v: unknown) => unknown) {
          if (isDelete) {
            calls.push("rows.delete");
            deleted.push(...ids);
            return Promise.resolve({ error: null, count: ids.length }).then(res);
          }
          if (opts.selectError) return Promise.resolve({ data: null, error: opts.selectError }).then(res);
          const hit = opts.rows.filter((r) => r.expires_at < cutoff);
          return Promise.resolve({ data: hit, error: null }).then(res);
        },
      };
      return b;
    },
    storage: {
      from(bucket: string) {
        assert.equal(bucket, "toritavi-inbox");
        return {
          async list(folder: string) {
            calls.push(`list ${folder}`);
            return { data: (opts.files[folder] ?? []).map((name) => ({ name })), error: null };
          },
          async remove(paths: string[]) {
            calls.push(`remove ${paths.join(",")}`);
            if (opts.removeFailFor && paths.some((p) => p.startsWith(opts.removeFailFor!))) {
              return { data: null, error: { name: "StorageError" } };
            }
            return { data: [], error: null };
          },
        };
      },
    },
  };
  return { admin, calls, deleted };
}

const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

test("🔴 期限切れだけを、Storage → 行の順で消す", async () => {
  const f = fakeAdmin({
    rows: [
      { id: "i1", user_id: "u1", expires_at: PAST },
      { id: "i2", user_id: "u1", expires_at: FUTURE },
    ],
    files: { "u1/i1": ["1.pdf", "2.jpg"] },
  });
  g.__toritaviTestAdmin = f.admin;
  const r = (await GET(req())) as unknown as { status: number };
  assert.equal(r.status, 200);
  assert.deepEqual(f.deleted, ["i1"]);
  assert.deepEqual(f.calls, ["list u1/i1", "remove u1/i1/1.pdf,u1/i1/2.jpg", "rows.delete"]);
});

test("🔴 Storage で失敗した行は消さない（次回に回す）", async () => {
  const f = fakeAdmin({
    rows: [
      { id: "i1", user_id: "u1", expires_at: PAST },
      { id: "i3", user_id: "u2", expires_at: PAST },
    ],
    files: { "u1/i1": ["1.pdf"], "u2/i3": ["1.pdf"] },
    removeFailFor: "u1/",
  });
  g.__toritaviTestAdmin = f.admin;
  await GET(req());
  assert.deepEqual(f.deleted, ["i3"]);
});

test("添付の無い行（本文だけ・転送確認）も消す", async () => {
  const f = fakeAdmin({ rows: [{ id: "i9", user_id: "u1", expires_at: PAST }], files: {} });
  g.__toritaviTestAdmin = f.admin;
  await GET(req());
  assert.deepEqual(f.deleted, ["i9"]);
});

test("🔴 CRON_SECRET が無ければ動かさない・違えば 401", async () => {
  delete process.env.CRON_SECRET;
  assert.equal(((await GET(req())) as unknown as { status: number }).status, 503);
  process.env.CRON_SECRET = "cron-secret";
  assert.equal(((await GET(req("Bearer nope"))) as unknown as { status: number }).status, 401);
});

test("表が無い間（SQL 未適用）は 200、それ以外の失敗は 500", async () => {
  g.__toritaviTestAdmin = fakeAdmin({
    rows: [],
    files: {},
    selectError: { code: "PGRST205", message: "not found" },
  }).admin;
  const r = (await GET(req())) as unknown as { status: number; json(): Promise<unknown> };
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, installed: false });

  g.__toritaviTestAdmin = fakeAdmin({
    rows: [],
    files: {},
    selectError: { code: "57014", message: "timeout" },
  }).admin;
  assert.equal(((await GET(req())) as unknown as { status: number }).status, 500);
});

test("🔴 cron が登録されている（既存の 2 本も消していない）", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  const paths = vercel.crons.map((c) => c.path);
  assert.ok(paths.includes("/api/cron/purge-inbox"), "🔴 登録されていない。一度も走らない");
  assert.ok(paths.includes("/api/cron/keepalive"));
  assert.ok(paths.includes("/api/cron/purge-anonymous"));
  // Hobby は 1 日 1 回まで。それより細かいとデプロイが落ちる。
  const s = vercel.crons.find((c) => c.path === "/api/cron/purge-inbox")!.schedule;
  assert.match(s, /^\d{1,2} \d{1,2} \* \* \*$/, `1 日 1 回の形でない: ${s}`);
});
