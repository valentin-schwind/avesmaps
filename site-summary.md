# Avesmaps

> Avesmaps is an open, non-commercial fan project and static route planner for Aventurien from the roleplaying game "Das Schwarze Auge".

## Short description

Avesmaps is an interactive web map for Aventurien. The application shows locations, paths and optionally the political boundaries of the Reiche. It computes travel routes directly in the browser. The static map renders without a backend; the live site additionally uses a PHP 8 + MySQL backend for search, Herrschaftsgebiete, routing, reviews and the editor.

## Subject focus

- Aventurien
- Das Schwarze Auge
- DSA
- Route planner
- Political map
- Boundaries of the Reiche
- Travel paths and travel times

## Routing logic

- Route computation is based on the Dijkstra algorithm.
- The basis is a weighted graph from locations and GeoJSON path relationships.
- It is possible to distinguish between the fastest and the shortest route.
- Optionally a transfer penalty is used to reduce transport changes.

## Important features

- Multiple waypoints in one route
- Selection of land, river and sea paths
- Political map with optionally toggleable Reichsgrenzen
- Deep links to map objects by Wiki Aventurica page name (`?siedlung=`, `?staat=`, `?region=`, `?strasse=`, `?fluss=` — e.g. `https://avesmaps.de/?strasse=Reichsstraße_1`)
- Shareable routes and settings via URL

## Data and hosting

- The map data is stored locally in the project and is not loaded via external services.
- The map data is processed internally via the map and API workflows.
- The live site uses a PHP 8 + MySQL backend (`api/`) for search, Herrschaftsgebiete, the routing API, reviews and the editor; the static map also renders without a backend. No third-party APIs.

## Legal

- The project is marked as a DSA fan project.
- Source and license notes are in `NOTICE.md`.
- DSA-related map, image and data assets are not under a blanket open-source license of the repository.

## Important URLs

- Live: https://avesmaps.de/
- Repository: https://github.com/valentin-schwind/avesmaps
