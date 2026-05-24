# Refactoring Status

## 1. Current Stable Boundaries

- `js/route-graph-core.js` bleibt als stabilisierter Routing-/Graph-Kern mit `calculateRouteCore(...)` und den bereits extrahierten Graph-/Geometrie-Helfern.
- `createGraph(...)` bleibt stabil als Orchestrator im Inline-Script von `index.html`, mit lokalem Helper `addRegularPathToGraph(graph, pathFeature)`.
- `updateMapView(...)` bleibt stabil als Orchestrator in `js/routing.js`, entlastet durch:
  - `collectAndValidateSelectedLocations()`
  - `buildRouteResultFromSelectedLocations(useShortest)`
- `js/popups.js` bleibt stabil mit lokalem Helper `pathCreationActionButtonsMarkup(publicId)`.
- Dialog-Review-Split ist jetzt in neun stabile Schichten getrennt, mit klassischer Script-Reihenfolge in `index.html`:
  1. `js/dialogs-review-core.js`
  2. `js/dialogs-review-status.js`
  3. `js/dialogs-review-pending.js`
  4. `js/dialogs-review-paths.js`
  5. `js/dialogs-review-labels.js`
  6. `js/dialogs-review-locations.js`
  7. `js/dialogs-review-panels.js`
  8. `js/dialogs-review-wiki-sync.js`
  9. `js/dialogs-review.js`
- `js/dialogs-review-core.js` ist stabiler Core-Cluster-Split (DOM-/Dialog-Getter, Form-/Status-Getter, `is...DialogOpen`, `isLocationReportServiceConfigured`, `syncModalDialogBodyState`).
- `js/dialogs-review-status.js` ist stabiler Status-Cluster-Split (`dataset.status` + `dataset.state` Wrapper/Helper).
- `js/dialogs-review-pending.js` ist stabiler Pending-Cluster-Split (`setFormFieldsDisabled(...)` + fuenf `set...SubmitPending`-Wrapper).
- `js/dialogs-review-paths.js` ist stabiler Path-/Powerline-Edit-Cluster-Split.
- `js/dialogs-review-labels.js` ist stabiler Label-Edit-Cluster-Split.
- `js/dialogs-review-locations.js` ist stabiler Location-Report-/Location-Edit-Cluster-Split.
- `js/dialogs-review-panels.js` ist stabiler Review/Change/Presence-Panel-Cluster-Split.
- `js/dialogs-review-wiki-sync.js` ist stabiler WikiSync-Cluster-Split (Locations-/Territories-Panel, Filter/Accordion, Resolve-Dialog-Helfer, Fokus/Preview, WikiSync-Flow-Helfer).
- `js/dialogs-review.js` bleibt stabil als Rest-Orchestrator fuer Region-/Territory- und Region-Wiki-Picker-Flows, Submit-/API-/Init-Logik und verbleibende Hilfsfunktionen.
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
  - Region-Wiki-Picker-Cluster
  - Verbleibende Reset-/Helper-Funktionen (nur mit separater Boundary-Analyse)

## 5. Smoke-Test Status

- Produktiv auf [avesmaps.de](https://avesmaps.de/) wurde Routing/Dragging/Rerouting als funktionsfaehig bestaetigt.
- Path-/Powerline-Smoke bestanden (Wege gehen, Kraftlinien gehen).
- Label-Smoke bestanden (Labels gehen).
- Location-Smoke nach Split bestanden (alles geht, keine Meldungen, Verhalten wie erwartet).
- WikiSync-Smoke nach Split empfohlen/offen, falls noch nicht gemeldet.
- Wichtige WikiSync-Smoke-Faelle:
  - WikiSync-Tab oeffnen, Locations-Liste laden
  - Filter und Accordion testen
  - Resolve-Dialog mit sicheren Testdaten oeffnen/schliessen, Presets pruefen
  - Herrschaftsgebiete-Tab oeffnen, Baum/Filter testen
  - zu Meldungen/Aenderungen/Status zurueckwechseln
  - keine neuen Konsolenfehler/ReferenceErrors
- Core-Smoke empfohlen/offen, falls noch nicht gemeldet (`modal-dialog-open`, Dialoge oeffnen/schliessen).
- Fuer jeden spaeteren Split ist ein eigener, gezielter Smoke-Zyklus erforderlich.

## 6. Important Clarifications

- Ziel des Gesamt-Refactorings ist kontrollierte Modularisierung in kleine, verstaendliche Dateien.
- Klassische globale Script-Reihenfolge bleibt zentral.
- Keine ES-Module, kein Build-System.
- Grosse Cluster wie Region/Territory und Init/Event-Binding nicht ohne eigene Boundary-Analyse verschieben.
- Region/Territory und Region-Wiki-Picker waren explizit nicht Teil des WikiSync-Splits.

## 7. Next Recommended Step

- Kein sofortiger weiterer Code-Split.
- Zuerst WikiSync-Smoke (und ggf. offenen Core-Smoke) abschliessen.
- Danach Restdatei (`js/dialogs-review.js`) neu analysieren.
- Naechster Analysebereich bevorzugt Region/Territory bzw. Region-Wiki-Picker.
- Explizit: nicht direkt Region/Init/Event-Binding ohne Boundary-Analyse verschieben.