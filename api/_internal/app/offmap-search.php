<?php

declare(strict_types=1);

/**
 * Objekte OHNE Kartenobjekt als Suchtreffer (siebte Quelle der Kartensuche).
 * ===========================================================================
 * Das Wiki kennt tausende Orte, Landschaften, Wege und Herrschaftsgebiete, die
 * niemand auf unsere Karte gesetzt hat. Fuer die Suche existierten sie bisher
 * ueberhaupt nicht -- wer danach suchte, bekam keinen Treffer, keinen Hinweis,
 * keine Spur.
 *
 * Ein Treffer verweist deshalb auf das Gebiet, in dem das Ding LIEGT: Name = das
 * gesuchte Objekt, Sprungziel = sein uebergeordnetes Gebiet. Die Beschriftung sagt
 * das ausdruecklich („Burg · Weiden" + „nicht auf der Karte"), damit niemand dort
 * eine Markierung sucht, die es nicht gibt.
 *
 * Vorbild und Verallgemeinerung: in-settlement-search.php loest dasselbe Problem
 * fuer Objekte INNERHALB einer Stadt. Diese Datei nimmt alles ausserhalb.
 *
 * 💣 ZWEI FRAGEN, ZWEI WERKZEUGE -- und sie werden leicht verwechselt:
 *
 *   „Liegt das innerorts?"      -> avesmapsPlaceScopeClassifyWithIndex (place-scope.php)
 *   „Welches Kartenobjekt?"     -> avesmapsOffmapResolvePlace (hier)
 *
 * Die erste ist ein AUSSCHLUSS (innerorts gehoert der dritten Quelle). Sie taugt
 * NICHT als Aufloeser, weil sie ein Ziel nur dann herausgibt, wenn es eine
 * SIEDLUNG ist (place-scope.php:316) -- die Sprungziele hier sind aber
 * ueberwiegend Regionen und Laender, und fuer die laege sie immer leer.
 *
 * PURE: alles hier ausser avesmapsFetchOffmapSearchRows ist DB-frei, damit
 * api/_internal/app/__tests__/offmap-search-test.php es ohne MySQL fahren kann --
 * das Einzige, was auf dieser Maschine beweisbar ist.
 */

require_once __DIR__ . '/../wiki/place-scope.php';
require_once __DIR__ . '/../wiki/map-presence.php';

/**
 * Name -> anspringbares Kartenobjekt.
 *
 * Deckt Orte, Regionen, Label UND Herrschaftsgebiete ab, weil die Sprungziele hier
 * ueberwiegend Regionen und Laender sind; der bestehende
 * avesmapsBuildSettlementLocationIndex kennt nur Siedlungen.
 *
 * 🔴 Die kind-Werte sind genau die, die spotlightPlaceLookupKeys im Client kennt
 * (settlement|territory|region|path). Ein anderer Wert findet dort nichts, und der
 * Treffer faellt still in den unreachable-Zweig: er saehe richtig aus und taete
 * beim Klick nichts.
 *
 * ⚠️ Bei Namensgleichheit gewinnt der ERSTE, und der Name wird nicht als
 * mehrdeutig verworfen: anders als beim Innerorts-Index ist ein etwas zu grob
 * getroffenes Elterngebiet harmlos (man landet in der richtigen Gegend), waehrend
 * gar kein Ziel den Treffer wertlos macht.
 *
 * @param list<array<string, mixed>> $rows map_features-Zeilen
 * @param list<array<string, mixed>> $politicalRows Territorien MIT Flaeche
 * @return array<string, array{public_id: string, kind: string}>
 */
function avesmapsBuildOffmapTargetIndex(array $rows, array $politicalRows): array
{
    $index = [];
    $put = static function (string $name, string $publicId, string $kind) use (&$index): void {
        $key = avesmapsPlaceScopeFoldName($name);
        if ($key === '' || $publicId === '' || isset($index[$key])) {
            return;
        }
        $index[$key] = ['public_id' => $publicId, 'kind' => $kind];
    };

    $kindByFeatureType = ['location' => 'settlement', 'region' => 'region', 'label' => 'region'];
    foreach ($rows as $row) {
        $kind = $kindByFeatureType[(string) ($row['feature_type'] ?? '')] ?? '';
        if ($kind === '') {
            continue;
        }
        $put((string) ($row['name'] ?? ''), (string) ($row['public_id'] ?? ''), $kind);
    }

    foreach ($politicalRows as $row) {
        $put((string) ($row['name'] ?? ''), (string) ($row['public_id'] ?? ''), 'territory');
    }

    return $index;
}

/**
 * PURE: die Namen, die ein Rohwert als Sprungziel anbietet, in der Reihenfolge
 * ihrer Nennung.
 *
 * Die Quellspalten sind verschieden geformt, und beide Formen kommen vor:
 *   „[[Gareth]]: [[Arenaviertel]]"  -- Bauwerks-Standort, roh mit Wiki-Markup
 *   „Garetien · Mittelreich"        -- Orts-Lage, vom Infobox-Parser schon geputzt
 *   „Garetien"                      -- Elterngebiet, ein blanker Name
 *
 * 💣 Der Trenner „ · " stammt aus avesmapsWikiSettlementParseInfobox
 * (settlements.php), wo `lage` als „region · staat" zusammengesetzt wird. Beide
 * Haelften sind gueltige Kandidaten: ist die Region nicht gezeichnet, der Staat
 * aber schon, soll der Staat gewinnen.
 *
 * @return list<string>
 */
function avesmapsOffmapPlaceCandidates(string $raw): array
{
    $raw = trim($raw);
    if ($raw === '') {
        return [];
    }

    $links = avesmapsPlaceScopeExtractLinksWithContext($raw);
    if ($links !== []) {
        return array_values(array_filter(array_map(
            static fn(array $link): string => trim((string) $link['target']),
            $links
        )));
    }

    // Kein Markup -> der Rohwert selbst, an seinen Trennern zerlegt.
    $parts = preg_split('/\s*[·,;]\s*/u', $raw) ?: [];

    return array_values(array_filter(array_map('trim', $parts)));
}

/**
 * PURE: das erste Kandidatengebiet, das wirklich auf der Karte liegt.
 *
 * @param array<string, array{public_id: string, kind: string}> $targetIndex
 * @return array{name: string, public_id: string, kind: string}|null
 */
function avesmapsOffmapResolvePlace(string $raw, array $targetIndex): ?array
{
    foreach (avesmapsOffmapPlaceCandidates($raw) as $candidate) {
        $key = avesmapsPlaceScopeFoldName($candidate);
        if ($key !== '' && isset($targetIndex[$key])) {
            return [
                'name' => $candidate,
                'public_id' => (string) $targetIndex[$key]['public_id'],
                'kind' => (string) $targetIndex[$key]['kind'],
            ];
        }
    }

    return null;
}

/**
 * Sucheintraege in derselben Form wie avesmapsBuildCitymapSearchEntries.
 *
 * @param list<array<string, mixed>> $rows aus avesmapsFetchOffmapSearchRows
 * @param array<string, array{public_id: string, kind: string}> $targetIndex
 * @param array{settlements: array<string,bool>, regions: array<string,bool>} $scopeIndex
 * @param array<string, bool> $presenceIndex aus avesmapsBuildMapPresenceIndex
 * @return list<array<string, mixed>>
 */
function avesmapsBuildOffmapSearchEntries(
    array $rows,
    array $targetIndex,
    array $scopeIndex,
    array $presenceIndex
): array {
    $entries = [];
    foreach ($rows as $row) {
        $title = trim((string) ($row['title'] ?? ''));
        if ($title === '' || avesmapsIsTitleOnMap($title, $presenceIndex)) {
            continue; // Was auf der Karte liegt, hat in dieser Quelle nichts zu suchen.
        }

        $placeRaw = (string) ($row['place_raw'] ?? '');

        // ⚠️ AUSSCHLUSS, nicht Aufloesung: liegt das Objekt in einer Stadt, gehoert
        // es der Innerorts-Quelle (in-settlement-search.php) und wuerde hier ein
        // zweites Mal erscheinen. „unklar" bleibt -- das ist genau der Fall, in dem
        // niemand weiss, ob eine Stadt oder ein Gebiet gemeint ist.
        if ($scopeIndex !== []
            && avesmapsPlaceScopeClassifyWithIndex($placeRaw, $scopeIndex)['scope'] === AVESMAPS_PLACE_SCOPE_INSIDE
        ) {
            continue;
        }

        // 💣 ZWEI Huerden, und beide muessen fallen: der Rohwert muss einen Namen
        // hergeben, UND dieser Name muss auf der Karte liegen. Nur die erste zu
        // pruefen verspricht einen Flug, den der Client nicht fliegen kann.
        $target = avesmapsOffmapResolvePlace($placeRaw, $targetIndex);

        // ⚠️ Ohne Ziel bleibt place_name LEER -- nie der Rohtext. Ein „liegt in
        // [[Kosch]]", das nirgendwo hinfuehrt, ist eine Halbwahrheit, und der
        // Client zeigt dafuer den anderen Satz („kein Ort auf der Karte").
        $unresolved = $target === null;
        $placeName = $unresolved ? '' : (string) $target['name'];

        $typeLabel = (string) ($row['type_label'] ?? '');
        $typeLabelParts = array_filter([$typeLabel, $placeName]);

        $entries[] = [
            'kind' => 'offmap',
            // Der Treffer selbst hat keine public_id -- er ist ja nicht auf der Karte.
            // place_public_id ist die id des ZIELS (wie citymap-search.php:104-110).
            'public_id' => '',
            'public_ids' => [],
            'name' => $title,
            'type_label' => implode(' · ', $typeLabelParts),
            'feature_subtype' => (string) ($row['kind'] ?? ''),
            'place_public_id' => $unresolved ? '' : (string) $target['public_id'],
            'place_kind' => $unresolved ? 'unresolved' : (string) $target['kind'],
            'place_name' => $placeName,
            'not_on_map' => true,
            'unresolved' => $unresolved,
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'min_x' => 0.0,
            'min_y' => 0.0,
            'max_x' => 0.0,
            'max_y' => 0.0,
            'search_texts' => array_values(array_filter([$title, $placeName, $typeLabel])),
        ];
    }

    return $entries;
}

/**
 * Die Zeilen der Arten, deren Sprungziel BEREITS als Spalte dasteht:
 * Landschaften, Wege und Staetten ausserhalb von Staedten.
 *
 * 💣 Jede Abfrage steht in ihrem EIGENEN try/catch. Fehlt eine Staging-Tabelle
 * (frische Installation, Sync nie gelaufen), darf die Kartensuche deswegen nicht
 * ausfallen -- sie verliert dann nur diese eine Art. Ein gemeinsames catch wuerde
 * beim ersten Fehler alle drei verschlucken.
 *
 * ⚠️ Kontinent-Filter: „Aventurien" ODER leer. Die Staging-Tabellen halten
 * bewusst ALLE Kontinente (Owner-Entscheid, der Dump spiegelt das Wiki), aber ein
 * myranischer Ort kann auf dieser Karte nie ein Sprungziel haben und wuerde nur
 * den Deckel fuellen. Leer zaehlt als Aventurien -- dieselbe Lesart wie die
 * Ortsliste des Editors, wo der Kontinent per Backfill nachgetragen wird.
 *
 * @return list<array{title: string, type_label: string, place_raw: string, wiki_url: string, kind: string}>
 */
function avesmapsFetchOffmapSearchRows(PDO $pdo): array
{
    $rows = [];
    $aventurien = "(continent IS NULL OR continent = '' OR continent = 'Aventurien')";

    // Landschaften/Regionen: region_parent und affiliation_staat sind eigene Spalten.
    // Beide reisen als Kandidaten mit -- ist die Elternregion ungezeichnet, der Staat
    // aber schon, gewinnt der Staat (avesmapsOffmapPlaceCandidates).
    try {
        $statement = $pdo->query(
            "SELECT name, art, region_parent, affiliation_staat, wiki_url
               FROM wiki_region_staging
              WHERE {$aventurien}"
        );
        foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
            $eltern = array_filter([
                (string) ($row['region_parent'] ?? ''),
                (string) ($row['affiliation_staat'] ?? ''),
            ], static fn(string $value): bool => trim($value) !== '');
            $rows[] = [
                'title' => (string) ($row['name'] ?? ''),
                'type_label' => trim((string) ($row['art'] ?? '')) !== ''
                    ? (string) $row['art']
                    : 'Landschaft',
                'place_raw' => implode(' · ', $eltern),
                'wiki_url' => (string) ($row['wiki_url'] ?? ''),
                'kind' => 'region',
            ];
        }
    } catch (Throwable) {
        // Tabelle fehlt -> diese Art faellt aus, die Suche laeuft weiter.
    }

    // Wege/Fluesse: lage_raw traegt das Markup, lage die geputzte Fassung.
    // Beide taugen als Rohwert; lage_raw zuerst, weil die Links darin die
    // Namensgrenzen mitliefern.
    try {
        $statement = $pdo->query(
            "SELECT name, art, lage, lage_raw, wiki_url FROM wiki_path_staging WHERE {$aventurien}"
        );
        foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
            $roh = trim((string) ($row['lage_raw'] ?? ''));
            $rows[] = [
                'title' => (string) ($row['name'] ?? ''),
                'type_label' => trim((string) ($row['art'] ?? '')) !== ''
                    ? (string) $row['art']
                    : 'Weg',
                'place_raw' => $roh !== '' ? $roh : (string) ($row['lage'] ?? ''),
                'wiki_url' => (string) ($row['wiki_url'] ?? ''),
                'kind' => 'path',
            ];
        }
    } catch (Throwable) {
    }

    // Bauwerke/Staetten. Der Innerorts-Fall faellt in
    // avesmapsBuildOffmapSearchEntries heraus (er gehoert in-settlement-search.php);
    // hier wird bewusst NICHT vorgefiltert, weil die Entscheidung den Scope-Index
    // braucht, den erst der Endpunkt hat.
    try {
        $statement = $pdo->query(
            "SELECT title, building_type, standort, wiki_url
               FROM wiki_sync_pages
              WHERE settlement_class = 'gebaeude' AND {$aventurien}"
        );
        foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
            $rows[] = [
                'title' => (string) ($row['title'] ?? ''),
                'type_label' => trim((string) ($row['building_type'] ?? '')) !== ''
                    ? (string) $row['building_type']
                    : 'Bauwerk',
                'place_raw' => (string) ($row['standort'] ?? ''),
                'wiki_url' => (string) ($row['wiki_url'] ?? ''),
                'kind' => 'building',
            ];
        }
    } catch (Throwable) {
    }

    return $rows;
}

/**
 * PURE: Tiebreak fuer avesmapsCollectSearchSection.
 *
 * 🔴 Wer hinfliegen kann, steht vor dem, der nur gelesen werden kann -- aber erst
 * NACH dem Punktestand: ein exakter Namenstreffer bleibt ein exakter Namenstreffer.
 */
function avesmapsOffmapSearchCompare(array $left, array $right): int
{
    $scoreDiff = (int) $left['score'] <=> (int) $right['score'];
    if ($scoreDiff !== 0) {
        return $scoreDiff;
    }

    $reachDiff = ((int) ($left['unresolved'] ?? false)) <=> ((int) ($right['unresolved'] ?? false));
    if ($reachDiff !== 0) {
        return $reachDiff;
    }

    return strnatcasecmp((string) $left['name'], (string) $right['name']);
}
