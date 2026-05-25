# Routing API Step 09 - Route Render Module Split Validation

## Checked commit

- Commit: `d90a0f1a5903ef6cafa7cde13199effc4a8ad62b`
- Commit message: `Split route render module`
- Validation date: 2026-05-25

## Changed files reviewed

- `index.html`
- `js/routing.js`
- `js/routing/route-render.js`

## Boundary assessment

This commit matches the requested route-render module split.

Observed changes:

- Added `js/routing/route-render.js`.
- Moved route rendering/highlighting helpers from `js/routing.js` into `js/routing/route-render.js`.
- Added the new script include in `index.html` before `js/routing.js`.
- Kept global-script architecture; no ES modules or build system were introduced.

Moved functions include:

- `createRouteNodeMarkersForSegment(...)`
- `drawRoute(...)`
- `logRoutePoints(...)`
- `highlightRouteLocations(...)`
- `removeHighlightedRouteNodes(...)`

## Runtime impact

This should be behavior-preserving. Correctness depends on script order and global availability.

The script order is correct:

1. `js/routing/route-request.js`
2. `js/routing/route-result.js`
3. `js/routing/route-view-model.js`
4. `js/routing/route-plan.js`
5. `js/routing/route-engine.js`
6. `js/routing/route-render.js`
7. `js/routing.js`

This ensures `routing.js` can call the moved render helpers.

## Checks reported by Codex

- `node --check js/routing.js`: OK
- `node --check js/routing/route-render.js`: OK
- duplicate check for `drawRoute`, `highlightRouteLocations`, `removeHighlightedRouteNodes`: OK
- `git diff`: checked by Codex
- `git status`: checked by Codex
- `rg -n "�" index.html`: no hits reported

## Validation notes

No unintended `index.html` encoding change is visible in the diff.

The move is mechanical. No changes to `createGraph(...)`, `calculateRoute(...)`, or `updateMapView(...)` are apparent in this commit.

Important dependency note:

- `route-render.js` uses `clearRouteDirectionMarkers(...)`, `getRouteSegmentStyle(...)`, and `selectRoutePlanEntryForSegment(...)` from `route-plan.js`.
- Therefore `route-plan.js` must remain loaded before `route-render.js` unless these dependencies are moved again later.

## Risk assessment

Risk is moderate-low:

- syntax checks passed;
- duplicate definitions were checked;
- script order is correct;
- no logic changes are apparent.

Remaining risk:

- missing globals or script-order mistakes would surface only in the browser;
- route layer creation and route-plan entry selection should be sanity-checked after this split.

## Smoke status

Full routing smoke is not required for this commit because the code was moved without intended behavior changes and Step 06C was already fully smoked.

A minimal browser sanity check is recommended:

1. Load the app.
2. Calculate `Gareth -> Tuzak`.
3. Confirm route is drawn.
4. Confirm route plan renders.
5. Click one route segment on the map and confirm the matching route-plan entry becomes active.
6. Click one route-plan entry and confirm segment highlight/zoom still works.
7. Confirm no new browser console errors beyond the known territory/wiki-sync 401.

## Decision

Step 09 route-render module split is accepted with a minimal browser sanity check recommendation. Further structural splitting may continue if it remains mechanical and keeps `master` deployable.
