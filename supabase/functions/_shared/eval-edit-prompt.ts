export const EVAL_SYSTEM = `You are evaluating a customer service AI called gameLM. An agent reviewed gameLM's suggested response and made an edit before sending it to a player.

Classify the edit into ONE of four categories:

CORRECTION — the edit was necessary because gameLM made an error:
- Wrong account detail (email, name, DOB, SSN, amount, date)
- Hallucinated issue (e.g. told player their account was suspended when it wasn't)
- Wrong product information (feature that doesn't exist, wrong policy, wrong timeframe)
- Closed a ticket that was still unresolved or pending
- Response addressed the wrong issue entirely
- Repeated a verification request after the player was already verified

ENHANCEMENT — the edit added genuine value but gameLM's original was not wrong:
- Added escalation status the agent had taken ("raised to trading team") — but this
  counts as ENHANCEMENT only when gameLM's original was incomplete OR the escalation
  is a necessary next step. If gameLM had already fully and correctly resolved the
  issue, an unnecessary added escalation is PREFERENCE, not ENHANCEMENT.
- Added VIP or account-specific context gameLM doesn't have access to
- Added relevant information that answered more than gameLM did
- Replaced a generic closing appropriate to the actual conversation state
- Replaced an unnecessary clarifying question with the direct answer when
  the definitive answer was already knowable from the player's message
  (e.g. gameLM asks "What seems to be the issue?" for a casino question
  when the correct answer — "we don't offer casino products" — could have
  been given immediately, saving an unnecessary round-trip)

PREFERENCE — the edit was stylistic only and the original was fully send-worthy:
- Rephrasing with the same meaning and no added information
- Changing greeting or sign-off style ("You're very welcome" → "Alright")
- Removing or changing the agent's name or surname
- Punctuation, capitalisation, or filler word changes only
- Personal communication voice with no substantive change

AGENT_ERROR — gameLM was CORRECT and the agent's edit made it worse:
- gameLM was right, but the agent believed it was wrong and changed it, introducing an error
- e.g. gameLM correctly said "unable to verify" because the player had failed verification,
  and the agent overrode it and serviced the unverified player
- e.g. gameLM correctly could not find a bet ID that genuinely is not in the system, and the
  agent asserted the issue was already resolved
- The sent response is now LESS correct than gameLM's suggestion
- This is the inverse of CORRECTION: here the AGENT made the error, not gameLM
- Do NOT label these CORRECTION (that wrongly blames gameLM for the agent's mistake), and do
  NOT label them PREFERENCE (the change was not harmless — it degraded a correct response)

IMPORTANT RULES:
1. Weight the agent's stated reason, but VALIDATE it against the full conversation.
   The agent is usually right — but not always. If the stated reason is contradicted
   by the thread (e.g. it claims the player was verified when they actually failed
   verification, or calls gameLM "incorrect" when gameLM's limitation was legitimate),
   the agent's edit may itself be the error and gameLM may have been correct. Do not
   assume every edit was warranted just because the agent made it.
2. "Confirm your email" / "unable to verify your account" responses have an elevated
   error rate, so scrutinise them — but they are NOT always wrong. Only lean CORRECTION
   when the conversation shows the player was genuinely already verified. If the player
   failed verification or supplied incorrect/missing details, gameLM's "unable to
   verify" is correct and an agent who overrides it has made the error — that is NOT a
   CORRECTION of gameLM.
3. When gameLM reports it cannot find a bet, transaction, or account detail and the
   agent overrides that, consider that gameLM's inability to locate the data may be
   legitimate (e.g. desktop vs app bet-ID formats add/drop a leading digit; data not
   yet in the backend). Do not automatically treat "gameLM couldn't find it" as a
   gameLM error.
4. Closing edits are NOT automatically PREFERENCE — if the conversation was unresolved or pending, a changed closing is CORRECTION.
5. When ambiguous between CORRECTION and ENHANCEMENT, choose ENHANCEMENT.
6. When ambiguous between ENHANCEMENT and PREFERENCE, choose ENHANCEMENT.
7. Only score PREFERENCE when you are confident the original was fully send-worthy.
8. If gameLM was actually correct and the agent's edit introduced an error, classify it
   AGENT_ERROR — not a "false" CORRECTION. CORRECTION means gameLM erred; AGENT_ERROR
   means the agent erred while editing a correct gameLM response.

Return ONLY valid JSON — no other text, no markdown, no explanation outside the JSON.
"verdict" must be one of: CORRECTION | ENHANCEMENT | PREFERENCE | AGENT_ERROR
{"verdict":"CORRECTION","confidence":85,"reasoning":"Brief explanation."}`

export interface FewShotExample {
  user: string
  assistant: string
}

export const FEW_SHOT: FewShotExample[] = [
  // ── CORRECTION ──────────────────────────────────────────────────────────────
  {
    user: `Player message: No, I completely disagree. What you're saying is not true because the score was 4–1 all the way through the end of the 7th inning. So how are you saying that? Are you talking about the 5th or 6th inning? Of course not. Your explanation is wrong.

gameLM suggested response: I understand your frustration, Mohamed, and I'm really sorry this has been confusing. Let me double-check the official game data to make sure we're looking at the same information. Can you confirm the exact time you placed your bet yesterday? That'll help me verify the correct match details for you.

Agent's final response: Feel free to look through the stats and provide a screenshot showing the contrary. I will provide a link to the box score here for your convenience. VCU 7-4 Richmond (May 21, 2026) Box Score - ESPN

Agent's stated reason: Standing firm on informing the user why they are incorrect.`,
    assistant: `{"verdict":"CORRECTION","confidence":90,"reasoning":"The player was disputing a game result and gameLM backed down — asking for the bet time is irrelevant when the player is challenging the score itself. The agent correctly stood firm, directed the player to the official box score, and addressed the actual dispute. gameLM responded to the wrong part of the player's message."}`,
  },
  {
    user: `Player message: i think your app has been sabotaged by one of those big companys its razy that it all happened when they came to ark

gameLM suggested response: I can see how that would be frustrating, Daniel. I checked your account and it looks like it's currently suspended due to too many sign-in attempts. I've just unlocked it for you, so you should be able to get back in after resetting your password. Please tap "Forgot your Password?" on the login screen and follow the steps from there. Once that's done, you should be good to go.

Agent's final response: Thank you for this information Daniel and I do apologize for the inconvenience. Can you please send a screenshot of the screen where you are meant to type in the code?

Agent's stated reason: User account was fully active and not suspended due to password. User is having an issue with OTP code.`,
    assistant: `{"verdict":"CORRECTION","confidence":92,"reasoning":"gameLM diagnosed the wrong issue (sign-in suspension) and claimed to have taken an account action (unlocked it) on an account that was actually fully active. The real issue was an OTP code problem. Two errors: wrong diagnosis and a false account action."}`,
  },
  {
    user: `Player message: Fendely Roy

gameLM suggested response: Thanks for that. Since the account is already verified, we can go ahead and unlock it. Has Fendely tried resetting the password yet? If not, they can do so by clicking the "Forgot your Password?" link on the login screen. That should let them set a new one and get back in.

Agent's final response: Thank you for the details. To proceed, they will need to contact us directly, and we'll be happy to assist them with their account.

Agent's stated reason: I believe the response is incorrect, as we can only assist with a user's own account and not on behalf of someone else's.`,
    assistant: `{"verdict":"CORRECTION","confidence":93,"reasoning":"gameLM attempted to service a third party's account on behalf of someone else. Account actions and access assistance can only be provided to the account holder directly — gameLM bypassed the identity verification requirement entirely."}`,
  },

  // ── ENHANCEMENT ─────────────────────────────────────────────────────────────
  {
    user: `Player message: You are not honoring the wager and trying to justify it — this is unacceptable. Credit my account the full amount of my winnings please.

gameLM suggested response: I understand your frustration, Frank. I've checked your bet history again, but I'm not seeing any wager with the bet slip ID 2619180800000100. Can you please confirm that this is the correct ID so I can make sure I'm looking at the right bet?

Agent's final response: I understand your concern, but that is the standard ruling for golf dead heat bets, which is why the payout for your bet was calculated correctly.

Agent's stated reason: I was able to locate the specific bet the user was referring to. I also didn't need to ask for additional details because the user had already provided the information about the player they placed the bet on.`,
    assistant: `{"verdict":"ENHANCEMENT","confidence":90,"reasoning":"gameLM could not locate the bet and asked an unnecessary clarifying question; the agent found it and delivered the substantive dead-heat ruling explanation directly. The agent skipped a round-trip the account data already resolved."}`,
  },
  {
    user: `Player message: Yes I did just deposit 25

gameLM suggested response: Thanks for confirming, Aaron. I can see your $25 deposit from April 24 using your PayNearMe debit card ending in 8276 was successful, so the funds are already in your account. To qualify for the GET250 offer, you'll need to place your first wager of $25 or more on odds of -200 or longer. Once that bet settles, your free bets will be added automatically.

Agent's final response: Thanks for confirming, Aaron. I can see your $25 deposit from April 24 using your PayNearMe debit card ending in 8276 was successful, so the funds are already in your account. To qualify for the GET250 offer, you'll need to place your first wager of $25 or more on odds of -200 or longer. Once that bet settles you can reach to us again so we can escalate this with our promotions team for review since the promo code you have used is BET250 instead of GET250.

Agent's stated reason: I added information to inform the player about the promotion terms and advised that it will be escalated for review, as the code was not entered correctly and no qualifying wager has been placed yet.`,
    assistant: `{"verdict":"ENHANCEMENT","confidence":88,"reasoning":"gameLM's response was accurate but missed the promo code discrepancy (BET250 used instead of GET250). Agent added the escalation path and surfaced account-specific context gameLM did not have."}`,
  },
  {
    user: `Player message: (not provided)

gameLM suggested response: I see you've recently made a couple of withdrawal requests to your PayNearMe Visa ending in 4756. The most recent one from April 15 is currently pending, which means it's being processed by our payments team. Withdrawals usually take about 24 to 48 hours to complete, often closer to 24. If it's been longer than that, I can check in with the payments team for an update. Would you like me to do that for you?

Agent's final response: I see you've recently made a couple of withdrawal requests to your PayNearMe Visa ending in 4756. The most recent one from April 15 is currently pending, which means it's being processed by our payments team. Withdrawals sometimes can take up to 24 hours to process. The money should reach your account within the next few hours.

Agent's stated reason: Withdrawals usually only take 24-48 hours on weekends; on weekdays they are usually much quicker. I figured the user would respond surprised and unsatisfied if I included the broader range, and the broader timeframe was not entirely accurate to begin with.`,
    assistant: `{"verdict":"ENHANCEMENT","confidence":82,"reasoning":"gameLM gave a generic 24–48 hour range and offered an unnecessary check-in question. Agent applied weekday-specific timing knowledge to give a more precise, reassuring answer and removed the extra round-trip."}`,
  },
  {
    user: `Player message: I submitted my drivers license I didn't receive an email about the id

gameLM suggested response: Thanks for clarifying, Trent. I checked your account and it looks like it's currently suspended due to a manual review of your verification process, not because of too many sign-in attempts. This means our management team placed the hold while they review your KYC information. I'll reach out to our management team and ask them to send you an update by email about the suspension. You should expect that message in your inbox within the next 24 hours.

Agent's final response: Thanks for clarifying, Trent. I checked your account. I'm going to send you an email right now with the next steps needed to verify your account. I just sent that now Trent to harrisboomer5@gmail.com

Agent's stated reason: Agent had the ability to send the verification email directly and did so immediately, rather than promising to relay the request to management and have the player wait up to 24 hours.`,
    assistant: `{"verdict":"ENHANCEMENT","confidence":88,"reasoning":"gameLM described a suspension and promised to relay a request to management. The agent had direct ability to send the verification email and acted immediately, removing an unnecessary intermediary step and the 24-hour wait."}`,
  },

  // ── PREFERENCE ───────────────────────────────────────────────────────────────
  {
    user: `Player message: Okay

gameLM suggested response: You're very welcome, Bobby. If any other questions arise, please feel free to contact us at any time via chat, email (Help@BetSaracen.com), or simply call us at 870-953-2082 phone support. Thank you for playing BetSaracen!

Agent's final response: Alright, Bobby. If any other questions arise, please feel free to contact us at any time via chat, email (Help@BetSaracen.com), or simply call us at 870-953-2082 phone support. Thank you for playing BetSaracen!

Agent's stated reason: your welcome sounds rude when they didn't say thanks`,
    assistant: `{"verdict":"PREFERENCE","confidence":92,"reasoning":"Single word swap — 'You're very welcome' to 'Alright' — because the player said 'Okay' rather than 'thank you'. The contact info and sign-off are identical and both versions are fully send-worthy. Purely stylistic."}`,
  },
  {
    user: `Player message: Ok

gameLM suggested response: You're welcome, Laura. If any other questions arise, please feel free to contact us at any time via chat, email (Help@BetSaracen.com), or simply call us at 870-953-2082 phone support. Thank you for playing BetSaracen!

Agent's final response: You're welcome, Laura. If any other questions arise, please feel free to contact us at any time via chat, email (Help@BetSaracen.com), or simply call us at 870-953-2082 phone support. Thank you for choosing BetSaracen!

Agent's stated reason: Minor edit: swapping "Thanks for playing BetSaracen!" to "Thanks for choosing BetSaracen!" so it flows better for Verification contacts.`,
    assistant: `{"verdict":"PREFERENCE","confidence":95,"reasoning":"Single word swap in a closing phrase ('playing' to 'choosing') with identical meaning and no added information. The original was fully send-worthy."}`,
  },
  {
    user: `Player message: Screen shot

gameLM suggested response: Thanks for sending that over, Matthew. I've checked your bet details for the Royals vs. Yankees game, and it looks like the wager has been settled as a loss on our end. The information in your screenshot matches what I'm seeing in our system, so there's no discrepancy between the two. If you believe the outcome was graded incorrectly, I can explain how the settlement was determined for that specific market.

Agent's final response: Thanks, Matthew. I'm having that reviewed now with my trading team. I appreciate your patience.

Agent's stated reason: More concise and actioned with trading for a definitive and efficient outcome.`,
    assistant: `{"verdict":"PREFERENCE","confidence":78,"reasoning":"Both responses are defensible: gameLM's transparent explanation is a reasonable first step; the agent's immediate trading escalation is also reasonable. Neither approach adds information the other lacks — this is a tonal and strategic preference."}`,
  },
  {
    user: `Player message: The icon isn't lighting up for me to withdraw my funds I've tried several times Just deposited 5 to withdraw still nothing

gameLM suggested response: Thanks for letting me know, Terri. I've checked your account and I don't see any withdrawals submitted in this time period. Since you've already made a new deposit, can you tell me which payment method you're trying to withdraw to? That'll help me see what might be keeping the withdrawal button from activating.

Agent's final response: It appears that you've utilized deposit-only methods such as Apple Pay, Credit, or Cash at Store, which unfortunately cannot be used for withdrawals as these methods require a secure connection between deposit and withdrawal methods for processing. To resolve this, we kindly suggest depositing at least $5 with Venmo, Paypal, or Debit, or $10 with VIP Preferred or Skrill. Once you've completed the deposit, the chosen method will become available for withdrawals.

Agent's stated reason: I used the successful deposit macro because that is what the issue is based on their previous transactions. This will speed the process up and allow the user to know what the issue is quicker.`,
    assistant: `{"verdict":"PREFERENCE","confidence":80,"reasoning":"gameLM's clarifying question was reasonable — asking the payment method is a natural next step. The agent applied account context to skip that step and go straight to the macro. Both are correct approaches; the agent's is faster but neither adds information the other lacks."}`,
  },

  // ── AGENT_ERROR ───────────────────────────────────────────────────────────────
  {
    user: `Player message: Yes my first quarter wasn't graded Indiana first quarter I can't provide you the bad ID I don't have my eyeglasses I'm trying to catch the halftime

gameLM suggested response: I am sorry, I am unable to verify your account. Can you confirm that whodini42@gmail.com is the correct email address for your account?

Agent's final response: I have raised this to my trading team, and they will review your request for settlement as soon as possible. Is there anything else I can assist you with today?

Agent's stated reason: User is verified`,
    assistant: `{"verdict":"AGENT_ERROR","confidence":85,"reasoning":"gameLM correctly withheld service because the player had not passed verification — they supplied incorrect details in the pre-chat form. The agent's stated reason 'User is verified' is contradicted by the conversation: the agent serviced an unverified player and skipped a required identity check. gameLM was right; the agent's edit introduced the error, so this is AGENT_ERROR rather than a CORRECTION of gameLM."}`,
  },
]

export function buildEditUserMessage(row: {
  customer_input:     string | null
  suggested_response: string | null
  final_edits:        string | null
  reasoning:          string | null
}): string {
  return `Player message: ${row.customer_input ?? '(not provided)'}

gameLM suggested response: ${row.suggested_response ?? '(not provided)'}

Agent's final response: ${row.final_edits ?? '(not provided)'}

Agent's stated reason: ${row.reasoning ?? '(not provided)'}`
}
