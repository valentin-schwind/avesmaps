<?php

declare(strict_types=1);

/**
 * „Huelle ohne Quelle" -- EINE Rechnung, geteilt.
 *
 * 💣 Scanner (geometry_inventory), Bulk-Knopf (purge_unassigned_geometries) und die Hart/Weich-
 * Weiche beim Loeschen fragen ALLE hier. Drei Kopien derselben Regel driften auseinander, und
 * dann zeigt die Liste etwas anderes, als der Knopf loescht -- genau der Fehler, der diese
 * Baustelle ueberhaupt erzeugt hat (der Bulk-Knopf ging an der vorhandenen Ketten-Regel vorbei).
 *
 * 💣 Eine Huelle lebt von den Flaechen ihres GEBIETS UND SEINER NACHFAHREN. Wer nur das Gebiet
 * fragt, erklaert jedes Aggregat zum Geist: am Livebestand vom 16.08.2026 waren das 111 von 114.
 *
 * 🔴 UND SIE LEBT VON DENSELBEN QUELLEN, DIE DER LAYER SIEHT -- nicht von weniger. Das Praedikat
 * rechnete bis 16.08.2026 nur ueber `parent_id`, der Layer kennt dazu den Wiki-Zweig und den
 * Selbst-Rueckfall (avesmapsPoliticalCollectDerivedLayerSourceTerritoryIds). Eine Huelle, deren
 * Quellen nur ueber den Wiki-Zweig zu finden sind, war im Editor zu Recht inert -- und stand
 * trotzdem in der Waisenliste, wo sie HART geloescht wurde. Ein unumkehrbares Loeschen darf nie
 * auf einer strengeren Rechnung stehen als der, nach der die Karte urteilt. Deshalb wird der
 * Sammler des Layers GERUFEN und nicht nachgebaut.
 */

// Die Datei traegt ihre Abhaengigkeiten selbst: bis 16.08.2026 lieferte sie nur der Endpunkt, und
// der erste Aufrufer, der ausschliesslich diese Datei einband, waere fatal gelaufen.
require_once __DIR__ . '/territory.php';
require_once __DIR__ . '/territories-read.php';
require_once __DIR__ . '/territories-derived-geometry-shared.php';
require_once __DIR__ . '/territories-derived-geometry.php';
require_once __DIR__ . '/territories-derived-layer.php';

function avesmapsPoliticalFetchTerritoryIdsWithActiveGeometry(PDO $pdo): array {
    $statement = $pdo->query(
        'SELECT DISTINCT geometry.territory_id
        FROM political_territory_geometry geometry
        INNER JOIN political_territory territory ON territory.id = geometry.territory_id
        WHERE geometry.is_active = 1
            AND territory.is_active = 1'
    );
    if ($statement === false) {
        return [];
    }

    $ids = [];
    foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $territoryId) {
        $ids[(int) $territoryId] = true;
    }

    return $ids;
}

/**
 * JEDE Zeile in political_territory -- ohne is_active, ohne Kontinent -- auf ihre Wiki-Zeile.
 *
 * 💣 Zwei Fragen in einer Abfrage, und beide sind tragend:
 *  - Existiert die Zeile ueberhaupt? Nur DAS heisst „dangling". Der Rechenschnappschuss
 *    (avesmapsPoliticalFetchDerivedGeometrySourceTerritories) filtert auf is_active = 1 UND
 *    continent = Aventurien; ein Fehlen dort heisst „im Papierkorb" oder „andere Karte", nicht
 *    „geloescht". Bis 16.08.2026 wurde das verwechselt -- und ein Papierkorb-Gebiet ist
 *    wiederherstellbar, seine Huelle also gerade keine Waise (dieselbe Regel wie in
 *    avesmapsPoliticalHardDeleteUnassignedGeometry).
 *  - Welche Wiki-Zeile fuettert den Wiki-Zweig des Layer-Sammlers?
 *
 * ⚠️ Der LEFT JOIN spiegelt den Layer: dort kommt `wiki.id` aus derselben Verknuepfung, eine
 * verwaiste territory.wiki_id liefert also auch dort NULL.
 */
function avesmapsPoliticalFetchTerritoryWikiIdsById(PDO $pdo): array {
    $statement = $pdo->query(
        'SELECT territory.id AS id, wiki.id AS wiki_id
        FROM political_territory territory
        LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id'
    );
    if ($statement === false) {
        return [];
    }

    $wikiIdByTerritoryId = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $wikiIdByTerritoryId[(int) $row['id']] = (int) ($row['wiki_id'] ?? 0);
    }

    return $wikiIdByTerritoryId;
}

// Der Schnappschuss, aus dem alle drei Leser rechnen -- EINMAL geholt, nicht je Huelle.
function avesmapsPoliticalDerivedHullSourceContext(PDO $pdo): array {
    return [
        'territories' => avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo),
        'with_geometry' => avesmapsPoliticalFetchTerritoryIdsWithActiveGeometry($pdo),
        'wiki_id_by_territory_id' => avesmapsPoliticalFetchTerritoryWikiIdsById($pdo),
    ];
}

function avesmapsPoliticalDerivedHullIsSourceless(PDO $pdo, int $territoryId, array $context): bool {
    $wikiIdByTerritoryId = (array) ($context['wiki_id_by_territory_id'] ?? []);
    if ($territoryId < 1 || !array_key_exists($territoryId, $wikiIdByTerritoryId)) {
        // Die Zeile in political_territory gibt es nicht mehr -- niemand kann die Huelle je wieder
        // erzeugen. Das ist der EINZIGE Dangling-Fall.
        return true;
    }

    $territories = (array) ($context['territories'] ?? []);
    if (!isset($territories[$territoryId])) {
        // Die Zeile existiert, steht aber nicht im Rechenschnappschuss: Papierkorb oder anderer
        // Kontinent. Wiederherstellbar bzw. fremde Karte -- keine Waise.
        return false;
    }

    // 🔴 Dieselbe Sammelfunktion wie der Layer: parent_id-Nachfahren, Wiki-Zweig, Selbst-Rueckfall.
    $sourceTerritoryIds = avesmapsPoliticalCollectDerivedLayerSourceTerritoryIds(
        $pdo,
        ['properties' => [
            'derived_territory_id' => $territoryId,
            'derived_wiki_id' => ((int) ($wikiIdByTerritoryId[$territoryId] ?? 0)) ?: null,
        ]],
        $territories
    );
    if ($sourceTerritoryIds === []) {
        // ⚠️ Bei einem lebenden Gebiet faellt der Sammler IMMER mindestens auf sich selbst zurueck.
        // Leer heisst also: er ist in sein catch(Throwable) gelaufen. Keine Aussage ist kein
        // Freibrief fuer ein DELETE -- lieber eine Waise uebersehen als eine gesunde Huelle
        // unwiderruflich verlieren.
        return false;
    }

    $withGeometry = (array) ($context['with_geometry'] ?? []);
    foreach ($sourceTerritoryIds as $sourceId) {
        if (isset($withGeometry[(int) $sourceId])) {
            return false;
        }
    }

    return true;
}

function avesmapsPoliticalCollectSourcelessDerivedHulls(PDO $pdo): array {
    $context = avesmapsPoliticalDerivedHullSourceContext($pdo);

    $statement = $pdo->query(
        'SELECT
            derived.public_id,
            derived.territory_id,
            derived.min_x, derived.min_y, derived.max_x, derived.max_y,
            derived.created_at,
            cu.username AS created_by_username,
            territory.public_id AS territory_public_id,
            territory.name AS territory_name,
            territory.type AS territory_type,
            territory.is_active AS territory_is_active
        FROM political_territory_derived_geometry derived
        LEFT JOIN political_territory territory ON territory.id = derived.territory_id
        LEFT JOIN users cu ON cu.id = derived.created_by
        WHERE derived.is_active = 1'
    );
    if ($statement === false) {
        return [];
    }

    $hulls = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $territoryId = (int) ($row['territory_id'] ?? 0);
        if (!avesmapsPoliticalDerivedHullIsSourceless($pdo, $territoryId, $context)) {
            continue;
        }

        $minX = (float) ($row['min_x'] ?? 0);
        $minY = (float) ($row['min_y'] ?? 0);
        $maxX = (float) ($row['max_x'] ?? 0);
        $maxY = (float) ($row['max_y'] ?? 0);
        $territoryName = trim((string) ($row['territory_name'] ?? ''));

        $hulls[] = [
            'derived_geometry_public_id' => (string) ($row['public_id'] ?? ''),
            'territory_public_id' => (string) ($row['territory_public_id'] ?? ''),
            // 🔴 Wortgleich mit dem Inventar der Konturen -- eine Vokabel, nicht zwei
            // waeren zwei Zustaende fuer den Leser.
            'territory_name' => $territoryName !== '' ? $territoryName : '(KEIN TERRITORIUM)',
            'territory_type' => (string) ($row['territory_type'] ?? ''),
            'territory_is_active' => (int) ($row['territory_is_active'] ?? 0) === 1,
            'area' => round(max(0.0, $maxX - $minX) * max(0.0, $maxY - $minY), 1),
            'bbox' => [round($minX, 1), round($minY, 1), round($maxX, 1), round($maxY, 1)],
            'created_by' => (string) ($row['created_by_username'] ?? ''),
            'created_at' => (string) ($row['created_at'] ?? ''),
        ];
    }

    usort($hulls, static fn(array $a, array $b): int => $b['area'] <=> $a['area']);

    return $hulls;
}
