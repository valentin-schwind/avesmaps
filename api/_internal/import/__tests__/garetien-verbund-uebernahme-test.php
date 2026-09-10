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
//
// 🔴 FIXRUNDE 1 (Kleinigkeit): die urspruengliche Fassung dieser Zusicherung
// (`avesmapsGaretienVermerkLesen('')` allein) war VAKUUM -- eine Mutationsprobe, die den
// Fruehausstieg `if ($n === '') { return $raus; }` entfernt, liess sie GRUEN: fuer `$n = ''` ist
// `str_contains('', ':')` ebenfalls `false`, der Rueckfallzweig "alter Vermerk" darunter setzt
// `$raus['region'] = '';` -- also dasselbe Ergebnis, mit oder ohne den Fruehausstieg. Scharf
// gemacht durch einen zweiten Fall, den NUR `trim($note)` unschaedlich macht: ein Vermerk aus
// reinem Leerraum (kein `:` darin) muesste ohne `trim()` als "alter Vermerk" MIT dem Leerraum
// selbst als Region durchgehen.
$leer = avesmapsGaretienVermerkLesen('');
assert($leer === ['area' => '', 'region' => '', 'verbund' => ''], 'C: leerer Vermerk -> alle drei Felder leer');
$nurLeerraum = avesmapsGaretienVermerkLesen("   \t  ");
assert($nurLeerraum === ['area' => '', 'region' => '', 'verbund' => ''],
    'C: ein Vermerk aus REINEM Leerraum ist getrimmt leer, nicht "alter Vermerk mit Leerraum als Region"');

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
        // 🪤 SQLite verlangt fuer ESCAPE GENAU EIN Zeichen; MySQL interpretiert `'\\'` (zwei
        // Backslash-Zeichen im SQL-Text) selbst als EIN maskiertes Backslash-Zeichen -- derselbe
        // Dialekt-Unterschied wie CRLF/LF (AGENTS.md §9), nur eine Ebene tiefer. Ungeuebersetzt
        // wirft SQLite "ESCAPE expression must be a single character" -- ein Fehler, der wie ein
        // kaputtes Muster aussieht und keiner ist.
        $query = str_replace("ESCAPE '\\\\'", "ESCAPE '\\'", $query);
        if (str_contains($query, 'INSERT INTO app_setting') && str_contains($query, 'ON DUPLICATE KEY UPDATE')) {
            $query = 'INSERT INTO app_setting (setting_key, setting_value) VALUES (:k, :v)
                      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value';
        }
        // 🔴 FIXRUNDE 1, BEFUND A: der neue Abschnitt E faehrt avesmapsGaretienQuellenAnlegen
        // wirklich aus (avesmapsFeatureSourceUpsert / …Link, api/_internal/app/feature-sources.php)
        // -- beide MySQL-eigen (`ON DUPLICATE KEY UPDATE` + `IF(...)`/`VALUES(...)`). Uebersetzt
        // wie in garetien-uebernahme-test.php (dieselbe Naht, hier auf die zwei Tabellen
        // gekuerzt, die dieser Ablauf wirklich anfasst) statt den Produktivcode zu verbiegen.
        if (str_contains($query, 'ON DUPLICATE KEY UPDATE')
            && (str_contains($query, 'INTO sources') || str_contains($query, 'INTO feature_sources'))) {
            $query = self::mysqlUpsertNachSqlite($query);
        }

        return parent::prepare($query, $options);
    }

    /**
     * MySQLs `INSERT ... ON DUPLICATE KEY UPDATE` in SQLites `ON CONFLICT ... DO UPDATE` --
     * Uebersetzung uebernommen aus garetien-uebernahme-test.php (dieselbe Naht, dort ausfuehrlich
     * begruendet: der Schluessel muss bei SQLite genannt werden, `VALUES(x)` heisst `excluded.x`,
     * `IF(a, b, c)` heisst `CASE WHEN a THEN b ELSE c END`, klammerweise zerlegt statt per Regex,
     * weil `avesmapsSourceUpsertOnDuplicateSql` ein Komma INNERHALB eines Literals traegt
     * (`own_fields NOT LIKE '%,is_official,%'`).
     */
    private static function mysqlUpsertNachSqlite(string $query): string
    {
        $schluessel = str_contains($query, 'INTO sources')
            ? '(url_hash)'
            : '(entity_type, entity_public_id, source_id)';
        $query = str_replace('ON DUPLICATE KEY UPDATE', 'ON CONFLICT ' . $schluessel . ' DO UPDATE SET', $query);
        $tabelle = str_contains($query, 'INTO sources') ? 'sources' : 'feature_sources';
        $query = preg_replace('~VALUES\(([a-z_]+)\)~i', 'excluded.$1', $query) ?? $query;

        while (($ab = strpos($query, 'IF(')) !== false) {
            $tiefe = 0;
            $inText = false;
            $teile = [];
            $stueck = '';
            for ($i = $ab + 3, $n = strlen($query); $i < $n; $i++) {
                $z = $query[$i];
                if ($z === "'") { $inText = !$inText; }
                if (!$inText) {
                    if ($z === '(') { $tiefe++; }
                    if ($z === ')') {
                        if ($tiefe === 0) { $teile[] = $stueck; break; }
                        $tiefe--;
                    }
                    if ($z === ',' && $tiefe === 0) { $teile[] = $stueck; $stueck = ''; continue; }
                }
                $stueck .= $z;
            }
            if (count($teile) !== 3) { break; }
            $ersatz = 'CASE WHEN ' . trim($teile[0]) . ' THEN ' . trim($teile[1]) . ' ELSE ' . trim($teile[2]) . ' END';
            $query = substr($query, 0, $ab) . $ersatz . substr($query, $i + 1);
        }
        if (str_contains($query, 'IF(')) {
            throw new RuntimeException('Die Uebersetzung nach SQLite hat ein IF( stehen lassen: ' . $query);
        }

        $teile = explode('DO UPDATE SET', $query, 2);
        if (count($teile) === 2) {
            $teile[1] = preg_replace('~(?<![.\w])(label|is_official|wiki_key|license|attribution|origin|status)(?![\w.])~',
                $tabelle . '.$1', $teile[1]) ?? $teile[1];
            $teile[1] = preg_replace('~' . $tabelle . '\.([a-z_]+)(\s*=)~', '$1$2', $teile[1]) ?? $teile[1];
            $query = $teile[0] . 'DO UPDATE SET' . $teile[1];
        }

        return $query;
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
    // Fixrunde 2, Abschnitt I (Befund E): eine ZWEITE Art fuer den Kind/Art-Kollisionsfall --
    // ein Verbund gleichen Stamms, aber Huegelland statt Wald.
    $pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label) VALUES ('topographie', 'huegelland', 'Huegelland')");
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
function avesmapsGaretienVerbundTestFragment(
    PDO $pdo,
    int $runId,
    string $label,
    int $nr,
    array $ring,
    string $kind = 'vegetation',
    string $subtyp = 'wald'
): int {
    $pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected)
                   VALUES (?, ?, NULL, 'new', ?, NULL, ?, NULL, 1)")
        ->execute([
            $runId,
            'ggp:Waelder:Wald:#' . $nr,
            $label,
            json_encode([
                'herkunft' => 'garetien', 'ziel' => 'region', 'kind' => $kind, 'subtyp' => $subtyp,
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

// =================================================================================================
// E. FIXRUNDE 1, BEFUND A (kritisch) -- avesmapsGaretienArtikelQuellenNachtragen liest die
//    REGION aus dem strukturierten Vermerk, nicht den GANZEN Vermerk als nackte public_id.
// =================================================================================================
//
// Seit Aufgabe 6 traegt JEDE 'region'-Zeile den strukturierten Vermerk
// ("area:<a> | region:<r> | verbund:<v>"), auch OHNE Verbund (dann bleibt das dritte Feld leer --
// wie hier). Vor dieser Fixrunde las der Nachtrag bei einem 'new'-Item ohne entity_public_id
// weiterhin `trim($zeile['apply_note'])` -- den GANZEN Vermerk -- und reichte ihn als "die
// Region" an avesmapsGaretienQuellenZiel('region', ...) weiter. Die Weiche dahinter
// (avesmapsEcosystemLabelSourceTarget) ist REIN und wirft NIE: sie liefert klaglos
// ['ecosystem', '<der ganze Vermerk>'] zurueck, und der Nachtrag haengt die Quelle an genau
// diese unsinnige Kennung -- eine feature_sources-Zeile, die kein Leser je findet, plus ein
// Revisions-Bump fuer NICHTS.
$pdoE = avesmapsGaretienVerbundUebernahmeTestPdo();
$runIdE = avesmapsSyncPlanStartRun($pdoE, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'test-artikel-nachtrag');
$vermerkE = avesmapsGaretienVerbundVermerk('area-XYZ', 'region-XYZ', '');
$pdoE->prepare(
    "INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected, apply_state, apply_note)
     VALUES (?, ?, NULL, 'new', ?, NULL, ?, NULL, 1, 'done', ?)"
)->execute([
    $runIdE,
    'ggp:Waelder:Wald:#99',
    'Testwald',
    json_encode([
        'herkunft' => 'garetien', 'ziel' => 'region',
        // `artikel_quelle` direkt gesetzt -- so entfaellt der Umweg ueber den Schluessel
        // (avesmapsGaretienArtikelNameAusSchluessel), der fuer DIESE Zusicherung nichts beitraegt.
        'artikel_quelle' => [
            'url' => 'https://www.garetien.de/index.php/Testwald',
            'label' => 'Testwald auf garetien.de',
            'source_type' => 'briefspiel',
            'origin' => 'garetien',
            'license' => 'cc-by-nc-sa-3.0',
            'attribution' => 'VolkoV / garetien.de',
        ],
    ], JSON_UNESCAPED_UNICODE),
    $vermerkE,
]);

$ergebnisE = avesmapsGaretienArtikelQuellenNachtragen($pdoE);
assert($ergebnisE['geprueft'] === 1, 'E: genau ein Item mit Artikel geprueft, bekommen: ' . $ergebnisE['geprueft']);
assert($ergebnisE['geschrieben'] === 1, 'E: genau eine Verknuepfung geschrieben, bekommen: ' . $ergebnisE['geschrieben']);

$verknuepfungenE = $pdoE->query('SELECT entity_type, entity_public_id FROM feature_sources')->fetchAll(PDO::FETCH_ASSOC);
assert(count($verknuepfungenE) === 1, 'E: GENAU EINE Verknuepfung, bekommen: ' . count($verknuepfungenE));
assert($verknuepfungenE[0]['entity_type'] === 'ecosystem',
    'E: die Landschaftsflaeche traegt ihre Quellen als "ecosystem", bekommen: ' . $verknuepfungenE[0]['entity_type']);
assert($verknuepfungenE[0]['entity_public_id'] === 'region-XYZ',
    'E: die Verknuepfung zeigt auf die REGION, nicht auf den ganzen Vermerk -- bekommen: "'
    . $verknuepfungenE[0]['entity_public_id'] . '"');

echo "OK -- garetien-artikelquellen-nachtragen (Befund A)\n";

// =================================================================================================
// F. FIXRUNDE 1, BEFUND C (wichtig) -- die Anfuehrer-Suche geht LAUFUEBERGREIFEND, wie die
//    laufuebergreifende Ruecknahme (Entwurf §6).
// =================================================================================================
//
// Fragment 1 kommt in Lauf A an und wird uebernommen. Danach laeuft "Holen & Rechnen" -- das
// setzt Lauf A auf 'superseded', loescht ihn aber NICHT (AGENTS.md §10, Server<->Repo-Drift-
// Analogon fuer sync_plan_run). Fragment 2 desselben Verbunds kommt in Lauf B an. Vor dieser
// Fixrunde filterte die Anfuehrer-Suche nach `run_id = Lauf B` und faende Fragment 1 (das in
// Lauf A liegt) NIE -- Lauf B legte eine ZWEITE Region desselben Namens an, ohne jede Meldung.
$pdoF = avesmapsGaretienVerbundUebernahmeTestPdo();
$runFA = avesmapsSyncPlanStartRun($pdoF, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-a');
$itemF1 = avesmapsGaretienVerbundTestFragment($pdoF, $runFA, 'Grenzwald 1', 1, avesmapsGaretienVerbundTestRing(300, 300));
$ergebnisF1 = avesmapsGaretienUebernehmen($pdoF, $runFA, [$itemF1], ['id' => 7], null, [
    $itemF1 => ['verbund' => 'Grenzwald'],
]);
assert($ergebnisF1['fehler'] === [], 'F: Fragment 1 (Lauf A) legt an, keine Fehler: ' . json_encode($ergebnisF1['fehler'], JSON_UNESCAPED_UNICODE));

// "Holen & Rechnen": ein neuer Lauf derselben Art -- Lauf A wird 'superseded', NICHT geloescht.
$runFB = avesmapsSyncPlanStartRun($pdoF, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-b');
$laufAState = $pdoF->query('SELECT state FROM sync_plan_run WHERE id = ' . $runFA)->fetchColumn();
assert($laufAState === 'superseded', 'F (Testaufbau): Lauf A steht auf superseded, nicht geloescht -- bekommen: ' . $laufAState);

$itemF2 = avesmapsGaretienVerbundTestFragment($pdoF, $runFB, 'Grenzwald 2', 2, avesmapsGaretienVerbundTestRing(400, 400));
$ergebnisF2 = avesmapsGaretienUebernehmen($pdoF, $runFB, [$itemF2], ['id' => 7], null, [
    $itemF2 => ['verbund' => 'Grenzwald'],
]);
assert($ergebnisF2['fehler'] === [], 'F: Fragment 2 (Lauf B) legt an, keine Fehler: ' . json_encode($ergebnisF2['fehler'], JSON_UNESCAPED_UNICODE));

$regionenF = $pdoF->query('SELECT id, public_id FROM ecosystem_region')->fetchAll(PDO::FETCH_ASSOC);
assert(count($regionenF) === 1,
    'F: GENAU EINE Region ueber ZWEI Laeufe hinweg, bekommen: ' . count($regionenF));

$flaechenF = $pdoF->query('SELECT region_id FROM ecosystem_area')->fetchAll(PDO::FETCH_ASSOC);
assert(count($flaechenF) === 2, 'F: GENAU ZWEI Flaechen, bekommen: ' . count($flaechenF));
assert((int) $flaechenF[0]['region_id'] === (int) $regionenF[0]['id']
    && (int) $flaechenF[1]['region_id'] === (int) $regionenF[0]['id'],
    'F: BEIDE Flaechen (aus BEIDEN Laeufen) haengen an DERSELBEN Region');

echo "OK -- garetien-verbund-laufuebergreifend (Befund C)\n";

// =================================================================================================
// G. FIXRUNDE 1, KLEINIGKEIT -- das LIKE-Muster maskiert "%"/"_" im Verbund-Stamm.
// =================================================================================================
//
// Ein Verbund-Stamm ist freier Text; ein "_" darin ist in einem Wiki-Artikelnamen plausibel. Ohne
// Maskierung ist "_" ein LIKE-Metazeichen ("ein beliebiges Zeichen") -- die Suche nach dem
// Verbund "A_wald" faende dann FAELSCHLICH den voellig anderen, bereits angelegten Verbund
// "AXwald" (ein "_" passt auf jedes einzelne Zeichen, auch ein "X").
$pdoG = avesmapsGaretienVerbundUebernahmeTestPdo();
$runG = avesmapsSyncPlanStartRun($pdoG, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-g');

// Ein FREMDER, unverwandter Verbund, dessen Name zufaellig auf das ungeschuetzte Muster passt.
$itemGFremd = avesmapsGaretienVerbundTestFragment($pdoG, $runG, 'AXwald 1', 90, avesmapsGaretienVerbundTestRing(600, 600));
$ergebnisGFremd = avesmapsGaretienUebernehmen($pdoG, $runG, [$itemGFremd], ['id' => 7], null, [
    $itemGFremd => ['verbund' => 'AXwald'],
]);
assert($ergebnisGFremd['fehler'] === [], 'G: der fremde Verbund legt an, keine Fehler');

// Der GESUCHTE Verbund, dessen Name ein echtes "_" traegt -- zwei Fragmente.
$itemG1 = avesmapsGaretienVerbundTestFragment($pdoG, $runG, 'A_wald 1', 91, avesmapsGaretienVerbundTestRing(700, 700));
$ergebnisG1 = avesmapsGaretienUebernehmen($pdoG, $runG, [$itemG1], ['id' => 7], null, [
    $itemG1 => ['verbund' => 'A_wald'],
]);
assert($ergebnisG1['fehler'] === [], 'G: A_wald Fragment 1 legt an, keine Fehler');

$itemG2 = avesmapsGaretienVerbundTestFragment($pdoG, $runG, 'A_wald 2', 92, avesmapsGaretienVerbundTestRing(800, 800));
$ergebnisG2 = avesmapsGaretienUebernehmen($pdoG, $runG, [$itemG2], ['id' => 7], null, [
    $itemG2 => ['verbund' => 'A_wald'],
]);
assert($ergebnisG2['fehler'] === [], 'G: A_wald Fragment 2 legt an, keine Fehler');

$regionenG = $pdoG->query('SELECT id, public_id FROM ecosystem_region')->fetchAll(PDO::FETCH_ASSOC);
assert(count($regionenG) === 2,
    'G: ZWEI Regionen -- "AXwald" und "A_wald" bleiben GETRENNT, bekommen: ' . count($regionenG));

$flaechenJeRegionG = $pdoG->query(
    "SELECT er.name AS leader_name, COUNT(ea.id) AS n
       FROM ecosystem_region er LEFT JOIN ecosystem_area ea ON ea.region_id = er.id
      GROUP BY er.id"
)->fetchAll(PDO::FETCH_KEY_PAIR);
assert((int) ($flaechenJeRegionG['AXwald 1'] ?? -1) === 1,
    'G: "AXwald" bleibt bei EINER Flaeche (nicht faelschlich mit A_wald verschmolzen), bekommen: '
    . ($flaechenJeRegionG['AXwald 1'] ?? 'FEHLT'));
assert((int) ($flaechenJeRegionG['A_wald 1'] ?? -1) === 2,
    'G: "A_wald" hat BEIDE eigenen Fragmente zusammengefuehrt, bekommen: '
    . ($flaechenJeRegionG['A_wald 1'] ?? 'FEHLT'));

echo "OK -- garetien-verbund-like-maskierung (Kleinigkeit)\n";

// =================================================================================================
// H. FIXRUNDE 2, BEFUND D (wichtig) -- die Anfuehrer-Suche prueft, ob die gefundene Region noch
//    AKTIV ist, statt den ersten Treffer blind zu uebernehmen.
// =================================================================================================
//
// Fragment 1 legt die Region an. Ein Editor loescht sie danach von Hand im Landschaften-Editor --
// das setzt NUR `ecosystem_region.is_active = 0`, der Vermerk in `sync_plan_item.apply_note` bleibt
// unveraendert stehen (eine manuelle Loeschung ist NICHT die Ruecknahme, die `apply_note` auf NULL
// zuruecksetzt). Fragment 2 desselben Verbunds darf die tote Region nicht als Anfuehrer uebernehmen
// -- es muss selbst zum neuen Anfuehrer werden.
$pdoH = avesmapsGaretienVerbundUebernahmeTestPdo();
$runH1 = avesmapsSyncPlanStartRun($pdoH, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-h1');
$itemH1 = avesmapsGaretienVerbundTestFragment($pdoH, $runH1, 'Marschwald 1', 1, avesmapsGaretienVerbundTestRing(100, 500));
$ergebnisH1 = avesmapsGaretienUebernehmen($pdoH, $runH1, [$itemH1], ['id' => 7], null, [
    $itemH1 => ['verbund' => 'Marschwald'],
]);
assert($ergebnisH1['fehler'] === [], 'H: Fragment 1 legt an, keine Fehler: ' . json_encode($ergebnisH1['fehler'], JSON_UNESCAPED_UNICODE));

$regionHAlt = $pdoH->query('SELECT public_id FROM ecosystem_region')->fetchColumn();
assert(is_string($regionHAlt) && $regionHAlt !== '', 'H (Testaufbau): die erste Region wurde wirklich angelegt');

// Manuelle Loeschung im Landschaften-Editor -- NICHT die Ruecknahme.
$pdoH->prepare('UPDATE ecosystem_region SET is_active = 0 WHERE public_id = ?')->execute([$regionHAlt]);

$runH2 = avesmapsSyncPlanStartRun($pdoH, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-h2');
$itemH2 = avesmapsGaretienVerbundTestFragment($pdoH, $runH2, 'Marschwald 2', 2, avesmapsGaretienVerbundTestRing(200, 600));
$ergebnisH2 = avesmapsGaretienUebernehmen($pdoH, $runH2, [$itemH2], ['id' => 7], null, [
    $itemH2 => ['verbund' => 'Marschwald'],
]);
assert($ergebnisH2['fehler'] === [],
    'H: Fragment 2 legt trotz toter Vorgaenger-Region an, keine Fehler: ' . json_encode($ergebnisH2['fehler'], JSON_UNESCAPED_UNICODE));

$regionenH = $pdoH->query('SELECT public_id, is_active FROM ecosystem_region ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
assert(count($regionenH) === 2,
    'H: ZWEI Regionen -- die tote bleibt stehen, Fragment 2 legt eine EIGENE neue an, bekommen: ' . count($regionenH));
assert((int) $regionenH[0]['is_active'] === 0, 'H: die erste (geloeschte) Region bleibt inaktiv');
assert((int) $regionenH[1]['is_active'] === 1, 'H: die zweite (neu angelegte) Region ist aktiv');
assert($regionenH[1]['public_id'] !== $regionHAlt,
    'H: Fragment 2 haengt NICHT an der toten Region, sondern an einer neuen');

$flaechenH = $pdoH->query('SELECT region_id FROM ecosystem_area')->fetchAll(PDO::FETCH_COLUMN);
assert(count($flaechenH) === 2, 'H: BEIDE Flaechen existieren -- die tote Region verliert ihre Flaeche nicht');
assert(count(array_unique($flaechenH)) === 2,
    'H: die zwei Flaechen haengen an ZWEI verschiedenen Regionen (keine Zusammenfuehrung mit der toten)');

$itemsH2 = $pdoH->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . (int) $itemH2)->fetchAll(PDO::FETCH_ASSOC);
$noteH2 = avesmapsGaretienVermerkLesen((string) $itemsH2[0]['apply_note']);
assert($noteH2['region'] === $regionenH[1]['public_id'],
    'H: der Vermerk von Fragment 2 nennt die NEUE Region, nicht die tote');

echo "OK -- garetien-verbund-tote-region (Befund D)\n";

// =================================================================================================
// I. FIXRUNDE 2, BEFUND E (wichtig) -- gruppiert wird auch ueber die ART (kind + region_type),
//    nicht nur ueber den Stamm -- zwei gleichnamige Verbuende verschiedener Art aus ZWEI Laeufen
//    duerfen sich keine Region teilen.
// =================================================================================================
//
// Lauf A legt "Silker Hain" als WALD an (vegetation/wald). Lauf B bringt einen Verbund mit
// IDENTISCHEM Stamm "Silker Hain", aber als HUEGELLAND (topographie/huegelland) -- derselbe Name,
// eine andere Art, aus einem zweiten, spaeteren "Holen & Rechnen"-Lauf. Vor dieser Fixrunde haette
// die Anfuehrer-Suche (nur `LIKE '%verbund:Silker Hain'`) den Wald-Anfuehrer gefunden und dem
// Huegelland-Fragment dessen Region untergeschoben -- die Flaeche waere dann eine Huegelland-Flaeche
// in einer Wald-Region. Ein DRITTES Fragment in Lauf C, wieder WALD, muss dagegen weiterhin an die
// ECHTE Wald-Region andocken -- die Art-Pruefung darf nicht ueberkorrigieren.
$pdoI = avesmapsGaretienVerbundUebernahmeTestPdo();
$runIA = avesmapsSyncPlanStartRun($pdoI, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-i-a');
$itemIA = avesmapsGaretienVerbundTestFragment(
    $pdoI, $runIA, 'Silker Hain Wald', 1, avesmapsGaretienVerbundTestRing(100, 900), 'vegetation', 'wald'
);
$ergebnisIA = avesmapsGaretienUebernehmen($pdoI, $runIA, [$itemIA], ['id' => 7], null, [
    $itemIA => ['verbund' => 'Silker Hain'],
]);
assert($ergebnisIA['fehler'] === [], 'I: Lauf A (Wald) legt an, keine Fehler: ' . json_encode($ergebnisIA['fehler'], JSON_UNESCAPED_UNICODE));

$runIB = avesmapsSyncPlanStartRun($pdoI, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-i-b');
$itemIB = avesmapsGaretienVerbundTestFragment(
    $pdoI, $runIB, 'Silker Hain Huegel', 2, avesmapsGaretienVerbundTestRing(200, 950), 'topographie', 'huegelland'
);
$ergebnisIB = avesmapsGaretienUebernehmen($pdoI, $runIB, [$itemIB], ['id' => 7], null, [
    $itemIB => ['verbund' => 'Silker Hain'],
]);
assert($ergebnisIB['fehler'] === [], 'I: Lauf B (Huegelland) legt an, keine Fehler: ' . json_encode($ergebnisIB['fehler'], JSON_UNESCAPED_UNICODE));

$regionenNachBI = $pdoI->query("SELECT public_id, kind, region_type FROM ecosystem_region ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
assert(count($regionenNachBI) === 2,
    'I: ZWEI Regionen nach Lauf A+B -- Wald und Huegelland teilen sich KEINE, bekommen: ' . count($regionenNachBI));
assert($regionenNachBI[0]['region_type'] === 'wald' && $regionenNachBI[1]['region_type'] === 'huegelland',
    'I: die erste Region ist Wald, die zweite Huegelland -- bekommen: '
    . $regionenNachBI[0]['region_type'] . ' / ' . $regionenNachBI[1]['region_type']);

// Lauf C: ein DRITTES Fragment, wieder Wald -- muss die ECHTE Wald-Region finden, trotz des
// Huegelland-Zwischenfalls mit demselben Stamm.
$runIC = avesmapsSyncPlanStartRun($pdoI, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-i-c');
$itemIC = avesmapsGaretienVerbundTestFragment(
    $pdoI, $runIC, 'Silker Hain Wald 2', 3, avesmapsGaretienVerbundTestRing(300, 950), 'vegetation', 'wald'
);
$ergebnisIC = avesmapsGaretienUebernehmen($pdoI, $runIC, [$itemIC], ['id' => 7], null, [
    $itemIC => ['verbund' => 'Silker Hain'],
]);
assert($ergebnisIC['fehler'] === [], 'I: Lauf C (Wald) legt an, keine Fehler: ' . json_encode($ergebnisIC['fehler'], JSON_UNESCAPED_UNICODE));

$regionenNachCI = $pdoI->query("SELECT public_id, region_type FROM ecosystem_region ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
assert(count($regionenNachCI) === 2,
    'I: WEITERHIN nur ZWEI Regionen -- Lauf C haengt sich an die vorhandene Wald-Region, bekommen: '
    . count($regionenNachCI));

$flaechenJeRegionI = $pdoI->query(
    "SELECT er.region_type AS art, COUNT(ea.id) AS n
       FROM ecosystem_region er LEFT JOIN ecosystem_area ea ON ea.region_id = er.id
      GROUP BY er.id"
)->fetchAll(PDO::FETCH_ASSOC);
$flaechenWaldI = 0;
$flaechenHuegelI = 0;
foreach ($flaechenJeRegionI as $zeile) {
    if ($zeile['art'] === 'wald') { $flaechenWaldI = (int) $zeile['n']; }
    if ($zeile['art'] === 'huegelland') { $flaechenHuegelI = (int) $zeile['n']; }
}
assert($flaechenWaldI === 2, 'I: die Wald-Region traegt BEIDE Wald-Flaechen (Lauf A + Lauf C), bekommen: ' . $flaechenWaldI);
assert($flaechenHuegelI === 1, 'I: die Huegelland-Region bleibt bei IHRER EINEN Flaeche, bekommen: ' . $flaechenHuegelI);

echo "OK -- garetien-verbund-art-kollision (Befund E)\n";
