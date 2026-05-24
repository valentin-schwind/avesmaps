# Dialogs Review Region Dialog Population Split Boundary Check

## Ausgangspunkt

Nach dem bestaetigten Region-Save-Flow-Split bleibt `js/dialogs-review.js` Rest-Orchestrator fuer Region-/Territory-Dialog-Population, jQuery-Event-Bindings, Submit-Handler, Init-/Bootstrapping-Logik und verbleibende Hilfsfunktionen.

Der naechste sichere Split ist bewusst klein: nur Region-Dialog-Population. Die jQuery-Event-Bindings liegen im Rest-Orchestrator teils vor und teils nach den beiden Funktionen, bleiben aber unangetastet. Funktionsdeklarationen sind im klassischen Script-Modell trotzdem vor Laufzeit nutzbar, sofern die neue Datei vor `dialogs-review.js` geladen wird.

## Gelesene Bereiche

Der aktuelle Rest-Orchestrator zeigt nach den Normalisierern zuerst Tab-Event-Bindings, danach:

- `populateRegionEditForm(...)`
- `openRegionEditDialog(...)`

Danach folgen Parent-/Assignment-/Summary-/Submit-Event-Bindings und weitere Restlogik.

## Bewertung des Split-Risikos

### Sicher verschiebbar

Die beiden Funktionen sind als eigene Datei geeignet:

- `populateRegionEditForm(...)` befuellt den Region-/Herrschaftsgebiet-Dialog aus einem Entry/Tab/Region-Objekt.
- `openRegionEditDialog(...)` setzt den Dialogtitel, initialisiert Tabs, befuellt das Formular, oeffnet den Dialog und laedt Political-Territory-Optionen nach.

Sie enthalten DOM-Zugriffe und asynchrone Nachlade-Logik innerhalb von Funktionen, aber keine Top-Level-Ausfuehrung und keine Event-Bindings.

### Nicht im selben Schritt verschieben

Nicht Teil dieses Splits:

- alle jQuery-Event-Bindings
- `buildRegionEditPayload`
- Region-Submit-Handler
- Delete-/Close-/Form-Event-Handler
- Init-/Bootstrapping-Logik
- API-/PHP-/SQL-Dateien

## Empfohlener Split

Dateiname:

- `js/review/review-region-dialog-population.js`

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
17. `js/dialogs-review.js`

Begruendung: Dialog-Population wird von Event-Bindings, Save-Flow und Open-Flows referenziert. Die Datei muss vor `dialogs-review.js` geladen werden.

## Exakter zulaessiger Funktionsumfang fuer den Region-Dialog-Population-Split

Verschiebe ausschliesslich diese Funktionen:

- `populateRegionEditForm`
- `openRegionEditDialog`

Diese Liste ist streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Region/Herrschaftsgebiet-Dialog fuer sicheren Testeintrag oeffnen.
4. Formularwerte pruefen: Name, Kurzname, Farbe, Opacity, Wiki/Wappen, Zoom, Zeitraum, Aktiv, Notizen.
5. Dialog schliessen und erneut oeffnen; Reset-/Population-Verhalten pruefen.
6. Tab-Wechsel pruefen, weil `populateRegionEditForm(...)` dort genutzt wird.
7. Parent-Baum und Assignment-Anzeige kurz pruefen.
8. Political-Territory-Options-Nachladen nach Dialogoeffnung kurz pruefen, falls sichtbar.
9. Speichern mit sicherer Testregion pruefen, falls moeglich.
10. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches.

Zuerst aktuellen Stand holen:
git checkout master
git pull --ff-only origin master

Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split der Region-Dialog-Population aus js/dialogs-review.js in eine neue Datei js/review/review-region-dialog-population.js.

Erlaubte Änderungen:
- js/dialogs-review.js
- neue Datei js/review/review-region-dialog-population.js
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
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich diese Funktionen aus js/dialogs-review.js nach js/review/review-region-dialog-population.js, unverändert und in sinnvoller Reihenfolge:
- populateRegionEditForm
- openRegionEditDialog

Nicht verschieben:
- alle jQuery-Event-Bindings
- buildRegionEditPayload
- Region-Submit-Handler
- Delete-/Close-/Form-Event-Handler
- Init-/Bootstrapping-Logik

Falls beim Verschieben weitere Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/review/review-region-dialog-population.js:
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
  17. js/dialogs-review.js

docs/refactoring-status.md:
- Region-Save-Flow-Smoke als bestanden markieren
- neuen stabilen Split js/review/review-region-dialog-population.js dokumentieren
- Smoke-Test-Empfehlung Region-Dialog-Population ergänzen
- klar festhalten, dass Event-Bindings, Submit-Handler und Init-/Bootstrapping-Logik nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach fehlenden Referenzen/Typo bei js/review/review-region-dialog-population.js in index.html.
- Syntaxprüfung:
  - node --check js/review/review-region-dialog-population.js
  - node --check js/dialogs-review.js

Danach:
- git status zeigen
- git add index.html js/dialogs-review.js js/review/review-region-dialog-population.js docs/refactoring-status.md
- git commit -m "Split dialog review region dialog population helpers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. Region/Herrschaftsgebiet-Dialog für sicheren Testeintrag öffnen.
3. Formularwerte prüfen: Name, Kurzname, Farbe, Opacity, Wiki/Wappen, Zoom, Zeitraum, Aktiv, Notizen.
4. Dialog schließen und erneut öffnen.
5. Tab-Wechsel prüfen.
6. Parent-Baum und Assignment-Anzeige kurz prüfen.
7. Political-Territory-Options-Nachladen kurz prüfen, falls sichtbar.
8. Speichern mit sicherer Testregion prüfen, falls möglich.
9. Konsole erneut prüfen.
```

## Ergebnis

Region-Dialog-Population ist als naechster Split geeignet. Event-Bindings, Submit-Handler und Init-/Bootstrapping-Logik bleiben unangetastet und brauchen danach eigene Boundary-Analysen.