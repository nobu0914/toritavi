// 🔴 **管理コンソールが見るバケットは、台帳から導くこと。**
//
// 2026-08-30 まで `admin-moderation.ts` は `step-attachments` と
// `toritavi-avatars` の 2 つを直書きしていた。台帳
// (`user-data-ledger.ts`) は **3 つ**あり、`toritavi-feedback` が
// 落ちていた。結果:
//
//   - 利用者詳細の「ファイル」に**フィードバック添付が出ない**
//     （予約票・搭乗券が写り込む前提のスクリーンショット）。エラーも出ない
//   - super_admin が消そうとしても `invalid bucket` で拒否される
//
// **同じ漏れで一度事故っている** —— 台帳が生まれた理由が、まさに
// 「退会 API から `toritavi-feedback` が漏れた」こと。
// **その修正が、閲覧・削除側に入っていなかった**（2026-08-30 レーン 9）。
//
// ## この検査が見ているもの
//
// `admin-moderation.ts` は `server-only` と Supabase を読むので、
// node の単体テストから import できない。**ソースを読んで、
// 台帳から導いていることだけ**を見る。
//
// ⚠️ **コメントを落としてから判定する。** 上の説明にバケット名が出てくる
// ので、素の本文で見ると**注意書きを書いた瞬間に落ちる**検査になる
// （2026-08-29 に同じ穴を 2 回踏んだ）。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { USER_OWNED_BUCKETS } from "../user-data-ledger.ts";

const SRC = "src/lib/admin-moderation.ts";

/** コメント行を落としたコード本体。 */
function codeOnly(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

test("台帳を import している", () => {
  const code = codeOnly(SRC);
  assert.match(code, /USER_OWNED_BUCKETS/, "台帳から導いていない");
  assert.match(code, /from "@\/lib\/user-data-ledger"/);
});

test("バケット名を直書きしていない", () => {
  const code = codeOnly(SRC);
  for (const b of USER_OWNED_BUCKETS) {
    assert.ok(
      !code.includes(`"${b.id}"`),
      `バケット名 "${b.id}" が直書きされている。台帳に足しても追随しない形に戻っている`,
    );
  }
});

test("台帳は 3 バケット（減っていたら退会側も見直す）", () => {
  // 数を固定するのは、**減ったことに気づくため**。増える分は上の 2 つが拾う。
  assert.equal(USER_OWNED_BUCKETS.length, 3);
  assert.ok(USER_OWNED_BUCKETS.some((b) => b.id === "toritavi-feedback"));
});
