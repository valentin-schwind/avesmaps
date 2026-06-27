# Cleanup Audit — 2026-06-27 (read-only, no changes applied)

Decision basis for a future cleanup pass. Nothing here was modified; every item
lists a risk level and a recommended action so the owner can pick what to tackle.

## TL;DR — the systemic root

There is no build step: **144 JS files**, **122 static `<script>` tags** in
`index.html`, **plus** several files injected dynamically at runtime. **23 global
function names are defined in 2–3 different files each.** Which definition "wins"
is decided by a *mix* of static tag order **and** dynamic injection order — which
is invisible in `index.html` and very hard to reason about. That ambiguity is the
root cause of the boundary bug fixed today (`9322f9f4`): the live
`syncRegionVisibility` was a runtime-installed copy, not the one in the file we
were editing.

Most of the 23 duplicates turn out benign or intentional. A few are genuine
risks; exactly one file is fully dead.

---

## A. Duplicate global functions

### A1 — Dead orphan (clear win, low risk)

- **`js/territory/territory-override-footer.js`** — referenced **nowhere** (not in
  `index.html`, not injected, not in the editor HTML). It defines 5 override-footer
  functions and the module `window.AvesmapsPoliticalTerritoryOverrideFooter`. The
  live code (`territory-editor-link.js`, loaded statically) contains *facades* that
  delegate to that module — which is therefore never present, so the facades run
  their **fallback stubs**.
  → **Either** the override-footer feature is intentionally stubbed (then this file
  is dead code to delete) **or** it is a silently broken feature. **Owner call.**

### A2 — Diverged live shadows (review — behaviour depends on load order)

| Function | Definitions | Live winner | Note |
|---|---|---|---|
| `applyPoliticalTerritoryDerivedBoundaryVisibility` | 3: loader (static 1196), dispatcher (static 1200), **runtime-fix (dynamic, injected by `…-repository.js`)** | runtime-fix.js (injected last) | The two static versions are dead/shadowed; the "runtime-fix" patch is the real one. Bodies diverge. |
| `refreshPlannerAfterFeatureChange` | 2: waypoints (1159), route-render (1207) | route-render.js | Diverged: one updates/pans the map view, the other preserves it. Silent. |
| `setMapStyle` | 2: bootstrap (1212), route-planner-toggle (1213) | route-planner-toggle.js | Intentional monkeypatch wrapping the original; not documented at the original. |

### A3 — Identical live duplicates (safe, cosmetic dedupe)

- `escapeRegExp` — `app/utils.js` + `review/review-region-parent-tree.js`,
  byte-identical. The review file should reuse the utils one.
- `calculateClippingRingArea`, `calculateClippingPolygonArea` —
  `map-features-region-edit-ops.js` + `map-features-region-geometry-helpers.js`,
  byte-identical.

### A4 — Intentional override/facade patterns (document, do **not** "fix")

- `syncRegionVisibility` — base (`…-political-region-visibility.js`) + enriched copy
  the loader installs at runtime via `installPoliticalRegionVisibilityBehavior`.
  Now documented by today's fix.
- Drag-assignment trio (`readWikiSyncTerritoryDragPayload`,
  `initializeWikiSyncTerritoryDragAssignment`,
  `buildWikiSyncTerritoryAssignmentValueFromPayload`) — facade in
  `territory-editor-link.js` (1108) + full impl in `territory-drag-assignment.js`
  (1110, loads later → wins). Works.
- Region-edit handlers (7: `refreshRegionEditHandles`, `createRegionHandleIcon`,
  `handleRegionEdit{MouseOut,MouseMove,KeyUp,Click}`, `clearRegionGeometryEdit`) —
  base versions static + Ctrl+drag-detach versions **injected dynamically by
  `js/routing/route-priority-queue.js`** → the detach versions win. The feature IS
  active (it first *looked* dead because the file is not in `index.html`). Smell:
  a routing min-heap file injects a map-feature script — odd coupling.
- `apiErrorMessage` — `app/api-client.js` (main app) + `territory-editor-context.js`
  (editor-only context). Separate runtime contexts, not a real shadow.

---

## B. Dead schema (low risk, needs a migration note)

`map_feature_relations` and `map_proposals` each have **2 inline `CREATE TABLE`**
statements and **zero** real queries (no FROM/JOIN/INSERT/UPDATE/DELETE). Confirmed
dead (AGENTS.md §10 also flags them). Schema lives inline in PHP, so removing them
is a code edit, not a SQL migration.

## C. Already resolved (AGENTS.md is stale here)

The "no backend / no database" myth files are **already corrected**: `README.md`
and `site-summary.md` now describe the PHP 8 + MySQL backend accurately, and
`llms.txt` carries no false claim. AGENTS.md §1 still lists them as needing a fix —
that note is out of date.

## D. Server↔repo drift (known, AGENTS.md §10)

Deploy never deletes, so orphaned files accumulate on STRATO (e.g. the renamed
`map-features-region-visibility.js` from today). Not dangerous, but grows over time.

---

## Suggested priority (low → high risk)

1. **Delete the one dead orphan** (`territory-override-footer.js`) once you confirm
   the override-footer feature is meant to be stubbed. Clearest, smallest win.
2. **Dedupe the 4 identical functions** (A3). Trivial, no behaviour change.
3. **Add header comments** to the intentional overrides (A4) naming the runtime
   winner. Cheap insurance against the next "my fix didn't take" hunt.
4. **Review the 3 diverged shadows** (A2) together — decide the intended winner,
   fold the loser in, delete the shadow. Needs domain judgement.
5. **Drop the dead schema** (B) with a short note in the DDL.
6. Bigger structural items (the 122-tag load-order contract, the dynamic-injection
   pattern, server drift) → fold into `docs/refactoring-masterplan.md` with sign-off.

> Cross-cutting recommendation: the duplicate-definition footgun keeps biting
> because global ownership is implicit. A lightweight convention — "each global is
> defined in exactly one file; runtime overrides must be guarded and comment the
> file they shadow" — would prevent the whole class.
