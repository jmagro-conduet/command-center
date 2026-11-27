-- =============================================================================
-- Raphie Hub shell: Operators page + SuperAdmin-only manager pages
--
-- Run after 20261125_access_profiles.sql. Additive and safe to re-run.
--
--  1. New page 'operators' (cross-operator performance overview). Off by default:
--     only the SuperAdmin profile gets it. Any other profile can turn it on in
--     Admin settings, Roles & access.
--  2. 'users' and 'admin-settings' are SuperAdmin-only. The resolver now returns
--     'none' for them unless the person's data role is superadmin, whatever a
--     profile or per-person override says. (Mirrors src/lib/access/core.ts.)
-- =============================================================================

insert into public.access_profile_pages (profile_key, page_key, level)
values ('superadmin', 'operators', 'view')
on conflict (profile_key, page_key) do nothing;

create or replace function public.page_level_for_email(p_email text, p_page text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  u    record;
  prof text;
  ov   text;
  lvl  text;
begin
  select id, role, access_profile into u from public.users where lower(email) = lower(p_email) limit 1;
  if not found then return 'none'; end if;

  if u.role = 'operator' then   -- operators are fixed: the operator profile only, no overrides
    select level into lvl from public.access_profile_pages where profile_key = 'operator' and page_key = p_page;
    return coalesce(lvl, 'none');
  end if;

  -- managing people and access is for SuperAdmins only
  if p_page in ('users', 'admin-settings') and u.role <> 'superadmin' then return 'none'; end if;

  -- level is null on rows written before the access-profiles release: fall back to can_edit
  select coalesce(level, case when can_edit then 'edit' else 'view' end) into ov
    from public.page_access where user_id = u.id and page_key = p_page;
  if ov is not null then return ov; end if;

  prof := coalesce(u.access_profile, u.role);
  select level into lvl from public.access_profile_pages where profile_key = prof and page_key = p_page;
  return coalesce(lvl, 'none');
end;
$$;
revoke all on function public.page_level_for_email(text, text) from public, anon, authenticated;
grant execute on function public.page_level_for_email(text, text) to service_role;

-- =============================================================================
-- Operator performance summary for Home and the Operators page.
--
-- One aggregated read per operator instead of paging thousands of rows in the browser.
-- Definitions match the existing pages exactly:
--   tickets      distinct tickets with at least one graded response (ticket_number, or the row
--                id for QA-mode operators whose placeholder numbers repeat)
--   perfect rate Perfect / (Perfect + Majority edit + Partial edit); "No response" is excluded
--                (this is how Analytics defines it)
--   avg_quality  mean quality_score over responses the quality eval has scored (Report Card)
--   full_auto_tickets  Full Auto submissions in the window (they have no graded responses)
-- Callable by the app's service client only. It returns numbers only; which operators a person
-- may see is decided by the app, exactly as for the operator switcher.
-- =============================================================================
create or replace function public.operator_perf_summary(p_operator_ids uuid[], p_days int default 30)
returns table (
  operator_id uuid, tickets bigint, perfect bigint, majority_edit bigint, partial_edit bigint,
  no_response bigint, avg_quality numeric, full_auto_tickets bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with win as (select now() - make_interval(days => greatest(p_days, 1)) as since),
  issues as (
    select ti.operator_id, ti.issue_type, ti.quality_score, ti.quality_ran_at,
           case when o.is_qa_mode then t.id::text else coalesce(t.ticket_number::text, t.id::text) end as tkey
    from public.ticket_issues ti
    join public.tickets t on t.id = ti.ticket_id
    join public.operators o on o.id = ti.operator_id
    where ti.operator_id = any(p_operator_ids) and ti.created_at >= (select since from win)
  ),
  agg as (
    select operator_id,
           count(distinct tkey) as tickets,
           count(*) filter (where issue_type = 'Perfect') as perfect,
           count(*) filter (where issue_type = 'Majority edit') as majority_edit,
           count(*) filter (where issue_type = 'Partial edit') as partial_edit,
           count(*) filter (where issue_type = 'No response') as no_response,
           avg(quality_score) filter (where quality_ran_at is not null and quality_score is not null) as avg_quality
    from issues group by operator_id
  ),
  fa as (
    select operator_id, count(*) as n from public.tickets
    where mode = 'full_auto' and operator_id = any(p_operator_ids) and created_at >= (select since from win)
    group by operator_id
  )
  select o.id, coalesce(agg.tickets, 0), coalesce(agg.perfect, 0), coalesce(agg.majority_edit, 0), coalesce(agg.partial_edit, 0),
         coalesce(agg.no_response, 0), round(agg.avg_quality, 2), coalesce(fa.n, 0)
  from public.operators o
  left join agg on agg.operator_id = o.id
  left join fa on fa.operator_id = o.id
  where o.id = any(p_operator_ids);
$$;
revoke all on function public.operator_perf_summary(uuid[], int) from public, anon, authenticated;
grant execute on function public.operator_perf_summary(uuid[], int) to service_role;
