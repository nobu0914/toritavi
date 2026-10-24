// ============================================================================
// 🔴 **EPC 単価の保存は、監査に残せなければ成功を返さない**（2026-10-19・夜間検査 5-11）。
//
// `POST /api/admin/analytics/rates` は単価を書いたあと `recordAuditLog` の
// 戻り値を**捨てていた。** 記録に失敗しても 200 `{ ok: true }` が返り、
// 管理画面は「保存しました」と出す —— **誰が単価を変えたか分からないまま
// 推定売上の数字が動く。**
//
// 直し方は「先に記録し、記録できなければ書かずに 503」
// （利用者ファイルの閲覧 `files/route.ts` の GET と同じ形）。
// 書いてから記録すると、記録に落ちた瞬間に「変わったが痕跡が無い」が成立する。
// ============================================================================
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { POST as ratesPost } from "../../app/api/admin/analytics/rates/route.ts";
import { makeRequest } from "./support/route-harness.ts";
import { fakeDb, hasOp, resetInjections, type DbCall } from "./support/fake-db.ts";

const ADMIN = "99999999-9999-4999-8999-999999999999";
const ORIGIN = "https://junros.coyoteandpowell.com";

type Opts = { auditError?: unknown; upsertError?: unknown; cookies?: Record<string, string> };

function setup(opts: Opts = {}) {
  // 管理者の判定（セッションの client）。
  const session = fakeDb((call: DbCall) =>
    call.kind === "query" && call.table === "toritavi_admin_members"
      ? { data: { role: "super_admin" }, error: null }
      : { data: null, error: null },
  );
  // 書き込み（service-role）。
  const svc = fakeDb((call: DbCall) => {
    if (call.kind === "query" && call.table === "toritavi_admin_audit_logs") {
      return { data: null, error: opts.auditError ?? null };
    }
    if (call.kind === "query" && call.table === "toritavi_affiliate_rates") {
      return { data: null, error: opts.upsertError ?? null };
    }
    return { data: null, error: null };
  });
  const g = globalThis as Record<string, unknown>;
  g.__toritaviTestSessionClient = {
    ...session.client,
    auth: {
      getUser: async () => ({ data: { user: { id: ADMIN, email: null } }, error: null }),
    },
  };
  g.__toritaviTestAdmin = svc.client;
  g.__toritaviTestHeaders = { "user-agent": "test" };
  g.__toritaviTestCookies = opts.cookies ?? {};
  return svc;
}

function post() {
  return ratesPost(
    makeRequest({
      headers: { origin: ORIGIN },
      body: JSON.stringify({ program: "rakuten_travel", epcYen: 12 }),
    }) as Request,
  );
}

const upserts = (calls: DbCall[]) =>
  calls.filter((c) => c.kind === "query" && c.table === "toritavi_affiliate_rates" && hasOp(c, "upsert"));
const audits = (calls: DbCall[]) =>
  calls.filter((c) => c.kind === "query" && c.table === "toritavi_admin_audit_logs" && hasOp(c, "insert"));

beforeEach(() => resetInjections());

test("🔴 監査に残せなければ 2xx を返さない", async () => {
  setup({ auditError: { message: "insert failed" } });
  const res = await post();
  assert.ok(res.status >= 400, `🔴 監査の記録に失敗したのに ${res.status} を返した`);
});

test("🔴 監査に残せなければ、単価を書かない（変わったが痕跡が無い、を作らない）", async () => {
  const svc = setup({ auditError: { message: "insert failed" } });
  await post();
  assert.equal(upserts(svc.calls).length, 0, "🔴 記録できないまま単価を書き換えた");
});

test("対照: 監査に残せれば単価を書いて 200", async () => {
  const svc = setup();
  const res = await post();
  assert.equal(res.status, 200);
  assert.equal(upserts(svc.calls).length, 1);
  assert.equal(audits(svc.calls).length, 1);
});

test("🔴 記録のあとに書き込みが落ちたら 500、失敗も監査に残す（記録だけが嘘をつかない）", async () => {
  const svc = setup({ upsertError: { message: "write failed" } });
  const res = await post();
  assert.equal(res.status, 500);
  const actions = audits(svc.calls).map(
    (c) => ((c.kind === "query" ? c.ops.find((o) => o.op === "insert")?.args[0] : null) as { action?: string })?.action,
  );
  assert.deepEqual(actions, ["admin.affiliate.rate_changed", "admin.affiliate.rate_change_failed"]);
});

// 🔴 Codex 夜間検査 5-4（2026-10-24）: 管理 API はプロキシの回復セッションの
//    関門（/api を除外）を通らず、パスワード再設定のリンクで得たセッションの
//    まま書き込めた。
test("🔴 回復セッション（toritavi_recovery）では管理 API に入れない", async () => {
  const svc = setup({ cookies: { toritavi_recovery: "1" } });
  const res = await post();
  assert.equal(res.status, 401);
  assert.equal(upserts(svc.calls).length, 0, "🔴 回復セッションのまま書き込んだ");
});

test("対照: 印が無ければ通る", async () => {
  const svc = setup({ cookies: {} });
  const res = await post();
  assert.ok(res.status < 300, `status=${res.status}`);
  assert.equal(upserts(svc.calls).length, 1);
});
