# Map-Features Path-Geometry-Editing Boundary Check

## 1. Zweck
Diese Analyse bewertet einen moeglichen spaeteren Split des Path-Geometry-Editing-Blocks aus `js/map-features.js`.

Wichtig: Dies ist **noch kein Code-Split**. Es werden nur Boundaries, Abhaengigkeiten, Risiken und ein moeglicher spaeterer Schritt dokumentiert.

## 2. Kandidatenfunktionen
Gepruefte Funktionen im Geometry-Editing-Umfeld:

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
- `deletePathFeature`

Zusaetzlich geprueft:

- `findNearestGraphEndpointToLatLng` (Shared-Helper fuer Path-Creation und Path-Geometry-Editing)

Boundary-Einschaetzung:

- **geeignet fuer Geometry-Split**:
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

- **Grenzfall / eher ausserhalb lassen**:
  - `deletePathFeature` (enthaelt klassischen Delete-CRUD-Flow und beruehrt Path-Lifecycle/Feature-Update-Kante, nicht nur Geometry-Editing)

- **bewusst nicht verschieben (Shared-Helper)**:
  - `findNearestGraphEndpointToLatLng` bleibt vorerst in `js/map-features.js`.

## 3. Verantwortlichkeiten
Der Block deckt fachlich diese Aufgaben ab:

- aktive Weg-Geometriebearbeitung starten und beenden
- Edit-Handles erzeugen, aktualisieren und entfernen
- Knoten ziehen
- Knoten einfuegen
- Knoten loeschen
- Endpunkte an Orte/Kreuzungen snappen
- Weg an Zwischenknoten teilen
- Geometrie per API speichern
- Layer-Geometrie lokal aktualisieren
- Softlock anfordern/freigeben

## 4. Gelesene globale Daten
Direkt gelesen:

- `activePathGeometryEdit`
- `pendingPathSplit`
- `pathData`
- `locationData` (indirekt ueber `findNearestGraphEndpointToLatLng`)
- `map`
- `PATH_ENDPOINT_SNAP_DISTANCE_PX` (ueber Shared-Helper)

Weitere gelesene Zustandskanten:

- `path._layerGroup` (Popup-Zugriff)
- `path.geometry.coordinates`

## 5. Geschriebene globale Daten
Direkt geschrieben/mutiert:

- `activePathGeometryEdit`
- `pendingPathSplit`
- `path.geometry.coordinates`
- Handle-Marker-Layer (`map.addLayer`/`map.removeLayer`)
- Map-Doppelklick-Handler (`map.on("dblclick", ...)`, `map.off(...)`)
- `map.doubleClickZoom` (`disable()`/`enable()`)

## 6. Externe Abhaengigkeiten
Der Block ruft u. a. auf:

- `clearPendingPathCreation()`
- `findNearestGraphEndpointToLatLng()`
- `updatePathLayerGeometry()`
- `submitMapFeatureEdit()`
- `applyPathFeatureResponse()`
- `updateRevisionFromEditResponse()`
- `acquireFeatureSoftLock()`
- `releaseFeatureSoftLock()`
- `createCrossingFeatureAt()`
- `addCreatedCrossingMarker()`
- `addCreatedPathFeature()`
- `removePathFeature()`
- `showFeedbackToast()`
- `openMapContextMenu()`
- `ensureCrossingsEnabled()`
- `getPathPublicId()`
- `getPathDisplayName()`
- `normalizePathSubtype()`
- `getNextPathDisplayName()`
- Leaflet: `L.marker`, `L.divIcon`, `L.latLng`, `L.point`, `L.DomEvent`

Hinweis zu den Beispielen:

- `updatePathLayerStyle()` und `refreshPathLayerPopup()` werden **nicht direkt** im Geometry-Block aufgerufen; sie passieren indirekt ueber `applyPathFeatureResponse(...)`.

## 7. Externe Aufrufer
Per grep identifizierte Aufrufer:

- `startPathGeometryEdit`
  - `js/routing.js`
  - `js/map-features.js` (intern aus `handleEditablePathDoubleClick`)
- `clearPathGeometryEdit`
  - intern mehrfach in `js/map-features.js`
- `handleEditablePathDoubleClick`
  - `js/map-features/map-features-path-rendering.js` (Leaflet-Layer-Doppelklick)
- `deletePathFeature`
  - `js/routing.js`
- `splitPathAtNode`
  - `js/routing.js`
- `insertActivePathNode`
  - intern aus `handleEditablePathDoubleClick`
- `deleteActivePathNode`
  - intern aus Handle-Doppelklick in `refreshPathEditHandles`
- `saveActivePathGeometry`
  - intern aus Drag-/Insert-/Delete- und Save-Pfaden

## 8. Boundary-Bewertung
Ist ein enger 1:1-Extract realistisch?

- **Ja**, fuer den eigentlichen Geometry-Editing-Block.

Welche Funktionen sollten in `js/map-features.js` bleiben?

- Shared-Helper `findNearestGraphEndpointToLatLng`
- Lifecycle-/CRUD-/Dispatcher-nahe Bereiche (insbesondere `deletePathFeature` als Grenzfall)

Welche Funktionen duerfen in eine neue Datei?

- alle oben als "geeignet fuer Geometry-Split" markierten Funktionen

Risiken durch Script-Reihenfolge und Globals:

- mittelhoch, weil der Block stark auf globale Zustandsobjekte und auf Funktionen aus `js/map-features.js`, `js/map-features/map-features-path-rendering.js` und `js/routing.js` zugreift.

Darf die neue Datei Top-Level-Ausfuehrung enthalten?

- **Nein.** Nur Funktionsdefinitionen, keine neue Init-/Event-Ausfuehrung.

## 9. Vorgeschlagene Zieldatei
Falls positiver Schritt:

- `js/map-features/map-features-path-geometry-editing.js`

## 10. Script-Reihenfolge
Sinnvolle spaetere Position:

- nach `js/map-features/map-features-path-creation.js`
- vor `js/map-features.js`

Begruendung:

- `js/map-features/map-features-path-rendering.js` bindet Doppelklick-Handler, die `handleEditablePathDoubleClick(...)` zur Laufzeit aufrufen.
- `js/routing.js` ruft `startPathGeometryEdit`, `deletePathFeature`, `splitPathAtNode` auf und wird bereits nach `js/map-features.js` geladen.
- Der Geometry-Block muss daher vor `js/map-features.js` und damit vor den spaeteren Aufrufern global verfuegbar sein, ohne Top-Level-Ausfuehrung.

## 11. Risiko
### Syntaxrisiko

- niedrig (enger 1:1-Extract moeglich).

### Laufzeitrisiko

- mittel bis hoch (dichte Kopplung an Map-Handler, Handles, aktive Edit-Zustaende).

### UI-/Interaction-Risiko

- hoch (Doppelklick/Drag/Contextmenu, Snapping, Handle-Rebuild).

### Datenrisiko

- mittel bis hoch (inkonsistente `path.geometry.coordinates`, stale Handles, offene Edit-Zustaende).

### API-/Editmode-/Softlock-Risiko

- hoch (Softlock-Lebenszyklus, Save-/Split-Sequenzen, API-Fehlerpfade).

## 12. Empfohlener Smoke nach spaeterem Code-Split
Konkrete manuelle Tests:

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
12. Softlock wird nach Ende freigegeben.
13. Route nach Geometrieaenderung kurz berechnen.
14. Reload ohne Fehler.

## 13. Entscheidung
Empfehlung: **Ja, danach ist ein enger Code-Split sinnvoll**.

Empfohlener enger Split-Umfang:

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

Vorerst nicht mitnehmen:

- `deletePathFeature` (besser in Path-Lifecycle/CRUD-Naehe belassen)
- `findNearestGraphEndpointToLatLng` (Shared-Helper fuer Creation + Geometry)

Wenn ein absolut strikter 1:1-Schnitt aller heute beteiligten Funktionen gewuenscht ist, sollte davor eine kurze Sub-Boundary fuer `deletePathFeature` entschieden werden.

## 14. Konkreter naechster Code-Schritt
Falls umgesetzt wird, vorgeschlagener Commit-Name:

- `Split map features path geometry editing helpers`

Wichtig:

- **Nicht in dieser Aufgabe umsetzen.**