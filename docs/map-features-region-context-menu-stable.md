# Region Context Menu Stable Status

## 1. Zusammenfassung

Die Region Context Menu DOM/State-Helfer wurden als enger 1:1-Extract aus `js/map-features.js` in `js/map-features/map-features-region-context-menu.js` ausgelagert.

Ziel ist es, die reine DOM- und Positionierungslogik des Region-Kontextmenüs zu separieren, während die eigentlichen Actions, Geometry-Edit-Flow-Logik und Pending-Operationen im Rest verbleiben.

## 2. Verschobene Funktionen

- `getRegionContextMenuElement`
- `openRegionContextMenu`
- `closeRegionContextMenu`
- `positionContextMenuElement`

## 3. Verbleibende Funktionen in `js/map-features.js`

Nicht verschoben bleiben:

- `$(document).on("click", "[data-region-context-action]", ...)`
- `extractRegionGeometryPartAsNewTerritory`
- `startPendingRegionOperation`
- `startPendingRegionSplit`
- `startPendingRegionMove`
- `cancelPendingRegionOperation`
- `syncRegionOperationChip`
- `openRegionEditDialog`
- `startRegionGeometryEdit`
- `deleteActiveRegion`

Diese verbleibenden Funktionen sind eng mit den Region-Edit-Workflows, Context-Action-Dispatch und Pending-Operationen verbunden.

## 4. Script-Reihenfolge

`index.html` lädt `js/map-features/map-features-region-context-menu.js` nach `js/map-features.js` und vor `js/map-features/map-features-region-overlap-selection.js`.

## 5. Smoke-Plan

1. Karte öffnen und Kontextmenü für Region aktivieren.
2. Kontextmenü öffnen/Schließen testen.
3. Menüposition prüfen, wenn am Bildschirmrand geklickt wird.
4. Context-Action-Klicks ausführen und sicherstellen, dass die Actions weiter funktionieren.
5. Konsole auf Fehler prüfen.

## 6. Smoke-Ergebnis

Region-Context-Menu-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.

Geprueft wurden Kartenstart, Region-Kontextmenue, Menueposition am Rand, Context-Actions und Browser-Konsole.

## 7. Status

- Split: umgesetzt
- Logikaenderung: keine
- Smoke: bestanden
