-- Full Auto bug reports have no "suggested response a human reviews" step --
-- gameLM acts directly, so the CoPilot-shaped form (player_input +
-- suggested_response) doesn't capture what actually matters for Full Auto:
-- how far gameLM's own pipeline got before/if a human had to step in. Reuses
-- the exact same four-value taxonomy already tracked from real Zendesk data
-- in zendesk-snapshot-metrics (RESOLUTION_TIER_VALUES) so a manually-logged
-- bug's outcome is directly comparable to the automated KPI numbers instead
-- of living in its own disconnected vocabulary. copilot-mode reports leave
-- this null; full_auto-mode reports can optionally set it.

alter table public.bug_reports
  add column if not exists resolution_outcome text
  check (resolution_outcome in ('non_automated', 'assisted_escalation', 'contained_resolution', 'core_resolution'));
