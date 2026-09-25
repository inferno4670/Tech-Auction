-- ═══════════════════════════════════════════════════════════════════════════════
-- 016 — Manual tie-breaker ordering
-- ═══════════════════════════════════════════════════════════════════════════════
-- Safe to re-run (idempotent).
--
-- WHY:
--   The leaderboard ranks on points → Tech Coins → correct answers, and when two
--   teams are level on all three the last resort was the team NAME (A→Z). That is
--   fine for a demo, but at a live event a tie is settled by a tie-breaker round —
--   someone answers a question, and the quizmaster knows who earned the higher
--   place. There was no way to record that decision: the app would happily rank
--   "Alpha" above "Zeta" on nothing but the alphabet, and if the tie sat on the
--   qualification cut-off it could knock the wrong team out.
--
--   tiebreak_order is that decision, stored on the team.
--
--   IT ONLY EVER BREAKS TIES. getRankings() consults it strictly after points,
--   Tech Coins and correct answers — so it is unreachable for any two teams that
--   are not already level on all three. It cannot move a team past anyone it has
--   genuinely outscored, which is what makes it safe to hand to a quizmaster
--   mid-event. Cleared (NULL) it falls back to the alphabetical default.
--
--   The whole tied group is written in ONE call with the group's ids in the
--   desired order, so the stored values are always a clean 0,1,2… sequence and a
--   partial write can never leave two teams on the same position.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE teams ADD COLUMN IF NOT EXISTS tiebreak_order INTEGER;

COMMENT ON COLUMN teams.tiebreak_order IS
  'Admin tie-breaker position WITHIN a group of teams level on score, budget and correct answers. NULL = alphabetical default. Never affects non-tied teams.';

-- ─── set_tiebreak_order ──────────────────────────────────────────────────────
-- p_team_ids = the tied group in the ORDER THE ADMIN WANTS (first id ranks first)
-- p_clear    = true to wipe the overrides instead (NULL array = wipe EVERY team,
--              which is the "reset all" path)
--
-- Admin-only, enforced server-side on the JWT — a team account cannot reorder the
-- standings even though it can read them.

CREATE OR REPLACE FUNCTION set_tiebreak_order(
  p_team_ids UUID[] DEFAULT NULL,
  p_clear BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_count INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  IF p_clear THEN
    UPDATE teams SET tiebreak_order = NULL
    WHERE p_team_ids IS NULL OR id = ANY(p_team_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'cleared', v_count);
  END IF;

  IF p_team_ids IS NULL OR array_length(p_team_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_teams');
  END IF;

  -- WITH ORDINALITY turns the array into (team_id, 1-based position); storing
  -- ord - 1 gives a 0-based sequence that sorts naturally.
  UPDATE teams t
  SET tiebreak_order = u.ord - 1
  FROM unnest(p_team_ids) WITH ORDINALITY AS u(team_id, ord)
  WHERE t.id = u.team_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'ordered', v_count);
END;
$$;

-- Clients never touch the column directly — only this RPC, and only as an admin.
REVOKE ALL ON FUNCTION set_tiebreak_order(UUID[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_tiebreak_order(UUID[], BOOLEAN) TO authenticated;
