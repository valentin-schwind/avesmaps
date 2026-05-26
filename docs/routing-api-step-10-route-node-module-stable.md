# Routing API Step 10 - Route Node Helper Split Validation

## Checked commit

- Commit: `65c007dbdf42cd2a85ef16bd73f95a0505ab198a`
- Commit message: `Split route node helpers`
- Validation date: 2026-05-25

## Changed files reviewed

- `index.html`
- `js/routing/routing.js`
- `js/routing/route-node.js`

## Boundary assessment

This commit mechanically moves route-node helper functions from `js/routing/routing.js` into `js/routing/route-node.js`.

Moved functions:

- `resolveRouteNodeLocation(...)`
- `getRouteNodeDisplayName(...)`
- `getRoutePathDisplayName(...)`
- `shouldShowRoutePathDisplayName(...)`

No intended route logic changes are apparent.

## Runtime impact

The split should be behavior-preserving because the functions remain globally declared classic script functions.

However, the current script order is semantically suboptimal:

1. `js/routing/route-request.js`
2. `js/routing/route-result.js`
3. `js/routing/route-view-model.js`
4. `js/routing/route-plan.js`
5. `js/routing/route-engine.js`
6. `js/routing/route-render.js`
7. `js/routing/route-node.js`
8. `js/routing/routing.js`

`route-plan.js` references `getRouteNodeDisplayName(...)` and `shouldShowRoutePathDisplayName(...)` inside `buildRoutePlanEntries(...)`.

`route-render.js` references `resolveRouteNodeLocation(...)` inside `highlightRouteLocations(...)`.

Because these references happen when the functions are executed, not when they are parsed, the current order can still work as long as none of those functions run before `route-node.js` has loaded. But for dependency clarity and future safety, `route-node.js` should be loaded before `route-plan.js` and `route-render.js`.

## Checks reported by Codex

- `node --check js/routing/routing.js`: OK
- `node --check js/routing/route-node.js`: OK
- duplicate check for `resolveRouteNodeLocation`, `getRouteNodeDisplayName`, `shouldShowRoutePathDisplayName`: OK
- `git diff`: checked by Codex
- `git status`: checked by Codex
- `rg -n "�" index.html`: no hits reported

## Validation notes

No unintended `index.html` encoding change is visible in the diff.

The moved code still depends on global helpers/state such as:

- `normalizeLocationSearchName(...)`
- `locationData`
- `findLocationMarkerByName(...)`
- `isCrossingLocation(...)`
- `getLocationAtPathEndpoint(...)`
- `normalizeNodeName(...)`
- `normalizePathSubtype(...)`

This is expected in the current global-script architecture.

## Risk assessment

Risk is moderate-low but not zero:

- the move is mechanical;
- syntax checks passed;
- duplicate checks passed;
- script order works under current execution timing;
- dependency order should still be corrected to make future refactors safer.

## Smoke status

Full routing smoke is not required for this mechanical split.

A minimal browser sanity check is recommended after the dependency-order correction:

1. Load the app.
2. Calculate `Gareth -> Tuzak`.
3. Confirm route is drawn.
4. Confirm route plan renders.
5. Click one route segment and confirm the matching route-plan entry becomes active.
6. Confirm no new browser console errors beyond the known territory/wiki-sync 401.

## Decision

Step 10 route-node helper split is accepted as a mechanical move, but the next commit should reorder the routing scripts so `route-node.js` is loaded before modules that reference it.
