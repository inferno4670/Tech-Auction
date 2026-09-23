-- ═══════════════════════════════════════════════════════════════════════════════
-- 014 — Auto question timer, TIME'S UP settlement, sharper inactivity penalties
-- ═══════════════════════════════════════════════════════════════════════════════
-- Safe to re-run (idempotent).
--
-- WHY:
--  1. AUTO QUESTION TIMER. The question countdown used to wait for the
--     quizmaster to press START TIMER, so teams could stall for as long as the
--     admin forgot. close_bidding() now stamps timer_started_at the instant the
--     round flips to 'question' (25s by default, still configurable in
--     Settings) — every panel counts down the same deadline with no button.
--  2. TIME'S UP. When the question timer runs out the round settles ITSELF as
--     wrong (bid lost, wrong_answers +1) through the new expire_question()
--     RPC, and the announcement carries expired = true so the projector shows
--     TIME'S UP + the correct answer instead of a silent "WRONG". Any client
--     may call it (like close_bidding, it is idempotent and re-checks the
--     deadline on the server clock) — so the settlement survives every team
--     closing their laptop.
--  3. PENALTIES. Two rules now apply to teams that sit on their hands:
--       · never placed a bid in a round that actually ran  → −150 TC
--       · third straight round without winning             → −100 TC
--     At most ONE penalty per team per round (the larger one wins) so a single
--     bad round can never double-charge, and both are written to the budget
--     ledger so the team sees the reason.
--  4. ANSWER GRACE. submit_team_answer() refuses picks past the same 2s grace
--     the bidding window uses — a click fired at the buzzer still lands; a pick
--     after that is time_up and the round settles as wrong.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Announcements learn about time-outs ──────────────────────────────────

ALTER TABLE round_results ADD COLUMN IF NOT EXISTS expired BOOLEAN NOT NULL DEFAULT false;

-- ─── 2. 25s question timer as the new default ────────────────────────────────

ALTER TABLE event_settings ALTER COLUMN default_question_time SET DEFAULT 25;
-- One-time nudge for events still on the old default (a deliberately custom
-- value is left alone).
UPDATE event_settings SET default_question_time = 25 WHERE default_question_time = 20;

-- ─── 3. close_bidding: start the countdown with the question ─────────────────

CREATE OR REPLACE FUNCTION close_bidding(p_auction_id UUID, p_force BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction auctions%ROWTYPE;
  v_top RECORD;
  v_is_admin BOOLEAN;
  v_question_seconds INTEGER;
BEGIN
  SELECT * INTO v_auction FROM auctions WHERE id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auction_not_found');
  END IF;

  -- Already settled? Report the stored outcome (idempotent).
  IF v_auction.status <> 'open' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_closed', true,
      'winning_team_id', v_auction.winning_team_id,
      'winning_bid', v_auction.winning_bid
    );
  END IF;

  IF p_force THEN
    SELECT EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    ) INTO v_is_admin;
    IF NOT v_is_admin THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
    END IF;
  ELSIF v_auction.bidding_ends_at IS NULL
        OR now() < v_auction.bidding_ends_at + interval '2 seconds' THEN
    -- Auto-close waits out the buzzer grace so bids already in flight land.
    -- Clients simply retry (the RPC is idempotent) until this succeeds.
    RETURN jsonb_build_object('ok', false, 'error', 'not_expired');
  END IF;

  -- Highest bid wins; on a tie the earlier bid wins. Deterministic.
  SELECT b.team_id, b.amount INTO v_top
  FROM bids b
  WHERE b.auction_id = p_auction_id
    AND b.is_valid = true
  ORDER BY b.amount DESC, b.created_at ASC, b.id ASC
  LIMIT 1;

  IF v_top IS NULL OR v_top.team_id IS NULL THEN
    UPDATE auctions SET status = 'closed', closed_at = now()
    WHERE id = p_auction_id;
    RETURN jsonb_build_object('ok', true, 'closed', true, 'winning_team_id', NULL);
  END IF;

  -- Configured answer window (Settings → QUESTION TIME), 25s default.
  SELECT COALESCE(
    (SELECT default_question_time FROM event_settings ORDER BY created_at DESC LIMIT 1),
    25
  ) INTO v_question_seconds;

  -- The question timer starts HERE, atomically with the phase change: the
  -- countdown is live the moment any panel sees the question — no admin click,
  -- and every screen reads the same absolute deadline.
  UPDATE auctions SET
    status           = 'question',
    current_bid      = v_top.amount,
    current_team_id  = v_top.team_id,
    winning_bid      = v_top.amount,
    winning_team_id  = v_top.team_id,
    timer_started_at = now(),
    timer_duration   = GREATEST(5, v_question_seconds),
    timer_paused     = false,
    closed_at        = COALESCE(closed_at, now())
  WHERE id = p_auction_id;

  -- Winner pays their bid (moved to the question phase).
  UPDATE teams
  SET current_budget = GREATEST(0, current_budget - v_top.amount)
  WHERE id = v_top.team_id;

  INSERT INTO budget_transactions (team_id, type, amount, reason, reference_id)
  VALUES (v_top.team_id, 'bid', -v_top.amount,
          'Winning bid — deducted for question phase', p_auction_id);

  UPDATE teams
  SET auctions_won = auctions_won + 1,
      rounds_inactive = 0
  WHERE id = v_top.team_id;

  RETURN jsonb_build_object(
    'ok', true,
    'winning_team_id', v_top.team_id,
    'winning_bid', v_top.amount
  );
END;
$$;

-- ─── 4. settle_answer: new penalties + the expired flag ──────────────────────

-- Adding p_expired makes this a DIFFERENT signature, so the old 4-argument
-- version would survive as a separate function and keep answering calls made
-- with 4 arguments (grade_answer, submit_team_answer) — i.e. the newer, sharper
-- penalty rules would never run. Drop it first; the 5-arg version below has a
-- default for the new argument, so 4-argument calls bind to it.
DROP FUNCTION IF EXISTS settle_answer(UUID, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION settle_answer(
  p_auction_id UUID,
  p_result TEXT,
  p_selected TEXT,
  p_admin_id UUID DEFAULT NULL,
  p_expired BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction auctions%ROWTYPE;
  v_team teams%ROWTYPE;
  v_item auction_items%ROWTYPE;
  v_reward INTEGER;
  v_penalty INTEGER;
  -- Penalty amounts, one place to tune them.
  c_no_bid_penalty   CONSTANT INTEGER := 150;
  c_dry_round_penalty CONSTANT INTEGER := 100;
  v_pen RECORD;
BEGIN
  IF p_result NOT IN ('correct', 'wrong') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_result');
  END IF;

  SELECT * INTO v_auction FROM auctions WHERE id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auction_not_found');
  END IF;
  IF v_auction.status <> 'question' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_in_question_phase',
                              'status', v_auction.status);
  END IF;
  IF v_auction.winning_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_winning_team');
  END IF;

  -- Idempotent: a graded round keeps its stored outcome.
  IF EXISTS (
    SELECT 1 FROM question_attempts
    WHERE auction_id = p_auction_id AND team_id = v_auction.winning_team_id
      AND result IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_graded', true,
      'result', (SELECT result FROM question_attempts
                 WHERE auction_id = p_auction_id
                   AND team_id = v_auction.winning_team_id
                 LIMIT 1));
  END IF;

  SELECT * INTO v_team FROM teams WHERE id = v_auction.winning_team_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'team_not_found');
  END IF;

  v_reward  := COALESCE(v_auction.winning_bid, 0) + 150;
  v_penalty := COALESCE(v_auction.winning_bid, 0);

  -- Attempt row (created if the team never submitted through the RPC — the
  -- time-out path lands here with a NULL pick).
  INSERT INTO question_attempts
    (auction_id, team_id, selected_answer, result, points_awarded,
     admin_id, answered_at)
  VALUES
    (p_auction_id, v_team.id, p_selected, p_result,
     CASE WHEN p_result = 'correct' THEN 1 ELSE 0 END,
     p_admin_id, now())
  ON CONFLICT (auction_id, team_id) DO UPDATE
    SET result         = EXCLUDED.result,
        points_awarded = EXCLUDED.points_awarded,
        admin_id       = COALESCE(EXCLUDED.admin_id, question_attempts.admin_id),
        answered_at    = now();

  -- Budget + counters + score in the same transaction.
  UPDATE teams SET
    current_budget = CASE WHEN p_result = 'correct'
                          THEN current_budget + v_reward ELSE current_budget END,
    score          = score + CASE WHEN p_result = 'correct' THEN 1 ELSE 0 END,
    correct_answers = correct_answers + CASE WHEN p_result = 'correct' THEN 1 ELSE 0 END,
    wrong_answers   = wrong_answers   + CASE WHEN p_result = 'wrong'   THEN 1 ELSE 0 END
  WHERE id = v_team.id;

  IF p_result = 'correct' THEN
    INSERT INTO score_transactions (team_id, type, amount, reason, reference_id, admin_id)
    VALUES (v_team.id, 'reward', 1, 'Correct answer', p_auction_id, p_admin_id);

    INSERT INTO budget_transactions (team_id, type, amount, reason, reference_id)
    VALUES (v_team.id, 'refund', v_reward,
            'Correct answer — bid refund + 150 TC bonus', p_auction_id);
  END IF;

  -- ── Inactivity, in ONE pass (no re-read races) ──────────────────────────────
  -- The winner resets. Everyone else:
  --   · sat out the bidding entirely      → −150 TC  (no_bid)
  --   · third straight round without a win → −100 TC  (dry streak, counter resets)
  -- At most one of the two per round — the bigger one — so a team can never be
  -- charged twice for the same round. The dry-streak counter still advances (and
  -- resets at 3) for a no-bid team, so its streak never grows unbounded.
  FOR v_pen IN
    WITH penalty AS (
      SELECT
        t.id AS team_id,
        CASE
          WHEN t.id = v_team.id THEN 0
          WHEN NOT EXISTS (
            SELECT 1 FROM bids b
            WHERE b.auction_id = p_auction_id
              AND b.team_id = t.id
              AND b.is_valid = true
          ) THEN c_no_bid_penalty
          WHEN t.rounds_inactive + 1 >= 3 THEN c_dry_round_penalty
          ELSE 0
        END AS amount
      FROM teams t
      WHERE t.is_active = true
    )
    UPDATE teams u
    SET rounds_inactive = CASE
          WHEN u.id = v_team.id THEN 0
          WHEN u.rounds_inactive + 1 >= 3 THEN 0
          ELSE u.rounds_inactive + 1
        END,
        current_budget = GREATEST(0, u.current_budget - p.amount)
    FROM penalty p
    WHERE u.id = p.team_id
    RETURNING u.id AS team_id, u.name AS team_name, p.amount AS amount
  LOOP
    IF v_pen.amount > 0 THEN
      INSERT INTO budget_transactions (team_id, type, amount, reason, reference_id)
      VALUES (
        v_pen.team_id, 'manual_adjustment', -v_pen.amount,
        CASE WHEN v_pen.amount >= c_no_bid_penalty
             THEN 'Penalty — no bid placed this round'
             ELSE 'Penalty — 3 rounds without winning' END,
        p_auction_id
      );
    END IF;
  END LOOP;

  -- ANNOUNCEMENT — one public row; admin panel, every team dashboard and the
  -- projector all receive it over realtime and show the same verdict. expired
  -- lets the room read TIME'S UP instead of a plain WRONG.
  SELECT * INTO v_item FROM auction_items WHERE id = v_auction.item_id;

  INSERT INTO round_results
    (auction_id, item_id, item_name, team_id, team_name, result,
     selected_answer, correct_answer, reward, penalty, graded_by, expired)
  VALUES
    (p_auction_id, v_auction.item_id, v_item.name, v_team.id, v_team.name, p_result,
     p_selected, v_item.correct_answer,
     CASE WHEN p_result = 'correct' THEN v_reward  ELSE 0 END,
     CASE WHEN p_result = 'wrong'   THEN v_penalty ELSE 0 END,
     CASE WHEN p_admin_id IS NULL THEN 'auto' ELSE 'admin' END,
     COALESCE(p_expired, false));

  UPDATE auctions SET status = 'completed' WHERE id = p_auction_id;

  RETURN jsonb_build_object('ok', true,
    'result', p_result,
    'expired', COALESCE(p_expired, false),
    'winning_team_id', v_team.id,
    'reward', CASE WHEN p_result = 'correct' THEN v_reward ELSE 0 END,
    'penalty', CASE WHEN p_result = 'wrong' THEN v_penalty ELSE 0 END);
END;
$$;

-- ─── 5. expire_question: the clock runs out → settle as wrong ────────────────
-- Callable by ANY client (teams are authenticated, the projector is anon). It
-- is safe to spam: the auction row lock serialises callers, the deadline is
-- re-checked on the server clock, only the question phase is eligible, a
-- paused / never-started timer is left alone, and a round that was already
-- answered keeps its stored verdict.

CREATE OR REPLACE FUNCTION expire_question(p_auction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction auctions%ROWTYPE;
BEGIN
  SELECT * INTO v_auction FROM auctions WHERE id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auction_not_found');
  END IF;

  IF v_auction.status <> 'question' THEN
    RETURN jsonb_build_object('ok', true, 'already_settled', true);
  END IF;

  -- Paused (or never started) means the quizmaster is holding the clock.
  IF v_auction.timer_started_at IS NULL OR v_auction.timer_paused THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  -- Same 2s grace the bidding window uses: a pick fired at the buzzer lands.
  IF now() < v_auction.timer_started_at
            + make_interval(secs => v_auction.timer_duration)
            + interval '2 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_expired');
  END IF;

  -- Answered in time (auto-verified or quizmaster-graded) → keep that verdict.
  IF v_auction.winning_team_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM question_attempts
    WHERE auction_id = p_auction_id
      AND team_id = v_auction.winning_team_id
      AND result IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_graded', true);
  END IF;

  RETURN settle_answer(p_auction_id, 'wrong', NULL, NULL, true);
END;
$$;

-- ─── 6. Answer grace — a buzzer-beater pick still counts ─────────────────────

CREATE OR REPLACE FUNCTION submit_team_answer(p_auction_id UUID, p_selected TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction auctions%ROWTYPE;
  v_item auction_items%ROWTYPE;
  v_team_id UUID;
  v_correct BOOLEAN;
  v_attempt question_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_auction FROM auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auction_not_found');
  END IF;
  IF v_auction.status <> 'question' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_in_question_phase');
  END IF;

  -- Past the answer window (+ the shared 2s grace) the clock decides: the pick
  -- is refused here and expire_question() settles the round as wrong.
  IF v_auction.timer_started_at IS NOT NULL
     AND NOT v_auction.timer_paused
     AND now() > v_auction.timer_started_at
                + make_interval(secs => v_auction.timer_duration)
                + interval '2 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'time_up');
  END IF;

  SELECT team_id INTO v_team_id FROM team_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_team_member');
  END IF;
  IF v_auction.winning_team_id <> v_team_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'only_winner_can_answer');
  END IF;

  IF EXISTS (
    SELECT 1 FROM question_attempts
    WHERE auction_id = p_auction_id AND team_id = v_team_id AND result IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_graded');
  END IF;

  SELECT * INTO v_item FROM auction_items WHERE id = v_auction.item_id;

  -- Upsert the pending pick so the admin panel sees what the team chose.
  INSERT INTO question_attempts (auction_id, team_id, selected_answer, points_awarded)
  VALUES (p_auction_id, v_team_id, p_selected, 0)
  ON CONFLICT (auction_id, team_id) DO UPDATE
    SET selected_answer = EXCLUDED.selected_answer,
        answered_at     = now()
  RETURNING * INTO v_attempt;

  -- No answer key on the item → leave for manual grading.
  IF v_item.id IS NULL OR COALESCE(v_item.correct_answer, '') = '' THEN
    RETURN jsonb_build_object('ok', true, 'graded', false,
      'selected_answer', p_selected);
  END IF;

  v_correct := lower(btrim(v_item.correct_answer)) = lower(btrim(p_selected));

  PERFORM settle_answer(
    p_auction_id,
    CASE WHEN v_correct THEN 'correct' ELSE 'wrong' END,
    p_selected,
    NULL
  );

  RETURN jsonb_build_object('ok', true, 'graded', true,
    'result', CASE WHEN v_correct THEN 'correct' ELSE 'wrong' END,
    'reward', CASE WHEN v_correct THEN COALESCE(v_auction.winning_bid, 0) + 150 ELSE 0 END,
    'bid_lost', CASE WHEN v_correct THEN 0 ELSE COALESCE(v_auction.winning_bid, 0) END);
END;
$$;

-- ─── 7. Grants ───────────────────────────────────────────────────────────────

-- settle_answer stays unreachable from clients (only submit_team_answer /
-- grade_answer / expire_question may call it), as before.
REVOKE ALL ON FUNCTION settle_answer(UUID, TEXT, TEXT, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION expire_question(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_question(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION close_bidding(UUID, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_team_answer(UUID, TEXT) TO anon, authenticated;
