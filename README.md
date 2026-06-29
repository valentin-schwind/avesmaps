# Avesmaps

Avesmaps is an open, non-commercial route planner for Aventurien from the
roleplaying game "Das Schwarze Auge". The application displays a tile-based
map, locations, paths and optional region boundaries, and computes travel
routes directly in the browser.

![Beispielansicht](img/example.png)

The live version runs at [https://avesmaps.de/](https://avesmaps.de/).

## What the project can do

- display locations, paths and boundaries on a locally hosted map
- show a political map with the boundaries of the Reiche
- compute routes between multiple waypoints
- distinguish between the shortest and the fastest route
- include land, river and sea paths with different means of transport
- optionally minimize transfers with a penalty weighting
- copy the current URL to share routes and settings directly

## How the routes are computed

Route computation is based on the **Dijkstra algorithm**. For this, the code builds a weighted graph from the GeoJSON paths:

- locations are used as nodes
- paths between two locations are used as edges
- each edge receives weights for distance and travel time
- optionally an additional transfer penalty is taken into account when the means of transport changes

To speed this up, the implementation uses a **PriorityQueue based on a min-heap**. As a result, the currently cheapest candidates are always processed first. Depending on the setting, the algorithm optimizes for distance or for travel time.

## Technical structure

The application is intentionally kept simple:

- `index.html` hand-includes the frontend scripts; the map, data-processing and routing logic lives in the modular `js/` files (vanilla JavaScript, no bundler/build step)
- `tiles/` contains the map tiles
- `api/` contains the PHP 8 + MySQL backend (search, Herrschaftsgebiete, the routing API, reviews, location reports and the editor), an example configuration and SQL schemas
- `css/`, `js/` and `fonts/` contain all required assets locally in the repository

The map and route logic itself stays entirely in the browser:

- no external tile server
- no CDN integration
- no build step

The static map and the client-side route computation run without a backend. Beyond that, the live site (avesmaps.de) uses a PHP 8 + MySQL backend under `api/` for search, Herrschaftsgebiete, the server-side routing API, reviews and the editor.

## Local usage

Since the application loads GeoJSON via XMLHttpRequest, it should not be opened directly via `file://`. Instead, a small local web server should be used.

Example with Python in the project directory:

```bash
python -m http.server 8000
```

After that, the application is reachable at [http://localhost:8000](http://localhost:8000).

Note: This startup via Python is suitable for static UI/asset tests.
Full SQL data and routing tests additionally require configured
read-only API endpoints (`MAP_FEATURES_API_URL`, `MAP_SEARCH_API_URL`,
`POLITICAL_TERRITORIES_API_URL`), for example at
[https://avesmaps.de/](https://avesmaps.de/) or via an explicit
`window.AVESMAPS_*` override.

When a local frontend tests against a public API, the API must allow CORS
for the exact local origin (for example
`http://localhost:8000`).

If the location report form is also to be tested locally, a PHP-capable server makes sense, for example:

```bash
php -S localhost:8000
```

Then the static files and `api/report-location.php` can run directly via the same host.
For local PHP/API tests, a valid `api/config.local.php` or the
matching `AVESMAPS_DB_*` and `AVESMAPS_ALLOWED_ORIGINS` environment variables
are required.

## Deployment

For the map alone, it is enough to place the complete project folder on any static web server. No build step is necessary.

If the location report form should be active, the API needs a PHP-capable server and a SQL database. Two typical variants:

- host the entire project on a PHP web server, so that `api/report-location.php` is reachable relatively
- host the frontend statically and set `window.AVESMAPS_LOCATION_REPORT_ENDPOINT` to an absolute API URL

Important: GitHub Pages cannot execute the PHP part itself. Without a separate API, the report form therefore stays disabled there.

## URL sharing of the route planner

The state of the route planner can be saved and shared via query parameters in the URL. This includes in particular:

- the waypoints
- the choice of fastest or shortest route
- the display options for locations, paths and boundaries
- the activated transport paths
- the chosen means of transport
- rest times
- the option to minimize transfers

This way a fully configured route can be shared easily by copying the URL from the browser and passing it on.

## Location reports via PHP and SQL

The file `api/report-location.php` accepts new location reports as JSON and stores them in the table `location_reports`.

### One-time setup

1. Run the matching SQL schema from `api/schema.mysql.sql` or `api/schema.pgsql.sql`.
2. Copy `config/api.config.example.php` to `api/config.local.php`.
3. Enter the database access and allowed frontend origins there.
4. Serve the `api/` folder on a PHP-capable server.

Alternatively, the API can be configured via environment variables:

- `AVESMAPS_DB_DRIVER`
- `AVESMAPS_DB_HOST`
- `AVESMAPS_DB_PORT`
- `AVESMAPS_DB_NAME`
- `AVESMAPS_DB_CHARSET`
- `AVESMAPS_DB_USER`
- `AVESMAPS_DB_PASSWORD`
- `AVESMAPS_ALLOWED_ORIGINS`

If the frontend and the API do not run on the same origin, the frontend page must set the endpoint explicitly, for example:

```html
<script>
	window.AVESMAPS_LOCATION_REPORT_ENDPOINT = "https://example.org/avesmaps/api/report-location.php";
</script>
```

## Notes on data maintenance

- The map source is currently anchored in the repository's map and data workflows.
- Changes to the map data basis must always be considered together with the matching import or generation step.
- The updated state can then be served directly via the static web server.

## Legal and sources

Avesmaps is a fan project and uses DSA-related material in
accordance with the Ulisses fan guidelines.

Important points for this repository:

- no blanket open-source license for DSA-related map, image and
  data assets
- fan-project logo instead of official product logos
- no redistribution of the used material under Creative Commons or
  comparable third-party licenses
- no official affiliation with Ulisses Spiele

Details, sources and notes on the rights situation are in
[`NOTICE.md`](NOTICE.md).
