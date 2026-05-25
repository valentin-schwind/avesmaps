# Map Features Labels Boundary Check

## Zweck der Analyse

Diese Analyse dokumentiert den aktuellen Label-Zuschnitt in `js/map-features.js` als reine Bestandsaufnahme.
Es wurden keine Funktionen verschoben, umbenannt oder veraendert.

Ziel ist eine belastbare Entscheidungsgrundlage fuer einen spaeteren, sehr kleinen und verhaltensneutralen Schritt in Richtung eines kuenftigen Label-Moduls (siehe `docs/future-map-architecture.md`, Zielbild `js/app/labels.js`).

## Gelesene Bereiche

Fokus war auf den Label-nahen Bereichen in `js/map-features.js`:

- Freie Kartenlabels (ca. `normalizeLabelFeature` bis `createLabelAt`)
- Ortsnamenlabels (Konstanten + `getLocationNameLabelSize`/`createLocationNameLabelEntry` + `add/ensure/removeLocationNameLabel`)
- Kollisionslogik (`scheduleLabelCollisionResolution` bis `resolveLabelCollisions`)
- Text entlang Linien (`refreshPathLayerText`/`syncPathLabels`, `refreshPowerlineLayerText`/`syncPowerlineLabels`)

## Aktuelle Label-nahe Bereiche

Aktuell liegen vier fachliche Label-Bloecke in derselben Datei:

1. Freie Kartenlabels (eigene Label-Features)
2. Ortsnamenlabels (an Location-Markern verankert)
3. Label-Kollision (gemeinsam fuer freie Labels und Ortsnamenlabels)
4. Textlabels entlang Wegen/Kraftlinien (liniegebunden, nicht freie Kartenlabels)

## Cluster: Freie Kartenlabels

### Funktionsumfang

- Normalisierung / Datenuebernahme:
  - `normalizeLabelFeature`
  - `prepareLabelData`
  - `addCreatedLabelFeature`
  - `applyLabelFeatureResponse`
  - `applyLiveLabelFeature`
- Icon-Erzeugung / Skalierung:
  - `createLabelIcon`
  - `getScaledLabelSize`
- Marker-Erzeugung / Popup-Anbindung:
  - `createLabelMarkerEntry`
  - `refreshLabelMarkerPopup`
  - `findLabelEntryByPublicId`
- Sichtbarkeit / Re-Render:
  - `shouldShowLabelMarker`
  - `syncLabelMarkerVisibility`
  - `syncLabelVisibility`
  - `syncLabelIcons`
- Positionierung / Bewegung / Speichern:
  - `setLabelMoveActive`
  - `saveLabelPosition`
- Loeschen / Duplizieren / Erstellen:
  - `deleteLabelEntry`
  - `deleteActiveLabel`
  - `duplicateLabelEntry`
  - `createLabelAt`

### Fachliche Einordnung

Dieser Block bildet bereits eine zusammenhaengende "freie Label"-Domane mit eigener CRUD-, Marker- und Sichtbarkeitslogik.

### Bewertung

- **Spaeter gut fuer Label-Modul geeignet**
- Grund: klare Fachgrenze vorhanden, hoher thematischer Zusammenhalt

## Cluster: Ortsnamenlabels

### Funktionsumfang

- Zoomgroessen:
  - `LOCATION_NAME_LABEL_SIZE_BY_ZOOM`
  - `getLocationNameLabelSize`
- Offset-Berechnung:
  - `getLocationNameLabelOffset`
- Anzeigeentscheidung:
  - `shouldShowLocationNameLabel`
- Marker/Icon-Erzeugung:
  - `createLocationNameLabelIcon`
  - `createLocationNameLabelEntry`
- Sichtbarkeit:
  - `syncLocationNameLabelVisibility`
- Lifecycle an Locations:
  - `addLocationNameLabel`
  - `ensureLocationNameLabel`
  - `removeLocationNameLabel`

### Fachliche Einordnung

Ortsnamenlabels sind eng an `locationMarkers` gekoppelt (kein eigenstaendiger Label-Datensatz wie bei freien Labels).
Zusatzkopplung besteht an Stil-/Layer-Modi (`activeMapStyle`, NODIX/Crossing-Filter).

### Bewertung

- **Nur mit Vorarbeit fuer Label-Modul geeignet**
- Vorarbeit: Kopplung zu Location-Marker-Lifecycle und Kartenstil explizit trennen/dokumentieren

## Cluster: Label-Kollision

### Funktionsumfang

- Scheduling:
  - `scheduleLabelCollisionResolution`
- Rechteck-/Kollisionsgrundlagen:
  - `rectanglesOverlap`
  - `expandRect`
  - `measureLabelRect`
  - `measureLabelCollisionRect`
- Prioritaeten:
  - `getLocationNameLabelPriority`
- Offset-Kandidaten / Offset-Anwendung:
  - `getLabelOffsetCandidates`
  - `setLabelElementOffset`
  - `getLocationNameLabelBaseOffset`
  - `getLocationNameLabelOffsets`
  - `applyLocationNameLabelOffset`
- Kollisionsziel / Entry-Sammlung / Aufloesung:
  - `getLabelCollisionTarget`
  - `getCollisionEntries`
  - `resolveLabelCollisions`

### Fachliche Einordnung

Kollisionslogik ist ein Querschnitt ueber zwei Labeltypen:

- freie Labels (`labelMarkers`)
- Ortsnamenlabels (`locationNameLabels`)

Sie nutzt DOM-Messungen und CSS-Offsets zur Laufzeit und ist damit rendernah.

### Bewertung

- **Nur mit Vorarbeit fuer Label-Modul geeignet**
- Vorarbeit: klares Interface fuer beide Labelquellen definieren (Entry-Shape, Prioritaeten, Offset-Strategie)

## Cluster: Text entlang Linien (Weg-/Kraftliniennamen)

### Wegnamen

- `isPathLabelVisibleAtCurrentZoom`
- `getPathLabelStyle`
- `refreshPathLayerText`
- `syncPathLabels`

### Kraftliniennamen

- `isPowerlineLabelVisibleAtCurrentZoom`
- `getPowerlineLabelStyle`
- `refreshPowerlineLayerText`
- `syncPowerlineLabels`

### Abgrenzung zu freien Kartenlabels

Diese Labels sind **liniegebundene Textdarstellung** auf bestehenden Layern (`_pathLabelLine`, `_labelLine`) und keine freien Label-Features mit eigenem Marker/CRUD.

### Bewertung

- **Vorerst besser in `map-features.js` lassen**
- Grund: enge Kopplung an Path-/Powerline-Rendering, Zoom-/Style-Regeln und vorhandene Linien-Layer

## Abhaengigkeiten (relevant fuer spaeteres labels.js)

### Karten-/Render-Kontext

- Leaflet `map`
- `getMapRenderBounds`
- `getVisualZoomLevel`
- `activeMapStyle`
- `getSelectedMapLayerMode`

### Daten-/Marker-Container

- `locationMarkers`
- `locationNameLabels`
- `labelData`
- `labelMarkers`
- `pathData`
- `powerlineData`

### Editmode / Dialoge / Feedback

- `IS_EDIT_MODE`
- `openLabelEditDialog`
- `setLabelEditDialogOpen`
- `setLabelEditStatus`
- `showFeedbackToast`

### Persistenz / Revision / Review-UI

- `submitMapFeatureEdit`
- `updateRevisionFromEditResponse`
- `loadChangeLog`

### Kollisions-Pipeline

- `scheduleLabelCollisionResolution` (Queueing via `requestAnimationFrame`)

## Eignungsbewertung je Bereich

- Freie Kartenlabels: **spaeter gut fuer Label-Modul geeignet**
- Ortsnamenlabels: **nur mit Vorarbeit geeignet**
- Label-Kollision: **nur mit Vorarbeit geeignet**
- Weg-/Kraftlinien-Textlabels: **vorerst besser in `map-features.js` lassen**

## Zielmodul-Mapping Richtung `js/app/labels.js`

### Realistisch spaeter nach `labels.js`

- Freie Label-Normalisierung, Marker-Erzeugung, Sichtbarkeit, CRUD-nahe Clientlogik

### Nur mit Vorarbeit

- Ortsnamenlabels (wegen Kopplung an Location-Marker-Lifecycle)
- Kollisionslogik (wegen Querschnitt ueber freie Labels + Ortsnamenlabels)

### Vorerst in `map-features.js`

- Text entlang Wegen/Kraftlinien (stark rendering-/layergekoppelt)

## Risikoanalyse

- Hohe Querschnittskopplung zwischen Location-, Label-, Path- und Powerline-Daten
- Kollisionslogik greift direkt auf DOM-Geometrie zu und ist timing-sensibel
- Editmode-Interaktion (Dialog, Locks, Feedback, ChangeLog) ist im freien Label-Block integriert
- Ein grosser Split ohne Zwischenschritt hat erhoehtes Regressionsrisiko

## Empfehlung

- **Noch keinen Code-Split durchfuehren.**
- Nach dieser Analyse gezielt entscheiden, ob ein sehr kleiner, verhaltensneutraler Schritt moeglich ist.
- Falls als erster Schritt gewuenscht, dann nur ein enges 1:1-Extract als Vorschlag:
  - Zuerst nur den freien Label-Cluster (ohne Ortsnamenlabels, ohne Kollisionslogik, ohne Weg-/Kraftlinien-Textlabels) separat boundary-pruefen.
  - Danach erst ueber einen minimalen Datei-Split entscheiden.
