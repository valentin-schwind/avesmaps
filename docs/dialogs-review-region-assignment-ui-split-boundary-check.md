# Dialogs Review Region Assignment UI Split Boundary Check

## Ausgangspunkt

Nach dem bestaetigten Region-Assignment-State-Split ist `js/dialogs-review.js` weiter Rest-Orchestrator fuer Region-/Territory-Assignment-UI, Tabs, Submit-Flows, Event-Bindings und verbleibende Hilfsfunktionen.

Der naechste sichere Kandidat ist der Region-Assignment-UI-/Operations-Block. Dieser Split bleibt bewusst enger als der gesamte verbleibende Region/Territory-Bereich: Tab-Funktionen, Save-/Submit-Logik, Dialog-Population und Event-Bindings bleiben in `js/dialogs-review.js`.

## Gelesene Bereiche

Der aktuelle Rest-Orchestrator beginnt nach den Normalisierern mit Tab-Funktionen und danach mit Assignment-/Parent-Drop-/Breadcrumb-/Summary-Helfern. Der relevante UI-/Operations-Block umfasst:

- Parent-Drop-Ziel und Territory-Option-Lookup
- Assignment-Pfadfindung und Draft-Patching
- Assignment-Form-Sync und Breadcrumb-Anzeige
- Assignment-Rendering und Summary-Rendering
- Assignment-Pfadvergleich und Sync fuer aktuell geoeffnete Region
- Wiki-Chain-Erzeugung und Zuweisungsoperationen
- Freigeben einer Geometrie von einem Herrschaftsgebiet

Der Bereich geht bis `clearRegionGeometryAssignment(...)`. Direkt danach beginnt mit `snapshotActiveRegionEditTab(...)` und Payload-/Dirty-/Save-Funktionen die Tab-/Payload-/Submit-Zone.

## Bewertung des Split-Risikos

### Sicher verschiebbar

Die Assignment-UI-/Operations-Helfer sind als eigene Datei geeignet, sofern keine Event-Bindings und keine Tab-/Submit-Funktionen mitgenommen werden. Sie werden von Event-Bindings und Tab-/Save-Logik nur aufgerufen, bleiben aber selbst normale globale Funktionsdefinitionen.

Einige dieser Funktionen rufen API-/Submit-Funktionen innerhalb von Funktionen auf. Das ist in Ordnung, weil keine API-Aufrufe auf Top-Level erfolgen.

### Nicht im selben Schritt verschieben

Nicht Teil dieses Splits:

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

- `js/review/review-region-assignment-ui.js`

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
14. `js/dialogs-review.js`

Begruendung: Assignment-UI wird von Rest-Orchestrator, Event-Bindings und Tab-/Save-Logik zur Laufzeit referenziert. Die Datei muss vor `dialogs-review.js` geladen werden.

## Exakter zulaessiger Funktionsumfang fuer den ersten Region-Assignment-UI-Split

Verschiebe ausschliesslich diese Funktionen:

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
- `arePoliticalTerritoryPathsEqual`
- `syncRegionAssignmentForRegion`
- `ensurePoliticalTerritoryChainFromWikiPath`
- `assignRegionGeometryToWikiTreeLeaf`
- `openRegionVisualTabFromBreadcrumb`
- `buildUnassignedPoliticalRegionDraft`
- `setPrimaryRegionEditTabToUnassignedGeometry`
- `clearRegionGeometryAssignment`

Diese Liste ist streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Region/Herrschaftsgebiet-Dialog fuer sicheren Testeintrag oeffnen.
4. Assignment-/Breadcrumb-Anzeige pruefen.
5. Breadcrumb anklicken und visuellen Tab/Fokus pruefen, falls moeglich.
6. Assignment-Summary-Felder testen: Zoom, Farbe, Transparenz, Anzeigename, Wappen-Link, Von/Bis/Heute.
7. Parent-Drop-Ziel pruefen, falls sicher moeglich.
8. Leaf-Zuweisung auf Assignment-Drop-Ziel mit Testdaten pruefen, falls sicher moeglich.
9. Geometrie freigeben nur mit sicherer Testregion pruefen.
10. Speichern mit Testdaten pruefen, falls sicher moeglich.
11. Dialog schliessen und erneut oeffnen.
12. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches.

Zuerst aktuellen Stand holen:
git checkout master
git pull --ff-only origin master

Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split der Region-Assignment-UI-/Operations-Helfer aus js/dialogs-review.js in eine neue Datei js/review/review-region-assignment-ui.js.

Erlaubte Änderungen:
- js/dialogs-review.js
- neue Datei js/review/review-region-assignment-ui.js
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
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich diese Funktionen aus js/dialogs-review.js nach js/review/review-region-assignment-ui.js, unverändert und in sinnvoller Reihenfolge:
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
- arePoliticalTerritoryPathsEqual
- syncRegionAssignmentForRegion
- ensurePoliticalTerritoryChainFromWikiPath
- assignRegionGeometryToWikiTreeLeaf
- openRegionVisualTabFromBreadcrumb
- buildUnassignedPoliticalRegionDraft
- setPrimaryRegionEditTabToUnassignedGeometry
- clearRegionGeometryAssignment

Nicht verschieben:
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

Neue Datei js/review/review-region-assignment-ui.js:
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
  14. js/dialogs-review.js

docs/refactoring-status.md:
- Region-Assignment-State-Smoke als bestanden markieren
- neuen stabilen Split js/review/review-region-assignment-ui.js dokumentieren
- Smoke-Test-Empfehlung Region-Assignment-UI ergänzen
- klar festhalten, dass Tabs, Submit und Event-Bindings nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach fehlenden Referenzen/Typo bei js/review/review-region-assignment-ui.js in index.html.
- Syntaxprüfung:
  - node --check js/review/review-region-assignment-ui.js
  - node --check js/dialogs-review.js

Danach:
- git status zeigen
- git add index.html js/dialogs-review.js js/review/review-region-assignment-ui.js docs/refactoring-status.md
- git commit -m "Split dialog review region assignment UI helpers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. Region/Herrschaftsgebiet-Dialog für sicheren Testeintrag öffnen.
3. Assignment-/Breadcrumb-Anzeige und Summary-Felder prüfen.
4. Breadcrumb-Klick und Parent-/Assignment-Drop mit Testdaten prüfen, falls sicher möglich.
5. Geometrie freigeben und Speichern nur mit sicherer Testregion prüfen.
6. Dialog schließen und erneut öffnen.
7. Konsole erneut prüfen.
```

## Ergebnis

Region-Assignment-UI ist als naechster Split geeignet. Tabs, Submit und Event-Bindings bleiben unangetastet und brauchen danach eigene Boundary-Analysen.