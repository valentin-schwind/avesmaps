# Territory lists — verified divergence analysis + unification plan

**Owner ask (2026-07-06):** the several places that list *Herrschaftsgebiete*
should share ONE data grounding, with the central editor as the truth. This note
is the verified analysis (no more "handled as a side-effect") plus the plan.

## The surfaces

All of them already hit the **same backend**:
`GET /api/edit/wiki/sync-monitor.php?action=model_tree`
→ `avesmapsWikiSyncMonitorModelTree()` (`api/_internal/wiki/sync-monitor-tree.php`)
reading `wiki_territory_model` + `political_territory_wiki_test` (staging) + a
geometry-count subquery over live `political_territory(_geometry)`.

So the **data source is already common**. The divergence is entirely in the
**client renderers**, of which there are effectively two implementations plus
callers:

| # | Surface | Renderer | Status |
|---|---------|----------|--------|
| 1 | Editor „Herrschaftsgebiete synchronisieren und editieren" | iframe page `html/wiki-sync-monitor.html`, **own** tree logic (`buildTreeNode`, `coverage()`) | **truth** (editable) |
| 2 | Meldungen-Tab → „Territorien" | `js/review/review-wiki-sync.js` `renderWikiSyncTerritoryTree()` via shared module | **was wrong** |
| 3 | Right-click geometry → Territoriumseditor | `js/territory/territory-editor-embedded.js` via shared module | works |
| 4 | (parent-picker etc. — commit `bdb6cf77` speaks of "four territory lists") | shared module | — |

Shared module = `js/territory/territory-wiki-tree.js` (used by #2, #3, #4).
#1 does **not** use it — it reimplements the tree independently.

## Verified divergences (evidence)

1. **Placed/Missing tabs (the owner's concrete symptom) — FIXED 2026-07-06.**
   #2's Alle/Platziert/Fehlt tabs classified by a territory's **own** geometry
   (`isRowAssignedToMap`, `territory-wiki-tree.js`), while the coverage **dot**
   and the truth (#1 `coverage()` in `wiki-sync-monitor.html`) classify by
   **aggregated** coverage (own OR children on the map). A container whose
   children are placed showed a covered dot but sat under „Fehlt".
   **Fix A (00e2872f):** `filterRows()` mapStatus now honors an optional
   `coverageByKey` and classifies by aggregated `hasAnyCoverage`;
   `renderWikiSyncTerritoryTree()` computes coverage once and feeds the **same**
   map to dot + counts + filter.
   **Fix B (this commit) — cross-continent ancestor drag.** A *fully covered*
   Aventurien territory could still appear in „Fehlt": e.g. Alanfanisches Imperium
   (own geometry + placed children, coverage `all`, full dot) was dragged in by its
   child „Vizekönigreich Uthuria" (continent `Uthuria`, not on the map). Cause: the
   `continent === "Aventurien"` filter ran **outside** `filterRows`, so the
   non-Aventurien child stayed in the set through `expandRowsWithAncestors`, which
   re-added its Aventurien parent as a path ancestor via `affiliation_path`; the
   outer filter then removed only the child, not the re-added parent. Fix: pass
   `continent: "Aventurien"` **into** `filterRows`, so non-Aventurien rows drop as a
   structural filter *before* ancestor expansion. Verified live on the deployed
   module (Alanfanisches Imperium leaves „Fehlt"; missing count 209 → 208, nothing
   else changes).
   **Fix C (9493ce72) — broken branch to the missing leaf.** In „Fehlt" a still-missing
   leaf (e.g. Rittergut Altprein) sits under a PLACED intermediate (a placed Baronie)
   that is filtered out of the missing set. `expandRowsWithAncestors` rebuilt ancestors
   via `affiliation_path` (wiki-based, partial) while the tree is built from
   `parent_wiki_key`, so the chain broke: the leaf orphaned to the top level and its
   covered ancestors (Herzogtum, Kaiserreich) showed as childless dead-ends — the path
   down to the actual missing leaf was not navigable. Fix: walk the real `parent_wiki_key`
   chain over the complete row cache, pulling every ancestor of a kept row into the set
   so `buildTree` reconstructs the full, expandable branch. Only affects the WikiSync tab
   (full row cache present); other callers hit the existing early-return. Verified live:
   Herzogtum Nordmarken 0 → 3 children, full path Kaiserreich → Nordmarken → … → Rittergut
   Altprein reachable; orphan roots 148 → 115.

2. **Continent filter — still divergent (NOT yet changed).**
   #1 uses `contSel.has(effVal(n,'continent') || 'Aventurien')` — empty continent
   counts as Aventurien and **overrides are respected** (fixed in #1 by commit
   `e57b6e7e`). #2 hard-codes `row.continent === "Aventurien"` (raw staging value,
   no empty-default, no overrides) in `review-wiki-sync.js`. The shared module's
   own continent check (`doesRowMatchStructuralFilters`) is also raw-value. This
   can drop empty-/override-continent territories in #2 vs the truth. Left as the
   next unification step — needs an owner symptom confirmation before changing.

## Remaining unification plan

Goal: **one shared client grounding** for "which territories, in what hierarchy,
with what visibility", used by ALL surfaces, with #1's semantics as the
reference.

- **Step A (done):** placed/missing → aggregated coverage in the shared module.
- **Step B:** move #1's continent semantics (`effVal || 'Aventurien'`, override-
  aware) into the shared module's continent filter; drop #2's redundant hard
  `=== "Aventurien"`. Then #2/#3/#4 inherit the truth's continent behavior.
- **Step C (larger):** migrate the standalone `wiki-sync-monitor.html` (#1) onto
  the shared module too, so the truth and the derived views literally share one
  filter/tree-build/hidden-node implementation. Removes the last duplicate.

## Coordination

These files are the **WikiDump-migration session's** territory (all recent
commits on them are `wikidump`/`territory`; newest 2026-07-04). Changes here must
stay surgical + rebase-safe. Step C especially should be coordinated with / owned
by that session. Step A (this commit) is a contained, backward-compatible change
to the shared filter + the #2 caller only (#3/#4 pass no `mapStatus`, so they are
unaffected).
