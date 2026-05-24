# Dialogs Review Region Submit Flow Split Boundary Check

## Ausgangspunkt

Nach dem bestaetigten Region-Dialog-Population-Split bleibt `js/dialogs-review.js` Rest-Orchestrator fuer Region-/Territory-Event-Bindings, Region-Submit, weitere Editor-Submit-Flows, Init-/Bootstrapping-Logik und verbleibende Hilfsfunktionen.

Der naechste sichere Split ist bewusst eng: Region-Payload-Building und Region-Submit-Handler. Die allgemeinen jQuery-Event-Bindings, Location/Path/Powerline/Label-Submit-Flows sowie Init-/Bootstrapping-Logik bleiben in `js/dialogs-review.js`.

## Gelesene Bereiche

Der aktuelle Rest-Orchestrator enthaelt:

- Region-Event-Bindings fuer Tabs, Parent-Baum, Assignment-Drop, Assignment-Summary-Felder
- `updateRegionParentFilter(...)`
- `buildRegionEditPayload(...)`
- danach Location-/Label-Report-Helfer und Location/Path/Powerline/Label-Submit-Handler
- `handleRegionEditFormSubmit(...)`
- `isSqlMapFeatureId(...)`
- danach Location-Report-Submit und weitere Restlogik

## Bewertung des Split-Risikos

### Sicher verschiebbar

Der Region-Submit-Flow ist als eigene Datei geeignet, wenn nur diese Funktionen verschoben werden:

- `buildRegionEditPayload(...)`
- `handleRegionEditFormSubmit(...)`

Beide Funktionen gehoeren fachlich eng zusammen: `handleRegionEditFormSubmit(...)` baut den Payload ueber `buildRegionEditPayload(...)`, verarbeitet Political-Territory-Tabs, delegiert an `saveRegionEditTab(...)` oder `submitMapFeatureEdit(...)` und schliesst den Dialog.

### Bewusst nicht verschieben

Nicht Teil dieses Splits:

- `isSqlMapFeatureId(...)` bleibt im Rest, weil es als generischer Validator klein und potenziell wiederverwendbar ist.
- `updateRegionParentFilter(...)` bleibt im Rest/Eventbereich.
- alle jQuery-Event-Bindings bleiben im Rest.
- Location-/Path-/Powerline-/Label-Submit-Handler bleiben im Rest.
- Location-Report-Submit bleibt im Rest.
- Init-/Bootstrapping-Logik bleibt im Rest.
- API-/PHP-/SQL-Dateien bleiben unangetastet.

## Empfohlener Split

Dateiname:

- `js/review/review-region-submit-flow.js`

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
18. `js/dialogs-review.js`

Begruendung: Region-Submit wird von Event-Bindings in `dialogs-review.js` referenziert. Die Datei muss deshalb vor `dialogs-review.js` geladen werden.

## Exakter zulaessiger Funktionsumfang fuer den Region-Submit-Flow-Split

Verschiebe ausschliesslich diese Funktionen:

- `buildRegionEditPayload`
- `handleRegionEditFormSubmit`

Diese Liste ist streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Region/Herrschaftsgebiet-Dialog fuer sicheren Testeintrag oeffnen.
4. Formularwerte kurz aendern und speichern.
5. Political-Territory-Tab speichern, falls sichere Testregion vorhanden.
6. Mehrere Tabs speichern, falls Testdaten vorhanden.
7. Freigegebene Geometrie ohne Territory speichern/schliessen, falls sicher moeglich.
8. Nicht-political Region-Speichern pruefen, falls ein sicherer Testeintrag vorhanden ist.
9. Dialog erneut oeffnen und Werte pruefen.
10. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches.

Zuerst aktuellen Stand holen:
git checkout master
git pull --ff-only origin master

Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split des Region-Submit-/Payload-Flows aus js/dialogs-review.js in eine neue Datei js/review/review-region-submit-flow.js.

Erlaubte Änderungen:
- js/dialogs-review.js
- neue Datei js/review/review-region-submit-flow.js
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
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich diese Funktionen aus js/dialogs-review.js nach js/review/review-region-submit-flow.js, unverändert und in sinnvoller Reihenfolge:
- buildRegionEditPayload
- handleRegionEditFormSubmit

Nicht verschieben:
- isSqlMapFeatureId
- updateRegionParentFilter
- alle jQuery-Event-Bindings
- Location-/Path-/Powerline-/Label-Submit-Handler
- Location-Report-Submit-Handler
- Init-/Bootstrapping-Logik

Falls beim Verschieben weitere Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/review/review-region-submit-flow.js:
- enthält nur Funktionsdefinitionen
- keine Top-Level-Ausführung
- keine DOM-Reads/Writes außerhalb von Funktionen
- keine Event-Bindings
- keine API-Aufrufe außerhalb von Funktionen
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
  18. js/dialogs-review.js

docs/refactoring-status.md:
- Region-Dialog-Population-Smoke als bestanden markieren
- neuen stabilen Split js/review/review-region-submit-flow.js dokumentieren
- Smoke-Test-Empfehlung Region-Submit-Flow ergänzen
- klar festhalten, dass Event-Bindings, andere Editor-Submit-Handler und Init-/Bootstrapping-Logik nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach fehlenden Referenzen/Typo bei js/review/review-region-submit-flow.js in index.html.
- Syntaxprüfung:
  - node --check js/review/review-region-submit-flow.js
  - node --check js/dialogs-review.js

Danach:
- git status zeigen
- git add index.html js/dialogs-review.js js/review/review-region-submit-flow.js docs/refactoring-status.md
- git commit -m "Split dialog review region submit flow helpers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. Region/Herrschaftsgebiet-Dialog für sicheren Testeintrag öffnen.
3. Formularwerte kurz ändern und speichern.
4. Political-Territory-Tab speichern, falls sichere Testregion vorhanden.
5. Mehrere Tabs speichern, falls Testdaten vorhanden.
6. Freigegebene Geometrie ohne Territory speichern/schließen, falls sicher möglich.
7. Nicht-political Region-Speichern prüfen, falls sicherer Testeintrag vorhanden ist.
8. Dialog erneut öffnen und Werte prüfen.
9. Konsole erneut prüfen.
```

## Ergebnis

Region-Submit-/Payload-Flow ist als naechster Split geeignet, aber nur mit engem Scope. Event-Bindings, andere Editor-Submit-Handler und Init-/Bootstrapping-Logik bleiben unangetastet und brauchen danach eigene Boundary-Analysen.