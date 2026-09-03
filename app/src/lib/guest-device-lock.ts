/**
 * ゲストの読み取りを、**端末ごとに 1 本ずつ**に並べる。
 *
 * ## 何を防ぐか（2026-09-04 の外部監査・P0）
 *
 * 「生涯 3 件」は DeviceCheck の 2 bit で数えるが、手順が
 *
 *     ① Apple に聞く（used を読む）
 *     ② ファイル検証・トークン計測・DB 予約
 *     ③ Apple に書く（used + n）
 *
 * と**離れている**。使用数 0 の端末から 1 ページの要求を 3 本同時に出すと、
 * **3 本とも 0 を読み**、3 本とも通り、最後に全部が 1 を書く。
 * 「3 件使ったのに DeviceCheck は 1」になり、匿名 ID を作り直して繰り返せる。
 *
 * 🔴 **Apple の API は「取得」と「設定」だけ。** 加算も比較交換も無いので、
 * こちら側で並べるしかない。
 *
 * ## 何で並べるか
 *
 * **`key_hash`（App Attest の鍵の指紋）。** 鍵は Keychain にあるので
 * アプリを消しても残り、**同じ端末なら匿名 ID をまたいで同じ値**になる。
 *
 * 端末トークンは要求ごとに変わるので使えない。匿名 `user_id` は作り直せる
 * ので、またいで並べられない。**残るのはこれだけ。**
 *
 * ## 🔴 未検証の端末は並べない
 *
 * `key_hash` を持つのは attestation を通した端末だけ。持たない端末の上限は
 * **1 件**なので、抜けても「同時実行数 × 1 件」に収まる。
 * **守るのは検証済み（3 件）の端末。**
 *
 * ## 取れなかったときは断る
 *
 * 429 を返す。**通してはいけない** —— 通すと、この仕組みが何もしないのと
 * 同じになる。正規の利用者が同じ端末で 2 本同時に投げることは、
 * アプリの作りでは起きない（読み取りは 1 画面 1 本）。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 鍵を握れる時間（秒）。
 *
 * 🔴 **要求より長く、しかし長すぎない。** 短いと処理中に別の要求が
 * 入り込む。長いと、落ちた要求がその端末を締め出す時間が延びる。
 * `maxDuration` と同じ 60 秒にしてある。
 */
const LOCK_TTL_SEC = 60;

export type DeviceLock =
  | { held: true; keyHash: string }
  /** 別の要求が実行中。**通さない。** */
  | { held: false; reason: "busy" }
  /** 並べられない（鍵が無い／DB が応えない）。判断は呼び出し側。 */
  | { held: false; reason: "no_key" | "unavailable" };

/**
 * 鍵を取る。**投げない。**
 *
 * `keyHash` が無いときは `no_key` を返す。**エラーではない** ——
 * 未検証の端末は上限 1 件なので、並べなくても被害が限られる。
 */
export async function claimGuestDevice(
  admin: SupabaseClient,
  keyHash: string | null | undefined,
): Promise<DeviceLock> {
  if (!keyHash) return { held: false, reason: "no_key" };
  try {
    const { data, error } = await admin.rpc("toritavi_guest_device_claim", {
      p_key_hash: keyHash,
      p_ttl_sec: LOCK_TTL_SEC,
    });
    if (error) {
      // 🔴 **黙らせない。** 関数が無い（DDL 未適用）のか、権限が無いのかが
      //    分からないと、「並んでいるつもりで並んでいない」に気づけない
      //    （`CLAUDE.md` §6-1）。
      console.error("[guest-lock] claim failed:", error.message);
      return { held: false, reason: "unavailable" };
    }
    // 取れなければ `null`（`returning` が 0 行）。
    return data === true
      ? { held: true, keyHash }
      : { held: false, reason: "busy" };
  } catch (e) {
    console.error("[guest-lock] claim threw:", (e as Error)?.name);
    return { held: false, reason: "unavailable" };
  }
}

/**
 * 鍵を返す。**失敗しても何もしない。**
 *
 * 消し忘れても TTL で開くので、ここで止める価値が無い。
 * 逆にここで例外を投げると、**成功した読み取りが失敗として返る。**
 */
export async function releaseGuestDevice(
  admin: SupabaseClient,
  lock: DeviceLock,
): Promise<void> {
  if (!lock.held) return;
  try {
    const { error } = await admin.rpc("toritavi_guest_device_release", {
      p_key_hash: lock.keyHash,
    });
    if (error) console.warn("[guest-lock] release failed:", error.message);
  } catch (e) {
    console.warn("[guest-lock] release threw:", (e as Error)?.name);
  }
}
