-- Die Kartenserien zur Laufzeit (WI-0220; Betreiber 2026-10-17: „Die Karten von Avesmaps sollen in der Systemsteuerung gelistet
-- werden. Es sollen neue hinzugefügt, gelöscht und ersetzt werden können“).
--
-- 🔴 REIN ADDITIV: zwei neue Tafeln, eine neue Funktion, ihr Trigger. Keine bestehende Spalte, kein bestehender Trigger wird
-- angefasst, und das vorige Release liest keine der beiden Tafeln. Ohne Zeile gilt die Vorgabe aus `config/map-series/aventuria.json`.
-- Rechte: `apps/server/src/db/system-grants.psql` (hinter JEDE Migration). Vorbild ist 0134 (Karteneinstellungen).

-- 1. DIE ABWEICHUNGEN UND DIE NEUEN SERIEN --------------------------------------------------------------------------------------
--
-- Eine Zeile je Serie, die die Systemsteuerung angefasst hat. Für eine Serie aus der JSON heißt ein leeres Feld „wie die Vorgabe“;
-- eine neue Serie (Kennung nicht in der JSON) trägt hier alles, was sie hat. Zusammengerechnet wird im geteilten Paket
-- (`packages/shared/src/system/kartenserien.ts`, `wirksamerKatalog`), nicht in SQL.
CREATE TABLE IF NOT EXISTS map_series (
    -- Wie Nginx sie ausliefert (`^/tiles/raster/[a-z]+/…`): nur Kleinbuchstaben.
    series_id TEXT PRIMARY KEY CHECK (series_id ~ '^[a-z]{1,24}$'),
    label TEXT CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 60),
    description TEXT CHECK (description IS NULL OR length(description) <= 300),
    visibility TEXT CHECK (visibility IS NULL OR visibility IN ('PUBLIC', 'EDITOR_ONLY')),
    labels_in_image BOOLEAN,
    -- Beschriftung im Bild heißt nur für Editoren (Betreiberregel 2026-09-21); wo beides in derselben Zeile steht, sagt es auch
    -- die Tafel. Für die Serien der JSON prüft es der Schreibweg gegen die Vorgabe.
    CHECK (labels_in_image IS NOT TRUE OR visibility IS DISTINCT FROM 'PUBLIC'),
    sort_order INTEGER,
    -- Das Bild im Fächermenü: eine Kachel der Stufe 5 (32 × 32).
    thumb_x SMALLINT CHECK (thumb_x BETWEEN 0 AND 31),
    thumb_y SMALLINT CHECK (thumb_y BETWEEN 0 AND 31),
    CHECK ((thumb_x IS NULL) = (thumb_y IS NULL)),
    -- Herkunft und Rechte (die Rechtstexte nimmt der Betreiber je Sprache ab, `docs/regeln/oberflaeche.md`).
    author TEXT,
    origin TEXT,
    derivation TEXT,
    permission_statement TEXT,
    attribution TEXT,
    -- Die englischen Fassungen der vier Rechtstexte, je Feld; ein fehlendes Feld heißt „wie die Vorgabe“.
    texts_en JSONB CHECK (texts_en IS NULL OR jsonb_typeof(texts_en) = 'object'),
    -- Nur neue Serien: Kantenlänge der Quelle und höchste eigene Stufe (32k: 6, 64k: 7).
    source_pixels INTEGER CHECK (source_pixels IS NULL OR source_pixels > 0),
    max_native_zoom SMALLINT CHECK (max_native_zoom IS NULL OR max_native_zoom BETWEEN 0 AND 8),
    is_default BOOLEAN NOT NULL DEFAULT false,
    -- Löschen legt in den Papierkorb (WI-0220 §4.5); Kacheln und Quelle bleiben, Wiederherstellen setzt zurück.
    status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv', 'papierkorb')),
    papierkorb_at TIMESTAMPTZ,
    CHECK ((status = 'papierkorb') = (papierkorb_at IS NOT NULL)),
    CHECK (NOT (is_default AND status = 'papierkorb')),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Die Person (`avesmaps_auth.person.id`), ohne Fremdschlüssel ins geschützte Schema; die Kommandozeile trägt nur ihr Etikett.
    changed_by UUID,
    changed_by_label TEXT
);
COMMENT ON TABLE map_series IS
    'Kartenserien je Umgebung (WI-0220): Abweichungen von config/map-series/aventuria.json und neue Serien; leeres Feld = Vorgabe.';

-- Genau eine Vorgabe-Serie, wenn überhaupt eine Zeile sie setzt (sonst gilt die der JSON).
CREATE UNIQUE INDEX IF NOT EXISTS map_series_eine_vorgabe ON map_series (is_default) WHERE is_default;

-- 2. DIE REVISION ---------------------------------------------------------------------------------------------------------------
--
-- Eine Zeile, ein Zähler: die `baseRevision` der Schreibwege (veraltet: 409 `edit_conflict`). Eigene Tafel aus denselben Gründen
-- wie `map_setting_state` (0134).
CREATE TABLE IF NOT EXISTS map_series_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE map_series_state IS
    'Revision der Kartenserien (WI-0220): Grundlage für baseRevision; hebt sich bei jeder Änderung an map_series.';

INSERT INTO map_series_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.map_series_bump() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO map_series_state (id, revision, updated_at) VALUES (1, 2, now())
    ON CONFLICT (id) DO UPDATE SET revision = map_series_state.revision + 1, updated_at = now();
    RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.map_series_bump() IS
    'WI-0220: hebt map_series_state.revision bei jeder Änderung an map_series.';

-- Je Anweisung einmal: Eine neue Vorgabe setzt zwei Zeilen (alte aus, neue an) und soll EINE Revision kosten.
CREATE OR REPLACE TRIGGER map_series_bump AFTER INSERT OR UPDATE OR DELETE ON map_series
    FOR EACH STATEMENT EXECUTE FUNCTION public.map_series_bump();
