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
    /* ブランドスケール (50→900)。CTA=5, text/link=7。
       **キー名は `teal` のまま据え置く。** `primaryColor` と全ての
       `color="teal"` 指定がこれを指しており、改名はリスクだけあって
       利益がない（アプリ側で `AppColors.tealTint` を据え置いたのと同じ判断）。
       中身は blue。正本は `~/Dev/toritavi/mock/design-tokens-Blue.css`。 */
    teal: [
      "#EAF6FE",
      "#CFEAFD",
      "#A6E1FB",
      "#54C5F8",
      "#29B6F6",
      "#1184C7",
      "#0E72AE",
      "#0C6296",
      "#02579A",
      "#023964",
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
