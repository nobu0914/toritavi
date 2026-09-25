/**
 * 利用解析の集計（`toritavi_events`）。
 *
 * ## 🔴 「読めなかった」と「0 件」を分ける
 *
 * この表は**まだ本番に無い**（`supabase/events.sql` は提示用で、適用は人）。
 * 読めなかったときに 0 を返すと、画面は**「誰も使っていない」と嘘をつく**
 * —— しかも表を作ったあとも、権限や名前を間違えたまま永久に「0 件」を
 * 出し続ける。だから読めなかったら `null` を返し、画面は**別の文字**を出す
 * （`FunnelData` と同じ方針。`CLAUDE.md` §5「安全装置は静かに嘘をつかせない」）。
 *
 * ## 🔴 数えるのは「起動」であって「人」ではない
 *
 * 2026-09-13 に利用者が「`user_id` を取らない」と決めた（選択肢 C）ので、
 * この表に**誰かを指す欄は無い。** 数えられるのは `session_id`＝
 * **アプリの起動 1 回**。
 *
 * 🔴 **「人数」と書かない。** 同じ人が 3 回起動すれば 3 と出る。
 *    人数のつもりで読むと、**実際より多い利用者がいるように見える。**
 *    画面の見出しも「起動」で統一すること。
 *
 * 🔴 **日をまたぐ追跡はできない。**「登録した人が後日購入した」は繋がらない。
 *    節目は「**1 回の起動の中でどこまで進んだか**」を数えている。
 *
 * ## 🔴 打ち切ったことを隠さない
 *
 * 行を全部は取らない（上限 `MAX_ROWS`）。上限に当たったら `capped` を立て、
 * 画面が「一部だけ」と明示する。**黙って一部で集計した数字は、正しい数字と
 * 見分けが付かない。**
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient;

/** 1 回に取る行の上限。超えたら `capped`。 */
export const MAX_ROWS = 50000;

export type EventRow = {
  created_at: string;
  session_id: string;
  name: string;
  screen: string | null;
  props: Record<string, unknown> | null;
};

export type ScreenStat = {
  screen: string;
  views: number;
  /** その画面を見た**起動**の数（人数ではない）。 */
  sessions: number;
  /** 滞在ミリ秒の中央値。`ms` を持つ行が無ければ null。 */
  medianMs: number | null;
};

export type TapStat = { target: string; screen: string | null; taps: number };

export type UsageData = {
  /** null は**読めなかった**（0 件ではない）。 */
  rows: number | null;
  /** **起動の数**。人数ではない（同じ人の 3 回は 3）。 */
  sessions: number | null;
  screens: ScreenStat[];
  taps: TapStat[];
  /** 節目に到達した**起動**の数。 */
  milestones: { name: string; sessions: number }[];
  /** 日次の起動数（イベントを出したセッション）。 */
  dailyActive: { day: string; value: number }[];
  capped: boolean;
  /** 読めなかった理由。画面にそのまま出さない（ログと注記用）。 */
  error: string | null;
};

/**
 * 画面に出す節目と、その順番。
 *
 * 🔴 **`events.ts` の `EVENT_NAMES` に足しただけでは、ここに出ない。**
 * `usageFrom` はこの一覧に無い名前を**黙って捨てる**（落ちも警告も出ない）。
 * 2026-09-23 に足した 4 つは、送られていたのに 3 日間ここに出ていなかった。
 * `admin-usage.test.ts` の「節目とラベルは対」がこの対応を見張る。
 */
export const MILESTONES = [
  // 登録 → 読み取り → 旅程 → 購入のファネル
  "signup.started",
  "signup.completed",
  "scan.started",
  "scan.succeeded",
  "journey.created",
  "paywall.shown",
  "purchase.completed",
  // 🔴 ここから下はファネルではなく「その機能が使われているか」（2026-09-23 追加）
  "calendar.opened",
  "concierge.asked",
  "concierge.journey_picked",
  "concierge.limits_opened",
] as const;

/**
 * 節目の日本語。**画面に出すのはこれ**（イベント名は開発者の語）。
 *
 * 🔴 **`MILESTONES` と同じファイルに置く。** 以前は画面側に持っていたため、
 * 一覧に足してもラベルが無く、**`scan.succeeded` のような生の名前が
 * そのまま画面に出る**（落ちない形の欠陥）。
 */
export const MILESTONE_LABEL: Record<string, string> = {
  "signup.started": "登録を始めた",
  "signup.completed": "登録できた",
  "scan.started": "読み取りを押した",
  "scan.succeeded": "読み取れた",
  "journey.created": "旅程ができた",
  "paywall.shown": "購入画面を見た",
  "purchase.completed": "購入した",
  "calendar.opened": "カレンダーを開いた",
  "concierge.asked": "AI に相談した",
  "concierge.journey_picked": "相談する旅程を選んだ",
  "concierge.limits_opened": "制限事項を開いた",
} satisfies Record<(typeof MILESTONES)[number], string>;

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * 行から数える。**取得から切り離してある**ので、偽の DB を組まずに検査できる
 * （`funnelFrom` と同じ方針）。
 *
 * 🔴 **集合で数える。** 1 回の起動で 10 回見ても、その画面の「起動」は 1。
 *    件数で数えると、よく使う 1 回が全体の傾向に見える。
 *
 * 🔴 **これは人数ではない**（`user_id` を取っていない）。
 */
export function usageFrom(rows: EventRow[], capped = false): UsageData {
  const sessions = new Set<string>();
  const screenViews = new Map<string, number>();
  const screenSessions = new Map<string, Set<string>>();
  const screenMs = new Map<string, number[]>();
  const taps = new Map<string, TapStat>();
  const milestoneSessions = new Map<string, Set<string>>();
  const daySessions = new Map<string, Set<string>>();

  for (const r of rows) {
    const sid = r.session_id;
    sessions.add(sid);

    const day = r.created_at.slice(0, 10);
    if (!daySessions.has(day)) daySessions.set(day, new Set());
    daySessions.get(day)!.add(sid);

    if (r.name === "screen.view" && r.screen) {
      screenViews.set(r.screen, (screenViews.get(r.screen) ?? 0) + 1);
      if (!screenSessions.has(r.screen)) screenSessions.set(r.screen, new Set());
      screenSessions.get(r.screen)!.add(sid);
      const ms = r.props?.ms;
      if (typeof ms === "number" && Number.isFinite(ms)) {
        if (!screenMs.has(r.screen)) screenMs.set(r.screen, []);
        screenMs.get(r.screen)!.push(ms);
      }
    }

    if (r.name === "tap") {
      const target = r.props?.target;
      if (typeof target === "string") {
        const key = `${r.screen ?? ""} ${target}`;
        const cur = taps.get(key);
        if (cur) cur.taps += 1;
        else taps.set(key, { target, screen: r.screen, taps: 1 });
      }
    }

    if ((MILESTONES as readonly string[]).includes(r.name)) {
      if (!milestoneSessions.has(r.name)) {
        milestoneSessions.set(r.name, new Set());
      }
      milestoneSessions.get(r.name)!.add(sid);
    }
  }

  const screens: ScreenStat[] = [...screenViews.entries()]
    .map(([screen, views]) => ({
      screen,
      views,
      sessions: screenSessions.get(screen)?.size ?? 0,
      medianMs: median(screenMs.get(screen) ?? []),
    }))
    .sort((a, b) => b.views - a.views);

  return {
    rows: rows.length,
    sessions: sessions.size,
    screens,
    taps: [...taps.values()].sort((a, b) => b.taps - a.taps).slice(0, 30),
    milestones: MILESTONES.map((name) => ({
      name,
      sessions: milestoneSessions.get(name)?.size ?? 0,
    })),
    dailyActive: [...daySessions.entries()]
      .map(([day, s]) => ({ day, value: s.size }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    capped,
    error: null,
  };
}

/** 読めなかったときの形。**0 ではなく null。** */
export function usageUnavailable(error: string): UsageData {
  return {
    rows: null,
    sessions: null,
    screens: [],
    taps: [],
    milestones: [],
    dailyActive: [],
    capped: false,
    error,
  };
}

export async function fetchUsage(
  admin: Client,
  days: number,
): Promise<UsageData> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  try {
    const { data, error } = await admin
      .from("toritavi_events")
      // 🔴 **`user_id` を取らない。** 列が在っても読まない（利用者の決定 C）。
      //    読めば、いつか誰かが集計に使う。
      .select("created_at,session_id,name,screen,props")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);
    // 🔴 **表が無いときもここへ来る**（42P01）。0 件と混ぜない。
    if (error) return usageUnavailable(error.message);
    const rows = (data ?? []) as EventRow[];
    return usageFrom(rows, rows.length >= MAX_ROWS);
  } catch (e) {
    return usageUnavailable(e instanceof Error ? e.message : String(e));
  }
}
