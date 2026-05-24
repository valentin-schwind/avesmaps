# Refactoring Status

## 1. Current Stable Boundaries

- `js/route-graph-core.js` bleibt als stabilisierter Routing-/Graph-Kern mit `calculateRouteCore(...)` und den bereits extrahierten Graph-/Geometrie-Helfern.
- `createGraph(...)` bleibt stabil als Orchestrator im Inline-Script von `index.html`, mit lokalem Helper `addRegularPathToGraph(graph, pathFeature)`.
- `updateMapView(...)` bleibt stabil als Orchestrator in `js/routing.js`, entlastet durch:
  - `collectAndValidateSelectedLocations()`
  - `buildRouteResultFromSelectedLocations(useShortest)`
- `js/popups.js` bleibt stabil mit lokalem Helper `pathCreationActionButtonsMarkup(publicId)`.
- Dialog-Review-Split ist jetzt in vierzehn stabile Schichten getrennt, mit klassischer Script-Reihenfolge in `index.html`:
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
  14. `js/dialogs-review.js`
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
- `js/dialogs-review.js` bleibt stabil als Rest-Orchestrator fuer Region-/Territory-Tabs/Submit-Flows, Submit-/API-/Init-Logik und verbleibende Hilfsfunktionen.
- `js/ui-controls.js` bleibt stabil mit lokalem Helper `bindPersistedTabClickHandler(selector, datasetKey, allowedValues, storageKey, urlParameterName)` fuer Review-/Wiki-Sync-Tab-Persistierung.

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
- Keine Cluster direkt weiter aufteilen ohne neue Boundary-Analyse.
- `js/dialogs-review.js` nur mit engem, neu analysiertem Scope weiter zerschneiden.

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
- Region-Assignment-UI-Smoke empfohlen/offen, falls noch nicht gemeldet.
- Wichtige Region-Assignment-UI-Smoke-Faelle:
  - Region/Herrschaftsgebiet-Dialog oeffnen
  - Assignment-/Breadcrumb-Anzeige und Summary-Felder pruefen
  - Breadcrumb-Klick und Parent-/Assignment-Drop mit Testdaten pruefen
  - Geometrie freigeben/Speichern nur mit sicherer Testregion pruefen
  - Dialog schliessen und erneut oeffnen, Konsole pruefen
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

## 7. Next Recommended Step

- Kein sofortiger weiterer Code-Split.
- Zuerst Region-Assignment-UI-Smoke (und ggf. offenen Core-Smoke) abschliessen.
- Danach Restdatei (`js/dialogs-review.js`) neu analysieren.
- Naechster Analysebereich bevorzugt Region/Territory-Tabs/Submit.
- Explizit: nicht direkt Region/Init/Event-Binding ohne Boundary-Analyse verschieben.
