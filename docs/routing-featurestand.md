# Routing feature status

Status: 2026-05-25

This document describes the current routing status of Avesmaps after the switch to server-side route computation with client-side map display.

## Target state

Normal route planning is to be computed server-side. The frontend then displays the server route using the local map segments, so that rendering, highlighting, tooltips and the route plan continue to match the Leaflet/GeoJSON map logic.

The old client router is kept as a reference and fallback.

## Relevant URLs

```text
https://avesmaps.de/?route=Gareth&route=Tuzak
```

Normal mode. The route is computed by the server and displayed in the frontend.

```text
https://avesmaps.de/?clientrouting=1&route=Gareth&route=Tuzak
```

Client fallback. The route is computed entirely in the browser with the old client logic.

```text
https://avesmaps.de/?serverrouting=1&route=Gareth&route=Tuzak
```

Server mode with debug output. The displayed route comes from the server. In addition, diagnostic information is printed to the browser console.

```text
https://avesmaps.de/?serverrouting=1&clientrouting=1&route=Gareth&route=Tuzak
```

Client display with server comparison. The map shows the client route, while the server route runs along as a probe/diagnostic.

## URL state

The technical routing flags are preserved when synchronizing the planner state:

- `serverrouting=1`
- `clientrouting=1`

This means a URL like `?clientrouting=1&route=Gareth&route=Tuzak` no longer automatically falls back to the normal server URL.

## Server route in the frontend

The server returns a route via `api/route.php`. The frontend converts the server response into local display objects.

The adapter robustly resolves server segments against local `pathData`. Supported segment IDs are:

- `edge_id`
- `path_id`
- `id`
- `feature_id`
- `public_id`

The visible node list for the plan display is built preferentially from segment data:

- `from_node`
- `to_node`

`debug.node_ids` only serves as a fallback now. It is useful for diagnostics, but not the primary source for visible route-plan labels.

Explicit leg endpoints are set hard in server mode. For a URL like:

```text
?route=Gareth&route=Tuzak&route=Paavi
```

the visible sub-segments are logically:

- Gareth -> Tuzak
- Tuzak -> Paavi

These waypoints must not be replaced by nearby harbors, markers or debug nodes.

## Route-plan display

The route-plan display aggregates contiguous water segments without swallowing important stops.

### Markers and Kreuzungen

Internal markers/Kreuzungen on rivers and sea routes are not visible segment boundaries. They are skipped in the plan view as long as no real location, explicit waypoint or transport change is reached.

Failure mode to be avoided:

```text
Flussweg über Natter (...) von Markierung bis Markierung
```

or:

```text
Flussweg über Gardel (...) von Rindsfurt bis Rindsfurt
```

### Rivers

Contiguous Flussweg segments are aggregated across internal markers. When the river name changes, the names are collected and displayed together.

Example:

```text
Flussweg über Gardel, Natter, Darpat (...) von Rindsfurt bis Perricum ...
```

So the different river names stay visible, but the purely technical intermediate markers do not produce their own plan rows.

### Sea routes and harbors

Sea routes are likewise aggregated across internal markers. But real harbors and explicit waypoints must not be swallowed.

Example with the explicit waypoint `Tuzak`:

```text
https://avesmaps.de/?route=Gareth&route=Tuzak&route=Paavi
```

The Seeweg must not appear as a single segment:

```text
Seeweg (...) von Perricum bis Neersand
```

Instead, `Tuzak` must stay visible:

```text
Seeweg (...) von Perricum bis Tuzak
Seeweg (...) von Tuzak bis Neersand
```

### Transport change

A change of means of transport is a hard segment boundary. When the means of transport changes, a new route-plan entry is created, even if both segments are fundamentally water segments.

## Debug output

With `serverrouting=1` the diagnostic output stays active in the console. Relevant log lines include:

```text
Server-Routing-Probe Vergleich
Server-Routing-Probe Paritaet
Server-Routing-Probe Fehlende Client-Segmente
Server-Routing-Probe Fehlende Client-Segmente JSON
Server-Routing-Probe Server-IDs
Server-Routing-Probe Server-Segmente
Server-Routing-Probe Ergebnis
```

The debug mode is meant to help when comparing the client and server routes, without changing the normal map display for users.

## Important commits

- `5fc403c` - Preserve routing mode URL flags
- `a4ec7e1` - Show hidden route crossings as markers
- `911636a` - Aggregate water route plan labels
- `5c7083a` - Resolve server route display fallbacks
- `ae71df9` - Keep route waypoints in water plan
- `dc74da0` - Stabilize server route display nodes

## Current test status

Reference routes tested during development:

```text
https://avesmaps.de/?route=Gareth&route=Tuzak
https://avesmaps.de/?clientrouting=1&route=Gareth&route=Tuzak
https://avesmaps.de/?route=Gareth&route=Tuzak&route=Paavi
https://avesmaps.de/?clientrouting=1&route=Gareth&route=Tuzak&route=Paavi
```

Expectation:

- The server route and the client route must be technically comparable in the plan.
- Explicit waypoints like `Tuzak` must stay visible.
- Markers/Kreuzungen must not dominate the plan display.
- River names should be preserved, even when several rivers are aggregated into one travel segment.
- Transport changes must separate visibly.

## Still to check

- Multi-point routes with several explicit harbors.
- Switching between different sea or river means of transport.
- Routes with land-water-land changes.
- Routes where an explicit waypoint itself has a marker proximity or a harbor special position.
- Behavior with deactivated transport domains, e.g. river or sea switched off.
