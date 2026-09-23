-- ═══════════════════════════════════════════════════════════════════════════════
-- 012 — Buzzer-proof bidding + round-result announcements
-- ═══════════════════════════════════════════════════════════════════════════════
-- Safe to re-run (idempotent).
--
-- WHY:
--  1. THE LAST-SECOND WINNER BUG. placeBid() in the app used to be a client
--     side 3-step dance (read auction → upsert bid row → guarded update of
--     current_bid). At the buzzer the round settlement could run BETWEEN step 2
--     and step 3: close_bidding() locked the auction, read the bids it could
--     see, crowned the SECOND-LAST bidder and settled the round — while the
--     late bid row was already sitting in the table, so the admin's live feed
--     showed the higher bid that never won. Fix: bids now go through an atomic
--     place_bid() RPC that takes the SAME row lock (`SELECT ... FOR UPDATE`)
--     as close_bidding(). The two can no longer interleave: either the bid
--     commits first (and the settlement sees it) or the settlement commits
--     first (and the bid is refused cleanly — never stored as a ghost row).
--  2. BUZZER GRACE. A bid clicked with 1–3s on the team's countdown can reach
--     the server a moment after the deadline (network + processing). Bids are
--     therefore accepted for BID_GRACE (2s) past bidding_ends_at, and the
--     auto-close waits the same 2s before settling — so the last bidder wins
--     and the deadline stays honest for everyone.
--  3. ROUND ANNOUNCEMENTS. Teams, the projector AND the admin panel should all
--     learn the outcome of a question the moment it is graded. settle_answer()
--     now writes one public row to round_results, which every panel receives
--     over realtime (works for both the team's auto-verified pick and the
--     quizmaster's manual override).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Atomic bid placement (row-locked against the settlement) ─────────────

CREATE OR REPLACE FUNCTION place_bid(p_auction_id UUID, p_amount INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction auctions%ROWTYPE;
  v_item auction_items%ROWTYPE;
  v_team teams%ROWTYPE;
  v_team_id UUID;
  v_min_increment INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  -- The lock that makes this race-free: close_bidding() takes the same lock on
  -- the same row, so bids and the round settlement are fully serialized.
  SELECT * INTO v_auction FROM auctions WHERE id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auction_not_found');
  END IF;

  IF v_auction.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bidding_closed');
  END IF;

  -- Buzzer grace (must match the grace in close_bidding below): a bid fired
  -- before the deadline may still land a moment after it.
  IF v_auction.bidding_ends_at IS NOT NULL
     AND now() > v_auction.bidding_ends_at + interval '2 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bidding_closed');
  END IF;

  -- Identity comes from the JWT, never from the client payload.
  SELECT tm.team_id INTO v_team_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_team_member');
  END IF;

  SELECT * INTO v_team FROM teams WHERE id = v_team_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'team_not_found');
  END IF;

  SELECT * INTO v_item FROM auction_items WHERE id = v_auction.item_id;
  v_min_increment := GREATEST(1, COALESCE(v_item.minimum_increment, 1));

  IF v_team.current_budget < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_budget',
                              'budget', v_team.current_budget);
  END IF;

  IF p_amount <= v_auction.current_bid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bid_too_low',
                              'current_bid', v_auction.current_bid);
  END IF;

  IF p_amount < v_auction.current_bid + v_min_increment THEN
    RETURN jsonb_build_object('ok', false, 'error', 'below_minimum_increment',
                              'current_bid', v_auction.current_bid,
                              'minimum_increment', v_min_increment);
  END IF;

  -- One row per (auction, team): a raised bid replaces the team's previous one.
  INSERT INTO bids (auction_id, team_id, amount, is_valid, created_at)
  VALUES (p_auction_id, v_team_id, p_amount, true, now())
  ON CONFLICT (auction_id, team_id) DO UPDATE
    SET amount     = EXCLUDED.amount,
        is_valid   = true,
        created_at = now();

  UPDATE auctions
  SET current_bid = p_amount,
      current_team_id = v_team_id
  WHERE id = p_auction_id;

  RETURN jsonb_build_object(
    'ok', true,
    'amount', p_amount,
    'team_id', v_team_id,
    'current_bid', p_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION place_bid(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION place_bid(UUID, INTEGER) TO authenticated;

-- ─── 2. close_bidding: same grace window as place_bid ────────────────────────

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

  UPDATE auctions SET
    status          = 'question',
    current_bid     = v_top.amount,
    current_team_id = v_top.team_id,
    winning_bid     = v_top.amount,
    winning_team_id = v_top.team_id,
    closed_at       = COALESCE(closed_at, now())
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

-- ─── 3. Clear the ghost bids left by the old race ────────────────────────────
-- Rows that sit above a settled round's winning bid were stored but never
-- counted (the admin feed showed them, the round went to someone else).
-- Marking them invalid makes the live feed agree with the settled result.

UPDATE bids b
SET is_valid = false
WHERE b.is_valid = true
  AND EXISTS (
    SELECT 1 FROM auctions a
    WHERE a.id = b.auction_id
      AND a.status IN ('question', 'completed', 'closed')
      AND a.winning_bid IS NOT NULL
      AND b.amount > a.winning_bid
  );

-- ─── 4. Public round results (announcements) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS round_results (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auction_id      UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  item_id         UUID,
  item_name       TEXT,
  team_id         UUID REFERENCES teams(id) ON DELETE SET NULL,
  team_name       TEXT,
  result          TEXT NOT NULL CHECK (result IN ('correct', 'wrong')),
  selected_answer TEXT,
  correct_answer  TEXT,
  reward          INTEGER NOT NULL DEFAULT 0,
  penalty         INTEGER NOT NULL DEFAULT 0,
  graded_by       TEXT NOT NULL DEFAULT 'auto' CHECK (graded_by IN ('auto', 'admin')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_round_results_created_at ON round_results(created_at DESC);

ALTER TABLE round_results ENABLE ROW LEVEL SECURITY;

-- Everyone (incl. the logged-out projector) may READ results — they are shown
-- on the big screen. Nobody writes directly: rows are only ever produced by
-- settle_answer() inside the settlement transaction.
DROP POLICY IF EXISTS "Anyone can read round results" ON round_results;
CREATE POLICY "Anyone can read round results"
  ON round_results FOR SELECT
  TO anon, authenticated
  USING (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'round_results'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE round_results;
  END IF;
END $$;

-- ─── 5. settle_answer: announce the verdict to every panel ───────────────────

CREATE OR REPLACE FUNCTION settle_answer(
  p_auction_id UUID,
  p_result TEXT,
  p_selected TEXT,
  p_admin_id UUID DEFAULT NULL
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

  -- Attempt row (created if the team never submitted through the RPC).
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

  -- Inactivity: winner resets; everyone else ticks +1; teams REACHING 3 dry
  -- rounds take a −150 TC hit and reset. One pass — no re-read races.
  UPDATE teams SET
    rounds_inactive = CASE
      WHEN id = v_team.id THEN 0
      WHEN rounds_inactive + 1 >= 3 THEN 0
      ELSE rounds_inactive + 1
    END,
    current_budget = CASE
      WHEN id <> v_team.id AND rounds_inactive + 1 >= 3
        THEN GREATEST(0, current_budget - 150)
      ELSE current_budget
    END
  WHERE is_active = true;

  -- Post-update, rounds_inactive = 0 marks exactly the winner + penalized teams.
  INSERT INTO budget_transactions (team_id, type, amount, reason, reference_id)
  SELECT id, 'manual_adjustment', -150,
         'Inactivity penalty - 3 rounds without winning', p_auction_id
  FROM teams
  WHERE is_active = true AND id <> v_team.id AND rounds_inactive = 0;

  -- ANNOUNCEMENT — one public row; admin panel, every team dashboard and the
  -- projector all receive it over realtime and show the same verdict.
  SELECT * INTO v_item FROM auction_items WHERE id = v_auction.item_id;

  INSERT INTO round_results
    (auction_id, item_id, item_name, team_id, team_name, result,
     selected_answer, correct_answer, reward, penalty, graded_by)
  VALUES
    (p_auction_id, v_auction.item_id, v_item.name, v_team.id, v_team.name, p_result,
     p_selected, v_item.correct_answer,
     CASE WHEN p_result = 'correct' THEN v_reward  ELSE 0 END,
     CASE WHEN p_result = 'wrong'   THEN v_penalty ELSE 0 END,
     CASE WHEN p_admin_id IS NULL THEN 'auto' ELSE 'admin' END);

  UPDATE auctions SET status = 'completed' WHERE id = p_auction_id;

  RETURN jsonb_build_object('ok', true,
    'result', p_result,
    'winning_team_id', v_team.id,
    'reward', CASE WHEN p_result = 'correct' THEN v_reward ELSE 0 END);
END;
$$;

REVOKE ALL ON FUNCTION settle_answer(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
