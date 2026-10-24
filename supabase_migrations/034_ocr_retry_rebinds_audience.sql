-- ============================================================
-- 034: OCR の再試行で、予算の相手（audience）を書き直す
--      （2026-10-24・Cloudflare 検査 アプリ run-1 の Ⓔ）
--
-- 何が起きていたか:
--   失敗した requestId をもう一度読むとき（アプリは同じ requestId で送り直す）、
--   toritavi_ocr_begin_request は台帳の行を reserved に戻すが、audience を書き直さない。
--   予約は新しい p_audience の予算（toritavi_ai_budget）に積むのに、精算
--   （toritavi_ocr_settle_success / _failure）は台帳の audience ＝古いほうを読む。
--   プランが変わった後（無料 → Pro など）に読み直すと:
--     - 新しい予算の予約が残ったまま（その期間の終わりまで枠を塞ぐ）
--     - 古い予算から、自分のではない予約を引く（greatest(0, …) で止まるが、他人の分を消す）
--   ずれは 1 回あたり見積りの数円。2026-10-24 に本番の定義で確認した。
--
-- 直し方: 再試行の UPDATE に audience=p_audience を 1 つ足すだけ。
--   **ほかは 030 と 1 文字も変えていない。** 030 の関数本体は本番と md5 一致
--   （bf0655bb04509b00f70dff3eabe0a75b・2026-10-24 確認）。非常停止の関門
--   （toritavi_ai_mode_blocks）も 030 の本体に入っている。
--
-- 🔴 **これを当てたら、030 の begin_request は古くなる**（030 を流し直すと 034 の修正が消える）。
-- 🔴 create or replace は実行権を保つ（service_role だけのまま）。冪等。行は書き換えない。
-- ============================================================

CREATE OR REPLACE FUNCTION public.toritavi_ocr_begin_request(p_request_id uuid, p_user_id uuid, p_audience text, p_units integer, p_limit_units integer, p_est_cost_cents integer, p_est_tokens integer, p_limit_tokens integer, p_counted_input integer DEFAULT NULL::integer, p_reserved_input integer DEFAULT NULL::integer)
 RETURNS TABLE(status text, used_after integer, cached jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- 🔴 JST。ai-guard.ts の jstToday()/jstFirstOfMonth() と対。
  --    片方だけ変えるとずれた時間帯だけ上限が効かない（019 の事故）。
  v_now_jst TIMESTAMP := (now() AT TIME ZONE 'Asia/Tokyo');
  v_day     DATE := v_now_jst::DATE;
  v_month   DATE := date_trunc('month', v_now_jst)::DATE;
  -- 🔴 **利用者ごとの上限はこれで数える**（Pro=契約日起点／ゲスト=番兵）。
  --    `v_month` は**全体予算と台帳の記録**にだけ使う。**混ぜない。**
  v_quota   DATE := public.ocr_period_start(p_user_id);
  v_ins     INTEGER;
  v_state   TEXT;
  v_result  JSONB;
  v_exp     TIMESTAMPTZ;
  v_after   INTEGER;
  v_now_cnt INTEGER;
  v_period  TEXT;
  v_key     DATE;
  v_ok      BOOLEAN;
  v_day_ok   BOOLEAN;
  v_month_ok BOOLEAN;
BEGIN
  IF p_request_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'request_id and user_id required';
  END IF;
  IF p_audience NOT IN ('guest','free','pro') THEN
    RAISE EXCEPTION 'bad audience';
  END IF;
  -- units は「ファイル数」ではなく「消費件数」。PDF は 5 ページで 1 件なので
  -- 1 ファイルでも 4 になりうる。上限は 1 リクエストあたり 40（10 ファイル × 4）。
  IF p_units IS NULL OR p_units < 1 OR p_units > 40 THEN
    RAISE EXCEPTION 'units out of range';
  END IF;
  IF p_limit_units IS NULL OR p_limit_units < 0 THEN
    RAISE EXCEPTION 'limit out of range';
  END IF;
  -- 1 リクエストで $10 を超える見積りは実運用ではありえない（021 と同じ安全弁）。
  IF p_est_cost_cents IS NULL OR p_est_cost_cents < 0 OR p_est_cost_cents > 1000 THEN
    RAISE EXCEPTION 'est_cost_cents out of range';
  END IF;
  -- 🔴 **不正な値で上限を無効化させない。** 負の見積りや負の上限を渡されると
  --    `a + b <= limit` がいくらでも真になる。
  IF p_est_tokens IS NULL OR p_est_tokens < 0 THEN
    RAISE EXCEPTION 'est_tokens out of range';
  END IF;
  IF p_limit_tokens IS NULL OR p_limit_tokens < 0 THEN
    RAISE EXCEPTION 'limit_tokens out of range';
  END IF;

  -- 5-0. 🔴 **非常停止スイッチ。DB 側でも見る。**
  --
  --    もとはサーバの src/lib/ai-switch.ts だけが toritavi_ai_switches を
  --    読んでいた。**止める責任がコード 1 枚に載っている**状態で、
  --    サーバの判定が落ちるかフェイルオープンすると mode='off' でも
  --    OCR が止まらない（CLAUDE.md §5「安全装置は静かに嘘をつかせない」）。
  --
  --    🔴 同じ形を 2026-08-23 に実際に踏んだ —— Vercel に OCR_MODE=off を
  --    入れて再デプロイしたが、そのとき動いていたコードは OCR_MODE を
  --    読まなかった（読む実装が未 push だった）。「止めたつもりで
  --    止まっていない」が起きる構造が、DB 側にも残っていた。
  --
  --    **席を取る前に見る。** 先に INSERT すると、止まっている間に来た
  --    request_id が 'reserved' で残り、スイッチを戻したあと同じ ID が
  --    duplicate_in_flight で弾かれる（利用者は二度と読めない）。
  --
  --    往復は増えない。この関数は既に 1 トランザクションで、
  --    行 1 つの select が加わるだけ。
  IF public.toritavi_ai_mode_blocks('ocr', p_audience) THEN
    RETURN QUERY SELECT 'ai_disabled'::TEXT, 0, NULL::JSONB;
    RETURN;
  END IF;

  -- 5-1. 冪等性。**先に席を取る。** 取れなければ二度目。
  INSERT INTO toritavi_ocr_requests
      (request_id, user_id, audience, state, units, est_cost_cents,
       est_tokens, period_day, period_month, period_quota,
       counted_input_tokens, reserved_input_tokens)
    VALUES (p_request_id, p_user_id, p_audience, 'reserved', p_units, p_est_cost_cents,
            p_est_tokens, v_day, v_month, v_quota,
            p_counted_input, p_reserved_input)
  ON CONFLICT (request_id) DO NOTHING;
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  IF v_ins = 0 THEN
    SELECT r.state, r.result, r.result_expires_at
      INTO v_state, v_result, v_exp
      FROM toritavi_ocr_requests r
     WHERE r.request_id = p_request_id
       -- 🔴 **他人の request_id を当てて結果を引けないようにする。**
       AND r.user_id = p_user_id;
    IF v_state IS NULL THEN
      -- 行はあるが所有者が違う。存在を教えない（実行中と同じ返しにする）。
      RETURN QUERY SELECT 'duplicate_in_flight'::TEXT, 0, NULL::JSONB;
      RETURN;
    END IF;
    IF v_state = 'reserved' THEN
      RETURN QUERY SELECT 'duplicate_in_flight'::TEXT, 0, NULL::JSONB;
      RETURN;
    ELSIF v_state = 'succeeded' THEN
      RETURN QUERY SELECT 'duplicate_done'::TEXT, 0,
        CASE WHEN v_exp IS NOT NULL AND v_exp > now() THEN v_result ELSE NULL END;
      RETURN;
    END IF;
    -- 🔴 **失敗した ID は再試行できる。** 同じファイルをもう一度読ませるとき、
    --    アプリは同じ request_id を送る（`IntakeItem.requestId`）。
    --    ここを duplicate 扱いにすると、**一度失敗した項目が二度と読めなくなる**。
    --    成功済み（succeeded）だけを再実行から守る。
    UPDATE toritavi_ocr_requests
       -- 🔴 034: 予算の相手（audience）も書き直す。予約は p_audience の予算に積むのに、
       --    精算（settle_*）は台帳の audience を読むので、ここで揃えないと別の予算を触る。
       SET state='reserved', audience=p_audience, units=p_units, est_cost_cents=p_est_cost_cents,
           est_tokens=p_est_tokens, period_day=v_day, period_month=v_month,
           period_quota=v_quota,
           counted_input_tokens=p_counted_input,
           reserved_input_tokens=p_reserved_input,
           actual_input_tokens=NULL, actual_output_tokens=NULL,
           fail_reason=NULL, settled_at=NULL, created_at=now()
     WHERE request_id=p_request_id AND user_id=p_user_id AND state='failed';
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins = 0 THEN
      -- 競合で誰かが先に掴んだ。実行中と同じ返しにする。
      RETURN QUERY SELECT 'duplicate_in_flight'::TEXT, 0, NULL::JSONB;
      RETURN;
    END IF;
  END IF;

  -- 5-2. 件数とトークンの予約（「足してから見る」形）。
  --
  -- 🔴 **月初の 1 件目は ON CONFLICT が発火しない。** 行が無いときは
  --    素の INSERT が通るので `WHERE` が効かない。件数と同じく、
  --    トークンも**単独で上限を超えるなら先に弾く**
  --    （2026-08-22 の外部レビュー指摘 4）。
  IF p_est_tokens > p_limit_tokens THEN
    SELECT requests_count INTO v_now_cnt
      FROM toritavi_ocr_usage_monthly
     WHERE user_id = p_user_id AND month = v_quota;
    UPDATE toritavi_ocr_requests
       SET state='failed', fail_reason='quota_tokens', settled_at=now()
     WHERE request_id = p_request_id;
    RETURN QUERY SELECT 'quota_exceeded'::TEXT, COALESCE(v_now_cnt,0), NULL::JSONB;
    RETURN;
  END IF;

  IF p_units > p_limit_units THEN
    SELECT requests_count INTO v_now_cnt
      FROM toritavi_ocr_usage_monthly
     WHERE user_id = p_user_id AND month = v_quota;
    UPDATE toritavi_ocr_requests
       SET state='failed', fail_reason='quota', settled_at=now()
     WHERE request_id = p_request_id;
    RETURN QUERY SELECT 'quota_exceeded'::TEXT, COALESCE(v_now_cnt,0), NULL::JSONB;
    RETURN;
  END IF;

  -- 🔴 **件数とトークンを同じ UPDATE で確保する。** 別々に見ると、
  --    片方だけ通った状態が作れる（そして片方は戻し忘れる）。
  INSERT INTO toritavi_ocr_usage_monthly
      (user_id, month, requests_count, tokens_total, tokens_reserved, last_request_at)
    VALUES (p_user_id, v_quota, p_units, 0, p_est_tokens, now())
  ON CONFLICT (user_id, month) DO UPDATE
    SET requests_count   = toritavi_ocr_usage_monthly.requests_count + p_units,
        tokens_reserved  = toritavi_ocr_usage_monthly.tokens_reserved + p_est_tokens,
        last_request_at  = now()
    WHERE toritavi_ocr_usage_monthly.requests_count + p_units <= p_limit_units
      AND toritavi_ocr_usage_monthly.tokens_total
          + toritavi_ocr_usage_monthly.tokens_reserved
          + p_est_tokens <= p_limit_tokens
  RETURNING toritavi_ocr_usage_monthly.requests_count INTO v_after;

  IF v_after IS NULL THEN
    SELECT requests_count INTO v_now_cnt
      FROM toritavi_ocr_usage_monthly
     WHERE user_id = p_user_id AND month = v_quota;
    UPDATE toritavi_ocr_requests
       SET state='failed', fail_reason='quota', settled_at=now()
     WHERE request_id = p_request_id;
    RETURN QUERY SELECT 'quota_exceeded'::TEXT, COALESCE(v_now_cnt,0), NULL::JSONB;
    RETURN;
  END IF;

  -- 5-3. 予算の予約（日次・月次の両方。どちらか一方でも足りなければ拒否）。
  --
  -- 🔴 **どちらを取れたかを覚えておく。** 最初の実装は、失敗時に
  --    日次と月次の**両方**から見積りを引いていた。日次だけ取れて月次で
  --    落ちた場合、月次は他の実行中リクエストが積んだ reserved を持って
  --    いるので、**他人の予約を削って予算を過小に見せる**（＝超過を許す）。
  --    取れた期間だけを戻す。
  v_day_ok := false;
  v_month_ok := false;

  FOREACH v_period IN ARRAY ARRAY['day','month'] LOOP
    v_key := CASE WHEN v_period = 'day' THEN v_day ELSE v_month END;

    INSERT INTO toritavi_ai_budget
        (feature, audience, period, period_key, reserved_cents, spent_cents, request_count)
      VALUES ('ocr', p_audience, v_period, v_key, 0, 0, 0)
    ON CONFLICT (feature, audience, period, period_key) DO NOTHING;

    UPDATE toritavi_ai_budget b
       SET reserved_cents = b.reserved_cents + p_est_cost_cents,
           request_count  = b.request_count + 1,
           updated_at     = now()
     WHERE b.feature = 'ocr' AND b.audience = p_audience
       AND b.period = v_period AND b.period_key = v_key
       AND b.spent_cents + b.reserved_cents + p_est_cost_cents <= (
             SELECT l.limit_cents FROM toritavi_ai_budget_limits l
              WHERE l.feature='ocr' AND l.audience=p_audience AND l.period=v_period
           );
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    v_ok := v_ins > 0;
    IF v_ok THEN
      IF v_period = 'day' THEN v_day_ok := true; ELSE v_month_ok := true; END IF;
    END IF;
    EXIT WHEN NOT v_ok;
  END LOOP;

  IF NOT v_ok THEN
    -- 件数とトークンを戻す。
    UPDATE toritavi_ocr_usage_monthly
       SET requests_count  = greatest(0, requests_count - p_units),
           tokens_reserved = greatest(0, tokens_reserved - p_est_tokens)
     WHERE user_id = p_user_id AND month = v_quota;
    -- **自分が積んだぶんだけ**戻す。
    IF v_day_ok THEN
      UPDATE toritavi_ai_budget b
         SET reserved_cents = greatest(0, b.reserved_cents - p_est_cost_cents),
             request_count  = greatest(0, b.request_count - 1)
       WHERE b.feature='ocr' AND b.audience=p_audience
         AND b.period='day' AND b.period_key=v_day;
    END IF;
    IF v_month_ok THEN
      UPDATE toritavi_ai_budget b
         SET reserved_cents = greatest(0, b.reserved_cents - p_est_cost_cents),
             request_count  = greatest(0, b.request_count - 1)
       WHERE b.feature='ocr' AND b.audience=p_audience
         AND b.period='month' AND b.period_key=v_month;
    END IF;
    UPDATE toritavi_ocr_requests
       SET state='failed', fail_reason='budget', settled_at=now()
     WHERE request_id = p_request_id;
    RETURN QUERY SELECT 'budget_exceeded'::TEXT, v_after, NULL::JSONB;
    RETURN;
  END IF;

  -- 分間の試行は `toritavi_ocr_try_attempt` が**重い検証より前**に数える。
  -- ここでは書かない（二重に数えることになる）。
  RETURN QUERY SELECT 'granted'::TEXT, v_after, NULL::JSONB;
END; $function$;

-- ---- 確認（すべて t なら OK）----
select '再試行で audience を書き直す' as item,
       position('SET state=''reserved'', audience=p_audience' in p.prosrc) > 0 as ok
  from pg_proc p where p.proname = 'toritavi_ocr_begin_request'
union all
select '非常停止の関門が残っている', position('toritavi_ai_mode_blocks' in p.prosrc) > 0
  from pg_proc p where p.proname = 'toritavi_ocr_begin_request'
union all
select '期間のキーは新しいまま（030）', position('period_quota=v_quota' in p.prosrc) > 0
  from pg_proc p where p.proname = 'toritavi_ocr_begin_request'
union all
select 'anon / authenticated は呼べない',
       not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')
  from pg_proc p where p.proname = 'toritavi_ocr_begin_request';

-- ---- 巻き戻し ----
-- 030 の CREATE OR REPLACE FUNCTION public.toritavi_ocr_begin_request(...) を流し直す。
