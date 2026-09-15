<?php

declare(strict_types=1);

// ZUWEISEN HAEKT „WEGNAME ANZEIGEN" AN -- an jedem NEU zugewiesenen Abschnitt, in allen drei Zuweisern (Review I3, 15.09.2026).
// Bis dahin beschriftete die Karte jeden Wiki-Weg als Ganzes, ohne `show_label` zu lesen; seit das Haekchen auch dort wirkt, stuende ein
// frisch zugewiesener Weg sonst namenlos da. Owner-Regel „aus geht nur, wer abhakt": ein Abschnitt, der DENSELBEN Artikel schon traegt,
// behaelt sein Haekchen -- sonst haekte jede Wiederholung (Namen vereinheitlichen, Massenlauf) ein bewusstes „aus" wieder an.
// Entfernen (R2) aendert das Haekchen nicht.
// WIRKLICH GEFAHREN: avesmapsWikiPathAssignTo (mit und ohne public_ids), avesmapsWikiPathAssign, avesmapsWikiPathAssignAll,
// avesmapsWikiPathClearAssign gegen SQLite; dazu die reine Regel avesmapsWikiPathZuweisungHaektAn.
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/wiki/__tests__/zuweisen-haekt-wegname-an-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig\n");
    exit(2);
}

require __DIR__ . '/../sync.php';
require __DIR__ . '/../locations.php';
require_once __DIR__ . '/../paths.php';

// Dieselbe Uebersetzung MySQL -> SQLite wie wege-gruppe-wiki-public-ids-test.php (AGENTS.md §9: die Produktionsform bleibt).
final class AvesmapsZuweisenHaektTestPdo extends PDO {
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

$checks = 0;
$pruefe = static function (bool $bedingung, string $meldung) use (&$checks): void {
    $checks++;
    assert($bedingung, $meldung);
};

// ── 0. Die reine Regel ─────────────────────────────────────────────────────────────────────────────────────────────
$pruefe(function_exists('avesmapsWikiPathZuweisungHaektAn'), '0: die Regel avesmapsWikiPathZuweisungHaektAn fehlt');
if (function_exists('avesmapsWikiPathZuweisungHaektAn')) {
    $neu = ['wiki_path' => ['wiki_key' => 'b']];
    $pruefe(avesmapsWikiPathZuweisungHaektAn([], $neu)['show_label'] === true, '0a: ohne Zuweisung vorher: angehakt');
    $pruefe(avesmapsWikiPathZuweisungHaektAn(['wiki_path' => ['wiki_key' => 'a'], 'show_label' => false], $neu + ['show_label' => false])['show_label'] === true,
        '0b: ein ANDERER Artikel ist eine neue Zuweisung: angehakt');
    $pruefe(avesmapsWikiPathZuweisungHaektAn(['wiki_path' => ['wiki_key' => 'b'], 'show_label' => false], $neu + ['show_label' => false])['show_label'] === false,
        '0c: derselbe Artikel noch einmal: ein bewusstes „aus" bleibt aus');
    $pruefe(avesmapsWikiPathZuweisungHaektAn(['wiki_path' => 'kaputt'], $neu)['show_label'] === true, '0d: ein kaputtes Nest vorher zaehlt als keine Zuweisung');
}

$pdo = new AvesmapsZuweisenHaektTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
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
$pdo->exec("INSERT INTO wiki_path_staging (wiki_key, name, kind, art, continent, wiki_url, verlauf) VALUES
    ('alte-strasse', 'Alte Straße', 'strasse', 'Straße', 'Aventurien', 'https://de.wiki-aventurica.de/wiki/Alte_Stra%C3%9Fe', ''),
    ('bärenpfad', 'Bärenpfad', 'strasse', 'Pfad', 'Aventurien', 'https://de.wiki-aventurica.de/wiki/B%C3%A4renpfad', ''),
    ('hohlweg', 'Hohlweg', 'strasse', 'Weg', 'Aventurien', 'https://de.wiki-aventurica.de/wiki/Hohlweg', '')");

$weg = static function (string $publicId, string $name, array $properties) use ($pdo): void {
    $st = $pdo->prepare("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json)
                         VALUES (:id, :name, 'path', 'Strasse', 'LineString', '{}', :p)");
    $st->execute(['id' => $publicId, 'name' => $name, 'p' => json_encode($properties, JSON_UNESCAPED_UNICODE)]);
};
$haken = static function (string $publicId) use ($pdo) {
    $st = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = :id');
    $st->execute(['id' => $publicId]);
    return json_decode((string) $st->fetchColumn(), true)['show_label'] ?? null;
};
$ALTE = ['wiki_key' => 'alte-strasse', 'name' => 'Alte Straße'];

// ── 1. assign_to: neu zugewiesen -> an; derselbe Artikel an einem bewusst abgehakten Abschnitt -> bleibt aus ────────────
$weg('a-1', 'Alte Straße', ['name' => 'Alte Straße', 'show_label' => false]);
$weg('a-2', 'Alte Straße', ['name' => 'Alte Straße', 'wiki_path' => $ALTE, 'show_label' => false]);
$weg('a-3', 'Alte Straße', ['name' => 'Alte Straße']);
$zu = avesmapsWikiPathAssignTo($pdo, 'alte-strasse', 'a-1', false, 1, false, [], ['a-1', 'a-2', 'a-3']);
$pruefe(($zu['applied'] ?? 0) === 3, '1a: ' . json_encode($zu, JSON_UNESCAPED_UNICODE));
$pruefe($haken('a-1') === true, '1b: ein neu zugewiesener Abschnitt (vorher aus) ist nicht angehakt -- er stuende namenlos auf der Karte');
$pruefe($haken('a-3') === true, '1c: ein neu zugewiesener Abschnitt ohne Haekchen ist nicht angehakt');
$pruefe($haken('a-2') === false, '1d: ein Abschnitt, der den Artikel schon trug und bewusst abgehakt war, wurde wieder angehakt');
$antwortHaken = [];
foreach ($zu['segments_updated'] ?? [] as $eintrag) {
    $antwortHaken[$eintrag['public_id']] = $eintrag['show_label'] ?? 'fehlt';
}
ksort($antwortHaken);
$pruefe($antwortHaken === ['a-1' => true, 'a-2' => false, 'a-3' => true],
    '1e: segments_updated traegt den Stand des Haekchens nicht -- Kartendialog und Karte zoegen ihn erst beim Live-Abgleich nach: ' . json_encode($antwortHaken));

// ── 2. assign (Namen vereinheitlichen, Namens-Key UNION wiki_key) ─────────────────────────────────────────────────────
$weg('b-1', 'Bärenpfad', ['name' => 'Bärenpfad', 'show_label' => false]);
$weg('b-2', 'Bärenpfad', ['name' => 'Bärenpfad', 'wiki_path' => ['wiki_key' => 'bärenpfad', 'name' => 'Bärenpfad'], 'show_label' => false]);
$vereint = avesmapsWikiPathAssign($pdo, 'bärenpfad', false, 1);
$pruefe(($vereint['applied'] ?? 0) === 2, '2a: ' . json_encode($vereint, JSON_UNESCAPED_UNICODE));
$pruefe($haken('b-1') === true, '2b: „Namen vereinheitlichen" haekt einen neu zugewiesenen Abschnitt nicht an');
$pruefe($haken('b-2') === false, '2c: „Namen vereinheitlichen" haekt ein bewusstes „aus" am selben Artikel wieder an');

// ── 3. assign_all (Massenlauf nach Namen) ─────────────────────────────────────────────────────────────────────────────
$weg('h-1', 'Hohlweg', ['name' => 'Hohlweg', 'show_label' => false]);
$weg('h-2', 'Hohlweg', ['name' => 'Hohlweg', 'wiki_path' => ['wiki_key' => 'hohlweg', 'name' => 'Hohlweg'], 'show_label' => false]);
$masse = avesmapsWikiPathAssignAll($pdo, 'Aventurien', false);
$pruefe(($masse['applied'] ?? 0) >= 2, '3a: ' . json_encode($masse, JSON_UNESCAPED_UNICODE));
$pruefe($haken('h-1') === true, '3b: der Massenlauf haekt einen neu zugewiesenen Abschnitt nicht an');
$pruefe($haken('h-2') === false, '3c: der Massenlauf haekt ein bewusstes „aus" am selben Artikel wieder an -- jede Wiederholung');
$pruefe($haken('a-2') === false && $haken('b-2') === false, '3d: und auch keines aus den Laeufen davor');

// ── 4. Entfernen aendert das Haekchen nicht ───────────────────────────────────────────────────────────────────────────
$geloest = avesmapsWikiPathClearAssign($pdo, 'a-1', false, 1, false, ['a-1', 'a-2']);
$pruefe(($geloest['segments'] ?? 0) === 2, '4a: ' . json_encode($geloest, JSON_UNESCAPED_UNICODE));
$pruefe($haken('a-1') === true && $haken('a-2') === false, '4b: Entfernen hat das Haekchen veraendert');

echo "zuweisen-haekt-wegname-an: {$checks} Zusicherungen erfuellt\n";
