# Dialogs Review Region Assignment State Split Boundary Check

## Ausgangspunkt

Nach dem bestaetigten Region-Parent-Tree-Split ist `js/dialogs-review.js` weiter Rest-Orchestrator fuer Region-/Territory-Assignment/Tabs/Submit-Flows.

Der verbleibende Bereich ist nicht als ein einziger Block sicher zu verschieben, weil Assignment, Tabs, Parent-Drop-Event-Bindings, Region-Submit und Dialog-Population stark ineinandergreifen.

Der naechste sichere Kandidat ist deshalb bewusst kleiner: Region-Assignment-State und Breadcrumb-Cache-Helfer. Diese Funktionen liegen direkt nach `normalizeParentheticalSpacing(...)` und vor `getRegionEditTabKey(...)`.

## Gelesene Bereiche

Der gepruefte Anfang des aktuellen Rest-Orchestrators zeigt nach den Normalisierern:

- `const regionAssignmentPersistedLoadPromises = new Map();`
- `normalizePoliticalTerritoryAssignmentState(...)`
- `applyPersistedRegionAssignmentChain(...)`
- `loadPersistedRegionAssignment(...)`
- `storeRegionAssignmentBreadcrumbCache(...)`
- `storeRegionAssignmentBreadcrumbCaches(...)`
- `updateRegionAssignmentBreadcrumbChain(...)`
- `restoreRegionAssignmentBreadcrumbCache(...)`

Danach beginnt mit `getRegionEditTabKey(...)`, `initializeRegionEditTabs(...)`, `renderRegionEditTabs(...)` usw. die Tab-/Edit-State-Zone. Spaeter folgen Parent-Drop-/Assignment-Event-Bindings, `populateRegionEditForm(...)`, `openRegionEditDialog(...)` und Submit-/Save-Logik.

## Bewertung des Split-Risikos

### Sicher verschiebbar

Die Assignment-State-Helfer sind als eigene Datei geeignet:

- Sie normalisieren Assignment-Ketten.
- Sie verwalten Breadcrumb-Caches.
- Sie laden persistierte Assignment-Ketten.
- Sie patchen gecachte Assignment-Ketten nach Saves.

Sie sind keine Event-Bindings und enthalten keine unmittelbare Top-Level-DOM-Aktion.

Der Top-Level-Cache `regionAssignmentPersistedLoadPromises` kann in diesem Split entweder in `js/dialogs-review.js` bleiben oder mitverschoben werden. Empfehlung: mitverschieben, weil er fachlich nur zu `loadPersistedRegionAssignment(...)` gehoert. Das ist eine Top-Level-Initialisierung, aber keine DOM-/API-Ausfuehrung und entspricht einem lokalen Modul-State im klassischen Script-Modell.

### Nicht im selben Schritt verschieben

Nicht Teil dieses Splits:

- `getRegionEditTabKey`
- `initializeRegionEditTabs`
- `getPrimaryRegionGeometryPublicId`
- `renderRegionEditTabs`
- `findRegionEditTab`
- `findPoliticalTerritoryOption`
- `updateRegionParentDropTarget`
- `findPoliticalTerritoryTreePath`
- `applyPoliticalTerritoryDraftPatch`
- `syncRegionAssignmentFormZoomInputs`
- `syncRegionAssignmentFormFieldValues`
- `syncRegionAssignmentBreadcrumbZoomLabel`
- `syncRegionAssignmentBreadcrumbName`
- `updatePoliticalTerritoryDraftZoom`
- `renderRegionAssignment`
- `renderRegionAssignmentSummary`
- `populateRegionEditForm`
- `openRegionEditDialog`
- `buildRegionEditPayload`
- `saveRegionEditTab`
- Region-Submit-Handler
- alle Event-Bindings
- API-/PHP-/SQL-Dateien

## Empfohlener Split

Dateiname:

- `js/review/review-region-assignment-state.js`

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
13. `js/dialogs-review.js`

Begruendung: Die State-/Cache-Helfer werden von Rest-Orchestrator, Tab-/Save-Logik und Assignment-UI zur Laufzeit referenziert. Sie muessen vor `dialogs-review.js` geladen werden.

## Exakter zulaessiger Funktionsumfang fuer den ersten Region-Assignment-State-Split

Verschiebe ausschliesslich diese Konstante und Funktionen:

- `regionAssignmentPersistedLoadPromises`
- `normalizePoliticalTerritoryAssignmentState`
- `applyPersistedRegionAssignmentChain`
- `loadPersistedRegionAssignment`
- `storeRegionAssignmentBreadcrumbCache`
- `storeRegionAssignmentBreadcrumbCaches`
- `updateRegionAssignmentBreadcrumbChain`
- `restoreRegionAssignmentBreadcrumbCache`

Diese Liste ist streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Region/Herrschaftsgebiet-Dialog fuer sicheren Testeintrag oeffnen.
4. Assignment-/Breadcrumb-Anzeige pruefen, falls Daten vorhanden sind.
5. Persistierte Zuweisung laden lassen, falls Testdaten vorhanden sind.
6. Einen sicheren Assignment-/Parent-Fall oeffnen und wieder schliessen.
7. Falls Testdaten vorhanden: Speichern mit Testregion pruefen, damit Breadcrumb-Cache-Patching nach Save ausgefuehrt wird.
8. Zwischen vorhandenen Tabs wechseln, falls mehrere Tabs entstehen.
9. Dialog ohne weitere produktive Aenderung schliessen.
10. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches.

Zuerst aktuellen Stand holen:
git checkout master
git pull --ff-only origin master

Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split der Region-Assignment-State-/Breadcrumb-Cache-Helfer aus js/dialogs-review.js in eine neue Datei js/review/review-region-assignment-state.js.

Erlaubte Änderungen:
- js/dialogs-review.js
- neue Datei js/review/review-region-assignment-state.js
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
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich diese Konstante und Funktionen aus js/dialogs-review.js nach js/review/review-region-assignment-state.js, unverändert und in sinnvoller Reihenfolge:
- const regionAssignmentPersistedLoadPromises = new Map();
- normalizePoliticalTerritoryAssignmentState
- applyPersistedRegionAssignmentChain
- loadPersistedRegionAssignment
- storeRegionAssignmentBreadcrumbCache
- storeRegionAssignmentBreadcrumbCaches
- updateRegionAssignmentBreadcrumbChain
- restoreRegionAssignmentBreadcrumbCache

Nicht verschieben:
- getRegionEditTabKey
- initializeRegionEditTabs
- getPrimaryRegionGeometryPublicId
- renderRegionEditTabs
- findRegionEditTab
- findPoliticalTerritoryOption
- updateRegionParentDropTarget
- findPoliticalTerritoryTreePath
- applyPoliticalTerritoryDraftPatch
- syncRegionAssignmentFormZoomInputs
- syncRegionAssignmentFormFieldValues
- syncRegionAssignmentBreadcrumbZoomLabel
- syncRegionAssignmentBreadcrumbName
- updatePoliticalTerritoryDraftZoom
- renderRegionAssignment
- renderRegionAssignmentSummary
- populateRegionEditForm
- openRegionEditDialog
- buildRegionEditPayload
- saveRegionEditTab
- Region-Submit-Handler
- Event-Bindings

Falls beim Verschieben weitere Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/review/review-region-assignment-state.js:
- enthält nur die genannte Konstante und Funktionsdefinitionen
- keine DOM-Reads/Writes außerhalb von Funktionen
- keine Event-Bindings
- keine API-Aufrufe außerhalb von Funktionen
- keine neuen globalen Namen außer der verschobenen bestehenden Konstante und den verschobenen bestehenden Funktionsnamen
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
  13. js/dialogs-review.js

docs/refactoring-status.md:
- Region-Parent-Tree-Smoke als bestanden markieren
- neuen stabilen Split js/review/review-region-assignment-state.js dokumentieren
- Smoke-Test-Empfehlung Region-Assignment-State ergänzen
- klar festhalten, dass Assignment-UI, Tabs, Submit und Event-Bindings nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach doppelter Definition von regionAssignmentPersistedLoadPromises.
- Suche nach fehlenden Referenzen/Typo bei js/review/review-region-assignment-state.js in index.html.
- Syntaxprüfung:
  - node --check js/review/review-region-assignment-state.js
  - node --check js/dialogs-review.js

Danach:
- git status zeigen
- git add index.html js/dialogs-review.js js/review/review-region-assignment-state.js docs/refactoring-status.md
- git commit -m "Split dialog review region assignment state helpers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. Region/Herrschaftsgebiet-Dialog für sicheren Testeintrag öffnen.
3. Assignment-/Breadcrumb-Anzeige prüfen, falls Daten vorhanden sind.
4. Persistierte Zuweisung laden lassen, falls Testdaten vorhanden sind.
5. Mit Testregion speichern, falls sicher möglich.
6. Zwischen vorhandenen Tabs wechseln, falls mehrere Tabs entstehen.
7. Dialog schließen.
8. Konsole erneut prüfen.
```

## Ergebnis

Region-Assignment-State ist als naechster Split geeignet. Assignment-UI, Tabs, Submit und Event-Bindings bleiben unangetastet und brauchen danach eigene Boundary-Analysen.