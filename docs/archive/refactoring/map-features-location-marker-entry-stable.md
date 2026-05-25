# Location Marker Entry Helper Stable Status

## 1. Zusammenfassung

Der enge 1:1-Extract `js/map-features-location-marker-entry.js` wurde aus `js/map-features.js` ausgelagert, um reine Location Marker Entry- und Popup-Refresh-Helper zu trennen.

## 2. Verschobene Funktionen

- `refreshLocationMarkerPopup`
- `refreshAllLocationMarkerPopups`
- `createEditablePointMarkerEntry`

## 3. Verbleibende Funktionen in `js/map-features.js`

Nicht verschoben bleiben:

- `saveMovedLocationMarker`
- `setLocationEditActive`
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

Diese Funktionen sind eng mit Location Move-, Create/Delete-, API-Persistenz- und Planner-Refresh-Flows verbunden.

## 4. Script-Reihenfolge

`index.html` lädt `js/map-features-location-marker-entry.js` nach `js/map-features-location-lookup.js` und vor `js/map-features-region-operation-chip.js`.

## 5. Smoke-Plan

1. Karte öffnen.
2. Marker-Popup-Aktualisierung für Orte und Kreuzungen prüfen.
3. Marker-Erstellung im Edit-Modus über `createEditablePointMarkerEntry(...)` testen.
4. Dragend-Speicherung testen und sicherstellen, dass `saveMovedLocationMarker(...)` unverändert in `js/map-features.js` bleibt.
5. Konsole auf Fehler prüfen.

## 6. Smoke-Ergebnis

Location-Marker-Entry-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.

Geprueft wurden Kartenstart, Orts- und Kreuzungs-Popups, Popup-Actions, Popup-Aktualisierung nach Bearbeitung, Marker-Dragend-Speicherung, Kreuzungserstellung, Reload und Browser-Konsole.

## 7. Status

- Split: umgesetzt
- Logikaenderung: keine
- Browser-Smoke: bestanden
