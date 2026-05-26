# Map-Features Boundary Check: Ortsnamenlabels

## 1. Zweck der Analyse
Diese Analyse grenzt den Ortsnamenlabel-Bereich in `js/map-features.js` sauber ab, um einen spaeteren, verhaltensneutralen Split vorzubereiten. Es wird **kein Code** verschoben oder geaendert.

## 2. Exakte Funktions-/Konstantenliste des Ortsnamenlabel-Clusters
- `LOCATION_NAME_LABEL_SIZE_BY_ZOOM`
- `getLocationNameLabelSize(locationType, zoomLevel)`
- `getLocationNameLabelOffset(labelSize, zoomLevel)`
- `shouldShowLocationNameLabel(entry, zoomLevel)`
- `createLocationNameLabelIcon(entry, zoomLevel)`
- `createLocationNameLabelEntry(markerEntry)`
- `syncLocationNameLabelVisibility()`
- `addLocationNameLabel(markerEntry)`
- `ensureLocationNameLabel(markerEntry)`
- `removeLocationNameLabel(markerEntry)`

## 3. Untercluster
### Zoomgroessen
- `LOCATION_NAME_LABEL_SIZE_BY_ZOOM`
- `getLocationNameLabelSize(...)`

### Offset-Berechnung
- `getLocationNameLabelOffset(...)`

### Anzeigeentscheidung
- `shouldShowLocationNameLabel(...)`

### Icon-/Marker-Erzeugung
- `createLocationNameLabelIcon(...)`
- `createLocationNameLabelEntry(...)`

### Lifecycle an Location-Markern
- `addLocationNameLabel(...)`
- `ensureLocationNameLabel(...)`
- `removeLocationNameLabel(...)`

### Sichtbarkeits-Synchronisierung
- `syncLocationNameLabelVisibility()`

### Kollisionsanbindung
- `syncLocationNameLabelVisibility()` ruft `scheduleLabelCollisionResolution()` auf.

## 4. Global gelesene Daten
Direkt gelesen:
- `locationNameLabels`
- `map`
- `activeMapStyle`
- `IS_EDIT_MODE`
- `LOCATION_NAME_LABEL_CONFIG` (aus `js/config.js`)
- `VISUAL_MAX_ZOOM_LEVEL`, `LOCATION_LABEL_GAP` (lokale Konstanten in `map-features.js`)

Indirekt (ueber Helper/Globals):
- `locationMarkers` (Lifecycle-Bezug ueber Marker-Entries)
- `locationZoomScale(...)`, `getVisualZoomLevel(...)`
- `isLocationTypeVisible(...)` (in `index.html` definiert)
- `isCrossingLocation(...)`, `isNodixLocation(...)`
- `getMapRenderBounds()`, `isMarkerEntryInRenderBounds(...)`

Explizit **nicht** direkt im Cluster verwendet:
- `DEFAULT_PLANNER_STATE`
- `getSelectedMapLayerMode()`

## 5. Global geschriebene Daten
- `locationNameLabels` wird mutiert:
  - `push(...)` in `addLocationNameLabel(...)`
  - Re-Assignment mit Filter in `removeLocationNameLabel(...)`
- Leaflet-Layer-Status auf `map`:
  - `map.addLayer(...)`
  - `map.removeLayer(...)`
- Marker-Objekte:
  - `setLatLng(...)`
  - `setIcon(...)`

## 6. Externe Funktionsaufrufe des Clusters
- `getVisualZoomLevel(...)`
- `locationZoomScale(...)`
- `isCrossingLocation(...)`
- `isNodixLocation(...)`
- `isLocationTypeVisible(...)`
- `getMapRenderBounds()`
- `isMarkerEntryInRenderBounds(...)`
- `scheduleLabelCollisionResolution()`
- Leaflet: `L.divIcon(...)`, `L.marker(...)`
- DOM/Utility: `escapeHtml(...)`

Angrenzende Kollisionslogik (nur Abhaengigkeit, nicht Teil dieses Clusters):
- `getLocationNameLabelPriority(...)`
- `getLocationNameLabelBaseOffset(...)`
- `getLocationNameLabelOffsets(...)`
- `applyLocationNameLabelOffset(...)`
- `getCollisionEntries()`
- `resolveLabelCollisions()`

## 7. Vermutlich extern benoetigte Funktionen
Ausserhalb von `map-features.js` verwendet:
- `addLocationNameLabel(...)` (z. B. in `js/routing/routing.js`)
- `ensureLocationNameLabel(...)` (z. B. in `js/dialogs-review-editor-submit.js`)
- `syncLocationNameLabelVisibility()` (z. B. in `js/routing/routing.js`, intern vielfach)

Prim�r intern genutzt, aber weiter global verfuegbar:
- `removeLocationNameLabel(...)`
- `createLocationNameLabelEntry(...)`
- `createLocationNameLabelIcon(...)`
- `shouldShowLocationNameLabel(...)`
- `getLocationNameLabelOffset(...)`
- `getLocationNameLabelSize(...)`

## 8. Abhaengigkeit zu freien Labels (`js/map-features-labels.js`)
- Freie Labels sind bereits nach `js/map-features-labels.js` ausgelagert (`labelData`, `labelMarkers`, freie Label-CRUD/Visibility/Icon-Flow).
- Ortsnamenlabels arbeiten weiterhin mit separatem State (`locationNameLabels`) und eigener Icon-/Lifecycle-Logik.
- Beruehrungspunkt freie Labels <-> Ortsnamenlabels ist vor allem die Kollisionslogik in `map-features.js`:
  - `getCollisionEntries()` kombiniert `labelMarkers` (freie Labels) und `locationNameLabels` (Ortsnamenlabels).
  - `scheduleLabelCollisionResolution()` wird sowohl aus freien Labels als auch aus Ortsnamenlabels aufgerufen.

## 9. Moegliche spaetere Ziel-Datei
Bewertung:
- `js/map-features-location-name-labels.js`: **risikoaermer**
  - klare fachliche Trennung (freie Labels vs. Ortsnamenlabels)
  - keine Aufweichung des bereits stabilisierten Free-Label-Splits
- Erweiterung von `js/map-features-labels.js`: hoeheres Risiko
  - mischt zwei verschiedene Label-Subdom�nen wieder zusammen
  - erschwert spaetere, getrennte Aenderungen und Smoke-Zyklen

## 10. N�tige Script-Reihenfolge bei spaeterer Auslagerung
Risikoarme Reihenfolge (klassische globale Scripts):
1. `js/map-features-labels.js`
2. `js/map-features-powerlines.js`
3. `js/map-features-layer-state.js`
4. `js/map-features-location-name-labels.js` (neu)
5. `js/map-features.js`

Begruendung:
- `map-features.js` kann dann weiterhin die ausgelagerten Ortsnamenlabel-Funktionen aufrufen.
- Keine ES-Module notwendig.
- Top-Level-Ausfuehrung muss im neuen File vermieden werden (nur Funktionsdefinitionen).

## 11. Risikoanalyse
- Location-Marker-Lifecycle: mittel
  - `add/ensure/remove` haengen direkt an Create/Update/Delete-Flows von Orten.
- Zoom-/Style-Abhaengigkeit: mittel
  - `activeMapStyle`, `LOCATION_NAME_LABEL_CONFIG`, Zoom-Skalierung muessen 1:1 bleiben.
- Collision-Timing: hoch
  - `scheduleLabelCollisionResolution()` nutzt `requestAnimationFrame`; Reihenfolge-/Timingfehler waeren sichtbar.
- Label-Offset-Reset: mittel
  - Offsets werden in der Kollisionslogik dynamisch gesetzt/zurueckgesetzt.
- Deregraphischer Kartenmodus: niedrig bis mittel
  - kein direkter Check im Cluster, aber indirekte Sichtbarkeitskopplung ueber globale Anzeigezustaende.
- Editmode: mittel
  - `IS_EDIT_MODE` beeinflusst Nodix-Sichtbarkeit.
- Zusammenspiel mit freien Labels: hoch
  - gemeinsamer Kollisionsraum ueber `getCollisionEntries()`.

## 12. Empfehlung
- **Jetzt kein Code-Split direkt nach dieser Analyse.**
- Erstes sinnvolles Folgefenster: kleiner, 1:1-Split **nur** des Ortsnamenlabel-Clusters (die 10 oben gelisteten Konstanten/Funktionen) nach `js/map-features-location-name-labels.js`.
- Kollisionslogik (`getCollisionEntries`, `resolveLabelCollisions`, Offsets/Prioritaeten) vorerst in `js/map-features.js` belassen und nur als bestehende Abhaengigkeit nutzen.
- Vorarbeit vor Code-Split:
  - enger Smoke-Plan fuer Location-Lifecycle + Label-Sichtbarkeit + Collision-Verhalten
  - expliziter Check, dass `addLocationNameLabel`, `ensureLocationNameLabel`, `syncLocationNameLabelVisibility` weiterhin global verfuegbar bleiben.
