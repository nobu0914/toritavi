import type { Metadata, Viewport } from "next";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { PullToRefresh } from "@/components/PullToRefresh";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { theme } from "./theme";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

export const metadata: Metadata = {
  title: "toritavi",
  description: "行動を、前に進める",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "toritavi",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1c7ed6",
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
          <PullToRefresh>{children}</PullToRefresh>
        </MantineProvider>
      </body>
    </html>
  );
}
