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
    user_agent VARCHAR(500) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    reviewed_at DATETIME(3) NULL,
    reviewed_by BIGINT UNSIGNED NULL,
    PRIMARY KEY (id),
    KEY idx_map_reports_status_created_at (status, created_at),
    KEY idx_map_reports_type_status (report_type, report_subtype, status)
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
