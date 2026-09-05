<?php
// 🪤 05.09.2026 Stempel-Heilung: der Deploy-Lauf zu 40f050a61/2e9a44016 wurde in der Warteschlange abgebrochen (ein zweiter Push, waehrend er wartete) und hat nichts hochgeladen -- der naechste Lauf rechnet ab dem abgebrochenen Commit und laedt diese Datei nie. Nur eine Inhaltsaenderung heilt das (AGENTS.md §9, css/components/fenster.css).

declare(strict_types=1);

require_once __DIR__ . '/derived-orphans.php';
require_once __DIR__ . '/territories-audit.php';
require_once __DIR__ . '/territories-derived-geometry-plan.php';
require_once __DIR__ . '/../schema-ensure-once.php';

function avesmapsPoliticalEnsureDerivedGeometryTables(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS political_territory_derived_geometry (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            public_id CHAR(36) NOT NULL,
            territory_id BIGINT UNSIGNED NOT NULL,
            geometry_geojson JSON NOT NULL,
            label_lng DECIMAL(12, 6) NULL,
            label_lat DECIMAL(12, 6) NULL,
            min_zoom TINYINT UNSIGNED NULL,
            max_zoom TINYINT UNSIGNED NULL,
            min_x DECIMAL(10, 4) NOT NULL,
            min_y DECIMAL(10, 4) NOT NULL,
            max_x DECIMAL(10, 4) NOT NULL,
            max_y DECIMAL(10, 4) NOT NULL,
            show_inner_boundaries TINYINT(1) NOT NULL DEFAULT 1,
            inner_boundary_geojson JSON NULL,
            source_revision VARCHAR(255) NULL,
            generated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_by BIGINT UNSIGNED NULL,
            updated_by BIGINT UNSIGNED NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_political_territory_derived_geometry_public_id (public_id),
            KEY idx_political_territory_derived_territory (territory_id, is_active),
            KEY idx_political_territory_derived_zoom (min_zoom, max_zoom),
            KEY idx_political_territory_derived_bbox (min_x, min_y, max_x, max_y)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $column = $pdo->query("SHOW COLUMNS FROM political_territory_derived_geometry LIKE 'show_inner_boundaries'")->fetch(PDO::FETCH_ASSOC);
    if (!is_array($column)) {
        $pdo->exec('ALTER TABLE political_territory_derived_geometry ADD show_inner_boundaries TINYINT(1) NOT NULL DEFAULT 1 AFTER max_y');
    }

    $innerBoundaryColumn = $pdo->query("SHOW COLUMNS FROM political_territory_derived_geometry LIKE 'inner_boundary_geojson'")->fetch(PDO::FETCH_ASSOC);
    if (!is_array($innerBoundaryColumn)) {
        $pdo->exec('ALTER TABLE political_territory_derived_geometry ADD inner_boundary_geojson JSON NULL AFTER show_inner_boundaries');
    }

    // Umstrittene-Gebiete-Split (additiv): geometry_geojson bleibt die VOLLE Union (Grenze + Hover,
    // unveraendert). Bei Konflikten unter den Nachfahren wird die Fuellung aufgeteilt:
    //   fill_remainder_geojson  = Union MINUS umstrittene Baronien (normale Farbe)
    //   contested_pieces_geojson = die umstrittenen Baronien (Schraffur, mit Terrain-Durchsicht)
    // Beide NULL, wenn das Ziel keine Konflikte hat -> Verhalten wie bisher. Die Grenzberechnung
    // fasst diese Felder NIE an (Reihenfolge: erst Union+Grenzen, dann Split).
    $fillRemainderColumn = $pdo->query("SHOW COLUMNS FROM political_territory_derived_geometry LIKE 'fill_remainder_geojson'")->fetch(PDO::FETCH_ASSOC);
    if (!is_array($fillRemainderColumn)) {
        $pdo->exec('ALTER TABLE political_territory_derived_geometry ADD fill_remainder_geojson JSON NULL AFTER inner_boundary_geojson');
    }
    $contestedPiecesColumn = $pdo->query("SHOW COLUMNS FROM political_territory_derived_geometry LIKE 'contested_pieces_geojson'")->fetch(PDO::FETCH_ASSOC);
    if (!is_array($contestedPiecesColumn)) {
        $pdo->exec('ALTER TABLE political_territory_derived_geometry ADD contested_pieces_geojson JSON NULL AFTER fill_remainder_geojson');
    }
}

function avesmapsPoliticalEnsureDerivedGeometryTablesEinmal(PDO $pdo): void {
    avesmapsSchemaEnsureOnce('political_derived_geometry_tables', __FILE__, static function () use ($pdo): void {
        avesmapsPoliticalEnsureDerivedGeometryTables($pdo);
    });
}

function avesmapsPoliticalReadDerivedGeometry(PDO $pdo, array $query): array {
    $target = avesmapsPoliticalResolveDerivedGeometryTarget($pdo, $query, false);
    if (($target['territory'] ?? null) === null) {
        return [
            'ok' => true,
            'territory_public_id' => '',
            'target_key' => $target['target_key'],
            'target_name' => $target['target_name'],
            'derived_geometry' => null,
        ];
    }

    $territory = $target['territory'];
    return [
        'ok' => true,
        'territory_public_id' => (string) $territory['public_id'],
        'target_key' => $target['target_key'],
        'target_name' => $target['target_name'],
        'derived_geometry' => avesmapsPoliticalFetchActiveDerivedGeometryForTerritory($pdo, (int) $territory['id']),
    ];
}

// Aus einer Liste von Quell-territory_ids die herausfiltern, die einen aktiven Claim tragen
// (Besitzer + Anspruchsteller aktiv -- Mirror von AttachContestedParties). Liefert die public_ids
// (Match-Schluessel der source_geometries), aus denen der Client contested_pieces (Schraffur) und
// fill_remainder (Union minus diese) baut. Leer/Fehler => kein Split, Verhalten wie bisher.
function avesmapsPoliticalFilterContestedSourceTerritoryPublicIds(PDO $pdo, array $territoryIds): array {
    $ids = array_values(array_unique(array_filter(array_map('intval', $territoryIds), static fn(int $id): bool => $id > 0)));
    if ($ids === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    try {
        $statement = $pdo->prepare(
            'SELECT DISTINCT owner.public_id
            FROM political_territory_claim claim
            INNER JOIN political_territory owner ON owner.id = claim.territory_id AND owner.is_active = 1
            INNER JOIN political_territory claimant ON claimant.id = claim.claimant_territory_id AND claimant.is_active = 1
            WHERE claim.is_active = 1 AND claim.territory_id IN (' . $placeholders . ')'
        );
        $statement->execute($ids);
    } catch (Throwable) {
        return [];
    }
    return array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN));
}

// Map: umstrittene Quell-territory_public_id -> [claimant_public_id, ...] (nach sort_order). Damit der
// Client die Konflikt-Baronien nach GLEICHER Anspruchsteller-Menge gruppieren und ihre Flaechen vereinen
// kann (eine einheitliche Schraffur bei Tiefzoom). Nur umstrittene Quellen tauchen auf.
function avesmapsPoliticalFetchContestedClaimantsBySource(PDO $pdo, array $territoryIds): array {
    $ids = array_values(array_unique(array_filter(array_map('intval', $territoryIds), static fn(int $id): bool => $id > 0)));
    if ($ids === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    try {
        $statement = $pdo->prepare(
            'SELECT owner.public_id AS owner_public_id, claimant.public_id AS claimant_public_id
            FROM political_territory_claim claim
            INNER JOIN political_territory owner ON owner.id = claim.territory_id AND owner.is_active = 1
            INNER JOIN political_territory claimant ON claimant.id = claim.claimant_territory_id AND claimant.is_active = 1
            WHERE claim.is_active = 1 AND claim.territory_id IN (' . $placeholders . ')
            ORDER BY claim.sort_order ASC, claim.id ASC'
        );
        $statement->execute($ids);
    } catch (Throwable) {
        return [];
    }
    $map = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $owner = (string) $row['owner_public_id'];
        if (!isset($map[$owner])) {
            $map[$owner] = [];
        }
        $map[$owner][] = (string) $row['claimant_public_id'];
    }
    return $map;
}

function avesmapsPoliticalReadDerivedGeometrySources(PDO $pdo, array $query): array {
    $target = avesmapsPoliticalResolveDerivedGeometryTarget($pdo, $query, false);
    $territories = avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo);
    $descendantIds = [];
    $sourceTerritoryIds = [];
    $sourceMode = 'none';

    if (($target['territory'] ?? null) !== null) {
        $targetTerritoryId = (int) $target['territory']['id'];
        $descendantIds = avesmapsPoliticalCollectDerivedGeometryDescendantIds($targetTerritoryId, $territories);
        // Ein aufgeloestes Territorium ist die AUTORITATIVE Quelle: eigene Geometrie + die ueber
        // parent_id verbundenen Nachfahren (die Zuweisung pflegt parent_id). Bewusst KEIN Rueckfall
        // auf die namensbasierte Wiki-Suche -- die zieht gleichnamige, voellig getrennte Gebiete
        // (z. B. zwei "Baronie Grenzmarken": Albernia vs. Beilunk) in dieselbe Außengrenze, sie
        // wurden als eine Einheit unioniert. Dual-Rolle bleibt erhalten: ein Aggregator mit eigener
        // Geometrie nimmt diese mit auf; ein Blatt liefert hier nur seine Eigengeometrie.
        $sourceTerritoryIds = array_merge([$targetTerritoryId], $descendantIds);
        $sourceMode = $descendantIds !== [] ? 'descendants' : 'target_territory';
    }

    // Namensbasierter Wiki-Fallback NUR, wenn gar kein Territorium aufgeloest wurde (reiner
    // Wiki-Knoten ohne eigenes political_territory) -- dort existiert keine parent_id-Hierarchie.
    if ($sourceTerritoryIds === [] && ($target['wiki'] ?? null) !== null) {
        $descendantIds = avesmapsPoliticalCollectDerivedGeometryWikiDescendantIds($pdo, $target['wiki']);
        $sourceTerritoryIds = $descendantIds;
        if ($sourceTerritoryIds !== []) {
            $sourceMode = 'wiki_descendants';
        }
    }

    $sourceGeometries = avesmapsPoliticalFetchDerivedSourceGeometries($pdo, $sourceTerritoryIds);

    return [
        'ok' => true,
        'territory_public_id' => (string) ($target['territory']['public_id'] ?? ''),
        'target_key' => $target['target_key'],
        'target_name' => $target['target_name'],
        'source_geometries' => $sourceGeometries,
        'source_count' => count($sourceGeometries),
        'source_mode' => $sourceMode,
        'source_territory_ids' => $sourceTerritoryIds,
        'contested_territory_public_ids' => avesmapsPoliticalFilterContestedSourceTerritoryPublicIds($pdo, $sourceTerritoryIds),
        // Map territory_public_id -> [claimant_public_id, ...] (nach sort_order). Der Client gruppiert die
        // Konflikt-Baronien nach gleicher Anspruchsteller-Menge und vereint ihre Flaechen (eine Schraffur).
        'contested_claimants' => avesmapsPoliticalFetchContestedClaimantsBySource($pdo, $sourceTerritoryIds),
        'descendant_territory_count' => count($descendantIds),
    ];
}

function avesmapsPoliticalSaveDerivedGeometry(PDO $pdo, array $payload, array $user): array {
    $target = avesmapsPoliticalResolveDerivedGeometryTarget($pdo, $payload, true, $user);
    $territory = $target['territory'] ?? null;
    if (!is_array($territory)) {
        throw new InvalidArgumentException(sprintf('Keine Außengrenze möglich: zum Ziel „%s“ gibt es kein gespeichertes Herrschaftsgebiet. Häkchen „Außengrenzen darstellen“ entfernen, dann wird die Zuordnung gespeichert.', (string) ($target['target_name'] ?? $target['target_key'] ?? '?')));
    }
    $territoryId = (int) $territory['id'];

    if (!avesmapsPoliticalReadBoolean($payload['is_active'] ?? true)) {
        return avesmapsPoliticalDeleteDerivedGeometryForTerritory($pdo, $territory, $user);
    }

    $geometry = avesmapsPoliticalReadGeoJsonGeometry($payload['geometry_geojson'] ?? null);
    $bounds = avesmapsPoliticalCalculateGeometryBounds($geometry);
    $minZoom = avesmapsPoliticalReadOptionalZoom($payload['min_zoom'] ?? null);
    $maxZoom = avesmapsPoliticalReadOptionalZoom($payload['max_zoom'] ?? null);
    // Das Zoom-Band der Außengrenze folgt der globalen Territoriumssichtbarkeit,
    // wenn es nicht explizit mitgegeben wird. Das haelt die Baender ueber
    // Neuberechnungen hinweg konsistent (Quelle: political_territory) und vermeidet
    // die fruehere Drift aus Formularfeldern.
    if ($minZoom === null) {
        $minZoom = avesmapsPoliticalReadOptionalZoom($territory['min_zoom'] ?? null);
    }
    if ($maxZoom === null) {
        $maxZoom = avesmapsPoliticalReadOptionalZoom($territory['max_zoom'] ?? null);
    }
    avesmapsPoliticalAssertZoomRange($minZoom, $maxZoom);

    $labelCenter = avesmapsPoliticalReadDerivedGeometryLabelCenter($payload, $geometry);
    $showInnerBoundaries = avesmapsPoliticalReadBoolean($payload['show_inner_boundaries'] ?? true);
    // Vorberechnete Innengrenzen (deduppte Trennlinien der direkten Kinder, 1 Tiefe) als
    // GeoJSON MultiLineString; null wenn das Ziel keine hat (z. B. < 2 Kinder, keine
    // geteilten Kanten). Wird im Frontend (Kaskade) berechnet und hier nur durchgereicht.
    $innerBoundaryPayload = $payload['inner_boundary_geojson'] ?? null;
    $innerBoundaryGeometry = (is_array($innerBoundaryPayload) && isset($innerBoundaryPayload['type']))
        ? $innerBoundaryPayload
        : null;
    // Umstrittene-Gebiete-Split: vom Client (Kaskaden-Engine) vorberechnet, hier nur durchgereicht.
    // NULL, wenn das Ziel keine Konflikte unter den Nachfahren hat.
    $fillRemainderPayload = $payload['fill_remainder_geojson'] ?? null;
    $fillRemainderGeometry = (is_array($fillRemainderPayload) && isset($fillRemainderPayload['type']))
        ? $fillRemainderPayload
        : null;
    // contested_pieces = Liste PRO Konflikt-Baronie [{territory_public_id, geometry}], damit jede
    // ihre eigenen Streifenfarben behaelt (Besitzerfarbe je Baronie + Anspruchsteller). KEINE
    // verschmolzene Flaeche. Server reicht die Struktur nur durch (kein Geometrie-Typ-Check).
    $contestedPiecesPayload = $payload['contested_pieces_geojson'] ?? null;
    $contestedPiecesData = (is_array($contestedPiecesPayload) && $contestedPiecesPayload !== [])
        ? $contestedPiecesPayload
        : null;
    $sourceRevision = avesmapsPoliticalNullableString(avesmapsNormalizeSingleLine((string) ($payload['source_revision'] ?? $payload['source_signature'] ?? ''), 255));
    $userId = (int) ($user['id'] ?? 0) ?: null;
    $publicId = avesmapsPoliticalUuidV4();

    $pdo->beginTransaction();
    try {
        $deactivateStatement = $pdo->prepare(
            'UPDATE political_territory_derived_geometry
            SET is_active = 0,
                updated_by = :updated_by
            WHERE territory_id = :territory_id
                AND is_active = 1'
        );
        $deactivateStatement->execute([
            'territory_id' => $territoryId,
            'updated_by' => $userId,
        ]);

        // ⚠️ generated_at kommt aus dem Spalten-Default (DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        // in der Live-DDL nachgelesen am 05.09.2026) -- zeichengleich zu dem, was hier bis dahin
        // ausdruecklich als `CURRENT_TIMESTAMP(3)` stand. Der Grund fuer den Umzug ist der Test:
        // SQLite parst `CURRENT_TIMESTAMP(3)` nicht, und erst ohne den Wert im INSERT kann
        // derived-huelle-ohne-leiche-test.php diesen Pfad WIRKLICH fahren, statt ihn zu lesen.
        $insertStatement = $pdo->prepare(
            'INSERT INTO political_territory_derived_geometry (
                public_id, territory_id, geometry_geojson, label_lng, label_lat,
                min_zoom, max_zoom, min_x, min_y, max_x, max_y, show_inner_boundaries,
                inner_boundary_geojson, fill_remainder_geojson, contested_pieces_geojson,
                source_revision, is_active, created_by, updated_by
            ) VALUES (
                :public_id, :territory_id, :geometry_geojson, :label_lng, :label_lat,
                :min_zoom, :max_zoom, :min_x, :min_y, :max_x, :max_y, :show_inner_boundaries,
                :inner_boundary_geojson, :fill_remainder_geojson, :contested_pieces_geojson,
                :source_revision, 1, :created_by, :updated_by
            )'
        );
        $insertStatement->execute([
            'public_id' => $publicId,
            'territory_id' => $territoryId,
            'geometry_geojson' => avesmapsPoliticalEncodeJsonOrNull($geometry),
            'label_lng' => $labelCenter['lng'],
            'label_lat' => $labelCenter['lat'],
            'min_zoom' => $minZoom,
            'max_zoom' => $maxZoom,
            'min_x' => $bounds['min_x'],
            'min_y' => $bounds['min_y'],
            'max_x' => $bounds['max_x'],
            'max_y' => $bounds['max_y'],
            'show_inner_boundaries' => $showInnerBoundaries ? 1 : 0,
            'inner_boundary_geojson' => avesmapsPoliticalEncodeJsonOrNull($innerBoundaryGeometry),
            'fill_remainder_geojson' => avesmapsPoliticalEncodeJsonOrNull($fillRemainderGeometry),
            'contested_pieces_geojson' => avesmapsPoliticalEncodeJsonOrNull($contestedPiecesData),
            'source_revision' => $sourceRevision,
            'created_by' => $userId,
            'updated_by' => $userId,
        ]);

        // 💣 Die Leiche. Bis zum 05.09.2026 blieb je Neuberechnung die alte Zeile mit is_active = 0
        // stehen -- und NICHTS liest oder reaktiviert je eine inaktive Huelle: alle Leser filtern
        // is_active = 1, einen Reaktivierer gibt es nicht, „Grenzen berechnen" holt sie als NEUE Zeile
        // zurueck, genau hier. Gemessen 04.09.2026: 5.263 tote gegen 131 aktive Zeilen, 88 MB, in zehn
        // Tagen nach der letzten Aufraeumung nachgewachsen. Sobald die Nachfolgerin steht, ist jede
        // inaktive Zeile dieses Gebiets ueberholt -- weg damit, in derselben Transaktion.
        // ⚠️ NUR dieses Gebiet und NUR inaktive: eine OHNE Nachfolgerin deaktivierte Huelle (Quelle
        // geloescht, avesmapsPoliticalDeactivateDerivedGeometryForTerritoryChain; Owner-Entscheid vom
        // 16.08.2026, weich statt hart) bleibt stehen -- bis ihre Neuberechnung sie hierher bringt.
        avesmapsPoliticalPruneSupersededDerivedGeometry($pdo, $territoryId);

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    return [
        'ok' => true,
        'territory_public_id' => (string) $territory['public_id'],
        'target_key' => $target['target_key'],
        'target_name' => $target['target_name'],
        'derived_geometry' => avesmapsPoliticalFetchDerivedGeometryByPublicId($pdo, $publicId),
    ];
}

// Loescht die inaktiven Huellen EINES Gebiets. 🔴 Nur rufen, wenn seine aktive Nachfolgerin schon
// steht (avesmapsPoliticalSaveDerivedGeometry, nach dem INSERT) -- fuer eine Huelle ohne Nachfolgerin
// gilt der weiche Loeschweg. Liefert die Zahl der entfernten Zeilen.
function avesmapsPoliticalPruneSupersededDerivedGeometry(PDO $pdo, int $territoryId): int {
    $statement = $pdo->prepare(
        'DELETE FROM political_territory_derived_geometry
        WHERE territory_id = :territory_id
            AND is_active = 0'
    );
    $statement->execute(['territory_id' => $territoryId]);

    return $statement->rowCount();
}

function avesmapsPoliticalDeleteDerivedGeometry(PDO $pdo, array $payload, array $user): array {
    // 💣 Eine Huelle ohne Gebiet hat keine territory_public_id, ueber die man sie adressieren
    // koennte. Der Loeschknopf im Aufraeumfenster fiel deshalb auf hard_delete_geometry mit der
    // DERIVED-ID zurueck -- und das sucht in political_territory_geometry, findet dort nichts und
    // antwortet „Die Geometrie wurde nicht gefunden."; genau die Zeilen, die der Entwurf listet,
    // waren einzeln nicht entfernbar. Also nimmt diese Aktion zusaetzlich die eigene public_id.
    $derivedPublicId = avesmapsNormalizeSingleLine((string) ($payload['derived_geometry_public_id'] ?? ''), 36);
    $hasTargetKey = avesmapsNormalizeSingleLine((string) (
        $payload['territory_public_id']
        ?? $payload['public_id']
        ?? $payload['target_key']
        ?? $payload['wiki_key']
        ?? ''
    ), 255) !== '';
    if ($derivedPublicId !== '' && !$hasTargetKey) {
        return avesmapsPoliticalDeleteDerivedGeometryByPublicId($pdo, $derivedPublicId, $user);
    }

    $target = avesmapsPoliticalResolveDerivedGeometryTarget($pdo, $payload, false);
    $territory = $target['territory'] ?? null;
    if (!is_array($territory)) {
        return [
            'ok' => true,
            'territory_public_id' => '',
            'target_key' => $target['target_key'],
            'derived_geometry' => null,
            'deactivated' => false,
            'affected' => 0,
        ];
    }

    return avesmapsPoliticalDeleteDerivedGeometryForTerritory($pdo, $territory, $user);
}

// Der Zugriffsweg fuer eine Huelle, die ueber kein Gebiet mehr erreichbar ist.
// 🔴 Die eigene public_id ist ein ZUGRIFFSWEG, keine zweite Meinung ueber hart/weich: gibt es das
// Gebiet noch, geht der Aufruf durch die Weiche wie jeder andere. Hart wird hier nur, was
// definitionsgemaess niemand mehr erzeugen kann -- eine Huelle ohne Territoriumszeile.
function avesmapsPoliticalDeleteDerivedGeometryByPublicId(PDO $pdo, string $derivedPublicId, array $user): array {
    $statement = $pdo->prepare(
        'SELECT territory_id
        FROM political_territory_derived_geometry
        WHERE public_id = :public_id
        LIMIT 1'
    );
    $statement->execute(['public_id' => $derivedPublicId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return ['ok' => false, 'error' => 'Die Außenhülle wurde nicht gefunden.'];
    }

    $territoryId = (int) ($row['territory_id'] ?? 0);
    if ($territoryId > 0) {
        $territoryStatement = $pdo->prepare('SELECT id, public_id FROM political_territory WHERE id = :id LIMIT 1');
        $territoryStatement->execute(['id' => $territoryId]);
        $territory = $territoryStatement->fetch(PDO::FETCH_ASSOC);
        if (is_array($territory)) {
            return avesmapsPoliticalDeleteDerivedGeometryForTerritory($pdo, $territory, $user);
        }
    }

    $deleted = avesmapsPoliticalHardDeleteDerivedGeometryRow(
        $pdo,
        $derivedPublicId,
        (int) ($user['id'] ?? 0),
        'orphan_single'
    );

    return [
        'ok' => true,
        'territory_public_id' => '',
        'derived_geometry_public_id' => $derivedPublicId,
        'derived_geometry' => null,
        'deactivated' => true,
        'hard' => true,
        'affected' => $deleted,
        'deleted' => $deleted,
    ];
}

function avesmapsPoliticalDeleteDerivedGeometryTree(PDO $pdo, array $payload, array $user): array {
    $target = avesmapsPoliticalResolveDerivedGeometryTarget($pdo, $payload, false);
    $territory = $target['territory'] ?? null;
    if (!is_array($territory)) {
        return [
            'ok' => true,
            'territory_public_id' => '',
            'target_key' => $target['target_key'],
            'derived_geometry' => null,
            'deactivated' => false,
            'affected' => 0,
            'affected_territories' => [],
        ];
    }

    $territories = avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo);
    $childrenByParent = avesmapsPoliticalBuildDerivedGeometryChildrenIndex($territories);
    $territoryIds = avesmapsPoliticalCollectDerivedGeometrySubtreeIds((int) $territory['id'], $childrenByParent);
    $territoryIds = array_values(array_unique(array_filter($territoryIds, static fn(int $id): bool => $id > 0)));
    if ($territoryIds === []) {
        $territoryIds = [(int) $territory['id']];
    }

    $placeholders = implode(',', array_fill(0, count($territoryIds), '?'));
    $selectStatement = $pdo->prepare(
        'SELECT DISTINCT territory_id
        FROM political_territory_derived_geometry
        WHERE is_active = 1
            AND territory_id IN (' . $placeholders . ')'
    );
    $selectStatement->execute($territoryIds);
    $activeTerritoryIds = array_map('intval', $selectStatement->fetchAll(PDO::FETCH_COLUMN));

    if ($activeTerritoryIds === []) {
        return [
            'ok' => true,
            'territory_public_id' => (string) $territory['public_id'],
            'target_key' => $target['target_key'],
            'derived_geometry' => null,
            'deactivated' => true,
            'affected' => 0,
            'hard_deleted' => 0,
            'affected_territories' => [],
        ];
    }

    // 🔴 Jedes betroffene Gebiet geht durch die WEICHE, nicht an ihr vorbei. Bis 16.08.2026 setzte
    // dieser Zweig ein eigenes Sammel-UPDATE ab: derselbe Text „Außenhülle löschen" loeschte damit
    // im Aufraeumfenster hart und auf der Karte weich. Der Geist blieb als inaktive Zeile stehen --
    // und war danach fuer KEIN Werkzeug mehr sichtbar, weil beide Listen is_active = 1 filtern.
    // ⚠️ EIN Schnappschuss fuer den ganzen Baum: Huellen zu loeschen aendert weder Quellflaechen
    // noch Territorien, er bleibt also ueber die Schleife gueltig (und spart das N+1).
    $context = avesmapsPoliticalDerivedHullSourceContext($pdo);
    $affected = 0;
    $hardDeleted = 0;
    foreach ($activeTerritoryIds as $activeTerritoryId) {
        $result = avesmapsPoliticalDeleteDerivedGeometryForTerritory(
            $pdo,
            [
                'id' => $activeTerritoryId,
                'public_id' => (string) ($territories[$activeTerritoryId]['public_id'] ?? ''),
            ],
            $user,
            $context
        );
        $affected += (int) ($result['affected'] ?? 0);
        if (($result['hard'] ?? false) === true) {
            $hardDeleted++;
        }
    }

    return [
        'ok' => true,
        'territory_public_id' => (string) $territory['public_id'],
        'target_key' => $target['target_key'],
        'derived_geometry' => null,
        'deactivated' => true,
        'affected' => $affected,
        'hard_deleted' => $hardDeleted,
        'affected_territories' => avesmapsPoliticalDescribePlanTerritories($activeTerritoryIds, $territories),
    ];
}

// ⚠️ $context ist der Schnappschuss aus avesmapsPoliticalDerivedHullSourceContext(). Er darf
// durchgereicht werden, wo mehrere Huellen in einem Zug fallen (Baum-Loeschen, Bulk-Knopf): das
// Loeschen einer Huelle aendert weder Quellflaechen noch Territorien, der Schnappschuss bleibt
// also gueltig. Fehlt er, wird er hier geholt.
function avesmapsPoliticalDeleteDerivedGeometryForTerritory(PDO $pdo, array $territory, array $user, ?array $context = null): array {
    $territoryId = (int) $territory['id'];
    // 🔴 Owner-Entscheid 16.08.2026: hart nur, wenn nichts mehr da ist, was die Huelle erzeugen
    // koennte. ⚠️ Hart heisst ohne Rueckweg -- die Deaktivierung WAR das Sicherheitsnetz. Tragfaehig
    // ist das nur, weil es ausschliesslich Huellen trifft, die niemand mehr zurueckrechnen kann.
    // Diese Weiche ist die EINZIGE Stelle, an der darueber entschieden wird; sie darf nicht in die
    // Aufrufer kopiert werden.
    $sourceless = avesmapsPoliticalDerivedHullIsSourceless(
        $pdo,
        $territoryId,
        $context ?? avesmapsPoliticalDerivedHullSourceContext($pdo)
    );

    if ($sourceless) {
        avesmapsPoliticalLogDerivedHullHardDelete(
            $pdo,
            avesmapsPoliticalFetchActiveDerivedHullRowsForTerritory($pdo, $territoryId),
            (int) ($user['id'] ?? 0),
            'territory'
        );
        $statement = $pdo->prepare(
            'DELETE FROM political_territory_derived_geometry
            WHERE territory_id = :territory_id
                AND is_active = 1'
        );
        $statement->execute(['territory_id' => $territoryId]);
    } else {
        $statement = $pdo->prepare(
            'UPDATE political_territory_derived_geometry
            SET is_active = 0,
                updated_by = :updated_by
            WHERE territory_id = :territory_id
                AND is_active = 1'
        );
        $statement->execute([
            'territory_id' => $territoryId,
            'updated_by' => (int) ($user['id'] ?? 0) ?: null,
        ]);
    }

    return [
        'ok' => true,
        'territory_public_id' => (string) $territory['public_id'],
        'derived_geometry' => null,
        'deactivated' => true,
        'hard' => $sourceless,
        'affected' => $statement->rowCount(),
    ];
}

// Die Zeilen, die ein hartes Loeschen gleich entfernt -- geholt, BEVOR es sie nicht mehr gibt.
function avesmapsPoliticalFetchActiveDerivedHullRowsForTerritory(PDO $pdo, int $territoryId): array {
    $statement = $pdo->prepare(
        'SELECT public_id, territory_id, min_x, min_y, max_x, max_y
        FROM political_territory_derived_geometry
        WHERE territory_id = :territory_id
            AND is_active = 1'
    );
    $statement->execute(['territory_id' => $territoryId]);

    return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

// Eine EINZELNE Huelle hart loeschen -- der dangling-Fall, der ueber kein Gebiet mehr adressierbar
// ist. 🔴 Hier gibt es nichts zu entscheiden: ohne Territoriumszeile kann sie niemand mehr
// erzeugen, „weich" waere nur ein Zustand, den kein Werkzeug mehr sieht (beide Listen filtern auf
// is_active = 1). Liefert die Zahl der entfernten Zeilen.
function avesmapsPoliticalHardDeleteDerivedGeometryRow(PDO $pdo, string $derivedPublicId, int $actorUserId, string $reason): int {
    $derivedPublicId = trim($derivedPublicId);
    if ($derivedPublicId === '') {
        return 0;
    }

    $rows = $pdo->prepare(
        'SELECT public_id, territory_id, min_x, min_y, max_x, max_y
        FROM political_territory_derived_geometry
        WHERE public_id = :public_id'
    );
    $rows->execute(['public_id' => $derivedPublicId]);
    avesmapsPoliticalLogDerivedHullHardDelete($pdo, $rows->fetchAll(PDO::FETCH_ASSOC) ?: [], $actorUserId, $reason);

    $drop = $pdo->prepare('DELETE FROM political_territory_derived_geometry WHERE public_id = :public_id');
    $drop->execute(['public_id' => $derivedPublicId]);

    return $drop->rowCount();
}

// 🔴 Der harte Zweig hinterliess bis 16.08.2026 KEINE Spur: kein updated_by (die Zeile ist ja weg)
// und keinen Protokolleintrag, waehrend der weiche wenigstens updated_by schrieb. Bei einer
// unumkehrbaren Handlung ist das die falsche Richtung -- also EIN Eintrag, vor dem DELETE.
//
// 💣 Er steht unter `derived_geometries`, NICHT unter `geometries`. Die Undo-Maschine
// (avesmapsPoliticalRestoreAuditGeometries) schreibt alles, was unter `geometries` liegt, in
// political_territory_geometry zurueck -- eine Aussenhuelle gehoert dort nicht hin, und ein
// spaeterer Eintrag von `hard_delete_derived_geometry` in die Undo-Liste wuerde daraus lautlos
// eine erfundene Quellflaeche machen. Der Eintrag ist ein Beleg, kein Rueckweg: die Aktion steht
// bewusst nicht in avesmapsPoliticalCanUndoGeometryAuditAction.
function avesmapsPoliticalLogDerivedHullHardDelete(PDO $pdo, array $rows, int $actorUserId, string $reason): void {
    if ($rows === []) {
        return;
    }

    $before = [];
    foreach ($rows as $row) {
        $publicId = (string) ($row['public_id'] ?? '');
        if ($publicId === '') {
            continue;
        }
        $before[$publicId] = [
            'territory_id' => (int) ($row['territory_id'] ?? 0),
            'min_x' => (float) ($row['min_x'] ?? 0),
            'min_y' => (float) ($row['min_y'] ?? 0),
            'max_x' => (float) ($row['max_x'] ?? 0),
            'max_y' => (float) ($row['max_y'] ?? 0),
            'is_active' => 1,
        ];
    }
    if ($before === []) {
        return;
    }

    avesmapsPoliticalWriteGeometryAuditLog(
        $pdo,
        'hard_delete_derived_geometry',
        $actorUserId,
        ['geometries' => [], 'territories' => [], 'derived_geometries' => $before, 'reason' => $reason],
        ['geometries' => [], 'territories' => [], 'derived_geometries' => []]
    );
}

// Beim Loeschen einer Geometrie/eines Territoriums: die abgeleitete Aussengrenze des
// betroffenen Gebiets UND seiner Vorfahren deaktivieren. Sonst bleibt eine (jetzt veraltete)
// Derived aktiv und rendert weiter ("Grenze, die nicht verschwinden will"). Die Vorfahren
// aggregieren das geloeschte Gebiet -> ihr Aggregat ist stale; ihre Aussengrenze muss per
// "Grenzen berechnen" neu erzeugt werden. Gibt die Anzahl deaktivierter Derived zurueck.
function avesmapsPoliticalDeactivateDerivedGeometryForTerritoryChain(PDO $pdo, int $territoryId, ?int $userId = null): int {
    if ($territoryId < 1) {
        return 0;
    }
    $territories = avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo);
    $ids = array_merge([$territoryId], avesmapsPoliticalCollectDerivedGeometryAncestorIds($territoryId, $territories));
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids), static fn(int $id): bool => $id > 0)));
    if ($ids === []) {
        return 0;
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        'UPDATE political_territory_derived_geometry
        SET is_active = 0,
            updated_by = ?
        WHERE is_active = 1
            AND territory_id IN (' . $placeholders . ')'
    );
    $statement->execute(array_merge([$userId ?: null], $ids));

    return $statement->rowCount();
}

function avesmapsPoliticalResolveDerivedGeometryTarget(PDO $pdo, array $input, bool $createMissing = false, array $user = []): array {
    $rawTarget = avesmapsNormalizeSingleLine((string) (
        $input['territory_public_id']
        ?? $input['public_id']
        ?? $input['target_key']
        ?? $input['wiki_key']
        ?? ''
    ), 255);
    $targetKey = avesmapsPoliticalNormalizeDerivedTargetKey($rawTarget);

    if ($targetKey === '') {
        throw new InvalidArgumentException('Das Ziel-Herrschaftsgebiet fehlt.');
    }

    if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $targetKey) === 1) {
        try {
            $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, avesmapsPoliticalReadPublicId($targetKey));
        } catch (InvalidArgumentException) {
            if ($createMissing) {
                throw new InvalidArgumentException('Fuer die abgeleitete Geometrie wurde kein gespeichertes Ziel-Herrschaftsgebiet gefunden.');
            }
            return [
                'territory' => null,
                'wiki' => null,
                'target_key' => $targetKey,
                'target_name' => $targetKey,
            ];
        }
        return [
            'territory' => $territory,
            'wiki' => !empty($territory['wiki_id']) ? avesmapsPoliticalFetchWikiById($pdo, (int) $territory['wiki_id']) : null,
            'target_key' => $targetKey,
            'target_name' => (string) ($territory['name'] ?? ''),
        ];
    }

    $wiki = avesmapsPoliticalFindDerivedGeometryWikiTarget($pdo, $targetKey);
    if ($wiki === null && $rawTarget !== '') {
        // Kanonischer Fallback: der lokale Finder oben matcht den wiki_key ohne
        // "wiki:"-Praefix und manglet Umlaute im Namen (z. B. Bergkoenigreich ->
        // "bergk nigreich"), wodurch Knoten mit Umlaut/Praefix nie aufgeloest
        // wurden. avesmapsPoliticalFetchWikiByKey ist der robuste, gemeinsame
        // Resolver (versteht wiki:/name:-Praefix, Slug- und Namens-Fallback) und
        // haelt damit Laden, Quellen und Speichern auf demselben Ziel.
        try {
            $wiki = avesmapsPoliticalFetchWikiByKey($pdo, $rawTarget);
        } catch (InvalidArgumentException) {
            $wiki = null;
        }
    }
    $territory = null;
    if ($wiki !== null) {
        $territory = avesmapsPoliticalFindTerritoryByWikiOrSlug($pdo, (int) $wiki['id'], avesmapsPoliticalSlug((string) ($wiki['name'] ?? $targetKey)));
        if (!$territory && $createMissing) {
            $created = avesmapsPoliticalCreateTerritoryFromWiki($pdo, [
                'wiki_id' => (int) $wiki['id'],
                'name' => (string) $wiki['name'],
                'type' => 'Herrschaftsgebiet',
                'color' => '#888888',
                'opacity' => 0.33,
                'valid_to_open' => true,
                'editor_notes' => 'Automatisch fuer abgeleitete Außengrenze aus Wiki-Zuordnung angelegt.',
            ], $user);
            $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, (string) $created['territory']['public_id']);
        }
    }

    return [
        'territory' => $territory,
        'wiki' => $wiki,
        'target_key' => $targetKey,
        'target_name' => (string) ($territory['name'] ?? $wiki['name'] ?? $targetKey),
    ];
}

function avesmapsPoliticalNormalizeDerivedTargetKey(string $value): string {
    $value = trim($value);
    if ($value === '') {
        return '';
    }

    if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1) {
        return strtolower($value);
    }

    if (str_starts_with(strtolower($value), 'wiki:')) {
        $value = substr($value, 5);
    }

    return avesmapsPoliticalSlug($value);
}

function avesmapsPoliticalFindDerivedGeometryWikiTarget(PDO $pdo, string $targetKey): ?array {
    if ($targetKey === '') {
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory_wiki
        WHERE wiki_key = :wiki_key
            OR name = :name
        ORDER BY id ASC
        LIMIT 1'
    );
    $statement->execute([
        'wiki_key' => $targetKey,
        'name' => str_replace('-', ' ', $targetKey),
    ]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ?: null;
}

function avesmapsPoliticalCollectDerivedGeometryDescendantIds(int $territoryId, array $territories): array {
    $childrenByParent = [];
    foreach ($territories as $candidateId => $territory) {
        $parentId = (int) ($territory['parent_id'] ?? 0);
        if ($parentId === $territoryId) {
            $childrenByParent[$territoryId][] = (int) $candidateId;
        }
    }

    $descendantIds = [];
    $queue = $childrenByParent[$territoryId] ?? [];
    while ($queue !== []) {
        $candidateId = (int) array_shift($queue);
        if (in_array($candidateId, $descendantIds, true)) {
            continue;
        }
        $descendantIds[] = $candidateId;
        foreach ($territories as $childId => $candidate) {
            if ((int) ($candidate['parent_id'] ?? 0) === $candidateId) {
                $queue[] = (int) $childId;
            }
        }
    }

    return $descendantIds;
}

function avesmapsPoliticalCollectDerivedGeometryWikiDescendantIds(PDO $pdo, array $wiki): array {
    $path = avesmapsPoliticalDecodeJson($wiki['affiliation_path_json'] ?? null);
    $names = [];
    if (is_array($path)) {
        $names = array_values(array_filter(array_map('strval', $path), static fn(string $name): bool => trim($name) !== ''));
    }
    $names[] = (string) ($wiki['name'] ?? '');
    $names = array_values(array_unique(array_filter($names, static fn(string $name): bool => trim($name) !== '')));
    if ($names === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($names), '?'));
    $statement = $pdo->prepare(
        'SELECT territory.id
        FROM political_territory territory
        LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
        WHERE territory.is_active = 1
            AND (
                territory.name IN (' . $placeholders . ')
                OR wiki.name IN (' . $placeholders . ')
            )'
    );
    $statement->execute(array_merge($names, $names));

    return array_values(array_unique(array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN))));
}

function avesmapsPoliticalFetchDerivedSourceGeometries(PDO $pdo, array $territoryIds): array {
    $territoryIds = array_values(array_unique(array_filter(array_map('intval', $territoryIds), static fn(int $id): bool => $id > 0)));
    if ($territoryIds === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($territoryIds), '?'));
    $statement = $pdo->prepare(
        'SELECT
            geometry.*,
            territory.public_id AS territory_public_id,
            territory.name AS territory_name,
            territory.short_name AS territory_short_name,
            territory.parent_id AS territory_parent_id
        FROM political_territory_geometry geometry
        INNER JOIN political_territory territory ON territory.id = geometry.territory_id
        WHERE geometry.is_active = 1
            AND territory.is_active = 1
            AND geometry.territory_id IN (' . $placeholders . ')
        ORDER BY territory.sort_order ASC, territory.name ASC, geometry.id ASC'
    );
    $statement->execute($territoryIds);

    $sourceGeometries = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $sourceGeometries[] = [
            'geometry_public_id' => (string) $row['public_id'],
            'territory_public_id' => (string) $row['territory_public_id'],
            'territory_name' => (string) ($row['territory_name'] ?? ''),
            'territory_short_name' => (string) ($row['territory_short_name'] ?? ''),
            'geometry' => avesmapsPoliticalDecodeJson($row['geometry_geojson'] ?? null),
            'source' => (string) ($row['source'] ?? ''),
            'updated_at' => (string) ($row['updated_at'] ?? ''),
        ];
    }

    return $sourceGeometries;
}

function avesmapsPoliticalReadDerivedGeometryLabelCenter(array $payload, array $geometry): array {
    $labelLng = $payload['label_lng'] ?? null;
    $labelLat = $payload['label_lat'] ?? null;
    if (is_numeric($labelLng) && is_numeric($labelLat)) {
        return [
            'lng' => (float) $labelLng,
            'lat' => (float) $labelLat,
        ];
    }

    $computed = avesmapsPoliticalComputeGeometryLabelCenter($geometry);
    if ($computed !== null) {
        return $computed;
    }

    throw new InvalidArgumentException('Fuer die abgeleitete Geometrie konnte keine Labelposition berechnet werden.');
}

function avesmapsPoliticalFetchActiveDerivedGeometryForTerritory(PDO $pdo, int $territoryId): ?array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory_derived_geometry
        WHERE territory_id = :territory_id
            AND is_active = 1
        ORDER BY updated_at DESC, id DESC
        LIMIT 1'
    );
    $statement->execute(['territory_id' => $territoryId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ? avesmapsPoliticalDerivedGeometryRowToPublic($row) : null;
}

function avesmapsPoliticalFetchDerivedGeometryByPublicId(PDO $pdo, string $publicId): ?array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory_derived_geometry
        WHERE public_id = :public_id
        LIMIT 1'
    );
    $statement->execute(['public_id' => $publicId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return $row ? avesmapsPoliticalDerivedGeometryRowToPublic($row) : null;
}

function avesmapsPoliticalDerivedGeometryRowToPublic(array $row): array {
    return [
        'public_id' => (string) ($row['public_id'] ?? ''),
        'territory_id' => (int) ($row['territory_id'] ?? 0),
        'geometry' => avesmapsPoliticalDecodeJson($row['geometry_geojson'] ?? null),
        'label_lng' => isset($row['label_lng']) ? (float) $row['label_lng'] : null,
        'label_lat' => isset($row['label_lat']) ? (float) $row['label_lat'] : null,
        'min_zoom' => $row['min_zoom'] !== null ? (int) $row['min_zoom'] : null,
        'max_zoom' => $row['max_zoom'] !== null ? (int) $row['max_zoom'] : null,
        'show_inner_boundaries' => !array_key_exists('show_inner_boundaries', $row) || (int) $row['show_inner_boundaries'] === 1,
        'inner_boundary_geojson' => array_key_exists('inner_boundary_geojson', $row) && $row['inner_boundary_geojson'] !== null && $row['inner_boundary_geojson'] !== ''
            ? avesmapsPoliticalDecodeJson($row['inner_boundary_geojson'])
            : null,
        'fill_remainder_geojson' => array_key_exists('fill_remainder_geojson', $row) && $row['fill_remainder_geojson'] !== null && $row['fill_remainder_geojson'] !== ''
            ? avesmapsPoliticalDecodeJson($row['fill_remainder_geojson'])
            : null,
        'contested_pieces_geojson' => array_key_exists('contested_pieces_geojson', $row) && $row['contested_pieces_geojson'] !== null && $row['contested_pieces_geojson'] !== ''
            ? avesmapsPoliticalDecodeJson($row['contested_pieces_geojson'])
            : null,
        'source_revision' => (string) ($row['source_revision'] ?? ''),
        'generated_at' => (string) ($row['generated_at'] ?? ''),
        'is_active' => (int) ($row['is_active'] ?? 0) === 1,
        'created_at' => (string) ($row['created_at'] ?? ''),
        'updated_at' => (string) ($row['updated_at'] ?? ''),
    ];
}
