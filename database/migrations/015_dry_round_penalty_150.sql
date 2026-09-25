-- ═══════════════════════════════════════════════════════════════════════════════
-- 015 — Dry-round penalty: −100 TC → −150 TC
-- ═══════════════════════════════════════════════════════════════════════════════
-- Safe to re-run (idempotent).
--
-- WHY:
--   A team sitting on its hands for 3 straight rounds lost only −100 TC, which
--   was cheaper than the −150 TC a team pays for skipping the bidding entirely.
--   That made "bid low and lose every time" the cheapest strategy on the floor.
--   Both penalties are now −150 TC, so idling costs the same however you do it.
--
--   NOTE ON THE LEDGER REASON. The old code labelled the ledger row by
--   comparing the amount (amount >= no_bid_penalty → "no bid"). With both
--   amounts equal to 150 that test would mislabel EVERY dry-streak penalty as
--   "no bid placed this round" — the team would read the wrong explanation for
--   the charge. The reason is now derived from the SAME branch that produced the
--   amount (returned alongside it from the penalty CTE), so the two can never
--   drift apart again.
--
--   Precedence is unchanged: a team that placed no valid bid AND is on a dry
--   streak is charged ONCE, as no-bid, and its dry-streak counter still advances
--   (and resets at 3) so it never grows unbounded.
-- ═══════════════════════════════════════════════════════════════════════════════

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
  -- Penalty amounts, one place to tune them. Both are 150 TC: sitting out the
  -- bidding and going three rounds without a win cost the same.
  c_no_bid_penalty   CONSTANT INTEGER := 150;
  c_dry_round_penalty CONSTANT INTEGER := 150;
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
  --   · sat out the bidding entirely       → −150 TC  (no_bid)
  --   · third straight round without a win → −150 TC  (dry streak, counter resets)
  -- At most one of the two per round — no-bid wins the tie — so a team can never
  -- be charged twice for the same round. The dry-streak counter still advances
  -- (and resets at 3) for a no-bid team, so its streak never grows unbounded.
  --
  -- amount and reason come out of the SAME CASE chain, so the ledger label can
  -- never contradict the charge.
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
        END AS amount,
        CASE
          WHEN t.id = v_team.id THEN NULL
          WHEN NOT EXISTS (
            SELECT 1 FROM bids b
            WHERE b.auction_id = p_auction_id
              AND b.team_id = t.id
              AND b.is_valid = true
          ) THEN 'Penalty — no bid placed this round'
          WHEN t.rounds_inactive + 1 >= 3 THEN 'Penalty — 3 rounds without winning'
          ELSE NULL
        END AS reason
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
    RETURNING u.id AS team_id, u.name AS team_name,
              p.amount AS amount, p.reason AS reason
  LOOP
    IF v_pen.amount > 0 THEN
      INSERT INTO budget_transactions (team_id, type, amount, reason, reference_id)
      VALUES (
        v_pen.team_id, 'manual_adjustment', -v_pen.amount,
        COALESCE(v_pen.reason, 'Penalty'),
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

-- settle_answer stays unreachable from clients (only submit_team_answer /
-- grade_answer / expire_question may call it), as before.
REVOKE ALL ON FUNCTION settle_answer(UUID, TEXT, TEXT, UUID, BOOLEAN) FROM PUBLIC;
