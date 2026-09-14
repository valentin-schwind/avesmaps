<?php

declare(strict_types=1);

// Kartensuche: Treffer aus weiteren Wiki-Zuweisungen (Entwurf 2026-09-14 §2.4). map-search.php ist ein
// Endpunkt und laesst sich nicht einbinden -- die Funktionen werden per Tokenizer herausgeschnitten.
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 api/app/__tests__/wege-suche-weitere-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig\n");
    exit(2);
}

$quelle = (string) file_get_contents(__DIR__ . '/../map-search.php');

function schneideFunktion(string $quelle, string $name): string {
    $start = strpos($quelle, "\nfunction $name(");
    assert($start !== false, "$name nicht gefunden");
    $tiefe = 0;
    $offen = false;
    for ($i = strpos($quelle, '{', $start); $i < strlen($quelle); $i++) {
        if ($quelle[$i] === '{') { $tiefe++; $offen = true; }
        if ($quelle[$i] === '}' && --$tiefe === 0 && $offen) {
            return substr($quelle, $start, $i - $start + 1);
        }
    }
    throw new RuntimeException("$name nicht geschlossen");
}

function avesmapsDecodeJsonColumnForSearch(mixed $wert): array { return is_string($wert) ? (json_decode($wert, true) ?: []) : []; }
function avesmapsNormalizeSingleLine(string $wert, int $laenge): string { return mb_substr(trim($wert), 0, $laenge); }
function avesmapsPathSearchTypeLabel(string $subtype): string { return $subtype; }

foreach (['avesmapsBuildSearchResult', 'avesmapsExtendSearchResultBounds', 'avesmapsBuildSearchWeitereEntries', 'avesmapsSearchMergePathEntry'] as $name) {
    eval(schneideFunktion($quelle, $name));
}

$zeile = [
    'public_id' => 'rs-7', 'feature_type' => 'path', 'feature_subtype' => 'Reichsstrasse',
    'min_x' => 1, 'min_y' => 2, 'max_x' => 3, 'max_y' => 4,
    'properties_json' => json_encode([
        'wiki_path' => ['wiki_key' => 'reichsstrasse-2', 'name' => 'Reichsstraße 2'],
        'wiki_path_weitere' => [['wiki_key' => 'b-renpfad', 'name' => 'Bärenpfad'], ['wiki_key' => '', 'name' => 'leer'], 'kaputt'],
    ]),
];

$weitere = avesmapsBuildSearchWeitereEntries($zeile);
assert(count($weitere) === 1);
assert($weitere[0]['name'] === 'Bärenpfad' && $weitere[0]['wiki_key'] === 'b-renpfad', json_encode($weitere[0]));
assert($weitere[0]['group_key'] === 'weitere:b-renpfad' && $weitere[0]['kind'] === 'path' && $weitere[0]['public_ids'] === ['rs-7']);
assert(avesmapsBuildSearchWeitereEntries(['feature_type' => 'location', 'properties_json' => $zeile['properties_json']]) === []);
assert(avesmapsBuildSearchWeitereEntries(['feature_type' => 'path', 'properties_json' => '{"wiki_path":{}}']) === [], 'ohne Liste nichts');

$gruppen = [];
avesmapsSearchMergePathEntry($gruppen, $weitere[0], 30);
$zweiter = $weitere[0];
$zweiter['public_id'] = 'rs-8';
$zweiter['min_x'] = -5;
avesmapsSearchMergePathEntry($gruppen, $zweiter, 10);
assert(count($gruppen) === 1 && $gruppen['weitere:b-renpfad']['public_ids'] === ['rs-7', 'rs-8']);
assert($gruppen['weitere:b-renpfad']['score'] === 10 && $gruppen['weitere:b-renpfad']['min_x'] === -5.0);

// Der Haupttreffer traegt seinen Schluessel; die Zeilenschleife nutzt beide Wege.
$hauptZweig = schneideFunktion($quelle, 'avesmapsBuildSearchEntry');
assert(preg_match("/'wiki_key'\s*=>\s*\(string\)\s*\(\\\$wikiPath\['wiki_key'\] \?\? ''\)/", $hauptZweig) === 1, 'der Haupttreffer traegt wiki_key');
assert(str_contains($quelle, 'foreach (avesmapsBuildSearchWeitereEntries($row) as $weiterer)'));
assert(substr_count($quelle, 'avesmapsSearchMergePathEntry($pathGroups') === 2, 'Haupt- und weiterer Treffer laufen durch denselben Zusammenfuehrer');

echo "wege-suche-weitere-test.php: ok\n";
