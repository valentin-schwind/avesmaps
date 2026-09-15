<?php

declare(strict_types=1);

// DER GARETIEN-IMPORT VERSORGT FLAECHE UND BESCHRIFTUNG MIT DEMSELBEN WIKI-EINTRAG -- mit der ECHTEN
// Uebernahme gefahren (avesmapsGaretienUebernehmen), nicht nachgebaut.
// Owner 15.09.2026: „dass der garetien importer fläche und label mit dem selben wiki eintrag versorgt, eine
// inkonsistenz darf es hier nicht geben" und „soll in diesem Zug ebenfalls repariert und von dir getestet
// werden, um zu zeigen, dass das problem wirklich gefixt ist".
// Entwurf: docs/superpowers/specs/2026-09-15-landschaft-wiki-eine-quelle-design.md §4.3
//
// 🔴 DER BEFUND, DEN DIESER TEST FESTHAELT. Bis zum 15.09.2026 baute der Import das Nest der Beschriftung aus
// `wiki_region_staging.wiki_key` und reichte die Adresse GETRENNT an die Region, die ihren Schluessel aus der
// Adresse ableitet. Zwei Ableitungen desselben Werts -- und `create_region` zog die Beschriftung nicht nach.
// Abschnitt A baut genau den Fall, in dem beide verschieden sind: der alte Import haette die Beschriftung mit
// `wiki:blauer-see` und die Region mit `blauer-see` angelegt.
//
// ⭐ DAS ORAKEL ist der Bestandslauf (avesmapsLandschaftWikiBefund) -- dieselbe Zaehlung, mit der der Owner
// live misst.
//
// Lauf aus dem Repo-Wurzelverzeichnis:
//   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-flaeche-wiki-eine-quelle-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../garetien-uebernahme.php';

// Dieselbe Uebersetzungs-Naht wie garetien-wiki-nachzug-test.php, gekuerzt auf diesen Ablauf.
final class AvesmapsGaretienEineQuelleTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        foreach (['map_revision', 'ecosystem_revision'] as $tabelle) {
            if (str_contains($statement, 'INTO ' . $tabelle) && str_contains($statement, 'ON DUPLICATE KEY UPDATE')) {
                $statement = str_replace(
                    'ON DUPLICATE KEY UPDATE revision = revision + 1',
                    'ON CONFLICT(id) DO UPDATE SET revision = ' . $tabelle . '.revision + 1',
                    $statement
                );
            }
        }
        if (str_contains($statement, 'AUTO_INCREMENT')
            || str_contains($statement, 'ENGINE=InnoDB')
            || str_starts_with(ltrim($statement), 'ALTER TABLE')) {
            return 0;
        }

        return parent::exec(str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $statement));
    }

    public function query(string $query, ?int $fetchMode = null, mixed ...$args): PDOStatement|false
    {
        if (str_contains($query, 'information_schema')) {
            return parent::query('SELECT 1 AS ok');
        }

        return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$args);
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if (str_contains($query, 'information_schema')) {
            preg_match_all('~:[a-zA-Z_][a-zA-Z0-9_]*~', $query, $treffer);
            $namen = array_unique($treffer[0]);
            $ersatz = $namen === [] ? 'SELECT 1 AS ok'
                : 'SELECT 1 AS ok WHERE ' . implode(' IS NOT NULL AND ', $namen) . ' IS NOT NULL';

            return parent::prepare($ersatz);
        }
        $query = str_replace('FOR UPDATE', '', $query);
        $query = str_replace(['CURRENT_TIMESTAMP(3)', 'NOW(3)'], "datetime('now')", $query);
        $query = str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $query);
        $query = str_replace("ESCAPE '\\\\'", "ESCAPE '\\'", $query);
        if (str_contains($query, 'INSERT INTO app_setting') && str_contains($query, 'ON DUPLICATE KEY UPDATE')) {
            $query = 'INSERT INTO app_setting (setting_key, setting_value) VALUES (:k, :v)
                      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value';
        }

        return parent::prepare($query, $options);
    }
}

function garetienEineQuellePdo(): PDO
{
    $pdo = new AvesmapsGaretienEineQuelleTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE map_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT, feature_subtype TEXT,
        name TEXT, geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
        min_x REAL, min_y REAL, max_x REAL, max_y REAL, sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 1, created_by INTEGER NULL, updated_by INTEGER NULL)');
    $pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
    $pdo->exec('CREATE TABLE map_feature_locks (public_id TEXT PRIMARY KEY, user_id INTEGER, username TEXT, locked_until TEXT)');
    $pdo->exec('CREATE TABLE map_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL,
        action TEXT, actor_user_id INTEGER NULL, before_json TEXT, after_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, undone_at TEXT NULL, undone_by INTEGER NULL,
        undo_audit_id INTEGER NULL, undone_by_log_id INTEGER NULL, operation_id TEXT NULL, operation_label TEXT NULL)');
    $pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT,
        kind TEXT, region_type TEXT, origin TEXT DEFAULT \'own\', wiki_region_key TEXT, wiki_url TEXT,
        label_public_id TEXT, properties_json TEXT, stack_order INTEGER DEFAULT 0, is_locked INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1, created_by INTEGER NULL, updated_by INTEGER NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    $pdo->exec('CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, region_id INTEGER,
        geometry_geojson TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL, geometry_revision INTEGER DEFAULT 1,
        is_trial INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_by INTEGER NULL, updated_by INTEGER NULL,
        terrain_grain REAL NULL, terrain_levels INTEGER NULL, terrain_avg_height REAL NULL, terrain_mean_height REAL NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    $pdo->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, label TEXT,
        sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, affects_paths INTEGER DEFAULT 1,
        offroad_factor REAL DEFAULT 1.0, terrain_speed_factor REAL NULL, terrain_grain REAL NULL,
        terrain_levels INTEGER NULL, terrain_avg_height REAL NULL, terrain_mean_height REAL NULL,
        PRIMARY KEY (kind, type_key))');
    $pdo->exec('CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
    $pdo->exec('CREATE TABLE ecosystem_geometry_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT, actor_user_id INTEGER NULL, area_public_id TEXT NULL, region_public_id TEXT NULL,
        before_json TEXT, after_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        undone_at TEXT NULL, undone_by INTEGER NULL, undo_audit_id INTEGER NULL, undone_by_log_id INTEGER NULL,
        operation_id TEXT NULL, operation_label TEXT NULL)');
    $pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label) VALUES ('topographie', 'see', 'See')");
    $pdo->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT)');
    $pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, url_hash TEXT UNIQUE,
        wiki_key TEXT NULL, label TEXT, source_type TEXT, is_official INTEGER DEFAULT 0, created_by INTEGER NULL,
        license TEXT NOT NULL DEFAULT \'\', attribution TEXT NOT NULL DEFAULT \'\',
        own_fields TEXT NOT NULL DEFAULT \'\', created_at TEXT DEFAULT "2026-01-01")');
    $pdo->exec("CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
        entity_public_id TEXT NOT NULL, source_id INTEGER NOT NULL, status TEXT DEFAULT 'approved',
        created_by INTEGER NULL, origin TEXT DEFAULT 'manual', reference_kind TEXT NULL, pages TEXT NULL,
        note TEXT NULL, created_at TEXT NOT NULL DEFAULT \"2026-01-01 00:00:00\",
        UNIQUE(entity_type, entity_public_id, source_id))");
    $pdo->exec('CREATE TABLE wiki_region_staging (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, title TEXT,
        name TEXT, match_key TEXT, art TEXT, continent TEXT, region_parent TEXT, affiliation_staat TEXT,
        einwohner TEXT, sprache TEXT, vegetation TEXT, verkehrswege TEXT, description TEXT, image_url TEXT,
        image_license TEXT, image_author TEXT, image_attribution TEXT, image_license_status TEXT,
        image_license_url TEXT, wiki_url TEXT, neighbors_json TEXT, synonyms_json TEXT, synced_at TEXT)');
    avesmapsEnsureSyncPlanTablesSqlite($pdo);

    return $pdo;
}

function garetienEineQuelleArtikel(PDO $pdo, string $stagingKey, string $name, string $seite): string
{
    $url = 'https://de.wiki-aventurica.de/wiki/' . $seite;
    $pdo->prepare('INSERT INTO wiki_region_staging (wiki_key, title, name, match_key, art, continent, description, wiki_url)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$stagingKey, $name, $name, avesmapsWikiSyncCreateMatchKey($name), 'See', 'Aventurien', 'Beschreibung ' . $name, $url]);

    return $url;
}

/** Ein Flaechen-Item anlegen UND mit der echten Uebernahme importieren. */
function garetienEineQuelleImport(PDO $pdo, int $runId, string $name, int $nr, array $rumpf = []): array
{
    $o = 20.0 + $nr * 40.0;
    $ring = [[$o, $o], [$o + 20, $o], [$o + 20, $o + 20], [$o, $o + 20], [$o, $o]];
    $pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected)
                   VALUES (?, ?, NULL, 'new', ?, NULL, ?, NULL, 1)")
        ->execute([
            $runId,
            'ggp:Seen:See:#' . $nr,
            $name,
            json_encode([
                'herkunft' => 'garetien', 'ziel' => 'region', 'kind' => 'topographie', 'subtyp' => 'see',
                'name' => $name, 'geometry' => ['type' => 'Polygon', 'coordinates' => [$ring]],
            ], JSON_UNESCAPED_UNICODE),
        ]);
    $item = (int) $pdo->lastInsertId();
    $ergebnis = avesmapsGaretienUebernehmen($pdo, $runId, [$item], ['id' => 7], null, [$item => $rumpf]);
    assert($ergebnis['fehler'] === [], "Aufbau: {$name} legt an: " . json_encode($ergebnis['fehler'], JSON_UNESCAPED_UNICODE));

    $vermerk = avesmapsGaretienVermerkLesen((string) $pdo->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $item)->fetchColumn());
    $st = $pdo->prepare('SELECT * FROM ecosystem_region WHERE public_id = ?');
    $st->execute([$vermerk['region']]);
    $region = $st->fetch(PDO::FETCH_ASSOC);
    assert(is_array($region), "Aufbau: {$name} hat eine Region");

    return $region;
}

function garetienEineQuelleNest(PDO $pdo, string $labelPublicId): array
{
    $st = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = ?');
    $st->execute([$labelPublicId]);
    $props = json_decode((string) $st->fetchColumn(), true);

    return is_array($props) && is_array($props['wiki_region'] ?? null) ? $props['wiki_region'] : [];
}

$pdo = garetienEineQuellePdo();
$run = avesmapsSyncPlanStartRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'eine-quelle');

// ---- A. Der Staging-Schluessel weicht vom Slug der Adresse ab ------------------------------------------
$urlBlau = garetienEineQuelleArtikel($pdo, 'wiki:blauer-see', 'Blauer See', 'Blauer_See');
$blau = garetienEineQuelleImport($pdo, $run, 'Blauer See', 1);
$nestBlau = garetienEineQuelleNest($pdo, (string) $blau['label_public_id']);
assert($blau['wiki_region_key'] === 'blauer-see' && $blau['wiki_url'] === $urlBlau,
    'A: die Region traegt den Schluessel ihrer Adresse: ' . json_encode($blau, JSON_UNESCAPED_UNICODE));
assert(($nestBlau['wiki_key'] ?? '') === $blau['wiki_region_key'],
    'A: 🔴 die Beschriftung traegt DENSELBEN Schluessel wie ihre Region (der alte Import haette `wiki:blauer-see` '
    . 'geschrieben): ' . json_encode($nestBlau, JSON_UNESCAPED_UNICODE));
assert(($nestBlau['wiki_url'] ?? '') === $urlBlau, 'A: und dieselbe Adresse');
assert(($nestBlau['description'] ?? '') === 'Beschreibung Blauer See', 'A: mit dem vollen Datensatz aus dem Staging');
echo "OK A -- abweichender Staging-Schluessel\n";

// ---- B. Der Normalfall: Staging-Schluessel = Slug ------------------------------------------------------
garetienEineQuelleArtikel($pdo, 'weydenauer-see', 'Weydenauer See', 'Weydenauer_See');
$weyden = garetienEineQuelleImport($pdo, $run, 'Weydenauer See', 2);
assert($weyden['wiki_region_key'] === 'weydenauer-see', 'B: Region zugewiesen');
assert((garetienEineQuelleNest($pdo, (string) $weyden['label_public_id'])['wiki_key'] ?? '') === 'weydenauer-see',
    'B: Beschriftung gleich');
echo "OK B -- Normalfall\n";

// ---- C. Ohne Treffer: beide leer -----------------------------------------------------------------------
$nirgends = garetienEineQuelleImport($pdo, $run, 'Nirgendsee', 3);
assert($nirgends['wiki_region_key'] === null, 'C: ohne Treffer keine Zuweisung an der Region');
assert(garetienEineQuelleNest($pdo, (string) $nirgends['label_public_id']) === [], 'C: und keine an der Beschriftung');
echo "OK C -- ohne Treffer\n";

// ---- D. Ein Verbund aus zwei Fragmenten: EINE Region, EINE Beschriftung, EIN Artikel --------------------
garetienEineQuelleArtikel($pdo, 'erlensee', 'Erlensee', 'Erlensee');
$erlen1 = garetienEineQuelleImport($pdo, $run, 'Erlensee 1', 4, ['verbund' => 'Erlensee']);
$erlen2 = garetienEineQuelleImport($pdo, $run, 'Erlensee 2', 5, ['verbund' => 'Erlensee']);
assert($erlen1['public_id'] === $erlen2['public_id'], 'D: der Verbund ist EINE Region');
assert($erlen1['wiki_region_key'] === 'erlensee', 'D: sie traegt den Artikel des Stamms');
assert((garetienEineQuelleNest($pdo, (string) $erlen1['label_public_id'])['wiki_key'] ?? '') === 'erlensee', 'D: ihre Beschriftung auch');
assert((int) $pdo->query("SELECT COUNT(*) FROM ecosystem_area WHERE region_id = " . (int) $erlen1['id'])->fetchColumn() === 2,
    'D: mit zwei Flaechen');
echo "OK D -- Verbund\n";

// ---- E. Das Orakel ueber den ganzen Bestand ---------------------------------------------------------------
$befund = avesmapsLandschaftWikiBefund($pdo);
assert($befund['zaehler']['nur_beschriftung'] === 0 && $befund['zaehler']['nur_region'] === 0 && $befund['zaehler']['verschieden'] === 0,
    'E: 🔴 nach dem Import weicht KEINE Beschriftung von ihrer Region ab: ' . json_encode($befund, JSON_UNESCAPED_UNICODE));
assert($befund['zaehler']['gleich'] === 3 && $befund['zaehler']['beide_leer'] === 1 && $befund['faelle'] === [],
    'E: drei zugewiesen und gleich, eine leer: ' . json_encode($befund['zaehler']));
echo "OK E -- Bestand stimmig\n";

echo "OK -- garetien-flaeche-wiki-eine-quelle: Flaeche und Beschriftung tragen denselben Wiki-Eintrag\n";
