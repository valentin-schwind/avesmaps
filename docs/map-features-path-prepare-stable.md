# Path-Prepare Stable Split

## Zweck

Dokumentiert den engen 1:1-Extract des Path-Prepare-Teilschnitts aus `js/map-features.js` nach `js/map-features-path-prepare.js`.

## Verschobene Funktionen

- `normalizeRoutePathFeature`
- `preparePathData`

## Bewusst nicht verschoben

- `getPathStyleColors`
- `deletePathFeature`
- `removeLiveFeature`
- `applyLiveMapFeatureUpdate`
- `applyMapFeatureEditResult`
- `findNearestGraphEndpointToLatLng`

## Script-Reihenfolge

Im Map-Features-Block wird `js/map-features-path-prepare.js` nach `js/map-features-path-rendering.js` und vor `js/map-features-path-creation.js` geladen.

## Smoke-Plan

1. Seite laden und Konsole pruefen.
2. Wege-Toggle ein/aus pruefen.
3. Bestehende Wege auf Karte und Popup pruefen.
4. Routing mit mehreren Wegpunkten pruefen.
5. Path-Creation starten und neuen Weg erzeugen.
6. Path-Geometry-Editing kurz starten und speichern.
7. Route nach Path-Aenderung erneut pruefen.
8. Reload und Konsole erneut pruefen.

## Smoke-Ergebnis

Path-Prepare-Smoke bestanden: Punkte 1-8 ohne Auffaelligkeiten.

## Entscheidung

Der Split ist als enger 1:1-Extract umgesetzt und per Betreiber-Smoke bestaetigt. Weitere Path-Lifecycle/CRUD-Schritte nur mit neuer Boundary-Analyse und eigenem Smoke-Plan.
