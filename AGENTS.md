# AGENTS.md — Avesmaps project brief for AI agents

> Authoritative, tool-agnostic onboarding for any AI coding agent (Claude Code,
> Cursor, Copilot, Codex, …). Keep this file current; it is the single source of
> truth for "how this project is built". `CLAUDE.md` is a thin stub that imports
> this file.

## 1. Project purpose & status

Avesmaps is a **non-commercial fan project** for *Aventurien*, the world of the
German pen-and-paper RPG *Das Schwarze Auge* (DSA / "The Dark Eye"). It is an
interactive tile map **and an in-browser route planner**.

- **Live:** https://avesmaps.de (full app, with PHP+MySQL backend).
- **Frontend:** vanilla JavaScript, **no build step**, no bundler. `index.html`
  hand-includes ~117 `<script>`/`<link>` tags. Leaflet **1.9.4** with
  `L.CRS.Simple`, image bounds `0..1024`, zoom `0..5` (a marker tier exists up to 6).
- **Backend:** PHP 8 (strict types) + MySQL via PDO, hosted on **STRATO shared
  hosting**. Optional in the sense that the static map renders without it, but
  the live site relies on it for features, search, territories, routing, reviews
  and the editor.
- **Routing:** Dijkstra over a weighted graph built from GeoJSON paths
  (min-heap priority queue); runs both client-side and via `POST /api/route/`.

> **Note:** `llms.txt`, `site-summary.md` and `README.md` once claimed "no backend /
> no database / no external API". That was **false** and was **corrected on
> 2026-06-29** — all three now describe the PHP+MySQL backend (see §4).

## 2. Domain glossary (English ↔ Aventurien/DSA)

These German terms are **content, not translatable** — they are data, join keys,
or in-world vocabulary. Keep them as-is in code.

| German / in-world | Meaning |
|---|---|
| *Herrschaftsgebiet* | political / dominion territory (the core entity) |
| *Reich*, *Grafschaft*, *Baronie* | realm / county / barony (territory ranks) |
| *Umstrittene Gebiete* | disputed/contested territories (rendered as diagonal hatching) |
| *Weg / Pfad / Straße / Reichsstraße / Gebirgspass / Wüstenpfad / Flussweg / Seeweg* | path subtypes (stable keys in `PATH_SUBTYPE_KEYS`) |
| *Querfeldein* | synthetic cross-country route type |
| *Kreuzung* | crossing node (route graph), name prefix `Kreuzung-` |
| *Kraftlinien (powerlines), Regionen, Aggregat* | map display modes |
| *Wappen* | coat of arms |
| *Gültigkeit / valid_to_bf*, **BF** | in-world validity; **BF = "Bosparans Fall"** calendar year (e.g. `1049 BF`) |
| *Derived / abgeleitete Außengrenze* | computed outer boundary of a territory aggregate |
| *WikiSync* | importer that crawls *Wiki Aventurica* into staging tables |
| *Schraffur* | hatching (contested-territory rendering) |
| *Albenhus / Zwerch* | known data-anomaly territories (display-inheritance bug, see §10) |

Settlement type slugs (stable keys): `metropole`, `grossstadt`, `stadt`,
`kleinstadt`, `dorf`, `gebaeude`. Their **visible labels** are German UI strings
(see §8).

## 3. Architecture map

Build-free, multi-`<script>` app. Load order in `index.html` is a **contract**
(later files can shadow earlier globals — verify order before assuming which
definition wins). Frontend clusters under `js/`:

| Dir | Responsibility |
|---|---|
| `js/app/` | bootstrap, `api-client.js`, runtime state, shared utils, share-link |
| `js/map-features/` | ~50 modules: layers, markers, labels, regions, political layer, canvas overlays |
| `js/territory/` | political-territory editor (embedded host), wiki-tree engine, derived geometry |
| `js/routing/` | route engine, graph, plan/render, waypoints (+ inline glue in `index.html`) |
| `js/review/` | review panels, WikiSync UI |
| `js/ui/` | spotlight search, popups, controls |
| `js/community/` | location reviews/ratings |
| `js/pages/` | scripts for standalone `html/*.html` pages |
| `js/third-party/` | Leaflet 1.9.4, jQuery 3.6.0, jQuery-UI, leaflet.textpath, polygon-clipping, polylabel |

Rendering: Leaflet SVG paths for vectors; **Canvas overlays** for markers,
labels, boundaries, contested hatching (performance). SQL is the source of truth;
the map hydrates from `GET /api/app/map-features.php`.

## 4. API contract

Backend lives under `api/`, tiered by audience:

| Zone | Purpose | Auth |
|---|---|---|
| `api/route/`, `api/locations/` | **stable** public developer API | public |
| `api/app/` | app-facing read endpoints (map-features, search, coat, territory-detail, …) | mostly public |
| `api/edit/{map,political,reports,wiki}/` | authenticated editor/review writes | capability-gated |
| `api/import/location-reports/` | server-to-server import | import token |
| `api/diagnostics/` | read-only diagnostics | mixed |
| `api/_internal/{routing,wiki,political}/` | private PHP libraries (no direct public surface) | — |

**Stable contract = `POST /api/route/` and `GET /api/locations/`.** They define
the canonical envelope every endpoint is being unified toward:

```
success: { "ok": true,  ... }
error:   { "ok": false, "error": { "code": "<machine_code>", "message": "<human>" } }
```

Auth/CORS/JSON live in `api/_internal/bootstrap.php`
(`avesmapsLoadApiConfig`, `avesmapsApplyCorsPolicy`, `avesmapsJsonResponse`,
`avesmapsReadJsonRequest`, `avesmapsCreatePdo`) and `api/_internal/auth.php`
(`avesmapsRequireUserWithCapability`). Protected dirs (`_internal`, `_schema`,
`diagnostics`) must be `.htaccess`-denied in deployment. **Canonical reference:
`api/README.md`.**

> The contract is **not yet uniform** — most endpoints still return a flat
> `error: "string"` and several leak exception text. This is the subject of the
> refactoring milestone M3 (see `docs/refactoring-masterplan.md`).

## 5. Data model

Schema of record currently lives **mostly as inline `CREATE TABLE IF NOT EXISTS`
DDL in PHP** (self-healing pattern), partially mirrored in `sql/`. Key tables:

- `map_features` — locations, crossings, paths, rivers, regions, labels (+ `map_revision`, `map_audit_log`, `map_feature_locks`, `editor_presence`).
- `political_territory` + `political_territory_wiki` + `political_territory_geometry` (+ `_geometry_audit_log`, `_derived_geometry`, `_claim`) — territory hierarchy via `parent_id`, GeoJSON Polygon/MultiPolygon, BF-year timeline (`valid_from_bf`/`valid_to_bf`, `9999` = open/never-dissolved sentinel).
- `location_reports` / `map_reports`, `map_reviews`, `map_share_links`.
- `sources` + `feature_sources` — multi-source system (shipped): shared source catalog (`url`/`url_hash`=SHA256, `label`, `source_type`, `is_official`) linked to elements (`entity_type` ∈ settlement|region|path|territory, `entity_public_id`, `status`). Public read `GET /api/app/feature-sources.php`; editor write `POST /api/edit/map/feature-sources.php` (capability `edit`, dedup by `url_hash`, atomic `other_source` takeover). Wiki-publication bulk lookup + provenance **shipped**: `feature_sources` gains `origin` (wiki_publication|manual|community), `reference_kind`, `pages`, `note` (+ `status='suppressed'` tombstone); a resumable `publication_sources` dump-sync phase parses `{{Infobox Produkt}}` + `==Publikationen==` into `wiki_publication_catalog`/`wiki_entity_publication` staging, and an **owner-triggered `sync_publications` action** reconciles them override-safely into the wiki layer (writes/deletes ONLY `origin='wiki_publication'`, manual/suppressed untouched, idempotent by `wiki_key`). Sources travel in the `map-features` payload (shared `source_catalog` + per-entity refs, rendered synchronously — no lazy per-popup fetch). See §11.
- WikiSync staging: `wiki_sync_runs/pages/cases`, `wiki_*_staging/queue`, `political_territory_wiki_test`, `wiki_territory_model`, `wiki_redirect_alias`.

**Coordinate convention:** GeoJSON stores `[x, y]`; Leaflet `L.CRS.Simple` uses
`[lat, lng] = [y, x]`. Always swap consciously.

## 6. Build / deploy flow

- **No build.** Source files are served directly.
- GitHub Action `.github/workflows/deploy-avesmaps-strato.yml` mirrors an
  **allowlist** of items to STRATO over SFTP. **It does not delete** — files
  removed from the repo persist on the server (see §10 server↔repo drift).
- An asset-version stamping step rewrites `?v=` hashes for every asset reachable
  from `index.html` / `html/*.html`, following the CSS `@import` chain. **The
  sources themselves stay unstamped** (§7).

## 7. Asset-versioning gotcha (read before debugging "my change didn't show up")

Two independent cache-busting mechanisms:

1. **Automatic** content-hash `?v=` for everything reachable from `index.html` or
   an `html/*.html` page — linked directly *or* through the CSS `@import` chain
   (`styles.css` → `base/tokens.css` → …, at any depth). Handled by the deploy
   stamping step; do nothing. **Never write a `?v=` by hand anywhere** — the deploy
   overwrites it and a hand-written tag can only go stale. The deploy verifies the
   chain and refuses to upload if a hash disagrees.
2. **Manual** `const ASSET_VERSION` in
   `js/territory/territory-editor-inline-host.js` — governs the **dynamically
   loaded editor HTML/CSS/JS**. **Bump it on every change to editor assets**, or
   the browser serves stale editor code. `inline-host.js` itself is loaded by
   `index.html` *without* `?v=`, so after editing it you need one hard reload.
3. **Manual, and the one exception to "never by hand":** `edit/index.php` links
   `css/pages/edit.css` with a hand-written `?v=`. The stamper walks `index.html`
   and `html/*.html` only, so it never reaches a `.php` page and cannot overwrite
   or verify this tag. **Bump it by hand whenever `edit.css` changes**, otherwise
   editors keep the cached stylesheet. Rule 1's ban applies to everything the
   stamper *does* reach — which is everything else.

Diagnosis when a deployed change doesn't appear: compare `fetch(url+'?cb='+Date.now())`
(server-fresh) vs `fetch(url)` (as the app loads). See
`docs/asset-caching-and-versioning.md`.

## 8. Language policy

Primary UI language is **German** and stays German. An i18n layer
(`?lang=en` overlay backed by a string table) is planned (milestone M8) — German
is the default, English is opt-in. Therefore:

- **Do not** translate user-facing German UI strings inline (that would change the
  default UX). Extract them into the i18n table instead.
- **Do** write code comments, docs, commit messages and internal API error
  *messages* in **English** going forward (the `error.code` machine values are
  already English — never change those).
- Never translate domain content (§2), `<option value>` slugs, `queryParam`
  toggle names, `PATH_SUBTYPE_KEYS`, or the `BF` calendar suffix.

## 9. Dev conventions

- **OS:** Windows + PowerShell. Watch the CRLF edit trap (prefer single-line
  edits on CRLF files). `.gitattributes` now sets `text=auto` + binary markers.
- **Git:** small, verified commits **directly to `master`**; push triggers a
  ~1–2 min auto-deploy. Verify the remote SHA after pushing. Conventional-commit
  prefixes (`feat/fix/chore/docs/perf/refactor`, plus the repo's custom `ui:`).
- **Shared working tree — never `git add -A`:** multiple agent sessions share
  this one checkout and `.git`, and other sessions may have **live uncommitted
  work** in the tree right now. Never `git add -A`, `git add .`, or `git commit
  -a` — that sweeps another session's half-finished files into your commit under
  your message and mangles their history. Always `git status` first, identify
  changes that aren't yours, and stage **only the files you yourself touched**,
  by explicit path. Leave foreign modified/untracked files alone (that session
  will commit them). If a push is rejected, `fetch` + `rebase origin/master`
  (autostash) + retry — never force-push.
- **STRATO caution:** never loop expensive endpoints (e.g. the political layer) —
  it saturated PHP workers once and looked like a DB outage. Probe with a single
  request.
- **Editor-visible change → update the handbook in the same commit.** If your
  change alters what a human editor sees or does — a renamed button, a new tab or
  dialog, a changed workflow, a new rule they must follow — pull the matching
  section of `html/editor-handbuch.html` along with it, and bump the `Stand:` date
  in its top bar. Not a follow-up task: the handbook went from written to
  materially wrong in **13 days** (2026-07-07 → 07-20) precisely because this was
  nobody's job. A wrong handbook is worse than none — new editors act on it. If
  the change only touches internals an editor never sees, there is nothing to do.
- **Secrets:** `api/config.local.php` is gitignored and must never be committed.
  No production dumps, reports, audit logs, tokens or credentials in the repo.
- **Legal:** DSA assets follow the Ulisses fan guidelines (see `NOTICE.md`).

## 10. Known fragilities

- **Server↔repo drift:** the prod webroot has PHP files not in the repo (deploy
  never deletes). "Not in the repo" ≠ "safe to delete". A 161-orphan surgical
  cleanup ran 2026-06-14 (deleted the pre-reorg flat `js/`, old icons/css/images,
  M1/M4 leftovers, and stale dirs `/map /politics /test /js/pages /css/legacy`)
  via the deploy's "Retire orphaned remote files" step — **never `mirror --delete`**
  (its dry-run would also delete live files). **Still load-bearing on the server &
  protected:** `tiles/` (base map; tile files use NEGATIVE y, `map_x_-y`),
  `uploads/`, `admin/phpMyAdmin`, `api/wiki-sync.php` (frontend fallback),
  `api/app/.user.ini`, `config.local.php`. Root shims `api/{auth,bootstrap}.php`
  are kept (clean-deploy safety; the `political-territory-lib`/`wiki-sync-lib` lib
  shims were removed in M3 step 4). Directory URLs return 404 on this server
  (listing off) — not a sign of deletion.
- **`territories-endpoint.php` runs DDL + metadata probes before its cache read**
  on every political-layer request; the derived layer has an N+1 over the full
  territory table. Both are perf hotspots (milestone M6).
- **Albenhus/Zwerch** display-inheritance anomaly: a save writes resolved displays
  globally onto all ancestors.
- **Schema is in code, not `sql/`:** ~14 tables exist only as inline PHP DDL;
  `sql/` is a partial, partly-stale snapshot. `map_feature_relations` and
  `map_proposals` are defined but unused (dead schema).
- Several edit endpoints leak `getMessage()` to clients (info disclosure,
  milestone M1).

## 11. Documentation index

Authoritative docs (being translated to English in M8):

- **`docs/design-language.md` — the warm/aventurian design language + token rules (see §12). Read before any CSS/UI work.**
- **`html/editor-handbuch.html` — the handbook human editors actually read.** Not a doc *about* the code; it is product surface, reachable from the edit shell's top bar and the editor panel's status line. Five layers: Erste Schritte / Karten-Features / Aufgaben / Verstehen / Nachschlagen. **Keep it current with editor-visible changes (see §9)**; plan and gap inventory in `docs/superpowers/plans/2026-07-20-editor-handbuch-aufwertung.md`.
- `docs/asset-caching-and-versioning.md` — **the deploy/cache gotcha** (see §7).
- `docs/future-map-architecture.md` — north-star architecture & full data model.
- `docs/territories.md` — political-territory data model + WikiSync.
- `docs/refactoring-map.md` — frontend responsibility-cluster map & load order.
- `docs/repository-data-policy.md` — what may/may not enter the repo.
- `docs/map-features-rest-architecture.md` — structure of the map-features layer.
- `docs/quellen-system-design.md`, `docs/quellen-system-2-editor-design.md` — multi-source system (infobox display + editor management).
- `docs/wiki-publikations-quellen-design.md` — Wiki publication-source bulk lookup (**shipped**; sources travel in the map payload; wiki/manual/community provenance; manual/suppressed overrides preserved). Implementation instruction: `docs/wiki-publikations-quellen-instruction.md`.
- `docs/abenteuer-feature-design.md` (spec) + `docs/abenteuer-instruction.md` (phased build) + `docs/abenteuer-editor-ui-spec.md` (Phase 3 / P2 editor-UI spec — layout C, multiple starts, manual ▲▼ reorder, hidden suppressed-tombstones toggle, token-based) — **Adventures feature**: DSA adventures ↔ their ordered places (settlement/territory/region/path) surfaced as infopanel sections + a spoiler-gated questroute. **Phase 1 shipped**: schema `adventure`/`adventure_place` (inline DDL), catalog read `GET /api/app/adventures.php` + wiki-key resolver + client index, settlement "beginnt/spielt (Spoiler)" display. **Phase 2 (aggregation) + Phase 3 editor P1 (backend) + P2 (UI, layout C) + P3 (Ort-autocomplete, `docs/abenteuer-editor-p3-autocomplete.md`) shipped**; regions resolve via nested `properties.wiki_region.wiki_url` (a top-level `wiki_url` is empty for regions); a picked non-wiki-linked place shows "ohne Wiki-Eintrag" (a valid state). **Phase 4 wiki-sync (dump → adventures) + „Abenteuer"-Ribbon + Cover shipped** (mirrors the publication two-step: an `adventures` staging phase in the dump-hybrid driver builds `wiki_adventure_catalog`/`wiki_adventure_place_staging` from `{{Infobox Produkt}}` adventure pages during „Dump holen"; an owner-triggered `sync_adventures` action reconciles override-safely into `adventure`/`adventure_place` — writes/deletes ONLY `origin='wiki'`, manual/community/suppressed untouched, adopts the 6 seed placeholders by title. Real infobox fields: `Ort`/`Art`/`Genre`/`KompM`/`KompSp`/`Regeln`/`Bild={{ProdCover}}` — no BF year in the infobox. **Covers** ride the Wappen engine: fetched to `/uploads/questcovers` on reconcile, own>wiki override, F-Shop-reference license (NOT `public_domain`); the frontend cover links to the Ulisses F-Shop + a source footnote, the editor has a cover preview + upload/„neu ziehen". Reconcile/parser/driver cores are unit-tested; end-to-end needs a real „Dump holen" + „Abenteuer syncen"). Then editor-P4 community — its own session.
- `docs/political-territory-editor.md` — editor architecture.
- `docs/stylized-map-tiles.md` — tile pipeline.
- `docs/political-territory-global-display-and-derived-boundaries-{plan,progress}.md`,
  `docs/derived-territory-geometry-plan.md` — derived-boundary system.
- `docs/feature-umstrittene-gebiete.md` — active contested-territory feature.
- `docs/routing-featurestand.md`, `docs/stabilization-smoke-test.md`,
  `docs/routing-transport-smoke-checklist.md` — routing state & smoke checklists.
- `api/README.md` — canonical API contract.
- **`docs/refactoring-masterplan.md` — the active refactoring program (M0–M8).**

> Spent per-refactor process logs were deleted in M0; do **not** recreate
> per-split "boundary-check / stable" logs.

## 12. Design language (read before any CSS / UI work)

**One warm, *aventurian* visual language for every surface** — route planner
(`#search`), infobox (`.avesmaps-infopanel`), dialogs, popups, editor. Warm
browns + parchment + coat-of-arms gold. **No blue** (it reads as a foreign UI
kit and is what made the panels diverge).

**Hard rule: never hardcode a colour / radius / divider — always use a token
from `css/base/tokens.css`.** Need a value with no token? Add the token first,
then use it. A literal colour written twice is divergence waiting to happen —
this is exactly how the infobox and route planner drifted apart (1000+ hardcoded
hex values across 38 CSS files).

- **Buttons** have a hierarchy: main action *filled* (`--color-button`), the rest
  *soft/outline* (`--color-button-soft`); radius `--radius-md`; no pill shapes.
- **Group by divider** (`--color-divider` line + heading), **not** by framed
  boxes; popup/infobox dividers run full-bleed (negative side-margin = padding).
- **Links** use `--color-link` (gold-brown), never blue; **external links**
  (off-site) always get a trailing `↗`.
- **New components:** reuse the nearest existing one as a template plus the
  tokens; match the warmth. Full guide: **`docs/design-language.md`**.
