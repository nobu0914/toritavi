// ============================================================================
// 🔴 **webhook の route.ts 本体を実行して見張る。**
//
// `webhook-event-order.test.ts` は純粋関数（時刻の作り方・失効対象の選び方）
// しか見ていない。**route 側の配線 —— TRANSFER 専用ブロック・
// 「app_user_id は TRANSFER 以外でのみ必須」・同時刻タイブレーク
// （失効は `.lte` / 付与は `.lt`）—— は一度も動かされておらず、
// そこを潰してもテストは緑だった**（2026-08-30 の指摘 #12）。
//
// ここでは本物の POST を、署名付きの偽リクエストと、WHERE 句を実際に
// 評価するインメモリの `toritavi_user_plan` で駆動する（`CLAUDE.md` §6-1 の 4
// 「テストが本番と同じ構造を組み立てているか」）。差し替えているのは
// `next/server` と `createServiceClient` だけ（support/loader.mjs）。
//
// updated_at は route と同じ ISO 8601 UTC 固定桁なので、文字列比較が
// Postgres の timestamptz 比較と同じ順序になる。
// ============================================================================
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import type { NextRequest } from "next/server";
import { POST } from "../../app/api/webhooks/revenuecat/route.ts";
import { makeRequest } from "./support/route-harness.ts";

const AUTH_SECRET = "test-auth-secret";
const HMAC_SECRET = "test-hmac-secret";
process.env.REVENUECAT_WEBHOOK_SECRET = AUTH_SECRET;
process.env.REVENUECAT_WEBHOOK_HMAC_SECRET = HMAC_SECRET;

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const T = Date.UTC(2026, 7, 30, 3, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

/** 本物と同じ形式（t=unix秒, v1=HMAC-SHA256("<t>." + raw)）で署名して送る。 */
function signed(bodyObj: unknown, opts: { auth?: string; v1?: string } = {}) {
  const raw = JSON.stringify(bodyObj);
  const t = Math.floor(Date.now() / 1000).toString();
  const v1 =
    opts.v1 ??
    createHmac("sha256", HMAC_SECRET).update(`${t}.${raw}`).digest("hex");
  return makeRequest({
    headers: {
      authorization: opts.auth ?? AUTH_SECRET,
      "x-revenuecat-webhook-signature": `t=${t},v1=${v1}`,
    },
    body: raw,
  }) as NextRequest;
}

type Row = { user_id: string; plan: string; updated_at: string };

/**
 * `toritavi_user_plan` のインメモリ実装。route が組み立てるクエリ
 * （upsert / update + eq / in / lt / lte / select）の WHERE を**実際に評価**
 * する。メソッド名を記録するだけの偽物だと「.lte を .lt に変えた」を
 * 検出できない —— 行が落ちるかどうかで見る。
 */
function fakeAdmin(rows: Row[]) {
  return {
    from(table: string) {
      assert.equal(table, "toritavi_user_plan", "想定外のテーブルに書いた");
      return {
        upsert(
          values: Row,
          opts: { onConflict?: string; ignoreDuplicates?: boolean } = {},
        ) {
          return {
            then(
              onFulfilled: (r: { data: null; error: null }) => unknown,
            ): unknown {
              const hit = rows.find((r) => r.user_id === values.user_id);
              if (!hit) rows.push({ ...values });
              else if (!opts.ignoreDuplicates) Object.assign(hit, values);
              return Promise.resolve({ data: null, error: null } as const).then(
                onFulfilled,
              );
            },
          };
        },
        update(values: Partial<Row>) {
          const preds: Array<(r: Row) => boolean> = [];
          let wantSelect = false;
          const run = () => {
            const matched = rows.filter((r) => preds.every((p) => p(r)));
            for (const r of matched) Object.assign(r, values);
            return {
              data: wantSelect
                ? matched.map((r) => ({ user_id: r.user_id }))
                : null,
              error: null,
            };
          };
          type K = keyof Row;
          const b = {
            eq: (c: K, v: string) => {
              preds.push((r) => r[c] === v);
              return b;
            },
            in: (c: K, vs: string[]) => {
              preds.push((r) => vs.includes(r[c]));
              return b;
            },
            lt: (c: K, v: string) => {
              preds.push((r) => r[c] < v);
              return b;
            },
            lte: (c: K, v: string) => {
              preds.push((r) => r[c] <= v);
              return b;
            },
            select: (_cols: string) => {
              wantSelect = true;
              return b;
            },
            then(onFulfilled: (r: ReturnType<typeof run>) => unknown): unknown {
              return Promise.resolve(run()).then(onFulfilled);
            },
          };
          return b;
        },
      };
    },
  };
}

function setAdmin(admin: unknown) {
  (globalThis as Record<string, unknown>).__toritaviTestAdmin = admin;
}

async function json(res: { json(): Promise<unknown> }) {
  return (await res.json()) as Record<string, unknown>;
}

// ───────────────────── TRANSFER（指摘 #12: 専用ブロック） ─────────────────────

test("🔴 TRANSFER: app_user_id が無くても transferred_from が free に落ちる", async () => {
  // 公式の TRANSFER には app_user_id も entitlement_ids も無い。
  // 「app_user_id を必須に戻す」「TRANSFER ブロックを消す」のどちらでも
  // ここが 400 か素通りになり、渡した側が pro のまま残る。
  const rows: Row[] = [{ user_id: U1, plan: "pro", updated_at: iso(T - 3600_000) }];
  setAdmin(fakeAdmin(rows));
  const res = await POST(
    signed({
      event: {
        type: "TRANSFER",
        transferred_from: [U1],
        transferred_to: [U2],
        event_timestamp_ms: T,
      },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), {
    ok: true,
    transfer: { revoked: 1, granted: 0 },
  });
  assert.equal(rows[0].plan, "free", "渡した側が free に落ちていない");
  assert.equal(rows[0].updated_at, iso(T));
  // 🔴 受け取った側には付与しない（entitlement_ids が無く有効性を判断
  //    できないため。無条件付与は払っていない人に Pro を配る）。
  assert.ok(
    !rows.some((r) => r.user_id === U2),
    "TRANSFER が受け取った側に行を作った（無条件付与はフェイルオープン）",
  );
});

test("🔴 TRANSFER: 同時刻の行も落とす（失効は .lte）", async () => {
  // RENEWAL と TRANSFER が同一ミリ秒だった場合、.lt に戻すと到着順で
  // 結果が変わり、渡した側が pro のまま残りうる。同時刻は失効を勝たせる。
  const rows: Row[] = [{ user_id: U1, plan: "pro", updated_at: iso(T) }];
  setAdmin(fakeAdmin(rows));
  const res = await POST(
    signed({
      event: { type: "TRANSFER", transferred_from: [U1], event_timestamp_ms: T },
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(rows[0].plan, "free", "同時刻の TRANSFER 失効が効いていない");
});

test("TRANSFER: 失効対象が UUID でなければ、DB クライアント無しで受け流す", async () => {
  // from が空なら書き込みは無い。ここで createServiceClient を要求すると、
  // env の無い環境で正しい webhook を 500 にしてしまう。
  setAdmin(undefined);
  const res = await POST(
    signed({
      event: {
        type: "TRANSFER",
        transferred_from: ["$RCAnonymousID:abc"],
        event_timestamp_ms: T,
      },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true, skipped: "transfer_no_known_source" });
});

// ──────────────── 同時刻タイブレーク（指摘 #12: .lte / .lt） ────────────────

test("🔴 EXPIRATION: 同時刻でも free に落とす（失効優先）", async () => {
  const rows: Row[] = [{ user_id: U1, plan: "pro", updated_at: iso(T) }];
  setAdmin(fakeAdmin(rows));
  const res = await POST(
    signed({
      event: { type: "EXPIRATION", app_user_id: U1, event_timestamp_ms: T },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true, plan: "free", applied: true });
  assert.equal(rows[0].plan, "free", "同時刻の EXPIRATION が踏み負けた");
});

test("🔴 RENEWAL: 同時刻では pro に戻さない（付与は .lt のまま）", async () => {
  // 付与側まで .lte にすると、同時刻の EXPIRATION を付与が踏み返す。
  // 誤って free なら次の RENEWAL で戻るが、誤って pro は配り続ける。
  const rows: Row[] = [{ user_id: U1, plan: "free", updated_at: iso(T) }];
  setAdmin(fakeAdmin(rows));
  const res = await POST(
    signed({
      event: {
        type: "RENEWAL",
        app_user_id: U1,
        entitlement_ids: ["pro"],
        event_timestamp_ms: T,
      },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true, plan: "pro", applied: false });
  assert.equal(rows[0].plan, "free", "同時刻の付与が失効を踏み返した");
});

test("再送で遅れた EXPIRATION は、より新しい状態を踏み潰さない", async () => {
  const rows: Row[] = [{ user_id: U1, plan: "pro", updated_at: iso(T) }];
  setAdmin(fakeAdmin(rows));
  const res = await POST(
    signed({
      event: {
        type: "EXPIRATION",
        app_user_id: U1,
        event_timestamp_ms: T - 60_000,
      },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true, plan: "free", applied: false });
  assert.equal(rows[0].plan, "pro", "古い EXPIRATION が新しい RENEWAL を踏んだ");
});

test("より新しい RENEWAL は pro へ進める（付与の正常系）", async () => {
  const rows: Row[] = [{ user_id: U1, plan: "free", updated_at: iso(T - 60_000) }];
  setAdmin(fakeAdmin(rows));
  const res = await POST(
    signed({
      event: {
        type: "RENEWAL",
        app_user_id: U1,
        entitlement_ids: ["pro"],
        event_timestamp_ms: T,
      },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true, plan: "pro", applied: true });
  assert.equal(rows[0].plan, "pro");
  assert.equal(rows[0].updated_at, iso(T));
});

// ─────────────────────────── 共通経路の入口の門 ───────────────────────────

test("INITIAL_PURCHASE: 行が無ければ作る（upsert 経路）", async () => {
  const rows: Row[] = [];
  setAdmin(fakeAdmin(rows));
  const res = await POST(
    signed({
      event: {
        type: "INITIAL_PURCHASE",
        id: "evt_initial_001",
        app_user_id: U1,
        entitlement_ids: ["pro"],
        event_timestamp_ms: T,
        // JST では 2026-08-30。**UTC で切ると 08-29 になる日時をわざと選んでいる**
        // （UTC 2026-08-29 21:00 = JST 2026-08-30 06:00）。
        purchased_at_ms: Date.UTC(2026, 7, 29, 21, 0, 0),
      },
    }),
  );
  assert.equal(res.status, 200);
  // upsert が作った直後の update は .lt で外れるので applied:false が正。
  assert.deepEqual(await json(res), { ok: true, plan: "pro", applied: false });
  // 🔴 **`last_event_id` に「どのイベントがこの行を作ったか」が残ること。**
  //    課金が反映されないときに、運用者がここから追える
  //    （`admin-maintenance-guide.md` の調査手順）。null で素通りさせない。
  // 🔴 **`period_anchor` は JST で切ること。** `ocr_period_start()` が
  //    `(now() AT TIME ZONE 'Asia/Tokyo')::DATE` と比べるので、UTC で書くと
  //    日付が 1 日ずれた期間ができる（`CLAUDE.md` §6 の「JST 修正が
  //    複製先に入っていなかった」と同じ型）。
  assert.deepEqual(rows, [
    {
      user_id: U1,
      plan: "pro",
      updated_at: iso(T),
      last_event_id: "evt_initial_001",
      period_anchor: "2026-08-30",
    },
  ]);
});

test("🔴 pro の権利が無い購入イベントでは付与しない", async () => {
  setAdmin(undefined); // 書き込み前に受け流すので、クライアントは要らない
  const res = await POST(
    signed({
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: U1,
        entitlement_ids: ["something_else"],
        event_timestamp_ms: T,
      },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true, skipped: "INITIAL_PURCHASE" });
});

test("UUID でない app_user_id は 200 で捨てる（再送ループを作らない）", async () => {
  setAdmin(undefined);
  const res = await POST(
    signed({
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: "$RCAnonymousID:abc",
        entitlement_ids: ["pro"],
        event_timestamp_ms: T,
      },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true, skipped: "not_a_supabase_user" });
});

test("🔴 app_user_id は TRANSFER **以外**では必須のまま", async () => {
  // TRANSFER のために必須を外したのは共通経路の**手前だけ**。ここまで
  // 外すと、identity の無いイベントが upsert に届く。
  setAdmin(undefined);
  const res = await POST(
    signed({ event: { type: "RENEWAL", entitlement_ids: ["pro"], event_timestamp_ms: T } }),
  );
  assert.equal(res.status, 400);
});

test("type の無いイベントは 400", async () => {
  setAdmin(undefined);
  const res = await POST(signed({ event: { app_user_id: U1 } }));
  assert.equal(res.status, 400);
});

test("Authorization が違えば 401（本文は読まれない）", async () => {
  setAdmin(undefined);
  const res = await POST(
    signed(
      { event: { type: "EXPIRATION", app_user_id: U1, event_timestamp_ms: T } },
      { auth: "wrong-secret" },
    ),
  );
  assert.equal(res.status, 401);
});

test("🔴 HMAC 署名が壊れていれば 401（検証が配線されている）", async () => {
  setAdmin(undefined);
  const res = await POST(
    signed(
      { event: { type: "EXPIRATION", app_user_id: U1, event_timestamp_ms: T } },
      { v1: "0".repeat(64) },
    ),
  );
  assert.equal(res.status, 401);
});
