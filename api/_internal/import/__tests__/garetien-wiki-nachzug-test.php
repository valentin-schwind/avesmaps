<?php

declare(strict_types=1);

// Aufgabe 13 des Bauplans „Garetien-Importer vereint" (14.09.2026): DER BESTAND.
// Den Wiki-Schluessel an Flaechen nachziehen, die ein Garetien-Import angelegt hat, BEVOR Aufgabe 2
// ihn selbst an die Region schrieb. Owner 14.09.2026: „ja, wiki-schluessel nachziehen mit trockenlauf".
//
// 🔴 DER TEST FUEHRT DEN LAUF AUS -- gegen einen Bestand, der mit der ECHTEN Uebernahme angelegt und
// danach auf den Stand vor Aufgabe 2 zurueckgedreht wird (Region ohne Schluessel, Beschriftung mit).
// So traegt die Beschriftung genau das Nest, das avesmapsWikiRegionBuildAssignObject baut, und keine
// Handattrappe davon.
//
// ⚠️ SQLite kennt EINE MySQL-Eigenschaft nicht, an der dieser Lauf haengt: DDL beendet in MySQL eine
// offene Transaktion mit einem impliziten COMMIT. Dass der Lauf weder eine Transaktion oeffnet noch
// einen Ensure-Helfer ruft, prueft deshalb Abschnitt G am QUELLTEXT, nicht der Ablauf.
//
// Lauf aus dem Repo-Wurzelverzeichnis:
//   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll api/_internal/import/__tests__/garetien-wiki-nachzug-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../garetien-wiki-nachzug.php';

// Minimaler SQLite-Pruefstand -- dieselbe Uebersetzungs-Naht wie garetien-verbund-uebernahme-test.php,
// gekuerzt auf das, was dieser Ablauf anfasst (keine Artikelquellen, also keine sources-Upserts).
final class AvesmapsGaretienWikiNachzugTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        foreach (['map_revision', 'ecosystem_revision'] as $tabelle) {
            if (str_contains($statement, 'INTO ' . $tabelle) && str_contains($statement, 'ON DUPLICATE KEY UPDATE')) {
                // ⚠️ MEHRZEILIG uebersetzt, nicht auf Zeile 1 verkuerzt: avesmapsNextEcosystemRevision hebt
                // Zeile 1 UND Zeile 2 (`VALUES (1, 2), (2, 2)`), und Zeile 2 ist die, die das ETag der
                // Kartennutzlast liest (avesmapsClimateReadStamp). Abschnitt D prueft genau sie.
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
        $query = str_replace('NOW(3)', "datetime('now')", $query);
        $query = str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $query);
        $query = str_replace("ESCAPE '\\\\'", "ESCAPE '\\'", $query);
        if (str_contains($query, 'INSERT INTO app_setting') && str_contains($query, 'ON DUPLICATE KEY UPDATE')) {
            $query = 'INSERT INTO app_setting (setting_key, setting_value) VALUES (:k, :v)
                      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value';
        }

        return parent::prepare($query, $options);
    }
}

function avesmapsGaretienWikiNachzugTestPdo(): PDO
{
    $pdo = new AvesmapsGaretienWikiNachzugTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
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
    $pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, url_hash TEXT UNIQUE,
        wiki_key TEXT NULL, label TEXT, source_type TEXT, is_official INTEGER DEFAULT 0, created_by INTEGER NULL,
        license TEXT NOT NULL DEFAULT \'\', attribution TEXT NOT NULL DEFAULT \'\',
        own_fields TEXT NOT NULL DEFAULT \'\', created_at TEXT DEFAULT "2026-01-01")');
    $pdo->exec("CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
        entity_public_id TEXT NOT NULL, source_id INTEGER NOT NULL, status TEXT DEFAULT 'approved',
        created_by INTEGER NULL, origin TEXT DEFAULT 'manual', reference_kind TEXT NULL, pages TEXT NULL,
        note TEXT NULL, created_at TEXT NOT NULL DEFAULT \"2026-01-01 00:00:00\",
        UNIQUE(entity_type, entity_public_id, source_id))");
    // ⚠️ Nur die Spalten, die avesmapsGaretienWikiLandschaftVorschlag/-Zuweisung lesen.
    $pdo->exec('CREATE TABLE wiki_region_staging (wiki_key TEXT PRIMARY KEY, title TEXT, name TEXT, match_key TEXT,
        art TEXT, wiki_url TEXT, continent TEXT, region_parent TEXT, synonyms_json TEXT, neighbors_json TEXT)');
    avesmapsEnsureSyncPlanTablesSqlite($pdo);

    return $pdo;
}

/** Der GANZE Inhalt aller Tabellen -- „schreibt in keine Tabelle" wird gemessen, nicht an einer Liste. */
function avesmapsGaretienWikiNachzugTestStand(PDO $pdo): string
{
    $stand = [];
    $tabellen = $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        ->fetchAll(PDO::FETCH_COLUMN);
    foreach ($tabellen as $tabelle) {
        $stand[$tabelle] = $pdo->query('SELECT * FROM "' . $tabelle . '" ORDER BY rowid')->fetchAll(PDO::FETCH_ASSOC);
    }

    return (string) json_encode($stand, JSON_UNESCAPED_UNICODE);
}

/** Ein Artikel im Wiki-Staging; die Adresse traegt dieselbe Seite, aus der der Schluessel folgt. */
function avesmapsGaretienWikiNachzugTestArtikel(PDO $pdo, string $name): string
{
    $url = 'https://de.wiki-aventurica.de/wiki/' . str_replace(' ', '_', $name);
    $pdo->prepare('INSERT INTO wiki_region_staging (wiki_key, title, name, match_key, art, wiki_url) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([avesmapsEcosystemWikiRegionKey($url), $name, $name, avesmapsWikiSyncCreateMatchKey($name), 'Wald', $url]);

    return $url;
}

/**
 * Ein Flaechen-Item anlegen UND mit der echten Uebernahme importieren.
 *
 * @return array{item:int, region:string, region_id:int, area:string, label:string}
 */
function avesmapsGaretienWikiNachzugTestImport(PDO $pdo, int $runId, string $name, int $nr, array $rumpf = []): array
{
    $o = 20.0 + $nr * 40.0;
    $ring = [[$o, $o], [$o + 20, $o], [$o + 20, $o + 20], [$o, $o + 20], [$o, $o]];
    $pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected)
                   VALUES (?, ?, NULL, 'new', ?, NULL, ?, NULL, 1)")
        ->execute([
            $runId,
            'ggp:Waelder:Wald:#' . $nr,
            $name,
            json_encode([
                'herkunft' => 'garetien', 'ziel' => 'region', 'kind' => 'vegetation', 'subtyp' => 'wald',
                'name' => $name, 'geometry' => ['type' => 'Polygon', 'coordinates' => [$ring]],
            ], JSON_UNESCAPED_UNICODE),
        ]);
    $item = (int) $pdo->lastInsertId();
    $ergebnis = avesmapsGaretienUebernehmen($pdo, $runId, [$item], ['id' => 7], null, [$item => $rumpf]);
    assert($ergebnis['fehler'] === [], "Aufbau: {$name} legt an: " . json_encode($ergebnis['fehler'], JSON_UNESCAPED_UNICODE));

    $vermerk = avesmapsGaretienVermerkLesen((string) $pdo->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $item)->fetchColumn());
    $region = avesmapsGaretienWikiNachzugTestRegion($pdo, $vermerk['region']);

    return [
        'item' => $item,
        'region' => $vermerk['region'],
        'region_id' => (int) $region['id'],
        'area' => $vermerk['area'],
        'label' => (string) $region['label_public_id'],
    ];
}

function avesmapsGaretienWikiNachzugTestRegion(PDO $pdo, string $publicId): array
{
    $stmt = $pdo->prepare('SELECT * FROM ecosystem_region WHERE public_id = ?');
    $stmt->execute([$publicId]);
    $zeile = $stmt->fetch(PDO::FETCH_ASSOC);
    assert(is_array($zeile), 'Aufbau: Region ' . $publicId . ' existiert');

    return $zeile;
}

function avesmapsGaretienWikiNachzugTestLabelJson(PDO $pdo, string $publicId): string
{
    $stmt = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = ?');
    $stmt->execute([$publicId]);

    return (string) $stmt->fetchColumn();
}

function avesmapsGaretienWikiNachzugTestZahl(PDO $pdo, string $sql): int
{
    return (int) $pdo->query($sql)->fetchColumn();
}

// =================================================================================================
// A. DER BESTAND -- mit der echten Uebernahme angelegt, dann auf den Stand VOR Aufgabe 2 gedreht
// =================================================================================================
$admin = ['id' => 7, 'role' => 'admin'];
$pdo = avesmapsGaretienWikiNachzugTestPdo();
$run = avesmapsSyncPlanStartRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'bestand');
$urls = [];
foreach (['Silker Hain', 'Tannwald', 'Muehlwald', 'Grenzforst', 'Schattenwald', 'Eichenhain', 'Birkenwald',
    'Fichtenwald', 'Erlenwald', 'Kiefernwald', 'Handwald'] as $artikel) {
    $urls[$artikel] = avesmapsGaretienWikiNachzugTestArtikel($pdo, $artikel);
}
// ⚠️ „Nirgendwald" steht bewusst NICHT im Staging: seine Beschriftung bekommt keinen Treffer.

$a = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Silker Hain', 1);
$b = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Tannwald', 2);
$c = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Muehlwald', 3);
$v1 = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Grenzforst 1', 4, ['verbund' => 'Grenzforst']);
$v2 = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Grenzforst 2', 5, ['verbund' => 'Grenzforst']);
$inaktiv = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Schattenwald', 6);
$schon = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Eichenhain', 7);
$anders = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Birkenwald', 8);
$ohneWiki = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Nirgendwald', 9);
$ohneLabel = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Fichtenwald', 10);
$falscheAdresse = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Erlenwald', 11);
$f = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Kiefernwald', 12);
$hand = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Handwald', 13);

// Vorbedingungen: Aufgabe 2 ist gebaut (Schluessel an der Region), der Verbund ist EINE Region.
assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $schon['region'])['wiki_region_key'] === 'eichenhain',
    'A (Vorbedingung): ein NEUER Import traegt den Schluessel an der Region -- Aufgabe 2 ist gebaut');
assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $ohneWiki['region'])['wiki_region_key'] === null,
    'A (Vorbedingung): ohne Treffer kein Schluessel');
assert($v1['region'] === $v2['region'] && $v2['label'] === $v1['label'], 'A (Vorbedingung): der Verbund ist EINE Region mit EINER Beschriftung');

// Der Stand VOR Aufgabe 2: Region leer, Beschriftung traegt ihr Nest weiter.
$zurueck = $pdo->prepare('UPDATE ecosystem_region SET wiki_url = NULL, wiki_region_key = NULL WHERE public_id = ?');
foreach ([$a, $b, $c, $v1, $inaktiv, $ohneLabel, $falscheAdresse, $f, $hand] as $objekt) {
    $zurueck->execute([$objekt['region']]);
}
// Die drei Vermerkformen, die im Bestand vorkommen: nackt (A), `area:… | region:…` OHNE `verbund:` (B),
// und die heutige Form `area:… | region:… | verbund:…` (C leer, Verbund mit Stamm).
$pdo->prepare('UPDATE sync_plan_item SET apply_note = ? WHERE id = ?')->execute([$a['region'], $a['item']]);
$pdo->prepare('UPDATE sync_plan_item SET apply_note = ? WHERE id = ?')
    ->execute(['area:' . $b['area'] . ' | region:' . $b['region'], $b['item']]);
// Die Uebersprung-Faelle.
$pdo->prepare('UPDATE ecosystem_region SET is_active = 0 WHERE public_id = ?')->execute([$inaktiv['region']]);
$andereUrl = 'https://de.wiki-aventurica.de/wiki/Anderer_Forst';
$pdo->prepare('UPDATE ecosystem_region SET wiki_url = ?, wiki_region_key = ? WHERE public_id = ?')
    ->execute([$andereUrl, avesmapsEcosystemWikiRegionKey($andereUrl), $anders['region']]);
$pdo->prepare('UPDATE map_features SET is_active = 0 WHERE public_id = ?')->execute([$ohneLabel['label']]);
$props = json_decode(avesmapsGaretienWikiNachzugTestLabelJson($pdo, $falscheAdresse['label']), true);
$props['wiki_region']['wiki_url'] = 'https://de.wiki-aventurica.de/wiki/Ganz_Anders';
$pdo->prepare('UPDATE map_features SET properties_json = ? WHERE public_id = ?')
    ->execute([json_encode($props, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $falscheAdresse['label']]);

// 🔴 FREMDE DATENKLASSEN, die NIE mitgezaehlt werden duerfen -- alle zeigen auf „Handwald", eine
// aktive Region mit leerem Schluessel und Beschriftung MIT Treffer. Zaehlte eine davon mit, stiege
// `wuerde_setzen` von 5 auf 6.
// (1) Die Region selbst traegt keinen Garetien-Vermerk mehr (von Hand gezeichnet oder zurueckgenommen).
$pdo->prepare('UPDATE sync_plan_item SET apply_state = NULL, apply_note = NULL WHERE id = ?')->execute([$hand['item']]);
// (2) Eine ERGAENZUNG ('changed') an ihr -- die Region hat der Import nicht angelegt.
$pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, after_json, selected, apply_state, apply_note)
               VALUES (?, 'ggp:Waelder:Wald:#90', ?, 'changed', 'Handwald', '{}', 1, 'done', ?)")
    ->execute([$run, $hand['region'], $hand['region']]);
// (3) Ein uebernommenes 'new' einer FREMDEN Vorschau-Art.
$pdo->exec("INSERT INTO sync_plan_run (kind, state) VALUES ('citymap', 'open')");
$fremderLauf = (int) $pdo->lastInsertId();
$pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, change_type, label, after_json, selected, apply_state, apply_note)
               VALUES (?, 'karte:1', 'new', 'Karte', '{}', 1, 'done', ?)")
    ->execute([$fremderLauf, $hand['region']]);
// (4) Ein uebernommenes 'new' dieses Imports, dessen Vermerk auf KEINE Region zeigt (Gipfel, Ort, Weg).
$pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, change_type, label, after_json, selected, apply_state, apply_note)
               VALUES (?, 'ggp:Berge:Berggipfel:#91', 'new', 'Hoher Stein', '{}', 1, 'done', ?)")
    ->execute([$run, $hand['label']]);
// (5) Eine ABGELEHNTE Zeile -- nie uebernommen, Entscheidung dauerhaft.
$pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, change_type, label, after_json, selected)
               VALUES (?, 'ggp:Waelder:Wald:#14', 'new', 'Ablehnwald', '{}', 0)")
    ->execute([$run]);
$abgelehnt = (int) $pdo->lastInsertId();
$pdo->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, declined_at) VALUES (?, 'ggp:Waelder:Wald:#14', 'new', '2026-09-01 10:00:00')")
    ->execute([AVESMAPS_GARETIEN_PLAN_KIND]);
// (6) R-q (Zusatz des Koordinators zu Aufgabe 13): ein `nur_quelle:`-Vermerk zeigt auf eine SIEDLUNG,
// nie auf eine Region -- avesmapsGaretienVermerkLesen liest `nur_quelle`/`angelegt` als unbekannte
// Felder und liefert dafuer eine leere `region`. Zaehlt unter `andere_ziele`, ist NIE Kandidat.
// Gebaut ueber den ECHTEN Vermerk-Erzeuger (avesmapsGaretienNurQuelleVermerk), keine Handabschrift
// des Formats -- die Trennzeichen (` | angelegt:`) sind sein Geschaeft, nicht dieses Tests.
$nurQuelleSiedlung = 'siedlung-furtstett';
$pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, change_type, label, after_json, selected, apply_state, apply_note)
               VALUES (?, 'ggp:Siedlungen:Dorf:#92', 'new', 'Furtstett', '{}', 1, 'done', ?)")
    ->execute([$run, avesmapsGaretienNurQuelleVermerk($nurQuelleSiedlung, true)]);

echo "OK -- garetien-wiki-nachzug: Bestand aufgebaut\n";

// =================================================================================================
// B. DER TROCKENLAUF IST DIE VORGABE -- er zaehlt, nennt Gruende, zeigt eine Stichprobe, schreibt nichts
// =================================================================================================
$standVorher = avesmapsGaretienWikiNachzugTestStand($pdo);
$t1 = avesmapsGaretienWikiNachzug($pdo, $admin);
assert(avesmapsGaretienWikiNachzugTestStand($pdo) === $standVorher, 'B: der Trockenlauf schreibt in KEINE Tabelle');
assert($t1['dry_run'] === true, 'B: ohne Angabe ist es ein Trockenlauf');
assert($t1['vermerke'] === 14, 'B: 14 uebernommene Neu-Zeilen dieses Imports mit Vermerk (13 Flaechen + 1 nur_quelle), bekommen: ' . $t1['vermerke']);
assert($t1['andere_ziele'] === 2, 'B: ZWEI Vermerke zeigen auf keine Region (der Gipfel, die nur_quelle-Siedlung), bekommen: ' . $t1['andere_ziele']);
assert($t1['geprueft'] === 11, 'B: 11 verschiedene Regionen -- der Verbund zaehlt EINMAL, bekommen: ' . $t1['geprueft']);
assert($t1['wuerde_setzen'] === 5, 'B: fuenf Kandidaten (nackt, ohne verbund:, heutige Form, Verbund, Kiefernwald), bekommen: '
    . $t1['wuerde_setzen']);
assert($t1['uebersprungen'] === [
    'region_inaktiv' => 1, 'schon_gesetzt' => 1, 'anderer_schluessel' => 1,
    'beschriftung_fehlt' => 1, 'beschriftung_ohne_wiki' => 1, 'adresse_passt_nicht' => 1,
], 'B: je Grund genau eine Region: ' . json_encode($t1['uebersprungen']));
assert($t1['wuerde_setzen'] + array_sum($t1['uebersprungen']) === $t1['geprueft'],
    'B: jede gepruefte Region hat GENAU ein Urteil -- keine faellt durch');
assert(array_column($t1['stichprobe'], 'name') === ['Silker Hain', 'Tannwald', 'Muehlwald', 'Grenzforst', 'Kiefernwald'],
    'B: die Stichprobe nennt die Kandidaten nach Region-id: ' . json_encode(array_column($t1['stichprobe'], 'name'), JSON_UNESCAPED_UNICODE));
assert($t1['stichprobe'][0]['region_id'] === $a['region_id'] && $t1['stichprobe'][0]['wiki_key'] === 'silker-hain'
    && $t1['stichprobe'][0]['wiki_url'] === $urls['Silker Hain'],
    'B: eine Stichprobenzeile traegt Region-id, Schluessel und Adresse: ' . json_encode($t1['stichprobe'][0], JSON_UNESCAPED_UNICODE));
assert(count($t1['widersprueche']) === 1 && $t1['widersprueche'][0]['name'] === 'Birkenwald'
    && $t1['widersprueche'][0]['region_schluessel'] === 'anderer-forst'
    && $t1['widersprueche'][0]['beschriftung_schluessel'] === 'birkenwald',
    'B: der Widerspruch wird BENANNT, nicht nur gezaehlt: ' . json_encode($t1['widersprueche'], JSON_UNESCAPED_UNICODE));
assert($t1['gesetzt'] === 0 && $t1['fehler'] === [] && $t1['cursor'] === null && $t1['remaining'] === 5,
    'B: ein Trockenlauf setzt nichts, und `remaining` nennt, was ein scharfer Lauf vor sich haette');
$t1ab = avesmapsGaretienWikiNachzug($pdo, $admin, true, 200, $c['region_id']);
assert($t1ab['remaining'] === 2 && array_column($t1ab['stichprobe'], 'name') === ['Grenzforst', 'Kiefernwald'],
    'B: `ab_id` verschiebt Stichprobe und Rest, nie die Zaehlung: ' . json_encode($t1ab['stichprobe'], JSON_UNESCAPED_UNICODE));
assert($t1ab['wuerde_setzen'] === 5, 'B: die Zaehlung bleibt die ganze');
assert(avesmapsGaretienWikiNachzugTestStand($pdo) === $standVorher, 'B: auch der Trockenlauf mit `ab_id` schreibt nichts');

// Das Urteil ist REIN -- zwei Grenzfaelle ohne Datenbank.
$regionOhne = ['is_active' => 1, 'wiki_region_key' => null];
$regionMit = ['is_active' => 1, 'wiki_region_key' => 'eichenhain'];
$labelOhneNest = ['is_active' => 1, 'feature_type' => 'label', 'properties_json' => '{}'];
$labelFtp = ['is_active' => 1, 'feature_type' => 'label',
    'properties_json' => json_encode(['wiki_region' => ['wiki_key' => 'x', 'wiki_url' => 'ftp://de.wiki-aventurica.de/wiki/X']])];
assert(avesmapsGaretienWikiNachzugUrteil($regionMit, $labelOhneNest)['grund'] === 'schon_gesetzt',
    'B: Region mit Schluessel, Beschriftung ohne -- die Region ist fertig, nichts zu setzen');
assert(avesmapsGaretienWikiNachzugUrteil($regionOhne, $labelFtp)['grund'] === 'adresse_passt_nicht',
    'B: eine Adresse, die der Hausschreiber ablehnen wuerde, wird gar nicht erst angeboten');
assert(avesmapsGaretienWikiNachzugUrteil($regionOhne, null)['grund'] === 'beschriftung_fehlt', 'B: ohne Beschriftung nichts');

echo "OK -- garetien-wiki-nachzug: Trockenlauf\n";

// =================================================================================================
// C. NUR ADMINS -- auch der Trockenlauf, und ohne einen Schreibvorgang
// =================================================================================================
foreach ([['id' => 8, 'role' => 'editor'], ['id' => 9, 'role' => 'reviewer'], ['id' => 10]] as $wer) {
    foreach ([true, false] as $trocken) {
        $abgewiesen = false;
        try {
            avesmapsGaretienWikiNachzug($pdo, $wer, $trocken);
        } catch (RuntimeException $abbruch) {
            $abgewiesen = str_contains($abbruch->getMessage(), 'Administratoren');
        }
        assert($abgewiesen, 'C: ' . json_encode($wer) . ' wird abgewiesen (' . ($trocken ? 'Trockenlauf' : 'scharf') . ')');
    }
}
assert(avesmapsGaretienWikiNachzugTestStand($pdo) === $standVorher, 'C: die Abweisung hat nichts geschrieben');

echo "OK -- garetien-wiki-nachzug: Admin-Riegel der Bibliothek\n";

// =================================================================================================
// D. SCHARF, BLOCKWEISE -- je Region der Hausschreiber, nie ueberschreiben, Fehler gemeldet
// =================================================================================================
$mapRevisionVorher = avesmapsGaretienWikiNachzugTestZahl($pdo, 'SELECT revision FROM map_revision WHERE id = 1');
$ecoZeile2Vorher = avesmapsGaretienWikiNachzugTestZahl($pdo, 'SELECT revision FROM ecosystem_revision WHERE id = 2');
$itemsVorher = json_encode($pdo->query('SELECT * FROM sync_plan_item ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
$entscheidungVorher = json_encode($pdo->query('SELECT * FROM sync_decision')->fetchAll(PDO::FETCH_ASSOC));
$labelsVorher = [];
foreach (['a' => $a, 'b' => $b, 'c' => $c, 'v' => $v1, 'f' => $f] as $k => $objekt) {
    $labelsVorher[$k] = avesmapsGaretienWikiNachzugTestLabelJson($pdo, $objekt['label']);
}
$unberuehrtVorher = [];
foreach ([$inaktiv, $schon, $anders, $ohneWiki, $ohneLabel, $falscheAdresse, $hand] as $objekt) {
    $unberuehrtVorher[$objekt['region']] = avesmapsGaretienWikiNachzugTestRegion($pdo, $objekt['region']);
}

// 🪤 Ein Editor weist „Tannwald" zu, WAEHREND der Lauf „Silker Hain" schreibt -- nachgestellt ueber einen
// Trigger. Der Lauf muss das beim Schreiben von Tannwald sehen und stehen lassen.
$pdo->exec("CREATE TRIGGER wiki_nachzug_test_nachbar AFTER UPDATE OF wiki_url ON ecosystem_region
    WHEN NEW.public_id = '{$a['region']}'
    BEGIN
        UPDATE ecosystem_region SET wiki_url = 'https://de.wiki-aventurica.de/wiki/Fremder_Hain', wiki_region_key = 'fremder-hain'
         WHERE public_id = '{$b['region']}';
    END");
$s1 = avesmapsGaretienWikiNachzug($pdo, $admin, false, 2);
$pdo->exec('DROP TRIGGER wiki_nachzug_test_nachbar');
assert($s1['dry_run'] === false, 'D: `false` ist scharf');
assert($s1['gesetzt'] === 1 && $s1['inzwischen_erledigt'] === 1 && $s1['fehler'] === [],
    'D: Block 1 setzt Silker Hain, laesst Tannwald stehen: ' . json_encode($s1, JSON_UNESCAPED_UNICODE));
assert($s1['cursor'] === $b['region_id'] && $s1['remaining'] === 3,
    'D: Deckel 2 -- der Cursor steht hinter dem zweiten Kandidaten, drei bleiben: ' . json_encode([$s1['cursor'], $s1['remaining']]));
$regionA = avesmapsGaretienWikiNachzugTestRegion($pdo, $a['region']);
assert($regionA['wiki_url'] === $urls['Silker Hain'] && $regionA['wiki_region_key'] === 'silker-hain',
    'D: die Region traegt Adresse UND abgeleiteten Schluessel: ' . json_encode($regionA, JSON_UNESCAPED_UNICODE));
assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $b['region'])['wiki_region_key'] === 'fremder-hain',
    'D: 🔴 der Schluessel, den ein Editor inzwischen gesetzt hat, wird NIE ueberschrieben');
assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $c['region'])['wiki_region_key'] === null,
    'D: was hinter dem Deckel liegt, bleibt fuer den naechsten Block');
assert(avesmapsGaretienWikiNachzugTestZahl($pdo, 'SELECT revision FROM ecosystem_revision WHERE id = 2') > $ecoZeile2Vorher,
    'D: der Hausschreiber stempelt die Landschaften-Revision -- Zeile 2 ist die, die das ETag der Kartennutzlast liest');

// Block 2, fortgesetzt hinter dem Cursor -- und „Kiefernwald" scheitert in der Datenbank.
$pdo->exec("CREATE TRIGGER wiki_nachzug_test_abbruch BEFORE UPDATE OF wiki_url ON ecosystem_region
    WHEN NEW.public_id = '{$f['region']}'
    BEGIN SELECT RAISE(ABORT, 'Testabbruch'); END");
$logDatei = (string) tempnam(sys_get_temp_dir(), 'gwn');
$logVorher = ini_set('error_log', $logDatei);
$s2 = avesmapsGaretienWikiNachzug($pdo, $admin, false, 200, (int) $s1['cursor']);
ini_set('error_log', (string) $logVorher);
assert($s2['gesetzt'] === 2 && $s2['inzwischen_erledigt'] === 0,
    'D: Block 2 setzt Muehlwald und den Verbund -- der Fehler haelt den Lauf nicht an: ' . json_encode($s2, JSON_UNESCAPED_UNICODE));
assert(count($s2['fehler']) === 1 && $s2['fehler'][0]['region_id'] === $f['region_id'] && $s2['fehler'][0]['name'] === 'Kiefernwald',
    'D: der Fehlschlag wird MIT Namen gemeldet: ' . json_encode($s2['fehler'], JSON_UNESCAPED_UNICODE));
assert(!str_contains($s2['fehler'][0]['grund'], 'Testabbruch'),
    'D: ein Datenbanktext geht nicht in die Antwort (AGENTS.md §10, M1)');
assert(str_contains((string) file_get_contents($logDatei), 'Testabbruch'), 'D: ... sondern ins Protokoll -- gemeldet, nicht geschluckt');
@unlink($logDatei);
assert($pdo->inTransaction() === false, 'D: nach dem Fehlschlag steht keine Transaktion offen');
assert($s2['cursor'] === $f['region_id'] && $s2['remaining'] === 0, 'D: der Block lief bis zum Ende');
assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $v1['region'])['wiki_region_key'] === 'grenzforst',
    'D: der Verbund bekommt seinen Schluessel EINMAL, an seiner einen Region');
assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $f['region'])['wiki_region_key'] === null,
    'D: die gescheiterte Region bleibt leer -- ihre Transaktion ist zurueckgerollt');
$pdo->exec('DROP TRIGGER wiki_nachzug_test_abbruch');

echo "OK -- garetien-wiki-nachzug: scharf, blockweise\n";

// =================================================================================================
// E. WIEDERHOLBAR -- der zweite Lauf findet nur, was scheiterte, der dritte nichts
// =================================================================================================
$t2 = avesmapsGaretienWikiNachzug($pdo, $admin);
assert($t2['wuerde_setzen'] === 1 && array_column($t2['stichprobe'], 'name') === ['Kiefernwald'],
    'E: der naechste Trockenlauf findet genau die gescheiterte Region: ' . json_encode($t2['stichprobe'], JSON_UNESCAPED_UNICODE));
assert($t2['uebersprungen']['schon_gesetzt'] === 4 && $t2['uebersprungen']['anderer_schluessel'] === 2,
    'E: die gesetzten zaehlen jetzt als fertig, Tannwald als Widerspruch: ' . json_encode($t2['uebersprungen']));
$s3 = avesmapsGaretienWikiNachzug($pdo, $admin, false);
assert($s3['gesetzt'] === 1 && $s3['fehler'] === [] && $s3['remaining'] === 0, 'E: die Wiederholung setzt sie');
$t3 = avesmapsGaretienWikiNachzug($pdo, $admin);
assert($t3['wuerde_setzen'] === 0 && $t3['remaining'] === 0 && $t3['stichprobe'] === [],
    'E: danach findet der Trockenlauf NICHTS mehr: ' . json_encode($t3, JSON_UNESCAPED_UNICODE));
$standLeer = avesmapsGaretienWikiNachzugTestStand($pdo);
$s4 = avesmapsGaretienWikiNachzug($pdo, $admin, false);
assert($s4['gesetzt'] === 0 && $s4['cursor'] === null && $s4['remaining'] === 0, 'E: ein scharfer Lauf ohne Kandidaten tut nichts');
assert(avesmapsGaretienWikiNachzugTestStand($pdo) === $standLeer, 'E: ... und schreibt nichts, auch keinen Stempel');

// Was der ganze Lauf NICHT angefasst hat.
assert(avesmapsGaretienWikiNachzugTestZahl($pdo, 'SELECT revision FROM map_revision WHERE id = 1') === $mapRevisionVorher,
    'E: 🔴 KEIN Stempel auf die Kartenrevision -- die Beschriftungen trugen ihren Schluessel schon, der Durchtrag schrieb nichts');
foreach (['a' => $a, 'b' => $b, 'c' => $c, 'v' => $v1, 'f' => $f] as $k => $objekt) {
    assert(avesmapsGaretienWikiNachzugTestLabelJson($pdo, $objekt['label']) === $labelsVorher[$k],
        "E: die Beschriftung ({$k}) bleibt Byte fuer Byte, wie sie war");
}
foreach ($unberuehrtVorher as $publicId => $zeile) {
    assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $publicId) === $zeile,
        'E: eine uebersprungene oder fremde Region bleibt unberuehrt: ' . $zeile['name']);
}
assert(json_encode($pdo->query('SELECT * FROM sync_plan_item ORDER BY id')->fetchAll(PDO::FETCH_ASSOC)) === $itemsVorher,
    'E: 🔴 keine Migration -- kein Vermerk, kein Zustand, keine Zeile der Vorschau veraendert');
assert(json_encode($pdo->query('SELECT * FROM sync_decision')->fetchAll(PDO::FETCH_ASSOC)) === $entscheidungVorher,
    'E: die Ablehnung steht unveraendert');
assert((int) $pdo->query('SELECT selected FROM sync_plan_item WHERE id = ' . $abgelehnt)->fetchColumn() === 0,
    'E: die abgelehnte Zeile bleibt abgehakt');
$protokoll = $pdo->query("SELECT region_public_id FROM ecosystem_geometry_audit_log WHERE action = 'assign_wiki_region' ORDER BY id")
    ->fetchAll(PDO::FETCH_COLUMN);
assert($protokoll === [$a['region'], $c['region'], $v1['region'], $f['region']],
    'E: je gesetzter Region GENAU eine Protokollzeile des Hausschreibers (im Fenster „Aenderungen" zuruecknehmbar): '
    . json_encode($protokoll));

echo "OK -- garetien-wiki-nachzug: wiederholbar\n";

// =================================================================================================
// F. R-r (Zusatz des Koordinators) -- SCHARF NUR MIT DEM ECHTEN BOOLEAN true
// =================================================================================================
// 🔴 W2 (Nachbesserung Runde 1, 14.09.2026): dieser Abschnitt wertete bis dahin eine im TEST
// ABGESCHRIEBENE KOPIE des `apply`-Ausdrucks aus, nicht den ENDPUNKT -- eine Tautologie, die gruen
// blieb, egal was der Endpunkt wirklich tat. Jetzt wird der ECHTE Ausdruck aus dem Zweig
// `wiki_nachzug` per Tokenizer ausgeschnitten und ALS PHP-CODE ausgefuehrt (per `eval` in einer
// Closure) -- eine Mutation des Endpunkts (`=== true` -> `== true`) macht diesen Abschnitt jetzt rot
// (Beleg im Bericht). Dieselbe Kommentar-freie Quelltextform wie Abschnitt G darunter, absichtlich
// EIGENSTAENDIG aufgebaut (nicht von G's spaeteren Variablen abhaengig -- Reihenfolge-Unabhaengigkeit).
$nurCodeF = static function (string $php): string {
    $stuecke = [];
    foreach (token_get_all($php) as $token) {
        if (is_array($token)) {
            if (!in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                $stuecke[] = $token[1];
            }
            continue;
        }
        $stuecke[] = $token;
    }

    return implode('', $stuecke);
};
$endpunktF = $nurCodeF(str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../../../edit/map/garetien-import.php')));
$zweigAbF = strpos($endpunktF, "\$action === 'wiki_nachzug'");
assert($zweigAbF !== false, 'F: der Endpunkt hat den Zweig `wiki_nachzug`');
$naechsterZweigF = strpos($endpunktF, "\$action === ", $zweigAbF + 20);
$zweigF = substr($endpunktF, $zweigAbF, $naechsterZweigF === false ? null : $naechsterZweigF - $zweigAbF);
assert(preg_match('~\$scharf\s*=\s*(.+?);~', $zweigF, $scharfTreffer) === 1,
    'F: der Zweig bildet `$scharf` -- ohne diese Zeile kann dieser Abschnitt nichts pruefen');
$scharfAusdruck = trim($scharfTreffer[1]);

// Der ECHTE, gerade aus dem Endpunkt geschnittene Ausdruck -- als Closure ausgefuehrt, kein
// abgeschriebener Vergleich mehr.
// ⚠️ `eval()` ist hier bewusst und ungefaehrlich: der ausgewertete Text ist keine Nutzereingabe,
// sondern der lokale Quelltext DIESES Repos (api/edit/map/garetien-import.php, per Tokenizer
// ausgeschnitten), gelesen von der Festplatte im selben Testlauf, der ohnehin schon PHP-Code aus
// diesem Baum ausfuehrt (require_once auf die Bibliothek). Genau das ist der Zweck dieses
// Abschnitts (W2): den ECHTEN Ausdruck auszufuehren statt eine Kopie davon zu behaupten.
$pruefeScharf = eval('return static function (array $payload): bool { return ' . $scharfAusdruck . '; };');
assert($pruefeScharf instanceof Closure, 'F: der ausgeschnittene Ausdruck ergibt gueltigen, ausfuehrbaren PHP-Code');

$faelleApply = [
    'true (bool)' => ['wert' => true, 'scharf' => true],
    '"true" (string)' => ['wert' => 'true', 'scharf' => false],
    '1 (int)' => ['wert' => 1, 'scharf' => false],
    '"1" (string)' => ['wert' => '1', 'scharf' => false],
    'false (bool)' => ['wert' => false, 'scharf' => false],
    'fehlt' => ['wert' => null, 'scharf' => false],
];
foreach ($faelleApply as $bezeichnung => $fall) {
    $payload = $fall['wert'] === null ? [] : ['apply' => $fall['wert']];
    $scharf = $pruefeScharf($payload);
    assert($scharf === $fall['scharf'],
        "F: apply={$bezeichnung} muss scharf=" . var_export($fall['scharf'], true)
        . ' ergeben, bekommen: ' . var_export($scharf, true));
}

echo "OK -- garetien-wiki-nachzug: R-r, nur der echte Boolean true ist scharf (Endpunkt wirklich ausgefuehrt)\n";

// =================================================================================================
// H. W1 (Nachbesserung Runde 1, 14.09.2026) -- EINE ZWEITE GEBUNDENE BESCHRIFTUNG MIT ABWEICHENDEM
//    SCHLUESSEL WIRD NIE STILL UEBERSCHRIEBEN
// =================================================================================================
// Eigener, ISOLIERTER Bestand -- eine zweite gebundene Beschriftung veraendert, wer als Kandidat
// zaehlt, und haette damit ALLE Zahlen der Abschnitte B-E oben verschoben (vermerke, andere_ziele,
// wuerde_setzen, Stichprobe, Revisionsstempel, Protokollzeilen). Der Fall wird deshalb GETRENNT
// aufgebaut -- dieselbe Strategie wie die Sonde des Pruefers (sonde-zweitlabel.php), die ebenfalls nur
// Abschnitt A isoliert nachbaut.
$pdoH = avesmapsGaretienWikiNachzugTestPdo();
$runH = avesmapsSyncPlanStartRun($pdoH, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'w1');
avesmapsGaretienWikiNachzugTestArtikel($pdoH, 'Muehlwald');
$mw = avesmapsGaretienWikiNachzugTestImport($pdoH, $runH, 'Muehlwald', 1);
// Stand VOR Aufgabe 2, wie in Abschnitt A: Region leer, PRIMAERE Beschriftung traegt ihr Nest weiter.
$pdoH->prepare('UPDATE ecosystem_region SET wiki_url = NULL, wiki_region_key = NULL WHERE public_id = ?')
    ->execute([$mw['region']]);

// Eine ZWEITE, per Zeiger (`ecosystem_region_public_id`) gebundene Beschriftung mit einem NICHT-
// LEEREN, ABWEICHENDEN Schluessel -- genau der Fall aus der Sonde des Pruefers. Derselbe Leser, den
// der Durchtrag benutzt (avesmapsEcosystemRegionLabelPublicIds), findet sie ZUSAETZLICH zur primaeren.
$zweitProps = [
    'ecosystem_region_public_id' => $mw['region'],
    'wiki_region' => ['wiki_key' => 'fremder-forst', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Fremder_Forst'],
];
$pdoH->prepare("INSERT INTO map_features (public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json, style_json, is_active)
               VALUES ('probe-zweitlabel-h', 'label', 'wald', 'Muehlwald Zwei', 'Point', '{\"type\":\"Point\",\"coordinates\":[1,1]}', ?, '{}', 1)")
    ->execute([json_encode($zweitProps, JSON_UNESCAPED_SLASHES)]);
$mapRevVorH = avesmapsGaretienWikiNachzugTestZahl($pdoH, 'SELECT revision FROM map_revision WHERE id = 1');

$tH = avesmapsGaretienWikiNachzug($pdoH, $admin);
assert($tH['wuerde_setzen'] === 0,
    'H(a): die Region ist KEIN Kandidat mehr -- die zweite Beschriftung widerspricht, bekommen: ' . $tH['wuerde_setzen']);
assert(count($tH['widersprueche']) === 1 && $tH['widersprueche'][0]['name'] === 'Muehlwald',
    'H(a): der Widerspruch wird BENANNT, nicht nur gezaehlt: ' . json_encode($tH['widersprueche'], JSON_UNESCAPED_UNICODE));
assert($tH['uebersprungen']['anderer_schluessel'] === 1,
    'H(a): ... und als anderer_schluessel gezaehlt: ' . json_encode($tH['uebersprungen']));

$sH = avesmapsGaretienWikiNachzug($pdoH, $admin, false);
assert($sH['gesetzt'] === 0 && $sH['fehler'] === [], 'H(a): der scharfe Lauf setzt nichts: ' . json_encode($sH, JSON_UNESCAPED_UNICODE));
assert(avesmapsGaretienWikiNachzugTestRegion($pdoH, $mw['region'])['wiki_region_key'] === null,
    'H(a): die Region bleibt ohne Schluessel -- zur Handentscheidung liegen, statt geraten');
$zweitNachher = json_decode(
    (string) $pdoH->query("SELECT properties_json FROM map_features WHERE public_id = 'probe-zweitlabel-h'")->fetchColumn(),
    true
);
assert(($zweitNachher['wiki_region']['wiki_key'] ?? '') === 'fremder-forst',
    'H(a): 🔴 die zweite Beschriftung behaelt IHREN Schluessel -- keine stille Umzuweisung ueber den Durchtrag: '
    . json_encode($zweitNachher, JSON_UNESCAPED_UNICODE));
assert(avesmapsGaretienWikiNachzugTestZahl($pdoH, 'SELECT revision FROM map_revision WHERE id = 1') === $mapRevVorH,
    'H(a): kein map_revision-Stempel -- es wurde keine Beschriftung geschrieben');
assert(avesmapsGaretienWikiNachzugTestZahl($pdoH, "SELECT COUNT(*) FROM map_audit_log WHERE action = 'update_label'") === 0,
    'H(a): keine update_label-Protokollzeile fuer diese Region');

echo "OK -- garetien-wiki-nachzug: W1(a), zweite gebundene Beschriftung nie still ueberschrieben\n";

// H(b) GEGENPROBE (Ruling Punkt 3): eine zweite gebundene Beschriftung OHNE Schluessel blockiert
// NICHT -- sie erbt weiter, wie es die Hausregel (AGENTS.md §11) vorsieht.
$pdoHb = avesmapsGaretienWikiNachzugTestPdo();
$runHb = avesmapsSyncPlanStartRun($pdoHb, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'w1b');
avesmapsGaretienWikiNachzugTestArtikel($pdoHb, 'Muehlwald');
$mwb = avesmapsGaretienWikiNachzugTestImport($pdoHb, $runHb, 'Muehlwald', 1);
$pdoHb->prepare('UPDATE ecosystem_region SET wiki_url = NULL, wiki_region_key = NULL WHERE public_id = ?')
    ->execute([$mwb['region']]);
$zweitPropsOhne = ['ecosystem_region_public_id' => $mwb['region']]; // KEIN `wiki_region` -- kein Schluessel.
$pdoHb->prepare("INSERT INTO map_features (public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json, style_json, is_active)
               VALUES ('probe-zweitlabel-hb', 'label', 'wald', 'Muehlwald Zwei', 'Point', '{\"type\":\"Point\",\"coordinates\":[1,1]}', ?, '{}', 1)")
    ->execute([json_encode($zweitPropsOhne, JSON_UNESCAPED_SLASHES)]);

$tHb = avesmapsGaretienWikiNachzug($pdoHb, $admin);
assert($tHb['wuerde_setzen'] === 1 && $tHb['widersprueche'] === [],
    'H(b): eine zweite Beschriftung OHNE Schluessel blockiert NICHT: ' . json_encode($tHb, JSON_UNESCAPED_UNICODE));
$sHb = avesmapsGaretienWikiNachzug($pdoHb, $admin, false);
assert($sHb['gesetzt'] === 1, 'H(b): scharf setzt die Region: ' . json_encode($sHb, JSON_UNESCAPED_UNICODE));
assert(avesmapsGaretienWikiNachzugTestRegion($pdoHb, $mwb['region'])['wiki_region_key'] === 'muehlwald',
    'H(b): die Region traegt jetzt den Schluessel');
$zweitNachherB = json_decode(
    (string) $pdoHb->query("SELECT properties_json FROM map_features WHERE public_id = 'probe-zweitlabel-hb'")->fetchColumn(),
    true
);
assert(($zweitNachherB['wiki_region']['wiki_key'] ?? '') === 'muehlwald',
    'H(b): die zweite Beschriftung ERBT den neuen Schluessel (Hausregel, AGENTS.md §11 „Die Beschriftung '
    . 'erbt die Wiki-Landschaft ihrer Flaeche"): ' . json_encode($zweitNachherB, JSON_UNESCAPED_UNICODE));

echo "OK -- garetien-wiki-nachzug: W1(b) Gegenprobe, Beschriftung ohne Schluessel erbt weiter\n";

// =================================================================================================
// G. AM QUELLTEXT -- was SQLite nicht zeigen kann, und die Tuer
// =================================================================================================
$nurCode = static function (string $php): string {
    $stuecke = [];
    foreach (token_get_all($php) as $token) {
        if (is_array($token)) {
            if (!in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                $stuecke[] = $token[1];
            }
            continue;
        }
        $stuecke[] = $token;
    }

    return implode('', $stuecke);
};
$bibliothek = $nurCode(str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../garetien-wiki-nachzug.php')));
assert(str_contains($bibliothek, 'avesmapsAssignEcosystemWikiRegion('), 'G: geschrieben wird ueber den Hausschreiber');
foreach (['beginTransaction', 'commit(', 'rollBack(', 'EnsureTables', 'EnsureSyncPlanTables', 'CREATE TABLE', 'avesmapsNextMapRevision(', 'avesmapsNextEcosystemRevision('] as $verboten) {
    assert(stripos($bibliothek, $verboten) === false,
        "G: 💣 die Bibliothek enthaelt kein `{$verboten}` -- Transaktion, DDL und Stempel gehoeren dem Hausschreiber "
        . '(in MySQL beendet DDL eine offene Transaktion mit implizitem COMMIT, SQLite zeigt das nie)');
}
assert(preg_match('~\bUPDATE\s~i', $bibliothek) !== 1, 'G: kein eigenes UPDATE -- kein zweiter Schreibweg fuer den Schluessel einer Region');

$endpunkt = $nurCode(str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../../../edit/map/garetien-import.php')));
assert(preg_match('~require_once[^;]*import/garetien-wiki-nachzug\.php~', $endpunkt) === 1, 'G: der Endpunkt laedt die Bibliothek mit require_once');
$adminListe = [];
if (preg_match('~in_array\(\$action,\s*\[([^\]]*)\],\s*true\)~', $endpunkt, $treffer) === 1) {
    $adminListe = array_map(static fn (string $t): string => trim($t, " '\"\n\t"), explode(',', $treffer[1]));
}
assert(in_array('wiki_nachzug', $adminListe, true),
    'G: 🔴 `wiki_nachzug` steht im ENGEN Admin-Riegel des Endpunkts -- ein Editor bekommt 403: ' . implode(', ', $adminListe));
$zweigAb = strpos($endpunkt, "\$action === 'wiki_nachzug'");
assert($zweigAb !== false, 'G: der Endpunkt hat den Zweig');
assert($zweigAb > (int) strpos($endpunkt, 'avesmapsCreatePdo('), 'G: der Zweig steht hinter dem Datenbankaufbau');
$naechsterZweig = strpos($endpunkt, "\$action === ", $zweigAb + 20);
$zweig = substr($endpunkt, $zweigAb, $naechsterZweig === false ? null : $naechsterZweig - $zweigAb);
assert(str_contains($zweig, "(\$payload['apply'] ?? false) === true"), 'G: scharf NUR mit dem Boolean `apply: true`');
assert(str_contains($zweig, 'avesmapsGaretienWikiNachzug(') && str_contains($zweig, '!$scharf'),
    'G: der Zweig reicht den Trockenlauf als Vorgabe durch');

echo "OK -- garetien-wiki-nachzug (Aufgabe 13, Bestand)\n";
