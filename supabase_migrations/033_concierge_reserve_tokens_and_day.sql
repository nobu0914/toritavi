-- ============================================================
-- 033: コンシェルジュの予約に「トークン」と「予約した日」を持たせる
--      （2026-10-24・夜間検査 3-9 / 3-10）
--
-- 🔴🔴 **人が Supabase の SQL Editor で適用すること。AI は流さない。**
-- 🔴🔴 **サーバのコード（ブランチ `fix/concierge-reserve-1024`）より先に適用する。**
--
--    逆順にすると、新しいコードが `p_day` / `p_est_tokens` 付きで呼んだ時点で
--    PostgREST が関数を見つけられず:
--      - 計上（increment_concierge_usage_srv）が落ちる → **トークンが上限に足されない**
--      - 戻し（toritavi_concierge_release）が落ちる → 枠が 1 つ減ったまま
--    計上が落ちるのは**上限が緩む側**（フェイルオープン）なので、順番は必ず
--    **SQL（この 033）→ サーバ配信**。
--
--    新しい引数はどれも**既定値付き**なので、この SQL を先に当てても
--    **いまのサーバ（旧コード）はそのまま動く**（引数を渡さなければ旧い挙動）。
--    ⚠️ ただし当ててから配信までの間は、予約時に見積りを足し（下の ①）、
--       計上で実トークンを**見積りを引かずに**足すので、**その間の要求は
--       見積りぶん多く数えられる**（上限が早く効く側＝安全側）。配信は間を空けずに。
--
-- 🔴 **begin; ... commit; を丸ごと 1 回で流す。** 旧い関数を落とすのと
--    新しい関数を作るのを 1 つのトランザクションに入れてあるので、
--    「関数が無い」「同じ名前が 2 つあって呼び分けられない」瞬間は外から見えない。
--    確認の select は commit の後ろにある（SQL Editor は最後の結果しか出さないので、
--    確認は 1 文ずつ流し直して見ること）。
--
-- 対象の関数の正本は `toritavi_app/tool/concierge_reopen.sql`（2026-09-23 適用）。
-- 本番の定義（pg_get_functiondef）がそれと一致することを確認したうえで書いている。
-- **このファイルを当てたら、あちらの定義は古くなる**（流し直すと 033 の修正が消える）。
--
-- ============================================================
-- なぜ要るか
--
-- ① 3-9: **予約がトークンを押さえていなかった。**
--    `toritavi_concierge_begin` は `requests_count` だけを足し、トークンは
--    `tokens_total + p_est_tokens <= p_limit_tokens` を**見るだけ**だった。
--    実トークンが足されるのは答えが出たあと（increment_concierge_usage_srv）なので、
--    **同時に投げた要求は、全員が同じ「残りのトークン」を見て通る。**
--    件数は原子的に予約しているのに、トークンだけ「見てから足す」が残っていた。
--    → 予約の時点で見積り（p_est_tokens）を tokens_total に足す。
--      計上では「実トークン − 見積り」を足して、見積りを実績に置き換える。
--
-- ② 3-10: **戻しが「今日」の行を減らしていた。**
--    `toritavi_concierge_release(p_user_id)` は、呼んだ時点の JST の日付の行を
--    減らす。23:59 に予約して 00:00 過ぎに AI が落ちると、**翌日の件数が 1 減る**
--    （前日の予約は戻らず、翌日の枠が 1 つ増える）。
--    → 予約した日を begin が返し（reserved_day）、戻しと計上はその日を受け取る。
--
-- ============================================================
-- 変わる関数
--
--   toritavi_concierge_begin(8 引数)
--     - 予約時に tokens_total へ p_est_tokens を足す
--     - 戻り値に reserved_day（予約した JST の日付・ok のときだけ）を足す
--       → 戻り値の形が変わるので create or replace ではなく drop → create
--
--   toritavi_concierge_release(p_user_id)            ← 落とす
--   toritavi_concierge_release(p_user_id, p_day date default null, p_est_tokens integer default 0)
--     - p_day（null なら今日）の行の requests_count を 1、tokens_total を見積りぶん減らす
--
--   increment_concierge_usage_srv(4 引数)            ← 落とす
--   increment_concierge_usage_srv(4 引数, p_est_tokens integer default 0, p_day date default null)
--     - tokens_total に「実トークン − 見積り」を足す（0 未満にしない）
--     - p_day（null なら今日）の行に足す。**見積りを足した日と同じ日で置き換える**
--       ため（日付をまたいで答えが出ても、翌日の行から見積りを引かない）
--     - 月の予算（全体・利用者ごと）は従来どおり「いまの月」
--
-- 🔴 **旧い署名は同じトランザクションで落とす。** `create or replace` は引数が
--    違えば別の関数として増える。旧い 1 引数の release と、既定値付きの新しい
--    release が並ぶと、`p_user_id` だけの呼び出しが**どちらにも当たって曖昧**になる。
--
-- 🔴 **`revoke ... from public` を落とさない**（CLAUDE.md §7）。PostgreSQL は
--    関数に既定で PUBLIC へ EXECUTE を与えるので、`from anon, authenticated`
--    だけでは**何も落ちない**。2026-09-23 に実際にこの形で当ててしまい、
--    認証済みなら誰でも release を叩いて上限を消せる状態だった。
-- ============================================================

begin;

-- ────────────────────────────────────────────────
-- ① 原子的な予約（見積りのトークンも押さえる・予約した日を返す）
-- ────────────────────────────────────────────────
drop function if exists public.toritavi_concierge_begin(
  uuid, text, integer, integer, integer, integer, integer, integer);

create function public.toritavi_concierge_begin(
  p_user_id       uuid,
  p_audience      text,
  p_limit_requests integer,
  p_limit_tokens   integer,
  p_est_tokens     integer,
  p_budget_cents   integer,
  p_rate_per_min   integer,
  p_user_budget_cents integer
) returns table(status text, used_after integer, reserved_day date)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  -- 🔴 JST。`ai-guard.ts` の `jstToday()` と対。
  --    片方だけ変えると、ずれた時間帯だけ上限が効かない（019 の事故）。
  v_now_jst timestamp := (now() at time zone 'Asia/Tokyo');
  v_day     date := v_now_jst::date;
  v_month   date := date_trunc('month', v_now_jst)::date;
  v_spend   integer;
  v_uspend  integer;
  v_after   integer;
  v_now_cnt integer;
  v_minute  timestamptz := date_trunc('minute', now());
  v_hits    integer;
begin
  if p_user_id is null then raise exception 'user_id required'; end if;
  if p_audience not in ('guest','free','pro') then raise exception 'bad audience'; end if;
  -- 🔴 **不正な値で上限を無効化させない。** 負の上限を渡されると
  --    `a + 1 <= limit` がいくらでも真になる。
  if p_limit_requests is null or p_limit_requests < 0 then
    raise exception 'limit_requests out of range';
  end if;
  if p_limit_tokens is null or p_limit_tokens < 0 then
    raise exception 'limit_tokens out of range';
  end if;
  if p_est_tokens is null or p_est_tokens < 0 then
    raise exception 'est_tokens out of range';
  end if;
  if p_budget_cents is null or p_budget_cents < 0 then
    raise exception 'budget_cents out of range';
  end if;
  if p_rate_per_min is null or p_rate_per_min < 0 then
    raise exception 'rate_per_min out of range';
  end if;
  if p_user_budget_cents is null or p_user_budget_cents < 0 then
    raise exception 'user_budget_cents out of range';
  end if;

  -- 🔴 **非常停止スイッチ。席を取る前に見る。**
  if public.toritavi_ai_mode_blocks('concierge', p_audience) then
    return query select 'ai_disabled'::text, 0, null::date;
    return;
  end if;

  -- 月予算（全体共有）。**無料の枠を守るためのもので、有料には効かせない。**
  if p_audience <> 'pro' then
    select coalesce(spend_cents, 0) into v_spend
      from toritavi_concierge_budget where month = v_month;
    if coalesce(v_spend, 0) >= p_budget_cents then
      select requests_count into v_now_cnt
        from toritavi_concierge_usage
       where user_id = p_user_id and day = v_day;
      return query select 'budget_exceeded'::text, coalesce(v_now_cnt, 0), null::date;
      return;
    end if;
  end if;

  -- 利用者ごとの月次の金額の蓋。0 は「蓋なし」。
  if p_user_budget_cents > 0 then
    select coalesce(spend_cents, 0) into v_uspend
      from toritavi_concierge_user_budget
     where user_id = p_user_id and month = v_month;
    if coalesce(v_uspend, 0) >= p_user_budget_cents then
      select requests_count into v_now_cnt
        from toritavi_concierge_usage
       where user_id = p_user_id and day = v_day;
      return query select 'user_budget_exceeded'::text, coalesce(v_now_cnt, 0), null::date;
      return;
    end if;
  end if;

  -- 🔴 **日初の 1 件目は ON CONFLICT が発火しない**（素の INSERT が通る）。
  --    上限 0 のときに 1 件通るのを防ぐため、先に弾く。
  if p_limit_requests < 1 then
    return query select 'quota_exceeded'::text, 0, null::date;
    return;
  end if;
  -- 分間レート。0 は「常に拒否」。
  if p_rate_per_min < 1 then
    return query select 'rate_limited'::text, 0, null::date;
    return;
  end if;

  insert into toritavi_concierge_rate_buckets (user_id, bucket, hits)
    values (p_user_id, v_minute, 1)
  on conflict (user_id, bucket) do update
     set hits = toritavi_concierge_rate_buckets.hits + 1,
         updated_at = now()
   where toritavi_concierge_rate_buckets.hits + 1 <= p_rate_per_min
  returning toritavi_concierge_rate_buckets.hits into v_hits;

  if v_hits is null then
    select requests_count into v_now_cnt
      from toritavi_concierge_usage
     where user_id = p_user_id and day = v_day;
    return query select 'rate_limited'::text, coalesce(v_now_cnt, 0), null::date;
    return;
  end if;

  delete from toritavi_concierge_rate_buckets
   where user_id = p_user_id and bucket < v_minute - interval '5 minutes';

  -- 見積りだけで上限を超えるなら先に弾く（日初の 1 件目は下の WHERE が効かないため）。
  if p_est_tokens > p_limit_tokens then
    select requests_count into v_now_cnt
      from toritavi_concierge_usage
     where user_id = p_user_id and day = v_day;
    return query select 'quota_tokens'::text, coalesce(v_now_cnt, 0), null::date;
    return;
  end if;

  -- 🔴 **件数と見積りのトークンを、同じ行ロックの下で一緒に押さえる**（033 で変更）。
  --    以前は requests_count だけを足し、トークンは WHERE で見るだけだった ——
  --    同時に投げた要求が全員同じ残りを見て通っていた（3-9）。
  insert into toritavi_concierge_usage
      (user_id, day, requests_count, tokens_total, last_request_at)
    values (p_user_id, v_day, 1, p_est_tokens, now())
  on conflict (user_id, day) do update
     set requests_count  = toritavi_concierge_usage.requests_count + 1,
         tokens_total    = toritavi_concierge_usage.tokens_total + p_est_tokens,
         last_request_at = now()
   where toritavi_concierge_usage.requests_count + 1 <= p_limit_requests
     and toritavi_concierge_usage.tokens_total + p_est_tokens <= p_limit_tokens
  returning toritavi_concierge_usage.requests_count into v_after;

  if v_after is null then
    select requests_count into v_now_cnt
      from toritavi_concierge_usage
     where user_id = p_user_id and day = v_day;
    return query select 'quota_exceeded'::text, coalesce(v_now_cnt, 0), null::date;
    return;
  end if;

  -- 🔴 **予約した日を返す**（033 で追加）。戻しと計上はこの日を渡す（3-10）。
  return query select 'ok'::text, v_after, v_day;
end;
$$;

revoke all on function public.toritavi_concierge_begin(uuid, text, integer, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.toritavi_concierge_begin(uuid, text, integer, integer, integer, integer, integer, integer)
  to service_role;


-- ────────────────────────────────────────────────
-- ② 予約の取り消し（AI が落ちたとき）。**予約した日**の行を、件数 1 と見積りぶん戻す。
--
-- 🔴 **戻し損ねても、上限が緩む方向には壊れない**（フェイルクローズ）。
--    失うのは利用者の枠が 1 減ることだけ。
-- ────────────────────────────────────────────────
drop function if exists public.toritavi_concierge_release(uuid);

create function public.toritavi_concierge_release(
  p_user_id    uuid,
  p_day        date default null,
  p_est_tokens integer default 0
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  -- null は旧い呼び方（日付を持たない）。そのときだけ今日の行を減らす。
  v_day date := coalesce(p_day, (now() at time zone 'Asia/Tokyo')::date);
begin
  if p_user_id is null then raise exception 'user_id required'; end if;
  if p_est_tokens is null or p_est_tokens < 0 then
    raise exception 'est_tokens out of range';
  end if;
  update toritavi_concierge_usage
     set requests_count = greatest(0, requests_count - 1),
         tokens_total   = greatest(0, tokens_total - p_est_tokens)
   where user_id = p_user_id and day = v_day;
end;
$$;

revoke all on function public.toritavi_concierge_release(uuid, date, integer)
  from public, anon, authenticated;
grant execute on function public.toritavi_concierge_release(uuid, date, integer)
  to service_role;


-- ────────────────────────────────────────────────
-- ③ 使用量の記録。見積りを実績に置き換える。
--
-- 🔴 **requests_count はここで足さない**（予約側が足している・2026-09-23 の二重計上の修正）。
-- ────────────────────────────────────────────────
drop function if exists public.increment_concierge_usage_srv(uuid, integer, integer, integer);

create function public.increment_concierge_usage_srv(
  p_user_id    uuid,
  p_tokens_in  integer,
  p_tokens_out integer,
  p_cost_cents integer,
  p_est_tokens integer default 0,
  p_day        date default null
) returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_now_jst timestamp := (now() at time zone 'Asia/Tokyo');
  -- 🔴 トークンは**予約した日**の行で置き換える（見積りを足した日と同じ日）。
  --    月の予算は従来どおり「いまの月」。
  v_day     date := coalesce(p_day, v_now_jst::date);
  v_month   date := date_trunc('month', v_now_jst)::date;
begin
  if p_user_id is null then raise exception 'user_id required'; end if;
  if p_tokens_in < 0 or p_tokens_out < 0 or p_cost_cents < 0 then
    raise exception 'invalid usage args';
  end if;
  if p_est_tokens is null or p_est_tokens < 0 then
    raise exception 'est_tokens out of range';
  end if;
  -- 見積り誤り・改ざんで共有予算を一撃で焼かないための上限。
  if p_cost_cents > 1000 then raise exception 'cost_cents out of range'; end if;

  -- 行が無い ＝ その日に見積りを足していない（予約を通らない呼び方）。
  -- そのときは見積りを引かず、実トークンをそのまま入れる。
  -- 行がある ＝ 予約が見積りを足している。「実 − 見積り」で置き換え、0 未満にしない。
  insert into toritavi_concierge_usage (user_id, day, requests_count, tokens_total, last_request_at)
    values (p_user_id, v_day, 1, p_tokens_in + p_tokens_out, now())
  on conflict (user_id, day) do update set
    tokens_total    = greatest(
                        0,
                        toritavi_concierge_usage.tokens_total + p_tokens_in + p_tokens_out - p_est_tokens
                      ),
    last_request_at = now();

  insert into toritavi_concierge_budget (month, spend_cents, request_count)
    values (v_month, p_cost_cents, 1)
  on conflict (month) do update set
    spend_cents   = toritavi_concierge_budget.spend_cents + p_cost_cents,
    request_count = toritavi_concierge_budget.request_count + 1,
    updated_at    = now();

  insert into toritavi_concierge_user_budget (user_id, month, spend_cents, request_count)
    values (p_user_id, v_month, p_cost_cents, 1)
  on conflict (user_id, month) do update set
    spend_cents   = toritavi_concierge_user_budget.spend_cents + p_cost_cents,
    request_count = toritavi_concierge_user_budget.request_count + 1,
    updated_at    = now();
end;
$$;

revoke all on function public.increment_concierge_usage_srv(uuid, integer, integer, integer, integer, date)
  from public, anon, authenticated;
grant execute on function public.increment_concierge_usage_srv(uuid, integer, integer, integer, integer, date)
  to service_role;

-- PostgREST に関数の形が変わったことを知らせる（Supabase は DDL で自動でも読み直す）。
notify pgrst, 'reload schema';

commit;


-- ============================================================
-- 適用後の確認（人が目で見る。1 文ずつ流す）
-- ============================================================

-- (1) 署名が 1 つずつだけ残っていること（旧い署名が残っていないこと）
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as 関数,
       pg_get_function_result(p.oid) as 戻り値
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('toritavi_concierge_begin','toritavi_concierge_release','increment_concierge_usage_srv')
order by 1;
-- 期待（3 行だけ）:
--   increment_concierge_usage_srv(p_user_id uuid, p_tokens_in integer, p_tokens_out integer,
--     p_cost_cents integer, p_est_tokens integer, p_day date)
--   toritavi_concierge_begin(... 8 引数)  … 戻り値に reserved_day date がある
--   toritavi_concierge_release(p_user_id uuid, p_day date, p_est_tokens integer)

-- (2) 権限。anon / authenticated / PUBLIC に EXECUTE が無いこと
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as 関数,
       array_to_string(p.proacl, ' | ') as 権限,
       has_function_privilege('anon',          p.oid, 'execute') as anon_can,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_can,
       case when p.proacl is null then '🔴 既定（PUBLIC）'
            when array_to_string(p.proacl,',') like '%anon=X%' then '🔴 anon に EXECUTE'
            when array_to_string(p.proacl,',') like '%authenticated=X%' then '🔴 authenticated に EXECUTE'
            when array_to_string(p.proacl,',') ~ '(^|,)=X/' then '🔴 PUBLIC に EXECUTE'
            else '✅ ok' end as 判定
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('toritavi_concierge_begin','toritavi_concierge_release','increment_concierge_usage_srv')
order by 1;
-- 期待: 3 行とも ✅ ok。権限は `postgres=X/postgres | service_role=X/postgres` の 2 つだけ。

-- (3) 挙動（任意・テスト用の uuid で。auth.users に無い uuid は外部キーで弾かれるので、
--     実在する検証用アカウントの uuid に置き換えること。終わったら行を消す）:
--   select * from public.toritavi_concierge_begin('<uuid>'::uuid, 'free', 100, 200000, 1500, 5000, 5, 0);
--     期待: status = ok / reserved_day = 今日（JST）
--   select requests_count, tokens_total from public.toritavi_concierge_usage
--    where user_id = '<uuid>' and day = (now() at time zone 'Asia/Tokyo')::date;
--     期待: tokens_total が 1500 増えている
--   select public.toritavi_concierge_release('<uuid>'::uuid, (now() at time zone 'Asia/Tokyo')::date, 1500);
--     期待: requests_count が 1、tokens_total が 1500 戻る
