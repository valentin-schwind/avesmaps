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
/**
 * 💣 DIE ZAHL DER WIEDERHOLUNGEN IST EINE ZEITGRENZE, KEINE HARTNAECKIGKEIT. Sie stand auf
 * 3, als die Drossel bei 0,6 s lag. Mit dem Crawl-delay 20 und der doppelten Basis darunter
 * ergab das eine Leiter von 40 + 80 + 120 = 240 Sekunden -- in EINEM Schritt, ohne
 * Heartbeat. Zusammen mit Drossel und einer abgelaufenen Bot-Anmeldung waren das 300
 * Sekunden, also genau die harte Grenze aus avesmapsWikiSyncRelaxLimits(). PHP haette den
 * Schritt abgebrochen -- und ein Abbruch gibt die Pipeline-Sperre NICHT frei (der
 * Freigabe-Zweig sitzt in einem catch, das ein Fatal ueberspringt).
 *
 * ⚠️ Zwei Wiederholungen sind drei Versuche ueber rund zwei Minuten, jeder ohnehin durch
 * die Drossel getrennt. Das ist reichlich fuer eine voruebergehende Stoerung; wer mehr
 * braucht, braucht nicht mehr Geduld, sondern einen zweiten Schritt -- und den gibt es
 * seit dem 24.08.2026, die Phasen sind fortsetzbar.
 *
 * 🔴 Gewacht von sperrfenster-deckt-schritt-test.php: dort wird aus DIESEN Konstanten
 * gerechnet, ob der laengste moegliche Schritt noch unter die harte Grenze passt und das
 * Sperrfenster darueber liegt. Wer die Leiter verlaengert, faellt dort auf.
 */
const AVESMAPS_WIKI_REQUEST_RETRY_COUNT = 2;
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
    static $zustand = ['status' => 'unversucht', 'grund' => '', 'grund_code' => '', 'cookies' => [], 'aus_ablage' => false];

    if ($neuerZustand !== null) {
        $zustand = $neuerZustand + ['status' => 'unversucht', 'grund' => '', 'grund_code' => '', 'cookies' => [], 'aus_ablage' => false];
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
 *
 * 💣 DER `code` REIST SEIT 25.08.2026 MIT, UND ER IST DIE EIGENTLICHE AUSKUNFT. Der TEXT ist
 * fuer mehrere Ursachen derselbe; die Ursachen stehen im Code auseinander:
 * `wrongpassword` (Botpasswort weg oder falsch) gegen `botpasswords-restriction-failed`
 * (IP-Bereich) gegen `nosuchuser` (Konto). Am lebenden Fall gemessen: ohne den Code nannten wir
 * dem Betreiber drei Ursachen, von denen die Antwort des Wikis zwei bereits ausgeschlossen hatte.
 */
function avesmapsWikiLoginErgebnis(array $antwort): array {
    $login = is_array($antwort['login'] ?? null) ? $antwort['login'] : [];

    if ((string) ($login['result'] ?? '') === 'Success') {
        return ['ok' => true, 'grund' => '', 'code' => ''];
    }

    $rohGrund = $login['reason'] ?? '';
    $code = '';
    if (is_array($rohGrund)) {
        $code = trim((string) ($rohGrund['code'] ?? ''));
        $grund = (string) ($rohGrund['text'] ?? ($rohGrund['code'] ?? ''));
    } else {
        $grund = (string) $rohGrund;
    }
    $grund = trim($grund);

    if (is_array($antwort['error'] ?? null)) {
        if ($code === '') {
            $code = trim((string) ($antwort['error']['code'] ?? ''));
        }
        if ($grund === '') {
            $grund = trim((string) ($antwort['error']['code'] ?? ''));
        }
    }
    if ($grund === '') {
        $grund = trim((string) ($login['result'] ?? ''));
    }

    return ['ok' => false, 'grund' => $grund !== '' ? $grund : 'Grund unbekannt', 'code' => $code];
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
 * Wie lange eine gespeicherte Bot-Sitzung wiederverwendet werden darf.
 *
 * ⚠️ MediaWiki laesst eine Sitzung in der Voreinstellung eine Stunde leben. 15 Minuten
 * lassen davon reichlich Sicherheitsabstand und decken einen ganzen Dump-Lauf ab -- die
 * Kontinent-Phase braucht rund 20. Laenger waere kein Gewinn: der zweite Lauf des Tages
 * meldet sich ohnehin neu an, und eine abgelaufene Sitzung kostet einen Fehlversuch.
 */
const AVESMAPS_WIKI_BOT_SESSION_MAX_AGE = 900;

/**
 * Die Sperre fuer den Ablageort der Bot-Sitzung -- gleiche Bauart wie uploads/db-backups.
 * 🔴 DIESE KONSTANTE IST DIE QUELLE, es gibt keine Kopie im Repo.
 */
const AVESMAPS_WIKI_BOT_HTACCESS = "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n\n"
    . "<IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n</IfModule>\n";

/**
 * Wo die Bot-Sitzung liegt -- oder null, wenn es keinen schreibbaren Ort gibt.
 *
 * 💣 WARUM UEBERHAUPT: der Anmeldezustand lebte nur im jeweiligen PHP-Prozess, und jeder
 * Schritt eines Dump-Laufs ist ein eigener Prozess. Die Kontinent-Phase meldete sich
 * deshalb in JEDEM ihrer 21 Schritte neu an und zahlte dafuer zwei zusaetzliche
 * gedrosselte Anfragen -- drei statt einer, also 60 statt 20 Sekunden je Schritt. Gemessen
 * am 25.08.2026: 14 der 34 Wiki-Minuten eines Laufs gingen fuer nichts drauf.
 *
 * 🔴 HIER LIEGEN SITZUNGS-COOKIES. Das Verzeichnis ist per .htaccess gesperrt (dieselbe
 * Bauart wie uploads/db-backups, wo die Datenbanksicherung samt Passwort-Hashes liegt), und
 * die Datei bekommt 0600. Ein Cookie ist kein Passwort -- es laeuft ab, und es steht nichts
 * darin, womit man sich neu anmelden koennte.
 *
 * ⚠️ Kein schreibbarer Ort = null = alles wie vorher, also Anmeldung je Prozess. Auf dem
 * Entwicklungsrechner ist das der Normalfall und ausdruecklich kein Fehler.
 */
function avesmapsWikiBotSitzungDatei(): ?string {
    if (!function_exists('avesmapsApiRoot')) {
        return null;
    }

    try {
        $verzeichnis = dirname(avesmapsApiRoot()) . DIRECTORY_SEPARATOR . 'uploads'
            . DIRECTORY_SEPARATOR . 'wiki-bot';
    } catch (Throwable) {
        return null;
    }

    if (!is_dir($verzeichnis) && !@mkdir($verzeichnis, 0775, true) && !is_dir($verzeichnis)) {
        return null;
    }

    $sperre = $verzeichnis . DIRECTORY_SEPARATOR . '.htaccess';
    if (!is_file($sperre) || @file_get_contents($sperre) !== AVESMAPS_WIKI_BOT_HTACCESS) {
        @file_put_contents($sperre, AVESMAPS_WIKI_BOT_HTACCESS);
    }

    return $verzeichnis . DIRECTORY_SEPARATOR . 'sitzung.json';
}

/**
 * REIN: ist ein abgelegter Sitzungssatz noch brauchbar?
 *
 * 💣 Ein Satz OHNE Zeitstempel gilt als unbrauchbar, nicht als uralt oder als frisch. Ein
 * fehlender Zeitstempel ist kein Alter von null -- wer ihn so liest, benutzt eine beliebig
 * alte Sitzung ewig weiter.
 *
 * @param array<string, mixed>|null $satz
 */
function avesmapsWikiBotSitzungBrauchbar(?array $satz, float $jetzt): bool {
    if (!is_array($satz)) {
        return false;
    }

    $cookies = $satz['cookies'] ?? null;
    if (!is_array($cookies) || $cookies === []) {
        return false;
    }

    $seit = $satz['seit'] ?? null;
    if (!is_numeric($seit)) {
        return false;
    }

    $alter = $jetzt - (float) $seit;

    // Ein Zeitstempel aus der ZUKUNFT (verstellte Uhr) ist ebenfalls unbrauchbar -- er
    // machte die Sitzung sonst unbegrenzt haltbar.
    return $alter >= 0.0 && $alter < AVESMAPS_WIKI_BOT_SESSION_MAX_AGE;
}

/**
 * Die abgelegte Bot-Sitzung, oder null. Liest nur; entscheidet nichts ausser Haltbarkeit.
 *
 * @return array<string, string>|null die Cookies
 */
function avesmapsWikiBotSitzungLaden(): ?array {
    $datei = avesmapsWikiBotSitzungDatei();
    if ($datei === null || !is_file($datei)) {
        return null;
    }

    $roh = @file_get_contents($datei);
    if (!is_string($roh) || $roh === '') {
        return null;
    }

    try {
        $satz = json_decode($roh, true, 8, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return null;
    }

    if (!avesmapsWikiBotSitzungBrauchbar(is_array($satz) ? $satz : null, microtime(true))) {
        return null;
    }

    $cookies = [];
    foreach ($satz['cookies'] as $name => $wert) {
        $cookies[(string) $name] = (string) $wert;
    }

    return $cookies === [] ? null : $cookies;
}

/** Die frisch erworbene Sitzung ablegen, damit der naechste Schritt sie erbt. */
function avesmapsWikiBotSitzungSpeichern(array $cookies): void {
    $datei = avesmapsWikiBotSitzungDatei();
    if ($datei === null || $cookies === []) {
        return;
    }

    try {
        $roh = json_encode(['cookies' => $cookies, 'seit' => microtime(true)], JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return;
    }

    if (@file_put_contents($datei, $roh, LOCK_EX) !== false) {
        @chmod($datei, 0600);
    }
}

/** Die abgelegte Sitzung wegwerfen -- nach einer abgelehnten Zusicherung. */
function avesmapsWikiBotSitzungVergessen(): void {
    $datei = avesmapsWikiBotSitzungDatei();
    if ($datei !== null && is_file($datei)) {
        @unlink($datei);
    }
}

/**
 * Eine aus der Ablage uebernommene Sitzung war abgelaufen: wegwerfen und EINMAL frisch
 * anmelden. Gibt zurueck, ob danach eine Bot-Sitzung steht.
 *
 * 💣 DIESE ZWEITE CHANCE IST DER PREIS DER ABLAGE. Ohne sie wuerde eine abgelaufene Sitzung
 * jeden Schritt scheitern lassen, und der Lauf braeche mit 'assertuserfailed' ab -- also
 * genau der Schaden, den das Sparen der Anmeldung vermeiden sollte, nur schlimmer.
 *
 * ⚠️ Genau EINMAL je Prozess: sonst kreist ein dauerhaft abgelehnter Zugang zwischen
 * Anmeldung und Wiederholung.
 * ⚠️ Und nur fuer eine UEBERNOMMENE Sitzung. Eine soeben frisch erworbene, die trotzdem
 * abgelehnt wird, ist ein echter Fehler und muss laut werden.
 */
function avesmapsWikiBotSitzungErneuern(): bool {
    static $schonVersucht = false;

    $zustand = avesmapsWikiBotZustand();
    if ($schonVersucht || empty($zustand['aus_ablage'])) {
        return false;
    }
    $schonVersucht = true;

    avesmapsWikiSyncLogServerError('wiki_bot_sitzung_abgelaufen', []);
    avesmapsWikiBotSitzungVergessen();
    avesmapsWikiBotZustand(['status' => 'unversucht', 'grund' => '', 'cookies' => []]);

    return avesmapsWikiBotSitzungSicherstellen();
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

    // ⭐ ZUERST DIE ABLAGE. Eine noch haltbare Sitzung aus einem frueheren Schritt spart die
    // zwei gedrosselten Anfragen der Anmeldung -- in der Kontinent-Phase sind das 40 der 60
    // Sekunden JE SCHRITT. Sie wird als 'aus_ablage' markiert, damit ein spaeteres
    // 'assertuserfailed' sie wegwerfen und einmal frisch anmelden kann.
    $abgelegt = avesmapsWikiBotSitzungLaden();
    if ($abgelegt !== null) {
        avesmapsWikiBotZustand(['status' => 'bot', 'grund' => '', 'cookies' => $abgelegt, 'aus_ablage' => true]);
        return true;
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
        avesmapsWikiBotZustand([
            'status' => 'gescheitert',
            'grund' => $ergebnis['grund'],
            'grund_code' => (string) ($ergebnis['code'] ?? ''),
        ]);
        return false;
    }

    avesmapsWikiBotZustand(['status' => 'bot', 'grund' => '', 'cookies' => $loginAntwort['cookies'], 'aus_ablage' => false]);
    // Damit der naechste Schritt sie erbt, statt sich noch einmal anzumelden.
    avesmapsWikiBotSitzungSpeichern($loginAntwort['cookies']);
    return true;
}

/**
 * DIE ANMELDUNG WIRKLICH VERSUCHEN und sagen, woran sie liegt.
 *
 * ⭐ WOZU ES DAS GIBT: avesmapsWikiBotStatusShape() loest bewusst KEINE Anmeldung aus -- es
 * beantwortet nur "steht etwas in der Konfiguration?". Damit lassen sich die beiden Faelle, die
 * einen Betreiber wirklich beschaeftigen, nicht unterscheiden: "eingetragen und richtig" gegen
 * "eingetragen und vom Wiki abgelehnt". Der Grund der Ablehnung lief bisher nur als kurze rote
 * Zeile durch die Statusanzeige eines laufenden Dumps vorbei -- und wer ihn verpasst, hat nichts.
 *
 * 🔴 DAS PASSWORT KOMMT HIER NIE HERAUS -- nur seine LAENGE und ob es die Form eines
 * MediaWiki-Botpassworts hat (32 Zeichen, nur Kleinbuchstaben und Ziffern). Der BENUTZERNAME
 * dagegen wird genannt: er ist oeffentlich (das Botkonto steht in "Wiki Aventurica:Roboter/Liste"),
 * und er ist die haeufigste Fehlerquelle ueberhaupt -- ein Botpasswort verlangt die Form
 * `Konto@Botname`, nicht das blosse Konto. Ihn zu verschweigen hiesse, die Frage nicht zu
 * beantworten, fuer die es diese Funktion gibt.
 *
 * ⚠️ Der Aufruf KOSTET zwei gedrosselte Fremdanfragen (Token, dann Anmeldung) und dauert damit
 * bis zu einer Minute. Er gehoert an einen Knopf, nie in eine Statusabfrage, die nebenbei laeuft.
 *
 * @return array<string, mixed>
 */
function avesmapsWikiBotDiagnose(): array {
    $zugang = avesmapsWikiBotZugangLesen();

    $befund = [
        'hinterlegt' => $zugang !== null,
        'benutzer' => '',
        'benutzer_hat_at' => false,
        'passwort_laenge' => 0,
        'passwort_hat_botform' => false,
        'status' => 'unversucht',
        'grund' => '',
        'grund_code' => '',
        'urteil' => '',
    ];

    if ($zugang === null) {
        $befund['urteil'] = 'In api/config.local.php steht unter "wiki" kein vollstaendiger Zugang: '
            . 'es braucht BEIDE Felder, bot_username UND bot_password. Ein halber Zugang wird gar '
            . 'nicht erst versucht.';

        return $befund;
    }

    $benutzer = (string) $zugang['username'];
    $passwort = (string) $zugang['password'];

    $befund['benutzer'] = $benutzer;
    $befund['benutzer_hat_at'] = str_contains($benutzer, '@');
    $befund['passwort_laenge'] = strlen($passwort);
    $befund['passwort_hat_botform'] = preg_match('/^[a-z0-9]{32}$/', $passwort) === 1;

    // Die Anmeldung erzwingen: der Zustand ist in einer frischen Anfrage ohnehin "unversucht",
    // aber ein ausdruecklicher Rueckstellwert macht die Funktion vom Aufrufort unabhaengig.
    avesmapsWikiBotZustand(['status' => 'unversucht', 'grund' => '', 'cookies' => []]);
    avesmapsWikiBotSitzungSicherstellen();

    $zustand = avesmapsWikiBotZustand();
    $befund['status'] = (string) ($zustand['status'] ?? 'unversucht');
    $befund['grund'] = (string) ($zustand['grund'] ?? '');
    $befund['grund_code'] = (string) ($zustand['grund_code'] ?? '');

    $befund['urteil'] = avesmapsWikiBotDiagnoseUrteil($befund);

    return $befund;
}

/**
 * REIN: aus den Befunden EIN Satz, der sagt, was zu tun ist.
 *
 * 💣 Die Reihenfolge ist die Aussagekraft: die FORM der Zugangsdaten schlaegt den Grund vom
 * Wiki. "Incorrect username or password" ist dieselbe Meldung fuer ein falsches Passwort wie
 * fuer einen Benutzernamen ohne `@Botname` -- die Form wissen wir aber selbst, und sie ist die
 * haeufigere Ursache. Erst wenn die Form stimmt, ist der Grund vom Wiki die beste Auskunft.
 *
 * @param array<string, mixed> $befund
 */
function avesmapsWikiBotDiagnoseUrteil(array $befund): string {
    $status = (string) ($befund['status'] ?? '');
    $grund = trim((string) ($befund['grund'] ?? ''));

    if ($status === 'bot') {
        return 'Alles in Ordnung: die Anmeldung steht, der Lauf holt 500 Titel je Anfrage.';
    }

    if (!(bool) ($befund['benutzer_hat_at'] ?? false)) {
        return 'Der Benutzername hat kein "@". Ein MediaWiki-Botpasswort verlangt die Form '
            . 'Konto@Botname -- also z.B. "Avesmaps@Dump", genau wie es Spezial:BotPasswords oben '
            . 'anzeigt, nachdem das Passwort erzeugt wurde. Nur "Avesmaps" wird immer abgelehnt, '
            . 'auch wenn das Passwort stimmt.';
    }

    if (!(bool) ($befund['passwort_hat_botform'] ?? false)) {
        return 'Das Passwort hat nicht die Form eines Botpassworts (32 Zeichen, nur '
            . 'Kleinbuchstaben und Ziffern; hinterlegt sind '
            . (int) ($befund['passwort_laenge'] ?? 0) . '). Wahrscheinlich steht dort das '
            . 'KONTO-Passwort -- das lehnt MediaWiki fuer die API grundsaetzlich ab. Gebraucht '
            . 'wird die Zeichenkette, die Spezial:BotPasswords EINMAL nach dem Erzeugen anzeigt.';
    }

    if ($grund === 'kein Login-Token') {
        return 'Das Wiki hat schon den Login-Token verweigert -- das liegt NICHT an den '
            . 'Zugangsdaten, sondern am Zugang zur API selbst (Sperre, Netzfehler oder '
            . 'Wartung). Das Fehlerprotokoll nennt unter "wiki_bot_login_no_token" den '
            . 'HTTP-Status.';
    }

    // 💣 DER CODE SCHLAEGT DEN TEXT. MediaWiki schickt fuer mehrere Ursachen denselben Satz,
    // trennt sie aber im Code. Wer nur den Text liest, nennt Ursachen, die das Wiki gerade
    // ausgeschlossen hat -- am 25.08.2026 genau so passiert.
    $code = trim((string) ($befund['grund_code'] ?? ''));

    if (str_contains($code, 'botpasswords-restriction')) {
        return 'Das Botpasswort ist gueltig, aber BESCHRAENKT: das Wiki laesst es von unserer '
            . 'Adresse nicht zu. In Spezial:BotPasswords beim Eintrag das Feld "Erlaubte '
            . 'IP-Bereiche" oeffnen und die Server-Adresse 81.169.144.135 aufnehmen (oder auf '
            . 'die Vorgabe 0.0.0.0/0 und ::/0 zuruecksetzen). Ein NEUES Passwort hilft hier '
            . 'nicht -- das alte ist in Ordnung.';
    }

    if ($code === 'nosuchuser') {
        return 'Das Wiki kennt das KONTO nicht, das vor dem "@" steht ("' . $grund . '"). Nicht '
            . 'das Botpasswort ist das Problem, sondern der Kontoname davor.';
    }

    if ($code === 'wrongpassword') {
        return 'Das Wiki kennt dieses Botpasswort nicht (mehr): entweder wurde es '
            . 'zurueckgezogen -- das passiert automatisch, sobald das KONTO-Passwort geaendert '
            . 'wird --, oder der Name nach dem "@" gehoert zu keinem Eintrag, oder die 32 Zeichen '
            . 'stimmen nicht. Alle drei loest derselbe Handgriff: in Spezial:BotPasswords ein '
            . 'Botpasswort neu erzeugen und BEIDE Angaben frisch in api/config.local.php '
            . 'eintragen. ⭐ Eine IP-Beschraenkung ist es NICHT -- die meldet sich mit einem '
            . 'eigenen Code (botpasswords-restriction-failed) und nicht mit diesem.';
    }

    if ($grund !== '') {
        return 'Form der Zugangsdaten ist in Ordnung, das Wiki lehnt sie trotzdem ab: "' . $grund
            . '". Dann bleiben drei Ursachen: das Botpasswort wurde zurueckgezogen (das passiert '
            . 'automatisch, sobald das KONTO-Passwort geaendert wird), der Botname nach dem "@" '
            . 'stimmt nicht, oder das Botpasswort traegt eine IP-Beschraenkung, die unsere '
            . 'Server-Adresse 81.169.144.135 nicht enthaelt.';
    }

    return 'Die Anmeldung ist gescheitert, ohne dass das Wiki einen Grund genannt hat.';
}

/**
 * Wie lang der kodierte `titles=`-Wert hoechstens werden darf.
 *
 * 💣 APACHE NIMMT 8190 ZEICHEN FUER DIE GANZE ANFRAGEZEILE (`LimitRequestLine`), nicht nur fuer
 * den einen Parameter. Adresse, action, prop, format und der Rest wollen auch Platz -- 7000
 * lassen davon reichlich uebrig und liegen trotzdem weit ueber dem, was 50 Titel brauchen.
 */
const AVESMAPS_WIKI_TITLE_QUERY_MAX_ENCODED = 7000;

/**
 * Der naechste Titel-Stapel ab $offset -- begrenzt durch ZWEI Groessen, und die kleinere gewinnt.
 *
 * 💣 DAS IST DER FEHLER VOM 25.08.2026, UND ER LAG DIE GANZE ZEIT DA. Gestapelt wurde nur nach
 * ZAHL (avesmapsWikiSyncTitleBatchSize: 50 anonym, 500 als Bot). Solange die Bot-Anmeldung
 * scheiterte, waren es 50 Titel, rund 1.000 Zeichen, und alles passte. In der Minute, in der die
 * Anmeldung repariert war, wurden daraus 500 Titel und ueber 15.000 Zeichen -- das Wiki
 * antwortete mit **HTTP 414 URI Too Long**, und der ganze Dump stand.
 *
 * ⚠️ Die Fehlerklasse ist die eigentliche Lehre: der Fehler wurde nicht durch eine Aenderung an
 * dieser Stelle ausgeloest, sondern dadurch, dass ein NACHBARTEIL anfing zu funktionieren. So
 * etwas findet man beim Bauen nie.
 *
 * 💣 EIN STAPEL IST NIE LEER, solange noch Titel offen sind -- auch nicht, wenn ein einzelner
 * Titel die Grenze allein sprengt. Ein leerer Stapel liesse den Cursor des Aufrufers stehen und
 * die Phase endlos kreisen; ein uebersprungener Titel verloere lautlos einen Ort. Also faehrt so
 * einer allein, und die Anfrage scheitert dann SICHTBAR.
 *
 * ⚠️ Gerechnet wird die KODIERTE Laenge: ein Umlaut wird zu `%C3%BC` (sechs Zeichen statt
 * einem), das Trennzeichen `|` zu `%7C`. Wer strlen() nimmt, unterschaetzt aventurische Titel
 * systematisch.
 *
 * @param list<string> $titles
 * @return list<string>
 */
function avesmapsWikiSyncNextTitleBatch(array $titles, int $offset, int $maxAnzahl): array {
    $titles = array_values($titles);
    $gesamt = count($titles);
    $offset = max(0, $offset);
    if ($offset >= $gesamt) {
        return [];
    }

    $maxAnzahl = max(1, $maxAnzahl);
    $stapel = [];
    $laenge = 0;

    for ($i = $offset; $i < $gesamt && count($stapel) < $maxAnzahl; $i++) {
        $titel = (string) $titles[$i];
        // +3 fuer das kodierte Trennzeichen %7C vor jedem weiteren Titel.
        $kosten = strlen(rawurlencode($titel)) + ($stapel === [] ? 0 : 3);

        if ($stapel !== [] && $laenge + $kosten > AVESMAPS_WIKI_TITLE_QUERY_MAX_ENCODED) {
            break;
        }

        $stapel[] = $titel;
        $laenge += $kosten;
    }

    return $stapel;
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

    // 💣 EINE FEHLERANTWORT MIT HTTP 200 UEBERSPRINGT SONST EINE GANZE KATEGORIE, LAUTLOS.
    // MediaWiki liefert Fehler im Rumpf, nicht im Status. Fehlt dadurch der Zweig
    // query.categorymembers, kaeme hier {titles: [], continue: null} heraus -- und der
    // Schrittsammler eine Ebene hoeher liest daraus 'Kategorie fertig', rueckt seinen
    // Cursor weiter und meldet am Ende 'abgeschlossen'. In der Zustandstabelle fehlt dann
    // der halben Ortsklasse ihr override_class, und das ist hinterher nicht mehr von 'das
    // gibt es im Wiki nicht' zu unterscheiden.
    //
    // 🪤 Erreichbar wurde das durch das FORTSETZEN (25.08.2026): ein cmcontinue, das seit
    // Stunden in stats_json liegt, beantwortet MediaWiki mit `badcontinue` -- HTTP 200.
    // avesmapsWikiSyncApiRequest faengt nur assertuserfailed und toomanyvalues ab; jeder
    // andere Code kam bis hierher durch und sah aus wie eine leere Kategorie.
    if (isset($data['error'])) {
        $fehlercode = (string) ($data['error']['code'] ?? 'unbekannt');
        avesmapsWikiSyncLogServerError('wiki_categorymembers_fehler', [
            'kategorie' => $categoryName,
            'code' => $fehlercode,
            'hatte_fortsetzung' => $continueToken !== null && $continueToken !== '',
        ]);

        throw new AvesmapsWikiUnreachableException(
            'Das Wiki hat die Kategorie "' . $categoryName . '" abgelehnt (' . $fehlercode
                . '). Der Lauf haelt hier an, statt die Kategorie stillschweigend zu ueberspringen.'
        );
    }

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
            // 💣 AUCH DER WIEDERHOLVERSUCH RESERVIERT SEINEN PLATZ. Bis 25.08.2026 schlief
            // hier nur der Backoff und vermerkte NICHTS -- der naechste Prozess las dann
            // einen Platz von vor 40 Sekunden, rechnete 'darf sofort' und feuerte
            // unmittelbar hinter dem Wiederholversuch her. Ausgerechnet in dem Moment, in
            // dem das Wiki gerade 429 oder 503 gesagt hat. Dieselbe Lehre wie ueberall:
            // eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel.
            // ⚠️ Kostet fast nichts: der Backoff (40 s und mehr) ist laenger als der
            // Abstand, die Reservierung wartet also in aller Regel null und schreibt nur.
            avesmapsWikiSyncBackoffWikiRequest($attempt);
            avesmapsWikiSyncThrottleWikiRequest();
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

        // 💣 EINE UEBERNOMMENE SITZUNG KANN ABGELAUFEN SEIN, und dann ist das hier kein Fehler,
        // sondern der erwartete Preis der Ablage: wegwerfen, einmal frisch anmelden, dieselbe
        // Anfrage wiederholen. Ohne diese zweite Chance liesse eine abgelaufene Sitzung jeden
        // Schritt scheitern -- genau der Schaden, den das Sparen der Anmeldung vermeiden soll.
        // ⚠️ Nur bei einer UEBERNOMMENEN Sitzung und nur EINMAL je Prozess (der Riegel steht in
        // avesmapsWikiBotSitzungErneuern), sonst kreist ein dauerhaft abgelehnter Zugang.
        if ($fehlercode === 'assertuserfailed' && avesmapsWikiBotSitzungErneuern()) {
            return avesmapsWikiSyncApiRequest($params);
        }

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
/**
 * Wie viele Abstaende ein vermerkter Platz hoechstens in der Zukunft liegen darf, bevor er
 * als KAPUTT gilt (verstellte Uhr, von Hand angefasste Datei) statt als Warteschlange.
 *
 * ⚠️ Grosszuegig, und das mit Absicht: bei echter Gleichzeitigkeit ist ein Platz weit
 * hinten voellig berechtigt (der zehnte Wartende wartet zehn Abstaende). Zu knapp
 * gedeckelt zerreisst die Staffelung -- und dann feuern alle gemeinsam los, also genau
 * das, was die Drossel verhindern soll.
 */
const AVESMAPS_WIKI_DROSSEL_MAX_WARTESCHLANGE = 20;

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
 * ⭐ ES WIRD EIN PLATZ RESERVIERT, NICHT DIE SPERRE GEHALTEN. Der Aufrufer traegt unter der
 * Sperre ein, WANN er dran ist, gibt sie sofort wieder frei und schlaeft erst danach. Zwei
 * gleichzeitige Aufrufer bekommen so aufeinanderfolgende Plaetze, ohne einander zu blockieren.
 *
 * 💣 DIE ERSTE FASSUNG HIELT DIE SPERRE WAEHREND DES SCHLAFENS (24.08.2026), und das war
 * gefaehrlicher als es aussah: N gleichzeitige Anfragen warten dann nacheinander AUF DIE SPERRE,
 * jede belegt dabei einen PHP-Arbeiter, und die Antwortzeit waechst mit N x 20 s. Auf STRATOs
 * geteiltem Hosting ist das genau die Arbeiter-Saettigung, vor der AGENTS.md warnt -- und ein
 * Lauf, den der Owner ein zweites Mal startet (die Pipeline-Sperre laesst denselben Benutzer
 * wieder herein), reicht schon fuer zwei. Reserviert wird in Mikrosekunden, geschlafen ohne
 * Sperre.
 *
 * 💣 GEDECKELT WIRD DER GELESENE PLATZ, NICHT DER SCHLAF. Die erste Fassung deckelte die
 * Wartezeit gegen JETZT -- und zerriss damit genau die Warteschlange, die sie schuetzen
 * sollte: lag der Vermerk weit vorn, warteten ALLE Wartenden denselben Deckel ab und
 * feuerten gemeinsam los. Gemessen 25.08.2026 mit vier gleichzeitigen Prozessen und einem
 * Vermerk 30 s in der Zukunft: 0,09 s Abstand statt 0,2. Ein absurd weit vorn liegender
 * Platz ist KAPUTT (verstellte Uhr, Handarbeit), nicht Warteschlange -- er wird beim LESEN
 * auf jetzt zurueckgesetzt, und danach steht die Staffelung wieder.
 *
 * 💣 UND EIN UNLESBARER VERMERK IST NICHT NULL. Die erste Fassung machte aus jedem
 * nicht-numerischen Inhalt eine 0.0, rechnete `max(jetzt, 0 + Abstand)` = jetzt und feuerte
 * OHNE Pause -- und meldete dabei Erfolg, sodass auch der prozesslokale Rueckfall nicht
 * griff. Gemessen: 0,006 s statt der geforderten 0,1. Ein leerer Vermerk entsteht auf
 * STRATO von selbst, sobald die Speicherquote den Schreibvorgang abweist. Deshalb: FEHLT
 * die Datei, ist es die erste Anfrage (kein Warten); ist sie DA und unlesbar, wird ein
 * voller Abstand angenommen -- die sichere Richtung.
 */
function avesmapsWikiSyncDrosselUeberProzessgrenze(int $mindestabstand, ?string $vermerkDatei): bool {
    if ($vermerkDatei === null) {
        return false;
    }

    // ⚠️ VOR dem Oeffnen: 'c+' legt die Datei an, danach liesse sich 'gab es noch nie eine
    // Anfrage' nicht mehr von 'der Vermerk wurde zerstoert' unterscheiden.
    $neuAngelegt = !is_file($vermerkDatei);

    $griff = @fopen($vermerkDatei, 'c+');
    if ($griff === false) {
        return false;
    }

    if (!@flock($griff, LOCK_EX)) {
        @fclose($griff);
        return false;
    }

    $abstandSekunden = $mindestabstand / 1000000;
    $jetzt = microtime(true);
    $meinPlatz = $jetzt;
    $geschrieben = false;

    try {
        $roh = trim((string) @stream_get_contents($griff));

        if ($roh === '') {
            // Leer heisst: es gab noch nie eine Anfrage (oder ein Schreibvorgang ist
            // gescheitert). Beides behandeln wir gleich vorsichtig NICHT -- die erste
            // Anfrage darf ohne Warten durch, ein zerstoerter Vermerk nicht. Unterscheiden
            // laesst sich das hier nicht, also entscheidet die Groesse der Datei: eine
            // eben erst angelegte ist leer, eine zerstoerte ebenfalls. Wir nehmen die
            // sichere Richtung und warten einen vollen Abstand, sobald die Datei schon
            // einmal beschrieben war -- erkennbar daran, dass sie ueberhaupt existiert und
            // nicht in DIESEM Aufruf entstanden ist.
            $letzter = $neuAngelegt ? 0.0 : $jetzt;
        } elseif (is_numeric($roh)) {
            $letzter = (float) $roh;
        } else {
            // Unlesbar: sichere Richtung, voller Abstand.
            $letzter = $jetzt;
        }

        // Ein Platz absurd weit in der Zukunft ist kaputt, nicht Warteschlange. Der Deckel
        // laesst genug Luft fuer echte Gleichzeitigkeit und faengt trotzdem die verstellte
        // Uhr -- ohne die Staffelung der Wartenden zu zerreissen.
        $deckel = $jetzt + ($abstandSekunden * AVESMAPS_WIKI_DROSSEL_MAX_WARTESCHLANGE);
        if ($letzter > $deckel) {
            $letzter = $jetzt;
        }

        // Mein Platz: entweder jetzt, oder einen vollen Abstand hinter dem letzten vergebenen.
        $meinPlatz = max($jetzt, $letzter + $abstandSekunden);

        // 💣 ERST SCHREIBEN, DANN KUERZEN -- und den Erfolg pruefen. Die erste Fassung rief
        // ftruncate() VOR fwrite() und sah dessen Rueckgabewert nie an: scheiterte der
        // Schreibvorgang (auf STRATO der dokumentierte Quotenfall), blieb die Datei LEER
        // zurueck, und danach feuerte jeder Prozess ohne jede Pause.
        @rewind($griff);
        $bytes = @fwrite($griff, sprintf('%.6F', $meinPlatz));
        if ($bytes !== false && $bytes > 0) {
            @ftruncate($griff, $bytes);
            @fflush($griff);
            $geschrieben = true;
        }
    } finally {
        // Erst freigeben, DANN schlafen -- siehe Docblock.
        @flock($griff, LOCK_UN);
        @fclose($griff);
    }

    if (!$geschrieben) {
        // 🔴 Konnte der Platz nicht vermerkt werden, ist die prozessuebergreifende Drossel
        // wirkungslos -- dann muss der prozesslokale Rueckfall greifen, statt hier Erfolg
        // zu melden. Und es muss laut sein: ein stiller Ausfall ist von 'laeuft richtig'
        // nicht zu unterscheiden.
        static $schreibfehlerGemeldet = false;
        if (!$schreibfehlerGemeldet) {
            $schreibfehlerGemeldet = true;
            avesmapsWikiSyncLogServerError('wiki_drossel_vermerk_nicht_schreibbar', ['datei' => $vermerkDatei]);
        }

        return false;
    }

    $rest = (int) (($meinPlatz - microtime(true)) * 1000000);
    if ($rest > 0) {
        usleep($rest);
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