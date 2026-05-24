# Refactoring Status

## 1. Current Stable Boundaries

- `js/route-graph-core.js` bleibt als stabilisierter Routing-/Graph-Kern mit `calculateRouteCore(...)` und den bereits extrahierten Graph-/Geometrie-Helfern.
- `createGraph(...)` bleibt stabil als Orchestrator im Inline-Script von `index.html`, mit lokalem Helper `addRegularPathToGraph(graph, pathFeature)`.
- `updateMapView(...)` bleibt stabil als Orchestrator in `js/routing.js`, entlastet durch:
  - `collectAndValidateSelectedLocations()`
  - `buildRouteResultFromSelectedLocations(useShortest)`
- `js/popups.js` bleibt stabil mit lokalem Helper `pathCreationActionButtonsMarkup(publicId)`.
- Dialog-Review-Split ist jetzt in zweiundzwanzig stabile Schichten getrennt, mit klassischer Script-Reihenfolge in `index.html`:
  1. `js/dialogs-review-core.js`
  2. `js/dialogs-review-status.js`
  3. `js/dialogs-review-pending.js`
  4. `js/dialogs-review-paths.js`
  5. `js/dialogs-review-labels.js`
  6. `js/dialogs-review-locations.js`
  7. `js/dialogs-review-panels.js`
  8. `js/dialogs-review-wiki-sync.js`
  9. `js/dialogs-review-region-wiki-picker.js`
  10. `js/dialogs-review-region-basics.js`
  11. `js/dialogs-review-region-parent-tree.js`
  12. `js/dialogs-review-region-assignment-state.js`
  13. `js/dialogs-review-region-assignment-ui.js`
  14. `js/dialogs-review-region-tabs-payload.js`
  15. `js/dialogs-review-region-save-flow.js`
  16. `js/dialogs-review-region-dialog-population.js`
  17. `js/dialogs-review-region-submit-flow.js`
  18. `js/dialogs-review-region-events.js`
  19. `js/dialogs-review-dialog-state.js`
  20. `js/dialogs-review-editor-submit.js`
  21. `js/dialogs-review-report-flow.js`
  22. `js/dialogs-review.js`
- `js/dialogs-review-core.js` ist stabiler Core-Cluster-Split (DOM-/Dialog-Getter, Form-/Status-Getter, `is...DialogOpen`, `isLocationReportServiceConfigured`, `syncModalDialogBodyState`).
- `js/dialogs-review-status.js` ist stabiler Status-Cluster-Split (`dataset.status` + `dataset.state` Wrapper/Helper).
- `js/dialogs-review-pending.js` ist stabiler Pending-Cluster-Split (`setFormFieldsDisabled(...)` + fuenf `set...SubmitPending`-Wrapper).
- `js/dialogs-review-paths.js` ist stabiler Path-/Powerline-Edit-Cluster-Split.
- `js/dialogs-review-labels.js` ist stabiler Label-Edit-Cluster-Split.
- `js/dialogs-review-locations.js` ist stabiler Location-Report-/Location-Edit-Cluster-Split.
- `js/dialogs-review-panels.js` ist stabiler Review/Change/Presence-Panel-Cluster-Split.
- `js/dialogs-review-wiki-sync.js` ist stabiler WikiSync-Cluster-Split (Locations-/Territories-Panel, Filter/Accordion, Resolve-Dialog-Helfer, Fokus/Preview, WikiSync-Flow-Helfer).
- `js/dialogs-review-region-wiki-picker.js` ist stabiler Region-Wiki-Picker-Cluster-Split.
- `js/dialogs-review-region-basics.js` ist stabiler Region-Dialog-Basics-Cluster-Split (Reset/Open-State/Opacity/Valid-To/Wappen/Required-State/Typoptionen).
- `js/dialogs-review-region-parent-tree.js` ist stabiler Region-Parent-Tree-/Region-Anzeige-Helfer-Cluster-Split.
- `js/dialogs-review-region-assignment-state.js` ist stabiler Region-Assignment-State-/Breadcrumb-Cache-Cluster-Split.
- `js/dialogs-review-region-assignment-ui.js` ist stabiler Region-Assignment-UI-/Operations-Helfer-Cluster-Split.
- `js/dialogs-review-region-tabs-payload.js` ist stabiler Region-Tabs-/Payload-State-Helfer-Cluster-Split.
- `js/dialogs-review-region-save-flow.js` ist stabiler Region-Save-/Tab-Load-Helfer-Cluster-Split.
- `js/dialogs-review-region-dialog-population.js` ist stabiler Region-Dialog-Population-Cluster-Split.
- `js/dialogs-review-region-submit-flow.js` ist stabiler Region-Submit-/Payload-Flow-Cluster-Split.
- `js/dialogs-review-region-events.js` ist stabiler Region-/Herrschaftsgebiet-Event-Bindings-Cluster-Split.
- `js/dialogs-review-dialog-state.js` ist stabiler Dialog-Reset-/Open-State-Cluster-Split.
- `js/dialogs-review-editor-submit.js` ist stabiler Cluster fuer klassische Editor-Submit-Handler (Location/Path/Powerline/Label).
- `js/dialogs-review-report-flow.js` ist stabiler Review-/Location-Report-Flow-Cluster-Split.
- `js/dialogs-review.js` bleibt stabil als Rest-Orchestrator fuer Konstanten/Cache/Validator-/Init-Logik und verbleibende Hilfsfunktionen.
- `js/ui-controls.js` bleibt stabil mit lokalem Helper `bindPersistedTabClickHandler(selector, datasetKey, allowedValues, storageKey, urlParameterName)` fuer Review-/Wiki-Sync-Tab-Persistierung.
- `js/map-features-labels.js` ist stabiler Split fuer freie Kartenlabels (1:1-Extract ohne Logikaenderung).
- `js/map-features-powerlines.js` ist stabiler Split fuer Powerline-Helfer (1:1-Extract ohne Logikaenderung).
- `js/map-features-layer-state.js` ist stabiler Split fuer URL-/Planner-State-Helfer (1:1-Extract ohne Logikaenderung).
- `js/map-features-location-name-labels.js` ist stabiler Split fuer Ortsnamenlabel-Helfer (1:1-Extract ohne Logikaenderung).
- `js/map-features-path-labels.js` ist stabiler Split fuer Weg-/Pfad-Textlabel-Helfer (1:1-Extract ohne Logikaenderung).
- `js/map-features-path-rendering.js` ist stabiler Split fuer Path-Rendering-Core-Helfer (1:1-Extract ohne Logikaenderung).
- `js/map-features-share-pin.js` ist stabiler Split fuer Share-Pin-/Clipboard-Helfer (1:1-Extract ohne Logikaenderung).
- `index.html` laedt im Map-Features-Bereich jetzt in dieser Reihenfolge:
  - `js/map-features-labels.js`
  - `js/map-features-powerlines.js`
  - `js/map-features-layer-state.js`
  - `js/map-features-share-pin.js`
  - `js/map-features-location-name-labels.js`
  - `js/map-features-path-labels.js`
  - `js/map-features-path-rendering.js`
  - `js/map-features.js`
- `js/map-features.js` bleibt stabil als Orchestrator fuer:
  - `getSelectedMapLayerMode`
  - `setSelectedMapLayerMode`
  - `applyDisplayOptions`
  - Waypoint-UI-Helfer
  - Share-Pin-Orchestrierung
  - Label-Kollision
  - Wegnamen-/Kraftlinien-Textlabels
  - Karten-/Feature-Orchestrierung
- Kollisionslogik bleibt weiterhin in `js/map-features.js`:
  - `getLocationNameLabelPriority`
  - `getLocationNameLabelBaseOffset`
  - `getLocationNameLabelOffsets`
  - `applyLocationNameLabelOffset`
  - `getCollisionEntries`
  - `resolveLabelCollisions`
  - `scheduleLabelCollisionResolution`
- Path-Rendering und Path-Lifecycle bleiben weiterhin in `js/map-features.js`, insbesondere:
  - `syncPathVisibility`
  - `preparePathData`
  - `applyLivePathFeature`
  - `applyPathFeatureResponse`
  - `removePathFeature`
  - `deletePathFeature`
  - `normalizeRoutePathFeature`
  - `syncPathRendering`
- Domain-/Basis-Helper bleiben weiterhin in `js/map-features.js`:
  - `getPathDisplayName`
  - `getPathPublicId`
  - `normalizePathSubtype`
  - `getPathStyleColors`
- URL-/Planner-State-Funktionen bleiben weiterhin in `js/map-features-layer-state.js`, insbesondere:
  - `formatSharePinQueryValue`
  - `syncPlannerStateToUrl`
  - `applyPlannerStateFromUrl`
  - `readSharePinFromUrl`
  - `buildPlannerSearchParams`
- Feedback-Toast-Helfer bleiben weiterhin in `js/map-features.js`, insbesondere:
  - `getFeedbackToastElement`
  - `showFeedbackToast`
- Verschoben wurden im Share-Pin-Split nur:
  - `createSharePinIcon`
  - `clearSharePin`
  - `setSharePin`
  - `fallbackCopyTextToClipboard`
  - `copyTextToClipboard`
  - `copyCurrentUrlToClipboard`
  - `copyCurrentUrlToClipboardWithFeedback`
- Verschoben wurden im Path-Rendering-Core-Split nur:
  - `createPathPopupMarkup`
  - `updatePathLayerStyle`
  - `getPathVisualLatLngCoordinates`
  - `refreshPathLayerPopup`
  - `createPathLayer`
  - `updatePathLayerGeometry`

## 2. Recent Safe Extracts / Splits

- Erster kontrollierter Datei-Split: Status-Cluster nach `js/dialogs-review-status.js`.
- Zweiter kontrollierter Datei-Split: Pending-Cluster nach `js/dialogs-review-pending.js`.
- Dritter kontrollierter Datei-Split: Path-/Powerline-Edit-Cluster nach `js/dialogs-review-paths.js`.
- Vierter kontrollierter Datei-Split: Label-Edit-Cluster nach `js/dialogs-review-labels.js`.
- Fuenfter kontrollierter Datei-Split: Location-Report-/Location-Edit-Cluster nach `js/dialogs-review-locations.js`.
- Sechster kontrollierter Datei-Split: Core-/Getter-/Modal-State-Cluster nach `js/dialogs-review-core.js`.
- Siebter kontrollierter Datei-Split: Review/Change/Presence-Panel-Cluster nach `js/dialogs-review-panels.js`.
- Achter kontrollierter Datei-Split: WikiSync-Cluster nach `js/dialogs-review-wiki-sync.js`.
- Neunter kontrollierter Datei-Split: Region-Wiki-Picker-Cluster nach `js/dialogs-review-region-wiki-picker.js`.
- Zehnter kontrollierter Datei-Split: Region-Dialog-Basics-Cluster nach `js/dialogs-review-region-basics.js`.
- Elfter kontrollierter Datei-Split: Region-Parent-Tree-/Region-Anzeige-Helfer-Cluster nach `js/dialogs-review-region-parent-tree.js`.
- Zwoelfter kontrollierter Datei-Split: Region-Assignment-State-/Breadcrumb-Cache-Cluster nach `js/dialogs-review-region-assignment-state.js`.
- Dreizehnter kontrollierter Datei-Split: Region-Assignment-UI-/Operations-Helfer-Cluster nach `js/dialogs-review-region-assignment-ui.js`.
- Vierzehnter kontrollierter Datei-Split: Region-Tabs-/Payload-State-Helfer-Cluster nach `js/dialogs-review-region-tabs-payload.js`.
- Fuenfzehnter kontrollierter Datei-Split: Region-Save-/Tab-Load-Helfer-Cluster nach `js/dialogs-review-region-save-flow.js`.
- Sechzehnter kontrollierter Datei-Split: Region-Dialog-Population-Cluster nach `js/dialogs-review-region-dialog-population.js`.
- Siebzehnter kontrollierter Datei-Split: Region-Submit-/Payload-Flow-Cluster nach `js/dialogs-review-region-submit-flow.js`.
- Achtzehnter kontrollierter Datei-Split: Region-/Herrschaftsgebiet-Event-Bindings-Cluster nach `js/dialogs-review-region-events.js`.
- Neunzehnter kontrollierter Datei-Split: klassische Editor-Submit-Handler nach `js/dialogs-review-editor-submit.js`.
- Zwanzigster kontrollierter Datei-Split: Review-/Location-Report-Flow-Cluster nach `js/dialogs-review-report-flow.js`.
- Einundzwanzigster kontrollierter Datei-Split: Dialog-Reset-/Open-State-Cluster nach `js/dialogs-review-dialog-state.js`.
- Zweiundzwanzigster kontrollierter Datei-Split: freier Kartenlabel-Cluster aus `js/map-features.js` nach `js/map-features-labels.js` (Commit `47e71d67a348442b1e9947bb6e7a80bfafab0bb3`, 1:1-Extract ohne Logikaenderung).
- Dreiundzwanzigster kontrollierter Datei-Split: Powerline-Cluster aus `js/map-features.js` nach `js/map-features-powerlines.js` (Commit `f8dfe947fb57861dd79563c8418aa575a69ffd6b`, 1:1-Extract ohne Logikaenderung).
- Vierundzwanzigster kontrollierter Datei-Split: URL-/Planner-State-Cluster aus `js/map-features.js` nach `js/map-features-layer-state.js` (Commit `b3721185d7e091109eeb4bd1ad6f3e5ecec0e54e`, 1:1-Extract ohne Logikaenderung).
- Fuenfundzwanzigster kontrollierter Datei-Split: Ortsnamenlabel-Cluster aus `js/map-features.js` nach `js/map-features-location-name-labels.js` (Commit `a5ba60613746df0a0960b5bf2d47bb1433d3b5c9`, 1:1-Extract ohne Logikaenderung).
- Sechsundzwanzigster kontrollierter Datei-Split: Weg-/Pfad-Textlabel-Cluster aus `js/map-features.js` nach `js/map-features-path-labels.js` (Commit `ab77d2dea65dc3fa9fa9b9ee7102ce0ab805c8f5`, 1:1-Extract ohne Logikaenderung).
- Siebenundzwanzigster kontrollierter Datei-Split: Path-Rendering-Core-Cluster aus `js/map-features.js` nach `js/map-features-path-rendering.js` (Commit `847dcfa3562522f61abad4d578b7353e9bfca491`, 1:1-Extract ohne Logikaenderung).
- Achtundzwanzigster kontrollierter Datei-Split: Share-Pin-/Clipboard-Cluster aus `js/map-features.js` nach `js/map-features-share-pin.js` (Commit `f8cb8c19f2be538dd0bbd299dfef53fe086a608d`, 1:1-Extract ohne Logikaenderung).
- Abhaengigkeitsrichtung ist jetzt sauberer: Core vor Status/Pending/Feature/Panel/WikiSync-Dateien, Rest-Orchestrator zuletzt.

## 3. Areas To Leave Stable For Now

- Routing/Graph (`createGraph`, `updateMapView`, `js/route-graph-core.js`) stabil lassen.
- `js/popups.js` stabil lassen.
- Dialog-Bereich stabil lassen:
  - `js/dialogs-review-core.js`
  - `js/dialogs-review-status.js`
  - `js/dialogs-review-pending.js`
  - `js/dialogs-review-paths.js`
  - `js/dialogs-review-labels.js`
  - `js/dialogs-review-locations.js`
  - `js/dialogs-review-panels.js`
  - `js/dialogs-review-wiki-sync.js`
  - `js/dialogs-review-region-wiki-picker.js`
  - `js/dialogs-review-region-basics.js`
  - `js/dialogs-review-region-parent-tree.js`
  - `js/dialogs-review-region-assignment-state.js`
  - `js/dialogs-review-region-assignment-ui.js`
  - `js/dialogs-review-region-tabs-payload.js`
  - `js/dialogs-review-region-save-flow.js`
  - `js/dialogs-review-region-dialog-population.js`
  - `js/dialogs-review-region-submit-flow.js`
  - `js/dialogs-review-region-events.js`
  - `js/dialogs-review-dialog-state.js`
  - `js/dialogs-review-editor-submit.js`
  - `js/dialogs-review-report-flow.js`
- Keine Cluster direkt weiter aufteilen ohne neue Boundary-Analyse.
- `js/dialogs-review.js` nur mit engem, neu analysiertem Scope weiter zerschneiden.
- Kein weiterer Label-Split rund um `js/map-features-labels.js`/`js/map-features.js` ohne neue Boundary-Analyse.
- Kein weiterer Powerline-Split rund um `js/map-features-powerlines.js`/`js/map-features.js` ohne neue Boundary-Analyse.
- Kein weiterer Planner-State-/Layer-Mode-Split rund um `js/map-features-layer-state.js`/`js/map-features.js` ohne neue Boundary-Analyse.
- Kein weiterer Ortsnamenlabel-/Kollisions-Split rund um `js/map-features-location-name-labels.js`/`js/map-features.js` ohne neue Boundary-Analyse.
- Kein weiterer Path-/Path-Textlabel-Split rund um `js/map-features-path-labels.js`/`js/map-features.js` ohne neue Boundary-Analyse.
- Kein weiterer Path-Rendering-/Lifecycle-Split rund um `js/map-features-path-rendering.js`/`js/map-features.js` ohne neue Boundary-Analyse.
- Kein weiterer Share-Pin-/URL-State-Split rund um `js/map-features-share-pin.js`/`js/map-features-layer-state.js`/`js/map-features.js` ohne neue Boundary-Analyse.

## 4. Planned But Not Yet Implemented

- `renderRouteResult(routeNodeNames, segments)` in `js/routing.js` (nur geplant).
- Popups: moeglicher Powerline-Action-Button-Helper (nur analysiert).
- UI-Controls Transport-Menue: moeglicher `bindTransportControlEvents(control, selectId)`-Extract (nur analysiert).
- Moegliche spaetere Parameterisierung von `createGraph`/Transportlogik.
- Moegliche spaetere Entkopplung von `getSyntheticRouteConfig`.
- Dialogs-Review (nur Analysebereiche, keine direkten Code-Schritte):
  - Region/Territory-Cluster
  - Region-Parent-/Assignment-/Tabs-/Submit-Cluster
  - Verbleibende Reset-/Helper-Funktionen (nur mit separater Boundary-Analyse)

## 5. Smoke-Test Status

- Produktiv auf [avesmaps.de](https://avesmaps.de/) wurde Routing/Dragging/Rerouting als funktionsfaehig bestaetigt.
- Path-/Powerline-Smoke bestanden (Wege gehen, Kraftlinien gehen).
- Label-Smoke bestanden (Labels gehen).
- Location-Smoke nach Split bestanden (alles geht, keine Meldungen, Verhalten wie erwartet).
- WikiSync-Smoke nach Split bestanden.
- Wichtige WikiSync-Smoke-Faelle (bereits als relevant dokumentiert):
  - WikiSync-Tab oeffnen, Locations-Liste laden
  - Filter und Accordion testen
  - Resolve-Dialog mit sicheren Testdaten oeffnen/schliessen, Presets pruefen
  - Herrschaftsgebiete-Tab oeffnen, Baum/Filter testen
  - zu Meldungen/Aenderungen/Status zurueckwechseln
  - keine neuen Konsolenfehler/ReferenceErrors
- Region-Wiki-Picker-Smoke nach Split bestanden.
- Wichtige Region-Wiki-Picker-Smoke-Faelle:
  - Region/Herrschaftsgebiet-Dialog fuer sicheren Testeintrag oeffnen
  - Wiki-Referenz-Picker oeffnen
  - Liste/Fehlermeldung und Filter pruefen
  - sichere Referenz auswaehlen (falls Testdaten vorhanden)
  - Uebernahme von Wiki-URL, Wappen-URL und Typ-Feld pruefen
  - keine neuen Konsolenfehler/ReferenceErrors
- Region-Basics-Smoke nach Split bestanden.
- Wichtige Region-Basics-Smoke-Faelle:
  - Region/Herrschaftsgebiet-Dialog oeffnen, schliessen, erneut oeffnen (Reset-Verhalten)
  - Opacity-Regler und Ausgabe pruefen
  - Valid-To-Open/Valid-To-Feld-Verhalten pruefen
  - Wappen-Preview pruefen
  - Region-Wiki-Picker kurz oeffnen
  - keine neuen Konsolenfehler/ReferenceErrors
- Region-Parent-Tree-Smoke nach Split bestanden.
- Wichtige Region-Parent-Tree-Smoke-Faelle:
  - Region/Herrschaftsgebiet-Dialog oeffnen
  - Parent-Baum, Filter, Auf-/Zuklappen und Leaf-Auswahl pruefen
  - optional Leaf-Drag auf Parent-Drop-Ziel mit sicheren Testdaten pruefen
  - Wiki-Referenz-, Zoom- und Zeitraum-Anzeigen kurz pruefen
  - keine neuen Konsolenfehler/ReferenceErrors
- Region-Assignment-State-Smoke nach Split bestanden.
- Wichtige Region-Assignment-State-Smoke-Faelle:
  - Region/Herrschaftsgebiet-Dialog oeffnen
  - Assignment-/Breadcrumb-Anzeige pruefen
  - persistierte Zuweisung laden lassen (falls Testdaten vorhanden)
  - Tabs wechseln (falls mehrere Tabs entstehen)
  - Dialog schliessen und Konsole pruefen
- Region-Assignment-UI-Smoke nach Split bestanden.
- Wichtige Region-Assignment-UI-Smoke-Faelle:
  - Region/Herrschaftsgebiet-Dialog oeffnen
  - Assignment-/Breadcrumb-Anzeige und Summary-Felder pruefen
  - Breadcrumb-Klick und Parent-/Assignment-Drop mit Testdaten pruefen
  - Geometrie freigeben/Speichern nur mit sicherer Testregion pruefen
  - Dialog schliessen und erneut oeffnen, Konsole pruefen
- Region-Tabs-Payload-Smoke nach Split bestanden.
- Wichtige Region-Tabs-Payload-Smoke-Faelle:
  - Region/Herrschaftsgebiet-Dialog oeffnen
  - Tab-Anzeige und Tab-Wechsel pruefen
  - Feld aendern, Tab wechseln und zurueckwechseln
  - Tab schliessen und Dirty-Confirm pruefen (falls moeglich)
  - Dialog schliessen/erneut oeffnen, Konsole pruefen
- Region-Save-Flow-Smoke nach Split bestanden.
- Wichtige Region-Save-Flow-Smoke-Faelle:
  - Region/Herrschaftsgebiet-Dialog oeffnen
  - Breadcrumb/Assignment so nutzen, dass weiterer Territory-Tab geladen wird
  - Dirty-Confirm beim Tab-Schliessen pruefen
  - Speichern mit sicherer Testregion pruefen
  - Geometrie-Zuweisung speichern (nur mit sicheren Testdaten)
  - Dialog schliessen/erneut oeffnen, Konsole pruefen
- Region-Dialog-Population-Smoke nach Split bestanden.
- Wichtige Region-Dialog-Population-Smoke-Faelle:
  - Region/Herrschaftsgebiet-Dialog oeffnen
  - Formularwerte (Name, Kurzname, Farbe, Opacity, Wiki/Wappen, Zoom, Zeitraum, Aktiv, Notizen) pruefen
  - Dialog schliessen und erneut oeffnen
  - Tab-Wechsel sowie Parent-Baum/Assignment-Anzeige kurz pruefen
  - Political-Territory-Options-Nachladen (falls sichtbar) pruefen
  - keine neuen Konsolenfehler/ReferenceErrors
- Region-Submit-Flow-Smoke nach Split bestanden.
- Wichtige Region-Submit-Flow-Smoke-Faelle:
  - Region/Herrschaftsgebiet-Dialog oeffnen
  - Formularwerte aendern und speichern
  - Political-Territory-Tab speichern (sichere Testregion)
  - mehrere Tabs speichern (falls Testdaten vorhanden)
  - nicht-political Region-Speichern mit sicherem Testeintrag pruefen
  - Dialog erneut oeffnen und Werte/Konsole pruefen
- Region-Events-Smoke nach Split bestanden.
- Wichtige Region-Events-Smoke-Faelle:
  - Region/Herrschaftsgebiet-Dialog oeffnen
  - Tab-Klick und Tab-Schliessen pruefen
  - Parent-Baum (Klick, Auf-/Zuklappen, Doppelklick) pruefen
  - Parent-Drop / Assignment-Drop / Breadcrumb-Klick / Assignment-Clear pruefen
  - Assignment-Summary-Felder (Zoom, Farbe, Opacity, Name, Wappen, Zeitraum) pruefen
  - Parent-Clear und anschliessendes Speichern mit sicherer Testregion pruefen
  - keine neuen Konsolenfehler/ReferenceErrors
- Editor-Submit-Smoke nach Split bestanden.
- Wichtige Editor-Submit-Smoke-Faelle:
  - Ort-Edit-Dialog oeffnen und speichern (sicherer Testeintrag)
  - Weg-Edit-Dialog oeffnen und speichern (sicherer Testweg)
  - Kraftlinie-Edit-Dialog speichern (falls vorhanden, sichere Testdaten)
  - Label-Edit-Dialog oeffnen und speichern (sicherer Testeintrag)
  - optional neue Entitaeten aus Review-Meldungen mit sicheren Testdaten pruefen
  - keine neuen Konsolenfehler/ReferenceErrors
- Report-Flow-Smoke nach Split bestanden.
- Wichtige Report-Flow-Smoke-Faelle:
  - Meldungen-/Review-Panel oeffnen
  - sichere Location-Meldung anklicken und Ort-Edit-Vorbefuellung pruefen
  - sichere Label-/Map-Meldung anklicken und Label-Edit-Vorbefuellung pruefen
  - sichere Testmeldung verwerfen (falls Testdaten vorhanden)
  - Location-Report-Formular oeffnen, Validierung pruefen
  - Location-Report senden nur mit sicheren Testdaten
  - keine neuen Konsolenfehler/ReferenceErrors
- Dialog-State-Smoke nach Split bestanden.
- Wichtige Dialog-State-Smoke-Faelle:
  - Weg-Edit-Dialog oeffnen/schliessen/erneut oeffnen
  - Weg speichern mit sicherem Testweg
  - Kraftlinie-Edit-Dialog oeffnen/schliessen/speichern (sichere Testdaten)
  - Label-Edit-Dialog oeffnen/schliessen/erneut oeffnen und speichern
  - Report-Flow kurz pruefen (resetLabelEditForm setzt Report-Kontext zurueck)
  - keine neuen Konsolenfehler/ReferenceErrors
- Free-Labels-Smoke nach Split bestanden (Betreiber-Smoke Schritte 1-11 durchgefuehrt, keine Browser-Konsolenmeldungen).
- Powerlines-Split-Smoke nach Split bestanden (Betreiber-Smoke Schritte 1-11 durchgefuehrt, keine Browser-Konsolenmeldungen).
- Planner-State-Split-Smoke nach Split bestanden (Betreiber-Smoke Schritte 1-12 durchgefuehrt, keine Browser-Konsolenmeldungen).
- Ortsnamenlabel-Split-Smoke nach Split bestanden (Betreiber-Smoke Schritte 1-12 durchgefuehrt, keine Browser-Konsolenmeldungen gemeldet).
- Path-/Pfad-Textlabel-Split-Smoke nach Split bestanden (Betreiber-Smoke Schritte 1-11 durchgefuehrt, keine Browser-Konsolenmeldungen).
- Path-Rendering-Core-Split-Smoke nach Split bestanden (Betreiber-Smoke Schritte 1-13 durchgefuehrt, keine Browser-Konsolenmeldungen).
- Share-Pin-Smoke nach Split durch Betreiber als bestanden/gut gemeldet; keine offenen Fehler gemeldet.
- Animation war dabei nicht sichtbar, weil sie bewusst deaktiviert ist; das wurde als erwartetes Verhalten bewertet.
- Core-Smoke empfohlen/offen, falls noch nicht gemeldet (`modal-dialog-open`, Dialoge oeffnen/schliessen).
- Fuer jeden spaeteren Split ist ein eigener, gezielter Smoke-Zyklus erforderlich.

## 6. Important Clarifications

- Ziel des Gesamt-Refactorings ist kontrollierte Modularisierung in kleine, verstaendliche Dateien.
- Klassische globale Script-Reihenfolge bleibt zentral.
- Keine ES-Module, kein Build-System.
- Grosse Cluster wie Region/Territory und Init/Event-Binding nicht ohne eigene Boundary-Analyse verschieben.
- Region/Territory und Region-Wiki-Picker waren explizit nicht Teil des WikiSync-Splits.
- Region/Territory-Parent/Assignment/Submit-Logik war explizit nicht Teil des Region-Wiki-Picker-Splits.
- Region-Parent-Tree, Region-Assignment, Region-Tabs, Region-Submit-Handler und Region-Event-Bindings waren explizit nicht Teil des Region-Basics-Splits.
- Assignment-UI, Region-Tabs, Region-Submit-Handler und Region-Event-Bindings waren explizit nicht Teil des Region-Assignment-State-Splits.
- Region-Assignment, Region-Tabs, Region-Submit-Handler und Region-Event-Bindings waren explizit nicht Teil des Region-Parent-Tree-Splits.
- Region-Tabs, Region-Submit-Handler und Region-Event-Bindings waren explizit nicht Teil des Region-Assignment-UI-Splits.
- Save/Submit, Dialog-Population und Region-Event-Bindings waren explizit nicht Teil des Region-Tabs-Payload-Splits.
- Dialog-Population, Region-Event-Bindings, Region-Submit-Handler und Init-/Bootstrapping-Logik waren explizit nicht Teil des Region-Save-Flow-Splits.
- Region-Event-Bindings, Region-Submit-Handler sowie Init-/Bootstrapping-Logik waren explizit nicht Teil des Region-Dialog-Population-Splits.
- Region-Event-Bindings, andere Editor-Submit-Handler sowie Init-/Bootstrapping-Logik waren explizit nicht Teil des Region-Submit-Flow-Splits.
- Andere Editor-Submit-Handler, Report-Handler sowie Init-/Bootstrapping-Logik waren explizit nicht Teil des Region-Events-Splits.
- Review-Report-Helfer, Location-Report-Submit sowie Init-/Bootstrapping-Logik waren explizit nicht Teil des Editor-Submit-Splits.
- Dialog-Reset/Open-State-Helfer, Validatoren sowie Init-/Bootstrapping-Logik waren explizit nicht Teil des Report-Flow-Splits.
- Konstanten, Cache-Variablen, Normalizer, Validatoren sowie Init-/Bootstrapping-Logik waren explizit nicht Teil des Dialog-State-Splits.

## 7. Next Recommended Step

- Kein weiterer `dialogs-review`-Code-Split empfohlen.
- `js/dialogs-review.js` bleibt als finaler Minimal-Rest stabil.
- Weitere Splits nur bei konkretem fachlichem Bedarf und mit neuer Boundary-Analyse.
- Kein weiterer Label-Split ohne neue Boundary-Analyse.
- Kein weiterer Planner-State-/Layer-Mode-Split ohne neue Boundary-Analyse.
