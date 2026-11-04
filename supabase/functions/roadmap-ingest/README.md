# roadmap-ingest (superseded)

A narrow, secret-protected API for reading and writing `public.roadmap_docs`. It was built so Claude scheduled routines could feed the
Roadmap. The Roadmap now updates itself inside Supabase (daily Linear sync, Slack news import, SQL quarter close, in-app sprint draft),
so this function is **not needed**. See [../../ROADMAP_AUTOMATION.md](../../ROADMAP_AUTOMATION.md).

It is kept only as a manual escape hatch (rules in [core.ts](core.ts): a few collections writable, hand-edited layers refused, batches
validated first, bulk Linear deletes need a flag). It shares `ROADMAP_INGEST_SECRET` with the other roadmap functions. Delete the
function and this folder when you no longer want it.
