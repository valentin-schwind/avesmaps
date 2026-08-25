<?php

declare(strict_types=1);

/**
 * Das Zeitfenster der Pipeline-Sperre muss den LAENGSTEN moeglichen Schritt ueberdauern.
 *
 * 💣 WORUM ES GEHT: laeuft ein Schritt laenger als AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS ohne
 * Heartbeat, gilt die Sperre als verwaist -- und ein zweiter Reiter (auch derselbe Owner, die
 * Sperre laesst ihn ausdruecklich wieder herein) uebernimmt sie und startet einen KONKURRIERENDEN
 * Lauf. Beide schreiben dann in dieselben Staging-Tabellen. Der Dateikopf von dump-lock.php
 * nennt das woertlich als die Gefahr, gegen die es die Sperre ueberhaupt gibt.
 *
 * 🪤 DIE RECHNUNG IST SCHON ZWEIMAL VERALTET. Sie stand als Kommentar da ("180 s ~= 6,4 x ein
 * gebundener Schritt von 28 s") und stimmte, solange ein Schritt eine Abfrage war. Dann kam der
 * Crawl-delay 20 der Wiki-robots.txt, dann die Bot-Anmeldung, dann die Wiederholungsleiter --
 * und aus 28 Sekunden wurden bis zu 300. Ein Kommentar altert still; diese Zusicherung nicht.
 *
 * ⚠️ Gerechnet wird gegen die HARTE Obergrenze: avesmapsWikiSyncRelaxLimits() setzt
 * set_time_limit(300). Laenger kann ein Schritt gar nicht laufen, ohne dass PHP ihn abbricht --
 * und ein abgebrochener Schritt gibt die Sperre nicht frei (der Freigabe-Zweig sitzt in einem
 * catch, das ein Fatal ueberspringt), weshalb das Fenster darueber liegen MUSS.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/sperrfenster-deckt-schritt-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- asserts waeren wirkungslos.\n");
    exit(2);
}

require dirname(__DIR__) . '/sync.php';
require dirname(__DIR__) . '/dump-lock.php';

// --- Was ein Schritt im schlimmsten Fall kostet, aus den ECHTEN Konstanten ---
// 🔴 Abgeleitet, nicht abgeschrieben: genau daran ist die alte Rechnung gestorben.
$drossel = AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS / 1000000;

// Die Wiederholungsleiter: Versuch 1..N mit wachsendem Vielfachen des Grundabstands.
$leiter = 0.0;
for ($versuch = 1; $versuch <= AVESMAPS_WIKI_REQUEST_RETRY_COUNT; $versuch++) {
    $leiter += (AVESMAPS_WIKI_REQUEST_RETRY_BASE_DELAY_MICROSECONDS * $versuch) / 1000000;
}

// Die Anmeldung kostet zwei gedrosselte Anfragen, wenn die Sitzung abgelaufen ist.
$anmeldung = 2 * $drossel;

// ⚠️ Und seit dem 25.08.2026 reserviert auch jeder Wiederholversuch seinen Platz an der
// Drossel. In aller Regel wartet er null (der Backoff ist laenger als der Abstand), im
// schlimmsten Fall aber einen vollen -- und der schlimmste Fall ist hier die Frage.
$leiterDrossel = AVESMAPS_WIKI_REQUEST_RETRY_COUNT * $drossel;

$schlimmsterSchritt = $drossel + $anmeldung + $leiter + $leiterDrossel;

// --- (a) Die harte Obergrenze eines Schritts --------------------------------
// avesmapsWikiSyncRelaxLimits() setzt set_time_limit(300). Steht das nicht mehr so da, ist
// die ganze Rechnung unten haltlos.
$relaxQuelle = (string) file_get_contents(dirname(__DIR__) . '/sync.php');
assert(
    preg_match('/function avesmapsWikiSyncRelaxLimits.*?set_time_limit\((\d+)\)/s', $relaxQuelle, $treffer) === 1,
    'avesmapsWikiSyncRelaxLimits muss eine Zeitgrenze setzen -- ohne sie gibt es keine Obergrenze'
);
$harteGrenze = (int) $treffer[1];
assert($harteGrenze > 0, 'die Zeitgrenze muss eine echte Zahl sein');

// --- (b) DIE ZUSICHERUNG ----------------------------------------------------
assert(
    AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS > $harteGrenze,
    '💣 das Sperrfenster (' . AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS . ' s) liegt NICHT ueber der '
        . 'harten Obergrenze eines Schritts (' . $harteGrenze . ' s). Ein zweiter Reiter kann die '
        . 'Sperre mitten in einem legitimen Schritt uebernehmen -- zwei gleichzeitige Laeufe, die '
        . 'sich die Staging-Tabellen ueberschreiben.'
);
assert(
    AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS > $schlimmsterSchritt,
    '💣 das Sperrfenster (' . AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS . ' s) deckt den laengsten '
        . 'gerechneten Schritt nicht (' . round($schlimmsterSchritt) . ' s = ' . $drossel
        . ' Drossel + ' . $anmeldung . ' Anmeldung + ' . $leiter . ' Wiederholungen)'
);

// --- (c) Und es darf nicht ins Absurde wachsen ------------------------------
// ⚠️ Die Gegenrichtung ist auch ein Fehler: eine WIRKLICH verwaiste Sperre muss in absehbarer
// Zeit wieder freigegeben werden, sonst blockiert ein abgestuerzter Lauf den naechsten Tag.
assert(
    AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS <= 1800,
    'eine verwaiste Sperre darf hoechstens eine halbe Stunde blockieren, steht aber auf '
        . AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS
);

// --- (d) Und der Schritt selbst darf die harte Grenze nicht sprengen --------
// 🪤 Waere der schlimmste Schritt LAENGER als set_time_limit, wuerde PHP ihn abbrechen -- und
// ein Abbruch gibt die Sperre nicht frei (der Freigabe-Zweig sitzt in einem catch, das ein
// Fatal ueberspringt). Dann haelt eine tote Sperre das Fenster lang, und das Fenster zu
// vergroessern macht es nur schlimmer. Wer die Wiederholungsleiter verlaengert, faellt hier auf.
assert(
    $schlimmsterSchritt < $harteGrenze,
    '💣 der laengste gerechnete Schritt (' . round($schlimmsterSchritt) . ' s) sprengt die harte '
        . 'Grenze von ' . $harteGrenze . ' s -- PHP braeche ihn ab, und ein Abbruch gibt die Sperre '
        . 'nicht frei. Hier hilft kein groesseres Fenster, sondern nur eine kuerzere Leiter.'
);

printf(
    "sperrfenster-deckt-schritt: Fenster %d s > laengster Schritt %d s > harte Grenze %d s -- alle Zusicherungen erfuellt\n",
    AVESMAPS_WIKI_DUMP_LOCK_STALE_SECONDS,
    (int) round($schlimmsterSchritt),
    $harteGrenze
);
