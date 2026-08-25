<?php

declare(strict_types=1);

/**
 * KEIN NEST DER KARTENNUTZLAST GIBT EINE WIKI-BILDADRESSE IN DEN BROWSER.
 *
 * 🔴 Die Regel ist alt („unsere Platte oder nichts", Owner 23.08.2026); neu ist, dass sie an
 * einer VIERTEN Stelle gebraucht wird. `avesmapsNormalizeLegacyMapFeatureProperties` filterte
 * drei Nests -- `wiki_settlement.wappen_url`, `wiki_region.image_url`, `wiki_path.image_url` --
 * und die Liste war GEMESSEN, nicht hergeleitet: am 23.08.2026 trug `properties.coat.url` keine
 * Wiki-Adresse, weil dort sonst ein eigener Upload oder die lokalisierte Kopie steht.
 *
 * 💣 AM 25.08.2026 TRUG ER SIE DOCH. „Hole Wiki-Wappen" schreibt ZUERST den Wiki-Stand in
 * `properties.coat` und holt die Bilder DANACH; dazwischen liegt ein Zustand mit einer
 * Wiki-Adresse im Nest. Live gemessen an dem Abend: 80 Stueck, 30 binnen Minuten lokalisiert,
 * 50 stehengeblieben -- und die 50 waren KAPUTTE BILDER, weil der Browser jede `http(s)`-Adresse
 * durch `coat.php` reicht und das seit demselben Tag eine Spezialseite abweist.
 *
 * ⚠️ WAS DIESER TEST KANN UND WAS NICHT -- und das gehoert hierher, weil die erste Fassung mehr
 * versprochen hat, als sie haelt. Abschnitt 1 versucht die Liste HERZULEITEN: er sucht im Bauer
 * jedes Feld, das nach einer Bildadresse aussieht. Gemessen findet er davon **zwei** -- denn die
 * Nests kommen aus dem `properties_json` der Datenbank und stehen nirgends literal im Quelltext.
 * Er faengt also nur den Fall, in dem jemand ein Bildfeld IM BAUER anfasst und den Filter
 * vergisst; einen Nest, der still aus den Daten kommt, sieht er nicht.
 *
 * 🔴 Die tragende Zusicherung ist deshalb Abschnitt 2 (die vier Nests namentlich) plus
 * Abschnitt 3 (der Leser vertraegt eine geleerte Adresse). Wer einen fuenften Nest entdeckt,
 * traegt ihn dort ein -- und findet ihn, wie am 25.08.2026, an der LIVE-Nutzlast, nicht hier.
 *
 * Kein HTTP, keine Datenbank: gelesen wird der QUELLTEXT. `map-features.php` fuehrt beim Laden
 * seine Arbeit aus (Top-Level `try`), laesst sich also nicht requiren.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 api/app/__tests__/wappen-ausgabe-nests-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 3); // __tests__ -> app -> api -> <Repo>
$quelle = (string) file_get_contents($wurzel . '/api/app/map-features.php');
assert($quelle !== '', 'map-features.php nicht lesbar.');

/** Die Paare, die der Filter heute bindet. */
$filterListe = [];
if (preg_match('/foreach \(\[(\[.*?\])\] as \[\$nest, \$feld\]\)/s', $quelle, $treffer) === 1) {
    preg_match_all("/\\['(\\w+)', '(\\w+)'\\]/", $treffer[1], $paare, PREG_SET_ORDER);
    foreach ($paare as $paar) {
        $filterListe[$paar[1] . '.' . $paar[2]] = true;
    }
}
assert($filterListe !== [], 'Die Filterschleife wurde im Quelltext nicht gefunden -- umgebaut?');

// ---------------------------------------------------------------------------
// 1) Jedes Bildfeld, das der Bauer anfasst, muss gefiltert sein.
// ---------------------------------------------------------------------------

// Gesucht wird `$properties['<nest>']['<feld>']`, wobei <feld> nach einer Adresse aussieht.
// ⚠️ Bewusst weit gefasst (url|image): lieber ein Feld zu viel begruenden als eines uebersehen.
preg_match_all(
    '/\$properties\[\'(\w+)\'\]\[\'(\w*(?:url|image)\w*)\'\]/i',
    $quelle,
    $funde,
    PREG_SET_ORDER
);

$beruehrt = [];
foreach ($funde as $fund) {
    $beruehrt[$fund[1] . '.' . $fund[2]] = true;
}

// 🔴 Begruendete Ausnahmen: Felder, die KEINE Bildadresse tragen. Der Grund steht dabei, damit
// niemand hier still etwas eintraegt, um den Test gruen zu bekommen.
$ausnahmen = [
    // `wiki_url` ist die HERKUNFT (welcher Artikel/welche Datei), kein <img src>. Der Browser
    // holt sie nie; sie zu leeren naehme dem Editor die Nachvollziehbarkeit.
    'coat.wiki_url' => 'Herkunftsangabe, wird nie als Bild geladen',
];

$ungefiltert = [];
foreach (array_keys($beruehrt) as $feld) {
    if (!isset($filterListe[$feld]) && !isset($ausnahmen[$feld])) {
        $ungefiltert[] = $feld;
    }
}

assert(
    $ungefiltert === [],
    '1: Bildfeld ohne Filter: ' . implode(', ', $ungefiltert)
        . ' -- entweder in die Filterschleife aufnehmen oder mit Begruendung als Ausnahme '
        . 'eintragen. Eine Adresse, die wir selbst nicht abrufen, gehoert nicht in den Browser.'
);

foreach ($ausnahmen as $feld => $grund) {
    assert(trim($grund) !== '', "1: Ausnahme fuer {$feld} ohne Begruendung.");
}

// ---------------------------------------------------------------------------
// 2) Der Nest, an dem es am 25.08.2026 gefehlt hat -- namentlich festgehalten.
// ---------------------------------------------------------------------------

// ⚠️ Abschnitt 1 leitet her und faengt den naechsten Fall; diese Zeile haelt den bekannten fest,
// damit ein Umbau der Herleitung ihn nicht stillschweigend mitnimmt.
assert(
    isset($filterListe['coat.url']),
    '2: properties.coat.url ist nicht gefiltert -- genau die 50 kaputten Wappen vom 25.08.2026.'
);
foreach (['wiki_settlement.wappen_url', 'wiki_region.image_url', 'wiki_path.image_url'] as $bekannt) {
    assert(isset($filterListe[$bekannt]), "2: {$bekannt} ist aus dem Filter gefallen.");
}

// ---------------------------------------------------------------------------
// 3) Und der Leser vertraegt die LEERE Adresse.
// ---------------------------------------------------------------------------

// 💣 Ohne diese Zusicherung ist das Filtern gefaehrlicher als das Nichtfiltern: eine geleerte
// Adresse als `<img src="">` war der kaputte Anblick, der am 23.08.2026 die Ruecknahme des
// ganzen Filters ausgeloest hat. Der Leser muss ohne Adresse GAR KEIN <img> zeichnen.
$popups = (string) file_get_contents($wurzel . '/js/ui/popups.js');
$start = strpos($popups, 'function settlementCoatIconMarkup');
assert($start !== false, '3: settlementCoatIconMarkup nicht gefunden.');
$kopf = substr($popups, $start, 260);
assert(
    preg_match('/if\s*\(!coat\s*\|\|\s*!coat\.url\)\s*\{\s*return\s*"";/', $kopf) === 1,
    '3: der Leser faengt die leere Adresse nicht ab -- eine gefilterte Adresse wuerde dann als '
        . '<img src=""> gezeichnet, also als kaputtes Bild. Genau daran ist der Filter schon '
        . 'einmal gescheitert.'
);

// ---------------------------------------------------------------------------
// 4) Gegenprobe: die Zusicherungen leben.
// ---------------------------------------------------------------------------

// 🪤 Abschnitt 2 liest eine Liste, die eine Regex aus dem Quelltext zieht. Greift die Regex
// daneben, ist die Liste leer -- und `isset()` auf einer leeren Liste ist einfach false, der Test
// waere also rot statt trivial gruen. Der gefaehrlichere Fall ist umgekehrt: eine Regex, die zu
// viel einsammelt und jeden Namen zu finden scheint. Deshalb hier zwei Proben.
assert(
    !isset($filterListe['gibt_es_nicht.url']),
    '4: die Filterliste meldet einen Nest, den es nicht gibt -- die Regex sammelt zu viel ein.'
);

$ohneCoat = preg_replace("/, \\['coat', 'url'\\]/", '', $quelle, 1) ?? $quelle;
assert($ohneCoat !== $quelle, '4: die Mutation ist gar nicht angekommen.');
$listeOhne = [];
if (preg_match('/foreach \(\[(\[.*?\])\] as \[\$nest, \$feld\]\)/s', $ohneCoat, $t2) === 1) {
    preg_match_all("/\\['(\\w+)', '(\\w+)'\\]/", $t2[1], $p2, PREG_SET_ORDER);
    foreach ($p2 as $paar) {
        $listeOhne[$paar[1] . '.' . $paar[2]] = true;
    }
}
assert(
    $listeOhne !== [] && !isset($listeOhne['coat.url']),
    '4: die Zusicherung aus Abschnitt 2 ueberlebt das Entfernen des Eintrags -- sie prueft nicht, '
        . 'was sie zu pruefen vorgibt.'
);

printf(
    "OK -- %d Bildfelder im Bauer gefunden, %d Nests gefiltert, %d begruendet ausgenommen; der Leser vertraegt Leere.\n",
    count($beruehrt),
    count($filterListe),
    count($ausnahmen)
);
