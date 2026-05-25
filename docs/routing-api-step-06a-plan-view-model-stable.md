# Routing API Step 06A - Route Plan View Model Validation

## Checked commit

- Commit: `9ebcd4a53e2e9d84866af32a5540aa6bd37d7b11`
- Commit message: `Prepare route plan view model`
- Validation date: 2026-05-25

## Changed files reviewed

- `js/routing.js`

## Boundary assessment

This commit matches the requested preparatory Step 6 boundary.

Observed change:

- Added `buildRoutePlanViewModel(routeResult, routeNames, routeLocations = [])`.
- The helper maps a prepared RouteResult into a shape close to the current route-plan UI needs:
  - `routeDescription`
  - `planEntries`
  - `summary`

## Runtime impact

No active route display path is switched to this view model yet.

The new helper is not wired into:

- `showRoutePlan(...)`
- `updateMapView(...)`
- `drawRoute(...)`
- `calculateRoute(...)`

Therefore this commit should not change visible routing behavior.

## Checks reported by Codex

- `node --check js/routing.js`: OK
- `git status` before commit reportedly showed only the expected `js/routing.js` change.
- No PHP files changed.

## Validation notes

The helper prepares the next `showRoutePlan(...)` refactor while keeping runtime behavior stable.

Important notes before the actual UI switch:

- `routeDescription` currently uses raw `routeNames`; existing `showRoutePlan(...)` uses `selectedLocations` names for the route summary. These must be compared before switching.
- `planEntries` maps `segment_ids` into `segmentIndexes`; this is correct only while the RouteResult uses index-like identifiers. If future API output uses stable segment IDs, the UI selection layer will need a separate mapping.
- `summary.totalDays` is available, but existing UI also formats travel/rest/total hours and days independently.

## Smoke status

Smoke is not required for this commit because no active routing or rendering path changed.

## Decision

Step 06A route-plan view model preparation is accepted. The next step may either add comparison-only instrumentation or switch `showRoutePlan(...)` behind a strictly equivalent adapter, but that next active UI step will require a full routing smoke.
