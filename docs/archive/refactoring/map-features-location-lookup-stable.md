# Location Lookup Helper Stable Status

## 1. Zusammenfassung

Der enge 1:1-Extract `js/map-features-location-lookup.js` wurde aus `js/map-features.js` ausgelagert, um reine Location Lookup-, Typ- und Namens-Helper zu trennen.

## 2. Verschobene Funktionen

- `isCrossingName`
- `isCrossingLocation`
- `isNodixLocation`
- `getNextCrossingDisplayName`
- `getNextLocationDisplayName`
- `findLocationMarkerByName`
- `findLocationMarkerByPublicId`
- `findNearestLocationToLatLng`
- `findNearestGraphNodeToLatLng`
- `openLocationPopupByName`

## 3. Verbleibende Funktionen in `js/map-features.js`

Nicht verschoben bleiben:

- `setLocationEditActive`
- `areMapCoordinatesClose`
- `isPathEndpointAtLocation`
- `isCoordinatePairClose`
- `shiftPathEndpointsForLocationMove`
- `moveConnectedPathEndpointsForLocation`
- `saveMovedLocationMarker`
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
- `addCreatedCrossingMarker`
- `createCrossingFeatureAt`
- `createCrossingAt`
- `ensureCrossingsEnabled`

Diese Funktionen sind eng mit Location Lifecycle, Popup- und Editflows sowie Persistenz gekoppelt.

## 4. Script-Reihenfolge

`index.html` lädt `js/map-features-location-lookup.js` nach `js/map-features.js` und vor `js/map-features-region-operation-chip.js`.

## 5. Smoke-Plan

1. Karte öffnen.
2. Kreuzung und Ortsnamen-Generierung durch die Suche/Erstellung prüfen.
3. Nach nächste Orts- und Knotensuche per Location Lookup prüfen.
4. Popup-Öffnung über `openLocationPopupByName(...)` testen.
5. Konsole auf Fehler prüfen.

## 6. Smoke-Ergebnis

Location-Lookup-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.

Geprueft wurden Kartenstart, Ortsfilter/Kreuzungen/Nodix, Suche oder Ortsfokus mit Popup-Oeffnung, Naechsten-Ort-Funktion, Kreuzungs-/Ortsnamenslogik, kurze Route mit vorhandenen Orten, Reload und Browser-Konsole.

## 7. Status

- Split: umgesetzt
- Logikaenderung: keine
- Browser-Smoke: bestanden
