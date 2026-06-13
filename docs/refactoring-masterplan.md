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
| **M1** | Security | next | close 3 unauth destructive wiki-dom endpoints (verify `/edit → WikiSync` first), central error responder (kills getMessage leaks), consolidate CORS to one path, atomic `coat.php` write, `add_claim` transaction |
| **M2** | Correctness bugs | planned | route-graph shadow, loader trio (TOCTOU / cache invalidation / `apiUnavailable` logic), `askRegionTabCloseChoice`, `refreshPlannerAfterFeatureChange` dup, IZ/`bis` parsers, spotlight poll cancel, zoom-band table unification |
| **M3** | API contract + remove shims (breaking) | planned | implement unified envelope, migrate every endpoint + frontend `api-client` in lockstep, delete all shims/wrappers/`get_` alias actions, split the `territories-endpoint` multiplexer (read/write), move root `auth/bootstrap.php` → `_internal/core` |
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
