<?php

declare(strict_types=1);

/**
 * Test der Einstellungsregeln der Kurvenbeschriftung. Keine DB, kein HTTP.
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/app/__tests__/curve-label-store-test.php
 *
 * Warum diese Regeln einen Test verdienen und keinen Kommentar: beide scheitern LEISE.
 *  - Eine fehlende Einstellung als „an" zu lesen aendert 657 Labels auf einen Schlag.
 *  - Ein Winkel von 360 Grad ist sichtbar 0 und numerisch nicht -- roh geprueft schaltet die
 *    Umstellregel dort eine Kurve ein, wo niemand etwas gedreht haben wollte.
 */

require_once __DIR__ . '/../curve-label-store.php';

// ------------------------------------------------------------------ DIE EINSTELLUNG ---

// 🔴 Fehlt der Schluessel, ist die Kurvenbeschriftung AUS. Ein leeres properties_json darf niemals
// 657 Labels umstellen.
$vorgabe = avesmapsCurveLabelSettingsFromProperties(null);
assert($vorgabe === ['enabled' => false, 'max_labels' => 1]);
assert(avesmapsCurveLabelSettingsFromProperties([]) === ['enabled' => false, 'max_labels' => 1]);

// Gesetzte Werte kommen durch.
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => 2])
    === ['enabled' => true, 'max_labels' => 2]);

// 🔴 Der Deckel ist 3 (Owner 22.08.2026), und er wird geklemmt statt abgelehnt.
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => 9])['max_labels'] === 3);
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => 0])['max_labels'] === 1);
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => -4])['max_labels'] === 1);

// Unsinn im JSON kippt nicht auf „an".
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => 'vielleicht'])['enabled'] === false);
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => 1])['enabled'] === true);
assert(avesmapsCurveLabelSettingsFromProperties(['curve_label' => true, 'curve_label_max' => 'zwei'])['max_labels'] === 1);

// ------------------------------------------------------------------ DIE UMSTELLREGEL ---

// Rotation 0 ueberall -> bleibt aus. Das sind 601 der 657 Labels; sie duerfen sich am Umstelltag
// nicht um ein Pixel bewegen.
assert(avesmapsCurveLabelRolloutFor([0]) === ['enabled' => false, 'max_labels' => 1]);
assert(avesmapsCurveLabelRolloutFor([0, 0, 0]) === ['enabled' => false, 'max_labels' => 3]);

// Eine echte Drehung schaltet ein.
assert(avesmapsCurveLabelRolloutFor([326])['enabled'] === true);

// 💣 360 Grad ist sichtbar 0. Genau ein Label im Livebestand hat das: „Weiden", das einzige
// gedrehte derographische. Roh geprueft bekaeme es eine Kurve, obwohl dort niemand etwas gedreht
// haben wollte.
assert(avesmapsCurveLabelRolloutFor([360])['enabled'] === false);
assert(avesmapsCurveLabelRolloutFor([720])['enabled'] === false);
assert(avesmapsCurveLabelRolloutFor([-360])['enabled'] === false);
assert(avesmapsCurveLabelRolloutFor([-90])['enabled'] === true);

// 🔴 Die Anzahl ist „so viele Labels wie vorhanden, hoechstens 3" -- nicht fest 1. Fuenf gedrehte
// Regionen tragen heute zwei Labels; auf 1 gesetzt verloeren sie einen Namen.
assert(avesmapsCurveLabelRolloutFor([300, 300]) === ['enabled' => true, 'max_labels' => 2]);
assert(avesmapsCurveLabelRolloutFor([317, 325]) === ['enabled' => true, 'max_labels' => 2]);
assert(avesmapsCurveLabelRolloutFor([10, 20, 30, 40]) === ['enabled' => true, 'max_labels' => 3]);

// Eine Region ohne Label ergibt keine Umstellung.
assert(avesmapsCurveLabelRolloutFor([]) === ['enabled' => false, 'max_labels' => 1]);

echo "curve-label-store tests passed\n";
