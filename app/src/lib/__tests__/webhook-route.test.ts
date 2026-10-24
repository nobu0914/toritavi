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
function fakeAdmin(rows: Row[], opts: { anonymous?: boolean } = {}) {
  return {
    // 🔴 **匿名かどうかを引く口**（2026-09-04 に足した門）。
    //    匿名の uid も UUID なので `UUID_RE` は抜ける。付与の直前に
    //    ここで断らないと、**捨て身のアカウントに課金が紐づく。**
    auth: {
      admin: {
        getUserById(_id: string) {
          return Promise.resolve({
            data: { user: { is_anonymous: opts.anonymous === true } },
            error: null,
          });
        },
      },
    },
    from(table: string) {
      assert.equal(table, "toritavi_user_plan", "想定外のテーブルに書いた");
      return {
        upsert(
          values: Row,
          opts: { onConflict?: string; ignoreDuplicates?: boolean } = {},
        ) {
          let wantSelect = false;
          const run = () => {
            const hit = rows.find((r) => r.user_id === values.user_id);
            if (!hit) rows.push({ ...values });
            else if (!opts.ignoreDuplicates) Object.assign(hit, values);
            // PostgREST の ignore-duplicates は `ON CONFLICT DO NOTHING RETURNING`
            // なので、`.select()` で返るのは**実際に作った行だけ**（本物と同じ）。
            const written = !hit || !opts.ignoreDuplicates;
            return {
              data: wantSelect ? (written ? [{ user_id: values.user_id }] : []) : null,
              error: null,
            };
          };
          const b = {
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
  delete process.env.REVENUECAT_SECRET_API_KEY;
  const rc = stubRevenueCat(() => {
    throw new Error("鍵が無いのに RevenueCat を引いた");
  });
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
  // 鍵（REVENUECAT_SECRET_API_KEY）が無ければ、問い合わせもしない
  assert.equal(rc.calls.length, 0);
  rc.restore();
});

// ──────── TRANSFER の受け取った側（2026-10-24・夜間検査 3-1） ────────
//
// TRANSFER には `entitlement_ids` が無いので、本文だけでは「移った権利が pro か」
// 「いま有効か」を判断できない。以前は付与を一切せず、受け取った側は
// **次の RENEWAL まで最長 1 か月 free のまま**だった（払っているのに）。
//
// `REVENUECAT_SECRET_API_KEY` があるときだけ、RevenueCat の REST API で
// 受け取った側の subscriber を引き、**pro が有効なときだけ**付与する。
// 🔴 **確かめられないときは付けない**（鍵が無い・引けない・期限切れ・pro が無い）。
//    失効（渡した側）は従来どおり先に行い、付与の成否で応答を 5xx にしない。

const RC_KEY = "sk_test_revenuecat_secret";
const realFetch = globalThis.fetch;

type RcCall = { url: string; authorization: string | null };

/** RevenueCat の REST API だけを差し替える。呼ばれた URL と鍵を残す。 */
function stubRevenueCat(respond: (url: string) => Response | Promise<Response>) {
  const calls: RcCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const h = new Headers(init?.headers);
    calls.push({ url, authorization: h.get("authorization") });
    return respond(url);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

function subscriber(entitlements: Record<string, { expires_date: string | null; purchase_date?: string }>) {
  return new Response(
    JSON.stringify({
      request_date_ms: T,
      subscriber: { original_app_user_id: U2, entitlements, subscriptions: {} },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function transferWithKey(rows: Row[], respond: (url: string) => Response | Promise<Response>, opts: { anonymous?: boolean } = {}) {
  process.env.REVENUECAT_SECRET_API_KEY = RC_KEY;
  const rc = stubRevenueCat(respond);
  setAdmin(fakeAdmin(rows, opts));
  try {
    const res = await POST(
      signed({
        event: {
          type: "TRANSFER",
          id: "evt_transfer_001",
          transferred_from: [U1],
          transferred_to: [U2],
          event_timestamp_ms: T,
        },
      }),
    );
    return { res, rc };
  } finally {
    rc.restore();
    delete process.env.REVENUECAT_SECRET_API_KEY;
  }
}

const FUTURE = iso(Date.now() + 20 * 24 * 3600_000);
const PAST = iso(Date.now() - 24 * 3600_000);

test("🔴 TRANSFER＋鍵あり: 受け取った側の pro が有効なら付与する（行が無ければ作る）", async () => {
  const rows: Row[] = [{ user_id: U1, plan: "pro", updated_at: iso(T - 3600_000) }];
  const { res, rc } = await transferWithKey(rows, () =>
    subscriber({ pro: { expires_date: FUTURE, purchase_date: "2026-08-29T21:00:00Z" } }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true, transfer: { revoked: 1, granted: 1 } });
  // 問い合わせ先と鍵
  assert.equal(rc.calls.length, 1);
  assert.equal(rc.calls[0].url, `https://api.revenuecat.com/v1/subscribers/${U2}`);
  assert.equal(rc.calls[0].authorization, `Bearer ${RC_KEY}`);
  // 渡した側は free、受け取った側は pro
  assert.equal(rows.find((r) => r.user_id === U1)?.plan, "free");
  const got = rows.find((r) => r.user_id === U2) as Record<string, unknown> | undefined;
  assert.ok(got, "🔴 受け取った側に付与していない（次の RENEWAL まで free のまま）");
  assert.equal(got.plan, "pro");
  assert.equal(got.updated_at, iso(T));
  assert.equal(got.last_event_id, "evt_transfer_001");
  // 起点は権利の購入時刻（JST で切る・通常の付与と同じ）
  assert.equal(got.period_anchor, "2026-08-30");
});

test("TRANSFER＋鍵あり: 既存の行は、イベントより古いときだけ pro へ進める", async () => {
  const older: Row[] = [{ user_id: U2, plan: "free", updated_at: iso(T - 60_000) }];
  const a = await transferWithKey(older, () => subscriber({ pro: { expires_date: FUTURE } }));
  assert.deepEqual(await json(a.res), { ok: true, transfer: { revoked: 1, granted: 1 } });
  assert.equal(older[0].plan, "pro");
  assert.equal(older[0].updated_at, iso(T));

  // より新しい状態（例: 後から届いた EXPIRATION を反映済み）は踏み潰さない
  const newer: Row[] = [{ user_id: U2, plan: "free", updated_at: iso(T + 60_000) }];
  const b = await transferWithKey(newer, () => subscriber({ pro: { expires_date: FUTURE } }));
  assert.deepEqual(await json(b.res), { ok: true, transfer: { revoked: 1, granted: 0 } });
  assert.equal(newer[0].plan, "free", "古い TRANSFER が新しい状態を踏んだ");
});

test("TRANSFER＋鍵あり: 期限の無い pro（買い切り）も付与する", async () => {
  const rows: Row[] = [];
  const { res } = await transferWithKey(rows, () => subscriber({ pro: { expires_date: null } }));
  assert.deepEqual(await json(res), { ok: true, transfer: { revoked: 1, granted: 1 } });
  assert.equal(rows.find((r) => r.user_id === U2)?.plan, "pro");
});

for (const [name, respond] of [
  ["pro の期限が切れている", () => subscriber({ pro: { expires_date: PAST } })],
  ["pro の権利が無い", () => subscriber({ other: { expires_date: FUTURE } })],
  ["権利が 1 つも無い", () => subscriber({})],
] as const) {
  test(`🔴 TRANSFER＋鍵あり: ${name} → 付与しない`, async () => {
    const rows: Row[] = [{ user_id: U1, plan: "pro", updated_at: iso(T - 3600_000) }];
    const { res } = await transferWithKey(rows, respond);
    assert.equal(res.status, 200);
    assert.deepEqual(await json(res), { ok: true, transfer: { revoked: 1, granted: 0 } });
    assert.ok(!rows.some((r) => r.user_id === U2), "🔴 有効でない権利で pro を配った");
    assert.equal(rows[0].plan, "free", "渡した側の失効は従来どおり");
  });
}

for (const [name, respond] of [
  ["通信が届かない", (): Response => {
    throw new TypeError("fetch failed");
  }],
  ["RevenueCat が 500", () => new Response("oops", { status: 500 })],
  ["鍵が通らない（401）", () => new Response(JSON.stringify({ code: 7225 }), { status: 401 })],
  ["応答が JSON でない", () => new Response("<html>", { status: 200 })],
] as const) {
  test(`🔴 TRANSFER＋鍵あり: ${name} → 付与しない・応答は 200（失効は済ませる）`, async () => {
    const rows: Row[] = [{ user_id: U1, plan: "pro", updated_at: iso(T - 3600_000) }];
    const orig = { warn: console.warn, error: console.error };
    console.warn = () => {};
    console.error = () => {};
    try {
      const { res } = await transferWithKey(rows, respond);
      assert.equal(res.status, 200, "付与の失敗で 5xx を返すと、済んだ失効ごと再送される");
      assert.deepEqual(await json(res), { ok: true, transfer: { revoked: 1, granted: 0 } });
    } finally {
      console.warn = orig.warn;
      console.error = orig.error;
    }
    assert.ok(!rows.some((r) => r.user_id === U2), "🔴 確かめられないのに pro を配った");
    assert.equal(rows[0].plan, "free");
  });
}

test("TRANSFER＋鍵あり: 渡した側が UUID でなくても、受け取った側は確かめて付与する", async () => {
  // 匿名の RevenueCat ID（`$RCAnonymousID:...`）から移った場合。失効する相手は
  // いないが、受け取った側の権利は確かめられる。鍵が無ければ従来どおり受け流す。
  process.env.REVENUECAT_SECRET_API_KEY = RC_KEY;
  const rc = stubRevenueCat(() => subscriber({ pro: { expires_date: FUTURE } }));
  const rows: Row[] = [];
  setAdmin(fakeAdmin(rows));
  try {
    const res = await POST(
      signed({
        event: {
          type: "TRANSFER",
          transferred_from: ["$RCAnonymousID:abc"],
          transferred_to: [U2],
          event_timestamp_ms: T,
        },
      }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await json(res), { ok: true, transfer: { revoked: 0, granted: 1 } });
    assert.equal(rows.find((r) => r.user_id === U2)?.plan, "pro");
  } finally {
    rc.restore();
    delete process.env.REVENUECAT_SECRET_API_KEY;
  }

  setAdmin(undefined);
  const noKey = await POST(
    signed({
      event: {
        type: "TRANSFER",
        transferred_from: ["$RCAnonymousID:abc"],
        transferred_to: [U2],
        event_timestamp_ms: T,
      },
    }),
  );
  assert.deepEqual(await json(noKey), { ok: true, skipped: "transfer_no_known_source" });
});

test("🔴 TRANSFER＋鍵あり: 受け取った側が匿名なら、有効でも付与しない", async () => {
  const rows: Row[] = [];
  const { res } = await transferWithKey(rows, () => subscriber({ pro: { expires_date: FUTURE } }), {
    anonymous: true,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true, transfer: { revoked: 1, granted: 0 } });
  assert.ok(!rows.some((r) => r.user_id === U2), "🔴 匿名アカウントに pro を付けた");
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

// ────────── 失効させてはいけないイベント（2026-09-02 に穴として発見） ──────────
//
// 🔴 **`CANCELLATION` は「自動更新をオフにした」であって「期間が終わった」
//    ではない。** 落としてよいのは `EXPIRATION` だけ。取り違えて
//    `REVOKING_EVENTS` に足すと、**払った月を途中で取り上げる**。
//
//    route.ts のヘッダには最初からそう書いてあったが、**このファイルに
//    `CANCELLATION` は一度も出てこなかった** —— つまり、足しても消しても
//    テストは緑のままだった。落ちも警告も出ない型（`CLAUDE.md` §6-1）。
//    サンドボックスで解約した直後に無料へ戻り、それが解約ではなく
//    `EXPIRATION` によるもの（サンドボックスは 1 か月＝5 分・6 回で終了）
//    だと確かめる過程で見つかった。
//
//    `BILLING_ISSUE` も同じ型で、しかも**猶予期間の最中に届く**。
//    ここで取り上げると、支払い方法を直す機会を与えずに締め出すことになる。
//
//    **落とさないことだけでなく、行に触らないことも見る。** `updated_at` を
//    進めてしまうと、後から届いた本物の `EXPIRATION` が `.lte` で弾かれる
//    ——「取り上げない」が「二度と取り上げられない」に変わる。

test("🔴 CANCELLATION: 解約しただけでは pro を取り上げない（行に触らない）", async () => {
  const before = iso(T - 60_000);
  const rows: Row[] = [{ user_id: U1, plan: "pro", updated_at: before }];
  setAdmin(fakeAdmin(rows));
  const res = await POST(
    signed({
      event: {
        type: "CANCELLATION",
        app_user_id: U1,
        entitlement_ids: ["pro"],
        event_timestamp_ms: T,
      },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true, skipped: "CANCELLATION" });
  assert.equal(rows[0].plan, "pro", "解約で pro を取り上げた（払った期間が残っている）");
  assert.equal(rows[0].updated_at, before, "落とさなくても行に触ると、後続の EXPIRATION が弾かれる");
});

test("🔴 BILLING_ISSUE: 猶予期間の最中に取り上げない", async () => {
  const before = iso(T - 60_000);
  const rows: Row[] = [{ user_id: U1, plan: "pro", updated_at: before }];
  setAdmin(fakeAdmin(rows));
  const res = await POST(
    signed({
      event: {
        type: "BILLING_ISSUE",
        app_user_id: U1,
        entitlement_ids: ["pro"],
        event_timestamp_ms: T,
      },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true, skipped: "BILLING_ISSUE" });
  assert.equal(rows[0].plan, "pro", "支払い失敗の通知だけで締め出した");
  assert.equal(rows[0].updated_at, before, "猶予中に行を進めると、本物の失効が弾かれる");
});

test("知らないイベント型は 200 で受け流す（再送ループを作らない）", async () => {
  // RevenueCat は将来イベントを増やす。400 を返すと再送され、最後は捨てられる。
  setAdmin(undefined);
  const res = await POST(
    signed({
      event: {
        type: "SUBSCRIPTION_EXTENDED",
        app_user_id: U1,
        entitlement_ids: ["pro"],
        event_timestamp_ms: T,
      },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { ok: true, skipped: "SUBSCRIPTION_EXTENDED" });
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

// ============================================================================
// 🔴 **匿名（ゲスト）アカウントに Pro を付けない**（2026-09-04 の外部監査）。
//
// 匿名の uid も UUID なので `UUID_RE` は抜ける。付けてしまうと:
//   - 端末（Keychain）を失えば**二度と Pro に戻れない**
//   - 90 日無活動で掃除の cron が**アカウントごと消す**。課金だけ残る
//
// アプリ側にも門があるが、**アプリは改造できる。**
// 権利が付く最後の場所はここなので、ここでも断る。
// ============================================================================

test("🔴 匿名アカウントには pro を付けない", async () => {
  const rows: Row[] = [];
  setAdmin(fakeAdmin(rows, { anonymous: true }));
  const res = await POST(
    signed({
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: U1,
        entitlement_ids: ["pro"],
        event_timestamp_ms: T,
      },
    }),
  );
  assert.equal(res.status, 200, "再送ループを作らない");
  assert.deepEqual(await json(res), { ok: true, skipped: "anonymous_user" });
  assert.equal(rows.length, 0, "🔴 匿名の行を作ってしまっている");
});

test("🔴 匿名でも失効（free へ戻す）は通す", async () => {
  // 「取り上げる」方向は安全側。止めると、付いてしまった権利を戻せなくなる。
  const rows: Row[] = [{ user_id: U1, plan: "pro", updated_at: iso(T - 1000) }];
  setAdmin(fakeAdmin(rows, { anonymous: true }));
  const res = await POST(
    signed({
      event: { type: "EXPIRATION", app_user_id: U1, event_timestamp_ms: T },
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(rows[0].plan, "free", "🔴 匿名の失効を止めてしまっている");
});
