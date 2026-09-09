-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: Ensure admin profile exists + reset data capabilities
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Create admin profile if missing (the trigger may not have fired for SQL-inserted users)
INSERT INTO profiles (id, email, role, display_name)
SELECT au.id, au.email, 'admin', COALESCE(au.raw_user_meta_data->>'display_name', 'Admin')
FROM auth.users au
WHERE au.email = 'admin@techquiz.com'
  AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = au.id)
ON CONFLICT (id) DO NOTHING;

-- 2. Also handle any other admin users that might be missing profiles
INSERT INTO profiles (id, email, role, display_name)
SELECT au.id, au.email, COALESCE(au.raw_user_meta_data->>'role', 'admin'), COALESCE(au.raw_user_meta_data->>'display_name', au.email)
FROM auth.users au
WHERE au.raw_user_meta_data->>'role' = 'admin'
  AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = au.id)
ON CONFLICT (id) DO NOTHING;

-- 3. Ensure RLS policies allow the admin to delete from all tables
-- (The "FOR ALL" policies should cover this, but let's add explicit DELETE policies as backup)

-- Bids: admin needs to delete during reset
CREATE POLICY "Admins can delete bids"
  ON bids FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Score transactions: admin needs to delete during reset
CREATE POLICY "Admins can delete score_transactions"
  ON score_transactions FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Budget transactions: admin needs to delete during reset
CREATE POLICY "Admins can delete budget_transactions"
  ON budget_transactions FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
