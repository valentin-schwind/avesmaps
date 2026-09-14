<?php

declare(strict_types=1);

// Der Schreibweg der weiteren Wiki-Zuweisungen gegen SQLite (Entwurf 2026-09-14 §2.3).
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/wiki/__tests__/path-weitere-schreiben-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig\n");
    exit(2);
}

require __DIR__ . '/../sync.php';
require __DIR__ . '/../locations.php';
require_once __DIR__ . '/../paths.php';
require_once __DIR__ . '/../path-weitere.php';

// Dieselbe Uebersetzung MySQL -> SQLite wie api/_internal/wiki/__tests__/wikisync-fall-no-article-test.php.
// Zusaetzlich (Review-Fix Runde 1): avesmapsWikiPathEnsureTables() ruft reines MySQL-DDL
// (CREATE TABLE IF NOT EXISTS/ALTER TABLE, information_schema-Sonden), das SQLite nicht kennt --
// die Testtabellen stehen unten schon von Hand, das Ensure-DDL wird darum HIER geschluckt statt
// nachgebaut. Dieselbe Rezeptur wie im geplanten Task-4-Test path-weitere-erhalten-test.php.
final class AvesmapsWeitereTestPdo extends PDO {
    private int $takt = 0;
    public ?int $ensureAb = null;
    public ?int $stagingSelectAb = null;

    public function prepare(string $query, array $options = []): PDOStatement|false {
        $this->takt++;
        if ($this->stagingSelectAb === null && str_contains($query, 'FROM wiki_path_staging') && str_contains($query, 'wiki_key')) {
            $this->stagingSelectAb = $this->takt;
        }
        $query = str_replace('FOR UPDATE', '', $query);
        $query = str_replace('NOW(3)', "datetime('now')", $query);
        return parent::prepare($query, $options);
    }
    public function exec(string $statement): int|false {
        $this->takt++;
        $getrimmt = ltrim($statement);
        if (str_starts_with($getrimmt, 'CREATE TABLE IF NOT EXISTS') || str_starts_with($getrimmt, 'ALTER TABLE')) {
            // MySQL-eigenes Ensure-DDL aus avesmapsWikiPathEnsureTables -- geschluckt, nur vermerkt.
            $this->ensureAb ??= $this->takt;
            return 0;
        }
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }
        return parent::exec($statement);
    }
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false {
        $this->takt++;
        if (str_contains($query, 'information_schema')) {
            $this->ensureAb ??= $this->takt;
            return parent::query('SELECT 1');
        }
        return parent::query($query, $fetchMode, ...$fetchModeArgs);
    }
}

$pdo = new AvesmapsWeitereTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
    is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 1,
    updated_by INTEGER NULL, min_x REAL, min_y REAL, max_x REAL, max_y REAL)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('CREATE TABLE map_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
    actor_user_id INTEGER, before_json TEXT, after_json TEXT, created_at TEXT NULL)');
$pdo->exec('CREATE TABLE wiki_path_staging (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT, kind TEXT, art TEXT, wiki_url TEXT)');
$pdo->exec("INSERT INTO wiki_path_staging (wiki_key, name, kind, art, wiki_url)
            VALUES ('b-renpfad', 'Bärenpfad', 'strasse', 'Pilgerweg', 'https://de.wiki-aventurica.de/wiki/B%C3%A4renpfad')");

$weg = static function (string $publicId, array $properties) use ($pdo): void {
    $st = $pdo->prepare("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json)
                         VALUES (:id, :name, 'path', 'Reichsstrasse', 'LineString', '{}', :p)");
    $st->execute(['id' => $publicId, 'name' => (string) ($properties['name'] ?? ''), 'p' => json_encode($properties, JSON_UNESCAPED_UNICODE)]);
};
$props = static function (string $publicId) use ($pdo): array {
    $st = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = :id');
    $st->execute(['id' => $publicId]);
    return json_decode((string) $st->fetchColumn(), true);
};
$audits = static fn(): int => (int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();

$haupt = ['wiki_key' => 'reichsstrasse-2', 'name' => 'Reichsstraße 2'];
$weg('rs-6', ['name' => 'Reichsstraße 2', 'wiki_path' => $haupt]);
$weg('rs-7', ['name' => 'Reichsstraße 2', 'wiki_path' => $haupt]);
$weg('ohne', ['name' => 'Strasse-9']);
$weg('bp-1', ['name' => 'Bärenpfad', 'wiki_path' => ['wiki_key' => 'b-renpfad', 'name' => 'Bärenpfad']]);

// 1. Trockenlauf schreibt nichts
$trocken = avesmapsWikiPathWeitereSchreiben($pdo, 'add', 'b-renpfad', ['rs-7'], true, 1);
assert($trocken['dry_run'] === true && $trocken['applied'] === 1);
assert(!array_key_exists('wiki_path_weitere', $props('rs-7')), 'ein Trockenlauf schreibt nichts');
assert($audits() === 0);

// 1b. avesmapsWikiPathEnsureTables() muss als ALLERERSTE Anweisung laufen -- VOR dem ersten
// SELECT auf wiki_path_staging. Faellt diese Zusicherung, wurde der Ensure-Aufruf entfernt (er
// schluckt sich sonst durch den obigen Aufruf still weg und die naechste Zeile bliebe gruen).
assert($pdo->ensureAb !== null, 'avesmapsWikiPathEnsureTables() wurde nicht aufgerufen');
assert($pdo->stagingSelectAb !== null, 'der Staging-SELECT wurde nicht gesehen');
assert($pdo->ensureAb < $pdo->stagingSelectAb, 'das Ensure-DDL muss vor dem ersten SELECT auf wiki_path_staging laufen');

// 2. Scharf: rs-6 und rs-7 bekommen ihn; ohne Hauptzuweisung und der Artikel selbst werden uebersprungen
$echt = avesmapsWikiPathWeitereSchreiben($pdo, 'add', 'b-renpfad', ['rs-6', 'rs-7', 'ohne', 'bp-1', 'gibt-es-nicht'], false, 1);
assert($echt['ok'] === true && $echt['dry_run'] === false && $echt['action'] === 'add_weitere');
assert($echt['applied'] === 2, 'zwei Abschnitte geschrieben: ' . json_encode($echt));
$gruende = array_column($echt['skipped'], 'grund', 'public_id');
assert($gruende === ['ohne' => 'ohne_hauptzuweisung', 'bp-1' => 'ist_hauptzuweisung', 'gibt-es-nicht' => 'nicht_gefunden']);
assert($props('rs-7')['wiki_path'] === $haupt, 'die Hauptzuweisung bleibt');
assert($props('rs-7')['name'] === 'Reichsstraße 2', 'der Name bleibt');
assert($props('rs-7')['wiki_path_weitere'][0]['name'] === 'Bärenpfad');
assert($audits() === 2, 'ein Protokolleintrag je geschriebenem Abschnitt');
assert(array_column($echt['segments_updated'], 'public_id') === ['rs-6', 'rs-7']);

// 3. Wiederholt: nichts mehr zu tun, kein weiterer Protokolleintrag
$nochmal = avesmapsWikiPathWeitereSchreiben($pdo, 'add', 'b-renpfad', ['rs-6', 'rs-7'], false, 1);
assert($nochmal['applied'] === 0 && $audits() === 2);

// 4. Entfernen von einem Abschnitt
$entfernt = avesmapsWikiPathWeitereSchreiben($pdo, 'remove', 'b-renpfad', ['rs-7'], false, 1);
assert($entfernt['applied'] === 1 && $entfernt['action'] === 'remove_weitere');
assert(!array_key_exists('wiki_path_weitere', $props('rs-7')));
assert(count($props('rs-6')['wiki_path_weitere']) === 1, 'rs-6 behaelt ihn');

// 5. Ungueltiges
foreach ([
    static fn() => avesmapsWikiPathWeitereSchreiben($pdo, 'add', 'gibt-es-nicht', ['rs-6'], false, 1),
    static fn() => avesmapsWikiPathWeitereSchreiben($pdo, 'add', '', ['rs-6'], false, 1),
    static fn() => avesmapsWikiPathWeitereSchreiben($pdo, 'add', 'b-renpfad', [], false, 1),
] as $aufruf) {
    $geworfen = false;
    try {
        $aufruf();
    } catch (RuntimeException) {
        $geworfen = true;
    }
    assert($geworfen);
}

// 6. Verdrahtung des Endpunkts (Kommentare per Tokenizer entfernt, nicht per Regex)
$quelle = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../../../edit/wiki/paths.php')) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $quelle .= is_array($token) ? $token[1] : $token;
}
assert(str_contains($quelle, "require_once __DIR__ . '/../../_internal/wiki/path-weitere.php';"));
assert(preg_match("/'add_weitere',\s*'remove_weitere'\s*=>\s*avesmapsWikiPathWeitereSchreiben\(/", $quelle) === 1);
assert(preg_match("/in_array\(\\\$action, \[[^\]]*'add_weitere'[^\]]*'remove_weitere'/", $quelle) === 1,
    'beide Aktionen stehen in der Liste, die map_revision hebt');

// 7. avesmapsWikiPathWeitereEintragAusStaging: exakte fuenf-Feld-Form aus einer Staging-Zeile.
$pdo->exec("INSERT INTO wiki_path_staging (wiki_key, name, kind, art, wiki_url)
            VALUES ('karawanenroute', 'Karawanenroute', 'strasse', 'Handelsroute', 'https://de.wiki-aventurica.de/wiki/Karawanenroute')");
$st = $pdo->prepare('SELECT * FROM wiki_path_staging WHERE wiki_key = :k LIMIT 1');
$st->execute(['k' => 'karawanenroute']);
$stagingZeile = $st->fetch(PDO::FETCH_ASSOC);
$eintrag = avesmapsWikiPathWeitereEintragAusStaging($stagingZeile);
assert($eintrag === [
    'wiki_key' => 'karawanenroute',
    'name' => 'Karawanenroute',
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Karawanenroute',
    'art' => 'Handelsroute',
    'kind' => 'strasse',
], 'avesmapsWikiPathWeitereEintragAusStaging liefert genau die fuenf Felder: ' . json_encode($eintrag));

echo "path-weitere-schreiben-test.php: ok\n";
