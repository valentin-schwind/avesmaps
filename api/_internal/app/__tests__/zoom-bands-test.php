<?php
// api/_internal/app/__tests__/zoom-bands-test.php
declare(strict_types=1);

/**
 * Die Zoombänder als Speicher: Prüfung, Schreiben, Rücklesen, Zurücksetzen.
 * Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §4, §5.3
 *
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/app/__tests__/zoom-bands-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../app-setting.php';
require_once __DIR__ . '/../zoom-bands.php';

/**
 * SQLite spricht kein MySQL. Zwei Stellen werden übersetzt, sonst nichts:
 *  - das CREATE TABLE aus avesmapsAppSettingEnsureTable (ENGINE=InnoDB kennt SQLite nicht)
 *  - das ON DUPLICATE KEY UPDATE aus avesmapsAppSettingSet
 * Dieselbe Bauart wie api/_internal/conflicts/__tests__/conflict-keeper-test.php.
 */
final class AvesmapsZoomBandsTestPdo extends PDO
{
    public function exec($statement): int|false
    {
        if (str_contains((string) $statement, 'CREATE TABLE IF NOT EXISTS app_setting')) {
            return parent::exec(
                'CREATE TABLE IF NOT EXISTS app_setting (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL,
                    updated_at TEXT
                )'
            );
        }
        return parent::exec($statement);
    }

    public function prepare($query, $options = []): PDOStatement|false
    {
        $query = str_replace(
            'ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
            'ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value',
            (string) $query
        );
        return parent::prepare($query, $options);
    }
}

$pdo = new AvesmapsZoomBandsTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
avesmapsAppSettingEnsureTable($pdo);

$gueltig = [
    'version' => 1,
    'marker' => ['dorf' => [null, null, 1.33, 2.54, 4.86, 9.28, 17.74, 17.74]],
    'label' => ['dorf' => [null, null, null, null, 10, 11, 11, 11]],
    'abstaende' => ['spalt' => 12.5, 'repel' => 5.25, 'versatz' => 1.5],
];

// ============================================================ A. Die Prüfung

assert(avesmapsZoomBandsValidate($gueltig) !== null, 'eine wohlgeformte Tafel wird angenommen');

// 🔴 Was abgelehnt wird -- und jeder Fall einzeln, weil ein durchgerutschter Wert im Browser
// jedes Besuchers landet.
assert(avesmapsZoomBandsValidate(null) === null, 'null ist keine Tafel');
assert(avesmapsZoomBandsValidate('marker') === null, 'ein String ist keine Tafel');
assert(avesmapsZoomBandsValidate([1, 2, 3]) === null, 'eine Liste ist keine Tafel');
assert(avesmapsZoomBandsValidate(['marker' => 'x', 'label' => []]) === null, 'marker muss ein Objekt sein');
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => 'x'], 'label' => []]) === null, 'eine Zeile ist eine Liste');
assert(avesmapsZoomBandsValidate(['marker' => ['Dorf!' => [1]], 'label' => []]) === null,
    'ein Klassenschluessel ist [a-z_]{1,32}');
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => array_fill(0, 10, 5.0)], 'label' => []]) === null,
    'hoechstens neun Zellen');
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => array_fill(0, 9, 5.0)], 'label' => []]) !== null,
    'genau neun Zellen sind noch gueltig (z0 bis z8)');
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => [0.1]], 'label' => []]) === null,
    'unter der Schranke: 0,1 px');
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => [999.0]], 'label' => []]) === null,
    'ueber der Schranke: 999 px');
assert(avesmapsZoomBandsValidate(['marker' => [], 'label' => ['dorf' => [1.0]]]) === null,
    'unter der Schranke: 1 pt Schrift');
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => ['5']], 'label' => []]) === null,
    'ein String ist keine Zahl -- auch wenn er wie eine aussieht');

// 💣 DIE VERENGTE OBERGRENZE, SCHARF GEPRUEFT (200 px -> 100 px, 96 pt -> 30 pt). 999.0 und die
// alte Grenze lagen beide schon ausserhalb -- dieser Wert allein wuerde eine vergessene Verengung
// nicht bemerken. 150 px und 50 pt liegen GENAU in der Luecke: frueher gueltig, jetzt nicht mehr.
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => [150.0]], 'label' => []]) === null,
    'ueber der NEUEN Schranke (100 px), aber unter der ALTEN (200 px)');
assert(avesmapsZoomBandsValidate(['marker' => [], 'label' => ['dorf' => [50.0]]]) === null,
    'ueber der NEUEN Schranke (30 pt), aber unter der ALTEN (96 pt)');
// Die neue Obergrenze selbst ist einschliesslich (<=), nicht ausschliesslich.
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => [100.0]], 'label' => []]) !== null,
    'genau 100 px ist noch gueltig');
assert(avesmapsZoomBandsValidate(['marker' => [], 'label' => ['dorf' => [30.0]]]) !== null,
    'genau 30 pt ist noch gueltig');

// ⚠️ null IST erlaubt: es ist die Aussage "hier nicht".
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => [null, null, 1.33]], 'label' => []]) !== null,
    'null ist ein gueltiger Zellwert');

// ============================================================ A2. Aufgabe 8b: die drei Abstaende

// 🔴 RUECKWAERTSKOMPATIBEL: eine Tafel OHNE 'abstaende' (wie jede vor diesem Umbau gespeicherte)
// bleibt gueltig -- ein fehlender Abschnitt ist ein Nichtwissen, keine Ablehnung.
$ohneAbstaende = avesmapsZoomBandsValidate(['marker' => ['dorf' => [1.0]], 'label' => []]);
assert($ohneAbstaende !== null, 'eine Tafel ohne abstaende bleibt gueltig');
assert(!array_key_exists('abstaende', $ohneAbstaende), 'und bekommt keinen erfundenen Abschnitt untergeschoben');

// ⚠️ 10.5 statt 10.0: json_encode/json_decode macht aus einer GANZEN Zahl still einen PHP-int
// (10.0 -> "10" -> int(10)), und der waere unter === kein 10.0 mehr -- dieselbe Falle, wegen der die
// marker/label-Tests oben schon mit Nicht-ganzen Zahlen (9.28, 17.74, …) arbeiten, nicht mit 10 selbst.
$mitAbstaenden = avesmapsZoomBandsValidate(['marker' => [], 'label' => [], 'abstaende' => ['spalt' => 10.5, 'repel' => 0.0]]);
assert($mitAbstaenden !== null, 'ein wohlgeformter abstaende-Abschnitt wird angenommen');
assert($mitAbstaenden['abstaende']['spalt'] === 10.5, 'und der Wert steht unveraendert drin');
assert($mitAbstaenden['abstaende']['repel'] == 0.0, '0 ist gueltig (Untergrenze, einschliesslich)');

assert(avesmapsZoomBandsValidate(['marker' => [], 'label' => [], 'abstaende' => 'kaputt']) === null,
    'abstaende muss ein Objekt sein');
assert(avesmapsZoomBandsValidate(['marker' => [], 'label' => [], 'abstaende' => ['Spalt!' => 4.0]]) === null,
    'ein Abstands-Schluessel ist [a-z_]{1,32}, wie ein Klassenschluessel');
assert(avesmapsZoomBandsValidate(['marker' => [], 'label' => [], 'abstaende' => ['spalt' => '4']]) === null,
    'ein String ist keine Zahl -- auch als Abstand nicht');
// 💣 KEIN null bei einem Abstand: anders als eine Zellenreihe hat er keine "hier nicht"-Aussage.
assert(avesmapsZoomBandsValidate(['marker' => [], 'label' => [], 'abstaende' => ['spalt' => null]]) === null,
    'null ist bei einem Abstand KEIN gueltiger Wert (anders als bei einer Zelle)');
assert(avesmapsZoomBandsValidate(['marker' => [], 'label' => [], 'abstaende' => ['spalt' => -0.5]]) === null,
    'unter der Schranke: -0,5 px');
assert(avesmapsZoomBandsValidate(['marker' => [], 'label' => [], 'abstaende' => ['spalt' => 300.5]]) === null,
    'ueber der Schranke: 300,5 px');
// Die Obergrenze selbst ist einschliesslich (<=), nicht ausschliesslich -- wie bei marker/label.
assert(avesmapsZoomBandsValidate(['marker' => [], 'label' => [], 'abstaende' => ['spalt' => 300.0]]) !== null,
    'genau 300 px ist noch gueltig');
// 🔴 22.08.2026 -- DIE SCHRANKE HIER IST DIE WEITESTE, NICHT DIE ENGSTE. Seit der Drift-Deckel
// (0-300) dazugekommen ist, kann der Server nicht mehr je Schluessel pruefen: er fuehrt bewusst
// keine Schluesselliste. 30 px sind fuer 'spalt' zu viel und kommen hier TROTZDEM durch -- geklemmt
// wird im Browser, gegen seine eigene engere Schranke (avesmapsLocationLabelSpacingLimits,
// js/map-features/__tests__/zoombaender-drift.test.js Abschnitt E). Dieselbe Arbeitsteilung wie bei
// marker/label, wo der Server die Klassennamen ebenfalls nicht kennt.
assert(avesmapsZoomBandsValidate(['marker' => [], 'label' => [], 'abstaende' => ['spalt' => 30.0]]) !== null,
    'der Server prueft die FORM, nicht die enge Bedeutung eines einzelnen Schluessels');
// ⚠️ Der Server fuehrt KEINE feste Liste (spalt/repel/versatz) -- das entscheidet der Browser gegen
// seine eigene Vorgabetafel, dieselbe Regel wie bei den Klassenschluesseln von marker/label.
assert(avesmapsZoomBandsValidate(['marker' => [], 'label' => [], 'abstaende' => ['hauptstadt' => 5.0]]) !== null,
    'ein unbekannter Abstands-Schluessel wird angenommen (der Browser ignoriert ihn spaeter)');

// 8 kB Deckel.
$rieseTafel = ['marker' => [], 'label' => []];
for ($i = 0; $i < 500; $i++) {
    $rieseTafel['marker']['klasse_' . $i] = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
}
assert(avesmapsZoomBandsValidate($rieseTafel) === null, 'ueber 8 kB wird abgelehnt');

// ============================================================ B. Schreiben und Ruecklesen

$geprueft = avesmapsZoomBandsValidate($gueltig);
assert(avesmapsZoomBandsWrite($pdo, $geprueft) === true, 'der Schreibvorgang meldet Erfolg');

$gelesen = avesmapsZoomBandsRead($pdo);
assert($gelesen['bands'] !== null, 'danach steht etwas da');
assert($gelesen['bands']['marker']['dorf'][5] === 9.28, 'und es ist das Geschriebene');
assert($gelesen['bands']['abstaende']['spalt'] === 12.5, 'und die Abstaende reisen mit -- derselbe Speicher, kein zweiter');
assert($gelesen['stamp'] !== '', 'der Stempel ist gesetzt');

// ============================================================ C. Zuruecksetzen LOESCHT die Zeile

avesmapsZoomBandsReset($pdo);
$nachher = avesmapsZoomBandsRead($pdo);
assert($nachher['bands'] === null, 'nach dem Zuruecksetzen ist NICHTS gespeichert');
// 🔴 Kein Abbild der Vorgabewerte -- der Server kennt sie nicht, und eine Kopie in der Datenbank
// veraltet beim naechsten Mal, wenn jemand die Vorgabe im Browser aendert.
$zeilen = $pdo->query("SELECT COUNT(*) FROM app_setting WHERE setting_key = 'location_zoom_bands'")
    ->fetchColumn();
assert((int) $zeilen === 0, 'die Zeile ist weg, nicht leer');

// ============================================================ D. Die Rueckleseprobe

// 💣 DER GRUND, WARUM ES SIE GIBT. `setting_value` war einmal VARCHAR(255); MySQL schnitt
// ausserhalb des strikten Modus STILL ab, json_decode lieferte danach NULL, der Leser fiel auf
// seine Konstante zurueck -- von "es wurde nie etwas gespeichert" nicht zu unterscheiden. Genau so
// hat der Speichern-Knopf des Tempowerte-Fensters vom 14.08.2026 an nichts getan und nie geklagt.
//
// ⭐ Simuliert mit einem SQLite-TRIGGER, der jeden frisch eingefuegten Wert nach 40 Zeichen
// abschneidet -- ohne Fehler, genau wie MySQL es tat. Er kann AFTER INSERT bleiben, weil Block C
// die Zeile geloescht hat: der naechste Schreibvorgang nimmt den INSERT-Zweig.
$pdo->exec(
    "CREATE TRIGGER app_setting_kappen AFTER INSERT ON app_setting
     BEGIN
        UPDATE app_setting SET setting_value = substr(setting_value, 1, 40)
         WHERE setting_key = new.setting_key;
     END"
);
assert(avesmapsZoomBandsWrite($pdo, $geprueft) === false,
    'ein still abgeschnittener Wert MUSS als Fehlschlag gemeldet werden');
$pdo->exec('DROP TRIGGER app_setting_kappen');

// ============================================================ E. Ein kaputter Speicherwert

$pdo->exec('DELETE FROM app_setting');
$pdo->exec("INSERT INTO app_setting (setting_key, setting_value) VALUES ('location_zoom_bands', 'kein json')");
$kaputt = avesmapsZoomBandsRead($pdo);
// ⚠️ Nicht vorhanden, nicht "Fehler": die Karte darf an einem kaputten Einstellungswert nicht
// haengenbleiben -- sie hat ihre Vorgabewerte.
assert($kaputt['bands'] === null, 'unlesbares JSON gilt als nicht vorhanden');

echo "zoom-bands: alle Zusicherungen erfuellt\n";
