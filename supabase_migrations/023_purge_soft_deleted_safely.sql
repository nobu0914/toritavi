-- ============================================================================
-- 023_purge_soft_deleted_safely.sql
--   論理削除された行の物理削除を、**写真を孤立させずに**定期実行できるようにする。
--
--   きっかけ: 2026-08-02 の週次検査（所見 1-1）。
--
-- ---------------------------------------------------------------------------
-- 何が起きていたか
-- ---------------------------------------------------------------------------
--   020 で `deleted_at`（論理削除）と `purge_soft_deleted()` を入れたが、
--   **cron を設定していなかった**（`cron.job` は `purge-scan-images-daily` の
--   1 本だけ・2026-08-02 に本番で実測）。つまり利用者が削除した旅程・予定の
--   テキスト（便名・確認番号・氏名）が**期限なく残っていた**。
--
--   一方で写真は消える。`toritavi_expired_scan_steps` は `deleted_at` で
--   絞っていないので、論理削除済みの step も通常の保持期限（旅程終了+60日 /
--   日付なし+90日）が来れば retention が回収する。
--   → 現状は「**写真は消えるがテキストは残る**」。
--
-- ---------------------------------------------------------------------------
-- なぜ cron を足すだけでは駄目か（ここが本題）
-- ---------------------------------------------------------------------------
--   `purge_soft_deleted` は **行を DELETE するだけで Storage に触らない。**
--   そして retention は「`toritavi_steps` の行を辿って」対象フォルダを
--   列挙する（`toritavi_expired_scan_steps`）。
--
--   **行が先に消えると、その写真は二度と列挙されない。**
--
--   実際に起きる例:
--     ・今日作った旅程を明日削除
--     ・行の物理削除 = deleted_at + 30日 → 31 日目
--     ・写真の期限   = created_at + 60日（登録猶予の床）→ 60 日目
--     → 31 日目に行が消え、搭乗券の画像が**永久に Storage に残る**
--
--   `scan_image_retention.sql` 冒頭が警告している
--   「写真が消えたつもりで残る」事故と同じ形。テキストの残留を、
--   写真の永久残留と交換することになる。
--
-- ---------------------------------------------------------------------------
-- 対処: 順序に頼らず、構造で不可能にする
-- ---------------------------------------------------------------------------
--   「retention を先に回してから purge を回す」という**時間の約束**にしない。
--   片方の cron が数日止まっただけで破れるうえ、破れても誰も気づけない。
--
--   代わりに `purge_soft_deleted` へ**前提条件**を持たせる:
--
--     ・step 行は、**Storage に自分のファイルが 1 つも残っていないとき**だけ消す
--     ・旅程行は、**配下の step 行が 1 つも残っていないとき**だけ消す
--
--   これで「写真が残っているのに行が消える」は起こりえない。cron の順序・
--   実行間隔・停止に依存しない。写真が消えるまで行は残るが、それは
--   **消え残るより安全な方向**であり、retention が回っている限り有界。
--
--   旅程側の条件は FK の設定に依らず正しい。`toritavi_journeys` →
--   `toritavi_steps` が ON DELETE CASCADE でも、step が 0 件なら
--   カスケードで消えるものが無い。
--
--   ⚠️ Storage の実体削除は**引き続き Edge Function（Storage API）が行う**。
--      この関数は `storage.objects` を **読むだけ**（直接 delete すると
--      S3 に実体バイトが孤立する）。
--
-- ---------------------------------------------------------------------------
-- 適用手順
-- ---------------------------------------------------------------------------
--   1. 本ファイルを Supabase SQL Editor で実行（関数の置き換えのみ・冪等）
--   2. 下の「適用前の観測」で、いま何件溜まっているかを見る
--   3. **まず手で 1 回叩いて結果を見る**（dry-run の代わり）
--   4. 問題なければ cron を登録（末尾）
--
--   ⚠️ 本番 DB への書き込みは人間が実行する（CLAUDE.md §4）。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- (A) 関数の置き換え
-- ---------------------------------------------------------------------------
create or replace function public.purge_soft_deleted(p_retain_days integer default 30)
returns table(purged_journeys bigint, purged_steps bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_cutoff TIMESTAMPTZ := now() - make_interval(days => p_retain_days);
  v_j BIGINT; v_s BIGINT;
BEGIN
  IF p_retain_days < 7 THEN
    RAISE EXCEPTION 'retain_days must be >= 7 (guard against accidental purge)';
  END IF;

  -- 予定: 猶予を過ぎていて、かつ **Storage に自分のファイルが残っていない**もの。
  --
  -- パス規約は {user_id}/{step_id}/{file} なので、2 番目のセグメントが step_id。
  -- 1 行ずつ LIKE で照合すると O(step 数 × オブジェクト数) になるため、
  -- **バケットを 1 回走査して step_id の集合を作り、反結合する。**
  WITH with_files AS (
    SELECT DISTINCT split_part(o.name, '/', 2) AS step_id
    FROM storage.objects o
    WHERE o.bucket_id = 'step-attachments'
  ), d AS (
    DELETE FROM toritavi_steps s
     WHERE s.deleted_at IS NOT NULL
       AND s.deleted_at < v_cutoff
       AND NOT EXISTS (
         SELECT 1 FROM with_files w WHERE w.step_id = s.id::text
       )
    RETURNING 1
  ) SELECT count(*) INTO v_s FROM d;

  -- 旅程: 猶予を過ぎていて、かつ **配下の予定が 1 件も残っていない**もの。
  -- 写真が残っている予定が 1 つでもあれば、その旅程も残す
  -- （FK が ON DELETE CASCADE でも、消す先が無ければ害が無い）。
  WITH d AS (
    DELETE FROM toritavi_journeys j
     WHERE j.deleted_at IS NOT NULL
       AND j.deleted_at < v_cutoff
       AND NOT EXISTS (
         SELECT 1 FROM toritavi_steps s WHERE s.journey_id = j.id
       )
    RETURNING 1
  ) SELECT count(*) INTO v_j FROM d;

  RETURN QUERY SELECT v_j, v_s;
END; $function$;

-- 権限は 020 のまま（service_role 専用）。cron は postgres が実行するので
-- 所有者権限で通る。念のため public には渡さない。
revoke all on function public.purge_soft_deleted(integer) from public;
grant execute on function public.purge_soft_deleted(integer) to service_role;


-- ---------------------------------------------------------------------------
-- (B) 適用前の観測（読み取り専用・先に実行して規模を把握する）
-- ---------------------------------------------------------------------------
-- いま何件が「削除済みだが残っている」か:
--
--   select
--     (select count(*) from public.toritavi_journeys where deleted_at is not null) as journeys,
--     (select count(*) from public.toritavi_steps    where deleted_at is not null) as steps;
--
-- そのうち 30 日を過ぎているもの（次の実行で対象になりうる）:
--
--   select
--     (select count(*) from public.toritavi_journeys
--       where deleted_at < now() - interval '30 days') as journeys,
--     (select count(*) from public.toritavi_steps
--       where deleted_at < now() - interval '30 days') as steps;
--
-- **写真が残っているせいで消せない予定**（＝ retention 待ち。0 に近づくのが正常）:
--
--   with with_files as (
--     select distinct split_part(name, '/', 2) as step_id
--     from storage.objects where bucket_id = 'step-attachments'
--   )
--   select count(*) from public.toritavi_steps s
--   where s.deleted_at < now() - interval '30 days'
--     and exists (select 1 from with_files w where w.step_id = s.id::text);
--
-- 🔴 **この数が減らずに増え続けたら、retention が回っていない。**
--    その場合は写真もテキストも残っているので、cron.job_run_details を見ること。


-- ---------------------------------------------------------------------------
-- (C) 手で 1 回叩く（cron を付ける前に必ず）
-- ---------------------------------------------------------------------------
--   select * from public.purge_soft_deleted(30);
--
--   → (purged_journeys, purged_steps) が返る。件数が (B) の見積もりと
--     大きく違うなら止めて調べる。


-- ---------------------------------------------------------------------------
-- (D) cron 登録（(C) を確認してから）
-- ---------------------------------------------------------------------------
-- retention（03:20 UTC）の 30 分後に置く。順序に依存しない設計だが、
-- 「同じ夜に写真 → 行」と流れる方が観測しやすい。
--
--   select cron.schedule(
--     'purge-soft-deleted-daily',
--     '50 3 * * *',                      -- 03:50 UTC = JST 12:50
--     $$select public.purge_soft_deleted(30);$$
--   );
--
-- 確認:
--   select jobid, jobname, schedule, active from cron.job order by jobid;
--   select jobid, status, return_message, start_time
--     from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'purge-soft-deleted-daily')
--     order by start_time desc limit 10;
--
-- 停止:
--   select cron.unschedule('purge-soft-deleted-daily');
