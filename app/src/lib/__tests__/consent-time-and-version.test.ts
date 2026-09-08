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

/**
 * コメントを落としてから見る。
 *
 * 🔴 **ブロックコメントも落とす**（2026-09-08 に空振りした）。
 * 行コメントだけ落としていたので、`/** … *\/` の注記に書いた
 * 「直す前は `withdrawn_at: \"now()\"` だった」という**説明文**に当たり、
 * 直したのに赤いままだった。**注記に名前があるだけで判定しない。**
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const STORE = "src/lib/consent-store.ts";
const ROUTE = "src/app/api/account/consent/route.ts";
const SQL = `${homedir()}/Dev/toritavi_app/supabase/consent_records.sql`;

test("陰性対照: 行・ブロックの両方のコメントを落とせている", () => {
  const raw = readFileSync(STORE, "utf8");
  assert.ok(raw.includes("// 🔴"), "前提（行コメント）が無い");
  assert.ok(raw.includes("/**"), "前提（ブロックコメント）が無い");
  const c = code(STORE);
  assert.ok(!c.includes("// 🔴"), "🔴 行コメントを落とせていない");
  assert.ok(!c.includes("/**"), "🔴 ブロックコメントを落とせていない");
  assert.ok(c.includes("export async function"), "🔴 本体まで消している");
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

test("🔴 撤回は DB 関数（RPC）で行う", () => {
  // 🔴 **時刻の決め方をコードの外に置く**（2026-09-08・外部レビュー指摘 1）。
  //    直す前は `.update({ withdrawn_at: "now()" })` を送っていた。
  //    **これは動く** —— PostgreSQL の日時入力パーサが末尾の `()` を許容する
  //    （手元で実測）。ただし文書化された形式は `'now'` の方で、
  //    **パーサの寛容さに寄りかかっている。** 意図が読めず、壊れても静か。
  const c = code(STORE);
  const i = c.indexOf("export async function withdrawAiConsent");
  const fn = c.slice(i, c.indexOf("\nexport ", i + 1));
  assert.ok(
    fn.includes('.rpc("withdraw_consent"'),
    "🔴 RPC を使っていない。時刻の決め方がコード側に残っている",
  );
  assert.ok(!/\.delete\(\)/.test(fn), "🔴 行を消している");
});

test('🔴 update の payload に "now()" という文字列を入れていない', () => {
  // 指摘 1 の再発を、**文字列そのもの**で止める。
  const c = code(STORE);
  assert.ok(
    !/withdrawn_at:\s*["'`]now\(\)["'`]/.test(c),
    '🔴 `withdrawn_at: "now()"` が復活している。DB 関数（RPC）で立てること',
  );
  assert.ok(
    !/withdrawn_at:\s*["'`]now["'`]/.test(c),
    '🔴 `withdrawn_at: "now"` も同じ。パーサ任せにしない',
  );
});

test("🔴 撤回の SQL 関数が、冪等かつ利用者から呼べない", () => {
  const sql = readFileSync(SQL, "utf8");
  assert.ok(
    sql.includes("create or replace function public.withdraw_consent("),
    "🔴 撤回の関数が SQL に無い",
  );
  const i = sql.indexOf("create or replace function public.withdraw_consent(");
  const fn = sql.slice(i, sql.indexOf("revoke all on function public.withdraw_consent", i));
  assert.ok(
    fn.includes("and withdrawn_at is null"),
    "🔴 未撤回だけを対象にしていない（冪等でない）",
  );
  assert.ok(
    /set withdrawn_at = now\(\)/.test(fn),
    "🔴 DB の now() で立てていない",
  );
  assert.ok(
    sql.includes(
      "revoke all on function public.withdraw_consent(uuid, text) from public, anon, authenticated;",
    ),
    "🔴 利用者から直接呼べる。security definer なので他人の user_id を渡せる",
  );
});

test("🔴 kind の未知値を AI 同意として受理しない", () => {
  // `kind: "legal_typo"` が `ai_processing` に倒れると、
  // 規約・PP を保存したつもりで片方も入らないまま 200 が返る。
  const c = code(ROUTE);
  assert.ok(
    c.includes('body.kind !== "legal"') && c.includes('body.kind !== "ai_processing"'),
    "🔴 許可する値を列挙していない",
  );
  assert.ok(c.includes('"bad_kind"'), "🔴 400 を返していない");
  assert.ok(
    c.includes("body.kind !== undefined"),
    "🔴 未指定まで弾いている（後方互換が壊れる）",
  );
  // 弾く判定が、記録の呼び出しより前にあること。
  assert.ok(
    c.indexOf('"bad_kind"') < c.indexOf("recordLegalConsent("),
    "🔴 検査が記録より後ろ",
  );
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
