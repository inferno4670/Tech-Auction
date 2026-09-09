-- ═══════════════════════════════════════════════════════════════════════════════
-- TECH AUCTION — Initial Database Schema
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── PROFILES ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'team')),
  display_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update profiles"
  ON profiles FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── TEAMS ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  logo_url TEXT,
  starting_budget INTEGER NOT NULL DEFAULT 1000,
  current_budget INTEGER NOT NULL DEFAULT 1000,
  score INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  wrong_answers INTEGER NOT NULL DEFAULT 0,
  auctions_won INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teams can read own team"
  ON teams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.team_id = id
    )
  );

CREATE POLICY "Admins can manage all teams"
  ON teams FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── TEAM MEMBERS ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  UNIQUE(user_id)
);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can read own membership"
  ON team_members FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage team members"
  ON team_members FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── AUCTION ITEMS ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL CHECK (difficulty IN ('basic', 'intermediate', 'expert')),
  starting_bid INTEGER NOT NULL DEFAULT 50,
  minimum_increment INTEGER NOT NULL DEFAULT 10,
  reward_points INTEGER NOT NULL DEFAULT 75,
  penalty_points INTEGER NOT NULL DEFAULT 25,
  question TEXT NOT NULL DEFAULT '',
  correct_answer TEXT NOT NULL DEFAULT '',
  hint TEXT,
  special_rule TEXT,
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE auction_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read active items"
  ON auction_items FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage auction items"
  ON auction_items FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── AUCTIONS (live session per item) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES auction_items(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'open', 'closed', 'question', 'completed', 'cancelled')),
  current_bid INTEGER NOT NULL DEFAULT 0,
  current_team_id UUID REFERENCES teams(id),
  winning_bid INTEGER,
  winning_team_id UUID REFERENCES teams(id),
  timer_started_at TIMESTAMPTZ,
  timer_duration INTEGER NOT NULL DEFAULT 20,
  started_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read auctions"
  ON auctions FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage auctions"
  ON auctions FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── BIDS ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  is_valid BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teams can read bids for their auction"
  ON bids FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert bids"
  ON bids FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ─── QUESTION ATTEMPTS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS question_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  result TEXT CHECK (result IN ('correct', 'wrong')),
  points_awarded INTEGER NOT NULL DEFAULT 0,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  admin_id UUID REFERENCES auth.users(id)
);

ALTER TABLE question_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read question attempts"
  ON question_attempts FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage question attempts"
  ON question_attempts FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── SCORE TRANSACTIONS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS score_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('reward', 'penalty', 'bonus', 'manual_adjustment')),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  reference_id UUID,
  admin_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE score_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teams can read own score transactions"
  ON score_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.team_id = team_id
    )
  );

CREATE POLICY "Admins can manage score transactions"
  ON score_transactions FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── BUDGET TRANSACTIONS ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budget_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('starting_budget', 'bid', 'refund', 'manual_adjustment')),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE budget_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teams can read own budget transactions"
  ON budget_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.team_id = team_id
    )
  );

CREATE POLICY "Admins can manage budget transactions"
  ON budget_transactions FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── EVENT SETTINGS ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL DEFAULT 'TECH AUCTION',
  starting_budget INTEGER NOT NULL DEFAULT 1000,
  default_question_time INTEGER NOT NULL DEFAULT 20,
  status TEXT NOT NULL DEFAULT 'setup'
    CHECK (status IN ('setup', 'lobby', 'live', 'paused', 'finalized')),
  demo_mode BOOLEAN NOT NULL DEFAULT false,
  live_mode BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE event_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read event settings"
  ON event_settings FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage event settings"
  ON event_settings FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── EVENT LOGS ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE event_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read event logs"
  ON event_logs FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can insert event logs"
  ON event_logs FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── INDEXES ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_bids_auction_id ON bids(auction_id);
CREATE INDEX idx_bids_team_id ON bids(team_id);
CREATE INDEX idx_bids_created_at ON bids(created_at);
CREATE INDEX idx_auctions_status ON auctions(status);
CREATE INDEX idx_auctions_item_id ON auctions(item_id);
CREATE INDEX idx_teams_score ON teams(score DESC);
CREATE INDEX idx_teams_current_budget ON teams(current_budget DESC);
CREATE INDEX idx_question_attempts_auction_id ON question_attempts(auction_id);
CREATE INDEX idx_score_transactions_team_id ON score_transactions(team_id);
CREATE INDEX idx_budget_transactions_team_id ON budget_transactions(team_id);
CREATE INDEX idx_event_logs_created_at ON event_logs(created_at);
CREATE INDEX idx_event_logs_action ON event_logs(action);

-- ─── RLS for team members to read their own team data ────────────────────────

-- Teams can see other teams' names and scores (for leaderboard)
-- but NOT their budgets or private data
CREATE POLICY "Teams can read team names and scores"
  ON teams FOR SELECT
  USING (auth.role() = 'authenticated');

-- ─── Auto-create profile on signup ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, role, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'team'),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
