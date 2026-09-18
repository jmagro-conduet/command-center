-- Second rename in quick succession (success -> end_result -> outcome) --
-- "Outcome" reads better as a field label than "End result", same meaning.
-- Same dynamic constraint lookup as the end_result migration, for the same
-- reason: constraint names don't follow column renames in Postgres.

alter table public.tickets rename column end_result to outcome;

do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.tickets'::regclass
      and contype = 'c'
      and conname ilike '%end_result%'
  loop
    execute format('alter table public.tickets drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.tickets
  add constraint tickets_outcome_check
  check (outcome in ('fully_automated', 'escalated_successfully', 'failed'));
