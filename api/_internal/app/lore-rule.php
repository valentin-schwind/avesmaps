<?php

declare(strict_types=1);

// Was trifft eine Lebensraum-Regel? Die REINE Haelfte: Zeilen rein, Ergebnis raus.
// Kein PDO, kein DDL, keine Globals -- dieselbe Reinheitszusage wie climate-membership.php,
// und aus demselben Grund: das hier laeuft spaeter auf dem heissesten Lesepfad des Hauses.
//
// Entwurf: docs/superpowers/specs/2026-08-12-vorkommen-lebensraum-regel-design.md

/**
 * PURE: die Zonen einer Spanne, aus ihren beiden ENDPUNKTEN aufgeloest.
 *
 * 🔴 Die Spanne wird als Endpunkte gespeichert, nie als Menge. Am 03.08.2026 wurde
 * `trockene_subtropen` mit sort_order 55 nachtraeglich zwischen zwei bestehende Zonen
 * eingeschoben; eine gespeicherte Menge haette die neue Zone nicht enthalten -- still,
 * ohne Fehlermeldung, in jeder betroffenen Regel. Als Endpunkte waechst die Spanne mit.
 *
 * Ein fehlender oder unbekannter Endpunkt heisst „keine Einschraenkung", nicht „keine
 * Zone": eine Regel ohne Klimateil darf nicht versehentlich alles ausschliessen.
 *
 * @param list<string> $orderedZoneKeys Zonenschluessel in sort_order, Nord nach Sued
 * @return list<string>
 */
function avesmapsLoreRuleZoneKeys(array $orderedZoneKeys, ?string $from, ?string $to): array
{
    if ($from === null || $to === null) {
        return [];
    }
    $keys = array_values($orderedZoneKeys);
    $low = array_search($from, $keys, true);
    $high = array_search($to, $keys, true);
    if ($low === false || $high === false) {
        return [];
    }
    if ($low > $high) {
        [$low, $high] = [$high, $low];
    }

    return array_slice($keys, $low, $high - $low + 1);
}
