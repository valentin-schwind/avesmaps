# Routing API Smoke Baseline

## Purpose

This document records the canonical browser smoke scenarios and baseline values for the routing API/refactoring sequence. Values are used to compare later refactoring steps for plausibility. Exact equality is not required unless a step explicitly claims no behavior change, but distances, travel times, rest times and total times should remain similar unless a documented routing-rule change is introduced.

## Core smoke scenarios

### 1. Gareth -> Tuzak

- Distance: 1256.7 Meilen
- Air distance: 808.0 Meilen
- Travel time: 163.0 Stunden / 6.8 Tage
- Rest time: 0.0 Stunden / 0.0 Tage
- Total time: 163.0 Stunden / 6.8 Tage
- Route profile: river route from Gareth via Gardel/Natter/Darpat to Perricum, then sea route to Tuzak.

### 2. Thorwal -> Perricum

- Distance: 1416.7 Meilen
- Air distance: 1026.5 Meilen
- Travel time: 287.8 Stunden / 12.0 Tage
- Rest time: 186.5 Stunden / 7.8 Tage
- Total time: 474.3 Stunden / 19.8 Tage
- Route profile: sea route to Nostria, then long land route to Gareth, then river route via Gardel/Natter/Darpat to Perricum.

### 3. Al'Anfa -> Festum with sea routes disabled

Canonical smoke target remains Al'Anfa -> Festum with sea routes disabled. If testing Al'Anfa -> Perricum as a diagnostic route, do not replace the canonical Festum scenario.

Useful diagnostic baseline from Al'Anfa -> Perricum:

- With sea route enabled:
  - Distance: 1910.2 Meilen
  - Air distance: 1249.3 Meilen
  - Travel time: 227.3 Stunden / 9.5 Tage
  - Rest time: 0.0 Stunden / 0.0 Tage
  - Total time: 227.3 Stunden / 9.5 Tage
  - Route profile: direct sea route.
- With sea route disabled:
  - Distance: 2117.0 Meilen
  - Air distance: 1249.3 Meilen
  - Travel time: 502.0 Stunden / 20.9 Tage
  - Rest time: 347.4 Stunden / 14.5 Tage
  - Total time: 849.3 Stunden / 35.4 Tage
  - Route profile: long land/river alternative via Mirham, Vinsalt, Punin, Gareth and Perricum.

### 4. Trallop -> Greifenfurt -> Honingen -> Mirham

- Distance: 2222.4 Meilen
- Air distance: 1550.9 Meilen
- Travel time: 611.5 Stunden / 25.5 Tage
- Rest time: 555.3 Stunden / 23.1 Tage
- Total time: 1166.8 Stunden / 48.6 Tage
- Route profile: multi-waypoint route with road, imperial road and river segments.
- Purpose: waypoint order, aggregation, URL state, segment selection and route-plan rendering.

### 5a. Wehrheim -> Vinsalt, fastest route

- Distance: 913.9 Meilen
- Air distance: 679.5 Meilen
- Travel time: 187.5 Stunden / 7.8 Tage
- Rest time: 106.3 Stunden / 4.4 Tage
- Total time: 293.8 Stunden / 12.2 Tage
- Route profile: imperial-road route to Punin, then long Yaquir river segment to Vinsalt.

### 5b. Wehrheim -> Vinsalt, shortest route

- Distance: 856.2 Meilen
- Air distance: 679.5 Meilen
- Travel time: 233.2 Stunden / 9.7 Tage
- Rest time: 233.2 Stunden / 9.7 Tage
- Total time: 466.4 Stunden / 19.4 Tage
- Route profile: shorter land-heavy route via Punin and western imperial roads.

## Additional transfer smoke

### 6a. Zorgan -> Punin, transfers not minimized

- Distance: 889.7 Meilen
- Air distance: 393.9 Meilen
- Travel time: 161.5 Stunden / 6.7 Tage
- Rest time: 73.3 Stunden / 3.1 Tage
- Total time: 234.8 Stunden / 9.8 Tage
- Route profile: sea route to Perricum, river route to Gareth, imperial-road/river continuation to Punin.
- Purpose: baseline for normal fastest behavior with multiple transport changes.

### 6b. Zorgan -> Punin, transfers minimized

- Distance: 798.1 Meilen
- Air distance: 393.9 Meilen
- Travel time: 230.6 Stunden / 9.6 Tage
- Rest time: 230.6 Stunden / 9.6 Tage
- Total time: 461.2 Stunden / 19.2 Tage
- Route profile: longer land-oriented route with fewer mode changes.
- Purpose: verify `minimizeTransfers` changes route selection and cost behavior.

## Additional rest-time smoke

### 7a. Fasar -> Thorwal, 12 hours rest per day

- Distance: 1630.5 Meilen
- Air distance: 1009.3 Meilen
- Travel time: 330.1 Stunden / 13.8 Tage
- Rest time: 161.9 Stunden / 6.7 Tage
- Total time: 492.0 Stunden / 20.5 Tage
- Route profile: road/way/mountain pass, Yaquir/Sewak river segments, sea route to Thorwal.

### 7b. Fasar -> Thorwal, 8 hours rest per day

- Distance: 1630.5 Meilen
- Air distance: 1009.3 Meilen
- Travel time: 330.1 Stunden / 13.8 Tage
- Rest time: 81.0 Stunden / 3.4 Tage
- Total time: 411.1 Stunden / 17.1 Tage
- Route profile: same route as 7a.
- Purpose: verify rest calculation sensitivity without changing path selection.

## Smoke pass criteria

A smoke is considered passed when:

- no JavaScript errors appear in the browser console;
- no API errors appear;
- the route is visible on the map;
- the route plan is rendered;
- distance and time values are similar to the baseline;
- shortest vs fastest and minimized vs non-minimized transfers remain meaningfully distinct;
- rest-hour changes affect rest time and total time without unexpectedly changing route geometry.
