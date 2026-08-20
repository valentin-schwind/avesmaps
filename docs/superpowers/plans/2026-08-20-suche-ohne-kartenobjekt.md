# Suche ohne Kartenobjekt — Bauplan

> **Für agentische Bearbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Schritte tragen `- [ ]`.

**Ziel:** Orte, Landschaften, Wege und Herrschaftsgebiete, die das Wiki kennt (oder
die wir kennen), die aber auf keiner Karte stehen, werden in der Spotlight-Suche
gefunden — gedämpft, mit Hinweis, und mit einem Klick, der zum übergeordneten
Gebiet fliegt, soweit es bekannt ist.

**Architektur:** Eine **siebte Quelle** in `GET /api/app/map-search.php`, gebaut als
**gedeckelte Sektion** nach dem Muster der Kartensammlung
(`citymap-search.php` + `avesmapsCollectSearchSection`). Die Zeilen kommen aus
Tabellen, die es schon gibt; das Sprungziel wird mit `place-scope.php` aufgelöst;
die Trefferzeile im Client ist die bestehende mit ihren zwei vorhandenen Klassen.

**Entwurf:** `docs/superpowers/specs/2026-08-20-suche-ohne-kartenobjekt-design.md`

**Technik:** PHP 8 (strict types) + PDO/MySQL, Vanilla-JS-Frontend ohne Build.

## Globale Vorgaben

- 💣 **Kein DDL, kein Wiki-Abruf, keine zweite `map_features`-Abfrage im Suchpfad.**
  Die Suche feuert pro Tastendruck. `avesmapsPlaceScopeLoadIndex($pdo, $rows)` nimmt
  die bereits geladenen Zeilen entgegen — dieser zweite Parameter ist Pflicht.
- 💣 **„Liegt auf der Karte?" ist EINE Rechnung** — die aus
  `avesmapsWikiSettlementListRegistry`. Aufrufen, nicht nachbauen (Entwurf §4.2).
- 💣 **Ein Treffer ohne Sprungziel trägt einen ANDEREN Hinweis** als einer mit.
  Der Schalter heißt `unresolved` und existiert bereits (`citymap-search.php:110`).
- 🔴 **Sichtbare Änderungen gehen EINZELN live** (AGENTS.md §9). Der Plan hat drei
  Stufen; **nach jeder Stufe: Push, dann Halt, dann der Blick des Owners.**
- 🔴 Kommentare und Commit-Meldungen auf **Deutsch** (AGENTS.md §8).
- 💣 **Vor jedem Push das GANZE Testfeld**, inklusive `tools/wikidump/test-*.php`
  (AGENTS.md §9) — nicht nur die eigenen Tests.
- ⚠️ Nur eigene Pfade stagen. Der Arbeitsbaum wird von mehreren Sitzungen geteilt;
  `git add -A` ist verboten.

---

## Stufe 0 — Messen (vor jedem Bau)

### Task 0: Die Mengen live abfragen

Der Entwurf (§3.4) lässt genau eine Zahl offen: wie viele Zeilen je Objektart
anfallen. Sie entscheidet über die Deckelhöhe und darüber, ob eine Art lohnt.

**Dateien:** keine.

- [ ] **Schritt 1: Die Zahlen holen**

Der Editor zeigt sie bereits. Im Ortseditor die Ortsliste öffnen — die Kopfzeile
nennt `wiki_only` (Wiki-Orte ohne Kartenobjekt). Für die übrigen Arten genügt je
eine Zählabfrage über phpMyAdmin:

```sql
SELECT COUNT(*) FROM wiki_region_staging;
SELECT COUNT(*) FROM wiki_path_staging;
SELECT COUNT(*) FROM wiki_territory_model;
SELECT COUNT(*) FROM political_territory t
 WHERE t.is_active = 1
   AND NOT EXISTS (SELECT 1 FROM political_territory_geometry g
                    WHERE g.territory_id = t.id AND g.is_active = 1);
```

⚠️ **Einzelabfragen, keine Schleife** (AGENTS.md §9, STRATO).

- [ ] **Schritt 2: Die Zahlen in den Entwurf eintragen**

§3.4 des Entwurfs ersetzen: die Tabelle bekommt eine Spalte „Zeilen (live,
20.08.2026)". Der 🔧-Punkt in §8 fällt weg.

- [ ] **Schritt 3: Deckelhöhe festlegen**

Vorgabe `AVESMAPS_OFFMAP_SEARCH_LIMIT = 5`, wie die drei bestehenden Sektionen.
Nur ändern, wenn die Zahlen es begründen — und dann mit der Begründung als
Kommentar an der Konstante.

- [ ] **Schritt 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-20-suche-ohne-kartenobjekt-design.md
git commit -m "docs(suche): gemessene Mengen je Objektart nachgetragen"
```

---

## Stufe 1 — Fundament + die Arten, die sofort gehen

Regionen, Wege und Bauwerke außerorts. Bei diesen dreien steht das Sprungziel
bereits als Spalte in der Datenbank; sie wirken ohne jeden Sync.

### Task 1: Die geteilte „liegt auf der Karte"-Rechnung

Heute steckt sie inline in `avesmapsWikiSettlementListRegistry`
(`api/_internal/wiki/settlements.php:1440–1655`). Sie wird herausgezogen, damit
Suche und Editorliste **dieselbe** Antwort geben.

**Dateien:**
- Anlegen: `api/_internal/wiki/map-presence.php`
- Ändern: `api/_internal/wiki/settlements.php` (der Block, der `$mapKeys` füllt)
- Test: `api/_internal/wiki/__tests__/map-presence-test.php`

**Schnittstellen:**
- Liefert: `avesmapsBuildMapPresenceIndex(array $rows): array<string,bool>` —
  Match-Keys aller Kartenobjekte plus die Titel ihrer zugewiesenen Wiki-Nester.
- Liefert: `avesmapsIsTitleOnMap(string $title, array $index): bool`
- Verbraucht: `avesmapsWikiSyncCreateMatchKey` aus `wiki/sync.php`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Der zweite Fall ist der tragende: ein Kartenobjekt, dessen Name vom Wiki-Titel
abweicht, das aber zugewiesen ist, gilt als „auf der Karte".

```php
<?php
declare(strict_types=1);
require_once __DIR__ . '/../sync.php';
require_once __DIR__ . '/../map-presence.php';

$rows = [
    ['name' => 'Gareth', 'properties_json' => null],
    ['name' => 'Ochsenblut', 'properties_json' => json_encode([
        'wiki_settlement' => ['title' => 'Baronie Ochsenblut'],
    ])],
];
$index = avesmapsBuildMapPresenceIndex($rows);

assert(avesmapsIsTitleOnMap('Gareth', $index) === true, 'Kartenname zaehlt');
assert(
    avesmapsIsTitleOnMap('Baronie Ochsenblut', $index) === true,
    'ZUGEWIESENER Wiki-Titel zaehlt auch, wenn der Kartenname abweicht'
);
assert(avesmapsIsTitleOnMap('Rabenstein', $index) === false, 'Unbekanntes nicht');
assert(avesmapsIsTitleOnMap('', $index) === false, 'Leerer Titel nie');
echo "map-presence-test: OK\n";
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/map-presence-test.php
```

Erwartet: Fehler „Failed opening required … map-presence.php".

- [ ] **Schritt 3: Die Bibliothek anlegen**

```php
<?php
declare(strict_types=1);

/**
 * „Liegt dieser Wiki-Titel auf der Karte?" — EINE Rechnung fuer alle Leser.
 *
 * 💣 Sie hat ZWEI Haelften, und die zweite ist tragend: neben den Namen der
 * Kartenobjekte zaehlt der Titel jedes ZUGEWIESENEN wiki_settlement-Nests. Ohne
 * ihn gilt eine Seite als „nicht auf der Karte", sobald der Kartenname vom
 * Wiki-Titel abweicht („Ochsenblut" vs. „Baronie Ochsenblut") — und die Suche
 * boete dann an, zu etwas zu fliegen, das laengst dasteht.
 *
 * Herausgezogen aus avesmapsWikiSettlementListRegistry, damit Editorliste und
 * Kartensuche nicht auseinanderlaufen koennen (AGENTS.md §11, „EINE Rechnung").
 */

require_once __DIR__ . '/sync.php';

/** @param list<array<string,mixed>> $rows map_features-Zeilen (name + properties_json) */
function avesmapsBuildMapPresenceIndex(array $rows): array
{
    $index = [];
    foreach ($rows as $row) {
        $name = (string) ($row['name'] ?? '');
        if ($name !== '') {
            $key = avesmapsWikiSyncCreateMatchKey($name);
            if ($key !== '') {
                $index[$key] = true;
            }
        }

        $properties = $row['properties_json'] ?? null;
        if (is_string($properties)) {
            $properties = json_decode($properties, true);
        }
        $settlement = is_array($properties) ? ($properties['wiki_settlement'] ?? null) : null;
        $title = is_array($settlement) ? (string) ($settlement['title'] ?? '') : '';
        if ($title !== '') {
            $titleKey = avesmapsWikiSyncCreateMatchKey($title);
            if ($titleKey !== '') {
                $index[$titleKey] = true;
            }
        }
    }

    return $index;
}

/** @param array<string,bool> $index */
function avesmapsIsTitleOnMap(string $title, array $index): bool
{
    $key = avesmapsWikiSyncCreateMatchKey($title);

    return $key !== '' && isset($index[$key]);
}
```

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/map-presence-test.php
```

Erwartet: `map-presence-test: OK`

- [ ] **Schritt 5: Die Editorliste auf die geteilte Rechnung umstellen**

In `settlements.php` den Block, der `$mapKeys` inline füllt, durch
`avesmapsBuildMapPresenceIndex($rows)` ersetzen und die spätere Prüfung
`isset($mapKeys[$bk])` durch `avesmapsIsTitleOnMap($title, $mapKeys)`.

⚠️ **Verhalten muss identisch bleiben.** Die Editorliste ist Produktionscode mit
Zählern (`wiki_only`, `on_map`); ändert sich eine Zahl, ist die Extraktion falsch.
`require_once __DIR__ . '/map-presence.php';` oben ergänzen.

- [ ] **Schritt 6: Das ganze PHP-Testfeld laufen lassen**

```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
```

Erwartet: außer `linkcheck/link-url-test.php` (vorbestehend rot, echter DNS-Abruf)
alles grün.

- [ ] **Schritt 7: Commit**

```bash
git add api/_internal/wiki/map-presence.php api/_internal/wiki/__tests__/map-presence-test.php api/_internal/wiki/settlements.php
git commit -m "refactor(suche): liegt-auf-der-Karte ist jetzt EINE geteilte Rechnung"
```

---

### Task 2: Die neue Quelle — reiner Teil

**Dateien:**
- Anlegen: `api/_internal/app/offmap-search.php`
- Test: `api/_internal/app/__tests__/offmap-search-test.php`

**Schnittstellen:**
- Liefert: `avesmapsBuildOffmapTargetIndex(array $rows, array $politicalRows): array<string,array{public_id:string,kind:string}>`
- Liefert: `avesmapsBuildOffmapSearchEntries(array $rows, array $targetIndex, array $scopeIndex, array $presenceIndex): list<array>`
  — Einträge in derselben Form wie `avesmapsBuildCitymapSearchEntries`
  (`kind`, `name`, `type_label`, `place_public_id`, `place_kind`, `place_name`,
  `not_on_map`, `unresolved`, `search_texts`, `min_x`/`min_y`/`max_x`/`max_y` = 0.0).
- Liefert: `avesmapsOffmapSearchCompare(array $a, array $b): int` — Tiebreak für
  `avesmapsCollectSearchSection`.
- Verbraucht: `avesmapsPlaceScopeClassifyWithIndex` + `avesmapsPlaceScopeFoldName`
  (`wiki/place-scope.php`), `avesmapsIsTitleOnMap` (Task 1).

💣 **Der Client löst über eine `public_id` auf, nicht über einen Namen.**
`buildPlaceBoundSpotlightEntry` (`spotlight-search.js:501`) liest
`result.place_public_id` und `result.place_kind` und schlägt damit im geladenen
Kartenbestand nach. Ein Eintrag, der nur `place_name` trägt, kommt dort **immer**
im `unreachable`-Zweig heraus — der Treffer sähe richtig aus und würde beim Klick
nichts tun. Deshalb der zweite Index: er übersetzt den aufgelösten Ortsnamen in die
`public_id` des Kartenobjekts.

⚠️ Der bestehende `avesmapsBuildSettlementLocationIndex` reicht dafür **nicht** — er
kennt nur Siedlungen, und die Sprungziele hier sind überwiegend Regionen und
Länder. Der neue Index deckt Orte, Regionen, Labels und Territorien ab; die
Namensfaltung ist dieselbe (`avesmapsPlaceScopeFoldName`), damit beide Indizes
denselben Namen gleich schlüsseln.

🔴 **`place_kind` muss einer der Werte sein, die `spotlightPlaceLookupKeys`
(`spotlight-search.js:475`) kennt** — `settlement` | `territory` | `region` |
`path`. Ein anderer Wert findet nichts und erzeugt genau den stillen
`unreachable`-Fall oben.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
<?php
declare(strict_types=1);
require_once __DIR__ . '/../offmap-search.php';

// Der Ziel-Index: Kartenobjekte, auf die ein Treffer zeigen darf.
$targetIndex = avesmapsBuildOffmapTargetIndex(
    [['feature_type' => 'region', 'feature_subtype' => 'region',
      'public_id' => 'reg-weiden', 'name' => 'Weiden']],
    []
);
assert($targetIndex['weiden']['public_id'] === 'reg-weiden', 'Index kennt die public_id');
assert($targetIndex['weiden']['kind'] === 'region', 'und die Art, die der Client erwartet');

// Ein Scope-Index in der Form, die place-scope.php liefert.
$scopeIndex = ['settlements' => [], 'regions' => ['weiden' => true]];
$presence   = ['gareth' => true];

$rows = [
    ['title' => 'Rabenstein', 'type_label' => 'Burg', 'place_raw' => '[[Weiden]]',
     'wiki_url' => 'https://wiki/Rabenstein', 'kind' => 'building'],
    ['title' => 'Steinerne Rinne', 'type_label' => 'Gebirgspass', 'place_raw' => '',
     'wiki_url' => 'https://wiki/Rinne', 'kind' => 'path'],
    ['title' => 'Gareth', 'type_label' => 'Metropole', 'place_raw' => '',
     'wiki_url' => 'https://wiki/Gareth', 'kind' => 'settlement'],
];

$entries = avesmapsBuildOffmapSearchEntries($rows, $targetIndex, $scopeIndex, $presence);
$byName = [];
foreach ($entries as $e) { $byName[$e['name']] = $e; }

assert(!isset($byName['Gareth']), 'Was auf der Karte liegt, gehoert nicht in diese Quelle');

assert($byName['Rabenstein']['unresolved'] === false, 'aufgeloestes Ziel');
assert($byName['Rabenstein']['place_name'] === 'Weiden', 'Ziel benannt');
// 💣 Ohne public_id landet der Treffer im Client stumm im unreachable-Zweig.
assert($byName['Rabenstein']['place_public_id'] === 'reg-weiden', 'Ziel ist ANSPRINGBAR');
assert($byName['Rabenstein']['place_kind'] === 'region', 'mit einer Art, die der Client kennt');
assert($byName['Rabenstein']['type_label'] === 'Burg · Weiden', 'Typzeile nennt den Ort');
assert($byName['Rabenstein']['not_on_map'] === true, 'immer gedaempft');

assert($byName['Steinerne Rinne']['unresolved'] === true, 'ohne Rohwert kein Ziel');
assert($byName['Steinerne Rinne']['place_name'] === '', 'und kein erfundener Ortsname');
assert($byName['Steinerne Rinne']['place_public_id'] === '', 'und keine erfundene id');
assert($byName['Steinerne Rinne']['type_label'] === 'Gebirgspass', 'Typzeile ohne Ort');

// 💣 Ein Name, den der Scope-Index kennt, den die KARTE aber nicht zeigt, ist kein
// Ziel. Sonst verspricht der Treffer einen Flug, den der Client nicht fliegen kann.
$ohneKarte = avesmapsBuildOffmapSearchEntries(
    [['title' => 'Ding', 'type_label' => 'Burg', 'place_raw' => '[[Weiden]]',
      'wiki_url' => '', 'kind' => 'building']],
    [],            // leerer Ziel-Index: Weiden ist nirgends gezeichnet
    $scopeIndex,
    []
);
assert($ohneKarte[0]['unresolved'] === true, 'kein Kartenobjekt = kein Ziel');
assert($ohneKarte[0]['place_name'] === '', 'und kein Rohtext in der Anzeige');

echo "offmap-search-test: OK\n";
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/offmap-search-test.php
```

Erwartet: Fehler „Failed opening required … offmap-search.php".

- [ ] **Schritt 3: Den reinen Teil bauen**

`api/_internal/app/offmap-search.php` anlegen. Kopfkommentar nach dem Vorbild von
`in-settlement-search.php`; darin ausdrücklich: reiner Teil, DB-frei, testbar ohne
MySQL. Kern:

```php
/**
 * Name -> anspringbares Kartenobjekt. Deckt Orte, Regionen, Label UND Territorien
 * ab, weil die Sprungziele hier ueberwiegend Regionen und Laender sind -- der
 * bestehende avesmapsBuildSettlementLocationIndex kennt nur Siedlungen.
 *
 * 🔴 Die `kind`-Werte sind die, die spotlightPlaceLookupKeys im Client kennt
 * (settlement|territory|region|path). Ein anderer Wert findet nichts, und der
 * Treffer faellt still in den unreachable-Zweig.
 *
 * ⚠️ Bei Namensgleichheit gewinnt der ERSTE und der Name wird nicht mehrdeutig
 * ausgeschlossen: anders als beim Innerorts-Index ist ein etwas zu grob
 * getroffenes Elterngebiet harmlos (man landet in der richtigen Gegend), waehrend
 * gar kein Ziel den Treffer wertlos macht.
 */
function avesmapsBuildOffmapTargetIndex(array $rows, array $politicalRows): array
{
    $index = [];
    $put = static function (string $name, string $publicId, string $kind) use (&$index): void {
        $key = avesmapsPlaceScopeFoldName(trim($name));
        if ($key === '' || $publicId === '' || isset($index[$key])) {
            return;
        }
        $index[$key] = ['public_id' => $publicId, 'kind' => $kind];
    };

    $kindByFeatureType = ['location' => 'settlement', 'region' => 'region', 'label' => 'region'];
    foreach ($rows as $row) {
        $kind = $kindByFeatureType[(string) ($row['feature_type'] ?? '')] ?? '';
        if ($kind !== '') {
            $put((string) ($row['name'] ?? ''), (string) ($row['public_id'] ?? ''), $kind);
        }
    }
    foreach ($politicalRows as $row) {
        $put((string) ($row['name'] ?? ''), (string) ($row['public_id'] ?? ''), 'territory');
    }

    return $index;
}

function avesmapsBuildOffmapSearchEntries(
    array $rows,
    array $targetIndex,
    array $scopeIndex,
    array $presenceIndex
): array {
    $entries = [];
    foreach ($rows as $row) {
        $title = trim((string) ($row['title'] ?? ''));
        if ($title === '' || avesmapsIsTitleOnMap($title, $presenceIndex)) {
            continue; // Was auf der Karte liegt, hat hier nichts zu suchen.
        }

        // 💣 Der Rohwert traegt Wiki-Markup. Aufgeloest wird mit dem Werkzeug, das
        // dafuer da ist -- kein eigener Klammer-Parser.
        $scope = avesmapsPlaceScopeClassifyWithIndex((string) ($row['place_raw'] ?? ''), $scopeIndex);
        if ((string) ($scope['scope'] ?? '') === 'inside') {
            continue; // Innerorts gehoert der dritten Quelle (in-settlement-search.php).
        }

        // 💣 ZWEI Huerden, und beide muessen fallen: der Rohwert muss einen Namen
        // hergeben, UND dieser Name muss auf der Karte liegen. Nur die erste zu
        // pruefen verspricht einen Flug, den der Client nicht fliegen kann.
        $candidate = (string) ($scope['settlement'] ?? '');
        $target = $candidate !== ''
            ? ($targetIndex[avesmapsPlaceScopeFoldName($candidate)] ?? null)
            : null;

        // ⚠️ Ohne Ziel bleibt place_name LEER -- NIE der Rohtext. Ein
        // „liegt in [[Kosch]]", das nirgendwo hinfuehrt, ist eine Halbwahrheit.
        $unresolved = $target === null;
        $placeName = $unresolved ? '' : $candidate;

        $typeLabel = (string) ($row['type_label'] ?? '');
        $typeLabelParts = array_filter([$typeLabel, $placeName]);

        $entries[] = [
            'kind' => 'offmap',
            'public_id' => '',
            'public_ids' => [],
            'name' => $title,
            'type_label' => implode(' · ', $typeLabelParts),
            'feature_subtype' => (string) ($row['kind'] ?? ''),
            'place_public_id' => $unresolved ? '' : (string) $target['public_id'],
            'place_kind' => $unresolved ? 'unresolved' : (string) $target['kind'],
            'place_name' => $placeName,
            'not_on_map' => true,
            'unresolved' => $unresolved,
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'min_x' => 0.0, 'min_y' => 0.0, 'max_x' => 0.0, 'max_y' => 0.0,
            'search_texts' => array_values(array_filter([$title, $placeName, $typeLabel])),
        ];
    }

    return $entries;
}
```

⚠️ **`place_public_id` ist die id des ZIELS, nicht des Treffers.** Der Treffer
selbst hat keine (`public_id: ''`) — er ist ja nicht auf der Karte. Dieselbe
Aufteilung wie bei der Kartensammlung (`citymap-search.php:104–110`).

Dazu der Tiebreak, Vorbild `avesmapsCitymapSearchCompare`:

```php
function avesmapsOffmapSearchCompare(array $left, array $right): int
{
    $scoreDiff = (int) $left['score'] <=> (int) $right['score'];
    if ($scoreDiff !== 0) {
        return $scoreDiff;
    }
    // 🔴 Wer hinfliegen kann, steht vor dem, der nur gelesen werden kann (Entwurf §4.4).
    $reachDiff = ((int) $left['unresolved']) <=> ((int) $right['unresolved']);
    if ($reachDiff !== 0) {
        return $reachDiff;
    }

    return strnatcasecmp((string) $left['name'], (string) $right['name']);
}
```

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/offmap-search-test.php
```

Erwartet: `offmap-search-test: OK`

- [ ] **Schritt 5: Commit**

```bash
git add api/_internal/app/offmap-search.php api/_internal/app/__tests__/offmap-search-test.php
git commit -m "feat(suche): reiner Kern der Quelle fuer Objekte ohne Kartenobjekt"
```

---

### Task 3: Die Abfragen für Regionen, Wege und Bauwerke außerorts

**Dateien:**
- Ändern: `api/_internal/app/offmap-search.php` (Abfrageteil unten anhängen)
- Test: keiner — dieser Teil braucht MySQL und ist auf dieser Maschine nicht
  beweisbar (dieselbe Begrenzung, die `in-settlement-search.php` im Kopf nennt).

**Schnittstellen:**
- Liefert: `avesmapsFetchOffmapSearchRows(PDO $pdo): list<array>` in der Form, die
  Task 2 erwartet (`title`, `type_label`, `place_raw`, `wiki_url`, `kind`).

- [ ] **Schritt 1: Die drei Abfragen schreiben**

```php
/**
 * Zeilen der drei Arten, deren Sprungziel BEREITS als Spalte dasteht.
 *
 * 💣 Jede Abfrage steht in ihrem eigenen try/catch: fehlt eine Staging-Tabelle
 * (frische Installation, Sync nie gelaufen), darf die Kartensuche deswegen nicht
 * ausfallen -- sie verliert dann nur diese eine Art.
 *
 * ⚠️ Bauwerke: NUR ausserorts. Die Faelle `inside` gehoeren der Innerorts-Quelle
 * (in-settlement-search.php) und wuerden sonst doppelt erscheinen.
 */
function avesmapsFetchOffmapSearchRows(PDO $pdo): array
{
    $rows = [];

    // Landschaften/Regionen: region_parent + affiliation_staat sind eigene Spalten.
    try {
        $statement = $pdo->query(
            "SELECT title, art, region_parent, affiliation_staat, wiki_url
               FROM wiki_region_staging"
        );
        foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
            $rows[] = [
                'title' => (string) ($row['title'] ?? ''),
                'type_label' => (string) ($row['art'] ?? '') !== '' ? (string) $row['art'] : 'Landschaft',
                'place_raw' => (string) ($row['region_parent'] ?? '') !== ''
                    ? (string) $row['region_parent']
                    : (string) ($row['affiliation_staat'] ?? ''),
                'wiki_url' => (string) ($row['wiki_url'] ?? ''),
                'kind' => 'region',
            ];
        }
    } catch (Throwable) {
        // Tabelle fehlt -> diese Art faellt aus, die Suche laeuft weiter.
    }

    // Wege/Fluesse: lage_raw.
    try {
        $statement = $pdo->query("SELECT name, art, lage_raw, wiki_url FROM wiki_path_staging");
        foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
            $rows[] = [
                'title' => (string) ($row['name'] ?? ''),
                'type_label' => (string) ($row['art'] ?? '') !== '' ? (string) $row['art'] : 'Weg',
                'place_raw' => (string) ($row['lage_raw'] ?? ''),
                'wiki_url' => (string) ($row['wiki_url'] ?? ''),
                'kind' => 'path',
            ];
        }
    } catch (Throwable) {
    }

    // Bauwerke/Staetten AUSSERORTS: standort ist der Rohwert; die inside-Faelle
    // filtert der reine Teil ueber den Scope-Index (siehe unten, Schritt 2).
    try {
        $statement = $pdo->query(
            "SELECT title, building_type, standort, wiki_url
               FROM wiki_sync_pages
              WHERE settlement_class = 'gebaeude'"
        );
        foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
            $rows[] = [
                'title' => (string) ($row['title'] ?? ''),
                'type_label' => (string) ($row['building_type'] ?? '') !== ''
                    ? (string) $row['building_type']
                    : 'Bauwerk',
                'place_raw' => (string) ($row['standort'] ?? ''),
                'wiki_url' => (string) ($row['wiki_url'] ?? ''),
                'kind' => 'building',
            ];
        }
    } catch (Throwable) {
    }

    return $rows;
}
```

- [ ] **Schritt 2: Die Doppelung mit der Innerorts-Quelle festnageln**

Die Weiche (`$scope['scope'] === 'inside'` → überspringen) steckt bereits im Kern
aus Task 2. Hier bekommt sie ihren Test, weil sie erst mit echten Bauwerkszeilen
scharf wird:

```php
$innerorts = avesmapsBuildOffmapSearchEntries(
    [['title' => 'Greifax-Palast', 'type_label' => 'Palast',
      'place_raw' => '[[Weiden]]: [[Arenaviertel]]', 'wiki_url' => '', 'kind' => 'building']],
    $targetIndex,
    ['settlements' => ['weiden' => true], 'regions' => []],
    []
);
assert($innerorts === [], 'Innerorts-Objekte gehoeren der dritten Quelle, nicht dieser');
```

💣 **Ob `avesmapsPlaceScopeClassifyWithIndex` bei diesem Rohwert wirklich `inside`
liefert, ist eine VERMUTUNG, bis sie geprüft ist.** Vor dem Festschreiben des
Tests am echten Code nachsehen — der Rohwert mit Doppelpunkt („[[Gareth]]:
[[Arenaviertel]]") ist die Form, die der Kopfkommentar von `place-scope.php` als
Beispiel nennt, aber die Entscheidung hängt am Index, nicht am Doppelpunkt:

```bash
grep -n "function avesmapsPlaceScopeClassify" -A 60 api/_internal/wiki/place-scope.php
```

⚠️ Liefert die Funktion für diese Zeile **nicht** `inside`, ist der Test falsch —
nicht die Funktion. Dann den Rohwert nehmen, den sie tatsächlich als `inside`
klassifiziert, und das im Test als Kommentar festhalten.

- [ ] **Schritt 3: Tests laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/offmap-search-test.php
```

Erwartet: `offmap-search-test: OK`

- [ ] **Schritt 4: Commit**

```bash
git add api/_internal/app/offmap-search.php api/_internal/app/__tests__/offmap-search-test.php
git commit -m "feat(suche): Abfragen fuer Landschaften, Wege und Staetten ausserorts"
```

---

### Task 4: Einhängen in den Endpunkt

**Dateien:**
- Ändern: `api/app/map-search.php` (require, Aufruf, Sektion)

**Schnittstellen:**
- Verbraucht: `avesmapsFetchOffmapSearchRows`, `avesmapsBuildOffmapSearchEntries`,
  `avesmapsOffmapSearchCompare` (Tasks 2–3), `avesmapsBuildMapPresenceIndex` (Task 1).
- Liefert: Antwortzeilen mit `kind: "offmap"` und dem Feld `offmap_total`.

- [ ] **Schritt 1: Bibliothek einbinden und Deckel setzen**

Oben in `map-search.php`:

```php
require_once __DIR__ . '/../_internal/app/offmap-search.php';
```

Zu den bestehenden Deckeln:

```php
// Siebte Quelle: was das Wiki kennt, aber keine Karte zeigt. Derselbe Deckel und
// derselbe Grund wie oben -- ein Allerweltswort („burg", „stein") wuerde die
// Liste sonst allein fuellen und die echten Kartenobjekte verdraengen.
const AVESMAPS_OFFMAP_SEARCH_LIMIT = 5;
```

- [ ] **Schritt 2: Die Zeilen holen**

Neben den anderen Quellen, VOR `avesmapsBuildMapSearchResults`:

```php
$offmapRows = avesmapsFetchOffmapSearchRows($pdo);
```

- [ ] **Schritt 3: Den Parameter durchreichen**

`avesmapsBuildMapSearchResults` bekommt `array $offmapRows = []` als **letzten**
Parameter — hinten angehängt, damit kein bestehender Aufruf bricht.

⚠️ Die Signatur trägt damit zehn Parameter. Das ist grenzwertig, aber ein Umbau
auf ein Options-Array berührt jeden Aufrufer und jeden Test dieser Funktion und
gehört **nicht** in dieses Feature (Entwurf §6, „keine Änderung an der Bewertung").
Ein Kommentar an der Signatur hält das fest, damit es der nächste Leser nicht für
Nachlässigkeit hält.

- [ ] **Schritt 4: Die Sektion sammeln**

Bei den drei bestehenden `avesmapsCollectSearchSection`-Aufrufen:

```php
// 💣 Beide Indizes kommen aus $rows -- den map_features, die dieser Endpunkt
// ohnehin geladen hat. Keine zweite Abfrage (STRATO, AGENTS.md §9).
[$offmapResults, $offmapTotal] = $offmapRows !== [] && $pdo !== null
    ? avesmapsCollectSearchSection(
        avesmapsBuildOffmapSearchEntries(
            $offmapRows,
            avesmapsBuildOffmapTargetIndex($rows, $politicalRows),
            avesmapsPlaceScopeLoadIndex($pdo, $rows),
            avesmapsBuildMapPresenceIndex($rows)
        ),
        $normalizedQuery,
        'avesmapsOffmapSearchCompare',
        AVESMAPS_OFFMAP_SEARCH_LIMIT
    )
    : [[], 0];
```

⚠️ `avesmapsPlaceScopeLoadIndex($pdo, $rows)` wird im Innerorts-Zweig bereits
gebaut. **Einmal bauen, beide Zweige bedienen** — nicht zweimal. Dafür wandert er
vor beide Zweige in eine lokale Variable.

⚠️ `$politicalRows` sind die Zeilen der bestehenden Territoriumsabfrage — also
Gebiete **mit** Fläche. Genau die sind hier als Sprungziel richtig: ein Land ohne
Fläche kann selbst kein Ziel sein.

- [ ] **Schritt 5: Die Sektion anhängen**

In der `$sections`-Liste, **als letzte**:

```php
[$offmapResults, 'offmap_total', $offmapTotal],
```

🔴 Die Reihenfolge dieser Liste IST die Reihenfolge im Ergebnis, und der Client
rendert in derselben Folge (`SPOTLIGHT_SEARCH_SECTIONS`). Als letzte stehen die
neuen Treffer unter allem anderen — genau der Owner-Entscheid aus §2.

- [ ] **Schritt 6: Den Endpunkt einmal anfassen**

```bash
php -l api/app/map-search.php
```

Erwartet: `No syntax errors detected`.

💣 **Und einmal ausführen, nicht nur linten.** PHP hoistet Funktionen, aber keine
`const` auf Dateiebene; ein Fatal Error antwortet mit leerem Rumpf und liest sich
im Browser wie ein Netzfehler. Der Leser wird gegen die Live-Datenbank geprüft
(Task 6, Schritt 1) — **eine** Anfrage, keine Schleife.

- [ ] **Schritt 7: Das ganze PHP-Testfeld**

```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
```

- [ ] **Schritt 8: Commit**

```bash
git add api/app/map-search.php
git commit -m "feat(suche): siebte Quelle als gedeckelte Sektion eingehaengt"
```

---

### Task 5: Der Client

**Dateien:**
- Ändern: `js/ui/spotlight-search.js` (`SPOTLIGHT_SEARCH_SECTIONS`, Eintragsbauer)
- Test: `js/ui/__tests__/offmap-treffer.test.js`

**Schnittstellen:**
- Verbraucht: Antwortzeilen mit `kind: "offmap"`, `not_on_map`, `unresolved`,
  `place_name`, `offmap_total`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```javascript
const assert = require("node:assert");
// Muster: js/ui/__tests__/spotlight-versteckt-zeile.test.js

// 🔴 ZWEI Fragen, ZWEI Klassen -- der Fehler vom 15.08.2026 darf nicht zurueck.
const mitZiel = spotlightResultMarkup(
    { kind: "offmap", name: "Rabenstein", typeLabel: "Burg · Weiden",
      notOnMap: true, placeHint: "nicht auf der Karte" }, 0);
assert.ok(mitZiel.includes("--not-on-map"), "gedaempft");
assert.ok(mitZiel.includes("--two-line"), "und breit genug fuer den Hinweis");
assert.ok(mitZiel.includes("nicht auf der Karte"), "der Hinweis steht da");

const ohneZiel = spotlightResultMarkup(
    { kind: "offmap", name: "Steinerne Rinne", typeLabel: "Gebirgspass",
      notOnMap: true, unreachable: true }, 1);
assert.ok(ohneZiel.includes("kein Ort auf der Karte"),
    "ohne Ziel der ANDERE Satz -- sonst erwartet der Leser einen Flug, der ausbleibt");
assert.ok(!ohneZiel.includes("nicht auf der Karte"), "und nur einer von beiden");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/ui/__tests__/offmap-treffer.test.js
```

Erwartet: FEHLER (die Sektion `offmap` ist unbekannt).

- [ ] **Schritt 3: Die Sektion eintragen**

In `SPOTLIGHT_SEARCH_SECTIONS` (`js/ui/spotlight-search.js:21`), als **letzte**:

```javascript
{ kind: "offmap", totalField: "offmapTotal", labelKey: "spotlight.offmap",
  label: "Nicht auf der Karte", moreKey: "spotlight.offmapMore",
  more: "… und {n} weitere" },
```

🔴 Die Reihenfolge muss der `$sections`-Liste im Server entsprechen (Task 4,
Schritt 5) — der Kommentar dort sagt es ausdrücklich.

- [ ] **Schritt 4: Den Eintragsbauer anschließen**

⭐ **Es wird kein neuer Bauer geschrieben.** `buildPlaceBoundSpotlightEntry`
(`spotlight-search.js:501`) tut bereits genau das Richtige: er erbt den Eintrag des
Zielobjekts (derselbe Flug, dieselbe Infobox, kein zweiter Navigationsweg), setzt
eine eigene `id`, `notOnMap: true` und `unreachable: !placeEntry`. Er wird nur noch
nicht für `offmap` aufgerufen.

Die Dispatch-Zeile (`spotlight-search.js:682`) erweitern:

```javascript
if (!entry && (kind === "citymap" || kind === "adventure" || kind === "offmap")) {
    entry = buildPlaceBoundSpotlightEntry(result, kind);
}
```

💣 **Die `id` ist damit `offmap:<name>`** — der Bauer nimmt `result.public_id`,
und die ist bei uns leer, also fällt er auf den Namen zurück. Das ist richtig und
tragend: übernähme der Eintrag die id des Ziels, verrechnete `seenEntryIds` ihn
gegen den echten Treffer und einer der beiden verschwände (der Kommentar an
Zeile 443 hält genau das fest). ⚠️ Zwei gleichnamige Objekte ohne Kartenobjekt
teilen sich damit eine id und der zweite fällt weg — beim Bau prüfen, ob das im
Bestand vorkommt; wenn ja, `feature_subtype` in die id aufnehmen.

Im Bauer selbst zwei Ergänzungen. Erstens der Hinweistext für den **erreichbaren**
Fall — der unerreichbare bekommt „kein Ort auf der Karte" bereits von
`spotlightResultMarkup` über `unreachable`:

```javascript
placeHint: placeEntry && kind === "adventure" && result.place_name
    ? (…unverändert…)
    : (placeEntry && kind === "offmap"
        ? tr("spotlight.notOnMap", "nicht auf der Karte")
        : ""),
```

Zweitens der Sektionszähler neben den beiden vorhandenen:

```javascript
offmapTotal: Number(result.offmap_total) || 0,
```

🔴 **Nichts an `unreachable` oder `notOnMap` anfassen.** Beide stimmen für diesen
Fall bereits — das ist der Grund, diesen Bauer zu benutzen statt einen zweiten zu
schreiben.

- [ ] **Schritt 5: Test laufen lassen, Erfolg bestätigen**

```bash
node js/ui/__tests__/offmap-treffer.test.js
```

- [ ] **Schritt 6: Das ganze JS-Testfeld**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
```

- [ ] **Schritt 7: Commit**

```bash
git add js/ui/spotlight-search.js js/ui/__tests__/offmap-treffer.test.js
git commit -m "ui(suche): Abschnitt 'Nicht auf der Karte' in der Trefferliste"
```

---

### Task 6: Stufe 1 abnehmen und live

- [ ] **Schritt 1: Gegen die echte Datenbank prüfen — EINE Anfrage**

Lokal mit `api/config.local.php` (falls vorhanden) oder nach dem Push gegen live:

```bash
curl -s "https://avesmaps.de/api/app/map-search.php?q=stein" | head -c 2000
```

⚠️ **Keine Schleife** (AGENTS.md §9). Geprüft wird: `ok: true`, mindestens ein
Eintrag mit `kind: "offmap"`, und dass `place_name` bei aufgelösten Treffern
gefüllt und bei unaufgelösten leer ist.

💣 Ein `ok:true` mit **leerer** Trefferliste ist von „hier gibt es nichts" nicht zu
unterscheiden — genau die Falle, in die „Was ist hier?" am 15.08.2026 lief (ein
doppelt verwendeter PDO-Platzhalter, verschluckt vom `catch`). Bei leerer Liste
also **nicht** annehmen, sondern die drei Abfragen einzeln gegen die DB fahren.

- [ ] **Schritt 2: Der Ablauf im Browser, nicht eine Zahl**

Abnahme heißt ABLAUF (AGENTS.md §9): Lupe öffnen, „stein" tippen, den Abschnitt
sehen, einen Treffer **mit** Ort anklicken (Karte fliegt hin, Infobox öffnet),
einen **ohne** anklicken (Karte bleibt stehen, Infobox öffnet). Alle drei Handgriffe
benennen.

- [ ] **Schritt 3: Beide Testfelder komplett**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
```

- [ ] **Schritt 4: Push, dann HALT**

```bash
git push origin master
```

🔴 **Hier endet Stufe 1.** Der Owner sieht sie sich an, bevor Stufe 2 beginnt
(AGENTS.md §9, „Ein Commit, ein Push, sein Blick").

---

## Stufe 2 — Herrschaftsgebiete

### Task 7: Gebiete ohne Fläche wieder in die Suche

**Dateien:**
- Ändern: `api/app/map-search.php` (`avesmapsFetchPoliticalTerritorySearchRows`)
- Ändern: `api/_internal/app/offmap-search.php` (Territoriumszeilen)
- Test: `api/_internal/app/__tests__/offmap-search-test.php` (erweitern)

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
// Ein Gebiet ohne eigene und ohne Nachfahren-Geometrie gehoert in die neue Quelle,
// mit seinem Elterngebiet als Sprungziel -- und das Elterngebiet ist ein
// TERRITORIUM, nicht eine Region: der Ziel-Index muss es aus $politicalRows kennen.
$zielIndex = avesmapsBuildOffmapTargetIndex(
    [],
    [['public_id' => 'ter-garetien', 'name' => 'Garetien']]
);
$rows = [['title' => 'Baronie Falkenstein', 'type_label' => 'Baronie',
          'place_raw' => 'Garetien', 'wiki_url' => '', 'kind' => 'territory']];
$entries = avesmapsBuildOffmapSearchEntries(
    $rows,
    $zielIndex,
    ['settlements' => [], 'regions' => ['garetien' => true]],
    []
);
assert($entries[0]['unresolved'] === false, 'Elterngebiet ist ein gueltiges Ziel');
assert($entries[0]['place_kind'] === 'territory', 'und wird als Territorium angesprungen');
assert($entries[0]['place_public_id'] === 'ter-garetien');
assert($entries[0]['type_label'] === 'Baronie · Garetien');
```

⚠️ Ob `avesmapsPlaceScopeClassifyWithIndex` einen Territoriumsnamen überhaupt
zurückgibt, hängt an ihrem Index: `avesmapsPlaceScopeLoadIndex` liest laut
`avesmapsPlaceScopeReadTerritoryNames` auch `political_territory.name`. **Vor dem
Festschreiben prüfen**, unter welchem Schlüssel (`settlements` oder `regions`) sie
dort landen:

```bash
grep -n "function avesmapsPlaceScopeLoadIndex" -A 40 api/_internal/wiki/place-scope.php
```

- [ ] **Schritt 2: Die Abfrage ergänzen**

Vierter Block in `avesmapsFetchOffmapSearchRows`:

```php
// Eigene Herrschaftsgebiete OHNE jede gezeichnete Flaeche -- weder selbst noch
// irgendwo im Unterbaum. Sprungziel ist das Elterngebiet (parent_id).
try {
    $statement = $pdo->query(
        "WITH RECURSIVE subtree AS (
            SELECT id AS root_id, id AS node_id FROM political_territory WHERE is_active = 1
            UNION ALL
            SELECT st.root_id, c.id
              FROM subtree st
              JOIN political_territory c ON c.parent_id = st.node_id AND c.is_active = 1
         )
         SELECT t.name, t.rank_label, t.wiki_url, p.name AS parent_name
           FROM political_territory t
           LEFT JOIN political_territory p ON p.id = t.parent_id AND p.is_active = 1
          WHERE t.is_active = 1 AND t.name IS NOT NULL AND t.name <> ''
            AND NOT EXISTS (
                SELECT 1 FROM subtree st
                  JOIN political_territory_geometry g
                    ON g.territory_id = st.node_id AND g.is_active = 1
                 WHERE st.root_id = t.id
            )"
    );
    foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
        $rows[] = [
            'title' => (string) ($row['name'] ?? ''),
            'type_label' => (string) ($row['rank_label'] ?? '') !== ''
                ? (string) $row['rank_label']
                : 'Herrschaftsgebiet',
            'place_raw' => (string) ($row['parent_name'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'kind' => 'territory',
        ];
    }
} catch (Throwable) {
}
```

💣 **Die Spaltennamen sind zu prüfen, bevor das übernommen wird** — `rank_label`
ist aus der Domänensprache geraten, nicht am Schema abgelesen:

```bash
grep -rn "CREATE TABLE IF NOT EXISTS political_territory " -A 40 --include=*.php api/
```

⚠️ **Der `NOT EXISTS`-Block ist die Umkehrung des bestehenden `JOIN`** aus
`avesmapsFetchPoliticalTerritorySearchRows` — dieselbe Rekursion, dieselbe
`is_active`-Bedingung. Weichen die beiden voneinander ab, erscheint ein Gebiet
entweder doppelt oder in keiner der beiden Quellen.

🪤 **Die bestehende Abfrage bleibt, wie sie ist.** Sie schließt geometrielose
Gebiete bewusst aus („nichts zum Anspringen") — dieses Feature fängt sie jetzt in
der neuen Quelle auf, statt die alte Regel aufzuweichen. Zwei Quellen mit klaren
Rollen sind besser als eine Abfrage mit einer Ausnahme.

- [ ] **Schritt 3: Wiki-Territorien ohne eigenen Knoten ergänzen**

Fünfter Block: Gebiete, die das Wiki kennt, für die es aber nicht einmal eine
Zeile in `political_territory` gibt.

```php
// Wiki-Territorien ohne eigenen Knoten. Der Elternschluessel ist ein wiki_key,
// kein Name -- deshalb der Selbst-Join auf dieselbe Tabelle, um den Namen zu holen.
try {
    $statement = $pdo->query(
        "SELECT m.title, m.wiki_url, p.title AS parent_title
           FROM wiki_territory_model m
           LEFT JOIN wiki_territory_model p ON p.wiki_key = m.parent_wiki_key
          WHERE NOT EXISTS (
                SELECT 1 FROM political_territory t
                 WHERE t.is_active = 1 AND t.wiki_key = m.wiki_key
          )"
    );
    foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
        $rows[] = [
            'title' => (string) ($row['title'] ?? ''),
            'type_label' => 'Herrschaftsgebiet',
            'place_raw' => (string) ($row['parent_title'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'kind' => 'territory',
        ];
    }
} catch (Throwable) {
}
```

💣 **Auch hier die Spalten prüfen** (`title`? `name`? gibt es `political_territory.wiki_key`?):

```bash
grep -rn "wiki_territory_model" -A 20 --include=*.php api/_internal/wiki/sync-monitor-model.php | head -40
```

💣 **`wiki_key` ist eine Falle mit eigener Geschichte** (AGENTS.md §5): die Faltung
ist eine feste Tabelle, keine Locale, und Umlaute fallen auf `'?'`. Ein Join über
`wiki_key` ist richtig — ein Join über den NAMEN wäre es nicht.

- [ ] **Schritt 4: Tests, Abnahme im Browser, Push, HALT**

Wie Task 6 — beide Testfelder, der Ablauf im Browser (ein Land suchen, klicken,
fliegen), dann Push und der Blick des Owners.

---

## Stufe 3 — Siedlungen

### Task 8: Das Sprungziel beim Dump mitschreiben

**Dateien:**
- Ändern: `api/_internal/wiki/settlements.php` (`avesmapsWikiSettlementEnsureSchema`)
- Ändern: `api/_internal/wiki/dump-entity-scan.php:660–680` (der `$record`)
- Ändern: der Upsert, der den Record schreibt
- Ändern: `api/_internal/app/offmap-search.php` (fünfter Abfrageblock)
- Test: `tools/wikidump/test-dump-entities.php` (erweitern)

- [ ] **Schritt 1: Die Spalte anlegen**

In `avesmapsWikiSettlementEnsureSchema` neben den bestehenden `$addColumn`-Zeilen:

```php
// Wo der Ort laut Infobox liegt („Region · Staat"). Der Dump rechnet den Wert
// laengst aus (avesmapsWikiSettlementParseInfobox liefert `lage`) und warf ihn
// beim Bauen des Records weg -- hier landet er, damit die Kartensuche einen Ort
// ohne Kartenobjekt zu seiner Region schicken kann, ohne das Wiki zu fragen.
$addColumn('lage', 'VARCHAR(300) NULL');
```

⚠️ **`ADD COLUMN` gehört NICHT in den Suchpfad.** `EnsureSchema` läuft nur im
Sync-Pfad; die Suche liest die Spalte mit einem `try/catch` und einem Rückfall
`'' AS lage`, damit eine Installation ohne Sync nicht ausfällt.

- [ ] **Schritt 2: Den fehlschlagenden Test schreiben**

In `tools/wikidump/test-dump-entities.php`: der Siedlungs-Handler muss `lage` im
Record führen, gefüllt aus der Infobox der Fixture.

⚠️ Die Fixture `mini-dump.xml` ist **geteilt**. Wer ihr eine Seite hinzufügt,
bricht `test-dump-reader.php`, das die Seitenzahl an sieben Stellen festschreibt
(AGENTS.md §9, zwei Deploys am 15.08.2026). **Also keine neue Seite** — eine
vorhandene Siedlungsseite mit Infobox verwenden.

- [ ] **Schritt 3: Den Record ergänzen**

In `dump-entity-scan.php` beim Zusammenbauen des `$record`:

```php
'lage' => mb_substr((string) ($infobox['lage'] ?? ''), 0, 300, 'UTF-8'),
```

Und im Upsert dieselbe Spalte mitschreiben.

- [ ] **Schritt 4: Die sechste Abfrage**

```php
// Siedlungen. `lage` ist die Spalte aus Schritt 1 -- sie fuellt sich erst mit dem
// naechsten Dump-Lauf; bis dahin ist sie leer und der Treffer sagt ehrlich
// „kein Ort auf der Karte".
//
// 💣 Der Rueckfall `'' AS lage` ist Pflicht, NICHT Vorsicht: EnsureSchema laeuft
// nur im Sync-Pfad, und ohne ihn wirft das SELECT -- der catch macht daraus eine
// leere Liste, und ALLE Siedlungen verschwinden lautlos aus der Suche.
$lageSpalte = 'lage';
try {
    $probe = $pdo->query("SELECT lage FROM wiki_sync_pages LIMIT 1");
    if ($probe === false) {
        $lageSpalte = "'' AS lage";
    }
} catch (Throwable) {
    $lageSpalte = "'' AS lage";
}

try {
    $statement = $pdo->query(
        "SELECT title, settlement_label, wiki_url, {$lageSpalte}
           FROM wiki_sync_pages
          WHERE settlement_class IS NOT NULL
            AND settlement_class <> ''
            AND settlement_class <> 'gebaeude'"
    );
    foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
        $rows[] = [
            'title' => (string) ($row['title'] ?? ''),
            'type_label' => (string) ($row['settlement_label'] ?? '') !== ''
                ? (string) $row['settlement_label']
                : 'Siedlung',
            'place_raw' => (string) ($row['lage'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'kind' => 'settlement',
        ];
    }
} catch (Throwable) {
}
```

⚠️ **Die Probe läuft EINMAL je Anfrage, nicht je Zeile** — und sie ist ein
`SELECT … LIMIT 1`, kein `information_schema`-Zugriff. Letzterer ist genau die
Last, die AGENTS.md §10 dem Pool-Vorfall zuschreibt.

💣 **`lage` ist `region · staat`, also unter Umständen ZWEI Namen.** Der
Scope-Index löst den ersten auf, der passt; wenn die Region nicht gezeichnet ist,
der Staat aber schon, soll der Staat gewinnen. Beim Bau prüfen, ob
`avesmapsPlaceScopeClassifyWithIndex` mit dem `·`-Trenner umgeht — wenn nicht, hier
am Trenner spalten und beide Hälften der Reihe nach anbieten. **Nicht** raten: der
Trenner wird in `avesmapsWikiSettlementParseInfobox` gesetzt (`settlements.php:621`).

- [ ] **Schritt 5: Tests, Sync, Abnahme, Push**

```bash
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
```

Danach: beide Testfelder komplett, Push — und **der Owner fährt einmal „Siedlungen
syncen"**, sonst bleibt `lage` leer und alle Siedlungen tragen „kein Ort auf der
Karte". Das ist kein Fehler, sondern die Reihenfolge (Entwurf §8).

- [ ] **Schritt 6: Den Entwurf schließen**

Die 🔧-Punkte in §8 abhaken oder mit dem gemessenen Stand ersetzen.

---

## Abweichung vom freigegebenen Mockup

⚠️ Das Mockup vom 20.08.2026 zeigte die neuen Treffer **ohne** Abschnittskopf,
direkt unter den Kartentreffern. Der Plan baut sie als **Sektion mit Kopf**
(„Nicht auf der Karte"), weil nur die Sektion den Deckel und die feste Position
am Ende mitbringt — ohne sie konkurrieren die Zeilen im Score-Sort und können über
einen Kartentreffer rutschen, was §2 ausschließt.

🔧 **Owner-Entscheid nötig, falls der Kopf stört:** ihn wegzulassen ist eine Zeile
im Client (`label` leer), der Deckel und die Position bleiben. Umgekehrt wäre der
Umbau teuer. Deshalb erst mit Kopf, dann sein Blick.
