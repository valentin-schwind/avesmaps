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

/**
 * PURE: was trifft die ganze Kette?
 *
 * 🔴 UND WIRKT AUF DER ERGEBNISMENGE, NICHT AUF DER FLAECHE (Entwurf §3.1). Eine
 * ecosystem_region hat genau EIN kind und EINEN region_type -- keine Flaeche ist Wald
 * *und* Gebirge, „Wald UND Gebirge" liefert daher 0 Flaechen. Ein ORT dagegen kann in
 * beiden liegen; live sind das 22. Die 0 ist die richtige Antwort und wird nicht
 * wegdefiniert; der Editor zeigt beide Zahlen nebeneinander.
 *
 * Ausgewertet wird strikt von LINKS NACH RECHTS ohne Klammern -- dieselbe Reihenfolge wie
 * im Editor, sonst zeigt die Vorschau etwas anderes als die Infobox.
 *
 * 💣 Eine SIEDLUNG ist ein Punkt und wird gegen die Zone EINZELN geprueft, nie ueber ihre
 * Flaeche. „Teilweise in der Zone" gibt es nur bei Flaechen. Beim Finsterkamm ist das der
 * Unterschied zwischen 44 und 4.
 *
 * @param list<array<string,mixed>> $terms
 * @param list<array<string,mixed>> $areas
 * @param list<array<string,mixed>> $places
 * @param list<string> $orderedZoneKeys
 * @return array{areas: list<string>, places: list<string>}
 */
function avesmapsLoreRuleEvaluate(array $terms, array $areas, array $places, array $orderedZoneKeys): array
{
    if ($terms === []) {
        return ['areas' => [], 'places' => []];
    }

    $areaResult = null;
    $placeResult = null;

    foreach (array_values($terms) as $index => $term) {
        $termAreas = [];
        foreach ($areas as $area) {
            if (avesmapsLoreRuleTermMatchesArea($term, $area, $orderedZoneKeys)) {
                $termAreas[(string) ($area['public_id'] ?? '')] = true;
            }
        }

        $zoneKeys = avesmapsLoreRuleZoneKeys($orderedZoneKeys, $term['climate_from'] ?? null, $term['climate_to'] ?? null);
        $termPlaces = [];
        foreach ($places as $place) {
            if ($zoneKeys !== [] && !in_array((string) ($place['zone'] ?? ''), $zoneKeys, true)) {
                continue;
            }
            foreach ((array) ($place['area_public_ids'] ?? []) as $areaId) {
                if (isset($termAreas[(string) $areaId])) {
                    $termPlaces[(string) ($place['public_id'] ?? '')] = true;
                    break;
                }
            }
        }

        if ($index === 0) {
            $areaResult = $termAreas;
            $placeResult = $termPlaces;
            continue;
        }

        $join = (string) ($term['join_op'] ?? 'und');
        $areaResult = $join === 'oder' ? ($areaResult + $termAreas) : array_intersect_key($areaResult, $termAreas);
        $placeResult = $join === 'oder' ? ($placeResult + $termPlaces) : array_intersect_key($placeResult, $termPlaces);
    }

    // In der Reihenfolge der EINGABE zurueck, nicht in der des Treffens: eine Liste, die
    // je nach Bedingung anders sortiert ist, liest sich wie ein Fehler.
    $order = static function (array $rows, array $set): array {
        $out = [];
        foreach ($rows as $row) {
            $id = (string) ($row['public_id'] ?? '');
            if (isset($set[$id])) {
                $out[] = $id;
            }
        }

        return $out;
    };

    return ['areas' => $order($areas, $areaResult ?? []), 'places' => $order($places, $placeResult ?? [])];
}

/**
 * PURE: trifft diese Kette ALLES -- also gar nichts ein?
 *
 * 💣 Fix-Runde 2: eine Kette ist schon dann wertlos, wenn IRGENDEINE ihrer Bedingungen leer
 * ist, nicht erst, wenn ALLE es sind. Eine leere Bedingung trifft jede Flaeche (siehe
 * avesmapsLoreRuleTermMatchesArea: kein `area_public_id`, keine `types`, keine Klimaspanne
 * heisst "true" fuer jede Flaeche). Steht daneben eine gefuellte Bedingung mit
 * `join_op = 'oder'`, bleibt die Vereinigung trotzdem "alles" -- die gefuellte Bedingung
 * schraenkt nichts mehr ein, sie kommt nur noch OBENDRAUF. Dieses Payload kam durch den
 * ERSTEN (inline) Riegel aus Runde 1 und traf trotzdem den ganzen Bestand:
 * `[ {}, { "join_op": "oder", "area_public_id": "…" } ]`
 *
 * Und selbst mit `join_op = 'und'` ist eine leere Bedingung kein Grenzfall, sondern ein
 * Versehen: sie schraenkt nichts ein und gehoert nicht in die Kette. Deshalb genuegt EINE
 * leere Bedingung, ganz gleich mit welchem `join_op`, um die ganze Kette abzulehnen.
 *
 * Diese Funktion ist der einzige Ort, an dem der Critical-Riegel lebt -- der Endpunkt ruft
 * sie nur noch auf, statt die Schleife selbst nachzubauen (die inline im Endpunkt-Code
 * lokal ohne Datenbank+Anmeldung nicht automatisiert pruefbar war, siehe Fix-Runde 1).
 *
 * @param list<array<string,mixed>> $terms
 */
function avesmapsLoreRuleChainIsUnbounded(array $terms): bool
{
    if ($terms === []) {
        return true;
    }

    foreach ($terms as $term) {
        if (avesmapsLoreRuleTermIsEmpty($term)) {
            return true;
        }
    }

    return false;
}
