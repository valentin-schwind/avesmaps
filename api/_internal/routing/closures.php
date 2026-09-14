<?php

declare(strict_types=1);

/**
 * Der Sperrbericht: hat eine Sperre die Route veraendert -- und welche?
 *
 * Entwurf docs/superpowers/specs/2026-09-14-sperrzeiten-routing-design.md §5, Owner 14.09.2026:
 * „bei den etappen entsprechend andeuten (ein Hinweis am Anfang oder an dem Punkt in der
 * Etappenliste, dass die route sich aufgrund einer sperrung geändert hat)".
 *
 * ⭐ DER VERGLEICHSLAUF, UND WANN ER LAEUFT. Je Etappe, deren Suche eine Sperre BERUEHRT hat (`touched`
 * aus avesmapsFindClientCompatibleRoute), faehrt derselbe Dijkstra auf demselben Graphen noch einmal --
 * Zeitfenster aus, die Nebenliste der Reisemittel-Sperren dazu. Ist er billiger und benutzt er eine
 * gesperrte Kante, hat die Sperre die Route veraendert. Eine Etappe ohne Beruehrung kostet NICHTS:
 * jede billigere Route ueber eine Sperre beginnt an einem Knoten, der vor dem Ziel gesetzt wurde.
 *
 * 🔴 KEIN STILLER UMWEG UND KEINE STILLE ABSAGE. Findet die echte Suche nichts, der Vergleich aber
 * schon, steht `blocked: true` da -- der Client sagt dann den Grund, statt „Keine Route gefunden".
 *
 * ⚠️ Gerufen aus response.php und rechnet mit DEREN Dauer (avesmapsRouteDurationFromSegments). Eine
 * zweite Formel waere genau die, die beim naechsten Umbau still auseinanderlaeuft -- wer diese Datei
 * allein laedt, laedt response.php dazu (so tut es der Test).
 */

require_once __DIR__ . '/client-graph.php';
require_once __DIR__ . '/transport-season.php';
require_once __DIR__ . '/travel-calendar.php';

/**
 * @param array $legsResult Rueckgabe von avesmapsFindClientCompatibleRouteLegs (mit `legs`)
 * @return array{reports: list<array>, stats: array}
 */
function avesmapsRouteClosureReports(array $clientGraph, array $legsResult, array $request): array {
    $beginn = microtime(true);
    $stats = ['legs' => 0, 'touched' => 0, 'compared' => 0, 'reports' => 0, 'ms' => 0.0];
    $reports = [];

    $legs = is_array($legsResult['legs'] ?? null) ? $legsResult['legs'] : [];
    foreach ($legs as $legIndex => $leg) {
        if (!is_array($leg)) {
            continue;
        }
        $stats['legs']++;
        $echt = is_array($leg['result'] ?? null) ? $leg['result'] : [];
        if (empty($echt['touched'])) {
            continue;
        }
        $stats['touched']++;

        $start = (string) ($leg['from'] ?? '');
        $startStunden = (float) ($leg['start_hours'] ?? 0.0);
        $vergleich = avesmapsFindClientCompatibleRoute(
            $clientGraph,
            $start,
            (string) ($leg['to'] ?? ''),
            $request,
            ['start_hours' => $startStunden, 'ignore_closures' => true]
        );
        $stats['compared']++;
        if (empty($vergleich['found'])) {
            continue;
        }

        $echtGefunden = !empty($echt['found']);
        // Nicht billiger -> die Sperre lag im Weg, hat aber nichts veraendert.
        if ($echtGefunden && (float) ($vergleich['cost'] ?? 0.0) >= (float) ($echt['cost'] ?? 0.0) - 1e-9) {
            continue;
        }

        $umgangen = avesmapsRouteClosureAvoided($vergleich, $request, $startStunden);
        if ($umgangen === []) {
            continue;
        }

        [$abzweigKnoten, $abzweigKante] = avesmapsRouteClosureDivergence($echtGefunden ? $echt : null, $vergleich, $start);
        $reports[] = [
            'leg_index' => (int) $legIndex,
            'blocked' => !$echtGefunden,
            'diverges_at_node' => $abzweigKnoten,
            'diverges_at_edge_id' => $abzweigKante,
            'avoided' => $umgangen,
            'actual' => $echtGefunden ? avesmapsRouteClosureNumbers($echt) : null,
            'unrestricted' => avesmapsRouteClosureNumbers($vergleich),
        ];
    }

    $stats['reports'] = count($reports);
    $stats['ms'] = round((microtime(true) - $beginn) * 1000.0, 2);

    return ['reports' => $reports, 'stats' => $stats];
}

/**
 * Die gesperrten Wege, die die Vergleichsroute benutzt -- EIN Eintrag je Weg, nicht je Kante.
 *
 * 💣 DIE UHR LAEUFT HIER NOCH EINMAL ENTLANG DER VERGLEICHSROUTE, mit derselben Funktion wie im
 * Dijkstra (avesmapsRouteConnectionCalendarHours). `reached_on` ist der Tag, an dem die Reise OHNE
 * Sperre dort gewesen waere -- genau der Tag, an dem der Weg zu war.
 *
 * ⚠️ Gruppiert nach `sperr_weg.key` (dieselbe Bauform wie der Gruppenschluessel der Karte): zwei
 * Abschnitte eines Passes sind EIN Hinweis. Zeitfenster und Reisemittel-Sperre am selben Weg bleiben
 * zwei Eintraege -- es sind zwei verschiedene Gruende.
 */
function avesmapsRouteClosureAvoided(array $vergleich, array $request, float $startStunden): array {
    $departure = is_array($request['departure'] ?? null) ? $request['departure'] : null;
    $departureDay = $departure !== null ? (int) ($departure['day_of_year'] ?? 0) : 0;
    $segments = is_array($vergleich['segments'] ?? null) ? array_values($vergleich['segments']) : [];
    $nodeIds = is_array($vergleich['node_ids'] ?? null) ? array_values($vergleich['node_ids']) : [];

    $stunden = $startStunden;
    $gruppen = [];
    foreach ($segments as $index => $connection) {
        if (!is_array($connection)) {
            continue;
        }
        $grund = null;
        if (is_array($connection['sperre'] ?? null)) {
            $grund = [
                'kind' => 'transport',
                'allowed' => array_values(array_map('strval', (array) ($connection['sperre']['allowed'] ?? []))),
            ];
        } elseif ($departureDay > 0 && is_array($connection['season_window'] ?? null)) {
            $tag = avesmapsRouteClockDayOfYear($departureDay, $stunden);
            if (!avesmapsSeasonWindowContainsDay($connection['season_window'], $tag)) {
                $datum = avesmapsTravelCalendarFromDayOfYear($tag);
                $fenster = $connection['season_window'];
                $grund = [
                    'kind' => 'season',
                    'reached_on' => [
                        'month' => (string) $datum['month_key'],
                        'day' => (int) $datum['day'],
                        'nameless' => (bool) $datum['nameless'],
                    ],
                    'open_from' => ['month' => (string) $fenster['from_month'], 'day' => (int) $fenster['from_day']],
                    'open_to' => ['month' => (string) $fenster['to_month'], 'day' => (int) $fenster['to_day']],
                ];
            }
        }
        $stunden += avesmapsRouteConnectionCalendarHours($connection);
        if ($grund === null) {
            continue;
        }

        $weg = is_array($connection['sperr_weg'] ?? null) ? $connection['sperr_weg'] : [];
        $schluessel = (string) ($weg['key'] ?? ('kante:' . ($connection['id'] ?? $index))) . '|' . $grund['kind'];
        if (!isset($gruppen[$schluessel])) {
            $gruppen[$schluessel] = [
                'kind' => $grund['kind'],
                'path_name' => (string) ($weg['name'] ?? ''),
                'public_ids' => [],
                'subtype' => (string) ($weg['subtype'] ?? ($connection['route_type'] ?? '')),
                'transport' => (string) ($connection['transport_option'] ?? ''),
                // In REISErichtung: Etappe i laeuft von node_ids[i] nach node_ids[i+1].
                'from_node' => (string) ($nodeIds[$index] ?? ($connection['from'] ?? '')),
            ] + array_diff_key($grund, ['kind' => true]);
        }
        $publicId = (string) ($connection['public_id'] ?? '');
        if ($publicId !== '' && !in_array($publicId, $gruppen[$schluessel]['public_ids'], true)) {
            $gruppen[$schluessel]['public_ids'][] = $publicId;
        }
    }

    return array_values($gruppen);
}

/**
 * Wo verlaesst die echte Route die ungesperrte? Die erste Kante, an der sich beide unterscheiden.
 *
 * ⭐ Die KANTE, nicht nur der Knoten: der Knoten kann „Kreuzung-2480" oder ein Anker sein, und nach dem
 * Verschmelzen der Etappen im Reiseplan gibt es ihn nicht mehr. Die Kante findet der Client in seinen
 * Segmenten wieder (`properties.id`).
 *
 * @return array{0: string, 1: string} [Knoten, Kanten-ID]; ohne echte Route [Start, '']
 */
function avesmapsRouteClosureDivergence(?array $echt, array $vergleich, string $start): array {
    if ($echt === null) {
        return [$start, ''];
    }
    $echtKanten = array_values(is_array($echt['edge_ids'] ?? null) ? $echt['edge_ids'] : []);
    $echtKnoten = array_values(is_array($echt['node_ids'] ?? null) ? $echt['node_ids'] : []);
    $vergleichKanten = array_values(is_array($vergleich['edge_ids'] ?? null) ? $vergleich['edge_ids'] : []);

    $i = 0;
    $n = min(count($echtKanten), count($vergleichKanten));
    while ($i < $n && (string) $echtKanten[$i] === (string) $vergleichKanten[$i]) {
        $i++;
    }

    return [(string) ($echtKnoten[$i] ?? $start), (string) ($echtKanten[$i] ?? '')];
}

/** Strecke und Dauer einer Etappe -- mit DERSELBEN Rechnung wie `duration` der Antwort. */
function avesmapsRouteClosureNumbers(array $ergebnis): array {
    $etappen = avesmapsBuildClientRouteDiagnosticSegments(
        is_array($ergebnis['segments'] ?? null) ? $ergebnis['segments'] : [],
        is_array($ergebnis['node_ids'] ?? null) ? $ergebnis['node_ids'] : []
    );
    $dauer = avesmapsRouteDurationFromSegments($etappen);

    return [
        'distance_units' => round(array_sum(array_map(static fn (array $etappe): float => (float) ($etappe['distance_units'] ?? 0.0), $etappen)), 4),
        'travel_hours' => round((float) ($dauer['travel_hours'] ?? 0.0), 2),
        'travel_days' => round((float) ($dauer['travel_days'] ?? 0.0), 4),
    ];
}
