/*
 * ゲスト（未登録）の身元を確かめる。**起動時に 1 回だけ**呼ぶ。
 *
 *   GET  /api/guest/attest … チャレンジを発行する
 *   POST /api/guest/attest … attestation を検証して結果を保存する
 *
 * これが通ると、その匿名利用者は OCR を **3 件**（仕様値）まで使える。
 * 通らなければ **1 件**（`guest-quota.ts` の `GUEST_UNATTESTED_LIMIT`）。
 *
 * 🔴 **匿名利用者だけが対象。** 会員が呼んでも意味が無いので弾く
 *    （通すと、会員の行に `attested` が立って読み方が二重になる）。
 *
 * 🔴 **チャレンジは 1 回限り・短命。** App Attest の使い回しを防ぐのは
 *    これだけ（証明書の有効期限では防げない・`attest.ts` の注記）。
 *    検証したら **null に戻す**。
 *
 * 🔴 **書き込みは service client（RLS を素通り）でのみ行う。**
 *    利用者は `toritavi_guest_grants` を**読めるが書けない**（028 の RLS）。
 *    書けたら `attested = true` を自分で立てられ、検証が無意味になる。
 */
import { createHash, randomBytes } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { ALLOWED_ORIGINS } from "@/lib/allowed-origins";
import { authenticateRequest } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import { verifyAppAttest } from "@/lib/attest";

export const runtime = "nodejs";

/** チャレンジの寿命。短くする。長いと使い回しの窓が広がる。 */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** 開発環境の attestation を受けるか。**本番では false のまま。** */
const ALLOW_DEV = process.env.APPLE_APPATTEST_ALLOW_DEV === "1";

function forbiddenOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const bad = forbiddenOrigin(request);
  if (bad) return bad;

  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.isAnonymous) {
    return NextResponse.json({ error: "not_guest" }, { status: 400 });
  }

  const challenge = randomBytes(32);
  const svc = createServiceClient();
  const { error } = await svc.from("toritavi_guest_grants").upsert(
    {
      user_id: auth.userId,
      challenge: `\\x${challenge.toString("hex")}`,
      challenge_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    // 🔴 発行できなかったことを「発行した」と見せない。
    console.error("[guest/attest] challenge store failed");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  return NextResponse.json({ challenge: challenge.toString("base64") });
}

export async function POST(request: NextRequest) {
  const bad = forbiddenOrigin(request);
  if (bad) return bad;

  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.isAnonymous) {
    return NextResponse.json({ error: "not_guest" }, { status: 400 });
  }

  let body: { attestation?: unknown; keyId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const attestation = typeof body.attestation === "string" ? body.attestation : "";
  const keyId = typeof body.keyId === "string" ? body.keyId : "";
  if (!attestation || !keyId) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("toritavi_guest_grants")
    .select("challenge, challenge_at")
    .eq("user_id", auth.userId)
    .maybeSingle();

  // 🔴 読めなかったことを「チャレンジが無い」と混同しない。
  if (error) {
    console.error("[guest/attest] grant read failed");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const issuedAt = data?.challenge_at ? Date.parse(data.challenge_at) : NaN;
  const fresh = Number.isFinite(issuedAt) && Date.now() - issuedAt < CHALLENGE_TTL_MS;
  if (!data?.challenge || !fresh) {
    // 期限切れ・未発行。**新しいチャレンジを取り直させる。**
    return NextResponse.json({ error: "challenge_expired" }, { status: 409 });
  }

  // Postgres の bytea は `\xAABB…` の 16 進で返る。
  const hex = String(data.challenge).replace(/^\\x/, "");
  const challenge = Buffer.from(hex, "hex");

  const result = verifyAppAttest(
    { attestation, keyId, challenge },
    { allowDevelopment: ALLOW_DEV },
  );

  // 🔴 **成否にかかわらずチャレンジを捨てる（1 回限り）。**
  //    残すと、同じチャレンジで何度でも試せる。
  const patch: Record<string, unknown> = {
    user_id: auth.userId,
    challenge: null,
    challenge_at: null,
  };
  if (result.state === "attested") {
    patch.attested = true;
    patch.attested_at = new Date().toISOString();
    patch.public_key = result.publicKey ?? null;
    patch.key_hash = createHash("sha256").update(keyId).digest("hex");
    patch.environment = ALLOW_DEV ? "development" : "production";
  }
  const { error: upErr } = await svc
    .from("toritavi_guest_grants")
    .upsert(patch, { onConflict: "user_id" });
  if (upErr) {
    // 検証は通ったが記録できていない。**「通った」と返さない** ——
    // 返すと、アプリは 3 件使えるつもりで 1 件しか使えない。
    console.error("[guest/attest] grant write failed");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  if (result.state !== "attested") {
    // 🔴 理由を利用者へ返さない（何を直せば通るかを教えることになる）。
    console.error("[guest/attest] rejected:", result.reason);
    return NextResponse.json({ attested: false }, { status: 200 });
  }
  return NextResponse.json({ attested: true }, { status: 200 });
}
