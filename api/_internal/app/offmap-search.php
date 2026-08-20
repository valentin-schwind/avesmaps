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
 * PURE: die Herrschaftsgebiete, die weder selbst noch irgendwo in ihrem Unterbaum
 * eine gezeichnete Flaeche haben -- als fertige Quellzeilen.
 *
 * 💣 Gerechnet wird LINEAR, nicht per rekursiver CTE. Die naheliegende SQL-Fassung
 * („WITH RECURSIVE subtree …", wie die bestehende Territoriumsabfrage sie fuehrt)
 * baut den Unterbaum JEDES Gebiets auf -- bei rund 1400 Territorien, in dem
 * Endpunkt, der pro Tastendruck feuert. Das ist die Sorte Last, die AGENTS.md §10
 * dem PHP-Pool-Vorfall vom 17.07.2026 zuschreibt.
 *
 * Stattdessen: von jedem Gebiet MIT Flaeche einmal die Elternkette hinauf markieren.
 * Danach ist „hat irgendwo im Unterbaum eine Flaeche" ein Nachschlagen.
 *
 * ⚠️ Die Antwort MUSS dieselbe sein wie die des JOINs in
 * avesmapsFetchPoliticalTerritorySearchRows -- weicht sie ab, erscheint ein Gebiet
 * doppelt oder in keiner der beiden Quellen.
 *
 * @param array<int, array<string, mixed>> $baum id => Zeile (parent_id, name, type, wiki_url, continent)
 * @param list<int|string> $territoryIdsMitFlaeche territory_id aus political_territory_geometry
 * @return list<array{title: string, type_label: string, place_raw: string, wiki_url: string, kind: string}>
 */
function avesmapsOffmapTerritoriesWithoutArea(array $baum, array $territoryIdsMitFlaeche): array
{
    $bedeckt = [];
    foreach ($territoryIdsMitFlaeche as $territoryId) {
        // 💣 Der Tiefenzaehler ist die Bremse gegen einen Zyklus in parent_id. Eine
        // einzige kaputte Zeile wuerde die Suche sonst haengen lassen -- und zwar
        // jede Anfrage, nicht nur eine.
        $knoten = (int) $territoryId;
        $tiefe = 0;
        while ($knoten !== 0 && !isset($bedeckt[$knoten]) && $tiefe++ < 32) {
            $bedeckt[$knoten] = true;
            $knoten = (int) ($baum[$knoten]['parent_id'] ?? 0);
        }
    }

    $zeilen = [];
    foreach ($baum as $id => $row) {
        if (isset($bedeckt[(int) $id])) {
            continue;
        }
        $kontinent = (string) ($row['continent'] ?? '');
        if ($kontinent !== '' && $kontinent !== 'Aventurien') {
            continue;
        }
        $elternId = (int) ($row['parent_id'] ?? 0);
        $zeilen[] = [
            'title' => (string) ($row['name'] ?? ''),
            'type_label' => trim((string) ($row['type'] ?? '')) !== ''
                ? (string) $row['type']
                : 'Herrschaftsgebiet',
            // ⚠️ Ein Gebiet OHNE Elterngebiet (eine Wurzel) bekommt einen leeren
            // Rohwert und damit kein Sprungziel -- gezeigt wird es trotzdem, sonst
            // verschwaenden ausgerechnet die groessten Reiche.
            'place_raw' => (string) ($baum[$elternId]['name'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'kind' => 'territory',
        ];
    }

    return $zeilen;
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

    // Siedlungen: `lage` ist „Region · Staat" aus der Wiki-Infobox.
    //
    // 💣 Der Rueckfall auf '' ist PFLICHT, nicht Vorsicht. avesmapsWikiSettlementEnsureSchema
    // legt die Spalte NUR im Sync-Pfad an; auf einer Installation, die noch nie gesynct hat,
    // wirft das SELECT, der catch macht daraus eine leere Liste, und ALLE Siedlungen
    // verschwinden lautlos aus der Suche -- der stille Ausfall, den niemand einem SELECT
    // zuordnet (AGENTS.md, „Neue Spalte im LESEpfad").
    // ⚠️ Die Probe ist ein SELECT … LIMIT 1, kein information_schema-Zugriff: Letzterer ist
    // genau die Last, die §10 dem Pool-Vorfall zuschreibt. Und sie laeuft einmal je
    // Anfrage, nicht je Zeile.
    $lageSpalte = "'' AS lage";
    try {
        if ($pdo->query('SELECT lage FROM wiki_sync_pages LIMIT 1') !== false) {
            $lageSpalte = 'lage';
        }
    } catch (Throwable) {
    }

    try {
        $statement = $pdo->query(
            "SELECT title, settlement_label, wiki_url, {$lageSpalte}
               FROM wiki_sync_pages
              WHERE settlement_class IS NOT NULL
                AND settlement_class <> ''
                AND settlement_class <> 'gebaeude'
                AND {$aventurien}"
        );
        foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
            $rows[] = [
                'title' => (string) ($row['title'] ?? ''),
                'type_label' => trim((string) ($row['settlement_label'] ?? '')) !== ''
                    ? (string) $row['settlement_label']
                    : 'Siedlung',
                'place_raw' => (string) ($row['lage'] ?? ''),
                'wiki_url' => (string) ($row['wiki_url'] ?? ''),
                'kind' => 'settlement',
            ];
        }
    } catch (Throwable) {
    }

    // EIGENE Herrschaftsgebiete ohne jede gezeichnete Flaeche -- weder selbst noch
    // irgendwo in ihrem Unterbaum. Sprungziel ist das Elterngebiet.
    //
    // 🪤 Diese Zeilen fallen NICHT versehentlich aus der Suche: die bestehende
    // Territoriumsabfrage (map-search.php) schliesst sie mit einem JOIN auf
    // political_territory_geometry bewusst aus, und ihr Kommentar nennt den Grund --
    // „nichts zum Anspringen". Die Voraussetzung ist mit dieser Quelle weg, also
    // werden sie hier aufgefangen, statt die alte Regel aufzuweichen.
    //
    // 💣 GERECHNET WIRD IN PHP, NICHT PER REKURSIVER CTE. Die naheliegende Fassung
    // („WITH RECURSIVE subtree …", wie die bestehende Territoriumsabfrage sie fuehrt)
    // baut den Unterbaum JEDES Gebiets auf -- bei rund 1400 Territorien, in dem
    // Endpunkt, der pro Tastendruck feuert. Das ist genau die Last, die AGENTS.md §10
    // dem PHP-Pool-Vorfall vom 17.07.2026 zuschreibt.
    //
    // Stattdessen zwei flache Abfragen und ein linearer Lauf: von jedem Gebiet MIT
    // Flaeche einmal die Elternkette hinauf markieren. Danach ist „hat irgendwo im
    // Unterbaum eine Flaeche" ein Nachschlagen, keine Rekursion.
    // ⚠️ Die Antwort MUSS dieselbe sein wie die des JOINs in map-search.php -- weicht
    // sie ab, erscheint ein Gebiet doppelt oder in keiner der beiden Quellen.
    try {
        $baum = [];
        $statement = $pdo->query(
            "SELECT id, parent_id, name, type, wiki_url, continent
               FROM political_territory
              WHERE is_active = 1 AND name IS NOT NULL AND name <> ''"
        );
        foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
            $baum[(int) $row['id']] = $row;
        }

        $geoStatement = $pdo->query(
            'SELECT DISTINCT territory_id FROM political_territory_geometry WHERE is_active = 1'
        );
        $mitFlaeche = $geoStatement !== false ? $geoStatement->fetchAll(PDO::FETCH_COLUMN) : [];

        foreach (avesmapsOffmapTerritoriesWithoutArea($baum, $mitFlaeche) as $zeile) {
            $rows[] = $zeile;
        }
    } catch (Throwable) {
    }

    // Wiki-Territorien, fuer die es nicht einmal eine Zeile in political_territory gibt.
    //
    // 💣 Der Elternbezug laeuft ueber affiliation_key, einen wiki_key -- NIE ueber den
    // Namen. Die Schluesselableitung ist eine feste Tabelle mit eigener Geschichte
    // (AGENTS.md §5); ein Join ueber Namen faende bei jedem Umlaut etwas anderes.
    // affiliation_raw reist als Rueckfall mit: es traegt Wiki-Markup, und der
    // Kandidaten-Extraktor kommt damit zurecht.
    try {
        $statement = $pdo->query(
            "SELECT w.name, w.type, w.wiki_url, w.affiliation_raw, p.name AS parent_name
               FROM political_territory_wiki w
               LEFT JOIN political_territory_wiki p ON p.wiki_key = w.affiliation_key
              WHERE (w.continent IS NULL OR w.continent = '' OR w.continent = 'Aventurien')
                AND NOT EXISTS (
                    SELECT 1 FROM political_territory t
                     WHERE t.is_active = 1 AND t.wiki_key = w.wiki_key
                )"
        );
        foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
            $eltern = trim((string) ($row['parent_name'] ?? ''));
            $rows[] = [
                'title' => (string) ($row['name'] ?? ''),
                'type_label' => trim((string) ($row['type'] ?? '')) !== ''
                    ? (string) $row['type']
                    : 'Herrschaftsgebiet',
                'place_raw' => $eltern !== '' ? $eltern : (string) ($row['affiliation_raw'] ?? ''),
                'wiki_url' => (string) ($row['wiki_url'] ?? ''),
                'kind' => 'territory',
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
