# Map-Features Boundary Check: Path-Rendering und Path-Lifecycle

## 1. Zweck der Analyse
Diese Analyse grenzt den Path-Rendering-/Lifecycle-Bereich in `js/map-features.js` fuer einen moeglichen spaeteren, verhaltensneutralen Split ab. Es wird kein Code geaendert oder verschoben.

## 2. Exakte Funktionsliste des Path-Rendering-/Lifecycle-Clusters
Gefundene Funktionen im aktuellen Stand:
- `normalizePathSubtype(value)`
- `getPathDisplayName(path)`
- `getPathPublicId(path)`
- `syncPathVisibility()`
- `createPathPopupMarkup(path)`
- `updatePathLayerStyle(path)`
- `getPathVisualLatLngCoordinates(coordinates, zoomLevel)`
- `refreshPathLayerPopup(path)`
- `createPathLayer(path)`
- `normalizeRoutePathFeature(feature, pathId)`
- `preparePathData(data)`
- `applyLivePathFeature(feature)`
- `updatePathLayerGeometry(path)`
- `applyPathFeatureResponse(path, feature)`
- `removePathFeature(path)`
- `deletePathFeature(path)`

Wichtig zur Scope-Klaerung:
- `normalizePathFeature` ist **nicht** als eigene Funktion vorhanden; fachlich entspricht `normalizeRoutePathFeature(...)` dieser Rolle.
- `getPathColor`, `getPathWeight`, `getPathClassName` sind im Ist-Stand **nicht** vorhanden; stattdessen wird `getPathStyleColors(path)` genutzt.

## 3. Untercluster
### Normalisierung
- `normalizePathSubtype(...)`
- `normalizeRoutePathFeature(...)`

### Public-ID / Anzeigename
- `getPathPublicId(...)`
- `getPathDisplayName(...)`

### Styling
- `updatePathLayerStyle(...)`
- (intern genutzt: `getPathStyleColors(...)` als benachbarter Helper)

### Geometrie / visuelle Koordinaten
- `getPathVisualLatLngCoordinates(...)`
- `updatePathLayerGeometry(...)`

### Leaflet-Layer-Erzeugung
- `createPathLayer(...)`

### Popup-Erzeugung und Popup-Refresh
- `createPathPopupMarkup(...)`
- `refreshPathLayerPopup(...)`

### Sichtbarkeits-Synchronisierung
- `syncPathVisibility()`

### Live-Update / Feature-Response
- `applyLivePathFeature(...)`
- `applyPathFeatureResponse(...)`

### Delete-/Cleanup-Flows
- `removePathFeature(...)`
- `deletePathFeature(...)`

## 4. Global gelesene Daten
- `pathData`
- `pathLayers`
- `map`
- `IS_EDIT_MODE`
- `PATH_RENDER_CONFIG`
- `VISUAL_LINE_CATMULL_ROM_CONFIG`
- `activePathGeometryEdit` (indirekt relevant im Delete-/Edit-Flow)

Nicht direkt in den Kernfunktionen gelesen:
- `activeMapStyle`

## 5. Global geschriebene oder mutierte Daten
- `pathData` (ersetzen/append/filter)
- `pathLayers` (append/filter)
- Pfadobjekte werden mutiert:
  - `_layerGroup`, `_pathLines`, `_pathLabelLine`
  - `id`, `geometry`, `properties`
- Leaflet-Layer auf `map` werden hinzugefuegt/entfernt

## 6. Externe Funktionsaufrufe des Clusters
Direkt aufgerufen:
- `refreshPathLayerText(...)` (aus `js/map-features-path-labels.js`)
- `getReadablePathLabelLatLngCoordinates(...)` (aus `js/map-features-path-labels.js`)
- `smoothLineCoordinatesForDisplay(...)`
- `locationPopupMarkup(...)`
- `locationPopupActionsMarkup(...)`
- `popupActionButtonMarkup(...)`
- `syncPathLabels()` (aus `js/map-features-path-labels.js`, via `syncPathVisibility`)
- `syncPathTransportOptions(...)`
- `refreshPlannerAfterFeatureChange(...)`
- `submitMapFeatureEdit(...)`
- `updateRevisionFromEditResponse(...)`
- `showFeedbackToast(...)`

## 7. Welche Funktionen vermutlich von aussen gebraucht werden
Sicher extern genutzt (andere Dateien):
- `normalizePathSubtype(...)`
- `getPathDisplayName(...)`
- `getPathPublicId(...)`
- `syncPathVisibility()`
- `preparePathData(...)`
- `deletePathFeature(...)`
- `getPathVisualLatLngCoordinates(...)`
- `applyPathFeatureResponse(...)`

Vermutlich intern gebunden, aber global verfuegbar:
- `createPathLayer(...)`
- `refreshPathLayerPopup(...)`
- `updatePathLayerStyle(...)`
- `updatePathLayerGeometry(...)`
- `removePathFeature(...)`

## 8. Abhaengigkeit zu `js/map-features-path-labels.js`
Vom Rendering-/Lifecycle-Cluster werden aus `js/map-features-path-labels.js` genutzt:
- `refreshPathLayerText(...)`
- `getReadablePathLabelLatLngCoordinates(...)`
- `syncPathLabels()`

Zwingende Reihenfolge:
- `js/map-features-path-labels.js` muss vor `js/map-features.js` geladen werden.

## 9. Abhaengigkeit zu Routing und Spotlight/Search
Direkte Nutzungen in anderen Bereichen:
- Routing (`js/routing/routing.js`):
  - `preparePathData(...)`
  - `deletePathFeature(...)`
  - `normalizePathSubtype(...)`
- Spotlight/Search (`js/spotlight-search.js`):
  - `syncPathVisibility()`
  - `getPathDisplayName(...)`
  - `getPathPublicId(...)`
  - `getPathVisualLatLngCoordinates(...)`
  - `normalizePathSubtype(...)`

Erhaltenswerte Globals fuer Kompatibilitaet:
- oben genannte Funktionsnamen muessen global verfuegbar bleiben.

## 10. Moegliche spaetere Ziel-Datei bewerten
Option A: `js/map-features-paths.js`
- Vorteil: fachlich kohaerenter Path-Cluster (Rendering + Lifecycle + CRUD-nahe Pfadlogik).
- Risiko: groesserer Diff, viele Querverweise (Routing/Spotlight/Dialog/Edit/Popup).

Option B: vorerst in `js/map-features.js` belassen
- Vorteil: geringstes Risiko kurzfristig.

Risikoaermste Fortschrittsvariante:
- spaeterer enger 1:1-Extract nach `js/map-features-paths.js`, aber nur nach weiterer Sub-Boundary/Smoke-Vorbereitung.

## 11. Noetige Script-Reihenfolge bei spaeterer Auslagerung
Bei spaeterem Split in `js/map-features-paths.js`:
1. `js/map-features-labels.js`
2. `js/map-features-powerlines.js`
3. `js/map-features-layer-state.js`
4. `js/map-features-location-name-labels.js`
5. `js/map-features-path-labels.js`
6. `js/map-features-paths.js` (neu)
7. `js/map-features.js` (Rest-Orchestrator)

## 12. Risikoanalyse
- Leaflet-Layer-Lifecycle: hoch
  - `_layerGroup`, `_pathLines`, `_pathLabelLine` muessen konsistent bleiben.
- Popup-Bindings: mittel bis hoch
  - Popup-Actions haengen an Public-ID und Edit-Mode-Status.
- TextPath-Anbindung: mittel
  - Abhaengigkeit zu ausgelagertem Path-Label-Cluster und Reihenfolge.
- Route-/Graph-Abhaengigkeit: hoch
  - `preparePathData`, Update-/Delete-Flows sind fuer Routing kritisch.
- Editmode und Review-Flows: hoch
  - Dialog-/Submit-Flows rufen Path-Response-Funktionen direkt auf.
- Live-Feature-Updates: hoch
  - `applyLivePathFeature`/`applyPathFeatureResponse` sind laufzeitkritisch.
- Delete-/Cleanup-Fehler: hoch
  - Inkonsistente `pathData/pathLayers` koennen Folgefehler erzeugen.
- Performance bei vielen Pfaden: mittel
  - `syncPathVisibility` und `syncPathRendering` iterieren ueber alle Pfade.

## 13. Klare Empfehlung
- **Jetzt kein direkter Code-Split.**
- Erst Vorarbeit:
  - enger Smoke-Plan fuer Path-Create/Update/Delete, Popup-Actions, Zoom/Visibility, Live-Updates
  - Sub-Boundary fuer moeglichen Minimal-Schnitt innerhalb des Path-Clusters
- Falls danach Split: kleinster sinnvoller 1:1-Schnitt waere zunaechst nur "Rendering-Grundlagen" ohne Delete-/Live-Update (z. B. `createPathLayer`, `updatePathLayerStyle`, `updatePathLayerGeometry`, `refreshPathLayerPopup`, `getPathVisualLatLngCoordinates`) und Lifecycle/Response vorerst im Orchestrator belassen.
