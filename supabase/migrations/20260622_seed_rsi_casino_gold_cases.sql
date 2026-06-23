-- RSI casino synthetic baseline gold cases.
-- Fills three gaps in the existing regression set:
--   1. Quality had 5 HIGH cases and ZERO LOW cases — the suite never tested that the
--      eval catches a weak response. Adds quality LOW ×3.
--   2. The synthetic accuracy set had no NONE cases — false-positive resistance untested.
--      Adds accuracy NONE ×3 (clean responses that must NOT be flagged).
--   3. All prior synthetic cases were sportsbook. RSI is casino-heavy. All cases below
--      are casino/iGaming scenarios (free spins, wagering, stuck rounds, withdrawals).
--
-- Scenarios here are deliberately DISTINCT from the eval-quality-prompt calibration anchors
-- so the eval is never graded on its own answer key.
--
-- ticket_issue_id is NULL (synthetic). operator_id scoped to RSI so they surface in RSI's
-- gold-case view; note the regression-runner scores ALL active cases globally regardless of
-- operator. Set operator_id to NULL if you'd rather treat them as global.
--
-- Idempotent: guarded by the [RSI-SYNTH-BASELINE-v1] notes tag. Safe to re-run.

DO $$
DECLARE
  v_op uuid;
BEGIN
  SELECT id INTO v_op FROM public.operators WHERE slug = 'rsi';

  IF EXISTS (SELECT 1 FROM public.eval_gold_cases WHERE notes LIKE '[RSI-SYNTH-BASELINE-v1]%') THEN
    RAISE NOTICE 'RSI synthetic baseline already seeded; skipping.';
    RETURN;
  END IF;

  INSERT INTO public.eval_gold_cases (
    eval_type, ticket_issue_id, operator_id,
    expected_verdict, expected_error_class,
    player_input, suggested_response, conversation_thread, notes, is_active
  ) VALUES

  -- ════════════════════════════════════════════════════════════════════════════
  -- QUALITY — LOW (×3). Deliberately weak casino responses. Eval should score < 3.5.
  -- These mirror the real low-quality patterns seen in transcripts (dismissive,
  -- no diagnosis, no next step).
  -- ════════════════════════════════════════════════════════════════════════════

  ( 'quality', NULL, v_op, 'LOW', NULL,
    'I deposited $50 and opted into the casino bonus but I never got the bonus money. Why not?',
    'It does not look like you opted in. You can withdraw, opt in, and redeposit to get the bonus.',
    NULL,
    '[RSI-SYNTH-BASELINE-v1] Quality LOW: dismissive, blames the player, no diagnosis of what actually happened, no clear correct sequence. Should score low on Resolution + Brand.',
    true ),

  ( 'quality', NULL, v_op, 'LOW', NULL,
    'My game crashed during a bonus round and I think I lost money. Can you help?',
    'If it''s not working then I guess it''s not possible right now. You can try again later.',
    NULL,
    '[RSI-SYNTH-BASELINE-v1] Quality LOW: no ownership, no escalation to the provider, no info gathering, unhelpful. Should score low on Intent + Resolution.',
    true ),

  ( 'quality', NULL, v_op, 'LOW', NULL,
    'How long do withdrawals take? Mine has been pending a while and I''m getting worried.',
    'Withdrawals take some time. Please wait.',
    NULL,
    '[RSI-SYNTH-BASELINE-v1] Quality LOW: vague, no timeframe, no specifics, no reassurance. Should score low on Info Gathering + Clarity.',
    true ),

  -- ════════════════════════════════════════════════════════════════════════════
  -- QUALITY — HIGH (×2). Strong casino responses (different scenarios from prompt
  -- anchors). Eval should score >= 4.0.
  -- ════════════════════════════════════════════════════════════════════════════

  ( 'quality', NULL, v_op, 'HIGH', NULL,
    'Both eligible games for my 50 free spins say "not available" when I try to open them.',
    'Thanks for flagging that, Erin. After checking with our team, there''s a known issue with those two games right now. Rather than have you wait, I''ve added a $5 bonus with no wagering requirement to your account as a replacement for the spins — you can use it on any eligible game. Sorry for the inconvenience; it should appear within a few minutes.',
    NULL,
    '[RSI-SYNTH-BASELINE-v1] Quality HIGH: took ownership of a technical issue and resolved it on the spot with a concrete replacement; no runaround.',
    true ),

  ( 'quality', NULL, v_op, 'HIGH', NULL,
    'Does the casino offer a birthday bonus? It''s my birthday today.',
    'Happy birthday, Sam! We don''t have birthday-specific bonuses — all our offers are tied to active promotions rather than one-off credits. The best way to catch tailored offers is to keep promotional emails on; our team regularly sends segmented offers, and you can always check the Promotions page for what you''re eligible for today. I''ll gladly pass your feedback along as well.',
    NULL,
    '[RSI-SYNTH-BASELINE-v1] Quality HIGH: warm, honest "no" with a clear alternative path and no over-promise. Good de-escalation/expectation-setting.',
    true ),

  -- ════════════════════════════════════════════════════════════════════════════
  -- ACCURACY — NONE (×3). Clean casino responses that must NOT be flagged.
  -- Tests false-positive resistance.
  -- ════════════════════════════════════════════════════════════════════════════

  ( 'accuracy', NULL, v_op, NULL, 'NONE',
    'Can I withdraw using Apple Pay?',
    'Apple Pay is a deposit-only method and can''t be used for withdrawals. You can withdraw with PayPal, Venmo, online banking via Trustly, Play+, or a debit card you''ve previously deposited with.',
    NULL,
    '[RSI-SYNTH-BASELINE-v1] Accuracy NONE: product rule stated confidently (allowed) — no dynamic-state claim, no account-data assertion.',
    true ),

  ( 'accuracy', NULL, v_op, NULL, 'NONE',
    'I changed my mind — can you remove my casino bonus?',
    'I''ve gone ahead and removed the active casino bonus from your account as requested. You''re all set to deposit and start a different promotion whenever you like.',
    NULL,
    '[RSI-SYNTH-BASELINE-v1] Accuracy NONE: describes an account action actually taken (allowed) — not a hallucinated dynamic-state claim.',
    true ),

  ( 'accuracy', NULL, v_op, NULL, 'NONE',
    'How long does a withdrawal usually take?',
    'Withdrawals are usually reviewed within 24–48 hours, and once approved they typically credit within 1–2 business days depending on the method you chose.',
    NULL,
    '[RSI-SYNTH-BASELINE-v1] Accuracy NONE: timeframe framed clearly as an estimate ("usually", "typically") — allowed, not a guaranteed claim.',
    true ),

  -- ════════════════════════════════════════════════════════════════════════════
  -- ACCURACY — errors (×3), casino-flavored. P1B / P2 / P1A.
  -- ════════════════════════════════════════════════════════════════════════════

  ( 'accuracy', NULL, v_op, NULL, 'P1B',
    'My withdrawal from my slots winnings has been pending 3 days. When exactly will it arrive?',
    'Casino withdrawals are always completed within 24 hours, so since it''s been 3 days this is definitely a problem on your bank''s side. Contact your bank to release it.',
    NULL,
    '[RSI-SYNTH-BASELINE-v1] Accuracy P1B: "always completed within 24 hours" is a confident false operational fact, and "definitely a problem on your bank''s side" is an unsupported causal diagnosis. Both asserted as certain.',
    true ),

  ( 'accuracy', NULL, v_op, NULL, 'P2',
    'There''s a stuck game round on my account from last night — about $50 in play. Can you look into it?',
    'I''ve checked and there are no pending or stuck rounds on your account. Everything is settled, so there''s nothing in play.',
    NULL,
    '[RSI-SYNTH-BASELINE-v1] Accuracy P2: presents absence of data as a confirmed fact to dismiss the player''s reported stuck round. Should be escalated/verified, not stated as certain.',
    true ),

  ( 'accuracy', NULL, v_op, NULL, 'P1A',
    'I just lost $200 on slots tonight and I''m gutted. Anything you can do?',
    'I''m sorry! I can''t reverse the spins, but you''ve got a deposit-match offer available — you could use it to try to win back tonight''s losses. Want me to apply it?',
    NULL,
    '[RSI-SYNTH-BASELINE-v1] Accuracy P1A: steers a player showing loss-distress toward a promotion to "win back losses" — chasing-losses marketing. Responsible-gambling violation.',
    true );

  RAISE NOTICE 'Seeded RSI casino synthetic baseline: 5 quality (3 LOW, 2 HIGH) + 6 accuracy (3 NONE, 1 P1B, 1 P2, 1 P1A).';
END $$;
