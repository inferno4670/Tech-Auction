-- ═══════════════════════════════════════════════════════════════════════════════
-- 007 — Fix bidding: bid upsert support + unique bids per (auction, team)
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: The team bid flow fails with PostgREST PGRST116 ("Cannot coerce the result
-- to a single JSON object") when a team RAISES an existing bid:
--   - the base schema gave bids an INSERT policy but NO UPDATE policy, so the
--     UPDATE path in placeBid() matched 0 rows and .single() failed to coerce.
--   - nothing prevented duplicate bid rows for the same (auction, team), so a
--     select-then-insert race could also create doubles.
-- This migration is IDEMPOTENT (safe to re-run): policies are dropped and
-- recreated, and the index uses IF NOT EXISTS.

-- ─── 1. Remove duplicate bids (keep each team's latest bid) ──────────────────

DELETE FROM bids a
USING bids b
WHERE a.auction_id = b.auction_id
  AND a.team_id    = b.team_id
  AND (
    a.created_at < b.created_at
    OR (a.created_at = b.created_at AND a.id < b.id)
  );

-- ─── 2. One bid row per (auction, team) — the upsert conflict target ─────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_auction_team
  ON bids (auction_id, team_id);

-- ─── 3. RLS: teams may raise their own bid; admins manage all bids ───────────
-- DROP IF EXISTS first: some live databases already have policies with these
-- names (42710 otherwise), and CREATE POLICY has no IF NOT EXISTS.

DROP POLICY IF EXISTS "Teams can update own bids" ON bids;
CREATE POLICY "Teams can update own bids"
  ON bids FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.team_id = bids.team_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.team_id = bids.team_id
    )
  );

DROP POLICY IF EXISTS "Teams can delete own bids" ON bids;
CREATE POLICY "Teams can delete own bids"
  ON bids FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.team_id = bids.team_id
    )
  );

DROP POLICY IF EXISTS "Admins can update bids" ON bids;
CREATE POLICY "Admins can update bids"
  ON bids FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Admins can delete bids" ON bids;
CREATE POLICY "Admins can delete bids"
  ON bids FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── 4. Verify (run separately if you want to inspect) ───────────────────────
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'bids' ORDER BY cmd, policyname;
-- Expected: FOR INSERT x1, FOR SELECT x1, FOR UPDATE x2, FOR DELETE x2 (plus any legacy).
