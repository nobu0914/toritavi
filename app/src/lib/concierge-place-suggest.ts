/*
 * コンシェルジュの「場所の提案」（2026-09-29・段階 1）。
 *
 * 旅先で回れる観光地・食事の場所を、AI が**名前の候補として**挙げる。
 * アプリはそれを**端末の地図検索（Apple MapKit）で照合し、見つかったものだけ**
 * カードにして見せる。見つからなかったものは出さず、件数だけ伝える。
 *
 * ## 🔴 なぜ本文に書かせず、ツールで返させるのか
 *
 * AI は実在しない店・閉店した施設を平然と挙げる。コンシェルジュを 8 月に
 * 閉じた理由（実在しない URL）と同じ型。**本文に書かれた店名は検査できない。**
 * 構造化して返させれば、アプリが 1 件ずつ地図で確かめてから見せられる。
 * だから「場所を勧めるときはこのツールだけ」と縛る。
 *
 * ## 🔴 合図を送ったアプリにだけ効く
 *
 * アプリが `features: ["place_suggest"]` を送ったときだけ、このツールと指示を足す。
 * **公開中の 1.3.1 は送らないので、何も変わらない**（`ocr-prompt.ts` の
 * `booking_service` と同じ形）。アプリ側のスイッチは `kPlaceSuggestEnabled`。
 */

import type Anthropic from "@anthropic-ai/sdk";

export const PLACE_SUGGEST_FEATURE = "place_suggest";

/** 1 回の提案の上限。多いほど地図の照合が増え、画面も長くなる。 */
export const MAX_PLACES = 5;

const KINDS = ["観光", "食事", "買い物", "その他"] as const;
export type PlaceKind = (typeof KINDS)[number];

export function wantsPlaceSuggest(features: unknown): boolean {
  return Array.isArray(features) && features.includes(PLACE_SUGGEST_FEATURE);
}

export const SUGGEST_PLACES_TOOL: Anthropic.Tool = {
  name: "suggest_places",
  description:
    "旅先で立ち寄れる場所（観光地・食事・買い物）を候補として挙げます。" +
    "アプリが地図で実在を確かめ、見つかったものだけを利用者に見せます。",
  input_schema: {
    type: "object",
    properties: {
      journey_id: { type: "string", description: "どの旅程についての提案か（旅程データの id）" },
      date: { type: "string", description: "どの日の提案か YYYY-MM-DD（分からなければ省略）" },
      area: {
        type: "string",
        description: "地図で探す地域名（例: 札幌市中央区、京都市東山区）。泊まる場所や訪れる街",
      },
      places: {
        type: "array",
        maxItems: MAX_PLACES,
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "正式な施設名（地図で検索できる名前）。is_genre が true なら料理や店の種類（例: スープカレー）",
            },
            alt_names: {
              type: "array",
              maxItems: 3,
              items: { type: "string" },
              description: "通称・別名・英語名（例: 北海道庁旧本庁舎 → 赤れんが庁舎, Former Hokkaido Government Office）。地図は通称や英語で登録されていることがある",
            },
            is_genre: {
              type: "boolean",
              description: "true なら name は店名ではなく種類。アプリが地図で近くの実在の店を探す",
            },
            kind: { type: "string", enum: [...KINDS] },
            catch: {
              type: "string",
              description: "カードに出す短い見出し（24 字まで・例: 札幌の象徴、130年続く時計塔）。営業時間・料金・評価・「必ず」「一番」は書かない",
            },
            tags: {
              type: "array",
              maxItems: 3,
              items: { type: "string" },
              description: "短い目安のタグ（各 10 字まで・例: 見学 30分目安、屋内、雨でも可）。所要時間は必ず「目安」と書く。距離は書かない（アプリが地図で測る）",
            },
            reason: { type: "string", description: "なぜ勧めるか（1 文・営業時間や料金は書かない）" },
          },
          required: ["name", "kind", "reason"],
        },
      },
    },
    required: ["area", "places"],
  },
};

/**
 * 指示文に足す節。**合図があるときだけ。**
 *
 * 🔴 上の「特定のレストラン名などは推測で答えない」の**例外**として書く。
 *    例外の範囲は「ツールで返すこと」だけ —— 本文に店名を並べるのは引き続き禁止。
 */
export const PLACE_SUGGEST_PROMPT = `
## 場所の提案（suggest_places）

観光地・食事・買い物の場所を聞かれたら、**suggest_places ツールで候補を返してください。**
アプリが地図で実在を確かめ、見つかったものだけを利用者に見せます。

- 「旅程データに含まれない情報（特定のレストラン名など）は推測で答えない」の**例外はこのツールだけ**です。**本文に施設名を並べない。**
- 本文は 1〜2 文の前置きだけ（例: 「15 日の午後は予定が空いています。ホテルから回れる場所です。」）
- 旅程の空き時間・泊まる場所・移動手段を踏まえて、無理なく回れる場所を最大 ${MAX_PLACES} 件
- name は地図で検索できる**正式な施設名**。area は泊まる場所や訪れる街の地域名
- catch はカードの見出し（24 字まで）。tags は目安（所要時間は「〜目安」・屋内/屋外・雨でも可 など最大 3 つ）。**距離・営業時間・料金・評価は書かない**（距離はアプリが地図で測る）
- 通称や英語名があれば alt_names に入れる（地図は「赤れんが庁舎」のように通称で登録されていることがある）
- **店名に確信が無いとき（特に食事）は、店名を作らず is_genre: true で種類を返す**（例: name「スープカレー」）。アプリが地図で近くの実在の店を探す。「例えば〜」「〜周辺のレストラン」のような名前にしない
- 営業時間・料金・混雑は書かない（変わるため。アプリが「公式サイトで確認」と添える）
- 旅程の行き先が分からないときは、ツールを使わずにどの街かを尋ねる
`;

export type PlaceSuggestion = {
  journeyId: string | null;
  date: string | null;
  area: string;
  /** isGenre: name は店名ではなく種類（地図で近くの店を探す） */
  places: {
    name: string;
    altNames: string[];
    kind: PlaceKind;
    reason: string;
    isGenre: boolean;
    /** カードの見出し（AI が書く・事実を言い切らない） */
    catchCopy: string;
    /** 目安のタグ（最大 3） */
    tags: string[];
  }[];
};

function clip(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * ツールの入力を**そのまま信じない。** 件数・長さ・種別・日付の形を締め、
 * 旅程 id は利用者の旅程に含まれるものだけ通す（AI が作った id を渡さない）。
 * 使えるものが 1 件も無ければ null。
 */
export function sanitizePlaceSuggestion(
  input: Record<string, unknown>,
  knownJourneyIds: string[],
): PlaceSuggestion | null {
  const area = clip(input.area, 40);
  if (!area) return null;
  const raw = Array.isArray(input.places) ? input.places : [];
  const places: PlaceSuggestion["places"] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const name = clip(o.name, 60);
    if (!name) continue;
    const kind = (KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as PlaceKind) : "その他";
    const altNames = (Array.isArray(o.alt_names) ? o.alt_names : [])
      .map((a) => clip(a, 60))
      .filter((a) => a && a !== name)
      .slice(0, 3);
    // 🔴 タグに距離・時間の断定が混ざったら落とす（距離はアプリが測る。
    //    所要時間は「目安」付きだけ通す）。
    const tags = (Array.isArray(o.tags) ? o.tags : [])
      .map((t) => clip(t, 10))
      .filter((t) => t && !/徒歩|車で|km|ｋｍ|メートル|分で着/.test(t))
      .filter((t) => !/\d+\s*(分|時間)/.test(t) || /目安/.test(t))
      .slice(0, 3);
    places.push({
      name,
      altNames,
      kind,
      reason: clip(o.reason, 120),
      isGenre: o.is_genre === true,
      catchCopy: clip(o.catch, 24),
      tags,
    });
    if (places.length >= MAX_PLACES) break;
  }
  if (places.length === 0) return null;
  const jid = clip(input.journey_id, 80);
  const date = clip(input.date, 10);
  return {
    journeyId: knownJourneyIds.includes(jid) ? jid : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    area,
    places,
  };
}
