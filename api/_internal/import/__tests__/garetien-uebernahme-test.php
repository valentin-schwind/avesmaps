<?php

declare(strict_types=1);

// Die Uebernahme -- der EINZIGE Schreibweg dieses Imports.
//
// 🔴 Geschrieben wird NUR, was angehakt ist. Ein nicht genanntes Item bleibt unberuehrt --
// dieselbe Regel wie beim Sammel-Speichern der Weg-Ebene (AGENTS.md §11).
//
// 💣 UND DER PRODUKTIVCODE WIRD NICHT FUER DEN TEST VERBOGEN. `avesmapsNextMapRevision` benutzt
// MySQLs ON DUPLICATE KEY UPDATE, das SQLite nicht kennt. Die Versuchung, es "portabel" zu
// schreiben, ist genau die Falle vom 16.08.2026: eine Sitzung baute ein DELETE ... JOIN in eine
// Subquery um, damit die SQLite-Fixture laeuft, und MySQL lehnte das dann mit Error 1093 ab --
// der Test war gruen und die Produktion kaputt. Die Naht liegt deshalb im TREIBER, wie im
// Konfliktzentrum (conflict-keeper-test.php) vorgemacht.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-uebernahme-test.php

require_once __DIR__ . '/../garetien-uebernahme.php';

$pruefungen = 0;

/** Die einzige MySQL-eigene Anweisung im Schreibpfad, an der Treiber-Naht uebersetzt. */
final class AvesmapsGaretienUebernahmeTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        // 🪤 ZWEI Revisionszaehler mit derselben MySQL-Anweisung: die Karte und die Landschaften.
        // Eine Naht, die nur map_revision kennt, laesst den zweiten durchfallen -- und der Fehler
        // ("near DUPLICATE") liest sich wie ein Fehler des geprueften Codes.
        foreach (['map_revision', 'ecosystem_revision'] as $tabelle) {
            if (str_contains($statement, 'INTO ' . $tabelle) && str_contains($statement, 'ON DUPLICATE KEY UPDATE')) {
                $statement = 'INSERT INTO ' . $tabelle . ' (id, revision) VALUES (1, 2)
                              ON CONFLICT(id) DO UPDATE SET revision = ' . $tabelle . '.revision + 1';
            }
        }
        // 🪤 Das selbstheilende DDL des Hauses ist MySQL-eigen (AUTO_INCREMENT, ENGINE=InnoDB) und
        // laeuft hier nicht. Es wird geschluckt, NICHT uebersetzt: die Tabellen stehen oben von
        // Hand da, und eine zweite Fassung desselben Schemas waere genau die Divergenz, die dieser
        // Test verhindern soll. ⚠️ Faellt dabei eine Tabelle unter den Tisch, schlaegt der Test an
        // seinen Zusicherungen fehl -- nicht an einem stillen Nichts.
        if (str_contains($statement, 'AUTO_INCREMENT') || str_contains($statement, 'ENGINE=InnoDB')) {
            return 0;
        }
        $statement = str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $statement);

        return parent::exec($statement);
    }

    /**
     * 🪤 Die Naht muss AUCH prepare() abdecken, nicht nur exec(). Die beiden MySQL-eigenen
     * Anweisungen des Quellensystems (avesmapsFeatureSourceUpsert / …Link) laufen ueber
     * prepare() -- mit einer Naht nur an exec() faellt der Test an einer Stelle um, die wie ein
     * Fehler des Quellensystems aussieht und keiner ist.
     */
    /**
     * 🪤 Die Schema-Sonden des Hauses fragen information_schema -- die gibt es unter SQLite nicht.
     * Sie beantworten "hat die Tabelle diese Spalte schon?", und hier lautet die Antwort immer ja,
     * weil das Schema oben von Hand vollstaendig dasteht. Eine leere Antwort waere die falsche:
     * der Aufrufer schlosse daraus auf eine fehlende Spalte und liefe in sein ALTER TABLE.
     */
    public function query(string $query, ?int $fetchMode = null, mixed ...$args): PDOStatement|false
    {
        if (str_contains($query, 'information_schema')) {
            return parent::query(self::schemaSondeErsatz($query));
        }

        return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$args);
    }

    /**
     * Eine Schema-Sonde durch "ja, die Spalte gibt es" ersetzen -- MIT ihren Parametern.
     *
     * 🪤 Ein blankes `SELECT 1` reicht NICHT: die Sonden binden `:c` und aehnliches, und PDO
     * antwortet dann mit "column index out of range" -- ein Fehler, der wie ein Fehler des
     * geprueften Codes aussieht und keiner ist. Die Namen werden deshalb aus der Abfrage gelesen
     * und mitgefuehrt, statt sie aufzuzaehlen (eine Liste waere beim naechsten Probennamen falsch).
     */
    private static function schemaSondeErsatz(string $query): string
    {
        preg_match_all('~:[a-zA-Z_][a-zA-Z0-9_]*~', $query, $treffer);
        $namen = array_unique($treffer[0]);
        if ($namen === []) {
            return 'SELECT 1 AS ok';
        }

        return 'SELECT 1 AS ok WHERE ' . implode(' IS NOT NULL AND ', $namen) . ' IS NOT NULL';
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if (str_contains($query, 'information_schema')) {
            return parent::prepare(self::schemaSondeErsatz($query));
        }
        // MySQLs `INSERT IGNORE` heisst bei SQLite `INSERT OR IGNORE` -- dieselbe Aussage, andere
        // Schreibweise. Der Seed der Landschaftsarten laeuft vor jedem Schreibvorgang durch.
        $query = str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $query);
        // Der Einstellungsspeicher -- die Landschaften legen dort ihren Rechenstand ab.
        if (str_contains($query, 'INSERT INTO app_setting') && str_contains($query, 'ON DUPLICATE KEY UPDATE')) {
            $query = 'INSERT INTO app_setting (setting_key, setting_value) VALUES (:k, :v)
                      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value';
        }
        if (str_contains($query, 'INSERT INTO sources')) {
            $query = "INSERT INTO sources (url, url_hash, wiki_key, label, source_type, is_official, created_by)
                      VALUES (:u, :h, :wk, :l, :t, :o, :cb)
                      ON CONFLICT(url_hash) DO UPDATE SET
                          label = CASE WHEN sources.label = '' THEN excluded.label ELSE sources.label END,
                          is_official = excluded.is_official,
                          wiki_key = COALESCE(excluded.wiki_key, sources.wiki_key)";
        } elseif (str_contains($query, 'INSERT INTO feature_sources')) {
            $query = "INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, created_by, origin, reference_kind, pages, note)
                      VALUES (:t, :id, :sid, 'approved', :cb, :o, :rk, :pg, :nt)
                      ON CONFLICT(entity_type, entity_public_id, source_id) DO UPDATE SET
                          reference_kind = excluded.reference_kind,
                          pages = excluded.pages,
                          note = excluded.note,
                          origin = CASE WHEN excluded.origin = 'manual' OR feature_sources.origin = 'manual' THEN 'manual' ELSE excluded.origin END,
                          status = CASE WHEN excluded.origin = 'manual' THEN 'approved' ELSE feature_sources.status END";
        }

        return parent::prepare($query, $options);
    }
}

/**
 * Der Pruefstand: Staging, Bestand, Vorschau -- und ein fertig gebauter Plan.
 *
 * ⚠️ Er baut auf avesmapsGaretienPlanTestPdo() auf, statt einen zweiten Aufbau danebenzustellen.
 * Zwei Fassungen desselben Pruefstands laufen auseinander, und dann prueft der eine etwas
 * anderes als der andere.
 */
function avesmapsGaretienUebernahmeTestPdo(): PDO
{
    $pdo = new AvesmapsGaretienUebernahmeTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $vorlage = avesmapsGaretienPlanTestPdo();

    // Dieselben Tabellen wie im Planbauer-Pruefstand, plus was die HAUSSCHREIBER brauchen.
    $pdo->exec('CREATE TABLE garetien_import_run (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT, finished_at TEXT, status TEXT, note TEXT)');
    $pdo->exec('CREATE TABLE garetien_import_row (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, wiki TEXT, ebene TEXT, zeile_nr INT, typ TEXT, namensraum TEXT, artikel TEXT, anzeige TEXT, lodmin TEXT, lodmax TEXT, extra TEXT, geo_art TEXT, geo TEXT, roh TEXT)');
    $pdo->exec('CREATE TABLE map_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT, feature_subtype TEXT,
        name TEXT, geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
        min_x REAL, min_y REAL, max_x REAL, max_y REAL, sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 1, created_by INTEGER NULL, updated_by INTEGER NULL)');
    $pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
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
    // ⚠️ MIT den nachgeruesteten Spalten. Das Haus legt sie per ALTER an, gesteuert von einer
    // information_schema-Sonde -- die hier immer "gibt es schon" antwortet (siehe oben), also muss
    // das Schema sie WIRKLICH haben. Sonst faellt ein SELECT ueber offroad_factor um, und der
    // Fehler liest sich wie ein Fehler der Uebernahme.
    $pdo->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, label TEXT,
        sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, affects_paths INTEGER DEFAULT 1,
        offroad_factor REAL DEFAULT 1.0, terrain_speed_factor REAL NULL, terrain_grain REAL NULL,
        terrain_levels INTEGER NULL, terrain_avg_height REAL NULL, terrain_mean_height REAL NULL,
        PRIMARY KEY (kind, type_key))');
    $pdo->exec('CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
    // ⚠️ Auch hier MIT den nachgeruesteten Spalten -- "Aenderungen rueckgaengig machen" (29.07.2026)
    // haengt vier davon an, plus operation_id als Klammer um eine Geste.
    $pdo->exec('CREATE TABLE ecosystem_geometry_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT, actor_user_id INTEGER NULL, area_public_id TEXT NULL, region_public_id TEXT NULL,
        before_json TEXT, after_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        undone_at TEXT NULL, undone_by INTEGER NULL, undone_by_log_id INTEGER NULL, operation_id TEXT NULL, operation_label TEXT NULL)');
    $pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label) VALUES
        ('topographie', 'see', 'See'), ('topographie', 'meer', 'Meer'), ('vegetation', 'suempfe_moore', 'Sümpfe und Moore')");
    $pdo->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT)');
    avesmapsEnsureSyncPlanTablesSqlite($pdo);
    // ⚠️ Von Hand, nicht ueber avesmapsEnsureFeatureSourceTables: dessen DDL ist MySQL-eigen und
    // laeuft hier nicht. Dieselbe Loesung wie in feature-source-live-entity-test.php.
    $pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, url_hash TEXT UNIQUE,
        wiki_key TEXT NULL, label TEXT, source_type TEXT, is_official INTEGER DEFAULT 0, created_by INTEGER NULL)');
    $pdo->exec("CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
        entity_public_id TEXT NOT NULL, source_id INTEGER NOT NULL, status TEXT DEFAULT 'approved',
        created_by INTEGER NULL, origin TEXT DEFAULT 'manual', reference_kind TEXT NULL, pages TEXT NULL,
        note TEXT NULL, UNIQUE(entity_type, entity_public_id, source_id))");

    // Bestand und Staging aus dem Planbauer-Pruefstand uebernehmen.
    foreach (['garetien_import_run', 'garetien_import_row'] as $tabelle) {
        foreach ($vorlage->query('SELECT * FROM ' . $tabelle)->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
            unset($zeile['id']);
            $pdo->prepare('INSERT INTO ' . $tabelle . ' (' . implode(',', array_keys($zeile)) . ') VALUES ('
                . implode(',', array_fill(0, count($zeile), '?')) . ')')->execute(array_values($zeile));
        }
    }
    foreach ($vorlage->query('SELECT public_id, name, feature_type, feature_subtype, geometry_json, properties_json FROM map_features')->fetchAll(PDO::FETCH_ASSOC) as $z) {
        $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type)
                       VALUES (?,?,?,?,?,?,?)')
            ->execute([$z['public_id'], $z['name'], $z['feature_type'], $z['feature_subtype'], $z['geometry_json'], $z['properties_json'], 'LineString']);
    }

    avesmapsGaretienKandidatenVergessen();
    avesmapsGaretienBaueSyncPlan($pdo, 1);

    return $pdo;
}

$pdo = avesmapsGaretienUebernahmeTestPdo();
$lauf = (int) avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND)['id'];
$items = $pdo->query('SELECT id, label, change_type FROM sync_plan_item ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
$vorherFeatures = (int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn();

// Der Fluss "Gardel" -- ein Weg.
$gardel = null;
$muehlsee = null;
$seitenarm = null;
foreach ($items as $i) {
    if (str_starts_with((string) $i['label'], 'Gardel')) { $gardel = (int) $i['id']; }
    if (str_starts_with((string) $i['label'], 'Mühlsee')) { $muehlsee = (int) $i['id']; }
    if (str_starts_with((string) $i['label'], 'Seitenarm')) { $seitenarm = (int) $i['id']; }
}
assert($gardel !== null && $muehlsee !== null && $seitenarm !== null, 'der Pruefstand hat die drei Vorschlaege');
$pruefungen++;

// --- 🔴 NUR DAS ANGEHAKTE ITEM WIRD GESCHRIEBEN. Die anderen beiden bleiben unberuehrt.
$e = avesmapsGaretienUebernehmen($pdo, $lauf, [$gardel], ['id' => 7]);
assert($e['angelegt'] === 1, 'genau ein Objekt, ' . $e['angelegt'] . ' geschrieben');
assert($e['fehler'] === [], 'ohne Fehler: ' . json_encode($e['fehler'], JSON_UNESCAPED_UNICODE));
assert((int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === $vorherFeatures + 1);
$pruefungen += 3;

$neu = $pdo->query("SELECT * FROM map_features WHERE name = 'Gardel'")->fetch(PDO::FETCH_ASSOC);
assert($neu !== false && $neu['feature_type'] === 'path' && $neu['feature_subtype'] === 'Flussweg');
$pruefungen++;

// --- 🔴 Jedes uebernommene Objekt bekommt seine Quelle -- ueber das VORHANDENE System.
assert($e['quellen'] === 1);
$q = $pdo->query('SELECT * FROM feature_sources')->fetch(PDO::FETCH_ASSOC);
assert($q['origin'] === 'garetien', 'eigene Herkunft, damit ein spaeterer Lauf sie wiedererkennt');
assert($q['entity_type'] === 'path' && $q['entity_public_id'] === $neu['public_id'], 'sie haengt am richtigen Objekt');
$s = $pdo->query('SELECT * FROM sources')->fetch(PDO::FETCH_ASSOC);
assert(str_contains((string) $s['url'], 'garetien.de'), 'die Quelle zeigt auf den Wiki-Artikel');
// 🔴 BRIEFSPIEL, kein eigener Typ -- garetien.de IST eines, und das Haus fuehrt die Form seit
// langem. Die Lizenzangabe haengt deshalb am WIRT der Adresse, nicht am Typ: beide Wikis tragen
// denselben Typ, und verschieden ist nur der Name, der genannt werden muss.
assert($s['source_type'] === 'briefspiel', 'die Kategorie der Quelle: ' . $s['source_type']);
assert(str_starts_with((string) $s['label'], 'Briefspiel ('), 'und die Beschriftung nennt sie: ' . $s['label']);
$pruefungen += 5;

// --- 💣 Die Lizenz steht NICHT im Label. Sie ist eine Eigenschaft von garetien.de und haengt am
// source_type -- einmal, nicht einmal je Objekt (Entwurf §5.3.1). 289-mal dasselbe in ein Label
// zu schreiben waere die Duplizierung, die das Lore-Quellensystem eine Migration gekostet hat.
assert(!str_contains((string) $s['label'], 'CC BY'), 'die Lizenz gehoert nicht ins Label jedes Objekts');
assert((string) $s['label'] !== '', 'das Label traegt den Artikelnamen');
$pruefungen += 2;

// --- Die Geometrie liegt in UNSEREN Karteneinheiten, nicht in Wagenhalt-Einheiten.
$geo = json_decode((string) $neu['geometry_json'], true);
foreach ($geo['coordinates'] as [$x, $y]) {
    assert($x >= 0.0 && $x <= 1024.0, "x={$x} liegt ausserhalb der Karte -- nicht transformiert?");
    assert($y >= 0.0 && $y <= 1024.0, "y={$y} liegt ausserhalb der Karte -- nicht transformiert?");
}
$pruefungen++;

// --- 🔴 Zweimal uebernehmen legt NICHT zweimal an.
$e2 = avesmapsGaretienUebernehmen($pdo, $lauf, [$gardel], ['id' => 7]);
assert($e2['angelegt'] === 0, 'ein bereits uebernommenes Item wird uebersprungen');
assert((int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === $vorherFeatures + 1);
$pruefungen += 2;

// --- 💣 EINE FLAECHE SIND ZWEI OBJEKTE, UND DAS LABEL IST DAS TRAGENDE. Ein Label ist bei uns
// ein PUNKT; die Flaeche liegt in ecosystem_region und haengt ueber label_public_id daran. Nach
// der Kaskadenregel nimmt das Loeschen des letzten Labels Region UND Flaechen mit -- wer nur die
// Flaeche anlegt, baut eine Region, die kein Mensch je wieder anfassen kann (dieselbe
// Owner-Regel wie bei den verwaisten Aussenhuellen: "es darf keine Elemente geben, ueber die ich
// keine Kontrolle mehr habe").
$e3 = avesmapsGaretienUebernehmen($pdo, $lauf, [$muehlsee], ['id' => 7]);
assert($e3['angelegt'] === 1, 'die Seeflaeche wurde angelegt: ' . json_encode($e3['fehler'], JSON_UNESCAPED_UNICODE));
$region = $pdo->query("SELECT * FROM ecosystem_region WHERE name = 'Mühlsee'")->fetch(PDO::FETCH_ASSOC);
assert($region !== false, 'die Region steht da');
assert($region['kind'] === 'topographie' && $region['region_type'] === 'see');
assert((string) $region['label_public_id'] !== '', 'sie haengt an einem Label');
$label = $pdo->query('SELECT * FROM map_features WHERE public_id = ' . $pdo->quote((string) $region['label_public_id']))->fetch(PDO::FETCH_ASSOC);
assert($label !== false, 'und das Label existiert wirklich');
assert($label['feature_type'] === 'label', 'es ist ein Label');
assert(json_decode((string) $label['geometry_json'], true)['type'] === 'Point', 'und ein PUNKT, keine Flaeche');
$flaeche = $pdo->query('SELECT * FROM ecosystem_area')->fetch(PDO::FETCH_ASSOC);
assert($flaeche !== false && (int) $flaeche['region_id'] === (int) $region['id'], 'die Flaeche haengt an der Region');
$pruefungen += 8;

// --- Und die Quelle der Flaeche haengt an der REGION, nicht am Label.
$qr = $pdo->query("SELECT * FROM feature_sources WHERE entity_type = 'region'")->fetch(PDO::FETCH_ASSOC);
assert($qr !== false && $qr['entity_public_id'] === $region['public_id']);
$pruefungen++;

// --- 🔴 STUFE 1 AENDERT NICHTS VORHANDENES. Ein 'changed'-Item wird ABGELEHNT und der Grund
// benannt -- nicht stillschweigend uebersprungen und nicht ausgefuehrt. Ein Import, der ein
// vorhandenes Kartenobjekt ueberschreibt, ist etwas anderes als ein Import.
$pdo->prepare("UPDATE sync_plan_item SET change_type = 'changed' WHERE id = ?")->execute([$seitenarm]);
$vorher = (int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn();
$e4 = avesmapsGaretienUebernehmen($pdo, $lauf, [$seitenarm], ['id' => 7]);
assert($e4['angelegt'] === 0, 'nichts angelegt');
assert(count($e4['fehler']) === 1, 'und der Grund steht da');
assert(str_contains($e4['fehler'][0]['grund'], 'nur an'), $e4['fehler'][0]['grund']);
assert((int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === $vorher, 'nichts geschrieben');
$pruefungen += 4;

// --- 🔴 Eine leere Auswahl schreibt NICHTS. Sie ist kein "alles".
$vorher = (int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn();
$e5 = avesmapsGaretienUebernehmen($pdo, $lauf, [], ['id' => 7]);
assert($e5['angelegt'] === 0 && (int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === $vorher,
    'eine leere Auswahl ist kein "alles"');
$pruefungen++;

// --- 💣 UND DIESER RIEGEL IST UNTER SQLITE NICHT MESSBAR. Ohne ihn baut die Abfrage ein
// `id IN ()` -- SQLite nimmt das klaglos und liefert null Zeilen, MySQL lehnt es als
// Syntaxfehler ab. Der Endpunkt antwortete dann mit 500 statt mit "nichts ausgewaehlt", und
// dieser Test bliebe gruen: die Mutationsprobe hat genau das gezeigt. Geprueft wird deshalb am
// QUELLTEXT, dass der fruehe Ausstieg dasteht -- die Verhaltenspruefung oben kann es nicht.
// (Dieselbe Klasse wie Error 1093 am 16.08.2026, nur andersherum: dort erzwang SQLite eine
// MySQL-Regression, hier verbirgt es eine.)
$quelle = str_replace("
", "
", (string) file_get_contents(__DIR__ . '/../garetien-uebernahme.php'));
assert(preg_match('~if\s*\(\$itemIds === \[\]\)\s*\{~', $quelle) === 1,
    'der fruehe Ausstieg bei leerer Auswahl steht da -- sonst baut die Abfrage ein IN ()');
$pruefungen++;

// --- 💣 DAS LABEL SITZT IN SEINER FLAECHE. Der Labelschreiber will `lat` und `lng` EINZELN und
// vertauscht gegenueber GeoJSON ([x,y] ist [lng,lat]). Wer sie verwechselt, setzt jedes Label an
// eine an der Diagonale gespiegelte Stelle -- und bei einem Punkt nahe der Diagonale faellt das
// nicht auf. Die Mutationsprobe hat den Tausch ueberlebt, bis diese Zusicherung dastand.
$labelGeo = json_decode((string) $label['geometry_json'], true)['coordinates'];
$ringPunkte = json_decode((string) $flaeche['geometry_geojson'], true)['coordinates'][0];
$rx = array_column($ringPunkte, 0);
$ry = array_column($ringPunkte, 1);
assert($labelGeo[0] >= min($rx) && $labelGeo[0] <= max($rx),
    "das Label liegt bei x={$labelGeo[0]}, die Flaeche zwischen " . min($rx) . ' und ' . max($rx));
assert($labelGeo[1] >= min($ry) && $labelGeo[1] <= max($ry),
    "das Label liegt bei y={$labelGeo[1]}, die Flaeche zwischen " . min($ry) . ' und ' . max($ry));
$pruefungen += 2;

// --- 🔴 EIN FEHLSCHLAG WIRD BENANNT, NICHT VERSCHLUCKT. Ein stiller Ueberspringer waere von
// "wurde angelegt" nicht zu unterscheiden, und die Zahl im Ergebnis waere eine Behauptung.
// Hier ein Vorschlag mit leerer Geometrie -- der Hausschreiber lehnt ihn ab.
$kaputt = json_encode([
    'herkunft' => 'garetien', 'ziel' => 'path', 'subtyp' => 'Flussweg', 'kind' => null,
    'name' => 'Kaputter Bach', 'geometry' => ['type' => 'LineString', 'coordinates' => []],
    'quelle' => ['url' => 'https://www.garetien.de/x', 'label' => 'x', 'source_type' => 'garetien', 'origin' => 'garetien'],
], JSON_UNESCAPED_UNICODE);
$pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected)
               VALUES (?, 'kaputt', NULL, 'new', 'Kaputter Bach', NULL, ?, NULL, 1)")->execute([$lauf, $kaputt]);
$kaputtId = (int) $pdo->lastInsertId();
$vorher = (int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn();
$e6 = avesmapsGaretienUebernehmen($pdo, $lauf, [$kaputtId], ['id' => 7]);
assert($e6['angelegt'] === 0, 'nichts angelegt');
assert(count($e6['fehler']) === 1, 'und der Fehlschlag steht im Ergebnis, nicht nur im Nichts');
assert($e6['fehler'][0]['item'] === $kaputtId, 'mit der Nummer des Items');
assert((string) $e6['fehler'][0]['grund'] !== '', 'und mit einem Grund');
// Und er ist am Item vermerkt, damit ein zweiter Lauf ihn nicht fuer "noch offen" haelt.
$vermerk = $pdo->query('SELECT apply_state FROM sync_plan_item WHERE id = ' . $kaputtId)->fetchColumn();
assert($vermerk === 'failed', "der Vermerk steht am Item: " . var_export($vermerk, true));
assert((int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === $vorher, 'und nichts wurde geschrieben');
$pruefungen += 6;

echo "OK: {$pruefungen} Pruefungen\n";
