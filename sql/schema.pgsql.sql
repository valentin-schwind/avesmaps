CREATE TABLE IF NOT EXISTS location_reports (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'neu',
    name VARCHAR(80) NOT NULL,
    size VARCHAR(20) NOT NULL,
    lat NUMERIC(7, 3) NOT NULL,
    lng NUMERIC(7, 3) NOT NULL,
    source VARCHAR(200) NOT NULL,
    wiki_url VARCHAR(300) NULL,
    comment TEXT NULL,
    page_url VARCHAR(500) NULL,
    client_version VARCHAR(80) NULL,
    review_note TEXT NULL,
    reviewed_at TIMESTAMPTZ NULL,
    request_origin VARCHAR(255) NULL,
    remote_ip VARCHAR(64) NULL,
    user_agent VARCHAR(500) NULL
);

CREATE INDEX IF NOT EXISTS idx_location_reports_status_created_at
    ON location_reports (status, created_at);

CREATE INDEX IF NOT EXISTS idx_location_reports_name
    ON location_reports (name);
