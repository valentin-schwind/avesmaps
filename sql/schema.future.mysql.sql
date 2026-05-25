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

CREATE TABLE IF NOT EXISTS map_revision (
    id TINYINT UNSIGNED NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO map_revision (id, revision)
VALUES (1, 1)
ON DUPLICATE KEY UPDATE revision = revision;

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

CREATE TABLE IF NOT EXISTS map_feature_locks (
    public_id CHAR(36) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    username VARCHAR(120) NOT NULL,
    locked_until DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (public_id),
    KEY idx_map_feature_locks_locked_until (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    raw_json JSON NULL,
    synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_political_territory_wiki_key (wiki_key),
    KEY idx_political_territory_wiki_continent (continent),
    KEY idx_political_territory_wiki_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS political_territory_geometry (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
