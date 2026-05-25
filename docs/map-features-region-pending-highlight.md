# Region Pending Highlight Split

## Zweck

Dokumentiert den engen 1:1-Extract der Target-Highlight-Helfer fuer ausstehende Region-Operationen.

## Verschobene Funktionen

- `setPendingRegionTargetHighlight`
- `clearPendingRegionTargetHighlight`

## Bewusst nicht verschoben

- `startPendingRegionOperation`
- `startPendingRegionSplit`
- `startPendingRegionMove`
- `cancelPendingRegionOperation`
- `completePendingRegionOperation`
- `handlePendingRegionSplitClick`
- `completePendingRegionSplit`
- `updatePendingRegionSplitPreview`
- `clearPendingRegionSplitPreview`
- `syncRegionOperationChip`
- `getRegionEntryLayers`
- `bindRegionPolygonEditEvents`
- `addRegionFeatureToMap`
- API-/Persistenzfunktionen
- Geometry-/Clipping-/Boolean-Funktionen

## Script-Reihenfolge

`js/map-features-region-pending-highlight.js` wird nach `js/map-features-region-split-preview.js` und vor `js/map-features-political-timeline.js` geladen.

## Smoke-Plan

1. Seite laden, Konsole pruefen.
2. Region-Operation starten (Split/Move).
3. Zielgebiet-Hover/Klick pruefen: Highlight erscheint.
4. Zielwechsel pruefen: altes Highlight wird sauber rueckgesetzt.
5. Operation abbrechen: Highlight wird entfernt.
6. Reload und Konsole erneut pruefen.
