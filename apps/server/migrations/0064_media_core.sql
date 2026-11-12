-- Der Media Core (WI-0063 Abschnitt 26, Vertrag `project-control/migration/contracts/media.yaml`, Plan MEDIA-M4).
--
-- 🔴 Ein Fachobjekt kennt ein Medium und seine Rolle. Der Media Core kennt Datei, Rechte, Herkunft, Verarbeitung und
-- Veröffentlichung. Fünf Dinge fallen NIE in ein Feld zusammen: das Werk (`media_asset`), die Datei (`media_file`),
-- die Herkunft (`media_asset.origin`), das Recht (`media_rights`) und die Verwendung (`*_media`, `media_gallery_item`).
-- `ai_generated`, `own_work`, `permission`, `fan_policy` und „vom Wiki geholt“ sind KEINE Lizenzen.
--
-- 🔴 Grenze zu WI-0068 (Betreiber 2026-10-04): Diese Migration legt Schema und Katalog an. Geschrieben wird es vorerst
-- nur vom Import und von Seed-Skripten mit wörtlichem Betreiberzitat; kein Endpunkt ändert Medien, Bindungen, Rechte,
-- Reihenfolgen oder Freigaben. WI-0068 baut ADDITIV darauf auf (Ingest-Provenienz, Titel und Cover der Galerie,
-- weitere Galeriearten, Einreichungen).
--
-- Betreibergate G1 (Betreiber 2026-10-04): Option A, eine Freigaberegel je Rechtsbasis und Rolle als Datenzeile mit
-- Zitat, Datum und Widerruf (`publication_rule`). Diese Migration legt NUR die Tabelle an, keine Regelzeile: die Regeln
-- mit wörtlichem Betreiberzitat entstehen später mit den Importern (Literatur, Kartensammlung, Ortsbilder).
--
-- Bewusst NICHT hier: `citymap_media` und `adventure_media` (erst mit ihren Zieltabellen), keine generische
-- `entity_type`-Relation, keine `gallery`-Rolle in direkten Bindungen, keine `*_render`-Sicht.

-- ABLAGE: Lizenzkatalog ----------------------------------------------------------------------------------------------

-- EIN Katalog für Medien UND Quellen (WI-0063 26.17). Rechtsbasen sind keine Einträge: `permission`, `fan_policy` und
-- `own_work` stehen nur in `media_rights.rights_basis`. Eine Lizenz ohne belegte Version (Legacys `cc_by`) bekommt
-- KEINEN geratenen Schlüssel.
CREATE TABLE IF NOT EXISTS license_catalog (
    key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    canonical_uri TEXT NOT NULL,
    requires_attribution BOOLEAN NOT NULL,
    share_alike BOOLEAN NOT NULL,
    non_commercial BOOLEAN NOT NULL,
    -- Die Gruppe ohne Version (`cc-by`): gemeinsame Sprache mit Medien, deren Version unbekannt ist.
    family TEXT NOT NULL,
    CONSTRAINT license_catalog_key_format CHECK (key ~ '^[a-z0-9][a-z0-9.-]*$'),
    CONSTRAINT license_catalog_family_format CHECK (family ~ '^[a-z0-9][a-z0-9-]*$'),
    CONSTRAINT license_catalog_name_not_blank CHECK (btrim(display_name) <> ''),
    CONSTRAINT license_catalog_uri_https CHECK (canonical_uri ~ '^https://')
);

COMMENT ON TABLE license_catalog IS
    'Kanonischer Lizenzkatalog für Medien und Quellen (WI-0063 26.6, 26.17). Nur echte Lizenzen, keine Rechtsbasen.';

INSERT INTO license_catalog (key, display_name, canonical_uri, requires_attribution, share_alike, non_commercial, family)
VALUES
    ('cc0-1.0', 'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/', FALSE, FALSE, FALSE, 'cc0'),
    ('public-domain', 'Public Domain', 'https://creativecommons.org/publicdomain/mark/1.0/', FALSE, FALSE, FALSE, 'public-domain'),
    ('cc-by-4.0', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', TRUE, FALSE, FALSE, 'cc-by'),
    ('cc-by-sa-4.0', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/', TRUE, TRUE, FALSE, 'cc-by-sa'),
    ('cc-by-sa-3.0', 'CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/', TRUE, TRUE, FALSE, 'cc-by-sa'),
    ('cc-by-nc-sa-3.0', 'CC BY-NC-SA 3.0', 'https://creativecommons.org/licenses/by-nc-sa/3.0/', TRUE, TRUE, TRUE, 'cc-by-nc-sa')
ON CONFLICT (key) DO NOTHING;

-- Der Pfadwächter der Schlüssel: relativ zur Medienwurzel, nie absolut, nie ein Laufwerk, nie ein Rückwärtsstrich, nie
-- ein `..`-Segment. Die Datenbank speichert nie einen Benutzer-, Orts- oder Dateinamen als Pfad.
CREATE OR REPLACE FUNCTION media_storage_key_is_relative(storage_key text) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
        SELECT storage_key IS NOT NULL
           AND btrim(storage_key) <> ''
           AND storage_key !~ '^/'
           AND storage_key !~ '^[A-Za-z]:'
           AND position(chr(92) IN storage_key) = 0
           AND storage_key !~ '(^|/)\.\.(/|$)'
    $$;

COMMENT ON FUNCTION media_storage_key_is_relative(text) IS
    'Ein Speicherschlüssel ist relativ: kein führendes /, kein Laufwerk X:, kein Rückwärtsstrich, kein ..-Segment.';

-- WERK: das Asset ----------------------------------------------------------------------------------------------------

-- Das Werk, nicht der Dateipfad. `id` und `public_id` sind NIE die SHA-256: gleiche Bytes sind nicht dasselbe Werk.
CREATE TABLE IF NOT EXISTS media_asset (
    id BIGSERIAL PRIMARY KEY,
    -- Stabile öffentliche Identität; entsteht in Avesmaps3D, nie in Legacy, und ändert sich bei keinem Reimport.
    public_id UUID NOT NULL DEFAULT gen_random_uuid(),
    media_kind TEXT NOT NULL,
    -- Woher das Asset zu Avesmaps kam (Provenienz, kein Recht).
    origin TEXT NOT NULL,
    -- Wie es entstand (Entstehungsart, keine Lizenz). Prompt und Werkzeug stehen in `media_creation`.
    creation_method TEXT NOT NULL DEFAULT 'unknown',
    -- `pending`: der Metadatenimport (MEDIA-M8) legt Assets an, bevor Bytes da sind.
    technical_state TEXT NOT NULL DEFAULT 'pending',
    -- Legacys Ortsbilder sind bereits zerstörte 800 x 450 Ausschnitte: das Original existiert nicht, Quelle und Master
    -- sind dieselbe Datei.
    degraded_original BOOLEAN NOT NULL DEFAULT FALSE,
    -- Normalisierung ist keine Moderation. `not_applicable` gilt für den Import; die Community-Zustände kommen später.
    moderation_state TEXT NOT NULL DEFAULT 'not_applicable',
    -- Die Quellidentität trägt die Idempotenz des Imports: derselbe Schlüssel im zweiten Lauf ergibt nichts Neues.
    source_system TEXT NOT NULL,
    source_ref TEXT,
    -- INTERN: Legacys `uploaded_by` (Login oder Klarname), nie ein Benutzerverweis und nie in einer öffentlichen Antwort.
    ingest_actor_legacy TEXT,
    -- Legacys Hochladestempel, einmal übernommen und bei Rechte- oder Kommentaränderung nie neu geschrieben.
    legacy_uploaded_at TIMESTAMPTZ,
    -- Was Legacys Stempel bedeutet. Ortsbilder: die LETZTE Einstufung, nicht der Upload.
    stamp_semantics TEXT,
    migration_run_id UUID REFERENCES migration_run (id),
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT media_asset_public_id_unique UNIQUE (public_id),
    -- NULL-Werte zählen als verschieden: ein Asset ohne Quellschlüssel (später ein Upload) kollidiert nie.
    CONSTRAINT media_asset_source_unique UNIQUE (source_system, source_ref),
    CONSTRAINT media_asset_kind_known CHECK (media_kind IN ('image', 'model_3d')),
    CONSTRAINT media_asset_origin_known CHECK (
        origin IN (
            'legacy_import', 'editor_upload', 'community_upload', 'wiki_import', 'wiki_localized',
            'project_generated', 'external_import'
        )
    ),
    CONSTRAINT media_asset_creation_method_known CHECK (
        creation_method IN ('unknown', 'photo', 'drawing', 'ai_generated', 'scan', 'derived')
    ),
    CONSTRAINT media_asset_technical_state_known CHECK (
        technical_state IN ('pending', 'ok', 'missing_file', 'decode_failed', 'unsupported_format')
    ),
    CONSTRAINT media_asset_moderation_state_known CHECK (
        moderation_state IN ('not_applicable', 'pending', 'approved', 'rejected')
    ),
    CONSTRAINT media_asset_stamp_semantics_known CHECK (
        stamp_semantics IS NULL OR stamp_semantics IN ('upload', 'last_classification')
    ),
    CONSTRAINT media_asset_source_system_not_blank CHECK (btrim(source_system) <> ''),
    CONSTRAINT media_asset_source_ref_not_blank CHECK (source_ref IS NULL OR btrim(source_ref) <> '')
);

CREATE INDEX IF NOT EXISTS media_asset_migration_run ON media_asset (migration_run_id) WHERE migration_run_id IS NOT NULL;

COMMENT ON TABLE media_asset IS
    'Das Werk, nicht der Dateipfad (WI-0063 26.6, media.yaml). Asset-ID und SHA-256 sind nicht dieselbe Identität.';
COMMENT ON COLUMN media_asset.public_id IS
    'Stabile öffentliche Identität des Werks. Entsteht in Avesmaps3D, nie in Legacy; der Reimport ändert sie nie.';
COMMENT ON COLUMN media_asset.technical_state IS
    '`pending`: Metadaten da, Bytes noch nicht. Nur `ok` darf öffentlich erscheinen (media/policy.ts).';
COMMENT ON COLUMN media_asset.degraded_original IS
    'Legacys Ortsbilder sind bereits ein zerstörter 800x450-Ausschnitt: kein echtes Original, Quelle und Master sind dieselbe Datei.';
COMMENT ON COLUMN media_asset.ingest_actor_legacy IS
    'INTERN, nie öffentlich: Legacys uploaded_by als reiner Text. Kein Benutzerverweis; ein Mapping auf Konten nur, wenn beweisbar.';
COMMENT ON COLUMN media_asset.legacy_uploaded_at IS
    'Legacys Hochladestempel, einmal übernommen und nie neu geschrieben (WI-0063 26.14). Bei Ortsbildern die letzte Einstufung (stamp_semantics).';

-- DATEI: die Repräsentation ------------------------------------------------------------------------------------------

-- Konkrete Bytes einer Variante. `source` und `master` sind nie öffentlich; öffentlich ist nur die Klasse `published`.
CREATE TABLE IF NOT EXISTS media_file (
    id BIGSERIAL PRIMARY KEY,
    media_asset_id BIGINT NOT NULL REFERENCES media_asset (id),
    -- `source`, `master` oder der Rezeptname einer Ableitung (`coat`, `header_16_9` …). Nie ein Nutzerdateiname.
    -- Der Name ist je Asset über ALLE Klassen eindeutig (zusammen mit der Rezeptversion): eine Ableitung und ihre
    -- veröffentlichte Fassung tragen verschiedene Namen.
    variant TEXT NOT NULL,
    storage_class TEXT NOT NULL,
    -- RELATIV zur Medienwurzel (MEDIA_ROOT), aus Klasse und SHA-256 abgeleitet (media/storage.ts).
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    byte_size BIGINT NOT NULL,
    -- Dateiidentität, nie Assetidentität: zwei Assets dürfen dieselben Bytes tragen (eine physische Datei).
    sha256 TEXT NOT NULL,
    derivative_recipe TEXT,
    -- Rezept- und Kodiererversion: ohne sie ist eine Ableitung nicht reproduzierbar (Plan 17, Regel 36).
    recipe_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULLS NOT DISTINCT: je Asset genau EIN `source` und EIN `master` (beide ohne Rezeptversion).
    CONSTRAINT media_file_variant_unique UNIQUE NULLS NOT DISTINCT (media_asset_id, variant, recipe_version),
    CONSTRAINT media_file_variant_format CHECK (variant ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT media_file_class_known CHECK (storage_class IN ('private_source', 'master', 'derivative', 'published')),
    CONSTRAINT media_file_storage_key_relative CHECK (media_storage_key_is_relative(storage_key)),
    -- Klasse und Verzeichnis gehören zusammen: ein privater Schlüssel liegt nie unter published/, und die öffentliche
    -- Adresse ist eine reine Funktion des Hashes (kein ?v=mtime, neue Bytes ergeben eine neue Adresse).
    CONSTRAINT media_file_storage_key_class CHECK (
        CASE storage_class
            WHEN 'published' THEN
                storage_key = 'published/sha256/' || substr(sha256, 1, 2) || '/' || substr(sha256, 3, 2) || '/' || sha256 || '.webp'
            WHEN 'private_source' THEN storage_key LIKE 'private/source/%'
            WHEN 'master' THEN storage_key LIKE 'master/%'
            WHEN 'derivative' THEN storage_key LIKE 'derivatives/%'
            ELSE FALSE
        END
    ),
    -- Öffentlich ist bei Rastermedien eine WebP-Datei mit bekannten Maßen, nie ein SVG.
    CONSTRAINT media_file_published_webp CHECK (
        storage_class <> 'published' OR (mime_type = 'image/webp' AND width IS NOT NULL AND height IS NOT NULL)
    ),
    CONSTRAINT media_file_recipe_when_derived CHECK (
        storage_class NOT IN ('derivative', 'published') OR (derivative_recipe IS NOT NULL AND recipe_version IS NOT NULL)
    ),
    CONSTRAINT media_file_mime_format CHECK (mime_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'),
    -- Beide Maße oder keines; ein halbes Paar ergäbe NULL und ginge durch.
    CONSTRAINT media_file_dimensions CHECK (
        (width IS NULL) = (height IS NULL) AND (width IS NULL OR (width > 0 AND height > 0))
    ),
    CONSTRAINT media_file_byte_size_positive CHECK (byte_size > 0),
    CONSTRAINT media_file_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT media_file_recipe_not_blank CHECK (
        (derivative_recipe IS NULL OR btrim(derivative_recipe) <> '') AND (recipe_version IS NULL OR btrim(recipe_version) <> '')
    )
);

-- Je Variante höchstens EINE veröffentlichte Repräsentation: die Rolle wählt ihre Variante (media/roles.ts), und eine
-- zweite Rezeptversion ersetzt die erste, statt neben ihr zu stehen.
CREATE UNIQUE INDEX IF NOT EXISTS media_file_one_published_per_variant
    ON media_file (media_asset_id, variant)
    WHERE storage_class = 'published';
-- Gleiche Bytes sind kein Schlüssel für das Werk (keine Eindeutigkeit), aber nachschlagbar (Befund, physische Dedup).
CREATE INDEX IF NOT EXISTS media_file_sha256 ON media_file (sha256);

COMMENT ON TABLE media_file IS
    'Konkrete Bytes einer Variante eines Assets (WI-0063 26.6). SHA-256 ist Dateiidentität, nie Assetidentität.';
COMMENT ON COLUMN media_file.storage_key IS
    'Relativ zur Medienwurzel. Bei den Klassen private_source, master und derivative INTERN: nie in einer öffentlichen Antwort und nie unter einer URL. Nur `published` hat eine Adresse (/media/sha256/..).';
COMMENT ON COLUMN media_file.recipe_version IS
    'Version von Rezept und Kodierer; NULL nur bei source und master. Der Wert macht eine Ableitung reproduzierbar.';

-- RECHTE, ENTSTEHUNG, BELEGE -----------------------------------------------------------------------------------------

-- 1:1 zum Asset. Rechtsbasis, Lizenz und Clearance sind getrennte Aussagen: `claimed_rights != cleared_rights`,
-- `rights_cleared != öffentlich in jeder Rolle`.
CREATE TABLE IF NOT EXISTS media_rights (
    media_asset_id BIGINT PRIMARY KEY REFERENCES media_asset (id),
    rights_basis TEXT NOT NULL,
    -- Nur bei `rights_basis = 'license'`. `cc_by` ohne Version bleibt ohne Schlüssel (nur `license_family`).
    license_key TEXT REFERENCES license_catalog (key),
    license_family TEXT,
    -- Legacys Rechtecode (`cc_by`, `permission_granted` …) als Evidenz der Migration.
    legacy_rights_code TEXT,
    creator TEXT,
    rights_holder TEXT,
    -- Öffentlich nur, wenn die konkrete Verwendung sie verlangt (credit in MediaPublicView).
    attribution TEXT,
    rights_note TEXT,
    clearance_state TEXT NOT NULL DEFAULT 'unreviewed',
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT media_rights_basis_known CHECK (
        rights_basis IN ('public_domain', 'license', 'permission', 'fan_policy', 'own_work', 'unknown')
    ),
    CONSTRAINT media_rights_clearance_known CHECK (
        clearance_state IN ('unreviewed', 'legacy_assumed', 'legacy_asserted', 'needs_review', 'cleared', 'rejected')
    ),
    CONSTRAINT media_rights_license_key_needs_license CHECK (license_key IS NULL OR rights_basis = 'license'),
    CONSTRAINT media_rights_license_family_needs_license CHECK (license_family IS NULL OR rights_basis = 'license'),
    -- Eine Lizenz ohne Schlüssel ist eine offene Frage, nie eine geklärte Lizenz.
    CONSTRAINT media_rights_license_needs_key_or_review CHECK (
        rights_basis <> 'license' OR license_key IS NOT NULL OR clearance_state = 'needs_review'
    ),
    CONSTRAINT media_rights_license_family_format CHECK (license_family IS NULL OR license_family ~ '^[a-z0-9][a-z0-9-]*$')
);

CREATE INDEX IF NOT EXISTS media_rights_license_key ON media_rights (license_key) WHERE license_key IS NOT NULL;

COMMENT ON TABLE media_rights IS
    'Rechte eines Assets, 1:1 (WI-0063 26.6): Rechtsbasis, Lizenz, Urheber, Namensnennung und Clearance getrennt. Kein öffentliches Feld außer dem bewusst freigegebenen Credit.';
COMMENT ON COLUMN media_rights.rights_note IS
    'INTERN, nie öffentlich: interne Rechtenotiz (bei Gebieten der Klartext hinter Legacys cc_by-Sammelwert).';
COMMENT ON COLUMN media_rights.clearance_state IS
    '`legacy_asserted` ist eine Behauptung, kein Nachweis; `legacy_assumed` ist eine Vorgabe ohne Einstufung. Nur `cleared` und `legacy_asserted` tragen die automatische Freigabe.';
COMMENT ON COLUMN media_rights.reviewed_by IS
    'INTERN: Rechteprüfer als reiner Text, bis der Auth- und Auditvertrag (M10) ein Konto kennt.';

-- Erzeugungsdaten, 1:1. `creation_method` steht nur am Asset.
CREATE TABLE IF NOT EXISTS media_creation (
    media_asset_id BIGINT PRIMARY KEY REFERENCES media_asset (id),
    tool TEXT,
    model TEXT,
    prompt TEXT,
    negative_prompt TEXT,
    parameters JSONB,
    -- Legacys `note` mischt Kommentar und Prompt und wird NICHT geraten aufgeteilt.
    legacy_note_raw TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT media_creation_parameters_object CHECK (parameters IS NULL OR jsonb_typeof(parameters) = 'object')
);

COMMENT ON TABLE media_creation IS
    'INTERN, verlässt nie einen Editor- oder Admin-Lesepfad (Betreiber 2026-09-29): Erzeugungsdaten eines Assets, 1:1.';
COMMENT ON COLUMN media_creation.prompt IS 'INTERN, nie öffentlich (Betreiber 2026-09-29): Prompt der KI-Erzeugung.';
COMMENT ON COLUMN media_creation.negative_prompt IS 'INTERN, nie öffentlich (Betreiber 2026-09-29): Negativ-Prompt.';
COMMENT ON COLUMN media_creation.legacy_note_raw IS
    'INTERN, nie öffentlich: Legacys unklassifizierte Notiz (Kommentar und Prompt gemischt), unverändert.';

-- Die Freigabe für einen Verwendungsfall als EINE Datenzeile statt Tausender Einzelfreigaben (Gate G1, Option A):
-- „Medien mit dieser Rechtsbasis dürfen in dieser Rolle öffentlich erscheinen.“ Der Lizenzschlüssel allein schaltet nie
-- ein Bild frei; erst die Regel für den Verwendungsfall tut es. Die Zeile entsteht nur durch ein Seed-Skript mit
-- wörtlichem Betreiberzitat; Änderung und Widerruf im Betrieb gehören zu WI-0068, bis dahin Skript.
--
-- 🔴 Eine Regel gilt NIE für `rights_basis = 'unknown'` (die Basis kennt den Wert nicht), nie für ein Asset mit
-- Clearance `rejected`, nie für eine Unterdrückung, ein zurückgezogenes oder gesperrtes Binding (media/policy.ts).
CREATE TABLE IF NOT EXISTS publication_rule (
    id BIGSERIAL PRIMARY KEY,
    -- Wie `media_rights.rights_basis`, aber nie `unknown`.
    rights_basis TEXT NOT NULL,
    -- NULL: die Regel gilt für jede Lizenz dieser Basis; gesetzt: nur für diesen Katalogschlüssel.
    license_key TEXT REFERENCES license_catalog (key),
    -- Die Rollen der Fachobjekte. Die der Kartensammlung und Literatur gelten, sobald ihre Tabellen da sind.
    role TEXT NOT NULL,
    -- Der Verwendungsfall in Worten (etwa „Literaturcover unter den Fan-Regeln“).
    scope_text TEXT,
    -- Das wörtliche Zitat des Betreibers; ohne Zitat keine Regel.
    operator_quote TEXT NOT NULL,
    decided_on DATE NOT NULL,
    -- Widerruf: die Regel wirkt ab dann nicht mehr; die Zeile bleibt als Verlauf stehen.
    revoked_on DATE,
    revoked_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT publication_rule_basis_known CHECK (
        rights_basis IN ('public_domain', 'license', 'permission', 'fan_policy', 'own_work')
    ),
    CONSTRAINT publication_rule_role_known CHECK (
        role IN ('coat', 'header', 'map_full', 'map_preview', 'literature_cover')
    ),
    CONSTRAINT publication_rule_license_key_needs_license CHECK (license_key IS NULL OR rights_basis = 'license'),
    CONSTRAINT publication_rule_quote_not_blank CHECK (btrim(operator_quote) <> ''),
    CONSTRAINT publication_rule_revocation_ordered CHECK (revoked_on IS NULL OR revoked_on >= decided_on),
    CONSTRAINT publication_rule_reason_needs_revocation CHECK (revoked_reason IS NULL OR revoked_on IS NOT NULL)
);

-- Eine nicht widerrufene Regel je (Rechtsbasis, Lizenzschlüssel, Rolle); NULL gilt als gleich (NULLS NOT DISTINCT).
CREATE UNIQUE INDEX IF NOT EXISTS publication_rule_one_active
    ON publication_rule (rights_basis, license_key, role) NULLS NOT DISTINCT
    WHERE revoked_on IS NULL;

COMMENT ON TABLE publication_rule IS
    'Freigaberegel je Rechtsbasis und Rolle (Gate G1, Option A, Betreiber 2026-10-04): eine Zeile mit Zitat, Datum und Widerruf statt Einzelfreigaben. Gilt nie bei unknown oder rejected; ein blocked am Binding schlägt sie.';
COMMENT ON COLUMN publication_rule.operator_quote IS 'INTERN: wörtliches Betreiberzitat, auf dem die Regel beruht.';
COMMENT ON COLUMN publication_rule.revoked_reason IS 'INTERN: Grund des Widerrufs.';

-- Private Genehmigungsbelege. Nie unter einer öffentlichen URL, nie in einer öffentlichen Antwort. Ein Beleg hängt an
-- GENAU EINEM von beiden: an einem Asset (Einzelgenehmigung) oder an einer Freigaberegel (etwa die Fan-Richtlinie, die
-- EINMAL an der Regel hängt statt an 1.100 Assets).
CREATE TABLE IF NOT EXISTS media_rights_evidence (
    id BIGSERIAL PRIMARY KEY,
    media_asset_id BIGINT REFERENCES media_asset (id),
    publication_rule_id BIGINT REFERENCES publication_rule (id),
    evidence_kind TEXT NOT NULL,
    storage_key TEXT,
    external_url TEXT,
    sha256 TEXT,
    issuer TEXT,
    recipient TEXT,
    dated_on DATE,
    description TEXT,
    recorded_by TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT media_rights_evidence_one_subject CHECK ((media_asset_id IS NULL) <> (publication_rule_id IS NULL)),
    CONSTRAINT media_rights_evidence_kind_known CHECK (
        evidence_kind IN ('email', 'pdf', 'document', 'license_page', 'source_page', 'operator_note')
    ),
    CONSTRAINT media_rights_evidence_key_relative CHECK (
        storage_key IS NULL OR (media_storage_key_is_relative(storage_key) AND storage_key LIKE 'private/evidence/%')
    ),
    CONSTRAINT media_rights_evidence_url_http CHECK (external_url IS NULL OR external_url ~ '^https?://'),
    CONSTRAINT media_rights_evidence_sha256_format CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
    -- Eine Datei trägt ihre SHA-256, und eine SHA-256 gehört zu einer Datei.
    CONSTRAINT media_rights_evidence_file_has_hash CHECK ((storage_key IS NULL) = (sha256 IS NULL)),
    -- Datei ODER Adresse, nie beides; nur eine Betreibernotiz darf beides entbehren (ihr Text steht in description).
    CONSTRAINT media_rights_evidence_one_source CHECK (
        NOT (storage_key IS NOT NULL AND external_url IS NOT NULL)
        AND (evidence_kind = 'operator_note' OR storage_key IS NOT NULL OR external_url IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS media_rights_evidence_asset ON media_rights_evidence (media_asset_id) WHERE media_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_rights_evidence_rule
    ON media_rights_evidence (publication_rule_id)
    WHERE publication_rule_id IS NOT NULL;

COMMENT ON TABLE media_rights_evidence IS
    'INTERN, nie öffentlich (Betreiber 2026-09-29): private Genehmigungsbelege (Mail, PDF, Seite, Notiz). Kein Endpunkt liest sie, bis WI-0068 einen angemeldeten Editor-Lesepfad baut.';
COMMENT ON COLUMN media_rights_evidence.storage_key IS 'INTERN: privater Schlüssel unter private/evidence/, nie unter einer URL.';
COMMENT ON COLUMN media_rights_evidence.external_url IS 'INTERN: Adresse des Belegs (Lizenz- oder Quellseite), nie in einer öffentlichen Antwort.';
COMMENT ON COLUMN media_rights_evidence.sha256 IS 'INTERN: SHA-256 der Belegdatei.';
COMMENT ON COLUMN media_rights_evidence.issuer IS 'INTERN: Aussteller oder Absender des Belegs.';
COMMENT ON COLUMN media_rights_evidence.recipient IS 'INTERN: Empfänger oder Bezug des Belegs.';
COMMENT ON COLUMN media_rights_evidence.description IS 'INTERN: Beschreibung des Belegs; bei einer Betreibernotiz ihr Text.';
COMMENT ON COLUMN media_rights_evidence.recorded_by IS 'INTERN: wer den Beleg erfasst hat, als reiner Text.';

-- GALERIE: eine geordnete Bildfolge als eigenes Medienobjekt ---------------------------------------------------------

-- In WI-0063 nur Migration und Lesen; Anlegen, Umsortieren, Hinzufügen und Entfernen gehören zu WI-0068.
CREATE TABLE IF NOT EXISTS media_gallery (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid(),
    -- WI-0068 erweitert die Liste (photobox, editorial), sobald ein realer Anwendungsfall sie verlangt.
    gallery_kind TEXT NOT NULL,
    source_system TEXT NOT NULL,
    -- Legacy: `settlement-gallery:<place-public-id>`; trägt die Idempotenz der Galerie.
    source_ref TEXT,
    migration_run_id UUID REFERENCES migration_run (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT media_gallery_public_id_unique UNIQUE (public_id),
    CONSTRAINT media_gallery_source_unique UNIQUE (source_system, source_ref),
    CONSTRAINT media_gallery_kind_known CHECK (gallery_kind IN ('object_gallery')),
    CONSTRAINT media_gallery_source_system_not_blank CHECK (btrim(source_system) <> ''),
    CONSTRAINT media_gallery_source_ref_not_blank CHECK (source_ref IS NULL OR btrim(source_ref) <> '')
);

COMMENT ON TABLE media_gallery IS
    'Geordnete Bildfolge als erstklassiges Medienobjekt (WI-0063 26.7, WI-0068 Abschnitt 9). Die Reihenfolge steht NUR an den Einträgen.';

CREATE TABLE IF NOT EXISTS media_gallery_item (
    id BIGSERIAL PRIMARY KEY,
    gallery_id BIGINT NOT NULL REFERENCES media_gallery (id),
    media_asset_id BIGINT NOT NULL REFERENCES media_asset (id),
    -- Die stabile Reihenfolge der Galerie; sie steht nirgends sonst.
    sort_order INTEGER NOT NULL,
    caption TEXT,
    -- Die bewusste Einzelfreigabe oder -sperre für diese Verwendung. Ein Legacy-`public` ist keine Freigabe.
    publication_override TEXT NOT NULL DEFAULT 'none',
    override_decided_on DATE,
    override_operator_quote TEXT,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT media_gallery_item_asset_unique UNIQUE (gallery_id, media_asset_id),
    -- Zurückgezogene Einträge behalten ihre Stelle: ein Reimport vergibt freie Stellen neu oder rückt sie beiseite.
    -- DEFERRABLE, damit Umsortieren in EINER Transaktion über Zwischenzustände mit doppelter Stelle gehen darf.
    CONSTRAINT media_gallery_item_order_unique UNIQUE (gallery_id, sort_order) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT media_gallery_item_override_known CHECK (publication_override IN ('none', 'approved', 'blocked')),
    CONSTRAINT media_gallery_item_approved_has_decision CHECK (
        publication_override <> 'approved'
        OR (override_decided_on IS NOT NULL AND btrim(coalesce(override_operator_quote, '')) <> '')
    )
);

CREATE INDEX IF NOT EXISTS media_gallery_item_asset ON media_gallery_item (media_asset_id);

COMMENT ON TABLE media_gallery_item IS
    'Ein Bild in einer Galerie: Reihenfolge, Bildunterschrift (nur wenn belegt), Einzelfreigabe. Dasselbe Asset darf in mehreren Galerien stehen.';
COMMENT ON COLUMN media_gallery_item.override_operator_quote IS
    'INTERN: wörtliches Betreiberzitat der Einzelfreigabe. Ein approved ohne Datum und Zitat ist ausgeschlossen.';

-- BINDUNGEN: typisiert, mit echten Fremdschlüsseln -------------------------------------------------------------------

-- Ein Ort kennt ein Wappen (`coat`) und ein einzelnes Titelbild (`header`). Eine geordnete Bildfolge ist KEINE Rolle
-- mit sort_order, sondern eine Galerie (`place_media_gallery`). Keine heutige Einzelrolle braucht eine Reihenfolge.
CREATE TABLE IF NOT EXISTS place_media (
    id BIGSERIAL PRIMARY KEY,
    place_id BIGINT NOT NULL REFERENCES place (id),
    media_asset_id BIGINT NOT NULL REFERENCES media_asset (id),
    role TEXT NOT NULL,
    -- Ein Reimport überschreibt nur Zeilen mit origin `legacy` oder `wiki_localized`; `editor` ist für WI-0068 reserviert.
    origin TEXT NOT NULL,
    publication_override TEXT NOT NULL DEFAULT 'none',
    override_decided_on DATE,
    override_operator_quote TEXT,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT place_media_unique UNIQUE (place_id, media_asset_id, role),
    CONSTRAINT place_media_role_known CHECK (role IN ('coat', 'header')),
    CONSTRAINT place_media_origin_known CHECK (origin IN ('legacy', 'wiki_localized', 'editor')),
    CONSTRAINT place_media_override_known CHECK (publication_override IN ('none', 'approved', 'blocked')),
    CONSTRAINT place_media_approved_has_decision CHECK (
        publication_override <> 'approved'
        OR (override_decided_on IS NOT NULL AND btrim(coalesce(override_operator_quote, '')) <> '')
    )
);

-- Höchstens EINE aktive Bindung je Ort und Rolle; zurückgezogene bleiben als Verlauf stehen.
CREATE UNIQUE INDEX IF NOT EXISTS place_media_one_active_per_role ON place_media (place_id, role) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS place_media_asset ON place_media (media_asset_id);

COMMENT ON TABLE place_media IS
    'Bindung Ort - Asset in einer Einzelrolle (coat, header), WI-0063 26.7. Echte Fremdschlüssel statt entity_type + url.';

CREATE TABLE IF NOT EXISTS territory_media (
    id BIGSERIAL PRIMARY KEY,
    territory_id BIGINT NOT NULL REFERENCES territory (id),
    media_asset_id BIGINT NOT NULL REFERENCES media_asset (id),
    role TEXT NOT NULL,
    origin TEXT NOT NULL,
    publication_override TEXT NOT NULL DEFAULT 'none',
    override_decided_on DATE,
    override_operator_quote TEXT,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT territory_media_unique UNIQUE (territory_id, media_asset_id, role),
    CONSTRAINT territory_media_role_known CHECK (role IN ('coat')),
    CONSTRAINT territory_media_origin_known CHECK (origin IN ('legacy', 'wiki_localized', 'editor')),
    CONSTRAINT territory_media_override_known CHECK (publication_override IN ('none', 'approved', 'blocked')),
    CONSTRAINT territory_media_approved_has_decision CHECK (
        publication_override <> 'approved'
        OR (override_decided_on IS NOT NULL AND btrim(coalesce(override_operator_quote, '')) <> '')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS territory_media_one_active_per_role
    ON territory_media (territory_id, role)
    WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS territory_media_asset ON territory_media (media_asset_id);

COMMENT ON TABLE territory_media IS
    'Bindung Herrschaftsgebiet - Asset in der Rolle coat (WI-0063 26.7). Territoriumswappen erst nach diesem Modell öffentlich (WI-0062 F8).';

-- Die Kopf-Galerie eines Ortes: je Ort höchstens EINE aktive Galerie in der Rolle `header`. Die Galerieeinträge erben
-- diese Rolle.
CREATE TABLE IF NOT EXISTS place_media_gallery (
    id BIGSERIAL PRIMARY KEY,
    place_id BIGINT NOT NULL REFERENCES place (id),
    media_gallery_id BIGINT NOT NULL REFERENCES media_gallery (id),
    role TEXT NOT NULL,
    origin TEXT NOT NULL,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT place_media_gallery_unique UNIQUE (place_id, media_gallery_id, role),
    CONSTRAINT place_media_gallery_role_known CHECK (role IN ('header')),
    CONSTRAINT place_media_gallery_origin_known CHECK (origin IN ('legacy', 'editor'))
);

CREATE UNIQUE INDEX IF NOT EXISTS place_media_gallery_one_active_per_role
    ON place_media_gallery (place_id, role)
    WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS place_media_gallery_gallery ON place_media_gallery (media_gallery_id);

COMMENT ON TABLE place_media_gallery IS
    'Typisierte Bindung Ort - Galerie (WI-0063 26.7, media.yaml bindings.galerien). Je Ort höchstens eine aktive Galerie je Rolle.';

-- UNTERDRÜCKUNG: „ausdrücklich kein Medium in dieser Rolle“ ---------------------------------------------------------
--
-- Drei Zustände: keine Zeile = kein Entscheid · Unterdrückungszeile = ausdrücklich kein Medium (Legacy `coat_none`,
-- leerer Gebiets-Override) · Bindung = Medium gesetzt. Ein leerer Override ist eine Entscheidung, kein fehlender Wert.

CREATE TABLE IF NOT EXISTS place_media_suppression (
    place_id BIGINT NOT NULL REFERENCES place (id),
    role TEXT NOT NULL,
    origin TEXT NOT NULL,
    legacy_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (place_id, role),
    CONSTRAINT place_media_suppression_role_known CHECK (role IN ('coat', 'header')),
    CONSTRAINT place_media_suppression_origin_known CHECK (origin IN ('legacy', 'editor'))
);

CREATE TABLE IF NOT EXISTS territory_media_suppression (
    territory_id BIGINT NOT NULL REFERENCES territory (id),
    role TEXT NOT NULL,
    origin TEXT NOT NULL,
    legacy_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (territory_id, role),
    CONSTRAINT territory_media_suppression_role_known CHECK (role IN ('coat')),
    CONSTRAINT territory_media_suppression_origin_known CHECK (origin IN ('legacy', 'editor'))
);

COMMENT ON TABLE place_media_suppression IS
    'Ausdrücklich kein Medium in dieser Rolle (Legacy coat_none). Schließt sich mit einer aktiven Bindung derselben Rolle aus (Constraint-Trigger).';
COMMENT ON TABLE territory_media_suppression IS
    'Ausdrücklich kein Medium in dieser Rolle (Legacys leerer Override). Schließt sich mit einer aktiven Bindung derselben Rolle aus (Constraint-Trigger).';

-- Unterdrückung und aktive Bindung derselben (Objekt, Rolle) schließen sich aus - im Schema, nicht nur im Importer.
-- Die Prüfung läuft am Ende der Transaktion (DEFERRABLE INITIALLY DEFERRED): ein Reimport darf den Zustand in einer
-- Transaktion in beliebiger Reihenfolge wechseln, nur der Endzustand zählt.
CREATE OR REPLACE FUNCTION place_media_binding_not_suppressed() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    IF NEW.retired_at IS NULL AND EXISTS (
        SELECT 1 FROM place_media_suppression s WHERE s.place_id = NEW.place_id AND s.role = NEW.role
    ) THEN
        RAISE EXCEPTION 'Ort % hat in der Rolle % eine Unterdrückung und darf dort keine aktive Bindung tragen', NEW.place_id, NEW.role
            USING ERRCODE = '23514', CONSTRAINT = TG_NAME;
    END IF;
    RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION place_media_suppression_has_no_binding() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM place_media m WHERE m.place_id = NEW.place_id AND m.role = NEW.role AND m.retired_at IS NULL
    ) OR EXISTS (
        SELECT 1 FROM place_media_gallery g WHERE g.place_id = NEW.place_id AND g.role = NEW.role AND g.retired_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Ort % hat in der Rolle % eine aktive Bindung und darf dort keine Unterdrückung tragen', NEW.place_id, NEW.role
            USING ERRCODE = '23514', CONSTRAINT = TG_NAME;
    END IF;
    RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION territory_media_binding_not_suppressed() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    IF NEW.retired_at IS NULL AND EXISTS (
        SELECT 1 FROM territory_media_suppression s WHERE s.territory_id = NEW.territory_id AND s.role = NEW.role
    ) THEN
        RAISE EXCEPTION 'Gebiet % hat in der Rolle % eine Unterdrückung und darf dort keine aktive Bindung tragen', NEW.territory_id, NEW.role
            USING ERRCODE = '23514', CONSTRAINT = TG_NAME;
    END IF;
    RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION territory_media_suppression_has_no_binding() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER SET search_path = public, pg_temp
    AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM territory_media m WHERE m.territory_id = NEW.territory_id AND m.role = NEW.role AND m.retired_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Gebiet % hat in der Rolle % eine aktive Bindung und darf dort keine Unterdrückung tragen', NEW.territory_id, NEW.role
            USING ERRCODE = '23514', CONSTRAINT = TG_NAME;
    END IF;
    RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS place_media_not_suppressed ON place_media;
CREATE CONSTRAINT TRIGGER place_media_not_suppressed
    AFTER INSERT OR UPDATE ON place_media
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (NEW.retired_at IS NULL)
    EXECUTE FUNCTION place_media_binding_not_suppressed();

DROP TRIGGER IF EXISTS place_media_gallery_not_suppressed ON place_media_gallery;
CREATE CONSTRAINT TRIGGER place_media_gallery_not_suppressed
    AFTER INSERT OR UPDATE ON place_media_gallery
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (NEW.retired_at IS NULL)
    EXECUTE FUNCTION place_media_binding_not_suppressed();

DROP TRIGGER IF EXISTS place_media_suppression_no_binding ON place_media_suppression;
CREATE CONSTRAINT TRIGGER place_media_suppression_no_binding
    AFTER INSERT OR UPDATE ON place_media_suppression
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION place_media_suppression_has_no_binding();

DROP TRIGGER IF EXISTS territory_media_not_suppressed ON territory_media;
CREATE CONSTRAINT TRIGGER territory_media_not_suppressed
    AFTER INSERT OR UPDATE ON territory_media
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (NEW.retired_at IS NULL)
    EXECUTE FUNCTION territory_media_binding_not_suppressed();

DROP TRIGGER IF EXISTS territory_media_suppression_no_binding ON territory_media_suppression;
CREATE CONSTRAINT TRIGGER territory_media_suppression_no_binding
    AFTER INSERT OR UPDATE ON territory_media_suppression
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION territory_media_suppression_has_no_binding();
