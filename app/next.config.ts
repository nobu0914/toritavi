import type { NextConfig } from "next";

// Non-CSP security headers (static).
//
// CSP is set per-request in src/proxy.ts so we can inject a fresh nonce
// into script-src. Putting CSP here would either force 'unsafe-inline'
// (what we're trying to remove) or leak stale config when routes differ.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  // Override Vercel edge's default `access-control-allow-origin: *` on HTML /
  // static responses. Same-origin fetches don't consult ACAO, so restricting
  // here only affects cross-origin attempts, which we don't want to serve.
  { key: "Access-Control-Allow-Origin", value: "https://junros.coyoteandpowell.com" },
  { key: "Vary", value: "Origin" },
];

const nextConfig: NextConfig = {
  devIndicators: {
    position: "top-right",
  },
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    scrollRestoration: true,
  },
  // /admin/maintenance は src/content の Markdown を実行時に読むため、
  // serverless バンドルへ明示的に同梱する（トレースだけでは拾われない）。
  outputFileTracingIncludes: {
    "/admin/maintenance": ["./src/content/**"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    // 開発用の UI サンプルギャラリー（/ui-sample*, /ui-sample-dads）は
    // 本番ビルドでは公開しない（内部モックが URL 直打ちで見えるのを防ぐ）。
    if (process.env.NODE_ENV !== "production") return [];
    return [
      { source: "/ui-sample", destination: "/", permanent: false },
      { source: "/ui-sample/:path*", destination: "/", permanent: false },
      { source: "/ui-sample-dads", destination: "/", permanent: false },
      { source: "/ui-sample-dads/:path*", destination: "/", permanent: false },

      // ---- 一般利用者向け Web 画面（Phase 1 では提供しない）----
      //
      // Web UI の開発は停止している（CLAUDE.md §9）のに画面は動いていた。
      // とくに /account/plan は **月額 480 円 / 年額 4,800 円を公開しながら、
      // kSubscriptionEnabled=false でどこからも買えない**状態だった。
      //
      // **消さずに閉じる。** Phase 3 で再開する判断があり得るので、復旧は
      // このブロックを落とすだけで済むようにしてある。`permanent: false`
      // （307）なのも同じ理由 —— 恒久リダイレクトはブラウザに焼き付き、
      // 戻したときに効かない。
      //
      // 🔴 /signup を開けるときは、**開ける前に**同意まわりを確認すること。
      //    画面には規約・プライバシーへの同意チェックと13歳以上の確認があり、
      //    同意の版・時刻を signUp の options.data に入れている
      //    （src/lib/legal-consent.ts）。Web とモバイルは同じ auth.users を
      //    共有するので、版の定数はモバイル側の
      //    `~/Dev/toritavi_app/lib/features/auth/domain/legal_consent.dart`
      //    と揃っている必要がある。ずれたまま開けると、登録経路によって
      //    メタデータの形が変わる。
      { source: "/signup", destination: "/", permanent: false },
      { source: "/trips", destination: "/", permanent: false },
      { source: "/trips/:path*", destination: "/", permanent: false },
      { source: "/scan", destination: "/", permanent: false },
      { source: "/concierge", destination: "/", permanent: false },
      { source: "/alerts", destination: "/", permanent: false },
      { source: "/unfiled", destination: "/", permanent: false },
      { source: "/account/plan", destination: "/", permanent: false },
      { source: "/account/profile", destination: "/", permanent: false },
      { source: "/account/notifications", destination: "/", permanent: false },
      { source: "/account/help", destination: "/", permanent: false },

      // ---- ここは閉じない ----
      //
      // /login, /account, /account/data:
      //   **iOS アプリが未リリースなので、今いる利用者は全員 Web 登録者。**
      //   ここを閉じると、その人たちはデータの書き出しもアカウント削除も
      //   できなくなる。削除請求に応えられない状態を作る方が悪い。
      // /forgot-password, /reset-password, /verify-email, /auth/callback:
      //   アプリから送る認証メールの着地点。
      // /admin/*, /api/*:
      //   運用と、アプリが叩くサーバ API。
    ];
  },
};

export default nextConfig;
