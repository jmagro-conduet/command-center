-- Per-eval-type QA review table
-- Replaces the shared review_* columns on ticket_issues so each eval type
-- (edit, accuracy, quality) can have independent QA feedback.
CREATE TABLE IF NOT EXISTS public.ticket_issue_reviews (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_issue_id        uuid        NOT NULL REFERENCES public.ticket_issues(id) ON DELETE CASCADE,
  eval_type              text        NOT NULL CHECK (eval_type IN ('edit', 'accuracy', 'quality')),
  review_status          text        NOT NULL DEFAULT 'pending'
                                     CHECK (review_status IN ('pending', 'confirmed', 'dismissed')),
  review_notes           text,
  review_correct_verdict text,
  review_context         text,
  reviewed_by            text,
  reviewed_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_issue_id, eval_type)
);

ALTER TABLE public.ticket_issue_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_manage_reviews"
  ON public.ticket_issue_reviews
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Migrate all existing edit-eval QA from ticket_issues into the new table.
-- All QA completed to date was done on the Edit Evals tab only.
INSERT INTO public.ticket_issue_reviews (
  ticket_issue_id, eval_type,
  review_status, review_notes, review_correct_verdict, review_context,
  reviewed_by, reviewed_at
)
SELECT
  id, 'edit',
  review_status, review_notes, review_correct_verdict, review_context,
  reviewed_by, reviewed_at
FROM public.ticket_issues
WHERE review_status IN ('confirmed', 'dismissed')
ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;
