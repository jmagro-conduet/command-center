-- Seed PREFERENCE edit eval gold cases from the Verdict × Category Matrix CSV.
-- PREFERENCE = gameLM response was acceptable but agent chose a different style/approach.
-- Covers: Bonus, Deposit/Withdrawal (×2), Bet Dispute, Account Access.
-- ON CONFLICT DO NOTHING so safe to re-run.

DO $$
DECLARE
  v_id uuid;
BEGIN

-- ── PREFERENCE 1 — Bonus, skip the question / go straight to the answer ────────
-- Ticket 533613: agent removed unnecessary "are you still registering?" question
--   and went straight to the no-welcome-offer answer + macro.
  SELECT ti.id INTO v_id
  FROM ticket_issues ti JOIN tickets t ON t.id = ti.ticket_id
  WHERE t.ticket_number = '533613'
    AND ti.customer_input ILIKE '%bet $25 get $250%'
  LIMIT 1;

  INSERT INTO public.eval_gold_cases (
    eval_type, ticket_issue_id, expected_verdict,
    player_input, suggested_response, final_edits, agent_reasoning, notes, is_active
  ) VALUES (
    'edit', v_id, 'PREFERENCE',
    'Hello, I was wondering if the bet $25 get $250 promotion was still available. I don''t believe I''ve made by first wager yet',
    'Hi Michael, thanks for reaching out to BetSaracen! My name''s Danny. I see you''re asking about the $25 get $250 promotion — I can definitely help you with that. Can you tell me if you''ve already registered your account or are you still in the signup process?',
    'Hi Michael, thanks for reaching out to BetSaracen! My name''s Danny. I see you''re asking about the $25 get $250 promotion — I can definitely help you with that. Please allow me one moment. Thank you.',
    'The user was asking if we had the welcome offer which we do not. Rather than asking them where they are in the sign up process, I wanted to give them the information. I sent the welcome offer macro after this.',
    'PREFERENCE: gameLM asked an unnecessary qualifying question (registration status) before answering. Agent skipped it and went straight to checking / sending the answer.',
    true
  ) ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;


-- ── PREFERENCE 2 — Deposit/Withdrawal, macro over Q&A ─────────────────────────
-- Ticket 521620: agent used the successful-deposit macro directly instead of
--   asking which payment method to guide them through.
  SELECT ti.id INTO v_id
  FROM ticket_issues ti JOIN tickets t ON t.id = ti.ticket_id
  WHERE t.ticket_number = '521620'
    AND ti.customer_input ILIKE '%Apple Pay to deposit my money%'
  LIMIT 1;

  INSERT INTO public.eval_gold_cases (
    eval_type, ticket_issue_id, expected_verdict,
    player_input, suggested_response, final_edits, agent_reasoning, notes, is_active
  ) VALUES (
    'edit', v_id, 'PREFERENCE',
    'How do I withdraw my money? I used Apple Pay to deposit my money',
    'Thank you for contacting BetSaracen. My name is Riley. I see you''re looking to withdraw your funds after depositing with Apple Pay — I can definitely help you with that! Can you tell me if you''ve already verified your payment method on your account?',
    'It appears that you''ve utilized deposit-only methods such as Apple Pay, Credit, or Cash at Store, which unfortunately cannot be used for withdrawals as these methods require a secure connection between deposit and withdrawal methods for processing. To resolve this, we kindly suggest depositing at least $5 with Venmo, Paypal, or Debit, or $10 with VIP Preferred or Skrill. Once you''ve completed the deposit, the chosen method will become available for withdrawals.',
    'This is our successful deposit macro, usually a very easy contact and prefer to use macro to end chat quickly rather than going back and forth and asking questions I can find out by looking at the account.',
    'PREFERENCE: gameLM asked a clarifying question (payment method status) for a common well-understood scenario. Agent applied the standard Apple Pay macro directly — a confident, efficient shortcut the account context already supported.',
    true
  ) ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;


-- ── PREFERENCE 3 — Deposit/Withdrawal, specific amounts over generic ──────────
-- Ticket 532283: both correct; agent added exact deposit minimums per method.
  SELECT ti.id INTO v_id
  FROM ticket_issues ti JOIN tickets t ON t.id = ti.ticket_id
  WHERE t.ticket_number = '532283'
    AND ti.customer_input ILIKE '%Push_deposit%'
  LIMIT 1;

  INSERT INTO public.eval_gold_cases (
    eval_type, ticket_issue_id, expected_verdict,
    player_input, suggested_response, final_edits, agent_reasoning, notes, is_active
  ) VALUES (
    'edit', v_id, 'PREFERENCE',
    'Push_deposit says not available I used Apple Pay to deposit but that''s not an option for withdraw',
    'Thanks for letting me know, Ayden. Apple Pay can only be used for deposits, which is why it doesn''t appear as a withdrawal option. To cash out your winnings, you''ll need to make a small deposit using a method that supports both deposits and withdrawals, like Venmo, PayPal, Debit, VIP Preferred, or Skrill. Once you do that, the option to withdraw through that method will become available.',
    'Thanks for sending a screenshot. It appears that you''ve utilized deposit-only methods such as Apple Pay, which unfortunately cannot be used for withdrawals as these methods require a secure connection between deposit and withdrawal methods for processing. To resolve this, we kindly suggest depositing at least $5 with Venmo, Paypal, or Debit, or $10 with VIP Preferred or Skrill. Once you''ve completed the deposit, the chosen method will become available for withdrawals.',
    'The response provided by GameLM was appropriate. However, since the user also submitted a screenshot, I decided to use the successful deposit spiel instead. The spiel has different deposit amounts, allowing the user to choose the option that best suited their preferred payment method.',
    'PREFERENCE: gameLM was accurate but generic (no deposit minimums). Agent used the full macro with exact per-method minimums ($5 Venmo/PayPal/Debit, $10 VIP Preferred/Skrill) — more actionable for the player.',
    true
  ) ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;


-- ── PREFERENCE 4 — Bonus, direct answer over back-and-forth ──────────────────
-- Ticket 523002: gameLM asked "can you tell me more" — agent answered directly.
  SELECT ti.id INTO v_id
  FROM ticket_issues ti JOIN tickets t ON t.id = ti.ticket_id
  WHERE t.ticket_number = '523002'
    AND ti.customer_input ILIKE '%referral code for my friend%'
  LIMIT 1;

  INSERT INTO public.eval_gold_cases (
    eval_type, ticket_issue_id, expected_verdict,
    player_input, suggested_response, final_edits, agent_reasoning, notes, is_active
  ) VALUES (
    'edit', v_id, 'PREFERENCE',
    'Where''s a referral code for my friend',
    'Hey Nicholas, thanks for waiting! My name''s Michael R. with BetSaracen. I see you''re asking about a referral code for your friend — I can definitely help with that. Could you tell me a bit more about what you''re trying to do?',
    'Hey Nicholas, thanks for waiting! My name''s Michael R. with BetSaracen. I see you''re asking about a referral code for your friend. Unfortunately at this time, we do not have a "refer a friend" offer. However, I think it''s a great suggestion and will pass this along to our promotions team.',
    'Trimmed down the back and forth to address the issue directly.',
    'PREFERENCE: gameLM asked "tell me more" when the answer (no referral program exists) was already knowable. Agent answered directly and acknowledged the feedback — eliminated an unnecessary turn.',
    true
  ) ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;


-- ── PREFERENCE 5 — Account Access, never echo the player's actual password ────
-- Ticket 519019: agent replaced the echoed password with "the one you provided".
  SELECT ti.id INTO v_id
  FROM ticket_issues ti JOIN tickets t ON t.id = ti.ticket_id
  WHERE t.ticket_number = '519019'
    AND ti.suggested_response ILIKE '%password has been successfully updated to%'
    AND ti.suggested_response ILIKE '%case-sensitive%'
  LIMIT 1;

  INSERT INTO public.eval_gold_cases (
    eval_type, ticket_issue_id, expected_verdict,
    player_input, suggested_response, final_edits, agent_reasoning, notes, is_active
  ) VALUES (
    'edit', v_id, 'PREFERENCE',
    NULL,
    'Thanks, Scott. Your password has been successfully updated to Fancyiris6332! and it''s case-sensitive. Please try logging in using your email address and the new password. Let me know once you''re in!',
    'Thanks, Scott. Your password has been successfully updated to the one you provided and it''s case-sensitive. Please try logging in using your email address and the new password. Let me know once you''re in!',
    'Instead of responding with users preferred password it''s better to say "the one you provided" instead.',
    'PREFERENCE: gameLM echoed the player''s actual password in plain text. Agent replaced it with "the one you provided" — never reflect credentials back in chat.',
    true
  ) ON CONFLICT (ticket_issue_id, eval_type) DO NOTHING;

END $$;
