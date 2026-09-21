-- ═══════════════════════════════════════════════════════════════════════════════
-- 011 — Correct leaderboard ranks for teams + auto-verified MCQ answers
-- ═══════════════════════════════════════════════════════════════════════════════
-- Safe to re-run (idempotent).
--
-- WHY:
--  1. Rank bug — the live `teams` SELECT policy only let a team read its OWN row
--     (`id = my_team_id() OR is_admin()`). getRankings() on a team account saw a
--     single team, so every panel computed itself as rank #1. The projector
--     (anon) could not read teams at all. Fix: every authenticated user reads
--     the leaderboard-safe columns; the projector reads them too. Budgets are
--     already public knowledge in this game (shown on the big screen), and no
--     team can WRITE another team's row — that stays admin-only.
--  2. Auto-verified MCQ — teams pick an option; instead of waiting for the
--     quizmaster, a SECURITY DEFINER RPC compares the pick against
--     correct_answer and settles the round atomically (budget refund/bonus,
--     correct/wrong counters, score, attempt row, auction completed). The
--     admin can still override within the question phase via grade_answer().
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Leaderboard reads ─────────────────────────────────────────────────────

-- Teams (and any logged-in user) can read the leaderboard columns of ALL teams.
DROP POLICY IF EXISTS "Authenticated users read leaderboard columns" ON teams;
CREATE POLICY "Authenticated users read leaderboard columns"
  ON teams FOR SELECT
  TO authenticated
  USING (true);

-- The projector route (/display) runs logged-out and shows the live leaderboard.
DROP POLICY IF EXISTS "Public read access to teams" ON teams;
CREATE POLICY "Public read access to teams"
  ON teams FOR SELECT
  TO anon
  USING (true);

-- ─── 2. Shared settlement logic ───────────────────────────────────────────────

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
  v_reward INTEGER;
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

  v_reward := COALESCE(v_auction.winning_bid, 0) + 150;

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

  UPDATE auctions SET status = 'completed' WHERE id = p_auction_id;

  RETURN jsonb_build_object('ok', true,
    'result', p_result,
    'winning_team_id', v_team.id,
    'reward', CASE WHEN p_result = 'correct' THEN v_reward ELSE 0 END);
END;
$$;

-- ─── 3. Team-side auto-verify (submit pick → instant grade) ───────────────────

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

-- ─── 4. Admin override ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION grade_answer(
  p_auction_id UUID,
  p_result TEXT,
  p_selected TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_auction auctions%ROWTYPE;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  SELECT * INTO v_auction FROM auctions WHERE id = p_auction_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auction_not_found');
  END IF;

  IF v_auction.status = 'question' THEN
    RETURN settle_answer(p_auction_id, p_result, p_selected, auth.uid());
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'already_graded');
END;
$$;

REVOKE ALL ON FUNCTION settle_answer(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_team_answer(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION grade_answer(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_team_answer(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION grade_answer(UUID, TEXT, TEXT) TO authenticated;
