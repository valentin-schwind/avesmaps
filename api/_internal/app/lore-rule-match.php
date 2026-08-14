<?php

declare(strict_types=1);

// Die UMGEKEHRTE Frage: nicht "welche Objekte trifft diese Regel" (lore-rule.php,
// avesmapsLoreRuleEvaluate -- der Editor, ganzer Bestand, Punkt-in-Polygon), sondern
// "welche Regeln treffen dieses eine Objekt". Der oeffentliche Lesepfad stellt nur diese
// Frage, fuer genau ein Objekt, und sie ist ein JOIN ueber schon gerechnete Zeilen, keine
// Geometrie. Dieselbe Reinheitszusage wie lore-rule.php und climate-membership.php: die
// drei Kernfunktionen bekommen kein PDO, laufen nicht beim Einbinden, kein DDL.
//
// 🔴 avesmapsLoreRuleReadPlaces (lore-rule-store.php) ist HIER KEIN VORBILD -- sie rechnet
// Punkt-in-Polygon ueber den ganzen Ortsbestand (~2.800 Zeilen) fuer den EDITOR. Auf dem
// oeffentlichen Lesepfad ist genau diese Rechnung die Last, die am 17.07.2026 den
// PHP-Worker-Pool auf STRATO erschoepft hat (siehe php-pool-hang-incident-2026-07-17). Die
// beiden Leser hier unten fragen stattdessen NUR nach dem einen angefragten Objekt.
//
// Entwurf: docs/superpowers/specs/2026-08-12-vorkommen-lebensraum-regel-design.md

// Fuer die beiden Leser ganz unten: dieselbe Klimawahrheit wie die Infobox-Zeile
// "Klimazone" (avesmapsClimateZoneKeyAt/avesmapsClimateReadBands) und dieselbe Schwelle
// (AVESMAPS_CLIMATE_REGION_MIN_SHARE), keine zweite Rechnung.
require_once __DIR__ . '/climate-membership.php';
// avesmapsLoreRuleTermMatchesSubject ruft avesmapsLoreRuleZoneKeys() -- die Funktion wohnt in
// lore-rule.php, nicht hier. Ohne diese Zeile bindet ein Aufrufer, der nur diese Datei einbindet
// (der oeffentliche Lesepfad tut genau das), eine unbekannte Funktion ein -- Fatal Error, HTTP
// 500. Vorbild: lore-rule-store.php bindet ebenso jede Datei ein, aus der es eine Funktion ruft.
require_once __DIR__ . '/lore-rule.php';
// Aus demselben Grund: avesmapsLoreRuleEntriesForSubject (ganz unten) ruft
// avesmapsLoreRuleOrderedZoneKeys() -- die Funktion wohnt in lore-rule-store.php.
require_once __DIR__ . '/lore-rule-store.php';

// 🔴 Deckel, Task 9 Schritt 1: ein Weg oder eine Etappe beruehrt eine Handvoll Flaechen, nie
// hunderte -- 25 reicht. Aber NIE STILL: dieselbe Falle wie bei avesmapsEcosystemParseRegionFilter
// (ecosystem.php), die genau diese Woche 31 Waelder lautlos verschluckt hat, weil ein Filter einen
// fremden Deckel samt Begruendung geerbt hatte, aber nicht dessen `truncated`-Feld.
// avesmapsLoreRuleReadSubjectsForAreas gibt truncated MIT zurueck -- der Aufrufer (api/app/lore.php)
// entscheidet, wie er es zeigt, aber er bekommt es zu sehen.
const AVESMAPS_LORE_RULE_AREA_LIMIT = 25;

/**
 * PURE: eine Flaeche als ihr eigenes Subjekt.
 *
 * Eine Flaeche ist genau EINE Art (kind/region_type) und beruehrt eine oder mehrere Zonen --
 * `zones` wandert unveraendert durch, das ist dieselbe Aussage wie in lore-rule.php.
 *
 * @param array{public_id: string, kind: string, region_type: string, zones: list<string>} $area
 * @return array{public_id: string, area_public_ids: list<string>, types: list<array{kind: string, region_type: string}>, zones: list<string>}
 */
function avesmapsLoreRuleSubjectFromArea(array $area): array
{
    $publicId = (string) ($area['public_id'] ?? '');

    return [
        'public_id' => $publicId,
        // Eine Flaeche ist ihre eigene Identitaet -- eine Bedingung "Flaechenname = X" muss
        // die Flaeche X selbst treffen, ohne dass avesmapsLoreRuleTermMatchesSubject zwei
        // verschiedene Felder (public_id vs. area_public_ids) je nach Subjektart kennen muss.
        'area_public_ids' => [$publicId],
        'types' => [[
            'kind' => (string) ($area['kind'] ?? ''),
            'region_type' => (string) ($area['region_type'] ?? ''),
        ]],
        'zones' => array_values((array) ($area['zones'] ?? [])),
    ];
}

/**
 * PURE: eine Siedlung als Subjekt -- Arten geerbt, Zone NICHT geerbt.
 *
 * 💣 Der Unterschied, der die ganze Regel traegt: eine FLAECHE kann mehrere Klimazonen
 * BERUEHREN (der Finsterkamm beruehrt boreal und gemaessigt), eine SIEDLUNG darin liegt in
 * genau EINER. Von den 44 Siedlungen im Finsterkamm liegen nur 4 im borealen Band -- wer der
 * Siedlung die Zonen ihrer Flaeche vererbt, macht aus 4 Treffern 44. Deshalb kommt `zones`
 * hier IMMER aus `$place['zone']` (der gerechneten Punktzone), nie aus einer der Flaechen in
 * `$areasById`. `types` dagegen IST die Vereinigung ueber alle Flaechen, in denen die Siedlung
 * liegt -- das ist die Frage "von welcher Art ist die Umgebung", die eine Flaeche allein nicht
 * beantworten kann, sobald ein Ort (der "Bergwald") in mehreren liegt.
 *
 * @param array{public_id: string, zone: string, area_public_ids: list<string>} $place
 * @param array<string, array{public_id: string, kind: string, region_type: string, zones?: list<string>}> $areasById
 * @return array{public_id: string, area_public_ids: list<string>, types: list<array{kind: string, region_type: string}>, zones: list<string>}
 */
function avesmapsLoreRuleSubjectFromPlace(array $place, array $areasById): array
{
    $areaIds = array_values(array_map('strval', (array) ($place['area_public_ids'] ?? [])));

    $types = [];
    $seen = [];
    // In der Reihenfolge der Flaechenliste, nicht dedupliziert erst am Ende: dieselbe
    // "Ausgabe folgt der Eingabe"-Zusage wie avesmapsLoreRuleEvaluate.
    foreach ($areaIds as $areaId) {
        $area = $areasById[$areaId] ?? null;
        if ($area === null) {
            continue;
        }
        $kind = (string) ($area['kind'] ?? '');
        $regionType = (string) ($area['region_type'] ?? '');
        $key = $kind . '|' . $regionType;
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $types[] = ['kind' => $kind, 'region_type' => $regionType];
    }

    return [
        'public_id' => (string) ($place['public_id'] ?? ''),
        'area_public_ids' => $areaIds,
        'types' => $types,
        'zones' => [(string) ($place['zone'] ?? '')],
    ];
}

/**
 * PURE: trifft diese Bedingung dieses Subjekt?
 *
 * Dieselben drei Fragen, dieselbe UND-Verknuepfung wie avesmapsLoreRuleTermMatchesArea:
 * "heisst so" (Identitaet) · "ist von dieser Art" (mehrere Typen an der Bedingung = ODER,
 * mehrere Typen am Subjekt ebenfalls ODER -- irgendein Paar muss passen) · "liegt in dieser
 * Zone". Ein leeres Feld fragt nicht.
 *
 * Die Identitaet prueft gegen ZWEI Felder: `$subject['public_id']` (das Subjekt selbst) ODER
 * eines seiner `$subject['area_public_ids']` (die Flaechen, in denen es liegt). Fuer eine
 * Flaeche als Subjekt sind das dieselbe eine ID; fuer eine Siedlung deckt es "die Regel nennt
 * die Flaeche, in der ich liege" ab -- die Siedlung im Farindel wird von einer Bedingung
 * "Flaechenname = Farindel" mitgetroffen, nicht nur die Flaeche selbst.
 *
 * @param array<string, mixed> $term
 * @param array{public_id: string, area_public_ids: list<string>, types: list<array{kind: string, region_type: string}>, zones: list<string>} $subject
 * @param list<string> $orderedZoneKeys
 */
function avesmapsLoreRuleTermMatchesSubject(array $term, array $subject, array $orderedZoneKeys): bool
{
    $wanted = $term['area_public_id'] ?? null;
    if ($wanted !== null) {
        $ownId = (string) ($subject['public_id'] ?? '');
        $areaIds = (array) ($subject['area_public_ids'] ?? []);
        if ($ownId !== $wanted && !in_array($wanted, $areaIds, true)) {
            return false;
        }
    }

    $types = $term['types'] ?? [];
    if ($types !== []) {
        $hit = false;
        foreach ((array) ($subject['types'] ?? []) as $subjectType) {
            $subjectKind = (string) ($subjectType['kind'] ?? '');
            $subjectRegionType = (string) ($subjectType['region_type'] ?? '');
            foreach ($types as $type) {
                if ((string) ($type['kind'] ?? '') === $subjectKind
                    && (string) ($type['region_type'] ?? '') === $subjectRegionType) {
                    $hit = true;
                    break 2;
                }
            }
        }
        if (!$hit) {
            return false;
        }
    }

    $zoneKeys = avesmapsLoreRuleZoneKeys($orderedZoneKeys, $term['climate_from'] ?? null, $term['climate_to'] ?? null);
    if ($zoneKeys !== [] && array_intersect($zoneKeys, (array) ($subject['zones'] ?? [])) === []) {
        return false;
    }

    return true;
}

/**
 * Liest EINE Flaeche als Subjekt -- fuer den oeffentlichen Lesepfad, nicht fuer den Editor.
 *
 * Vorbild: avesmapsLoreRuleReadAreas (lore-rule-store.php), fast wortgleich, aber auf eine
 * einzelne public_id eingeschraenkt statt auf den ganzen Bestand. Das redundant wirkende
 * `IN (...)` ist von dort uebernommen und aus demselben Grund noetig: ecosystem_region_overlap
 * haelt jedes beruehrende Flaechenpaar in BEIDEN Richtungen, tausende Zeilen, und nur eine
 * Handvoll betrifft ein Klimaband. Der JOIN allein wuerde richtig filtern, aber die ganze
 * Tabelle lesen; das IN laesst idx_ecosystem_overlap_other den Index nutzen.
 *
 * null, wenn es die Flaeche nicht gibt (falsche/geloeschte public_id, inaktiv, oder
 * `r.kind = 'klima'` -- ein Klimaband ist selbst keine Flaeche im Sinne einer Regel) ODER wenn
 * die ecosystem-Tabellen fehlen. Kein 500 auf dem oeffentlichen Lesepfad.
 */
function avesmapsLoreRuleReadSubjectForArea(PDO $pdo, string $areaPublicId): ?array
{
    $areaPublicId = trim($areaPublicId);
    if ($areaPublicId === '') {
        return null;
    }

    try {
        $statement = $pdo->prepare(
            "SELECT r.public_id, r.kind, r.region_type, k.region_type AS zone_key, o.share
               FROM ecosystem_region r
               LEFT JOIN ecosystem_region_overlap o
                 ON o.region_id = r.id
                AND o.other_region_id IN (SELECT id FROM ecosystem_region WHERE kind = 'klima' AND is_active = 1)
               LEFT JOIN ecosystem_region k ON k.id = o.other_region_id AND k.kind = 'klima' AND k.is_active = 1
              WHERE r.is_active = 1 AND r.kind <> 'klima' AND r.public_id = :area"
        );
        $statement->execute(['area' => $areaPublicId]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return null;
    }

    if ($rows === false || $rows === []) {
        return null;
    }

    $area = [
        'public_id' => (string) $rows[0]['public_id'],
        'kind' => (string) $rows[0]['kind'],
        'region_type' => (string) $rows[0]['region_type'],
        'zones' => [],
    ];
    foreach ($rows as $row) {
        $zone = trim((string) ($row['zone_key'] ?? ''));
        $share = (float) ($row['share'] ?? 0);
        // ⚠️ Dieselbe Schwelle wie avesmapsLoreRuleReadAreas und die Infobox-Zeile "Klimazone":
        // unterhalb von AVESMAPS_CLIMATE_REGION_MIN_SHARE ist eine Randberuehrung Rauschen.
        if ($zone !== '' && $share >= AVESMAPS_CLIMATE_REGION_MIN_SHARE
            && !in_array($zone, $area['zones'], true)) {
            $area['zones'][] = $zone;
        }
    }

    return avesmapsLoreRuleSubjectFromArea($area);
}

/**
 * Liest EINEN Ort als Subjekt -- fuer den oeffentlichen Lesepfad, nicht fuer den Editor.
 *
 * Die Flaechen kommen ueber denselben Weg wie in avesmapsLoreRuleReadPlaces
 * (location_ecosystem -> ecosystem_area -> ecosystem_region), aber nur fuer die eine
 * angefragte public_id -- kein Scan ueber den ganzen Ortsbestand.
 *
 * 💣 Die Zone eines Ortes ist KEINE Spalte -- sie wird aus den Koordinaten in `geometry_json`
 * gerechnet (avesmapsClimateZoneKeyAt gegen avesmapsClimateReadBands), dieselbe Wahrheit wie
 * die Infobox-Zeile "Klimazone". Die Baender werden EINMAL je Aufruf geholt, nie je Zeile --
 * das war in Sitzung 1 schon einmal ein Planfehler (siehe avesmapsLoreRuleReadPlaces).
 *
 * null, wenn es den Ort nicht gibt (falsche/geloeschte public_id, inaktiv, kein `location`)
 * ODER wenn eine der beteiligten Tabellen fehlt. Kein 500 auf dem oeffentlichen Lesepfad.
 */
function avesmapsLoreRuleReadSubjectForLocation(PDO $pdo, string $locationPublicId): ?array
{
    $locationPublicId = trim($locationPublicId);
    if ($locationPublicId === '') {
        return null;
    }

    try {
        $statement = $pdo->prepare(
            "SELECT f.public_id, f.geometry_json,
                    r.public_id AS area_public_id, r.kind, r.region_type
               FROM map_features f
               LEFT JOIN location_ecosystem le ON le.location_id = f.id
               LEFT JOIN ecosystem_area a ON a.id = le.area_id AND a.is_active = 1
               LEFT JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
              WHERE f.feature_type = 'location' AND f.is_active = 1 AND f.public_id = :location"
        );
        $statement->execute(['location' => $locationPublicId]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return null;
    }

    if ($rows === false || $rows === []) {
        return null;
    }

    $geometry = json_decode((string) ($rows[0]['geometry_json'] ?? ''), true);
    $coordinates = is_array($geometry) ? ($geometry['coordinates'] ?? null) : null;
    $x = is_array($coordinates) ? (float) ($coordinates[0] ?? 0.0) : 0.0;
    $y = is_array($coordinates) ? (float) ($coordinates[1] ?? 0.0) : 0.0;

    // Einmal je Aufruf geholt, nie je Zeile -- dieselbe Regel wie avesmapsLoreRuleReadPlaces
    // und avesmapsClimateApplyToFeatures.
    $bands = avesmapsClimateReadBands($pdo);

    $areaIds = [];
    $areasById = [];
    foreach ($rows as $row) {
        $areaId = $row['area_public_id'] ?? null;
        if ($areaId === null) {
            continue;
        }
        $areaId = (string) $areaId;
        if (!in_array($areaId, $areaIds, true)) {
            $areaIds[] = $areaId;
        }
        $areasById[$areaId] = [
            'public_id' => $areaId,
            'kind' => (string) ($row['kind'] ?? ''),
            'region_type' => (string) ($row['region_type'] ?? ''),
        ];
    }

    $place = [
        'public_id' => (string) $rows[0]['public_id'],
        'area_public_ids' => $areaIds,
        'zone' => avesmapsClimateZoneKeyAt($bands, $x, $y),
    ];

    return avesmapsLoreRuleSubjectFromPlace($place, $areasById);
}

/**
 * Liest MEHRERE Flaechen als Subjekte auf einmal -- Task 9 Schritt 1 (Weg, Etappe: sie beruehren
 * mehr als eine Flaeche, anders als eine Landschaftsflaeche oder eine Siedlung).
 *
 * Vorbild: avesmapsLoreRuleReadAreas (lore-rule-store.php), dieselbe Form und dieselbe Schwelle
 * (AVESMAPS_CLIMATE_REGION_MIN_SHARE), aber EINE Abfrage fuer GENAU die genannten public_id statt
 * fuer den ganzen Bestand. Das redundant wirkende IN (SELECT id FROM ecosystem_region WHERE
 * kind = 'klima' ...) ist von dort uebernommen und aus demselben Grund noetig (Index statt
 * Tabellenscan auf ecosystem_region_overlap).
 *
 * 🔴 EINE Abfrage fuer alle genannten Flaechen, nie eine je Flaeche -- derselbe Grund wie im
 * Kopfkommentar dieser Datei (PHP-Worker-Pool-Vorfall vom 17.07.2026).
 *
 * @param list<string> $areaPublicIds
 * @return array{subjects: list<array{public_id: string, area_public_ids: list<string>, types: list<array{kind: string, region_type: string}>, zones: list<string>}>, truncated: bool}
 */
function avesmapsLoreRuleReadSubjectsForAreas(PDO $pdo, array $areaPublicIds): array
{
    $ids = [];
    foreach ($areaPublicIds as $candidate) {
        $candidate = trim((string) $candidate);
        if ($candidate !== '' && !in_array($candidate, $ids, true)) {
            $ids[] = $candidate;
        }
    }
    if ($ids === []) {
        return ['subjects' => [], 'truncated' => false];
    }

    // 💣 Die Grenze gilt VOR der Abfrage, nicht danach -- eine Implementierung, die erst alles liest
    // und dann wegwirft, haette denselben stillen Fehler nur eine Abfrage zu spaet. truncated wird
    // hier gesetzt, nicht erst beim Aufrufer erraten.
    $truncated = count($ids) > AVESMAPS_LORE_RULE_AREA_LIMIT;
    $ids = array_slice($ids, 0, AVESMAPS_LORE_RULE_AREA_LIMIT);

    try {
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $statement = $pdo->prepare(
            "SELECT r.public_id, r.kind, r.region_type, k.region_type AS zone_key, o.share
               FROM ecosystem_region r
               LEFT JOIN ecosystem_region_overlap o
                 ON o.region_id = r.id
                AND o.other_region_id IN (SELECT id FROM ecosystem_region WHERE kind = 'klima' AND is_active = 1)
               LEFT JOIN ecosystem_region k ON k.id = o.other_region_id AND k.kind = 'klima' AND k.is_active = 1
              WHERE r.is_active = 1 AND r.kind <> 'klima' AND r.public_id IN ($placeholders)"
        );
        $statement->execute($ids);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return ['subjects' => [], 'truncated' => $truncated];
    }

    $byId = [];
    foreach (($rows ?: []) as $row) {
        $publicId = (string) $row['public_id'];
        if (!isset($byId[$publicId])) {
            $byId[$publicId] = [
                'public_id' => $publicId,
                'kind' => (string) $row['kind'],
                'region_type' => (string) $row['region_type'],
                'zones' => [],
            ];
        }
        $zone = trim((string) ($row['zone_key'] ?? ''));
        $share = (float) ($row['share'] ?? 0);
        if ($zone !== '' && $share >= AVESMAPS_CLIMATE_REGION_MIN_SHARE
            && !in_array($zone, $byId[$publicId]['zones'], true)) {
            $byId[$publicId]['zones'][] = $zone;
        }
    }

    // Ausgabereihenfolge folgt der EINGABE ($ids), nicht der SQL-Zeilenreihenfolge -- eine
    // public_id, die es nicht (mehr) gibt, faellt dabei einfach heraus.
    $subjects = [];
    foreach ($ids as $id) {
        if (isset($byId[$id])) {
            $subjects[] = avesmapsLoreRuleSubjectFromArea($byId[$id]);
        }
    }

    return ['subjects' => $subjects, 'truncated' => $truncated];
}

/**
 * Liest die Flaechen EINES Herrschaftsgebiets als Subjekte -- Task 9 Schritt 2. Ein Gebiet hat
 * KEINE eigenen Regions-IDs (anders als Weg/Etappe, siehe Kopfkommentar der Datei); sie kommen aus
 * ecosystem_region_territory, derselben Tabelle, die avesmapsClimateReadTerritoryZones
 * (climate-membership.php) fuer die Klimazonen-Zeile schon liest -- hier nur NICHT auf
 * kind = 'klima' eingeschraenkt, denn hier werden die Flaechen selbst gesucht, nicht ihre Zonen.
 *
 * ⚠️ Keine zweite Anteilsschwelle: AVESMAPS_CLIMATE_REGION_MIN_SHARE entscheidet hier wie dort, ob
 * eine Flaeche das Gebiet ueberhaupt "beruehrt" -- nicht neu erfunden.
 *
 * Danach dieselben Subjekte wie Schritt 1 (avesmapsLoreRuleReadSubjectsForAreas): eine Flaeche, die
 * ein Gebiet beruehrt, ist keine andere Flaeche als eine, die ein Weg beruehrt -- EINE Funktion,
 * zwei Aufrufer, kein zweiter Subjekt-Bauer.
 *
 * @return array{subjects: list<array{public_id: string, area_public_ids: list<string>, types: list<array{kind: string, region_type: string}>, zones: list<string>}>, truncated: bool}
 */
function avesmapsLoreRuleReadSubjectsForTerritory(PDO $pdo, string $territoryPublicId): array
{
    $territoryPublicId = trim($territoryPublicId);
    if ($territoryPublicId === '') {
        return ['subjects' => [], 'truncated' => false];
    }

    try {
        $statement = $pdo->prepare(
            "SELECT r.public_id
               FROM ecosystem_region_territory rt
               JOIN ecosystem_region r ON r.id = rt.region_id AND r.is_active = 1 AND r.kind <> 'klima'
              WHERE rt.territory_public_id = :territory AND rt.share >= :threshold
              ORDER BY rt.share DESC, r.public_id"
        );
        $statement->execute(['territory' => $territoryPublicId, 'threshold' => AVESMAPS_CLIMATE_REGION_MIN_SHARE]);
        $areaIds = $statement->fetchAll(PDO::FETCH_COLUMN);
    } catch (Throwable) {
        return ['subjects' => [], 'truncated' => false];
    }

    if ($areaIds === false || $areaIds === []) {
        return ['subjects' => [], 'truncated' => false];
    }

    return avesmapsLoreRuleReadSubjectsForAreas($pdo, array_map('strval', $areaIds));
}

/**
 * Alle aktiven Regeln ALLER Eintraege -- fuer den oeffentlichen Lesepfad, nicht fuer den Editor.
 *
 * Vorbild: avesmapsLoreRuleReadForEntry (lore-rule-store.php), aber ohne den Eintragsfilter und
 * mit GENAU DREI Abfragen fuer den ganzen Bestand -- nie eine je Regel. Ein N+1 hier waere die
 * Wiederholung des Vorfalls vom 17.07.2026 (siehe Kopfkommentar dieser Datei), nur mit Regeln
 * statt Punkt-in-Polygon.
 *
 * 🔴 Kein DDL: kein avesmapsLoreRuleEnsureTables-Aufruf hier. Fehlt eine der drei Tabellen, gibt
 * es eine leere Liste, nie einen Fehler -- derselbe Vertrag wie avesmapsLoreRuleOrderedZoneKeys.
 *
 * @return list<array{entry_wiki_key: string, relation: string, terms: list<array<string,mixed>>}>
 */
function avesmapsLoreRuleReadAllActive(PDO $pdo): array
{
    try {
        $rules = $pdo->query(
            "SELECT id, entry_wiki_key, relation FROM lore_rule
              WHERE status = 'active' ORDER BY entry_wiki_key, sort_order, id"
        );
        $ruleRows = $rules === false ? [] : $rules->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }
    if ($ruleRows === []) {
        return [];
    }

    $ruleIds = array_map(static fn (array $row): int => (int) $row['id'], $ruleRows);
    $rulePlaceholders = implode(',', array_fill(0, count($ruleIds), '?'));

    try {
        // Zweite Abfrage: alle Bedingungen aller Regeln auf einmal.
        $termStatement = $pdo->prepare(
            "SELECT id, rule_id, join_op, area_public_id, climate_from, climate_to
               FROM lore_rule_term WHERE rule_id IN ($rulePlaceholders) ORDER BY rule_id, seq"
        );
        $termStatement->execute($ruleIds);
        $termRows = $termStatement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        // Dritte Abfrage: alle Arten aller Bedingungen auf einmal -- nicht neu je Bedingung.
        $typesByTerm = [];
        $termIds = array_map(static fn (array $row): int => (int) $row['id'], $termRows);
        if ($termIds !== []) {
            $termPlaceholders = implode(',', array_fill(0, count($termIds), '?'));
            $typeStatement = $pdo->prepare(
                "SELECT term_id, kind, region_type FROM lore_rule_term_type
                  WHERE term_id IN ($termPlaceholders) ORDER BY term_id, kind, region_type"
            );
            $typeStatement->execute($termIds);
            foreach ($typeStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $typeRow) {
                $typesByTerm[(int) $typeRow['term_id']][] = [
                    'kind' => (string) $typeRow['kind'],
                    'region_type' => (string) $typeRow['region_type'],
                ];
            }
        }
    } catch (Throwable) {
        return [];
    }

    $termsByRule = [];
    foreach ($termRows as $termRow) {
        $termsByRule[(int) $termRow['rule_id']][] = [
            'join_op' => (string) $termRow['join_op'],
            'area_public_id' => $termRow['area_public_id'] !== null ? (string) $termRow['area_public_id'] : null,
            'climate_from' => $termRow['climate_from'] !== null ? (string) $termRow['climate_from'] : null,
            'climate_to' => $termRow['climate_to'] !== null ? (string) $termRow['climate_to'] : null,
            'types' => $typesByTerm[(int) $termRow['id']] ?? [],
        ];
    }

    $out = [];
    foreach ($ruleRows as $row) {
        $out[] = [
            'entry_wiki_key' => (string) $row['entry_wiki_key'],
            'relation' => (string) $row['relation'],
            'terms' => $termsByRule[(int) $row['id']] ?? [],
        ];
    }

    return $out;
}

/**
 * PURE: trifft die ganze Kette dieses Subjekt? Wahr/falsch statt Mengen -- dieselbe Kette wie
 * avesmapsLoreRuleEvaluate, aber fuer EIN Subjekt vereinfacht. 'und' ist logisches Und, 'oder'
 * logisches Oder, ausgewertet strikt LINKS NACH RECHTS ohne Klammern -- dieselbe Reihenfolge wie
 * im Editor, sonst zeigt Suche/Infobox etwas anderes als die Vorschau. Eine Kette OHNE
 * Bedingungen trifft niemanden, nicht "alles" (der Schreibpfad laesst so eine Regel gar nicht
 * erst zu, siehe avesmapsLoreRuleChainIsUnbounded).
 *
 * 🔴 Fix-Runde 1 (Task 5, Befund 2): diese Auswertung stand vorher WOERTLICH ZWEIMAL im Code --
 * hier und in api/_internal/app/lore-search.php. Genau diese Kette hat in dieser Sitzung schon
 * einmal fast eine lautlose Divergenz erzeugt (Task 2, Fix-Runde 1: eine Praezedenz-Lesart
 * "UND bindet staerker" ueberlebte die erste Testfassung); waere sie in nur EINER von zwei
 * Kopien gelandet, haette die Suche etwas anderes gefunden als die Infobox zeigt, bei denselben
 * Daten, ohne Fehlermeldung. Jetzt EINE Stelle, zwei Aufrufer.
 *
 * @param list<array<string,mixed>> $terms
 * @param array{public_id: string, area_public_ids: list<string>, types: list<array{kind: string, region_type: string}>, zones: list<string>} $subject
 * @param list<string> $orderedZoneKeys
 */
function avesmapsLoreRuleChainMatchesSubject(array $terms, array $subject, array $orderedZoneKeys): bool
{
    if ($terms === []) {
        return false;
    }

    $result = null;
    foreach (array_values($terms) as $index => $term) {
        $matches = avesmapsLoreRuleTermMatchesSubject($term, $subject, $orderedZoneKeys);
        if ($index === 0) {
            $result = $matches;
            continue;
        }
        $join = (string) ($term['join_op'] ?? 'und');
        $result = $join === 'oder' ? ($result || $matches) : ($result && $matches);
    }

    return $result === true;
}

/**
 * Fuer MEHRERE Subjekte (Task 9: Weg, Etappe, Herrschaftsgebiet -- sie beruehren mehr als eine
 * Flaeche): entry_wiki_key => relation aller aktiven Regeln, die IRGENDEINES der Subjekte treffen
 * -- Vereinigung, nicht Schnitt. Ein Weg durch Wald UND Gebirge zeigt beides; eine Regel, die nur
 * fuer den Wald-Abschnitt gilt, darf nicht daran scheitern, dass der Gebirgs-Abschnitt sie
 * verfehlt.
 *
 * Holt den ganzen Regelbestand (avesmapsLoreRuleReadAllActive, drei Abfragen) und die
 * Zonenreihenfolge (avesmapsLoreRuleOrderedZoneKeys) GENAU EINMAL je Aufruf -- nicht je Subjekt
 * und nicht je Regel --, wertet beides dann rein in PHP gegen jedes Subjekt aus.
 *
 * @param list<array{public_id: string, area_public_ids: list<string>, types: list<array{kind: string, region_type: string}>, zones: list<string>}> $subjects
 * @return array<string, string> entry_wiki_key => relation
 */
function avesmapsLoreRuleEntriesForSubjects(PDO $pdo, array $subjects): array
{
    if ($subjects === []) {
        return [];
    }

    $rules = avesmapsLoreRuleReadAllActive($pdo);
    if ($rules === []) {
        return [];
    }

    // Einmal je Aufruf geholt, nie je Subjekt und nie je Regel.
    $orderedZoneKeys = avesmapsLoreRuleOrderedZoneKeys($pdo);

    $out = [];
    foreach ($rules as $rule) {
        foreach ($subjects as $subject) {
            // 🔴 Ruft avesmapsLoreRuleChainMatchesSubject -- ruft sie, schreibt sie nicht ab (siehe
            // Kopfkommentar dieser Datei: genau diese Kette stand einmal woertlich zweimal im Code,
            // und eine Praezedenz-Lesart ueberlebte dabei die erste Testfassung in der einen Kopie).
            if (avesmapsLoreRuleChainMatchesSubject($rule['terms'], $subject, $orderedZoneKeys)) {
                $out[$rule['entry_wiki_key']] = $rule['relation'];
                break; // Vereinigung: EIN Treffer reicht, die anderen Subjekte muessen nicht auch
            }
        }
    }

    return $out;
}

/**
 * Fuer EIN Subjekt: entry_wiki_key => relation aller aktiven Regeln, die es treffen.
 *
 * Ein Sonderfall von avesmapsLoreRuleEntriesForSubjects mit genau einem Subjekt -- ruft sie, statt
 * den Regelbestand-plus-Auswertung-Ablauf ein zweites Mal hinzuschreiben.
 *
 * @param array{public_id: string, area_public_ids: list<string>, types: list<array{kind: string, region_type: string}>, zones: list<string>} $subject
 * @return array<string, string> entry_wiki_key => relation
 */
function avesmapsLoreRuleEntriesForSubject(PDO $pdo, array $subject): array
{
    return avesmapsLoreRuleEntriesForSubjects($pdo, [$subject]);
}
