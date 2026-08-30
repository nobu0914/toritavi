// `next/headers` のスタブ。テスト経路では使われない想定だが、
// 到達したときに黙って空を返すのではなく、明確に落とす。
export function cookies() {
  throw new Error("next/headers の cookies() はテストでは使えない（スタブ）");
}
