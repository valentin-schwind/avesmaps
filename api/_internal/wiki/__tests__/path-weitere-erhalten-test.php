<?php

declare(strict_types=1);

// Die bestehenden Zuweiser erhalten die weiteren Zuweisungen (Entwurf 2026-09-14 §2.2 Nr. 5, 6).
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/wiki/__tests__/path-weitere-erhalten-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig\n");
    exit(2);
}

require __DIR__ . '/../sync.php';
require __DIR__ . '/../locations.php';
require_once __DIR__ . '/../paths.php';

// MySQL -> SQLite. Zusaetzlich zum Muster aus wikisync-fall-no-article-test.php:
// avesmapsWikiPathEnsureTables fuehrt MySQL-DDL und zwei information_schema-Proben aus. Die Tabellen
// legt dieser Test selbst an; die DDL wird verschluckt, die Probe antwortet mit einer Zeile
// (dann laeuft kein ALTER).
final class AvesmapsWeitereErhaltenPdo extends PDO {
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

$pdo = new AvesmapsWeitereErhaltenPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
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
            VALUES ('b-renpfad', 'Bärenpfad', 'strasse', 'Pilgerweg', 'https://de.wiki-aventurica.de/wiki/B%C3%A4renpfad', '')");

$pdo->exec("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json)
            VALUES ('rs-7', 'Reichsstraße 2', 'path', 'Reichsstrasse', 'LineString', '{}',
            '" . json_encode([
                'name' => 'Reichsstraße 2',
                'wiki_path' => ['wiki_key' => 'reichsstrasse-2', 'name' => 'Reichsstraße 2'],
                'wiki_path_weitere' => [
                    ['wiki_key' => 'b-renpfad', 'name' => 'Bärenpfad', 'wiki_url' => '', 'art' => 'Pilgerweg', 'kind' => 'strasse'],
                    ['wiki_key' => 'geronsgang', 'name' => 'Geronsgang', 'wiki_url' => '', 'art' => 'Pilgerweg', 'kind' => 'strasse'],
                ],
            ], JSON_UNESCAPED_UNICODE) . "')");
$props = static function () use ($pdo): array {
    return json_decode((string) $pdo->query("SELECT properties_json FROM map_features WHERE public_id = 'rs-7'")->fetchColumn(), true);
};

// 1. Loesen: die Hauptzuweisung geht, die weiteren bleiben (§2.2 Nr. 5)
avesmapsWikiPathClearAssign($pdo, 'rs-7', false, 1, true);
assert(!array_key_exists('wiki_path', $props()), 'die Hauptzuweisung ist geloest');
assert(array_column($props()['wiki_path_weitere'], 'wiki_key') === ['b-renpfad', 'geronsgang'], 'die weiteren bleiben stehen');

// 2. Zuweisen eines Artikels, der schon als weitere dastand: er faellt aus der Liste, der Rest bleibt
avesmapsWikiPathAssignTo($pdo, 'b-renpfad', 'rs-7', false, 1, true);
assert(($props()['wiki_path']['wiki_key'] ?? '') === 'b-renpfad');
assert(array_column($props()['wiki_path_weitere'], 'wiki_key') === ['geronsgang'],
    'der neue Hauptartikel steht nicht zugleich als weitere da: ' . json_encode($props()['wiki_path_weitere'] ?? null));

// 3. Jeder Zuweiser in paths.php ruft den Riegel (Tokenizer, Kommentare zaehlen nicht)
$quelle = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../paths.php')) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $quelle .= is_array($token) ? $token[1] : $token;
}
$zuweiser = preg_match_all("/\\\$props\['wiki_path'\]\s*=\s*[^;]+;/", $quelle);
$riegel = substr_count($quelle, '$props = avesmapsWikiPathWeitereOhneHaupt($props);');
assert($zuweiser >= 3, 'die Zaehlung findet die Zuweiser nicht mehr');
assert($riegel === $zuweiser, "jeder Zuweiser braucht den Riegel: $zuweiser Zuweiser, $riegel Riegel");
assert(str_contains($quelle, "require_once __DIR__ . '/path-weitere.php';"));

echo "path-weitere-erhalten-test.php: ok\n";
