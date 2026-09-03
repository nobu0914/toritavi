import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { GUEST_MODE_ENABLED } from "../guest-quota";

// 🔴 **ゲストの門番が外れていないことを見張る。**
//
// アプリのフラグ `kGuestModeEnabled` では**サーバは閉じない**。
// サーバは匿名 JWT を受けるので、Supabase の匿名サインインが有効なら
// 外部から使える。**実際に本番で匿名 OCR が 200 を返していた**（2026-08-31）。
//
// 🔴 **値そのものは固定しない**（2026-09-03 に書き換え）。
//
// ここは 2026-08-31 から `GUEST_MODE_ENABLED === false` を釘付けにしていた。
// **見張りとしては働かない** —— 開けると決めた人は、この 1 行を書き換えて
// 通すしかなく、そのとき何も確認されない。`purchases_gate_test` で同じ
// 結論に達している（開け閉めは判断であって、誤りではない）。
//
// **代わりに「開けるための守りが全部そろっているか」を見る。**
// 外部レビュー（2026-08-31）の P0 3 件・P1 4 件に対する塞ぎが、
// どれか 1 つでも消えたらここが落ちる。フラグの値には関係なく検査する
// —— 閉じている間に守りが腐ると、次に開ける人が気づけない。

const code = (s: string) =>
  s.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");

const quota = () => code(readFileSync("src/lib/guest-quota.ts", "utf8"));
const ocr = () => code(readFileSync("src/app/api/ocr/route.ts", "utf8"));

test("🔴 P0-1: 端末トークンが読めないときに通さない", () => {
  // 読めないと `allow` を返していた。**匿名 ID を作り直せば無限に取れた。**
  assert.ok(quota().includes("device_unreadable"),
    "🔴 判定不能を拒否していない（フェイルオープンに戻っている）");
  assert.ok(ocr().includes("device_unreadable"),
    "🔴 呼び出し側がその理由を扱っていない");
});

test("🔴 P0-2: 使用回数を書けなかったら読み取りを続行しない", () => {
  // 書けなくても OCR が通っていた。**上限がまったく効かない。**
  assert.ok(ocr().includes("settleOcrFailure"),
    "🔴 書き込み失敗時の後始末が無い");
  assert.ok(/if\s*\(\s*!wrote\s*\)/.test(ocr()),
    "🔴 書けたかどうかを見ていない");
});

test("🔴 P0-3: 残り枚数と実際のページ数を突き合わせる", () => {
  // 残り 1 件でも 3 ページを 1 要求で通せた。
  assert.ok(quota().includes("export function guestUnitsExceedRemaining"),
    "🔴 突き合わせる関数が消えている");
  // 🔴 **呼ばれていることまで見る。** 定義だけでは何も守らない。
  //    `if (false && …)` のような無効化を通さないため、形も固定する。
  assert.ok(
    /if\s*\(\s*guestDecision\s*&&\s*guestUnitsExceedRemaining\(/.test(ocr()),
    "🔴 判定が呼ばれていない、または条件が書き換えられている",
  );
});

test("🔴 P1: assertion を要求ごとに検証している", () => {
  assert.ok(existsSync("src/lib/guest-assertion.ts"),
    "🔴 検証そのものが消えている");
  assert.ok(ocr().includes("verifyGuestAssertion"),
    "🔴 検証が /api/ocr から呼ばれていない（保存した公開鍵が使われない）");
  const asrt = code(readFileSync("src/lib/guest-assertion.ts", "utf8"));
  // 🔴 **署名だけでは足りない。** 正しい署名の古い 1 通を使い回せる。
  //    同値も拒むこと（同じカウンタ＝同じ署名）。
  assert.ok(asrt.includes("acceptAssertionCounter"),
    "🔴 カウンタを見ていない（再生攻撃が通る）");
  assert.ok(/return\s+incoming\s*>\s*previous/.test(asrt),
    "🔴 カウンタの比較が `>` でない（`>=` だと 1 通を無限に使い回せる）");
});

test("🔴 P1: 匿名ユーザーを掃除する仕組みがある", () => {
  const p = "src/app/api/cron/purge-anonymous/route.ts";
  assert.ok(existsSync(p), "🔴 掃除が消えている（auth.users が匿名で膨れ続ける）");
  const src = code(readFileSync(p, "utf8"));
  // 🔴 **Storage → user の順。** 逆だと画像が誰のものか引けなくなる。
  assert.ok(src.indexOf("removeUserObjects") < src.indexOf("deleteUser"),
    "🔴 消す順が逆（先に user を消すと画像が孤児になる）");
});

test("🔴 OCR が匿名を断る門がある", () => {
  const src = ocr();
  assert.ok(src.includes("isAnonymous && !GUEST_MODE_ENABLED"),
    "🔴 匿名を断る門が無い。**アプリのフラグではサーバは閉じない**");
  // 断る位置が、費用の出る処理より前にあること。
  assert.ok(src.indexOf("isAnonymous && !GUEST_MODE_ENABLED") <
            src.indexOf("client.messages.create("),
    "🔴 断るのが Claude 呼び出しより後ろ");
});

test("🔴 attest の受け口に門がある", () => {
  const src = code(readFileSync("src/app/api/guest/attest/route.ts", "utf8"));
  const hits = (src.match(/if \(!GUEST_MODE_ENABLED\)/g) ?? []).length;
  assert.equal(hits, 2, `🔴 GET と POST の両方に門を置くこと（いま ${hits} 箇所）`);
});

test("🔴 フラグと、その上の説明が食い違っていない", () => {
  // 開け閉めは判断なので値は固定しないが、**説明が実態と逆のまま残る**のは
  // 別の話。次に読む人の前提になる（`CLAUDE.md` の「フラグの一覧が実装より
  // 遅れる」が 4 回起きている）。
  const head = readFileSync("src/lib/guest-quota.ts", "utf8").slice(0, 4000);
  if (GUEST_MODE_ENABLED) {
    assert.ok(!head.includes("ゲスト（未登録）での利用は提供しない"),
      "🔴 開いているのに「提供しない」と書いてある");
  } else {
    assert.ok(!head.includes("2026-09-03 に開けた"),
      "🔴 閉じているのに「開けた」と書いてある");
  }
});
