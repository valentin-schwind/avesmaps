# Create Graph Helper Status

## 1. Current Split

- `createGraph` (Inline-Script in `index.html`) ist jetzt klarer als Orchestrator:
  - `syntheticPathSegments.clear()`
  - Graph-Basis initialisieren
  - regulaere Pfade verarbeiten
  - synthetische Komponenten-Nachbearbeitung
  - unverbundene Orte warnen
  - `return graph`
- `addRegularPathToGraph(graph, pathFeature)` kapselt den regulaeren Pfad-Kanten-Aufbau:
  - Endpoint-Matching
  - Distanz + Route-Type
  - Transportoption + Transportregel
  - Speed-Lookup
  - bidirektionale `addGraphConnection(...)`
- `connectDetachedGraphComponents(graph)` bleibt fuer synthetische Komponenten-Nachbearbeitung zustaendig.

## 2. Remaining Couplings

Verbleibende Kopplungen:

- `getTransportOption` (aus `js/routing.js`, UI/jQuery-gebunden)
- `isTransportAllowedForPath` (aus `js/routing.js`, datenregel-gebunden)
- `SPEED_TABLE` (aus `js/config.js`)
- `getLocationAtPathEndpoint` (aus `js/map-features.js`)
- `calculatePathCoordinateDistance` (aus `js/map-features.js`)
- `normalizePathSubtype` (aus `js/map-features.js`)
- `syntheticPathSegments` (globaler runtime state)
- `getSyntheticRouteConfig` (Inline-Script, indirekt UI-gekoppelt)
- `connectDetachedGraphComponents` (Inline-Script, orchestriert synthetic connections)

## 3. Boundary Quality

Was besser geworden ist:

- `createGraph` wurde als Lesefluss klarer.
- der regulaere Pfadaufbau ist benannt und isoliert.
- der letzte Refactoring-Schritt hatte kleinen Diff bei unveraendertem Verhalten.

Was noch problematisch ist:

- `createGraph`/`addRegularPathToGraph` sind weiterhin indirekt UI-gekoppelt ueber `getTransportOption`.
- zentrale Teile haengen noch ueber globale Funktionen an `routing.js` und `map-features.js`.
- synthetische Nachbearbeitung haengt weiter an `getSyntheticRouteConfig` (UI-Transportstatus).

Bewusst verbleibende UI-/Transportkopplungen im Inline-Script:

- `getTransportOption(routeType)`
- `getSyntheticRouteConfig()`
- Aufrufkette `createGraph -> connectDetachedGraphComponents -> getSyntheticRouteConfig`

## 4. Candidate Next Steps

A. `createGraph`/`addRegularPathToGraph` vorerst stabil lassen

- sehr risikoarm, nach frischem Refactoring oft sinnvoll

B. `addRegularPathToGraph` nach `route-graph-core.js` verschieben

- derzeit nicht ideal: wuerde indirekte UI-Kopplung in den Core ziehen

C. `addRegularPathToGraph` parameterisieren

- sinnvoll als Ziel, aber mehr Diff und hoehere Regressionflaeche als noetig fuer den naechsten Mini-Schritt

D. `resolveRegularPathTransportConfig` extrahieren

- machbar, aber kann Skip-/Warn-Reihenfolge riskieren; fuer "naechster kleinster Schritt" eher zu frueh

E. `getSyntheticRouteConfig` parameterisieren

- sinnvoll fuer spaetere Entkopplung, aber nicht der naechste kleinste Gewinn im regulaeren Pfadfluss

F. `connectDetachedGraphComponents` parameterisieren

- ebenfalls sinnvoll spaeter, aber groesserer Eingriff in Orchestrierungslogik

G. `updateMapView` als naechsten Bereich analysieren

- guter Analyse-Folgeschritt ohne sofortige Risikologik-Aenderung

## 5. Recommendation

Empfehlung: **A jetzt, danach G** als naechster Bereich.

Konkret:

- `createGraph`/`addRegularPathToGraph` vorerst stabil lassen (kein sofortiger Code-Commit).
- als naechsten Schritt `updateMapView` dokumentiert analysieren, um den naechsten sicheren Schnitt vorzubereiten.

Warum:

- lauffaehige Version bleibt priorisiert
- kein Verhalten aendern
- kein UI-Leak in `route-graph-core.js`
- kleinste Regressionflaeche

## 6. Risk Assessment

Bei naechsten Eingriffen besonders kritisch:

- Transportauswahl (Land/Fluss/See) ueber `getTransportOption`
- `allowed_transports` / `transport_domain` Regelkette in `isTransportAllowedForPath`
- Spezialfall `Wuestenpfad + horseCarriage`
- fehlende Kanten durch falsche Skip-Bedingungen
- synthetische Verbindungen via `connectDetachedGraphComponents`
- Warntexte (`Keine Transportoption ...`, `Geschwindigkeit ... nicht definiert ...`) als Diagnose-Signal

## 7. Next Safe Commit

Kein direkter Code-Schritt empfohlen.

Naechster Analyse-/Doku-Schritt:

- neue Datei `docs/update-map-view-boundary-check.md`
- Inhalt:
  - Verantwortungen von `updateMapView` trennen (Graph-Build, Validierung, Route-Berechnung, Rendering)
  - minimale candidate helper extraction benennen
  - konkrete Reihenfolge fuer 1-Commit-Mini-Schritte vorbereiten

