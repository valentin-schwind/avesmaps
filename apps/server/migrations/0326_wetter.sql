-- Das Wetter im Produkt (WI-0288 Stufe 2): Presets und Icons des Wetter-Editors, das Wettermodell der Systemsteuerung.
--
-- 🔴 REIN ADDITIV: vier neue Tafeln, eine neue Funktion, ihr Trigger. Keine bestehende Spalte, kein bestehender Trigger wird angefasst, und das
-- vorige Release liest keine der Tafeln. Rechte: `apps/server/src/db/system-grants.psql` (hinter JEDE Migration).
--
-- 🔴 KEINE INHALTE (Map Mutation Guard): Diese Migration schreibt weder Presets noch Icons. Eine leere Tafel heißt „es gelten die Vorgaben im
-- Code“ (`packages/shared/src/wetter/`); erst die erste Änderung eines Editors legt die 14 Presets bzw. die Icons des Prototyps an, in einer
-- Transaktion (`apps/server/src/wetter/stand.ts`). Die einzige Zeile, die hier entsteht, ist die Revision des Wettermodells, wie bei 0132.

-- 1. DIE PRESETS ----------------------------------------------------------------------------------------------------------------
--
-- Genau 14, sobald überhaupt eines gespeichert ist. Die Kennung ist der erste Platz des Presets (`p-u`, `p-praios` … `p-rahja`, `p-namenlos`)
-- und wandert beim Verschieben nicht mit.
--
-- `tag` ist der Tag im Jahr (1 bis 365, `packages/shared/src/calendar.ts`); 🪤 **0 heißt unbestimmt** (im Leseweg `null`). Darum genügt EINE
-- Eindeutigkeit für beides, „jeder Tag höchstens einmal“ und „höchstens ein unbestimmtes“, und sie ist aufschiebbar: Ein Tausch zweier
-- Presets (auch mit dem unbestimmten) ist eine einzige Anweisung, und PostgreSQL prüft eine nicht aufschiebbare Eindeutigkeit je Zeile statt
-- am Ende der Anweisung. „Genau eines unbestimmt“ hält der Schreibweg: Er legt alle 14 auf einmal an und tauscht nur.
--
-- `werte` hält die 15 jahreszeitlichen Zahlen (`WETTER_JAHR_SPALTEN`); Kennung und Grenzen prüft der Schreibweg, ein unbekannter Schlüssel
-- wird beim Lesen übergangen. `revision` je Preset: 0 heißt „so angelegt, wie die Vorgabe war“, jede Änderung hebt um eins.
CREATE TABLE IF NOT EXISTS weather_preset (
    preset_id TEXT PRIMARY KEY CHECK (preset_id ~ '^p-[a-z]{1,12}$'),
    tag SMALLINT NOT NULL CHECK (tag BETWEEN 0 AND 365),
    werte JSONB NOT NULL CHECK (jsonb_typeof(werte) = 'object'),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Die Person (`avesmaps_auth.person.id`), ohne Fremdschlüssel ins geschützte Schema; die Kommandozeile trägt nur ihr Etikett.
    changed_by UUID,
    changed_by_label TEXT,
    CONSTRAINT weather_preset_tag_eindeutig UNIQUE (tag) DEFERRABLE INITIALLY IMMEDIATE
);
COMMENT ON TABLE weather_preset IS
    'Presets des Wetters (WI-0288): 14 Zeitpunkte mit den jahreszeitlichen Werten; tag 0 heißt unbestimmt. Leer heißt: Vorgaben im Code.';

-- 2. DIE ICONS ------------------------------------------------------------------------------------------------------------------
--
-- Wind, Wirbel, Meeresströmung; ganzjährig. Entfernt wird weich (`entfernt_at`): Eine Tafel, in der alles entfernt ist, ist nicht leer und
-- zeigt darum nicht wieder die Vorgaben. `sichtbar = false` blendet nur aus, das Icon wirkt weiter (Betreiber 2026-11-07).
-- Lage, Reichweite und Stärke in Karteneinheiten wie die Engine; `richtung` in Grad nach der Windrose (0 Norden, 90 Osten), nur Wind und
-- Strömung; `drehsinn` nur Wirbel. Die Grenzen der Anwendung (`WETTER_SYMBOL_GRENZEN`) prüft der Schreibweg; hier steht, was nie sein darf.
-- `wiki_titel` (Stufe 6): der Titel des Wiki-Artikels (Wind, Meeresströmung, Mahlstrom), den ein Editor am Icon setzt; ob es den Artikel gibt, prüft der
-- Schreibweg gegen die Wiki-Einträge des Derographie-Zugs (ohne Fremdschlüssel: die Einträge werden still gelegt, nie gelöscht, und der Verweis bleibt).
CREATE TABLE IF NOT EXISTS weather_symbol (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    art TEXT NOT NULL CHECK (art IN ('wind', 'wirbel', 'stroemung')),
    name TEXT CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 120),
    name_zeigen BOOLEAN NOT NULL DEFAULT false,
    sichtbar BOOLEAN NOT NULL DEFAULT true,
    x DOUBLE PRECISION NOT NULL CHECK (x BETWEEN 0 AND 1024),
    z DOUBLE PRECISION NOT NULL CHECK (z BETWEEN 0 AND 1024),
    reichweite DOUBLE PRECISION NOT NULL CHECK (reichweite > 0 AND reichweite < 'Infinity'::double precision),
    staerke DOUBLE PRECISION NOT NULL CHECK (staerke > 0 AND staerke < 'Infinity'::double precision),
    richtung DOUBLE PRECISION CHECK (richtung >= 0 AND richtung < 360),
    drehsinn SMALLINT CHECK (drehsinn IN (-1, 1)),
    wiki_titel TEXT CHECK (wiki_titel IS NULL OR (char_length(wiki_titel) BETWEEN 1 AND 200 AND wiki_titel = btrim(wiki_titel))),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 0),
    entfernt_at TIMESTAMPTZ,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed_by UUID,
    changed_by_label TEXT,
    CONSTRAINT weather_symbol_richtung_oder_drehsinn CHECK (
        (art = 'wirbel' AND richtung IS NULL AND drehsinn IS NOT NULL)
        OR (art <> 'wirbel' AND richtung IS NOT NULL AND drehsinn IS NULL)
    )
);
COMMENT ON TABLE weather_symbol IS
    'Icons des Wetters (WI-0288): Wind, Wirbel, Strömung; weich entfernt. Leer heißt: die Icons des Prototyps aus dem Code.';

-- 3. DAS WETTERMODELL -----------------------------------------------------------------------------------------------------------
--
-- Dieselbe Form wie die Wegfindung (0132): nur was verstellt ist, Zurücksetzen LÖSCHT die Zeile. Die Kennung ist die der Tafel
-- `packages/shared/src/wetter/modell.ts`; eine unbekannte wird beim Lesen übergangen. Endlich steht hier als Zusicherung der Tafel; die
-- Grenzen je Wert prüft der Schreibweg (manche Werte dürfen 0 sein, `res` 0 heißt automatisch).
CREATE TABLE IF NOT EXISTS weather_model_setting (
    key TEXT PRIMARY KEY CHECK (key ~ '^[a-z][A-Za-z0-9]{0,59}$'),
    value DOUBLE PRECISION NOT NULL CHECK (value > '-Infinity'::double precision AND value < 'Infinity'::double precision),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed_by UUID,
    changed_by_label TEXT
);
COMMENT ON TABLE weather_model_setting IS
    'Verstellte Werte des Wettermodells (WI-0288): nur Abweichungen; der Rest ist die Vorgabe der Tafel im Code.';

-- Eine Zeile, ein Zähler: die Revision der ganzen Tafel, Grundlage für `baseRevision`. Die App liest sie nur; der Schreibweg sperrt mit einer
-- Beratungssperre, nicht mit `SELECT … FOR UPDATE` (das verlangte das UPDATE-Recht, `system/karteneinstellungen.ts`).
CREATE TABLE IF NOT EXISTS weather_model_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE weather_model_state IS
    'Revision des Wettermodells (WI-0288): hebt sich bei jeder Änderung an weather_model_setting.';

INSERT INTO weather_model_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Wie `routing_setting_bump` (0132): als Besitzerin mit festem `search_path`; aufrufen kann sie nur der Trigger. Fehlt die Zustandszeile,
-- legt der Trigger sie an.
CREATE OR REPLACE FUNCTION public.weather_model_bump() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO weather_model_state (id, revision, updated_at) VALUES (1, 2, now())
    ON CONFLICT (id) DO UPDATE SET revision = weather_model_state.revision + 1, updated_at = now();
    RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.weather_model_bump() IS
    'WI-0288: hebt weather_model_state.revision bei jeder Änderung an weather_model_setting.';

CREATE OR REPLACE TRIGGER weather_model_bump AFTER INSERT OR UPDATE OR DELETE ON weather_model_setting
    FOR EACH ROW EXECUTE FUNCTION public.weather_model_bump();
