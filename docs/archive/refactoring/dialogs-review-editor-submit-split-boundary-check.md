# Dialogs Review Editor Submit Split Boundary Check

## Ausgangspunkt

Nach dem bestaetigten Region-Events-Split bleibt `js/dialogs-review.js` Rest-Orchestrator fuer Report-Helfer, klassische Editor-Submit-Handler, Location-Report-Submit, Validatoren und Init-/Bootstrapping-Logik.

Der naechste sinnvolle Split ist ein enger Editor-Submit-Split. Er betrifft nur die klassischen Bearbeiten-Formulare fuer vorhandene/neu erzeugte Kartenfeatures. Region-Submit ist bereits ausgelagert und bleibt unveraendert. Location-Report-Submit und Review-Report-Helfer bleiben in `js/dialogs-review.js`.

## Gelesene Bereiche

Der aktuelle Rest-Orchestrator enthaelt nach den Normalisierern:

- `openLocationEditDialogFromReport(...)`
- `openLabelEditDialogFromReport(...)`
- `rejectReviewReport(...)`
- `handleLocationEditFormSubmit(...)`
- `handlePathEditFormSubmit(...)`
- `handlePowerlineEditFormSubmit(...)`
- `handleLabelEditFormSubmit(...)`
- `isSqlMapFeatureId(...)`
- `finalizeLocationReportSubmission(...)`
- `handleLocationReportFormSubmit(...)`

## Bewertung des Split-Risikos

### Sicher verschiebbar

Die klassischen Editor-Submit-Handler koennen als eigener Helper-Cluster ausgelagert werden:

- `handleLocationEditFormSubmit(...)`
- `handlePathEditFormSubmit(...)`
- `handlePowerlineEditFormSubmit(...)`
- `handleLabelEditFormSubmit(...)`

Diese Funktionen sind Form-Submit-Handler fuer bestehende Editor-Dialoge. Sie werden von Event-Bindings/Init-Logik referenziert, fuehren API-Aufrufe nur innerhalb der Handler aus und sind fachlich zusammenhaengend.

### Bewusst nicht verschieben

Nicht Teil dieses Splits:

- `openLocationEditDialogFromReport(...)`
- `openLabelEditDialogFromReport(...)`
- `rejectReviewReport(...)`
- `isSqlMapFeatureId(...)`
- `finalizeLocationReportSubmission(...)`
- `handleLocationReportFormSubmit(...)`
- Region-Dateien und Region-Submit/Event-Dateien
- Init-/Bootstrapping-Logik
- API-/PHP-/SQL-Dateien

## Empfohlener Split

Dateiname:

- `js/dialogs-review-editor-submit.js`

Script-Reihenfolge in `index.html`:

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
19. `js/dialogs-review-editor-submit.js`
20. `js/dialogs-review.js`

Begruendung: Editor-Submit-Handler werden von Event-Bindings/Init in `dialogs-review.js` referenziert. Die Datei muss deshalb vor `dialogs-review.js` geladen werden und nach den Dateien, die Payload-Builder/Status-/Pending-Helfer bereitstellen.

## Exakter zulaessiger Umfang fuer den Editor-Submit-Split

Verschiebe ausschliesslich diese Funktionen:

- `handleLocationEditFormSubmit`
- `handlePathEditFormSubmit`
- `handlePowerlineEditFormSubmit`
- `handleLabelEditFormSubmit`

Diese Liste ist streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Ort-Edit-Dialog fuer sicheren Testeintrag oeffnen und speichern.
4. Weg-Edit-Dialog fuer sicheren Testweg oeffnen und speichern.
5. Kraftlinie-Edit-Dialog fuer sicheren Testeintrag oeffnen und speichern, falls vorhanden.
6. Label-Edit-Dialog fuer sicheren Testeintrag oeffnen und speichern.
7. Optional: neuer Ort/neues Label aus Review-Meldung nur mit sicheren Testdaten pruefen.
8. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches.

Zuerst aktuellen Stand holen:
git checkout master
git pull --ff-only origin master

Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split der klassischen Editor-Submit-Handler aus js/dialogs-review.js in eine neue Datei js/dialogs-review-editor-submit.js.

Erlaubte Änderungen:
- js/dialogs-review.js
- neue Datei js/dialogs-review-editor-submit.js
- index.html
- docs/refactoring-status.md

Nicht ändern:
- js/dialogs-review-core.js
- js/dialogs-review-status.js
- js/dialogs-review-pending.js
- js/dialogs-review-paths.js
- js/dialogs-review-labels.js
- js/dialogs-review-locations.js
- js/dialogs-review-panels.js
- js/dialogs-review-wiki-sync.js
- js/dialogs-review-region-wiki-picker.js
- js/dialogs-review-region-basics.js
- js/dialogs-review-region-parent-tree.js
- js/dialogs-review-region-assignment-state.js
- js/dialogs-review-region-assignment-ui.js
- js/dialogs-review-region-tabs-payload.js
- js/dialogs-review-region-save-flow.js
- js/dialogs-review-region-dialog-population.js
- js/dialogs-review-region-submit-flow.js
- js/dialogs-review-region-events.js
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich diese Funktionen aus js/dialogs-review.js nach js/dialogs-review-editor-submit.js, unverändert und in sinnvoller Reihenfolge:
- handleLocationEditFormSubmit
- handlePathEditFormSubmit
- handlePowerlineEditFormSubmit
- handleLabelEditFormSubmit

Nicht verschieben:
- openLocationEditDialogFromReport
- openLabelEditDialogFromReport
- rejectReviewReport
- isSqlMapFeatureId
- finalizeLocationReportSubmission
- handleLocationReportFormSubmit
- alle Event-Bindings/Init-/Bootstrapping-Logik

Falls beim Verschieben weitere Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/dialogs-review-editor-submit.js:
- enthält nur Funktionsdefinitionen
- keine Top-Level-Ausführung
- keine Event-Bindings
- keine API-Aufrufe außerhalb der bestehenden Submit-Handler
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
  8. js/dialogs-review-wiki-sync.js
  9. js/dialogs-review-region-wiki-picker.js
  10. js/dialogs-review-region-basics.js
  11. js/dialogs-review-region-parent-tree.js
  12. js/dialogs-review-region-assignment-state.js
  13. js/dialogs-review-region-assignment-ui.js
  14. js/dialogs-review-region-tabs-payload.js
  15. js/dialogs-review-region-save-flow.js
  16. js/dialogs-review-region-dialog-population.js
  17. js/dialogs-review-region-submit-flow.js
  18. js/dialogs-review-region-events.js
  19. js/dialogs-review-editor-submit.js
  20. js/dialogs-review.js

docs/refactoring-status.md:
- Region-Events-Smoke als bestanden markieren
- neuen stabilen Split js/dialogs-review-editor-submit.js dokumentieren
- Smoke-Test-Empfehlung Editor-Submit ergänzen
- klar festhalten, dass Review-Report-Helfer, Location-Report-Submit und Init-/Bootstrapping-Logik nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach fehlender Referenz/Typo bei js/dialogs-review-editor-submit.js in index.html.
- Syntaxprüfung:
  - node --check js/dialogs-review-editor-submit.js
  - node --check js/dialogs-review.js

Danach:
- git status zeigen
- git add index.html js/dialogs-review.js js/dialogs-review-editor-submit.js docs/refactoring-status.md
- git commit -m "Split dialog review editor submit handlers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. Ort-Edit-Dialog für sicheren Testeintrag öffnen und speichern.
3. Weg-Edit-Dialog für sicheren Testweg öffnen und speichern.
4. Kraftlinie-Edit-Dialog für sicheren Testeintrag öffnen und speichern, falls vorhanden.
5. Label-Edit-Dialog für sicheren Testeintrag öffnen und speichern.
6. Optional neuen Ort/neues Label aus Review-Meldung nur mit sicheren Testdaten prüfen.
7. Konsole erneut prüfen.
```

## Ergebnis

Der Editor-Submit-Cluster ist als naechster Split geeignet. Review-Report-Helfer, Location-Report-Submit und Init-/Bootstrapping-Logik bleiben unangetastet und brauchen danach eigene Boundary-Analysen.