# Political-Timeline Stable Split

## Zweck

Dokumentiert den engen 1:1-Extract der Political-Timeline-Helfer aus `js/map-features.js` nach `js/map-features/map-features-political-timeline.js`.

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

`js/map-features/map-features-political-timeline.js` wird nach `js/map-features.js` und vor `js/map-features/map-features-region-visibility.js` geladen.

## Smoke-Plan

1. Seite laden und Konsole pruefen.
2. Political-Mode ein/aus schalten und Timeline-Sichtbarkeit pruefen.
3. Timeline-Jahr per Slider/Input aendern.
4. Territory-Hinweisbereich (Range-Panel) pruefen.
5. Zoom/Modes wechseln und erneute Sichtbarkeit pruefen.
6. Reload und Konsole erneut pruefen.

## Smoke-Ergebnis

Political-Timeline-Smoke bestanden: Punkte 1-12 ohne Auffaelligkeiten.

Geprueft wurden Seite/Konsole, Political-Mode, Timeline-Sichtbarkeit, Rueckwechsel in einen nicht-politischen Modus, erneutes Aktivieren, Slider, Input, Synchronisierung von Slider/Input/Label, Territory-Range-Anzeige falls verfuegbar, Ausblendung von Timeline/Range sowie Reload.

## Entscheidung

Der Split ist als enger 1:1-Extract umgesetzt und per Betreiber-Smoke bestaetigt. Weitere Territory-/Timeline-Splits nur mit eigener Boundary-Analyse.
