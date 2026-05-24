# Political-Timeline Stable Split

## Zweck

Dokumentiert den engen 1:1-Extract der Political-Timeline-Helfer aus `js/map-features.js` nach `js/map-features-political-timeline.js`.

## Verschobene Funktionen

- `syncPoliticalTimelineVisibility`
- `syncPoliticalTimelineControls`
- `formatPoliticalTimelineYear`
- `setPoliticalTimelineYear`
- `showPoliticalTerritoryTimelineSelection`
- `clearPoliticalTerritoryTimelineSelection`
- `normalizePoliticalTimelineYearValue`
- `formatPoliticalTerritoryRangeLabel`

## Bewusst nicht verschoben

- `schedulePoliticalTerritoryLayerReload`
- `cancelPoliticalTerritoryLayerReload`
- `loadPoliticalTerritoryLayer`
- `loadPoliticalTerritoryOptions`
- `preloadPoliticalTerritoryOptions`
- `createRegionLabelMarkup`
- `createRegionCompactTooltipMarkup`
- `createRegionWikiInfoBoxMarkup`
- Region-Geometry-/Context-/Operation-Funktionen

## Script-Reihenfolge

`js/map-features-political-timeline.js` wird nach `js/map-features.js` und vor `js/map-features-region-visibility.js` geladen.

## Smoke-Plan

1. Seite laden und Konsole pruefen.
2. Political-Mode ein/aus schalten und Timeline-Sichtbarkeit pruefen.
3. Timeline-Jahr per Slider/Input aendern.
4. Territory-Hinweisbereich (Range-Panel) pruefen.
5. Zoom/Modes wechseln und erneute Sichtbarkeit pruefen.
6. Reload und Konsole erneut pruefen.

## Entscheidung

Der Split ist als enger 1:1-Extract umgesetzt. Weitere Territory-/Timeline-Splits nur mit eigener Boundary-Analyse.
