// コンシェルジュの場所の提案（2026-09-29・段階 1）。
//
// 🔴 固定すること:
//    - 合図（features: ["place_suggest"]）を送った版にだけ効く。公開中の版は変わらない
//    - AI のツール入力をそのまま信じない（件数・長さ・種別・日付・旅程 id）
//    - 「店名は本文に書かず、ツールで返す」と指示している（地図で確かめるため）
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  MAX_PLACES,
  PLACE_SUGGEST_PROMPT,
  sanitizePlaceSuggestion,
  wantsPlaceSuggest,
} from "../concierge-place-suggest.ts";

test("🔴 合図が無ければ効かない（公開中の版は features を送らない）", () => {
  assert.equal(wantsPlaceSuggest(undefined), false);
  assert.equal(wantsPlaceSuggest([]), false);
  assert.equal(wantsPlaceSuggest("place_suggest"), false, "配列でなければ効かない");
  assert.equal(wantsPlaceSuggest(["booking_service"]), false);
  assert.equal(wantsPlaceSuggest(["place_suggest"]), true);
});

test("🔴 ツール入力を締める: 件数・長さ・種別・日付・旅程 id", () => {
  const out = sanitizePlaceSuggestion(
    {
      journey_id: "made-up-by-ai",
      date: "11/15",
      area: "札幌市中央区",
      places: [
        ...Array.from({ length: 8 }, (_, i) => ({ name: `場所${i}`, kind: "観光", reason: "近い" })),
      ],
    },
    ["j1"],
  );
  assert.ok(out);
  assert.equal(out.places.length, MAX_PLACES);
  assert.equal(out.journeyId, null, "利用者の旅程に無い id を通した");
  assert.equal(out.date, null, "形の違う日付を通した");

  const ok = sanitizePlaceSuggestion(
    { journey_id: "j1", date: "2026-11-15", area: "札幌", places: [{ name: "x".repeat(200), kind: "謎", reason: "r" }] },
    ["j1"],
  );
  assert.ok(ok);
  assert.equal(ok.journeyId, "j1");
  assert.equal(ok.date, "2026-11-15");
  assert.equal(ok.places[0].name.length, 60);
  assert.equal(ok.places[0].kind, "その他", "知らない種別をそのまま通した");
});

test("使える候補が無ければ null（空のカードを出させない）", () => {
  assert.equal(sanitizePlaceSuggestion({ area: "札幌", places: [] }, []), null);
  assert.equal(sanitizePlaceSuggestion({ area: "", places: [{ name: "a", kind: "観光", reason: "" }] }, []), null);
  assert.equal(sanitizePlaceSuggestion({ area: "札幌", places: [{ name: "  ", kind: "観光" }] }, []), null);
});

test("🔴 指示: 店名は本文に書かず、ツールで返す／営業時間・料金を書かない", () => {
  assert.match(PLACE_SUGGEST_PROMPT, /本文に施設名を並べない/);
  assert.match(PLACE_SUGGEST_PROMPT, /営業時間・料金・混雑は書かない/);
});

test("🔴 route: 合図のあるときだけツールと指示を足し、結果を締めてから返す", () => {
  const src = readFileSync(new URL("../../app/api/concierge/route.ts", import.meta.url), "utf8");
  assert.match(src, /const placeSuggest = wantsPlaceSuggest\(body\.features\)/);
  assert.match(src, /\(placeSuggest \? PLACE_SUGGEST_PROMPT : ""\)/);
  assert.match(src, /tools: placeSuggest \? \[ADD_STEP_TOOL, SUGGEST_PLACES_TOOL\] : \[ADD_STEP_TOOL\]/);
  assert.match(src, /sanitizePlaceSuggestion\(toolUse\.input, context\.includedJourneyIds\)/);
});

test("店名に確信が無いときは種類で返させる（店名を作らせない）", () => {
  assert.match(PLACE_SUGGEST_PROMPT, /店名を作らず is_genre: true/);
  const out = sanitizePlaceSuggestion(
    { area: "札幌駅周辺", places: [{ name: "スープカレー", kind: "食事", reason: "名物", is_genre: true }, { name: "札幌時計台", kind: "観光", reason: "近い", is_genre: "yes" }] },
    [],
  );
  assert.ok(out);
  assert.equal(out.places[0].isGenre, true);
  assert.equal(out.places[1].isGenre, false, "真偽値でないものを種類扱いにした");
});
