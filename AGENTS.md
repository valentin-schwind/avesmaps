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
| *Literatur* | the published DSA works tied to a place (code: `game-literature` / `GameLiterature`). *Abenteuer* is **one kind** of it, not the category. 💣 Not to be confused with *Quellen* — see the next row |
| *Quellen* | the **citations** an entry carries (`sources` + `feature_sources`, `publication-*.php`, `avesmapsPublication*`, `publisher`). The opposite direction from *Literatur*: a work vs. the reference to a work. The two words must never share an autocomplete prefix |
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
- `changelog_entry` — the milestones behind „Änderungsverlauf" in the notices dialog (see §11).
- `sources` + `feature_sources` — multi-source system (shipped): shared source catalog (`url`/`url_hash`=SHA256, `label`, `source_type`, `is_official`) linked to elements (`entity_type` ∈ settlement|region|path|territory|citymap|lore, `entity_public_id` — VARCHAR(190), widened 2026-07-22 because a lore key is a wiki-article slug, not a short public id, `status`). Public read `GET /api/app/feature-sources.php`; editor write `POST /api/edit/map/feature-sources.php` (capability `edit`, dedup by `url_hash`, atomic `other_source` takeover). Wiki-publication bulk lookup + provenance **shipped**: `feature_sources` gains `origin` (wiki_publication|manual|community), `reference_kind`, `pages`, `note` (+ `status='suppressed'` tombstone); a resumable `publication_sources` dump-sync phase parses `{{Infobox Produkt}}` + `==Publikationen==` into `wiki_publication_catalog`/`wiki_entity_publication` staging, and an **owner-triggered `sync_publications` action** reconciles them override-safely into the wiki layer (writes/deletes ONLY `origin='wiki_publication'`, manual/suppressed untouched, idempotent by `wiki_key`). Sources travel in the `map-features` payload (shared `source_catalog` + per-entity refs, rendered synchronously — no lazy per-popup fetch). See §11.
- WikiSync staging: `wiki_sync_runs/pages/cases`, `wiki_*_staging/queue`, `political_territory_wiki_test`, `wiki_territory_model`, `wiki_redirect_alias`.

> 💣 **Sources live in ONE place. Never build a second source system.**
> A new entity that needs sources joins `sources` + `feature_sources` by adding its
> name to the `entity_type` whitelist — today `settlement | region | path | territory
> | citymap | lore`, in `api/edit/map/feature-sources.php` and
> `api/app/feature-sources.php`. That is a two-line change, and it is how `citymap`
> and `lore` joined.
>
> This is written down because it was ignored once: the Lore feature (Natur & Waren,
> 2026-07-21) shipped its own `lore_source` table. The cost was not theoretical — a
> publication title is stored once in the shared catalogue but was duplicated into
> every one of ~35 000 lore rows, the editor had no add/remove/autocomplete and no
> `note`/`status` provenance, and the same wiki publication data flowed through two
> unrelated reconcilers. **Undone on 2026-07-22** (spec:
> `docs/superpowers/specs/2026-07-22-lore-quellen-vereinheitlichung-design.md`): it
> cost a schema widening, a data migration and a re-test of the whole lore sync —
> against the two lines it would have cost up front.
>
> The tell: if you are about to write `CREATE TABLE <feature>_source`, stop — the
> answer is one more `entity_type`.

**`wiki_key` derivation is a fixed table, never a locale.** `avesmapsPoliticalSlug()`
and the WikiSync match key fold non-ASCII through `avesmapsFoldToAscii()`
(`api/_internal/text/ascii-fold.php`) — **not** `iconv//TRANSLIT`, which is
libc-dependent and keyed the same name differently on the dev machine and on
STRATO. The table reproduces the **server's** form: umlauts fold to `'?'` and
lose their base letter (`Fürstentum Kosch` → `wiki:f-rstentum-kosch`), verified
against 1384/1384 live rows. Making it "nicer" rewrites every umlaut-bearing key
and silently breaks every join using one — that is a data migration across ~10
tables, not an edit to the table. Guarded by `tools/wikidump/test-ascii-fold.php`
(self-test panel) and `tools/wikidump/verify-live-key-parity.php` (against prod).

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
  prefixes (`feat/fix/chore/docs/perf/refactor`, plus the repo's custom `ui:`). 💣 **A scope word names ONE feature.** `verlauf:` belongs to the paths' wiki-course sync (`path-verlauf.php`, `verlauf_cases`) and **never** to the „Neuigkeiten" window — that one is `neuigkeiten:` or `changelog:`. It was miscommitted twice on 2026-08-08; `git log --grep` and `git grep` cannot tell the two apart afterwards.
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
- **Editor-visible change → name it in the commit subject; do NOT edit the
  handbook in passing.** `html/editor-handbuch.html` is owned by a nightly routine
  (`avesmaps-handbuch-pflege`, 00:00 local — see §11), not by whoever happens to
  touch an editor surface. Your only obligation: a commit subject that states the
  user-visible effect ("rename the X button", "new Y tab", "Z now runs globally").
  The routine reads `git log`, judges whether an editor following the handbook
  would now find something different, and rewrites the affected section. Editing
  the handbook yourself competes with that routine over the same file and its
  `Stand:` date — leave it alone unless the owner asks you directly. This replaced
  the old "same commit" rule on 2026-07-22: it depended on every one of many
  parallel sessions remembering, and a wrong handbook is worse than none (it went
  from written to materially wrong in **13 days**, 2026-07-07 → 07-20, back when
  it was nobody's job).
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
- 💣 **`css/pages/political-territory-editor-inline.css` is a BUILD PRODUCT** —
  `tools/scope_editor_css.js` generates it from `political-territory-editor.css`,
  `-layout.css` and `political-territory-wiki-tree.css`. A rule written into it by
  hand works immediately and dies, silently, at the next `node tools/scope_editor_css.js`.
  That happened three times (`e5cb8f1b`, `127a7c78`, `5fa1f323`); the regeneration in
  `0bc22ffc` took all **14** rules with it — the Hierarchie-Level table, the
  transparency row and the WikiSync button — and nobody noticed for two weeks, until
  the colour picker started sticking out of its panel. **Edit the source, then
  regenerate, then bump `ASSET_VERSION`** (§7). Guarded by
  `tools/__tests__/scope-editor-css.test.js` (generated == generator output; no markup
  class without a rule). ⚠️ `css/components/political-territory-editor-columns.css`
  loads *after* the generated sheet and blanket-sets `.manual-data-section table {
  table-layout: auto }` — an equal-specificity `table-layout: fixed` in the editor
  sheet is inert, so address such a table through its section.
- Several edit endpoints leak `getMessage()` to clients (info disclosure,
  milestone M1).

## 11. Documentation index

Authoritative docs (being translated to English in M8):

- **`docs/design-language.md` — the warm/aventurian design language + token rules (see §12). Read before any CSS/UI work.**
- **`html/editor-handbuch.html` — the handbook human editors actually read.** Not a doc *about* the code; it is product surface, reachable from the edit shell's top bar and the editor panel's status line. Five layers: Erste Schritte / Karten-Features / Aufgaben / Verstehen / Nachschlagen. **Maintained by a nightly scheduled task, not by feature sessions (see §9)**: `avesmaps-handbuch-pflege` runs at 00:00 local and does two things — (A) read every commit since its last run and rewrite the sections an editor would now find wrong, (B) re-verify 3–4 of the 33 anchored `<h3 id=…>` sections against the live code on rotation, so the whole book is checked roughly every 8–10 days. It commits only when something actually changed, and only `html/editor-handbuch.html`. Plan and gap inventory in `docs/superpowers/plans/2026-07-20-editor-handbuch-aufwertung.md`.
- `docs/asset-caching-and-versioning.md` — **the deploy/cache gotcha** (see §7).
- `docs/future-map-architecture.md` — north-star architecture & full data model.
- `docs/territories.md` — political-territory data model + WikiSync.
- `docs/refactoring-map.md` — frontend responsibility-cluster map & load order.
- `docs/repository-data-policy.md` — what may/may not enter the repo.
- `docs/database-backup.md` — **the full-database backup** (edit shell top bar → „💾 Datenbank-Backup", `edit/backup.php`, **admin only**). Chunked resumable dump → one gzip-packed `.sql` that restores with `gunzip -c … | mysql` or a phpMyAdmin import; lib `api/_internal/backup/db-dump.php`, endpoint `api/edit/admin/database-backup.php`, state `db_backup_run`, files in HTTP-denied gitignored `uploads/db-backups/` (3 newest kept). 💣 **The `.gz` is built the pigz way — one gzip MEMBER, not one member per chunk.** A deflate stream cannot be resumed across requests, so the naive writer appends a member per flush; `gunzip`/zlib read that whole, but PHP's `gzdecode()` and 7-Zip's GUI read only the FIRST member and hand back a silently truncated dump. Hence: fixed 10-byte header once, then per flush a FRESH raw-deflate context with `ZLIB_SYNC_FLUSH`, then a final empty block + CRC/ISIZE, with the CRC carried across steps via `crc32_combine`. The unit test's `gzdecode()`-returns-everything assert is what guards it. ⚠️ Hot backup (no transaction spans the run) and the file carries password hashes — never in the repo.
- **Das Fenster „Neuigkeiten"** — die Projekt-Meilensteine, erzählt für Leser, die weder Commits noch Code kennen. Live 2026-08-03; **`docs/neuigkeiten-fenster.md`**, Mockup `docs/changelog-mockup.html`. 🔴 Die **Beschriftung** heißt seit 09.08.2026 „Neuigkeiten", der **Code** weiter `changelog` (Tabelle `changelog_entry`, i18n-Schlüssel `changelog.*`, Endpunkt, Dateinamen) — der Deploy löscht nie (§10), eine umgetaufte Adresse liesse eine gecachte `index.html` ins Leere greifen. Aus demselben Grund ist **`verlauf:` kein Commit-Scope dafür**: das Wort gehört dem Wiki-Kurs-Sync der Wege (`path-verlauf.php`, `verlauf_cases`). 💣 Vier Fallen, alle im Dokument begründet: die Ecke ist EIN Bund (`#map-corner-actions`, `--avesmaps-corner-stack` an `:root`) · eine leere Tabelle fällt auf `avesmapsChangelogSeed()` zurück, und ein Seed sieht genau wie ein gepflegter Verlauf aus (so blieb er fünf Tage unbemerkt stehen) · `overflow-anchor: none` am Scroll-Kasten ist tragend · die pflegende Routine hat keine Session, nur ein Token mit **eigenem** Schlüssel (`changelog.app_token`, nie der von Discord) und nur `list`/`save`, nie `delete`.
- **Tastaturbefehle** (`js/app/keyboard-shortcuts.js`, live 2026-08-05) — die Karte lässt sich mit der Tastatur bedienen: Suche, Reiseziel, Verschieben/Zoomen, die sechs Ansichten, die sechs Ortsklassen, schnellste/kürzeste Route, Etappe vor/zurück. 💣 **Die Liste `SHORTCUTS` in dieser Datei ist die EINZIGE Quelle** — sie ist zugleich die Belegung *und* der Bauplan der Tabelle unter **Hinweise → „Bedienung" → „Bedienhilfen"** (`#legal-shortcuts`, Stil in `css/components/legal-dialog.css`). Wer eine Taste woanders verdrahtet oder die Erklärung von Hand in `index.html` schreibt, baut die Divergenz ein, die das verhindern soll. 💣 **Kein Strg, kein Alt, kein Meta** (Owner-Entscheid 2026-08-05): der erste Entwurf legte sieben Befehle auf Strg, und die gehören dem Browser (Strg+R lädt neu, Strg+P druckt, Strg+F sucht im Text, Strg+L/K sind die Adresszeile und lassen sich nicht überall abfangen). Dieselben Buchstaben ohne Strg — `matchShortcut` gibt bei jedem dieser Modifier sofort auf. 💣 **W A S D schieben und liegen VOR den Ansichten — diese vier Buchstaben sind für eine Ansicht unerreichbar.** `matchShortcut` nimmt die erste Zeile mit der Taste, und das Schieben steht oben. Daran ist „Standard" auf `S` gescheitert (Owner 2026-08-05, danach zurückgenommen: „behalte WASD"); die Ansicht sitzt seither auf `N`. Wer einen neuen Buchstaben vergibt, prüft ihn zuerst gegen W A S D. Die Ansichten heißen `O` Original, `P` Politisch, `K` Kraftlinien, `N` Standard, `L` Landschaften, `I` Nur Karte — „Landschaften" ist seit 2026-08-05 dabei (ansehen darf die Ebene seit 2026-08-04 jeder, nur das Bearbeiten hängt an einer Fähigkeit). ⚠️ **Leaflets eigene Tastatursteuerung ist abgeschaltet** (`map.keyboard.disable()`): sie wirkte nur nach einem Klick auf die Karte, und ihre Pfeiltasten hätten sich mit den hiesigen zu doppelten Sprüngen addiert. ⚠️ Der Riegel ist EINE Regel für alle: nichts wirkt beim Tippen, bei offenem Fenster (`[role=dialog]` sichtbar) oder bei laufendem Werkzeug — erkannt an den Klassen, die die Werkzeuge ohnehin an den Kartencontainer hängen (`TOOL_CLASSES`), also ohne zweiten Zustand. Test: `js/app/__tests__/keyboard-shortcuts.test.js`.
- **Das Inhaltsverzeichnis der Hinweise** (Entwurf `docs/superpowers/specs/2026-08-05-hinweise-inhaltsverzeichnis-design.md`, live 2026-08-05) — die acht Abschnitte des Fensters „Hinweise" (`#legal-dialog` in `index.html`) sind `<details>`: **zugeklappt sind sie sein Inhaltsverzeichnis** (Überschrift plus eine Zeile, was drinsteckt), aufgeklappt sein Inhalt. Aus 4.937 px Scrollstrecke wurden 803. 💣 **Nativ, und nichts anderes:** nur `<details>/<summary>` lässt Strg+F Text in einem ZUgeklappten Abschnitt finden und klappt ihn selbst auf — ein selbstgebautes Auf- und Zuklappen mit `display:none`/`hidden` nimmt der Seitensuche den Text weg, und dieses Fenster trägt Impressum und Datenschutzerklärung. Fokus, Enter/Leertaste und `aria-expanded` kommen ebenfalls vom Element; hier gehört kein JS hin. ⚠️ Die Trennlinie sitzt an `.legal-section` (dem Abschnitt), nicht mehr an der Überschrift: im `<details>` ist das `<summary>` immer erstes Kind, die alte Ausnahme `.legal-dialog__group:first-child` hätte alle acht Linien gelöscht. ⚠️ Kein vollbreiter Hover-Streifen mit negativen Seitenrändern — der Scroll-Kasten hat `overflow-y: auto` und hängt sich sonst eine waagerechte Bildlaufleiste an. Der Absatz „Betreiber/Impressum" steht seit 2026-08-05 in **„Kontakt und Impressum"**, nicht mehr in „Projekt und rechtlicher Status".
- `docs/map-features-rest-architecture.md` — structure of the map-features layer.
- `docs/quellen-system-design.md`, `docs/quellen-system-2-editor-design.md` — multi-source system (infobox display + editor management).
- `docs/wiki-publikations-quellen-design.md` — Wiki publication-source bulk lookup (**shipped**; sources travel in the map payload; wiki/manual/community provenance; manual/suppressed overrides preserved). Implementation instruction: `docs/wiki-publikations-quellen-instruction.md`.
- **Literatur** — DSA-Werke ↔ ihre geordneten Orte (Siedlung/Territorium/Region/Weg), als Infopanel-Abschnitte plus spoilergesteuerte Questroute. Entwurf **`docs/superpowers/specs/2026-08-06-literatur-design.md`**; Phasen in `docs/abenteuer-feature-design.md`, `-instruction.md`, `-editor-ui-spec.md`, `-editor-p3-autocomplete.md`. P1–P4 live (Katalog, Aggregation, Editor, Wiki-Sync + Ribbon + Cover). 💣 **Drei** Rollen, nicht zwei: `start` („beginnt hier") und `covers` („beschreibt") sind spoilerfrei, **`play` IST der Spoiler** — jede Stelle, an der „alles, was nicht start ist, ist Spoiler" stand, war damit lautlos falsch. Normalisiert an EINER Stelle je Seite (`avesmapsGameLiteratureNormalizeRole`), Rückfall immer Richtung `play`. 🔴 **Umbenannt 2026-08-07 (Abenteuer → Literatur) — die TABELLEN aber nicht** (`adventure`, `adventure_place`, `wiki_adventure_*`), ebenso wenig irgendein String, der als WERT in einer Zeile steht (`app_setting`-Schlüssel, Aktion `sync_adventures`, Audit-Aktionen, JSON-Schlüssel). Genau diese Trennung macht die Umbenennung sicher: der Deploy löscht nie (§10), die verwaisten alten Endpunkte antworten weiter richtig, und ein `RENAME TABLE` bräche das. Die übrigen Fallen (Kopfzähler, `PRODUCT_TYPE_GROUPS`, Spotlight-Rollen, `.avesmaps-adv*`) im Entwurf §§4–8.
- **Die Übernahme-Vorschau** — jeder Wiki-Abgleich zeigt erst, was er tun würde; geschrieben wird nur, was angehäkelt ist. Drei Kategorien (**Neu · Geändert · Gelöscht**), Neu und Geändert vorangehäkelt, Gelöscht nie und mit zweiter Bestätigung. Entwurf **`docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md`**, Baupläne `docs/superpowers/plans/2026-08-06-sync-uebernahme-sitzung-{1,2}.md`, Mockups `docs/sync-uebernahme-mockup.html` + `-fallliste-mockup.html`. Live seit 2026-08-06 für Stadtkarten, Literatur, Publikationsquellen und Vorkommen; Territorien (Sitzung 4) ziehen nach. Bauteil `js/review/sync-plan-sheet.js`, Endpunkt `api/edit/wiki/sync-plan.php`, Fundament `api/_internal/wiki/sync-plan.php`, Tabellen `sync_plan_run`/`sync_plan_item` + 🔴 `sync_decision` (die EINZIGE dauerhafte Entscheidung, nie automatisch geleert). 💣 Sieben Fallen, alle im Entwurf begründet: sie kommt **immer**, auch bei null Unterschieden · jeder Abgleich ist in Rechen- und Ausführ-Hälfte geschnitten, und die Rechen-Hälfte schreibt in KEINE Nutztabelle (`sync-plan-purity-test.php`) · die dritte Kategorie gehört dem Verschwinden einer ganzen EINHEIT, nie einzelner Kindzeilen · bei den Vorkommen ist die „Löschung" ein Grabstein (`status='retired'`, das Wort heißt „stilllegen") · „Löschung abgelehnt" ist NICHT `origin='manual'` · eine Übernahme schreibt EINE Protokollzeile je Lauf · der Löschriegel steht serverseitig in `apply`, nicht nur am ausgegrauten Knopf. ⚠️ Sitzung 3 (Orte, Wege, Regionen) bekam bewusst nur die **Formensprache**, keine `sync_plan_item`-Zeilen: von 16 Falltypen passen 2 auf ein Häkchen.
- **`docs/konfliktmanagement-design.md` — the conflict centre** (editor surface: WikiSync → „⚖️ Konflikte"). Conflicts are **computed, never stored** — only the editor's decision is durable (`conflict_decision`, keyed by `(rule_id, fingerprint)`), so a repaired case disappears by itself and one whose facts changed reopens by itself. **Shipped:** rule registry + decision store + endpoint (`api/edit/map/conflicts.php`, libs in `api/_internal/conflicts/`), the two global wiki-namespace rules, per-party evidence, the repair verbs, and the 12 legacy `wiki_sync_cases` types merged into the same list (surface only — they keep their own storage and resolve flows). 💣 Two noise filters are load-bearing and unit-tested: `path|path` is the ONLY legitimate shared-article pairing (215 groups / 1547 objects are one road's own segments), and auto-named ways `<Subtype>-<n>` never reach the watchlist (2448 of 3721). Removing either makes the tool unusable, not merely noisy. **Open:** the enrichment still guesses for parenthetical names (P3), and territories/adventures/citymaps/sources have no detector yet.
- **Der Social-Media-Hub** — Editoren veröffentlichen aus Avesmaps heraus (Text, Hashtags, Bild) auf mehreren Netzen; die automatischen Feature-Updates landen als **Vorschlag** in derselben Liste und warten auf Freigabe. Entwurf **`docs/superpowers/specs/2026-08-10-social-media-hub-design.md`**, Bauplan `docs/superpowers/plans/2026-08-10-social-media-hub-stufe-1.md`, Mockup `docs/social-hub-mockup.html`. **Stufe 1 live 10.08.2026** (Reiter Community → „Social Media", Hub, Register, Endpunkte, Bild-Pipeline, Status je Kanal, Rechteriegel, Probe-Kanal, Freigabe); echte Adapter sind Stufe 2, Video Stufe 3. Bauteile: `api/_internal/social/{channels,compose,media,store,publish}.php` + `adapters/`, Endpunkte `api/edit/social/{list,media,publish,retry}.php` und `api/social/routine-post.php`, Client `js/review/review-social.js`, Stil `css/components/social-hub.css`. 💣 Acht Fallen, alle im Code begründet und getestet: **der Status gehört dem KANAL, nicht dem Beitrag** (ein gemeinsames „gesendet" verschluckt das eine Netz, das abgelehnt hat) · ein **unbekannter Zustand fällt auf „wartet", nie auf „gesendet"** — Grün heißt „es steht draußen" · ein **fehlender Adapter ist `null`**, nie ein Leerlauf, der Erfolg meldet · **Instagram nimmt kein PNG**, also wird alles zu JPEG — und **JPEG kennt keine Transparenz**, ohne ausdrücklich weißen Untergrund kommt ein schwarzes Quadrat heraus, das niemand vor der Veröffentlichung sieht · **zugeschnitten, nicht gestaucht** (4:5 … 1,91:1) · **Hashtags zählen zum Zeichenlimit** und werden je Kanal gekappt · **erst live, dann posten** (das Bild muss HTTP 200 liefern, sonst cacht das Netz den Fehlschlag) · die Spalte heißt **`body`, nicht `text`** (reserviertes Wort) und **`source_ref` ist nullable** unter seinem UNIQUE-Schlüssel, weil MySQL viele NULL erlaubt, aber nur ein `''`. 🔴 Der **rotierende Zugangs-Token steht in der Datenbank** (`social_token`), nicht in `config.local.php`: eine Datei, die der Server im Zeitplan umschreibt, ist beim ersten Fehlschlag eine kaputte Konfiguration. 🔴 Eigene Fähigkeit **`social`** — deckt sich heute mit `admin`, weil das Rechtemodell keine Rechtematrix je Person kennt; das ist die enge Startwahl, nicht ihre Definition (Öffnen = eine Spalte plus eine Zeile, kein Aufrufer ändert sich). ⚠️ `#social-hub-overlay` steht in **drei** Selektorlisten in `dialog-overlays.css` — ein Overlay-`<div>` erbt nichts.
- `docs/political-territory-editor.md` — editor architecture.
- `docs/stylized-map-tiles.md` — tile pipeline.
- `docs/political-territory-global-display-and-derived-boundaries-{plan,progress}.md`,
  `docs/derived-territory-geometry-plan.md` — derived-boundary system.
- `docs/feature-umstrittene-gebiete.md` — active contested-territory feature.
- **„Hierher reisen“ + der Querfeldein-A\*** (Instruction `docs/superpowers/plans/2026-07-30-hierher-reisen-und-astar.md`, Entwurf `docs/superpowers/specs/2026-07-30-landschaften-v14-astar-design.md`) — **live 2026-08-01**. Rechtsklick auf einen beliebigen Kartenpunkt → Wanderschuh → Route bis genau dorthin. `POST /api/route/` nimmt `from_point`/`to_point` = `{x, y}`; der Punkt wird ein Graphknoten mit EINER Kante (dem A\*-Weg zum nächsten Graphknoten), danach laufen Dijkstra, Segmentbauer und Renderer unverändert. Kern: `api/_internal/routing/{land-areas,offroad-grid,offroad-data,offroad-leg}.php`, Client `js/routing/route-travel-here.js`. 💣 Die Landprüfung gilt **nur dem angeklickten Punkt** — Orte im Wasser werden nie geprüft (571 von 4.653 liegen geometrisch im Meer). 💣 Das Gitter ist **nie ein PHP-Array** (33,2 gegen 1 Byte je Zelle); drei Gelände-Byte-Ebenen, per **Maximum** verknüpft. **Drei Aufrufer, ein Rechner** (Instruction C `docs/superpowers/plans/2026-08-02-ausloeser-anker-und-x25-aufschlag.md`, **live 2026-08-02**): (1) „Hierher reisen"; (2) der **automatische Umweg-Auslöser** — jede Route vergleicht nach dem Dijkstra gefahrene Strecke gegen Luftlinie, über `AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD` (3,0) rechnet der A\* quer und BIETET die Kante an (`detour.php`); (3) die **Sehnen der gefundenen Route** — Komponentenbrücke und Wegpunkt-Anker werden nachträglich gebogen (`synthetic-refine.php`). 💣 Der A\* läuft für (3) **nie beim Graphbau**: 876 synthetische Kanten je Graph, aber 0–1 je Route. 💣 `AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR` (×25) ist ein **Dijkstra-Gewicht, keine Strecke und keine Zeit** — er stand bis 2026-08-02 in `distance_units` des stabilen Vertrags (484,65 für eine Linie von 19,39). Er bleibt im Gewicht, wird aber aus jeder gemeldeten oder verglichenen Zahl per `cost_factor` herausgerechnet. ⚠️ Die Schwelle allein entscheidet nicht: Querfeldein ist ~3× langsamer als eine Straße, zweite Prüfung ist deshalb die Zeit.
- **Klimazonen** — die **vierte** Landschaften-Ebene (`kind='klima'`): acht Zonen von Polar bis Tropisch (die Zahl ist **Daten**, nicht Code — `AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED`), dazu die Zeile „Klimazone" in der Infobox bei Ort, Region und Weg. Entwürfe **`docs/superpowers/specs/2026-08-03-klimazonen-design.md`** (§14 ist der Nachtrag von nach dem Bau) und `…-klimazone-infobox-design.md`, Bauplan `docs/superpowers/plans/2026-08-03-klimazonen.md`. 💣 Sechs Fallen, alle dort begründet: die Trennlinien (`ecosystem_climate_divider`) sind die Wahrheit, die Bänder sind ABGELEITET · ein Band darf nie als Polygon bearbeitet werden (`avesmapsClimateAssertNotDerived`) · eine Trennlinie darf zurücklaufen (Überhang), sich aber nicht selbst schneiden · eine Zone einzuschieben darf keine vorhandene Grenze bewegen (`south_type_key`) · drei Formen, drei Quellen (Ort = genau eine Zone, Region = anteilig, Weg = abschnittsweise) · der Punkttest fragt die **Bänder**, nicht die Trennlinien. ⚠️ `map_revision` deckt das im ETag NICHT ab — `avesmapsClimateReadStamp()` steht mit im Seed von `map-features.php`. Kein Reise-Effekt in dieser Fassung.
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
- **Eine Kontur gehört dem BEARBEITEN, nicht dem Ansehen** (Owner 2026-08-03, gilt für alle
  Landschaften-Ebenen). Die Fläche füllt immer, ihre Kante zeichnet sie nur, wenn **eine** Ebene im
  Editiermodus offen ist — nicht in „Alle" und nicht für den, der die Karte bloß ansieht. Getragen von
  `ecosystem-pane--editable` an der Pane (`--eco-contour` in `css/features/ecosystem-layer.css`).
  ⚠️ „Im Frontend fehlen die Ränder" ist damit **kein Fehler**, sondern die Regel.
- **Eine Zeilenhandlung ist nie die Haupthandlung der Seite** (2026-08-07, gemessen an den
  WikiSync-Listen). Ein *gefüllter* Knopf in einer Listenzeile multipliziert sich mit der Zeilenzahl:
  „Fläche zuweisen" + „Label zuweisen" standen als Akzentknöpfe in **jeder** Regionenzeile — live
  2×1.577 = **3.154** davon in einer 246 px schmalen Spalte —, und der Wege-Reiter trug 462 weitere,
  während die Ortsliste daneben über 3.414 Zeilen **gar keinen** Knopf hat. Die Haupthandlung steht im
  Menüband und heißt „Syncen"; alles in einer Zeile ist weich/outline (`--color-button-soft*`,
  `--radius-md`). ⚠️ Die Klassen `region-sync__*` gehören **Regionen UND Wegen** (`review-path-sync.js`
  schreibt `.region-sync__cand` an 15 Stellen) — wer nur eine der beiden Listen anpasst, poliert die
  kleinere Hälfte und baut die Divergenz in die größere ein.
- **Links** use `--color-link` (gold-brown), never blue; **external links**
  (off-site) always get a trailing `↗`.
- **New components:** reuse the nearest existing one as a template plus the
  tokens; match the warmth. Full guide: **`docs/design-language.md`**.
