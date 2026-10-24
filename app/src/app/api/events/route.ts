/*
 * POST /api/events — 利用解析のイベントを受け取る。
 *
 * 🔴 **誰のものかを持たない**（2026-09-13・利用者の決定「C」）。
 *    トークンを見ない。`user_id` を書かない。body に何が入っていても使わない。
 *    **サーバは原理的に「誰か」を知れない。**
 *
 *    アプリ側も Authorization ヘッダを付けない（`analytics.dart`）。
 *    二重にしてあるのは、片方の配線が戻ったときに黙って属性が付くのを
 *    防ぐため —— **付いたことは、集計の画面では見えない。**
 *
 * 🔴 **代わりに分かることが減る。** `session_id` はアプリの起動 1 回ごとなので、
 *    **日をまたぐ追跡はできない。**「登録した人が後日購入した」は繋がらない。
 *    分かるのは「1 回の起動の中でどこまで進んだか」。
 *
 * 🔴 **失敗しても 200 を返す。** 解析はアプリの機能ではない。ここが
 *    500 を返すと、アプリ側の送信経路が例外処理に入り、**本来の操作の
 *    邪魔をする**。落ちたことはサーバのログに残す（`dropped` も返す）。
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";
import { ALLOWED_ORIGINS } from "@/lib/allowed-origins";
import { sanitizeEvents, sanitizeContext, isUuid } from "@/lib/events";
import { eventRowsLimiter, eventsRateLimiter, eventsSourceOf } from "@/lib/events-rate-limit";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 🔴 回数制限（events-rate-limit.ts）。超えても 200 を返す —— 正規のアプリの
  //    送信経路を例外に落とさない（冒頭の「失敗しても 200」と同じ理由）。
  const source = eventsSourceOf(request.headers);
  if (!eventsRateLimiter.allow(source)) {
    console.warn("[events] rate limited");
    return NextResponse.json({ accepted: 0, dropped: 0, limited: true }, { status: 200 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ accepted: 0, dropped: 0 }, { status: 200 });
  }

  // 🔴 session_id はアプリの起動 1 回ごとの UUID。**端末の識別子ではない**
  //    ので、形だけ確かめる。形が違うものは受けない（集計の軸が壊れる）。
  if (!isUuid(body.sessionId)) {
    return NextResponse.json({ accepted: 0, dropped: 0 }, { status: 200 });
  }

  const { events, dropped } = sanitizeEvents(body.events);
  if (events.length === 0) {
    if (dropped > 0) {
      // **弾いた件数を必ず残す。** 黙って捨てると、アプリ側の配線ミスに
      // 永久に気づけない（「来ていない」と「弾かれている」が同じに見える）。
      console.warn(`[events] dropped ${dropped} event(s) — 許可一覧に無い名前？`);
    }
    return NextResponse.json({ accepted: 0, dropped }, { status: 200 });
  }

  // 🔴 **書く行数でも数える**（2026-10-24・Cloudflare 検査 run-2）。回数だけだと 1 回に
  //    50 件まで積めて、同じ送り元から 1 分に 1,000 行書けた。超えたら 1 行も書かない。
  if (!eventRowsLimiter.allow(source, Date.now(), events.length)) {
    console.warn("[events] row limit");
    return NextResponse.json({ accepted: 0, dropped, limited: true }, { status: 200 });
  }

  // 🔴 **誰かを決めない。** トークンを読まない。`user_id` を書かない。
  //    ここに認証を戻すと、**黙って個人に紐づく表になる。**
  //    `events_anonymous_test.ts` がこのファイルを読んで見張っている。
  const ctx = sanitizeContext(body);
  const rows = events.map((e) => ({
    session_id: body.sessionId as string,
    name: e.name,
    screen: e.screen,
    props: e.props,
    ...ctx,
  }));
  // 🔴 **再送で 2 回数えない**（2026-10-22・`events.ts` の `eventId`）。
  //    同じ鍵の行が既にあれば黙って飛ばす（`supabase/events_idempotency.sql` の一意索引）。
  //    鍵を送ってこない古いアプリの行には、欄そのものを付けない。
  const keyed = events.some((e) => e.eventId);
  const keyedRows = rows.map((r, i) =>
    events[i].eventId ? { ...r, event_id: events[i].eventId } : r,
  );

  try {
    const admin = createServiceClient();
    // 🔴 **呼ぶたびに `from()` から作り直す。** 組み立て役は URL の検索条件を
    //    持ち回るので、使い回すと 2 回目の insert に `on_conflict` が残る。
    let { error } = keyed
      ? await admin
          .from("toritavi_events")
          .upsert(keyedRows, { onConflict: "event_id", ignoreDuplicates: true })
      : await admin.from("toritavi_events").insert(rows);
    if (error && keyed) {
      // 🔴 **欄や索引がまだ無い本番でも、イベントを失わない。** 鍵を外して入れ直す
      //    （重複は防げないが、0 件よりよい）。黙らずにログへ残す。
      console.warn("[events] keyed insert failed — 鍵なしで入れ直す", error.message);
      ({ error } = await admin.from("toritavi_events").insert(rows));
    }
    if (error) {
      console.warn("[events] insert failed", error.message);
      return NextResponse.json({ accepted: 0, dropped }, { status: 200 });
    }
  } catch (e) {
    console.warn("[events] service client failed", e);
    return NextResponse.json({ accepted: 0, dropped }, { status: 200 });
  }

  if (dropped > 0) {
    console.warn(`[events] dropped ${dropped} event(s) — 許可一覧に無い名前？`);
  }
  return NextResponse.json({ accepted: rows.length, dropped }, { status: 200 });
}
