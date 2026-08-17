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
 * **ログインとアカウント削除は開けたままにする。** 直リンクでは届く。
 * 削除は法令上の権利（個人情報保護法・GDPR 17 条）なので、経路を
 * 完全に塞ぐことはしない。新規登録（`/signup`）は閉じたまま。
 *
 * ## 🔴 「全員 Web で登録した人」は誤りだった（2026-08-17 訂正）
 *
 * ここには長く **「iOS アプリは未リリースなので、いま存在する利用者は
 * 全員 Web で登録した人しかいない」** と書いてあった。**事実と違う。**
 * 登録はアプリからしかできず、Web 画面の開発もしていない
 * （利用者に確認済み）。
 *
 * この記述を根拠に、トップへ「以前 Web で登録された方へ ——
 * ログインすると書き出し（JSON）と削除ができます」という案内を出していたが、
 * **存在しない利用者層に向けた案内**だったので外した。
 *
 * あわせてプライバシーポリシーから「データをエクスポートする機能」の
 * 記述も外している（`company-site` と同日）。**書き出しはアプリに無く、
 * この Web 画面にしか無かった**ので、案内を消したまま公開文書が
 * 機能の存在を主張し続ける状態を避けるため。
 * 法令上の請求経路（メール・30 日以内）は PP に残っている。
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
