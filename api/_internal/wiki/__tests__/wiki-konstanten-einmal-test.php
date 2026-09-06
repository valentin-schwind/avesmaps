<?php

declare(strict_types=1);

/**
 * 💣 EINE KONSTANTE, EINE DEFINITION -- UND DIE ZWEITE GEWINNT LAUTLOS. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/wiki/__tests__/wiki-konstanten-einmal-test.php
 *
 * ANLASS: das Fehlerprotokoll vom 02.09. bis 06.09.2026 traegt 474 Zeilen
 * „Constant AVESMAPS_WIKI_… already defined" -- drei Konstanten, jede rund 158 Mal. Sie stehen
 * zweimal im Haus: in `api/_internal/wiki/locations.php` und noch einmal im Endpunkt
 * `api/edit/wiki/sync.php`, der ZUERST geladen wird. Eine Konstante auf Dateiebene laesst sich
 * nicht `defined()`-schuetzen, also gewinnt die Kopie im Endpunkt, und die spaetere Definition
 * wird verworfen -- mit einer Warnung, die niemand liest.
 *
 * 🔴 UND DIE ZWEI FASSUNGEN WAREN NICHT GLEICH. Gemessen am 07.09.2026:
 *   - `AVESMAPS_WIKI_CATEGORY_TO_CLASS`: der Endpunkt kannte „Stadt" und „Mittlere Stadt",
 *     die Bibliothek stattdessen „Mittelgrosse Stadt".
 *   - die zwei Beschriftungstafeln: der Endpunkt kannte zusaetzlich „stadtviertel".
 * Damit las DIESELBE Wiki-Kategorie je nach Ladeweg eine andere Ortsklasse -- oder gar keine.
 * Der Live-Crawl (ueber den Endpunkt) uebersah „Mittelgrosse Stadt" vollstaendig; ein Ort dieser
 * Kategorie bekam keine Klasse, und dann RAET der Parser sie („dorf", siehe
 * `settlement_class_guessed`) -- genau die Falle, die am 17.08.2026 die Metropole Gareth zum Dorf
 * machen wollte. Der Dump-Pfad wiederum kannte „Stadt" und „Mittlere Stadt" nicht.
 *
 * ⭐ Der Kommentar im Endpunkt beschreibt diesen Mechanismus fuer eine VIERTE Konstante
 * (`AVESMAPS_WIKI_CASE_LABELS`) und hat sie deshalb schon 2026 entfernt -- die drei uebrigen blieben
 * stehen. Dieser Test verhindert die naechste Runde.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 3); // …/api/_internal/wiki/__tests__ -> …/api
$repo = dirname($wurzel);

$konstanten = [
    'AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS',
    'AVESMAPS_WIKI_CATEGORY_TO_CLASS',
    'AVESMAPS_WIKI_LOCATION_SUBTYPE_LABELS',
    // Die vierte -- sie wurde bereits einmal entdoppelt und darf nicht zurueckkommen.
    'AVESMAPS_WIKI_CASE_LABELS',
];

// ===== 1) JEDE DIESER KONSTANTEN WIRD GENAU EINMAL DEFINIERT ==================================
// ⚠️ Gesucht wird die DEFINITION (`const X = ` am Zeilenanfang oder `define('X'`), nicht jede
// Erwaehnung -- Kommentare und Leser nennen sie oft.
$dateien = [];
$verzeichnisse = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($repo, FilesystemIterator::SKIP_DOTS)
);
foreach ($verzeichnisse as $datei) {
    $pfad = str_replace('\\', '/', (string) $datei->getPathname());
    if (!str_ends_with($pfad, '.php')) {
        continue;
    }
    // Fremde Arbeitsbaeume und Abhaengigkeiten gehen uns nichts an.
    if (str_contains($pfad, '/.claude/') || str_contains($pfad, '/node_modules/')) {
        continue;
    }
    $dateien[$pfad] = str_replace("\r\n", "\n", (string) file_get_contents($pfad));
}
assert($dateien !== [], '1a: der Baum ist lesbar');

foreach ($konstanten as $name) {
    $orte = [];
    foreach ($dateien as $pfad => $quelle) {
        if (preg_match('/^\s*const\s+' . preg_quote($name, '/') . '\s*=/m', $quelle) === 1
            || preg_match('/define\(\s*[\'"]' . preg_quote($name, '/') . '[\'"]/', $quelle) === 1
        ) {
            $orte[] = substr($pfad, strlen($repo) + 1);
        }
    }

    assert(
        count($orte) === 1,
        "1b: {$name} wird " . count($orte) . ' Mal definiert (' . implode(', ', $orte)
            . ') -- eine Konstante auf Dateiebene laesst sich nicht schuetzen, die zuerst geladene '
            . 'gewinnt lautlos, und PHP warnt in ein Protokoll, das niemand liest.'
    );
    assert(
        $orte[0] === 'api/_internal/wiki/locations.php',
        "1c: {$name} gehoert in die Bibliothek, nicht in einen Endpunkt -- gefunden in {$orte[0]}"
    );
}

// ===== 2) UND DIE VEREINIGUNG HAT NICHTS VERLOREN =============================================
// 🔴 DIE SCHLUESSEL SIND EIN BESTAND, KEINE MEINUNG. Was eine der beiden Fassungen einmal
// erkannte, muss weiter erkannt werden -- sonst faellt ein Ort still in die Klassen-Raterei
// zurueck. Beide historischen Faessungen sind hier abgelegt, wie sie am 07.09.2026 im Repo
// standen, und die Zusicherung prueft die VEREINIGUNG.
require_once $wurzel . '/_internal/wiki/locations.php';

$historisch = [
    // 🔴 HIER WIRD NICHT VEREINIGT, UND DAS IST DER GANZE PUNKT DIESES ABSCHNITTS. Die Kopie im
    // Endpunkt fuehrte „Stadt" und „Mittlere Stadt" -- die es im Wiki NICHT GIBT (die Messung steht
    // seit jeher als Kommentar an der Fassung in locations.php, und sie hat meine erste Annahme
    // widerlegt: „im Zweifel beide Schluessel behalten" haette dem Crawl zwei leere, je zwanzig
    // Sekunden gedrosselte Kategorieabfragen JE LAUF eingebracht).
    // ⚠️ Was hier steht, ist deshalb die gemessene Fassung -- und die Zusicherung darunter haelt
    // ausdruecklich fest, dass die zwei erfundenen Kategorien NICHT zurueckkommen.
    'AVESMAPS_WIKI_CATEGORY_TO_CLASS' => [
        'Dorf' => 'dorf',
        'Kleinstadt' => 'kleinstadt',
        "Mittelgro\u{00DF}e Stadt" => 'stadt',
        "Gro\u{00DF}stadt" => 'grossstadt',
        "Metropole (Siedlungsgr\u{00F6}\u{00DF}e)" => 'metropole',
    ],
    'AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS' => [
        'dorf' => 'Dorf',
        'kleinstadt' => 'Kleinstadt',
        'stadt' => 'Stadt',
        "grossstadt" => "Gro\u{00DF}stadt",
        'metropole' => 'Metropole',
        "gebaeude" => "Besondere Bauwerke/St\u{00E4}tten",
        // nur der Endpunkt kannte sie
        'stadtviertel' => 'Stadtviertel',
    ],
    'AVESMAPS_WIKI_LOCATION_SUBTYPE_LABELS' => [
        'dorf' => 'Dorf',
        "gebaeude" => "Besondere Bauwerke/St\u{00E4}tten",
        'stadtviertel' => 'Stadtviertel',
        'kleinstadt' => 'Kleinstadt',
        'stadt' => 'Stadt',
        "grossstadt" => "Gro\u{00DF}stadt",
        'metropole' => 'Metropole',
    ],
];

foreach ($historisch as $name => $erwartet) {
    $heute = constant($name);
    foreach ($erwartet as $schluessel => $wert) {
        assert(
            array_key_exists($schluessel, $heute),
            "2a: {$name} hat den Schluessel \"{$schluessel}\" verloren -- eine der beiden alten "
                . 'Fassungen kannte ihn, und was einmal erkannt wurde, muss erkannt bleiben.'
        );
        assert(
            $heute[$schluessel] === $wert,
            "2b: {$name}[\"{$schluessel}\"] ist jetzt \"{$heute[$schluessel]}\" statt \"{$wert}\""
        );
    }
}

// ===== 3) DIE KATEGORIENLISTE DES CRAWLS FOLGT DER TAFEL ======================================
// ⚠️ `array_keys` DIESER Tafel ist zugleich die Liste der Kategorien, die der Crawl abfragt
// (avesmapsWikiSyncFetchSiedlungenIndexCategories). Wer einen Schluessel ergaenzt, ergaenzt einen
// gedrosselten Abruf je Lauf -- das ist der bewusst bezahlte Preis dafuer, dass beide Ladewege
// dieselben Kategorien kennen.
$kategorien = avesmapsWikiSyncFetchSiedlungenIndexCategories();
assert(
    in_array("Mittelgro\u{00DF}e Stadt", $kategorien, true),
    '3a: der Live-Crawl fragt „Mittelgrosse Stadt" ab -- er hat sie bis zum 07.09.2026 uebersehen, '
        . 'weil die Kopie im Endpunkt sie nicht kannte, und die Orte daraus fielen in die '
        . 'Klassen-Raterei'
);
// 💣 UND DIE ZWEI ERFUNDENEN KOMMEN NICHT ZURUECK. Sie kosten je Lauf eine gedrosselte Abfrage
// (zwanzig Sekunden) und liefern nichts -- „im Zweifel beide behalten" waere hier die teure
// Richtung gewesen.
foreach (['Stadt', 'Mittlere Stadt'] as $erfunden) {
    assert(
        !in_array($erfunden, $kategorien, true),
        "3b: „{$erfunden}" . '" ist keine Wiki-Kategorie und gehoert nicht in die Abfrageliste'
    );
}
assert(
    count($kategorien) === count(array_unique($kategorien)),
    '3c: keine Kategorie steht doppelt in der Abfrageliste'
);

// ===== 4) UND KEINE VIERTE KOPIE IRGENDWO SONST ===============================================
// 🔴 DIE ZUSICHERUNG, DIE DEN NAECHSTEN FAENGT. Die drei Tafeln oben waren nicht die erste
// Doppelung dieser Art -- `AVESMAPS_WIKI_CASE_LABELS` war es vor ihnen, mit demselben Schaden und
// derselben Begruendung im selben Endpunkt. Eine Regel, die nur die vier bekannten Namen prueft,
// haette keine davon vorher gefunden. Also wird der ganze Baum gezaehlt.
//
// ⚠️ Zwei Doppelungen sind ECHT und trotzdem harmlos: sie stehen je in zwei ENDPUNKTEN, und ein
// Endpunkt laedt nie einen anderen -- sie treffen sich also in keinem Request. Beide stehen
// deshalb hier mit Grund, wie im Register des Drossel-Waechters. Wer eine dritte eintraegt, muss
// dasselbe belegen koennen.
$erlaubteDoppelungen = [
    'AVESMAPS_LOCATION_SUBTYPES' => 'Zwei Endpunkte (api/app/report-location.php, api/edit/map/features.php). '
        . 'Sie laden einander nie, treffen sich also in keinem Request. Gegen das Auseinanderlaufen '
        . 'haelt ortsklassen-test.php alle fuenf Listen dieses Namens gegeneinander.',
    'AVESMAPS_WIKI_SYNC_NO_AUTO_HANDLE' => 'Zwei Endpunkte (api/edit/wiki/sync.php, '
        . 'api/edit/wiki/territories.php). Ein Schalter, den jeder Endpunkt fuer sich setzt, bevor '
        . 'er endpoint.php laedt -- er GEHOERT dorthin und laesst sich nicht teilen.',
];

$mehrfach = [];
foreach ($dateien as $pfad => $quelle) {
    // Tests duerfen Konstanten fuer ihre Fixtures anlegen -- sie laufen einzeln.
    if (str_contains($pfad, '/__tests__/')) {
        continue;
    }
    if (preg_match_all('/^\s*const\s+([A-Z][A-Z0-9_]*)\s*=/m', $quelle, $treffer) === 0) {
        continue;
    }
    foreach ($treffer[1] as $name) {
        $mehrfach[$name][substr($pfad, strlen($repo) + 1)] = true;
    }
}

foreach ($mehrfach as $name => $orte) {
    if (count($orte) < 2) {
        continue;
    }
    assert(
        array_key_exists($name, $erlaubteDoppelungen),
        "4a: {$name} wird in " . count($orte) . ' Dateien auf Dateiebene definiert ('
            . implode(', ', array_keys($orte)) . ') -- die zuerst geladene gewinnt lautlos. '
            . 'Entweder zusammenlegen, oder hier mit dem Beleg eintragen, dass die Dateien sich '
            . 'in keinem Request treffen.'
    );
}
foreach ($erlaubteDoppelungen as $name => $grund) {
    assert(trim($grund) !== '', "4b: die Ausnahme fuer {$name} traegt keinen Grund");
    assert(
        isset($mehrfach[$name]) && count($mehrfach[$name]) > 1,
        "4c: {$name} steht gar nicht mehr doppelt -- die Ausnahme verwaltet ein Gespenst und "
            . 'gehoert entfernt'
    );
}

echo 'OK  1: die vier Wiki-Tafeln werden je EINMAL definiert -- in der Bibliothek.' . "\n";
echo 'OK  2: kein Schluessel der gemessenen Fassung ist verlorengegangen.' . "\n";
echo 'OK  3: der Crawl fragt die echten Kategorien ab und keine erfundene ('
    . count($kategorien) . " Kategorien).\n";
echo 'OK  4: und im ganzen Baum steht keine weitere Konstante doppelt (ausser '
    . count($erlaubteDoppelungen) . " begruendeten, die sich nie im selben Request treffen).\n";
