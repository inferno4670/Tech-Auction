-- ═══════════════════════════════════════════════════════════════════════════════
-- 003 — Add rounds_inactive tracking for inactive team penalties
-- ═══════════════════════════════════════════════════════════════════════════════

-- Tracks how many consecutive completed auctions a team has NOT placed a bid in.
-- After 3 consecutive inactive rounds, the team receives a -50 point penalty.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS rounds_inactive INTEGER NOT NULL DEFAULT 0;
