// ============================================================================
// 🔴 **/api/inbound-mail の route.ts 本体を実行して見張る。**
//
// 純粋関数（inbound-mail.test.ts）だけでは、route の配線 —— 停止中の 503・
// 未知のトークンを 200 で捨てる・上限・アップロード後に行が入らなければ
// 消す・ログに中身を出さない —— は一度も動かない（webhook-route.test.ts と
// 同じ理由）。差し替えるのは `next/server` と `createServiceClient` だけ。
// ============================================================================
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { NextRequest } from "next/server";

import { POST } from "../../app/api/inbound-mail/route.ts";
import { MAX_OPEN_PER_USER, MAX_PER_USER_PER_DAY, signInbound } from "../inbound-mail.ts";
import { fakePdf, multipartMail } from "./support/mime-fixtures.ts";
import { makeRequest } from "./support/route-harness.ts";

const SECRET = "route-test-secret";
const TOKEN = "abcdefghijkmnpqr";
const TO = `trips-${TOKEN}@junros.com`;
const UID = "11111111-1111-4111-8111-111111111111";
const SUBJECT = "【予約確認】山田太郎様 予約番号 ZX9Q7K";
const FROM = "yamada.taro@example.com";

type Row = Record<string, unknown>;

type FakeOpts = {
  aliases?: Record<string, string>;
  status?: string | null;
  statusError?: boolean;
  rows?: Row[];
  insertError?: { code: string; message: string } | null;
  uploadErrorAt?: number;
};

/** 表とバケットのインメモリ実装。route が組み立てる WHERE を実際に評価する。 */
function fakeAdmin(o: FakeOpts = {}) {
  const rows: Row[] = o.rows ?? [];
  const objects = new Map<string, Uint8Array>();
  const removed: string[] = [];
  let uploads = 0;

  function query(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let head = false;
    let mode: "select" | "insert" = "select";
    let inserted: Row | null = null;
    const b = {
      select(_cols: string, opts?: { count?: string; head?: boolean }) {
        head = opts?.head === true;
        return b;
      },
      eq(col: string, v: unknown) {
        filters.push((r) => r[col] === v);
        return b;
      },
      gte(col: string, v: string) {
        filters.push((r) => String(r[col]) >= v);
        return b;
      },
      in(col: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[col]));
        return b;
      },
      insert(v: Row) {
        mode = "insert";
        inserted = v;
        return b;
      },
      async maybeSingle() {
        if (table === "toritavi_mail_aliases") {
          const tok = Object.entries(o.aliases ?? {});
          const hit = tok.find(([t]) => filters.every((f) => f({ token: t })));
          return { data: hit ? { user_id: hit[1] } : null, error: null };
        }
        if (table === "toritavi_user_status") {
          if (o.statusError) return { data: null, error: { message: "boom" } };
          return { data: o.status ? { status: o.status, reason: null } : null, error: null };
        }
        throw new Error(`想定外の maybeSingle: ${table}`);
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        const run = async () => {
          if (mode === "insert") {
            assert.equal(table, "toritavi_inbox_items", "想定外の表に書いた");
            if (o.insertError) return { data: null, error: o.insertError };
            // 本物の一意索引 (user_id, message_key) と同じ振る舞い。
            const v = inserted!;
            if (
              v.message_key != null &&
              rows.some((r) => r.user_id === v.user_id && r.message_key === v.message_key)
            ) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
            rows.push({ ...inserted!, received_at: new Date().toISOString() });
            return { data: null, error: null };
          }
          assert.equal(table, "toritavi_inbox_items");
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          return head ? { count: hit.length, data: null, error: null } : { data: hit, error: null };
        };
        return run().then(res, rej);
      },
    };
    return b;
  }

  const admin = {
    from: (t: string) => query(t),
    storage: {
      from(bucket: string) {
        assert.equal(bucket, "toritavi-inbox", "想定外のバケット");
        return {
          async upload(path: string, bytes: Uint8Array) {
            uploads += 1;
            if (o.uploadErrorAt === uploads) return { data: null, error: { name: "StorageError" } };
            objects.set(path, bytes);
            return { data: { path }, error: null };
          },
          async remove(paths: string[]) {
            for (const p of paths) {
              objects.delete(p);
              removed.push(p);
            }
            return { data: [], error: null };
          },
        };
      },
    },
  };
  return { admin, rows, objects, removed };
}

function signedRequest(raw: Uint8Array, over: { to?: string; secret?: string } = {}) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const to = over.to ?? TO;
  const from = "bounce@example.com";
  return makeRequest({
    headers: {
      "content-length": String(raw.byteLength),
      "x-junros-timestamp": ts,
      "x-junros-to": to,
      "x-junros-from": from,
      "x-junros-signature": signInbound(over.secret ?? SECRET, ts, to, from, raw.byteLength),
    },
    bodyBytes: raw,
  }) as NextRequest;
}

function mail() {
  return multipartMail({
    from: `山田 <${FROM}>`,
    subject: SUBJECT,
    text: "予約番号 ZX9Q7K 山田太郎様",
    parts: [
      { contentType: "application/pdf", disposition: 'attachment; filename="山田太郎_eticket.pdf"', bytes: fakePdf(4000) },
    ],
  });
}

const g = globalThis as { __toritaviTestAdmin?: unknown };
let logs: string[] = [];
const orig = { log: console.log, warn: console.warn, error: console.error };

beforeEach(() => {
  process.env.MAIL_IMPORT_ENABLED = "true";
  process.env.INBOUND_MAIL_SECRET = SECRET;
  delete process.env.MAIL_IMPORT_DOMAIN;
  logs = [];
  const cap = (...a: unknown[]) => {
    logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  };
  console.log = cap;
  console.warn = cap;
  console.error = cap;
});

afterEach(() => {
  Object.assign(console, orig);
  delete g.__toritaviTestAdmin;
});

/** 🔴 ログに中身（件名・送信元・トークン・user_id・ファイル名・本文）が出ていない。 */
function assertLogsClean() {
  const all = logs.join("\n");
  for (const secret of [SUBJECT, "山田", FROM, TOKEN, UID, "ZX9Q7K", "eticket", SECRET]) {
    assert.ok(!all.includes(secret), `ログに中身が出ている: ${secret}\n${all}`);
  }
}

describe("/api/inbound-mail", () => {
  test("🔴 MAIL_IMPORT_ENABLED が true でなければ 503（捨てずに再送させる）", async () => {
    for (const v of [undefined, "", "false", "1", "TRUE"]) {
      if (v === undefined) delete process.env.MAIL_IMPORT_ENABLED;
      else process.env.MAIL_IMPORT_ENABLED = v;
      const r = (await POST(signedRequest(mail()))) as unknown as { status: number };
      assert.equal(r.status, 503, `値 ${String(v)}`);
    }
  });

  test("🔴 INBOUND_MAIL_SECRET が無ければ 503（誰でも書ける、にしない）", async () => {
    delete process.env.INBOUND_MAIL_SECRET;
    const r = (await POST(signedRequest(mail()))) as unknown as { status: number };
    assert.equal(r.status, 503);
  });

  test("署名が合わなければ 401 で、何も書かない", async () => {
    const f = fakeAdmin({ aliases: { [TOKEN]: UID } });
    g.__toritaviTestAdmin = f.admin;
    const r = (await POST(signedRequest(mail(), { secret: "wrong" }))) as unknown as { status: number };
    assert.equal(r.status, 401);
    assert.equal(f.rows.length, 0);
    assert.equal(f.objects.size, 0);
  });

  test("大きすぎる本文は 413", async () => {
    const raw = new Uint8Array(4 * 1024 * 1024 + 1);
    const r = (await POST(signedRequest(raw))) as unknown as { status: number };
    assert.equal(r.status, 413);
  });

  test("🔴 未知のトークンは 200 で黙って捨てる（存在を外から探れない）", async () => {
    const f = fakeAdmin({ aliases: {} });
    g.__toritaviTestAdmin = f.admin;
    const r = (await POST(signedRequest(mail()))) as unknown as { status: number; json(): Promise<unknown> };
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { accepted: false });
    assert.equal(f.rows.length, 0);
    assertLogsClean();
  });

  test("宛先の形が違えば（署名が正しくても）200 で捨てる", async () => {
    const f = fakeAdmin({ aliases: { [TOKEN]: UID } });
    g.__toritaviTestAdmin = f.admin;
    const r = (await POST(signedRequest(mail(), { to: `trips-${TOKEN}@other.example` }))) as unknown as {
      status: number;
      json(): Promise<unknown>;
    };
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { accepted: false });
    assert.equal(f.rows.length, 0);
  });

  test("🔴 受け取る: 添付を {user}/{item}/{n}.{ext} に置き、行を入れる", async () => {
    const f = fakeAdmin({ aliases: { [TOKEN]: UID } });
    g.__toritaviTestAdmin = f.admin;
    const r = (await POST(signedRequest(mail()))) as unknown as { status: number; json(): Promise<unknown> };
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { accepted: true });
    assert.equal(f.rows.length, 1);
    const row = f.rows[0] as {
      id: string;
      user_id: string;
      subject: string;
      from_address: string;
      body_text: string;
      status: string;
      attachments: Array<{ path: string; name: string; mime: string; bytes: number }>;
    };
    assert.equal(row.user_id, UID);
    assert.equal(row.subject, SUBJECT);
    assert.equal(row.from_address, FROM);
    assert.equal(row.status, "pending");
    assert.ok(row.body_text.includes("ZX9Q7K"));
    assert.match(row.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(row.attachments, [
      { path: `${UID}/${row.id}/1.pdf`, name: "山田太郎_eticket.pdf", mime: "application/pdf", bytes: 4000 },
    ]);
    assert.ok(f.objects.has(`${UID}/${row.id}/1.pdf`));
    assertLogsClean();
  });

  test("🔴 1 日の上限に達したら 200 で捨てる", async () => {
    const now = new Date().toISOString();
    const rows = Array.from({ length: MAX_PER_USER_PER_DAY }, () => ({
      user_id: UID,
      status: "dismissed",
      received_at: now,
    }));
    const f = fakeAdmin({ aliases: { [TOKEN]: UID }, rows });
    g.__toritaviTestAdmin = f.admin;
    const r = (await POST(signedRequest(mail()))) as unknown as { status: number };
    assert.equal(r.status, 200);
    assert.equal(f.rows.length, MAX_PER_USER_PER_DAY, "上限を超えて入った");
    assert.equal(f.objects.size, 0);
  });

  test("1 日前より古い行は 1 日の上限に数えない", async () => {
    const old = new Date(Date.now() - 25 * 3600_000).toISOString();
    const rows = Array.from({ length: MAX_PER_USER_PER_DAY }, () => ({
      user_id: UID,
      status: "dismissed",
      received_at: old,
    }));
    const f = fakeAdmin({ aliases: { [TOKEN]: UID }, rows });
    g.__toritaviTestAdmin = f.admin;
    await POST(signedRequest(mail()));
    assert.equal(f.rows.length, MAX_PER_USER_PER_DAY + 1);
  });

  test("🔴 未処理が 50 件に達したら 200 で捨てる", async () => {
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const rows = Array.from({ length: MAX_OPEN_PER_USER }, (_, i) => ({
      user_id: UID,
      status: i % 2 ? "pending" : "forward_confirm",
      received_at: old,
    }));
    const f = fakeAdmin({ aliases: { [TOKEN]: UID }, rows });
    g.__toritaviTestAdmin = f.admin;
    await POST(signedRequest(mail()));
    assert.equal(f.rows.length, MAX_OPEN_PER_USER);
  });

  test("凍結中の利用者は 200 で捨てる／状態を読めなければ 503（再送させる）", async () => {
    const f = fakeAdmin({ aliases: { [TOKEN]: UID }, status: "suspended" });
    g.__toritaviTestAdmin = f.admin;
    const r = (await POST(signedRequest(mail()))) as unknown as { status: number };
    assert.equal(r.status, 200);
    assert.equal(f.rows.length, 0);

    const f2 = fakeAdmin({ aliases: { [TOKEN]: UID }, statusError: true });
    g.__toritaviTestAdmin = f2.admin;
    const r2 = (await POST(signedRequest(mail()))) as unknown as { status: number };
    assert.equal(r2.status, 503);
    assert.equal(f2.rows.length, 0);
  });

  test("🔴 行が入らなければ、置いた添付を消して 503（再送させる）", async () => {
    const f = fakeAdmin({
      aliases: { [TOKEN]: UID },
      insertError: { code: "57014", message: "timeout" },
    });
    g.__toritaviTestAdmin = f.admin;
    const r = (await POST(signedRequest(mail()))) as unknown as { status: number };
    assert.equal(r.status, 503);
    assert.equal(f.objects.size, 0, "孤児が残っている");
    assert.equal(f.removed.length, 1);
    assertLogsClean();
  });

  test("制約違反（23xxx）は再送しても直らないので、消して 200", async () => {
    const f = fakeAdmin({
      aliases: { [TOKEN]: UID },
      insertError: { code: "23514", message: "check violation" },
    });
    g.__toritaviTestAdmin = f.admin;
    const r = (await POST(signedRequest(mail()))) as unknown as { status: number };
    assert.equal(r.status, 200);
    assert.equal(f.objects.size, 0);
  });

  test("アップロードが途中で失敗したら、置いた分を消して 503", async () => {
    const raw = multipartMail({
      from: FROM,
      subject: "x",
      text: "y",
      parts: [1, 2, 3].map((i) => ({
        contentType: "application/pdf",
        disposition: `attachment; filename="p${i}.pdf"`,
        bytes: fakePdf(3000),
      })),
    });
    const f = fakeAdmin({ aliases: { [TOKEN]: UID }, uploadErrorAt: 3 });
    g.__toritaviTestAdmin = f.admin;
    const r = (await POST(signedRequest(raw))) as unknown as { status: number };
    assert.equal(r.status, 503);
    assert.equal(f.objects.size, 0);
    assert.equal(f.removed.length, 2);
    assert.equal(f.rows.length, 0);
  });

  test("🔴 同じメールの再送は 1 行だけ（2 回目は何も置かず 200）", async () => {
    const f = fakeAdmin({ aliases: { [TOKEN]: UID } });
    g.__toritaviTestAdmin = f.admin;
    const raw = mail();
    const r1 = (await POST(signedRequest(raw))) as unknown as { status: number; json(): Promise<unknown> };
    const r2 = (await POST(signedRequest(raw))) as unknown as { status: number; json(): Promise<unknown> };
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.deepEqual(await r2.json(), { accepted: true }, "受け取り済みとして 200");
    assert.equal(f.rows.length, 1, "🔴 再送で 2 行になった");
    assert.equal(f.objects.size, 1, "2 回目が添付を置いている");
    assert.equal(f.removed.length, 0, "先に見ずに、置いてから消している（往復が無駄）");
    assert.match(String(f.rows[0].message_key), /^[0-9a-f]{64}$/);
    assertLogsClean();
  });

  test("🔴 Message-ID が同じなら、経路で中身が変わっても 1 行", async () => {
    const f = fakeAdmin({ aliases: { [TOKEN]: UID } });
    g.__toritaviTestAdmin = f.admin;
    const a = multipartMail({ from: FROM, subject: "x", text: "1", messageId: "same@example.com" });
    const b = multipartMail({ from: FROM, subject: "x", text: "1 ", messageId: "same@example.com" });
    await POST(signedRequest(a));
    await POST(signedRequest(b));
    assert.equal(f.rows.length, 1);
  });

  test("🔴 並行して先に入っていた（insert が 23505）なら、置いた添付を消して 200", async () => {
    const f = fakeAdmin({
      aliases: { [TOKEN]: UID },
      insertError: { code: "23505", message: "duplicate key" },
    });
    g.__toritaviTestAdmin = f.admin;
    const r = (await POST(signedRequest(mail()))) as unknown as { status: number; json(): Promise<unknown> };
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { accepted: true });
    assert.equal(f.objects.size, 0, "孤児が残っている");
    assert.equal(f.removed.length, 1);
  });

  test("壊れた MIME でも落ちない（200）", async () => {
    const f = fakeAdmin({ aliases: { [TOKEN]: UID } });
    g.__toritaviTestAdmin = f.admin;
    const raw = new TextEncoder().encode("garbage without headers");
    const r = (await POST(signedRequest(raw))) as unknown as { status: number };
    assert.equal(r.status, 200);
  });
});
