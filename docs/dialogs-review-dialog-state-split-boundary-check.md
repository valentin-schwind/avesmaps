# Dialogs Review Dialog State Split Boundary Check

## Ausgangspunkt

Nach dem bestaetigten Report-Flow-Split ist `js/dialogs-review.js` nur noch ein sehr kleiner Rest. Enthalten sind Konstanten/Cache-Variablen, einige Dialog-Reset-/Open-State-Helfer sowie Normalizer/Validatoren.

Der letzte noch sinnvoll enge Code-Split ist ein Dialog-State-Split fuer Path/Powerline/Label-Dialoge. Konstanten, Cache-Variablen, Normalizer und Validatoren bleiben in `js/dialogs-review.js`.

## Gelesene Bereiche

Der aktuelle Rest enthaelt:

- `CHANGE_LOG_FOCUS_MARKER_TTL_MS`
- `POLITICAL_TERRITORY_DISPLAY_SUFFIXES`
- `wikiSyncTerritoryTreeRowsCache`
- `wikiSyncTerritoryTreeRowsLoaded`
- `wikiSyncTerritoryTreeRootCountCache`
- `resetPathEditForm(...)`
- `resetPowerlineEditForm(...)`
- `resetLabelEditForm(...)`
- `setPathEditDialogOpen(...)`
- `setPowerlineEditDialogOpen(...)`
- `normalizeSearchText(...)`
- `normalizeParentheticalSpacing(...)`
- `isSqlMapFeatureId(...)`

## Bewertung des Split-Risikos

### Sicher verschiebbar

Diese Funktionen gehoeren fachlich zusammen und koennen in eine eigene Datei ausgelagert werden:

- `resetPathEditForm(...)`
- `resetPowerlineEditForm(...)`
- `resetLabelEditForm(...)`
- `setPathEditDialogOpen(...)`
- `setPowerlineEditDialogOpen(...)`

Sie kapseln Reset-/Open-State fuer Editor-Dialoge. Sie enthalten keine Top-Level-Ausfuehrung, sondern nur Funktionsdefinitionen.

### Bewusst nicht verschieben

Nicht Teil dieses Splits:

- `CHANGE_LOG_FOCUS_MARKER_TTL_MS`
- `POLITICAL_TERRITORY_DISPLAY_SUFFIXES`
- `wikiSyncTerritoryTreeRowsCache`
- `wikiSyncTerritoryTreeRowsLoaded`
- `wikiSyncTerritoryTreeRootCountCache`
- `normalizeSearchText(...)`
- `normalizeParentheticalSpacing(...)`
- `isSqlMapFeatureId(...)`
- alle Init-/Bootstrapping-/Event-Bindings
- API-/PHP-/SQL-Dateien

## Empfohlener Split

Dateiname:

- `js/review/review-dialog-state.js`

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
19. `js/review/review-dialog-state.js`
20. `js/review/review-editor-submit.js`
21. `js/review/review-report-flow.js`
22. `js/dialogs-review.js`

Begruendung: Dialog-State-Helfer sollten vor Editor-Submit und Report-Flow geladen werden, weil diese Flows Dialoge schliessen/oeffnen koennen. Die Datei benoetigt vorher geladene Core-/Path-/Label-/Pending-Helfer.

## Exakter zulaessiger Umfang fuer den Dialog-State-Split

Verschiebe ausschliesslich diese Funktionen:

- `resetPathEditForm`
- `resetPowerlineEditForm`
- `resetLabelEditForm`
- `setPathEditDialogOpen`
- `setPowerlineEditDialogOpen`

Diese Liste ist streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Weg-Edit-Dialog oeffnen, schliessen und erneut oeffnen.
4. Weg speichern mit sicherem Testweg.
5. Kraftlinie-Edit-Dialog oeffnen, schliessen und speichern, falls sichere Testdaten vorhanden sind.
6. Label-Edit-Dialog oeffnen, schliessen und erneut oeffnen.
7. Label speichern mit sicherem Testeintrag.
8. Report-Flow kurz pruefen, weil `resetLabelEditForm` Report-Kontext zuruecksetzt.
9. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches.

Zuerst aktuellen Stand holen:
git checkout master
git pull --ff-only origin master

Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split der Dialog-Reset-/Open-State-Helfer aus js/dialogs-review.js in eine neue Datei js/review/review-dialog-state.js.

Erlaubte Änderungen:
- js/dialogs-review.js
- neue Datei js/review/review-dialog-state.js
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
- js/review/review-report-flow.js
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich diese Funktionen aus js/dialogs-review.js nach js/review/review-dialog-state.js, unverändert und in sinnvoller Reihenfolge:
- resetPathEditForm
- resetPowerlineEditForm
- resetLabelEditForm
- setPathEditDialogOpen
- setPowerlineEditDialogOpen

Nicht verschieben:
- CHANGE_LOG_FOCUS_MARKER_TTL_MS
- POLITICAL_TERRITORY_DISPLAY_SUFFIXES
- wikiSyncTerritoryTreeRowsCache / wikiSyncTerritoryTreeRowsLoaded / wikiSyncTerritoryTreeRootCountCache
- normalizeSearchText
- normalizeParentheticalSpacing
- isSqlMapFeatureId
- alle Event-Bindings/Init-/Bootstrapping-Logik

Falls beim Verschieben weitere Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/review/review-dialog-state.js:
- enthält nur Funktionsdefinitionen
- keine Top-Level-Ausführung
- keine Event-Bindings
- keine API-Aufrufe außerhalb der bestehenden Funktionen
- keine neuen globalen Namen außer den verschobenen bestehenden Funktionsnamen
- keine Logikänderungen

index.html:
- Script-Reihenfolge erweitern/anpassen:
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
  19. js/review/review-dialog-state.js
  20. js/review/review-editor-submit.js
  21. js/review/review-report-flow.js
  22. js/dialogs-review.js

docs/refactoring-status.md:
- Report-Flow-Smoke als bestanden markieren
- neuen stabilen Split js/review/review-dialog-state.js dokumentieren
- Smoke-Test-Empfehlung Dialog-State ergänzen
- klar festhalten, dass Konstanten, Cache-Variablen, Normalizer, Validatoren und Init-/Bootstrapping-Logik nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach fehlender Referenz/Typo bei js/review/review-dialog-state.js in index.html.
- Syntaxprüfung:
  - node --check js/review/review-dialog-state.js
  - node --check js/dialogs-review.js

Danach:
- git status zeigen
- git add index.html js/dialogs-review.js js/review/review-dialog-state.js docs/refactoring-status.md
- git commit -m "Split dialog review dialog state helpers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. Weg-Edit-Dialog öffnen, schließen und erneut öffnen.
3. Weg speichern mit sicherem Testweg.
4. Kraftlinie-Edit-Dialog öffnen, schließen und speichern, falls sichere Testdaten vorhanden sind.
5. Label-Edit-Dialog öffnen, schließen und erneut öffnen.
6. Label speichern mit sicherem Testeintrag.
7. Report-Flow kurz prüfen, weil resetLabelEditForm Report-Kontext zurücksetzt.
8. Konsole erneut prüfen.
```

## Ergebnis

Der Dialog-State-Cluster ist als letzter sinnvoller Code-Split geeignet. Danach sollte `js/dialogs-review.js` als kleiner finaler Rest mit Konstanten, Cache-Variablen, Normalizern und Validator stehen bleiben, statt kuenstlich weiter zerlegt zu werden.