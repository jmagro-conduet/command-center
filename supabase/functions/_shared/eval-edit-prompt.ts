export const EVAL_SYSTEM = `You are evaluating a customer service AI called gameLM. An agent reviewed gameLM's suggested response and made an edit before sending it to a player.

Classify the edit into ONE of three categories:

CORRECTION — the edit was necessary because gameLM made an error:
- Wrong account detail (email, name, DOB, SSN, amount, date)
- Hallucinated issue (e.g. told player their account was suspended when it wasn't)
- Wrong product information (feature that doesn't exist, wrong policy, wrong timeframe)
- Closed a ticket that was still unresolved or pending
- Response addressed the wrong issue entirely
- Repeated a verification request after the player was already verified

ENHANCEMENT — the edit added genuine value but gameLM's original was not wrong:
- Added escalation status the agent had taken ("raised to trading team")
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

IMPORTANT RULES:
1. Weight the agent's stated reason heavily — it is more reliable than the edit diff.
2. "Confirm your email" or "unable to verify your account" responses have a known high error rate. When agents replace these, default to CORRECTION unless the edit is clearly stylistic.
3. Closing edits are NOT automatically PREFERENCE — if the conversation was unresolved or pending, a changed closing is CORRECTION.
4. When ambiguous between CORRECTION and ENHANCEMENT, choose ENHANCEMENT.
5. When ambiguous between ENHANCEMENT and PREFERENCE, choose ENHANCEMENT.
6. Only score PREFERENCE when you are confident the original was fully send-worthy.

Return ONLY valid JSON — no other text, no markdown, no explanation outside the JSON:
{"verdict":"CORRECTION","confidence":85,"reasoning":"Brief explanation."}`

export interface FewShotExample {
  user: string
  assistant: string
}

export const FEW_SHOT: FewShotExample[] = [
  // ── CORRECTION ──────────────────────────────────────────────────────────────
  {
    user: `Player message: I need to verify my account

gameLM suggested response: I checked your account, Shanice, and it looks like it's currently suspended due to too many sign-in attempts. I've gone ahead and unlocked it for you. You can reset your password by clicking the "Forgot your Password?" link on the login screen. Once that's done, you should be able to log in again without any issues.

Agent's final response: Nothing to worry about, I will be more than happy to help you. I see that your account is in unverified status, I will send an email regarding your account concern please expect it at sbledsoe328@gmail.com

Agent's stated reason: The information provided by GameLM appears to be inaccurate and does not align with the user's actual account status. The user is unverified, and the account is not suspended. Therefore, I adjusted my response to ensure it accurately reflects the user's situation.`,
    assistant: `{"verdict":"CORRECTION","confidence":95,"reasoning":"gameLM stated the account was suspended due to failed sign-ins and claimed to have unlocked it; the account was actually in unverified status with no suspension. Agent corrected the wrong account detail and appropriate next step."}`,
  },
  {
    user: `Player message: Ok we won't be in Arkansas that long. Leaving tomorrow

gameLM suggested response: Hi Karissa, I checked your account and it looks like the suspension came from our management team after your ID review. They're requesting a few additional documents for verification, including your ID or state card, your Social Security card, and a proof of address. Once those are received, they'll be able to complete the review and lift the suspension. You should get an email from them soon with the next steps.

Agent's final response: I do apologize for the inconvenience. Our team will look to complete the verification as soon as possible.

Agent's stated reason: Game Lm was saying the user would receive an email soon which was not true. They also stated that the management team suspended the account which was not true. The user was also never asked to provide their SSN card. The user has submitted documents and is awaiting response from operations.`,
    assistant: `{"verdict":"CORRECTION","confidence":95,"reasoning":"gameLM fabricated a management-team suspension, requested documents the player was never asked for, and promised an email that was not coming. The player had already submitted documents pending internal review. Multiple factual errors corrected."}`,
  },
  {
    user: `Player message: so no mention in green like a regular bonus. correct?

gameLM suggested response: Not exactly. It isn't a standard green bonus balance, but you do need to attach it on the betslip using the green Add Bonus button to tag it as the No Sweat Bet. If you didn't tap Add Bonus before placing the wager, it would have gone through as a regular cash bet with no protection. You can confirm by opening the bet details, it should show a No Sweat Bet tag if it was applied. If the protection was applied and the bet loses, the return comes back as a Free Bet, which you can use on odds -200 or longer within 7 days.

Agent's final response: In this instance there would not be, only a required opt in before placing the wager. Thank you, Donald.

Agent's stated reason: Game Lm was incorrectly telling the user that they had to add the promotion to their bet slip.`,
    assistant: `{"verdict":"CORRECTION","confidence":90,"reasoning":"gameLM incorrectly described a bet-slip tagging mechanic for a promotion that requires only an opt-in before placing the wager, not an explicit Add Bonus step. Agent corrected the wrong product information."}`,
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
    user: `Player message: How do I withdraw my money? I used Apple Pay to deposit my money

gameLM suggested response: Thank you for contacting BetSaracen. My name is Riley. I see you're looking to withdraw your funds after depositing with Apple Pay — I can definitely help you with that! Can you tell me if you've already verified your payment method on your account?

Agent's final response: It appears that you've utilized deposit-only methods such as Apple Pay, Credit, or Cash at Store, which unfortunately cannot be used for withdrawals as these methods require a secure connection between deposit and withdrawal methods for processing. To resolve this, we kindly suggest depositing at least $5 with Venmo, Paypal, or Debit, or $10 with VIP Preferred or Skrill. Once you've completed the deposit, the chosen method will become available for withdrawals.

Agent's stated reason: This is our successful deposit macro, usually a very easy contact and prefer to use macro to end chat quickly rather than going back and forth and asking questions I can find out by looking at the account.`,
    assistant: `{"verdict":"PREFERENCE","confidence":82,"reasoning":"gameLM's clarifying question was reasonable; the agent's use of the macro resolved it in one step. Both approaches lead to a correct outcome — the difference is communication style, not accuracy or added value."}`,
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
    user: `Player message: Where's a referral code for my friend

gameLM suggested response: Hey Nicholas, thanks for waiting! My name's Michael R. with BetSaracen. I see you're asking about a referral code for your friend — I can definitely help with that. Could you tell me a bit more about what you're trying to do?

Agent's final response: Hey Nicholas, thanks for waiting! My name's Michael R. with BetSaracen. I see you're asking about a referral code for your friend. Unfortunately at this time, we do not have a "refer a friend" offer. However, I think it's a great suggestion and will pass this along to our promotions team.

Agent's stated reason: Trimmed down the back and forth to address the issue directly.`,
    assistant: `{"verdict":"PREFERENCE","confidence":78,"reasoning":"gameLM's clarifying question was reasonable for an ambiguous referral request. Agent's direct answer also worked. Both are send-worthy — the choice reflects a preference for directness rather than a clear factual error or meaningfully added value."}`,
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
