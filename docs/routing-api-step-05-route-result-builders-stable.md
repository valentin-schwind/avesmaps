# Routing API Step 05 - Route Result Builders Validation

## Checked commit

- Commit: `18274cd56d5f36faebdf7ef7af6fca58a40a5c69`
- Commit message: `Prepare route result builders`
- Validation date: 2026-05-25

## Changed files reviewed

- `js/routing.js`
- `docs/routing-api-implementation-status.md`

## Boundary assessment

This commit matches the planned preparatory RouteResult boundary.

Observed changes:

- Added `buildRouteSteps(routeNames, segments, options = {})`.
- Added `buildRouteSummary(routeLocations, routeSteps, options = {})`.
- Updated `docs/routing-api-implementation-status.md`.
- No active runtime routing, rendering or planner path was switched to these builders.

## Runtime impact

No runtime route calculation path was changed in this commit.

The new functions are currently preparatory. They are not yet wired into:

- `updateMapView(...)`
- `drawRoute(...)`
- `showRoutePlan(...)`
- `calculateRoute(...)`

Therefore the commit should not alter routing, rendering, aggregation, rest-time calculation, transfer behavior or URL sharing.

## Checks reported by Codex

- `node --check js/routing.js`: OK
- No PHP files changed.

## Validation notes

The introduced builders mirror the current route-plan aggregation direction without changing the displayed route plan.

Important semantic notes for the next step:

- `transport: entry.type` is a placeholder, not yet a real transport option such as `groupFoot`, `riverSailer` or `cargoShip`.
- `transfers: Math.max(safeRouteSteps.length - 1, 0)` currently counts step boundaries, not actual transport-mode changes.
- Before the RouteResult is used as API contract, transfer counting should be revised to count transport changes or documented explicitly as step count.
- Rest-time logic duplicates the current `showRoutePlan(...)` behavior for land segments and intentionally excludes `Seeweg` and `Flussweg`.

## Risk assessment

Current risk is low because the functions are not yet used by runtime routing.

Future risks when wiring the builders into UI/API:

- route-plan totals must remain equal to the current `showRoutePlan(...)` output;
- rest-time semantics must match the existing GUI exactly;
- route-step field names should be aligned with the API contract before PHP implementation;
- actual transport mode and transfer counting need one more refinement before API publication.

## Smoke status

Smoke is not required for this commit because no active routing path changed.

## Decision

Step 05 preparatory RouteResult builders are accepted as a staging step. Do not switch `showRoutePlan(...)` to these builders until the semantic placeholder fields are either corrected or explicitly isolated from UI output.
