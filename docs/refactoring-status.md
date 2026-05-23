# Refactoring Status

## 1. Current Stable Boundaries

- `js/route-graph-core.js` enthaelt derzeit den Routing-/Graph-Kern ohne direkte UI-Interaktion: Geometrie-/Smoothing-Helfer, Graph-Helfer sowie `calculateRouteCore(...)` als parametrisierter Dijkstra-Kern.
- `createGraph(...)` bleibt als Orchestrator im Inline-Script von `index.html` und wurde durch `addRegularPathToGraph(graph, pathFeature)` entlastet.
- `updateMapView(...)` bleibt als Orchestrator in `js/routing.js` und wurde durch `collectAndValidateSelectedLocations()` sowie `buildRouteResultFromSelectedLocations(useShortest)` entlastet.
- Bewusst noch nicht verschoben: `createGraph`, `addRegularPathToGraph`, `updateMapView`, `calculateRoute`-Wrapper, `getTransportOption`, `connectDetachedGraphComponents`, `getSyntheticRouteConfig`.

## 2. Recent Safe Extracts

- `addRegularPathToGraph(graph, pathFeature)` als 1:1-Extract aus dem regulaeren `pathData`-Loop in `createGraph`.
- `collectAndValidateSelectedLocations()` als 1:1-Extract fuer Wegpunkt-Scan und Input-Validierung aus `updateMapView`.
- `buildRouteResultFromSelectedLocations(useShortest)` als 1:1-Extract fuer Teilroutenberechnung, `routeNodeNames`-Aufbau und Segmentsammlung.

## 3. Areas To Leave Stable For Now

- `createGraph`: enthaelt weiterhin zentrale Transport- und Datenregeln; weitere Schnitte haben direkte Routing-Risiken.
- `addRegularPathToGraph`: frisch extrahiert; sollte erst nach Stabilitaetsfenster weiter angepasst werden.
- `updateMapView`: bleibt bewusst UI-naher Orchestrator mit klaren Seiteneffekten (URL, Alerts, Rendering, Fokus).
- `js/route-graph-core.js`: hat nach mehreren Moves eine sinnvolle Kern-Grenze erreicht; keine neue UI-Kopplung hineinziehen.

## 4. Planned But Not Yet Implemented

- Geplanter spaeterer 1:1-Helper in `js/routing.js`: `renderRouteResult(routeNodeNames, segments)` (nur geplant, noch nicht umgesetzt).
- Moegliche spaetere Parameterisierung von `createGraph` bzw. Transportlogik, um UI-Kopplung weiter zu reduzieren.
- Moegliche spaetere Entkopplung der synthetic route config (`getSyntheticRouteConfig`) von direkter Transport-UI-Abfrage.

## 5. Smoke-Test Status

- Manuelle produktive Pruefung auf [avesmaps.de](https://avesmaps.de/) zeigt aktuell stabile Funktion fuer Routing, Dragging und Rerouting.
- Wichtige naechste Smoke-Faelle bei weiteren Routing-Refactorings:
  - 2- und Mehrwegpunkt-Routen
  - kuerzeste vs. schnellste Route
  - Umstiege minimieren an/aus
  - Transportarten und Transportmittel wechseln
  - synthetische Querfeldein-Verbindungen
  - keine neuen Konsolenfehler/Warnungen

## 6. Important Clarifications

- `highlightError($input)` markiert ungueltige bzw. nicht gefundene Eingaben (Input-Validierung).
- `highlightError` ist keine Logik fuer unerreichbare Orte.
- Echte fehlende Teilrouten laufen separat ueber den Alert `Keine Route zwischen ... gefunden.`
- Querfeldein-Verbindungen reduzieren viele fruehere Unerreichbarkeitsfaelle.

## 7. Next Recommended Step

- Kein sofortiger Code-Schritt empfohlen.
- Nach einem kurzen weiteren Stabilitaetsfenster optional den geplanten Rendering-Helper `renderRouteResult(routeNodeNames, segments)` als kleinen 1:1-Extract umsetzen.
- Alternativ Routing vorerst pausieren und den naechsten Refactoring-Bereich ausserhalb von Routing/Graph analysieren.
