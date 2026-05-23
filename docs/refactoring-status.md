# Refactoring Status

## 1. Current Stable Boundaries

- `js/route-graph-core.js` bleibt als stabilisierter Routing-/Graph-Kern mit `calculateRouteCore(...)` und den bereits extrahierten Graph-/Geometrie-Helfern.
- `createGraph(...)` bleibt stabil als Orchestrator im Inline-Script von `index.html`, mit lokalem Helper `addRegularPathToGraph(graph, pathFeature)`.
- `updateMapView(...)` bleibt stabil als Orchestrator in `js/routing.js`, entlastet durch:
  - `collectAndValidateSelectedLocations()`
  - `buildRouteResultFromSelectedLocations(useShortest)`
- `js/popups.js` bleibt stabil mit lokalem Helper `pathCreationActionButtonsMarkup(publicId)`.
- `js/dialogs-review.js` bleibt stabil mit zwei getrennten Status-Clustern:
  - `setDialogStatus(statusElement, message = "", type = "")` fuer `dataset.status`
  - `setPanelStateStatus(statusElement, message = "", state = "")` fuer `dataset.state`
- `js/ui-controls.js` bleibt stabil mit lokalem Helper `bindPersistedTabClickHandler(selector, datasetKey, allowedValues, storageKey, urlParameterName)` fuer Review-/Wiki-Sync-Tab-Persistierung.

## 2. Recent Safe Extracts

- `addRegularPathToGraph(graph, pathFeature)`
- `collectAndValidateSelectedLocations()`
- `buildRouteResultFromSelectedLocations(useShortest)`
- `pathCreationActionButtonsMarkup(publicId)`
- `setDialogStatus(statusElement, message = "", type = "")`
- `setPanelStateStatus(statusElement, message = "", state = "")`
- `bindPersistedTabClickHandler(selector, datasetKey, allowedValues, storageKey, urlParameterName)`

## 3. Areas To Leave Stable For Now

- Routing/Graph:
  - `createGraph`
  - `updateMapView`
  - `js/route-graph-core.js`
- Popup-Bereich:
  - `js/popups.js` nach dem Path-Action-Extract vorerst stabil lassen.
- Dialog-Bereich:
  - `js/dialogs-review.js` nach der Status-Cluster-Aufteilung vorerst stabil lassen.
- UI-Controls:
  - `js/ui-controls.js` insgesamt vorerst stabil lassen, insbesondere den Transport-Menu-/Combobox-Bereich.

## 4. Planned But Not Yet Implemented

- `renderRouteResult(routeNodeNames, segments)` in `js/routing.js` (nur geplant).
- Popups: moeglicher Powerline-Action-Button-Helper (nur analysiert).
- Dialogs-Review: Submit-/Pending-Setter-Cluster als spaeterer **Analysebereich** (kein geplanter direkter Code-Schritt).
- UI-Controls Transport-Menue: moeglicher `bindTransportControlEvents(control, selectId)`-Extract (nur analysiert).
- Moegliche spaetere Parameterisierung von `createGraph`/Transportlogik.
- Moegliche spaetere Entkopplung von `getSyntheticRouteConfig`.

## 5. Smoke-Test Status

- Produktiv auf [avesmaps.de](https://avesmaps.de/) wurde Routing/Dragging/Rerouting als funktionsfaehig bestaetigt.
- Fuer den Popups-Extract waren Popup/Editmode-Smokes empfohlen (Path-Actions + Powerline-Aktionen).
- Fuer die Dialog-Status-Extracts waren Dialog/Edit/Review-Smokes der Statusausgaben empfohlen.
- Fuer den UI-Controls-Extract waren Review-Tab-/Wiki-Sync-Tab-Smokes empfohlen (URL + LocalStorage + Reload).
- Falls spaeter Transport-Menue-Code geaendert wird, ist ein eigener Transport-Combobox-Smoke-Zyklus erforderlich (Focus/Keyboard/ARIA/Outside-Click/Resize/Scroll).

## 6. Important Clarifications

- `highlightError($input)` markiert ungueltige bzw. nicht gefundene Eingaben (Input-Validierung), nicht Unerreichbarkeit.
- Echte fehlende Teilrouten laufen getrennt ueber `Keine Route zwischen ... gefunden.`
- Querfeldein-Verbindungen reduzieren viele fruehere Unerreichbarkeitsfaelle.
- `dataset.status`- und `dataset.state`-Statusfunktionen bleiben bewusst getrennte Cluster.
- Transport-Menue-Code ist fokus-/keyboard-/ARIA-sensibel und soll nicht ohne engen Scope plus gezielten Smoke-Zyklus geaendert werden.

## 7. Next Recommended Step

- Kein sofortiger Code-Schritt.
- Zuerst kurzes Smoke-/Stabilitaetsfenster.
- Danach entweder:
  - A. einen bereits geplanten Mini-Extract gezielt und isoliert umsetzen
  - B. einen neuen Subbereich nur analysieren (ohne Codeaenderung)
- Explizit: Transport-Menue nicht direkt coden, solange kein gezielter Transport-Combobox-Smoke-Zyklus geplant ist.
