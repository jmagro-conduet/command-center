-- RSI ticket-category cleanup: collapses duplicate picklist entries
-- (Stuck game rounds / Withdrawal Timing / Withdrawal-Deposit Options each
-- existed both top-level and nested under a parent category) down to one
-- canonical row per core use case, then backfills historical tickets so
-- reporting isn't fragmented across the old duplicate strings.
--
-- Scoped entirely to RSI's operator_id — no other operator is affected.

do $$
declare
  v_op_id uuid := '3398cd8b-7d89-41d0-b16d-d5d1b6aeab64'; -- RSI
begin

  -- 1. Backfill historical tickets to the canonical category strings
  --    BEFORE renaming/deleting the picklist rows.
  update public.tickets
     set ticket_category = 'Stuck game rounds'
   where operator_id = v_op_id
     and ticket_category in ('Stuck Game Rounds', 'Casino Games › Stuck Game Round');

  update public.tickets
     set ticket_category = 'Withdrawal Timing'
   where operator_id = v_op_id
     and ticket_category in ('Withdrawal Status/Timing', 'Withdrawals › Withdrawal Status/Timing');

  update public.tickets
     set ticket_category = 'Withdrawal / Deposit Options'
   where operator_id = v_op_id
     and ticket_category in ('Withdrawal Options', 'Withdrawals › Withdrawal Options');

  -- 2. Rename the three surviving canonical picklist rows.
  update public.operator_issue_categories
     set main_category = 'Stuck game rounds'
   where operator_id = v_op_id and main_category = 'Stuck Game Rounds' and sub_category is null;

  update public.operator_issue_categories
     set main_category = 'Withdrawal Timing'
   where operator_id = v_op_id and main_category = 'Withdrawal Status/Timing' and sub_category is null;

  update public.operator_issue_categories
     set main_category = 'Withdrawal / Deposit Options'
   where operator_id = v_op_id and main_category = 'Withdrawal Options' and sub_category is null;

  -- 3. Delete the now-redundant duplicate/nested picklist rows.
  delete from public.operator_issue_categories
   where operator_id = v_op_id
     and (
       (main_category = 'Casino Games' and sub_category = 'Stuck Game Round')
       or (main_category = 'Withdrawals' and sub_category = 'Withdrawal Status/Timing')
       or (main_category = 'Withdrawals' and sub_category = 'Withdrawal Options')
     );

end $$;
