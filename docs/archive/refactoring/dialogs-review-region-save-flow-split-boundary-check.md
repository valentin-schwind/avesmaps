# Dialogs Review Region Save Flow Split Boundary Check

## Ausgangspunkt

Nach dem bestaetigten Region-Tabs-/Payload-State-Split ist `js/dialogs-review.js` Rest-Orchestrator fuer Region-/Territory-Save/Submit/Dialog-Flow, Dialog-Population, jQuery-Event-Bindings, API-/Init-Logik und verbleibende Hilfsfunktionen.

Der naechste moegliche Split ist riskanter als die vorherigen, weil Save, Tab-Laden, Dialog-Population und Event-Bindings eng zusammenarbeiten. Deshalb wird ein bewusst enger Save-Flow-Helfer-Split empfohlen. Dialog-Population (`populateRegionEditForm`, `openRegionEditDialog`) und alle Event-Bindings bleiben im Rest-Orchestrator.

## Gelesene Bereiche

Der aktuelle Rest-Orchestrator beginnt nach den Normalisierern mit:

- `saveRegionEditTab(...)`
- `normalizePoliticalTerritoryForRegionEdit(...)`
- `openRegionEditTabForTerritory(...)`
- `activatePrimaryRegionEditTabForTerritory(...)`
- `askRegionTabCloseChoice(...)`
- danach jQuery-Event-Bindings fuer Tab-Klick/Tab-Close
- danach `populateRegionEditForm(...)`
- danach `openRegionEditDialog(...)`
- danach Parent-/Assignment-/Summary-/Submit-Event-Bindings und weitere Restlogik

## Bewertung des Split-Risikos

### Sicher verschiebbar

Der folgende Save-/Tab-Load-Helferblock ist als eigene Datei geeignet, wenn keine jQuery-Event-Bindings und keine Dialog-Population mitgenommen werden:

- `saveRegionEditTab(...)`
- `normalizePoliticalTerritoryForRegionEdit(...)`
- `openRegionEditTabForTerritory(...)`
- `activatePrimaryRegionEditTabForTerritory(...)`
- `askRegionTabCloseChoice(...)`

Diese Funktionen sind globale Funktionsdefinitionen. API-/Submit-Aufrufe erfolgen nur innerhalb von Funktionen, nicht auf Top-Level.

### Nicht im selben Schritt verschieben

Nicht Teil dieses Splits:

- `populateRegionEditForm`
- `openRegionEditDialog`
- `buildRegionEditPayload`
- alle jQuery-Event-Bindings
- Region-Submit-Handler
- Init-/Bootstrapping-Logik
- API-/PHP-/SQL-Dateien

## Empfohlener Split

Dateiname:

- `js/dialogs-review-region-save-flow.js`

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
16. `js/dialogs-review.js`

Begruendung: Save-/Tab-Load-Helfer werden von Rest-Orchestrator und Event-Bindings zur Laufzeit referenziert. Die Datei muss vor `dialogs-review.js` geladen werden.

## Exakter zulaessiger Funktionsumfang fuer den Region-Save-Flow-Split

Verschiebe ausschliesslich diese Funktionen:

- `saveRegionEditTab`
- `normalizePoliticalTerritoryForRegionEdit`
- `openRegionEditTabForTerritory`
- `activatePrimaryRegionEditTabForTerritory`
- `askRegionTabCloseChoice`

Diese Liste ist streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Region/Herrschaftsgebiet-Dialog fuer sicheren Testeintrag oeffnen.
4. Tab-Anzeige und Tab-Wechsel pruefen.
5. Breadcrumb/Assignment oeffnen, sodass `openRegionEditTabForTerritory(...)` bzw. `activatePrimaryRegionEditTabForTerritory(...)` genutzt wird, falls Testdaten vorhanden sind.
6. Einen Tab mit ungespeicherter Aenderung schliessen und Dirty-Confirm pruefen.
7. Speichern mit sicherer Testregion pruefen.
8. Geometrie-Zuweisung speichern, falls sichere Testdaten vorhanden sind.
9. Dialog schliessen und erneut oeffnen.
10. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches.

Zuerst aktuellen Stand holen:
git checkout master
git pull --ff-only origin master

Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split der Region-Save-/Tab-Load-Helfer aus js/dialogs-review.js in eine neue Datei js/dialogs-review-region-save-flow.js.

Erlaubte Änderungen:
- js/dialogs-review.js
- neue Datei js/dialogs-review-region-save-flow.js
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
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich diese Funktionen aus js/dialogs-review.js nach js/dialogs-review-region-save-flow.js, unverändert und in sinnvoller Reihenfolge:
- saveRegionEditTab
- normalizePoliticalTerritoryForRegionEdit
- openRegionEditTabForTerritory
- activatePrimaryRegionEditTabForTerritory
- askRegionTabCloseChoice

Nicht verschieben:
- populateRegionEditForm
- openRegionEditDialog
- buildRegionEditPayload
- alle jQuery-Event-Bindings
- Region-Submit-Handler
- Init-/Bootstrapping-Logik

Falls beim Verschieben weitere Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/dialogs-review-region-save-flow.js:
- enthält nur Funktionsdefinitionen
- keine Top-Level-Ausführung
- keine DOM-Reads/Writes außerhalb von Funktionen
- keine Event-Bindings
- keine API-Aufrufe außerhalb von Funktionen
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
  16. js/dialogs-review.js

docs/refactoring-status.md:
- Region-Tabs-Payload-Smoke als bestanden markieren
- neuen stabilen Split js/dialogs-review-region-save-flow.js dokumentieren
- Smoke-Test-Empfehlung Region-Save-Flow ergänzen
- klar festhalten, dass Dialog-Population, Event-Bindings, Submit-Handler und Init-/Bootstrapping-Logik nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach fehlenden Referenzen/Typo bei js/dialogs-review-region-save-flow.js in index.html.
- Syntaxprüfung:
  - node --check js/dialogs-review-region-save-flow.js
  - node --check js/dialogs-review.js

Danach:
- git status zeigen
- git add index.html js/dialogs-review.js js/dialogs-review-region-save-flow.js docs/refactoring-status.md
- git commit -m "Split dialog review region save flow helpers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. Region/Herrschaftsgebiet-Dialog für sicheren Testeintrag öffnen.
3. Tab-Anzeige und Tab-Wechsel prüfen.
4. Breadcrumb/Assignment öffnen, sodass ein weiterer Territory-Tab geladen wird, falls möglich.
5. Dirty-Confirm beim Tab-Schließen prüfen.
6. Speichern mit sicherer Testregion prüfen.
7. Geometrie-Zuweisung speichern, falls sichere Testdaten vorhanden sind.
8. Dialog schließen und erneut öffnen.
9. Konsole erneut prüfen.
```

## Ergebnis

Region-Save-/Tab-Load-Flow ist als naechster Split geeignet, aber nur mit engem Scope. Dialog-Population, jQuery-Event-Bindings, Submit-Handler und Init-/Bootstrapping-Logik bleiben unangetastet und brauchen danach eigene Boundary-Analysen.