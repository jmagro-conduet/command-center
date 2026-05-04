-- =============================================================
-- Conduet / gameLM — Full Schema Migration
-- Run this in the Supabase SQL Editor for project uepigbagbaskbslpjeqq
-- =============================================================

-- ── users ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  role text DEFAULT 'agent',
  auth_id uuid,
  operator_team text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON users FOR SELECT TO authenticated USING (email = (auth.jwt() ->> 'email'));
CREATE POLICY "Users can insert own profile" ON users FOR INSERT TO authenticated WITH CHECK (email = (auth.jwt() ->> 'email'));
CREATE POLICY "Users can update own profile" ON users FOR UPDATE TO authenticated USING (email = (auth.jwt() ->> 'email')) WITH CHECK (email = (auth.jwt() ->> 'email'));
CREATE POLICY "Admin can view all users" ON users FOR SELECT TO authenticated USING ((auth.jwt() ->> 'email') = 'admin@conduet.com');
CREATE POLICY "Admin can update user roles" ON users FOR UPDATE TO authenticated USING ((auth.jwt() ->> 'email') = 'admin@conduet.com') WITH CHECK ((auth.jwt() ->> 'email') = 'admin@conduet.com');

-- ── operator_teams ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE operator_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view teams" ON operator_teams FOR SELECT TO authenticated USING (true);
CREATE POLICY "Public can read active operator teams" ON operator_teams FOR SELECT TO anon USING (active = true);
CREATE POLICY "Admins can insert operator teams" ON operator_teams FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE email = (auth.jwt() ->> 'email') AND role = 'admin'));
CREATE POLICY "Admins can update operator teams" ON operator_teams FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE email = (auth.jwt() ->> 'email') AND role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE email = (auth.jwt() ->> 'email') AND role = 'admin'));
CREATE POLICY "Admins can delete operator teams" ON operator_teams FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE email = (auth.jwt() ->> 'email') AND role = 'admin'));

-- ── api_keys ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text NOT NULL,
  service_name text NOT NULL,
  api_key text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT fk_user_email FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_user_service ON api_keys(user_email, service_name);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own API keys" ON api_keys FOR SELECT TO authenticated USING (user_email = (auth.jwt() ->> 'email'));
CREATE POLICY "Users can insert own API keys" ON api_keys FOR INSERT TO authenticated WITH CHECK (user_email = (auth.jwt() ->> 'email'));
CREATE POLICY "Users can update own API keys" ON api_keys FOR UPDATE TO authenticated USING (user_email = (auth.jwt() ->> 'email')) WITH CHECK (user_email = (auth.jwt() ->> 'email'));
CREATE POLICY "Users can delete own API keys" ON api_keys FOR DELETE TO authenticated USING (user_email = (auth.jwt() ->> 'email'));
CREATE POLICY "Admin can view all API keys" ON api_keys FOR SELECT TO authenticated USING ((auth.jwt() ->> 'email') = 'admin@conduet.com');

-- ── report_history ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  period text NOT NULL,
  audience text NOT NULL,
  focus_area text,
  issue_count integer DEFAULT 0,
  report_content text NOT NULL,
  generated_by_email text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_report_history_user_created ON report_history(user_id, created_at DESC);
ALTER TABLE report_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reports" ON report_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own reports" ON report_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own reports" ON report_history FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all reports" ON report_history FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.email = (auth.jwt()->>'email') AND users.role = 'admin'));

-- ── daily_bulletins ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_bulletins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  created_by_email text NOT NULL,
  bulletin_date date NOT NULL,
  current_issues text DEFAULT '',
  hot_events text DEFAULT '',
  clickup_tickets text DEFAULT '',
  tips_and_tricks text DEFAULT '',
  last_7_days_metrics jsonb,
  highlights text,
  is_published boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_bulletins_date ON daily_bulletins(bulletin_date DESC);
CREATE INDEX IF NOT EXISTS idx_bulletins_published ON daily_bulletins(is_published);
ALTER TABLE daily_bulletins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all bulletins" ON daily_bulletins FOR SELECT TO authenticated USING ((auth.jwt() ->> 'email') = 'admin@conduet.com');
CREATE POLICY "Admins can create bulletins" ON daily_bulletins FOR INSERT TO authenticated WITH CHECK ((auth.jwt() ->> 'email') = 'admin@conduet.com');
CREATE POLICY "Admins can update bulletins" ON daily_bulletins FOR UPDATE TO authenticated USING ((auth.jwt() ->> 'email') = 'admin@conduet.com') WITH CHECK ((auth.jwt() ->> 'email') = 'admin@conduet.com');
CREATE POLICY "Admins can delete bulletins" ON daily_bulletins FOR DELETE TO authenticated USING ((auth.jwt() ->> 'email') = 'admin@conduet.com');
CREATE POLICY "Agents can view published bulletins" ON daily_bulletins FOR SELECT TO authenticated USING (is_published = true);

-- ── bulletin_views ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bulletin_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulletin_id uuid REFERENCES daily_bulletins(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  viewed_at timestamptz DEFAULT now(),
  UNIQUE(bulletin_id, user_email)
);
CREATE INDEX IF NOT EXISTS idx_bulletin_views_user ON bulletin_views(user_email);
CREATE INDEX IF NOT EXISTS idx_bulletin_views_bulletin ON bulletin_views(bulletin_id);
ALTER TABLE bulletin_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own bulletin views" ON bulletin_views FOR SELECT TO authenticated USING (user_email = (auth.jwt() ->> 'email'));
CREATE POLICY "Users can create their own bulletin views" ON bulletin_views FOR INSERT TO authenticated WITH CHECK (user_email = (auth.jwt() ->> 'email'));

-- ── hot_events ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hot_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  event_type text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('high', 'medium', 'low')),
  primary_department text NOT NULL CHECK (primary_department IN ('verifications', 'payments', 'both')),
  pto_blackout boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hot_events_dates ON hot_events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_hot_events_type ON hot_events(event_type);
ALTER TABLE hot_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view events" ON hot_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert events" ON hot_events FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update events" ON hot_events FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can delete events" ON hot_events FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

INSERT INTO hot_events (name, event_type, start_date, end_date, severity, primary_department, pto_blackout, notes) VALUES
  ('Super Bowl LX', 'super_bowl', '2026-02-08', '2026-02-10', 'high', 'both', true, 'Highest volume event. All hands on deck.'),
  ('NFL Playoffs - Wild Card', 'nfl_playoffs', '2026-01-10', '2026-01-11', 'high', 'both', true, 'Increased volume vs regular season.'),
  ('NFL Playoffs - Divisional', 'nfl_playoffs', '2026-01-16', '2026-01-17', 'high', 'both', true, 'Volume continues building toward Super Bowl.'),
  ('NFL Playoffs - Conference Championships', 'nfl_playoffs', '2026-01-24', '2026-01-24', 'high', 'both', true, 'Final playoff round before Super Bowl.'),
  ('March Madness - First Round', 'march_madness', '2026-03-19', '2026-03-23', 'high', 'both', false, 'Week 1 is critical.'),
  ('NFL Week 1', 'nfl_regular', '2026-09-10', '2026-09-13', 'high', 'verifications', false, 'Sets tone for entire season.'),
  ('College Football Week 1', 'cfb_regular', '2026-08-29', '2026-08-29', 'medium', 'verifications', false, 'Week 0 generates less volume.')
ON CONFLICT DO NOTHING;

-- ── staffing_requirements ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS staffing_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES hot_events(id) ON DELETE CASCADE,
  department text NOT NULL CHECK (department IN ('verifications', 'payments')),
  required_staff integer NOT NULL DEFAULT 0,
  scheduled_staff integer NOT NULL DEFAULT 0,
  date date NOT NULL,
  shift text NOT NULL DEFAULT 'all_day' CHECK (shift IN ('morning', 'afternoon', 'evening', 'all_day')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staffing_event_date ON staffing_requirements(event_id, date);
ALTER TABLE staffing_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view staffing" ON staffing_requirements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert staffing" ON staffing_requirements FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update staffing" ON staffing_requirements FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can delete staffing" ON staffing_requirements FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

-- ── event_checklists ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES hot_events(id) ON DELETE CASCADE,
  task_name text NOT NULL,
  department text NOT NULL CHECK (department IN ('verifications', 'payments', 'both')),
  due_date date NOT NULL,
  completed boolean DEFAULT false,
  completed_by uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklist_event ON event_checklists(event_id);
CREATE INDEX IF NOT EXISTS idx_checklist_due_date ON event_checklists(due_date, completed);
ALTER TABLE event_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view checklists" ON event_checklists FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert checklist items" ON event_checklists FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Authenticated users can update checklist items" ON event_checklists FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins can delete checklist items" ON event_checklists FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

-- ── event_analytics ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES hot_events(id) ON DELETE CASCADE,
  total_issues integer DEFAULT 0,
  predicted_volume integer,
  peak_hour timestamptz,
  avg_resolution_time interval,
  top_issue_categories jsonb,
  staffing_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_event ON event_analytics(event_id);
ALTER TABLE event_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view analytics" ON event_analytics FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert analytics" ON event_analytics FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update analytics" ON event_analytics FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can delete analytics" ON event_analytics FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'));

-- ── tickets ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL,
  ticket_category text DEFAULT '',
  agent_name text NOT NULL DEFAULT '',
  agent_email text NOT NULL DEFAULT '',
  agent_team text,
  notes text DEFAULT '',
  other_category_detail text DEFAULT '',
  attachment_filename text DEFAULT '',
  attachment_url text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents can insert own tickets" ON tickets FOR INSERT TO authenticated WITH CHECK (agent_email = (SELECT email FROM users WHERE auth_id = auth.uid()));
CREATE POLICY "Agents can view own tickets" ON tickets FOR SELECT TO authenticated USING (agent_email = (SELECT email FROM users WHERE auth_id = auth.uid()));
CREATE POLICY "Admins can view all tickets" ON tickets FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.auth_id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update any ticket" ON tickets FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.email = (auth.jwt()->>'email') AND users.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.email = (auth.jwt()->>'email') AND users.role = 'admin'));

-- ── ticket_issues ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  issue_type text NOT NULL DEFAULT '',
  issue_comment text DEFAULT '',
  reasoning text,
  final_edits text,
  customer_input text,
  logged_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE ticket_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents can insert ticket issues for own tickets" ON ticket_issues FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM tickets JOIN users ON users.auth_id = auth.uid() WHERE tickets.id = ticket_id AND tickets.agent_email = users.email));
CREATE POLICY "Agents can view ticket issues for own tickets" ON ticket_issues FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM tickets JOIN users ON users.auth_id = auth.uid() WHERE tickets.id = ticket_id AND tickets.agent_email = users.email));
CREATE POLICY "Admins can view all ticket issues" ON ticket_issues FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.auth_id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update any ticket issue" ON ticket_issues FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.email = (auth.jwt()->>'email') AND users.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.email = (auth.jwt()->>'email') AND users.role = 'admin'));

-- ── kb_articles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kb_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'General',
  is_published boolean NOT NULL DEFAULT false,
  article_type text NOT NULL DEFAULT 'markdown',
  file_url text,
  file_name text,
  file_type text,
  created_by text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_articles_category_idx ON kb_articles(category);
CREATE INDEX IF NOT EXISTS kb_articles_is_published_idx ON kb_articles(is_published);
CREATE INDEX IF NOT EXISTS kb_articles_created_at_idx ON kb_articles(created_at DESC);
ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read published articles" ON kb_articles FOR SELECT TO authenticated USING (is_published = true OR EXISTS (SELECT 1 FROM users WHERE users.auth_id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can insert articles" ON kb_articles FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.auth_id = auth.uid() AND users.role = 'admin'));
CREATE POLICY "Admins can update articles" ON kb_articles FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.auth_id = auth.uid() AND users.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.auth_id = auth.uid() AND users.role = 'admin'));
