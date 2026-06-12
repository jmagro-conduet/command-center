-- Regression system: gold case library + run history
-- eval_gold_cases: curated examples with known-correct outputs used as regression anchors
-- eval_regression_runs: log of each automated regression run and per-case results

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eval_gold_cases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eval_type            text NOT NULL CHECK (eval_type IN ('edit', 'accuracy', 'quality')),
  ticket_issue_id      uuid REFERENCES public.ticket_issues(id) ON DELETE SET NULL,
  operator_id          uuid REFERENCES public.operators(id),
  expected_verdict     text,        -- edit: CORRECTION / ENHANCEMENT / PREFERENCE / NONE
  expected_error_class text,        -- accuracy: P1A / P1B / P2 / NONE
  player_input         text,
  suggested_response   text,
  final_edits          text,
  agent_reasoning      text,
  conversation_thread  text,
  notes                text,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES auth.users(id),
  CONSTRAINT eval_gold_cases_unique_issue_type UNIQUE (ticket_issue_id, eval_type)
);

CREATE TABLE IF NOT EXISTS public.eval_regression_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at       timestamptz NOT NULL DEFAULT now(),
  triggered_by text,
  eval_type    text,                -- null = all types run together
  total_cases  integer NOT NULL DEFAULT 0,
  passed       integer NOT NULL DEFAULT 0,
  failed       integer NOT NULL DEFAULT 0,
  pass_rate    numeric(5,2),
  results      jsonb,               -- array of {case_id, eval_type, expected, got, passed}
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS eval_gold_cases_type_idx   ON public.eval_gold_cases (eval_type) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS eval_regression_runs_at_idx ON public.eval_regression_runs (run_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.eval_gold_cases      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eval_regression_runs ENABLE ROW LEVEL SECURITY;

-- Gold cases: all authenticated users can read; only admins can write
CREATE POLICY "eval_gold_cases_select"
  ON public.eval_gold_cases FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "eval_gold_cases_insert"
  ON public.eval_gold_cases FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

CREATE POLICY "eval_gold_cases_update"
  ON public.eval_gold_cases FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

CREATE POLICY "eval_gold_cases_delete"
  ON public.eval_gold_cases FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

-- Regression runs: admins and QA can read; service role writes (bypasses RLS)
CREATE POLICY "eval_regression_runs_select"
  ON public.eval_regression_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'qa'))
  );

-- ── Seed: 5 verified BetSaracen NONE cases (no accuracy errors) ──────────────
-- Tickets 520582, 534522, 534780, 534549, 522172 from verified window 5/30–6/9.
-- Uses ticket_number → first ticket_issue per ticket. Idempotent via ON CONFLICT DO NOTHING.

DO $$
DECLARE
  v_issue_id   uuid;
  v_player     text;
  v_suggested  text;
  v_ticket_num text;
  ticket_nums  text[] := ARRAY['520582', '534522', '534780', '534549', '522172'];
BEGIN
  FOREACH v_ticket_num IN ARRAY ticket_nums LOOP
    SELECT ti.id, ti.customer_input, ti.suggested_response
    INTO   v_issue_id, v_player, v_suggested
    FROM   public.ticket_issues ti
    JOIN   public.tickets       tk ON tk.id = ti.ticket_id
    WHERE  tk.ticket_number = v_ticket_num
    ORDER  BY ti.logged_at ASC NULLS LAST
    LIMIT  1;

    IF v_issue_id IS NOT NULL THEN
      INSERT INTO public.eval_gold_cases (
        eval_type, ticket_issue_id, expected_error_class,
        player_input, suggested_response, notes
      )
      VALUES (
        'accuracy', v_issue_id, 'NONE',
        v_player, v_suggested,
        'Seeded from verified BetSaracen NONE case — no accuracy errors found'
      )
      ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;
    END IF;
  END LOOP;
END $$;
