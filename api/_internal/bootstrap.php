<?php

declare(strict_types=1);

if (!defined('AVESMAPS_API_ROOT')) {
    $avesmapsBootstrapDirectory = __DIR__;
    $avesmapsApiRoot = basename($avesmapsBootstrapDirectory) === '_internal'
        ? dirname($avesmapsBootstrapDirectory)
        : $avesmapsBootstrapDirectory;

    define('AVESMAPS_API_ROOT', $avesmapsApiRoot);

    unset($avesmapsBootstrapDirectory, $avesmapsApiRoot);
}

function avesmapsApiRoot(): string {
    return AVESMAPS_API_ROOT;
}

function avesmapsLoadApiConfig(string $apiDirectory): array {
    foreach (avesmapsBuildApiConfigSearchDirectories($apiDirectory) as $configDirectory) {
        $localConfigPath = $configDirectory . DIRECTORY_SEPARATOR . 'config.local.php';
        if (!is_file($localConfigPath)) {
            continue;
        }

        $config = require $localConfigPath;
        if (is_array($config)) {
            return $config;
        }

        throw new RuntimeException('Die lokale API-Konfiguration ist ungueltig.');
    }

    $environmentConfig = avesmapsBuildApiConfigFromEnvironment();
    if ($environmentConfig !== null) {
        return $environmentConfig;
    }

    throw new RuntimeException('Es wurde keine API-Konfiguration gefunden.');
}

function avesmapsBuildApiConfigSearchDirectories(string $apiDirectory): array {
    $configDirectories = [];
    foreach ([$apiDirectory, avesmapsApiRoot()] as $candidateDirectory) {
        $normalizedDirectory = rtrim((string) $candidateDirectory, DIRECTORY_SEPARATOR);
        if ($normalizedDirectory === '' || isset($configDirectories[$normalizedDirectory])) {
            continue;
        }

        $configDirectories[$normalizedDirectory] = $normalizedDirectory;
    }

    return array_values($configDirectories);
}

function avesmapsBuildApiConfigFromEnvironment(): ?array {
    $driver = trim((string) getenv('AVESMAPS_DB_DRIVER'));
    $host = trim((string) getenv('AVESMAPS_DB_HOST'));
    $port = trim((string) getenv('AVESMAPS_DB_PORT'));
    $databaseName = trim((string) getenv('AVESMAPS_DB_NAME'));
    $user = trim((string) getenv('AVESMAPS_DB_USER'));
    $password = (string) getenv('AVESMAPS_DB_PASSWORD');

    if ($driver === '' || $host === '' || $port === '' || $databaseName === '' || $user === '') {
        return null;
    }

    $allowedOrigins = array_filter(
        array_map(
            static fn(string $origin): string => trim($origin),
            explode(',', (string) getenv('AVESMAPS_ALLOWED_ORIGINS'))
        ),
        static fn(string $origin): bool => $origin !== ''
    );

    return [
        'database' => [
            'driver' => $driver,
            'host' => $host,
            'port' => $port,
            'name' => $databaseName,
            'charset' => trim((string) getenv('AVESMAPS_DB_CHARSET')) ?: 'utf8mb4',
            'user' => $user,
            'password' => $password,
        ],
        'cors' => [
            'allowed_origins' => array_values($allowedOrigins),
        ],
        'import_api' => [
            'token' => trim((string) getenv('AVESMAPS_IMPORT_API_TOKEN')),
        ],
    ];
}

/**
 * Die CORS-Antwortkoepfe dieses Endpunkts. Rueckgabe `false` heisst „diese Herkunft darf nicht".
 *
 * 🔴 `$publicApi` OEFFNET FUER JEDE HERKUNFT, UND ER GEHOERT GENAU ZWEI ENDPUNKTEN:
 * `POST /api/route/` und `GET /api/locations/` -- dem stabilen oeffentlichen Vertrag (§ oben in
 * api/README.md). Owner-Entscheid vom 25.08.2026, nach Meldung #96: eine fremde Seite bekam eine
 * **403**, weil ihre Herkunft nicht in `config.local.php` gelistet ist. Eine „stabile
 * Entwickler-API", die man aus dem Browser nicht aufrufen kann, ist keine.
 *
 * 💣 UND DESHALB JE ENDPUNKT UND NICHT IN DER LISTE. Diese Funktion hat **91** Aufrufer; die
 * konfigurierte Liste global auf `['*']` zu stellen haette mit einem Zeichen auch `api/edit/**`
 * (Schreibwege hinter Faehigkeiten), `api/import/**` und `api/diagnostics/**` fuer jede fremde
 * Webseite lesbar gemacht -- und kein einziger Aufrufer haette anders ausgesehen als vorher.
 * Gewacht von `_internal/__tests__/cors-oeffentlicher-vertrag-test.php`, das die Liste der
 * geoeffneten Endpunkte auf genau diese zwei festnagelt.
 *
 * 🔴 KEIN `Access-Control-Allow-Credentials`, UND DAS IST DIE SICHERUNG. Bei
 * `Allow-Origin: *` schickt der Browser grundsaetzlich keine Cookies mit, eine fremde Seite kann
 * also die angemeldete Sitzung eines Editors nicht benutzen -- ein Aufruf von dort ist immer
 * anonym und trifft auf dieselbe Antwort wie `curl`. Wer je Anmeldedaten zulassen will, muss im
 * selben Zug `*` gegen eine echte Herkunftsliste tauschen; beides zusammen macht jede
 * Editor-Sitzung von jeder Webseite aus fahrbar.
 *
 * ⚠️ CORS regelt NUR, ob Browser-JS die Antwort lesen darf. Gegen Abrufe per `curl` hat es nie
 * geschuetzt und tut es weiterhin nicht -- an der Lastfrage aus AGENTS.md §9 aendert die Oeffnung
 * also nichts, weder gut noch schlecht.
 */
function avesmapsApplyCorsPolicy(array $config, bool $publicApi = false): bool {
    $origin = avesmapsNormalizeCorsOrigin((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
    if ($origin === '') {
        return true;
    }

    if ($publicApi) {
        // ⚠️ VOR der Liste: ein Endpunkt des oeffentlichen Vertrags darf nicht davon abhaengen, was
        // in `api/config.local.php` auf dem Server gepflegt ist -- diese Datei liegt nicht im Repo,
        // und ein leerer Eintrag dort wuerde den Vertrag lautlos wieder schliessen.
        // 💣 Konstantes `*`, deshalb KEIN `Vary: Origin` -- die Antwort haengt hier nicht von der
        // Herkunft ab, und ein Vary auf einer immer gleichen Antwort zersplittert nur jeden Cache.
        header('Access-Control-Allow-Origin: *');
        avesmapsSendCommonCorsHeaders();

        return true;
    }

    $allowedOrigins = avesmapsGetAllowedOrigins($config);
    if ($allowedOrigins === []) {
        return false;
    }

    if ($allowedOrigins === ['*']) {
        header('Access-Control-Allow-Origin: *');
    } elseif (!in_array($origin, $allowedOrigins, true)) {
        return false;
    } else {
        header("Access-Control-Allow-Origin: {$origin}");
        header('Vary: Origin');
    }

    avesmapsSendCommonCorsHeaders();

    return true;
}

/**
 * Die Koepfe, die BEIDE Wege durch avesmapsApplyCorsPolicy gemeinsam haben.
 *
 * ⚠️ Sie stehen hier und nicht zweimal im Aufrufer: die Freigabeliste unten ist genau die Art Zeile,
 * die man an einer von zwei Stellen nachzieht und an der anderen vergisst -- und dann liest ein
 * fremder Client den ETag am oeffentlichen Endpunkt nicht, waehrend er es am App-Endpunkt tut.
 */
function avesmapsSendCommonCorsHeaders(): void {
    header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Accept, Authorization, X-Avesmaps-Import-Token');
    // 💣 OHNE DIESE ZEILE KANN EIN FREMDER BROWSER-CLIENT DEN ETAG NICHT LESEN -- auch dann nicht,
    // wenn der Server ihn sendet. Ein `fetch()` von einer anderen Herkunft sieht per CORS nur eine
    // Handvoll Standardkoepfe; alles andere muss ausdruecklich freigegeben werden, sonst gibt
    // `response.headers.get('ETag')` schlicht `null` zurueck. `GET /api/locations/` ist Teil des
    // stabilen Vertrags und wird genau von solchen Clients gelesen -- ohne die Freigabe ist die
    // bedingte Anfrage dort unbenutzbar, ganz unabhaengig davon, was die Hosting-Schicht macht.
    // ⚠️ Freigeben heisst nur LESEN duerfen, was ohnehin gesendet wird -- kein neuer Inhalt.
    header('Access-Control-Expose-Headers: ETag, X-Avesmaps-ETag');
    header('Access-Control-Max-Age: 86400');
}

function avesmapsNormalizeCorsOrigin(string $origin): string {
    $normalizedOrigin = trim($origin);
    if ($normalizedOrigin === '' || $normalizedOrigin === '*') {
        return $normalizedOrigin;
    }

    if (!preg_match('/^https?:\/\//i', $normalizedOrigin)) {
        return strtolower(rtrim($normalizedOrigin, '/'));
    }

    $parts = parse_url($normalizedOrigin);
    if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
        return strtolower(rtrim($normalizedOrigin, '/'));
    }

    $scheme = strtolower((string) $parts['scheme']);
    $host = strtolower((string) $parts['host']);
    $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';

    return "{$scheme}://{$host}{$port}";
}

function avesmapsGetAllowedOrigins(array $config): array {
    $origins = $config['cors']['allowed_origins'] ?? [];
    if (!is_array($origins)) {
        return [];
    }

    $normalizedOrigins = [];
    foreach ($origins as $origin) {
        $normalizedOrigin = avesmapsNormalizeCorsOrigin((string) $origin);
        if ($normalizedOrigin === '') {
            continue;
        }

        $normalizedOrigins[$normalizedOrigin] = $normalizedOrigin;
    }

    return array_values($normalizedOrigins);
}

function avesmapsJsonResponse(int $statusCode, array $payload = []): never {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');

    if ($statusCode !== 204) {
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    exit;
}

function avesmapsReadJsonRequest(): array {
    $rawRequestBody = file_get_contents('php://input');
    if (!is_string($rawRequestBody) || trim($rawRequestBody) === '') {
        throw new InvalidArgumentException('Die Anfrage enthaelt keine JSON-Daten.');
    }

    try {
        $payload = json_decode($rawRequestBody, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $exception) {
        throw new InvalidArgumentException('Die Anfrage enthaelt ungueltiges JSON.');
    }

    if (!is_array($payload)) {
        throw new InvalidArgumentException('Die Anfrage enthaelt kein gueltiges JSON-Objekt.');
    }

    return $payload;
}

function avesmapsCreatePdo(array $databaseConfig): PDO {
    $driver = trim((string) ($databaseConfig['driver'] ?? ''));
    $host = trim((string) ($databaseConfig['host'] ?? ''));
    $port = trim((string) ($databaseConfig['port'] ?? ''));
    $databaseName = trim((string) ($databaseConfig['name'] ?? ''));
    $charset = trim((string) ($databaseConfig['charset'] ?? 'utf8mb4'));
    $user = (string) ($databaseConfig['user'] ?? '');
    $password = (string) ($databaseConfig['password'] ?? '');

    if ($driver === '' || $host === '' || $port === '' || $databaseName === '' || $user === '') {
        throw new RuntimeException('Die Datenbank-Konfiguration ist unvollstaendig.');
    }

    $dsn = match ($driver) {
        'mysql', 'mariadb' => sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=%s',
            $host,
            $port,
            $databaseName,
            $charset
        ),
        'pgsql', 'postgres', 'postgresql' => sprintf(
            'pgsql:host=%s;port=%s;dbname=%s',
            $host,
            $port,
            $databaseName
        ),
        default => throw new RuntimeException('Der Datenbank-Treiber wird nicht unterstuetzt.'),
    };

    return new PDO(
        $dsn,
        $user,
        $password,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
}

function avesmapsGetConfiguredImportApiToken(array $config): string {
    return trim((string) ($config['import_api']['token'] ?? ''));
}

function avesmapsReadRequestHeader(string $headerName): string {
    $serverKey = 'HTTP_' . str_replace('-', '_', strtoupper($headerName));
    return trim((string) ($_SERVER[$serverKey] ?? ''));
}

function avesmapsReadBearerTokenFromRequest(): string {
    $authorizationHeader = avesmapsReadRequestHeader('Authorization');
    if (preg_match('/^Bearer\s+(.+)$/i', $authorizationHeader, $matches) !== 1) {
        return '';
    }

    return trim((string) ($matches[1] ?? ''));
}

function avesmapsReadImportApiTokenFromRequest(): string {
    $headerToken = avesmapsReadRequestHeader('X-Avesmaps-Import-Token');
    if ($headerToken !== '') {
        return $headerToken;
    }

    return avesmapsReadBearerTokenFromRequest();
}

function avesmapsNormalizeSingleLine(?string $value, int $maxLength): string {
    $normalizedValue = preg_replace('/\s+/u', ' ', trim((string) $value)) ?? '';
    if (mb_strlen($normalizedValue) <= $maxLength) {
        return $normalizedValue;
    }

    return mb_substr($normalizedValue, 0, $maxLength);
}

function avesmapsNormalizeMultiline(?string $value, int $maxLength): string {
    $normalizedValue = trim(str_replace("\r\n", "\n", (string) $value));
    if (mb_strlen($normalizedValue) <= $maxLength) {
        return $normalizedValue;
    }

    return mb_substr($normalizedValue, 0, $maxLength);
}

function avesmapsNormalizeOptionalUrl(?string $value, int $maxLength, string $fieldLabel): string {
    $normalizedValue = avesmapsNormalizeSingleLine($value, $maxLength);
    if ($normalizedValue === '') {
        return '';
    }

    if (!preg_match('/^https?:\/\//i', $normalizedValue)) {
        throw new InvalidArgumentException("{$fieldLabel} muss mit http:// oder https:// beginnen.");
    }

    return $normalizedValue;
}

/**
 * Wie avesmapsNormalizeOptionalUrl, laesst aber zusaetzlich eine SELBST HOCHGELADENE Datei zu.
 *
 * 💣 Bug #99 (25.08.2026): "Territorium kann nicht angelegt werden" -- der Editor bekam
 * "Der Wappen-Link muss mit http:// oder https:// beginnen", obwohl auf der ganzen Stufe nur
 * eigene Wappen lagen. Dieselbe Frage hatte zwei Antworten: der Upload erzeugt
 * '/uploads/wappen/own/<datei>' (settlement-coat-upload.php), und der Leser laesst genau diese
 * Form als Override sogar ueber Wiki- und Ortswappen gewinnen (avesmapsResolveGatedCoatUrl) --
 * nur der Schreiber wies sie ab. Verschaerft dadurch, dass die Zuweisung den in der DATENBANK
 * stehenden Wert der ganzen Kette mitvalidiert: ein Vorfahre mit eigenem Wappen blockierte
 * damit eine Aktion, die das Wappen gar nicht anfasst.
 *
 * ⚠️ Eng bleiben: erlaubt ist der Upload-Ordner, NICHT jeder Pfad mit fuehrendem Schraegstrich.
 * '//fremde.example/x.png' ist protokollrelativ und fuehrt nach DRAUSSEN -- ein blosses
 * "beginnt mit /" haette es durchgelassen. '..' faellt aus demselben Grund heraus.
 */
function avesmapsNormalizeOptionalCoatUrl(?string $value, int $maxLength, string $fieldLabel): string {
    $normalizedValue = avesmapsNormalizeSingleLine($value, $maxLength);
    if ($normalizedValue === '') {
        return '';
    }

    if (str_starts_with($normalizedValue, '/uploads/') && !str_contains($normalizedValue, '..')) {
        return $normalizedValue;
    }

    if (!preg_match('/^https?:\/\//i', $normalizedValue)) {
        throw new InvalidArgumentException(
            "{$fieldLabel} muss mit http:// oder https:// beginnen oder auf eine hochgeladene Datei unter /uploads/ zeigen."
        );
    }

    return $normalizedValue;
}

function avesmapsParseMapCoordinate(mixed $value, string $fieldName): float {
    $normalizedValue = is_string($value) ? str_replace(',', '.', trim($value)) : $value;
    $coordinate = filter_var($normalizedValue, FILTER_VALIDATE_FLOAT);
    if ($coordinate === false || $coordinate < 0 || $coordinate > 1024) {
        throw new InvalidArgumentException("Die Koordinate {$fieldName} ist ungueltig.");
    }

    return round((float) $coordinate, 3);
}

// The key every throttle in the house is bucketed by, and the value hashed into `ip_hash`.
//
// 💣 IT MUST BE AN IP ADDRESS, AND UNTIL 2026-08-05 IT DID NOT HAVE TO BE (finding A29). The old
// version returned the leftmost X-Forwarded-For element unchecked -- any 64 characters the caller
// felt like sending. Two consequences, and the second one is the quiet one:
//   * a fresh string per request was a fresh bucket, so every throttle was one header away from
//     being no throttle at all;
//   * `ip_hash` was then not the hash of an address but of arbitrary caller-supplied text, which is
//     not what a column called ip_hash promises anyone reading the schema for a privacy answer.
//
// Now every candidate has to pass FILTER_VALIDATE_IP, and anything that does not is skipped rather
// than trusted -- so a caller who sends junk in X-Forwarded-For falls back to their own REMOTE_ADDR
// instead of choosing their own bucket. Spoofing with garbage stops working outright.
//
// ⚠️ WHAT THIS DOES NOT FIX, so nobody mistakes it for the whole finding: a caller who sends a
// syntactically VALID address they do not own is still believed. Closing that means deciding whether
// to trust X-Forwarded-For at all, and that depends on whether a reverse proxy sits in front --
// with one, REMOTE_ADDR is the same value for every visitor and switching to it would put the whole
// site in one bucket. That question is open (owner decision, see docs/systemtest-2026-08-05/1-akut.md
// A29); this change is correct under every answer to it, which is why it did not wait for one.
function avesmapsClientIpAddress(): string {
    // 💣 X-FORWARDED-FOR WIRD NICHT MEHR GELESEN (Befund A29, zweite Haelfte, 06.08.2026).
    //
    // Der Kopf gehoert dem AUFRUFER, solange kein Zwischenserver davorsteht -- er kann ihn frei
    // setzen, und jeder neue Wert war ein frischer Drossel-Eimer. Die Pruefung auf eine gueltige IP
    // (864fe864) nahm dem nur die Bequemlichkeit: eine syntaktisch richtige, FREMDE Adresse wurde
    // weiterhin geglaubt. Damit war jede der vier Drosseln im Haus einen Kopf weit von wirkungslos
    // entfernt -- und umgekehrt sperrte, wer die Adresse eines Fremden schickte, diesen aus.
    //
    // 📊 DIE ENTSCHEIDUNG STEHT AUF EINER MESSUNG, NICHT AUF EINER ANNAHME. Von aussen ist die
    // Topologie nicht ablesbar, dafuer gibt es api/edit/admin/proxy-check.php. Owner-Messung vom
    // 06.08.2026: `forwarded_header_present: false`, `forwarded_entry_count: 0`,
    // `proxy_evidence_headers: []` -- es kommt kein Weiterreich-Kopf an und kein Via/X-Real-IP.
    // Zweiter, unabhaengiger Beleg: 92 verschiedene `ip_hash` im Bestand. Die entstanden unter der
    // alten Regel, die den Kopf BEVORZUGT haette -- da keiner ankommt, waren sie bereits
    // REMOTE_ADDR-basiert. Beide Messungen sagen dasselbe: REMOTE_ADDR unterscheidet die Besucher.
    //
    // ⭐ FUER ECHTE BESUCHER AENDERT SICH NICHTS. Da ohnehin kein Kopf ankommt, war REMOTE_ADDR
    // schon vorher der genommene Zweig -- gespeicherte `ip_hash`-Werte bleiben gueltig, die
    // Besucherzahlen machen keinen Sprung. Wirksam wird diese Aenderung allein gegen den, der sich
    // einen Kopf selbst schickt, und das ist ihr ganzer Zweck.
    //
    // 🔴 STELLT STRATO JE EINEN ZWISCHENSERVER DAVOR, IST DIESE ZEILE FALSCH. Dann waere
    // REMOTE_ADDR fuer JEDEN Besucher derselbe Wert, alle landen in EINEM Eimer, und nach fuenf
    // Meldungen ist die Meldestrecke fuer die ganze Seite gesperrt. Das faellt sofort auf, und die
    // Diagnose oben sagt in einem Aufruf, ob es so weit ist. Der Weg zurueck ist dann NICHT
    // pauschales Vertrauen in den Kopf, sondern eine Liste der Adressen, denen man ihn glaubt:
    // nur wenn REMOTE_ADDR eine davon ist, zaehlt das RECHTESTE Element. Bewusst nicht auf Vorrat
    // gebaut -- eine leere Liste, die niemand pflegt, ist eine zweite Betriebsart, die nie jemand
    // geprueft hat.
    //
    // ⚠️ An empty return is deliberate and is the SAFE direction: everyone whose address cannot be
    // established shares one bucket, rather than each getting a private one keyed on their own junk.
    $remoteAddress = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));

    return filter_var($remoteAddress, FILTER_VALIDATE_IP) !== false ? $remoteAddress : '';
}

// Vergleicht If-None-Match (kann Liste sein, "*" oder W/-praefixiert) gegen unseren ETag.
//
// 💣 Wohnt hier, weil zwei oeffentliche Endpunkte ihn brauchen und der eine ein SKRIPT ist: er
// stand in api/app/map-features.php, und api/locations/index.php haette ihn nur bekommen koennen,
// indem es map-features.php einbindet -- also die ganze Kartenantwort ausfuehrt. Die Alternative
// waere eine Kopie gewesen, und zwei Kopien einer Vergleichsregel driften.
// 💣 function_exists, und das ist kein Zierrat. Der Deploy laedt Datei fuer Datei per SFTP, ohne
// Staging und ohne atomares Umbenennen, und STRATOs opcache prueft JEDE Datei einzeln mit 2-4
// Minuten Verzug. Zwischen dem Hochladen dieser Datei und dem von api/app/map-features.php (das
// dieselbe Funktion bis 9f2962e8 selbst deklarierte) gibt es also ein Fenster, in dem beide
// Fassungen zugleich gelten. PHP bindet Funktionen auf oberster Ebene beim Kompilieren -- die alte
// map-features.php haette ihre Kopie registriert, BEVOR ihr require dieser Datei laeuft, und der
// Fatal „Cannot redeclare" trifft als E_COMPILE_ERROR, also VOR jedem try. Kein catch, keine
// Fehlerantwort, kein CORS-Kopf: eine leere 500 fuer jeden Besucher, auf dem meistgerufenen
// Endpunkt der Seite. Derselbe Fatal trifft bei einem `git revert`, nur mit vertauschten Rollen.
if (!function_exists('avesmapsETagMatches')) {
function avesmapsETagMatches(string $ifNoneMatch, string $etag): bool {
    if (trim($ifNoneMatch) === '*') {
        return true;
    }
    $normalize = static fn(string $value): string => trim(preg_replace('/^W\//i', '', trim($value)) ?? trim($value));
    $target = $normalize($etag);
    foreach (explode(',', $ifNoneMatch) as $candidate) {
        if ($normalize($candidate) === $target) {
            return true;
        }
    }

    return false;
}
}

// 🔴 `$errorDetails` HAENGT IN DIE HUELLE, ES BAUT SIE NICHT UM (AGENTS.md §4). Der Vertrag ist
// `{ok:false, error:{code, message}}`; ein Endpunkt, der einem Fall etwas Maschinenlesbares
// beilegen will (etwa die Kennung des Objekts, an dem er scheitert), legt es NEBEN `code`/`message`
// in dasselbe `error`-Objekt. `code` und `message` gewinnen immer -- ein Detailschluessel kann sie
// nicht ueberschreiben, sonst waere der Vertrag von aussen verhandelbar.
function avesmapsErrorResponse(int $statusCode, string $code, string $message, array $errorDetails = []): never {
    avesmapsJsonResponse($statusCode, [
        'ok' => false,
        'error' => [
            'code' => $code,
            'message' => $message,
        ] + $errorDetails,
    ]);
}

/**
 * 🔴 EIN PHP-ABBRUCH ANTWORTET SONST MIT NICHTS -- UND DAS SIEHT AUS WIE EIN NETZFEHLER.
 *
 * Ein Zeitlimit, ein Speicherlimit oder ein Fatal laufen an JEDEM try/catch vorbei: PHP bricht
 * ab, der Rumpf bleibt leer oder halb, und der Browser meldet „Internal server error" bzw.
 * „Unexpected end of JSON input". Der Grund steht dann im Fehlerprotokoll des Servers -- und
 * bei STRATO gibt es keins, das man lesen koennte (24.08.2026 nachgesehen: kein logs/).
 *
 * Also holt der Abschluss-Handler den Grund selbst ab. `error_get_last()` ueberlebt den
 * Abbruch, und Abschlussfunktionen laufen auch nach einem Fatal noch.
 *
 * 💣 NUR wenn noch keine Antwort raus ist (`headers_sent()`), sonst haengt der Melder seinen
 * JSON-Rumpf hinter eine bereits gesendete, gueltige Antwort und macht aus einem Erfolg Schrott.
 * ⚠️ Der volle Dateipfad bleibt draussen -- er verraet die Serverstruktur. Datei*name* und
 * Zeile reichen, um die Stelle zu finden.
 */
function avesmapsRegisterFatalReporter(string $context = ''): void {
    register_shutdown_function(static function () use ($context): void {
        $letzter = error_get_last();
        if ($letzter === null) {
            return;
        }

        $harteTypen = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
        if (!in_array($letzter['type'] ?? 0, $harteTypen, true)) {
            return;
        }

        if (headers_sent()) {
            return;
        }

        avesmapsErrorResponse(500, 'server_fatal', avesmapsFatalMessage($letzter, $context));
    });
}

/**
 * REIN: aus error_get_last() den Satz bauen, den ein Editor liest.
 *
 * ⚠️ Gedeckelt und ohne Pfad: die Meldung landet in einem Toast, und der volle Pfad gehoert
 * nicht in eine Antwort an den Browser.
 */
function avesmapsFatalMessage(array $letzterFehler, string $context = '', string $einleitung = 'Der Server hat abgebrochen'): string {
    $text = trim((string) ($letzterFehler['message'] ?? ''));

    // ⚠️ PHPs eigene Fehlertexte tragen VOLLE Pfade und einen mehrzeiligen Stapel mit. Beides
    // gehoert nicht in eine Antwort an den Browser: der Pfad verraet die Serverstruktur, und der
    // Stapel sprengt jeden Toast. Vom Pfad bleibt der Dateiname -- damit findet man die Stelle.
    $text = (string) preg_replace('#\S*[\\/]([A-Za-z0-9._-]+\.php)#', '$1', $text);
    $text = trim((string) preg_replace('#\s*\R\s*#', ' · ', $text));
    if ($text === '') {
        $text = 'Grund unbekannt';
    }
    // 💣 KEIN mb_* OHNE RUECKFALL. Dieser Code laeuft, NACHDEM der Prozess schon abgestuerzt ist --
    // faellt er selbst um (fehlende Erweiterung, erschoepfter Speicher), meldet der Melder gar
    // nichts und der Abbruch ist wieder unsichtbar. Genau das ist beim ersten Bau passiert und
    // stand nur deshalb fest, weil der Ablauftest einen echten Prozess abstuerzen laesst.
    $zuLang = function_exists('mb_strlen') ? mb_strlen($text) > 200 : strlen($text) > 200;
    if ($zuLang) {
        $text = function_exists('mb_substr') ? mb_substr($text, 0, 199) . '…' : substr($text, 0, 199) . '...';
    }

    $datei = basename((string) ($letzterFehler['file'] ?? ''));
    $zeile = (int) ($letzterFehler['line'] ?? 0);
    $ort = $datei !== '' ? $datei . ($zeile > 0 ? ':' . $zeile : '') : '';

    $teile = array_values(array_filter([$context, $text, $ort], static fn(string $t): bool => $t !== ''));

    return $einleitung . ' (' . implode(' · ', $teile) . ').';
}

/**
 * REIN: aus einer gefangenen Ausnahme denselben Satz bauen wie aus einem Abbruch.
 */
function avesmapsThrowableMessage(Throwable $error, string $context = ''): string {
    return avesmapsFatalMessage([
        'message' => $error::class . ': ' . $error->getMessage(),
        'file' => $error->getFile(),
        'line' => $error->getLine(),
    ], $context, 'Der Server ist gescheitert');
}

/**
 * 🔴 `$grundZeigen` ist AUSDRUECKLICH, nicht Vorgabe. „Internal server error." ist fuer einen
 * oeffentlichen Endpunkt die richtige Antwort -- ein Ausnahmetext verraet Tabellennamen, Pfade
 * und Bibliotheksversionen (AGENTS.md §10 fuehrt genau das als offenen Punkt).
 *
 * ⚠️ Fuer einen fähigkeitsgeschuetzten EDITOR-Endpunkt ist die Abwaegung umgekehrt: dort sitzt
 * ein angemeldeter Mitarbeiter, der den Fehler melden soll, und ein nichtssagendes „Internal
 * server error." macht seine Meldung wertlos. Am 24.08.2026 hat genau dieser Satz zwei Anlaeufe
 * gekostet, weil das Serverprotokoll bei STRATO nicht lesbar ist.
 */
function avesmapsServerErrorResponse(Throwable $error, string $context = '', bool $grundZeigen = false): never {
    error_log('avesmaps' . ($context !== '' ? ' ' . $context : '') . ': ' . $error->getMessage());
    avesmapsErrorResponse(
        500,
        'server_error',
        $grundZeigen ? avesmapsThrowableMessage($error, $context) : 'Internal server error.'
    );
}

// Canonical BF-year formatter (single source of truth; M4 DRY). 9999 = open/never-dissolved
// sentinel -> "besteht"; negative -> "<n> v. BF"; otherwise "<n> BF" (0 BF is a real year).
function avesmapsFormatBfYear(int $year): string {
    if ($year >= 9999) {
        return 'besteht';
    }
    return $year < 0 ? (abs($year) . ' v. BF') : ($year . ' BF');
}
