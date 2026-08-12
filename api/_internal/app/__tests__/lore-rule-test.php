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

echo "lore-rule: OK\n";
