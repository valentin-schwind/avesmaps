<?php

declare(strict_types=1);

/**
 * Die ZWEI Wappen-Schalter nach Herkunft (Mockup docs/wappen-verwaltung-mockup.html, 23.08.2026).
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/app/__tests__/coat-zwei-schalter-test.php
 *
 * 🔴 Sie loesen die zwei ALTEN Schalter ab, deren Achse die OBJEKTART war (Ort / Territorium).
 * Neue Achse: HERKUNFT (eigener Upload / Wiki), und sie gelten beiden Objektarten GEMEINSAM --
 * ein Notaus fuer rechtliche Fragen, der nur die Haelfte abschaltet, ist keiner.
 *
 * 💣 Die gefaehrlichste Stelle ist die ERBSCHAFT: wer „Wappen: AUS" gedrueckt hat, darf durch
 * einen Umbau nicht wieder Wappen sehen. Ein neuer Schluessel ohne Wert erbt deshalb die
 * STRENGERE der beiden alten Stellungen.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'. Neu starten mit: "
        . "php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

$WURZEL = dirname(__DIR__, 4);
require_once $WURZEL . '/api/_internal/app/coat-display.php';
require_once $WURZEL . '/api/_internal/coat-url.php';

// ---- 1. DIE ERBSCHAFT -- die sichere Richtung ist AUS -----------------------------------------
// Argumente: (neuer Wert, alter Ort-Schalter, alter Territorien-Schalter).
assert(avesmapsCoatSchalterAusWerten('1', '0', '0') === true,
    'ein gesetzter neuer Wert gewinnt, egal was die alten sagen');
assert(avesmapsCoatSchalterAusWerten('0', '1', '1') === false, 'auch andersherum');
assert(avesmapsCoatSchalterAusWerten('', '1', '1') === true, 'ohne neuen Wert: beide alten an -> an');
assert(avesmapsCoatSchalterAusWerten('', '0', '1') === false,
    'DER KERN VON TEIL 1: stand EINER der alten auf AUS, erbt der neue AUS. Ein Umbau darf ein '
    . 'gedruecktes Notaus nicht aufheben.');
assert(avesmapsCoatSchalterAusWerten('', '1', '0') === false, 'dasselbe fuer den anderen alten');
assert(avesmapsCoatSchalterAusWerten('', '0', '0') === false, 'beide aus -> aus');

// ---- 2. DIE HERKUNFT entscheidet, welcher Schalter greift -------------------------------------
assert(avesmapsCoatHerkunftErlaubt('own', true, false) === true, 'eigener Upload haengt am lokalen Schalter');
assert(avesmapsCoatHerkunftErlaubt('own', false, true) === false, 'und nur an ihm');
assert(avesmapsCoatHerkunftErlaubt('wiki', false, true) === true, 'ein Wiki-Wappen am Wiki-Schalter');
assert(avesmapsCoatHerkunftErlaubt('wiki', true, false) === false, 'und nur an ihm');

// 💣 Eine UNBEKANNTE Herkunft gilt als 'wiki', nicht als 'own' -- die sichere Richtung. Ein falsch
// als „von uns" eingestuftes Wiki-Wappen umgeht den Schalter, der aus rechtlichen Gruenden
// gedrueckt wurde; andersherum wird nur zu viel versteckt.
assert(avesmapsCoatHerkunftErlaubt('', true, false) === false,
    'DER KERN VON TEIL 2: unbekannte Herkunft folgt dem WIKI-Schalter, nicht dem lokalen');
assert(avesmapsCoatHerkunftErlaubt('irgendwas', true, false) === false, 'auch bei Unfug');

// ---- 3. Die Aufloesung sagt, WOHER das Wappen kommt -------------------------------------------
// 🔴 Genau hier ist die Herkunft bekannt, weil diese Funktion zwischen den drei Quellen waehlt.
// Eine zweite Stelle, die sie nachtraeglich erraet, waere die zweite Wahrheit aus AGENTS.md §5.
$pd = 'public_domain';
$eigen = avesmapsResolveGatedCoat([], '/uploads/wappen/own/x.png', 'https://wiki/y.png', $pd);
assert($eigen['herkunft'] === 'own', 'ein eigener Upload ist "own"');
assert(strpos($eigen['url'], '/uploads/wappen/own/x.png') === 0, 'und seine Adresse gewinnt');

$ausWiki = avesmapsResolveGatedCoat([], '', 'https://wiki/y.png', $pd);
assert($ausWiki['herkunft'] === 'wiki', 'ohne eigenen Upload kommt es aus dem Wiki');

$override = avesmapsResolveGatedCoat(['coat_of_arms_url' => '/uploads/wappen/o.png'], '', 'https://wiki/y.png', $pd);
assert($override['herkunft'] === 'own',
    'DER KERN VON TEIL 3: ein Override ist eine Entscheidung von UNS -- also "own", auch wenn '
    . 'daneben ein Wiki-Wert steht');

// ⚠️ Kein Wappen heisst KEINE Herkunft -- sonst haengt ein leerer Wert an einem der zwei Schalter
// und verschwindet oder erscheint je nach Stellung.
$leer = avesmapsResolveGatedCoat([], '', '', $pd);
assert($leer['url'] === '' && $leer['herkunft'] === '', 'ohne Wappen gibt es auch keine Herkunft');

// 🔴 Der Lizenzriegel bleibt VOR allem anderen: eine nicht gemeinfreie Datei ist leer, egal woher
// sie kaeme (NOTICE.md). Die Schalter sind eine Anzeigefrage, der Riegel eine Rechtsfrage.
$gesperrt = avesmapsResolveGatedCoat([], '/uploads/wappen/own/x.png', '', 'unknown');
assert($gesperrt['url'] === '' && $gesperrt['herkunft'] === '',
    'DER KERN: der public-domain-Riegel steht vor der Herkunftsfrage');

// ---- 4. Der Wrapper und die Regel sind DIESELBE Rechnung --------------------------------------
// ⚠️ `avesmapsResolveGatedCoatUrl` hat vier Leser im Haus. Liefe er auf einer eigenen Kopie der
// Regel, waere das die Divergenz, gegen die der Umbau gebaut ist.
foreach ([
    [[], '/uploads/a.png', 'https://wiki/b.png', $pd],
    [[], '', 'https://wiki/b.png', $pd],
    [['coat_of_arms_url' => '/uploads/c.png'], '', '', $pd],
    [[], '', '', $pd],
    [[], '/uploads/a.png', '', 'unknown'],
] as [$ov, $own, $staging, $lic]) {
    assert(avesmapsResolveGatedCoatUrl($ov, $own, $staging, $lic)
        === avesmapsResolveGatedCoat($ov, $own, $staging, $lic)['url'],
        'DER KERN VON TEIL 4: der Wrapper liefert genau die url der einen Rechnung');
}

// ---- 5. Der Kartenpfad benutzt die Herkunft wirklich ------------------------------------------
// 💣 Eine gruene Regel, die niemand ruft, beweist nichts. Der Ort liest coat.source, das
// Territorium die Herkunft aus derselben Aufloesung -- beide muessen durch
// avesmapsCoatHerkunftErlaubt gehen.
$mf = (string) file_get_contents($WURZEL . '/api/app/map-features.php');
$code = (string) preg_replace('#^\s*//.*$#m', '', (string) preg_replace('#/\*.*?\*/#s', '', $mf));
assert(substr_count($code, 'avesmapsCoatHerkunftErlaubt(') === 2,
    'DER KERN VON TEIL 5: BEIDE Ausgabestellen (Ort und Territorium) fragen nach der Herkunft, '
    . 'gefunden: ' . substr_count($code, 'avesmapsCoatHerkunftErlaubt('));
assert(strpos($code, "\$properties['coat']['source']") !== false,
    'der Ort nimmt die Herkunft aus coat.source');
assert(strpos($code, 'avesmapsSettlementTerritoryCoat(') !== false,
    'das Territorium nimmt sie aus der Aufloesung, statt sie zu erraten');

// ---- 6. Der Schreibweg raeumt BEIDE Zwischenspeicher ------------------------------------------
// 💣 map-features haengt an der Kartenrevision, der POLITISCHE LAYER an einem eigenen
// 300-Sekunden-Dateicache. Ein Schalter, der nur den halben Cache raeumt, wirkt fuenf Minuten lang
// nur auf der halben Karte -- dieselbe halb greifende Regel, die heute schon zweimal aufgefallen ist.
$cd = (string) file_get_contents($WURZEL . '/api/_internal/app/coat-display.php');
$setter = substr($cd, (int) strpos($cd, 'function avesmapsSetCoatSchalter'));
$setter = substr($setter, 0, (int) strpos($setter, 'return ['));
assert(strpos($setter, 'avesmapsFrontendSchalterRevisionHeben') !== false,
    'der Schreibweg hebt die Kartenrevision');
// 💣 Der AUFRUF, nicht der blosse Name: der steht auch im `function_exists`-Guard daneben, und
// eine Namenssuche laeuft deshalb durch, wenn nur der Aufruf entfernt wird -- gemessen. Dritte
// trivial erfuellte Zusicherung dieser Bauart an einem Tag.
assert(strpos($setter, 'avesmapsPoliticalInvalidateLayerCache();') !== false,
    'DER KERN VON TEIL 6: er raeumt auch den Cache des politischen Layers');
// 🪤 GRENZE DIESER ZUSICHERUNG, damit sie niemand fuer mehr haelt, als sie ist: sie prueft die
// ANWESENHEIT des Aufrufs, nicht seine ERREICHBARKEIT. Eine Mutation, die ihn in ein `if (false)`
// legt, laeuft hier durch -- gemessen. Eine Quelltextpruefung kann das nicht sehen; wer die Stelle
// umbaut, muss den Cache selbst nachmessen.

// ---- 7. Beide Endpunkte bieten die GEMEINSAME Aktion an ---------------------------------------
// 🔴 Owner: „Bei Territorien und Siedlungen erwarte ich vollständig dasselbe aussehen und
// verhalten." Zwei getrennte Aktionen waeren zwei Wahrheiten ueber denselben Schalter.
foreach (['/api/edit/wiki/settlements.php', '/api/edit/wiki/sync-monitor.php'] as $endpunkt) {
    $quelle = (string) file_get_contents($WURZEL . $endpunkt);
    assert(strpos($quelle, "'set_coat_switch'") !== false,
        "DER KERN VON TEIL 7: $endpunkt kennt die gemeinsame Aktion set_coat_switch");
    assert(strpos($quelle, 'avesmapsSetCoatSchalter(') !== false,
        "$endpunkt ruft denselben Schreibweg");
}

echo "OK: coat-zwei-schalter-test -- alle Zusicherungen gehalten\n";
