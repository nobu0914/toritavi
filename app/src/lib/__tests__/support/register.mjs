// node --test の起動時に読み込むフック登録（package.json の "test" が --import で渡す）。
// これで route.ts（`next/server` / `@/` alias / "server-only" に依存）を
// **素の node からそのまま実行**できる。詳細は loader.mjs のコメント。
import { registerHooks } from "node:module";
import { resolve } from "./loader.mjs";

registerHooks({ resolve });
