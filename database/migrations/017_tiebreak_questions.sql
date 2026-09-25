-- ═══════════════════════════════════════════════════════════════════════════════
-- 017 — Tie-breaker QUESTIONS (a saved bank + a live, first-correct-wins round)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Safe to re-run (idempotent).
--
-- WHY:
--   016 gave the quizmaster a way to RECORD a tie-breaker ruling, but nothing to
--   actually RUN one. At the event the tie is settled by a question: the tied
--   teams see it, they answer, the first team to answer correctly takes the
--   higher place, and the quizmaster then fine-tunes the order by hand.
--
--   Three tables, three jobs:
--
--     tiebreak_questions — the saved bank (the quizmaster prepares it before
--       the event). It carries correct_key, so ONLY admins may read it; teams
--       receive the question (without the key) through get_tiebreak_state().
--
--     tiebreak_sessions — ONE live round: which question, which teams are
--       eligible, and the winner once there is one. Readable by everyone (it
--       holds no answer), so the projector and every panel react over realtime.
--
--     tiebreak_answers — one row per team per round. The unique constraint is
--       the "you only get one shot" rule, enforced by the database rather than
--       by the UI.
--
--   THE WINNER IS DECIDED ON THE SERVER. submit_tiebreak_answer() takes the
--   session row lock, so simultaneous buzzer presses are serialised: the first
--   correct answer closes the round and every later submission reads a closed
--   session. Two teams can never both "win", however close the race.
--
--   WHY THE PUBLIC PAYLOAD IS SAFE TO PUBLISH. While a round is open the
--   public state exposes WHO has answered, never WHAT they picked or whether it
--   was right — otherwise a wrong pick would tell the others which option to
--   avoid, and a four-option question would leak its answer one guess at a time.
--   The picks and the correct key are revealed only once the round is closed.
--   (An admin, who already holds the bank, always sees the full detail.)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. The saved question bank ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tiebreak_questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question    TEXT NOT NULL,
  option_a    TEXT NOT NULL,
  option_b    TEXT NOT NULL,
  option_c    TEXT,
  option_d    TEXT,
  correct_key TEXT NOT NULL CHECK (correct_key IN ('A', 'B', 'C', 'D')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The key must point at an option that actually exists, so a question can
  -- never be saved with an unanswerable answer.
  CONSTRAINT tiebreak_questions_key_has_option CHECK (
    (correct_key = 'A' AND btrim(option_a) <> '') OR
    (correct_key = 'B' AND btrim(option_b) <> '') OR
    (correct_key = 'C' AND COALESCE(btrim(option_c), '') <> '') OR
    (correct_key = 'D' AND COALESCE(btrim(option_d), '') <> '')
  )
);

-- ─── 2. A live tie-break round ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tiebreak_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id       UUID NOT NULL REFERENCES tiebreak_questions(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  eligible_team_ids UUID[] NOT NULL DEFAULT '{}',
  winner_team_id    UUID REFERENCES teams(id) ON DELETE SET NULL,
  winner_key        TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at         TIMESTAMPTZ,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tiebreak_sessions_created_at
  ON tiebreak_sessions(created_at DESC);

-- ─── 3. One answer per team per round ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tiebreak_answers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES tiebreak_sessions(id) ON DELETE CASCADE,
  team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  selected_key TEXT NOT NULL CHECK (selected_key IN ('A', 'B', 'C', 'D')),
  is_correct   BOOLEAN NOT NULL DEFAULT false,
  answered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_tiebreak_answers_session_id
  ON tiebreak_answers(session_id);

-- ─── 4. Row level security ────────────────────────────────────────────────────

ALTER TABLE tiebreak_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiebreak_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiebreak_answers   ENABLE ROW LEVEL SECURITY;

-- The bank carries the answer key: admins only.
DROP POLICY IF EXISTS "Admins manage tiebreak questions" ON tiebreak_questions;
CREATE POLICY "Admins manage tiebreak questions"
  ON tiebreak_questions FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Sessions and answers hold no answer key while a round is open, so everyone may
-- READ them (the projector runs logged out); only admins may write directly, and
-- normal writes go through the RPCs anyway.
DROP POLICY IF EXISTS "Anyone can read tiebreak sessions" ON tiebreak_sessions;
CREATE POLICY "Anyone can read tiebreak sessions"
  ON tiebreak_sessions FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage tiebreak sessions" ON tiebreak_sessions;
CREATE POLICY "Admins manage tiebreak sessions"
  ON tiebreak_sessions FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Anyone can read tiebreak answers" ON tiebreak_answers;
CREATE POLICY "Anyone can read tiebreak answers"
  ON tiebreak_answers FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage tiebreak answers" ON tiebreak_answers;
CREATE POLICY "Admins manage tiebreak answers"
  ON tiebreak_answers FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ─── 5. Realtime ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'tiebreak_sessions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tiebreak_sessions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'tiebreak_answers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tiebreak_answers;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'tiebreak_questions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tiebreak_questions;
  END IF;
END $$;

-- ─── 6. start_tiebreak — put a question in front of the chosen teams ──────────
-- Admin-only. Only ONE round is ever live: any older open session is closed
-- first, so the projector and the dashboards never have to guess which session
-- is "the" tie-break. Teams are filtered to rows that actually exist, so a stale
-- id in the picker cannot create an unreachable participant.

CREATE OR REPLACE FUNCTION start_tiebreak(
  p_question_id UUID,
  p_team_ids UUID[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin   BOOLEAN;
  v_team_ids   UUID[];
  v_session_id UUID;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tiebreak_questions WHERE id = p_question_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'question_not_found');
  END IF;

  SELECT array_agg(t.id) INTO v_team_ids
  FROM teams t
  WHERE t.id = ANY(p_team_ids);

  IF v_team_ids IS NULL OR array_length(v_team_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_teams');
  END IF;

  UPDATE tiebreak_sessions
  SET status = 'closed', closed_at = COALESCE(closed_at, now())
  WHERE status = 'open';

  INSERT INTO tiebreak_sessions (question_id, status, eligible_team_ids, created_by)
  VALUES (p_question_id, 'open', v_team_ids, auth.uid())
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id,
                            'teams', array_length(v_team_ids, 1));
END;
$$;

-- ─── 7. submit_tiebreak_answer — first CORRECT answer wins ───────────────────
-- Callable by a signed-in team member. The session row lock is the whole race
-- fix: submissions queue on it, the first correct pick closes the round, and
-- everyone behind it reads a closed session and is told so. A wrong pick burns
-- that team's one attempt so four options cannot be brute-forced.

CREATE OR REPLACE FUNCTION submit_tiebreak_answer(
  p_session_id UUID,
  p_selected_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session tiebreak_sessions%ROWTYPE;
  v_team_id UUID;
  v_key     TEXT;
  v_correct BOOLEAN;
BEGIN
  v_key := upper(btrim(COALESCE(p_selected_key, '')));
  IF v_key NOT IN ('A', 'B', 'C', 'D') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_key');
  END IF;

  SELECT team_id INTO v_team_id
  FROM team_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_team_member');
  END IF;

  SELECT * INTO v_session FROM tiebreak_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  -- Closed round: the team that won may re-read its own win (a retry after a
  -- dropped response), everyone else is simply too late.
  IF v_session.status <> 'open' THEN
    IF v_session.winner_team_id IS NOT NULL AND v_session.winner_team_id = v_team_id THEN
      RETURN jsonb_build_object('ok', true, 'won', true, 'correct', true, 'already_settled', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'tiebreak_closed');
  END IF;

  IF NOT (v_team_id = ANY(v_session.eligible_team_ids)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_eligible');
  END IF;

  IF EXISTS (SELECT 1 FROM tiebreak_answers
             WHERE session_id = p_session_id AND team_id = v_team_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_answered');
  END IF;

  SELECT (correct_key = v_key) INTO v_correct
  FROM tiebreak_questions WHERE id = v_session.question_id;
  v_correct := COALESCE(v_correct, false);

  INSERT INTO tiebreak_answers (session_id, team_id, selected_key, is_correct)
  VALUES (p_session_id, v_team_id, v_key, v_correct);

  IF v_correct THEN
    UPDATE tiebreak_sessions
    SET winner_team_id = v_team_id,
        winner_key     = v_key,
        status         = 'closed',
        closed_at      = now()
    WHERE id = p_session_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'correct', v_correct, 'won', v_correct);
END;
$$;

-- ─── 8. close_tiebreak — end the round with nobody (or somebody) right ───────
-- Admin-only. Pass no id to close whichever round is live ("stop / dismiss").

CREATE OR REPLACE FUNCTION close_tiebreak(p_session_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_closed   INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  IF p_session_id IS NULL THEN
    UPDATE tiebreak_sessions
    SET status = 'closed', closed_at = now()
    WHERE status = 'open';
  ELSE
    UPDATE tiebreak_sessions
    SET status = 'closed', closed_at = COALESCE(closed_at, now())
    WHERE id = p_session_id AND status = 'open';
  END IF;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'closed', v_closed);
END;
$$;

-- ─── 9. get_tiebreak_state — the one read every panel makes ──────────────────
-- Returns the newest round, its question (WITHOUT the key while it is live) and
-- who has answered. Admins get the picks, correctness and the key throughout;
-- everyone else gets them once the round has closed.

CREATE OR REPLACE FUNCTION get_tiebreak_state()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session  tiebreak_sessions%ROWTYPE;
  v_question tiebreak_questions%ROWTYPE;
  v_is_admin BOOLEAN;
  v_reveal   BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  SELECT * INTO v_session
  FROM tiebreak_sessions
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'session', NULL, 'question', NULL,
                              'answers', '[]'::jsonb);
  END IF;

  SELECT * INTO v_question FROM tiebreak_questions WHERE id = v_session.question_id;

  v_reveal := v_is_admin OR v_session.status <> 'open';

  RETURN jsonb_build_object(
    'ok', true,
    'session', jsonb_build_object(
      'id', v_session.id,
      'status', v_session.status,
      'question_id', v_session.question_id,
      'eligible_team_ids', to_jsonb(v_session.eligible_team_ids),
      'winner_team_id', v_session.winner_team_id,
      'winner_team_name', (SELECT name FROM teams WHERE id = v_session.winner_team_id),
      'started_at', v_session.started_at,
      'closed_at', v_session.closed_at
    ),
    'question', CASE WHEN v_question.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_question.id,
      'question', v_question.question,
      'option_a', v_question.option_a,
      'option_b', v_question.option_b,
      'option_c', v_question.option_c,
      'option_d', v_question.option_d,
      'correct_key', CASE WHEN v_reveal THEN v_question.correct_key ELSE NULL END
    ) END,
    'answers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'team_id', a.team_id,
        'team_name', t.name,
        'answered_at', a.answered_at,
        'selected_key', CASE WHEN v_reveal THEN a.selected_key ELSE NULL END,
        'is_correct', CASE WHEN v_reveal THEN a.is_correct ELSE NULL END
      ) ORDER BY a.answered_at)
      FROM tiebreak_answers a
      LEFT JOIN teams t ON t.id = a.team_id
      WHERE a.session_id = v_session.id
    ), '[]'::jsonb)
  );
END;
$$;

-- ─── 10. Grants ───────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION start_tiebreak(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_tiebreak_answer(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION close_tiebreak(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_tiebreak_state() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION start_tiebreak(UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_tiebreak_answer(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION close_tiebreak(UUID) TO authenticated;
-- The projector is logged out and renders the live tie-break, so this read is
-- open — it is built to carry no answer while a round is running.
GRANT EXECUTE ON FUNCTION get_tiebreak_state() TO anon, authenticated;
