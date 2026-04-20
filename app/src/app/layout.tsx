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
  title: "toritavi",
  description: "行動を、前に進める",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "toritavi",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0F1B2D",
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
