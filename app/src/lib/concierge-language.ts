/**
 * AI相談の回答言語（2026-10-04・訪日客向けの改修 1・利用者の決定）。
 *
 * システムプロンプトの本体（`SYSTEM_PROMPT_HEAD`）は「日本語、簡潔」と書いてあり、
 * **英語で使う人にも日本語で答えていた**（`lang` はエラー文にしか使っていなかった）。
 *
 * 🔴 **日本語の利用者には何も足さない**（空文字）。公開中の利用者の
 *    プロンプトは 1 文字も変わらない（`concierge-language.test.ts` が見張る）。
 */
import type { Lang } from "./api-messages";

export function buildLanguageBlock(lang: Lang): string {
  if (lang === "ja") return "";
  return `

## Answer language (this overrides the 日本語 rule above)
- The user reads the app in English. Write every reply in English, including the short note that accompanies a tool call.
- Keep Japanese proper nouns (stations, trains, hotels, shops, places) as written, and add the English reading in parentheses the first time, e.g. 新大阪 (Shin-Osaka), のぞみ 21号 (Nozomi 21).
- Do not assume Japanese nationality. For entry, visa or passport questions, ask the user's nationality or state the premise explicitly before answering, and point to official government sources.
`;
}
