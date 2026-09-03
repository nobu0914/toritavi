/**
 * App Attest —— **この要求が、改造されていない本物の JUNROS から来たか。**
 *
 * DeviceCheck（端末の 2 bit）と役割が違う:
 *   App Attest  … 偽クライアントを排除する
 *   DeviceCheck … 「1 台 3 件」を数える
 * **両方要る。** 片方だけだと、偽クライアントが 2 bit ごと偽装できる
 * （`toritavi_app/docs/guest-mode-spec.md` §11）。
 *
 * ## 検証は `node-app-attest` に任せる
 *
 * Apple の 9 手順（証明書の鎖・nonce・keyId・App ID ハッシュ・counter・
 * aaguid・credentialId）を実装済みであることを**中身を読んで確かめてから**
 * 採用した（2026-08-31）。純 JS のみで、ネイティブ依存が無い ——
 * `CLAUDE.md` §6 の「手元にあって本番に無い依存」を踏まない形。
 * **バージョンは 1.0.1 に固定**（security の依存を暗黙に上げない）。
 *
 * ## 🔴 証明書の有効期限は見ない（意図的）
 *
 * Apple の手順に無い。使い回しは**チャレンジの新鮮さ**で防ぐのが本筋で、
 * 期限を足すと時計のずれで**正当な端末を落とす** —— 守りが増えないのに
 * 偽陰性だけ増える。
 *
 * ## 🔴 例外を外へ出さない
 *
 * 返すのは `GuestAttestState` だけ。**判定できなければ必ず `failed`**（＝1 件）。
 * 「検証したつもりで通す」経路を 1 つも作らない（`CLAUDE.md` §5）。
 */
import { verifyAttestation } from "node-app-attest";

import type { GuestAttestState } from "./guest-quota.ts";

/** 本番のバンドル ID。**env で差し替えない** —— 差し替えられると検証が骨抜き。 */
export const APP_BUNDLE_ID = "com.toritavi.app";

export type AttestInput = {
  /** base64 の attestation object（CBOR）。 */
  attestation: string;
  /** アプリが `DCAppAttestService.generateKey()` で得た keyId（base64）。 */
  keyId: string;
  /** サーバが発行したチャレンジ（生バイト）。 */
  challenge: Buffer;
};

export type AttestOutcome = {
  state: GuestAttestState;
  /** 通ったときだけ。以後の assertion 検証に使う公開鍵（PEM）。 */
  publicKey?: string;
  /** 落ちた理由。**ログ用**（利用者には出さない）。 */
  reason?: string;
  /**
   * 🔴 **検証が返した実際の環境**（`development` / `production`）。
   *
   * 2026-09-03 まで、この値は捨てられていた。呼び出し側は代わりに
   * **設定（`APPLE_APPATTEST_ALLOW_DEV`）から書いていた** ——
   * つまり「何だったか」ではなく「何を許したか」を記録していた。
   * 2026-08-31 の外部レビュー P1（`docs/guest-mode-spec.md` §23）。
   *
   * `allowDevelopment: true` のときは development も production も
   * 通るので、**設定からは実際の環境を復元できない。**
   */
  environment?: string;
};

/**
 * 検証する。**投げない。**
 *
 * `allowDevelopment` は開発ビルド（Xcode から入れた実機・TestFlight 以外）の
 * attestation を受けるか。**本番では false。** true のままだと、
 * 開発証明書で署名した改造アプリを受け入れる。
 */
export function verifyAppAttest(
  input: AttestInput,
  opts: {
    teamId?: string;
    bundleId?: string;
    allowDevelopment?: boolean;
  } = {},
): AttestOutcome {
  const teamId = opts.teamId ?? process.env.APPLE_TEAM_ID;
  const bundleId = opts.bundleId ?? APP_BUNDLE_ID;
  if (!teamId) return { state: "failed", reason: "no_team_id" };

  try {
    const r = verifyAttestation({
      attestation: Buffer.from(input.attestation, "base64"),
      challenge: input.challenge,
      keyId: input.keyId,
      bundleIdentifier: bundleId,
      teamIdentifier: teamId,
      allowDevelopmentEnvironment: opts.allowDevelopment === true,
    }) as { publicKey: string; environment: string };
    // 🔴 **`environment` を捨てない。** 呼び出し側が設定から書くと、
    //    development の grant が production として残りうる（逆も）。
    return { state: "attested", publicKey: r.publicKey, environment: r.environment };
  } catch (e) {
    // 🔴 メッセージをそのまま利用者へ返さない（内部構造が漏れる）。
    //    ログにも残すのは短い理由だけ。
    return { state: "failed", reason: (e as Error)?.message?.slice(0, 80) };
  }
}
