# Lebensraum-Regel — Sitzung 3: die Wirkung

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine gespeicherte Lebensraum-Regel wirkt endlich nach außen — sie erscheint in den Infoboxen der getroffenen Flächen und Siedlungen, sie ist über die Suche auffindbar, und der Suchtreffer hebt die **Schnittmenge** hervor statt der ganzen Fläche.

**Architecture:** Der Lesepfad fragt die Regel **umgekehrt** zur Editor-Vorschau: nicht „welche Objekte trifft diese Regel", sondern „welche Regeln treffen dieses eine Objekt". Das ist ein Join über bereits gerechnete Zeilen und kostet keine Geometrie. Alle vier Infobox-Oberflächen laufen schon durch **einen** Markup-Bauer (`buildLoreMarkup`) und **einen** Endpunkt (`api/app/lore.php`) — dort setzt alles an. Die Hervorhebung verschneidet Fläche gegen Klimaband im Browser mit der vorhandenen `polygon-clipping`-Bibliothek.

**Tech Stack:** PHP 8 strict types + PDO/MySQL; Vanilla-JS ohne Bauschritt; Leaflet 1.9.4; `js/third-party/polygon-clipping`.

**Entwurf:** `docs/superpowers/specs/2026-08-12-vorkommen-lebensraum-regel-design.md` — §5 (Lesepfad), §5.1 (Riegel bei laufender Rechnung), §7 (Suche und Hervorhebung)
**Vorgänger:** Sitzung 1 `…-sitzung-1.md` (Serverhälfte, mit Tabelle ihrer fünf Planfehler), Sitzung 2 `…-sitzung-2.md` (der Editor)

## Was die Sitzungen 1 und 2 hinterlassen haben

| Baustein | Wo | Zusicherung |
|---|---|---|
| `avesmapsLoreRuleEvaluate($terms, $areas, $places, $orderedZoneKeys)` | `api/_internal/app/lore-rule.php` | rein; UND wirkt auf der Ergebnismenge |
| `avesmapsLoreRuleReadForEntry(PDO, string)` | `api/_internal/app/lore-rule-store.php` | alle aktiven Regeln **eines Eintrags** |
| `avesmapsLoreRuleReadAreas / …ReadPlaces / …OrderedZoneKeys` | dieselbe Datei | für die **Editor-Vorschau**; ⚠️ `ReadPlaces` rechnet Punkt-in-Polygon je Ort |
| `avesmapsLoreReadForPlaces(PDO, array $placeKeys, int $limit, array $rankByKey)` | `api/_internal/app/lore.php` | die genannten Orte, nach Art gruppiert, mit Rang |
| `buildLoreMarkup(placeRef)` | `js/map-features/map-features-lore.js:578` | **der eine** Markup-Bauer aller vier Oberflächen; lädt faul über `api/app/lore.php?place=…&title=…` |
| `location_ecosystem`, `ecosystem_region_overlap`, `path_ecosystem`, `ecosystem_region_territory` | Datenbank | gefüllt von „Zugehörigkeit rechnen", live 6.526 Ortszeilen |
| `ecosystem_assignment_stamp` (id = 1) | Datenbank | `completed`, `computed_at`, `ecosystem_revision`, `map_revision` |

💣 **`avesmapsLoreRuleReadPlaces` darf NICHT in den Lesepfad.** Sie rechnet die Zone je Ort mit Punkt-in-Polygon über ~2.800 Orte — für die Editor-Vorschau vertretbar, auf dem öffentlichen Lesepfad genau das, was Entwurf §5 verbietet. Diese Sitzung baut die **umgekehrte** Abfrage: ein Objekt, seine schon gespeicherten Zugehörigkeiten, ein Join.

## Global Constraints

- **Sichtbare Änderungen gehen EINZELN live, und der Owner sieht jede** (AGENTS.md §9). Block A (Tasks 1–2) ist unsichtbar. **Block B (Tasks 3–4) macht Regeln in Infoboxen sichtbar**, Block C (Tasks 5–6) ändert die Suche — jeder Block für sich, mit Blick dazwischen.
- 🔴 **Kein DDL, keine `information_schema`-Sonde und keine Geometrie auf dem Lesepfad.** `api/app/lore.php` ist öffentlich und wird von jeder Infobox gezogen. Der Vorfall vom 17.07.2026 hat damit den PHP-Worker-Pool erschöpft.
- 🔴 **Bei `ecosystem_assignment_stamp.completed = 0` liefert der Lesepfad GAR KEINEN Regelabschnitt** — nicht einen leeren. Während eines Laufs sind die Zuordnungstabellen leer; ein leerer Abschnitt sähe aus wie „hier wächst nichts" (Entwurf §5.1).
- **Rang 1 für Regeltreffer** — dieselbe Sprosse wie ein Untergebiet: spezifischer als kontinentweit (3), aber nie vor einem ausdrücklich genannten Ort (0). Rang 2 bleibt frei.
- **Eine Fläche zählt, wenn sie die Zone berührt; eine Siedlung nur, wenn sie SELBST darin liegt.** Ein Punkt kann nicht „teilweise" in einer Zone liegen.
- 💣 **y wächst nach NORDEN** (polar y 883–1024, tropisch y 0–480), SVG- und Bildschirm-y nach unten. Wer Geometrie zeichnet, spiegelt.
- **Nie eine Farbe, einen Radius, einen Abstand hartkodiert** — Token aus `css/base/tokens.css`.
- **Jeder Abruf braucht ein Zeitlimit** (`avesmapsLoreFetchWithTimeout`, 12 s). Ein hängender Request belegt bis zum Servertimeout einen PHP-Worker.
- **Tests:** JS nackt (`node <datei>.test.js`); PHP **mit** den Erweiterungen, sonst ist `assert()` ein No-Op und Dutzende Tests melden Geister-Fehlschläge:
  `php -d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_sqlite3.dll -d extension=php_gd.dll -d extension=php_curl.dll <datei>`
- **Vor jedem Push das GANZE Testfeld.** Ein roter Test lädt nichts hoch, und der Fehlschlag vergiftet danach den `?v=`-Stempel.
- **Geteilter Arbeitsbaum:** nie `git add -A`, `git add .`, `git commit -a`. Nur eigene Pfade, explizit.

## File Structure

| Datei | Verantwortung | Task |
|---|---|---|
| `api/_internal/app/lore-rule-match.php` (neu) | **REIN + eine Leserhälfte.** Die umgekehrte Frage: welche Regeln treffen *dieses* Objekt. | 1 |
| `api/_internal/app/__tests__/lore-rule-match-test.php` (neu) | dazu die Tests | 1 |
| `api/app/lore.php` | nimmt die Identität des Objekts entgegen und mischt die Regeltreffer unter die Ortstreffer | 2 |
| `js/map-features/map-features-lore.js` | `placeRef` trägt die Identität; der Abruf schickt sie mit | 3 |
| `js/map-features/map-features-labels.js` · `-location-marker-entry.js` · `-path-landscapes.js` · `-region-info-markup.js` | je eine Zeile: die Identität in den `placeRef` | 4 |
| `api/_internal/app/lore-search.php` | Regeln reisen in der Suche mit | 5 |
| `js/ui/spotlight-search-focus.js` | die Hervorhebung zeigt die Schnittmenge | 6 |

💣 **`api/app/lore.php` ist der heißeste öffentliche Lesepfad des Hauses.** Jede geöffnete Infobox zieht ihn. Alles, was diese Sitzung dort ergänzt, muss ein Join über gerechnete Zeilen sein — keine Schleife, keine Geometrie, kein DDL.

---

### Task 1: Die umgekehrte Frage

**Files:**
- Create: `api/_internal/app/lore-rule-match.php`
- Test: `api/_internal/app/__tests__/lore-rule-match-test.php`

**Interfaces:**
- Consumes: `avesmapsLoreRuleZoneKeys($orderedZoneKeys, $from, $to)` und `avesmapsLoreRuleTermMatchesArea($term, $area, $orderedZoneKeys)` aus `api/_internal/app/lore-rule.php` (rein, aus Sitzung 1).
- Produces:
  - `avesmapsLoreRuleSubjectFromArea(array $area): array` — **REIN**. Aus einer Flächenzeile (`public_id`, `kind`, `region_type`, `zones`) das „Subjekt", gegen das Regeln geprüft werden.
  - `avesmapsLoreRuleSubjectFromPlace(array $place, array $areasById): array` — **REIN**. Aus einer Siedlung (`public_id`, `zone`, `area_public_ids`) plus der Flächentabelle das Subjekt: die Siedlung erbt die Arten **aller** Flächen, in denen sie liegt, behält aber ihre **eigene** Zone.
  - `avesmapsLoreRuleTermMatchesSubject(array $term, array $subject, array $orderedZoneKeys): bool` — **REIN**.
  - `avesmapsLoreRuleReadSubjectForArea(PDO $pdo, string $areaPublicId): ?array` und `…ForLocation(PDO $pdo, string $locationPublicId): ?array` — lesen das Subjekt aus den **gerechneten** Tabellen; `null`, wenn es das Objekt nicht gibt oder die Tabellen fehlen.

- [ ] **Step 1: Write the failing test**

```php
<?php

declare(strict_types=1);

// Die UMGEKEHRTE Frage: nicht "welche Objekte trifft diese Regel", sondern "welche Regeln
// treffen dieses eine Objekt". Der Lesepfad stellt nur diese; sie ist ein Join, keine Geometrie.

require_once __DIR__ . '/../lore-rule.php';
require_once __DIR__ . '/../lore-rule-match.php';

$zones = ['polar', 'subpolar', 'boreal', 'gemaessigt', 'subtropen_winterfeucht',
    'trockene_subtropen', 'subtropisch', 'tropisch'];
$term = static fn (array $o = []): array => array_merge(
    ['area_public_id' => null, 'types' => [], 'climate_from' => null, 'climate_to' => null, 'join_op' => 'und'],
    $o
);

// --- Eine FLAECHE ist ihr eigenes Subjekt -------------------------------------------------
$farindel = ['public_id' => 'a1', 'kind' => 'vegetation', 'region_type' => 'wald', 'zones' => ['gemaessigt']];
$subjectArea = avesmapsLoreRuleSubjectFromArea($farindel);
assert($subjectArea['public_id'] === 'a1');
assert($subjectArea['types'] === [['kind' => 'vegetation', 'region_type' => 'wald']]);
assert($subjectArea['zones'] === ['gemaessigt']);

$wald = $term(['types' => [['kind' => 'vegetation', 'region_type' => 'wald']]]);
assert(avesmapsLoreRuleTermMatchesSubject($wald, $subjectArea, $zones) === true);
$gebirge = $term(['types' => [['kind' => 'topographie', 'region_type' => 'gebirge']]]);
assert(avesmapsLoreRuleTermMatchesSubject($gebirge, $subjectArea, $zones) === false);

// --- Eine SIEDLUNG erbt die Arten ihrer Flaechen, behaelt aber ihre eigene Zone -----------
// 💣 Genau hier liegt der Unterschied, der die ganze Regel traegt: der Finsterkamm BERUEHRT
// boreal und gemaessigt, aber ein Ort darin liegt in genau EINEM Band. Wer der Siedlung die
// Zonen ihrer Flaeche vererbt, macht aus 4 Treffern 44.
$finsterkamm = ['public_id' => 'a2', 'kind' => 'topographie', 'region_type' => 'gebirge',
    'zones' => ['boreal', 'gemaessigt']];
$areasById = ['a1' => $farindel, 'a2' => $finsterkamm];

$imSueden = ['public_id' => 'p1', 'zone' => 'gemaessigt', 'area_public_ids' => ['a2']];
$imNorden = ['public_id' => 'p2', 'zone' => 'boreal', 'area_public_ids' => ['a2']];
$subjectSued = avesmapsLoreRuleSubjectFromPlace($imSueden, $areasById);
$subjectNord = avesmapsLoreRuleSubjectFromPlace($imNorden, $areasById);

assert($subjectSued['zones'] === ['gemaessigt'], 'die EIGENE Zone, nicht die der Flaeche');
assert($subjectNord['zones'] === ['boreal']);
assert($subjectSued['types'] === [['kind' => 'topographie', 'region_type' => 'gebirge']]);

$gebirgeBoreal = $term(['types' => [['kind' => 'topographie', 'region_type' => 'gebirge']],
    'climate_from' => 'boreal', 'climate_to' => 'boreal']);
assert(avesmapsLoreRuleTermMatchesSubject($gebirgeBoreal, $subjectNord, $zones) === true);
assert(avesmapsLoreRuleTermMatchesSubject($gebirgeBoreal, $subjectSued, $zones) === false,
    'der Ort im Sueden faellt heraus, obwohl seine Flaeche boreal beruehrt');

// --- Ein Ort in ZWEI Flaechen erbt beide Arten (der "Bergwald") ---------------------------
$bergwald = ['public_id' => 'p3', 'zone' => 'gemaessigt', 'area_public_ids' => ['a1', 'a2']];
$subjectBeide = avesmapsLoreRuleSubjectFromPlace($bergwald, $areasById);
assert(count($subjectBeide['types']) === 2);
assert(avesmapsLoreRuleTermMatchesSubject($wald, $subjectBeide, $zones) === true);
assert(avesmapsLoreRuleTermMatchesSubject($gebirge, $subjectBeide, $zones) === true);

// --- Die Identitaets-Bedingung trifft nur die genannte FLAECHE -----------------------------
// 💣 Eine Regel "Flaechenname = Farindelwald" trifft die Flaeche selbst. Ob sie auch die Orte
// DARIN treffen soll, ist eine Entscheidung -- hier: ja, ueber die geerbten Flaechen.
$nurFarindel = $term(['area_public_id' => 'a1']);
assert(avesmapsLoreRuleTermMatchesSubject($nurFarindel, $subjectArea, $zones) === true);
assert(avesmapsLoreRuleTermMatchesSubject($nurFarindel, $subjectSued, $zones) === false);
assert(avesmapsLoreRuleTermMatchesSubject($nurFarindel, $subjectBeide, $zones) === true,
    'der Bergwald-Ort liegt im Farindel, also trifft ihn die Flaechenbedingung');

// --- Leere Bedingung trifft alles, aber der Schreibriegel laesst sie gar nicht erst zu -----
assert(avesmapsLoreRuleTermMatchesSubject($term(), $subjectArea, $zones) === true);

echo "lore-rule-match: OK\n";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/lore-rule-match-test.php`
Expected: FAIL — `Failed opening required '.../lore-rule-match.php'`

- [ ] **Step 3: Write minimal implementation**

Create `api/_internal/app/lore-rule-match.php`. Die drei reinen Funktionen zuerst; halte dich an die Bauart von `lore-rule.php` (Docblock mit Begründung, keine Globals, nichts läuft beim Einbinden).

Der Kern von `avesmapsLoreRuleSubjectFromPlace`: `types` ist die Vereinigung der `kind`/`region_type`-Paare aller Flächen aus `area_public_ids` (ohne Dubletten, in der Reihenfolge der Flächenliste); `zones` ist **ausschliesslich** `[$place['zone']]`, nie die Zonen der Flächen; `area_public_ids` wandert unverändert mit, damit die Identitäts-Bedingung sie prüfen kann.

`avesmapsLoreRuleTermMatchesSubject` prüft in dieser Reihenfolge und mit UND: die Identität gegen `public_id` **oder** `area_public_ids`; die Arten (mehrere = ODER); die Zonen über `avesmapsLoreRuleZoneKeys` gegen `$subject['zones']`.

💣 Schreib in den Docblock, **warum** eine Siedlung ihre eigene Zone behält — mit der Finsterkamm-Zahl (44 gegen 4). Ohne diese Begründung räumt jemand die Sonderbehandlung als vermeintliche Dublette weg.

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/lore-rule-match-test.php`
Expected: `lore-rule-match: OK`

- [ ] **Step 5: Prove the test bites**

Mutationen einzeln nachfahren, jede muss ROT sein:
- In `SubjectFromPlace` `zones` aus den Flächen statt aus dem Ort nehmen (der Finsterkamm-Fall muss anschlagen).
- Bei mehreren Arten in einer Bedingung nur die erste prüfen.
- Die Identitäts-Bedingung nur gegen `public_id` prüfen, nicht gegen `area_public_ids`.

Bleibt eine grün, ergänze den fehlenden Testfall, statt es zu melden. In den beiden Vorsitzungen war die vorgegebene Testfassung **fünfmal** nicht scharf genug.

- [ ] **Step 6: Die zwei Leser**

Ans Ende derselben Datei, mit PDO:

`avesmapsLoreRuleReadSubjectForArea(PDO, string $areaPublicId): ?array` liest die Fläche aus `ecosystem_region` (`is_active = 1`, `kind <> 'klima'`) samt ihrer Zonen aus `ecosystem_region_overlap` — mit der Schwelle `AVESMAPS_CLIMATE_REGION_MIN_SHARE` und der Einschränkung `other_region_id IN (SELECT id FROM ecosystem_region WHERE kind = 'klima' AND is_active = 1)`. ⚠️ **Vorbild ist `avesmapsLoreRuleReadAreas` in `lore-rule-store.php`** — dort steht beides schon richtig, samt Begründung, warum das `IN` den Index arbeiten lässt. Übernimm die Form, aber für **eine** Fläche.

`avesmapsLoreRuleReadSubjectForLocation(PDO, string $locationPublicId): ?array` liest den Ort aus `map_features` (`feature_type = 'location'`, `is_active = 1`), seine Flächen über `location_ecosystem` → `ecosystem_area` → `ecosystem_region`, und seine eigene Zone. 💣 **Die Zone eines Ortes ist keine Spalte** — sie wird gerechnet (`avesmapsClimateZoneKeyAt` mit `avesmapsClimateReadBands`, `api/_internal/app/climate-membership.php`), aus den Koordinaten in `geometry_json`. Die Bänder **einmal je Aufruf** holen. Das war in Sitzung 1 schon einmal ein Planfehler; sieh dir `avesmapsLoreRuleReadPlaces` an, dort steht es richtig.

Beide fangen fehlende Tabellen ab und geben `null` zurück — kein 500 auf dem öffentlichen Lesepfad.

- [ ] **Step 7: Testfeld und Commit**

```bash
php -l api/_internal/app/lore-rule-match.php
EXT="-d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_sqlite3.dll -d extension=php_gd.dll -d extension=php_curl.dll"
for t in $(find api tools -path '*__tests__*' -name '*test*.php'); do php -d zend.assertions=1 $EXT "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
git add api/_internal/app/lore-rule-match.php api/_internal/app/__tests__/lore-rule-match-test.php
git commit -m "feat(vorkommen): die umgekehrte Frage -- welche Regeln treffen dieses Objekt"
```

---

### Task 2: Regeln im Lesepfad

**Files:**
- Modify: `api/app/lore.php` (Kopfkommentar, `require_once`, der `?place=`-Zweig)
- Modify: `api/_internal/app/lore.php` (`avesmapsLoreReadForPlaces` bekommt einen Zwilling für Regeln)
- Test: `api/_internal/app/__tests__/lore-rule-match-test.php` (erweitern)

**Interfaces:**
- Consumes: alles aus Task 1; `avesmapsLoreRuleReadForEntry` ist hier **nicht** brauchbar (sie fragt je Eintrag, wir brauchen alle Regeln auf einmal).
- Produces:
  - `avesmapsLoreRuleReadAllActive(PDO $pdo): array` — alle aktiven Regeln aller Einträge, als `list<array{entry_wiki_key: string, relation: string, terms: list<array>}>`. **Drei Abfragen für den ganzen Bestand**, nie eine je Regel.
  - `avesmapsLoreRuleEntriesForSubject(PDO $pdo, array $subject): array` — `entry_wiki_key => relation` für alle Regeln, die dieses Subjekt treffen.
  - `api/app/lore.php?place=…` nimmt zusätzlich `&area=<public_id>` **oder** `&location=<public_id>` und liefert die Regeltreffer in denselben `sections` mit `rank` 1.

- [ ] **Step 1: Write the failing test**

Ans Ende von `api/_internal/app/__tests__/lore-rule-match-test.php`, **vor** die `echo`-Zeile. Der Test baut die Regeltabellen in sqlite auf (`avesmapsLoreRuleEnsureTables`) und prüft die Auswahl:

```php
require_once __DIR__ . '/../lore-rule-store.php';

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- this half would silently pass\n");
    exit(1);
}
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
avesmapsLoreRuleEnsureTables($pdo);

// Zwei Eintraege, zwei Regeln: die Einbeere will Wald im Norden, das Bergkraut will Gebirge.
avesmapsLoreRuleSave($pdo, 'einbeere', [[
    'join_op' => 'und', 'area_public_id' => null,
    'types' => [['kind' => 'vegetation', 'region_type' => 'wald']],
    'climate_from' => 'boreal', 'climate_to' => 'gemaessigt',
]], 'verbreitung', 7);
avesmapsLoreRuleSave($pdo, 'bergkraut', [[
    'join_op' => 'und', 'area_public_id' => null,
    'types' => [['kind' => 'topographie', 'region_type' => 'gebirge']],
    'climate_from' => null, 'climate_to' => null,
]], 'verbreitung', 7);

$all = avesmapsLoreRuleReadAllActive($pdo);
assert(count($all) === 2, 'beide Eintraege, in DREI Abfragen fuer den ganzen Bestand');

// Der Farindelwald trifft die Einbeere, nicht das Bergkraut.
$hits = avesmapsLoreRuleEntriesForSubject($pdo, avesmapsLoreRuleSubjectFromArea($farindel));
assert(array_keys($hits) === ['einbeere']);
assert($hits['einbeere'] === 'verbreitung');

// Der Finsterkamm trifft das Bergkraut.
$hits = avesmapsLoreRuleEntriesForSubject($pdo, avesmapsLoreRuleSubjectFromArea($finsterkamm));
assert(array_keys($hits) === ['bergkraut']);

// 💣 Der Bergwald-ORT trifft BEIDE -- er erbt die Arten beider Flaechen. Genau das ist die
// Aussage des Modells, und genau sie faellt weg, wenn jemand die Vererbung wegoptimiert.
$hits = avesmapsLoreRuleEntriesForSubject($pdo, avesmapsLoreRuleSubjectFromPlace($bergwald, $areasById));
sort($keys = array_keys($hits));
assert($keys === ['bergkraut', 'einbeere']);

// Eine stillgelegte Regel trifft nichts mehr.
$pdo->exec("UPDATE lore_rule SET status = 'suppressed' WHERE entry_wiki_key = 'bergkraut'");
$hits = avesmapsLoreRuleEntriesForSubject($pdo, avesmapsLoreRuleSubjectFromArea($finsterkamm));
assert($hits === []);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/lore-rule-match-test.php`
Expected: FAIL — `Call to undefined function avesmapsLoreRuleReadAllActive()`

- [ ] **Step 3: Write minimal implementation**

`avesmapsLoreRuleReadAllActive` ans Ende von `api/_internal/app/lore-rule-match.php`: drei Abfragen (Regeln, Bedingungen, Arten), in PHP zusammengesetzt — **nie** eine Abfrage je Regel. Vorbild ist `avesmapsLoreRuleReadForEntry` in `lore-rule-store.php`, nur ohne den Eintragsfilter.

`avesmapsLoreRuleEntriesForSubject` wertet jede Regel über `avesmapsLoreRuleTermMatchesSubject` aus und verknüpft die Bedingungen mit `join_op` von links nach rechts — **dieselbe Reihenfolge wie im Editor**, sonst zeigt die Vorschau etwas anderes als die Infobox.

⚠️ Für **ein** Subjekt ist die Kettenauswertung einfacher als in `avesmapsLoreRuleEvaluate`: es geht um wahr/falsch, nicht um Mengen. `und` ist ein logisches Und, `oder` ein logisches Oder — links nach rechts, ohne Klammern.

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/lore-rule-match-test.php`
Expected: `lore-rule-match: OK`

- [ ] **Step 5: Prove the test bites**

Mutationen, jede muss ROT sein: den `status`-Filter weglassen · `join_op` ignorieren und immer `und` nehmen · in `ReadAllActive` den Bedingungs-Join auf die erste Regel beschränken.

- [ ] **Step 6: In den Endpunkt einhängen**

In `api/app/lore.php`, im `?place=`-Zweig, **nach** dem vorhandenen `avesmapsLoreReadForPlaces`:

- Lies `$_GET['area']` bzw. `$_GET['location']` (mit `avesmapsNormalizeSingleLine`, 36 Zeichen).
- 🔴 **Vorher den Stempel prüfen:** ist `ecosystem_assignment_stamp.completed` gleich `0`, wird **gar kein** Regelzweig ausgeführt — kein leerer Abschnitt, keine Zeile. Mit einem nackten `SELECT`, nie über `avesmapsEcosystemEnsureTables` (dessen `information_schema`-Sonden sind die Last aus §10).
- Hol das Subjekt über den passenden Leser aus Task 1, dann `avesmapsLoreRuleEntriesForSubject`, dann die Stammdaten dieser Einträge (Name, `wiki_url`, `gruppe`, `typ`, `lebensraum`, `kind`) in **einer** Abfrage über `lore_entry` mit `status = 'active'` und `kind IN (<aktive Arten>)`.
- Misch sie in dieselben `sections` wie die Ortstreffer, mit `'rank' => 1`. **Ein Eintrag, der schon über einen genannten Ort drin ist, bleibt einmal drin** — der spezifischere Rang gewinnt, genau wie die vorhandene Zusammenführung es für mehrfach hereinkommende Einträge schon macht. Sieh dir dort an, wie `$seen` und der Rangvergleich arbeiten, und häng dich daran.
- Ergänze den Kopfkommentar der Datei um die zwei neuen Parameter.

- [ ] **Step 7: Testfeld und Commit**

```bash
php -l api/app/lore.php
EXT="-d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_sqlite3.dll -d extension=php_gd.dll -d extension=php_curl.dll"
for t in $(find api tools -path '*__tests__*' -name '*test*.php'); do php -d zend.assertions=1 $EXT "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
git add api/_internal/app/lore-rule-match.php api/_internal/app/__tests__/lore-rule-match-test.php api/app/lore.php
git commit -m "feat(vorkommen): Regeltreffer reisen im Lesepfad mit"
```

**🔴 Halt nach Task 2.** Block A ist unsichtbar (der Client schickt die neuen Parameter noch nicht). Push, Remote-SHA prüfen, 2–4 Minuten OPcache abwarten, dann **eine** Probe:

```bash
curl -s "https://avesmaps.de/api/app/lore.php?place=der-grosse-fluss&area=<eine-echte-flaechen-public-id>" | head -c 400
```
Erwartet: `"ok":true` und dieselbe Antwortform wie ohne `&area=`. **Nie in einer Schleife** — AGENTS.md §10.

---

### Task 3: Die Identität reist mit

**Files:**
- Modify: `js/map-features/map-features-lore.js` (`buildLoreMarkup`, der Abruf, `avesmapsLorePlaceRefFromLocation`)
- Test: `js/map-features/__tests__/lore-place-ref.test.js` (neu)

**Interfaces:**
- Consumes: der Endpunkt aus Task 2.
- Produces: `placeRef` trägt zwei neue, **optionale** Felder — `area` (public_id einer Landschaftsfläche) und `location` (public_id einer Siedlung). Der Abruf hängt sie als `&area=` bzw. `&location=` an. Fehlen sie, verhält sich alles wie bisher.

- [ ] **Step 1: Erst nachsehen**

`buildLoreMarkup(placeRef)` in `js/map-features/map-features-lore.js:578` ist **der eine** Bauer aller vier Infobox-Oberflächen; der Abruf steht um Zeile 132 (`AVESMAPS_LORE_API_URL + "?place=" + … + "&title=" + …`). Lies beides, und beantworte im Bericht: **womit wird der Zwischenspeicher geschlüsselt?** Die Antwort entscheidet den nächsten Schritt — hängt der Schlüssel nur am `place`, liefert der Speicher für zwei Objekte mit demselben Ortsschlüssel, aber verschiedener Identität, dieselbe Antwort.

- [ ] **Step 2: Write the failing test**

`js/map-features/__tests__/lore-place-ref.test.js`:

```js
// Der Abrufschluessel des Lore-Panels. 💣 Er muss die IDENTITAET mittragen: zwei Objekte koennen
// denselben Ortsschluessel haben und trotzdem verschiedene Regeln treffen -- eine Siedlung und
// die Flaeche, in der sie liegt, sind der Normalfall davon.
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

const context = { window: {}, document: undefined, console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("js/map-features/map-features-lore.js", "utf8"), context);

const key = context.avesmapsLoreRequestKey;
assert.strictEqual(typeof key, "function", "der Schluesselbauer ist ansprechbar");

assert.notStrictEqual(
	key({ key: "finsterkamm", titles: "", area: "a2" }),
	key({ key: "finsterkamm", titles: "", location: "p1" }),
	"Flaeche und Siedlung darin duerfen sich denselben Speicherplatz NICHT teilen"
);
assert.strictEqual(
	key({ key: "finsterkamm", titles: "", area: "a2" }),
	key({ key: "finsterkamm", titles: "", area: "a2" }),
	"derselbe Bezug ergibt denselben Schluessel"
);
assert.strictEqual(
	key({ key: "finsterkamm", titles: "" }),
	key({ key: "finsterkamm", titles: "" }),
	"ohne Identitaet bleibt es beim alten Verhalten"
);

console.log("lore-place-ref: OK");
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node js/map-features/__tests__/lore-place-ref.test.js`
Expected: FAIL — `der Schluesselbauer ist ansprechbar` (die Funktion gibt es noch nicht) oder ein Speicherschlüssel, der die Identität ignoriert.

- [ ] **Step 4: Write minimal implementation**

Zieh den Schlüsselbau in eine eigene, prüfbare Funktion `avesmapsLoreRequestKey(placeRef)` und benutze sie überall dort, wo heute der Speicher geschlüsselt wird. Häng `&area=`/`&location=` an die URL, wenn die Felder da sind. `avesmapsLorePlaceRefFromLocation` bekommt `location: <public_id der Siedlung>` mit.

⚠️ **Der Zwischenspeicher ist der ganze Punkt dieses Tasks.** `buildLoreMarkup` läuft für **jedes** Label schon beim Kartenaufbau (der Dateikopf sagt es zweimal); ein Schlüssel, der die Identität verschweigt, liefert der Siedlung die Regeln ihrer Fläche. Kommentiere das an der Funktion.

- [ ] **Step 5: Run test to verify it passes**

Run: `node js/map-features/__tests__/lore-place-ref.test.js`
Expected: `lore-place-ref: OK`

- [ ] **Step 6: Prove the test bites**

Mutation: die Identität aus dem Schlüssel weglassen. Der Test muss ROT sein.

- [ ] **Step 7: Testfeld und Commit**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
git add js/map-features/map-features-lore.js js/map-features/__tests__/lore-place-ref.test.js
git commit -m "feat(vorkommen): der Lore-Abruf traegt die Identitaet des Objekts"
```

---

### Task 4: Die vier Oberflächen

**Files:**
- Modify: `js/map-features/map-features-labels.js:374` (Landschaftsregion)
- Modify: `js/map-features/map-features-location-marker-entry.js:351` (Siedlung)
- Modify: `js/map-features/map-features-path-landscapes.js` (Weg und Routen-Etappe)
- Modify: `js/map-features/map-features-region-info-markup.js` (Herrschaftsgebiet)

**Interfaces:**
- Consumes: `placeRef.area` / `placeRef.location` aus Task 3.
- Produces: nichts für spätere Tasks.

- [ ] **Step 1: Erst nachsehen, welche Identität jede Oberfläche schon hat**

Beantworte für **jede** der vier im Bericht, mit Datei und Zeile: liegt die `public_id` der Landschaftsfläche bzw. der Siedlung dort schon vor, oder muss sie erst beschafft werden?
- **Landschaftsregion:** das Label kennt seine Fläche über `ecosystemRegionOfLabel(label)` (`region-store`) — ⚠️ diese Funktion liest **beide** Richtungen der 1:N-Beziehung; wer nur die Regionsrichtung liest, verliert das zweite und dritte Label einer Fläche.
- **Siedlung:** `location.public_id`.
- **Weg und Etappe:** beide gehen durch `avesmapsPathLandscapesLoreMarkup` und kennen ihre Landschaften bereits („Führt durch"). ⚠️ Ein Weg hat **mehrere** Flächen — der Endpunkt nimmt aber eine. Entscheide und begründe: entweder keine Regeln am Weg (dann sag es und lass `area` weg), oder eine Liste. **Bau keine Abrufwelle je Fläche.**
- **Herrschaftsgebiet:** die Flächen kommen aus `ecosystem_region_territory`, nicht aus dem Client. Dasselbe Problem, dieselbe Entscheidung.

💣 **Diese vier Antworten sind der eigentliche Inhalt des Tasks.** Wenn zwei davon eine Liste bräuchten, ist das ein Befund für mich, kein Grund, still eine Schleife zu bauen.

- [ ] **Step 2: Die eindeutigen zwei anschliessen**

Landschaftsregion und Siedlung haben genau eine Identität — häng sie an den `placeRef`. Je Datei eine Zeile.

- [ ] **Step 3: Abnahme am echten Ablauf, nicht am Maß**

Über den Vorschau-Server: eine Landschaftsfläche anklicken, deren Regel greift, und eine Siedlung darin. **Benenne einzeln**, was du gesehen hast:
1. Erscheint der Eintrag in der Infobox der Fläche?
2. Erscheint er in der Infobox der Siedlung?
3. Steht er **nach** den ausdrücklich genannten Orten (Rang 1 hinter Rang 0)?
4. Bleibt eine Fläche ohne passende Regel unverändert?

⚠️ Zum Prüfen brauchst du eine gespeicherte Regel. Die Einbeere trägt eine („Wald, boreal–gemäßigt"); wenn nicht, leg über den Editor eine an und sag im Bericht, welche.

- [ ] **Step 4: Testfeld und Commit**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
git add js/map-features/map-features-labels.js js/map-features/map-features-location-marker-entry.js
git commit -m "ui(vorkommen): Regeln erscheinen in den Infoboxen von Flaeche und Siedlung"
```

**🔴 Halt nach Task 4.** Erste sichtbare Änderung im Frontend — eine Regel taucht öffentlich auf. Einzeln live, Owner-Blick.

---

### Task 5: Regeln in der Suche

**Files:**
- Modify: `api/_internal/app/lore-search.php`
- Test: `api/_internal/app/__tests__/lore-search-test.php` (erweitern)

**Interfaces:**
- Consumes: `avesmapsLoreRuleReadAllActive` aus Task 2.
- Produces: `lore_places` je Eintrag enthält zusätzlich die über Regeln getroffenen **Flächen**, mit demselben `{title, wiki_key}`-Format wie die genannten Orte. Der Client merkt keinen Unterschied — er hat nie gewusst, woher ein Ort kam.

- [ ] **Step 1: Den Kopfkommentar lesen, bevor du etwas anfasst**

`api/_internal/app/lore-search.php` begründet ausführlich, warum diese Datei **kein DDL** auslöst und warum sie `api/_internal/app/lore.php` bewusst **nicht** einbindet: sie läuft tastendruck-getaktet, und `avesmapsLoreReadCatalog` öffnet mit einer `ALTER TABLE`-Sonde. Halte dich daran — was du hier ergänzt, muss ein Join über kleine Tabellen sein.

- [ ] **Step 2: Write the failing test**

Ans Ende von `api/_internal/app/__tests__/lore-search-test.php`, vor die `echo`-Zeile:

```php
// Regeln reisen in derselben Ortsliste mit -- der Client hat nie gewusst, woher ein Ort kommt.
$entries = avesmapsBuildLoreSearchEntries(
    [['wiki_key' => 'einbeere', 'kind' => 'flora', 'name' => 'Einbeere', 'gruppe' => '', 'typ' => '']],
    ['einbeere' => [['title' => 'Der Große Fluss', 'wiki_key' => 'der-grosse-fluss']]],
    AVESMAPS_LORE_SEARCH_KIND_LABELS,
    ['einbeere' => [['title' => 'Farindelwald', 'wiki_key' => 'farindelwald']]]
);
assert(count($entries) === 1);
assert($entries[0]['place_count'] === 2, 'genannter Ort UND Regeltreffer zaehlen beide');
$titles = array_column($entries[0]['lore_places'], 'title');
assert(in_array('Der Große Fluss', $titles, true));
assert(in_array('Farindelwald', $titles, true));
// 💣 Der genannte Ort steht VORN. Er ist die ausdrueckliche Aussage eines Redakteurs; ein
// Regeltreffer ist eine Ableitung. Dieselbe Rangfolge wie in der Infobox.
assert($titles[0] === 'Der Große Fluss');
// Und ein Eintrag ohne Regel bleibt, wie er war.
assert(in_array('Der Große Fluss', array_column(avesmapsBuildLoreSearchEntries(
    [['wiki_key' => 'einbeere', 'kind' => 'flora', 'name' => 'Einbeere', 'gruppe' => '', 'typ' => '']],
    ['einbeere' => [['title' => 'Der Große Fluss', 'wiki_key' => 'der-grosse-fluss']]],
    AVESMAPS_LORE_SEARCH_KIND_LABELS
)[0]['lore_places'], 'title'), true));
```

- [ ] **Step 3: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/lore-search-test.php`
Expected: FAIL — die Zusicherung auf `place_count === 2`

- [ ] **Step 4: Write minimal implementation**

`avesmapsBuildLoreSearchEntries` bekommt einen **vierten, optionalen** Parameter `array $rulePlacesByEntry = []` und hängt dessen Einträge **hinter** die genannten Orte. Die Funktion bleibt rein.

Daneben ein neuer Leser, der ihn füllt: für jede Fläche das Subjekt bilden und gegen alle aktiven Regeln prüfen. ⚠️ **Das ist eine Schleife über ~830 Flächen × wenige Regeln, rein im Speicher** — die Daten kommen aus zwei Abfragen. Keine Abfrage je Fläche.

🔴 **Und auch hier: bei `completed = 0` kommen gar keine Regelorte dazu.** Ein Suchtreffer, der auf eine Fläche zeigt, die gerade nicht berechnet ist, führt ins Leere.

- [ ] **Step 5: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/lore-search-test.php`
Expected: `lore-search: OK`

- [ ] **Step 6: Prove the test bites**

Mutationen: die Regelorte **vor** die genannten hängen · den vierten Parameter ignorieren. Jede muss ROT sein.

- [ ] **Step 7: Testfeld und Commit**

```bash
EXT="-d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_sqlite3.dll -d extension=php_gd.dll -d extension=php_curl.dll"
for t in $(find api tools -path '*__tests__*' -name '*test*.php'); do php -d zend.assertions=1 $EXT "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
git add api/_internal/app/lore-search.php api/_internal/app/__tests__/lore-search-test.php
git commit -m "feat(vorkommen): Regeltreffer sind ueber die Suche auffindbar"
```

---

### Task 6: Die Schnittmenge hervorheben

**Files:**
- Modify: `js/ui/spotlight-search-focus.js` (`upgradeSpotlightLoreHighlightToAreas`, `highlightSpotlightPlaces`)
- Test: `js/ui/__tests__/spotlight-lore-intersect.test.js` (neu)

**Interfaces:**
- Consumes: `fetchSpotlightLandscapeAreas(labelPublicIds)` (vorhanden, liefert `areas` mit `geometry`), die vorhandene Hervorhebung.
- Produces: `spotlightLoreIntersectGeometry(areaGeometry, bandGeometry)` — **rein**, gibt die Schnittfläche zurück oder `null`.

- [ ] **Step 1: Erst nachsehen**

Beantworte im Bericht: wie heisst die Verschneidungsfunktion, die das Haus schon benutzt, und wo? (`grep -rn "ecosystemBooleanGeometry\|polygon-clipping" js/ html/ | head`) Der Landschaften-Editor verschneidet damit bereits Flächen gegeneinander; **bau keine zweite**.
Und: woher bekommt die Hervorhebung die Geometrie des Klimabands? (`api/app/ecosystem-areas.php` liefert `kind: "klima"` mit — sieh nach, ob `fetchSpotlightLandscapeAreas` sie schon mitbringt oder ob ein zweiter, gedeckelter Abruf nötig ist.)

- [ ] **Step 2: Write the failing test**

`js/ui/__tests__/spotlight-lore-intersect.test.js`:

```js
// Die Hervorhebung eines Regeltreffers zeigt die SCHNITTMENGE, nicht die ganze Flaeche.
// Beim Finsterkamm ist das der Unterschied zwischen dem ganzen Gebirge und seinem Nordteil.
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

const context = { window: {}, console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("js/third-party/polygon-clipping.min.js", "utf8"), context);
vm.runInContext(fs.readFileSync("js/ui/spotlight-search-focus.js", "utf8"), context);

const quadrat = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
const nordhaelfte = { type: "Polygon", coordinates: [[[0, 5], [10, 5], [10, 20], [0, 20], [0, 5]]] };

const schnitt = context.spotlightLoreIntersectGeometry(quadrat, nordhaelfte);
assert.ok(schnitt, "es gibt eine Schnittflaeche");
// 💣 Der Schnitt ist KLEINER als die Flaeche -- genau das ist der Zweck. Ein Ergebnis, das so
// gross ist wie die Eingabe, heisst: es wurde gar nicht verschnitten.
const flaeche = (g) => g.coordinates.flat(1).reduce((sum, p, i, r) => {
	const q = r[(i + 1) % r.length];
	return sum + (p[0] * q[1] - q[0] * p[1]) / 2;
}, 0);
assert.ok(Math.abs(flaeche(schnitt)) < Math.abs(flaeche(quadrat)) - 1e-9, "kleiner als das Ganze");

// Kein Ueberlapp -> null, nicht ein leeres Polygon, das die Zeichnung stumm nichts malen laesst.
const weitWeg = { type: "Polygon", coordinates: [[[100, 100], [110, 100], [110, 110], [100, 110], [100, 100]]] };
assert.strictEqual(context.spotlightLoreIntersectGeometry(quadrat, weitWeg), null);

// Eine fehlende Bandgeometrie faellt auf die ganze Flaeche zurueck -- lieber zu viel
// hervorheben als gar nichts.
assert.deepStrictEqual(context.spotlightLoreIntersectGeometry(quadrat, null), quadrat);

console.log("spotlight-lore-intersect: OK");
```

⚠️ Prüf in Step 1, wie die Bibliotheksdatei wirklich heisst, und pass den `readFileSync`-Pfad an. Ist sie in dieser Form nicht in node ladbar, sag es im Bericht und prüf die reine Funktion stattdessen mit einer eingespeisten Attrappe der Verschneidung.

- [ ] **Step 3: Run test to verify it fails**

Run: `node js/ui/__tests__/spotlight-lore-intersect.test.js`
Expected: FAIL — `spotlightLoreIntersectGeometry is not a function`

- [ ] **Step 4: Write minimal implementation**

Die reine Funktion in `js/ui/spotlight-search-focus.js`, neben den vorhandenen Hervorhebungs-Helfern. Sie ruft die vorhandene Verschneidung auf, fängt deren Ausnahme bei leerem Ergebnis ab (der Landschaften-Editor kommentiert genau das: „An EMPTY intersection is the normal case, not a fault") und gibt `null` zurück.

Dann in `upgradeSpotlightLoreHighlightToAreas`: für einen Regeltreffer die Fläche gegen das Band der Regel verschneiden, bevor sie gezeichnet wird. 💣 **Die Umrandung übernimmt der vorhandene Stil** — eine zweite Farbe wäre genau die Doppelung, die AGENTS.md §12 verbietet.

⚠️ Ein Suchtreffer kann **beides** tragen: einen genannten Ort (ganze Fläche) und einen Regeltreffer (Schnittmenge). Beide werden gezeichnet; die Schnittmenge ersetzt nur die Fläche, aus der sie stammt.

- [ ] **Step 5: Run test to verify it passes**

Run: `node js/ui/__tests__/spotlight-lore-intersect.test.js`
Expected: `spotlight-lore-intersect: OK`

- [ ] **Step 6: Prove the test bites**

Mutationen, jede muss ROT sein: die ganze Fläche zurückgeben statt zu verschneiden · bei leerem Schnitt die Fläche zurückgeben statt `null`.

- [ ] **Step 7: Abnahme am echten Ablauf**

Suche nach der Einbeere und **benenne**, was du gesehen hast:
1. Erscheint sie als Treffer?
2. Führt der Klick auf die Karte?
3. Wird bei einer Fläche, deren Regel nur einen Teil trifft, wirklich nur dieser Teil hervorgehoben — oder das Ganze?
4. Liegt der hervorgehobene Teil auf der **richtigen** Seite? 💣 y wächst nach Norden; eine Nordzone gehört an den oberen Rand. Genau das ist beim Mockup einmal auf dem Kopf gelandet.

- [ ] **Step 8: Testfeld und Commit**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
git add js/ui/spotlight-search-focus.js js/ui/__tests__/spotlight-lore-intersect.test.js
git commit -m "ui(vorkommen): der Suchtreffer hebt die Schnittmenge hervor, nicht die ganze Flaeche"
```

**🔴 Halt nach Task 6.** Sichtbare Änderung in der Suche. Einzeln live, Owner-Blick.

---

## Abnahme dieser Sitzung

- [ ] Das ganze Testfeld (JS + PHP) grün, `php -l` sauber auf jeder berührten PHP-Datei.
- [ ] Die Handgriffe aus Task 4 Step 3 und Task 6 Step 7 einzeln ausgeführt und **benannt** — nicht „sieht gut aus".
- [ ] Eine Regel erscheint in der Infobox einer Fläche **und** einer Siedlung darin, **hinter** den ausdrücklich genannten Orten.
- [ ] Die Suche findet den Eintrag über die Regel, und die Hervorhebung zeigt den Teil, nicht das Ganze.
- [ ] **Der Riegel:** während eines laufenden „Zugehörigkeit rechnen" erscheint **gar kein** Regelabschnitt — nicht ein leerer. Prüf das, indem du den Stempel testweise auf `completed = 0` setzt, falls du an eine Datenbank kommst; sonst als offene Frage melden.
- [ ] Jede Zeile mit 💣 / ⚠️ / 🔴 in diesem Plan einzeln abgehakt: erfüllt, oder ausdrücklich verworfen mit Begründung.
- [ ] Vor dem Push je sichtbarem Block: `usability-konsistenz` (Entwurf gegen Diff) und `usability-design` (Designsprache, hell UND dunkel).

## Offene Punkte, die diese Sitzung mitnimmt oder benennt

- 🔧 **Weg, Etappe und Herrschaftsgebiet** — Task 4 Step 1 entscheidet, ob sie Regeln zeigen. Alle drei haben **mehrere** Flächen, der Endpunkt nimmt eine. Wird es eine Liste, muss sie in **einem** Abruf gehen.
- 🔧 **Die Klimasegmente im Regeleditor tragen keine ARIA-Zustandsmarke** (aus Sitzung 2). Wer mit Screenreader durchtabbt, hört die Zonennamen, aber nicht, welche in der Spanne liegen. Eine Zeile, aber eine Owner-Entscheidung über die Form.
- 🔧 **Der `relation`-Wähler für Waren fehlt** (Entwurf §5): eine Ware kann keine `herkunft`-Regel bekommen, der Editor schreibt fest `verbreitung`.
- ⚠️ **Die Dauer einer Regelauswertung im Lesepfad ist ungemessen.** Nach dem ersten scharfen Gebrauch **einmal** ablesen, wie lange eine Infobox mit `&area=` braucht — nie in einer Schleife.

## Was NICHT in dieser Sitzung ist

- Regeln in der **Vorkommen-Liste filtern** („nur mit Regel").
- Eine **Versionsprüfung** beim gleichzeitigen Bearbeiten derselben Regel aus zwei Sitzungen.
- Der **Rechenweg in der Infobox** — dort steht das Ergebnis, nicht die Herleitung. Der Editor ist der Ort, an dem man versteht, warum.
