# Region Geometry Helpers

Diese Datei dokumentiert den engen 1:1-Split der Region-Geometry-Helfer aus `js/map-features.js`.

## Was wurde ausgelagert

Aus `js/map-features.js` wurden folgende Helper-Funktionen verschoben:

- `getRegionOuterLatLngs(polygon)`
- `getPolygonLatLngRings(polygon)`
- `flattenLatLngRings(value)`
- `isLatLngLike(value)`
- `replaceMatchingNestedLatLngs(value, originalLatLng, targetLatLng)`
- `findNearestRegionVertex(latLng, ownRegion)`
- `findNearestRegionSnapPoint(latLng, ownRegion)`
- `findNearestRegionEdgePoint(latLng, ownRegion)`
- `closestPointOnSegment(point, startPoint, endPoint)`
- `regionLayerToGeoJsonGeometry(regionEntry)`
- `regionLayersToGeoJsonGeometry(layers, fallbackRegionEntry = null)`

## Warum dieser Split

Diese Funktionen sind auf Region-Geometrie und Koordinatenkonvertierung fokussiert.
Sie erscheinen als reine Hilfsfunktionen ohne top-level Ausfuehrung und sind damit gut abgrenzbar von UI-, Event- und Orchestrierungslogik in `js/map-features.js`.

## Klassische Script-Ladung

Die neue Datei `js/map-features-region-geometry-helpers.js` wird als klassisches Script in `index.html` geladen.
Sie steht vor `js/map-features-political-timeline.js` zur Verfuegung, damit die globalen Helper-Funktionen zur Laufzeit bereits definiert sind.

## Smoke-Plan

1. Browser oeffnen und Karte laden.
2. Region-Layer anzeigen und Region-Editfluss starten.
3. Region-Verschiebung oder Region-Split testen.
4. Ueberpruefen, dass keine JavaScript-Fehler in der Konsole auftreten.

## Smoke-Ergebnis

Region-Geometry-Helpers-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.

Geprueft wurden Kartenstart, Political Mode, Herrschaftsgebiete, Region-Kontextmenue, Region-Geometry-Edit, Vertex-/Geometrie-Interaktionen, Split-/Operation-Einstieg soweit unkritisch, Reload und Browser-Konsole.

## Status

- Split: umgesetzt
- Logikaenderung: keine
- Browser-Smoke: bestanden
