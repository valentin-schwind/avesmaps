# Stabilitaetsvermerk: Location-Marker-Rendering-Split

## 1. Umfang

Der Location-Marker-Rendering-Block wurde aus `js/map-features.js` in eine eigene klassische Script-Datei ausgelagert.

Code-Commit:

```text
0a0f4af1e733919c189a48e6f6ece180a14d6fb9
Split map features location marker rendering helpers
```

Neue Datei:

```text
js/map-features-location-marker-rendering.js
```

Geaendert:

```text
index.html
js/map-features-location-marker-rendering.js
js/map-features.js
```

## 2. Verschobene Funktionen

1:1 verschoben wurden:

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

Nicht verschoben wurden:

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

## 3. Script-Reihenfolge

`index.html` laedt die neue Datei im Map-Features-Block nach `js/map-features-display-mode.js` und vor `js/map-features-feature-state.js`:

```html
<script src="js/map-features-display-mode.js"></script>
<script src="js/map-features-location-marker-rendering.js"></script>
<script src="js/map-features-feature-state.js"></script>
```

Diese Reihenfolge ist akzeptabel, weil `js/map-features-location-marker-rendering.js` keine Feature-State-Funktionen nutzt und beide Dateien vor `js/map-features.js` geladen werden.

Damit bleibt die klassische globale Script-Tag-Architektur erhalten. Es wurden keine ES-Module, keine Imports und keine Exports eingefuehrt.

## 4. Pruefung

Syntaxpruefung lokal bestanden:

```text
node --check js/map-features-location-marker-rendering.js
node --check js/map-features.js
```

Beide Befehle liefen erfolgreich mit Exit Code 0 und ohne Ausgabe.

Arbeitsbaum nach Commit und Push lokal sauber:

```text
git status --short
```

war leer.

## 5. Smoke

Betreiber-Smoke nach dem Push:

```text
1-11 sieht gut aus
```

Geprueft wurden:

- Seite laden
- Browser-Konsole
- normale Orte
- Dorf-/Gebaeude-Marker bei mehreren Zoomstufen
- Zoomwechsel 0 bis 5
- Ortstyp-Filter
- Editmode-Kreuzungen
- Editmode-Nodix-Orte
- Ortsnamenlabel-Synchronisierung
- Ortspopup
- Route mit Wegpunkten

Damit gilt der Location-Marker-Rendering-Split als stabil.

## 6. Stabilitaetsregel

Der Location-Marker-Rendering-Split bleibt stabil. Die Datei `js/map-features-location-marker-rendering.js` soll nicht ohne neue Boundary erweitert werden.

Insbesondere nicht nachtraeglich in diese Datei verschieben ohne eigene Analyse:

- Location-Lifecycle
- Location-Popups
- Location-Datenmutation
- Location-Move-/Save-Flows
- Feature-Response-Dispatcher

## 7. Naechster Kandidat

Naechster Boundary-Kandidat fuer weitere `js/map-features.js`-Entschlackung:

```text
Label-Kollision
```

Dafuer sollte ein eigenes Boundary-Dokument angelegt werden, bevor Code geaendert wird.
