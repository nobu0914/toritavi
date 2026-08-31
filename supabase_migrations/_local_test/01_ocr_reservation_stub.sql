-- ============================================================================
-- 030 を手元で試すための最小スキーマ。**本番の形（情報スキーマ）から写した。**
--
-- 🔴 本番にしか定義が無い表（`CLAUDE.md` §6）なので、リポジトリの SQL からは
--    組み立てられない。**主キーと必須制約だけ足してある**（`on conflict` が
--    要るため）。データは一切含まない。
-- ============================================================================
create table if not exists public.toritavi_ocr_requests (
  request_id uuid primary key, user_id uuid not null, audience text,
  state text, units integer, est_cost_cents integer, est_tokens integer default 0,
  counted_input_tokens integer, reserved_input_tokens integer,
  actual_input_tokens integer, actual_output_tokens integer,
  period_day date, period_month date, actual_cost_cents integer,
  fail_reason text, result jsonb, result_expires_at timestamptz,
  created_at timestamptz default now(), settled_at timestamptz);

create table if not exists public.toritavi_ai_budget (
  feature text, audience text, period text, period_key date,
  reserved_cents integer default 0, spent_cents integer default 0,
  request_count integer default 0, updated_at timestamptz default now(),
  primary key (feature, audience, period, period_key));

create table if not exists public.toritavi_ai_budget_limits (
  feature text, audience text, period text, limit_cents integer,
  primary key (feature, audience, period));

insert into public.toritavi_ai_budget_limits values
  ('ocr','guest','day',300),('ocr','guest','month',3000),
  ('ocr','free','day',500),('ocr','free','month',5000),
  ('ocr','pro','day',100000),('ocr','pro','month',999999)
on conflict do nothing;

-- 非常停止（030 の関数が呼ぶ）。**常に false**＝止めない。
create or replace function public.toritavi_ai_mode_blocks(p_feature text, p_audience text)
returns boolean language sql stable as $$ select false $$;

-- 🔴 **本番にあって、リポジトリの移行では作られない列**を足す。
--    無いと 030 が「列が無い」で落ち、**実物と違う形を検査する**ことになる。
alter table public.toritavi_ocr_usage_monthly
  add column if not exists tokens_reserved integer default 0;
alter table public.toritavi_user_plan
  add column if not exists period_anchor date;

-- 月次の使用量に主キーを足す（`on conflict (user_id, month)` が要る）。
do $$ begin
  alter table public.toritavi_ocr_usage_monthly
    add constraint toritavi_ocr_usage_monthly_pkey primary key (user_id, month);
exception when others then null; end $$;
