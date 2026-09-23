// ============================================================================
// 🔴 **管理画面からコンシェルジュを見る**（2026-09-23・利用者の指示で A と B）。
//
// - B 集約（内容なし）… `support_viewer`
// - A 明細（質問文そのもの）… `super_admin` かつ `CONCIERGE_ADMIN_CONTENT=true`
//
// 🔴 **公開プライバシーポリシーに「運営者が入力内容を閲覧する」記載が無い。**
//    第 3 条 6 に「不正利用の検知・防止、利用量・コストの管理」はあるが、
//    閲覧そのものは書かれていない。**記載が要るかは法務の判断**
//    （`CLAUDE.md` §4-1）なので、**決まるまで A は閉じておく。**
//    この検査は「既定で閉じている」ことを固定する。
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const LIB = "src/lib/admin-concierge.ts";
const PAGE = "src/app/admin/concierge/page.tsx";
const QUOTA = "src/lib/concierge-quota.ts";

test("🔴 質問文は既定で閉じている（env で明示的に開ける）", () => {
  const src = code(LIB);
  assert.match(
    src,
    /process\.env\.CONCIERGE_ADMIN_CONTENT === "true"/,
    "🔴 既定で開いている —— 公開文書の判断より先に閲覧が始まる",
  );
});

test("🔴 閉じているときは本文を取り出さない（画面任せにしない）", () => {
  // 呼び出し側の規律に任せない。**入口が増えたときに 1 つだけ通し忘れる形**
  // が最も多い（`ocr_service.dart` の注記）。
  const src = code(LIB);
  assert.match(
    src,
    /text:\s*CONCIERGE_ADMIN_CONTENT\s*\?/,
    "🔴 スイッチが閉じていても本文が返る",
  );
});

test("🔴 集約は本文を select しない", () => {
  const src = code(LIB);
  const fn = src.slice(
    src.indexOf("export async function fetchConciergeSummary"),
    src.indexOf("export async function fetchConciergeMessages"),
  );
  assert.ok(fn.length > 0, "集約の関数が見つからない（検査が空振りしている）");
  const selects = [...fn.matchAll(/\.select\("([^"]*)"\)/g)].map((m) => m[1]);
  assert.ok(selects.length >= 2, "select を拾えていない");
  // 長さを測るためだけの 1 本を除き、content を取らない
  const withContent = selects.filter((s) => s.includes("content"));
  assert.equal(
    withContent.length,
    1,
    `🔴 集約が本文を余分に取っている: ${JSON.stringify(selects)}`,
  );
});

test("🔴 AI の返答は出さない（role='user' のみ）", () => {
  const src = code(LIB);
  const fn = src.slice(src.indexOf("export async function fetchConciergeMessages"));
  assert.match(fn, /\.eq\("role",\s*"user"\)/, "🔴 assistant の発言まで出る");
});

test("🔴 本文の閲覧には super_admin が要る", () => {
  const src = code(PAGE);
  assert.match(
    src,
    /hasRank\(ctx\.role,\s*"super_admin"\)\s*&&\s*CONCIERGE_ADMIN_CONTENT/,
    "🔴 役割とスイッチの両方を見ていない",
  );
});

test("🔴 本文を見た閲覧は、別の action として監査に残す", () => {
  const src = code(PAGE);
  assert.match(src, /admin\.concierge\.content\.viewed/, "🔴 内容の閲覧が区別できない");
  assert.match(src, /admin\.concierge\.viewed/);
});

test("🔴 コンシェルジュの拒否が違反検知に記録される", () => {
  // `logAiRejection` は `feature: "concierge"` を受ける形で最初から
  // 用意されていたのに、**コンシェルジュから一度も呼ばれていなかった。**
  // 書いていたのは `enforceAiLimits` だけで、2026-09-22 の作り替えで落ちた。
  const src = code(QUOTA);
  assert.match(
    src,
    /logAiRejection\(args\.userId,\s*"concierge",\s*status\)/,
    "🔴 拒否を記録していない —— /admin/abuse がコンシェルジュを見られない",
  );
});
