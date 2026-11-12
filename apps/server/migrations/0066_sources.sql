-- Feature-Quellen: Katalog, Korpus, Verknüpfungen und Kanon (WI-0063 P3, Vertrag
-- `project-control/migration/contracts/sources.yaml`, D1).
--
-- 🔴 Die QUELLE ist geteilt und dedupliziert: ein Eintrag, viele Träger (Legacy: `url_hash` UNIQUE). Die VERKNÜPFUNG
-- gehört dem TRÄGER, nicht der Quelle: Sie ist die Aussage „dieses Objekt belegt sich damit“, mit Art, Seiten und Notiz.
-- Quellen werden NICHT vererbt (WI-0063 5.5): Die Quellen einer Region gehören der Region, nicht ihren Beschriftungen und nicht
-- den Orten darin; Gebiete erben nichts von ihrem Elter; die Quellen eines Wegs bleiben an den Segmenten, an denen Legacy sie
-- führt (die Gruppe liest die Vereinigung). Nichts hier aggregiert.
--
-- 🔴 Echte Fremdschlüssel je Trägerart: `place_source`, `path_source`, `territory_source`, `region_source`,
-- `terrain_peak_source` statt EINER Tabelle mit „genau ein Fremdschlüssel gesetzt“. Gründe: jede Tabelle hat einen
-- einfachen, ungeteilten Fremdschlüssel und ihr UNIQUE (Träger, Quelle) ohne partielle Indizes; der Importer rechnet alle
-- fünf mit demselben Code; die Kanon-Tafeln sind ohnehin je Trägerart; ein Leser liest einen Träger mit einem Join. Keine
-- `entity_type`-Spalte, keine EAV, keine JSON-Ablage, keine zweite Lizenzliste neben `license_catalog` (Migration 0064).
--
-- Lizenz und Namensnennung sind GETRENNTE Angaben (CC verlangt beides getrennt). LEER HEISST NIE „KEINE LIZENZ“: ohne Angabe
-- gilt `unrecorded` („nicht erfasst“). `unfree` ist eine AUSSAGE (keine freie Lizenz) und ein Rechtsgrund `public_domain` ist
-- keine Lizenz: beide ohne Katalogschlüssel (wie `rights_basis` in media.yaml).
--
-- Der KANON (offiziell/inoffiziell) ist in Legacy ABGELEITET und nirgends gespeichert. Hier steht Legacys Ergebnis als
-- Anfangsstand je Träger, bei jedem Zug neu geschrieben und nie von Hand bearbeitet. Die Ableitung wird NICHT nachgebaut; der
-- Nachbau kommt mit dem Quellen-Editor (nach dem Cutover), und die gespeicherten Werte sind dann sein Testorakel.
--
-- Bewusst NICHT hier: `citymap_source` (D2), `lore_entry_source` (D5), Verknüpfungen freier Beschriftungen ohne Zeile, ein
-- Quellen-Editor. Geschrieben wird vorerst nur vom Import (`migrate:sources`).
--
-- E1+ (Betreiber 2026-10-04, freigegeben): Legacy exportiert (sobald gebaut) die von Hand unterdrückten Verknüpfungen als eigenen
-- Block und je Verknüpfung ihre Herkunft. Der Import liest den Block, WENN er da ist: eine unterdrückte Verknüpfung wird
-- `state suppressed` (Tombstone), ihre Herkunft steht in `legacy_origin`. Ein Tombstone wird NIE wieder belebt: weder ein späterer
-- Zug noch ein Wiki-Abgleich hebt ihn auf (Kapitel 9.37). Fehlt der Block, meldet der Import `suppressed_not_exported`.
--
-- Gemeinsame Spalten (Vertrag `zielmodell.gemeinsame_spalten`): source_system, migration_run_id, imported_at, is_active,
-- retired_at, retired_origin (import | editor), created_at, updated_at. Stillgelegt wird, nie gelöscht; ausgenommen sind die
-- Kanon-Tafeln, die abgeleitet sind und mit jedem Zug neu entstehen.
--
-- Längen: Legacys Obergrenzen (Seiten 120, Notiz 200, Namensnennung 200 Zeichen) stehen NICHT als CHECK. Ein längerer
-- Quelltext würde sonst den ganzen Import anhalten (Betreiber 2026-10-03: nur selbst definierte Prüfungen halten an); der
-- Import meldet ihn als Befund `text_exceeds_legacy_limit` und speichert ihn unverändert.

-- KORPUS ------------------------------------------------------------------------------------------------------------

-- Die Domain eines Wiki-Angebots (`garetien.de`, `koschwiki.de` …). Legacy rechnet den Schlüssel aus der Adresse und
-- speichert ihn nie; hier ist er der Schlüssel der Zeile. Lizenz und Namensnennung eines Korpus exportiert Legacy NICHT (sie
-- sind in die Quellzeilen durchgeschrieben): der Import schreibt `unrecorded` und rät nie.
CREATE TABLE IF NOT EXISTS source_corpus (
    corpus_key TEXT PRIMARY KEY,
    -- Name des ANGEBOTS (nicht der Titel einer Seite); leer erlaubt.
    label TEXT NOT NULL DEFAULT '',
    -- `belegstelle` oder leer; leer heißt unentschieden und verhält sich wie `werk`.
    form TEXT NOT NULL DEFAULT '',
    license_statement TEXT NOT NULL DEFAULT 'unrecorded',
    license_key TEXT REFERENCES license_catalog (key),
    attribution TEXT,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT source_corpus_key_not_blank CHECK (btrim(corpus_key) <> ''),
    CONSTRAINT source_corpus_form_known CHECK (form IN ('', 'werk', 'belegstelle')),
    CONSTRAINT source_corpus_license_statement_known CHECK (
        license_statement IN ('unrecorded', 'license', 'public_domain', 'unfree')
    ),
    -- Ein Schlüssel nur bei einer Lizenz, und eine Lizenz hat ihren Schlüssel: Aussage und Schlüssel sind stimmig.
    CONSTRAINT source_corpus_license_key_matches_statement CHECK ((license_statement = 'license') = (license_key IS NOT NULL)),
    CONSTRAINT source_corpus_attribution_not_blank CHECK (attribution IS NULL OR btrim(attribution) <> ''),
    CONSTRAINT source_corpus_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

COMMENT ON TABLE source_corpus IS
    'Wiki-Angebot hinter Quellen (D1), Schlüssel = registrierbare Domain. Lizenz und Namensnennung eines Korpus exportiert Legacy nicht: sie sind unrecorded, solange der Betreiber nichts entschieden hat (leer heißt nie keine Lizenz). Entschieden ist wiki-aventurica.de (siehe license_statement). Der Import überschreibt die Lizenzfelder nie.';
COMMENT ON COLUMN source_corpus.license_statement IS
    'unrecorded (nicht erfasst) | license (mit license_key) | public_domain | unfree. Leer heißt nie „keine Lizenz“. Betreiber 2026-10-04: „Bei den Wiki-Aventurica-Texten gilt A: CC BY-SA 3.0, entsprechend Legacys LEGAL.md“ (gilt nur für Texte, nicht für Dateien, Wappen oder Bilder; Share-Alike gilt für bearbeiteten Wiki-Text weiter).';

-- Die Korpuszeile der Wiki Aventurica trägt die Betreiberentscheidung vom 2026-10-04 (Wortlaut siehe COMMENT oben): Texte stehen unter
-- CC BY-SA 3.0, entsprechend Legacys LEGAL.md, mit der Namensnennung „Wiki Aventurica“ (die Adresse des Artikels kommt aus der
-- Wiki-Zuordnung). Das gilt NUR für Texte. Der Import führt von dieser Zeile nur `label` und `form`; die Lizenzfelder fasst er nie an.
INSERT INTO source_corpus (corpus_key, label, form, license_statement, license_key, attribution, source_system)
VALUES ('wiki-aventurica.de', '', '', 'license', 'cc-by-sa-3.0', 'Wiki Aventurica', 'operator_decision')
ON CONFLICT (corpus_key) DO UPDATE SET
    license_statement = EXCLUDED.license_statement,
    license_key = EXCLUDED.license_key,
    attribution = EXCLUDED.attribution,
    updated_at = now();


-- KATALOG -----------------------------------------------------------------------------------------------------------

-- Eine Katalogquelle. Die Tabelle heißt `feature_source`, nicht `source`: das Wort `source` ist der Name der Unterabfrage in den Kachelfunktionen
-- (`ST_AsMVT(source, …)`), und der Wächter `render-grants.test.ts` hielte sie sonst für Leser der Tabelle.
-- Die Identität (`source_key`):
--   url:<sha256>        SHA-256 (hex) der Adresse, genau wie geliefert, ohne Normalisierung: Legacys url_hash. Eine geänderte
--                       Adresse ist eine neue Quelle (Hash = Identität); die alte Zeile wird stillgelegt.
--   legacy-id:<id>      VORLÄUFIG, für die URL-losen Quellen, bis Legacy den Wiki-Schlüssel exportiert (E1).
--   wikipub:<wiki_key>  ENDGÜLTIG für URL-lose Quellen (Legacys sha256('wikipub:' + wiki_key)), sobald E1 den Schlüssel liefert.
-- Alle Verknüpfungen zeigen auf `id`; der Wechsel von provisional zu final ändert nur `source_key`, nie `id` und nie eine
-- Verknüpfung. `legacy_source_id` ist Anker der vorläufigen Identität und Information, nie ein Fremdschlüssel und nie
-- zugesichert eindeutig über Züge (Zusammenführungen vergeben Nummern neu). Der Titel ist keine Identität.
CREATE TABLE IF NOT EXISTS feature_source (
    id BIGSERIAL PRIMARY KEY,
    source_key TEXT NOT NULL,
    identity_state TEXT NOT NULL,
    legacy_source_id BIGINT,
    -- NULL bei URL-losen Quellen, nie ein leerer String.
    url TEXT,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL,
    is_official BOOLEAN NOT NULL,
    license_statement TEXT NOT NULL DEFAULT 'unrecorded',
    license_key TEXT REFERENCES license_catalog (key),
    attribution TEXT,
    corpus_key TEXT REFERENCES source_corpus (corpus_key),
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT feature_source_key_unique UNIQUE (source_key),
    CONSTRAINT feature_source_identity_state_known CHECK (identity_state IN ('final', 'provisional')),
    CONSTRAINT feature_source_key_format CHECK (
        source_key ~ '^url:[0-9a-f]{64}$' OR source_key ~ '^legacy-id:[0-9]+$' OR source_key ~ '^wikipub:.+$'
    ),
    -- Die Art des Schlüssels und der Zustand der Identität gehören zusammen: vorläufig ist nur legacy-id.
    CONSTRAINT feature_source_identity_matches_key CHECK (
        (identity_state = 'provisional') = (source_key LIKE 'legacy-id:%')
    ),
    -- Eine Quelle MIT Adresse trägt den Hash ihrer Adresse als Schlüssel, eine ohne trägt keinen url:-Schlüssel.
    CONSTRAINT feature_source_url_is_the_key CHECK (
        (url IS NOT NULL AND source_key = 'url:' || encode(sha256(convert_to(url, 'UTF8')), 'hex'))
        OR (url IS NULL AND source_key NOT LIKE 'url:%')
    ),
    CONSTRAINT feature_source_url_not_blank CHECK (url IS NULL OR btrim(url) <> ''),
    CONSTRAINT feature_source_type_known CHECK (
        source_type IN (
            'regionalspielhilfe', 'abenteuer', 'aventurischer_bote', 'quellenband', 'roman', 'briefspiel', 'regelbuch',
            'sonstiges'
        )
    ),
    CONSTRAINT feature_source_license_statement_known CHECK (
        license_statement IN ('unrecorded', 'license', 'public_domain', 'unfree')
    ),
    CONSTRAINT feature_source_license_key_matches_statement CHECK ((license_statement = 'license') = (license_key IS NOT NULL)),
    CONSTRAINT feature_source_attribution_not_blank CHECK (attribution IS NULL OR btrim(attribution) <> ''),
    CONSTRAINT feature_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

CREATE INDEX IF NOT EXISTS feature_source_legacy_source_id ON feature_source (legacy_source_id) WHERE legacy_source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS feature_source_corpus_key ON feature_source (corpus_key) WHERE corpus_key IS NOT NULL;

COMMENT ON TABLE feature_source IS
    'Katalogquelle (D1): geteilt und dedupliziert, Identität = source_key. Die Verknüpfung zu einem Träger steht in <träger>_source.';
COMMENT ON COLUMN feature_source.source_key IS
    'url:<sha256 der Adresse, wie geliefert> | legacy-id:<id> (vorläufig, URL-los) | wikipub:<wiki_key> (endgültig, URL-los). Der Titel ist keine Identität.';
COMMENT ON COLUMN feature_source.legacy_source_id IS
    'Legacys laufende sources.id: Anker der vorläufigen Identität und Information. Kein Fremdschlüssel, nicht zugesichert stabil (Zusammenführungen vergeben Nummern neu).';
COMMENT ON COLUMN feature_source.title IS 'Wie geliefert; leere und mit <br-Rest versehene Titel sind Befund, kein Eingriff.';
COMMENT ON COLUMN feature_source.license_statement IS
    'unrecorded (nicht erfasst, LEER HEISST NIE KEINE LIZENZ) | license (mit license_key) | public_domain (Rechtsgrund, kein Schlüssel) | unfree (Aussage, kein Schlüssel).';
COMMENT ON COLUMN feature_source.attribution IS 'Namensnennung der Quelle, getrennt von der Lizenz und unabhängig von ihr.';

-- VERKNÜPFUNGEN -------------------------------------------------------------------------------------------------------

-- Je Trägerart eine Tabelle, alle von derselben Gestalt: (Träger, Quelle) eindeutig, Art, Seiten, Notiz, Position.
--   reference_kind NULL ist eine ECHTE QUELLE; gesetzt ist eine PUBLIKATION (ausfuehrlich | ergaenzend | erwaehnung).
--   position ist Legacys Anzeigereihenfolge (offizielle zuerst, dann Anlage), 0-basiert: keine Identität, kein Zusatzschlüssel.
--   state: active | retired (der Zug nennt sie nicht mehr) | suppressed (Tombstone, RESERVIERT: Legacy exportiert ihn nicht, E1+).
-- Eine Zeile mit retired_origin editor oder state suppressed überschreibt kein Import.

CREATE TABLE IF NOT EXISTS place_source (
    id BIGSERIAL PRIMARY KEY,
    place_id BIGINT NOT NULL REFERENCES place (id),
    source_id BIGINT NOT NULL REFERENCES feature_source (id),
    reference_kind TEXT,
    pages TEXT,
    note TEXT,
    -- Legacys Herkunft der Verknüpfung (E1+: manual, wiki_publication, …); NULL = nicht bekannt.
    legacy_origin TEXT,
    position INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT place_source_pair_unique UNIQUE (place_id, source_id),
    CONSTRAINT place_source_reference_kind_known CHECK (
        reference_kind IS NULL OR reference_kind IN ('ausfuehrlich', 'ergaenzend', 'erwaehnung')
    ),
    CONSTRAINT place_source_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT place_source_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT place_source_position_nonnegative CHECK (position >= 0),
    CONSTRAINT place_source_text_not_blank CHECK (
        (pages IS NULL OR btrim(pages) <> '') AND (note IS NULL OR btrim(note) <> '')
        AND (legacy_origin IS NULL OR btrim(legacy_origin) <> '')
    ),
    CONSTRAINT place_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);
CREATE INDEX IF NOT EXISTS place_source_source ON place_source (source_id);

CREATE TABLE IF NOT EXISTS path_source (
    id BIGSERIAL PRIMARY KEY,
    path_id BIGINT NOT NULL REFERENCES path (id),
    source_id BIGINT NOT NULL REFERENCES feature_source (id),
    reference_kind TEXT,
    pages TEXT,
    note TEXT,
    -- Legacys Herkunft der Verknüpfung (E1+: manual, wiki_publication, …); NULL = nicht bekannt.
    legacy_origin TEXT,
    position INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT path_source_pair_unique UNIQUE (path_id, source_id),
    CONSTRAINT path_source_reference_kind_known CHECK (
        reference_kind IS NULL OR reference_kind IN ('ausfuehrlich', 'ergaenzend', 'erwaehnung')
    ),
    CONSTRAINT path_source_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT path_source_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT path_source_position_nonnegative CHECK (position >= 0),
    CONSTRAINT path_source_text_not_blank CHECK (
        (pages IS NULL OR btrim(pages) <> '') AND (note IS NULL OR btrim(note) <> '')
        AND (legacy_origin IS NULL OR btrim(legacy_origin) <> '')
    ),
    CONSTRAINT path_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);
CREATE INDEX IF NOT EXISTS path_source_source ON path_source (source_id);

CREATE TABLE IF NOT EXISTS territory_source (
    id BIGSERIAL PRIMARY KEY,
    territory_id BIGINT NOT NULL REFERENCES territory (id),
    source_id BIGINT NOT NULL REFERENCES feature_source (id),
    reference_kind TEXT,
    pages TEXT,
    note TEXT,
    -- Legacys Herkunft der Verknüpfung (E1+: manual, wiki_publication, …); NULL = nicht bekannt.
    legacy_origin TEXT,
    position INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT territory_source_pair_unique UNIQUE (territory_id, source_id),
    CONSTRAINT territory_source_reference_kind_known CHECK (
        reference_kind IS NULL OR reference_kind IN ('ausfuehrlich', 'ergaenzend', 'erwaehnung')
    ),
    CONSTRAINT territory_source_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT territory_source_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT territory_source_position_nonnegative CHECK (position >= 0),
    CONSTRAINT territory_source_text_not_blank CHECK (
        (pages IS NULL OR btrim(pages) <> '') AND (note IS NULL OR btrim(note) <> '')
        AND (legacy_origin IS NULL OR btrim(legacy_origin) <> '')
    ),
    CONSTRAINT territory_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);
CREATE INDEX IF NOT EXISTS territory_source_source ON territory_source (source_id);

-- Landschaft: die Quellen einer GEBUNDENEN Beschriftung hängen an der Region, nie an der Beschriftung (Legacy: Weiche in
-- ecosystem-label-link.php). Legacys Träger heißt dort `ecosystem`.
CREATE TABLE IF NOT EXISTS region_source (
    id BIGSERIAL PRIMARY KEY,
    region_id BIGINT NOT NULL REFERENCES region (id),
    source_id BIGINT NOT NULL REFERENCES feature_source (id),
    reference_kind TEXT,
    pages TEXT,
    note TEXT,
    -- Legacys Herkunft der Verknüpfung (E1+: manual, wiki_publication, …); NULL = nicht bekannt.
    legacy_origin TEXT,
    position INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT region_source_pair_unique UNIQUE (region_id, source_id),
    CONSTRAINT region_source_reference_kind_known CHECK (
        reference_kind IS NULL OR reference_kind IN ('ausfuehrlich', 'ergaenzend', 'erwaehnung')
    ),
    CONSTRAINT region_source_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT region_source_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT region_source_position_nonnegative CHECK (position >= 0),
    CONSTRAINT region_source_text_not_blank CHECK (
        (pages IS NULL OR btrim(pages) <> '') AND (note IS NULL OR btrim(note) <> '')
        AND (legacy_origin IS NULL OR btrim(legacy_origin) <> '')
    ),
    CONSTRAINT region_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);
CREATE INDEX IF NOT EXISTS region_source_source ON region_source (source_id);

-- Gipfel und Vulkane: Legacys FREIE Beschriftungen (feature_type label ohne Region) mit aktiver terrain_peak-Zeile.
CREATE TABLE IF NOT EXISTS terrain_peak_source (
    id BIGSERIAL PRIMARY KEY,
    terrain_peak_id BIGINT NOT NULL REFERENCES terrain_peak (id),
    source_id BIGINT NOT NULL REFERENCES feature_source (id),
    reference_kind TEXT,
    pages TEXT,
    note TEXT,
    -- Legacys Herkunft der Verknüpfung (E1+: manual, wiki_publication, …); NULL = nicht bekannt.
    legacy_origin TEXT,
    position INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT terrain_peak_source_pair_unique UNIQUE (terrain_peak_id, source_id),
    CONSTRAINT terrain_peak_source_reference_kind_known CHECK (
        reference_kind IS NULL OR reference_kind IN ('ausfuehrlich', 'ergaenzend', 'erwaehnung')
    ),
    CONSTRAINT terrain_peak_source_state_known CHECK (state IN ('active', 'retired', 'suppressed')),
    CONSTRAINT terrain_peak_source_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT terrain_peak_source_position_nonnegative CHECK (position >= 0),
    CONSTRAINT terrain_peak_source_text_not_blank CHECK (
        (pages IS NULL OR btrim(pages) <> '') AND (note IS NULL OR btrim(note) <> '')
        AND (legacy_origin IS NULL OR btrim(legacy_origin) <> '')
    ),
    CONSTRAINT terrain_peak_source_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);
CREATE INDEX IF NOT EXISTS terrain_peak_source_source ON terrain_peak_source (source_id);

COMMENT ON TABLE place_source IS 'Verknüpfung Ort - Quelle (D1): die Aussage des Ortes, mit Art, Seiten, Notiz und Reihenfolge. Wird nicht vererbt.';
COMMENT ON TABLE path_source IS 'Verknüpfung Wegabschnitt - Quelle (D1): je Segment, wie Legacy sie führt; die Gruppe liest die Vereinigung, der Import aggregiert nicht.';
COMMENT ON TABLE territory_source IS 'Verknüpfung Herrschaftsgebiet - Quelle (D1). Ein Gebiet erbt nichts von seinem Elter.';
COMMENT ON TABLE region_source IS 'Verknüpfung Landschaft (region) - Quelle (D1). Die Quellen einer gebundenen Beschriftung hängen hier, nie an der Beschriftung.';
COMMENT ON TABLE terrain_peak_source IS 'Verknüpfung Gipfel oder Vulkan - Quelle (D1): Legacys freie Beschriftungen mit aktiver terrain_peak-Zeile.';
COMMENT ON COLUMN place_source.reference_kind IS
    'NULL ist eine ECHTE QUELLE; gesetzt ist eine PUBLIKATION (ausfuehrlich | ergaenzend | erwaehnung). Eine Publikation macht weder offiziell noch inoffiziell.';
COMMENT ON COLUMN place_source.legacy_origin IS
    'Legacys Herkunft der Verknüpfung (E1+): manual, wiki_publication, …; NULL = nicht bekannt. Dieselbe Spalte an allen fünf Verknüpfungstabellen.';
COMMENT ON COLUMN place_source.position IS 'Legacys Anzeigereihenfolge (offizielle zuerst, dann Anlage), 0-basiert. Keine Identität.';
COMMENT ON COLUMN place_source.state IS 'active | retired (der Zug nennt sie nicht mehr) | suppressed (Tombstone einer von Hand entfernten Verknüpfung, E1+; nie wieder belebt).';

-- KANON (ABGELEITET) --------------------------------------------------------------------------------------------------

-- Je Trägerart eine Tafel. Eine Zeile je Träger mit Verweisen oder einem Eintrag in Legacys Kanon, Legacys Ergebnis als
-- Anfangsstand; die Vorgabe `official` ist ausgeschrieben, damit der Leser sie nicht kennen muss. Ein Träger ohne beides hat
-- keine Zeile (unbelegt, kein Etikett). ABGELEITET: nie von Hand geschrieben, bei jedem Zug neu gerechnet; ein Träger, der
-- keine Zeile mehr bekommt, verliert sie.
--   canon          official | unofficial | unlabelled (nur Publikationen belegt: nichts zu sagen)
--   designator_*   nur bei unofficial: die ART der Quellen, wenn alle dieselbe haben (nie ein Titel), die Anzahl ab zwei
--                  Quellen, oder das Etikett „Wiki Aventurica“
--   derived_from   legacy_feature_kanon (Eintrag der Quelle) | legacy_feature_kanon_default (die ausgeschriebene Vorgabe)

CREATE TABLE IF NOT EXISTS place_canon (
    id BIGSERIAL PRIMARY KEY,
    place_id BIGINT NOT NULL REFERENCES place (id),
    canon TEXT NOT NULL,
    designator_type TEXT,
    designator_count INTEGER,
    designator_label TEXT,
    derived_from TEXT NOT NULL DEFAULT 'legacy_feature_kanon',
    source_revision BIGINT,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT place_canon_carrier_unique UNIQUE (place_id),
    CONSTRAINT place_canon_value_known CHECK (canon IN ('official', 'unofficial', 'unlabelled')),
    CONSTRAINT place_canon_designator_only_unofficial CHECK (
        canon = 'unofficial' OR (designator_type IS NULL AND designator_count IS NULL AND designator_label IS NULL)
    ),
    CONSTRAINT place_canon_designator_type_known CHECK (
        designator_type IS NULL OR designator_type IN (
            'regionalspielhilfe', 'abenteuer', 'aventurischer_bote', 'quellenband', 'roman', 'briefspiel', 'regelbuch',
            'sonstiges'
        )
    ),
    CONSTRAINT place_canon_designator_count_from_two CHECK (designator_count IS NULL OR designator_count >= 2),
    CONSTRAINT place_canon_designator_label_not_blank CHECK (designator_label IS NULL OR btrim(designator_label) <> ''),
    CONSTRAINT place_canon_derived_from_not_blank CHECK (btrim(derived_from) <> '')
);

CREATE TABLE IF NOT EXISTS path_canon (
    id BIGSERIAL PRIMARY KEY,
    path_id BIGINT NOT NULL REFERENCES path (id),
    canon TEXT NOT NULL,
    designator_type TEXT,
    designator_count INTEGER,
    designator_label TEXT,
    derived_from TEXT NOT NULL DEFAULT 'legacy_feature_kanon',
    source_revision BIGINT,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT path_canon_carrier_unique UNIQUE (path_id),
    CONSTRAINT path_canon_value_known CHECK (canon IN ('official', 'unofficial', 'unlabelled')),
    CONSTRAINT path_canon_designator_only_unofficial CHECK (
        canon = 'unofficial' OR (designator_type IS NULL AND designator_count IS NULL AND designator_label IS NULL)
    ),
    CONSTRAINT path_canon_designator_type_known CHECK (
        designator_type IS NULL OR designator_type IN (
            'regionalspielhilfe', 'abenteuer', 'aventurischer_bote', 'quellenband', 'roman', 'briefspiel', 'regelbuch',
            'sonstiges'
        )
    ),
    CONSTRAINT path_canon_designator_count_from_two CHECK (designator_count IS NULL OR designator_count >= 2),
    CONSTRAINT path_canon_designator_label_not_blank CHECK (designator_label IS NULL OR btrim(designator_label) <> ''),
    CONSTRAINT path_canon_derived_from_not_blank CHECK (btrim(derived_from) <> '')
);

CREATE TABLE IF NOT EXISTS territory_canon (
    id BIGSERIAL PRIMARY KEY,
    territory_id BIGINT NOT NULL REFERENCES territory (id),
    canon TEXT NOT NULL,
    designator_type TEXT,
    designator_count INTEGER,
    designator_label TEXT,
    derived_from TEXT NOT NULL DEFAULT 'legacy_feature_kanon',
    source_revision BIGINT,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT territory_canon_carrier_unique UNIQUE (territory_id),
    CONSTRAINT territory_canon_value_known CHECK (canon IN ('official', 'unofficial', 'unlabelled')),
    CONSTRAINT territory_canon_designator_only_unofficial CHECK (
        canon = 'unofficial' OR (designator_type IS NULL AND designator_count IS NULL AND designator_label IS NULL)
    ),
    CONSTRAINT territory_canon_designator_type_known CHECK (
        designator_type IS NULL OR designator_type IN (
            'regionalspielhilfe', 'abenteuer', 'aventurischer_bote', 'quellenband', 'roman', 'briefspiel', 'regelbuch',
            'sonstiges'
        )
    ),
    CONSTRAINT territory_canon_designator_count_from_two CHECK (designator_count IS NULL OR designator_count >= 2),
    CONSTRAINT territory_canon_designator_label_not_blank CHECK (designator_label IS NULL OR btrim(designator_label) <> ''),
    CONSTRAINT territory_canon_derived_from_not_blank CHECK (btrim(derived_from) <> '')
);

CREATE TABLE IF NOT EXISTS region_canon (
    id BIGSERIAL PRIMARY KEY,
    region_id BIGINT NOT NULL REFERENCES region (id),
    canon TEXT NOT NULL,
    designator_type TEXT,
    designator_count INTEGER,
    designator_label TEXT,
    derived_from TEXT NOT NULL DEFAULT 'legacy_feature_kanon',
    source_revision BIGINT,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT region_canon_carrier_unique UNIQUE (region_id),
    CONSTRAINT region_canon_value_known CHECK (canon IN ('official', 'unofficial', 'unlabelled')),
    CONSTRAINT region_canon_designator_only_unofficial CHECK (
        canon = 'unofficial' OR (designator_type IS NULL AND designator_count IS NULL AND designator_label IS NULL)
    ),
    CONSTRAINT region_canon_designator_type_known CHECK (
        designator_type IS NULL OR designator_type IN (
            'regionalspielhilfe', 'abenteuer', 'aventurischer_bote', 'quellenband', 'roman', 'briefspiel', 'regelbuch',
            'sonstiges'
        )
    ),
    CONSTRAINT region_canon_designator_count_from_two CHECK (designator_count IS NULL OR designator_count >= 2),
    CONSTRAINT region_canon_designator_label_not_blank CHECK (designator_label IS NULL OR btrim(designator_label) <> ''),
    CONSTRAINT region_canon_derived_from_not_blank CHECK (btrim(derived_from) <> '')
);

CREATE TABLE IF NOT EXISTS terrain_peak_canon (
    id BIGSERIAL PRIMARY KEY,
    terrain_peak_id BIGINT NOT NULL REFERENCES terrain_peak (id),
    canon TEXT NOT NULL,
    designator_type TEXT,
    designator_count INTEGER,
    designator_label TEXT,
    derived_from TEXT NOT NULL DEFAULT 'legacy_feature_kanon',
    source_revision BIGINT,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT terrain_peak_canon_carrier_unique UNIQUE (terrain_peak_id),
    CONSTRAINT terrain_peak_canon_value_known CHECK (canon IN ('official', 'unofficial', 'unlabelled')),
    CONSTRAINT terrain_peak_canon_designator_only_unofficial CHECK (
        canon = 'unofficial' OR (designator_type IS NULL AND designator_count IS NULL AND designator_label IS NULL)
    ),
    CONSTRAINT terrain_peak_canon_designator_type_known CHECK (
        designator_type IS NULL OR designator_type IN (
            'regionalspielhilfe', 'abenteuer', 'aventurischer_bote', 'quellenband', 'roman', 'briefspiel', 'regelbuch',
            'sonstiges'
        )
    ),
    CONSTRAINT terrain_peak_canon_designator_count_from_two CHECK (designator_count IS NULL OR designator_count >= 2),
    CONSTRAINT terrain_peak_canon_designator_label_not_blank CHECK (designator_label IS NULL OR btrim(designator_label) <> ''),
    CONSTRAINT terrain_peak_canon_derived_from_not_blank CHECK (btrim(derived_from) <> '')
);

CREATE TABLE IF NOT EXISTS powerline_canon (
    id BIGSERIAL PRIMARY KEY,
    powerline_id BIGINT NOT NULL REFERENCES powerline (id),
    canon TEXT NOT NULL,
    designator_type TEXT,
    designator_count INTEGER,
    designator_label TEXT,
    derived_from TEXT NOT NULL DEFAULT 'legacy_feature_kanon',
    source_revision BIGINT,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT powerline_canon_carrier_unique UNIQUE (powerline_id),
    CONSTRAINT powerline_canon_value_known CHECK (canon IN ('official', 'unofficial', 'unlabelled')),
    CONSTRAINT powerline_canon_designator_only_unofficial CHECK (
        canon = 'unofficial' OR (designator_type IS NULL AND designator_count IS NULL AND designator_label IS NULL)
    ),
    CONSTRAINT powerline_canon_designator_type_known CHECK (
        designator_type IS NULL OR designator_type IN (
            'regionalspielhilfe', 'abenteuer', 'aventurischer_bote', 'quellenband', 'roman', 'briefspiel', 'regelbuch',
            'sonstiges'
        )
    ),
    CONSTRAINT powerline_canon_designator_count_from_two CHECK (designator_count IS NULL OR designator_count >= 2),
    CONSTRAINT powerline_canon_designator_label_not_blank CHECK (designator_label IS NULL OR btrim(designator_label) <> ''),
    CONSTRAINT powerline_canon_derived_from_not_blank CHECK (btrim(derived_from) <> '')
);

COMMENT ON TABLE place_canon IS 'Kanon eines Ortes (D1), ABGELEITET: Legacys Ergebnis als Anfangsstand, bei jedem Zug neu geschrieben, nie von Hand. Nie Source of Truth.';
COMMENT ON TABLE path_canon IS 'Kanon eines Wegabschnitts (D1), ABGELEITET: Legacys Ergebnis als Anfangsstand, bei jedem Zug neu geschrieben, nie von Hand.';
COMMENT ON TABLE territory_canon IS 'Kanon eines Herrschaftsgebiets (D1), ABGELEITET: Legacys Ergebnis als Anfangsstand, bei jedem Zug neu geschrieben, nie von Hand.';
COMMENT ON TABLE region_canon IS 'Kanon einer Landschaft (region, D1), ABGELEITET: Legacys Ergebnis als Anfangsstand, bei jedem Zug neu geschrieben, nie von Hand.';
COMMENT ON TABLE terrain_peak_canon IS 'Kanon eines Gipfels oder Vulkans (D1), ABGELEITET: Legacys Ergebnis als Anfangsstand, bei jedem Zug neu geschrieben, nie von Hand.';
COMMENT ON TABLE powerline_canon IS 'Kanon eines Kraftliniensegments (D1), ABGELEITET: Legacys Ergebnis als Anfangsstand (die Vorgabe offiziell, ausgeschrieben; Kraftlinien haben keine Verknüpfungen im Export).';
COMMENT ON COLUMN place_canon.canon IS 'official | unofficial | unlabelled (nur Publikationen belegt: nichts zu sagen). Legacy-Wortlaut offiziell / inoffiziell / leer.';
COMMENT ON COLUMN place_canon.designator_type IS 'Nur bei unofficial: die ART der Quellen, wenn alle dieselbe haben. Nie ein Titel.';
COMMENT ON COLUMN place_canon.designator_count IS 'Nur bei unofficial: die Anzahl der inoffiziellen Quellen ab zwei.';
COMMENT ON COLUMN place_canon.designator_label IS 'Nur bei unofficial: das Etikett der Wiki-Zuweisung (Wiki Aventurica, Namensraum Inoffiziell:).';
COMMENT ON COLUMN place_canon.derived_from IS 'legacy_feature_kanon (Eintrag der Quelle) | legacy_feature_kanon_default (die ausgeschriebene Vorgabe).';
COMMENT ON COLUMN place_canon.source_revision IS 'map_revision des Satzes, aus dem Legacys Ergebnis stammt.';
