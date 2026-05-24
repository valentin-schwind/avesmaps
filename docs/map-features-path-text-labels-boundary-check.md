# Map-Features Boundary Check: Weg-/Pfad-Textlabels

## 1. Zweck der Analyse
Diese Analyse bewertet den Weg-/Pfad-Textlabel-Bereich in `js/map-features.js` als moeglichen spaeteren Split-Kandidaten. Es werden keine Funktionen verschoben und keine Logik geaendert.

## 2. Exakte Funktionsliste des Weg-/Pfad-Textlabel-Clusters
- `shouldPathNameBeDisplayed(path)`
- `isPathLabelVisibleAtCurrentZoom(path)`
- `getPathLabelStyle(path)`
- `getReadablePathLabelLatLngCoordinates(latLngCoords)`
- `refreshPathLayerText(path)`
- `syncPathLabels()`

## 3. Untercluster
### Anzeigeentscheidung
- `shouldPathNameBeDisplayed(path)`

### Zoom-Sichtbarkeit
- `isPathLabelVisibleAtCurrentZoom(path)`

### Textstil
- `getPathLabelStyle(path)`

### Leserichtung entlang Linie
- `getReadablePathLabelLatLngCoordinates(latLngCoords)`

### Leaflet.TextPath-Anbindung
- `refreshPathLayerText(path)` (nutzt `setText(...)` / `removeText(...)`)

### Globale Synchronisierung
- `syncPathLabels()`

## 4. Global gelesene Daten
Direkt im Cluster gelesen:
- `pathData` (in `syncPathLabels()`)
- `map` (`map.getZoom()`, `map.latLngToLayerPoint(...)`)
- `VISUAL_MAX_ZOOM_LEVEL` nicht direkt, aber indirekt ueber Zoom-/Label-Helfer

Indirekt gelesen (ueber aufgerufene Helper/Konstanten):
- `LOCATION_NAME_LABEL_CONFIG` (in `isPathLabelVisibleAtCurrentZoom`)
- `activeMapStyle` nicht direkt in diesem Cluster

## 5. Global geschriebene Daten
Der Cluster schreibt keine zentralen globalen Stores um.
Seiteneffekte passieren auf Path-Layer-Objekten:
- `path._pathLabelLine.setText(...)`
- `path._pathLabelLine.removeText(...)`

## 6. Externe Funktionsaufrufe des Clusters
- `normalizePathSubtype(...)`
- `getLocationNameLabelSize(...)`
- `getPathDisplayName(...)`

Nicht direkt verwendet im untersuchten Cluster (aber in angrenzenden Rendering-Bereichen relevant):
- `getPathLatLngs(...)` (in aktueller Datei nicht als Funktion vorhanden)
- `getSelectedMapLayerMode(...)`

## 7. Vermutlich von aussen gebrauchte Funktionen
Direkt ausserhalb von `map-features.js` genutzt:
- `shouldPathNameBeDisplayed(...)` (z. B. `js/review/review-paths.js`, `js/spotlight-search.js`)
- `syncPathLabels()` (z. B. `js/spotlight-search.js`)

Innerhalb `map-features.js` genutzt:
- `getReadablePathLabelLatLngCoordinates(...)`
- `refreshPathLayerText(...)`
- `isPathLabelVisibleAtCurrentZoom(...)`
- `getPathLabelStyle(...)`

## 8. Abhaengigkeit zu anderen Label-Systemen
- Freie Kartenlabels (`js/map-features/map-features-labels.js`): keine direkte Funktionsabhaengigkeit im Cluster.
- Ortsnamenlabels (`js/map-features/map-features-location-name-labels.js`): direkte Stilabhaengigkeit ueber `getLocationNameLabelSize("dorf")`.
- Kraftlinienlabels (`js/map-features/map-features-powerlines.js`): keine direkte Abhaengigkeit im untersuchten Cluster.
- Kollisionslogik (`js/map-features.js`): keine direkte Anbindung dieses Clusters; Path-Textlabels laufen derzeit ausserhalb des freien/Ortsnamen-Kollisionssystems.

## 9. Moegliche spaetere Ziel-Datei
Bewertung:
- `js/map-features/map-features-path-labels.js`: risikoaermer fuer einen engen, separaten 1:1-Extract des Textlabel-Clusters.
- In einem spaeteren groesseren Path-Cluster (`js/map-features/map-features-paths.js`) belassen: ebenfalls moeglich, aber groesserer Scope und hoehere Koppelungsflaeche.

Fuer den aktuellen klassischen Script-Tag-Aufbau ist **`js/map-features/map-features-path-labels.js`** der risikoaermere erste Schritt.

## 10. Noetige Script-Reihenfolge bei spaeterer Auslagerung
Wenn spaeter ausgelagert wird, sollte die Reihenfolge voraussichtlich sein:
1. `js/map-features/map-features-labels.js`
2. `js/map-features/map-features-powerlines.js`
3. `js/map-features/map-features-layer-state.js`
4. `js/map-features/map-features-location-name-labels.js`
5. `js/map-features/map-features-path-labels.js` (neu)
6. `js/map-features.js`

Begruendung:
- `getPathLabelStyle(...)` nutzt `getLocationNameLabelSize(...)` aus `js/map-features/map-features-location-name-labels.js`.
- `js/map-features.js` ruft mehrere der Path-Textlabel-Funktionen auf.

## 11. Risikoanalyse
- Leaflet.TextPath `setText/removeText`: mittel
  - falsche Reihenfolge/fehlende Guards koennen Textartefakte verursachen.
- Zoom-Schwellen: mittel
  - `LOCATION_NAME_LABEL_CONFIG.dorf.minZoom` beeinflusst Sichtbarkeit direkt.
- Pfad-Layer-Lifecycle: mittel
  - `_pathLabelLine` muss in Create/Update/Delete-Zyklen konsistent bleiben.
- Lesbarkeit/Orientierung entlang Linie: mittel
  - Richtungsumkehr via `getReadablePathLabelLatLngCoordinates(...)` ist visuell sensibel.
- Kartenmodus-Wechsel: niedrig bis mittel
  - nicht direkt im Cluster, aber indirekt ueber globale Sichtbarkeits-/Renderzyklen.
- Zusammenspiel mit Path-Rendering: hoch
  - enge Kopplung an `createPathLayer(...)`, `updatePathLayerStyle(...)`, `updatePathLayerGeometry(...)`.

## 12. Klare Empfehlung
- **Ja, ein spaeterer Code-Split ist realistisch**, aber nur als enger 1:1-Schnitt.
- Minimaler spaeterer Extract:
  - `shouldPathNameBeDisplayed`
  - `isPathLabelVisibleAtCurrentZoom`
  - `getPathLabelStyle`
  - `getReadablePathLabelLatLngCoordinates`
  - `refreshPathLayerText`
  - `syncPathLabels`
  nach `js/map-features/map-features-path-labels.js`.
- Vorarbeit vor Umsetzung:
  - kurzer Smoke-Fokus auf Path-Label-Sichtbarkeit bei Zoomwechsel, Path-Update und Kartenmoduswechsel.
  - expliziter Check, dass `shouldPathNameBeDisplayed` und `syncPathLabels` fuer bestehende externe Aufrufer global verfuegbar bleiben.
