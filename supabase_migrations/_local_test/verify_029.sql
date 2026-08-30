-- ============================================================================
-- 029（無活動ゲストの掃除）の検証。**ローカルのスタブ DB に対して流す。**
--
-- 🔴 いちばん見たいのは **「行を消していない」**こと。
--    消すと `purge-scan-images` が step 行を辿れず、**写真が永久に残る**
--    （CLAUDE.md §6 の危険物と同じ形）。
-- ============================================================================
\echo '──── 準備 ────'
delete from toritavi_journeys;
delete from auth.users where id::text like '9%';

insert into auth.users (id, is_anonymous, created_at, last_sign_in_at) values
  -- 100 日前に最後のサインイン＝掃除の対象
  ('99999999-0000-0000-0000-000000000001', true, now() - interval '200 days', now() - interval '100 days'),
  -- 10 日前＝対象外
  ('99999999-0000-0000-0000-000000000002', true, now() - interval '200 days', now() - interval '10 days'),
  -- 100 日前だが**会員**＝対象外
  ('99999999-0000-0000-0000-000000000003', false, now() - interval '200 days', now() - interval '100 days'),
  -- 一度もサインインしていない匿名（created_at が 200 日前）＝対象
  ('99999999-0000-0000-0000-000000000004', true, now() - interval '200 days', null);

insert into toritavi_journeys (user_id) values
  ('99999999-0000-0000-0000-000000000001'),
  ('99999999-0000-0000-0000-000000000002'),
  ('99999999-0000-0000-0000-000000000003'),
  ('99999999-0000-0000-0000-000000000004');

-- 🔴 **数字を並べて人が見比べる形にしない。** ここで ✅/🔴 を出す。
--    目視だと、変異検査のときに「どちらが正しいか」を毎回思い出す羽目になる。
do $$
declare n int; rows int; marked int; alive int;
begin
  select count(*) into n from toritavi_soft_delete_stale_guests(90);
  if n = 2 then raise notice '✅ ① 対象は 2 人';
  else raise warning '🔴 ① 対象が % 人（期待 2）', n; end if;

  select count(*) into rows from toritavi_journeys;
  if rows = 4 then raise notice '✅ ② 行は消えていない（4 件）';
  else raise warning '🔴 ② 行数が %（期待 4）—— **消している。写真が永久に残る**', rows; end if;

  select count(*) filter (where deleted_at is not null),
         count(*) filter (where deleted_at is null)
    into marked, alive from toritavi_journeys;
  if marked = 2 and alive = 2 then raise notice '✅ ③ 立ったのは対象の 2 件だけ';
  else raise warning '🔴 ③ 立った=% 生きている=%（期待 2/2）', marked, alive; end if;

  select count(*) into alive from toritavi_journeys
   where deleted_at is null
     and user_id in ('99999999-0000-0000-0000-000000000002',
                     '99999999-0000-0000-0000-000000000003');
  if alive = 2 then raise notice '✅ ④ 会員と最近使った匿名は無傷';
  else raise warning '🔴 ④ 無傷が %（期待 2）', alive; end if;

  select count(*) into n from toritavi_soft_delete_stale_guests(90);
  if n = 0 then raise notice '✅ ⑤ 二回目は 0 件（冪等）';
  else raise warning '🔴 ⑤ 二回目に % 件（期待 0）', n; end if;
end $$;

\echo '──── ⑥ 🔴 90 日未満は拒否 ────'
do $$
begin
  perform toritavi_soft_delete_stale_guests(89);
  raise warning '🔴 89 日で通った';
exception when others then
  raise notice '✅ 拒否: %', sqlerrm;
end $$;
