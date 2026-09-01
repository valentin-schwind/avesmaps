<?php

declare(strict_types=1);

/**
 * Maschineller Wegname -- die EINE Regel, und wer sie liest.
 * =========================================================================
 * Seit 01.09.2026 haengen ZWEI Fragen an derselben Funktion, und beide sind dieselbe:
 *
 *   - die Konfliktzentrale (§6b): „kann dieser Name je einen Wiki-Artikel treffen?"
 *   - die Kartensuche (api/app/map-search.php): „hat diesen Weg ein Mensch benannt?"
 *
 * Bis dahin stand die Rechnung ZWEIMAL in PHP -- avesmapsConflictPathNameIsAuto trug sie aus,
 * und die Suche fragte gar nicht erst nach dem Namen, sondern nach dem Wiki-Link. Genau daran
 * ist der Goblinpfad gescheitert: ein von Hand angelegter Weg MIT Namen, aber ohne Artikel.
 *
 * Lauf (aus dem Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/wegname-maschinell-test.php
 */

require_once __DIR__ . '/../path-naming.php';
// rules.php statt core.php: dort steht AVESMAPS_CONFLICT_PATH_SUBTYPES, und genau dessen
// Verweis auf die kanonische Liste wird unten geprueft. core.php kommt mit.
require_once __DIR__ . '/../../conflicts/rules.php';

// ---- 1. die kanonische Wegartenliste ------------------------------------------------------------
// 💣 Sie ist der Zwilling von PATH_SUBTYPE_KEYS in js/config.js. Laufen die beiden auseinander,
// erkennt eine Seite `Gebirgspass-7` als maschinell und die andere nicht -- und der Unterschied
// ist STILL: die Suche bietet einen Treffer an, den der Browser beim Aufloesen wegwirft.
$jsQuelle = (string) file_get_contents(__DIR__ . '/../../../../js/config.js');
assert($jsQuelle !== '', 'js/config.js nicht lesbar -- Pfad verschoben?');
assert(
    preg_match('/const PATH_SUBTYPE_KEYS = \[([^\]]*)\];/', $jsQuelle, $treffer) === 1,
    'PATH_SUBTYPE_KEYS in js/config.js nicht gefunden -- umbenannt?'
);
preg_match_all('/"([^"]+)"/', $treffer[1], $jsArten);
$jsListe = $jsArten[1];
sort($jsListe, SORT_STRING);
$phpListe = AVESMAPS_PATH_SUBTYPE_KEYS;
sort($phpListe, SORT_STRING);
assert(
    $jsListe === $phpListe,
    'AVESMAPS_PATH_SUBTYPE_KEYS und PATH_SUBTYPE_KEYS (js/config.js) sind auseinandergelaufen: '
        . json_encode($phpListe, JSON_UNESCAPED_UNICODE) . ' gegen ' . json_encode($jsListe, JSON_UNESCAPED_UNICODE)
);

// Und die Konfliktzentrale fuehrt keine eigene Abschrift mehr.
assert(
    AVESMAPS_CONFLICT_PATH_SUBTYPES === AVESMAPS_PATH_SUBTYPE_KEYS,
    'AVESMAPS_CONFLICT_PATH_SUBTYPES ist wieder eine eigene Liste -- damit gibt es zwei Wahrheiten'
);

// ---- 2. die drei Muster -------------------------------------------------------------------------
// 💣 DIESE TAFEL IST DER VERTRAG mit shouldShowRoutePathDisplayName (js/routing/route-node.js).
// Sie steht Zeile fuer Zeile ebenso in js/ui/__tests__/wege-suche-manueller-name.test.js, und
// jener Test fuehrt BEIDE Fassungen ueber sie -- eine Aenderung hier ohne dort faellt dort auf.
$maschinell = [
    // Muster 1: der nackte Wegtyp. Eine Art, kein Name.
    'Weg',
    'Flussweg',
    'Reichsstrasse',
    // Muster 2: genau das, was avesmapsWikiPathNextGenericName erzeugt.
    'Reichsstrasse-4903',
    'Weg-17',
    'Gebirgspass-42',
    // Muster 3: `<wort>-<zahl>` allgemein -- der Praefix muss NICHT der Wegtyp sein.
    // "Meer-835" ist der gemessene Fall aus route-node.js: Seewege trugen die ganze Kette.
    'Meer-835',
    'Kreuzung-549',
    // Gar kein Name ist auch keiner, den jemand nachschlagen kann.
    '',
    '   ',
];
$vonHand = [
    // 🔴 Der Anlass. Ein von Hand angelegter Weg, kein Wiki-Artikel, ein Wort.
    'Goblinpfad',
    'Bernsteinroute',
    'Yasamirer Stieg',
    'Reichslandstraße von Havena nach Abilacht',
    // Ein echter Name, der eine Wegart nur ENTHAELT.
    'Alter Weg nach Gareth',
    // Die Zahl muss der GANZE Schwanz sein, nicht irgendwo stehen.
    'Weg-17 nach Gareth',
    // Ein Bindestrich ohne Zahl dahinter ist ein Name.
    'Nord-Sued-Passage',
    // ...und eine Zahl ohne Bindestrich davor auch.
    'Strasse 2',
];

foreach ($maschinell as $name) {
    assert(
        avesmapsWikiPathNameIsGeneric($name) === true,
        'maschinell erwartet, aber als Name durchgelassen: ' . var_export($name, true)
    );
}
foreach ($vonHand as $name) {
    assert(
        avesmapsWikiPathNameIsGeneric($name) === false,
        'von Hand benannt erwartet, aber als maschinell verworfen: ' . var_export($name, true)
    );
}

// ---- 3. die Konfliktzentrale ruft dieselbe Regel WIRKLICH auf -----------------------------------
// 💣 Ein gruener Test der geteilten Funktion beweist nicht, dass der zweite Leser sie benutzt.
// Geprueft wird zur LAUFZEIT ueber eine Eigenheit, die nur die geteilte Fassung hat: Muster 3.
// Eine zurueckkopierte Alt-Fassung (nur Muster 1+2) laesst "Meer-835" durch und faellt hier um.
assert(
    avesmapsConflictPathNameIsAuto('Meer-835', AVESMAPS_CONFLICT_PATH_SUBTYPES) === true,
    'avesmapsConflictPathNameIsAuto kennt Muster 3 nicht -- sie ruft die geteilte Regel nicht mehr'
);
// ...und die neun Zusicherungen von §6b gelten unveraendert weiter (conflict-core-test.php haelt sie).
assert(avesmapsConflictPathNameIsAuto('Reichsstrasse-3633', AVESMAPS_CONFLICT_PATH_SUBTYPES) === true);
assert(avesmapsConflictPathNameIsAuto('Bernsteinroute', AVESMAPS_CONFLICT_PATH_SUBTYPES) === false);
assert(avesmapsConflictPathNameIsAuto('Weg-17 nach Gareth', AVESMAPS_CONFLICT_PATH_SUBTYPES) === false);

// ---- 4. ZWEI Aufrufweisen, und der Unterschied ist Muster 1 -------------------------------------
// 🔴 Der zweite Parameter ist kein Zierrat, sondern die eigentliche Entscheidung:
//   - Die KONFLIKTZENTRALE kennt die Wegart der Zeile nicht und reicht alle acht durch -- „Weg"
//     ist dort maschinell, egal worauf es steht.
//   - Die KARTENSUCHE kennt sie und reicht NUR sie durch. Ein Pfad namens „Weg" ist deshalb ein
//     Name: die Karte zeichnet ihn (shouldShowRoutePathDisplayName misst ebenfalls gegen die
//     Wegart DIESES Wegs), und was gezeichnet wird, muss auffindbar sein.
// 🪤 Beim Bauen stand hier zuerst die volle Liste, und der Browser-Test hat es gefangen -- die
// beiden Seiten haetten sich um genau diesen Fall unterschieden, still.
assert(avesmapsWikiPathNameIsGeneric('Weg', AVESMAPS_PATH_SUBTYPE_KEYS) === true);
assert(avesmapsWikiPathNameIsGeneric('Weg', ['Pfad']) === false);
assert(avesmapsWikiPathNameIsGeneric('Weg', ['Weg']) === true);
// Muster 2 und 3 sind von der Wahl unberuehrt.
assert(avesmapsWikiPathNameIsGeneric('Weg-17', ['Pfad']) === true);
assert(avesmapsWikiPathNameIsGeneric('Meer-835', ['Pfad']) === true);
// Eine fremde Wegart bedient sich derselben Regel.
assert(avesmapsWikiPathNameIsGeneric('Karrenweg-3', ['Karrenweg']) === true);
assert(avesmapsWikiPathNameIsGeneric('Karrenweg', ['Karrenweg']) === true);
// Und ohne die Wegart im Fach faengt Muster 3 den Fall trotzdem -- die sichere Richtung.
assert(avesmapsWikiPathNameIsGeneric('Karrenweg-3', ['Weg']) === true);
assert(avesmapsWikiPathNameIsGeneric('Karrenweg', ['Weg']) === false);

echo "wegname-maschinell: alle Zusicherungen gruen\n";
