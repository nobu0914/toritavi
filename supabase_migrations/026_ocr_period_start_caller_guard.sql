-- ============================================================================
-- 🔴 025 の緊急訂正（2026-08-30）——「/api/ai-usage が 503」を直す
--
-- **何が起きたか**: `ocr_period_start` の実行権限を `service_role` だけに
-- したが、**読む側（`/api/ai-usage`）は利用者の認証クライアント
-- （`authenticated` ロール）で呼んでいる。** 権限が無く RPC が失敗し、
-- フェイルクローズが効いて 503 になった。
--
-- **影響**: 残数バッジだけ。スキャン本体（`/api/ocr`）は無事。
--
-- **なぜ間違えたか**: 隣の `increment_ocr_usage_srv` が service_role 専用
-- なのを見て「揃える」と判断したが、**あちらは書き込みでサーバから
-- service client で呼ぶ。こちらは読み取りで利用者の client から呼ぶ。**
-- 呼び出し元が違うのに権限だけ揃えた。
--
-- **直し方**: `authenticated` に実行を許すが、**他人の期間は引けなくする。**
-- 単に grant を戻すと、ログイン済みの誰でも任意の user_id を渡せてしまう。
-- ============================================================================

create or replace function public.ocr_period_start(p_user_id uuid)
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $$
DECLARE
  v_today  DATE := (now() AT TIME ZONE 'Asia/Tokyo')::DATE;
  v_anchor DATE;
  v_k      INT;
  v_start  DATE;
BEGIN
  -- 🔴 **利用者として呼ばれたら、自分の分しか引けない。**
  --    `auth.uid()` は service_role で呼ぶと null になるので、
  --    サーバ側の呼び出し（増分 RPC）はそのまま通る。
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT period_anchor INTO v_anchor
  FROM toritavi_user_plan
  WHERE user_id = p_user_id AND plan = 'pro';

  IF v_anchor IS NULL OR v_anchor > v_today THEN
    RETURN date_trunc('month', v_today)::DATE;
  END IF;

  v_k := (EXTRACT(YEAR FROM v_today)::INT - EXTRACT(YEAR FROM v_anchor)::INT) * 12
       + (EXTRACT(MONTH FROM v_today)::INT - EXTRACT(MONTH FROM v_anchor)::INT);
  v_start := (v_anchor + (v_k || ' month')::INTERVAL)::DATE;

  IF v_start > v_today THEN
    v_start := (v_anchor + ((v_k - 1) || ' month')::INTERVAL)::DATE;
  END IF;

  RETURN v_start;
END; $$;

revoke all on function public.ocr_period_start(uuid) from public, anon;
grant execute on function public.ocr_period_start(uuid) to authenticated, service_role;

-- 確認。authenticated と service_role の両方が付くこと。
select proname, proacl::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname = 'ocr_period_start';
