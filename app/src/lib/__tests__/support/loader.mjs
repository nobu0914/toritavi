/**
 * node --test 用のモジュールローダー。
 *
 * 目的: **route.ts（API ルート本体）をテストから実行する**ため。
 * 純粋関数だけを切り出して見ていた間、route 側の配線（catch の中身・
 * TRANSFER の分岐・タイブレークの向き）は一度も動かされておらず、
 * 「中身を潰してもテストが緑」だった（2026-08-30）。
 *
 * やること:
 *  1. `@/x` を `src/x` に解決する（tsconfig の paths と同じ）
 *  2. Next.js でしか解決できないモジュールをスタブに差し替える:
 *     - `next/server`   … NextResponse.json / NextRequest の最小実装
 *     - `server-only`   … 空モジュール（本物は import しただけで throw する）
 *     - `@/lib/supabase-server`  … authenticateRequest をテストが注入できる形に
 *     - `@/lib/supabase-service` … createServiceClient をテストが注入できる形に
 *  3. 拡張子なしの相対 import（例: ai-guard.ts の "./plan-resolve"）に
 *     .ts / .tsx を補う（node の ESM は拡張子必須のため）
 *
 * 🔴 差し替えるのは **Next.js の器と DB クライアントの生成だけ**。
 * ルート本体・ai-guard・moderation・署名検証は**本物が動く**。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const supportDir = path.dirname(fileURLToPath(import.meta.url));
// support/ → __tests__/ → lib/ → src/
const srcRoot = path.resolve(supportDir, "../../..");

const stubs = {
  "server-only": pathToFileURL(path.join(supportDir, "stubs/server-only.mjs")).href,
  "next/server": pathToFileURL(path.join(supportDir, "stubs/next-server.mjs")).href,
  "next/headers": pathToFileURL(path.join(supportDir, "stubs/next-headers.mjs")).href,
  "@/lib/supabase-server": pathToFileURL(
    path.join(supportDir, "stubs/supabase-server.mjs"),
  ).href,
  "@/lib/supabase-service": pathToFileURL(
    path.join(supportDir, "stubs/supabase-service.mjs"),
  ).href,
};

export function resolve(specifier, context, nextResolve) {
  if (specifier in stubs) {
    return { url: stubs[specifier], shortCircuit: true };
  }

  let s = specifier;
  if (s.startsWith("@/")) {
    s = pathToFileURL(path.join(srcRoot, s.slice(2))).href;
  }

  try {
    return nextResolve(s, context);
  } catch (err) {
    // 拡張子なしの .ts / .tsx を補って再試行。
    const isPathLike =
      s.startsWith("./") || s.startsWith("../") || s.startsWith("file:");
    if (isPathLike) {
      const base = s.startsWith("file:")
        ? fileURLToPath(s)
        : path.resolve(path.dirname(fileURLToPath(context.parentURL)), s);
      for (const ext of [".ts", ".tsx", ".mts"]) {
        if (existsSync(base + ext)) {
          return nextResolve(pathToFileURL(base + ext).href, context);
        }
      }
    }
    throw err;
  }
}
