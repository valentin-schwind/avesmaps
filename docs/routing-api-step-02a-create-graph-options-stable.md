# Routing API Step 02A - Create Graph Route Options Validation

## Checked commit

- Commit: `0e59cda3057d453ed86a4b51dcbc6a9cff4df7b1`
- Commit message: `Decouple createGraph route options from DOM fallback`
- Validation date: 2026-05-25

## Changed files reviewed

- `index.html`
- `js/routing.js`
- `docs/routing-api-implementation-status.md`

## Boundary assessment

This commit matches the planned Route Options / createGraph boundary.

Observed changes:

- `updateMapView()` now builds `routeOptions` explicitly via `buildRouteOptionsFromPlannerControls()`.
- `createGraph(routeOptions)` no longer has an implicit default DOM fallback.
- `addRegularPathToGraph(...)`, `connectDetachedGraphComponents(...)`, and `getSyntheticRouteConfig(...)` receive route options through the graph-building path.
- `getTransportOption(routeType)` remains as compatibility wrapper for older UI-near callers.
- `getTransportOptionForRouteType(routeType, routeOptions)` no longer reads DOM controls implicitly when no options are provided.

This advances the intended boundary: graph construction is no longer responsible for obtaining planner UI state by itself.

## Checks reported by Codex

- `node --check js/routing.js`: OK
- No PHP files changed.

## Validation notes

The code diff is small and consistent with the existing no-ES-module, global-script architecture.

The remaining intentional coupling is still present in `calculateRoute(...)`, which reads `#minimizeTransfers` and passes `getTransportOption` to `calculateRouteCore(...)`. This is acceptable for Step 02A and should be handled in a later RouteRequest/RouteResult step.

## Risk assessment

Primary risks:

- Missing or incomplete `routeOptions` will now cause transport options to resolve to `null`, which can filter paths from the graph.
- Future callers of `createGraph(...)` must pass explicit route options.
- Synthetic route creation now depends on the same explicit options path and therefore needs smoke coverage.

No obvious structural blocker was found in this commit.

## Smoke status

Smoke is required before continuing with the next behavior-sensitive step.

Use the canonical routing smoke set:

1. `Gareth -> Tuzak`
2. `Thorwal -> Perricum`
3. `Al’Anfa -> Festum` with sea routes disabled / no ship
4. `Trallop -> Greifenfurt -> Honingen -> Mirham`
5. `Wehrheim -> Vinsalt`, fastest route
6. `Wehrheim -> Vinsalt`, shortest route

For each route, record:

- distance
- travel time
- rest time
- total time
- visible route/rendering anomalies
- route-plan anomalies
- browser console errors or warnings

## Correction to Codex smoke text

Codex reported route 3 as `Al'Anfa -> Perricum`. The canonical route is `Al’Anfa -> Festum` with sea routes disabled.

## Decision

Step 02A is accepted for browser smoke testing. Do not proceed to the next routing refactor step until the smoke values are reviewed.
