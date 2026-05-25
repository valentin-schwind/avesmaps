# Update Map View Route Result Status

## 1. Current Split

- `updateMapView` bleibt Orchestrator in `js/routing.js`.
- `collectAndValidateSelectedLocations()` kapselt Wegpunkt-Sammlung/Validierung.
- `buildRouteResultFromSelectedLocations(useShortest)` kapselt Teilrouten-Loop inkl. Segmentaufbau und Abbruch bei fehlender Teilroute.
- Verbleibende Aufgaben in `updateMapView`:
  - UI/URL/Graph-Setup
  - Tooltips, Fokus, invalid-input Alert
  - Ergebnis-Logs
  - Rendering der berechneten Route

## 2. Remaining Responsibilities in updateMapView

- `pathType` aus UI lesen
- `syncPlannerStateToUrl()`
- `graphData = createGraph()`
- `resetRoutePresentation()`
- `collectAndValidateSelectedLocations()`
- Tooltips setzen
- Logs fuer selected/invalid locations
- `focusMapOnActiveTargets()`
- `invalidLocationInputs`-Alert
- `selectedLocations.length >= 2`
- `buildRouteResultFromSelectedLocations(useShortest)`
- bei `null` `return`
- Route-Logs
- Rendering: `logRoutePoints`, `drawRoute`, `highlightRouteLocations`, `showRoutePlan`
- Alert bei leeren Segmenten

## 3. Boundary Quality

Was besser geworden ist:

- `updateMapView` ist deutlich klarer als Orchestrator.
- Zwei zentrale Unteraufgaben sind sauber benannt und ausgelagert.
- Verhalten blieb nach bisherigen Schritten stabil.

Was noch problematisch ist:

- In einer Funktion liegen weiterhin mehrere Seiteneffekt-Ebenen (UI, State, Routing-Ergebnis, Rendering).
- Reihenfolgeabhaengigkeiten bleiben hoch (z. B. Tooltips/Fokus/Alerts/Rendering).

Bewusst verbleibende Kopplungen in `updateMapView`:

- UI-Lesezugriffe
- globale Routing-States
- direkte Alerts/Logs
- direkte Rendering-Aufrufe

## 4. Candidate Next Steps

A. `updateMapView` vorerst stabil lassen

- nach zwei direkt aufeinanderfolgenden Extracts der risikoaermste Schritt

B. Helper fuer Tooltips ausgewaehlter Orte extrahieren

- machbar, aber geringer Strukturgewinn

C. Helper fuer Rendering des fertigen Routenergebnisses extrahieren

- sinnvoller naechster technischer Schnitt, aber weiterer Seiteneffekt-Block

D. Helper fuer `invalidLocationInputs`-Alert extrahieren

- sehr klein, aber kaum Entlastung

E. `updateMapView` weiter in lokale Schritte zerlegen

- Zielbild, aber in kleinen Einzelcommits

F. `updateMapView` verschieben

- nicht sinnvoll (starke UI-/DOM-/State-Kopplung)

## 5. Recommendation

Empfehlung: **A (`updateMapView` vorerst stabil lassen).**

Begruendung:

- lauffaehige Version hat Prioritaet
- zwei frische Refactoring-Schritte sind bereits integriert
- kein unmittelbarer Druck fuer weiteren Eingriff ohne erneuten Smoke-Zyklus
- vermeidet unnötiges Risiko vor dem naechsten inhaltlich groesseren Schnitt

## 6. Risk Assessment

- Mehrwegpunkt-Routen:
  - Reihenfolge und Segmentakkumulation muessen stabil bleiben
- Drag-and-drop/Reordering:
  - Recompute-Pfade ueber mehrere Aufrufstellen duerfen nicht kippen
- Rerouting nach Wegpunkt-Entfernung:
  - gleiche Alert-/Render-Pfade erforderlich
- Segmentaufloesung:
  - keine Regression in `getRouteSegments`
- Rendering-Reihenfolge:
  - Logs, Zeichnen, Hervorheben, Plananzeige in gleicher Folge
- Tooltips:
  - weiterhin nach validierter Sammlung
- Alerts:
  - input-Fehler vs. fehlende Teilroute bleiben getrennte Faelle

## 7. Next Safe Commit

Kein direkter Code-Commit empfohlen.

Naechster Analyse-/Doku-Schritt:

1. `docs/update-map-view-rendering-helper-plan.md` anlegen.
2. Dort den moeglich kleinsten Rendering-Helper (nur den Block mit:
   - `console.log("Komplette Route...")`
   - `console.log("Routensegmente...")`
   - `logRoutePoints/drawRoute/highlightRouteLocations/showRoutePlan`
   - `alert("Keine gültigen Routensegmente gefunden.")`
   ) als 1:1-Extract planen.
3. Erst danach entscheiden, ob ein weiterer Code-Schritt noetig ist.

