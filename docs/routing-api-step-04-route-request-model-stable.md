# Routing API Step 04 - Route Request Model Validation

## Checked commit

- Commit: `92817a50ebc82ab8c0ede28cbb4161bcc848a3f4`
- Commit message: `Prepare route request model`
- Validation date: 2026-05-25

## Changed files reviewed

- `js/routing.js`

## Boundary assessment

This commit matches the planned preparatory RouteRequest boundary.

Observed changes:

- Added `normalizeRouteRequest(request)`.
- Added `buildRouteRequestFromPlannerState()`.
- The request model contains:
  - `from`
  - `to`
  - `via`
  - `optimize`
  - `include_air_distance`
  - `include_geometry`
  - `include_steps`
  - `include_rests`
  - `rest_hours_per_day`
  - `minimize_transfers`
  - `transports.land`
  - `transports.river`
  - `transports.sea`
  - `transports.synthetic`

## Runtime impact

No runtime route calculation path was changed in this commit.

The new functions are currently preparatory. They are not yet wired into:

- `updateMapView(...)`
- `createGraph(...)`
- `calculateRoute(...)`
- `showRoutePlan(...)`

Therefore the commit should not alter routing, rendering, aggregation, rest-time calculation, transfer behavior or URL sharing.

## Checks reported by Codex

- `node --check js/routing.js`: OK
- No PHP files changed.

## Validation notes

The function `normalizeRouteRequest(...)` provides a stable normalized shape for later API and browser routing work.

`buildRouteRequestFromPlannerState()` still reads UI state, which is acceptable at this boundary because it is explicitly a browser/planner adapter. The important separation is that the normalized request can later be passed into route-building code without directly reading DOM controls inside the core route path.

The commit did not update `docs/routing-api-implementation-status.md`. This is acceptable for this validation pass because the present document records the checked state, but future Codex steps should continue updating the implementation-status document as instructed.

## Risk assessment

Current risk is low because the functions are not yet used by runtime routing.

Future risks when wiring the model into route execution:

- the `transports` object uses the API-oriented nested shape, while existing graph code currently expects the flatter routeOptions shape (`allowLand`, `landOption`, etc.);
- `include_rests` and `rest_hours_per_day` must remain consistent with current UI rest-time semantics;
- `optimize` must map exactly to the existing fastest/shortest controls;
- `synthetic` currently mirrors land transport in the planner adapter, which is reasonable but must remain explicit when PHP is introduced.

## Smoke status

Smoke is not required for this commit because no active routing path changed.

## Decision

Step 04 route request model preparation is accepted. The next code step may begin RouteResult preparation, but should remain preparatory unless a smoke is planned.
