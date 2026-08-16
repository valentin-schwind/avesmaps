# Verwaiste Außenhüllen — Bauplan

> **Für agentische Arbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Die Schritte tragen
> `- [ ]`-Kästchen zum Abhaken.

**Ziel:** Eine abgeleitete Außenhülle ohne jede Quellfläche ist im Editor anklickbar, steht im
Aufräumfenster und lässt sich dort endgültig entfernen.

**Ansatz:** Das Prädikat „Hülle ohne Quelle" wird **einmal** gerechnet (PHP-Bibliothek) und von
Scanner, Bulk-Knopf und Lösch-Weiche geteilt. Im Frontend liefert der Layer das Signal bereits mit
(`derived_source_geometry_public_ids`); es wird nur durchgereicht und entscheidet über
Interaktivität und Menüumfang. Kein neuer Kaskaden-Mechanismus — der vorhandene wird an die dritte
Löschstelle angeschlossen.

**Technik:** PHP 8 + PDO (MySQL live, SQLite in den Tests), Vanilla-JS ohne Build, Node für die
JS-Tests.

**Entwurf:** [`docs/superpowers/specs/2026-08-16-verwaiste-aussenhuellen-design.md`](../specs/2026-08-16-verwaiste-aussenhuellen-design.md)

## Globale Vorgaben

- **Sprache:** Kommentare, Commit-Betreffe und Doku auf **Deutsch** (AGENTS.md §8). `error.code`-Werte
  bleiben englisch.
- **Nur eigene Pfade stagen.** Der Arbeitsbaum wird geteilt — `git status` vor jedem Commit, niemals
  `git add -A`/`.`/`-a` (AGENTS.md §9).
- **Vor dem Push läuft das GANZE Testfeld**, nicht nur die eigenen Tests. Drei Läufe, siehe Aufgabe 8.
- **Sichtbare Änderungen gehen einzeln live.** Dieser Plan endet mit **einem** Push und dem Blick des
  Owners darauf — kein Bündel mit anderer Arbeit.
- 🔴 **Kennungen bleiben, Beschriftungen wandern.** `data-region-context-action="delete"`,
  `hard_delete_geometry`, `delete_derived_geometry` behalten ihre Namen.
- 💣 **Keine Zahl im Kommentar, die eine Liste behauptet.** Nicht „Verbraucher 1 von 3" schreiben —
  genau diese Zählweise hat die Querfeldein-Sperre zwei Erzeuger übersehen lassen (AGENTS.md §11).
- **Keine hartkodierten Farben/Radien** in neuem CSS; Token aus `css/base/tokens.css` (AGENTS.md §12).

---

### Aufgabe 1: Das geteilte Prädikat „Hülle ohne Quelle"

**Dateien:**
- Anlegen: `api/_internal/political/derived-orphans.php`
- Test: `api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php`

**Schnittstellen:**
- Nutzt: `avesmapsPoliticalFetchDerivedGeometrySourceTerritories(PDO): array` (Schlüssel =
  `territory_id`, Werte enthalten `parent_id`) aus `territories-derived-geometry-shared.php` ·
  `avesmapsPoliticalCollectDerivedGeometryDescendantIds(int, array): array` aus
  `territories-derived-geometry.php`
- Liefert:
  - `avesmapsPoliticalFetchTerritoryIdsWithActiveGeometry(PDO $pdo): array` — Menge als
    `[territoryId => true]`
  - `avesmapsPoliticalDerivedHullIsSourceless(int $territoryId, array $territories, array $withGeometry): bool`
  - `avesmapsPoliticalCollectSourcelessDerivedHulls(PDO $pdo): array` — Liste von Zeilen mit
    `derived_geometry_public_id`, `territory_public_id`, `territory_name`, `territory_type`,
    `territory_is_active`, `area`, `bbox`, `created_by`, `created_at`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Eine abgeleitete Aussenhuelle ohne jede Quellflaeche ist gezeichnet, aber unerreichbar.
 * Dieser Test haelt das Praedikat fest, das Scanner, Bulk-Knopf und Loesch-Weiche TEILEN.
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *     api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}

require_once __DIR__ . '/../territories-derived-geometry-shared.php';
require_once __DIR__ . '/../territories-derived-geometry.php';
require_once __DIR__ . '/../derived-orphans.php';

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE political_territory (
    id INTEGER PRIMARY KEY, public_id TEXT, wiki_id INTEGER, slug TEXT, name TEXT,
    short_name TEXT, type TEXT, parent_id INTEGER, continent TEXT, status TEXT,
    color TEXT, opacity REAL, is_active INTEGER, sort_order INTEGER,
    min_zoom INTEGER, max_zoom INTEGER, valid_from_bf INTEGER, valid_to_bf INTEGER
)');
$pdo->exec('CREATE TABLE political_territory_geometry (
    id INTEGER PRIMARY KEY, public_id TEXT, territory_id INTEGER, is_active INTEGER
)');
$pdo->exec('CREATE TABLE political_territory_derived_geometry (
    id INTEGER PRIMARY KEY, public_id TEXT, territory_id INTEGER, is_active INTEGER,
    min_x REAL, min_y REAL, max_x REAL, max_y REAL, created_by INTEGER, created_at TEXT
)');
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');

// 1 Geist: Huelle, kein Kind, keine eigene Flaeche.  (= "Neues Herrschaftsgebiet (1008)")
// 2 Blatt mit eigener Flaeche.                        (= Támenev)
// 3 Aggregat, dessen Flaeche beim KIND 4 liegt.       (= Grafschaft Winhall)
// 5 Huelle, deren Territorium geloescht wurde.        (dangling)
// 6 Blatt, dessen einzige Flaeche INAKTIV ist.        (= Geist auf dem zweiten Weg)
$pdo->exec("INSERT INTO political_territory (id, public_id, name, parent_id, is_active) VALUES
    (1, 'p-geist',  'Neues Herrschaftsgebiet (1008)', NULL, 1),
    (2, 'p-blatt',  'Támenev',                        NULL, 1),
    (3, 'p-aggr',   'Grafschaft Winhall',             NULL, 1),
    (4, 'p-kind',   'Reichsland Winhall',                3, 1),
    (6, 'p-inaktiv','Gebiet mit toter Flaeche',       NULL, 1)");
$pdo->exec("INSERT INTO political_territory_geometry (id, public_id, territory_id, is_active) VALUES
    (10, 'g-blatt', 2, 1),
    (11, 'g-kind',  4, 1),
    (12, 'g-tot',   6, 0)");
$pdo->exec("INSERT INTO political_territory_derived_geometry
    (id, public_id, territory_id, is_active, min_x, min_y, max_x, max_y, created_by, created_at) VALUES
    (20, 'd-geist',   1, 1, 139.3, 429.5, 203.4, 521.3, 7, '2026-08-04 10:00:00'),
    (21, 'd-blatt',   2, 1,   0.0,   0.0,  10.0,  10.0, 7, '2026-08-04 10:00:00'),
    (22, 'd-aggr',    3, 1,   0.0,   0.0,  20.0,  20.0, 7, '2026-08-04 10:00:00'),
    (23, 'd-dangling',5, 1,   0.0,   0.0,   5.0,   5.0, 7, '2026-08-04 10:00:00'),
    (24, 'd-inaktiv', 6, 1,   0.0,   0.0,   6.0,   6.0, 7, '2026-08-04 10:00:00'),
    (25, 'd-weg',     1, 0, 139.3, 429.5, 203.4, 521.3, 7, '2026-08-04 10:00:00')");
$pdo->exec("INSERT INTO users (id, username) VALUES (7, 'valentin')");

$territories  = avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo);
$withGeometry = avesmapsPoliticalFetchTerritoryIdsWithActiveGeometry($pdo);

$withKeys = array_keys($withGeometry);
sort($withKeys);
assert($withKeys === [2, 4], 'nur AKTIVE Flaechen aktiver Gebiete zaehlen');

assert(avesmapsPoliticalDerivedHullIsSourceless(1, $territories, $withGeometry) === true,
    'der Geist hat keine Quelle');
assert(avesmapsPoliticalDerivedHullIsSourceless(2, $territories, $withGeometry) === false,
    'ein Blatt mit eigener Flaeche ist keine Waise');
// 💣 Die Gegenprobe, an der die Rechnung haengt: das Aggregat hat SELBST keine Flaeche, seine
// Quelle liegt beim Kind. Wer nur das Gebiet fragt statt der Nachfahren, erklaert Winhall,
// Kosch und die Nordmarken zu Geistern -- live waeren das 111 von 114.
assert(avesmapsPoliticalDerivedHullIsSourceless(3, $territories, $withGeometry) === false,
    'ein Aggregat lebt von den Flaechen seiner Kinder');
assert(avesmapsPoliticalDerivedHullIsSourceless(5, $territories, $withGeometry) === true,
    'eine Huelle ohne Territorium ist erst recht verwaist');
assert(avesmapsPoliticalDerivedHullIsSourceless(6, $territories, $withGeometry) === true,
    'eine INAKTIVE Flaeche ist keine Quelle');

$hulls = avesmapsPoliticalCollectSourcelessDerivedHulls($pdo);
$ids = array_map(static fn(array $r): string => (string) $r['derived_geometry_public_id'], $hulls);
sort($ids);
assert($ids === ['d-dangling', 'd-geist', 'd-inaktiv'], 'genau die drei Waisen, in keiner Reihenfolge fixiert');
// 🔴 Eine bereits deaktivierte Huelle ist kein Fund -- sie zeichnet nichts und ist kein Befund.
assert(!in_array('d-weg', $ids, true), 'inaktive Huellen bleiben draussen');

$geist = null;
foreach ($hulls as $row) {
    if ((string) $row['derived_geometry_public_id'] === 'd-geist') { $geist = $row; }
}
assert(is_array($geist), 'der Geist ist dabei');
assert((string) $geist['territory_name'] === 'Neues Herrschaftsgebiet (1008)', 'mit seinem Namen');
assert((string) $geist['territory_public_id'] === 'p-geist', 'und seinem Gebiet');
assert((string) $geist['created_by'] === 'valentin', 'und dem Urheber aus users');
assert(abs((float) $geist['area'] - 5884.4) < 0.5, 'Flaeche = Breite x Hoehe der Bounding-Box (64,1 x 91,8)');

$dangling = null;
foreach ($hulls as $row) {
    if ((string) $row['derived_geometry_public_id'] === 'd-dangling') { $dangling = $row; }
}
assert((string) $dangling['territory_name'] === '(KEIN TERRITORIUM)',
    'dieselbe Beschriftung wie bei verwaisten Konturen -- eine Vokabel, nicht zwei');

echo "OK: verwaiste-aussenhuellen-test\n";
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
```

Erwartet: FEHLER `Failed to open stream ... derived-orphans.php` — die Datei gibt es noch nicht.

- [ ] **Schritt 3: Die Bibliothek schreiben**

`api/_internal/political/derived-orphans.php`:

```php
<?php

declare(strict_types=1);

/**
 * „Huelle ohne Quelle" -- EINE Rechnung, geteilt.
 *
 * 💣 Scanner (geometry_inventory), Bulk-Knopf (purge_unassigned_geometries) und die Hart/Weich-
 * Weiche beim Loeschen fragen ALLE hier. Drei Kopien derselben Regel driften auseinander, und
 * dann zeigt die Liste etwas anderes, als der Knopf loescht -- genau der Fehler, der diese
 * Baustelle ueberhaupt erzeugt hat (der Bulk-Knopf ging an der vorhandenen Ketten-Regel vorbei).
 *
 * 💣 Eine Huelle lebt von den Flaechen ihres GEBIETS UND SEINER NACHFAHREN. Wer nur das Gebiet
 * fragt, erklaert jedes Aggregat zum Geist: am Livebestand vom 16.08.2026 waren das 111 von 114.
 */

function avesmapsPoliticalFetchTerritoryIdsWithActiveGeometry(PDO $pdo): array {
    $statement = $pdo->query(
        'SELECT DISTINCT geometry.territory_id
        FROM political_territory_geometry geometry
        INNER JOIN political_territory territory ON territory.id = geometry.territory_id
        WHERE geometry.is_active = 1
            AND territory.is_active = 1'
    );
    if ($statement === false) {
        return [];
    }

    $ids = [];
    foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $territoryId) {
        $ids[(int) $territoryId] = true;
    }

    return $ids;
}

function avesmapsPoliticalDerivedHullIsSourceless(int $territoryId, array $territories, array $withGeometry): bool {
    if ($territoryId < 1 || !isset($territories[$territoryId])) {
        // Die Huelle zeigt auf kein Territorium mehr -- niemand kann sie je wieder erzeugen.
        return true;
    }
    if (isset($withGeometry[$territoryId])) {
        return false;
    }
    foreach (avesmapsPoliticalCollectDerivedGeometryDescendantIds($territoryId, $territories) as $descendantId) {
        if (isset($withGeometry[(int) $descendantId])) {
            return false;
        }
    }

    return true;
}

function avesmapsPoliticalCollectSourcelessDerivedHulls(PDO $pdo): array {
    $territories = avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo);
    $withGeometry = avesmapsPoliticalFetchTerritoryIdsWithActiveGeometry($pdo);

    $statement = $pdo->query(
        'SELECT
            derived.public_id,
            derived.territory_id,
            derived.min_x, derived.min_y, derived.max_x, derived.max_y,
            derived.created_at,
            cu.username AS created_by_username,
            territory.public_id AS territory_public_id,
            territory.name AS territory_name,
            territory.type AS territory_type,
            territory.is_active AS territory_is_active
        FROM political_territory_derived_geometry derived
        LEFT JOIN political_territory territory ON territory.id = derived.territory_id
        LEFT JOIN users cu ON cu.id = derived.created_by
        WHERE derived.is_active = 1'
    );
    if ($statement === false) {
        return [];
    }

    $hulls = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $territoryId = (int) ($row['territory_id'] ?? 0);
        if (!avesmapsPoliticalDerivedHullIsSourceless($territoryId, $territories, $withGeometry)) {
            continue;
        }

        $minX = (float) ($row['min_x'] ?? 0);
        $minY = (float) ($row['min_y'] ?? 0);
        $maxX = (float) ($row['max_x'] ?? 0);
        $maxY = (float) ($row['max_y'] ?? 0);
        $territoryName = trim((string) ($row['territory_name'] ?? ''));

        $hulls[] = [
            'derived_geometry_public_id' => (string) ($row['public_id'] ?? ''),
            'territory_public_id' => (string) ($row['territory_public_id'] ?? ''),
            // 🔴 Wortgleich mit dem Inventar der Konturen -- zwei Vokabeln fuer denselben Zustand
            // waeren zwei Zustaende fuer den Leser.
            'territory_name' => $territoryName !== '' ? $territoryName : '(KEIN TERRITORIUM)',
            'territory_type' => (string) ($row['territory_type'] ?? ''),
            'territory_is_active' => (int) ($row['territory_is_active'] ?? 0) === 1,
            'area' => round(max(0.0, $maxX - $minX) * max(0.0, $maxY - $minY), 1),
            'bbox' => [round($minX, 1), round($minY, 1), round($maxX, 1), round($maxY, 1)],
            'created_by' => (string) ($row['created_by_username'] ?? ''),
            'created_at' => (string) ($row['created_at'] ?? ''),
        ];
    }

    usort($hulls, static fn(array $a, array $b): int => $b['area'] <=> $a['area']);

    return $hulls;
}
```

- [ ] **Schritt 4: Test laufen lassen, grün sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
```

Erwartet: `OK: verwaiste-aussenhuellen-test`, Exit 0.

- [ ] **Schritt 5: Committen**

```bash
git status --short
git add api/_internal/political/derived-orphans.php api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
git commit -m "feat(politik): Praedikat 'Aussenhuelle ohne Quelle' -- eine Rechnung fuer drei Verbraucher"
```

---

### Aufgabe 2: Hart löschen, wenn nichts sie erzeugen kann

**Dateien:**
- Ändern: `api/_internal/political/territories-derived-geometry.php:395-415`
  (`avesmapsPoliticalDeleteDerivedGeometryForTerritory`)
- Test: `api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php` (anhängen)

**Schnittstellen:**
- Nutzt: `avesmapsPoliticalDerivedHullIsSourceless` aus Aufgabe 1
- Liefert: Rückgabe der Funktion um `'hard' => bool` erweitert; `deactivated`/`affected` bleiben

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

Vor `echo "OK: …"` einfügen:

```php
// ===== Die Hart/Weich-Weiche =====================================================================
// 🔴 Owner-Entscheid 16.08.2026: hart nur, wenn nichts mehr da ist, was die Huelle erzeugen koennte.
// Solange Quellen existieren, kann „Grenzen berechnen" sie jederzeit neu bauen -- dort ist die
// umkehrbare Deaktivierung der richtige Zustand.
$geistRow = ['id' => 1, 'public_id' => 'p-geist'];
$result = avesmapsPoliticalDeleteDerivedGeometryForTerritory($pdo, $geistRow, ['id' => 7]);
assert($result['hard'] === true, 'der Geist wird hart geloescht');
$rest = $pdo->query("SELECT COUNT(*) FROM political_territory_derived_geometry WHERE public_id = 'd-geist'")->fetchColumn();
assert((int) $rest === 0, 'und ist wirklich weg, nicht nur abgeschaltet');

$aggrRow = ['id' => 3, 'public_id' => 'p-aggr'];
$result = avesmapsPoliticalDeleteDerivedGeometryForTerritory($pdo, $aggrRow, ['id' => 7]);
assert($result['hard'] === false, 'ein Aggregat mit Kind-Flaechen wird nur deaktiviert');
$row = $pdo->query("SELECT is_active FROM political_territory_derived_geometry WHERE public_id = 'd-aggr'")->fetch(PDO::FETCH_ASSOC);
assert(is_array($row), 'die Zeile steht noch da');
assert((int) $row['is_active'] === 0, 'aber abgeschaltet -- "Grenzen berechnen" kann sie zurueckholen');
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
```

Erwartet: FEHLER bei `assert($result['hard'] === true …)` — der Schlüssel existiert nicht.

- [ ] **Schritt 3: Die Weiche einbauen**

In `territories-derived-geometry.php` oben bei den übrigen `require`-Zeilen ergänzen:

```php
require_once __DIR__ . '/derived-orphans.php';
```

`avesmapsPoliticalDeleteDerivedGeometryForTerritory` ersetzen durch:

```php
function avesmapsPoliticalDeleteDerivedGeometryForTerritory(PDO $pdo, array $territory, array $user): array {
    $territoryId = (int) $territory['id'];
    // 🔴 Owner-Entscheid 16.08.2026: hart nur, wenn nichts mehr da ist, was die Huelle erzeugen
    // koennte. ⚠️ Hart heisst ohne Rueckweg -- die Deaktivierung WAR das Sicherheitsnetz. Tragfaehig
    // ist das nur, weil es ausschliesslich Huellen trifft, die niemand mehr zurueckrechnen kann.
    // Diese Weiche ist die EINZIGE Stelle, an der darueber entschieden wird; sie darf nicht in die
    // Aufrufer kopiert werden.
    $sourceless = avesmapsPoliticalDerivedHullIsSourceless(
        $territoryId,
        avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo),
        avesmapsPoliticalFetchTerritoryIdsWithActiveGeometry($pdo)
    );

    if ($sourceless) {
        $statement = $pdo->prepare(
            'DELETE FROM political_territory_derived_geometry
            WHERE territory_id = :territory_id
                AND is_active = 1'
        );
        $statement->execute(['territory_id' => $territoryId]);
    } else {
        $statement = $pdo->prepare(
            'UPDATE political_territory_derived_geometry
            SET is_active = 0,
                updated_by = :updated_by
            WHERE territory_id = :territory_id
                AND is_active = 1'
        );
        $statement->execute([
            'territory_id' => $territoryId,
            'updated_by' => (int) ($user['id'] ?? 0) ?: null,
        ]);
    }

    return [
        'ok' => true,
        'territory_public_id' => (string) $territory['public_id'],
        'derived_geometry' => null,
        'deactivated' => true,
        'hard' => $sourceless,
        'affected' => $statement->rowCount(),
    ];
}
```

- [ ] **Schritt 4: Test laufen lassen, grün sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
```

Erwartet: `OK: verwaiste-aussenhuellen-test`, Exit 0.

- [ ] **Schritt 5: Committen**

```bash
git status --short
git add api/_internal/political/territories-derived-geometry.php api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
git commit -m "feat(politik): quellenlose Aussenhuelle wird hart geloescht, alles andere nur deaktiviert"
```

---

### Aufgabe 3: Der Aufräum-Scanner liefert die Hüllen mit

**Dateien:**
- Ändern: `api/_internal/political/territories-geometry-inventory.php:138-147` (Rückgabe)
- Test: `api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php` (anhängen)

**Schnittstellen:**
- Nutzt: `avesmapsPoliticalCollectSourcelessDerivedHulls` aus Aufgabe 1
- Liefert: `geometry_inventory` antwortet zusätzlich mit `derived_orphans` (Liste) und
  `derived_orphan_total` (int). Bestehende Schlüssel bleiben unangetastet.

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

⚠️ Die Weiche aus Aufgabe 2 hat `d-geist` bereits gelöscht — der Fixture-Stand ist ein anderer.
Deshalb wird die Zeile für diesen Abschnitt neu gesetzt:

```php
// ===== Der Scanner ===============================================================================
$pdo->exec("INSERT INTO political_territory_derived_geometry
    (id, public_id, territory_id, is_active, min_x, min_y, max_x, max_y, created_by, created_at) VALUES
    (26, 'd-geist2', 1, 1, 139.3, 429.5, 203.4, 521.3, 7, '2026-08-04 10:00:00')");

$inventar = avesmapsPoliticalReadGeometryInventory($pdo, ['include_inactive' => '1']);
assert(isset($inventar['derived_orphans']), 'das Inventar kennt jetzt die Huellen');
$namen = array_map(static fn(array $r): string => (string) $r['derived_geometry_public_id'], $inventar['derived_orphans']);
sort($namen);
assert($namen === ['d-dangling', 'd-geist2', 'd-inaktiv'], 'und zwar genau die verwaisten');
assert($inventar['derived_orphan_total'] === 3, 'die Zahl passt zur Liste');
// 🔴 Die vorhandenen Schluessel bleiben, sonst bricht das Fenster an anderer Stelle.
assert(isset($inventar['geometries'], $inventar['total'], $inventar['legacy_regions']),
    'das Konturen-Inventar ist unberuehrt');
// ⚠️ Fuer Huellen gibt es KEINEN Platzhalter-Filter: bei Konturen bleiben echte Papierkorb-Gebiete
// absichtlich draussen, eine Huelle ohne Quelle ist dagegen immer falsch -- egal wie sie heisst.
assert(in_array('d-inaktiv', $namen, true), 'auch ein benanntes Gebiet kommt in die Liste');
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
```

Erwartet: FEHLER `Call to undefined function avesmapsPoliticalReadGeometryInventory` (der `require`
fehlt) bzw. anschließend bei `assert(isset($inventar['derived_orphans']) …)`.

- [ ] **Schritt 3: Bibliothek einbinden und Inventar erweitern**

Im Test oben bei den `require`-Zeilen ergänzen:

```php
require_once __DIR__ . '/../territories-geometry-inventory.php';
```

In `territories-geometry-inventory.php` unter die vorhandenen Kopfzeilen:

```php
require_once __DIR__ . '/derived-orphans.php';
```

Und die Rückgabe erweitern:

```php
    // Abgeleitete Aussengrenzen ohne jede Quellflaeche. Sie liegen in einer ANDEREN Tabelle als die
    // Konturen oben, und genau deshalb hat der Scanner sie bis 16.08.2026 nie gesehen -- er hat sie
    // nicht uebersehen, er hat strukturell woanders hingeschaut.
    $derivedOrphans = avesmapsPoliticalCollectSourcelessDerivedHulls($pdo);

    return [
        'ok' => true,
        'total' => count($geometries),
        'by_source' => $bySource,
        'by_creator' => $byCreator,
        'geometries' => array_slice($geometries, 0, $limit),
        'derived_orphans' => array_slice($derivedOrphans, 0, $limit),
        'derived_orphan_total' => count($derivedOrphans),
        // Nicht-political Altlasten (map_features). Quelle/Urheber: alter Seed-Import, NICHT thomas/valentin.
        'legacy_region_total' => count($legacyRegions),
        'legacy_regions' => array_slice($legacyRegions, 0, $limit),
    ];
```

- [ ] **Schritt 4: Test laufen lassen, grün sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
```

Erwartet: `OK: verwaiste-aussenhuellen-test`, Exit 0.

- [ ] **Schritt 5: Committen**

```bash
git status --short
git add api/_internal/political/territories-geometry-inventory.php api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
git commit -m "feat(politik): Waisen-Scanner findet auch abgeleitete Aussengrenzen ohne Quelle"
```

---

### Aufgabe 4: Der Bulk-Knopf nimmt die Hüllen mit

**Dateien:**
- Ändern: `api/_internal/political/territories-geometry.php:1030-1046`
  (`avesmapsPoliticalPurgeUnassignedGeometries`)
- Test: `api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php` (anhängen)

**Schnittstellen:**
- Nutzt: `avesmapsPoliticalCollectSourcelessDerivedHulls`,
  `avesmapsPoliticalDeleteDerivedGeometryForTerritory` (Aufgaben 1 und 2)
- Liefert: Rückgabe um `'derived_candidates' => int` und `'derived_deleted' => int` erweitert;
  `candidates`/`deleted` behalten ihre Bedeutung (Konturen)

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

```php
// ===== Der Bulk-Knopf ============================================================================
// 💣 Das Loch, das diese Baustelle erzeugt hat: der Knopf setzte ein rohes DELETE auf die Konturen
// ab und rief die vorhandene Ketten-Deaktivierung NICHT. Zwei von drei Loeschwegen gebunden ist
// keine Regel -- die Huelle blieb stehen, und niemand kam mehr an sie heran.
$vorschau = avesmapsPoliticalPurgeUnassignedGeometries($pdo, [], ['id' => 7]);
assert($vorschau['dry_run'] === true, 'ohne confirm passiert nichts');
assert($vorschau['derived_candidates'] === 3, 'die Vorschau zaehlt die Huellen mit');
assert($vorschau['derived_deleted'] === 0, 'und loescht nichts');

$ergebnis = avesmapsPoliticalPurgeUnassignedGeometries($pdo, ['confirm' => 'apply'], ['id' => 7]);
assert($ergebnis['derived_deleted'] === 3, 'mit confirm fallen die drei Waisen');
assert(avesmapsPoliticalCollectSourcelessDerivedHulls($pdo) === [], 'keine verwaiste Huelle bleibt uebrig');
// 💣 Die Gegenprobe: der Knopf raeumt Waisen weg, NICHT den Bestand. d-blatt haengt an einer
// lebenden Quellflaeche und muss den Lauf ueberstehen -- ein Aufraeumer, der gesunde Huellen
// mitnimmt, waere schlimmer als der Zustand, den er beheben soll.
$blatt = $pdo->query("SELECT is_active FROM political_territory_derived_geometry WHERE public_id = 'd-blatt'")->fetch(PDO::FETCH_ASSOC);
assert(is_array($blatt) && (int) $blatt['is_active'] === 1, 'die Huelle mit Quelle steht unangetastet da');
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
```

Erwartet: FEHLER bei `assert($vorschau['derived_candidates'] === 3 …)` — der Schlüssel fehlt.

⚠️ Falls stattdessen `Call to undefined function` kommt: `require_once __DIR__ . '/../territories-geometry.php';`
zu den `require`-Zeilen des Tests ergänzen.

- [ ] **Schritt 3: Den Knopf an die Regel anschließen**

```php
function avesmapsPoliticalPurgeUnassignedGeometries(PDO $pdo, array $payload, array $user = []): array {
    $apply = (string) ($payload['confirm'] ?? '') === 'apply';
    // Verwaist/löschbar = (a) KEIN Territorium-Datensatz (territory_id NULL oder Gebiet geloescht)
    // ODER (b) "Neues Herrschaftsgebiet (N)"-Platzhalter (unbenannter Test-/Leichen-Müll).
    // Echte benannte Gebiete im Papierkorb (inaktiv, aber vorhanden) bleiben geschuetzt.
    $orphanWhere =
        "FROM political_territory_geometry g
         LEFT JOIN political_territory t ON t.id = g.territory_id
         WHERE t.id IS NULL OR t.name LIKE 'Neues Herrschaftsgebiet%'";
    $candidates = (int) ($pdo->query('SELECT COUNT(*) AS c ' . $orphanWhere)->fetch(PDO::FETCH_ASSOC)['c'] ?? 0);

    // 💣 Die Huellen MUESSEN hier mit. Sonst zaehlt die Kopfzeile des Fensters wieder mehr, als der
    // Knopf tut -- und genau dieses Auseinanderlaufen hat den Geist erzeugt: das rohe DELETE unten
    // nimmt einem Platzhalter die Quellflaeche weg und laesst seine Aussengrenze stehen.
    // ⚠️ Fuer Huellen gibt es KEINEN Platzhalter-Filter: eine Huelle ohne Quelle ist immer falsch.
    $derivedOrphans = avesmapsPoliticalCollectSourcelessDerivedHulls($pdo);

    if (!$apply) {
        return [
            'ok' => true,
            'dry_run' => true,
            'candidates' => $candidates,
            'deleted' => 0,
            'derived_candidates' => count($derivedOrphans),
            'derived_deleted' => 0,
        ];
    }

    $del = $pdo->prepare('DELETE g ' . $orphanWhere);
    $del->execute();

    // Nach dem DELETE rechnen: eine Kontur, die eben gefallen ist, macht ihre Huelle erst jetzt
    // quellenlos. Die Weiche in avesmapsPoliticalDeleteDerivedGeometryForTerritory entscheidet
    // hart/weich -- hier wird sie nicht nachgebaut.
    $derivedDeleted = 0;
    foreach (avesmapsPoliticalCollectSourcelessDerivedHulls($pdo) as $hull) {
        $territoryPublicId = (string) $hull['territory_public_id'];
        if ($territoryPublicId === '') {
            // Dangling: kein Territorium mehr da, also gibt es auch nichts aufzuloesen.
            $drop = $pdo->prepare('DELETE FROM political_territory_derived_geometry WHERE public_id = :public_id');
            $drop->execute(['public_id' => (string) $hull['derived_geometry_public_id']]);
            $derivedDeleted += $drop->rowCount();
            continue;
        }
        $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, avesmapsPoliticalReadPublicId($territoryPublicId));
        $result = avesmapsPoliticalDeleteDerivedGeometryForTerritory($pdo, $territory, $user);
        $derivedDeleted += (int) ($result['affected'] ?? 0);
    }

    return [
        'ok' => true,
        'dry_run' => false,
        'candidates' => $candidates,
        'deleted' => $del->rowCount(),
        'derived_candidates' => count($derivedOrphans),
        'derived_deleted' => $derivedDeleted,
    ];
}
```

⚠️ `territories-geometry.php` bindet `derived-orphans.php` noch nicht ein — `require_once __DIR__ . '/derived-orphans.php';`
zu den Kopfzeilen ergänzen, falls es dort nicht bereits über `territories-derived-geometry.php` ankommt.

- [ ] **Schritt 4: Test laufen lassen, grün sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
```

Erwartet: `OK: verwaiste-aussenhuellen-test`, Exit 0.

- [ ] **Schritt 5: Committen**

```bash
git status --short
git add api/_internal/political/territories-geometry.php api/_internal/political/__tests__/verwaiste-aussenhuellen-test.php
git commit -m "fix(politik): 'Alle endgueltig loeschen' nimmt die verwaisten Aussengrenzen mit"
```

---

### Aufgabe 5: Das Interaktiv-Prädikat im Frontend

**Dateien:**
- Anlegen: `js/map-features/map-features-region-interactivity.js`
- Ändern: `js/map-features/map-features-region-feature-normalization.js:70-72` (Feld ergänzen)
- Ändern: `js/map-features/map-features-region-rendering.js:454-458` (Ternär ersetzen)
- Ändern: `index.html` (Script-Tag vor `map-features-region-rendering.js`)
- Test: `js/map-features/__tests__/verwaiste-aussenhuelle-interaktiv.test.js`

**Schnittstellen:**
- Liefert: `avesmapsRegionDerivedIsSourceless(properties): boolean` ·
  `avesmapsRegionPolygonIsInteractive({ isEditMode, regionEntry, isAtActiveDisplayZoom, isAggregatedSourceFragment }): boolean`
- Setzt: `regionEntry.derivedIsSourceless` (bool) in der Normalisierung

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`js/map-features/__tests__/verwaiste-aussenhuelle-interaktiv.test.js`:

```js
const assert = require("assert");
const {
	avesmapsRegionDerivedIsSourceless,
	avesmapsRegionPolygonIsInteractive,
} = require("../map-features-region-interactivity.js");

// ---- das Signal --------------------------------------------------------------------------------
// 💣 Es kommt vom SERVER (derived_source_geometry_public_ids, in zwei Abfragen aufgeloest) und wird
// NICHT im Browser gezaehlt. „Im Layer liegt nur die Huelle" trifft bei Zoom 4 auf 114 Gebiete zu,
// und 111 davon sind kerngesund -- ihre Quellflaechen sind bei diesem Zoom nur nicht ausgeliefert.
assert.strictEqual(
	avesmapsRegionDerivedIsSourceless({ is_derived_geometry: true, derived_source_geometry_public_ids: [] }),
	true,
	"leere Quellenliste = Geist",
);
assert.strictEqual(
	avesmapsRegionDerivedIsSourceless({ is_derived_geometry: true, derived_source_geometry_public_ids: ["g-1"] }),
	false,
	"eine Quelle reicht",
);
assert.strictEqual(
	avesmapsRegionDerivedIsSourceless({ is_derived_geometry: false, derived_source_geometry_public_ids: [] }),
	false,
	"eine Quellflaeche ist nie eine verwaiste Huelle",
);
// ⚠️ Fehlt das Feld, ist das die Lage ZWISCHEN zwei Deploys -- dann lieber nichts freischalten als
// aus Versehen jede Huelle der Karte anklickbar machen.
assert.strictEqual(
	avesmapsRegionDerivedIsSourceless({ is_derived_geometry: true }),
	false,
	"kein Feld = keine Aussage = kein Geist",
);

// ---- die Entscheidung --------------------------------------------------------------------------
const geist = { isDerivedGeometry: true, derivedIsSourceless: true, source: "political_territory" };
const aggregat = { isDerivedGeometry: true, derivedIsSourceless: false, source: "political_territory" };
const quelle = { isDerivedGeometry: false, derivedIsSourceless: false, source: "political_territory" };

// Editor: Huellen bleiben inert, damit Klicks an die Quellgeometrien gehen -- sonst landet
// update_geometry auf einer Derived-ID. Fuer den Geist gilt der Grund nicht: da ist nichts zu treffen.
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: true, regionEntry: geist, isAtActiveDisplayZoom: true, isAggregatedSourceFragment: false }),
	true,
	"der Geist ist im Editor anklickbar",
);
// 💣 DIE GEGENPROBE, an der alles haengt: ohne sie kippen live 111 gesunde Aggregate mit und
// schlucken die Klicks ihrer Kinder (Discord #13, schon einmal bezahlt).
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: true, regionEntry: aggregat, isAtActiveDisplayZoom: true, isAggregatedSourceFragment: false }),
	false,
	"Kosch und Winhall bleiben inert",
);
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: true, regionEntry: quelle, isAtActiveDisplayZoom: false, isAggregatedSourceFragment: false }),
	true,
	"Quellflaechen sind im Editor zoomunabhaengig anklickbar (unveraendert)",
);

// Frontend: unveraendert -- Band + Herkunft entscheiden, der Geist bekommt keine Sonderrolle.
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: false, regionEntry: aggregat, isAtActiveDisplayZoom: true, isAggregatedSourceFragment: false }),
	true,
	"Huelle im Band ist im Frontend anklickbar",
);
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: false, regionEntry: aggregat, isAtActiveDisplayZoom: false, isAggregatedSourceFragment: false }),
	false,
	"ausserhalb des Bandes nicht",
);
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: false, regionEntry: quelle, isAtActiveDisplayZoom: true, isAggregatedSourceFragment: true }),
	false,
	"ein Aggregat-Fragment bleibt im Frontend stumm",
);
assert.strictEqual(
	avesmapsRegionPolygonIsInteractive({ isEditMode: false, regionEntry: { ...quelle, source: "ecosystem" }, isAtActiveDisplayZoom: true, isAggregatedSourceFragment: false }),
	false,
	"nur politische Flaechen",
);

console.log("OK: verwaiste-aussenhuelle-interaktiv");
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
node js/map-features/__tests__/verwaiste-aussenhuelle-interaktiv.test.js
```

Erwartet: `MODULE_NOT_FOUND` für `../map-features-region-interactivity.js`.

- [ ] **Schritt 3: Die Datei anlegen**

`js/map-features/map-features-region-interactivity.js`:

```js
// Wer darf einen Klick fangen? -- die Entscheidung fuer JEDES Regionspolygon an EINER Stelle.
//
// 🔴 Im Bearbeiten-Modus sind abgeleitete Huellen absichtlich inert: der Klick soll die
// Quellgeometrie treffen, sonst landet update_geometry auf einer Derived-ID und antwortet
// „Geometrie nicht gefunden". Die Regel setzt voraus, dass unter der Huelle eine Quelle LIEGT.
// Fuer eine Huelle ohne jede Quelle gilt der Grund nicht -- dort ist nichts zu treffen, und ohne
// Ausnahme waere das Gebiet ueberhaupt nicht mehr erreichbar (Owner 16.08.2026).
//
// 💣 „Hat Quellen?" kommt vom SERVER und wird nie im Browser gezaehlt. Der Layer liefert je Huelle
// derived_source_geometry_public_ids (zwei Abfragen, is_active auf Geometrie UND Territorium).
// Wer stattdessen im Payload nachsieht, ob eine Quellflaeche mitgeliefert wurde, verwechselt
// „hat keine" mit „bei diesem Zoom nicht dabei": am 16.08.2026 waren das 111 gesunde Aggregate
// von 114 -- Kosch, Weiden, Nordmarken.

function avesmapsRegionDerivedIsSourceless(properties) {
	if (!properties || properties.is_derived_geometry !== true) {
		return false;
	}
	// Fehlt das Feld, ist das die Lage zwischen zwei Deploys: keine Aussage, also kein Geist.
	if (!Array.isArray(properties.derived_source_geometry_public_ids)) {
		return false;
	}
	return properties.derived_source_geometry_public_ids.length === 0;
}

function avesmapsRegionPolygonIsInteractive({ isEditMode, regionEntry, isAtActiveDisplayZoom, isAggregatedSourceFragment }) {
	const entry = regionEntry || {};
	if (isEditMode) {
		return entry.isDerivedGeometry !== true || entry.derivedIsSourceless === true;
	}
	return entry.source === "political_territory"
		&& isAtActiveDisplayZoom === true
		&& (entry.isDerivedGeometry === true || isAggregatedSourceFragment !== true);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsRegionDerivedIsSourceless,
		avesmapsRegionPolygonIsInteractive,
	};
}
```

- [ ] **Schritt 4: Test laufen lassen, grün sehen**

```bash
node js/map-features/__tests__/verwaiste-aussenhuelle-interaktiv.test.js
```

Erwartet: `OK: verwaiste-aussenhuelle-interaktiv`, Exit 0.

- [ ] **Schritt 5: Feld durchreichen und Ternär ersetzen**

In `map-features-region-feature-normalization.js` direkt hinter `derivedHasOwnArea` (Zeile 72):

```js
		// Huelle ohne jede Quellflaeche -> im Editor ausnahmsweise anklickbar, sonst waere das
		// Gebiet gar nicht mehr erreichbar. Das Signal kommt vom Server, siehe
		// map-features-region-interactivity.js.
		derivedIsSourceless: avesmapsRegionDerivedIsSourceless(properties),
```

In `map-features-region-rendering.js` den `interactive`-Ausdruck (Zeilen 454-458) ersetzen durch:

```js
				interactive: avesmapsRegionPolygonIsInteractive({
					isEditMode: IS_EDIT_MODE,
					regionEntry,
					isAtActiveDisplayZoom,
					isAggregatedSourceFragment,
				}),
```

⚠️ Der Kommentarblock darüber (Zeilen 443-453) bleibt stehen — er begründet die Frontend-Hälfte und
gehört weiterhin an diese Stelle.

In `index.html` **vor** `map-features-region-feature-normalization.js` (Zeile 3213) einfügen:

```html
		<script src="js/map-features/map-features-region-interactivity.js"></script>
```

🔴 Die Reihenfolge ist ein Vertrag (AGENTS.md §3): die Normalisierung ruft
`avesmapsRegionDerivedIsSourceless` auf, die Datei muss vorher geladen sein. **Kein `?v=` von Hand**
— das setzt der Deploy.

- [ ] **Schritt 6: Das gesamte JS-Testfeld laufen lassen**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" || echo "ROT: $t"; done
```

Erwartet: keine `ROT:`-Zeile.

- [ ] **Schritt 7: Committen**

```bash
git status --short
git add js/map-features/map-features-region-interactivity.js js/map-features/map-features-region-feature-normalization.js js/map-features/map-features-region-rendering.js js/map-features/__tests__/verwaiste-aussenhuelle-interaktiv.test.js index.html
git commit -m "feat(politik): Aussenhuelle ohne Quelle ist im Editor anklickbar statt unerreichbar"
```

---

### Aufgabe 6: Rechtsklick-Menü und Linksklick-Hinweis

**Dateien:**
- Ändern: `js/map-features/map-features-region-interactivity.js` (Helfer ergänzen)
- Ändern: `js/map-features/map-features-region-context-menu.js:10-29` (`openRegionContextMenu`)
- Ändern: `js/map-features/map-features.js:522-528` (Linksklick-Hinweis)
- Test: `js/map-features/__tests__/verwaiste-aussenhuelle-interaktiv.test.js` (anhängen)

**Schnittstellen:**
- Liefert: `avesmapsRegionContextMenuPlan(regionEntry): { actions: string[], deleteLabel: string }` —
  `actions` = erlaubte `data-region-context-action`-Werte oder `null` für „alle wie bisher"

- [ ] **Schritt 1: Den fehlschlagenden Test anhängen**

Vor `console.log("OK: …")` einfügen:

```js
// ---- das Menue ---------------------------------------------------------------------------------
const { avesmapsRegionContextMenuPlan } = require("../map-features-region-interactivity.js");

const planGeist = avesmapsRegionContextMenuPlan(geist);
assert.deepStrictEqual(
	planGeist.actions,
	["edit-properties", "show-info", "delete"],
	"fuer einen Geist bleiben genau drei Eintraege -- alles andere gehoert einer Quellflaeche, die es nicht gibt",
);
assert.strictEqual(planGeist.deleteLabel, "Außenhülle löschen", "und der Loeschknopf sagt, was er loescht");

// 🔴 Der gesunde Pfad wird NICHT angefasst: ein Aggregat mit Quellen behaelt Menue und
// Beschriftung, wie sie waren. Die Ausnahme gilt dem Geist, nicht den Huellen ueberhaupt.
const planAggregat = avesmapsRegionContextMenuPlan(aggregat);
assert.strictEqual(planAggregat.actions, null, "ein gesundes Aggregat behaelt das volle Menue");
assert.strictEqual(planAggregat.deleteLabel, "Löschen", "und seine bisherige Beschriftung");

const planQuelle = avesmapsRegionContextMenuPlan(quelle);
assert.strictEqual(planQuelle.actions, null, "eine Quellflaeche ebenso");
assert.strictEqual(planQuelle.deleteLabel, "Löschen", "und behaelt ihre Beschriftung");
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
node js/map-features/__tests__/verwaiste-aussenhuelle-interaktiv.test.js
```

Erwartet: `TypeError: avesmapsRegionContextMenuPlan is not a function`.

- [ ] **Schritt 3: Den Helfer ergänzen**

In `map-features-region-interactivity.js` vor dem `module.exports`-Block:

```js
// Welche Eintraege des Rechtsklick-Menues ergeben fuer diese Flaeche Sinn?
// Bei einer Huelle ohne Quelle sind Grenzen bearbeiten, Verschieben, Zerschneiden, Vereinigen und
// die drei Ausschneiden-Varianten sinnlos: sie alle arbeiten auf einer Quellgeometrie, und genau
// die fehlt. Uebrig bleibt, was am GEBIET haengt -- plus das Loeschen der Huelle selbst.
const AVESMAPS_REGION_SOURCELESS_HULL_ACTIONS = ["edit-properties", "show-info", "delete"];

function avesmapsRegionContextMenuPlan(regionEntry) {
	const entry = regionEntry || {};
	const isSourceless = entry.isDerivedGeometry === true && entry.derivedIsSourceless === true;
	return {
		// null heisst ausdruecklich „alles wie bisher" -- eine leere Liste hiesse „nichts zeigen".
		actions: isSourceless ? AVESMAPS_REGION_SOURCELESS_HULL_ACTIONS.slice() : null,
		// 🔴 Nur der Geist bekommt eine eigene Beschriftung. Gesunde Huellen behalten „Löschen" --
		// ihr Pfad wird von dieser Baustelle nicht angefasst.
		deleteLabel: isSourceless ? "Außenhülle löschen" : "Löschen",
	};
}
```

Den Export ergänzen:

```js
	module.exports = {
		avesmapsRegionDerivedIsSourceless,
		avesmapsRegionPolygonIsInteractive,
		avesmapsRegionContextMenuPlan,
	};
```

- [ ] **Schritt 4: Test laufen lassen, grün sehen**

```bash
node js/map-features/__tests__/verwaiste-aussenhuelle-interaktiv.test.js
```

Erwartet: `OK: verwaiste-aussenhuelle-interaktiv`, Exit 0.

- [ ] **Schritt 5: Das Menü den Plan anwenden lassen**

In `map-features-region-context-menu.js` in `openRegionContextMenu` nach dem `extract`-Block
(Zeile 25) einfügen:

```js
	// 🔴 Beschriftungen wandern, KENNUNGEN bleiben: data-region-context-action="delete" ist der
	// Anker des Handlers weiter unten in dieser Datei.
	const menuPlan = avesmapsRegionContextMenuPlan(regionEntry);
	const deleteActionElement = menuElement.querySelector('[data-region-context-action="delete"]');
	if (deleteActionElement) {
		deleteActionElement.textContent = menuPlan.deleteLabel;
	}
	menuElement.querySelectorAll("[data-region-context-action]").forEach((item) => {
		const action = item.dataset.regionContextAction || "";
		if (menuPlan.actions === null) {
			// extract hat seine eigene Regel oben und wird hier nicht ueberstimmt.
			if (action !== "extract") item.hidden = false;
			return;
		}
		item.hidden = !menuPlan.actions.includes(action);
	});
```

- [ ] **Schritt 6: Den Linksklick-Hinweis richtigstellen**

In `map-features.js` den Block bei Zeile 522-528 ersetzen durch:

```js
		// Liefert der Resolver eine abgeleitete Außengrenze, liegt an dieser Stelle KEINE Quelle
		// darunter (sonst hätte er die Quelle bevorzugt). Abgeleitete Hüllen sind nicht editierbar
		// (sie werden aus den Unterflächen neu berechnet) -> Hinweis statt nutzloser Editor.
		if (selectedRegionEntry?.isDerivedGeometry === true) {
			// ⚠️ Hat die Hülle gar keine Quelle, ist „bitte das Unterreich anklicken" falsch: es gibt
			// keins. Dann ist der Rechtsklick der einzige Weg — und der Satz muss ihn nennen.
			showFeedbackToast(
				selectedRegionEntry.derivedIsSourceless === true
					? "Diese Außenhülle hat keine Quellfläche mehr. Rechtsklick → „Außenhülle löschen“."
					: "Das ist eine abgeleitete Außengrenze. Bitte die untergeordnete Geometrie (das Unterreich) anklicken.",
				"info"
			);
			return;
		}
```

- [ ] **Schritt 7: Das gesamte JS-Testfeld laufen lassen**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" || echo "ROT: $t"; done
```

Erwartet: keine `ROT:`-Zeile.

- [ ] **Schritt 8: Committen**

```bash
git status --short
git add js/map-features/map-features-region-interactivity.js js/map-features/map-features-region-context-menu.js js/map-features/map-features.js js/map-features/__tests__/verwaiste-aussenhuelle-interaktiv.test.js
git commit -m "ui(politik): Rechtsklick auf eine quellenlose Aussenhuelle bietet 'Aussenhuelle loeschen'"
```

---

### Aufgabe 7: Das Aufräumfenster zeigt die Hüllen

**Dateien:**
- Ändern: `html/wiki-sync-monitor.html:1554-1580` (`loadUnassignedGeoms`, `renderGeomModal`,
  `deleteGeom`)

**Schnittstellen:**
- Nutzt: `derived_orphans` / `derived_orphan_total` aus Aufgabe 3, `delete_derived_geometry`
  (Payload-Schlüssel `territory_public_id`), `purge_unassigned_geometries`

- [ ] **Schritt 1: Deckel heben und Hüllen einsammeln**

`loadUnassignedGeoms` ersetzen durch:

```js
async function loadUnassignedGeoms(){
  try{
    // 💣 &limit=2000 ist nicht Kosmetik. Der Server kappt bei 500, sortiert nach Flaeche absteigend,
    // und der Waisen-Filter laeuft ERST DANACH -- weil Waisen klein sind, fielen sie systematisch
    // hinten heraus: am 16.08.2026 standen 25 gezaehlt gegen 6 gezeigt, und es gab keinen Weg zu
    // den anderen 19.
    const r = await fetch('/api/app/political-territories.php?action=geometry_inventory&include_inactive=1&limit=2000&_='+Date.now(), {credentials:'include', cache:'no-store'});
    const d = await r.json();
    const isPlatzhalter = n => /^Neues Herrschaftsgebiet/i.test(String(n||''));
    const konturen = (d.geometries||[]).filter(g=>!g.territory_public_id || isPlatzhalter(g.territory_name));  // territoriumslos ODER „Neues Herrschaftsgebiet"-Platzhalter; echte Papierkorb-Gebiete bleiben draußen
    // ⚠️ Fuer Huellen gilt der Platzhalter-Filter NICHT: eine Aussengrenze ohne jede Quellflaeche
    // ist immer falsch, egal wie das Gebiet heisst. Der Server hat das schon entschieden.
    const huellen = (d.derived_orphans||[]).map(h=>Object.assign({}, h, {kind:'derived'}));
    unassignedGeoms = konturen.concat(huellen);
    unassignedDerivedCount = Number(d.derived_orphan_total)||0;
  }catch(e){ unassignedGeoms = []; unassignedDerivedCount = 0; }
  try{ const c = await geomApi('purge_unassigned_geometries', {}); unassignedGeomCount = ((c.candidates!=null) ? c.candidates : 0) + ((c.derived_candidates!=null) ? c.derived_candidates : unassignedDerivedCount); }
  catch(e){ unassignedGeomCount = unassignedGeoms.length; }
  render();
}
```

Die Variablendeklaration bei `unassignedGeomCount` um `unassignedDerivedCount` ergänzen (dieselbe
`let`-Zeile im Kopf des Skripts, gefunden mit `grep -n "unassignedGeomCount" html/wiki-sync-monitor.html`).

- [ ] **Schritt 2: Die Zeile für Hüllen rendern**

In `renderGeomModal` die `map`-Rückgabe ersetzen durch:

```js
  $('geomList').innerHTML = unassignedGeoms.map(g=>{
    const istHuelle = g.kind==='derived';
    const id=String(istHuelle ? (g.derived_geometry_public_id||'') : (g.geometry_public_id||g.public_id||''));
    const bb=Array.isArray(g.bbox)?g.bbox:[];
    const w=bb.length===4?Math.round(bb[2]-bb[0]):'?';
    const h=bb.length===4?Math.round(bb[3]-bb[1]):'?';
    const area=g.area!=null?Math.round(g.area):'?';
    const title=(g.label&&g.label.trim())?g.label.trim():((g.territory_name&&g.territory_name!=='(KEIN TERRITORIUM)')?g.territory_name:'(ohne Titel)');
    const by=g.created_by||'?'; const at=(g.created_at||'').slice(0,10);
    // Die Herkunftsspalte trägt bei Konturen die `source`, bei Hüllen das Wort dafür.
    const herkunft = istHuelle ? 'Außengrenze' : (g.source||'?');
    const ziel = istHuelle ? ` data-geomterr="${esc(String(g.territory_public_id||''))}"` : '';
    return `<div class="row"><span class="nm" title="${esc(id)}"><b>${esc(title)}</b> · ${esc(herkunft)} · ${w}×${h} · Fläche ${area} · ${esc(by)} ${esc(at)}</span> <button class="edbtn dt-geomdel" data-geomdel="${esc(id)}"${ziel} title="Endgültig löschen (${esc(id)})">🗑 endgültig löschen</button></div>`;
  }).join('') || '<div class="muted">— keine verwaisten Geometrien —</div>';
```

- [ ] **Schritt 3: Den Löschknopf verzweigen**

`deleteGeom` ersetzen und den Listen-Handler nachziehen:

```js
async function deleteGeom(id, territoryPublicId){
  if(!window.confirm('Diese Geometrie ENDGÜLTIG löschen? Das kann nicht rückgängig gemacht werden.')) return;
  busy(true);
  try{
    // Eine Hülle wird über ihr GEBIET adressiert (delete_derived_geometry nimmt territory_public_id);
    // ob hart oder nur abgeschaltet, entscheidet die Weiche auf dem Server — nicht dieser Knopf.
    const r = territoryPublicId
      ? await geomApi('delete_derived_geometry', {territory_public_id: territoryPublicId})
      : await geomApi('hard_delete_geometry', {geometry_public_id: id});
    setStatus(`Geometrie endgültig gelöscht (${r.deleted!=null ? r.deleted : (r.affected||0)}).`);
    await loadUnassignedGeoms(); renderGeomModal();
  }
  catch(e){ setStatus('Fehler: '+e.message); }
  busy(false);
}
```

```js
$('geomList').addEventListener('click', e=>{ const b=e.target.closest('[data-geomdel]'); if(b){ deleteGeom(b.dataset.geomdel, b.dataset.geomterr||''); } });
```

- [ ] **Schritt 4: Die Kopfzeile beide Arten nennen lassen**

In `renderGeomModal` die erste Zeile ersetzen durch:

```js
  $('geomSummary').textContent = `${unassignedGeomCount} verwaiste Kontur(en)/Außengrenze(n)${unassignedGeoms.length<unassignedGeomCount?` (${unassignedGeoms.length} gelistet)`:''} – gezeichnet, aber keinem Gebiet zugewiesen bzw. ohne jede Quellfläche. „Endgültig löschen" entfernt sie unwiderruflich. „Alle" entfernt alle ${unassignedGeomCount}.`;
```

- [ ] **Schritt 5: Von Hand prüfen**

Im Editor das Aufräumfenster öffnen. Erwartet: die Kopfzahl und die Listenlänge stimmen überein
(keine „(N gelistet)"-Klammer mehr), „Neues Herrschaftsgebiet (1008)" steht als **Außengrenze** in
der Liste, mit Fläche ≈ 5884.

⚠️ Falls die Klammer bleibt: `derived_orphan_total` > `limit`, oder der Deckel wirkt noch — dann
`?limit=2000` in der URL des Netzwerk-Requests prüfen.

- [ ] **Schritt 6: Committen**

```bash
git status --short
git add html/wiki-sync-monitor.html
git commit -m "ui(politik): Aufraeumfenster listet verwaiste Aussengrenzen und zeigt wieder alle Waisen"
```

---

### Aufgabe 8: Testfeld, Abnahme, Deploy

**Dateien:** keine

- [ ] **Schritt 1: Das GANZE JS-Testfeld**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" || echo "ROT: $t"; done
```

Erwartet: keine `ROT:`-Zeile.

- [ ] **Schritt 2: Das GANZE PHP-Testfeld, mit den Erweiterungen**

```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t" || echo "ROT: $t"; done
```

Erwartet: nur `linkcheck/link-url-test.php` rot (echter DNS-Abruf, vorbestehend, kein
Regressionssignal). ⚠️ Ohne `mbstring`/`pdo_sqlite`/`gd` melden 45 Tests rot, die alle nur die
Erweiterung vermissen.

- [ ] **Schritt 3: Die Tests, die das Muster oben NICHT findet**

```bash
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
```

Erwartet: keine `ROT:`-Zeile. 💣 Diese 21 Dateien stehen weder in einem `__tests__`-Verzeichnis noch
enden sie auf `-test.php` — sie haben am 15.08.2026 zwei Deploys gekostet.

- [ ] **Schritt 4: Pushen und den entfernten SHA prüfen**

```bash
git fetch origin && git rebase origin/master
git push origin master
git rev-parse HEAD && git rev-parse origin/master
```

Beide SHAs müssen gleich sein. Bei Ablehnung: erneut `fetch` + `rebase` — **niemals** force-push.

- [ ] **Schritt 5: Abnahme als ABLAUF, nach 1–2 Minuten Deploy-Wartezeit**

Nicht messen, sondern anfassen:

1. Editor öffnen, Politik-Ansicht, zur Inselgruppe (Hülle um lat 429–521 / lng 139–203).
2. **Rechtsklick auf die Fläche** → das Menü öffnet sich und zeigt genau drei Einträge, der untere
   heißt **„Außenhülle löschen"**.
3. Draufklicken, bestätigen → die Fläche verschwindet von der Karte.
4. Aufräumfenster öffnen → keine quellenlose Außengrenze mehr in der Liste, Kopfzahl und
   Listenlänge stimmen überein.
5. `https://avesmaps.de/?mapLayerMode=political` ohne `edit=1` an derselben Stelle → keine Fläche
   mehr, kein Klickziel mehr.

⚠️ Als offene Frage melden, was der Ablauf nicht beantworten kann: ob weitere Geister existieren,
die bei anderen Zoomstufen im Layer stehen. Der Scanner beantwortet das jetzt — seine Liste ist der
Beleg, nicht die Karte.

- [ ] **Schritt 6: Owner-Blick abwarten**

💣 Sichtbare Änderungen gehen EINZELN live und der Owner sieht jede (AGENTS.md §9). Dieser Push ist
ein Bündel aus sieben Commits, aber **eine** sichtbare Wirkung — nicht mit anderer Arbeit
zusammenlegen, und vor der nächsten Baustelle die Rückmeldung abwarten.
