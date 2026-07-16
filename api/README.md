
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
  "transports": {
    "land": "groupFoot",
    "river": "riverSailer",
    "sea": "cargoShip",
    "synthetic": "groupFoot"
  }
}
```

Success:

```json
{
  "ok": true,
  "routing_engine": "server-minimal",
  "route": {
    "found": true,
    "from": "Gareth",
    "to": "Tuzak",
    "cost": 45.659557387792944,
    "summary": {
      "node_count": 12,
      "edge_count": 11
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

Supported methods:

```text
POST    Routing request
OPTIONS CORS/preflight
```

Some technical diagnostic queries may currently still exist via `GET /api/route/?diagnostic=...`. They are not part of the stable external API contract.

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

Supported methods:

```text
GET     Location list
OPTIONS CORS/preflight
```

## App endpoints

The following endpoints are used by the Avesmaps app. They are reachable, but not stabilized as an external developer API:

```text
/api/app/adventures.php
/api/app/coat.php
/api/app/contact.php
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
