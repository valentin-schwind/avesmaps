# Synthetic Graph Connection Extraction Check

## 1. Current Definition

- `addSyntheticGraphConnection` ist aktuell im Inline-Script in `index.html` definiert (`index.html:1493`).
- Die Funktion erzeugt eine synthetische Verbindung zwischen zwei Orten:
  - berechnet `connectionId` (`synthetic-from->to`)
  - berechnet `effectiveDistance = distance * SYNTHETIC_ROUTE_DISTANCE_COST_FACTOR`
  - baut ein `connection`-Objekt (`distance`, `time`, `routeType`, `id`, `synthetic`)
  - schreibt die Verbindung bidirektional in den Graphen
  - legt das zugehoerige synthetische Segment in `syntheticPathSegments` ab.

## 2. Dependencies

`addSyntheticGraphConnection(graph, fromLocation, toLocation, distance, routeConfig)`

- Liest globale Variablen:
  - `SYNTHETIC_ROUTE_DISTANCE_COST_FACTOR`
  - `syntheticPathSegments`
- Schreibt globale Variablen:
  - `syntheticPathSegments` via `.set(...)`
- Aufgerufene Funktionen:
  - `addGraphConnection(...)` (definiert in `js/map-features.js:1579`)
  - `buildSyntheticPathSegment(...)` (definiert in `js/map-features.js:2630`)
- DOM/Leaflet/jQuery/API/map-Abhaengigkeiten:
  - keine direkten DOM-/Leaflet-/jQuery-/API-Zugriffe
  - indirekte Datenkopplung an `syntheticPathSegments`, das spaeter in Routing genutzt wird.

## 3. Call Sites

Suche per `rg` zeigt:

1. Definition:
   - `index.html:1493`
2. Aufruf:
   - `index.html:1535` in `connectDetachedGraphComponents(...)`

Keine weiteren Aufrufstellen in `js/*`.

## 4. Related Functions

- `addGraphConnection` (`js/map-features.js:1579`)
  - schreibt Kanten in den Adjazenzgraphen.
  - wird von `addSyntheticGraphConnection` und `createGraph` genutzt.

- `buildSyntheticPathSegment` (`js/map-features.js:2630`)
  - erzeugt GeoJSON-LineString fuer synthetische Verbindung.
  - Rueckgabewert wird in `syntheticPathSegments` gespeichert.

- `connectDetachedGraphComponents` (`index.html:1512`)
  - orchestriert das Verbinden getrennter Komponenten.
  - ruft `findNearestComponentConnection(...)` und dann `addSyntheticGraphConnection(...)` auf.

- `createGraph` (`index.html:1551`)
  - ruft `syntheticPathSegments.clear()`
  - baut regulare Kanten
  - ruft `connectDetachedGraphComponents(graph)` auf.

- `syntheticPathSegments` (`js/runtime-state.js:19`)
  - globale `Map`, in die `addSyntheticGraphConnection` schreibt.
  - wird in `js/routing.js:getRouteSegments(...)` gelesen (`js/routing.js:151`), um Segmente fuer synthetische Kanten aufloesen zu koennen.

## 5. Extraction Recommendation

Empfehlung: **sicher unveraendert nach `js/route-graph-core.js` verschiebbar**, mit kleiner Architektur-Warnung.

Begruendung:

- Kein direkter DOM/Leaflet/API-Zugriff in der Funktion selbst.
- `getLocationDistance` und weitere Graph-Helfer liegen bereits in `js/route-graph-core.js`.
- Aktuelle Laufzeitreihenfolge ist kompatibel:
  - `js/runtime-state.js` vor `js/route-graph-core.js` (damit `syntheticPathSegments` existiert)
  - `js/map-features.js` wird vor dem Inline-Script geladen (damit `addGraphConnection` und `buildSyntheticPathSegment` vor erstem Aufruf vorhanden sind).

Wichtige Einschraenkung:

- Nach der Verschiebung enthaelt `route-graph-core.js` weiterhin indirekte Abhaengigkeiten auf zwei Funktionen aus `js/map-features.js`.
- Das ist aktuell funktional unkritisch, aber keine saubere Endgrenze fuer ein „vollstaendig neutrales“ Core-Modul.

## 6. Risk Assessment

Moegliche Regressionen:

- Synthetische Querfeldein-Verbindungen:
  - Fehler bei `connectionId`-/`effectiveDistance`-Berechnung aendern Kantengewichtung oder Segment-Mapping.

- Route-Segment-Erzeugung:
  - Wenn `buildSyntheticPathSegment(...)` nicht korrekt erreichbar ist, fehlt das Segment in der Map.

- `getRouteSegments(...)`:
  - liest `syntheticPathSegments.get(connectionId)`; bei fehlendem `.set(...)` entstehen Warnungen und unvollstaendige Routenanzeige.

- Globale `syntheticPathSegments`-Map:
  - Reihenfolge von `clear()` (in `createGraph`) und `set()` darf nicht veraendert werden.

- Script-Reihenfolge:
  - `route-graph-core.js` wird vor `map-features.js` geladen; das bleibt ok, solange `addSyntheticGraphConnection` erst spaeter aufgerufen wird (aktuell der Fall).

- Routing-Regressionen:
  - betriff vor allem getrennte Graph-Komponenten; Standardrouten koennen unauffaellig bleiben, waehrend Querfeldein-Verbindungen brechen.

## 7. Next Safe Commit

Kleinstmoeglicher sicherer Code-Commit, wenn der Schritt gemacht werden soll:

1. `addSyntheticGraphConnection` unveraendert nach `js/route-graph-core.js` verschieben.
2. Originaldefinition aus `index.html` entfernen.
3. `connectDetachedGraphComponents` unveraendert lassen (ruft weiter global auf).
4. Checks:
   - `rg -n "function addSyntheticGraphConnection|addSyntheticGraphConnection\\(" index.html js`
   - sicherstellen: genau 1 Definition, Aufrufstelle in `connectDetachedGraphComponents` vorhanden
   - `node --check js/route-graph-core.js`
   - Diff nur `index.html` und `js/route-graph-core.js`.

Fazit:

- Eine Verschiebung **ohne Verhaltensaenderung ist moeglich**.
- Der naechste Schritt ist aus Stabilitaetssicht klein und vertretbar.
