/**
 * ゲストの端末側の関門を固定する。
 *
 * 🔴 ここで守りたいのは **「枠が増える方向の事故」**。
 *    減る方（厳しすぎる）は利用者が登録すれば回避できるが、
 *    増える方は**原価がそのまま出ていく**。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  decideGuest,
  nextDeviceUsed,
  GUEST_UNATTESTED_LIMIT,
} from "../guest-quota.ts";
import { SPEC_GUEST_REQUESTS } from "../ocr-plan-spec.ts";

describe("上限は App Attest の結果で決まる", () => {
  test("検証できた端末は仕様どおり 3 件", () => {
    const d = decideGuest("attested", { kind: "fresh" });
    assert.equal(d.limit, SPEC_GUEST_REQUESTS);
    assert.equal(d.limit, 3);
  });

  test("🔴 対応していない端末（シミュレータ等）は 1 件", () => {
    assert.equal(decideGuest("unsupported", { kind: "fresh" }).limit, 1);
    assert.equal(GUEST_UNATTESTED_LIMIT, 1);
  });

  test("🔴 検証に失敗した端末も 1 件（全面拒否にしない）", () => {
    const d = decideGuest("failed", { kind: "fresh" });
    assert.equal(d.limit, 1);
    assert.equal(d.allow, true, "失敗＝即拒否にしない（設定ミスと端末差が大半）");
  });

  test("🔴 App Attest 抜きで 3 件にならない", () => {
    for (const a of ["unsupported", "failed"] as const) {
      assert.notEqual(
        decideGuest(a, { kind: "fresh" }).limit,
        SPEC_GUEST_REQUESTS,
        "偽クライアントを排除できないまま満額を出している",
      );
    }
  });
});

describe("端末が使い切っているか", () => {
  test("初回は通る", () => {
    const d = decideGuest("attested", { kind: "fresh" });
    assert.equal(d.allow, true);
    assert.equal(d.used, 0);
    assert.equal(d.remaining, 3);
  });

  test("2 件使っていれば残り 1", () => {
    const d = decideGuest("attested", { kind: "known", used: 2 });
    assert.equal(d.allow, true);
    assert.equal(d.remaining, 1);
  });

  test("🔴 3 件使っていれば断る", () => {
    const d = decideGuest("attested", { kind: "known", used: 3 });
    assert.equal(d.allow, false);
    assert.equal(d.reason, "device_exhausted");
    assert.equal(d.remaining, 0);
  });

  test("🔴 未検証の端末は 1 件で尽きる", () => {
    const d = decideGuest("unsupported", { kind: "known", used: 1 });
    assert.equal(d.allow, false, "1 件しか無いのに 2 件目が通っている");
  });
});

describe("聞けなかったとき", () => {
  test("通すが、**書き戻さない**", () => {
    const d = decideGuest("attested", { kind: "unknown", reason: "unavailable" });
    assert.equal(d.allow, true, "全面拒否にしない（設定ミスで全員止まる）");
    assert.equal(
      d.writeBack,
      false,
      "🔴 読めていない値に +1 すると、3 件使った端末を 1 件に戻しうる",
    );
  });

  test("読めたときだけ書き戻す", () => {
    assert.equal(decideGuest("attested", { kind: "fresh" }).writeBack, true);
    assert.equal(
      decideGuest("attested", { kind: "known", used: 1 }).writeBack,
      true,
    );
  });

  test("🔴 断るときは書き戻さない", () => {
    assert.equal(
      decideGuest("attested", { kind: "known", used: 3 }).writeBack,
      false,
    );
  });
});

describe("書き戻す値", () => {
  test("加算される", () => {
    assert.equal(nextDeviceUsed(0, 1), 1);
    assert.equal(nextDeviceUsed(1, 2), 3);
  });

  test("🔴 3 で頭打ち（巻き戻ると枠が復活する）", () => {
    assert.equal(nextDeviceUsed(3, 1), 3);
    assert.equal(nextDeviceUsed(2, 5), 3);
    // 2 bit は 4 状態しか無い。4 を書くと 0 に化ける。
    assert.ok(nextDeviceUsed(3, 10) <= 3);
  });

  test("負にならない", () => {
    assert.equal(nextDeviceUsed(0, -5), 0);
  });
});
