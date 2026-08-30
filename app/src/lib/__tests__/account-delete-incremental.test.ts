// ============================================================================
// 🔴 **退会は「集めてから消す」に戻さない。**
//
// 2026-08-30 まで、ストレージの掃除は「パスを全部集める → 最後にまとめて
// remove」だった。時間切れになると **1 枚も消えないまま**終わり、再試行は
// 同じ量を最初からやり直す。**進捗が積み上がらないので、一度超えた利用者は
// 二度と退会できない。** 画面には「削除に失敗しました」が出続ける。
//
// **Apple 5.1.1(v) はアカウント削除をアプリ内で完結できることを求めている。**
//
// ここでは `removeUserObjects` を**実際に動かして**、
// 「途中で落ちても、そこまでの分は消えている」ことを確かめる。
// ソース文字列の grep では、また同じ形に戻されても気づけない。
// ============================================================================
import assert from "node:assert/strict";
import { test } from "node:test";
import { removeUserObjects } from "../../app/api/account/delete/route.ts";

const UID = "11111111-2222-3333-4444-555555555555";

/**
 * `list` と `remove` だけを持つ偽バケツ。
 * `failOnRemoveCall` 回目の remove で投げる（時間切れの代わり）。
 */
function fakeAdmin(
  tree: Record<string, string[]>,
  opts: { failOnRemoveCall?: number } = {},
) {
  const removed: string[] = [];
  let removeCalls = 0;
  const bucket = {
    async list(prefix: string) {
      const key = prefix.replace(/\/$/, "");
      const names = (tree[key] ?? []).filter(
        (n) => !removed.includes(`${key}/${n}`),
      );
      return { data: names.map((name) => ({ name })), error: null };
    },
    async remove(paths: string[]) {
      removeCalls += 1;
      if (opts.failOnRemoveCall === removeCalls) {
        throw new Error("timeout");
      }
      removed.push(...paths);
      return { error: null };
    },
  };
  return {
    admin: { storage: { from: () => bucket } } as never,
    removed,
    get removeCalls() {
      return removeCalls;
    },
  };
}

const SPEC = { id: "scan-images", depth: 2 } as never;

test("depth 2: フォルダごとに消す（全部集め終わるのを待たない）", async () => {
  const f = fakeAdmin({
    [UID]: ["a", "b", "c"],
    [`${UID}/a`]: ["1.jpg"],
    [`${UID}/b`]: ["2.jpg"],
    [`${UID}/c`]: ["3.jpg"],
  });
  await removeUserObjects(f.admin, SPEC, UID);
  assert.deepEqual(f.removed.sort(), [
    `${UID}/a/1.jpg`,
    `${UID}/b/2.jpg`,
    `${UID}/c/3.jpg`,
  ]);
  // 🔴 **フォルダの数だけ remove が呼ばれること。** 1 回にまとめられていたら、
  //    それは「全部集めてから消す」形に戻ったということ。
  assert.equal(f.removeCalls, 3, "フォルダごとに消していない");
});

test("🔴 途中で落ちても、そこまでの分は消えている（進捗が積み上がる）", async () => {
  const f = fakeAdmin(
    {
      [UID]: ["a", "b", "c"],
      [`${UID}/a`]: ["1.jpg"],
      [`${UID}/b`]: ["2.jpg"],
      [`${UID}/c`]: ["3.jpg"],
    },
    { failOnRemoveCall: 3 }, // 3 フォルダ目で時間切れ
  );
  await assert.rejects(() => removeUserObjects(f.admin, SPEC, UID));
  // **1 枚も消えない**のが元の壊れ方。2 枚消えていれば進捗は積み上がっている。
  assert.deepEqual(f.removed.sort(), [`${UID}/a/1.jpg`, `${UID}/b/2.jpg`]);
});

test("🔴 再試行すると残りだけが対象になる（繰り返せば終わる）", async () => {
  const tree = {
    [UID]: ["a", "b", "c"],
    [`${UID}/a`]: ["1.jpg"],
    [`${UID}/b`]: ["2.jpg"],
    [`${UID}/c`]: ["3.jpg"],
  };
  const f1 = fakeAdmin(tree, { failOnRemoveCall: 3 });
  await assert.rejects(() => removeUserObjects(f1.admin, SPEC, UID));

  // 1 回目で消えた分を反映した木で、もう一度走らせる。
  const rest: Record<string, string[]> = {
    [UID]: ["c"],
    [`${UID}/c`]: ["3.jpg"],
  };
  const f2 = fakeAdmin(rest);
  await removeUserObjects(f2.admin, SPEC, UID);
  assert.deepEqual(f2.removed, [`${UID}/c/3.jpg`]);
  assert.equal(f2.removeCalls, 1, "残り 1 フォルダなのに余計に呼んでいる");
});

test("depth 1 も同じ形で消える", async () => {
  const f = fakeAdmin({ [UID]: ["x.png", "y.png"] });
  await removeUserObjects(f.admin, { id: "feedback", depth: 1 } as never, UID);
  assert.deepEqual(f.removed.sort(), [`${UID}/x.png`, `${UID}/y.png`]);
});
