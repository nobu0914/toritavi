/**
 * JUNROS — メール転送の受け口（Cloudflare Email Worker）。
 *
 * `trips-<トークン>@junros.com` に届いたメールを、生の MIME のまま
 * 署名を付けて `/api/inbound-mail`（Vercel）へ渡すだけ。
 * 設計: `toritavi_app/docs/mail-import-design.md` §11。手順は README.md。
 *
 * ## 🔴 ここでは何も解かない・何も残さない
 *
 * - 無料プランは CPU 10 ms。MIME を解かず、本文をハッシュしない
 * - R2・KV・D1 を使わない（**従量課金になるものに触れない**・§3 の利用者の決定）
 * - 宛先・送信元・件名をログに出さない（氏名・予約番号が入る）
 * - 返信しない・転送しない（迷惑メールの踏み台にならない）
 */
import { shouldAccept, signInbound, upstreamOutcome } from "./lib";

/** Email Routing が渡すメッセージのうち、使う部分だけ。 */
interface InboundEmail {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
}

interface Env {
  /** `npx wrangler secret put INBOUND_MAIL_SECRET`（Vercel と同じ値）。 */
  INBOUND_MAIL_SECRET?: string;
  /** wrangler.toml の [vars]。 */
  INBOUND_MAIL_URL?: string;
  MAIL_IMPORT_DOMAIN?: string;
}

const worker = {
  async email(message: InboundEmail, env: Env): Promise<void> {
    const domain = env.MAIL_IMPORT_DOMAIN || "junros.com";

    // ① 宛先と大きさ。合わなければ**恒久エラーで拒否**（送信者に差し戻る）。
    //    ここで差し戻すのは「形が違う」ものだけ。形が合っていて存在しない
    //    トークンはサーバが 200 で黙って捨てる —— 存在を外から探れないように。
    const verdict = shouldAccept(message.to, message.rawSize, domain);
    if (verdict === "too_large") {
      message.setReject("Message too large");
      return;
    }
    if (verdict !== "ok") {
      message.setReject("Unknown recipient");
      return;
    }

    // ② 設定漏れは**一時エラー**（例外）。捨てずに再送させる。
    if (!env.INBOUND_MAIL_SECRET || !env.INBOUND_MAIL_URL) {
      throw new Error("inbound-mail: not configured");
    }

    // ③ 生の MIME を読み、長さと宛先・送信元に署名して渡す。
    const raw = await new Response(message.raw).arrayBuffer();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await signInbound(
      env.INBOUND_MAIL_SECRET,
      timestamp,
      message.to,
      message.from,
      raw.byteLength,
    );

    let res: Response;
    try {
      res = await fetch(env.INBOUND_MAIL_URL, {
        method: "POST",
        headers: {
          "content-type": "message/rfc822",
          "x-junros-timestamp": timestamp,
          "x-junros-to": message.to,
          "x-junros-from": message.from,
          "x-junros-signature": signature,
        },
        body: raw,
      });
    } catch {
      // 🔴 通信できない → 一時エラー。送信側が再送する。
      throw new Error("inbound-mail: upstream unreachable");
    }

    if (upstreamOutcome(res.status) === "retry") {
      // 状態コードだけを残す（宛先・送信元は出さない）。
      console.warn(`inbound-mail: upstream status ${res.status}`);
      throw new Error(`inbound-mail: upstream ${res.status}`);
    }
  },
};

export default worker;
