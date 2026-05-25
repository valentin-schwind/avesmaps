# Region Overlap Selection Stable Status

## 1. Zusammenfassung

Die Region Overlap Selection-Helfer wurden als enger 1:1-Extract aus `js/map-features.js` in `js/map-features-region-overlap-selection.js` ausgelagert.

Ziel ist es, die reine Treffer- und Auswahllogik für überlagerte politische Regionen zu separieren, während Context-Menü-Handling, Region-Edit und Pending-Operationen im Rest verbleiben.

## 2. Verschobene Funktionen

- `getRegionLayerGeometryPublicId`
- `isLatLngInsideRegionRing`
- `isLatLngInsideRegionLayer`
- `getOverlappingPoliticalRegionLayersAtLatLng`
- `resolveOverlappingRegionLayerSelection`
- `announceOverlappingRegionSelection`

## 3. Verbleibende Funktionen in `js/map-features.js`

Nicht verschoben bleiben:

- `bindRegionPolygonEditEvents`
- `openRegionContextMenu`
- `closeRegionContextMenu`
- `getRegionContextMenuElement`
- `positionContextMenuElement`
- `focusRegionPlace`
- `bindRegionCompactTooltip`
- `openRegionCompactTooltip`
- `closeRegionCompactTooltip`
- `getRegionTooltipLatLng`
- `createRegionLabelMarkup`

Diese verbleibenden Funktionen sind eng mit Kontextmenüs, Region-Edit-Flow und Tooltip-Lifecycle verbunden.

## 4. Script-Reihenfolge

`index.html` lädt `js/map-features-region-overlap-selection.js` nach `js/map-features.js` und vor `js/map-features-region-info-markup.js`.

## 5. Smoke-Plan

1. Karte öffnen und in den politischen Layer wechseln.
2. Auf eine überlagerte Region klicken und prüfen, ob Auswahl und Anzeige korrekt sind.
3. Wiederholt auf dieselbe Stelle klicken, um zwischen überlagerten Regionen zu wechseln.
4. Context-Menü-/Tooltip-Interaktionen prüfen, um sicherzustellen, dass nur die overlap-Logik ausgelagert ist.
5. Konsole auf Fehler prüfen.

## 6. Smoke-Ergebnis

Region-Overlap-Selection-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.

Geprueft wurden Karte, ueberlagerte politische Regionen, Wechsel der Auswahl zwischen ueberlagerten Regionen, Tooltip-/Context-Menue-Interaktionen und Browser-Konsole.

## 7. Status

- Split: umgesetzt
- Logikaenderung: keine
- Smoke: bestanden
