"use client";

import { createTheme } from "@mantine/core";

/*
 * Mantine theme — Design direction "Daylight".
 * primary = teal（CTA/active/確定/リンクの「点」）。色面は白と余白で。
 * 実際の色値は design-tokens.css の Mantine bridge が --t-* に再マップする。
 * コンポーネントで色をハードコードせず color="teal" / CSS トークンを使う。
 */

const FONT =
  '"Open Runde", "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic UI", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const theme = createTheme({
  primaryColor: "teal",
  // CTA fill = teal-500 (#12B3AB)。深teal(700)はテキスト/リンクで使用。
  primaryShade: { light: 5, dark: 5 },
  defaultRadius: "md",
  fontFamily: FONT,
  fontFamilyMonospace:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  black: "#14302E",
  white: "#FFFFFF",
  headings: {
    // Daylight: heavy(800) をやめ semibold(600)。
    fontWeight: "600",
    fontFamily: FONT,
  },
  colors: {
    /* Daylight teal scale (50→900)。CTA=5, text/link=7 */
    teal: [
      "#ECFBFA",
      "#D2F4F1",
      "#A7E9E4",
      "#6FD8D1",
      "#2FC3BA",
      "#12B3AB",
      "#0E9A93",
      "#0B7E78",
      "#0A625E",
      "#08433F",
    ],
  },
  radius: {
    xs: "10px",
    sm: "10px",
    md: "16px",
    lg: "20px",
    xl: "20px",
  },
});
