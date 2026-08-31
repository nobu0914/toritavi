-- ============================================================================
-- 030（上限のキーを書き手にも通す）の検証。
--
-- 🔴 見たいのは 1 点 —— **書き手と読み手が同じ行を見ること。**
--    これがずれると、実機で起きたとおり「使ったのにバッジが 0」になる。
-- ============================================================================
\echo '──── 準備 ────'
delete from toritavi_ocr_usage_monthly;
delete from toritavi_ocr_requests;
delete from auth.users where id::text like '7%';
insert into auth.users (id, is_anonymous) values
  ('77777777-0000-0000-0000-000000000001', true),   -- ゲスト
  ('77777777-0000-0000-0000-000000000002', false),  -- 無料
  ('77777777-0000-0000-0000-000000000003', false)   -- Pro（40 日前に契約）
on conflict (id) do update set is_anonymous=excluded.is_anonymous;
insert into toritavi_user_plan (user_id, plan, period_anchor)
values ('77777777-0000-0000-0000-000000000003','pro',(now() at time zone 'Asia/Tokyo')::date - 40)
on conflict (user_id) do update set plan='pro', period_anchor=excluded.period_anchor;

do $$
declare
  g uuid := '77777777-0000-0000-0000-000000000001';
  f uuid := '77777777-0000-0000-0000-000000000002';
  p uuid := '77777777-0000-0000-0000-000000000003';
  r record; wrote date; reads date; n int;
begin
  -- 1 件ずつ予約して成功精算する。
  foreach wrote in array array[null::date] loop end loop;  -- noop
  perform toritavi_ocr_begin_request(gen_random_uuid(), g, 'guest', 1, 3, 1, 100, 500000, 100, 100);
  perform toritavi_ocr_begin_request(gen_random_uuid(), f, 'free',  1, 5, 1, 100, 500000, 100, 100);
  perform toritavi_ocr_begin_request(gen_random_uuid(), p, 'pro',   1, 50,1, 100, 3000000,100, 100);

  for r in select unnest(array[g,f,p]) as uid, unnest(array['ゲスト','無料','Pro']) as who loop
    select month into wrote from toritavi_ocr_usage_monthly where user_id = r.uid;
    reads := public.ocr_period_start(r.uid);
    if wrote = reads then
      raise notice '✅ % 書き手=% 読み手=% （一致）', r.who, wrote, reads;
    else
      raise warning '🔴 % 書き手=% 読み手=% （**食い違い＝バッジが嘘をつく**）', r.who, wrote, reads;
    end if;
  end loop;

  -- ゲストは番兵、無料は暦月、Pro は契約日起点であること。
  select month into wrote from toritavi_ocr_usage_monthly where user_id = g;
  if wrote = date '1970-01-01' then raise notice '✅ ゲストは番兵（生涯）';
  else raise warning '🔴 ゲストのキーが %（期待 1970-01-01）', wrote; end if;

  select month into wrote from toritavi_ocr_usage_monthly where user_id = p;
  if wrote <> date_trunc('month',(now() at time zone 'Asia/Tokyo'))::date
  then raise notice '✅ Pro は契約日起点（% ）', wrote;
  else raise warning '🔴 Pro が暦月のまま（%）', wrote; end if;
end $$;

\echo '──── 台帳に quota キーが残っているか（settle が同じ行を触るため）────'
do $$
declare n int;
begin
  select count(*) into n from toritavi_ocr_requests where period_quota is not null;
  if n = 3 then raise notice '✅ 3 件すべてに period_quota';
  else raise warning '🔴 period_quota が % 件（期待 3）', n; end if;
end $$;

\echo '──── 🔴 上限が効くか（ゲストの 4 件目が通らない）────'
do $$
declare g uuid := '77777777-0000-0000-0000-000000000001'; st text; n int;
begin
  -- 返りは TABLE(status text, used_after int, cached jsonb)。
  perform toritavi_ocr_begin_request(gen_random_uuid(), g,'guest',1,3,1,100,500000,100,100);
  perform toritavi_ocr_begin_request(gen_random_uuid(), g,'guest',1,3,1,100,500000,100,100);
  select status into st
    from toritavi_ocr_begin_request(gen_random_uuid(), g,'guest',1,3,1,100,500000,100,100);
  select requests_count into n from toritavi_ocr_usage_monthly where user_id = g;
  if st <> 'ok' then raise notice '✅ 4 件目は通らない（status=%・使用=%）', st, n;
  else raise warning '🔴 4 件目が通った（status=%・使用=%）—— 上限が効いていない', st, n; end if;
end $$;
