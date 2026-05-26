# Dialogs Review Region Tabs Payload Split Boundary Check

## Ausgangspunkt

Nach dem bestaetigten Region-Assignment-UI-Split ist `js/review/review-region-util.js` weiter Rest-Orchestrator fuer Region-/Territory-Tabs, Submit-Flows, Dialog-Population, Event-Bindings und verbleibende Hilfsfunktionen.

Der naechste sichere Kandidat ist ein enger Region-Tabs-/Payload-State-Split. Der eigentliche Save-/Submit-Flow bleibt bewusst in `js/review/review-region-util.js`, weil er API-Aufrufe, Feature-Response-Anwendung, Layer-Reloads und Dialog-Repopulation verbindet.

## Gelesene Bereiche

Der aktuelle Rest-Orchestrator enthaelt nach den Normalisierern:

- Tab-Key, Tab-Initialisierung, Tab-Rendering und Tab-Suche
- Snapshot des aktiven Tabs aus dem Formular
- Konvertierung zwischen Region-Objekt und Region-Payload
- Vergleich/Dirty-State fuer Tabs
- Ermittlung einer aktiven Geometrie-Zuweisung
- danach `saveRegionEditTab(...)`, `normalizePoliticalTerritoryForRegionEdit(...)`, Tab-Ladefunktionen, Confirm-Dialog, Event-Bindings, Dialog-Population und Submit-Logik

## Bewertung des Split-Risikos

### Sicher verschiebbar

Der Tab-/Payload-State-Block ist geeignet, wenn `saveRegionEditTab(...)` nicht mitgenommen wird. Die verschiebbaren Funktionen sind normale globale Funktionsdefinitionen. Sie enthalten keine Top-Level-Ausfuehrung und keine jQuery-Event-Bindings.

### Nicht im selben Schritt verschieben

Nicht Teil dieses Splits:

- `saveRegionEditTab`
- `normalizePoliticalTerritoryForRegionEdit`
- `openRegionEditTabForTerritory`
- `activatePrimaryRegionEditTabForTerritory`
- `askRegionTabCloseChoice`
- `populateRegionEditForm`
- `openRegionEditDialog`
- `buildRegionEditPayload`
- alle jQuery-Event-Bindings
- Region-Submit-Handler
- API-/PHP-/SQL-Dateien

## Empfohlener Split

Dateiname:

- `js/dialogs-review-region-tabs-payload.js`

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
15. `js/review/review-region-util.js`

Begruendung: Tab-/Payload-Helfer werden von Rest-Orchestrator, Save-Flow und Event-Bindings zur Laufzeit referenziert. Die Datei muss vor `dialogs-review.js` geladen werden.

## Exakter zulaessiger Funktionsumfang fuer den Region-Tabs-Payload-Split

Verschiebe ausschliesslich diese Funktionen:

- `getRegionEditTabKey`
- `initializeRegionEditTabs`
- `getPrimaryRegionGeometryPublicId`
- `renderRegionEditTabs`
- `findRegionEditTab`
- `snapshotActiveRegionEditTab`
- `regionEditPayloadToRegion`
- `regionEditPayloadToPayload`
- `getComparableRegionEditPayload`
- `areRegionEditPayloadsEqual`
- `isRegionEditTabDirty`
- `getActiveRegionGeometryAssignment`

Diese Liste ist streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Region/Herrschaftsgebiet-Dialog fuer sicheren Testeintrag oeffnen.
4. Tab-Anzeige pruefen.
5. Assignment/Breadcrumb anklicken, falls dadurch ein zweiter Tab entsteht.
6. Zwischen Tabs wechseln.
7. In einem Tab ein Feld aendern, dann Tab wechseln und zurueckwechseln; Payload/Snapshot muss erhalten bleiben.
8. Tab schliessen; Dirty-Confirm pruefen, falls ungespeicherte Aenderungen vorhanden sind.
9. Mit Testregion speichern, falls sicher moeglich.
10. Dialog schliessen und erneut oeffnen.
11. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches.

Zuerst aktuellen Stand holen:
git checkout master
git pull --ff-only origin master

Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split der Region-Tabs-/Payload-State-Helfer aus js/review/review-region-util.js in eine neue Datei js/dialogs-review-region-tabs-payload.js.

Erlaubte Änderungen:
- js/review/review-region-util.js
- neue Datei js/dialogs-review-region-tabs-payload.js
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
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich diese Funktionen aus js/review/review-region-util.js nach js/dialogs-review-region-tabs-payload.js, unverändert und in sinnvoller Reihenfolge:
- getRegionEditTabKey
- initializeRegionEditTabs
- getPrimaryRegionGeometryPublicId
- renderRegionEditTabs
- findRegionEditTab
- snapshotActiveRegionEditTab
- regionEditPayloadToRegion
- regionEditPayloadToPayload
- getComparableRegionEditPayload
- areRegionEditPayloadsEqual
- isRegionEditTabDirty
- getActiveRegionGeometryAssignment

Nicht verschieben:
- saveRegionEditTab
- normalizePoliticalTerritoryForRegionEdit
- openRegionEditTabForTerritory
- activatePrimaryRegionEditTabForTerritory
- askRegionTabCloseChoice
- populateRegionEditForm
- openRegionEditDialog
- buildRegionEditPayload
- alle jQuery-Event-Bindings
- Region-Submit-Handler

Falls beim Verschieben weitere Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/dialogs-review-region-tabs-payload.js:
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
  15. js/review/review-region-util.js

docs/refactoring-status.md:
- Region-Assignment-UI-Smoke als bestanden markieren
- neuen stabilen Split js/dialogs-review-region-tabs-payload.js dokumentieren
- Smoke-Test-Empfehlung Region-Tabs-Payload ergänzen
- klar festhalten, dass Save/Submit, Dialog-Population und Event-Bindings nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach fehlenden Referenzen/Typo bei js/dialogs-review-region-tabs-payload.js in index.html.
- Syntaxprüfung:
  - node --check js/dialogs-review-region-tabs-payload.js
  - node --check js/review/review-region-util.js

Danach:
- git status zeigen
- git add index.html js/review/review-region-util.js js/dialogs-review-region-tabs-payload.js docs/refactoring-status.md
- git commit -m "Split dialog review region tabs payload helpers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. Region/Herrschaftsgebiet-Dialog für sicheren Testeintrag öffnen.
3. Tab-Anzeige und Tab-Wechsel prüfen.
4. Feld ändern, Tab wechseln und zurückwechseln; Snapshot/Payload prüfen.
5. Tab schließen und Dirty-Confirm prüfen, falls möglich.
6. Mit Testregion speichern, falls sicher möglich.
7. Dialog schließen und erneut öffnen.
8. Konsole erneut prüfen.
```

## Ergebnis

Region-Tabs/Payload-State ist als naechster Split geeignet. Save/Submit, Dialog-Population und Event-Bindings bleiben unangetastet und brauchen danach eigene Boundary-Analysen.