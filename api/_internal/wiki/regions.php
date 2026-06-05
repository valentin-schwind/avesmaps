<?php

declare(strict_types=1);

// WikiSync fuer REGIONEN (natuerliche Landschaften: Wuesten, Gebirge, Waelder, Suempfe,
// Inseln, Meere, Seen, Gross-/Mischregionen ...). Bewusst SCHLANK und getrennt von der
// komplexen Herrschaftsgebiete-Maschine (sync-monitor.php): es gibt KEINE Hierarchie der
// Regionen untereinander, wir brauchen nur eine FLACHE Liste aus dem Wiki, die sich auf
// unsere Karten-Regionen (= Label-Features feature_type='label') mappen laesst.
//
// Quelle: Wiki-Seiten mit {{Infobox Region}} (Felder Art/Bild/Region/Staat/Nachbarn/...),
// enumeriert ueber den Derographie-Kategoriebaum (Derographische Region + Grossregion +
// Hydroderographie, rekursiv) via MediaWiki categorymembers.
//
// Diese Datei setzt voraus, dass der einbindende Endpoint zuvor geladen hat:
//   _internal/wiki/sync.php            (avesmapsWikiSyncApiRequest, *EncodeJson/*DecodeJson, *CreateMatchKey)
//   _internal/wiki/sync-monitor.php    (Tabellen-/Parse-Helfer: *TableExists/*CountRows/*Columns,
//                                       *ExtractInfoboxBlock/*ParseTemplateParams/*FieldKey/...)
//   _internal/political/territory.php  (avesmapsPoliticalSlug, avesmapsPoliticalUuidV4)
//
// geometry/political_territory/map_features bleiben UNANGETASTET. Schreiben passiert nur in
// die beiden Sandbox-Tabellen unten; ein Zuordnen/Anlegen auf der Karte ist ein spaeterer,
// bewusster Schritt.

const AVESMAPS_WIKI_REGION_STAGING_TABLE = 'wiki_region_staging';
const AVESMAPS_WIKI_REGION_QUEUE_TABLE = 'wiki_region_queue';
const AVESMAPS_WIKI_REGION_MAX_DEPTH = 4; // Kategorie-Rekursionstiefe (Typ-Subkats sind verschachtelt: Hochland->Gebirge).

// Legt die beiden Sandbox-Tabellen idempotent an. Read-only ausser diesem ensure-Schritt.
function avesmapsWikiRegionEnsureTables(PDO $pdo): void {
    // Staging = flache Liste der Wiki-Regionen (ein Eintrag je wiki_key). Bewusst eigenes,
    // bespoke Schema (kein LIKE political_territory_wiki) — Regionen haben andere Felder
    // (Art/Lage/Bild/Vegetation/Nachbarn statt Hierarchie/Hauptstadt/Herrscher).
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            wiki_key VARCHAR(255) NOT NULL,
            page_id BIGINT NULL,
            title VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            match_key VARCHAR(255) NOT NULL DEFAULT \'\',
            art VARCHAR(120) NULL,
            continent VARCHAR(120) NULL,
            region_parent VARCHAR(255) NULL,
            affiliation_staat VARCHAR(255) NULL,
            einwohner VARCHAR(255) NULL,
            sprache VARCHAR(255) NULL,
            vegetation VARCHAR(500) NULL,
            verkehrswege VARCHAR(500) NULL,
            description TEXT NULL,
            neighbors_json JSON NULL,
            synonyms_json JSON NULL,
            source_categories_json JSON NULL,
            image_url VARCHAR(500) NULL,
            image_license VARCHAR(120) NULL,
            image_author VARCHAR(255) NULL,
            image_attribution VARCHAR(500) NULL,
            image_license_status VARCHAR(40) NULL,
            image_license_url VARCHAR(500) NULL,
            wiki_url VARCHAR(500) NULL,
            raw_json JSON NULL,
            synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_region_staging_key (wiki_key),
            KEY idx_wiki_region_staging_match (match_key),
            KEY idx_wiki_region_staging_art (art),
            KEY idx_wiki_region_staging_continent (continent)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    // Resumierbare BFS-Frontier + Visited in einem (pro run_id, dedup_key genau ein Eintrag).
    // role: category (rekursiv erweitern) | page (Infobox parsen). Spiegelt wiki_crawl_queue,
    // bleibt aber bewusst getrennt, damit Regionen- und Herrschaftsgebiete-Crawls sich nie stoeren.
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_REGION_QUEUE_TABLE . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_id CHAR(36) NOT NULL,
            dedup_key VARCHAR(255) NOT NULL,
            wiki_title VARCHAR(255) NOT NULL,
            wiki_key VARCHAR(255) NULL,
            depth INT NOT NULL DEFAULT 0,
            role VARCHAR(40) NOT NULL DEFAULT \'page\',
            source VARCHAR(255) NULL,
            status VARCHAR(20) NOT NULL DEFAULT \'pending\',
            attempts INT NOT NULL DEFAULT 0,
            error_text VARCHAR(500) NULL,
            claimed_at DATETIME(3) NULL,
            processed_at DATETIME(3) NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_region_queue_run_dedup (run_id, dedup_key),
            KEY idx_wiki_region_queue_run_status (run_id, status),
            KEY idx_wiki_region_queue_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

// Aufbau-/Bestandsstatus der beiden Sandbox-Tabellen. Nutzt die generischen Tabellen-Helfer
// aus sync-monitor.php (vom Endpoint vorab geladen).
function avesmapsWikiRegionBuildStatus(PDO $pdo): array {
    avesmapsWikiRegionEnsureTables($pdo);

    $tables = [];
    foreach ([AVESMAPS_WIKI_REGION_STAGING_TABLE, AVESMAPS_WIKI_REGION_QUEUE_TABLE] as $table) {
        $tables[$table] = [
            'exists' => avesmapsWikiSyncMonitorTableExists($pdo, $table),
            'row_count' => avesmapsWikiSyncMonitorCountRows($pdo, $table),
            'columns' => avesmapsWikiSyncMonitorColumns($pdo, $table),
        ];
    }

    return [
        'ok' => true,
        'max_depth' => AVESMAPS_WIKI_REGION_MAX_DEPTH,
        'tables' => $tables,
    ];
}
