<?php

declare(strict_types=1);

/**
 * Innerorts-Objekte als Suchtreffer (dritte Quelle der Kartensuche).
 * ===========================================================================
 * Das Wiki kennt hunderte Objekte, die INNERHALB einer Stadt liegen -- Villen, Plaetze,
 * Stadttempel, Gassen. Sie haben keine eigene Weltkarten-Position und stehen deshalb NICHT
 * in map_features; fuer die Suche existierten sie damit ueberhaupt nicht (525 Bauwerke +
 * 10 Wege, gemessen 2026-07-27). Sie haben aber eine STADT
 * (api/_internal/wiki/place-scope.php), und die liegt auf der Karte.
 *
 * Ein Treffer verweist deshalb auf die Stadt: Name = das gesuchte Objekt, Sprungziel = die
 * Stadt. Die Beschriftung sagt das ausdruecklich ("Palast in Mengbilla · nicht auf der
 * Karte"), damit niemand dort einen Marker sucht, den es nicht gibt.
 *
 * 💣 Nur EINDEUTIGE Faelle (scope = inside). "unklar" (Name ist Stadt UND Region, z. B.
 * Abagund) faellt raus -- ein Suchtreffer, der auf die falsche Stadt springt, ist schlechter
 * als gar keiner.
 *
 * Ausser der Registry-Abfrage ist hier alles PURE (kein DB, keine Globals), damit
 * api/_internal/wiki/__tests__/in-settlement-search-test.php es ohne MySQL fahren kann --
 * das Einzige, was auf dieser Maschine beweisbar ist.
 */

require_once __DIR__ . '/../wiki/place-scope.php';

/**
 * Registry-Zeilen mit Ortsbezug: Bauwerke (wiki_sync_pages.standort) + Wege
 * (wiki_path_staging.lage_raw). Nur Zeilen MIT Rohwert -- ohne ihn gibt es nichts zu
 * entscheiden. Beide Mengen sind klein gefiltert (~500 bzw. ~140 Zeilen); die Ortsaufloesung
 * passiert danach gegen die ohnehin geladenen map_features, ohne weitere Abfrage
 * (STRATO, AGENTS.md §9).
 *
 * Fehlt eine Spalte oder Tabelle (frische Installation, Sync nie gelaufen), liefert der
 * jeweilige Zweig nichts -- die Kartensuche darf deswegen nicht ausfallen.
 *
 * @return list<array{title:string, raw:string, type_label:string, wiki_url:string}>
 */
function avesmapsFetchInSettlementSearchRows(PDO $pdo): array
{
    $rows = [];

    try {
        $statement = $pdo->query(
            "SELECT title, building_type, wiki_url, standort
               FROM wiki_sync_pages
              WHERE standort IS NOT NULL AND standort <> '' AND settlement_class = 'gebaeude'"
        );
        foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
            $buildingType = trim((string) ($row['building_type'] ?? ''));
            $rows[] = [
                'title' => (string) ($row['title'] ?? ''),
                'raw' => (string) ($row['standort'] ?? ''),
                'type_label' => $buildingType !== '' ? $buildingType : 'Bauwerk',
                'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            ];
        }
    } catch (Throwable) {
        // absichtlich still -- siehe Docblock
    }

    try {
        $statement = $pdo->query(
            "SELECT name, art, wiki_url, lage_raw
               FROM wiki_path_staging
              WHERE lage_raw IS NOT NULL AND lage_raw <> ''"
        );
        foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
            $art = trim((string) ($row['art'] ?? ''));
            $rows[] = [
                'title' => (string) ($row['name'] ?? ''),
                'raw' => (string) ($row['lage_raw'] ?? ''),
                'type_label' => $art !== '' ? $art : 'Weg',
                'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            ];
        }
    } catch (Throwable) {
        // absichtlich still -- siehe Docblock
    }

    return $rows;
}

/**
 * PURE: Index der auf der Karte liegenden SIEDLUNGEN aus den bereits geladenen
 * map_features-Zeilen -- gefalteter Name => {public_id, bbox, subtype}. Spart eine eigene
 * Abfrage und garantiert, dass ein Treffer nur auf einen Ort zeigt, den es auf der Karte
 * wirklich gibt.
 *
 * 💣 Ein DOPPELT vergebener Name wird VERWORFEN statt willkuerlich aufgeloest: bei zwei
 * Orten gleichen Namens waere jeder Sprung ein Muenzwurf (dieselbe Gefahr, aus der im
 * Routing-Graphen ein Teleport wurde, wenn zwei Orte denselben Namen tragen).
 *
 * gebaeude zaehlt NICHT als Siedlung -- ein Bauwerk ist kein Behaelter.
 *
 * @param list<array<string,mixed>> $rows map_features-Zeilen (avesmapsFetchMapSearchRows)
 * @return array<string, array{public_id:string, min_x:float, min_y:float, max_x:float, max_y:float, subtype:string}>
 */
function avesmapsBuildSettlementLocationIndex(array $rows): array
{
    $index = [];
    $ambiguous = [];

    foreach ($rows as $row) {
        if ((string) ($row['feature_type'] ?? '') !== 'location') {
            continue;
        }
        $subtype = (string) ($row['feature_subtype'] ?? '');
        if (!in_array($subtype, AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES, true)) {
            continue;
        }
        $name = trim((string) ($row['name'] ?? ''));
        if ($name === '') {
            continue;
        }
        $key = avesmapsPlaceScopeFoldName($name);
        if ($key === '') {
            continue;
        }
        if (isset($index[$key])) {
            $ambiguous[$key] = true;
            continue;
        }
        $index[$key] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'min_x' => (float) ($row['min_x'] ?? 0),
            'min_y' => (float) ($row['min_y'] ?? 0),
            'max_x' => (float) ($row['max_x'] ?? 0),
            'max_y' => (float) ($row['max_y'] ?? 0),
            'subtype' => $subtype,
        ];
    }

    foreach (array_keys($ambiguous) as $key) {
        unset($index[$key]);
    }

    return $index;
}

/**
 * PURE: die schlanke Innerorts-Liste fuer den KARTEN-PAYLOAD -- je Objekt nur sein Name und
 * die Stadt, in der es liegt.
 *
 * Der Routenplaner-Autocomplete arbeitet rein lokal (kein Request je Tastendruck, deshalb
 * fuehlt er sich sofort an). Damit er "Plaza der Lüste" kennt, muss die Liste EINMAL mit den
 * Kartendaten mitkommen -- ~535 Eintraege a ~50 Byte, also ein paar Dutzend KB neben einem
 * mehrere MB grossen Payload, und keine zusaetzliche Abfrage im Betrieb.
 *
 * Bewusst OHNE public_id/bbox: der Autocomplete schreibt den STADTNAMEN ins Feld, weil
 * Ortsnamen im Routing-Graphen die Schluessel sind. Mehr braucht er nicht, und was nicht
 * mitreist, kann auch nicht veralten.
 *
 * Die Stadt steht nur dann in `settlement`, wenn der Klassifikator sie EINDEUTIG erkannt hat
 * (scope = inside); "unklar" faellt raus wie ueberall sonst.
 *
 * @param list<array{title:string, raw:string, type_label:string, wiki_url:string}> $registryRows
 * @param array{settlements:array<string,bool>, regions:array<string,bool>} $scopeIndex
 * @return list<array{name:string, settlement:string, type:string}>
 */
function avesmapsBuildInSettlementPlaceList(array $registryRows, array $scopeIndex): array
{
    $places = [];
    $seen = [];

    foreach ($registryRows as $registryRow) {
        $title = trim((string) ($registryRow['title'] ?? ''));
        if ($title === '' || isset($seen[$title])) {
            continue;
        }

        $scope = avesmapsPlaceScopeClassifyWithIndex((string) ($registryRow['raw'] ?? ''), $scopeIndex);
        if ($scope['scope'] !== AVESMAPS_PLACE_SCOPE_INSIDE || $scope['settlement'] === '') {
            continue;
        }

        $seen[$title] = true;
        $places[] = [
            'name' => $title,
            'settlement' => $scope['settlement'],
            'type' => (string) ($registryRow['type_label'] ?? ''),
        ];
    }

    return $places;
}

/**
 * PURE: aus Registry-Zeilen + Ortsindex + Scope-Index die Innerorts-Suchtreffer bauen.
 * Ein Objekt kommt nur mit, wenn der Klassifikator EINDEUTIG "inside" sagt UND die genannte
 * Stadt (eindeutig) auf der Karte liegt.
 *
 * @param list<array{title:string, raw:string, type_label:string, wiki_url:string}> $registryRows
 * @param array<string, array<string,mixed>> $settlementIndex avesmapsBuildSettlementLocationIndex
 * @param array{settlements:array<string,bool>, regions:array<string,bool>} $scopeIndex
 * @return list<array<string,mixed>> Suchtreffer in der Form, die die Kartensuche ausliefert
 */
function avesmapsBuildInSettlementSearchEntries(array $registryRows, array $settlementIndex, array $scopeIndex): array
{
    $entries = [];

    foreach ($registryRows as $registryRow) {
        $title = trim((string) ($registryRow['title'] ?? ''));
        if ($title === '') {
            continue;
        }

        $scope = avesmapsPlaceScopeClassifyWithIndex((string) ($registryRow['raw'] ?? ''), $scopeIndex);
        if ($scope['scope'] !== AVESMAPS_PLACE_SCOPE_INSIDE || $scope['settlement'] === '') {
            continue;
        }

        $settlement = $settlementIndex[avesmapsPlaceScopeFoldName($scope['settlement'])] ?? null;
        if ($settlement === null || (string) $settlement['public_id'] === '') {
            continue; // Stadt liegt nicht (eindeutig) auf der Karte -> nichts zum Anspringen
        }

        $entries[] = [
            'kind' => 'in_settlement',
            // Die public_id der STADT: das Frontend haengt den Treffer an ihren Marker-
            // Eintrag und benutzt damit denselben Flug und dieselbe Infobox wie ein normaler
            // Ortstreffer -- kein zweiter Navigationsweg, der auseinanderlaufen koennte.
            'public_id' => (string) $settlement['public_id'],
            'public_ids' => [(string) $settlement['public_id']],
            'name' => $title,
            'type_label' => (string) $registryRow['type_label'] . ' in ' . $scope['settlement'],
            'feature_subtype' => (string) $settlement['subtype'],
            'settlement_name' => $scope['settlement'],
            'settlement_public_id' => (string) $settlement['public_id'],
            'wiki_url' => (string) ($registryRow['wiki_url'] ?? ''),
            'min_x' => (float) $settlement['min_x'],
            'min_y' => (float) $settlement['min_y'],
            'max_x' => (float) $settlement['max_x'],
            'max_y' => (float) $settlement['max_y'],
            // Gesucht wird nach dem OBJEKT, nicht nach der Stadt -- stuende der Stadtname hier,
            // faende "Mengbilla" seine 32 Innerorts-Objekte alle noch einmal zusaetzlich.
            'search_texts' => [$title],
        ];
    }

    return $entries;
}
