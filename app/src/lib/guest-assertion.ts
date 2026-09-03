/**
 * App Attest の **assertion**（要求ごとの署名）を検証する。
 *
 * ## `attestation` との違い
 *
 * | | 何を示すか | いつ |
 * |---|---|---|
 * | attestation | このアプリ・この端末が本物か | **一度だけ**（起動時） |
 * | **assertion** | **その 1 要求が本物か** | 要求ごと |
 *
 * 2026-08-31 の外部レビュー P1（`toritavi_app/docs/guest-mode-spec.md` §23）——
 * 「**assertion を要求ごとに検証していない。保存した公開鍵が使われていない**」。
 * 保存だけして使っていなかった `public_key` を、ここで初めて使う。
 *
 * ## 🔴 署名の検証だけでは足りない
 *
 * 正しい署名の**古い 1 通**を使い回せる（再生攻撃）。assertion には
 * **単調増加のカウンタ**（`signCount`）が入っているので、
 * **保存して前回値と比べる**。同値も拒む —— 同じ値は同じ署名を意味する。
 *
 * 置き場所は `toritavi_guest_grants.assert_counter`（2026-09-03 に追加）。
 * **NULL は「まだ一度も検証していない」**で、0 とは違う。
 *
 * ## 何に署名させるか
 *
 * **その要求の `requestId`（UUID）**。要求ごとに違い、サーバも知っている値。
 * これで assertion が**その 1 件に縛られる** —— 別の要求へ付け替えられない。
 * 追加の往復も要らない。
 */
import { verifyAssertion } from "node-app-attest";

import { APP_BUNDLE_ID } from "./attest.ts";

export type AssertionResult =
  | { ok: true; counter: number }
  | {
      ok: false;
      reason:
        | "no_public_key"
        | "no_team_id"
        | "verify_failed"
        | "counter_not_advanced";
    };

/**
 * カウンタを受理してよいか。**純粋関数。**
 *
 * - `previous === null` … まだ一度も検証していない。**最初の 1 通は受ける**
 * - それ以外 … **厳密に増えているときだけ**受ける（同値は再生）
 *
 * 🔴 **`>=` にしない。** 同じカウンタは同じ assertion を意味するので、
 * 通すと「1 通を無限に使い回す」がそのまま成立する。
 */
export function acceptAssertionCounter(
  previous: number | null | undefined,
  incoming: number,
): boolean {
  if (!Number.isInteger(incoming) || incoming < 0) return false;
  if (previous === null || previous === undefined) return true;
  return incoming > previous;
}

/**
 * 検証する。**投げない。**
 *
 * [payload] は署名の対象そのもの（この実装では `requestId`）。
 * ライブラリが内部で SHA-256 を取るので、**こちらでハッシュしない** ——
 * 端末側（`AppAttestChannel.swift`）が `SHA256(payload)` を
 * `clientDataHash` として署名しているので、これで揃う。
 */
export function verifyGuestAssertion(input: {
  assertion: string;
  payload: string;
  publicKey: string | null | undefined;
  previousCounter: number | null | undefined;
  teamId?: string;
  bundleId?: string;
}): AssertionResult {
  const teamId = input.teamId ?? process.env.APPLE_TEAM_ID;
  if (!teamId) return { ok: false, reason: "no_team_id" };

  // 🔴 **公開鍵が無いなら通さない。** attestation を通していない相手なので、
  //    「検証できなかった」ではなく「資格が無い」。
  if (!input.publicKey) return { ok: false, reason: "no_public_key" };

  let signCount: number;
  try {
    const r = verifyAssertion({
      assertion: Buffer.from(input.assertion, "base64"),
      payload: input.payload,
      publicKey: input.publicKey,
      bundleIdentifier: input.bundleId ?? APP_BUNDLE_ID,
      teamIdentifier: teamId,
      signCount: input.previousCounter ?? 0,
    }) as { signCount: number };
    signCount = Number(r.signCount);
  } catch {
    // 🔴 例外の中身を返さない（内部構造が漏れる）。
    return { ok: false, reason: "verify_failed" };
  }

  if (!acceptAssertionCounter(input.previousCounter, signCount)) {
    return { ok: false, reason: "counter_not_advanced" };
  }
  return { ok: true, counter: signCount };
}
