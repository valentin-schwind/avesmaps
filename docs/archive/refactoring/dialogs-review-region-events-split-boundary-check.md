# Dialogs Review Region Events Split Boundary Check

## Ausgangspunkt

Nach dem bestaetigten Region-Submit-/Payload-Flow-Split bleibt `js/review/review-region-util.js` Rest-Orchestrator fuer Region-/Territory-Event-Bindings, weitere Editor-Submit-Flows, Report-Handler, Init-/Bootstrapping-Logik und verbleibende Hilfsfunktionen.

Der naechste sinnvolle Split ist ein enger Region-Events-Split. Er betrifft nur die jQuery-Event-Bindings und den kleinen Filter-Helper fuer Region-/Herrschaftsgebiet-Interaktion. Andere Editor-Submit-Handler, Report-Handler und Init-/Bootstrapping bleiben in `js/review/review-region-util.js`.

## Gelesene Bereiche

Der aktuelle Rest-Orchestrator beginnt nach den Normalisierern mit Region-spezifischen Event-Bindings:

- Tab-Klick und Tab-Schliessen
- Parent-Baum-Klick, Doppelklick, Drag-Start, Parent-Drop
- Assignment-Drop, Breadcrumb-Klick, Assignment-Clear
- Assignment-Zoom-Summary und Formular-Zoom-Sync
- Assignment-Summary-Felder fuer Farbe, Opacity, Name, Wappen, Zeitraum
- Wappen-Refresh
- Parent-Clear
- `updateRegionParentFilter(...)`

Danach folgen Report-/Location-/Label-Helfer und andere Editor-Submit-Handler.

## Bewertung des Split-Risikos

### Sicher verschiebbar

Der Region-Event-Block kann als eigene klassische Script-Datei vor `dialogs-review.js` geladen werden. Die Event-Bindings duerfen dort Top-Level bleiben, weil das aktuell bereits so ist und die Verhaltensneutralitaet sonst schlechter waere. Der Scope bleibt aber streng auf Region-/Herrschaftsgebiet-Events begrenzt.

### Bewusst nicht verschieben

Nicht Teil dieses Splits:

- `openLocationEditDialogFromReport`
- `openLabelEditDialogFromReport`
- `rejectReviewReport`
- Location-/Path-/Powerline-/Label-Submit-Handler
- Location-Report-Submit-Handler
- `isSqlMapFeatureId`
- Init-/Bootstrapping-Logik
- API-/PHP-/SQL-Dateien

## Empfohlener Split

Dateiname:

- `js/dialogs-review-region-events.js`

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
19. `js/review/review-region-util.js`

Begruendung: Die Event-Bindings referenzieren alle vorher ausgelagerten Region-Helfer. Sie muessen nach diesen Dateien, aber vor der Restdatei geladen werden.

## Exakter zulaessiger Umfang fuer den Region-Events-Split

Verschiebe ausschliesslich den zusammenhaengenden Region-Event-Block direkt nach `normalizeParentheticalSpacing(...)` bis einschliesslich `updateRegionParentFilter(...)`:

- `$(document).on("click", "[data-region-edit-tab]", ...)`
- `$(document).on("click", "[data-region-edit-tab-close]", ...)`
- `$(document).on("click", "[data-region-parent-id]", ...)`
- `$(document).on("dblclick", "#region-edit-parent-tree [data-region-territory-id]", ...)`
- `$(document).on("dragstart", "#region-edit-parent-tree [data-region-territory-id]", ...)`
- `$(document).on("dragover", "#region-edit-parent-drop", ...)`
- `$(document).on("dragleave", "#region-edit-parent-drop", ...)`
- `$(document).on("drop", "#region-edit-parent-drop", ...)`
- `$(document).on("dragover", "#region-edit-assignment-drop", ...)`
- `$(document).on("dragleave", "#region-edit-assignment-drop", ...)`
- `$(document).on("drop", "#region-edit-assignment-drop", ...)`
- `$(document).on("click", "[data-region-assignment-breadcrumb-id]", ...)`
- `$(document).on("click", "#region-edit-assignment-clear", ...)`
- `$(document).on("input change", "[data-region-assignment-zoom-min], [data-region-assignment-zoom-max]", ...)`
- `$(document).on("input change", "#region-edit-min-zoom, #region-edit-max-zoom", ...)`
- `$(document).on("input change", "[data-region-assignment-field]", ...)`
- `$(document).on("click", "[data-region-assignment-coat-refresh]", ...)`
- `$(document).on("click", "#region-edit-parent-clear", ...)`
- `updateRegionParentFilter(...)`

Diese Liste ist streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Besonderheit: Top-Level-Code

Anders als die bisherigen Helper-Dateien enthaelt `js/dialogs-review-region-events.js` bewusst Top-Level-jQuery-Bindings. Das ist kein neues Verhalten, sondern die Verlagerung bestehender Top-Level-Bindings. Keine zusaetzliche Ausfuehrungslogik hinzufuegen.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Region/Herrschaftsgebiet-Dialog fuer sicheren Testeintrag oeffnen.
4. Tab-Klick und Tab-Schliessen pruefen.
5. Parent-Baum: Klick, Auf-/Zuklappen, Doppelklick pruefen.
6. Parent-Drag auf Parent-Drop pruefen, falls sichere Testdaten vorhanden sind.
7. Assignment-Drop, Breadcrumb-Klick und Assignment-Clear pruefen, falls sichere Testdaten vorhanden sind.
8. Assignment-Summary-Felder pruefen: Zoom, Farbe, Opacity, Name, Wappen, Zeitraum.
9. Parent-Clear pruefen.
10. Speichern mit sicherer Testregion pruefen.
11. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches.

Zuerst aktuellen Stand holen:
git checkout master
git pull --ff-only origin master

Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split der Region-/Herrschaftsgebiet-Event-Bindings aus js/review/review-region-util.js in eine neue Datei js/dialogs-review-region-events.js.

Erlaubte Änderungen:
- js/review/review-region-util.js
- neue Datei js/dialogs-review-region-events.js
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
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich den zusammenhängenden Region-Event-Block direkt nach normalizeParentheticalSpacing(...) bis einschließlich updateRegionParentFilter(...) nach js/dialogs-review-region-events.js.

Der verschobene Umfang umfasst:
- alle jQuery-Bindings für [data-region-edit-tab] und [data-region-edit-tab-close]
- alle jQuery-Bindings für #region-edit-parent-tree und #region-edit-parent-drop
- alle jQuery-Bindings für #region-edit-assignment-drop, [data-region-assignment-breadcrumb-id], #region-edit-assignment-clear
- alle jQuery-Bindings für [data-region-assignment-zoom-min], [data-region-assignment-zoom-max], #region-edit-min-zoom, #region-edit-max-zoom
- alle jQuery-Bindings für [data-region-assignment-field]
- das jQuery-Binding für [data-region-assignment-coat-refresh]
- das jQuery-Binding für #region-edit-parent-clear
- updateRegionParentFilter

Nicht verschieben:
- openLocationEditDialogFromReport
- openLabelEditDialogFromReport
- rejectReviewReport
- Location-/Path-/Powerline-/Label-Submit-Handler
- Location-Report-Submit-Handler
- isSqlMapFeatureId
- Init-/Bootstrapping-Logik

Falls beim Verschieben weitere Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/dialogs-review-region-events.js:
- darf die bestehenden Top-Level-jQuery-Bindings enthalten, weil genau diese Bindings verlagert werden
- keine neuen Event-Bindings hinzufügen
- keine Logikänderungen
- keine API-Aufrufe außerhalb der bereits bestehenden Event-Handler
- keine neuen globalen Namen außer updateRegionParentFilter
- keine sonstige Top-Level-Ausführung hinzufügen

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
  19. js/review/review-region-util.js

docs/refactoring-status.md:
- Region-Submit-Flow-Smoke als bestanden markieren
- neuen stabilen Split js/dialogs-review-region-events.js dokumentieren
- Smoke-Test-Empfehlung Region-Events ergänzen
- klar festhalten, dass andere Editor-Submit-Handler, Report-Handler und Init-/Bootstrapping-Logik nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Event-Bindings für die verschobenen Selektoren.
- Suche nach doppelter Definition von updateRegionParentFilter.
- Suche nach fehlender Referenz/Typo bei js/dialogs-review-region-events.js in index.html.
- Syntaxprüfung:
  - node --check js/dialogs-review-region-events.js
  - node --check js/review/review-region-util.js

Danach:
- git status zeigen
- git add index.html js/review/review-region-util.js js/dialogs-review-region-events.js docs/refactoring-status.md
- git commit -m "Split dialog review region event bindings"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. Region/Herrschaftsgebiet-Dialog für sicheren Testeintrag öffnen.
3. Tab-Klick und Tab-Schließen prüfen.
4. Parent-Baum: Klick, Auf-/Zuklappen, Doppelklick prüfen.
5. Parent-Drag auf Parent-Drop prüfen, falls sichere Testdaten vorhanden sind.
6. Assignment-Drop, Breadcrumb-Klick und Assignment-Clear prüfen, falls sichere Testdaten vorhanden sind.
7. Assignment-Summary-Felder prüfen: Zoom, Farbe, Opacity, Name, Wappen, Zeitraum.
8. Parent-Clear prüfen.
9. Speichern mit sicherer Testregion prüfen.
10. Konsole erneut prüfen.
```

## Ergebnis

Region-/Herrschaftsgebiet-Event-Bindings sind als naechster Split geeignet. Andere Editor-Submit-Handler, Report-Handler und Init-/Bootstrapping-Logik bleiben unangetastet und brauchen danach eigene Boundary-Analysen.