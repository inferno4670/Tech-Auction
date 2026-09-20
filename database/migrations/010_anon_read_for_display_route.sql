-- ═══════════════════════════════════════════════════════════════════════════
-- 010 — Public (anon) read access for the projector route (/display)
-- ═══════════════════════════════════════════════════════════════════════════
-- The display route is intentionally public (no auth, see App.tsx). Every
-- existing read policy was 'authenticated'-only, so a logged-out projector
-- could never read event settings, the live auction, items or bids — it sat
-- on the READY screen even mid-auction (PostgREST 406 on .single()).
-- Realtime postgres_changes are also RLS-filtered, so this fixes live
-- updates on the projector too.

DROP POLICY IF EXISTS "Public read access to event settings" ON event_settings;
CREATE POLICY "Public read access to event settings"
  ON event_settings FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Public read access to auctions" ON auctions;
CREATE POLICY "Public read access to auctions"
  ON auctions FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Public read access to auction items" ON auction_items;
CREATE POLICY "Public read access to auction items"
  ON auction_items FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Public read access to bids" ON bids;
CREATE POLICY "Public read access to bids"
  ON bids FOR SELECT TO anon USING (true);
