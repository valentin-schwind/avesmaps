<?php

declare(strict_types=1);

/**
 * 💣 EINE ANTWORT, DIE NICHT DURCH DEN TRICHTER GEHT, IST DESHALB NOCH KEIN FEHLER. Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-eigener-ausgang-test.php
 *
 * ANLASS (Owner-Screenshot des Panels, 07.09.2026): „Fehlerquote 12,2 %", und die Liste der
 * haeufigsten Fehler fuehrte `app/political-territories` mit 25.828 und `app/map-features` mit
 * 6.692 Faellen des Codes „leer" an. Nachgemessen ist beides KEIN Fehler:
 *   - die politische Ebene antwortet an FUENF Stellen mit eigenen Kopfzeilen und `exit`
 *     (Schnellpfad vor dem PDO, Cache-Treffer, frischer Aufbau, zweimal 304),
 *   - `map-features` gzipt seine Nutzlast selbst und beantwortet ein `If-None-Match` mit 304,
 *   - `zoom-bands` und `ecosystem-display` ebenso mit 304.
 * Ein 304 ist der beste Fall ueberhaupt: null Bytes gehen ueber die Leitung. Repoweit gibt es
 * 38 solcher Ausgaenge in 19 Dateien.
 *
 * 🔴 DIE UNTERSCHEIDUNG IST NICHT „ging etwas raus?", SONDERN „ist etwas GESTORBEN?". Nach einem
 * Fatal meldet PHP haeufig weiterhin 200 -- der Statuscode luegt dann. Was nicht luegt, ist
 * `error_get_last()`: ein Fatal hinterlaesst dort einen HARTEN Typ, ein sauberes `exit` nicht.
 * Genau diese Typenliste fuehrt der Fatal-Melder in bootstrap.php seit jeher; sie wird GETEILT
 * und nicht abgeschrieben.
 *
 * ⚠️ Und die sichere Richtung bleibt gewahrt: im Zweifel gilt eine Anfrage als NICHT abgeschlossen.
 * Ein uebersehener Fatal waere der teure Fehler -- er ist der einzige Grund, aus dem es diese
 * Messung gibt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once dirname(__DIR__) . '/api-metrics.php';

$checks = 0;
$zaehl = static function () use (&$checks): void { $checks++; };

// ===== A) DER TRICHTER SCHLAEGT ALLES ==========================================================
// Ist die Antwort ueber avesmapsJsonResponse gegangen, gilt sie -- samt Status und Fehlercode.
$a = avesmapsApiMetricsAbschluss(['status' => 404, 'code' => 'not_found'], null, true, 200);
assert($a['abgeschlossen'] === true, 'A1: eine Antwort aus dem Trichter ist abgeschlossen');
assert($a['status'] === 404, 'A2: ihr Status kommt aus dem Trichter, nicht aus der Laufzeit');
assert($a['code'] === 'not_found', 'A3: und ihr Fehlercode ebenso');
$zaehl();

// ===== B) EIN SAUBERER EIGENER AUSGANG ZAEHLT ALS ANTWORT ======================================
// Der Fall aus dem Screenshot: 304 oder ein Cache-Treffer, gesendet ohne den Trichter.
$b = avesmapsApiMetricsAbschluss(null, null, true, 304);
assert($b['abgeschlossen'] === true, 'B1: ein eigener Ausgang ohne Fatal ist eine Antwort');
assert($b['status'] === 304, 'B2: sein Status kommt aus der Laufzeit');
assert($b['code'] === null, 'B3: einen Fehlercode hat er nicht');
$zaehl();

$b2 = avesmapsApiMetricsAbschluss(null, null, true, 200);
assert($b2['abgeschlossen'] === true && $b2['status'] === 200, 'B4: dasselbe fuer einen 200er');
$zaehl();

// ⚠️ `http_response_code()` liefert `false`, wenn nie einer gesetzt wurde -- dann gilt der
// PHP-Vorgabewert 200, sonst faellt eine gelungene Antwort in die Klasse „leer".
$b3 = avesmapsApiMetricsAbschluss(null, null, true, null);
assert($b3['abgeschlossen'] === true && $b3['status'] === 200, 'B5: ohne gesetzten Status gilt 200');
$zaehl();

// ===== C) EIN FATAL BLEIBT EIN FATAL ===========================================================
// 🔴 Der Grund, aus dem es diese Messung ueberhaupt gibt. PHP meldet dabei oft weiterhin 200 --
// deshalb entscheidet der letzte Fehler, nicht der Statuscode.
foreach ([E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR] as $harterTyp) {
    $c = avesmapsApiMetricsAbschluss(null, ['type' => $harterTyp, 'message' => 'kaputt'], true, 200);
    assert(
        $c['abgeschlossen'] === false,
        "C1: Fehlertyp {$harterTyp} ist ein Fatal und darf nicht als Antwort zaehlen"
    );
}
$zaehl();

// 💣 EIN FATAL NACH DEM VERSAND AENDERT NICHTS: gingen die Kopfzeilen schon hinaus und stirbt der
// Prozess danach, ist die Antwort trotzdem angekommen.
$c2 = avesmapsApiMetricsAbschluss(['status' => 200, 'code' => null], ['type' => E_ERROR, 'message' => 'danach'], true, 200);
assert($c2['abgeschlossen'] === true, 'C2: eine bereits zugestellte Antwort bleibt zugestellt');
$zaehl();

// 🔴 ABER DER TRICHTER ALLEIN IST KEIN BELEG -- UND DAS IST DIE LUECKE, DIE EIN PRUEFAGENT AM
// 07.09.2026 GEFUNDEN HAT (und die es schon vor diesem Umbau gab).
// `avesmapsApiMetricsMerkeAntwort` laeuft IN `avesmapsJsonResponse`, also BEVOR der Rumpf wirklich
// hinausgeht. Stirbt der Prozess dazwischen -- ein `json_encode`, das wirft, ein Zeitlimit, ein
// Speicherlimit --, dann ist die Antwort gemerkt und NIE gesendet. Sie als 200 zu zaehlen waere
// genau die Luege, gegen die es diese Messung gibt: der Client sieht einen Netzfehler, das Panel
// einen Erfolg.
// ⚠️ Die Unterscheidung ist `headers_sent()`: ohne gesendete Kopfzeilen hat den Client nichts
// erreicht.
$c3 = avesmapsApiMetricsAbschluss(
    ['status' => 200, 'code' => null],
    ['type' => E_ERROR, 'message' => 'zwischen Merken und Senden gestorben'],
    false,
    200
);
assert(
    $c3['abgeschlossen'] === false,
    'C3: gemerkt, aber nie gesendet -- das ist ein Fatal, kein Erfolg'
);
$zaehl();

// ⚠️ Und die Gegenprobe, damit der Riegel nicht zu weit greift: OHNE Fatal ist ein noch nicht
// gesendeter Kopf normal -- der Shutdown-Handler laeuft, bevor PHP den Puffer leert.
$c4 = avesmapsApiMetricsAbschluss(['status' => 204, 'code' => null], null, false, 204);
assert(
    $c4['abgeschlossen'] === true,
    'C4: ohne Todesursache bleibt eine gemerkte Antwort gueltig, auch wenn die Kopfzeilen noch warten'
);
$zaehl();

// ===== D) EINE WARNUNG IST KEIN FATAL ==========================================================
// ⚠️ `error_get_last()` traegt auch harmlose Meldungen -- eine unterdrueckte Warnung von irgendwo
// weiter oben wuerde sonst jede gelungene Antwort in die Fehlerquote kippen.
foreach ([E_WARNING, E_NOTICE, E_DEPRECATED, E_USER_WARNING, E_USER_NOTICE] as $weicherTyp) {
    $d = avesmapsApiMetricsAbschluss(null, ['type' => $weicherTyp, 'message' => 'nur eine Warnung'], true, 304);
    assert(
        $d['abgeschlossen'] === true,
        "D1: Fehlertyp {$weicherTyp} ist keine Todesursache -- die Antwort zaehlt"
    );
}
$zaehl();

// ===== E) OHNE GESENDETE KOPFZEILEN IST NICHTS HERAUSGEGANGEN ==================================
// 🔴 Die sichere Richtung: wer weder durch den Trichter kam noch je etwas gesendet hat, hat nicht
// geantwortet. Das ist der Zustand, in dem ein Zeitlimit mitten in der Arbeit zuschlaegt.
$e = avesmapsApiMetricsAbschluss(null, null, false, 200);
assert($e['abgeschlossen'] === false, 'E1: ohne gesendete Kopfzeilen gilt die Anfrage als gestorben');
$zaehl();

// ===== F) DIE TYPENLISTE IST GETEILT, NICHT ABGESCHRIEBEN ======================================
// 💣 Zwei Listen laufen beim naechsten Fehlertyp auseinander, und der Unterschied waere STILL:
// der Fatal-Melder schriebe eine Zeile ins Protokoll, waehrend der Zaehler die Anfrage als
// gelungen verbucht. Dieselbe Lehre wie ueberall im Haus.
// …/api/_internal/analytics/__tests__ -> zwei Ebenen hoch ist …/api/_internal
$bootstrap = str_replace("\r\n", "\n", (string) file_get_contents(dirname(__DIR__, 2) . '/bootstrap.php'));
assert($bootstrap !== '', 'F0: bootstrap.php ist lesbar -- sonst prueft F1 nichts');
assert(
    str_contains($bootstrap, 'AVESMAPS_HARTE_FEHLERTYPEN'),
    'F1: der Fatal-Melder in bootstrap.php liest die geteilte Typenliste'
);
assert(
    defined('AVESMAPS_HARTE_FEHLERTYPEN'),
    'F2: und die Liste steht bei der Messung, die sie ebenfalls braucht'
);
assert(
    in_array(E_ERROR, AVESMAPS_HARTE_FEHLERTYPEN, true)
        && in_array(E_PARSE, AVESMAPS_HARTE_FEHLERTYPEN, true)
        && !in_array(E_WARNING, AVESMAPS_HARTE_FEHLERTYPEN, true),
    'F3: sie nennt die harten Typen und keine Warnung'
);
$zaehl();

// ===== G) `ohne_verbindung` IST KEIN ENDPUNKT ==================================================
// 🪤 Im Screenshot steht es zwischen den meistgerufenen Endpunkten, mit 17.817 -- es ist aber eine
// Zusatzmarke fuer Anfragen, die keine Datenbank gebraucht haben, und sie kommt ZUSAETZLICH zur
// Zeile des echten Endpunkts. Gezaehlt wie ein Endpunkt blaeht sie die Gesamtsumme auf, und ihr
// Anteil mit der Klasse „leer" faellt obendrein in die Fehlerquote.
$aufgeteilt = avesmapsApiMetricsAufteilen([
    ['dimension' => 'app/map-features|2xx', 'c' => 100],
    ['dimension' => 'app/map-features|3xx', 'c' => 40],
    ['dimension' => 'edit/map/features|4xx', 'c' => 10],
    ['dimension' => 'ohne_verbindung|ja', 'c' => 60],
    ['dimension' => 'ohne_verbindung|leer', 'c' => 5],
]);

$endpunkte = array_column($aufgeteilt['endpunkte'], 'c', 'dimension');
assert(
    !array_key_exists('ohne_verbindung', $endpunkte),
    'G1: `ohne_verbindung` steht nicht in der Endpunktliste -- gelesen: '
        . implode(', ', array_keys($endpunkte))
);
assert(
    ($endpunkte['app/map-features'] ?? 0) === 140,
    'G2: die echten Endpunkte zaehlen unveraendert weiter'
);
$zaehl();

$klassen = array_column($aufgeteilt['klassen'], 'c', 'dimension');
assert(
    array_sum($klassen) === 150,
    'G3: die Gesamtsumme zaehlt jede Anfrage EINMAL (erwartet 150, gelesen ' . array_sum($klassen) . ')'
);
assert(
    !array_key_exists('ja', $klassen),
    'G4: und die Marke „ja" ist keine Antwortklasse'
);
$zaehl();

// ⭐ Verloren geht sie nicht -- sie bekommt ihr eigenes Feld, damit das Panel sie weiter zeigen kann.
assert(
    ($aufgeteilt['ohne_verbindung'] ?? null) === 65,
    'G5: die Zahl bleibt erhalten, nur an ihrem eigenen Platz -- gelesen: '
        . var_export($aufgeteilt['ohne_verbindung'] ?? null, true)
);
$zaehl();

// ===== H) UND DAS PANEL ZEIGT SIE AUCH DORT =====================================================
// 💣 Ein Feld ohne Leser ist genau die Falle, die dieses Haus schon einmal bezahlt hat
// (`wiki_sync_pages.details_json`: jahrelang geschrieben, nie gelesen).
// vier Ebenen hoch ist das Repo-Wurzelverzeichnis
$panel = str_replace("\r\n", "\n", (string) file_get_contents(
    dirname(__DIR__, 4) . '/js/review/review-api-metrics.js'
));
assert($panel !== '', 'H0: das Panel ist lesbar -- sonst prueft H1 nichts');
// ⚠️ Nicht bloss „das Wort kommt vor": geprueft wird, dass die Zahl aus dem NEUEN Feld gelesen
// wird. Ein blosser Text ueber Zwischenspeicher-Treffer waere ein Satz ohne Messung dahinter.
assert(
    str_contains($panel, 'm.ohne_verbindung'),
    'H1: das Panel liest die Zahl aus dem eigenen Feld, statt sie nur zu erwaehnen'
);
// 💣 Und sie darf NICHT mehr aus der Endpunktliste kommen -- dort steht sie seit heute nicht mehr,
// ein Leser von dort bekaeme dauerhaft nichts und zeigte stumm eine Null.
assert(
    !preg_match('/endpunkte[^\n]*ohne_verbindung|ohne_verbindung[^\n]*endpunkte/', $panel),
    'H2: und nicht mehr aus der Endpunktliste'
);
$zaehl();

echo "OK  A-B: der Trichter belegt die Antwort, und ein sauberer eigener Ausgang zaehlt ebenso.\n";
echo "OK  C:   ein Fatal bleibt ein Fatal -- auch mit gemerkter, aber nie gesendeter Antwort.\n";
echo "OK  D-E: eine Warnung ist keine Todesursache, und ohne gesendete Kopfzeilen gilt nichts.\n";
echo "OK  F:   die Typenliste ist geteilt, nicht abgeschrieben.\n";
echo "OK  G-H: `ohne_verbindung` ist kein Endpunkt mehr -- und bleibt trotzdem sichtbar.\n";
echo "    {$checks} Gruppen gruen.\n";
