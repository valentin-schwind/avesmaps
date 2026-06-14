# Routing Transport Smoke Checklist

## 1. Purpose

- This checklist is for manual regression tests after routing/transport refactorings (in particular `createGraph`, `getTransportOption`, `isTransportAllowedForPath`, `getSyntheticRouteConfig`, `calculateRoute`).
- The authoritative test environment is [https://avesmaps.de/](https://avesmaps.de/) or a fully configured API environment with SQL data.
- `python -m http.server` is only enough for static UI/asset checks, not for full SQL/routing tests.

## 2. Preparation

- Open the browser console.
- Hard-reload the page (bypass the cache).
- Make sure the SQL/map data is loaded.
- After each test case, watch for new warnings/errors.
- Particularly relevant warnings:
  - `Keine Transportoption ...`
  - `Geschwindigkeit ... nicht definiert`
  - `Kein Segment gefunden fuer Verbindung ...`
  - `Keine Route ...` / empty route (if visible)

## 3. Baseline routing

Test cases:

- Compute a simple route between two known locations.
- Switch to `kuerzeste Route` (shortest route) and compute.
- Switch to `schnellste Route` (fastest route) and compute.
- After changing the options, recompute the same route.

Expected observation:

- The route is drawn.
- The leg list updates.
- No new console errors.

## 4. Minimize transfers

Test cases:

- Same route with `Umstiege minimieren` (minimize transfers) off.
- Same route with `Umstiege minimieren` on.

Expected observation:

- The route remains computable.
- A different route is acceptable.
- No additional error/warning messages.

## 5. Enable/disable transport types

Test cases:

- Land enabled/disabled.
- River enabled/disabled.
- Sea enabled/disabled.
- Combined cases:
  - land only
  - river only
  - sea only
  - land + river
  - land + sea

Expected observation:

- Routes change plausibly or are (if logical) unavailable.
- No unexpected JavaScript errors.

## 6. Switch means of transport

Test cases:

- Switch land transport (e.g. to on foot / horse / carriage, where the UI provides it).
- Switch river transport (where the UI provides it).
- Switch sea transport (where the UI provides it).

Expected observation:

- With `schnellste Route`, travel time/route may change.
- With `kuerzeste Route`, the path choice stays plausible.

## 7. Data rules from SQL

Check points:

- `allowed_transports`
- `transport_domain`
- Fallback via `getDefaultTransportDomainForPathSubtype`

Expectation:

- Paths are not used if the chosen transport is not allowed according to the data.

## 8. Special case Wüstenpfad + horseCarriage

- If a known Wüstenpfad test case exists: add concrete start/destination locations here.
- If no concrete location is known: leave it open as a TODO.

TODO:

- Document a concrete, reproducible Wüstenpfad case.

Expectation:

- `horseCarriage` must not use `Wuestenpfad`.

## 9. Synthetic Querfeldein connections

Test cases:

- Test a route that is known to be able to use a synthetic connection.
- Then disable land transport and test again.

Expected observation:

- With suitable land transport: route/segment is created.
- Without land transport: the synthetic connection is skipped or the route is unavailable.
- No warning `Kein Segment gefunden fuer Verbindung synthetic-...`.

## 10. Document after each refactoring

Use this table after each relevant commit:

| Date | Commit | Tested cases | Result | Open observations |
| --- | --- | --- | --- | --- |
| YYYY-MM-DD | abcdef0 | e.g. 3, 4, 5, 9 | OK / NOK | short note |

## 11. Relation to the general smoke test

- This detailed checklist complements the general smoke test in `docs/stabilization-smoke-test.md`.
