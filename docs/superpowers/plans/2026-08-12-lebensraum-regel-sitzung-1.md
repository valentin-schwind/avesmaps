# Lebensraum-Regel — Sitzung 1: Fundament und Vorschau

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Server kann eine Lebensraum-Regel speichern, lesen und ausrechnen, welche Flächen und Siedlungen sie trifft — vollständig unit-getestet, ohne dass sich an der Oberfläche irgendetwas ändert.

**Architecture:** Eine neue reine Bibliothek `api/_internal/app/lore-rule.php` beantwortet „was trifft diese Regel" aus einfachen Arrays (Zeilen rein, Ergebnis raus) und ist damit ohne Datenbank prüfbar. Daneben `lore-rule-store.php` für Schema, Lesen und Schreiben. Der Editor-Endpunkt `api/edit/map/lore.php` bekommt drei Aktionen. `location_ecosystem` (Siedlung → Fläche) reiht sich als vierte Zeilenart in den bestehenden „Zugehörigkeit rechnen"-Lauf ein.

**Tech Stack:** PHP 8 strict types, PDO/MySQL, inline `CREATE TABLE IF NOT EXISTS` (Hauskonvention), `assert()`-Tests ohne Framework.

**Entwurf:** `docs/superpowers/specs/2026-08-12-vorkommen-lebensraum-regel-design.md`
**Mockups:** `docs/vorkommen-regeleditor-mockup.html`, `docs/vorkommen-klimazonen-mockup.html`

## Zuschnitt: drei Sitzungen

| Sitzung | Inhalt | Sichtbar? |
|---|---|---|
| **1 (dieser Plan)** | Schema, reine Auswertung, Vorschau- und Schreib-Endpunkt, `location_ecosystem` | **Nein** — reiner Innenumbau |
| 2 | Der Regeleditor im Vorkommen-Fenster + „zuletzt gerechnet" | Ja (Editor) |
| 3 | Wirkung in der Infobox, Suche, Schnittmengen-Hervorhebung | Ja (Frontend) |

Sitzung 1 geht bewusst **ohne Owner-Blick** live: sie ändert nichts, was ein Besucher oder ein Editor sieht (AGENTS.md §9 gilt Sichtbarem).

## Global Constraints

- **Kollation:** jede neue Tabelle explizit `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` — wie `lore_entry`/`lore_place`. Ein Spaltenvergleich gegen die Default-Kollation wirft „Illegal mix of collations".
- **Kein DDL im heißen Lesepfad.** `CREATE TABLE IF NOT EXISTS` läuft nur in den Editor-Zweigen. Grund: AGENTS.md §10, Vorfall 17.07.2026 (PHP-Worker-Pool).
- **Reine Funktionen bekommen kein PDO.** Wer eine Datenbank braucht, steht in `lore-rule-store.php`; wer rechnet, in `lore-rule.php`.
- **Sprache:** Code-Kommentare und `error.code`-Werte englisch, Fehlertexte für Editoren deutsch (AGENTS.md §8) — wie in `api/edit/map/lore.php` schon gehandhabt.
- **Regeln sind immer `origin='manual'`.** Der Wiki-Sync kennt die Tabellen nicht und darf sie nie anfassen.
- **Tests:** `php -d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll <test>`. Ohne `zend.assertions=1` ist `assert()` ein No-Op und der Test meldet grün, ohne zu prüfen.
- **Vor jedem Push das GANZE Testfeld**, nicht nur die neuen Tests (AGENTS.md §9).

## File Structure

| Datei | Verantwortung |
|---|---|
| `api/_internal/app/lore-rule.php` (neu) | **REIN.** Klimaspanne auflösen, eine Bedingung gegen eine Fläche prüfen, eine Kette auswerten. Kein PDO, kein DDL, keine Globals. |
| `api/_internal/app/lore-rule-store.php` (neu) | Schema, Lesen und Schreiben von `lore_rule` / `lore_rule_term` / `lore_rule_term_type`. Nimmt PDO explizit. |
| `api/_internal/app/__tests__/lore-rule-test.php` (neu) | Die reine Bibliothek, ohne Datenbank. |
| `api/_internal/app/__tests__/lore-rule-store-test.php` (neu) | Schema und Rundlauf gegen sqlite. |
| `api/edit/map/lore.php` (ändern) | Drei Aktionen: `preview_rule`, `save_rule`, `delete_rule`. |
| `api/_internal/app/path-ecosystem.php` (ändern) | `location_ecosystem` als vierte Zeilenart im Zugehörigkeits-Lauf. |
| `api/_internal/app/ecosystem.php` (ändern) | DDL für `location_ecosystem` neben den übrigen Ökosystem-Tabellen. |

---

### Task 1: Die Klimaspanne auflösen

Die Spanne steht als zwei Endpunkte in der Datenbank; die Menge dazwischen entsteht erst beim Lesen. Genau deshalb überlebt sie eine nachträglich eingeschobene Zone (Entwurf §3.2).

**Files:**
- Create: `api/_internal/app/lore-rule.php`
- Test: `api/_internal/app/__tests__/lore-rule-test.php`

**Interfaces:**
- Consumes: nichts.
- Produces: `avesmapsLoreRuleZoneKeys(array $orderedZoneKeys, ?string $from, ?string $to): array` — gibt die Schlüssel von `$from` bis `$to` einschließlich zurück, in der Reihenfolge von `$orderedZoneKeys`. Ist einer der beiden `null` oder unbekannt, ist das Ergebnis `[]` („keine Einschränkung"). Die Reihenfolge der Endpunkte ist egal.

- [ ] **Step 1: Write the failing test**

```php
<?php

declare(strict_types=1);

// Die reine Haelfte der Lebensraum-Regel. Kein PDO, keine Tabellen -- alles, was hier
// steht, ist ohne Datenbank beweisbar. Entwurf:
// docs/superpowers/specs/2026-08-12-vorkommen-lebensraum-regel-design.md

require_once __DIR__ . '/../lore-rule.php';

// Die acht Zonen in ihrer sort_order, Nord nach Sued (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED).
$zones = ['polar', 'subpolar', 'boreal', 'gemaessigt', 'subtropen_winterfeucht',
    'trockene_subtropen', 'subtropisch', 'tropisch'];

assert(avesmapsLoreRuleZoneKeys($zones, 'boreal', 'gemaessigt') === ['boreal', 'gemaessigt']);
assert(avesmapsLoreRuleZoneKeys($zones, 'gemaessigt', 'boreal') === ['boreal', 'gemaessigt']);
assert(avesmapsLoreRuleZoneKeys($zones, 'boreal', 'boreal') === ['boreal']);
assert(avesmapsLoreRuleZoneKeys($zones, null, 'boreal') === []);
assert(avesmapsLoreRuleZoneKeys($zones, 'boreal', null) === []);
assert(avesmapsLoreRuleZoneKeys($zones, 'gibtesnicht', 'boreal') === []);

// 💣 DER FALL, DER DIE ENDPUNKT-SPEICHERUNG BEGRUENDET: am 03.08.2026 wurde
// `trockene_subtropen` mit sort_order 55 nachtraeglich ZWISCHEN zwei bestehende Zonen
// eingeschoben. Eine als Menge gespeicherte Spanne haette sie still verpasst.
$mit = ['polar', 'subpolar', 'boreal', 'NEUE_ZONE', 'gemaessigt', 'subtropen_winterfeucht',
    'trockene_subtropen', 'subtropisch', 'tropisch'];
assert(avesmapsLoreRuleZoneKeys($mit, 'boreal', 'gemaessigt') === ['boreal', 'NEUE_ZONE', 'gemaessigt']);

echo "lore-rule: OK\n";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/lore-rule-test.php`
Expected: FAIL — `Failed opening required '.../lore-rule.php'`

- [ ] **Step 3: Write minimal implementation**

```php
<?php

declare(strict_types=1);

// Was trifft eine Lebensraum-Regel? Die REINE Haelfte: Zeilen rein, Ergebnis raus.
// Kein PDO, kein DDL, keine Globals -- dieselbe Reinheitszusage wie climate-membership.php,
// und aus demselben Grund: das hier laeuft spaeter auf dem heissesten Lesepfad des Hauses.
//
// Entwurf: docs/superpowers/specs/2026-08-12-vorkommen-lebensraum-regel-design.md

/**
 * PURE: die Zonen einer Spanne, aus ihren beiden ENDPUNKTEN aufgeloest.
 *
 * 🔴 Die Spanne wird als Endpunkte gespeichert, nie als Menge. Am 03.08.2026 wurde
 * `trockene_subtropen` mit sort_order 55 nachtraeglich zwischen zwei bestehende Zonen
 * eingeschoben; eine gespeicherte Menge haette die neue Zone nicht enthalten -- still,
 * ohne Fehlermeldung, in jeder betroffenen Regel. Als Endpunkte waechst die Spanne mit.
 *
 * Ein fehlender oder unbekannter Endpunkt heisst „keine Einschraenkung", nicht „keine
 * Zone": eine Regel ohne Klimateil darf nicht versehentlich alles ausschliessen.
 *
 * @param list<string> $orderedZoneKeys Zonenschluessel in sort_order, Nord nach Sued
 * @return list<string>
 */
function avesmapsLoreRuleZoneKeys(array $orderedZoneKeys, ?string $from, ?string $to): array
{
    if ($from === null || $to === null) {
        return [];
    }
    $keys = array_values($orderedZoneKeys);
    $low = array_search($from, $keys, true);
    $high = array_search($to, $keys, true);
    if ($low === false || $high === false) {
        return [];
    }
    if ($low > $high) {
        [$low, $high] = [$high, $low];
    }

    return array_slice($keys, $low, $high - $low + 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/lore-rule-test.php`
Expected: `lore-rule: OK`

- [ ] **Step 5: Commit**

```bash
git add api/_internal/app/lore-rule.php api/_internal/app/__tests__/lore-rule-test.php
git commit -m "feat(vorkommen): Klimaspanne aus ihren Endpunkten aufloesen"
```

---

### Task 2: Eine Bedingung gegen eine Fläche prüfen

**Files:**
- Modify: `api/_internal/app/lore-rule.php`
- Test: `api/_internal/app/__tests__/lore-rule-test.php`

**Interfaces:**
- Consumes: `avesmapsLoreRuleZoneKeys` aus Task 1.
- Produces: `avesmapsLoreRuleTermMatchesArea(array $term, array $area, array $orderedZoneKeys): bool`.
  `$term` = `['area_public_id' => ?string, 'types' => list<array{kind: string, region_type: string}>, 'climate_from' => ?string, 'climate_to' => ?string]`.
  `$area` = `['public_id' => string, 'kind' => string, 'region_type' => string, 'zones' => list<string>]` (`zones` = die Zonen, die die Fläche über der 5-%-Schwelle **berührt**).
  Produces außerdem: `avesmapsLoreRuleTermIsEmpty(array $term): bool`.

- [ ] **Step 1: Write the failing test**

Ans Ende von `api/_internal/app/__tests__/lore-rule-test.php`, **vor** die `echo`-Zeile:

```php
$farindel = ['public_id' => 'a1', 'kind' => 'vegetation', 'region_type' => 'wald', 'zones' => ['gemaessigt']];
$finster  = ['public_id' => 'a2', 'kind' => 'topographie', 'region_type' => 'gebirge', 'zones' => ['boreal', 'gemaessigt']];
$alkra    = ['public_id' => 'a3', 'kind' => 'vegetation', 'region_type' => 'wald', 'zones' => ['subtropen_winterfeucht']];

$term = static fn (array $overrides = []): array => array_merge(
    ['area_public_id' => null, 'types' => [], 'climate_from' => null, 'climate_to' => null],
    $overrides
);

// Leere Bedingung trifft alles -- und sagt das auch ueber sich selbst.
assert(avesmapsLoreRuleTermIsEmpty($term()) === true);
assert(avesmapsLoreRuleTermMatchesArea($term(), $farindel, $zones) === true);

// Art allein.
$wald = $term(['types' => [['kind' => 'vegetation', 'region_type' => 'wald']]]);
assert(avesmapsLoreRuleTermIsEmpty($wald) === false);
assert(avesmapsLoreRuleTermMatchesArea($wald, $farindel, $zones) === true);
assert(avesmapsLoreRuleTermMatchesArea($wald, $finster, $zones) === false);

// Mehrere Arten sind ein ODER.
$waldOderGebirge = $term(['types' => [
    ['kind' => 'vegetation', 'region_type' => 'wald'],
    ['kind' => 'topographie', 'region_type' => 'gebirge'],
]]);
assert(avesmapsLoreRuleTermMatchesArea($waldOderGebirge, $finster, $zones) === true);

// Art UND Klima. Der Alkrawald ist ein Wald, aber im falschen Band.
$nordwald = $term([
    'types' => [['kind' => 'vegetation', 'region_type' => 'wald']],
    'climate_from' => 'boreal', 'climate_to' => 'gemaessigt',
]);
assert(avesmapsLoreRuleTermMatchesArea($nordwald, $farindel, $zones) === true);
assert(avesmapsLoreRuleTermMatchesArea($nordwald, $alkra, $zones) === false);

// 💣 Eine FLAECHE genuegt, wenn sie die Zone BERUEHRT -- der Finsterkamm liegt in zwei.
$boreal = $term(['climate_from' => 'boreal', 'climate_to' => 'boreal']);
assert(avesmapsLoreRuleTermMatchesArea($boreal, $finster, $zones) === true);
assert(avesmapsLoreRuleTermMatchesArea($boreal, $farindel, $zones) === false);

// 💣 IDENTITAET IST DIE public_id, NIE DER NAME. Live tragen fuenf Namen doppelt, vier
// davon ueber Ebenen hinweg ("Noerdlicher Eisenwald" ist Gebirge UND Wald).
$genau = $term(['area_public_id' => 'a1']);
assert(avesmapsLoreRuleTermMatchesArea($genau, $farindel, $zones) === true);
assert(avesmapsLoreRuleTermMatchesArea($genau, $finster, $zones) === false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/lore-rule-test.php`
Expected: FAIL — `Call to undefined function avesmapsLoreRuleTermIsEmpty()`

- [ ] **Step 3: Write minimal implementation**

Ans Ende von `api/_internal/app/lore-rule.php`:

```php
/**
 * PURE: hat diese Bedingung ueberhaupt eine Einschraenkung?
 *
 * 💣 Eine Regel, deren Bedingungen alle leer sind, trifft ALLES. Das ist keine Regel,
 * sondern ein Versehen -- der Schreibpfad lehnt sie ab (Task 6), und zwar serverseitig,
 * nicht nur am ausgegrauten Knopf.
 */
function avesmapsLoreRuleTermIsEmpty(array $term): bool
{
    return ($term['area_public_id'] ?? null) === null
        && ($term['types'] ?? []) === []
        && ($term['climate_from'] ?? null) === null;
}

/**
 * PURE: trifft diese Bedingung diese Flaeche?
 *
 * Die drei Felder sind drei verschiedene Fragen an dasselbe Ding und daher UND-verknuepft:
 * „heisst so" (Identitaet) · „ist von dieser Art" (mehrere = ODER) · „liegt in dieser Zone".
 * Ein leeres Feld fragt nicht.
 *
 * ⚠️ `$area['zones']` sind die Zonen, die die Flaeche BERUEHRT (>= 5 % Anteil, dieselbe
 * Schwelle wie die Infobox-Zeile). Fuer eine Flaeche genuegt das Beruehren -- die Aussage
 * ist „hier waechst es", nicht „hier waechst es ueberall". Fuer eine SIEDLUNG gilt das
 * NICHT, siehe avesmapsLoreRuleEvaluate.
 *
 * @param list<string> $orderedZoneKeys
 */
function avesmapsLoreRuleTermMatchesArea(array $term, array $area, array $orderedZoneKeys): bool
{
    $wanted = $term['area_public_id'] ?? null;
    if ($wanted !== null && (string) ($area['public_id'] ?? '') !== $wanted) {
        return false;
    }

    $types = $term['types'] ?? [];
    if ($types !== []) {
        $kind = (string) ($area['kind'] ?? '');
        $regionType = (string) ($area['region_type'] ?? '');
        $hit = false;
        foreach ($types as $type) {
            if ((string) ($type['kind'] ?? '') === $kind && (string) ($type['region_type'] ?? '') === $regionType) {
                $hit = true;
                break;
            }
        }
        if (!$hit) {
            return false;
        }
    }

    $zoneKeys = avesmapsLoreRuleZoneKeys($orderedZoneKeys, $term['climate_from'] ?? null, $term['climate_to'] ?? null);
    if ($zoneKeys !== [] && array_intersect($zoneKeys, (array) ($area['zones'] ?? [])) === []) {
        return false;
    }

    return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/lore-rule-test.php`
Expected: `lore-rule: OK`

- [ ] **Step 5: Commit**

```bash
git add api/_internal/app/lore-rule.php api/_internal/app/__tests__/lore-rule-test.php
git commit -m "feat(vorkommen): eine Regelbedingung gegen eine Flaeche pruefen"
```

---

### Task 3: Die Kette auswerten

Der Kern des Entwurfs: UND wirkt auf der **Ergebnismenge**, nicht auf der einzelnen Fläche (§3.1). Und eine Siedlung ist ein Punkt — sie zählt nur, wenn sie **selbst** in der Zone liegt (§3.3).

**Files:**
- Modify: `api/_internal/app/lore-rule.php`
- Test: `api/_internal/app/__tests__/lore-rule-test.php`

**Interfaces:**
- Consumes: `avesmapsLoreRuleTermMatchesArea`, `avesmapsLoreRuleZoneKeys`.
- Produces: `avesmapsLoreRuleEvaluate(array $terms, array $areas, array $places, array $orderedZoneKeys): array` → `['areas' => list<string>, 'places' => list<string>]` (jeweils public_ids, in der Reihenfolge der Eingabe).
  `$terms` = Liste von Bedingungen, jede zusätzlich mit `'join_op' => 'und'|'oder'` (bei Index 0 bedeutungslos).
  `$places` = `['public_id' => string, 'area_public_ids' => list<string>, 'zone' => string]`.

- [ ] **Step 1: Write the failing test**

Ans Ende von `api/_internal/app/__tests__/lore-rule-test.php`, **vor** die `echo`-Zeile:

```php
// Zwei Waelder, ein Gebirge -- und ein Ort, der in Wald UND Gebirge liegt ("Bergwald").
$areas = [$farindel, $finster, $alkra];
$places = [
    ['public_id' => 'p1', 'area_public_ids' => ['a1'], 'zone' => 'gemaessigt'],          // nur im Wald
    ['public_id' => 'p2', 'area_public_ids' => ['a1', 'a2'], 'zone' => 'gemaessigt'],    // Wald UND Gebirge
    ['public_id' => 'p3', 'area_public_ids' => ['a2'], 'zone' => 'boreal'],              // nur Gebirge, Nordteil
    ['public_id' => 'p4', 'area_public_ids' => ['a3'], 'zone' => 'subtropen_winterfeucht'],
];
$ids = static fn (array $out, string $bucket): array => $out[$bucket];

$waldTerm = $term(['types' => [['kind' => 'vegetation', 'region_type' => 'wald']],
    'climate_from' => 'boreal', 'climate_to' => 'gemaessigt', 'join_op' => 'und']);
$gebirgeTerm = $term(['types' => [['kind' => 'topographie', 'region_type' => 'gebirge']], 'join_op' => 'und']);

// EINE Bedingung.
$nur = avesmapsLoreRuleEvaluate([$waldTerm], $areas, $places, $zones);
assert($ids($nur, 'areas') === ['a1']);
assert($ids($nur, 'places') === ['p1', 'p2']);

// 💣 UND WIRKT AUF DER ERGEBNISMENGE. Keine Flaeche ist Wald UND Gebirge -- eine
// ecosystem_region hat genau ein kind und einen region_type. Ein ORT kann in beiden liegen.
$und = avesmapsLoreRuleEvaluate([$waldTerm, $gebirgeTerm], $areas, $places, $zones);
assert($ids($und, 'areas') === []);
assert($ids($und, 'places') === ['p2']);

// ODER vereinigt.
$oder = avesmapsLoreRuleEvaluate([$waldTerm, $term(['types' => [['kind' => 'topographie', 'region_type' => 'gebirge']], 'join_op' => 'oder'])], $areas, $places, $zones);
assert($ids($oder, 'areas') === ['a1', 'a2']);
assert($ids($oder, 'places') === ['p1', 'p2', 'p3']);

// 💣 EINE SIEDLUNG IST EIN PUNKT: sie zaehlt nur, wenn sie SELBST in der Zone liegt --
// auch wenn ihre Flaeche die Zone bloss beruehrt. Der Finsterkamm beruehrt boreal und
// gemaessigt; „Gebirge + boreal" nimmt davon nur p3, nicht p2.
$gebirgeBoreal = $term(['types' => [['kind' => 'topographie', 'region_type' => 'gebirge']],
    'climate_from' => 'boreal', 'climate_to' => 'boreal', 'join_op' => 'und']);
$schnitt = avesmapsLoreRuleEvaluate([$gebirgeBoreal], $areas, $places, $zones);
assert($ids($schnitt, 'areas') === ['a2']);
assert($ids($schnitt, 'places') === ['p3']);

// Von links nach rechts, ohne Klammern: (Wald UND Gebirge) ODER Alkrawald.
$alkraTerm = $term(['area_public_id' => 'a3', 'join_op' => 'oder']);
$kette = avesmapsLoreRuleEvaluate([$waldTerm, $gebirgeTerm, $alkraTerm], $areas, $places, $zones);
assert($ids($kette, 'areas') === ['a3']);
assert($ids($kette, 'places') === ['p2', 'p4']);

// Keine Bedingung -> nichts. Der Aufrufer bekommt eine leere Antwort, keine Ausnahme.
assert(avesmapsLoreRuleEvaluate([], $areas, $places, $zones) === ['areas' => [], 'places' => []]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/lore-rule-test.php`
Expected: FAIL — `Call to undefined function avesmapsLoreRuleEvaluate()`

- [ ] **Step 3: Write minimal implementation**

Ans Ende von `api/_internal/app/lore-rule.php`:

```php
/**
 * PURE: was trifft die ganze Kette?
 *
 * 🔴 UND WIRKT AUF DER ERGEBNISMENGE, NICHT AUF DER FLAECHE (Entwurf §3.1). Eine
 * ecosystem_region hat genau EIN kind und EINEN region_type -- keine Flaeche ist Wald
 * *und* Gebirge, „Wald UND Gebirge" liefert daher 0 Flaechen. Ein ORT dagegen kann in
 * beiden liegen; live sind das 22. Die 0 ist die richtige Antwort und wird nicht
 * wegdefiniert; der Editor zeigt beide Zahlen nebeneinander.
 *
 * Ausgewertet wird strikt von LINKS NACH RECHTS ohne Klammern -- dieselbe Reihenfolge wie
 * im Editor, sonst zeigt die Vorschau etwas anderes als die Infobox.
 *
 * 💣 Eine SIEDLUNG ist ein Punkt und wird gegen die Zone EINZELN geprueft, nie ueber ihre
 * Flaeche. „Teilweise in der Zone" gibt es nur bei Flaechen. Beim Finsterkamm ist das der
 * Unterschied zwischen 44 und 4.
 *
 * @param list<array<string,mixed>> $terms
 * @param list<array<string,mixed>> $areas
 * @param list<array<string,mixed>> $places
 * @param list<string> $orderedZoneKeys
 * @return array{areas: list<string>, places: list<string>}
 */
function avesmapsLoreRuleEvaluate(array $terms, array $areas, array $places, array $orderedZoneKeys): array
{
    if ($terms === []) {
        return ['areas' => [], 'places' => []];
    }

    $areaResult = null;
    $placeResult = null;

    foreach (array_values($terms) as $index => $term) {
        $termAreas = [];
        foreach ($areas as $area) {
            if (avesmapsLoreRuleTermMatchesArea($term, $area, $orderedZoneKeys)) {
                $termAreas[(string) ($area['public_id'] ?? '')] = true;
            }
        }

        $zoneKeys = avesmapsLoreRuleZoneKeys($orderedZoneKeys, $term['climate_from'] ?? null, $term['climate_to'] ?? null);
        $termPlaces = [];
        foreach ($places as $place) {
            if ($zoneKeys !== [] && !in_array((string) ($place['zone'] ?? ''), $zoneKeys, true)) {
                continue;
            }
            foreach ((array) ($place['area_public_ids'] ?? []) as $areaId) {
                if (isset($termAreas[(string) $areaId])) {
                    $termPlaces[(string) ($place['public_id'] ?? '')] = true;
                    break;
                }
            }
        }

        if ($index === 0) {
            $areaResult = $termAreas;
            $placeResult = $termPlaces;
            continue;
        }

        $join = (string) ($term['join_op'] ?? 'und');
        $areaResult = $join === 'oder' ? ($areaResult + $termAreas) : array_intersect_key($areaResult, $termAreas);
        $placeResult = $join === 'oder' ? ($placeResult + $termPlaces) : array_intersect_key($placeResult, $termPlaces);
    }

    // In der Reihenfolge der EINGABE zurueck, nicht in der des Treffens: eine Liste, die
    // je nach Bedingung anders sortiert ist, liest sich wie ein Fehler.
    $order = static function (array $rows, array $set): array {
        $out = [];
        foreach ($rows as $row) {
            $id = (string) ($row['public_id'] ?? '');
            if (isset($set[$id])) {
                $out[] = $id;
            }
        }

        return $out;
    };

    return ['areas' => $order($areas, $areaResult ?? []), 'places' => $order($places, $placeResult ?? [])];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/lore-rule-test.php`
Expected: `lore-rule: OK`

- [ ] **Step 5: Commit**

```bash
git add api/_internal/app/lore-rule.php api/_internal/app/__tests__/lore-rule-test.php
git commit -m "feat(vorkommen): die Regelkette auswerten, UND auf der Ergebnismenge"
```

---

### Task 4: Schema und Rundlauf der Regeltabellen

**Files:**
- Create: `api/_internal/app/lore-rule-store.php`
- Test: `api/_internal/app/__tests__/lore-rule-store-test.php`

**Interfaces:**
- Consumes: nichts aus Task 1–3.
- Produces:
  - `avesmapsLoreRuleEnsureTables(PDO $pdo): void`
  - `avesmapsLoreRuleSave(PDO $pdo, string $entryWikiKey, array $terms, string $relation, ?int $userId, ?int $ruleId = null): int` — legt an oder ersetzt die Bedingungen einer bestehenden Regel; gibt die `rule_id` zurück.
  - `avesmapsLoreRuleReadForEntry(PDO $pdo, string $entryWikiKey): array` — Liste von `['id' => int, 'relation' => string, 'terms' => list<array>]`, `terms` in der Form, die `avesmapsLoreRuleEvaluate` erwartet.
  - `avesmapsLoreRuleDelete(PDO $pdo, int $ruleId): bool`

- [ ] **Step 1: Write the failing test**

```php
<?php

declare(strict_types=1);

// Schema und Rundlauf der Regeltabellen -- gegen sqlite, wie die uebrigen Store-Tests.
// Die REINE Auswertung steht in lore-rule-test.php und braucht keine Datenbank.

require_once __DIR__ . '/../lore-rule-store.php';

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- this test would silently pass\n");
    exit(1);
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

avesmapsLoreRuleEnsureTables($pdo);
avesmapsLoreRuleEnsureTables($pdo); // idempotent, wie jedes self-healing DDL im Haus

$terms = [
    ['area_public_id' => null, 'join_op' => 'und',
     'types' => [['kind' => 'vegetation', 'region_type' => 'wald']],
     'climate_from' => 'boreal', 'climate_to' => 'gemaessigt'],
    ['area_public_id' => null, 'join_op' => 'und',
     'types' => [['kind' => 'topographie', 'region_type' => 'gebirge']],
     'climate_from' => null, 'climate_to' => null],
];

$ruleId = avesmapsLoreRuleSave($pdo, 'vierblattrige-einbeere', $terms, 'verbreitung', 7);
assert($ruleId > 0);

$read = avesmapsLoreRuleReadForEntry($pdo, 'vierblattrige-einbeere');
assert(count($read) === 1);
assert($read[0]['relation'] === 'verbreitung');
assert(count($read[0]['terms']) === 2);
// Die Reihenfolge der Bedingungen IST die Auswertungsreihenfolge -- sie muss die
// Datenbank ueberleben, sonst rechnet die Infobox anders als die Vorschau.
assert($read[0]['terms'][0]['climate_from'] === 'boreal');
assert($read[0]['terms'][1]['types'][0]['region_type'] === 'gebirge');
assert($read[0]['terms'][1]['climate_from'] === null);

// Speichern auf dieselbe id ERSETZT die Bedingungen, es haengt keine an.
avesmapsLoreRuleSave($pdo, 'vierblattrige-einbeere', [$terms[0]], 'verbreitung', 7, $ruleId);
$read = avesmapsLoreRuleReadForEntry($pdo, 'vierblattrige-einbeere');
assert(count($read) === 1 && count($read[0]['terms']) === 1);

// Ein anderer Eintrag sieht die Regel nicht.
assert(avesmapsLoreRuleReadForEntry($pdo, 'wirselkraut') === []);

assert(avesmapsLoreRuleDelete($pdo, $ruleId) === true);
assert(avesmapsLoreRuleReadForEntry($pdo, 'vierblattrige-einbeere') === []);
assert(avesmapsLoreRuleDelete($pdo, $ruleId) === false);

echo "lore-rule-store: OK\n";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/lore-rule-store-test.php`
Expected: FAIL — `Failed opening required '.../lore-rule-store.php'`

- [ ] **Step 3: Write minimal implementation**

Create `api/_internal/app/lore-rule-store.php`:

```php
<?php

declare(strict_types=1);

// Schema, Lesen und Schreiben der Lebensraum-Regeln. Die REINE Auswertung steht in
// lore-rule.php und bekommt bewusst kein PDO.
//
// 💣 EIGENE TABELLEN, nicht lore_place -- und das ist keine Umgehung der Warnung in
// AGENTS.md §5, sondern ihr Gegenteil: lore_place speichert eine ANTWORT (dieser Ort),
// lore_rule eine FRAGE (welche Orte). Eine Regel hat keinen place_wiki_key; ein
// synthetischer Schluessel muesste auf dem heissen Lesepfad geparst werden.
//
// 💣 Eine Regel ist IMMER origin='manual'. avesmapsLoreReconcile legt Ortszeilen per
// delete+insert neu an und fasst nur origin='wiki' an -- eine Regel mit origin='wiki'
// waere beim naechsten „Vorkommen syncen" weg. Der Sync kennt diese Tabellen nicht.

/** Selbstheilendes Schema. NUR aus Editor-Zweigen aufrufen, nie im heissen Lesepfad. */
function avesmapsLoreRuleEnsureTables(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS lore_rule (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_wiki_key VARCHAR(190) NOT NULL,
            relation       VARCHAR(20) NOT NULL DEFAULT \'verbreitung\',
            origin         VARCHAR(16) NOT NULL DEFAULT \'manual\',
            status         VARCHAR(16) NOT NULL DEFAULT \'active\',
            sort_order     INT NOT NULL DEFAULT 0,
            created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_by     BIGINT NULL
        )'
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_lore_rule_entry ON lore_rule (entry_wiki_key, status)');

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS lore_rule_term (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_id        BIGINT NOT NULL,
            seq            INT NOT NULL,
            join_op        VARCHAR(4) NOT NULL DEFAULT \'und\',
            area_public_id CHAR(36) NULL,
            climate_from   VARCHAR(60) NULL,
            climate_to     VARCHAR(60) NULL
        )'
    );
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_lore_rule_term ON lore_rule_term (rule_id, seq)');

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS lore_rule_term_type (
            term_id     BIGINT NOT NULL,
            kind        VARCHAR(20) NOT NULL,
            region_type VARCHAR(60) NOT NULL,
            PRIMARY KEY (term_id, kind, region_type)
        )'
    );
}

/**
 * Legt eine Regel an oder ERSETZT die Bedingungen einer bestehenden.
 *
 * Ersetzen, nicht anhaengen: die Reihenfolge der Bedingungen IST die Auswertungsreihenfolge,
 * und eine halb ersetzte Kette rechnet still etwas anderes als die Vorschau zeigte.
 *
 * @param list<array<string,mixed>> $terms
 */
function avesmapsLoreRuleSave(
    PDO $pdo,
    string $entryWikiKey,
    array $terms,
    string $relation,
    ?int $userId,
    ?int $ruleId = null
): int {
    if ($ruleId === null) {
        $insert = $pdo->prepare(
            'INSERT INTO lore_rule (entry_wiki_key, relation, origin, status, created_by)
             VALUES (:wk, :rel, \'manual\', \'active\', :user)'
        );
        $insert->execute(['wk' => $entryWikiKey, 'rel' => $relation, 'user' => $userId]);
        $ruleId = (int) $pdo->lastInsertId();
    } else {
        $update = $pdo->prepare('UPDATE lore_rule SET relation = :rel WHERE id = :id');
        $update->execute(['rel' => $relation, 'id' => $ruleId]);
    }

    $oldTerms = $pdo->prepare('SELECT id FROM lore_rule_term WHERE rule_id = :id');
    $oldTerms->execute(['id' => $ruleId]);
    foreach ($oldTerms->fetchAll(PDO::FETCH_COLUMN) ?: [] as $termId) {
        $pdo->prepare('DELETE FROM lore_rule_term_type WHERE term_id = :id')->execute(['id' => $termId]);
    }
    $pdo->prepare('DELETE FROM lore_rule_term WHERE rule_id = :id')->execute(['id' => $ruleId]);

    $insertTerm = $pdo->prepare(
        'INSERT INTO lore_rule_term (rule_id, seq, join_op, area_public_id, climate_from, climate_to)
         VALUES (:rule, :seq, :join, :area, :from, :to)'
    );
    $insertType = $pdo->prepare(
        'INSERT INTO lore_rule_term_type (term_id, kind, region_type) VALUES (:term, :kind, :type)'
    );
    foreach (array_values($terms) as $seq => $term) {
        $insertTerm->execute([
            'rule' => $ruleId,
            'seq' => $seq,
            'join' => ($term['join_op'] ?? 'und') === 'oder' ? 'oder' : 'und',
            'area' => $term['area_public_id'] ?? null,
            'from' => $term['climate_from'] ?? null,
            'to' => $term['climate_to'] ?? null,
        ]);
        $termId = (int) $pdo->lastInsertId();
        foreach ((array) ($term['types'] ?? []) as $type) {
            $insertType->execute([
                'term' => $termId,
                'kind' => (string) ($type['kind'] ?? ''),
                'type' => (string) ($type['region_type'] ?? ''),
            ]);
        }
    }

    return $ruleId;
}

/**
 * Alle aktiven Regeln eines Eintrags, fertig fuer avesmapsLoreRuleEvaluate.
 *
 * @return list<array{id: int, relation: string, terms: list<array<string,mixed>>}>
 */
function avesmapsLoreRuleReadForEntry(PDO $pdo, string $entryWikiKey): array
{
    $rules = $pdo->prepare(
        'SELECT id, relation FROM lore_rule
         WHERE entry_wiki_key = :wk AND status = \'active\' ORDER BY sort_order, id'
    );
    $rules->execute(['wk' => $entryWikiKey]);
    $rows = $rules->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($rows === []) {
        return [];
    }

    $termStatement = $pdo->prepare(
        'SELECT id, join_op, area_public_id, climate_from, climate_to
         FROM lore_rule_term WHERE rule_id = :id ORDER BY seq'
    );
    $typeStatement = $pdo->prepare(
        'SELECT kind, region_type FROM lore_rule_term_type WHERE term_id = :id ORDER BY kind, region_type'
    );

    $out = [];
    foreach ($rows as $row) {
        $termStatement->execute(['id' => (int) $row['id']]);
        $terms = [];
        foreach ($termStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $termRow) {
            $typeStatement->execute(['id' => (int) $termRow['id']]);
            $types = [];
            foreach ($typeStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $typeRow) {
                $types[] = ['kind' => (string) $typeRow['kind'], 'region_type' => (string) $typeRow['region_type']];
            }
            $terms[] = [
                'join_op' => (string) $termRow['join_op'],
                'area_public_id' => $termRow['area_public_id'] !== null ? (string) $termRow['area_public_id'] : null,
                'climate_from' => $termRow['climate_from'] !== null ? (string) $termRow['climate_from'] : null,
                'climate_to' => $termRow['climate_to'] !== null ? (string) $termRow['climate_to'] : null,
                'types' => $types,
            ];
        }
        $out[] = ['id' => (int) $row['id'], 'relation' => (string) $row['relation'], 'terms' => $terms];
    }

    return $out;
}

/** Loescht eine Regel samt ihrer Bedingungen. false = es gab sie nicht. */
function avesmapsLoreRuleDelete(PDO $pdo, int $ruleId): bool
{
    $terms = $pdo->prepare('SELECT id FROM lore_rule_term WHERE rule_id = :id');
    $terms->execute(['id' => $ruleId]);
    foreach ($terms->fetchAll(PDO::FETCH_COLUMN) ?: [] as $termId) {
        $pdo->prepare('DELETE FROM lore_rule_term_type WHERE term_id = :id')->execute(['id' => $termId]);
    }
    $pdo->prepare('DELETE FROM lore_rule_term WHERE rule_id = :id')->execute(['id' => $ruleId]);
    $delete = $pdo->prepare('DELETE FROM lore_rule WHERE id = :id');
    $delete->execute(['id' => $ruleId]);

    return $delete->rowCount() > 0;
}
```

⚠️ **Der sqlite-Dialekt oben ist der Testdialekt.** In Schritt „MySQL-Fassung" (unten) kommt die echte DDL dazu; sqlite kennt weder `AUTO_INCREMENT` noch `ENGINE=`, MySQL kein `CREATE INDEX IF NOT EXISTS` in allen Versionen. Vorbild ist `api/_internal/map/__tests__/collection-audit-write-test.php`, das dasselbe Problem hat.

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/lore-rule-store-test.php`
Expected: `lore-rule-store: OK`

- [ ] **Step 5: MySQL-Fassung des Schemas**

`avesmapsLoreRuleEnsureTables` bekommt eine Weiche auf den Treiber. Ersetze die Funktion durch:

```php
/** Selbstheilendes Schema. NUR aus Editor-Zweigen aufrufen, nie im heissen Lesepfad. */
function avesmapsLoreRuleEnsureTables(PDO $pdo): void
{
    // ⚠️ Zwei Dialekte, EIN Schema: die Tests laufen gegen sqlite (es gibt lokal keine
    // MySQL-Instanz, siehe AGENTS.md), scharf laeuft MySQL. sqlite kennt kein
    // AUTO_INCREMENT/ENGINE, MySQL kein "CREATE INDEX IF NOT EXISTS" vor 8.0.
    $sqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    $id = $sqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY';
    $tail = $sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    $now = $sqlite ? 'CURRENT_TIMESTAMP' : 'CURRENT_TIMESTAMP(3)';
    $stamp = $sqlite ? 'DATETIME' : 'DATETIME(3)';

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS lore_rule (
            id             ' . $id . ',
            entry_wiki_key VARCHAR(190) NOT NULL,
            relation       VARCHAR(20) NOT NULL DEFAULT \'verbreitung\',
            origin         VARCHAR(16) NOT NULL DEFAULT \'manual\',
            status         VARCHAR(16) NOT NULL DEFAULT \'active\',
            sort_order     INT NOT NULL DEFAULT 0,
            created_at     ' . $stamp . ' NOT NULL DEFAULT ' . $now . ',
            created_by     BIGINT UNSIGNED NULL'
        . ($sqlite ? '' : ', KEY idx_lore_rule_entry (entry_wiki_key, status)') . ')' . $tail
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS lore_rule_term (
            id             ' . $id . ',
            rule_id        BIGINT UNSIGNED NOT NULL,
            seq            INT NOT NULL,
            join_op        VARCHAR(4) NOT NULL DEFAULT \'und\',
            area_public_id CHAR(36) NULL,
            climate_from   VARCHAR(60) NULL,
            climate_to     VARCHAR(60) NULL,
            UNIQUE ' . ($sqlite ? '' : 'KEY uq_lore_rule_term ') . '(rule_id, seq)'
        . ($sqlite ? '' : ', KEY idx_lore_rule_term_area (area_public_id)') . ')' . $tail
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS lore_rule_term_type (
            term_id     BIGINT UNSIGNED NOT NULL,
            kind        VARCHAR(20) NOT NULL,
            region_type VARCHAR(60) NOT NULL,
            PRIMARY KEY (term_id, kind, region_type)'
        . ($sqlite ? '' : ', KEY idx_lore_rule_term_type_lookup (kind, region_type)') . ')' . $tail
    );
    if ($sqlite) {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_lore_rule_entry ON lore_rule (entry_wiki_key, status)');
    }
}
```

- [ ] **Step 6: Run test again**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/lore-rule-store-test.php`
Expected: `lore-rule-store: OK`

- [ ] **Step 7: Commit**

```bash
git add api/_internal/app/lore-rule-store.php api/_internal/app/__tests__/lore-rule-store-test.php
git commit -m "feat(vorkommen): Schema und Rundlauf der Regeltabellen"
```

---

### Task 5: Die Flächen und Siedlungen für die Auswertung laden

`avesmapsLoreRuleEvaluate` will Arrays. Diese Aufgabe füllt sie — aus **bereits gerechneten** Zeilen, nie aus Geometrie.

**Files:**
- Modify: `api/_internal/app/lore-rule-store.php`
- Test: `api/_internal/app/__tests__/lore-rule-store-test.php`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `avesmapsLoreRuleReadAreas(PDO $pdo): array` → Liste `['public_id', 'kind', 'region_type', 'name', 'zones']`.
  - `avesmapsLoreRuleReadPlaces(PDO $pdo): array` → Liste `['public_id', 'name', 'area_public_ids', 'zone']`.
  - `avesmapsLoreRuleOrderedZoneKeys(PDO $pdo): array` → die Zonenschlüssel in `sort_order`.

- [ ] **Step 1: Write the failing test**

Ans Ende von `api/_internal/app/__tests__/lore-rule-store-test.php`, **vor** die `echo`-Zeile:

```php
// Die drei Leser antworten auf einer Datenbank OHNE Oekosystem-Tabellen mit leeren Listen
// statt mit einer Ausnahme. 💣 Sie laufen spaeter auf dem oeffentlichen Lesepfad; „nie
// eingerichtet" darf dort kein 500 werden -- dieselbe Zusage wie avesmapsClimateReadBands.
assert(avesmapsLoreRuleReadAreas($pdo) === []);
assert(avesmapsLoreRuleReadPlaces($pdo) === []);
assert(avesmapsLoreRuleOrderedZoneKeys($pdo) === []);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/lore-rule-store-test.php`
Expected: FAIL — `Call to undefined function avesmapsLoreRuleReadAreas()`

- [ ] **Step 3: Write minimal implementation**

Ans Ende von `api/_internal/app/lore-rule-store.php`:

```php
/**
 * Die Zonenschluessel in ihrer sort_order, Nord nach Sued.
 *
 * 🔴 Die REIHENFOLGE ist die Aussage, nicht Kosmetik: aus ihr entsteht die Spanne zwischen
 * zwei Endpunkten. Deshalb wird sie gelesen und nie im Code wiederholt.
 *
 * @return list<string>
 */
function avesmapsLoreRuleOrderedZoneKeys(PDO $pdo): array
{
    try {
        $statement = $pdo->query(
            "SELECT type_key FROM ecosystem_region_type
              WHERE kind = 'klima' ORDER BY sort_order ASC, type_key ASC"
        );
        $rows = $statement === false ? [] : $statement->fetchAll(PDO::FETCH_COLUMN);
    } catch (Throwable) {
        return [];
    }

    return array_map('strval', $rows ?: []);
}

/**
 * Alle Landschaftsflaechen mit Art und den Klimazonen, die sie BERUEHREN.
 *
 * 🔴 Die Zonen kommen aus ecosystem_region_overlap -- dem Ergebnis von „Zugehoerigkeit
 * rechnen" --, nicht aus einer zweiten Rechnung. Zwei Antworten auf dieselbe Frage wuerden
 * beim ersten Regelwechsel auseinanderlaufen (dieselbe Begruendung wie in
 * avesmapsClimateReadRegionZones).
 *
 * ⚠️ Klimabaender selbst sind KEINE Flaechen im Sinne einer Regel und fallen heraus:
 * „alle Flaechen der Borealen Zone" darf nicht das Band selbst treffen.
 *
 * @return list<array{public_id: string, kind: string, region_type: string, name: string, zones: list<string>}>
 */
function avesmapsLoreRuleReadAreas(PDO $pdo): array
{
    try {
        $statement = $pdo->query(
            "SELECT r.public_id, r.kind, r.region_type, r.name,
                    k.region_type AS zone_key
               FROM ecosystem_region r
               LEFT JOIN ecosystem_region_overlap o ON o.region_id = r.id
               LEFT JOIN ecosystem_region k ON k.id = o.other_region_id AND k.kind = 'klima' AND k.is_active = 1
              WHERE r.is_active = 1 AND r.kind <> 'klima' AND r.region_type IS NOT NULL
              ORDER BY r.name, r.public_id"
        );
        $rows = $statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }

    $byId = [];
    foreach ($rows ?: [] as $row) {
        $publicId = (string) $row['public_id'];
        if (!isset($byId[$publicId])) {
            $byId[$publicId] = [
                'public_id' => $publicId,
                'kind' => (string) $row['kind'],
                'region_type' => (string) $row['region_type'],
                'name' => (string) ($row['name'] ?? ''),
                'zones' => [],
            ];
        }
        $zone = trim((string) ($row['zone_key'] ?? ''));
        if ($zone !== '' && !in_array($zone, $byId[$publicId]['zones'], true)) {
            $byId[$publicId]['zones'][] = $zone;
        }
    }

    return array_values($byId);
}

/**
 * Alle Siedlungen mit ihren Flaechen und ihrer EIGENEN Klimazone.
 *
 * 💣 Eine Siedlung ist ein PUNKT: `zone` ist genau eine, nicht eine Liste. Ihre Flaeche
 * kann mehrere Zonen beruehren -- die Siedlung nie. Beim Finsterkamm ist das der
 * Unterschied zwischen 44 und 4 (Entwurf §3.3).
 *
 * Kreuzungen sind keine Orte und bleiben draussen.
 *
 * @return list<array{public_id: string, name: string, area_public_ids: list<string>, zone: string}>
 */
function avesmapsLoreRuleReadPlaces(PDO $pdo): array
{
    try {
        $statement = $pdo->query(
            "SELECT f.public_id, f.name, f.climate_zone_key AS zone, r.public_id AS area_public_id
               FROM map_features f
               JOIN location_ecosystem le ON le.location_id = f.id
               JOIN ecosystem_area a ON a.id = le.area_id AND a.is_active = 1
               JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
              WHERE f.feature_type = 'location' AND f.is_crossing = 0
              ORDER BY f.name, f.public_id"
        );
        $rows = $statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }

    $byId = [];
    foreach ($rows ?: [] as $row) {
        $publicId = (string) $row['public_id'];
        if (!isset($byId[$publicId])) {
            $byId[$publicId] = [
                'public_id' => $publicId,
                'name' => (string) ($row['name'] ?? ''),
                'area_public_ids' => [],
                'zone' => (string) ($row['zone'] ?? ''),
            ];
        }
        $areaId = (string) ($row['area_public_id'] ?? '');
        if ($areaId !== '' && !in_array($areaId, $byId[$publicId]['area_public_ids'], true)) {
            $byId[$publicId]['area_public_ids'][] = $areaId;
        }
    }

    return array_values($byId);
}
```

⚠️ **Vor dem Weiterbauen prüfen** (die Spaltennamen sind aus dem Kontext abgeleitet, nicht gemessen): `f.climate_zone_key`, `f.is_crossing` und `f.feature_type` gegen das echte Schema abgleichen — `grep -n "climate" api/app/map-features.php` und `grep -n "is_crossing" api/_internal/map/*.php`. Weicht ein Name ab, hier korrigieren; die Signatur bleibt.

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/lore-rule-store-test.php`
Expected: `lore-rule-store: OK`

- [ ] **Step 5: Commit**

```bash
git add api/_internal/app/lore-rule-store.php api/_internal/app/__tests__/lore-rule-store-test.php
git commit -m "feat(vorkommen): Flaechen und Siedlungen fuer die Regelauswertung laden"
```

---

### Task 6: `location_ecosystem` im Zugehörigkeits-Lauf

Ohne diese Tabelle weiß niemand, in welchem Wald Ferdok steht. Sie reiht sich als vierte Zeilenart in den bestehenden Lauf ein — derselbe Rhythmus, dieselbe „ersetzt, ergänzt nie"-Zusage.

**Files:**
- Modify: `api/_internal/app/ecosystem.php` (DDL neben den übrigen Ökosystem-Tabellen)
- Modify: `api/_internal/app/path-ecosystem.php:155` (Begin leert die Tabelle mit), `:250` (Zeilenart `location`), Commit-Zähler
- Test: `api/_internal/app/__tests__/lore-rule-store-test.php` (der Leser aus Task 5 deckt sie mit ab)

**Interfaces:**
- Consumes: nichts.
- Produces: die Tabelle `location_ecosystem (location_id, area_id)`.

- [ ] **Step 1: Die DDL dazulegen**

In `api/_internal/app/ecosystem.php`, direkt hinter der `ecosystem_assignment_stamp`-DDL (dort endet der Block bei `PRIMARY KEY (id)) ENGINE=…`):

```php
    // Siedlung -> Flaeche, Vorbild path_ecosystem. Gefuellt vom selben Lauf
    // („Zugehoerigkeit rechnen"), gebraucht von der Lebensraum-Regel: ohne sie weiss
    // niemand, in welchem Wald eine Stadt steht.
    // ⚠️ Die Klimazone der Siedlung steht NICHT hier -- die stempelt
    // avesmapsClimateApplyToFeatures ohnehin in den Payload, und eine zweite Ablage waere
    // eine zweite Wahrheit.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS location_ecosystem (
            location_id BIGINT UNSIGNED NOT NULL,
            area_id     BIGINT UNSIGNED NOT NULL,
            PRIMARY KEY (location_id, area_id),
            KEY idx_location_ecosystem_area (area_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
```

- [ ] **Step 2: Den Lauf die Tabelle leeren lassen**

In `api/_internal/app/path-ecosystem.php`, in `avesmapsPathEcosystemBegin`, direkt nach `$pdo->exec('DELETE FROM ecosystem_region_territory');`:

```php
        $pdo->exec('DELETE FROM location_ecosystem');
```

💣 Diese Zeile ist tragend: ein Lauf **ersetzt**. Fehlt sie, steht die Hälfte von gestern neben der Hälfte von heute, und der Stempel nennt das „gerechnet".

- [ ] **Step 3: Die Zeilenart schreiben**

In `api/_internal/app/path-ecosystem.php`, im `elseif ($kind === 'overlap')`-Block **davor** einen neuen Zweig einfügen:

```php
        } elseif ($kind === 'location') {
            // Siedlung -> Flaeche. Wie bei den Wegzeilen kommen die ids aus dem Client als
            // public_id und werden hier aufgeloest; unaufloesbare Zeilen zaehlen als skipped,
            // nicht als Fehler (eine Flaeche kann waehrend des Laufs geloescht worden sein).
            $locationIds = avesmapsPathEcosystemIdMap($pdo, 'map_features', array_column($rows, 'location'), "feature_type = 'location'");
            $areaIds = avesmapsPathEcosystemIdMap($pdo, 'ecosystem_area', array_column($rows, 'area'), 'is_active = 1');
            $insert = $pdo->prepare(
                'INSERT INTO location_ecosystem (location_id, area_id) VALUES (:location, :area)
                 ON DUPLICATE KEY UPDATE location_id = VALUES(location_id)'
            );
            foreach ($rows as $row) {
                if (!isset($locationIds[$row['location']], $areaIds[$row['area']])) {
                    $skipped++;
                    continue;
                }
                $insert->execute(['location' => $locationIds[$row['location']], 'area' => $areaIds[$row['area']]]);
                $written++;
            }
```

⚠️ **Und die Normalisierung muss die neue Art kennen**, sonst fällt jede `location`-Zeile in den Territorien-Zweig am Ende und verlangt ein `region`, das es nicht gibt. In `avesmapsPathEcosystemNormalizeRows`, **direkt hinter** dem Block `if ($kind === 'overlap') { … continue; }` (er endet mit `continue;` und einer Leerzeile, danach folgt der schlusslose `$normalized[] = ['region' => …`):

```php
        if ($kind === 'location') {
            // Zwei public_ids, sonst nichts -- eine Siedlung liegt in einer Flaeche oder nicht,
            // es gibt keinen Anteil und keine Reihenfolge.
            $normalized[] = [
                'location' => $readId($row['location'] ?? null, 'location'),
                'area' => $readId($row['area'] ?? null, 'area'),
            ];
            continue;
        }
```

💣 Der Zweig braucht sein `continue;`. Ohne es fällt die Zeile durch in den Territorien-Fall darunter, und `$readId($row['region'] …)` wirft eine `InvalidArgumentException` — der ganze Lauf bricht ab, mitten in einem Zustand, in dem `avesmapsPathEcosystemBegin` die Tabellen schon geleert hat.

- [ ] **Step 4: Den Zähler im Commit ergänzen**

In `avesmapsPathEcosystemCommit`, bei den `COUNT(*)`-Zeilen:

```php
        'location' => $count('SELECT COUNT(*) FROM location_ecosystem'),
```

und die Spalte `location_rows INT UNSIGNED NOT NULL DEFAULT 0` in der `ecosystem_assignment_stamp`-DDL sowie im `UPDATE`. 💣 Der Zähler kommt aus `COUNT(*)`, nie aus dem, was der Client behauptet gesendet zu haben — sonst verspricht der Stempel mehr, als die Tabelle hält.

- [ ] **Step 5: Testen, dass nichts kaputtging**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll api/_internal/app/__tests__/ecosystem-geometry-test.php`
Expected: unverändert grün (der Test deckt die DDL-Kette mit ab)

- [ ] **Step 6: Commit**

```bash
git add api/_internal/app/ecosystem.php api/_internal/app/path-ecosystem.php
git commit -m "feat(landschaften): Siedlung-Flaeche-Zuordnung im Zugehoerigkeitslauf"
```

⚠️ **Der Client-Teil des Laufs fehlt noch** — wer die `location`-Zeilen berechnet und sendet, ist Sitzung 2 (er gehört zum Editor). Bis dahin bleibt die Tabelle leer, und `avesmapsLoreRuleReadPlaces` liefert korrekt `[]`.

---

### Task 7: Die drei Editor-Aktionen

**Files:**
- Modify: `api/edit/map/lore.php` (Kopfkommentar, `require_once`-Block, `switch ($action)`)
- Test: keine neue Testdatei — die Logik liegt in Task 1–5 und ist dort geprüft. Der Endpunkt selbst wird per Sonde geprüft (Step 5).

**Interfaces:**
- Consumes: `avesmapsLoreRuleEnsureTables`, `avesmapsLoreRuleSave`, `avesmapsLoreRuleDelete`, `avesmapsLoreRuleReadAreas`, `avesmapsLoreRuleReadPlaces`, `avesmapsLoreRuleOrderedZoneKeys`, `avesmapsLoreRuleEvaluate`, `avesmapsLoreRuleTermIsEmpty`.
- Produces: `POST { action: "preview_rule", wiki_key, terms }` → `{ ok, areas: [{public_id, name}], places: [{public_id, name}], counts: {areas, places} }`; `POST { action: "save_rule", wiki_key, terms, relation?, rule_id? }` → `{ ok, rule_id }`; `POST { action: "delete_rule", wiki_key, rule_id }` → `{ ok }`.

- [ ] **Step 1: Kopfkommentar und requires ergänzen**

In `api/edit/map/lore.php`, hinter die Zeile `// POST { action: "set_kind_enabled", ... }`:

```php
// POST { action: "preview_rule", wiki_key, terms }                -> was die Regel traefe (schreibt NICHTS)
// POST { action: "save_rule",    wiki_key, terms, relation?, rule_id? } -> anlegen oder ersetzen
// POST { action: "delete_rule",  wiki_key, rule_id }              -> Regel entfernen
```

und zu den `require_once`:

```php
// Die Lebensraum-Regel: reine Auswertung und Ablage getrennt.
require_once __DIR__ . '/../../_internal/app/lore-rule.php';
require_once __DIR__ . '/../../_internal/app/lore-rule-store.php';
```

- [ ] **Step 2: Die Bedingungen aus dem Rumpf normalisieren**

Direkt vor `switch ($action) {`:

```php
    /**
     * Bedingungen aus dem Rumpf, auf die Form gebracht, die lore-rule.php erwartet.
     *
     * 💣 Der Riegel steht HIER, serverseitig, nicht nur am ausgegrauten Knopf: eine Regel,
     * deren Bedingungen alle leer sind, traefe ALLES. Dieselbe Lehre wie beim Loeschriegel
     * der Uebernahme-Vorschau.
     */
    $readTerms = static function (array $payload): array {
        $out = [];
        foreach ((array) ($payload['terms'] ?? []) as $raw) {
            $types = [];
            foreach ((array) ($raw['types'] ?? []) as $type) {
                $kind = avesmapsNormalizeSingleLine((string) ($type['kind'] ?? ''), 20);
                $regionType = avesmapsNormalizeSingleLine((string) ($type['region_type'] ?? ''), 60);
                if ($kind !== '' && $regionType !== '') {
                    $types[] = ['kind' => $kind, 'region_type' => $regionType];
                }
            }
            $areaId = avesmapsNormalizeSingleLine((string) ($raw['area_public_id'] ?? ''), 36);
            $from = avesmapsNormalizeSingleLine((string) ($raw['climate_from'] ?? ''), 60);
            $to = avesmapsNormalizeSingleLine((string) ($raw['climate_to'] ?? ''), 60);
            $out[] = [
                'join_op' => ((string) ($raw['join_op'] ?? 'und')) === 'oder' ? 'oder' : 'und',
                'area_public_id' => $areaId === '' ? null : $areaId,
                'climate_from' => ($from === '' || $to === '') ? null : $from,
                'climate_to' => ($from === '' || $to === '') ? null : $to,
                'types' => $types,
            ];
        }

        return $out;
    };
```

⚠️ Beide Endpunkte einer Spanne oder keiner — ein halber Bereich ist keine Einschränkung, sondern ein Bedienfehler, und `avesmapsLoreRuleZoneKeys` würde ihn ohnehin verwerfen. Hier gleich sauber machen, damit die Datenbank keine halben Spannen sammelt.

- [ ] **Step 3: Die drei `case`-Zweige**

Vor `default:` in `switch ($action)`:

```php
        case 'preview_rule': {
            // Schreibt NICHTS -- die Vorschau ist reine Rechnung. Dieselbe Trennung wie bei
            // der Uebernahme-Vorschau: die Rechen-Haelfte fasst keine Nutztabelle an.
            $terms = $readTerms($payload);
            $result = avesmapsLoreRuleEvaluate(
                $terms,
                $areas = avesmapsLoreRuleReadAreas($pdo),
                $places = avesmapsLoreRuleReadPlaces($pdo),
                avesmapsLoreRuleOrderedZoneKeys($pdo)
            );
            $named = static function (array $rows, array $ids): array {
                $byId = [];
                foreach ($rows as $row) {
                    $byId[(string) $row['public_id']] = (string) ($row['name'] ?? '');
                }
                $out = [];
                foreach ($ids as $id) {
                    $out[] = ['public_id' => $id, 'name' => $byId[$id] ?? ''];
                }

                return $out;
            };
            avesmapsJsonResponse(200, [
                'ok' => true,
                'areas' => $named($areas, $result['areas']),
                'places' => $named($places, $result['places']),
                'counts' => ['areas' => count($result['areas']), 'places' => count($result['places'])],
            ]);
            break;
        }

        case 'save_rule': {
            $terms = $readTerms($payload);
            if ($terms === []) {
                avesmapsErrorResponse(400, 'rule_empty', 'Eine Regel braucht mindestens eine Bedingung.');
            }
            $allEmpty = true;
            foreach ($terms as $term) {
                if (!avesmapsLoreRuleTermIsEmpty($term)) {
                    $allEmpty = false;
                    break;
                }
            }
            if ($allEmpty) {
                avesmapsErrorResponse(400, 'rule_matches_everything', 'Ohne eine Einschraenkung traefe die Regel alles.');
            }
            avesmapsLoreRuleEnsureTables($pdo);
            $relation = avesmapsNormalizeSingleLine((string) ($payload['relation'] ?? 'verbreitung'), 20);
            $ruleId = (int) ($payload['rule_id'] ?? 0);
            $saved = avesmapsLoreRuleSave(
                $pdo,
                $wikiKey,
                $terms,
                $relation === '' ? 'verbreitung' : $relation,
                (int) ($user['id'] ?? 0) ?: null,
                $ruleId > 0 ? $ruleId : null
            );
            avesmapsJsonResponse(200, ['ok' => true, 'rule_id' => $saved]);
            break;
        }

        case 'delete_rule': {
            avesmapsLoreRuleEnsureTables($pdo);
            $ruleId = (int) ($payload['rule_id'] ?? 0);
            if ($ruleId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'rule_id ist erforderlich.');
            }
            avesmapsJsonResponse(200, ['ok' => avesmapsLoreRuleDelete($pdo, $ruleId)]);
            break;
        }
```

- [ ] **Step 4: Syntax prüfen**

Run: `php -l api/edit/map/lore.php`
Expected: `No syntax errors detected`

- [ ] **Step 5: Den Riegel beweisen, ohne Datenbank**

Die Sonde aus [[php-js-test-commands]]: ein toter DB-Port beweist, dass die Rechteprüfung **vor** dem ersten PDO greift.

```bash
AVESMAPS_DB_DRIVER=mysql AVESMAPS_DB_HOST=127.0.0.1 AVESMAPS_DB_PORT=1 \
AVESMAPS_DB_NAME=x AVESMAPS_DB_USER=x AVESMAPS_DB_PASSWORD=x \
php -d extension=php_mbstring.dll -r '
$_SERVER["REQUEST_METHOD"]="POST";
register_shutdown_function(function () { fwrite(STDERR, "HTTP " . http_response_code() . "\n"); });
require "api/edit/map/lore.php";
'
```
Expected: `HTTP 401` — anonym kommt niemand an die Datenbank. Käme hier 500, stünde die Prüfung hinter dem PDO.

- [ ] **Step 6: Das GANZE Testfeld**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" || echo "ROT: $t"; done
EXT="-d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll"
for t in $(find api tools -path '*__tests__*' -name '*test*.php'); do php -d zend.assertions=1 $EXT "$t" >/dev/null || echo "ROT: $t"; done
```
Expected: keine `ROT:`-Zeile.

- [ ] **Step 7: Commit und Push**

```bash
git add api/edit/map/lore.php
git commit -m "feat(vorkommen): Vorschau, Speichern und Loeschen einer Lebensraum-Regel"
git push origin master
```

⚠️ Nach dem Push die Remote-SHA prüfen und **2–4 Minuten warten**, bevor die Live-Seite befragt wird: STRATOs OPcache verzögert PHP-Deploys (siehe [[strato-opcache-verzoegert-php-deploy]]).

---

## Abnahme dieser Sitzung

Erfüllt, wenn **alle** stimmen:

- [ ] `lore-rule-test.php` und `lore-rule-store-test.php` laufen grün, und das ganze Testfeld ebenso.
- [ ] `php -l` ist sauber auf allen berührten Dateien.
- [ ] Die Sonde meldet **401** für einen anonymen POST auf `api/edit/map/lore.php`.
- [ ] Live (nach der OPcache-Wartezeit): ein anonymer `curl -X POST` auf `/api/edit/map/lore.php` antwortet **401**, nicht 500.
- [ ] **An der Oberfläche hat sich nichts geändert.** Das Vorkommen-Fenster sieht aus wie vorher; es gibt noch keinen Regeleditor.

⚠️ Was diese Sitzung **nicht** beweisen kann: ob die Abfragen in Task 5 gegen das echte Schema laufen — es gibt lokal keine MySQL-Instanz. Die Spaltennamen sind in Task 5 Step 3 ausdrücklich als zu prüfen markiert; der erste scharfe `preview_rule`-Aufruf in Sitzung 2 ist der eigentliche Beweis. Das ist eine offene Frage, kein bestandener Test.

## Danach

**Sitzung 2 (sichtbar, Owner-Blick nötig):** der Regeleditor im Vorkommen-Fenster nach `docs/vorkommen-regeleditor-mockup.html`, der Client-Teil des `location`-Laufs, und „Stand: … · aktuell/veraltet" aus `ecosystem_assignment_stamp`.

**Sitzung 3 (sichtbar):** die Regel wirkt in der Infobox (`avesmapsLoreReadForPlaces`-Zwilling, `rank` 1, `completed = 0` liefert keinen Abschnitt), in der Spotlight-Suche, und die Hervorhebung zeigt die Schnittmenge statt der ganzen Fläche.
