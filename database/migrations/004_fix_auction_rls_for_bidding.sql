-- ═══════════════════════════════════════════════════════════════════════════════
-- 004 — Allow teams to update auctions during bidding
-- ═══════════════════════════════════════════════════════════════════════════════

-- The placeBid() client function needs to update current_bid and current_team_id
-- on the auctions table. The existing RLS only allows admins to UPDATE auctions,
-- so team bids get recorded in the bids table but the auction is never updated.

-- Allow authenticated users to update open auctions (sets current_bid & current_team_id)
CREATE POLICY "Authenticated users can update open auctions for bidding"
  ON auctions FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (status = 'open');
