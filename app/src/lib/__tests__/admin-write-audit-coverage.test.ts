// ============================================================================
// 🔴 **管理者の書き込みは、すべて監査に残す —— を機械で数える**
//    （2026-10-19・夜間検査 5-12）。
//
// `admin-audit-coverage.test.ts` は「利用者の中身を**読む**面」だけを見ていた。
// **書き込み（POST / PUT / PATCH / DELETE）が記録しているかは誰も見ておらず、**
// 新しい管理 API を足したときに記録を書き忘れても緑のままだった。
// EPC 単価の保存（5-11）は記録を呼んではいたが、戻り値を捨てていた ——
// 「呼んでいるか」すら見張りが無ければ、次は呼び忘れが通る。
//
// 数え方:
//   - 対象 = `src/app/api/admin` 配下の route.ts と、`requireAdmin(` を呼ぶ
//     ほかの route.ts（例: `/api/push/broadcast`）の、書き込みのハンドラ。
//     加えて `src/app/admin` の Server Action（"use server" の export）
//   - 合格 = そのハンドラの本文が `recordAuditLog(` を呼ぶか、
//     **`recordAuditLog(` を呼ぶ lib の関数**（例: `setUserStatus`）を呼ぶ
//   - 🔴 **ハンドラごとに切り出す。** ファイル単位だと、同じファイルの GET が
//     記録しているだけで DELETE が素通りする（`files/route.ts` がその形）
//   - 🔴 **コメントと import を落としてから数える。** `import { recordAuditLog }`
//     は呼び出しではない（`admin-audit-coverage.test.ts` が一度これで空振りした）
// ============================================================================
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const WRITE = ["POST", "PUT", "PATCH", "DELETE"] as const;
const AUDIT = "recordAuditLog";

/**
 * 記録の要らない Server Action。**理由を必ず添える。**
 * ここに足すのは「データを書かない」ものだけ。
 */
const ACTION_EXEMPT: Record<string, string> = {
  setUserSearch: "検索語を 10 分の httpOnly Cookie に置くだけ（データを書かない）",
  clearUserSearch: "検索語の Cookie を消すだけ（データを書かない）",
  currentUserSearch: "検索語の Cookie を読むだけ",
};

/** コメントと import 行を落とした本文。 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .map((l) => l.replace(/\s\/\/.*$/, ""))
    .filter((l) => !/^\s*import\b/.test(l))
    .join("\n");
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** `export async function NAME(` ごとに、次の export までの本文を切り出す。 */
function exportedFunctions(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/gm;
  const heads = [...src.matchAll(re)];
  heads.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const next = heads[i + 1]?.index;
    const rest = src.slice(start, next ?? src.length);
    const end = rest.search(/^export\s/m);
    out.set(m[1], end >= 0 ? rest.slice(0, end) : rest);
  });
  return out;
}

/** `recordAuditLog(` を（直接・間接に）呼ぶ lib の関数名。 */
function auditedHelpers(libFiles: string[]): Set<string> {
  const bodies = new Map<string, string>();
  for (const f of libFiles) {
    for (const [name, body] of exportedFunctions(code(fs.readFileSync(f, "utf8")))) {
      if (name !== AUDIT) bodies.set(name, body);
    }
  }
  const audited = new Set<string>();
  // 間接（A が B を呼び、B が記録する）も拾う。増えなくなるまで回す。
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, body] of bodies) {
      if (audited.has(name)) continue;
      if (body.includes(`${AUDIT}(`) || [...audited].some((h) => body.includes(`${h}(`))) {
        audited.add(name);
        changed = true;
      }
    }
  }
  return audited;
}

type Finding = { where: string; reason: string };

/** route.ts の書き込みハンドラのうち、記録していないもの。 */
function unauditedRouteHandlers(file: string, src: string, helpers: Set<string>): Finding[] {
  const c = code(src);
  const out: Finding[] = [];
  // 🔴 **矢印関数の形は数えられない。** 黙って飛ばさず、落として知らせる。
  for (const m of WRITE) {
    if (new RegExp(`^export\\s+const\\s+${m}\\b`, "m").test(c)) {
      out.push({ where: `${file} ${m}`, reason: "export const 形のハンドラは検査できない（function で書く）" });
    }
  }
  for (const [name, body] of exportedFunctions(c)) {
    if (!(WRITE as readonly string[]).includes(name)) continue;
    if (body.includes(`${AUDIT}(`)) continue;
    if ([...helpers].some((h) => body.includes(`${h}(`))) continue;
    out.push({ where: `${file} ${name}`, reason: "監査に残していない" });
  }
  return out;
}

/** "use server" のファイルの export のうち、記録していないもの。 */
function unauditedActions(file: string, src: string, helpers: Set<string>): Finding[] {
  if (!/^\s*["']use server["']/.test(src)) return [];
  const out: Finding[] = [];
  for (const [name, body] of exportedFunctions(code(src))) {
    if (ACTION_EXEMPT[name]) continue;
    if (body.includes(`${AUDIT}(`)) continue;
    if ([...helpers].some((h) => body.includes(`${h}(`))) continue;
    out.push({ where: `${file} ${name}`, reason: "Server Action が監査に残していない" });
  }
  return out;
}

const libFiles = walk("src/lib").filter((f) => !f.includes("__tests__"));
const helpers = auditedHelpers(libFiles);

const routeFiles = walk("src/app/api").filter((f) => {
  if (!f.endsWith("route.ts")) return false;
  if (f.startsWith(path.join("src", "app", "api", "admin"))) return true;
  return code(fs.readFileSync(f, "utf8")).includes("requireAdmin(");
});
const actionFiles = walk("src/app/admin");

describe("管理者の書き込みは監査に残す", () => {
  test("🔴 走査が空振りしていない（対象と、記録する lib 関数が見つかっている）", () => {
    let handlers = 0;
    for (const f of routeFiles) {
      const names = [...exportedFunctions(code(fs.readFileSync(f, "utf8"))).keys()];
      handlers += names.filter((n) => (WRITE as readonly string[]).includes(n)).length;
    }
    // 2026-10-19 時点: rates POST / flag / notify / status / files DELETE / broadcast POST。
    assert.ok(handlers >= 6, `書き込みのハンドラが ${handlers} 件しか見つからない（走査が壊れた？）`);
    for (const h of ["setUserStatus", "setUserFlag", "deleteUserFile", "notifyUser"]) {
      assert.ok(helpers.has(h), `🔴 ${h} が「記録する関数」として見つからない（改名した？）`);
    }
    assert.ok(!helpers.has("fetchUserFiles"), "読むだけの関数を「記録する」と誤認している");
  });

  test("🔴 管理者の書き込みハンドラが、すべて記録している", () => {
    const missing: Finding[] = [];
    for (const f of routeFiles) missing.push(...unauditedRouteHandlers(f, fs.readFileSync(f, "utf8"), helpers));
    for (const f of actionFiles) missing.push(...unauditedActions(f, fs.readFileSync(f, "utf8"), helpers));
    assert.deepEqual(
      missing,
      [],
      "🔴 記録なしで管理者が書き込める入口がある:\n  " +
        missing.map((m) => `${m.where} — ${m.reason}`).join("\n  "),
    );
  });
});

// ─────────── 対照: この検査が「落ちるべきとき」に落ちること ───────────
//
// 🔴 **緑だけでは何も言えない。** 走査が空振りしていても、合格の判定が
//    緩すぎても緑になる。わざと欠陥を入れた本文を食わせ、拾えることを見る。
describe("対照（検査そのものの検査）", () => {
  const ROUTE = "src/app/api/admin/fixture/route.ts";

  test("記録を呼ばない POST を拾う", () => {
    const src = `
export async function POST(request: Request) {
  await updateAffiliateRate("x", 1, "u");
  return NextResponse.json({ ok: true });
}`;
    assert.equal(unauditedRouteHandlers(ROUTE, src, helpers).length, 1);
  });

  test("🔴 import とコメントにしか名前が無いものを「呼んでいる」と数えない", () => {
    const src = `
import { recordAuditLog } from "@/lib/admin-audit";
// recordAuditLog(ctx, { action: "x" }) をここで呼ぶ予定
/* recordAuditLog( */
export async function DELETE(request: Request) {
  await removeSomething();
  return NextResponse.json({ ok: true });
}`;
    assert.equal(unauditedRouteHandlers(ROUTE, src, helpers).length, 1);
  });

  test("🔴 同じファイルの GET が記録していても、DELETE の抜けを拾う", () => {
    const src = `
export async function GET() {
  await recordAuditLog(ctx, { action: "viewed" });
  return NextResponse.json({});
}
export async function DELETE() {
  await removeSomething();
  return NextResponse.json({ ok: true });
}`;
    const found = unauditedRouteHandlers(ROUTE, src, helpers);
    assert.deepEqual(found.map((f) => f.where), [`${ROUTE} DELETE`]);
  });

  test("記録する lib 関数（setUserStatus）経由なら合格", () => {
    const src = `
export async function POST() {
  const r = await setUserStatus(ctx, id, "banned", null, meta);
  return NextResponse.json({ ok: true, auditFailed: !r.audited });
}`;
    assert.equal(unauditedRouteHandlers(ROUTE, src, helpers).length, 0);
  });

  test("矢印関数のハンドラは黙って飛ばさず落とす", () => {
    const src = `export const POST = async () => NextResponse.json({ ok: true });`;
    assert.equal(unauditedRouteHandlers(ROUTE, src, helpers).length, 1);
  });

  test("記録しない Server Action を拾う（免除の一覧に無いもの）", () => {
    const src = `"use server";
export async function banUser(id: string) {
  await requireAdmin("super_admin");
  await doBan(id);
}`;
    assert.equal(unauditedActions("src/app/admin/fixture/actions.ts", src, helpers).length, 1);
  });
});
