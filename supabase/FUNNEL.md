# Sales Funnel: how it works and how it stays up to date

The Sales Funnel page (`src/pages/SalesFunnel.tsx`) shows Pipedrive deals by funnel step: reached, entered, in stage, onward
conversion, stage movements, a deals table, and standard CRM KPIs (open deals and value, added, moved, went Live, lost, win
rate, lost rate, average days to Pilot, to Paying and to Lost). It reads a copy of Pipedrive in `public.funnel_docs`; it never calls Pipedrive.

| Piece | Where |
|---|---|
| Page, period and pipeline switches, CSV export | `src/pages/SalesFunnel.tsx`, `src/pages/funnel.css` |
| All the maths (pure, tested) | `src/lib/funnel/logic.ts` (`logic.test.mjs`) |
| Reads (signed-in user's client, so RLS applies) | `src/lib/funnel/useFunnel.ts` |
| Home card | `funnel-glance` in `src/lib/home/layout.ts`, `FunnelCard` in `src/pages/Home.tsx` |
| Copy of Pipedrive, written server-side only | edge function `pipedrive-sync` (`supabase/functions/pipedrive-sync/`) |
| Table, access rule, seeded pipeline and stage mapping | `supabase/migrations/20261128_sales_funnel.sql` |

## Access

* Page key `sales-funnel` (renamed from the planned "Client Status"). **Off by default**: only SuperAdmin has it. Nothing is
  granted to the ELT profile; turn it on for a profile or a person in Users and access.
* Access to the page is access to the deal values. There is no separate value permission. Customer logins (operators) never
  get it.
* `funnel_docs` is readable only through `has_page_access('sales-funnel')` (row-level security). Nobody can write to it from the
  browser; only the sync function, with the service role.

## Pipedrive API key (read only)

1. In Pipedrive, create a dedicated user whose permission set is read only (view deals, activities, users; nothing that edits).
   Pipedrive API tokens carry the permissions of the user who owns them and are not read only by themselves.
2. That user copies their personal API token (Personal preferences, API).
3. Set it as a function secret, yourself (it is never put in chat or in this repo):

```powershell
supabase secrets set PIPEDRIVE_API_TOKEN=<token> --project-ref uepigbagbaskbslpjeqq
```

The sync only ever sends GET requests. The token never reaches the browser.

## Running it

The function needs the `x-roadmap-secret` header (the same `ROADMAP_INGEST_SECRET` as the Roadmap jobs).

| Body | Effect |
|---|---|
| `{"dryRun": true}` | Reads Pipedrive and reports counts and a masked sample. Writes nothing. **Run this first.** |
| `{}` | Runs and writes, unless a sync was attempted in the last 5 minutes. |
| `{"force": true}` | Runs and writes now. |
| `{"maxFlows": 20}` | Caps how many deals have their stage history read this run (default 60, max 200). |

**Stage history** is what makes "reached" and "went Live" exact. Pipedrive has no bulk history call, so it is read per deal
(`/v1/deals/{id}/flow`), only for deals that are new, moved or failed last time, newest first, at most 60 per run. The first
couple of runs therefore fill in history for every deal; until then the page shows a banner and estimates a deal's reach from its
current stage (the same approximation the prototype used).

**Schedule (after the token exists and a dry run looks right).** Same pattern as the Roadmap jobs, using `public.roadmap_call()`:

```sql
select cron.schedule('pipedrive-sync-daily', '17 11 * * *', $$select public.roadmap_call('pipedrive-sync', '{}'::jsonb)$$);
```

Deploy with `supabase functions deploy pipedrive-sync --no-verify-jwt` (it authenticates with the shared secret, like the
other sync functions).

## Safety rules built into the sync

* GET requests only. It cannot change anything in Pipedrive.
* Only the fields the page needs are copied (deal title, stage, owner id, value, dates, lost reason, next activity subject and
  due date, owner names). Notes, emails, contact details and activity notes are not copied.
* If Pipedrive cannot be read, rejects the token, or returns a list under half the size of what is stored, nothing is
  overwritten; the failure is recorded and the page shows a "last sync failed" banner with the age of the data.
* A deal that disappears from Pipedrive is marked `deleted`, never removed, and no more than 10 per run (more than that and none
  are marked, with a warning).
* The page warns when the last good sync is over 30 hours old.

## Definitions (also shown on the page)

* **Funnel step**: a named step made of one or more Pipedrive stages (for example Pilot is two stages). The mapping is the
  `config/funnel` document seeded by the migration; edit it with a plain `update` on `funnel_docs` (a re-run never overwrites
  it). It also holds `hiddenDeals`, a list of deal ids to leave out everywhere (for example Pipedrive clean-up records).
* **Reached**: ever sat in that step or a later one (all time). **Entered**: moved into the step during the period.
  **In stage**: open deals there now. **Onward**: of the deals that reached a step, the share that reached the next (always all time).
* **Went Live**: reached the pipeline's final step (Pipedrive keeps Live deals open), or Pipedrive marked it won. The Partnership
  pipeline has no Live step, so it shows no win rate.
* **Lost**: counts in a period only if the deal became lost in it (the day it entered the Lost stage, else its Pipedrive close
  date). A deal cancelled long ago drops out of the 30 day view and returns under All time.
* **Win rate** = went Live ÷ (went Live + lost) in the period, **lost rate** = lost ÷ the same total. Both show a dash until at
  least 5 deals have closed in the period, with the count underneath.
* **Avg days to Pilot / Paying / Lost**: average days from the deal being added to the day it reached the Pilot step (contract signed, the step
  before Live), went Live (treated as paid conversion; Pipedrive has no paid flag), or became lost, for deals that did so in the period.
  Read together they show whether deals that drag are more likely to be lost.
* **Period**: the last 30 or 90 calendar days including today, or all time.

## Checks

```powershell
node --test src/lib/funnel/logic.test.mjs supabase/functions/pipedrive-sync/logic.test.mjs src/lib/access/core.test.mjs src/lib/home/layout.test.mjs
```
