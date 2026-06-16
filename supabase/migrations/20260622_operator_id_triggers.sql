-- Guarantee operator_id is ALWAYS populated on tickets + ticket_issues.
--
-- Root cause of the "leaderboard not updating" bug: inserts (CSV import, and the
-- LogTicket path when no operator was actively selected) left operator_id NULL on
-- both tables. Every operator-scoped reader — leaderboard, analytics, and
-- operator-scoped eval backfills — filters `operator_id = <operator>` and so
-- silently DROPS NULL rows. Result: agents (e.g. the Manila team) appeared to have
-- far fewer logged tickets than they actually did (Yvette showed 0 of 9).
--
-- Fix = make the DB enforce the invariant, regardless of which code path inserts:
--   * BEFORE INSERT on tickets       -> derive operator_id from agent_team -> operators.name
--   * BEFORE INSERT on ticket_issues -> inherit operator_id from the parent ticket
-- plus a one-time backfill of existing NULL rows.

-- one-time backfill
update tickets set operator_id = o.id from operators o
  where tickets.operator_id is null and o.name = tickets.agent_team;
update ticket_issues ti set operator_id = t.operator_id from tickets t
  where ti.ticket_id = t.id and ti.operator_id is null and t.operator_id is not null;

create or replace function public.set_ticket_operator() returns trigger language plpgsql as $$
begin
  if new.operator_id is null and new.agent_team is not null and new.agent_team <> '' then
    select id into new.operator_id from operators where name = new.agent_team limit 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_set_ticket_operator on public.tickets;
create trigger trg_set_ticket_operator before insert on public.tickets
  for each row execute function public.set_ticket_operator();

create or replace function public.set_issue_operator() returns trigger language plpgsql as $$
begin
  if new.operator_id is null then
    select operator_id into new.operator_id from tickets where id = new.ticket_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_set_issue_operator on public.ticket_issues;
create trigger trg_set_issue_operator before insert on public.ticket_issues
  for each row execute function public.set_issue_operator();
