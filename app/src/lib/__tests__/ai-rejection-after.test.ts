// ============================================================================
// 🔴 **上限の応答（429 / 503）を、拒否の記録の書き込みで待たせない**
//    （2026-10-19・夜間検査 7-41）。
//
// `toritavi_ai_rejections` は `/admin/abuse` と `/admin/concierge` が**読むだけ**の
// 記録で、上限を効かせる判定には使っていない（上限そのものは DB の予約関数が持つ）。
// それなのに `logAiRejection` は await され、**上限に当たった利用者は
// 記録の往復ぶん余計に待っていた。** 記録が詰まれば応答も詰まる。
//
// ここでは記録の insert を**永遠に返らない**ようにして、
//   1. `logAiRejection` がそれを待たずに返ること
//   2. コンシェルジュの上限（429）がそれを待たずに返ること
//   3. それでも記録は `after()` に積まれ、実際に insert が呼ばれること
// を確かめる。2 だけだと「記録をやめた」でも緑になるので 3 で対にする。
// ============================================================================
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { logAiRejection } from "../moderation.ts";
import { beginConcierge } from "../concierge-quota.ts";
import { fakeDb, hasOp, resetInjections } from "./support/fake-db.ts";

const UID = "44444444-4444-4444-8444-444444444444";

/** 拒否の insert だけが永遠に返らない admin。 */
function hangingRejectionsAdmin(rpcStatus = "quota_exceeded") {
  return fakeDb((call) => {
    if (call.kind === "rpc" && call.fn === "toritavi_concierge_begin") {
      return { data: [{ status: rpcStatus, used_after: 100 }], error: null };
    }
    if (call.kind === "query" && call.table === "toritavi_ai_rejections") {
      return new Promise(() => {}); // 🔴 返らない
    }
    return { data: null, error: null };
  });
}

/** `p` が `ms` 以内に終わったか。 */
async function within<T>(p: Promise<T>, ms: number): Promise<"done" | "hung"> {
  return Promise.race([
    p.then(() => "done" as const),
    new Promise<"hung">((r) => setTimeout(() => r("hung"), ms)),
  ]);
}

function afterTasks(): Promise<unknown>[] {
  return ((globalThis as Record<string, unknown>).__toritaviAfterTasks ?? []) as Promise<unknown>[];
}

beforeEach(() => resetInjections());

test("🔴 logAiRejection は記録の書き込みを待たずに返る", async () => {
  const db = hangingRejectionsAdmin();
  (globalThis as Record<string, unknown>).__toritaviTestAdmin = db.client;

  const r = await within(Promise.resolve(logAiRejection(UID, "ocr", "rate_limit")), 300);
  assert.equal(r, "done", "🔴 記録の insert が終わるまで呼び出し側を待たせている");
});

test("🔴 それでも記録は after() に積まれ、insert が実際に呼ばれる（記録をやめていない）", async () => {
  const db = hangingRejectionsAdmin();
  (globalThis as Record<string, unknown>).__toritaviTestAdmin = db.client;

  logAiRejection(UID, "concierge", "quota_exceeded");
  assert.equal(afterTasks().length, 1, "🔴 after() に積まれていない");

  // 積まれた仕事が走りきる（insert まで届く）のを待つ。insert 自体は返らない。
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const inserts = db.calls.filter(
    (c) => c.kind === "query" && c.table === "toritavi_ai_rejections" && hasOp(c, "insert"),
  );
  assert.equal(inserts.length, 1, "🔴 記録の insert が呼ばれていない");
});

test("🔴 コンシェルジュの上限（429）は、記録の書き込みを待たずに返る", async () => {
  const db = hangingRejectionsAdmin("quota_exceeded");
  (globalThis as Record<string, unknown>).__toritaviTestAdmin = db.client;

  const p = beginConcierge({ userId: UID, audience: "free", estTokens: 100, lang: "ja" });
  assert.equal(await within(p, 300), "done", "🔴 429 が記録の往復を待っている");
  const res = await p;
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.response.status, 429);
});

test("対照: 予約が通れば記録しない（after に何も積まない）", async () => {
  const db = hangingRejectionsAdmin("ok");
  (globalThis as Record<string, unknown>).__toritaviTestAdmin = db.client;

  const res = await beginConcierge({ userId: UID, audience: "free", estTokens: 100, lang: "ja" });
  assert.equal(res.ok, true);
  assert.equal(afterTasks().length, 0);
});
