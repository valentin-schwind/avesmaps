<?php

declare(strict_types=1);

/**
 * Ein Titel-Stapel muss als URL durchgehen -- nicht nur die Titel ZAEHLEN.
 *
 * 💣 DER FALL (25.08.2026): Sobald die Bot-Anmeldung stand, fragte der Lauf 500 statt 50 Titel
 * je Anfrage ab. Die stehen in der URL, durch "|" getrennt und URL-kodiert -- gut 15.000
 * Zeichen. Apaches `LimitRequestLine` liegt bei 8190. Antwort: **HTTP 414 URI Too Long**, und
 * damit stand der ganze Dump.
 *
 * 🪤 Und das Tueckische daran: der Fehler lag die ganze Zeit da. Solange die Anmeldung scheiterte,
 * waren es 50 Titel (~1.000 Zeichen) und alles passte. Die REPARATUR der Anmeldung hat ihn
 * sichtbar gemacht -- eine Fehlerklasse, die man nie beim Bauen findet, sondern erst, wenn ein
 * Nachbarteil anfaengt zu funktionieren.
 *
 * 🔴 DIE STAPELGROESSE HAT SEITHER ZWEI GRENZEN, und die kleinere gewinnt: die ZAHL (was die
 * API erlaubt: 50 anonym, 500 als Bot) und die LAENGE (was die URL traegt). Nur die Zahl zu
 * pruefen, ist genau der Bug.
 *
 * 💣 DIE WICHTIGSTE ZUSICHERUNG IST DIE UNTERSTE: ein Stapel darf NIE leer sein, solange noch
 * Titel offen sind. Ein leerer Stapel liesse den Cursor stehen, und die Phase liefe endlos --
 * bei 20 Sekunden Drossel bis zur Notbremse des Browsers nach 2000 Schritten, also ueber elf
 * Stunden.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/titel-stapel-urllaenge-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- asserts waeren wirkungslos.\n");
    exit(2);
}

require dirname(__DIR__) . '/sync.php';

/** Was die Anfrage wirklich kostet: der kodierte `titles=`-Wert. */
$kodierteLaenge = static fn(array $stapel): int => strlen(rawurlencode(implode('|', $stapel)));

// ------------------------------------------------------------- KURZE TITEL ---
// Passen bequem: dann entscheidet allein die ZAHL, genau wie vorher.
$kurz = array_map(static fn(int $i): string => "Ort {$i}", range(1, 1200));
$ersterKurz = avesmapsWikiSyncNextTitleBatch($kurz, 0, 500);
assert(count($ersterKurz) === 500, 'bei kurzen Titeln bleibt die Zahl die Grenze: ' . count($ersterKurz));
assert($ersterKurz[0] === 'Ort 1', 'und der Stapel beginnt am Offset');

$zweiterKurz = avesmapsWikiSyncNextTitleBatch($kurz, 500, 500);
assert($zweiterKurz[0] === 'Ort 501', 'der Offset wird beachtet');

// ------------------------------------------------------------- LANGE TITEL ---
// 💣 Der Fall, der live umgefallen ist: 500 Titel a ~40 Zeichen sind kodiert weit ueber 8190.
$lang = array_map(
    static fn(int $i): string => "Sehr langer Ortsname mit Zusatz (Variante {$i})",
    range(1, 500)
);
$ersterLang = avesmapsWikiSyncNextTitleBatch($lang, 0, 500);
assert(
    count($ersterLang) < 500,
    '💣 bei langen Titeln MUSS die Laenge greifen -- sonst baut der Aufrufer wieder eine URL, '
        . 'die Apache mit 414 ablehnt (bekam ' . count($ersterLang) . ' Titel)'
);
assert(
    $kodierteLaenge($ersterLang) <= AVESMAPS_WIKI_TITLE_QUERY_MAX_ENCODED,
    'der kodierte Wert muss unter der Grenze bleiben: ' . $kodierteLaenge($ersterLang)
);
// Und die Grenze selbst muss unter dem liegen, was Apache traegt (8190 fuer die GANZE
// Anfragezeile, also samt Adresse und uebrigen Parametern).
assert(
    AVESMAPS_WIKI_TITLE_QUERY_MAX_ENCODED < 8000,
    'die Grenze muss Luft fuer Adresse und uebrige Parameter lassen'
);

// ---------------------------------------------------- DER LAUF KOMMT ANS ENDE ---
// Ueber alle Stapel hinweg: jeder Titel genau einmal, kein Titel verloren.
$gesammelt = [];
$offset = 0;
$runden = 0;
while ($offset < count($lang) && $runden < 2000) {
    $stapel = avesmapsWikiSyncNextTitleBatch($lang, $offset, 500);
    assert($stapel !== [], '💣 ein leerer Stapel liesse den Cursor stehen -- die Phase liefe endlos');
    $gesammelt = array_merge($gesammelt, $stapel);
    $offset += count($stapel);
    $runden++;
}
assert($offset === count($lang), 'der Lauf muss ans Ende kommen, steht aber bei ' . $offset);
assert($gesammelt === $lang, 'jeder Titel genau einmal, in der urspruenglichen Reihenfolge');

// ------------------------------------------- EIN EINZELNER, ABSURD LANGER TITEL ---
// 🔴 Auch er muss durchgereicht werden. Ihn zu ueberspringen hiesse, einen Ort still zu
// verlieren; einen leeren Stapel zu liefern hiesse, ewig zu kreisen. Also: allein, und die
// Anfrage scheitert dann sichtbar statt lautlos.
$absurd = [str_repeat('X', AVESMAPS_WIKI_TITLE_QUERY_MAX_ENCODED + 500), 'Kurz'];
$stapelAbsurd = avesmapsWikiSyncNextTitleBatch($absurd, 0, 500);
assert(count($stapelAbsurd) === 1, 'ein uebergrosser Titel reist allein: ' . count($stapelAbsurd));
assert($stapelAbsurd[0] === $absurd[0], 'und er wird nicht uebersprungen');

// ------------------------------------------------------ UMLAUTE KOSTEN MEHR ---
// 💣 Ein Umlaut wird zu %C3%BC -- sechs Zeichen statt einem. Wer nach strlen() rechnet statt
// nach der KODIERTEN Laenge, unterschaetzt aventurische Titel systematisch.
$umlaute = array_fill(0, 500, "F\u{00FC}rstentum Kosch mit langem Zusatz");
$stapelUmlaute = avesmapsWikiSyncNextTitleBatch($umlaute, 0, 500);
assert(
    $kodierteLaenge($stapelUmlaute) <= AVESMAPS_WIKI_TITLE_QUERY_MAX_ENCODED,
    'auch mit Umlauten muss der KODIERTE Wert passen: ' . $kodierteLaenge($stapelUmlaute)
);

// ------------------------------------------------------- LEERE EINGABE ---
assert(avesmapsWikiSyncNextTitleBatch([], 0, 500) === [], 'nichts hinein, nichts heraus');
assert(avesmapsWikiSyncNextTitleBatch($kurz, 5000, 500) === [], 'ein Offset hinter dem Ende liefert nichts');

echo "titel-stapel-urllaenge: alle Zusicherungen erfuellt\n";
