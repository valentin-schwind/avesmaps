# Dialogs Review Panels Split Boundary Check

## Ausgangspunkt

Aktueller Stand: `js/review/review-region-util.js` ist nach Core-/Status-/Pending-/Path-/Label-/Location-Splits weiterhin der Rest-Orchestrator. Die Datei enthält noch Region/Territory, Wiki-Sync, Review-/Change-/Presence-Flows, Submit-/API-/Init-Logik sowie einzelne Reset-/Helper-Funktionen.

Der aktuelle Status in `docs/refactoring-status.md` hält fest, dass `js/review/review-region-util.js` vorerst nur mit neuer Boundary-Analyse weiter zerschnitten werden soll. Als nächster Analysebereich ist Review/Change/Presence genannt. Wiki-Sync, Region/Territory sowie Init/Event-Binding sollen nicht ohne eigene Analyse verschoben werden.

## Gelesene Bereiche

Relevant für Review/Change/Presence sind in `js/review/review-region-util.js` insbesondere diese Funktionsgruppen:

- Panel-Orchestrierung:
  - `setEditorPanelTab(tabName)`
  - `refreshActiveEditorPanel()`
  - `restoreReviewPanelState()`
  - `syncReviewPanelVisibility()`
  - `toggleReviewPanel()`
- Review-Meldungen:
  - `loadReviewReports()`
  - `renderReviewReports()`
  - `getReportTypeLabel(report)`
  - `isLocationReport(report)`
  - `isCommentReport(report)`
  - `findReviewReportFromElement(element)`
  - `clearReviewReportMarker()`
  - `focusReviewReport(report)`
  - weitere reportbezogene Übergänge zu Location-/Label-Dialogen und Review-Status-Updates
- Change-Panel:
  - `loadChangeLog()`
  - `formatChangeAction(action)`
  - `renderChangeLog()`
  - `findLabelMarkerByPublicId(publicId)`
  - `focusPathFeature(path)`
  - `focusLabelFeature(labelEntry)`
  - `clearChangeLogFocusMarker()`
  - `scheduleChangeLogFocusMarkerRemoval()`
  - `getChangeLogFocusTooltip(entry)`
  - `focusAuditChangeTarget(entry)`
  - `focusChangeLogEntry(entry)`
  - `getLatestUndoableChangeLogEntry()`
  - `undoLastChangeLogEntry()`
  - `undoChangeLogEntry(entry)`
  - `isTextEditingShortcutTarget(target)`
  - `handleChangeLogUndoShortcut(event)`
- Presence-Panel:
  - `formatPresenceAge(secondsSinceSeen)`
  - `formatPresenceRole(role)`
  - `sendEditorPresenceHeartbeat()`
  - `startEditorPresenceHeartbeat()`
  - `renderEditorPresenceUsers()`
  - `renderPresenceUserGroup(listElement, title, users, state)`

Angrenzend, aber nicht Teil dieses Splits:

- Wiki-Sync:
  - `loadWikiSyncCases()`
  - `refreshActiveWikiSyncPanel()`
  - `setWikiSyncPanelTab(tabName)`
  - `renderWikiSyncCases(...)`
  - `renderWikiSyncTerritoryTree(...)`
  - alle WikiSync-Case-/Resolve-/Territory-Funktionen
- Region/Territory:
  - Region-Edit-Dialog, Political-Territory-Assignment, Wiki-Picker, Tree-Helfer
- Submit-/API-Orchestrierung:
  - `handleLocationEditFormSubmit(...)`
  - `handleLabelEditFormSubmit(...)`
  - `handleRegionEditFormSubmit(...)`
  - direkte API-Submit-/Undo-Funktionen, sofern nicht bereits reine Panel-Helfer
- Event-Bindings:
  - alle `$(document).on(...)`-Bindings
  - globale Shortcut-/Init-Bindings

## Abhängigkeiten

Die Panel-Funktionen hängen weiter an globalem State und globalen Funktionen. Das ist im aktuellen Nicht-Module-Setup erwartbar und für einen reinen Funktionssplit tolerierbar.

Wichtige gelesene oder geschriebene States:

- `activeEditorPanelTab`
- `isReviewPanelHidden`
- `reviewReports`
- `changeLogEntries`
- `editorPresenceUsers`
- `editorPresenceTimerId`
- `reviewReportMarker`
- `changeLogFocusMarker`
- `changeLogFocusMarkerTimeout`
- `isChangeUndoPending`
- `activeReviewReportId`
- `activeReviewReportSource`

Wichtige externe Funktionen/Konstanten:

- Status: `setReviewPanelStatus`, `setChangePanelStatus`, `setPresencePanelStatus`
- Wiki-Sync-Anbindung: `refreshActiveWikiSyncPanel`, `loadWikiSyncCases`
- APIs: `LOCATION_REPORT_REVIEW_API_URL`, `MAP_AUDIT_LOG_API_URL`, `EDITOR_PRESENCE_API_URL`, `fetchPoliticalChangeLog`, `undoPoliticalAuditChange`, `undoMapAuditChange`
- Map/Feature: `map`, `L`, `isWithinMapBounds`, `findLocationMarkerByPublicId`, `findPathByPublicId`, `pathCoordinatesToLatLngs`, `syncLabelVisibility`, `applyMapFeatureEditResult`, `schedulePoliticalTerritoryLayerReload`, `updateRevisionFromEditResponse`
- UI: `showFeedbackToast`, `openLabelEditDialog`, `formatLocationReportCoordinates`, `normalizeLocationType`, `LOCATION_TYPE_CONFIG`

## Bewertung des Split-Risikos

### Sicher verschiebbar

Ein kleiner Datei-Split nach `js/dialogs-review-panels.js` ist sinnvoll, wenn er ausschließlich reine Funktionsdefinitionen verschiebt und keine Top-Level-Ausführung enthält.

Geeignet sind:

- Panel-Tab-/Panel-Visibility-Helfer
- Review-Report-Render-/Focus-Helfer
- Change-Log-Render-/Focus-/Undo-Helfer
- Presence-Render-/Heartbeat-Helfer
- kleine Format-/Lookup-Helfer, die nur von diesen Panel-Funktionen genutzt werden

Der Split ist verhaltensneutral möglich, weil die Funktionen bereits global definiert sind und im klassischen Script-Setup nach dem Laden der Datei verfügbar bleiben.

### Nicht im selben Schritt verschieben

Nicht in diesen Split gehören:

- Wiki-Sync-Cluster. `setEditorPanelTab` und `refreshActiveEditorPanel` dürfen `refreshActiveWikiSyncPanel()` nur weiter aufrufen; die Wiki-Sync-Funktion selbst bleibt in `js/review/review-region-util.js`.
- Region/Territory-Cluster.
- Init-/Event-Binding-Code. Die Event-Bindings können weiterhin Funktionen aus der neuen Datei aufrufen, aber selbst im Orchestrator bleiben.
- Submit-Handler für Location/Label/Region/Path/Powerline.
- API-Wrapper oder allgemeine Map-Edit-Anwendungslogik, sofern sie nicht eindeutig Change-Panel-only ist.

## Empfohlener Split

Dateiname:

- `js/dialogs-review-panels.js`

Script-Reihenfolge in `index.html`:

1. `js/dialogs-review-core.js`
2. `js/dialogs-review-status.js`
3. `js/dialogs-review-pending.js`
4. `js/dialogs-review-paths.js`
5. `js/dialogs-review-labels.js`
6. `js/dialogs-review-locations.js`
7. `js/dialogs-review-panels.js`
8. `js/review/review-region-util.js`

Begründung: Die Panel-Datei verwendet Status-Helfer und bereits ausgelagerte Location-/Label-Helfer, muss aber vor dem Rest-Orchestrator geladen werden, damit spätere Event-Bindings und Init-Code weiter auf globale Funktionsnamen zugreifen können.

## Exakter zulässiger Funktionsumfang für den ersten Panels-Split

In den ersten Split dürfen maximal diese Funktionen verschoben werden:

- `formatPresenceAge`
- `formatPresenceRole`
- `setEditorPanelTab`
- `refreshActiveEditorPanel`
- `restoreReviewPanelState`
- `syncReviewPanelVisibility`
- `toggleReviewPanel`
- `loadReviewReports`
- `loadChangeLog`
- `formatChangeAction`
- `renderChangeLog`
- `findLabelMarkerByPublicId`
- `focusPathFeature`
- `focusLabelFeature`
- `clearChangeLogFocusMarker`
- `scheduleChangeLogFocusMarkerRemoval`
- `getChangeLogFocusTooltip`
- `focusAuditChangeTarget`
- `focusChangeLogEntry`
- `getLatestUndoableChangeLogEntry`
- `undoLastChangeLogEntry`
- `undoChangeLogEntry`
- `isTextEditingShortcutTarget`
- `handleChangeLogUndoShortcut`
- `attachActiveReviewReportContext`
- `renderReviewReports`
- `sendEditorPresenceHeartbeat`
- `startEditorPresenceHeartbeat`
- `renderEditorPresenceUsers`
- `renderPresenceUserGroup`
- `getReportTypeLabel`
- `isLocationReport`
- `isCommentReport`
- `findReviewReportFromElement`
- `clearReviewReportMarker`
- `focusReviewReport`

Diese Liste ist bewusst eng. Sollte sich beim tatsächlichen Verschieben zeigen, dass weitere direkt angrenzende Review-Report-Funktionen zwischen `focusReviewReport(...)` und den Submit-Handlern stehen, dürfen sie nur dann mitverschoben werden, wenn sie ausschließlich Review-Panel-Verhalten kapseln und keine Submit-/API-Orchestrierung enthalten. Andernfalls bleiben sie im Orchestrator.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode öffnen.
2. Konsole prüfen: keine `ReferenceError`, keine neuen Syntaxfehler.
3. Review-Panel öffnen/schließen; Reload testen.
4. Tab `Meldungen`: Meldungen laden, Meldung fokussieren, falls vorhanden `Anlegen`/`Verwerfen` nur dann testen, wenn ungefährlich bzw. Testdaten vorhanden sind.
5. Tab `Änderungen`: Änderungsverlauf laden, Eintrag fokussieren; bei verfügbarem sicheren Testeintrag Undo testen, sonst nur UI prüfen.
6. `Ctrl+Z`/`Cmd+Z` außerhalb von Eingabefeldern prüfen; in Eingabefeldern darf der Shortcut nicht abgefangen werden.
7. Tab `Status`: Presence-Heartbeat auslösen, Online-/Offline-Liste rendern.
8. Tab `WikiSync`: nur prüfen, dass der Wechsel weiterhin funktioniert; WikiSync selbst nicht im Rahmen dieses Splits testen oder umbauen.
9. Karte nach Panel-Fokusaktionen prüfen: Marker/Tooltip für Review- und Change-Fokus wird gesetzt und wieder entfernt.

## Codex-Prompt für den nächsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches. Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split des Review/Change/Presence-Panel-Clusters aus js/review/review-region-util.js in eine neue Datei js/dialogs-review-panels.js.

Erlaubte Änderungen:
- js/review/review-region-util.js
- neue Datei js/dialogs-review-panels.js
- index.html
- docs/refactoring-status.md

Nicht ändern:
- js/dialogs-review-core.js
- js/dialogs-review-status.js
- js/dialogs-review-pending.js
- js/dialogs-review-paths.js
- js/dialogs-review-labels.js
- js/dialogs-review-locations.js
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich diese Funktionen aus js/review/review-region-util.js nach js/dialogs-review-panels.js, unverändert und in sinnvoller Reihenfolge:
- formatPresenceAge
- formatPresenceRole
- setEditorPanelTab
- refreshActiveEditorPanel
- restoreReviewPanelState
- syncReviewPanelVisibility
- toggleReviewPanel
- loadReviewReports
- loadChangeLog
- formatChangeAction
- renderChangeLog
- findLabelMarkerByPublicId
- focusPathFeature
- focusLabelFeature
- clearChangeLogFocusMarker
- scheduleChangeLogFocusMarkerRemoval
- getChangeLogFocusTooltip
- focusAuditChangeTarget
- focusChangeLogEntry
- getLatestUndoableChangeLogEntry
- undoLastChangeLogEntry
- undoChangeLogEntry
- isTextEditingShortcutTarget
- handleChangeLogUndoShortcut
- attachActiveReviewReportContext
- renderReviewReports
- sendEditorPresenceHeartbeat
- startEditorPresenceHeartbeat
- renderEditorPresenceUsers
- renderPresenceUserGroup
- getReportTypeLabel
- isLocationReport
- isCommentReport
- findReviewReportFromElement
- clearReviewReportMarker
- focusReviewReport

Falls beim Verschieben direkt angrenzende Review-Report-Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/dialogs-review-panels.js:
- enthält nur Funktionsdefinitionen
- keine Top-Level-Ausführung
- keine DOM-Reads/Writes außerhalb von Funktionen
- keine Event-Bindings
- keine neuen globalen Namen außer den verschobenen bestehenden Funktionsnamen
- keine Logikänderungen

index.html:
- Script-Reihenfolge erweitern:
  1. js/dialogs-review-core.js
  2. js/dialogs-review-status.js
  3. js/dialogs-review-pending.js
  4. js/dialogs-review-paths.js
  5. js/dialogs-review-labels.js
  6. js/dialogs-review-locations.js
  7. js/dialogs-review-panels.js
  8. js/review/review-region-util.js

docs/refactoring-status.md:
- neuen stabilen Split js/dialogs-review-panels.js dokumentieren
- Smoke-Test-Empfehlung Review/Change/Presence ergänzen
- klar festhalten, dass Wiki-Sync und Region/Territory nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach fehlenden Referenzen/Typo bei js/dialogs-review-panels.js in index.html.
- Falls möglich: einfache Syntaxprüfung der betroffenen JS-Dateien mit node --check oder einem gleichwertigen lokalen Check ohne Build-System.

Danach:
- git status zeigen
- git add index.html js/review/review-region-util.js js/dialogs-review-panels.js docs/refactoring-status.md
- git commit -m "Split dialog review panel helpers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen: keine ReferenceErrors/Syntaxfehler.
2. Review-Panel öffnen/schließen, Refresh klicken.
3. Meldungen-Tab: Liste lädt, Meldung fokussieren.
4. Änderungen-Tab: Liste lädt, Eintrag fokussieren; Undo nur mit sicherem Testeintrag.
5. Ctrl+Z/Cmd+Z außerhalb und innerhalb von Eingabefeldern prüfen.
6. Status-Tab: Presence-Liste lädt.
7. WikiSync-Tab nur kurz öffnen, damit der Panelwechsel weiter funktioniert.
```

## Ergebnis

Review/Change/Presence ist als nächster kleiner Split geeignet, aber nur als enger Helper-/Panel-Split. Wiki-Sync, Region/Territory und Event-Bindings bleiben im Rest-Orchestrator. Der konkrete Code-Split sollte erst im nächsten Schritt erfolgen.