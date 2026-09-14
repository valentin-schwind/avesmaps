<?php

declare(strict_types=1);

/**
 * Die Lesetueren der Herrschaftsgebiete geben Editor-Daten nur noch mit Editor-Anmeldung heraus.
 *
 * 🔴 DER BEFUND (Sitzung „Wappen-Notaus gegen edit_mode absichern", 14.09.2026; Owner-Entscheid am
 * selben Tag: Stufe `edit`): zwei oeffentliche Lesepfade gaben Wappenadressen ROH heraus -- ohne
 * Anmeldung, am Lizenz-Gate und am Wappen-Notaus vorbei (NOTICE.md):
 *   - api/app/political-territories.php: jede GET-Aktion ausser `layer` und den drei Protokoll-Lesern.
 *     Live gemessen: anonym `?action=wiki_list` -> HTTP 200, 1.478 Zeilen, 193 rohe Adressen.
 *   - api/app/political-territory-wiki.php (Wiki-Browser), dazu `raw` jeder Wiki-Zeile.
 * Die Karte braucht davon nur `layer`; beide Wiki-Baeume im Editor laden laengst sync-monitor.php.
 *
 * 💣 DESHALB FAEHRT DIESER TEST DIE ENDPUNKTE, statt ihren Quelltext zu lesen: die ECHTEN Rumpfzeilen
 * laufen in Kindprozessen mit ECHTEN Sitzungsdateien -- herausgeschnitten, ersetzt sind nur
 * Konfiguration, Datenbankverbindung und die zwei MySQL-DDL-Zeilen. Die Liste der GET-Aktionen wird
 * aus dem Endpunkt GELESEN: eine neue Aktion ist ohne Zutun mitgeprueft, und eine erfundene muss
 * ebenfalls abprallen.
 *
 * Vorbild: api/_internal/__tests__/edit-mode-riegel-test.php.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis (Windows; unter Linux sind die Erweiterungen eingebaut):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/__tests__/politik-lesepfade-riegel-test.php
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

// ⚠️ Die Abschlussroutine des API-Zaehlers (bootstrap.php) bleibt aus -- hier wie in den Kindern.
define('AVESMAPS_API_METRICS_REGISTRIERT', true);
require_once $WURZEL . '/api/_internal/auth.php';
require_once $WURZEL . '/api/_internal/political/territories-lese-riegel.php';

$ENDPUNKT = $WURZEL . '/api/_internal/political/territories-endpoint.php';

// =====================================================================================================
// TEIL 0 -- die GET-Aktionen, AUS DEM ENDPUNKT gelesen, und die reine Regel
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
$code = str_replace("\r\n", "\n", $nurCode((string) file_get_contents($ENDPUNKT)));

// Der GET-Zweig reicht vom Lesen der Aktion bis zur Methodenpruefung der Schreibwege.
$getAb = strpos($code, "\$action = avesmapsNormalizeSingleLine((string) (\$_GET['action']");
$getBis = strpos($code, "if (!in_array(\$requestMethod, ['POST', 'PATCH', 'DELETE'], true))");
$aktionen = [];
if ($getAb !== false && $getBis !== false && $getBis > $getAb) {
    $getZweig = substr($code, $getAb, $getBis - $getAb);
    preg_match_all("/\\\$action === '([a-z_]+)'/", $getZweig, $treffer);
    $aktionen = $treffer[1];
    $matchAb = strpos($getZweig, 'match ($action) {');
    $matchBis = $matchAb === false ? false : strpos($getZweig, '};', $matchAb);
    if ($matchAb !== false && $matchBis !== false) {
        preg_match_all("/^\\s*((?:'[a-z_]+'\\s*,\\s*)*'[a-z_]+')\\s*=>/m", substr($getZweig, $matchAb, $matchBis - $matchAb), $zeilen);
        foreach ($zeilen[1] as $zeile) {
            preg_match_all("/'([a-z_]+)'/", $zeile, $namen);
            array_push($aktionen, ...$namen[1]);
        }
    }
}
$aktionen = array_values(array_unique($aktionen));
pruefe(count($aktionen) >= 20, 'Vorbedingung: die GET-Aktionen sind aus dem Endpunkt lesbar, gefunden ' . count($aktionen));
foreach (['layer', 'wiki_list', 'geometry_assignment', 'change_log', 'debug', 'hierarchy'] as $bekannt) {
    pruefe(in_array($bekannt, $aktionen, true), "Vorbedingung: die gelesene Aktionsliste kennt `{$bekannt}` -- sonst ist der Leser veraltet");
}

// 🔴 Wer eine Aktion oeffentlich macht, aendert DIESE Zeile mit -- und schreibt dazu, warum ihre
// Antwort weder Wappen noch Notiz noch Wiki-Rohzeile traegt.
pruefe(AVESMAPS_POLITICAL_OEFFENTLICHE_LESEAKTIONEN === ['layer'], 'oeffentlich ist genau `layer`');
pruefe(AVESMAPS_POLITICAL_REVIEW_LESEAKTIONEN === ['change_log', 'geometry_inventory', 'geometry_collision'],
    'bei `review` bleiben genau die drei Protokoll-Leser');
foreach ($aktionen as $aktion) {
    $erwartet = $aktion === 'layer' ? null
        : (in_array($aktion, ['change_log', 'geometry_inventory', 'geometry_collision'], true) ? 'review' : 'edit');
    pruefe(avesmapsPoliticalLeseStufe($aktion) === $erwartet, "Stufe von `{$aktion}`: erwartet " . var_export($erwartet, true));
}
foreach (['', 'Layer', 'LAYER', 'layer ', 'gibt_es_nicht'] as $fremd) {
    pruefe(avesmapsPoliticalLeseStufe($fremd) === 'edit', 'eine unbekannte Aktion faellt geschlossen aus: ' . var_export($fremd, true));
}

// ---- Spielplatz: eigene Sitzungen, eigenes Temp -----------------------------------------------------
$spielplatz = sys_get_temp_dir() . '/avesmaps-politik-lesepfade-' . getmypid();
$sitzungen = $spielplatz . '/sitzungen';
$temp = $spielplatz . '/temp';
@mkdir($sitzungen, 0775, true);
@mkdir($temp, 0775, true);

$sitzungsId = static fn (string $rolle): string => 'plr' . getmypid() . $rolle;
$keks = static fn (string $rolle): array => [session_name() => $sitzungsId($rolle)];

ini_set('session.save_path', $sitzungen);
foreach ([
    'admin' => ['id' => 1, 'username' => 'test-admin', 'role' => 'admin'],
    'editor' => ['id' => 2, 'username' => 'test-editor', 'role' => 'editor'],
    'reviewer' => ['id' => 3, 'username' => 'test-reviewer', 'role' => 'reviewer'],
    // Die Sitzung gibt es noch, der Benutzer ist ausgetragen -- der Stand nach avesmapsLogout().
    'abgemeldet' => null,
] as $rolle => $eintrag) {
    session_id($sitzungsId($rolle));
    session_start();
    $_SESSION = $eintrag === null ? ['anderes' => 'x'] : [AVESMAPS_AUTH_SESSION_KEY => $eintrag];
    session_write_close();
}

// ---- Der Kindprozess --------------------------------------------------------------------------------
$kindSkript = $spielplatz . '/kind.php';
file_put_contents($kindSkript, <<<'KIND'
<?php

declare(strict_types=1);

$spec = json_decode((string) file_get_contents($argv[1]), true);
$wurzel = (string) $spec['wurzel'];

final class PlrSitzungsZaehler extends SessionHandler
{
    public static int $geoeffnet = 0;

    public function open(string $path, string $name): bool
    {
        self::$geoeffnet++;
        return parent::open($path, $name);
    }
}

register_shutdown_function(static function (): void {
    $status = http_response_code();
    $letzter = error_get_last();
    $fatal = is_array($letzter) && in_array($letzter['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true);
    echo "\n#ENDE " . json_encode([
        'status' => is_int($status) ? $status : null,
        'geoeffnet' => PlrSitzungsZaehler::$geoeffnet,
        'fatal' => $fatal ? $letzter['message'] : null,
    ], JSON_UNESCAPED_SLASHES) . "\n";
});
// Jede Warnung ist ein Fehler -- ausser sie ist mit @ ausdruecklich unterdrueckt.
set_error_handler(static function (int $stufe, string $text, string $datei, int $zeile): bool {
    if (!(error_reporting() & $stufe)) {
        return false;
    }
    throw new ErrorException("$text (" . basename($datei) . ":$zeile)", 0, $stufe, $datei, $zeile);
}, E_ALL);

define('AVESMAPS_API_METRICS_REGISTRIERT', true);

ini_set('session.save_path', (string) $spec['sitzungen']);
session_set_save_handler(new PlrSitzungsZaehler(), true);

$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['HTTP_ACCEPT_ENCODING'] = '';
unset($_SERVER['HTTP_ORIGIN'], $_SERVER['HTTP_IF_NONE_MATCH']);
$_GET = (array) $spec['get'];
foreach ((array) $spec['cookie'] as $name => $wert) {
    $_COOKIE[$name] = $wert;
}

// 💣 Nur wer eine Fixture bekommt, bekommt eine Datenbank. Ohne sie wirft jeder Zugriff auf
// $GLOBALS['plrPdo'] -- ein Riegel HINTER der Datenbankverbindung faellt damit laut auf.
if ((array) ($spec['sql'] ?? []) !== []) {
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    foreach ((array) $spec['sql'] as $anweisung) {
        $pdo->exec((string) $anweisung);
    }
    $GLOBALS['plrPdo'] = $pdo;
}

function plrSchnitt(string $quelle, int $ab, string $bis): string
{
    $ende = strpos($quelle, $bis, $ab);
    if ($ende === false) {
        throw new RuntimeException('Schnittmarke fehlt: ' . $bis);
    }
    return substr($quelle, $ab, $ende - $ab);
}

// 🔴 GENAU EINMAL -- sonst liefe hier stillschweigend etwas anderes als der Endpunkt.
function plrErsetze(string $code, string $alt, string $neu): string
{
    $anzahl = substr_count($code, $alt);
    if ($anzahl !== 1) {
        throw new RuntimeException("erwartet genau einmal, gefunden {$anzahl}: {$alt}");
    }
    return str_replace($alt, $neu, $code);
}

$modus = (string) $spec['modus'];
$pfad = $wurzel . match ($modus) {
    'riegel', 'voll' => '/api/_internal/political/territories-endpoint.php',
    'wikibrowser' => '/api/_internal/political/wiki-browser-endpoint.php',
};
// Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF.
$quelle = str_replace("\r\n", "\n", (string) file_get_contents($pfad));
$tryStart = strpos($quelle, "\ntry {\n");
if ($tryStart === false) {
    throw new RuntimeException('kein try-Block in ' . $pfad);
}
$rumpfAb = $tryStart + strlen("\ntry {\n");

// ⚠️ `eval` fuehrt hier ausschliesslich Quelltext AUS DIESEM REPO aus -- die Rumpfzeilen des Endpunkts,
// herausgeschnitten. Kein Eingang von aussen; dasselbe Verfahren wie edit-mode-riegel-test.php.
// Kopf (require, Konstanten) OHNE den Rumpf laden -- NEBEN dem Original, damit `__DIR__` stimmt.
$kopf = dirname($pfad) . '/.plr-kopf-' . getmypid() . '.php';
file_put_contents($kopf, substr($quelle, 0, $tryStart) . "\n");
try {
    require $kopf;
} finally {
    @unlink($kopf);
}

if ($modus === 'riegel') {
    // Alles bis zur Datenbankverbindung: edit_mode-Riegel, Schnellpfad, Lese-Riegel.
    $code = plrSchnitt($quelle, $rumpfAb, "    \$pdo = avesmapsCreatePdo(\$config['database'] ?? []);");
    eval(plrErsetze($code, 'avesmapsLoadApiConfig(avesmapsApiRoot())', '[]'));
    echo "#VOR-DER-DATENBANK\n";
    exit;
}

// Der ganze Rumpf bis zum catch der DATEIEBENE -- er endet in avesmapsJsonResponse (exit).
// 💣 Mit Zeilenumbruch und ohne Einrueckung: der GET-Zweig traegt ein eigenes, eingeruecktes
// `} catch (InvalidArgumentException $exception) {` (geometry_assignment), und ein Schnitt dort
// liesse eine offene Klammer zurueck.
$code = plrSchnitt($quelle, $rumpfAb, $modus === 'voll'
    ? "\n} catch (InvalidArgumentException \$exception) {"
    : "\n} catch (Throwable \$error) {");
$code = plrErsetze($code, 'avesmapsLoadApiConfig(avesmapsApiRoot())', '[]');
$code = plrErsetze($code, "avesmapsCreatePdo(\$config['database'] ?? [])", "\$GLOBALS['plrPdo']");
if ($modus === 'voll') {
    // MySQL-DDL, laeuft auf SQLite nicht; die Fixture legt ihre Tabellen selbst an.
    $code = plrErsetze($code, '    avesmapsPoliticalEnsureTablesEinmal($pdo);', '');
    $code = plrErsetze($code, '    avesmapsPoliticalEnsureDerivedGeometryTablesEinmal($pdo);', '');
}
eval($code);
echo "#KEIN-AUSGANG\n";
exit;
KIND);

$phpArgumente = [PHP_BINARY, '-d', 'zend.assertions=1', '-d', 'assert.exception=1', '-d', 'sys_temp_dir=' . $temp];
// ⚠️ Die -d-Schalter dieses Prozesses erbt ein Kind nicht. Was es nicht von selbst laedt, bekommt es.
foreach (['pdo_sqlite', 'mbstring'] as $erweiterung) {
    $probe = trim((string) shell_exec(escapeshellarg(PHP_BINARY) . ' -r '
        . escapeshellarg("echo extension_loaded('{$erweiterung}') ? 'ja' : 'nein';")));
    if ($probe !== 'ja') {
        $phpArgumente[] = '-d';
        $phpArgumente[] = 'extension=' . $erweiterung;
    }
}

function plrAuswerten(string $ausgabe): array
{
    $ausgabe = str_replace("\r\n", "\n", $ausgabe);
    $ende = strrpos($ausgabe, "#ENDE ");
    $abschluss = $ende === false ? null : json_decode(trim(substr($ausgabe, $ende + 6)), true);
    if (!is_array($abschluss) || $abschluss['fatal'] !== null) {
        return ['kaputt' => substr($ausgabe, 0, 1500)];
    }
    $rumpf = trim(substr($ausgabe, 0, $ende));

    return [
        'rumpf' => $rumpf,
        'status' => $abschluss['status'],
        'geoeffnet' => $abschluss['geoeffnet'],
        'json' => json_decode($rumpf, true),
    ];
}

// ⭐ PARALLEL, je acht Kinder: gut achtzig Kindprozesse kosteten seriell Sekunden, die das Deploy-Tor
// bei jedem Lauf zahlt. Die Kinder teilen nichts ausser den Sitzungsdateien, und die lesen sie nur.
$kinder = static function (array $szenarien) use ($phpArgumente, $kindSkript, $spielplatz, $WURZEL, $sitzungen): array {
    $ergebnisse = [];
    foreach (array_chunk($szenarien, 8, true) as $stapel) {
        $laufend = [];
        foreach ($stapel as $schluessel => $szenario) {
            $specDatei = $spielplatz . '/szenario-' . bin2hex(random_bytes(6)) . '.json';
            file_put_contents($specDatei, json_encode(
                ['wurzel' => $WURZEL, 'sitzungen' => $sitzungen] + $szenario + ['get' => [], 'cookie' => [], 'sql' => []],
                JSON_UNESCAPED_SLASHES
            ));
            $prozess = proc_open(
                array_merge($phpArgumente, [$kindSkript, $specDatei]),
                [1 => ['pipe', 'w'], 2 => ['redirect', 1]],
                $roehren
            );
            $laufend[$schluessel] = [$prozess, $roehren, $specDatei];
        }
        foreach ($laufend as $schluessel => [$prozess, $roehren, $specDatei]) {
            $ausgabe = is_resource($prozess) ? (string) stream_get_contents($roehren[1]) : '';
            if (is_resource($prozess)) {
                fclose($roehren[1]);
                proc_close($prozess);
            }
            @unlink($specDatei);
            $ergebnisse[$schluessel] = plrAuswerten($ausgabe);
        }
    }
    return $ergebnisse;
};
$heil = static function (array $lauf, string $was): bool {
    if (isset($lauf['kaputt'])) {
        pruefe(false, "{$was}: der Kindprozess ist gescheitert --\n" . $lauf['kaputt']);
        return false;
    }
    return true;
};
$abgesagt = static function (array $lauf, int $status, string $code): bool {
    return $lauf['status'] === $status
        && is_array($lauf['json'])
        && ($lauf['json']['ok'] ?? null) === false
        && ($lauf['json']['error']['code'] ?? null) === $code
        && !str_contains($lauf['rumpf'], '#VOR-DER-DATENBANK');
};
$vorbei = static fn (array $lauf): bool => str_contains($lauf['rumpf'], '#VOR-DER-DATENBANK');

$WAPPEN = 'https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/Wappen%20Testmark.png';
$fixture = [
    'CREATE TABLE political_territory_wiki (id INTEGER PRIMARY KEY, wiki_key TEXT, name TEXT, type TEXT, continent TEXT, '
        . 'affiliation_raw TEXT, affiliation_key TEXT, affiliation_root TEXT, affiliation_path_json TEXT, affiliation_json TEXT, '
        . 'status TEXT, form_of_government TEXT, capital_name TEXT, seat_name TEXT, ruler TEXT, language TEXT, currency TEXT, '
        . 'trade_goods TEXT, population TEXT, founded_text TEXT, founded_type TEXT, founded_start_bf INTEGER, founded_end_bf INTEGER, '
        . 'founded_display_bf REAL, founded_json TEXT, founder TEXT, dissolved_text TEXT, dissolved_type TEXT, dissolved_start_bf INTEGER, '
        . 'dissolved_end_bf INTEGER, dissolved_display_bf REAL, dissolved_json TEXT, geographic TEXT, political TEXT, trade_zone TEXT, '
        . 'blazon TEXT, wiki_url TEXT, coat_of_arms_url TEXT, raw_json TEXT, synced_at TEXT)',
    "INSERT INTO political_territory_wiki (id, wiki_key, name, type, continent, wiki_url, coat_of_arms_url, raw_json) VALUES "
        . "(1, 'wiki:testmark', 'Testmark', 'Markgrafschaft', 'Aventurien', 'https://de.wiki-aventurica.de/wiki/Testmark', "
        . "'{$WAPPEN}', '{\"Wappen-Link\":\"{$WAPPEN}\"}')",
    'CREATE TABLE political_territory (id INTEGER PRIMARY KEY, wiki_id INTEGER, is_active INTEGER)',
    'CREATE TABLE political_territory_geometry (id INTEGER PRIMARY KEY, territory_id INTEGER, is_active INTEGER)',
];

if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDOUT, "UEBERSPRUNGEN (pdo_sqlite fehlt): die Ablaeufe der zwei Endpunkte\n");
} else {
    // =================================================================================================
    // TEIL 1 -- der politische Endpunkt bis zur Datenbank: JEDE GET-Aktion, vier Rollen
    // =================================================================================================
    $szenarien = [];
    foreach ($aktionen as $aktion) {
        foreach (['anonym' => [], 'reviewer' => $keks('reviewer'), 'editor' => $keks('editor')] as $rolle => $cookie) {
            $szenarien["{$rolle}|{$aktion}"] = ['modus' => 'riegel', 'get' => ['action' => $aktion], 'cookie' => $cookie];
        }
    }
    $szenarien['anonym|ohne action'] = ['modus' => 'riegel', 'get' => ['zoom' => '3']];
    $szenarien['editor-keks|layer'] = ['modus' => 'riegel', 'get' => ['action' => 'layer'], 'cookie' => $keks('editor')];
    $szenarien['anonym|gibt_es_nicht'] = ['modus' => 'riegel', 'get' => ['action' => 'gibt_es_nicht']];
    $szenarien['editor|gibt_es_nicht'] = ['modus' => 'riegel', 'get' => ['action' => 'gibt_es_nicht'], 'cookie' => $keks('editor')];
    $szenarien['anonym|Layer'] = ['modus' => 'riegel', 'get' => ['action' => 'Layer']];
    $szenarien['abgemeldet|wiki_list'] = ['modus' => 'riegel', 'get' => ['action' => 'wiki_list'], 'cookie' => $keks('abgemeldet')];
    $szenarien['abgemeldet|change_log'] = ['modus' => 'riegel', 'get' => ['action' => 'change_log'], 'cookie' => $keks('abgemeldet')];
    $szenarien['admin|wiki_list'] = ['modus' => 'riegel', 'get' => ['action' => 'wiki_list'], 'cookie' => $keks('admin')];
    $szenarien['anonym-edit_mode|wiki_list'] = ['modus' => 'riegel', 'get' => ['action' => 'wiki_list', 'edit_mode' => '1']];

    // TEIL 2 -- der ganze Rumpf mit Datenbank: der Editor bekommt, was er braucht
    $szenarien['voll|editor|wiki_list'] = ['modus' => 'voll', 'get' => ['action' => 'wiki_list'], 'cookie' => $keks('editor'), 'sql' => $fixture];
    $szenarien['voll|anonym|wiki_list'] = ['modus' => 'voll', 'get' => ['action' => 'wiki_list']];
    $szenarien['voll|anonym|layer-los'] = ['modus' => 'voll', 'get' => ['action' => 'get', 'public_id' => 'x']];

    // TEIL 3 -- der Wiki-Browser, ganzer Rumpf
    $szenarien['wiki|anonym'] = ['modus' => 'wikibrowser', 'get' => ['limit' => '5']];
    $szenarien['wiki|abgemeldet'] = ['modus' => 'wikibrowser', 'cookie' => $keks('abgemeldet')];
    $szenarien['wiki|reviewer'] = ['modus' => 'wikibrowser', 'cookie' => $keks('reviewer')];
    $szenarien['wiki|editor'] = ['modus' => 'wikibrowser', 'cookie' => $keks('editor'), 'sql' => $fixture];
    $szenarien['wiki|admin'] = ['modus' => 'wikibrowser', 'cookie' => $keks('admin'), 'sql' => $fixture];

    $laeufe = $kinder($szenarien);

    foreach ($aktionen as $aktion) {
        $stufe = avesmapsPoliticalLeseStufe($aktion);

        $lauf = $laeufe["anonym|{$aktion}"];
        if ($heil($lauf, "anonym|{$aktion}")) {
            if ($aktion === 'layer') {
                pruefe($vorbei($lauf), '`layer` bleibt oeffentlich -- ein Besucher kommt am Lese-Riegel vorbei');
            } else {
                pruefe($abgesagt($lauf, 401, 'unauthenticated'),
                    "DER KERN: anonym `{$aktion}` -> 401 VOR der Datenbank, kam: " . var_export($lauf['status'], true) . ' ' . substr($lauf['rumpf'], 0, 200));
            }
            pruefe($lauf['geoeffnet'] === 0,
                "anonym `{$aktion}` ohne Sitzungs-Cookie eroeffnet KEINE Sitzung (keine Sitzungsdatei, kein Lock), gezaehlt: " . var_export($lauf['geoeffnet'], true));
        }

        $lauf = $laeufe["reviewer|{$aktion}"];
        if ($heil($lauf, "reviewer|{$aktion}")) {
            if ($stufe === 'edit') {
                pruefe($abgesagt($lauf, 403, 'forbidden'),
                    "Owner-Entscheid `edit`: ein Reviewer bekommt `{$aktion}` nicht, kam: " . var_export($lauf['status'], true) . ' ' . substr($lauf['rumpf'], 0, 200));
            } else {
                pruefe($vorbei($lauf), "`{$aktion}` bleibt Reviewern offen (Stufe " . var_export($stufe, true) . ')');
            }
        }

        $lauf = $laeufe["editor|{$aktion}"];
        if ($heil($lauf, "editor|{$aktion}")) {
            pruefe($vorbei($lauf), "ein Editor kommt bei `{$aktion}` am Lese-Riegel vorbei, kam: " . substr($lauf['rumpf'], 0, 200));
        }
    }

    $lauf = $laeufe['anonym|ohne action'];
    if ($heil($lauf, 'anonym|ohne action')) {
        pruefe($vorbei($lauf) && $lauf['geoeffnet'] === 0, 'ohne `action` ist es die Ebene -- oeffentlich, ohne Sitzung');
    }
    $lauf = $laeufe['editor-keks|layer'];
    if ($heil($lauf, 'editor-keks|layer')) {
        pruefe($vorbei($lauf) && $lauf['geoeffnet'] === 0,
            '⚠️ DER HEISSE PFAD: `layer` liest KEINE Sitzung, auch nicht, wenn ein Cookie mitkommt, gezaehlt: ' . var_export($lauf['geoeffnet'], true));
    }
    $lauf = $laeufe['anonym|gibt_es_nicht'];
    if ($heil($lauf, 'anonym|gibt_es_nicht')) {
        pruefe($abgesagt($lauf, 401, 'unauthenticated'), 'eine unbekannte Aktion faellt GESCHLOSSEN aus -- die naechste neue ist ohne Zutun geschuetzt');
    }
    $lauf = $laeufe['editor|gibt_es_nicht'];
    if ($heil($lauf, 'editor|gibt_es_nicht')) {
        pruefe($vorbei($lauf), 'und ein Editor bekommt dort die gewohnte Fehlermeldung des Endpunkts, nicht die des Riegels');
    }
    $lauf = $laeufe['anonym|Layer'];
    if ($heil($lauf, 'anonym|Layer')) {
        pruefe($abgesagt($lauf, 401, 'unauthenticated'), 'die Positivliste vergleicht exakt -- `Layer` ist nicht `layer`');
    }
    foreach (['abgemeldet|wiki_list', 'abgemeldet|change_log'] as $lage) {
        $lauf = $laeufe[$lage];
        if ($heil($lauf, $lage)) {
            pruefe($abgesagt($lauf, 401, 'unauthenticated'), "{$lage}: eine Sitzung ohne Benutzer ist nicht angemeldet");
            pruefe($lauf['geoeffnet'] === 1, "{$lage}: mit Cookie wird die Sitzung genau einmal gelesen, gezaehlt: " . var_export($lauf['geoeffnet'], true));
        }
    }
    $lauf = $laeufe['admin|wiki_list'];
    if ($heil($lauf, 'admin|wiki_list')) {
        pruefe($vorbei($lauf), 'ein Admin darf, was ein Editor darf');
    }
    $lauf = $laeufe['anonym-edit_mode|wiki_list'];
    if ($heil($lauf, 'anonym-edit_mode|wiki_list')) {
        pruefe($abgesagt($lauf, 401, 'unauthenticated'), '`edit_mode=1` oeffnet die Lesetuer nicht');
    }

    $lauf = $laeufe['voll|editor|wiki_list'];
    if ($heil($lauf, 'voll|editor|wiki_list')) {
        $zeilen = is_array($lauf['json']) ? (array) ($lauf['json']['wiki'] ?? []) : [];
        pruefe($lauf['status'] === 200 && ($lauf['json']['ok'] ?? null) === true,
            'der ganze Rumpf: ein Editor bekommt `wiki_list` weiterhin, kam: ' . var_export($lauf['status'], true) . ' ' . substr($lauf['rumpf'], 0, 300));
        pruefe(($zeilen[0]['coat_of_arms_url'] ?? null) === $WAPPEN,
            'und darin das Wappen, das er im Dialog braucht, kam: ' . var_export($zeilen[0]['coat_of_arms_url'] ?? null, true));
    }
    foreach (['voll|anonym|wiki_list', 'voll|anonym|layer-los'] as $lage) {
        $lauf = $laeufe[$lage];
        if ($heil($lauf, $lage)) {
            pruefe($abgesagt($lauf, 401, 'unauthenticated') && !str_contains($lauf['rumpf'], 'Testmark'),
                "{$lage}: der ganze Rumpf OHNE Datenbank sagt 401 -- der Riegel steht vor jedem Zugriff darauf");
        }
    }

    foreach (['wiki|anonym' => [401, 'unauthenticated', 0], 'wiki|abgemeldet' => [401, 'unauthenticated', 1], 'wiki|reviewer' => [403, 'forbidden', 1]] as $lage => [$status, $fehlerCode, $geoeffnet]) {
        $lauf = $laeufe[$lage];
        if ($heil($lauf, $lage)) {
            pruefe($lauf['status'] === $status && ($lauf['json']['error']['code'] ?? null) === $fehlerCode,
                "Wiki-Browser, {$lage}: erwartet {$status} {$fehlerCode} VOR der Datenbank, kam: " . var_export($lauf['status'], true) . ' ' . substr($lauf['rumpf'], 0, 200));
            pruefe($lauf['geoeffnet'] === $geoeffnet,
                "Wiki-Browser, {$lage}: {$geoeffnet} Sitzung(en) geoeffnet, gezaehlt: " . var_export($lauf['geoeffnet'], true));
        }
    }
    foreach (['wiki|editor', 'wiki|admin'] as $lage) {
        $lauf = $laeufe[$lage];
        if ($heil($lauf, $lage)) {
            $items = is_array($lauf['json']) ? (array) ($lauf['json']['items'] ?? []) : [];
            pruefe($lauf['status'] === 200 && ($lauf['json']['ok'] ?? null) === true && ($items[0]['coat_of_arms_url'] ?? null) === $WAPPEN,
                "Wiki-Browser, {$lage}: angemeldet unveraendert, samt Wappen -- kam: " . var_export($lauf['status'], true) . ' ' . substr($lauf['rumpf'], 0, 300));
        }
    }
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
echo "OK: politik-lesepfade-riegel-test -- ausser `layer` gibt es die Lesepfade der Herrschaftsgebiete und den Wiki-Browser nur mit Editor-Anmeldung.\n";
