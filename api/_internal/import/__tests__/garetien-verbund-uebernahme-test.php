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
    /**
     * FIXRUNDE 1, BEFUND 2: zaehlt, wie oft die Existenzabfrage von
     * avesmapsSettlementPlaceExists() vorbereitet wird -- unabhaengig davon, ob die Tabelle
     * ueberhaupt existiert (dieses Fixture legt sie bewusst nicht an, siehe die AUTO_INCREMENT/
     * ENGINE=InnoDB-Kurzschluesse in exec() unten; avesmapsSettlementPlaceExists() faengt die
     * daraus folgende PDOException selbst ab und liefert false). Der Zaehler misst NUR, ob die
     * Abfrage ueberhaupt VERSUCHT wird -- genau das unterscheidet den gebundenen Riegel
     * (`$ziel !== 'region' && ...`) vom ungebundenen Aufruf davor.
     */
    public static int $settlementPlaceExistsAbfragen = 0;

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
        if (trim($query) === 'SELECT 1 FROM settlement_place WHERE public_id = :pid LIMIT 1') {
            self::$settlementPlaceExistsAbfragen++;
        }
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
// ⚠️ Seit dem 14.09.2026 heisst eine Verbund-Region wie ihr STAMM (garetien-plan.php,
// avesmapsGaretienNameUebersteuern), nicht mehr wie ihr erstes Fragment -- die Schluessel dieser
// Tafel sind deshalb „AXwald" und „A_wald", nicht „AXwald 1" und „A_wald 1".
assert((int) ($flaechenJeRegionG['AXwald'] ?? -1) === 1,
    'G: "AXwald" bleibt bei EINER Flaeche (nicht faelschlich mit A_wald verschmolzen), bekommen: '
    . ($flaechenJeRegionG['AXwald'] ?? 'FEHLT'));
assert((int) ($flaechenJeRegionG['A_wald'] ?? -1) === 2,
    'G: "A_wald" hat BEIDE eigenen Fragmente zusammengefuehrt, bekommen: '
    . ($flaechenJeRegionG['A_wald'] ?? 'FEHLT'));

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

// =================================================================================================
// AUFGABE 7 -- DIE FRAGMENTWEISE RUECKNAHME.
// =================================================================================================
//
// 💣 DER HEUTIGE WEG WUERDE BEI EINEM VERBUND ALLES MITREISSEN: avesmapsDeleteEcosystemRegion
// nimmt Beschriftung + Region + ALLE Flaechen mit. Vier Fragmente in einer Region: die
// Ruecknahme EINES loeschte alle vier -- mit gueltiger Antwort und ohne Fehlermeldung
// (Entwurf §8).

// --- J. Die reine Weiche: welchen Loeschweg waehlt ein Vermerk? ---
assert(avesmapsGaretienRuecknahmeWeg(avesmapsGaretienVerbundVermerk('a1', 'r1', 'Silker Hain'))
    === ['flaeche', 'a1'], 'J: ein Verbund-Fragment muss ueber die FLAECHE zurueckgenommen werden');
assert(avesmapsGaretienRuecknahmeWeg(avesmapsGaretienVerbundVermerk('a1', 'r1', ''))
    === ['region', 'r1'], 'J: ohne Verbund bleibt der Regionsweg');
assert(avesmapsGaretienRuecknahmeWeg('11112222-3333-4444-5555-666677778888')
    === ['region', '11112222-3333-4444-5555-666677778888'], 'J: der alte Vermerk bleibt der Regionsweg');
// Ein leerer Vermerk (das Fehlerszenario aus K unten, wenn NICHTS ihn ausfuellt) darf kein
// stilles Regionsziel "" erfinden -- die Weiche liefert dann ein LEERES Ziel, und der Aufrufer
// muss das selbst als Fehler behandeln (siehe die 'kein Loeschziel im Vermerk'-Zusicherung in M).
assert(avesmapsGaretienRuecknahmeWeg('') === ['region', ''], 'J: ein leerer Vermerk liefert ein leeres Regionsziel, keinen Fehler');

echo "OK -- garetien-ruecknahme-weg (Aufgabe 7, Schritt 1)\n";

// =================================================================================================
// J2. FIXRUNDE 1, BEFUND 1 (wichtig) -- ein Verbund-Vermerk OHNE Flaeche wirft, statt sich still
//     auf den breiten Regionsweg zurueckzuziehen.
// =================================================================================================
//
// "Heute unerreichbar" (der Schreiber fuellt Flaeche, Region und Verbund immer gemeinsam) ist auf
// einem LOESCHWEG kein Argument. Der Rueckfall muss in die SICHERE Richtung zeigen: ein Vermerk mit
// gesetztem Verbund, aber leerer Flaeche, wird ABGELEHNT -- nicht stillschweigend als "kein
// Verbund" gelesen, was Region samt allen Geschwister-Flaechen mitreissen wuerde.
$vermerkJ2 = avesmapsGaretienVerbundVermerk('', 'r1', 'Silker Hain');
$geworfenJ2 = null;
try {
    avesmapsGaretienRuecknahmeWeg($vermerkJ2);
} catch (Throwable $e) {
    $geworfenJ2 = $e;
}
assert($geworfenJ2 instanceof RuntimeException,
    'J2: ein Verbund-Vermerk OHNE Flaeche muss werfen, statt den breiten Regionsweg zu waehlen'
    . ' (sonst rissen Geschwister-Flaechen eines Verbunds mit)');

echo "OK -- garetien-ruecknahme-weg-verbund-ohne-flaeche (Fixrunde 1, Befund 1)\n";

/**
 * Ein 'region'-Item VOLLSTAENDIG uebernehmen lassen und den Item-Datensatz zurueckgeben --
 * gebuendelt, weil Abschnitt K/L/M denselben Ablauf mehrfach braucht (anlegen, Vermerk lesen,
 * die echten Flaechen-/Region-/Label-ids einsammeln).
 */
function avesmapsGaretienRuecknahmeTestVerbundAnlegen(PDO $pdo, int $userId): array
{
    $runId = avesmapsSyncPlanStartRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND, $userId, 'test-ruecknahme-verbund');
    $item1 = avesmapsGaretienVerbundTestFragment($pdo, $runId, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
    $item2 = avesmapsGaretienVerbundTestFragment($pdo, $runId, 'Silker Hain 2', 2, avesmapsGaretienVerbundTestRing(200, 200));
    $ergebnis = avesmapsGaretienUebernehmen($pdo, $runId, [$item1, $item2], ['id' => $userId], null, [
        $item1 => ['verbund' => 'Silker Hain'],
        $item2 => ['verbund' => 'Silker Hain'],
    ]);
    if ($ergebnis['fehler'] !== []) {
        throw new RuntimeException('Testaufbau gescheitert: ' . json_encode($ergebnis['fehler'], JSON_UNESCAPED_UNICODE));
    }

    $noten = $pdo->query('SELECT id, apply_note FROM sync_plan_item WHERE id IN (' . $item1 . ',' . $item2 . ') ORDER BY id')
        ->fetchAll(PDO::FETCH_KEY_PAIR);

    return [
        'run_id' => $runId,
        'item1' => $item1,
        'item2' => $item2,
        'vermerk1' => avesmapsGaretienVermerkLesen((string) $noten[$item1]),
        'vermerk2' => avesmapsGaretienVermerkLesen((string) $noten[$item2]),
    ];
}

// =================================================================================================
// J3. FIXRUNDE 1, BEFUND 2 (Kleinigkeit) -- avesmapsSettlementPlaceExists() wird fuer ein
//     'region'-Item GAR NICHT ERST AUFGERUFEN. Seit Aufgabe 6/7 traegt $publicId bei einem
//     'region'-Item den strukturierten Verbund-Vermerk, nicht mehr eine nackte public_id -- eine
//     Staette wird aber NIE unter `ziel = 'region'` angelegt (Innerorts ist eine eigene Abzweigung
//     VOR der ziel-Weiche, ihr Objekt traegt immer `ziel = 'location'`). Der Aufruf traefe also
//     ohnehin nie, aber er wuerde etwas nachschlagen, das strukturell nie eine public_id war.
// =================================================================================================
$pdoJ3 = avesmapsGaretienVerbundUebernahmeTestPdo();
$verbundJ3 = avesmapsGaretienRuecknahmeTestVerbundAnlegen($pdoJ3, 7);

AvesmapsGaretienVerbundUebernahmeTestPdo::$settlementPlaceExistsAbfragen = 0;
$rJ3 = avesmapsGaretienRuecknahmeAusfuehren($pdoJ3, $verbundJ3['run_id'], [$verbundJ3['item2']], ['id' => 7]);
assert($rJ3['fehler'] === [], 'J3: keine Fehler erwartet: ' . json_encode($rJ3['fehler'], JSON_UNESCAPED_UNICODE));
assert($rJ3['zurueckgenommen'] === 1, 'J3: die Ruecknahme muss trotzdem zaehlen');
assert(AvesmapsGaretienVerbundUebernahmeTestPdo::$settlementPlaceExistsAbfragen === 0,
    'J3: die Staetten-Existenzabfrage darf fuer ein "region"-Item GAR NICHT erst vorbereitet werden'
    . ' -- $publicId ist dort der Verbund-Vermerk, keine public_id, bekommen: '
    . AvesmapsGaretienVerbundUebernahmeTestPdo::$settlementPlaceExistsAbfragen . ' Aufrufe');

echo "OK -- garetien-ruecknahme-keine-staetten-abfrage-bei-region (Fixrunde 1, Befund 2)\n";

// --- K. Die Ruecknahme EINES (nicht des letzten) Fragments nimmt nur DESSEN Flaeche ---
//
// Fragment 2 wird zurueckgenommen, waehrend Fragment 1 noch steht -- Region, Label und die
// Flaeche von Fragment 1 duerfen davon UNBERUEHRT bleiben. Genau das ist die Zusicherung, die
// vor Aufgabe 7 fehlte: der alte Weg haette hier die GANZE Region samt Fragment 1 mitgerissen.
$pdoK = avesmapsGaretienVerbundUebernahmeTestPdo();
$verbundK = avesmapsGaretienRuecknahmeTestVerbundAnlegen($pdoK, 7);

$rK = avesmapsGaretienRuecknahmeAusfuehren($pdoK, $verbundK['run_id'], [$verbundK['item2']], ['id' => 7]);
assert($rK['zurueckgenommen'] === 1, 'K: Fragment 2 muss zurueckgenommen werden: ' . json_encode($rK['fehler'], JSON_UNESCAPED_UNICODE));
assert($rK['fehler'] === [], 'K: keine Fehler erwartet: ' . json_encode($rK['fehler'], JSON_UNESCAPED_UNICODE));

$flaeche1AktivK = (int) $pdoK->query(
    "SELECT is_active FROM ecosystem_area WHERE public_id = '" . $verbundK['vermerk1']['area'] . "'"
)->fetchColumn();
$flaeche2AktivK = (int) $pdoK->query(
    "SELECT is_active FROM ecosystem_area WHERE public_id = '" . $verbundK['vermerk2']['area'] . "'"
)->fetchColumn();
assert($flaeche1AktivK === 1, 'K: Fragment 1s Flaeche bleibt aktiv -- die Ruecknahme darf nicht die ganze Region reissen');
assert($flaeche2AktivK === 0, 'K: NUR Fragment 2s Flaeche wird inaktiv');

$regionAktivK = (int) $pdoK->query(
    "SELECT is_active FROM ecosystem_region WHERE public_id = '" . $verbundK['vermerk1']['region'] . "'"
)->fetchColumn();
assert($regionAktivK === 1, 'K: die Region bleibt aktiv, solange Fragment 1 noch eine Flaeche traegt');

// 🔴 FIXRUNDE 1, BEFUND 3: AN DIE REGION GEBUNDEN, NICHT "irgendeine Zeile mit feature_type =
// 'label'". Ohne Bindung und ohne LIMIT misst diese Abfrage heute nur, weil die Fixture GENAU EIN
// Label kennt -- Abschnitt N unten belegt woertlich, dass sie mit einem zweiten Label das FALSCHE
// misst.
$labelAktivK = (int) $pdoK->query(
    "SELECT is_active FROM map_features WHERE public_id ="
    . " (SELECT label_public_id FROM ecosystem_region WHERE public_id = '" . $verbundK['vermerk1']['region'] . "')"
)->fetchColumn();
assert($labelAktivK === 1, 'K: die Beschriftung bleibt stehen, solange die Region noch eine Flaeche traegt');

$itemK2 = $pdoK->query('SELECT apply_state, apply_note, selected FROM sync_plan_item WHERE id = ' . $verbundK['item2'])
    ->fetch(PDO::FETCH_ASSOC);
assert($itemK2['apply_state'] === null && $itemK2['apply_note'] === null, 'K: Fragment 2 faellt zurueck auf "Offen"');
assert((int) $itemK2['selected'] === 1, 'K: Fragment 2 ist wieder angehakt');

echo "OK -- garetien-ruecknahme-einzelfragment (Aufgabe 7, Schritt K)\n";

// --- L. Die Ruecknahme des LETZTEN verbliebenen Fragments nimmt Region UND Beschriftung mit ---
//
// Fortsetzung von K: jetzt auch Fragment 1 zurueck (den ANFUEHRER -- der die Region angelegt
// hat). Es ist jetzt das LETZTE verbliebene Fragment der Region -- avesmapsDeleteEcosystemArea
// muss die Kaskade selbst ausloesen, OHNE dass diese Funktion einen Anfuehrer-Sonderfall kennt.
$rL = avesmapsGaretienRuecknahmeAusfuehren($pdoK, $verbundK['run_id'], [$verbundK['item1']], ['id' => 7]);
assert($rL['zurueckgenommen'] === 1, 'L: Fragment 1 (der Anfuehrer) muss zurueckgenommen werden: ' . json_encode($rL['fehler'], JSON_UNESCAPED_UNICODE));
assert($rL['fehler'] === [], 'L: keine Fehler erwartet: ' . json_encode($rL['fehler'], JSON_UNESCAPED_UNICODE));

$flaeche1AktivL = (int) $pdoK->query(
    "SELECT is_active FROM ecosystem_area WHERE public_id = '" . $verbundK['vermerk1']['area'] . "'"
)->fetchColumn();
assert($flaeche1AktivL === 0, 'L: Fragment 1s Flaeche wird jetzt auch inaktiv');

$regionAktivL = (int) $pdoK->query(
    "SELECT is_active FROM ecosystem_region WHERE public_id = '" . $verbundK['vermerk1']['region'] . "'"
)->fetchColumn();
assert($regionAktivL === 0, 'L: OHNE eine einzige verbliebene Flaeche geht die Region automatisch mit (Kaskade in avesmapsDeleteEcosystemArea)');

// 🔴 FIXRUNDE 1, BEFUND 3: dieselbe Bindung wie bei K -- siehe die Begruendung dort.
$labelAktivL = (int) $pdoK->query(
    "SELECT is_active FROM map_features WHERE public_id ="
    . " (SELECT label_public_id FROM ecosystem_region WHERE public_id = '" . $verbundK['vermerk1']['region'] . "')"
)->fetchColumn();
assert($labelAktivL === 0, 'L: und die Beschriftung ebenso -- kein Geist, der eine leere Region benennt');

// 🔴 KEIN ANFUEHRER-SONDERFALL, GEPRUEFT AM PROTOKOLL: die Region muss ueber die KASKADE in
// avesmapsDeleteEcosystemArea verschwinden ('delete_region_cascade'), nicht ueber einen
// EXPLIZITEN Aufruf von avesmapsDeleteEcosystemRegion ('delete_region'). Am reinen Ergebnis
// (is_active = 0 ueberall) sind beide Wege nicht zu unterscheiden -- nur das Protokoll verraet,
// ob die Weiche wirklich ueber die Flaeche gegangen ist, wie Entwurf §8 verlangt.
$protokollAktionL = $pdoK->query(
    "SELECT action FROM ecosystem_geometry_audit_log WHERE region_public_id = '" . $verbundK['vermerk1']['region']
    . "' AND action LIKE 'delete_region%' ORDER BY id DESC LIMIT 1"
)->fetchColumn();
assert($protokollAktionL === 'delete_region_cascade',
    'L: die Region muss ueber die Flaechen-Kaskade verschwinden (delete_region_cascade), nicht ueber '
    . 'einen expliziten Regions-Loeschweg -- kein Anfuehrer-Sonderfall, bekommen: ' . $protokollAktionL);

echo "OK -- garetien-ruecknahme-letztes-fragment (Aufgabe 7, Schritt L)\n";

// =================================================================================================
// M. ZUSATZANFORDERUNG DES KOORDINATORS (Pruefbefund B, Aufgabe 6) -- der laufuebergreifende
//    Rueckfall MUSS durch DIESELBE Vermerk-Zerlegung wie der Hauptweg.
// =================================================================================================
//
// Fehlerszenario: "Holen & Rechnen" legt einen NEUEN Lauf an (der alte wird 'superseded', aber
// nie geloescht -- avesmapsSyncPlanStartRun). Das FRISCHE Item hat ein LEERES apply_note; der
// laufuebergreifende Rueckfall (weiter oben in avesmapsGaretienRuecknahmeAusfuehren, "gesucht
// wird ueber (kind, entity_key, change_type)") findet die AELTERE Zeile und liest DEREN Vermerk
// in $publicId. Eine Weiche, die stattdessen `$item['apply_note']` NEU einliest, sieht davon
// nichts -- sie bekommt fuer das frische Item IMMER '', und mit dem neuen Verbund-Format ergibt
// avesmapsGaretienRuecknahmeWeg('') ein LEERES Loeschziel: 'kein Loeschziel im Vermerk'. Dieser
// Pfad (ein zweites "Holen & Rechnen" vor der Ruecknahme) funktioniert schon lange (siehe
// Abschnitt F oben) und darf durch Aufgabe 7 NICHT brechen.
$pdoM = avesmapsGaretienVerbundUebernahmeTestPdo();
$runMA = avesmapsSyncPlanStartRun($pdoM, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-m-a');
$itemMA1 = avesmapsGaretienVerbundTestFragment($pdoM, $runMA, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(300, 700));
$itemMA2 = avesmapsGaretienVerbundTestFragment($pdoM, $runMA, 'Silker Hain 2', 2, avesmapsGaretienVerbundTestRing(400, 700));
$ergebnisMA = avesmapsGaretienUebernehmen($pdoM, $runMA, [$itemMA1, $itemMA2], ['id' => 7], null, [
    $itemMA1 => ['verbund' => 'Silker Hain'],
    $itemMA2 => ['verbund' => 'Silker Hain'],
]);
assert($ergebnisMA['fehler'] === [], 'M (Testaufbau): Lauf A legt den Verbund an, keine Fehler: '
    . json_encode($ergebnisMA['fehler'], JSON_UNESCAPED_UNICODE));

$vermerkMA1 = avesmapsGaretienVermerkLesen(
    (string) $pdoM->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemMA1)->fetchColumn()
);
assert($vermerkMA1['verbund'] === 'Silker Hain' && $vermerkMA1['area'] !== '',
    'M (Testaufbau): Fragment 1 traegt den strukturierten Verbund-Vermerk');

// "Holen & Rechnen": Lauf B derselben Art -- Lauf A wird 'superseded', NICHT geloescht.
$runMB = avesmapsSyncPlanStartRun($pdoM, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-m-b');
$laufMAState = $pdoM->query('SELECT state FROM sync_plan_run WHERE id = ' . $runMA)->fetchColumn();
assert($laufMAState === 'superseded', 'M (Testaufbau): Lauf A steht auf superseded, nicht geloescht -- bekommen: ' . $laufMAState);

// Dieselbe Zeile (Fragment 1, entity_key "ggp:Waelder:Wald:#1") kommt im neuen Lauf FRISCH an:
// apply_state und apply_note sind NULL, wie bei jedem frisch eingelesenen Vorschlag.
$itemMB1 = avesmapsGaretienVerbundTestFragment($pdoM, $runMB, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(300, 700));
$frischMB1 = $pdoM->query('SELECT apply_state, apply_note FROM sync_plan_item WHERE id = ' . $itemMB1)->fetch(PDO::FETCH_ASSOC);
assert($frischMB1['apply_state'] === null && $frischMB1['apply_note'] === null,
    'M (Testaufbau): das frische Item in Lauf B hat wirklich noch KEINEN eigenen Vermerk');

// Die Ruecknahme laeuft auf dem FRISCHEN Item in Lauf B -- nicht auf dem alten aus Lauf A.
$rM = avesmapsGaretienRuecknahmeAusfuehren($pdoM, $runMB, [$itemMB1], ['id' => 7]);
assert($rM['fehler'] === [],
    'M: der laufuebergreifende Rueckfall muss die Flaeche finden, kein "kein Loeschziel im Vermerk": '
    . json_encode($rM['fehler'], JSON_UNESCAPED_UNICODE));
assert($rM['zurueckgenommen'] === 1, 'M: die Ruecknahme ueber den Rueckfall muss zaehlen');

$flaeche1AktivM = (int) $pdoM->query(
    "SELECT is_active FROM ecosystem_area WHERE public_id = '" . $vermerkMA1['area'] . "'"
)->fetchColumn();
assert($flaeche1AktivM === 0, 'M: GENAU Fragment 1s Flaeche (aus dem Vermerk der ALTEN Zeile) wird inaktiv');

$flaeche2AktivM = (int) $pdoM->query(
    "SELECT is_active FROM ecosystem_area WHERE public_id = '" . avesmapsGaretienVermerkLesen(
        (string) $pdoM->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemMA2)->fetchColumn()
    )['area'] . "'"
)->fetchColumn();
assert($flaeche2AktivM === 1,
    'M: Fragment 2s Flaeche bleibt aktiv -- der Rueckfall darf NICHT die ganze Region treffen');

$regionAktivM = (int) $pdoM->query(
    "SELECT is_active FROM ecosystem_region WHERE public_id = '" . $vermerkMA1['region'] . "'"
)->fetchColumn();
assert($regionAktivM === 1, 'M: die Region bleibt aktiv -- Fragment 2 traegt sie weiter');

// ⚠️ UND DIE ALTE ZEILE (Lauf A, Fragment 1) FAELLT MIT AUF "Offen" ZURUECK -- sonst faende die
// naechste Ruecknahme/Anfuehrer-Suche denselben Vermerk wieder, der jetzt auf eine geloeschte
// Flaeche zeigt (derselbe Riegel wie beim path/location/label-Weg, siehe die Kommentare oben an
// `$altItemId`).
$altZeileM = $pdoM->query('SELECT apply_state, apply_note FROM sync_plan_item WHERE id = ' . $itemMA1)->fetch(PDO::FETCH_ASSOC);
assert($altZeileM['apply_state'] === null && $altZeileM['apply_note'] === null,
    'M: die urspruengliche Zeile aus Lauf A faellt mit auf "Offen" zurueck');

echo "OK -- garetien-ruecknahme-laufuebergreifender-vermerk (Aufgabe 7, Zusatzanforderung)\n";

// =================================================================================================
// N. FIXRUNDE 1, BEFUND 3 (Kleinigkeit) -- die Beschriftungs-Abfrage in K/L bindet an ihre EIGENE
//    Region. Ohne Bindung und ohne LIMIT (die Fassung vor dieser Fixrunde) misst
//    "SELECT is_active FROM map_features WHERE feature_type = 'label'" nur deshalb richtig, weil
//    die K/L-Fixture GENAU EIN Label kennt -- mit einem zweiten Label liefert sie das FALSCHE,
//    ohne jede Fehlermeldung.
// =================================================================================================
//
// Aufbau: ein FREMDER Verbund wird ZUERST angelegt und komplett zurueckgenommen -- sein Label ist
// danach inaktiv und traegt (weil zuerst angelegt) die niedrigere id. Erst danach entsteht der
// GEPRUEFTE Verbund mit seinem aktiven Label. `fetchColumn()` ohne ORDER BY und ohne LIMIT liefert
// bei einem einfachen Tabellenscan die erste Zeile in ROWID-Reihenfolge -- also das FREMDE,
// laengst inaktive Label, nicht das aktive Label des gepruedften Verbunds.
$pdoN = avesmapsGaretienVerbundUebernahmeTestPdo();

$verbundNFremd = avesmapsGaretienRuecknahmeTestVerbundAnlegen($pdoN, 7);
$rNFremd = avesmapsGaretienRuecknahmeAusfuehren(
    $pdoN, $verbundNFremd['run_id'], [$verbundNFremd['item1'], $verbundNFremd['item2']], ['id' => 7]
);
assert($rNFremd['fehler'] === [] && $rNFremd['zurueckgenommen'] === 2,
    'N (Testaufbau): der fremde Verbund wird VOLLSTAENDIG zurueckgenommen, sein Label also inaktiv: '
    . json_encode($rNFremd['fehler'], JSON_UNESCAPED_UNICODE));

$verbundN = avesmapsGaretienRuecknahmeTestVerbundAnlegen($pdoN, 7);

$labelnN = $pdoN->query("SELECT id, is_active FROM map_features WHERE feature_type = 'label' ORDER BY id")
    ->fetchAll(PDO::FETCH_ASSOC);
assert(count($labelnN) === 2, 'N (Testaufbau): GENAU ZWEI Label-Zeilen, bekommen: ' . count($labelnN));
assert((int) $labelnN[0]['is_active'] === 0 && (int) $labelnN[1]['is_active'] === 1,
    'N (Testaufbau): das FREMDE Label (niedrigere id) ist inaktiv, das GEPRUEFTE (hoehere id) aktiv');

// 🪤 DIE UNGEBUNDENE FORM -- woertlich die Abfrage aus K/L vor dieser Fixrunde. Mit zwei Labeln in
// der Fixture liefert sie das FALSCHE (fremde, laengst inaktive) Label, nicht das aktive Label des
// gerade gepruedften Verbunds -- genau der Befund, hier woertlich belegt statt nur behauptet.
$labelUngebundenN = (int) $pdoN->query("SELECT is_active FROM map_features WHERE feature_type = 'label'")->fetchColumn();
assert($labelUngebundenN === 0,
    'N: OHNE Bindung an die Region liefert die Abfrage das FALSCHE Label (0 statt 1) -- mit einem'
    . ' zweiten Label bricht sie still, bekommen: ' . $labelUngebundenN);

// Die REPARATUR (auch in K/L angewendet): an die eigene Region gebunden, trifft die Abfrage das
// RICHTIGE Label -- unabhaengig davon, wie viele weitere Label-Zeilen daneben liegen.
$labelGebundenN = (int) $pdoN->query(
    "SELECT is_active FROM map_features WHERE public_id ="
    . " (SELECT label_public_id FROM ecosystem_region WHERE public_id = '" . $verbundN['vermerk1']['region'] . "')"
)->fetchColumn();
assert($labelGebundenN === 1,
    'N: an die eigene Region gebunden liefert die Abfrage das RICHTIGE (aktive) Label, bekommen: '
    . $labelGebundenN);

echo "OK -- garetien-ruecknahme-label-abfrage-gebunden (Fixrunde 1, Befund 3)\n";

// =================================================================================================
// O. NAME = STAMM (Entwurf 14.09.2026, Fehler 1) -- Flaeche UND Weg, im SERVER gesetzt
// =================================================================================================
//
// 💣 Der Verbund-Entwurf sagte „Name = Stamm" dreimal zu (§0.3, §3, §6), gebaut war es nie: die
// Region hiess „Silker Hain 1", die Wiki-Suche fragte `silkerhain1`, und zwei Wegabschnitte
// „Alkenstieg" + „Alkenstieg 2" blieben zwei Wege. Eine Sperre nur im Browser ist keine -- der
// Server setzt den Stamm selbst, sobald `verbund` im Rumpf steht und kein Name gewaehlt ist.

/** Ein 'new'-Weg-Item -- dieselbe Form wie avesmapsGaretienVerbundTestFragment, nur als Linie. */
function avesmapsGaretienVerbundTestWeg(PDO $pdo, int $runId, string $label, int $nr, array $linie): int
{
    $pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected)
                   VALUES (?, ?, NULL, 'new', ?, NULL, ?, NULL, 1)")
        ->execute([
            $runId,
            'ggp:Wege:Weg:#' . $nr,
            $label,
            json_encode([
                'herkunft' => 'garetien', 'ziel' => 'path', 'subtyp' => 'Weg', 'kind' => null,
                'name' => $label, 'geometry' => ['type' => 'LineString', 'coordinates' => $linie],
            ], JSON_UNESCAPED_UNICODE),
        ]);

    return (int) $pdo->lastInsertId();
}

// --- O1. Die Flaeche: Region UND Beschriftung heissen wie der Stamm.
$pdoO = avesmapsGaretienVerbundUebernahmeTestPdo();
$runO = avesmapsSyncPlanStartRun($pdoO, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-o');
$itemO1 = avesmapsGaretienVerbundTestFragment($pdoO, $runO, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
$itemO2 = avesmapsGaretienVerbundTestFragment($pdoO, $runO, 'Silker Hain 2', 2, avesmapsGaretienVerbundTestRing(200, 200));
$ergebnisO = avesmapsGaretienUebernehmen($pdoO, $runO, [$itemO1, $itemO2], ['id' => 7], null, [
    $itemO1 => ['verbund' => 'Silker Hain'],
    $itemO2 => ['verbund' => 'Silker Hain'],
]);
assert($ergebnisO['fehler'] === [], 'O1: keine Fehler: ' . json_encode($ergebnisO['fehler'], JSON_UNESCAPED_UNICODE));
$regionNameO = $pdoO->query('SELECT name FROM ecosystem_region')->fetchAll(PDO::FETCH_COLUMN);
assert($regionNameO === ['Silker Hain'], 'O1: die Region heisst wie der STAMM, nicht wie das erste Fragment: '
    . json_encode($regionNameO, JSON_UNESCAPED_UNICODE));
$labelNameO = $pdoO->query("SELECT name FROM map_features WHERE feature_type = 'label'")->fetchAll(PDO::FETCH_COLUMN);
assert($labelNameO === ['Silker Hain'], 'O1: die Beschriftung ebenso: ' . json_encode($labelNameO, JSON_UNESCAPED_UNICODE));

// --- O2. Ein von Hand gewaehlter Name schlaegt den Stamm.
$pdoO2 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runO2 = avesmapsSyncPlanStartRun($pdoO2, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-o2');
$itemO21 = avesmapsGaretienVerbundTestFragment($pdoO2, $runO2, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
$ergebnisO2 = avesmapsGaretienUebernehmen($pdoO2, $runO2, [$itemO21], ['id' => 7], null, [
    $itemO21 => ['verbund' => 'Silker Hain', 'name' => 'Silberner Hain'],
]);
assert($ergebnisO2['fehler'] === [], 'O2: keine Fehler: ' . json_encode($ergebnisO2['fehler'], JSON_UNESCAPED_UNICODE));
assert($pdoO2->query('SELECT name FROM ecosystem_region')->fetchColumn() === 'Silberner Hain',
    'O2: der Handname gewinnt -- „Name danach aenderbar" (Verbund-Owner 09.09.2026/3)');

// --- O3. Der Weg: beide Abschnitte heissen wie der Stamm, und damit ist es EIN Weg
//         (`name:<Wegart>:<Stamm>`, wpGroupKeyOf). Ein Abschnitt OHNE Verbund behaelt seinen Namen.
$pdoO3 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runO3 = avesmapsSyncPlanStartRun($pdoO3, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-o3');
$wegO1 = avesmapsGaretienVerbundTestWeg($pdoO3, $runO3, 'Alkenstieg', 11, [[100.0, 100.0], [120.0, 110.0]]);
$wegO2 = avesmapsGaretienVerbundTestWeg($pdoO3, $runO3, 'Alkenstieg 2', 12, [[300.0, 300.0], [320.0, 310.0]]);
$wegO3 = avesmapsGaretienVerbundTestWeg($pdoO3, $runO3, 'Bruchweg 2', 13, [[500.0, 500.0], [520.0, 510.0]]);
$ergebnisO3 = avesmapsGaretienUebernehmen($pdoO3, $runO3, [$wegO1, $wegO2, $wegO3], ['id' => 7], null, [
    $wegO1 => ['verbund' => 'Alkenstieg'],
    $wegO2 => ['verbund' => 'Alkenstieg'],
    $wegO3 => [],
]);
assert($ergebnisO3['fehler'] === [], 'O3: keine Fehler: ' . json_encode($ergebnisO3['fehler'], JSON_UNESCAPED_UNICODE));
$wegNamenO3 = $pdoO3->query("SELECT name FROM map_features WHERE feature_type = 'path' ORDER BY id")->fetchAll(PDO::FETCH_COLUMN);
assert($wegNamenO3 === ['Alkenstieg', 'Alkenstieg', 'Bruchweg 2'],
    'O3: beide Verbund-Abschnitte tragen den Stamm, der dritte seinen eigenen Namen: '
    . json_encode($wegNamenO3, JSON_UNESCAPED_UNICODE));

// --- O4. Ein Punktziel bekommt den Stamm NIE -- ein Verbund wird eine Flaeche oder ein Weg.
$nachPunkt = avesmapsGaretienNameUebersteuern(['ziel' => 'label', 'name' => 'Zwillingsgipfel 1'], ['verbund' => 'Zwillingsgipfel']);
assert($nachPunkt['name'] === 'Zwillingsgipfel 1', 'O4: ein Berggipfel behaelt seinen Namen: ' . $nachPunkt['name']);
$nachOrt = avesmapsGaretienNameUebersteuern(['ziel' => 'location', 'name' => 'Lilienhof 1'], ['verbund' => 'Lilienhof']);
assert($nachOrt['name'] === 'Lilienhof 1', 'O4: ein Ort ebenso');
$ohneRumpf = avesmapsGaretienNameUebersteuern(['ziel' => 'region', 'name' => 'Silker Hain 1'], null);
assert($ohneRumpf['name'] === 'Silker Hain 1', 'O4: ohne Rumpf bleibt der Vorschlag');

echo "OK -- garetien-verbund-name-stamm (Entwurf 14.09.2026, Fehler 1)\n";

// =================================================================================================
// P. DER WIKI-SCHLUESSEL LANDET AN DER REGION -- gesucht mit dem Stamm
// =================================================================================================
//
// 🔴 Die Wiki-Zuweisung sucht mit `$nach['name']` -- also erst seit O mit dem Stamm. Bis dahin
// fragte sie `silkerhain1`, fand nichts, und keiner der vier Teile bekam einen Artikel.
// 💣 UND SIE HING NUR AM SCHILD. Die Region traegt bei einem Verbund vier Flaechen, an ihr haengen
// Kanon und Statuskreis. ⚠️ avesmapsCreateEcosystemRegion liest keinen Schluessel, sondern leitet ihn
// aus `wiki_url` ab (avesmapsEcosystemReadRegionFields) -- die Uebernahme reicht deshalb die ADRESSE
// des Treffers weiter, nie einen selbst gebauten Schluessel.
$pdoP = avesmapsGaretienVerbundUebernahmeTestPdo();
// ⚠️ Nur die Spalten, die avesmapsGaretienWikiLandschaftVorschlag/-Zuweisung lesen
// (`SELECT wiki_key, name, art ... WHERE match_key`, dann `SELECT *` fuer das Zuweisungsobjekt).
$pdoP->exec('CREATE TABLE wiki_region_staging (wiki_key TEXT PRIMARY KEY, title TEXT, name TEXT, match_key TEXT,
    art TEXT, wiki_url TEXT, continent TEXT, region_parent TEXT, synonyms_json TEXT, neighbors_json TEXT)');
$wikiUrlP = 'https://de.wiki-aventurica.de/wiki/Silker_Hain';
$pdoP->prepare('INSERT INTO wiki_region_staging (wiki_key, title, name, match_key, art, wiki_url) VALUES (?, ?, ?, ?, ?, ?)')
    ->execute(['silker-hain', 'Silker Hain', 'Silker Hain', avesmapsWikiSyncCreateMatchKey('Silker Hain'), 'Wald', $wikiUrlP]);
$runP = avesmapsSyncPlanStartRun($pdoP, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-p');
$itemP1 = avesmapsGaretienVerbundTestFragment($pdoP, $runP, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
$itemP2 = avesmapsGaretienVerbundTestFragment($pdoP, $runP, 'Silker Hain 2', 2, avesmapsGaretienVerbundTestRing(200, 200));
$ergebnisP = avesmapsGaretienUebernehmen($pdoP, $runP, [$itemP1, $itemP2], ['id' => 7], null, [
    $itemP1 => ['verbund' => 'Silker Hain'],
    $itemP2 => ['verbund' => 'Silker Hain'],
]);
assert($ergebnisP['fehler'] === [], 'P: keine Fehler: ' . json_encode($ergebnisP['fehler'], JSON_UNESCAPED_UNICODE));
$regionP = $pdoP->query('SELECT wiki_url, wiki_region_key FROM ecosystem_region')->fetchAll(PDO::FETCH_ASSOC);
assert(count($regionP) === 1, 'P (Testaufbau): genau eine Region');
assert($regionP[0]['wiki_url'] === $wikiUrlP,
    'P: die REGION traegt die Adresse des Treffers: ' . json_encode($regionP[0], JSON_UNESCAPED_UNICODE));
assert($regionP[0]['wiki_region_key'] !== null
    && $regionP[0]['wiki_region_key'] === avesmapsEcosystemWikiRegionKey($wikiUrlP),
    'P: und den daraus ABGELEITETEN Schluessel -- dieselbe Faltung wie jeder andere Schreiber: '
    . json_encode($regionP[0], JSON_UNESCAPED_UNICODE));
$labelPropsP = json_decode((string) $pdoP->query("SELECT properties_json FROM map_features WHERE feature_type = 'label'")->fetchColumn(), true);
assert(($labelPropsP['wiki_region']['wiki_key'] ?? null) === 'silker-hain',
    'P: die Beschriftung behaelt ihre Zuweisung: ' . json_encode($labelPropsP['wiki_region'] ?? null, JSON_UNESCAPED_UNICODE));

// --- P2. Ohne Treffer bleibt die Region ohne Artikel -- kein erfundener Schluessel.
$pdoP2 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runP2 = avesmapsSyncPlanStartRun($pdoP2, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-p2');
$itemP21 = avesmapsGaretienVerbundTestFragment($pdoP2, $runP2, 'Nirgendwald 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
avesmapsGaretienUebernehmen($pdoP2, $runP2, [$itemP21], ['id' => 7], null, [$itemP21 => ['verbund' => 'Nirgendwald']]);
$regionP2 = $pdoP2->query('SELECT wiki_url, wiki_region_key FROM ecosystem_region')->fetch(PDO::FETCH_ASSOC);
assert($regionP2['wiki_url'] === null && $regionP2['wiki_region_key'] === null,
    'P2: ohne Treffer weder Adresse noch Schluessel: ' . json_encode($regionP2));

echo "OK -- garetien-verbund-wiki-an-der-region (Entwurf 14.09.2026, §6.6)\n";

// =================================================================================================
// S. DER BESTAND (Owner 14.09.2026) -- was vor diesem Deploy uebernommen oder abgelehnt wurde
// =================================================================================================
//
// 🔴 Der Importer ist live, der Verbund-Zweig war es nie. Ein Item von dort traegt ein `after_json`
// OHNE `verbund_stamm`/`verbund_n`, einen NACKTEN Vermerk (die public_id der Region) und keinen
// `verbund` im Rumpf -- „Alle angezeigten einfuegen" schickte nie Einstellungen. Nichts davon wird
// migriert; jeder Leser behandelt das Fehlende als „kein Verbund".
// Der Leser des Reiters „Uebernommen" (avesmapsGaretienVerbundAngelegt) wohnt in der Arbeitsliste.
require_once __DIR__ . '/../garetien-liste.php';

/** Ein Flaechen-Fragment MIT eigenem Artikel -- damit avesmapsGaretienQuellenAnlegen wirklich verknuepft. */
function avesmapsGaretienVerbundTestFragmentMitArtikel(PDO $pdo, int $runId, string $label, int $nr, array $ring, string $artikelUrl): int
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
                'artikel_quelle' => [
                    'url' => $artikelUrl, 'label' => $label . ' auf garetien.de', 'source_type' => 'briefspiel',
                    'origin' => 'garetien', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de',
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

    return (int) $pdo->lastInsertId();
}

// --- S1. Ein Einzelobjekt wie aus dem Bestand: der Name bleibt, und es bleibt zuruecknehmbar.
$pdoS = avesmapsGaretienVerbundUebernahmeTestPdo();
$runS = avesmapsSyncPlanStartRun($pdoS, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-s');
$itemS1 = avesmapsGaretienVerbundTestFragmentMitArtikel($pdoS, $runS, 'Muehlsee 2', 1, avesmapsGaretienVerbundTestRing(100, 100),
    'https://www.garetien.de/index.php/Muehlsee');
$abgelehntS = avesmapsGaretienVerbundTestFragment($pdoS, $runS, 'Schilfsee 2', 2, avesmapsGaretienVerbundTestRing(300, 300));
// Die abgelehnte Zeile: so, wie die Tuer 'decline' sie hinterlaesst -- abgehakt, Entscheidung dauerhaft.
$pdoS->prepare('UPDATE sync_plan_item SET selected = 0 WHERE id = ?')->execute([$abgelehntS]);
$pdoS->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, declined_at) VALUES (?, 'ggp:Waelder:Wald:#2', 'new', '2026-09-01 10:00:00')")
    ->execute([AVESMAPS_GARETIEN_PLAN_KIND]);

// Der Weg ueber die echte Tuer-Funktion, mit BEIDEN ids -- wie ein alter Client, der nur ids schickt.
$schrittS = avesmapsGaretienApplyStep($pdoS, $runS, 7, ['id' => 7], null, [$itemS1, $abgelehntS], null, null);
assert($schrittS['fehler'] === [] && $schrittS['applied'] === 1,
    'S1: der Bestand-Weg (ohne Rumpf) legt genau das eine angehakte Objekt an: ' . json_encode($schrittS, JSON_UNESCAPED_UNICODE));
assert($pdoS->query('SELECT name FROM ecosystem_region')->fetchAll(PDO::FETCH_COLUMN) === ['Muehlsee 2'],
    'S1: ohne `verbund` im Rumpf bleibt der Name des Vorschlags -- kein Stamm, kein „Muehlsee"');
$abgelehntZeileS = $pdoS->query('SELECT selected, apply_state FROM sync_plan_item WHERE id = ' . $abgelehntS)->fetch(PDO::FETCH_ASSOC);
assert((int) $abgelehntZeileS['selected'] === 0 && $abgelehntZeileS['apply_state'] === null,
    'S1: die ABGELEHNTE Zeile bleibt unberuehrt: ' . json_encode($abgelehntZeileS));
assert($pdoS->query("SELECT declined_at FROM sync_decision WHERE entity_key = 'ggp:Waelder:Wald:#2'")->fetchColumn() === '2026-09-01 10:00:00',
    'S1: und ihre Ablehnung steht');

// Der Vermerk, wie der LIVE-Stand ihn schreibt: die nackte public_id der Region.
$regionS = avesmapsGaretienVermerkLesen((string) $pdoS->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemS1)->fetchColumn())['region'];
$pdoS->prepare('UPDATE sync_plan_item SET apply_note = ? WHERE id = ?')->execute([$regionS, $itemS1]);
$zeileS1 = $pdoS->query('SELECT apply_state, apply_note FROM sync_plan_item WHERE id = ' . $itemS1)->fetch(PDO::FETCH_ASSOC);
assert(avesmapsGaretienVerbundAngelegt($zeileS1) === '',
    'S1: ANZEIGBAR -- der Reiter „Uebernommen" liest einen nackten Vermerk als „kein Verbund"');
$rS1 = avesmapsGaretienRuecknahmeAusfuehren($pdoS, $runS, [$itemS1], ['id' => 7]);
assert($rS1['fehler'] === [] && $rS1['zurueckgenommen'] === 1,
    'S1: ZURUECKNEHMBAR wie vorher: ' . json_encode($rS1['fehler'], JSON_UNESCAPED_UNICODE));
assert((int) $pdoS->query("SELECT is_active FROM ecosystem_region WHERE public_id = '" . $regionS . "'")->fetchColumn() === 0,
    'S1: die Region ist weg');
assert($pdoS->query("SELECT declined_at FROM sync_decision WHERE entity_key = 'ggp:Waelder:Wald:#2'")->fetchColumn() === '2026-09-01 10:00:00',
    'S1: die Ablehnung ueberlebt auch die Ruecknahme des Nachbarn');

// --- S2. Ein Vermerk „area:… | region:…" OHNE `verbund:` ist ein Einzelobjekt, kein Anfuehrer.
$pdoS2 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runS2 = avesmapsSyncPlanStartRun($pdoS2, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-s2');
$itemS21 = avesmapsGaretienVerbundTestFragment($pdoS2, $runS2, 'Tannwald 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
avesmapsGaretienUebernehmen($pdoS2, $runS2, [$itemS21], ['id' => 7], null, [$itemS21 => []]);
$itemS22 = avesmapsGaretienVerbundTestFragment($pdoS2, $runS2, 'Tannwald 2', 2, avesmapsGaretienVerbundTestRing(200, 200));
avesmapsGaretienUebernehmen($pdoS2, $runS2, [$itemS22], ['id' => 7], null, [$itemS22 => ['verbund' => 'Tannwald']]);
assert((int) $pdoS2->query('SELECT COUNT(*) FROM ecosystem_region WHERE is_active = 1')->fetchColumn() === 2,
    'S2: ein Bestands-Objekt ohne `verbund:` im Vermerk wird nie Anfuehrer eines spaeteren Verbunds');

echo "OK -- garetien-verbund-bestand (Owner 14.09.2026)\n";

// =================================================================================================
// Q. EIN GESCHEITERTER ANFUEHRER HINTERLAESST NICHTS (Entwurf 14.09.2026, Fehler 7)
// =================================================================================================
//
// 💣 Der Anfuehrer legt in DREI Hausfunktionen an (Label, Region, Flaeche), und jede hat ihre eigene
// Transaktion. Scheiterte Schritt 3, blieben Beschriftung und eine LEERE Region als Waise stehen --
// und weil sein Item `failed` war, fand der naechste Teil keinen Anfuehrer und legte eine ZWEITE
// Region desselben Namens an. Nichts davon war ruecknehmbar: die Waise hing an keinem `done`-Vermerk.
// Gemessen am Zweig (scratchpad s3-s6-ablauf.php, S6a): 2 aktive Regionen, 2 aktive Labels.
// ⚠️ Der Abbruch wird mit einem SQLite-Trigger erzwungen -- dieselbe Stelle, an der auf MySQL eine
// Schluesselverletzung oder ein abgebrochener Worker den Schritt beenden.

/** Wie viele Zeilen sind aktiv? Region, Flaeche, Beschriftung -- die drei Dinge, die ein Anfuehrer anlegt. */
function avesmapsGaretienVerbundTestBestand(PDO $pdo): array
{
    return [
        'regionen' => (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_region WHERE is_active = 1')->fetchColumn(),
        'flaechen' => (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_area WHERE is_active = 1')->fetchColumn(),
        'labels' => (int) $pdo->query("SELECT COUNT(*) FROM map_features WHERE feature_type = 'label' AND is_active = 1")->fetchColumn(),
        'leere_regionen' => (int) $pdo->query(
            'SELECT COUNT(*) FROM ecosystem_region r WHERE r.is_active = 1
               AND NOT EXISTS (SELECT 1 FROM ecosystem_area a WHERE a.region_id = r.id AND a.is_active = 1)'
        )->fetchColumn(),
    ];
}

// --- Q1. Schritt 3 (die Flaeche) des Anfuehrers scheitert.
$pdoQ = avesmapsGaretienVerbundUebernahmeTestPdo();
$pdoQ->exec("CREATE TRIGGER abbruch_schritt3 BEFORE INSERT ON ecosystem_area WHEN NEW.min_x = 100
             BEGIN SELECT RAISE(ABORT, 'simulierter Abbruch Schritt 3'); END");
$runQ = avesmapsSyncPlanStartRun($pdoQ, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-q');
$itemQ1 = avesmapsGaretienVerbundTestFragment($pdoQ, $runQ, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
$itemQ2 = avesmapsGaretienVerbundTestFragment($pdoQ, $runQ, 'Silker Hain 2', 2, avesmapsGaretienVerbundTestRing(200, 200));
$itemQ3 = avesmapsGaretienVerbundTestFragment($pdoQ, $runQ, 'Silker Hain 3', 3, avesmapsGaretienVerbundTestRing(300, 300));
$ergebnisQ = avesmapsGaretienUebernehmen($pdoQ, $runQ, [$itemQ1, $itemQ2, $itemQ3], ['id' => 7], null, [
    $itemQ1 => ['verbund' => 'Silker Hain'],
    $itemQ2 => ['verbund' => 'Silker Hain'],
    $itemQ3 => ['verbund' => 'Silker Hain'],
]);
assert(count($ergebnisQ['fehler']) === 1 && $ergebnisQ['fehler'][0]['item'] === $itemQ1
    && str_contains($ergebnisQ['fehler'][0]['grund'], 'simulierter Abbruch Schritt 3'),
    'Q1: der Anfuehrer scheitert und nennt den ECHTEN Grund: ' . json_encode($ergebnisQ['fehler'], JSON_UNESCAPED_UNICODE));
$stateQ1 = $pdoQ->query('SELECT apply_state FROM sync_plan_item WHERE id = ' . $itemQ1)->fetchColumn();
assert($stateQ1 === 'failed', 'Q1: sein Item steht auf failed: ' . var_export($stateQ1, true));
$bestandQ = avesmapsGaretienVerbundTestBestand($pdoQ);
assert($bestandQ === ['regionen' => 1, 'flaechen' => 2, 'labels' => 1, 'leere_regionen' => 0],
    'Q1: GENAU EINE Region mit den zwei uebrigen Flaechen und EIN Label -- keine Waise des Anfuehrers: '
    . json_encode($bestandQ));
$noteQ2 = avesmapsGaretienVermerkLesen((string) $pdoQ->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemQ2)->fetchColumn());
$noteQ3 = avesmapsGaretienVermerkLesen((string) $pdoQ->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemQ3)->fetchColumn());
assert($noteQ2['region'] !== '' && $noteQ2['region'] === $noteQ3['region'],
    'Q1: Fragment 2 wurde der neue Anfuehrer, Fragment 3 haengt an SEINER Region');

// --- Q2. Schritt 2 (die Region) scheitert -- das Label ist da schon angelegt.
$pdoQ2 = avesmapsGaretienVerbundUebernahmeTestPdo();
$pdoQ2->exec("CREATE TRIGGER abbruch_schritt2 BEFORE INSERT ON ecosystem_region WHEN NEW.name = 'Bruchwald'
              BEGIN SELECT RAISE(ABORT, 'simulierter Abbruch Schritt 2'); END");
$runQ2 = avesmapsSyncPlanStartRun($pdoQ2, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-q2');
$itemQ21 = avesmapsGaretienVerbundTestFragment($pdoQ2, $runQ2, 'Bruchwald 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
$ergebnisQ2 = avesmapsGaretienUebernehmen($pdoQ2, $runQ2, [$itemQ21], ['id' => 7], null, [
    $itemQ21 => ['verbund' => 'Bruchwald'],
]);
assert(count($ergebnisQ2['fehler']) === 1 && str_contains($ergebnisQ2['fehler'][0]['grund'], 'simulierter Abbruch Schritt 2'),
    'Q2: der Schritt-2-Abbruch wird gemeldet: ' . json_encode($ergebnisQ2['fehler'], JSON_UNESCAPED_UNICODE));
assert(avesmapsGaretienVerbundTestBestand($pdoQ2) === ['regionen' => 0, 'flaechen' => 0, 'labels' => 0, 'leere_regionen' => 0],
    'Q2: die schon angelegte Beschriftung ist wieder weg: ' . json_encode(avesmapsGaretienVerbundTestBestand($pdoQ2)));

// --- Q3. Ein Teil haengt sich NIE an eine Region ohne aktive Flaeche.
// Der Anfuehrer ist `done`, danach verliert seine Region ihre Flaeche OHNE Kaskade (ein Abbruch
// mitten in einem Aufraeumen, oder ein Handgriff an der Datenbank) -- die Region steht aktiv und leer.
$pdoQ3 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runQ3 = avesmapsSyncPlanStartRun($pdoQ3, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-q3');
$itemQ31 = avesmapsGaretienVerbundTestFragment($pdoQ3, $runQ3, 'Leerwald 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
avesmapsGaretienUebernehmen($pdoQ3, $runQ3, [$itemQ31], ['id' => 7], null, [$itemQ31 => ['verbund' => 'Leerwald']]);
$regionQ3Alt = avesmapsGaretienVermerkLesen((string) $pdoQ3->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemQ31)->fetchColumn())['region'];
$pdoQ3->exec('UPDATE ecosystem_area SET is_active = 0');
$itemQ32 = avesmapsGaretienVerbundTestFragment($pdoQ3, $runQ3, 'Leerwald 2', 2, avesmapsGaretienVerbundTestRing(200, 200));
$ergebnisQ3 = avesmapsGaretienUebernehmen($pdoQ3, $runQ3, [$itemQ32], ['id' => 7], null, [$itemQ32 => ['verbund' => 'Leerwald']]);
assert($ergebnisQ3['fehler'] === [], 'Q3: keine Fehler: ' . json_encode($ergebnisQ3['fehler'], JSON_UNESCAPED_UNICODE));
$regionQ3Neu = avesmapsGaretienVermerkLesen((string) $pdoQ3->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemQ32)->fetchColumn())['region'];
assert($regionQ3Neu !== '' && $regionQ3Neu !== $regionQ3Alt,
    'Q3: Fragment 2 haengt NICHT an der leeren Region, es wird selbst Anfuehrer');

echo "OK -- garetien-verbund-anfuehrer-raeumt-auf (Entwurf 14.09.2026, Fehler 7)\n";

// =================================================================================================
// R. DIE QUELLE DER REGION FAELLT ERST MIT DER LETZTEN FLAECHE (Fehler 9)
// =================================================================================================
//
// 🔴 Alle Fragmente eines Verbunds haengen ihre Garetien-Quelle an DIESELBE Stelle -- die Region
// (`ecosystem:<region_public_id>`). Die Ruecknahme EINES Fragments darf sie den uebrigen nicht
// nehmen; die Ruecknahme des LETZTEN muss sie loesen, sonst bleibt eine Verknuepfung an einer
// geloeschten Region zurueck, und ein erneuter Import haengt sie an eine neue.
// Der Helfer avesmapsGaretienVerbundTestFragmentMitArtikel steht in Abschnitt S.

$artikelR = 'https://www.garetien.de/index.php/Silker_Hain';
$pdoR = avesmapsGaretienVerbundUebernahmeTestPdo();
$runR = avesmapsSyncPlanStartRun($pdoR, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-r');
$itemR1 = avesmapsGaretienVerbundTestFragmentMitArtikel($pdoR, $runR, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(100, 100), $artikelR);
$itemR2 = avesmapsGaretienVerbundTestFragmentMitArtikel($pdoR, $runR, 'Silker Hain 2', 2, avesmapsGaretienVerbundTestRing(200, 200), $artikelR);
$ergebnisR = avesmapsGaretienUebernehmen($pdoR, $runR, [$itemR1, $itemR2], ['id' => 7], null, [
    $itemR1 => ['verbund' => 'Silker Hain'],
    $itemR2 => ['verbund' => 'Silker Hain'],
]);
assert($ergebnisR['fehler'] === [], 'R (Testaufbau): keine Fehler: ' . json_encode($ergebnisR['fehler'], JSON_UNESCAPED_UNICODE));
$regionR = avesmapsGaretienVermerkLesen((string) $pdoR->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemR1)->fetchColumn())['region'];
$verknuepfungenR = static fn(): int => (int) $pdoR->query(
    "SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'ecosystem' AND entity_public_id = '" . $regionR . "' AND origin = 'garetien'"
)->fetchColumn();
assert($verknuepfungenR() === 1, 'R (Testaufbau): die Region traegt die Garetien-Quelle: ' . $verknuepfungenR());

$rR2 = avesmapsGaretienRuecknahmeAusfuehren($pdoR, $runR, [$itemR2], ['id' => 7]);
assert($rR2['fehler'] === [] && $rR2['zurueckgenommen'] === 1, 'R: Fragment 2 zurueck: ' . json_encode($rR2['fehler'], JSON_UNESCAPED_UNICODE));
assert($verknuepfungenR() === 1,
    'R: 💣 die Region traegt noch Fragment 1 -- ihre Quelle bleibt stehen: ' . $verknuepfungenR());

$rR1 = avesmapsGaretienRuecknahmeAusfuehren($pdoR, $runR, [$itemR1], ['id' => 7]);
assert($rR1['fehler'] === [] && $rR1['zurueckgenommen'] === 1, 'R: Fragment 1 zurueck: ' . json_encode($rR1['fehler'], JSON_UNESCAPED_UNICODE));
assert($verknuepfungenR() === 0,
    'R: mit der LETZTEN Flaeche faellt die Quelle der Region: ' . $verknuepfungenR());
$nachtragR = array_values(array_filter($rR1['quellen_neu'],
    static fn(array $e): bool => $e['entity_type'] === 'ecosystem' && $e['public_id'] === $regionR));
assert(count($nachtragR) === 1 && $nachtragR[0]['sources'] === [],
    'R: und der Browser erfaehrt es -- die Liste der Region ist jetzt leer: ' . json_encode($rR1['quellen_neu'], JSON_UNESCAPED_UNICODE));
$sourcesR = (int) $pdoR->query('SELECT COUNT(*) FROM sources')->fetchColumn();
assert($sourcesR === 1, 'R: 🔴 NUR die Verknuepfung, NIE die geteilte Katalogzeile: ' . $sourcesR);

// --- R2. Eine Flaeche OHNE Verbund: ihre Ruecknahme ist immer die letzte, die Quelle faellt mit.
$pdoR2 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runR2 = avesmapsSyncPlanStartRun($pdoR2, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-r2');
$itemR21 = avesmapsGaretienVerbundTestFragmentMitArtikel($pdoR2, $runR2, 'Muehlsee', 1, avesmapsGaretienVerbundTestRing(100, 100),
    'https://www.garetien.de/index.php/Muehlsee');
avesmapsGaretienUebernehmen($pdoR2, $runR2, [$itemR21], ['id' => 7], null, [$itemR21 => []]);
$regionR2 = avesmapsGaretienVermerkLesen((string) $pdoR2->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemR21)->fetchColumn())['region'];
$rR21 = avesmapsGaretienRuecknahmeAusfuehren($pdoR2, $runR2, [$itemR21], ['id' => 7]);
assert($rR21['fehler'] === [] && $rR21['zurueckgenommen'] === 1, 'R2: zurueck: ' . json_encode($rR21['fehler'], JSON_UNESCAPED_UNICODE));
$restR2 = (int) $pdoR2->query("SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'ecosystem' AND entity_public_id = '" . $regionR2 . "'")->fetchColumn();
assert($restR2 === 0, 'R2: die Quelle der einzelnen Flaeche faellt mit ihrer Region: ' . $restR2);

// --- R3. DER BESTAND (Owner 14.09.2026): ein NACKTER Vermerk, wie jeder vor dem Deploy uebernommene.
// ⚠️ DIE EINE VERHALTENSAENDERUNG AM BESTAND: auch hier faellt die Garetien-Quelle jetzt mit. Vorher
// blieb sie als Verknuepfung an der inaktiven Region stehen -- unsichtbar, aber ein Rest.
$pdoR3 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runR3 = avesmapsSyncPlanStartRun($pdoR3, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-r3');
$itemR31 = avesmapsGaretienVerbundTestFragmentMitArtikel($pdoR3, $runR3, 'Altsee', 1, avesmapsGaretienVerbundTestRing(100, 100),
    'https://www.garetien.de/index.php/Altsee');
avesmapsGaretienUebernehmen($pdoR3, $runR3, [$itemR31], ['id' => 7]);
$regionR3 = avesmapsGaretienVermerkLesen((string) $pdoR3->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemR31)->fetchColumn())['region'];
$pdoR3->prepare('UPDATE sync_plan_item SET apply_note = ? WHERE id = ?')->execute([$regionR3, $itemR31]);
$rR31 = avesmapsGaretienRuecknahmeAusfuehren($pdoR3, $runR3, [$itemR31], ['id' => 7]);
assert($rR31['fehler'] === [] && $rR31['zurueckgenommen'] === 1,
    'R3: der alte Vermerk bleibt zuruecknehmbar: ' . json_encode($rR31['fehler'], JSON_UNESCAPED_UNICODE));
$restR3 = (int) $pdoR3->query("SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'ecosystem' AND entity_public_id = '" . $regionR3 . "'")->fetchColumn();
assert($restR3 === 0, 'R3: und seine Quelle faellt mit der Region: ' . $restR3);

echo "OK -- garetien-verbund-quelle-faellt-mit-der-letzten-flaeche (Entwurf 14.09.2026, Fehler 9)\n";
