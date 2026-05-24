# Dialogs Review Report Flow Split Boundary Check

## Ausgangspunkt

Nach dem bestaetigten Editor-Submit-Split bleibt `js/dialogs-review.js` sehr klein. Enthalten sind noch einige lokale Konstanten/Resthelfer, Dialog-Reset-/Open-State-Helfer fuer Path/Powerline/Label sowie der Review-/Location-Report-Flow.

Der naechste sichere Split ist ein enger Report-Flow-Split. Init-/Bootstrapping-Logik und die verbliebenen Dialog-Basishelfer bleiben in `js/dialogs-review.js`.

## Gelesene Bereiche

Der aktuelle Rest-Orchestrator enthaelt:

- `CHANGE_LOG_FOCUS_MARKER_TTL_MS`
- `POLITICAL_TERRITORY_DISPLAY_SUFFIXES`
- WikiSync-Territory-Tree-Cache-Variablen
- `resetPathEditForm(...)`
- `resetPowerlineEditForm(...)`
- `resetLabelEditForm(...)`
- `setPathEditDialogOpen(...)`
- `setPowerlineEditDialogOpen(...)`
- `normalizeSearchText(...)`
- `normalizeParentheticalSpacing(...)`
- `openLocationEditDialogFromReport(...)`
- `openLabelEditDialogFromReport(...)`
- `rejectReviewReport(...)`
- `isSqlMapFeatureId(...)`
- `finalizeLocationReportSubmission(...)`
- `handleLocationReportFormSubmit(...)`

## Bewertung des Split-Risikos

### Sicher verschiebbar

Der Report-Flow kann als eigene Helper-Datei ausgelagert werden:

- `openLocationEditDialogFromReport(...)`
- `openLabelEditDialogFromReport(...)`
- `rejectReviewReport(...)`
- `finalizeLocationReportSubmission(...)`
- `handleLocationReportFormSubmit(...)`

Diese Funktionen gehoeren fachlich zusammen: sie oeffnen Editor-Dialoge aus Review-Meldungen, verwerfen Meldungen oder senden Location-Reports.

### Bewusst nicht verschieben

Nicht Teil dieses Splits:

- `CHANGE_LOG_FOCUS_MARKER_TTL_MS`
- `POLITICAL_TERRITORY_DISPLAY_SUFFIXES`
- WikiSync-Territory-Tree-Cache-Variablen
- `resetPathEditForm(...)`
- `resetPowerlineEditForm(...)`
- `resetLabelEditForm(...)`
- `setPathEditDialogOpen(...)`
- `setPowerlineEditDialogOpen(...)`
- `normalizeSearchText(...)`
- `normalizeParentheticalSpacing(...)`
- `isSqlMapFeatureId(...)`
- alle Init-/Bootstrapping-/Event-Bindings
- API-/PHP-/SQL-Dateien

## Empfohlener Split

Dateiname:

- `js/review/review-report-flow.js`

Script-Reihenfolge in `index.html`:

1. `js/review/review-core.js`
2. `js/review/review-status.js`
3. `js/review/review-pending.js`
4. `js/review/review-paths.js`
5. `js/review/review-labels.js`
6. `js/review/review-locations.js`
7. `js/review/review-panels.js`
8. `js/review/review-wiki-sync.js`
9. `js/review/review-region-wiki-picker.js`
10. `js/review/review-region-basics.js`
11. `js/review/review-region-parent-tree.js`
12. `js/review/review-region-assignment-state.js`
13. `js/review/review-region-assignment-ui.js`
14. `js/review/review-region-tabs-payload.js`
15. `js/review/review-region-save-flow.js`
16. `js/review/review-region-dialog-population.js`
17. `js/review/review-region-submit-flow.js`
18. `js/review/review-region-events.js`
19. `js/review/review-editor-submit.js`
20. `js/review/review-report-flow.js`
21. `js/dialogs-review.js`

Begruendung: Report-Flow-Funktionen werden von verbleibenden Event-/Init-Flows referenziert und benoetigen vorher geladene Location-/Label-/Panel-/Status-/Pending-Helfer.

## Exakter zulaessiger Umfang fuer den Report-Flow-Split

Verschiebe ausschliesslich diese Funktionen:

- `openLocationEditDialogFromReport`
- `openLabelEditDialogFromReport`
- `rejectReviewReport`
- `finalizeLocationReportSubmission`
- `handleLocationReportFormSubmit`

Diese Liste ist streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Meldungen-/Review-Panel oeffnen.
4. Sichere Location-Meldung anklicken und pruefen, ob Ort-Edit-Dialog vorbefuellt wird.
5. Sichere Label-/Map-Meldung anklicken und pruefen, ob Label-Edit-Dialog vorbefuellt wird.
6. Eine sichere Testmeldung verwerfen, falls Testdaten vorhanden sind.
7. Location-Report-Formular oeffnen und Validierung pruefen.
8. Location-Report senden nur mit sicheren Testdaten pruefen.
9. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches.

Zuerst aktuellen Stand holen:
git checkout master
git pull --ff-only origin master

Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split des Review-/Location-Report-Flows aus js/dialogs-review.js in eine neue Datei js/review/review-report-flow.js.

Erlaubte Änderungen:
- js/dialogs-review.js
- neue Datei js/review/review-report-flow.js
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
- js/review/review-wiki-sync.js
- js/review/review-region-wiki-picker.js
- js/review/review-region-basics.js
- js/review/review-region-parent-tree.js
- js/review/review-region-assignment-state.js
- js/review/review-region-assignment-ui.js
- js/review/review-region-tabs-payload.js
- js/review/review-region-save-flow.js
- js/review/review-region-dialog-population.js
- js/review/review-region-submit-flow.js
- js/review/review-region-events.js
- js/review/review-editor-submit.js
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich diese Funktionen aus js/dialogs-review.js nach js/review/review-report-flow.js, unverändert und in sinnvoller Reihenfolge:
- openLocationEditDialogFromReport
- openLabelEditDialogFromReport
- rejectReviewReport
- finalizeLocationReportSubmission
- handleLocationReportFormSubmit

Nicht verschieben:
- CHANGE_LOG_FOCUS_MARKER_TTL_MS
- POLITICAL_TERRITORY_DISPLAY_SUFFIXES
- wikiSyncTerritoryTreeRowsCache / wikiSyncTerritoryTreeRowsLoaded / wikiSyncTerritoryTreeRootCountCache
- resetPathEditForm
- resetPowerlineEditForm
- resetLabelEditForm
- setPathEditDialogOpen
- setPowerlineEditDialogOpen
- normalizeSearchText
- normalizeParentheticalSpacing
- isSqlMapFeatureId
- alle Event-Bindings/Init-/Bootstrapping-Logik

Falls beim Verschieben weitere Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/review/review-report-flow.js:
- enthält nur Funktionsdefinitionen
- keine Top-Level-Ausführung
- keine Event-Bindings
- keine API-Aufrufe außerhalb der bestehenden Funktionen
- keine neuen globalen Namen außer den verschobenen bestehenden Funktionsnamen
- keine Logikänderungen

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
  9. js/review/review-region-wiki-picker.js
  10. js/review/review-region-basics.js
  11. js/review/review-region-parent-tree.js
  12. js/review/review-region-assignment-state.js
  13. js/review/review-region-assignment-ui.js
  14. js/review/review-region-tabs-payload.js
  15. js/review/review-region-save-flow.js
  16. js/review/review-region-dialog-population.js
  17. js/review/review-region-submit-flow.js
  18. js/review/review-region-events.js
  19. js/review/review-editor-submit.js
  20. js/review/review-report-flow.js
  21. js/dialogs-review.js

docs/refactoring-status.md:
- Editor-Submit-Smoke als bestanden markieren
- neuen stabilen Split js/review/review-report-flow.js dokumentieren
- Smoke-Test-Empfehlung Report-Flow ergänzen
- klar festhalten, dass Dialog-Reset/Open-State-Helfer, Validatoren und Init-/Bootstrapping-Logik nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach fehlender Referenz/Typo bei js/review/review-report-flow.js in index.html.
- Syntaxprüfung:
  - node --check js/review/review-report-flow.js
  - node --check js/dialogs-review.js

Danach:
- git status zeigen
- git add index.html js/dialogs-review.js js/review/review-report-flow.js docs/refactoring-status.md
- git commit -m "Split dialog review report flow helpers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. Meldungen-/Review-Panel öffnen.
3. Sichere Location-Meldung anklicken und Ort-Edit-Vorbefüllung prüfen.
4. Sichere Label-/Map-Meldung anklicken und Label-Edit-Vorbefüllung prüfen.
5. Sichere Testmeldung verwerfen, falls Testdaten vorhanden sind.
6. Location-Report-Formular öffnen und Validierung prüfen.
7. Location-Report senden nur mit sicheren Testdaten prüfen.
8. Konsole erneut prüfen.
```

## Ergebnis

Der Review-/Location-Report-Flow ist als naechster Split geeignet. Dialog-Reset/Open-State-Helfer, Validatoren und Init-/Bootstrapping-Logik bleiben unangetastet und brauchen danach eigene Boundary-Analysen.