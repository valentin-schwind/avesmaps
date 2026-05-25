# Region Operation Chip Stable Status

## 1. Zusammenfassung

Der Region Operation Chip UI-Helfer `syncRegionOperationChip` wurde als enger 1:1-Extract aus `js/map-features.js` in `js/map-features-region-operation-chip.js` ausgelagert.

Ziel ist es, die UI-Visualisierung des aktuellen Pending-Region-Operations-Chips zu trennen, während die eigentlichen Pending-Operationen, Move/Split/Boolean-Logik, Preview-Handling und Persistenz im Rest verbleiben.

## 2. Verschobene Funktion

- `syncRegionOperationChip`

## 3. Verbleibende Funktionen in `js/map-features.js`

Nicht verschoben bleiben:

- `cancelPendingRegionOperation`
- `startPendingRegionOperation`
- `startPendingRegionSplit`
- `startPendingRegionMove`
- `handlePendingRegionMoveMouseMove`
- `handlePendingRegionMoveClick`
- `applyPendingRegionMoveDelta`
- `completePendingRegionMove`
- `cancelPendingRegionMove`
- `cloneNestedLatLngs`
- `offsetNestedLatLngs`
- `getRegionEntryLayers`
- `setPendingRegionTargetHighlight`
- `clearPendingRegionTargetHighlight`
- `handlePendingRegionSplitClick`
- `completePendingRegionSplit`
- `updatePendingRegionSplitPreview`
- `clearPendingRegionSplitPreview`
- `buildRegionSplitCutterGeometry`
- `calculateClippingPolygonArea`
- `calculateClippingRingArea`
- `completePendingRegionOperation`

Diese verbleibenden Funktionen sind eng mit Move/Split/Boolean-Operationen, Geometrie-Preview und Persistenz verbunden.

## 4. Script-Reihenfolge

`index.html` lädt `js/map-features-region-operation-chip.js` nach `js/map-features.js` und vor `js/map-features-region-context-menu.js`.

## 5. Smoke-Plan

1. Karte öffnen.
2. Region-Operation starten (Move oder Split).
3. prüfen, ob der Operation Chip sichtbar wird und den richtigen Text zeigt.
4. Operation abbrechen oder abschließen und prüfen, ob der Chip verschwindet.
5. Konsole auf Fehler prüfen.

## 6. Smoke-Ergebnis

Region-Operation-Chip-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.

Geprueft wurden Kartenstart, Start einer Region-Operation, Sichtbarkeit und Text des Operation-Chips, Abbruch oder Abschluss der Operation, Ausblendung des Chips und Browser-Konsole.

## 7. Status

- Split: umgesetzt
- Logikaenderung: keine
- Smoke: bestanden
