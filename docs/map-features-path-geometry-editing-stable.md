# Path-Geometry-Editing Stable Split

## Zweck

Dieses Dokument markiert den engen 1:1-Split der Path-Geometry-Editing-Helfer aus `js/map-features.js` als stabilen Stand.

Wichtig: Dies war ein kontrollierter Extract ohne Logikaenderung.

## Verschobene Funktionen

Nach `js/map-features-path-geometry-editing.js` wurden verschoben:

- `pathCoordinatesToLatLngs`
- `latLngsToPathCoordinates`
- `createPathEditHandleIcon`
- `clearPathGeometryEdit`
- `getActivePathLatLngs`
- `setActivePathLatLngs`
- `refreshPathEditHandles`
- `preparePathSplitContextMenu`
- `getPathSplitCoordinateGroups`
- `splitPathAtNode`
- `finishPathNodeDrag`
- `findNearestSegmentInsertIndex`
- `insertActivePathNode`
- `deleteActivePathNode`
- `handleEditablePathDoubleClick`
- `handleMapDoubleClickWhileEditingPath`
- `saveActivePathGeometry`
- `startPathGeometryEdit`

## Bewusst nicht verschoben

In `js/map-features.js` verbleiben bewusst:

- `deletePathFeature`
- `findNearestGraphEndpointToLatLng`

Begruendung:

- `deletePathFeature` ist CRUD/Lifecycle-nah und wird separat bewertet.
- `findNearestGraphEndpointToLatLng` bleibt Shared-Helper fuer Path-Creation und Path-Geometry-Editing.

## Script-Reihenfolge

Im Map-Features-Bereich gilt:

1. `js/map-features-path-domain.js`
2. `js/map-features-path-labels.js`
3. `js/map-features-path-rendering.js`
4. `js/map-features-path-creation.js`
5. `js/map-features-path-geometry-editing.js`
6. `js/map-features.js`

`js/map-features-path-geometry-editing.js` wird vor `js/map-features.js` geladen, damit globale Funktionsnamen zur Laufzeit verfuegbar sind.

## Smoke-Plan

Nach diesem Split sollte manuell geprueft werden:

1. Seite laden, keine Konsolenfehler.
2. Bestehenden Weg-Popup oeffnen.
3. Weg-Geometriebearbeitung starten.
4. Handles erscheinen.
5. Zwischenknoten ziehen.
6. Endknoten ziehen und Snapping pruefen.
7. Doppelklick auf Linie fuegt Knoten ein.
8. Doppelklick auf Zwischenknoten loescht Knoten.
9. Start-/Endknoten lassen sich nicht loeschen.
10. Bearbeitung mit Doppelklick auf Karte beenden.
11. Weg teilen an Zwischenknoten testen, falls UI verfuegbar.
12. Softlock-Freigabe nach Ende pruefen.
13. Route nach Geometrieaenderung kurz berechnen.
14. Reload ohne Fehler.

## Entscheidung

Der Path-Geometry-Editing-Split ist als stabile Boundary markiert und soll vorerst nicht weiter aufgeteilt werden.

Ein direkter weiterer `map-features.js`-Split wird nicht automatisch empfohlen; zuerst Restarchitektur neu bewerten oder Path-Lifecycle/CRUD als eigene Boundary analysieren.