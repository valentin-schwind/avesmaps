# Dialogs Review Region Parent Tree Split Boundary Check

## Ausgangspunkt

Nach dem bestaetigten Region-Basics-Split ist `js/review/review-region-util.js` weiter Rest-Orchestrator fuer Region-/Territory-Parent/Assignment/Tabs/Submit-Flows.

Der naechste sinnvolle enge Kandidat ist der Region-Parent-Tree-/Region-Anzeige-Helferblock direkt nach `normalizeParentheticalSpacing(...)` und vor `const regionAssignmentPersistedLoadPromises = new Map();`.

Dieser Bereich ist groesser als die bisherigen Basics, aber noch klarer abgrenzbar als Assignment/Tabs/Submit.

## Gelesene Bereiche

Der gepruefte Bereich enthaelt vor allem:

- Parent-Tree-Aufbau und Rendering
- Parent-Tree-Deduplizierung und Gruppenknoten-Auswahl
- Parent-Tree-Suche, Display-Namen, Zoom-/Periodenformatierung
- Region-Wiki-Reference-Rendering im Region-Dialog
- kleine Clone-/Zoom-Helfer, die vor allem von Parent-/Assignment-UI genutzt werden

Der Assignment-Block beginnt danach mit:

- `const regionAssignmentPersistedLoadPromises = new Map();`
- `normalizePoliticalTerritoryAssignmentState(...)`
- `applyPersistedRegionAssignmentChain(...)`
- weiteren Assignment-/Breadcrumb-/Draft-/Tab-Funktionen

## Bewertung des Split-Risikos

### Sicher verschiebbar

Der Parent-Tree-/Display-Helferblock ist als eigene Datei sinnvoll, solange Event-Bindings, Assignment, Tabs und Submit nicht mitgenommen werden.

Die Funktionen sind globale Funktionsdefinitionen ohne Top-Level-DOM-Aktionen. Die einzige Top-Level-Konstante in diesem Bereich ist bereits am Dateianfang `POLITICAL_TERRITORY_DISPLAY_SUFFIXES`; sie bleibt vorerst in `js/review/review-region-util.js`, weil ein Konstanten-Umzug kein noetiger Teil dieses Splits ist.

### Nicht im selben Schritt verschieben

Nicht Teil dieses Splits:

- `normalizeSearchText`
- `normalizeParentheticalSpacing`
- `POLITICAL_TERRITORY_DISPLAY_SUFFIXES`
- `regionAssignmentPersistedLoadPromises`
- alle Funktionen ab `normalizePoliticalTerritoryAssignmentState(...)`
- Assignment-/Breadcrumb-/Draft-Funktionen
- Region-Tabs
- `populateRegionEditForm`
- `openRegionEditDialog`
- `buildRegionEditPayload`
- Submit-Handler
- alle Event-Bindings
- API-/PHP-/SQL-Dateien

## Empfohlener Split

Dateiname:

- `js/dialogs-review-region-parent-tree.js`

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
12. `js/review/review-region-util.js`

Begruendung: Parent-Tree-Helfer werden von Region-Basics und Rest-Orchestrator zur Laufzeit referenziert. Die Datei muss vor `dialogs-review.js` geladen werden.

## Exakter zulaessiger Funktionsumfang fuer den ersten Region-Parent-Tree-Split

Verschiebe ausschliesslich diese Funktionen:

- `populateRegionParentSelect`
- `buildPoliticalTerritoryTree`
- `prunePoliticalTerritoryTreeDuplicatesGlobally`
- `dedupePoliticalTerritoryTreeNodes`
- `dedupePoliticalTerritoryTreeNode`
- `buildPoliticalTerritoryTreeDedupeKey`
- `scorePoliticalTerritoryTreeNode`
- `mergePoliticalTerritoryTreeDuplicateTerritory`
- `clonePoliticalTerritoryHierarchyNode`
- `hasPoliticalTerritoryTreeDisplayDetails`
- `mergePoliticalTerritoryTreeGroupNode`
- `findRepresentativePoliticalTerritoryNode`
- `renderPoliticalTerritoryTreeNode`
- `isPoliticalTerritoryTreeNodeCollapsed`
- `doesPoliticalTerritoryTreeNodeMatchFilter`
- `getPoliticalTerritoryTreeSearchText`
- `createRegionParentTreeButton`
- `formatPoliticalTerritoryDisplayBaseName`
- `escapeRegExp`
- `formatPoliticalTerritoryTreeDisplayName`
- `renderRegionWikiReference`
- `buildWikiReferencePeriod`
- `formatPoliticalTerritoryZoomRange`
- `readOptionalPoliticalTerritoryZoomValue`
- `normalizePoliticalTerritoryZoomDraft`
- `clonePoliticalTerritoryPathNode`
- `clonePoliticalTerritoryPath`
- `clonePoliticalTerritoryChain`

Diese Liste ist streng. Wenn beim tatsaechlichen Verschieben weitere Funktionen notwendig erscheinen, soll der Code-Split stoppen und berichten statt den Scope zu erweitern.

## Smoke-Test nach dem Split

Browser-Smoke im Editmode:

1. Seite mit Editmode oeffnen.
2. Konsole pruefen: keine `ReferenceError`, keine Syntaxfehler.
3. Region/Herrschaftsgebiet-Dialog fuer sicheren Testeintrag oeffnen.
4. Parent-Baum wird geladen bzw. zeigt erwartbare Lade-/Leeranzeige.
5. Parent-Filter testen.
6. Knoten auf-/zuklappen.
7. Einen Leaf-Knoten anklicken; Auswahl-/Statusanzeige pruefen.
8. Falls sicher moeglich: Drag eines Leaf-Knotens auf Parent-Drop-Ziel testen, ohne produktiv zu speichern.
9. Wiki-Referenz-Anzeige im Region-Dialog pruefen.
10. Zoom-/Zeitraum-Anzeigen in Baum/Reference/Assignment kurz kontrollieren.
11. Dialog ohne produktives Speichern schliessen, ausser bewusst mit Testdaten.
12. Konsole erneut pruefen.

## Codex-Prompt fuer den naechsten engen Code-Split

```text
Arbeite im Repository https://github.com/valentin-schwind/avesmaps/ direkt auf master. Keine Branches.

Zuerst aktuellen Stand holen:
git checkout master
git pull --ff-only origin master

Keine ES-Module, kein Build-System, kein type="module". Klassische globale Script-Reihenfolge beibehalten.

Ziel: kontrollierter, verhaltensneutraler Split des Region-Parent-Tree-/Region-Anzeige-Helferblocks aus js/review/review-region-util.js in eine neue Datei js/dialogs-review-region-parent-tree.js.

Erlaubte Änderungen:
- js/review/review-region-util.js
- neue Datei js/dialogs-review-region-parent-tree.js
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
- Routing-Dateien
- popups.js
- ui-controls.js
- map-features.js
- API-/PHP-/SQL-Dateien

Verschiebe ausschließlich diese Funktionen aus js/review/review-region-util.js nach js/dialogs-review-region-parent-tree.js, unverändert und in sinnvoller Reihenfolge:
- populateRegionParentSelect
- buildPoliticalTerritoryTree
- prunePoliticalTerritoryTreeDuplicatesGlobally
- dedupePoliticalTerritoryTreeNodes
- dedupePoliticalTerritoryTreeNode
- buildPoliticalTerritoryTreeDedupeKey
- scorePoliticalTerritoryTreeNode
- mergePoliticalTerritoryTreeDuplicateTerritory
- clonePoliticalTerritoryHierarchyNode
- hasPoliticalTerritoryTreeDisplayDetails
- mergePoliticalTerritoryTreeGroupNode
- findRepresentativePoliticalTerritoryNode
- renderPoliticalTerritoryTreeNode
- isPoliticalTerritoryTreeNodeCollapsed
- doesPoliticalTerritoryTreeNodeMatchFilter
- getPoliticalTerritoryTreeSearchText
- createRegionParentTreeButton
- formatPoliticalTerritoryDisplayBaseName
- escapeRegExp
- formatPoliticalTerritoryTreeDisplayName
- renderRegionWikiReference
- buildWikiReferencePeriod
- formatPoliticalTerritoryZoomRange
- readOptionalPoliticalTerritoryZoomValue
- normalizePoliticalTerritoryZoomDraft
- clonePoliticalTerritoryPathNode
- clonePoliticalTerritoryPath
- clonePoliticalTerritoryChain

Nicht verschieben:
- normalizeSearchText
- normalizeParentheticalSpacing
- POLITICAL_TERRITORY_DISPLAY_SUFFIXES
- regionAssignmentPersistedLoadPromises
- alle Funktionen ab normalizePoliticalTerritoryAssignmentState
- Assignment-/Breadcrumb-/Draft-Funktionen
- Region-Tabs
- populateRegionEditForm
- openRegionEditDialog
- buildRegionEditPayload
- Submit-Handler
- Event-Bindings

Falls beim Verschieben weitere Funktionen zwingend mitgenommen werden müssten, stoppe und berichte statt eigenständig den Scope zu erweitern.

Neue Datei js/dialogs-review-region-parent-tree.js:
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
  11. js/dialogs-review-region-parent-tree.js
  12. js/review/review-region-util.js

docs/refactoring-status.md:
- Region-Basics-Smoke als bestanden markieren
- neuen stabilen Split js/dialogs-review-region-parent-tree.js dokumentieren
- Smoke-Test-Empfehlung Region-Parent-Tree ergänzen
- klar festhalten, dass Assignment/Tabs/Submit/Event-Bindings nicht Teil dieses Splits waren

Checks lokal ausführen:
- Suche nach doppelten Funktionsdefinitionen der verschobenen Funktionen.
- Suche nach fehlenden Referenzen/Typo bei js/dialogs-review-region-parent-tree.js in index.html.
- Syntaxprüfung:
  - node --check js/dialogs-review-region-parent-tree.js
  - node --check js/review/review-region-util.js

Danach:
- git status zeigen
- git add index.html js/review/review-region-util.js js/dialogs-review-region-parent-tree.js docs/refactoring-status.md
- git commit -m "Split dialog review region parent tree helpers"
- git push

Smoke-Test, den ich danach im Browser mache:
1. Editmode öffnen, Konsole prüfen.
2. Region/Herrschaftsgebiet-Dialog für sicheren Testeintrag öffnen.
3. Parent-Baum, Filter, Auf-/Zuklappen und Leaf-Auswahl prüfen.
4. Falls sicher möglich: Leaf-Drag auf Parent-Drop-Ziel testen, ohne produktiv zu speichern.
5. Wiki-Referenz-, Zoom- und Zeitraum-Anzeigen kurz prüfen.
6. Dialog ohne produktives Speichern schließen, außer bewusst mit Testdaten.
7. Konsole erneut prüfen.
```

## Ergebnis

Region-Parent-Tree ist als naechster Split geeignet. Assignment, Tabs, Submit und Event-Bindings bleiben unangetastet und brauchen danach eigene Boundary-Analysen.