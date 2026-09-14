<?php

declare(strict_types=1);

/**
 * Der Wappen-Notaus haelt auch gegen `?edit_mode=1` -- die Editor-Sicht gibt es NUR mit Anmeldung.
 *
 * 🔴 DER BEFUND (Sitzung „Performance Besuchersicht Paket 1", 27.08.2026; Owner-Entscheid 14.09.2026
 * „beheben"): DREI oeffentliche Lesepfade hoben den Notaus fuer JEDEN auf, der `edit_mode=1` an die
 * Adresse haengte, ohne jede Rechtepruefung --
 *   - api/app/map-features.php (Wappen an Orten und in der Hierarchiezeile),
 *   - api/app/territory-detail.php (Wappen in der Infobox eines Gebiets),
 *   - die politische Ebene (api/_internal/political/territories-endpoint.php), die dort sogar die
 *     komplette EDITOR-Ebene lieferte (avesmapsPoliticalReadEditorLayer), nicht nur die Wappen.
 * Der Notaus besteht aus rechtlichen Gruenden (NOTICE.md, Ulisses-Fanrichtlinien). Ein Schalter, den
 * ein Adressparameter aufhebt, ist keiner -- und einer, der nur eine von drei Tueren schliesst, auch nicht.
 *
 * 💣 DIE FALLE, UND DESHALB FAEHRT DIESER TEST DIE ENDPUNKTE STATT IHREN QUELLTEXT ZU LESEN.
 * map-features.php und die politische Ebene haben einen Ganzkoerper-Dateicache mit Schnellpfad, und
 * `edit_mode` steckt in dessen Schluessel (ETag-Keim bzw. Cache-Datei). Eine Rechtepruefung nur im
 * AUFBAU liesse den Schnellpfad einem anonymen `edit_mode=1` weiter die Editor-Fassung aus dem Vorrat
 * reichen, und die 304-Pruefung bestaetigte ihm ein Editor-ETag. Die Variante muss an der ANMELDUNG
 * haengen, nicht am Parameter. Deshalb laufen hier die ECHTEN Rumpfzeilen der drei Endpunkte
 * (herausgeschnitten, nur Konfiguration und Datenbankverbindung ersetzt) in Kindprozessen mit ECHTEN
 * Sitzungsdateien -- und der Vorrat ist mit BEIDEN Fassungen vorbelegt.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis (Windows; unter Linux sind die Erweiterungen eingebaut):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/__tests__/edit-mode-riegel-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'. Neu starten mit: "
        . "php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

$WURZEL = dirname(__DIR__, 3);

$fehler = 0;
function pruefe(bool $ok, string $was): void
{
    global $fehler;
    if (!$ok) {
        $fehler++;
        fwrite(STDERR, "ROT: {$was}\n");
    }
}

// ⚠️ Die Abschlussroutine des API-Zaehlers (bootstrap.php) bleibt aus -- in diesem Prozess wie in den
// Kindern. Sie saehe sonst nach einer config.local.php, und in einem Checkout, der eine hat, soll ein
// Test nie auch nur in die Naehe einer echten Datenbank kommen.
define('AVESMAPS_API_METRICS_REGISTRIERT', true);
require_once $WURZEL . '/api/_internal/auth.php';

// ---- Spielplatz: eigene Sitzungen, eigenes Temp (also eigener Vorrat) -----------------------------
$spielplatz = sys_get_temp_dir() . '/avesmaps-edit-mode-riegel-' . getmypid();
$sitzungen = $spielplatz . '/sitzungen';
$temp = $spielplatz . '/temp';
@mkdir($sitzungen, 0775, true);
@mkdir($temp, 0775, true);

$sitzungsId = static fn (string $rolle): string => 'emr' . getmypid() . $rolle;
$keks = static fn (string $rolle): array => [session_name() => $sitzungsId($rolle)];

// ECHTE Sitzungsdateien, geschrieben ueber PHPs eigenen Mechanismus. Vor jeder Ausgabe dieses Prozesses.
ini_set('session.save_path', $sitzungen);
$benutzer = [
    'admin' => ['id' => 1, 'username' => 'test-admin', 'role' => 'admin'],
    'editor' => ['id' => 2, 'username' => 'test-editor', 'role' => 'editor'],
    'reviewer' => ['id' => 3, 'username' => 'test-reviewer', 'role' => 'reviewer'],
    // Die Sitzung gibt es noch, der Benutzer ist ausgetragen -- genau der Stand nach avesmapsLogout().
    'abgemeldet' => null,
];
foreach ($benutzer as $rolle => $eintrag) {
    session_id($sitzungsId($rolle));
    session_start();
    $_SESSION = $eintrag === null ? ['anderes' => 'x'] : [AVESMAPS_AUTH_SESSION_KEY => $eintrag];
    session_write_close();
}

// ---- Der Kindprozess ----------------------------------------------------------------------------
// Er fuehrt die Rumpfzeilen eines Endpunkts aus. `exit` beendet ihn (Schnellpfad, 304, JSON-Antwort),
// deshalb meldet er sich in einer Abschlussroutine: Status, Zahl der geoeffneten Sitzungen, Fatal.
$kindSkript = $spielplatz . '/kind.php';
file_put_contents($kindSkript, <<<'KIND'
<?php

declare(strict_types=1);

$spec = json_decode((string) file_get_contents($argv[1]), true);
$wurzel = (string) $spec['wurzel'];

final class EmrSitzungsZaehler extends SessionHandler
{
    public static int $geoeffnet = 0;
    // 💣 Unter der CLI bleibt headers_list() leer -- was session_start an Cache-Kopfzeilen schickte, ist
    // hier nicht zu sehen. Gemessen wird deshalb die Ursache: der Limiter IM MOMENT DES OEFFNENS.
    public static ?string $limiterBeimOeffnen = null;

    public function open(string $path, string $name): bool
    {
        self::$geoeffnet++;
        self::$limiterBeimOeffnen = (string) session_cache_limiter();
        return parent::open($path, $name);
    }
}

register_shutdown_function(static function (): void {
    $status = http_response_code();
    $letzter = error_get_last();
    $fatal = is_array($letzter) && in_array($letzter['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true);
    echo "\n#ENDE " . json_encode([
        'status' => is_int($status) ? $status : null,
        'geoeffnet' => EmrSitzungsZaehler::$geoeffnet,
        'limiter_beim_oeffnen' => EmrSitzungsZaehler::$limiterBeimOeffnen,
        'fatal' => $fatal ? $letzter['message'] : null,
    ], JSON_UNESCAPED_SLASHES) . "\n";
});
// Jede Warnung ist ein Fehler (dieselbe Haltung wie map-features-wappen-ablauf-test.php) -- ausser sie
// ist mit @ ausdruecklich unterdrueckt.
set_error_handler(static function (int $stufe, string $text, string $datei, int $zeile): bool {
    if (!(error_reporting() & $stufe)) {
        return false;
    }
    throw new ErrorException("$text (" . basename($datei) . ":$zeile)", 0, $stufe, $datei, $zeile);
}, E_ALL);

define('AVESMAPS_API_METRICS_REGISTRIERT', true);

ini_set('session.save_path', (string) $spec['sitzungen']);
session_set_save_handler(new EmrSitzungsZaehler(), true);

$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['HTTP_ACCEPT_ENCODING'] = '';
unset($_SERVER['HTTP_ORIGIN'], $_SERVER['HTTP_IF_NONE_MATCH']);
if ((string) ($spec['if_none_match'] ?? '') !== '') {
    $_SERVER['HTTP_IF_NONE_MATCH'] = (string) $spec['if_none_match'];
}
$_GET = (array) $spec['get'];
foreach ((array) $spec['cookie'] as $name => $wert) {
    $_COOKIE[$name] = $wert;
}

// Nur wer eine Datenbank braucht, bekommt eine -- der Leser und die Ebene (Schnellpfad vor dem PDO)
// laufen damit auch ohne pdo_sqlite.
if ((array) ($spec['sql'] ?? []) !== []) {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    foreach ((array) $spec['sql'] as $anweisung) {
        $pdo->exec((string) $anweisung);
    }
    $GLOBALS['emrPdo'] = $pdo;
}

function emrSchnitt(string $quelle, int $ab, string $bis): string
{
    $ende = strpos($quelle, $bis, $ab);
    if ($ende === false) {
        throw new RuntimeException('Schnittmarke fehlt: ' . $bis);
    }
    return substr($quelle, $ab, $ende - $ab);
}

// 🔴 GENAU EINMAL -- sonst liefe hier stillschweigend etwas anderes als der Endpunkt.
function emrErsetze(string $code, string $alt, string $neu): string
{
    $anzahl = substr_count($code, $alt);
    if ($anzahl !== 1) {
        throw new RuntimeException("erwartet genau einmal, gefunden {$anzahl}: {$alt}");
    }
    return str_replace($alt, $neu, $code);
}

function emrRumpfVorbereiten(string $code): string
{
    $code = emrErsetze($code, 'avesmapsLoadApiConfig(avesmapsApiRoot())', '[]');
    if (str_contains($code, "avesmapsCreatePdo(\$config['database'] ?? [])")) {
        $code = emrErsetze($code, "avesmapsCreatePdo(\$config['database'] ?? [])", "\$GLOBALS['emrPdo']");
    }
    return $code;
}

$modus = (string) $spec['modus'];

if ($modus === 'leser') {
    require $wurzel . '/api/_internal/auth.php';
    if (!function_exists('avesmapsEditModeNurFuerEditoren')) {
        echo '#LESER ' . json_encode(['fehlt' => true]) . "\n";
        exit;
    }
    $ergebnis = avesmapsEditModeNurFuerEditoren((array) $spec['get']);
    echo '#LESER ' . json_encode(['query' => $ergebnis, 'limiter' => session_cache_limiter()], JSON_FORCE_OBJECT) . "\n";
    exit;
}

$pfad = $wurzel . match ($modus) {
    'kartendaten' => '/api/app/map-features.php',
    'detail' => '/api/app/territory-detail.php',
    'ebene' => '/api/_internal/political/territories-endpoint.php',
};
// Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF.
$quelle = str_replace("\r\n", "\n", (string) file_get_contents($pfad));
$tryStart = strpos($quelle, "\ntry {\n");
if ($tryStart === false) {
    throw new RuntimeException('kein try-Block in ' . $pfad);
}
$rumpfAb = $tryStart + strlen("\ntry {\n");

// Kopf (require, Konstanten, Funktionen) OHNE den Rumpf laden. Die Datei liegt NEBEN dem Original,
// weil ihre `require __DIR__ . '/…'` sonst ins Leere zeigen.
$restStart = $modus === 'kartendaten' ? strpos($quelle, "\nfunction avesmaps", $tryStart) : false;
$kopf = dirname($pfad) . '/.emr-kopf-' . getmypid() . '.php';
file_put_contents($kopf, substr($quelle, 0, $tryStart) . "\n" . ($restStart === false ? '' : substr($quelle, $restStart)));
try {
    require $kopf;
} finally {
    @unlink($kopf);
}

if ($modus === 'kartendaten') {
    foreach ((array) ($spec['vorrat'] ?? []) as $vorratEtag => $vorratRumpf) {
        avesmapsMapFeaturesCacheWrite((string) $vorratEtag, (string) gzencode((string) $vorratRumpf, 6));
    }
    // Alles bis zum teuren Aufbau: Riegel, ETag, 304, Schnellpfad.
    eval(emrRumpfVorbereiten(emrSchnitt($quelle, $rumpfAb, '    $buildingTypes = avesmapsLoadWikiSyncBuildingTypes($pdo);')));
    // Und die Schalterzeilen, wie sie im Aufbau stehen.
    eval(emrSchnitt($quelle, (int) strpos($quelle, '    $mapFeaturesEditMode = ', $rumpfAb), '    $politicalContext = '));
    $ort = [
        'public_id' => 'loc-emr',
        'name' => 'Gareth',
        'feature_type' => 'location',
        'feature_subtype' => 'metropole',
        'geometry_json' => '{"type":"Point","coordinates":[100,200]}',
        'revision' => 1,
        'updated_at' => '2026-09-14 12:00:00',
        'properties_json' => json_encode(['coat' => [
            'url' => '/uploads/wappen/cache/' . str_repeat('a', 40) . '.png',
            'source' => 'own',
            'license_status' => 'public_domain',
        ]], JSON_UNESCAPED_SLASHES),
    ];
    $merkmal = avesmapsMapFeatureRowToGeoJsonFeature($ort, [], [], true, $coatsLocalEnabled, $coatsWikiEnabled);
    echo '#AUFBAU ' . json_encode([
        'etag' => $etag,
        'lokal' => $coatsLocalEnabled,
        'wiki' => $coatsWikiEnabled,
        'wappen' => $merkmal['properties']['coat']['url'] ?? null,
    ], JSON_UNESCAPED_SLASHES) . "\n";
    exit;
}

if ($modus === 'ebene') {
    foreach ((array) ($spec['vorrat'] ?? []) as $eintrag) {
        file_put_contents(avesmapsPoliticalLayerCacheFile((array) $eintrag['get']), (string) $eintrag['rumpf']);
    }
    // Alles bis zur Datenbankverbindung: Riegel und Schnellpfad.
    eval(emrRumpfVorbereiten(emrSchnitt($quelle, $rumpfAb, "    \$pdo = avesmapsCreatePdo(\$config['database'] ?? []);")));
    echo "#KEIN-TREFFER\n";
    exit;
}

// detail: der ganze Rumpf, er endet in avesmapsJsonResponse (exit).
eval(emrRumpfVorbereiten(emrSchnitt($quelle, $rumpfAb, '} catch (Throwable $error) {')));
echo "#KEIN-AUSGANG\n";
exit;
KIND);

$phpBefehl = escapeshellarg(PHP_BINARY)
    . ' -d zend.assertions=1 -d assert.exception=1 -d ' . escapeshellarg('sys_temp_dir=' . $temp);
// ⚠️ Die -d-Schalter dieses Prozesses erbt ein Kind nicht. Was es nicht von selbst laedt, bekommt es.
foreach (['pdo_sqlite', 'mbstring'] as $erweiterung) {
    $probe = trim((string) shell_exec(escapeshellarg(PHP_BINARY) . ' -r '
        . escapeshellarg("echo extension_loaded('{$erweiterung}') ? 'ja' : 'nein';")));
    if ($probe !== 'ja') {
        $phpBefehl .= ' -d extension=' . $erweiterung;
    }
}

$kind = static function (string $modus, array $szenario) use ($phpBefehl, $kindSkript, $spielplatz, $WURZEL, $sitzungen): array {
    $specDatei = $spielplatz . '/szenario-' . bin2hex(random_bytes(6)) . '.json';
    file_put_contents($specDatei, json_encode(
        ['modus' => $modus, 'wurzel' => $WURZEL, 'sitzungen' => $sitzungen] + $szenario + ['get' => [], 'cookie' => []],
        JSON_UNESCAPED_SLASHES
    ));
    $ausgabe = str_replace("\r\n", "\n", (string) shell_exec(
        $phpBefehl . ' ' . escapeshellarg($kindSkript) . ' ' . escapeshellarg($specDatei) . ' 2>&1'
    ));
    @unlink($specDatei);

    $ende = strrpos($ausgabe, "#ENDE ");
    $abschluss = $ende === false ? null : json_decode(trim(substr($ausgabe, $ende + 6)), true);
    if (!is_array($abschluss) || $abschluss['fatal'] !== null) {
        return ['kaputt' => substr($ausgabe, 0, 1500)];
    }
    $rumpf = trim(substr($ausgabe, 0, $ende));
    $zeile = static function (string $marke) use ($rumpf): ?array {
        return preg_match('/^' . preg_quote($marke, '/') . ' (\{.*\})$/m', $rumpf, $treffer) === 1
            ? json_decode($treffer[1], true) : null;
    };

    return [
        'rumpf' => $rumpf,
        'status' => $abschluss['status'],
        'geoeffnet' => $abschluss['geoeffnet'],
        'limiter_beim_oeffnen' => $abschluss['limiter_beim_oeffnen'],
        'aufbau' => $zeile('#AUFBAU'),
        'leser' => $zeile('#LESER'),
    ];
};
$heil = static function (array $lauf, string $was): bool {
    if (isset($lauf['kaputt'])) {
        pruefe(false, "{$was}: der Kindprozess ist gescheitert --\n" . $lauf['kaputt']);
        return false;
    }
    return true;
};

require_once $WURZEL . '/api/_internal/app/coat-display.php';
$PLATZHALTER = AVESMAPS_COAT_PLACEHOLDER_URL;
$ECHTES_WAPPEN = '/uploads/wappen/cache/' . str_repeat('a', 40) . '.png';
pruefe($PLATZHALTER !== '' && $PLATZHALTER !== $ECHTES_WAPPEN,
    'Vorbedingung: Platzhalter und echtes Wappen sind unterscheidbar');

if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDOUT, "UEBERSPRUNGEN (pdo_sqlite fehlt): die Ablaeufe der drei Endpunkte\n");
} else {
    // =================================================================================================
    // TEIL 1 -- api/app/map-features.php: ETag, Schalter, Schnellpfad, 304
    // =================================================================================================
    $sqlKarte = [
        'CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)',
        'INSERT INTO map_revision (id, revision) VALUES (1, 4711)',
        'CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT)',
        // 🔴 DER NOTAUS IST GEDRUECKT -- beide Herkunftsschalter und beide alten Objektart-Schalter.
        "INSERT INTO app_setting (setting_key, setting_value) VALUES ('coats_local_enabled', '0'), "
            . "('coats_wiki_enabled', '0'), ('settlement_coats_enabled', '0'), ('territory_coats_enabled', '0')",
    ];
    $aufbau = static function (array $get, array $cookie) use ($kind, $sqlKarte): array {
        return $kind('kartendaten', ['get' => $get, 'cookie' => $cookie, 'sql' => $sqlKarte]);
    };

    $besucher = $aufbau([], []);
    $V = null;
    if (!$heil($besucher, 'Karte/Besucher') || $besucher['aufbau'] === null) {
        pruefe(false, 'Karte/Besucher: der Aufbau meldet sich nicht');
    } else {
        $V = (string) $besucher['aufbau']['etag'];
        pruefe($besucher['aufbau']['wappen'] === $PLATZHALTER,
            'Vorbedingung: der Besucher sieht bei gedruecktem Notaus den Platzhalter, kam: ' . var_export($besucher['aufbau']['wappen'], true));
        pruefe($besucher['geoeffnet'] === 0, 'der Besucher ohne edit_mode oeffnet keine Sitzung');
    }

    $editor = $aufbau(['edit_mode' => '1'], $keks('editor'));
    $E = null;
    if ($heil($editor, 'Karte/Editor') && $editor['aufbau'] !== null) {
        $E = (string) $editor['aufbau']['etag'];
        pruefe($editor['aufbau']['lokal'] === true && $editor['aufbau']['wiki'] === true,
            'ein angemeldeter Editor mit edit_mode=1 hebt den Notaus weiter auf -- er muss sehen, was er bearbeitet');
        pruefe($editor['aufbau']['wappen'] === $ECHTES_WAPPEN,
            'und bekommt das echte Wappen, kam: ' . var_export($editor['aufbau']['wappen'], true));
        pruefe($V !== null && $E !== $V,
            'die Editor-Fassung hat ihr EIGENES ETag -- sonst bekaeme ein Browser fuer die eine eine 304 der anderen');
    } else {
        pruefe(false, 'Karte/Editor: der Aufbau meldet sich nicht');
    }

    $admin = $aufbau(['edit_mode' => '1'], $keks('admin'));
    if ($heil($admin, 'Karte/Admin') && $admin['aufbau'] !== null) {
        pruefe($admin['aufbau']['etag'] === $E && $admin['aufbau']['wappen'] === $ECHTES_WAPPEN,
            'ein Admin darf dasselbe wie ein Editor');
    } else {
        pruefe(false, 'Karte/Admin: der Aufbau meldet sich nicht');
    }

    // 🔴 DER KERN: dieselbe Adresse OHNE Anmeldung ist die BESUCHER-Nutzlast, samt ETag.
    foreach ([
        'ohne Sitzung' => [['edit_mode' => '1'], []],
        'mit abgemeldeter Sitzung' => [['edit_mode' => '1'], $keks('abgemeldet')],
        'als Reviewer' => [['edit_mode' => '1'], $keks('reviewer')],
        'mit edit_mode=true' => [['edit_mode' => 'true'], []],
    ] as $lage => [$get, $cookie]) {
        $lauf = $aufbau($get, $cookie);
        if (!$heil($lauf, "Karte/{$lage}") || $lauf['aufbau'] === null) {
            pruefe(false, "Karte/{$lage}: der Aufbau meldet sich nicht");
            continue;
        }
        pruefe($lauf['aufbau']['lokal'] === false && $lauf['aufbau']['wiki'] === false,
            "DER KERN: edit_mode {$lage} hebt den Notaus NICHT auf");
        pruefe($lauf['aufbau']['wappen'] === $PLATZHALTER,
            "DER KERN: edit_mode {$lage} bekommt den Platzhalter, kam: " . var_export($lauf['aufbau']['wappen'], true));
        pruefe($V !== null && $lauf['aufbau']['etag'] === $V,
            "DER KERN: edit_mode {$lage} bekommt EXAKT das Besucher-ETag -- kam " . var_export($lauf['aufbau']['etag'], true)
            . ', Besucher ' . var_export($V, true));
    }
    $ohneKeks = $aufbau(['edit_mode' => '1'], []);
    if ($heil($ohneKeks, 'Karte/ohne Keks')) {
        pruefe($ohneKeks['geoeffnet'] === 0,
            'ohne Sitzungs-Cookie wird keine Sitzung eroeffnet -- kein Sitzungsdatei-Lock auf dem oeffentlichen Pfad');
    }

    if ($V !== null && $E !== null) {
        // ---- Der Schnellpfad, mit BEIDEN Fassungen im Vorrat -----------------------------------------
        // 💣 Genau die Stelle, an der eine Pruefung nur im Aufbau vorbeigelaufen waere.
        $vorrat = [$V => 'BESUCHER-NUTZLAST', $E => 'EDITOR-NUTZLAST'];
        $schnell = static function (array $get, array $cookie, string $ifNoneMatch = '') use ($kind, $sqlKarte, $vorrat): array {
            return $kind('kartendaten', ['get' => $get, 'cookie' => $cookie, 'sql' => $sqlKarte, 'vorrat' => $vorrat, 'if_none_match' => $ifNoneMatch]);
        };

        $lauf = $schnell(['edit_mode' => '1'], []);
        if ($heil($lauf, 'Schnellpfad/anonym')) {
            pruefe($lauf['status'] === 200 && $lauf['rumpf'] === 'BESUCHER-NUTZLAST',
                'DER KERN DES SCHNELLPFADS: ein anonymes edit_mode=1 bekommt die Besucher-Fassung aus dem Vorrat, kam: '
                . var_export($lauf['rumpf'], true));
        }
        $lauf = $schnell(['edit_mode' => '1'], $keks('reviewer'));
        if ($heil($lauf, 'Schnellpfad/Reviewer')) {
            pruefe($lauf['rumpf'] === 'BESUCHER-NUTZLAST', 'und ein Reviewer ebenso, kam: ' . var_export($lauf['rumpf'], true));
        }
        $lauf = $schnell(['edit_mode' => '1'], $keks('editor'));
        if ($heil($lauf, 'Schnellpfad/Editor')) {
            pruefe($lauf['rumpf'] === 'EDITOR-NUTZLAST', 'der Editor bekommt seine Fassung aus dem Vorrat, kam: ' . var_export($lauf['rumpf'], true));
        }
        $lauf = $schnell([], []);
        if ($heil($lauf, 'Schnellpfad/Besucher')) {
            pruefe($lauf['rumpf'] === 'BESUCHER-NUTZLAST', 'der Besucher unveraendert die seine');
        }

        // ---- Die 304-Pruefung ------------------------------------------------------------------------
        $lauf = $schnell(['edit_mode' => '1'], [], $E);
        if ($heil($lauf, '304/anonym mit Editor-ETag')) {
            pruefe($lauf['status'] !== 304,
                'DER KERN DER 304: wer das Editor-ETag vorlegt, ohne angemeldet zu sein, bekommt KEIN „deine Kopie ist aktuell"');
            pruefe($lauf['rumpf'] === 'BESUCHER-NUTZLAST', 'sondern die Besucher-Fassung, kam: ' . var_export($lauf['rumpf'], true));
        }
        $lauf = $schnell(['edit_mode' => '1'], [], $V);
        if ($heil($lauf, '304/anonym mit Besucher-ETag')) {
            pruefe($lauf['status'] === 304 && $lauf['rumpf'] === '',
                'ein anonymes edit_mode=1 mit dem Besucher-ETag bekommt die 304 -- genau wie ein Besucher');
        }
        $lauf = $schnell(['edit_mode' => '1'], $keks('editor'), $E);
        if ($heil($lauf, '304/Editor')) {
            pruefe($lauf['status'] === 304, 'und der Editor mit seinem ETag weiterhin seine 304');
        }
    }

    // =================================================================================================
    // TEIL 2 -- die politische Ebene: der Schnellpfad VOR der Datenbank
    // =================================================================================================
    $ebenenVorrat = [
        ['get' => ['zoom' => '3', 'year_bf' => '1049', 'edit_mode' => '1'], 'rumpf' => '{"ebene":"EDITOR"}'],
        ['get' => ['zoom' => '3', 'year_bf' => '1049', 'edit_mode' => '0'], 'rumpf' => '{"ebene":"BESUCHER"}'],
    ];
    $ebene = static function (array $get, array $cookie) use ($kind, $ebenenVorrat): array {
        return $kind('ebene', ['get' => ['action' => 'layer', 'zoom' => '3', 'year_bf' => '1049'] + $get, 'cookie' => $cookie, 'vorrat' => $ebenenVorrat]);
    };
    foreach ([
        'anonym mit edit_mode=1' => [['edit_mode' => '1'], [], '{"ebene":"BESUCHER"}'],
        'anonym mit edit_mode=true' => [['edit_mode' => 'true'], [], '{"ebene":"BESUCHER"}'],
        'abgemeldet mit edit_mode=1' => [['edit_mode' => '1'], $keks('abgemeldet'), '{"ebene":"BESUCHER"}'],
        'Reviewer mit edit_mode=1' => [['edit_mode' => '1'], $keks('reviewer'), '{"ebene":"BESUCHER"}'],
        'Editor mit edit_mode=1' => [['edit_mode' => '1'], $keks('editor'), '{"ebene":"EDITOR"}'],
        'Besucher mit edit_mode=0' => [['edit_mode' => '0'], $keks('editor'), '{"ebene":"BESUCHER"}'],
    ] as $lage => [$get, $cookie, $erwartet]) {
        $lauf = $ebene($get, $cookie);
        if (!$heil($lauf, "Ebene/{$lage}")) {
            continue;
        }
        pruefe($lauf['rumpf'] === $erwartet,
            "Politische Ebene, {$lage}: erwartet {$erwartet} aus dem Schnellpfad, kam: " . var_export($lauf['rumpf'], true));
    }
    $lauf = $ebene(['edit_mode' => '0'], $keks('editor'));
    if ($heil($lauf, 'Ebene/heisser Pfad')) {
        pruefe($lauf['geoeffnet'] === 0,
            '⚠️ der Besucherpfad der Ebene (edit_mode=0) liest KEINE Sitzung -- auch nicht, wenn ein Cookie mitkommt');
    }

    // =================================================================================================
    // TEIL 3 -- api/app/territory-detail.php: das Wappen der Infobox
    // =================================================================================================
    $sqlDetail = [
        'CREATE TABLE political_territory (public_id TEXT, wiki_key TEXT, coat_of_arms_url TEXT, is_active INTEGER)',
        "INSERT INTO political_territory VALUES ('t-emr', 'wiki:emr-test', '', 1)",
        'CREATE TABLE political_territory_wiki_test (wiki_key TEXT, name TEXT, type TEXT, status TEXT, continent TEXT, '
            . 'founded_text TEXT, dissolved_text TEXT, capital_name TEXT, seat_name TEXT, form_of_government TEXT, ruler TEXT, '
            . 'language TEXT, currency TEXT, population TEXT, founder TEXT, political TEXT, trade_zone TEXT, trade_goods TEXT, '
            . 'geographic TEXT, blazon TEXT, affiliation_raw TEXT, wiki_url TEXT, coat_of_arms_url TEXT, '
            . 'coat_of_arms_license_status TEXT, coat_of_arms_author TEXT, coat_of_arms_attribution TEXT, '
            . 'founded_start_bf TEXT, dissolved_end_bf TEXT)',
        "INSERT INTO political_territory_wiki_test (wiki_key, name, coat_of_arms_url, coat_of_arms_license_status, coat_of_arms_author) "
            . "VALUES ('wiki:emr-test', 'Testmark', '{$ECHTES_WAPPEN}', 'public_domain', 'Jemand')",
        'CREATE TABLE wiki_territory_model (wiki_key TEXT, metadata_overrides_json TEXT)',
        'CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT)',
        "INSERT INTO app_setting (setting_key, setting_value) VALUES ('coats_local_enabled', '0'), "
            . "('coats_wiki_enabled', '0'), ('settlement_coats_enabled', '0'), ('territory_coats_enabled', '0')",
    ];
    foreach ([
        'Besucher' => [[], [], $PLATZHALTER],
        'anonym mit edit_mode=1' => [['edit_mode' => '1'], [], $PLATZHALTER],
        'Reviewer mit edit_mode=1' => [['edit_mode' => '1'], $keks('reviewer'), $PLATZHALTER],
        'Editor mit edit_mode=1' => [['edit_mode' => '1'], $keks('editor'), $ECHTES_WAPPEN],
    ] as $lage => [$get, $cookie, $erwartet]) {
        $lauf = $kind('detail', ['get' => ['territory' => 't-emr'] + $get, 'cookie' => $cookie, 'sql' => $sqlDetail]);
        if (!$heil($lauf, "Detail/{$lage}")) {
            continue;
        }
        $antwort = json_decode($lauf['rumpf'], true);
        pruefe(is_array($antwort) && ($antwort['ok'] ?? false) === true,
            "Detail/{$lage}: die Antwort ist gueltiges JSON mit ok -- kam: " . substr($lauf['rumpf'], 0, 300));
        $wappen = is_array($antwort) ? ($antwort['coat']['url'] ?? null) : null;
        pruefe($wappen === $erwartet, "Gebiets-Infobox, {$lage}: erwartet {$erwartet}, kam: " . var_export($wappen, true));
        if ($erwartet === $PLATZHALTER && is_array($antwort)) {
            pruefe(($antwort['coat']['author'] ?? null) === '',
                "Gebiets-Infobox, {$lage}: der Urheber eines NICHT gezeigten Wappens reist nicht mit");
        }
    }
}

// =====================================================================================================
// TEIL 4 -- der Leser selbst: echte Sitzungen, und die Sitzung wird nur angefasst, wenn es sein muss
// =====================================================================================================
{
    $leser = static function (array $get, array $cookie) use ($kind, $heil): ?array {
        $lauf = $kind('leser', ['get' => $get, 'cookie' => $cookie]);
        return $heil($lauf, 'Leser ' . json_encode($get)) && is_array($lauf['leser']) ? $lauf : null;
    };
    $l = $leser(['edit_mode' => '1'], $keks('editor'));
    $gebaut = is_array($l) && is_array($l['leser']) && !isset($l['leser']['fehlt']);
    pruefe($gebaut, 'avesmapsEditModeNurFuerEditoren gibt es (api/_internal/auth.php)');
    if ($gebaut) {
        pruefe(($l['leser']['query']['edit_mode'] ?? null) === '1', 'Editor mit echter Sitzung: edit_mode bleibt');
        pruefe($l['geoeffnet'] === 1, 'dafuer wird die Sitzung genau einmal geoeffnet, gezaehlt: ' . var_export($l['geoeffnet'], true));
        pruefe($l['limiter_beim_oeffnen'] === '',
            '💣 WAEHREND des Lesens ist der Cache-Limiter aus -- sonst setzt session_start eigene Cache-Control-, '
            . 'Pragma- und Expires-Kopfzeilen auf Antworten, die ihr Caching selbst regeln; gemessen: '
            . var_export($l['limiter_beim_oeffnen'], true));
        pruefe($l['leser']['limiter'] === 'nocache',
            '⚠️ der Cache-Limiter der Sitzung ist danach wieder der alte -- das Lesen darf die Kopfzeilen dieser Antworten nicht veraendern');

        foreach ([
            'ohne Sitzungs-Cookie' => [[], 0],
            'mit abgemeldeter Sitzung' => [$keks('abgemeldet'), 1],
            'als Reviewer' => [$keks('reviewer'), 1],
        ] as $lage => [$cookie, $geoeffnet]) {
            $l = $leser(['edit_mode' => '1', 'zoom' => '3'], $cookie);
            if (!is_array($l)) {
                continue;
            }
            pruefe(!array_key_exists('edit_mode', (array) $l['leser']['query']), "{$lage}: edit_mode faellt weg");
            pruefe(($l['leser']['query']['zoom'] ?? null) === '3', "{$lage}: die uebrigen Parameter bleiben");
            pruefe($l['geoeffnet'] === $geoeffnet, "{$lage}: {$geoeffnet} Sitzung(en) geoeffnet, gezaehlt: " . var_export($l['geoeffnet'], true));
        }
        foreach ([
            'ohne edit_mode' => [],
            'mit edit_mode=0' => ['edit_mode' => '0'],
            'mit leerem edit_mode' => ['edit_mode' => ''],
        ] as $lage => $get) {
            $l = $leser($get + ['zoom' => '3'], $keks('editor'));
            if (!is_array($l)) {
                continue;
            }
            pruefe($l['geoeffnet'] === 0, "⚠️ DER HEISSE PFAD, {$lage}: keine Sitzung geoeffnet, auch nicht mit Editor-Cookie");
            pruefe((array) $l['leser']['query'] === $get + ['zoom' => '3'], "{$lage}: die Anfrage bleibt, wie sie ist");
        }
    }
}

// =====================================================================================================
// TEIL 5 -- die Regel, mit hineingereichtem Benutzer
// =====================================================================================================
if (function_exists('avesmapsEditModeNurFuerEditoren')) {
    $aufrufe = 0;
    $als = static function (?array $benutzer) use (&$aufrufe): callable {
        return static function () use ($benutzer, &$aufrufe): ?array {
            $aufrufe++;
            return $benutzer;
        };
    };
    $regel = static fn (array $query, callable $leser): array => avesmapsEditModeNurFuerEditoren($query, $leser);

    foreach ([[], ['edit_mode' => ''], ['edit_mode' => '0'], ['zoom' => '3']] as $query) {
        $aufrufe = 0;
        pruefe($regel($query, $als(null)) === $query, 'keine Editor-Anfrage bleibt unveraendert: ' . json_encode($query));
        pruefe($aufrufe === 0, 'und fragt nicht nach dem Benutzer: ' . json_encode($query));
    }
    foreach (['1', 'true', 'yes', ' 1 ', ['1']] as $wert) {
        $lage = json_encode($wert);
        $aufrufe = 0;
        pruefe(!array_key_exists('edit_mode', $regel(['edit_mode' => $wert, 'zoom' => '3'], $als(null))),
            "anonym, edit_mode={$lage}: faellt weg (im Zweifel ist es eine Anfrage)");
        pruefe($aufrufe === 1, "anonym, edit_mode={$lage}: genau EIN Blick auf den Benutzer");
        pruefe($regel(['edit_mode' => $wert], $als(['role' => 'editor'])) === ['edit_mode' => $wert],
            "Editor, edit_mode={$lage}: bleibt unveraendert");
    }
    pruefe($regel(['edit_mode' => '1'], $als(['role' => 'admin'])) === ['edit_mode' => '1'], 'Admin: bleibt');
    foreach ([['role' => 'reviewer'], ['role' => ''], ['role' => 'gott'], ['username' => 'ohne-rolle']] as $wer) {
        pruefe($regel(['edit_mode' => '1'], $als($wer)) === [], 'ohne edit-Recht faellt edit_mode weg: ' . json_encode($wer));
    }
    // 🔴 FAELLT GESCHLOSSEN AUS. Ein Leser, der wirft, macht aus jedem einen Besucher -- nie einen Editor,
    // und nie eine tote Karte.
    $werfer = static function (): ?array {
        throw new RuntimeException('Sitzung kaputt');
    };
    $ergebnis = null;
    try {
        $ergebnis = $regel(['edit_mode' => '1', 'zoom' => '3'], $werfer);
    } catch (Throwable $e) {
        pruefe(false, 'ein werfender Leser darf nicht durchschlagen: ' . $e->getMessage());
    }
    pruefe($ergebnis === ['zoom' => '3'], 'ein werfender Leser ergibt die Besucher-Sicht');
}

// =====================================================================================================
// TEIL 6 -- der Waechter: kein neuer Leser von edit_mode an diesem Riegel vorbei
// =====================================================================================================
$nurCode = static function (string $php): string {
    $stuecke = [];
    foreach (token_get_all($php) as $token) {
        if (is_array($token)) {
            if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $stuecke[] = $token[1];
            continue;
        }
        $stuecke[] = $token;
    }
    return implode('', $stuecke);
};

// 🔴 VOLLE PFADE, KEINE WORTE. Wer hier eine Datei ergaenzt, schreibt dazu, WARUM sie am Riegel haengt.
$bekannteLeser = [
    'api/_internal/auth.php' => 'der Riegel selbst',
    'api/app/map-features.php' => 'Endpunkt -- Riegel vor dem ETag und dem Schnellpfad',
    'api/app/territory-detail.php' => 'Endpunkt -- Riegel am Rumpfanfang',
    'api/_internal/political/territories-endpoint.php' => 'Endpunkt -- Riegel vor dem Schnellpfad',
    'api/_internal/political/territories-layer.php' => 'Bibliothek, bekommt $_GET nur vom Endpunkt',
    'api/_internal/political/territories-derived-layer.php' => 'Bibliothek (Cache-Schluessel), bekommt $_GET nur vom Endpunkt',
];
$iterator = new RecursiveIteratorIterator(new RecursiveCallbackFilterIterator(
    new RecursiveDirectoryIterator($WURZEL, FilesystemIterator::SKIP_DOTS),
    // ⚠️ Punktverzeichnisse (.git, .claude mit fremden Worktrees) und die Tests bleiben draussen -- und
    // damit auch die .emr-kopf-*/.mf-funktionen-test-*-Dateien, die parallele Testlaeufe kurz anlegen.
    static fn (SplFileInfo $datei): bool => !str_starts_with($datei->getFilename(), '.')
        && !($datei->isDir() && in_array($datei->getFilename(), ['__tests__', 'node_modules'], true))
));
$riegel = '$_GET = avesmapsEditModeNurFuerEditoren($_GET);';
// 💣 UND OHNE DAS WORT: wer die Anfrage an einen dieser Bauer weiterreicht, liest edit_mode, ohne es
// zu nennen -- ein neuer Endpunkt mit `avesmapsPoliticalReadLayerWithDerivedGeometry($pdo, $_GET)`
// lieferte anonym die Editor-Ebene, und die Wortsuche oben schwiege (Befund des Pruefagenten).
$bauerMitEditMode = [
    'avesmapsPoliticalReadLayerWithDerivedGeometry(',
    'avesmapsPoliticalReadLayer(',
    'avesmapsPoliticalLayerCacheFile(',
    'avesmapsPoliticalLayerCacheTtlSeconds(',
    'avesmapsPoliticalLayerBrowserMaxAge(',
    'avesmapsMapFeaturesETag(',
];
$gefunden = [];
$weiterreicher = [];
foreach ($iterator as $datei) {
    if ($datei->getExtension() !== 'php') {
        continue;
    }
    $relativ = str_replace('\\', '/', substr($datei->getPathname(), strlen($WURZEL) + 1));
    $code = $nurCode((string) file_get_contents($datei->getPathname()));
    if (str_contains($code, 'edit_mode')) {
        $gefunden[] = $relativ;
        pruefe(array_key_exists($relativ, $bekannteLeser),
            "WAECHTER: {$relativ} liest edit_mode. Ein neuer Leser muss hinter avesmapsEditModeNurFuerEditoren "
            . 'stehen -- sonst fuehrt edit_mode dort wieder am Wappen-Notaus vorbei. Danach hier eintragen, mit Grund.');
    }
    if (!str_contains($code, '$_GET')) {
        continue;
    }
    foreach ($bauerMitEditMode as $bauer) {
        if (str_contains($code, $bauer)) {
            $weiterreicher[] = $relativ;
            pruefe(str_contains($code, $riegel),
                "WAECHTER: {$relativ} liest \$_GET und ruft {$bauer}...) -- dieser Bauer entscheidet ueber edit_mode. "
                . "Die Datei muss den Riegel tragen: {$riegel}");
        }
    }
}
pruefe(count($gefunden) >= 5, 'Vorbedingung: der Waechter hat ueberhaupt Leser gefunden (' . count($gefunden) . ')');
pruefe(in_array('api/_internal/political/territories-endpoint.php', $weiterreicher, true)
    && in_array('api/app/map-features.php', $weiterreicher, true),
    'Vorbedingung: die Bauer-Liste trifft die zwei heutigen Weiterreicher -- sonst ist sie veraltet und prueft nichts');

// Und in jedem der drei Endpunkte steht der Riegel VOR dem ersten Zugriff auf $_GET.
foreach (['api/app/map-features.php', 'api/app/territory-detail.php', 'api/_internal/political/territories-endpoint.php'] as $endpunkt) {
    $code = $nurCode((string) file_get_contents($WURZEL . '/' . $endpunkt));
    pruefe(substr_count($code, $riegel) === 1, "{$endpunkt}: der Riegel steht genau einmal da");
    pruefe(strpos($code, $riegel) !== false && strpos($code, '$_GET') === strpos($code, $riegel),
        "{$endpunkt}: vor dem Riegel liest niemand \$_GET -- sonst entscheidet etwas mit dem ungefilterten Parameter");
}

// ---- Aufraeumen ----------------------------------------------------------------------------------
$loeschen = static function (string $pfad) use (&$loeschen): void {
    if (is_dir($pfad) && !is_link($pfad)) {
        foreach ((array) scandir($pfad) as $eintrag) {
            if ($eintrag !== '.' && $eintrag !== '..') {
                $loeschen($pfad . '/' . $eintrag);
            }
        }
        @rmdir($pfad);
        return;
    }
    @unlink($pfad);
};
$loeschen($spielplatz);

if ($fehler > 0) {
    fwrite(STDERR, "{$fehler} Zusicherung(en) verletzt\n");
    exit(1);
}
echo "OK: edit-mode-riegel-test -- die Editor-Sicht der drei Lesepfade gibt es nur mit Anmeldung, auch aus dem Vorrat.\n";
