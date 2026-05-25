# Preflight-Check: moeglicher Waypoint-UI-Split aus `js/map-features.js`

## 1. Zweck des Preflight-Checks
Dieser Preflight prueft vor einem moeglichen spaeteren Code-Split, ob der Waypoint-UI-Cluster ohne versteckte Aufrufer, ohne Reihenfolgeprobleme und mit beherrschbarem Smoke-Risiko als enger 1:1-Extract ausgelagert werden kann.

## 2. Repositoryweite Aufruferliste pro Funktion

### `createWaypointId`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`appendWaypointInput`)

### `getWaypointContainers`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`getWaypointElementById`, `getLastEmptyWaypointInput`, `removeWaypointElement`)
- `js/routing.js` (`collectAndValidateSelectedLocations`)

### `getWaypointElementById`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`removeWaypointById`)

### `getWaypointAutocompleteSource`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`initializeWaypointAutocomplete`, `refreshWaypointAutocompleteSources`)

### `scrollWaypointInputIntoView`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`initializeWaypointAutocomplete`)

### `fitWaypointAutocompleteMenu`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`fitOpenWaypointAutocompleteMenus`, `initializeWaypointAutocomplete`)

### `fitOpenWaypointAutocompleteMenus`
- `js/map-features.js` (Definition)
- `js/map-features.js` (Event-Registrierung in `initializeWaypointAutocompletePositioning`)

### `initializeWaypointAutocompletePositioning`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`initializeWaypointAutocomplete`)

### `initializeWaypointAutocomplete`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`appendWaypointInput`)

### `refreshWaypointAutocompleteSources`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`refreshPlannerAfterFeatureChange`)

### `replaceWaypointLocationName`
- `js/map-features.js` (Definition)
- `js/map-features.js` (Location-Rename-Flow)

### `clearWaypointLocationName`
- `js/map-features.js` (Definition)
- `js/map-features.js` (Location-Delete/Convert-Flow)

### `refreshPlannerAfterFeatureChange`
- `js/map-features.js` (Definition)
- `js/map-features.js` (mehrere Feature-Update-Pfade)
- `js/routing.js` (Live-Update/Polling-Pfad)

### `waypointDragHandleMarkup`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`createWaypointMarkup`)

### `createWaypointMarkup`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`appendWaypointInput`)

### `refreshWaypointSorting`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`appendWaypointInput`, `resetWaypointInputs`, `removeWaypointElement`)

### `appendWaypointInput`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`fillLastEmptyWaypointOrAppend`, `resetWaypointInputs`)
- `js/routing.js` (`#inputLocation`-Click-Handler)

### `getLastEmptyWaypointInput`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`fillLastEmptyWaypointOrAppend`)

### `fillLastEmptyWaypointOrAppend`
- `js/map-features.js` (Definition)
- `js/routing.js` (Popup-Action `add-location-to-route`)

### `resetWaypointInputs`
- `js/map-features.js` (Definition)
- `js/routing.js` (Init-Flow)
- `js/map-features-layer-state.js` (`applyPlannerStateFromUrl`)

### `getWaypointInputValues`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`refreshPlannerAfterFeatureChange`)
- `js/map-features-layer-state.js` (`buildPlannerSearchParams`)

### `removeWaypointElement`
- `js/map-features.js` (Definition)
- `js/map-features.js` (`removeWaypointById`)
- `js/routing.js` (delegierter `.remove-waypoint`-Click)

### `removeWaypointById`
- `js/map-features.js` (Definition)
- `js/routing.js` (Popup-Action `remove-waypoint`)

### `initializeWaypointSorting`
- `js/map-features.js` (Definition)
- `js/routing.js` (Init-Flow)

## 3. Welche Funktionen nur intern im Cluster genutzt werden
Im aktuellen Stand nur intern im Waypoint-UI-Cluster genutzt:
- `createWaypointId`
- `getWaypointElementById`
- `getWaypointAutocompleteSource`
- `scrollWaypointInputIntoView`
- `fitWaypointAutocompleteMenu`
- `fitOpenWaypointAutocompleteMenus`
- `initializeWaypointAutocompletePositioning`
- `initializeWaypointAutocomplete`
- `refreshWaypointAutocompleteSources`
- `waypointDragHandleMarkup`
- `createWaypointMarkup`
- `refreshWaypointSorting`
- `getLastEmptyWaypointInput`

## 4. Welche Funktionen von `js/routing.js` genutzt werden
Direkt in `js/routing.js` verwendet:
- `getWaypointContainers`
- `refreshPlannerAfterFeatureChange`
- `appendWaypointInput`
- `fillLastEmptyWaypointOrAppend`
- `resetWaypointInputs`
- `removeWaypointElement`
- `removeWaypointById`
- `initializeWaypointSorting`

## 5. Welche Funktionen von `js/map-features-layer-state.js` genutzt werden
Direkt in `js/map-features-layer-state.js` verwendet:
- `resetWaypointInputs`
- `getWaypointInputValues`

## 6. Welche Funktionen von anderen Dateien genutzt werden
Im Codebestand (JS/HTML) wurden keine weiteren externen Aufrufer ausser `js/routing.js` und `js/map-features-layer-state.js` gefunden.

## 7. Welche Top-Level-Initialisierungen betroffen sind
Betroffene Top-Level-/Init-Pfade:
- `js/routing.js` `routeDataRequest.then(...)`:
  - `initializeWaypointSorting()`
  - `#inputLocation`-Binding -> `appendWaypointInput()`
  - `resetWaypointInputs()`
  - `applyPlannerStateFromUrl()` (indirekt Waypoint-Funktionen)
- Delegierte Events in `js/routing.js`:
  - `.remove-waypoint` -> `removeWaypointElement(...)`
  - Popup-Action `add-location-to-route` -> `fillLastEmptyWaypointOrAppend(...)`
  - Popup-Action `remove-waypoint` -> `removeWaypointById(...)`
- `#search`-Input/Change-Handler in `js/routing.js` synchronisieren URL-State und greifen damit indirekt den Waypoint-Zustand auf.

## 8. Welche Script-Reihenfolge bei spaeterem Split noetig waere
Fuer einen spaeteren Split in `js/map-features-waypoints.js`:
1. `js/map-features-layer-state.js`
2. `js/map-features-waypoints.js` (neu)
3. `js/map-features.js`
4. `js/routing.js`

Damit stehen die Waypoint-Globals fuer `map-features-layer-state.js`-Laufzeitpfade und fuer `js/routing.js` sicher bereit.

## 9. Muss `js/map-features-waypoints.js` vor oder nach `js/map-features.js` stehen?
Empfehlung: **vor** `js/map-features.js`.

Begruendung:
- konsistente Abhaengigkeitsrichtung (Helper zuerst, Orchestrator danach)
- geringeres Risiko bei kuenftigen Aenderungen (falls in `js/map-features.js` spaeter Top-Level-Zugriffe auf Waypoint-Helfer hinzukommen)
- entspricht dem bereits etablierten Muster der bisherigen `map-features`-Splits.

## 10. Zyklische Laufzeitabhaengigkeiten: problematisch oder beherrschbar?
Es gibt funktionale Rueckkopplung:
- Waypoint-Cluster ruft `syncPlannerStateToUrl()`
- Layer-State ruft `resetWaypointInputs()` / `getWaypointInputValues()`

Im klassischen Script-Tag-Aufbau bleibt das **beherrschbar**, solange:
- nur Funktionsdefinitionen ausgelagert werden (kein neuer Top-Level-Code)
- die Reihenfolge aus Punkt 8 eingehalten wird
- der Split 1:1 ohne Signaturaenderungen bleibt.

## 11. Welche Funktionen nach dem Split global verfuegbar bleiben muessen
Mindestens global erforderlich (externe Konsumenten):
- `getWaypointContainers`
- `refreshPlannerAfterFeatureChange`
- `appendWaypointInput`
- `fillLastEmptyWaypointOrAppend`
- `resetWaypointInputs`
- `getWaypointInputValues`
- `removeWaypointElement`
- `removeWaypointById`
- `initializeWaypointSorting`

Für Stabilitaet empfohlen: alle 24 Funktionen unveraendert global lassen (reiner 1:1-Extract).

## 12. Zwingende Smoke-Test-Schritte nach spaeterem Split
1. Seite laden (keine ReferenceError/Syntaxfehler)
2. Initiale Wegpunkte vorhanden/korrekt
3. Wegpunkt hinzufuegen (`+`)
4. Wegpunkt entfernen (Button + Popup-Action)
5. Wegpunkt sortieren (Drag/Drop)
6. Autocomplete oeffnen und Auswahl uebernehmen
7. Route berechnen
8. URL teilen / Reload
9. Route aus URL wiederherstellen
10. Popup-Action „zur Route hinzufuegen“
11. Mobile/kleine Breite (Autocomplete-Menue/Scroll-Verhalten), falls moeglich

## 13. Klare Empfehlung
Code-Split danach: **Ja, moeglich**, aber nur als enger 1:1-Extract.

Empfohlene spaetere Datei:
- `js/map-features-waypoints.js`

Empfohlene Script-Reihenfolge:
1. `js/map-features-layer-state.js`
2. `js/map-features-waypoints.js`
3. `js/map-features.js`
4. `js/routing.js`

Vorarbeit, die vor Umsetzung abgeschlossen sein sollte:
- Split-Checkliste mit den 24 Funktionen als exaktem Scope fixieren
- sicherstellen, dass kein zusätzlicher Top-Level-Code mitwandert
- dedizierten Smoke-Zyklus aus Punkt 12 direkt nach dem Split durchfuehren.
