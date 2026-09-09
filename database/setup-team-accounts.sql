-- ═══════════════════════════════════════════════════════════════════════════════
-- TECH AUCTION — Manual Team Account Setup
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- OPTION A: Use the Edge Function (recommended)
--   Deploy: supabase functions deploy create-team-credentials
--   Then click "Generate Team Credentials" in the Admin > Teams page.
--
-- OPTION B: Use this SQL script (manual fallback)
--   Run this in Supabase SQL Editor AFTER teams are created.
--   It creates auth users and links them to teams.
--
-- ⚠️  Passwords are listed below. Change them after the event.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Step 1: Create auth users for each team
-- Email format: {short_name_lowercase}@techquiz.com
-- Password format: {short_name_lowercase}1234

-- Create Team Alpha
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_user_meta_data, raw_app_meta_data
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'alpha@techquiz.com',
  crypt('alpha1234', gen_salt('bf')),
  NOW(), NOW(), NOW(),
  '{"role":"team","display_name":"ALPHA"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb
)
ON CONFLICT (email) DO NOTHING;

-- Create Team Beta
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_user_meta_data, raw_app_meta_data
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'beta@techquiz.com',
  crypt('beta1234', gen_salt('bf')),
  NOW(), NOW(), NOW(),
  '{"role":"team","display_name":"BETA"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb
)
ON CONFLICT (email) DO NOTHING;

-- Create Team Gamma
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_user_meta_data, raw_app_meta_data
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'gamma@techquiz.com',
  crypt('gamma1234', gen_salt('bf')),
  NOW(), NOW(), NOW(),
  '{"role":"team","display_name":"GAMMA"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb
)
ON CONFLICT (email) DO NOTHING;

-- Create Team Delta
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_user_meta_data, raw_app_meta_data
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'delta@techquiz.com',
  crypt('delta1234', gen_salt('bf')),
  NOW(), NOW(), NOW(),
  '{"role":"team","display_name":"DELTA"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb
)
ON CONFLICT (email) DO NOTHING;

-- Create Team Epsilon
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_user_meta_data, raw_app_meta_data
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'epsilon@techquiz.com',
  crypt('epsilon1234', gen_salt('bf')),
  NOW(), NOW(), NOW(),
  '{"role":"team","display_name":"EPSILON"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb
)
ON CONFLICT (email) DO NOTHING;

-- Create Team Zeta
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_user_meta_data, raw_app_meta_data
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'zeta@techquiz.com',
  crypt('zeta1234', gen_salt('bf')),
  NOW(), NOW(), NOW(),
  '{"role":"team","display_name":"ZETA"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb
)
ON CONFLICT (email) DO NOTHING;

-- Create Team Eta
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_user_meta_data, raw_app_meta_data
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'eta@techquiz.com',
  crypt('eta1234', gen_salt('bf')),
  NOW(), NOW(), NOW(),
  '{"role":"team","display_name":"ETA"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb
)
ON CONFLICT (email) DO NOTHING;

-- Create Team Theta
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_user_meta_data, raw_app_meta_data
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'theta@techquiz.com',
  crypt('theta1234', gen_salt('bf')),
  NOW(), NOW(), NOW(),
  '{"role":"team","display_name":"THETA"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb
)
ON CONFLICT (email) DO NOTHING;


-- Step 2: Link auth users to teams via team_members
-- Run this AFTER Step 1 and AFTER teams are created via the Admin UI

INSERT INTO team_members (user_id, team_id)
SELECT au.id, t.id
FROM auth.users au
JOIN teams t ON LOWER(t.short_name) = REPLACE(REPLACE(au.email, '@techquiz.com', ''), 'team ', '')
WHERE au.raw_user_meta_data->>'role' = 'team'
  AND NOT EXISTS (
    SELECT 1 FROM team_members tm WHERE tm.user_id = au.id
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- CREDENTIALS REFERENCE (change passwords after event!)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Team     | Email                    | Password
-- ---------|--------------------------|-------------
-- ALPHA    | alpha@techquiz.com       | alpha1234
-- BETA     | beta@techquiz.com        | beta1234
-- GAMMA    | gamma@techquiz.com       | gamma1234
-- DELTA    | delta@techquiz.com       | delta1234
-- EPSILON  | epsilon@techquiz.com     | epsilon1234
-- ZETA     | zeta@techquiz.com        | zeta1234
-- ETA      | eta@techquiz.com         | eta1234
-- THETA    | theta@techquiz.com       | theta1234
--
-- ═══════════════════════════════════════════════════════════════════════════════
