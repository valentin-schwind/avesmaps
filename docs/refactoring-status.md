# Refactoring Status

## 1. Current Stable Boundaries

- `js/route-graph-core.js` bleibt als stabilisierter Routing-/Graph-Kern mit `calculateRouteCore(...)` und den bereits extrahierten Graph-/Geometrie-Helfern.
- `createGraph(...)` bleibt stabil als Orchestrator im Inline-Script von `index.html`, mit lokalem Helper `addRegularPathToGraph(graph, pathFeature)`.
- `updateMapView(...)` bleibt stabil als Orchestrator in `js/routing.js`, entlastet durch:
  - `collectAndValidateSelectedLocations()`
  - `buildRouteResultFromSelectedLocations(useShortest)`
- `js/popups.js` bleibt stabil mit lokalem Helper `pathCreationActionButtonsMarkup(publicId)`.
- `js/dialogs-review-status.js` ist als erster kontrollierter Datei-Split stabil und enthaelt den Status-Cluster:
  - `setDialogStatus(statusElement, message = "", type = "")` fuer `dataset.status`
  - `setPanelStateStatus(statusElement, message = "", state = "")` fuer `dataset.state`
  - die zugehoerigen `set*Status`-Wrapper fuer Dialog- und Panel-Status
- `js/dialogs-review.js` bleibt als Rest-Orchestrator fuer Dialog-/Review-/Wiki-Sync-Flows stabil:
  - DOM-Getter
  - Submit-/Pending-Setter
  - Dialogflows, Panels, API-/Submit-/Init-Logik
  - `setFormFieldsDisabled(formElement, isPending)` bleibt hier bewusst verankert
- `js/ui-controls.js` bleibt stabil mit lokalem Helper `bindPersistedTabClickHandler(selector, datasetKey, allowedValues, storageKey, urlParameterName)` fuer Review-/Wiki-Sync-Tab-Persistierung.

## 2. Recent Safe Extracts

- `addRegularPathToGraph(graph, pathFeature)`
- `collectAndValidateSelectedLocations()`
- `buildRouteResultFromSelectedLocations(useShortest)`
- `pathCreationActionButtonsMarkup(publicId)`
- `setDialogStatus(statusElement, message = "", type = "")`
- `setPanelStateStatus(statusElement, message = "", state = "")`
- `setFormFieldsDisabled(formElement, isPending)`
- `bindPersistedTabClickHandler(selector, datasetKey, allowedValues, storageKey, urlParameterName)`
- Erster kontrollierter Datei-Split: Status-Cluster aus `js/dialogs-review.js` nach `js/dialogs-review-status.js` ausgelagert (inklusive Script-Reihenfolge in `index.html`).

## 3. Areas To Leave Stable For Now

- Routing/Graph:
  - `createGraph`
  - `updateMapView`
  - `js/route-graph-core.js`
- Popup-Bereich:
  - `js/popups.js` nach dem Path-Action-Extract vorerst stabil lassen.
- Dialog-Bereich:
  - `js/dialogs-review-status.js` vorerst stabil lassen.
  - `js/dialogs-review.js` nicht direkt weiter zerschneiden, solange kein naechster Split-Scope klar und isoliert definiert ist.
- UI-Controls:
  - `js/ui-controls.js` insgesamt vorerst stabil lassen, insbesondere den Transport-Menu-/Combobox-Bereich.

## 4. Planned But Not Yet Implemented

- `renderRouteResult(routeNodeNames, segments)` in `js/routing.js` (nur geplant).
- Popups: moeglicher Powerline-Action-Button-Helper (nur analysiert).
- Dialogs-Review: moeglicher Pending-Cluster-Split nach `js/dialogs-review-pending.js`:
  - `setFormFieldsDisabled(formElement, isPending)`
  - fuenf `set...SubmitPending`-Wrapper
  - nur nach gezieltem Smoke-/Stabilitaetsfenster
- Dialogs-Review: Submit-/Pending-Setter-Cluster bleibt bis dahin ein spaeterer Analysebereich, kein unmittelbarer grosser Code-Schritt.
- UI-Controls Transport-Menue: moeglicher `bindTransportControlEvents(control, selectId)`-Extract (nur analysiert).
- Moegliche spaetere Parameterisierung von `createGraph`/Transportlogik.
- Moegliche spaetere Entkopplung von `getSyntheticRouteConfig`.

## 5. Smoke-Test Status

- Produktiv auf [avesmaps.de](https://avesmaps.de/) wurde Routing/Dragging/Rerouting als funktionsfaehig bestaetigt.
- Nach dem Status-Cluster-Split (`js/dialogs-review-status.js`) wurde keine sichtbare Verhaltensaenderung gemeldet.
- Fuer den Popups-Extract waren Popup/Editmode-Smokes empfohlen (Path-Actions + Powerline-Aktionen).
- Fuer den Dialog-Status-Split sind manuelle Status-Smokes im Edit-/Review-Kontext weiterhin empfohlen/offen, falls noch nicht vollstaendig gelaufen.
- Pending-Smoke fuer `setFormFieldsDisabled(...)` wurde grob als unauffaellig gemeldet.
- Fuer den UI-Controls-Extract waren Review-Tab-/Wiki-Sync-Tab-Smokes empfohlen (URL + LocalStorage + Reload).
- Falls spaeter Transport-Menue-Code geaendert wird, ist ein eigener Transport-Combobox-Smoke-Zyklus erforderlich (Focus/Keyboard/ARIA/Outside-Click/Resize/Scroll).

## 6. Important Clarifications

- `highlightError($input)` markiert ungueltige bzw. nicht gefundene Eingaben (Input-Validierung), nicht Unerreichbarkeit.
- Echte fehlende Teilrouten laufen getrennt ueber `Keine Route zwischen ... gefunden.`
- Querfeldein-Verbindungen reduzieren viele fruehere Unerreichbarkeitsfaelle.
- `dataset.status`- und `dataset.state`-Statusfunktionen bleiben bewusst getrennte Cluster.
- Transport-Menue-Code ist fokus-/keyboard-/ARIA-sensibel und soll nicht ohne engen Scope plus gezielten Smoke-Zyklus geaendert werden.
- Ziel des Gesamt-Refactorings ist kontrollierte Modularisierung in kleine, verstaendliche Dateien statt nur lokaler Helper-Entduplizierung.
- Klassische globale Script-Reihenfolge bleibt dabei zentral; es werden weiterhin keine ES-Module eingefuehrt.

## 7. Next Recommended Step

- Kein grosser sofortiger Code-Schritt.
- Zuerst kurzes Smoke-/Stabilitaetsfenster.
- Danach entweder:
  - A. Pending-Cluster-Split eng und isoliert vorbereiten/umsetzen (`js/dialogs-review-pending.js` vor `js/dialogs-review.js` laden; keine Submit-Handler/API/Dialog-Open-Close-Logik verschieben)
  - B. einen neuen Subbereich nur analysieren (ohne Codeaenderung)
- Explizit: Transport-Menue nicht direkt coden, solange kein gezielter Transport-Combobox-Smoke-Zyklus geplant ist.