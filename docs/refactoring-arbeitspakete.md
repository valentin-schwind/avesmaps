# Refactoring-Arbeitspakete

**Was das ist:** das Rückgrat der Routine `avesmaps-refactoring` (Entwurf
`docs/superpowers/specs/2026-09-05-refactoring-routine-v2-design.md`). Jedes Paket ist eine
**Momentaufnahme** gegen `Stand`/`Blob`; die Routine prüft es bei jedem Lauf gegen `origin/master`
nach (`tools/refactoring/frischelauf.mjs`) und zieht nach oder verwirft. Zeilennummern sind
Orientierung, die Identität eines Blocks sind seine Funktionsnamen.

**Zustände:** `offen` · `GO nötig` · `in Arbeit (<datum>)` · `erledigt (<sha>)` · `verworfen (<grund>)`.
Nur der Owner setzt `GO nötig` → `offen` (eine Zeile im Dokument, gepusht). Nur die Routine setzt die
übrigen drei; jede Änderung bekommt eine Zeile unter `Verlauf`.

**Sperre:** steht unter dieser Zeile eine Zeile `Sperre: <datum> <grund>`, analysiert die Routine nur
und pusht nichts.

<!-- Sperre: (zum Sperren die naechste Zeile OHNE Kommentar setzen: `Sperre: 2026-09-05 Grund`) -->

**Verfahren:** A JS-Schnitt (Lauf globaler Funktionen → Geschwisterdatei) · B Inline-Script einer
Editorseite → `js/pages/` · C PHP-Lib per `require_once` an der Blockstelle · D Perf-Umbau mit
Messbeleg (gleiche Ausgabe, weniger Arbeit; die ersten drei mit GO).

**Form eines Pakets** (der Wächter `tools/refactoring/__tests__/arbeitspakete.test.js` hält sie fest):

```
### P-NNN · <pfad der zieldatei> · Verfahren A|B|C|D
- Status: offen
- Stand: <sha auf origin/master> · Blob: <git rev-parse origin/master:<pfad>>
- Block: „<Thema>“ — <erste Funktion> … <letzte Funktion> (<n> Funktionen, ~<zeilen> Zeilen ab Z. <von>)
- Ziel: <pfad der geschwisterdatei>[, Nachsatz]
- Messskript: tools/perf/<paket>.mjs|php          (nur D)
- Vorprüfung (<datum>): Ladezeit-Bezug n · Register n · Quelltext-Tests n · vm-Bindung n · Konstanten n
- Fallen: <was die Vorprüfung NICHT sieht und ein Mensch wissen muss>
- Verlauf: <datum> angelegt (<quelle>)[ · <datum> <ereignis>]
```

---

## Pakete

Stand der Erstfüllung: `1cb5e09bd` (05.09.2026), 30 Pakete. Verworfen/nachgezogen wird im Feld `Verlauf` je Paket, nie durch Löschen.

### P-001 · js/review/review-wiki-sync.js · Verfahren A
- Status: offen
- Stand: 5e8bb1862 · Blob: bdf50debd2a38c1d0bf48614303040a49294a5d9
- Block: „Dump-Bericht-Helfer“ — avesmapsDumpReportInjectStyles … avesmapsDumpReportRunSectionHtml (8 Funktionen, ~282 Zeilen ab Z. 1279)
- Ziel: js/review/review-wiki-sync-dump-report.js, <script> direkt neben dem Original
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 14 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 4044 Zeilen, 174 Commits/180 d · heiß (1 d, wartet auf Abkühlung)
- Fallen: `avesmapsOpenDumpReport` (trägt den `window`-Export) und der Zustand `let avesmapsDumpReportStylesInjected` BLEIBEN in der Originaldatei — der Lauf vom 01.09.2026 scheiterte, weil er den Export mitnahm. `avesmapsDumpReportInjectStyles` schreibt die globale `let`-Variable aus der Geschwisterdatei; das ist über Skriptgrenzen erlaubt (globaler lexikalischer Geltungsbereich klassischer Skripte). `lore-dialog-layout.test.js` lädt die Datei allein in einen vm-Kontext und ruft laut Vorprüfung keinen der acht Namen — nach dem Schnitt trotzdem den Test fahren.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 703656) · 06.09.2026 nachgezogen: `2211f8d3e` hat drei Hunks bei Z. 843/2756/3959 -- alle ausserhalb des Blocks; Block an den Namen unveraendert zusammenhaengend und frei, nur um +5 Zeilen gewandert · 06.09.2026 nachgezogen: `289d0b2a9` haengt acht Zeilen bei Z. 2749 an -- weit ausserhalb des Blocks; Block an den Namen unveraendert zusammenhaengend und frei, Zeilennummer unveraendert · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: 46981a607 („Zuletzt gesynct“ liest ueberall die Serverkarte) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei

### P-002 · js/review/review-wiki-sync.js · Verfahren A
- Status: offen
- Stand: 5e8bb1862 · Blob: bdf50debd2a38c1d0bf48614303040a49294a5d9
- Block: „Sync-Läufe je Objektart und Publikationen“ — setWikiSyncKindStatus … runWikiSyncPublicationsSyncLoop (6 Funktionen, ~281 Zeilen ab Z. 1726)
- Ziel: js/review/review-wiki-sync-kind-loops.js, <script> direkt neben dem Original
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 14 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 4044 Zeilen, 174 Commits/180 d · heiß (1 d, wartet auf Abkühlung)
- Fallen: Mehrere Register-Treffer auf den Zielpfad (die Vorprüfung zählt sie); `tools/paths/test-wiki-sync-panel-tab.mjs` führt die Dateiliste der Reiter-Lader von Hand (Lehre vom 02.09.2026) — steht einer dieser sechs Namen in seiner Lader-Tabelle, gehört die neue Datei in die Liste (eine Zeile, wie das `<script>`-Tag).
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 703656) · 06.09.2026 nachgezogen: `2211f8d3e` hat drei Hunks bei Z. 843/2756/3959 -- alle ausserhalb des Blocks; Block an den Namen unveraendert zusammenhaengend und frei, nur um +5 Zeilen gewandert · 06.09.2026 nachgezogen: `289d0b2a9` haengt acht Zeilen bei Z. 2749 an -- weit ausserhalb des Blocks; Block an den Namen unveraendert zusammenhaengend und frei, Zeilennummer unveraendert · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: 46981a607 („Zuletzt gesynct“ liest ueberall die Serverkarte) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei

### P-003 · api/_internal/app/ecosystem.php · Verfahren C
- Status: offen
- Stand: 59e0aae86 · Blob: 7aa1b061298014a7facfd546ed8936cf73c032c7
- Block: „Klimazonen“ — avesmapsEcosystemClimateZones … avesmapsEcosystemClimateReset (12 Funktionen, ~564 Zeilen ab Z. 5361)
- Ziel: api/_internal/app/ecosystem-klima.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 3 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 5896 Zeilen, 91 Commits/180 d · heiß (1 d, wartet auf Abkühlung)
- Fallen: `climate-insert-zone-test.php` und `climate-rename-test.php` requiren `ecosystem.php` (SQLite, transparent); `climate-membership-test.php` requiret nur `climate-membership.php`. `avesmapsClimateAssertNotDerived` (AGENTS §11: ein Band darf nie als Polygon bearbeitet werden) liegt in `api/_internal/app/climate-zones.php:529`, nicht hier. Kopfkommentar ENGLISCH wie der Dateikopf von `ecosystem.php` (Z. 5–10 nennt die Sprachregel „code/identifiers/messages EN“ ausdrücklich), auch wenn der Rumpf gemischt ist. ⚠️ `avesmapsEcosystemClimateZones` wird aus dem Verlauf-Block (`avesmapsListEcosystemChanges`, Z. 5047) gerufen — die zwei ecosystem.php-Pakete sind gekoppelt, jede Reihenfolge ist zulässig, aber keine Konstellation ohne beide Geschwisterdateien darf getestet werden, die es live nicht gibt.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 536536) · 06.09.2026 nachgezogen: 980bc5b7f hat 12 Kommentarzeilen bei Z. 4762 ergänzt (außerhalb aller drei Blöcke); Block an den Namen unverändert zusammenhängend und frei · 08.09.2026 nachgezogen: 602637b0f (Sprungpunkt der Verlaufszeilen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 nachgezogen: a04ffc929 (die Art Vor-/Mittelgebirge faellt) und c43492837 (die Wiki-Zuweisung einer Flaeche ist sofort sichtbar) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: 93c28d0f8 (Landschaften ohne Beschriftung sind Suchtreffer) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 16.09.2026 nachgezogen: 4609938a7 (Flaeche und Beschriftung tragen denselben Wiki-Artikel) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei

### P-004 · api/_internal/app/ecosystem.php · Verfahren C
- Status: verworfen (Quelltext-Test: landschaft-wiki-schreiber-waechter-test.php liest den Rumpf von avesmapsEcosystemRestoreAuditRow in ecosystem.php)
- Stand: 59e0aae86 · Blob: 7aa1b061298014a7facfd546ed8936cf73c032c7
- Block: „Änderungsverlauf und Rückgängig“ — avesmapsEcosystemCanUndoAction … avesmapsEcosystemRestoreRegionLabel (8 Funktionen, ~411 Zeilen ab Z. 4929)
- Ziel: api/_internal/app/ecosystem-verlauf.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 3 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 5896 Zeilen, 91 Commits/180 d · heiß (1 d, wartet auf Abkühlung)
- Fallen: Zwei Klima-Helfer (`avesmapsEcosystemClimateDividerName`, `…SouthKeyOfAudit`) liegen im Lauf, weil das Rückgängig sie für Audit-Zeilen der Trennlinien braucht — sie gehören zum Verlauf, nicht zum Klima-Paket. Kein Kartenstempel-Bump beim Umzug (nur Ort). ⚠️ Der Block ruft `avesmapsEcosystemClimateZones` (Z. 5047) aus dem Klimazonen-Paket derselben Datei — technisch unschädlich (require_once, Aufruf zur Laufzeit), aber die beiden Pakete sind gekoppelt: nach dem einen Schnitt den anderen im Kopf behalten (Skeptiker 05.09.2026).
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 536536) · 06.09.2026 nachgezogen: 980bc5b7f hat 12 Kommentarzeilen bei Z. 4762 ergänzt (außerhalb aller drei Blöcke); Block an den Namen unverändert zusammenhängend und frei · 08.09.2026 nachgezogen: 602637b0f (Sprungpunkt der Verlaufszeilen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 nachgezogen: a04ffc929 (die Art Vor-/Mittelgebirge faellt) und c43492837 (die Wiki-Zuweisung einer Flaeche ist sofort sichtbar) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: 93c28d0f8 (Landschaften ohne Beschriftung sind Suchtreffer) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 16.09.2026 VERWORFEN: 4609938a7 hat mit api/_internal/app/__tests__/landschaft-wiki-schreiber-waechter-test.php einen Waechter angelegt, der den Quelltext von ecosystem.php liest und im RUMPF von avesmapsEcosystemRestoreAuditRow (Z. 156, 174) zwei Aufrufe verlangt -- die Funktion liegt im Block, nach dem Schnitt stuende sie in der Geschwisterdatei und der Test faende sie nicht. Dieselbe Lage wie P-006: verschiebbar erst, wenn der Waechter die Geschwisterdatei mitliest (Testharnisch, Owner-Sache)

### P-005 · api/_internal/app/ecosystem.php · Verfahren C
- Status: offen
- Stand: 59e0aae86 · Blob: 7aa1b061298014a7facfd546ed8936cf73c032c7
- Block: „Regionen lesen und Wiki-Schlüssel“ — avesmapsEcosystemWikiSlug … avesmapsListEcosystemRegionsByWikiKey (7 Funktionen, ~268 Zeilen ab Z. 2331)
- Ziel: api/_internal/app/ecosystem-regionen.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 3 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 5896 Zeilen, 91 Commits/180 d · heiß (1 d, wartet auf Abkühlung)
- Fallen: Enger als der freie Block: `avesmapsEcosystemApplyRegionFieldOrigins` (curve-label-store-test liest den Quelltext) und `avesmapsAssignEcosystemWikiRegion`/`…AssignIsDryRun` (ecosystem-label-wiki-durchtrag-test) bleiben in `ecosystem.php`. Die Leser hier sind rein.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 536536) · 06.09.2026 nachgezogen: 980bc5b7f hat 12 Kommentarzeilen bei Z. 4762 ergänzt (außerhalb aller drei Blöcke); Block an den Namen unverändert zusammenhängend und frei · 08.09.2026 nachgezogen: 602637b0f (Sprungpunkt der Verlaufszeilen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 nachgezogen: a04ffc929 (die Art Vor-/Mittelgebirge faellt) und c43492837 (die Wiki-Zuweisung einer Flaeche ist sofort sichtbar) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: 93c28d0f8 (Landschaften ohne Beschriftung sind Suchtreffer) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 16.09.2026 nachgezogen: 4609938a7 (Flaeche und Beschriftung tragen denselben Wiki-Artikel) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei

### P-006 · api/_internal/map/features.php · Verfahren C
- Status: verworfen (Quelltext-Test: powerline-anchor-delete-test.php liest den Rumpf von avesmapsUndoAuditChange in features.php)
- Stand: e80b31c62 · Blob: a0ef0a454c312ccffeedfd319f79378321f3b0f1
- Block: „Rückgängig der Audit-Einträge“ — avesmapsFetchTableColumnNames … avesmapsTableExistsForAudit (30 Funktionen, ~553 Zeilen ab Z. 390)
- Ziel: api/_internal/map/features-undo.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 1 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 4277 Zeilen, 68 Commits/180 d · heiß (2 d, wartet auf Abkühlung)
- Fallen: `avesmapsEnsureMapAuditUndoColumns` und `…Einmal` bleiben in `features.php`: `schema-ensure-once-test.php` sucht ihre Signatur dort im Quelltext (`str_contains($libFeatures, "function avesmapsEnsureMapAuditUndoColumnsEinmal(PDO \$pdo): void")`). Der Block beginnt deshalb erst bei `avesmapsFetchTableColumnNames`. Rund 550 Zeilen; Fingerabdruck beachten.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 290836) · 08.09.2026 nachgezogen: 3b6439131 und 179c64277 (Kreuzungstyp) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 3b6439131 (Kreuzungstyp) und 80cb6bbeb (Merker) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 nachgezogen: a04ffc929 (die Art Vor-/Mittelgebirge faellt) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 14.09.2026 gebaut und gemessen, dann zurueckgebaut. Fingerabdruck 580/569 = 11 Zeilen / 1,9 %, block.frei vor und nach dem Schnitt, `php -l` sauber, die 567 Zeilen byte-gleich. Testfeld 545 JS + 412 PHP gegen eine Nulllinie VOR dem Schnitt: neu rot genau ein Test, `api/_internal/map/__tests__/powerline-anchor-delete-test.php:143` („the undo path checks before it deactivates“). Er sucht per `preg_match` das Code-Fragment `$updates['is_active'] ?? 1) === 0) {` + `avesmapsAssertNoPowerlineAnchoredAt` im QUELLTEXT von `features.php` -- und das steht im Rumpf von `avesmapsUndoAuditChange`, mitten im Block (Z. 523-580). Die Vorpruefung sieht Bindungen an NAMEN, nicht an einem Fragment im Rumpf; alle 30 Namen meldeten `gebunden: []`. Struktureller Grund, verfaellt NICHT, solange der Test nur `features.php` liest (der Pfad muesste der Geschwisterdatei folgen -- Testharnisch, Owner-Sache). Agenten nicht gestartet, weil Riegel 3 schon gefallen war. Fuer einen neuen Anlauf: drei Ortsangaben brechen mit dem Schnitt (`lore-rule-store.php:522` verortet `avesmapsFetchFeatureByIdForUpdate` als `features.php:442`; der Kopf von `audit-redo-test.php` und der AGENTS.md-Eintrag „Ein Rueckgaengig muss GENAU die Spalten zurueckschreiben“ nennen `features.php` fuer `avesmapsUndoColumnsForAuditAction`), und `aenderungen-sprungpunkt-karte-test.php:44/47` legt Attrappen zweier Blocknamen unter `function_exists` an, laedt `features.php` aber nicht. ⭐ Der Teilblock HINTER `avesmapsUndoAuditChange` (`avesmapsFetchAuditEntryForUndo` … `avesmapsTableExistsForAudit`, 20 Funktionen, Z. 582-955, ~374 Zeilen) traegt das Fragment nicht und kann im Ueberwachungsmodus ein eigenes Paket werden -- vorher die Muster ALLER Tests, die `features.php` per `file_get_contents` lesen, gegen den Blocktext halten

### P-007 · api/_internal/map/features.php · Verfahren C
- Status: offen
- Stand: fc7a9fb5b · Blob: 3525b471753480c1e0b26799fcf66a2a319a22b8
- Block: „Antwort-Bauer“ — avesmapsBuildPointFeatureResponse … avesmapsBuildRegionFeatureResponse (5 Funktionen, ~115 Zeilen ab Z. 3941)
- Ziel: api/_internal/map/features-response.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 1 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 4277 Zeilen, 68 Commits/180 d · heiß (2 d, wartet auf Abkühlung)
- Fallen: Enger als der freie Block: `avesmapsDecodeJsonColumnForEdit` (kraftlinie-kurve-schreiben-test liest den Quelltext) und `avesmapsUuidV4` (settlement-places-test nennt den Namen; die Funktion ist eine von drei gleichlautenden Fassungen unter drei Namen — features/territory/sync, Doppelungs-Paket) bleiben in `features.php`.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 290836) · 08.09.2026 nachgezogen: 3b6439131 und 179c64277 (Kreuzungstyp) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 3b6439131 (Kreuzungstyp) und 80cb6bbeb (Merker) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 nachgezogen: a04ffc929 (die Art Vor-/Mittelgebirge faellt) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: f28a45a97 (54 tote PHP-Funktionen entfernt) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei; der Boden des Fingerabdrucks (liste.md, Owner-Punkt) gilt weiter · 16.09.2026 nachgezogen: a393adbe9, ca719313d und 59e0aae86 (Wegname an Wiki-Wegen) sowie 4609938a7 haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei; der Boden des Fingerabdrucks (liste.md, Owner-Punkt) gilt weiter · 17.09.2026 nachgezogen: 301e8d771, 936b39b59, 6433bcfd5 und 54bd1aff3 (Audit: Wegegruppen, Saisonweitergabe, Kraftlinien und Wiki-Wege gemeinsam zuruecknehmen) haben die Datei bewegt, keiner der Hunks liegt im Block; Block an den Namen unveraendert zusammenhaengend und frei, jetzt ab Z. 3941. Neues Register der Vorpruefung `js/review/__tests__/label-wiki-override-kette.test.js:144` liest features.php nur fuer die Konstante AVESMAPS_LABEL_WIKI_ORIGIN_FIELDS (ausserhalb). Namens- und Fragmentpruefung gegen alle Tests, die features.php ausserhalb einer require-Zeile nennen: vier Tests rufen Blocknamen zur Laufzeit nach `require` (ort-wiki-no-article-test, weg-merker-reichweite-test, ecosystem-edit-label-region-test, location-type-classifier.test.js), keiner schneidet sie aus dem Text. Der Boden des Fingerabdrucks (liste.md, Owner-Punkt) gilt weiter

### P-008 · api/_internal/app/feature-sources.php · Verfahren C
- Status: offen
- Stand: 166b5a435 · Blob: bec235e62828cd106141aa26f02fa3362cd4a90d
- Block: „Zusammenlegen und Katalogsuche“ — avesmapsMergeWinningLink … avesmapsSearchSourceCatalog (5 Funktionen, ~295 Zeilen ab Z. 2400)
- Ziel: api/_internal/app/feature-sources-katalog.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 2 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 3320 Zeilen, 57 Commits/180 d · heiß (0 d, wartet auf Abkühlung)
- Fallen: `avesmapsMergeSourceInto` trägt 8 Abfragen in Schleifen (Admin-Aktion, selten) — Perf-Geruch, kein Paket. `avesmapsEnsureSourceMergeLog`/`…SearchIndex` sind Ensure-Helfer im Block: Konstanten und Tabellennamen vor der Blockstelle prüfen (Vorprüfung zählt).
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 189240) · 08.09.2026 nachgezogen: sieben Commits des Kanon- und Quellen-Umbaus (651b53f53 bis f87bdccad) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: fuenf Commits des Quellen- und Merker-Umbaus (75cc06da3 bis 80cb6bbeb) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 nachgezogen: 825603242 und cd5dae452 (der Kanon der Landschaftsflaechen) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 14.09.2026 nachgezogen: d683724e4 (schweigt die Landschaftsflaeche, gilt der Artikel ihrer Beschriftung) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei, weiter ab Z. 2400 · 15.09.2026 uebersprungen (nicht abgekuehlt): rangliste.mjs meldete 5 Tage, weil es das AUTORdatum liest (`--pretty=format:@%ad`) -- d683724e4 ist am 10.09. geschrieben, aber erst am 14.09. auf origin gelandet, die Datei ist also seit einem Tag bewegt. Blob unveraendert (gilt); Kandidat fruehestens am 19.09.2026

### P-009 · api/_internal/wiki/settlements.php · Verfahren C
- Status: verworfen (Quelltext-Test: wappen-dritter-zustand-test.php schneidet drei Blockfunktionen aus settlements.php)
- Stand: fc7a9fb5b · Blob: c4d790b3a5734d4766fbbdfdf9dee25bba56bae1
- Block: „Wappen aus dem Wiki“ — avesmapsWikiSettlementCoatStatus … avesmapsWikiSettlementClearCoat (8 Funktionen, ~250 Zeilen ab Z. 414)
- Ziel: api/_internal/wiki/settlements-wappen.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 1997 Zeilen, 67 Commits/180 d · heiß (3 d, wartet auf Abkühlung)
- Fallen: Wappen laufen NUR über `avesmapsResolveGatedCoatUrl` (AGENTS §11, `coat-url.php`) — hier liegt die Wiki-Seite (Status, Bulk-Record, Metadaten), nicht der Riegel. Datei ist heiß (67 Commits); abkühlen lassen.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 133799) · 08.09.2026 nachgezogen: 3650115d0 (Wiki-Abruf wartet nicht auf die Drossel) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: 799c5e44b (Stadtteile ohne Infobox werden Innerorts-Staetten) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 17.09.2026 VERWORFEN, und der Grund stand schon am 05.09. da: `api/_internal/wiki/__tests__/wappen-dritter-zustand-test.php` liest settlements.php per `$lies('api/_internal/wiki/settlements.php')` und schneidet mit `$rumpf(...)` die Ruempfe von avesmapsWikiSettlementClearCoat (Z. 44), …BulkRecordCoats (Z. 53) und …SetWikiCoat (Z. 71) aus dem TEXT; `js/review/__tests__/wappen-box-kartendialog.test.js:272-273` liest die Datei ueber `lies("api", "_internal", "wiki", "settlements.php")` und sucht per Regex `'coat_none' => ($props['coat_none'] ?? false) === true` -- auch das steht im Block. Die Vorpruefung sieht beide nicht, weil der Pfad ueber einen Helfer mit Argumenten zusammengesetzt wird (Owner-Punkt in liste.md). Vorher bewegten b7c9b313d, fa13ae0e7, b1cfeab3c und 69938c629 (Audit-Pakete) die Datei, 69938c629 auch den Rumpf von avesmapsWikiSettlementBulkRecordCoats; der Block stand an den Namen weiter zusammenhaengend ab Z. 484. Struktureller Grund, verfaellt NICHT, solange die beiden Tests nur settlements.php lesen

### P-010 · api/_internal/routing/client-graph.php · Verfahren C
- Status: verworfen (Fingerabdruck: Block zu klein)
- Stand: 1cb5e09bd · Blob: 054b6e83f0bd7625ad2e30941f6d9c8562035c45
- Block: „Verkehrsmittel-Regeln“ — avesmapsNormalizeClientRouteSubtype … avesmapsClientRoutePathAllowedTransports (9 Funktionen, ~108 Zeilen ab Z. 1630)
- Ziel: api/_internal/routing/client-graph-transport.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 1 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 2017 Zeilen, 48 Commits/180 d
- Fallen: AGENTS §11: die Verkehrsmittel-Sperre wird von VIER Erzeugern gefragt (Erzeuger von Querfeldein-Kanten in `client-graph.php` und `offroad-leg.php`; `avesmapsIsClientTransportAllowedForPath` hat hier drei interne Aufrufer, Z. 241/738/833) — der Umzug ändert keinen Aufrufer, und `carriage-offroad-test.php` fährt die Route wirklich. `travel-values.php` liefert das Tempo-Raster. `AVESMAPS_ROUTE_CLIENT_SYNTHETIC_TYPE` steht in `client-graph.php:30` VOR der Blockstelle (die Vorprüfung zählt sie), drei weitere `AVESMAPS_ROUTE_*` in `request.php:27-29`. 🔴 `offroad-leg.php` wird NICHT mitgeschnitten — zwei der vier Erzeuger der Sperre bleiben dort; die neue Datei trägt nur die Regeln, nicht „die Sperre“ (Backend-Agent 05.09.2026).
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 96816) · 06.09.2026 gebaut und GEMESSEN, dann zurueckgebaut: 118 Einfuegungen / 108 Loeschungen = 8,5 % gegen den 5-%-Riegel. Struktureller Grund, verfaellt NICHT: der Overhead einer PHP-Geschwisterdatei ist konstant 9-10 Zeilen (`<?php` + `declare` + 3-Zeilen-Kopf + `require_once`), ein Block unter ~170 Zeilen kann den Riegel also nie bestehen. Am Block selbst war nichts auszusetzen (block.frei, Testfeld unberuehrt, `request-contract-test.php` globbt das Verzeichnis und haette die Geschwisterdatei mitgelesen). 🔧 Owner: entweder den Boden im Riegel anerkennen (dann auch P-007/P-016/P-018 verwerfen) oder den Block mit einem Nachbarblock zusammenlegen.

### P-011 · api/_internal/app/citymaps.php · Verfahren C
- Status: erledigt (d2319175b)
- Stand: 72b14bf8f · Blob: 8d8e8d56fc34b0692b05208ec81f69e3f57475f3
- Block: „Verknüpfungen und Orte einer Karte“ — avesmapsNormalizeCitymapLinkRows … avesmapsSuppressCitymapPlace (9 Funktionen, ~357 Zeilen ab Z. 1632)
- Ziel: api/_internal/app/citymaps-links.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 2317 Zeilen, 35 Commits/180 d · heiß (1 d, wartet auf Abkühlung)
- Fallen: `citymap-delete-parity-test.php` sucht `avesmapsDeleteCitymap*` im Quelltext von `citymaps.php` — der Block endet ausdrücklich VOR `avesmapsDeleteCitymapChildRows`. Die Datei hat schon eine Geschwisterdatei (`citymaps-autoget.php`, 04.09.); Kopfkommentar ENGLISCH wie die Datei.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 81095) · 08.09.2026 nachgezogen: 3b7e1c097 (vier Farbigkeitsstufen einer Karte) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 erledigt als d2319175b: -> api/_internal/app/citymaps-links.php, citymaps.php 2448 -> 2084 Zeilen; neun Funktionen, die 365 verschobenen Zeilen byte-gleich, require_once direkt hinter AVESMAPS_CITYMAP_LINK_LABEL_MAX (die drei gelesenen Konstanten stehen davor). Fingerabdruck 375/365 = 10 Zeilen / 2,7 %. Testfeld 542 JS + 408 PHP; rot nur link-url-test.php (vorbestehend), wiki-konstanten-einmal-test.php (Worktree unter .claude/, im geteilten Checkout gruen) und quellen-abdeckung-ziel.test.js (fremde CRLF-Falle aus a149a82bd, liest keine citymaps-Datei; Owner-Punkt in liste.md). Agenten: Widerleger, Testbindung und Behauptung ohne Fund, alle drei fuhren die gebundenen Tests real. Die Ortsangabe im Abschnitt „Gepruefte Doppelungen“ zeigt seither auf citymaps-links.php

### P-012 · api/_internal/wiki/sync-monitor.php · Verfahren C
- Status: verworfen (überholt: Block durch P-024 zerschnitten)
- Stand: 62ef8c877 · Blob: 511d66bbc8d1250af94f90894cce499881d0c49b
- Block: „Crawl der Territorienseiten“ — avesmapsWikiSyncMonitorNormalizeTitle … avesmapsWikiSyncMonitorCrawlStep (12 Funktionen, ~406 Zeilen ab Z. 329)
- Ziel: api/_internal/wiki/sync-monitor-crawl.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 769 Zeilen, 79 Commits/180 d
- Fallen: `territory-plan-test.php:562` liest den QUELLTEXT von `api/edit/wiki/sync-monitor.php` — das ist der ENDPUNKT, nicht diese Lib (gleicher Basisname; die Vorprüfung löst den Pfad seit 05.09.2026 auf). AGENTS §11 (eigene Knoten): `sync-monitor.php:39` trägt einen Zeilenkommentar mit `_internal/wiki/*`, an dem ein Blockkommentar-Entferner 380 Zeilen frisst — der Verdrahtungstest liest per Tokenizer und prüft `require`-Zeilen; nach dem Schnitt den Test lesen. `avesmapsWikiSyncMonitorEnqueue` ist eine Doppelung mit `regions.php`/`paths.php` (Doppelungs-Paket) — hier nur verschieben. Die Konstanten `AVESMAPS_WIKI_SYNC_MONITOR_CATEGORY_PAGE_LIMIT`/`_MAX` liest der Block; sie stehen davor (Vorprüfung zählt).
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 60751) · 06.09.2026 verworfen. `82f713e18` -- der eigene Vorlauf P-024 -- hat `require_once __DIR__ . '/wiki-crawler-base.php';` bei Z. 383 MITTEN in den Block gelegt; `block.frei` ist damit false mit dem Grund „Zustand oder Ladezeit-Code zwischen den Funktionen des Blocks“. Der Fehlalarm aus `tools/refactoring/__tests__/vorpruefung.test.js` (Owner-Punkt 2 in liste.md) kommt hinzu, ist aber nicht mehr der Grund. ⭐ Die zwei freien Bloecke der Datei -- Z. 33-302 (7 Funktionen) und Z. 387-548 (5) -- koennen im Ueberwachungsmodus neue Pakete werden

### P-013 · api/_internal/wiki/citymap-sync.php · Verfahren C
- Status: erledigt (89bc1b7b3)
- Stand: 72b14bf8f · Blob: bfb6d1d88a904543ef109bea611b4013c9f7a2b5
- Block: „Stadtplanindex- und Kartenindex-Parser“ — avesmapsCitymapSplitRow … avesmapsCitymapRegionFromMapTitle (18 Funktionen, ~757 Zeilen ab Z. 156)
- Ziel: api/_internal/wiki/citymap-sync-parser.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 2422 Zeilen, 22 Commits/180 d · heiß (3 d, wartet auf Abkühlung)
- Fallen: Reine Parser (Wikitext → Zeilen); `citymap-sync-*`-Tests requiren die Lib. Konstanten der Namensräume stehen am Dateikopf (Vorprüfung zählt sie). 🔴 `citymap-sync-test.php:723-745` tokenisiert NUR `citymap-sync.php` und prüft, dass jeder externe `avesmaps*(`-Aufruf per `function_exists` auflösbar ist — der Block ruft `avesmapsPoliticalSlug(`; nach dem Umzug fällt dieser Aufruf aus der Prüffläche (Test bleibt grün, prüft weniger). Der Tokenizer-Lauf muss die Geschwisterdatei mitlesen (eine Zeile) — sonst schrumpft die Schutzfläche lautlos (Skeptiker 05.09.2026).
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 53284) · 08.09.2026 nachgezogen: 3b7e1c097 (vier Farbigkeitsstufen einer Karte) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 erledigt als 89bc1b7b3: -> api/_internal/wiki/citymap-sync-parser.php, citymap-sync.php 2476 -> 1695 Zeilen; 18 Funktionen, die 782 verschobenen Zeilen (ab dem Doc-Kommentar von SplitRow, Z. 139-920) byte-gleich, require_once an der Blockstelle hinter den drei Schluessel-Helfern, die der Block ruft. Fingerabdruck 801/786 = 15 Zeilen / 1,87 %. Die Falle zu citymap-sync-test.php war richtig, nur anders begruendet: nachgezaehlt per Tokenizer traegt der Block keinen der 22 fremden Aufrufe allein (sein einziger, avesmapsPoliticalSlug, steht auch in avesmapsCitymapWikiKey), heute ginge also nichts verloren -- die Geschwisterdatei waere aber nur ZUFAELLIG mitgeprueft gewesen (Testbindungs-Agent, blockend). Der Scan liest deshalb jetzt beide Haelften, mit einem '?>' dazwischen, damit das zweite <?php ein echter Tag ist; er meldet wieder 22 fremde Aufrufe, und eine Mutationsprobe mit einem unaufloesbaren Aufruf nur in der Geschwisterdatei faellt rot. 🪤 Beim Bau: ein '?>' in einem //-Kommentar beendet in PHP den PHP-Modus -- die erste Fassung stand deshalb mit Parse-Fehler da (php -l hat es gefangen). Zwei Kommentare zogen mit: api/_internal/app/citymaps.php und js/ui/wiki-assign-karte.js verorteten die wiki_key-Bau-Stellen als citymap-sync.php :584/:754/:818 (die Nummern waren schon vorher um 11 verrutscht; die uebrigen veralteten Zeilenangaben dort -- :103, :1310, :1508, :1531 -- bricht der Schnitt nicht, sie blieben stehen). Testfeld 617 JS + 435 PHP auf origin 5e8bb1862, rot dieselben zwei wie in der Nulllinie vor dem Schnitt (613/434 auf c7a0460f0) (rot nur link-url-test.php, vorbestehend, und wiki-konstanten-einmal-test.php, Worktree unter .claude/). Agenten: Widerleger blockt nicht (Fund: der Kopfkommentar nannte avesmapsPoliticalSlug nicht -- ergaenzt), Testbindung blockte (der Tokenizer-Scan oben -- behoben), Behauptung blockt nicht (Fund: die alten Nummern :584/:754/:818 waren nie gueltig -- im Commit vermerkt); alle drei fuhren die gebundenen Tests real. Die Commit-Nachricht nennt die Zahlen, die Routine hat sie nach der LETZTEN Aenderung gemessen.

### P-014 · api/_internal/app/lore.php · Verfahren C
- Status: erledigt (62ef8c877)
- Stand: 1cb5e09bd · Blob: 35f088858349343f338957f249d77c3a30b0118f
- Block: „Schlüssel und Ortsauflösung“ — avesmapsLoreMatchKey … avesmapsLoreExpandFromMaps (6 Funktionen, ~222 Zeilen ab Z. 1001)
- Ziel: api/_internal/app/lore-schluessel.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 1513 Zeilen, 25 Commits/180 d
- Fallen: AGENTS §11 (Vorkommen): kein Namensvergleich, kein Abschneiden von Klammerzusätzen — die Regel steht in diesen Funktionen und bleibt Zeichen für Zeichen. `lore-orte-auf-der-karte-test.php` requiret die Lib.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 37825) · 06.09.2026 erledigt als `62ef8c877` (-> api/_internal/app/lore-schluessel.php, lore.php 1512 -> 1288 Zeilen; Fingerabdruck 237/226 = 4,64 %; Testfeld 499 JS + 385 PHP gruen; drei Widerleger-Agenten ohne blockenden Fund -- die Rolle Behauptung hat die Zeilenzahl im Betreff um eins korrigiert, weil `rangliste.mjs` mit `split("\n").length` eine Phantomzeile mitzaehlt)

### P-015 · api/_internal/wiki/path-verlauf.php · Verfahren C
- Status: erledigt (13df83f16)
- Stand: 1cb5e09bd · Blob: 0a098769e12028a5e55205c270a2dc9af5d237fb
- Block: „Fälle des Kurs-Abgleichs“ — avesmapsWikiPathVerlaufListCases … avesmapsWikiPathVerlaufApplyCleanCases (7 Funktionen, ~540 Zeilen ab Z. 1225)
- Ziel: api/_internal/wiki/path-verlauf-faelle.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 1765 Zeilen, 17 Commits/180 d
- Fallen: Der Commit-Scope heißt `verlauf:` — er gehört DIESEM Modul (AGENTS §9), nie dem Neuigkeiten-Fenster. `avesmapsWikiPathVerlaufEnsureCaseTable` liegt VOR dem Block und bleibt.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 30005) · 08.09.2026 erledigt als 13df83f16 (-> path-verlauf-faelle.php, 1764 -> 1229 Zeilen; die 540 verschobenen Zeilen byte-gleich). Fingerabdruck 563/545 = 18 Zeilen / 3,20 %. Agenten: Widerleger und Testbindung kein Fund, Behauptung zwei Funde an der Commit-Nachricht (Zeilenzahl 1228 statt 1229; Prozentbasis) -- beide vor dem Commit korrigiert. Zwei Kommentare mussten mit: der Kopf von path-verlauf.php sagte "Deliberately NO top-level requires" und nennt jetzt die Geschwisterdatei als einzige Ausnahme, und weg-wiki-no-article-test.php verortete avesmapsWikiPathVerlaufRestampKeeps ueber eine Zeilennummer in der alten Datei (jetzt path-verlauf-faelle.php:164-169; der Test selbst bindet ueber den Funktionsnamen und den ganzen api/-Baum, bricht also nicht)

### P-016 · api/_internal/routing/offroad-grid.php · Verfahren C
- Status: offen
- Stand: 1cb5e09bd · Blob: 9db1a916ea6d7109a1465dd48bc0da9c88a63a2e
- Block: „Flüsse: Wand, Furt, Schnitt“ — avesmapsRouteChordCrossesRiver … avesmapsOffroadFordLines (5 Funktionen, ~143 Zeilen ab Z. 1280)
- Ziel: api/_internal/routing/offroad-grid-fluesse.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 1517 Zeilen, 19 Commits/180 d
- Fallen: AGENTS §11: `avesmapsRouteChordCrossesWater` (Komponentenbrücke) bleibt UNBERÜHRT — es liegt nicht in dieser Datei. `avesmapsCollectRouteRiverBarrierLines` liefert die zwei Fächer `wand`/`furt` als EINEN Rückgabewert; nur der Ort ändert sich. `fluss-sperre-test.php`, `bach-furt-test.php` requiren die Lib.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 28823)

### P-017 · js/map-features/map-features-waypoints.js · Verfahren A
- Status: erledigt (75220d48c)
- Stand: 1cb5e09bd · Blob: 48266533ba480fc589f74af7653a32fb82ed825d
- Block: „Wegpunkt-Autovervollständigung“ — scrollWaypointInputIntoView … createWaypointMarkup (10 Funktionen, ~193 Zeilen ab Z. 271)
- Ziel: js/map-features/map-features-waypoints-autocomplete.js, <script> direkt neben dem Original
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 616 Zeilen, 44 Commits/180 d
- Fallen: `getWaypointAutocompleteEntries` (AGENTS §11: reicht `isHidden` mit) liegt NICHT im Block; `wegpunkt-versteckt-label.test.js` lädt die Datei per vm (Vorprüfung: Block frei).
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 27104) · 09.09.2026 erledigt als 75220d48c: zehn Funktionen / 193 Zeilen byte-gleich nach js/map-features/map-features-waypoints-autocomplete.js, 615 -> 421 Zeilen. Fingerabdruck 203/194 = 9 Zeilen / 4,4 %. Agenten: Widerleger und Testbindung kein Fund -- beide fanden aber unabhaengig denselben Aufrufer, den vorpruefung.mjs strukturell nicht sieht (keyboard-shortcuts.js loest scrollWaypointInputIntoView ueber window[name] auf; traegt, weil zur Aufrufzeit aufgeloest wird und beide Skripte denselben globalen Namensraum teilen). Behauptung zwei Funde an der Commit-Nachricht: die Zeilenzahl (616/422 aus rangliste.mjs -- Phantomzeile durch split("\n"), real 615/421, dieselbe Korrektur wie bei P-014) und ein Fingerabdruck, der ohne `git add -N` mit dem vorgeschriebenen Befehl 1/194 statt 203/194 meldet, weil `git diff` untracked Dateien nicht sieht. Beide vor dem Commit korrigiert

### P-018 · api/_internal/political/territories-derived-layer.php · Verfahren C
- Status: offen
- Stand: 1cb5e09bd · Blob: 67ca20960439a52a505c7e6789a20539c402ff2d
- Block: „Cache und Kopfzeilen der Ebene“ — avesmapsPoliticalLayerCacheDir … avesmapsPoliticalInvalidateLayerCache (7 Funktionen, ~72 Zeilen ab Z. 8)
- Ziel: api/_internal/political/territories-layer-cache.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 745 Zeilen, 33 Commits/180 d
- Fallen: AGENTS §10: die Antwort verlässt den Endpunkt an DREI Stellen, alle durch `avesmapsPoliticalSendLayerCacheHeaders`; `max-age` ist die RESTLAUFZEIT der Cachedatei. `ebenen-cache-kopfzeilen-test.php` prüft die drei Erzeuger — Prüfung 3b sagt frei; nach dem Schnitt fahren. Die `require_once`-Stelle liegt am Dateianfang (Block beginnt in Z. 8), also faktisch am Kopf — zulässig, weil die Datei keine Konstanten vor dem Block definiert (Vorprüfung zählt).
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 24585)

### P-019 · api/_internal/wiki/locations.php · Verfahren C
- Status: erledigt (8bacff264)
- Stand: 17fe14a1f · Blob: b5f9b1ef5283b2fccdb9cffe9137adbfe44fba23
- Block: „Fälle und Auflösung der Orte“ — avesmapsWikiSyncListCases … avesmapsWikiSyncUpdateLocationFeature (5 Funktionen, ~293 Zeilen ab Z. 651)
- Ziel: api/_internal/wiki/locations-faelle.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 1150 Zeilen, 15 Commits/180 d
- Fallen: Enger als der freie Block: `avesmapsWikiSyncBuildLocationProperties` (wikisync-fall-no-article-test liest den Quelltext) und alles danach bleiben. `locations-helpers.php` liegt daneben — Namensform `locations-<thema>.php`. `api/wiki-sync.php` auf dem SERVER (nicht im Repo, AGENTS §10) ruft `avesmapsWikiSync*`-Namen — erreichbar, solange `locations.php` die Geschwisterdatei lädt. 🔴 Nach dem Deploy EINE Live-Anfrage gegen `https://avesmaps.de/api/wiki-sync.php` (erwartet HTTP 401 wie heute, nicht 500): diesen Aufrufer sieht kein Checkout und kein Test — die Vorprüfung hat hier eine blinde Stelle, die sie selbst nicht melden kann (Backend-Agent 05.09.2026).
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 17250) · 08.09.2026 nachgezogen: 4044c7e5d (die drei Wiki-Tafeln stehen nur noch einmal) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 16.09.2026 erledigt als 8bacff264: -> api/_internal/wiki/locations-faelle.php, locations.php 1139 -> 847 Zeilen; fuenf Funktionen, die 293 verschobenen Zeilen byte-gleich, require_once an der Blockstelle (Z. 661, direkt vor avesmapsWikiSyncBuildLocationProperties). Fingerabdruck 313/298 = 15 Zeilen / 4,79 %. Die Falle des Pakets zu api/wiki-sync.php ist UEBERHOLT: die Server-Datei ist am 14.09.2026 entfernt worden und antwortet live mit 404 (vor dem Bau gemessen); gegengeprueft wurde stattdessen GET /api/edit/wiki/settlements.php -- sauberer 401-Envelope statt eines Fatals, die Kette settlements.php -> locations.php -> locations-faelle.php laedt also. ZWEI Quelltext-Tests mussten mitwandern, beide von der Vorpruefung NICHT gesehen (sie sieht Namen, keine Fragmente): undo-stellt-feature-type-zurueck-test.php schneidet die Schreibwege aus dem Quelltext und braucht die Aktion wiki_sync_update_point aus avesmapsWikiSyncUpdateLocationFeature -- ohne die Geschwisterdatei in seiner Dateiliste faellt er an Z. 123 (gefahren); und wikisync-fall-no-article-test.php, der Rueckbau-Waechter gegen wiki_no_article, las nur locations.php, waehrend sein eigener Kommentar genau diese Funktion als eine der zwei gedeckten nennt -- Befund des Widerlegers (blockend), er haette lautlos Geltung verloren. Er liest jetzt beide Haelften ueber file_get_contents(a) . '?>' . file_get_contents(b), wie citymap-sync-test.php seit P-013 daneben, und seine Vakuum-Zusicherung nennt aus jeder Datei einen Namen. Drei Gegenproben gefahren: Marker in locations.php rot, Marker in locations-faelle.php rot, Verkettung gekuerzt -> Vakuum-Riegel rot. 🪤 Beim Bau dieselbe Falle wie bei P-013, aber in ihrer GEFAEHRLICHEN Form: das schliessende PHP-Tag stand als Zeichen in einem //-Kommentar und beendete den PHP-Modus -- php -l meldete NICHTS (der Rest ist gueltiges Inline-HTML), der Test lief mit Exit 0 durch und gab ab dort nur noch seinen Quelltext aus. Aufgefallen ist es allein daran, dass die Gegenprobe gruen blieb. Testfeld 632 JS + 444 PHP, vor und nach dem Schnitt zeichengleich (rot nur link-url-test.php, vorbestehend, und wiki-konstanten-einmal-test.php, Worktree unter .claude/). Agenten: Widerleger EIN blockender Fund (oben; nach der Reparatur vom selben Agenten nachgeprueft und als erledigt bestaetigt), Testbindung kein Fund, Behauptung in zwei Runden -- die erste bestaetigte einen Stand, den die Reparatur ueberholt hat, die zweite fand die Zeilenangabe der Gegenprobe (124 statt 123) und wurde vor dem Commit korrigiert

### P-020 · api/app/ecosystem-areas.php · Verfahren D
- Status: verworfen (überholt: 34c012baa bindet den Ensure an einen datenbankgebundenen Fingerabdruck)
- Stand: 1cb5e09bd · Blob: f2ed1e0535fdb007ac502be626e113d3b3d4d4fd
- Block: „Ensure auf dem öffentlichen Lesepfad“ — avesmapsEcosystemEnsureTables … avesmapsEcosystemEnsureTables (gerufen in ecosystem-areas.php Z. 111, definiert in api/_internal/app/ecosystem.php Z. 275, 13 Abfragen in Schleifen plus DDL je Aufruf)
- Ziel: `avesmapsEcosystemEnsureTables($pdo)` am Lesepfad `api/app/ecosystem-areas.php` durch `avesmapsSchemaEnsureOnce('ecosystem', (new ReflectionFunction('avesmapsEcosystemEnsureTables'))->getFileName(), fn() => avesmapsEcosystemEnsureTables($pdo))` binden — der zweite Parameter ist die Datei, in der die Ensure-Funktion DEFINIERT ist (heute `ecosystem.php`; nach einem C-Schnitt automatisch die Geschwisterdatei), NIE `__FILE__` des Aufrufers: `ecosystem-areas.php` hat 20 Commits in 180 Tagen, `ecosystem.php` 94 — die Dateien ändern sich unabhängig, und ein falscher Pfad zeigte eine neue Spalte bis zu eine Stunde lang nicht an (Backend-Agent 05.09.2026). Riegel: `api/_internal/schema-ensure-once.php`, dieselbe Bauform wie beim politischen Endpunkt (AGENTS §10). NUR der Lesepfad; alle Schreibwege in ecosystem.php behalten den Roh-Ensure.
- Messskript: tools/perf/ecosystem-areas-ensure.php (zu schreiben) — zählender PDO-Wrapper über der SQLite-Fixture der `climate-*-test.php`: Abfragen je `GET areas`-Aufruf vorher/nachher (Erwartung beim zweiten Aufruf: minus die 38 `prepare/query/exec` von `avesmapsEcosystemEnsureTables` Z. 275–1108, darunter 18 `CREATE TABLE` und 8 `SHOW COLUMNS`/`PRAGMA` — Behauptungsprüfer 05.09.2026; „13“ war die Zahl des Geruchs, nicht der Arbeit), `ausgabe_sha256` des JSON-Rumpfs gleich.
- Vorprüfung (05.09.2026): gleiche Ausgabe, weniger Arbeit — ABER `avesmapsEcosystemEnsureTables` trägt neben DDL auch DATENMIGRATIONEN und SEEDS (`UPDATE ecosystem_area SET terrain_erosion = terrain_levels`, `affects_paths`-Seed, die `offroad_factor`-Tabelle; Z. 505–535, 765–800). Mit dem Riegel laufen sie höchstens einmal je Stunde statt je Anfrage — nie öfter. Vor dem GO prüfen: verlässt sich ein SCHREIBWEG darauf, dass der Lesepfad einen Backfill für frisch angelegte Zeilen nachholt? Wenn ja, ist es keine reine Perf-Änderung. Die zwei Warnungen in `ecosystem.php` gegen einen geteilten „was anything new?“-Merker meinen das WIEDER-Ausführen eines Seeds — das tut der Riegel nicht.
- Fallen: 💣 Der Marker trägt die MTIME der DEFINIERENDEN Datei — das ist die Datei, in der `avesmapsEcosystemEnsureTables` steht (heute ecosystem.php; nach einem C-Schnitt der Ensure-Funktionen deren Geschwisterdatei), sonst läuft ein neuer `ALTER TABLE` bis zu eine Stunde später in „Unknown column“. 💣 Nie innerhalb einer Transaktion rufen (DDL committet implizit). ⚠️ Fällt OFFEN aus (Temp nicht schreibbar → Ensure wie bisher). 🔴 Die Live-Gegenprobe nach dem Deploy beweist den Marker-Pfad NICHT (der gerade gelaufene Ensure ist ohnehin frisch) — der Beleg ist der DIFF: der Behauptungsprüfer liest das zweite Argument. Owner-Probe: erstes von drei Perf-Paketen.
- Verlauf: 05.09.2026 angelegt (Perf-Geruch: abfrage-in-schleife ×13 in avesmapsEcosystemEnsureTables; Aufrufer auf dem Lesepfad belegt) · 05.09.2026 GO Owner (Perf-Probe 1 von 3; nur mit Agenten, Riegel D) · 17.09.2026 VERWORFEN, ueberholt -- obwohl der Frischelauf „gilt“ meldet: er vergleicht nur den Blob von ecosystem-areas.php, und der hat sich nicht bewegt. Die Arbeit, die das Paket einsparen sollte, faellt seit `34c012baa` (05.09.2026, „das Gebirgsrelief zeigt den Verbund“) nicht mehr an: avesmapsEcosystemEnsureTables ist ein Weiterreicher auf `avesmapsEcosystemSchemaEnsure` (`api/_internal/app/ecosystem-schema-state.php`), und der laeuft die Migration auf MySQL nur, wenn der Fingerabdruck in `ecosystem_schema_state` nicht passt -- sonst EIN `SELECT fingerprint` plus sha256 ueber vier Dateien (ecosystem.php, die Zustandsdatei selbst, travel-values-migration.php, travel-values.php). Der Kopf der Datei begruendet die Bauform ausdruecklich: „Datenbankgebundener Nachweis statt Prozess-/Temp-Merker: ein Restore oder eine neue Datenbank muss die Migration erneut durchlaufen.“ Ein `avesmapsSchemaEnsureOnce` (Temp-Marke) davor widerspraeche genau dieser Entscheidung. Die Rest-Kosten (vier hash_file je Anfrage, ecosystem.php rund 6.150 Zeilen) sind nicht gemessen -- Owner-Punkt in liste.md; die Perf-Probe 1 von 3 braucht damit ein anderes Paket

### P-021 · api/_internal/app/lore.php · Verfahren D
- Status: GO nötig
- Stand: 72b14bf8f · Blob: 8bb0980a2e29cffcfe58fd38657a70565f3a2e82
- Block: „Orte auf der Karte je Katalogseite“ — avesmapsLoreReadPlaceKeysOnMap … avesmapsLoreReadPlaceKeysOnMap (1 Funktion, ~85 Zeilen ab Z. 586; Aufrufer lore.php Z. 483 und 765, lore-edit.php Z. 92)
- Ziel: NUR die zwei JSON-Familien (Ort `properties.wiki_settlement.wiki_key`, Landschaftslabel `properties.wiki_region.wiki_key`) lesen je Katalogseite `properties_json` ALLER Orte und Beschriftungen (~6,7 MB, AGENTS §11 „Statuskreis“) — genau diese zwei hängen an EINEM Stempel, `map_revision`, und werden als Dateicache je `map_revision` abgelegt (wie der Dateicache der politischen Ebene). Die Flächen-Familie (`ecosystem_region.wiki_region_key`) und die Territorien-Familie (`political_territory.wiki_key`) bleiben LIVE-Abfragen: beide sind indizierte Spaltenabfragen, billig, und hätten je einen eigenen Stempel gebraucht (der Backend-Agent fand: eine Wiki-Zuweisung an einem Territorium ändert nur `political_territory`, nie `map_revision` — ein Cache über alle vier hätte dort NIE invalidiert).
- Messskript: tools/perf/lore-orte-auf-der-karte.php (zu schreiben) — SQLite-Fixture mit 2.000 Orten/500 Labels: Bytes gelesen (`SUM(LENGTH(properties_json))` der gefahrenen Abfragen) und Abfragen je Katalogseite vorher/nachher; `ausgabe_sha256` der Statuskreis-Zahlen (`place_mapped_count`) gleich.
- Vorprüfung (05.09.2026): Frische bleibt — der Cache ist an dieselben Revisionsstempel gebunden, die die Nutzlast ohnehin invalidieren; ein Fehlschlag beim Lesen wird PROTOKOLLIERT, nie geschluckt (die HY093-Falle aus §11), und ein Cache-Fehler fällt offen aus (Vollabfrage wie heute).
- Fallen: 💣 „Kein Namensvergleich und kein Abschneiden von Klammerzusätzen“ (AGENTS §11) — der Cache darf die Vergleichsregel nicht verändern, er hebt nur die Lesearbeit heraus. ⚠️ Wer den Cache je auf die Flächen- oder Territorien-Familie ausdehnt, braucht dafür je einen eigenen Stempel (`ecosystem_revision` bzw. einen Territorien-Stempel, den es heute nicht gibt) — die Dauerregel „Wiki-Zuweisung + Listensymbol IMMER zusammen“ hängt daran. Owner-Probe: zweites von drei Perf-Paketen. 💣 Der Aufruf `avesmapsLoreReadPlaceKeysOnMap($pdo, array_keys($allPlaceKeys))` ist per Regex an js/ui/__tests__/listen-statuskreis.test.js:405 gebunden -- ein Cache-Umbau muss ihn ZEICHENGLEICH lassen (der Cache gehoert in den Rumpf, nie an die Aufrufstelle), sonst faellt ein fremder Test um. Gefunden am 08.09.2026 vom Frischelauf.
- Verlauf: 05.09.2026 angelegt (Perf-Geruch: abfrage-in-schleife ×2 in avesmapsLoreReadPlaceKeysOnMap; die 6,7 MB stehen in AGENTS §11) · 08.09.2026 nachgezogen: 62ef8c877 (P-014) hat die Datei bewegt. NICHT verworfen, obwohl block.frei jetzt false meldet: die Bindung ist js/ui/__tests__/listen-statuskreis.test.js:405, das den Quelltext von lore.php per Regex auf den Aufruf `avesmapsLoreReadPlaceKeysOnMap($pdo, array_keys($allPlaceKeys))` prueft. block.frei ist das Kriterium des VERSCHIEBENS (A/B/C); dies ist ein D-Paket, das nichts verschiebt -- die Bindung ist dort eine Falle (der Aufruf muss zeichengleich bleiben) und kein Ausschluss. Als Falle unten aufgenommen; die Entscheidung ueber das Paket bleibt beim Owner (GO noetig)

### P-022 · api/_internal/political/territories-layer.php · Verfahren D
- Status: GO nötig
- Stand: 5e8bb1862 · Blob: 0683518a8b2e69cbf28a25dd8911c4367006e34a
- Block: „Drei korrelierte Wappen-Unterabfragen je Layer-Zeile“ — avesmapsPoliticalReadLayer … avesmapsPoliticalFetchLayerTerritories (drei SELECTs mit je drei `(SELECT … LIMIT 1)`-Spalten: Z. 79–81 in avesmapsPoliticalReadLayer, Z. 187–189 in avesmapsPoliticalReadEditorLayer, Z. 470–472 in avesmapsPoliticalFetchLayerTerritories)
- Ziel: `staging_coat_url`, `staging_coat_license` (aus `political_territory_wiki_test`) und `coat_override_json` (aus `wiki_territory_model`) je Zeile durch je einen `LEFT JOIN` auf `wiki_key` ersetzen (beide Spalten aus DERSELBEN Join-Zeile, kein spaltenweises Aggregat). 🔴 Behauptungsprüfer 05.09.2026: BEIDE Tabellen tragen `UNIQUE KEY (wiki_key)` (`political_territory_wiki_test` ist `CREATE TABLE … LIKE political_territory_wiki`, `sql/schema.sql:554` und `:48`; `wiki_territory_model` in `sync-monitor.php:93`) — es gibt je `wiki_key` höchstens EINE Zeile, `LIMIT 1` ist damit nie eine Auswahl, und ein einfacher `LEFT JOIN … ON x.wiki_key = territory.wiki_key` je Tabelle ist beweisbar dieselbe Ausgabe. Die `MIN(id)`-Konstruktion ist gegenstandslos und entfällt; die Fixture muss dieselben UNIQUE-Schlüssel tragen. AGENTS §10 nennt genau diese drei Unterabfragen als die Kosten eines Cache-Miss der politischen Ebene (2,1 s, ~870 KB Ausgabe).
- Messskript: tools/perf/ebene-wappen-joins.php (zu schreiben) — SQLite-Fixture mit 900 Gebieten und 1.400 Staging-Zeilen: `ms_median` aus drei Läufen (⚠️ Ausnahme von „gezählt vor ms“, weil die Arbeit in EINER Abfrage steckt — als zweite gezählte Größe die Zeilen im `EXPLAIN`), `ausgabe_sha256` der Layer-Features gleich. Nach dem Deploy EINE Live-Anfrage `GET territories-endpoint.php?zoom=3` mit `X-Avesmaps-ETag`-Vergleich (Cache-Miss durch Jahr wählen, nie in Schleife).
- Vorprüfung (05.09.2026): gleiche Ausgabe — je `wiki_key` gibt es genau eine Zeile (UNIQUE), der JOIN liefert dieselbe; weniger Arbeit — drei korrelierte Unterabfragen je Zeile (×~800 Zeilen) gegen zwei Joins.
- Fallen: 🔴 Die Fixture trägt dieselben `UNIQUE KEY (wiki_key)` wie MySQL — ohne sie misst sie eine Tabelle, die es live nicht gibt. 🔴 An DREI Stellen — alle drei oder keine (die Regel „eine Regel, die einen von drei Erzeugern bindet, ist keine“ aus AGENTS §10 gilt hier wörtlich). ⚠️ `avesmapsPoliticalSendLayerCacheHeaders` und der Dateicache bleiben unangetastet. Owner-Probe: drittes von drei Perf-Paketen.
- Verlauf: 05.09.2026 angelegt (AGENTS §10, gemessen am Dump vom 04.09.2026: 2.143 → 1.993 ms Rauschen bei der Derived-Löschung, die Kosten liegen in den Wappen-Unterabfragen) · 13.09.2026 nachgezogen: fuenf Commits des Anzeigename-Umbaus (1b0aeed2f bis 0d61fed0a, am 13.09. zurueckgebaut) haben die Datei bewegt; die drei korrelierten Unterabfragen stehen unveraendert in avesmapsPoliticalReadLayer, avesmapsPoliticalReadEditorLayer und avesmapsPoliticalFetchLayerTerritories (Z. 79-81/187-189/470-472), block.frei · 15.09.2026 nachgezogen: f28a45a97 (54 tote PHP-Funktionen entfernt) hat die Datei bewegt; die drei korrelierten Unterabfragen stehen unveraendert in avesmapsPoliticalReadLayer, avesmapsPoliticalReadEditorLayer und avesmapsPoliticalFetchLayerTerritories (Z. 79-81/187-189/470-472), block.frei

### P-023 · api/_internal/wiki/regions.php · Verfahren C
- Status: offen
- Stand: e7c2d97b5 · Blob: 2d62cfe95b57a481c20dc9e7cc548fbd586d2c9b
- Block: „Doppelung: Kurzbeschreibung aus dem Wikitext“ — avesmapsWikiRegionExtractDescription … avesmapsWikiRegionExtractDescription (dreifach: `paths.php` `avesmapsWikiPathExtractDescription` Z. 551–589, `regions.php` Z. 617–658, `settlements.php` `avesmapsWikiSettlementExtractDescription` Z. 780–821)
- Ziel: neue abhängigkeitsfreie Datei `api/_internal/wiki/wiki-text-extract.php` mit `avesmapsWikiExtractLeadDescription(string $wikitext, string $infoboxBlock): string`, `require_once` aus paths/regions/settlements (Vorbild: `path-naming.php`, „dependency-free, required by BOTH paths.php and powerlines.php“). Die drei alten Namen bleiben als Einzeiler-Weiterreicher, bis alle Aufrufer umgestellt sind.
- Unterschied: keiner außer Namen und drei Leerzeilen (paths kompakter; regions ↔ settlements diff-Exit 0) — Regex, Grenzwerte 700/1200, Aufruf von `avesmapsWikiSyncCleanPoliticalTerritoryWikiValue` wortgleich.
- Warum: drei unabhängig gebaute Crawler in Folge — `cc29579ef4` (05.06.2026 23:35, regions) → `fdcbfe33af` (06.06. 02:56, paths) → `3e9982813b` (06.06. 05:19, settlements, Kommentar Z. 778: „Spiegelt avesmapsWikiRegionExtractDescription“). `powerlines.php` hat keine eigene Kopie und ruft die Path-Fassung.
- Empfehlung: zusammenlegen — keine Verhaltensvereinigung nötig, die drei sind heute wortgleich; reine Deduplizierung plus drei `require_once`-Zeilen.
- Beleg: `git blame -w -L 551,589 -- api/_internal/wiki/paths.php` → fdcbfe33af; `-L 619,660 -- regions.php` → cc29579ef4; `-L 779,821 -- settlements.php` → 3e9982813b; `grep -rln ExtractDescription` → nur die vier Dateien, kein Test.
- Fallen: kein Test hält die drei gegeneinander — eine Änderung an einer Kopie (Grenzwert 1200) bliebe in den anderen stehen. Historiker-Lauf 05.09.2026.
- Verlauf: 05.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker) · 05.09.2026 GO Owner (zusammenlegen; alte Namen bleiben als Weiterreicher) · 06.09.2026 nachgezogen: `82f713e18` (P-024) hat das Enqueue bei Z. 261-263 auf einen Weiterreicher gekuerzt -- der Block wandert um rund -21 Zeilen und bleibt an den Namen frei · 08.09.2026 nachgezogen: 72ebea96b (die Regionen-Suche findet auch unter Titel, Synonym und Schluessel) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 14.09.2026 nachgezogen: a1e26c4ec (eine Wiki-Schlucht wird zur Art Schlucht statt Tal) hat die Datei bewegt; Block an den Namen unveraendert frei, jetzt Z. 617-658 · 16.09.2026 nachgezogen: 4609938a7 (Flaeche und Beschriftung tragen denselben Wiki-Artikel) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 18.09.2026 nachgezogen: 6cd5c4094 (Wiki-Zuordnungen freier Beschriftungen gemeinsam zuruecknehmen) hat die Datei ab Z. 819 bewegt; Block an den Namen unveraendert zusammenhaengend und frei, Zeilennummern unveraendert (Z. 617)

### P-024 · api/_internal/wiki/sync-monitor.php · Verfahren C
- Status: erledigt (82f713e18)
- Stand: 1cb5e09bd · Blob: 767a14f7cfc522aead59ffbecc69371a993c55d1
- Block: „Doppelung: das Crawl-Skelett der Wiki-Sync-Libs“ — avesmapsWikiSyncMonitorEnqueue … avesmapsWikiSyncMonitorEnqueue (Familie: `Enqueue` dreifach in sync-monitor/regions/paths; `FetchCategory`, `RunStatus`, `StartRun`, `Clear` je paths ↔ regions)
- Ziel: `api/_internal/wiki/wiki-crawler-base.php` — der Masterplan (M4, seit `723aae060` 13.06.2026) nennt genau diese Datei als aufgeschoben. Parametrisiert über Queue-/Staging-Tabelle, Default-Seeds und Max-Depth-Konstante; die Path-/Region-Namen bleiben als Weiterreicher.
- Unterschied: `Enqueue` dreifach wortgleich bis auf die Queue-Konstante (`wiki_path_queue`/`wiki_region_queue`/`wiki_crawl_queue`); `FetchCategory`, `RunStatus`, `StartRun`, `Clear` paths ↔ regions wortgleich bis auf Namen/Tabellenkonstanten/Ensure-Aufruf. ⚠️ `avesmapsWikiSyncMonitorRunStatus`/`…StartRun` sind ECHT anders (Rollen inkl. `list`, `ClassifyRole`, Rückgabeform `by_status`) und bleiben draußen.
- Warum: sync-monitor.php ist das Original (`0945c2812`, 01.06.2026, „resumable enumeration engine“); regions kopierte daraus (`cc29579ef4`, 05.06.), paths aus regions (`fdcbfe33af`, 06.06.). Beide Kopien hängen für Helfer und Konstanten (`avesmapsWikiSyncMonitorNormalizeTitle`, `AVESMAPS_WIKI_SYNC_MONITOR_CATEGORY_PAGE_LIMIT`) ohnehin an sync-monitor.php.
- Empfehlung: zusammenlegen — `Enqueue` zuerst (alle drei Aufrufer identisch, kandidatenreifste Funktion), dann die vier Paare.
- Beleg: `paths.php:136-159/162-186/190-225/628-655/690-709`, `regions.php:262-287/290-320/323-362/704-733/771-792`, `sync-monitor.php:384-410`; `docs/refactoring-masterplan.md` M4 „wiki-crawler-base.php“. Kein Test hält eine der fünf Familien einzeln fest.
- Fallen: `territory-plan-test.php:562` liest den QUELLTEXT des gleichnamigen ENDPUNKTS `api/edit/wiki/sync-monitor.php`, nicht dieser Lib (ein früherer Satz hier behauptete das Gegenteil — Behauptungsprüfer 05.09.2026). Die Risikorichtung ist real: ein Bugfix in einer Kopie läuft an den anderen vorbei.
- Verlauf: 05.09.2026 angelegt (Doppelungs-Scan, 9 Paare der Familie; Historiker) · 05.09.2026 GO Owner (zusammenlegen; alte Namen bleiben als Weiterreicher) · 06.09.2026 erster Schnitt der Empfehlung gebaut: `Enqueue` dreifach -> `avesmapsWikiCrawlEnqueue` in `api/_internal/wiki/wiki-crawler-base.php`, die drei alten Namen als Weiterreicher. Die vier Paare (`FetchCategory`, `RunStatus`, `StartRun`, `Clear`) stehen noch aus - dafuer ein Folgepaket. ⚠️ Der Tabellenname ist jetzt Parameter statt Konstante und wandert in den SQL-Text; der geteilte Rumpf traegt dafuer einen Bezeichner-Riegel, der fuer alle drei Wirte beweisbar ein No-op ist (nur drei Aufrufer im Baum, alle mit literaler Konstante - Widerleger 06.09.2026).

### P-025 · api/_internal/political/territories-geometry.php · Verfahren C
- Status: offen
- Stand: 1cb5e09bd · Blob: b4230f91d43e3cf271ec45820692669705b5164d
- Block: „Doppelung: bbox-Parameter lesen“ — avesmapsPoliticalReadOptionalBoundingBox … avesmapsPoliticalReadOptionalBoundingBox (dreifach: `api/app/map-features.php` `avesmapsParseOptionalBoundingBox` Z. 558–591, `territories-geometry.php` Z. 1680–1714, `api/_internal/app/ecosystem.php` `avesmapsEcosystemParseBoundingBox` Z. 1299 — die dritte fand der Scan nicht, der Historiker schon)
- Ziel: eine neutrale reine Bibliotheksdatei (`api/_internal/app/bbox-parse.php`, `avesmapsParseBoundingBox`), per `require_once` aus allen drei Stellen. NICHT das eine aus dem anderen einbinden: `map-features.php` ist ein ENDPUNKT mit Bootstrap, ein `require` ließe den ganzen Request-Handler mitlaufen (Kommentar `ecosystem.php:1296-1298` sagt genau das).
- Unterschied: keiner außer Namen (Rumpf byte-gleich; ecosystem.php: Klammerstil und ein Kommentar).
- Warum: unabhängig gleich gelöst — `a1ce7c11f` (06.05.2026, map-features) und `d760df69e` (15.05., political), `9d938c047a` (28.05., in territories-geometry verschoben); ecosystem.php reimplementierte am 24.07. mit dem oben zitierten Grund.
- Empfehlung: zusammenlegen über eine dritte, gemeinsame Bibliotheksstelle (nutzlastfrei: kein Bootstrap, keine DB, nur `InvalidArgumentException`).
- Beleg: `api/app/map-features.php:558-591`, `territories-geometry.php:1680-1714`, `ecosystem.php:1294-1299`; Commits a1ce7c11f, 815327b32, d760df69e, 9d938c047a. Kein Test hält die Fassungen gegeneinander.
- Fallen: ein künftiger Fix (Dezimaltrennzeichen, Fehlermeldung) an einer Kopie liefe lautlos an zwei anderen vorbei.
- Verlauf: 05.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker) · 05.09.2026 GO Owner (zusammenlegen; alte Namen bleiben als Weiterreicher)

### P-026 · js/territory/territory-editor-preview.js · Verfahren A
- Status: erledigt (c9458e14a)
- Stand: 1cb5e09bd · Blob: ef3c5ad62206fd7b1c891fd73fe65b52e6ca7f79
- Block: „Doppelung: getTreeMapStatus — eine ist tot“ — getTreeMapStatus … getTreeMapStatus (Zwilling in `territory-editor-embedded.js` Z. 856–886, live verdrahtet)
- Ziel: gelöscht in c9458e14a (Owner-GO 05.09.2026); auf dem Server bleibt die Datei als Waise, der Deploy löscht nie
- Unterschied: semantisch keiner; zeichengleich nicht — `getTreeCoverageStatus` schreibt `(status) => …` gegen `status => …`, `getTreeMapStatus` sein `return` einzeilig gegen dreizeilig (Behauptungsprüfer 05.09.2026).
- Warum: beide aus dem Squash-Commit `3a97fa5bed` (25.05.2026, „Restore repository“); preview ist ein Überbleibsel der Vor-Reorg-Phase.
- Empfehlung: eine ist tot — Datei löschen.
- Beleg: `git grep -rn territory-editor-preview` → kein Aufrufer in `index.html`, `html/*.html`, `edit/*.php`, `territory-editor-inline-host.js`; einzige Nennung `docs/systemtest-2026-08-05/befunde/3-sackgassen.md`.
- Fallen: keine — kein Loader, kein Test, keine Referenz.
- Verlauf: 05.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker; deckt B16) · 05.09.2026 GO Owner · 05.09.2026 erledigt (c9458e14a): Datei gelöscht

### P-027 · js/review/review-label-wiki.js · Verfahren A
- Status: GO nötig
- Stand: 17fe14a1f · Blob: 860062c6082eda0ba9939fee7b854ededbc6a568
- Block: „Doppelung: Wiki-Schnappschuss laden“ — ladeLabelWikiSchnappschuss … ladeLabelWikiSchnappschuss (Zwilling `ladeWikiSchnappschuss` in `js/map-features/map-features-ecosystem-properties.js` Z. 316–333, IIFE)
- Ziel: als parametrisierte Funktion nach `js/ui/wiki-assign-landschaft.js` heben (dort liegt schon der geteilte Validator `avesmapsWikiAssignLandschaftAntwortPruefen`, den beide rufen, und beide Dokumente laden die Datei).
- Unterschied: ausführbarer Code zeichengleich; nur Funktionsname und Konstantenname (`WIKI_API_URL`/`LABEL_WIKI_API_URL`, beide `/api/edit/wiki/regions.php`) und der Schlusskommentar.
- Warum: beide am 16.08.2026 in der Wiki-Zuweisungs-Vereinheitlichung angelegt (`bf2a745678` 13:58, `374b82da8f` 14:17, 19 Minuten Abstand) — Copy-Paste für die zwei Hüllen (`.dt-*` Editor-iframe, `.label-wiki-*` Beschriftungsdialog). AGENTS §11: „Zwei Hüllen, und das ist die Obergrenze“ — die Hülle bleibt getrennt, der Fetch-Helfer nicht.
- Empfehlung: zusammenlegen (eine Funktion mit `wikiKey`, URL-Konstante als Parameter).
- Beleg: `git blame -L316,333 js/map-features/map-features-ecosystem-properties.js` → bf2a745678; `-L180,196 js/review/review-label-wiki.js` → 374b82da8f; kein Test nennt einen der beiden Namen.
- Fallen: `map-features-ecosystem-properties.js` ist ein IIFE-Modul (Nicht-Ziel der Routine) — die Zusammenlegung ändert dort eine Closure; Owner-Sache. Vorher prüfen, ob die zwei URL-Konstanten je auseinanderlaufen sollen (heute nicht).
- Verlauf: 05.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker) · 05.09.2026 GO Owner — aber die Zusammenlegung ändert eine Closure im IIFE-Modul map-features-ecosystem-properties.js (Nicht-Ziel der Routine, Owner-Entscheid 05.09.): bleibt GO nötig als Owner-Aufgabe, die Routine baut es nicht · 09.09.2026 nachgezogen: d071c4616 (der Transport des Merkers faellt) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei

### P-028 · api/_internal/map/features.php · Verfahren C
- Status: offen
- Stand: fc7a9fb5b · Blob: 3525b471753480c1e0b26799fcf66a2a319a22b8
- Block: „Doppelung: UUID v4 und map_revision-Zähler“ — avesmapsUuidV4 … avesmapsUuidV4 (dreifach: `features.php` Z. 4251, `political/territory.php` `avesmapsPoliticalUuidV4` Z. 1082, `wiki/sync.php` `avesmapsWikiSyncUuidV4` Z. 104; dazu `avesmapsNextMapRevision` `features.php` Z. 4069 ~ `avesmapsWikiSyncNextMapRevision` `wiki/locations-helpers.php` Z. 149)
- Ziel: neue abhängigkeitsfreie Datei `api/_internal/uuid.php` (nur die eine Funktion) und ein ebenso kleiner `map-revision.php`; die alten Namen bleiben als Weiterreicher. NICHT durch Requiren einer der drei Großdateien — Kommentare in `citymaps.php:902`, `ecosystem.php:70`, `game-literature.php:791`, `edit/reports/locations.php:8` begründen, warum niemand die 2700-Zeilen-Datei für einen 15-Zeilen-Helfer einbindet.
- Unterschied: keiner außer Namen (UUID: Rumpf nach Namensersetzung byte-identisch, 15 Zeilen; NextMapRevision ×2 ebenso). ⚠️ `avesmapsNextEcosystemRevision` (ecosystem.php Z. 1258) ist KEINE Doppelung: eigene Tabelle `ecosystem_revision`, eigener Cache-Kreis (`956d53ee9e`, 26.07.2026, begründet in `ecosystem.php:12-16`).
- Warum: drei parallel gewachsene Alt-Bibliotheken vom Mai 2026 (`a564ab1be`, `d760df69e`, `1e59daad3`; `416052fd8`, `1e59daad3`), von den „Move … internal“-Commits nur mechanisch mitverschoben.
- Empfehlung: zusammenlegen in eine abhängigkeitsfreie Datei — erfüllt genau die im Code genannte Bedingung.
- Beleg: `git blame -w -L 4251,4251 -- api/_internal/map/features.php` u. a.; Kommentare `api/_internal/app/citymaps.php:902-903`, `api/_internal/app/ecosystem.php:70-72`.
- Fallen: `settlement-places-test.php` sucht `avesmapsUuidV4` im Quelltext von `features.php` (Prüfung 3b) — der Weiterreicher muss dort stehen bleiben oder der Test mitwandern.
- Verlauf: 05.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00 / 0,91; Historiker) · 05.09.2026 GO Owner (zusammenlegen; alte Namen bleiben als Weiterreicher) · 08.09.2026 nachgezogen: 3b6439131 und 179c64277 (Kreuzungstyp) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 3b6439131 (Kreuzungstyp) und 80cb6bbeb (Merker) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 nachgezogen: a04ffc929 (die Art Vor-/Mittelgebirge faellt) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: f28a45a97 (54 tote PHP-Funktionen entfernt) hat die Datei bewegt; die drei UUID- und die zwei NextMapRevision-Fassungen sind weiter gleich bis auf Namen und Leerraum (features.php Z. 4098/3911, political/territory.php Z. 907, wiki/sync.php Z. 114, wiki/locations-helpers.php Z. 149), block.frei · 16.09.2026 nachgezogen: a393adbe9, ca719313d und 59e0aae86 (Wegname an Wiki-Wegen) sowie 4609938a7 haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 17.09.2026 nachgezogen: 301e8d771, 936b39b59, 6433bcfd5 und 54bd1aff3 (Audit-Pakete) haben die Datei bewegt; die drei UUID- und die zwei NextMapRevision-Fassungen sind nach Namensersetzung und Leerraum-Normalisierung weiter zeichengleich (md5 der Ruempfe gegengemessen; features.php Z. 4078/3891, political/territory.php Z. 907, wiki/sync.php Z. 114, wiki/locations-helpers.php Z. 149), block.frei

### P-029 · api/_internal/wiki/lore-sync.php · Verfahren C
- Status: offen
- Stand: 62ef8c877 · Blob: b199473f32de4d08eeabc22d28565ddf0d05fc99
- Block: „Doppelung: Feldplan des Override-sicheren Abgleichs“ — avesmapsLoreFieldPlan … avesmapsLoreFieldPlan (Zwilling `avesmapsGameLiteratureFieldPlan` in `game-literature-sync.php` Z. 61)
- Ziel: ein generischer `avesmapsWikiFieldPlan(current, desired, fieldOrigins, fields, normalizeFn)` — reine Funktion, DB-frei — in einer kleinen geteilten Datei; beide Aufrufer sind durch identische Signatur austauschbar.
- Unterschied: keiner außer Namen/Konstanten und zwei übersetzten Kommentarzeilen. Der Dateikopf von `lore-sync.php` (Z. 8–9) sagt es selbst: „Spiegelt api/_internal/wiki/game-literature-sync.php 1:1“.
- Warum: `f82acb73e` (13.07.2026, Abenteuer) → `3f46362634` (21.07.2026, Lore) — bewusste Copy-Paste-Übernahme des Diff-Kerns für ein neues Feature.
- Empfehlung: zusammenlegen (AGENTS §5 sinngemäß: ein Parameter statt einer zweiten Datei).
- Beleg: `game-literature-sync.php:61`, `lore-sync.php:91` und Kopf Z. 8–9; Tests `game-literature-sync-test.php`, `lore-sync-test.php` prüfen nur den je eigenen Aufrufer.
- Fallen: kein Test hält die beiden gegeneinander; die Vereinigung ändert kein Verhalten, solange `normalizeFn` je Aufrufer mitgegeben wird.
- Verlauf: 05.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker) · 05.09.2026 GO Owner (zusammenlegen; alte Namen bleiben als Weiterreicher) · 06.09.2026 nachgezogen: `289d0b2a9` fuegt bei Z. 534 und 924 ein -- beide ausserhalb der freien Bloecke; Block an den Namen unveraendert frei

### P-030 · api/_internal/app/ecosystem-display.php · Verfahren C
- Status: offen
- Stand: 5e8bb1862 · Blob: 72f395b0a4570bf59fb882ca2d9a8e526021fda9
- Block: „Doppelung: Tafel mit Stempel lesen“ — avesmapsEcosystemDisplayRead … avesmapsEcosystemDisplayRead (Zwilling `avesmapsZoomBandsRead` in `zoom-bands.php` Z. 156)
- Ziel: ein generischer `avesmapsAppSettingTafelRead($pdo, $settingKey, $stampKey): array{value,stamp}`, den beide Wrapper (mit ihren heutigen Rückgabe-Schlüsseln `display`/`bands`) dünn aufrufen.
- Unterschied: keiner außer Namen/Konstanten (Anführungszeichen- und Umlaut-Schreibweise in Kommentaren).
- Warum: `5e5829dc49` (16.08.2026, Zoombänder, erste „Tafel mit Stempel“) → `941b5b71ed` (24.08.2026, Darstellungstafel) übernimmt acht Tage später dasselbe Read/Write/Stamp-Muster; AGENTS §11 nennt beide Tafeln im selben Abschnitt.
- Empfehlung: zusammenlegen.
- Beleg: `ecosystem-display.php:366`, `zoom-bands.php:156`; Tests `ecosystem-display-test.php`, `zoom-bands-test.php` prüfen je nur den eigenen Aufrufer.
- Fallen: beide Leser fallen OFFEN aus (jeder Fehler ⇒ Vorgabe, AGENTS §11 Zoombänder) — der geteilte Leser muss dieselbe Regel tragen; `avesmapsAppSettingEnsureWideValue` nur aus Schreibern rufen (AGENTS §10).
- Verlauf: 05.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker) · 05.09.2026 GO Owner (zusammenlegen; alte Namen bleiben als Weiterreicher) · 15.09.2026 nachgezogen: d9ec0e669 (Beispielgebirge je Gebirgsform) hat die Datei bewegt; avesmapsEcosystemDisplayRead (jetzt Z. 412) und avesmapsZoomBandsRead (zoom-bands.php Z. 156) sind weiter gleich bis auf Namen, Konstanten und eine Umlautschreibung im Kommentar, block.frei

### P-031 · api/_internal/wiki/sync-monitor.php · Verfahren C
- Status: erledigt (e7c2d97b5)
- Stand: fc7a9fb5b · Blob: 511d66bbc8d1250af94f90894cce499881d0c49b
- Block: „Tabellen, Editorzustand und Status“ — avesmapsWikiSyncMonitorEnsureTables … avesmapsWikiSyncMonitorBuildStatus (7 Funktionen, ~270 Zeilen ab Z. 33)
- Ziel: api/_internal/wiki/sync-monitor-status.php, require_once an der Blockstelle
- Vorprüfung (17.09.2026): Ladezeit-Bezug 0 · Register 3 (alle in tools/refactoring/__tests__/vorpruefung.test.js -- die Fixture aus liste.md, Owner-Punkt 06.09.; kein echtes Register) · Quelltext-Tests 1 (dieselbe Fixture; Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 (die sieben Konstanten Z. 11-17 und die sechs require_once Z. 20-31 stehen vor der Blockstelle) · Datei 746 Zeilen, 80 Commits/180 d · Namens- und Fragmentpruefung gegen alle Tests, die sync-monitor.php ausserhalb einer require-Zeile nennen: kein Treffer
- Fallen: Kopfkommentar DEUTSCH (Dateikopf deutsch). Die Lib wird von rund zwanzig Tests und Werkzeugen mit BLANKEM `require` geladen (`tools/wikidump/test-dump-*.php`, `region-art-parsing-test.php:35`, `stadtteil-kategorie-test.php:28`) -- mit `require_once` in der Lib ist die Geschwisterdatei davor geschuetzt, aber genau diese Liste zeigt ein Redeclare zuerst: nach dem Schnitt die `tools/wikidump/test-*.php` einzeln fahren. avesmapsWikiSyncMonitorEnsureTables (153 Zeilen DDL) haengt heute an KEINEM `avesmapsSchemaEnsureOnce` -- wer ihn spaeter dort anbindet, nennt die GESCHWISTERDATEI als definierende Datei (AGENTS §10, der Schluessel traegt deren mtime). P-024s `require_once wiki-crawler-base.php` (Z. ~383) liegt ausserhalb; der Rest-Block Z. 387-548 (Enqueue … ResolveCanonicalTitles) liegt unter dem Boden des Fingerabdrucks.
- Verlauf: 17.09.2026 angelegt (Ueberwachungsmodus; der Block stand im Verlauf von P-012 als freier Rest) · 18.09.2026 erledigt als `e7c2d97b5` (-> sync-monitor-status.php, 746 -> 478 Zeilen; sieben Funktionen, die 270 verschobenen Zeilen byte-gleich; Fingerabdruck 283/271 = 4,2 %). Die Ortsangabe `sync-monitor.php:87` in media-license-migration-run.php:664 zeigte in den Block und wanderte mit (jetzt `sync-monitor-status.php:65`). Live belegt: Deploy-Lauf 35315244361 success, beide Lib-Dateien im Log uebertragen, `GET /api/edit/wiki/sync-monitor.php` (laedt die Kette in Z. 19, vor der Anmeldung) antwortet mit dem sauberen 401-Envelope statt eines Fatals. Drei Agenten ohne blockenden Fund

### P-032 · js/review/review-conflicts.js · Verfahren A
- Status: offen
- Stand: fc7a9fb5b · Blob: 3cce5c9a782cf610fd257b6887ea8c6c458fdde2
- Block: „Filter und Schiene der Konfliktliste“ — getLegacyConflicts … renderConflictRail (8 Funktionen, ~199 Zeilen ab Z. 265)
- Ziel: js/review/review-conflicts-filter.js, <script> direkt NACH review-conflicts.js in derselben `<template data-nur-editor>` (index.html Z. 3903-3907)
- Vorprüfung (17.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 1 (js/ui/__tests__/kanon-flaechen.test.js schneidet conflictPartyKanonBadge … createConflictPartyElement, ausserhalb; Blocknamen: 0) · vm-Bindung 2 (conflict-dublette-verben.test.js und conflict-resolve-complaints.test.js laden die GANZE Datei; Blocknamen nicht transitiv gebunden) · Konstanten fehlend 0 · Datei 1276 Zeilen, 34 Commits/180 d · Namens- und Fragmentpruefung: kein Treffer
- Fallen: 💣 Der Block liest `LEGACY_CASE_SEVERITY`, `LEGACY_COMMON_VERBS` und `LEGACY_RULE_INFO` -- `const` auf oberster Ebene von review-conflicts.js (Z. 151/171/178); die neue Datei steht NACH ihr, und nichts darin darf zur Ladezeit laufen (review-wiki-sync-cases.js:356-361 beschreibt genau diese Todeszone). 💣 index.html Z. 1641 nennt `review-conflicts.js` in einem HTML-Kommentar -- fuer einen Reihenfolgetest mit `html.indexOf(…)` ein frueheres Tag (AGENTS §11, Hintergrundklick). ⚠️ `js/app/__tests__/nur-editor-skripte.test.js`: eine Vorlage traegt nur `<script src>`-Tags, und die Freigaben aus Teil C gelten fuer Namen „in einer Vorlage“ -- die neue Datei gehoert in DIESELBE. ⚠️ Beide vm-Tests nach dem Schnitt fahren: sie laden nur review-conflicts.js. Kopfkommentar ENGLISCH wie der Dateikopf. Fingerabdruck: 199 Zeilen -- Kopf hoechstens 7 Zeilen.
- Verlauf: 17.09.2026 angelegt (Ueberwachungsmodus)

### P-033 · api/_internal/app/lore.php · Verfahren C
- Status: offen
- Stand: fc7a9fb5b · Blob: 8bb0980a2e29cffcfe58fd38657a70565f3a2e82
- Block: „Vorkommen fuer Orte samt Regeltreffern“ — avesmapsLoreReadForPlaces … avesmapsLoreMergeRuleHitsIntoResult (3 Funktionen, ~234 Zeilen ab Z. 1055)
- Ziel: api/_internal/app/lore-orte.php, require_once an der Blockstelle (der Block ist das Dateiende)
- Vorprüfung (17.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 1 (js/ui/__tests__/listen-statuskreis.test.js:405 bindet den Aufruf avesmapsLoreReadPlaceKeysOnMap(...) in Z. 483/765, ausserhalb; Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 1288 Zeilen, 26 Commits/180 d · Namenspruefung: lore-merge-rule-hits-test.php ruft MergeRuleHitsIntoResult zur Laufzeit nach `require_once lore.php` (transparent)
- Fallen: Kopfkommentar DEUTSCH. avesmapsLoreReadStats (Z. 1007) bleibt -- anderes Thema. P-021 (D, GO noetig) liegt in derselben Datei (avesmapsLoreReadPlaceKeysOnMap) ausserhalb; P-014 hat `lore-schluessel.php` abgespalten, Namensform lore-<thema>.php. Der Block davor (Z. 729-995, ReadMapStatusByEntry … ResolveGoodsByName) ist durch listen-statuskreis.test.js gebunden und bleibt.
- Verlauf: 17.09.2026 angelegt (Ueberwachungsmodus)

### P-034 · js/map-features/map-features-political-territory-loader.js · Verfahren A
- Status: offen
- Stand: fc7a9fb5b · Blob: b2fee85d4c1311cf1b5d69fa419e08182739eb94
- Block: „Abgeleitete Grenzen und Geometrie-Rueckfaelle der Ebene“ — readPoliticalTerritoryDerivedSourceIds … readPoliticalTerritoryLayerFallbacks (9 Funktionen, ~193 Zeilen ab Z. 240)
- Ziel: js/map-features/map-features-political-territory-fallbacks.js, <script> direkt NACH dem Loader (index.html Z. 4126, Besucherpfad, keine Vorlage)
- Vorprüfung (17.09.2026): Ladezeit-Bezug 0 · Register 2 (ebenen-pan-guard.test.js:25 und ebenen-zwischenspeicher.test.js:36 lesen den Loader als Text) · Quelltext-Tests 2 (dieselben; Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 853 Zeilen, 39 Commits/180 d · Namenspruefung: ebenen-zwischenspeicher.test.js:70 legt applyPoliticalTerritoryDerivedBoundaryVisibility als globale Attrappe an (kein Schnitt)
- Fallen: 💣 „Gepruefte Doppelungen ohne Paket“ unten: `readSourceIds` (map-features-derived-boundary-runtime-fix.js) ist der statische Rueckfall fuer die Ladeluecke, bis readPoliticalTerritoryDerivedSourceIds greift -- die neue Datei laedt DIREKT nach dem Loader, sonst verschiebt sich diese Luecke. ⚠️ Beide Register-Tests schneiden Funktionen des Pan-Guards und des Zwischenspeichers aus dem Loader (ausserhalb) und stubben Blocknamen -- nach dem Schnitt fahren. ⚠️ Die Stil-Anwendung davor (Z. 176-238, 4 Funktionen, 63 Zeilen) bleibt, zu klein. Jeder Besucher laedt die neue Datei. Fingerabdruck: 193 Zeilen -- Kopf hoechstens 7 Zeilen, sonst ueber 5 %.
- Verlauf: 17.09.2026 angelegt (Ueberwachungsmodus)

### P-035 · api/_internal/wiki/publication-parsing.php · Verfahren C
- Status: offen
- Stand: fc7a9fb5b · Blob: 424ae7d07c49ed6201127c5c54f8b44a9f228ebc
- Block: „Produkt-Infobox und Literaturart“ — avesmapsWikiProductGameLiteratureKind … avesmapsWikiBuildPublicationUrl (12 Funktionen, ~332 Zeilen ab Z. 282)
- Ziel: api/_internal/wiki/publication-parsing-produkt.php, require_once an der Blockstelle (der Block ist das Dateiende)
- Vorprüfung (17.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 · vm-Bindung 0 · Konstanten fehlend 0 · Datei 613 Zeilen, 16 Commits/180 d · Namenspruefung: publication-parsing-test.php ruft alle zwoelf zur Laufzeit nach require_once (transparent)
- Fallen: Kopfkommentar ENGLISCH, und der Reinheitsvertrag des Dateikopfs („Pure, DB-free wikitext parsers … no PDO, no HTTP, no dump reads“) gilt fuer die Geschwisterdatei mit. ⚠️ `citymap-sync-test.php:700-712` laedt die require-Kette des Dump-Endpunkts ueber eine feste Liste (`'/../publication-parsing.php'`) und prueft, dass jede fremde Funktion aus citymap-sync.php definiert ist -- transparent ueber require_once, nach dem Schnitt fahren. ⚠️ AGENTS §11 Literatur: die drei Rollen normalisiert avesmapsGameLiteratureNormalizeRole (game-literature.php:172), NICHT avesmapsGameLiteratureRoleForKind im Block -- nur der Ort aendert sich. Der Rest Z. 36-208 (Publikationsabschnitt, 173 Zeilen) liegt unter dem Boden.
- Verlauf: 17.09.2026 angelegt (Ueberwachungsmodus)

### P-036 · api/_internal/app/terrain-store.php · Verfahren C
- Status: offen
- Stand: fc7a9fb5b · Blob: 4ad5f4592d1feb0a72c4efc3c0a3031407806f3a
- Block: „Hoehenraster: Fingerabdruck, Ablage und Status“ — avesmapsTerrainGuardRasterShape … avesmapsTerrainHeightmapStatus (7 Funktionen, ~325 Zeilen ab Z. 80)
- Ziel: api/_internal/app/terrain-store-hoehenraster.php, require_once an der Blockstelle
- Vorprüfung (17.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 · vm-Bindung 0 · Konstanten fehlend 0 (die fuenf Konstanten Z. 36-72 stehen davor) · Datei 774 Zeilen, 12 Commits/180 d · Namenspruefung: terrain-store-test.php ruft Guard und Fingerprints zur Laufzeit (transparent)
- Fallen: Kopfkommentar ENGLISCH, und der PURITY CONTRACT des Dateikopfs gilt der Geschwisterdatei mit („side-effect-free on include“, „💣 NO avesmapsEcosystemEnsureTables ANYWHERE IN THIS FILE“). ⚠️ ZWEI Pakete auf derselben Datei (P-037): das `require_once` des einen darf nicht in den Block des anderen fallen (Lehre 06.09.2026); nach dem ersten Schnitt das zweite nachziehen. AGENTS §11 (Konfliktzentrum, label.duplicate): terrain-store.php liest `is_active = 1` + `height_schritt` der Gipfel-Beschriftungen -- nur der Ort aendert sich.
- Verlauf: 17.09.2026 angelegt (Ueberwachungsmodus)

### P-037 · api/_internal/app/terrain-store.php · Verfahren C
- Status: offen
- Stand: fc7a9fb5b · Blob: 4ad5f4592d1feb0a72c4efc3c0a3031407806f3a
- Block: „Hoehenprofile der Wege und Reiselaeufe“ — avesmapsTerrainProfileForLine … avesmapsTerrainTravelStatus (6 Funktionen, ~341 Zeilen ab Z. 434)
- Ziel: api/_internal/app/terrain-store-profile.php, require_once an der Blockstelle (der Block ist das Dateiende)
- Vorprüfung (17.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 · vm-Bindung 0 · Konstanten fehlend 0 · Datei 774 Zeilen, 12 Commits/180 d · Namenspruefung: terrain-store-test.php ruft avesmapsTerrainProfileForLine zur Laufzeit
- Fallen: 💣 AVESMAPS_TERRAIN_PROFILE_BATCH und …_BUDGET_MS stehen ZWISCHEN den beiden Bloecken (Z. ~410) -- das `require_once` gehoert hinter sie. AGENTS §11 (Wege-Editor): die vier Profilzahlen sind [Anstieg, Abstieg, steiler Anstieg, steiler Abstieg] in Speicherrichtung (avesmapsTerrainProfileForLine) -- nur der Ort aendert sich. Kopfkommentar und Reinheitsvertrag wie P-036.
- Verlauf: 17.09.2026 angelegt (Ueberwachungsmodus)

### P-038 · api/_internal/political/territories-audit.php · Verfahren C
- Status: offen
- Stand: fc7a9fb5b · Blob: 5fb64242d4b8afbef84e6b1857035ebb709ed232
- Block: „Schnappschuesse, Zaehlungen und Eintraege des Audits“ — avesmapsPoliticalAuditSnapshotsEqual … avesmapsPoliticalBuildMissingTerritoryEntryAudit (10 Funktionen, ~267 Zeilen ab Z. 628)
- Ziel: api/_internal/political/territories-audit-snapshots.php, require_once an der Blockstelle (der Block ist das Dateiende)
- Vorprüfung (17.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 1 (api/_internal/__tests__/audit-prune-test.php liest avesmapsPoliticalPruneGeometryAuditLog, ausserhalb; Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 894 Zeilen, 10 Commits/180 d · Namens- und Fragmentpruefung: kein Treffer
- Fallen: Kopfkommentar DEUTSCH. Z. 2 traegt einen Stempel-Heilungskommentar und Z. 7-13 drei require_once -- nicht anfassen. AGENTS §10: ein Protokoll-Schnappschuss wird nie nachgezogen, jeder LESER rechnet die bbox aus der Geometrie (avesmapsPoliticalApplyGeometryAuditSnapshot, ausserhalb); avesmapsPoliticalBuildGeometryAuditSnapshot hier baut sie nur -- der Ort aendert sich, sonst nichts. Historiker 17.09.2026: FetchTerritoryByPublicIdForAudit/…ByIdForAudit sind KEINE Doppelung von avesmapsPoliticalFetchGeometryRowByPublicIdRaw (drei Tabellen) -- nicht zusammenlegen.
- Verlauf: 17.09.2026 angelegt (Ueberwachungsmodus)

### P-039 · api/_internal/wiki/sync-plan.php · Verfahren C
- Status: offen
- Stand: fc7a9fb5b · Blob: 38f22f674f41265ae8a5db17f25f20b691db0042
- Block: „Laeufe und Positionen des Plans“ — avesmapsSyncPlanBuildingRun … avesmapsSyncPlanPendingItems (11 Funktionen, ~204 Zeilen ab Z. 371)
- Ziel: api/_internal/wiki/sync-plan-laeufe.php, require_once an der Blockstelle
- Vorprüfung (17.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 2 (lore-regeln-kachel.test.js: avesmapsSyncPlanStartRun; territory-plan-test.php: SelectedKeys, RecordSkip, MarkItem, SupersedeRuns -- alle ausserhalb; Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 1025 Zeilen, 11 Commits/180 d · Namenspruefung: garetien-uebernahme-test.php ruft OpenRun, AddItem, SetSelection, PendingItems zur Laufzeit
- Fallen: Kopfkommentar ENGLISCH. ⚠️ sync-plan-endpoint-chain-test.php und sync-monitor-endpoint-chain-test.php laden die require-Ketten der Endpunkte und pruefen, dass jede fremde Funktion der Rechen-/Ausfuehr-Haelften definiert ist -- transparent ueber require_once, nach dem Schnitt fahren. AGENTS §11 Uebernahme-Vorschau: der Loeschriegel steht serverseitig in `apply` -- nur der Ort der Lauf-Helfer aendert sich. Die Entscheidungen Z. 719-927 sind gebunden (Abschnitt „Von Tests am Quelltext festgehalten“). Fingerabdruck: 204 Zeilen -- Overhead hoechstens 10.
- Verlauf: 17.09.2026 angelegt (Ueberwachungsmodus)

### P-040 · js/review/review-wiki-sync-cases.js · Verfahren A
- Status: offen
- Stand: fc7a9fb5b · Blob: 8abc7b7bfcecf66308e5083461f45801bbab73cd
- Block: „Filter und Gruppierung der Fallliste“ — getWikiSyncOpenGroupKeys … getWikiSyncGroupedCases (13 Funktionen, ~210 Zeilen ab Z. 96)
- Ziel: js/review/review-wiki-sync-cases-filter.js, <script> direkt nach review-wiki-sync-cases.js in derselben `<template data-nur-editor>` (index.html Z. 3903-3907)
- Vorprüfung (17.09.2026): Ladezeit-Bezug 0 · Register 3 (wikisync-faelle-erst-beim-oeffnen.test.js:24, tools/paths/test-wiki-sync-panel-tab.mjs:114, tools/refactoring/__tests__/vorpruefung.test.js:107 -- Fixture) · Quelltext-Tests 3 (wikisync-faelle-erst-beim-oeffnen.test.js: renderWikiSyncCases/…WennAusstehend; tools/wikidump/test-wikidump-frontend-cases.mjs: getWikiSyncCaseTypeOrder/…Label/readWikiSyncDriftLatLng -- alle ausserhalb; Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 926 Zeilen, 11 Commits/180 d · Namenspruefung: wikisync-faelle-erst-beim-oeffnen.test.js stubbt sechs Blocknamen global (kein Schnitt)
- Fallen: 💣 `tools/paths/test-wiki-sync-panel-tab.mjs:114` fuehrt die Dateiliste `searched` von Hand (Lehre 02.09.2026) -- die neue Datei gehoert in dieselbe Zeile. ⚠️ nur-editor-skripte.test.js (Vorlage, siehe P-032). ⚠️ getWikiSyncCaseTypeOrder/…Label (Z. 307-350) sind gebunden und bleiben -- der Block endet davor. P-041 liegt auf derselben Datei (Lehre 06.09.2026). Kopfkommentar ENGLISCH wie der Dateikopf.
- Verlauf: 17.09.2026 angelegt (Ueberwachungsmodus)

### P-041 · js/review/review-wiki-sync-cases.js · Verfahren A
- Status: offen
- Stand: fc7a9fb5b · Blob: 8abc7b7bfcecf66308e5083461f45801bbab73cd
- Block: „Fall-Elemente bauen“ — getWikiSyncCaseTypeHint … appendCoordinateDriftCaseBody (9 Funktionen, ~369 Zeilen ab Z. 364)
- Ziel: js/review/review-wiki-sync-cases-elemente.js, <script> direkt nach review-wiki-sync-cases.js in derselben Vorlage
- Vorprüfung (17.09.2026): Ladezeit-Bezug 0 · Register 3 (wie P-040) · Quelltext-Tests 3 (wie P-040; Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 926 Zeilen, 11 Commits/180 d · Fragmentpruefung: test-wiki-sync-panel-tab.mjs sucht per Regex `typeof (\w+) === "function"` -- Treffer NUR im Block
- Fallen: 💣 test-wiki-sync-panel-tab.mjs ist hier doppelt Register: Dateiliste UND typeof-Scan ueber genau diese Liste -- ohne die neue Datei darin sieht der Test die Waechter im Block nicht mehr (still, nicht rot). 💣 Der Kommentar Z. 356-361 direkt ueber dem Block: getWikiSyncCaseTypeHint liest LEGACY_RULE_INFO aus review-conflicts.js zur Aufrufzeit -- nichts im Block darf zur Ladezeit laufen. ⚠️ createWikiSyncCaseElement wird aus review-conflicts.js gerufen (Z. 819 hier). ⚠️ readWikiSyncDriftLatLng (Z. 749, ausserhalb) ist Teil der Doppelung P-052.
- Verlauf: 17.09.2026 angelegt (Ueberwachungsmodus)

### P-042 · api/_internal/conflicts/repair.php · Verfahren C
- Status: offen
- Stand: fc7a9fb5b · Blob: c3476654b004ed7604305652014ce36fa64d6a34
- Block: „Reparaturverben Verknuepfen und Dublette loeschen“ — avesmapsConflictLinkRowRefusal … avesmapsConflictDeleteLabel (7 Funktionen, ~387 Zeilen ab Z. 366)
- Ziel: api/_internal/conflicts/repair-verben.php, require_once an der Blockstelle
- Vorprüfung (17.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 1 (kein-wiki-eintrag-ist-weg-test.php: avesmapsConflictResolve/…UnlinkFeature, ausserhalb; Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 870 Zeilen, 13 Commits/180 d · Namenspruefung: conflict-label-delete-test.php ruft vier Blockfunktionen zur Laufzeit
- Fallen: Kopfkommentar ENGLISCH (Docblock-Stil wie der Dateikopf), und dessen „TWO SAFETY RULES“ gelten beiden Dateien. AGENTS §11 label.duplicate: `refuse_ecosystem_cascade` steht im Rumpf von avesmapsDeleteMapFeature (features.php), die zweite Rueckfrage beim Hoehenfeld im Browser -- avesmapsConflictDeleteLabel reicht nur durch; nichts davon wandert.
- Verlauf: 17.09.2026 angelegt (Ueberwachungsmodus)

### P-043 · api/_internal/wiki/publication-sync.php · Verfahren C
- Status: GO nötig
- Stand: fc7a9fb5b · Blob: 4edc740136c8c3d05395cb625e601aeb4acf8631
- Block: „Doppelung: Skelett der Wiki-Abgleiche“ — avesmapsPublicationDefaultPageSource … avesmapsPublicationDefaultPageSource (Familie in fuenf Gruppen: DefaultPageSource ×4 citymap-sync.php:560 · game-literature-sync.php:384 · lore-sync.php:330 · publication-sync.php:466; LastStaged ×3 citymap-sync.php:791 · game-literature-sync.php:983 · publication-sync.php:1390; DecodeOrigins ×2 game-literature-sync.php:591 · lore-sync.php:605; LastSynced ×3 citymap-sync.php:738 · lore-sync.php:520 · powerlines.php:52; StampLastSynced ×3 citymap-sync.php:771 · game-literature-sync.php:1171 · lore-sync.php:551)
- Ziel: DefaultPageSource und LastStaged in eine abhaengigkeitsfreie Datei (`api/_internal/wiki/wiki-abgleich-skelett.php`: `avesmapsWikiDefaultPageSource()`, `avesmapsWikiCatalogLastStaged($pdo, $tabelle)`); DecodeOrigins neben `api/_internal/map/field-origins.php`, wo die Herkunftsregel wohnt; LastSynced/StampLastSynced nur als KERN (`…($pdo, $settingKey)`) -- alle alten Namen bleiben als Einzeiler-Weiterreicher
- Unterschied: keiner ausser Namen, Setting-Konstante bzw. Tabellenname; bei DecodeOrigins die Kommentarsprache
- Warum: Kopie je neuem Abgleich: DefaultPageSource publication a7539689f (09.07.2026, Original) → game-literature 53530c7b4 (13.07.) → citymap b390cb77c (17.07.) → lore 3f4636263 (21.07.), jede Kopie nennt ihre Vorlage im Kommentar; LastSynced 927a6a135 (17.07.) → de2e5007a (22.07.) → 9cd1034b4 (23.07., „Mirrors avesmapsLoreLastSynced“); StampLastSynced 05285839a (25.08., Karte und Literatur in einem Commit) → 289d0b2a9 (06.09., Vorkommen); DecodeOrigins 53530c7b4 → aa50861df (06.08.). `46981a607` (14.09.2026) hat bewusst nur einen gemeinsamen KONSUMENTEN gebaut (`dump-sync-kind.php:153-223`) und die Leser getrennt ladbar gelassen (Kommentar Z. 177-180).
- Empfehlung: zusammenlegen, in dieser Reihenfolge: DefaultPageSource (klarster Fall, kein Test pinnt) → LastStaged → DecodeOrigins → LastSynced/Stamp nur als Kern mit Weiterreichern
- Beleg: `git blame -w` je Fundstelle; `grep -rn "DefaultPageSource\|LastStaged\|DecodeOrigins" api/_internal/wiki/__tests__` → leer; `api/_internal/wiki/__tests__/sync-lauf-stempel-test.php:203-280`
- Fallen: 💣 `sync-lauf-stempel-test.php:203-280` pinnt die Aufrufe `avesmaps{Citymap,GameLiterature,Lore}StampLastSynced(` per str_contains in den `*-plan-apply.php` und den Fallzweigen von `dump.php` und prueft ihre ABWESENHEIT im PlanStep-Rumpf -- die drei Namen sind Pflicht, nicht Hoeflichkeit. 💣 Die neue Datei darf `app-setting.php` NICHT requiren: `powerlines.php:33-36` begruendet, warum die Leser ueber `function_exists` gefragt werden (jeder Kontext laedt eine andere Teilmenge). ⚠️ Kraftlinien haben keinen eigenen Stempler (inline in avesmapsWikiPowerlineReconcile, keine Rechen-/Ausfuehr-Trennung) -- nicht hineinziehen. ⚠️ `$tabelle` bei LastStaged ist immer eine Konstante des Aufrufers, nie Eingabe. ⚠️ Nebendateien ungleich kalt (game-literature-sync.php zuletzt 14.09.).
- Verlauf: 17.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker) -- 15 Paare in einer Familie

### P-044 · api/_internal/political/territories-support.php · Verfahren C
- Status: GO nötig
- Stand: fc7a9fb5b · Blob: 2fc1d40badfd5dac43f539da46e8eb0238db12b0
- Block: „Doppelung: Geometrie-Kleinhelfer“ — avesmapsPoliticalCollectCoordinatePairs … avesmapsPoliticalCollectCoordinatePairs (Sammler dreifach: territories-support.php:94 · `api/_internal/map/features.php:820` avesmapsCollectGeometryCoordinatePairs · `api/_internal/audit-focus.php:133` avesmapsAuditCollectCoordinatePairs; bbox aus Geometrie zweifach: `features.php:802` avesmapsCalculateGeometryBounds ~ `territories-geometry.php:1535` avesmapsPoliticalCalculateGeometryBounds)
- Ziel: eine reine, domaenenneutrale Datei (`api/_internal/geo/coordinate-pairs.php`, Vorbild `api/_internal/text/ascii-fold.php`) mit dem Sammler und einem bbox-KERN, der nicht wirft; alle Namen bleiben als Weiterreicher, die bbox-Weiterreicher behalten ihre Exception-Klasse
- Unterschied: Sammler: keiner ausser Namen/Klammerstil. bbox: nur die Exception-Klasse -- `RuntimeException` (map) gegen `InvalidArgumentException` (political), und die ist VERDRAHTET: die Map-Endpunkte antworten darauf 503 `service_unavailable` (api/edit/map/features.php:115/129, audit-log.php:48/52), der politische 400 `invalid_request` (territories-endpoint.php:309/313)
- Warum: 7321512ed (13.05.2026, map, „Extend review change undo“) → d760df69e (15.05., political, adaptierte Kopie mit anderer Exception); die dritte Sammler-Fassung kam mit 602637b0f (06.09.) -- deren „steht jetzt einmal“ meinte die Fokus-Umrechnung, nicht den Sammler darunter
- Empfehlung: zusammenlegen -- der Sammler direkt, bbox als Kern plus zwei Wrapper, die ihre Exception-Klasse behalten
- Beleg: `git blame -w -L 802,818 -- api/_internal/map/features.php`, `-L 1535,1551 -- territories-geometry.php`, `-L 133,147 -- audit-focus.php`, `-L 820,832 -- features.php`, `-L 94,106 -- territories-support.php`; `grep -n "catch (InvalidArgumentException\|catch (RuntimeException"` in den drei Endpunkten
- Fallen: 💣 Eine Textzusammenlegung der bbox-Fassungen kippt lautlos den HTTP-Code eines Live-Endpunkts (400 ↔ 503); kein Test prueft den Pfad „Geometrie ohne Koordinaten“. ⚠️ `audit-focus.php` traegt einen Reinheitsvertrag und wird aus vier Domaenen eingebunden -- die neue Datei ebenso rein, kein Code auf oberster Ebene. ⚠️ features.php ist heiss (Nebendatei).
- Verlauf: 17.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker)

### P-045 · api/_internal/wiki/locations-helpers.php · Verfahren C
- Status: GO nötig
- Stand: fc7a9fb5b · Blob: b9a6f68faaf03103b09f801be58accfd65f879ad
- Block: „Doppelung: Sperrtabelle map_feature_locks anlegen“ — avesmapsWikiSyncEnsureMapFeatureLocksTable … avesmapsWikiSyncEnsureMapFeatureLocksTable (Zwilling `api/_internal/map/features.php:1283` avesmapsEnsureMapFeatureLocksTable)
- Ziel: eine gemeinsame Ensure-Funktion in einer neutralen Datei ohne Map- oder Wiki-Abhaengigkeit; beide Namen bleiben als Weiterreicher
- Unterschied: keiner (DDL zeichengleich)
- Warum: eine Definition seit 57994ce6b (08.05.2026, „Add editor conflict protection“); 883115de8 (20.05.) kopierte sie in die WikiSync-Ortsbibliothek, damit die Ortsbearbeitung die Sperre ohne die Editor-Lib pruefen kann; beide Kopien wanderten am 14.06.2026 in die M5-Splits (192bae223 → features.php, fd8de3a58 → locations-helpers.php)
- Empfehlung: zusammenlegen
- Beleg: `git log --all -S "CREATE TABLE IF NOT EXISTS map_feature_locks"`; `git blame -w -L 1283,1295 -- api/_internal/map/features.php`, `-L 126,138 -- api/_internal/wiki/locations-helpers.php`; `grep -rn EnsureMapFeatureLocksTable --include=*.php`
- Fallen: 💣 `avesmapsEnsureMapFeatureLocksTableEinmal` (features.php:1299) ruft `avesmapsSchemaEnsureOnce('map_feature_locks', __FILE__, …)` -- der Schluessel traegt die mtime der DEFINIERENDEN Datei (AGENTS §10). Zieht die DDL um, muss der Wrapper die NEUE Datei nennen; mit `__FILE__` = features.php liefe eine spaeter ergaenzte Spalte bis zu eine Stunde in „Unknown column“ (der Historiker las das andersherum -- AGENTS §10 gilt). ⚠️ `garetien-uebernahme.php:3846` ruft die rohe Fassung; `schema-ensure-once-test.php:67` prueft die Aufrufzeile in `api/edit/map/features.php`. ⚠️ features.php ist heiss (Nebendatei).
- Verlauf: 17.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker)

### P-046 · api/_internal/routing/map-data.php · Verfahren C
- Status: GO nötig
- Stand: fc7a9fb5b · Blob: 792046ebe6d89378dff14c51fb8f004748a722a0
- Block: „Doppelung: JSON-Spalte dekodieren“ — avesmapsDecodeRouteMapJsonColumn … avesmapsDecodeRouteMapJsonColumn (fuenffach: `api/_internal/political/territory.php:874` avesmapsPoliticalDecodeJson · `api/_internal/wiki/sync.php:79` avesmapsWikiSyncDecodeJson · `api/app/map-features.php:1006` avesmapsDecodeJsonColumn · `api/app/map-search.php:789` avesmapsDecodeJsonColumnForSearch)
- Ziel: `api/_internal/text/json-column.php` (Blattdatei ohne eigene require, Muster `ascii-fold.php`); territory.php und sync.php requiren sie und behalten ihre Namen (sie sind die Domaenen-Singletons mit 12 bzw. 14 Aufruferdateien); die drei Privatkopien werden Weiterreicher
- Unterschied: keiner -- `JSON_THROW_ON_ERROR`, `JsonException`, `[]` bei null/''/Nicht-Array in allen fuenf; nur Variablenname und Einrueckung
- Warum: fuenf Features an fuenf Tagen: a1ce7c11f (06.05.2026, SQL-Fundament) · 1e59daad3 (12.05., WikiSync) · c1d972d65 (13.05., Spotlight-Suche) · d760df69e (15.05., Territorien) · b512e9f63 (25.05., Routing-Kartendaten); an keiner Stelle ein Kommentar, warum neu statt eingebunden
- Empfehlung: zusammenlegen
- Beleg: `git log --all -S'function <name>('` je Fassung; `grep -rn "avesmapsPoliticalDecodeJson(\|avesmapsWikiSyncDecodeJson(" api --include=*.php`
- Fallen: 💣 NICHT nach `bootstrap.php`: territory.php und sync.php sind ausdruecklich ohne Bootstrap ladbar (`api/_internal/media-license-migration-run.php:20`, `wikisync-fall-no-article-test.php:43`). ⚠️ `api/app/__tests__/wege-suche-weitere-test.php` schneidet vier ANDERE Namen aus map-search.php und bringt fuer …ForSearch eine eigene Attrappe mit -- nachfahren. ⚠️ `avesmapsDecodeJsonColumnForEdit` (features.php:~4057) sieht gleich aus, wird aber von kraftlinie-kurve-schreiben-test.php woertlich zitiert -- nicht hineinziehen. ⚠️ map-features.php und map-search.php sind ENDPUNKTE: sie requiren die neue Datei, niemand requiret sie.
- Verlauf: 17.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker) -- 10 Paare

### P-047 · api/app/contact.php · Verfahren C
- Status: GO nötig
- Stand: fc7a9fb5b · Blob: 07f82bf172ae85d7d7bf28b240fdc92fda58ae21
- Block: „Doppelung: Spam-Erkennung der zwei Formulare“ — avesmapsContactContainsSpam … avesmapsContactIsLinkOnly (Zwillinge `api/app/report-location.php:410` avesmapsContainsSpamText und `:421` avesmapsIsLinkOnlyText)
- Ziel: die reine Erkennung in eine neue `_internal`-Datei (`avesmapsTextContainsSpamWord($wert, $woerter)`, `avesmapsTextIsLinkOnly($wert)`); jede Datei reicht ihre EIGENE Wortliste herein, die alten Namen bleiben als Weiterreicher
- Unterschied: ContainsSpam: Rumpf gleich bis auf die Konstante; IsLinkOnly: byte-gleich. Die Listen selbst unterscheiden sich: contact.php 9 Woerter, report-location.php 7 (`bitcoin` und `forex` nur beim Kontakt) -- nirgends begruendet
- Warum: report-location d3ef9bfc1 (09.05.2026, „report spam filtering“) → contact 85882c44b (29.06., Kontaktformular kopiert das Muster, erweitert die eigene Liste, nie zurueckgeglichen)
- Empfehlung: zusammenlegen, NUR die Mechanik; die Listendrift ist eine eigene Owner-Frage (liste.md)
- Beleg: `sed -n 129,148p api/app/contact.php`; `sed -n 410,429p api/app/report-location.php`; Kopf von `api/_internal/app/report-outcome.php`; `api/_internal/app/__tests__/report-outcome-test.php`
- Fallen: 💣 Beide Dateien sind ENDPUNKTE (Handler ab `try` Z. 13 bzw. 78) -- keiner kann den anderen requiren. 💣 Oracle-Schutz von report-location (c6ceb9814, 05.08.2026): Link-only-Pruefung VOR der Wortpruefung, beide mit 201 -- `report-outcome-test.php` nagelt Reihenfolge und Position am Quelltext fest; die Reihenfolge gehoert dem Endpunkt und bleibt unberuehrt. ⚠️ Vorpruefung meldet 2 Register (js/app/legal-contact-form.js:32, js/config.js:275) -- vor dem Bau lesen.
- Verlauf: 17.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker) -- dazu das byte-gleiche vierte Paar IsLinkOnly, das der Scan nicht meldete

### P-048 · api/_internal/routing/synthetic-refine.php · Verfahren C
- Status: GO nötig
- Stand: fc7a9fb5b · Blob: 03e5dd0a0cb420e37539a712f272a27e8226865b
- Block: „Doppelung: Routing-Kante entfernen“ — avesmapsRemoveClientRouteConnectionById … avesmapsRemoveClientRouteConnectionById (Zwilling `api/_internal/routing/client-graph.php:1578` avesmapsRemoveClientRouteConnection)
- Ziel: der einzige Aufruf (synthetic-refine.php:90) ruft avesmapsRemoveClientRouteConnection; …ById bleibt als Einzeiler-Weiterreicher (oder faellt auf Owner-Wort)
- Unterschied: Rumpf byte-gleich; der Docblock ohne „wieder“ und ohne Herkunftsabsatz
- Warum: d241d97b8 (02.08.2026) legte …ById an, als die kanonische Fassung noch in detour.php lag und synthetic-refine.php keinen Weg dorthin hatte; 4acf6f3e1 (14.08., „Zwei Abschriften derselben Graph-Operation waeren zwei zu viel“) zog sie nach client-graph.php -- seither erreicht synthetic-refine.php sie ueber offroad-leg.php → client-graph.php, und die Kopie ist ueberfluessig; niemand hat es bemerkt
- Empfehlung: zusammenlegen (die juengere ist seit dem 14.08.2026 ueberfluessig)
- Beleg: `git blame -w -L 146,155 -- api/_internal/routing/synthetic-refine.php` (d241d97b8), `-L 1572,1587 -- client-graph.php` (4acf6f3e1); `grep -n "^require" api/_internal/routing/{synthetic-refine,offroad-leg,client-graph}.php`; `grep -rn RemoveClientRouteConnection api/_internal/routing/__tests__` → leer
- Fallen: Kein Test pinnt den Namen; das Verhalten pruefen synthetic-refine-test.php und abgangspunkt-test.php -- nach dem Schnitt fahren. AGENTS §11 Routing: synthetic-refine.php biegt nur die Geometrie bereits gepruefter Kanten -- nur der Aufrufweg aendert sich.
- Verlauf: 17.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker)

### P-049 · html/citymap-editor.html · Verfahren B
- Status: GO nötig
- Stand: fc7a9fb5b · Blob: 4b8890ed6326848f3fb6037d8c45176c8ab7dac8
- Block: „Doppelung: POST-Huelle der Editorseiten“ — citymapPost … citymapPost (achtfach: citymap-editor.html:699 · game-literature-editor.html:647 · wiki-sync-monitor.html:1880 · wiki-sync-powerline-editor.html:222 · wiki-sync-settlement-editor.html:1702 settlementDetailPost, :2294, :5089 zoomBandsPost; dazu js/review/review-citymap-autoget.js:25 submitCitymapAutogetAction ~ review-game-literature-cover-autoget.js:24 submitGameLiteratureCoverAutogetAction)
- Ziel: eine geteilte Datei mit `avesmapsEditorPost(url, body)` nach dem Vorbild `js/review/sync-plan-sheet.js:809` (syncPlanDefaultPost); jede iframe-Seite laedt sie per eigenem `<script src>`, die alten Namen bleiben inline als Einzeiler
- Unterschied: keiner ausser der Endpunkt-Konstante (POST, JSON, `payload.ok !== true` wirft)
- Warum: je neuer Editorfunktion abgeschrieben: settlement ca113e7b2 (08.07.2026) → citymap 2b6bf972c (16.07.) → Zoombaender f40ff253c (16.08.); Autoget fcfaa8eb7 (17.07.) → 053cd61c0 (18.07.); kein Kommentar verweist auf die Geschwister. Der Scan mit `--min 10` fand nur 3 der 8 Huellen
- Empfehlung: zusammenlegen
- Beleg: `grep -rn "^\s*async function \w*Post(body)" html js`; `git blame -w` je Fundstelle
- Fallen: 💣 settlementDetailPost ist vm-transitiv gebunden (ueber renderSettlementDetail; mehr als zehn Tests laden wiki-sync-settlement-editor.html ganz) -- ohne die neue Datei im selben vm-Kontext wird jeder Aufruf dort zum ReferenceError. 💣 Die Editorseiten sind eigenstaendige iframe-Dokumente (AGENTS §11, Sammelmenue): je Seite ein eigenes `<script src>`. ⚠️ Die Vorpruefung meldet fuer citymapPost Ladezeit-Bezuege (Z. 2098, 2235-2247) -- der Name muss beim Laden stehen, der Weiterreicher bleibt inline. ⚠️ Verfahren B: der Stempler laeuft ueber html/*.html, kein Hand-?v=.
- Verlauf: 17.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker) -- der Historiker fand die fuenf weiteren Kopien

### P-050 · js/review/review-region-sync.js · Verfahren A
- Status: GO nötig
- Stand: fc7a9fb5b · Blob: dc0a1faace1a6ae1deab164bc2702b6183e59ee8
- Block: „Doppelung: Kontinent-Filteroptionen“ — regionContinentOptions … regionContinentOptions (Zwilling `js/review/review-path-sync.js:61` pathContinentOptions)
- Ziel: eine Funktion mit Zeilenquelle und Kontinent-Leser als Parameter; beide Namen bleiben
- Unterschied: nur die Modulvariable (pathSyncData/regionSyncData) und der Zeilen-Leser (pathRowContinent/regionRowContinent)
- Warum: EIN Commit 07a9d3295 (22.06.2026, „add continent filter to region/path/settlement editor lists“) -- bewusst dreifach gebaut; Region und Weg laufen im selben Dokument (index.html Z. 3811/3817)
- Empfehlung: zusammenlegen fuer Region und Weg; `settlementContinentOptions` NICHT (iframe-Kopie, im Code als „mirrors“ dokumentiert)
- Beleg: `git blame -w -L 61,74 -- js/review/review-path-sync.js` und `-L 37,50 -- js/review/review-region-sync.js` → beide 07a9d3295
- Fallen: 💣 review-path-sync.js ist als GANZE Datei vm-gebunden (liste.md „Verworfen“, 04.09.2026: drei Tests laden sie allein und binden 51 von 52 Funktionen transitiv) -- steht der Rumpf von pathContinentOptions danach in einer Datei, die diese Tests nicht laden, bricht der Weiterreicher dort. Vorher die drei Lader lesen. ⚠️ Die Vorpruefung meldet fuer regionContinentOptions einen Ladezeit-Bezug (Z. 450) -- der Name muss beim Laden stehen.
- Verlauf: 17.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker)

### P-051 · js/map-features/map-features-citymaps.js · Verfahren A
- Status: GO nötig
- Stand: fc7a9fb5b · Blob: b7f1d11aceeb738aac93284e72d8fbf7b8649615
- Block: „Doppelung: Ortsbezug eines Werks bauen“ — avesmapsBuildCitymapPlaceRef … avesmapsBuildCitymapPlaceRef (Zwilling `js/map-features/map-features-game-literature.js:532` avesmapsBuildGameLiteraturePlaceRef)
- Ziel: `avesmapsBuildPlaceRef(placeRef, normalizeKeyFn)` in einer Datei, die vor beiden laedt; beide Namen bleiben
- Unterschied: nur der Normalisierer im else-Zweig (avesmapsNormalizeCitymapKey gegen avesmapsNormalizeGameLiteratureKey); die Normalisierer selbst unterscheiden sich (Literatur hat einen NFD-Rueckfall) und bleiben getrennt
- Warum: bd24cc22e (12.07.2026, Abenteuer; 07.08. mit da302a2ae umbenannt) → 2b6bf972c (16.07., Karten) -- Abschrift in die Nachbardomaene
- Empfehlung: zusammenlegen
- Beleg: `git blame -w -L 475,488 -- js/map-features/map-features-citymaps.js`, `-L 532,545 -- js/map-features/map-features-game-literature.js`; `grep -rln "BuildCitymapPlaceRef\|BuildGameLiteraturePlaceRef" js tools` → nur die Quelldateien
- Fallen: Beide sind Besucher-Skripte (index.html Z. 4228/4235) -- die geteilte Datei laedt vor beiden, und jeder Besucher laedt sie; kein Test nennt die Namen.
- Verlauf: 17.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker)

### P-052 · js/review/review-wiki-sync-resolve.js · Verfahren A
- Status: GO nötig
- Stand: fc7a9fb5b · Blob: 1b5dd2c0e017fb2c570798c52f6bfcec97ec52a1
- Block: „Doppelung: Lage eines WikiSync-Falls lesen“ — normalizeWikiSyncLatLng … normalizeWikiSyncLatLng (Zwilling `js/review/review-wiki-sync-cases.js:749` readWikiSyncDriftLatLng)
- Ziel: readWikiSyncDriftLatLng wird Weiterreicher auf normalizeWikiSyncLatLng (beide Dateien in derselben Vorlage, index.html Z. 3904-3906)
- Unterschied: keiner ausser dem Parameternamen
- Warum: 7a76f8bf3 (14.06.2026) zuerst; afa6d01d5 (03.07.) legte die Parallelfunktion mit dem Kommentar „same convention as payload.proposed_location (review-wiki-sync-resolve.js)“ an -- der Autor kannte die andere
- Empfehlung: zusammenlegen
- Beleg: `git blame -w -L 749,759 -- js/review/review-wiki-sync-cases.js` (afa6d01d5), `-L 450,462 -- js/review/review-wiki-sync-resolve.js` (7a76f8bf3)
- Fallen: 💣 `tools/wikidump/test-wikidump-frontend-cases.mjs:60` schneidet readWikiSyncDriftLatLng per extractFunction aus review-wiki-sync-cases.js und fuehrt sie aus -- ein Weiterreicher auf eine Funktion, die der Test nicht laedt, bricht ihn (Testharnisch, Owner-Sache). ⚠️ Die Vorpruefung meldet fuer normalizeWikiSyncLatLng Ladezeit-Bezuege (Z. 417-420).
- Verlauf: 17.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker)

### P-053 · js/map-features/map-features-derived-boundary-context-action.js · Verfahren A
- Status: GO nötig
- Stand: fc7a9fb5b · Blob: 425c79ca4cabf99463e31bc54054db78c8ae60c3
- Block: „Doppelung: Ringflaeche (Gausssche Trapezformel)“ — avesmapsDerivedTargetRingArea … avesmapsDerivedTargetRingArea (Zwilling `js/map-features/map-features-ecosystem-geometry.js:86` ecosystemRingArea)
- Ziel: avesmapsDerivedTargetRingArea ruft ecosystemRingArea (oder beide eine neutrale Geometriedatei); die Namen bleiben
- Unterschied: keiner ausser Variablennamen
- Warum: 491e85629 (26.07.2026; der Dateikopf warnt ausdruecklich vor Duplikaten wie pointInGeometry) → a963b5ec2 (25.08.) unabhaengig neu geschrieben
- Empfehlung: zusammenlegen
- Beleg: `git blame -w -L 72,80 -- js/map-features/map-features-derived-boundary-context-action.js` (a963b5ec2), `-L 86,95 -- js/map-features/map-features-ecosystem-geometry.js` (491e85629)
- Fallen: ⚠️ Z. 72 steht VOR der IIFE der Datei (Z. 82) -- globale Funktion, kein IIFE-Fall. 💣 ZWEI Ladewege: im Browser laedt `map-features-political-territory-repository.js:101-105` die Datei dynamisch nach (Register 2), ecosystem-geometry.js steht fest in index.html Z. 3960; in Node `require()`n `ecosystem-geometry.test.js:6` und `derived-boundary-ziel-punkt.test.js:35` die Dateien einzeln -- dort gibt es keinen gemeinsamen globalen Raum (dieselbe Falle wie bei featureSourcePagesShorten, AGENTS §11 Quellenliste).
- Verlauf: 17.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker)

### P-054 · js/ui/wiki-assign-literatur.js · Verfahren A
- Status: GO nötig
- Stand: fc7a9fb5b · Blob: a344d08f0873ec91dc13533230f2243e9760c8e8
- Block: „Doppelung: Kleinhelfer der Wiki-Zuweisungs-Datenwege“ — avesmapsWikiAssignLiteraturHerkunft … avesmapsWikiAssignLiteraturHerkunft (Herkunft vierfach: wiki-assign-literatur.js:130 · wiki-assign-ort.js:322 · wiki-assign-landschaft.js:444 generalisiert · inline wiki-feld-herkunft.js:88 in avesmapsWikiFeldStand; Kartenwerte dreifach wiki-assign-landschaft.js:378 · -literatur.js:208 · -territorium.js:250, dazu inline wiki-assign-ort.js:291-301; SyncWerte -literatur.js:281 ~ -ort.js:379, Landschaft schon generalisiert als …SyncWerteFuer)
- Ziel: `avesmapsWikiFeldHerkunftFilter(herkunft, felder)` in `js/ui/wiki-feld-herkunft.js` (ersetzt auch Z. 88), `avesmapsWikiAssignKartenwerte(quelle, felder, normalisiere)` und die angehobene SyncWerteFuer-Form in einer reinen geteilten Datei; alle Namen bleiben unter `module.exports`
- Unterschied: keiner im Rumpf (Kartenwerte bis auf den je eigenen *Text-Aufruf); die SyncWerte des Territoriums sind eine echte Variante mit Eltern-Aufloesung und bleiben
- Warum: alles am 16./17.08.2026 im Umbau „Wiki-Zuweisung vereinheitlichen“: Ort 406fa96c6 (06:53, Original, inline) → Territorium 6a2c0f623 → Landschaft bf2a74567/374b82da8 → Literatur ddb0b9661; Herkunft 1cf269f9e (17.08.) erzeugte zwei Fassungen in EINEM Commit, 85cd1e62b die dritte. Entwurf `docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md` §3a schuetzt nur die Feldzuordnung, nicht diese objektartlose Mechanik
- Empfehlung: zusammenlegen -- Herkunft zuerst (vierfach, eine davon in der Datei, die genau das buendeln soll), dann Kartenwerte, dann SyncWerte; `*Treffer` (Karte ~ Ort) NICHT (zwei einfache von sechs Varianten)
- Beleg: `git blame -w -L 130,140 -- js/ui/wiki-assign-literatur.js`, `-L 322,332 -- js/ui/wiki-assign-ort.js`; `git show 1cf269f9e -- js/ui/wiki-assign-ort.js js/ui/wiki-assign-literatur.js`; `sed -n 85,90p js/ui/wiki-feld-herkunft.js`
- Fallen: 💣 AGENTS §11 Wiki-Zuweisung: ein Datenweg kennt kein DOM, kein fetch, keinen Modulzustand -- die geteilte Datei ebenso. 💣 Die Tests `js/ui/__tests__/wiki-assign-<art>.test.js` `require()`n ihre Datei einzeln -- die geteilte Datei muss auch per require erreichbar sein (zwei Ladewege, AGENTS §11 Quellenliste). ⚠️ Nebenbefund: `String(wert ?? "").trim()` steht achtfach (avesmapsWikiFeldNormalize, avesmapsWikiAssignDiffNormalize, sechs *Text) -- wiki-feld-herkunft.js:20 warnt selbst „zwei Normalisierungen sind zwei Wahrheiten“. ⚠️ Ladezeit-Bezug Z. 305 laut Vorpruefung (Erklaerungsobjekt) -- der Name bleibt.
- Verlauf: 17.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker) -- sieben Paare

### P-055 · api/_internal/wiki/regions.php · Verfahren C
- Status: GO nötig
- Stand: e7c2d97b5 · Blob: 2d62cfe95b57a481c20dc9e7cc548fbd586d2c9b
- Block: „Doppelung: Crawl-Skelett, die vier Paare“ — avesmapsWikiRegionFetchCategory … avesmapsWikiRegionFetchCategory (Paare regions.php ↔ paths.php: FetchCategory Z. 321 ~ 175 · StartRun 288 ~ 147 · RunStatus 702 ~ 613 · Clear 769 ~ 675)
- Ziel: `api/_internal/wiki/wiki-crawler-base.php` (seit P-024 vorhanden), parametrisiert ueber Queue-/Staging-Tabelle, Default-Seeds und Max-Depth-Konstante; die Path-/Region-Namen bleiben als Weiterreicher
- Unterschied: wie P-024 (Historiker 05.09.2026): wortgleich bis auf Namen, Tabellenkonstanten und Ensure-Aufruf; der Scan vom 17.09.2026 meldet alle vier Paare unveraendert mit gleichheit 1,00
- Warum: wie P-024: regions kopierte aus sync-monitor (cc29579ef, 05.06.2026), paths aus regions (fdcbfe33a, 06.06.)
- Empfehlung: zusammenlegen -- der zweite Schritt der Empfehlung von P-024
- Beleg: P-024; `node tools/refactoring/doppelungen.mjs --wurzel . --min 10`
- Fallen: ⚠️ avesmapsWikiSyncMonitorRunStatus/…StartRun in sync-monitor.php sind ECHT anders und bleiben draussen (P-024). ⚠️ Der Tabellenname wird Parameter und wandert in den SQL-Text -- denselben Bezeichner-Riegel wie avesmapsWikiCrawlEnqueue benutzen (Verlauf P-024). ⚠️ paths.php und regions.php sind heiss (16.09./15.09.).
- Verlauf: 17.09.2026 angelegt als Folgepaket von P-024 (dessen Verlauf: „Die vier Paare … stehen noch aus - dafuer ein Folgepaket“). Das GO vom 05.09.2026 galt der Empfehlung „Enqueue zuerst, dann die vier Paare“ als Ganzem -- die Routine setzt trotzdem GO noetig, weil nur der Owner `offen` setzt; eine Zeile genuegt · 18.09.2026 nachgezogen: 6cd5c4094 (Wiki-Zuordnungen freier Beschriftungen gemeinsam zuruecknehmen) hat die Datei ab Z. 819 bewegt; alle vier Paare liegen davor (StartRun 288, FetchCategory 321, RunStatus 702, Clear 769), an den Namen unveraendert und frei

---

## Vorrat ohne Paket (Stand der Analyse 05.09.2026)

Freie Blöcke ≥ 150 Zeilen, für die noch kein Paket geschnitten ist — weil das Thema aus den Namen allein nicht sicher zu lesen war (der Block ist die halbe Datei) oder die Datei zu heiß ist. Der Überwachungsmodus der Routine darf daraus Pakete machen, sobald er ein Thema benennen kann; die Namen stehen hier, damit niemand den Scan wiederholen muss. `api/_internal/import/garetien-*.php` fehlt absichtlich: der Importer ist ein Gerüst auf Zeit mit Abbau-Vertrag, kein Umbau-Ziel.

| Datei | Zeilen | Commits/180 d | Alter | freie Blöcke (Zeilen/Funktionen, erster … letzter Name) |
|---|---:|---:|---:|---|
| `api/_internal/app/ecosystem.php` | 5896 | 91 | 1 d | 1055Z/7 `avesmapsEcosystemEnsureTables` … `avesmapsEcosystemParseBoundingBox`<br>460Z/11 `avesmapsEcosystemParseRegionFilter` … `avesmapsEcosystemReadRegionAreaCounts`<br>151Z/5 `avesmapsEcosystemWriteAuditLog` … `avesmapsEcosystemReadBoolean`<br>687Z/12 `avesmapsEcosystemLabelPointerToCheck` … `avesmapsDeleteEcosystemRegion`<br>1183Z/20 `avesmapsEcosystemWikiRegionAssignObject` … `avesmapsEcosystemAreaSnapshot` |
| `api/_internal/map/features.php` | 4277 | 68 | 2 d | 1529Z/20 `avesmapsApplyPointWikiFields` … `avesmapsUpdatePathFeatureDetails` |
| `api/_internal/app/feature-sources.php` | 3320 | 57 | 0 d | 204Z/3 `avesmapsEnsureFeatureSourceTablesSqlite` … `avesmapsEnsureFeatureSourceTables`<br>251Z/9 `avesmapsSourceOwnFieldsParse` … `avesmapsFeatureSourcesTakeoverOtherSource`<br>767Z/13 `avesmapsFeatureSourcesTakeoverAll` … `avesmapsAddFeatureSource` |
| `api/_internal/wiki/settlements.php` | 1997 | 67 | 3 d | 469Z/8 `avesmapsSettlementImagesAppSettingEnsure` … `avesmapsWikiSettlementClearTerritory` |
| `api/_internal/app/citymaps.php` | 2317 | 35 | 1 d | 333Z/6 `avesmapsCitymapsEnsureTables` … `avesmapsSetCitymapPreviewsEnabled`<br>950Z/18 `avesmapsCitymapPublicThumbUrl` … `avesmapsSetCitymapRelated` |
| `api/_internal/wiki/sync-monitor.php` | 769 | 79 | 13 d | 270Z/7 `avesmapsWikiSyncMonitorEnsureTables` … `avesmapsWikiSyncMonitorBuildStatus`<br>450Z/15 `avesmapsWikiSyncMonitorReadMaxDepth` … `avesmapsWikiSyncMonitorRunStatus` |
| `api/_internal/wiki/citymap-sync.php` | 2422 | 22 | 3 d | 246Z/6 `avesmapsCitymapWikiLinkPlan` … `avesmapsCitymapCountCatalog`<br>954Z/16 `avesmapsCitymapLastSynced` … `avesmapsCitymapDeleteWikiRow` |
| `api/_internal/wiki/dump-hybrid-driver.php` | 1652 | 26 | 3 d | 246Z/5 `avesmapsWikiDumpHybridEnsureTitleAliasTable` … `avesmapsWikiDumpHybridRedirectAliasStep`<br>828Z/12 `avesmapsWikiDumpTitlesProbeTitel` … `avesmapsWikiDumpHybridCleanupOldSandboxState` |
| `api/_internal/wiki/sync.php` | 1577 | 22 | 4 d | 326Z/12 `avesmapsWikiSyncUnreachableMessage` … `avesmapsWikiBotZugangLesen`<br>360Z/9 `avesmapsWikiBotSitzungDatei` … `avesmapsWikiBotDiagnoseUrteil`<br>647Z/23 `avesmapsWikiSyncNextTitleBatch` … `avesmapsWikiSyncReadPositiveInt` |
| `api/_internal/wiki/dump-entity-scan.php` | 1818 | 18 | 3 d | 1665Z/25 `avesmapsWikiDumpHandledEntityKinds` … `avesmapsWikiDumpRunPassBStep` |
| `api/_internal/wiki/path-verlauf.php` | 1765 | 17 | 45 d | 175Z/4 `avesmapsWikiPathCourseHash` … `avesmapsWikiPathVerlaufBackfillSource` |
| `api/_internal/wiki/publication-sync.php` | 1713 | 16 | 2 d | 206Z/3 `avesmapsEnsurePublicationStagingTables` … `avesmapsPublicationReferenceFieldsDiffer`<br>771Z/16 `avesmapsPublicationCatalogWikiKeyForTitle` … `avesmapsPublicationLinkDiffForPlan`<br>300Z/5 `avesmapsPublicationPlanItem` … `avesmapsPublicationReconcileStep`<br>345Z/8 `avesmapsPublicationPlanForEntity` … `avesmapsPublicationSyncPhaseStep` |
| `api/_internal/political/territories-layer.php` | 1132 | 18 | 20 d | 1121Z/28 `avesmapsPoliticalReadLayer` … `avesmapsPoliticalCoatUrlCacheBust` |
| `js/review/review-visitor-analytics.js` | 786 | 25 | 7 d | 162Z/5 `loadDeGeometry` … `renderVisitorLiveStrip` |
| `api/edit/political/subtree-display.php` | 1225 | 15 | 43 d | 600Z/21 `avesmapsPoliticalSubtreeDisplayColorUpdatesForResponse` … `avesmapsPoliticalSubtreeDisplayReadOpacity` |
| `api/_internal/analytics/visitor-analytics.php` | 887 | 20 | 7 d | 401Z/19 `avesmapsVisitorStunde` … `avesmapsVisitorLanguage`<br>304Z/13 `avesmapsVisitorLadeLiveLauf` … `avesmapsVisitorReadGeo` |
| `api/_internal/political/territories-geometry.php` | 1715 | 10 | 0 d | 1706Z/48 `avesmapsPoliticalMergeLayerGeometries` … `avesmapsPoliticalReadOptionalBoundingBox` |
| `api/_internal/app/game-literature.php` | 1629 | 10 | 4 d | 1313Z/23 `avesmapsNormalizeGameLiteratureLinkRows` … `avesmapsSetGameLiteratureCoverUrl` |
| `api/_internal/routing/offroad-leg.php` | 638 | 25 | 5 d | 429Z/3 `avesmapsFindNearestOffroadExitNodes` … `avesmapsAddOffroadEdge` |
| `api/_internal/routing/response.php` | 698 | 22 | 5 d | 657Z/6 `avesmapsRouteErrorResponse` … `avesmapsBuildMinimalRouteResponse` |
| `api/_internal/wiki/dump-sync-kind.php` | 1336 | 11 | 11 d | 368Z/8 `avesmapsWikiDumpSyncKindEntityKinds` … `avesmapsWikiDumpSyncKindStep`<br>350Z/5 `avesmapsWikiDumpSettlementCaseRunId` … `avesmapsWikiDumpSettlementConflictsGenerate`<br>401Z/8 `avesmapsWikiDumpSettlementConflictStateEnsure` … `avesmapsWikiDumpSettlementConflictsGenerateStep` |
| `api/_internal/wiki/path-flow.php` | 927 | 12 | 5 d | 171Z/8 `avesmapsPathFlowClampFactor` … `avesmapsPathFlowEndpointKey`<br>716Z/11 `avesmapsPathFlowEndpointNodes` … `avesmapsWikiPathSetFlow` |
| `api/_internal/routing/travel-values.php` | 1012 | 10 | 20 d | 880Z/27 `avesmapsTravelValuesPrime` … `avesmapsTravelValuesApplyCarriageRule` |
| `api/_internal/wiki/publication-parsing.php` | 614 | 16 | 29 d | 173Z/5 `avesmapsWikiDecodeEntities` … `avesmapsWikiMapArtToSourceType`<br>332Z/12 `avesmapsWikiProductGameLiteratureKind` … `avesmapsWikiBuildPublicationUrl` |
| `api/_internal/wiki/territories.php` | 968 | 10 | 11 d | 951Z/30 `avesmapsWikiSyncReadPoliticalTerritoryTree` … `avesmapsWikiSyncResolvePoliticalTerritoryName` |
| `api/_internal/conflicts/repair.php` | 870 | 11 | 16 d | 809Z/14 `avesmapsConflictRepairSpansNameGroup` … `avesmapsConflictResolve` |
| `js/ui/ui-controls.js` | 841 | 11 | 25 d | 375Z/27 `watchMapScaleBandLift` … `syncTransportControls`<br>150Z/10 `findReviewTabButton` … `initializeWikiSyncTerritoryMetaLinks` |
| `api/_internal/app/lore-rule-store.php` | 679 | 12 | 10 d | 648Z/10 `avesmapsLoreRuleEnsureTables` … `avesmapsLoreRuleReadForEntryWithNames` |
| `js/review/review-region-parent-tree.js` | 631 | 9 | 20 d | 444Z/17 `populateRegionParentSelect` … `createRegionParentTreeButton` |
| `api/_internal/wiki/sync-monitor-tree.php` | 620 | 9 | 12 d | 594Z/6 `avesmapsWikiSyncMonitorGeometryModelAudit` … `avesmapsWikiSyncMonitorModelSample` |
| `api/_internal/app/curve-labels.php` | 788 | 5 | 14 d | 771Z/20 `avesmapsCurveRingArea` … `avesmapsCurveBaseline` |
| `api/_internal/app/lore-rule-match.php` | 629 | 6 | 17 d | 573Z/11 `avesmapsLoreRuleSubjectFromArea` … `avesmapsLoreRuleEntriesForSubject` |
| `api/_internal/wiki/dump-hybrid-state.php` | 629 | 6 | 11 d | 526Z/10 `avesmapsWikiDumpHybridEnsureStateTable` … `avesmapsWikiDumpHybridFillContinentMapStep` |
| `api/_internal/wiki/locations-helpers.php` | 611 | 6 | 11 d | 191Z/15 `avesmapsWikiSyncCaseTypeOrder` … `avesmapsWikiSyncAuditFeaturePropsChange`<br>401Z/13 `avesmapsWikiSyncWriteMapAuditLog` … `avesmapsWikiSyncPublicDuplicateMapPlace` |
| `api/_internal/wiki/sync-monitor-model.php` | 974 | 3 | 30 d | 749Z/16 `avesmapsWikiSyncMonitorStagingColumns` … `avesmapsWikiSyncMonitorSetExcluded`<br>208Z/4 `avesmapsWikiSyncMonitorIsCustomNodeKey` … `avesmapsWikiSyncMonitorApplyCustomNodes` |
| `api/_internal/routing/graph.php` | 925 | 3 | 77 d | 920Z/21 `avesmapsBuildRouteGraph` … `avesmapsBuildRouteEdge` |

### Nachtrag 17.09.2026 (Ueberwachungsmodus)

Freie Bloecke ≥ 150 Zeilen in abgekuehlten Dateien (Commitdatum ≥ 5 Tage), die KEIN Paket geworden sind -- mit Grund. Die Pakete P-031 … P-042 stehen oben; gebundene Bloecke stehen im naechsten Abschnitt.

- **Unter dem Boden des Fingerabdrucks** (je Block < ~170 Zeilen): `sync-monitor.php` Z. 387-548 (Enqueue … ResolveCanonicalTitles, zudem P-024-Familie) · `ui-controls.js` Distanzmessung Z. 157-327 und Verkehrsmittel-Menue Z. 329-482 · `publication-parsing.php` Z. 36-208 · `path-flow.php` Z. 29-199 · `api-metrics.php` Spool Z. 340-498 · `review-visitor-analytics.js` Z. 600-761 · `api-client.js` Z. 274-443 · `map-features-political-territory-loader.js` Stil-Anwendung Z. 176-238.
- **Mischthema, kein Name aus den Funktionen:** `wiki/sync.php` Z. 207-443 (Drossel-Absagen, Bot-Zustand, Cookies; der Teil ab avesmapsWikiBotZustand hat ~140 Zeilen) und Z. 1047-1716 (Titelstapel, API-Anfrage, Match-Schluessel nach AGENTS §5, Kerntabellen, Laeufe) · `visitor-analytics.php` Z. 252-454 und 697-853 (sieben Tests lesen die Datei) · `locations-helpers.php` Z. 12-202 und 210-610 (traegt NextMapRevision und EnsureMapFeatureLocksTable, P-028/P-045) · `sync-plan.php` Z. 48-295 (Regeln plus DDL) · `publication-sync.php` Z. 31-236 und 255-1025.
- **Der Block ist (fast) die ganze Datei** -- ein Paket braucht zuerst eine Unterteilung mit Thema: `territories-geometry.php` (99 %), `territories-derived-geometry.php` (99 %), `routing/graph.php` (99 %), `curve-labels.php` (98 %), `sync-monitor-tree.php` (96 %), `lore-rule-store.php` (95 %), `conflicts/rules.php` (92 %), `media-license-migration-run.php` (92 %), `lore-rule-match.php` (91 %), `backup/db-dump.php` (89 %), `offroad-grid.php` (89 %), `dump-fetch.php` (86 %), `lore-rule-derive.php` (83 %), `dump-category-layer.php` (78 %), `path-flow.php` Z. 211-926 (77 %), `review-region-parent-tree.js` (70 %), `offroad-leg.php` (67 %), `territories-audit.php` Z. 17-603 (66 %), `eigener-knoten-wiki-bindung.php` Z. 41-588 (59 %).
- **Endpunkt:** `api/edit/political/subtree-display.php` Z. 625-1224 -- der Handler laeuft beim include; ein `require_once` an der Blockstelle am Dateiende kaeme zu spaet.

## Von Tests am Quelltext festgehalten (kein Paket, Stand 05.09.2026)

Diese Blöcke wären frei, aber ein Test liest den QUELLTEXT der Datei und sucht Funktionsnamen darin (Prüfung 3/3b). Damit hat **Verfahren B im Erstbestand kein Paket** — die Editorseiten werden von ihren Tests durchweg per Text geschnitten. Ein Paket braucht hier zuerst den Test: sein Pfad muss der Geschwisterdatei folgen (eine Zeile, wie ein Register) — das ist eine Änderung am Testharnisch und damit Owner-Sache, nicht Routine.

| Datei | Block | Test(s), die den Quelltext lesen |
|---|---|---|
| `api/_internal/map/features.php` | Kraftlinien (`avesmapsPowerlineUndirectedEdgeKey` … `avesmapsReorderPowerlineLine`) | powerline-inherit-test, kraftlinie-kurve-schreiben-test, kraftlinie-wiki-no-article-test, weg-wiki-no-article-test |
| `api/_internal/app/ecosystem.php` | Wiki-Durchtrag an die Beschriftungen (`avesmapsEcosystemWikiRegionAssignObject` … `avesmapsEcosystemPushRegionDataToLabelsAll`) | ecosystem-label-wiki-durchtrag-test (nagelt beide Nähte am Quelltext fest, AGENTS §11) |
| `api/_internal/app/feature-sources.php` | Übernahme der Altquellen und Beschriftungsquellen (`avesmapsFeatureSourcesTakeoverAll` … `…TakeoverLabelSources`) | quellen-altquellen-takeover-test, quellen-label-takeover-test, quellen-zur-flaeche-test |
| `api/_internal/analytics/visitor-analytics.php` | Live-Läufe und Verweildauer (`avesmapsVisitorLadeLiveLauf` … `avesmapsVisitorReadLive`) | verweildauer-test (zählt die Aufrufer von `avesmapsVisitorFinishLiveRun` per `substr_count`) |
| `api/_internal/wiki/citymap-sync.php` | (nur die Parser sind frei; Rest) `avesmapsCitymapLastSynced` … `avesmapsCitymapDeleteWikiRow` | citymap-sync-test (Tokenizer-Lauf über die Datei) |
| `html/wiki-sync-settlement-editor.html` | Zoomband-Vorschau (`resetZoomBandRow` … `updateZoomBandPreview`, `zbvBandwert` … `updateZoomBandsMessage`) | zoombaender-vorschau-messung.test.js (schneidet per `schneide("function zbvBandwert(kind, cls, z) {")`), zoombaender-dialog.test.js (`new RegExp("function " + n)` aus einem Namens-Array) — gefunden vom Skeptiker 05.09.2026, seither Prüfung 3 |
| `html/game-literature-editor.html` | Detailansicht (`aeWikiFeldZuruecksetzen` … `renderDetail`) | editor-abschnittsreihenfolge.test.js, wiki-assign-literatur.test.js |
| `html/citymap-editor.html` | Detailansicht (`ceImageGroup` … `renderDetail`) | editor-abschnittsreihenfolge.test.js, wiki-assign-karte.test.js |
| `js/review/review-panels-change-log.js` | Fokus und Rückgängig (`findLabelMarkerByPublicId` … `undoChangeLogEntry`) | change-log-target.test.js:115 (Regex-Literal `/getChangeLogFocusTooltip[\s\S]{0,220}…/` am Quelltext) — gefunden vom Behauptungsprüfer 05.09.2026, seither Prüfung 3 |
| `js/routing/route-engine.js` | Server-Route in Anzeige-Segmente (`getServerRouteDebug` … `buildRouteResultFromServerRoute`) | route-entry-path-ids.test.js, route-entry-terrain.test.js (Lade-Helfer `const load = (rel) => { … runInThisContext(readFileSync(…)) }`, rufen `buildServerGeometryRouteSegment`/`installServerPrimaryRouting` — transitiv ist die halbe Datei gebunden) |
| `api/_internal/wiki/settlements.php` | Wappen aus dem Wiki (`avesmapsWikiSettlementCoatStatus` … `…ClearCoat`, P-009) | wappen-dritter-zustand-test.php (`$rumpf` fuer BulkRecordCoats, SetWikiCoat, ClearCoat), wappen-box-kartendialog.test.js:273 (Regex `'coat_none' => …`) -- Pfad per Helfer zusammengesetzt, von der Vorpruefung nicht gesehen (17.09.2026) |
| `api/_internal/wiki/sync.php` | Bot-Sitzung und Diagnose (`avesmapsWikiBotSitzungDatei` … `avesmapsWikiBotDiagnoseUrteil`) | bot-login-test.php:252 (Regex `function avesmapsWikiBotSitzungSicherstellen\(.*?\n\}`) und :267 (zaehlt die Aufrufe von avesmapsWikiSyncLogServerError in sync.php) -- Pfad `$wikiVerzeichnis . '/sync.php'`, von der Vorpruefung nicht gesehen (17.09.2026) |
| `api/_internal/wiki/publication-sync.php` | Abgleich-Schritt (`avesmapsPublicationPlanItem` … `…ReconcileStep`) und Plan-Schritt (`…PlanForEntity` … `…SyncPhaseStep`) | publication-ziel-landschaft-test.php (Code-Fragmente aus FetchLiveEntityBatch, ReconcileStep, PlanForEntity), reconcile-transaction-test.php (`ReconcileEntity($pdo`) (17.09.2026) |
| `api/_internal/routing/travel-values.php` | Aktive Werte (`avesmapsTravelValuesPrime` … `…RampShape`) und Eingang/Kalibrierung (`…ParseNumber` … `…CalibrationRows`) | speed-table-and-rest-rule.test.js:255 (liest die Reisetage per Regex), tempowerte-dialog.test.js:24 (`$payload['grid']`, `$payload['ground_penalties']`); dazu steht die Datei im Migrations-Fingerabdruck von `ecosystem-schema-state.php` -- Code, der in eine Geschwisterdatei wandert, fiele aus ihm heraus (17.09.2026) |
| `api/_internal/wiki/dump-hybrid-state.php` | Zustandstabelle und Kartenzeilen (`avesmapsWikiDumpHybridEnsureStateTable` … `…ComputeBuildingMapRows`) | hybrid-state-spalten-test.php:59 (`$nachzuruesten = [`) (17.09.2026) |
| `api/_internal/wiki/sync-plan.php` | Entscheidungen (`avesmapsSyncPlanRecordDecline` … `…DecisionTargetsForItems`) | sync-plan-decline-changetype-test.php (SQL `ON DUPLICATE KEY UPDATE declined_at …` woertlich) (17.09.2026) |
| `api/_internal/wiki/lore-sync.php` | Planpositionen (`avesmapsLorePlanItem` … `…LastStaged`) | lore-retire-parity-test.php:57 (ABWESENHEIT von `NOT IN (SELECT wiki_key FROM …` in der ganzen Datei -- nach einem Schnitt still blind) (17.09.2026) |
| `api/_internal/wiki/eigener-knoten-wiki-bindung.php` | Kandidaten, Felder und Plan (`…FelderSchreiben` … `…Plan`) | eigener-knoten-wiki-bindung-ziele-test.php (Inventar per `str_contains` ueber die ganze Datei, Abwesenheit von UPDATE IGNORE und Upsert) (17.09.2026) |
| `api/_internal/wiki/sync-monitor-model.php` | Eigene Knoten (`avesmapsWikiSyncMonitorIsCustomNodeKey` … `…ApplyCustomNodes`) | territory-selection-test.php:62 (`$bodyOf` schneidet ApplyCustomNodes; der Name steht in einem Array-Literal, von der Vorpruefung nicht gesehen) (17.09.2026) |
| `api/_internal/app/lore.php` | Statuskreis je Eintrag (`avesmapsLoreReadMapStatusByEntry` … `…ResolveGoodsByName`) | listen-statuskreis.test.js:405 (Aufruf `avesmapsLoreReadPlaceKeysOnMap($pdo, array_keys($allPlaceKeys))` in Z. 765) (17.09.2026) |
| `js/ui/ui-controls.js` | Massstabsband (`watchMapScaleBandLift` …) | touch-scale.test.js:372/384 (`new ResizeObserver(syncMapScaleBandLift)`) (17.09.2026) |
| `html/citymap-editor.html`, `html/game-literature-editor.html` | `runAcSearch` | js/pages/__tests__/editor-ortsvorschlaege-arten.test.js:37 (`ausschneiden(html, datei, "runAcSearch")` aus BEIDEN Seiten) -- Luecke dieser Tabelle, gefunden vom Historiker 17.09.2026 |

## Nicht-Ziele der Routine (Owner-Entscheid 05.09.2026, brauchen einen eigenen Plan)

- **`index.html`** (4273 Z, 999 c): trägt die Routing-Glue inline; die Routine ändert dort nur additiv ein `<script>`.

## Geprüfte Doppelungen ohne Paket (Historiker-Läufe 05.09.2026: gewollt)

Der Doppelungs-Scan meldet sie als zeichengleich; der Historiker hat belegt, warum sie zu Recht zweimal stehen. Kein Paket — wer sie zusammenlegt, dreht eine Entscheidung zurück.

- `avesmapsLoadRouteLand` (`api/_internal/routing/land-areas.php`) ~ `avesmapsLoadRouteWater` (`water-areas.php`): nur die `region_type`-Liste unterscheidet sich (`kontinent,insel` gegen `meer,see`); die Verarbeitung dahinter ist schon vereinigt (`avesmapsPrepareRouteAreas` = `avesmapsPrepareRouteWater`). Plan `docs/superpowers/plans/2026-08-02-ausloeser-anker-und-x25-aufschlag.md:239`: „Kein zweiter Wasserbegriff.“ Commits `3433c1617` (V13) und `6036e3273` (V14, „built to V13's pattern“).
- `readSourceIds` (`map-features-derived-boundary-runtime-fix.js`) ~ `readPoliticalTerritoryDerivedSourceIds` (`map-features-political-territory-loader.js`): die statische Kopie ist der Rückfall für die kurze asynchrone Ladelücke, bevor das injizierte Skript greift — am 27.06.2026 im Audit (`docs/cleanup-audit-2026-06-27.md`, A2) bewusst ANGEGLICHEN statt zusammengelegt (`945762f734`, Owner-GO). Ein Zusammenlegen risse die Timing-Lücke wieder auf.
- `avesmapsSuppressCitymapLink`/`…CitymapPlace` (`api/_internal/app/citymaps.php`) ~ `avesmapsSuppressGameLiteraturePlace` (`game-literature.php`): ECHTE andere Geschäftsregel — Karten tombstonen bei `origin !== 'manual'`, Literatur nur bei `origin === 'wiki'` (Abschnittskommentar vor `avesmapsAddCitymapPlace`, seit P-011 in `citymaps-links.php`: „Deliberate copies … the two tables differ“). Zusammenlegen wäre ein Fehler; kein Test hält die Abweichung fest — das ist die eigentliche Lücke.
- `avesmapsNextEcosystemRevision` (`ecosystem.php` Z. 1258) gegen `avesmapsNextMapRevision`: eigene Tabelle `ecosystem_revision`, eigener Cache-Kreis, damit eine Zeichenkampagne nicht bei jeder Speicherung die 29-MB-Kartennutzlast invalidiert (`956d53ee9e`, `ecosystem.php:12-16`). Gewollt.

Nachtrag 17.09.2026 (Historiker-Laeufe des Ueberwachungsmodus):

- `avesmapsPoliticalNameExists` (`territories-support.php:125`) ~ `avesmapsPoliticalSlugExists` (`territory.php:617`): KEINE Doppelung -- Spalte `name` (weich, kein UNIQUE, Anzeige-Suffix „(2)“) gegen `slug` (`uq_political_territory_slug`, mit der Papierkorb-Falle aus `eigener-knoten-wiki-bindung.php:71-87`). Der Scan anonymisiert String-Literale positional und setzt die Spalten gleich.
- `avesmapsEcosystemWikiSlug` (`ecosystem.php:2321`) ~ `avesmapsPoliticalSlug` (`territory.php:892`): gewollt -- ecosystem.php ruft keinen politischen Code (Kopf Z. 54-63, Kommentar Z. 2313-2320); `ecosystem-geometry-test.php:411-433` haelt beide ueber 17 Faelle zeichengleich (AGENTS §5).
- `avesmapsKartenarchivLinkToken` (`kartenarchiv-link.php:117`) ~ `avesmapsGenerateShareCode` (`api/app/share-link.php:41`): gewollt -- das Alphabet ist bewusst uebernommen (e522864e9 nennt share-link.php zweimal), die Laenge 32 statt 8 sicherheitsbegruendet („dieser IST der Zugang“); share-link.php ist ein Endpunkt.
- `ceWikiEntry` (`citymap-editor.html:1286`) ~ `aeWikiEntry` (`game-literature-editor.html:1204`): gewollt -- die Karte sucht nach TITEL (`citymap.wiki_key` ist ein Bauschluessel, AGENTS §11), die Literatur nach `wiki_key` (d2cd4e2df / 3da657c92, 16.08.2026).
- `avesmapsPoliticalFetchTerritoryByPublicIdForAudit`/`…ByIdForAudit` (`territories-audit.php:692/708`) ~ `avesmapsPoliticalFetchGeometryRowByPublicIdRaw` (`territories-geometry.php:1417`): KEINE Doppelung -- drei Tabellen/Spalten; `Raw` ist die Audit-Lesung ohne is_active-Filter neben avesmapsPoliticalFetchGeometryByPublicId (alle aus 9d938c047, 28.05.2026).
- `avesmapsPoliticalReadOptionalInt`/`…ReadOptionalZoom` (`territories-read.php:1440/1469`) ~ `avesmapsPoliticalSubtreeDisplayReadOptionalYear`/`…Zoom` (`api/edit/political/subtree-display.php:433/148`): kein Einzelpaket -- subtree-display.php ist systematisch isoliert (rund 30 SubtreeDisplay-Funktionen, requiret nur territory.php; f7d2a2c47/e867ba8c7, 31.05.2026). Wenn ueberhaupt, dann „subtree-display.php entkoppeln“ als eigenes GO-Paket. Die gleichnamigen Fassungen in `display-overrides.php:63-91` sind `function_exists`-geschuetzt und nie im selben Request (`zoom-sync-requires-test.php:22-28`) -- kein Redeclare.
- `avesmapsWikiAssignKarteTreffer` ~ `avesmapsWikiAssignOrtTreffer`: Randerscheinung -- die zwei einfachen von sechs Treffer-Bauern; die uebrigen vier sind echte Varianten (arten, haengtAn, Eltern, kanonischer Name).
