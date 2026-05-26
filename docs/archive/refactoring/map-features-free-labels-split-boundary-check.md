# Map Features Free Labels Split Boundary Check

## 1. Zweck der Analyse

Diese Analyse prueft nur den freien Kartenlabel-Cluster in `js/map-features.js`.
Es ist eine reine Boundary-Bestandsaufnahme als Grundlage fuer einen spaeteren, verhaltensneutralen Split.

Es wurden keine Funktionen verschoben, keine Namen geaendert und keine Script-Tags angepasst.

## 2. Exakte Funktionsliste des freien Label-Clusters

Untersuchter Cluster (in `js/map-features.js`):

- `normalizeLabelFeature`
- `createLabelIcon`
- `getScaledLabelSize`
- `createLabelMarkerEntry`
- `refreshLabelMarkerPopup`
- `findLabelEntryByPublicId`
- `setLabelMoveActive`
- `shouldShowLabelMarker`
- `syncLabelMarkerVisibility`
- `syncLabelVisibility`
- `syncLabelIcons`
- `prepareLabelData`
- `addCreatedLabelFeature`
- `applyLabelFeatureResponse`
- `applyLiveLabelFeature`
- `saveLabelPosition`
- `deleteLabelEntry`
- `deleteActiveLabel`
- `duplicateLabelEntry`
- `createLabelAt`

## 3. Globale Daten, die gelesen werden

Direkt im Cluster gelesen:

- `labelData`
- `labelMarkers`
- `map`
- `IS_EDIT_MODE`
- `pendingLabelMoveAfterEditEntry` (nur indirekt im umgebenden Flow relevant)
- `labelEditEntry` (in `deleteActiveLabel`)
- `labelCollisionFrameId` (ueber `scheduleLabelCollisionResolution`, falls als externe Abhaengigkeit betrachtet)

Explizit geprueft aus der Beispiel-Liste:

- `activeMapStyle`: **nicht direkt** im freien Label-Cluster genutzt
- `getSelectedMapLayerMode`: genutzt in `shouldShowLabelMarker`
- `getMapRenderBounds`: genutzt in `shouldShowLabelMarker`, `syncLabelVisibility`, `syncLabelIcons`

Weitere gelesene Runtime-Kontexte:

- `VISUAL_MAX_ZOOM_LEVEL`
- `window`, `L`

## 4. Globale Daten, die geschrieben werden

Direkt im Cluster geschrieben:

- `labelData`
  - neu gesetzt in `prepareLabelData`
  - erweitert in `addCreatedLabelFeature` und `applyLiveLabelFeature`
  - gefiltert in `deleteLabelEntry`
- `labelMarkers`
  - neu gesetzt in `prepareLabelData`
  - erweitert in `addCreatedLabelFeature` und `applyLiveLabelFeature`
  - gefiltert in `deleteLabelEntry`
- `pendingLabelMoveAfterEditEntry`
  - gesetzt in `duplicateLabelEntry`

Geprueft:

- `labelEditEntry`: wird nicht beschrieben, aber in `deleteActiveLabel` gelesen

## 5. Externe Funktionsaufrufe des Clusters

Der Cluster ruft folgende externe Funktionen auf:

- `openLabelEditDialog`
- `labelPopupMarkup`
- `submitMapFeatureEdit`
- `updateRevisionFromEditResponse`
- `loadChangeLog`
- `showFeedbackToast`
- `setLabelEditDialogOpen`
- `setLabelEditStatus`
- `acquireFeatureSoftLock`
- `releaseFeatureSoftLock`
- `scheduleLabelCollisionResolution`
- `getSelectedMapLayerMode`
- `getMapRenderBounds`
- `isLatLngInRenderBounds`
- `getVisualZoomLevel`
- `setSelectedMapLayerMode`
- `escapeHtml`

Hinweis zur Liste aus der Aufgabe:

- `refreshLabelMarkerPopup` und `syncLabelMarkerVisibility` sind intern Teil des Clusters und werden von anderen Clusterfunktionen aufgerufen.

## 6. Funktionen, die vermutlich von aussen gebraucht werden

Nach Aufrufstellen in `index.html`, `js/routing/routing.js`, `js/ui/popups.js`, `js/dialogs-review-*`, `js/ui/spotlight-search.js` sind mindestens diese Funktionen extern relevant:

- `findLabelEntryByPublicId`
- `setLabelMoveActive`
- `syncLabelVisibility`
- `syncLabelIcons`
- `prepareLabelData`
- `addCreatedLabelFeature`
- `applyLiveLabelFeature`
- `deleteLabelEntry`
- `deleteActiveLabel`
- `duplicateLabelEntry`
- `createLabelAt`

Zusaetzlich plausibel extern relevant:

- `applyLabelFeatureResponse` (durch Editor-Submit-Flow)
- `refreshLabelMarkerPopup` (wird im Map-Feature-Flow mehrfach genutzt)

## 7. Ziel-Datei bewerten (`js/map-features-labels.js` vs. `js/labels.js`)

### Option A: `js/map-features-labels.js`

Vorteile:

- geringeres Risiko im aktuellen klassischen Aufbau
- signalisiert klar: Teil von `map-features`-Domane, kein kompletter Endzustand
- erfordert keine sofortige semantische Neuordnung anderer Label-Arten (Location-Name-Labels, Linienlabels, Kollision)

Nachteile:

- nur Zwischenschritt, kein finales Zielmodul

### Option B: `js/labels.js`

Vorteile:

- passt zum langfristigen Zielbild aus `future-map-architecture.md`

Nachteile:

- suggeriert bereits ein vollstaendig sauberes Label-Modul, obwohl noch starke Kopplung zu `map-features` besteht
- hoeheres Risiko fuer voreilige Scope-Erweiterung (Kollision, Ortsnamenlabels, Linienlabels)

### Bewertung

Fuer den aktuellen Script-Tag- und Global-State-Aufbau ist **`js/map-features-labels.js` risikoaermer**.

## 8. Noetige Script-Reihenfolge bei spaeterer Auslagerung

Falls spaeter ausgelagert wird (kein Schritt jetzt), waere eine konservative Reihenfolge:

1. allgemeine Basisskripte und Runtime-State (inkl. `js/app/runtime-state.js`)
2. Popup-/Dialog-Helfer, die vom Label-Cluster genutzt werden
3. `js/map-features-labels.js` (neue Split-Datei)
4. `js/map-features.js` (Rest-Orchestrator)
5. `js/routing/routing.js` und weitere Verbraucher

Wichtig:

- keine ES-Module
- klassische globale Namen bleiben unveraendert
- keine Top-Level-Ausfuehrung in der neuen Split-Datei

## 9. Risikoanalyse

- Popup-Anbindung: mittel
  - `labelPopupMarkup` und Kontextaktionen muessen unveraendert erreichbar bleiben
- Editmode: mittel
  - `IS_EDIT_MODE` steuert Interaktivitaet und Popup-Bindung
- Dragging: mittel
  - `setLabelMoveActive` + `dragend` + Locking sind timing-sensibel
- Persistenz/API: mittel bis hoch
  - `submitMapFeatureEdit`, Revision-Update, Changelog-Refresh muessen 1:1 bleiben
- Kollisionslogik: mittel
  - freie Labels triggern `scheduleLabelCollisionResolution`, die ausserhalb des Clusters bleibt
- Kartenmodus: mittel
  - Sichtbarkeit haengt direkt an `getSelectedMapLayerMode() === "deregraphic"`
- Changelog/Feedback: niedrig bis mittel
  - Toaster und `loadChangeLog` sind klar gekoppelte Seiteneffekte

## 10. Klare Empfehlung

- **Soll jetzt ein Code-Split folgen?**
  - **Ja, aber nur als minimaler 1:1-Schnitt**, wenn unmittelbar danach ein Smoke-Zyklus geplant ist.

- **Minimaler spaeterer 1:1-Schnitt (nur Vorschlag, keine Umsetzung hier):**
  - exakt die 20 Funktionen aus Abschnitt 2 in `js/map-features-labels.js` verschieben
  - keine zusaetzlichen Label-/Kollisions-/Location-Name-Funktionen mitnehmen
  - keine Funktionsnamen aendern
  - keine Logik aendern
  - `js/map-features-labels.js` vor `js/map-features.js` laden
  - Aufrufer in anderen Dateien unveraendert lassen

- **Falls kein direkter Split gestartet werden soll:**
  - zuerst einen expliziten Smoke-Plan fuer Label-CRUD, Dragging, Sichtbarkeit (Zoom/Move), Changelog und Popup-Aktionen festziehen.
