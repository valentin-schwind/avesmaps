<?php

declare(strict_types=1);

/**
 * Unit-Test für die Einrichtung eines Kanal-Zugangs. Aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/social/__tests__/connect-test.php
 *
 * Geprüft wird der Teil, der ohne Netz auskommt und an dem am 10.08.2026 dreimal etwas Falsches in
 * der Tabelle landete: die NACHPRÜFUNG. Sie ist die einzige Stelle zwischen „Meta hat geantwortet"
 * und „steht in der Datenbank" -- was sie durchlässt, postet später im Namen des Projekts oder hört
 * ohne Vorwarnung auf.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../channels.php';
require __DIR__ . '/../connect.php';

const PAGE = '1240150995850875';

/** @return array<string, mixed> Eine Antwort von /debug_token, die alles richtig macht. */
function gutFall(array $abweichung = []): array
{
    return ['data' => array_merge([
        'app_id' => '1037557352198584',
        'type' => 'PAGE',
        'is_valid' => true,
        'profile_id' => PAGE,
        'expires_at' => 0,
        'scopes' => ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
    ], $abweichung)];
}

// ---- der gute Fall ---------------------------------------------------------------------------------

assert(avesmapsSocialFacebookVerifyPageToken(gutFall(), PAGE) === null,
    'ein dauerhafter Seiten-Token der richtigen Seite mit Schreibrecht geht durch');

// ---- 💣 genau der Fehlgriff vom 10.08.2026 ---------------------------------------------------------

// Der Seiten-Token aus einem KURZlebigen Nutzer-Token: gültig, richtige Seite, richtige Rechte -- und
// in einer Stunde tot. Er sieht in jeder Liste aus wie der richtige. Nur diese Zahl unterscheidet sie.
$kurz = avesmapsSocialFacebookVerifyPageToken(gutFall(['expires_at' => 1786399200]), PAGE);
assert(is_string($kurz), 'ein Token MIT Ablaufdatum wird abgelehnt, nicht gespeichert');
assert(mb_stripos($kurz, 'langlebigen') !== false,
    'und die Absage nennt die Ursache -- der Tausch davor, nicht der Token selbst');
assert(mb_strpos($kurz, '2026') !== false, 'samt dem Datum, damit sichtbar ist, wie kurz kurz ist');

// Der zweite Griff daneben: der langlebige NUTZER-Token (60 Tage) statt des Seiten-Tokens. Er stand
// am 10.08.2026 kurzzeitig in der Tabelle.
$nutzer = avesmapsSocialFacebookVerifyPageToken(gutFall(['type' => 'USER']), PAGE);
assert(is_string($nutzer), 'ein Nutzer-Token wird abgelehnt');
assert(mb_stripos($nutzer, 'Nutzer') !== false, 'und beim Namen genannt');

// ---- fällt GESCHLOSSEN aus -------------------------------------------------------------------------

// 🔴 Eine Antwort OHNE expires_at beweist nicht „läuft nie ab" -- sie beweist gar nichts.
$ohne = gutFall();
unset($ohne['data']['expires_at']);
assert(is_string(avesmapsSocialFacebookVerifyPageToken($ohne, PAGE)),
    'fehlendes Ablaufdatum ist kein Freibrief');

assert(is_string(avesmapsSocialFacebookVerifyPageToken(['data' => []], PAGE)),
    'eine leere Antwort wird abgelehnt');
assert(is_string(avesmapsSocialFacebookVerifyPageToken([], PAGE)),
    'und eine ohne data-Block erst recht');
assert(is_string(avesmapsSocialFacebookVerifyPageToken(gutFall(['is_valid' => false]), PAGE)),
    'is_valid=false wird abgelehnt');

// 💣 Die falsche Seite: ein völlig gültiger Token -- nur eben für einen anderen Auftritt. Ohne diese
// Prüfung stünde der erste Beitrag öffentlich woanders.
$fremd = avesmapsSocialFacebookVerifyPageToken(gutFall(['profile_id' => '61592910429900']), PAGE);
assert(is_string($fremd), 'ein Token für eine ANDERE Seite wird abgelehnt');
assert(mb_strpos($fremd, '61592910429900') !== false && mb_strpos($fremd, PAGE) !== false,
    'und nennt beide Kennungen, sonst rät man, welche gemeint ist');

// Ohne Schreibrecht wäre der Kanal eingerichtet und trotzdem stumm -- das fiele erst beim ersten
// Beitrag auf, also öffentlich.
$stumm = avesmapsSocialFacebookVerifyPageToken(
    gutFall(['scopes' => ['pages_show_list', 'pages_read_engagement']]),
    PAGE
);
assert(is_string($stumm), 'ohne pages_manage_posts wird nichts gespeichert');
assert(mb_strpos($stumm, 'pages_manage_posts') !== false, 'und das fehlende Recht wird benannt');

// ---- die Seite heraussuchen ------------------------------------------------------------------------

$antwort = ['data' => [
    ['name' => 'Avesmaps', 'id' => '61592910429900', 'access_token' => 'alter-token'],
    ['name' => 'Avesmaps', 'id' => PAGE, 'access_token' => 'richtiger-token'],
    ['name' => 'SPACECAT', 'id' => '999', 'access_token' => 'fremder-token'],
]];
// 💣 Gesucht wird über die KENNUNG, nie über den Namen. Am 10.08.2026 hiessen zwei Auftritte
// „Avesmaps" -- über den Namen hätte man hier die alte Seite erwischt, die zuerst in der Liste steht.
$treffer = avesmapsSocialFacebookPickPage($antwort, PAGE);
assert(is_array($treffer) && $treffer['access_token'] === 'richtiger-token',
    'die Zeile wird über die id gefunden, nicht über den gleichlautenden Namen');
assert($treffer['name'] === 'Avesmaps', 'und der Name reist mit, damit die Rückmeldung ihn zeigen kann');

assert(avesmapsSocialFacebookPickPage($antwort, '4711') === null,
    'eine Seite, die nicht dabei ist, ergibt null -- der Aufrufer sagt dann, wie man sie freigibt');
assert(avesmapsSocialFacebookPickPage(['data' => [['id' => PAGE, 'name' => 'x']]], PAGE) === null,
    'eine Zeile OHNE Token ist kein Treffer: sie käme als leerer Zugang in der Tabelle an');
assert(avesmapsSocialFacebookPickPage([], PAGE) === null, 'und eine leere Antwort ebenso');

// ---- wer sich einrichten kann ----------------------------------------------------------------------

assert(avesmapsSocialConnectSupports('facebook') === true, 'Facebook kennt diesen Weg');
assert(avesmapsSocialConnectSupports('probe') === false, 'die Probe braucht keinen');
assert(avesmapsSocialConnectSupports('instagram') === false, 'Instagram noch nicht');
assert(avesmapsSocialConnectSupports('gibtsnicht') === false, 'ein unbekannter Schlüssel schon gar nicht');

// ---- Metas Fehlertext ------------------------------------------------------------------------------

$text = avesmapsSocialGraphError(['error' => ['message' => 'Invalid OAuth access token', 'code' => 190]]);
assert(is_string($text) && mb_strpos($text, 'Invalid OAuth access token') !== false,
    "Metas eigener Text wandert durch -- er IST die Diagnose");
assert(mb_strpos((string) $text, '190') !== false, 'mit Code, weil der die Suche abkürzt');
assert(avesmapsSocialGraphError(['data' => []]) === null, 'ohne Fehlerobjekt kein Fehler');

fwrite(STDOUT, "connect-test: OK\n");
