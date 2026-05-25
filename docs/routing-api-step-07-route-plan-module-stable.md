# Routing API Step 07 - Route Plan Module Split Validation

## Checked commit

- Commit: `c388b5fa88d48d9ae0ef6d62623286f3e43c4ab3`
- Commit message: `Split route plan module`
- Validation date: 2026-05-25

## Changed files reviewed

- `index.html`
- `js/routing.js`
- `js/routing/route-plan.js`

## Boundary assessment

This commit matches the requested route-plan module split.

Observed changes:

- Added `js/routing/route-plan.js`.
- Moved route-plan and route-selection helpers from `js/routing.js` into `js/routing/route-plan.js`.
- Added the new script include in `index.html` before `js/routing.js`.
- Kept the project in global-script mode; no ES modules or build system were introduced.

Moved functions include:

- `getRouteSegmentStyle(...)`
- `getRouteEntryBounds(...)`
- `getCurrentRouteBounds(...)`
- `clearRouteDirectionMarkers(...)`
- `selectRoutePlanEntry(...)`
- `selectRoutePlanEntryForSegment(...)`
- `zoomToCurrentRoute(...)`
- `formatRoutePlanNodeName(...)`
- `buildRoutePlanEntries(...)`
- `showRoutePlan(...)`

## Runtime impact

This should be behavior-preserving, but it is a structural runtime split. Correctness depends on script order and global availability.

The script order is correct:

1. `js/routing/route-request.js`
2. `js/routing/route-result.js`
3. `js/routing/route-view-model.js`
4. `js/routing/route-plan.js`
5. `js/routing.js`

This ensures `route-plan.js` can use RouteResult/ViewModel helpers and `routing.js` can call route-plan functions later.

## Checks reported by Codex

- `node --check js/routing.js`: OK
- `node --check js/routing/route-plan.js`: OK
- duplicate check for `buildRoutePlanEntries`, `showRoutePlan`, `selectRoutePlanEntry`: OK
- `git diff`: checked by Codex
- `git status`: checked by Codex
- `rg -n "�" index.html`: no hits reported

## Validation notes

The earlier `index.html` encoding problem did not recur in this commit. The visible diff only adds the route-plan script include.

The moved code still references existing global state and helpers such as:

- `currentRouteSegmentLayers`
- `currentRoutePlanEntries`
- `selectedLocations`
- `map`
- `normalizePathSubtype(...)`
- `calculateScaledDistance(...)`
- `buildRouteResult(...)`
- `buildRoutePlanViewModel(...)`

This is expected for the current global-script architecture.

## Risk assessment

Risk is moderate-low:

- syntax checks passed;
- duplicate definitions were checked;
- script order is correct;
- no logic changes are apparent.

Remaining risk:

- a missing global dependency would only appear in the browser at runtime;
- route-plan click/selection behavior depends on moved functions remaining globally reachable.

## Smoke status

Full routing smoke is not required for this commit because the code was moved without intended behavior changes and Step 06C was already fully smoked.

A minimal browser sanity check is recommended:

1. Load the app.
2. Calculate `Gareth -> Tuzak`.
3. Confirm route plan renders.
4. Click one route-plan entry and confirm segment highlight/zoom still works.
5. Confirm no new browser console errors beyond the known territory/wiki-sync 401.

## Decision

Step 07 route-plan module split is accepted with a minimal browser sanity check recommendation. Further file splitting may continue after the sanity check or if the next step remains similarly mechanical.
