-- ============================================================================
-- 027（ゲストの期間）の検証。**ローカルのスタブ DB に対して流す。**
--
--   ... 00_supabase_stub.sql → 005 → 012 → 013 → 019 → 021 → 024 → 026 → 027
--   $P -d mtest -f _local_test/verify_027.sql
--
-- 🔴 **「エラーが出ない」を根拠にしない。** 各項目が期待値と一致することを
--    見る。期待値は右の列に書いてある。
-- ============================================================================
\echo '──── 準備 ────'
insert into auth.users (id, is_anonymous) values
  ('11111111-1111-1111-1111-111111111111', true),
  ('22222222-2222-2222-2222-222222222222', false),
  ('33333333-3333-3333-3333-333333333333', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

insert into toritavi_user_plan (user_id, plan, period_anchor)
values ('33333333-3333-3333-3333-333333333333', 'pro',
        (now() at time zone 'Asia/Tokyo')::date - 40)
on conflict (user_id) do update set plan='pro', period_anchor=excluded.period_anchor;

delete from toritavi_ocr_usage_monthly
 where user_id in ('11111111-1111-1111-1111-111111111111',
                   '22222222-2222-2222-2222-222222222222');
create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;

\echo '──── ① 3 者の期間（期待: 生涯 / 暦月 / 契約日起点）────'
select
  case u.id::text
    when '11111111-1111-1111-1111-111111111111' then 'ゲスト'
    when '22222222-2222-2222-2222-222222222222' then '無料'
    else 'Pro' end as 誰,
  ocr_period_start(u.id) as 期間開始,
  case when ocr_period_start(u.id) = date '1970-01-01' then '生涯'
       when ocr_period_start(u.id) = date_trunc('month',(now() at time zone 'Asia/Tokyo'))::date then '暦月'
       else '契約日起点' end as 種別
from auth.users u
where u.id in ('11111111-1111-1111-1111-111111111111',
               '22222222-2222-2222-2222-222222222222',
               '33333333-3333-3333-3333-333333333333')
order by 1;

\echo '──── ② 関門: 他人の期間は引けない（期待: 拒否）────'
create or replace function auth.uid() returns uuid language sql as
  $$ select '22222222-2222-2222-2222-222222222222'::uuid $$;
do $$
begin
  perform ocr_period_start('11111111-1111-1111-1111-111111111111');
  raise warning '🔴 通ってしまった —— 026 の関門が消えている';
exception when others then
  raise notice '✅ 拒否された: %', sqlerrm;
end $$;

\echo '──── ③ ゲストが自分の期間を引ける（残数表示に要る）────'
create or replace function auth.uid() returns uuid language sql as
  $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
do $$
declare d date;
begin
  d := ocr_period_start('11111111-1111-1111-1111-111111111111');
  if d <> date '1970-01-01' then raise warning '🔴 期待と違う: %', d;
  else raise notice '✅ %', d; end if;
end $$;
create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;

\echo '──── ④ ゲストの 3 件が番兵の行に積まれる（期待: 1970-01-01 に 3）────'
select increment_ocr_usage_srv('11111111-1111-1111-1111-111111111111',100,50,1,1);
select increment_ocr_usage_srv('11111111-1111-1111-1111-111111111111',100,50,1,1);
select increment_ocr_usage_srv('11111111-1111-1111-1111-111111111111',100,50,1,1);
select month as 期間キー, requests_count as 使用数
  from toritavi_ocr_usage_monthly
 where user_id='11111111-1111-1111-1111-111111111111';

\echo '──── ⑤ 無料は暦月の別行（期待: 今月 1 日に 1）────'
select increment_ocr_usage_srv('22222222-2222-2222-2222-222222222222',100,50,1,1);
select month as 期間キー, requests_count as 使用数
  from toritavi_ocr_usage_monthly
 where user_id='22222222-2222-2222-2222-222222222222';

\echo '──── ⑥ 登録すると枠が変わる（期待: 1970-01-01 → 今月 1 日）────'
select ocr_period_start('11111111-1111-1111-1111-111111111111') as 登録前;
update auth.users set is_anonymous=false where id='11111111-1111-1111-1111-111111111111';
select ocr_period_start('11111111-1111-1111-1111-111111111111') as 登録後;
update auth.users set is_anonymous=true  where id='11111111-1111-1111-1111-111111111111';

\echo '──── ⑦ 関門とゲスト分岐が本文に残っている（期待: t / t）────'
select position('auth.uid() <> p_user_id' in pg_get_functiondef(p.oid)) > 0 as 関門あり,
       position('is_anonymous' in pg_get_functiondef(p.oid)) > 0 as ゲスト分岐あり
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='ocr_period_start';
