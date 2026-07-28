import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";

/**
 * トップ = 「JUNROS は iPhone アプリです」の 1 枚。
 *
 * ## なぜ旅程一覧を出すのをやめたか
 *
 * Web UI の開発は停止している（`CLAUDE.md` §9）のに、サインアップ・旅程・
 * スキャン・コンシェルジュ・プラン案内が動いたままだった。とくに
 * `/account/plan` は **月額 480 円 / 年額 4,800 円を公開しながら、
 * `kSubscriptionEnabled=false` でどこからも買えない**状態で、
 * 「文言が実装に先行してはならない」の直接の違反になっていた。
 *
 * ## 消さずに閉じている
 *
 * 画面のコードは残し、`next.config.ts` の `redirects()` でここへ寄せている。
 * Phase 3 で Web を再開する判断があり得るため、復旧は redirects の
 * 該当行を落とすだけで済むようにしてある（`TripsClient` も残置）。
 *
 * ## 閉じていないもの
 *
 * **ログインとアカウント削除は開けたままにする。** iOS アプリは未リリース
 * なので、いま存在する利用者は全員 Web で登録した人しかいない。ここを
 * 閉じると、その人たちは自分のデータを持ち出すことも、アカウントを消す
 * ことも一切できなくなる。個人情報保護法・GDPR 17 条の削除請求に
 * 応えられない状態を作る方が、Web を開けておくより悪い。
 * 新規登録（`/signup`）は閉じる ——「これ以上増やさない」だけでよい。
 */
export default function AppOnlyPage() {
  return (
    <AuthShell
      title="JUNROS は iPhone アプリです"
      subtitle="予約メール・航空券・ホテルの控えを撮ると、1 本の旅程になります。"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          fontSize: "var(--fs-sm)",
          lineHeight: 1.7,
          color: "var(--text-body)",
        }}
      >
        <p style={{ margin: 0 }}>
          Web 版のご提供は行っておりません。スキャン・旅程の作成・編集は
          すべて iPhone アプリでご利用ください。
        </p>

        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: "var(--fw-bold)" as never }}>
            以前 Web で登録された方へ
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "var(--fs-xs)",
              color: "var(--text-muted)",
            }}
          >
            ログインすると、これまでのデータの書き出し（JSON）と、アカウントの
            削除ができます。
          </p>
          <Link
            href="/login"
            style={{
              alignSelf: "flex-start",
              color: "var(--info-700)",
              fontWeight: "var(--fw-bold)" as never,
            }}
          >
            ログインして書き出し・削除に進む
          </Link>
        </div>

        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 20,
            fontSize: "var(--fs-xs)",
            color: "var(--text-muted)",
          }}
        >
          お問い合わせ:{" "}
          <a
            href="mailto:info@coyoteandpowell.com"
            style={{ color: "var(--info-700)" }}
          >
            info@coyoteandpowell.com
          </a>
        </div>
      </div>
    </AuthShell>
  );
}
