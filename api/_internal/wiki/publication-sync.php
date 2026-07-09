<?php

declare(strict_types=1);

// Wiki-Publikationsquellen: Staging-Schema (additiv, self-healing via IF NOT EXISTS).
// This file currently holds ONLY the staging DDL (task 1 of the wiki-publication-sources
// build-out, see docs/wiki-publikations-quellen-design.md). The reconcile/orchestration phase
// (parsing wiki_publication_catalog + wiki_entity_publication into sources/feature_sources,
// origin='wiki_publication', suppression tombstones) is a later task and will be appended
// to this same file — kept side-effect-free on include until then.
//
// wiki_publication_catalog: one row per publication wiki page ({{Infobox Produkt}}), identity =
// wiki_key (stable, same convention as the other WikiSync staging tables).
// wiki_entity_publication: map-element <-> publication references (reference kind/pages/note
// parsed from a "==Publikationen==" section), identity = (entity_wiki_key, publication_wiki_key)
// — one entity can reference the same publication only once.
function avesmapsEnsurePublicationStagingTables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_publication_catalog (
            wiki_key VARCHAR(190) NOT NULL PRIMARY KEY,
            title VARCHAR(300),
            art VARCHAR(80),
            source_type VARCHAR(32),
            isbn VARCHAR(20),
            f_shop_url TEXT,
            pdf_shop_url TEXT,
            chosen_url TEXT,
            has_link TINYINT(1),
            synced_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_entity_publication (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            entity_wiki_key VARCHAR(190),
            publication_wiki_key VARCHAR(190),
            reference_kind VARCHAR(16),
            pages VARCHAR(120) NULL,
            note VARCHAR(200) NULL,
            UNIQUE KEY uq (entity_wiki_key, publication_wiki_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}
