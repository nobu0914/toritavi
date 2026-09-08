// ============================================================================
// 🔴 **退会で消す表の台帳が、黙って痩せないこと**（JR000213）。
//
// 大半の表は `auth.users` への `ON DELETE CASCADE` で自動的に消える。
// **持たない表だけ**が `NON_CASCADING_USER_TABLES` に並び、退会処理が
// 明示的に消す。ここから 1 行落ちると、**その表だけ退会後に残る。**
// 落ちも警告も出ない。
//
// ## 実際に残っていた
//
// 2026-09-06 に本番を実測したところ、`auth.users` を参照する 27 表は
// すべて `ON DELETE CASCADE` だったが、**`toritavi_storage_blocks` は
// FK を持たず、台帳にも退会処理にも入っていなかった。**
//
// 2026-09-08 に台帳へ足した。判断は「残す理由が無い」——
// その uuid は退会後に二度と発行されないので、残しても濫用防止の役に
// 立たない。**目的の無い個人データが残るだけ。**
//
// ## `toritavi_deletion_failures` は別
//
// あちらは「消し損ねた記録」そのもの。**残すことに目的がある**ので、
// 台帳に入れてはいけない（入れると記録自体が消える）。
// ============================================================================
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DELETION_FAILURE_TABLE,
  NON_CASCADING_USER_TABLES,
  USER_OWNED_BUCKETS,
} from "../user-data-ledger.ts";

/** 2026-09-08 時点。**減らすときは理由をここに書く。** */
const EXPECTED = [
  "trip_contacts", // 電話番号を持つ
  "trip_task_states",
  "affiliate_clicks",
  "toritavi_storage_blocks", // JR000213
];

test("🔴 退会で消す表が、黙って減っていない", () => {
  assert.deepEqual(
    [...NON_CASCADING_USER_TABLES].sort(),
    [...EXPECTED].sort(),
    "台帳が変わった。**減らしたなら、その表が退会後も残ることになる。**\n" +
      "  意図した変更なら、この期待値と理由を同時に直すこと",
  );
});

test("🔴 消し損ねの記録は台帳に入れない（入れると記録自体が消える）", () => {
  assert.ok(
    !(NON_CASCADING_USER_TABLES as readonly string[]).includes(
      DELETION_FAILURE_TABLE,
    ),
    `${DELETION_FAILURE_TABLE} が台帳に入っている。` +
      "**「消し損ねた記録」が退会で消えると、消し損ねたこと自体が分からなくなる。**",
  );
});

test("陰性対照: 台帳が空になっていない", () => {
  // 「全部消した」で上の検査が通らないようにする。
  assert.ok(NON_CASCADING_USER_TABLES.length >= 4);
  assert.ok(USER_OWNED_BUCKETS.length >= 3, "バケットの台帳も痩せていないこと");
});

test("陰性対照: 表名が空文字や重複になっていない", () => {
  const names = [...NON_CASCADING_USER_TABLES];
  assert.equal(new Set(names).size, names.length, "重複がある");
  for (const n of names) {
    assert.match(n, /^[a-z][a-z0-9_]+$/, `表名が不正: ${n}`);
  }
});
