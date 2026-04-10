"use client";

import { createTheme } from "@mantine/core";

export const theme = createTheme({
  primaryColor: "blue",
  primaryShade: {
    light: 7,
    dark: 8,
  },
  defaultRadius: "md",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  fontFamilyMonospace:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  black: "#212529",
  white: "#ffffff",
  headings: {
    fontWeight: "700",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  colors: {},
  shadows: {
    xs: "0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.1)",
    md: "0 1px 3px rgba(0,0,0,0.05), rgba(0,0,0,0.05) 0 20px 25px -5px, rgba(0,0,0,0.04) 0 10px 10px -5px",
  },
});
