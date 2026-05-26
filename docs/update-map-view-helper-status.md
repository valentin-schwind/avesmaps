# Update Map View Helper Status

## 1. Current Split

- `updateMapView` bleibt zentraler Orchestrator in `js/routing/routing.js`.
- `collectAndValidateSelectedLocations()` kapselt jetzt die Wegpunkt-Sammlung/Validierung (1:1 aus `updateMapView` extrahiert).
- Verbleibende Aufgaben in `updateMapView`:
  - Routentyp lesen, URL sync, Graph neu bauen
  - Tooltips setzen, Fokus setzen, Invalid-Alert anzeigen
  - Teilrouten berechnen, Segmente sammeln, Route rendern, Plan anzeigen

## 2. Clarified Input/Error Semantics

- `highlightError($input)` markiert **ungueltige bzw. nicht gefundene Ortseingaben** (wenn `validateLocation(inputVal)` kein Ergebnis liefert).
- `highlightError($input)` markiert **nicht** den Fall "Ort unerreichbar im Graphen".
- Der Fall "Teilroute nicht berechenbar" wird spaeter separat behandelt ueber:
  - `alert("Keine Route zwischen ... gefunden.")`
- Durch synthetische Querfeldein-Verbindungen sind echte Unerreichbarkeitsfaelle heute oft seltener als frueher.

## 3. Remaining Couplings

- `selectedLocations`
- `invalidLocationInputs`
- `getWaypointContainers`
- `validateLocation`
- `highlightError`
- `addTooltip`
- `focusMapOnActiveTargets`
- `calculateRoute`
- `getRouteSegments`
- `drawRoute`
- `highlightRouteLocations`
- `showRoutePlan`
- `syncPlannerStateToUrl`
- `createGraph`

## 4. Boundary Quality

Was besser geworden ist:

- der Eingangsblock (Inputs lesen + validieren) ist klar benannt und ausgelagert
- `updateMapView` ist kuerzer und leichter lesbar
- Verhalten blieb unveraendert

Was noch problematisch ist:

- `updateMapView` vereint weiterhin Datenerhebung, Fehlerdialoge, Routing-Berechnung und Rendering
- viele globale States und Seiteneffekte in einer Funktion

Bewusst verbleibende UI-/State-Kopplungen in `routing.js`:

- UI-Reads (Routentyp, Waypoints)
- Alerts/Logs
- globale Arrays/Layer-Status

## 5. Candidate Next Steps

A. `updateMapView` vorerst stabil lassen

- sehr sicher, aber kein weiterer Strukturgewinn

B. Helper fuer Tooltips ausgewaehlter Orte extrahieren

- moeglich, aber kleiner Nutzen

C. Helper fuer Berechnung aller Teilrouten und Segmente extrahieren

- hoher Nutzen bei weiterhin kleinem, lokalem Diff
- gute Trennung zwischen "Route berechnen" und "Route darstellen"

D. Helper fuer Rendering des fertigen Routenergebnisses extrahieren

- sinnvoll, aber etwas spaeter als C

E. Helper fuer Fehler-/Alert-Behandlung extrahieren

- machbar, aber Reihenfolge-/Text-Risiko

F. `updateMapView` in mehrere lokale Schritte zerlegen

- Zielbild; C ist ein guter naechster Einzelschritt

G. `updateMapView` verschieben

- nicht sinnvoll (starke UI-/DOM-Kopplung)

## 6. Recommendation

Empfehlung: **C als naechster kleiner Code-Schritt**.

Konkret:

- einen lokalen Helper extrahieren, der aus `selectedLocations` + `useShortest`:
  - `routeNodeNames` aufbaut
  - `segments` sammelt
  - bei fehlender Teilroute den bestehenden Alert ausloest und Abbruch signalisiert
- `updateMapView` bleibt Orchestrator und entscheidet danach nur noch ueber Darstellung.

Prioritaeten bleiben erfuellt:

- lauffaehige Version
- keine Verhaltensaenderung
- kleiner Diff
- keine neue Kopplung in `routing/route-graph-core.js`
- kein Build-System / keine ES-Module
- keine Fehlinterpretation von roter Markierung als Unerreichbarkeitslogik

## 7. Risk Assessment

- 2-Wegpunkt-Route:
  - Basisfall muss unveraendert funktionieren
- Mehrwegpunkt-Route:
  - korrekte Reihenfolge und Segment-Akkumulation
- leerer Wegpunkt:
  - weiterhin ignoriert
- ungueltiger/nicht gefundener Wegpunkt:
  - weiterhin rot markiert + im Alert genannt
- Tooltip-Reihenfolge:
  - weiterhin nach Sammlung der validen Orte
- Teilroute ohne Ergebnis:
  - separater Alert-Fall muss unveraendert bleiben
- Segmentaufloesung:
  - keine Aenderung in `getRouteSegments`-Verhalten
- Route nach Drag-and-drop/Entfernen:
  - Aufruferkette und Recompute-Verhalten unveraendert

## 8. Next Safe Commit

Kleinster spaeterer Code-Commit:

1. In `js/routing/routing.js` Helper einfuegen, z. B. `buildRouteResultFromSelectedLocations(useShortest)`.
2. Den bestehenden Block innerhalb `if (selectedLocations.length >= 2)` (Teilrouten-Loop + Sammeln von `routeNodeNames`/`segments` + "Keine Route zwischen ...") 1:1 in den Helper verschieben.
3. Helper liefert bei Erfolg `{ routeNodeNames, segments }`, bei Fehler `null`.
4. `updateMapView` ersetzt den Loop durch einen Helper-Aufruf und behaelt bestehende Alerts/Logs/Darstellung unveraendert.

