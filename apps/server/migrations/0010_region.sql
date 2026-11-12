-- Die Regionsdomaene: Region als Aggregatwurzel mit ihren Flaechen und ihren gebundenen Labels
-- (WI-0003, Contract project-control/migration/contracts/regions.yaml, Betreiberentscheidung
-- 2026-09-20).
--
-- Die drei Tabellen sind EIN Aggregat, kein Verbund dreier Domaenen. Region, Flaeche und Label
-- gehoeren zusammen: erst die Labels sagen, wie eine Region auf der Karte heisst und welcher ihrer
-- Namen der primaere ist. Legacy kaskadiert dieselbe Grenze - das Loeschen des letzten Labels legt
-- Region und Flaechen mit stellt.
--
-- Geometrie liegt im Kartenraum mit SRID 0, wie bei den Orten (Kapitel 4.13). Eine abgeleitete
-- Renderprojektion wird nie gespeichert, sondern auf dem Weg nach draussen erzeugt (Kapitel 4.17.4).

CREATE TABLE IF NOT EXISTS region (
    id BIGSERIAL PRIMARY KEY,
    -- Legacy-UUID bleibt die oeffentliche Identitaet, damit Deep Links weiter funktionieren (9.16).
    public_id UUID NOT NULL,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    name TEXT NOT NULL,
    -- Legacy nennt das kind; der Name ist neu, die Werte sind unveraendert (Betreiber 2026-09-20).
    region_layer TEXT NOT NULL CHECK (
        region_layer IN ('derographisch', 'vegetation', 'topographie', 'klima')
    ),
    -- Die Art innerhalb der Ebene. Darf fehlen: 82 Regionen tragen live keine.
    region_type TEXT,
    -- Stapelreihenfolge innerhalb der Ebene. Migrationsgegenstand, keine Renderentscheidung -
    -- nachbauen liesse sie sich nicht (Finding MCS-007).
    stack_order INTEGER NOT NULL DEFAULT 0,
    -- Klicksperre im Editor, keine Sichtbarkeit.
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    -- Die Wiki-Zuweisung IST die Adresse; der Schluessel wird in Legacy daraus abgeleitet und nie
    -- aus dem Payload gelesen. Beides reist als Referenz mit, die Texte nicht.
    wiki_url TEXT,
    wiki_region_key TEXT,
    -- 💣 NULLBAR, und NULL heisst "nicht migriert", nicht "aus". Der oeffentliche Endpunkt traegt
    -- diese Werte gar nicht; ein NOT NULL DEFAULT FALSE wuerde fuer tausende Regionen eine
    -- Entscheidung behaupten, die niemand getroffen hat - der Fehler, den ADR-0006 bei show_name
    -- korrigiert hat.
    label_curve_enabled BOOLEAN,
    label_curve_max SMALLINT CHECK (label_curve_max BETWEEN 1 AND 3),
    -- Das primaere Label der Region: jenes, das der Regionsdialog verwaltet. Eigenschaft, keine
    -- zweite Zugehoerigkeitsrelation. Der Fremdschluessel kommt unten, weil map_label seinerseits
    -- auf region zeigt.
    primary_label_id BIGINT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    legacy_public_id UUID,
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT region_public_id_unique UNIQUE (public_id),
    -- Eine Kurvenanzahl ohne Kurvenschalter waere eine Aussage ueber nichts.
    CONSTRAINT region_curve_pair CHECK (
        (label_curve_enabled IS NULL AND label_curve_max IS NULL)
        OR label_curve_enabled IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS region_legacy_public_id_unique
    ON region (legacy_public_id)
    WHERE legacy_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS region_domain_layer ON region (map_domain_id, region_layer) WHERE is_active;
CREATE INDEX IF NOT EXISTS region_wiki_key ON region (wiki_region_key) WHERE wiki_region_key IS NOT NULL;

COMMENT ON TABLE region IS
    'Aggregatwurzel der Landschaftsregion. Legacy ecosystem_region (WI-0003).';
COMMENT ON COLUMN region.region_layer IS
    'Legacy kind, unveraenderte Werte. Die Ebene haengt an der Region, die Flaeche erbt sie.';
COMMENT ON COLUMN region.label_curve_enabled IS
    'NULL = nicht migriert. Quelle ist der Editor-Lesepfad list_regions, nicht der oeffentliche Endpunkt.';
COMMENT ON COLUMN region.primary_label_id IS
    'Das primaere Label der Region. NULL, wenn keines benannt ist oder der Legacy-Zeiger ins Leere geht.';

-- Die Geometrie. Eine Region traegt 0..M Flaechen; live sind es hoechstens fuenf, und zwoelf
-- Regionen tragen gar keine.
CREATE TABLE IF NOT EXISTS region_area (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL,
    region_id BIGINT NOT NULL REFERENCES region (id),
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    geom geometry(Geometry, 0) NOT NULL,
    -- Der Fingerabdruck, an dem ein abgeleiteter Schriftlauf veraltet (ADR-0007).
    geometry_revision BIGINT,
    -- Die Flaeche beeinflusst die Reisegeschwindigkeit. Routingrelevant, hier nur zu erhalten.
    affects_paths BOOLEAN NOT NULL DEFAULT TRUE,
    is_trial BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    legacy_public_id UUID,
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT region_area_public_id_unique UNIQUE (public_id),
    CONSTRAINT region_area_is_surface CHECK (GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON')),
    CONSTRAINT region_area_inside_domain CHECK (map_domain_contains(map_domain_id, geom))
);

CREATE UNIQUE INDEX IF NOT EXISTS region_area_legacy_public_id_unique
    ON region_area (legacy_public_id)
    WHERE legacy_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS region_area_geom_gist ON region_area USING GIST (geom);
CREATE INDEX IF NOT EXISTS region_area_region ON region_area (region_id) WHERE is_active;

COMMENT ON COLUMN region_area.geom IS
    'Authoritative MCS-Geometrie, SRID 0. Niemals eine Renderprojektion. Die Bounding Box wird nicht gespeichert - PostGIS rechnet sie, ein zweiter Wert waere eine Quelle fuer Widersprueche.';

-- Labels. region_id NULL heisst freies Label; die 253 freien kommen in einem eigenen Schritt und
-- werden niemals kuenstlich einer Region zugeordnet.
CREATE TABLE IF NOT EXISTS map_label (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    region_id BIGINT REFERENCES region (id),
    name TEXT NOT NULL,
    -- Der Subtyp eines gebundenen Labels IST der Artschluessel seiner Region (Finding MCS-007).
    subtype TEXT,
    geom geometry(Point, 0) NOT NULL,
    -- Zoomspanne, Groesse und Prioritaet gehoeren dem Label selbst - anders als bei den Orten, wo
    -- die Klassentafel entscheidet (ADR-0006 grenzt beides ausdruecklich voneinander ab).
    label_min_zoom SMALLINT CHECK (label_min_zoom BETWEEN 0 AND 8),
    label_max_zoom SMALLINT CHECK (label_max_zoom BETWEEN 0 AND 8),
    label_size NUMERIC(4, 1) CHECK (label_size BETWEEN 4 AND 60),
    label_priority SMALLINT CHECK (label_priority BETWEEN 1 AND 5),
    -- Gespeichert und weiter erhalten, aber fuer ein Label an einer Region nicht mehr gezeichnet:
    -- es ist der einzige Rueckweg eines Feature-Rueckbaus (Finding MCS-008). 55 gebundene Labels
    -- tragen live einen Winkel ungleich null.
    rotation NUMERIC(5, 1) CHECK (rotation BETWEEN -360 AND 360),
    -- NULL heisst "nicht gesetzt", nicht "false": 144 gebundene Labels tragen den Schluessel gar
    -- nicht, und der Renderer wendet dann seine Vorgabe an.
    show_name BOOLEAN,
    is_nodix BOOLEAN,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    legacy_public_id UUID,
    legacy_revision BIGINT,
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT map_label_public_id_unique UNIQUE (public_id),
    CONSTRAINT map_label_zoom_ordered CHECK (
        label_min_zoom IS NULL OR label_max_zoom IS NULL OR label_min_zoom <= label_max_zoom
    ),
    CONSTRAINT map_label_inside_domain CHECK (map_domain_contains(map_domain_id, geom))
);

CREATE UNIQUE INDEX IF NOT EXISTS map_label_legacy_public_id_unique
    ON map_label (legacy_public_id)
    WHERE legacy_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS map_label_geom_gist ON map_label USING GIST (geom);
CREATE INDEX IF NOT EXISTS map_label_region ON map_label (region_id) WHERE region_id IS NOT NULL;

COMMENT ON TABLE map_label IS
    'Landschafts- und Gelaendenamen. region_id NULL = freies Label. Nicht zu verwechseln mit den Ortsnamen, die aus der Klassentafel kommen (ADR-0006).';

-- Der Rueckverweis auf das primaere Label. Er kommt zuletzt, weil beide Tabellen aufeinander
-- zeigen.
ALTER TABLE region
    DROP CONSTRAINT IF EXISTS region_primary_label_fk;
ALTER TABLE region
    ADD CONSTRAINT region_primary_label_fk
    FOREIGN KEY (primary_label_id) REFERENCES map_label (id);

-- Kachelquelle der Landschaftsflaechen. Martin lehnt SRID-0-Tabellen ab; genau dafuer gibt es diese
-- Ansicht. Sie veroeffentlicht abgeleitete Geometrie und traegt die Regionsattribute mit, die der
-- Stil braucht - die Ebene, die Art und die Stapelreihenfolge haengen an der Region, nicht an der
-- Flaeche.
CREATE OR REPLACE VIEW region_area_render AS
SELECT
    a.public_id,
    r.public_id AS region_public_id,
    r.name,
    r.region_layer,
    r.region_type,
    r.stack_order,
    r.is_locked,
    map_domain_to_render(a.map_domain_id, a.geom)::geometry(Geometry, 3857) AS geom
FROM region_area a
JOIN region r ON r.id = a.region_id
WHERE a.is_active
  AND r.is_active;

COMMENT ON VIEW region_area_render IS
    'Abgeleitete Renderansicht der Landschaftsflaechen fuer Martin. Niemals Source of Truth (Kapitel 4.17.4).';
