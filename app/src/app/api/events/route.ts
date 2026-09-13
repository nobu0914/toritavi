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

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  try {
    const admin = createServiceClient();
    const { error } = await admin.from("toritavi_events").insert(rows);
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
