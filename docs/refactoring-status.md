# Refactoring Status

## 1. Current Stable Boundaries

- `js/route-graph-core.js` bleibt als stabilisierter Routing-/Graph-Kern mit `calculateRouteCore(...)` und den bereits extrahierten Graph-/Geometrie-Helfern.
- `createGraph(...)` bleibt stabil als Orchestrator im Inline-Script von `index.html`, mit lokalem Helper `addRegularPathToGraph(graph, pathFeature)`.
- `updateMapView(...)` bleibt stabil als Orchestrator in `js/routing.js`, entlastet durch:
  - `collectAndValidateSelectedLocations()`
  - `buildRouteResultFromSelectedLocations(useShortest)`
- `js/popups.js` bleibt stabil mit lokalem Helper `pathCreationActionButtonsMarkup(publicId)`.
- Dialog-Review-Split ist jetzt in acht stabile Schichten getrennt, mit klassischer Script-Reihenfolge in `index.html`:
  1. `js/dialogs-review-core.js`
  2. `js/dialogs-review-status.js`
  3. `js/dialogs-review-pending.js`
  4. `js/dialogs-review-paths.js`
  5. `js/dialogs-review-labels.js`
  6. `js/dialogs-review-locations.js`
  7. `js/dialogs-review-panels.js`
  8. `js/dialogs-review.js`
- `js/dialogs-review-core.js` ist stabiler Core-Cluster-Split (DOM-/Dialog-Getter, Form-/Status-Getter, `is...DialogOpen`, `isLocationReportServiceConfigured`, `syncModalDialogBodyState`).
- `js/dialogs-review-status.js` ist stabiler Status-Cluster-Split (`dataset.status` + `dataset.state` Wrapper/Helper).
- `js/dialogs-review-pending.js` ist stabiler Pending-Cluster-Split (`setFormFieldsDisabled(...)` + fuenf `set...SubmitPending`-Wrapper).
- `js/dialogs-review-paths.js` ist stabiler Path-/Powerline-Edit-Cluster-Split (Form-Population, Dialog-Open, Payload-Building, Transportoptionen, Autoname-Sync).
- `js/dialogs-review-labels.js` ist stabiler Label-Edit-Cluster-Split (Dialog-Open/Close, Form-Population, Zoom/Priority-Output-Sync, Payload-Building).
- `js/dialogs-review-locations.js` ist stabiler Location-Report-/Location-Edit-Cluster-Split (Report/Edit-Payloads, Reset/Populate/Open/Close, Service-Availability, Koordinatenformatierung).
- `js/dialogs-review-panels.js` ist stabiler Review/Change/Presence-Panel-Cluster-Split (Tab-State, Laden/Rendern, Fokus/Undo, Presence-Heartbeat).
- `js/dialogs-review.js` bleibt stabil als Rest-Orchestrator fuer Region-/Wiki-Sync-/Review-Detailfluesse, Submit-/API-/Init-Logik und noch nicht ausgelagerte Reset-/Hilfsfunktionen.
- `js/ui-controls.js` bleibt stabil mit lokalem Helper `bindPersistedTabClickHandler(selector, datasetKey, allowedValues, storageKey, urlParameterName)` fuer Review-/Wiki-Sync-Tab-Persistierung.

## 2. Recent Safe Extracts / Splits

- `addRegularPathToGraph(graph, pathFeature)`
- `collectAndValidateSelectedLocations()`
- `buildRouteResultFromSelectedLocations(useShortest)`
- `pathCreationActionButtonsMarkup(publicId)`
- `setDialogStatus(statusElement, message = "", type = "")`
- `setPanelStateStatus(statusElement, message = "", state = "")`
- `bindPersistedTabClickHandler(selector, datasetKey, allowedValues, storageKey, urlParameterName)`
- Erster kontrollierter Datei-Split: Status-Cluster aus `js/dialogs-review.js` nach `js/dialogs-review-status.js` ausgelagert.
- Zweiter kontrollierter Datei-Split: Pending-Cluster aus `js/dialogs-review.js` nach `js/dialogs-review-pending.js` ausgelagert.
- Dritter kontrollierter Datei-Split: Path-/Powerline-Edit-Cluster aus `js/dialogs-review.js` nach `js/dialogs-review-paths.js` ausgelagert.
- Vierter kontrollierter Datei-Split: Label-Edit-Cluster aus `js/dialogs-review.js` nach `js/dialogs-review-labels.js` ausgelagert.
- Fuenfter kontrollierter Datei-Split: Location-Report-/Location-Edit-Cluster aus `js/dialogs-review.js` nach `js/dialogs-review-locations.js` ausgelagert.
- Sechster kontrollierter Datei-Split: Core-/Getter-/Modal-State-Cluster aus `js/dialogs-review.js` nach `js/dialogs-review-core.js` ausgelagert.
- Siebter kontrollierter Datei-Split: Review/Change/Presence-Panel-Cluster aus `js/dialogs-review.js` nach `js/dialogs-review-panels.js` ausgelagert.
- Abhaengigkeitsrichtung ist jetzt sauberer: Core vor Status/Pending/Feature/Panel-Dateien, Rest-Orchestrator zuletzt.

## 3. Areas To Leave Stable For Now

- Routing/Graph:
  - `createGraph`
  - `updateMapView`
  - `js/route-graph-core.js`
- Popup-Bereich:
  - `js/popups.js` nach dem Path-Action-Extract vorerst stabil lassen.
- Dialog-Bereich:
  - `js/dialogs-review-core.js` stabil lassen.
  - `js/dialogs-review-status.js` stabil lassen.
  - `js/dialogs-review-pending.js` stabil lassen.
  - `js/dialogs-review-paths.js` stabil lassen.
  - `js/dialogs-review-labels.js` stabil lassen.
  - `js/dialogs-review-locations.js` stabil lassen.
  - `js/dialogs-review-panels.js` vorerst stabil lassen.
  - Core-/Path-/Label-/Location-/Panel-Cluster nicht direkt weiter veraendern.
  - Keine DOM-Getter/Core-Helper weiter aufteilen ohne neue Boundary-Analyse.
  - `js/dialogs-review.js` nicht weiter zerschneiden ohne neue, klare Split-Analyse mit engem Scope.
- UI-Controls:
  - `js/ui-controls.js` insgesamt vorerst stabil lassen, insbesondere den Transport-Menu-/Combobox-Bereich.

## 4. Planned But Not Yet Implemented

- `renderRouteResult(routeNodeNames, segments)` in `js/routing.js` (nur geplant).
- Popups: moeglicher Powerline-Action-Button-Helper (nur analysiert).
- UI-Controls Transport-Menue: moeglicher `bindTransportControlEvents(control, selectId)`-Extract (nur analysiert).
- Moegliche spaetere Parameterisierung von `createGraph`/Transportlogik.
- Moegliche spaetere Entkopplung von `getSyntheticRouteConfig`.
- Dialogs-Review (nur Analysebereiche, keine direkten Code-Schritte):
  - Wiki-Sync-Cluster
  - Region/Territory-Cluster
  - Verbleibende Reset-/Helper-Funktionen (nur mit separater Boundary-Analyse)

## 5. Smoke-Test Status

- Produktiv auf [avesmaps.de](https://avesmaps.de/) wurde Routing/Dragging/Rerouting als funktionsfaehig bestaetigt.
- Path-/Powerline-Smoke bestanden (Wege gehen, Kraftlinien gehen).
- Label-Smoke bestanden (Labels gehen).
- Location-Smoke nach Split bestanden (alles geht, keine Meldungen, Verhalten wie erwartet).
- Panel-Smoke nach Split empfohlen/offen, falls noch nicht gemeldet.
- Wichtige Panel-Smoke-Faelle:
  - Review-Panel oeffnen/schliessen, Refresh
  - Meldungen-Tab laden/fokussieren
  - Aenderungen-Tab laden/fokussieren, Undo nur mit sicherem Testeintrag
  - Ctrl+Z/Cmd+Z ausserhalb und innerhalb Eingabefeldern
  - Presence-Tab laden
  - WikiSync-Tab kurz oeffnen fuer Tabwechsel-Sicherheit
  - keine neuen Konsolenfehler/ReferenceErrors
- Core-Smoke empfohlen/offen, falls noch nicht gemeldet:
  - Dialoge oeffnen/schliessen
  - `body.modal-dialog-open` wird korrekt gesetzt/entfernt
- Fuer jeden spaeteren Split ist ein eigener, gezielter Smoke-Zyklus erforderlich.

## 6. Important Clarifications

- `highlightError($input)` markiert ungueltige bzw. nicht gefundene Eingaben (Input-Validierung), nicht Unerreichbarkeit.
- Echte fehlende Teilrouten laufen getrennt ueber `Keine Route zwischen ... gefunden.`
- Querfeldein-Verbindungen reduzieren viele fruehere Unerreichbarkeitsfaelle.
- `dataset.status`- und `dataset.state`-Statusfunktionen bleiben bewusst getrennte Cluster.
- Ziel des Gesamt-Refactorings ist kontrollierte Modularisierung in kleine, verstaendliche Dateien.
- Klassische globale Script-Reihenfolge bleibt zentral.
- Keine ES-Module, kein Build-System.
- Grosse Cluster wie Wiki-Sync, Region sowie Init/Event-Binding nicht ohne eigene Boundary-Analyse verschieben.
- Wiki-Sync und Region/Territory waren explizit nicht Teil des Panel-Splits.

## 7. Next Recommended Step

- Kein sofortiger weiterer Code-Split.
- Zuerst Panel-Smoke und Core-Smoke abschliessen bzw. bestaetigen.
- Danach Restdatei (`js/dialogs-review.js`) neu analysieren.
- Review/Change/Presence ist bereits ausgelagert; naechster Analysebereich bevorzugt Wiki-Sync oder Region/Territory.
- Explizit: nicht direkt Wiki-Sync, Region oder Init/Event-Binding ohne eigene Boundary-Analyse verschieben.