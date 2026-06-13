# CLAUDE.md

See **@AGENTS.md** for the full project brief (purpose, domain glossary,
architecture, API contract, data model, deploy flow, conventions, fragilities).
It is the single source of truth; this file only adds Claude-Code-specific notes.

## Claude Code notes

- **Environment:** Windows + PowerShell. Use PowerShell syntax (`$env:VAR`,
  `$null`); a Bash tool is also available for POSIX/git work.
- **STRATO shared hosting:** never run heavy API endpoints (especially the
  political layer) in a loop — it saturates PHP workers and mimics a DB outage.
  Probe with a single request.
- **Deploy:** push to `master` → ~1–2 min auto-deploy. Verify the remote SHA
  after pushing; check the live site only after the deploy delay.
- **Editor assets:** bump `ASSET_VERSION` in
  `js/territory/territory-editor-inline-host.js` when changing dynamically loaded
  editor HTML/CSS/JS (see AGENTS.md §7).
- **Refactoring program:** `docs/refactoring-masterplan.md` tracks milestones
  M0–M8 and which changes need owner sign-off.
