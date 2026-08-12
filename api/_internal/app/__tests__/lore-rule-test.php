<?php

declare(strict_types=1);

// Die reine Haelfte der Lebensraum-Regel. Kein PDO, keine Tabellen -- alles, was hier
// steht, ist ohne Datenbank beweisbar. Entwurf:
// docs/superpowers/specs/2026-08-12-vorkommen-lebensraum-regel-design.md

require_once __DIR__ . '/../lore-rule.php';

// Die acht Zonen in ihrer sort_order, Nord nach Sued (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED).
$zones = ['polar', 'subpolar', 'boreal', 'gemaessigt', 'subtropen_winterfeucht',
    'trockene_subtropen', 'subtropisch', 'tropisch'];

assert(avesmapsLoreRuleZoneKeys($zones, 'boreal', 'gemaessigt') === ['boreal', 'gemaessigt']);
assert(avesmapsLoreRuleZoneKeys($zones, 'gemaessigt', 'boreal') === ['boreal', 'gemaessigt']);
assert(avesmapsLoreRuleZoneKeys($zones, 'boreal', 'boreal') === ['boreal']);
assert(avesmapsLoreRuleZoneKeys($zones, null, 'boreal') === []);
assert(avesmapsLoreRuleZoneKeys($zones, 'boreal', null) === []);
assert(avesmapsLoreRuleZoneKeys($zones, 'gibtesnicht', 'boreal') === []);

// 💣 DER FALL, DER DIE ENDPUNKT-SPEICHERUNG BEGRUENDET: am 03.08.2026 wurde
// `trockene_subtropen` mit sort_order 55 nachtraeglich ZWISCHEN zwei bestehende Zonen
// eingeschoben. Eine als Menge gespeicherte Spanne haette sie still verpasst.
$mit = ['polar', 'subpolar', 'boreal', 'NEUE_ZONE', 'gemaessigt', 'subtropen_winterfeucht',
    'trockene_subtropen', 'subtropisch', 'tropisch'];
assert(avesmapsLoreRuleZoneKeys($mit, 'boreal', 'gemaessigt') === ['boreal', 'NEUE_ZONE', 'gemaessigt']);

$farindel = ['public_id' => 'a1', 'kind' => 'vegetation', 'region_type' => 'wald', 'zones' => ['gemaessigt']];
$finster  = ['public_id' => 'a2', 'kind' => 'topographie', 'region_type' => 'gebirge', 'zones' => ['boreal', 'gemaessigt']];
$alkra    = ['public_id' => 'a3', 'kind' => 'vegetation', 'region_type' => 'wald', 'zones' => ['subtropen_winterfeucht']];

$term = static fn (array $overrides = []): array => array_merge(
    ['area_public_id' => null, 'types' => [], 'climate_from' => null, 'climate_to' => null],
    $overrides
);

// Leere Bedingung trifft alles -- und sagt das auch ueber sich selbst.
assert(avesmapsLoreRuleTermIsEmpty($term()) === true);
assert(avesmapsLoreRuleTermMatchesArea($term(), $farindel, $zones) === true);

// Art allein.
$wald = $term(['types' => [['kind' => 'vegetation', 'region_type' => 'wald']]]);
assert(avesmapsLoreRuleTermIsEmpty($wald) === false);
assert(avesmapsLoreRuleTermMatchesArea($wald, $farindel, $zones) === true);
assert(avesmapsLoreRuleTermMatchesArea($wald, $finster, $zones) === false);

// Mehrere Arten sind ein ODER.
$waldOderGebirge = $term(['types' => [
    ['kind' => 'vegetation', 'region_type' => 'wald'],
    ['kind' => 'topographie', 'region_type' => 'gebirge'],
]]);
assert(avesmapsLoreRuleTermMatchesArea($waldOderGebirge, $finster, $zones) === true);

// Art UND Klima. Der Alkrawald ist ein Wald, aber im falschen Band.
$nordwald = $term([
    'types' => [['kind' => 'vegetation', 'region_type' => 'wald']],
    'climate_from' => 'boreal', 'climate_to' => 'gemaessigt',
]);
assert(avesmapsLoreRuleTermMatchesArea($nordwald, $farindel, $zones) === true);
assert(avesmapsLoreRuleTermMatchesArea($nordwald, $alkra, $zones) === false);

// 💣 Eine FLAECHE genuegt, wenn sie die Zone BERUEHRT -- der Finsterkamm liegt in zwei.
$boreal = $term(['climate_from' => 'boreal', 'climate_to' => 'boreal']);
assert(avesmapsLoreRuleTermMatchesArea($boreal, $finster, $zones) === true);
assert(avesmapsLoreRuleTermMatchesArea($boreal, $farindel, $zones) === false);

// 💣 IDENTITAET IST DIE public_id, NIE DER NAME. Live tragen fuenf Namen doppelt, vier
// davon ueber Ebenen hinweg ("Noerdlicher Eisenwald" ist Gebirge UND Wald).
$genau = $term(['area_public_id' => 'a1']);
assert(avesmapsLoreRuleTermMatchesArea($genau, $farindel, $zones) === true);
assert(avesmapsLoreRuleTermMatchesArea($genau, $finster, $zones) === false);

// 💣 ODER haengt der Treffer am ersten Element? Bedingung: [wald, gebirge], Flaeche: wald.
// Wenn die Schleife $hit bei jeder Iteration zuruecksetzen wuerde, waere nur der letzte Treffer
// (gebirge) entscheidend und die Waldfläche würde nicht treffen.
$waldAmAnfang = $term(['types' => [
    ['kind' => 'vegetation', 'region_type' => 'wald'],
    ['kind' => 'topographie', 'region_type' => 'gebirge'],
]]);
assert(avesmapsLoreRuleTermMatchesArea($waldAmAnfang, $farindel, $zones) === true);
assert(avesmapsLoreRuleTermMatchesArea($waldAmAnfang, $alkra, $zones) === true);
// Negativfall: Flaeche passt zu KEINEM der Typen.
assert(avesmapsLoreRuleTermMatchesArea($waldAmAnfang, ['public_id' => 'x', 'kind' => 'topographie', 'region_type' => 'steppe', 'zones' => []], $zones) === false);

// 💣 Entkopplung: kind und region_type sind UNABHAENGIG. Eine Fläche mit kind=topographie,
// region_type=wald existiert nicht live, aber die Bedingung muss BEIDE Felder prüfen, nicht nur
// eines. Eine Bedingung (vegetation, wald) darf diese Fläche nicht treffen.
$topographieWald = ['public_id' => 'x', 'kind' => 'topographie', 'region_type' => 'wald', 'zones' => []];
$vegetationWald = $term(['types' => [['kind' => 'vegetation', 'region_type' => 'wald']]]);
assert(avesmapsLoreRuleTermMatchesArea($vegetationWald, $topographieWald, $zones) === false);

// Zwei Waelder, ein Gebirge -- und ein Ort, der in Wald UND Gebirge liegt ("Bergwald").
$areas = [$farindel, $finster, $alkra];
$places = [
    ['public_id' => 'p1', 'area_public_ids' => ['a1'], 'zone' => 'gemaessigt'],          // nur im Wald
    ['public_id' => 'p2', 'area_public_ids' => ['a1', 'a2'], 'zone' => 'gemaessigt'],    // Wald UND Gebirge
    ['public_id' => 'p3', 'area_public_ids' => ['a2'], 'zone' => 'boreal'],              // nur Gebirge, Nordteil
    ['public_id' => 'p4', 'area_public_ids' => ['a3'], 'zone' => 'subtropen_winterfeucht'],
];
$ids = static fn (array $out, string $bucket): array => $out[$bucket];

$waldTerm = $term(['types' => [['kind' => 'vegetation', 'region_type' => 'wald']],
    'climate_from' => 'boreal', 'climate_to' => 'gemaessigt', 'join_op' => 'und']);
$gebirgeTerm = $term(['types' => [['kind' => 'topographie', 'region_type' => 'gebirge']], 'join_op' => 'und']);

// EINE Bedingung.
$nur = avesmapsLoreRuleEvaluate([$waldTerm], $areas, $places, $zones);
assert($ids($nur, 'areas') === ['a1']);
assert($ids($nur, 'places') === ['p1', 'p2']);

// 💣 UND WIRKT AUF DER ERGEBNISMENGE. Keine Flaeche ist Wald UND Gebirge -- eine
// ecosystem_region hat genau ein kind und einen region_type. Ein ORT kann in beiden liegen.
$und = avesmapsLoreRuleEvaluate([$waldTerm, $gebirgeTerm], $areas, $places, $zones);
assert($ids($und, 'areas') === []);
assert($ids($und, 'places') === ['p2']);

// ODER vereinigt.
$oder = avesmapsLoreRuleEvaluate([$waldTerm, $term(['types' => [['kind' => 'topographie', 'region_type' => 'gebirge']], 'join_op' => 'oder'])], $areas, $places, $zones);
assert($ids($oder, 'areas') === ['a1', 'a2']);
assert($ids($oder, 'places') === ['p1', 'p2', 'p3']);

// 💣 EINE SIEDLUNG IST EIN PUNKT: sie zaehlt nur, wenn sie SELBST in der Zone liegt --
// auch wenn ihre Flaeche die Zone bloss beruehrt. Der Finsterkamm beruehrt boreal und
// gemaessigt; „Gebirge + boreal" nimmt davon nur p3, nicht p2.
$gebirgeBoreal = $term(['types' => [['kind' => 'topographie', 'region_type' => 'gebirge']],
    'climate_from' => 'boreal', 'climate_to' => 'boreal', 'join_op' => 'und']);
$schnitt = avesmapsLoreRuleEvaluate([$gebirgeBoreal], $areas, $places, $zones);
assert($ids($schnitt, 'areas') === ['a2']);
assert($ids($schnitt, 'places') === ['p3']);

// Von links nach rechts, ohne Klammern: (Wald UND Gebirge) ODER Alkrawald.
$alkraTerm = $term(['area_public_id' => 'a3', 'join_op' => 'oder']);
$kette = avesmapsLoreRuleEvaluate([$waldTerm, $gebirgeTerm, $alkraTerm], $areas, $places, $zones);
assert($ids($kette, 'areas') === ['a3']);
assert($ids($kette, 'places') === ['p2', 'p4']);

// Keine Bedingung -> nichts. Der Aufrufer bekommt eine leere Antwort, keine Ausnahme.
assert(avesmapsLoreRuleEvaluate([], $areas, $places, $zones) === ['areas' => [], 'places' => []]);

echo "lore-rule: OK\n";
