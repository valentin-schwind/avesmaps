<?php

declare(strict_types=1);

// Read-only-Diagnose: findet Eltern-Herrschaftsgebiete, deren direkte Kinder UNEINHEITLICHE
// Zoom-Baender haben und den Elternteil bei einem Zoom nur TEILWEISE kacheln. Genau dort
// unterdrueckt die Frontend-Fuell-Logik (suppressFillForDisplayingChild) die Eltern-Fuellung,
// obwohl noch nicht alle Kinder anzeigen -> ungefuelltes Loch. Beispiel: Markgrafschaft Perricum
// bei Zoom 3 (Baronie Efferdstraene 3-4 zeigt an + unterdrueckt, Land Perrinmarsch 4-6 fehlt noch).
// Schreibt NICHTS. Aufruf: GET ?year_bf=1049 (optional).

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/political/territory.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf die Zoom-Deckungs-Diagnose nicht laden.');
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET ist fuer diese Diagnose erlaubt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $continent = defined('AVESMAPS_POLITICAL_DEFAULT_CONTINENT') ? AVESMAPS_POLITICAL_DEFAULT_CONTINENT : 'Aventurien';
    $yearRaw = $_GET['year_bf'] ?? null;
    $yearBf = ($yearRaw !== null && $yearRaw !== '')
        ? (int) $yearRaw
        : (defined('AVESMAPS_POLITICAL_DEFAULT_YEAR_BF') ? AVESMAPS_POLITICAL_DEFAULT_YEAR_BF : 1049);
    $zoomMin = 0;
    $zoomMax = 6;

    $nullableInt = static function ($value): ?int {
        return ($value === null || $value === '') ? null : (int) $value;
    };

    // Aktive, im Anzeigejahr gueltige Kinder mit aktivem, gueltigem Elternteil (continent wie der Layer).
    $statement = $pdo->prepare(
        'SELECT t.public_id, t.name, t.min_zoom, t.max_zoom,
                p.public_id AS parent_public_id, p.name AS parent_name,
                p.min_zoom AS parent_min_zoom, p.max_zoom AS parent_max_zoom
         FROM political_territory t
         INNER JOIN political_territory p ON p.id = t.parent_id
         WHERE t.is_active = 1 AND p.is_active = 1
           AND t.continent = :continent
           AND (t.valid_from_bf IS NULL OR t.valid_from_bf <= :year_t_from)
           AND (t.valid_to_bf IS NULL OR t.valid_to_bf = 0 OR t.valid_to_bf >= :year_t_to)
           AND (p.valid_from_bf IS NULL OR p.valid_from_bf <= :year_p_from)
           AND (p.valid_to_bf IS NULL OR p.valid_to_bf = 0 OR p.valid_to_bf >= :year_p_to)
         ORDER BY p.name ASC, t.name ASC'
    );
    $statement->bindValue(':continent', $continent);
    $statement->bindValue(':year_t_from', $yearBf, PDO::PARAM_INT);
    $statement->bindValue(':year_t_to', $yearBf, PDO::PARAM_INT);
    $statement->bindValue(':year_p_from', $yearBf, PDO::PARAM_INT);
    $statement->bindValue(':year_p_to', $yearBf, PDO::PARAM_INT);
    $statement->execute();
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

    // Nach Eltern gruppieren.
    $byParent = [];
    foreach ($rows as $row) {
        $parentKey = (string) ($row['parent_public_id'] ?? '');
        if ($parentKey === '') {
            continue;
        }
        if (!isset($byParent[$parentKey])) {
            $byParent[$parentKey] = [
                'parent_name' => (string) ($row['parent_name'] ?? ''),
                'parent_public_id' => $parentKey,
                'parent_min_zoom' => $nullableInt($row['parent_min_zoom'] ?? null),
                'parent_max_zoom' => $nullableInt($row['parent_max_zoom'] ?? null),
                'children' => [],
            ];
        }
        $byParent[$parentKey]['children'][] = [
            'name' => (string) ($row['name'] ?? ''),
            'public_id' => (string) ($row['public_id'] ?? ''),
            'min_zoom' => $nullableInt($row['min_zoom'] ?? null),
            'max_zoom' => $nullableInt($row['max_zoom'] ?? null),
        ];
    }

    // Pro Eltern: bei welchem Zoom zeigt MINDESTENS ein Kind (unterdrueckt also die Eltern-Fuellung),
    // aber MINDESTENS ein anderes Kind ist noch nicht da (sein Gebiet bleibt ungedeckt)?
    $gaps = [];
    foreach ($byParent as $parentKey => $group) {
        $children = $group['children'];
        if (count($children) < 2) {
            continue;
        }
        // Einheitliche min_zoom -> alle Kinder erscheinen gemeinsam -> kein Teil-Kacheln -> kein Loch.
        $distinctMins = [];
        foreach ($children as $child) {
            $distinctMins[$child['min_zoom'] === null ? 'null' : (string) $child['min_zoom']] = true;
        }
        if (count($distinctMins) < 2) {
            continue;
        }

        $gapZooms = [];
        for ($zoom = $zoomMin; $zoom <= $zoomMax; $zoom++) {
            $displaying = [];
            $missing = [];
            foreach ($children as $child) {
                $cMin = $child['min_zoom'];
                $cMax = $child['max_zoom'];
                $inBand = ($cMin === null || $cMin <= $zoom) && ($cMax === null || $cMax >= $zoom);
                if ($inBand) {
                    $displaying[] = $child['name'];
                } elseif ($cMin !== null && $cMin > $zoom) {
                    // Kind erscheint erst SPAETER -> sein Gebiet ist bei diesem Zoom ungedeckt.
                    $missing[] = $child['name'];
                }
            }
            if ($displaying !== [] && $missing !== []) {
                $parentMin = $group['parent_min_zoom'];
                $parentMax = $group['parent_max_zoom'];
                $parentShows = ($parentMin === null || $parentMin <= $zoom) && ($parentMax === null || $parentMax >= $zoom);
                $gapZooms[] = [
                    'zoom' => $zoom,
                    'parent_shows_here' => $parentShows,
                    'displaying' => $displaying,
                    'missing' => $missing,
                ];
            }
        }

        if ($gapZooms !== []) {
            $visible = false;
            foreach ($gapZooms as $gz) {
                if ($gz['parent_shows_here']) {
                    $visible = true;
                    break;
                }
            }
            $gaps[] = [
                'parent_name' => $group['parent_name'],
                'parent_public_id' => $parentKey,
                'parent_band' => [$group['parent_min_zoom'], $group['parent_max_zoom']],
                'visible_hole' => $visible,
                'gap_zooms' => $gapZooms,
            ];
        }
    }

    // Sichtbare Loecher (Zoom im Eltern-Band) zuerst.
    usort($gaps, static function (array $a, array $b): int {
        return ($b['visible_hole'] ? 1 : 0) <=> ($a['visible_hole'] ? 1 : 0);
    });

    avesmapsJsonResponse(200, [
        'ok' => true,
        'year_bf' => $yearBf,
        'continent' => $continent,
        'gap_parent_count' => count($gaps),
        'visible_hole_count' => count(array_filter($gaps, static fn(array $g): bool => $g['visible_hole'])),
        'gaps' => $gaps,
    ]);
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Zoom-Deckungs-Diagnose konnte nicht geladen werden.');
}
