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

echo "lore-rule: OK\n";
