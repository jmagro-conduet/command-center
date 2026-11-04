# Styles

`raphie-tokens.css` is copied from the official **Raphie Design System**
(https://claude.ai/artifact/HvFS2DzBGBTC9S37Dd3kgH, `project/tokens.css`). Do not edit values there:
change them in the design system and re-copy. The only local addition is the "Command Center
additions" block at the bottom (`--success-text`, a darker green for small success text, and the
global focus ring).

Role of colour (full rules in the design system README and the project `CLAUDE.md`):

- **Green (`--primary`)** is the operator: active nav, focus, links, success, selection.
- **Purple (`--ai`, text `--ai-text`)** is anything the AI authored: drafts, triage suggestions,
  Autopilot / Full Auto, confidence. Never for nav, focus or selection.
- Primary buttons are black. Page background `--page-bg`. Fonts `--font-body` / `--font-display`
  (Maax, Outfit fallback). The logo is an image in `public/brand/`, never typeset.

The Roadmap page (`pages/roadmap/roadmap.css`) uses its own scoped variables built from the same values.
