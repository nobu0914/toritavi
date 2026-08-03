import type { Metadata, Viewport } from "next";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { theme } from "./theme";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./design-tokens.css";
import "./globals.css";

// CSP nonces (set in src/proxy.ts) require every rendered page to pick up
// the fresh per-request nonce, which is impossible if the page is
// prerendered at build time. Force dynamic rendering app-wide so Next.js
// injects the current request's nonce into its bootstrap scripts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JUNROS — 散らばった旅の予定を、ひとまとめに。",
  // 軸の一言。**アプリ名・サブタイトル・製品ページ・スクリーンショットと
  // 一字一句そろえる**（toritavi_app の docs/app-store-listing.md §1）。
  // 旧文言は "行動を、前に進める"。2026-08-01 に軸を確定したときに
  // ここだけ取り残されていた。
  description:
    "散らばった旅の予定を、ひとまとめに。航空券やホテルの予約票を撮る／選ぶだけ。AIが読み取り、予定順に整理します。",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    // Daylight: 白ヘッダーなので暗いテキストのステータスバー。
    statusBarStyle: "default",
    title: "JUNROS",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // ブランド blue = `--t-500`（DS の `--b-500`）。ブラウザの UI 着色に出るので
  // トークンとずれると、アドレスバーだけ旧色という形で残る。
  themeColor: "#1184C7",
  // Required for env(safe-area-inset-*) to report real values inside the iOS
  // WebView / standalone PWA. Without it the insets are all 0, so the sticky
  // AppHeader, the bottom TabBar and the notifications stack all collide with
  // the status bar / Dynamic Island / home indicator.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" data-mantine-color-scheme="light">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="light">
          <Notifications position="top-center" />
          <ServiceWorkerRegister />
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
