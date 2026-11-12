-- 0212: Gezeichnete Kämme und Nebengipfel je Gebirge, die Werte des Rückennetz-Modells und eine Revision an den Gebirgswerten
-- (WI-0245, Bauplan „Gebirge aus gezeichneten Kämmen (Rückennetz) im Produkt“ §1). Datenmodell C, Betreiber 2026-10-20, wörtlich:
-- „C eigene tafeln.“; Nebengipfel als Formpunkte ohne Name und Wiki: Der Betreiber wählte „N1 Formpunkte (Empfehlung)“.
--
--   1. `terrain_ridge_edge`: die Kämme einer Gebirgsfläche, Linienzug mit Rang (haupt/neben), in ihrer Folge (`ordinal`).
--   2. `terrain_ridge_point`: die Nebengipfel einer Gebirgsfläche, Punkt mit Höhe in Schritt (leer = Vorgabe des Modells).
--      Beide schreibt der Editor als ganzes Netz je Fläche in EINER Operation `area.gebirge` (`terrain/gebirge-editor.ts`). Liegt
--      mindestens ein Kamm vor, rechnet das Gelände das Rückennetz, sonst die V12 (Lader der Topographie, Schritt 3).
--   3. `terrain_control.grat`, `grat_breite`, `talboden`: Gratlinie, Gratbreite (E) und Talboden des Rückennetzes, leer = Preset des Typs
--      bzw. abgeleitet. Die Grenzen hier sind weiter als die des Editors (`packages/shared/src/gebirge/modell-werte.ts`), damit eine
--      neue Fassung der Regler keine Migration braucht.
--   4. `terrain_control.revision`, gezählt allein vom Trigger `public.revision_bump()` (0079), wie am Gipfel (0205): Der Editor schreibt
--      dagegen (`GebirgsAenderung.baseRevision`, 409 bei Abweichung). Bisher gewann die letzte Schreibung. Ein Netz ohne geänderte
--      Spalte zählt sie mit (`SET revision = revision`); der Landschaften-Zug (I10) zählt sie mit, wenn er Werte ändert.
--
-- Die Tafeln hängen an der Teilfläche (`region_area`), nicht an `terrain_control`: Der Zug legt die Zeile der Werte still und neu an,
-- das Netz bleibt. Gelöscht wird eine Teilfläche nur im Testwelt-Zurücksetzen; dann geht ihr Netz mit.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): zwei neue Tafeln, drei nullbare Spalten, eine Spalte mit Vorgabe 1 und ein Trigger. Das vorige
-- Release liest und schreibt keine davon. Die App-Rolle bekommt die Tafeln über das Default-Privileg der Migrationsrolle
-- (`ops/runtime/runtime-foundation.sh`); sie schreibt beide vollständig (Netz ersetzen = löschen und einfügen).

CREATE TABLE IF NOT EXISTS terrain_ridge_edge (
    id BIGSERIAL PRIMARY KEY,
    area_id BIGINT NOT NULL REFERENCES region_area (id) ON DELETE CASCADE,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    rang TEXT NOT NULL CHECK (rang IN ('haupt', 'neben')),
    geom geometry(LineString, 0) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT terrain_ridge_edge_ordinal_unique UNIQUE (area_id, ordinal),
    CONSTRAINT terrain_ridge_edge_inside CHECK (map_domain_contains(map_domain_id, geom)),
    CONSTRAINT terrain_ridge_edge_laenge CHECK (ST_NPoints(geom) >= 2 AND ST_Length(geom) > 0)
);

COMMENT ON TABLE terrain_ridge_edge IS
    'Gezeichnete Kaemme je Gebirgsflaeche (WI-0245): Linienzug mit Rang; geschrieben als ganzes Netz in area.gebirge.';

CREATE TABLE IF NOT EXISTS terrain_ridge_point (
    id BIGSERIAL PRIMARY KEY,
    area_id BIGINT NOT NULL REFERENCES region_area (id) ON DELETE CASCADE,
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    -- Die Folge, in der sie gezeichnet wurden; das Modell braucht keine, Lesen und Protokoll bleiben damit stabil.
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    geom geometry(Point, 0) NOT NULL,
    -- NULL: das Modell nimmt seine Vorgabe (80 % der Kammhöhe). Grenzen wie `terrain_peak.height_schritt`.
    height_schritt INTEGER CHECK (height_schritt BETWEEN 0 AND 65535),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT terrain_ridge_point_ordinal_unique UNIQUE (area_id, ordinal),
    CONSTRAINT terrain_ridge_point_inside CHECK (map_domain_contains(map_domain_id, geom))
);

COMMENT ON TABLE terrain_ridge_point IS
    'Nebengipfel je Gebirgsflaeche (WI-0245, N1): Formpunkte ohne Name und Wiki; geschrieben mit dem Netz in area.gebirge.';

ALTER TABLE terrain_control ADD COLUMN IF NOT EXISTS grat DOUBLE PRECISION CHECK (grat BETWEEN 0 AND 1);
ALTER TABLE terrain_control ADD COLUMN IF NOT EXISTS grat_breite DOUBLE PRECISION CHECK (grat_breite > 0 AND grat_breite <= 10);
ALTER TABLE terrain_control ADD COLUMN IF NOT EXISTS talboden DOUBLE PRECISION CHECK (talboden BETWEEN 0 AND 1);
ALTER TABLE terrain_control ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN terrain_control.revision IS
    'Revision der Gebirgswerte fuer den Editor (WI-0245): zaehlt der Trigger terrain_control_revision bei jeder Aenderung, auch am Netz.';

CREATE OR REPLACE TRIGGER terrain_control_revision
    BEFORE UPDATE OF area_id, map_domain_id, koernung, stufen, erosion, plateau, hypsometrie, maximalhoehe, bergform, rauschen, sattel,
                     talbreite, einschnitt, kammlinie, beschriftungskurve, vorlage_morph, vorlage_hoehe, durchschnittshoehe, is_active,
                     source_system, gebirgstyp, muster, grat, grat_breite, talboden, revision
    ON terrain_control
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();
