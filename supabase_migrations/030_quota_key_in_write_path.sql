-- ============================================================================
-- 030: 🔴 上限を数える関数が、契約日起点を**一度も使っていなかった**
--
-- 🔴 **人が Supabase SQL Editor で実行する**（CLAUDE.md §4）。
--
-- ## 何が起きていたか（2026-08-31・実機で発覚）
--
-- 025 で「Pro は契約日起点」にしたつもりだったが、直したのは
-- **`increment_ocr_usage_srv`** —— **どのコードからも呼ばれていない関数**
-- だった（サーバは `toritavi_ocr_begin_request` ほかを呼ぶ）。
--
-- 実際に数えている 5 つの関数は**すべて暦月**のままで、
-- 読み手（`/api/ai-usage` → `quotaKey` → `ocr_period_start`）だけが
-- 契約日起点／ゲストの番兵を見ていた。**噛み合っていない。**
--
--   ゲスト   … 使用量は 2026-08-01 に積まれ、バッジは 1970-01-01 を読む
--              → **バッジが永久に 0**（実機で確認）
--   Pro      … 上限は暦月で効き、バッジは契約日起点 → **両者が食い違う**
--   無料     … どちらも暦月なので一致（表に出ていなかった理由）
--
-- **`CLAUDE.md` §6 が記録している型そのもの**:
--   「同じ欠陥を直したはずの修正が、後から増えた別の関数には入っていない」
--   **関数を複製したら、既知の修正が全部入っているかを確認する。**
--
-- ## この SQL がやること
--
-- 5 つの関数を `ocr_period_start(p_user_id)` に寄せる。**11 か所。**
-- 本番の定義（`pg_get_functiondef`）を写し、**機械的に置換**して作った
-- （手で写すと落とす。実際、目視では 1 か所（行 221）を数え落としていた）。
--
-- 🔴 **全体予算（`toritavi_ocr_budget`）と台帳の `period_month` は
--    暦月のまま。** あちらはサービス全体の月次予算で、利用者ごとの上限とは
--    別物。**混ぜない。**
--
-- ## 台帳に `period_quota` を新設する理由
--
-- `settle_*` は台帳（`toritavi_ocr_requests`）から期間キーを読んで
-- **begin が触ったのと同じ行**を更新する。`period_month` を流用すると
-- 列名が嘘をつく（ゲストでは 1970-01-01 が入る）。別の列にする。
--
-- 🔴 **移行の途中で始まった要求は `period_quota` が NULL。**
--    `settle_*` は `coalesce(v_quota, v_month)` で暦月へ落とす ——
--    begin が暦月で積んだ行を、settle も暦月で触る。**取りこぼさない。**
--
-- ## 適用後に起きること
--
-- ゲスト・Pro の使用量が**新しいキーで積まれ直す**。
-- 既存の暦月の行は残るが、読み手が見ないだけで実害は無い
-- （無料利用者はキーが変わらないので影響なし）。
--
-- ## 適用前に確かめる
--
--   select proname from pg_proc where proname='ocr_period_start';  -- 027 が要る
--   select count(*) from toritavi_ocr_requests where state='reserved';  -- 実行中
-- ============================================================================

-- ① 台帳に上限のキーを持たせる（既存行は NULL のまま＝暦月扱い）。
alter table public.toritavi_ocr_requests
  add column if not exists period_quota date;

comment on column public.toritavi_ocr_requests.period_quota is
  '利用者ごとの上限を数えるキー（ocr_period_start）。'
  'period_month は全体予算・記録用の暦月で、別物。NULL は 030 適用前の行。';

-- ② 数える 5 つの関数を、期間関数に寄せる。
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
       SET state='reserved', units=p_units, est_cost_cents=p_est_cost_cents,
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

CREATE OR REPLACE FUNCTION public.toritavi_reserve_ocr_units(p_user_id uuid, p_units integer, p_limit integer)
 RETURNS TABLE(granted boolean, used_after integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- 🔴 **JST。** `ai-guard.ts` の jstFirstOfMonth() と対。
  --    片方だけ変えると、ずれた時間帯だけ上限が効かなくなる（019 の事故）。
  v_month DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Tokyo'))::DATE;
  -- 利用者ごとの上限のキー（`ocr_period_start`）。
  v_quota DATE := public.ocr_period_start(p_user_id);
  v_after INTEGER;
  v_now   INTEGER;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  -- /api/ocr の MAX_IMAGES と同じ上限で bound する（021 と揃える）。
  IF p_units IS NULL OR p_units < 1 OR p_units > 10 THEN
    RAISE EXCEPTION 'units out of range';
  END IF;
  IF p_limit IS NULL OR p_limit < 0 THEN
    RAISE EXCEPTION 'limit out of range';
  END IF;

  -- 1 回の要求だけで上限を超えるなら、行が無くても通さない。
  -- （下の INSERT 経路は競合しないので WHERE が効かず、素通りしてしまう）
  IF p_units > p_limit THEN
    SELECT requests_count INTO v_now
      FROM toritavi_ocr_usage_monthly
     WHERE user_id = p_user_id AND month = v_quota;
    RETURN QUERY SELECT false, COALESCE(v_now, 0);
    RETURN;
  END IF;

  INSERT INTO toritavi_ocr_usage_monthly
      (user_id, month, requests_count, tokens_total, last_request_at)
    VALUES (p_user_id, v_quota, p_units, 0, now())
  ON CONFLICT (user_id, month) DO UPDATE
    SET requests_count  = toritavi_ocr_usage_monthly.requests_count + p_units,
        last_request_at = now()
    -- ここが要。上限を超える更新は**行われない**。
    WHERE toritavi_ocr_usage_monthly.requests_count + p_units <= p_limit
  RETURNING toritavi_ocr_usage_monthly.requests_count INTO v_after;

  IF v_after IS NULL THEN
    -- 更新されなかった＝上限に当たった。現在値を返す。
    SELECT requests_count INTO v_now
      FROM toritavi_ocr_usage_monthly
     WHERE user_id = p_user_id AND month = v_quota;
    RETURN QUERY SELECT false, COALESCE(v_now, 0);
  ELSE
    RETURN QUERY SELECT true, v_after;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.toritavi_release_ocr_units(p_user_id uuid, p_units integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Tokyo'))::DATE;
  -- 利用者ごとの上限のキー（`ocr_period_start`）。
  v_quota DATE := public.ocr_period_start(p_user_id);
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF p_units IS NULL OR p_units < 1 OR p_units > 10 THEN
    RAISE EXCEPTION 'units out of range';
  END IF;

  UPDATE toritavi_ocr_usage_monthly
     SET requests_count = greatest(0, requests_count - p_units)
   WHERE user_id = p_user_id AND month = v_quota;
END; $function$;

CREATE OR REPLACE FUNCTION public.toritavi_ocr_settle_success(p_request_id uuid, p_user_id uuid, p_tokens_in integer, p_tokens_out integer, p_cost_cents integer, p_result jsonb, p_result_ttl_seconds integer DEFAULT 600)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tokens  INTEGER := p_tokens_in + p_tokens_out;
  v_est     INTEGER;
  v_est_tok INTEGER;
  v_aud     TEXT;
  v_units   INTEGER;
  -- 🔴 **予約したときの期間で精算する。** now() から計算し直すと、
  --    JST の 0:00 や月初をまたいだリクエストが別の財布を触る。
  v_day     DATE;
  v_month   DATE;
  -- 台帳に記録した上限のキー。**begin が使ったものと同じ行**を触るため。
  v_quota   DATE;
BEGIN
  IF p_cost_cents < 0 OR p_cost_cents > 1000 THEN
    RAISE EXCEPTION 'cost_cents out of range';
  END IF;

  -- reserved のものだけ確定できる（二度目の settle は何もしない）。
  UPDATE toritavi_ocr_requests
     SET state='succeeded',
         actual_cost_cents=p_cost_cents,
         actual_input_tokens=p_tokens_in,
         actual_output_tokens=p_tokens_out,
         result=p_result,
         result_expires_at = now() + make_interval(secs => p_result_ttl_seconds),
         settled_at=now()
   WHERE request_id=p_request_id AND user_id=p_user_id AND state='reserved'
  RETURNING est_cost_cents, est_tokens, audience, units, period_day, period_month, period_quota
       INTO v_est, v_est_tok, v_aud, v_units, v_day, v_month, v_quota;

  IF v_est IS NULL THEN RETURN false; END IF;
  -- 🔴 **移行の途中で始まった要求は `period_quota` が NULL。**
  --    そのときは begin が使った暦月へ落とす（同じ行を触るため）。
  v_quota := coalesce(v_quota, v_month);

  -- 予算: 見積りを外して実費を積む。
  UPDATE toritavi_ai_budget b
     SET reserved_cents = greatest(0, b.reserved_cents - v_est),
         spent_cents    = b.spent_cents + p_cost_cents,
         updated_at     = now()
   WHERE b.feature='ocr' AND b.audience=v_aud
     AND ((b.period='day' AND b.period_key=v_day) OR (b.period='month' AND b.period_key=v_month));

  -- 月次のトークン（件数は begin で計上済み。ここで足すと二重に数える）。
  -- 予約したぶんを外して、実測を積む。
  UPDATE toritavi_ocr_usage_monthly
     SET tokens_total    = tokens_total + v_tokens,
         tokens_reserved = greatest(0, tokens_reserved - v_est_tok),
         last_request_at = now()
   WHERE user_id = p_user_id AND month = v_quota;

  -- 日次（分析・不正検知の材料。021 と同じ形）。
  INSERT INTO toritavi_ocr_usage (user_id, day, requests_count, tokens_total, last_request_at)
    VALUES (p_user_id, v_day, v_units, v_tokens, now())
  ON CONFLICT (user_id, day) DO UPDATE SET
    requests_count  = toritavi_ocr_usage.requests_count + v_units,
    tokens_total    = toritavi_ocr_usage.tokens_total + v_tokens,
    last_request_at = now();

  -- 旧予算テーブルも当面は維持する（管理コンソールの集計が見ている）。
  INSERT INTO toritavi_ocr_budget (month, spend_cents, request_count)
    VALUES (v_month, p_cost_cents, 1)
  ON CONFLICT (month) DO UPDATE SET
    spend_cents   = toritavi_ocr_budget.spend_cents + p_cost_cents,
    request_count = toritavi_ocr_budget.request_count + 1;

  RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION public.toritavi_ocr_settle_failure(p_request_id uuid, p_user_id uuid, p_reason text, p_charge_budget boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_est     INTEGER;
  v_est_tok INTEGER;
  v_aud     TEXT;
  v_units   INTEGER;
  -- 予約したときの期間で戻す（日跨ぎ・月跨ぎ対策）。
  v_day     DATE;
  v_month   DATE;
  -- 台帳に記録した上限のキー。**begin が使ったものと同じ行**を触るため。
  v_quota   DATE;
BEGIN
  UPDATE toritavi_ocr_requests
     SET state='failed', fail_reason=left(coalesce(p_reason,'unknown'), 64), settled_at=now()
   WHERE request_id=p_request_id AND user_id=p_user_id AND state='reserved'
  RETURNING est_cost_cents, est_tokens, audience, units, period_day, period_month, period_quota
       INTO v_est, v_est_tok, v_aud, v_units, v_day, v_month, v_quota;

  IF v_est IS NULL THEN RETURN false; END IF;
  -- 🔴 **移行の途中で始まった要求は `period_quota` が NULL。**
  --    そのときは begin が使った暦月へ落とす（同じ行を触るため）。
  v_quota := coalesce(v_quota, v_month);

  -- 件数とトークンの予約を戻す。
  UPDATE toritavi_ocr_usage_monthly
     SET requests_count  = greatest(0, requests_count - v_units),
         tokens_reserved = greatest(0, tokens_reserved - v_est_tok)
   WHERE user_id = p_user_id AND month = v_quota;

  IF p_charge_budget THEN
    -- 送信後の失敗。実費は分からないが**発生している前提**で見積りを積む。
    -- 予約を外すだけにすると、ここが予算の抜け穴になる。
    UPDATE toritavi_ai_budget b
       SET reserved_cents = greatest(0, b.reserved_cents - v_est),
           spent_cents    = b.spent_cents + v_est,
           updated_at     = now()
     WHERE b.feature='ocr' AND b.audience=v_aud
       AND ((b.period='day' AND b.period_key=v_day) OR (b.period='month' AND b.period_key=v_month));
  ELSE
    -- 送信前の失敗。実費は発生していない。
    UPDATE toritavi_ai_budget b
       SET reserved_cents = greatest(0, b.reserved_cents - v_est),
           request_count  = greatest(0, b.request_count - 1),
           updated_at     = now()
     WHERE b.feature='ocr' AND b.audience=v_aud
       AND ((b.period='day' AND b.period_key=v_day) OR (b.period='month' AND b.period_key=v_month));
  END IF;

  RETURN true;
END; $function$;

-- ============================================================================
-- 確認
-- ============================================================================

-- ① 5 つとも `ocr_period_start` を使っていること（期待: すべて t）
select p.proname,
       pg_get_functiondef(p.oid) like '%ocr_period_start%' as 期間関数を使う
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname in (
  'toritavi_ocr_begin_request','toritavi_reserve_ocr_units',
  'toritavi_release_ocr_units','toritavi_ocr_settle_success',
  'toritavi_ocr_settle_failure')
order by p.proname;

-- ② 全体予算は暦月のままであること（期待: t）
select pg_get_functiondef(p.oid) like '%toritavi_ocr_budget (month%' as 予算は暦月
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='toritavi_ocr_settle_success';

-- ③ 台帳の列
select column_name from information_schema.columns
where table_name='toritavi_ocr_requests' and column_name in ('period_month','period_quota')
order by column_name;

-- ④ 実行中の要求が無いこと（あるなら、その分は暦月で精算される）
select count(*) as 実行中 from toritavi_ocr_requests where state='reserved';
