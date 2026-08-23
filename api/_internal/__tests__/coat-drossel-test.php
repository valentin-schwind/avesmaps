<?php

declare(strict_types=1);

/**
 * Unit-Test fuer die Wappen-Drossel. Keine DB, kein HTTP. Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/coat-drossel-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 *
 * Der Vorfall, den das hier verhindert (20.-23.08.2026): `api/app/coat.php` cachte nur ERFOLGE.
 * Ein Fehlschlag hinterliess keine Spur, also holte der naechste Seitenaufbau dieselbe Adresse
 * erneut vom Wiki. Waehrend Wiki Aventurica unsere Ausgangs-IP sperrte, schlug jeder Miss fehl --
 * und jeder Editor-Reload feuerte die volle Miss-Menge (Ortsliste: Tausende Zeilen) gegen
 * `Spezial:Dateipfad`. Die Sperre hielt sich damit selbst am Leben.
 *
 * Der Test arbeitet auf einem echten Wegwerf-Verzeichnis und mit INJIZIERTER Zeit -- kein Mock und
 * kein sleep(). Nur so ist die Ablauf-Behauptung beweisbar statt behauptet.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../coat-drossel.php';

$dir = sys_get_temp_dir() . '/avesmaps-coat-drossel-test-' . bin2hex(random_bytes(4));
@mkdir($dir, 0775, true);

$a = sha1('https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/Wappen%20Ferdok.svg');
$b = sha1('https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/Auraleth%20by%20Fil.jpg');
$c = sha1('https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/AB%20A186.jpg');
$t = 1_700_000_000;

// ---- 1. Ohne Vorgeschichte darf geholt werden ------------------------------------------------
assert(avesmapsCoatDrosselDarfHolen($dir, $a, $t) === true,
    'ein unbelasteter Proxy holt -- sonst waere die Drossel ein Totalausfall');

// ---- 2. NEGATIV-CACHE: ein Fehlschlag sperrt DIESELBE Adresse ---------------------------------
avesmapsCoatDrosselFehlschlag($dir, $a, $t);
assert(avesmapsCoatDrosselDarfHolen($dir, $a, $t + 1) === false,
    'DER KERN: eine Adresse, die eben gescheitert ist, wird nicht sofort wieder geholt');
assert(avesmapsCoatDrosselDarfHolen($dir, $a, $t + AVESMAPS_COAT_FAIL_TTL - 1) === false,
    'und sie bleibt gesperrt, solange die Frist laeuft');

// ---- 3. ... aber nicht fuer immer -------------------------------------------------------------
assert(avesmapsCoatDrosselDarfHolen($dir, $a, $t + AVESMAPS_COAT_FAIL_TTL + 1) === true,
    'nach Ablauf der Frist ist ein neuer Versuch erlaubt -- sonst waere ein Aussetzer endgueltig');

// ---- 4. DIE TRAGENDE ZUSICHERUNG: der Breaker deckt AUCH UNBEKANNTE Adressen ------------------
// Ein Negativ-Cache je Adresse haette den Vorfall NICHT verhindert: die Ortsliste traegt Tausende
// VERSCHIEDENE Adressen, jede genau einmal -- das sind Tausende Erstversuche, alle gegen ein Wiki,
// das uns sperrt. Erst der globale Riegel deckelt das auf eine Handvoll Sonden.
$dir2 = $dir . '-breaker';
@mkdir($dir2, 0775, true);
for ($i = 0; $i < AVESMAPS_COAT_BREAKER_SCHWELLE; $i++) {
    avesmapsCoatDrosselFehlschlag($dir2, sha1('miss-' . $i), $t + $i);
}
assert(avesmapsCoatDrosselDarfHolen($dir2, $c, $t + 10) === false,
    'DER KERN DES VORFALLS: nach genug Fehlschlaegen geht GAR NICHTS mehr raus -- auch keine Adresse, '
    . 'die noch nie versucht wurde');

// ---- 5. Nach der Karenz genau EINE Sonde ------------------------------------------------------
$nachKarenz = $t + AVESMAPS_COAT_BREAKER_SCHWELLE + AVESMAPS_COAT_BREAKER_KARENZ + 1;
assert(avesmapsCoatDrosselDarfHolen($dir2, $c, $nachKarenz) === true,
    'nach der Karenz darf sondiert werden -- sonst kaeme der Proxy nie zurueck');
avesmapsCoatDrosselFehlschlag($dir2, $c, $nachKarenz);
assert(avesmapsCoatDrosselDarfHolen($dir2, sha1('noch-eine'), $nachKarenz + 1) === false,
    'scheitert die Sonde, ist sofort wieder zu -- nicht erst nach weiteren SCHWELLE Schlaegen');

// ---- 6. Ein Erfolg raeumt den Riegel weg ------------------------------------------------------
$nachZweiterKarenz = $nachKarenz + AVESMAPS_COAT_BREAKER_KARENZ + 1;
avesmapsCoatDrosselErfolg($dir2, $c, $nachZweiterKarenz);
assert(avesmapsCoatDrosselDarfHolen($dir2, sha1('frisch'), $nachZweiterKarenz + 1) === true,
    'antwortet das Wiki wieder, laeuft der Proxy sofort normal weiter');

// ---- 7. Alte Fehlschlaege zaehlen nicht mit ---------------------------------------------------
$dir3 = $dir . '-fenster';
@mkdir($dir3, 0775, true);
for ($i = 0; $i < AVESMAPS_COAT_BREAKER_SCHWELLE; $i++) {
    // je einer pro Fenster-Laenge -- verteilt, nie gleichzeitig
    avesmapsCoatDrosselFehlschlag($dir3, sha1('alt-' . $i), $t + $i * (AVESMAPS_COAT_BREAKER_FENSTER + 10));
}
$spaet = $t + AVESMAPS_COAT_BREAKER_SCHWELLE * (AVESMAPS_COAT_BREAKER_FENSTER + 10);
assert(avesmapsCoatDrosselDarfHolen($dir3, sha1('neu'), $spaet) === true,
    'vereinzelte Fehlschlaege ueber Stunden sind KEINE Sperre -- sonst legt ein einzelnes kaputtes '
    . 'Bild den ganzen Proxy lahm');

// ---- 8. Positivkontrolle: ein unbeschreibbares Verzeichnis darf nicht in "immer holen" kippen --
// Ohne Zustand kann die Drossel nichts merken. Sie muss dann ZU sein, nicht offen -- die sichere
// Richtung ist "kein Wappen", nie "noch ein Schlag gegen das Wiki".
assert(avesmapsCoatDrosselDarfHolen($dir . '/gibt-es-nicht/tiefer', $a, $t) === false,
    'kein schreibbarer Zustand => zu. Fail-open waere genau der Vorfall.');

// ---- Aufraeumen -------------------------------------------------------------------------------
foreach ([$dir, $dir2, $dir3] as $d) {
    foreach ((array) @glob($d . '/*') as $f) { @unlink((string) $f); }
    @rmdir($d);
}

echo "OK: coat-drossel-test -- alle Zusicherungen gehalten\n";
