<?php

declare(strict_types=1);

// „Quelle und Namen ergaenzen" (Owner 15.09.2026) -- Regel, Uebernahme, Ruecknahme.
//
// Owner, woertlich: „wenn ich "Quelle an „Wald-190" ergänzen" mach - ersetzt es dann auch den namen? …
// wenn nicht, kannst du - sofern solche fälle auftreten - die Option "Quelle und Namen ergänzen" machen?"
// Entscheide auf Rueckfrage: NUR bei Platzhalternamen, und ↩ nimmt Quelle UND Namen zurueck.
//
// 🔴 DIESER PRUEFSTAND DEFINIERT AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT NICHT -- es gilt die Vorgabe `false`, also
// genau die Lage, die live gilt. Die Ausnahme muss unter dem abgeschalteten Ersetzen funktionieren, sonst
// ist sie keine.
//
// 💣 GEFAHREN, NICHT GELESEN: die Hausschreiber (avesmapsUpdateEcosystemRegion, avesmapsUpdatePathFeatureDetails,
// avesmapsUpdateLabelFeature) laufen wirklich, gegen SQLite -- uebersetzt wird nur an der Treiber-Naht, der
// Produktivcode wird nicht fuer den Test verbogen (AGENTS.md §9).
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-name-ergaenzen-test.php

require_once __DIR__ . '/../garetien-liste.php';

$pruefungen = 0;

/**
 * Die Treiber-Naht -- uebernommen aus garetien-verbund-uebernahme-test.php (dort begruendet: die
 * Revisionszaehler, das selbstheilende DDL, `FOR UPDATE`/`NOW(3)`, `ESCAPE`, `app_setting` und die zwei
 * Quellen-Upserts). ⚠️ Kein `require` jener Datei: ihre Zusicherungen liefen sonst ein zweites Mal.
 */
final class AvesmapsGaretienNameErgaenzenTestPdo extends PDO
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
        // Seit Abschnitt L (15.09.2026) erreicht ein Weg MIT Wiki-Artikel avesmapsApplyTransportSeasonsToWikiSiblings, und das sucht
        // ueber JSON_UNQUOTE(JSON_EXTRACT(...)). SQLites json_extract liefert Text schon ohne Anfuehrungszeichen.
        $query = str_replace('JSON_UNQUOTE(', '(', $query);
        $query = str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $query);
        $query = str_replace("ESCAPE '\\\\'", "ESCAPE '\\'", $query);
        if (str_contains($query, 'INSERT INTO app_setting') && str_contains($query, 'ON DUPLICATE KEY UPDATE')) {
            $query = 'INSERT INTO app_setting (setting_key, setting_value) VALUES (:k, :v)
                      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value';
        }
        if (str_contains($query, 'ON DUPLICATE KEY UPDATE')
            && (str_contains($query, 'INTO sources') || str_contains($query, 'INTO feature_sources'))) {
            $query = self::mysqlUpsertNachSqlite($query);
        }

        return parent::prepare($query, $options);
    }

    /** Uebernommen aus garetien-verbund-uebernahme-test.php -- dort begruendet (klammerweise, textbewusst). */
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

function avesmapsGaretienNameErgaenzenTestPdo(): PDO
{
    $pdo = new AvesmapsGaretienNameErgaenzenTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
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
    // ⚠️ Eine STILLGELEGTE Art: ihr alter Griff bleibt ein Griff (avesmapsFetchLandscapeSearchRows).
    $pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label, is_active) VALUES
        ('vegetation', 'wald', 'Wald', 1), ('vegetation', 'urwald', 'Urwald', 0)");
    $pdo->exec('CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
    $pdo->exec('CREATE TABLE ecosystem_geometry_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT, actor_user_id INTEGER NULL, area_public_id TEXT NULL, region_public_id TEXT NULL,
        before_json TEXT, after_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        undone_at TEXT NULL, undone_by INTEGER NULL, undone_by_log_id INTEGER NULL, operation_id TEXT NULL, operation_label TEXT NULL)');
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
    // Fuer den Listenbau (Abschnitt I): leer, aber da -- die Liste liest sie je Lauf.
    $pdo->exec('CREATE TABLE garetien_import_row (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, wiki TEXT, ebene TEXT, zeile_nr INT, typ TEXT, namensraum TEXT, artikel TEXT, anzeige TEXT, lodmin TEXT, lodmax TEXT, extra TEXT, geo_art TEXT, geo TEXT, roh TEXT, urteil TEXT DEFAULT \'\', grund TEXT DEFAULT \'\', abschnitte_json TEXT NULL)');
    avesmapsEnsureSyncPlanTablesSqlite($pdo);

    return $pdo;
}

$uuid = static fn(int $n): string => sprintf('00000000-0000-4000-8000-%012d', $n);
$user = ['id' => 7, 'username' => 'test'];

$regionAnlegen = static function (PDO $pdo, string $id, string $name, ?string $labelId = null): void {
    $pdo->prepare('INSERT INTO ecosystem_region (public_id, name, kind, region_type, label_public_id) VALUES (?,?,?,?,?)')
        ->execute([$id, $name, 'vegetation', 'wald', $labelId]);
};
$labelAnlegen = static function (PDO $pdo, string $id, string $text, string $regionId): void {
    $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json) VALUES (?,?,?,?,?,?,?)')
        ->execute([$id, $text, 'label', 'wald', 'Point', json_encode(['type' => 'Point', 'coordinates' => [5.0, 5.0]]),
            json_encode(['text' => $text, 'size' => 22, 'ecosystem_region_public_id' => $regionId], JSON_UNESCAPED_UNICODE)]);
};
$wegAnlegen = static function (PDO $pdo, string $id, string $name, array $props): void {
    $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json) VALUES (?,?,?,?,?,?,?)')
        ->execute([$id, $name, 'path', 'Flussweg', 'LineString',
            json_encode(['type' => 'LineString', 'coordinates' => [[1.0, 1.0], [2.0, 2.0]]]), json_encode($props)]);
};
/** Ein Ergaenzungs-Item wie aus dem Planbau: felder ['quelle'], der Abschnittsname ist der des STICHTAGS. */
$itemAnlegen = static function (PDO $pdo, int $lauf, string $artikel, string $ziel, string $publicId, string $stichtagName): int {
    $entityKey = 'ggp:Probe:' . $ziel . ':' . $artikel . '|ergaenzung|' . $publicId;
    avesmapsSyncPlanAddItem($pdo, $lauf, [
        'entity_key' => $entityKey,
        'entity_public_id' => $publicId,
        'change_type' => 'changed',
        'label' => $artikel . ' → ' . $stichtagName . ' · Quelle',
        'before' => ['public_id' => $publicId, 'name' => $stichtagName],
        'after' => ['herkunft' => 'garetien', 'anlass' => 'ergaenzung', 'felder' => ['quelle'],
            'ziel' => $ziel, 'subtyp' => $ziel === 'region' ? 'wald' : ($ziel === 'path' ? 'Flussweg' : 'dorf'),
            'kind' => $ziel === 'region' ? 'vegetation' : null,
            'abschnitt' => ['public_id' => $publicId, 'name' => $stichtagName, 'punkte' => 4, 'geometrie' => []],
            'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:' . $artikel,
                'label' => 'Briefspiel (Garetien)', 'source_type' => 'briefspiel', 'origin' => 'garetien',
                'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de']],
        'override' => [], 'selected' => 1,
    ]);
    $stmt = $pdo->prepare('SELECT id FROM sync_plan_item WHERE run_id = ? AND entity_key = ? ORDER BY id DESC LIMIT 1');
    $stmt->execute([$lauf, $entityKey]);

    return (int) $stmt->fetchColumn();
};
$garetienLinks = static function (PDO $pdo, string $entityType, string $publicId): int {
    $s = $pdo->prepare("SELECT COUNT(*) FROM feature_sources WHERE entity_type = ? AND entity_public_id = ? AND origin = 'garetien'");
    $s->execute([$entityType, $publicId]);

    return (int) $s->fetchColumn();
};
$regionZeile = static function (PDO $pdo, string $id): array {
    $s = $pdo->prepare('SELECT name, properties_json FROM ecosystem_region WHERE public_id = ?');
    $s->execute([$id]);

    return (array) $s->fetch(PDO::FETCH_ASSOC);
};
$mapZeile = static function (PDO $pdo, string $id): array {
    $s = $pdo->prepare('SELECT name, properties_json FROM map_features WHERE public_id = ?');
    $s->execute([$id]);
    $zeile = (array) $s->fetch(PDO::FETCH_ASSOC);
    $zeile['props'] = json_decode((string) ($zeile['properties_json'] ?? ''), true) ?: [];

    return $zeile;
};
$itemZeile = static function (PDO $pdo, int $id): array {
    $s = $pdo->prepare('SELECT apply_state, apply_note FROM sync_plan_item WHERE id = ?');
    $s->execute([$id]);

    return (array) $s->fetch(PDO::FETCH_ASSOC);
};
$mitName = static fn(int $id, string $name): array => [$id => ['name_ergaenzen' => true, 'name' => $name]];

// =================================================================================================
// A. DIE REGEL -- zwei bestehende Regeln, keine dritte
// =================================================================================================
$arten = ['Wald', 'Urwald', 'Sümpfe und Moore'];
foreach ([
    ['region', 'Wald-190', true, 'der Griff der Art'],
    ['region', 'Fläche-048', true, 'der Rueckfall-Griff einer Region ohne Art'],
    ['region', 'Urwald-7', true, 'eine andere Art des Katalogs -- ein Griff ueberlebt den Artwechsel'],
    ['region', 'Sümpfe und Moore-012', true, 'eine Artbezeichnung mit Leerzeichen'],
    ['region', 'wald-190', true, 'ohne Gross-/Kleinschreibung, wie die Suche'],
    ['region', 'Wald der Wälder-2', false, 'ein getippter Name, der auf eine Zahl endet'],
    ['region', 'Alkenwald', false, 'ein echter Name'],
    ['region', 'Pfad-5372', false, 'kein Artwort -- an einer Landschaft kein Griff'],
    ['region', '', false, '⚠️ leer ist KEIN Platzhalter'],
    ['region', '   ', false, 'Leerzeichen auch nicht'],
    ['path', 'Pfad-5372', true, 'der Griff eines Weges'],
    ['path', 'Flussweg', true, 'die nackte Wegart'],
    ['path', 'Fläche-048', true, 'Muster 3 von avesmapsWikiPathNameIsGeneric (<wort>-<zahl>)'],
    ['path', 'Alkenstieg', false, 'ein echter Wegname'],
    ['path', 'Wald der Wälder-2', false, 'mit Leerzeichen kein Griff'],
    ['path', '', false, '💣 leer: anders als avesmapsWikiPathNameIsGeneric -- der Owner hat das Fuellen leerer Namen abgeschaltet'],
    ['location', 'Dorf-12', false, 'Orte haben keinen Platzhalter'],
    ['label', 'Berggipfel-3', false, 'Berggipfel auch nicht'],
] as [$ziel, $name, $soll, $warum]) {
    assert(avesmapsGaretienNameIstPlatzhalter($ziel, $name, $arten) === $soll,
        "A: {$ziel} \"{$name}\" -- {$warum}");
    $pruefungen++;
}
assert(avesmapsWikiPathNameIsGeneric('') === true && avesmapsGaretienNameIstPlatzhalter('path', '') === false,
    'A: Gegenprobe -- die Wegregel selbst zaehlt leer als generisch, unsere Frage nicht');
assert(avesmapsGaretienNameIstPlatzhalter('region', 'Wald-190', []) === false,
    'A: ⚠️ ohne Katalog erkennt die Regel WENIGER (nur „Fläche") -- die sichere Richtung');
assert(avesmapsGaretienNameIstPlatzhalter('region', 'Fläche-048', []) === true, 'A: …der Rueckfall-Griff bleibt');
$pruefungen += 3;

$pdoA = avesmapsGaretienNameErgaenzenTestPdo();
$katalog = avesmapsGaretienArtBezeichnungen($pdoA);
sort($katalog);
assert($katalog === ['Urwald', 'Wald'], 'A: der Leser liefert AUCH die stillgelegte Art: ' . json_encode($katalog));
assert(avesmapsGaretienArtBezeichnungen(new PDO('sqlite::memory:')) === [], 'A: ohne Tabelle eine leere Liste, kein Wurf');
$pruefungen += 2;

// =================================================================================================
// B. DER VERMERK
// =================================================================================================
$vermerkRegion = avesmapsGaretienNameVermerkBauen('Wald-190', 'Alkenwald', true, null, [$uuid(1)]);
$gelesen = avesmapsGaretienNameVermerkLesen($vermerkRegion);
assert($gelesen['alt'] === 'Wald-190' && $gelesen['labels'] === [$uuid(1)], 'B: Landschaft hin und zurueck');
assert(array_key_exists('auto', $gelesen) && $gelesen['auto'] === null,
    'B: 💣 `auto: null` (Merker nie angefasst) ist eine Aussage und bleibt erhalten');
assert($gelesen['neu'] === avesmapsGaretienNameFingerabdruck('Alkenwald'), 'B: der neue Name als Fingerabdruck');
$vermerkWeg = avesmapsGaretienNameVermerkBauen('Pfad-5372', 'Alkenstieg', false, null, []);
assert(!array_key_exists('auto', avesmapsGaretienNameVermerkLesen($vermerkWeg)), 'B: am Weg gibt es keinen Merker');
assert(avesmapsGaretienNameVermerkLesen($uuid(99)) === null, 'B: das nackte public_id-Echo ist KEIN Namens-Vermerk');
assert(avesmapsGaretienNameVermerkLesen('') === null, 'B: leer auch nicht');
assert(avesmapsGaretienVermerkLesen($vermerkRegion) === ['area' => '', 'region' => '', 'verbund' => ''],
    'B: 🔴 der Verbund-Leser liest aus dem JSON-Vermerk NICHTS heraus');
$pruefungen += 7;
foreach (['{kaputt', '{"art":"andere"}', '{"art":"name_ergaenzt","alt":"","neu":"x"}'] as $kaputt) {
    $geworfen = null;
    try {
        avesmapsGaretienNameVermerkLesen($kaputt);
    } catch (Throwable $fehler) {
        $geworfen = $fehler->getMessage();
    }
    assert($geworfen !== null && str_contains($geworfen, 'unlesbar'),
        'B: 💣 ein kaputter Vermerk WIRFT, statt „kein Name" zu sagen: ' . $kaputt);
    $pruefungen++;
}
$zuLang = null;
try {
    avesmapsGaretienNameVermerkBauen('Wald-190', 'Alkenwald', true, null, array_map($uuid, range(1, 8)));
} catch (Throwable $fehler) {
    $zuLang = $fehler->getMessage();
}
assert($zuLang !== null && str_contains($zuLang, '300'), 'B: 💣 ein Vermerk ueber 300 Zeichen wird VOR dem Schreiben abgewiesen');
$pruefungen++;

// =================================================================================================
// C. UEBERNAHME -- Landschaft mit Platzhalter: Name, Beschriftung, Merker, Quelle, Vermerk
// =================================================================================================
$pdo = avesmapsGaretienNameErgaenzenTestPdo();
$lauf = avesmapsSyncPlanStartRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND, 1, 'test');

$r1 = $uuid(190);
$l1 = $uuid(191);
$l1b = $uuid(192);
$regionAnlegen($pdo, $r1, 'Wald-190', $l1);
$labelAnlegen($pdo, $l1, 'Wald-190', $r1);
$labelAnlegen($pdo, $l1b, 'Alter Forst', $r1);   // von Hand beschriftet -- bleibt
$i1 = $itemAnlegen($pdo, $lauf, 'Alkenwald', 'region', $r1, 'Wald-190');

$e1 = avesmapsGaretienUebernehmen($pdo, $lauf, [$i1], $user, null, $mitName($i1, 'Alkenwald'));
assert($e1['fehler'] === [], 'C: die Uebernahme gelingt: ' . json_encode($e1['fehler'], JSON_UNESCAPED_UNICODE));
assert($regionZeile($pdo, $r1)['name'] === 'Alkenwald', 'C: 🔴 die Landschaft heisst jetzt wie im Namensfeld');
$propsR1 = json_decode((string) $regionZeile($pdo, $r1)['properties_json'], true);
assert(($propsR1['auto_name'] ?? null) === false, 'C: …und traegt ab jetzt einen gewaehlten Namen (auto_name: false)');
assert($mapZeile($pdo, $l1)['props']['text'] === 'Alkenwald' && $mapZeile($pdo, $l1)['name'] === 'Alkenwald',
    'C: 🔴 die Beschriftung mit dem Platzhaltertext zieht mit -- avesmapsUpdateEcosystemRegion tut es nicht');
assert($mapZeile($pdo, $l1b)['props']['text'] === 'Alter Forst', 'C: ⚠️ ein von Hand beschriftetes Schild bleibt');
assert($garetienLinks($pdo, 'ecosystem', $r1) >= 1, 'C: die Quelle haengt an der Flaeche');
$zeileI1 = $itemZeile($pdo, $i1);
assert($zeileI1['apply_state'] === 'done', 'C: das Item ist uebernommen');
$vermerkI1 = avesmapsGaretienNameVermerkLesen((string) $zeileI1['apply_note']);
assert($vermerkI1 !== null && $vermerkI1['alt'] === 'Wald-190' && $vermerkI1['labels'] === [$l1]
    && array_key_exists('auto', $vermerkI1) && $vermerkI1['auto'] === null,
    'C: der Vermerk traegt alten Namen, Merker (nie angefasst) und genau die eine Beschriftung: ' . $zeileI1['apply_note']);
$pruefungen += 8;
$linksR1 = $garetienLinks($pdo, 'ecosystem', $r1);

// =================================================================================================
// D. RUECKNAHME von C -- Quelle UND Name zurueck, das Hand-Schild bleibt
// =================================================================================================
$r = avesmapsGaretienRuecknahmeAusfuehren($pdo, $lauf, [$i1], $user);
assert($r['zurueckgenommen'] === 1 && $r['fehler'] === [], 'D: die Ruecknahme gelingt: ' . json_encode($r['fehler'], JSON_UNESCAPED_UNICODE));
assert($regionZeile($pdo, $r1)['name'] === 'Wald-190', 'D: 🔴 die Landschaft heisst wieder wie ihr Platzhalter');
$propsR1 = json_decode((string) $regionZeile($pdo, $r1)['properties_json'], true);
assert(!is_array($propsR1) || !array_key_exists('auto_name', $propsR1),
    'D: 💣 der Merker ist wieder „nie angefasst", nicht „aus": ' . $regionZeile($pdo, $r1)['properties_json']);
assert($mapZeile($pdo, $l1)['props']['text'] === 'Wald-190', 'D: die Beschriftung bekommt ihren Platzhaltertext zurueck');
assert($mapZeile($pdo, $l1b)['props']['text'] === 'Alter Forst', 'D: das Hand-Schild bleibt, wie es war');
assert($garetienLinks($pdo, 'ecosystem', $r1) === $linksR1 - 1, 'D: die Quelle dieses Items ist geloest');
assert($itemZeile($pdo, $i1)['apply_state'] === null, 'D: das Item steht wieder offen');
$pruefungen += 7;

// =================================================================================================
// E. WEG mit Platzhalter -- und ein Bach bleibt ein Bach
// =================================================================================================
$p1 = $uuid(5372);
$wegAnlegen($pdo, $p1, 'Pfad-5372', ['is_bach' => true, 'allowed_transports' => [], 'show_label' => false]);
$i2 = $itemAnlegen($pdo, $lauf, 'Alkenbach', 'path', $p1, 'Pfad-5372');
$e2 = avesmapsGaretienUebernehmen($pdo, $lauf, [$i2], $user, null, $mitName($i2, 'Alkenbach'));
assert($e2['fehler'] === [], 'E: die Uebernahme am Weg gelingt: ' . json_encode($e2['fehler'], JSON_UNESCAPED_UNICODE));
assert($mapZeile($pdo, $p1)['name'] === 'Alkenbach', 'E: der Weg heisst wie im Namensfeld');
assert(($mapZeile($pdo, $p1)['props']['is_bach'] ?? null) === true,
    'E: 💣 der Bach bleibt ein Bach -- avesmapsUpdatePathFeatureDetails nimmt den Merker sonst weg');
$vermerkI2 = avesmapsGaretienNameVermerkLesen((string) $itemZeile($pdo, $i2)['apply_note']);
assert($vermerkI2 !== null && $vermerkI2['alt'] === 'Pfad-5372' && !array_key_exists('auto', $vermerkI2), 'E: der Vermerk am Weg');
$pruefungen += 4;

// --- Von Hand umbenannt, danach ↩: NICHTS wird zurueckgenommen, auch nicht die Quelle.
$linksP1 = $garetienLinks($pdo, 'path', $p1);
$zeileP1 = avesmapsGaretienNameZeileLesen($pdo, 'path', $p1);
avesmapsUpdatePathFeatureDetails($pdo, avesmapsGaretienWegDetailsRumpf($p1, $zeileP1, 'Handname'), $user);
$rHand = avesmapsGaretienRuecknahmeAusfuehren($pdo, $lauf, [$i2], $user);
assert($rHand['zurueckgenommen'] === 0, 'E: 🔴 ein inzwischen umbenanntes Objekt wird NICHT zurueckgenommen');
assert(str_contains((string) ($rHand['fehler'][0]['grund'] ?? ''), 'heisst inzwischen anders'),
    'E: …und der Grund sagt es: ' . json_encode($rHand['fehler'], JSON_UNESCAPED_UNICODE));
assert($mapZeile($pdo, $p1)['name'] === 'Handname', 'E: 💣 die Handarbeit geht nie verloren');
assert($garetienLinks($pdo, 'path', $p1) === $linksP1 && $linksP1 >= 1, 'E: die Quelle bleibt auch -- keine halbe Ruecknahme');
assert($itemZeile($pdo, $i2)['apply_state'] === 'done', 'E: das Item bleibt uebernommen');
$pruefungen += 5;

// =================================================================================================
// F. ECHTER NAME -- der Server prueft frisch und schreibt NICHTS
// =================================================================================================
// Die Liste bot die Wahl an (Stichtag „Wald-888"), seither hat jemand die Flaeche benannt.
$r2 = $uuid(888);
$regionAnlegen($pdo, $r2, 'Alkenforst');
$i3 = $itemAnlegen($pdo, $lauf, 'Alkenforst', 'region', $r2, 'Wald-888');
$e3 = avesmapsGaretienUebernehmen($pdo, $lauf, [$i3], $user, null, $mitName($i3, 'Garetischer Forst'));
assert(count($e3['fehler']) === 1 && str_contains($e3['fehler'][0]['grund'], 'eigenen Namen'),
    'F: 🔴 ein echter Name wird abgewiesen, mit Grund: ' . json_encode($e3['fehler'], JSON_UNESCAPED_UNICODE));
assert($regionZeile($pdo, $r2)['name'] === 'Alkenforst', 'F: der Name bleibt');
assert($garetienLinks($pdo, 'ecosystem', $r2) === 0, 'F: 💣 und die Quelle wird AUCH nicht geschrieben -- nichts halb');
assert($itemZeile($pdo, $i3)['apply_state'] === 'failed', 'F: das Item steht auf failed');
$pruefungen += 4;

// =================================================================================================
// G. OHNE AUFTRAG bleibt es beim Alten -- auch mit einem Platzhalter
// =================================================================================================
$r3 = $uuid(333);
$regionAnlegen($pdo, $r3, 'Wald-333');
$i4 = $itemAnlegen($pdo, $lauf, 'Alkenhain', 'region', $r3, 'Wald-333');
$e4 = avesmapsGaretienUebernehmen($pdo, $lauf, [$i4], $user, null, []);
assert($e4['fehler'] === [] && $regionZeile($pdo, $r3)['name'] === 'Wald-333',
    'G: ohne `name_ergaenzen` bleibt der Platzhalter stehen (Owner 31.08.2026)');
assert($garetienLinks($pdo, 'ecosystem', $r3) >= 1, 'G: die Quelle haengt');
assert($itemZeile($pdo, $i4)['apply_note'] === $r3, 'G: und der Vermerk ist das public_id-Echo wie eh und je');
$r4 = $uuid(444);
$regionAnlegen($pdo, $r4, 'Wald-444');
$i5 = $itemAnlegen($pdo, $lauf, 'Alkenmoor', 'region', $r4, 'Wald-444');
avesmapsGaretienUebernehmen($pdo, $lauf, [$i5], $user, null, [$i5 => ['name_ergaenzen' => 'true', 'name' => 'Alkenmoor']]);
assert($regionZeile($pdo, $r4)['name'] === 'Wald-444', 'G: 💣 "true" als Zeichenkette ist kein Auftrag');
$pruefungen += 4;

// =================================================================================================
// H. ANDERE ZIELE, UND DER RIEGEL DES ERSETZENS
// =================================================================================================
$ortId = $uuid(12);
$pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json) VALUES (?,?,?,?,?,?,?)')
    ->execute([$ortId, 'Dorf-12', 'location', 'dorf', 'Point', json_encode(['type' => 'Point', 'coordinates' => [3.0, 3.0]]), '{}']);
$i6 = $itemAnlegen($pdo, $lauf, 'Tannweiler', 'location', $ortId, 'Dorf-12');
$e6 = avesmapsGaretienUebernehmen($pdo, $lauf, [$i6], $user, null, $mitName($i6, 'Tannweiler'));
assert(count($e6['fehler']) === 1 && str_contains($e6['fehler'][0]['grund'], 'nur an Wegen und Landschaften'),
    'H: an einem Ort gibt es die Ausnahme nicht: ' . json_encode($e6['fehler'], JSON_UNESCAPED_UNICODE));
assert($mapZeile($pdo, $ortId)['name'] === 'Dorf-12' && $garetienLinks($pdo, 'settlement', $ortId) === 0,
    'H: …und nichts ist geschrieben');
$riegel = null;
try {
    avesmapsGaretienErgaenzungAnwenden(new PDO('sqlite::memory:'),
        ['herkunft' => 'garetien', 'felder' => ['name', 'quelle'], 'ziel' => 'region', 'name' => 'X'],
        $r3, $user, '', ['name_ergaenzen' => true, 'name' => 'X']);
} catch (Throwable $fehler) {
    $riegel = $fehler->getMessage();
}
assert($riegel !== null && str_contains($riegel, 'Ersetzen ist abgeschaltet'),
    'H: 🔴 AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT bleibt der erste Riegel -- die Ausnahme hebt ihn nicht auf: ' . $riegel);
assert(AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT === false, 'H: der Schalter ist in diesem Pruefstand AUS');
$pruefungen += 4;

// =================================================================================================
// I. HANDARBEIT AM SCHILD, und das AUFRAEUMEN nach einem Fehlschlag mitten im Schreiben
// =================================================================================================
$r5 = $uuid(555);
$l5 = $uuid(556);
$regionAnlegen($pdo, $r5, 'Wald-555', $l5);
$labelAnlegen($pdo, $l5, 'Wald-555', $r5);
$i7 = $itemAnlegen($pdo, $lauf, 'Buchenhain', 'region', $r5, 'Wald-555');
avesmapsGaretienUebernehmen($pdo, $lauf, [$i7], $user, null, $mitName($i7, 'Buchenhain'));
avesmapsUpdateLabelFeature($pdo, ['public_id' => $l5, 'text' => 'Handschild', 'feature_subtype' => 'wald'], $user);
$r7 = avesmapsGaretienRuecknahmeAusfuehren($pdo, $lauf, [$i7], $user);
assert($r7['zurueckgenommen'] === 1, 'I: die Ruecknahme gelingt: ' . json_encode($r7['fehler'], JSON_UNESCAPED_UNICODE));
assert($regionZeile($pdo, $r5)['name'] === 'Wald-555', 'I: die Landschaft bekommt ihren Platzhalter zurueck');
assert($mapZeile($pdo, $l5)['props']['text'] === 'Handschild', 'I: ⚠️ das seither beschriftete Schild behaelt seinen Text');
$pruefungen += 3;

// --- Eine Beschriftung ist gerade von jemand anderem gesperrt: der Name der Landschaft war schon
//     geschrieben und muss zurueck, bevor das Item scheitert.
$r6 = $uuid(666);
$l6 = $uuid(667);
$regionAnlegen($pdo, $r6, 'Wald-666', $l6);
$labelAnlegen($pdo, $l6, 'Wald-666', $r6);
$pdo->prepare('INSERT INTO map_feature_locks (public_id, user_id, username, locked_until) VALUES (?,?,?,?)')
    ->execute([$l6, 99, 'Fremd', '2999-01-01 00:00:00']);
$i8 = $itemAnlegen($pdo, $lauf, 'Eichenhain', 'region', $r6, 'Wald-666');
$e8 = avesmapsGaretienUebernehmen($pdo, $lauf, [$i8], $user, null, $mitName($i8, 'Eichenhain'));
assert(count($e8['fehler']) === 1 && str_contains($e8['fehler'][0]['grund'], 'Fremd'),
    'I: die gesperrte Beschriftung laesst das Item scheitern: ' . json_encode($e8['fehler'], JSON_UNESCAPED_UNICODE));
assert($regionZeile($pdo, $r6)['name'] === 'Wald-666', 'I: 💣 der schon geschriebene Name ist ZURUECKGENOMMEN');
$propsR6 = json_decode((string) $regionZeile($pdo, $r6)['properties_json'], true);
assert(!is_array($propsR6) || !array_key_exists('auto_name', $propsR6), 'I: …samt Merker');
assert($mapZeile($pdo, $l6)['props']['text'] === 'Wald-666', 'I: die Beschriftung ist unberuehrt');
assert($garetienLinks($pdo, 'ecosystem', $r6) === 0, 'I: und keine Quelle haengt');
assert($itemZeile($pdo, $i8)['apply_state'] === 'failed', 'I: das Item steht auf failed');
$pruefungen += 6;

// =================================================================================================
// J. DIE LISTE reicht den Platzhalter-Befund und den Namens-Vermerk an den Browser
// =================================================================================================
// ⚠️ Die Liste liest nur einen OFFENEN Lauf -- avesmapsSyncPlanStartRun legt ihn im Zustand 'building' an,
// der Planbau schliesst ihn mit avesmapsSyncPlanFinishBuild. Uebernahme und Ruecknahme fragen den Zustand nicht.
avesmapsSyncPlanFinishBuild($pdo, $lauf);
$liste = avesmapsGaretienArbeitslisteObjekte($pdo, 1);
$items = [];
$abschnitte = [];
foreach ($liste['objekte'] as $objekt) {
    foreach ($objekt['items'] as $item) {
        $items[(int) $item['id']] = $item;
    }
    foreach ($objekt['abschnitte'] as $abschnitt) {
        $abschnitte[(string) $abschnitt['public_id']] = $abschnitt;
    }
}
assert(($items[$i2]['abschnitt']['platzhalter'] ?? null) === true, 'J: am Item: „Pfad-5372" ist ein Platzhalter: '
    . json_encode(['lauf' => $liste['plan_run_id'], 'ids' => array_keys($items), 'item' => $items[$i2] ?? null], JSON_UNESCAPED_UNICODE));
assert(($items[$i4]['abschnitt']['platzhalter'] ?? null) === true, 'J: am Item: „Wald-333" ebenso (Katalog gelesen)');
assert(($items[$i6]['abschnitt']['platzhalter'] ?? null) === false, 'J: ein Ort nie');
assert(($abschnitte[$r3]['platzhalter'] ?? null) === true, 'J: 🔴 und in `objekt.abschnitte` -- die zweite, feldweise Abschrift');
assert(($abschnitte[$r2]['platzhalter'] ?? null) === true,
    'J: ⚠️ gemessen am STICHTAG („Wald-888") -- der Server weist beim Import ab (F)');
assert(($items[$i2]['name_ergaenzt'] ?? null) === true, 'J: das Item mit Namens-Vermerk sagt es');
assert(($items[$i4]['name_ergaenzt'] ?? null) === false, 'J: das reine Quellen-Item nicht');
assert(($items[$i1]['name_ergaenzt'] ?? null) === false, 'J: das zurueckgenommene auch nicht mehr');
$pruefungen += 8;

// =================================================================================================
// K. LAUFUEBERGREIFEND -- nach „Holen & Rechnen" liegt der Vermerk am alten Item
// =================================================================================================
$r9 = $uuid(777);
$regionAnlegen($pdo, $r9, 'Wald-777');
$iAlt = $itemAnlegen($pdo, $lauf, 'Lindenhain', 'region', $r9, 'Wald-777');
avesmapsGaretienUebernehmen($pdo, $lauf, [$iAlt], $user, null, $mitName($iAlt, 'Lindenhain'));
assert($regionZeile($pdo, $r9)['name'] === 'Lindenhain', 'K: Testaufbau -- im alten Lauf uebernommen');
$laufNeu = avesmapsSyncPlanStartRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND, 1, 'neu');
$iNeu = $itemAnlegen($pdo, $laufNeu, 'Lindenhain', 'region', $r9, 'Lindenhain');
$rNeu = avesmapsGaretienRuecknahmeAusfuehren($pdo, $laufNeu, [$iNeu], $user);
assert($rNeu['zurueckgenommen'] === 1, 'K: das frische Item nimmt zurueck: ' . json_encode($rNeu['fehler'], JSON_UNESCAPED_UNICODE));
assert($regionZeile($pdo, $r9)['name'] === 'Wald-777', 'K: 🔴 der Name kommt ueber den Vermerk des ALTEN Items zurueck');
assert($garetienLinks($pdo, 'ecosystem', $r9) === 0, 'K: die Quelle ist geloest -- das alte Item zaehlt nicht als anderer Traeger');
assert($itemZeile($pdo, $iAlt)['apply_state'] === null, 'K: ⚠️ und das alte Item ist mit zurueckgesetzt');
$pruefungen += 5;

// =================================================================================================
// L. WEG MIT WIKI-ARTIKEL UND PLATZHALTER -- seit 15.09.2026 nimmt er den Namen an
// =================================================================================================
// Bis dahin wies avesmapsGaretienNameErgaenzenVorbereiten ihn ab: R1 liess den Artikelnamen jeden getippten schlagen
// (avesmapsWikiPathEffectiveEditName), das Schreiben waere still verworfen worden. R1 ist umgekehrt (Kopf von
// api/_internal/wiki/path-naming.php: der Wegname gehoert dem Editor) -- und „Quelle und Namen ergaenzen" ist eine ausdrueckliche
// Entscheidung je Item wie ein Umbenennen im Dialog. Der Platzhalter-Riegel bleibt: ein Echtname wird weiter abgewiesen (F).
$laufW = avesmapsSyncPlanStartRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND, 1, 'wiki-weg');
$pW = $uuid(5373);
$wegAnlegen($pdo, $pW, 'Pfad-5373', ['wiki_path' => ['wiki_key' => 'alkenweg', 'name' => 'Alkenweg'], 'allowed_transports' => [], 'show_label' => false]);
$iW = $itemAnlegen($pdo, $laufW, 'Alkenweg', 'path', $pW, 'Pfad-5373');
$eW = avesmapsGaretienUebernehmen($pdo, $laufW, [$iW], $user, null, $mitName($iW, 'Garetischer Alkenweg'));
assert($eW['fehler'] === [], 'L: ein Weg mit Wiki-Artikel weist den Namen wieder ab: ' . json_encode($eW['fehler'], JSON_UNESCAPED_UNICODE));
assert($mapZeile($pdo, $pW)['name'] === 'Garetischer Alkenweg', 'L: der Weg heisst wie im Namensfeld, nicht wie sein Artikel');
assert(($mapZeile($pdo, $pW)['props']['wiki_path']['wiki_key'] ?? '') === 'alkenweg', 'L: die Zuweisung selbst bleibt');
// ↩ gibt den Platzhalter zurueck -- auch das wies der zweite Riegel bis dahin ab.
$rW = avesmapsGaretienRuecknahmeAusfuehren($pdo, $laufW, [$iW], $user);
assert($rW['zurueckgenommen'] === 1, 'L: die Ruecknahme am Wiki-Weg scheitert: ' . json_encode($rW['fehler'], JSON_UNESCAPED_UNICODE));
assert($mapZeile($pdo, $pW)['name'] === 'Pfad-5373', 'L: und der Platzhalter ist zurueck');
$pruefungen += 5;

echo 'OK: garetien-name-ergaenzen, ' . $pruefungen . ' Pruefungen.' . PHP_EOL;
