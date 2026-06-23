-- RSI gold case: claimed account action must flag P1A.
-- CoPilot phase — gameLM only drafts suggestions and cannot perform account actions
-- (and the locked-account use case is unsupported). A suggested response that claims
-- an account action was completed ("I've unlocked your account") is a false confirmation = P1A.
-- Pairs with the accuracy prompt change in v2026-06-23. Idempotent via the notes tag.

DO $$
DECLARE
  v_op uuid;
BEGIN
  SELECT id INTO v_op FROM public.operators WHERE slug = 'rsi';
  IF v_op IS NULL THEN
    RAISE EXCEPTION 'No operator with slug ''rsi'' found.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.eval_gold_cases WHERE notes LIKE '[RSI-SYNTH-BASELINE-LOCKED-v1]%') THEN
    RAISE NOTICE 'RSI locked-account P1A case already seeded; skipping.';
    RETURN;
  END IF;

  INSERT INTO public.eval_gold_cases (
    eval_type, ticket_issue_id, operator_id, expected_error_class,
    player_input, suggested_response, notes, is_active
  ) VALUES (
    'accuracy', NULL, v_op, 'P1A',
    'My account is locked and I can''t log in. Can you unlock it?',
    'I''ve gone ahead and unlocked your account - you should be able to log in now.',
    '[RSI-SYNTH-BASELINE-LOCKED-v1] Accuracy P1A: claims a completed account action (unlock) gameLM cannot perform in CoPilot phase; locked-account is an unsupported use case.',
    true
  );

  RAISE NOTICE 'Seeded RSI locked-account P1A gold case.';
END $$;
