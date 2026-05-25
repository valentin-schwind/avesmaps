# Map Features Powerlines Boundary Check

## 1. Zweck der Analyse

Diese Analyse beschreibt den Powerline-Bereich in `js/map-features.js` als Boundary-Bestandsaufnahme.
Es wurden keine Funktionen verschoben und keine Logik geaendert.

Ziel ist zu pruefen, ob ein spaeterer 1:1-Split in eine eigene Datei mit vertretbarem Risiko moeglich ist.

## 2. Exakte Funktionsliste des Powerline-Clusters

Untersuchter Cluster in `js/map-features.js`:

- `getPowerlineLatLngs`
- `getPowerlinePublicId`
- `getPowerlineDisplayName`
- `createPowerlineStrandLatLngs`
- `getPowerlineRenderStyles`
- `shouldPowerlineNameBeDisplayed`
- `isPowerlineLabelVisibleAtCurrentZoom`
- `getPowerlineLabelStyle`
- `getReadablePowerlineLabelLatLngCoordinates`
- `refreshPowerlineLayerText`
- `syncPowerlineLabels`
- `createPowerlinePopupMarkup`
- `refreshPowerlineLayerPopup`
- `createPowerlineLayer`
- `normalizePowerlineFeature`
- `syncPowerlineVisibility`
- `refreshPowerlineLayers`
- `stopPowerlineAnimationLoop`
- `shouldAnimatePowerlines`
- `tickPowerlineAnimation`
- `ensurePowerlineAnimationLoop`
- `preparePowerlineData` (aktuell als `const preparePowerlineData = (data) => { ... }`)
- `applyLivePowerlineFeature`
- `findPowerlineByPublicId`
- `getConnectedPowerlinesForPublicId`
- `applyPowerlineFeatureResponse`
- `clearPendingPowerlineCreation`
- `startPowerlineCreationFromEndpoint`
- `completePendingPowerlineAtEndpoint`
- `deletePowerlineFeature`

## 3. Untercluster

### Daten / Normalisierung

- `normalizePowerlineFeature`
- `findPowerlineByPublicId`
- `getConnectedPowerlinesForPublicId`
- `getPowerlinePublicId`
- `getPowerlineDisplayName`

### Rendering / Strands

- `getPowerlineLatLngs`
- `createPowerlineStrandLatLngs`
- `getPowerlineRenderStyles`
- `createPowerlineLayer`
- `refreshPowerlineLayers`
- `syncPowerlineVisibility`

### Animation

- `stopPowerlineAnimationLoop`
- `shouldAnimatePowerlines`
- `tickPowerlineAnimation`
- `ensurePowerlineAnimationLoop`

### Labels / Text entlang Linie

- `shouldPowerlineNameBeDisplayed`
- `isPowerlineLabelVisibleAtCurrentZoom`
- `getPowerlineLabelStyle`
- `getReadablePowerlineLabelLatLngCoordinates`
- `refreshPowerlineLayerText`
- `syncPowerlineLabels`

### Popup / Edit-Aktionen

- `createPowerlinePopupMarkup`
- `refreshPowerlineLayerPopup`
- `applyPowerlineFeatureResponse`

### Erstellung / Loeschung

- `clearPendingPowerlineCreation`
- `startPowerlineCreationFromEndpoint`
- `completePendingPowerlineAtEndpoint`
- `deletePowerlineFeature`

### Live-Update-Anwendung

- `preparePowerlineData`
- `applyLivePowerlineFeature`
- `applyPowerlineFeatureResponse`

## 4. Welche globalen Daten gelesen werden

Direkt im Cluster gelesen:

- `powerlineData`
- `powerlineLayers`
- `powerlineAnimationFrameId`
- `powerlineAnimationLastFrameMs`
- `powerlineAnimationTimeSeconds`
- `POWERLINE_RENDER_CONFIG`
- `map`
- `IS_EDIT_MODE`
- `pendingPowerlineCreationStart`
- `labelMarkers`

Explizit geprueft aus der Beispiel-Liste:

- `locationMarkers`: nicht direkt gelesen, aber indirekt ueber `findLocationMarkerByPublicId(...)`

## 5. Welche globalen Daten geschrieben werden

Direkt im Cluster geschrieben:

- `powerlineLayers`
- `powerlineData`
- `powerlineAnimationFrameId`
- `powerlineAnimationLastFrameMs`
- `powerlineAnimationTimeSeconds`
- `pendingPowerlineCreationStart`

Ausserdem werden Powerline-Objekte mutiert:

- `_layerGroup`
- `_labelLine`
- `_interactiveLines`

## 6. Welche externen Funktionen der Cluster aufruft

- `findLocationMarkerByPublicId`
- `locationPopupMarkup`
- `locationPopupActionsMarkup`
- `popupActionButtonMarkup`
- `submitMapFeatureEdit`
- `updateRevisionFromEditResponse`
- `loadChangeLog`
- `showFeedbackToast`
- `setSelectedMapLayerMode`
- `refreshAllLocationMarkerPopups`
- `refreshLabelMarkerPopup`
- `setPowerlineEditDialogOpen`

Weitere wichtige externe Abhaengigkeiten:

- `getSelectedMapLayerMode`
- `getLocationNameLabelSize`
- `isEligiblePowerlineEndpoint`

## 7. Welche Funktionen vermutlich von aussen gebraucht werden

Durch Aufrufstellen in `index.html`, `js/routing.js`, `js/spotlight-search.js`, `js/dialogs-review-paths.js` und `js/dialogs-review-editor-submit.js` sind mindestens diese Funktionen extern relevant:

- `syncPowerlineLabels`
- `ensurePowerlineAnimationLoop`
- `stopPowerlineAnimationLoop`
- `shouldPowerlineNameBeDisplayed`
- `applyPowerlineFeatureResponse`
- `preparePowerlineData`
- `startPowerlineCreationFromEndpoint`
- `completePendingPowerlineAtEndpoint`
- `findPowerlineByPublicId`
- `deletePowerlineFeature`
- `getPowerlineDisplayName`
- `getPowerlineLatLngs`

## 8. Moegliche spaetere Ziel-Datei bewerten

### Option A: `js/map-features-powerlines.js`

Vorteile:

- niedrigere Umstellungsrisiken im aktuellen globalen Script-Aufbau
- klare Zwischenstufe mit engem Scope
- reduziert Risiko eines vorschnellen, zu breiten Architektur-Sprungs

Nachteile:

- noch kein Endzustand gemaess langfristigem Zielbild

### Option B: `js/powerlines.js`

Vorteile:

- passt eher zur langfristigen Modulidee

Nachteile:

- semantisch grosserer Schritt
- hoeheres Risiko, dass weitere Cluster unbeabsichtigt mitgezogen werden (Location/Popup/Edit)

### Bewertung

Fuer den aktuellen klassischen Script-Tag-Aufbau ist **`js/map-features-powerlines.js` risikoaermer**.

## 9. Noetige Script-Reihenfolge, falls spaeter ausgelagert

Konservativ und risikoarm waere:

1. Basis-/State-/Utility-Skripte
2. Popup-/Dialog-Helfer, die der Cluster nutzt
3. `js/map-features-labels.js` (bereits vorhanden)
4. `js/map-features-powerlines.js` (neue Split-Datei)
5. `js/map-features.js` (Rest-Orchestrator)
6. nachgelagerte Verbraucher (`js/routing.js`, `js/spotlight-search.js`)

Wichtig:

- keine ES-Module
- keine Top-Level-Ausfuehrung in der neuen Split-Datei
- globale Funktionsnamen unveraendert behalten

## 10. Risikoanalyse

- Animation / `requestAnimationFrame`: mittel bis hoch
  - Schleifenstart/-stop und `document.visibilityState` muessen exakt gleich bleiben
- Popup-Aktionen: mittel
  - Action-IDs und `data-public-id` muessen 1:1 erhalten bleiben
- Verbindung zu Nodix-Orten: mittel
  - Start/Ziel-Eligibility darf nicht regressiv werden
- Label-Text entlang Linien: mittel
  - `setText`/`removeText` und Zoom-Schwelle sind sichtbar
- Editmode: mittel
  - Sichtbarkeit/Popup-Aktionen haengen an `IS_EDIT_MODE`
- Live-Update / API: mittel bis hoch
  - `submitMapFeatureEdit`, Revision-Update, Changelog-Refresh sind zentral
- Zusammenspiel mit Location-Markern: mittel
  - LatLng-Aufloesung ueber `findLocationMarkerByPublicId` und Popup-Refresh bei Pending-Flow

## 11. Klare Empfehlung

- **Soll danach ein Code-Split folgen?**
  - **Ja, als minimaler 1:1-Schnitt** ist der Cluster geeignet.

- **Minimaler spaeterer 1:1-Schnitt:**
  - exakt die oben gelisteten 30 Powerline-Funktionen nach `js/map-features-powerlines.js`
  - keine zusaetzlichen Location-/Label-/Path-/Region-Funktionen mitnehmen
  - keine Logikaenderung
  - `js/map-features-powerlines.js` vor `js/map-features.js` laden

- **Was vorher klar sein muss:**
  - enger Smoke-Zyklus fuer Powerline-Modus, Animation, Popup-Aktionen, Nodix-Start/Ziel, Erstellen/Loeschen, Live-Update und Konsole
