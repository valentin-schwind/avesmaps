# Routing API Step 03 - Speed Resolver Validation

## Checked commit

- Commit: `ced44ad3136df561ea3cddeb14b0ff6c427d8989`
- Commit message: `Extract route speed resolver`
- Validation date: 2026-05-25

## Changed files reviewed

- `index.html`
- `js/routing/routing.js`

## Boundary assessment

This commit matches the transport-rule boundary documented in `docs/routing-transport-rule-boundary.md`.

Observed changes:

- Added `resolveSpeedForRouteType(routeType, transportOption)` in `js/routing/routing.js`.
- The helper returns exactly `SPEED_TABLE[transportOption]?.[routeType]`.
- Replaced the direct `SPEED_TABLE` access in `getSyntheticRouteConfig(...)` with the helper.
- Replaced the direct `SPEED_TABLE` access in `addRegularPathToGraph(...)` with the helper.
- No speed values, transport domains, allowed-transport rules, route weights or UI behavior were intentionally changed.

## Checks reported by Codex

- `node --check js/routing/routing.js`: OK
- No PHP files changed.

## Validation notes

The diff is minimal and consistent with the planned Step 3 preparation. The helper is still global-script compatible and does not introduce ES modules or build-time assumptions.

The commit centralizes speed lookup without yet moving `SPEED_TABLE` or changing the route graph algorithm. This is the right granularity for the current refactoring phase.

## Risk assessment

Primary risks:

- If the helper receives parameters in the wrong order, path speeds resolve to `undefined` and graph edges are skipped.
- Synthetic route creation depends on the same helper and therefore needs smoke coverage.
- Because speed lookup directly affects route weights, a full routing smoke remains required even though the intended behavior is unchanged.

No structural blocker was found in this commit.

## Smoke status

Smoke is required before continuing with the next behavior-sensitive routing step.

Use `docs/routing-api-smoke-baseline.md` as the reference.

Required scenarios:

1. `Gareth -> Tuzak`
2. `Thorwal -> Perricum`
3. `Al’Anfa -> Festum` with sea routes disabled / no ship
4. `Trallop -> Greifenfurt -> Honingen -> Mirham`
5. `Wehrheim -> Vinsalt`, fastest route
6. `Wehrheim -> Vinsalt`, shortest route
7. `Zorgan -> Punin`, transfers not minimized
8. `Zorgan -> Punin`, transfers minimized
9. `Fasar -> Thorwal`, 12 hours rest per day
10. `Fasar -> Thorwal`, 8 hours rest per day

For each route, record:

- distance
- travel time
- rest time
- total time
- visible route/rendering anomalies
- route-plan anomalies
- browser console errors or warnings

## Decision

Step 03 speed resolver extraction is accepted for browser smoke testing. Do not continue with RouteRequest/RouteResult work until the smoke values are reviewed.
