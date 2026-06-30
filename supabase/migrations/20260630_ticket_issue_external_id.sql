-- Optional per-response "Ticket ID" captured in the Log Ticket → "Add gameLM response"
-- section. Distinct from ticket_issues.ticket_id (the FK to tickets); this is the
-- external gameLM ticket / conversation ID for the individual response.
alter table public.ticket_issues
  add column if not exists external_ticket_id text;
