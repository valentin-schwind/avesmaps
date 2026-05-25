# Boundary-Analyse: Waypoint-UI-Helfer-Cluster in `js/map-features.js`

## 1. Zweck der Analyse
Diese Analyse bewertet, ob der Waypoint-UI-Helfer-Cluster in `js/map-features.js` spaeter als kleiner, verhaltensneutraler 1:1-Split ausgelagert werden kann. Ziel ist ausdruecklich nur die Boundary- und Risikoanalyse, keine Implementierung.

## 2. Exakte Funktionsliste des Waypoint-UI-Clusters
Im aktuellen Stand umfasst der Waypoint-UI-Cluster funktional folgende Helfer:
- `createWaypointId`
- `getWaypointContainers`
- `getWaypointElementById`
- `getWaypointAutocompleteSource`
- `scrollWaypointInputIntoView`
- `fitWaypointAutocompleteMenu`
- `fitOpenWaypointAutocompleteMenus`
- `initializeWaypointAutocompletePositioning`
- `initializeWaypointAutocomplete`
- `refreshWaypointAutocompleteSources`
- `replaceWaypointLocationName`
- `clearWaypointLocationName`
- `refreshPlannerAfterFeatureChange`
- `waypointDragHandleMarkup`
- `createWaypointMarkup`
- `refreshWaypointSorting`
- `appendWaypointInput`
- `getLastEmptyWaypointInput`
- `fillLastEmptyWaypointOrAppend`
- `resetWaypointInputs`
- `getWaypointInputValues`
- `removeWaypointElement`
- `removeWaypointById`
- `initializeWaypointSorting`

Zusammenhaengende Event-Anbindungen in `js/routing.js` nutzen diesen Cluster (z. B. `.remove-waypoint`, Popup-Actions fuer Waypoints).

## 3. Welche Funktionen bewusst nicht Teil des Clusters sind
Bewusst ausserhalb des Waypoint-UI-Clusters:
- Routing-Berechnung und Darstellung (`updateMapView`, `collectAndValidateSelectedLocations`, `buildRouteResultFromSelectedLocations`, Segment-/Tooltip-Rendering)
- URL-/Planner-State-Parsen/Serialisieren in `js/map-features-layer-state.js`
- Share-Pin-Cluster in `js/map-features-share-pin.js`
- Contextmenu-Dispatcher und sonstige Popup-Actions (nur Konsumenten der Waypoint-Helfer)
- Feature-/Live-Update-Flows (Location/Path/Powerline/Region)

## 4. Welche DOM-Elemente / IDs / Klassen der Cluster nutzt
Wesentliche DOM-Kopplung:
- Container/IDs:
  - `#waypoints`
  - `#search`
- Input-/Item-Struktur:
  - `.waypoint-container`
  - `.waypoint-input`
  - `.remove-waypoint`
  - `.waypoint-drag-handle`
  - `.waypoint-drag-handle__dots`
  - `.waypoint-sort-placeholder`
- Datenschnittstellen:
  - `data-waypoint-id`
- Dynamische IDs:
  - `waypoint-input-${waypointId}`

## 5. Welche globalen Daten gelesen werden
- `locationData` (Autocomplete-Quelle)
- `waypointCounter` (ID-Erzeugung)
- `graphData` (indirekt ueber `refreshPlannerAfterFeatureChange`-Reset/Invalidierung)
- `window`/`document` (Scroll/Resize, Viewport-Berechnung)
- jQuery/jQuery UI Zustand (`ui-autocomplete`, `ui-sortable`)

## 6. Welche globalen Daten geschrieben oder mutiert werden
- `waypointCounter` wird in `createWaypointId` erhoeht
- `graphData` wird in `refreshPlannerAfterFeatureChange` auf `null` gesetzt
- DOM-Mutationen in `#waypoints` (append/remove/empty, input values)
- jQuery UI Initialisierung/Mutation:
  - `autocomplete(...)`
  - `sortable(...)`

## 7. Welche externen Funktionen der Cluster aufruft
Direkte externe Aufrufe aus dem Cluster:
- `normalizeLocationSearchName(...)`
- `isCrossingName(...)`
- `escapeHtml(...)`
- `syncPlannerStateToUrl(...)` (aus `js/map-features-layer-state.js`)
- `updateMapView(...)` (Routing-Orchestrierung in `js/routing.js`)

## 8. Welche Funktionen vermutlich von aussen gebraucht werden
Klar externe Schnittstelle (wird von anderen Dateien genutzt):
- `appendWaypointInput`
- `resetWaypointInputs`
- `getWaypointInputValues`
- `removeWaypointElement`
- `removeWaypointById`
- `initializeWaypointSorting`
- `fillLastEmptyWaypointOrAppend`
- `getWaypointContainers`
- `refreshPlannerAfterFeatureChange`

## 9. Abhaengigkeit zu `js/routing.js`
`js/routing.js` ist ein direkter Konsument:
- Event-Binding `.remove-waypoint` ruft `removeWaypointElement(...)` auf
- Popup-Action `add-location-to-route` nutzt `fillLastEmptyWaypointOrAppend(...)`
- Popup-Action `remove-waypoint` nutzt `removeWaypointById(...)`
- Initialisierung nutzt `initializeWaypointSorting(...)`, `appendWaypointInput(...)`, `resetWaypointInputs(...)`
- Route-Sammellogik liest Waypoints ueber `getWaypointContainers(...)`

Fazit: enge, aber stabile Kopplung ueber globale Funktionsnamen.

## 10. Abhaengigkeit zu `js/map-features-layer-state.js`
Zweiseitige Abhaengigkeit:
- `applyPlannerStateFromUrl()` ruft `resetWaypointInputs(...)` auf
- `buildPlannerSearchParams()` nutzt `getWaypointInputValues()`
- Waypoint-Cluster ruft `syncPlannerStateToUrl(...)` auf

Das ist eine zyklische Fachkopplung auf Funktionsebene, aber bei klassischen globalen Funktionen beherrschbar, solange die Funktionen erst zur Laufzeit aufgerufen werden.

## 11. Abhaengigkeit zu Location-Daten und Autocomplete
Starke Datenkopplung:
- Autocomplete-Liste wird direkt aus `locationData` erzeugt
- Namensabgleich erfolgt ueber `normalizeLocationSearchName(...)`
- Crossing-Eintraege werden via `isCrossingName(...)` gefiltert

Das macht den Cluster sensibel fuer Location-Name-Aenderungen und fuer Live-Updates, die ueber `refreshWaypointAutocompleteSources(...)` nachgezogen werden.

## 12. Moegliche spaetere Ziel-Datei
Bewertet:
- `js/map-features-waypoints.js`
- `js/routing-waypoints-ui.js`

Risikoaermer im aktuellen Setup:
- `js/map-features-waypoints.js`

Begruendung:
- Der Cluster haengt nicht nur an Routing, sondern auch an Planner-State-URL-Sync und Feature-Change-Refresh in `map-features`.
- `js/routing-waypoints-ui.js` wuerde fachlich zu eng an Routing koppeln und die derzeitige Verantwortungsverteilung verschieben.

## 13. Noetige Script-Reihenfolge (falls spaeter ausgelagert)
Empfehlung fuer klassischen Script-Tag-Aufbau:
1. `js/map-features-layer-state.js` (stellt `syncPlannerStateToUrl` bereit)
2. `js/map-features-waypoints.js` (neu)
3. `js/map-features.js` (Rest-Orchestrator)
4. `js/routing.js` (Konsument der Waypoint-Globals)

Wichtig: keine Top-Level-Ausfuehrung in der neuen Datei, nur Definitionen.

## 14. Risikoanalyse
- DOM-Kopplung: **hoch**
  - viele feste Selektoren und Strukturannahmen (`#waypoints`, `.waypoint-container`, `.waypoint-input`)
- Drag-and-Drop / Sortierung: **mittel bis hoch**
  - jQuery-UI-sortable Zustand/Refresh/Placeholder muss exakt erhalten bleiben
- Autocomplete: **mittel bis hoch**
  - Positionierung, Scroll-Anpassung, Responsive-Verhalten, Quelle bei Live-Aenderungen
- URL-/Planner-State: **mittel**
  - enge Interaktion mit `syncPlannerStateToUrl`, `resetWaypointInputs`, `getWaypointInputValues`
- Routen-Neuberechnung: **mittel**
  - `updateMapView()` wird von mehreren UI-Pfaden getriggert
- Mobile Bedienung: **mittel**
  - Scroll/Viewport/Autocomplete-Menue-Hoehe ist stark UI-abhaengig
- Externe Aufrufer: **hoch**
  - viele direkte Konsumenten in `routing.js` und Planner-State-Flow

## 15. Klare Empfehlung
Soll danach ein Code-Split folgen: **Ja, aber nur als enger 1:1-Schnitt**.

Minimaler spaeterer Schnitt (wenn umgesetzt):
- exakt der oben gelistete Waypoint-UI-Cluster (24 Funktionen)
- keine Routing-Berechnung, keine Layer-State-Parsing-Logik, keine Contextmenu-Dispatcher mitnehmen
- Event-Bindings in `routing.js` und `map-features.js` unveraendert lassen

Noetige Vorarbeit vor einem realen Split:
1. Vorab-Check, dass keine weiteren versteckten Aufrufer ausserhalb von `routing.js`/`map-features-layer-state.js` existieren.
2. Split strikt als 1:1-Extract ohne Umbenennungen oder Signatur-Aenderungen.
3. Anschliessender dedizierter Smoke-Zyklus fuer Add/Remove/Reorder/Autocomplete/URL-Sync/Route-Recalc (Desktop + mobil).
