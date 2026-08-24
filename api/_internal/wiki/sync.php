<?php

declare(strict_types=1);

require_once __DIR__ . '/../text/ascii-fold.php';

const AVESMAPS_WIKI_API_URL = 'https://de.wiki-aventurica.de/de/api.php';
const AVESMAPS_WIKI_PAGE_BASE_URL = 'https://de.wiki-aventurica.de/wiki/';
/**
 * 🔴 DER USER-AGENT IST UNSERE KENNUNG BEIM WIKI, NICHT KOSMETIK.
 *
 * Der Betreiber kann eine Ausnahme von den Spamfallen-Regeln auf htaccess-Ebene NUR ueber den
 * User-Agent eintragen (Discord, 23.08.2026) -- eine Zeichenkette, die wie ein Standardbrowser
 * aussieht oder sich mit der eines anderen Projekts ueberschneidet, ist dort wertlos. Deshalb:
 * eigener Name, Version, und die Adresse, unter der man uns findet. Dieselbe Bauform traegt
 * schon `AvesmapsDumpBot/1.0` (dump-fetch.php) -- der gemeinsame Teil ist „Avesmaps", damit EINE
 * htaccess-Regel beide erwischt.
 */
const AVESMAPS_WIKI_USER_AGENT = 'AvesmapsWikiSync/2.0 (+https://avesmaps.de; info@avesmaps.de)';
/**
 * Titel je `action=query`-Anfrage. ZWEI Werte, und welcher gilt, entscheidet die ANMELDUNG:
 * 50 ist die Grenze fuer normale Nutzer, 500 die fuer `apihighlimits` -- ein Recht, das in der
 * Bot-Gruppe steckt und das Wiki Aventurica unserem Konto `Avesmaps` am 23.08.2026 gegeben hat.
 *
 * 💣 NIE DIE KONSTANTE DIREKT NEHMEN, IMMER `avesmapsWikiSyncTitleBatchSize()`. Wer 500 Titel
 * anonym schickt, bekommt `toomanyvalues` -- und das liefert MediaWiki als HTTP 200 mit einem
 * `error`-Objekt, also als „nichts gefunden" statt als Fehler. Die Konstante bleibt stehen, weil
 * sie der ANONYME Wert ist und die Bestandstests sie genau so lesen.
 */
const AVESMAPS_WIKI_TITLE_BATCH_SIZE = 50;
const AVESMAPS_WIKI_TITLE_BATCH_SIZE_BOT = 500;
const AVESMAPS_WIKI_SEARCH_RESULT_LIMIT = 5;
const AVESMAPS_WIKI_REQUEST_TIMEOUT_SECONDS = 30;
/**
 * ZWANZIG SEKUNDEN, UND DIE ZAHL IST NICHT UNSERE, SONDERN IHRE. Das Wiki Aventurica hat uns am
 * 24.08.2026 einen EIGENEN Abschnitt in seiner robots.txt gegeben:
 *
 *     User-agent: AvesmapsWikiSync
 *     Crawl-delay: 20
 *
 * Das ist keine Empfehlung mehr (die Bot-Richtlinie nennt 2 s), sondern die Regel, unter der uns
 * derselbe Abschnitt `/de/api.php` ueberhaupt erst erlaubt -- fuer `User-agent: *` bleibt die API
 * verboten. Wir waren bis dahin auf 0,6 s.
 *
 * DESHALB DARF DER USER-AGENT NICHT MEHR UMBENANNT WERDEN. Genau diese Zeichenkette steht in
 * ihrer robots.txt; eine neue Version im Namen wuerfe uns zurueck unter `*`, und dort ist die API
 * gesperrt. Der Name ist ab hier eine Schnittstelle, kein Etikett.
 *
 * UND DAMIT IST DIE BOT-ANMELDUNG TRAGEND, NICHT MEHR NUR NUETZLICH: gerechnet an der
 * Kontinent-Phase (rund 9000 Titel) sind es als Bot 18 Aufrufe = gut 6 Minuten, anonym 180
 * Aufrufe = ueber eine STUNDE. Wer den Login abschaltet, macht den Dump-Lauf unbenutzbar.
 */
const AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS = 20000000;
const AVESMAPS_WIKI_REQUEST_RETRY_COUNT = 3;
// Der Wiederholungsabstand bleibt das Doppelte der Drossel -- ein Server, der gerade 429 oder
// 503 gesagt hat, will mehr Ruhe, nicht dieselbe.
const AVESMAPS_WIKI_REQUEST_RETRY_BASE_DELAY_MICROSECONDS = 40000000;
const AVESMAPS_WIKI_LOCK_TTL_SECONDS = 120;
// 🔴 OWNER-WORTLAUT (20.08.2026). Das ist Produktsprache, keine Fehlermeldung fuer
// Entwickler -- wer ihn aendert, aendert, was tausende Editoren lesen. Der Grund steht in der
// Klammer dahinter (avesmapsWikiSyncUnreachableMessage), damit ein Fehlerbericht trotzdem
// brauchbar bleibt.
const AVESMAPS_WIKI_UNREACHABLE_MESSAGE = 'Wiki Aventurica ist nicht erreichbar. Bitte später noch einmal versuchen.';

function avesmapsWikiSyncDecodeJson(mixed $value): array {
    if ($value === null || $value === '') {
        return [];
    }

    if (is_array($value)) {
        return $value;
    }

    try {
        $decodedValue = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return [];
    }

    return is_array($decodedValue) ? $decodedValue : [];
}

function avesmapsWikiSyncEncodeJson(mixed $value): string {
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function avesmapsWikiSyncReadBoolean(mixed $value): bool {
    return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
}

function avesmapsWikiSyncReadPublicId(mixed $value): string {
    $publicId = avesmapsNormalizeSingleLine((string) $value, 36);
    if (preg_match('/^[a-f0-9-]{36}$/i', $publicId) !== 1) {
        throw new InvalidArgumentException('Die WikiSync-ID ist ungueltig.');
    }

    return strtolower($publicId);
}

function avesmapsWikiSyncUuidV4(): string {
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = unpack('H*', $bytes);
    if (!is_array($hex) || !isset($hex[1])) {
        throw new RuntimeException('Die UUID konnte nicht erzeugt werden.');
    }

    return sprintf(
        '%s-%s-%s-%s-%s',
        substr($hex[1], 0, 8),
        substr($hex[1], 8, 4),
        substr($hex[1], 12, 4),
        substr($hex[1], 16, 4),
        substr($hex[1], 20)
    );
}

function avesmapsWikiSyncRelaxLimits(): void {
    if (function_exists('set_time_limit')) {
        @set_time_limit(300);
    }

    if (function_exists('ini_set')) {
        @ini_set('memory_limit', '512M');
    }
}

function avesmapsWikiSyncLogServerError(string $label, array $context): void {
    $payload = [
        'label' => $label,
        'context' => $context,
    ];

    try {
        error_log('Avesmaps WikiSync error: ' . avesmapsWikiSyncEncodeJson($payload));
    } catch (Throwable) {
        error_log('Avesmaps WikiSync error: ' . $label);
    }
}

function avesmapsWikiSyncPageUrl(string $title): string {
    return AVESMAPS_WIKI_PAGE_BASE_URL . str_replace('%2F', '/', rawurlencode(str_replace(' ', '_', $title)));
}

/**
 * 🔴 „DAS WIKI ANTWORTET NICHT" IST EIN EIGENER FALL -- weder ein Serverfehler von uns noch
 * ein Eingabefehler des Editors. Genau deshalb ein eigener Typ: die Endpunkte koennen ihn gezielt
 * fangen und mit 503/`wiki_unreachable` beantworten, statt ihn in „Internal server error." zu
 * verwandeln (Discord #84, 20.08.2026).
 *
 * 💣 ER ERBT VON RuntimeException und muss deshalb in jeder Fangkette VOR dem
 * RuntimeException-Zweig stehen -- sonst schluckt jener ihn und der Zweig ist tot, ohne dass es
 * auffaellt. Dieselbe Falle wie bei PDOException (siehe api/edit/wiki/paths.php).
 */
class AvesmapsWikiUnreachableException extends RuntimeException {}

/**
 * REIN: baut den Satz, den ein Editor im Toast liest.
 *
 * 🔴 ZWEI TEILE, BEIDE GEWOLLT (Owner 20.08.2026): der Satz fuer den Menschen, dahinter in
 * Klammern eine deutsche Kurzfassung UND die genaue Technikmeldung. Die Kurzfassung sagt ihm, ob er
 * warten oder jemanden rufen muss; die Technikmeldung macht seinen Fehlerbericht brauchbar.
 *
 * 💣 DIE URL FLIEGT RAUS. PHPs Stream-Warnung lautet
 * „file_get_contents(<die ganze URL>): Failed to open stream: Connection refused" -- am 20.08.2026
 * waren 164 der 212 Zeichen der Meldung diese URL, und der eigentliche Grund stand gar nicht drin.
 * Sie geht nicht verloren: `avesmapsWikiSyncLogServerError` schreibt sie weiter ins Fehlerprotokoll.
 *
 * ⚠️ Gedeckelt, weil die Meldung in einen Toast passen muss -- ein Rohtext kann beliebig lang sein.
 */
function avesmapsWikiSyncUnreachableMessage(int $statusCode, string $rawWarning): string {
    // Alles bis zum ersten „): " ist der Funktionsaufruf samt URL -- weg damit. `[^)]*` reicht,
    // weil http_build_query jede Klammer prozentkodiert (aus „(Siedlung)" wird „%28Siedlung%29").
    $technik = trim((string) preg_replace('/^\w+\([^)]*\):\s*/', '', trim($rawWarning)));
    if ($technik === '' && $statusCode > 0) {
        $technik = 'HTTP-Status ' . $statusCode;
    }
    if ($technik === '') {
        $technik = 'Grund unbekannt';
    }
    if (mb_strlen($technik) > 160) {
        $technik = mb_substr($technik, 0, 159) . '…';
    }

    $niedrig = mb_strtolower($technik);
    $kurz = match (true) {
        str_contains($niedrig, 'refused') => 'Verbindung abgewiesen',
        str_contains($niedrig, 'timed out'), str_contains($niedrig, 'timeout') => 'Zeitüberschreitung',
        str_contains($niedrig, 'getaddrinfo'),
        str_contains($niedrig, 'name or service not known'),
        str_contains($niedrig, 'could not resolve') => 'Name nicht auflösbar',
        str_contains($niedrig, 'ssl'),
        str_contains($niedrig, 'certificate'),
        str_contains($niedrig, 'crypto') => 'Verschlüsselung gescheitert',
        $statusCode === 429 => 'Zu viele Anfragen',
        $statusCode >= 500 => 'Wiki vorübergehend nicht verfügbar',
        $statusCode > 0 => 'Unerwartete Antwort',
        default => 'Verbindung gescheitert',
    };

    return AVESMAPS_WIKI_UNREACHABLE_MESSAGE . ' (' . $kurz . ' · ' . $technik . ')';
}

// ===========================================================================
// DER BOT-ZUGANG (Wiki-Konto `Avesmaps`, Bot-Recht seit 23.08.2026)
// ===========================================================================

/**
 * Zustand der Bot-Anmeldung in DIESEM PHP-Prozess.
 *
 * 🔴 VIER Zustaende, und „unversucht" ist einer davon: ohne ihn waere „noch nicht angemeldet"
 * von „Anmeldung gescheitert" nicht zu unterscheiden, und wir versuchten den Login bei jeder
 * einzelnen Stapelabfrage erneut.
 *   unversucht  -- es gab noch keinen Anlass
 *   bot         -- angemeldet, `apihighlimits` gilt, 500 Titel je Anfrage
 *   anonym      -- keine Zugangsdaten hinterlegt; alles laeuft wie vor dem 23.08.2026
 *   gescheitert -- Zugangsdaten da, Anmeldung abgelehnt (Grund im Fehlerprotokoll und hier)
 *
 * ⚠️ PROZESSweit, nicht sitzungsweit: auf STRATO ist jede HTTP-Anfrage ein eigener Prozess. Wir
 * melden uns hoechstens einmal je Anfrage an -- und nur, wenn jemand einen grossen Stapel will
 * (siehe avesmapsWikiSyncTitleBatchSize).
 *
 * Ein Test setzt den Zustand einfach vor: avesmapsWikiBotZustand(['status' => 'bot']).
 */
function avesmapsWikiBotZustand(?array $neuerZustand = null): array {
    static $zustand = ['status' => 'unversucht', 'grund' => '', 'cookies' => []];

    if ($neuerZustand !== null) {
        $zustand = $neuerZustand + ['status' => 'unversucht', 'grund' => '', 'cookies' => []];
    }

    return $zustand;
}

/**
 * REIN: die Zugangsdaten aus der geladenen Konfiguration.
 *
 * 💣 EIN HALBER ZUGANG IST KEINER. Steht nur der Benutzername da, waere der Login ein garantiert
 * fehlschlagender Fremdaufruf -- also gar nicht erst versuchen, sondern sauber anonym bleiben.
 */
function avesmapsWikiBotZugangAusKonfiguration(array $config): ?array {
    $wiki = is_array($config['wiki'] ?? null) ? $config['wiki'] : [];
    $benutzer = trim((string) ($wiki['bot_username'] ?? ''));
    $passwort = (string) ($wiki['bot_password'] ?? '');

    if ($benutzer === '' || trim($passwort) === '') {
        return null;
    }

    return ['username' => $benutzer, 'password' => $passwort];
}

/**
 * REIN: die Stapelgroesse folgt dem ZUSTAND, nicht der Hoffnung.
 */
function avesmapsWikiTitleBatchSizeFuerZustand(string $status): int {
    return $status === 'bot' ? AVESMAPS_WIKI_TITLE_BATCH_SIZE_BOT : AVESMAPS_WIKI_TITLE_BATCH_SIZE;
}

/**
 * REIN: `Set-Cookie`-Kopfzeilen einer Antwort in den Cookie-Bestand einruehren.
 *
 * ⚠️ Nur das erste Paar je Zeile ist der Cookie; alles hinter dem ersten Semikolon sind Attribute
 * (Path, HttpOnly, Expires) und gehen uns nichts an. Ein leerer Wert oder „deleted" ist die Art,
 * einen Cookie zurueckzunehmen -- der fliegt dann raus, statt leer stehen zu bleiben.
 */
function avesmapsWikiCookiesAusKopfzeilen(array $kopfzeilen, array $bestand = []): array {
    foreach ($kopfzeilen as $zeile) {
        $zeile = (string) $zeile;
        if (stripos($zeile, 'Set-Cookie:') !== 0) {
            continue;
        }

        $paar = trim(explode(';', trim(substr($zeile, 11)))[0] ?? '');
        if ($paar === '' || !str_contains($paar, '=')) {
            continue;
        }

        [$name, $wert] = explode('=', $paar, 2);
        $name = trim($name);
        if ($name === '') {
            continue;
        }

        if ($wert === '' || strtolower($wert) === 'deleted') {
            unset($bestand[$name]);
            continue;
        }

        $bestand[$name] = $wert;
    }

    return $bestand;
}

/**
 * REIN: Cookie-Bestand -> Kopfzeilenwert. Leerer Bestand = leere Zeichenkette = keine Kopfzeile.
 */
function avesmapsWikiCookieKopfzeile(array $cookies): string {
    $teile = [];
    foreach ($cookies as $name => $wert) {
        $teile[] = $name . '=' . $wert;
    }

    return implode('; ', $teile);
}

/**
 * REIN: die Kopfzeilen einer GET-Anfrage. Der Cookie kommt nur mit, wenn es einen gibt.
 */
function avesmapsWikiSyncRequestHeaderLines(array $cookies): string {
    $zeilen = "User-Agent: " . AVESMAPS_WIKI_USER_AGENT . "\r\nAccept: application/json\r\n";

    $cookieZeile = avesmapsWikiCookieKopfzeile($cookies);
    if ($cookieZeile !== '') {
        $zeilen .= "Cookie: " . $cookieZeile . "\r\n";
    }

    return $zeilen;
}

/**
 * REIN: die Antwort von `action=login` lesen.
 *
 * 💣 MEDIAWIKI ANTWORTET AUCH BEI ABGELEHNTER ANMELDUNG MIT HTTP 200 -- der Befund steht
 * ausschliesslich im Rumpf. Wer nur den Status prueft, haelt jeden Fehlschlag fuer einen Erfolg.
 * ⚠️ `login.reason` ist unter formatversion=2 ein Objekt {code, text}, kein Text.
 */
function avesmapsWikiLoginErgebnis(array $antwort): array {
    $login = is_array($antwort['login'] ?? null) ? $antwort['login'] : [];

    if ((string) ($login['result'] ?? '') === 'Success') {
        return ['ok' => true, 'grund' => ''];
    }

    $grund = $login['reason'] ?? '';
    if (is_array($grund)) {
        $grund = (string) ($grund['text'] ?? ($grund['code'] ?? ''));
    }
    $grund = trim((string) $grund);

    if ($grund === '' && is_array($antwort['error'] ?? null)) {
        $grund = trim((string) ($antwort['error']['code'] ?? ''));
    }
    if ($grund === '') {
        $grund = trim((string) ($login['result'] ?? ''));
    }

    return ['ok' => false, 'grund' => $grund !== '' ? $grund : 'Grund unbekannt'];
}

/**
 * Eine POST-Anfrage an die Wiki-API, mit Cookies hin und zurueck.
 *
 * 🔴 NUR FUER DIE ANMELDUNG. MediaWiki nimmt `action=login` ausschliesslich per POST an; der
 * gesamte uebrige Verkehr bleibt bei GET, damit sich am eingespielten Weg nichts aendert.
 * 💣 DAS PASSWORT STEHT IM RUMPF, NICHT IN DER ADRESSE -- und der Rumpf wird nirgends
 * protokolliert. Genau deshalb POST und nicht GET: `avesmapsWikiSyncLogServerError` schreibt die
 * URL mit ins Fehlerprotokoll, und dorthin gehoert kein Passwort.
 *
 * @return array{data: array, cookies: array, status: int}
 */
function avesmapsWikiSyncApiPost(array $params, array $cookies): array {
    $rumpf = http_build_query(['format' => 'json', 'formatversion' => '2'] + $params, '', '&', PHP_QUERY_RFC1738);

    $kopfzeilen = avesmapsWikiSyncRequestHeaderLines($cookies)
        . "Content-Type: application/x-www-form-urlencoded\r\n";

    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'timeout' => AVESMAPS_WIKI_REQUEST_TIMEOUT_SECONDS,
            'header' => $kopfzeilen,
            'content' => $rumpf,
            'ignore_errors' => true,
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);

    avesmapsWikiSyncThrottleWikiRequest();

    $http_response_header = null;
    $rohantwort = @file_get_contents(AVESMAPS_WIKI_API_URL, false, $context);
    $kopf = $http_response_header ?? [];
    $status = $rohantwort === false ? 0 : avesmapsWikiSyncReadHttpStatusCode($kopf);

    $daten = [];
    if (is_string($rohantwort) && $rohantwort !== '') {
        try {
            $entschluesselt = json_decode($rohantwort, true, 512, JSON_THROW_ON_ERROR);
            $daten = is_array($entschluesselt) ? $entschluesselt : [];
        } catch (JsonException) {
            $daten = [];
        }
    }

    return [
        'data' => $daten,
        'cookies' => avesmapsWikiCookiesAusKopfzeilen($kopf, $cookies),
        'status' => $status,
    ];
}

/**
 * REIN genug fuer die Anzeige: was das Panel ueber den Bot-Zugang erfahren darf.
 *
 * 🔴 HIER KOMMT NIE EIN BENUTZERNAME UND NIE EIN PASSWORT HERAUS. `hinterlegt` beantwortet die
 * Frage, die ein Editor wirklich hat („ist der Eintrag in der config.local.php angekommen und
 * wohlgeformt?"), und `status`/`grund` sagen, was die letzte Anmeldung IN DIESEM PROZESS ergeben
 * hat. Beides zusammen unterscheidet die drei Faelle, die sonst gleich aussehen: nichts
 * eingetragen · eingetragen und abgelehnt · eingetragen und in Ordnung.
 *
 * ⚠️ `status` ist bei einer blossen Statusabfrage fast immer „unversucht" -- dort hat niemand
 * einen grossen Stapel angefordert, also gab es keinen Anlass zur Anmeldung. Das ist kein Mangel:
 * die Anzeige soll den Login gerade NICHT ausloesen, sonst kostete jedes Oeffnen des Panels zwei
 * Anfragen beim Wiki. Die belastbare Auskunft kommt mit dem Lauf, der ihn wirklich braucht.
 */
function avesmapsWikiBotStatusShape(): array {
    $zustand = avesmapsWikiBotZustand();
    $hinterlegt = avesmapsWikiBotZugangLesen() !== null;
    $status = (string) ($zustand['status'] ?? 'unversucht');
    $grund = (string) ($zustand['grund'] ?? '');

    return ['hinterlegt' => $hinterlegt, 'status' => $status, 'grund' => $grund]
        + avesmapsWikiBotZugangSatz($hinterlegt, $status, $grund);
}

/**
 * REIN: der Satz, den ein Editor liest -- und getrennt davon der, der ihn STOEREN muss.
 *
 * 🔴 Der Satz entsteht auf dem SERVER, nicht im Browser. Der Panel-Code liegt in einer Datei, die
 * sechs Dokumente einbinden und die kein Testfeld laden kann; hier steht er beim Zustand und wird
 * mitgeprueft. Der Client zeigt ihn nur an.
 *
 * 💣 Das Feld "fehler" ist NUR bei einer abgelehnten Anmeldung gefuellt. "nicht hinterlegt" ist
 * kein Fehler -- das ist der Zustand jeder Installation ohne Bot-Konto, und eine rote Zeile dafuer
 * waere Rauschen, das nach dem dritten Mal niemand mehr liest.
 */
function avesmapsWikiBotZugangSatz(bool $hinterlegt, string $status, string $grund): array {
    if ($status === 'bot') {
        return ['text' => 'Bot-Zugang: angemeldet — 500 Titel je Anfrage.', 'fehler' => ''];
    }

    if ($status === 'gescheitert') {
        $satz = 'Bot-Zugang abgelehnt' . ($grund !== '' ? ' (' . $grund . ')' : '')
            . ' — es laufen weiter 50 Titel je Anfrage.';

        return ['text' => $satz, 'fehler' => $satz];
    }

    if (!$hinterlegt) {
        return ['text' => 'Bot-Zugang: nicht hinterlegt — 50 Titel je Anfrage.', 'fehler' => ''];
    }

    // ⚠️ "hinterlegt" heisst NICHT "geprueft": die Statusabfrage meldet sich absichtlich nicht an.
    // Der Satz sagt das, statt eine Gewissheit zu behaupten, die er nicht hat.
    return ['text' => 'Bot-Zugang: hinterlegt, wird beim nächsten Lauf geprüft.', 'fehler' => ''];
}

/**
 * Die Zugangsdaten aus der Konfiguration -- ohne jeden Fremdaufruf.
 *
 * ⭐ Getrennt von der Anmeldung, damit die Anzeige „ist etwas hinterlegt?" beantworten kann, ohne
 * sich anzumelden. Genau diese Trennung macht die Statusabfrage verkehrsfrei.
 */
function avesmapsWikiBotZugangLesen(): ?array {
    if (!function_exists('avesmapsLoadApiConfig') || !function_exists('avesmapsApiRoot')) {
        return null;
    }

    try {
        return avesmapsWikiBotZugangAusKonfiguration(avesmapsLoadApiConfig(avesmapsApiRoot()));
    } catch (Throwable) {
        // Keine ladbare Konfiguration -- auf dem Entwicklungsrechner und im Testfeld der
        // Normalfall, und ausdruecklich KEIN Fehler.
        return null;
    }
}
/**
 * Meldet den Bot an -- hoechstens einmal je PHP-Prozess. Gibt zurueck, ob eine Bot-Sitzung steht.
 *
 * 🔴 EIN FEHLSCHLAG BRICHT NICHTS AB. Ohne Anmeldung laeuft alles weiter wie vor dem 23.08.2026,
 * nur mit 50 statt 500 Titeln je Anfrage. Ein harter Abbruch waere die schlechtere Wahl: er legte
 * jeden Sync lahm, sobald das Wiki den Login einmal anders beantwortet.
 * ⚠️ Aber er ist LAUT: der Grund geht ins Fehlerprotokoll und bleibt im Zustand abrufbar. Eine
 * stille Rueckstufung auf 50 waere von „das Recht wirkt" nicht zu unterscheiden -- und genau
 * diese Ununterscheidbarkeit ist die Fehlerklasse, die uns schon zweimal Tage gekostet hat.
 */
function avesmapsWikiBotSitzungSicherstellen(): bool {
    $zustand = avesmapsWikiBotZustand();
    if ((string) ($zustand['status'] ?? '') !== 'unversucht') {
        return (string) ($zustand['status'] ?? '') === 'bot';
    }

    // 💣 EIN Leser fuer beide Wege. Eine zweite Fassung liefe beim ersten geaenderten
    // Feldnamen auseinander, und dann sagte die Anzeige „hinterlegt", waehrend die Anmeldung
    // nichts findet -- die schlimmste aller Auskuenfte.
    $zugang = avesmapsWikiBotZugangLesen();

    if ($zugang === null) {
        avesmapsWikiBotZustand(['status' => 'anonym', 'grund' => 'keine Zugangsdaten hinterlegt']);
        return false;
    }

    $tokenAntwort = avesmapsWikiSyncApiPost(['action' => 'query', 'meta' => 'tokens', 'type' => 'login'], []);
    $loginToken = (string) ($tokenAntwort['data']['query']['tokens']['logintoken'] ?? '');
    if ($loginToken === '') {
        avesmapsWikiSyncLogServerError('wiki_bot_login_no_token', ['status_code' => $tokenAntwort['status']]);
        avesmapsWikiBotZustand(['status' => 'gescheitert', 'grund' => 'kein Login-Token']);
        return false;
    }

    $loginAntwort = avesmapsWikiSyncApiPost([
        'action' => 'login',
        'lgname' => $zugang['username'],
        'lgpassword' => $zugang['password'],
        'lgtoken' => $loginToken,
    ], $tokenAntwort['cookies']);

    $ergebnis = avesmapsWikiLoginErgebnis($loginAntwort['data']);
    if (!$ergebnis['ok']) {
        // ⚠️ NUR der Grund. Nie der Benutzername, und niemals das Passwort.
        avesmapsWikiSyncLogServerError('wiki_bot_login_failed', [
            'reason' => $ergebnis['grund'],
            'status_code' => $loginAntwort['status'],
        ]);
        avesmapsWikiBotZustand(['status' => 'gescheitert', 'grund' => $ergebnis['grund']]);
        return false;
    }

    avesmapsWikiBotZustand(['status' => 'bot', 'grund' => '', 'cookies' => $loginAntwort['cookies']]);
    return true;
}

/**
 * Die Stapelgroesse fuer `titles=`-Abfragen -- und der EINZIGE Ausloeser der Anmeldung.
 *
 * ⭐ Den Login verursacht, wer von ihm profitiert. Eine einzelne Suche im Zuweisungsdialog bleibt
 * damit anonym und schnell (sie spart nichts und zahlte sonst zwei zusaetzliche Anfragen),
 * waehrend die Stapelphasen des Dump-Laufs sich anmelden und dafuer neun von zehn Anfragen sparen.
 */
function avesmapsWikiSyncTitleBatchSize(): int {
    avesmapsWikiBotSitzungSicherstellen();

    return avesmapsWikiTitleBatchSizeFuerZustand((string) (avesmapsWikiBotZustand()['status'] ?? ''));
}

/**
 * EINE Seite `list=categorymembers` -- der kleinste Baustein der Kategorie-Crawls.
 *
 * 💣 WARUM ES IHN GIBT: die Sammler, die ihn benutzen (avesmapsWikiSyncFetchCategoryMemberTitles
 * in locations.php, avesmapsWikiSettlementFetchSubcategories in settlements.php), laufen eine
 * Kategorie bis zum Ende durch und sind damit NICHT unterbrechbar. Seit die Wiki-robots.txt
 * AvesmapsWikiSync einen Crawl-delay von 20 Sekunden gibt (siehe
 * AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS oben), ist genau das der Unterschied zwischen
 * "laeuft" und "HTTP 502": eine Kategorie ueber drei Seiten kostet eine Minute, und der
 * Webserver gibt vorher auf -- ausserhalb von PHP, also ohne jede Fehlermeldung. Die
 * Dump-Phasen brauchen deshalb genau EINE Abfrage je Schritt, und das ist diese hier.
 *
 * 🔴 ER STEHT IN sync.php UND NICHT BEI EINEM DER ZWEI SAMMLER, weil ihn beide brauchen --
 * und settlements.php laedt locations.php NICHT (und umgekehrt). Was sie schon immer teilen,
 * ist diese Datei: beide rufen avesmapsWikiSyncApiRequest() darunter, ohne sie zu requiren.
 * Ein Baustein in einer der beiden Dateien waere fuer den jeweils anderen Aufrufer ein
 * "undefined function" -- und zwar erst zur Laufzeit, in genau dem Ladeweg, den kein Test faehrt.
 *
 * $extraParams traegt, was den Aufruf ausmacht, und gewinnt gegen die Grundwerte:
 * `cmnamespace => 0` fuer Artikel, `cmtype => 'subcat'` fuer Unterkategorien.
 *
 * ⚠️ Die Titel kommen ROH heraus, mitsamt `Kategorie:`-Praefix -- abstreifen kann nur, wer
 * weiss, ob er Artikel oder Unterkategorien geholt hat (avesmapsWikiSyncStripCategoryPrefix).
 *
 * @return array{titles: list<string>, continue: ?string} continue = das cmcontinue der
 *         naechsten Seite, oder null wenn die Kategorie zu Ende ist.
 */
function avesmapsWikiSyncFetchCategoryMemberPage(
    string $categoryName,
    ?string $continueToken = null,
    array $extraParams = []
): array {
    $params = array_merge([
        'action' => 'query',
        'list' => 'categorymembers',
        'cmtitle' => 'Kategorie:' . $categoryName,
        'cmlimit' => 500,
    ], $extraParams);

    if ($continueToken !== null && $continueToken !== '') {
        $params['cmcontinue'] = $continueToken;
    }

    $data = avesmapsWikiSyncApiRequest($params);

    $titles = [];
    $members = $data['query']['categorymembers'] ?? [];
    if (is_array($members)) {
        foreach ($members as $member) {
            $title = trim((string) ($member['title'] ?? ''));
            if ($title !== '') {
                $titles[] = $title;
            }
        }
    }

    $continue = isset($data['continue']['cmcontinue']) ? (string) $data['continue']['cmcontinue'] : '';

    return [
        'titles' => $titles,
        'continue' => $continue === '' ? null : $continue,
    ];
}

/**
 * Das `Kategorie:`/`Category:`-Praefix von einem Kategorietitel abstreifen. Steht neben dem
 * Seitenholer, weil beide Leser von Unterkategorien (avesmapsWikiSettlementFetchSubcategories
 * und die Bauwerksarten der Dump-Phase) es brauchen und es sonst zweimal danebenstuende.
 */
function avesmapsWikiSyncStripCategoryPrefix(string $title): string {
    return preg_replace('/^(Kategorie|Category):/u', '', $title) ?? $title;
}

function avesmapsWikiSyncApiRequest(array $params): array {
    $queryParams = [
        'format' => 'json',
        'formatversion' => '2',
    ] + $params;
    // 🔴 `assert=user` faehrt NUR mit stehender Bot-Sitzung mit: es laesst die Anfrage scheitern,
    // sobald die Anmeldung weg ist -- und genau das ist erwuenscht. Ohne den Riegel liefe ein
    // 500er-Stapel in `toomanyvalues`, und der kaeme als HTTP 200 mit leerer Trefferliste zurueck,
    // also als „im Wiki steht nichts". Anonym darf er nicht mit: dort gibt es keinen Benutzer.
    $botZustand = avesmapsWikiBotZustand();
    $istBot = (string) ($botZustand['status'] ?? '') === 'bot';
    if ($istBot) {
        $queryParams['assert'] = 'user';
    }

    $url = AVESMAPS_WIKI_API_URL . '?' . http_build_query($queryParams, '', '&', PHP_QUERY_RFC3986);

    $lastRawResponse = '';
    $lastStatusCode = 0;
    // 💣 Der GRUND des Verbindungsfehlers wurde bis zum 20.08.2026 weggeworfen: das `@` unten
    // unterdrueckt die Warnung, und niemand hat sie je gelesen. Uebrig blieb „HTTP-Status: 0",
    // und damit war von aussen nicht zu unterscheiden, ob wir gesperrt, ueberlastet oder
    // namenlos waren. `error_get_last()` liefert die Warnung auch bei unterdruecktem Fehler.
    $lastWarning = '';

    for ($attempt = 0; $attempt <= AVESMAPS_WIKI_REQUEST_RETRY_COUNT; $attempt++) {
        if ($attempt === 0) {
            avesmapsWikiSyncThrottleWikiRequest();
        } else {
            avesmapsWikiSyncBackoffWikiRequest($attempt);
        }

        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => AVESMAPS_WIKI_REQUEST_TIMEOUT_SECONDS,
                'header' => avesmapsWikiSyncRequestHeaderLines($istBot ? (array) ($botZustand['cookies'] ?? []) : []),
                'ignore_errors' => true,
            ],
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
            ],
        ]);

        $http_response_header = null;
        // ⚠️ Erst leeren: sonst liest `error_get_last()` eine fremde, aeltere Warnung und die
        // Meldung nennt einen Grund, der gar nicht zu diesem Versuch gehoert.
        error_clear_last();
        $rawResponse = @file_get_contents($url, false, $context);
        if ($rawResponse === false) {
            $lastWarning = (string) (error_get_last()['message'] ?? '');
        }
        $lastRawResponse = is_string($rawResponse) ? $rawResponse : '';
        // A connection-level failure (DNS/timeout/reset -- no response reaches
        // the wrapper at all) leaves $http_response_header unset, which
        // avesmapsWikiSyncReadHttpStatusCode() already reports as 0. The
        // explicit reset above (rather than trusting "unset") guards against a
        // PHP quirk: $http_response_header is NOT cleared by a failing
        // file_get_contents() call, so without the reset a connection failure
        // on attempt N>0 could silently inherit attempt N-1's real HTTP status
        // line instead of correctly reading as 0.
        $lastStatusCode = $rawResponse === false ? 0 : avesmapsWikiSyncReadHttpStatusCode($http_response_header ?? []);

        if (
            $lastStatusCode === 429
            || $lastStatusCode === 502
            || $lastStatusCode === 503
            || $lastStatusCode === 504
        ) {
            avesmapsWikiSyncLogServerError('wiki_api_temporary_http_error', [
                'url' => $url,
                'status_code' => $lastStatusCode,
                'attempt' => $attempt + 1,
            ]);
            continue;
        }

        if ($rawResponse === false) {
            // Transient connection-level failure (DNS/timeout/reset): no HTTP
            // response reached us at all. Retry it the same way as a 5xx --
            // this used to fall through to the generic empty-response branch
            // below and retry silently/unlogged; it now gets the same
            // explicit, logged treatment as the other temporary failures.
            avesmapsWikiSyncLogServerError('wiki_api_connection_failure', [
                'url' => $url,
                'attempt' => $attempt + 1,
                // Der Grund gehoert ins Protokoll, nicht nur in den Toast -- am 20.08.2026 stand
                // hier nur URL und Nummer, und die Diagnose kostete eine ganze Sitzung.
                'reason' => $lastWarning,
            ]);
            continue;
        }

        if (!is_string($rawResponse) || $rawResponse === '') {
            continue;
        }

        try {
            $data = json_decode($rawResponse, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            $responsePrefix = substr($rawResponse, 0, 500);

            avesmapsWikiSyncLogServerError('wiki_api_invalid_json', [
                'json_error' => $exception->getMessage(),
                'url' => $url,
                'status_code' => $lastStatusCode,
                'response_prefix' => $responsePrefix,
            ]);

            if ($lastStatusCode >= 500 && $attempt < AVESMAPS_WIKI_REQUEST_RETRY_COUNT) {
                continue;
            }

            // ⚠️ Auch das ist fuer den Editor „nicht erreichbar": es kam etwas zurueck, aber nichts
            // Brauchbares -- genau der Zweig, den eine Sperrseite nimmt. Die Klammer nennt den
            // Status, damit die Meldung nie in die Irre fuehrt. URL und Antwort stehen oben im
            // Protokoll (wiki_api_invalid_json).
            throw new AvesmapsWikiUnreachableException(
                avesmapsWikiSyncUnreachableMessage($lastStatusCode, '')
            );
        }

        if (!is_array($data)) {
            throw new AvesmapsWikiUnreachableException(
                avesmapsWikiSyncUnreachableMessage($lastStatusCode, '')
            );
        }

        // 💣 ZWEI FEHLER, DIE MEDIAWIKI MIT HTTP 200 AUSLIEFERT -- und die deshalb bis heute wie
        // „nichts gefunden" aussahen statt wie ein Fehler:
        //   assertuserfailed -- die Bot-Sitzung ist weg; jede weitere Antwort waere leer
        //   toomanyvalues    -- der Stapel war groesser, als das Recht erlaubt. Die Antwort ist
        //                       dann LEER, nicht etwa gekuerzt
        // Beide muessen laut sein: ein stiller leerer Treffer wandert sonst als „das gibt es im
        // Wiki nicht" in unsere Daten, und niemand kann es hinterher noch unterscheiden.
        $fehlercode = (string) ($data['error']['code'] ?? '');
        if ($fehlercode === 'assertuserfailed' || $fehlercode === 'toomanyvalues') {
            avesmapsWikiSyncLogServerError('wiki_api_' . $fehlercode, [
                'url' => $url,
                'bot_status' => (string) ($botZustand['status'] ?? ''),
            ]);

            throw new AvesmapsWikiUnreachableException(
                avesmapsWikiSyncUnreachableMessage($lastStatusCode, $fehlercode)
            );
        }

        return $data;
    }

    $responsePrefix = substr($lastRawResponse, 0, 500);
    // 💣 ALLES, was der Toast NICHT mehr traegt, gehoert hierher -- sonst tauschen wir eine
    // unlesbare Meldung gegen eine undiagnostizierbare. URL, Status und Antwortanfang bleiben.
    avesmapsWikiSyncLogServerError('wiki_api_unreachable', [
        'url' => $url,
        'status_code' => $lastStatusCode,
        'reason' => $lastWarning,
        'response_prefix' => $responsePrefix,
    ]);
    throw new AvesmapsWikiUnreachableException(
        avesmapsWikiSyncUnreachableMessage($lastStatusCode, $lastWarning)
    );
}

/**
 * 💣 GEDROSSELT WIRD DER ABSTAND ZWISCHEN ZWEI ANFRAGEN -- NICHT JEDE EINZELNE.
 *
 * Bis zum 24.08.2026 schlief diese Funktion bedingungslos vor JEDER Anfrage, auch vor der
 * ersten im Prozess. Bei 0,6 s fiel das niemandem auf; bei den 2 s, die die Bot-Richtlinie
 * empfiehlt, wartet der Editor im Zuweisungsdialog zwei Sekunden auf eine Suche, die aus einer
 * einzigen Anfrage besteht -- eine Wartezeit, die dem Wiki NICHTS erspart, weil es davor und
 * danach ohnehin still war.
 *
 * Also: merken, wann die letzte Anfrage lief, und nur die noch fehlende Zeit abwarten. Der
 * Abstand, den das Wiki sieht, ist derselbe; die Wartezeit, die ein Mensch sieht, faellt weg.
 * ⚠️ Der Merker gilt je PHP-Prozess -- auf STRATO ist das je Web-Anfrage. Fuer die
 * Stapelphasen, die die Masse ausmachen, ist das genau richtig: sie laufen der Reihe nach in
 * EINEM Prozess. Ein zweiter Editor, der gleichzeitig sucht, kommt daran vorbei; das sind
 * einzelne Anfragen von Menschen, keine Last.
 */
/**
 * Die Sperre fuer den Ablageort des Drossel-Vermerks -- gleiche Bauart wie uploads/db-backups
 * und uploads/svg-export. 🔴 DIESE KONSTANTE IST DIE QUELLE, es gibt keine Kopie im Repo:
 * `uploads/` steht nicht in der Deploy-Allowlist, die Sperre kaeme also nie von dort und heilt
 * sich zur Laufzeit.
 */
const AVESMAPS_WIKI_DROSSEL_HTACCESS = "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n\n"
    . "<IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n</IfModule>\n";

/**
 * Wo der Zeitpunkt der letzten Wiki-Anfrage vermerkt wird -- oder null, wenn es keinen
 * schreibbaren Ort gibt.
 *
 * 💣 WARUM EINE DATEI UND NICHT EINE VARIABLE: der Abstand muss ueber PROZESSGRENZEN gelten.
 * Jeder Schritt eines Dump-Laufs ist eine eigene HTTP-Anfrage und damit ein eigener
 * PHP-Prozess; eine statische Variable faengt in jedem davon bei null an. Solange eine Phase
 * ihre zwoelf Abfragen in EINEM Schritt machte, lagen elf Pausen dazwischen -- seit sie
 * unterbrechbar ist, waeren es null. Der Crawl-delay 20 aus der Wiki-robots.txt waere damit
 * faktisch abgeschafft, ohne dass irgendwo eine Zahl geaendert worden waere.
 *
 * 💣 WARUM KEINE DATENBANK: diese Datei muss sich ohne PDO laden und benutzen lassen (das
 * Testfeld tut genau das). Ein Zeitstempel, den nur bekommt, wer eine Datenbankverbindung
 * hat, waere in der Haelfte der Aufrufer nicht da.
 *
 * ⚠️ Kein schreibbarer Ort = null = Rueckfall auf das alte, prozesslokale Verhalten. Auf dem
 * Entwicklungsrechner ist das der Normalfall und ausdruecklich KEIN Fehler.
 */
function avesmapsWikiSyncDrosselVermerkDatei(): ?string {
    if (!function_exists('avesmapsApiRoot')) {
        return null;
    }

    try {
        $verzeichnis = dirname(avesmapsApiRoot()) . DIRECTORY_SEPARATOR . 'uploads'
            . DIRECTORY_SEPARATOR . 'wiki-drossel';
    } catch (Throwable) {
        return null;
    }

    if (!is_dir($verzeichnis) && !@mkdir($verzeichnis, 0775, true) && !is_dir($verzeichnis)) {
        // 🔴 HIER DARF ES NICHT STILL SEIN. Ohne Vermerk faellt die Drossel auf ihr
        // prozesslokales Verhalten zurueck -- und weil jeder Schritt ein eigener Prozess ist,
        // heisst das: gar kein Abstand mehr. Von aussen ist das von "laeuft richtig" nicht zu
        // unterscheiden, und der Preis waere die Sperre, aus der uns der Betreiber am
        // 24.08.2026 gerade erst herausgeholt hat.
        // ⚠️ Genau EINMAL je Prozess, und nur dort, wo es ueberhaupt ein uploads/ geben kann
        // (avesmapsApiRoot oben) -- auf dem Entwicklungsrechner ist der Rueckfall der Normalfall
        // und ausdruecklich kein Fehler.
        static $schonGemeldet = false;
        if (!$schonGemeldet) {
            $schonGemeldet = true;
            avesmapsWikiSyncLogServerError('wiki_drossel_ohne_vermerk', ['verzeichnis' => $verzeichnis]);
        }

        return null;
    }

    $sperre = $verzeichnis . DIRECTORY_SEPARATOR . '.htaccess';
    if (!is_file($sperre) || @file_get_contents($sperre) !== AVESMAPS_WIKI_DROSSEL_HTACCESS) {
        @file_put_contents($sperre, AVESMAPS_WIKI_DROSSEL_HTACCESS);
    }

    return $verzeichnis . DIRECTORY_SEPARATOR . 'letzte-anfrage';
}

/**
 * Den Abstand ueber die Prozessgrenze hinweg einhalten. Gibt zurueck, ob das gelungen ist --
 * false heisst "kein schreibbarer Vermerk", und der Aufrufer faellt auf sein prozesslokales
 * Verhalten zurueck.
 *
 * ⭐ Die Sperre wird WAEHREND des Wartens gehalten. Das ist Absicht: zwei gleichzeitige
 * Aufrufer sollen sich hintereinanderstellen, nicht beide gleichzeitig loswarten und dann
 * gemeinsam losfeuern.
 *
 * 💣 Ein Zeitstempel aus der ZUKUNFT (verstellte Uhr, von Hand angefasste Datei) wird auf den
 * vollen Abstand gedeckelt -- ohne den Deckel schliefe der naechste Aufruf stundenlang, und
 * das saehe von aussen aus wie ein haengender Server.
 */
function avesmapsWikiSyncDrosselUeberProzessgrenze(int $mindestabstand, ?string $vermerkDatei): bool {
    if ($vermerkDatei === null) {
        return false;
    }

    $griff = @fopen($vermerkDatei, 'c+');
    if ($griff === false) {
        return false;
    }

    if (!@flock($griff, LOCK_EX)) {
        @fclose($griff);
        return false;
    }

    try {
        $roh = trim((string) @stream_get_contents($griff));
        $letzte = is_numeric($roh) ? (float) $roh : 0.0;

        if ($letzte > 0.0) {
            $rest = $mindestabstand - (int) ((microtime(true) - $letzte) * 1000000);
            if ($rest > 0) {
                usleep((int) min($rest, $mindestabstand));
            }
        }

        @ftruncate($griff, 0);
        @rewind($griff);
        @fwrite($griff, sprintf('%.6F', microtime(true)));
        @fflush($griff);
    } finally {
        @flock($griff, LOCK_UN);
        @fclose($griff);
    }

    return true;
}

/**
 * Der Abstand zwischen zwei Wiki-Anfragen -- der Crawl-delay aus der Wiki-robots.txt.
 *
 * 🔴 ER GILT UEBER PROZESSGRENZEN, seit die Dump-Phasen unterbrechbar sind (24.08.2026). Vorher
 * zaehlte nur die statische Variable unten, und die faengt in jedem PHP-Prozess bei null an:
 * zwoelf Schritte waren zwoelf erste Anfragen und damit NULL Pausen. Aus "zu langsam"
 * (HTTP 502) war "zu schneller als erlaubt" geworden -- dieselbe Grenze, nur von der anderen
 * Seite gerissen.
 *
 * ⭐ GEMESSEN 24.08.2026: JEDER Aufrufer der Wiki-API im Haus sitzt in einer Crawl-Bibliothek
 * (locations/paths/regions/settlements/territories/sync-monitor/dump-category-layer). Es gibt
 * KEINEN interaktiven Einzelabruf ans lebende Wiki -- die Zuweisungsdialoge suchen in unseren
 * eigenen Tabellen. Deshalb gilt der dauerhafte Abstand hier ohne Ausnahme; die Unterscheidung
 * "Massenlauf gegen Einzelabruf" haette heute eine leere zweite Haelfte. ⚠️ Kommt je ein
 * interaktiver Abruf dazu, ist DAS die Stelle, an der er eine Ausnahme braeuchte -- und die
 * Entscheidung gehoert dem Owner, nicht dem Code: der Crawl-delay gilt unserem User-Agent,
 * nicht einzelnen Funktionen.
 *
 * Die zwei Parameter existieren NUR fuer den Test: ohne sie muesste der die vollen 20 Sekunden
 * schlafen und einen echten uploads/-Pfad haben -- ein Test, der 20 Sekunden kostet, wird als
 * erstes wieder herausgenommen. Die Produktion ruft ohne Argumente auf.
 */
function avesmapsWikiSyncThrottleWikiRequest(
    ?int $abstandMikrosekunden = null,
    ?string $vermerkDateiFuerTest = null
): void {
    static $letzteAnfrage = null;

    $jitter = random_int(0, 250000);
    $mindestabstand = ($abstandMikrosekunden ?? AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS) + $jitter;

    $vermerk = $vermerkDateiFuerTest ?? avesmapsWikiSyncDrosselVermerkDatei();
    if (avesmapsWikiSyncDrosselUeberProzessgrenze($mindestabstand, $vermerk)) {
        $letzteAnfrage = microtime(true);
        return;
    }

    // Rueckfall ohne schreibbaren Vermerk: das alte, prozesslokale Verhalten.
    if ($letzteAnfrage !== null) {
        $vergangen = (int) ((microtime(true) - $letzteAnfrage) * 1000000);
        $rest = $mindestabstand - $vergangen;
        if ($rest > 0) {
            usleep($rest);
        }
    }

    $letzteAnfrage = microtime(true);
}

function avesmapsWikiSyncBackoffWikiRequest(int $attempt): void {
    $multiplier = max(1, $attempt);
    $jitter = random_int(0, 500000);
    usleep((AVESMAPS_WIKI_REQUEST_RETRY_BASE_DELAY_MICROSECONDS * $multiplier) + $jitter);
}

function avesmapsWikiSyncReadHttpStatusCode(array $headers): int {
    foreach ($headers as $header) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})\b/i', (string) $header, $matches) === 1) {
            return (int) $matches[1];
        }
    }

    return 0;
}

function avesmapsWikiSyncCreateMatchKey(string $value): string {
    return avesmapsWikiSyncCreateMatchKeyInternal($value, false);
}

function avesmapsWikiSyncCreateMatchKeyPreservingParentheticalSuffix(string $value): string {
    return avesmapsWikiSyncCreateMatchKeyInternal($value, true);
}

function avesmapsWikiSyncCreateMatchKeyInternal(string $value, bool $preserveHistoricalSuffix): string {
    $value = $preserveHistoricalSuffix
        ? avesmapsWikiSyncStripParentheticalSuffixPreservingSuffix($value)
        : avesmapsWikiSyncStripParentheticalSuffix($value);
    $value = mb_strtolower($value);
    $value = str_replace(["\u{00DF}", "\u{00E6}", "\u{0153}", "\u{00F8}", "\u{00F0}", "\u{00FE}"], ['ss', 'ae', 'oe', 'o', 'd', 'th'], $value);
    // Deterministic table, NOT iconv//TRANSLIT (libc-dependent -- the match key
    // differed between the dev machine and STRATO). Umlauts fold to '?' and are
    // dropped by the final pass: 'Fürstentum Kosch' -> 'frstentumkosch'.
    $value = avesmapsFoldToAscii($value);
    $value = preg_replace('/[\s_\-\'\x{2019}\x{02BC}`\x{00B4}]+/u', '', $value) ?? '';
    $value = preg_replace('/[^a-z0-9]+/u', '', $value) ?? '';

    return $value;
}

function avesmapsWikiSyncStripParentheticalSuffix(string $title): string {
    return avesmapsWikiSyncStripParentheticalSuffixInternal($title, false);
}

function avesmapsWikiSyncStripParentheticalSuffixPreservingSuffix(string $title): string {
    return avesmapsWikiSyncStripParentheticalSuffixInternal($title, true);
}

function avesmapsWikiSyncStripParentheticalSuffixInternal(string $title, bool $preserveHistoricalSuffix): string {
    $normalizedTitle = trim($title);
    if ($normalizedTitle === '') {
        return '';
    }

    if ($preserveHistoricalSuffix && avesmapsWikiSyncHasTrailingParentheticalSuffix($normalizedTitle)) {
        return $normalizedTitle;
    }

    return trim(preg_replace('/\s+\([^)]*\)\s*$/u', '', $normalizedTitle) ?? $normalizedTitle);
}

function avesmapsWikiSyncHasTrailingParentheticalSuffix(string $value): bool {
    return preg_match('/\([^)]*\)\s*$/u', $value) === 1;
}

function avesmapsWikiSyncEnsureCoreTables(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_sync_runs (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            public_id CHAR(36) NOT NULL,
            sync_type VARCHAR(40) NOT NULL DEFAULT 'location',
            status VARCHAR(20) NOT NULL DEFAULT 'running',
            phase VARCHAR(60) NOT NULL DEFAULT 'settlement_titles',
            progress_current INT NOT NULL DEFAULT 0,
            progress_total INT NOT NULL DEFAULT 4,
            message VARCHAR(255) NULL,
            stats_json JSON NULL,
            created_by BIGINT UNSIGNED NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            completed_at DATETIME(3) NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_sync_runs_public_id (public_id),
            KEY idx_wiki_sync_runs_status_created (status, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_sync_pages (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            wiki_page_id BIGINT NULL,
            title VARCHAR(255) NOT NULL,
            normalized_key VARCHAR(255) NOT NULL,
            wiki_url VARCHAR(500) NOT NULL,
            settlement_class VARCHAR(60) NULL,
            settlement_label VARCHAR(120) NULL,
            categories_json JSON NULL,
            coordinates_json JSON NULL,
            content_hash CHAR(64) NULL,
            fetched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_sync_pages_title (title),
            KEY idx_wiki_sync_pages_normalized_key (normalized_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsWikiSyncFetchRunByPublicId(PDO $pdo, string $publicId): array {
    $statement = $pdo->prepare('SELECT * FROM wiki_sync_runs WHERE public_id = :public_id LIMIT 1');
    $statement->execute(['public_id' => $publicId]);
    $run = $statement->fetch();
    if (!$run) {
        throw new InvalidArgumentException('Der WikiSync-Lauf wurde nicht gefunden.');
    }

    return $run;
}

/**
 * Newest COMPLETED wiki_sync_runs row. With $syncType = null (default) this is
 * ACROSS ALL sync types -- the historical behaviour every existing caller relies
 * on. Pass a $syncType (e.g. AVESMAPS_WIKI_SYNC_TYPE_LOCATION) to scope the lookup
 * to one run type: the case-list path needs this because after "Dump holen" the
 * newest completed run is a dump_read run, but the settlement conflict cases are
 * keyed to a LOCATION run (avesmapsWikiDumpSettlementCaseRunId) -- an unscoped
 * lookup would resolve the dump_read run and the WHERE last_seen_run_id filter
 * would then match 0 cases. Only the case-list reader passes a type; do NOT change
 * the other (untyped) callers, whose semantics are "newest completed run of any
 * kind".
 *
 * @param string|null $syncType null = any type (unchanged); a value scopes to it.
 */
function avesmapsWikiSyncFetchLatestCompletedRun(PDO $pdo, ?string $syncType = null): ?array {
    if ($syncType === null) {
        $statement = $pdo->query(
            "SELECT *
            FROM wiki_sync_runs
            WHERE status = 'completed'
            ORDER BY completed_at DESC, id DESC
            LIMIT 1"
        );
        $run = $statement !== false ? $statement->fetch() : false;

        return $run ?: null;
    }

    $statement = $pdo->prepare(
        "SELECT *
        FROM wiki_sync_runs
        WHERE status = 'completed' AND sync_type = :sync_type
        ORDER BY completed_at DESC, id DESC
        LIMIT 1"
    );
    $statement->execute(['sync_type' => $syncType]);
    $run = $statement->fetch();

    return $run ?: null;
}

function avesmapsWikiSyncFetchLatestActiveRun(PDO $pdo, string $syncType = AVESMAPS_WIKI_SYNC_TYPE_LOCATION): ?array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM wiki_sync_runs
        WHERE sync_type = :sync_type
            AND status = :status
            AND updated_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ' . AVESMAPS_WIKI_LOCK_TTL_SECONDS . ' SECOND)
        ORDER BY updated_at DESC, id DESC
        LIMIT 1'
    );
    $statement->execute([
        'sync_type' => $syncType,
        'status' => 'running',
    ]);

    $run = $statement->fetch(PDO::FETCH_ASSOC);
    return is_array($run) ? $run : null;
}

function avesmapsWikiSyncPublicRun(array $run): array {
    $stats = avesmapsWikiSyncDecodeJson($run['stats_json'] ?? null);
    return [
        'id' => (string) $run['public_id'],
        'public_id' => (string) $run['public_id'],
        'status' => (string) $run['status'],
        'phase' => (string) $run['phase'],
        'progress_current' => (int) $run['progress_current'],
        'progress_total' => (int) $run['progress_total'],
        'message' => (string) ($run['message'] ?? ''),
        'created_at' => (string) $run['created_at'],
        'updated_at' => (string) $run['updated_at'],
        'completed_at' => (string) ($run['completed_at'] ?? ''),
        'stats' => [
            'settlement_title_count' => (int) ($stats['settlement_title_count'] ?? 0),
            'map_place_count' => (int) ($stats['map_place_count'] ?? 0),
            'matched_count' => (int) ($stats['matched_count'] ?? 0),
            'unresolved_count' => (int) ($stats['unresolved_count'] ?? 0),
            'missing_wiki_place_count' => (int) ($stats['missing_wiki_place_count'] ?? 0),
            'case_count' => (int) ($stats['case_count'] ?? 0),
            'political_territory_received' => (int) ($stats['political_territories']['received'] ?? 0),
            'political_territory_created' => (int) ($stats['political_territories']['territory_created'] ?? 0),
            'political_territory_updated' => (int) ($stats['political_territories']['wiki_updated'] ?? 0),
            'political_territory_geometry_seeded' => (int) ($stats['political_territories']['geometry_seeded'] ?? 0),
        ],
    ];
}

function avesmapsWikiSyncUpdateRun(PDO $pdo, int $runId, string $status, string $phase, int $progressCurrent, string $message, array $stats): void {
    $statement = $pdo->prepare(
        'UPDATE wiki_sync_runs
        SET status = :status,
            phase = :phase,
            progress_current = :progress_current,
            message = :message,
            stats_json = :stats_json
        WHERE id = :id'
    );
    $statement->execute([
        'id' => $runId,
        'status' => $status,
        'phase' => $phase,
        'progress_current' => $progressCurrent,
        'message' => $message,
        'stats_json' => avesmapsWikiSyncEncodeJson($stats),
    ]);
}

function avesmapsWikiSyncFetchCase(PDO $pdo, int $caseId): array {
    $statement = $pdo->prepare('SELECT * FROM wiki_sync_cases WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $caseId]);
    $case = $statement->fetch();
    if (!$case) {
        throw new InvalidArgumentException('Der WikiSync-Fall wurde nicht gefunden.');
    }

    return $case;
}

function avesmapsWikiSyncReadPositiveInt(mixed $value, string $fieldName): int {
    $parsedValue = filter_var($value, FILTER_VALIDATE_INT);
    if ($parsedValue === false || $parsedValue < 1) {
        throw new InvalidArgumentException("{$fieldName} ist ungueltig.");
    }

    return (int) $parsedValue;
}