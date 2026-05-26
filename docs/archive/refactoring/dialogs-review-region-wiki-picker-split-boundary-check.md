# Dialogs Review Region Wiki Picker Split Boundary Check

## Ausgangspunkt

Nach dem bestaetigten WikiSync-Split ist `js/review/review-region-util.js` weiterhin Rest-Orchestrator fuer Region-/Territory-Flows, Region-Wiki-Picker, Submit-/API-/Init-Logik und verbleibende Hilfsfunktionen.

Der naechste sichere Kandidat ist nicht der gesamte Region/Territory-Cluster, sondern nur der kompakte Region-Wiki-Picker-Teil. Er liegt in `js/review/review-region-util.js` direkt nach `updateRegionParentFilter(...)` und vor `buildRegionEditPayload(...)`.

## Gelesene Bereiche

Der gepruefte Bereich enthaelt:

- `updateRegionParentFilter(...)`
- `loadPoliticalTerritoryWikiReferences()`
- `loadPoliticalTerritoryWikiReferenceFallback()`
- `normalizeStaticWikiReferenceRecord(...)`
- `getStaticWikiReferenceValue(...)`
- `openRegionWikiPickerDialog()`
- `renderRegionWikiPickerList(...)`
- `getWikiReferenceSearchText(...)`
- `applyRegionWikiReferenceSelection(...)`
- `buildRegionEditPayload(...)`

Davon gehoert `updateRegionParentFilter(...)` zum Region-Parent-/Tree-Filter und bleibt ausserhalb des Splits.

`buildRegionEditPayload(...)` ist Save-/Submit-Payload-Logik fuer Region/Territory und bleibt ebenfalls ausserhalb des Splits.

Der saubere Split-Kern liegt dazwischen.

## Bewertung des Split-Risikos

### Sicher verschiebbar

Der Region-Wiki-Picker ist relativ kompakt und sinnvoll als eigene Datei:

- er laedt Wiki-Referenzen,
- normalisiert Fallback-Daten,
- rendert die Picker-Liste,
- sucht/filtert Referenzen,
- uebernimmt eine ausgewaehlte Referenz in das Region-Edit-Formular.

Die Funktionen greifen zwar auf globale Region-State-/DOM-Funktionen zu (`regionEditEntry`, `politicalTerritoryWikiReferences`, `setRegionWikiPickerDialogOpen`, `renderRegionWikiReference`, `syncRegionCoatPreview`, `buildWikiReferencePeriod`, `normalizeSearchText`, `normalizeParentheticalSpacing`), fuehren aber keine Top-Level-Aktionen aus. Das passt zum bestehenden klassischen Script-Modell.

### Nicht im selben Schritt verschieben

Nicht Teil dieses Splits:

- `updateRegionParentFilter(...)`
- `buildRegionEditPayload(...)`
- Region-Parent-/Tree-Handling
- Region-Assignment-Breadcrumbs
- Region-Tab-Handling
- Region-Submit-Handler
- Political-Territory-Save-/Reload-Logik
- Event-Bindings fuer Region-Drag/Drop/Click
- API-/PHP-/SQL-Dateien

## Empfohlener Split

Dateiname:

- `js/dialogs-review-region-wiki-picker.js`

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
10. `js/review/review-region-util.js`

Begruendung: Der Picker verwendet Core-/Status-/Region-Helfer aus dem bestehenden globalen Kontext und muss vor dem Rest-Orchestrator geladen werden, damit Event-Bindings/Submit-Flows dort weiterhin auf globale Funktionsnamen zugreifen koennen.

## Exakter zulaessiger Funktionsumfang fuer den ersten Region-Wiki-Picker-Split

Verschiebe ausschliesslich diese Funktionen:

- `loadPoliticalTerritoryWikiReferences`
- `loadPoliticalTerritoryWikiReferenceFallback`
- `normalizeStaticWikiReferenceRecord`
- `getStaticWikiReferenceValue`
- `openRegionWikiPickerDialog`
- `renderRegionWikiPickerList`
- `getWikiReferenceSearchText`
- `applyRegionWikiReferenceSelection`

Diese Liste ist absichtlich streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Region/Herrschaftsgebiet-Dialog fuer einen sicheren Testeintrag oeffnen.
4. Wiki-Referenz-Picker oeffnen.
5. Liste laedt oder zeigt eine nachvollziehbare Fehlermeldung.
6. Filter testen.
7. Eine sichere Wiki-Referenz auswaehlen, falls Testdaten vorhanden sind.
8. Pruefen, dass Wiki-URL, Wappen-URL und Typ-Feld wie bisher uebernommen werden.
9. Picker schliessen und Region-Dialog schliessen, ohne produktiv zu speichern, ausser bewusst mit Testdaten.
10. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches.

Zuerst aktuellen Stand holen:
git checkout master
git pull --ff-only origin master

Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split des Region-Wiki-Picker-Clusters aus js/review/review-region-util.js in eine neue Datei js/dialogs-review-region-wiki-picker.js.

Erlaubte Änderungen:
- js/review/review-region-util.js
- neue Datei js/dialogs-review-region-wiki-picker.js
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
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich diese Funktionen aus js/review/review-region-util.js nach js/dialogs-review-region-wiki-picker.js, unverändert und in sinnvoller Reihenfolge:
- loadPoliticalTerritoryWikiReferences
- loadPoliticalTerritoryWikiReferenceFallback
- normalizeStaticWikiReferenceRecord
- getStaticWikiReferenceValue
- openRegionWikiPickerDialog
- renderRegionWikiPickerList
- getWikiReferenceSearchText
- applyRegionWikiReferenceSelection

Nicht verschieben:
- updateRegionParentFilter
- buildRegionEditPayload
- Region-Parent-/Tree-Handling
- Region-Assignment-Breadcrumbs
- Region-Tab-Handling
- Region-Submit-Handler
- Political-Territory-Save-/Reload-Logik
- Event-Bindings fuer Region-Drag/Drop/Click

Falls beim Verschieben weitere Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/dialogs-review-region-wiki-picker.js:
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
  10. js/review/review-region-util.js

docs/refactoring-status.md:
- WikiSync-Smoke als bestanden markieren
- neuen stabilen Split js/dialogs-review-region-wiki-picker.js dokumentieren
- Smoke-Test-Empfehlung Region-Wiki-Picker ergänzen
- klar festhalten, dass Region/Territory-Parent/Assignment/Submit nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach fehlenden Referenzen/Typo bei js/dialogs-review-region-wiki-picker.js in index.html.
- Syntaxprüfung:
  - node --check js/dialogs-review-region-wiki-picker.js
  - node --check js/review/review-region-util.js

Danach:
- git status zeigen
- git add index.html js/review/review-region-util.js js/dialogs-review-region-wiki-picker.js docs/refactoring-status.md
- git commit -m "Split dialog review region Wiki picker helpers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. Region/Herrschaftsgebiet-Dialog fuer sicheren Testeintrag öffnen.
3. Wiki-Referenz-Picker öffnen.
4. Liste/Fehlermeldung prüfen, Filter testen.
5. Sichere Referenz auswählen, falls Testdaten vorhanden sind.
6. Übernahme von Wiki-URL, Wappen-URL und Typ-Feld prüfen.
7. Dialog ohne produktives Speichern schließen, außer bewusst mit Testdaten.
8. Konsole erneut prüfen.
```

## Ergebnis

Region-Wiki-Picker ist als naechster Split geeignet. Der gesamte Region/Territory-Cluster bleibt zu gross fuer einen unmittelbaren Split und braucht danach eine eigene, separate Boundary-Analyse.