import type { Metadata, Viewport } from "next";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { PullToRefresh } from "@/components/PullToRefresh";
import { theme } from "./theme";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

export const metadata: Metadata = {
  title: "toritavi",
  description: "行動を、前に進める",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" data-mantine-color-scheme="light">
      <head />
      <body>
        <MantineProvider theme={theme} defaultColorScheme="light">
          <Notifications position="bottom-center" style={{ bottom: 80 }} />
          <PullToRefresh>{children}</PullToRefresh>
        </MantineProvider>
      </body>
    </html>
  );
}
