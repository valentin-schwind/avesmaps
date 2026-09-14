<?php

declare(strict_types=1);

/**
 * Landschaften ohne eigene Beschriftung als Treffer der Kartensuche.
 * ===================================================================
 * Entwurf: docs/superpowers/specs/2026-08-28-landschaften-in-der-suche-design.md (Owner-Entscheid B,
 * 14.09.2026: jede ECHT benannte Landschaft, keine Klimazonen).
 *
 * Eine Landschaft (`ecosystem_region`) war der Suche nur ueber ihre BESCHRIFTUNG bekannt. Eine Flaeche
 * ohne Beschriftung -- Ceälan, Tannwald, Archipel der Perlen -- war unauffindbar. Diese Datei macht
 * sie zu Treffern, die auf ihre Flaechen fliegen.
 *
 * 🔴 SERVERSEITIG, weil die Flaechen nicht in der Kartennutzlast reisen: sie liegen hinter
 * api/app/ecosystem-areas.php und werden nur in der Landschaften-Ansicht geladen, Ausschnitt fuer
 * Ausschnitt. Ein Client-Bauer faende sie je nach Ansicht mal und mal nicht.
 *
 * 🔴 EIN KARTENOBJEKT, KEIN ABSCHNITT. Kartensammlung, Literatur, Vorkommen und „Nicht auf der Karte"
 * liegen NEBEN der Karte und haben einen Deckel von 5. Eine Landschaft liegt AUF der Karte -- sie steht
 * zwischen den uebrigen Kartenobjekten, nach Punktestand (avesmapsSearchKindOrder im Endpunkt).
 *
 * PURE: alles ausser avesmapsFetchLandscapeSearchRows ist DB-frei
 * (api/_internal/app/__tests__/landscape-search-test.php). Den Weg bis in die Antwort des Endpunkts
 * faehrt api/app/__tests__/map-search-verdrahtung-test.php gegen echte Tabellen.
 *
 * ⚠️ KEIN DDL, und bewusst NICHT ecosystem.php: dessen Ensure ist die Last, die AGENTS.md §10 dem
 * PHP-Pool-Vorfall zuschreibt, und dieser Pfad feuert je Tastendruck. Geladen werden nur die reinen
 * Nachbarn, deren Regeln hier gebraucht werden.
 */

require_once __DIR__ . '/map-search-scoring.php';
require_once __DIR__ . '/ecosystem-naming.php';
require_once __DIR__ . '/ecosystem-label-link.php';

// Owner 14.09.2026: ein Klimaband ist keine Landschaft, die man anfliegt -- es zieht sich ueber den
// halben Kontinent.
const AVESMAPS_LANDSCAPE_SEARCH_EXCLUDED_KINDS = ['klima'];

/**
 * PURE: das Muster der maschinell vergebenen Namen, `<Griff>-<Zahl>`.
 *
 * 🔴 ABGELEITET, NICHT ABGESCHRIEBEN. Die Griffe sind die Artbezeichnungen aus
 * `ecosystem_region_type.label` plus der Rueckfall-Griff einer Region ohne Art -- dieselbe Bauform wie
 * nextEcosystemRegionAutoName im Browser. Eine eingefuehrte Wortliste liefe beim naechsten Typ still
 * auseinander.
 *
 * 💣 IRGENDEINE Art, nicht nur die aktuelle. Der Browser prueft gegen die Art, die die Region JETZT hat,
 * und haelt deshalb „Fläche-048" einer inzwischen als Urwald gefuehrten Region fuer einen echten Namen
 * (12 solche Regionen, gemessen 14.09.2026). Ein Griff wird bei der Anlage vergeben und ueberlebt jeden
 * Artwechsel. ⚠️ Auch STILLGELEGTE Arten zaehlen -- ihr alter Griff bleibt ein Griff.
 * ⚠️ Ohne Unterscheidung der Gross- und Kleinschreibung: die sichere Richtung ist „lieber verstecken".
 *
 * @param list<string> $namePrefixes Artbezeichnungen; der Rueckfall-Griff wird ergaenzt
 */
function avesmapsLandscapeSearchAutoNamePattern(array $namePrefixes): string
{
    $griffe = [AVESMAPS_ECOSYSTEM_AUTO_NAME_FALLBACK];
    foreach ($namePrefixes as $griff) {
        $griff = trim((string) $griff);
        if ($griff !== '') {
            $griffe[] = $griff;
        }
    }

    // Die Artbezeichnung ist Inhalt, kein Muster: „Flussland/Flusstal" und jede kuenftige Klammer
    // waeren ungeschuetzt still falsch.
    $alternativen = array_map(
        static fn(string $griff): string => preg_quote($griff, '/'),
        array_values(array_unique($griffe))
    );

    return '/^(?:' . implode('|', $alternativen) . ')-[0-9]+$/iu';
}

/**
 * PURE: ist dieser Name maschinell vergeben? Dann ist die Landschaft kein Suchtreffer.
 *
 * 💣 DIE SUCHE FRAGT STRENGER ALS DER HAKEN (Entwurf §5). Der Haken beantwortet „wurde der Name
 * automatisch vergeben?", und dort schlaegt ein ausdrueckliches `false` den Namen
 * (avesmapsEcosystemAutoNameAusMerker im Browser). Die Suche fragt „wuerde ein Leser nach diesem Namen
 * suchen?" -- eine Region, deren Haken jemand abgenommen hat, die aber noch „Wald-001" heisst, hat
 * noch keinen solchen Namen. Also: `true` verbirgt, und das Muster verbirgt IMMER.
 *
 * ⚠️ Server ⊇ Browser, gehalten ueber api/_internal/app/__tests__/fixtures/landschaft-autonamen.json.
 */
function avesmapsLandscapeSearchNameIsMachineGiven(string $name, ?bool $autoMerker, string $pattern): bool
{
    if ($autoMerker === true) {
        return true;
    }
    $name = trim($name);

    return $name === '' || preg_match($pattern, $name) === 1;
}

/**
 * PURE: region public_id => [normalisierter Name => true] ihrer EIGENEN Beschriftungen.
 *
 * 🔴 NACH IDENTITAET, NIE NACH NAMEN (Owner 14.09.2026). Ein gleichnamiges Label, das NICHT an der
 * Region haengt, nimmt ihr den Treffer nicht: „Ceälan" ist als Label ein Vulkan an anderer Stelle und
 * als Region eine Insel -- genau der Fall, der den Entwurf ausgeloest hat. Eine Namensregel haette
 * ausgerechnet ihn ausgeschlossen.
 *
 * 💣 Die Bindung kommt aus avesmapsEcosystemLabelRegionMap -- dem EINEN Leser beider Richtungen (Zeiger
 * an der Beschriftung, Zeiger an der Region). Er prueft jeden Zeiger gegen die aktiven Beschriftungen,
 * also zaehlt ein toter `label_public_id` (drei Regionen live) nicht.
 * ⚠️ Gefuettert aus den map_features-Zeilen, die die Suche OHNEHIN geladen hat -- keine zweite Abfrage.
 *
 * @param list<array<string, mixed>> $mapRows aktive map_features-Zeilen
 * @param list<array<string, mixed>> $regionRows aktive Regionen mit public_id und label_public_id
 * @param callable(array<string, mixed>, array<string, mixed>): string $labelName der Name, unter dem die
 *        Suche eine Beschriftung fuehrt -- hereingereicht, damit es keine zweite Fassung davon gibt
 * @return array<string, array<string, true>>
 */
function avesmapsLandscapeSearchOwnLabelNames(array $mapRows, array $regionRows, callable $labelName): array
{
    $activeLabelIds = [];
    $pointerRows = [];
    $namesByLabel = [];
    foreach ($mapRows as $row) {
        if ((string) ($row['feature_type'] ?? '') !== 'label') {
            continue;
        }
        $labelId = trim((string) ($row['public_id'] ?? ''));
        if ($labelId === '') {
            continue;
        }
        $activeLabelIds[] = $labelId;

        $rohwert = $row['properties_json'] ?? null;
        $properties = is_array($rohwert) ? $rohwert : json_decode((string) ($rohwert ?? ''), true);
        $properties = is_array($properties) ? $properties : [];

        $regionId = trim((string) ($properties['ecosystem_region_public_id'] ?? ''));
        if ($regionId !== '') {
            $pointerRows[] = ['public_id' => $labelId, 'region_public_id' => $regionId];
        }
        $namesByLabel[$labelId] = avesmapsNormalizeSearchText((string) $labelName($row, $properties));
    }

    $binding = avesmapsEcosystemLabelRegionMap($regionRows, $pointerRows, $activeLabelIds);
    $names = [];
    foreach ($binding['by_label'] as $labelId => $regionId) {
        $name = $namesByLabel[$labelId] ?? '';
        if ($name !== '') {
            $names[(string) $regionId][$name] = true;
        }
    }

    return $names;
}

/**
 * PURE: die Suchtreffer.
 *
 * Eine Region wird Treffer, wenn sie aktiv ist, mindestens eine aktive Flaeche hat, keine Klimazone ist,
 * einen echten Namen traegt und dieser Name auf keiner ihrer EIGENEN Beschriftungen steht (sonst ist die
 * Beschriftung schon der Treffer).
 *
 * 🔴 GRUPPIERT nach Ebene + Art + normalisiertem Namen: „Archipel der Perlen" sind fuenf Regionen und
 * EIN Treffer, dessen Huellbox ALLE ihre Flaechen umschliesst. Dieselbe Bauart wie die Wegegruppen im
 * Endpunkt. Gleicher Name auf zwei Ebenen („Große Öde" als Tiefebene und als Steppe) bleibt zwei
 * Treffer -- es sind zwei Dinge, und die Zeile sagt die Ebene dazu.
 *
 * @param list<array<string, mixed>> $regionRows aus avesmapsFetchLandscapeSearchRows
 * @param array<string, string> $typeLabels "<kind>|<type_key>" => Bezeichnung (aktive Arten)
 * @param list<string> $namePrefixes alle Artbezeichnungen, auch stillgelegte
 * @param array<string, array<string, true>> $ownLabelNames aus avesmapsLandscapeSearchOwnLabelNames
 * @return list<array<string, mixed>>
 */
function avesmapsBuildLandscapeSearchEntries(
    array $regionRows,
    array $typeLabels,
    array $namePrefixes,
    array $ownLabelNames
): array {
    $pattern = avesmapsLandscapeSearchAutoNamePattern($namePrefixes);
    $groups = [];

    foreach ($regionRows as $row) {
        $publicId = trim((string) ($row['public_id'] ?? ''));
        $kind = trim((string) ($row['kind'] ?? ''));
        if ($publicId === '' || $kind === '' || in_array($kind, AVESMAPS_LANDSCAPE_SEARCH_EXCLUDED_KINDS, true)) {
            continue;
        }
        // Ohne aktive Flaeche gibt es nichts anzufliegen.
        if (($row['min_x'] ?? null) === null || ($row['min_y'] ?? null) === null
            || ($row['max_x'] ?? null) === null || ($row['max_y'] ?? null) === null) {
            continue;
        }

        $name = trim((string) preg_replace('/\s+/u', ' ', (string) ($row['name'] ?? '')));
        if (avesmapsLandscapeSearchNameIsMachineGiven(
            $name,
            avesmapsEcosystemRegionAutoName($row['properties_json'] ?? null),
            $pattern
        )) {
            continue;
        }

        $normalizedName = avesmapsNormalizeSearchText($name);
        if ($normalizedName === '' || isset($ownLabelNames[$publicId][$normalizedName])) {
            continue;
        }

        $typeKey = trim((string) ($row['region_type'] ?? ''));
        $bbox = [
            'min_x' => (float) $row['min_x'],
            'min_y' => (float) $row['min_y'],
            'max_x' => (float) $row['max_x'],
            'max_y' => (float) $row['max_y'],
        ];
        $groupKey = $kind . '|' . $typeKey . '|' . $normalizedName;

        if (isset($groups[$groupKey])) {
            $groups[$groupKey]['public_ids'][] = $publicId;
            $groups[$groupKey]['min_x'] = min($groups[$groupKey]['min_x'], $bbox['min_x']);
            $groups[$groupKey]['min_y'] = min($groups[$groupKey]['min_y'], $bbox['min_y']);
            $groups[$groupKey]['max_x'] = max($groups[$groupKey]['max_x'], $bbox['max_x']);
            $groups[$groupKey]['max_y'] = max($groups[$groupKey]['max_y'], $bbox['max_y']);
            continue;
        }

        $typeLabel = avesmapsEcosystemRegionTypeLabel($typeLabels, $kind, $typeKey);
        $groups[$groupKey] = [
            'kind' => 'landscape',
            'public_id' => $publicId,
            'public_ids' => [$publicId],
            'name' => $name,
            // Nur die ART. Die Ebene setzt der Browser dazu -- ihre lesbaren Namen stehen dort
            // (ECOSYSTEM_KIND_LABELS), und eine zweite Tabelle hier waere die zweite Wahrheit.
            'type_label' => $typeLabel,
            'feature_subtype' => $typeKey,
            'ecosystem_kind' => $kind,
            'min_x' => $bbox['min_x'],
            'min_y' => $bbox['min_y'],
            'max_x' => $bbox['max_x'],
            'max_y' => $bbox['max_y'],
            'search_texts' => array_values(array_filter([$name, $typeLabel, $typeKey])),
        ];
    }

    return array_values($groups);
}

/**
 * Die Regionen samt Huellbox ihrer aktiven Flaechen, und der Artkatalog. EINE Abfrage je Tabelle.
 *
 * 💣 DIE HUELLBOX KOMMT AUS EINER ABLEITUNGSTABELLE, nicht aus einem GROUP BY ueber die Regionszeile:
 * die traegt eine JSON-Spalte, und je nach SQL-Modus lehnt MySQL ein GROUP BY ab, das sie nicht nennt --
 * waehrend SQLite es klaglos nimmt. Ein Test waere gruen und die Quelle live leer.
 * ⚠️ LEFT JOIN, und alle aktiven Regionen: die Label-Bindung (avesmapsEcosystemLabelRegionMap) soll
 * dieselben Regionen sehen wie ihr Leser in der Kartennutzlast. Ob eine Region Flaechen hat, entscheidet
 * der Bauer an der leeren Huellbox.
 * ⚠️ Keine Geometrie: die bbox-Spalten reichen fuer den Flug, und der Browser holt die Umrisse erst beim
 * Klick (?regions=).
 *
 * Fehlt eine Tabelle, faellt NUR diese Quelle aus -- protokolliert, nicht still: ein SQL-Fehler saehe
 * sonst genauso aus wie „es gibt keine Landschaft".
 *
 * @return array{regions: list<array<string, mixed>>, type_labels: array<string, string>, name_prefixes: list<string>}
 */
function avesmapsFetchLandscapeSearchRows(PDO $pdo): array
{
    try {
        $statement = $pdo->query(
            'SELECT r.public_id, r.name, r.kind, r.region_type, r.label_public_id, r.properties_json,
                    b.min_x, b.min_y, b.max_x, b.max_y
               FROM ecosystem_region r
               LEFT JOIN (
                    SELECT region_id,
                           MIN(min_x) AS min_x,
                           MIN(min_y) AS min_y,
                           MAX(max_x) AS max_x,
                           MAX(max_y) AS max_y
                      FROM ecosystem_area
                     WHERE is_active = 1
                     GROUP BY region_id
               ) b ON b.region_id = r.id
              WHERE r.is_active = 1
              ORDER BY r.id ASC'
        );
        $regions = $statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];

        $typeStatement = $pdo->query('SELECT kind, type_key, label, is_active FROM ecosystem_region_type');
        $typeLabels = [];
        $namePrefixes = [];
        foreach ($typeStatement !== false ? $typeStatement->fetchAll(PDO::FETCH_ASSOC) : [] as $typeRow) {
            $label = (string) ($typeRow['label'] ?? '');
            $namePrefixes[] = $label;
            if ((int) ($typeRow['is_active'] ?? 0) === 1) {
                $typeLabels[((string) ($typeRow['kind'] ?? '')) . '|' . ((string) ($typeRow['type_key'] ?? ''))] = $label;
            }
        }
    } catch (Throwable $exception) {
        error_log('Kartensuche: Landschaften nicht lesbar -- ' . $exception->getMessage());
        return ['regions' => [], 'type_labels' => [], 'name_prefixes' => []];
    }

    return ['regions' => $regions, 'type_labels' => $typeLabels, 'name_prefixes' => $namePrefixes];
}
