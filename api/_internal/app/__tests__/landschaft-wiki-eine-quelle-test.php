<?php

declare(strict_types=1);

/**
 * EINE QUELLE, DIE REGION -- jeder Schreibweg AUSGEFUEHRT, nicht gelesen.
 * Entwurf: docs/superpowers/specs/2026-09-15-landschaft-wiki-eine-quelle-design.md
 *
 * 🔴 DIE INVARIANTE (Owner 15.09.2026, „eine inkonsistenz darf es hier nicht geben"): jede aktive, an eine
 * aktive Region gebundene Beschriftung traegt `properties.wiki_region.wiki_key` = `wiki_region_key` der
 * Region -- beide leer oder beide gleich.
 *
 * ⭐ DAS ORAKEL IST DER BESTANDSLAUF. Nach jedem Schritt fragt dieser Test avesmapsLandschaftWikiBefund --
 * dieselbe Zaehlung, mit der der Owner live misst. Ein Weg, der am Trichter vorbeischreibt, faellt dort auf,
 * egal ob der Test an ihn gedacht hat.
 *
 * 💣 GEFAHREN WIRD MIT DEN ECHTEN BIBLIOTHEKEN (features.php, ecosystem.php, wiki/regions.php) gegen SQLite.
 * Die MySQL-eigenen Anweisungen werden an der Treibernaht uebersetzt, nie im Produktivcode verbogen
 * (AGENTS.md §9, Error 1093) -- dieselbe Naht wie die des (mit dem Importer am 26.09.2026 geloeschten)
 * garetien-wiki-nachzug-test.php.
 *
 * Lauf (Windows), aus dem Repo-Root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/landschaft-wiki-eine-quelle-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../../auth.php';
require_once __DIR__ . '/../../map/features.php';
require_once __DIR__ . '/../ecosystem.php';
require_once __DIR__ . '/../feature-sources.php';
require_once __DIR__ . '/../../wiki/sync.php';
require_once __DIR__ . '/../../wiki/locations.php';
require_once __DIR__ . '/../../wiki/regions.php';

final class AvesmapsLandschaftWikiTestPdo extends PDO
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
        if (str_contains($query, 'information_schema') || str_starts_with(ltrim($query), 'SHOW ')) {
            return parent::query('SELECT 1 AS ok');
        }

        return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$args);
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if (str_contains($query, 'information_schema') || str_starts_with(ltrim($query), 'SHOW ')) {
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

function lwPdo(): PDO
{
    $pdo = new AvesmapsLandschaftWikiTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
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
    $pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label) VALUES ('vegetation', 'wald', 'Wald')");
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

    return $pdo;
}

const LW_WIKI = 'https://de.wiki-aventurica.de/wiki/';
$user = ['id' => 7, 'role' => 'admin', 'username' => 'test'];

function lwArtikel(PDO $pdo, string $stagingKey, string $name, string $art, string $seite): string
{
    $url = LW_WIKI . $seite;
    $pdo->prepare('INSERT INTO wiki_region_staging (wiki_key, title, name, match_key, art, continent, description, wiki_url)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$stagingKey, $name, $name, avesmapsWikiSyncCreateMatchKey($name), $art, 'Aventurien', 'Beschreibung ' . $name, $url]);

    return $url;
}

function lwLabel(PDO $pdo, array $user, string $text, array $zusatz = []): string
{
    $antwort = avesmapsCreateLabelFeature($pdo, array_merge([
        'text' => $text, 'feature_subtype' => 'see', 'lat' => 100.0, 'lng' => 100.0,
    ], $zusatz), $user);

    return (string) $antwort['properties']['public_id'];
}

function lwRegion(PDO $pdo, array $user, string $name, array $zusatz = []): string
{
    $antwort = avesmapsCreateEcosystemRegion($pdo, array_merge([
        'name' => $name, 'auto_name' => false, 'kind' => 'topographie', 'region_type' => 'see',
    ], $zusatz), (int) $user['id']);

    return (string) $antwort['region']['public_id'];
}

function lwProps(PDO $pdo, string $publicId): array
{
    $st = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = ?');
    $st->execute([$publicId]);
    $d = json_decode((string) $st->fetchColumn(), true);

    return is_array($d) ? $d : [];
}

function lwNestKey(PDO $pdo, string $labelId): string
{
    return avesmapsLandschaftWikiNestSchluessel(lwProps($pdo, $labelId));
}

function lwRegionZeile(PDO $pdo, string $publicId): array
{
    $st = $pdo->prepare('SELECT * FROM ecosystem_region WHERE public_id = ?');
    $st->execute([$publicId]);

    return $st->fetch(PDO::FETCH_ASSOC) ?: [];
}

/** Das Orakel: keine gebundene Beschriftung weicht von ihrer Region ab. */
function lwStimmig(PDO $pdo, string $wo): void
{
    $befund = avesmapsLandschaftWikiBefund($pdo);
    $z = $befund['zaehler'];
    assert($z['nur_beschriftung'] === 0 && $z['nur_region'] === 0 && $z['verschieden'] === 0,
        $wo . ': 🔴 Beschriftung und Region weichen ab: ' . json_encode($befund, JSON_UNESCAPED_UNICODE));
}

/** Einen Altzustand nachbauen: das Nest einer Beschriftung ROH setzen, am Trichter vorbei (Backup, Altbestand). */
function lwAltNest(PDO $pdo, string $labelId, ?array $nest): void
{
    $props = lwProps($pdo, $labelId);
    if ($nest === null) {
        unset($props['wiki_region']);
    } else {
        $props['wiki_region'] = $nest;
    }
    $pdo->prepare('UPDATE map_features SET properties_json = ? WHERE public_id = ?')
        ->execute([json_encode($props, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $labelId]);
}

// =================================================================================================
// A. create_region: die frisch gebundene Beschriftung traegt den Schluessel DER REGION
// =================================================================================================
// 💣 Der Staging-Schluessel `wiki:blauer-see` weicht absichtlich vom Slug der Adresse ab -- genau die zwei
// Ableitungen, die bis zum 15.09.2026 im Garetien-Import steckten.
$pdo = lwPdo();
$urlBlau = lwArtikel($pdo, 'wiki:blauer-see', 'Blauer See', 'See', 'Blauer_See');
$lA = lwLabel($pdo, $user, 'Blauer See');
$rA = lwRegion($pdo, $user, 'Blauer See', ['label_public_id' => $lA, 'wiki_url' => $urlBlau]);
$regionA = lwRegionZeile($pdo, $rA);
assert($regionA['wiki_region_key'] === 'blauer-see', 'A: die Region leitet den Schluessel aus der Adresse ab');
$propsA = lwProps($pdo, $lA);
assert(($propsA['wiki_region']['wiki_key'] ?? '') === 'blauer-see',
    'A: 🔴 die Beschriftung traegt DENSELBEN Schluessel wie die Region, nicht den des Stagings: ' . json_encode($propsA, JSON_UNESCAPED_UNICODE));
assert(($propsA['wiki_region']['description'] ?? '') === 'Beschreibung Blauer See',
    'A: und trotzdem den vollen Datensatz -- das Staging wird per Adresse gefunden');
assert(($propsA['wiki_region']['wiki_url'] ?? '') === $urlBlau, 'A: mit der Adresse der Region');
lwStimmig($pdo, 'A');

// Eine Region OHNE Artikel nimmt einer frisch gebundenen Beschriftung ihren fremden Artikel.
$urlNiv = lwArtikel($pdo, 'blauer-see-nivesenland', 'Blauer See (Nivesenland)', 'See', 'Blauer_See_(Nivesenland)');
$lA2 = lwLabel($pdo, $user, 'Anderer See', ['wiki_region' => ['wiki_key' => 'blauer-see-nivesenland', 'wiki_url' => $urlNiv]]);
assert(lwNestKey($pdo, $lA2) === 'blauer-see-nivesenland', 'A (Aufbau): eine FREIE Beschriftung behaelt ihr Nest');
$rA2 = lwRegion($pdo, $user, 'Anderer See', ['label_public_id' => $lA2]);
assert(lwNestKey($pdo, $lA2) === '', 'A: 🔴 an eine Region OHNE Artikel gebunden, verliert sie den fremden');
lwStimmig($pdo, 'A2');

echo "OK A -- create_region\n";

// =================================================================================================
// B. update_region: Entfernen wandert, Umbenennen nimmt nichts
// =================================================================================================
$pdo = lwPdo();
$url = lwArtikel($pdo, 'schilfsee', 'Schilfsee', 'See', 'Schilfsee');
$lB1 = lwLabel($pdo, $user, 'Schilfsee');
$rB = lwRegion($pdo, $user, 'Schilfsee', ['label_public_id' => $lB1, 'wiki_url' => $url]);
$lB2 = lwLabel($pdo, $user, 'Schilfsee Nord', ['ecosystem_region_public_id' => $rB]);
assert(lwNestKey($pdo, $lB2) === 'schilfsee', 'B (Aufbau): das zweite Label bekommt den Artikel beim Anlegen');
lwStimmig($pdo, 'B-Aufbau');

$antwort = avesmapsUpdateEcosystemRegion($pdo, ['public_id' => $rB, 'wiki_url' => ''], 7);
assert(lwNestKey($pdo, $lB1) === '' && lwNestKey($pdo, $lB2) === '', 'B: das ausdrueckliche Entfernen nimmt BEIDEN das Nest');
assert(count($antwort['labels']) === 2, 'B: und beide reisen in der Antwort mit');
lwStimmig($pdo, 'B');

// Altbestand (Backup): Region leer, eine Beschriftung traegt noch einen Artikel. Ein blosses Umbenennen
// entscheidet darueber NICHT (Owner 01.09.2026) -- das ist Sache des Bestandslaufs.
lwAltNest($pdo, $lB1, ['wiki_key' => 'schilfsee', 'wiki_url' => $url]);
avesmapsUpdateEcosystemRegion($pdo, ['public_id' => $rB, 'name' => 'Schilfsee (umbenannt)'], 7);
assert(lwNestKey($pdo, $lB1) === 'schilfsee', 'B: 🔴 ein blosses Umbenennen nimmt nichts zurueck');

echo "OK B -- update_region\n";

// =================================================================================================
// C. update_region mit label_public_id: nur die FRISCH gebundene verliert den fremden Artikel
// =================================================================================================
$pdo = lwPdo();
$rC = lwRegion($pdo, $user, 'Leerer See');
$lC = lwLabel($pdo, $user, 'Fremdes Schild', ['wiki_region' => ['wiki_key' => 'fremd', 'wiki_url' => LW_WIKI . 'Fremd']]);
avesmapsUpdateEcosystemRegion($pdo, ['public_id' => $rC, 'label_public_id' => $lC], 7);
assert(lwNestKey($pdo, $lC) === '', 'C: 🔴 die frisch gebundene Beschriftung verliert den Artikel einer anderen Landschaft');
assert((lwProps($pdo, $lC)['ecosystem_region_public_id'] ?? '') === $rC, 'C: und zeigt auf die Region');
lwStimmig($pdo, 'C');
// Dieselbe Zuweisung noch einmal ist KEIN Umhaengen -- ein Altnest daneben bleibt stehen.
lwAltNest($pdo, $lC, ['wiki_key' => 'fremd', 'wiki_url' => LW_WIKI . 'Fremd']);
avesmapsUpdateEcosystemRegion($pdo, ['public_id' => $rC, 'label_public_id' => $lC], 7);
assert(lwNestKey($pdo, $lC) === 'fremd', 'C: dieselbe Zuweisung ein zweites Mal ist kein Umhaengen');

echo "OK C -- label_public_id\n";

// =================================================================================================
// D/E. update_label MIT Wunsch: an die REGION, und die Geschwister folgen
// =================================================================================================
$pdo = lwPdo();
$urlD = lwArtikel($pdo, 'weydenauer-see', 'Weydenauer See', 'See', 'Weydenauer_See');
$lD1 = lwLabel($pdo, $user, 'Weydenauer See');
$rD = lwRegion($pdo, $user, 'Weydenauer See', ['label_public_id' => $lD1]);
$lD2 = lwLabel($pdo, $user, 'Weydenauer See Sued', ['ecosystem_region_public_id' => $rD]);
avesmapsLandschaftWikiMitgezogeneAbholen();

$antwort = avesmapsUpdateLabelFeature($pdo, [
    'public_id' => $lD1, 'text' => 'Weydenauer See', 'feature_subtype' => 'see',
    'wiki_region' => ['wiki_key' => 'weydenauer-see', 'wiki_url' => $urlD, 'name' => 'Weydenauer See'],
], $user);
$regionD = lwRegionZeile($pdo, $rD);
assert($regionD['wiki_region_key'] === 'weydenauer-see' && $regionD['wiki_url'] === $urlD,
    'D: 🔴 der Artikel steht an der REGION: ' . json_encode($regionD, JSON_UNESCAPED_UNICODE));
assert(($antwort['properties']['wiki_region']['wiki_key'] ?? '') === 'weydenauer-see', 'D: die gespeicherte Beschriftung traegt ihn');
assert(lwNestKey($pdo, $lD1) === 'weydenauer-see', 'D: auch in der Zeile');
assert(lwNestKey($pdo, $lD2) === 'weydenauer-see', 'D: und die GESCHWISTER folgen');
$mitgezogen = avesmapsLandschaftWikiMitgezogeneAbholen();
assert(count($mitgezogen) === 1 && ($mitgezogen[0]['id'] ?? '') === $lD2,
    'D: die mitgezogene Geschwister-Beschriftung steht fuer die Antwort bereit (die gespeicherte selbst nicht): ' . json_encode(array_column($mitgezogen, 'id')));
$zuweisung = (int) $pdo->query("SELECT COUNT(*) FROM ecosystem_geometry_audit_log WHERE action = 'assign_wiki_region'")->fetchColumn();
assert($zuweisung === 1, 'D: die Zuweisung an der Region ist protokolliert (rueckgaengig machbar)');
assert((int) $pdo->query("SELECT COUNT(*) FROM map_audit_log WHERE action = 'update_label' AND feature_id = (SELECT id FROM map_features WHERE public_id = " . $pdo->quote($lD1) . ')')->fetchColumn() === 1,
    'D: die gespeicherte Beschriftung hat EINE Protokollzeile, keine zweite aus dem Durchtrag');
lwStimmig($pdo, 'D');

// E. Wunsch null: die Region verliert den Artikel, alle Beschriftungen mit.
avesmapsUpdateLabelFeature($pdo, [
    'public_id' => $lD2, 'text' => 'Weydenauer See Sued', 'feature_subtype' => 'see', 'wiki_region' => null,
], $user);
assert((lwRegionZeile($pdo, $rD)['wiki_region_key'] ?? null) === null, 'E: das Entfernen an einer Beschriftung entfernt an der REGION');
assert(lwNestKey($pdo, $lD1) === '' && lwNestKey($pdo, $lD2) === '', 'E: und an beiden Beschriftungen');
lwStimmig($pdo, 'E');

// Ein Wunsch ohne Adresse, den auch das Staging nicht kennt, wird abgelehnt -- nicht still verschluckt.
$abgelehnt = false;
try {
    avesmapsUpdateLabelFeature($pdo, [
        'public_id' => $lD1, 'text' => 'Weydenauer See', 'feature_subtype' => 'see',
        'wiki_region' => ['wiki_key' => 'unbekannt-ohne-adresse'],
    ], $user);
} catch (InvalidArgumentException) {
    $abgelehnt = true;
}
assert($abgelehnt, 'E: ein Artikel ohne Adresse kann der Region nicht zugewiesen werden -- abgelehnt');
lwStimmig($pdo, 'E2');

echo "OK D/E -- update_label mit Wunsch\n";

// =================================================================================================
// F/G. update_label OHNE Wunsch: Umhaengen gleicht an, blosses Speichern nimmt nichts
// =================================================================================================
$pdo = lwPdo();
$urlF = lwArtikel($pdo, 'erlensee', 'Erlensee', 'See', 'Erlensee');
$lF1 = lwLabel($pdo, $user, 'Erlensee');
$rMit = lwRegion($pdo, $user, 'Erlensee', ['label_public_id' => $lF1, 'wiki_url' => $urlF]);
$lF2 = lwLabel($pdo, $user, 'Sonst');
$rOhne = lwRegion($pdo, $user, 'Sonst', ['label_public_id' => $lF2]);
$lWander = lwLabel($pdo, $user, 'Wanderschild', ['ecosystem_region_public_id' => $rMit]);
assert(lwNestKey($pdo, $lWander) === 'erlensee', 'F (Aufbau)');

avesmapsUpdateLabelFeature($pdo, ['public_id' => $lWander, 'text' => 'Wanderschild', 'feature_subtype' => 'see',
    'ecosystem_region_public_id' => $rOhne], $user);
assert(lwNestKey($pdo, $lWander) === '', 'F: 🔴 an eine Region ohne Artikel umgehaengt, verliert sie ihn');
lwStimmig($pdo, 'F1');
avesmapsUpdateLabelFeature($pdo, ['public_id' => $lWander, 'text' => 'Wanderschild', 'feature_subtype' => 'see',
    'ecosystem_region_public_id' => $rMit], $user);
assert(lwNestKey($pdo, $lWander) === 'erlensee', 'F: zurueck an die Region mit Artikel, bekommt sie ihn');
lwStimmig($pdo, 'F2');

// G. Altbestand an einer leeren Region: ein Speichern ohne Wunsch und ohne Umhaengen nimmt nichts.
lwAltNest($pdo, $lF2, ['wiki_key' => 'erlensee', 'wiki_url' => $urlF]);
avesmapsUpdateLabelFeature($pdo, ['public_id' => $lF2, 'text' => 'Sonst neu', 'feature_subtype' => 'see'], $user);
assert(lwNestKey($pdo, $lF2) === 'erlensee', 'G: ein blosses Speichern nimmt einen Altartikel nicht weg');
// Und an einer Region MIT Artikel heilt dasselbe Speichern die Luecke.
lwAltNest($pdo, $lF1, null);
avesmapsUpdateLabelFeature($pdo, ['public_id' => $lF1, 'text' => 'Erlensee', 'feature_subtype' => 'see'], $user);
assert(lwNestKey($pdo, $lF1) === 'erlensee', 'G: an einer Region mit Artikel heilt jedes Speichern die Luecke');

echo "OK F/G -- update_label ohne Wunsch\n";

// =================================================================================================
// H. create_label: gebunden -> Region, frei -> mitgeschickt
// =================================================================================================
$pdo = lwPdo();
$urlH = lwArtikel($pdo, 'hexenhain', 'Hexenhain', 'See', 'Hexenhain');
$lH = lwLabel($pdo, $user, 'Hexenhain');
$rH = lwRegion($pdo, $user, 'Hexenhain', ['label_public_id' => $lH, 'wiki_url' => $urlH]);
$lDup = lwLabel($pdo, $user, 'Hexenhain (Kopie)', [
    'ecosystem_region_public_id' => $rH,
    'wiki_region' => ['wiki_key' => 'ganz-anders', 'wiki_url' => LW_WIKI . 'Ganz_anders'],
]);
assert(lwNestKey($pdo, $lDup) === 'hexenhain', 'H: 🔴 eine gebundene Kopie traegt den Artikel der Region, nicht den mitgeschickten');
$rLeer = lwRegion($pdo, $user, 'Leer');
$lDup2 = lwLabel($pdo, $user, 'Kopie an leerer Region', [
    'ecosystem_region_public_id' => $rLeer,
    'wiki_region' => ['wiki_key' => 'hexenhain', 'wiki_url' => $urlH],
]);
assert(lwNestKey($pdo, $lDup2) === '', 'H: an einer leeren Region gar keinen');
$lFrei = lwLabel($pdo, $user, 'Freier Gipfel', ['wiki_region' => ['wiki_key' => 'frei', 'wiki_url' => LW_WIKI . 'Frei']]);
assert(lwNestKey($pdo, $lFrei) === 'frei', 'H: eine freie Beschriftung behaelt das mitgeschickte Nest');
lwStimmig($pdo, 'H');

echo "OK H -- create_label\n";

// =================================================================================================
// I. Rueckgaengig einer Beschriftung: die Region gewinnt
// =================================================================================================
$pdo = lwPdo();
$urlI1 = lwArtikel($pdo, 'mondsee', 'Mondsee', 'See', 'Mondsee');
$urlI2 = lwArtikel($pdo, 'sonnensee', 'Sonnensee', 'See', 'Sonnensee');
$lI = lwLabel($pdo, $user, 'Mondsee');
$rI = lwRegion($pdo, $user, 'Mondsee', ['label_public_id' => $lI, 'wiki_url' => $urlI1]);
avesmapsUpdateLabelFeature($pdo, ['public_id' => $lI, 'text' => 'Mondsee neu', 'feature_subtype' => 'see'], $user);
$eintragI = (int) $pdo->query("SELECT MAX(id) FROM map_audit_log WHERE action = 'update_label'")->fetchColumn();
// Die Region wechselt AM TRICHTER VORBEI (so, wie ein altes Backup sie zurueckbraechte) -- das Schild bleibt.
$pdo->prepare('UPDATE ecosystem_region SET wiki_url = ?, wiki_region_key = ? WHERE public_id = ?')
    ->execute([$urlI2, 'sonnensee', $rI]);
avesmapsUndoAuditChange($pdo, ['audit_id' => $eintragI], $user);
assert(lwNestKey($pdo, $lI) === 'sonnensee',
    'I: 🔴 das Rueckgaengig stellt nicht den alten Artikel zurueck, sondern den der Region: ' . json_encode(lwProps($pdo, $lI), JSON_UNESCAPED_UNICODE));
assert((lwProps($pdo, $lI)['text'] ?? '') === 'Mondsee', 'I: der Rest wird ganz normal zurueckgenommen');
lwStimmig($pdo, 'I');

echo "OK I -- Rueckgaengig der Karte\n";

// =================================================================================================
// J. Rueckgaengig einer Zuweisung an der Region: die Beschriftungen folgen
// =================================================================================================
$pdo = lwPdo();
$urlJ1 = lwArtikel($pdo, 'tiefsee', 'Tiefsee', 'See', 'Tiefsee');
$urlJ2 = lwArtikel($pdo, 'flachsee', 'Flachsee', 'See', 'Flachsee');
$lJ = lwLabel($pdo, $user, 'Tiefsee');
$rJ = lwRegion($pdo, $user, 'Tiefsee', ['label_public_id' => $lJ, 'wiki_url' => $urlJ1]);
avesmapsAssignEcosystemWikiRegion($pdo, ['region_public_ids' => [$rJ], 'wiki_url' => $urlJ2, 'dry_run' => false, 'confirm' => 'apply'], 7);
assert(lwNestKey($pdo, $lJ) === 'flachsee', 'J (Aufbau): der Panel-Knopf zieht nach');
$eintragJ = (int) $pdo->query("SELECT MAX(id) FROM ecosystem_geometry_audit_log WHERE action = 'assign_wiki_region'")->fetchColumn();
avesmapsUndoEcosystemChange($pdo, ['audit_id' => $eintragJ], 7);
assert((lwRegionZeile($pdo, $rJ)['wiki_region_key'] ?? '') === 'tiefsee', 'J: die Region ist zurueck');
assert(lwNestKey($pdo, $lJ) === 'tiefsee', 'J: 🔴 und die Beschriftung folgt ihr');
lwStimmig($pdo, 'J');
// Und das Rueckgaengig der ersten Zuweisung (leer -> Tiefsee) nimmt den Artikel an beiden weg.
$pdo->prepare('UPDATE ecosystem_region SET wiki_url = NULL, wiki_region_key = NULL WHERE public_id = ?')->execute([$rJ]);
avesmapsAssignEcosystemWikiRegion($pdo, ['region_public_ids' => [$rJ], 'wiki_url' => $urlJ1, 'dry_run' => false, 'confirm' => 'apply'], 7);
$eintragJ2 = (int) $pdo->query("SELECT MAX(id) FROM ecosystem_geometry_audit_log WHERE action = 'assign_wiki_region'")->fetchColumn();
avesmapsUndoEcosystemChange($pdo, ['audit_id' => $eintragJ2], 7);
assert(lwNestKey($pdo, $lJ) === '', 'J: das Rueckgaengig in die leere Richtung nimmt der Beschriftung das Nest');
lwStimmig($pdo, 'J2');

echo "OK J -- Rueckgaengig der Landschaften\n";

// =================================================================================================
// K. WikiSync: ausdruecklich -> Region, per Name -> gebundene uebersprungen
// =================================================================================================
$pdo = lwPdo();
$urlK = lwArtikel($pdo, 'nebelsee', 'Nebelsee', 'See', 'Nebelsee');
$lKgebunden = lwLabel($pdo, $user, 'Nebelsee');
$rK = lwRegion($pdo, $user, 'Nebelsee', ['label_public_id' => $lKgebunden]);
$lKgeschwister = lwLabel($pdo, $user, 'Nebelsee West', ['ecosystem_region_public_id' => $rK]);
$lKfrei = lwLabel($pdo, $user, 'Nebelsee');

$probe = avesmapsWikiRegionAssignLabels($pdo, ['wiki_key' => 'nebelsee', 'label_public_ids' => [$lKgebunden, $lKfrei]], 7, true);
// 🔴 Ohne Bearbeitungsrecht (der Endpunkt verlangt nur `review`) darf die Aktion keine Flaeche beschreiben.
$ohneRecht = false;
try {
    avesmapsWikiRegionAssignLabels($pdo, ['wiki_key' => 'nebelsee', 'label_public_ids' => [$lKgebunden], 'dry_run' => false, 'confirm' => 'apply'], 9, false);
} catch (InvalidArgumentException) {
    $ohneRecht = true;
}
assert($ohneRecht, 'K: 🔴 ein Reviewer schreibt ueber „Label zuweisen" keine Region');
assert((lwRegionZeile($pdo, $rK)['wiki_region_key'] ?? null) === null && lwNestKey($pdo, $lKgebunden) === '', 'K: und es wurde nichts geschrieben');
avesmapsWikiRegionAssignLabels($pdo, ['wiki_key' => 'nebelsee', 'label_public_ids' => [$lKfrei], 'dry_run' => false, 'confirm' => 'apply'], 9, false);
assert(lwNestKey($pdo, $lKfrei) === 'nebelsee', 'K: eine FREIE Beschriftung darf er weiter zuweisen');
lwAltNest($pdo, $lKfrei, null);
assert($probe['dry_run'] === true, 'K: Trockenlauf ist die Vorgabe');
$planGebunden = array_values(array_filter($probe['labels'], static fn ($e) => $e['public_id'] === $lKgebunden))[0] ?? [];
assert(($planGebunden['region_public_id'] ?? '') === $rK, 'K: die Vorschau nennt die Flaeche, auf die die Wahl wirkt');
assert(lwNestKey($pdo, $lKgebunden) === '', 'K: der Trockenlauf schreibt nichts');

avesmapsWikiRegionAssignLabels($pdo, ['wiki_key' => 'nebelsee', 'label_public_ids' => [$lKgebunden, $lKfrei], 'dry_run' => false, 'confirm' => 'apply'], 7, true);
assert((lwRegionZeile($pdo, $rK)['wiki_region_key'] ?? '') === 'nebelsee', 'K: 🔴 die Wahl an einer gebundenen Beschriftung schreibt an die REGION');
assert(lwNestKey($pdo, $lKgebunden) === 'nebelsee' && lwNestKey($pdo, $lKgeschwister) === 'nebelsee', 'K: und alle ihre Beschriftungen folgen');
assert(lwNestKey($pdo, $lKfrei) === 'nebelsee', 'K: die freie Beschriftung bekommt das Nest direkt');
// 💣 Die gebundene Beschriftung wird NUR ueber die Region geschrieben -- ein zusaetzlicher Direktschreiber
// fiele im Endzustand nicht auf (der Durchtrag glaettet ihn), aber er waere der zweite Erzeuger.
$direkt = $pdo->prepare("SELECT COUNT(*) FROM map_audit_log WHERE action = 'wiki_sync_update_point'
                          AND feature_id = (SELECT id FROM map_features WHERE public_id = ?)");
$direkt->execute([$lKgebunden]);
assert((int) $direkt->fetchColumn() === 0, 'K: 🔴 kein Direktschreiber an der gebundenen Beschriftung vorbei an der Region');
$direkt->execute([$lKfrei]);
assert((int) $direkt->fetchColumn() === 2, 'K: (Gegenprobe) die freie traegt ihre zwei Protokollzeilen (Reviewer-Lauf und dieser)');
lwStimmig($pdo, 'K1');

// Namensabgleich: ein gebundenes Schild an einer LEEREN Region bekommt per Name nichts.
$pdo = lwPdo();
lwArtikel($pdo, 'nebelsee', 'Nebelsee', 'See', 'Nebelsee');
$lNg = lwLabel($pdo, $user, 'Nebelsee');
lwRegion($pdo, $user, 'Nebelsee', ['label_public_id' => $lNg]);
$lNf = lwLabel($pdo, $user, 'Nebelsee');
$alle = avesmapsWikiRegionAssignAll($pdo, 'Aventurien', false);
assert($alle['gebunden_uebersprungen'] === 1, 'K: der Namensabgleich meldet die uebersprungene gebundene Beschriftung: ' . json_encode($alle));
assert(lwNestKey($pdo, $lNg) === '', 'K: 🔴 per Name bekommt ein Schild an einer Flaeche nichts');
assert(lwNestKey($pdo, $lNf) === 'nebelsee', 'K: ein freies schon');
$einzel = avesmapsWikiRegionAssign($pdo, 'nebelsee', true);
assert($einzel['gebunden_uebersprungen'] === 1 && $einzel['labels'] === 1, 'K: der Einzelabgleich ebenso: ' . json_encode($einzel));
lwStimmig($pdo, 'K2');

echo "OK K -- WikiSync\n";

// =================================================================================================
// L. Aufloesung: eine primaere Beschriftung, die selbst woanders hinzeigt, gehoert der anderen Region
// =================================================================================================
$pdo = lwPdo();
$urlL1 = lwArtikel($pdo, 'see-eins', 'See Eins', 'See', 'See_Eins');
$urlL2 = lwArtikel($pdo, 'see-zwei', 'See Zwei', 'See', 'See_Zwei');
$rL2 = lwRegion($pdo, $user, 'See Zwei', ['wiki_url' => $urlL2]);
$lL = lwLabel($pdo, $user, 'Schild', ['ecosystem_region_public_id' => $rL2]);
assert(lwNestKey($pdo, $lL) === 'see-zwei', 'L (Aufbau)');
// Eine zweite Region nennt dasselbe Schild als primaeres (Altbestand, am Wachhund vorbei gesetzt).
$rL1 = lwRegion($pdo, $user, 'See Eins', ['wiki_url' => $urlL1]);
$pdo->prepare('UPDATE ecosystem_region SET label_public_id = ? WHERE public_id = ?')->execute([$lL, $rL1]);
avesmapsUpdateEcosystemRegion($pdo, ['public_id' => $rL1, 'name' => 'See Eins neu'], 7);
assert(lwNestKey($pdo, $lL) === 'see-zwei', 'L: 🔴 der Durchtrag der ANDEREN Region ueberschreibt das Schild nicht -- es gehoert zu der, die es selbst nennt');
lwStimmig($pdo, 'L');

echo "OK L -- Aufloesung\n";

// =================================================================================================
// M. Der Bestandslauf: zaehlen, auflisten, nur mit Entscheidung schreiben
// =================================================================================================
$pdo = lwPdo();
$urlM1 = lwArtikel($pdo, 'erlensee', 'Erlensee', 'See', 'Erlensee');
$urlM2 = lwArtikel($pdo, 'weydenauer-see', 'Weydenauer See', 'See', 'Weydenauer_See');
$urlM3 = lwArtikel($pdo, 'grauer-see', 'Grauer See', 'See', 'Grauer_See');
$lM1 = lwLabel($pdo, $user, 'Erlensee (Kosch)');
$rM1 = lwRegion($pdo, $user, 'Erlensee (Kosch)', ['label_public_id' => $lM1]);
$lM2 = lwLabel($pdo, $user, 'Weydenauer See');
$rM2 = lwRegion($pdo, $user, 'Weydenauer See', ['label_public_id' => $lM2, 'wiki_url' => $urlM3]);
$lM3 = lwLabel($pdo, $user, 'Unentschieden');
$rM3 = lwRegion($pdo, $user, 'Unentschieden', ['label_public_id' => $lM3]);
$lM4 = lwLabel($pdo, $user, 'Stimmig');
lwRegion($pdo, $user, 'Stimmig', ['label_public_id' => $lM4, 'wiki_url' => $urlM3]);
$lMfrei = lwLabel($pdo, $user, 'Freier Name', ['wiki_region' => ['wiki_key' => 'frei', 'wiki_url' => LW_WIKI . 'Frei']]);
// Die Altzustaende, am Trichter vorbei -- genau die zwei live gemessenen Formen plus eine dritte.
lwAltNest($pdo, $lM1, ['wiki_key' => 'erlensee', 'wiki_url' => $urlM1, 'name' => 'Erlensee']);
lwAltNest($pdo, $lM2, ['wiki_key' => 'weydenauer-see', 'wiki_url' => $urlM2, 'name' => 'Weydenauer See']);
lwAltNest($pdo, $lM3, ['wiki_key' => 'erlensee', 'wiki_url' => $urlM1]);
$vorher = avesmapsLandschaftWikiNachzugStand($pdo);

$ohneRecht = false;
try {
    avesmapsLandschaftWikiBestand($pdo, ['id' => 8, 'role' => 'editor'], []);
} catch (RuntimeException) {
    $ohneRecht = true;
}
assert($ohneRecht, 'M: 🔴 nur Admins, auch fuer den Trockenlauf');

$trocken = avesmapsLandschaftWikiBestand($pdo, $user, []);
assert($trocken['dry_run'] === true, 'M: Trockenlauf ist die Vorgabe');
assert($trocken['zaehler']['nur_beschriftung'] === 2 && $trocken['zaehler']['verschieden'] === 1 && $trocken['zaehler']['nur_region'] === 0,
    'M: gezaehlt wie die Messung des Auftrags: ' . json_encode($trocken['zaehler']));
assert($trocken['zaehler']['frei'] === 1 && $trocken['zaehler']['gebunden'] === 4, 'M: frei und gebunden: ' . json_encode($trocken['zaehler']));
assert($trocken['regionen_betroffen'] === 3 && count($trocken['faelle']) === 3, 'M: jede betroffene Region ist ein Fall');
assert(array_column($trocken['faelle'], 'name') === ['Erlensee (Kosch)', 'Unentschieden', 'Weydenauer See'], 'M: benannt, sortiert');
assert(avesmapsLandschaftWikiNachzugStand($pdo) === $vorher, 'M: 🔴 der Trockenlauf schreibt in KEINE Tabelle');

$scharf = avesmapsLandschaftWikiBestand($pdo, $user, [
    'dry_run' => false,
    'confirm' => 'apply',
    'entscheidungen' => [
        ['region_public_id' => $rM1, 'aktion' => 'heben', 'wiki_key' => 'erlensee'],
        ['region_public_id' => $rM2, 'aktion' => 'region_gewinnt'],
        ['region_public_id' => $rM2, 'aktion' => 'region_gewinnt'],
        ['region_public_id' => $rM3, 'aktion' => 'raten'],
    ],
]);
$status = array_column($scharf['ergebnisse'], 'status');
assert($status === ['erledigt', 'erledigt', 'inzwischen_erledigt', 'abgelehnt'], 'M: je Entscheidung ein Ergebnis: ' . json_encode($scharf['ergebnisse'], JSON_UNESCAPED_UNICODE));
assert((lwRegionZeile($pdo, $rM1)['wiki_region_key'] ?? '') === 'erlensee', 'M: heben -- der Artikel der Beschriftung steht an der Region');
assert(lwNestKey($pdo, $lM2) === 'grauer-see', 'M: region_gewinnt -- die Beschriftung traegt den Artikel der Region');
assert(lwNestKey($pdo, $lM3) === 'erlensee', 'M: 🔴 ohne gueltige Entscheidung bleibt die Region unangetastet');
assert($scharf['zaehler']['nur_beschriftung'] === 1 && $scharf['regionen_betroffen'] === 1, 'M: der Befund danach zeigt genau den offenen Rest');

$entfernt = avesmapsLandschaftWikiBestand($pdo, $user, [
    'dry_run' => false, 'confirm' => 'apply',
    'entscheidungen' => [['region_public_id' => $rM3, 'aktion' => 'entfernen']],
]);
assert($entfernt['ergebnisse'][0]['status'] === 'erledigt' && lwNestKey($pdo, $lM3) === '', 'M: entfernen nimmt den Artikel an Region und Beschriftung');
$falschGehoben = avesmapsLandschaftWikiBestand($pdo, $user, [
    'dry_run' => false, 'confirm' => 'apply',
    'entscheidungen' => [['region_public_id' => $rM1, 'aktion' => 'heben', 'wiki_key' => 'nie-da']],
]);
assert($falschGehoben['ergebnisse'][0]['status'] === 'inzwischen_erledigt', 'M: eine stimmige Region wird nicht mehr angefasst');
lwStimmig($pdo, 'M');

echo "OK M -- Bestandslauf\n";

// =================================================================================================
// N. Eine zurueckgeholte Region gleicht ihre Beschriftungen an (Befund des Pruefagenten, 15.09.2026)
// =================================================================================================
// Zuweisung setzen -> Region loeschen -> Zuweisung zuruecknehmen (trifft die INAKTIVE Region, ihre stillgelegte
// Beschriftung bleibt stehen) -> Loeschen zuruecknehmen. Ohne das Angleichen beim Zurueckholen stuenden Region
// und Schild danach auf zwei verschiedenen Artikeln.
$pdo = lwPdo();
$urlN1 = lwArtikel($pdo, 'tiefsee', 'Tiefsee', 'See', 'Tiefsee');
$urlN2 = lwArtikel($pdo, 'flachsee', 'Flachsee', 'See', 'Flachsee');
$lN = lwLabel($pdo, $user, 'Tiefsee');
$rN = lwRegion($pdo, $user, 'Tiefsee', ['label_public_id' => $lN, 'wiki_url' => $urlN1]);
avesmapsAssignEcosystemWikiRegion($pdo, ['region_public_ids' => [$rN], 'wiki_url' => $urlN2, 'dry_run' => false, 'confirm' => 'apply'], 7);
$zuweisungN = (int) $pdo->query("SELECT MAX(id) FROM ecosystem_geometry_audit_log WHERE action = 'assign_wiki_region'")->fetchColumn();
assert(lwNestKey($pdo, $lN) === 'flachsee', 'N (Aufbau): das Schild traegt den neuen Artikel');
avesmapsDeleteEcosystemRegion($pdo, ['public_id' => $rN], 7);
$loeschenN = (int) $pdo->query("SELECT MAX(id) FROM ecosystem_geometry_audit_log WHERE action = 'delete_region'")->fetchColumn();
assert((int) $pdo->query('SELECT is_active FROM map_features WHERE public_id = ' . $pdo->quote($lN))->fetchColumn() === 0,
    'N (Aufbau): mit der Region ist ihr Schild stillgelegt');
avesmapsUndoEcosystemChange($pdo, ['audit_id' => $zuweisungN], 7);
assert((lwRegionZeile($pdo, $rN)['wiki_region_key'] ?? '') === 'tiefsee', 'N (Aufbau): die inaktive Region hat den alten Artikel zurueck');
avesmapsUndoEcosystemChange($pdo, ['audit_id' => $loeschenN], 7);
assert((int) (lwRegionZeile($pdo, $rN)['is_active'] ?? 0) === 1, 'N: die Region ist wieder da');
assert((int) $pdo->query('SELECT is_active FROM map_features WHERE public_id = ' . $pdo->quote($lN))->fetchColumn() === 1,
    'N: ihr Schild auch');
assert(lwNestKey($pdo, $lN) === 'tiefsee', 'N: 🔴 und es traegt den Artikel der zurueckgeholten Region, nicht den von vor dem Loeschen');
lwStimmig($pdo, 'N');

echo "OK N -- zurueckgeholte Region\n";

/** Der GANZE Inhalt aller Tabellen -- „schreibt in keine Tabelle" wird gemessen, nicht an einer Liste. */
function avesmapsLandschaftWikiNachzugStand(PDO $pdo): string
{
    $stand = [];
    foreach ($pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN) as $tabelle) {
        $stand[$tabelle] = $pdo->query('SELECT * FROM "' . $tabelle . '" ORDER BY rowid')->fetchAll(PDO::FETCH_ASSOC);
    }

    return (string) json_encode($stand, JSON_UNESCAPED_UNICODE);
}

echo "OK -- landschaft-wiki-eine-quelle: alle Wege halten die Invariante\n";
