-- Per-operator Zendesk scoping. zendesk-tickets previously had no brand filter
-- at all, so an agent's ZD adoption count summed their chat activity across
-- EVERY brand they touch, not just the operator currently being viewed —
-- meaningless (and actively misleading) for operators like RSI that don't use
-- Zendesk, and wrong for any operator whose agents also work other brands.
--
-- null zendesk_brand_id = "this operator doesn't track ZD adoption" — the
-- frontend skips the ZD fetch entirely rather than showing a bogus number.
alter table public.operators add column if not exists zendesk_brand_id text;

update public.operators set zendesk_brand_id = '8399147779099'  where name = 'BetSaracen';
update public.operators set zendesk_brand_id = '8399059191835'  where name = 'Soaring Eagle';
update public.operators set zendesk_brand_id = '39736242231323' where name = 'Conduet (Internal)';
-- RSI, 888 Africa, Entain AUS, Entain EU, MODO: no matching Zendesk brand exists
-- for them (confirmed via the ZD brands API) — left null intentionally.
