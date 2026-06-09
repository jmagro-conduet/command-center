-- Add review_correct_verdict and review_context columns to ticket_issues
-- review_correct_verdict: structured label for what the verdict SHOULD have been
--   e.g. CORRECTION / ENHANCEMENT / PREFERENCE (edit evals)
--        P1A / P1B / P2 / NONE (accuracy evals)
-- review_context: override-specific explanation — edge cases, missing nuance
--   distinct from review_notes (general QA observations)

ALTER TABLE ticket_issues
  ADD COLUMN IF NOT EXISTS review_correct_verdict TEXT,
  ADD COLUMN IF NOT EXISTS review_context          TEXT;

COMMENT ON COLUMN ticket_issues.review_correct_verdict IS
  'The correct verdict as determined by the human reviewer when overriding Claude''s assessment. Format varies by eval type (e.g. CORRECTION/ENHANCEMENT/PREFERENCE for edit evals; P1A/P1B/P2/NONE for accuracy evals).';

COMMENT ON COLUMN ticket_issues.review_context IS
  'Override-specific context: edge cases or missing nuance that explain why the LLM verdict was wrong. Populated only when review_status = ''dismissed''. Distinct from review_notes (general QA observations).';
