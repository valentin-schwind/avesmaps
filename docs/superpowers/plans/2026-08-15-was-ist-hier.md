# „Was ist hier?" — Bauplan

> **Für agentische Arbeiter:** ERFORDERLICHE UNTER-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Die Schritte tragen
> Kästchen (`- [ ]`) zum Abhaken.

**Ziel:** Rechtsklick auf die Karte → „Was ist hier?" setzt die Markierung und lässt das
Infopanel sagen, was an dieser Stelle ist.

**Aufbau:** Zwei Runden. Runde 1 rechnet die Nachbarschaft im Browser aus dem schon
geladenen Kartenpayload und zeichnet sofort. Runde 2 holt Herrschaftskette,
Landschaften und Klimazone aus **einem** neuen Endpunkt und zeichnet nach. Natur &
Waren füllt der vorhandene Lore-Container selbst — daran wird nichts gebaut.

**Werkzeug:** PHP 8 (strict types) + PDO, Vanilla-JS ohne Build, Leaflet 1.9.4,
Node für die JS-Tests, `php -d zend.assertions=1` für die PHP-Tests.

**Entwurf:** `docs/superpowers/specs/2026-08-15-was-ist-hier-design.md`
**Mockup:** `docs/was-ist-hier-mockup.html`

---

## Globale Vorgaben

Diese gelten für **jede** Aufgabe, ohne dass sie dort wiederholt werden:

- **Oberfläche bleibt deutsch.** Neue sichtbare Zeichenketten laufen durch
  `tr("schlüssel", "Deutscher Text")` und bekommen im selben Commit eine Zeile in
  `js/app/i18n-en.js`. Maschinencodes (`error.code`) bleiben englisch.
- **Kommentare, Doku und Commit-Betreffs:** wie im Umfeld — dieses Repository
  schreibt sie deutsch.
- **Keine Farbe, kein Radius, kein Trenner hartkodiert.** Nur Token aus
  `css/base/tokens.css`. Kein Blau in der Bedienoberfläche.
- **1 Karteneinheit = 3 Meilen** (`DISTANCE_SCALING_FACTOR`, `js/config.js:20`).
- 💣 **Die Koordinate dreht sich.** `?pin=` ist `lat,lng` = `y,x`; die API will `{x, y}`.
- 💣 **Kein DDL, keine `information_schema`-Sonde** in irgendetwas, das auf dem
  Besucherpfad läuft (AGENTS §10).
- 💣 **Geteilte Arbeitskopie:** niemals `git add -A`/`.`/`-a`. Vor jedem Commit
  `git status`, und **nur die selbst angefassten Pfade** einzeln stagen.
- 💣 **Vor dem Push läuft das GANZE Testfeld**, nicht nur die eigenen Tests. Ein
  einziger roter Test lädt nichts hoch, und ein Fehlschlag vergiftet danach den
  `?v=`-Stempel:
  ```bash
  for t in $(find js tools -path '*__tests__*' -name '*.test.js' | sort); do node "$t" || echo "ROT: $t"; done
  ```
  ```bash
  for t in $(find api tools \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) | sort); do php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring "$t" >/dev/null || echo "ROT: $t"; done
  ```
- 🔴 **Sichtbare Änderungen gehen EINZELN live.** Aufgaben 1–3 sind Innenumbau und
  dürfen gebündelt werden; **Aufgabe 4 ist die erste sichtbare** und geht allein
  raus, danach schaut der Owner.
- Der Editor-Handbuch-Text wird **nicht** angefasst — nur der Commit-Betreff nennt
  die sichtbare Wirkung (AGENTS §9).

---

## Dateien

| Datei | Zuständig für | Aufgabe |
|---|---|---|
| `api/_internal/app/what-is-here.php` | **neu** — die reine Hälfte (Ordnen, Entdoppeln, Lore-Schlüssel) + die DB-Hälfte (zwei bbox-Abfragen) | 1 |
| `api/_internal/app/__tests__/what-is-here-test.php` | **neu** — Unit-Test der reinen Hälfte | 1 |
| `api/app/what-is-here.php` | **neu** — HTTP-Hülle, Umschlag, Fehlercodes | 1 |
| `js/map-features/map-features-what-is-here-nearby.js` | **neu** — „In der Nähe": Auswahlregel, Peilung, Zeilen-Markup | 2 |
| `js/map-features/__tests__/what-is-here-nearby.test.js` | **neu** — Unit-Test der Auswahlregel | 2 |
| `css/features/place-extras.css` | ändern — `.avesmaps-near*` neben ihre Geschwister | 2 |
| `css/features/infopanel.css` | ändern — `.avesmaps-near` in die Randlos-Liste | 2 |
| `js/map-features/map-features-what-is-here.js` | **neu** — Panel bauen, zwei Runden, Anker | 3 |
| `js/map-features/__tests__/what-is-here-panel.test.js` | **neu** — Zeilenordnung, Wegfall-Regel | 3 |
| `index.html` | ändern — Menüeintrag + zwei `<script>` + kein `?v=` von Hand | 2, 3, 4 |
| `js/routing/routing.js` | ändern — Verteiler: neuer Zweig, alter weg | 4 |
| `js/map-features/map-features-share-pin.js` | ändern — Klick/Ziehen/Entfernen an das Panel | 4 |
| `js/map-features/map-features-layer-state.js` | ändern — `?pin=` öffnet das Panel | 4 |
| `js/ui/popups.js` | ändern — `sharePinMenuMarkup` fällt | 4 |
| `js/app/share-link.js` | ändern — `syncShareLinkContextMenuAction` fällt | 4 |
| `js/app/bootstrap.js` | ändern — ihr Aufruf fällt | 4 |
| `js/app/i18n-en.js` | ändern — englische Zeilen | 2, 3, 4 |
| `js/map-features/__tests__/was-ist-hier-verdrahtung.test.js` | **neu** — Quelltest: Eintrag da, alter Kasten weg | 4 |

---

## Aufgabe 1: Der Endpunkt

**Dateien:**
- Neu: `api/_internal/app/what-is-here.php`
- Neu: `api/_internal/app/__tests__/what-is-here-test.php`
- Neu: `api/app/what-is-here.php`

**Schnittstellen:**
- Nutzt: `avesmapsClimateGeometryContains(mixed $geometry, float $x, float $y): bool`
  (`api/_internal/app/climate-membership.php:84`) — hole- und MultiPolygon-fest, bereits
  unit-getestet. **Kein zweiter Punkt-in-Polygon im Haus.**
- Liefert an Aufgabe 3: den JSON-Umschlag aus §3 des Entwurfs.

- [ ] **Schritt 1: Den Test schreiben, der die Ordnung der Kette prüft**

Neu `api/_internal/app/__tests__/what-is-here-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit-Test der reinen Haelfte von „Was ist hier?". Keine DB, kein HTTP.
 * Ausfuehren (aus dem Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/app/__tests__/what-is-here-test.php
 * Exit 0 = alle Zusicherungen halten.
 *
 * WARUM GENAU DAS GEPRUEFT WIRD: jeder Fehler hier ist lautlos. Eine gedrehte Kette zeigt
 * dieselben vier Namen in falscher Reihenfolge; ein doppeltes Gebiet sieht aus wie zwei Stufen;
 * und ein Lore-Schluessel zuviel („aventurien") schuettet ueber JEDEN Punkt der Karte dieselben
 * 1.167 Eintraege aus, ohne dass irgendwo ein Fehler auftaucht.
 */

require_once __DIR__ . '/../what-is-here.php';

// ---------------------------------------------------------------- DIE KETTE ---------------------
// Vier Treffer, absichtlich in wilder Reihenfolge -- so kamen sie am 15.08.2026 aus dem bbox.

$treffer = [
    ['id' => 539, 'parent_id' => 538, 'public_id' => 'p-539', 'wiki_key' => 'wiki:grafenmark-ferdok',
     'name' => 'Grafenmark Ferdok', 'short_name' => '', 'type' => 'Grafenmark', 'coat_url' => '/u/a.png'],
    ['id' => 345, 'parent_id' => 0,   'public_id' => 'p-345', 'wiki_key' => 'wiki:kaiserreich',
     'name' => 'Kaiserreich', 'short_name' => 'Mittelreich', 'type' => 'Kaiserreich', 'coat_url' => ''],
    ['id' => 491, 'parent_id' => 345, 'public_id' => 'p-491', 'wiki_key' => 'wiki:kosch',
     'name' => 'Fuerstentum Kosch', 'short_name' => '', 'type' => 'Fuerstentum', 'coat_url' => ''],
    ['id' => 538, 'parent_id' => 491, 'public_id' => 'p-538', 'wiki_key' => 'wiki:grafschaft-ferdok',
     'name' => 'Grafschaft Ferdok', 'short_name' => '', 'type' => 'Grafschaft', 'coat_url' => ''],
];

$kette = avesmapsWhatIsHereOrderTerritories($treffer);
assert(count($kette) === 4, 'vier Treffer, vier Stufen');
assert($kette[0]['name'] === 'Grafenmark Ferdok', 'BLATT zuerst -- buildSettlementHierarchyMarkup dreht selbst');
assert($kette[3]['name'] === 'Kaiserreich', 'Wurzel zuletzt');

// 💣 Dasselbe Gebiet mit ZWEI Geometriezeilen -- am 15.08.2026 auf Maraskan gemessen.
$doppelt = [$treffer[0], $treffer[0]];
assert(count(avesmapsWhatIsHereOrderTerritories($doppelt)) === 1, 'entdoppelt ueber public_id');

// Ein Wurzelgebiet allein (Fuerstkomturei Tobimora): EINE Stufe, kein Absturz.
assert(count(avesmapsWhatIsHereOrderTerritories([$treffer[1]])) === 1, 'ein unabhaengiges Gebiet');
assert(avesmapsWhatIsHereOrderTerritories([]) === [], 'kein Treffer -> leere Kette, kein Fehler');

// ---------------------------------------------------------------- DIE LORE-SCHLUESSEL -----------

$flaechen = [
    ['kind' => 'derographisch', 'region_public_id' => 'r-1', 'wiki_region_key' => 'aventurien'],
    ['kind' => 'vegetation',    'region_public_id' => 'r-2', 'wiki_region_key' => 'dunkelwald'],
    ['kind' => 'vegetation',    'region_public_id' => 'r-3', 'wiki_region_key' => null],
    ['kind' => 'klima',         'region_public_id' => 'r-4', 'wiki_region_key' => null],
];

$lore = avesmapsWhatIsHereLoreKeys($kette, $flaechen);

// 🔴 „aventurien" traegt 1.167 Lore-Eintraege. Waere es dabei, listete JEDER Punkt der Karte
// dieselben 1.167 -- was ueberall gilt, sagt ueber diese Stelle nichts.
assert(!in_array('aventurien', $lore['place'], true), 'die Derographie liefert KEINE Lore');
assert(in_array('dunkelwald', $lore['place'], true), 'die Vegetationsflaeche liefert welche');
assert(in_array('grafenmark-ferdok', $lore['place'], true), 'das Gebiet auch -- und das Praefix wiki: ist ab');
assert(!in_array('', $lore['place'], true), 'eine Flaeche ohne Wiki-Schluessel liefert keinen leeren Schluessel');

// 🔴 `area` nimmt JEDE getroffene Flaeche, auch die derographische: dort greift die
// Lebensraum-REGEL, nicht die Ortsverknuepfung -- das sind zwei verschiedene Quellen.
assert(count($lore['area']) === 4, 'alle vier Flaechen stehen in area');

echo "what-is-here: alles gruen\n";
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS scheitern**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/what-is-here-test.php
```
Erwartet: `Failed opening required '.../what-is-here.php'`.

- [ ] **Schritt 3: Die reine Hälfte schreiben**

Neu `api/_internal/app/what-is-here.php`:

```php
<?php

declare(strict_types=1);

// „Was ist hier?" -- was an einer angeklickten Kartenstelle liegt.
// Entwurf: docs/superpowers/specs/2026-08-15-was-ist-hier-design.md
//
// REINHEITSVERTRAG (wie climate-membership.php): auf `include` passiert nichts, kein DDL, keine
// Globals. Die Geometrie-Haelfte ist rein und unit-getestet; die DB-Haelfte nimmt ein PDO
// ausdruecklich entgegen und faellt INERT aus -- eine fehlende Tabelle heisst „keine Antwort",
// nie ein 500er auf einem Besucherpfad.
//
// 🔴 KEIN EIGENER PUNKT-IN-POLYGON. avesmapsClimateGeometryContains kann Loecher und
// MultiPolygone und ist getestet; ein zweiter waere die Divergenz, vor der AGENTS §12 warnt.
require_once __DIR__ . '/climate-membership.php';

// Die drei gezeichneten Landschaftsebenen plus die abgeleitete. Reihenfolge = Zeilenfolge im Panel.
const AVESMAPS_WHAT_IS_HERE_KINDS = ['derographisch', 'topographie', 'vegetation', 'klima'];

/**
 * REIN: die Treffer eines Punktes -> die Kette BLATT -> WURZEL, entdoppelt.
 *
 * 💣 BLATT ZUERST, und das ist keine Geschmacksfrage: buildSettlementHierarchyMarkup
 * (js/ui/popups.js:863) erwartet genau diese Richtung und dreht selbst um -- dieselbe, die
 * map-features.php einer Siedlung mitgibt. Andersherum geliefert zeigt die Treppe verkehrt.
 *
 * 💣 ENTDOPPELT UEBER public_id DES GEBIETS, nicht ueber die der Geometrie: ein Gebiet kann mit
 * mehreren Geometriezeilen im bbox liegen (am 15.08.2026 auf Maraskan gemessen: zweimal dieselbe
 * Fuerstkomturei), und zwei Stufen desselben Namens sind eine Treppe, die es nicht gibt.
 *
 * ⚠️ Die Tiefe wird INNERHALB der Trefferliste bestimmt, nicht durch einen Elternlauf in die
 * Datenbank. „Liegt in" nennt damit genau die Gebiete, in denen der Punkt wirklich liegt -- ein
 * Vorfahr, dessen Flaeche den Punkt nicht deckt, taucht nicht auf. Das ist der Unterschied zur
 * Siedlung, deren Kette ein parent_id-Lauf ist; hier ist es Absicht und kostet keine Abfrage.
 *
 * @param list<array<string,mixed>> $rows
 * @return list<array<string,mixed>>
 */
function avesmapsWhatIsHereOrderTerritories(array $rows): array
{
    $byPublicId = [];
    $byId = [];
    foreach ($rows as $row) {
        $publicId = (string) ($row['public_id'] ?? '');
        if ($publicId === '' || isset($byPublicId[$publicId])) {
            continue;
        }
        $byPublicId[$publicId] = $row;
        $byId[(int) ($row['id'] ?? 0)] = $publicId;
    }

    $tiefe = [];
    foreach ($byPublicId as $publicId => $row) {
        $stufen = 0;
        $eltern = (int) ($row['parent_id'] ?? 0);
        // Deckel: eine zyklische Elternangabe darf hier nicht haengen bleiben.
        while ($eltern !== 0 && isset($byId[$eltern]) && $stufen < 32) {
            $stufen++;
            $eltern = (int) ($byPublicId[$byId[$eltern]]['parent_id'] ?? 0);
        }
        $tiefe[$publicId] = $stufen;
    }

    $kette = array_values($byPublicId);
    usort($kette, static fn(array $a, array $b): int
        => $tiefe[(string) $b['public_id']] <=> $tiefe[(string) $a['public_id']]);

    return $kette;
}

/**
 * REIN: woraus „Natur & Waren" an dieser Stelle bestehen darf.
 *
 * 🔴 DIE DEROGRAPHIE LIEFERT KEINEN `place`-SCHLUESSEL. Ihre Flaeche heisst „Aventurien", und
 * daran haengen 1.167 Lore-Eintraege (lore.php?stats=1). Ihr Schluessel hier hiesse: jeder Punkt
 * der Karte listet dieselben 1.167. Was ueberall gilt, sagt ueber diese Stelle nichts -- dieselbe
 * Begruendung, mit der die Infobox rank-3-Eintraege aus der Vorschau nimmt.
 *
 * ⚠️ In `area` steht sie trotzdem: dort greift die Lebensraum-REGEL gegen die Region, nicht die
 * Ortsverknuepfung eines Wiki-Artikels. Zwei Quellen, zwei Listen, eine Anfrage.
 *
 * @return array{place: list<string>, area: list<string>}
 */
function avesmapsWhatIsHereLoreKeys(array $territories, array $areas): array
{
    $place = [];
    foreach ($territories as $row) {
        $key = avesmapsWhatIsHereLoreKey((string) ($row['wiki_key'] ?? ''));
        if ($key !== '' && !in_array($key, $place, true)) {
            $place[] = $key;
        }
    }

    $area = [];
    foreach ($areas as $row) {
        $publicId = (string) ($row['region_public_id'] ?? '');
        if ($publicId !== '' && !in_array($publicId, $area, true)) {
            $area[] = $publicId;
        }
        if ((string) ($row['kind'] ?? '') === 'derographisch') {
            continue;
        }
        $key = avesmapsWhatIsHereLoreKey((string) ($row['wiki_region_key'] ?? ''));
        if ($key !== '' && !in_array($key, $place, true)) {
            $place[] = $key;
        }
    }

    return ['place' => $place, 'area' => $area];
}

/**
 * REIN: ein gespeicherter Schluessel -> die Form, die lore.php erwartet.
 *
 * ⚠️ Das Praefix `wiki:` muss weg (avesmapsLoreNormalizeKey im Browser tut dasselbe), und was
 * uebrig bleibt, muss dem erlaubten Zeichenvorrat entsprechen -- sonst weist lore.php es ab und
 * die Zeile bleibt still leer.
 */
function avesmapsWhatIsHereLoreKey(string $raw): string
{
    $key = strtolower(trim($raw));
    if (str_starts_with($key, 'wiki:')) {
        $key = substr($key, 5);
    }

    return preg_match('/^[a-z0-9_-]{1,190}$/', $key) === 1 ? $key : '';
}
```

- [ ] **Schritt 4: Test laufen lassen, er MUSS grün sein**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/what-is-here-test.php
```
Erwartet: `what-is-here: alles gruen`, Exit 0.

- [ ] **Schritt 5: Die DB-Hälfte anhängen**

Ans Ende von `api/_internal/app/what-is-here.php`:

```php
/**
 * Die Gebiete, in denen der Punkt liegt -- bbox-Vorfilter in SQL, echter Punkttest in PHP.
 *
 * 💣 bbox IST EIN VORFILTER, KEIN TREFFER. Am Seepunkt (640/300) lagen 9 Gebiete im bbox und 0
 * haben den Punkttest bestanden. Wer den bbox-Treffer fuer die Antwort haelt, schreibt vier
 * Herrschaften mitten ins Perlenmeer.
 *
 * 🔴 KEINE ZOOM-FILTERUNG. Der Layer-Endpunkt kappt nach min_zoom/max_zoom, weil er ZEICHNET.
 * Hier wird nicht gezeichnet: das Kaiserreich rendert nur auf Zoom 0-1, ist aber auch auf Zoom 5
 * das Reich dieses Punktes.
 *
 * ⚠️ Inert bei fehlender Tabelle: eine frische Installation hat keinen Politik-Layer, und ein
 * 500er auf dem Besucherpfad waere die falsche Antwort darauf.
 */
function avesmapsWhatIsHereReadTerritories(PDO $pdo, float $x, float $y, int $yearBf): array
{
    try {
        $statement = $pdo->prepare(
            'SELECT t.id, t.parent_id, t.public_id, t.wiki_key, t.name, t.short_name, t.type,
                    t.coat_url, g.geometry_geojson
               FROM political_territory_geometry g
               JOIN political_territory t ON t.id = g.territory_id
              WHERE g.is_active = 1
                AND g.min_x <= :x AND g.max_x >= :x
                AND g.min_y <= :y AND g.max_y >= :y
                AND (g.valid_from_bf IS NULL OR g.valid_from_bf <= :jahr)
                AND (g.valid_to_bf   IS NULL OR g.valid_to_bf   >= :jahr2)'
        );
        $statement->execute(['x' => $x, 'y' => $y, 'jahr' => $yearBf, 'jahr2' => $yearBf]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }

    $treffer = [];
    foreach ($rows as $row) {
        $geometry = json_decode((string) ($row['geometry_geojson'] ?? ''), true);
        if (!avesmapsClimateGeometryContains($geometry, $x, $y)) {
            continue;
        }
        unset($row['geometry_geojson']); // 💣 Die Geometrie verlaesst diesen Endpunkt NIE.
        $treffer[] = $row;
    }

    return avesmapsWhatIsHereOrderTerritories($treffer);
}

/**
 * Die Landschaftsflaechen, in denen der Punkt liegt -- eine Abfrage fuer alle vier Ebenen.
 *
 * ⚠️ Mehrere Treffer je Ebene sind der NORMALFALL, nicht der Sonderfall: am Landpunkt liegen
 * „Dunkelwald" und „Flusslande" uebereinander. Die Antwort ist deshalb eine Liste je Ebene.
 */
function avesmapsWhatIsHereReadAreas(PDO $pdo, float $x, float $y): array
{
    try {
        $statement = $pdo->prepare(
            'SELECT r.kind, r.public_id AS region_public_id, r.name AS region_name,
                    r.wiki_region_key, ty.label AS type_label, a.geometry_geojson
               FROM ecosystem_area a
               JOIN ecosystem_region r ON r.id = a.region_id
          LEFT JOIN ecosystem_region_type ty ON ty.type_key = r.region_type AND ty.kind = r.kind
              WHERE a.is_active = 1 AND a.is_trial = 0
                AND a.min_x <= :x AND a.max_x >= :x
                AND a.min_y <= :y AND a.max_y >= :y'
        );
        $statement->execute(['x' => $x, 'y' => $y]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }

    $treffer = [];
    foreach ($rows as $row) {
        $geometry = json_decode((string) ($row['geometry_geojson'] ?? ''), true);
        if (!avesmapsClimateGeometryContains($geometry, $x, $y)) {
            continue;
        }
        unset($row['geometry_geojson']);
        $treffer[] = $row;
    }

    return $treffer;
}
```

⚠️ **Vor dem Weiterbauen die Spaltennamen prüfen** — dieser Block ist gegen den
Bestand geschrieben, aber nicht gegen eine laufende Datenbank:

```bash
grep -n "CREATE TABLE IF NOT EXISTS ecosystem_region\b" -A 20 api/_internal/app/ecosystem.php
grep -n "CREATE TABLE IF NOT EXISTS ecosystem_region_type\b" -A 14 api/_internal/app/ecosystem.php
grep -n "CREATE TABLE IF NOT EXISTS political_territory\b" -A 24 api/_internal/political/territory.php
```
Weicht ein Name ab, gewinnt die Tabelle — nicht dieser Bauplan.

- [ ] **Schritt 6: Die HTTP-Hülle schreiben**

Neu `api/app/what-is-here.php` — Form 1:1 von `api/app/place-kinds.php` geliehen:

```php
<?php

declare(strict_types=1);

// „Was ist hier?" -- oeffentlich, nur lesend: was an einer Kartenstelle liegt.
// Entwurf: docs/superpowers/specs/2026-08-15-was-ist-hier-design.md
//
// GET /api/app/what-is-here.php?x=<float>&y=<float>[&year_bf=<int>]
//   -> { ok:true, point:{x,y}, territories:[…], landscapes:{…}, lore:{place:[…],area:[…]} }
//
// 💣 ES REIST KEINE GEOMETRIE MIT. Genau dafuer gibt es diesen Endpunkt: der vorhandene
// Politik-Layer beantwortet dieselbe Frage, aber mit 397.738 Bytes fuer EINEN Punkt (gemessen
// 15.08.2026) -- weil das Kaiserreich-Polygon die halbe Karte bedeckt und mitkommt.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/what-is-here.php';
// 💣 NUR wegen AVESMAPS_POLITICAL_DEFAULT_YEAR_BF -- die 1049 steht dort seit je und darf nicht ein
// zweites Mal aufgeschrieben werden. Der Include ist nachweislich nebenwirkungsfrei: das DDL dieser
// Datei liegt in avesmapsPoliticalEnsureTables(), die hier nie gerufen wird (geprueft 15.08.2026).
require_once __DIR__ . '/../_internal/political/territory.php';

const AVESMAPS_WHAT_IS_HERE_MAX = 1024.0;

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not query map points.');
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed here.');
    }

    if (!is_numeric($_GET['x'] ?? null) || !is_numeric($_GET['y'] ?? null)) {
        avesmapsErrorResponse(400, 'bad_request', 'Parameters "x" and "y" must be numbers.');
    }
    $x = (float) $_GET['x'];
    $y = (float) $_GET['y'];
    if ($x < 0.0 || $y < 0.0 || $x > AVESMAPS_WHAT_IS_HERE_MAX || $y > AVESMAPS_WHAT_IS_HERE_MAX) {
        avesmapsErrorResponse(400, 'point_out_of_bounds', 'The point lies outside the map.');
    }
    $yearBf = is_numeric($_GET['year_bf'] ?? null)
        ? (int) $_GET['year_bf']
        : AVESMAPS_POLITICAL_DEFAULT_YEAR_BF;

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $territories = avesmapsWhatIsHereReadTerritories($pdo, $x, $y, $yearBf);
    $areas = avesmapsWhatIsHereReadAreas($pdo, $x, $y);

    $landscapes = [];
    foreach (AVESMAPS_WHAT_IS_HERE_KINDS as $kind) {
        $landscapes[$kind] = array_values(array_filter(
            $areas,
            static fn(array $row): bool => (string) ($row['kind'] ?? '') === $kind
        ));
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'point' => ['x' => $x, 'y' => $y],
        'territories' => $territories,
        'landscapes' => $landscapes,
        'lore' => avesmapsWhatIsHereLoreKeys($territories, $areas),
    ]);
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'This map point could not be resolved.');
}
```

- [ ] **Schritt 7: Gegen die echten Daten probieren**

Vorschau starten (nie über Bash — `.claude/launch.json`-Eintrag `was-ist-hier-preview`,
Port 8691) und beide gemessenen Punkte abfragen:

```bash
curl -s "http://localhost:8691/api/app/what-is-here.php?x=491.032&y=516.016" | head -c 1200
```
Erwartet: `"ok":true`, **vier** `territories`, `Grafenmark Ferdok` **zuerst**,
`landscapes.vegetation` mit **zwei** Einträgen, `lore.place` **ohne** `aventurien`.

```bash
curl -s "http://localhost:8691/api/app/what-is-here.php?x=640&y=300" | head -c 600
```
Erwartet: `"territories":[]` — 9 Kandidaten im bbox, 0 echte Treffer.

⚠️ Ohne `api/config.local.php` antwortet der lokale Server ohne Datenbank. Dann
stattdessen live probeweise **einmal** — nie im Zyklus (STRATO, AGENTS §9).

- [ ] **Schritt 8: Serverzeit messen und in den Entwurf eintragen**

```bash
curl -s -o /dev/null -w "%{time_total}s\n" "http://localhost:8691/api/app/what-is-here.php?x=491.032&y=516.016"
```
Die Zahl in §7 des Entwurfs eintragen (dort steht sie als offene Messung).

- [ ] **Schritt 9: Committen**

```bash
git add api/_internal/app/what-is-here.php api/_internal/app/__tests__/what-is-here-test.php api/app/what-is-here.php docs/superpowers/specs/2026-08-15-was-ist-hier-design.md
git commit -m "feat(was-ist-hier): der Endpunkt -- ein Punkt, zwei bbox-Abfragen, keine Geometrie zurueck"
```

---

## Aufgabe 2: „In der Nähe"

**Dateien:**
- Neu: `js/map-features/map-features-what-is-here-nearby.js`
- Neu: `js/map-features/__tests__/what-is-here-nearby.test.js`
- Ändern: `css/features/place-extras.css`, `css/features/infopanel.css`, `index.html`, `js/app/i18n-en.js`

**Schnittstellen:**
- Liefert an Aufgabe 3: `avesmapsWhatIsHereNearby(punkt, features)` → Liste von
  `{art, name, meilen, peilung}`, sortiert; und
  `avesmapsWhatIsHereNearbyMarkup(nachbarn)` → das fertige `<details>`.

- [ ] **Schritt 1: Den Test schreiben**

Neu `js/map-features/__tests__/what-is-here-nearby.test.js`:

```js
// „In der Nähe" -- die Auswahlregel und die Peilung.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/what-is-here-nearby.test.js
//
// Jeder Fall hier ist an einem echten Punkt gemessen worden (15.08.2026) und ohne die Regel
// danebengegangen -- lautlos, mit einer Liste, die plausibel aussah und nichts beantwortete.

const assert = require("assert");
const { avesmapsWhatIsHereNearby, avesmapsWhatIsHereBearing } =
	require("../map-features-what-is-here-nearby.js");

// ---------------------------------------------------------------- DIE PEILUNG -------------------
// 💣 atan2(dx, dy), NICHT atan2(dy, dx): 0 Grad ist Norden, gezaehlt im Uhrzeigersinn -- dieselbe
// Zaehlweise wie ein Kompass und wie rotate(). Mit der gewohnten Reihenfolge zeigt jeder Pfeil an
// der Diagonale gespiegelt, und das faellt bei genau N/O/S/W NICHT auf. Deshalb steht hier
// ausdruecklich KEIN Test auf 0/90/180/270 allein.
assert.strictEqual(Math.round(avesmapsWhatIsHereBearing(0, 0, 0, 10)), 0, "y groesser = Norden");
assert.strictEqual(Math.round(avesmapsWhatIsHereBearing(0, 0, 10, 0)), 90, "x groesser = Osten");
assert.strictEqual(Math.round(avesmapsWhatIsHereBearing(0, 0, 10, 10)), 45, "Nordost, nicht Suedost");
assert.strictEqual(Math.round(avesmapsWhatIsHereBearing(0, 0, -10, 10)), 315, "Nordwest");

// ---------------------------------------------------------------- DIE AUSWAHL -------------------
const ort = (name, art, x, y) => ({ properties: { feature_type: "location", name, settlement_class_label: art },
	geometry: { type: "Point", coordinates: [x, y] } });
const weg = (name, art, x, y) => ({ properties: { feature_type: "path", display_name: name, feature_subtype: art },
	geometry: { type: "LineString", coordinates: [[x, y], [x, y + 0.01]] } });

const P = { x: 0, y: 0 };

// 💣 VIER namenlose Wege derselben Art. Ungefiltert stuenden am gemessenen Landpunkt genau so
// vier hintereinander (Pfad-5401, Pfad-5400, Weg-5248, Strasse-5219), bevor das erste Dorf kaeme.
const vielePfade = [
	weg("Pfad-1", "Pfad", 0, 0.2), weg("Pfad-2", "Pfad", 0, 0.4),
	weg("Pfad-3", "Pfad", 0, 0.6), weg("Pfad-4", "Pfad", 0, 0.8),
	ort("Dorf A", "Dorf", 0, 1.0), ort("Dorf B", "Dorf", 0, 1.2), ort("Dorf C", "Dorf", 0, 1.4),
];
const a = avesmapsWhatIsHereNearby(P, vielePfade);
assert.strictEqual(a.filter((z) => z.art === "Pfad").length, 1, "je Wegart hoechstens EINER");
assert.strictEqual(a.filter((z) => z.name).length, 3, "die drei Ortschaften tragen Namen");

// 💣 Ein Weg ohne echten Namen wird NUR mit seiner Art genannt. „Pfad-5401" ist eine laufende
// Nummer, keine Auskunft -- dieselbe Regel sortiert im Konfliktzentrum 2448 von 3721 Wegen aus.
assert.strictEqual(a.find((z) => z.art === "Pfad").name, "", "automatischer Name faellt weg");

// 💣 DIE ENTFERNUNGSSCHRANKE. Ohne sie stand auf Maraskan eine Reichsstrasse 534 Meilen weit weg
// in der Liste -- formal die naechste ihrer Art, praktisch auf einem anderen Kontinent.
const weitWeg = [
	ort("Nah", "Dorf", 0, 1), ort("Mittel", "Dorf", 0, 2), ort("Fern", "Dorf", 0, 3),
	weg("Reichsstrasse 3", "Reichsstrasse", 0, 100),
	weg("Pfad-9", "Pfad", 0, 2),
];
const b = avesmapsWhatIsHereNearby(P, weitWeg);
assert.ok(!b.some((z) => z.art === "Reichsstrasse"), "jenseits der Schranke faellt der Weg heraus");
assert.ok(b.some((z) => z.art === "Pfad"), "innerhalb bleibt er");

// ⚠️ Der Massstab ist die ORTSLISTE, nicht die Wegeliste. Eine Schranke, die mit dem mitwandert,
// was sie begrenzen soll, begrenzt nichts -- die Lehre vom Querfeldein-Ausstieg (14.08.2026).
// Hier: 3 x der weiteste Ort (3 Einheiten = 9 Meilen) x 1,5 = 13,5 Meilen. Der Pfad bei 6 bleibt.
assert.ok(b.filter((z) => z.name === "").every((z) => z.meilen <= 3 * 3 * 1.5), "Schranke haelt");

// Sortiert nach Entfernung, Wege und Orte gemischt.
const sortiert = b.map((z) => z.meilen);
assert.deepStrictEqual(sortiert.slice().sort((u, v) => u - v), sortiert, "nach Entfernung sortiert");

// Kein Nachbar ueberhaupt -> leere Liste, kein Absturz.
assert.deepStrictEqual(avesmapsWhatIsHereNearby(P, []), [], "leere Karte");

console.log("what-is-here-nearby: alles gruen");
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS scheitern**

```bash
node js/map-features/__tests__/what-is-here-nearby.test.js
```
Erwartet: `Cannot find module '../map-features-what-is-here-nearby.js'`.

- [ ] **Schritt 3: Die Berechnung schreiben**

Neu `js/map-features/map-features-what-is-here-nearby.js`:

```js
// „In der Nähe" -- was rund um eine angeklickte Kartenstelle liegt.
// Entwurf: docs/superpowers/specs/2026-08-15-was-ist-hier-design.md §5
//
// Rechnet AUSSCHLIESSLICH im Browser, aus dem schon geladenen Kartenpayload -- keine Anfrage.
// Deshalb steht diese Haelfte des Panels sofort da, waehrend der Endpunkt noch antwortet.

"use strict";

// 1 Karteneinheit = 3 Meilen. Der Wert steht in js/config.js als DISTANCE_SCALING_FACTOR und darf
// nur EINMAL im Haus stehen -- hier wird er gelesen, nicht abgeschrieben.
const WIH_MEILEN_JE_EINHEIT = typeof DISTANCE_SCALING_FACTOR !== "undefined" ? DISTANCE_SCALING_FACTOR : 3;

// Die drei Zahlen der Auswahlregel (§5 des Entwurfs), jede mit gemessenem Anlass.
const WIH_ORTE = 3;
const WIH_WEGE = 4;
const WIH_WEG_SCHRANKE = 1.5;

// 💣 Ein automatisch benannter Weg heisst `<Wegart>-<Zahl>` und traegt damit KEINE Auskunft. Er
// wird nur mit seiner Art genannt. Dieselbe Regel haelt im Konfliktzentrum 2448 von 3721 Wegen
// von der Beobachtungsliste fern.
const WIH_AUTONAME = /^[A-Za-zÄÖÜäöüß]+-\d+$/;

/**
 * Die rechtweisende Peilung von (fx,fy) nach (tx,ty), in Grad, 0 = Norden, im Uhrzeigersinn.
 *
 * 💣 atan2(dx, dy) -- die Argumente sind VERTAUSCHT gegenueber der Schulform atan2(dy, dx).
 * Nur so ist 0 Grad Norden und die Zaehlrichtung dieselbe wie bei CSS `rotate()`. Mit der
 * gewohnten Reihenfolge zeigt jeder Pfeil an der Diagonale gespiegelt, und das faellt bei genau
 * N/O/S/W nicht auf.
 * ⚠️ Es gilt nur, weil y auf dieser Karte nach NORDEN waechst (Riva y=790 im Norden, Al'Anfa
 * y=152 im Sueden). Die Kachelnamen `map_x_-y` tragen ein negatives y -- wer von dort abliest,
 * dreht jeden Pfeil auf den Kopf.
 */
function avesmapsWhatIsHereBearing(fx, fy, tx, ty) {
	const grad = Math.atan2(tx - fx, ty - fy) * 180 / Math.PI;
	return (grad + 360) % 360;
}

/** Der Abstand eines Punktes zu einer Strecke, samt Fusspunkt. */
function avesmapsWhatIsHereFootPoint(p, a, b) {
	const vx = b[0] - a[0];
	const vy = b[1] - a[1];
	const l2 = vx * vx + vy * vy;
	let t = l2 ? (((p.x - a[0]) * vx + (p.y - a[1]) * vy) / l2) : 0;
	t = Math.max(0, Math.min(1, t));
	const fx = a[0] + t * vx;
	const fy = a[1] + t * vy;
	return { d: Math.hypot(p.x - fx, p.y - fy), fx: fx, fy: fy };
}

/**
 * Die Nachbarschaft eines Punktes: die drei naechsten Ortschaften, dazu je Wegart hoechstens ein
 * Weg und hoechstens vier -- keiner weiter als das Anderthalbfache der weitesten gezeigten
 * Ortschaft. Alles zusammen nach Entfernung sortiert.
 *
 * ⚠️ DER MASSSTAB DER SCHRANKE IST DIE ORTSLISTE, NICHT DIE WEGELISTE. Eine relative Schranke
 * braucht einen Massstab, der nicht mitwandert -- das ist die teuer bezahlte Lehre vom
 * Querfeldein-Ausstiegspunkt (14.08.2026), wo drei Fassungen an einem Tag daran scheiterten.
 *
 * ⚠️ Ortschaften haben KEINE Schranke: dass die naechste Stadt 35 Meilen entfernt ist, IST die
 * Antwort (am Seepunkt gemessen).
 */
function avesmapsWhatIsHereNearby(punkt, features) {
	const orte = [];
	const wegeJeArt = new Map();

	(features || []).forEach(function (feature) {
		const p = feature && feature.properties;
		const g = feature && feature.geometry;
		if (!p || !g) {
			return;
		}
		if (p.feature_type === "location") {
			const c = g.coordinates;
			orte.push({
				art: p.settlement_class_label || p.type || "",
				name: p.name || "",
				meilen: Math.hypot(punkt.x - c[0], punkt.y - c[1]) * WIH_MEILEN_JE_EINHEIT,
				peilung: avesmapsWhatIsHereBearing(punkt.x, punkt.y, c[0], c[1]),
			});
			return;
		}
		if (p.feature_type !== "path") {
			return;
		}
		const cs = g.coordinates || [];
		let bester = null;
		for (let i = 0; i < cs.length - 1; i += 1) {
			const treffer = avesmapsWhatIsHereFootPoint(punkt, cs[i], cs[i + 1]);
			if (!bester || treffer.d < bester.d) {
				bester = treffer;
			}
		}
		if (!bester) {
			return;
		}
		const art = p.feature_subtype || p.type || "";
		const roh = p.display_name || p.name || "";
		const zeile = {
			art: art,
			name: WIH_AUTONAME.test(roh) ? "" : roh,
			meilen: bester.d * WIH_MEILEN_JE_EINHEIT,
			peilung: avesmapsWhatIsHereBearing(punkt.x, punkt.y, bester.fx, bester.fy),
		};
		const bisher = wegeJeArt.get(art);
		if (!bisher || zeile.meilen < bisher.meilen) {
			wegeJeArt.set(art, zeile);
		}
	});

	orte.sort((a, b) => a.meilen - b.meilen);
	const gezeigteOrte = orte.slice(0, WIH_ORTE);
	// Der Massstab steht FEST, bevor auch nur ein Weg geprueft wird.
	const schranke = gezeigteOrte.length
		? gezeigteOrte[gezeigteOrte.length - 1].meilen * WIH_WEG_SCHRANKE
		: Infinity;

	const gezeigteWege = [...wegeJeArt.values()]
		.filter((w) => w.meilen <= schranke)
		.sort((a, b) => a.meilen - b.meilen)
		.slice(0, WIH_WEGE);

	return [...gezeigteOrte, ...gezeigteWege].sort((a, b) => a.meilen - b.meilen);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsWhatIsHereNearby, avesmapsWhatIsHereBearing, avesmapsWhatIsHereFootPoint };
}
```

- [ ] **Schritt 4: Test laufen lassen, er MUSS grün sein**

```bash
node js/map-features/__tests__/what-is-here-nearby.test.js
```
Erwartet: `what-is-here-nearby: alles gruen`.

- [ ] **Schritt 5: Das Markup anhängen**

Vor dem `module.exports`-Block in `map-features-what-is-here-nearby.js`:

```js
const WIH_KOMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
const WIH_KOMPASS_WORT = {
	N: "Norden", NO: "Nordost", O: "Osten", SO: "Südost",
	S: "Süden", SW: "Südwest", W: "Westen", NW: "Nordwest",
};

/**
 * Das Peil-Pfeilchen. Es dreht sich um die ECHTE Peilung, nicht um eine von acht
 * Himmelsrichtungen: am gemessenen Landpunkt stehen drei Zeilen auf „W" -- bei 259,1°, 283,8°
 * und 284,2°. Das Wort wirft 25° weg, der Pfeil nicht.
 *
 * ⭐ Inline-SVG mit `fill: currentColor`, KEIN Unicode-Pfeil: ein Zeichen saehe auf jedem Geraet
 * anders aus und reiste durch die i18n-Tabelle mit -- dieselbe Begruendung, mit der die
 * Markierungs-Kacheln Bilder aus img/menu/ tragen statt Emoji.
 *
 * 🔴 Die Nadel zeigt UNBEHANDELT nach Norden. Ein Pfeil mit Ruhelage nach rechts braeuchte
 * `rotate(peilung - 90deg)` -- eine zweite Zahl im Kopf, die irgendwann jemand vergisst.
 *
 * ⚠️ Das WORT bleibt, nur unsichtbar: aria-label liest ein Screenreader vor, title zeigt es an.
 */
function avesmapsWhatIsHereDirMarkup(peilung) {
	const kurz = WIH_KOMPASS[Math.round(peilung / 45) % 8];
	const wort = WIH_KOMPASS_WORT[kurz];
	const grad = peilung.toFixed(1).replace(".", ",");
	return '<span class="avesmaps-near__dir" style="--avesmaps-dir: ' + peilung.toFixed(1) + 'deg"'
		+ ' role="img" aria-label="' + wort + '" title="' + wort + " (" + grad + '°)">'
		+ '<svg viewBox="-7 -7 14 14" aria-hidden="true" focusable="false">'
		+ '<path d="M0,-6 L3.8,5.2 L0,2.8 L-3.8,5.2 Z"/></svg></span>';
}

/**
 * Der Abschnitt „In der Nähe" -- eigener Klappabschnitt wie Kartensammlung und Literatur, Inhalt
 * aber in DERSELBEN Tabellenform wie die Feldliste darueber (Owner 15.08.2026).
 *
 * ⭐ Der Name ist ein `.avesmaps-traffic-link`: der vorhandene Knopf, der wie ein Link aussieht
 * und auf der Karte hinspringt. Er steht heute schon in der Zeile „Verkehrswege" -- zwei Vokabeln
 * fuer dieselbe Geste waeren genau die Divergenz, vor der AGENTS §12 warnt.
 */
function avesmapsWhatIsHereNearbyMarkup(nachbarn) {
	if (!nachbarn || !nachbarn.length) {
		return "";
	}
	const esc = typeof escapeHtml === "function" ? escapeHtml : (s) => String(s);
	const zeilen = nachbarn.map(function (n) {
		const zahl = n.meilen.toFixed(1).replace(".", ",");
		const name = n.name
			? '<button type="button" class="avesmaps-traffic-link" data-what-is-here-name="'
				+ esc(n.name) + '">' + esc(n.name) + "</button> · "
			: "";
		return '<div class="region-info-box__row"><dt>' + esc(n.art) + "</dt><dd>"
			+ name + zahl + "&nbsp;Meilen" + avesmapsWhatIsHereDirMarkup(n.peilung)
			+ "</dd></div>";
	}).join("");

	const titel = typeof tr === "function" ? tr("whatIsHere.nearby", "In der Nähe") : "In der Nähe";
	return '<details class="avesmaps-near infobox-section" open>'
		+ '<summary class="avesmaps-near__head infobox-section__head">' + esc(titel)
		+ ' <span class="avesmaps-near__count infobox-section__count">(' + nachbarn.length + ")</span></summary>"
		+ '<dl class="avesmaps-near__list region-info-box__data">' + zeilen + "</dl></details>";
}
```

`module.exports` um `avesmapsWhatIsHereNearbyMarkup` und `avesmapsWhatIsHereDirMarkup` erweitern.

- [ ] **Schritt 6: Das Stylesheet — an DIE Stelle, wo die Geschwister stehen**

In `css/features/place-extras.css`, die vorhandene Regel in Zeile 7–8 erweitern und
darunter ergänzen:

```css
.avesmaps-citymaps,
.avesmaps-adv,
.avesmaps-near {
	margin-top: 12px;
	padding-top: 11px;
	border-top: 1px solid var(--color-divider);
}

.avesmaps-citymaps__head,
.avesmaps-adv__head,
.avesmaps-near__head {
	font-size: var(--font-size-subhead);
	font-weight: 700;
	color: var(--color-text-strong);
}

/* ---- „In der Nähe" ---- */
.avesmaps-near__count {
	font-weight: 400;
	font-size: 12px;
	color: var(--color-text-muted);
}
.avesmaps-near__list {
	margin-top: 9px;
}
/* Die Typangabe in Klammern -- „Der große Fluss (Tal)". Eigene Klasse statt eines nackten
   <span> mit Inline-Farbe: §12 verbietet die hartkodierte Farbe, und den Ton gibt es als Token. */
.avesmaps-wih__type {
	color: var(--color-text-muted);
}
/* Das Peil-Pfeilchen. transform-origin ist die Mitte des 11px-Kastens, und die viewBox liegt um
   0,0 -- deshalb dreht die Nadel um sich selbst und nicht um eine Ecke. */
.avesmaps-near__dir {
	display: inline-block;
	width: 11px;
	height: 11px;
	vertical-align: -1px;
	margin-left: 3px;
	color: var(--color-text-muted);
	transform: rotate(var(--avesmaps-dir, 0deg));
}
.avesmaps-near__dir svg {
	display: block;
	width: 100%;
	height: 100%;
	fill: currentColor;
}
```

💣 **Nicht als eigenen Block darunter schreiben.** Die ersten beiden Regeln sind
*bestehende* Selektorlisten; ein zweiter Block mit denselben Werten ist genau die
Divergenz, die §12 meint — er altert getrennt.

In `css/features/infopanel.css` die Randlos-Liste (Zeile 585–596) um eine Zeile
erweitern: `.avesmaps-infopanel .avesmaps-near,` neben `.avesmaps-adv`.

- [ ] **Schritt 7: Einbinden und die englische Zeile setzen**

`index.html`, direkt **nach** `js/map-features/map-features-lore.js` (Zeile 3240):

```html
		<script src="js/map-features/map-features-what-is-here-nearby.js"></script>
```

💣 **Kein `?v=` von Hand** — der Deploy stempelt und überschreibt es (AGENTS §7).

`js/app/i18n-en.js`, bei den Popup-Schlüsseln:

```js
	"whatIsHere.nearby": "Nearby",
```

- [ ] **Schritt 8: Beide Tests laufen lassen**

```bash
node js/map-features/__tests__/what-is-here-nearby.test.js
node js/app/__tests__/touch-scale.test.js
```
Der zweite steht hier absichtlich: er hat am 12.08.2026 an einer erweiterten
Selektorliste gebrochen, und genau eine solche wird in Schritt 6 angefasst.

- [ ] **Schritt 9: Committen**

```bash
git add js/map-features/map-features-what-is-here-nearby.js js/map-features/__tests__/what-is-here-nearby.test.js css/features/place-extras.css css/features/infopanel.css index.html js/app/i18n-en.js
git commit -m "feat(was-ist-hier): die Nachbarschaft -- je Wegart einer, Schranke am weitesten Ort, drehendes Pfeilchen"
```

---

## Aufgabe 3: Das Panel

**Dateien:**
- Neu: `js/map-features/map-features-what-is-here.js`
- Neu: `js/map-features/__tests__/what-is-here-panel.test.js`
- Ändern: `index.html`, `js/app/i18n-en.js`

**Schnittstellen:**
- Nutzt aus Aufgabe 2: `avesmapsWhatIsHereNearby`, `avesmapsWhatIsHereNearbyMarkup`.
- Nutzt bestehend: `avesmapsShowInfopanel(html, activeName)`,
  `buildSettlementHierarchyMarkup(hierarchy)` (erwartet **Blatt → Wurzel**),
  `infoHeaderImageMarkup(basename, title, subtitle, coat, images, suffix)`,
  `regionHeaderImageBasename(art)`, `popupActionButtonMarkup`,
  `locationPopupActionsMarkup`, `buildLoreMarkup(placeRef)`,
  `avesmapsClimateRowMarkup([{label, share}])` — ⚠️ **nicht** `avesmapsClimateRowForKey`:
  der Endpunkt liefert den Zonen-**Namen** („Gemäßigte Zone"), nicht ihren Schlüssel.
- Nutzt aus Aufgabe 2 zusätzlich die Klasse `.avesmaps-wih__type` für die Typangabe
  in Klammern.
- Liefert an Aufgabe 4: `window.avesmapsShowWhatIsHere(latlng)`.

- [ ] **Schritt 1: Den Test schreiben**

Neu `js/map-features/__tests__/what-is-here-panel.test.js`:

```js
// Das Panel von „Was ist hier?" -- die Zeilenordnung und die Wegfall-Regel.
//
// Ausfuehren: node js/map-features/__tests__/what-is-here-panel.test.js
//
// 💣 Geprueft wird der QUELLTEXT, nicht ein gerenderter Browser -- und deshalb ohne Kommentare.
// Die Prosa in diesen Dateien beschreibt genau das, wonach gesucht wird; ein Treffer im Kommentar
// ist kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen, der nichts haelt.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const ohneKommentare = (q) => q.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const quelle = ohneKommentare(fs.readFileSync(
	path.join(ROOT, "js", "map-features", "map-features-what-is-here.js"), "utf8"));

// 🔴 Waren · Fauna · Flora -- das ist AVESMAPS_LORE_ROWS (map-features-lore.js), keine eigene
// Liste. Das Panel darf die Reihenfolge nicht selbst noch einmal aufschreiben.
assert.ok(!/["']Fauna["']/.test(quelle),
	"das Panel schreibt keine Lore-Zeile selbst -- buildLoreMarkup baut alle drei");
assert.ok(/buildLoreMarkup/.test(quelle), "es benutzt den vorhandenen Lore-Container");

// 🔴 „Klimazone" steht IMMER direkt unter Flora, also NACH dem Lore-Block (Owner 2026-08-03).
assert.ok(quelle.indexOf("buildLoreMarkup") < quelle.indexOf("avesmapsClimateRowMarkup"),
	"Klimazone kommt nach den Lore-Zeilen");

// 🔴 Die Treppe wird UNVERAENDERT geliehen und erwartet Blatt -> Wurzel.
assert.ok(/buildSettlementHierarchyMarkup/.test(quelle), "die vorhandene Treppe, kein Nachbau");
assert.ok(!/location-popup__breadcrumb-row/.test(quelle),
	"das Panel baut keine eigenen Treppenstufen");

// 🔴 Eine Zeile ohne Antwort faellt weg, sie steht nie als Strich da.
assert.ok(!/>—</.test(quelle) && !/"—"/.test(quelle), "kein Gedankenstrich als Platzhalter");

// 💣 Das Kopfbild kommt aus der VORHANDENEN Tabelle, nicht aus einer zweiten hier.
assert.ok(/regionHeaderImageBasename/.test(quelle), "INFO_HEADER_IMAGE_BY_ART wird benutzt");
assert.ok(!/wald\.webp|meer\.webp|insel\.webp/.test(quelle), "keine Bildnamen von Hand");

console.log("what-is-here-panel: alles gruen");
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS scheitern**

```bash
node js/map-features/__tests__/what-is-here-panel.test.js
```
Erwartet: `ENOENT ... map-features-what-is-here.js`.

- [ ] **Schritt 3: Das Panel schreiben**

Neu `js/map-features/map-features-what-is-here.js`:

```js
// „Was ist hier?" -- das Infopanel einer angeklickten Kartenstelle.
// Entwurf: docs/superpowers/specs/2026-08-15-was-ist-hier-design.md
//
// 💣 DIE MARKIERUNG IST HIER DOCH EIN ORTSKASTEN -- und das widerspricht dem Merksatz an
// sharePinMenuMarkup NICHT. Dort steht „wer hier etwas anbaut, fragt zuerst, ob der Ortskasten es
// koennte -- und wenn ja, gehoert es dorthin." Ab jetzt KANN er es: die Stelle hat eine
// Herrschaftskette, vier Landschaftszeilen, Natur & Waren und eine Nachbarschaft. Der schwebende
// 215-px-Kasten faellt, der 400-px-Ortskasten im Panel traegt.

"use strict";

let whatIsHereToken = null;

/** Der Zustand einer angezeigten Stelle: die Koordinate plus, sobald sie da ist, die Serverantwort. */
function avesmapsWhatIsHereMarkup(latlng, antwort) {
	const esc = escapeHtml;
	const titel = tr("whatIsHere.title", "Markierte Stelle");
	const koordinate = typeof formatLocationReportCoordinates === "function"
		? formatLocationReportCoordinates(latlng)
		: `${latlng.lat.toFixed(3)}, ${latlng.lng.toFixed(3)}`;

	// ⭐ Das Kopfbild IST der Landschaftsbefund: Vegetation zuerst, sonst Topographie, sonst das
	// allgemeine Bild. Aufgeloest ueber INFO_HEADER_IMAGE_BY_ART -- keine zweite Tabelle.
	const flaechen = (antwort && antwort.landscapes) || {};
	const leitart = (flaechen.vegetation || [])[0] || (flaechen.topographie || [])[0] || null;
	const bild = leitart ? regionHeaderImageBasename(leitart.type_label || "") : "region";
	const kopf = infoHeaderImageMarkup(bild, titel, koordinate, "", [], "");

	const kacheln = locationPopupActionsMarkup([
		popupActionButtonMarkup({
			label: tr("popup.addToRoutePlain", "Reiseziel hinzufügen"),
			className: "location-popup__action-button--accent",
			iconMarkup: '<span class="location-popup__action-icon" aria-hidden="true">+</span>',
			attributes: { "data-popup-action": "travel-to-share-pin" },
		}),
		popupActionButtonMarkup({
			label: tr("popup.shareLink", "🔗 Link teilen").replace(/^\s*🔗\s*/u, ""),
			iconMarkup: '<img class="location-popup__action-img" src="img/menu/linkteilen.webp" alt="" width="36" height="36" />',
			attributes: { "data-popup-action": "share-what-is-here" },
		}),
		popupActionButtonMarkup({
			label: tr("popup.removeMarker", "Entfernen"),
			className: "location-popup__action-button--danger",
			iconMarkup: '<img class="location-popup__action-img" src="img/menu/papierkorb.webp" alt="" width="36" height="36" />',
			attributes: { "data-popup-action": "remove-share-pin" },
		}),
	]);

	// 🔴 Die Treppe UNVERAENDERT geliehen. Sie erwartet Blatt -> Wurzel und dreht selbst um --
	// genau die Richtung, die der Endpunkt liefert.
	const treppe = (antwort && antwort.territories && antwort.territories.length)
		? buildSettlementHierarchyMarkup(antwort.territories)
		: "";

	// 🔴 Eine Zeile ohne Antwort faellt WEG. Am Seepunkt bleiben genau zwei uebrig, und das ist
	// eine vollstaendige Auskunft, kein Fehler.
	const zeile = (bezeichnung, treffer) => {
		const werte = (treffer || []).map((t) => esc(t.region_name)
			+ (t.type_label ? ' <span class="avesmaps-wih__type">(' + esc(t.type_label) + ")</span>" : ""));
		return werte.length
			? '<div class="region-info-box__row"><dt>' + esc(bezeichnung) + "</dt><dd>"
				+ werte.join(" · ") + "</dd></div>"
			: "";
	};

	let zeilen = zeile(tr("whatIsHere.derographic", "Derographie"), flaechen.derographisch)
		+ zeile(tr("whatIsHere.topography", "Topographie"), flaechen.topographie)
		+ zeile(tr("whatIsHere.vegetation", "Vegetation"), flaechen.vegetation);

	// Waren · Fauna · Flora baut der vorhandene Container selbst und fuellt sich, sobald lore.php
	// geantwortet hat -- genau wie bei einer Siedlung. Hier wird nichts an der Lore gebaut.
	if (antwort && antwort.lore && typeof buildLoreMarkup === "function") {
		zeilen += buildLoreMarkup({
			key: (antwort.lore.place || []).join(","),
			area: (antwort.lore.area || []).join(","),
			name: titel,
		});
	}
	// 🔴 IMMER direkt unter Flora (Owner 2026-08-03).
	const klima = ((flaechen.klima || [])[0] || {}).region_name || "";
	if (klima && typeof avesmapsClimateRowMarkup === "function") {
		zeilen += avesmapsClimateRowMarkup([{ label: klima, share: 1 }]);
	}

	const box = zeilen
		? '<div class="region-info-box region-info-box--settlement">'
			+ '<dl class="region-info-box__data">' + zeilen + "</dl></div>"
		: "";

	const nachbarn = avesmapsWhatIsHereNearbyMarkup(
		avesmapsWhatIsHereNearby({ x: latlng.lng, y: latlng.lat }, (window.mapFeatureData || {}).features || [])
	);

	return '<div class="location-popup">' + kopf + kacheln + treppe + box + nachbarn + "</div>";
}

/**
 * Die Stelle im Panel zeigen -- zwei Runden.
 *
 * 💣 DIE KOORDINATE DREHT SICH HIER, und nur hier: Leaflet spricht [lat, lng], der Endpunkt
 * spricht {x, y}. x = lng, y = lat.
 *
 * ⚠️ Eigener Staleness-Token wie beim Gebiet (avesmapsShowRegionInInfopanel): wer zweimal
 * schnell hintereinander klickt, darf nicht die erste Antwort ueber die zweite Stelle bekommen.
 */
window.avesmapsShowWhatIsHere = function (latlng) {
	const punkt = L.latLng(latlng);
	avesmapsShowInfopanel(avesmapsWhatIsHereMarkup(punkt, null));

	const token = {};
	whatIsHereToken = token;
	fetch("/api/app/what-is-here.php?x=" + encodeURIComponent(punkt.lng)
			+ "&y=" + encodeURIComponent(punkt.lat), { credentials: "same-origin" })
		.then((r) => (r.ok ? r.json() : null))
		.then(function (daten) {
			if (!daten || daten.ok === false || whatIsHereToken !== token) {
				return; // andere Stelle inzwischen angezeigt -> veraltete Antwort verwerfen
			}
			const koerper = avesmapsShowInfopanel(avesmapsWhatIsHereMarkup(punkt, daten));
			if (koerper && typeof avesmapsLoreFillOpenContainers === "function") {
				avesmapsLoreFillOpenContainers();
			}
		})
		.catch(function () { /* still: die erste Runde steht bereits */ });
};
```

⚠️ **Zwei Namen prüfen, bevor gebaut wird** — sie stehen so im Bauplan, aber
`grep` entscheidet:

```bash
grep -n "window.mapFeatureData\|mapFeatureData =" js/map-features/map-features.js | head -3
grep -n "^function avesmapsLoreFill\|avesmapsLoreFillContainers" js/map-features/map-features-lore.js | head -3
```
Heißt der Payload-Halter anders, gewinnt der Bestand. Gibt es keine öffentliche
Nachfüll-Funktion für Lore-Container, entfällt der Aufruf — `buildLoreMarkup`
stößt den Abruf selbst an.

- [ ] **Schritt 4: Test laufen lassen, er MUSS grün sein**

```bash
node js/map-features/__tests__/what-is-here-panel.test.js
```

- [ ] **Schritt 5: Einbinden**

`index.html`, direkt **nach** `map-features-what-is-here-nearby.js`:

```html
		<script src="js/map-features/map-features-what-is-here.js"></script>
```

`js/app/i18n-en.js`:

```js
	"whatIsHere.title": "Marked spot",
	"whatIsHere.derographic": "Derography",
	"whatIsHere.topography": "Topography",
	"whatIsHere.vegetation": "Vegetation",
```

- [ ] **Schritt 6: Committen**

```bash
git add js/map-features/map-features-what-is-here.js js/map-features/__tests__/what-is-here-panel.test.js index.html js/app/i18n-en.js
git commit -m "feat(was-ist-hier): das Panel -- Ortskasten fuer eine Stelle, zwei Runden, Lore aus dem vorhandenen Container"
```

---

## Aufgabe 4: Die Verschmelzung — der sichtbare Schritt

🔴 **Diese Aufgabe geht ALLEIN live, und danach schaut der Owner.** Nicht mit
Aufgabe 5 bündeln.

**Dateien:**
- Ändern: `index.html`, `js/routing/routing.js`, `js/map-features/map-features-share-pin.js`,
  `js/map-features/map-features-layer-state.js`, `js/ui/popups.js`, `js/app/share-link.js`,
  `js/app/bootstrap.js`, `js/app/i18n-en.js`
- Neu: `js/map-features/__tests__/was-ist-hier-verdrahtung.test.js`

- [ ] **Schritt 1: Den Verdrahtungstest schreiben**

Neu `js/map-features/__tests__/was-ist-hier-verdrahtung.test.js`:

```js
// Die Verschmelzung: EINE Markierung, EIN Weg ins Panel, und der alte Kasten ist wirklich weg.
//
// Ausfuehren: node js/map-features/__tests__/was-ist-hier-verdrahtung.test.js
//
// 💣 Ohne Kommentare geprueft -- die Prosa nennt genau die Woerter, nach denen gesucht wird.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const ohneKommentare = (q) => q.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
	.replace(/<!--[\s\S]*?-->/g, "");
const lies = (...t) => ohneKommentare(fs.readFileSync(path.join(ROOT, ...t), "utf8"));

const html = lies("index.html");
const routing = lies("js", "routing", "routing.js");
const popups = lies("js", "ui", "popups.js");

// Der neue Eintrag steht im Kartenmenue, der alte nicht mehr.
assert.ok(/data-context-action="what-is-here"/.test(html), "„Was ist hier?" steht im Menue");
assert.ok(!/data-context-action="share-map-link"/.test(html), "der Routen-Link-Eintrag ist weg");
assert.ok(/data-context-action="share-pin"/.test(html), "„Stelle markieren und teilen" bleibt");

// 🔴 Der Verteiler kennt den neuen Zweig -- und den alten nicht mehr.
assert.ok(/action === "what-is-here"/.test(routing), "der Verteiler bedient ihn");
assert.ok(!/action === "share-map-link"/.test(routing), "der alte Zweig ist weg");

// 💣 Der schwebende Zwei-Kachel-Kasten der Markierung ist ERSATZLOS gefallen. Bleibt er stehen,
// gibt es zwei Orte fuer dieselben Befehle -- und der eine altert unbemerkt.
assert.ok(!/function sharePinMenuMarkup/.test(popups), "sharePinMenuMarkup ist geloescht");
assert.ok(!/sharePinMenuMarkup/.test(lies("js", "map-features", "map-features-share-pin.js")),
	"und wird nirgends mehr gebunden");

// 💣 Beim Ziehen darf NICHT setSharePin gerufen werden: das wirft den Marker weg und baut einen
// neuen -- genau den, an dem Leaflet gerade seinen Drag abschliesst (TypeError in finishDrag).
const pin = lies("js", "map-features", "map-features-share-pin.js");
const dragend = pin.slice(pin.indexOf('marker.on("dragend"'), pin.indexOf('marker.on("dragend"') + 900);
assert.ok(!/setSharePin/.test(dragend), "dragend baut den Marker nicht neu");
assert.ok(/avesmapsShowWhatIsHere/.test(dragend), "dragend rechnet die Auskunft neu");

// 🔴 „Entfernen" schliesst das Panel mit. Das Infopanel wird nie leer gezeigt.
assert.ok(/avesmapsShowInfopanel\(""\)|avesmapsShowInfopanel\('')/.test(pin),
	"clearSharePin leert das Panel");

// 🔴 Ein geteilter ?pin=-Link bringt die Auskunft mit.
assert.ok(/avesmapsShowWhatIsHere/.test(lies("js", "map-features", "map-features-layer-state.js")),
	"der Deep-Link oeffnet das Panel");

console.log("was-ist-hier-verdrahtung: alles gruen");
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS scheitern**

```bash
node js/map-features/__tests__/was-ist-hier-verdrahtung.test.js
```
Erwartet: erste Zusicherung schlägt fehl („Was ist hier?" steht im Menue).

- [ ] **Schritt 3: Der Menüeintrag**

`index.html` Zeile 331 ersetzen:

```html
			<button type="button" class="map-context-menu__item" data-context-action="what-is-here" data-i18n="ctxmenu.whatIsHere">Was ist hier?</button>
```

⚠️ Das `hidden` fällt mit weg: der alte Eintrag war nur bei aktiver Route sichtbar,
der neue ist es immer.

- [ ] **Schritt 4: Der Verteiler**

In `js/routing/routing.js` den Zweig `action === "share-map-link"` (Zeile 712–718)
ersetzen durch:

```js
	// „Was ist hier?": dieselbe Markierung wie „Stelle markieren und teilen" -- es gibt nur EINE --,
	// aber statt eines kopierten Links geht das Infopanel auf und sagt, was dort liegt.
	if (action === "what-is-here" && contextMenuLatLng) {
		closeMapContextMenu();
		if (setSharePin(contextMenuLatLng, { openPopup: false })) {
			window.avesmapsShowWhatIsHere(contextMenuLatLng);
		}
		if (typeof trackVisitorEvent === "function") {
			trackVisitorEvent("map_option", "was ist hier");
		}
		return;
	}
```

Und im Popup-Verteiler (bei `travel-to-share-pin`, Zeile ~950) ergänzen:

```js
	if (action === "share-what-is-here") {
		if (sharePinCoordinates) {
			void copySharePinLinkWithFeedback(sharePinCoordinates);
		}
		return;
	}
```

- [ ] **Schritt 5: Der Marker — Klick, Ziehen, Entfernen**

In `js/map-features/map-features-share-pin.js`:

`setSharePin` — die `.bindPopup(sharePinMenuMarkup(), …)`-Kette entfällt ersatzlos;
stattdessen nach dem `.addTo(map)`:

```js
	// 🔴 Ein Klick auf die Markierung zeigt ihre Auskunft -- dieselbe Regel wie bei jedem anderen
	// Feature der Karte. Der schwebende Zwei-Kachel-Kasten ist damit ersatzlos gefallen: seine drei
	// Befehle stehen jetzt im Aktionsband des Panels.
	sharePinMarker.on("click", function () {
		window.avesmapsShowWhatIsHere(sharePinMarker.getLatLng());
	});
```

`bindSharePinDragging` — im `dragend` das `marker.openPopup()` (beide Vorkommen)
ersetzen durch `window.avesmapsShowWhatIsHere(marker.getLatLng())`; im `dragstart`
das `marker.closePopup()` ersatzlos streichen.

💣 **Weiterhin KEIN `setSharePin` im `dragend`.** Der Grund steht unverändert im
Kommentar dort: die Funktion wirft den Marker weg und baut einen neuen — genau
den, an dem Leaflet gerade seinen Drag abschließt.

`clearSharePin` — nach dem `sharePinCoordinates = null`:

```js
	// 🔴 Die Markierung wegzunehmen und einen leeren Kasten stehen zu lassen waere genau der
	// Zustand, den es im Infopanel nicht gibt (Owner-Vorgabe: nie leer geoeffnet).
	if (typeof avesmapsShowInfopanel === "function") {
		avesmapsShowInfopanel("");
	}
```

- [ ] **Schritt 6: Der Deep-Link**

In `js/map-features/map-features-layer-state.js` (Zeile 158–163) nach `setSharePin`:

```js
		// 🔴 Ein geteilter ?pin=-Link bringt seit heute die AUSKUNFT mit, nicht nur den Punkt.
		// Das ist der eigentliche Gewinn der Verschmelzung -- und es wirkt rueckwirkend auf jeden
		// Link, der schon geteilt wurde.
		if (typeof window.avesmapsShowWhatIsHere === "function") {
			window.avesmapsShowWhatIsHere(sharePinLatLng);
		}
```

Das `openPopup: waypointNames.length === 0` in derselben Zeile entfällt (es gibt
kein Popup mehr).

- [ ] **Schritt 7: Die toten Stellen entfernen**

- `js/ui/popups.js`: `sharePinMenuMarkup()` samt Kommentarblock löschen.
- `js/app/share-link.js`: `syncShareLinkContextMenuAction()` löschen.
- `js/app/bootstrap.js` Zeile 801–803: den Aufruf löschen.
- `js/app/i18n-en.js`: `"ctxmenu.shareMapLink"` durch
  `"ctxmenu.whatIsHere": "What's here?"` ersetzen.

Prüfen, dass nichts übrig bleibt:

```bash
grep -rn "sharePinMenuMarkup\|syncShareLinkContextMenuAction\|share-map-link" js/ index.html | grep -v __tests__
```
Erwartet: **keine Ausgabe**.

- [ ] **Schritt 8: Alle drei neuen Tests + das ganze Testfeld**

```bash
node js/map-features/__tests__/was-ist-hier-verdrahtung.test.js
node js/map-features/__tests__/what-is-here-nearby.test.js
node js/map-features/__tests__/what-is-here-panel.test.js
```
Danach das vollständige Testfeld aus den globalen Vorgaben — **beide** Schleifen.

- [ ] **Schritt 9: Die Handgriffe im Browser (Abnahme = Ablauf, nicht Maß)**

Vorschau `was-ist-hier-preview` (Port 8691) starten und **ausführen**, nicht messen:

1. Rechtsklick auf freies Land → „Was ist hier?" steht da, der Routen-Link nicht mehr.
2. Klicken → Markierung **und** Panel, mit Kette, Landschaft, Klimazone.
3. Warten → die Deckel Waren/Fauna/Flora erscheinen; einen aufklappen.
4. Eine Treppenstufe anklicken → die Karte fliegt dorthin.
5. Einen Nachbarn anklicken → seine echte Infobox öffnet sich.
6. Die Markierung **ziehen** → Panel rechnet neu, keine Konsolenmeldung.
7. `+ Reiseziel` → Wegpunkt im Planer. `Entfernen` → Marker weg **und** Panel zu.
8. `?pin=300.000,640.000` (See) → keine Treppe, keine Vegetation, trotzdem lesbar.
9. Einen geteilten `?pin=`-Link in einem frischen Tab → Markierung **und** Panel.

⚠️ Was ein Emulator nicht beantworten kann — Touch-Ziehen am Telefon — wird als
offene Frage gemeldet, **nicht** als bestanden.

- [ ] **Schritt 10: Committen und EINZELN pushen**

```bash
git status
git add index.html js/routing/routing.js js/map-features/map-features-share-pin.js js/map-features/map-features-layer-state.js js/ui/popups.js js/app/share-link.js js/app/bootstrap.js js/app/i18n-en.js js/map-features/__tests__/was-ist-hier-verdrahtung.test.js
git commit -m "feat(was-ist-hier): Rechtsklick zeigt die Stelle im Infopanel -- eine Markierung statt zweier, Routen-Link-Eintrag weicht"
git push origin master
```

Danach die Remote-SHA prüfen und **warten**, bis der Owner geschaut hat.

---

## Aufgabe 5: Nacharbeit

- [ ] **Schritt 1: Die gemessene Serverzeit in den Entwurf eintragen** (§7,
      „Vor dem Live-Gang wird sie einmal gemessen").

- [ ] **Schritt 2: Die drei offenen Entscheidungen (§10) dem Owner vorlegen** —
      Kachelbeschriftung, Zähler, Deep-Link-Verhalten. Erst danach ändern.

- [ ] **Schritt 3: Prüfen, ob live wirklich alles angekommen ist.** Ein
      Deploy-Fehlschlag vergiftet den `?v=`-Stempel; nur eine Inhaltsänderung heilt das.

```js
// in der Konsole auf avesmaps.de
["js/map-features/map-features-what-is-here.js",
 "js/map-features/map-features-what-is-here-nearby.js"].forEach(async (u) => {
	const frisch = await fetch(u + "?cb=" + Date.now());
	const geladen = await fetch(u);
	console.log(u, frisch.status, geladen.status,
		(await frisch.text()).length, (await geladen.text()).length);
});
```
Erwartet: beide 200, gleiche Länge. Weichen sie ab, steht live eine alte Fassung.

- [ ] **Schritt 4: Den Entwurf auf „gebaut" setzen** und die Zeile in `AGENTS.md`
      §11 ergänzen — eine Zeile, mit den 💣-Fallen dieses Features.
