-- Die Karteneinstellungen der Systemsteuerung (WI-0166; Betreiber 2026-10-15: „bau in der systemsteuerung einen neuen Reiter
-- "Karteneinstellungen" und wir beginnen max mit "Startposition" und "Startzoom"“ und „Karteneinstellungen soll zum anlaufpunkt
-- für alle (vor)einstellungen werden, die wir so haben“).
--
-- 🔴 REIN ADDITIV: zwei neue Tafeln, eine neue Funktion, ihr Trigger. Keine bestehende Spalte, kein bestehender Trigger wird
-- angefasst, und das vorige Release liest keine der beiden Tafeln: Ohne Zeile gilt die Vorgabe aus dem Quelltext. Rechte:
-- `apps/server/src/db/system-grants.psql` (hinter JEDE Migration). Vorbild ist 0132 (Wegfindung).

-- 1. DIE ABWEICHUNGEN -----------------------------------------------------------------------------------------------------------
--
-- 🔴 Nur was verstellt ist. Alles andere ist die Vorgabe aus der Tafel `packages/shared/src/system/karteneinstellungen.ts`.
-- Zurücksetzen LÖSCHT die Zeile; eine gespeicherte Zahl, die heute zufällig der Vorgabe gleicht, verdeckte sonst eine spätere
-- Änderung im Code.
--
-- Der Wert ist JSON, weil eine Einstellung hier nicht immer eine Zahl ist (die Startposition ist ein Punkt `{"x":…,"y":…}`). Art
-- und Grenzen je Kennung prüft der Schreibweg gegen die Tafel; ein Wert, der beim Lesen nicht passt, gilt nicht (die Vorgabe
-- greift) und wird gemeldet (`unknownKeys`), wie eine Kennung, die die Tafel nicht kennt.
CREATE TABLE IF NOT EXISTS map_setting (
    key TEXT PRIMARY KEY CHECK (key ~ '^[a-z][A-Za-z0-9]{0,59}$'),
    -- Zusicherung der Tafel: eine Zahl oder ein Objekt, nie NULL, Text oder Liste; damit legt auch eine Hand am SQL keinen
    -- Wert ab, den keine Einstellung lesen kann.
    value JSONB NOT NULL CHECK (jsonb_typeof(value) IN ('number', 'object')),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Die Person (`avesmaps_auth.person.id`), ohne Fremdschlüssel ins geschützte Schema; die Kommandozeile trägt nur ihr Etikett.
    changed_by UUID,
    changed_by_label TEXT
);
COMMENT ON TABLE map_setting IS
    'Verstellte Karteneinstellungen je Umgebung (WI-0166): nur Abweichungen; der Rest ist die Vorgabe der Tafel im Code.';

-- 2. DIE REVISION ---------------------------------------------------------------------------------------------------------------
--
-- Eine Zeile, ein Zähler: die Revision der GANZEN Tafel. Sie ist die `baseRevision` des Schreibwegs (veraltet: 409
-- `edit_conflict`) und das ETag des öffentlichen Lesewegs `GET /api/map-settings`. Eigene Tafel, nicht `system_state`, aus
-- denselben Gründen wie `routing_setting_state` (0132): kein neuer Trigger an einer Zeile, an der andere Migrationen arbeiten,
-- und ein Verstellen ist keine Umschaltung des Betriebszustands.
CREATE TABLE IF NOT EXISTS map_setting_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE map_setting_state IS
    'Revision der Karteneinstellungen (WI-0166): Grundlage für baseRevision und ETag; hebt sich bei jeder Änderung an map_setting.';

-- Die Zeile legt allein die Migration an; ein zweiter Lauf ändert nichts.
INSERT INTO map_setting_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Jede geänderte Zeile hebt die Revision einmal. Als Besitzerin mit festem `search_path`, wie jede Funktion, die eine
-- Basistabelle schreibt (`render-grants.test.ts`); aufrufen kann sie nur der Trigger. Fehlt die Zustandszeile, legt der Trigger
-- sie an, statt still nichts zu tun.
CREATE OR REPLACE FUNCTION public.map_setting_bump() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO map_setting_state (id, revision, updated_at) VALUES (1, 2, now())
    ON CONFLICT (id) DO UPDATE SET revision = map_setting_state.revision + 1, updated_at = now();
    RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.map_setting_bump() IS
    'WI-0166: hebt map_setting_state.revision bei jeder Änderung an map_setting.';

CREATE OR REPLACE TRIGGER map_setting_bump AFTER INSERT OR UPDATE OR DELETE ON map_setting
    FOR EACH ROW EXECUTE FUNCTION public.map_setting_bump();
