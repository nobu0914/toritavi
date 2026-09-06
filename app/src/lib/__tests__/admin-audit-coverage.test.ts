// 利用者の中身を返す管理画面・API が、**必ず監査に残す**こと（JR000212）。
//
// 2026-09-06 に本番で実測した結果 ——
// ダッシュボード・利用者詳細・添付表示は記録されるのに、
// 🔴 **一覧と検索だけが無記録**だった。生メールを最大 200 件返す経路と、
// 特定の人を名指しで探す操作にだけ入っていない。
// つまり**運営が全利用者のメールを列挙しても、誰にも痕跡が残らない。**
//
// 🔴 **1 か所で沈黙していたら、だいたい全部沈黙している**（CLAUDE.md §6-1 の 3 番）。
// 面ごとに人が覚えておく形をやめ、**呼び出しの有無を機械で数える。**
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** 利用者の中身に触る取得関数。これを呼ぶ面は記録が要る。 */
const PII_READERS = [
  "fetchAdminUserList",
  "fetchAdminUserDetail",
  "fetchAbuseSignals",
  "fetchFeedback",
  "fetchUserFiles",
  "signUserFile",
  "signFeedbackAttachment",
];

/**
 * import 行とコメントを落とした本文。
 *
 * 🔴 **これが無いと、このテストは自分が捕まえるはずの欠陥を持つ。**
 * 2026-09-06、対照（一覧の `recordAuditLog(...)` を消す）を回したら
 * **緑のまま**だった —— `import { recordAuditLog } from …` が残っていて、
 * `includes("recordAuditLog")` に当たっていた。
 * 「呼んでいる」ではなく「名前がどこかにある」を見ていた。
 * 今日これで 3 回目（トースト・配線・ここ）。**呼び出しの形で数える。**
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
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

describe("PII を返す管理面は監査に残す", () => {
  const files = [...walk("src/app/admin"), ...walk("src/app/api/admin")];

  test("🔴 走査が空振りしていない", () => {
    // 走査対象が 0 件なら「違反なし」で緑になる —— この一連の欠陥の型。
    assert.ok(files.length > 10, `管理面のファイルが ${files.length} 件しか無い`);
    assert.ok(
      files.some((f) => code(fs.readFileSync(f, "utf8")).includes("recordAuditLog(")),
      "recordAuditLog を呼ぶファイルが 1 つも無い（改名した？）"
    );
  });

  test("🔴 利用者の中身を読む面が、すべて記録している", () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = code(fs.readFileSync(f, "utf8"));
      const reader = PII_READERS.find((r) => src.includes(`${r}(`));
      if (!reader) continue;
      // 🔴 **括弧まで見る。** `import { recordAuditLog }` は呼び出しではない。
      if (!src.includes("recordAuditLog(")) {
        missing.push(`${f} （${reader} を呼ぶのに記録が無い）`);
      }
    }
    assert.deepEqual(
      missing,
      [],
      "🔴 記録なしで利用者の中身を返す面がある:\n  " + missing.join("\n  ")
    );
  });

  test("🔴 監査の summary に、検索語と Storage パスを書かない", () => {
    // summary 列は /admin/security が描画するので **support_viewer にも見える**。
    // 検索語は利用者のメールそのもの、パスは step id から旅程が辿れる
    // （`data-privacy-spec.md` §2-1）。
    const bad: string[] = [];
    for (const f of [...files, "src/lib/admin-moderation.ts"]) {
      if (!fs.existsSync(f)) continue;
      for (const line of fs.readFileSync(f, "utf8").split("\n")) {
        if (!line.includes("summary:")) continue;
        if (/\bpath=\$\{/.test(line)) bad.push(`${f}: パスを書いている — ${line.trim()}`);
        if (/\b(q|query|search)=\$\{/.test(line))
          bad.push(`${f}: 検索語を書いている — ${line.trim()}`);
      }
    }
    assert.deepEqual(bad, [], "🔴 " + bad.join("\n  "));
  });
});
