# Map Features Layer Mode / Planner State Boundary Check

## 1. Zweck der Analyse

Diese Analyse dokumentiert den aktuellen Cluster fuer Kartenmodus, Planner-URL-State und zugehoerige Sichtbarkeits-Synchronisierung in `js/map-features.js`.

Ziel ist eine belastbare Grundlage fuer einen spaeteren, kleinen und verhaltensneutralen Split. Es wurden keine Funktionen verschoben und keine Logik geaendert.

## 2. Exakte Funktions-/Konstantenliste des Clusters

### Direkt im Cluster in `js/map-features.js`

- `getSelectedMapLayerMode`
- `setSelectedMapLayerMode`
- `applyDisplayOptions`
- `parseBooleanQueryParam`
- `parseNumberQueryParam`
- `readWaypointsFromUrl`
- `readSharePinFromUrl`
- `formatSharePinQueryValue`
- `clearSharePin`
- `setSharePin`
- `applyPlannerStateFromUrl`
- `getInitialPlannerSearchParams`
- `hasPlannerStateSearchParams`
- `buildPlannerSearchParams`
- `syncPlannerStateToUrl`
- Waypoint-State-Helfer im selben Fluss:
  - `createWaypointId`
  - `getWaypointContainers`
  - `getWaypointElementById`
  - `getWaypointAutocompleteSource`
  - `appendWaypointInput`
  - `resetWaypointInputs`
  - `getWaypointInputValues`
  - `removeWaypointElement`
  - `removeWaypointById`
  - `initializeWaypointSorting`
  - `fillLastEmptyWaypointOrAppend`
  - `refreshPlannerAfterFeatureChange`

### Zugehoerige Konstante/State-Quelle

- `DEFAULT_PLANNER_STATE` wird im Cluster intensiv verwendet, ist aber **nicht** in `js/map-features.js` definiert (kommt aus `js/config.js`).

### Zu den in der Aufgabe genannten Namen

Folgende Namen sind im aktuellen Ist-Zustand **nicht** als eigene Funktionen in `js/map-features.js` vorhanden, fachlich aber durch andere Funktionen abgedeckt:

- `parsePlannerRouteParam` -> abgedeckt durch `readWaypointsFromUrl` / `parseBooleanQueryParam` / `parseNumberQueryParam`
- `parsePlannerWaypointNamesParam` -> abgedeckt durch `readWaypointsFromUrl`
- `parsePlannerMarkerParam` -> abgedeckt durch `readSharePinFromUrl`
- `getPlannerStateFromUrl` -> abgedeckt durch `applyPlannerStateFromUrl`
- `serializePlannerStateToUrl` -> abgedeckt durch `buildPlannerSearchParams` + `syncPlannerStateToUrl`
- `applyPlannerStateToControls` -> abgedeckt durch `applyPlannerStateFromUrl`
- `setPlannerWaypointsForUrl` -> abgedeckt durch `buildPlannerSearchParams`
- `setPlannerMarkerForUrl` -> abgedeckt durch `buildPlannerSearchParams` / `setSharePin`
- `maybeLoadPlannerStateFromUrl` -> abgedeckt durch `applyPlannerStateFromUrl` + `getInitialPlannerSearchParams`
- `updateMapLayerModeVisibility` -> fachlich in `setSelectedMapLayerMode` / `syncRegionVisibility` / `syncPowerlineVisibility` / `syncLabelVisibility`
- `updateMapDisplayOptions` -> abgedeckt durch `applyDisplayOptions`
- `updateTransportModeVisibility` -> Transport-Control-Sync ueber `syncTransportControl` / `syncTransportControls`

## 3. Untercluster

- URL-Parsing:
  - `parseBooleanQueryParam`
  - `parseNumberQueryParam`
  - `readWaypointsFromUrl`
  - `readSharePinFromUrl`
  - `getInitialPlannerSearchParams`
  - `hasPlannerStateSearchParams`
- URL-Serialisierung:
  - `formatSharePinQueryValue`
  - `buildPlannerSearchParams`
  - `syncPlannerStateToUrl`
- UI-Control-State:
  - `applyPlannerStateFromUrl`
  - `setSelectedMapLayerMode`
  - `applyDisplayOptions`
  - Waypoint-UI-Helfer (`append/reset/remove/sorting`)
- Kartenmodus-Synchronisierung:
  - `getSelectedMapLayerMode`
  - `setSelectedMapLayerMode`
  - `syncRegionVisibility` / `syncLabelVisibility` / `syncPowerlineVisibility` (Aufrufe)
- Routen-/Wegpunkt-/Marker-State:
  - `readWaypointsFromUrl`
  - `resetWaypointInputs`
  - `getWaypointInputValues`
  - `setSharePin` / `clearSharePin`
  - `refreshPlannerAfterFeatureChange`
- Display-Optionen:
  - `applyDisplayOptions`
  - Event-Bindings fuer `#togglePaths`, `#toggleCrossings`, `#toggleNodix`, `#mapLayerModeSelect`

## 4. Welche globalen Daten gelesen werden

Direkt gelesen:

- `map`
- `pathData`
- `powerlineData`
- `locationMarkers` (indirekt ueber Waypoint-/Location-Funktionen)
- `labelMarkers` (indirekt ueber Sichtbarkeits-Sync-Aufrufe)
- `sharePinCoordinates`
- `selectedLocations`
- `graphData`
- `waypointCounter`
- `sharePinMarker`
- `IS_EDIT_MODE`
- `activeMapStyle`
- `DEFAULT_PLANNER_STATE`

Aus den Beispielpunkten:

- `currentPlannerState`: im Ist-Zustand kein eigener globaler Container mit diesem Namen
- `selectedTransportMode`: kein direkter Zugriff im Cluster (stattdessen Controls via jQuery/`syncTransportControls`)
- `routeStartSelect`, `routeEndSelect`, `routeWaypointList`: keine direkten Variablen mit diesen Namen; Zugriff erfolgt ueber `#search`/`#waypoints` und `.waypoint-input`

## 5. Welche globalen Daten geschrieben werden

- `sharePinCoordinates`
- `sharePinMarker`
- `waypointCounter`
- `graphData` (in `refreshPlannerAfterFeatureChange` auf `null`)
- Browser-URL / History-State (via `window.history.replaceState`)
- `localStorage`-Eintrag fuer Editmode-Planner-State

Zusatz: Es werden zahlreiche DOM-Control-Werte gesetzt (`#toggle...`, `#mapLayerModeSelect`, Transport-Selects, Waypoint-DOM).

## 6. Welche externen Funktionen der Cluster aufruft

Direkte, relevante Aufrufe aus dem Cluster:

- `syncLabelVisibility`
- `syncLabelIcons` (nicht direkt im URL-State-Block, aber im gleichen Sichtbarkeitskontext via map events)
- `syncPowerlineVisibility`
- `syncPowerlineLabels` (im map-zoom-Kontext)
- `syncPathLabels` (im map-zoom-Kontext)
- `updateMapView`
- `refreshAllLocationMarkerPopups` (indirekt u. a. ueber andere Planner-/Display-Pfade)
- `updateRouteWaypointList` (nicht als direkte Funktion vorhanden; fachlich ueber Waypoint-Helfer und `updateMapView` abgedeckt)
- `showFeedbackToast`

Weitere zentrale Abhaengigkeiten:

- `syncLocationMarkerVisibility`
- `syncPathVisibility`
- `syncRegionVisibility`
- `syncTransportControl`
- `syncTransportControls`
- `setMapStyle`

## 7. Welche Funktionen vermutlich von au�en gebraucht werden

Durch Aufrufstellen in `index.html`, `js/routing/routing.js`, `js/spotlight-search.js`, `js/config.js`, `js/map-features-labels.js`, `js/map-features-powerlines.js` sind mindestens extern relevant:

- `getSelectedMapLayerMode`
- `setSelectedMapLayerMode`
- `syncPlannerStateToUrl`
- `applyPlannerStateFromUrl`
- `initializeWaypointSorting`
- `appendWaypointInput`
- `resetWaypointInputs`
- `fillLastEmptyWaypointOrAppend`
- `removeWaypointById`
- `refreshPlannerAfterFeatureChange`
- `setSharePin`
- `clearSharePin`
- `getWaypointInputValues`

## 8. M�gliche sp�tere Ziel-Datei bewerten

### Option A: `js/map-features-layer-state.js`

Vorteile:

- risikoaermer im aktuellen klassischen Script-Tag-Aufbau
- klarer Zwischenzustand nahe an bestehender `map-features`-Domane
- vermeidet fruehe Vermischung mit groesserem Routing-Umbau

Nachteile:

- eher technische als fachliche Endstruktur

### Option B: `js/planner-state.js`

Vorteile:

- fachlich sauberer Name fuer URL-/Planner-Logik

Nachteile:

- hoeheres Risiko wegen breiter Kopplung an Kartenmodus-/Display-Sync aus `map-features`
- kann zu frueher Scope-Erweiterung Richtung Routing/Controls fuehren

### Bewertung

Fuer den aktuellen Zustand ist **`js/map-features-layer-state.js` risikoaermer**.

## 9. N�tige Script-Reihenfolge, falls sp�ter ausgelagert

Konservative Reihenfolge fuer spaeteren Split:

1. Basis/State/Config/Utils
2. `js/map-features-labels.js`
3. `js/map-features-powerlines.js`
4. `js/map-features-layer-state.js` (neu)
5. `js/map-features.js` (Rest-Orchestrator)
6. `js/routing/routing.js` / `js/spotlight-search.js`

Wichtig:

- keine ES-Module
- globale Funktionsnamen unveraendert
- keine Top-Level-Ausfuehrung in neuer Split-Datei

## 10. Risikoanalyse

- URL-Parameter-Kompatibilit�t: hoch
  - alte/aktuelle Query-Parameter (inkl. Legacy-Fallbacks) muessen 1:1 erhalten bleiben
- Route-Sharing: mittel bis hoch
  - Wegpunkt-Serialisierung und Reihenfolge sind nutzersichtbar
- Marker-Sharing: mittel
  - `sharePin` lesen/schreiben und Popup-Open-Verhalten
- Kartenmodus-Wechsel: mittel bis hoch
  - `mapLayerMode` beeinflusst Labels, Regionen, Powerlines und Editmode-Optionen
- Zusammenspiel mit Labels/Powerlines/Paths: hoch
  - mehrere Sichtbarkeits-Syncs greifen gleichzeitig
- Browser-History: mittel
  - `replaceState`-Verhalten darf keine Navigationsregression erzeugen
- Initialisierung beim Seitenstart: hoch
  - Load-Reihenfolge und Restore aus URL/localStorage sind kritisch

## 11. Klare Empfehlung

- **Soll danach ein Code-Split folgen?**
  - **Ja, aber nur als kleiner 1:1-Schnitt mit engem Scope.**

- **Minimaler 1:1-Schnitt (spaeter):**
  - nur URL-/Planner-State-Funktionen aus diesem Cluster in `js/map-features-layer-state.js` verschieben:
    - `parseBooleanQueryParam`
    - `parseNumberQueryParam`
    - `readWaypointsFromUrl`
    - `readSharePinFromUrl`
    - `formatSharePinQueryValue`
    - `getInitialPlannerSearchParams`
    - `hasPlannerStateSearchParams`
    - `buildPlannerSearchParams`
    - `syncPlannerStateToUrl`
    - `applyPlannerStateFromUrl`
  - Event-Bindings und Mode-Orchestrierung (`setSelectedMapLayerMode`, `applyDisplayOptions`) vorerst in `js/map-features.js` lassen.

- **Falls kein direkter Split folgt:**
  - zuerst expliziten Smoke-Zyklus fuer URL-/Share-/MapLayerMode-Regressionen festziehen (Load, Toggle, Share-Link, History, Editmode-Reload).
