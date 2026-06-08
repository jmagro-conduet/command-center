-- Checklist review tracking + theme tagging on ticket_issues
-- Run in Supabase SQL editor before deploying the updated edge functions.

alter table public.ticket_issues
  add column if not exists review_status  text default 'pending'
    check (review_status in ('pending', 'confirmed', 'dismissed')),
  add column if not exists review_notes   text,
  add column if not exists reviewed_by    text,
  add column if not exists reviewed_at    timestamptz,
  add column if not exists theme_tag      text;
