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
  title: "Curlew",
  description: "行動を、前に進める",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    // Daylight: 白ヘッダーなので暗いテキストのステータスバー。
    statusBarStyle: "default",
    title: "Curlew",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#12B3AB",
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
