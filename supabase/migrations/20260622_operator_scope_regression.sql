-- Per-operator scoping for the regression system.
-- 1. Attribute regression runs to an operator (new column on eval_regression_runs).
-- 2. Backfill legacy gold cases that predate operator scoping — all were BetSaracen-derived
--    (seeds in 20260613–20260617) — so assign any operator_id IS NULL row to BetSaracen.
-- Idempotent: ADD COLUMN IF NOT EXISTS; UPDATE only touches rows still NULL.

ALTER TABLE public.eval_regression_runs
  ADD COLUMN IF NOT EXISTS operator_id uuid REFERENCES public.operators(id);

CREATE INDEX IF NOT EXISTS eval_regression_runs_operator_idx
  ON public.eval_regression_runs (operator_id, run_at DESC);

-- Backfill: every gold case created before operator scoping was BetSaracen's.
UPDATE public.eval_gold_cases
SET    operator_id = (SELECT id FROM public.operators WHERE slug = 'betsaracen' LIMIT 1)
WHERE  operator_id IS NULL
  AND  EXISTS (SELECT 1 FROM public.operators WHERE slug = 'betsaracen');

-- Verify scoping coverage:
SELECT o.name AS operator, c.eval_type, count(*) AS cases
FROM   public.eval_gold_cases c
LEFT   JOIN public.operators o ON o.id = c.operator_id
WHERE  c.is_active = true
GROUP  BY o.name, c.eval_type
ORDER  BY o.name, c.eval_type;
