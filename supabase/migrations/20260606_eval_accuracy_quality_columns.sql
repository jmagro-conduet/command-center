-- Eval 2 (Response Accuracy) + Eval 3 (Response Quality) columns on ticket_issues
-- Run in Supabase SQL editor before deploying eval-accuracy / eval-quality functions.

alter table public.ticket_issues
  -- Eval 2 — Response Accuracy
  add column if not exists accuracy_error_class   text,          -- P1A | P1B | P2 | NONE
  add column if not exists accuracy_evidence      text,
  add column if not exists accuracy_reasoning     text,
  add column if not exists accuracy_human_review  boolean,       -- always YES for P1B
  add column if not exists accuracy_ran_at        timestamptz,

  -- Eval 3 — Response Quality (1-5 per category)
  add column if not exists quality_intent         smallint,      -- Intent Recognition (25%)
  add column if not exists quality_resolution     smallint,      -- Resolution Quality (25%)
  add column if not exists quality_info_gathering smallint,      -- Information Gathering (20%)
  add column if not exists quality_clarity        smallint,      -- Response Clarity (15%)
  add column if not exists quality_brand          smallint,      -- Brand Alignment (15%)
  add column if not exists quality_score          numeric(4,2),  -- weighted average (1.00–5.00)
  add column if not exists quality_flag           boolean,       -- any category scored 1
  add column if not exists quality_flag_reason    text,
  add column if not exists quality_ran_at         timestamptz;
