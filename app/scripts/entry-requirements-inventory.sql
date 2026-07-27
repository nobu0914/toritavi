-- entry_requirements の棚卸し（**読むだけ**）。
--
-- ## なぜ要るのか
--
-- `EntryRequirement.appliesToNationality()` は
--   `appliesTo.isEmpty || appliesTo.contains(nationality)`
-- で、**`applies_to` が空なら全員対象**に倒している（fail-open）。
-- 渡航情報の安全基準（docs/travel-info-safety.md §3-1）は「閲覧者の国籍が
-- 対象の行のみ」を求めるので、本来は空を除外（fail-close）したい。
--
-- **ただし順序を逆にすると壊れる。** `entry_requirements` はリポジトリに
-- 定義が無く本番 DB にしか存在しない（CLAUDE.md §6「リポジトリに無い本番
-- オブジェクト」）。空の行が多ければ、fail-close にした瞬間に**入国要件が
-- 丸ごと消える**。ビザの見落としは、余分な確認より遥かに重い失敗。
--
-- よって「SQL（読み・確認）→ コード変更」の順で進める。
-- OCR クォータキーで学んだ順序と同じ。
--
-- ## 判断の基準
--
--   3 の `empty_applies_to` が 0 → fail-close に変えてよい
--   0 でない            → その行に applies_to を入れるのが先。コードは触らない

-- 1) 列の型を確認する（text[] か jsonb かで 3 の書き方が変わる）
select column_name, data_type, udt_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'entry_requirements'
 order by ordinal_position;

-- 2) 全体像
select count(*) as rows,
       count(*) filter (where official_url is null or official_url = '')
         as no_official_url,
       count(*) filter (where passport_validity_months is not null)
         as has_passport_months,
       count(distinct country_code) as countries
  from public.entry_requirements;

-- 3) applies_to の分布 —— **ここが本題**
--    text[] の場合:
select coalesce(array_length(applies_to, 1), 0) as n_nationalities,
       count(*) as rows,
       array_agg(country_code order by country_code) as countries
  from public.entry_requirements
 group by 1
 order by 1;

--    jsonb の場合は上を置き換えて:
-- select coalesce(jsonb_array_length(applies_to), 0) as n_nationalities,
--        count(*) as rows,
--        array_agg(country_code order by country_code) as countries
--   from public.entry_requirements
--  group by 1
--  order by 1;

-- 4) 空の行の中身（0 件でなければ、ここを埋めるのが先）
select country_code, requirement_name, requirement_type,
       passport_validity_months, official_url
  from public.entry_requirements
 where applies_to is null
    or array_length(applies_to, 1) is null
 order by country_code;

-- 5) 公式リンクが無い行（§3-4 により、今のコードでは表示されない）
--    「出ない要件」がどれだけあるかを把握する。埋めれば出るようになる。
select country_code, requirement_name, requirement_type, passport_validity_months
  from public.entry_requirements
 where official_url is null or official_url = ''
 order by country_code;
