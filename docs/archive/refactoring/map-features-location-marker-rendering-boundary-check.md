# Map-Features Location-Marker-Rendering Boundary Check

## 1. Zweck

Diese Boundary-Analyse prueft einen moeglichen Split aus `js/map-features.js` fuer Location-Marker-Rendering und Sichtbarkeit.

Der Kandidat ist fachlich enger als der grobe Location-Marker-/Ortsdatenblock. Es geht nicht um Location-Lifecycle, Popups, API-Updates oder Datenmutation, sondern nur um:

- Zoom-/Groessenlogik fuer Marker
- Dorf-/Gebaeude-Spezialdarstellung
- Marker-Icon-Erzeugung
- Sichtbarkeitsentscheidung je Marker
- Render-Bounds-Helfer
- Synchronisierung der Marker-Sichtbarkeit

Der Split waere ein klassischer globaler Script-Split ohne ES-Module und ohne Logikaenderung.

## 2. Kandidatenfunktionen

Zu pruefende Funktionen aus dem Dateianfang von `js/map-features.js`:

- `getVisualZoomLevel`
- `locationZoomScale`
- `getVillageMarkerStyle`
- `getBuildingMarkerStyle`
- `isVillageMarkerStyleLocation`
- `getLocationMarkerSize`
- `getLocationMarkerBorderWidth`
- `createLocationMarkerIcon`
- `shouldShowLocationMarker`
- `syncLocationMarkerVisibility`
- `getMapRenderBounds`
- `isLatLngInRenderBounds`
- `isMarkerEntryInRenderBounds`

## 3. Verantwortlichkeiten

### Zoom- und Skalierungslogik

- `getVisualZoomLevel`
- `locationZoomScale`

Diese Funktionen kapseln die visuelle Zoomstufe und die Skalierung der Marker. Sie sind nicht Location-Datenmutation, sondern reines Rendering-Verhalten.

### Marker-Stil je Ortstyp

- `getVillageMarkerStyle`
- `getBuildingMarkerStyle`
- `isVillageMarkerStyleLocation`
- `getLocationMarkerSize`
- `getLocationMarkerBorderWidth`

Diese Funktionen berechnen Groessen, Radien und Border-Werte fuer verschiedene Ortstypen. Sie haengen an `LOCATION_TYPE_CONFIG`, `CROSSING_LOCATION_TYPE` und am aktuellen Zoom.

### Icon-Erzeugung

- `createLocationMarkerIcon`

Diese Funktion baut `L.divIcon(...)` fuer Ortsmarker. Sie ist visuell wichtig, aber fachlich eng mit Marker-Rendering verbunden.

### Sichtbarkeit und Render-Bounds

- `shouldShowLocationMarker`
- `syncLocationMarkerVisibility`
- `getMapRenderBounds`
- `isLatLngInRenderBounds`
- `isMarkerEntryInRenderBounds`

Diese Funktionen entscheiden, ob Marker sichtbar sind, setzen Icons bei Zoomwechseln neu und begrenzen Rendering auf den aktuellen Kartenausschnitt plus Padding.

## 4. Gelesene globale Daten

Der Kandidatenblock liest:

- `map`
- `LOCATION_TYPE_CONFIG`
- `CROSSING_LOCATION_TYPE`
- `IS_EDIT_MODE`
- `locationMarkers`
- DOM-Zustaende via jQuery:
  - `#toggleCrossings`
  - `#toggleNodix`

Indirekt oder ueber Hilfsfunktionen:

- `isLocationTypeVisible(...)`
- `isNodixLocation(...)`
- `syncLocationToggleButtons(...)`
- `syncLocationNameLabelVisibility(...)`

## 5. Geschriebene globale Daten

Direkt mutiert der Kandidatenblock keine eigenen Datenarrays.

Er veraendert aber Karten-/Layer-Zustand:

- `map.addLayer(entry.marker)`
- `map.removeLayer(entry.marker)`
- `entry.marker.setIcon(...)`

Das ist Rendering-State, keine Datenmutation.

## 6. Externe Abhaengigkeiten

Der Kandidatenblock benoetigt:

- `buildHtmlAttributes(...)`
- `isLocationTypeVisible(...)`
- `isNodixLocation(...)`
- `syncLocationToggleButtons(...)`
- `syncLocationNameLabelVisibility(...)`
- `L.divIcon(...)`
- `L.latLng(...)`

Ein Teil dieser Funktionen bleibt in `js/map-features.js` oder anderen globalen Dateien. Das ist im bestehenden Script-Modell akzeptabel, solange die Funktionen erst zur Laufzeit aufgerufen werden und die Script-Reihenfolge stabil bleibt.

## 7. Externe Aufrufer

Die Kandidatenfunktionen werden voraussichtlich von mehreren Bereichen genutzt:

- `createEditablePointMarkerEntry(...)` nutzt `createLocationMarkerIcon(...)`.
- `refreshLocationMarkerPopup(...)` nutzt `createLocationMarkerIcon(...)`.
- Zoom-/Toggle-/Mode-Flows nutzen `syncLocationMarkerVisibility(...)`.
- andere Marker-/Nearest-/Visibility-Flows koennen `getMapRenderBounds(...)` oder `isMarkerEntryInRenderBounds(...)` verwenden.

Vor einem Code-Split sollte lokal repositoryweit gesucht werden:

```text
getVisualZoomLevel
locationZoomScale
getVillageMarkerStyle
getBuildingMarkerStyle
isVillageMarkerStyleLocation
getLocationMarkerSize
getLocationMarkerBorderWidth
createLocationMarkerIcon
shouldShowLocationMarker
syncLocationMarkerVisibility
getMapRenderBounds
isLatLngInRenderBounds
isMarkerEntryInRenderBounds
```

## 8. Vorgeschlagene Zieldatei

Empfohlene Datei:

```text
js/map-features-location-marker-rendering.js
```

Begruendung:

- Der Name grenzt bewusst vom groesseren Location-Lifecycle ab.
- Der Block enthaelt Rendering, Icon-Erzeugung, Zoom-Skalierung und Sichtbarkeit.
- `location-markers.js` waere zu breit und koennte faelschlich Location-Datenmutation oder Popup-Lifecycle suggerieren.

Alternative:

```text
js/map-features-location-visibility.js
```

Diese Alternative ist zu eng, weil `createLocationMarkerIcon(...)` und Groessenlogik mehr als reine Sichtbarkeit sind.

## 9. Script-Reihenfolge

Empfohlene Position in `index.html`:

```text
js/map-features-display-mode.js
js/map-features-feature-state.js
js/map-features-location-marker-rendering.js
js/map-features-share-pin.js
...
js/map-features.js
```

Begruendung:

- Die neue Datei muss vor `js/map-features.js` geladen werden, weil `map-features.js` weiterhin Location-Lifecycle-Funktionen enthaelt, die `createLocationMarkerIcon(...)` nutzen.
- Sie sollte nach Display-/State-Helfern geladen werden.
- Sie muss vor keinem bekannten schon ausgelagerten Rendering-Modul liegen, solange keine dieser Dateien die neuen Funktionen frueh beim Laden aufruft.

## 10. Risiko

### Syntaxrisiko

Niedrig.

Die Funktionen sind normale Function-Declarations und koennen voraussichtlich 1:1 verschoben werden.

### Laufzeitrisiko

Mittel.

Der Block haengt an vielen globalen Symbolen (`map`, `LOCATION_TYPE_CONFIG`, `L`, `locationMarkers`, jQuery). Das ist im Projekt normal, muss aber per Script-Reihenfolge abgesichert werden.

### UI-/Rendering-Risiko

Mittel.

Marker-Groessen, Sichtbarkeit und Icon-Erzeugung sind direkt sichtbar. Kleine Fehler zeigen sich in falschen Markern, fehlenden Kreuzungen, falscher Dorf-/Gebaeude-Darstellung oder nicht aktualisierten Icons nach Zoomwechseln.

### Datenrisiko

Niedrig.

Der Kandidatenblock mutiert keine Location-Daten und keine Path-Daten.

### Editmode-Risiko

Mittel.

Kreuzungen und Nodix-Orte haengen an Editmode-Toggles. Deshalb muss der Smoke Editmode und Nicht-Editmode unterscheiden.

## 11. Empfohlener Smoke

Nach einem Code-Split testen:

1. Seite laden.
2. Browser-Konsole pruefen: keine `ReferenceError`, keine `SyntaxError`.
3. Normale Orte sichtbar.
4. Dorf-/Gebaeude-Marker bei mehreren Zoomstufen pruefen.
5. Zoomwechsel 0 bis 5: Marker-Groessen plausibel.
6. Ortstyp-Filter durchschalten.
7. Editmode: Kreuzungen ein-/ausblenden.
8. Editmode: Nodix-Orte ein-/ausblenden.
9. Ortsnamenlabels bleiben nach Marker-Sichtbarkeitswechseln synchron.
10. Popup eines Orts oeffnen, Marker bleibt korrekt dargestellt.
11. Route mit Wegpunkten kurz testen, weil Location-Sichtbarkeit indirekt Planner-Flows beruehrt.

## 12. Entscheidung

Empfehlung: Split durchfuehren, aber nur als enger 1:1-Extract.

Zu verschieben:

- `getVisualZoomLevel`
- `locationZoomScale`
- `getVillageMarkerStyle`
- `getBuildingMarkerStyle`
- `isVillageMarkerStyleLocation`
- `getLocationMarkerSize`
- `getLocationMarkerBorderWidth`
- `createLocationMarkerIcon`
- `shouldShowLocationMarker`
- `syncLocationMarkerVisibility`
- `getMapRenderBounds`
- `isLatLngInRenderBounds`
- `isMarkerEntryInRenderBounds`

Nicht verschieben:

- `refreshLocationMarkerPopup`
- `refreshAllLocationMarkerPopups`
- `createEditablePointMarkerEntry`
- `applyFeatureResponseToMarker`
- `editLocationDetails`
- `convertCrossingToLocation`
- `deleteLocationMarker`
- `addCreatedLocationMarker`
- `applyLiveLocationFeature`
- `createLocationAt`
- Location-Move-/Save-Flows
- Popup-Actions
- Feature-Response-Dispatcher

## 13. Offene Pruefung vor Code-Split

Vor dem Code-Split lokal pruefen:

```powershell
git grep -n "getVisualZoomLevel\|locationZoomScale\|getVillageMarkerStyle\|getBuildingMarkerStyle\|isVillageMarkerStyleLocation\|getLocationMarkerSize\|getLocationMarkerBorderWidth\|createLocationMarkerIcon\|shouldShowLocationMarker\|syncLocationMarkerVisibility\|getMapRenderBounds\|isLatLngInRenderBounds\|isMarkerEntryInRenderBounds"
```

Ziel:

- feststellen, ob eine schon ausgelagerte Datei frueher geladen werden muss
- keine uebersehenen Abhaengigkeiten
- Script-Reihenfolge absichern

## 14. Empfohlener naechster Code-Schritt

Naechster Commit nach dieser Boundary:

```text
Split map features location marker rendering helpers
```

Minimaler Inhalt:

- neue Datei `js/map-features-location-marker-rendering.js`
- oben genannte Funktionen aus `js/map-features.js` 1:1 verschoben
- Script-Tag in `index.html` eingefuegt
- keine weiteren Dateien

Danach gezielter Marker-/Zoom-/Sichtbarkeits-Smoke.
