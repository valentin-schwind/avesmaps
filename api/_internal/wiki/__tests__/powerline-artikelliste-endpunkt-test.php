<?php

declare(strict_types=1);

/**
 * DER ABLAUF, nicht die Textprobe: dieser Test laedt genau die Dateien, die
 * api/edit/map/powerlines.php laedt, und baut damit die Vorschlagsliste des
 * Wiki-Zuweisungskastens auf. Er verlangt eine NICHT-LEERE Liste.
 *
 * Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/wiki/__tests__/powerline-artikelliste-endpunkt-test.php
 *
 * 💣 Warum es diesen Test gibt (live gemessen 16.08.2026):
 *   dump_state.problem_detail = "Error: Call to undefined function
 *   avesmapsWikiSyncNormalizeWikiTreeText()"
 * territories-parsing.php RIEF die Funktion, LUD ihre Datei (territories-tree.php) aber
 * nicht -- und der Endpunkt tat es auch nicht. Der generische catch (Throwable) im
 * Endpunkt schluckte den Fehler zu einem 'problem' => 'fehler', die Vorschlagsliste blieb
 * leer, und im Kraftlinien-Editor liess sich gar nichts zuweisen. JEDER Unit-Test war
 * gruen, weil ein Unit-Test seine Dateien selbst zusammensucht und dabei nie die Kette
 * eines Endpunkts faehrt.
 *
 * 💣 Ein Test, der prueft, ob irgendwo eine require-Zeile im Quelltext STEHT, haette das
 * nie gefunden -- er haette nur die Vermutung des Schreibers wiederholt. Deshalb:
 *   1. die Kette wird aus dem Endpunkt ABGELESEN, nicht abgeschrieben (eine abgeschriebene
 *      Liste bleibt gruen, wenn im Endpunkt eine Zeile fehlt),
 *   2. diese Datei laedt territories-tree.php NICHT selbst nach -- taete sie es, prueft
 *      sie nur noch sich selbst,
 *   3. gemessen wird die AUSGABE (Anzahl der Artikel), nicht die Anwesenheit von Zeilen.
 *
 * Der Zuschnitt ist bewusst die Vorschlagsliste allein: Datenbank, Anmeldung und
 * JSON-Huelle des Endpunkts sind hier nicht nachgebaut. Was der Test faehrt, ist der
 * Abschnitt 4 von powerlines.php -- avesmapsWikiPowerlineDesiredNestsByMatchKey samt
 * seiner Projektion auf die sieben Anzeigefelder.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- assert() waere wirkungslos.\n"
        . "Erneut fahren mit: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}

$apiRoot = dirname(__DIR__, 3); // …/api/_internal/wiki/__tests__ -> …/api
$endpointPath = $apiRoot . '/edit/map/powerlines.php';
$endpoint = (string) file_get_contents($endpointPath);
assert($endpoint !== '', 'der Endpunkt ist lesbar');

// Die Kette, wie der Endpunkt sie selbst schreibt. Die acht Zeilen des Abschnitts 4 stehen
// EINGERUECKT im try-Block, deshalb ^\s* und nicht ^.
// bootstrap.php und auth.php bleiben draussen: sie senden Kopfzeilen, starten eine Sitzung und
// lesen die Konfiguration -- in einem Testprozess ist das kein Ablauf, sondern Laerm.
preg_match_all("/^\\s*require(?:_once)? __DIR__ \\. '([^']+)';/m", $endpoint, $matches);
$chain = array_values(array_filter(
    $matches[1],
    static fn(string $path): bool => !str_contains($path, 'bootstrap.php') && !str_contains($path, '/auth.php')
));
// ⚠️ Die Schranke prueft, dass der Regex ueberhaupt etwas gefunden hat -- sie ist KEIN
// Soll-Zaehler. Auf die genaue Zahl (heute 9) festgenagelt wuerde sie beim naechsten
// aufgeraeumten require rot, obwohl die Vorschlagsliste einwandfrei steht; die Aussage
// dieses Tests ist die ARTIKELLISTE weiter unten, nicht die Laenge der Kette.
assert(count($chain) >= 5, 'die Kette wurde gefunden (' . count($chain) . ' Dateien) -- sonst prueft dieser Test nichts');

foreach ($chain as $relative) {
    $path = $apiRoot . '/edit/map/' . ltrim($relative, '/');
    assert(is_file($path), "die Kette verweist auf eine vorhandene Datei: {$relative}");
    require_once $path;
}

// Echter Auszug aus Wiki Aventurica (Basiliuslinie, geholt 22.07.2026) -- dieselbe Fixture
// wie in powerline-parsing-test.php, in der Form, die avesmapsWikiDumpSyncKindFetchRows
// liefert: normalized_title + wikitext.
$basiliuslinie = <<<'WIKI'
{{Aventurien}}
{{Spoiler|[[Borbarad-Kampagne]]}}
__TOC__
{{Infobox Kraftlinie
|Name=Basiliuslinie
|Bild={{Boximage|Basiliuslinie.png}}
|Stärke=kontinental
|Affinität=Leben und Tod
|Länge=ca. 3000 Meilen
|Regionen=Ewiges Eis, [[Firunsfinger]], [[Salamandersteine]], [[Neunaugensee]], [[Weiden|Weiden]], [[Almada]]
|Verlauf=
{{Nexus|[[Himmelsturm (Siedlung)|Himmelsturm]]|u.a. mit [[Schlüssellinie des Eises]]}}
{{Kraftlinie|[[Asainyf]]|}}
{{Nodix|[[Sala Mandra]]| |Zwei=j}}
{{Nodix|[[Nachtschattensturm]]|mit [[Hexenband]]}}
}}
Die '''Basiliuslinie''' ist eine der bekanntesten [[Kraftlinie]]n Aventuriens.

==Publikationen==
* {{Quelle|Aventurischer Almanach|S. 12}}
WIKI;

$arteriaMagica = <<<'WIKI'
{{Aventurien}}
{{Infobox Kraftlinie
|Name=Arteria Magica
|Stärke=kontinental
|Affinität=Magie
|Länge=ca. 4000 Meilen
|Regionen=[[Gareth]], [[Punin]], [[Al'Anfa]]
|Verlauf=
{{Nexus|[[Gareth]]|}}
{{Nodix|[[Punin]]|}}
}}
Die '''Arteria Magica''' ist die bekannteste [[Kraftlinie]] Aventuriens.
WIKI;

$sandboxRows = [
    ['normalized_title' => 'Basiliuslinie', 'wikitext' => $basiliuslinie],
    ['normalized_title' => 'Arteria Magica', 'wikitext' => $arteriaMagica],
    // Eine Seite ohne Kraftlinien-Infobox -- sie MUSS herausfallen, sonst misst die
    // Nicht-Leer-Zusicherung unten nur, dass ueberhaupt Zeilen hereinkamen.
    ['normalized_title' => 'Gareth', 'wikitext' => "{{Infobox Ort\n|Name=Gareth\n}}\nDie Hauptstadt."],
];

// ------------------------------------------------------------------ ABLAUF ---
// Genau der Block aus powerlines.php Abschnitt 4. Faellt die Ladekette, wirft PHP hier
// einen Error ("Call to undefined function ...") -- im Endpunkt frisst ihn der generische
// catch (Throwable) und macht daraus eine leere Liste. Hier wird er ANGEZEIGT.
$wikiArticles = [];
try {
    foreach (avesmapsWikiPowerlineDesiredNestsByMatchKey($sandboxRows) as $entry) {
        $wikiArticles[] = [
            'name' => (string) ($entry['name'] ?? ''),
            'wiki_url' => (string) ($entry['nest']['wiki_url'] ?? ''),
            'wiki_key' => (string) ($entry['nest']['wiki_key'] ?? ''),
            'staerke' => (string) ($entry['nest']['staerke'] ?? ''),
            'affinitaet' => (string) ($entry['nest']['affinitaet'] ?? ''),
            'laenge' => (string) ($entry['nest']['laenge'] ?? ''),
            'regionen' => (string) ($entry['nest']['regionen'] ?? ''),
        ];
    }
    usort($wikiArticles, static fn(array $a, array $b): int => strcmp(mb_strtolower($a['name']), mb_strtolower($b['name'])));
} catch (Throwable $exception) {
    fwrite(STDERR, "ROT: die Ladekette von {$endpointPath} ist gebrochen -- die Vorschlagsliste des\n"
        . "Kraftlinien-Editors bleibt live leer (dump_state.problem = 'fehler').\n"
        . 'Echte Meldung: ' . get_class($exception) . ': ' . $exception->getMessage() . "\n"
        . 'Geworfen in: ' . $exception->getFile() . ':' . $exception->getLine() . "\n");
    exit(1);
}

// ------------------------------------------------------------- ZUSICHERUNG ---
assert($wikiArticles !== [], 'die Vorschlagsliste ist NICHT leer -- genau das war live kaputt');
assert(count($wikiArticles) === 2, 'nur die zwei Kraftlinien-Artikel stehen drin (' . count($wikiArticles) . ')');

$names = array_column($wikiArticles, 'name');
assert($names === ['Arteria Magica', 'Basiliuslinie'], 'alphabetisch sortiert: ' . implode(' | ', $names));

// Die vier Anzeigefelder reisen mit -- sonst zeigt der Zuweisungskasten nackte Namen.
$basilius = $wikiArticles[1];
assert($basilius['staerke'] === 'kontinental', "Staerke: '{$basilius['staerke']}'");
assert($basilius['affinitaet'] === 'Leben und Tod', "Affinitaet: '{$basilius['affinitaet']}'");
assert($basilius['laenge'] === 'ca. 3000 Meilen', "Laenge: '{$basilius['laenge']}'");
assert(str_contains($basilius['regionen'], 'Firunsfinger'), "Regionen: '{$basilius['regionen']}'");
assert($basilius['wiki_key'] !== '', 'der wiki_key ist gesetzt');

echo 'powerline-artikelliste-endpunkt ok (' . count($chain) . ' Dateien der Endpunkt-Kette, '
    . count($wikiArticles) . " Artikel in der Vorschlagsliste)\n";
