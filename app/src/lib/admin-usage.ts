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
  user_id: string | null;
  session_id: string;
  name: string;
  screen: string | null;
  props: Record<string, unknown> | null;
};

export type ScreenStat = {
  screen: string;
  views: number;
  users: number;
  /** 滞在ミリ秒の中央値。`ms` を持つ行が無ければ null。 */
  medianMs: number | null;
};

export type TapStat = { target: string; screen: string | null; taps: number };

export type UsageData = {
  /** null は**読めなかった**（0 件ではない）。 */
  rows: number | null;
  users: number | null;
  sessions: number | null;
  screens: ScreenStat[];
  taps: TapStat[];
  milestones: { name: string; users: number }[];
  /** 日次のアクティブ利用者（イベントを出した人）。 */
  dailyActive: { day: string; value: number }[];
  capped: boolean;
  /** 読めなかった理由。画面にそのまま出さない（ログと注記用）。 */
  error: string | null;
};

/** 画面に出す節目と、その順番。 */
export const MILESTONES = [
  "signup.started",
  "signup.completed",
  "scan.started",
  "scan.succeeded",
  "journey.created",
  "paywall.shown",
  "purchase.completed",
] as const;

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * 行から数える。**取得から切り離してある**ので、偽の DB を組まずに検査できる
 * （`funnelFrom` と同じ方針）。
 *
 * 🔴 **人数は集合で数える。** 1 人が 10 回見ても 1 人。件数で数えると、
 *    よく使う 1 人が全体の傾向に見える。
 */
export function usageFrom(rows: EventRow[], capped = false): UsageData {
  const users = new Set<string>();
  const sessions = new Set<string>();
  const screenViews = new Map<string, number>();
  const screenUsers = new Map<string, Set<string>>();
  const screenMs = new Map<string, number[]>();
  const taps = new Map<string, TapStat>();
  const milestoneUsers = new Map<string, Set<string>>();
  const dayUsers = new Map<string, Set<string>>();

  for (const r of rows) {
    // 🔴 **未ログインは人数に数えない。** user_id が null の行は「誰か
    //    分からない 1 件」で、数えると**同じ人の複数回が別人になる。**
    //    規模は session の数で見る。
    const uid = r.user_id;
    if (uid) users.add(uid);
    sessions.add(r.session_id);

    const day = r.created_at.slice(0, 10);
    if (uid) {
      if (!dayUsers.has(day)) dayUsers.set(day, new Set());
      dayUsers.get(day)!.add(uid);
    }

    if (r.name === "screen.view" && r.screen) {
      screenViews.set(r.screen, (screenViews.get(r.screen) ?? 0) + 1);
      if (uid) {
        if (!screenUsers.has(r.screen)) screenUsers.set(r.screen, new Set());
        screenUsers.get(r.screen)!.add(uid);
      }
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

    if ((MILESTONES as readonly string[]).includes(r.name) && uid) {
      if (!milestoneUsers.has(r.name)) milestoneUsers.set(r.name, new Set());
      milestoneUsers.get(r.name)!.add(uid);
    }
  }

  const screens: ScreenStat[] = [...screenViews.entries()]
    .map(([screen, views]) => ({
      screen,
      views,
      users: screenUsers.get(screen)?.size ?? 0,
      medianMs: median(screenMs.get(screen) ?? []),
    }))
    .sort((a, b) => b.views - a.views);

  return {
    rows: rows.length,
    users: users.size,
    sessions: sessions.size,
    screens,
    taps: [...taps.values()].sort((a, b) => b.taps - a.taps).slice(0, 30),
    milestones: MILESTONES.map((name) => ({
      name,
      users: milestoneUsers.get(name)?.size ?? 0,
    })),
    dailyActive: [...dayUsers.entries()]
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
    users: null,
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
      .select("created_at,user_id,session_id,name,screen,props")
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
