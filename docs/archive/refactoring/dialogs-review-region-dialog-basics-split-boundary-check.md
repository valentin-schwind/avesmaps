# Dialogs Review Region Dialog Basics Split Boundary Check

## Ausgangspunkt

Nach dem bestaetigten Region-Wiki-Picker-Split ist `js/dialogs-review.js` weiter der Rest-Orchestrator. Der verbleibende Region/Territory-Bereich ist gross und sollte nicht in einem Schritt verschoben werden.

Der kleinste naechste sichere Kandidat ist ein Region-Dialog-Basics-Split: einfache Dialog-/Form-/Anzeigehelfer fuer den Region-Dialog, aber ohne Parent-Tree, Assignment, Tabs, Submit oder Event-Bindings.

## Gelesene Bereiche

Im aktuellen `js/dialogs-review.js` liegen am Anfang unter anderem:

- `resetRegionEditForm()`
- `setRegionEditDialogOpen(...)`
- `setRegionWikiPickerDialogOpen(...)`
- `syncRegionOpacityOutput()`
- `syncRegionValidToControls()`
- `syncRegionCoatPreview()`
- `syncRegionTerritoryFieldVisibility(...)`
- `syncRegionEditRequiredState()`
- `populateRegionTypeOptions(...)`

Danach beginnt der groessere Parent-/Tree-/Assignment-/Tabs-Bereich mit Normalisierung, Parent-Tree-Aufbau, Hierarchie-Deduplizierung, Assignment-Breadcrumbs, Tab-Verwaltung und Event-Bindings.

## Bewertung des Split-Risikos

### Sicher verschiebbar

Die genannten Basisfunktionen sind klein, fachlich zusammenhaengend und enthalten keine Top-Level-Ausfuehrung. Sie sind klassische globale Helper und passen zum bestehenden Script-Modell.

Sie duerfen in eine neue Datei ausgelagert werden:

- `js/dialogs-review-region-basics.js`

### Nicht im selben Schritt verschieben

Nicht Teil dieses Splits:

- `resetPathEditForm`
- `resetPowerlineEditForm`
- `resetLabelEditForm`
- `setPathEditDialogOpen`
- `setPowerlineEditDialogOpen`
- Parent-Tree-Funktionen (`populateRegionParentSelect`, `buildPoliticalTerritoryTree`, Tree-Render-/Dedupe-/Search-Helfer)
- Region-Assignment-Funktionen (`renderRegionAssignment`, Breadcrumb-/Draft-/Assignment-Helfer)
- Region-Tabs (`initializeRegionEditTabs`, `renderRegionEditTabs`, `saveRegionEditTab`, etc.)
- `populateRegionEditForm`
- `openRegionEditDialog`
- `buildRegionEditPayload`
- Submit-Handler
- Event-Bindings
- API-/PHP-/SQL-Dateien

## Empfohlener Split

Dateiname:

- `js/dialogs-review-region-basics.js`

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
11. `js/dialogs-review.js`

Begruendung: Die Region-Basics werden von Rest-Orchestrator und Region-Wiki-Picker-Flows zur Laufzeit genutzt. Eine globale Funktionsdatei direkt vor `dialogs-review.js` ist ausreichend und bleibt kompatibel mit der klassischen Script-Reihenfolge.

## Exakter zulaessiger Funktionsumfang fuer den ersten Region-Basics-Split

Verschiebe ausschliesslich diese Funktionen:

- `resetRegionEditForm`
- `setRegionEditDialogOpen`
- `setRegionWikiPickerDialogOpen`
- `syncRegionOpacityOutput`
- `syncRegionValidToControls`
- `syncRegionCoatPreview`
- `syncRegionTerritoryFieldVisibility`
- `syncRegionEditRequiredState`
- `populateRegionTypeOptions`

Diese Liste ist absichtlich streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Region/Herrschaftsgebiet-Dialog fuer sicheren Testeintrag oeffnen.
4. Dialog schliessen und erneut oeffnen; Reset-Verhalten pruefen.
5. Opacity-Regler bewegen; Output muss synchron bleiben.
6. `valid_to_open` aktivieren/deaktivieren; `valid_to` muss korrekt disabled/geleert werden.
7. Wappen-Link setzen/leeren; Preview muss sichtbar/unsichtbar werden.
8. Source/Political-Territory-Feldsichtbarkeit pruefen, falls sicher moeglich.
9. Region-Wiki-Picker kurz oeffnen, damit `setRegionWikiPickerDialogOpen` weiterhin funktioniert.
10. Dialog ohne produktives Speichern schliessen, ausser bewusst mit Testdaten.
11. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches.

Zuerst aktuellen Stand holen:
git checkout master
git pull --ff-only origin master

Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split der Region-Dialog-Basishelfer aus js/dialogs-review.js in eine neue Datei js/dialogs-review-region-basics.js.

Erlaubte Änderungen:
- js/dialogs-review.js
- neue Datei js/dialogs-review-region-basics.js
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
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich diese Funktionen aus js/dialogs-review.js nach js/dialogs-review-region-basics.js, unverändert und in sinnvoller Reihenfolge:
- resetRegionEditForm
- setRegionEditDialogOpen
- setRegionWikiPickerDialogOpen
- syncRegionOpacityOutput
- syncRegionValidToControls
- syncRegionCoatPreview
- syncRegionTerritoryFieldVisibility
- syncRegionEditRequiredState
- populateRegionTypeOptions

Nicht verschieben:
- resetPathEditForm
- resetPowerlineEditForm
- resetLabelEditForm
- setPathEditDialogOpen
- setPowerlineEditDialogOpen
- Parent-Tree-Funktionen
- Region-Assignment-Funktionen
- Region-Tabs
- populateRegionEditForm
- openRegionEditDialog
- buildRegionEditPayload
- Submit-Handler
- Event-Bindings

Falls beim Verschieben weitere Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/dialogs-review-region-basics.js:
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
  8. js/dialogs-review-wiki-sync.js
  9. js/dialogs-review-region-wiki-picker.js
  10. js/dialogs-review-region-basics.js
  11. js/dialogs-review.js

docs/refactoring-status.md:
- Region-Wiki-Picker-Smoke als bestanden markieren
- neuen stabilen Split js/dialogs-review-region-basics.js dokumentieren
- Smoke-Test-Empfehlung Region-Basics ergänzen
- klar festhalten, dass Parent-Tree/Assignment/Tabs/Submit/Event-Bindings nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach fehlenden Referenzen/Typo bei js/dialogs-review-region-basics.js in index.html.
- Syntaxprüfung:
  - node --check js/dialogs-review-region-basics.js
  - node --check js/dialogs-review.js

Danach:
- git status zeigen
- git add index.html js/dialogs-review.js js/dialogs-review-region-basics.js docs/refactoring-status.md
- git commit -m "Split dialog review region basics helpers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. Region/Herrschaftsgebiet-Dialog für sicheren Testeintrag öffnen.
3. Dialog schließen und erneut öffnen; Reset-Verhalten prüfen.
4. Opacity-Regler, Valid-To-Open und Wappen-Preview prüfen.
5. Region-Wiki-Picker kurz öffnen.
6. Ohne produktives Speichern schließen, außer bewusst mit Testdaten.
7. Konsole erneut prüfen.
```

## Ergebnis

Region-Basics ist als naechster Split geeignet. Der groessere Parent-Tree-/Assignment-/Tabs-/Submit-Block bleibt weiterhin unangetastet und braucht danach eine eigene Boundary-Analyse.