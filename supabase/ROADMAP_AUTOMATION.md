# Product Roadmap: how it stays up to date

The Roadmap page (`src/pages/Roadmap.tsx`) reads `public.roadmap_docs`. Everything that fills that table runs
inside Supabase on a schedule. There are no Claude routines and nothing to paste.

| What the page shows | Job (cron, UTC) | Function | Source |
|---|---|---|---|
| Roadmap + Board tabs, effort split, sprint cycle, bug / tech-debt counts | `roadmap-linear-sync-daily`, 10:41 daily (about 5:41am ET) | `roadmap-linear-sync` | Linear GraphQL, team RAPH (`LINEAR_API_KEY`) |
| Industry news | `roadmap-news-sync-daily`, 17:37 daily (about 12:37pm ET) | `roadmap-news-sync` | Slack #ai-newsletter (`SLACK_BOT_TOKEN`) + Claude to extract stories (`ANTHROPIC_API_KEY`) |
| Past quarters ("Where we landed") | `roadmap-quarter-close`, 06:30 on the 1st of Jan/Apr/Jul/Oct | SQL `roadmap_quarter_close()` | The live roadmap data; also clears the sprint status for the new quarter |
| Status this sprint | On demand: "Draft with Claude" in Edit sprint status | `roadmap-sprint-draft` | Live Linear-derived data; an editor reviews and saves |

Hand-edited layers (pieces of work, project team overrides, RICE scores and ideas, cutline, OKRs, sprint status) live in the
same table and are edited in the app. The jobs never write them, except the quarter close clearing the sprint status.

## Secrets and auth

* `ROADMAP_INGEST_SECRET` (function secret) and the Vault entry `roadmap_ingest_secret` hold the same value. The cron jobs read the
  Vault entry at run time through `public.roadmap_call()`; the secret is not in this repo or in `cron.job`.
  To rotate: set the function secret, then update the Vault entry, both to the same new value.
* `roadmap-linear-sync` and `roadmap-news-sync` require the `x-roadmap-secret` header on every call. `roadmap-sprint-draft` requires
  a signed-in user with edit access to the Roadmap. The SQL helpers are not executable by `anon` or `authenticated`.
* `SLACK_BOT_TOKEN`: bot token with `channels:history` and `channels:read` (add `groups:history`/`groups:read` if the channel is
  private), with the bot invited to the channel. Without it `roadmap-news-sync` reports that and does nothing.

## Running things by hand

Dry run of the Linear sync (writes nothing; shows exactly what would change):

```
curl -s -X POST https://uepigbagbaskbslpjeqq.supabase.co/functions/v1/roadmap-linear-sync \
  -H "Content-Type: application/json" -H "x-roadmap-secret: $ROADMAP_INGEST_SECRET" -d '{"dryRun": true}'
```

Use `{"force": true}` to sync now, `{"introspect": "Project"}` to list a Linear type's fields. `roadmap-news-sync` takes
`{"dryRun": true}` and `{"days": 7}`. Quarter close can be tested with `select public.roadmap_quarter_close('2027-01-01 06:30+00', true);`
(the second argument is dry-run: it reports and writes nothing).

## Safety rules built in

* Linear sync: never deletes more than 10 docs in a run (it skips deleting and says so); if Linear can't be read it leaves the data alone
  and records the failure so the page shows its "sync failed" banner; project ids are Linear's own identifiers (`P-RAPH-210`).
* News: only ever adds new docs; skips anything whose link, title or id is already there.
* Quarter close: acts only when yesterday (New York time) was the last day of a quarter, never overwrites an existing final snapshot,
  and clears the sprint status only after reading the snapshot back and matching the project count.

## Turning it off

```sql
select cron.unschedule('roadmap-linear-sync-daily');
select cron.unschedule('roadmap-news-sync-daily');
select cron.unschedule('roadmap-quarter-close');
```

`roadmap-ingest` is an older, narrower write API that the retired Claude routines used. It is no longer needed; it is kept only as a
manual escape hatch and can be deleted.
