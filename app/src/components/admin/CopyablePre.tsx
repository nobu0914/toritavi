"use client";

import { useState, type ReactNode } from "react";

/**
 * 運用ガイド内のコードブロック（``` フェンス）にコピーボタンを付ける。
 * ReactMarkdown の `components={{ pre: CopyablePre }}` として使う。
 *
 * **なぜ要るか:** 週次検査（`weekly-inspection.md`）の指示文は数十行あり、
 * 選択してコピーするのが現実的でない。SQL も同じで、途中で改行を拾い損ねると
 * 黙って別の文が実行される。**ボタン 1 つで全文が入ること**を保証する。
 *
 * SECURITY: ここも「コピー」しかしない（CopyableCode と同じ方針）。
 * この画面からコマンドや SQL を実行する導線は持たない。
 */
export default function CopyablePre({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = textOf(children);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 権限が無い / 非セキュアコンテキスト。**成功と偽らない。**
      setCopied(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      {/* 右上のボタンに文字が潜り込まないよう、その分だけ右を空ける。 */}
      <pre style={{ paddingRight: 84 }}>{children}</pre>
      <button
        type="button"
        onClick={copy}
        aria-label="コードをコピー"
        style={{
          position: "absolute",
          top: 20,
          right: 10,
          padding: "5px 11px",
          fontSize: 11,
          fontWeight: 700,
          borderRadius: 6,
          border: "1px solid rgba(232,242,251,.28)",
          background: copied ? "#1F9D6B" : "rgba(232,242,251,.10)",
          color: "#e8f2fb",
          cursor: "pointer",
        }}
      >
        {copied ? "コピーしました" : "コピー"}
      </button>
    </div>
  );
}

/**
 * React の children から素のテキストだけを取り出す。
 *
 * ReactMarkdown は `<pre><code>{文字列}</code></pre>` を渡してくるが、
 * 入れ子の形は将来変わりうるので**再帰で拾う**。要素の型に依存すると、
 * 拾えなくなったときに空文字を静かにコピーすることになる。
 */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return textOf(props?.children);
  }
  return "";
}
