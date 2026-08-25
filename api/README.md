
## Stable developer API

Currently, only these endpoints are considered a stable external API contract:

```text
POST /api/route/
GET  /api/locations/
```

Other endpoints are used by the Avesmaps app, the editor, the import workflow, or for diagnostic purposes. They may still change without any stability guarantee.

In addition to the REST endpoints, the app's **deep-link URL parameters** are a stable contract for linking into the map by wiki page name: `?siedlung=` / `?staat=` / `?region=` / `?strasse=` / `?fluss=` (value = Wiki Aventurica page name, e.g. `https://avesmaps.de/?strasse=Reichsstraße_1`). The map zooms to the object and highlights it; roads and rivers are highlighted across all of their segments. See the section "Deep links to map objects" in the repository README for details.

## Routing

### `POST /api/route/`

Computes a server-side route between two known locations. The legacy path `POST /api/route.php` is retained as a compatibility wrapper and internally forwards to `/api/route/`.

Minimal request:

```json
{
  "from": "Gareth",
  "to": "Tuzak",
  "via": [],
  "optimize": "fastest"
}
```

Typical full request:

```json
{
  "from": "Gareth",
  "to": "Tuzak",
  "via": [],
  "optimize": "fastest",
  "include_air_distance": true,
  "include_geometry": true,
  "include_steps": true,
  "include_rests": true,
  "rest_hours_per_day": 10,
  "minimize_transfers": false,
  "debug": true,
  "enabled_transports": {
    "land": true,
    "river": true,
    "sea": true
  },
  "transports": {
    "land": "groupFoot",
    "river": "riverSailer",
    "sea": "cargoShip",
    "synthetic": "groupFoot"
  }
}
```

`transports` names the vehicle per domain, `enabled_transports` says whether the domain
may be used at all. The two are independent: switching `river` off does not change which
boat `transports.river` names, it removes every `Flussweg` edge from the graph.

- Omitting `enabled_transports` — or any single key in it — means **allowed**. Older
  clients therefore keep their behaviour exactly.
- There are exactly **three** domains. `transports` has a fourth key, `synthetic`, but that
  one only names the *vehicle* for cross-country legs — it is not a gate.
- **Cross-country (`Querfeldein`) is gated by `land`.** Switching land off removes the
  cross-country edges with it; there is no way to keep roads but drop cross-country.
- Switching every domain off yields `found: false`, not an error. There is no route,
  which is a result, not a bad request.

Example — the fastest **land-only** route, which is what the *Geographia Aventurica*
distance table (S. 254) describes:

```json
{
  "from": "Gareth",
  "to": "Perricum",
  "optimize": "fastest",
  "enabled_transports": { "land": true, "river": false, "sea": false }
}
```

#### Intermediate stops (`via`)

`via` is an ordered list of place names the route **must** pass through. The journey is
computed as one leg per consecutive pair of stations (`from` → `via[0]` → … → `to`) on a
single graph, and the legs are concatenated.

```json
{ "from": "Gareth", "to": "Perricum", "via": ["Hartsteen"], "optimize": "fastest" }
```

- **A stop is a constraint, not a preference.** The answer is the cheapest way from A to B
  and from B to C — not the cheapest way from A to C that happens to pass B. If the stop
  lies off the direct line, the journey is *more* expensive than without it. That is the
  point of the field.
- At most **10** stops per request; more is rejected with `invalid_request`. Every stop
  costs one further search over the same graph.
- Empty strings are dropped silently and do not count against the limit.
- An unknown stop answers `404 location_not_found` naming it, not `found: false`.
- A leg that cannot be routed makes the **whole** journey `found: false`. There is no
  partial answer.
- `minimize_transfers` applies *within* a leg. Changing vehicle exactly at a prescribed
  stop costs no penalty — the traveller stops there anyway.
- Until 2026-08-25 a non-empty `via` was rejected with `400 via_not_supported`. That error
  code no longer exists because the condition no longer exists.

#### Switching parts of the answer on and off

All five default to `true`, so a request that omits them gets the full answer.

| Field | `false` removes |
|---|---|
| `include_steps` | the whole `segments` list (the summary and the totals stay) |
| `include_geometry` | `segments[].geometry` (`coordinate_count` stays, so you can tell what you skipped) |
| `include_air_distance` | `air_distance_units` |
| `include_rests` | `duration.rest_hours_per_day` |
| `debug` | the whole `debug` block — this is the **compact mode** |

⚠️ `rest_hours_per_day` is accepted and validated (0 … 23.5) but **does not change the
result**. It is the complement of the travel day (`24 − travel hours per day`), and the
travel day is owner-configured (Tuning window „Tempowerte") and shipped in
`duration.travel_hours_per_day`. Making the request field authoritative would put a second,
diverging travel-day model into the system, so it deliberately does not. Read the effective
values from `duration`; do not derive them from what you sent.

Success:

```json
{
  "ok": true,
  "routing_engine": "server-minimal",
  "route": {
    "found": true,
    "from": "Gareth",
    "to": "Perricum",
    "cost": 31.506095790416314,
    "summary": { "node_count": 19, "edge_count": 18 },
    "from_node": "Gareth",
    "to_node": "Perricum",
    "node_ids": ["Gareth", "Alfenmohn", "…"],
    "edge_ids": ["path-2696", "path-2654", "…"],
    "distance_units": 106.4906,
    "miles_per_distance_unit": 3,
    "air_distance_units": 83.6981,
    "duration": {
      "travel_hours": 63.01,
      "travel_days": 7.88,
      "travel_hours_per_day": { "land": 8, "water": 12, "night": 24 },
      "rest_hours_per_day": { "land": 16, "water": 12, "night": 0 }
    },
    "debug": {},
    "segments": []
  }
}
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "location_not_found",
    "message": "Unknown from location: Beispielort"
  }
}
```

#### What the numbers mean

💣 **`cost` is the optimiser's weight. It is not a time, not a distance, and it is not
meant for display.** With `optimize: "fastest"` it is the travel time weighted into
*calendar* time (so that "fastest" means *arrives earliest*, not *fewest hours on foot*);
with `optimize: "shortest"` it is the distance; and `minimize_transfers` adds a change
penalty on top. It exists so two routes can be ordered, and its absolute value carries no
unit. Use `duration` for time and `distance_units` for distance.

💣 **`segments[].cost_units` is likewise not an hour**, however much it looks like one. It
is `distance_units / speed`, where the distance is in map units and the speed is in Meilen
per hour — so it is a third of an hour. One map unit is three Meilen. This is exactly why
the sum of `cost_units` (21.004 on the land-only Gareth → Perricum route) and `cost`
(31.506) and the travel plan's own figure (63.0 hours) are three different numbers for one
journey. **Take hours from `duration.travel_hours`.**

| Field | Meaning |
|---|---|
| `duration.travel_hours` | pure hours in motion, rests excluded |
| `duration.travel_days` | calendar days: each leg's hours divided by *its* travel day, then summed |
| `duration.travel_hours_per_day` | the travel day actually used, per domain — the one source for it |
| `duration.rest_hours_per_day` | `24 −` the above; present only with `include_rests` |
| `distance_units` | length of the route in **map units** |
| `miles_per_distance_unit` | multiply by this for Meilen (`3`); shipped so no client hardcodes it |
| `air_distance_units` | straight line across the prescribed stations, in map units |
| `node_ids` / `edge_ids` | the traversed nodes and edges, in travel order |

A mixed land/river/sea journey cannot be converted with a single divisor: land travels 8
hours a day, ships 12, and the Schnellsegler 24. `travel_days` already does this per leg;
`travel_hours / 8` does not.

#### Segments run in travel direction

Each entry of `segments` describes one leg, and leg *i* runs from `node_ids[i]` to
`node_ids[i+1]`. `from_node`, `to_node` and `geometry.coordinates` all follow the direction
travelled, as do the direction-dependent values `ascent_schritt`, `descent_schritt`,
`max_ascent_gradient`, `max_descent_gradient` and `flow_time_factor`.

⚠️ Before 2026-08-25 `from_node`/`to_node` and the geometry reported the **stored**
orientation of the underlying way instead, which for roughly half of all legs is the
opposite of the direction of travel. A client that turned them into travel instructions
sent the reader backwards. `distance_units`, `cost_units` and the edge identity are
unaffected — only the orientation changed.

#### The `debug` block

`debug` carries graph statistics, an echo of the normalised request and other diagnostic
context. **It is not part of the stable contract** and may change or disappear without
notice. Send `"debug": false` for a compact production answer; everything a client needs to
render a route — including `node_ids` and `edge_ids` — is available on the route object
itself.

Supported methods:

```text
POST    Routing request
OPTIONS CORS/preflight
```

Some technical diagnostic queries may currently still exist via `GET /api/route/?diagnostic=...`. They are not part of the stable external API contract.

### Coordinates, distances and units

Every coordinate in this API — `coordinates.x`/`coordinates.y` in `/api/locations/`, the
`from_point`/`to_point` of a routing request, and every position in a segment geometry —
lives in one flat map coordinate system:

- **Axis order is `[x, y]`**, GeoJSON order. Leaflet's `L.CRS.Simple` wants `[lat, lng]`,
  which is `[y, x]`; swap once, consciously, at the boundary of your renderer.
- **Range is `0 … 1024` on both axes**, matching the tile pyramid (zoom `0 … 5`).
- **The origin `(0, 0)` is the south-west corner.** `y` grows **northwards** — Riva at
  `y ≈ 790` lies north of Al'Anfa at `y ≈ 152`. (The tile *files* use a negative y,
  `map_x_-y`; that is a storage detail of the tiles and never appears in the API.)
- **The projection is the drawn map itself.** There is no geodetic datum, no latitude or
  longitude: Aventurien is a painted map, and the coordinates index that painting. You
  cannot align them with a real-world CRS.

**One map unit is three Meilen.** `distance_units` — on the route and on every segment — is
in map units, so Meilen are `distance_units × 3`. The response ships the factor as
`miles_per_distance_unit` so a client does not have to hardcode it. A Meile is 1000 Schritt,
which is what the `ascent_schritt` / `descent_schritt` fields count.

💣 Reading a map unit as one Meile is the standing trap here: it understates every distance
threefold, and — because a gradient is climb over distance — overstates every slope by the
same factor. It has already put a wrong sentence in front of readers once.

### Terrain (V11)

The travel time of a leg is multiplied by a **slope factor** derived from the stored height
rasters, when the owner switch `terrain_travel_enabled` is on.

🔴 **The model is the Leistungskilometer**, a surcharge on the DISTANCE in the manner of
Naismith’s rule with Langmuir’s correction (owner decision of 2026-07-30): one mile of level
ground is one performance mile, every 100 Schritt of climb adds another, and every 150 Schritt of
descent does too — but only on stretches steeper than 20 %. `Faktor = Leistungsmeilen / Meilen`,
capped at 4,0. It is deliberately NOT one of the marching-time formulas it is often confused with;
those compute a TIME and none of them is implemented here — see the header of
`api/_internal/routing/terrain-factor.php` for the full warning and
`api/_internal/routing/__tests__/terrain-text-claims-test.php` for the guard that keeps this
paragraph honest.

⚠️ **Therefore `terrain_time_factor` is never below 1.0.** Nothing is ever quicker than the level. A
previous model handed out a bonus for gentle descents; if you cached or compared against values under
1.0, they are gone. The threshold is decided per sampled stretch, not from a leg's average, so a leg
may cost a little more than its average gradient suggests. The response **gains fields** (below);
no existing field is removed or renamed. The **values** of `cost` and `segments[].cost_units` change
once the switch is on. `distance_units` does not — distance is geometry.

| Field | Where | Meaning |
|---|---|---|
| `terrain_time_factor` | per segment | the applied factor; `1.0` when it had no effect |
| `ascent_schritt` / `descent_schritt` | per segment | climb and fall in Schritt, in the direction travelled; **`null`** where no height data exists |
| `debug.context.terrain.enabled` | debug | was the switch on |
| `terrain` | **request** | `false` switches terrain **off**; it can never switch it on |

⚠️ **`terrain: false` does not give you the same route with different numbers — it gives you a
DIFFERENT ROUTE.** The planner looks for the cheapest way; change the price of the mountains and
the choice changes with it. With terrain the route goes around, without it over the pass. Both are
correct — but they are two journeys, not two price tags for one.

🔴 **Slope applies to LAND legs only.** A `Flussweg` or `Seeweg` leg always answers
`terrain_time_factor: 1.0` and `ascent_schritt: null`, whatever the terrain under it looks like: a boat
does not climb, and a river is already priced by its current through `flow_time_factor`. Owner decision
of 2026-07-30 — before it, water carried a slope too, and the steepest single piece on the whole map
was a river.

💣 `terrain_time_factor: 1.0` therefore means **four** different things: terrain is off, this is a
water leg, the ground is level here, or nothing is known here.
`debug.context.terrain.enabled` separates the first, `segments[].subtype` the second, and
`ascent_schritt: null` separates the fourth from the third.

The speed table (`Gebirgspass` 1,5 km/h, `Strasse` 4,0 …) is the **base speed BEFORE terrain**.

## Locations

### `GET /api/locations/`

Returns the routable locations from the same data source that the server-side router uses. The endpoint is intended for clients that want to offer or validate valid location names for `/api/route/`.

Success:

```json
{
  "ok": true,
  "map_revision": 123,
  "location_count": 3949,
  "locations": [
    {
      "id": "32063601-c38f-4187-9380-b023a6965a40",
      "public_id": "32063601-c38f-4187-9380-b023a6965a40",
      "name": "A'Kr'Urabaal",
      "subtype": "dorf",
      "is_crossing": false,
      "coordinates": {
        "x": 410.574,
        "y": 263.402
      }
    }
  ]
}
```

The `coordinates` are in the map coordinate system described under
[Coordinates, distances and units](#coordinates-distances-and-units): `[x, y]`, `0 … 1024`,
origin south-west, `y` growing northwards.

#### Conditional requests, and why the `ETag` looks missing

The endpoint answers `If-None-Match` with `304 Not Modified`, which saves the caller the
full list (about 1 MB gzipped). The validator is a weak ETag over the payload version and
the map revision, `W/"loc-1-89628"`, and it changes whenever an editor changes the map.

💣 **On a `200` the `ETag` header does not reach the client — on the `304` it does.**
Something in the hosting layer in front of PHP rewrites responses that carry a body: the
`200` arrives without `ETag`, without `Content-Length`, chunked, and with a `Vary` this
application never sets. The `304` passes through untouched. The conditional mechanism
itself is intact — `If-None-Match` reaches the application and is answered correctly — but
the only response that carries the validator is the one you can only obtain once you
already have it.

⭐ **Therefore the same value is also sent as `X-Avesmaps-ETag`**, which survives (as
`X-Robots-Tag` and `X-Powered-By` demonstrably do). Read the validator from there and send
it back unchanged in `If-None-Match`:

```bash
TAG=$(curl -sS -D - -o /dev/null https://avesmaps.de/api/locations/   | tr -d '' | sed -n 's/^X-Avesmaps-ETag: //p')

curl -sS -o /dev/null -w '%{http_code}
'   -H "If-None-Match: $TAG" https://avesmaps.de/api/locations/
# 304
```

The real `ETag` is still sent as well: should the intermediate layer ever stop rewriting,
it is immediately the correct mechanism again, and any cache that does see it should use
it. Both headers are listed in `Access-Control-Expose-Headers`, so a cross-origin browser
client can read them — without that, `response.headers.get(…)` returns `null` however
faithfully the server sends them.

Supported methods:

```text
GET     Location list
OPTIONS CORS/preflight
```

## App endpoints

The following endpoints are used by the Avesmaps app. They are reachable, but not stabilized as an external developer API:

```text
/api/app/game-literature.php
/api/app/coat.php
/api/app/contact.php
/api/app/ecosystem-areas.php
/api/app/feature-sources.php
/api/app/link-status.php
/api/app/location-reviews.php
/api/app/map-features.php
/api/app/map-search.php
/api/app/political-derived-geometry-debug.php
/api/app/political-territories.php
/api/app/political-territory-display-sync.php
/api/app/political-territory-wiki.php
/api/app/political-zoom-coverage-debug.php
/api/app/report-location.php
/api/app/share-link.php
/api/app/territory-detail.php
/api/app/track.php
/api/app/visitor-metrics.php
```

Legacy root wrappers such as /api/map-features.php, /api/map-search.php, /api/report-location.php and /api/wiki-proxy.php are no longer maintained as canonical paths.

## Machine access: the semantic SVG export

```text
GET  /api/svg-export.php          Authorization: Bearer <svg_export.token>
POST /api/svg-export-deposit.php  Authorization: Bearer <svg_export.deposit_token>  (or an admin session)
```

Hands out **the newest semantic SVG rendering of the whole map** — the same file
`/edit/svg-export.php` produces in the browser, for tools that cannot hold a browser login.
The vocabulary contract is in `docs/svg-export-semantik-uebergabe.md`.

🔴 **The renderer is JavaScript and stays that way.** The export is 1356 lines of map
appearance in `js/pages/svg-export-build.js`. A PHP renderer would restate it a second time
(AGENTS.md §5) and would have to `json_decode` ~21 MB per call on shared hosting — the load
CLAUDE.md warns about. PHP therefore never *builds* an export; it only stores and serves one.

**Two producers, one way in.** Both build with the same builder and deposit through the same
endpoint:

| Producer | Trigger | `quelle` |
|---|---|---|
| The owner | „Vollständigen Abzug hinterlegen" on `/edit/svg-export.php` | `manuell` |
| The routine | `.github/workflows/svg-export-abzug.yml`, 03:17 UTC | `routine` |

🔴 **Both build with the same settings** — `SVGX_ABZUG_EINSTELLUNGEN` in
`js/pages/svg-export-build.js`: inkscape, 32768², all layers, full semantics, nothing smoothed,
default colours. **The page's checkboxes apply to the owner's own download only.** The API copy
is a data source, not a design artefact; it has to be complete and in one fixed notation, or a
consumer never knows what it is getting.

💣 Live proof of why: the page pre-selects `illustrator`, the routine builds `inkscape`, and
inkscape writes an extra `inkscape:label` on *every* element. A deposited hand-made export came
out at 7.4 MB against the routine's 9.0 MB with identical content — and that reads exactly like
missing layers. Same settings + same data + same builder now means the two are byte-identical;
`quelle` says only who triggered it.

💣 **A second write path would need a second copy of the same rules** — prune, write the
pointer, set the lock. The first version pushed the routine's file up by SFTP and pruned with
`lftp`; that is exactly the shape AGENTS.md calls out as *„zwei von drei Löschwegen gebunden
ist keine Regel"*. Now only PHP touches the store.

### Reading

| | |
|---|---|
| Token | `$config['svg_export']['token']` in `api/config.local.php` — where this project's tokens live (`import_api`, `discord`, `changelog`, `social`). Env var `AVESMAPS_SVG_EXPORT_TOKEN` is a fallback for hosts without that file. **Never** a URL parameter, never logged. |
| Compared with | `hash_equals`; an empty configured token never matches |
| 200 | `image/svg+xml; charset=utf-8` + `Content-Disposition: attachment; filename="avesmaps-karte-YYYY-MM-DD-r<Kartenfassung>-inkscape.svg"` |
| Headers | `ETag` (strong, sha256), **`X-Avesmaps-SHA256`** (the same number, unquoted), `Cache-Control: private, no-cache`, `X-Avesmaps-Kartenfassung`, `X-Avesmaps-Landschaftsfassung`, `X-Avesmaps-Exported-At`, `X-Avesmaps-Quelle` |
| 304 | on a matching `If-None-Match` — the quoted ETag **or** the bare sha256 from `X-Avesmaps-SHA256`; weak prefix and lists included |
| 401 `unauthorized` | missing **or** wrong token — deliberately indistinguishable |
| 404 `export_not_available` | nothing deposited yet |
| 405 `method_not_allowed` | anything but GET/HEAD |
| 503 `export_not_configured` | the key is not set **on the server** — not a 401, because the caller has no error to look for |

💣 **Do not rely on `ETag` reaching the client.** Measured 23.08.2026: something in front of
STRATO rewrites the response (`Vary: X-Forwarded-For,User-Agent,Accept-Encoding`) and drops
both `ETag` and `Content-Length` — the body arrives `chunked`. This hits every PHP response,
not just this one: `api/app/zoom-bands.php` sets an ETag too, and it does not arrive either
(a static file's Apache-generated ETag does). Own `X-` headers survive, which is why the
checksum ships a second time as **`X-Avesmaps-SHA256`** — same number, no quotes, derived from
the very same value so the two can never disagree. `If-None-Match` is still honoured
server-side, and it accepts **both** forms — the quoted ETag and the bare hash. 💣 The bare one
is the important one: the client never sees the ETag, so the only value it can echo is the one
we handed it. Demanding quotes around a value nobody received would mean a silent 200 on every
single poll — 8.6 MB, forever, and a 200 looks perfectly normal.

⚠️ **`X-Avesmaps-Quelle`** tells you which trigger produced the file. Since 23.08.2026 both
produce the same bytes for the same data, so it is provenance, not a warning about geometry.

### Depositing

Chunked, like the database dump — an export is ~8.6 MB and a single POST runs into STRATO's
`post_max_size`, whose failure mode is an **empty body with no exception**, indistinguishable
from "nothing was sent".

```text
POST ?action=start                     -> {ok, upload_id}
POST ?action=chunk&upload_id=… (raw)   -> {ok, bytes}
POST ?action=finish&upload_id=… (JSON) -> {ok, datei, bytes, quelle, aufgeraeumt}
```

🔴 **A separate token from the reading one.** The read token goes to outside tools; if it also
opened the write path, every reader would be a writer. 🔴 **`quelle` is decided by the gate, not
by the request body** — otherwise a hand-made export could label itself as the routine, and
that field exists precisely to tell them apart.

Rejected with `422 deposit_rejected` and a reason: under 64 KB (the likeliest silent failure is
a builder that turned empty endpoint answers into a valid but empty SVG), or not an SVG at all.
The previous export stays in place when a deposit is rejected.

`AVESMAPS_SVG_EXPORT_KEEP_FILES = 3`, mirroring the backup. 🔴 The current export is never
pruned, even if it is the oldest — a store whose pointer dangles reports "nothing available"
right after something was deposited.

### The store

`uploads/svg-export/`, HTTP-denied, next to `uploads/db-backups`. 🔴 **No `.htaccess` in the
repo**, unlike the backup: `uploads/` is not in the deploy allowlist, so a repo copy would never
reach the server and would only be a second, drifting version. PHP writes and repairs the lock
at run time (`avesmapsSvgExportEnsureAblage`) — the house pattern from
`avesmapsDbBackupEnsureStorageDir`. (Measured 23.08.2026: the backup's repo copy is CRLF while
its PHP constant is LF, so that one rewrites itself on every single run.)

💣 **The pointer is the truth, not the directory.** `aktuell.json` names the file; it is written
LAST and points at a name nobody knew before. "Newest file in the directory" would hand out a
half-written one.

Libs: `api/_internal/app/svg-export-ablage.php` (read), `…/svg-export-hinterlegen.php` (write).
Tests: `api/_internal/app/__tests__/svg-export-ablage-test.php` (the decisions),
`tools/svg-export/__tests__/endpunkt-ablauf.js` (10 HTTP steps, reading),
`tools/svg-export/__tests__/ablage-ablauf.js` (9 HTTP steps, a real multi-chunk deposit).

## Editor, import, and diagnostic areas

The API is organized into the following areas:

```text
api/app/                    app-facing browser endpoints
api/edit/                   protected editor and review endpoints
api/import/                 token-protected import endpoints
api/diagnostics/            diagnostic endpoints, not publicly stable
api/_internal/              internal PHP libraries
api/_schema/                SQL schemas
```

`api/_internal/`, `api/_schema/` and `api/diagnostics/` must be protected against direct web access via `.htaccess` in deployment.

### `api/edit/admin/database-backup.php`

Control surface for the full-database backup (`edit/backup.php`). Requires the `admin` capability — not `edit`: a full dump carries `users.password_hash`, every share link and every report.

```text
GET  ?action=status                            current + recent runs
GET  ?action=download&run_id=<id>              stream the finished .sql.gz
POST { "action": "start", "include_transient"?: bool }
POST { "action": "step",   "run_id": "<id>" }  one bounded step; loop until done
POST { "action": "cancel", "run_id": "<id>" }
POST { "action": "delete", "run_id": "<id>" }
```

A dump is far more work than one PHP request may spend, so the client loops `step` until the response reports `done`. See `docs/database-backup.md` for the file format, the single-member gzip construction and the restore commands.

## Configuration

1. Copy `../config/api.config.example.php` to `config.local.php`
2. Enter the real database values
3. Do not commit `config.local.php`
4. Enter the frontend origin in `cors.allowed_origins`

Alternatively, the API can be configured via environment variables:

```text
AVESMAPS_DB_DRIVER
AVESMAPS_DB_HOST
AVESMAPS_DB_PORT
AVESMAPS_DB_NAME
AVESMAPS_DB_CHARSET
AVESMAPS_DB_USER
AVESMAPS_DB_PASSWORD
AVESMAPS_ALLOWED_ORIGINS
AVESMAPS_IMPORT_API_TOKEN
```

`AVESMAPS_ALLOWED_ORIGINS` expects a comma-separated list, for example:

```text
http://localhost:8000,https://avesmaps.de
```

If the frontend and API are on the same domain, no external CORS origin is needed.

## SQL schemas

Schemas are intended to live under:

```text
api/_schema/mysql.sql
api/_schema/pgsql.sql
api/_schema/future.mysql.sql
```

As long as legacy schema files still reside in the flat API folder, they remain usable for existing local workflows. Production dumps, real reports, audit logs, tokens, or credentials must not enter the repository.

## Location reports and import workflow

`report-location.php` accepts new location reports as JSON and writes them to the `location_reports` table.

The local Python script `map/import_reported_locations.py` can operate via server-side admin endpoints. A separate import token is used for this.

Example in `api/config.local.php`:

```php
'import_api' => [
    'token' => 'replace-with-a-long-random-import-token',
],
```

Or via environment variable:

```text
AVESMAPS_IMPORT_API_TOKEN=replace-with-a-long-random-import-token
```

### Visitor salt

`api/_internal/analytics/visitor-analytics.php` hashes an IP address plus a user agent into the
daily visitor key. The salt is resolved in three steps: a `define('AVESMAPS_VISITOR_SALT', …)`
before the file is required, then `analytics.visitor_salt` from the config, then the fallback
shipped in the repository.

💣 **Set it.** On the fallback the salt is public, and the IPv4 space is small enough to walk in
seconds — a stored hash is then reversible, which the privacy notice says it is not.

```php
'analytics' => [
    'visitor_salt' => 'replace-with-a-long-random-visitor-salt',
],
```

⚠️ Changing the salt counts every returning visitor as new exactly once. `GET
/api/app/visitor-metrics.php` reports `salt_configured` (capability `edit`) so the state is
visible rather than assumed.

PowerShell example:

```powershell
$env:AVESMAPS_IMPORT_API_BASE_URL = "https://example.org/avesmaps/api"
$env:AVESMAPS_IMPORT_API_TOKEN = "replace-with-a-long-random-import-token"
python map/import_reported_locations.py
```

## Local smoke tests

Syntax checks:

```powershell
php -l api/bootstrap.php
php -l api/route/index.php
php -l api/locations/index.php
php -l api/_internal/routing/request.php
php -l api/_internal/routing/map-data.php
php -l api/_internal/routing/network-data.php
php -l api/_internal/routing/graph.php
php -l api/_internal/routing/client-graph.php
php -l api/_internal/routing/response.php
```

HTTP smoke tests after deployment:

```powershell
Invoke-WebRequest -Method Options -Uri "https://avesmaps.de/api/route/"
Invoke-WebRequest -Method Options -Uri "https://avesmaps.de/api/locations/"

$locations = Invoke-RestMethod -Method Get -Uri "https://avesmaps.de/api/locations/"
$locations.ok
$locations.location_count
$locations.locations | Select-Object -First 5
```
