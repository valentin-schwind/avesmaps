-- Die Zoombänder der Systemsteuerung (WI-0221; Idee des Betreibers 2026-10-17: „welche feature wann sichtbar sein soll. global .
-- in der systemsteuerung . reiter: Zoombänder“; Vorlage am 2026-10-18 abgenommen; F1: „unsere einstellungen überschreiben eigentlich
-- die einstellungen (ausnahme herrschscahftsgebiete, die bleiben)“).
--
-- 🔴 REIN ADDITIV: zwei neue Tafeln, eine neue Funktion, ihr Trigger. Das vorige Release liest keine der beiden Tafeln; ohne Zeile
-- gilt die Vorgabe aus dem geteilten Paket (`packages/shared/src/system/zoombaender.ts`). Rechte: `apps/server/src/db/system-grants.psql`
-- (hinter JEDE Migration). Vorbild ist 0134 (Karteneinstellungen).

-- 1. DIE ABWEICHUNGEN -----------------------------------------------------------------------------------------------------------
--
-- 🔴 Nur was verstellt ist, je Spur (`orte.dorf.name`, `wege.bach.linie` …). Zurücksetzen LÖSCHT die Zeile. Ein Schlüssel, den der
-- Katalog nicht kennt, gilt nicht und wird gemeldet (`unknownKeys`); so überlebt ein Rückweg auf das vorige Release eine neue Spur.
CREATE TABLE IF NOT EXISTS zoom_band_setting (
    key TEXT PRIMARY KEY CHECK (key ~ '^[a-z]+\.[A-Za-z0-9_]+\.[a-z]+$'),
    von SMALLINT NOT NULL CHECK (von BETWEEN 0 AND 8),
    bis SMALLINT NOT NULL CHECK (bis BETWEEN 0 AND 8),
    CHECK (von <= bis),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Die Person (`avesmaps_auth.person.id`), ohne Fremdschlüssel ins geschützte Schema; die Kommandozeile trägt nur ihr Etikett.
    changed_by UUID,
    changed_by_label TEXT
);
COMMENT ON TABLE zoom_band_setting IS
    'Verstellte Zoombänder je Umgebung (WI-0221): nur Abweichungen je Spur; der Rest ist die Vorgabe im geteilten Paket.';

-- 2. DIE REVISION ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zoom_band_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE zoom_band_state IS
    'Revision der Zoombänder (WI-0221): Grundlage für baseRevision; steigt mit jeder Anweisung an zoom_band_setting (ein Upsert zählt als INSERT und UPDATE).';

INSERT INTO zoom_band_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.zoom_band_bump() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO zoom_band_state (id, revision, updated_at) VALUES (1, 2, now())
    ON CONFLICT (id) DO UPDATE SET revision = zoom_band_state.revision + 1, updated_at = now();
    RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.zoom_band_bump() IS
    'WI-0221: hebt zoom_band_state.revision je Anweisung an zoom_band_setting.';

CREATE OR REPLACE TRIGGER zoom_band_bump AFTER INSERT OR UPDATE OR DELETE ON zoom_band_setting
    FOR EACH STATEMENT EXECUTE FUNCTION public.zoom_band_bump();
