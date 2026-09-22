/**
 * AI の出力に混ざるリンクを、**許可した宛先だけに絞る。**
 *
 * ## なぜ要るか —— これがコンシェルジュを降ろした理由そのもの
 *
 * 2026-08-01 に画面ごと削除し、2026-08-14 にフラグを閉じた理由が
 * **「AI が実在しない URL を出しうるのに誰も検査していない」**だった
 * （`toritavi_app/docs/feature-flags.md` §1.4）。
 *
 * 🔴 **プロンプトに「実在する公式サイトのURLのみ。不確かなら出さない」と
 * 書いてあるが、それは指示であって担保ではない。**
 * `info_ai_service.dart` のプロンプトが実際にそう書いていて、
 * それでも「担保が無い」と判定されていた。
 *
 * ## 何を保証するか
 *
 * **出ていく文字列の中に、許可した宛先以外の URL が残らない。**
 * 実在するかまでは保証しない（到達確認はしない）が、
 * **「行政・公的機関のドメイン以外へは送らない」**は保証できる。
 *
 * 🔴 **フェイルクローズ。** 判定できない形（壊れた URL・IP 直打ち・
 * 見慣れない TLD）は**すべて落とす。**
 *
 * ## 足すときの約束
 *
 * 🔴 **1 件ずつ、理由を添えて足す。** ここを緩めると、降ろした理由が
 * そのまま戻る。「たぶん公式」で足さない。
 */
import "server-only";

/**
 * 許可する**末尾一致**のドメイン。
 *
 * 🔴 **行政・公的機関に限る。** 商用サイト（航空会社・ホテル・予約）は
 * 入れない —— `travel-info-safety.md` が求めるのは一次情報であって、
 * 便利なリンクではない。
 */
export const ALLOWED_HOST_SUFFIXES: readonly string[] = [
  // 日本の行政
  ".go.jp",
  ".lg.jp",
  // 英語圏の行政
  ".gov",
  ".gov.uk",
  ".gc.ca",
  ".canada.ca",
  ".gov.au",
  ".govt.nz",
  // 国際機関
  ".who.int",
  ".icao.int",
  ".un.org",
  // 🔴 **これ以上を足すときは、1 件ずつ理由を書くこと。**
];

/** 完全一致で許すホスト（末尾一致では広すぎるもの）。 */
export const ALLOWED_HOSTS: readonly string[] = [
  "www.mofa.go.jp",
  "www.jma.go.jp",
];

/**
 * その URL を出してよいか。
 *
 * 🔴 **`https` だけ。** `http` は中身を書き換えられる経路で、
 * 公的機関の一次情報という前提が崩れる。
 */
export function isAllowedUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false; // 壊れている → 落とす
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  // IP 直打ちは落とす（ドメインの判定が効かない）。
  if (/^[\d.]+$/.test(host) || host.includes(":")) return false;
  if (ALLOWED_HOSTS.includes(host)) return true;
  return ALLOWED_HOST_SUFFIXES.some(
    (suf) => host === suf.slice(1) || host.endsWith(suf),
  );
}

/** 文章から拾う URL。マークダウンのリンクも素の URL も拾う。 */
const URL_RE = /https?:\/\/[^\s<>()[\]{}"'`、。，．]+/gi;

export type StripResult = {
  /** 落としたあとの文章。 */
  text: string;
  /** 落とした URL（ログ用。**利用者へは返さない**）。 */
  removed: string[];
};

/**
 * 許可していない URL を文章から落とす。
 *
 * 🔴 **消すのではなく、**リンクだったことが分かる形に置き換える。**
 * 黙って消すと、文が「こちらをご覧ください」で終わって意味が壊れる。
 *
 * マークダウン `[表示文](url)` は**表示文だけ残す** —— 文の流れが保たれる。
 */
export function stripDisallowedUrls(input: string): StripResult {
  const removed: string[] = [];

  // 1) マークダウンのリンク: 許可外なら表示文だけ残す
  let out = input.replace(
    /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi,
    (whole, label: string, url: string) => {
      if (isAllowedUrl(url)) return whole;
      removed.push(url);
      return label;
    },
  );

  // 2) 素の URL: 許可外なら印に置き換える
  out = out.replace(URL_RE, (url: string) => {
    // 末尾の句読点を巻き込まないよう軽く削る。
    const trimmed = url.replace(/[.,;:)]+$/, "");
    if (isAllowedUrl(trimmed)) return url;
    removed.push(trimmed);
    return url.slice(trimmed.length); // 巻き込んだ句読点だけ残す
  });

  return { text: out, removed };
}
