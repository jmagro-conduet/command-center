-- =============================================================================
-- Sales Funnel (Pipedrive pipelines in Raphie Hub)
--
-- Run after 20261127_coming_soon.sql. Additive and safe to re-run.
--
--  1. The planned "Client Status" page becomes "Sales Funnel" (page key sales-funnel). It is OFF by
--     default: only SuperAdmin has it; nothing is granted to the ELT profile until you choose to.
--  2. funnel_docs: the funnel's data store (same (collection, doc_id, data) shape as roadmap_docs and
--     strategy_docs). The pipedrive-sync edge function writes it with the service role; the page reads
--     it with the signed-in person's own client, so row-level security decides who can see deals.
--  3. The pipeline and stage mapping is seeded as config (not sensitive: pipeline and stage names).
-- =============================================================================

-- 1. rename the page key; keep SuperAdmin's access, drop the (unassigned) ELT grant so it stays off
update public.access_profile_pages set page_key = 'sales-funnel' where page_key = 'client-status'
  and not exists (select 1 from public.access_profile_pages x where x.profile_key = access_profile_pages.profile_key and x.page_key = 'sales-funnel');
delete from public.access_profile_pages where page_key = 'client-status';
delete from public.access_profile_pages where profile_key = 'elt' and page_key = 'sales-funnel';
insert into public.access_profile_pages (profile_key, page_key, level) values ('superadmin', 'sales-funnel', 'view')
on conflict (profile_key, page_key) do nothing;
update public.page_access set page_key = 'sales-funnel' where page_key = 'client-status'
  and not exists (select 1 from public.page_access x where x.user_id = page_access.user_id and x.page_key = 'sales-funnel');
delete from public.page_access where page_key = 'client-status';

-- 2. the data store
create table if not exists public.funnel_docs (
  collection text        not null,
  doc_id     text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (collection, doc_id)
);
alter table public.funnel_docs enable row level security;
grant select on public.funnel_docs to authenticated;
grant select, insert, update, delete on public.funnel_docs to service_role;
drop policy if exists "funnel read" on public.funnel_docs;
create policy "funnel read" on public.funnel_docs for select to authenticated
  using (public.has_page_access('sales-funnel', false));
create index if not exists funnel_docs_collection_idx on public.funnel_docs (collection);

-- 3. seed the pipeline and stage mapping (edit here later with a plain update; never overwritten on re-run)
insert into public.funnel_docs (collection, doc_id, data, updated_by) values ('config', 'funnel', $cfg$
{
  "windowDays": 30,
  "hiddenDeals": [],
  "pipelines": [
    { "key": "aj", "id": 3, "name": "AJ Pipeline", "label": "EMEA / Americas", "pre": { "76": "Nurture" }, "lostStage": 43, "wonStep": 6,
      "steps": [ { "name": "Outreach", "stages": [45] }, { "name": "First demo", "stages": [38] }, { "name": "Operator/PAM demo", "stages": [58] },
                 { "name": "Follow-up / POC call", "stages": [75] }, { "name": "Qualified opportunity", "stages": [39] }, { "name": "Pilot", "stages": [41, 42] }, { "name": "Live", "stages": [46] } ] },
    { "key": "apac", "id": 4, "name": "APAC Pipeline", "label": "APAC", "pre": { "69": "Opportunity" }, "lostStage": 56, "wonStep": 6,
      "steps": [ { "name": "Outreach", "stages": [49] }, { "name": "First demo", "stages": [50] }, { "name": "Operator/PAM demo", "stages": [51] },
                 { "name": "Follow-up / POC call", "stages": [] }, { "name": "Qualified opportunity", "stages": [53] }, { "name": "Pilot", "stages": [54, 57] }, { "name": "Live", "stages": [55] } ] },
    { "key": "part", "id": 6, "name": "Partnership Pipeline", "label": "Partners", "pre": {}, "lostStage": null, "wonStep": null,
      "steps": [ { "name": "Qualified lead", "stages": [70] }, { "name": "Contact made", "stages": [71] }, { "name": "Demo scheduled", "stages": [72] },
                 { "name": "Proposal made", "stages": [73] }, { "name": "Negotiations started", "stages": [74] } ] }
  ],
  "stageNames": { "45": "First Contact", "38": "Discovery Call Booked", "58": "Demo Completed", "75": "POC Call", "39": "Proposal Sent", "41": "Proposal Counter Signed",
                  "42": "Integration Started", "46": "Live", "43": "Lost", "76": "Nurture", "49": "First Contact", "50": "Discovery Call Booked", "51": "Demo Completed",
                  "53": "Proposal Sent", "54": "Proposal Counter Signed", "57": "Integration Started", "55": "Live", "56": "Lost", "69": "Opportunity",
                  "70": "Qualified Lead", "71": "Contact Made", "72": "Demo Scheduled", "73": "Proposal Made", "74": "Negotiations Started" }
}
$cfg$::jsonb, 'migration')
on conflict (collection, doc_id) do nothing;
