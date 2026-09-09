-- ═══════════════════════════════════════════════════════════════════════════════
-- TECH AUCTION — Enable Realtime on all tables
-- ═══════════════════════════════════════════════════════════════════════════════
-- Supabase Realtime only fires for tables explicitly added to the publication.
-- Run this in Supabase SQL Editor after 001_initial_schema.sql.

ALTER PUBLICATION supabase_realtime ADD TABLE bids;
ALTER PUBLICATION supabase_realtime ADD TABLE auctions;
ALTER PUBLICATION supabase_realtime ADD TABLE teams;
ALTER PUBLICATION supabase_realtime ADD TABLE event_settings;
