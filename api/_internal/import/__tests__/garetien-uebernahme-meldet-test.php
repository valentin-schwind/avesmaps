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
 * 🪤 Nur EINE Naht ist hier noetig: `avesmapsNextMapRevision` schreibt roh MySQLs
 * `ON DUPLICATE KEY UPDATE` (AGENTS.md §9 -- die Produktionsform wird nicht fuer den Test
 * verbogen). `avesmapsEnsureSyncPlanTables`/`avesmapsEnsureFeatureSourceTables` sind dagegen
 * TREIBER-BEWUSST (sie rufen unter SQLite selbst ihre `…Sqlite()`-Geschwister) -- fuer sie
 * braucht es keine Uebersetzung.
 */
final class AvesmapsGaretienUebernahmeMeldetTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'INTO map_revision') && str_contains($statement, 'ON DUPLICATE KEY UPDATE')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }

        return parent::exec($statement);
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
assert((int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn() >= 1,
    'und ueberhaupt etwas liegt auf der Karte (die zwei Endkreuzungen zaehlen mit)');
$pruefungen += 3;

echo "OK ({$pruefungen} Pruefungen)\n";
