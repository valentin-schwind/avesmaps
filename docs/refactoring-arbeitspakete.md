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
- Stand: 5e8bb1862 · Blob: ea4cfb27bf044e1e5e6dbf9e96cda0d9ef4ded25
- Block: „Klimazonen“ — avesmapsEcosystemClimateZones … avesmapsEcosystemClimateReset (12 Funktionen, ~564 Zeilen ab Z. 5361)
- Ziel: api/_internal/app/ecosystem-klima.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 3 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 5896 Zeilen, 91 Commits/180 d · heiß (1 d, wartet auf Abkühlung)
- Fallen: `climate-insert-zone-test.php` und `climate-rename-test.php` requiren `ecosystem.php` (SQLite, transparent); `climate-membership-test.php` requiret nur `climate-membership.php`. `avesmapsClimateAssertNotDerived` (AGENTS §11: ein Band darf nie als Polygon bearbeitet werden) liegt in `api/_internal/app/climate-zones.php:529`, nicht hier. Kopfkommentar ENGLISCH wie der Dateikopf von `ecosystem.php` (Z. 5–10 nennt die Sprachregel „code/identifiers/messages EN“ ausdrücklich), auch wenn der Rumpf gemischt ist. ⚠️ `avesmapsEcosystemClimateZones` wird aus dem Verlauf-Block (`avesmapsListEcosystemChanges`, Z. 5047) gerufen — die zwei ecosystem.php-Pakete sind gekoppelt, jede Reihenfolge ist zulässig, aber keine Konstellation ohne beide Geschwisterdateien darf getestet werden, die es live nicht gibt.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 536536) · 06.09.2026 nachgezogen: 980bc5b7f hat 12 Kommentarzeilen bei Z. 4762 ergänzt (außerhalb aller drei Blöcke); Block an den Namen unverändert zusammenhängend und frei · 08.09.2026 nachgezogen: 602637b0f (Sprungpunkt der Verlaufszeilen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 nachgezogen: a04ffc929 (die Art Vor-/Mittelgebirge faellt) und c43492837 (die Wiki-Zuweisung einer Flaeche ist sofort sichtbar) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: 93c28d0f8 (Landschaften ohne Beschriftung sind Suchtreffer) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei

### P-004 · api/_internal/app/ecosystem.php · Verfahren C
- Status: offen
- Stand: 5e8bb1862 · Blob: ea4cfb27bf044e1e5e6dbf9e96cda0d9ef4ded25
- Block: „Änderungsverlauf und Rückgängig“ — avesmapsEcosystemCanUndoAction … avesmapsEcosystemRestoreRegionLabel (8 Funktionen, ~411 Zeilen ab Z. 4929)
- Ziel: api/_internal/app/ecosystem-verlauf.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 3 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 5896 Zeilen, 91 Commits/180 d · heiß (1 d, wartet auf Abkühlung)
- Fallen: Zwei Klima-Helfer (`avesmapsEcosystemClimateDividerName`, `…SouthKeyOfAudit`) liegen im Lauf, weil das Rückgängig sie für Audit-Zeilen der Trennlinien braucht — sie gehören zum Verlauf, nicht zum Klima-Paket. Kein Kartenstempel-Bump beim Umzug (nur Ort). ⚠️ Der Block ruft `avesmapsEcosystemClimateZones` (Z. 5047) aus dem Klimazonen-Paket derselben Datei — technisch unschädlich (require_once, Aufruf zur Laufzeit), aber die beiden Pakete sind gekoppelt: nach dem einen Schnitt den anderen im Kopf behalten (Skeptiker 05.09.2026).
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 536536) · 06.09.2026 nachgezogen: 980bc5b7f hat 12 Kommentarzeilen bei Z. 4762 ergänzt (außerhalb aller drei Blöcke); Block an den Namen unverändert zusammenhängend und frei · 08.09.2026 nachgezogen: 602637b0f (Sprungpunkt der Verlaufszeilen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 nachgezogen: a04ffc929 (die Art Vor-/Mittelgebirge faellt) und c43492837 (die Wiki-Zuweisung einer Flaeche ist sofort sichtbar) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: 93c28d0f8 (Landschaften ohne Beschriftung sind Suchtreffer) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei

### P-005 · api/_internal/app/ecosystem.php · Verfahren C
- Status: offen
- Stand: 5e8bb1862 · Blob: ea4cfb27bf044e1e5e6dbf9e96cda0d9ef4ded25
- Block: „Regionen lesen und Wiki-Schlüssel“ — avesmapsEcosystemWikiSlug … avesmapsListEcosystemRegionsByWikiKey (7 Funktionen, ~268 Zeilen ab Z. 2331)
- Ziel: api/_internal/app/ecosystem-regionen.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 3 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 5896 Zeilen, 91 Commits/180 d · heiß (1 d, wartet auf Abkühlung)
- Fallen: Enger als der freie Block: `avesmapsEcosystemApplyRegionFieldOrigins` (curve-label-store-test liest den Quelltext) und `avesmapsAssignEcosystemWikiRegion`/`…AssignIsDryRun` (ecosystem-label-wiki-durchtrag-test) bleiben in `ecosystem.php`. Die Leser hier sind rein.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 536536) · 06.09.2026 nachgezogen: 980bc5b7f hat 12 Kommentarzeilen bei Z. 4762 ergänzt (außerhalb aller drei Blöcke); Block an den Namen unverändert zusammenhängend und frei · 08.09.2026 nachgezogen: 602637b0f (Sprungpunkt der Verlaufszeilen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 nachgezogen: a04ffc929 (die Art Vor-/Mittelgebirge faellt) und c43492837 (die Wiki-Zuweisung einer Flaeche ist sofort sichtbar) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: 93c28d0f8 (Landschaften ohne Beschriftung sind Suchtreffer) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei

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
- Stand: 5e8bb1862 · Blob: ffb103c1c79046f9700e2befef74ffe0e08b85bb
- Block: „Antwort-Bauer“ — avesmapsBuildPointFeatureResponse … avesmapsBuildRegionFeatureResponse (5 Funktionen, ~110 Zeilen ab Z. 4119)
- Ziel: api/_internal/map/features-response.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 1 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 4277 Zeilen, 68 Commits/180 d · heiß (2 d, wartet auf Abkühlung)
- Fallen: Enger als der freie Block: `avesmapsDecodeJsonColumnForEdit` (kraftlinie-kurve-schreiben-test liest den Quelltext) und `avesmapsUuidV4` (settlement-places-test nennt den Namen; die Funktion ist eine von drei gleichlautenden Fassungen unter drei Namen — features/territory/sync, Doppelungs-Paket) bleiben in `features.php`.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 290836) · 08.09.2026 nachgezogen: 3b6439131 und 179c64277 (Kreuzungstyp) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 3b6439131 (Kreuzungstyp) und 80cb6bbeb (Merker) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 nachgezogen: a04ffc929 (die Art Vor-/Mittelgebirge faellt) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: f28a45a97 (54 tote PHP-Funktionen entfernt) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei; der Boden des Fingerabdrucks (liste.md, Owner-Punkt) gilt weiter

### P-008 · api/_internal/app/feature-sources.php · Verfahren C
- Status: offen
- Stand: 166b5a435 · Blob: bec235e62828cd106141aa26f02fa3362cd4a90d
- Block: „Zusammenlegen und Katalogsuche“ — avesmapsMergeWinningLink … avesmapsSearchSourceCatalog (5 Funktionen, ~295 Zeilen ab Z. 2400)
- Ziel: api/_internal/app/feature-sources-katalog.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 2 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 3320 Zeilen, 57 Commits/180 d · heiß (0 d, wartet auf Abkühlung)
- Fallen: `avesmapsMergeSourceInto` trägt 8 Abfragen in Schleifen (Admin-Aktion, selten) — Perf-Geruch, kein Paket. `avesmapsEnsureSourceMergeLog`/`…SearchIndex` sind Ensure-Helfer im Block: Konstanten und Tabellennamen vor der Blockstelle prüfen (Vorprüfung zählt).
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 189240) · 08.09.2026 nachgezogen: sieben Commits des Kanon- und Quellen-Umbaus (651b53f53 bis f87bdccad) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: fuenf Commits des Quellen- und Merker-Umbaus (75cc06da3 bis 80cb6bbeb) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 nachgezogen: 825603242 und cd5dae452 (der Kanon der Landschaftsflaechen) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 14.09.2026 nachgezogen: d683724e4 (schweigt die Landschaftsflaeche, gilt der Artikel ihrer Beschriftung) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei, weiter ab Z. 2400 · 15.09.2026 uebersprungen (nicht abgekuehlt): rangliste.mjs meldete 5 Tage, weil es das AUTORdatum liest (`--pretty=format:@%ad`) -- d683724e4 ist am 10.09. geschrieben, aber erst am 14.09. auf origin gelandet, die Datei ist also seit einem Tag bewegt. Blob unveraendert (gilt); Kandidat fruehestens am 19.09.2026

### P-009 · api/_internal/wiki/settlements.php · Verfahren C
- Status: offen
- Stand: 5e8bb1862 · Blob: 408f67a7c942639b1e66796dacd904807bac67a9
- Block: „Wappen aus dem Wiki“ — avesmapsWikiSettlementCoatStatus … avesmapsWikiSettlementClearCoat (8 Funktionen, ~250 Zeilen ab Z. 414)
- Ziel: api/_internal/wiki/settlements-wappen.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 1997 Zeilen, 67 Commits/180 d · heiß (3 d, wartet auf Abkühlung)
- Fallen: Wappen laufen NUR über `avesmapsResolveGatedCoatUrl` (AGENTS §11, `coat-url.php`) — hier liegt die Wiki-Seite (Status, Bulk-Record, Metadaten), nicht der Riegel. Datei ist heiß (67 Commits); abkühlen lassen.
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 133799) · 08.09.2026 nachgezogen: 3650115d0 (Wiki-Abruf wartet nicht auf die Drossel) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: 799c5e44b (Stadtteile ohne Infobox werden Innerorts-Staetten) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei

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
- Status: offen
- Stand: 17fe14a1f · Blob: b5f9b1ef5283b2fccdb9cffe9137adbfe44fba23
- Block: „Fälle und Auflösung der Orte“ — avesmapsWikiSyncListCases … avesmapsWikiSyncUpdateLocationFeature (5 Funktionen, ~293 Zeilen ab Z. 651)
- Ziel: api/_internal/wiki/locations-faelle.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 0 (Blocknamen: 0) · vm-Bindung 0 · Konstanten fehlend 0 · Datei 1150 Zeilen, 15 Commits/180 d
- Fallen: Enger als der freie Block: `avesmapsWikiSyncBuildLocationProperties` (wikisync-fall-no-article-test liest den Quelltext) und alles danach bleiben. `locations-helpers.php` liegt daneben — Namensform `locations-<thema>.php`. `api/wiki-sync.php` auf dem SERVER (nicht im Repo, AGENTS §10) ruft `avesmapsWikiSync*`-Namen — erreichbar, solange `locations.php` die Geschwisterdatei lädt. 🔴 Nach dem Deploy EINE Live-Anfrage gegen `https://avesmaps.de/api/wiki-sync.php` (erwartet HTTP 401 wie heute, nicht 500): diesen Aufrufer sieht kein Checkout und kein Test — die Vorprüfung hat hier eine blinde Stelle, die sie selbst nicht melden kann (Backend-Agent 05.09.2026).
- Verlauf: 05.09.2026 angelegt (Analyse, Rangwert 17250) · 08.09.2026 nachgezogen: 4044c7e5d (die drei Wiki-Tafeln stehen nur noch einmal) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei

### P-020 · api/app/ecosystem-areas.php · Verfahren D
- Status: offen
- Stand: 1cb5e09bd · Blob: f2ed1e0535fdb007ac502be626e113d3b3d4d4fd
- Block: „Ensure auf dem öffentlichen Lesepfad“ — avesmapsEcosystemEnsureTables … avesmapsEcosystemEnsureTables (gerufen in ecosystem-areas.php Z. 111, definiert in api/_internal/app/ecosystem.php Z. 275, 13 Abfragen in Schleifen plus DDL je Aufruf)
- Ziel: `avesmapsEcosystemEnsureTables($pdo)` am Lesepfad `api/app/ecosystem-areas.php` durch `avesmapsSchemaEnsureOnce('ecosystem', (new ReflectionFunction('avesmapsEcosystemEnsureTables'))->getFileName(), fn() => avesmapsEcosystemEnsureTables($pdo))` binden — der zweite Parameter ist die Datei, in der die Ensure-Funktion DEFINIERT ist (heute `ecosystem.php`; nach einem C-Schnitt automatisch die Geschwisterdatei), NIE `__FILE__` des Aufrufers: `ecosystem-areas.php` hat 20 Commits in 180 Tagen, `ecosystem.php` 94 — die Dateien ändern sich unabhängig, und ein falscher Pfad zeigte eine neue Spalte bis zu eine Stunde lang nicht an (Backend-Agent 05.09.2026). Riegel: `api/_internal/schema-ensure-once.php`, dieselbe Bauform wie beim politischen Endpunkt (AGENTS §10). NUR der Lesepfad; alle Schreibwege in ecosystem.php behalten den Roh-Ensure.
- Messskript: tools/perf/ecosystem-areas-ensure.php (zu schreiben) — zählender PDO-Wrapper über der SQLite-Fixture der `climate-*-test.php`: Abfragen je `GET areas`-Aufruf vorher/nachher (Erwartung beim zweiten Aufruf: minus die 38 `prepare/query/exec` von `avesmapsEcosystemEnsureTables` Z. 275–1108, darunter 18 `CREATE TABLE` und 8 `SHOW COLUMNS`/`PRAGMA` — Behauptungsprüfer 05.09.2026; „13“ war die Zahl des Geruchs, nicht der Arbeit), `ausgabe_sha256` des JSON-Rumpfs gleich.
- Vorprüfung (05.09.2026): gleiche Ausgabe, weniger Arbeit — ABER `avesmapsEcosystemEnsureTables` trägt neben DDL auch DATENMIGRATIONEN und SEEDS (`UPDATE ecosystem_area SET terrain_erosion = terrain_levels`, `affects_paths`-Seed, die `offroad_factor`-Tabelle; Z. 505–535, 765–800). Mit dem Riegel laufen sie höchstens einmal je Stunde statt je Anfrage — nie öfter. Vor dem GO prüfen: verlässt sich ein SCHREIBWEG darauf, dass der Lesepfad einen Backfill für frisch angelegte Zeilen nachholt? Wenn ja, ist es keine reine Perf-Änderung. Die zwei Warnungen in `ecosystem.php` gegen einen geteilten „was anything new?“-Merker meinen das WIEDER-Ausführen eines Seeds — das tut der Riegel nicht.
- Fallen: 💣 Der Marker trägt die MTIME der DEFINIERENDEN Datei — das ist die Datei, in der `avesmapsEcosystemEnsureTables` steht (heute ecosystem.php; nach einem C-Schnitt der Ensure-Funktionen deren Geschwisterdatei), sonst läuft ein neuer `ALTER TABLE` bis zu eine Stunde später in „Unknown column“. 💣 Nie innerhalb einer Transaktion rufen (DDL committet implizit). ⚠️ Fällt OFFEN aus (Temp nicht schreibbar → Ensure wie bisher). 🔴 Die Live-Gegenprobe nach dem Deploy beweist den Marker-Pfad NICHT (der gerade gelaufene Ensure ist ohnehin frisch) — der Beleg ist der DIFF: der Behauptungsprüfer liest das zweite Argument. Owner-Probe: erstes von drei Perf-Paketen.
- Verlauf: 05.09.2026 angelegt (Perf-Geruch: abfrage-in-schleife ×13 in avesmapsEcosystemEnsureTables; Aufrufer auf dem Lesepfad belegt) · 05.09.2026 GO Owner (Perf-Probe 1 von 3; nur mit Agenten, Riegel D)

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
- Stand: 166b5a435 · Blob: fc2cb9fea7c924a02d67edc1d3f178786203283a
- Block: „Doppelung: Kurzbeschreibung aus dem Wikitext“ — avesmapsWikiRegionExtractDescription … avesmapsWikiRegionExtractDescription (dreifach: `paths.php` `avesmapsWikiPathExtractDescription` Z. 551–589, `regions.php` Z. 617–658, `settlements.php` `avesmapsWikiSettlementExtractDescription` Z. 780–821)
- Ziel: neue abhängigkeitsfreie Datei `api/_internal/wiki/wiki-text-extract.php` mit `avesmapsWikiExtractLeadDescription(string $wikitext, string $infoboxBlock): string`, `require_once` aus paths/regions/settlements (Vorbild: `path-naming.php`, „dependency-free, required by BOTH paths.php and powerlines.php“). Die drei alten Namen bleiben als Einzeiler-Weiterreicher, bis alle Aufrufer umgestellt sind.
- Unterschied: keiner außer Namen und drei Leerzeilen (paths kompakter; regions ↔ settlements diff-Exit 0) — Regex, Grenzwerte 700/1200, Aufruf von `avesmapsWikiSyncCleanPoliticalTerritoryWikiValue` wortgleich.
- Warum: drei unabhängig gebaute Crawler in Folge — `cc29579ef4` (05.06.2026 23:35, regions) → `fdcbfe33af` (06.06. 02:56, paths) → `3e9982813b` (06.06. 05:19, settlements, Kommentar Z. 778: „Spiegelt avesmapsWikiRegionExtractDescription“). `powerlines.php` hat keine eigene Kopie und ruft die Path-Fassung.
- Empfehlung: zusammenlegen — keine Verhaltensvereinigung nötig, die drei sind heute wortgleich; reine Deduplizierung plus drei `require_once`-Zeilen.
- Beleg: `git blame -w -L 551,589 -- api/_internal/wiki/paths.php` → fdcbfe33af; `-L 619,660 -- regions.php` → cc29579ef4; `-L 779,821 -- settlements.php` → 3e9982813b; `grep -rln ExtractDescription` → nur die vier Dateien, kein Test.
- Fallen: kein Test hält die drei gegeneinander — eine Änderung an einer Kopie (Grenzwert 1200) bliebe in den anderen stehen. Historiker-Lauf 05.09.2026.
- Verlauf: 05.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00; Historiker) · 05.09.2026 GO Owner (zusammenlegen; alte Namen bleiben als Weiterreicher) · 06.09.2026 nachgezogen: `82f713e18` (P-024) hat das Enqueue bei Z. 261-263 auf einen Weiterreicher gekuerzt -- der Block wandert um rund -21 Zeilen und bleibt an den Namen frei · 08.09.2026 nachgezogen: 72ebea96b (die Regionen-Suche findet auch unter Titel, Synonym und Schluessel) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 80cb6bbeb (die Schreiber des Merkers fallen) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 14.09.2026 nachgezogen: a1e26c4ec (eine Wiki-Schlucht wird zur Art Schlucht statt Tal) hat die Datei bewegt; Block an den Namen unveraendert frei, jetzt Z. 617-658

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
- Stand: 5e8bb1862 · Blob: ffb103c1c79046f9700e2befef74ffe0e08b85bb
- Block: „Doppelung: UUID v4 und map_revision-Zähler“ — avesmapsUuidV4 … avesmapsUuidV4 (dreifach: `features.php` Z. 4251, `political/territory.php` `avesmapsPoliticalUuidV4` Z. 1082, `wiki/sync.php` `avesmapsWikiSyncUuidV4` Z. 104; dazu `avesmapsNextMapRevision` `features.php` Z. 4069 ~ `avesmapsWikiSyncNextMapRevision` `wiki/locations-helpers.php` Z. 149)
- Ziel: neue abhängigkeitsfreie Datei `api/_internal/uuid.php` (nur die eine Funktion) und ein ebenso kleiner `map-revision.php`; die alten Namen bleiben als Weiterreicher. NICHT durch Requiren einer der drei Großdateien — Kommentare in `citymaps.php:902`, `ecosystem.php:70`, `game-literature.php:791`, `edit/reports/locations.php:8` begründen, warum niemand die 2700-Zeilen-Datei für einen 15-Zeilen-Helfer einbindet.
- Unterschied: keiner außer Namen (UUID: Rumpf nach Namensersetzung byte-identisch, 15 Zeilen; NextMapRevision ×2 ebenso). ⚠️ `avesmapsNextEcosystemRevision` (ecosystem.php Z. 1258) ist KEINE Doppelung: eigene Tabelle `ecosystem_revision`, eigener Cache-Kreis (`956d53ee9e`, 26.07.2026, begründet in `ecosystem.php:12-16`).
- Warum: drei parallel gewachsene Alt-Bibliotheken vom Mai 2026 (`a564ab1be`, `d760df69e`, `1e59daad3`; `416052fd8`, `1e59daad3`), von den „Move … internal“-Commits nur mechanisch mitverschoben.
- Empfehlung: zusammenlegen in eine abhängigkeitsfreie Datei — erfüllt genau die im Code genannte Bedingung.
- Beleg: `git blame -w -L 4251,4251 -- api/_internal/map/features.php` u. a.; Kommentare `api/_internal/app/citymaps.php:902-903`, `api/_internal/app/ecosystem.php:70-72`.
- Fallen: `settlement-places-test.php` sucht `avesmapsUuidV4` im Quelltext von `features.php` (Prüfung 3b) — der Weiterreicher muss dort stehen bleiben oder der Test mitwandern.
- Verlauf: 05.09.2026 angelegt (Doppelungs-Scan, gleichheit 1,00 / 0,91; Historiker) · 05.09.2026 GO Owner (zusammenlegen; alte Namen bleiben als Weiterreicher) · 08.09.2026 nachgezogen: 3b6439131 und 179c64277 (Kreuzungstyp) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 09.09.2026 nachgezogen: 3b6439131 (Kreuzungstyp) und 80cb6bbeb (Merker) haben die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 13.09.2026 nachgezogen: a04ffc929 (die Art Vor-/Mittelgebirge faellt) hat die Datei bewegt; Block an den Namen unveraendert zusammenhaengend und frei · 15.09.2026 nachgezogen: f28a45a97 (54 tote PHP-Funktionen entfernt) hat die Datei bewegt; die drei UUID- und die zwei NextMapRevision-Fassungen sind weiter gleich bis auf Namen und Leerraum (features.php Z. 4098/3911, political/territory.php Z. 907, wiki/sync.php Z. 114, wiki/locations-helpers.php Z. 149), block.frei

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

## Nicht-Ziele der Routine (Owner-Entscheid 05.09.2026, brauchen einen eigenen Plan)

- **`index.html`** (4273 Z, 999 c): trägt die Routing-Glue inline; die Routine ändert dort nur additiv ein `<script>`.

## Geprüfte Doppelungen ohne Paket (Historiker-Läufe 05.09.2026: gewollt)

Der Doppelungs-Scan meldet sie als zeichengleich; der Historiker hat belegt, warum sie zu Recht zweimal stehen. Kein Paket — wer sie zusammenlegt, dreht eine Entscheidung zurück.

- `avesmapsLoadRouteLand` (`api/_internal/routing/land-areas.php`) ~ `avesmapsLoadRouteWater` (`water-areas.php`): nur die `region_type`-Liste unterscheidet sich (`kontinent,insel` gegen `meer,see`); die Verarbeitung dahinter ist schon vereinigt (`avesmapsPrepareRouteAreas` = `avesmapsPrepareRouteWater`). Plan `docs/superpowers/plans/2026-08-02-ausloeser-anker-und-x25-aufschlag.md:239`: „Kein zweiter Wasserbegriff.“ Commits `3433c1617` (V13) und `6036e3273` (V14, „built to V13's pattern“).
- `readSourceIds` (`map-features-derived-boundary-runtime-fix.js`) ~ `readPoliticalTerritoryDerivedSourceIds` (`map-features-political-territory-loader.js`): die statische Kopie ist der Rückfall für die kurze asynchrone Ladelücke, bevor das injizierte Skript greift — am 27.06.2026 im Audit (`docs/cleanup-audit-2026-06-27.md`, A2) bewusst ANGEGLICHEN statt zusammengelegt (`945762f734`, Owner-GO). Ein Zusammenlegen risse die Timing-Lücke wieder auf.
- `avesmapsSuppressCitymapLink`/`…CitymapPlace` (`api/_internal/app/citymaps.php`) ~ `avesmapsSuppressGameLiteraturePlace` (`game-literature.php`): ECHTE andere Geschäftsregel — Karten tombstonen bei `origin !== 'manual'`, Literatur nur bei `origin === 'wiki'` (Abschnittskommentar vor `avesmapsAddCitymapPlace`, seit P-011 in `citymaps-links.php`: „Deliberate copies … the two tables differ“). Zusammenlegen wäre ein Fehler; kein Test hält die Abweichung fest — das ist die eigentliche Lücke.
- `avesmapsNextEcosystemRevision` (`ecosystem.php` Z. 1258) gegen `avesmapsNextMapRevision`: eigene Tabelle `ecosystem_revision`, eigener Cache-Kreis, damit eine Zeichenkampagne nicht bei jeder Speicherung die 29-MB-Kartennutzlast invalidiert (`956d53ee9e`, `ecosystem.php:12-16`). Gewollt.
