# Rückbau des Garetien-Importers — Implementierungsplan

> **Für ausführende Agenten:** PFLICHT-SKILL: superpowers:subagent-driven-development (empfohlen) oder
> superpowers:executing-plans. Schritte als Checkbox (`- [ ]`).

**Ziel:** Der Garetien-Importer verschwindet restlos aus Repo und Server; alles, was er auf die Karte
gebracht hat, bleibt — samt Quellen, Lizenz und Namensnennung.

**Architektur:** Abbau in drei Commits, die einzeln live gehen (Oberfläche → Server → Doku), danach ein
Owner-Schritt in der Datenbank. Jeder Commit lässt das ganze Testfeld grün. Server-Waisen räumt die
Retire-Liste des Deploy-Workflows (der Deploy löscht nie, AGENTS.md §6/§10).

**Leitfaden, den dieser Plan umsetzt:**
- Abbau-Vertrag: `docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md` §5.5
- Merkzettel: `memory/garetien-importer-abbau.md` (Tabelle „Was verschwindet / Was bleibt")
- Präzedenzfall im Kleinen: Commit `489bb632d` („Fehlimport-Quellen-Knopf restlos zurückgebaut")

## Globale Randbedingungen

- 🔴 **Gebaut wird in einem Wegwerf-Worktree auf `origin/master`**, nie im Hauptbaum — der lokale
  `master` ist abgetrennt (Stand 26.09.2026: 59 vor, 426 hinter `origin/master`). Jede Inventur in
  diesem Plan wurde gegen `origin/master` gemessen.
- 🔴 **Was BLEIBT und nicht angefasst wird:** die übernommenen Kartenobjekte (`map_features`,
  `ecosystem_region`, `ecosystem_area`, `settlement_place`), ihre Quellen (`feature_sources` mit
  `origin='garetien'`, `sources.license = 'cc-by-nc-sa-3.0'`, `sources.attribution`), der Lizenzabsatz
  `legal.garetien.*` im Fenster „Hinweise", die Platzhalter „VolkoV / garetien.de" in den
  Quellenformularen, die Arten `vegetation/urwald` · `topographie/insel` · `stadtviertel`, die Spalten
  `sync_decision.applied_at/applied_by` (geteilte Tabelle).
- 🔴 **Nur eigene Pfade stagen**, nie `git add -A` (AGENTS.md §9). Im Wegwerf-Worktree liegt nur
  eigene Arbeit, dort ist `git add -u` zulässig — trotzdem vor jedem Commit `git status --short` lesen.
- 🔴 **Vor jedem Push das GANZE Testfeld nach dem Muster des Workflows**, parallel, mit Dateizählung
  (AGENTS.md §9). Zahl vorher und nachher notieren — sie sinkt um genau die gelöschten Testdateien.
- 🔴 **Vor jedem Push `gh run list --limit 3`**: läuft ein Deploy und wartet ein zweiter, warten.
- Kommentare und Commit-Texte auf Deutsch; Commit-Nachricht per Datei (`git commit -F`).
- `html/editor-handbuch.html` NICHT anfassen — die Nachtroutine liest den Commit-Betreff.

---

## Befunde der Inventur, die der Leitfaden nicht kannte

1. 💣 **Die Stätten verlieren ihren einzigen Schreibweg.** `settlement_place` („Innerorts einfügen")
   gehört laut Dateikopf nicht dem Importer — aber `avesmapsSettlementPlaceAdd`, `…Exists` und
   `…Deactivate` haben ihre **einzigen** Aufrufer in `garetien-uebernahme.php`. Nach dem Abbau lässt
   sich eine gespeicherte Stätte weder löschen noch umhängen (Quellen gehen weiter über
   `feature-sources.php`, `entity_type = settlement_place`). Owner-Regel: „es darf auf der Map keine
   Elemente geben, über die ich keine Kontrolle mehr habe." → **Owner-Entscheidung E1.**
2. 💣 **Sieben fremde Tests lesen Importer-Dateien direkt** und fallen beim Löschen um (Task 2/3 listet
   sie mit Zeile). *(Inventur vor dem Bau; angepasst wurden am Ende 15 Testdateien, siehe `ae53b0bae`.)*
3. 💣 **Ein Mockup-Vertrag bindet `css/components/garetien-importer.css`**
   (`docs/garetien-import-vereint-mockup.html`, drei `VERTRAG`-Blöcke). `tools/mockup-vertrag`
   liest jedes `docs/*-mockup.html` — ohne die CSS-Datei ist das Deploy-Tor rot.
4. ⚠️ **`css/components/editor-body.css` bleibt in `css/styles.css`**, obwohl der Kommentar dort sie
   mit dem Importer begründet: `js/ui/filter-menu.js` und `js/ui/wiki-weitere-kasten.js` benutzen
   ihre Klassen inzwischen auch in `index.html`. Nur der Modifier `.avm-cols--2` hat keinen anderen
   Nutzer und geht.
   🔴 **Widerlegt 26.09.2026 (`d70e7b5e0`):** keine Klasse hat im index.html-Kontext einen
   Code-Nutzer; die Inventur-grep hatte Kommentare mitgezählt. Der `@import` ist gefallen.
5. ⚠️ **Zwei Funktionen in geteilten Dateien werden tot:** `avesmapsSyncPlanRecordApplied`
   (`api/_internal/wiki/sync-plan.php`, einzige Aufrufer im Importer) und
   `avesmapsSettlementPlacePublicIds` (`settlement-places.php`, einziger Aufrufer
   `garetien-liste.php`). Sie gehen mit (YAGNI). Der LESER von `applied_at` in `sync-plan.php` und die
   Antwortschlüssel `quellen_neu`/`fehler`/`hinweise` des Übernahme-Endpunkts bleiben — sie sind Form
   der geteilten Antwort und bei den sieben anderen Arten schlicht leer.
6. ⚠️ **Der Server-Temp-Ordner `avesmaps_garetien_liste`** (höchstens 2 Dateien à ~2 MB) wird nicht
   geräumt — kein Weg ohne eigenen PHP-Lauf, und er schadet nicht.

## Owner-Entscheidungen (vor Task 2)

- **E1 — Stätten:** (a) hinnehmen — die Schreibfunktionen fallen mit, eine Stätte ändert man danach
  nur per SQL; (b) die drei Schreibfunktionen BLEIBEN in `settlement-places.php` (sie gehören der
  Tabelle, nicht dem Importer), und ein Lösch-/Umhängeweg im Ortseditor wird ein eigener Auftrag.
  **Empfehlung: (b)** — kostet nichts, und die Kontrolle ist nur vertagt, nicht verloren.
- **E2 — `sync_decision`-Zeilen mit `kind='garetien'`:** löschen (sie sind die Buchführung des
  Importers und werden ohne ihn nie mehr gelesen) oder behalten. **Empfehlung: löschen** — die
  Herkunft steht dauerhaft in `feature_sources.origin`.
- **E3 — Dokumente:** Specs und Pläne unter `docs/superpowers/` bleiben als Geschichte stehen; die
  fünf Importer-Mockups (`docs/garetien-*-mockup.html`, `docs/innerorts-import-mockup.html`)
  werden gelöscht, weil sie eine Oberfläche zeigen, die es nicht mehr gibt. **Empfehlung: so.**

✅ **Owner 26.09.2026: alle drei Empfehlungen angenommen** („deine Vorschläge machen wir so, wie du sagst“). Stand im Fenster am selben Tag: Offen 0 · Stage 0 · Abgelehnt 6073 · Übernommen 3119.

---

### Task 0: Stand ablesen und sichern (Owner, ~5 min)

- [x] **Schritt 1:** Garetien Importer öffnen, alle Ebenen: „**Vorgemerkt**" (heute „Stage") muss **0** sein (vorgemerkte
  Objekte gingen verloren). „Offen" und „Abgelehnt" dürfen stehen bleiben — sie verschwinden mit dem
  Abbau, gewollt.
- [ ] **Schritt 2:** phpMyAdmin, zur Kenntnis (E1):
  ```sql
  SELECT origin, is_active, COUNT(*) FROM settlement_place GROUP BY origin, is_active;
  SELECT COUNT(*) FROM feature_sources WHERE origin = 'garetien';
  ```
  Die zweite Zahl notieren — Task 5 prüft, dass sie nach dem Abbau gleich ist.
- [ ] **Schritt 3:** Editor-Shell → „💾 Datenbank-Backup" ziehen (Grundlage für Task 6).

### Task 1: Arbeitsplatz und Nulllinie

**Files:** keine Änderung.

- [ ] **Schritt 1: Wegwerf-Worktree auf `origin/master`**
  ```bash
  SCRATCH="<Scratchpad der Sitzung>"   # nie der Hauptbaum
  git fetch origin
  git worktree add -b garetien-rueckbau "$SCRATCH/garetien-rueckbau" origin/master
  cd "$SCRATCH/garetien-rueckbau"
  ```
- [ ] **Schritt 2: Testfeld zählen und fahren** (Muster aus `.github/workflows/deploy-avesmaps-strato.yml`)
  ```bash
  find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
  find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
  find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > "$SCRATCH/rot-js-vorher"
  find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' > "$SCRATCH/rot-php-vorher"
  ```
  Erwartet: Zahlen notiert; rot höchstens `linkcheck/link-url-test.php`. Diese Liste ist die
  Nulllinie — jedes andere Rot danach ist unseres.

### Task 2: Commit A — die Oberfläche

✅ Task 2 und 3 als EIN Commit umgesetzt (`ae53b0bae`, 26.09.2026) — die Import-Tests lasen
Oberflächendateien, ein Zwischenstand hätte das Deploy-Tor rot gemacht.

Nach diesem Commit ist der Importer für niemanden mehr erreichbar; der Endpunkt steht noch
(verwaist, aber unschädlich) und fällt in Commit B.

**Files:**
- Delete: `js/review/review-garetien-importer.js`, `js/review/review-garetien-karte.js`,
  `js/review/review-garetien-label-vorschau.js`, `css/components/garetien-importer.css`,
  `js/review/__tests__/garetien-*.test.js` (alle), `js/review/__tests__/helfer/garetien-testumgebung.js`,
  `docs/garetien-importer-mockup.html`, `docs/garetien-importer-stage-mockup.html`,
  `docs/garetien-import-vereint-mockup.html`, `docs/garetien-fragmente-mockup.html`,
  `docs/innerorts-import-mockup.html`
- Modify: `index.html` (Knopf ~Z. 581–590, Fenster ab Z. 4271 samt Kommentar ab ~4211, drei
  `<script>`-Zeilen ~4224/4225/4231), `css/styles.css:68-71`, `css/base/tokens.css` (die drei
  `--color-garetien-*` in hell ~263–290 und dunkel ~1169–1174 samt ihrer Kommentarblöcke),
  `css/components/editor-body.css:118-120` (`.avm-cols--2`), die Kommentare in
  `css/styles.css:55-58` und `css/components/editor-body.css:5,24,238` (Begründung auf
  „filter-menu / wiki-weitere-kasten in index.html" umstellen — 🔴 **widerlegt 26.09.2026
  (`d70e7b5e0`), siehe Befund 4**: kein Code-Nutzer, der `@import` fiel)
- Modify (fremde Tests): `js/review/__tests__/kanon-nachtrag-tafel.test.js:146-167`,
  `js/ui/__tests__/keine-auto-silbentrennung.test.js:165-175`,
  `js/pages/__tests__/editor-body-single-source.test.js` (Abschnitt `.avm-cols--2`, ~Z. 125-130,
  und die Begründungssätze Z. 6/70)

- [x] **Schritt 1: Dateien löschen**
  ```bash
  git rm js/review/review-garetien-importer.js js/review/review-garetien-karte.js js/review/review-garetien-label-vorschau.js css/components/garetien-importer.css js/review/__tests__/helfer/garetien-testumgebung.js
  git rm js/review/__tests__/garetien-*.test.js
  git rm docs/garetien-importer-mockup.html docs/garetien-importer-stage-mockup.html docs/garetien-import-vereint-mockup.html docs/garetien-fragmente-mockup.html docs/innerorts-import-mockup.html
  ```
  (Existiert eine der Mockup-Dateien auf `origin/master` nicht, weglassen — der Hauptbaum hat
  zwei davon als unversionierte Fremddateien, die gehören einer anderen Sitzung.)
- [x] **Schritt 2: `index.html`** — den `<button id="garetien-importer-open">` samt seinem
  Kommentarblock, das `<div id="garetien-importer" …>` bis zu seinem schließenden `</div>` und die
  Skriptzeilen `review-garetien-label-vorschau.js`, `review-garetien-importer.js` und die
  `<template data-nur-editor>`-Zeile mit `review-garetien-karte.js` entfernen. Gegenprobe:
  ```bash
  grep -n -i "garetien" index.html
  ```
  Erwartet: nur noch `legal.garetien.*` (Hinweise) und der Platzhalter „VolkoV / garetien.de".
- [x] **Schritt 3: CSS** — `@import url("components/garetien-importer.css");` samt Kommentar aus
  `css/styles.css`; die drei Tokens in beiden Themen aus `tokens.css`; `.avm-cols--2` aus
  `editor-body.css`. Gegenprobe:
  ```bash
  git grep -n "color-garetien\|avm-cols--2\|garetien-importer.css" -- . ':!docs'
  ```
  Erwartet: keine Treffer außer in den fremden Tests, die Schritt 4 anpasst.
- [x] **Schritt 4: Fremde Tests**
  - `kanon-nachtrag-tafel.test.js`: die Zeilen `const importerCode = …` und den Block
    `const importerAufruf = …` bis zur zugehörigen `pruefe(…)` streichen. Die Editor-Prüfung
    (`geprueft === 2`) bleibt unverändert.
  - `keine-auto-silbentrennung.test.js`: Abschnitt „3. Der Garetien-Importer" (Einlesen von
    `garetien-importer.css` und seine Zusicherung) streichen; laufende Nummern der Folgeabschnitte
    nicht umnummerieren, wenn andere Stellen darauf verweisen.
  - `editor-body-single-source.test.js`: die Zusicherung auf `.avm-cols--2` streichen; die
    Begründung „das Fenster Garetien Importer lebt in index.html" durch „filter-menu.js und
    wiki-weitere-kasten.js benutzen die Formen in index.html" ersetzen — die Regel selbst (Datei in
    `styles.css` gebunden) bleibt wahr.
- [x] **Schritt 5: Restsuche Oberfläche**
  ```bash
  git grep -n -E "review-garetien|garetien-importer|gi-win|garetienListe|garetienImport" -- . ':!docs' ':!api'
  ```
  Erwartet: nur noch Kommentare (Historie). Jeder Code-Treffer wird entfernt.
- [x] **Schritt 6: Ganzes Testfeld** (Befehle aus Task 1, Ausgabe nach `rot-*-A`), dann
  ```bash
  diff "$SCRATCH/rot-js-vorher" "$SCRATCH/rot-js-A"; diff "$SCRATCH/rot-php-vorher" "$SCRATCH/rot-php-A"
  ```
  Erwartet: keine neuen roten Zeilen; JS-Zahl sinkt um die Zahl der gelöschten `garetien-*.test.js`.
- [x] **Schritt 7: Commit und Push** — Betreff:
  `chore(garetien): Garetien Importer aus dem WikiSync-Panel entfernt – Import abgeschlossen`
  ```bash
  git add -u && git status --short   # nur Löschungen und die oben genannten Dateien
  git commit -F "$SCRATCH/msg-A.txt"
  gh run list --limit 3
  git push origin HEAD:master
  ```
- [x] **Schritt 8: Owner-Blick** (sichtbare Änderung, §9): nach dem Deploy als Editor das WikiSync-Panel
  öffnen — kein Knopf „Garetien Importer"; als Besucher die Karte laden und die Konsole lesen
  (keine Fehler).

### Task 3: Commit B — Server, Werkzeuge, Retire-Liste

Muss ein Commit sein: ohne die Bibliotheken bräche das `require_once` im Übernahme-Endpunkt (Fatal mit
leerem Rumpf — AGENTS.md: „liest sich im Browser als Netzfehler").

**Files:**
- Delete: `api/edit/map/garetien-import.php`, `api/_internal/import/` (ganz, samt `__tests__/` und
  `fixtures/`), `tools/garetien/` (ganz), `sql/garetien-import-staging-bestand.sql`,
  `sql/garetien-passpunkte-ziehen.sql`
- Modify: `api/edit/wiki/sync-plan.php` (Kommentar + `require_once` Z. 37–40; `'garetien'` aus
  `AVESMAPS_SYNC_PLAN_KINDS` Z. 90; die Variablen `$garetien*` und der ganze
  `if ($kind === 'garetien') { … }`-Block ~Z. 244–284; der Arm `'garetien' => …` ~Z. 313–322;
  Kommentare, die den Garetien-Zweig als einzigen Befüller nennen, auf „derzeit füllt keine Art sie"
  kürzen)
- Modify: `api/_internal/wiki/sync-plan.php` (Funktion `avesmapsSyncPlanRecordApplied` samt
  Doc-Block ~Z. 738–800 entfernen; Verweise darauf in Kommentaren ~Z. 652, 797 anpassen)
- Modify: `api/_internal/app/settlement-places.php` (nur `avesmapsSettlementPlacePublicIds` ~Z. 256–290;
  Add/Exists/Deactivate bleiben nach E1-b; Dateikopf: „der Garetien-Import war ihr erster Schreiber —
  seit dem Rückbau (26.09.2026) hat sie keinen; ein Bearbeitungsweg ist offen")
- Modify: `js/review/sync-plan-sheet.js` (die vier `garetien:`-Einträge Z. 26, 37, 136, 154, 176–177)
- Modify (fremde Tests):
  - `api/_internal/wiki/__tests__/sync-plan-aufraeumen-test.php:150-165` — Abschnitt C („Die NAHT zum
    Importer") streichen, `$pruefungen` entsprechend.
  - `api/_internal/app/__tests__/kanon-nachtrag-test.php:318-330` — die `$uebernahme`-Zusicherungen
    streichen.
  - `api/_internal/app/__tests__/landschaft-wiki-schreiber-waechter-test.php:109-110` — den Eintrag
    `garetien-uebernahme.php => 1` aus der Schreiberliste.
  - `api/_internal/wiki/__tests__/datei-riegel-test.php:167` und
    `api/_internal/wiki/__tests__/wiki-drossel-alle-erzeuger-test.php:152` — den Eintrag
    `garetien-abruf.php` aus der Erzeugerliste.
  - `api/_internal/wiki/__tests__/sync-plan-decline-changetype-test.php` und
    `sync-plan-aufraeumen-test.php` (Abschnitte A/B): `'garetien'` ist dort nur ein Art-String in der
    Fixture; laufen lassen — bleiben sie grün, nur die Kommentarverweise auf `garetien-liste.php`
    auf „ehemals der Garetien-Importer" ändern.
- Modify: `.github/workflows/deploy-avesmaps-strato.yml` (Retire-Liste `retire_nur_server_php`)

- [x] **Schritt 1: Löschen**
  ```bash
  git rm -r api/_internal/import tools/garetien
  git rm api/edit/map/garetien-import.php sql/garetien-import-staging-bestand.sql sql/garetien-passpunkte-ziehen.sql
  ```
- [x] **Schritt 2: Übernahme-Endpunkt und Bibliothek** wie oben unter Files. Gegenprobe:
  ```bash
  php -l api/edit/wiki/sync-plan.php && php -l api/_internal/wiki/sync-plan.php && php -l api/_internal/app/settlement-places.php
  git grep -n -E "avesmapsGaretien|AVESMAPS_GARETIEN|_internal/import/|garetien_import_|SyncPlanRecordApplied|SettlementPlacePublicIds" -- . ':!docs'
  ```
  Erwartet: `No syntax errors` dreimal; grep nur noch in der Retire-Liste des Workflows (Schritt 4)
  und in AGENTS.md (Task 4).
- [x] **Schritt 3: `sync-plan-sheet.js`** — die `garetien`-Einträge der Tafeln entfernen; kein Code
  verzweigt dort auf die Art (Gegenprobe `grep -n garetien js/review/sync-plan-sheet.js` → leer).
- [x] **Schritt 4: Retire-Liste** — jede in Task 2 und Task 3 gelöschte, deploybare Datei ans Ende von
  `retire_nur_server_php` (mit Kommentarzeile „Garetien-Importer, zurückgebaut 26.09.2026"):
  ```bash
  git diff --name-only --diff-filter=D origin/master -- api js css | sort
  ```
  Jeden Pfad als `"…"`-Zeile eintragen. 💣 Nur Dateien, die im Repo **nicht** mehr liegen (Wächter
  `tools/__tests__/retire-liste-geschuetzt.test.js`). Die zwei alten Garetien-Zeilen
  (`garetien-quellen-abbau*.php`) bleiben stehen.
- [x] **Schritt 5: Ganzes Testfeld** (wie Task 1 → `rot-*-B`), Diff gegen die Nulllinie. Zusätzlich:
  ```bash
  node tools/__tests__/retire-liste-geschuetzt.test.js
  node tools/mockup-vertrag/__tests__/mockup-vertrag.test.js
  ```
  Erwartet: keine neue rote Zeile; PHP-Zahl sinkt um die Testdateien unter `api/_internal/import`.
- [x] **Schritt 6: Commit und Push** — Betreff:
  `chore(garetien): Importer-Endpunkt, Bibliotheken und Werkzeuge entfernt, Server-Waisen auf der Retire-Liste`
  ```bash
  git add -u && git add .github/workflows/deploy-avesmaps-strato.yml && git status --short
  git commit -F "$SCRATCH/msg-B.txt"
  gh run list --limit 3
  git push origin HEAD:master
  ```
- [x] **Schritt 7: Retire-Lauf prüfen** — im Deploy-Log muss „Retiring orphaned remote files" laufen
  (der Workflow steckt im Push). Danach **eine** Anfrage:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" https://avesmaps.de/api/edit/map/garetien-import.php
  ```
  Erwartet: `404`.

### Task 4: Commit C — Dokumentation

**Files:** `AGENTS.md`, `docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md`,
Kommentare in `css/components/editor-page.css:60,316,374`, Memory.

- [x] **Schritt 1: AGENTS.md** — den §11-Eintrag „Die Arbeitsliste des Garetien-Importers hat einen
  FESTEN und einen WECHSELNDEN Teil" entfernen (er beschreibt nur noch Gelöschtes). Die übrigen
  Erwähnungen (Z. ~755, 779, 785, 935, 936, 957, 958, 1030) sind Historie eines bleibenden Features;
  nur dort, wo ein **Dateipfad** des Importers als lebend genannt wird, „(zurückgebaut 26.09.2026)"
  anhängen. `.gi-detail__name` in Z. ~1030 streichen.
- [x] **Schritt 2: Spec §5.5** — unter die Überschrift eine Zeile: „✅ **Abgebaut am 26.09.2026**
  (Plan `docs/superpowers/plans/2026-09-26-garetien-importer-rueckbau.md`). Übernommene Objekte,
  Quellen und Namensnennung stehen."
- [x] **Schritt 3: CSS-Kommentare** in `editor-page.css`, die das Importer-Fenster als Grund nennen,
  auf den heutigen Grund umstellen (siehe Task 2 Schritt 4). 🔴 **Widerlegt 26.09.2026
  (`d70e7b5e0`):** „der heutige Grund" war die falsche Annahme aus Befund 4
  (filter-menu/wiki-weitere-kasten in index.html) — kein Code-Nutzer. Tatsächlich umgesetzt: der
  `@import` fiel, die Kommentare nennen den historischen Grund (Garetien-Importer, zurückgebaut).
- [x] **Schritt 4: Testfeld, Commit, Push** — Betreff: `docs(garetien): Abbau des Importers dokumentiert`
- [ ] **Schritt 5: Memory** — `garetien-importer-abbau.md` auf „✅ abgebaut 26.09.2026, offen: Task 6"
  setzen, `index-garetien-import.md` und die Zeile in `MEMORY.md` entsprechend kürzen.

### Task 5: Live-Abnahme (Abläufe, nicht Maße)

- [ ] Als **Besucher** (ohne `edit=1`) laden, Konsole lesen: keine Fehler.
- [ ] Ein übernommenes Garetien-Objekt anklicken (z. B. einen Bach im Kosch): Infobox zeigt die Quelle
  mit „VolkoV / garetien.de, CC BY-NC-SA 3.0".
- [ ] Hinweise → „Kartendaten aus Garetien und dem Kosch" steht.
- [ ] Als **Editor**: eine andere Übernahme-Vorschau öffnen (z. B. Stadtkarten „Syncen") — sie rechnet
  und zeigt ihre Liste (der Verteiler funktioniert ohne den Garetien-Arm).
- [ ] phpMyAdmin: `SELECT COUNT(*) FROM feature_sources WHERE origin = 'garetien';` = Zahl aus Task 0.

### Task 6: Datenbank aufräumen (Owner, frühestens eine Woche nach Task 5)

Unumkehrbar — nur mit Backup aus Task 0. Die Staging-Daten sind jederzeit neu von garetien.de /
koschwiki.de holbar; verloren geht nur die Entscheidungsbuchführung (E2).

- [ ] ```sql
  DROP TABLE IF EXISTS garetien_import_row;
  DROP TABLE IF EXISTS garetien_import_run;
  DELETE i FROM sync_plan_item i JOIN sync_plan_run r ON r.id = i.run_id WHERE r.kind = 'garetien';
  DELETE FROM sync_plan_run WHERE kind = 'garetien';
  DELETE FROM sync_decision WHERE kind = 'garetien';   -- nur bei E2 = löschen
  OPTIMIZE TABLE sync_plan_item;
  ```
- [ ] Gegenprobe: `SHOW TABLES LIKE 'garetien%';` → leer; `feature_sources`-Zahl unverändert.
