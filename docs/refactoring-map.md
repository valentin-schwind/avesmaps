# Refactoring Map for Avesmaps

## 1. Current Architecture

Avesmaps is currently a classic, build-free multi-script web app:

- `index.html` is the central entry point with the complete UI structure, script order and one large inline orchestration block.
- The runtime is based on global variables/functions (classic `<script>` tags, no module boundaries).
- The primary data source in the frontend is SQL via `api/map-features.php` (GeoJSON FeatureCollection + revision).
- Rendering runs through Leaflet (`L.CRS.Simple`) with separate pane layers for Wege, Regionen, labels, route, measurement, etc.
- Edit/review functions run in the same frontend as routing/search and talk to numerous PHP endpoints.
- Operation/deploy stays static plus the PHP API, without a mandatory build process.

The script load order (from `index.html`) is a central runtime contract:

1. Vendor (`leaflet.js`, `jquery`, `jquery-ui`)
2. `js/routing/route-priority-queue.js`, `js/config.js`, `js/app/utils.js`, `js/ui/popups.js`, `js/app/api-client.js`, `js/political-territory-wiki-tree.js`, `js/review/review-region-util.js`, `js/ui/ui-controls.js`, `polygon-clipping` (CDN), `js/political-territory-*.js`, `js/map-features.js`, `js/routing/routing.js`, `js/ui/spotlight-search.js`
3. Inline script with global state, map init, context menu, Dijkstra/graph/smoothing helpers

## 2. Responsibility Clusters

### App initialization

- `index.html` (DOM structure, script order, map init, pane setup, global runtime variables)
- `js/config.js` (runtime configuration, endpoints, tile styles, default states)
- `js/routing/routing.js` (initial data load + start of the frontend pipeline)

### Map logic

- `js/map-features.js` (layer construction, render and visibility logic, live-update application)
- `js/config.js` (layer/zoom-related defaults, region-visibility patch)
- `index.html` (Leaflet map/pane initialization)

### Data loading

- `js/routing/routing.js` (`loadRouteDataFromApi`, initial load, polling)
- `js/app/api-client.js` (fetch wrapper for Edit/Review/WikiSync/Political)
- `api/map-features.php` (FeatureCollection + revision, optional `since_revision`/`bbox`)
- `api/political-territories.php` (`action=layer|list|get|...`)

### Routing

- `index.html` (Dijkstra/graph construction, smoothing helpers, synthetic connections)
- `js/routing/routing.js` (route segments, plan entries, marker highlighting, remaining times)
- `js/routing/route-priority-queue.js` (min-heap)

### Routing UI

- `index.html` (routing controls/sidebar elements)
- `js/routing/routing.js` (waypoint input, button handlers, route-plan rendering)
- `css/styles.css` (route-plan/waypoint styles)

### Popups

- `js/ui/popups.js` (popup markup builder)
- `js/map-features.js` (popup bindings/refresh on layers)
- `js/routing/routing.js` (popup action delegation)

### Search

- `js/ui/spotlight-search.js` (spotlight overlay, local + API search, focus logic)
- `api/map-search.php` (backend search index over `map_features`)
- `index.html` (spotlight DOM)

### Measurement tools

- `js/ui/ui-controls.js` (distance measurement, handles, label, clear/complete)
- `index.html` (context-menu actions + click routing)

### URL sharing

- `js/map-features.js` (`applyPlannerStateFromUrl`, `syncPlannerStateToUrl`, pin handling)
- `js/ui/ui-controls.js` (Review/WikiSync tab URL parameters)
- `index.html` (share-pin context action)

### Edit mode

- `js/map-features.js` (create/move/update/delete for places, Wege, Regionen, labels, Kraftlinien)
- `js/review/review-region-util.js` (edit dialogs, payload building, submit handlers)
- `js/map-features/map-features-region-vertex-detach-edit.js` (region-vertex special interaction)
- `js/political-territory-editor-link.js`, `js/political-territory-drag-assignment.js`, `js/political-territory-override-footer.js`
- `api/map-feature-update.php`, `api/political-territories.php`, `api/political-territory-subtree-display.php`, `api/political-territory-display-overrides.php`, `api/political-territory-assignment-zoom-sync.php`

### Review/Admin

- `js/review/review-region-util.js` (review panel, change log, presence, WikiSync case UI)
- `api/location-report-review.php` (report review)
- `api/map-audit-log.php` (change history + undo metadata)
- `api/editor-presence.php` (heartbeat/online list)
- `api/auth.php` (session/roles/capabilities)
- `admin/index.php` (admin UI entry)

### API/PHP

- Core: `api/bootstrap.php`, `api/auth.php`
- Public read: `api/map-features.php`, `api/map-search.php`, `api/report-location.php`
- Edit write: `api/map-feature-update.php`
- Political territory domain: `api/political-territories.php`, `api/political-territory-lib.php`, `api/political-territory-assignment.php`, `api/political-territory-wiki.php`, `api/political-territory-subtree-display.php`, `api/political-territory-display-overrides.php`
- WikiSync: `api/wiki-sync.php`, `api/wiki-sync-locations.php`, `api/wiki-sync-territories.php`, `api/wiki-sync-*.php`
- Special cases/tools: `api/wiki-proxy.php`, `api/wiki-dom-sync.php`, `api/wiki-dom-sync-source.php`

### Data/build tools

- `tools/build_tiles.py` (tile pyramid from a raster source)
- `tools/smoke_test.py` (read-only deployment/API smoke test)
- `sql/*.sql` (schema/migrations, among others political territories)
- `docs/*.md` (architecture/operations knowledge)

### Deployment

- `.github/workflows/deploy-avesmaps-strato.yml` (SFTP deploy to STRATO)
- Bundles static assets + `api/` together; no mandatory build step.

## 3. Risky Areas

1. `index.html`
- Very large inline script block with global state + initialization + routing core logic.
- Strong order dependency on externally loaded files.
- Hard to test in isolation, because DOM, map and business logic are directly coupled.

2. `js/map-features.js` (6492 lines, 335 functions)
- Mixes rendering, edit workflows, URL sync, timeline, layer lifecycle, region operations.
- High coupling to global state (`regionData`, `pathData`, `activeRegionGeometryEdit`, etc.).
- A single bug can affect multiple domains at once (route, edit, timeline, popups).

3. `js/review/review-region-util.js` (6256 lines, 271 functions)
- Combines a great many dialog/review/WikiSync/presence/edit-submit responsibilities.
- Many mutual dependencies on global runtime variables.
- Regressions are hard to localize.

4. `js/routing/routing.js`
- Contains not only routing, but also data bootstrap, event delegation, context-menu actions, review actions.
- "Side effects at load time" (top-level `routeDataRequest` + binding).

5. `js/config.js`
- Mixes configuration with runtime patches (`window.fetch` override, `window.syncRegionVisibility` override).
- Monkey patches are hard to follow and risky for later refactoring.

6. Large API monoliths
- `api/political-territories.php` (~5260 lines) and `api/map-feature-update.php` (~2235 lines) bundle many actions in a single file.
- High branching overhead, low local testability of individual actions.

7. Wiki-DOM-sync complexity
- `api/wiki-dom-sync.php` generates patched temporary PHP files at runtime from `wiki-dom-sync-source.php`.
- Harder to debug/audit than direct, static endpoint files.

## 4. Global State Map

Important global state groups and the modules that depend on them:

### Data stores

- `locationData`, `pathData`, `powerlineData`, `labelData`, `regionData`
- Used in: `index.html`, `js/map-features.js`, `js/routing/routing.js`, `js/ui/spotlight-search.js`, partly `js/config.js`

### Leaflet layers / visual caches

- `locationMarkers`, `locationNameLabels`, `pathLayers`, `powerlineLayers`, `labelMarkers`, `regionPolygons`, `regionLabels`
- Used in: primarily `js/map-features.js`, additionally `js/routing/routing.js`, `js/ui/spotlight-search.js`, `js/config.js`

### Routing/planner state

- `graphData`, `selectedLocations`, `invalidLocationInputs`, `currentRouteLayer`, `currentRouteSegmentLayers`, `activeTooltips`
- Used in: `index.html` (Dijkstra/graph), `js/routing/routing.js`, `js/map-features.js`

### Share/URL/context

- `sharePinCoordinates`, `sharePinMarker`, `pendingContextMenuLatLng`
- Used in: `js/map-features.js`, `index.html`, `js/routing/routing.js`

### Review/WikiSync state

- `reviewReports`, `changeLogEntries`, `wikiSyncCases`, `wikiSyncSummary`, `wikiSyncTerritorySummary`, `activeWikiSync*`
- Used in: mainly `js/review/review-region-util.js`, partly `js/routing/routing.js`, `index.html`

### Edit-session state

- `activeLocationEdit`, `pendingPathCreation*`, `pathEditFeature`, `powerlineEditFeature`, `labelEditEntry`, `regionEditEntry`, `activeRegionGeometryEdit`, `pendingRegionOperation`
- Used in: `js/map-features.js`, `js/review/review-region-util.js`, `js/map-features/map-features-region-vertex-detach-edit.js`, `index.html`

### Live update/presence

- `mapDataSourceStatus`, `liveMapUpdateTimerId`, `editorPresenceTimerId`, `activeFeatureLocks`
- Used in: `js/routing/routing.js`, `js/review/review-region-util.js`, `js/map-features.js`, `index.html`

### Measurement

- `distanceMeasurementStartLatLng`, `distanceMeasurementEndLatLng`, `isAwaitingDistanceMeasurementEnd` (+ handle/line/label variables)
- Used in: `js/ui/ui-controls.js`, `index.html`

### Political territory runtime

- `politicalTerritoryOptions`, `politicalTerritoryHierarchy`, `politicalTimelineYear`, `politicalTerritoryFallbackData`
- Used in: `js/map-features.js`, `js/review/review-region-util.js`, `index.html`

## 5. Data Flow

### Primary production path

1. SQL tables (`map_features`, `map_revision`, `political_territory*`, `map_reports`, `map_audit_log`, `wiki_sync*`) are the operational source.
2. The frontend loads `api/map-features.php` (FeatureCollection + revision).
3. `js/routing/routing.js` distributes features to:
- `prepareLocationData`
- `preparePowerlineData`
- `preparePathData`
- `prepareRegionData`
- `prepareLabelData`
4. `js/map-features.js` builds Leaflet layers from them (markers, polylines, polygons, tooltips/labels).
5. Functional areas work on top of that:
- Routing (`index.html` Dijkstra + `js/routing/routing.js` UI/plan)
- Popups/interactions (`js/ui/popups.js`, `js/routing/routing.js` delegation)
- Search (`js/ui/spotlight-search.js`, optionally the backend via `api/map-search.php`)
- Edit mode (`js/review/review-region-util.js` + `js/map-features.js` -> `api/map-feature-update.php` / `api/political-territories.php`)

### Live-edit loop

1. Mutations go via `js/app/api-client.js` to PHP endpoints.
2. The API writes SQL + audit + revision.
3. The frontend updates locally from the response (`apply*FeatureResponse`) and periodically via `since_revision` polling (`pollLiveMapUpdates`).

### SVG/GeoJSON context

- Historically and tooling-wise, SVG/GeoJSON is still relevant (see `docs/future-map-architecture.md`, `docs/territories.md`).
- In the current runtime path, SQL/API is the primary data source; SVG/GeoJSON is more of an import/migration context.

## 6. Proposed Target Boundaries

Target boundaries without a framework or build migration:

1. Bootstrap Boundary
- A lean entry point (`map boot + wiring`) instead of large inline logic in `index.html`.

2. State Boundary
- A central, explicit runtime state container (instead of scattered implicit globals), still globally available in the browser.

3. Domain Boundaries in the frontend
- `routing-domain` (graph + route calculation + route UI)
- `feature-rendering-domain` (Locations/Paths/Powerlines/Labels/Regions)
- `editor-domain` (dialogs + submit + locking)
- `review-wikisync-domain` (review panel, presence, WikiSync)

4. API Boundary
- Endpoint files stay build-free, but action handlers are gradually extracted into small include files (one per action/use case).

5. Integration Boundary
- Move the monkey patches (`window.fetch`, `window.syncRegionVisibility`) into clearly named integration modules and document them.

## 7. First Three Safe Refactoring Steps

### Step 1: Extract global state from the inline script

- Goal: move only the large `let ...` state declaration into a new file `js/app/runtime-state.js`.
- Affected files: `index.html`, `js/app/runtime-state.js`.
- Behavior: unchanged, only the place of initialization changes.
- Testability: load the page, check the console, call core functions.
- Reversible: remove the script tag + move the block back into `index.html`.

### Step 2: Extract the Dijkstra/graph helpers from `index.html`

- Goal: move `calculateRoute`, `createGraph`, smoothing helpers into `js/routing/route-graph-core.js`.
- Affected files: `index.html`, `js/routing/route-graph-core.js`.
- Behavior: unchanged, same function signatures/globally available.
- Testability: multi-point route, transport options, "minimize transfers".
- Reversible: remove the new script, copy the old inline functions back.

### Step 3: Encapsulate the routing bindings in `js/routing/routing.js`

- Goal: bundle the top-level event bindings and start sequence into `initializeRoutingRuntime()`, called once.
- Affected files: `js/routing/routing.js` (optionally a small call site in `index.html` if needed).
- Behavior: unchanged, but a clearer entry point and fewer implicit side effects.
- Testability: add/remove/sort waypoints, calculate a route, popup actions.
- Reversible: dissolve the wrapper, restore the previous top-level calls.

## 8. Smoke Test Checklist

Check manually after every refactoring commit:

1. `index.html` loads without JavaScript errors in the browser console.
2. The base map appears, zoom/pan work.
3. Switching layer mode (`Nur Karte`/`Regionen`/`Politisch`/`Kraftlinien`) works.
4. Set two existing places as waypoints and calculate a route.
5. Change transport options and recalculate the route.
6. Open the context menu, run "Stelle markieren und teilen", the URL contains `pin=` and a reload keeps the marker.
7. Open the spotlight search, select a result, the map focuses correctly.
8. Start a distance measurement, set the endpoint, clear it.
9. If edit access is available: the review panel loads reports/changes/presence.
10. If edit access is available: create a temporary place, move it, delete it; the change log updates.
11. If edit access is available: select a region and open/close the properties dialog.
12. Optional deploy safety: run `tools/smoke_test.py` against the target environment.
