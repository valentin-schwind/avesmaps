<?php

declare(strict_types=1);

// 🔴 DIE UEBERNAHME MELDET SEIT DEM 06.09.2026 GRUENDE UND FORMEN, NICHT NUR EINE ZAHL.
// `avesmapsGaretienApplyStep` gab bis dahin nur `skipped: <n>` zurueck -- der Grund stand
// ausschliesslich in `apply_note` in der Datenbank und erreichte keinen Browser. Dieser Test faehrt
// den ECHTEN Ablauf ueber `avesmapsGaretienApplyStep` (nicht nur `avesmapsGaretienUebernehmen`
// darunter), weil genau diese Schicht die neuen Felder durchreichen muss.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-uebernahme-meldet-test.php

require_once __DIR__ . '/../garetien-uebernahme.php';

$pruefungen = 0;

/**
 * 🪤 ZWEI MySQL-eigene Anweisungen brauchen eine Uebersetzung, nicht nur `map_revision`
 * (AGENTS.md §9 -- die Produktionsform wird nicht fuer den Test verbogen):
 * `avesmapsNextMapRevision` selbst, und -- seit dem quelle-Nachtrag -- die beiden
 * `ON DUPLICATE KEY UPDATE`-Anweisungen von `avesmapsFeatureSourceUpsert`/`…Link`
 * (`api/_internal/app/feature-sources.php`), die ueber `prepare()` laufen, nicht `exec()`.
 * `avesmapsEnsureSyncPlanTables`/`avesmapsEnsureFeatureSourceTables` sind dagegen
 * TREIBER-BEWUSST (sie rufen unter SQLite selbst ihre `…Sqlite()`-Geschwister) -- fuer sie
 * braucht es nichts.
 *
 * 🔴 DIE `prepare()`-UEBERSETZUNG WIRD NICHT NEU ERFUNDEN, SONDERN AUS
 * `garetien-uebernahme-test.php` UEBERNOMMEN (`AvesmapsGaretienUebernahmeTestPdo`) --
 * zeichengleich, nicht nachgebaut. Eine zweite, vereinfachte Fassung derselben Klammer-Zerlegung
 * waere genau die Divergenz, vor der AGENTS.md §5 warnt: sie liefe beim naechsten neuen
 * `IF(...)`-Zweig des Quellensystems lautlos auseinander.
 */
final class AvesmapsGaretienUebernahmeMeldetTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'INTO map_revision') && str_contains($statement, 'ON DUPLICATE KEY UPDATE')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
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
            return parent::query(self::schemaSondeErsatz($query));
        }

        return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$args);
    }

    /**
     * Zeichengleich aus AvesmapsGaretienUebernahmeTestPdo -- siehe die Begruendung am Klassenkopf.
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
        //
        // 💣 DER ZERLEGER MUSS ZEICHENKETTEN KENNEN. Ohne `$inText` spaltet er auch an einem Komma
        // INNERHALB eines Literals: `IF(own_fields NOT LIKE '%,is_official,%', a, b)` zerfaellt in
        // fuenf Teile statt drei, die Schleife bricht ab (`count !== 3`) und laesst JEDES `IF(` der
        // Anweisung stehen -- SQLite meldet dann „no such function: IF", und zwar an einer Stelle,
        // die mit dem eigentlichen Feld nichts zu tun hat.
        // 🪤 UND ES FAELLT LOKAL NICHT AUF: SQLite kennt `IF` seit 3.32 als Alias von `iif`, dieser
        // Rechner faehrt 3.51. Der Deploy-Runner ist aelter -- gruen hier, rot im Tor. Dieselbe
        // Klasse Fallgrube wie CRLF gegen LF, nur eine Ebene tiefer (02.09.2026, ein Deploy).
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
            throw new RuntimeException(
                'Die Uebersetzung nach SQLite hat ein IF( stehen lassen -- meist ein Komma INNERHALB '
                . "eines Literals, an dem der Zerleger faelschlich spaltet:\n" . $query
            );
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

    /** Zeichengleich aus AvesmapsGaretienUebernahmeTestPdo. */
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
        $query = str_replace('FOR UPDATE', '', $query);
        $query = str_replace('NOW(3)', "datetime('now')", $query);
        $query = str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $query);
        if (str_contains($query, 'ON DUPLICATE KEY UPDATE')) {
            $query = self::mysqlUpsertNachSqlite($query);
        }

        return parent::prepare($query, $options);
    }
}

/**
 * Der Pruefstand: nur die Tabellen, die `avesmapsGaretienApplyStep` fuer ZWEI 'new'-Items ohne
 * Quelle wirklich anfasst -- kein Staging, kein Planbau. Die Items werden HAND gebaut und direkt
 * in `sync_plan_item` gelegt (`avesmapsGaretienPendingItemsScoped` liest nur `run_id`,
 * `selected = 1`, `apply_state IS NULL`; eine Zeile in `sync_plan_run` verlangt sie nicht -- die
 * Naht dorthin haelt nur `avesmapsGaretienArtikelQuellenNachtragen` am Ende, und die findet ohne
 * eine passende `sync_plan_run`-Zeile schlicht nichts zum Nachtragen).
 *
 * ⚠️ OHNE `quelle`/`artikel_quelle` UND MIT ENTITY_KEYS OHNE VIER DOPPELPUNKTE: sonst deutete
 * `avesmapsGaretienArtikelNameAusSchluessel` den Schluessel als Artikelnamen und der Lauf griffe
 * nach `sources`/`feature_sources` -- Tabellen, die dieser schlanke Pruefstand nicht braucht, weil
 * diese Aufgabe die FORMZAEHLUNG prueft, nicht das Quellensystem (das deckt
 * garetien-uebernahme-test.php bereits ab).
 */
function avesmapsGaretienUebernahmeMeldetTestPdo(): PDO
{
    $pdo = new AvesmapsGaretienUebernahmeMeldetTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

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

    // `avesmapsGaretienApplyStep` legt sync_plan_run/_item/sync_decision selbst an
    // (`avesmapsEnsureSyncPlanTables`, treiberbewusst) -- hier vorab nur die eine Tabelle, in die
    // dieser Pruefstand seine zwei Items direkt schreibt.
    avesmapsEnsureSyncPlanTablesSqlite($pdo);
    // 🔴 NACHTRAG (Ruecklauf des Koordinators, 06.09.2026): fuer den `quelle`-Zaehler braucht es
    // ein 'changed'-Item, das WIRKLICH eine Quelle anlegt.
    // 🪤 VON HAND, NICHT UEBER `avesmapsEnsureFeatureSourceTablesSqlite`: deren `sources`-Tabelle
    // traegt KEIN `UNIQUE` auf `url_hash` (nur die MySQL-Fassung hat `uq_sources_url_hash") -- die
    // ON-CONFLICT-Uebersetzung des Upserts braucht aber genau dieses Ziel. Derselbe Grund, warum
    // `garetien-uebernahme-test.php` seine `sources`-Tabelle ebenfalls von Hand mit `url_hash TEXT
    // UNIQUE` anlegt, statt den treiberbewussten Helfer zu rufen.
    $pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, url_hash TEXT UNIQUE,
        wiki_key TEXT NULL, label TEXT, source_type TEXT, is_official INTEGER DEFAULT 0, created_by INTEGER NULL,
        license TEXT NOT NULL DEFAULT \'\', attribution TEXT NOT NULL DEFAULT \'\',
        own_fields TEXT NOT NULL DEFAULT \'\', created_at TEXT DEFAULT "2026-01-01")');
    $pdo->exec("CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
        entity_public_id TEXT NOT NULL, source_id INTEGER NOT NULL, status TEXT DEFAULT 'approved',
        created_by INTEGER NULL, origin TEXT DEFAULT 'manual', reference_kind TEXT NULL, pages TEXT NULL,
        note TEXT NULL, created_at TEXT NOT NULL DEFAULT \"2026-01-01 00:00:00\",
        UNIQUE(entity_type, entity_public_id, source_id))");

    return $pdo;
}

/**
 * Ein 'new'-Item HAND gebaut, direkt in sync_plan_item -- ohne den Planbau zu durchlaufen.
 *
 * @return int die id der eingefuegten Zeile
 */
function avesmapsGaretienUebernahmeMeldetItemAnlegen(PDO $pdo, int $runId, string $entityKey, string $label, array $nach): int
{
    $pdo->prepare(
        'INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, after_json, selected, apply_state)
         VALUES (:run_id, :entity_key, NULL, :change_type, :label, :after_json, 1, NULL)'
    )->execute([
        'run_id' => $runId,
        'entity_key' => $entityKey,
        'change_type' => 'new',
        'label' => $label,
        'after_json' => json_encode($nach, JSON_UNESCAPED_UNICODE),
    ]);

    return (int) $pdo->lastInsertId();
}

$pdo = avesmapsGaretienUebernahmeMeldetTestPdo();
$runId = 1;

// ⚠️ Entity-Keys OHNE vier Doppelpunkte -- siehe die Begruendung am Pruefstand oben.
$idWeg = avesmapsGaretienUebernahmeMeldetItemAnlegen($pdo, $runId, 'weg-gut', 'Testbach', [
    'herkunft' => 'garetien',
    'ziel' => 'path',
    'subtyp' => 'Flussweg',
    'is_bach' => true,
    'name' => 'Testbach',
    'geometry' => ['type' => 'LineString', 'coordinates' => [[100.0, 100.0], [200.0, 200.0]]],
]);
// 🔴 EIN VORSCHLAG MIT NUR EINEM PUNKT: `avesmapsGaretienMoeglicheZiele` (garetien-plan.php)
// laesst aus einem einzelnen Punkt nur 'location'/'label' werden, nie 'path' (dafuer braucht es
// mindestens zwei). Die UEBERSTEUERUNG unten (dasselbe `$einstellungen` fuer den ganzen Aufruf,
// siehe die Begruendung an $einstellungen weiter unten) verlangt fuer BEIDE Items 'path', und
// `avesmapsGaretienZielUebersteuern` wirft dann die ECHTE Meldung "Aus 1 Punkten laesst sich kein
// Ziel der Art \"path\" bauen." -- nicht nachgebaut, sondern der Hauscode selbst.
$idKaputt = avesmapsGaretienUebernahmeMeldetItemAnlegen($pdo, $runId, 'weg-kaputt', 'Kaputter Ort', [
    'herkunft' => 'garetien',
    'ziel' => 'location',
    'subtyp' => 'dorf',
    'name' => 'Kaputter Ort',
    'geometry' => ['type' => 'Point', 'coordinates' => [350.0, 300.0]],
]);

// 🔴 DIESELBE UEBERSTEUERUNG FUER BEIDE ITEMS EINES AUFRUFS (vor Aufgabe 4, `einstellungen_je_item`
// -- ein Rumpf je Item -- gab es nur diesen EINEN Rumpf fuer den ganzen Haeppchen). Fuer den guten
// Weg ist sie ein NO-OP: sein eigenes `ziel`/`subtyp` ist bereits 'path'/'Flussweg', und
// `avesmapsGaretienZielUebersteuern` gibt bei GENAUEM Treffer den Vorschlag UNVERAENDERT zurueck,
// noch bevor sie ueberhaupt Punkte zaehlt -- sein `is_bach`-Haekchen und seine Zwei-Punkt-Linie
// bleiben also unberuehrt.
$einstellungen = ['ziel' => 'path', 'subtyp' => 'Flussweg'];
$ergebnis = avesmapsGaretienApplyStep($pdo, $runId, 1, ['id' => 1], null, [$idWeg, $idKaputt], $einstellungen);

// --- 🔴 DIE GRUENDE REISEN MIT. Bis zum 06.09.2026 gab es nur `skipped: 2` -- eine Zahl, aus der
// niemand ablesen konnte, WAS schiefging; der Text stand in `apply_note` und wurde nie gelesen.
assert(is_array($ergebnis['fehler']), 'fehler ist eine Liste');
assert(count($ergebnis['fehler']) === 1, 'genau ein Fehlschlag: ' . json_encode($ergebnis['fehler'], JSON_UNESCAPED_UNICODE));
assert($ergebnis['fehler'][0]['item'] === $idKaputt, 'die Item-Nummer steht dabei');
assert(str_contains($ergebnis['fehler'][0]['grund'], 'Punkt'), 'der Grund ist der echte Text: ' . var_export($ergebnis['fehler'][0]['grund'], true));
// ⚠️ Die DIFFERENZ ist die Zusicherung: das gelungene Item darf NICHT in `fehler` stehen.
assert(count(array_filter($ergebnis['fehler'], fn($f) => $f['item'] === $idWeg)) === 0, 'der gute Weg steht nicht in den Fehlern');
$pruefungen += 4;

// --- 🔴 UND DIE FORMEN. „5 importiert" sagt nichts; „3 Wege (2 Baeche), 1 Flaeche" sagt, was auf
// der Karte steht. `bach` ist die TEILMENGE von `path` -- ein Bach zaehlt in BEIDEN, sonst
// ergaeben die Formzahlen zusammen nicht die Gesamtzahl.
assert($ergebnis['applied'] === 1, 'genau ein Objekt wirklich angelegt: ' . $ergebnis['applied']);
assert($ergebnis['angelegt_je_form']['path'] === 1, 'ein Weg');
assert($ergebnis['angelegt_je_form']['bach'] === 1, 'und er ist ein Bach');
assert($ergebnis['angelegt_je_form']['region'] === 0, 'keine Flaeche');
assert($ergebnis['angelegt_je_form']['label'] === 0, 'kein Gipfel');
assert($ergebnis['angelegt_je_form']['location'] === 0, 'kein Ort');
assert($ergebnis['angelegt_je_form']['settlement_place'] === 0, 'keine Staette');
assert($ergebnis['angelegt_je_form']['quelle'] === 0, 'keine Ergaenzung in diesem Lauf');
assert(array_sum([$ergebnis['angelegt_je_form']['path'], $ergebnis['angelegt_je_form']['region'],
    $ergebnis['angelegt_je_form']['label'], $ergebnis['angelegt_je_form']['location'],
    $ergebnis['angelegt_je_form']['settlement_place']]) === $ergebnis['applied'],
    'die Formen ohne `bach` und `quelle` ergeben zusammen die Gesamtzahl');
$pruefungen += 9;

// --- 💣 UND DER SCHREIBWEG HAT WIRKLICH GESCHRIEBEN, nicht nur das Ergebnis behauptet es --
// GENAU EIN Weg (der kaputte Vorschlag ist als 'location' nie bis zum Schreiber gekommen, er
// scheiterte schon an der Zieluebersteuerung, siehe oben).
$angelegteWege = (int) $pdo->query("SELECT COUNT(*) FROM map_features WHERE feature_type = 'path'")->fetchColumn();
assert($angelegteWege === 1, 'genau ein Weg liegt auf der Karte: ' . $angelegteWege);
$bach = $pdo->query("SELECT properties_json FROM map_features WHERE feature_type = 'path'")->fetch(PDO::FETCH_ASSOC);
assert(str_contains((string) $bach['properties_json'], '"is_bach":true'), 'und er traegt das Bach-Haekchen: ' . $bach['properties_json']);
// 🔴 KORRIGIERT (Ruecklauf des Koordinators, 06.09.2026): `COUNT(*) FROM map_features >= 1` war
// eine Tautologie -- der Weg allein (zwei Zeilen darueber schon auf `=== 1` geprueft) erfuellt
// sie bereits. Gemeint waren die zwei Endkreuzungen, die `avesmapsGaretienSetztEndkreuzungen`
// ohne `endpoint_crossings: false` im Einstellungs-Rumpf anlegt (Vorgabe JA, siehe die
// Begruendung an der Funktion) -- die werden jetzt wirklich gezaehlt.
$angelegteKreuzungen = (int) $pdo->query(
    "SELECT COUNT(*) FROM map_features WHERE feature_type = 'junction' AND feature_subtype = 'crossing'"
)->fetchColumn();
assert($angelegteKreuzungen === 2, 'genau zwei Endkreuzungen liegen auf der Karte: ' . $angelegteKreuzungen);
$pruefungen += 3;

// =================================================================================================
// 🔴 NACHTRAG (Ruecklauf des Koordinators, 06.09.2026): DER `quelle`-ZAEHLER WAR UNGEDECKT -- der
// Lauf oben hat kein 'changed'-Item. Ein Ergaenzungs-Item mit `felder: ['quelle']` an einem
// BESTEHENDEN Objekt legt kein neues Kartenobjekt an; `angelegt_je_form.quelle` muss trotzdem
// hochzaehlen, waehrend `applied` es NICHT tut -- sonst ergaebe die Summe der fuenf Formen (ohne
// `bach`/`quelle`) NICHT `applied`, sobald ein Lauf 'new' und 'changed' mischt (siehe die
// Begruendung an `avesmapsGaretienErgaenzungAnwenden`/`objekt_felder`).
// ⚠️ EIGENER PDO/LAUF: die Ergaenzung braucht ein VORHANDENES Objekt plus die Quellentabellen,
// die der obige Lauf bewusst nicht anfasst (siehe die Begruendung am Pruefstand).
$pdo2 = avesmapsGaretienUebernahmeMeldetTestPdo();
$idBestand = '00000000-0000-4000-8000-00000000be9d';
$pdo2->prepare('INSERT INTO map_features (public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json)
                VALUES (?,?,?,?,?,?,?)')
    ->execute([$idBestand, 'path', 'Flussweg', 'Bestandsbach', 'LineString',
        json_encode(['type' => 'LineString', 'coordinates' => [[1.0, 1.0], [2.0, 2.0]]], JSON_UNESCAPED_UNICODE), '{}']);
// ⚠️ Entity-Key OHNE vier Doppelpunkte -- derselbe Grund wie oben: sonst deutete
// `avesmapsGaretienArtikelNameAusSchluessel` den Schluessel als Artikelnamen.
$idErgaenzung = avesmapsGaretienUebernahmeMeldetItemAnlegen($pdo2, $runId, 'bestand-quelle', 'Bestandsbach · Quelle', [
    'herkunft' => 'garetien',
    'anlass' => 'ergaenzung',
    'felder' => ['quelle'],
    'ziel' => 'path',
    'subtyp' => 'Flussweg',
    'quelle' => ['url' => 'https://www.garetien.de', 'label' => 'Briefspiel (Garetien)'],
]);
// 🔴 DAS EINZIGE FELD IM RUMPF DES ITEMS SELBST IST 'changed' -- avesmapsGaretienUebernahmeMeldet
// ItemAnlegen setzt IMMER 'new' (siehe seine Definition oben), diese Zeile muss es fuer dieses
// EINE Item auf 'changed' umsetzen.
$pdo2->prepare('UPDATE sync_plan_item SET change_type = :ct, entity_public_id = :pid WHERE id = :id')
    ->execute(['ct' => 'changed', 'pid' => $idBestand, 'id' => $idErgaenzung]);

$ergaenzung = avesmapsGaretienApplyStep($pdo2, $runId, 1, ['id' => 1], null, [$idErgaenzung]);
assert($ergaenzung['fehler'] === [], 'die Quellen-Ergaenzung gelingt: ' . json_encode($ergaenzung, JSON_UNESCAPED_UNICODE));
// 🔴 DIE TRAGENDE ZUSICHERUNG DIESES NACHTRAGS: `quelle` zaehlt hoch, `applied` NICHT.
assert($ergaenzung['angelegt_je_form']['quelle'] === 1, 'die Quelle zaehlt in ihrer eigenen Form: ' . json_encode($ergaenzung));
assert($ergaenzung['applied'] === 0, 'aber KEIN Kartenobjekt wurde angelegt oder veraendert: ' . json_encode($ergaenzung));
$pruefungen += 3;

// -- Und sie hat wirklich geschrieben: eine feature_sources-Zeile haengt am Bestandsweg.
$quelleAmBestand = (int) $pdo2->query(
    "SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'path' AND entity_public_id = " . $pdo2->quote($idBestand)
)->fetchColumn();
assert($quelleAmBestand === 1, 'die Quelle haengt wirklich am bestehenden Weg: ' . $quelleAmBestand);
$pruefungen++;

// =================================================================================================
// 🔴 NACHTRAG (Ruecklauf des Koordinators, 06.09.2026): `fehler[].grund` MUSS gekappt sein, wie
// `apply_note` -- er reist seit diesem Tag bis in die Antwort von sync-plan.php und damit zu
// JEDEM Editor. Ein 'changed'-Item mit einem Anlass ausserhalb der erlaubten Liste
// ('widerspruch') baut seinen Grund aus dem Label des Items zusammen ("<Label> braucht eine
// Entscheidung von Hand") -- ein ueberlanges Label reicht, um das Kappen zu pruefen, ohne
// irgendein Kartenobjekt oder eine Quelle zu beruehren (dieser Zweig scheitert VOR jedem
// Schreibvorgang ausser dem Item-Vermerk selbst).
$pdo3 = avesmapsGaretienUebernahmeMeldetTestPdo();
$langesLabel = str_repeat('X', 400);
$idLang = avesmapsGaretienUebernahmeMeldetItemAnlegen($pdo3, $runId, 'langer-grund', $langesLabel, [
    'herkunft' => 'garetien',
    'anlass' => 'widerspruch',
    'ziel' => 'path',
    'subtyp' => 'Flussweg',
]);
$pdo3->prepare('UPDATE sync_plan_item SET change_type = :ct, entity_public_id = :pid WHERE id = :id')
    ->execute(['ct' => 'changed', 'pid' => '00000000-0000-4000-8000-00000000be9e', 'id' => $idLang]);
$ergebnisLang = avesmapsGaretienApplyStep($pdo3, $runId, 1, ['id' => 1], null, [$idLang]);
assert(count($ergebnisLang['fehler']) === 1, 'genau ein Fehlschlag: ' . json_encode($ergebnisLang['fehler']));
$grundLang = $ergebnisLang['fehler'][0]['grund'];
assert(strlen($grundLang) <= 300, 'der Grund ist auf 300 Zeichen gekappt, nicht ' . strlen($grundLang) . ': ' . $grundLang);
assert(str_contains($grundLang, str_repeat('X', 100)), 'und er ist der ECHTE Text, kein Platzhalter: ' . $grundLang);
$pruefungen += 2;

echo "OK ({$pruefungen} Pruefungen)\n";
