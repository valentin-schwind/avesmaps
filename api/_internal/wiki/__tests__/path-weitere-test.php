<?php

declare(strict_types=1);

// Reine Listen-Helfer der weiteren Wiki-Zuweisungen (Entwurf 2026-09-14 §2.1-§2.2).
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/path-weitere-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig, sonst prueft assert() nichts\n");
    exit(2);
}

require __DIR__ . '/../path-weitere.php';

$baerenpfad = [
    'wiki_key' => 'b-renpfad',
    'name' => 'Bärenpfad',
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/B%C3%A4renpfad',
    'art' => 'Pilgerweg',
    'kind' => 'strasse',
];
$mitHaupt = ['name' => 'Reichsstraße 2', 'wiki_path' => ['wiki_key' => 'reichsstrasse-2', 'name' => 'Reichsstraße 2']];

// Hinzufuegen
$r = avesmapsWikiPathWeitereHinzufuegen($mitHaupt, $baerenpfad);
assert($r['geaendert'] === true && $r['grund'] === '');
assert($r['properties']['wiki_path'] === $mitHaupt['wiki_path'], 'die Hauptzuweisung bleibt unberuehrt');
assert($r['properties']['name'] === 'Reichsstraße 2', 'der Name bleibt unberuehrt (E2)');
assert(avesmapsWikiPathWeitereLesen($r['properties']) === [$baerenpfad]);

assert(avesmapsWikiPathWeitereHinzufuegen($r['properties'], $baerenpfad)['grund'] === 'schon_da');
assert(avesmapsWikiPathWeitereHinzufuegen(['name' => 'Pfad-1'], $baerenpfad)['grund'] === 'ohne_hauptzuweisung');
assert(avesmapsWikiPathWeitereHinzufuegen($mitHaupt, ['wiki_key' => 'reichsstrasse-2'] + $baerenpfad)['grund'] === 'ist_hauptzuweisung');
assert(avesmapsWikiPathWeitereHinzufuegen($mitHaupt, ['wiki_key' => '  '] + $baerenpfad)['grund'] === 'ohne_schluessel');

// Entfernen
$weg = avesmapsWikiPathWeitereEntfernen($r['properties'], 'b-renpfad');
assert($weg['geaendert'] === true);
assert(($weg['properties']['wiki_path_weitere'] ?? null) === [], 'eine leer gewordene Liste bleibt als [] stehen (Nachtrag §9.2)');
assert(avesmapsWikiPathWeitereEntfernen($mitHaupt, 'b-renpfad')['grund'] === 'nicht_da');

// Neue Hauptzuweisung, die schon als weitere dastand: sie verschwindet aus der Liste
$umgehaengt = $r['properties'];
$umgehaengt['wiki_path'] = ['wiki_key' => 'b-renpfad', 'name' => 'Bärenpfad'];
assert((avesmapsWikiPathWeitereOhneHaupt($umgehaengt)['wiki_path_weitere'] ?? null) === [], 'auch ueber OhneHaupt bleibt [] stehen');
assert(avesmapsWikiPathWeitereOhneHaupt($r['properties']) === $r['properties'], 'ohne Ueberschneidung unveraendert');

// Lesen raeumt kaputte Eintraege und Dubletten weg
$kaputt = ['wiki_path_weitere' => ['x', ['wiki_key' => ''], ['wiki_key' => 'a', 'name' => 'A'], ['wiki_key' => 'a', 'name' => 'zweimal']]];
$gelesen = avesmapsWikiPathWeitereLesen($kaputt);
assert(count($gelesen) === 1 && $gelesen[0]['name'] === 'A');
assert(avesmapsWikiPathWeitereLesen(['wiki_path_weitere' => 'kein array']) === []);

// Nachtrag 15.09.2026 §9.2: `[]` gilt ueberall als „keine"
$leer = ['name' => 'Reichsstraße 2', 'wiki_path' => $mitHaupt['wiki_path'], 'wiki_path_weitere' => []];
assert(avesmapsWikiPathWeitereLesen($leer) === []);
assert(avesmapsWikiPathWeitereOhneHaupt($leer) === $leer, 'eine leere Liste bleibt, wie sie ist');
assert(avesmapsWikiPathWeitereEntfernen($leer, 'b-renpfad')['grund'] === 'nicht_da');
assert(avesmapsWikiPathWeitereHinzufuegen($leer, $baerenpfad)['properties']['wiki_path_weitere'][0]['wiki_key'] === 'b-renpfad');

// Kennungen
assert(avesmapsWikiPathWeitereIds(['a', ' a ', 'b', ''], 250) === ['a', 'b']);
$zuViele = array_map(static fn(int $i): string => 'id' . $i, range(1, 251));
foreach ([null, [], 'a', $zuViele] as $falsch) {
    $geworfen = false;
    try {
        avesmapsWikiPathWeitereIds($falsch, 250);
    } catch (RuntimeException) {
        $geworfen = true;
    }
    assert($geworfen, 'ungueltige public_ids muessen abgelehnt werden: ' . json_encode($falsch === $zuViele ? 'zu viele' : $falsch));
}

// Der Deckel ist derselbe wie der der Weg-Ebene
$features = (string) file_get_contents(__DIR__ . '/../../map/features.php');
assert(preg_match('/const AVESMAPS_PATH_GROUP_MAX_SEGMENTS = (\d+);/', $features, $treffer) === 1);
assert((int) $treffer[1] === AVESMAPS_WIKI_PATH_WEITERE_MAX_SEGMENTE, 'Deckel weicht von AVESMAPS_PATH_GROUP_MAX_SEGMENTS ab');

echo "path-weitere-test.php: ok\n";
