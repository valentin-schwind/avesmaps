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

/**
 * PURE: hat diese Bedingung ueberhaupt eine Einschraenkung?
 *
 * 💣 Eine Regel, deren Bedingungen alle leer sind, trifft ALLES. Das ist keine Regel,
 * sondern ein Versehen -- der Schreibpfad lehnt sie ab (Task 6), und zwar serverseitig,
 * nicht nur am ausgegrauten Knopf.
 */
function avesmapsLoreRuleTermIsEmpty(array $term): bool
{
    return ($term['area_public_id'] ?? null) === null
        && ($term['types'] ?? []) === []
        && ($term['climate_from'] ?? null) === null;
}

/**
 * PURE: trifft diese Bedingung diese Flaeche?
 *
 * Die drei Felder sind drei verschiedene Fragen an dasselbe Ding und daher UND-verknuepft:
 * „heisst so" (Identitaet) · „ist von dieser Art" (mehrere = ODER) · „liegt in dieser Zone".
 * Ein leeres Feld fragt nicht.
 *
 * ⚠️ `$area['zones']` sind die Zonen, die die Flaeche BERUEHRT (>= 5 % Anteil, dieselbe
 * Schwelle wie die Infobox-Zeile). Fuer eine Flaeche genuegt das Beruehren -- die Aussage
 * ist „hier waechst es", nicht „hier waechst es ueberall". Fuer eine SIEDLUNG gilt das
 * NICHT, siehe avesmapsLoreRuleEvaluate.
 *
 * @param list<string> $orderedZoneKeys
 */
function avesmapsLoreRuleTermMatchesArea(array $term, array $area, array $orderedZoneKeys): bool
{
    $wanted = $term['area_public_id'] ?? null;
    if ($wanted !== null && (string) ($area['public_id'] ?? '') !== $wanted) {
        return false;
    }

    $types = $term['types'] ?? [];
    if ($types !== []) {
        $kind = (string) ($area['kind'] ?? '');
        $regionType = (string) ($area['region_type'] ?? '');
        $hit = false;
        foreach ($types as $type) {
            if ((string) ($type['kind'] ?? '') === $kind && (string) ($type['region_type'] ?? '') === $regionType) {
                $hit = true;
                break;
            }
        }
        if (!$hit) {
            return false;
        }
    }

    $zoneKeys = avesmapsLoreRuleZoneKeys($orderedZoneKeys, $term['climate_from'] ?? null, $term['climate_to'] ?? null);
    if ($zoneKeys !== [] && array_intersect($zoneKeys, (array) ($area['zones'] ?? [])) === []) {
        return false;
    }

    return true;
}
