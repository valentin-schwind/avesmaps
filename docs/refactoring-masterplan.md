# Refactoring Masterplan

Status date: 2026-06-13 · Baseline analyzed at HEAD `8a1f778b`.

A structural ("how would we build it today") refactoring of Avesmaps that
**preserves all end-user/editor behaviour**. Workflow-affecting changes are
listed in §"Owner decisions" and require sign-off before the relevant milestone.

This document is the living tracker. See `AGENTS.md` for the project brief.

## Goals

1. **Architecture & structure** — split monolithic files, finish the existing
   modular decomposition, tidy stray files & folders.
2. **Code quality** — real dead-code elimination (delete, don't archive), DRY,
   readability for humans *and* AI agents.
3. **API unification** — converge every endpoint on the `route`/`locations`
   contract; **remove all shims/wrappers** (breaking changes allowed; the API is
   internal-only).
4. **Documentation** — translate docs/comments to English; ship a living AI-agent
   memory file (`AGENTS.md`).
5. **Stability/performance/security** — fix discovered bugs, leaks and hotspots
   without changing behaviour.

## Current state (IST) → target (SOLL), in brief

- **Structure:** the `api/{route,locations,app,edit,import,diagnostics,_internal}`
  reorg (from `api-restructure-plan.md`) is **done**; what remains is contract
  unification + shim removal + dissolving 8 JS and 13 PHP God-files and a
  generated CSS artifact committed as source. → cohesive small modules, generated
  artifacts out of source, consolidated tooling.
- **Code quality:** ~1000-line duplicate tree engine in
  `territory-editor-embedded.js`, dead `route-graph-routing` shadow, `valid_to_bf`
  in 4 divergent variants, endpoint preamble duplicated ~26×. → shared
  `territory-utils.js` (JS), request runner + single validity source (PHP).
- **API:** only `route`/`locations` use `{error:{code,message}}` + a dedicated
  helper; everything else returns flat `error:"string"`, with 3 different CORS
  implementations and pervasive `getMessage()` leaks. → one envelope, one CORS
  path, one auth helper, no shims.
- **Docs:** 143 → 25 md files after deleting spent process logs; README/llms.txt/
  site-summary falsely claim "no backend". → ~20 authoritative docs in English +
  `AGENTS.md`.
- **Stability:** 3 unauthenticated destructive wiki-dom endpoints, getMessage
  leaks (incl. public `territory-detail.php`), derived-layer N+1, DDL-before-cache.
  → closed/hardened; ~12 verified bugs fixed.

## Milestones

| M | Title | Status | Notes |
|---|-------|--------|-------|
| **M0** | Cleanup & DCE | ✅ done (`4600cb17`) | −23.5k lines: dropped `.refactor-backup/`, 118 process-log docs, og-image deploy fix, `.gitattributes`, moved `prototype/`→`docs/spikes/` |
| **M0.5** | `AGENTS.md` + `CLAUDE.md` + this doc | ✅ done | living AI brief + English masterplan |
| **M1** | Security | ✅ done (`7432f1e1`→`09ee68ad`) | neutralized 3 unauth wiki-dom crawler endpoints with 410 stubs + removed dead playground UI (verified `/edit → WikiSync` uses sync-monitor.php, not these); stopped 9 bare-Throwable `getMessage()` leaks; atomic `coat.php` cache write; `add_claim` transaction + `FOR UPDATE`. CORS: 2 of 3 divergent impls gone via stubbing; the wiki-browser `applyCors` (non-exploitable) is deferred to M3 with the parallel-stack migration. Live-verified: `dom-sync.php`→410, `/api/locations/`→200. |
| **M2** | Correctness bugs | ✅ done | IZ/`bis` word-boundary parsers (`9d4a801b`), spotlight poll cancel (`70a8c1e9`), zoom-band unified to 0-1/2-6 (`8fa18991`), route-graph `calculateRouteServer` shadow removed (`11037917`, live-verified), political loader trio — TOCTOU zoom + edit-time fan-out cache invalidation + pending-rerun + cache eviction (`cacff63b`, deploy-verified; `apiUnavailable` intentionally left self-healing — see commit), `askRegionTabCloseChoice` 3-way dialog (`a78b82d1`). ↪ moved to M5: `refreshPlannerAfterFeatureChange` dedup (harmless dead code in a CRLF file). NB: loader + dialog are client-side; behavioural smoke (open editor, pan/zoom political layer, edit+save a region, close a dirty tab) is the meaningful live test. |
| **M3** | API contract + remove shims (breaking) | in progress | ✅ foundation: `avesmapsErrorResponse` + `avesmapsServerErrorResponse` in bootstrap (`5df56d2a`). ⏳ the breaking migration (own focused session — see plan below). |
| **M4** | DRY | planned | PHP request runner, single `valid_to_bf`, BF parser, `wiki-crawler-base.php`; JS `territory-utils.js`, infobox-row, `debounce` |
| **M5** | God-file splits | planned | per split tables, one file at a time, deploy+test between; CSS source split, rename duplicate filename, treat `*-inline.css` as generated |
| **M6** | Performance | planned | derived-layer N+1 memo, DDL out of cache-hit path, political teardown → signature-skip, polylabel memo, fetch-interceptor, bound+invalidate fan-out cache |
| **M7** | Schema / SQL | planned | `sql/schema.sql` baseline, document inline-DDL tables, `sql/migrations/`, drop dead schema (`map_feature_relations`, `map_proposals`), reconcile `map_reports` divergence; **keep self-healing inline ensure-tables** |
| **M8** | Docs & i18n | planned | translate ~20 docs + internal error messages to English; fix the "no backend" claims; rewrite `api/README.md`; **build `?lang=en` i18n overlay (German stays default)** |

Each milestone = small verified commits to `master`, deploy + smoke between
steps, STRATO caution (no looping heavy endpoints).

## Owner decisions (locked in 2026-06-13)

1. **User-facing UI language:** German stays the default. Add a translation
   JSON/XML + `?lang=en` overlay (M8). No inline German→English replacement of UI.
2. **WikiSync DOM playground:** remove it — but only after confirming
   `avesmaps.de/edit → WikiSync` (which runs via `api/edit/wiki/sync.php` +
   `territories-dom.php`, both kept) uses none of it.
3. **API breaking changes:** approved.
4. **Diagnostics endpoints:** stay public. A full inventory is maintained (see
   below). M1 still closes the exception-payload *leaks* (content, not access).
5. **Terrain/type labels:** handled via the i18n overlay (same as decision 1).
6. **Schema strategy:** keep self-healing inline ensure-tables; drop dead
   schemas; in M7 inspect the live DB (read-only) for unused tables.

## Diagnostics endpoint inventory (kept public per decision 4)

- `GET /api/route/?diagnostic=` → `map-data`, `network-data`,
  `location-node-data`, `route-name-data`, `dijkstra-data`, `graph-data`.
- `GET /api/app/political-derived-geometry-debug.php` (leaks exception payload — fix in M1).
- `GET /api/diagnostics/political-schema.php` (admin-gated; no JS caller).
- `api/app/political-territories.php?action=` → `debug`, `audit`,
  `geometry_assignment`, `debug_boundary_contract`/`boundary_contract_debug`,
  `change_log`, `geometry_inventory`, `geometry_collision`.
- `?debug_errors=1` flag on `territories-endpoint.php` and
  `political-territory-display-sync.php` (leaks exception class+message — fix in M1).
- `api/_internal/political/{territories-boundary-debug,territories-debug}.php`
  (internal libs, reached via the above).
- `html/political-boundary-diagnostics.html` (dev page).

## M3 execution plan (the breaking migration — run as a focused session)

Goal: every endpoint converges on the gold-standard envelope
`{ok:true,…}` / `{ok:false,error:{code,message}}` via the shared
`avesmapsErrorResponse` / `avesmapsServerErrorResponse` (already in bootstrap).
The error shape changes from a flat `error:"string"` to `error:{code,message}`,
which the frontend currently reads as a string — so order matters. Do each step
as a small commit + deploy + curl/UI smoke.

**Step 1 — make the frontend tolerant FIRST (backward-compatible, no endpoint change yet).**
Add a helper (in `js/app/api-client.js`) `apiErrorMessage(data, fallback)` →
`data?.error?.message || (typeof data?.error === "string" ? data.error : "") || fallback`.
Route the central throws through it. Sites reading `data.error` as a string:
- `js/app/api-client.js`: `:53,:60,:103,:171,:221,:299,:323,:350,:372,:399` (+ the central wrappers — fixing these covers most consumers).
- Direct `data.error` reads in `js/review/*`: `review-settlement-wiki.js`, `review-settlement-list.js` (×6), `review-region-sync.js` (×2), `review-path-wiki.js`, `review-path-sync.js`, `review-locations.js` (×3), `review-label-wiki.js`; `js/territory/`: `territory-wiki-tree.js:903`, `territory-subtree-display-tools.js:54`, `territory-override-footer.js:175`, `territory-editor-link.js:604/610`.
Once tolerant, the shape flip is safe.

**Step 2 — auth gate.** Change `avesmapsRequireUserWithCapability` (auth.php:87) to use
`avesmapsErrorResponse` and split 401 `unauthenticated` (no user) vs 403 `forbidden`
(user lacks capability). Today it returns flat string + always 401.

**Step 3 — migrate endpoints cluster by cluster** (each: replace inline
`{ok:false,error:STRING}` ladders with `avesmapsErrorResponse`/`avesmapsServerErrorResponse`,
unify the catch ladder, drop `getMessage()`/`exception` leaks incl. the `?debug_errors=1`
ones, replace per-endpoint CORS strings with `avesmapsErrorResponse(403,'forbidden_origin',…)`):
app/ (map-features, map-search, coat, territory-detail, location-reviews, share-link,
political-territories, political-territory-display-sync) → edit/map → edit/political →
edit/reports → edit/wiki (sync-monitor/paths/regions/settlements/…) → import →
diagnostics. Migrate `wiki-browser-endpoint.php` off its parallel stack (own
`applyCors`/`respondJson`/PDO/config) onto bootstrap — this also closes the last CORS divergence (decision: drop `Allow-Credentials`).

**Step 4 — remove shims/wrappers/alias actions.** Root shims
`api/{political-territory-lib,wiki-sync-lib}.php` (update 9 + 1 callers to require the
`_internal/` target directly), then delete. Drop `get_`/non-`get_` alias action pairs in
`territories-endpoint.php`. ⚠️ STRATO: deploy never deletes — replace removed web-reachable
files with stubs (or accept server-only leftovers); for the lib shims (not web entry points)
deletion is fine once no repo code requires them.

**Step 5 — split the `territories-endpoint.php` multiplexer** into read vs write
files with uniform per-file auth (move `debug`/`audit`/`geometry_assignment` behind `review`).

**Step 6 — move root `api/{auth,bootstrap}.php`** → `api/_internal/core/` with thin
root stubs (STRATO clean-deploy safety), per `server-repo-drift` lessons.

Verify each step: `php -l` changed files, `node --check` changed JS, deploy, then curl the
migrated endpoint (success + an error path) and confirm the frontend still renders errors.

## Open behavioural verification checks (M2 — deployed, not yet UI-smoke-tested)

These two M2 fixes are client-side; they passed `node --check` and are deployed, but their
runtime behaviour was not exercised in a browser. Worth a quick manual pass in the editor:

1. **Political-layer edit freshness** (loader trio, `cacff63b`). In a political/region map mode,
   edit + save a region (colour/zoom/geometry) → the change must appear **immediately**, not after
   up to 60s (the multi-zoom fan-out cache is now cleared on edit-triggered `immediate:true` reloads).
   Also pan/zoom rapidly during a layer load → no stale pan-skip (TOCTOU fix) and no reload storm
   (pending-rerun coalesces). Watch the network tab: no runaway `political-territories` requests.
2. **Dirty region-tab close dialog** (`a78b82d1`). Open a region-edit tab, make an unsaved change,
   click the tab's close (×) → the 3-way dialog **Speichern / Verwerfen / Abbrechen** must appear
   (previously: `ReferenceError`, tab wouldn't close). Check: Speichern saves+closes, Verwerfen
   closes without saving, Abbrechen / Escape / backdrop-click keep the tab open.

## Diagnosed issue — coat-of-arms (Wappen) blink in the Politik view (fix belongs to M6)

Reported 2026-06-13; diagnosed read-only (NOT caused by M1/M2 — verified).
**Root cause:** in the `political` map mode the whole layer is torn down and rebuilt on every
`moveend`/`zoomend` (`bootstrap.js:55/61`), because the "skip reload on same-zoom pan" guard is
deliberately disabled for political mode (`map-features-political-territory-loader.js:538-542`).
Each rebuild does `clearRenderedRegionLayers()` (`map-features-region-rendering.js:65-77`) then
re-creates every region label tooltip with a **fresh** `<img src="/api/app/coat.php?u=…">`
(`map-features.js:678-679`) → the recreated element re-displays → visible blink. Confined to the
Politik view (boundary-only modes skip same-zoom pan and draw no labels).
Ruled out: `coat.php` atomic-write change `09ee68ad` (serving-safe, always emits bytes, immutable
Cache-Control) and loader-trio `cacff63b` (did not change reload frequency).
**Fix (M6, shared root with perf lever #1 "political full teardown+rebuild per moveend"):** reuse
label layers instead of destroying them — keep tooltips keyed by territory and only `setContent`/
reposition when the coat URL or name actually changed, so the already-loaded `<img>` survives the
reload. Doubles as a pan/zoom perf win. Key files: `map-features-region-rendering.js`,
`map-features-political-territory-loader.js`, `map-features.js`.
