import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 配布物として置いている pdf.js のワーカー（minify 済みの他人のコード）。
    // **自分たちが直せないコードを検査しても、直せない指摘が増えるだけ。**
    // 実際 lint のエラー 11 件のうち 7 件がこの 1 ファイルで、残り 4 件の
    // 本物の指摘が埋もれていた（2026-07-28 の監査で判明）。
    "public/pdf.worker.min.mjs",
  ]),
]);

export default eslintConfig;
