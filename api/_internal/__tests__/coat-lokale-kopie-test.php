<?php

declare(strict_types=1);

/**
 * avesmapsCoatLokaleKopie -- die lokale Kopie einer Wiki-Bildadresse, oder nichts. Kein Netz,
 * keine DB. Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/coat-lokale-kopie-test.php
 *
 * Der Test baut ein echtes Wegwerf-DOCUMENT_ROOT mit echten Dateien darin -- nur so ist die
 * Behauptung "sie schaut auf der Platte nach" beweisbar statt gemockt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'. Neu starten mit: "
        . "php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../coat-url.php';

$root = sys_get_temp_dir() . '/avesmaps-coat-lokal-' . bin2hex(random_bytes(4));
@mkdir($root . '/uploads/wappen/cache', 0775, true);
$_SERVER['DOCUMENT_ROOT'] = $root;

$wiki = 'https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/Wappen%20Gareth%20Stadt%201.%20Var%203.png';

// ---- 1. Ohne Datei: NICHTS -- und ausdruecklich nicht die Wiki-Adresse ------------------------
$ohne = avesmapsCoatLokaleKopie($wiki);
assert($ohne === '',
    'DER KERN: haben wir das Bild nicht, wird NICHTS geliefert. Der alte Rueckfall auf die '
    . 'Wiki-Adresse ist genau das, was die Sperre unserer Ausgangs-IP ausgeloest hat.');
assert(strpos($ohne, 'wiki-aventurica') === false, 'und ganz sicher keine Wiki-Adresse');

// ---- 2. Mit Datei: die statische lokale Adresse, kein Proxy ------------------------------------
$key = sha1($wiki);
file_put_contents($root . '/uploads/wappen/cache/' . $key . '.png', 'PNG');
$mit = avesmapsCoatLokaleKopie($wiki);
assert($mit === '/uploads/wappen/cache/' . $key . '.png',
    'liegt es bei uns, kommt die lokale Adresse zurueck');
assert(strpos($mit, 'coat.php') === false,
    'und zwar STATISCH -- kein coat.php, also keine Anfrage je Bild und Seitenaufbau');

// ---- 3. 💣 DER SCHLUESSEL MUSS DEM IN api/app/coat.php GLEICHEN --------------------------------
// Laeuft er auseinander, findet diese Funktion nie etwas, liefert ueberall '' und die Wappen
// verschwinden -- lautlos, ohne einen einzigen Fehler. Deshalb wird die Bildung hier gegen die
// echte Quelle von coat.php geprueft, nicht gegen eine Kopie der Regel.
$coatPhp = (string) file_get_contents(__DIR__ . '/../../app/coat.php');
assert(strpos($coatPhp, '$key = sha1($url);') !== false,
    'coat.php bildet den Cache-Schluessel weiterhin als sha1($url) -- sonst hier nachziehen');
assert(strpos($coatPhp, "'/uploads/wappen/cache'") !== false,
    'und legt ihn weiterhin unter /uploads/wappen/cache ab');

// ---- 4. Alles, was nicht das Wiki ist, bleibt unberuehrt ---------------------------------------
assert(avesmapsCoatLokaleKopie('/uploads/wappen/eigen-custom.png') === '/uploads/wappen/eigen-custom.png',
    'ein eigener Upload geht unveraendert durch');
assert(avesmapsCoatLokaleKopie('https://ulisses-spiele.de/x.png') === 'https://ulisses-spiele.de/x.png',
    'ein fremder Host bleibt, wie er ist -- der Riegel gilt dem Wiki, nicht dem Internet');
assert(avesmapsCoatLokaleKopie('') === '', 'Leer bleibt leer');

// 💣 Suffix-Grenze: `stripos` haette hier true gesagt.
assert(avesmapsCoatLokaleKopie('https://wiki-aventurica.de.angreifer.example/x.png')
    === 'https://wiki-aventurica.de.angreifer.example/x.png',
    'ein Host, der den Namen nur ENTHAELT, ist nicht das Wiki');

// ---- 5. Alle Bildformate des Caches, nicht nur PNG ---------------------------------------------
$svgUrl = 'https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/Bath%20Molokh.svg';
file_put_contents($root . '/uploads/wappen/cache/' . sha1($svgUrl) . '.svg', '<svg/>');
assert(avesmapsCoatLokaleKopie($svgUrl) === '/uploads/wappen/cache/' . sha1($svgUrl) . '.svg',
    'auch SVG -- die Zwergenreich-Wappen liegen genau so da');

foreach ((array) @scandir($root . '/uploads/wappen/cache') as $f) {
    if ($f !== '.' && $f !== '..') { @unlink($root . '/uploads/wappen/cache/' . $f); }
}
echo "OK: coat-lokale-kopie-test -- alle Zusicherungen gehalten\n";
