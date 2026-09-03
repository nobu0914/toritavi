/**
 * Apple DeviceCheck —— **端末ごとの 2 bit**（再インストールで消えない）。
 *
 * ゲスト（未登録）の「1 台 3 件」を守る唯一の永続的な担保。匿名ユーザーは
 * 無限に作れ、アプリを消して入れ直せば新しい匿名 user_id が手に入る。
 * この 2 bit は **Apple 側**に残るので、そこだけがリセットされない。
 *
 *   2 bit = 4 状態 = 「使った件数 0 / 1 / 2 / 3」にちょうど収まる。
 *
 * 設計は `toritavi_app/docs/guest-mode-spec.md` §11、
 * 濫用対策の全体像は `docs/ocr-abuse-design-2026-08-22.md` §5-1。
 *
 * ## 前提（人が設定する。リポジトリに痕跡が残らない）
 *
 *   APPLE_TEAM_ID              例 Z9JSJ5624G
 *   APPLE_DEVICECHECK_KEY_ID   例 2CVULLRNQY
 *   APPLE_DEVICECHECK_P8       -----BEGIN PRIVATE KEY----- から END まで
 *
 * ## 🔴 秘密を出さない
 *
 * **例外も応答本文もそのままログに出さない。** 鍵の断片や端末トークンが
 * 残りうる。出すのは型と HTTP の状態だけ（`CLAUDE.md` §5）。
 */
import { createPrivateKey, createSign, randomUUID } from "node:crypto";

/**
 * この機能が要る env だけを型にする。**`DeviceCheckEnv` を要求しない** ——
 * 検査で偽の env を渡すたびにキャストが要り、キャストは型の嘘になる。
 * `process.env` はこの型に代入できる。
 */
export type DeviceCheckEnv = {
  APPLE_TEAM_ID?: string;
  APPLE_DEVICECHECK_KEY_ID?: string;
  APPLE_DEVICECHECK_P8?: string;
  APPLE_DEVICECHECK_ENV?: string;
  // 索引を持たせないと `process.env` を渡せない（全部省略可の型は
  // TypeScript の weak type 判定で「共通の性質が無い」と拒否される）。
  [key: string]: string | undefined;
};

/** 2 bit の意味。**ゲストが使った件数**（0〜3）。 */
export type GuestUsed = 0 | 1 | 2 | 3;

/** Apple へ届かなかった／設定が無い、を件数と区別する。 */
export type DeviceCheckResult =
  | { ok: true; used: GuestUsed; known: boolean }
  | { ok: false; reason: "not_configured" | "unauthorized" | "unavailable" };

/**
 * 2 bit ⇄ 件数。**ここだけが対応表**（散らすと片方だけ直る）。
 * bit0 が下位、bit1 が上位。
 */
export function bitsToUsed(bit0: boolean, bit1: boolean): GuestUsed {
  return ((bit1 ? 2 : 0) + (bit0 ? 1 : 0)) as GuestUsed;
}

export function usedToBits(used: GuestUsed): { bit0: boolean; bit1: boolean } {
  return { bit0: (used & 1) === 1, bit1: (used & 2) === 2 };
}

/**
 * Apple の「この端末の記録が無い」応答か。**純粋関数。**
 *
 * 200 + 本文 `Failed to find bit state` が**初回の正常な姿**。
 *
 * 🔴 **これ以外の 200 を初回と同じに扱わない。** 以前は「JSON でなければ
 * 全部 `used: 0`」だったので、空の本文・中継が返した HTML・欠けた JSON が
 * **すべて「1 件も使っていない」に化けた。** 枠はこの応答だけで決まるので、
 * 設定ミスがそのまま**無料枠の復活**になる（2026-09-04 の外部監査）。
 *
 * 大小と前後の空白は無視する（Apple 側の表記揺れで閉じすぎないため）。
 * **迷ったら閉じる側**——呼び出し元は「聞けなかった」として拒否する。
 */
export function isBitStateNotFound(body: string): boolean {
  return body.trim().toLowerCase().includes("failed to find bit state");
}

/** 設定が揃っているか。**揃っていないことを「0 件使用」と混同しない。** */
export function deviceCheckConfigured(env: DeviceCheckEnv = process.env): boolean {
  return Boolean(
    env.APPLE_TEAM_ID && env.APPLE_DEVICECHECK_KEY_ID && env.APPLE_DEVICECHECK_P8,
  );
}

function b64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Apple へ出す ES256 の JWT。**署名は毎回作る**（有効期間が短い）。
 *
 * `nowSec` を引数にしているのは検査のため。**本番では省略する。**
 */
export function deviceCheckJwt(
  env: DeviceCheckEnv = process.env,
  nowSec: number = Math.floor(Date.now() / 1000),
): string {
  const teamId = env.APPLE_TEAM_ID;
  const keyId = env.APPLE_DEVICECHECK_KEY_ID;
  const p8 = env.APPLE_DEVICECHECK_P8;
  if (!teamId || !keyId || !p8) throw new Error("devicecheck not configured");

  const header = { alg: "ES256", kid: keyId };
  const payload = { iss: teamId, iat: nowSec };
  const signingInput =
    b64url(Buffer.from(JSON.stringify(header))) +
    "." +
    b64url(Buffer.from(JSON.stringify(payload)));

  // Vercel の env は改行をそのまま保持できるが、貼り方によっては
  // `\n` が literal になる。**両方を受ける**（これで落ちると原因が分かりにくい）。
  const pem = p8.includes("\\n") ? p8.replace(/\\n/g, "\n") : p8;
  const key = createPrivateKey(pem);
  const sig = createSign("SHA256").update(signingInput).sign({
    key,
    dsaEncoding: "ieee-p1363", // ES256 は raw r||s。DER のままだと Apple が弾く
  });
  return `${signingInput}.${b64url(sig)}`;
}

const PROD = "https://api.devicecheck.apple.com/v1";
const DEV = "https://api.development.devicecheck.apple.com/v1";

/** 本番の API を使うか。`APPLE_DEVICECHECK_ENV=development` で開発側へ。 */
function baseUrl(env: DeviceCheckEnv = process.env): string {
  return env.APPLE_DEVICECHECK_ENV === "development" ? DEV : PROD;
}

type Fetcher = typeof fetch;

/**
 * この端末がゲスト枠を何件使ったかを読む。
 *
 * **未登録の端末は Apple が「見つからない」を返す。** それは「0 件」であって
 * 異常ではない（`known: false`）。**そこを取り違えると初回利用者を弾く。**
 */
export async function queryGuestUsed(
  deviceToken: string,
  opts: { env?: DeviceCheckEnv; fetchImpl?: Fetcher; timeoutMs?: number } = {},
): Promise<DeviceCheckResult> {
  const env = opts.env ?? process.env;
  if (!deviceCheckConfigured(env)) return { ok: false, reason: "not_configured" };
  const f = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await f(`${baseUrl(env)}/query_two_bits`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceCheckJwt(env)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        device_token: deviceToken,
        transaction_id: randomUUID(),
        timestamp: Date.now(),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 4000),
    });
  } catch (e) {
    // 🔴 本文も例外もそのまま出さない。型だけ。
    console.error("[devicecheck] query failed:", (e as Error)?.name);
    return { ok: false, reason: "unavailable" };
  }

  if (res.status === 401 || res.status === 403) {
    // 鍵・Team ID の設定ミス。**「使っていない」に化けさせない。**
    console.error("[devicecheck] query unauthorized:", res.status);
    return { ok: false, reason: "unauthorized" };
  }

  // Apple は「その端末の記録が無い」を 200 + 本文 "Failed to find bit state"
  // で返す。**これは初回の正常な姿。**
  //
  // 🔴 **それ以外の 200 を初回と同じに扱わない**（`isBitStateNotFound`）。
  let text = "";
  try {
    text = await res.text();
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (res.ok) {
    try {
      const j = JSON.parse(text) as { bit0?: boolean; bit1?: boolean };
      if (typeof j.bit0 === "boolean" && typeof j.bit1 === "boolean") {
        return { ok: true, used: bitsToUsed(j.bit0, j.bit1), known: true };
      }
    } catch {
      // JSON でない。**下で「記録が無い」の印を確かめる。**
    }

    // 🔴 **「記録が無い」だけを初回として扱う**（2026-09-04 の外部監査）。
    //
    //    ここは以前、**200 で JSON でなければ何でも** `used: 0, known: false`
    //    を返していた。つまり —— 空の本文／中継（プロキシ・WAF）が返した
    //    HTML／フィールドの欠けた JSON／将来 Apple が形を変えたとき ——
    //    が**すべて「この端末は 1 件も使っていない」に化ける。**
    //
    //    枠はこの応答だけで決まるので、**設定ミスや中継の異常が
    //    そのまま無料枠の復活になる。** 落ちも警告も出ない
    //    （`CLAUDE.md` §6-1）。**印を確かめて、無ければ閉じる。**
    if (isBitStateNotFound(text)) {
      return { ok: true, used: 0, known: false };
    }
    console.error(
      "[devicecheck] unexpected 200 body; treating as unavailable:",
      `len=${text.length}`,
    );
    return { ok: false, reason: "unavailable" };
  }

  console.error("[devicecheck] query http:", res.status);
  return { ok: false, reason: "unavailable" };
}

/** 使った件数を書き戻す。**成功したかを返す（黙って失敗しない）。** */
export async function setGuestUsed(
  deviceToken: string,
  used: GuestUsed,
  opts: { env?: DeviceCheckEnv; fetchImpl?: Fetcher; timeoutMs?: number } = {},
): Promise<boolean> {
  const env = opts.env ?? process.env;
  if (!deviceCheckConfigured(env)) return false;
  const f = opts.fetchImpl ?? fetch;
  const { bit0, bit1 } = usedToBits(used);

  try {
    const res = await f(`${baseUrl(env)}/update_two_bits`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceCheckJwt(env)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        device_token: deviceToken,
        transaction_id: randomUUID(),
        timestamp: Date.now(),
        bit0,
        bit1,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 4000),
    });
    if (!res.ok) console.error("[devicecheck] update http:", res.status);
    return res.ok;
  } catch (e) {
    console.error("[devicecheck] update failed:", (e as Error)?.name);
    return false;
  }
}
