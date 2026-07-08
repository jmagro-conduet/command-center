-- Evidence attachments (screenshots, screen recordings, etc.) for bug reports —
-- lets agents attach proof in the moment instead of dropping it in Teams.
-- Stored as a JSON array of { url, name, type, size }.
alter table public.bug_reports
  add column if not exists evidence jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('bug-evidence', 'bug-evidence', true)
on conflict (id) do nothing;

create policy "authenticated_insert_bug_evidence"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'bug-evidence');

create policy "authenticated_select_bug_evidence"
  on storage.objects for select to authenticated
  using (bucket_id = 'bug-evidence');

create policy "authenticated_delete_bug_evidence"
  on storage.objects for delete to authenticated
  using (bucket_id = 'bug-evidence');
