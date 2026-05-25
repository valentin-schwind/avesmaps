# Dialogs Review Location Split Boundary Check

## 1. Current Location Responsibilities

### Location report
- `buildLocationReportRequestPayload(formElement)` baut den Request-Body fuer Ortsmeldungen.
- `syncLocationReportTypeFields()` schaltet Pflicht-/Sichtbarkeitslogik zwischen `report_type=location` und `report_type=comment`.
- `updateLocationReportDialogAvailability()` steuert Service-Hinweis und Submit-Button je nach `LOCATION_REPORT_FORM_ENDPOINT_URL` und Pending-Status.
- `populateLocationReportForm(latlng)` setzt Position, Standardwerte, Metadaten (`ICON_ASSET_VERSION`, Zeitstempel) und triggert Feld-Sync.
- `resetLocationReportForm()` leert Formular/State und setzt Status zurueck.

### Location edit
- `populateLocationEditForm(...)` befuellt Edit/Create-Felder inkl. Presets und Crossing-Conversion-Sonderfall.
- `resetLocationEditForm({ preserveWikiSyncFlow })` setzt Formular, States und Soft-Lock zurueck; kann Wiki-Sync-Flow bewusst erhalten.
- `buildLocationEditPayload(formElement)` baut `create_point`/`update_point` Payload.

### Dialog open/close
- `setLocationReportDialogOpen(isOpen, { resetForm })` mit Pending-Guard fuer Report.
- `setLocationEditDialogOpen(isOpen, { resetForm })` mit Pending-Guard fuer Edit.
- `openLocationReportDialog(latlng)` und `openLocationEditDialog(options)` orchestrieren Reset/Populate/Open.

### Koordinatenformatierung
- `formatLocationReportCoordinates(latlng)` liefert normierte Anzeige (`lat,lng`) und wird auch ausserhalb reiner Dialog-Faelle genutzt (Review/Wiki-Sync-Anzeige).

### Beruehrungspunkte ausserhalb des Clusters
- Review: `activeReviewReportId`, `activeReviewReportSource`, `openLocationEditDialogFromReport(...)`.
- Wiki-Sync-Create-Flow: Presets/Reset in `openLocationEditDialog(...)` + `resetLocationEditForm(...)`.
- Crossing-Conversion: `pendingCrossingConversion*` wird in Populate/Reset/Payload-Workflow beruehrt.

## 2. Candidate Split Files

### A. `js/dialogs-review-locations.js` (Report + Edit gemeinsam)
- Vorteil: gemeinsamer, fachlich konsistenter Dialogbereich (Report + Edit + gemeinsame Koordinatenformatierung).
- Risiko: mittel (mehr Funktionen, aber weiterhin reiner 1:1-Transfer moeglich).
- Eignung: gut, wenn strikt nur die Location-Dialogfunktionen verschoben werden.

### B. `js/dialogs-review-location-report.js` (nur Report)
- Vorteil: sehr klarer Scope.
- Nachteil: trennt eng gekoppelten gemeinsamen Utility-Teil (`formatLocationReportCoordinates`) von Edit/Review-Nutzung.
- Eignung: mittel.

### C. `js/dialogs-review-location-edit.js` (nur Edit)
- Vorteil: fokussiert auf Create/Edit-Payload und Formularbefuellung.
- Nachteil: Edit ist stark mit Review/Wiki-Sync/Crossing-Conversion verzahnt.
- Eignung: mittel bis niedrig als erster Schritt.

### D. vorerst kein Split
- konservativ stabil, aber blockiert weitere Modularisierung im groessten verbleibenden Dialogbereich.

## 3. Dependency Analysis

### Globaler State (direkt gelesen/geschrieben)
- `locationReportLatLng` (Report populate/reset/submit-Precondition).
- `locationEditLatLng`, `locationEditMarkerEntry` (Edit populate/reset).
- `activeReviewReportId`, `activeReviewReportSource` (Edit reset + Report-Approval-Flow via Submit-Handler).
- `pendingCrossingConversionPublicId`, `pendingCrossingConversionName`, `pendingCrossingConversionIsNodix` (Edit populate/reset + Submit-Payload-Logik ausserhalb Cluster).

### Wiki-Sync-Kopplungen
- `resetWikiSyncCreateLocationFlowState()` wird aus `resetLocationEditForm(...)` aufgerufen.
- Preset-Parameter (`presetName`, `presetWikiUrl`, `presetDescription`, `presetIsNodix`) werden in `populateLocationEditForm(...)` verarbeitet.

### Review-Kopplungen
- `activeReviewReportId` / `activeReviewReportSource` werden im Edit-Flow verwendet.
- `openLocationEditDialogFromReport(...)` ist location-nah, aber klar review-spezifisch (sollte nicht im ersten Location-Split mitwandern).

### Soft locks
- `acquireFeatureSoftLock(...)` in `populateLocationEditForm(...)`.
- `releaseFeatureSoftLock(...)` in `resetLocationEditForm(...)`.

### Status/Pending
- `setLocationReportStatus(...)`, `setLocationEditStatus(...)`.
- `isLocationReportSubmissionPending`, `isLocationEditSubmissionPending` in Open/Close/Availability.

### DOM getters
- `getLocationReportFormElement`, `getLocationEditFormElement`.
- `getLocationReportDialogElement`, `getLocationEditDialogElement`.
- `getLocationReportServiceNoteElement`.

### Externe Helper/Konstanten
- `getWikiLocationLink`, `normalizeLocationType`, `L.latLng`.
- `ICON_ASSET_VERSION`, `LOCATION_REPORT_FORM_ENDPOINT_URL`.

## 4. External Surface

Wahrscheinlich extern benoetigt (Call-Sites ausserhalb `dialogs-review.js`):
- `openLocationReportDialog` (`js/routing.js`).
- `openLocationEditDialog` (`js/map-features.js`).
- `setLocationReportDialogOpen` und `setLocationEditDialogOpen` (Inline-Bindings in `index.html`).
- `syncLocationReportTypeFields` (Inline-Binding in `index.html`).

Wahrscheinlich intern (nur `dialogs-review.js`):
- `buildLocationEditPayload`.
- `buildLocationReportRequestPayload`.
- `populateLocationReportForm`, `populateLocationEditForm`.
- `resetLocationReportForm`, `resetLocationEditForm`.
- `updateLocationReportDialogAvailability`.
- `formatLocationReportCoordinates` (intern breit genutzt, aber nicht als externer Einstiegspunkt).

## 5. Safest Possible First Move

Empfehlung fuer spaeteren ersten Code-Schritt: **Variante A** als enger 1:1-Datei-Split nach `js/dialogs-review-locations.js`.

### Exakt zu verschiebende Funktionen
- `buildLocationReportRequestPayload`
- `syncLocationReportTypeFields`
- `resetLocationReportForm`
- `resetLocationEditForm`
- `updateLocationReportDialogAvailability`
- `formatLocationReportCoordinates`
- `populateLocationReportForm`
- `setLocationReportDialogOpen`
- `setLocationEditDialogOpen`
- `openLocationReportDialog`
- `populateLocationEditForm`
- `openLocationEditDialog`
- `buildLocationEditPayload`

### Script-Reihenfolge (vorgeschlagen)
- `js/dialogs-review-status.js`
- `js/dialogs-review-pending.js`
- `js/dialogs-review-paths.js`
- `js/dialogs-review-labels.js`
- `js/dialogs-review-locations.js`
- `js/dialogs-review.js`

Begruendung: reine Funktionsdefinitionen; Abhaengigkeiten duerfen spaeter aufgeloest werden, solange kein Top-Level-Code in der neuen Datei laeuft.

## 6. Moves To Avoid

- Wiki-Sync-Create-Location-Flow nicht mitschieben (nur indirekte Aufrufe in Location-Reset belassen).
- Review-Report-Handling nicht mitschieben (`openLocationEditDialogFromReport`, Report-Status-Transitions).
- Submit-Handler nicht mitschieben (`handleLocationEditFormSubmit`, `handleLocationReportFormSubmit`).
- Event-Bindings nicht mitschieben (Inline-/Init-Bindings in `index.html`/`dialogs-review.js` belassen).
- Globale Variablen nicht mitschieben.
- DOM-Getter nicht mitschieben.
- Region- und Wiki-Sync-Cluster nicht anfassen.

## 7. Smoke-Test Requirements

- Location report oeffnen.
- `report_type` zwischen `location`/`comment` wechseln (Pflichtfelder/Sichtbarkeit).
- Service configured/unconfigured Verhalten pruefen (Hinweis + Submit disabled/enabled).
- Location edit oeffnen und bestehenden Ort bearbeiten.
- Neuen Ort anlegen (falls verfuegbar).
- Crossing-Konvertierung pruefen (falls schnell reproduzierbar).
- Wiki-Sync-Create-Preset pruefen (falls schnell reproduzierbar).
- Speichern (Report + Edit) und Erfolg/Fehlerstatus beobachten.
- Keine neuen Konsolenfehler oder `ReferenceError`.

## 8. Recommendation

- **Location-Split ist als naechster Split geeignet.**
- **Report und Edit sollten im ersten Schritt gemeinsam** in `js/dialogs-review-locations.js` ausgelagert werden (kleinster konsistenter fachlicher Schnitt ohne neue Querschnittsdateien).
- Vor Umsetzung: kein weiterer Bereich parallel splitten.
- Nach Umsetzung: gezielter Location-Smoke, dann erst den naechsten Subcluster analysieren.