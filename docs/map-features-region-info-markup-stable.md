# Region Info/Tooltip Markup Stable Status

## 1. Zusammenfassung

Die Region Info/Tooltip Markup-Helfer wurden als enger 1:1-Extract aus `js/map-features.js` in `js/map-features/map-features-region-info-markup.js` ausgelagert.

Ziel ist es, die reine Markup- und Formatierungslogik von Regions-Tooltips zu separieren, während Lifecycle-, Kontext- und Geometrie-Logik im Rest verbleiben.

## 2. Verschobene Funktionen

- `createRegionCompactTooltipMarkup`
- `createRegionMiniTooltipMarkup`
- `hasRegionWikiInfo`
- `createRegionWikiInfoBoxMarkup`
- `createRegionInfoTextRow`
- `createRegionInfoBoxRow`
- `createRegionInfoPlaceValue`
- `createRegionInfoLink`
- `createRegionInfoPathValue`
- `normalizeRegionInfoUrl`
- `normalizeRegionStringList`
- `createRegionPlaceTooltipLine`
- `normalizeRegionParentheticalSpacing`

## 3. Verbleibende Funktionen in `js/map-features.js`

Nicht verschoben bleiben:

- `bindRegionCompactTooltip`
- `openRegionCompactTooltip`
- `closeRegionCompactTooltip`
- `getRegionTooltipLatLng`
- `focusRegionPlace`
- `createRegionLabelMarkup`
- `getRegionLayerGeometryPublicId`
- `isLatLngInsideRegionRing`
- `isLatLngInsideRegionLayer`

Diese verbleibenden Funktionen sind eng mit Tooltip-Lifecycle, Layer-Geometrie und Kontext-Interaktionen verbunden.

## 4. Script-Reihenfolge

`index.html` lädt `js/map-features/map-features-region-info-markup.js` nach `js/map-features.js` und vor `js/map-features/map-features-political-timeline.js`.

## 5. Smoke-Plan

1. Karte öffnen und Regions-Tooltip aktivieren.
2. Regionstooltips öffnen und prüfen, ob Markup und Wiki-Infos korrekt angezeigt werden.
3. Tooltip-Knöpfe für Hauptstädte/Herrschaftssitze testen.
4. Region-Info-Links öffnen und prüfen, ob sie im neuen Tab starten.
5. Konsole auf Fehler prüfen.

## 6. Smoke-Ergebnis

Region-Info-Markup-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.

Geprueft wurden Regions-Tooltip, Wiki-Info/Tooltip-Inhalt, Tooltip-Knoepfe fuer Hauptstadthandling und Browser-Konsole.

## 7. Status

- Split: umgesetzt
- Logikaenderung: keine
- Smoke: bestanden
