# Feature-Dispatcher Stable Split

## Zweck

Dokumentiert den engen 1:1-Extract des Feature-Response-Dispatcher-Teilschnitts aus `js/map-features.js` nach `js/map-features-feature-dispatcher.js`.

## Verschobene Funktionen

- `removeLiveFeature`
- `applyLiveMapFeatureUpdate`
- `applyMapFeatureEditResult`

## Bewusst nicht verschoben

- `deletePathFeature`
- `getPathStyleColors`
- `findNearestGraphEndpointToLatLng`
- `applyLiveLocationFeature`
- `applyLivePathFeature`
- `applyLivePowerlineFeature`
- `applyLiveLabelFeature`
- `applyRegionFeatureResponse`
- `removePathFeature`
- Region-/Location-/Path-spezifische CRUD-Funktionen

## Script-Reihenfolge

`js/map-features-feature-dispatcher.js` wird nach `js/map-features.js` und vor `js/routing/routing.js` geladen.

## Smoke-Plan

1. Seite laden und Konsole pruefen.
2. Bestehende Marker/Labels/Wege/Powerlines kurz sichtbar pruefen.
3. Edit-Flow mit Rueckgabe-Payload pruefen (Location oder Path).
4. Path-Creation erzeugt neuen Weg und bleibt sichtbar.
5. Path-Geometry-Editing kurz speichern.
6. Route neu berechnen.
7. Reload und Konsole erneut pruefen.

## Smoke-Ergebnis

Feature-Dispatcher-Smoke bestanden: Punkte 1-8 ohne Auffaelligkeiten oder Konsolenmeldungen.

Geprueft wurden Seite/Konsole, sichtbare Wege/Orte/Labels/Regionen, Path-Creation, Path-Geometry-Editing, Routing, ein verfuegbarer Edit- oder Delete-Flow sowie Reload.

## Entscheidung

Der Split ist als enger 1:1-Extract umgesetzt und per Betreiber-Smoke bestaetigt. Weitere Dispatcher-/CRUD-Splits nur mit neuer Boundary-Analyse.
