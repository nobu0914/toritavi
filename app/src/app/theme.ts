"use client";

import { createTheme } from "@mantine/core";

/*
 * Mantine theme bridged to Design System v2 tokens.
 * Color palettes are derived from DS ink + accent scales.
 * Do not hard-code colors in components; use `color="brand"`, `color="accent"`,
 * or reference CSS tokens via globals.css / design-tokens.css.
 */

export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: {
    light: 8,
    dark: 7,
  },
  defaultRadius: "lg",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic UI', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  fontFamilyMonospace:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  black: "#0F1B2D",
  white: "#FFFFFF",
  headings: {
    fontWeight: "800",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic UI', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  colors: {
    /* brand: DS ink scale (navy). Shade 8 = --ink-800 (primary) */
    brand: [
      "#F2F4F8",
      "#D9DEE7",
      "#B2BCCC",
      "#8594AB",
      "#5A6B85",
      "#3C4B64",
      "#253348",
      "#17233A",
      "#0F1B2D",
      "#0A1322",
    ],
    /* accent: DS warm orange. Shade 5 = --accent-500 (CTA) */
    accent: [
      "#FFF0EC",
      "#FFDBCF",
      "#FFB89B",
      "#FF9976",
      "#FF7549",
      "#FF5722",
      "#EA461A",
      "#C93A14",
      "#A02F10",
      "#7A230C",
    ],
    /* Info/action blue — used for links, active states */
    sky: [
      "#EEF2FF",
      "#E6F0FF",
      "#C7DAFF",
      "#97B9FF",
      "#6691FA",
      "#3B82F6",
      "#2A6BD8",
      "#1D4ED8",
      "#1B3FA8",
      "#162F80",
    ],
  },
  shadows: {
    xs: "0 1px 2px rgba(15, 27, 45, 0.05)",
    sm: "0 2px 8px rgba(15, 27, 45, 0.06)",
    md: "0 6px 18px rgba(15, 27, 45, 0.08)",
    lg: "0 12px 32px rgba(15, 27, 45, 0.12)",
    xl: "0 24px 56px rgba(15, 27, 45, 0.16)",
  },
  radius: {
    xs: "8px",
    sm: "8px",
    md: "14px",
    lg: "20px",
    xl: "28px",
  },
});
