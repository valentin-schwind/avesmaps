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
        // ⚠️ Auch die nachruestenden ALTERs: sie kommen aus derselben selbstheilenden Routine,
        // und das Schema steht oben von Hand vollstaendig da. `ALTER TABLE ... MODIFY COLUMN` ist
        // MySQL-eigen und laeuft hier nicht.
        if (str_contains($statement, 'AUTO_INCREMENT')
            || str_contains($statement, 'ENGINE=InnoDB')
            || str_starts_with(ltrim($statement), 'ALTER TABLE')) {
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
     * MySQLs `INSERT ... ON DUPLICATE KEY UPDATE` in SQLites `ON CONFLICT ... DO UPDATE`.
     *
     * Drei Unterschiede, mehr sind es nicht: der Schluessel muss bei SQLite genannt werden
     * (er steht in der UNIQUE-Bedingung der Tabelle), `VALUES(x)` heisst `excluded.x`, und
     * `IF(a, b, c)` heisst `CASE WHEN a THEN b ELSE c END`.
     *
     * 💣 Das IF wird KLAMMERWEISE zerlegt und nicht per Regex: `IF(VALUES(label) = '', label,
     * VALUES(label))` ist verschachtelt, und ein Muster mit `[^,]*` schneidet es an der falschen
     * Stelle auseinander -- lautlos, mit gueltigem SQL als Ergebnis.
     */
    private static function mysqlUpsertNachSqlite(string $query): string
    {
        $schluessel = str_contains($query, 'INTO sources')
            ? '(url_hash)'
            : '(entity_type, entity_public_id, source_id)';
        $query = str_replace('ON DUPLICATE KEY UPDATE', 'ON CONFLICT ' . $schluessel . ' DO UPDATE SET', $query);
        $tabelle = str_contains($query, 'INTO sources') ? 'sources' : 'feature_sources';
        $query = preg_replace('~VALUES\(([a-z_]+)\)~i', 'excluded.$1', $query) ?? $query;

        // IF(a, b, c) -> CASE WHEN a THEN b ELSE c END, von innen nach aussen.
        while (($ab = strpos($query, 'IF(')) !== false) {
            $tiefe = 0;
            $teile = [];
            $stueck = '';
            for ($i = $ab + 3, $n = strlen($query); $i < $n; $i++) {
                $z = $query[$i];
                if ($z === '(') { $tiefe++; }
                if ($z === ')') {
                    if ($tiefe === 0) { $teile[] = $stueck; break; }
                    $tiefe--;
                }
                if ($z === ',' && $tiefe === 0) { $teile[] = $stueck; $stueck = ''; continue; }
                $stueck .= $z;
            }
            if (count($teile) !== 3) { break; }
            $ersatz = 'CASE WHEN ' . trim($teile[0]) . ' THEN ' . trim($teile[1]) . ' ELSE ' . trim($teile[2]) . ' END';
            $query = substr($query, 0, $ab) . $ersatz . substr($query, $i + 1);
        }

        // Ein nacktes Spaltenwort auf der rechten Seite meint bei MySQL die ALTE Zeile; SQLite
        // verlangt dafuer den Tabellennamen davor.
        $teile = explode('DO UPDATE SET', $query, 2);
        if (count($teile) === 2) {
            $teile[1] = preg_replace('~(?<![.\w])(label|is_official|wiki_key|license|attribution|origin|status)(?![\w.])~',
                $tabelle . '.$1', $teile[1]) ?? $teile[1];
            // Die Zuweisungsziele duerfen den Praefix nicht tragen.
            $teile[1] = preg_replace('~' . $tabelle . '\.([a-z_]+)(\s*=)~', '$1$2', $teile[1]) ?? $teile[1];
            $query = $teile[0] . 'DO UPDATE SET' . $teile[1];
        }

        return $query;
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
        // 🔴 AUFGABE 4: die Ergaenzung ruft die HAUSSCHREIBER (avesmapsUpdatePathFeatureDetails /
        // …Geometry), und die pruefen ueber avesmapsAssertFeatureCanBeEdited eine Sperre --
        // dieselben zwei MySQL-eigenen Anweisungen wie in weg-merker-reichweite-test.php, an der
        // Treiber-Naht uebersetzt statt die Funktionen nachzubauen.
        $query = str_replace('FOR UPDATE', '', $query);
        $query = str_replace('NOW(3)', "datetime('now')", $query);
        // MySQLs `INSERT IGNORE` heisst bei SQLite `INSERT OR IGNORE` -- dieselbe Aussage, andere
        // Schreibweise. Der Seed der Landschaftsarten laeuft vor jedem Schreibvorgang durch.
        $query = str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $query);
        // Der Einstellungsspeicher -- die Landschaften legen dort ihren Rechenstand ab.
        if (str_contains($query, 'INSERT INTO app_setting') && str_contains($query, 'ON DUPLICATE KEY UPDATE')) {
            $query = 'INSERT INTO app_setting (setting_key, setting_value) VALUES (:k, :v)
                      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value';
        }
        // 🪤 UEBERSETZT, NICHT ABGESCHRIEBEN. Die erste Fassung ersetzte die beiden Anweisungen
        // durch fertige SQLite-Fassungen -- und beim ersten neuen Feld (license/attribution,
        // 27.08.2026) band die echte Anweisung zwei Parameter mehr, als die Abschrift nannte:
        // "column index out of range", ein Fehler, der wie ein Fehler des Quellensystems aussieht
        // und keiner ist. Eine Naht, die die Produktions-SQL abschreibt, muss bei jeder Aenderung
        // mitwandern; eine, die sie UEBERSETZT, nicht.
        if (str_contains($query, 'ON DUPLICATE KEY UPDATE')) {
            $query = self::mysqlUpsertNachSqlite($query);
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
    // 🔴 AUFGABE 4: avesmapsAssertFeatureCanBeEdited fragt diese Tabelle bei JEDEM Speichern ab
    // (avesmapsUpdatePathFeatureDetails/…Geometry) -- leer bleibt sie hier, ein Test, der eine
    // gehaltene Sperre braucht, saet seine eigene Zeile.
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
    $pdo->exec("CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, url_hash TEXT UNIQUE,
        wiki_key TEXT NULL, label TEXT, source_type TEXT, is_official INTEGER DEFAULT 0, created_by INTEGER NULL,
        license TEXT NOT NULL DEFAULT '', attribution TEXT NOT NULL DEFAULT '')");
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

// --- 🔴 LIZENZ UND NAMENSNENNUNG STEHEN AN DER QUELLE (Owner 27.08.2026: "quellen fehlt das
// lizenz-feld"). Zwei Felder, weil CC zwei getrennte Dinge verlangt: WAS gilt und WEN man nennt.
// 💣 Ohne sie stuenden 239 importierte Objekte ohne Namensnennung auf der Karte -- CC BY-NC-SA
// verlangt sie an jeder Kopie, und der Renderer erraet sie seit heute nicht mehr aus dem Wirt.
assert($s['license'] === 'cc-by-nc-sa-3.0', 'die Lizenz steht an der Quelle: ' . var_export($s['license'], true));
assert($s['attribution'] === 'VolkoV / garetien.de', 'und die Namensnennung: ' . var_export($s['attribution'], true));
$pruefungen += 2;

// ⚠️ Der SCHLUESSEL wird gespeichert, nie der Anzeigetext -- sonst laesst der sich nie
// umformulieren, ohne den Bestand anzufassen.
assert(!str_contains((string) $s['license'], 'CC BY'), 'gespeichert wird der Schluessel, nicht der Text');
$pruefungen++;
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

// --- 🔴 EIN WIDERSPRUCH BLEIBT DRAUSSEN (Aufgabe 4). Der Seitenarm ist ein ZUFLUSS
// (after.anlass = 'zufluss', keiner der drei Ausgaenge ergaenzung/umbenennung/geometrie) -- wird
// er dennoch als 'changed' angeboten, wird er ABGELEHNT und der Grund benannt, nicht
// stillschweigend uebersprungen und nicht ausgefuehrt. Ein Import, der ein vorhandenes
// Kartenobjekt ueberschreibt, ist etwas anderes als ein Import.
// ⚠️ Der Wortlaut des Grundes hat sich mit Aufgabe 4 geaendert (er nennt keine "Stufe 1" mehr,
// weil es jetzt eine zweite Stufe gibt, die 'changed'-Items sehr wohl ausfuehrt) -- geprueft wird
// deshalb der neue Text, nicht mehr der alte.
$pdo->prepare("UPDATE sync_plan_item SET change_type = 'changed' WHERE id = ?")->execute([$seitenarm]);
$vorher = (int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn();
$e4 = avesmapsGaretienUebernehmen($pdo, $lauf, [$seitenarm], ['id' => 7]);
assert($e4['angelegt'] === 0, 'nichts angelegt');
assert(count($e4['fehler']) === 1, 'und der Grund steht da');
assert(str_contains($e4['fehler'][0]['grund'], 'Entscheidung von Hand'), $e4['fehler'][0]['grund']);
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


// --- 🔴 DER SCHRITT DER VORSCHAU: er arbeitet in Haeppchen und MUSS zum Ende kommen.
// 💣 Ein abgelehntes Item ohne Vermerk bleibt „offen" -- und der Schritt laeuft, bis nichts mehr
// offen ist. Beim Verdrahten (27.08.2026) vermerkten beide Ablehnungszweige nichts: der
// Fortschritt haette sich im Kreis gedreht, ohne dass irgendwo ein Fehler stuende.
// ⚠️ Ein FRISCHER Pruefstand: der oben ist abgearbeitet, und ein Schritt ueber null offene
// Zeilen prueft nichts. Das ist keine Bequemlichkeit -- die erste Fassung lief gegen den alten
// Lauf, meldete brav `done` und hatte dabei kein einziges Item angefasst.
$pdo2 = avesmapsGaretienUebernahmeTestPdo();
$lauf2 = (int) avesmapsSyncPlanOpenRun($pdo2, AVESMAPS_GARETIEN_PLAN_KIND)['id'];
// Eine Zeile, die die Uebernahme ABLEHNT -- angehakt und 'changed'. Genau die blieb ohne Vermerk
// ewig offen, und der Schritt waere nie fertig geworden.
$pdo2->prepare("UPDATE sync_plan_item SET change_type = 'changed', selected = 1 WHERE run_id = ? AND label LIKE 'Seitenarm%'")
    ->execute([$lauf2]);
// Und eine Zeile mit FREMDER Herkunft -- die lehnt die Uebernahme ebenfalls ab, und auch sie
// braucht ihren Vermerk, sonst bleibt sie offen.
$pdo2->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected)
                VALUES (?, 'fremd', NULL, 'new', 'Fremder Vorschlag', NULL, ?, NULL, 1)")
    ->execute([$lauf2, json_encode(['herkunft' => 'woanders', 'ziel' => 'path'], JSON_UNESCAPED_UNICODE)]);
$offenVorher = (int) $pdo2->query("SELECT COUNT(*) FROM sync_plan_item WHERE run_id = {$lauf2} AND selected = 1 AND apply_state IS NULL")->fetchColumn();
assert($offenVorher >= 3, 'drei offene Zeilen, davon zwei abzulehnen: ' . $offenVorher);
$pruefungen++;
// 💣 Der Fortschritt wird ZWISCHENDURCH geprueft, nicht nur am Ende: am Ende ist `remaining`
// immer 0, und ein fest verdrahtetes 0 faellt dort nicht auf. Der Client zeigt damit den
// Fortschritt an -- ein Feld, das nur 0 sagen kann, ist eine Luege in der Form einer Tatsache.
$erste = avesmapsGaretienApplyStep($pdo2, $lauf2, 7, ['id' => 7], 2);
assert($erste['processed'] === 2, 'das erste Haeppchen nimmt genau zwei: ' . $erste['processed']);
assert($erste['remaining'] === $offenVorher - 2, 'und meldet den echten Rest: ' . $erste['remaining']);
assert($erste['done'] === false, 'es ist noch nicht fertig');
$pruefungen += 3;

$runden = 1;
$schritt = $erste;
while (!$schritt['done'] && $runden < 20) {
    $schritt = avesmapsGaretienApplyStep($pdo2, $lauf2, 7, ['id' => 7], 2);
    $runden++;
}
assert($schritt['done'] === true, 'der Schritt kommt zum Ende (nach ' . $runden . ' Runden)');
assert($runden < 20, 'und nicht erst am Deckel dieser Schleife');
assert($schritt['remaining'] === 0, 'nichts bleibt offen');
assert($schritt['deleted'] === 0, 'ein Import loescht nichts');
$pruefungen += 4;

// Und JEDE Zeile traegt danach einen Vermerk -- keine bleibt namenlos liegen.
$ohneVermerk = (int) $pdo2->query("SELECT COUNT(*) FROM sync_plan_item WHERE run_id = {$lauf2} AND selected = 1 AND apply_state IS NULL")->fetchColumn();
assert($ohneVermerk === 0, $ohneVermerk . ' Zeilen ohne Vermerk -- die haelt der Schritt fuer offen');
assert($offenVorher > 0, 'es gab ueberhaupt etwas zu tun, sonst prueft das oben nichts');
$pruefungen += 2;

// 🔴 Und die Rueckgabe hat die Form, die die Vorschau erwartet -- `done` beendet die Kette,
// `remaining` treibt den Fortschritt. Ein fehlendes Feld ist dort ein stilles 0.
foreach (['done', 'applied', 'deleted', 'stale', 'processed', 'remaining', 'skipped', 'declined'] as $feld) {
    assert(array_key_exists($feld, $schritt), 'die Rueckgabe nennt ' . $feld);
}
$pruefungen++;

// =================================================================================================
// AUFGABE 4: DER VIERTE AUSGANG WIRD AUCH UEBERNOMMEN.
//
// 🔴 Ohne sie ist dieser Ausgang tot: `avesmapsGaretienUebernehmen` lehnte bis zum 27.08.2026
// jedes `change_type !== 'new'` mit "Stufe 1 legt nur an" ab. Ein Editor haekte an, drueckte
// "Uebernehmen" -- und bekaeme "uebersprungen, weil sich der Stand geaendert hat" fuer etwas, das
// nie versucht wurde.
//
// ⚠️ Ein FRISCHER Pruefstand -- die volle Fassung mit Treiber-Naht und Tabellen
// (avesmapsGaretienUebernahmeTestPdo), nicht die blanke avesmapsGaretienPlanTestPdo() aus
// garetien-plan.php: die blanke Fassung kennt weder NOW(3)/FOR UPDATE/ON DUPLICATE KEY noch
// feature_sources/sources/map_feature_locks -- avesmapsGaretienApplyStep liefe dort schon an
// avesmapsEnsureFeatureSourceTables auf rohes MySQL-DDL.
//
// 🔴 EIN EIGENER, LEERER LAUF (avesmapsSyncPlanStartRun), nicht der von
// avesmapsGaretienUebernahmeTestPdo() schon mitgebrachte -- der traegt bereits Gardel/Muehlsee/
// Alke/Seitenarm mit bis zu AVESMAPS_SYNC_PLAN_APPLY_BUDGET (40) offenen Zeilen, und
// avesmapsGaretienApplyStep raeumt in einem Rutsch alles ab, was in einem Lauf offen ist -- die
// Zusicherung `applied === 1` prüfte dann eine ganz andere Zahl. avesmapsSyncPlanStartRun stellt
// die bisherigen Laeufe dieser Art auf 'superseded' und gibt einen frischen, leeren zurueck; der
// zusaetzliche Eintrag unten ist darin die EINZIGE Zeile.
//
// 💣 UND ZWEI WERTE AUS DEM URSPRUENGLICHEN ENTWURF SIND HIER KORRIGIERT, nicht abgeschrieben:
//   · public_id ist eine ECHTE UUID. avesmapsReadMapFeaturePublicId (in
//     avesmapsUpdatePathFeatureDetails) verlangt genau das Format (`/^[a-f0-9-]{36}$/i`) und
//     wirft sonst schon in der allerersten Zeile -- eine sprechende Kurzform wie "w-5112" waere
//     die FALSCHE Sorte Fehlschlag ("Die Feature-ID ist ungueltig"), nicht der, den dieser Test
//     zeigen soll.
//   · Verkehrsmittel und Saisonfenster tragen die ECHTEN Schluessel/Formen
//     (avesmapsReadAllowedTransports/avesmapsReadTransportSeasons lesen 'riverSailer'/'riverBarge'
//     fuer die Flusswegdomaene und {from_month,from_day,to_month,to_day} mit echten
//     Monatsnamen aus AVESMAPS_TRAVEL_CALENDAR_MONTHS) -- ein erfundener Schluessel wie
//     "flussschiff" oder eine erfundene Form wie {von,bis} wuerde von genau diesen Lesern beim
//     Zurueckschreiben STILL herausgefiltert. Die teuerste Zusicherung dieser Aufgabe pruefte
//     dann eine Normalisierungs-Eigenheit statt die Ergaenzung selbst.
$pdo3 = avesmapsGaretienUebernahmeTestPdo();
$idFluss = '00000000-0000-4000-8000-000000005112';
$pdo3->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idFluss, '', 'path', 'Flussweg',
        json_encode(['type' => 'LineString', 'coordinates' => [[10.0, 10.0], [11.0, 11.0]]]),
        json_encode(['allowed_transports' => ['riverSailer'], 'transport_seasons' => ['riverSailer' => [
            'from_month' => 'peraine', 'from_day' => 1, 'to_month' => 'boron', 'to_day' => 30,
        ]]]), 'LineString']);

$runId4 = avesmapsSyncPlanStartRun($pdo3, AVESMAPS_GARETIEN_PLAN_KIND, 1, 'test');
avesmapsSyncPlanAddItem($pdo3, $runId4, [
    'entity_key' => 'ggp:Gewaesser:Bach:Garetien:Alke|ergaenzung|' . $idFluss,
    'entity_public_id' => $idFluss,
    'change_type' => 'changed',
    'label' => 'Alke → ohne Namen',
    'before' => ['public_id' => $idFluss, 'name' => ''],
    'after' => ['herkunft' => 'garetien', 'anlass' => 'ergaenzung', 'felder' => ['name', 'quelle'],
        'ziel' => 'path', 'subtyp' => 'Flussweg', 'name' => 'Alke',
        'abschnitt' => ['public_id' => $idFluss, 'name' => '', 'punkte' => 12, 'geometrie' => []],
        'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:Alke',
            'label' => 'Briefspiel (Garetien)', 'source_type' => 'briefspiel',
            'origin' => 'garetien', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de']],
    'override' => [], 'selected' => 1,
]);

// -- 🔴 Review I3: ein zweites Item im SELBEN Lauf, das die Weiche ABLEHNEN muss (anlass nicht in
// der Erlaubnisliste) -- nur so unterscheidet die folgende Pruefung wirklich etwas, statt zufaellig
// bei 0 zu landen.
avesmapsSyncPlanAddItem($pdo3, $runId4, [
    'entity_key' => 'ggp:Gewaesser:Bach:Garetien:Widerspruch|widerspruch|' . $idFluss,
    'entity_public_id' => $idFluss,
    'change_type' => 'changed',
    'label' => 'Widerspruch → Alke',
    'before' => ['public_id' => $idFluss, 'name' => 'Alke'],
    'after' => ['herkunft' => 'garetien', 'anlass' => 'widerspruch', 'felder' => ['geometrie'],
        'ziel' => 'path', 'subtyp' => 'Flussweg'],
    'override' => [], 'selected' => 1,
]);

$schritt4 = avesmapsGaretienApplyStep($pdo3, $runId4, 1, ['id' => 1, 'username' => 'test']);
assert($schritt4['done'] === true, 'der Schritt muss fertig werden');
assert($schritt4['applied'] === 1, 'die Ergaenzung wurde nicht uebernommen: ' . json_encode($schritt4));
// 🔴 Review I3 (Vakuum-Fund): `stale` in der Rueckgabe von avesmapsGaretienApplyStep ist ein
// FESTES Literal (`'stale' => 0`) und deshalb fuer JEDE Implementierung wahr -- eine Zusicherung
// darauf prueft nichts. `skipped` (= count($ergebnis['fehler'])) ist das wirklich verdrahtete
// Signal und zaehlt hier GENAU das eine 'widerspruch'-Item, das die Weiche ablehnen muss.
assert($schritt4['skipped'] === 1, 'der Widerspruch muss als abgelehnt gezaehlt werden: ' . json_encode($schritt4));
$pruefungen += 3;

$nachher = $pdo3->query('SELECT name, properties_json FROM map_features WHERE public_id = ' . $pdo3->quote($idFluss))
    ->fetch(PDO::FETCH_ASSOC);
assert($nachher !== false, 'der Fluss steht noch in der Karte');
assert($nachher['name'] === 'Alke', 'die Luecke wurde nicht gefuellt: ' . var_export($nachher['name'], true));
$pruefungen += 2;

// 💣 DIE TEUERSTE ZUSICHERUNG DIESER AUFGABE. avesmapsUpdatePathFeatureDetails ist KEIN
// Teil-Update: mit Vorgabewerten gerufen loescht es Verkehrsmittel und Saisonfenster -- lautlos,
// mit gueltiger Antwort. Geschrieben wird NUR, was in after.felder steht (hier: name, quelle --
// NICHT allowed_transports/transport_seasons, obwohl der Hausschreiber beide im Rumpf erwartet).
$props = json_decode((string) $nachher['properties_json'], true);
assert(($props['allowed_transports'] ?? []) === ['riverSailer'],
    'die Uebernahme hat die Verkehrsmittel des Flusswegs veraendert: ' . json_encode($props['allowed_transports'] ?? null));
assert(isset($props['transport_seasons']['riverSailer']),
    'die Uebernahme hat die Saisonfenster des Flusswegs geloescht: ' . json_encode($props['transport_seasons'] ?? null));
$pruefungen += 2;

// Zweimal uebernehmen aendert nichts ein zweites Mal -- das Item traegt bereits seinen Vermerk.
$zweiter4 = avesmapsGaretienApplyStep($pdo3, $runId4, 1, ['id' => 1, 'username' => 'test']);
assert($zweiter4['applied'] === 0, 'ein vermerktes Item darf nicht noch einmal laufen');
assert($zweiter4['remaining'] === 0, 'und es gilt als erledigt');
$pruefungen += 2;

// =================================================================================================
// 🔴 REVIEW I4: EIN ZUGEWIESENER WIKI-NAME DARF DIE UEBERNAHME NICHT STILL GEWINNEN LASSEN.
// avesmapsUpdatePathFeatureDetails schiebt den Namen durch avesmapsWikiPathEffectiveEditName:
// traegt der Weg ein properties.wiki_path mit kanonischem Namen, wird der Garetien-Name VERWORFEN
// und der Wiki-Name geschrieben -- lautlos, mit gueltiger Antwort. Ohne die Ruecklese-Pruefe waere
// das Item 'done' und nie wiederholbar (AGENTS.md §10: "ein Schreiber, dessen Wert zaehlt, muss
// ihn ZURUECKLESEN").
$idWikiWeg = '00000000-0000-4000-8000-000000009999';
$pdo3->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idWikiWeg, '', 'path', 'Flussweg',
        json_encode(['type' => 'LineString', 'coordinates' => [[20.0, 20.0], [21.0, 21.0]]]),
        json_encode(['wiki_path' => ['name' => 'Der Kanonische Name']]), 'LineString']);

$runId8 = avesmapsSyncPlanStartRun($pdo3, AVESMAPS_GARETIEN_PLAN_KIND, 1, 'test-wiki-ueberschreibt');
avesmapsSyncPlanAddItem($pdo3, $runId8, [
    'entity_key' => 'ggp:Gewaesser:Bach:Garetien:AndererBach|ergaenzung|' . $idWikiWeg,
    'entity_public_id' => $idWikiWeg,
    'change_type' => 'changed',
    'label' => 'Anderer Bach → ohne Namen',
    'before' => ['public_id' => $idWikiWeg, 'name' => ''],
    'after' => ['herkunft' => 'garetien', 'anlass' => 'ergaenzung', 'felder' => ['name'],
        'ziel' => 'path', 'subtyp' => 'Flussweg', 'name' => 'Anderer Bach'],
    'override' => [], 'selected' => 1,
]);

$schritt8 = avesmapsGaretienApplyStep($pdo3, $runId8, 1, ['id' => 1, 'username' => 'test']);
assert($schritt8['applied'] === 0,
    'ein wiki-zugewiesener Weg darf den Garetien-Namen nicht still gewinnen lassen: ' . json_encode($schritt8));
assert($schritt8['skipped'] === 1, 'und der Fehlschlag muss gezaehlt werden: ' . json_encode($schritt8));
$vermerk8 = $pdo3->query("SELECT apply_state, apply_note FROM sync_plan_item WHERE run_id = {$runId8}")->fetch(PDO::FETCH_ASSOC);
assert($vermerk8['apply_state'] === 'failed', 'das Item landet als failed, nicht als done: ' . var_export($vermerk8['apply_state'], true));
assert(str_contains((string) $vermerk8['apply_note'], 'Kanonische'), 'der Vermerk nennt den Wiki-Namen: ' . $vermerk8['apply_note']);
$nameBleibt = $pdo3->query('SELECT name FROM map_features WHERE public_id = ' . $pdo3->quote($idWikiWeg))->fetchColumn();
assert($nameBleibt === 'Der Kanonische Name', 'der Name des Weges bleibt der zugewiesene: ' . var_export($nameBleibt, true));
$pruefungen += 5;

// =================================================================================================
// 🔴 REVIEW I2 (plan-mandated): 'geometrie' AUF WEGEN WIRKLICH GEPRUEFT. Das ist der Pfad, der
// bestehende Kartengeometrie UEBERSCHREIBT -- "die schlimmste Handlung, die dieses Werkzeug
// anbieten kann" (Kommentar am Erzeuger, garetien-plan.php). "applied === 1" allein beweist nicht,
// dass die Koordinaten wirklich geschrieben wurden -- gelesen wird deshalb aus der Datenbank.
//
// 🪤 GEFUNDEN BEIM SCHREIBEN DIESES TESTS, NICHT TEIL DIESES AUFTRAGS UND HIER NICHT REPARIERT:
// `avesmapsUpdatePathFeatureGeometry` (wie `avesmapsCreatePathFeature`) liest sein `coordinates`-
// Feld ueber die HAUSWEITE `avesmapsReadLineStringCoordinates` (api/_internal/map/features.php) --
// und die vertauscht JEDES Punktpaar (`[a,b]` -> `[b,a]`), empirisch geprueft:
// `avesmapsReadLineStringCoordinates([[10,20]]) === [[20,10]]`. `avesmapsGaretienZeilePunkte()`
// liefert seine Punkte aber in AVESMAPS' EIGENER [x,y]-Ordnung (die Kommentare an
// AVESMAPS_GARETIEN_MATRIX_* in garetien-koordinaten.php nennen es ausdruecklich X/Y). Jede per
// Garetien-Import geschriebene Geometrie -- frisch angelegt (Aufgabe 1/3) oder per
// Geometrie-Ergaenzung (Aufgabe 4) -- landet damit VERMUTLICH mit vertauschten x/y in der
// Datenbank. Das ist ein moeglicher, ERNSTER, VORBESTEHENDER Fehler ausserhalb der vier Dateien
// dieser Runde (die Funktion ist hausweit, auch der menschliche Kartenzeichner benutzt sie) und
// wird hier NICHT repariert -- er wird als eigener Befund gemeldet (siehe Bericht). Diese
// Zusicherung prueft deshalb bewusst gegen das ECHTE Verhalten der Hausfunktion (sie selbst
// aufgerufen), nicht gegen eine wuenschenswerte, aber moeglicherweise falsche Erwartung -- sonst
// waere der Test selbst die naechste Fiktion.
$neueKoordinaten = [[100.0, 200.0], [150.0, 250.0], [175.0, 260.0]];
$runId6 = avesmapsSyncPlanStartRun($pdo3, AVESMAPS_GARETIEN_PLAN_KIND, 1, 'test-geometrie');
avesmapsSyncPlanAddItem($pdo3, $runId6, [
    'entity_key' => 'ggp:Gewaesser:Bach:Garetien:Alke|geometrie|' . $idFluss,
    'entity_public_id' => $idFluss,
    'change_type' => 'changed',
    'label' => 'Alke → Alke · Geometrie',
    'before' => ['public_id' => $idFluss, 'name' => 'Alke'],
    'after' => ['herkunft' => 'garetien', 'anlass' => 'geometrie', 'felder' => ['geometrie'],
        'ziel' => 'path', 'subtyp' => 'Flussweg',
        'geometry' => ['type' => 'LineString', 'coordinates' => $neueKoordinaten],
        'abschnitt' => ['public_id' => $idFluss, 'name' => 'Alke', 'punkte' => 12, 'geometrie' => []],
        'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:Alke',
            'label' => 'Briefspiel (Garetien)', 'source_type' => 'briefspiel',
            'origin' => 'garetien', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de']],
    'override' => [], 'selected' => 1,
]);

$geoVorher = $pdo3->query('SELECT geometry_json FROM map_features WHERE public_id = ' . $pdo3->quote($idFluss))
    ->fetch(PDO::FETCH_ASSOC);

$schritt6 = avesmapsGaretienApplyStep($pdo3, $runId6, 1, ['id' => 1, 'username' => 'test']);
assert($schritt6['applied'] === 1, 'die Geometrie-Aenderung wurde nicht uebernommen: ' . json_encode($schritt6));
$pruefungen++;

$geoNachher = $pdo3->query('SELECT geometry_json FROM map_features WHERE public_id = ' . $pdo3->quote($idFluss))
    ->fetch(PDO::FETCH_ASSOC);
$koordinaten = json_decode((string) $geoNachher['geometry_json'], true)['coordinates'];
// Das ECHTE Ergebnis der Hausfunktion, nicht die roh eingegebenen Punkte -- siehe der Fund oben.
// ⚠️ `==`, nicht `===`: glatte Werte (200.0) verlassen die Datenbank ueber JSON als Ganzzahl
// (200), `avesmapsReadLineStringCoordinates` liefert dieselbe Zahl aber als float -- verschiedene
// PHP-Typen, derselbe Wert.
$erwartet = avesmapsReadLineStringCoordinates($neueKoordinaten);
assert($koordinaten == $erwartet,
    'die Geometrie in der Datenbank entspricht nicht der neuen: ' . json_encode($koordinaten) . ' erwartet ' . json_encode($erwartet));
assert($geoNachher['geometry_json'] !== $geoVorher['geometry_json'], 'die alte Geometrie der Alke-Fixture ist noch da');
$pruefungen += 2;

// 🪤 M9 (mitgenommen, weil dieser Test ohnehin am done-Riegel vorbeikommt -- kostet nichts): der
// zweite Aufruf darf das Item nicht noch einmal schreiben, und der Riegel dafuer ist der
// `apply_state`-Vermerk AM ITEM SELBST, nicht nur die aggregierte Rueckgabe.
$itemId6 = (int) $pdo3->query("SELECT id FROM sync_plan_item WHERE run_id = {$runId6}")->fetchColumn();
$vermerk6 = $pdo3->query("SELECT apply_state FROM sync_plan_item WHERE id = {$itemId6}")->fetchColumn();
assert($vermerk6 === 'done', 'das Item traegt seinen done-Vermerk: ' . var_export($vermerk6, true));
$zweiter6 = avesmapsGaretienApplyStep($pdo3, $runId6, 1, ['id' => 1, 'username' => 'test']);
assert($zweiter6['applied'] === 0, 'ein bereits geschriebenes Geometrie-Item darf nicht noch einmal laufen');
$geoNochmal = $pdo3->query('SELECT geometry_json FROM map_features WHERE public_id = ' . $pdo3->quote($idFluss))
    ->fetch(PDO::FETCH_ASSOC);
assert($geoNochmal['geometry_json'] === $geoNachher['geometry_json'], 'und die Geometrie bleibt unveraendert');
$pruefungen += 3;

// =================================================================================================
// 🔴 RULING R6 (Owner, nach R5): "geometrie ersetzen muss es fuer alle geometrien geben -- alle
// formen von flaechen UND wege/fluesse." Der Region-Zweig der Geometrie-Weiche WIRD ALSO
// AUSGEFUEHRT -- die zwei echten Fehler (falscher id-Raum, fehlende erwartete Revision) sind im
// Anwender repariert, nicht der Zweig entfernt. Belegt wird das an der Datenbank, nicht nur an
// `applied === 1` (Review I2, jetzt fuer BEIDE Ziele).
//
// 💣 `entity_public_id` einer Region ist die REGIONS-public_id, `ecosystem_area` traegt eine
// EIGENE public_id -- die Flaeche wird deshalb ueber `region_id` nachgeschlagen, nicht geraten.
$idSeeRegion = '00000000-0000-4000-8000-000000007001';
$idSeeFlaeche = '00000000-0000-4000-8000-000000007002';
$pdo3->exec("INSERT INTO ecosystem_region (public_id, name, kind, region_type, is_active)
             VALUES ('{$idSeeRegion}', 'Mühlsee', 'topographie', 'see', 1)");
$seeRegionRowId = (int) $pdo3->lastInsertId();
$pdo3->prepare('INSERT INTO ecosystem_area (public_id, region_id, geometry_geojson, min_x, min_y, max_x, max_y, geometry_revision, is_trial, is_active)
                VALUES (?,?,?,?,?,?,?,1,0,1)')
    ->execute([$idSeeFlaeche, $seeRegionRowId,
        json_encode(['type' => 'Polygon', 'coordinates' => [[[1.0, 1.0], [2.0, 1.0], [2.0, 2.0], [1.0, 2.0], [1.0, 1.0]]]]),
        1.0, 1.0, 2.0, 2.0]);

$neueFlaeche = ['type' => 'Polygon', 'coordinates' => [[[10.0, 10.0], [20.0, 10.0], [20.0, 20.0], [10.0, 20.0], [10.0, 10.0]]]];
$runId7 = avesmapsSyncPlanStartRun($pdo3, AVESMAPS_GARETIEN_PLAN_KIND, 1, 'test-region-geometrie');
avesmapsSyncPlanAddItem($pdo3, $runId7, [
    'entity_key' => 'ggp:Gewaesser:See:Garetien:Muehlsee|geometrie|' . $idSeeRegion,
    'entity_public_id' => $idSeeRegion,
    'change_type' => 'changed',
    'label' => 'Mühlsee → Mühlsee · Geometrie',
    'before' => ['public_id' => $idSeeRegion, 'name' => 'Mühlsee'],
    'after' => ['herkunft' => 'garetien', 'anlass' => 'geometrie', 'felder' => ['geometrie'],
        'ziel' => 'region', 'subtyp' => 'see', 'kind' => 'topographie', 'geometry' => $neueFlaeche,
        'abschnitt' => ['public_id' => $idSeeRegion, 'name' => 'Mühlsee', 'punkte' => 4, 'geometrie' => []],
        'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:Muehlsee',
            'label' => 'Briefspiel (Garetien)', 'source_type' => 'briefspiel',
            'origin' => 'garetien', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de']],
    'override' => [], 'selected' => 1,
]);

$schritt7 = avesmapsGaretienApplyStep($pdo3, $runId7, 1, ['id' => 1, 'username' => 'test']);
assert($schritt7['applied'] === 1, 'die Flaechen-Geometrie wurde nicht uebernommen: ' . json_encode($schritt7));
$pruefungen++;

// -- Belegt an der Datenbank: die FLAECHE (nicht die Region) traegt die neue Geometrie.
$flaecheNachher = $pdo3->query('SELECT geometry_geojson, geometry_revision FROM ecosystem_area WHERE public_id = '
    . $pdo3->quote($idSeeFlaeche))->fetch(PDO::FETCH_ASSOC);
$ringNachher = json_decode((string) $flaecheNachher['geometry_geojson'], true)['coordinates'][0];
// avesmapsEcosystemNormalizeGeometry schliesst den Ring selbst wieder -- vier Ecken plus Schlusspunkt.
assert(count($ringNachher) === 5, 'der Ring hat nicht vier Ecken plus Schlusspunkt: ' . json_encode($ringNachher));
foreach ([[10.0, 10.0], [20.0, 10.0], [20.0, 20.0], [10.0, 20.0]] as $i => $erwarteterPunkt) {
    assert($ringNachher[$i] == $erwarteterPunkt, "Punkt {$i} der Flaeche stimmt nicht: " . json_encode($ringNachher[$i]));
}
assert((int) $flaecheNachher['geometry_revision'] === 2, 'die Revision der Flaeche zaehlt hoch: ' . $flaecheNachher['geometry_revision']);
// 1 (Ringlaenge) + 4 (die vier Ecken, je eine Zusicherung im foreach) + 1 (Revision) = 6.
$pruefungen += 6;

// -- 🔴 Review I1 (mitgenommen): eine zweite Flaeche an derselben Region macht "ersetze die
// Geometrie" so unwohldefiniert wie bei einem Weg mit mehreren getroffenen Abschnitten -- geraten
// wird nicht, laut abgelehnt mit einem lesbaren Grund.
$pdo3->prepare('INSERT INTO ecosystem_area (public_id, region_id, geometry_geojson, min_x, min_y, max_x, max_y, geometry_revision, is_trial, is_active)
                VALUES (?,?,?,?,?,?,?,1,0,1)')
    ->execute(['00000000-0000-4000-8000-000000007003', $seeRegionRowId,
        json_encode(['type' => 'Polygon', 'coordinates' => [[[5.0, 5.0], [6.0, 5.0], [6.0, 6.0], [5.0, 5.0]]]]),
        5.0, 5.0, 6.0, 6.0]);
$fehlerMehrfach = null;
try {
    avesmapsGaretienErgaenzungAnwenden($pdo3, [
        'ziel' => 'region', 'felder' => ['geometrie'], 'geometry' => $neueFlaeche,
    ], $idSeeRegion, ['id' => 1]);
} catch (Throwable $fehler) {
    $fehlerMehrfach = $fehler;
}
assert($fehlerMehrfach !== null, 'zwei Flaechen an einer Region muessen laut abgelehnt werden, nicht geraten');
assert(str_contains($fehlerMehrfach->getMessage(), 'Flaechen'), 'der Grund nennt die Zahl: ' . $fehlerMehrfach->getMessage());
$pruefungen += 2;

echo "OK: {$pruefungen} Pruefungen\n";
