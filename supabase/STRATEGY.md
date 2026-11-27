# Strategy (OKR tracker) in Raphie Hub

An ELT-only page, next to the Roadmap, that replaces the standalone "Raphie OKR Tracker" artifact.

| Tab | What it does |
| --- | --- |
| Strategy on a Page | North Star, six pillars, every key result (KR) with its latest status, "as of" any past ELT, business priorities |
| ELT | Agenda (built from each KR's latest status), pasted meeting notes -> Claude drafts a review -> admin approves -> saved |
| Actions | Numbered actions (ACT-001...), owners, due dates, comments, carried-over flags |
| Admin | OKR periods (set up the next half-year as a draft, make it current), "view as viewer" preview |
| Guide | How the framework and the monthly loop work |

## Who can see it

Page key `strategy`, managed in **Admin settings, Users, Pages** exactly like the Roadmap. SuperAdmins always have it;
anyone else needs a grant (view or edit). Operators (customer logins) never can. Viewers see everything and change nothing;
the data is protected by row-level security on `strategy_docs`, not just by hiding buttons.

## Pieces

| Piece | File |
| --- | --- |
| Table + RLS | `supabase/migrations/20261124_strategy.sql` (needs `20261104_roadmap.sql` first for `page_access` / `has_page_access`) |
| Drafting function | `supabase/functions/strategy-draft-review` (uses `ANTHROPIC_API_KEY`; caller must have edit access) |
| Logic (pure, tested) | `src/lib/strategy/logic.ts`, `src/lib/strategy/logic.test.mjs` |
| Data hook | `src/lib/strategy/useStrategy.ts` (signed-in user's JWT; never the service-role client) |
| Page | `src/pages/Strategy.tsx`, `src/pages/strategy/*` |
| Import from the artifact | `scripts/strategy-import.mjs` |

## Data model (`strategy_docs`: collection, doc_id, data)

`plans` (one per OKR period) · `config/current` (which period is current) · `sessions` (one per ELT: open, review, saved) ·
`checkins` (`<session>__<kr>` per ELT, plus `adhoc-*` between ELTs and `live-*` set during a meeting) ·
`actions` · `proposals` (an unsaved, drafted review; one per ELT) · `dods` (definition-of-done checklists per KR).

A KR's status "as of" a date is the latest check-in on or before it. Nothing is overwritten; every saved ELT is a snapshot.

## Set up (once)

1. Run `supabase/migrations/20261124_strategy.sql`.
2. Deploy the function: `npx supabase functions deploy strategy-draft-review --no-verify-jwt --project-ref <ref> --yes`
   (it checks the caller's JWT and edit access itself, like `roadmap-sprint-draft`).
3. Grant people the page in Admin settings, Users.
4. Bring the live data across from the artifact (below), then retire the artifact.

## Import from the artifact

Export the artifact's collections to a folder (`plans/`, `sessions/`, `checkins/`, `actions/`, `dods/`, `config/`), then:

```powershell
node scripts/strategy-import.mjs "<export folder>" --out strategy-import.sql --user u_<artifactUserId>=name@raphie.com
npx supabase db query --remote --file strategy-import.sql --project-ref <ref>
```

The script only writes a SQL file for you to review. By default existing documents are left alone, so re-running never
overwrites edits made in Raphie Hub (`--overwrite` changes that). The export holds confidential business data:
keep it, and the generated SQL, out of git.

## Tests

```powershell
node --test src/lib/strategy/logic.test.mjs supabase/functions/strategy-draft-review/logic.test.mjs scripts/strategy-import.test.mjs
```
