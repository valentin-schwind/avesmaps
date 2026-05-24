# Dialogs Review WikiSync Split Boundary Check

## Ausgangspunkt

Nach dem bestätigten Review/Change/Presence-Panel-Split ist `js/dialogs-review.js` weiterhin der Rest-Orchestrator. Der aktuelle `docs/refactoring-status.md` nennt als naechste Analysebereiche Wiki-Sync, Region/Territory und verbleibende Reset-/Helper-Funktionen. Direkte Code-Splits ohne neue Boundary-Analyse sind dort ausdruecklich ausgeschlossen.

Die aktuelle Script-Reihenfolge in `index.html` ist weiterhin klassisch/global und endet im Dialog-Bereich mit:

1. `js/review/review-core.js`
2. `js/review/review-status.js`
3. `js/review/review-pending.js`
4. `js/review/review-paths.js`
5. `js/review/review-labels.js`
6. `js/review/review-locations.js`
7. `js/review/review-panels.js`
8. `js/dialogs-review.js`

## Gelesene Bereiche

### Rest-Orchestrator-Anfang

Am Anfang von `js/dialogs-review.js` liegen noch gemischte Reset-/Dialog-Helfer:

- `resetWikiSyncResolveForm()`
- `resetPathEditForm()`
- `resetPowerlineEditForm()`
- `resetLabelEditForm()`
- `resetRegionEditForm()`
- `setWikiSyncResolveDialogOpen(...)`
- `setPathEditDialogOpen(...)`
- `setPowerlineEditDialogOpen(...)`
- `setRegionEditDialogOpen(...)`
- `setRegionWikiPickerDialogOpen(...)`

Davon sind nur `resetWikiSyncResolveForm()` und `setWikiSyncResolveDialogOpen(...)` eindeutig WikiSync-Resolve-bezogen. Die Path-/Powerline-/Label-/Region-Funktionen bleiben ausserhalb dieses Splits.

### Region/Territory-Cluster

Der Region/Territory-Bereich ist gross und stark zusammenhaengend. Er umfasst unter anderem:

- Region-Edit-Formular
- Political-Territory-Tree/Parent-Auswahl
- Assignment-Breadcrumbs
- Territory-Zoom/Farbe/Opacity/Validity
- Region-Wiki-Picker
- Region-Tab-Handling
- Region-Submit

Dieser Cluster enthaelt viele Event-Bindings direkt im Rest-Orchestrator und soll nicht mit WikiSync gemischt werden.

### WikiSync-Cluster

Der WikiSync-Bereich beginnt nach `buildRegionEditPayload(...)` mit Lauf-/Panel-/Filter- und Renderfunktionen:

- `setWikiSyncLocationsRunning(...)`
- `setWikiSyncTerritoriesRunning(...)`
- `loadWikiSyncCases()`
- `refreshActiveWikiSyncPanel()`
- `setWikiSyncPanelTab(...)`
- `syncWikiSyncTerritoryFilterControls()`
- `setWikiSyncTerritoryFilterQuery(...)`
- `getWikiSyncTerritoryFilterQuery()`
- `loadWikiSyncTerritoryTreeRows(...)`
- `renderWikiSyncTerritoryTree(...)`
- `startWikiSyncRun()`
- `startWikiSyncTerritoryRun()`
- `buildWikiSyncStatusMessage(...)`
- `syncWikiSyncPanelHeaderState()`
- `syncWikiSyncPanelSummaries()`
- `syncWikiSyncActionButtonLabels()`
- `formatWikiSyncSettlementSummaryText()`
- `formatWikiSyncTerritorySummaryText()`
- `getWikiSyncTerritoryLoadedDataSummary()`
- `renderWikiSyncCases(...)`
- Accordion-/Filter-/Case-Render-Helfer
- WikiSync-Case-Actions
- WikiSync-Focus-/Preview-Marker
- WikiSync-Resolve-Dialog-Helfer
- `handleWikiSyncResolveFormSubmit(...)`

Der Cluster endet vor den Review-Detailfunktionen:

- `openLocationEditDialogFromReport(...)`
- `openLabelEditDialogFromReport(...)`
- `rejectReviewReport(...)`

Diese drei Funktionen bleiben im Rest-Orchestrator, weil sie Review-Report-Detailfluss und ausgelagerte Location-/Label-Dialoge verbinden.

## Bewertung des Split-Risikos

### Sicher verschiebbar

Ein WikiSync-Split ist sinnvoll, aber nur als enger Datei-Split nach `js/review/review-wiki-sync.js`.

Sicher verschiebbar sind reine Funktionsdefinitionen fuer:

- WikiSync-Locations-Laufsteuerung
- WikiSync-Territories-Laufsteuerung
- WikiSync-Panel-Tab/Filter/Summary
- WikiSync-Case-Rendering und Case-Actions
- WikiSync-Focus und Preview-Marker
- WikiSync-Resolve-Dialog-Population und Submit
- WikiSync-Create-Location-Flow-State

Die neue Datei darf weiterhin globale Variablen und globale Hilfsfunktionen verwenden. Das entspricht dem bestehenden klassischen Script-Modell.

### Nicht im selben Schritt verschieben

Nicht in diesen Split gehoeren:

- Region/Territory-Edit-Cluster
- Region-Wiki-Picker (`loadPoliticalTerritoryWikiReferences`, `openRegionWikiPickerDialog`, `renderRegionWikiPickerList`, `applyRegionWikiReferenceSelection`, etc.)
- Region-Assignment-Funktionen
- Path-/Powerline-/Label-/Location-Reset-Funktionen
- Review-Report-Detailfunktionen (`openLocationEditDialogFromReport`, `openLabelEditDialogFromReport`, `rejectReviewReport`)
- Submit-Handler fuer Location/Path/Powerline/Label/Region/LocationReport
- allgemeine API-Wrapper, falls sie ausserhalb des WikiSync-Flows verwendet werden
- Event-Bindings, falls sie nicht eindeutig WikiSync-only sind oder falls dadurch Scope/Load-Reihenfolge unklar wird

## Empfohlener Split

Dateiname:

- `js/review/review-wiki-sync.js`

Script-Reihenfolge in `index.html`:

1. `js/review/review-core.js`
2. `js/review/review-status.js`
3. `js/review/review-pending.js`
4. `js/review/review-paths.js`
5. `js/review/review-labels.js`
6. `js/review/review-locations.js`
7. `js/review/review-panels.js`
8. `js/review/review-wiki-sync.js`
9. `js/dialogs-review.js`

Begruendung: WikiSync verwendet Core-/Status-/Pending-/Location-/Panel-Helfer und muss vor dem Rest-Orchestrator geladen werden, damit Event-Bindings und Submit-Flows im Rest-Orchestrator weiterhin auf globale Funktionsnamen zugreifen koennen.

## Exakter zulaessiger Funktionsumfang fuer den ersten WikiSync-Split

In den ersten Split duerfen maximal diese Funktionen verschoben werden:

- `resetWikiSyncResolveForm`
- `setWikiSyncResolveDialogOpen`
- `setWikiSyncLocationsRunning`
- `setWikiSyncTerritoriesRunning`
- `loadWikiSyncCases`
- `refreshActiveWikiSyncPanel`
- `setWikiSyncPanelTab`
- `syncWikiSyncTerritoryFilterControls`
- `setWikiSyncTerritoryFilterQuery`
- `getWikiSyncTerritoryFilterQuery`
- `loadWikiSyncTerritoryTreeRows`
- `renderWikiSyncTerritoryTree`
- `startWikiSyncRun`
- `startWikiSyncTerritoryRun`
- `buildWikiSyncStatusMessage`
- `syncWikiSyncPanelHeaderState`
- `syncWikiSyncPanelSummaries`
- `syncWikiSyncActionButtonLabels`
- `formatWikiSyncSettlementSummaryText`
- `formatWikiSyncTerritorySummaryText`
- `getWikiSyncTerritoryLoadedDataSummary`
- `renderWikiSyncCases`
- `getWikiSyncOpenGroupKeys`
- `restoreWikiSyncAccordionState`
- `syncWikiSyncFilterControls`
- `setWikiSyncFilterQuery`
- `getWikiSyncFilterQuery`
- `normalizeWikiSyncFilterQuery`
- `normalizeWikiSyncSearchText`
- `getWikiSyncCaseSearchText`
- `getWikiSyncFilteredCases`
- `hasWikiSyncMissingWikiWithoutCoordinatesCases`
- `syncWikiSyncCreateLocationContextMenuAction`
- `startWikiSyncCreateLocationSelection`
- `clearWikiSyncCreateLocationSelection`
- `resetWikiSyncCreateLocationFlowState`
- `openWikiSyncCreateLocationDialogFromCase`
- `getWikiSyncFallbackGroupElement`
- `renderWikiSyncCaseSection`
- `handleWikiSyncCaseGroupToggle`
- `getWikiSyncGroupedCases`
- `getWikiSyncCaseTypeOrder`
- `getWikiSyncCaseTypeLabel`
- `getWikiSyncResolvedFeature`
- `createWikiSyncCaseElement`
- `createWikiSyncCaseGroupElement`
- `appendWikiSyncCaseRows`
- `appendWikiSyncCaseCandidates`
- `appendWikiSyncCaseActions`
- `createWikiSyncActionButton`
- `appendWikiSyncInfoRow`
- `appendWikiSyncLinkRow`
- `canResolveWikiSyncCase`
- `getWikiSyncCaseTitle`
- `formatWikiSyncCaseStatus`
- `formatWikiSyncMatchKind`
- `findWikiSyncCaseFromElement`
- `handleWikiSyncCaseActionClick`
- `updateWikiSyncCaseStatus`
- `archiveWikiSyncCreatedLocationCase`
- `findWikiSyncMapInCase`
- `findWikiSyncCandidateInCase`
- `focusWikiSyncCase`
- `clearWikiSyncPreviewMarker`
- `showWikiSyncPreviewMarker`
- `startWikiSyncLocationPick`
- `handleWikiSyncLocationPick`
- `openWikiSyncResolveDialogForCase`
- `buildWikiSyncResolvePresets`
- `normalizeWikiSyncLatLng`
- `applyWikiSyncResolvePreset`
- `syncWikiSyncResolveLinkButton`
- `openWikiSyncResolveWikiLink`
- `handleWikiSyncResolveFormSubmit`

Diese Liste ist absichtlich streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Review-Panel oeffnen und Tab `WikiSync` waehlen.
4. WikiSync-Locations-Liste laden; Filter testen; Gruppen auf-/zuklappen.
5. Fall fokussieren, wenn Testdaten vorhanden sind.
6. `Position wählen` bzw. Resolve-Dialog nur mit sicheren Testdaten pruefen; sonst nur Dialog oeffnen/schliessen.
7. Preset-Buttons `Wiki-Einstellung` und `Avesmap Einstellung` testen, falls Resolve-Dialog offen ist.
8. Wiki-Link-Button im Resolve-Dialog testen, falls Link vorhanden ist.
9. Tab `Herrschaftsgebiete` im WikiSync-Panel oeffnen; Baum laden und Filter testen.
10. WikiSync-Lauf-Buttons nicht produktiv ausloesen, ausser bewusst mit sicherem Testsetup.
11. Zurueck zu `Meldungen`, `Aenderungen`, `Status` wechseln; Tabwechsel darf nicht brechen.
12. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches. Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split des WikiSync-Clusters aus js/dialogs-review.js in eine neue Datei js/review/review-wiki-sync.js.

Erlaubte Änderungen:
- js/dialogs-review.js
- neue Datei js/review/review-wiki-sync.js
- index.html
- docs/refactoring-status.md

Nicht ändern:
- js/review/review-core.js
- js/review/review-status.js
- js/review/review-pending.js
- js/review/review-paths.js
- js/review/review-labels.js
- js/review/review-locations.js
- js/review/review-panels.js
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich die in docs/dialogs-review-wiki-sync-split-boundary-check.md unter "Exakter zulaessiger Funktionsumfang" genannten Funktionen aus js/dialogs-review.js nach js/review/review-wiki-sync.js. Funktionen unverändert lassen und in sinnvoller Reihenfolge verschieben.

Falls beim Verschieben weitere Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/review/review-wiki-sync.js:
- enthält nur Funktionsdefinitionen
- keine Top-Level-Ausführung
- keine DOM-Reads/Writes außerhalb von Funktionen
- keine neuen globalen Namen außer den verschobenen bestehenden Funktionsnamen
- keine Logikänderungen
- Event-Bindings nur dann verschieben, wenn sie eindeutig WikiSync-only sind und bereits direkt zu den verschobenen Funktionen gehören; andernfalls im Rest-Orchestrator lassen

index.html:
- Script-Reihenfolge erweitern:
  1. js/review/review-core.js
  2. js/review/review-status.js
  3. js/review/review-pending.js
  4. js/review/review-paths.js
  5. js/review/review-labels.js
  6. js/review/review-locations.js
  7. js/review/review-panels.js
  8. js/review/review-wiki-sync.js
  9. js/dialogs-review.js

docs/refactoring-status.md:
- neuen stabilen Split js/review/review-wiki-sync.js dokumentieren
- Smoke-Test-Empfehlung WikiSync ergänzen
- klar festhalten, dass Region/Territory und Region-Wiki-Picker nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach fehlenden Referenzen/Typo bei js/review/review-wiki-sync.js in index.html.
- Syntaxprüfung:
  - node --check js/review/review-wiki-sync.js
  - node --check js/dialogs-review.js

Danach:
- git status zeigen
- git add index.html js/dialogs-review.js js/review/review-wiki-sync.js docs/refactoring-status.md
- git commit -m "Split dialog review WikiSync helpers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. WikiSync-Tab öffnen, Locations-Liste laden.
3. Filter und Accordion prüfen.
4. Einen Fall fokussieren, falls Testdaten vorhanden sind.
5. Resolve-Dialog nur mit sicheren Testdaten öffnen/schließen; Presets prüfen.
6. Herrschaftsgebiete-Tab öffnen, Baum/Filter prüfen.
7. Keine produktiven WikiSync-Läufe starten, außer bewusst mit Testsetup.
8. Zurück zu Meldungen/Änderungen/Status wechseln.
9. Konsole erneut prüfen.
```

## Ergebnis

WikiSync ist als naechster Split geeignet, aber nur als streng begrenzter Datei-Split. Region/Territory, Region-Wiki-Picker, Review-Detailfunktionen und Submit-/Init-Logik bleiben im Rest-Orchestrator. Der konkrete Code-Split sollte erst im naechsten Schritt erfolgen.