-- =============================================================================
-- Avesmaps — consolidated MySQL schema BASELINE (reference / documentation)
-- =============================================================================
--
-- Generated/maintained: 2026-06-14
--
-- WHAT THIS IS
--   A single, human- and AI-readable baseline of the Avesmaps data model. It
--   consolidates the table definitions that the application creates at runtime
--   via the project's "self-healing" pattern: most tables are created from
--   inline `CREATE TABLE IF NOT EXISTS ...` DDL embedded in PHP strings and run
--   on demand (so a fresh STRATO DB heals itself on first request), plus a few
--   core/bootstrap tables that only ever existed as .sql files.
--
-- AUTHORITY / SOURCE OF TRUTH
--   The inline DDL inside the PHP files REMAINS the runtime source of truth.
--   This file does NOT replace it and is NOT loaded by the app. It exists so a
--   human or AI can understand the schema in one place and so a fresh database
--   can be bootstrapped from a single script. If you change an inline
--   `CREATE TABLE` in PHP, update this file to match (it is documentation, not a
--   migration system).
--
--   Each table below carries a `-- source:` comment pointing at the PHP file (or
--   sql/ file) whose DDL it mirrors. Where the live table has been extended via
--   in-PHP `ALTER TABLE ... ADD COLUMN` guards (license columns, derived-geometry
--   split columns, the model `excluded` flag, etc.), those columns are folded
--   into the CREATE body here and flagged with an inline comment, so this
--   baseline reflects the table's true live shape, not just its first revision.
--
-- CONVENTIONS (consistent across the schema)
--   * No foreign-key constraints anywhere; relationships are by id/key only.
--   * Soft-delete via `is_active TINYINT(1)` where applicable.
--   * utf8mb4 / utf8mb4_unicode_ci, InnoDB.
--   * BF = "Bosparans Fall" in-world calendar year; 9999 = open/never-dissolved
--     sentinel. GeoJSON stores [x, y]; Leaflet CRS.Simple uses [lat, lng]=[y, x].
--
-- =============================================================================


-- =============================================================================
-- DOMAIN: CORE MAP FEATURES
-- (users + the map_features graph + global revision counter + audit log)
-- NOTE: these core tables have NO inline self-healing DDL in PHP. They live only
--       as .sql and are effectively bootstrap-only — a fresh DB must be seeded
--       from this file (or sql/schema.future.mysql.sql) for them to exist.
-- =============================================================================

-- source: sql/schema.future.mysql.sql (no inline PHP DDL)
CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(80) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    KEY idx_users_role_active (role, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: sql/schema.future.mysql.sql (no inline PHP DDL)
-- Locations, crossings, paths, rivers, regions and labels — the map graph.
CREATE TABLE IF NOT EXISTS map_features (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id CHAR(36) NOT NULL,
    feature_type VARCHAR(40) NOT NULL,
    feature_subtype VARCHAR(60) NOT NULL,
    name VARCHAR(160) NULL,
    geometry_type VARCHAR(40) NOT NULL,
    geometry_json JSON NOT NULL,
    properties_json JSON NULL,
    style_json JSON NULL,
    min_x DECIMAL(10, 4) NOT NULL,
    min_y DECIMAL(10, 4) NOT NULL,
    max_x DECIMAL(10, 4) NOT NULL,
    max_y DECIMAL(10, 4) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_map_features_public_id (public_id),
    KEY idx_map_features_type_active (feature_type, feature_subtype, is_active),
    KEY idx_map_features_bbox (min_x, min_y, max_x, max_y),
    KEY idx_map_features_revision (revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: sql/schema.future.mysql.sql (no inline PHP DDL)
-- Single-row global revision counter (id always = 1) bumped on every map write.
CREATE TABLE IF NOT EXISTS map_revision (
    id TINYINT UNSIGNED NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO map_revision (id, revision)
VALUES (1, 1)
ON DUPLICATE KEY UPDATE revision = revision;

-- source: sql/schema.future.mysql.sql (no inline PHP DDL)
CREATE TABLE IF NOT EXISTS map_audit_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    feature_id BIGINT UNSIGNED NULL,
    action VARCHAR(40) NOT NULL,
    actor_user_id BIGINT UNSIGNED NULL,
    before_json JSON NULL,
    after_json JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    undone_at DATETIME(3) NULL,
    undone_by BIGINT UNSIGNED NULL,
    undo_audit_id BIGINT UNSIGNED NULL,
    PRIMARY KEY (id),
    KEY idx_map_audit_log_feature_created (feature_id, created_at),
    KEY idx_map_audit_log_actor_created (actor_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- DOMAIN: LOCKS + EDITOR PRESENCE
-- =============================================================================

-- source: api/_internal/map/features.php  (avesmapsEnsureMapFeatureLocksTable)
--         api/_internal/wiki/locations-helpers.php  (avesmapsWikiSyncEnsureMapFeatureLocksTable)
-- NOTE: defined in TWO PHP files; the two CREATE statements are byte-identical.
CREATE TABLE IF NOT EXISTS map_feature_locks (
    public_id CHAR(36) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    username VARCHAR(120) NOT NULL,
    locked_until DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (public_id),
    KEY idx_map_feature_locks_locked_until (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/edit/map/presence.php  (avesmapsEnsureEditorPresenceTable)
CREATE TABLE IF NOT EXISTS editor_presence (
    user_id BIGINT UNSIGNED NOT NULL,
    username VARCHAR(120) NOT NULL,
    role VARCHAR(20) NOT NULL,
    last_seen DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    request_origin VARCHAR(255) NULL,
    user_agent VARCHAR(500) NULL,
    PRIMARY KEY (user_id),
    KEY idx_editor_presence_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- DOMAIN: REVIEWS + REPORTS + SHARE LINKS
-- =============================================================================

-- source: api/_internal/reviews.php  (avesmapsEnsureMapReviewsTable)
-- Community star ratings / reviews per location (community moderation flags).
CREATE TABLE IF NOT EXISTS map_reviews (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    location_public_id VARCHAR(64) NOT NULL,
    location_name VARCHAR(255) NOT NULL DEFAULT "",
    author_name VARCHAR(80) NOT NULL DEFAULT "",
    stars TINYINT UNSIGNED NOT NULL,
    body VARCHAR(200) NOT NULL DEFAULT "",
    dsa_date VARCHAR(60) NOT NULL DEFAULT "",
    is_hidden TINYINT(1) NOT NULL DEFAULT 0,
    is_spam TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    request_origin VARCHAR(255) NOT NULL DEFAULT "",
    ip_hash VARCHAR(64) NOT NULL DEFAULT "",
    user_agent VARCHAR(500) NOT NULL DEFAULT "",
    PRIMARY KEY (id),
    KEY idx_reviews_loc_visible (location_public_id, is_hidden, is_spam, created_at),
    KEY idx_reviews_iphash_created (ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/app/report-location.php  (avesmapsEnsureMapReportsTable)  [authoritative]
--         api/edit/reports/locations.php  (avesmapsEnsureMapReportsTableForReview)  [divergent]
-- DIVERGENCE: both files create map_reports. The writer (report-location.php)
-- defines THREE secondary indexes incl. idx_map_reports_ip_hash_created_at and
-- additionally self-heals legacy tables via ALTERs (adds reporter_name, ip_hash
-- and the ip_hash index). The review reader (edit/reports/locations.php) defines
-- only TWO indexes and omits idx_map_reports_ip_hash_created_at. Column sets are
-- otherwise identical. The writer's fuller definition is used below.
CREATE TABLE IF NOT EXISTS map_reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    status VARCHAR(20) NOT NULL DEFAULT 'neu',
    report_type VARCHAR(40) NOT NULL,
    report_subtype VARCHAR(60) NOT NULL,
    name VARCHAR(160) NOT NULL,
    reporter_name VARCHAR(80) NULL,
    lat DECIMAL(10, 4) NOT NULL,
    lng DECIMAL(10, 4) NOT NULL,
    source VARCHAR(200) NOT NULL,
    wiki_url VARCHAR(300) NULL,
    comment TEXT NULL,
    page_url VARCHAR(500) NULL,
    client_version VARCHAR(80) NULL,
    review_note TEXT NULL,
    request_origin VARCHAR(255) NULL,
    remote_ip VARCHAR(64) NULL,
    ip_hash CHAR(64) NULL,
    user_agent VARCHAR(500) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    reviewed_at DATETIME(3) NULL,
    reviewed_by BIGINT UNSIGNED NULL,
    PRIMARY KEY (id),
    KEY idx_map_reports_status_created_at (status, created_at),
    KEY idx_map_reports_type_status (report_type, report_subtype, status),
    KEY idx_map_reports_ip_hash_created_at (ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: sql/schema.mysql.sql + sql/schema.pgsql.sql (no inline PHP DDL)
-- Server-to-server import target (api/import/location-reports/*). The import
-- endpoints only READ/UPDATE this table; they never create it, so it must be
-- provisioned from .sql (not self-healing).
CREATE TABLE IF NOT EXISTS location_reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    status VARCHAR(20) NOT NULL DEFAULT 'neu',
    name VARCHAR(80) NOT NULL,
    size VARCHAR(20) NOT NULL,
    lat DECIMAL(7, 3) NOT NULL,
    lng DECIMAL(7, 3) NOT NULL,
    source VARCHAR(200) NOT NULL,
    wiki_url VARCHAR(300) NULL,
    comment TEXT NULL,
    page_url VARCHAR(500) NULL,
    client_version VARCHAR(80) NULL,
    review_note TEXT NULL,
    reviewed_at DATETIME(3) NULL,
    request_origin VARCHAR(255) NULL,
    remote_ip VARCHAR(64) NULL,
    user_agent VARCHAR(500) NULL,
    PRIMARY KEY (id),
    KEY idx_location_reports_status_created_at (status, created_at),
    KEY idx_location_reports_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/app/share-link.php  (avesmapsEnsureShareLinksTable)
-- Short codes for shareable map URLs (route plans / map state query strings).
CREATE TABLE IF NOT EXISTS map_share_links (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(16) NOT NULL,
    query_hash CHAR(64) NOT NULL,
    target_query VARCHAR(4000) NOT NULL,
    hits INT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_hash VARCHAR(64) NOT NULL DEFAULT "",
    PRIMARY KEY (id),
    UNIQUE KEY uniq_share_code (code),
    KEY idx_share_query_hash (query_hash),
    KEY idx_share_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- DOMAIN: POLITICAL TERRITORY (Herrschaftsgebiete)
-- Territory hierarchy via parent_id; GeoJSON geometry with a BF-year timeline.
-- =============================================================================

-- source: sql/political-territories.sql (no inline CREATE in PHP)
-- IMPORTANT: the central political_territory table is NOT self-healing. PHP only
-- ALTERs it (avesmapsPoliticalEnsureTables adds wiki_key + index if missing) and
-- INSERTs into it; it never CREATEs it. It must be provisioned from .sql.
CREATE TABLE IF NOT EXISTS political_territory (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id CHAR(36) NOT NULL,
    wiki_id BIGINT UNSIGNED NULL,
    wiki_key VARCHAR(255) NULL,             -- ALTER-added by PHP if missing (with idx_political_territory_wiki_key)
    slug VARCHAR(180) NOT NULL,
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(160) NULL,
    type VARCHAR(160) NULL,
    parent_id BIGINT UNSIGNED NULL,
    continent VARCHAR(120) NOT NULL DEFAULT 'Aventurien',
    status VARCHAR(255) NULL,
    color CHAR(9) NOT NULL DEFAULT '#888888',
    opacity DECIMAL(4, 3) NOT NULL DEFAULT 0.330,
    coat_of_arms_url VARCHAR(500) NULL,
    wiki_url VARCHAR(500) NULL,
    capital_place_id BIGINT UNSIGNED NULL,
    seat_place_id BIGINT UNSIGNED NULL,
    valid_from_bf INT NULL,
    valid_to_bf INT NULL,                    -- 9999 = open/never-dissolved sentinel
    valid_label VARCHAR(500) NULL,
    min_zoom TINYINT UNSIGNED NULL,
    max_zoom TINYINT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    editor_notes TEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_political_territory_public_id (public_id),
    UNIQUE KEY uq_political_territory_slug (slug),
    KEY idx_political_territory_wiki (wiki_id),
    KEY idx_political_territory_wiki_key (wiki_key),
    KEY idx_political_territory_parent (parent_id),
    KEY idx_political_territory_continent_active (continent, is_active),
    KEY idx_political_territory_timeline (valid_from_bf, valid_to_bf),
    KEY idx_political_territory_zoom (min_zoom, max_zoom)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/_internal/political/territory.php  (avesmapsPoliticalEnsureTables)
-- Wiki-mirror of territory identity (WikiSync writes here). The license columns
-- below are ALTER-added at runtime by avesmapsWikiSyncMonitorEnsureLicenseColumns
-- (api/_internal/wiki/sync-monitor-licenses.php) and folded in here.
CREATE TABLE IF NOT EXISTS political_territory_wiki (
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
    coat_of_arms_license VARCHAR(120) NULL,          -- ALTER-added (license enrichment)
    coat_of_arms_author VARCHAR(255) NULL,           -- ALTER-added (license enrichment)
    coat_of_arms_attribution VARCHAR(500) NULL,      -- ALTER-added (license enrichment)
    coat_of_arms_license_status VARCHAR(40) NULL,    -- ALTER-added (license enrichment)
    coat_of_arms_license_url VARCHAR(500) NULL,      -- ALTER-added (license enrichment)
    raw_json JSON NULL,
    synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_political_territory_wiki_key (wiki_key),
    KEY idx_political_territory_wiki_continent (continent),
    KEY idx_political_territory_wiki_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/_internal/political/territory.php  (avesmapsPoliticalEnsureTables)
-- NOTE: PHP creates territory_id as NULL and additionally MODIFYs an existing
-- column to NULL (sql/ snapshots show NOT NULL — PHP is authoritative: NULL).
CREATE TABLE IF NOT EXISTS political_territory_geometry (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id CHAR(36) NOT NULL,
    territory_id BIGINT UNSIGNED NULL,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/_internal/political/territory.php  (avesmapsPoliticalEnsureTables)
CREATE TABLE IF NOT EXISTS political_territory_geometry_audit_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    action VARCHAR(80) NOT NULL,
    actor_user_id BIGINT UNSIGNED NULL,
    before_json JSON NOT NULL,
    after_json JSON NOT NULL,
    undone_at DATETIME(3) NULL,
    undone_by BIGINT UNSIGNED NULL,
    undo_audit_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_political_territory_geometry_audit_created (created_at, id),
    KEY idx_political_territory_geometry_audit_actor (actor_user_id),
    KEY idx_political_territory_geometry_audit_undone (undone_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/_internal/political/territory.php  (avesmapsPoliticalEnsureTables)
-- "Umstrittene Gebiete": additive claim table. Ownership model is untouched;
-- "contested" is derived (>=1 active claim). No FK constraints; soft-delete.
CREATE TABLE IF NOT EXISTS political_territory_claim (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    territory_id BIGINT UNSIGNED NOT NULL,
    claimant_territory_id BIGINT UNSIGNED NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    source VARCHAR(16) NOT NULL DEFAULT 'manual',
    claimant_wiki_key VARCHAR(255) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_political_territory_claim (territory_id, claimant_territory_id),
    KEY idx_political_territory_claim_territory (territory_id, is_active),
    KEY idx_political_territory_claim_party (claimant_territory_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/_internal/political/territories-derived-geometry.php
--         (avesmapsPoliticalEnsureDerivedGeometryTables)
-- Computed outer-boundary hulls of territory aggregates. show_inner_boundaries,
-- inner_boundary_geojson, fill_remainder_geojson and contested_pieces_geojson are
-- ALTER-added at runtime by the same function and folded in below.
CREATE TABLE IF NOT EXISTS political_territory_derived_geometry (
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
    show_inner_boundaries TINYINT(1) NOT NULL DEFAULT 1,   -- ALTER-added
    inner_boundary_geojson JSON NULL,                      -- ALTER-added
    fill_remainder_geojson JSON NULL,                      -- ALTER-added (contested split)
    contested_pieces_geojson JSON NULL,                    -- ALTER-added (contested split)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- DOMAIN: WIKISYNC (importer staging from "Wiki Aventurica")
-- Several table names come from PHP constants; resolved literals shown.
-- =============================================================================

-- source: api/_internal/wiki/sync.php  (avesmapsWikiSyncEnsureCoreTables)
CREATE TABLE IF NOT EXISTS wiki_sync_runs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id CHAR(36) NOT NULL,
    sync_type VARCHAR(40) NOT NULL DEFAULT 'location',
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    phase VARCHAR(60) NOT NULL DEFAULT 'settlement_titles',
    progress_current INT NOT NULL DEFAULT 0,
    progress_total INT NOT NULL DEFAULT 4,
    message VARCHAR(255) NULL,
    stats_json JSON NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    completed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_wiki_sync_runs_public_id (public_id),
    KEY idx_wiki_sync_runs_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/_internal/wiki/sync.php  (avesmapsWikiSyncEnsureCoreTables)
CREATE TABLE IF NOT EXISTS wiki_sync_pages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    wiki_page_id BIGINT NULL,
    title VARCHAR(255) NOT NULL,
    normalized_key VARCHAR(255) NOT NULL,
    wiki_url VARCHAR(500) NOT NULL,
    settlement_class VARCHAR(60) NULL,
    settlement_label VARCHAR(120) NULL,
    categories_json JSON NULL,
    coordinates_json JSON NULL,
    content_hash CHAR(64) NULL,
    fetched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_wiki_sync_pages_title (title),
    KEY idx_wiki_sync_pages_normalized_key (normalized_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/_internal/wiki/locations.php  (avesmapsWikiSyncEnsureLocationTables)
CREATE TABLE IF NOT EXISTS wiki_sync_cases (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    case_key CHAR(64) NOT NULL,
    sync_type VARCHAR(40) NOT NULL DEFAULT 'location',
    case_type VARCHAR(60) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    map_feature_id BIGINT UNSIGNED NULL,
    map_public_id CHAR(36) NULL,
    wiki_title VARCHAR(255) NULL,
    payload_json JSON NOT NULL,
    signature_hash CHAR(64) NOT NULL,
    first_seen_run_id BIGINT UNSIGNED NOT NULL,
    last_seen_run_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    reviewed_at DATETIME(3) NULL,
    reviewed_by BIGINT UNSIGNED NULL,
    resolution_json JSON NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_wiki_sync_cases_case_key (case_key),
    KEY idx_wiki_sync_cases_run_status (last_seen_run_id, status),
    KEY idx_wiki_sync_cases_type_status (case_type, status),
    KEY idx_wiki_sync_cases_map_public_id (map_public_id),
    KEY idx_wiki_sync_cases_wiki_title (wiki_title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- WikiSync-Monitor sandbox (Herrschaftsgebiete crawler rework) -------------
-- source: api/_internal/wiki/sync-monitor.php  (avesmapsWikiSyncMonitorEnsureTables)
-- Table names resolved from constants:
--   AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE          = 'political_territory_wiki_test'
--   AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE            = 'wiki_crawl_queue'
--   AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE            = 'wiki_territory_model'
--   AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE            = 'wiki_redirect_alias'
--   AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE            = 'wiki_sync_editor_state'
--   AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE  = 'political_territory_identity_backup'

-- source: api/_internal/wiki/sync-monitor.php
-- Created at runtime as `CREATE TABLE political_territory_wiki_test LIKE
-- political_territory_wiki` (a STRUCTURAL COPY of political_territory_wiki, incl.
-- the ALTER-added license columns). It is the crawler's write sandbox; promotion
-- into political_territory_wiki is a separate step. Mirrored here as an explicit
-- CREATE for documentation/bootstrap (kept in sync with political_territory_wiki).
CREATE TABLE IF NOT EXISTS political_territory_wiki_test LIKE political_territory_wiki;

-- source: api/_internal/wiki/sync-monitor.php
-- Resumable BFS frontier + visited set for the territory crawler.
CREATE TABLE IF NOT EXISTS wiki_crawl_queue (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    run_id CHAR(36) NOT NULL,
    dedup_key VARCHAR(255) NOT NULL,
    wiki_title VARCHAR(255) NOT NULL,
    wiki_key VARCHAR(255) NULL,
    depth INT NOT NULL DEFAULT 0,
    role VARCHAR(40) NOT NULL DEFAULT 'page',
    source VARCHAR(255) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    error_text VARCHAR(500) NULL,
    claimed_at DATETIME(3) NULL,
    processed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_wiki_crawl_queue_run_dedup (run_id, dedup_key),
    KEY idx_wiki_crawl_queue_run_status (run_id, status),
    KEY idx_wiki_crawl_queue_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/_internal/wiki/sync-monitor.php
-- Sandbox hierarchy model. parent_wiki_key = truth (editor-correctable, survives
-- re-crawl). The `excluded` flag is ALTER-added at runtime and folded in here.
CREATE TABLE IF NOT EXISTS wiki_territory_model (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    wiki_key VARCHAR(255) NOT NULL,
    parent_wiki_key VARCHAR(255) NULL,
    parent_locked TINYINT(1) NOT NULL DEFAULT 0,
    excluded TINYINT(1) NOT NULL DEFAULT 0,        -- ALTER-added (editor "set aside")
    auto_parent_wiki_key VARCHAR(255) NULL,
    parent_conflict_json JSON NULL,
    source_origin VARCHAR(40) NULL,
    metadata_overrides_json JSON NULL,
    metadata_locked_json JSON NULL,
    notes VARCHAR(1000) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_wiki_territory_model_key (wiki_key),
    KEY idx_wiki_territory_model_parent (parent_wiki_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/_internal/wiki/sync-monitor.php
-- Redirect-alias map: alias slug -> canonical wiki_key (resolves parent refs).
CREATE TABLE IF NOT EXISTS wiki_redirect_alias (
    alias_slug VARCHAR(255) NOT NULL,
    canonical_wiki_key VARCHAR(255) NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (alias_slug),
    KEY idx_wiki_redirect_alias_canonical (canonical_wiki_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/_internal/wiki/sync-monitor.php
-- Single-row editor status (id always = 1): freshness of crawl/diff/test/apply.
CREATE TABLE IF NOT EXISTS wiki_sync_editor_state (
    id TINYINT UNSIGNED NOT NULL,
    last_rebuild_at DATETIME(3) NULL,
    last_diff_at DATETIME(3) NULL,
    diff_new INT NULL,
    diff_changed INT NULL,
    diff_deleted INT NULL,
    last_test_at DATETIME(3) NULL,
    last_apply_at DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO wiki_sync_editor_state (id) VALUES (1);

-- source: api/_internal/wiki/sync-monitor.php
-- Pre-apply snapshot of live identity values, for revert_identity (batch_id = one
-- apply run). The coat-of-arms columns + `kind` are ALTER-added at runtime for
-- pre-existing tables; folded into the CREATE body here.
CREATE TABLE IF NOT EXISTS political_territory_identity_backup (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    batch_id VARCHAR(32) NOT NULL,
    territory_id INT NOT NULL,
    wiki_key VARCHAR(255) NULL,
    old_name VARCHAR(255) NULL,
    old_type VARCHAR(255) NULL,
    old_status VARCHAR(255) NULL,
    old_valid_from_bf INT NULL,
    old_valid_to_bf INT NULL,
    new_name VARCHAR(255) NULL,
    new_type VARCHAR(255) NULL,
    new_status VARCHAR(255) NULL,
    new_valid_from_bf INT NULL,
    new_valid_to_bf INT NULL,
    old_coat_of_arms_url TEXT NULL,
    new_coat_of_arms_url TEXT NULL,
    kind VARCHAR(16) NOT NULL DEFAULT 'identity',
    reverted_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_batch (batch_id),
    KEY idx_territory (territory_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- WikiSync for PATHS (Wege: Flüsse / Straßen / Pässe / Karawanenrouten) -----
-- source: api/_internal/wiki/paths.php  (avesmapsWikiPathEnsureTables)
--   AVESMAPS_WIKI_PATH_STAGING_TABLE = 'wiki_path_staging'
--   AVESMAPS_WIKI_PATH_QUEUE_TABLE   = 'wiki_path_queue'
CREATE TABLE IF NOT EXISTS wiki_path_staging (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    wiki_key VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    match_key VARCHAR(255) NOT NULL DEFAULT '',
    kind VARCHAR(20) NOT NULL DEFAULT '',
    art VARCHAR(120) NULL,
    continent VARCHAR(120) NULL,
    lage VARCHAR(500) NULL,
    laenge VARCHAR(120) NULL,
    verlauf VARCHAR(1000) NULL,
    description TEXT NULL,
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
    UNIQUE KEY uq_wiki_path_staging_key (wiki_key),
    KEY idx_wiki_path_staging_match (match_key),
    KEY idx_wiki_path_staging_kind (kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/_internal/wiki/paths.php  (avesmapsWikiPathEnsureTables)
CREATE TABLE IF NOT EXISTS wiki_path_queue (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    run_id CHAR(36) NOT NULL,
    dedup_key VARCHAR(255) NOT NULL,
    wiki_title VARCHAR(255) NOT NULL,
    wiki_key VARCHAR(255) NULL,
    depth INT NOT NULL DEFAULT 0,
    role VARCHAR(40) NOT NULL DEFAULT 'page',
    source VARCHAR(255) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    error_text VARCHAR(500) NULL,
    claimed_at DATETIME(3) NULL,
    processed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_wiki_path_queue_run_dedup (run_id, dedup_key),
    KEY idx_wiki_path_queue_run_status (run_id, status),
    KEY idx_wiki_path_queue_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --- WikiSync for REGIONS (natural landscapes; flat list, no hierarchy) --------
-- source: api/_internal/wiki/regions.php  (avesmapsWikiRegionEnsureTables)
--   AVESMAPS_WIKI_REGION_STAGING_TABLE = 'wiki_region_staging'
--   AVESMAPS_WIKI_REGION_QUEUE_TABLE   = 'wiki_region_queue'
CREATE TABLE IF NOT EXISTS wiki_region_staging (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    wiki_key VARCHAR(255) NOT NULL,
    page_id BIGINT NULL,
    title VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    match_key VARCHAR(255) NOT NULL DEFAULT '',
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: api/_internal/wiki/regions.php  (avesmapsWikiRegionEnsureTables)
CREATE TABLE IF NOT EXISTS wiki_region_queue (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    run_id CHAR(36) NOT NULL,
    dedup_key VARCHAR(255) NOT NULL,
    wiki_title VARCHAR(255) NOT NULL,
    wiki_key VARCHAR(255) NULL,
    depth INT NOT NULL DEFAULT 0,
    role VARCHAR(40) NOT NULL DEFAULT 'page',
    source VARCHAR(255) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    error_text VARCHAR(500) NULL,
    claimed_at DATETIME(3) NULL,
    processed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_wiki_region_queue_run_dedup (run_id, dedup_key),
    KEY idx_wiki_region_queue_run_status (run_id, status),
    KEY idx_wiki_region_queue_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- DEAD / UNUSED (candidate for removal — verify in the LIVE DB first)
-- =============================================================================
--
-- The two tables below are defined ONLY in sql/schema.future.mysql.sql. They
-- have NO inline self-healing DDL in PHP and ZERO code references anywhere in the
-- repository (no SELECT/INSERT/UPDATE/JOIN). AGENTS.md §10 lists them as dead
-- schema. They are reproduced here for completeness, fenced off, because dropping
-- a table is irreversible — confirm they are empty/absent on the live STRATO DB
-- before considering removal. DO NOT auto-run these against a populated database.

-- source: sql/schema.future.mysql.sql  (DEAD: no references)
CREATE TABLE IF NOT EXISTS map_feature_relations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    from_feature_id BIGINT UNSIGNED NOT NULL,
    relation_type VARCHAR(60) NOT NULL,
    to_feature_id BIGINT UNSIGNED NOT NULL,
    properties_json JSON NULL,
    PRIMARY KEY (id),
    KEY idx_map_feature_relations_from (from_feature_id, relation_type),
    KEY idx_map_feature_relations_to (to_feature_id, relation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- source: sql/schema.future.mysql.sql  (DEAD: no references)
CREATE TABLE IF NOT EXISTS map_proposals (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    proposal_type VARCHAR(40) NOT NULL,
    target_feature_id BIGINT UNSIGNED NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'neu',
    title VARCHAR(160) NOT NULL,
    payload_json JSON NOT NULL,
    review_note TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    reviewed_at DATETIME(3) NULL,
    reviewed_by BIGINT UNSIGNED NULL,
    request_origin VARCHAR(255) NULL,
    remote_ip VARCHAR(64) NULL,
    user_agent VARCHAR(500) NULL,
    PRIMARY KEY (id),
    KEY idx_map_proposals_status_created_at (status, created_at),
    KEY idx_map_proposals_target_feature (target_feature_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- END OF BASELINE
-- =============================================================================
