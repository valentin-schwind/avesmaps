<?php

declare(strict_types=1);

// Der PASSPUNKTE-ZWEIG des Endpunkts wird hier WIRKLICH AUSGEFUEHRT, nicht gelesen.
//
// 💣 WARUM DAS NOETIG IST. Bibliothek und Tuer sind einzeln gruen -- die Naht dazwischen war es
// damit nicht. Ein Tippfehler im Funktionsnamen, ein vergessenes `require_once`, eine Konstante
// vor ihrer Definition: PHP antwortet auf so etwas mit einem Fatal Error und einem LEEREN Rumpf,
// und im Browser steht dann "Unexpected end of JSON input" -- das sieht wie ein Netzfehler aus,
// nicht wie ein Programmfehler. Genau diese Falle hat die Weg-Ebene am 19.08.2026 einen Anlauf
// gekostet (AGENTS.md: "PHP hoistet Funktionen, aber keine const auf Dateiebene").
//
// ⚠️ Der Owner kann diesen Zweig nur mit angemeldeter Sitzung und MySQL fahren. Dieser Test ist
// das Naechstbeste: dieselben Zeilen, dieselbe Reihenfolge, gegen eine SQLite-Attrappe.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=pdo_sqlite \
//           -d extension=mbstring \
//           api/_internal/import/__tests__/garetien-passpunkte-endpunkt-test.php

require_once __DIR__ . '/../garetien-passpunkte-lesen.php';

$pruefungen = 0;
function pruefe(bool $bedingung, string $warum): void
{
    global $pruefungen;
    assert($bedingung, $warum);
    $pruefungen++;
}

/** Die Antwort des Endpunkts abfangen, statt den Prozess zu beenden. */
final class AvesmapsTestAntwort extends RuntimeException
{
    // ⚠️ NICHT `$code` -- Exception traegt diese Eigenschaft schon, und sie noch einmal als
    // readonly zu deklarieren ist ein Fatal Error.
    public function __construct(public readonly int $status, public readonly array $rumpf)
    {
        parent::__construct('Antwort ' . $status);
    }
}
function avesmapsJsonResponse(int $code, array $rumpf = []): never
{
    throw new AvesmapsTestAntwort($code, $rumpf);
}

// ---- Den Zweig aus dem Endpunkt ausschneiden -------------------------------------------------
//
// ⚠️ `eval` auf REPO-EIGENEN Quelltext, nie auf eine Eingabe -- die Datei liegt im selben Baum.
$quelle = file_get_contents(__DIR__ . '/../../../edit/map/garetien-import.php');
$start  = strpos($quelle, "if (\$action === 'passpunkte') {");
pruefe($start !== false, 'der passpunkte-Zweig muss im Endpunkt stehen');

// Bis zur schliessenden Klammer auf Spaltenanfang -- zeilenendenneutral, weil die
// Arbeitskopie CRLF tragen kann und die CI LF (AGENTS.md §9).
$rest = str_replace("\r\n", "\n", substr($quelle, $start));
$ende = strpos($rest, "\n    }\n");
pruefe($ende !== false, 'das Ende des Zweigs muss auffindbar sein');
$zweig = substr($rest, 0, $ende + strlen("\n    }\n"));

pruefe(str_contains($zweig, 'avesmapsGaretienPasspunkteLesen'), 'der Zweig ruft den Leser');
pruefe(str_contains($zweig, 'avesmapsGaretienPasspunktUrteil'), 'und faellt ein Urteil');

// ---- Eine Attrappe beider Karten, gross genug fuer ein echtes Urteil -------------------------
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE garetien_import_run (id INTEGER PRIMARY KEY)');
$pdo->exec('CREATE TABLE garetien_import_row (id INTEGER PRIMARY KEY, run_id INTEGER, typ TEXT,'
    . ' anzeige TEXT, artikel TEXT, geo_art TEXT, geo TEXT)');
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, name TEXT,'
    . ' feature_type TEXT, feature_subtype TEXT, is_active INTEGER, geometry_json TEXT)');
$pdo->exec('INSERT INTO garetien_import_run (id) VALUES (3)');

$det = AVESMAPS_GARETIEN_MATRIX_XX * AVESMAPS_GARETIEN_MATRIX_YY
     - AVESMAPS_GARETIEN_MATRIX_XY * AVESMAPS_GARETIEN_MATRIX_YX;
// 💣 ZWEI NAMEN FUER DENSELBEN WERT, nicht zweimal `:n`. MySQL lehnt einen doppelt
// verwendeten Platzhalter bei nativen Prepared Statements mit HY093 ab (EMULATE_PREPARES
// => false), und ein SQLite-Test bleibt dabei gruen -- die Falle, die "Was ist hier?" schon
// einmal gekostet hat. Gefangen hat das hier `sql-platzhalter-einmalig-test.php`, ein Test
// aus einem ganz anderen Verzeichnis: der Grund, warum vor dem Push das GANZE Feld laeuft.
$zeile = $pdo->prepare('INSERT INTO garetien_import_row (run_id, typ, anzeige, artikel, geo_art, geo)'
    . " VALUES (3, 'Dorf', :n, :n2, 'koordinaten', :g)");
$ort = $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype,'
    . " is_active, geometry_json) VALUES (:p, :n, 'location', 'dorf', 1, :g)");

for ($i = 0; $i < 30; $i++) {
    $name = 'Ort' . $i;
    $ax = 500.0 + ($i % 6) * 12.0;
    $ay = 520.0 + intdiv($i, 6) * 9.0;
    // Ein kleiner, aber echter Versatz -- damit die Zahlen nicht alle null sind.
    $zx = $ax + 0.4;
    $zy = $ay - 0.3;
    $ux = $zx - AVESMAPS_GARETIEN_MATRIX_X0;
    $uy = $zy - AVESMAPS_GARETIEN_MATRIX_Y0;
    $gx = (AVESMAPS_GARETIEN_MATRIX_YY * $ux - AVESMAPS_GARETIEN_MATRIX_XY * $uy) / $det;
    $gy = (AVESMAPS_GARETIEN_MATRIX_XX * $uy - AVESMAPS_GARETIEN_MATRIX_YX * $ux) / $det;
    $zeile->execute([':n' => $name, ':n2' => $name, ':g' => "{$gx} {$gy}"]);
    $ort->execute([':p' => 'pid' . $i, ':n' => $name,
                   ':g' => json_encode(['type' => 'Point', 'coordinates' => [$ax, $ay]])]);
}

// ---- Und jetzt wirklich fahren ---------------------------------------------------------------
$action  = 'passpunkte';
$payload = ['action' => 'passpunkte'];

$antwort = null;
try {
    eval($zweig);
} catch (AvesmapsTestAntwort $a) {
    $antwort = $a;
}

pruefe($antwort !== null, 'der Zweig MUSS antworten -- kein Fatal, kein Durchfallen');
pruefe($antwort->status === 200, 'und zwar mit 200, gekommen: ' . ($antwort->status ?? 0));

$r = $antwort->rumpf;
pruefe(($r['ok'] ?? false) === true, 'ok muss true sein');

// --- Jeder Schluessel, den das Mockup und der Handgriff aus §6 des Entwurfs erwarten.
// 💣 Ein fehlender Schluessel ist hier STILL: das Mockup zeichnet dann einen leeren Kasten,
// und das liest sich wie "nichts gefunden" statt wie "falsch verdrahtet".
foreach (['bericht', 'selbstpruefung', 'passpunkte', 'residuen', 'nachbarprobe',
          'urteil', 'globaler_versatz', 'west_sued_trend'] as $schluessel) {
    pruefe(array_key_exists($schluessel, $r), "die Antwort muss `{$schluessel}` tragen");
}

pruefe(count($r['residuen']) === 30, '30 Passpunkte, gefunden: ' . count($r['residuen']));
pruefe($r['bericht']['lauf'] === 3, 'der Lauf wird genannt');
pruefe(count($r['nachbarprobe']) === 3, 'drei k-Werte');
foreach ($r['nachbarprobe'] as $p) {
    pruefe(!array_key_exists('punkte', $p),
        'die Einzelpunkte duerfen NICHT doppelt reisen -- sie stehen schon in `residuen`');
}

// --- 🔴 EIN KONSTANTER VERSATZ IST DER BILLIGSTE KORRIGIERBARE FALL, und beide Messungen
// muessen ihn finden -- unabhaengig voneinander und mit derselben Zahl.
//
// 🪤 Hier stand zuerst das Gegenteil: "ein konstanter Versatz ist kein zusammenhaengendes
// Feld, die Nachbarprobe darf daraus KEIN traegt machen". Das war geraten und ist falsch --
// nachgemessen gibt derselbe Datensatz Gewinn +1,50, Einigkeit 1,00, 100 % besser, also
// "traegt", und zwar voellig zu Recht: wenn jeder Ort denselben Versatz traegt, sagt der
// Nachbar ihn perfekt voraus. Die alte Zusicherung war so weit gefasst (`traegt` ODER
// `traegt_nicht`), dass sie den Irrtum nicht bemerkt hat. ⭐ Die Lehre ist die des Hauses:
// eine Aussage in einem Kommentar wird gemessen, nicht behauptet -- sonst deckt der
// Kommentar spaeter genau den Fehler, den er erklaeren sollte.
pruefe($r['urteil']['stufe'] === 'traegt',
    'ein konstanter Versatz MUSS als korrigierbar erkannt werden: ' . $r['urteil']['stufe']);

// Und die zweite, unabhaengige Messung muss dieselbe Zahl nennen. Das ist die eigentliche
// Zusicherung dieses Abschnitts: zwei Wege, ein Ergebnis.
pruefe(abs($r['globaler_versatz']['versatz_dx'] - 1.2) < 0.01,
    'der konstante Versatz muss in globaler_versatz stehen: ' . $r['globaler_versatz']['versatz_dx']);
pruefe(abs($r['globaler_versatz']['versatz_dy'] + 0.9) < 0.01,
    'auch in y: ' . $r['globaler_versatz']['versatz_dy']);
pruefe(abs($r['nachbarprobe'][1]['nachher_median']) < 0.01,
    'die Nachbarprobe muss ihn restlos wegnehmen: ' . $r['nachbarprobe'][1]['nachher_median']);
pruefe(abs($r['nachbarprobe'][1]['uebereinstimmung'] - 1.0) < 0.01,
    'und die Nachbarn sind sich vollstaendig einig: ' . $r['nachbarprobe'][1]['uebereinstimmung']);

// --- Die Selbstpruefung geht durch: die Paare sind aus der ausgelieferten Matrix gebaut.
pruefe($r['selbstpruefung']['ok'] === true,
    'saubere Paare muessen die Selbstpruefung bestehen: ' . $r['selbstpruefung']['warnung']);

// --- Und die Antwort ist wirklich JSON-faehig (keine NAN/INF aus einer Division).
// 💣 json_encode gibt bei NAN oder INF `false` zurueck, und der Endpunkt schickte dann einen
// leeren Rumpf -- wieder "Unexpected end of JSON input" beim Owner.
pruefe(json_encode($r) !== false, 'die Antwort muss sich kodieren lassen (kein NAN/INF)');

echo "OK: {$pruefungen} Pruefungen\n";
