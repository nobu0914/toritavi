import { strict as assert } from "node:assert";
import { test } from "node:test";
import { capGuestUsage, decideGuest } from "../guest-quota";

// 🔴 実機で起きた形（2026-08-31）:
//    上の帯「上限に達しました」（端末の関門）と
//    下のピル「残り 3 件」（DB の件数）が**同時に出た**。
//    どちらも個別には正しく、利用者には意味が分からない。

test("🔴 端末が使い切っていたら、残数も 0 になる（画面が矛盾しない）", () => {
  const d = decideGuest("attested", { kind: "known", used: 3 });
  assert.equal(d.allow, false); // 帯は「上限に達しました」

  // DB 側は 0 件のまま（別の匿名 user_id ＝ 再インストール後）
  const shown = capGuestUsage({ limitRequests: 5, usedRequests: 0 }, d);
  assert.equal(shown.usedRequests, 3, "🔴 ピルが「残り 3 件」と言ってしまう");
  assert.equal(shown.limitRequests, 3);
  assert.equal(shown.limitRequests - shown.usedRequests, 0);
});

test("🔴 DB が先に進んでいたら、そちらを採る（多い方）", () => {
  // 端末の書き戻しが落ちた場合。**少ない方を採ると水増しになる。**
  const d = decideGuest("attested", { kind: "known", used: 0 });
  const shown = capGuestUsage({ limitRequests: 5, usedRequests: 2 }, d);
  assert.equal(shown.usedRequests, 2);
});

test("未検証の端末は 1 件として出る（0/1）", () => {
  const d = decideGuest("failed", { kind: "fresh" });
  const shown = capGuestUsage({ limitRequests: 5, usedRequests: 0 }, d);
  assert.equal(shown.limitRequests, 1);
});

test("検証が通れば 3 件（0/3）—— ここがバッジの更新前後の差", () => {
  const d = decideGuest("attested", { kind: "fresh" });
  assert.equal(capGuestUsage({ limitRequests: 5, usedRequests: 0 }, d).limitRequests, 3);
});

test("端末を見られないときは DB のまま（フェイルオープンの現状維持）", () => {
  const d = decideGuest("attested", { kind: "unknown", reason: "no_token" });
  const shown = capGuestUsage({ limitRequests: 5, usedRequests: 1 }, d);
  assert.equal(shown.usedRequests, 1, "見られないことを「使った」に変換しない");
});

test("🔴 上限を超えた使用数を出さない（3 / 1 にならない）", () => {
  // 16 Pro Max の実際の状態: 端末は 3 件使用済み、検証はまだ（上限 1 件）。
  const d = decideGuest("failed", { kind: "known", used: 3 });
  const shown = capGuestUsage({ limitRequests: 5, usedRequests: 0 }, d);
  assert.equal(shown.limitRequests, 1);
  assert.equal(shown.usedRequests, 1, "🔴 `3 / 1` と出る");
  assert.ok(shown.usedRequests <= shown.limitRequests);
});
