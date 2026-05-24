# Path-Lifecycle Stable Split

## Zweck

Dokumentiert den engen 1:1-Extract des Path-Apply/Live-Teilschnitts aus `js/map-features.js` nach `js/map-features-path-lifecycle.js`.

## Verschobene Funktionen

- `addCreatedPathFeature`
- `applyLivePathFeature`
- `findPathByPublicId`
- `syncPathRendering`
- `applyPathFeatureResponse`
- `removePathFeature`

## Bewusst nicht verschoben

- `preparePathData`
- `normalizeRoutePathFeature`
- `deletePathFeature`
- `removeLiveFeature`
- `applyLiveMapFeatureUpdate`
- `applyMapFeatureEditResult`
- `getPathStyleColors`
- `findNearestGraphEndpointToLatLng`

## Script-Reihenfolge

Im Map-Features-Block wird `js/map-features-path-lifecycle.js` nach `js/map-features-path-geometry-editing.js` und vor `js/map-features.js` geladen.

## Smoke-Plan

1. Seite laden und Konsole pruefen.
2. Wege ein-/ausblenden.
3. Path-Creation: neuen Weg erzeugen.
4. Path-Geometry-Editing: Geometrie kurz aendern und speichern.
5. Weg-Popup oeffnen und Name/ID pruefen.
6. Route berechnen und nach Path-Update erneut pruefen.
7. Reload und erneut Konsole pruefen.

## Smoke-Ergebnis

Path-Lifecycle-Smoke bestanden: Punkte 1-10 ohne Auffaelligkeiten.

Geprueft wurden Seite/Konsole, Wege-Toggle, bestehendes Weg-Popup, Routing, Path-Creation, neuer Weg, Path-Geometry-Editing, erneute Route und Reload.

## Entscheidung

Der Split ist als enger 1:1-Extract umgesetzt. Weitere Path-Lifecycle/CRUD-Schritte nur mit neuer Boundary-Analyse und eigenem Smoke-Plan.
