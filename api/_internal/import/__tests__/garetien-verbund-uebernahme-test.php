<?php

declare(strict_types=1);

require_once __DIR__ . '/../garetien-uebernahme.php';

// --- A. Der Vermerk traegt Flaeche, Region und Verbund ---
$note = avesmapsGaretienVerbundVermerk('a30c-4471', '7d42-09e1', 'Silker Hain');
assert(str_contains($note, 'area:a30c-4471'));
assert(str_contains($note, 'region:7d42-09e1'));
assert(str_contains($note, 'verbund:Silker Hain'));

// --- B. Und er laesst sich wieder auseinandernehmen ---
$teile = avesmapsGaretienVermerkLesen($note);
assert($teile['area'] === 'a30c-4471');
assert($teile['region'] === '7d42-09e1');
assert($teile['verbund'] === 'Silker Hain');

// 💣 Der ALTE Vermerk ist eine nackte public_id -- er muss weiter lesbar sein, sonst verliert
// jede Ruecknahme eines vor diesem Umbau importierten Objekts ihr Ziel.
$alt = avesmapsGaretienVermerkLesen('11112222-3333-4444-5555-666677778888');
assert($alt['area'] === '', 'ein alter Vermerk hat keine Flaechen-id');
assert($alt['region'] === '11112222-3333-4444-5555-666677778888', 'der alte Vermerk IST die public_id');
assert($alt['verbund'] === '');

// --- C. Ein leerer Vermerk ist kein Absturz ---
$leer = avesmapsGaretienVermerkLesen('');
assert($leer === ['area' => '', 'region' => '', 'verbund' => '']);

// =================================================================================================
// D. DER EIGENTLICHE IMPORT -- zwei Fragmente werden zu EINER Region mit ZWEI Flaechen.
// =================================================================================================
//
// 🔴 EIGENE ERGAENZUNG DIESER SITZUNG, NICHT IM BRIEF GEFORDERT. Der Brief prueft (A-C) nur die
// reinen Vermerk-Funktionen -- das ist die Zusage "Vermerk hin und zurueck", nicht die Zusage
// "Aufgabe 6 legt einen Verbund wirklich an". Ohne diesen Abschnitt waere die Verdrahtung in
// avesmapsGaretienFlaecheAnlegen/avesmapsGaretienUebernehmen (der sechste Parameter, die Suche
// ueber avesmapsGaretienVerbundRegion, der WIRKLICH geschriebene Vermerk) nie ausgefuehrt worden --
// dieselbe Klasse Luecke, die die Fixrunden von Aufgabe 2/3/5 schon mehrfach gefunden haben
// ("beide Haelften gruen, die Naht ungeprueft").
//
// Minimaler eigener SQLite-Pruefstand (kein Wiederverwenden von garetien-uebernahme-test.php --
// dessen Klassen/Funktionen stehen im globalen Namensraum EINES ANDEREN Prozesses; ein `require`
// dieser riesigen Datei wuerde deren 450+ Zusicherungen ein zweites Mal ausfuehren). Uebersetzt
// nur, was dieser eine Ablauf wirklich braucht -- dieselbe Uebersetzungs-Naht (exec/prepare) wie
// in garetien-uebernahme-test.php, hier auf das Notwendigste gekuerzt.
final class AvesmapsGaretienVerbundUebernahmeTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        foreach (['map_revision', 'ecosystem_revision'] as $tabelle) {
            if (str_contains($statement, 'INTO ' . $tabelle) && str_contains($statement, 'ON DUPLICATE KEY UPDATE')) {
                $statement = 'INSERT INTO ' . $tabelle . ' (id, revision) VALUES (1, 2)
                              ON CONFLICT(id) DO UPDATE SET revision = ' . $tabelle . '.revision + 1';
            }
        }
        if (str_contains($statement, 'AUTO_INCREMENT')
            || str_contains($statement, 'ENGINE=InnoDB')
            || str_starts_with(ltrim($statement), 'ALTER TABLE')) {
            return 0;
        }
        $statement = str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $statement);

        return parent::exec($statement);
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
        $query = str_replace('NOW(3)', "datetime('now')", $query);
        $query = str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $query);
        if (str_contains($query, 'INSERT INTO app_setting') && str_contains($query, 'ON DUPLICATE KEY UPDATE')) {
            $query = 'INSERT INTO app_setting (setting_key, setting_value) VALUES (:k, :v)
                      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value';
        }

        return parent::prepare($query, $options);
    }
}

function avesmapsGaretienVerbundUebernahmeTestPdo(): PDO
{
    $pdo = new AvesmapsGaretienVerbundUebernahmeTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
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
        undone_by_log_id INTEGER NULL, operation_id TEXT NULL, operation_label TEXT NULL)');
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
        undone_at TEXT NULL, undone_by INTEGER NULL, undone_by_log_id INTEGER NULL, operation_id TEXT NULL, operation_label TEXT NULL)');
    $pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label) VALUES ('vegetation', 'wald', 'Wald')");
    $pdo->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT)');
    // Nur die LEEREN Tabellen: avesmapsGaretienQuellenZiel('region', ...) fragt
    // avesmapsEcosystemLabelSourceTarget, und die schlaegt in feature_sources nach, auch wenn
    // dieser Ablauf (kein Artikel im Schluessel, siehe avesmapsGaretienVerbundTestFragment) am
    // Ende nichts hineinschreibt.
    $pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, url_hash TEXT UNIQUE,
        wiki_key TEXT NULL, label TEXT, source_type TEXT, is_official INTEGER DEFAULT 0, created_by INTEGER NULL,
        license TEXT NOT NULL DEFAULT \'\', attribution TEXT NOT NULL DEFAULT \'\',
        own_fields TEXT NOT NULL DEFAULT \'\', created_at TEXT DEFAULT "2026-01-01")');
    $pdo->exec("CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
        entity_public_id TEXT NOT NULL, source_id INTEGER NOT NULL, status TEXT DEFAULT 'approved',
        created_by INTEGER NULL, origin TEXT DEFAULT 'manual', reference_kind TEXT NULL, pages TEXT NULL,
        note TEXT NULL, created_at TEXT NOT NULL DEFAULT \"2026-01-01 00:00:00\",
        UNIQUE(entity_type, entity_public_id, source_id))");
    avesmapsEnsureSyncPlanTablesSqlite($pdo);

    return $pdo;
}

/** Ein 20x20-Quadrat-Ring ab (ox, oy) -- innerhalb der Kartenbounds 0..1024 (AGENTS.md §1). */
function avesmapsGaretienVerbundTestRing(float $ox, float $oy): array
{
    return [[$ox, $oy], [$ox + 20, $oy], [$ox + 20, $oy + 20], [$ox, $oy + 20], [$ox, $oy]];
}

/**
 * Ein 'new'-Flaechen-Item anlegen -- OHNE Artikel im Schluessel (`#<n>`, siehe
 * avesmapsGaretienArtikelNameAusSchluessel), damit avesmapsGaretienQuellenAnlegen keine
 * Sammelquelle verknuepfen will: dieser Pruefstand traegt bewusst keine `sources`/
 * `feature_sources`-Tabellen, weil sie fuer DIESE Zusicherung (Region/Flaeche/Vermerk) nichts
 * beitragen -- ein Test, der mehr Infrastruktur aufbaut als er braucht, verschleiert im
 * Fehlerfall, welche Zusicherung wirklich etwas ueber den Verbund aussagt.
 */
function avesmapsGaretienVerbundTestFragment(PDO $pdo, int $runId, string $label, int $nr, array $ring): int
{
    $pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected)
                   VALUES (?, ?, NULL, 'new', ?, NULL, ?, NULL, 1)")
        ->execute([
            $runId,
            'ggp:Waelder:Wald:#' . $nr,
            $label,
            json_encode([
                'herkunft' => 'garetien', 'ziel' => 'region', 'kind' => 'vegetation', 'subtyp' => 'wald',
                'name' => $label, 'geometry' => ['type' => 'Polygon', 'coordinates' => [$ring]],
            ], JSON_UNESCAPED_UNICODE),
        ]);

    return (int) $pdo->lastInsertId();
}

$pdoD = avesmapsGaretienVerbundUebernahmeTestPdo();
$runIdD = avesmapsSyncPlanStartRun($pdoD, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'test-verbund-import');
$itemD1 = avesmapsGaretienVerbundTestFragment($pdoD, $runIdD, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
$itemD2 = avesmapsGaretienVerbundTestFragment($pdoD, $runIdD, 'Silker Hain 2', 2, avesmapsGaretienVerbundTestRing(200, 200));

$ergebnisD = avesmapsGaretienUebernehmen($pdoD, $runIdD, [$itemD1, $itemD2], ['id' => 7], null, [
    $itemD1 => ['verbund' => 'Silker Hain'],
    $itemD2 => ['verbund' => 'Silker Hain'],
]);
assert($ergebnisD['fehler'] === [], 'D: keine Fehler erwartet: ' . json_encode($ergebnisD['fehler'], JSON_UNESCAPED_UNICODE));
assert($ergebnisD['angelegt_je_form']['region'] === 2, 'D: beide Items zaehlen als "region" (jedes legt etwas an)');

$regionenD = $pdoD->query('SELECT id, public_id FROM ecosystem_region')->fetchAll(PDO::FETCH_ASSOC);
assert(count($regionenD) === 1, 'D: GENAU EINE Region fuer zwei Fragmente, bekommen: ' . count($regionenD));

$flaechenD = $pdoD->query('SELECT id, public_id, region_id FROM ecosystem_area')->fetchAll(PDO::FETCH_ASSOC);
assert(count($flaechenD) === 2, 'D: GENAU ZWEI Flaechen, bekommen: ' . count($flaechenD));
assert((int) $flaechenD[0]['region_id'] === (int) $regionenD[0]['id']
    && (int) $flaechenD[1]['region_id'] === (int) $regionenD[0]['id'],
    'D: BEIDE Flaechen haengen an DERSELBEN Region');

$labelnD = $pdoD->query("SELECT id FROM map_features WHERE feature_type = 'label'")->fetchAll(PDO::FETCH_ASSOC);
assert(count($labelnD) === 1,
    'D: GENAU EIN Label -- ein zweites waere ein zweiter Anker derselben Kaskade: ' . count($labelnD));

$itemsD = $pdoD->query('SELECT id, apply_state, apply_note FROM sync_plan_item ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
$noteD1 = avesmapsGaretienVermerkLesen((string) $itemsD[0]['apply_note']);
$noteD2 = avesmapsGaretienVermerkLesen((string) $itemsD[1]['apply_note']);
assert($itemsD[0]['apply_state'] === 'done' && $itemsD[1]['apply_state'] === 'done', 'D: beide Items sind done');
assert($noteD1['verbund'] === 'Silker Hain' && $noteD2['verbund'] === 'Silker Hain',
    'D: BEIDE Vermerke nennen den Verbund');
assert($noteD1['region'] === $noteD2['region'], 'D: BEIDE Vermerke zeigen auf dieselbe Region');
assert($noteD1['region'] === (string) $regionenD[0]['public_id'],
    'D: der Vermerk nennt die ECHTE Region-public_id, keine geratene');
assert($noteD1['area'] !== '' && $noteD2['area'] !== '' && $noteD1['area'] !== $noteD2['area'],
    'D: BEIDE Vermerke nennen verschiedene, nicht-leere Flaechen');

echo "OK -- garetien-verbund-uebernahme\n";
