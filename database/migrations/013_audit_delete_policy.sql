-- ═══════════════════════════════════════════════════════════════════════════════
-- 013 — Admins can delete audit log entries
-- ═══════════════════════════════════════════════════════════════════════════════
-- Safe to re-run (idempotent).
--
-- WHY: event_logs had SELECT + INSERT policies only (001). The new audit-clear
-- feature (Settings → clear all, Audit Log → delete one) issues DELETEs from the
-- admin session; with no DELETE policy RLS silently drops them (0 rows removed,
-- no error). This grants deletes to admins only, mirroring the read/insert
-- checks and the "Admins can delete budget_transactions" precedent (006).

DROP POLICY IF EXISTS "Admins can delete event logs" ON event_logs;

CREATE POLICY "Admins can delete event logs"
  ON event_logs FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
