<?php

declare(strict_types=1);

// 🔴 EIN RUMPF JE ITEM, NICHT EINER FUER ALLE (Aufgabe 4, 06.09.2026, Import-Stage).
// Bis zum 06.09.2026 nahm `apply` GENAU EINEN Einstellungs-Rumpf fuer alle Items eines Aufrufs --
// unbedenklich nur, solange der einzige Aufrufer mit Handeingabe („Neu einfuegen") auf EIN Objekt
// skopiert war. Die Stage schickt viele Objekte auf einmal, jedes mit seiner eigenen Wahl; ein
// gemeinsamer Rumpf haette die Wahl des zuletzt geoeffneten auf alle gelegt.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll \
//           api/_internal/import/__tests__/garetien-einstellungen-je-item-test.php

require_once __DIR__ . '/../garetien-uebernahme.php';

$pruefungen = 0;

/**
 * 🔴 `exec()` UND `query()` SIND ZEICHENGLEICH AUS `garetien-uebernahme-meldet-test.php`
 * (`AvesmapsGaretienUebernahmeMeldetTestPdo`) UEBERNOMMEN, NICHT NACHGEBAUT.
 *
 * ⚠️ `prepare()` DAGEGEN IST EINE BEWUSST VEREINFACHTE FASSUNG -- gemessen, nicht behauptet: sie
 * laesst die MySQL-Upsert-Bruecke weg (`mysqlUpsertNachSqlite`, die Klammer-Zerlegung von
 * `ON DUPLICATE KEY UPDATE` -> SQLites `ON CONFLICT ... DO UPDATE`). Diese Aufgabe prueft die
 * ROUTUNG der Handeingaben, kein Item dieses Pruefstands legt eine Quelle an
 * (`avesmapsGaretienQuellenAnlegen` laeuft mit leerer Adressliste durch, siehe die Begruendung am
 * Pruefstand unten) -- die Luecke ist hier sachlich folgenlos.
 * 💣 WER DIESE DATEI UM EIN QUELLENTRAGENDES ITEM ERWEITERT, HOLT SICH DIE BRUECKE AUS
 * `garetien-uebernahme-meldet-test.php` MIT -- ohne sie wirft SQLite an `ON DUPLICATE KEY
 * UPDATE`, und der Fehler liest sich wie ein Fehler des Quellensystems, nicht des Pruefstands.
 */
final class AvesmapsGaretienEinstellungenJeItemTestPdo extends PDO
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

        return parent::prepare($query, $options);
    }
}

/**
 * Der Pruefstand: nur die Tabellen, die `avesmapsGaretienUebernehmen` fuer 'new'-Items der Ziele
 * 'path'/'location'/'label' wirklich anfasst -- kein Staging, kein Planbau. Die Items werden HAND
 * gebaut und direkt in `sync_plan_item` gelegt.
 *
 * ⚠️ OHNE `wiki_region_staging` UND `app_setting`: `avesmapsGaretienWikiLandschaftZuweisung` und
 * `avesmapsGaretienLabelVorgabeFuerArt` fangen eine fehlende Tabelle selbst per `catch
 * (PDOException)` ab (dieselbe zurueckhaltende Richtung wie `avesmapsGaretienQuellenBestand") --
 * diese Aufgabe prueft die ROUTUNG der Handeingaben, nicht die Wiki-Zuweisung oder die
 * Darstellungstafel.
 *
 * ⚠️ OHNE ENTITY_KEYS MIT VIER DOPPELPUNKTEN: sonst deutete `avesmapsGaretienArtikelNameAusSchluessel`
 * den Schluessel als Artikelnamen und `avesmapsGaretienQuellenAnlegen` griffe nach `sources`/
 * `feature_sources` -- diese Tabellen deckt `garetien-uebernahme-test.php` bereits ab.
 */
function avesmapsGaretienEinstellungenJeItemTestPdo(): PDO
{
    $pdo = new AvesmapsGaretienEinstellungenJeItemTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

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
    avesmapsEnsureSyncPlanTablesSqlite($pdo);

    return $pdo;
}

/**
 * Ein 'new'-Item HAND gebaut, direkt in sync_plan_item -- ohne den Planbau zu durchlaufen.
 *
 * @return int die id der eingefuegten Zeile
 */
function avesmapsGaretienEinstellungenJeItemAnlegen(PDO $pdo, int $runId, string $entityKey, string $label, array $nach): int
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

// =================================================================================================
// --- Schritt 1/4/5: ZWEI ITEMS, ZWEI RUEMPFE -- jedes bringt seine eigene Wahl mit.
$pdo = avesmapsGaretienEinstellungenJeItemTestPdo();
$runId = 1;

// Item A: bereits ein Bach (ziel/subtyp DECKEN SICH mit der Handeingabe unten) -- die
// Uebersteuerung ist fuer A ein NO-OP (avesmapsGaretienZielUebersteuern gibt bei genauem Treffer
// den Vorschlag unveraendert zurueck, `is_bach` bleibt also stehen).
$idA = avesmapsGaretienEinstellungenJeItemAnlegen($pdo, $runId, 'bach-a', 'Bach A', [
    'herkunft' => 'garetien',
    'ziel' => 'path',
    'subtyp' => 'Flussweg',
    'is_bach' => true,
    'name' => 'Bach A',
    'geometry' => ['type' => 'LineString', 'coordinates' => [[10.0, 10.0], [20.0, 20.0]]],
]);
// Item B: ein Vorschlag als Ort -- die Handeingabe wechselt ihn WIRKLICH auf einen Berggipfel
// (ein einzelner Punkt traegt 'label' laut avesmapsGaretienMoeglicheZiele).
$idB = avesmapsGaretienEinstellungenJeItemAnlegen($pdo, $runId, 'gipfel-b', 'Gipfel B', [
    'herkunft' => 'garetien',
    'ziel' => 'location',
    'subtyp' => 'dorf',
    'name' => 'Gipfel B',
    'geometry' => ['type' => 'Point', 'coordinates' => [30.0, 30.0]],
]);

$jeItem = [
    $idA => ['ziel' => 'path', 'subtyp' => 'Flussweg', 'is_bach' => true],
    $idB => ['ziel' => 'label', 'subtyp' => 'berggipfel'],
];
$ergebnis = avesmapsGaretienUebernehmen($pdo, $runId, [$idA, $idB], ['id' => 1], null, $jeItem);
assert($ergebnis['fehler'] === [], 'ohne Fehler: ' . json_encode($ergebnis['fehler'], JSON_UNESCAPED_UNICODE));
assert($ergebnis['angelegt'] === 2, 'beide Items wurden angelegt: ' . $ergebnis['angelegt']);
assert($ergebnis['angelegt_je_form']['bach'] === 1, 'A wurde ein Bach: ' . json_encode($ergebnis['angelegt_je_form']));
assert($ergebnis['angelegt_je_form']['label'] === 1, 'B wurde ein Gipfel: ' . json_encode($ergebnis['angelegt_je_form']));
$pruefungen += 4;

// 💣 UND B HAT WIRKLICH GESCHRIEBEN, NICHT NUR DAS ERGEBNIS BEHAUPTET ES -- ein Label mit dem
// richtigen Subtyp liegt auf der Karte, kein Ort.
$gipfel = $pdo->query("SELECT * FROM map_features WHERE name = 'Gipfel B'")->fetch(PDO::FETCH_ASSOC);
assert($gipfel !== false && $gipfel['feature_type'] === 'label' && $gipfel['feature_subtype'] === 'berggipfel',
    'B liegt als Berggipfel-Label auf der Karte: ' . json_encode($gipfel));
$pruefungen++;

// =================================================================================================
// --- Schritt 1: RUECKFALL -- ohne `jeItem` gilt der gemeinsame Rumpf wie bisher (der ALTE Weg,
// unveraendert gueltig fuer jeden Aufrufer, der nur ein Objekt schickt).
$pdo2 = avesmapsGaretienEinstellungenJeItemTestPdo();
$runId2 = 1;
$idC = avesmapsGaretienEinstellungenJeItemAnlegen($pdo2, $runId2, 'gipfel-c', 'Gipfel C', [
    'herkunft' => 'garetien',
    'ziel' => 'location',
    'subtyp' => 'dorf',
    'name' => 'Gipfel C',
    'geometry' => ['type' => 'Point', 'coordinates' => [60.0, 60.0]],
]);
$ergebnis2 = avesmapsGaretienUebernehmen($pdo2, $runId2, [$idC], ['id' => 1], ['ziel' => 'label', 'subtyp' => 'berggipfel']);
assert($ergebnis2['fehler'] === [], 'ohne Fehler: ' . json_encode($ergebnis2['fehler'], JSON_UNESCAPED_UNICODE));
assert($ergebnis2['angelegt_je_form']['label'] === 1, 'der Rueckfall wirkt weiterhin: ' . json_encode($ergebnis2['angelegt_je_form']));
$pruefungen += 2;

// =================================================================================================
// --- Schritt 1: 💣 EIN ITEM OHNE EINTRAG BEKOMMT KEINE FREMDE EINSTELLUNG. Fiele es auf den
// gemeinsamen Rumpf zurueck, truege ein Objekt die Wahl eines anderen -- genau der Fehler, den
// diese Aufgabe behebt. 🪤 `$einstellungen` steht hier ABSICHTLICH auf demselben Rumpf, der D auf
// einen Gipfel setzt: ein `null` an dieser Stelle haette die Mutationsprobe "Rueckfall auf
// `$einstellungen` auch bei gesetztem `$jeItem`" NICHT gefangen (E waere mit ODER ohne den Fehler
// ein Ort geblieben, weil der schaedliche Rueckfall selbst nichts getan haette). Mit `$einstellungen`
// gesetzt auf 'label'/'berggipfel' wuerde ein wieder eingebauter Rueckfall E STILL zu einem
// zweiten Gipfel machen -- und genau das faengt `angelegt_je_form['label'] !== 2` weiter unten.
$pdo3 = avesmapsGaretienEinstellungenJeItemTestPdo();
$runId3 = 1;
$idD = avesmapsGaretienEinstellungenJeItemAnlegen($pdo3, $runId3, 'gipfel-d', 'Gipfel D', [
    'herkunft' => 'garetien',
    'ziel' => 'location',
    'subtyp' => 'dorf',
    'name' => 'Gipfel D',
    'geometry' => ['type' => 'Point', 'coordinates' => [40.0, 40.0]],
]);
$idE = avesmapsGaretienEinstellungenJeItemAnlegen($pdo3, $runId3, 'ort-e', 'Ort E', [
    'herkunft' => 'garetien',
    'ziel' => 'location',
    'subtyp' => 'dorf',
    'name' => 'Ort E',
    'geometry' => ['type' => 'Point', 'coordinates' => [50.0, 50.0]],
]);
$ergebnis3 = avesmapsGaretienUebernehmen(
    $pdo3, $runId3, [$idD, $idE], ['id' => 1],
    ['ziel' => 'label', 'subtyp' => 'berggipfel'],
    [$idD => ['ziel' => 'label', 'subtyp' => 'berggipfel']]
);
assert($ergebnis3['fehler'] === [], 'ohne Fehler: ' . json_encode($ergebnis3['fehler'], JSON_UNESCAPED_UNICODE));
assert($ergebnis3['angelegt_je_form']['label'] === 1, 'nur D ist ein Gipfel: ' . json_encode($ergebnis3['angelegt_je_form']));
assert($ergebnis3['angelegt_je_form']['label'] !== 2, 'E behielt seinen Vorschlag');
assert($ergebnis3['angelegt_je_form']['location'] === 1, 'E blieb ein Ort, nicht Ds Wahl: ' . json_encode($ergebnis3['angelegt_je_form']));
$pruefungen += 4;

// 💣 UND ES STEHT WIRKLICH SO AUF DER KARTE: E ist ein Ort, kein Label.
$ortE = $pdo3->query("SELECT * FROM map_features WHERE name = 'Ort E'")->fetch(PDO::FETCH_ASSOC);
assert($ortE !== false && $ortE['feature_type'] === 'location',
    'E liegt weiterhin als Ort auf der Karte, nicht als Label: ' . json_encode($ortE));
$pruefungen++;

// =================================================================================================
// --- Schritt 1: DER FORM-RIEGEL -- was kein Array ist, wird verworfen, nicht geraten.
assert(avesmapsGaretienEinstellungenJeItemAusRumpf(['einstellungen_je_item' => 'x']) === null,
    'eine Zeichenkette ist kein `einstellungen_je_item`');
assert(avesmapsGaretienEinstellungenJeItemAusRumpf([]) === null, 'ein fehlender Schluessel ist `null`');
assert(avesmapsGaretienEinstellungenJeItemAusRumpf(['einstellungen_je_item' => []]) === null,
    'ein LEERES Array ist ebenfalls `null` -- „keine Handeingabe", nicht „alle Items auf nichts setzen"');
$pruefungen += 3;

// 💣 DIE SCHLUESSEL KOMMEN ALS ZEICHENKETTEN AN -- JSON kennt keine Zahlen als Objektschluessel.
// ⚠️ FUER EINEN KANONISCHEN SCHLUESSEL WIE '7' NORMALISIERT PHP SCHON BEIM ARRAY-BAU SELBST --
// egal ob per Literal oder per `json_decode(..., true)` (empirisch geprueft: BEIDE liefern hier
// bereits `int(7)`, bevor diese Funktion auch nur einen Fuss hineinsetzt). Diese Zeile bleibt
// stehen, weil sie den vom Brief vorgegebenen Vertrag festhaelt -- sie ist aber KEINE Zusicherung
// gegen den `(int)`-Wurf weiter unten in der Funktion, denn ohne ihn liefert PHP hier dasselbe
// Ergebnis (Mutationsprobe gefahren, siehe Bericht).
$gelesen = avesmapsGaretienEinstellungenJeItemAusRumpf(['einstellungen_je_item' => ['7' => ['ziel' => 'path']]]);
assert(is_array($gelesen), 'ein gueltiger Rumpf liefert ein Array: ' . json_encode($gelesen));
assert(array_key_exists(7, $gelesen), 'der Schluessel wird zur ZAHL -- JSON-Objektschluessel sind Zeichenketten: ' . json_encode($gelesen));
assert($gelesen[7] === ['ziel' => 'path'], 'und der Rumpf selbst bleibt unveraendert: ' . json_encode($gelesen));
$pruefungen += 3;

// 🪤 DIE ECHTE PROBE FUER `(int) $schluessel`: ein NICHT-KANONISCHER Schluessel ('07', mit
// fuehrender Null) wird von PHP selbst NICHT automatisch zum Array-Schluessel normalisiert --
// weder bei einem Literal noch bei `json_decode(..., true)` (empirisch geprueft: beide liefern
// die STRING '07'). Nur der ausdrueckliche `(int)`-Wurf in dieser Funktion faengt das ab; ohne ihn
// bliebe der Schluessel '07' stehen und der Abgleich mit `(int) $item['id']` in
// `avesmapsGaretienUebernehmen` faende ihn nie.
$gelesenNichtKanonisch = avesmapsGaretienEinstellungenJeItemAusRumpf(['einstellungen_je_item' => ['07' => ['ziel' => 'label']]]);
assert(array_key_exists(7, $gelesenNichtKanonisch),
    'auch ein NICHT-kanonischer Schluessel wird zur Zahl normalisiert: ' . json_encode($gelesenNichtKanonisch));
$pruefungen++;

// ⚠️ EIN NICHT-ARRAY-EINTRAG UND EIN NICHT-POSITIVER SCHLUESSEL FALLEN HERAUS, statt den ganzen
// Aufruf zu verwerfen -- ein einzelner kaputter Eintrag darf nicht die uebrigen guten mitreissen.
$gemischt = avesmapsGaretienEinstellungenJeItemAusRumpf([
    'einstellungen_je_item' => ['3' => ['ziel' => 'label'], '0' => ['ziel' => 'path'], '5' => 'kaputt'],
]);
assert($gemischt === [3 => ['ziel' => 'label']],
    'nur der gueltige Eintrag bleibt, "0" und ein Nicht-Array fallen heraus: ' . json_encode($gemischt));
$pruefungen++;

// 🪤 UND WENN AUSNAHMSLOS JEDER EINTRAG HERAUSFAELLT, IST DAS ERGEBNIS `null`, NICHT `[]` -- ein
// nicht-leerer Rumpf, dessen Eintraege ALLE ungueltig sind, ist genauso „keine Handeingabe" wie
// ein von vornherein leeres Array. `$roh === []` (die fruehe Weiche) trifft hier NICHT zu -- der
// Rumpf hat zwei Eintraege --, nur der Filter danach raeumt beide weg. Ohne das
// `$raus === [] ? null : $raus` am Ende gaebe diese Funktion ein leeres, aber NICHT-null Array
// zurueck, und `avesmapsGaretienUebernehmen` laese das als „`jeItem` ist gesetzt" -- mit der
// Folge, dass JEDES Item (auch eines mit eigenem Eintrag anderswo) auf `null` faellt, statt auf
// den gemeinsamen Rumpf, siehe die Weiche `$jeItem === null ? $einstellungen : null`.
$nurUngueltige = avesmapsGaretienEinstellungenJeItemAusRumpf([
    'einstellungen_je_item' => ['0' => ['ziel' => 'path'], 'abc' => ['ziel' => 'label']],
]);
assert($nurUngueltige === null,
    'ein Rumpf, dessen Eintraege ALLE ungueltig sind, ist `null`, kein leeres Array: ' . json_encode($nurUngueltige));
$pruefungen++;

// =================================================================================================
// --- 🔴 RULING 13 (geparkter Befund aus Aufgabe 2, nachgezogen 06.09.2026): AUCH DIE RUECKNAHME
// KAPPT IHREN GRUND AUF 300 ZEICHEN. `avesmapsGaretienRuecknahmeAusfuehren` laeuft ueber DIESELBE
// Tuer wie die Uebernahme (api/edit/map/garetien-import.php, Aktion 'ruecknahme') und ist NICHT
// admin-only -- dieselbe Editor-Population, die bei `apply` schon geschuetzt ist. Ein Item mit
// einem sehr langen, unbekannten `ziel` loest den Zweig "unbekanntes Ziel ... -- keine Ruecknahme
// moeglich" aus (der 'new'-Zweig, ohne Settlement-Place, ohne 'path'/'location'/'label'/'region'),
// und dessen Meldung enthaelt das ziel woertlich -- lang genug, um das Kappen zu pruefen, ohne
// irgendein Kartenobjekt anzufassen.
$pdo4 = avesmapsGaretienEinstellungenJeItemTestPdo();
$runId4 = 1;
$langesZiel = str_repeat('Z', 400);
$idLang = avesmapsGaretienEinstellungenJeItemAnlegen($pdo4, $runId4, 'unbekannt-lang', 'Unbekanntes Ziel', [
    'herkunft' => 'garetien',
    'ziel' => $langesZiel,
    'subtyp' => 'dorf',
]);
// 🔴 DIE RUECKNAHME PRUEFT „UEBERNOMMEN", NICHT DEN PLANBAU -- also von Hand auf 'done' gesetzt,
// samt einer (erfundenen) public_id in `apply_note`, genau wie `avesmapsGaretienItemAbschliessen`
// es fuer ein wirklich angelegtes Objekt getan haette.
$pdo4->prepare('UPDATE sync_plan_item SET apply_state = :s, apply_note = :n WHERE id = :id')
    ->execute(['s' => 'done', 'n' => 'irgendeine-public-id', 'id' => $idLang]);
$ruecknahme = avesmapsGaretienRuecknahmeAusfuehren($pdo4, $runId4, [$idLang], ['id' => 1]);
assert($ruecknahme['zurueckgenommen'] === 0, 'nichts wurde zurueckgenommen -- das Ziel ist unbekannt: ' . json_encode($ruecknahme));
assert(count($ruecknahme['fehler']) === 1, 'genau ein Fehlschlag: ' . json_encode($ruecknahme['fehler']));
$grundLang = $ruecknahme['fehler'][0]['grund'];
assert(strlen($grundLang) <= 300,
    '💣 auch die Ruecknahme kappt ihren Grund auf 300 Zeichen, nicht ' . strlen($grundLang) . ': ' . $grundLang);
assert(str_contains($grundLang, str_repeat('Z', 100)), 'und es ist der ECHTE Text, kein Platzhalter: ' . $grundLang);
$pruefungen += 3;

// =================================================================================================
// --- 🔴 RULING 13, ZWEITER PFAD (Ruecklauf des Koordinators, 06.09.2026): DER 'changed'/QUELLE-
// ONLY-ZWEIG DER RUECKNAHME WAR UNGEDECKT -- die erste Probe oben faengt nur den 'new'-Zweig.
// Der Weg hinein, wie vom Pruefer benannt: ein 'changed'-Item mit `felder: ['quelle']`, gesetzter
// `entity_public_id`, `apply_state='done'` und einem unbekannten, 400 Zeichen langen `ziel` --
// `avesmapsGaretienQuellenZiel` wirft den Zielnamen woertlich
// ('Unbekanntes Ziel "..." -- es ist nicht entscheidbar, wo die Quelle haengen soll.').
$pdo5 = avesmapsGaretienEinstellungenJeItemTestPdo();
$runId5 = 1;
$langesZielC = str_repeat('Q', 400);
$idLangC = avesmapsGaretienEinstellungenJeItemAnlegen($pdo5, $runId5, 'quelle-changed-lang', 'Quelle mit langem Ziel', [
    'herkunft' => 'garetien',
    'felder' => ['quelle'],
    'ziel' => $langesZielC,
]);
// ⚠️ DREI Spalten von Hand gesetzt, nicht nur `apply_state`: der Zweig verlangt `change_type =
// 'changed'` (der Helfer legt immer 'new' an) UND eine nicht-leere `entity_public_id` (das ZIEL
// der Ergaenzung, geprueft VOR dem Aufruf, der wirft).
$pdo5->prepare('UPDATE sync_plan_item SET change_type = :ct, entity_public_id = :pid, apply_state = :s WHERE id = :id')
    ->execute(['ct' => 'changed', 'pid' => 'irgendein-bestandsobjekt', 's' => 'done', 'id' => $idLangC]);
$ruecknahmeC = avesmapsGaretienRuecknahmeAusfuehren($pdo5, $runId5, [$idLangC], ['id' => 1]);
assert($ruecknahmeC['zurueckgenommen'] === 0,
    'nichts wurde zurueckgenommen -- das Ziel ist unbekannt: ' . json_encode($ruecknahmeC));
assert(count($ruecknahmeC['fehler']) === 1, 'genau ein Fehlschlag: ' . json_encode($ruecknahmeC['fehler']));
$grundLangC = $ruecknahmeC['fehler'][0]['grund'];
assert(strlen($grundLangC) <= 300,
    '💣 auch der quelle-only-Zweig der Ruecknahme kappt seinen Grund auf 300 Zeichen, nicht '
    . strlen($grundLangC) . ': ' . $grundLangC);
assert(str_contains($grundLangC, str_repeat('Q', 100)), 'und es ist der ECHTE Text, kein Platzhalter: ' . $grundLangC);
$pruefungen += 3;

echo "OK ({$pruefungen} Pruefungen)\n";
