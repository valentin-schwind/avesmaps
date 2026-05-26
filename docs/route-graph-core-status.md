# Route Graph Core Status

## 1. Current Contents

Aktuelle Funktionen in `js/routing/route-graph-core.js` (`rg -n "^function "`):

- `getVisualPathLatLngCoordinates`
- `createLocationLookup`
- `getLocationDistance`
- `addGraphConnection`
- `findNearestComponentConnection`
- `buildSyntheticPathSegment`
- `addSyntheticGraphConnection`
- `findGraphComponents`
- `smoothLineCoordinatesForDisplay`
- `getCatmullRomSplineCoordinates`
- `getCatmullRomPoint`
- `getCoordinateDistance`
- `getCornerSmoothingMultiplier`
- `moveCoordinateTowards`
- `getQuadraticBezierPoint`

Gruppierung:

- Reine Geometrie/Smoothing-Helfer:
  - `getCoordinateDistance`
  - `getCornerSmoothingMultiplier`
  - `moveCoordinateTowards`
  - `getQuadraticBezierPoint`
  - `getCatmullRomPoint`
  - `getCatmullRomSplineCoordinates`
  - `smoothLineCoordinatesForDisplay`
  - `getVisualPathLatLngCoordinates`
- Reine Graph-Helfer (ohne globalen Write):
  - `addGraphConnection`
  - `findGraphComponents`
  - `findNearestComponentConnection`
  - `buildSyntheticPathSegment`
- Graph-Helfer mit globalem State:
  - `addSyntheticGraphConnection` (schreibt in `syntheticPathSegments`)
- Graph-Helfer mit verbleibenden externen Abhaengigkeiten:
  - `createLocationLookup` (liest global `locationData`)
  - `getLocationDistance` (nutzt global verfuegbares `calculateCoordinateDistance`)
  - `addSyntheticGraphConnection` (nutzt `SYNTHETIC_ROUTE_DISTANCE_COST_FACTOR` und `syntheticPathSegments`)

## 2. Remaining Dependencies

Direkte Abhaengigkeiten von `js/routing/route-graph-core.js`:

- `runtime-state.js`:
  - `locationData` (fuer `createLocationLookup`)
  - `syntheticPathSegments` (fuer `addSyntheticGraphConnection`)
- `config.js`:
  - `SYNTHETIC_ROUTE_DISTANCE_COST_FACTOR`
  - `VISUAL_LINE_SMOOTHING_CONFIG`
  - `VISUAL_LINE_CATMULL_ROM_CONFIG`
- `utils.js`:
  - `calculateCoordinateDistance` (fuer `getLocationDistance`)

Beziehung zu weiteren Dateien:

- `map-features.js`:
  - keine direkte Rueckwaertsabhaengigkeit mehr von `routing/route-graph-core.js` auf `map-features.js`
  - umgekehrt nutzt `map-features.js` inzwischen Core-Funktionen (`getLocationDistance`, `smoothLineCoordinatesForDisplay`)
- `routing.js`:
  - keine direkte Abhaengigkeit von Core zu Routing
  - umgekehrt nutzt `routing.js` `smoothLineCoordinatesForDisplay`
- `index.html` (Inline-Script):
  - nutzt `findGraphComponents`, `createLocationLookup`, `findNearestComponentConnection`, `addSyntheticGraphConnection`, `addGraphConnection`, `smoothLineCoordinatesForDisplay`
  - enthaelt weiterhin `calculateRoute`, `getSyntheticRouteConfig`, `connectDetachedGraphComponents`, `createGraph`

Script-Reihenfolge in `index.html` ist korrekt fuer aktuelle Abhaengigkeiten:

- `runtime-state.js` -> `config.js` -> `utils.js` -> `routing/route-graph-core.js` -> `map-features.js` -> `routing.js` -> Inline-Script

## 3. Boundary Quality

Was jetzt sauber ist:

- die zuvor problematische Rueckwaertsabhaengigkeit auf `addGraphConnection` und `buildSyntheticPathSegment` aus `map-features.js` wurde abgebaut
- Graph-Helfer und Geometrie-Helfer liegen konsolidiert an einer Stelle
- keine direkten DOM-/Leaflet-/jQuery-/API-Zugriffe in `routing/route-graph-core.js`

Was noch unsauber ist:

- `routing/route-graph-core.js` arbeitet weiterhin komplett ueber globale Namen (kein Namespace/kein Modul)
- Datei mischt zwei Themen: Graph-Kern + Linien-Smoothing (technisch ok, architektonisch breit)
- `getVisualPathLatLngCoordinates` ist aktuell nur lokal definiert und hat keine externe Aufrufstelle

Funktional unkritisch, aber architektonisch relevant:

- globale Reads/Writes (`locationData`, `syntheticPathSegments`) bleiben ein Kopplungspunkt
- wichtige Routing-Orchestrierung liegt weiterhin im Inline-Script (`createGraph`, `connectDetachedGraphComponents`)

## 4. Do Not Move Yet

- `connectDetachedGraphComponents`:
  - vorerst nicht verschieben, weil indirekt an UI-Zustand haengt (`getSyntheticRouteConfig -> getTransportOption`).
- `getSyntheticRouteConfig`:
  - liest Transportauswahl aus jQuery-Controls via `getTransportOption`; das ist explizit UI-gekoppelt.
- `createGraph`:
  - mischt Graph-Aufbau, Transportfilter, Geschwindigkeit, synthetic-state-reset und Komponentenzusammenfuehrung; fuer unveraenderten Move derzeit zu breit.
- `calculateRoute`:
  - Dijkstra-Kern ist technisch verschiebbar, aber Funktion liest aktuell UI-Status (`#minimizeTransfers`) und nutzt `getTransportOption`; zuerst sauber trennen/analysieren.

## 5. Candidate Next Steps

- A. `routing/route-graph-core.js` vorerst stabil lassen und zum naechsten Refactoring-Bereich wechseln:
  - sehr sicher, kein neues Risiko im Core.
- B. `connectDetachedGraphComponents` verschieben:
  - technisch moeglich, zieht aber weiterhin indirekte UI-Kopplung in den Core.
- C. `createGraph` parameterisieren:
  - sinnvoll als Zielbild, aber kein kleiner Schritt (groesserer Diff, mehr Regressionflaeche).
- D. `calculateRoute` analysieren:
  - guter naechster Analyse-Schritt, weil dort Kernlogik + UI-Kopplung aktuell noch vermischt sind.
- E. Routing-UI-Bindings aus `routing.js`/Inline-Script analysieren:
  - ebenfalls sinnvoll, vor allem fuer spaetere Parameterisierung.
- F. Kleinen Smoke-Test-/Regressionstest dokumentieren:
  - sehr sicher, stabilisiert weitere Refactoring-Schritte organisatorisch.

## 6. Recommendation

Empfehlung: **A (Core vorerst stabil lassen) und als naechsten Bereich D (`calculateRoute` analysieren) starten.**

Begruendung:

- lauffaehige Version bleibt priorisiert sicher
- kein weiterer Code-Move erzwingt UI-Kopplung in `routing/route-graph-core.js`
- kleinster sinnvoller Fortschritt ist jetzt ein Analyse-Schritt vor dem naechsten Code-Eingriff

Explizit: **Aktuell wird kein weiterer direkter Code-Schritt im Core empfohlen.**

## 7. Next Safe Commit

Kein Code-Commit als naechstes.

Naechster sicherer Analyse-/Doku-Commit:

1. Neue Datei `docs/calculate-route-boundary-check.md` anlegen.
2. `calculateRoute` zerlegen in:
   - reine Dijkstra-Kernteile
   - UI-gekoppelte Teile (`#minimizeTransfers`, `getTransportOption`-Fallback)
3. Aufrufstellen und benoetigte Parameter dokumentieren.
4. Entscheidung vorbereiten, ob ein unveraenderter Mini-Move eines reinen Helfers moeglich ist.

