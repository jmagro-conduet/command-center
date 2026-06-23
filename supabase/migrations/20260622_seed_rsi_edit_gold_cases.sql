-- RSI casino synthetic EDIT-eval gold cases.
-- The edit eval classifies an agent's edit of a gameLM suggestion into one of:
--   CORRECTION | ENHANCEMENT | PREFERENCE | AGENT_ERROR.
-- RSI transcripts have no gameLM-in-loop suggestion→edit pairs, so these are synthesized
-- to the verdict definitions in eval-edit-prompt.ts. One unambiguous case per class
-- (plus a 2nd CORRECTION). Scoped to RSI, ticket_issue_id NULL, idempotent.

DO $$
DECLARE
  v_op uuid;
BEGIN
  SELECT id INTO v_op FROM public.operators WHERE slug = 'rsi';

  IF v_op IS NULL THEN
    RAISE EXCEPTION 'No operator with slug ''rsi'' found — cannot seed RSI edit gold cases.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.eval_gold_cases WHERE notes LIKE '[RSI-SYNTH-BASELINE-EDIT-v1]%') THEN
    RAISE NOTICE 'RSI edit baseline already seeded; skipping.';
    RETURN;
  END IF;

  INSERT INTO public.eval_gold_cases (
    eval_type, ticket_issue_id, operator_id,
    expected_verdict, expected_error_class,
    player_input, suggested_response, final_edits, agent_reasoning, notes, is_active
  ) VALUES

  -- ── CORRECTION 1: gameLM invented a fixed auto-credit time for a stuck round ──
  ( 'edit', NULL, v_op, 'CORRECTION', NULL,
    'I hit the bonus on a slot and the game froze on a win. Where are my winnings?',
    'Your winnings from the bonus round will automatically appear in your balance within 1 hour — no action is needed.',
    'I''m sorry that happened. I can see a pending round on your account, so I''ve raised it to the game provider to complete it. These reviews can take up to 48 hours; once resolved, any winnings are credited automatically and I''ll follow up by email.',
    'gameLM invented a 1-hour auto-credit. Stuck rounds require game-provider escalation with no guaranteed timeframe, so the original was factually wrong.',
    '[RSI-SYNTH-BASELINE-EDIT-v1] CORRECTION: gameLM gave wrong product info / fabricated timeframe; agent fixed with the correct escalation path.',
    true ),

  -- ── CORRECTION 2: gameLM falsely claimed the player never opted in ───────────
  ( 'edit', NULL, v_op, 'CORRECTION', NULL,
    'Why didn''t I get my deposit match? I opted in and deposited $100.',
    'Our records show you haven''t opted into any promotion, so no bonus was applied.',
    'Thanks for your patience — I can see you did opt into the 100% match and deposited $100. The bonus didn''t attach because the deposit posted a few minutes before the opt-in registered. I''ve escalated it to our promotions team to review.',
    'gameLM wrongly stated the player never opted in; the opt-in is on the account. Corrected the false claim and escalated.',
    '[RSI-SYNTH-BASELINE-EDIT-v1] CORRECTION: gameLM made a false account-state claim (never opted in); agent corrected it.',
    true ),

  -- ── ENHANCEMENT: gameLM correct but generic; agent added priority + specifics ─
  ( 'edit', NULL, v_op, 'ENHANCEMENT', NULL,
    'My $500 debit withdrawal has been pending two days.',
    'Withdrawals are reviewed within 24–48 hours and then take 1–2 business days to post. Yours is still within the normal window.',
    'Withdrawals are reviewed within 24–48 hours and then 1–2 business days to post — yours is still within the normal window. I''ve also flagged it to our payments team to prioritise the review, and confirmed it''s going to the Visa debit ending 4412 you deposited with.',
    'gameLM''s answer was correct but generic. I added the priority flag and confirmed the destination card, which gameLM can''t see.',
    '[RSI-SYNTH-BASELINE-EDIT-v1] ENHANCEMENT: gameLM original was correct; agent added account-specific context + a real escalation step.',
    true ),

  -- ── PREFERENCE: stylistic only, original fully send-worthy ───────────────────
  ( 'edit', NULL, v_op, 'PREFERENCE', NULL,
    'How do I use my free spins?',
    'Hi there! Your 50 free spins are ready — just open Double Diamond or Greenback Attack and they''ll be applied automatically. Winnings carry a 15x wagering requirement.',
    'Hey! Your 50 free spins are good to go — open Double Diamond or Greenback Attack and they apply automatically. Just note that winnings have a 15x playthrough.',
    'Softened the tone a little; same information.',
    '[RSI-SYNTH-BASELINE-EDIT-v1] PREFERENCE: purely stylistic rewording, identical meaning and information.',
    true ),

  -- ── AGENT_ERROR: gameLM was right; agent''s edit introduced a policy error ────
  ( 'edit', NULL, v_op, 'AGENT_ERROR', NULL,
    'Can I withdraw my free spin winnings right now?',
    'Not yet — winnings from the free spins carry a 15x wagering requirement that must be met before they can be withdrawn.',
    'Yes, you can withdraw your free spin winnings anytime — there''s no wagering requirement on free spins.',
    'I thought free spins were exempt from wagering.',
    '[RSI-SYNTH-BASELINE-EDIT-v1] AGENT_ERROR: gameLM correctly stated the 15x requirement; the agent''s edit introduced a false "no wagering" claim, degrading a correct response.',
    true );

  RAISE NOTICE 'Seeded RSI edit baseline: 5 cases (2 CORRECTION, 1 ENHANCEMENT, 1 PREFERENCE, 1 AGENT_ERROR).';
END $$;

-- Verify edit coverage per operator:
SELECT o.name AS operator, c.expected_verdict, count(*) AS cases
FROM   public.eval_gold_cases c
LEFT   JOIN public.operators o ON o.id = c.operator_id
WHERE  c.is_active = true AND c.eval_type = 'edit'
GROUP  BY o.name, c.expected_verdict
ORDER  BY o.name, c.expected_verdict;
