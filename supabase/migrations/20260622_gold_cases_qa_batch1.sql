-- Gold cases from QA batch 1 (June 2026 edit eval review)
-- 3 tickets where the auto-eval was dismissed by human reviewers.

-- 535902 — closing message PREFERENCE (auto-eval incorrectly said CORRECTION)
-- Player said "Ok", gameLM sent a send-worthy standard closing, agent added a
-- temperature-check sign-off. Human QA: PREFERENCE.
INSERT INTO public.eval_gold_cases (
  eval_type, ticket_issue_id, expected_verdict, notes, is_active
)
SELECT 'edit', ti.id,
  'PREFERENCE',
  'Player acknowledged with "Ok"; gameLM closing was fully send-worthy. Agent added a temperature-check — stylistic only. Auto-eval incorrectly returned CORRECTION; human QA dismissed to PREFERENCE.',
  true
FROM public.ticket_issues ti
JOIN public.tickets t ON ti.ticket_id = t.id
WHERE t.ticket_number = '535902'
LIMIT 1
ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;

-- 537539 — affiliate bonus CORRECTION (auto-eval missed it)
-- gameLM did not recognise that affiliate-code registrations qualify for a
-- welcome offer, and told the player they had no active bonus. Agent corrected
-- with product knowledge. Human QA: CORRECTION.
INSERT INTO public.eval_gold_cases (
  eval_type, ticket_issue_id, expected_verdict, notes, is_active
)
SELECT 'edit', ti.id,
  'CORRECTION',
  'gameLM told player no active bonus existed; agent knew affiliate registration qualifies for welcome free bets offer. Product-knowledge gap in gameLM. Auto-eval missed CORRECTION; human QA dismissed to CORRECTION.',
  true
FROM public.ticket_issues ti
JOIN public.tickets t ON ti.ticket_id = t.id
WHERE t.ticket_number = '537539'
LIMIT 1
ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;

-- 537279 — agent filled wrong field (AGENT_ERROR) — two ticket_issues on this ticket
-- Auto-eval returned CORRECTION and ENHANCEMENT; human QA dismissed both to AGENT_ERROR.
INSERT INTO public.eval_gold_cases (
  eval_type, ticket_issue_id, expected_verdict, notes, is_active
)
SELECT 'edit', ti.id,
  'AGENT_ERROR',
  'Agent filled the wrong field by accident (mechanical data-entry error). gameLM was correct; agent introduced wrong information. Human QA dismissed auto-eval verdicts to AGENT_ERROR.',
  true
FROM public.ticket_issues ti
JOIN public.tickets t ON ti.ticket_id = t.id
WHERE t.ticket_number = '537279'
ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;
