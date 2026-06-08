-- Add LLM-defined context theme detail field to ticket_issues
alter table public.ticket_issues
  add column if not exists theme_detail text;
