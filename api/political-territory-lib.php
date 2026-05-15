<?php

declare(strict_types=1);

const AVESMAPS_POLITICAL_DEFAULT_CONTINENT = 'Aventurien';
const AVESMAPS_POLITICAL_DEFAULT_YEAR_BF = 1049;

function avesmapsPoliticalEnsureTables(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS political_territory_wiki (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            wiki_key VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            type VARCHAR(160) NULL,
            continent VARCHAR(120) NULL,
            affiliation_raw TEXT NULL,
            affiliation_key VARCHAR(255) NULL,
            affiliation_root VARCHAR(255) NULL,
            affiliation_path_json JSON NULL,
            affiliation_json JSON NULL,
            status VARCHAR(255) NULL,
            form_of_government VARCHAR(255) NULL,
            capital_name VARCHAR(255) NULL,
            seat_name VARCHAR(255) NULL,
            ruler VARCHAR(255) NULL,
            language TEXT NULL,
            currency TEXT NULL,
            trade_goods TEXT NULL,
            population TEXT NULL,
            founded_text VARCHAR(500) NULL,
            founded_type VARCHAR(80) NULL,
            founded_start_bf INT NULL,
            founded_end_bf INT NULL,
            founded_display_bf DECIMAL(10, 2) NULL,
            founded_json JSON NULL,
            founder VARCHAR(255) NULL,
            dissolved_text VARCHAR(500) NULL,
            dissolved_type VARCHAR(80) NULL,
            dissolved_start_bf INT NULL,
            dissolved_end_bf INT NULL,
            dissolved_display_bf DECIMAL(10, 2) NULL,
            dissolved_json JSON NULL,
            geographic TEXT NULL,
            political TEXT NULL,
            trade_zone VARCHAR(120) NULL,
            blazon TEXT NULL,
            wiki_url VARCHAR(500) NULL,
            coat_of_arms_url VARCHAR(500) NULL,
            raw_json JSON NULL,
            synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_political_territory_wiki_key (wiki_key),
            KEY idx_political_territory_wiki_continent (continent),
            KEY idx_political_territory_wiki_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS political_territory_geometry (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            public_id CHAR(36) NOT NULL,
            territory_id BIGINT UNSIGNED NOT NULL,
            geometry_geojson JSON NOT NULL,
            valid_from_bf INT NULL,
            valid_to_bf INT NULL,
            min_zoom TINYINT UNSIGNED NULL,
            max_zoom TINYINT UNSIGNED NULL,
            min_x DECIMAL(10, 4) NOT NULL,
            min_y DECIMAL(10, 4) NOT NULL,
            max_x DECIMAL(10, 4) NOT NULL,
            max_y DECIMAL(10, 4) NOT NULL,
            source VARCHAR(255) NULL,
            style_json JSON NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_by BIGINT UNSIGNED NULL,
            updated_by BIGINT UNSIGNED NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_political_territory_geometry_public_id (public_id),
            KEY idx_political_territory_geometry_territory (territory_id, is_active),
            KEY idx_political_territory_geometry_bbox (min_x, min_y, max_x, max_y),
            KEY idx_political_territory_geometry_timeline (valid_from_bf, valid_to_bf),
            KEY idx_political_territory_geometry_zoom (min_zoom, max_zoom)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsPoliticalNormalizeWikiRecord(array $record): array {
    $wikiUrl = avesmapsPoliticalReadWikiString($record, ['Wiki-Link', 'Wiki Link', 'wiki_url']);
    $name = avesmapsPoliticalReadWikiString($record, ['Name', 'name'], 255);
    $continent = avesmapsPoliticalReadWikiString($record, ['Kontinent', 'continent'], 120) ?: AVESMAPS_POLITICAL_DEFAULT_CONTINENT;
    $affiliationJson = avesmapsPoliticalReadWikiJson($record, ['Zugehörigkeit-JSON', 'Zugehoerigkeit-JSON', 'ZugehÃ¶rigkeit-JSON', 'affiliation_json']);
    $affiliationPathJson = avesmapsPoliticalReadAffiliationPathJson($record, $affiliationJson);
    $foundedJson = avesmapsPoliticalReadWikiJson($record, ['Gründungsdatum-JSON', 'Gruendungsdatum-JSON', 'GrÃ¼ndungsdatum-JSON', 'founded_json']);
    $dissolvedJson = avesmapsPoliticalReadWikiJson($record, ['Aufgelöst-JSON', 'Aufgeloest-JSON', 'AufgelÃ¶st-JSON', 'dissolved_json']);
    $wikiKey = avesmapsPoliticalBuildWikiKey($wikiUrl, $name);
    $slug = avesmapsPoliticalSlug($name);

    return [
        'wiki_key' => $wikiKey,
        'slug' => $slug,
        'name' => $name,
        'type' => avesmapsPoliticalNormalizeParentheticalSpacing(avesmapsPoliticalReadWikiString($record, ['Typ', 'type'], 160)),
        'continent' => $continent,
        'affiliation_raw' => avesmapsPoliticalReadWikiString($record, ['Zugehörigkeit', 'Zugehoerigkeit', 'ZugehÃ¶rigkeit', 'affiliation_raw']),
        'affiliation_key' => avesmapsPoliticalReadWikiString($record, ['Zugehörigkeit-Key', 'Zugehoerigkeit-Key', 'ZugehÃ¶rigkeit-Key', 'affiliation_key']),
        'affiliation_root' => avesmapsPoliticalReadWikiString($record, ['Zugehörigkeit-Root', 'Zugehoerigkeit-Root', 'ZugehÃ¶rigkeit-Root', 'affiliation_root']),
        'affiliation_path_json' => $affiliationPathJson,
        'affiliation_json' => $affiliationJson,
        'status' => avesmapsPoliticalReadWikiString($record, ['Status', 'status'], 255),
        'form_of_government' => avesmapsPoliticalReadWikiString($record, ['Herrschaftsform', 'form_of_government'], 255),
        'capital_name' => avesmapsPoliticalReadWikiString($record, ['Hauptstadt', 'capital_name'], 255),
        'seat_name' => avesmapsPoliticalReadWikiString($record, ['Herrschaftssitz', 'seat_name'], 255),
        'ruler' => avesmapsPoliticalReadWikiString($record, ['Oberhaupt', 'ruler'], 255),
        'language' => avesmapsPoliticalReadWikiString($record, ['Sprache', 'language'], 2000),
        'currency' => avesmapsPoliticalReadWikiString($record, ['Währung', 'Waehrung', 'WÃ¤hrung', 'currency'], 2000),
        'trade_goods' => avesmapsPoliticalReadWikiString($record, ['Handelswaren', 'trade_goods'], 4000),
        'population' => avesmapsPoliticalReadWikiString($record, ['Einwohnerzahl', 'population'], 2000),
        'founded_text' => avesmapsPoliticalReadWikiString($record, ['Gründungsdatum-Text', 'Gruendungsdatum-Text', 'GrÃ¼ndungsdatum-Text', 'Gründungsdatum', 'Gruendungsdatum', 'GrÃ¼ndungsdatum']),
        'founded_type' => avesmapsPoliticalReadWikiString($record, ['Gründungsdatum-Typ', 'Gruendungsdatum-Typ', 'GrÃ¼ndungsdatum-Typ']),
        'founded_start_bf' => avesmapsPoliticalReadWikiInt($record, ['Gründungsdatum-StartBF', 'Gruendungsdatum-StartBF', 'GrÃ¼ndungsdatum-StartBF']),
        'founded_end_bf' => avesmapsPoliticalReadWikiInt($record, ['Gründungsdatum-EndBF', 'Gruendungsdatum-EndBF', 'GrÃ¼ndungsdatum-EndBF']),
        'founded_display_bf' => avesmapsPoliticalReadWikiFloat($record, ['Gründungsdatum-AnzeigeBF', 'Gruendungsdatum-AnzeigeBF', 'GrÃ¼ndungsdatum-AnzeigeBF']),
        'founded_json' => $foundedJson,
        'founder' => avesmapsPoliticalReadWikiString($record, ['Gründer', 'Gruender', 'GrÃ¼nder', 'founder'], 255),
        'dissolved_text' => avesmapsPoliticalReadWikiString($record, ['Aufgelöst-Text', 'Aufgeloest-Text', 'AufgelÃ¶st-Text', 'Aufgelöst', 'Aufgeloest', 'AufgelÃ¶st']),
        'dissolved_type' => avesmapsPoliticalReadWikiString($record, ['Aufgelöst-Typ', 'Aufgeloest-Typ', 'AufgelÃ¶st-Typ']),
        'dissolved_start_bf' => avesmapsPoliticalReadWikiInt($record, ['Aufgelöst-StartBF', 'Aufgeloest-StartBF', 'AufgelÃ¶st-StartBF']),
        'dissolved_end_bf' => avesmapsPoliticalReadWikiInt($record, ['Aufgelöst-EndBF', 'Aufgeloest-EndBF', 'AufgelÃ¶st-EndBF']),
        'dissolved_display_bf' => avesmapsPoliticalReadWikiFloat($record, ['Aufgelöst-AnzeigeBF', 'Aufgeloest-AnzeigeBF', 'AufgelÃ¶st-AnzeigeBF']),
        'dissolved_json' => $dissolvedJson,
        'geographic' => avesmapsPoliticalReadWikiString($record, ['Geographisch', 'geographic']),
        'political' => avesmapsPoliticalReadWikiString($record, ['Politisch', 'political']),
        'trade_zone' => avesmapsPoliticalReadWikiString($record, ['Handelszone', 'trade_zone'], 120),
        'blazon' => avesmapsPoliticalReadWikiString($record, ['Blasonierung', 'blazon'], 4000),
        'wiki_url' => $wikiUrl,
        'coat_of_arms_url' => avesmapsPoliticalReadWikiString($record, ['Wappen-Link', 'Wappen Link', 'coat_of_arms_url']),
        'raw_json' => $record,
    ];
}

function avesmapsPoliticalUpsertWikiRecord(PDO $pdo, array $record): array {
    $existingId = avesmapsPoliticalFetchWikiIdByKey($pdo, (string) $record['wiki_key']);
    $statement = $pdo->prepare(
        'INSERT INTO political_territory_wiki (
            wiki_key, name, type, continent, affiliation_raw, affiliation_key, affiliation_root,
            affiliation_path_json, affiliation_json, status, form_of_government, capital_name,
            seat_name, ruler, language, currency, trade_goods, population, founded_text,
            founded_type, founded_start_bf, founded_end_bf, founded_display_bf, founded_json,
            founder, dissolved_text, dissolved_type, dissolved_start_bf, dissolved_end_bf,
            dissolved_display_bf, dissolved_json, geographic, political, trade_zone, blazon,
            wiki_url, coat_of_arms_url, raw_json, synced_at
        ) VALUES (
            :wiki_key, :name, :type, :continent, :affiliation_raw, :affiliation_key, :affiliation_root,
            :affiliation_path_json, :affiliation_json, :status, :form_of_government, :capital_name,
            :seat_name, :ruler, :language, :currency, :trade_goods, :population, :founded_text,
            :founded_type, :founded_start_bf, :founded_end_bf, :founded_display_bf, :founded_json,
            :founder, :dissolved_text, :dissolved_type, :dissolved_start_bf, :dissolved_end_bf,
            :dissolved_display_bf, :dissolved_json, :geographic, :political, :trade_zone, :blazon,
            :wiki_url, :coat_of_arms_url, :raw_json, CURRENT_TIMESTAMP(3)
        )
        ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            type = VALUES(type),
            continent = VALUES(continent),
            affiliation_raw = VALUES(affiliation_raw),
            affiliation_key = VALUES(affiliation_key),
            affiliation_root = VALUES(affiliation_root),
            affiliation_path_json = VALUES(affiliation_path_json),
            affiliation_json = VALUES(affiliation_json),
            status = VALUES(status),
            form_of_government = VALUES(form_of_government),
            capital_name = VALUES(capital_name),
            seat_name = VALUES(seat_name),
            ruler = VALUES(ruler),
            language = VALUES(language),
            currency = VALUES(currency),
            trade_goods = VALUES(trade_goods),
            population = VALUES(population),
            founded_text = VALUES(founded_text),
            founded_type = VALUES(founded_type),
            founded_start_bf = VALUES(founded_start_bf),
            founded_end_bf = VALUES(founded_end_bf),
            founded_display_bf = VALUES(founded_display_bf),
            founded_json = VALUES(founded_json),
            founder = VALUES(founder),
            dissolved_text = VALUES(dissolved_text),
            dissolved_type = VALUES(dissolved_type),
            dissolved_start_bf = VALUES(dissolved_start_bf),
            dissolved_end_bf = VALUES(dissolved_end_bf),
            dissolved_display_bf = VALUES(dissolved_display_bf),
            dissolved_json = VALUES(dissolved_json),
            geographic = VALUES(geographic),
            political = VALUES(political),
            trade_zone = VALUES(trade_zone),
            blazon = VALUES(blazon),
            wiki_url = VALUES(wiki_url),
            coat_of_arms_url = VALUES(coat_of_arms_url),
            raw_json = VALUES(raw_json),
            synced_at = CURRENT_TIMESTAMP(3)'
    );
    $statement->execute([
        'wiki_key' => $record['wiki_key'],
        'name' => $record['name'],
        'type' => avesmapsPoliticalNullableString($record['type']),
        'continent' => avesmapsPoliticalNullableString($record['continent']),
        'affiliation_raw' => avesmapsPoliticalNullableString($record['affiliation_raw']),
        'affiliation_key' => avesmapsPoliticalNullableString($record['affiliation_key']),
        'affiliation_root' => avesmapsPoliticalNullableString($record['affiliation_root']),
        'affiliation_path_json' => avesmapsPoliticalEncodeJsonOrNull($record['affiliation_path_json']),
        'affiliation_json' => avesmapsPoliticalEncodeJsonOrNull($record['affiliation_json']),
        'status' => avesmapsPoliticalNullableString($record['status']),
        'form_of_government' => avesmapsPoliticalNullableString($record['form_of_government']),
        'capital_name' => avesmapsPoliticalNullableString($record['capital_name']),
        'seat_name' => avesmapsPoliticalNullableString($record['seat_name']),
        'ruler' => avesmapsPoliticalNullableString($record['ruler']),
        'language' => avesmapsPoliticalNullableString($record['language']),
        'currency' => avesmapsPoliticalNullableString($record['currency']),
        'trade_goods' => avesmapsPoliticalNullableString($record['trade_goods']),
        'population' => avesmapsPoliticalNullableString($record['population']),
        'founded_text' => avesmapsPoliticalNullableString($record['founded_text']),
        'founded_type' => avesmapsPoliticalNullableString($record['founded_type']),
        'founded_start_bf' => $record['founded_start_bf'],
        'founded_end_bf' => $record['founded_end_bf'],
        'founded_display_bf' => $record['founded_display_bf'],
        'founded_json' => avesmapsPoliticalEncodeJsonOrNull($record['founded_json']),
        'founder' => avesmapsPoliticalNullableString($record['founder']),
        'dissolved_text' => avesmapsPoliticalNullableString($record['dissolved_text']),
        'dissolved_type' => avesmapsPoliticalNullableString($record['dissolved_type']),
        'dissolved_start_bf' => $record['dissolved_start_bf'],
        'dissolved_end_bf' => $record['dissolved_end_bf'],
        'dissolved_display_bf' => $record['dissolved_display_bf'],
        'dissolved_json' => avesmapsPoliticalEncodeJsonOrNull($record['dissolved_json']),
        'geographic' => avesmapsPoliticalNullableString($record['geographic']),
        'political' => avesmapsPoliticalNullableString($record['political']),
        'trade_zone' => avesmapsPoliticalNullableString($record['trade_zone']),
        'blazon' => avesmapsPoliticalNullableString($record['blazon']),
        'wiki_url' => avesmapsPoliticalNullableString($record['wiki_url']),
        'coat_of_arms_url' => avesmapsPoliticalNullableString($record['coat_of_arms_url']),
        'raw_json' => avesmapsPoliticalEncodeJsonOrNull($record['raw_json']),
    ]);

    return [
        'id' => avesmapsPoliticalFetchWikiIdByKey($pdo, (string) $record['wiki_key']) ?? (int) $pdo->lastInsertId(),
        'created' => $existingId === null,
    ];
}

function avesmapsPoliticalCreateTerritoryFromWiki(PDO $pdo, array $wikiRecord, array $user): array {
    $validFrom = $wikiRecord['founded_start_bf'] ?? $wikiRecord['founded_display_bf'] ?? null;
    $validTo = avesmapsPoliticalReadDissolvedValidTo($wikiRecord);
    $validLabel = avesmapsPoliticalBuildValidLabel($wikiRecord['founded_text'] ?? '', $wikiRecord['dissolved_text'] ?? '');
    $zoomRange = avesmapsPoliticalDefaultZoomRange((string) ($wikiRecord['type'] ?? ''));
    $publicId = avesmapsPoliticalUuidV4();
    $slug = avesmapsPoliticalUniqueSlug($pdo, (string) $wikiRecord['slug']);
    $color = avesmapsPoliticalColorFromText((string) $wikiRecord['name']);
    $capitalPlaceId = avesmapsPoliticalFindLocationFeatureId($pdo, (string) ($wikiRecord['capital_name'] ?? ''));
    $seatPlaceId = avesmapsPoliticalFindLocationFeatureId($pdo, (string) ($wikiRecord['seat_name'] ?? ''));
    $sortOrder = avesmapsPoliticalNextSortOrder($pdo);

    $statement = $pdo->prepare(
        'INSERT INTO political_territory (
            public_id, wiki_id, slug, name, short_name, type, continent, status, color,
            opacity, coat_of_arms_url, wiki_url, capital_place_id, seat_place_id,
            valid_from_bf, valid_to_bf, valid_label, min_zoom, max_zoom, is_active,
            editor_notes, sort_order
        ) VALUES (
            :public_id, :wiki_id, :slug, :name, :short_name, :type, :continent, :status, :color,
            :opacity, :coat_of_arms_url, :wiki_url, :capital_place_id, :seat_place_id,
            :valid_from_bf, :valid_to_bf, :valid_label, :min_zoom, :max_zoom, 1,
            :editor_notes, :sort_order
        )'
    );
    $statement->execute([
        'public_id' => $publicId,
        'wiki_id' => (int) $wikiRecord['id'],
        'slug' => $slug,
        'name' => $wikiRecord['name'],
        'short_name' => null,
        'type' => avesmapsPoliticalNullableString($wikiRecord['type']),
        'continent' => $wikiRecord['continent'] ?: AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
        'status' => avesmapsPoliticalNullableString($wikiRecord['status']),
        'color' => $color,
        'opacity' => 0.33,
        'coat_of_arms_url' => avesmapsPoliticalNullableString($wikiRecord['coat_of_arms_url']),
        'wiki_url' => avesmapsPoliticalNullableString($wikiRecord['wiki_url']),
        'capital_place_id' => $capitalPlaceId,
        'seat_place_id' => $seatPlaceId,
        'valid_from_bf' => $validFrom === null ? null : (int) round((float) $validFrom),
        'valid_to_bf' => $validTo,
        'valid_label' => avesmapsPoliticalNullableString($validLabel),
        'min_zoom' => $zoomRange['min_zoom'],
        'max_zoom' => $zoomRange['max_zoom'],
        'editor_notes' => null,
        'sort_order' => $sortOrder,
    ]);

    return [
        'id' => (int) $pdo->lastInsertId(),
        'public_id' => $publicId,
        'wiki_id' => (int) $wikiRecord['id'],
    ];
}

function avesmapsPoliticalFindTerritoryByWikiOrSlug(PDO $pdo, int $wikiId, string $slug): ?array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory
        WHERE wiki_id = :wiki_id OR slug = :slug
        ORDER BY wiki_id = :wiki_id_order DESC, id ASC
        LIMIT 1'
    );
    $statement->execute([
        'wiki_id' => $wikiId,
        'wiki_id_order' => $wikiId,
        'slug' => $slug,
    ]);
    $territory = $statement->fetch(PDO::FETCH_ASSOC);

    return $territory ?: null;
}

function avesmapsPoliticalLinkTerritoryToWiki(PDO $pdo, int $territoryId, int $wikiId): void {
    $statement = $pdo->prepare(
        'UPDATE political_territory
        SET wiki_id = COALESCE(wiki_id, :wiki_id)
        WHERE id = :id'
    );
    $statement->execute([
        'id' => $territoryId,
        'wiki_id' => $wikiId,
    ]);
}

function avesmapsPoliticalSeedGeometryFromMapFeature(PDO $pdo, int $territoryId, array $wikiRecord, array $user): bool {
    try {
        $existingStatement = $pdo->prepare(
            'SELECT source, geometry_geojson
            FROM political_territory_geometry
            WHERE territory_id = :territory_id
                AND is_active = 1'
        );
        $existingStatement->execute(['territory_id' => $territoryId]);
        $existingGeometries = $existingStatement->fetchAll(PDO::FETCH_ASSOC);
        $existingSources = array_map(static fn(array $row): string => (string) ($row['source'] ?? ''), $existingGeometries);
        $hasEditorialGeometry = $existingSources !== [] && array_filter(
            $existingSources,
            static fn(string $source): bool => $source !== 'legacy_region_seed'
        ) !== [];
        if ($hasEditorialGeometry) {
            return false;
        }

        $features = avesmapsPoliticalFindLegacyRegionFeaturesForWikiRecord($pdo, $wikiRecord);
    } catch (Throwable) {
        return false;
    }

    if ($features === []) {
        return false;
    }

    if ($existingSources !== []) {
        $existingPartCount = avesmapsPoliticalCountGeometryPartsInRows($existingGeometries, 'geometry_geojson');
        $legacyPartCount = avesmapsPoliticalCountGeometryPartsInRows($features, 'geometry_json');
        if ($existingPartCount >= $legacyPartCount) {
            return false;
        }

        $deactivateStatement = $pdo->prepare(
            'UPDATE political_territory_geometry
            SET is_active = 0
            WHERE territory_id = :territory_id
                AND is_active = 1
                AND source = :source'
        );
        $deactivateStatement->execute([
            'territory_id' => $territoryId,
            'source' => 'legacy_region_seed',
        ]);
    }

    $color = avesmapsPoliticalColorFromText((string) $wikiRecord['name']);
    $zoomRange = avesmapsPoliticalDefaultZoomRange((string) ($wikiRecord['type'] ?? ''));
    $validFrom = $wikiRecord['founded_start_bf'] ?? $wikiRecord['founded_display_bf'] ?? null;
    $insertStatement = $pdo->prepare(
        'INSERT INTO political_territory_geometry (
            public_id, territory_id, geometry_geojson, valid_from_bf, valid_to_bf,
            min_zoom, max_zoom, min_x, min_y, max_x, max_y, source, style_json,
            created_by, updated_by
        ) VALUES (
            :public_id, :territory_id, :geometry_geojson, :valid_from_bf, :valid_to_bf,
            :min_zoom, :max_zoom, :min_x, :min_y, :max_x, :max_y, :source, :style_json,
            :created_by, :updated_by
        )'
    );

    $inserted = 0;
    foreach ($features as $feature) {
        $geometry = avesmapsPoliticalDecodeJson($feature['geometry_json'] ?? null);
        if (!in_array((string) ($geometry['type'] ?? ''), ['Polygon', 'MultiPolygon'], true)) {
            continue;
        }

        $bounds = avesmapsPoliticalReadSeedBounds($feature, $geometry);
        if ($bounds === null) {
            continue;
        }

        $style = avesmapsPoliticalBuildSeedGeometryStyle($feature, $color);
        $insertStatement->execute([
            'public_id' => avesmapsPoliticalUuidV4(),
            'territory_id' => $territoryId,
            'geometry_geojson' => avesmapsPoliticalEncodeJsonOrNull($geometry),
            'valid_from_bf' => $validFrom === null ? null : (int) round((float) $validFrom),
            'valid_to_bf' => avesmapsPoliticalReadDissolvedValidTo($wikiRecord),
            'min_zoom' => $zoomRange['min_zoom'],
            'max_zoom' => $zoomRange['max_zoom'],
            'min_x' => $bounds['min_x'],
            'min_y' => $bounds['min_y'],
            'max_x' => $bounds['max_x'],
            'max_y' => $bounds['max_y'],
            'source' => 'legacy_region_seed',
            'style_json' => avesmapsPoliticalEncodeJsonOrNull($style),
            'created_by' => (int) ($user['id'] ?? 0) ?: null,
            'updated_by' => (int) ($user['id'] ?? 0) ?: null,
        ]);
        $inserted++;
    }

    return $inserted > 0;
}

function avesmapsPoliticalCountGeometryPartsInRows(array $rows, string $geometryKey): int {
    $count = 0;
    foreach ($rows as $row) {
        $geometry = avesmapsPoliticalDecodeJson($row[$geometryKey] ?? null);
        if (($geometry['type'] ?? '') === 'Polygon') {
            $count++;
        } elseif (($geometry['type'] ?? '') === 'MultiPolygon') {
            $count += is_array($geometry['coordinates'] ?? null) ? count($geometry['coordinates']) : 0;
        }
    }

    return $count;
}

function avesmapsPoliticalFindLegacyRegionFeaturesForWikiRecord(PDO $pdo, array $wikiRecord): array {
    $candidateSlugs = avesmapsPoliticalBuildLegacyRegionCandidateSlugs($wikiRecord);
    if ($candidateSlugs === []) {
        return [];
    }

    $statement = $pdo->prepare(
        'SELECT
            public_id,
            name,
            geometry_json,
            properties_json,
            style_json,
            min_x,
            min_y,
            max_x,
            max_y
        FROM map_features
        WHERE feature_type = :feature_type
            AND is_active = 1
            AND geometry_type IN (:polygon_type, :multipolygon_type)
        ORDER BY sort_order ASC, id ASC'
    );
    $statement->execute([
        'feature_type' => 'region',
        'polygon_type' => 'Polygon',
        'multipolygon_type' => 'MultiPolygon',
    ]);

    $features = $statement->fetchAll(PDO::FETCH_ASSOC);
    $matches = [];
    foreach ($features as $feature) {
        $featureSlug = avesmapsPoliticalSlug((string) ($feature['name'] ?? ''));
        if ($featureSlug !== '' && isset($candidateSlugs[$featureSlug])) {
            $matches[] = $feature;
        }
    }

    if ($matches !== []) {
        return $matches;
    }

    return avesmapsPoliticalFindFuzzyLegacyRegionFeatures($features, $candidateSlugs);
}

function avesmapsPoliticalFindFuzzyLegacyRegionFeatures(array $features, array $candidateSlugs): array {
    $bestDistance = PHP_INT_MAX;
    $bestFeatures = [];

    foreach ($features as $feature) {
        $featureSlug = avesmapsPoliticalSlug((string) ($feature['name'] ?? ''));
        if ($featureSlug === '') {
            continue;
        }

        $distance = avesmapsPoliticalBestLegacySlugDistance($featureSlug, $candidateSlugs);
        if ($distance === null || $distance > 2) {
            continue;
        }

        if ($distance < $bestDistance) {
            $bestDistance = $distance;
            $bestFeatures = [$feature];
            continue;
        }

        if ($distance === $bestDistance) {
            $bestFeatures[] = $feature;
        }
    }

    return $bestDistance <= 2 ? $bestFeatures : [];
}

function avesmapsPoliticalBestLegacySlugDistance(string $featureSlug, array $candidateSlugs): ?int {
    $bestDistance = null;
    foreach (array_keys($candidateSlugs) as $candidateSlug) {
        $distance = levenshtein($featureSlug, (string) $candidateSlug);
        if ($bestDistance === null || $distance < $bestDistance) {
            $bestDistance = $distance;
        }
    }

    return $bestDistance;
}

function avesmapsPoliticalBuildLegacyRegionCandidateSlugs(array $wikiRecord): array {
    $values = [
        (string) ($wikiRecord['name'] ?? ''),
    ];

    $slugs = [];
    foreach ($values as $value) {
        foreach (avesmapsPoliticalExpandTerritoryAliases([$value]) as $part) {
            $slug = avesmapsPoliticalSlug((string) $part);
            if ($slug === '') {
                continue;
            }

            $slugs[$slug] = true;
        }
    }

    return $slugs;
}

function avesmapsPoliticalBuildSeedGeometryStyle(array $feature, string $fallbackColor): array {
    $style = avesmapsPoliticalDecodeJson($feature['style_json'] ?? null);
    $properties = avesmapsPoliticalDecodeJson($feature['properties_json'] ?? null);

    return [
        'fill' => (string) ($style['fill'] ?? $properties['fill'] ?? $fallbackColor),
        'stroke' => (string) ($style['stroke'] ?? $properties['stroke'] ?? $fallbackColor),
        'fillOpacity' => (float) ($style['fillOpacity'] ?? $properties['fillOpacity'] ?? 0.33),
        'weight' => (int) ($style['weight'] ?? $properties['weight'] ?? 2),
    ];
}

function avesmapsPoliticalReadSeedBounds(array $feature, array $geometry): ?array {
    foreach (['min_x', 'min_y', 'max_x', 'max_y'] as $key) {
        if (!is_numeric($feature[$key] ?? null)) {
            return avesmapsPoliticalCalculateSeedBounds($geometry);
        }
    }

    return [
        'min_x' => (float) $feature['min_x'],
        'min_y' => (float) $feature['min_y'],
        'max_x' => (float) $feature['max_x'],
        'max_y' => (float) $feature['max_y'],
    ];
}

function avesmapsPoliticalCalculateSeedBounds(array $geometry): ?array {
    $coordinatePairs = [];
    avesmapsPoliticalCollectSeedCoordinatePairs($geometry['coordinates'] ?? null, $coordinatePairs);
    if ($coordinatePairs === []) {
        return null;
    }

    $xValues = array_map(static fn(array $coordinate): float => $coordinate[0], $coordinatePairs);
    $yValues = array_map(static fn(array $coordinate): float => $coordinate[1], $coordinatePairs);

    return [
        'min_x' => min($xValues),
        'min_y' => min($yValues),
        'max_x' => max($xValues),
        'max_y' => max($yValues),
    ];
}

function avesmapsPoliticalCollectSeedCoordinatePairs(mixed $coordinates, array &$coordinatePairs): void {
    if (!is_array($coordinates)) {
        return;
    }

    if (count($coordinates) >= 2 && is_numeric($coordinates[0] ?? null) && is_numeric($coordinates[1] ?? null)) {
        $coordinatePairs[] = [(float) $coordinates[0], (float) $coordinates[1]];
        return;
    }

    foreach ($coordinates as $coordinate) {
        avesmapsPoliticalCollectSeedCoordinatePairs($coordinate, $coordinatePairs);
    }
}

function avesmapsPoliticalReadParentNameFromWikiRecord(array $wikiRecord): string {
    $path = $wikiRecord['affiliation_path_json'];
    if (!is_array($path) || $path === []) {
        return '';
    }

    $parentName = (string) end($path);
    if (avesmapsPoliticalSlug($parentName) === (string) $wikiRecord['slug']) {
        $parentName = count($path) > 1 ? (string) $path[count($path) - 2] : '';
    }

    return trim($parentName);
}

function avesmapsPoliticalFetchWikiIdByKey(PDO $pdo, string $wikiKey): ?int {
    $statement = $pdo->prepare('SELECT id FROM political_territory_wiki WHERE wiki_key = :wiki_key LIMIT 1');
    $statement->execute(['wiki_key' => $wikiKey]);
    $id = $statement->fetchColumn();

    return $id === false ? null : (int) $id;
}

function avesmapsPoliticalFindLocationFeatureId(PDO $pdo, string $name): ?int {
    $name = avesmapsNormalizeSingleLine($name, 255);
    if ($name === '') {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT id
        FROM map_features
        WHERE feature_type = :feature_type
            AND name = :name
            AND is_active = 1
        ORDER BY id ASC
        LIMIT 1'
    );
    try {
        $statement->execute([
            'feature_type' => 'location',
            'name' => $name,
        ]);
    } catch (Throwable) {
        return null;
    }

    $id = $statement->fetchColumn();
    return $id === false ? null : (int) $id;
}

function avesmapsPoliticalNextSortOrder(PDO $pdo): int {
    $statement = $pdo->query('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM political_territory');
    $sortOrder = $statement !== false ? $statement->fetchColumn() : false;

    return $sortOrder === false ? 1 : (int) $sortOrder;
}

function avesmapsPoliticalUniqueSlug(PDO $pdo, string $baseSlug, ?int $excludeId = null): string {
    $candidate = $baseSlug !== '' ? $baseSlug : 'herrschaftsgebiet';
    $suffix = 2;

    while (avesmapsPoliticalSlugExists($pdo, $candidate, $excludeId)) {
        $candidate = $baseSlug . '-' . $suffix;
        $suffix++;
    }

    return $candidate;
}

function avesmapsPoliticalSlugExists(PDO $pdo, string $slug, ?int $excludeId): bool {
    $sql = 'SELECT COUNT(*) FROM political_territory WHERE slug = :slug';
    $params = ['slug' => $slug];
    if ($excludeId !== null) {
        $sql .= ' AND id <> :exclude_id';
        $params['exclude_id'] = $excludeId;
    }

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return (int) $statement->fetchColumn() > 0;
}

function avesmapsPoliticalDefaultZoomRange(string $type): array {
    $normalizedType = mb_strtolower($type);
    if (preg_match('/kaiserreich|koenigreich|königreich|reich|staatenbund|republik/u', $normalizedType) === 1) {
        return ['min_zoom' => 0, 'max_zoom' => 2];
    }

    if (preg_match('/herzogtum|fuerstentum|fürstentum|markgrafschaft|sultanat|emirat|protektorat/u', $normalizedType) === 1) {
        return ['min_zoom' => 2, 'max_zoom' => 4];
    }

    if (preg_match('/grafschaft|baronie|herrschaft|domaene|domäne|gut/u', $normalizedType) === 1) {
        return ['min_zoom' => 4, 'max_zoom' => 6];
    }

    return ['min_zoom' => 1, 'max_zoom' => 6];
}

function avesmapsPoliticalReadDissolvedValidTo(array $wikiRecord): ?int {
    $text = mb_strtolower((string) ($wikiRecord['dissolved_text'] ?? ''));
    $type = mb_strtolower((string) ($wikiRecord['dissolved_type'] ?? ''));
    if ($text === '' || str_contains($text, 'besteht') || $type === 'ongoing' || $type === 'unknown') {
        return null;
    }

    foreach (['dissolved_end_bf', 'dissolved_display_bf', 'dissolved_start_bf'] as $key) {
        $value = $wikiRecord[$key] ?? null;
        if (is_numeric($value)) {
            return (int) round((float) $value);
        }
    }

    return null;
}

function avesmapsPoliticalBuildValidLabel(string $foundedText, string $dissolvedText): string {
    $founded = trim($foundedText);
    $dissolved = trim($dissolvedText);
    if ($founded !== '' && $dissolved !== '') {
        return str_contains(mb_strtolower($dissolved), 'besteht')
            ? 'besteht seit ' . $founded
            : $founded . ' - ' . $dissolved;
    }

    if ($founded !== '') {
        return 'seit ' . $founded;
    }

    if ($dissolved !== '') {
        return str_contains(mb_strtolower($dissolved), 'besteht') ? 'besteht' : 'bis ' . $dissolved;
    }

    return '';
}

function avesmapsPoliticalColorFromText(string $text): string {
    $hash = crc32($text);
    $hue = $hash % 360;
    [$red, $green, $blue] = avesmapsPoliticalHslToRgb($hue / 360, 0.48, 0.48);

    return sprintf('#%02x%02x%02x', $red, $green, $blue);
}

function avesmapsPoliticalHslToRgb(float $hue, float $saturation, float $lightness): array {
    if ($saturation === 0.0) {
        $value = (int) round($lightness * 255);
        return [$value, $value, $value];
    }

    $q = $lightness < 0.5
        ? $lightness * (1 + $saturation)
        : $lightness + $saturation - $lightness * $saturation;
    $p = 2 * $lightness - $q;

    return [
        (int) round(avesmapsPoliticalHueToRgb($p, $q, $hue + 1 / 3) * 255),
        (int) round(avesmapsPoliticalHueToRgb($p, $q, $hue) * 255),
        (int) round(avesmapsPoliticalHueToRgb($p, $q, $hue - 1 / 3) * 255),
    ];
}

function avesmapsPoliticalHueToRgb(float $p, float $q, float $t): float {
    if ($t < 0) {
        $t += 1;
    }
    if ($t > 1) {
        $t -= 1;
    }
    if ($t < 1 / 6) {
        return $p + ($q - $p) * 6 * $t;
    }
    if ($t < 1 / 2) {
        return $q;
    }
    if ($t < 2 / 3) {
        return $p + ($q - $p) * (2 / 3 - $t) * 6;
    }

    return $p;
}

function avesmapsPoliticalIsLikelyCoatOfArmsUrl(string $url): bool {
    $text = mb_strtolower(avesmapsNormalizeSingleLine($url, 700));
    if ($text === '') {
        return false;
    }

    $blocked = ['pfeil', 'arrow', 'positionskarte', 'karte', 'map', 'icon', 'noimage', 'transparent', 'region_ohne', 'blank', 'missing', 'placeholder'];
    foreach ($blocked as $pattern) {
        if (str_contains($text, $pattern)) {
            return false;
        }
    }

    $accepted = ['wappen', 'crest', 'coat', 'arms', 'schild', 'banner', 'flagge', 'fahne'];
    foreach ($accepted as $pattern) {
        if (str_contains($text, $pattern)) {
            return true;
        }
    }

    return false;
}

function avesmapsPoliticalBuildWikiKey(string $wikiUrl, string $name): string {
    if ($wikiUrl !== '') {
        $path = parse_url($wikiUrl, PHP_URL_PATH);
        if (is_string($path) && $path !== '') {
            $decodedPath = rawurldecode($path);
            $page = preg_replace('/^.*\/wiki\//', '', $decodedPath) ?? $decodedPath;
            $slug = avesmapsPoliticalSlug(str_replace('_', ' ', $page));
            if ($slug !== '') {
                return 'wiki:' . $slug;
            }
        }
    }

    return 'name:' . avesmapsPoliticalSlug($name);
}

function avesmapsPoliticalReadAffiliationPathJson(array $record, array $affiliationJson): array {
    $pathText = avesmapsPoliticalReadWikiString($record, ['Zugehörigkeit-Pfad', 'Zugehoerigkeit-Pfad', 'ZugehÃ¶rigkeit-Pfad', 'affiliation_path']);
    if ($pathText !== '') {
        return array_values(array_filter(array_map('trim', preg_split('/\s*>\s*/', $pathText) ?: [])));
    }

    $path = $affiliationJson['path'] ?? null;
    if (is_array($path)) {
        return array_values(array_filter(array_map(static fn(mixed $value): string => trim((string) $value), $path)));
    }

    return [];
}

function avesmapsPoliticalReadWikiString(array $record, array $keys, int $maxLength = 500): string {
    foreach ($keys as $key) {
        if (array_key_exists($key, $record)) {
            return avesmapsNormalizeSingleLine((string) $record[$key], $maxLength);
        }
    }

    return '';
}

function avesmapsPoliticalNormalizeParentheticalSpacing(string $value): string {
    return (string) preg_replace('/([^\s])\(/u', '$1 (', $value);
}

function avesmapsPoliticalReadWikiInt(array $record, array $keys): ?int {
    foreach ($keys as $key) {
        if (!array_key_exists($key, $record) || $record[$key] === '') {
            continue;
        }

        $value = filter_var($record[$key], FILTER_VALIDATE_FLOAT);
        if ($value !== false) {
            return (int) round((float) $value);
        }
    }

    return null;
}

function avesmapsPoliticalReadWikiFloat(array $record, array $keys): ?float {
    foreach ($keys as $key) {
        if (!array_key_exists($key, $record) || $record[$key] === '') {
            continue;
        }

        $value = filter_var(str_replace(',', '.', (string) $record[$key]), FILTER_VALIDATE_FLOAT);
        if ($value !== false) {
            return (float) $value;
        }
    }

    return null;
}

function avesmapsPoliticalReadWikiJson(array $record, array $keys): array {
    foreach ($keys as $key) {
        if (!array_key_exists($key, $record) || $record[$key] === '') {
            continue;
        }

        $value = $record[$key];
        if (is_array($value)) {
            return $value;
        }

        try {
            $decoded = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return [];
        }

        return is_array($decoded) ? $decoded : [];
    }

    return [];
}

function avesmapsPoliticalNullableString(mixed $value): ?string {
    $text = is_string($value) ? trim($value) : trim((string) ($value ?? ''));

    return $text === '' ? null : $text;
}

function avesmapsPoliticalEncodeJsonOrNull(mixed $value): ?string {
    if ($value === null || $value === [] || $value === '') {
        return null;
    }

    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function avesmapsPoliticalDecodeJson(mixed $value): array {
    if ($value === null || $value === '') {
        return [];
    }

    if (is_array($value)) {
        return $value;
    }

    try {
        $decoded = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return [];
    }

    return is_array($decoded) ? $decoded : [];
}

function avesmapsPoliticalSlug(string $value): string {
    $slug = mb_strtolower(trim($value));
    $slug = str_replace('ß', 'ss', $slug);
    if (function_exists('iconv')) {
        $transliterated = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $slug);
        if (is_string($transliterated)) {
            $slug = $transliterated;
        }
    }
    $slug = preg_replace('/[^a-z0-9]+/i', '-', $slug) ?? '';
    $slug = trim($slug, '-');
    $slug = str_replace('marktgrafschaft', 'markgrafschaft', $slug);

    return mb_substr($slug, 0, 180);
}

function avesmapsPoliticalUuidV4(): string {
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = unpack('H*', $bytes);
    if (!is_array($hex) || !isset($hex[1])) {
        throw new RuntimeException('Die UUID konnte nicht erzeugt werden.');
    }

    return sprintf(
        '%s-%s-%s-%s-%s',
        substr($hex[1], 0, 8),
        substr($hex[1], 8, 4),
        substr($hex[1], 12, 4),
        substr($hex[1], 16, 4),
        substr($hex[1], 20)
    );
}
