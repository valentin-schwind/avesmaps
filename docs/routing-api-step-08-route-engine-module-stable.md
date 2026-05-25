# Routing API Step 08 - Route Engine Helper Split Validation

## Checked commit

- Commit: `d39c995ca264198e1b2ffeb5723035ad60f3b295`
- Commit message: `Split route engine helpers`
- Validation date: 2026-05-25

## Changed files reviewed

- `index.html`
- `js/routing.js`
- `js/routing/route-engine.js`

## Boundary assessment

This commit matches the requested route-engine helper split.

Observed changes:

- Added `js/routing/route-engine.js`.
- Moved selected engine/planner helpers from `js/routing.js` into `js/routing/route-engine.js`.
- Added the new script include in `index.html` before `js/routing.js`.
- Kept global-script architecture; no ES modules or build system were introduced.

Moved functions include:

- `getRouteSegments(...)`
- `getTransportOption(...)`
- `isTransportAllowedForPath(...)`
- `applyRestTimes(...)`
- `buildRouteResultFromSelectedLocations(...)`

## Runtime impact

This should be behavior-preserving. Correctness depends on script order and global availability.

The script order is correct:

1. `js/routing/route-request.js`
2. `js/routing/route-result.js`
3. `js/routing/route-view-model.js`
4. `js/routing/route-plan.js`
5. `js/routing/route-engine.js`
6. `js/routing.js`

This ensures `routing.js` can still call the moved helpers.

## Checks reported by Codex

- `node --check js/routing.js`: OK
- `node --check js/routing/route-engine.js`: OK
- duplicate check for `getRouteSegments`, `buildRouteResultFromSelectedLocations`, `getTransportOption`: OK
- `git diff`: checked by Codex
- `git status`: checked by Codex
- `rg -n "�" index.html`: no hits reported

## Validation notes

No unintended `index.html` encoding change is visible in the diff.

The move is mechanical. No changes to `createGraph(...)`, `calculateRoute(...)`, `drawRoute(...)`, or `updateMapView(...)` are apparent in this commit.

Important note:

- `applyRestTimes(...)` still reads DOM via `#includeRests` and `#restHours`. This is pre-existing behavior and was only moved. It remains a candidate for later RouteRequest cleanup, but it is not a blocker for this split.

## Risk assessment

Risk is moderate-low:

- syntax checks passed;
- duplicate definitions were checked;
- script order is correct;
- no logic changes are apparent.

Remaining risk:

- missing globals or script-order mistakes would surface only in the browser;
- `getTransportOption(...)` remains a UI-bound compatibility wrapper and should not migrate into server-side API logic later.

## Smoke status

Full routing smoke is not required for this commit because the code was moved without intended behavior changes and Step 06C was already fully smoked.

A minimal browser sanity check is recommended:

1. Load the app.
2. Calculate `Gareth -> Tuzak`.
3. Confirm route plan renders.
4. Click one route-plan entry and confirm segment highlight/zoom still works.
5. Confirm no new browser console errors beyond the known territory/wiki-sync 401.

## Decision

Step 08 route-engine helper split is accepted with a minimal browser sanity check recommendation. Further structural splitting may continue if it remains mechanical and keeps `master` deployable.
