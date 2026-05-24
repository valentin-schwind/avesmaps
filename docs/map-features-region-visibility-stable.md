# Region-Visibility Stable Split

## Zweck

Dokumentiert den engen 1:1-Extract von `syncRegionVisibility` aus `js/map-features.js` nach `js/map-features-region-visibility.js`.

## Verschobene Funktion

- `syncRegionVisibility`

## Bewusst nicht verschoben

- Region-CRUD-/Timeline-/Edit-Orchestrierung
- Region-spezifische Datenmutationen und Dispatcher-nahe Flows

## Script-Reihenfolge

`js/map-features-region-visibility.js` wird nach `js/map-features.js` und vor `js/map-features-feature-dispatcher.js` geladen.

## Smoke-Plan

1. Seite laden und Konsole pruefen.
2. Layer-Mode auf Political wechseln/zurueck wechseln.
3. Region-Polygone und Region-Labels in mehreren Zoomstufen pruefen.
4. Region-Editmode kurz antesten und Mode-Wechsel pruefen.
5. Reload und Konsole erneut pruefen.

## Entscheidung

Der Split ist als enger 1:1-Extract umgesetzt. Weitere Region-Splits nur mit eigener Boundary-Analyse.
