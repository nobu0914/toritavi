-- ============================================================================
-- 029: 使われなくなった匿名（ゲスト）利用者を掃除する
--
-- 🔴 **人が Supabase SQL Editor で実行する**（CLAUDE.md §4）。
--
-- ## なぜ要るか
--
-- 会員は自分で退会しに来る。**匿名利用者は来ない。**
-- 一度試して消したアプリの匿名行が `auth.users` に残り続け、
-- ぶら下がる旅程・スキャン画像も一緒に残る。
-- `docs/guest-mode-spec.md` §7 が「90 日無活動で削除」と定めている。
--
-- ## 🔴 順序を間違えると写真が永久に残る
--
-- `CLAUDE.md` §6 の危険物と同じ形。`auth.users` を先に消すと CASCADE で
-- 旅程・予定の**行**が消え、`toritavi_expired_scan_steps` は step 行を辿って
-- 写真を列挙するので、**二度と見つからなくなる**。
--
-- そこでこの関数は **`deleted_at` を立てるだけ**にする。
-- 実体の削除は既存の 2 つが順に拾う:
--   ① `purge-scan-images-daily` … 写真の実体（step 行を辿る）
--   ② `purge-soft-deleted-daily` … `deleted_at + 30 日`で行を物理削除
-- **行が消えるのは写真より後。** 既存の並びをそのまま使う。
--
-- 匿名 user 自体の削除は、旅程が物理削除されたあと（＝孤児になったあと）に
-- 別途行う。ここでは**入口を止めるだけ**。
--
-- ## 何をもって「無活動」とするか
--
-- `auth.users.last_sign_in_at`（無ければ `created_at`）が 90 日以上前。
-- **スキャンの有無では見ない** —— 1 度も使わずに放置された行こそ掃除の
-- 対象で、使用記録が無いことを理由に残すと逆になる。
--
-- ## 適用前に確かめる
--
--   select count(*) from auth.users where is_anonymous;   -- いまは 0
--   select proname from pg_proc where proname like 'toritavi_purge%';
-- ============================================================================

create or replace function public.toritavi_soft_delete_stale_guests(
  -- 無活動と見なす日数。**90 日未満を拒否する**（誤って短くすると、
  -- 旅行の前後で少し空けただけの利用者の旅程が消える）。
  stale_days int default 90,
  max_rows int default 500
)
returns TABLE(user_id uuid, journeys_marked int)
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE
  v_cutoff timestamptz;
  v_user   uuid;
  v_n      int;
BEGIN
  IF stale_days < 90 THEN
    RAISE EXCEPTION 'stale_days must be >= 90 (got %)', stale_days;
  END IF;
  v_cutoff := now() - make_interval(days => stale_days);

  FOR v_user IN
    SELECT u.id
    FROM auth.users u
    WHERE u.is_anonymous
      AND coalesce(u.last_sign_in_at, u.created_at) < v_cutoff
      -- まだ生きている旅程を持つ行だけを対象にする（何度流しても増えない）。
      AND EXISTS (
        SELECT 1 FROM toritavi_journeys j
        WHERE j.user_id = u.id AND j.deleted_at IS NULL
      )
    ORDER BY coalesce(u.last_sign_in_at, u.created_at)
    LIMIT max_rows
  LOOP
    -- 🔴 **行は消さない。`deleted_at` を立てるだけ。**
    --    既存の cron が「写真 → 行」の順に拾う。逆順にすると写真が残る。
    UPDATE toritavi_journeys
       SET deleted_at = now()
     WHERE toritavi_journeys.user_id = v_user AND deleted_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    user_id := v_user;
    journeys_marked := v_n;
    RETURN NEXT;
  END LOOP;
END; $$;

comment on function public.toritavi_soft_delete_stale_guests(int, int) is
  '90 日無活動の匿名利用者の旅程に deleted_at を立てる。**行は消さない** —— '
  '写真の回収（purge-scan-images）が step 行を辿るため、行を先に消すと '
  '写真が永久に残る。物理削除は purge-soft-deleted-daily が 30 日後に行う。';

-- サーバ（cron / Edge Function）だけ。
revoke all on function public.toritavi_soft_delete_stale_guests(int, int)
  from public, anon, authenticated;
grant execute on function public.toritavi_soft_delete_stale_guests(int, int)
  to service_role;

-- ============================================================================
-- cron —— **既存の並びの「前」に置く。**
--
--   03:10 これ（deleted_at を立てる）
--   03:20 purge-scan-images-daily（写真の実体）
--   03:50 purge-soft-deleted-daily（行の物理削除・deleted_at + 30 日）
--
-- 同じ日のうちに ① が立て、② が写真を見に行ける。③ は 30 日後。
-- ============================================================================
select cron.schedule(
  'purge-stale-guests-daily',
  '10 3 * * *',
  $$ select public.toritavi_soft_delete_stale_guests(90); $$
);

-- ============================================================================
-- 確認
-- ============================================================================

-- ① 関数と権限（service_role だけ）
select proname, proacl::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'toritavi_soft_delete_stale_guests';

-- ② 90 日未満を拒否すること
do $$
begin
  perform public.toritavi_soft_delete_stale_guests(30);
  raise warning '🔴 30 日で通ってしまった';
exception when others then
  raise notice '✅ 90 日未満は拒否された: %', sqlerrm;
end $$;

-- ③ cron の並び（10 → 20 → 50 の順であること）
select jobname, schedule from cron.job
where jobname in ('purge-stale-guests-daily','purge-scan-images-daily','purge-soft-deleted-daily')
order by schedule;
