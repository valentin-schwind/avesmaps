<?php

declare(strict_types=1);

/**
 * Characterization + regression test for the template-aware Verlauf station
 * extraction (avesmapsWikiPathExtractVerlaufStations, api/_internal/wiki/paths.php).
 *
 * Wiki Verlauf fields are structured route tables: the FIRST positional param of a
 * row template is the station ON the way; later params are branch/crossing targets
 * of FOREIGN ways and must never enter the station chain (owner report 2026-07-05:
 * Reichsstrasse 3 routed via Winhall/Herzogenfurt because crossing targets leaked in).
 * River rows add tributaries (Zufluss/Zusammenfluss) that are rivers, not stations.
 *
 * Run:
 *     php -d extension=mbstring tools/paths/test-path-verlauf-parser.php
 */

require __DIR__ . '/../../api/_internal/wiki/sync.php';
require __DIR__ . '/../../api/_internal/wiki/sync-monitor.php';
require __DIR__ . '/../../api/_internal/wiki/territories-parsing.php';
require __DIR__ . '/../../api/_internal/political/territory.php';
require __DIR__ . '/../../api/_internal/wiki/paths.php';

$failures = 0;
$total = 0;
function check(string $label, $actual, $expected): void {
    global $failures, $total;
    $total++;
    if ($actual !== $expected) {
        $failures++;
        echo "FAIL  {$label}\n      actual:   " . var_export($actual, true) . "\n      expected: " . var_export($expected, true) . "\n";
    } else {
        echo "ok    {$label}\n";
    }
}

// --- Road rows (Reichsstrasse 3 shapes) ---

$road = <<<'WT'
{{Anschluss|[[Phecadistieg]]}}
{{Straße|[[Elenvina]]}}
{{Abzweigung rechts|[[Zinnen am Ratsforst]]|[[Schattengrundpass]]|Zwei=j}}
{{Abzweigung links|[[Klippag]]|Weg nach [[Altenfurt]]}}
{{Abzweigung links| |Weg nach Osten}}
{{Flussquerung|[[Rodasch]]}}
{{Kreuzung|[[Honingen]]|Straßen nach [[Herzogenfurt]] und [[Winhall]]|Zwei=j}}
{{Straße|[[Lyngwyn (Honingen)|Lyngwyn]]}}
{{Pass|[[Greifenpass]]}}
{{Hafen|[[Perricum]]|[[Perlenmeer]]}}
WT;
check(
    'road rows keep only on-route stations',
    avesmapsWikiPathExtractVerlaufStations($road),
    ['Elenvina', 'Zinnen am Ratsforst', 'Klippag', 'Honingen', 'Lyngwyn', 'Greifenpass', 'Perricum']
);

// --- River rows (Der Grosse Fluss shapes) ---

$river = <<<'WT'
{{Zusammenfluss|[[Ange]] und [[Breite]]}}
{{Fluss|[[Oberangbar]]}}
{{Straßenquerung|[[Reichsstraße 3]]|[[Steinbrücken]]}}
{{Zufluss rechts|[[Raller]]}}
{{Zufluss links|[[Hils]]}}
{{Fluss|''[[Burg Draustein]]''}}
{{Fluss|Feste [[Calbrozim]]}}
{{Flussmündung|[[Meer der Sieben Winde]]|[[Havena (Siedlung)|Havena]]}}
WT;
check(
    'river rows drop tributaries, take crossing/mouth places',
    avesmapsWikiPathExtractVerlaufStations($river),
    ['Oberangbar', 'Steinbrücken', 'Burg Draustein', 'Calbrozim', 'Havena']
);

// --- Fallback: no row templates => all plain links (previous behaviour) ---

check(
    'plain link prose falls back to all links',
    avesmapsWikiPathExtractVerlaufStations('Der Weg führt von [[Punin]] über [[Ragath]] nach [[Kuslik]].'),
    ['Punin', 'Ragath', 'Kuslik']
);

// --- Robustness ---

check('empty input', avesmapsWikiPathExtractVerlaufStations(''), []);
check(
    'namespace links are skipped',
    avesmapsWikiPathExtractVerlaufStations('{{Straße|[[Datei:Karte.png]]}} {{Straße|[[Gareth]]}}'),
    ['Gareth']
);
check(
    'unknown row template defaults to first param',
    avesmapsWikiPathExtractVerlaufStations('{{Furt|[[Gratenfels]]|Weg nach [[Winhall]]}}'),
    ['Gratenfels']
);
check(
    'duplicates collapse to first occurrence',
    avesmapsWikiPathExtractVerlaufStations("{{Straße|[[Gareth]]}}\n{{Pass|[[Greifenpass]]}}\n{{Straße|[[Gareth]]}}"),
    ['Gareth', 'Greifenpass']
);
check(
    'named params never contribute stations',
    avesmapsWikiPathExtractVerlaufStations('{{Kreuzung|[[Gareth]]|[[Reichsstraße 2]]|Zwei=j}}'),
    ['Gareth']
);

// --- ParsePage integration: long chains survive (cap raised to 60) ---

$rows = [];
for ($i = 1; $i <= 45; $i++) {
    $rows[] = '{{Straße|[[Ort' . $i . ']]}}';
}
$wikitext = "{{Infobox Straße\n|Name=Testweg\n|Verlauf=" . implode("\n", $rows) . "\n}}";
$parsed = avesmapsWikiPathParsePage('Testweg', $wikitext, 'Testweg', '', '');
check('parse keeps 45 stations (old cap was 30)', substr_count((string) $parsed['record']['verlauf'], "\u{2192}"), 44);
check('parse first station', str_starts_with((string) $parsed['record']['verlauf'], 'Ort1 '), true);

echo "\n" . ($total - $failures) . '/' . $total . " checks passed\n";
exit($failures === 0 ? 0 : 1);
