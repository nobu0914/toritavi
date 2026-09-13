/*
 * POST /api/events — 利用解析のイベントを受け取る。
 *
 * 🔴 **端末から表へ直接書かせない。** 書かせると、他人の user_id を名乗った
 *    行を誰でも作れる。件数を水増しされると解析そのものが意味を失うので、
 *    受け口をここ 1 本にして、本人はトークンから決める
 *    （body の user_id は**見ない**）。
 *
 * 🔴 **未ログインでも受ける。** ようこそ画面・新規登録画面のイベントは
 *    登録前に出る。そこが見えないと「どこで諦めたか」が分からない
 *    —— いま埋めたい穴はまさにそこ（登録 5 → Pro 0）。
 *    未ログインの行は `user_id = null` で、誰のものでもない。
 *
 * 🔴 **失敗しても 200 を返す。** 解析はアプリの機能ではない。ここが
 *    500 を返すと、アプリ側の送信経路が例外処理に入り、**本来の操作の
 *    邪魔をする**。落ちたことはサーバのログに残す（`dropped` も返す）。
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase-server";
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

  // 本人はトークンから。未ログインなら null。
  let userId: string | null = null;
  try {
    const auth = await authenticateRequest(request);
    userId = auth?.userId ?? null;
  } catch {
    userId = null;
  }

  const ctx = sanitizeContext(body);
  const rows = events.map((e) => ({
    user_id: userId,
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
