# Routing Core Status

## 1. Current Routing Split

- `calculateRoute` bleibt als UI-naher Wrapper im Inline-Script (`index.html:1408`):
  - liest `$("#minimizeTransfers").is(":checked")`
  - uebergibt `graphData`, `TRANSFER_PENALTY` und `getTransportOption` an den Kern
- `calculateRouteCore` liegt als parametrisierter Kern in `js/route-graph-core.js` (`js/route-graph-core.js:86`):
  - keine direkte DOM-/jQuery-/Leaflet-/API-Nutzung
  - arbeitet nur mit uebergebenen Werten/Funktionen
- `getTransportOption` bleibt UI-/jQuery-nah in `js/routing.js` (`js/routing.js:243`)
- `updateMapView` bleibt Aufrufer (`js/routing.js:1258`) und ruft weiterhin `calculateRoute(...)` auf (`js/routing.js:1310`)

## 2. Current Dependencies

Abhaengigkeiten von `calculateRoute` (Wrapper):

- `graphData` (globaler Laufzeitstate)
- `TRANSFER_PENALTY` (Inline-Konstante in `index.html`)
- jQuery/UI: `#minimizeTransfers`
- Funktionsabhaengigkeiten:
  - `calculateRouteCore(...)` (global aus `js/route-graph-core.js`)
  - `getTransportOption(...)` (aus `js/routing.js`)

Abhaengigkeiten von `calculateRouteCore`:

- Parameter:
  - `graph`, `startName`, `endName`, `useShortestPath`, `minimizeTransfers`, `transferPenalty`, `resolveTransportOption`
- globale Klasse:
  - `PriorityQueue` (aus `js/priority-queue.js`)
- interne Datenannahmen:
  - `graph[currentNode][neighbor]` enthaelt Verbindungen mit `distance`, `time`, `id`, optional `transportOption`, `routeType`

Abhaengigkeiten von `updateMapView`:

- setzt `graphData = createGraph()`
- liest UI-Zustaende (u. a. Routentyp)
- ruft `calculateRoute(...)` pro Wegpunkt-Paar
- haengt an vielen weiteren UI-/Rendering-Funktionen (`getRouteSegments`, `drawRoute`, `showRoutePlan`, ...)

Gezielte Abhaengigkeiten laut Auftrag:

- `graphData`:
  - global in `js/runtime-state.js`, geschrieben in `updateMapView`, gelesen im Wrapper
- `PriorityQueue`:
  - genutzt im Kern
- `TRANSFER_PENALTY`:
  - bleibt im Wrapper definiert und geht nur als Parameter in den Kern
- `getTransportOption`:
  - UI-gekoppelt in `js/routing.js`, wird in den Kern nur als Resolver injiziert

## 3. Boundary Quality

Was jetzt sauberer ist:

- Dijkstra-Kern ist aus dem Inline-Wrapper herausgeloest.
- Kernlogik ist parameterisiert und dadurch besser isoliert.
- UI-Kopplung wurde nicht in `js/route-graph-core.js` hineingezogen.

Bewusst verbleibende UI-Kopplungen im Wrapper:

- Lesen von `#minimizeTransfers`
- Bereitstellung von `getTransportOption` als Resolver
- Zugriff auf globales `graphData`

Verbleibende problematische Kopplungen:

- globaler Zugriff statt expliziter Routing-Context-Objekte
- `getTransportOption` ist weiterhin direkt an DOM-Controls gekoppelt
- `updateMapView` bleibt ein grosser Orchestrator mit vielen Verantwortlichkeiten

## 4. Do Not Move Yet

- `calculateRoute`:
  - vorerst nicht verschieben; es ist absichtlich der UI-Wrapper.
- `getTransportOption`:
  - vorerst nicht verschieben; direkte jQuery-UI-Funktion.
- `updateMapView`:
  - vorerst nicht verschieben; zu breit und stark vernetzt.
- `createGraph`:
  - vorerst nicht verschieben; haengt an Transportauswahl und globalem State.
- `connectDetachedGraphComponents`:
  - vorerst nicht verschieben; indirekte UI-Kopplung via `getSyntheticRouteConfig -> getTransportOption`.
- `getSyntheticRouteConfig`:
  - vorerst nicht verschieben; liest Transportzustand indirekt aus UI.

## 5. Candidate Next Steps

A. `calculateRoute`-Wrapper im Inline-Script lassen und naechsten Bereich analysieren

- sehr sicher, klein, konsistent mit aktueller Grenzziehung

B. `calculateRoute`-Wrapper nach `routing.js` verschieben

- technisch moeglich, aber zusaetzlicher Move ohne klaren Grenzgewinn

C. `getTransportOption` entkoppeln/parameterisieren

- langfristig sinnvoll, kurzfristig hoehere Risiko-/Diff-Flaeche

D. `createGraph`/Transport-Konfiguration analysieren

- hoher Nutzen fuer naechste Core-Schritte, ohne sofortigen Codeeingriff

E. `updateMapView` analysieren

- ebenfalls sinnvoll, aber groesserer Analyseumfang

F. Routing-Smoke-Test-Checkliste dokumentieren

- sehr sicher, reduziert Refactoring-Risiko operativ

## 6. Recommendation

Empfehlung: **D (`createGraph`/Transport-Konfiguration als naechsten Analysebereich dokumentieren).**

Begruendung:

- aktuell bleibt die Version maximal stabil
- kein neues Risiko durch weitere Moves
- naechster Engpass fuer saubere Grenzen liegt bei `createGraph` + Transportkopplung
- kein Build-System/keine Module/no behavior change

## 7. Next Safe Commit

Kein direkter Code-Schritt empfohlen.

Naechster sicherer Commit als Analyse/Doku:

1. neue Datei `docs/create-graph-transport-boundary-check.md`
2. darin:
   - Daten- vs. UI-Anteile in `createGraph` trennen
   - Abhaengigkeiten auf `getTransportOption`/`isTransportAllowedForPath` kartieren
   - kleinsten verhaltensneutralen Folge-Schritt benennen (ohne sofortige Umsetzung)

