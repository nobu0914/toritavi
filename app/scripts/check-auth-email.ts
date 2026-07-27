/**
 * 認証メールとパスワード再設定の経路を機械的に検査する。
 *
 * ## なぜ要るのか
 *
 * 2026-07-27 に、ここで実際に壊れていたものが 3 つ見つかった。
 * **どれも「テストが緑」では見つからない**（そもそもテストが無かった）:
 *
 *   1. Supabase 側のテンプレート 4 種が **GenBox（別サービス）のまま**だった。
 *      登録した人全員に「GenBox — 取引ファイル管理システム」が届いていた
 *   2. 正本 `email-templates.ts` の社名が **`株式会社コヨーテ・アンド・パウエル`**。
 *      正しくは `合同会社 Coyote and Powell`。法務ページ 4 種はすべて正しく、
 *      **このファイルだけが外れていた**
 *   3. 貼り付け時に Monaco が `</div>` の後ろへ **`>` を 1 つ自動補完**していた。
 *      読み戻さなければ本文末尾に `>` が混じったまま配信されていた
 *
 * どれも「送ってみないと分からない」ものではない。**送る前に分かる。**
 *
 * ## 使い方
 *
 *   npx tsx scripts/check-auth-email.ts          # 静的検査のみ（ネットワーク不要）
 *   npx tsx scripts/check-auth-email.ts --live   # 本番のエンドポイントも叩く
 *
 * `--live` でも**メールは 1 通も送らない**。送信を伴う確認は人がやる
 * （下の「この検査で分からないこと」）。
 *
 * ## この検査で分からないこと
 *
 * **実際にメールが届くか**と、**リンクを踏んで /reset-password に着くか**。
 * 前者は Resend / Supabase SMTP の設定次第で、後者は PKCE の
 * `code_verifier` を持つブラウザが要る。
 *
 * 後者を自動化できないのは実装の都合ではなく、**いまの設計そのもの**が
 * 理由。`{{ .ConfirmationURL }}` は PKCE で、申請したブラウザ以外では
 * 成立しない（2026-07-27 に実測。Firefox で申請 → Chrome で開く = 失敗、
 * Firefox で完結 = 成功）。**「PC で申請してスマホで開く」が動かないのと、
 * ヘッドレスで検査できないのは同じ原因。**
 * `{{ .TokenHash }}` ＋ `/auth/confirm` の `verifyOtp` に寄せれば、
 * 端末をまたげるようになると同時に、この検査で最後まで追えるようになる。
 */
import { EMAIL_TEMPLATES, SUPABASE_PROJECT } from "../src/lib/email-templates";

const LIVE = process.argv.includes("--live");
const ORIGIN = process.env.CHECK_ORIGIN ?? "https://junros.coyoteandpowell.com";
const LEGACY_ORIGIN = "https://curlew.coyoteandpowell.com";

/** 法務ページ 4 種（プライバシー・規約・特商法・会社サイト）と同じ表記。 */
const COMPANY = "合同会社 Coyote and Powell";
/** 対ユーザー名称。内部コード名が漏れたらバグ（CLAUDE.md §1）。 */
const BRAND = "JUNROS";
const INTERNAL_NAMES = ["toritavi", "curlew", "GenBox", "genbox"];

let failed = 0;
const ok = (m: string) => console.log(`✅ ${m}`);
const ng = (m: string) => {
  console.log(`❌ ${m}`);
  failed = 1;
};
const section = (m: string) => console.log(`\n════ ${m} ════`);

function check(cond: boolean, pass: string, fail: string) {
  cond ? ok(pass) : ng(fail);
}

// ───────────────────────────────────────────── 1) 正本テンプレート
section("1) 正本テンプレート（src/lib/email-templates.ts）");

check(
  EMAIL_TEMPLATES.length === 4,
  `テンプレート ${EMAIL_TEMPLATES.length} 種`,
  `テンプレートが ${EMAIL_TEMPLATES.length} 種しかない（4 種のはず）`,
);

for (const t of EMAIL_TEMPLATES) {
  const p = `[${t.key}]`;
  const html = t.html;

  check(
    t.subject.startsWith(`【${BRAND}】`),
    `${p} 件名が 【${BRAND}】 で始まる`,
    `${p} 件名が 【${BRAND}】 で始まらない: ${t.subject}`,
  );

  check(html.includes(BRAND), `${p} 本文に ${BRAND}`, `${p} 本文に ${BRAND} が無い`);

  // **社名は法務ページと一言一句そろえる。** ここだけ違うと、
  // 「利用規約の会社」と「メールの差出人」が別の会社に見える。
  check(
    html.includes(COMPANY),
    `${p} 社名が「${COMPANY}」`,
    `${p} 社名が「${COMPANY}」ではない`,
  );
  check(
    !/株式会社/.test(html),
    `${p} 「株式会社」を含まない`,
    `${p} **会社形態が違う**（株式会社と書かれている）`,
  );

  // 内部コード名や旧サービス名が利用者の目に触れたらバグ。
  for (const bad of INTERNAL_NAMES) {
    check(
      !html.includes(bad),
      `${p} 「${bad}」が本文に無い`,
      `${p} **本文に「${bad}」が出ている**`,
    );
  }

  // ボタンと、ボタンが開かないとき用の素の URL。**2 か所とも必要。**
  const urlCount = (html.match(/\{\{ \.ConfirmationURL \}\}/g) ?? []).length;
  check(
    urlCount === 2,
    `${p} {{ .ConfirmationURL }} が 2 か所`,
    `${p} {{ .ConfirmationURL }} が ${urlCount} か所（ボタン＋素の URL で 2 のはず）`,
  );

  // Monaco の自動補完が入り込んだときに出る形。
  check(
    !/<\/(div|p|a)>>/.test(html),
    `${p} 閉じタグの後ろに余分な > が無い`,
    `${p} **閉じタグの後ろに余分な > がある**（エディタの自動補完の混入）`,
  );

  const open = (html.match(/<div\b/g) ?? []).length;
  const close = (html.match(/<\/div>/g) ?? []).length;
  check(
    open === close,
    `${p} div の開閉が一致（${open}）`,
    `${p} div の開閉が不一致（開 ${open} / 閉 ${close}）`,
  );

  const openP = (html.match(/<p\b/g) ?? []).length;
  const closeP = (html.match(/<\/p>/g) ?? []).length;
  check(
    openP === closeP,
    `${p} p の開閉が一致（${openP}）`,
    `${p} p の開閉が不一致（開 ${openP} / 閉 ${closeP}）`,
  );
}

// 4 種が同じ見た目で届くこと。ヘッダとフッタは共通のはず。
const headers = new Set(EMAIL_TEMPLATES.map((t) => t.html.split("\n")[1]?.trim()));
check(
  headers.size === 1,
  "4 種のヘッダが共通",
  `4 種のヘッダが ${headers.size} 通りに割れている`,
);

// ───────────────────────────────────────────── 2) 反映先
section("2) 反映先の Supabase プロジェクト");

// **組織 genbox の中に複数プロジェクトがある。** 別プロジェクトを触っても
// 何も変わらないので、参照値がずれていないかだけ見る。
check(
  SUPABASE_PROJECT.ref === "hugiyycgsmzhuldewwux",
  `プロジェクト ref = ${SUPABASE_PROJECT.ref}（${SUPABASE_PROJECT.project}）`,
  `プロジェクト ref が変わっている: ${SUPABASE_PROJECT.ref}`,
);
console.log(`ℹ️  貼り付け先: ${SUPABASE_PROJECT.templatesUrl}`);

// ───────────────────────────────────────────── 3) 本番の経路
// **top-level await を使わない。** このリポジトリの tsx は cjs 出力なので
// トップレベルの await が通らない（`npx tsx` がそのまま失敗する）。
async function checkLive() {
  section("3) 本番の経路（メールは送らない）");

  const head = async (url: string, init?: RequestInit) => {
    try {
      return await fetch(url, { redirect: "manual", ...init });
    } catch (e) {
      ng(`${url} に到達できない: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const forgot = await head(`${ORIGIN}/forgot-password`);
  if (forgot) {
    check(
      forgot.status === 200,
      "/forgot-password が開ける",
      `/forgot-password が ${forgot.status}`,
    );
  }

  // code が無いときに黙って通さないこと。**素通しすると、リンクを
  // 踏んでいない人が再設定画面に入れる。**
  const cb = await head(`${ORIGIN}/auth/callback`);
  if (cb) {
    const loc = cb.headers.get("location") ?? "";
    check(
      cb.status >= 300 && cb.status < 400 && loc.includes("error=missing_code"),
      "/auth/callback（code 無し）が missing_code で弾かれる",
      `/auth/callback（code 無し）が ${cb.status} / ${loc || "(location 無し)"}`,
    );
  }

  // `/reset-password` は `proxy.ts` の PUBLIC_PATHS に**意図的に**入っている。
  // リンクを踏んだ直後はまだアプリのセッション判定が通らないため、経路で
  // 閉じると正規の利用者まで弾いてしまう。**ゲートは経路ではなくセッション**で、
  // 画面側が `getSession()` を見て「リンクが無効か期限切れ」を出し、
  // `updateUser()` はセッションが無ければそもそも失敗する。
  //
  // ここを「リダイレクトされるはず」と書いていた版があり、それは
  // **存在しない設計を前提にした誤検知**だった（2026-07-27）。
  // 検査に合わせて実装を閉じると、正規の再設定が動かなくなる。
  const reset = await head(`${ORIGIN}/reset-password`);
  if (reset) {
    check(
      reset.status === 200,
      "/reset-password が開ける（公開経路。実際のゲートはセッション）",
      `/reset-password が ${reset.status}（200 のはず。閉じるとリンクを踏んだ人が入れない）`,
    );
  }

  // 旧ドメインは 307 で junros へ。**307 はメソッドと本文を保つ**ので、
  // 旧 URL のまま残っている webhook 等があっても届く（2026-07-27 の移行）。
  const legacy = await head(`${LEGACY_ORIGIN}/api/webhooks/revenuecat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ probe: true }),
  });
  if (legacy) {
    const loc = legacy.headers.get("location") ?? "";
    check(
      legacy.status === 307 && loc.startsWith(ORIGIN),
      `旧ドメインが 307 で ${ORIGIN} へ転送（POST 保持）`,
      `旧ドメインの転送が ${legacy.status} / ${loc || "(location 無し)"}`,
    );
  }
}

// ───────────────────────────────────────────── まとめ
function summarize() {
console.log("\n════════════════════════════");
if (failed === 0) {
  console.log("🟢 異常なし");
  console.log(
    "\n⚠️  ただし **メールが実際に届くか** と **リンクが機能するか** は\n" +
      "   この検査の外。人がやること:\n" +
      `     1. ${ORIGIN}/forgot-password で自分宛に送信\n` +
      "     2. **申請したのと同じブラウザで**リンクを開く\n" +
      "        （PKCE の code_verifier がそのブラウザにしか無い。\n" +
      "          別ブラウザ・別端末で開くと必ず失敗する）\n" +
      "     3. /reset-password に着けば成功",
  );
} else {
  console.log("🔴 要対応あり（上の ❌ を確認）");
}
process.exit(failed);
}

if (LIVE) {
  checkLive().then(summarize);
} else {
  console.log("\nℹ️  本番の経路は未検査（--live を付けると叩く。メールは送らない）");
  summarize();
}
