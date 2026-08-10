<?php

declare(strict_types=1);

/**
 * Unit test für den Kanal „Neuigkeiten" — den einzigen, der auf avesmaps SELBST veröffentlicht.
 * Aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/social/__tests__/changelog-adapter-test.php
 *
 * Prüfbar ist hier die REINE Hälfte — wie aus einem Beitrag Überschrift und Rumpf werden — plus die
 * beiden Absagen, die der Adapter gibt, BEVOR er die Datenbank anfasst. Der Schreibvorgang selbst
 * braucht MySQL und wird live geprüft.
 *
 * 💣 Die teuerste Regel steht nicht hier, sondern im Dateikopf des Adapters: eine LEERE
 * `changelog_entry` fällt im Lesepfad auf die Saat zurück, und wer in diesem Zustand eine Zeile
 * einfügt, streicht den Verlauf auf diesen einen Eintrag zusammen. Dagegen hilft nur
 * `avesmapsChangelogSeedIfEmpty` vor jedem Schreibvorgang — ohne lokale MySQL nicht beweisbar,
 * deshalb hier wenigstens festgehalten, dass der Aufruf im Adapter steht.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}
if (!function_exists('mb_strlen')) {
    fwrite(STDERR, "FATAL: mbstring is missing -- the title length is measured with mb_strlen.\n");
    exit(2);
}

require __DIR__ . '/../channels.php';
require __DIR__ . '/../adapters/changelog.php';

// ---- das Register kennt den Kanal ------------------------------------------------------------------

$channel = avesmapsSocialChannel('changelog');
assert($channel !== null, 'der Kanal steht im Register');
assert($channel['label'] === 'Neuigkeiten',
    'die BESCHRIFTUNG heisst Neuigkeiten, der SCHLUESSEL bleibt changelog -- dieselbe Trennung wie '
    . 'ueberall bei diesem Fenster: der Schluessel steht in social_post_target.channel_key, ihn '
    . 'umzutaufen hiesse jede gespeicherte Zeile mitzuziehen');
assert($channel['max_hashtags'] === 0,
    'KEINE Hashtags: im Verlaufsfenster waeren sie toter Text unter einer Meldung, die niemand nach '
    . 'Schlagworten durchsucht');
assert($channel['requires_media'] === false, 'ein Bild ist nicht noetig');
assert($channel['shows_media'] === false,
    'und es wird auch nicht gezeigt -- die Zeile "Passt fuer ..." im Hub darf ihn deshalb nie nennen');
assert($channel['note'] !== '', 'der Kanal sagt in der Oberflaeche, dass die erste Zeile die Ueberschrift wird');

// 🔴 Er braucht kein fremdes Konto und ist deshalb IMMER nutzbar -- wie die Probe, nur dass er
// wirklich veroeffentlicht.
assert(avesmapsSocialChannelIsConfigured('changelog', [], []) === true,
    'ohne jede Konfiguration nutzbar: es gibt kein fremdes Konto, fuer das ein Zugang fehlen koennte');

// ---- Ueberschrift und Rumpf ---------------------------------------------------------------------------

$simple = avesmapsSocialChangelogSplit("Neue Doerfer im Bornland\nMit Wegen, Namen und Reisezeiten.");
assert($simple['error'] === null, 'zwei Zeilen sind der Normalfall');
assert($simple['title'] === 'Neue Doerfer im Bornland', 'die erste Zeile wird die Ueberschrift');
assert($simple['body'] === 'Mit Wegen, Namen und Reisezeiten.', 'der Rest wird der Rumpf');

$oneLine = avesmapsSocialChangelogSplit('Nur eine Zeile');
assert($oneLine['error'] === null && $oneLine['title'] === 'Nur eine Zeile' && $oneLine['body'] === '',
    'eine einzelne Zeile ist eine Ueberschrift ohne Rumpf, kein Fehler');

$manyLines = avesmapsSocialChangelogSplit("Titel\nAbsatz eins\n\nAbsatz zwei");
assert($manyLines['body'] === "Absatz eins\n\nAbsatz zwei",
    'nur die ERSTE Zeile wird abgetrennt -- der Rumpf behaelt seine eigenen Umbrueche');

// Windows-Zeilenenden: der Text kommt aus einem <textarea> im Browser, und der schickt \r\n.
$crlf = avesmapsSocialChangelogSplit("Titel\r\nRumpf");
assert($crlf['title'] === 'Titel' && $crlf['body'] === 'Rumpf',
    'CRLF wird wie LF behandelt -- sonst haengt ein \\r am Ende jeder Ueberschrift');

$padded = avesmapsSocialChangelogSplit("   Titel mit Rand   \n   Rumpf mit Rand   ");
assert($padded['title'] === 'Titel mit Rand' && $padded['body'] === 'Rumpf mit Rand',
    'beide Haelften werden getrimmt');

// ---- die ausdrueckliche Titelzeile schlaegt die erste Zeile ---------------------------------------------

$withTitle = avesmapsSocialChangelogSplit("Erste Textzeile\nZweite Zeile", 'Eine echte Ueberschrift');
assert($withTitle['error'] === null, 'mit Titelzeile ist alles in Ordnung');
assert($withTitle['title'] === 'Eine echte Ueberschrift', 'die Titelzeile IST die Ueberschrift');
// 💣 Der ganze Text bleibt der Rumpf. Ihm hier die erste Zeile wegzunehmen waere genau der Fehler,
// den die Titelzeile abschafft: der Editor hat die Ueberschrift bereits separat gesagt, also ist
// „Erste Textzeile" gewoehnlicher Text und kein Titel mehr.
assert($withTitle['body'] === "Erste Textzeile\nZweite Zeile",
    'der GANZE Text wird der Rumpf -- die erste Zeile wird nicht ein zweites Mal abgetrennt');

$titlePadded = avesmapsSocialChangelogSplit('Text', '   Titel mit Rand   ');
assert($titlePadded['title'] === 'Titel mit Rand', 'auch die Titelzeile wird getrimmt');

// Eine leere oder nur aus Leerraum bestehende Titelzeile ist KEINE Titelzeile -- dann gilt wieder die
// alte Regel. Das ist der Rueckfall, den die Routine und jeder Beitrag von vor dem 10.08.2026 braucht.
$blankTitle = avesmapsSocialChangelogSplit("Erste Zeile\nRest", '   ');
assert($blankTitle['title'] === 'Erste Zeile' && $blankTitle['body'] === 'Rest',
    'leere Titelzeile faellt auf die Erste-Zeile-Regel zurueck');
assert(avesmapsSocialChangelogSplit("Erste Zeile\nRest")['title'] === 'Erste Zeile',
    'und das Argument ist wahlfrei -- alte Aufrufer bleiben gueltig');

$longTitle = avesmapsSocialChangelogSplit('Text', str_repeat('x', 191));
assert($longTitle['error'] !== null, '191 Zeichen Titelzeile werden abgelehnt');
assert(mb_stripos($longTitle['error'], 'Titelzeile') !== false,
    'und die Absage nennt das FELD, nicht die erste Textzeile -- sonst sucht der Editor am falschen Ort');
assert(mb_strpos($longTitle['error'], '190') !== false && mb_strpos($longTitle['error'], '191') !== false,
    'beide Zahlen, wie ueberall');
assert(avesmapsSocialChangelogSplit('Text', str_repeat('x', 190))['error'] === null,
    'genau 190 passt');

// Der Adapter reicht sie aus dem Beitrag durch.
$viaPost = avesmapsSocialAdapterChangelog(
    ['id' => 1, 'title' => str_repeat('x', 191)], $channel, "Kurzer Text", '', ['pdo' => null]);
assert($viaPost['ok'] === false && mb_stripos((string) $viaPost['error'], 'Titelzeile') !== false,
    'der Adapter liest post[title] und gibt dessen Absage weiter');

// ---- die beiden Absagen -------------------------------------------------------------------------------

$empty = avesmapsSocialChangelogSplit("\nRumpf ohne Ueberschrift");
assert($empty['error'] !== null, 'eine leere erste Zeile ist keine Ueberschrift');
assert(mb_stripos($empty['error'], 'erste Zeile') !== false, 'und die Absage sagt, welche Zeile gemeint ist');

// 💣 `changelog_entry.title` ist VARCHAR(190). Kuerzen waere die falsche Freundlichkeit: eine stumm
// abgeschnittene Ueberschrift steht OEFFENTLICH, und niemand erfaehrt, dass etwas fehlt.
$long = avesmapsSocialChangelogSplit(str_repeat('x', 191));
assert($long['error'] !== null, '191 Zeichen Ueberschrift werden abgelehnt, nicht abgeschnitten');
assert(mb_strpos($long['error'], '190') !== false, 'die Absage nennt die Grenze');
assert(mb_strpos($long['error'], '191') !== false, 'und die tatsaechliche Laenge, damit die Differenz sichtbar ist');
assert(mb_stripos($long['error'], 'Zeilenumbruch') !== false,
    'und sie sagt, WAS zu tun ist -- eine Absage ohne Ausweg ist eine Sackgasse');
assert($long['title'] === '', 'im Fehlerfall kommt keine halbe Ueberschrift zurueck');

$exactly190 = avesmapsSocialChangelogSplit(str_repeat('x', 190));
assert($exactly190['error'] === null, 'genau 190 passt -- die Grenze ist einschliesslich');

// Umlaute zaehlen als EIN Zeichen, nicht als zwei. Bei einer Ueberschrift wie „Groesse der
// Herrschaftsgebiete Aventuriens" ist der Unterschied genau die Handvoll Zeichen, an der es scheitert.
$umlauts = avesmapsSocialChangelogSplit(str_repeat('ü', 190));
assert($umlauts['error'] === null, 'gemessen wird in Zeichen (mb_strlen), nicht in Bytes');

// ---- der Adapter ohne Datenbank -------------------------------------------------------------------------

// Faellt zu, nicht auf: ohne Verbindung wird nichts geschrieben und der Kanal meldet das als Fehler,
// statt "gesendet" zu melden.
$noPdo = avesmapsSocialAdapterChangelog(['id' => 1], $channel, "Titel\nRumpf", '');
assert($noPdo['ok'] === false, 'ohne Datenbankverbindung meldet der Adapter Misserfolg');
assert(!isset($noPdo['remote_id']), 'und liefert keine Kennung, die nach Erfolg aussieht');

// Die Absage der Ueberschrift kommt VOR der Datenbank -- sie braucht keine Verbindung, um zu greifen.
$tooLong = avesmapsSocialAdapterChangelog(['id' => 1], $channel, str_repeat('x', 191), '', ['pdo' => null]);
assert($tooLong['ok'] === false && mb_strpos((string) $tooLong['error'], '190') !== false,
    'die Ueberschriften-Absage steht vor der Verbindungspruefung');

// ---- der Seed-Riegel steht im Adapter ---------------------------------------------------------------------

// Nicht beweisbar ohne MySQL, aber die teuerste Regel der Datei: ohne diesen Aufruf schrumpft ein
// leerer Verlauf beim ersten Beitrag auf genau eine Zeile.
$source = (string) file_get_contents(__DIR__ . '/../adapters/changelog.php');
assert(str_contains($source, 'avesmapsChangelogSeedIfEmpty'),
    'avesmapsChangelogSeedIfEmpty steht im Adapter -- eine leere Tabelle faellt im Lesepfad auf die '
    . 'Saat zurueck, und ein einzelner Insert wuerde die 42 Meilensteine verdraengen');
assert(mb_strpos($source, 'avesmapsChangelogSeedIfEmpty') < mb_strpos($source, 'INSERT INTO changelog_entry'),
    'und er steht VOR dem Insert, nicht dahinter');

fwrite(STDOUT, "changelog-adapter-test: OK\n");
