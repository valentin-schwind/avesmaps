<?php

declare(strict_types=1);

// 🔴 DIESER PRUEFSTAND FAEHRT DIE ERSETZUNGS-MASCHINERIE ANGESCHALTET -- live ist sie AUS.
// Owner 31.08.2026: „es gibt kein ersetzen. es gibt neu oder nix." Die Zusicherungen hier bleiben
// stehen, weil sie teuer erkauftes Wissen ueber diese Maschinerie tragen (welcher Abschnitt was
// annehmen darf, was vorangehakt kommt, welche id wohin zeigt) -- eine spaetere, korrigierte
// Fassung braucht es unveraendert.
// ⚠️ SIE SAGEN NICHTS UEBER DIE PRODUKTION. Dass die Vorgabe `false` ist und die ganze Kette sie
// befolgt, steht in api/_internal/import/__tests__/garetien-kein-ersetzen-test.php.
define('AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT', true);

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
// Fuer den STAND-Zeugen der Ruecknahme (avesmapsGaretienArbeitsliste, 31.08.2026): die Frage des
// Owners war nicht "ist eine Spalte leer", sondern "in welchem Reiter steht die Zeile".
require_once __DIR__ . '/../garetien-liste.php';

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
    // ⚠️ MIT den nachgeruesteten Urteilsspalten (Aufgabe 6, 27.08.2026) -- der Kopierschritt
    // weiter unten liest per `SELECT *` aus dem Planbauer-Pruefstand, der sie schon traegt, und
    // die eigene exec()-Naht schluckt ALTER TABLE (siehe Kommentar oben): das Schema muss sie
    // deshalb wie die uebrigen nachgeruesteten Spalten von Hand tragen.
    $pdo->exec('CREATE TABLE garetien_import_row (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, wiki TEXT, ebene TEXT, zeile_nr INT, typ TEXT, namensraum TEXT, artikel TEXT, anzeige TEXT, lodmin TEXT, lodmax TEXT, extra TEXT, geo_art TEXT, geo TEXT, roh TEXT, urteil TEXT DEFAULT \'\', grund TEXT DEFAULT \'\', abschnitte_json TEXT NULL)');
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
    // ⚠️ `created_at` MUSS mit -- avesmapsListFeatureSourcesForEdit (aufgerufen am Ende von
    // avesmapsRemoveFeatureSource) sortiert nach `s.created_at`, und ohne die Spalte wirft SQLite
    // "no such column". Dieselbe Loesung wie in feature-source-live-entity-test.php.
    $pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, url_hash TEXT UNIQUE,
        wiki_key TEXT NULL, label TEXT, source_type TEXT, is_official INTEGER DEFAULT 0, created_by INTEGER NULL,
        license TEXT NOT NULL DEFAULT \'\', attribution TEXT NOT NULL DEFAULT \'\', created_at TEXT DEFAULT "2026-01-01")');
    $pdo->exec("CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
        entity_public_id TEXT NOT NULL, source_id INTEGER NOT NULL, status TEXT DEFAULT 'approved',
        created_by INTEGER NULL, origin TEXT DEFAULT 'manual', reference_kind TEXT NULL, pages TEXT NULL,
        note TEXT NULL, UNIQUE(entity_type, entity_public_id, source_id))");
    // 🔴 AUFGABE 29 (Owner-Entscheid 30.08.2026): "Landschaft" (Flaeche/Berggipfel) weist beim
    // Anlegen den Wiki-Schluessel zu -- avesmapsGaretienWikiLandschaftZuweisung liest dieselbe
    // Tabelle wie die Einzelansicht (garetien-wiki-landschaft.php). LEER PER VORGABE: die vielen
    // bestehenden Tests dieser Datei duerfen davon unberuehrt bleiben.
    $pdo->exec('CREATE TABLE wiki_region_staging (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT,
        name TEXT, match_key TEXT, art TEXT)');

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

/**
 * Eine Zeile der Wiki-Landschaft-Staging-Tabelle anlegen -- match_key wie die echte Suche
 * (avesmapsWikiSyncCreateMatchKey, verfuegbar ueber garetien-uebernahme.php ->
 * garetien-wiki-landschaft.php -> wiki/sync.php).
 */
function avesmapsGaretienUebernahmeWikiRegionZeile(PDO $pdo, string $name, string $art, string $wikiKey): void
{
    $pdo->prepare('INSERT INTO wiki_region_staging (wiki_key, name, match_key, art) VALUES (?, ?, ?, ?)')
        ->execute([$wikiKey, $name, avesmapsWikiSyncCreateMatchKey($name), $art]);
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
// 🔴 SEIT 01.09.2026 IST ES GENAU EINE, UND ZWAR DER ARTIKEL. Vom 31.08. bis dahin waren es
// zwei -- die Sammelquelle „Briefspiel (Garetien)" auf den Wirt UND der eigene Wiki-Artikel.
// Der Owner hat das an „Stadt Praioslob" gesehen und benannt: „jetzt hast du genau gemacht was ich
// befuerchtet hatte und 2x die quelle hinzufuegt" -> „nur noch den artikel als quelle".
// Gleiche Domain, gleiche Namensnennung, gleiche Lizenz; der Artikel sagt dasselbe genauer.
// ⚠️ Der Gardel nennt einen Artikel (`Garetien:Gardel` im Schluessel) -- eine Zeile OHNE
// Artikel bekommt weiter die Sammelquelle, das ist weiter unten belegt.
assert($e['quellen'] === 1, 'NUR die Artikelquelle: ' . $e['quellen']);
// 💣 UND DER ANLEGEWEG MELDET SIE EBENSO ZURUECK. Es sind ZWEI Erzeuger von Quellen in dieser
// Datei (Anlegen und Ergaenzung) -- eine Regel, die einen von zweien bindet, ist keine Regel
// (AGENTS.md). Die Ergaenzung ist weiter unten belegt, an dem Weg mit der fremden Quelle.
assert(count($e['quellen_neu']) === 1 && $e['quellen_neu'][0]['entity_type'] === 'path',
    'auch das frisch ANGELEGTE Objekt meldet seine Quellen zurueck: ' . json_encode($e['quellen_neu']));
assert(count($e['quellen_neu'][0]['sources']) === 1,
    'und zwar die eine: ' . json_encode($e['quellen_neu'][0]['sources']));
$pruefungen += 2;

// --- 🔴 DIE ARTIKELQUELLE: Adresse, Beschriftung, Lizenz.
// Owner-Wortlaut fuer die Beschriftung: „Stadt Praioslob auf garetien.de" -- also der Artikelname
// OHNE Namensraum, gefolgt vom Wirt. ⚠️ Die ADRESSE traegt den Namensraum weiter vollstaendig.
$artikelZeile = $pdo->query(
    "SELECT s.url, s.label, s.source_type, s.license, s.attribution, fs.origin, fs.note
       FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
      WHERE s.url LIKE '%index.php%'"
)->fetch(PDO::FETCH_ASSOC);
assert($artikelZeile !== false, 'die Artikelquelle haengt am Objekt');
assert($artikelZeile['url'] === 'https://www.garetien.de/index.php/Garetien:Gardel',
    'die gemessene Artikelform (31.08.2026: /index.php/<Namensraum:Artikel> antwortet mit 200, '
    . 'die frueher gebaute …/Avesmaps_<Artikel>-Form mit 404): ' . var_export($artikelZeile['url'], true));
assert($artikelZeile['label'] === 'Gardel auf garetien.de',
    'Beschriftung nach Owner-Wortlaut, Artikelname ohne Namensraum: ' . var_export($artikelZeile['label'], true));
assert($artikelZeile['license'] === 'cc-by-nc-sa-3.0' && $artikelZeile['attribution'] === 'VolkoV / garetien.de',
    'dieselbe Lizenz und Namensnennung wie die Sammelquelle -- derselbe Wirt, derselbe Autor');
assert($artikelZeile['origin'] === 'garetien',
    'eigene Herkunft, damit die Ruecknahme sie mitnimmt und ein spaeterer Lauf sie wiedererkennt');
$pruefungen += 5;

// \U0001f534 UND DIE SAMMELQUELLE HAENGT AN DIESEM OBJEKT GAR NICHT MEHR (01.09.2026). Das ist
// die eigentliche Zusicherung der Owner-Entscheidung: nicht „der Artikel ist auch da", sondern
// „die zweite Zeile ist WEG". Ohne sie waere „nur noch den artikel" schon erfuellt, sobald der
// Artikel irgendwo auftaucht -- also auch NEBEN der Sammelquelle, dem beanstandeten Zustand.
$wirtZahl = (int) $pdo->query("SELECT COUNT(*) FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
                     WHERE s.url = 'https://www.garetien.de'")->fetchColumn();
assert($wirtZahl === 0,
    '\U0001f534 an einem Objekt MIT Artikel haengt die Sammelquelle nicht mehr: ' . $wirtZahl);
$pruefungen++;

// Die Verknuepfung, an der die Arbeitsseite haengt, ist seither die ARTIKELquelle.
$q = $pdo->query("SELECT fs.* FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
                   WHERE s.url LIKE '%index.php%'")->fetch(PDO::FETCH_ASSOC);
assert($q['origin'] === 'garetien', 'eigene Herkunft, damit ein spaeterer Lauf sie wiedererkennt');
assert($q['entity_type'] === 'path' && $q['entity_public_id'] === $neu['public_id'], 'sie haengt am richtigen Objekt');
// --- 🔴 OWNER-ENTSCHEID (30.08.2026, "leg sie in feature_sources.note ab"): seit sources.url der
// WIRT ist (garetien.de/koschwiki.de), traegt die VERKNUEPFUNG die Export-Arbeitsseite -- die
// einzige Stelle, an der ein Editor nach der Uebernahme noch nachsehen kann, VON WELCHER Seite ein
// Objekt stammt. `sources.url` selbst bleibt der Wirt, siehe die Zusicherung an $s['url'] unten.
// 🔴 KORREKTUR 31.08.2026: DIE ARBEITSSEITE HEISST NACH DER EBENE, NICHT NACH DEM ARTIKEL.
// `…/Avesmaps_Garetien:Gardel` gibt es nicht -- live gemessen HTTP 404, waehrend
// `…/Avesmaps_Gewaesser` mit 200 antwortet. Die Notiz zeigte also an jedem Objekt mit Artikel
// ins Leere, und derselbe kaputte Link stand als „Artikel" im Importer-Fenster.
assert(
    $q['note'] === AVESMAPS_GARETIEN_BASIS_GGP . 'Gewaesser',
    'die Notiz traegt die Export-Arbeitsseite dieser EBENE: ' . var_export($q['note'], true)
);
// ⚠️ Hier stand bis zum 01.09.2026 „und BEIDE Verknuepfungen tragen sie". Seit es nur noch
// EINE gibt, waere dieser Vergleich eine Tautologie ($artikelZeile und $q sind dieselbe Zeile).
// Was noch etwas sagt: die Notiz zeigt auf die EBENE, nie auf den Artikel -- die 404-Falle
// vom 31.08.2026.
assert(!str_contains((string) $q['note'], 'Gardel'),
    'die Arbeitsseite heisst nach der EBENE, nie nach dem Artikel: ' . var_export($q['note'], true));
$pruefungen += 2;
$s = $pdo->query("SELECT * FROM sources WHERE url LIKE '%index.php%'")->fetch(PDO::FETCH_ASSOC);
// 🔴 UND sources.url ist die ARTIKELadresse -- die Export-Arbeitsseite landet NICHT dort
// zurueck, sie steht ausschliesslich in feature_sources.note (siehe oben). Bis zum 01.09.2026 stand
// hier der Wirt; die Aussage ist dieselbe geblieben, nur die Adresse ist genauer geworden.
assert(
    $s['url'] === 'https://www.garetien.de/index.php/Garetien:Gardel',
    'sources.url ist die Artikeladresse, nicht die Arbeitsseite: ' . var_export($s['url'], true)
);
$pruefungen++;
assert(str_contains((string) $s['url'], 'garetien.de'), 'die Quelle zeigt auf den Wiki-Artikel');
// 🔴 BRIEFSPIEL, kein eigener Typ -- garetien.de IST eines, und das Haus fuehrt die Form seit
// langem. Die Lizenzangabe haengt deshalb am WIRT der Adresse, nicht am Typ: beide Wikis tragen
// denselben Typ, und verschieden ist nur der Name, der genannt werden muss.
assert($s['source_type'] === 'briefspiel', 'die Kategorie der Quelle: ' . $s['source_type']);
// 01.09.2026: die eine Quelle ist der ARTIKEL, ihre Beschriftung folgt dem Owner-Wortlaut
// („Stadt Praioslob auf garetien.de"). Die Sammelquelle „Briefspiel (Garetien)" traegt seither
// nur noch, wer keinen Artikel hat -- belegt weiter unten an einer artikellosen Zeile.
assert($s['label'] === 'Gardel auf garetien.de', 'und die Beschriftung nennt sie: ' . $s['label']);

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
//
// 🔴 AUFGABE 29 (Owner-Entscheid 30.08.2026): "Mühlsee" traegt hier eine Wiki-Landschaft mit
// PASSENDER Art (See) -- die Flaeche muss beim Anlegen den Schluessel zugewiesen bekommen, ohne
// dass Name oder Art des Imports sich aendern.
avesmapsGaretienUebernahmeWikiRegionZeile($pdo, 'Mühlsee', 'See', 'wiki:muehlsee');
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

// --- 🔴 KORREKTUR A (Owner-Nachtrag 30.08.2026): OHNE eine gespeicherte Uebersteuerung fuer die
// Art 'see' bleibt es beim heutigen GRUNDWERT -- ausdruecklich, nicht zufaellig. Diese Zeile ist
// die Gegenprobe zur Berggipfel-Zeile weiter unten (mit Uebersteuerung): zwei verschiedene Arten
// muessen zwei verschiedene Werte tragen, sonst prueft keine der beiden Zeilen etwas.
$muehlseeLabelProps = json_decode((string) $label['properties_json'], true);
assert(($muehlseeLabelProps['min_zoom'] ?? null) === 0, 'min_zoom bleibt der Grundwert 0: ' . json_encode($muehlseeLabelProps));
assert(($muehlseeLabelProps['max_zoom'] ?? null) === 5, 'max_zoom bleibt der Grundwert 5: ' . json_encode($muehlseeLabelProps));
assert(($muehlseeLabelProps['size'] ?? null) === 18, 'size bleibt der Grundwert 18: ' . json_encode($muehlseeLabelProps));
assert(($muehlseeLabelProps['priority'] ?? null) === 3, 'priority bleibt der Grundwert 3: ' . json_encode($muehlseeLabelProps));
$pruefungen += 4;

// --- 🔴 AUFGABE 30 (Owner 30.08.2026, "warum darf ich das nicht verändern?"): OHNE Handeingabe
// (der fuenfte Parameter von avesmapsGaretienUebernehmen bleibt hier weg) bleiben auch "für Klicks
// gesperrt" und "Kurvenbeschreibung" beim Grundwert "aus" -- die Gegenprobe zur Handeingabe weiter
// unten (Testteich).
assert((int) $region['is_locked'] === 0, 'is_locked bleibt ohne Handeingabe beim Grundwert 0 (aus): ' . json_encode($region));
assert(!str_contains((string) $region['properties_json'], 'curve_label'),
    'curve_label bleibt ohne Handeingabe ganz WEG: ' . var_export($region['properties_json'], true));
$pruefungen += 2;

// --- 🔴 AUFGABE 29 (Owner-Entscheid 30.08.2026): DIE ZUWEISUNG STEHT AN properties.wiki_region.wiki_key,
// UND NAME/ART BLEIBEN DIE DES IMPORTS. "Zugewiesen wird nur der Schluessel" (Owner) -- Name und
// Subtyp der Flaeche/des Labels sind unveraendert die des Garetien-Imports, nicht die des Wikis.
assert(($muehlseeLabelProps['wiki_region']['wiki_key'] ?? '') === 'wiki:muehlsee',
    'die Flaeche traegt den gefundenen Wiki-Schluessel: ' . json_encode($muehlseeLabelProps));
assert($label['name'] === 'Mühlsee', 'der NAME bleibt der des Imports, nicht der des Wikis: ' . $label['name']);
assert($region['region_type'] === 'see', 'und die ART bleibt ebenfalls die des Imports: ' . $region['region_type']);
$pruefungen += 3;

// --- 🔴 AUFGABE 13 (Rechtsfolgenfehler): die Quelle der Flaeche haengt an der BESCHRIFTUNG,
// NICHT an der Region -- dieselbe Bindung, mit der map-features.php:1228 Quellen fuer die Karte
// nachschlaegt (entity_type 'region' ist an feature_type 'label' gebunden, gekeyt an dessen
// public_id). Region und Label sind in dieser Fixture zwei verschiedene Zeilen mit verschiedenen
// public_ids -- ohne diese Zusicherung wuerde die naechste Zeile nichts pruefen, wenn beide ids
// je zufaellig gleich waeren.
assert($region['public_id'] !== $label['public_id'], 'Region und Label muessen verschiedene ids tragen, sonst prueft dies nichts');
$qr = $pdo->query("SELECT * FROM feature_sources WHERE entity_type = 'region'")->fetch(PDO::FETCH_ASSOC);
assert($qr !== false && $qr['entity_public_id'] === $label['public_id'],
    'die Quelle muss an der Beschriftung haengen -- gefunden: ' . var_export($qr['entity_public_id'] ?? null, true));
assert($qr['entity_public_id'] !== $region['public_id'],
    'und NICHT im ID-Raum der Region -- genau das war der Fehler (AGENTS.md §11: "die Quellen einer Landschaft liegen an ihrer BESCHRIFTUNG")');
$pruefungen += 3;

// --- 🔴 DIE NOTIZ GEHOERT DER EBENE, NICHT DEM OBJEKT (Korrektur 31.08.2026). Gardel und
// Muehlsee liegen beide in `Gewaesser`, tragen also DIESELBE Arbeitsseite -- und das ist richtig:
// es ist die Seite, von der beide Zeilen stammen. Bis dahin stand hier die Gegenprobe „zwei
// Objekte, zwei Notizen", weil die Notiz aus dem ARTIKEL gebaut wurde; genau diese Bildung ergab
// die 404-Adresse.
assert(
    $qr['note'] === AVESMAPS_GARETIEN_BASIS_GGP . 'Gewaesser',
    'die Notiz des Sees nennt die Export-Seite seiner EBENE: ' . var_export($qr['note'], true)
);
assert($qr['note'] === $q['note'], 'dieselbe Ebene, dieselbe Arbeitsseite');
// 💣 UND DIE GEGENPROBE MUSS MITWANDERN, sonst prueft die Zeile darueber eine Konstante: eine
// ANDERE Ebene ergibt eine andere Adresse. Rein gemessen, ohne zweiten Durchlauf.
assert(avesmapsGaretienSeitenUrlAusZeile(['wiki' => 'ggp', 'ebene' => 'Berge'])
    !== avesmapsGaretienSeitenUrlAusZeile(['wiki' => 'ggp', 'ebene' => 'Gewaesser']),
    'eine andere Ebene ergibt eine andere Arbeitsseite -- sonst stuende hier eine Konstante');
// ⚠️ 'Muehlsee' (ASCII), NICHT 'Mühlsee' -- die Fixture traegt den Artikelnamen (den Wiki-Slug)
// und die Anzeige (den Namen mit Umlaut) getrennt (avesmapsGaretienPlanTestPdo: Spalte 'artikel'
// vs. 'anzeige'). Das PRO-OBJEKT-Merkmal ist seit dem 31.08.2026 die ARTIKELQUELLE, und die
// unterscheidet die beiden.
$qrArtikel = $pdo->query(
    "SELECT s.url, s.label FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
      WHERE fs.entity_type = 'region' AND s.url LIKE '%index.php%'"
)->fetch(PDO::FETCH_ASSOC);
assert($qrArtikel !== false && $qrArtikel['url'] === 'https://www.garetien.de/index.php/Garetien:Muehlsee',
    'der See traegt SEINEN eigenen Artikel: ' . var_export($qrArtikel['url'] ?? null, true));
assert($qrArtikel['label'] === 'Muehlsee auf garetien.de',
    'und die Beschriftung nennt ihn: ' . var_export($qrArtikel['label'] ?? null, true));
assert($qrArtikel['url'] !== $artikelZeile['url'],
    'zwei verschiedene Objekte tragen zwei verschiedene Artikelquellen');
$pruefungen += 6;

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

// =================================================================================================
// 🔴 AUFGABE 4b: DIE VERTAUSCHTEN KOORDINATEN DER IMPORTIERTEN WEGE (Critical, gefunden beim Bau
// von Aufgabe 4, vom Auftraggeber nachgeprueft und bestaetigt).
//
// `avesmapsReadLineStringCoordinates` (api/_internal/map/features.php) liest Element 0 eines
// Punktpaars als `lat` und gibt `[$lng, $lat]` zurueck -- sie TAUSCHT jedes Paar. Ihr
// Eingangsvertrag ist damit LEAFLET-Reihenfolge `[lat, lng]`, und fuer ihren Hauptaufrufer (den
// Kartenzeichner im Editor) ist das richtig. Der Importer liefert aber GEOJSON `[x, y]`
// (avesmapsGaretienNachAvesmaps, garetien-koordinaten.php) -- jeder per Garetien-Import
// geschriebene WEG landete deshalb an der Diagonale GESPIEGELT, sowohl beim Anlegen
// (avesmapsCreatePathFeature) als auch beim Geometrie-Ersetzen (avesmapsUpdatePathFeatureGeometry).
//
// 🪤 Und das faellt bei einem Punkt NAHE der Diagonale nicht auf -- ein Tausch von (10,10) bleibt
// (10,10). Deshalb steht hier ein Punkt WEIT ausserhalb der Diagonale (100/900), und die
// Erwartung ist ein LITERAL, nie `avesmapsReadLineStringCoordinates(...)` -- das waere
// `f(x) == f(x)` und fuer JEDES `f` wahr, also blind gegenueber der Reihenfolge.
//
// ✅ BEHOBEN durch avesmapsGaretienGeoJsonNachHausvertrag() (garetien-uebernahme.php): sie dreht
// `[x,y]` VOR dem Aufruf der Hausschreiber nach `[lat,lng]`, DAMIT die Hausfunktion beim
// Zurueckdrehen wieder `[x,y]` herausgibt. 🔴 DIE HAUSFUNKTION SELBST WIRD NICHT GEAENDERT -- ihr
// anderer Aufrufer (der Kartenzeichner) steht auf dem heutigen Vertrag.

// --- Der 'new'-Pfad (avesmapsCreatePathFeature).
$geoJson = [[100.0, 900.0], [110.0, 890.0]];
$pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected)
               VALUES (?, 'diagonale-weg-test', NULL, 'new', 'Testbach Diagonale', NULL, ?, NULL, 1)")
    ->execute([$lauf, json_encode([
        'herkunft' => 'garetien', 'ziel' => 'path', 'subtyp' => 'Flussweg', 'kind' => null,
        'name' => 'Testbach Diagonale', 'geometry' => ['type' => 'LineString', 'coordinates' => $geoJson],
        'quelle' => ['url' => 'https://www.garetien.de/testbach', 'label' => 'x', 'source_type' => 'garetien', 'origin' => 'garetien'],
    ], JSON_UNESCAPED_UNICODE)]);
$diagonaleWegId = (int) $pdo->lastInsertId();
$eDiagonaleWeg = avesmapsGaretienUebernehmen($pdo, $lauf, [$diagonaleWegId], ['id' => 7]);
assert($eDiagonaleWeg['angelegt'] === 1, 'der Testbach wurde nicht angelegt: ' . json_encode($eDiagonaleWeg['fehler'], JSON_UNESCAPED_UNICODE));
$wegZeile = $pdo->query("SELECT geometry_json FROM map_features WHERE name = 'Testbach Diagonale'")->fetch(PDO::FETCH_ASSOC);
$gespeichert = json_decode((string) $wegZeile['geometry_json'], true)['coordinates'];
assert($gespeichert[0][0] == 100.0 && $gespeichert[0][1] == 900.0,
    'der angelegte Weg liegt gespiegelt: ' . json_encode($gespeichert[0]) . ' statt [100,900]');
$pruefungen += 2;

// --- Derselbe Punkt ueber den GEOMETRIE-ERSETZEN-Pfad (avesmapsUpdatePathFeatureGeometry) --
// der zweite der zwei Weg-Schreibpfade. Ein eigener, minimaler Bestandsweg dafuer.
$idDiagonaleWeg2 = '00000000-0000-4000-8000-000000004242';
$pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idDiagonaleWeg2, 'Alter Bach', 'path', 'Flussweg',
        json_encode(['type' => 'LineString', 'coordinates' => [[10.0, 20.0], [11.0, 21.0]]]), '{}', 'LineString']);
$pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected)
               VALUES (?, 'diagonale-geometrie-test', ?, 'changed', 'Alter Bach -> Geometrie', NULL, ?, NULL, 1)")
    ->execute([$lauf, $idDiagonaleWeg2, json_encode([
        'herkunft' => 'garetien', 'anlass' => 'geometrie', 'felder' => ['geometrie'],
        'ziel' => 'path', 'subtyp' => 'Flussweg', 'geometry' => ['type' => 'LineString', 'coordinates' => $geoJson],
    ], JSON_UNESCAPED_UNICODE)]);
$diagonaleGeoId = (int) $pdo->lastInsertId();
$eDiagonaleGeo = avesmapsGaretienUebernehmen($pdo, $lauf, [$diagonaleGeoId], ['id' => 7]);
assert($eDiagonaleGeo['angelegt'] === 1, 'die Geometrie wurde nicht uebernommen: ' . json_encode($eDiagonaleGeo['fehler'], JSON_UNESCAPED_UNICODE));
$wegZeile2 = $pdo->query('SELECT geometry_json FROM map_features WHERE public_id = ' . $pdo->quote($idDiagonaleWeg2))->fetch(PDO::FETCH_ASSOC);
$gespeichert2 = json_decode((string) $wegZeile2['geometry_json'], true)['coordinates'];
assert($gespeichert2[0][0] == 100.0 && $gespeichert2[0][1] == 900.0,
    'die ersetzte Geometrie liegt gespiegelt: ' . json_encode($gespeichert2[0]) . ' statt [100,900]');
$pruefungen += 2;

// --- ⚠️ ZWEI WAECHTER: die FLAECHE und das LABEL duerfen den neuen Umsetzer NIE bekommen -- sie
// sind heute korrekt (die Flaeche tauscht gar nicht, das Label bekommt lat/lng GETRENNT). Ohne
// diese Zusicherungen merkt niemand, wenn ein spaeterer Leser avesmapsGaretienGeoJsonNachHausvertrag
// versehentlich auch hier einhaengt. Literale, kein zweiter Aufruf einer Hausfunktion.
// ⚠️ Innerhalb der Kartenbounds 0..1024 (AGENTS.md §1).
$flaechenRing = [[100.0, 700.0], [300.0, 700.0], [300.0, 900.0], [100.0, 900.0]];
$pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected)
               VALUES (?, 'diagonale-flaeche-test', NULL, 'new', 'Testsee Diagonale', NULL, ?, NULL, 1)")
    ->execute([$lauf, json_encode([
        'herkunft' => 'garetien', 'ziel' => 'region', 'kind' => 'topographie', 'subtyp' => 'see',
        'name' => 'Testsee Diagonale', 'geometry' => ['type' => 'Polygon', 'coordinates' => [$flaechenRing]],
        'quelle' => ['url' => 'https://www.garetien.de/testsee', 'label' => 'x', 'source_type' => 'garetien', 'origin' => 'garetien'],
    ], JSON_UNESCAPED_UNICODE)]);
$diagonaleFlaecheId = (int) $pdo->lastInsertId();
$eDiagonaleFlaeche = avesmapsGaretienUebernehmen($pdo, $lauf, [$diagonaleFlaecheId], ['id' => 7]);
assert($eDiagonaleFlaeche['angelegt'] === 1, 'der Testsee wurde nicht angelegt: ' . json_encode($eDiagonaleFlaeche['fehler'], JSON_UNESCAPED_UNICODE));

$regionDiagonale = $pdo->query("SELECT * FROM ecosystem_region WHERE name = 'Testsee Diagonale'")->fetch(PDO::FETCH_ASSOC);
$flaecheDiagonale = $pdo->query('SELECT * FROM ecosystem_area WHERE region_id = ' . (int) $regionDiagonale['id'])->fetch(PDO::FETCH_ASSOC);
$ringDiagonale = json_decode((string) $flaecheDiagonale['geometry_geojson'], true)['coordinates'][0];
foreach ([[100.0, 700.0], [300.0, 700.0], [300.0, 900.0], [100.0, 900.0]] as $i => $erwarteterFlaechenPunkt) {
    assert($ringDiagonale[$i] == $erwarteterFlaechenPunkt,
        "WAECHTER Flaeche: Punkt {$i} liegt gespiegelt: " . json_encode($ringDiagonale[$i]));
}
$pruefungen += 5;

// Von Hand gerechnet -- (100+300+300+100)/4=200, (700+700+900+900)/4=800 -- ein Literal, kein
// zweiter Aufruf von avesmapsGaretienRingMittelpunkt.
$labelDiagonale = $pdo->query('SELECT * FROM map_features WHERE public_id = '
    . $pdo->quote((string) $regionDiagonale['label_public_id']))->fetch(PDO::FETCH_ASSOC);
$labelKoordDiagonale = json_decode((string) $labelDiagonale['geometry_json'], true)['coordinates'];
assert($labelKoordDiagonale[0] == 200.0 && $labelKoordDiagonale[1] == 800.0,
    'WAECHTER Label: liegt gespiegelt: ' . json_encode($labelKoordDiagonale) . ' statt [200,800]');
$pruefungen++;

// --- 🪤 Ein DRITTER Weg-Schreibpfad im Importer waere ungebunden -- und der Fehler kaeme
// zurueck, ohne dass ein Test rot wird. Gezaehlt wird zur LAUFZEIT der Quelltext, nicht das
// Verhalten.
// 🪤 KOMMENTARE VOR DEM ZAEHLEN WEGWERFEN. Eine Regex kann ein `avesmapsCreatePathFeature(` in
// einem Kommentar nicht von einem echten Aufruf unterscheiden -- und in dieser Dateifamilie ist
// es gelebte Konvention, einen Funktionsnamen in Prosa mit leeren Klammern zu schreiben
// (garetien-abruf.php:10/12; diese Testdatei selbst tut es zweimal). Ein Kommentar, der die
// Hausschreiber erwaehnt, machte den Waechter sonst rot, OHNE dass eine Regression vorliegt --
// und der naechste Leser repariert dann den Kommentar statt des Codes. PHPs Tokenizer macht die
// Unterscheidung richtig; eine Regex kann sie prinzipiell nicht machen (Review I1). Dasselbe
// Verfahren benutzt sync-plan-purity-test.php aus genau diesem Grund.
$quelleUebernahme = (string) file_get_contents(__DIR__ . '/../garetien-uebernahme.php');
$nurCodeUebernahme = '';
foreach (token_get_all($quelleUebernahme) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $nurCodeUebernahme .= is_array($token) ? $token[1] : $token;
}
$wegSchreiberAnzahl = preg_match_all('~avesmaps(?:CreatePathFeature|UpdatePathFeatureGeometry)\(~', $nurCodeUebernahme);
$umsetzerAnzahl = preg_match_all('~avesmapsGaretienGeoJsonNachHausvertrag~', $nurCodeUebernahme);
assert($wegSchreiberAnzahl === 2, 'Es gibt jetzt ' . $wegSchreiberAnzahl . ' Weg-Schreibpfade statt zwei.');
// ⚠️ >=, nicht ===: die Definition der Funktion selbst zaehlt mit.
assert($umsetzerAnzahl >= $wegSchreiberAnzahl,
    'Ein Weg-Schreibpfad ruft den Umsetzer nicht -- der importierte Weg landet dort gespiegelt.');
$pruefungen += 2;

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

// 🔴 UND KEINE VERMERKTE ZEILE BEHAELT IHR HAEKCHEN (Aufgabe 16, Fund der Pruefung).
// 💣 Das ist NICHT dasselbe wie die Zeile darueber. Dort steht `AND apply_state IS NULL` --
// die Frage war „traegt jede Zeile einen Vermerk". Hier steht sie NICHT: die Frage ist, ob eine
// vermerkte Zeile ihr `selected = 1` behaelt. Genau die faellt aus der ersten Zaehlung heraus,
// und genau die zaehlt `angehakt` in garetien-liste.php weiter mit -- der Fussknopf des
// Fensters versprraeche sie beim naechsten Durchgang erneut („2 von 2 werden uebernommen",
// danach „1 uebernommen"), und der Editor bekaeme sie NICHT weg:
// avesmapsSyncPlanSetSelection traegt selbst `AND apply_state IS NULL`.
// ⚠️ Der Lauf bleibt bei diesem Import bewusst OFFEN (avesmapsGaretienApplyStep schliesst ihn
// nicht) -- die sieben anderen Objektarten sehen den Fall nie, weil ihr `get` danach
// `run: null` liefert.
$nochAngehakt = (int) $pdo2->query(
    "SELECT COUNT(*) FROM sync_plan_item WHERE run_id = {$lauf2} AND selected = 1"
)->fetchColumn();
assert($nochAngehakt === 0, $nochAngehakt . ' vermerkte Zeilen tragen noch ihr Haekchen -- der Fussknopf verspricht sie erneut');
$pruefungen++;

// Die Gegenprobe: die Zusicherung darueber misst wirklich BEIDE Zweige. Es gab in diesem Lauf
// sowohl geschriebene (`done`) als auch abgelehnte Zeilen (`stale`/`failed`) -- eine Regel, die
// nur `done` abhakt, liesse die anderen als Geisterzeilen stehen.
$staende = $pdo2->query(
    "SELECT apply_state, COUNT(*) AS n FROM sync_plan_item WHERE run_id = {$lauf2} GROUP BY apply_state"
)->fetchAll(PDO::FETCH_KEY_PAIR);
assert((int) ($staende['done'] ?? 0) > 0, 'kein einziges Item wurde geschrieben -- dann prueft das oben nur den Ablehnzweig');
assert((int) ($staende['stale'] ?? 0) + (int) ($staende['failed'] ?? 0) > 0,
    'kein einziges Item wurde abgelehnt -- dann prueft das oben nur den Schreibzweig');
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
    'entity_key' => 'ggp:Gewaesser:Bach:Garetien:Alke!Alke|ergaenzung|' . $idFluss,
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
    'entity_key' => 'ggp:Gewaesser:Bach:Garetien:Widerspruch!Widerspruch|widerspruch|' . $idFluss,
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
    'entity_key' => 'ggp:Gewaesser:Bach:Garetien:AndererBach!AndererBach|ergaenzung|' . $idWikiWeg,
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
// 🔴 FUND-PROTOKOLL (Aufgabe 4b, behoben): hier stand bis zu dieser Aufgabe ein bestaetigter,
// ERNSTER Fehler ausserhalb der vier Dateien der urspruenglichen Aufgabe 4 -- gefunden beim
// Schreiben DIESES Tests. `avesmapsUpdatePathFeatureGeometry` (wie `avesmapsCreatePathFeature`)
// liest sein `coordinates`-Feld ueber die HAUSWEITE `avesmapsReadLineStringCoordinates`
// (api/_internal/map/features.php), und die vertauscht JEDES Punktpaar (`[a,b]` -> `[b,a]`): ihr
// Eingangsvertrag ist LEAFLET-Reihenfolge `[lat,lng]`, weil ihr Hauptaufrufer der Kartenzeichner
// im Editor ist. `avesmapsGaretienZeilePunkte()` liefert seine Punkte aber in GEOJSON-Ordnung
// `[x,y]` -- jede per Garetien-Import geschriebene Geometrie landete deshalb an der Diagonale
// GESPIEGELT, frisch angelegt (Aufgabe 1/3) wie per Geometrie-Ergaenzung (Aufgabe 4).
//
// ✅ BEHOBEN (Aufgabe 4b) durch avesmapsGaretienGeoJsonNachHausvertrag() in
// garetien-uebernahme.php: sie dreht `[x,y]` VOR dem Aufruf der Hausschreiber nach `[lat,lng]`,
// DAMIT die Hausfunktion beim Zurueckdrehen wieder `[x,y]` herausgibt. Die Hausfunktion selbst
// bleibt UNVERAENDERT -- ihr anderer Aufrufer (der Kartenzeichner) steht auf dem heutigen Vertrag.
//
// 💣 Die Erwartung unten ist deshalb ein LITERAL, nicht mehr
// `avesmapsReadLineStringCoordinates($neueKoordinaten)`. Genau dieser Aufruf stand hier nach
// Aufgabe 4 und war `f(x) == f(x)` -- fuer JEDES `f` wahr und damit blind gegenueber der
// Reihenfolge; er haette den Fehler nie zeigen koennen. Ein Literal ist die einzige Erwartung,
// die es kann.
$neueKoordinaten = [[100.0, 200.0], [150.0, 250.0], [175.0, 260.0]];
$runId6 = avesmapsSyncPlanStartRun($pdo3, AVESMAPS_GARETIEN_PLAN_KIND, 1, 'test-geometrie');
avesmapsSyncPlanAddItem($pdo3, $runId6, [
    'entity_key' => 'ggp:Gewaesser:Bach:Garetien:Alke!Alke|geometrie|' . $idFluss,
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
// Die roh eingegebenen Punkte, UNVERAENDERT -- nach dem Fix bleibt GeoJSON-[x,y] erhalten. Ein
// Literal, keine Ruecktransformation durch die Hausfunktion (siehe das Fund-Protokoll oben).
// ⚠️ `==`, nicht `===`: glatte Werte (200.0) verlassen die Datenbank ueber JSON als Ganzzahl
// (200), unser Literal ist aber float -- verschiedene PHP-Typen, derselbe Wert.
$erwartet = [[100.0, 200.0], [150.0, 250.0], [175.0, 260.0]];
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
    'entity_key' => 'ggp:Gewaesser:See:Garetien:Muehlsee!Muehlsee|geometrie|' . $idSeeRegion,
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

// =================================================================================================
// 🔴 AUFGABE 13 (RECHTSFOLGENFEHLER): DIESELBE BINDUNG GILT AUCH FUER DIE ERGAENZUNG EINER
// BESTEHENDEN FLAECHE ('changed'/anlass=ergaenzung), NICHT NUR FUERS ANLEGEN. Der 'region'-Zweig
// von avesmapsGaretienErgaenzungAnwenden verknuepfte die Quelle bislang mit der REGIONS-public_id,
// obwohl die Karte Quellen fuer entity_type 'region' an der public_id des LABELS nachschlaegt
// (map-features.php:1228; AGENTS.md §11: "die Quellen einer Landschaft liegen ... an ihrer
// BESCHRIFTUNG"). Eine eigene Region+Label-Fixture, damit der frueher fehlende Nachschlag
// (`label_public_id` der Region) wirklich gebraucht wird -- die Fixture bei Review I1 traegt
// bewusst KEIN Label und wuerde die neue RuntimeException nur zufaellig ausloesen.
$idMoorLabel = '00000000-0000-4000-8000-000000007101';
$idMoorRegion = '00000000-0000-4000-8000-000000007102';
$pdo3->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idMoorLabel, 'Testmoor', 'label', 'suempfe_moore',
        json_encode(['type' => 'Point', 'coordinates' => [50.0, 60.0]]), '{}', 'Point']);
$pdo3->exec("INSERT INTO ecosystem_region (public_id, name, kind, region_type, label_public_id, is_active)
             VALUES ('{$idMoorRegion}', 'Testmoor', 'vegetation', 'suempfe_moore', '{$idMoorLabel}', 1)");

$runId9 = avesmapsSyncPlanStartRun($pdo3, AVESMAPS_GARETIEN_PLAN_KIND, 1, 'test-region-quelle');
avesmapsSyncPlanAddItem($pdo3, $runId9, [
    'entity_key' => 'ggp:Gewaesser:Moor:Garetien:Testmoor!Testmoor|ergaenzung|' . $idMoorRegion,
    'entity_public_id' => $idMoorRegion,
    'change_type' => 'changed',
    'label' => 'Testmoor → Testmoor · Quelle',
    'before' => ['public_id' => $idMoorRegion, 'name' => 'Testmoor'],
    'after' => ['herkunft' => 'garetien', 'anlass' => 'ergaenzung', 'felder' => ['quelle'],
        'ziel' => 'region', 'subtyp' => 'suempfe_moore', 'kind' => 'vegetation',
        'abschnitt' => ['public_id' => $idMoorRegion, 'name' => 'Testmoor', 'punkte' => 1, 'geometrie' => []],
        'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:Testmoor',
            'label' => 'Briefspiel (Garetien)', 'source_type' => 'briefspiel',
            'origin' => 'garetien', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de']],
    'override' => [], 'selected' => 1,
]);
$schrittMoor = avesmapsGaretienApplyStep($pdo3, $runId9, 1, ['id' => 1, 'username' => 'test']);
assert($schrittMoor['applied'] === 1, 'die Moor-Quelle wurde nicht uebernommen: ' . json_encode($schrittMoor));
$pruefungen++;

$moorQuelleRichtig = $pdo3->query("SELECT * FROM feature_sources WHERE entity_type = 'region' AND entity_public_id = "
    . $pdo3->quote($idMoorLabel))->fetch(PDO::FETCH_ASSOC);
assert($moorQuelleRichtig !== false, 'die Quelle muss unter der Label-id des Moors stehen, nicht der Regions-id');
$moorQuelleFalsch = (int) $pdo3->query("SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'region' AND entity_public_id = "
    . $pdo3->quote($idMoorRegion))->fetchColumn();
assert($moorQuelleFalsch === 0, 'keine Quelle darf im ID-Raum der Region liegen -- genau das war der Fehler');
$pruefungen += 2;

// 💣 UND EIN LABELLOSES OBJEKT WIRD LAUT ABGELEHNT, NICHT MIT EINER FALSCHEN ID VERKNUEPFT --
// dieselbe "lieber laut als falsch"-Regel wie bei der Mehrfach-Flaechen-Ablehnung oben.
$idWaisenRegion = '00000000-0000-4000-8000-000000007103';
$pdo3->exec("INSERT INTO ecosystem_region (public_id, name, kind, region_type, is_active)
             VALUES ('{$idWaisenRegion}', 'Waisenmoor', 'vegetation', 'suempfe_moore', 1)");
$fehlerLabellos = null;
try {
    avesmapsGaretienErgaenzungAnwenden($pdo3, [
        'ziel' => 'region', 'felder' => ['quelle'],
        'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:Waisenmoor', 'label' => 'x'],
    ], $idWaisenRegion, ['id' => 1]);
} catch (Throwable $fehler) {
    $fehlerLabellos = $fehler;
}
assert($fehlerLabellos !== null, 'eine Region ohne Label darf keine Quelle bekommen -- lieber laut als falsch verknuepft');
assert(str_contains($fehlerLabellos->getMessage(), 'kein Label'), 'der Grund nennt das fehlende Label: ' . $fehlerLabellos->getMessage());
$pruefungen += 2;

// =================================================================================================
// AUFGABE 9: DIE RUECKNAHME -- ein uebernommenes Objekt wieder von der Karte holen.
// Brief: .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-9-brief.md
//
// 🪤 MISS DIE DIFFERENZ, NICHT NUR "WURDE GELOESCHT" (Brief). Bei einem Weg verschwindet EINE
// aktive Zeile, bei einer Flaeche DREI (Label + Region + Flaeche) -- ueber DREI verschiedene
// Tabellen. Eine Zusicherung, die nur prueft, dass irgendetwas weg ist, prueft nichts.
//
// Weiterverwendet wird der urspruengliche $pdo/$lauf von ganz oben: dort stehen der Gardel (Weg,
// 'new', 'done') und der Muehlsee (Flaeche, 'new', 'done') schon fertig uebernommen.

// --- Der Weg (Gardel): EINE aktive map_features-Zeile verschwindet.
$mfAktivVorher = (int) $pdo->query('SELECT COUNT(*) FROM map_features WHERE is_active = 1')->fetchColumn();
$rGardel = avesmapsGaretienRuecknahmeAusfuehren($pdo, $lauf, [$gardel], ['id' => 7]);
assert($rGardel['zurueckgenommen'] === 1, 'der Gardel wurde nicht zurueckgenommen: ' . json_encode($rGardel['fehler'], JSON_UNESCAPED_UNICODE));
assert($rGardel['fehler'] === [], 'ohne Fehler: ' . json_encode($rGardel['fehler'], JSON_UNESCAPED_UNICODE));
$mfAktivNachher = (int) $pdo->query('SELECT COUNT(*) FROM map_features WHERE is_active = 1')->fetchColumn();
assert($mfAktivNachher === $mfAktivVorher - 1,
    'genau EINE aktive Zeile muss verschwinden, es waren ' . ($mfAktivVorher - $mfAktivNachher));
$gardelAktiv = $pdo->query('SELECT is_active FROM map_features WHERE public_id = '
    . $pdo->quote((string) $neu['public_id']))->fetchColumn();
assert((int) $gardelAktiv === 0, 'der Gardel selbst muss deaktiviert sein');
$pruefungen += 3;

// Das Item faellt zurueck auf 'offen': apply_state NULL, selected = 1 -- der Stand UNMITTELBAR VOR
// dem Klick auf „Neu einfuegen" (nur selected=1 landet ueberhaupt in avesmapsSyncPlanPendingItems).
$itemGardel = $pdo->query('SELECT apply_state, selected FROM sync_plan_item WHERE id = ' . $gardel)->fetch(PDO::FETCH_ASSOC);
assert($itemGardel['apply_state'] === null, 'apply_state muss wieder leer sein: ' . var_export($itemGardel['apply_state'], true));
assert((int) $itemGardel['selected'] === 1, 'selected muss wieder 1 sein, wie vor der Uebernahme');
$pruefungen += 2;

// --- Die Flaeche (Muehlsee): DREI aktive Zeilen verschwinden -- das Label (map_features), die
// Region UND die Flaeche (ecosystem_region/ecosystem_area). avesmapsDeleteEcosystemRegion nimmt
// alle drei in EINER Transaktion, nicht der allgemeine Feature-Loeschweg mit seinem
// `refuse_ecosystem_cascade`-Riegel (AGENTS.md §11, Konfliktzentrum, label.duplicate) -- der ist
// gebaut, um genau diese Kaskade beim Loeschen EINER Beschriftung zu VERHINDERN.
$mfAktivVorher2 = (int) $pdo->query('SELECT COUNT(*) FROM map_features WHERE is_active = 1')->fetchColumn();
$regionAktivVorher = (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_region WHERE is_active = 1')->fetchColumn();
$flaecheAktivVorher = (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_area WHERE is_active = 1')->fetchColumn();
$rMuehlsee = avesmapsGaretienRuecknahmeAusfuehren($pdo, $lauf, [$muehlsee], ['id' => 7]);
assert($rMuehlsee['zurueckgenommen'] === 1, 'der Muehlsee wurde nicht zurueckgenommen: ' . json_encode($rMuehlsee['fehler'], JSON_UNESCAPED_UNICODE));
assert($rMuehlsee['fehler'] === [], 'ohne Fehler: ' . json_encode($rMuehlsee['fehler'], JSON_UNESCAPED_UNICODE));
$pruefungen += 2;

$mfAktivNachher2 = (int) $pdo->query('SELECT COUNT(*) FROM map_features WHERE is_active = 1')->fetchColumn();
$regionAktivNachher = (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_region WHERE is_active = 1')->fetchColumn();
$flaecheAktivNachher = (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_area WHERE is_active = 1')->fetchColumn();
assert($mfAktivNachher2 === $mfAktivVorher2 - 1,
    'das Label muss verschwinden, es waren ' . ($mfAktivVorher2 - $mfAktivNachher2) . ' Zeilen');
assert($regionAktivNachher === $regionAktivVorher - 1,
    'die Region muss verschwinden, es waren ' . ($regionAktivVorher - $regionAktivNachher) . ' Zeilen');
assert($flaecheAktivNachher === $flaecheAktivVorher - 1,
    'die Flaeche muss verschwinden, es waren ' . ($flaecheAktivVorher - $flaecheAktivNachher) . ' Zeilen');
$pruefungen += 3;

// Und zwar genau DIESES Label, DIESE Region, DIESE Flaeche -- nicht irgendeine.
$labelAktiv = $pdo->query('SELECT is_active FROM map_features WHERE public_id = '
    . $pdo->quote((string) $label['public_id']))->fetchColumn();
$regionAktiv = $pdo->query('SELECT is_active FROM ecosystem_region WHERE public_id = '
    . $pdo->quote((string) $region['public_id']))->fetchColumn();
$flaecheAktiv = $pdo->query('SELECT is_active FROM ecosystem_area WHERE public_id = '
    . $pdo->quote((string) $flaeche['public_id']))->fetchColumn();
assert((int) $labelAktiv === 0, 'genau dieses Label muss deaktiviert sein');
assert((int) $regionAktiv === 0, 'genau diese Region muss deaktiviert sein');
assert((int) $flaecheAktiv === 0, 'genau diese Flaeche muss deaktiviert sein');
$pruefungen += 3;

$itemMuehlsee = $pdo->query('SELECT apply_state, selected FROM sync_plan_item WHERE id = ' . $muehlsee)->fetch(PDO::FETCH_ASSOC);
assert($itemMuehlsee['apply_state'] === null, 'apply_state der Flaeche muss wieder leer sein');
assert((int) $itemMuehlsee['selected'] === 1, 'selected der Flaeche muss wieder 1 sein');
$pruefungen += 2;

// --- 🔴 OWNER-ENTSCHEID 1 (29.08.2026): ein 'changed'-Item bekommt GAR KEINE Ruecknahme -- auch
// nicht, wenn es erfolgreich uebernommen wurde. $diagonaleGeoId ist genau so ein Fall
// (change_type='changed', anlass='geometrie', apply_state='done' seit der Geometrie-Uebernahme
// weiter oben) -- es hat ein BESTEHENDES Objekt veraendert, nicht eines angelegt.
$geoVorRuecknahme = $pdo->query('SELECT geometry_json FROM map_features WHERE public_id = '
    . $pdo->quote($idDiagonaleWeg2))->fetch(PDO::FETCH_ASSOC);
$rChanged = avesmapsGaretienRuecknahmeAusfuehren($pdo, $lauf, [$diagonaleGeoId], ['id' => 7]);
assert($rChanged['zurueckgenommen'] === 0, 'ein "changed"-Item darf nicht zurueckgenommen werden koennen');
assert(count($rChanged['fehler']) === 1, 'und der Grund steht im Ergebnis: ' . json_encode($rChanged));
assert(str_contains($rChanged['fehler'][0]['grund'], 'nicht ruecknehmbar'), $rChanged['fehler'][0]['grund']);
$pruefungen += 3;

// Und es bleibt WIRKLICH unangetastet: weder das Kartenobjekt noch der Item-Vermerk aendern sich.
$geoNachRuecknahme = $pdo->query('SELECT geometry_json, is_active FROM map_features WHERE public_id = '
    . $pdo->quote($idDiagonaleWeg2))->fetch(PDO::FETCH_ASSOC);
assert((int) $geoNachRuecknahme['is_active'] === 1, 'ein "changed"-Objekt bleibt aktiv');
assert($geoNachRuecknahme['geometry_json'] === $geoVorRuecknahme['geometry_json'], 'und seine Geometrie bleibt unveraendert');
$itemChanged = $pdo->query('SELECT apply_state FROM sync_plan_item WHERE id = ' . $diagonaleGeoId)->fetchColumn();
assert($itemChanged === 'done', 'sein Vermerk bleibt "done": ' . var_export($itemChanged, true));
$pruefungen += 3;

// --- Eine leere Auswahl nimmt NICHTS zurueck. Sie ist kein "alles".
$rLeer = avesmapsGaretienRuecknahmeAusfuehren($pdo, $lauf, [], ['id' => 7]);
assert($rLeer['zurueckgenommen'] === 0 && $rLeer['fehler'] === [], 'eine leere Auswahl bleibt wirkungslos');
$pruefungen++;

// --- 💣 EIN OBJEKT, DAS SCHON WEG IST, WIRFT LAUT -- statt eine halbe Ruecknahme vorzutaeuschen
// ("eine halb zurueckgenommene Flaeche ist schlimmer als gar keine Ruecknahme", Brief). Der
// Testbach (aus dem Diagonale-Waechter weiter oben, 'new', 'done') wird von AUSSEN entfernt (als
// haette ein Editor ihn zwischendurch geloescht) -- die Ruecknahme darauf muss das SAGEN, nicht
// stillschweigend als erledigt durchgehen.
$pdo->exec("UPDATE map_features SET is_active = 0 WHERE name = 'Testbach Diagonale'");
$rWeg = avesmapsGaretienRuecknahmeAusfuehren($pdo, $lauf, [$diagonaleWegId], ['id' => 7]);
assert($rWeg['zurueckgenommen'] === 0, 'ein bereits fehlendes Objekt darf nicht als zurueckgenommen zaehlen');
assert(count($rWeg['fehler']) === 1, 'und der Fehlschlag steht im Ergebnis: ' . json_encode($rWeg));
assert((string) $rWeg['fehler'][0]['grund'] !== '', 'mit einem Grund');
$itemWeg = $pdo->query('SELECT apply_state FROM sync_plan_item WHERE id = ' . $diagonaleWegId)->fetchColumn();
assert($itemWeg === 'done', 'das Item bleibt auf "done" stehen, statt lautlos "offen" zu werden');
$pruefungen += 4;

// ===============================================================================================
// Aufgabe 12 (2026-08-29): die neuen Ziele 'location' (Ort) und 'label' (Berggipfel) -- ANLEGEN
// UND ERGAENZEN. Eigener, ISOLIERTER Pruefstand: die bestehenden Zaehler oben (Alke/Gardel/…)
// duerfen davon unberuehrt bleiben.
$pdoNeu = avesmapsGaretienUebernahmeTestPdo();
$laufNeu = (int) avesmapsSyncPlanOpenRun($pdoNeu, AVESMAPS_GARETIEN_PLAN_KIND)['id'];

/** Ein nach()-Rumpf, wie garetien-plan.php ihn fuer 'location'/'label' baut -- hier von Hand. */
$bauePunktEintrag = static function (string $ziel, string $subtyp, string $name, float $x, float $y): array {
    return [
        'entity_key' => 'ggp:Probe:' . $ziel . ':' . $name,
        'entity_public_id' => null,
        'change_type' => 'new',
        'label' => $name . ' (Probe)',
        'before' => [],
        'after' => [
            'herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Probe', 'typ' => 'Probe',
            'ziel' => $ziel, 'subtyp' => $subtyp, 'kind' => null, 'name' => $name,
            'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]],
            'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:' . $name,
                'label' => 'Briefspiel (Garetien)', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de'],
            'urteil' => 'neu', 'anlass' => null, 'nachbar' => null,
        ],
        'override' => [],
        'selected' => 1,
    ];
};
$itemIdVon = static function (PDO $pdo, string $label): int {
    $stmt = $pdo->prepare('SELECT id FROM sync_plan_item WHERE label = :l ORDER BY id DESC LIMIT 1');
    $stmt->execute([':l' => $label]);

    return (int) $stmt->fetchColumn();
};

// --- Ort: avesmapsCreatePointFeature, entity_type 'settlement'.
// 🔴 AUFGABE 29: EIN ORT IST KEINE "LANDSCHAFT" -- selbst mit einem passenden Namensgleichstand
// in der Wiki-Landschaft-Tabelle darf hier NICHTS zugewiesen werden (der Auftrag gilt
// ausdruecklich nur Flaeche und Berggipfel).
avesmapsGaretienUebernahmeWikiRegionZeile($pdoNeu, 'Testdorf Garetien', 'Region', 'wiki:testdorf-fehlgriff');
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $bauePunktEintrag('location', 'dorf', 'Testdorf Garetien', 500.0, 500.0));
$ortItemId = $itemIdVon($pdoNeu, 'Testdorf Garetien (Probe)');
$eOrt = avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$ortItemId], ['id' => 7]);
assert($eOrt['angelegt'] === 1 && $eOrt['fehler'] === [], 'der Ort wird angelegt: ' . json_encode($eOrt, JSON_UNESCAPED_UNICODE));
$ortZeile = $pdoNeu->query("SELECT public_id, feature_type, feature_subtype, name, properties_json FROM map_features WHERE name = 'Testdorf Garetien'")->fetch(PDO::FETCH_ASSOC);
assert($ortZeile !== false, 'der Ort steht in map_features');
assert($ortZeile['feature_type'] === 'location' && $ortZeile['feature_subtype'] === 'dorf',
    'feature_type/feature_subtype stimmen: ' . json_encode($ortZeile));
assert(!str_contains((string) $ortZeile['properties_json'], 'wiki_region'),
    'ein Ort bekommt KEINE Wiki-Landschaft zugewiesen: ' . $ortZeile['properties_json']);
$pruefungen += 4;

// 🔴 Die Quelle haengt an entity_type='settlement', NICHT 'location' -- das ist die Bindung, die
// map-features.php:1228 fuer den Infobox-Quellenkasten benutzt.
$ortQuelle = $pdoNeu->prepare("SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'settlement' AND entity_public_id = ?");
$ortQuelle->execute([$ortZeile['public_id']]);
assert((int) $ortQuelle->fetchColumn() === 1,
    'die EINE Quelle des Ortes haengt an entity_type=settlement -- seit 01.09.2026 der Artikel allein');
$pruefungen++;


// --- 🔴 „Ort bearbeiten" WIRKT WIRKLICH (Owner 30.08.2026). Der Test oben legt einen Ort OHNE
// Handeingabe an; dieser legt einen MIT an und liest die vier Felder aus properties_json zurueck.
// Ohne diese Gegenprobe waere die ganze Bedienoberflaeche eine Behauptung: die reine Funktion
// avesmapsGaretienOrtUebersteuerung koennte tadellos sein und der Aufruf im 'location'-Zweig
// trotzdem fehlen -- genau die Luecke, die dem Quellen-Lizenzfeld drei Tage gekostet hat
// („Feld erreicht nur den TESTBAREN Leser").
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $bauePunktEintrag('location', 'stadt', 'Probestadt Einstellbar', 510.0, 510.0));
$ortEinstellId = $itemIdVon($pdoNeu, 'Probestadt Einstellbar (Probe)');
$eOrtEinstell = avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$ortEinstellId], ['id' => 7], [
    'is_nodix' => true, 'is_ruined' => true, 'is_hidden' => true, 'place_kind' => 'Brücke',
]);
assert($eOrtEinstell['angelegt'] === 1 && $eOrtEinstell['fehler'] === [],
    'der eingestellte Ort wird angelegt: ' . json_encode($eOrtEinstell, JSON_UNESCAPED_UNICODE));
$ortEinstellProps = json_decode((string) $pdoNeu->query(
    "SELECT properties_json FROM map_features WHERE name = 'Probestadt Einstellbar'"
)->fetchColumn(), true);
assert(($ortEinstellProps['is_nodix'] ?? null) === true, 'is_nodix traegt die Handeingabe: ' . json_encode($ortEinstellProps));
assert(($ortEinstellProps['is_ruined'] ?? null) === true, 'is_ruined traegt die Handeingabe: ' . json_encode($ortEinstellProps));
assert(($ortEinstellProps['is_hidden'] ?? null) === true, 'is_hidden traegt die Handeingabe: ' . json_encode($ortEinstellProps));
assert(($ortEinstellProps['place_kind'] ?? null) === 'Brücke',
    'place_kind rastet auf den Katalog ein und steht drin: ' . json_encode($ortEinstellProps, JSON_UNESCAPED_UNICODE));
$pruefungen += 5;

// ⚠️ GEGENPROBE ZUM OBEN ANGELEGTEN ORT: er stand OHNE Handeingabe da und muss die drei Haken auf
// `false` und GAR KEIN place_kind tragen. Ohne sie belegt der Block darueber nur, dass irgendwo
// `true` herauskommt -- nicht, dass die Handeingabe der Grund dafuer ist.
$ortOhneProps = json_decode((string) $ortZeile['properties_json'], true);
assert(($ortOhneProps['is_nodix'] ?? null) === false, 'ohne Handeingabe bleibt is_nodix aus');
assert(($ortOhneProps['is_ruined'] ?? null) === false, 'ohne Handeingabe bleibt is_ruined aus');
assert(($ortOhneProps['is_hidden'] ?? null) === false, 'ohne Handeingabe bleibt is_hidden aus');
assert(!array_key_exists('place_kind', $ortOhneProps),
    'ohne Handeingabe steht place_kind GAR NICHT im JSON -- ein leerer Schluessel waere die '
    . 'Behauptung "keine Art", die niemand getroffen hat: ' . json_encode($ortOhneProps));
$pruefungen += 4;
// --- 🔴 KORREKTUR A (Owner-Nachtrag 30.08.2026: „DOCH DER IMPORT SOLL SIE SETZEN!!!"). Eine

// --- 🔴 „Weg bearbeiten" WIRKT WIRKLICH (Owner 30.08.2026). Dieselbe Gegenprobe wie beim Ort:
// die reine Funktion koennte tadellos sein und der Aufruf im 'path'-Zweig trotzdem fehlen.
$baueWegEintrag = static function (string $subtyp, string $name, array $linie): array {
    return [
        'entity_key' => 'ggp:Probe:path:' . $name,
        'entity_public_id' => null,
        'change_type' => 'new',
        'label' => $name . ' (Probe)',
        'before' => [],
        'after' => [
            'herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Probe', 'typ' => 'Probe',
            'ziel' => 'path', 'subtyp' => $subtyp, 'kind' => null, 'name' => $name,
            'geometry' => ['type' => 'LineString', 'coordinates' => $linie],
            'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:' . $name,
                'label' => 'Briefspiel (Garetien)', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de'],
            'urteil' => 'neu', 'anlass' => null, 'nachbar' => null,
        ],
        'override' => [],
        'selected' => 1,
    ];
};

// MIT Handeingabe: der Name steht auf der Karte, und nur EIN Verkehrsmittel ist erlaubt.
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $baueWegEintrag('Flussweg', 'Probefluss Einstellbar', [[520.0, 520.0], [530.0, 530.0]]));
$wegEinstellId = $itemIdVon($pdoNeu, 'Probefluss Einstellbar (Probe)');
$eWegEinstell = avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$wegEinstellId], ['id' => 7], [
    'show_label' => true, 'allowed_transports' => ['riverSailer'],
]);
assert($eWegEinstell['angelegt'] === 1 && $eWegEinstell['fehler'] === [],
    'der eingestellte Weg wird angelegt: ' . json_encode($eWegEinstell, JSON_UNESCAPED_UNICODE));
$wegEinstellProps = json_decode((string) $pdoNeu->query(
    "SELECT properties_json FROM map_features WHERE name = 'Probefluss Einstellbar'"
)->fetchColumn(), true);
assert(($wegEinstellProps['show_label'] ?? null) === true, 'show_label traegt die Handeingabe: ' . json_encode($wegEinstellProps));
assert(($wegEinstellProps['allowed_transports'] ?? null) === ['riverSailer'],
    'allowed_transports traegt GENAU die eine Handeingabe: ' . json_encode($wegEinstellProps));
$pruefungen += 3;

// ⚠️ GEGENPROBE OHNE Handeingabe: derselbe Wegtyp muss show_label=false und die volle Vorauswahl
// der Wegart tragen. Ohne sie belegt der Block darueber nur, dass irgendwo etwas herauskommt --
// nicht, dass die Handeingabe der Grund dafuer ist. 🔴 Die Vorauswahl wird NICHT abgeschrieben,
// sondern gegen die Hausregel gehalten: avesmapsReadAllowedTransports faellt bei fehlendem Wert
// genau auf sie zurueck, und ihre Laenge muss GROESSER sein als die eine oben.
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $baueWegEintrag('Flussweg', 'Probefluss Vorgabe', [[540.0, 540.0], [550.0, 550.0]]));
$wegVorgabeId = $itemIdVon($pdoNeu, 'Probefluss Vorgabe (Probe)');
avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$wegVorgabeId], ['id' => 7]);
$wegVorgabeProps = json_decode((string) $pdoNeu->query(
    "SELECT properties_json FROM map_features WHERE name = 'Probefluss Vorgabe'"
)->fetchColumn(), true);
assert(($wegVorgabeProps['show_label'] ?? null) === false, 'ohne Handeingabe bleibt show_label aus');
assert(count((array) ($wegVorgabeProps['allowed_transports'] ?? [])) > 1,
    'ohne Handeingabe gilt die volle Vorauswahl der Wegart, nicht die eine von oben: '
    . json_encode($wegVorgabeProps));
$pruefungen += 2;

// --- 🔴 EIN BACH GEHT DURCH DEN IMPORT (Owner 30.08.2026: „der jetzt bäche importieren soll").
// Die Zuordnung bildet ihn auf `Flussweg` ab und traegt `is_bach`; der Anleger nimmt ihm darueber
// jede Befahrbarkeit (avesmapsPathTransportRegel). Gemessen wird das ERGEBNIS in properties_json,
// nicht die Zuordnungstabelle -- die kann tadellos sein, waehrend das Feld unterwegs verlorengeht.
$baueBachEintrag = static function (string $typ, string $name, array $linie) use ($baueWegEintrag): array {
    $eintrag = $baueWegEintrag('Flussweg', $name, $linie);
    $eintrag['after']['typ'] = $typ;
    if ($typ === 'Bach') {
        $eintrag['after']['is_bach'] = true;
    }

    return $eintrag;
};

avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $baueBachEintrag('Bach', 'Probebach Garetien', [[560.0, 560.0], [570.0, 570.0]]));
$bachItemId = $itemIdVon($pdoNeu, 'Probebach Garetien (Probe)');
$eBach = avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$bachItemId], ['id' => 7]);
assert($eBach['angelegt'] === 1 && $eBach['fehler'] === [],
    'der Bach wird angelegt: ' . json_encode($eBach, JSON_UNESCAPED_UNICODE));
$bachZeile = $pdoNeu->query("SELECT feature_subtype, properties_json FROM map_features WHERE name = 'Probebach Garetien'")->fetch(PDO::FETCH_ASSOC);
assert($bachZeile !== false, 'der Bach steht in map_features');
// 🔴 Er ist ein FLUSSWEG -- „Bach" ist kein Wegtyp und darf nie in feature_subtype landen.
assert($bachZeile['feature_subtype'] === 'Flussweg',
    'ein Bach wird als Flussweg gespeichert, nicht als eigene Wegart: ' . json_encode($bachZeile));
$bachProps = json_decode((string) $bachZeile['properties_json'], true);
assert(($bachProps['is_bach'] ?? null) === true, 'und traegt das Haekchen: ' . json_encode($bachProps));
assert(($bachProps['allowed_transports'] ?? null) === [],
    'ein Bach traegt KEIN Verkehrsmittel: ' . json_encode($bachProps));
assert(($bachProps['transport_domain'] ?? null) === 'none',
    'und liegt in der leeren Domaene: ' . json_encode($bachProps));
$pruefungen += 6;

// ⚠️ GEGENPROBE: ein FLUSS aus derselben Quelle, ueber denselben Weg, muss weiter befahrbar sein.
// Ohne sie belegt der Block darueber nur, dass irgendwo eine leere Liste herauskommt -- nicht, dass
// das Bach-Haekchen der Grund dafuer ist.
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $baueBachEintrag('Fluss', 'Probefluss Garetien', [[580.0, 580.0], [590.0, 590.0]]));
$flussItemId = $itemIdVon($pdoNeu, 'Probefluss Garetien (Probe)');
avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$flussItemId], ['id' => 7]);
$flussProps = json_decode((string) $pdoNeu->query(
    "SELECT properties_json FROM map_features WHERE name = 'Probefluss Garetien'"
)->fetchColumn(), true);
assert(!array_key_exists('is_bach', $flussProps),
    'ein Fluss traegt GAR KEIN is_bach -- die Abwesenheit ist die Aussage: ' . json_encode($flussProps));
assert(($flussProps['allowed_transports'] ?? null) === ['riverSailer', 'riverBarge'],
    'und bleibt mit beiden Fluss-Verkehrsmitteln befahrbar: ' . json_encode($flussProps));
$pruefungen += 2;

// 💣 Und die ZUORDNUNG selbst: sie muss das Haekchen ueberhaupt setzen. Ohne diese Zeile koennte
// alles oben stimmen, waehrend der echte Lauf Baeche ohne Haekchen anlegt -- der Test baut seinen
// Eintrag von Hand und saehe das nie.
$bachZuordnung = avesmapsGaretienMappeTyp('Bach');
assert(is_array($bachZuordnung) && ($bachZuordnung['subtyp'] ?? '') === 'Flussweg',
    'die Zuordnung bildet "Bach" auf Flussweg ab: ' . json_encode($bachZuordnung));
assert(!empty($bachZuordnung['is_bach']),
    'und setzt das Haekchen: ' . json_encode($bachZuordnung));
$flussZuordnung = avesmapsGaretienMappeTyp('Fluss');
assert(empty($flussZuordnung['is_bach']),
    'waehrend "Fluss" es NICHT setzt: ' . json_encode($flussZuordnung));
$pruefungen += 3;
// Uebersteuerung, wie sie das Fenster „Landschaften -> Darstellung" tatsaechlich speichert:

// --- 🔴 DIE UEBERNAHME SCHREIBT DEN DAUERHAFTEN VERMERK (Owner-Befund 30.08.2026: „das problem
// ist, dass 'holen' die einträge / IDs in 'übernommen' killt"). `apply_state` stirbt mit dem Lauf,
// sync_decision nicht -- ohne diesen Vermerk faellt jede Uebernahme beim naechsten Neurechnen auf
// „Offen" zurueck, waehrend eine Ablehnung liegenbleibt. Dass er den Laufwechsel dann wirklich
// ueberlebt, sichert garetien-liste-test.php; hier steht die andere Haelfte: dass er entsteht.
$vermerkStmt = $pdoNeu->prepare(
    "SELECT COUNT(*) FROM sync_decision WHERE kind = 'garetien' AND entity_key = ? AND applied_at IS NOT NULL"
);
$vermerkStmt->execute(['ggp:Probe:path:Probebach Garetien']);
assert((int) $vermerkStmt->fetchColumn() === 1,
    'die Uebernahme des Bachs hat einen dauerhaften Vermerk hinterlassen');
$pruefungen++;

// ⚠️ Gegenprobe: eine Zeile, die NICHT uebernommen wurde, hat keinen. Ohne sie belegte die Zeile
// darueber nur, dass irgendwo Vermerke stehen.
$vermerkStmt->execute(['ggp:Probe:path:gibtsnicht']);
assert((int) $vermerkStmt->fetchColumn() === 0, 'eine nicht uebernommene Zeile hat keinen Vermerk');
$pruefungen++;

// 🔴 UND ER STEHT AN BEIDEN AUSGAENGEN. `done` wird an zwei Stellen gesetzt (Ergaenzung und
// Anlegen); der Vermerk sitzt deshalb IM Trichter avesmapsGaretienItemAbschliessen und nicht an
// den Aufrufstellen. Gemessen am Quelltext, weil beide Ausgaenge eine eigene Fixture braeuchten.
// 🪤 Kommentare vorher weg -- sonst schlaegt der Test an der Erklaerung an, die davor warnt.
$uebernahmeQuelle = preg_replace('~^\s*//.*$~m', '',
    str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../garetien-uebernahme.php')));
assert(preg_match_all('~avesmapsSyncPlanRecordApplied\s*\(~', (string) $uebernahmeQuelle) === 1,
    'der Vermerk wird GENAU EINMAL geschrieben -- im Trichter, nicht je Ausgang');
assert(preg_match_all('~avesmapsGaretienItemAbschliessen\([^;]*?\x27done\x27~', (string) $uebernahmeQuelle) === 2,
    'und es gibt wirklich ZWEI done-Ausgaenge -- sonst belegt die Zeile darueber nichts');
$pruefungen += 2;

// --- 🔴 DER ALTE PLAN (Owner-Befund 30.08.2026, an einem Bildschirmfoto seines Laufs vom 29.08.).
// `is_bach` entsteht beim RECHNEN. Ein Lauf, der VOR dem 30.08.2026 gebaut wurde, traegt das Feld
// nicht -- und zeigte den Bach deshalb weiter als gewoehnlichen Flussweg samt zwei angehakten
// Verkehrsmitteln. Die 143 Baeche waeren als BEFAHRBARE Fluesse in die Karte gegangen, also genau
// der Schaden, gegen den das Haekchen gebaut ist.
// ⚠️ Der Eintrag hier hat KEIN `is_bach` -- das ist der ganze Punkt. Er trägt nur `typ`, und daraus
// findet avesmapsGaretienNachIstBach ueber die Zuordnungstabelle zurueck.
$alterBach = $baueWegEintrag('Flussweg', 'Altplan Bach', [[600.0, 600.0], [610.0, 610.0]]);
$alterBach['after']['typ'] = 'Bach';
assert(!array_key_exists('is_bach', $alterBach['after']),
    'die Vorbedingung: der alte Planeintrag traegt das Feld NICHT -- sonst prueft dieser Block nichts');
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $alterBach);
$alterId = $itemIdVon($pdoNeu, 'Altplan Bach (Probe)');
avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$alterId], ['id' => 7]);
$alterProps = json_decode((string) $pdoNeu->query(
    "SELECT properties_json FROM map_features WHERE name = 'Altplan Bach'"
)->fetchColumn(), true);
assert(($alterProps['is_bach'] ?? null) === true,
    'auch ein ALTER Planeintrag wird als Bach angelegt: ' . json_encode($alterProps));
assert(($alterProps['allowed_transports'] ?? null) === [],
    'und traegt kein Verkehrsmittel: ' . json_encode($alterProps));
$pruefungen += 3;

// ⚠️ Gegenprobe: ein alter Eintrag mit `typ` = 'Fluss' bleibt befahrbar -- sonst belegte der Block
// darueber nur, dass der Rueckfall IMMER 'Bach' sagt.
$alterFluss = $baueWegEintrag('Flussweg', 'Altplan Fluss', [[620.0, 620.0], [630.0, 630.0]]);
$alterFluss['after']['typ'] = 'Fluss';
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $alterFluss);
avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$itemIdVon($pdoNeu, 'Altplan Fluss (Probe)')], ['id' => 7]);
$alterFlussProps = json_decode((string) $pdoNeu->query(
    "SELECT properties_json FROM map_features WHERE name = 'Altplan Fluss'"
)->fetchColumn(), true);
assert(!array_key_exists('is_bach', $alterFlussProps),
    'ein alter Fluss-Eintrag bekommt KEIN Haekchen: ' . json_encode($alterFlussProps));
assert(count((array) ($alterFlussProps['allowed_transports'] ?? [])) === 2,
    'und bleibt befahrbar: ' . json_encode($alterFlussProps));
$pruefungen += 2;

// 🔴 UND DAS GESPEICHERTE FELD HAT VORRANG vor dem Rueckfall: ein Plan beschreibt, was zum
// Zeitpunkt seines Baus galt. Ein ausdrueckliches `false` an einem `typ` = 'Bach' bleibt `false`.
assert(avesmapsGaretienNachIstBach(['typ' => 'Bach', 'is_bach' => false]) === false,
    'ein ausdrueckliches false schlaegt den Rueckfall');
assert(avesmapsGaretienNachIstBach(['typ' => 'Bach']) === true, 'ohne Feld entscheidet die Zuordnung');
assert(avesmapsGaretienNachIstBach(['typ' => 'Fluss']) === false, 'und die sagt beim Fluss nein');
assert(avesmapsGaretienNachIstBach([]) === false, 'ein Eintrag ganz ohne Typ ist kein Bach');
$pruefungen += 4;
// 'berggipfel' traegt eine VOLLSTAENDIGE, gueltige Zeile, 'vulkan' eine, die ausserhalb dessen
// liegt, was ein Label ueberhaupt tragen darf (Groesse 4 < die 10 von avesmapsReadLabelSize; ein
// invertiertes Zoomband, in der Darstellungstafel gueltig als "aus", hier keine gueltige Aussage
// fuer ein neues Label). Beide Zeilen zusammen pruefen avesmapsGaretienLabelVorgabeFuerArt an
// ihren zwei Enden: uebernommen, wo gueltig -- verworfen zugunsten des Grundwerts, wo nicht.
$pdoNeu->exec('INSERT INTO app_setting (setting_key, setting_value) VALUES ('
    . $pdoNeu->quote('ecosystem_display') . ', ' . $pdoNeu->quote(json_encode([
        'vorgabe' => [
            'berggipfel' => ['ab' => 2, 'bis' => 6, 'prio' => 4],
            'vulkan' => ['ab' => 5, 'bis' => 1, 'prio' => 2],
        ],
        'groesse' => [
            'berggipfel' => [10, 11, 12, 13, 14, 17, 20, 23, 25],
            'vulkan' => [4, 4, 4, 4, 4, 4, 4, 4, 4],
        ],
    ], JSON_UNESCAPED_UNICODE)) . ')');

// --- Berggipfel: avesmapsCreateLabelFeature, entity_type 'region' (map-features.php:1228),
// KEYED AN DER PUBLIC_ID DES LABELS SELBST -- es gibt keine Region dahinter.
//
// 🔴 AUFGABE 29 (Owner-Entscheid 30.08.2026): "Testspitze" traegt hier eine Wiki-Landschaft mit
// ABWEICHENDER Art (Wiki sagt "See", der Import will "berggipfel") -- die tragende Zusicherung
// der Aufgabe: TROTZDEM zugewiesen, Owner: "wenn nicht sieht der editor ja, dass der typ anders
// is ... des geht nur um die zuweisung". Zugleich die Gegenprobe zu Muehlsee oben (dort passte
// die Art) -- zwei verschiedene Ausgaenge muessen zwei verschiedene Wege durchlaufen, sonst
// prueft keine der beiden Zeilen etwas.
avesmapsGaretienUebernahmeWikiRegionZeile($pdoNeu, 'Testspitze', 'See', 'wiki:testspitze');
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $bauePunktEintrag('label', 'berggipfel', 'Testspitze', 600.0, 600.0));
$bergItemId = $itemIdVon($pdoNeu, 'Testspitze (Probe)');
$eBerg = avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$bergItemId], ['id' => 7]);
assert($eBerg['angelegt'] === 1 && $eBerg['fehler'] === [], 'der Gipfel wird angelegt: ' . json_encode($eBerg, JSON_UNESCAPED_UNICODE));
$bergZeile = $pdoNeu->query("SELECT public_id, feature_type, feature_subtype, name, properties_json FROM map_features WHERE name = 'Testspitze'")->fetch(PDO::FETCH_ASSOC);
assert($bergZeile !== false, 'der Gipfel steht in map_features');
assert($bergZeile['feature_type'] === 'label' && $bergZeile['feature_subtype'] === 'berggipfel',
    'feature_type/feature_subtype stimmen: ' . json_encode($bergZeile));
$pruefungen += 3;

// --- 🔴 DER IMPORT SETZT DIE VORGABE DER ART: min_zoom=2, max_zoom=6, priority=4, size=17 --
// zeichenidentisch mit der gespeicherten Uebersteuerung, und andere Werte als bei der Muehlsee-
// Flaeche (Art 'see', Grundwert) weiter oben -- ohne diesen Gegensatz pruefte keine der beiden
// Zeilen etwas.
$bergProps = json_decode((string) $bergZeile['properties_json'], true);
assert(($bergProps['min_zoom'] ?? null) === 2, 'min_zoom traegt die Uebersteuerung der Art: ' . json_encode($bergProps));
assert(($bergProps['max_zoom'] ?? null) === 6, 'max_zoom traegt die Uebersteuerung der Art: ' . json_encode($bergProps));
assert(($bergProps['priority'] ?? null) === 4, 'priority traegt die Uebersteuerung der Art: ' . json_encode($bergProps));
assert(($bergProps['size'] ?? null) === 17, 'size traegt den z5-Wert der Uebersteuerung: ' . json_encode($bergProps));
$pruefungen += 4;

// --- 🔴 AUFGABE 29: DER SCHLUESSEL STEHT TROTZ ABWEICHENDER ART, UND SUBTYP/NAME BLEIBEN
// UNVERAENDERT DIE DES IMPORTS ('berggipfel'/'Testspitze', NICHT die Wiki-Art "See").
assert(($bergProps['wiki_region']['wiki_key'] ?? '') === 'wiki:testspitze',
    'der Gipfel traegt den gefundenen Wiki-Schluessel trotz abweichender Art: ' . json_encode($bergProps));
assert($bergZeile['feature_subtype'] === 'berggipfel', 'der Subtyp bleibt der des Imports: ' . $bergZeile['feature_subtype']);
assert($bergZeile['name'] === 'Testspitze', 'der Name bleibt der des Imports: ' . $bergZeile['name']);
$pruefungen += 3;

// --- 🔴 UND EINE UNGUELTIGE UEBERSTEUERUNG FAELLT AUF DEN GRUNDWERT ZURUECK, STATT DEN IMPORT
// ABZUBRECHEN. 'vulkan' traegt oben eine Zeile, die es fuer die Darstellungstafel gueltig gibt
// (Groesse 4, Zoomband "aus"), aber keine, die avesmapsReadLabelSize/…Zoom durchliesse --
// avesmapsGaretienLabelVorgabeFuerArt muss sie VORHER verwerfen, nicht avesmapsCreateLabelFeature
// werfen lassen.
//
// 🔴 AUFGABE 29: "Testvulkan" hat KEINEN Namensgleichstand in der Wiki-Landschaft-Tabelle --
// kein_treffer, also KEINE Zuweisung. Ohne diesen Fall pruefte kein Test, dass ein fehlender
// Treffer wirklich nichts eintraegt (die Gegenprobe zu Testspitze/Muehlsee oben).
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $bauePunktEintrag('label', 'vulkan', 'Testvulkan', 620.0, 620.0));
$vulkanItemId = $itemIdVon($pdoNeu, 'Testvulkan (Probe)');
$eVulkan = avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$vulkanItemId], ['id' => 7]);
assert($eVulkan['angelegt'] === 1 && $eVulkan['fehler'] === [],
    'der Vulkan wird trotz ungueltiger Uebersteuerung angelegt: ' . json_encode($eVulkan, JSON_UNESCAPED_UNICODE));
$vulkanZeile = $pdoNeu->query("SELECT properties_json FROM map_features WHERE name = 'Testvulkan'")->fetch(PDO::FETCH_ASSOC);
assert($vulkanZeile !== false, 'der Vulkan steht in map_features');
$vulkanProps = json_decode((string) $vulkanZeile['properties_json'], true);
assert(($vulkanProps['min_zoom'] ?? null) === 0, 'min_zoom faellt auf den Grundwert zurueck: ' . json_encode($vulkanProps));
assert(($vulkanProps['max_zoom'] ?? null) === 5, 'max_zoom faellt auf den Grundwert zurueck: ' . json_encode($vulkanProps));
assert(($vulkanProps['size'] ?? null) === 18, 'size faellt auf den Grundwert zurueck: ' . json_encode($vulkanProps));
assert(!array_key_exists('wiki_region', $vulkanProps), 'ohne Wiki-Treffer bleibt wiki_region ganz WEG: ' . json_encode($vulkanProps));
$pruefungen += 6;

// 🔴 DIE TRAGENDE ZUSICHERUNG: KEINE ERFUNDENE HOEHE. Ein Gipfel ist ein Stuetzpunkt des
// Hoehenfelds (terrain-store.php liest is_active=1 + height_schritt); Volkers Daten tragen keine
// Hoehe, also darf der Schluessel im Nest gar nicht erst auftauchen.
assert(!str_contains((string) $bergZeile['properties_json'], 'height_schritt'),
    'kein height_schritt am importierten Gipfel: ' . $bergZeile['properties_json']);
$pruefungen++;

$bergQuelle = $pdoNeu->prepare("SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'region' AND entity_public_id = ?");
$bergQuelle->execute([$bergZeile['public_id']]);
assert((int) $bergQuelle->fetchColumn() === 1,
    'die Quelle des Gipfels haengt an seiner EIGENEN public_id unter entity_type=region');
$pruefungen++;

// ===============================================================================================
// Aufgabe 30 (30.08.2026) -- der Kasten "Eingefügt wird" wird editierbar. Owner, wörtlich: "ich
// hatte plötzlich 3000 labels da stehen ... WARUM DARF ICH DAS NICHT VERÄNDERN?" -- die Werte im
// Kasten reisen jetzt als Handeingabe mit dem Einfügen mit.
// ===============================================================================================

// --- Reine Funktion, keine Datenbank: avesmapsGaretienLabelUebersteuerung. Eine Handeingabe
// UEBERSTIMMT die Vorgabe der Art, fehlt sie fuer ein Feld, bleibt die Vorgabe stehen -- und
// `null` (keine Handeingabe ueberhaupt) aendert an der Vorgabe GAR NICHTS.
$vorgabeTest = ['min_zoom' => 2, 'max_zoom' => 6, 'priority' => 4, 'size' => 17];
assert(avesmapsGaretienLabelUebersteuerung(null, $vorgabeTest) === $vorgabeTest,
    'ohne Handeingabe bleibt die Vorgabe der Art unveraendert');
assert(avesmapsGaretienLabelUebersteuerung([], $vorgabeTest) === $vorgabeTest,
    'eine LEERE Handeingabe aendert ebenfalls nichts');
$vollUebersteuert = avesmapsGaretienLabelUebersteuerung(
    ['size' => 30, 'priority' => 5, 'min_zoom' => 1, 'max_zoom' => 4, 'show_name' => false],
    $vorgabeTest
);
assert($vollUebersteuert === ['min_zoom' => 1, 'max_zoom' => 4, 'priority' => 5, 'size' => 30, 'show_name' => false],
    'eine VOLLE Handeingabe ueberstimmt alle vier Felder und setzt show_name dazu: ' . json_encode($vollUebersteuert));
$teilUebersteuert = avesmapsGaretienLabelUebersteuerung(['is_locked' => true, 'size' => null], $vorgabeTest);
assert($teilUebersteuert === $vorgabeTest,
    'ein FREMDES Feld (is_locked gehoert der Region) und ein EXPLIZITES null aendern nichts: '
    . json_encode($teilUebersteuert));
$pruefungen += 4;

// --- Nodix (Owner-Bestellung 30.08.2026): KEINE Vorgabe der Art, genau wie is_locked/curve_label
// bei der Region -- eine Handeingabe ist die einzige Quelle, die es je auf "an" setzt.
assert(!array_key_exists('is_nodix', avesmapsGaretienLabelUebersteuerung(null, $vorgabeTest)),
    'ohne Handeingabe steht is_nodix gar nicht in der Uebersteuerung');
$mitNodix = avesmapsGaretienLabelUebersteuerung(['is_nodix' => true], $vorgabeTest);
assert(($mitNodix['is_nodix'] ?? null) === true, 'eine Handeingabe setzt is_nodix: ' . json_encode($mitNodix));
$pruefungen += 2;

// --- Reine Funktion: avesmapsGaretienRegionUebersteuerung -- KEINE Vorgabe der Art fuer diese
// beiden Felder, deshalb kein zweiter Parameter und ein leeres Ergebnis ohne Handeingabe.
assert(avesmapsGaretienRegionUebersteuerung(null) === [], 'ohne Handeingabe: leer');
assert(avesmapsGaretienRegionUebersteuerung(['is_locked' => null, 'curve_label' => null]) === [],
    'explizite nulls zaehlen wie "nicht genannt"');
assert(avesmapsGaretienRegionUebersteuerung(['is_locked' => true, 'curve_label' => true, 'curve_label_max' => 2])
    === ['is_locked' => true, 'curve_label' => true, 'curve_label_max' => 2],
    'alle drei Felder reisen durch, wenn sie genannt sind');
$pruefungen += 3;

/** Ein nach()-Rumpf fuer eine FLAECHE (Polygon), wie garetien-plan.php ihn baut -- hier von Hand. */
$bauePolygonEintrag = static function (string $subtyp, string $kind, string $name, array $ring): array {
    return [
        'entity_key' => 'ggp:Probe:region:' . $name,
        'entity_public_id' => null,
        'change_type' => 'new',
        'label' => $name . ' (Probe)',
        'before' => [],
        'after' => [
            'herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Probe', 'typ' => 'Probe',
            'ziel' => 'region', 'subtyp' => $subtyp, 'kind' => $kind, 'name' => $name,
            'geometry' => ['type' => 'Polygon', 'coordinates' => [$ring]],
            'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:' . $name,
                'label' => 'Briefspiel (Garetien)', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de'],
            'urteil' => 'neu', 'anlass' => null, 'nachbar' => null,
        ],
        'override' => [],
        'selected' => 1,
    ];
};
$testRing = [[750.0, 750.0], [770.0, 750.0], [770.0, 770.0], [750.0, 770.0], [750.0, 750.0]];

// --- Vor jeder Handeingabe: der gespeicherte Rechenstand der Einstellungstafel (Fenster
// "Landschaften -> Darstellung") -- er darf nach dem Einfuegen ZEICHENGLEICH derselbe sein. Ein
// zweiter Schreiber auf dieser Tafel waere genau der Fehler, den der Auftrag ausdruecklich
// ausschliesst ("darf die Einstellungstafel NICHT verändern -- die gehört dem
// Landschaften-Editor").
$tafelVorher = $pdoNeu->query("SELECT setting_value FROM app_setting WHERE setting_key = 'ecosystem_display'")->fetchColumn();

// --- Die FLAECHE ("Testteich") MIT VOLLER Handeingabe -- alle sieben Felder, die der Kasten
// kennt. 'huegelland' hat KEINE gespeicherte Uebersteuerung in dieser Fixture (nur berggipfel/
// vulkan tragen eine, siehe oben) -- die Vorgabe der Art ist hier also der reine Grundwert, und
// jede der sieben Zahlen/Haken unten muss NUR aus der Handeingabe stammen.
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $bauePolygonEintrag('huegelland', 'topographie', 'Testteich', $testRing));
$teichItemId = $itemIdVon($pdoNeu, 'Testteich (Probe)');
$teichEinstellungen = [
    'size' => 30, 'priority' => 5, 'min_zoom' => 1, 'max_zoom' => 4, 'show_name' => false,
    'is_locked' => true, 'curve_label' => true, 'curve_label_max' => 2, 'is_nodix' => true,
];
$eTeich = avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$teichItemId], ['id' => 7], $teichEinstellungen);
assert($eTeich['angelegt'] === 1 && $eTeich['fehler'] === [],
    'die Flaeche mit Handeingabe wird angelegt: ' . json_encode($eTeich, JSON_UNESCAPED_UNICODE));
$pruefungen++;

$teichRegion = $pdoNeu->query("SELECT * FROM ecosystem_region WHERE name = 'Testteich'")->fetch(PDO::FETCH_ASSOC);
assert($teichRegion !== false, 'die Region des Teichs steht da');
$teichLabel = $pdoNeu->query('SELECT * FROM map_features WHERE public_id = '
    . $pdoNeu->quote((string) $teichRegion['label_public_id']))->fetch(PDO::FETCH_ASSOC);
assert($teichLabel !== false, 'und sein Label existiert');
$pruefungen += 2;

// --- DIE TRAGENDE ZUSICHERUNG: ein GEÄNDERTER Wert kommt beim Server an und wird geschrieben --
// belegt am ERGEBNIS (der gespeicherten Zeile), nicht daran, dass irgendwo ein <input> stand.
$teichLabelProps = json_decode((string) $teichLabel['properties_json'], true);
assert(($teichLabelProps['size'] ?? null) === 30, 'die Handeingabe setzt die Groesse: ' . json_encode($teichLabelProps));
assert(($teichLabelProps['priority'] ?? null) === 5, 'und die Prioritaet: ' . json_encode($teichLabelProps));
assert(($teichLabelProps['min_zoom'] ?? null) === 1, 'und den Start-Zoom: ' . json_encode($teichLabelProps));
assert(($teichLabelProps['max_zoom'] ?? null) === 4, 'und den End-Zoom: ' . json_encode($teichLabelProps));
assert(($teichLabelProps['show_name'] ?? null) === false, 'und "Auf Karte anzeigen": ' . json_encode($teichLabelProps));
assert(($teichLabelProps['is_nodix'] ?? null) === true, 'und Nodix: ' . json_encode($teichLabelProps));
assert((int) $teichRegion['is_locked'] === 1, '"für Klicks gesperrt" steht an der Region: ' . json_encode($teichRegion));
$teichRegionProps = json_decode((string) $teichRegion['properties_json'], true);
assert(($teichRegionProps['curve_label'] ?? null) === true, 'die Kurvenbeschreibung steht: ' . json_encode($teichRegionProps));
assert(($teichRegionProps['curve_label_max'] ?? null) === 2, 'mit ihrer Anzahl: ' . json_encode($teichRegionProps));
$pruefungen += 8;

// --- DIFFERENTIELL: eine ANDERE Flaeche OHNE Handeingabe (derselbe Aufruf wie bisher, kein
// fuenfter Parameter) bleibt beim Grundwert -- sonst waere "Testteich" nur zufaellig richtig und
// die Handeingabe wirkte in Wahrheit global.
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $bauePolygonEintrag('huegelland', 'topographie', 'Testteich Zwei',
    [[790.0, 790.0], [805.0, 790.0], [805.0, 805.0], [790.0, 805.0], [790.0, 790.0]]));
$teich2ItemId = $itemIdVon($pdoNeu, 'Testteich Zwei (Probe)');
$eTeich2 = avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$teich2ItemId], ['id' => 7]);
assert($eTeich2['angelegt'] === 1 && $eTeich2['fehler'] === [],
    'die Flaeche OHNE Handeingabe wird ebenfalls angelegt: ' . json_encode($eTeich2, JSON_UNESCAPED_UNICODE));
$teich2Region = $pdoNeu->query("SELECT * FROM ecosystem_region WHERE name = 'Testteich Zwei'")->fetch(PDO::FETCH_ASSOC);
assert((int) $teich2Region['is_locked'] === 0, 'ohne Handeingabe bleibt is_locked beim Grundwert 0: ' . json_encode($teich2Region));
assert(!str_contains((string) $teich2Region['properties_json'], 'curve_label'),
    'und curve_label bleibt ganz WEG: ' . var_export($teich2Region['properties_json'], true));
$teich2Label = $pdoNeu->query('SELECT properties_json FROM map_features WHERE public_id = '
    . $pdoNeu->quote((string) $teich2Region['label_public_id']))->fetch(PDO::FETCH_ASSOC);
$teich2LabelProps = json_decode((string) $teich2Label['properties_json'], true);
assert(($teich2LabelProps['size'] ?? null) === 18, 'und die Groesse bleibt der Grundwert 18: ' . json_encode($teich2LabelProps));
assert(($teich2LabelProps['is_nodix'] ?? null) === false,
    'ohne Handeingabe bleibt Nodix beim Grundwert "aus": ' . json_encode($teich2LabelProps));
$pruefungen += 5;

// --- DER BERGGIPFEL MIT HANDEINGABE -- dieselben vier Zahlen + show_name, aber kein is_locked/
// curve_label (ein Berggipfel haengt an keiner ecosystem_region). 'berggipfel' traegt in dieser
// Fixture eine gespeicherte Uebersteuerung (ab=2/bis=6/prio=4/size=17, siehe oben) -- die
// Handeingabe unten MUSS diese trotzdem schlagen, sonst gewinnt "Vorgabe der Art" fälschlich
// gegen eine ausdrueckliche Handeingabe.
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $bauePunktEintrag('label', 'berggipfel', 'Testgipfel Zwei', 650.0, 650.0));
$gipfel2ItemId = $itemIdVon($pdoNeu, 'Testgipfel Zwei (Probe)');
$eGipfel2 = avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$gipfel2ItemId], ['id' => 7], [
    'size' => 22, 'priority' => 1, 'min_zoom' => 0, 'max_zoom' => 3, 'show_name' => false,
    'is_nodix' => true,
    'is_locked' => true, // muss IGNORIERT werden -- ein Berggipfel-Label kennt kein is_locked
]);
assert($eGipfel2['angelegt'] === 1 && $eGipfel2['fehler'] === [],
    'der Gipfel mit Handeingabe wird angelegt: ' . json_encode($eGipfel2, JSON_UNESCAPED_UNICODE));
$gipfel2Zeile = $pdoNeu->query("SELECT properties_json FROM map_features WHERE name = 'Testgipfel Zwei'")->fetch(PDO::FETCH_ASSOC);
$gipfel2Props = json_decode((string) $gipfel2Zeile['properties_json'], true);
assert(($gipfel2Props['size'] ?? null) === 22, 'die Handeingabe schlaegt die gespeicherte Uebersteuerung der Art (17): '
    . json_encode($gipfel2Props));
assert(($gipfel2Props['priority'] ?? null) === 1 && ($gipfel2Props['min_zoom'] ?? null) === 0
    && ($gipfel2Props['max_zoom'] ?? null) === 3 && ($gipfel2Props['show_name'] ?? null) === false,
    'und die uebrigen vier Felder ebenso: ' . json_encode($gipfel2Props));
assert(($gipfel2Props['is_nodix'] ?? null) === true,
    'Nodix gilt auch fuer ein Berggipfel-Label, das an keiner Region haengt: ' . json_encode($gipfel2Props));
$pruefungen += 4;

// --- 🔴 DIE TRAGENDE REGEL DES SERVERS: EIN UNSINNIGER WERT WIRD ABGELEHNT, AUCH WENN DER
// BROWSER IHN DURCHLIESSE. `max_zoom < min_zoom` ist fuer ein NEUES Label keine gueltige Aussage
// (anders als bei der Darstellungstafel, wo es "aus" bedeutet) -- avesmapsCreateLabelFeature wirft,
// avesmapsGaretienLabelUebersteuerung validiert VORSAETZLICH NICHTS vor.
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, $bauePunktEintrag('label', 'berggipfel', 'Testgipfel Unsinn', 660.0, 660.0));
$gipfelUnsinnItemId = $itemIdVon($pdoNeu, 'Testgipfel Unsinn (Probe)');
$eGipfelUnsinn = avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$gipfelUnsinnItemId], ['id' => 7], [
    'min_zoom' => 5, 'max_zoom' => 1,
]);
assert($eGipfelUnsinn['angelegt'] === 0, 'ein unsinniger Wert (bis < ab) legt NICHTS an: '
    . json_encode($eGipfelUnsinn, JSON_UNESCAPED_UNICODE));
assert(count($eGipfelUnsinn['fehler']) === 1, 'und der Fehlschlag steht im Ergebnis: '
    . json_encode($eGipfelUnsinn, JSON_UNESCAPED_UNICODE));
assert((int) $pdoNeu->query("SELECT COUNT(*) FROM map_features WHERE name = 'Testgipfel Unsinn'")->fetchColumn() === 0,
    'und es steht wirklich nichts in map_features');
$pruefungen += 3;

// --- Und die Einstellungstafel selbst ist von alledem ZEICHENGLEICH unberuehrt geblieben -- kein
// zweiter Schreiber auf `app_setting.ecosystem_display`.
$tafelNachher = $pdoNeu->query("SELECT setting_value FROM app_setting WHERE setting_key = 'ecosystem_display'")->fetchColumn();
assert($tafelNachher === $tafelVorher, 'die Einstellungstafel bleibt nach einer Handeingabe unveraendert');
$pruefungen++;

// --- 💣 DIE ERGAENZUNG DARF KEIN FELD LOESCHEN, DAS SIE NICHT NENNT. avesmapsUpdatePointFeatureDetails
// ist KEIN Teil-Update (siehe Kommentar am Anwender) -- is_ruined/is_hidden reisen unbedingt mit dem
// Bestand mit. Ein vorhandener Ort mit is_ruined=true bekommt hier nur eine Namensaenderung.
$pdoNeu->exec("INSERT INTO map_features (public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json)
               VALUES ('00000000-0000-4000-8000-0000000ac0de', 'location', 'dorf', 'Altes Dorf', 'Point',
                       '{\"type\":\"Point\",\"coordinates\":[10,10]}', '{\"is_ruined\":true,\"place_kind\":\"bruecke\"}')");
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, [
    'entity_key' => 'ggp:Probe:location:Altes-Dorf:ergaenzung',
    'entity_public_id' => '00000000-0000-4000-8000-0000000ac0de',
    'change_type' => 'changed',
    'label' => 'Neuer Name -> Altes Dorf · umbenennen',
    'before' => ['public_id' => '00000000-0000-4000-8000-0000000ac0de', 'name' => 'Altes Dorf'],
    'after' => [
        'herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Probe', 'typ' => 'Probe',
        'ziel' => 'location', 'subtyp' => 'dorf', 'kind' => null, 'name' => 'Neuer Name',
        'felder' => ['name'], 'anlass' => 'umbenennung',
        'geometry' => ['type' => 'Point', 'coordinates' => [10.0, 10.0]],
        'quelle' => [], 'urteil' => 'Test', 'nachbar' => null,
    ],
    'override' => [],
    'selected' => 1,
]);
$ergOrtId = $itemIdVon($pdoNeu, 'Neuer Name -> Altes Dorf · umbenennen');
$eErgOrt = avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$ergOrtId], ['id' => 7]);
assert($eErgOrt['fehler'] === [], 'die Umbenennung des Ortes gelingt: ' . json_encode($eErgOrt, JSON_UNESCAPED_UNICODE));
$ortNachher = $pdoNeu->query("SELECT name, properties_json FROM map_features WHERE public_id = '00000000-0000-4000-8000-0000000ac0de'")->fetch(PDO::FETCH_ASSOC);
assert($ortNachher['name'] === 'Neuer Name', 'der neue Name steht: ' . $ortNachher['name']);
assert(str_contains($ortNachher['properties_json'], '"is_ruined":true'),
    'is_ruined bleibt erhalten -- die Ergaenzung darf es nicht stillschweigend loeschen: ' . $ortNachher['properties_json']);
assert(str_contains($ortNachher['properties_json'], 'bruecke'),
    'place_kind bleibt ebenfalls erhalten: ' . $ortNachher['properties_json']);
$pruefungen += 3;

// --- Dieselbe Ergaenzung fuer den Berggipfel: Umbenennen darf den Subtyp nicht veraendern.
$pdoNeu->exec("INSERT INTO map_features (public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json)
               VALUES ('00000000-0000-4000-8000-0000000be9fe', 'label', 'berggipfel', 'Alter Gipfel', 'Point',
                       '{\"type\":\"Point\",\"coordinates\":[20,20]}', '{}')");
avesmapsSyncPlanAddItem($pdoNeu, $laufNeu, [
    'entity_key' => 'ggp:Probe:label:Alter-Gipfel:ergaenzung',
    'entity_public_id' => '00000000-0000-4000-8000-0000000be9fe',
    'change_type' => 'changed',
    'label' => 'Neuer Gipfelname -> Alter Gipfel · umbenennen',
    'before' => ['public_id' => '00000000-0000-4000-8000-0000000be9fe', 'name' => 'Alter Gipfel'],
    'after' => [
        'herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Probe', 'typ' => 'Probe',
        'ziel' => 'label', 'subtyp' => 'berggipfel', 'kind' => null, 'name' => 'Neuer Gipfelname',
        'felder' => ['name'], 'anlass' => 'umbenennung',
        'geometry' => ['type' => 'Point', 'coordinates' => [20.0, 20.0]],
        'quelle' => [], 'urteil' => 'Test', 'nachbar' => null,
    ],
    'override' => [],
    'selected' => 1,
]);
$ergBergId = $itemIdVon($pdoNeu, 'Neuer Gipfelname -> Alter Gipfel · umbenennen');
$eErgBerg = avesmapsGaretienUebernehmen($pdoNeu, $laufNeu, [$ergBergId], ['id' => 7]);
assert($eErgBerg['fehler'] === [], 'die Umbenennung des Gipfels gelingt: ' . json_encode($eErgBerg, JSON_UNESCAPED_UNICODE));
$bergNachher = $pdoNeu->query("SELECT name, feature_subtype FROM map_features WHERE public_id = '00000000-0000-4000-8000-0000000be9fe'")->fetch(PDO::FETCH_ASSOC);
assert($bergNachher['name'] === 'Neuer Gipfelname', 'der neue Gipfelname steht: ' . $bergNachher['name']);
assert($bergNachher['feature_subtype'] === 'berggipfel', 'der Subtyp bleibt berggipfel: ' . $bergNachher['feature_subtype']);
$pruefungen += 2;

// --- Und die Ruecknahme eines NEU angelegten Ortes: derselbe generische Loeschweg wie beim Weg.
$rOrt = avesmapsGaretienRuecknahmeAusfuehren($pdoNeu, $laufNeu, [$ortItemId], ['id' => 7]);
assert($rOrt['zurueckgenommen'] === 1 && $rOrt['fehler'] === [], 'der neu angelegte Ort laesst sich zuruecknehmen: ' . json_encode($rOrt));
$ortAktivNach = (int) $pdoNeu->query("SELECT is_active FROM map_features WHERE public_id = '" . $ortZeile['public_id'] . "'")->fetchColumn();
assert($ortAktivNach === 0, 'der Ort ist nach der Ruecknahme still gelegt');
$pruefungen += 2;

// --- Und ein neu angelegter Berggipfel ebenso.
$rBerg = avesmapsGaretienRuecknahmeAusfuehren($pdoNeu, $laufNeu, [$bergItemId], ['id' => 7]);
assert($rBerg['zurueckgenommen'] === 1 && $rBerg['fehler'] === [], 'der neu angelegte Gipfel laesst sich zuruecknehmen: ' . json_encode($rBerg));
$pruefungen++;

// =================================================================================================
// SCHADENSFALL 30.08.2026: `apply` SKOPIERT AUF EINE AUSDRUECKLICHE ID-LISTE, NICHT AUF DEN
// GANZEN LAUF. Owner: „Eine Warnung gabs nicht … hat unsere ganze karte zerstoert." "Alle
// angezeigten einfuegen" hat 3007 statt der angezeigten rund 100 Objekte uebernommen, weil das
// ungeskopierte avesmapsGaretienApplyStep ALLE `selected = 1`-Zeilen des Laufs liest -- Altbestand
// aus frueheren Klicks und die Vorbelegung eingeschlossen.
//
// 🔴 DIE ZUSICHERUNG, WOERTLICH AUS DEM AUFTRAG: ein Lauf mit FUENF vorgemerkten Objekten, davon
// ZWEI angezeigt, uebernimmt GENAU ZWEI -- nicht fuenf. Ohne diese Zusicherung ist die Aufgabe
// nicht erledigt.
//
// ⭐ EIN EIGENER, LEERER LAUF (avesmapsSyncPlanStartRun), nicht der von
// avesmapsGaretienUebernahmeTestPdo() schon mitgebrachte -- der traegt bereits Gardel/Muehlsee/
// Seitenarm mit unbekanntem Stand; die Zusicherung braucht FUENF Objekte mit BEKANNTEM Stand.
$pdoSkop = avesmapsGaretienUebernahmeTestPdo();
$laufSkop = avesmapsSyncPlanStartRun($pdoSkop, AVESMAPS_GARETIEN_PLAN_KIND, 1, 'test-id-skopierung');

$skopIds = [];
for ($i = 1; $i <= 5; $i++) {
    avesmapsSyncPlanAddItem($pdoSkop, $laufSkop,
        $bauePunktEintrag('location', 'dorf', 'Skop Ort ' . $i, 100.0 + $i, 100.0 + $i));
    $skopIds[] = $itemIdVon($pdoSkop, 'Skop Ort ' . $i . ' (Probe)');
}
assert(count(array_filter($skopIds, static fn(int $id): bool => $id > 0)) === 5,
    'alle fuenf Vorschlaege stehen im Lauf: ' . json_encode($skopIds));
$pruefungen++;

$offenVorSkop = (int) $pdoSkop->query(
    "SELECT COUNT(*) FROM sync_plan_item WHERE run_id = {$laufSkop} AND selected = 1 AND apply_state IS NULL"
)->fetchColumn();
assert($offenVorSkop === 5, 'fuenf vorgemerkte Objekte stehen im Lauf: ' . $offenVorSkop);
$pruefungen++;

// „Angezeigt" sind nur die ERSTEN ZWEI -- genau die ids, die eine Anzeige-Menge im Fenster
// weiterreichen wuerde (avesmapsGaretienApplyIdsAusRumpf liest sie unveraendert aus dem Rumpf).
$angezeigteIdsSkop = [$skopIds[0], $skopIds[1]];
$featuresVorSkop = (int) $pdoSkop->query('SELECT COUNT(*) FROM map_features')->fetchColumn();
$schrittSkop = avesmapsGaretienApplyStep($pdoSkop, $laufSkop, 7, ['id' => 7], null, $angezeigteIdsSkop);

assert($schrittSkop['applied'] === 2,
    '🔴 genau ZWEI angezeigte Objekte werden uebernommen, nicht alle fuenf vorgemerkten: ' . json_encode($schrittSkop));
assert($schrittSkop['processed'] === 2, 'verarbeitet wurden ebenfalls genau zwei: ' . json_encode($schrittSkop));
assert($schrittSkop['remaining'] === 0, 'fuer die SKOPIERTE Menge ist nichts mehr offen: ' . json_encode($schrittSkop));
assert($schrittSkop['done'] === true, 'und der Schritt gilt fuer diese Menge als fertig: ' . json_encode($schrittSkop));
$pruefungen += 4;

assert((int) $pdoSkop->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === $featuresVorSkop + 2,
    'genau ZWEI neue Kartenobjekte entstehen, nicht fuenf');
$pruefungen++;

// 🔴 DIE TRAGENDE GEGENPROBE: die drei NICHT angezeigten Vorschlaege bleiben UNVERAENDERT
// vorgemerkt -- weder geschrieben noch abgehakt. Genau das ist der Schaden vom 30.08.2026: ein
// Klick auf "Alle angezeigten einfuegen" (rund 100 Objekte) hat auch den unbeteiligten Altbestand
// mit uebernommen, weil die Skopierung fehlte.
$offenNachSkop = (int) $pdoSkop->query(
    "SELECT COUNT(*) FROM sync_plan_item WHERE run_id = {$laufSkop} AND selected = 1 AND apply_state IS NULL"
)->fetchColumn();
assert($offenNachSkop === 3, '🔴 die drei NICHT angezeigten Vorschlaege bleiben unangetastet vorgemerkt: ' . $offenNachSkop);
$pruefungen++;

foreach ([$skopIds[2], $skopIds[3], $skopIds[4]] as $unberuehrteId) {
    $zeile = $pdoSkop->query('SELECT apply_state, selected FROM sync_plan_item WHERE id = ' . $unberuehrteId)
        ->fetch(PDO::FETCH_ASSOC);
    assert($zeile['apply_state'] === null && (int) $zeile['selected'] === 1,
        'Item ' . $unberuehrteId . ' bleibt unangetastet vorgemerkt: ' . json_encode($zeile));
}
$pruefungen += 3;

for ($i = 3; $i <= 5; $i++) {
    $vorhandenSkop = (int) $pdoSkop->query(
        'SELECT COUNT(*) FROM map_features WHERE name = ' . $pdoSkop->quote('Skop Ort ' . $i)
    )->fetchColumn();
    assert($vorhandenSkop === 0, 'Skop Ort ' . $i . ' (nicht angezeigt) darf NICHT auf der Karte stehen: ' . $vorhandenSkop);
}
$pruefungen += 3;

// --- Und die Gegenprobe zur Gegenprobe: der ALTE, ungeskopierte Weg (`itemIds === null`) bleibt
// als Testpfad erreichbar (siehe die Doku an avesmapsGaretienApplyStep) und holt jetzt WIRKLICH
// den Rest -- der Altbestand ist also nicht verloren, nur bei der skopierten Uebernahme
// unberuehrt geblieben.
$schrittRestSkop = avesmapsGaretienApplyStep($pdoSkop, $laufSkop, 7, ['id' => 7]);
assert($schrittRestSkop['applied'] === 3, 'der unskopierte Weg erreicht danach die restlichen drei: '
    . json_encode($schrittRestSkop));
$pruefungen++;

// =================================================================================================
// avesmapsGaretienApplyIdsAusRumpf -- die REINE Pruefung des Endpunkt-Riegels (api/edit/wiki/
// sync-plan.php liest sie fuer kind='garetien' aus dem Anfragerumpf; ein leeres Ergebnis lehnt
// die Anfrage dort mit 400 ab, statt still auf den ganzen Lauf zurueckzufallen).
assert(avesmapsGaretienApplyIdsAusRumpf(['ids' => [3, 5, 7]]) === [3, 5, 7], 'die gewoehnliche Liste bleibt unveraendert');
assert(avesmapsGaretienApplyIdsAusRumpf(['ids' => ['3', '5', 5, -1, 0, 'x']]) === [3, 5],
    'Zeichenketten werden zu Zahlen, Dubletten/Nullen/Negative/Nicht-Zahlen fallen heraus');
assert(avesmapsGaretienApplyIdsAusRumpf([]) === [], 'ohne "ids" im Rumpf: leer (fehlende Angabe ist kein "alles")');
assert(avesmapsGaretienApplyIdsAusRumpf(['ids' => 'kein-array']) === [], 'ein Nicht-Array wird verworfen, nicht geraten');
assert(avesmapsGaretienApplyIdsAusRumpf(['ids' => []]) === [], 'eine leere Liste bleibt leer');
$pruefungen += 5;

// =================================================================================================
// MELDUNG (30.08.2026): „Übernommen (312) -- mach die rückgängig". `avesmapsGaretienRuecknahmeAusfuehren`
// liess bis dahin GENAU 'new'-Items zu; alle 312 gemeldeten Objekte sind 'changed'-Items mit
// `felder: ['quelle']` -- ein bestehendes Objekt bekam NUR eine Quellenangabe angehängt, nichts an
// Name oder Geometrie wurde berührt (avesmapsGaretienErgaenzungAnwenden tut in diesem Fall
// ausschliesslich avesmapsGaretienQuelleAnlegen). Diese Sektion prüft die ENGERE, nicht die
// AUFGEHOBENE Regel: rücknehmbar wird GENAU DAS, nicht jedes 'changed'-Item.
//
// Eigener, ISOLIERTER Pruefstand (wie Aufgabe 12) -- die Zaehler der vorigen Abschnitte duerfen
// unberuehrt bleiben.
$pdoQ = avesmapsGaretienUebernahmeTestPdo();
$laufQ = (int) avesmapsSyncPlanOpenRun($pdoQ, AVESMAPS_GARETIEN_PLAN_KIND)['id'];

// --- 1. Der Normalfall: ein WEG (entity_type='path'), 'quelle'-only -- die Verknuepfung geht weg,
//        das Objekt UND eine fremde 'manual'-Verknuepfung DERSELBEN Adresse bleiben unangetastet.
$idWegQ = '00000000-0000-4000-8000-000000009001';
$pdoQ->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idWegQ, 'Testpfad Quelle', 'path', 'Weg',
        json_encode(['type' => 'LineString', 'coordinates' => [[1.0, 1.0], [2.0, 2.0]]]),
        '{}', 'LineString']);

// Eine fremde, HANDGEPFLEGTE Verknuepfung derselben Adresse -- die Ruecknahme darf sie NICHT
// anfassen, auch wenn sie am selben Objekt haengt.
$manuelleSourceId = avesmapsFeatureSourceUpsert(
    $pdoQ, 'https://www.beispiel.de/handgepflegt', 'Handgepflegte Quelle', 'sonstiges', false, 1
);
avesmapsFeatureSourceLink($pdoQ, 'path', $idWegQ, $manuelleSourceId, 1, 'manual');

avesmapsSyncPlanAddItem($pdoQ, $laufQ, [
    'entity_key' => 'ggp:Probe:path:Testpfad-Quelle|ergaenzung|' . $idWegQ,
    'entity_public_id' => $idWegQ,
    'change_type' => 'changed',
    'label' => 'Testpfad Quelle · Quelle',
    'before' => ['public_id' => $idWegQ, 'name' => 'Testpfad Quelle'],
    'after' => ['herkunft' => 'garetien', 'anlass' => 'ergaenzung', 'felder' => ['quelle'],
        'ziel' => 'path', 'subtyp' => 'Weg',
        'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:Testpfad',
            'label' => 'Briefspiel (Garetien)', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de'],
        // Wie ein echter Plan sie mitfuehrt (avesmapsGaretienPlanEintrag) -- ein Geschwister von
        // 'quelle', keine Unterangabe darin.
        'seite_url' => 'https://www.garetien.de/index.php?title=Benutzer:VolkoV/MapSVG/Avesmaps_Garetien:Testpfad'],
    'override' => [], 'selected' => 1,
]);
$itemWegQ = $itemIdVon($pdoQ, 'Testpfad Quelle · Quelle');
$eWegQ = avesmapsGaretienUebernehmen($pdoQ, $laufQ, [$itemWegQ], ['id' => 7]);
assert($eWegQ['fehler'] === [], 'die Quellen-Ergaenzung des Wegs gelingt: ' . json_encode($eWegQ, JSON_UNESCAPED_UNICODE));
assert($eWegQ['quellen'] === 1,
    'EINE Quelle -- der Artikel; die Ergaenzung geht durch denselben Trichter wie das Anlegen '
    . 'und folgt damit derselben Weiche (01.09.2026): ' . $eWegQ['quellen']);
$pruefungen += 2;

// --- 💣 UND DAS IST DER ZWEITE ERZEUGER. Die Artikelquelle haengt am Anlegeweg UND hier;
// haette sie nur der Anlegeweg, bekaemen ausgerechnet die 312 reinen Quellen-Ergaenzungen sie nie.
// ⚠️ Dieses Item hat KEIN `after.artikel_quelle` -- es ist von Hand gebaut, wie ein Item aus
// einem Lauf von VOR dem 31.08.2026. Es belegt damit den Rueckfall ueber den entity_key, und der
// ist der Grund, warum der laufende Lauf des Owners nicht neu gerechnet werden muss.
assert(!isset($eWegQ['artikel_quelle']), 'Gegenprobe: das Item traegt selbst keine Artikelquelle');
$artikelWegQ = $pdoQ->query(
    "SELECT s.url, s.label FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
      WHERE fs.entity_type = 'path' AND s.url LIKE '%index.php/%'"
)->fetch(PDO::FETCH_ASSOC);
assert($artikelWegQ !== false, 'die Artikelquelle entstand aus dem Schluessel allein');
// 💣 DER SUFFIX HINTER `|` DARF NICHT IM ARTIKELNAMEN LANDEN. Der Schluessel dieses Items lautet
// `ggp:Probe:path:Testpfad-Quelle|ergaenzung|00000000-…` -- ohne avesmapsGaretienObjektSchluessel
// hiesse die Quelle „Testpfad-Quelle|ergaenzung|00000000-… auf garetien.de".
assert($artikelWegQ['label'] === 'Testpfad-Quelle auf garetien.de',
    'der Suffix hinter | faellt heraus: ' . var_export($artikelWegQ['label'], true));
assert(!str_contains((string) $artikelWegQ['url'], '|') && !str_contains((string) $artikelWegQ['url'], 'ergaenzung'),
    'und auch nicht in die Adresse: ' . var_export($artikelWegQ['url'], true));
$pruefungen += 4;

// --- 💣 DIE ERGAENZUNGS-FALLE: `quellen_neu` traegt die VOLLE Quellenliste des Objekts, nicht nur
// unsere. Owner-Meldung 31.08.2026: „ich hab ein moor importiert, aber es fehlt die 'quelle, die
// mitreist', erst wenn ich die seite komplett neulade stehts glaub dran" -- die geladene Seite
// haelt Katalog und Verweise als EINMALIGE Aufnahme vom Seitenstart, ein Kartenstempel erreicht
// sie nicht. Der Browser traegt sie deshalb per `syncFeatureSourcesToClientCache` nach.
//
// 🔴 UND JENE FUNKTION UEBERSCHREIBT DIE LISTE EINER ENTITAET. Schickte der Server hier nur die
// eben angelegte Quelle, verschwaende die HANDGEPFLEGTE oben aus der Anzeige -- derselbe Fehler
// wie der gemeldete, nur andersherum, und er faellt niemandem auf, weil die neue Quelle ja da
// steht. Genau dafuer haengt an diesem Weg seit dem Aufbau eine zweite, fremde Verknuepfung.
// ⚠️ Beim ANLEGEN waere der Unterschied unsichtbar (dort ist unsere die einzige Quelle) -- deshalb
// steht die Zusicherung HIER und nicht im Anlegepfad.
assert(isset($eWegQ['quellen_neu']) && is_array($eWegQ['quellen_neu']),
    'die Uebernahme meldet die beruehrten Objekte samt Quellen zurueck');
assert(count($eWegQ['quellen_neu']) === 1,
    'genau EIN beruehrtes Objekt, entdoppelt ueber typ:public_id: ' . json_encode($eWegQ['quellen_neu']));
$rueckWegQ = $eWegQ['quellen_neu'][0];
assert($rueckWegQ['entity_type'] === 'path' && $rueckWegQ['public_id'] === $idWegQ,
    'und es ist der richtige Weg: ' . json_encode($rueckWegQ));
$adressenWegQ = array_map(static fn(array $q): string => $q['url'], $rueckWegQ['sources']);
sort($adressenWegQ);
// 01.09.2026: es sind ZWEI statt drei -- der Import haengt nur noch den Artikel an, die
// Sammelquelle entfaellt. Die tragende Aussage bleibt dieselbe: die FREMDE, handgepflegte
// Verknuepfung reist mit zurueck. Ohne sie wuerde die Anzeige im Browser die fremde Quelle
// verlieren, sobald der Import eine eigene ergaenzt.
assert($adressenWegQ === [
        'https://www.beispiel.de/handgepflegt',
        'https://www.garetien.de/index.php/Testpfad-Quelle',
    ],
    'BEIDE reisen zurueck -- die eben angelegte UND die vorhandene handgepflegte: '
    . json_encode($adressenWegQ));
$pruefungen += 4;

// --- 💣 UND DIE LIZENZ REIST MIT. Sie traegt die Rechtsfolge (NOTICE.md), und der Leser in
// js/ui/feature-source-markup.js zeichnet den Lizenzbaustein aus GENAU diesen zwei Feldern. Ohne
// sie erschiene die Quelle ohne Lizenz -- also wie eine schlechter erfasste Quelle, nicht wie ein
// Anzeigefehler.
$unsereQ = null;
foreach ($rueckWegQ['sources'] as $eintragQ) {
    if (str_contains($eintragQ['url'], 'garetien.de')) { $unsereQ = $eintragQ; }
}
assert($unsereQ !== null, 'unsere Quelle steht in der Rueckgabe');
assert($unsereQ['license'] === 'cc-by-nc-sa-3.0' && $unsereQ['attribution'] === 'VolkoV / garetien.de',
    'Lizenz und Namensnennung reisen mit: ' . json_encode($unsereQ));
// ⚠️ Und `source_id` ist der Schluessel, unter dem der Browser den Katalog fuehrt -- ohne ihn
// verwirft syncFeatureSourcesToClientCache die Zeile stillschweigend.
assert(isset($unsereQ['source_id']) && (int) $unsereQ['source_id'] > 0,
    'die source_id reist mit -- ohne sie faellt die Zeile im Browser lautlos heraus');
$pruefungen += 3;

// --- 🔴 DIE VERKNUEPFUNG EINES ANDEREN ERZEUGERS BEKOMMT KEINE NOTIZ. Die manuelle Verknuepfung
// oben ging NICHT ueber avesmapsGaretienQuelleAnlegen -- origin='garetien' ist die einzige, die
// seite_url in note ablegt.
$notizGaretien = $pdoQ->prepare(
    "SELECT note FROM feature_sources WHERE entity_type = 'path' AND entity_public_id = ? AND origin = 'garetien'"
);
$notizGaretien->execute([$idWegQ]);
assert(
    $notizGaretien->fetchColumn() === 'https://www.garetien.de/index.php?title=Benutzer:VolkoV/MapSVG/Avesmaps_Garetien:Testpfad',
    'die garetien-Verknuepfung traegt die Export-Arbeitsseite als Notiz'
);
$notizManuell = $pdoQ->prepare(
    "SELECT note FROM feature_sources WHERE entity_type = 'path' AND entity_public_id = ? AND origin = 'manual'"
);
$notizManuell->execute([$idWegQ]);
assert($notizManuell->fetchColumn() === null, 'die manuelle Verknuepfung bekommt KEINE Notiz -- anderer Erzeuger');
$pruefungen += 2;

$zaehleGaretienLinks = static function (PDO $pdo, string $entityType, string $publicId) {
    $s = $pdo->prepare("SELECT COUNT(*) FROM feature_sources WHERE entity_type = ? AND entity_public_id = ? AND origin = 'garetien'");
    $s->execute([$entityType, $publicId]);

    return (int) $s->fetchColumn();
};
$zaehleManualLinks = static function (PDO $pdo, string $entityType, string $publicId) {
    $s = $pdo->prepare("SELECT COUNT(*) FROM feature_sources WHERE entity_type = ? AND entity_public_id = ? AND origin = 'manual'");
    $s->execute([$entityType, $publicId]);

    return (int) $s->fetchColumn();
};

assert($zaehleGaretienLinks($pdoQ, 'path', $idWegQ) === 1,
    'die EINE garetien-Verknuepfung steht nach der Uebernahme -- der Artikel');
assert($zaehleManualLinks($pdoQ, 'path', $idWegQ) === 1, 'und die manuelle Verknuepfung ebenso');
$pruefungen += 2;

$rWegQ = avesmapsGaretienRuecknahmeAusfuehren($pdoQ, $laufQ, [$itemWegQ], ['id' => 7]);
assert($rWegQ['zurueckgenommen'] === 1, 'die Ruecknahme des quelle-only-Items gelingt: ' . json_encode($rWegQ, JSON_UNESCAPED_UNICODE));
assert($rWegQ['fehler'] === [], 'ohne Fehler: ' . json_encode($rWegQ['fehler'], JSON_UNESCAPED_UNICODE));
$pruefungen += 2;

// 🔴 BEIDE sind weg. Die Ruecknahme loest alles mit `origin='garetien'` -- sie musste fuer die
// zweite Quelle nicht angefasst werden, und genau das ist der Grund, warum die Artikelquelle
// dieselbe Herkunft traegt statt einer eigenen.
assert($zaehleGaretienLinks($pdoQ, 'path', $idWegQ) === 0,
    '🔴 BEIDE garetien-Verknuepfungen sind WEG, auch die Artikelquelle');
assert($zaehleManualLinks($pdoQ, 'path', $idWegQ) === 1,
    '🔴 MISS DIE DIFFERENZ: die manuelle Verknuepfung DERSELBEN Quelle bleibt unangetastet');
$pruefungen += 2;

// 🔴 Die sources-ZEILE selbst bleibt stehen -- ein geteilter Katalog, kein Objekt-Eigentum.
$sourcesZeileNochStmt = $pdoQ->prepare('SELECT COUNT(*) FROM sources WHERE url = ?');
$sourcesZeileNochStmt->execute(['https://www.garetien.de/index.php/Testpfad-Quelle']);
assert((int) $sourcesZeileNochStmt->fetchColumn() === 1,
    '🔴 die sources-Zeile selbst wird NIEMALS geloescht -- geteilter Katalog, AGENTS.md §5');
$pruefungen++;

// Und das OBJEKT selbst ist gaenzlich unberuehrt -- weder Name noch is_active aendern sich.
$wegQNachher = $pdoQ->query("SELECT name, is_active FROM map_features WHERE public_id = " . $pdoQ->quote($idWegQ))
    ->fetch(PDO::FETCH_ASSOC);
assert($wegQNachher['name'] === 'Testpfad Quelle', 'der Name bleibt unveraendert -- niemals angefasst');
assert((int) $wegQNachher['is_active'] === 1, 'und das Objekt bleibt aktiv -- keine Loeschung');
$pruefungen += 2;

$itemWegQNachher = $pdoQ->query('SELECT apply_state, selected FROM sync_plan_item WHERE id = ' . $itemWegQ)
    ->fetch(PDO::FETCH_ASSOC);
assert($itemWegQNachher['apply_state'] === null, 'apply_state faellt zurueck auf NULL -- das Objekt steht wieder in "Offen"');
assert((int) $itemWegQNachher['selected'] === 1, 'selected ist wieder 1, wie vor der Uebernahme');
$pruefungen += 2;

// --- 2. Die ALTE Regel gilt UNVERAENDERT: 'name' zusammen mit 'quelle' bleibt gesperrt ----------
$idWegGemischtQ = '00000000-0000-4000-8000-000000009002';
$pdoQ->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idWegGemischtQ, '', 'path', 'Weg',
        json_encode(['type' => 'LineString', 'coordinates' => [[3.0, 3.0], [4.0, 4.0]]]),
        '{}', 'LineString']);
avesmapsSyncPlanAddItem($pdoQ, $laufQ, [
    'entity_key' => 'ggp:Probe:path:Testpfad-Gemischt|ergaenzung|' . $idWegGemischtQ,
    'entity_public_id' => $idWegGemischtQ,
    'change_type' => 'changed',
    'label' => 'Testpfad Gemischt · Name+Quelle',
    'before' => ['public_id' => $idWegGemischtQ, 'name' => ''],
    'after' => ['herkunft' => 'garetien', 'anlass' => 'ergaenzung', 'felder' => ['name', 'quelle'],
        'ziel' => 'path', 'subtyp' => 'Weg', 'name' => 'Testpfad Gemischt',
        'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:Gemischt',
            'label' => 'Briefspiel (Garetien)', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de']],
    'override' => [], 'selected' => 1,
]);
$itemGemischtQ = $itemIdVon($pdoQ, 'Testpfad Gemischt · Name+Quelle');
$eGemischtQ = avesmapsGaretienUebernehmen($pdoQ, $laufQ, [$itemGemischtQ], ['id' => 7]);
assert($eGemischtQ['fehler'] === [], 'die Ergaenzung selbst gelingt: ' . json_encode($eGemischtQ, JSON_UNESCAPED_UNICODE));
$pruefungen++;

$rGemischtQ = avesmapsGaretienRuecknahmeAusfuehren($pdoQ, $laufQ, [$itemGemischtQ], ['id' => 7]);
assert($rGemischtQ['zurueckgenommen'] === 0,
    '🔴 name+quelle bleibt GESPERRT -- die alte Regel gilt fuer alles ausser reinem "nur Quelle"');
assert(count($rGemischtQ['fehler']) === 1 && str_contains($rGemischtQ['fehler'][0]['grund'], 'nicht ruecknehmbar'),
    'mit demselben Grund wie zuvor: ' . json_encode($rGemischtQ, JSON_UNESCAPED_UNICODE));
$pruefungen += 2;

assert($zaehleGaretienLinks($pdoQ, 'path', $idWegGemischtQ) === 1,
    'die Quellen-Verknuepfung bleibt stehen -- die Ruecknahme hat sie nicht angefasst');
$itemGemischtQNachher = $pdoQ->query('SELECT apply_state FROM sync_plan_item WHERE id = ' . $itemGemischtQ)->fetchColumn();
assert($itemGemischtQNachher === 'done', 'das Item bleibt auf "done" stehen');
$pruefungen += 2;

// --- 3. Eine LANDSCHAFTSFLAECHE: die Verknuepfung haengt an der BESCHRIFTUNG, nicht der Region --
$idSeeQLabel = '00000000-0000-4000-8000-000000009101';
$idSeeQRegion = '00000000-0000-4000-8000-000000009102';
$pdoQ->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idSeeQLabel, 'Testquellsee', 'label', 'seen', json_encode(['type' => 'Point', 'coordinates' => [70.0, 70.0]]), '{}', 'Point']);
$pdoQ->exec("INSERT INTO ecosystem_region (public_id, name, kind, region_type, label_public_id, is_active)
             VALUES ('{$idSeeQRegion}', 'Testquellsee', 'topographie', 'see', '{$idSeeQLabel}', 1)");

avesmapsSyncPlanAddItem($pdoQ, $laufQ, [
    'entity_key' => 'ggp:Gewaesser:See:Garetien:Testquellsee!Testquellsee|ergaenzung|' . $idSeeQRegion,
    'entity_public_id' => $idSeeQRegion,
    'change_type' => 'changed',
    'label' => 'Testquellsee · Quelle',
    'before' => ['public_id' => $idSeeQRegion, 'name' => 'Testquellsee'],
    'after' => ['herkunft' => 'garetien', 'anlass' => 'ergaenzung', 'felder' => ['quelle'],
        'ziel' => 'region', 'subtyp' => 'see', 'kind' => 'topographie',
        'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:Testquellsee',
            'label' => 'Briefspiel (Garetien)', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de']],
    'override' => [], 'selected' => 1,
]);
$itemSeeQ = $itemIdVon($pdoQ, 'Testquellsee · Quelle');
$eSeeQ = avesmapsGaretienUebernehmen($pdoQ, $laufQ, [$itemSeeQ], ['id' => 7]);
assert($eSeeQ['fehler'] === [], 'die Quellen-Ergaenzung der Flaeche gelingt: ' . json_encode($eSeeQ, JSON_UNESCAPED_UNICODE));
$pruefungen++;

assert($zaehleGaretienLinks($pdoQ, 'region', $idSeeQLabel) === 1,
    'die Verknuepfung haengt an der BESCHRIFTUNG (Label-public_id)');
assert($zaehleGaretienLinks($pdoQ, 'region', $idSeeQRegion) === 0,
    'und NICHT an der Regions-public_id');
$pruefungen += 2;

$rSeeQ = avesmapsGaretienRuecknahmeAusfuehren($pdoQ, $laufQ, [$itemSeeQ], ['id' => 7]);
assert($rSeeQ['zurueckgenommen'] === 1, 'die Ruecknahme der Flaechen-Quelle gelingt: ' . json_encode($rSeeQ, JSON_UNESCAPED_UNICODE));
assert($rSeeQ['fehler'] === [], 'ohne Fehler: ' . json_encode($rSeeQ['fehler'], JSON_UNESCAPED_UNICODE));
$pruefungen += 2;

assert($zaehleGaretienLinks($pdoQ, 'region', $idSeeQLabel) === 0,
    '🔴 DIE ZUSICHERUNG AUS DEM AUFTRAG: die Ruecknahme findet die Verknuepfung an der BESCHRIFTUNG, '
    . 'nicht an einem geratenen ID-Raum, und entfernt genau sie');
$pruefungen++;

$labelSeeQNachher = $pdoQ->query('SELECT is_active FROM map_features WHERE public_id = ' . $pdoQ->quote($idSeeQLabel))->fetchColumn();
$regionSeeQNachher = $pdoQ->query('SELECT is_active FROM ecosystem_region WHERE public_id = ' . $pdoQ->quote($idSeeQRegion))->fetchColumn();
assert((int) $labelSeeQNachher === 1, 'die Beschriftung bleibt aktiv -- keine Loeschung');
assert((int) $regionSeeQNachher === 1, 'die Region bleibt aktiv -- keine Loeschung');
$pruefungen += 2;

// --- 4. Zwei quelle-only-Items EINES mehrteiligen Wegs, in EINEM Ruecknahme-Aufruf -- derselbe
//        Aufruf, den ein Klick auf „Zuruecknehmen" fuer ein Objekt mit mehreren Abschnitten
//        ausloest (js/review/review-garetien-importer.js: garetienRuecknahmeItems).
$idAbschnittEinsQ = '00000000-0000-4000-8000-000000009201';
$idAbschnittZweiQ = '00000000-0000-4000-8000-000000009202';
foreach ([$idAbschnittEinsQ, $idAbschnittZweiQ] as $i => $id) {
    $pdoQ->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
        ->execute([$id, 'Reichsstrasse Zwei', 'path', 'Reichsstrasse',
            json_encode(['type' => 'LineString', 'coordinates' => [[10.0 + $i, 10.0], [11.0 + $i, 11.0]]]),
            '{}', 'LineString']);
    avesmapsSyncPlanAddItem($pdoQ, $laufQ, [
        'entity_key' => 'ggp:Weg:Reichsstrasse:Garetien:ReichsstrasseZwei!ReichsstrasseZwei|ergaenzung|' . $id,
        'entity_public_id' => $id,
        'change_type' => 'changed',
        'label' => 'Reichsstrasse Zwei Abschnitt ' . ($i + 1) . ' · Quelle',
        'before' => ['public_id' => $id, 'name' => 'Reichsstrasse Zwei'],
        'after' => ['herkunft' => 'garetien', 'anlass' => 'ergaenzung', 'felder' => ['quelle'],
            'ziel' => 'path', 'subtyp' => 'Reichsstrasse',
            'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:ReichsstrasseZwei',
                'label' => 'Briefspiel (Garetien)', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de']],
        'override' => [], 'selected' => 1,
    ]);
}
$itemAbschnittEinsQ = $itemIdVon($pdoQ, 'Reichsstrasse Zwei Abschnitt 1 · Quelle');
$itemAbschnittZweiQ = $itemIdVon($pdoQ, 'Reichsstrasse Zwei Abschnitt 2 · Quelle');
$eBeideQ = avesmapsGaretienUebernehmen($pdoQ, $laufQ, [$itemAbschnittEinsQ, $itemAbschnittZweiQ], ['id' => 7]);
assert($eBeideQ['fehler'] === [], 'beide Abschnitte werden ergaenzt: ' . json_encode($eBeideQ, JSON_UNESCAPED_UNICODE));
$pruefungen++;

// 🔴 EIN Ruecknahme-Aufruf mit BEIDEN ids -- genau das, was ein einzelner Klick auf "Zuruecknehmen"
// fuer dieses Objekt gemaess garetienRuecknahmeItems() verschickt.
$rBeideQ = avesmapsGaretienRuecknahmeAusfuehren($pdoQ, $laufQ, [$itemAbschnittEinsQ, $itemAbschnittZweiQ], ['id' => 7]);
assert($rBeideQ['zurueckgenommen'] === 2, 'BEIDE Items gehen in EINEM Aufruf zurueck: ' . json_encode($rBeideQ, JSON_UNESCAPED_UNICODE));
assert($rBeideQ['fehler'] === [], 'ohne Fehler: ' . json_encode($rBeideQ['fehler'], JSON_UNESCAPED_UNICODE));
$pruefungen += 2;

assert($zaehleGaretienLinks($pdoQ, 'path', $idAbschnittEinsQ) === 0, 'Abschnitt 1 ist quellenlos');
assert($zaehleGaretienLinks($pdoQ, 'path', $idAbschnittZweiQ) === 0, 'Abschnitt 2 ebenso');
$pruefungen += 2;

// --- 5. Idempotenz: die Verknuepfung ist schon weg (z.B. ueber den globalen Aufraeum-Knopf) --
//        die Ruecknahme darf trotzdem gelingen, statt einen Fehlschlag vorzutaeuschen.
$idWegLeerQ = '00000000-0000-4000-8000-000000009301';
$pdoQ->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idWegLeerQ, 'Testpfad Bereits Bereinigt', 'path', 'Weg',
        json_encode(['type' => 'LineString', 'coordinates' => [[5.0, 5.0], [6.0, 6.0]]]),
        '{}', 'LineString']);
avesmapsSyncPlanAddItem($pdoQ, $laufQ, [
    'entity_key' => 'ggp:Probe:path:Testpfad-Bereinigt|ergaenzung|' . $idWegLeerQ,
    'entity_public_id' => $idWegLeerQ,
    'change_type' => 'changed',
    'label' => 'Testpfad Bereits Bereinigt · Quelle',
    'before' => ['public_id' => $idWegLeerQ, 'name' => 'Testpfad Bereits Bereinigt'],
    'after' => ['herkunft' => 'garetien', 'anlass' => 'ergaenzung', 'felder' => ['quelle'],
        'ziel' => 'path', 'subtyp' => 'Weg',
        'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:Bereinigt',
            'label' => 'Briefspiel (Garetien)', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de']],
    'override' => [], 'selected' => 1,
]);
$itemLeerQ = $itemIdVon($pdoQ, 'Testpfad Bereits Bereinigt · Quelle');
$eLeerQ = avesmapsGaretienUebernehmen($pdoQ, $laufQ, [$itemLeerQ], ['id' => 7]);
assert($eLeerQ['fehler'] === [], 'die Ergaenzung gelingt: ' . json_encode($eLeerQ, JSON_UNESCAPED_UNICODE));
$pruefungen++;

// Der globale Aufraeum-Knopf (oder eine andere Sitzung) war schneller: die Verknuepfung ist schon weg.
$pdoQ->exec("DELETE FROM feature_sources WHERE entity_type = 'path' AND entity_public_id = '{$idWegLeerQ}' AND origin = 'garetien'");
assert($zaehleGaretienLinks($pdoQ, 'path', $idWegLeerQ) === 0, 'die Verknuepfung ist vorab weg -- simuliert den globalen Aufraeum-Knopf');
$pruefungen++;

$rLeerQ = avesmapsGaretienRuecknahmeAusfuehren($pdoQ, $laufQ, [$itemLeerQ], ['id' => 7]);
assert($rLeerQ['zurueckgenommen'] === 1,
    '🔴 KEIN FEHLER, WENN NICHTS DA IST: das Item faellt trotzdem zurueck nach "offen": '
    . json_encode($rLeerQ, JSON_UNESCAPED_UNICODE));
assert($rLeerQ['fehler'] === [], 'ohne Fehler: ' . json_encode($rLeerQ['fehler'], JSON_UNESCAPED_UNICODE));
$pruefungen += 2;

// =================================================================================================
// DER KARTENSTEMPEL -- ohne ihn erreicht eine uebernommene Quelle KEINEN Browser
// =================================================================================================
//
// 💣 DER BEFUND (Owner 30.08.2026, an einem importierten Moor: "ganz wichtig war die quelle").
// avesmapsFeatureSourceLink ist der reine Schreiber und hebt die Kartenrevision NICHT -- alle vier
// Hauspfade in api/_internal/app/feature-sources.php rufen avesmapsNextMapRevision selbst. Dieser
// Import tat es nicht. Ein Item, das NUR eine Quelle ergaenzt, aendert kein Kartenobjekt: die
// Revision blieb stehen, der ETag damit auch, und jeder warme Browser bekam sein 304 samt alter
// Nutzlast. Seit dem 27.08.2026 liegt die Nutzlast zusaetzlich in IndexedDB -- es heilt also nicht
// einmal durch Neuladen.
//
// ⭐ Messbar ist das hier NUR, weil die Treiber-Naht oben avesmapsNextMapRevision uebersetzt
// (ON DUPLICATE KEY UPDATE -> ON CONFLICT). Der Produktivcode bleibt MySQL, wie im Kopf begruendet.
$revisionVon = static function (PDO $pdo): int {
    return (int) ($pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn() ?: 0);
};

$pdoR = avesmapsGaretienUebernahmeTestPdo();
$laufR = (int) avesmapsSyncPlanOpenRun($pdoR, AVESMAPS_GARETIEN_PLAN_KIND)['id'];
$idWegR = '00000000-0000-4000-8000-00000000a001';
$pdoR->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idWegR, 'Stempelpfad', 'path', 'Weg',
        json_encode(['type' => 'LineString', 'coordinates' => [[1.0, 1.0], [2.0, 2.0]]]),
        '{}', 'LineString']);

// --- 1. Eine Ergaenzung, die NUR die Quelle schreibt, hebt die Revision --------------------------
avesmapsSyncPlanAddItem($pdoR, $laufR, [
    'entity_key' => 'ggp:Probe:path:Stempelpfad|ergaenzung|' . $idWegR,
    'entity_public_id' => $idWegR,
    'change_type' => 'changed',
    'label' => 'Stempelpfad · Quelle',
    'before' => ['public_id' => $idWegR, 'name' => 'Stempelpfad'],
    'after' => ['herkunft' => 'garetien', 'anlass' => 'ergaenzung', 'felder' => ['quelle'],
        'ziel' => 'path', 'subtyp' => 'Weg',
        'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:Stempelpfad',
            'label' => 'Briefspiel (Garetien)', 'license' => 'cc-by-nc-sa-3.0',
            'attribution' => 'VolkoV / garetien.de']],
    'override' => [], 'selected' => 1,
]);
$itemR = $itemIdVon($pdoR, 'Stempelpfad · Quelle');
$revVorher = $revisionVon($pdoR);
$eR = avesmapsGaretienUebernehmen($pdoR, $laufR, [$itemR], ['id' => 7]);
assert($eR['fehler'] === [] && $eR['quellen'] === 1,
    'die Quellen-Ergaenzung gelingt, der Artikel: ' . json_encode($eR, JSON_UNESCAPED_UNICODE));
assert($revisionVon($pdoR) > $revVorher,
    '🔴 EINE UEBERNAHME, DIE NUR EINE QUELLE SCHREIBT, MUSS DIE KARTENREVISION HEBEN -- sonst '
    . 'bekommt jeder warme Browser sein 304 samt alter Nutzlast und sieht die Quelle NIE');
$pruefungen += 2;

// --- 2. Ein Lauf, der NICHTS geschrieben hat, hebt sie NICHT -------------------------------------
// 🔴 Ein Stempel ohne Schreibvorgang entwertet die Kopie JEDES Besuchers (rund 3 MB je
// Wiederbesuch) fuer nichts. Die leere Auswahl steigt schon vorher aus; hier zaehlt der Fall
// DAHINTER: ein Item, das der Apply als "braucht eine Entscheidung von Hand" ablegt.
avesmapsSyncPlanAddItem($pdoR, $laufR, [
    'entity_key' => 'ggp:Probe:path:Stempelpfad|widerspruch|' . $idWegR,
    'entity_public_id' => $idWegR,
    'change_type' => 'changed',
    'label' => 'Stempelpfad · Widerspruch',
    'before' => ['public_id' => $idWegR, 'name' => 'Stempelpfad'],
    'after' => ['herkunft' => 'garetien', 'anlass' => 'widerspruch', 'felder' => [],
        'ziel' => 'path', 'subtyp' => 'Weg'],
    'override' => [], 'selected' => 1,
]);
$itemStale = $itemIdVon($pdoR, 'Stempelpfad · Widerspruch');
$revVorStale = $revisionVon($pdoR);
$eStale = avesmapsGaretienUebernehmen($pdoR, $laufR, [$itemStale], ['id' => 7]);
assert($eStale['angelegt'] === 0 && $eStale['quellen'] === 0,
    'der Widerspruch schreibt nichts: ' . json_encode($eStale, JSON_UNESCAPED_UNICODE));
assert($revisionVon($pdoR) === $revVorStale,
    'ein Lauf ohne Schreibvorgang darf die Revision NICHT heben -- er entwertet sonst die '
    . 'Kartenkopie jedes Besuchers fuer nichts');
$pruefungen += 2;

// --- 3. Und eine leere Auswahl erst recht nicht ---------------------------------------------------
$revVorLeer = $revisionVon($pdoR);
avesmapsGaretienUebernehmen($pdoR, $laufR, [], ['id' => 7]);
assert($revisionVon($pdoR) === $revVorLeer, 'eine leere Auswahl hebt die Revision nicht');
$pruefungen++;


// =================================================================================================
// „Ort bearbeiten" im Kasten „Eingefuegt wird" (Owner 30.08.2026: „ja mach ort bearbeiten, dann
// weg bearbeiten"). Bis dahin war der Ort-Abschnitt reine ANZEIGE; einstellbar sind jetzt genau
// die Felder, die avesmapsCreatePointFeature wirklich in properties_json schreibt.
//
// 🔴 GEPRUEFT WIRD, DASS ES GENAU DIESE VIER SIND. Ein Regler auf einem Feld, das die Anlage gar
// nicht liest, waere ein Bedienelement, das nichts tut -- und von einem, das wirkt, von aussen
// nicht zu unterscheiden. is_nodix/is_ruined/is_hidden stehen fest im $properties-Rumpf von
// avesmapsCreatePointFeature, place_kind nur, wenn es nach der Normalisierung nicht leer ist.
// =================================================================================================
assert(avesmapsGaretienOrtUebersteuerung(null) === [], 'ohne Handeingabe: leer -- der Import setzt dann gar nichts');
assert(avesmapsGaretienOrtUebersteuerung([]) === [], 'ein leerer Rumpf ist ebenfalls keine Aussage');
assert(avesmapsGaretienOrtUebersteuerung(['is_nodix' => null, 'place_kind' => null]) === [],
    'explizite nulls zaehlen wie "nicht genannt" -- dieselbe Regel wie bei Region und Label');
$pruefungen += 3;

$ortVoll = avesmapsGaretienOrtUebersteuerung([
    'is_nodix' => true, 'is_ruined' => true, 'is_hidden' => true, 'place_kind' => 'Bruecke',
]);
assert($ortVoll === ['is_nodix' => true, 'is_ruined' => true, 'is_hidden' => true, 'place_kind' => 'Bruecke'],
    'alle vier Felder reisen durch, wenn sie genannt sind: ' . json_encode($ortVoll));
$pruefungen++;

// 💣 Die drei Haken werden zu ECHTEN Bools gecastet, nicht durchgereicht -- ein "0" aus einem
// alten, zwischengespeicherten Client waere sonst `true`. Dieselbe Behandlung wie bei
// avesmapsGaretienLabelUebersteuerung('show_name').
$ortRoh = avesmapsGaretienOrtUebersteuerung(['is_nodix' => '0', 'is_ruined' => 1, 'is_hidden' => '']);
assert($ortRoh['is_nodix'] === false, 'die Zeichenkette "0" wird false: ' . json_encode($ortRoh));
assert($ortRoh['is_ruined'] === true, 'die Zahl 1 wird true: ' . json_encode($ortRoh));
assert($ortRoh['is_hidden'] === false, 'die leere Zeichenkette wird false: ' . json_encode($ortRoh));
$pruefungen += 3;

// ⚠️ place_kind reist als ZEICHENKETTE durch, ungeprueft -- avesmapsNormalizePlaceKind in
// avesmapsCreatePointFeature ist die letzte Instanz und rastet auf den Ortsarten-Katalog ein
// (api/_internal/wiki/place-kinds.php). Eine zweite Normalisierung hier waere die zweite Wahrheit
// ueber diesen Katalog -- genau die Doppelung, die AGENTS.md §5 verbietet.
$ortArt = avesmapsGaretienOrtUebersteuerung(['place_kind' => '  Gibtsnicht  ']);
assert($ortArt === ['place_kind' => '  Gibtsnicht  '],
    'place_kind reist unveraendert, der Anleger entscheidet: ' . json_encode($ortArt));
// 🔴 Eine LEERE Art reist mit, statt weggelassen zu werden -- avesmapsCreatePointFeature setzt den
// Schluessel dann ohnehin nicht. Wuerde "" hier verschluckt, haette die Uebersteuerung zwei
// Bedeutungen fuer denselben Wert ("nicht genannt" und "ausdruecklich keine Art").
assert(avesmapsGaretienOrtUebersteuerung(['place_kind' => '']) === ['place_kind' => ''],
    'eine leere Art reist mit; der Anleger laesst den Schluessel dann weg');
$pruefungen += 2;

// =================================================================================================
// „Weg bearbeiten" im Kasten „Eingefuegt wird" (Owner 30.08.2026: „dann weg bearbeiten").
//
// 🔴 GENAU ZWEI FELDER, und auch sie sind nicht frei gewaehlt: avesmapsCreatePathFeature liest aus
// dem Anfragerumpf NUR `show_label` und `allowed_transports` (plus Name/Art/Geometrie).
// `transport_seasons` steht ueberhaupt nicht in seinem $properties-Rumpf, `transport_domain` wird
// aus der Wegart abgeleitet -- ein Bedienelement dafuer waere eines, das nichts tut.
// =================================================================================================
assert(avesmapsGaretienWegUebersteuerung(null) === [], 'ohne Handeingabe: leer');
assert(avesmapsGaretienWegUebersteuerung([]) === [], 'ein leerer Rumpf ist keine Aussage');
assert(avesmapsGaretienWegUebersteuerung(['show_label' => null, 'allowed_transports' => null]) === [],
    'explizite nulls zaehlen wie "nicht genannt"');
$pruefungen += 3;

assert(avesmapsGaretienWegUebersteuerung(['show_label' => '1']) === ['show_label' => true],
    'show_label wird zu einem echten Bool gecastet');
$pruefungen++;

// 🔴 EINE LEERE LISTE IST EINE AUSSAGE UND REIST MIT. Sie bedeutet „kein Verkehrsmittel darf hier
// fahren"; verschluckt wuerde sie, faellt avesmapsReadAllowedTransports auf die Vorauswahl der
// Wegart zurueck -- also auf genau das Gegenteil dessen, was der Editor angehakt (bzw. abgehakt)
// hat. Das Fenster warnt sichtbar davor, aber es verhindert es nicht.
assert(avesmapsGaretienWegUebersteuerung(['allowed_transports' => []]) === ['allowed_transports' => []],
    'eine LEERE Verkehrsmittel-Liste reist mit, statt zur Vorauswahl zurueckzufallen');
$pruefungen++;

// ⚠️ Was KEINE Liste ist, wird verworfen statt durchgereicht: avesmapsReadAllowedTransports pruefte
// zwar selbst auf `is_array`, aber ein durchgereichter Unsinn saehe im Protokoll wie eine
// getroffene Auswahl aus. Die sichere Richtung ist „nicht genannt" -- dann gilt die Vorauswahl.
assert(avesmapsGaretienWegUebersteuerung(['allowed_transports' => 'groupFoot']) === [],
    'ein Nicht-Array wird verworfen, nicht durchgereicht');
$pruefungen++;

// ⚠️ Die Werte selbst bleiben ungeprueft -- avesmapsReadAllowedTransports ist die letzte Instanz
// und wirft alles weg, was fuer die Domaene der Wegart nicht in Frage kommt. Eine zweite
// Vertraeglichkeitspruefung hier waere die zweite Wahrheit ueber die Verkehrsmittel-Tafel.
$wegVoll = avesmapsGaretienWegUebersteuerung([
    'show_label' => true, 'allowed_transports' => ['riverSailer', 'gibtsnicht'],
]);
assert($wegVoll === ['show_label' => true, 'allowed_transports' => ['riverSailer', 'gibtsnicht']],
    'beide Felder reisen durch, die Werte ungeprueft: ' . json_encode($wegVoll));
$pruefungen++;
// =================================================================================================
// DER NACHZUG (Owner 31.08.2026: „go, und ja mach den nachzug"). Alles, was dieser Import schon
// angelegt hat, bekommt seine Artikelquelle nachtraeglich -- und seine tote Arbeitsseite geheilt.
//
// 🔴 Eigener, ISOLIERTER Pruefstand: hier wird zuerst mit ABGESCHALTETER Artikelquelle
// uebernommen (ein Item ohne Artikel im Schluessel), damit es ueberhaupt etwas nachzutragen gibt.
// =================================================================================================
$pdoN = avesmapsGaretienUebernahmeTestPdo();
$laufN = (int) avesmapsSyncPlanOpenRun($pdoN, AVESMAPS_GARETIEN_PLAN_KIND)['id'];

// --- Ein Objekt, das es schon gibt, mit einer Quellen-Ergaenzung, deren Item KEINEN Artikel nennt
// (Schluessel endet auf `#417`) -- so entsteht der Zustand „uebernommen, aber ohne Artikelquelle",
// den es vor dem 31.08.2026 fuer JEDES Objekt gab.
$idOhneArtikel = '00000000-0000-4000-8000-00000000b001';
$pdoN->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idOhneArtikel, 'Namenloser Pfad', 'path', 'Pfad',
        json_encode(['type' => 'LineString', 'coordinates' => [[1.0, 1.0], [2.0, 2.0]]]), '{}', 'LineString']);
avesmapsSyncPlanAddItem($pdoN, $laufN, [
    'entity_key' => 'ggp:Wege:Pfad:#417',
    'entity_public_id' => $idOhneArtikel,
    'change_type' => 'changed',
    'label' => 'Namenloser Pfad · Quelle',
    'before' => ['public_id' => $idOhneArtikel, 'name' => 'Namenloser Pfad'],
    'after' => ['herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Wege', 'anlass' => 'ergaenzung',
        'felder' => ['quelle'], 'ziel' => 'path', 'subtyp' => 'Pfad',
        'quelle' => ['url' => 'https://www.garetien.de', 'label' => 'Briefspiel (Garetien)',
            'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de'],
        'seite_url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Wege'],
    'override' => [], 'selected' => 1,
]);
$eOhne = avesmapsGaretienUebernehmen($pdoN, $laufN, [$itemIdVon($pdoN, 'Namenloser Pfad · Quelle')], ['id' => 7]);
assert($eOhne['quellen'] === 1, 'ohne Artikel im Schluessel bleibt es bei EINER Quelle: ' . $eOhne['quellen']);
$pruefungen++;

// --- Und ein Objekt, das die Artikelquelle SCHON hat (der Normalfall nach dem 31.08.2026).
$idMitArtikel = '00000000-0000-4000-8000-00000000b002';
$pdoN->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idMitArtikel, 'Alter Weg', 'path', 'Weg',
        json_encode(['type' => 'LineString', 'coordinates' => [[3.0, 3.0], [4.0, 4.0]]]), '{}', 'LineString']);
avesmapsSyncPlanAddItem($pdoN, $laufN, [
    'entity_key' => 'ggp:Wege:Weg:Garetien:Alter Weg!Alter Weg',
    'entity_public_id' => $idMitArtikel,
    'change_type' => 'changed',
    'label' => 'Alter Weg · Quelle',
    'before' => ['public_id' => $idMitArtikel, 'name' => 'Alter Weg'],
    'after' => ['herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Wege', 'anlass' => 'ergaenzung',
        'felder' => ['quelle'], 'ziel' => 'path', 'subtyp' => 'Weg',
        'quelle' => ['url' => 'https://www.garetien.de', 'label' => 'Briefspiel (Garetien)',
            'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de'],
        // 💣 DIE TOTE ARBEITSSEITE, wie jedes Item aus einem Lauf vor dem 31.08.2026 sie traegt.
        'seite_url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Garetien:Alter_Weg'],
    'override' => [], 'selected' => 1,
]);
avesmapsGaretienUebernehmen($pdoN, $laufN, [$itemIdVon($pdoN, 'Alter Weg · Quelle')], ['id' => 7]);

// --- 💣 DIE TOTE ADRESSE WIRD GEHEILT, OHNE DASS JEMAND DEN NACHZUG RUFT. Die Uebernahme rechnet
// die Arbeitsseite aus `wiki`+`ebene` neu, statt `after.seite_url` zu glauben -- sonst schriebe der
// laufende Lauf des Owners (8213 Zeilen, alle vor dem 31.08. gebaut) die 404-Adresse weiter fort.
$notizAlt = $pdoN->query("SELECT note FROM feature_sources WHERE entity_public_id = '$idMitArtikel' LIMIT 1")->fetchColumn();
assert($notizAlt === AVESMAPS_GARETIEN_BASIS_GGP . 'Wege',
    'die Arbeitsseite wurde neu gerechnet, nicht aus dem alten after uebernommen: ' . var_export($notizAlt, true));
$pruefungen++;

$zaehleArtikel = static function (PDO $pdo, string $publicId): int {
    $s = $pdo->prepare("SELECT COUNT(*) FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
                         WHERE fs.entity_public_id = :id AND s.url LIKE '%/index.php/%'");
    $s->execute([':id' => $publicId]);

    return (int) $s->fetchColumn();
};
assert($zaehleArtikel($pdoN, $idOhneArtikel) === 0, 'der namenlose Pfad hat KEINE Artikelquelle');
assert($zaehleArtikel($pdoN, $idMitArtikel) === 1, 'der alte Weg hat sie schon');
$pruefungen += 2;

// --- 🔴 UND JETZT EIN ITEM, DAS DEN ZUSTAND VOR DEM 31.08.2026 NACHSTELLT: uebernommen, mit
// Artikel im Schluessel, aber die Artikelquelle von Hand wieder entfernt.
$idNachzug = '00000000-0000-4000-8000-00000000b003';
$pdoN->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idNachzug, 'Praioslob Probe', 'location', 'stadt',
        json_encode(['type' => 'Point', 'coordinates' => [5.0, 5.0]]), '{}', 'Point']);
avesmapsSyncPlanAddItem($pdoN, $laufN, [
    'entity_key' => 'ggp:Ortschaften_3:Stadt:Garetien:Stadt Praioslob!Stadt Praioslob',
    'entity_public_id' => $idNachzug,
    'change_type' => 'changed',
    'label' => 'Praioslob Probe · Quelle',
    'before' => ['public_id' => $idNachzug, 'name' => 'Praioslob Probe'],
    'after' => ['herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Ortschaften_3', 'anlass' => 'ergaenzung',
        'felder' => ['quelle'], 'ziel' => 'location', 'subtyp' => 'stadt',
        'quelle' => ['url' => 'https://www.garetien.de', 'label' => 'Briefspiel (Garetien)',
            'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de'],
        'seite_url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Ortschaften_3'],
    'override' => [], 'selected' => 1,
]);
avesmapsGaretienUebernehmen($pdoN, $laufN, [$itemIdVon($pdoN, 'Praioslob Probe · Quelle')], ['id' => 7]);
$pdoN->exec("DELETE FROM feature_sources WHERE entity_public_id = '$idNachzug'
              AND source_id IN (SELECT id FROM (SELECT id FROM sources WHERE url LIKE '%/index.php/%') x)");
assert($zaehleArtikel($pdoN, $idNachzug) === 0, 'der Pruefstand steht: die Artikelquelle ist weg');
$pruefungen++;

// --- DER LAUF.
$n1 = avesmapsGaretienArtikelQuellenNachtragen($pdoN);
assert($n1['geschrieben'] === 1,
    'genau EIN Objekt bekommt sie nachgetragen: ' . json_encode($n1));
assert($zaehleArtikel($pdoN, $idNachzug) === 1, 'und es hat sie jetzt');
// 🔴 DER NAMENLOSE PFAD BLEIBT UNBERUEHRT -- ohne Artikel gibt es nichts nachzutragen, und ein
// „#417 auf garetien.de" waere die schlimmere Antwort als gar keine.
assert($zaehleArtikel($pdoN, $idOhneArtikel) === 0, 'ein Objekt ohne Artikel bekommt keine erfundene Quelle');
$pruefungen += 3;

// --- Die Beschriftung ist die des Artikels, nicht die des Objekts.
$nachzugLabel = $pdoN->query("SELECT s.label FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
                               WHERE fs.entity_public_id = '$idNachzug' AND s.url LIKE '%/index.php/%'")->fetchColumn();
assert($nachzugLabel === 'Stadt Praioslob auf garetien.de',
    'die nachgetragene Quelle traegt den Artikelnamen aus dem Schluessel: ' . var_export($nachzugLabel, true));
$pruefungen++;

// --- 🔴 IDEMPOTENT: ein zweiter Lauf schreibt NICHTS mehr. Das ist die Bedingung, unter der er
// am Ende jedes abgeschlossenen Uebernahme-Vorgangs mitlaufen darf -- ohne den Uebersprung-Riegel
// kostete er dort bis zu 8213 Schreibvorgaenge fuer nichts.
$n2 = avesmapsGaretienArtikelQuellenNachtragen($pdoN);
assert($n2['geschrieben'] === 0, 'ein zweiter Lauf schreibt nichts mehr: ' . json_encode($n2));
assert($zaehleArtikel($pdoN, $idNachzug) === 1, 'und legt nichts doppelt an');
$pruefungen += 2;

// --- 💣 BEIDE ITEM-ARTEN, und das ist der Punkt, an dem die halbe Menge still durchfallen
// wuerde: bei einem 'new'-Item steht die angelegte public_id in `apply_note`, bei einem 'changed'
// in `entity_public_id`. Wer nur eine der beiden liest, traegt die Haelfte nach und merkt es nicht.
$idNeu = '00000000-0000-4000-8000-00000000b004';
$pdoN->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idNeu, 'Neuling', 'path', 'Weg',
        json_encode(['type' => 'LineString', 'coordinates' => [[7.0, 7.0], [8.0, 8.0]]]), '{}', 'LineString']);
avesmapsSyncPlanAddItem($pdoN, $laufN, [
    'entity_key' => 'ggp:Wege:Weg:Garetien:Neuling!Neuling',
    'entity_public_id' => null,
    'change_type' => 'new',
    'label' => 'Neuling (Probe)',
    'before' => [],
    'after' => ['herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Wege', 'ziel' => 'path',
        'subtyp' => 'Weg', 'name' => 'Neuling', 'urteil' => 'neu', 'anlass' => null],
    'override' => [], 'selected' => 1,
]);
// Von Hand auf 'done' setzen, mit der angelegten id im Vermerk -- genau so, wie die Uebernahme es
// fuer ein 'new'-Item tut.
avesmapsGaretienItemAbschliessen($pdoN, $itemIdVon($pdoN, 'Neuling (Probe)'), 'done', $idNeu, 7);
assert($zaehleArtikel($pdoN, $idNeu) === 0, 'der Pruefstand steht: der Neuling hat noch keine');
$n3 = avesmapsGaretienArtikelQuellenNachtragen($pdoN);
assert($n3['geschrieben'] === 1, 'auch ein \'new\'-Item wird erreicht: ' . json_encode($n3));
assert($zaehleArtikel($pdoN, $idNeu) === 1,
    'die public_id eines \'new\'-Items steht in apply_note, nicht in entity_public_id');
$pruefungen += 3;

// --- ⚠️ EIN OBJEKT, DAS ES NICHT MEHR GIBT, HAELT DEN NACHZUG NICHT AN.
$pdoN->exec("DELETE FROM map_features WHERE public_id = '$idNeu'");
$n4 = avesmapsGaretienArtikelQuellenNachtragen($pdoN);
assert($n4['geschrieben'] === 0 && is_int($n4['geprueft']),
    'ein geloeschtes Objekt wird uebersprungen, nicht geworfen: ' . json_encode($n4));
$pruefungen++;

// =================================================================================================
// 🔴 DIE RUECKNAHME VERGISST AUCH DEN DAUERHAFTEN VERMERK -- sonst wirkt sie nicht
// =================================================================================================
// Der Fehler war der Preis fuer die Reparatur vom 30.08.2026: seit `sync_decision.applied_at` die
// Uebernahme den Lauf ueberleben laesst, setzte die Ruecknahme zwar `sync_plan_item` zurueck --
// aber nicht diesen Vermerk. `avesmapsGaretienListeObjektStand` liest BEIDE („zwei Wege zu
// uebernommen"), und der dauerhafte gewinnt.
//
// 💣 DAS FEHLERBILD: das Objekt verschwindet von der Karte und bleibt trotzdem im Reiter
// „Uebernommen" stehen. Die Ruecknahme sah aus, als haette sie nicht gewirkt -- und der Reiter
// „Offen" bekam die Zeile nie zurueck.
$pdoV = avesmapsGaretienUebernahmeTestPdo();
$laufV = (int) avesmapsSyncPlanOpenRun($pdoV, AVESMAPS_GARETIEN_PLAN_KIND)['id'];
$idV = '00000000-0000-4000-8000-0000000d0001';
$pdoV->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idV, 'Vermerkweg', 'path', 'Weg',
        json_encode(['type' => 'LineString', 'coordinates' => [[1.0, 1.0], [2.0, 2.0]]]), '{}', 'LineString']);
avesmapsSyncPlanAddItem($pdoV, $laufV, [
    'entity_key' => 'ggp:Wege:Weg:Garetien:Vermerkweg!Vermerkweg',
    'entity_public_id' => $idV,
    'change_type' => 'changed',
    'label' => 'Vermerkweg \u00b7 Quelle',
    'before' => ['public_id' => $idV, 'name' => 'Vermerkweg'],
    'after' => ['herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Wege', 'anlass' => 'ergaenzung',
        'felder' => ['quelle'], 'ziel' => 'path', 'subtyp' => 'Weg',
        'quelle' => ['url' => 'https://www.garetien.de', 'label' => 'Briefspiel (Garetien)',
            'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de'],
        'seite_url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Wege'],
    'override' => [], 'selected' => 1,
]);
$itemV = $itemIdVon($pdoV, 'Vermerkweg \u00b7 Quelle');
$vermerkV = static fn(PDO $pdo): ?string => ($w = $pdo->query(
    "SELECT applied_at FROM sync_decision WHERE kind = 'garetien' AND entity_key = 'ggp:Wege:Weg:Garetien:Vermerkweg!Vermerkweg'"
)->fetchColumn()) === false ? null : ($w === null ? null : (string) $w);

avesmapsGaretienUebernehmen($pdoV, $laufV, [$itemV], ['id' => 7]);
assert($vermerkV($pdoV) !== null, 'nach der Uebernahme steht der dauerhafte Vermerk');
$pruefungen++;

$rV = avesmapsGaretienRuecknahmeAusfuehren($pdoV, $laufV, [$itemV], ['id' => 7]);
assert($rV['zurueckgenommen'] === 1, 'die Ruecknahme gelingt: ' . json_encode($rV));
assert($vermerkV($pdoV) === null,
    '🔴 und sie loescht den dauerhaften Vermerk MIT -- sonst bliebe das Objekt in "Uebernommen"');
$pruefungen += 2;

// ⚠️ DIE ZEILE BLEIBT STEHEN, nur die zwei Spalten sind leer. Sie kann eine Ablehnung tragen
// (`declined_at`), und ein DELETE naehme die mit -- genau das braucht die Ablehnung eines
// uebernommenen Objekts (Owner 31.08.2026), die Ruecknahme und Ablehnung nacheinander tut.
$zeilenV = (int) $pdoV->query(
    "SELECT COUNT(*) FROM sync_decision WHERE kind = 'garetien' AND entity_key = 'ggp:Wege:Weg:Garetien:Vermerkweg!Vermerkweg'"
)->fetchColumn();
assert($zeilenV === 1, 'die Entscheidungszeile bleibt stehen, nur die Spalten sind leer: ' . $zeilenV);
$pruefungen++;

// 💣 UND DAS OBJEKT IST WIRKLICH WIEDER OFFEN -- am STAND gemessen, nicht an der Spalte. Ohne
// diese Zeile belegt der Abschnitt nur, dass ein Feld leer ist; die Frage des Owners war aber, in
// welchem Reiter die Zeile steht.
$standV = avesmapsGaretienArbeitsliste($pdoV, 0, [])['reiter'] ?? [];
assert(($standV['uebernommen'] ?? -1) === 0,
    'kein Objekt steht mehr in "Uebernommen": ' . json_encode($standV));
$pruefungen++;

// --- Und die Gegenprobe: OHNE Ruecknahme steht es dort sehr wohl.
$idW = '00000000-0000-4000-8000-0000000d0002';
$pdoV->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idW, 'Bleibtweg', 'path', 'Weg',
        json_encode(['type' => 'LineString', 'coordinates' => [[3.0, 3.0], [4.0, 4.0]]]), '{}', 'LineString']);
avesmapsSyncPlanAddItem($pdoV, $laufV, [
    'entity_key' => 'ggp:Wege:Weg:Garetien:Bleibtweg!Bleibtweg',
    'entity_public_id' => $idW,
    'change_type' => 'changed',
    'label' => 'Bleibtweg \u00b7 Quelle',
    'before' => ['public_id' => $idW, 'name' => 'Bleibtweg'],
    'after' => ['herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Wege', 'anlass' => 'ergaenzung',
        'felder' => ['quelle'], 'ziel' => 'path', 'subtyp' => 'Weg',
        'quelle' => ['url' => 'https://www.garetien.de', 'label' => 'Briefspiel (Garetien)',
            'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de'],
        'seite_url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Wege'],
    'override' => [], 'selected' => 1,
]);
avesmapsGaretienUebernehmen($pdoV, $laufV, [$itemIdVon($pdoV, 'Bleibtweg \u00b7 Quelle')], ['id' => 7]);
$standW = avesmapsGaretienArbeitsliste($pdoV, 0, [])['reiter'] ?? [];
assert(($standW['uebernommen'] ?? 0) === 1,
    'ein nicht zurueckgenommenes Objekt steht sehr wohl in "Uebernommen" -- sonst prueft die Zeile '
    . 'darueber eine Konstante: ' . json_encode($standW));
$pruefungen++;

// =================================================================================================
// 🔴 ZURUECK NACH „OFFEN" -- und die zweite Quelle von „uebernommen"
// =================================================================================================
// Owner 31.08.2026: „wir wollen aber 'Übernommen' zurück nach 'Offen' verschieben können."
//
// 💣 „UEBERNOMMEN" HAT ZWEI QUELLEN, UND DIE ZWEITE WAR DER FALL DES OWNERS.
// `apply_state = 'done'` gilt nur fuer den GERADE laufenden Lauf; der dauerhafte Vermerk in
// `sync_decision.applied_at` ueberlebt ein „Holen & Rechnen". Nach einem neuen Lauf stehen die
// Items auf `apply_state = null` und das Objekt trotzdem in „Uebernommen" -- wer nur die erste
// Quelle liest, verschiebt NICHTS und meldet trotzdem Erfolg. Genau das ist passiert: sein
// „Praioslob" zeigte „Uebernommen" und hatte keinen Ausgang.
$pdoZ = avesmapsGaretienUebernahmeTestPdo();
$laufZ = (int) avesmapsSyncPlanOpenRun($pdoZ, AVESMAPS_GARETIEN_PLAN_KIND)['id'];
$idZ = '00000000-0000-4000-8000-0000000e0001';
$pdoZ->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idZ, 'Praioslob', 'location', 'stadt',
        json_encode(['type' => 'Point', 'coordinates' => [5.0, 5.0]]), '{}', 'Point']);

$baueZ = static function (PDO $pdo, int $lauf, string $label, string $key, string $publicId, string $changeType): void {
    avesmapsSyncPlanAddItem($pdo, $lauf, [
        'entity_key' => $key,
        'entity_public_id' => $changeType === 'new' ? null : $publicId,
        'change_type' => $changeType,
        'label' => $label,
        'before' => $changeType === 'new' ? [] : ['public_id' => $publicId, 'name' => 'Praioslob'],
        'after' => ['herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Ortschaften_3',
            'anlass' => 'ergaenzung', 'felder' => ['quelle'], 'ziel' => 'location', 'subtyp' => 'stadt',
            'quelle' => ['url' => 'https://www.garetien.de', 'label' => 'Briefspiel (Garetien)'],
            'seite_url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Ortschaften_3'],
        'override' => [], 'selected' => 1,
    ]);
};

// --- Der Fall des Owners: das Item ist FRISCH (apply_state = NULL), der dauerhafte Vermerk steht.
$baueZ($pdoZ, $laufZ, 'Praioslob \u00b7 Quelle', 'ggp:Ortschaften_3:Stadt:Garetien:Stadt Praioslob!Stadt Praioslob', $idZ, 'changed');
$itemZ = $itemIdVon($pdoZ, 'Praioslob \u00b7 Quelle');
avesmapsSyncPlanRecordApplied($pdoZ, AVESMAPS_GARETIEN_PLAN_KIND,
    'ggp:Ortschaften_3:Stadt:Garetien:Stadt Praioslob!Stadt Praioslob', 7, 'changed');
$standVorher = (string) $pdoZ->query("SELECT apply_state FROM sync_plan_item WHERE id = $itemZ")->fetchColumn();
assert($standVorher === '', 'die Vorbedingung: das Item ist frisch, nicht "done" -- ' . var_export($standVorher, true));
$vermerkVorher = $pdoZ->query(
    "SELECT applied_at FROM sync_decision WHERE kind = 'garetien' AND entity_key = 'ggp:Ortschaften_3:Stadt:Garetien:Stadt Praioslob!Stadt Praioslob'"
)->fetchColumn();
assert($vermerkVorher !== false && $vermerkVorher !== null, 'und der dauerhafte Vermerk steht');
$pruefungen += 2;

$zZ = avesmapsGaretienZurueckAufOffen($pdoZ, $laufZ, [$itemZ], ['id' => 7]);
assert($zZ['verschoben'] === 1,
    '🔴 ein Objekt, das NUR ueber den dauerhaften Vermerk uebernommen ist, wandert auch zurueck: '
    . json_encode($zZ));
$vermerkNachher = $pdoZ->query(
    "SELECT applied_at FROM sync_decision WHERE kind = 'garetien' AND entity_key = 'ggp:Ortschaften_3:Stadt:Garetien:Stadt Praioslob!Stadt Praioslob'"
)->fetchColumn();
assert($vermerkNachher === null, 'und der Vermerk ist geloescht: ' . var_export($vermerkNachher, true));
$pruefungen += 2;

// --- 💣 UND DAS KARTENOBJEKT BLEIBT. Das ist die tragende Zusicherung dieser Funktion.
$objektNachher = $pdoZ->query("SELECT is_active, name FROM map_features WHERE public_id = '$idZ'")->fetch(PDO::FETCH_ASSOC);
assert($objektNachher !== false && (int) $objektNachher['is_active'] === 1,
    '🔴 das Kartenobjekt bleibt unangetastet auf der Karte');
assert($objektNachher['name'] === 'Praioslob', 'und behaelt seinen Namen');
$pruefungen += 2;

// --- 🔴 EIN 'new'-ITEM WANDERT NICHT, und der Grund nennt den richtigen Weg. Es einfach
// zurueckzuschieben liesse das angelegte Objekt auf der Karte und boete an, es ein zweites Mal
// anzulegen.
$baueZ($pdoZ, $laufZ, 'Neuling \u00b7 neu', 'ggp:Ortschaften_3:Stadt:Garetien:Neuling!Neuling', $idZ, 'new');
$itemNeuZ = $itemIdVon($pdoZ, 'Neuling \u00b7 neu');
avesmapsGaretienItemAbschliessen($pdoZ, $itemNeuZ, 'done', $idZ, 7);
$zNeu = avesmapsGaretienZurueckAufOffen($pdoZ, $laufZ, [$itemNeuZ], ['id' => 7]);
assert($zNeu['verschoben'] === 0, 'ein angelegtes Objekt wandert NICHT zurueck: ' . json_encode($zNeu));
assert(count($zNeu['fehler']) === 1 && str_contains($zNeu['fehler'][0]['grund'], 'Zuruecknehmen'),
    'und der Grund nennt den richtigen Weg: ' . json_encode($zNeu['fehler']));
$pruefungen += 2;

// --- ⚠️ Ein Item, das nie uebernommen wurde, ist kein Fehler -- es ist schon dort, wo es hin soll.
$baueZ($pdoZ, $laufZ, 'Offen \u00b7 Quelle', 'ggp:Ortschaften_3:Stadt:Garetien:Offen!Offen', $idZ, 'changed');
$zOffen = avesmapsGaretienZurueckAufOffen($pdoZ, $laufZ, [$itemIdVon($pdoZ, 'Offen \u00b7 Quelle')], ['id' => 7]);
assert($zOffen === ['verschoben' => 0, 'fehler' => []],
    'ein nie uebernommenes Item wird uebersprungen, nicht beanstandet: ' . json_encode($zOffen));
$pruefungen++;

// =================================================================================================
// 🔴 EINE VERKNUEPFUNG, DIE EINEM ANDEREN GEHOERT, WIRD NICHT ANGEFASST
// =================================================================================================
// Owner 01.09.2026, nachdem gemessen war, dass ein zweiter Schreibvorgang die `note` ueberschreibt:
//     vorher   origin=manual  note="von Hand geprueft"
//     nachher  origin=manual  note="…/Avesmaps_Wege"
// `avesmapsFeatureSourceLink` schuetzt zwar `origin` (ein `manual` bleibt `manual`), setzt aber
// `note`, `pages` und `reference_kind` bei jedem Aufruf neu.
//
// 💣 Das ist derselbe stille Schreibzugriff auf fremde Arbeit, den der Owner am 31.08.2026 am
// OBJEKT abgeschaltet hat -- nur eine Etage tiefer.
$pdoM = avesmapsGaretienUebernahmeTestPdo();
$idM = '00000000-0000-4000-8000-00000010a001';
$pdoM->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idM, 'Notizprobe', 'path', 'Weg',
        json_encode(['type' => 'LineString', 'coordinates' => [[1.0, 1.0], [2.0, 2.0]]]), '{}', 'LineString']);
$nachM = [
    'herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Wege',
    'quelle' => ['url' => 'https://www.garetien.de', 'label' => 'Briefspiel (Garetien)',
        'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de'],
    'seite_url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Wege',
];
$keyM = 'ggp:Wege:Weg:Garetien:Notizprobe!Notizprobe';
avesmapsGaretienQuellenAnlegen($pdoM, 'path', $idM, $nachM, 7, $keyM);

// 01.09.2026: gemessen wird an der Verknuepfung, die WIRKLICH entsteht -- seit dem
// Owner-Entscheid „nur noch den artikel als quelle" ist das die Artikelquelle, nicht mehr der
// Wirt. Die Aussage dieses Abschnitts ist davon unberuehrt: es geht um die NOTIZ, nicht um die
// Adresse.
$leseM = static fn(PDO $p): array => (array) $p->query(
    "SELECT fs.origin, fs.note FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
      WHERE fs.entity_public_id = '$idM' AND s.url = 'https://www.garetien.de/index.php/Garetien:Notizprobe'"
)->fetch(PDO::FETCH_ASSOC);

// --- Solange sie UNS gehoert, darf sie aufgefrischt werden: sonst bliebe die tote
// „…/Avesmaps_<Artikel>"-Adresse aus der Zeit vor dem 31.08.2026 fuer immer stehen.
$pdoM->exec("UPDATE feature_sources SET note = 'alte tote Adresse' WHERE entity_public_id = '$idM'");
avesmapsGaretienQuellenAnlegen($pdoM, 'path', $idM, $nachM, 7, $keyM);
assert($leseM($pdoM)['note'] === AVESMAPS_GARETIEN_BASIS_GGP . 'Wege',
    'eine Verknuepfung, die uns gehoert, wird aufgefrischt: ' . json_encode($leseM($pdoM)));
$pruefungen++;

// --- 🔴 Sobald ein Mensch sie uebernommen hat, bleibt seine Notiz stehen.
// ⚠️ Seit dem 01.09.2026 gibt es hier nur EINE Verknuepfung (den Artikel); der Satz „BEIDE
// uebernimmt ein Mensch" stand hier, solange es zwei waren, und die Zusicherung „zaehlt nicht als
// neu" waere sonst gegen den falschen Fall gemessen worden.
$pdoM->exec("UPDATE feature_sources SET origin = 'manual' WHERE entity_public_id = '$idM'");
$pdoM->exec("UPDATE feature_sources SET note = 'von Hand geprueft'
              WHERE entity_public_id = '$idM'
                AND source_id = (SELECT id FROM sources WHERE url = 'https://www.garetien.de/index.php/Garetien:Notizprobe')");
$neuM = avesmapsGaretienQuellenAnlegen($pdoM, 'path', $idM, $nachM, 7, $keyM);
assert($leseM($pdoM)['note'] === 'von Hand geprueft',
    '🔴 eine fremde Notiz bleibt stehen: ' . json_encode($leseM($pdoM)));
assert($leseM($pdoM)['origin'] === 'manual', 'und die Herkunft ebenso');
// ⚠️ Und sie zaehlt NICHT als neu angelegt -- sie haengt ja schon.
assert($neuM === 0, 'eine fremde Verknuepfung zaehlt nicht als neu: ' . $neuM);
$pruefungen += 3;

// --- 💣 UND SIE WIRD AUCH NICHT GELOESCHT ODER VERDOPPELT. Die Quelle haengt weiter genau
// einmal; „nicht anfassen" heisst nicht „wegnehmen".
$zahlM = (int) $pdoM->query(
    "SELECT COUNT(*) FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
      WHERE fs.entity_public_id = '$idM' AND s.url = 'https://www.garetien.de/index.php/Garetien:Notizprobe'"
)->fetchColumn();
assert($zahlM === 1, 'die Verknuepfung haengt weiter genau einmal: ' . $zahlM);
$pruefungen++;

// =================================================================================================
// 🔴 EINE RUECKNAHME UEBER DIE LAUFGRENZE HINWEG -- DIE public_id LIEGT IM ALTEN LAUF
// =================================================================================================
// Owner 01.09.2026: „ich seh keine buttons, die so heissen." Im Reiter „Uebernommen" stand ein
// Objekt und trug KEINEN einzigen Knopf.
//
// 💣 Nach einem „Holen & Rechnen" sind die Items NEUE Zeilen: `apply_state = null`,
// `apply_note` leer. Der dauerhafte Vermerk in `sync_decision` haelt das Objekt in „Uebernommen",
// aber die Ruecknahme verlangte `apply_state = 'done'` UND las die angelegte public_id aus
// `apply_note` der aktuellen Zeile -- beides gab es nicht mehr. Ein 'new'-Objekt war damit
// dauerhaft gefangen: „Zurueck nach Offen" bedient nur 'changed'-Items (sonst Dublette),
// „Zuruecknehmen" und „Ablehnen" scheiterten am Riegel.
//
// ⭐ Der alte Lauf ist noch da -- avesmapsSyncPlanStartRun setzt ihn nur auf `superseded`,
// geloescht wird nie. Dort steht der Vermerk.
$pdoL = avesmapsGaretienUebernahmeTestPdo();
$keyL = 'ggp:Ortschaften_3:Stadt:Garetien:Laufgrenze!Laufgrenze';
$idL = '00000000-0000-4000-8000-0000000f0001';
$pdoL->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idL, 'Laufgrenze', 'location', 'stadt',
        json_encode(['type' => 'Point', 'coordinates' => [9.0, 9.0]]), '{}', 'Point']);

$baueL = static function (PDO $pdo, int $lauf, string $label) use ($keyL): void {
    avesmapsSyncPlanAddItem($pdo, $lauf, [
        'entity_key' => $keyL, 'entity_public_id' => null, 'change_type' => 'new', 'label' => $label,
        'before' => [],
        'after' => ['herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Ortschaften_3',
            'ziel' => 'location', 'subtyp' => 'stadt', 'name' => 'Laufgrenze',
            'geometry' => ['type' => 'Point', 'coordinates' => [9.0, 9.0]]],
        'override' => [], 'selected' => 1,
    ]);
};

// --- Lauf A: uebernommen, die angelegte public_id steht im Vermerk.
$laufA = (int) avesmapsSyncPlanOpenRun($pdoL, AVESMAPS_GARETIEN_PLAN_KIND)['id'];
$baueL($pdoL, $laufA, 'Laufgrenze A');
$itemA = $itemIdVon($pdoL, 'Laufgrenze A');
avesmapsGaretienItemAbschliessen($pdoL, $itemA, 'done', $idL, 7);
avesmapsSyncPlanRecordApplied($pdoL, AVESMAPS_GARETIEN_PLAN_KIND, $keyL, 7, 'new');

// --- Lauf B: „Holen & Rechnen". Der alte Lauf wird `superseded`, das frische Item ist leer.
$laufB = avesmapsSyncPlanStartRun($pdoL, AVESMAPS_GARETIEN_PLAN_KIND, 7, null);
$baueL($pdoL, $laufB, 'Laufgrenze B');
$itemB = $itemIdVon($pdoL, 'Laufgrenze B');
$standB = (string) $pdoL->query("SELECT apply_state FROM sync_plan_item WHERE id = $itemB")->fetchColumn();
$notizB = (string) $pdoL->query("SELECT apply_note FROM sync_plan_item WHERE id = $itemB")->fetchColumn();
assert($standB === '' && $notizB === '',
    'die Vorbedingung: das frische Item weiss nichts -- ' . var_export([$standB, $notizB], true));
assert((int) $pdoL->query("SELECT COUNT(*) FROM sync_plan_item WHERE id = $itemA AND apply_state = 'done'")->fetchColumn() === 1,
    'und der alte Lauf steht noch da');
$pruefungen += 2;

// --- 🔴 DIE ZUSICHERUNG: die Ruecknahme findet die public_id im alten Lauf.
$rL = avesmapsGaretienRuecknahmeAusfuehren($pdoL, $laufB, [$itemB], ['id' => 7]);
assert($rL['zurueckgenommen'] === 1,
    '🔴 ein ueber die Laufgrenze uebernommenes Objekt laesst sich zuruecknehmen: ' . json_encode($rL));
$aktivL = (int) $pdoL->query("SELECT is_active FROM map_features WHERE public_id = '$idL'")->fetchColumn();
assert($aktivL === 0, 'und das angelegte Objekt ist wirklich weg: is_active = ' . $aktivL);
$pruefungen += 2;

// --- ⚠️ Der dauerhafte Vermerk faellt mit, sonst stuende das Objekt weiter in „Uebernommen".
$vermerkL = $pdoL->query(
    "SELECT applied_at FROM sync_decision WHERE kind = 'garetien' AND entity_key = '$keyL'"
)->fetchColumn();
assert($vermerkL === null, 'der dauerhafte Vermerk ist geloescht: ' . var_export($vermerkL, true));
$pruefungen++;

// --- 💣 UND DIE ALTE ZEILE IST MITGERAEUMT. Bliebe sie auf 'done', faende die Suche beim
// naechsten Mal denselben Vermerk -- der dann auf ein geloeschtes Objekt zeigt, und die Ruecknahme
// koennte nur noch scheitern. Ein Geist, der eine Handlung anbietet, die es nicht mehr gibt.
$standAdanach = $pdoL->query("SELECT apply_state FROM sync_plan_item WHERE id = $itemA")->fetchColumn();
assert($standAdanach === null || $standAdanach === '',
    '💣 die alte Zeile steht nicht mehr auf "done": ' . var_export($standAdanach, true));
$pruefungen++;

// --- 🔴 UND OHNE VERMERK PASSIERT NICHTS. Der Riegel darf nicht zu „jedes Item ist
// ruecknehmbar" verkommen: ein Item, das nie uebernommen wurde, wird abgelehnt, nicht geloescht.
$pdoN = avesmapsGaretienUebernahmeTestPdo();
$laufN = (int) avesmapsSyncPlanOpenRun($pdoN, AVESMAPS_GARETIEN_PLAN_KIND)['id'];
$idN = '00000000-0000-4000-8000-0000000f0002';
$pdoN->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json, geometry_type) VALUES (?,?,?,?,?,?,?)')
    ->execute([$idN, 'Nievermerkt', 'location', 'stadt',
        json_encode(['type' => 'Point', 'coordinates' => [8.0, 8.0]]), '{}', 'Point']);
avesmapsSyncPlanAddItem($pdoN, $laufN, [
    'entity_key' => 'ggp:Ortschaften_3:Stadt:Garetien:Nievermerkt!Nievermerkt', 'entity_public_id' => null,
    'change_type' => 'new', 'label' => 'Nievermerkt neu', 'before' => [],
    'after' => ['herkunft' => 'garetien', 'wiki' => 'ggp', 'ebene' => 'Ortschaften_3',
        'ziel' => 'location', 'subtyp' => 'stadt', 'name' => 'Nievermerkt',
        'geometry' => ['type' => 'Point', 'coordinates' => [8.0, 8.0]]],
    'override' => [], 'selected' => 1,
]);
$itemN = $itemIdVon($pdoN, 'Nievermerkt neu');
$rN = avesmapsGaretienRuecknahmeAusfuehren($pdoN, $laufN, [$itemN], ['id' => 7]);
assert($rN['zurueckgenommen'] === 0 && count($rN['fehler']) === 1,
    '🔴 ein nie uebernommenes Item wird abgelehnt: ' . json_encode($rN));
// 💣 UND DER GRUND MUSS DER RICHTIGE SEIN. Die Zeile darueber allein ist zu grob: faellt
// der Riegel ganz weg, scheitert dasselbe Item eine Zeile spaeter an der fehlenden public_id --
// dieselbe Bilanz (0 zurueckgenommen, 1 Fehler), voellig andere Ursache. Eine Mutationsprobe hat
// genau das ausgenutzt und ist unbemerkt durchgelaufen.
assert($rN['fehler'][0]['grund'] === 'dieses Item wurde nie uebernommen',
    '💣 und zwar mit dem Grund, der die Ursache nennt: ' . json_encode($rN['fehler']));
assert((int) $pdoN->query("SELECT is_active FROM map_features WHERE public_id = '$idN'")->fetchColumn() === 1,
    'und sein Objekt bleibt unangetastet');
$pruefungen += 2;

echo "OK: {$pruefungen} Pruefungen\n";
