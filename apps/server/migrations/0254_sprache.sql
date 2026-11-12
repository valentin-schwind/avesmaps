-- Sprachen als Kartenebene: Eintrag, Teilfläche und Kachelsicht (WI-0261 S2; Betreiber 2026-10-30: Sprachen als eigene, unabhängige und
-- überlappende Flächen, Entscheidungen E1, E2, E4 und O1-O4).
--
--   1. `sprache`: ein Eintrag je Sprachgruppe der Karte (O1: je Kartengruppe, nicht je Dialekt oder Schrift). Der Schlüssel (`schluessel`,
--      T-2) ist der Gruppenschlüssel der Farbtafel (`thorwalsch`, `garethi` …). `name` steht auf der Karte und in den Zeilen der Infoboxen,
--      `legende` ist der längere Name der Legende („Thorwalsch / Gjalskisch / Fjarningsch“). Die Vorgabe der Farbe ist die Legendenfarbe; der
--      Spracheditor ändert sie, der WikiSync nie. Gelöscht wird nie: Stilllegen wie bei den Vorkommen (`lore_entry`, 0074).
--   2. `sprache_flaeche`: je Teilfläche eine Zeile (Polygon oder MultiPolygon in `aventuria`, SRID 0), damit der Editor Teilflächen einzeln
--      sperrt und speichert (Muster `territory_area`, 0055, und `region_area`, 0010). 🔴 Flächen verschiedener Sprachen DÜRFEN sich
--      überlappen (E2: ein Mischgebiet ist, wo sich zwei Sprachen überlappen); die Datenbank prüft darum keine Überschneidung. Herkunft und
--      Revision der Quelle (T-1): `sprachenkarte` (Import; `quelle_revision` ist die SHA-256 der eingespielten GeoJSON) oder `redaktion`
--      (`quelle_revision` leer). Ein erneuter Import ersetzt nur Flächen der Herkunft `sprachenkarte`.
--   3. `sprache_flaeche_render`: die Kachelquelle für Martin (Muster `region_area_render`, 0166, und `climate_band_render`, 0072): nur aktive
--      Flächen aktiver Sprachen, Geometrie in SRID 3857. Die Kachelrolle liest jede `*_render`-Sicht nach `db-grants` von selbst.
--
-- Die Revision zählt allein der Trigger `public.revision_bump()` (0079; er setzt auch `updated_at`), und nur bei einer Änderung einer
-- FACHLICHEN Spalte (Muster `territory_revision`, 0145). Die Anwendung schreibt sie nie.
--
-- 🔴 ADDITIV (`docs/regeln/entwicklung.md`, „erst erweitern“): drei neue Objekte, die das vorige Release nicht kennt; nichts am Bestand. Die
-- Sicht ruft nur Funktionen, die es schon gibt (`map_domain_to_render`). Die Bedingungen des Fachprotokolls (`map_audit_event_has_target`)
-- und der Sperren (`editor_lock`) kennen die Sprachen noch nicht; sie wachsen mit dem Spracheditor (WI-0261 S5).
--
-- Rechte: In public gibt die Default-Privilegie der Migrationsrolle der App-Rolle SELECT, INSERT, UPDATE, DELETE
-- (`apps/server/src/db/map-grants.psql`, Kopf); diese Datei nimmt ihr an beiden Tafeln DELETE und TRUNCATE (stillgelegt wird, nie gelöscht).
-- Die Einordnung für Claudios Vorlage steht in `apps/server/test/support/public-rechte.ts`.

-- 1. SPRACHE ----------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sprache (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid(),
    schluessel TEXT NOT NULL,
    name TEXT NOT NULL,
    legende TEXT,
    farbe TEXT NOT NULL,
    reihenfolge INTEGER NOT NULL DEFAULT 0,
    herkunft TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sprache_public_id_unique UNIQUE (public_id),
    CONSTRAINT sprache_schluessel_unique UNIQUE (schluessel),
    CONSTRAINT sprache_schluessel_format CHECK (schluessel ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT sprache_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT sprache_legende_not_blank CHECK (legende IS NULL OR btrim(legende) <> ''),
    CONSTRAINT sprache_farbe_format CHECK (farbe ~ '^#[0-9a-f]{6}$'),
    CONSTRAINT sprache_reihenfolge_nonnegative CHECK (reihenfolge >= 0),
    CONSTRAINT sprache_herkunft_known CHECK (herkunft IN ('sprachenkarte', 'redaktion')),
    CONSTRAINT sprache_state_known CHECK (state IN ('active', 'retired')),
    CONSTRAINT sprache_state_matches_activity CHECK ((state = 'active') = is_active),
    CONSTRAINT sprache_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

CREATE OR REPLACE TRIGGER sprache_revision
    BEFORE UPDATE OF schluessel, name, legende, farbe, reihenfolge, herkunft, state, is_active, retired_origin, revision
    ON sprache
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON TABLE sprache IS
    'Sprachgruppe der Karte (WI-0261 S2, O1): ein Eintrag je Kartengruppe mit Schlüssel, Namen, Farbe und Reihenfolge der Legende. Die Flächen stehen in sprache_flaeche. Stillgelegt wird, nie gelöscht.';
COMMENT ON COLUMN sprache.public_id IS
    'Kennung für die Schnittstelle, die Kacheln und das Fachprotokoll; die interne id verlässt den Server nicht.';
COMMENT ON COLUMN sprache.schluessel IS
    'Gruppenschlüssel der Farbtafel (T-2), z. B. thorwalsch: Kleinbuchstaben, Ziffern, Unterstrich und Bindestrich, mit einem Buchstaben am Anfang. Stabil; der Import findet den Eintrag darüber.';
COMMENT ON COLUMN sprache.name IS 'Name auf der Karte und in den Zeilen der Infoboxen, z. B. Thorwalsch.';
COMMENT ON COLUMN sprache.legende IS
    'Name in der Legende, z. B. Thorwalsch / Gjalskisch / Fjarningsch. NULL heißt: die Legende zeigt den Namen.';
COMMENT ON COLUMN sprache.farbe IS
    'Farbe der Sprache als #rrggbb in Kleinbuchstaben. Vorgabe ist die Legendenfarbe; der Spracheditor ändert sie, der WikiSync nie (T-2).';
COMMENT ON COLUMN sprache.reihenfolge IS 'Reihenfolge in der Legende, aufsteigend; bei Gleichstand entscheidet der Name.';
COMMENT ON COLUMN sprache.herkunft IS
    'sprachenkarte (aus der Referenzkarte eingespielt) | redaktion (im Spracheditor angelegt).';
COMMENT ON COLUMN sprache.state IS 'active | retired. Nur active erscheint in einem Leser; gleichlaufend mit is_active.';
COMMENT ON COLUMN sprache.retired_origin IS 'import (der Import nennt den Eintrag nicht mehr) | editor (die Redaktion hat ihn stillgelegt).';
COMMENT ON COLUMN sprache.revision IS
    'Fachrevision (ADR-0020): zählt der Trigger sprache_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';

-- 2. SPRACHFLÄCHE -----------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sprache_flaeche (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid(),
    sprache_id BIGINT NOT NULL REFERENCES sprache (id),
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    geom geometry(Geometry, 0) NOT NULL,
    herkunft TEXT NOT NULL,
    quelle_revision TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retired_origin TEXT,
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sprache_flaeche_public_id_unique UNIQUE (public_id),
    CONSTRAINT sprache_flaeche_is_surface CHECK (GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON')),
    CONSTRAINT sprache_flaeche_inside_domain CHECK (map_domain_contains(map_domain_id, geom)),
    CONSTRAINT sprache_flaeche_herkunft_known CHECK (herkunft IN ('sprachenkarte', 'redaktion')),
    -- Eine Fläche aus der Sprachenkarte nennt die Revision ihrer Quelle, eine der Redaktion nie.
    CONSTRAINT sprache_flaeche_quelle_matches_herkunft CHECK ((herkunft = 'sprachenkarte') = (quelle_revision IS NOT NULL)),
    CONSTRAINT sprache_flaeche_quelle_not_blank CHECK (quelle_revision IS NULL OR btrim(quelle_revision) <> ''),
    CONSTRAINT sprache_flaeche_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor'))
    )
);

CREATE INDEX IF NOT EXISTS sprache_flaeche_geom_gist ON sprache_flaeche USING GIST (geom);
CREATE INDEX IF NOT EXISTS sprache_flaeche_sprache ON sprache_flaeche (sprache_id) WHERE is_active;

CREATE OR REPLACE TRIGGER sprache_flaeche_revision
    BEFORE UPDATE OF sprache_id, map_domain_id, geom, herkunft, quelle_revision, is_active, retired_origin, revision
    ON sprache_flaeche
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();

COMMENT ON TABLE sprache_flaeche IS
    'Teilfläche einer Sprache (WI-0261 S2): je Teilfläche eine Zeile, Polygon oder MultiPolygon in SRID 0. Flächen verschiedener Sprachen dürfen sich überlappen (E2). Stillgelegt wird, nie gelöscht.';
COMMENT ON COLUMN sprache_flaeche.public_id IS 'Kennung für die Schnittstelle, die Sperre, die Kacheln und das Fachprotokoll.';
COMMENT ON COLUMN sprache_flaeche.geom IS
    'Authoritative Geometrie in Kartenkoordinaten, SRID 0 (aventuria). Niemals eine Renderprojektion; die Kachelsicht rechnet sie um.';
COMMENT ON COLUMN sprache_flaeche.herkunft IS
    'sprachenkarte (Import; ein erneuter Import ersetzt nur solche Flächen) | redaktion (im Spracheditor gezeichnet; der Import fasst sie nie an) (T-1).';
COMMENT ON COLUMN sprache_flaeche.quelle_revision IS
    'SHA-256 der eingespielten GeoJSON (T-1). Gesetzt genau bei der Herkunft sprachenkarte, sonst NULL.';
COMMENT ON COLUMN sprache_flaeche.retired_origin IS 'import (der Import nennt die Fläche nicht mehr) | editor (die Redaktion hat sie stillgelegt).';
COMMENT ON COLUMN sprache_flaeche.revision IS
    'Fachrevision (ADR-0020): zählt der Trigger sprache_flaeche_revision bei jeder Änderung einer fachlichen Spalte; die Anwendung schreibt sie nie.';

-- 3. KACHELSICHT ------------------------------------------------------------------------------------------------------------------

-- Wie `region_area_render`: Kennung, Zeile der Sprache für die Farbe, Fläche in Karteneinheiten² (auf zwei Stellen) und die Geometrie
-- in SRID 3857. Nur Aktives; stillgelegte Flächen und Flächen stillgelegter Sprachen verlassen die Datenbank nicht.
CREATE OR REPLACE VIEW sprache_flaeche_render AS
SELECT a.public_id,
    s.public_id AS sprache_public_id,
    s.schluessel,
    s.name,
    s.farbe,
    s.reihenfolge,
    round(st_area(a.geom)::numeric, 2)::double precision AS area,
    map_domain_to_render(a.map_domain_id, a.geom)::geometry(Geometry,3857) AS geom
   FROM sprache_flaeche a
     JOIN sprache s ON s.id = a.sprache_id
  WHERE a.is_active AND s.is_active
  ORDER BY a.public_id;

COMMENT ON VIEW sprache_flaeche_render IS
    'Sprachflächen für die Kachel (WI-0261 S2): aktive Flächen aktiver Sprachen in SRID 3857, mit Schlüssel, Namen, Farbe und Reihenfolge der Sprache. Niemals Source of Truth.';
