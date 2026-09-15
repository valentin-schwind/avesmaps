<?php

declare(strict_types=1);

// `assign_to` und `clear_assign` mit `public_ids`: die Weg-Ebene schreibt auf GENAU ihre Abschnitte
// (Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.6).
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/wiki/__tests__/wege-gruppe-wiki-public-ids-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig\n");
    exit(2);
}

require __DIR__ . '/../sync.php';
require __DIR__ . '/../locations.php';
require_once __DIR__ . '/../paths.php';

// Dieselbe Uebersetzung MySQL -> SQLite wie path-weitere-erhalten-test.php: die Ensure-DDL wird verschluckt, die
// information_schema-Probe antwortet mit einer Zeile. Die Produktionsabfragen bleiben unveraendert (AGENTS.md §9).
final class AvesmapsGruppeIdsTestPdo extends PDO {
    public function prepare(string $query, array $options = []): PDOStatement|false {
        $query = str_replace('FOR UPDATE', '', $query);
        $query = str_replace('NOW(3)', "datetime('now')", $query);
        if (stripos($query, 'information_schema') !== false) {
            return parent::prepare('SELECT 1');
        }
        return parent::prepare($query, $options);
    }
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false {
        if (stripos($query, 'information_schema') !== false) {
            return parent::query('SELECT 1');
        }
        return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$fetchModeArgs);
    }
    public function exec(string $statement): int|false {
        if (stripos($statement, 'CREATE TABLE IF NOT EXISTS') !== false || stripos($statement, 'ALTER TABLE') !== false) {
            return 0;
        }
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }
        return parent::exec($statement);
    }
}

$pdo = new AvesmapsGruppeIdsTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
    is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 1,
    updated_by INTEGER NULL, min_x REAL, min_y REAL, max_x REAL, max_y REAL)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('CREATE TABLE map_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
    actor_user_id INTEGER, before_json TEXT, after_json TEXT, created_at TEXT NULL)');
$pdo->exec('CREATE TABLE wiki_path_staging (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT, kind TEXT, art TEXT,
    continent TEXT, lage TEXT, lage_raw TEXT, laenge TEXT, verlauf TEXT, description TEXT, synonyms_json TEXT,
    image_url TEXT, image_license_status TEXT, wiki_url TEXT, synced_at TEXT)');
$pdo->exec("INSERT INTO wiki_path_staging (wiki_key, name, kind, art, wiki_url, verlauf)
            VALUES ('alte-strasse', 'Alte Straße', 'strasse', 'Straße', 'https://de.wiki-aventurica.de/wiki/Alte_Stra%C3%9Fe', '')");

$weg = static function (string $publicId, string $name, string $subtype, array $properties) use ($pdo): void {
    $st = $pdo->prepare("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json)
                         VALUES (:id, :name, 'path', :sub, 'LineString', '{}', :p)");
    $st->execute(['id' => $publicId, 'name' => $name, 'sub' => $subtype, 'p' => json_encode($properties, JSON_UNESCAPED_UNICODE)]);
};
$props = static function (string $publicId) use ($pdo): array {
    $st = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = :id');
    $st->execute(['id' => $publicId]);
    return json_decode((string) $st->fetchColumn(), true);
};

$weg('g-1', 'Alte Straße', 'Strasse', ['name' => 'Alte Straße']);
$weg('g-2', 'Alte Straße', 'Strasse', ['name' => 'Alte Straße',
    'wiki_path_weitere' => [['wiki_key' => 'alte-strasse', 'name' => 'Alte Straße', 'wiki_url' => '', 'art' => '', 'kind' => 'strasse']]]);
$weg('fremd', 'Alte Straße', 'Strasse', ['name' => 'Alte Straße']);
$weg('f-1', 'Grauer Fluss', 'Flussweg', ['name' => 'Grauer Fluss']);

// 1. Ohne public_ids unveraendert: der Namens-Match erfasst auch den gleichnamigen FREMDEN Weg (Trockenlauf)
$trocken = avesmapsWikiPathAssignTo($pdo, 'alte-strasse', 'g-1', true, 1);
assert($trocken['segments'] === 3, 'Voraussetzung: ohne public_ids zaehlen g-1, g-2 UND fremd: ' . json_encode($trocken));

// 2. Mit public_ids: GENAU diese Abschnitte
$echt = avesmapsWikiPathAssignTo($pdo, 'alte-strasse', 'g-1', false, 1, false, [], ['g-1', 'g-2']);
assert($echt['type_ok'] === true && $echt['applied'] === 2, json_encode($echt));
$geschrieben = array_column($echt['segments_updated'], 'public_id');
sort($geschrieben);
assert($geschrieben === ['g-1', 'g-2'], json_encode($geschrieben));
assert(($props('g-1')['wiki_path']['wiki_key'] ?? '') === 'alte-strasse');
assert(!array_key_exists('wiki_path', $props('fremd')), 'der gleichnamige fremde Weg bleibt unberuehrt');
assert(($props('g-2')['wiki_path_weitere'] ?? null) === [], 'der Riegel OhneHaupt gilt auch mit public_ids -- und laesst [] stehen (§9.2)');

// 3. Loesen mit public_ids: nur diese, jeder mit eigenem generischem Namen (R2); der fremde Weg behaelt seine Zuweisung
$pdo->exec("UPDATE map_features SET properties_json = '" . json_encode(
    ['name' => 'Alte Straße', 'wiki_path' => ['wiki_key' => 'alte-strasse', 'name' => 'Alte Straße']], JSON_UNESCAPED_UNICODE
) . "' WHERE public_id = 'fremd'");
$geloest = avesmapsWikiPathClearAssign($pdo, 'g-1', false, 1, false, ['g-1', 'g-2']);
assert($geloest['segments'] === 2 && $geloest['applied'] === 2, json_encode($geloest));
assert(!array_key_exists('wiki_path', $props('g-1')) && !array_key_exists('wiki_path', $props('g-2')));
assert(($props('fremd')['wiki_path']['wiki_key'] ?? '') === 'alte-strasse',
    'ohne public_ids haette Namens-Key UNION wiki_key den fremden Weg mitgeloest');
$namen = array_column($geloest['segments_updated'], 'name');
assert(count(array_unique($namen)) === 2 && !in_array('Alte Straße', $namen, true),
    'R2: jeder Abschnitt bekommt einen EIGENEN generischen Namen: ' . json_encode($namen, JSON_UNESCAPED_UNICODE));

// 4. Typriegel ueber JEDEN Zielweg: ein Flussweg in der Liste -> nichts geschrieben
$vorher = $props('g-1');
$typ = avesmapsWikiPathAssignTo($pdo, 'alte-strasse', 'g-1', false, 1, false, [], ['g-1', 'f-1']);
assert($typ['type_ok'] === false && $typ['applied'] === 0, json_encode($typ));
assert($props('g-1') === $vorher, 'passt ein Abschnitt nicht, bleibt auch der passende unberuehrt');

// 5. Ablehnungen
foreach ([
    'assign: single_segment und public_ids' => static fn() => avesmapsWikiPathAssignTo($pdo, 'alte-strasse', 'g-1', true, 1, true, [], ['g-1', 'g-2']),
    'assign: Anker nicht in public_ids' => static fn() => avesmapsWikiPathAssignTo($pdo, 'alte-strasse', 'fremd', true, 1, false, [], ['g-1', 'g-2']),
    'clear: single_segment und public_ids' => static fn() => avesmapsWikiPathClearAssign($pdo, 'g-1', true, 1, true, ['g-1']),
    'clear: Anker nicht in public_ids' => static fn() => avesmapsWikiPathClearAssign($pdo, 'fremd', true, 1, false, ['g-1']),
] as $fall => $aufruf) {
    $geworfen = false;
    try {
        $aufruf();
    } catch (RuntimeException) {
        $geworfen = true;
    }
    assert($geworfen, $fall . ' muss abgelehnt werden');
}

// 6. Der Rumpf-Leser des Endpunkts
assert(avesmapsWikiPathGruppenIdsAusRumpf(['public_id' => 'g-1']) === null, 'ohne public_ids: bisheriges Verhalten');
assert(avesmapsWikiPathGruppenIdsAusRumpf(['public_ids' => ['g-1', ' g-1 ', 'g-2']]) === ['g-1', 'g-2']);
foreach ([[], 'g-1', null, array_map(static fn(int $i): string => 'id' . $i, range(1, 251))] as $falsch) {
    $geworfen = false;
    try {
        avesmapsWikiPathGruppenIdsAusRumpf(['public_ids' => $falsch]);
    } catch (RuntimeException) {
        $geworfen = true;
    }
    assert($geworfen, 'ungueltige public_ids muessen abgelehnt werden');
}

// 7. Der Endpunkt reicht die Angabe an BEIDE Aktionen durch, die Rechte bleiben `review` (Nachtrag §9.7)
$endpunkt = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../../../edit/wiki/paths.php')) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $endpunkt .= is_array($token) ? $token[1] : $token;
}
$arm = static function (string $von, string $bis) use ($endpunkt): string {
    $a = strpos($endpunkt, $von);
    $b = $a === false ? false : strpos($endpunkt, $bis, $a);
    assert($a !== false && $b !== false, "Arm $von nicht gefunden");
    return substr($endpunkt, $a, $b - $a);
};
assert(str_contains($arm("'clear_assign' =>", "'assign_all' =>"), 'avesmapsWikiPathGruppenIdsAusRumpf($payload)'), 'clear_assign bekommt public_ids');
assert(str_contains($arm("'assign_to' =>", "'backfill_verlauf_source' =>"), 'avesmapsWikiPathGruppenIdsAusRumpf($payload)'), 'assign_to bekommt public_ids');
assert(str_contains($endpunkt, "avesmapsRequireUserWithCapability('review')"), 'die Fähigkeit bleibt review (E12)');

// 8. Der geteilte Leser beider Funktionen: Riegel und IN-Abfrage stehen an EINER Stelle, nicht je Funktion.
// Er normalisiert selbst (ein PHP-Aufrufer muss nicht durch den Rumpf-Leser) und liefert nur aktive, benannte Wege.
$pdo->exec("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json, is_active)
            VALUES ('alt', 'Alte Straße', 'path', 'Strasse', 'LineString', '{}', '{}', 0)");
$pdo->exec("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json)
            VALUES ('ohne-name', '', 'path', 'Strasse', 'LineString', '{}', '{}')");
$pdo->exec("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json)
            VALUES ('ort', 'Alte Straße', 'location', 'dorf', 'Point', '{}', '{}')");
$zeilen = avesmapsWikiPathGruppenZeilen($pdo, [' g-2 ', 'g-1', 'g-2', 'alt', 'ohne-name', 'ort', 'fehlt'], 'g-1', false);
$gelesen = array_column($zeilen, 'public_id');
sort($gelesen);
assert($gelesen === ['g-1', 'g-2'], 'normalisiert, nur aktive benannte Wege: ' . json_encode($gelesen));
foreach (['id', 'public_id', 'name', 'feature_subtype', 'properties_json'] as $spalte) {
    assert(array_key_exists($spalte, $zeilen[0]), "beide Aufrufer brauchen die Spalte $spalte");
}
foreach ([
    'single_segment' => static fn() => avesmapsWikiPathGruppenZeilen($pdo, ['g-1'], 'g-1', true),
    'Anker nicht in der Liste' => static fn() => avesmapsWikiPathGruppenZeilen($pdo, ['g-2'], 'g-1', false),
    'leere Liste' => static fn() => avesmapsWikiPathGruppenZeilen($pdo, [], 'g-1', false),
    'nur Leerzeichen' => static fn() => avesmapsWikiPathGruppenZeilen($pdo, ['  '], 'g-1', false),
    'ueber dem Deckel' => static fn() => avesmapsWikiPathGruppenZeilen(
        $pdo, array_map(static fn(int $i): string => 'id' . $i, range(1, AVESMAPS_WIKI_PATH_WEITERE_MAX_SEGMENTE + 1)), 'id1', false
    ),
] as $fall => $aufruf) {
    $geworfen = false;
    try {
        $aufruf();
    } catch (RuntimeException) {
        $geworfen = true;
    }
    assert($geworfen, 'Leser: ' . $fall . ' muss abgelehnt werden');
}

// 9. Mit public_ids entscheidet die LISTE, nicht der Name: ein Abschnitt der Strasse mit abweichendem Namen wird
// mitgeschrieben und mitgeloest. Die Abschnitte oben heissen alle gleich und sehen die zwei Wachen
// `$publicIds === null && …` in den Schleifen deshalb nicht -- ohne sie fiele dieser Abschnitt still heraus.
$weg('g-3', 'Nebenweg', 'Strasse', ['name' => 'Nebenweg']);
$mitAbweichung = avesmapsWikiPathAssignTo($pdo, 'alte-strasse', 'g-1', false, 1, false, [], ['g-1', 'g-3']);
assert($mitAbweichung['segments'] === 2 && $mitAbweichung['applied'] === 2, 'zuweisen: ' . json_encode($mitAbweichung));
assert(($props('g-3')['wiki_path']['wiki_key'] ?? '') === 'alte-strasse', 'der abweichend benannte Abschnitt ist zugewiesen');
$pdo->exec("UPDATE map_features SET name = 'Nebenweg', properties_json = '{\"name\":\"Nebenweg\"}' WHERE public_id = 'g-3'");
$loesenMitAbweichung = avesmapsWikiPathClearAssign($pdo, 'g-1', true, 1, false, ['g-1', 'g-3']);
assert($loesenMitAbweichung['segments'] === 2, 'loesen: ' . json_encode($loesenMitAbweichung));

echo "wege-gruppe-wiki-public-ids-test.php: ok\n";
