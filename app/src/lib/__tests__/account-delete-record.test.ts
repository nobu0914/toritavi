// ============================================================================
// 🔴 **退会で `deleteUser` が落ちたら、それも記録する**（2026-10-19・夜間検査 5-14）。
//
// `/api/account/delete` は「必ず出られる。ただし黙って残さない」で動く ——
// 後始末（台帳の表・Storage）が落ちたら `toritavi_deletion_failures` に
// 記録してから `auth.users` を消す。
//
// ところが**最後の `deleteUser` が落ちた場合だけ、何も記録していなかった。**
// その時点で写真もファイルも表の行も**もう消えている**のに、アカウントは残り、
// 応答は 500。運用が見る `/admin` の「消し残し」にも何も出ない ——
// **半分だけ消えた利用者が、誰にも見えないまま残る。**
//
// 🔴 **利用者への応答は変えない**（文面も状態も同じ 500）。記録を足すだけ。
// ============================================================================
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { NextRequest } from "next/server";
import { POST as deletePost } from "../../app/api/account/delete/route.ts";
import { DELETION_FAILURE_TABLE } from "../user-data-ledger.ts";
import { makeRequest } from "./support/route-harness.ts";
import { fakeDb, hasOp, resetInjections, type DbCall } from "./support/fake-db.ts";

const UID = "12121212-1212-4121-8121-121212121212";

type Opts = {
  deleteUserError?: { message: string } | null;
  recordError?: unknown;
  tableError?: unknown;
};

function setup(opts: Opts = {}) {
  const db = fakeDb((call: DbCall) => {
    if (call.kind === "query" && call.table === DELETION_FAILURE_TABLE) {
      return { data: null, error: opts.recordError ?? null };
    }
    if (call.kind === "query" && hasOp(call, "delete")) {
      return { data: null, error: opts.tableError ?? null };
    }
    return { data: null, error: null };
  });
  const bucket = {
    list: async () => ({ data: [], error: null }),
    remove: async () => ({ error: null }),
  };
  const admin = {
    ...db.client,
    storage: { from: () => bucket },
    auth: {
      admin: {
        deleteUser: async () => ({ error: opts.deleteUserError ?? null }),
      },
    },
  };
  const g = globalThis as Record<string, unknown>;
  g.__toritaviTestAdmin = admin;
  g.__toritaviTestAuth = () => ({
    sb: { auth: { signOut: async () => ({ error: null }) } },
    userId: UID,
    isAnonymous: false,
    userMetadata: {},
  });
  return db;
}

function recorded(calls: DbCall[]): Array<{ user_id: string; resource: string; error: string }> {
  return calls
    .filter((c) => c.kind === "query" && c.table === DELETION_FAILURE_TABLE && hasOp(c, "insert"))
    .flatMap((c) => {
      const arg = c.kind === "query" ? c.ops.find((o) => o.op === "insert")?.args[0] : undefined;
      return (Array.isArray(arg) ? arg : [arg]) as Array<{ user_id: string; resource: string; error: string }>;
    });
}

async function body(res: { json(): Promise<unknown> }) {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => resetInjections());

test("🔴 後始末のあとで deleteUser が落ちたら、消し残しとして記録する", async () => {
  const db = setup({ deleteUserError: { message: "Database error deleting user" } });
  const res = await deletePost(makeRequest() as NextRequest);

  const rows = recorded(db.calls);
  assert.equal(rows.length, 1, "🔴 半分だけ消えた退会が、どこにも記録されていない");
  assert.equal(rows[0].user_id, UID);
  assert.equal(rows[0].resource, "auth:users");
  assert.equal(rows[0].error, "Database error deleting user");

  // 🔴 **利用者への応答は変えない。**
  assert.equal(res.status, 500);
  assert.deepEqual(await body(res), { error: "Database error deleting user" });
});

test("🔴 その記録にも失敗したら、応答は同じ 500 のまま（文面を変えない）", async () => {
  setup({
    deleteUserError: { message: "Database error deleting user" },
    recordError: { message: "insert failed" },
  });
  const res = await deletePost(makeRequest() as NextRequest);
  assert.equal(res.status, 500);
  assert.deepEqual(await body(res), { error: "Database error deleting user" });
});

test("後始末の失敗と deleteUser の失敗が重なっても、両方残る", async () => {
  const db = setup({
    tableError: { message: "permission denied" },
    deleteUserError: { message: "Database error deleting user" },
  });
  const res = await deletePost(makeRequest() as NextRequest);
  assert.equal(res.status, 500);
  const resources = recorded(db.calls).map((r) => r.resource);
  assert.ok(resources.some((r) => r.startsWith("table:")), "後始末の失敗が残っていない");
  assert.ok(resources.includes("auth:users"), "🔴 deleteUser の失敗が残っていない");
});

test("対照: deleteUser が通れば何も記録せず ok", async () => {
  const db = setup();
  const res = await deletePost(makeRequest() as NextRequest);
  assert.equal(res.status, 200);
  assert.deepEqual(await body(res), { ok: true, pendingCleanup: 0 });
  assert.equal(recorded(db.calls).length, 0);
});
