-- Direkte Detailfelder und Wiki-Zuordnung der Subjects (WI-0063 P3, Vertrag
-- `project-control/migration/contracts/subject-details.yaml`, D6).
--
-- 🔴 D6 legt KEINE neue Wurzel an. Jeder Träger (Ort, Wegabschnitt, Landschaft, Kraftlinie) behält seine Identität und seine
-- Tabelle; hier hängen ihm drei Teile an: die Wiki-ZUORDNUNG (eine redaktionelle Entscheidung mit Adresse, Zustand und
-- Herkunft), der Wiki-SCHNAPPSCHUSS (der Stand des Artikels zum Zeitpunkt `synced_at`; mehrere Träger können einen Artikel
-- teilen) und beim Ort die redaktionellen TEXTFELDER (`place_detail`). Wiki-Identität ist niemals automatisch
-- Objektidentität: Der Artikel ist ein eigenes Ding, die Zuordnung verbindet.
--
-- 🔴 Typisierte Tabellen je Trägerart und je Wiki-Artikelart, echte Fremdschlüssel. Keine EAV-Tabelle (Feldname, Wert),
-- keine JSON-Spalte, keine `entity_type`-Haupttabelle, keine Tabelle nur für das Panel, kein gespeicherter `lage`-Wert aus
-- Region und Staat (der Leser bildet ihn). Nichts hier wird zur Laufzeit gegen das Wiki gelesen.
--
-- Gebiete und Landschaftsflächen bekommen KEINE neue Zuordnungstabelle: `region.wiki_url` und `region.wiki_region_key` sowie
-- `territory.wiki_url` und `territory.wiki_key` SIND ihre Zuordnung (regions.yaml, territories.yaml). Den Schnappschuss einer
-- Landschaft liest man über `region.wiki_region_key = wiki_region_snapshot.wiki_key`, ohne Fremdschlüssel, weil 41 Regionen
-- eine Zuordnung ohne Schnappschuss tragen.
--
-- Grenze zu WI-0068: Diese Migration legt Schema an. Geschrieben wird es vorerst nur vom Import (`migrate:subject-details`);
-- kein Endpunkt ändert Zuordnungen. `separated` und `suppressed` sowie die Herkünfte `editor`, `wiki_sync` und `bulk` sind
-- RESERVIERT: Legacy liefert sie nicht, der Import schreibt sie nie und überschreibt sie nie.
--
-- Gemeinsame Spalten (Vertrag `zielmodell.gemeinsame_spalten`): source_system, migration_run_id, imported_at, is_active,
-- retired_at, retired_origin (import | editor), created_at, updated_at. Stillgelegt wird, nie gelöscht. Kindzeilen eines
-- Schnappschusses (Verkehrswege, Nachbarn, Synonyme) sind Teile ihres Schnappschusses und tragen nur den Anlagestempel: Ändert
-- sich der Schnappschuss, wird sein Satz an Kindzeilen ersetzt, nie angehäuft.
--
-- Längen: Legacys Obergrenzen (Beschreibung 1.200, Einwohner 200, Lage 300, Oberhaupt 200 Zeichen) stehen hier NICHT als CHECK.
-- Ein längerer Quelltext würde sonst den ganzen Import anhalten; der Import meldet ihn als Befund `text_exceeds_legacy_limit`
-- und speichert ihn unverändert (Betreiber 2026-10-03: nur selbst definierte Prüfungen halten einen Import an).

-- WIKI-SCHNAPPSCHÜSSE -----------------------------------------------------------------------------------------------

-- Ort (Wiki-Vorlage Siedlung). Je `wiki_key` eine Zeile, auch wenn mehrere Orte denselben Artikel tragen. Bei gleichem
-- Schlüssel mit verschiedenen Ständen gewinnt der jüngste `synced_at`. Ein leerer Quelltext ist NULL (das Wiki kennt nichts).
CREATE TABLE IF NOT EXISTS wiki_settlement_snapshot (
    id BIGSERIAL PRIMARY KEY,
    -- Legacys Slug des Seitentitels, wörtlich übernommen, nie neu gerechnet. NICHT `match_key` und nicht der Linkschlüssel.
    wiki_key TEXT NOT NULL,
    -- Wörtlich, wie geliefert (kodiert). Die maßgebliche Aussage der Zuordnung; der Schlüssel ist ihr Slug.
    wiki_url TEXT NOT NULL,
    -- Seitentitel; Legacy schlägt damit die Bauwerksart nach.
    wiki_title TEXT,
    -- Name der Infobox (bei 262 Nestern ungleich dem Titel).
    wiki_name TEXT,
    description TEXT,
    einwohner TEXT,
    oberhaupt TEXT,
    -- Die Wiki-Angabe als Text, kein Verweis auf ein Objekt.
    region_text TEXT,
    staat_text TEXT,
    handelszone TEXT,
    verkehrswege TEXT,
    bevoelkerung TEXT,
    tempel TEXT,
    -- Nur bei Bauwerken gefüllt (Registry des Quellsystems). `is_ruined` wirkt mit `place.is_ruined` als ODER.
    building_type TEXT,
    is_ruined BOOLEAN,
    synced_at TIMESTAMPTZ,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_settlement_snapshot_key_unique UNIQUE (wiki_key),
    CONSTRAINT wiki_settlement_snapshot_key_not_blank CHECK (btrim(wiki_key) <> ''),
    CONSTRAINT wiki_settlement_snapshot_url_not_blank CHECK (btrim(wiki_url) <> ''),
    CONSTRAINT wiki_settlement_snapshot_text_not_blank CHECK (
        (wiki_title IS NULL OR btrim(wiki_title) <> '')
        AND (wiki_name IS NULL OR btrim(wiki_name) <> '')
        AND (description IS NULL OR btrim(description) <> '')
        AND (einwohner IS NULL OR btrim(einwohner) <> '')
        AND (oberhaupt IS NULL OR btrim(oberhaupt) <> '')
        AND (region_text IS NULL OR btrim(region_text) <> '')
        AND (staat_text IS NULL OR btrim(staat_text) <> '')
        AND (handelszone IS NULL OR btrim(handelszone) <> '')
        AND (verkehrswege IS NULL OR btrim(verkehrswege) <> '')
        AND (bevoelkerung IS NULL OR btrim(bevoelkerung) <> '')
        AND (tempel IS NULL OR btrim(tempel) <> '')
        AND (building_type IS NULL OR btrim(building_type) <> '')
    ),
    CONSTRAINT wiki_settlement_snapshot_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

COMMENT ON TABLE wiki_settlement_snapshot IS
    'Wiki-Stand eines Ortsartikels (D6): ein Schnappschuss je wiki_key, gelesen über place_wiki_assignment. Herkunft immer wiki, mit synced_at. Zur Laufzeit liest niemand aus dem Wiki.';
COMMENT ON COLUMN wiki_settlement_snapshot.wiki_key IS
    'Legacys Slug des Seitentitels (Barbrück wird barbr-ck), wörtlich. Nicht der Linkschlüssel der Objektlinks: der ist eine reine Funktion der Adresse (wikiLinkKey) und wird nicht gespeichert.';
COMMENT ON COLUMN wiki_settlement_snapshot.synced_at IS
    'Stempel des Wiki-Abgleichs. Legacy liefert beim Ort Zeitzone (UTC), bei Weg und Landschaft keine: dort als UTC gelesen; die Zone des Legacy-Servers ist nicht belegt.';

-- Die Verkehrswege des Ortsartikels als Zeilen: Anzeigetext zu echtem Wegnamen (Legacy: Objekt). Kein Fremdschlüssel auf
-- `path`: aufgelöst wird beim Lesen über den Namen.
CREATE TABLE IF NOT EXISTS wiki_settlement_traffic_link (
    id BIGSERIAL PRIMARY KEY,
    snapshot_id BIGINT NOT NULL REFERENCES wiki_settlement_snapshot (id),
    -- Die Reihenfolge des Objekts in der Quelle.
    position INTEGER NOT NULL,
    link_text TEXT NOT NULL,
    path_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_settlement_traffic_link_position_unique UNIQUE (snapshot_id, position),
    CONSTRAINT wiki_settlement_traffic_link_position_nonnegative CHECK (position >= 0)
);

COMMENT ON TABLE wiki_settlement_traffic_link IS
    'Verkehrswege eines Ortsartikels: Anzeigetext zu echtem Wegnamen, in der Reihenfolge der Quelle. Teil des Schnappschusses, kein eigener Träger.';

-- Weg (Wiki-Vorlage Straße oder Fluss). Je `wiki_key` eine Zeile, nicht je Segment. SCHLANK ist der Schlüssel eines Artikels,
-- der nur als weitere Zuweisung vorkommt: er trägt nur Schlüssel, Adresse, Name, Art und Wegart.
CREATE TABLE IF NOT EXISTS wiki_path_snapshot (
    id BIGSERIAL PRIMARY KEY,
    wiki_key TEXT NOT NULL,
    wiki_url TEXT NOT NULL,
    name TEXT,
    kind TEXT,
    art TEXT,
    lage TEXT,
    verlauf TEXT,
    laenge TEXT,
    description TEXT,
    -- Schlank: nur als weitere Zuweisung bekannt, ohne eigenes Nest (Vertrag `zielmodell.schnappschuesse.wiki_path_snapshot`).
    is_lean BOOLEAN NOT NULL DEFAULT FALSE,
    synced_at TIMESTAMPTZ,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_path_snapshot_key_unique UNIQUE (wiki_key),
    CONSTRAINT wiki_path_snapshot_key_not_blank CHECK (btrim(wiki_key) <> ''),
    CONSTRAINT wiki_path_snapshot_url_not_blank CHECK (btrim(wiki_url) <> ''),
    CONSTRAINT wiki_path_snapshot_kind_known CHECK (kind IS NULL OR kind IN ('strasse', 'fluss')),
    CONSTRAINT wiki_path_snapshot_text_not_blank CHECK (
        (name IS NULL OR btrim(name) <> '')
        AND (art IS NULL OR btrim(art) <> '')
        AND (lage IS NULL OR btrim(lage) <> '')
        AND (verlauf IS NULL OR btrim(verlauf) <> '')
        AND (laenge IS NULL OR btrim(laenge) <> '')
        AND (description IS NULL OR btrim(description) <> '')
    ),
    CONSTRAINT wiki_path_snapshot_lean_is_thin CHECK (
        NOT is_lean OR (lage IS NULL AND verlauf IS NULL AND laenge IS NULL AND description IS NULL AND synced_at IS NULL)
    ),
    CONSTRAINT wiki_path_snapshot_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

COMMENT ON TABLE wiki_path_snapshot IS
    'Wiki-Stand eines Wegartikels (D6): ein Schnappschuss je wiki_key, nicht je Segment. Die Zuordnung hängt je Segment (path_wiki_assignment).';
COMMENT ON COLUMN wiki_path_snapshot.is_lean IS
    'Schlank: der Artikel kommt nur als weitere Zuweisung vor (Legacy trägt dafür kein Nest); nur Schlüssel, Adresse, Name, Art und Wegart sind belegt.';

-- Landschaft (Wiki-Vorlage Region): der Text je Artikel. Legacy führt die Zuweisung an der Region und den vollen
-- Schnappschuss als KOPIE an jeder Beschriftung; hier steht er einmal je Artikel. `art` roh, inklusive Rest der
-- Mehrwertigkeit (`|`), Legacy liest die erste Komponente.
CREATE TABLE IF NOT EXISTS wiki_region_snapshot (
    id BIGSERIAL PRIMARY KEY,
    wiki_key TEXT NOT NULL,
    wiki_url TEXT NOT NULL,
    name TEXT,
    art TEXT,
    continent TEXT,
    region_parent TEXT,
    affiliation_staat TEXT,
    einwohner TEXT,
    sprache TEXT,
    vegetation TEXT,
    verkehrswege TEXT,
    description TEXT,
    synced_at TIMESTAMPTZ,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_region_snapshot_key_unique UNIQUE (wiki_key),
    CONSTRAINT wiki_region_snapshot_key_not_blank CHECK (btrim(wiki_key) <> ''),
    CONSTRAINT wiki_region_snapshot_url_not_blank CHECK (btrim(wiki_url) <> ''),
    CONSTRAINT wiki_region_snapshot_text_not_blank CHECK (
        (name IS NULL OR btrim(name) <> '')
        AND (art IS NULL OR btrim(art) <> '')
        AND (continent IS NULL OR btrim(continent) <> '')
        AND (region_parent IS NULL OR btrim(region_parent) <> '')
        AND (affiliation_staat IS NULL OR btrim(affiliation_staat) <> '')
        AND (einwohner IS NULL OR btrim(einwohner) <> '')
        AND (sprache IS NULL OR btrim(sprache) <> '')
        AND (vegetation IS NULL OR btrim(vegetation) <> '')
        AND (verkehrswege IS NULL OR btrim(verkehrswege) <> '')
        AND (description IS NULL OR btrim(description) <> '')
    ),
    CONSTRAINT wiki_region_snapshot_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

COMMENT ON TABLE wiki_region_snapshot IS
    'Wiki-Stand eines Landschaftsartikels (D6), einmal je Artikel. Gelesen über region.wiki_region_key = wiki_key (ohne Fremdschlüssel) oder über terrain_peak_wiki_assignment.';
COMMENT ON COLUMN wiki_region_snapshot.art IS
    'Roh, inklusive Rest der Mehrwertigkeit (Legacy liest die erste Komponente vor dem |).';

-- Die Nachbarartikel einer Landschaft: Richtungsobjekt der Quelle als Zeilen. Namen von Artikeln, keine Verweise auf Objekte.
CREATE TABLE IF NOT EXISTS wiki_region_snapshot_neighbor (
    id BIGSERIAL PRIMARY KEY,
    snapshot_id BIGINT NOT NULL REFERENCES wiki_region_snapshot (id),
    direction TEXT NOT NULL,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_region_snapshot_neighbor_unique UNIQUE (snapshot_id, direction, position),
    CONSTRAINT wiki_region_snapshot_neighbor_direction_known CHECK (
        direction IN ('N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW')
    ),
    CONSTRAINT wiki_region_snapshot_neighbor_position_nonnegative CHECK (position >= 0)
);

COMMENT ON TABLE wiki_region_snapshot_neighbor IS
    'Nachbarartikel einer Landschaft je Himmelsrichtung, in der Reihenfolge der Quelle. Teil des Schnappschusses.';

-- Die Synonyme einer Landschaft: roh, Reste von Wikimarkup bleiben stehen (Befund wikitext_residue, nicht repariert).
CREATE TABLE IF NOT EXISTS wiki_region_snapshot_synonym (
    id BIGSERIAL PRIMARY KEY,
    snapshot_id BIGINT NOT NULL REFERENCES wiki_region_snapshot (id),
    position INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_region_snapshot_synonym_unique UNIQUE (snapshot_id, position),
    CONSTRAINT wiki_region_snapshot_synonym_position_nonnegative CHECK (position >= 0)
);

COMMENT ON TABLE wiki_region_snapshot_synonym IS
    'Synonyme einer Landschaft, roh, in der Reihenfolge der Quelle. Teil des Schnappschusses.';

-- Kraftlinie. Das Nest trägt keinen Stempel: `synced_at` bleibt NULL.
CREATE TABLE IF NOT EXISTS wiki_powerline_snapshot (
    id BIGSERIAL PRIMARY KEY,
    wiki_key TEXT NOT NULL,
    wiki_url TEXT NOT NULL,
    name TEXT,
    staerke TEXT,
    affinitaet TEXT,
    laenge TEXT,
    regionen TEXT,
    verlauf TEXT,
    description TEXT,
    synced_at TIMESTAMPTZ,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wiki_powerline_snapshot_key_unique UNIQUE (wiki_key),
    CONSTRAINT wiki_powerline_snapshot_key_not_blank CHECK (btrim(wiki_key) <> ''),
    CONSTRAINT wiki_powerline_snapshot_url_not_blank CHECK (btrim(wiki_url) <> ''),
    CONSTRAINT wiki_powerline_snapshot_text_not_blank CHECK (
        (name IS NULL OR btrim(name) <> '')
        AND (staerke IS NULL OR btrim(staerke) <> '')
        AND (affinitaet IS NULL OR btrim(affinitaet) <> '')
        AND (laenge IS NULL OR btrim(laenge) <> '')
        AND (regionen IS NULL OR btrim(regionen) <> '')
        AND (verlauf IS NULL OR btrim(verlauf) <> '')
        AND (description IS NULL OR btrim(description) <> '')
    ),
    CONSTRAINT wiki_powerline_snapshot_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

COMMENT ON TABLE wiki_powerline_snapshot IS
    'Wiki-Stand eines Kraftlinienartikels (D6). Das Legacy-Nest trägt keinen Stempel, synced_at bleibt NULL.';

-- WIKI-ZUORDNUNGEN --------------------------------------------------------------------------------------------------

-- Der Zustand einer Zuordnung (Vertrag `wiki_zuordnung.ziel`):
--   assigned     Nest mit Schlüssel; Schnappschuss verknüpft. Der Import schreibt ihn.
--   address_only nur eine Adresse (von Hand getippt), kein Schlüssel, kein Schnappschuss. Der Import schreibt ihn.
--   separated    RESERVIERT: bewusst getrennt, ausdrücklich kein Wiki-Artikel. Setzen später Editoren; der Import schreibt und überschreibt ihn nie.
--   suppressed   RESERVIERT: automatische Zuordnung unterdrückt (künftiger WikiSync).
-- Keine Zeile heißt unassigned: kein Entscheid, nie dasselbe wie separated.
--
-- Die Herkunft: legacy_editor (Weg, `source = editor`), legacy_verlauf_sync (Weg, `source = verlauf-sync`), unknown (alle
-- übrigen Importzeilen; Legacy exportiert sie nicht). RESERVIERT: editor, wiki_sync, bulk. Eine Zeile mit einer
-- reservierten Herkunft, mit state separated oder suppressed oder mit retired_origin editor überschreibt kein Import.
--
-- `wiki_url` ist die maßgebliche Aussage und steht bei assigned und address_only immer wörtlich da. Ein separated oder
-- suppressed trägt keine Adresse: der Entscheid ist „kein Artikel“.

CREATE TABLE IF NOT EXISTS place_wiki_assignment (
    id BIGSERIAL PRIMARY KEY,
    place_id BIGINT NOT NULL REFERENCES place (id),
    wiki_url TEXT,
    snapshot_id BIGINT REFERENCES wiki_settlement_snapshot (id),
    assignment_state TEXT NOT NULL,
    assignment_origin TEXT NOT NULL DEFAULT 'unknown',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT place_wiki_assignment_place_unique UNIQUE (place_id),
    CONSTRAINT place_wiki_assignment_state_known CHECK (
        assignment_state IN ('assigned', 'address_only', 'separated', 'suppressed')
    ),
    CONSTRAINT place_wiki_assignment_origin_known CHECK (
        assignment_origin IN ('legacy_editor', 'legacy_verlauf_sync', 'unknown', 'editor', 'wiki_sync', 'bulk')
    ),
    -- Der Schnappschuss hängt genau an einer zugewiesenen Zuordnung.
    CONSTRAINT place_wiki_assignment_snapshot_iff_assigned CHECK ((assignment_state = 'assigned') = (snapshot_id IS NOT NULL)),
    CONSTRAINT place_wiki_assignment_url_when_stated CHECK (
        assignment_state NOT IN ('assigned', 'address_only') OR (wiki_url IS NOT NULL AND btrim(wiki_url) <> '')
    ),
    CONSTRAINT place_wiki_assignment_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

CREATE INDEX IF NOT EXISTS place_wiki_assignment_snapshot
    ON place_wiki_assignment (snapshot_id)
    WHERE snapshot_id IS NOT NULL;

COMMENT ON TABLE place_wiki_assignment IS
    'Wiki-Zuordnung eines Ortes (D6): Adresse, Zustand, Herkunft, Verweis auf den Schnappschuss. Eine redaktionelle Entscheidung, keine blanke URL.';
COMMENT ON COLUMN place_wiki_assignment.wiki_url IS
    'Wörtlich, wie geliefert. Bei assigned und address_only immer gesetzt; ein Schlüsselkürzel ersetzt sie nie (Objektlinks vergleichen ihren Seitenanteil).';

CREATE TABLE IF NOT EXISTS path_wiki_assignment (
    id BIGSERIAL PRIMARY KEY,
    path_id BIGINT NOT NULL REFERENCES path (id),
    -- main: die Hauptzuweisung des Segments (höchstens eine); further: weitere Zuweisungen (wiki_path_weitere), nie ohne main.
    role TEXT NOT NULL,
    wiki_url TEXT,
    snapshot_id BIGINT REFERENCES wiki_path_snapshot (id),
    assignment_state TEXT NOT NULL,
    assignment_origin TEXT NOT NULL DEFAULT 'unknown',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT path_wiki_assignment_role_known CHECK (role IN ('main', 'further')),
    CONSTRAINT path_wiki_assignment_state_known CHECK (
        assignment_state IN ('assigned', 'address_only', 'separated', 'suppressed')
    ),
    CONSTRAINT path_wiki_assignment_origin_known CHECK (
        assignment_origin IN ('legacy_editor', 'legacy_verlauf_sync', 'unknown', 'editor', 'wiki_sync', 'bulk')
    ),
    CONSTRAINT path_wiki_assignment_snapshot_iff_assigned CHECK ((assignment_state = 'assigned') = (snapshot_id IS NOT NULL)),
    CONSTRAINT path_wiki_assignment_url_when_stated CHECK (
        assignment_state NOT IN ('assigned', 'address_only') OR (wiki_url IS NOT NULL AND btrim(wiki_url) <> '')
    ),
    -- Eine bloße Adresse ist nur die Hauptzuweisung (1 im Satz: Jennbach).
    CONSTRAINT path_wiki_assignment_address_only_is_main CHECK (assignment_state <> 'address_only' OR role = 'main'),
    CONSTRAINT path_wiki_assignment_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

-- Höchstens EINE Hauptzuweisung je Segment (auch stillgelegt: die Zeile wird an Ort und Stelle wieder aktiv oder anders belegt).
CREATE UNIQUE INDEX IF NOT EXISTS path_wiki_assignment_one_main_per_path
    ON path_wiki_assignment (path_id)
    WHERE role = 'main';
-- Ein Segment nennt einen Artikel höchstens einmal (UNIQUE (Weg, Schnappschuss)). Nur AKTIVE Zeilen zählen: Legacy-Editoren
-- weisen um, und eine stillgelegte Zeile darf den Artikel nicht für die neue sperren. NULL-Schnappschüsse (address_only)
-- kollidieren nie.
CREATE UNIQUE INDEX IF NOT EXISTS path_wiki_assignment_snapshot_unique_active
    ON path_wiki_assignment (path_id, snapshot_id)
    WHERE is_active AND snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS path_wiki_assignment_snapshot
    ON path_wiki_assignment (snapshot_id)
    WHERE snapshot_id IS NOT NULL;

COMMENT ON TABLE path_wiki_assignment IS
    'Wiki-Zuordnung eines Wegabschnitts (D6): Haupt- und weitere Zuweisungen je Segment, der Schnappschuss je Artikel einmal. Das Panel-Subject ist die Gruppe, nicht das Segment (WI-0063 7).';
COMMENT ON COLUMN path_wiki_assignment.role IS
    'main: Hauptzuweisung des Segments. further: weitere Zuweisung (Legacy wiki_path_weitere); sie macht das Segment zum Mitglied eines weiteren Wegs und gibt es nie ohne eine Hauptzuweisung.';

CREATE TABLE IF NOT EXISTS terrain_peak_wiki_assignment (
    id BIGSERIAL PRIMARY KEY,
    terrain_peak_id BIGINT NOT NULL REFERENCES terrain_peak (id),
    wiki_url TEXT,
    snapshot_id BIGINT REFERENCES wiki_region_snapshot (id),
    assignment_state TEXT NOT NULL,
    assignment_origin TEXT NOT NULL DEFAULT 'unknown',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT terrain_peak_wiki_assignment_peak_unique UNIQUE (terrain_peak_id),
    CONSTRAINT terrain_peak_wiki_assignment_state_known CHECK (
        assignment_state IN ('assigned', 'address_only', 'separated', 'suppressed')
    ),
    CONSTRAINT terrain_peak_wiki_assignment_origin_known CHECK (
        assignment_origin IN ('legacy_editor', 'legacy_verlauf_sync', 'unknown', 'editor', 'wiki_sync', 'bulk')
    ),
    CONSTRAINT terrain_peak_wiki_assignment_snapshot_iff_assigned CHECK (
        (assignment_state = 'assigned') = (snapshot_id IS NOT NULL)
    ),
    CONSTRAINT terrain_peak_wiki_assignment_url_when_stated CHECK (
        assignment_state NOT IN ('assigned', 'address_only') OR (wiki_url IS NOT NULL AND btrim(wiki_url) <> '')
    ),
    CONSTRAINT terrain_peak_wiki_assignment_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

CREATE INDEX IF NOT EXISTS terrain_peak_wiki_assignment_snapshot
    ON terrain_peak_wiki_assignment (snapshot_id)
    WHERE snapshot_id IS NOT NULL;

COMMENT ON TABLE terrain_peak_wiki_assignment IS
    'Wiki-Zuordnung eines Gipfels oder Vulkans (D6), derselbe Landschaftsschnappschuss wie bei der Region. Ob ein Gipfel ein Panel-Subject ist, entscheidet P4.';

CREATE TABLE IF NOT EXISTS powerline_wiki_assignment (
    id BIGSERIAL PRIMARY KEY,
    powerline_id BIGINT NOT NULL REFERENCES powerline (id),
    wiki_url TEXT,
    snapshot_id BIGINT REFERENCES wiki_powerline_snapshot (id),
    assignment_state TEXT NOT NULL,
    assignment_origin TEXT NOT NULL DEFAULT 'unknown',
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT powerline_wiki_assignment_powerline_unique UNIQUE (powerline_id),
    CONSTRAINT powerline_wiki_assignment_state_known CHECK (
        assignment_state IN ('assigned', 'address_only', 'separated', 'suppressed')
    ),
    CONSTRAINT powerline_wiki_assignment_origin_known CHECK (
        assignment_origin IN ('legacy_editor', 'legacy_verlauf_sync', 'unknown', 'editor', 'wiki_sync', 'bulk')
    ),
    CONSTRAINT powerline_wiki_assignment_snapshot_iff_assigned CHECK (
        (assignment_state = 'assigned') = (snapshot_id IS NOT NULL)
    ),
    CONSTRAINT powerline_wiki_assignment_url_when_stated CHECK (
        assignment_state NOT IN ('assigned', 'address_only') OR (wiki_url IS NOT NULL AND btrim(wiki_url) <> '')
    ),
    CONSTRAINT powerline_wiki_assignment_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

CREATE INDEX IF NOT EXISTS powerline_wiki_assignment_snapshot
    ON powerline_wiki_assignment (snapshot_id)
    WHERE snapshot_id IS NOT NULL;

COMMENT ON TABLE powerline_wiki_assignment IS
    'Wiki-Zuordnung eines Kraftliniensegments (D6): 80 mit Nest, 4 nur mit Adresse (address_only).';

-- REDAKTIONELLE TEXTFELDER DES ORTES ---------------------------------------------------------------------------------

-- Direkt am Ort gesetzte Felder (Legacy: description, einwohner, lage, oberhaupt) mit Herkunft je Feld. Sie stehen GETRENNT
-- vom Wiki-Schnappschuss; den wirksamen Wert („direkt vor Wiki“) bildet der Leser (P4). So bleibt „manuell schlägt Wiki“
-- erhalten, ohne dass ein Wiki-Abgleich einen Handwert überschreibt (Kapitel 9.37, 9.38).
--
-- Eine Zeile gibt es nur, wenn mindestens ein Feld gefüllt ist: ein Dorf ohne Daten bekommt keine leere Hülle. Jedes Feld ist
-- NULL oder nicht leer (Legacy löscht ein geleertes Feld). `description` ist in Legacy kein Wiki-Übernahmefeld, trägt keine
-- Herkunft und gilt als redaktioneller Text.
CREATE TABLE IF NOT EXISTS place_detail (
    id BIGSERIAL PRIMARY KEY,
    place_id BIGINT NOT NULL REFERENCES place (id),
    description TEXT,
    einwohner TEXT,
    lage TEXT,
    oberhaupt TEXT,
    -- wiki | manual; NULL = nicht bekannt (nie als wiki gelesen). Nur zu einem gefüllten Feld.
    einwohner_origin TEXT,
    lage_origin TEXT,
    oberhaupt_origin TEXT,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT place_detail_place_unique UNIQUE (place_id),
    CONSTRAINT place_detail_fields_not_blank CHECK (
        (description IS NULL OR btrim(description) <> '')
        AND (einwohner IS NULL OR btrim(einwohner) <> '')
        AND (lage IS NULL OR btrim(lage) <> '')
        AND (oberhaupt IS NULL OR btrim(oberhaupt) <> '')
    ),
    CONSTRAINT place_detail_origin_known CHECK (
        (einwohner_origin IS NULL OR einwohner_origin IN ('wiki', 'manual'))
        AND (lage_origin IS NULL OR lage_origin IN ('wiki', 'manual'))
        AND (oberhaupt_origin IS NULL OR oberhaupt_origin IN ('wiki', 'manual'))
    ),
    -- Eine Herkunft gehört zu einem gefüllten Feld.
    CONSTRAINT place_detail_origin_needs_field CHECK (
        (einwohner_origin IS NULL OR einwohner IS NOT NULL)
        AND (lage_origin IS NULL OR lage IS NOT NULL)
        AND (oberhaupt_origin IS NULL OR oberhaupt IS NOT NULL)
    ),
    -- Eine aktive Zeile trägt mindestens ein Feld (keine leere Hülle).
    CONSTRAINT place_detail_active_has_a_field CHECK (
        NOT is_active
        OR description IS NOT NULL OR einwohner IS NOT NULL OR lage IS NOT NULL OR oberhaupt IS NOT NULL
    ),
    CONSTRAINT place_detail_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

COMMENT ON TABLE place_detail IS
    'Direkte, redaktionelle Textfelder eines Ortes (D6) mit Herkunft je Feld, getrennt vom Wiki-Schnappschuss. Den wirksamen Wert bildet der Leser.';
COMMENT ON COLUMN place_detail.description IS
    'Redaktioneller Text; Legacy begrenzt ihn auf 1.200 Zeichen. Keine Herkunft: description ist in Legacy kein Wiki-Übernahmefeld.';
COMMENT ON COLUMN place_detail.einwohner IS 'Freitext, nie parsen (nur 144 von 1.120 Wiki-Werten sind reine Ziffern). Legacy begrenzt auf 200 Zeichen.';
COMMENT ON COLUMN place_detail.lage IS 'Freitext. Legacy begrenzt auf 300 Zeichen.';
COMMENT ON COLUMN place_detail.oberhaupt IS 'Freitext. Legacy begrenzt auf 200 Zeichen.';
COMMENT ON COLUMN place_detail.einwohner_origin IS 'wiki oder manual aus Legacys field_origins; NULL = nicht bekannt, nie als wiki gelesen.';
