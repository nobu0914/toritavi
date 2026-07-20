/**
 * 運用ガイド Markdown を `##` 見出し単位のセクションへ分割する。
 *
 * /admin/maintenance のタブ 1 枚 = `##` セクション 1 つ。原本
 * （toritavi_app / docs/admin-maintenance-guide.md）に `##` を足すだけで
 * タブが増える。原本側に独自記法を持ち込まないため、タブ表示名や
 * 「状態確認」SQL はアプリ側の SECTION_META で対応付ける。
 */

export type GuideSection = {
  /** `## ` の見出しテキスト（本文にも含めて表示する）。 */
  heading: string;
  /** 見出し行を含む、そのセクションの Markdown。 */
  body: string;
};

export type GuideDoc = {
  /** 最初の `##` より前（H1 と導入文）。H1 と水平線は除去済み。 */
  preamble: string;
  sections: GuideSection[];
};

/**
 * H2 で分割。コードフェンス（``` 内）の `##` では分割しない。
 * `###` は 3 文字目が `#` で `^##\s` に一致しないため巻き込まない。
 */
export function splitGuideByH2(md: string): GuideDoc {
  const lines = md.split("\n");
  const preambleLines: string[] = [];
  const sections: GuideSection[] = [];
  let current: GuideSection | null = null;
  let inFence = false;

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) inFence = !inFence;

    const m = inFence ? null : /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[1], body: `${line}\n` };
      continue;
    }
    if (current) current.body += `${line}\n`;
    else preambleLines.push(line);
  }
  if (current) sections.push(current);

  const preamble = preambleLines
    .filter((l) => !/^#\s/.test(l)) // ページ側に h1 があるので原本の H1 は落とす
    .filter((l) => l.trim() !== "---")
    .join("\n")
    .trim();

  return {
    preamble,
    sections: sections.map((s) => ({ ...s, body: s.body.trimEnd() })),
  };
}
