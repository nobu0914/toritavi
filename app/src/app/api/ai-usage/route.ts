/*
 * GET /api/ai-usage — 当期の AI 利用状況（OCR / コンシェルジュ）を返す。
 *
 * - 認証必須（Cookie or Bearer = authenticateRequest）
 * - プラン（free/pro）を解決し、機能別に used/limit と次回リセット時刻を返す
 * - 「当期」は機能で異なる（OCR=月次 / コンシェルジュ=日次）。各 feature の
 *   period フィールドがどちらかを示す
 * - 読み取り専用（使用量は加算しない）
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase-server";
import {
  OCR_GUARD,
  CONCIERGE_GUARD,
  resolvePlan,
  audienceOf,
  getAiUsage,
  type AiFeatureUsage,
  nextResetIso,
} from "@/lib/ai-guard";
import { ALLOWED_ORIGINS } from "@/lib/allowed-origins";
import {
  capGuestUsage,
  decideGuest,
  type GuestDecision,
  type GuestDeviceState,
} from "@/lib/guest-quota";
import { queryGuestUsed } from "@/lib/devicecheck";

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { sb, userId, isAnonymous } = auth;

  // 🔴 **読めなかったら 200 で `free` を返さない**（2026-08-30 レーン 3）。
  //    アプリは「サーバに聞けた・無料だった」と解釈し、契約者に
  //    「まだ反映されていません」を出す —— **課金の嘘**になる。
  //    503 なら `subscriptionSync` は「聞けなかった」として扱える。
  let plan;
  try {
    plan = await resolvePlan(sb, userId);
  } catch {
    return NextResponse.json(
      { error: "plan_unavailable", message: "利用状況を取得できませんでした。" },
      { status: 503 },
    );
  }
  // 残数の上限は audience で引く（ゲストは 3 件）。
  const audience = audienceOf(plan, isAnonymous);

  // 🔴 `getAiUsage` は期間キーを SQL に聞くので、**取れなければ投げる**
  //    （`QuotaPeriodUnavailableError`）。包まないと生 500 になる。
  //    2026-08-30 に concierge で同じ見落としをしたばかり
  //    —— `CLAUDE.md` §6-1 の 3「同じ経路を通る呼び出しを数える」。
  let ocr, concierge;
  try {
    [ocr, concierge] = await Promise.all([
      getAiUsage(sb, userId, OCR_GUARD, audience),
      getAiUsage(sb, userId, CONCIERGE_GUARD, audience),
    ]);
  } catch {
    return NextResponse.json(
      { error: "plan_unavailable", message: "利用状況を取得できませんでした。" },
      { status: 503 },
    );
  }

  // ゲストの身元確認が済んでいるか。**アプリが起動時にやり直すかを決める。**
  //
  // 🔴 **読めなかったら false。** 「読めない」を「通っている」に変換すると、
  //    失敗したまま二度とやり直さない。会員には常に false（意味を持たない）。
  let guestAttested = false;
  if (isAnonymous) {
    const { data: g } = await sb
      .from("toritavi_guest_grants")
      .select("attested")
      .eq("user_id", userId)
      .maybeSingle();
    guestAttested = g?.attested === true;
  }

  // 🔴 **ゲストの上限は、App Attest の結果で決まる。**
  //    `tiers.guest` の 3 をそのまま返すと、**未検証の端末に「0 / 3」と
  //    出して実際は 1 件で止まる** —— 画面が嘘をつく（2026-08-31 に実機で発覚）。
  //    判定は `/api/ocr` と同じ `decideGuest` に寄せる。**2 か所で別々に
  //    計算しない**（片方だけ直る形を作らない）。
  // 🔴 **端末側の関門も通す。** ここを見ないと、画面の上下で違うことを言う ——
  //    「上限に達しました」（端末の関門）と「残り 3 件」（DB の件数）が
  //    同時に出た（2026-08-31 に実機で発生）。
  //    **判定は 1 か所（`decideGuest`）に寄せ、残数もそこから出す。**
  let guestDecision: GuestDecision | undefined;
  if (isAnonymous) {
    const token = request.headers.get("x-guest-device-token");
    const dev = token ? await queryGuestUsed(token) : null;
    const state: GuestDeviceState =
      dev && dev.ok
        ? dev.known
          ? { kind: "known", used: dev.used }
          : { kind: "fresh" }
        : { kind: "unknown", reason: dev?.ok === false ? dev.reason : "no_token" };
    guestDecision = decideGuest(guestAttested ? "attested" : "failed", state);
  }
  const capOcr = (u: AiFeatureUsage): AiFeatureUsage =>
    guestDecision === undefined ? u : capGuestUsage(u, guestDecision);

  // 🔴 **枠が戻る日は DB に訊く。** `nextResetIso` は user_id を取らないので
  //    **常に翌月 1 日**を返していた。Pro に契約応当日が入ると嘘になる
  //    （外部レビュー 2026-08-31 の P1）。
  //
  //    🔴 **サーバで計算しない。** 「期間開始 +1 か月」では月末起点がずれる ——
  //    anchor=1/31・3/15 時点で、正しくは 3/31 なのに 3/28 になる（実測）。
  //    丸めを 2 か所で書くと必ず食い違う（`CLAUDE.md` §6 の複製の型）。
  //
  //    読めなかったときは **Pro だけ null**（＝日付を出さない）に倒す。
  //    暦月の人に翌月 1 日を出すのは正しいので、そちらは従来値を使う。
  //    **分からないことを、それらしい日付に変換しない。**
  const ocrResetAt = await (async (): Promise<string | null> => {
    if (isAnonymous) return null; // ゲストはリセットしない
    const { data, error } = await sb.rpc("ocr_period_next", {
      p_user_id: userId,
    });
    if (!error && typeof data === "string") {
      return new Date(`${data}T00:00:00+09:00`).toISOString();
    }
    console.error("[ai-usage] ocr_period_next failed:", error?.message);
    return plan === "pro" ? null : nextResetIso(OCR_GUARD.quotaPeriod);
  })();

  return NextResponse.json({
    plan,
    guestAttested,
    // 機能ごとにリセット単位が違う（OCR=月次 / コンシェルジュ=日次）。
    // トップレベルの resetAt は**配布済みアプリが読んでいる**ので残す。
    // 値は OCR のもの（バッジが表示しているのは OCR の残量）。
    // 🔴 **ゲストはリセットしない。** 期間キーは番兵で固定なので、
    //    「9月1日にリセット」は嘘になる（実機で確認）。`null` を返し、
    //    アプリ側は日付なしの文言を出す。
    resetAt: ocrResetAt,
    ocr: {
      ...capOcr(ocr),
      resetAt: ocrResetAt,
    },
    concierge: {
      ...concierge,
      resetAt: nextResetIso(CONCIERGE_GUARD.quotaPeriod),
    },
  });
}
