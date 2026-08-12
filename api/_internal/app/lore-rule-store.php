<?php

declare(strict_types=1);

// Schema, Lesen und Schreiben der Lebensraum-Regeln. Die REINE Auswertung steht in
// lore-rule.php und bekommt bewusst kein PDO.
//
// 💣 EIGENE TABELLEN, nicht lore_place -- und das ist keine Umgehung der Warnung in
// AGENTS.md §5, sondern ihr Gegenteil: lore_place speichert eine ANTWORT (dieser Ort),
// lore_rule eine FRAGE (welche Orte). Eine Regel hat keinen place_wiki_key; ein
// synthetischer Schluessel muesste auf dem heissen Lesepfad geparst werden.
//
// 💣 Eine Regel ist IMMER origin='manual'. avesmapsLoreReconcile legt Ortszeilen per
// delete+insert neu an und fasst nur origin='wiki' an -- eine Regel mit origin='wiki'
// waere beim naechsten „Vorkommen syncen" weg. Der Sync kennt diese Tabellen nicht.

// Fuer avesmapsLoreRuleReadPlaces: die Klimazone eines Ortes ist keine gespeicherte Spalte,
// sondern wird aus den Baendern gerechnet (dieselbe Wahrheit wie die Infobox-Zeile
// "Klimazone", avesmapsClimateApplyToFeatures). Und "ist eine Kreuzung" ist ein Praedikat,
// keine Spalte -- dasselbe Praedikat wie das Routennetz, nicht der Name.
require_once __DIR__ . '/climate-membership.php';
require_once __DIR__ . '/../routing/network-data.php';

/** Selbstheilendes Schema. NUR aus Editor-Zweigen aufrufen, nie im heissen Lesepfad. */
function avesmapsLoreRuleEnsureTables(PDO $pdo): void
{
    // ⚠️ Zwei Dialekte, EIN Schema: die Tests laufen gegen sqlite (es gibt lokal keine
    // MySQL-Instanz, siehe AGENTS.md), scharf laeuft MySQL. sqlite kennt kein
    // AUTO_INCREMENT/ENGINE, MySQL kein "CREATE INDEX IF NOT EXISTS" vor 8.0.
    $sqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    $id = $sqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY';
    $tail = $sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    $now = $sqlite ? 'CURRENT_TIMESTAMP' : 'CURRENT_TIMESTAMP(3)';
    $stamp = $sqlite ? 'DATETIME' : 'DATETIME(3)';

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS lore_rule (
            id             ' . $id . ',
            entry_wiki_key VARCHAR(190) NOT NULL,
            relation       VARCHAR(20) NOT NULL DEFAULT \'verbreitung\',
            origin         VARCHAR(16) NOT NULL DEFAULT \'manual\',
            status         VARCHAR(16) NOT NULL DEFAULT \'active\',
            sort_order     INT NOT NULL DEFAULT 0,
            created_at     ' . $stamp . ' NOT NULL DEFAULT ' . $now . ',
            created_by     BIGINT UNSIGNED NULL'
        . ($sqlite ? '' : ', KEY idx_lore_rule_entry (entry_wiki_key, status)') . ')' . $tail
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS lore_rule_term (
            id             ' . $id . ',
            rule_id        BIGINT UNSIGNED NOT NULL,
            seq            INT NOT NULL,
            join_op        VARCHAR(4) NOT NULL DEFAULT \'und\',
            area_public_id CHAR(36) NULL,
            climate_from   VARCHAR(60) NULL,
            climate_to     VARCHAR(60) NULL,
            UNIQUE ' . ($sqlite ? '' : 'KEY uq_lore_rule_term ') . '(rule_id, seq)'
        . ($sqlite ? '' : ', KEY idx_lore_rule_term_area (area_public_id)') . ')' . $tail
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS lore_rule_term_type (
            term_id     BIGINT UNSIGNED NOT NULL,
            kind        VARCHAR(20) NOT NULL,
            region_type VARCHAR(60) NOT NULL,
            PRIMARY KEY (term_id, kind, region_type)'
        . ($sqlite ? '' : ', KEY idx_lore_rule_term_type_lookup (kind, region_type)') . ')' . $tail
    );
    if ($sqlite) {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_lore_rule_entry ON lore_rule (entry_wiki_key, status)');
    }
}

/**
 * Legt eine Regel an oder ERSETZT die Bedingungen einer bestehenden.
 *
 * Ersetzen, nicht anhaengen: die Reihenfolge der Bedingungen IST die Auswertungsreihenfolge,
 * und eine halb ersetzte Kette rechnet still etwas anderes als die Vorschau zeigte.
 *
 * @param list<array<string,mixed>> $terms
 */
function avesmapsLoreRuleSave(
    PDO $pdo,
    string $entryWikiKey,
    array $terms,
    string $relation,
    ?int $userId,
    ?int $ruleId = null
): int {
    // I2: alles ab hier ist EIN Ersetzen -- alte Bedingungen weg, neue rein -- und das darf
    // nicht auf halbem Weg stehen bleiben. Ohne Transaktion legt lore_rule_term_type's
    // PRIMARY KEY (term_id, kind, region_type) genau das offen: ein INSERT ohne ON DUPLICATE
    // KEY wirft bei einem doppelten Typ, und zu dem Zeitpunkt waeren die alten Bedingungen
    // schon geloescht. Das DDL laeuft VOR diesem Aufruf (avesmapsLoreRuleEnsureTables im
    // Endpunkt), also keine Implicit-Commit-Falle durch ein ALTER mitten in der Transaktion.
    $pdo->beginTransaction();
    try {
        if ($ruleId === null) {
            $insert = $pdo->prepare(
                'INSERT INTO lore_rule (entry_wiki_key, relation, origin, status, created_by)
                 VALUES (:wk, :rel, \'manual\', \'active\', :user)'
            );
            $insert->execute(['wk' => $entryWikiKey, 'rel' => $relation, 'user' => $userId]);
            $ruleId = (int) $pdo->lastInsertId();
        } else {
            // 💣 Fix-Runde 1, Befund 2: eine fremde rule_id darf nie die Bedingungen einer Regel
            // ueberschreiben, die einem ANDEREN Eintrag gehoert. Das ist kein stilles Anlegen
            // einer neuen Regel unter falschem Namen, sondern ein Fehler -- der Aufrufer hat sich
            // vertan (oder schlimmeres), und das gehoert ihm gemeldet, nicht verschluckt.
            $owner = $pdo->prepare('SELECT entry_wiki_key FROM lore_rule WHERE id = :id');
            $owner->execute(['id' => $ruleId]);
            $ownerKey = $owner->fetchColumn();
            if ($ownerKey === false || (string) $ownerKey !== $entryWikiKey) {
                throw new InvalidArgumentException(
                    'lore_rule ' . $ruleId . ' gehoert nicht zu entry_wiki_key "' . $entryWikiKey . '".'
                );
            }

            $update = $pdo->prepare('UPDATE lore_rule SET relation = :rel WHERE id = :id');
            $update->execute(['rel' => $relation, 'id' => $ruleId]);
        }

        $oldTerms = $pdo->prepare('SELECT id FROM lore_rule_term WHERE rule_id = :id');
        $oldTerms->execute(['id' => $ruleId]);
        foreach ($oldTerms->fetchAll(PDO::FETCH_COLUMN) ?: [] as $termId) {
            $pdo->prepare('DELETE FROM lore_rule_term_type WHERE term_id = :id')->execute(['id' => $termId]);
        }
        $pdo->prepare('DELETE FROM lore_rule_term WHERE rule_id = :id')->execute(['id' => $ruleId]);

        $insertTerm = $pdo->prepare(
            'INSERT INTO lore_rule_term (rule_id, seq, join_op, area_public_id, climate_from, climate_to)
             VALUES (:rule, :seq, :join, :area, :from, :to)'
        );
        $insertType = $pdo->prepare(
            'INSERT INTO lore_rule_term_type (term_id, kind, region_type) VALUES (:term, :kind, :type)'
        );
        foreach (array_values($terms) as $seq => $term) {
            $insertTerm->execute([
                'rule' => $ruleId,
                'seq' => $seq,
                'join' => ($term['join_op'] ?? 'und') === 'oder' ? 'oder' : 'und',
                'area' => $term['area_public_id'] ?? null,
                'from' => $term['climate_from'] ?? null,
                'to' => $term['climate_to'] ?? null,
            ]);
            $termId = (int) $pdo->lastInsertId();
            foreach ((array) ($term['types'] ?? []) as $type) {
                $insertType->execute([
                    'term' => $termId,
                    'kind' => (string) ($type['kind'] ?? ''),
                    'type' => (string) ($type['region_type'] ?? ''),
                ]);
            }
        }

        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return $ruleId;
}

/**
 * Alle aktiven Regeln eines Eintrags, fertig fuer avesmapsLoreRuleEvaluate.
 *
 * @return list<array{id: int, relation: string, terms: list<array<string,mixed>>}>
 */
function avesmapsLoreRuleReadForEntry(PDO $pdo, string $entryWikiKey): array
{
    $rules = $pdo->prepare(
        'SELECT id, relation FROM lore_rule
         WHERE entry_wiki_key = :wk AND status = \'active\' ORDER BY sort_order, id'
    );
    $rules->execute(['wk' => $entryWikiKey]);
    $rows = $rules->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($rows === []) {
        return [];
    }

    $termStatement = $pdo->prepare(
        'SELECT id, join_op, area_public_id, climate_from, climate_to
         FROM lore_rule_term WHERE rule_id = :id ORDER BY seq'
    );
    $typeStatement = $pdo->prepare(
        'SELECT kind, region_type FROM lore_rule_term_type WHERE term_id = :id ORDER BY kind, region_type'
    );

    $out = [];
    foreach ($rows as $row) {
        $termStatement->execute(['id' => (int) $row['id']]);
        $terms = [];
        foreach ($termStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $termRow) {
            $typeStatement->execute(['id' => (int) $termRow['id']]);
            $types = [];
            foreach ($typeStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $typeRow) {
                $types[] = ['kind' => (string) $typeRow['kind'], 'region_type' => (string) $typeRow['region_type']];
            }
            $terms[] = [
                'join_op' => (string) $termRow['join_op'],
                'area_public_id' => $termRow['area_public_id'] !== null ? (string) $termRow['area_public_id'] : null,
                'climate_from' => $termRow['climate_from'] !== null ? (string) $termRow['climate_from'] : null,
                'climate_to' => $termRow['climate_to'] !== null ? (string) $termRow['climate_to'] : null,
                'types' => $types,
            ];
        }
        $out[] = ['id' => (int) $row['id'], 'relation' => (string) $row['relation'], 'terms' => $terms];
    }

    return $out;
}

/**
 * Loescht eine Regel samt ihrer Bedingungen. false = es gab sie nicht ODER sie gehoert
 * einem ANDEREN Eintrag.
 *
 * 💣 Fix-Runde 1, Befund 2: der Eintragsschluessel ist Pflicht und steht in JEDER
 * Loesch-Anweisung, nicht nur in einer vorgelagerten Pruefung -- sonst koennten die
 * KIND-Zeilen (Bedingungen) einer fremden Regel schon verschwinden, waehrend ihre
 * Kopf-Zeile wegen des falschen Schluessels stehen bleibt. Eine halb geloeschte fremde
 * Regel waere schlimmer als eine ganz unangetastete.
 */
function avesmapsLoreRuleDelete(PDO $pdo, int $ruleId, string $entryWikiKey): bool
{
    // I2: dieselbe Transaktions-Zusage wie avesmapsLoreRuleSave -- drei Anweisungen, die
    // zusammengehoeren, duerfen nicht halb durchlaufen. Das DDL laeuft VOR diesem Aufruf.
    $pdo->beginTransaction();
    try {
        $terms = $pdo->prepare(
            'SELECT t.id FROM lore_rule_term t
               JOIN lore_rule r ON r.id = t.rule_id
              WHERE t.rule_id = :id AND r.entry_wiki_key = :wk'
        );
        $terms->execute(['id' => $ruleId, 'wk' => $entryWikiKey]);
        foreach ($terms->fetchAll(PDO::FETCH_COLUMN) ?: [] as $termId) {
            $pdo->prepare('DELETE FROM lore_rule_term_type WHERE term_id = :id')->execute(['id' => $termId]);
        }
        $pdo->prepare(
            'DELETE FROM lore_rule_term WHERE rule_id = :id
               AND rule_id IN (SELECT id FROM lore_rule WHERE id = :id AND entry_wiki_key = :wk)'
        )->execute(['id' => $ruleId, 'wk' => $entryWikiKey]);
        $delete = $pdo->prepare('DELETE FROM lore_rule WHERE id = :id AND entry_wiki_key = :wk');
        $delete->execute(['id' => $ruleId, 'wk' => $entryWikiKey]);

        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return $delete->rowCount() > 0;
}

/**
 * Die Zonenschluessel in ihrer sort_order, Nord nach Sued.
 *
 * 🔴 Die REIHENFOLGE ist die Aussage, nicht Kosmetik: aus ihr entsteht die Spanne zwischen
 * zwei Endpunkten. Deshalb wird sie gelesen und nie im Code wiederholt.
 *
 * @return list<string>
 */
function avesmapsLoreRuleOrderedZoneKeys(PDO $pdo): array
{
    try {
        // M1: AND is_active = 1 wie die kanonische Klima-Abfrage (avesmapsClimateReadBands) --
        // eine stillgelegte Zone wuerde sonst jede Spanne, die sie ueberbrueckt, lautlos
        // verbreitern.
        $statement = $pdo->query(
            "SELECT type_key FROM ecosystem_region_type
              WHERE kind = 'klima' AND is_active = 1 ORDER BY sort_order ASC, type_key ASC"
        );
        $rows = $statement === false ? [] : $statement->fetchAll(PDO::FETCH_COLUMN);
    } catch (Throwable) {
        return [];
    }

    return array_map('strval', $rows ?: []);
}

/**
 * Alle Landschaftsflaechen mit Art und den Klimazonen, die sie BERUEHREN.
 *
 * 🔴 Die Zonen kommen aus ecosystem_region_overlap -- dem Ergebnis von „Zugehoerigkeit
 * rechnen" --, nicht aus einer zweiten Rechnung. Zwei Antworten auf dieselbe Frage wuerden
 * beim ersten Regelwechsel auseinanderlaufen (dieselbe Begruendung wie in
 * avesmapsClimateReadRegionZones).
 *
 * ⚠️ Klimabaender selbst sind KEINE Flaechen im Sinne einer Regel und fallen heraus:
 * „alle Flaechen der Borealen Zone" darf nicht das Band selbst treffen.
 *
 * @return list<array{public_id: string, kind: string, region_type: string, name: string, zones: list<string>}>
 */
function avesmapsLoreRuleReadAreas(PDO $pdo): array
{
    try {
        // ⚠️ The redundant-looking IN (...) is what keeps this off the WHOLE ecosystem_region_overlap
        // table -- same reasoning and the same fix as avesmapsClimateReadRegionZones
        // (climate-membership.php): the table holds every pair of regions that touch, both
        // directions, thousands of rows, and only a handful involve a climate band. The join alone
        // would filter correctly but scan everything; the IN lets idx_ecosystem_overlap_other do
        // the work.
        $statement = $pdo->query(
            "SELECT r.public_id, r.kind, r.region_type, r.name,
                    k.region_type AS zone_key, o.share
               FROM ecosystem_region r
               LEFT JOIN ecosystem_region_overlap o
                 ON o.region_id = r.id
                AND o.other_region_id IN (SELECT id FROM ecosystem_region WHERE kind = 'klima' AND is_active = 1)
               LEFT JOIN ecosystem_region k ON k.id = o.other_region_id AND k.kind = 'klima' AND k.is_active = 1
              WHERE r.is_active = 1 AND r.kind <> 'klima' AND r.region_type IS NOT NULL
              ORDER BY r.name, r.public_id"
        );
        $rows = $statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }

    $byId = [];
    foreach ($rows ?: [] as $row) {
        $publicId = (string) $row['public_id'];
        if (!isset($byId[$publicId])) {
            $byId[$publicId] = [
                'public_id' => $publicId,
                'kind' => (string) $row['kind'],
                'region_type' => (string) $row['region_type'],
                'name' => (string) ($row['name'] ?? ''),
                'zones' => [],
            ];
        }
        $zone = trim((string) ($row['zone_key'] ?? ''));
        $share = (float) ($row['share'] ?? 0);
        // ⚠️ Dieselbe Schwelle wie die Infobox-Zeile "Klimazone" und ihre Schwesterfunktion
        // avesmapsClimateReadRegionZones (climate-membership.php): unterhalb von
        // AVESMAPS_CLIMATE_REGION_MIN_SHARE ist eine Randberuehrung Rauschen, keine
        // Zugehoerigkeit. `share` ist der Anteil der KLEINEREN der beiden Flaechen -- fuer
        // eine gewoehnliche Flaeche (kleiner als ein Klimaband) heisst das "so viel liegt in
        // dieser Zone" (siehe dort fuer die ausfuehrliche Begruendung).
        if ($zone !== '' && $share >= AVESMAPS_CLIMATE_REGION_MIN_SHARE
            && !in_array($zone, $byId[$publicId]['zones'], true)) {
            $byId[$publicId]['zones'][] = $zone;
        }
    }

    return array_values($byId);
}

/**
 * Alle Siedlungen mit ihren Flaechen und ihrer EIGENEN Klimazone.
 *
 * 💣 Eine Siedlung ist ein PUNKT: `zone` ist genau eine, nicht eine Liste. Ihre Flaeche
 * kann mehrere Zonen beruehren -- die Siedlung nie. Beim Finsterkamm ist das der
 * Unterschied zwischen 44 und 4 (Entwurf §3.3).
 *
 * Kreuzungen sind keine Orte und bleiben draussen.
 *
 * 🔴 KORREKTUR gegen den urspruenglichen Bauplan: `climate_zone_key` und `is_crossing` sind
 * KEINE Spalten von map_features (Spaltenliste: avesmapsFetchFeatureByIdForUpdate,
 * api/_internal/map/features.php:442). Die Zone kommt aus den Klimabaendern
 * (avesmapsClimateReadBands/avesmapsClimateZoneKeyAt, climate-membership.php -- dieselbe
 * Wahrheit wie die Infobox-Zeile "Klimazone"), "ist Kreuzung" aus dem Praedikat
 * avesmapsRoutePropertiesAreCrossing (network-data.php), nicht aus einer Spalte oder dem
 * Namen.
 *
 * @return list<array{public_id: string, name: string, area_public_ids: list<string>, zone: string}>
 */
function avesmapsLoreRuleReadPlaces(PDO $pdo): array
{
    try {
        // Einmal je Aufruf geholt, nie je Zeile -- dieselbe Regel wie fuer die Baender in
        // avesmapsClimateApplyToFeatures.
        $bands = avesmapsClimateReadBands($pdo);

        $statement = $pdo->query(
            "SELECT f.public_id, f.name, f.feature_type, f.feature_subtype, f.geometry_json,
                    r.public_id AS area_public_id
               FROM map_features f
               JOIN location_ecosystem le ON le.location_id = f.id
               JOIN ecosystem_area a ON a.id = le.area_id AND a.is_active = 1
               JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
              WHERE f.feature_type = 'location' AND f.is_active = 1
              ORDER BY f.name, f.public_id"
        );
        $rows = $statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }

    $byId = [];
    foreach ($rows ?: [] as $row) {
        $publicId = (string) $row['public_id'];
        if (!isset($byId[$publicId])) {
            $isCrossing = avesmapsRoutePropertiesAreCrossing([
                'feature_type' => (string) ($row['feature_type'] ?? ''),
                'feature_subtype' => (string) ($row['feature_subtype'] ?? ''),
                'name' => (string) ($row['name'] ?? ''),
            ]);
            if ($isCrossing) {
                // Kreuzungen bleiben draussen. Der Eintrag wird auf null gesetzt (statt
                // gar keinen anzulegen), damit die naechste isset()-Pruefung fuer dieselbe
                // public_id (eine Kreuzung kann in mehreren Flaechen liegen, also mehrere
                // Zeilen haben) sofort "schon entschieden" liest, statt die Kreuzungs-
                // pruefung je Zeile zu wiederholen.
                $byId[$publicId] = null;
                continue;
            }

            $geometry = json_decode((string) ($row['geometry_json'] ?? ''), true);
            $coordinates = is_array($geometry) ? ($geometry['coordinates'] ?? null) : null;
            $x = is_array($coordinates) ? (float) ($coordinates[0] ?? 0.0) : 0.0;
            $y = is_array($coordinates) ? (float) ($coordinates[1] ?? 0.0) : 0.0;

            $byId[$publicId] = [
                'public_id' => $publicId,
                'name' => (string) ($row['name'] ?? ''),
                'area_public_ids' => [],
                'zone' => avesmapsClimateZoneKeyAt($bands, $x, $y),
            ];
        }

        if ($byId[$publicId] === null) {
            continue;
        }

        $areaId = (string) ($row['area_public_id'] ?? '');
        if ($areaId !== '' && !in_array($areaId, $byId[$publicId]['area_public_ids'], true)) {
            $byId[$publicId]['area_public_ids'][] = $areaId;
        }
    }

    return array_values(array_filter($byId, static fn (?array $place): bool => $place !== null));
}
