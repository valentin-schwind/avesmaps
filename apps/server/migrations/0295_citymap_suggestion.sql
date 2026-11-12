-- 0295: Kartenvorschlag durch Besucher ohne Konto (WI-0275 Stufe B „Karte vorschlagen“, Vorbild: `media_submission`, Migration 0274).
--
-- Die Tafel `citymap_suggestion` hält, was ein Besucher für die Kartensammlung vorschlägt, bis die Redaktion entschieden hat: Titel, Link ODER
-- eigene Datei, freiwillige Angaben zur Karte und den Zustand. Der Vorschlag ist KEINE Karte: Er wird erst mit der Annahme der Redaktion zur Zeile in
-- `citymap` (`accepted_citymap_id`); ein Besucher schreibt nie in `citymap`. Die Datei wird ein Werk der Medienverwaltung (`media_asset`, Herkunft
-- `community_upload`, Quellsystem `kartenvorschlag`, Moderation `pending`, ohne Verwendung) und läuft durch dieselbe Kette wie jede Kartenquelle
-- (Rolle `map_full`, PDF seit Stufe A); bis zur Annahme ist sie nicht öffentlich. Der Besucher hat kein Konto; die Statusseite öffnet ein geheimer
-- Schlüssel, von dem hier nur der SHA-256-Wert steht.
--
-- 🔴 Die Zusagen hält die Datenbank selbst, nicht erst das Formular: Pflicht sind Titel und (Link ODER Datei); ein Link ist eine http(s)-Adresse; eine
-- Datei trägt Art, Lizenzwahl und die Fassung der Bedingungen; ein angenommener Vorschlag hat seine Karte (`citymap_suggestion_approved_has_citymap`).
-- Dreiwertige Angaben (Spoiler, offiziell …) sind NULL, wenn der Einreicher sie nicht kennt, nie „nein“ (wie `citymap`, Migration 0069).
--
-- Erst erweitern (AGENTS.md): Die Tafel ist neu und wird vom vorigen Release nie gelesen; keine andere Tafel ändert sich. Rechte: die Vorgabe-Rechte der
-- App-Rolle in `public` (lesen, anlegen, ändern); `apps/server/test/support/public-rechte.ts` führt sie unter „schreiben“.

CREATE TABLE IF NOT EXISTS citymap_suggestion (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid(),
    -- Die laufende Nummer, die der Einreicher sieht („K-1042“).
    number BIGINT GENERATED ALWAYS AS IDENTITY,
    -- Idempotenz (M10): dieselbe Kennung liefert dieselbe Quittung, nie eine zweite Zeile.
    operation_id UUID NOT NULL,
    state TEXT NOT NULL DEFAULT 'incoming',
    -- Der SHA-256-Wert des geheimen Statusschlüssels (32 Bytes); der Schlüssel selbst steht nirgends.
    status_key_hash BYTEA NOT NULL,
    way TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    -- Freier Text („Herz des Reiches“); sperrt nie und ist keine Zeile des Quellenkatalogs.
    source_text TEXT,
    link_url TEXT,
    file_mime TEXT,
    -- Das Werk der Datei (`media_asset`); die Bytes liegen privat im Medienspeicher.
    media_asset_id BIGINT,
    usage_grant TEXT,
    terms_version TEXT,
    -- Der Ort, für dessen Kartensammlung der Vorschlag gilt (optional).
    place_id BIGINT,
    attribution_name TEXT,
    -- Freiwillige Angaben zur Karte (Werte wie `citymap`, 0069); NULL = unbekannt.
    type_keys TEXT[] NOT NULL DEFAULT '{}',
    author TEXT,
    art TEXT,
    valid_from_bf INTEGER,
    valid_to_bf INTEGER,
    color_mode TEXT,
    is_spoiler BOOLEAN,
    is_labeled BOOLEAN,
    is_multilevel BOOLEAN,
    is_official BOOLEAN,
    is_paid BOOLEAN,
    preview_url TEXT,
    note TEXT,
    -- Entscheidung der Redaktion (die pseudonyme person.id wie in `media_operation`); der Grund ist für den Einreicher lesbar.
    decided_by UUID,
    decision_reason TEXT,
    accepted_citymap_id BIGINT,
    -- Fachrevision (ADR-0020): zählt allein der Trigger `citymap_suggestion_revision`, die Anwendung schreibt sie nie.
    revision BIGINT NOT NULL DEFAULT 1,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    state_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TIMESTAMPTZ,
    CONSTRAINT citymap_suggestion_public_id_unique UNIQUE (public_id),
    CONSTRAINT citymap_suggestion_number_unique UNIQUE (number),
    CONSTRAINT citymap_suggestion_operation_unique UNIQUE (operation_id),
    CONSTRAINT citymap_suggestion_status_key_unique UNIQUE (status_key_hash),
    CONSTRAINT citymap_suggestion_asset_fk FOREIGN KEY (media_asset_id) REFERENCES media_asset (id),
    CONSTRAINT citymap_suggestion_place_fk FOREIGN KEY (place_id) REFERENCES place (id),
    CONSTRAINT citymap_suggestion_citymap_fk FOREIGN KEY (accepted_citymap_id) REFERENCES citymap (id),
    CONSTRAINT citymap_suggestion_state_known CHECK (
        state IN ('incoming', 'technical_failed', 'pending', 'approved', 'rejected', 'withdrawn')
    ),
    CONSTRAINT citymap_suggestion_key_hash_len CHECK (octet_length(status_key_hash) = 32),
    CONSTRAINT citymap_suggestion_way_known CHECK (way IN ('link', 'file')),
    -- 🔴 Link ODER Datei, nie beides, nie keines.
    CONSTRAINT citymap_suggestion_link_xor_file CHECK (
        (way = 'link' AND link_url IS NOT NULL AND file_mime IS NULL AND media_asset_id IS NULL AND usage_grant IS NULL)
        OR (way = 'file' AND link_url IS NULL AND file_mime IS NOT NULL AND usage_grant IS NOT NULL AND terms_version IS NOT NULL)
    ),
    CONSTRAINT citymap_suggestion_link_http CHECK (link_url IS NULL OR link_url ~* '^https?://\S+$'),
    CONSTRAINT citymap_suggestion_preview_http CHECK (preview_url IS NULL OR preview_url ~* '^https?://\S+$'),
    CONSTRAINT citymap_suggestion_file_mime_known CHECK (
        file_mime IS NULL OR file_mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
    ),
    CONSTRAINT citymap_suggestion_usage_grant_known CHECK (usage_grant IS NULL OR usage_grant IN ('avesmaps_only', 'cc-by-4.0')),
    -- Eine Datei, die schon geprüft wird oder wartet, hat ihr Werk; erst `incoming` darf es noch nicht haben.
    CONSTRAINT citymap_suggestion_file_has_asset CHECK (
        way <> 'file' OR state IN ('incoming', 'rejected', 'withdrawn') OR media_asset_id IS NOT NULL
    ),
    CONSTRAINT citymap_suggestion_art_known CHECK (art IS NULL OR art IN ('politisch', 'derographisch', 'topologisch', 'skizze')),
    CONSTRAINT citymap_suggestion_color_mode_known CHECK (color_mode IS NULL OR color_mode IN ('graustufen', 'braun', 'farbig')),
    CONSTRAINT citymap_suggestion_types_known CHECK (
        type_keys <@ ARRAY['ortsplan', 'stadtplan', 'bezirk', 'viertel', 'lageplan', 'uebersicht', 'schauplatz', 'grundriss',
                           'befestigungen', 'dungeon', 'hoehlen', 'krypten', 'katakomben', 'schatzkarte', 'region', 'sonstige']::text[]
    ),
    CONSTRAINT citymap_suggestion_text_not_blank CHECK (
        btrim(title) <> '' AND char_length(title) <= 300
        AND (description IS NULL OR (btrim(description) <> '' AND char_length(description) <= 2000))
        AND (source_text IS NULL OR (btrim(source_text) <> '' AND char_length(source_text) <= 500))
        AND (attribution_name IS NULL OR (btrim(attribution_name) <> '' AND char_length(attribution_name) <= 80))
        AND (author IS NULL OR (btrim(author) <> '' AND char_length(author) <= 300))
        AND (note IS NULL OR (btrim(note) <> '' AND char_length(note) <= 2000))
        AND (decision_reason IS NULL OR (btrim(decision_reason) <> '' AND char_length(decision_reason) <= 500))
    ),
    CONSTRAINT citymap_suggestion_years_range CHECK (
        (valid_from_bf IS NULL OR valid_from_bf BETWEEN -3000 AND 9999) AND (valid_to_bf IS NULL OR valid_to_bf BETWEEN -3000 AND 9999)
    ),
    -- 🔴 Angenommen heißt: es gibt die Karte. Nichts wird öffentlich, ohne dass eine Zeile in `citymap` entstand.
    CONSTRAINT citymap_suggestion_approved_has_citymap CHECK (state <> 'approved' OR accepted_citymap_id IS NOT NULL),
    CONSTRAINT citymap_suggestion_decided_consistent CHECK (
        (state IN ('approved', 'rejected')) = (decided_at IS NOT NULL)
    )
);

-- Der Korb der Redaktion (nach Zustand, älteste zuerst) und die Zuordnung zum Ort.
CREATE INDEX IF NOT EXISTS citymap_suggestion_state_submitted ON citymap_suggestion (state, id);
CREATE INDEX IF NOT EXISTS citymap_suggestion_place ON citymap_suggestion (place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS citymap_suggestion_asset ON citymap_suggestion (media_asset_id) WHERE media_asset_id IS NOT NULL;

-- `revision` zählt der Trigger aus 0079 hoch und setzt dabei `updated_at` (Muster von `media_submission_revision`).
CREATE OR REPLACE TRIGGER citymap_suggestion_revision BEFORE UPDATE ON citymap_suggestion
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON TABLE citymap_suggestion IS
    'Kartenvorschlag eines Besuchers ohne Konto (WI-0275 Stufe B): Titel, Link ODER Datei, freiwillige Angaben und Zustand bis zur Entscheidung der Redaktion. Kein Eintrag der Kartensammlung: erst die Annahme legt die Karte in citymap an (accepted_citymap_id). Die Datei ist ein privates Werk (Rolle map_full) bis dahin.';
COMMENT ON COLUMN citymap_suggestion.number IS 'Die laufende Nummer für den Einreicher („K-<number>“); nie eine Kennung nach außen für die Redaktion (dafür public_id).';
COMMENT ON COLUMN citymap_suggestion.operation_id IS 'Idempotenz (M10): dieselbe Kennung mit demselben Schlüssel liefert dieselbe Quittung.';
COMMENT ON COLUMN citymap_suggestion.status_key_hash IS 'INTERN: SHA-256 des geheimen Statusschlüssels (32 Bytes), nie der Schlüssel selbst.';
COMMENT ON COLUMN citymap_suggestion.state IS 'incoming (Datei fehlt noch oder wird geprüft), technical_failed, pending (wartet auf die Redaktion), approved, rejected, withdrawn.';
COMMENT ON COLUMN citymap_suggestion.source_text IS 'Freier Text der Quelle (Buch, Bote, Website), nie der Zeichner; keine Verknüpfung zum Quellenkatalog, sperrt nie.';
COMMENT ON COLUMN citymap_suggestion.media_asset_id IS 'Das Werk der hochgeladenen Datei (Rolle map_full), privat und ohne Verwendung bis zur Annahme.';
COMMENT ON COLUMN citymap_suggestion.attribution_name IS 'INTERN bis zur Annahme: freiwillige Nennung des Einreichers, 1 bis 80 Zeichen.';
COMMENT ON COLUMN citymap_suggestion.decision_reason IS 'Der Grund der Redaktion bei der Ablehnung (freiwillig); der Einreicher liest ihn auf der Statusseite.';
COMMENT ON COLUMN citymap_suggestion.accepted_citymap_id IS 'Die Karte, die aus der Annahme entstand; Pflicht bei approved.';
COMMENT ON COLUMN citymap_suggestion.revision IS 'Fachrevision für gleichzeitige Änderungen (ADR-0020): zählt allein der Trigger citymap_suggestion_revision.';
