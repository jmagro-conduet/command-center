-- =============================================================================
-- Explicit Data API grants for all public schema tables
-- Required by Supabase's May 30 / October 30 2026 policy change.
--
-- Context: The app currently uses the service_role key client-side, which
-- bypasses RLS entirely. These grants are therefore NOT urgent today but
-- should be applied before October 30 2026, and are a prerequisite for any
-- future move to authenticated-key access with proper per-user RLS policies.
--
-- Run this in the Supabase SQL Editor (or via supabase db push).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tickets
-- Agents create and read tickets; no direct deletion from the client.
-- ---------------------------------------------------------------------------
grant select, insert, update
  on public.tickets
  to authenticated;

grant select, insert, update, delete
  on public.tickets
  to service_role;

alter table public.tickets enable row level security;

create policy "authenticated users can read all tickets"
  on public.tickets for select to authenticated using (true);

create policy "authenticated users can insert tickets"
  on public.tickets for insert to authenticated with check (true);

create policy "authenticated users can update tickets"
  on public.tickets for update to authenticated using (true);


-- ---------------------------------------------------------------------------
-- ticket_issues
-- ---------------------------------------------------------------------------
grant select, insert, update, delete
  on public.ticket_issues
  to authenticated;

grant select, insert, update, delete
  on public.ticket_issues
  to service_role;

alter table public.ticket_issues enable row level security;

create policy "authenticated users can read all ticket_issues"
  on public.ticket_issues for select to authenticated using (true);

create policy "authenticated users can insert ticket_issues"
  on public.ticket_issues for insert to authenticated with check (true);

create policy "authenticated users can update ticket_issues"
  on public.ticket_issues for update to authenticated using (true);

create policy "authenticated users can delete ticket_issues"
  on public.ticket_issues for delete to authenticated using (true);


-- ---------------------------------------------------------------------------
-- users
-- Agents read the full user list for leaderboard / lookups.
-- Only service_role should mutate rows (add-user script etc.).
-- ---------------------------------------------------------------------------
grant select
  on public.users
  to authenticated;

grant select, insert, update, delete
  on public.users
  to service_role;

alter table public.users enable row level security;

create policy "authenticated users can read all users"
  on public.users for select to authenticated using (true);


-- ---------------------------------------------------------------------------
-- api_keys
-- Sensitive — read-only for authenticated; writes via service_role only.
-- ---------------------------------------------------------------------------
grant select
  on public.api_keys
  to authenticated;

grant select, insert, update, delete
  on public.api_keys
  to service_role;

alter table public.api_keys enable row level security;

create policy "authenticated users can read api_keys"
  on public.api_keys for select to authenticated using (true);


-- ---------------------------------------------------------------------------
-- kb_articles  (knowledge base — Learn page)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete
  on public.kb_articles
  to authenticated;

grant select, insert, update, delete
  on public.kb_articles
  to service_role;

alter table public.kb_articles enable row level security;

create policy "authenticated users can read kb_articles"
  on public.kb_articles for select to authenticated using (true);

create policy "authenticated users can manage kb_articles"
  on public.kb_articles for all to authenticated using (true);


-- ---------------------------------------------------------------------------
-- hot_events
-- ---------------------------------------------------------------------------
grant select
  on public.hot_events
  to authenticated;

grant select, insert, update, delete
  on public.hot_events
  to service_role;

alter table public.hot_events enable row level security;

create policy "authenticated users can read hot_events"
  on public.hot_events for select to authenticated using (true);


-- ---------------------------------------------------------------------------
-- daily_bulletins
-- ---------------------------------------------------------------------------
grant select
  on public.daily_bulletins
  to authenticated;

grant select, insert, update, delete
  on public.daily_bulletins
  to service_role;

alter table public.daily_bulletins enable row level security;

create policy "authenticated users can read daily_bulletins"
  on public.daily_bulletins for select to authenticated using (true);


-- ---------------------------------------------------------------------------
-- bulletin_views  (tracks which agents have seen each bulletin)
-- ---------------------------------------------------------------------------
grant select, insert
  on public.bulletin_views
  to authenticated;

grant select, insert, update, delete
  on public.bulletin_views
  to service_role;

alter table public.bulletin_views enable row level security;

create policy "authenticated users can read bulletin_views"
  on public.bulletin_views for select to authenticated using (true);

create policy "authenticated users can insert bulletin_views"
  on public.bulletin_views for insert to authenticated with check (true);


-- ---------------------------------------------------------------------------
-- event_checklists
-- ---------------------------------------------------------------------------
grant select
  on public.event_checklists
  to authenticated;

grant select, insert, update, delete
  on public.event_checklists
  to service_role;

alter table public.event_checklists enable row level security;

create policy "authenticated users can read event_checklists"
  on public.event_checklists for select to authenticated using (true);


-- ---------------------------------------------------------------------------
-- operator_teams
-- ---------------------------------------------------------------------------
grant select
  on public.operator_teams
  to authenticated;

grant select, insert, update, delete
  on public.operator_teams
  to service_role;

alter table public.operator_teams enable row level security;

create policy "authenticated users can read operator_teams"
  on public.operator_teams for select to authenticated using (true);


-- ---------------------------------------------------------------------------
-- report_history
-- ---------------------------------------------------------------------------
grant select, insert
  on public.report_history
  to authenticated;

grant select, insert, update, delete
  on public.report_history
  to service_role;

alter table public.report_history enable row level security;

create policy "authenticated users can read report_history"
  on public.report_history for select to authenticated using (true);

create policy "authenticated users can insert report_history"
  on public.report_history for insert to authenticated with check (true);


-- ---------------------------------------------------------------------------
-- event_analytics
-- ---------------------------------------------------------------------------
grant select, insert
  on public.event_analytics
  to authenticated;

grant select, insert, update, delete
  on public.event_analytics
  to service_role;

alter table public.event_analytics enable row level security;

create policy "authenticated users can read event_analytics"
  on public.event_analytics for select to authenticated using (true);

create policy "authenticated users can insert event_analytics"
  on public.event_analytics for insert to authenticated with check (true);


-- ---------------------------------------------------------------------------
-- staffing_requirements
-- ---------------------------------------------------------------------------
grant select
  on public.staffing_requirements
  to authenticated;

grant select, insert, update, delete
  on public.staffing_requirements
  to service_role;

alter table public.staffing_requirements enable row level security;

create policy "authenticated users can read staffing_requirements"
  on public.staffing_requirements for select to authenticated using (true);
