-- Seed quality eval gold cases from NONE rows in the Verdict × Category Matrix CSV.
-- These are tickets where no edit was needed → expected quality tier = HIGH (score >= 4.0).
-- Uses ticket_number lookup; picks the most substantive (longest customer_input) issue per ticket
-- to avoid accidentally landing on a "talk to an agent" opener.
-- ON CONFLICT DO NOTHING so safe to re-run.

DO $$
DECLARE
  v_id uuid;
BEGIN

-- ── HIGH 1 — Ticket 532824 ───────────────────────────────────────────────────
  SELECT ti.id INTO v_id
  FROM ticket_issues ti JOIN tickets t ON t.id = ti.ticket_id
  WHERE t.ticket_number = '532824'
    AND ti.customer_input IS NOT NULL
    AND ti.suggested_response IS NOT NULL
    AND length(ti.customer_input) > 10
  ORDER BY length(ti.customer_input) DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.eval_gold_cases (
      eval_type, ticket_issue_id, expected_verdict, notes, is_active
    ) VALUES (
      'quality', v_id, 'HIGH',
      'NONE case from Verdict × Category Matrix — no edit needed. Expected quality score >= 4.0.',
      true
    ) ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;
  END IF;


-- ── HIGH 2 — Ticket 534630 ───────────────────────────────────────────────────
  SELECT ti.id INTO v_id
  FROM ticket_issues ti JOIN tickets t ON t.id = ti.ticket_id
  WHERE t.ticket_number = '534630'
    AND ti.customer_input IS NOT NULL
    AND ti.suggested_response IS NOT NULL
    AND length(ti.customer_input) > 10
  ORDER BY length(ti.customer_input) DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.eval_gold_cases (
      eval_type, ticket_issue_id, expected_verdict, notes, is_active
    ) VALUES (
      'quality', v_id, 'HIGH',
      'NONE case from Verdict × Category Matrix — no edit needed. Expected quality score >= 4.0.',
      true
    ) ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;
  END IF;


-- ── HIGH 3 — Ticket 534552 ───────────────────────────────────────────────────
  SELECT ti.id INTO v_id
  FROM ticket_issues ti JOIN tickets t ON t.id = ti.ticket_id
  WHERE t.ticket_number = '534552'
    AND ti.customer_input IS NOT NULL
    AND ti.suggested_response IS NOT NULL
    AND length(ti.customer_input) > 10
  ORDER BY length(ti.customer_input) DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.eval_gold_cases (
      eval_type, ticket_issue_id, expected_verdict, notes, is_active
    ) VALUES (
      'quality', v_id, 'HIGH',
      'NONE case from Verdict × Category Matrix — no edit needed. Expected quality score >= 4.0.',
      true
    ) ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;
  END IF;


-- ── HIGH 4 — Ticket 535180 ───────────────────────────────────────────────────
  SELECT ti.id INTO v_id
  FROM ticket_issues ti JOIN tickets t ON t.id = ti.ticket_id
  WHERE t.ticket_number = '535180'
    AND ti.customer_input IS NOT NULL
    AND ti.suggested_response IS NOT NULL
    AND length(ti.customer_input) > 10
  ORDER BY length(ti.customer_input) DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.eval_gold_cases (
      eval_type, ticket_issue_id, expected_verdict, notes, is_active
    ) VALUES (
      'quality', v_id, 'HIGH',
      'NONE case from Verdict × Category Matrix — no edit needed. Expected quality score >= 4.0.',
      true
    ) ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;
  END IF;


-- ── HIGH 5 — Ticket 531371 ───────────────────────────────────────────────────
  SELECT ti.id INTO v_id
  FROM ticket_issues ti JOIN tickets t ON t.id = ti.ticket_id
  WHERE t.ticket_number = '531371'
    AND ti.customer_input IS NOT NULL
    AND ti.suggested_response IS NOT NULL
    AND length(ti.customer_input) > 10
  ORDER BY length(ti.customer_input) DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.eval_gold_cases (
      eval_type, ticket_issue_id, expected_verdict, notes, is_active
    ) VALUES (
      'quality', v_id, 'HIGH',
      'NONE case from Verdict × Category Matrix — no edit needed. Expected quality score >= 4.0.',
      true
    ) ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;
  END IF;

END $$;
