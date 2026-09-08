// ============================================================================
// 🔴 **同意の受付時刻と文書版を、クライアントが決められないこと**（§3・§5）。
//
// 直す前:
//   - `accepted_at` にクライアントが送った値をそのまま入れていた。
//     端末の時計は利用者が変えられるので、**同意した時刻を自分で決められた。**
//   - 未来時刻を弾く制約（+5 分）があり、**即時撤回のような正しい操作まで
//     制約違反にしうる**形だった。
//   - 最新判定が `accepted_at` だけで、**同時刻の行があると順序が決まらない。**
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { test } from "node:test";
import {
  PRIVACY_VERSIONS,
  TERMS_VERSIONS,
} from "../consent-store.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const STORE = "src/lib/consent-store.ts";
const ROUTE = "src/app/api/account/consent/route.ts";
const SQL = `${homedir()}/Dev/toritavi_app/supabase/consent_records.sql`;

test("陰性対照: コメントを落とせている", () => {
  assert.ok(readFileSync(STORE, "utf8").includes("// 🔴"));
  assert.ok(!code(STORE).includes("// 🔴"), "🔴 コメントを落とせていない");
});

test("🔴 accepted_at をクライアントから書き込んでいない", () => {
  const c = code(STORE);
  assert.ok(
    !/accepted_at:\s*args\./.test(c),
    "🔴 クライアントの値を accepted_at に入れている。時刻を自分で決められる",
  );
  assert.ok(
    c.includes("client_reported_at"),
    "🔴 申告値を参考として残す列に入れていない",
  );
});

test("🔴 API が時刻で拒否しない（時計がずれた端末でも同意できる）", () => {
  const c = code(ROUTE);
  assert.ok(
    !c.includes("accepted_at_future"),
    "🔴 未来時刻で 400 を返している。正式な時刻はサーバが決めるので拒否する理由が無く、"
      + "**時計がずれた端末で同意そのものができなくなる**",
  );
});

test("🔴 SQL 側も default now() で、+5 分の制約を持たない", () => {
  const sql = readFileSync(SQL, "utf8");
  assert.ok(
    /accepted_at\s+timestamptz not null default now\(\)/.test(sql),
    "🔴 accepted_at に default now() が無い",
  );
  assert.ok(
    !sql.includes("accepted_at_not_future"),
    "🔴 未来時刻の制約が残っている。即時撤回が制約違反になりうる",
  );
  assert.ok(
    sql.includes("client_reported_at"),
    "🔴 申告値を残す列が無い",
  );
});

test("🔴 最新判定が確定的（created_at desc, seq desc）", () => {
  const c = code(STORE);
  assert.ok(c.includes('.order("created_at"'), "🔴 created_at で並べていない");
  assert.ok(c.includes('.order("seq"'), "🔴 seq の同点処理が無い");
  assert.ok(
    !/\.order\("accepted_at"/.test(c),
    "🔴 accepted_at で並べている。同時刻の行で順序が決まらない",
  );
  const sql = readFileSync(SQL, "utf8");
  assert.ok(
    /seq\s+bigint generated always as identity/.test(sql),
    "🔴 SQL に seq が無い",
  );
});

test("🔴 撤回は冪等（0 行でも成功）", () => {
  const c = code(STORE);
  const i = c.indexOf("export async function withdrawAiConsent");
  const fn = c.slice(i);
  assert.ok(fn.includes('.is("withdrawn_at", null)'), "🔴 未撤回だけを対象にしていない");
  assert.ok(!/\.delete\(\)/.test(fn), "🔴 行を消している");
});

test("🔴 規約と PP は 1 文で入れる（片方だけ入らない）", () => {
  const c = code(STORE);
  const i = c.indexOf("export async function recordLegalConsent");
  assert.ok(i > -1, "🔴 まとめて記録する関数が無い");
  const fn = c.slice(i);
  assert.ok(
    /\.insert\(\[/.test(fn),
    "🔴 配列で 1 文にしていない。別々に呼ぶと『規約だけ記録されて PP は失敗』が起こる",
  );
  assert.ok(fn.includes('consent_type: "terms"'), "🔴 terms が無い");
  assert.ok(fn.includes('consent_type: "privacy"'), "🔴 privacy が無い");
  assert.ok(
    !/document_version:\s*args\./.test(fn),
    "🔴 版をクライアントから受け取っている",
  );
});

test("🔴 日英で別の版を持ち、混同していない", () => {
  assert.notEqual(
    PRIVACY_VERSIONS.ja,
    PRIVACY_VERSIONS.en,
    "🔴 日英の PP の版が同じ。偶然一致なら、この検査は分岐を証明していない",
  );
  for (const v of [
    TERMS_VERSIONS.ja,
    TERMS_VERSIONS.en,
    PRIVACY_VERSIONS.ja,
    PRIVACY_VERSIONS.en,
  ]) {
    assert.match(v, /^\d{4}-\d{2}-\d{2}$/, `版の書式が違う: ${v}`);
  }
});

test("🔴 アプリ側の版と一致している（ずれると記録と画面が食い違う）", () => {
  const app = `${homedir()}/Dev/toritavi_app/lib/features/auth/domain/legal_consent.dart`;
  let src: string;
  try {
    src = readFileSync(app, "utf8");
  } catch {
    return void console.log(`  skip: ${app} が無い端末`);
  }
  const pick = (name: string, locale: string) => {
    const block = src.slice(src.indexOf(`${name} = <String, String>{`));
    const m = block.match(new RegExp(`'${locale}':\\s*'([^']+)'`));
    return m?.[1];
  };
  assert.equal(pick("kTermsVersions", "ja"), TERMS_VERSIONS.ja);
  assert.equal(pick("kTermsVersions", "en"), TERMS_VERSIONS.en);
  assert.equal(pick("kPrivacyVersions", "ja"), PRIVACY_VERSIONS.ja);
  assert.equal(pick("kPrivacyVersions", "en"), PRIVACY_VERSIONS.en);
});
