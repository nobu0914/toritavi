// 非常停止スイッチの判定。**「AI だけ止めて手入力は残す」が成り立つか。**
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { modeAllows, stricter } from "../ai-switch-rules.ts";

describe("停止の各状態", () => {
  test("on は全員通す", () => {
    for (const a of ["guest", "free", "pro"] as const) assert.equal(modeAllows("on", a), true);
  });

  test("🔴 guest_off はゲストだけ止める（会員は使える）", () => {
    assert.equal(modeAllows("guest_off", "guest"), false);
    assert.equal(modeAllows("guest_off", "free"), true);
    assert.equal(modeAllows("guest_off", "pro"), true);
  });

  test("🔴 off は全員止める（有料も含む）", () => {
    for (const a of ["guest", "free", "pro"] as const) assert.equal(modeAllows("off", a), false);
  });
});

describe("env は厳しい側にだけ効く", () => {
  test("DB が on でも env が off なら止まる", () => {
    assert.equal(stricter("on", "off"), "off");
  });

  test("🔴 DB が off なら env の on では開かない", () => {
    // env で緩められると、DB を締めた意味が無くなる。
    assert.equal(stricter("off", "on"), "off");
  });

  test("guest_off と off なら off", () => {
    assert.equal(stricter("guest_off", "off"), "off");
    assert.equal(stricter("off", "guest_off"), "off");
  });
});
