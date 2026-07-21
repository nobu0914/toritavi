-- ============================================================
-- Toritavi: ad / affiliate analytics
-- Run this in the Supabase SQL Editor of the shared "genbox2" project.
--
-- Backs the /admin/analytics dashboard:
--   1. toritavi_affiliate_rates — admin-editable per-program economics.
--      `epc_yen` = 推定 1 クリックあたり収益 (EPC, Earnings Per Click).
--      推定売上 = Σ (program 別クリック数 × epc_yen).
--   2. toritavi_ad_impressions — daily aggregate of Tier B card views,
--      so真の CTR (= clicks / impressions) が出せる。従来はクリックのみ
--      記録され、分母 (表示回数) が無かった。
--   3. increment_ad_impression(program, surface) — SECURITY DEFINER RPC。
--      Flutter クライアントが Tier B カード表示時に呼ぶ日次カウンタ増分。
--
-- SECURITY:
--   - どちらのテーブルも RLS 有効・ポリシー無し (anon/authenticated は
--     default-deny)。読取は service-role (admin 集計)、impressions の
--     書込は SECURITY DEFINER RPC 経由のみ。
--   - affiliate_clicks は Flutter 側 (toritavi_app/supabase/ai_todo_tables.sql)
--     で定義済み。本 migration はそれを前提に集計用の周辺だけを足す。
-- ============================================================

-- ---------- 1. affiliate rates (EPC 単価) ----------
-- ⚠️ 2026-07-21 改訂（本番未適用のうちにファイル自体を修正）:
--   当初この表は program / label / commission_note / active を持ち、プログラム一覧を
--   seed していた。しかしプログラムの**正本は `affiliate_programs`**（承認状態
--   `approved_at` を持ち、アプリの配信可否はそれで決まる）であり、同じ属性が 2 箇所に
--   存在する二重管理になっていた。片方だけ更新されると「管理画面では有効に見えるのに
--   配信されていない」というズレが出る。
--   → 本表は**分析固有の EPC 単価だけ**を持つ。表示に使う属性（有効/手数料メモ/
--     承認状態）は `affiliate_programs` から取る（src/lib/admin-analytics.ts の
--     fetchRates 参照）。プログラム一覧は正本が持つので seed もしない。
--   正本仕様: toritavi_app/docs/monetization-spec.md §4
CREATE TABLE IF NOT EXISTS toritavi_affiliate_rates (
  -- affiliate_programs.program と対応。FK にはしない（正本から外したプログラムの
  -- EPC 履歴を残せるようにするため）。
  program         TEXT PRIMARY KEY,
  epc_yen         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (epc_yen >= 0),
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE toritavi_affiliate_rates ENABLE ROW LEVEL SECURITY;
-- no policies: service-role only.

-- seed しない。一覧は affiliate_programs（正本）が持ち、EPC 行は管理画面で
-- 単価を登録したときに upsert で作られる。

-- ---------- 2. ad impressions (日次集計) ----------
CREATE TABLE IF NOT EXISTS toritavi_ad_impressions (
  day      DATE    NOT NULL DEFAULT CURRENT_DATE,
  program  TEXT    NOT NULL,
  surface  TEXT    NOT NULL DEFAULT 'tasks_tab',
  count    INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (day, program, surface)
);

CREATE INDEX IF NOT EXISTS idx_toritavi_ad_impressions_day
  ON toritavi_ad_impressions (day);

ALTER TABLE toritavi_ad_impressions ENABLE ROW LEVEL SECURITY;
-- no policies: service-role reads; increment_ad_impression (definer) writes.

-- ---------- 3. impression increment RPC ----------
-- Tier B カード表示時にクライアントから呼ぶ。認証済みユーザーのみ。
-- SECURITY DEFINER なので RLS を越えて日次カウンタを増分できる。
CREATE OR REPLACE FUNCTION increment_ad_impression(
  p_program TEXT,
  p_surface TEXT DEFAULT 'tasks_tab'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 未認証は無視（匿名からの水増しを防ぐ）。
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF p_program IS NULL OR p_program = '' THEN
    RETURN;
  END IF;
  INSERT INTO toritavi_ad_impressions (day, program, surface, count)
  VALUES (CURRENT_DATE, p_program, COALESCE(NULLIF(p_surface, ''), 'tasks_tab'), 1)
  ON CONFLICT (day, program, surface)
  DO UPDATE SET count = toritavi_ad_impressions.count + 1;
END;
$$;

REVOKE ALL ON FUNCTION increment_ad_impression(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_ad_impression(TEXT, TEXT) TO authenticated;

-- Optional retention (impressions は日次集計なので肥大は緩やかだが、必要なら):
--   DELETE FROM toritavi_ad_impressions WHERE day < CURRENT_DATE - INTERVAL '400 days';
