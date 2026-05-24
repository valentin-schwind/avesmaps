# Political-Territory Loader/Reload Stable Status

## 1. Zusammenfassung

Der Political-Territory Loader/Reload wurde als enger 1:1-Extract aus `js/map-features.js` in `js/map-features/map-features-political-territory-loader.js` ausgelagert.

Das Ziel dieser Separation ist, die API-/Reload-Logik vom Rest der `js/map-features.js`-Regionen- und Timeline-Logik zu trennen, ohne Rendering-, Geometrie-, Tooltip- oder Context-Funktionalität zu verschieben.

## 2. Verschobene Funktionen

- `schedulePoliticalTerritoryLayerReload`
- `cancelPoliticalTerritoryLayerReload`
- `loadPoliticalTerritoryLayer`
- `loadPoliticalTerritoryOptions`
- `preloadPoliticalTerritoryOptions`

## 3. Verbleibende Funktionen in `js/map-features.js`

Nicht verschoben bleiben unter anderem:

- `addRegionFeatureToMap`
- `normalizeRegionFeature`
- `clearRenderedRegionLayers`
- `syncRegionVisibility`
- `clearPoliticalTerritoryTimelineSelection`
- `fetchPoliticalTerritories`
- `fetchWikiSyncTerritoryData`
- `createRegionLabelMarkup`
- `bindRegionCompactTooltip`
- Region-Tooltip-/Context-/Geometry-/Operation-Funktionen

Diese verbleibenden Bereiche sind bewusst im Rest belassen, weil sie stark mit Region-Rendering, Timeline-State und Geo-Operationen gekoppelt sind.

## 4. Script-Reihenfolge

`index.html` lädt `js/map-features/map-features-political-territory-loader.js` nach `js/map-features/map-features-region-visibility.js` und vor `js/map-features/map-features-feature-dispatcher.js`.

## 5. Smoke-Plan

1. Karte öffnen und zur politischen Lage wechseln.
2. Timeline-Jahr ändern und sicherstellen, dass neu geladene Territorien angezeigt werden.
3. Zoom-Veränderungen prüfen, um den Layer-Reload auszulösen.
4. Edit-Mode betreten/verlässt und sicherstellen, dass keine JavaScript-Fehler auftreten.
5. Region-Rendering, Tooltip-Interaktionen und Timeline-Auswahl überprüfen.

## 6. Smoke-Ergebnis

Political-Territory-Loader-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.

Geprueft wurden Kartenstart, politischer Layer, Timeline-Jahr, Zoom-Wechsel, Nachladen politischer Gebiete und Browser-Konsole.

## 7. Status

- Split: umgesetzt
- Logikaenderung: keine
- Smoke: bestanden
