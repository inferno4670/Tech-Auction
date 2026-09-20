-- ═══════════════════════════════════════════════════════════════════════════════
-- 008 — MCQ questions, 60s bidding timer, server-authoritative winner, scoring
-- ═══════════════════════════════════════════════════════════════════════════════
-- Safe to re-run (idempotent).
--
-- WHY:
--  1. MCQ — items can now carry up to 4 options (option_a..option_d). The winning
--     team sees the question with clickable options; their pick is stored on
--     question_attempts.selected_answer for the admin to grade.
--  2. Bidding timer — auctions get bidding_ends_at (absolute server deadline).
--     Every panel computes the countdown from this single timestamp, so admin,
--     teams and display always agree.
--  3. Winner glitch fix — close_bidding() picks the winner ATOMICALLY on the
--     server (highest bid, earliest bid wins ties) and performs the budget
--     deduction in the same transaction. No more races between concurrent bids
--     or stale admin state deciding a different winner than the teams see.
--  4. get_server_time() lets every client measure its clock offset against the
--     database clock, so countdowns tick in sync on all devices.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. MCQ options on items ──────────────────────────────────────────────────

ALTER TABLE auction_items ADD COLUMN IF NOT EXISTS option_a TEXT;
ALTER TABLE auction_items ADD COLUMN IF NOT EXISTS option_b TEXT;
ALTER TABLE auction_items ADD COLUMN IF NOT EXISTS option_c TEXT;
ALTER TABLE auction_items ADD COLUMN IF NOT EXISTS option_d TEXT;

-- ─── 2. Bidding deadline on auctions ──────────────────────────────────────────

ALTER TABLE auctions ADD COLUMN IF NOT EXISTS bidding_ends_at TIMESTAMPTZ;

-- ─── 3. Team's selected MCQ answer ────────────────────────────────────────────

ALTER TABLE question_attempts ADD COLUMN IF NOT EXISTS selected_answer TEXT;

-- One attempt per (auction, team): drop duplicates keeping the latest, then
-- enforce with a unique index (needed for client-side upsert).
DELETE FROM question_attempts a
USING question_attempts b
WHERE a.auction_id = b.auction_id
  AND a.team_id = b.team_id
  AND (a.answered_at < b.answered_at
       OR (a.answered_at = b.answered_at AND a.id::text < b.id::text));

CREATE UNIQUE INDEX IF NOT EXISTS idx_question_attempts_auction_team
  ON question_attempts(auction_id, team_id);

-- Teams may submit (insert) their own answer attempt and change their pick
-- until the admin grades it.
DROP POLICY IF EXISTS "Teams can submit own answer attempts" ON question_attempts;
CREATE POLICY "Teams can submit own answer attempts"
  ON question_attempts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.team_id = team_id
    )
  );

DROP POLICY IF EXISTS "Teams can update own pending attempts" ON question_attempts;
CREATE POLICY "Teams can update own pending attempts"
  ON question_attempts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.team_id = team_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.team_id = team_id
    )
  );

-- ─── 4. Server clock access (for synced countdowns) ───────────────────────────

CREATE OR REPLACE FUNCTION get_server_time()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
AS $$
  SELECT now();
$$;

GRANT EXECUTE ON FUNCTION get_server_time() TO anon, authenticated;

-- ─── 5. Atomic bidding close + winner settlement ──────────────────────────────
-- p_force = TRUE  → admin closes bidding immediately (requires admin role).
-- p_force = FALSE → auto-close, only allowed once bidding_ends_at has passed.
-- Idempotent: closing twice is a no-op. Picks the highest bid; ties go to the
-- earliest bid. Deducts the winning bid from the winner's budget, records the
-- budget transaction, and bumps auctions_won / resets inactivity — all in ONE
-- transaction so every client sees the exact same outcome.

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
  ELSIF v_auction.bidding_ends_at IS NULL OR now() < v_auction.bidding_ends_at THEN
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

REVOKE ALL ON FUNCTION close_bidding(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_bidding(UUID, BOOLEAN) TO authenticated;
