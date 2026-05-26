# Route Graph Extraction Plan

## 1. Candidate Functions

Die folgenden Funktionen aus dem Inline-Script in `index.html` sind gute Kandidaten fuer `js/routing/route-graph-core.js`, weil sie Routing-/Graph-Kernlogik oder reine Geometrie-Helfer sind und keine direkten DOM-/Leaflet-Layer-Manipulationen enthalten:

- `createLocationLookup` (index.html:1482)
- `findGraphComponents` (index.html:1486)
- `findNearestComponentConnection` (index.html:1527)
- `addSyntheticGraphConnection` (index.html:1556)
- `smoothLineCoordinatesForDisplay` (index.html:1665)
- `getCatmullRomSplineCoordinates` (index.html:1722)
- `getCatmullRomPoint` (index.html:1741)
- `getCoordinateDistance` (index.html:1760)
- `getCornerSmoothingMultiplier` (index.html:1766)
- `moveCoordinateTowards` (index.html:1783)
- `getQuadraticBezierPoint` (index.html:1790)
- Optional mitziehen im gleichen Block: `getVisualPathLatLngCoordinates` (index.html:1653)

## 2. Do Not Move Yet

Diese Funktionen sehen nach Routing aus, greifen aber aktuell direkt oder indirekt auf UI/DOM/Leaflet oder globale UI-Zustaende zu und sollten nicht im ersten Extraktions-Commit landen:

- `calculateRoute` (index.html:1407)
  - Direkter DOM-Zugriff: `$("#minimizeTransfers").is(":checked")`
  - Koppelt Dijkstra-Kern an UI-Checkbox.
- `getSyntheticRouteConfig` (index.html:1517)
  - Indirekter DOM/UI-Zugriff ueber `getTransportOption(...)` aus `js/routing/routing.js`.
- `connectDetachedGraphComponents` (index.html:1575)
  - Haengt an `getSyntheticRouteConfig`, damit indirekt an UI-Transportauswahl.
- `createGraph` (index.html:1614)
  - Indirekter UI-Zugriff ueber `getTransportOption(...)` und Transport-Filterlogik.
  - Schreibt globalen Laufzeitzustand (`syntheticPathSegments.clear()`).
- `getVisualLatLngCoordinates` (index.html:1657)
  - Direkter Leaflet-Zugriff via `L.latLng(...)`.
- `TRANSFER_PENALTY` (index.html:1405)
  - Inhaltlich an `calculateRoute` gekoppelt; mit `calculateRoute` zusammen verschieben.

## 3. Dependencies

### `createLocationLookup`
- Liest global: `locationData`
- Schreibt global: keine
- Ruft auf: `Map`-Konstruktor, `Array.prototype.map`
- DOM/Leaflet/API: nein

### `findGraphComponents(graph)`
- Liest global: keine
- Schreibt global: keine
- Ruft auf: keine projektinternen Funktionen
- DOM/Leaflet/API: nein

### `findNearestComponentConnection(component, connectedNodeNames, locationLookup)`
- Liest global: keine
- Schreibt global: keine
- Ruft auf: `getLocationDistance(...)` aus `js/map-features.js`
- DOM/Leaflet/API: nein

### `addSyntheticGraphConnection(graph, fromLocation, toLocation, distance, routeConfig)`
- Liest global: `SYNTHETIC_ROUTE_DISTANCE_COST_FACTOR`, `syntheticPathSegments`
- Schreibt global: `syntheticPathSegments` (per `.set(...)`)
- Ruft auf: `addGraphConnection(...)`, `buildSyntheticPathSegment(...)` (beide aus `js/map-features.js`)
- DOM/Leaflet/API: nein

### `smoothLineCoordinatesForDisplay(coordinates, config = VISUAL_LINE_SMOOTHING_CONFIG)`
- Liest global: `VISUAL_LINE_SMOOTHING_CONFIG` (Default-Parameter)
- Schreibt global: keine
- Ruft auf: `getCatmullRomSplineCoordinates(...)`, `getCoordinateDistance(...)`, `getCornerSmoothingMultiplier(...)`, `moveCoordinateTowards(...)`, `getQuadraticBezierPoint(...)`
- DOM/Leaflet/API: nein

### `getCatmullRomSplineCoordinates(coordinates, config = VISUAL_LINE_CATMULL_ROM_CONFIG)`
- Liest global: `VISUAL_LINE_CATMULL_ROM_CONFIG` (Default-Parameter)
- Schreibt global: keine
- Ruft auf: `getCatmullRomPoint(...)`
- DOM/Leaflet/API: nein

### `getCatmullRomPoint(previous, current, next, following, t, tension)`
- Liest global: keine
- Schreibt global: keine
- Ruft auf: keine projektinternen Funktionen
- DOM/Leaflet/API: nein

### `getCoordinateDistance(first, second)`
- Liest global: keine
- Schreibt global: keine
- Ruft auf: keine projektinternen Funktionen
- DOM/Leaflet/API: nein

### `getCornerSmoothingMultiplier(prev, curr, next)`
- Liest global: keine
- Schreibt global: keine
- Ruft auf: keine projektinternen Funktionen
- DOM/Leaflet/API: nein

### `moveCoordinateTowards(from, to, ratio)`
- Liest global: keine
- Schreibt global: keine
- Ruft auf: keine projektinternen Funktionen
- DOM/Leaflet/API: nein

### `getQuadraticBezierPoint(start, control, end, t)`
- Liest global: keine
- Schreibt global: keine
- Ruft auf: keine projektinternen Funktionen
- DOM/Leaflet/API: nein

### `getVisualPathLatLngCoordinates(coordinates)` (optional)
- Liest global: keine
- Schreibt global: keine
- Ruft auf: `smoothLineCoordinatesForDisplay(...)`
- DOM/Leaflet/API: nein

## 4. Proposed Extraction Order

Empfohlene Reihenfolge fuer minimale Regressionen:

1. Reine Geometrie-/Smoothing-Helfer zuerst:
   - `getCoordinateDistance`
   - `getCornerSmoothingMultiplier`
   - `moveCoordinateTowards`
   - `getQuadraticBezierPoint`
   - `getCatmullRomPoint`
   - `getCatmullRomSplineCoordinates`
   - `smoothLineCoordinatesForDisplay`
   - optional `getVisualPathLatLngCoordinates`
2. Reine Graph-Utility danach:
   - `createLocationLookup`
   - `findGraphComponents`
   - `findNearestComponentConnection`
   - `addSyntheticGraphConnection`
3. Graph-Aufbau als naechster Block:
   - `connectDetachedGraphComponents` (erst wenn `getSyntheticRouteConfig`-Abhaengigkeit bewusst akzeptiert ist)
   - `createGraph`
4. `calculateRoute` spaeter:
   - erst nach Entscheidung, ob `minimizeTransfers` als Parameter injiziert wird oder der aktuelle DOM-Zugriff absichtlich beibehalten wird.
5. Riskante Funktion zuletzt:
   - `getVisualLatLngCoordinates` (Leaflet-Kopplung) ggf. gar nicht in `routing/route-graph-core.js`, sondern in UI-/Map-naher Datei lassen.

## 5. Risk Assessment

- Script-Reihenfolge:
  - `js/routing/route-graph-core.js` muss vor erster Nutzung geladen sein.
  - Kritisch sind Aufrufe aus `js/routing/routing.js` (`createGraph`, `calculateRoute`, `smoothLineCoordinatesForDisplay`) und `js/map-features.js` (`smoothLineCoordinatesForDisplay`, `getVisualLatLngCoordinates`).
- Globale Namen:
  - Funktionsnamen bleiben global; doppelte Deklarationen zwischen Inline-Script und neuer Datei fuehren zu Shadowing/Override-Risiken.
  - Extraktion muss in einem Schritt mit Entfernen der Originaldefinitionen erfolgen.
- Seiteneffekte:
  - `createGraph` und `addSyntheticGraphConnection` mutieren `syntheticPathSegments`.
  - `connectDetachedGraphComponents` haengt am aktuellen Transport-UI-Status.
- UI-Kopplung im Dijkstra-Pfad:
  - `calculateRoute` liest Checkbox-Zustand direkt aus DOM; bei Reihenfolge- oder Selektorproblemen aendert sich Routing-Verhalten.
- Routing-Regressionen:
  - Gewichte (`distance` vs. `time`, `TRANSFER_PENALTY`) duerfen nicht veraendert werden.
  - Synthetic-Edge-IDs und Segment-Erzeugung muessen stabil bleiben, sonst bricht `getRouteSegments(...)`.

## 6. Next Safe Commit

Kleinstmoeglicher erster Extraktions-Commit (ohne Verhaltensaenderung):

1. Neue Datei `js/routing/route-graph-core.js` anlegen.
2. Nur die reinen Smoothing-/Geometrie-Funktionen aus `index.html` dorthin verschieben:
   - `getCoordinateDistance`
   - `getCornerSmoothingMultiplier`
   - `moveCoordinateTowards`
   - `getQuadraticBezierPoint`
   - `getCatmullRomPoint`
   - `getCatmullRomSplineCoordinates`
   - `smoothLineCoordinatesForDisplay`
   - optional `getVisualPathLatLngCoordinates`
3. Script-Einbindung in `index.html`:
   - `js/routing/route-graph-core.js` zwischen `js/utils.js` und `js/map-features.js` einbinden.
4. Inline-Script:
   - nur die exakt verschobenen Funktionsdefinitionen entfernen.
5. Manuelle Smoke-Checks:
   - Route berechnen (Kurz/Schnell),
   - Routensegmente werden gezeichnet,
   - keine JS-Fehler in Konsole,
   - Pfad-/Region-Bearbeitung, die Smoothing nutzt, weiterhin benutzbar.

