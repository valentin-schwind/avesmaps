-- Inhaltsschalter in der Systemsteuerung (WI-0127 SYS-10, SYS-0001 §3.4, Migration „C“ des Bauplans).
--
-- 🔴 REIN ADDITIV: eine neue Tafel, eine neue Funktion, ein neuer Trigger; der vorhandene Trigger `system_state_revision` (0087) bekommt
-- eine Bedingung, sonst nichts. Das vorige Release liest `content_switch` nicht. Rechte: `apps/server/src/db/system-grants.psql` (die App
-- liest, legt an und schaltet um, löscht nie).

-- Nur Abweichungen von der Vorgabe (an). Einschalten setzt `enabled` wieder auf TRUE (die Zeile bleibt, mit Zeit und Person). Den Katalog
-- hält `packages/shared/src/system/content-switches.ts`; ein Schlüssel, den er nicht kennt, wird ignoriert und gemeldet.
CREATE TABLE IF NOT EXISTS content_switch (
    key TEXT PRIMARY KEY CHECK (key ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
    enabled BOOLEAN NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Die Person (`avesmaps_auth.person.id`), ohne Fremdschlüssel ins geschützte Schema; die Kommandozeile trägt nur ihr Etikett.
    changed_by UUID,
    changed_by_label TEXT,
    revision BIGINT NOT NULL DEFAULT 1
);
COMMENT ON TABLE content_switch IS
    'Inhaltsschalter je Umgebung (WI-0127 SYS-10): nur Abweichungen von der Vorgabe; jede Änderung hebt system_state.content_revision.';

-- Jede Änderung hebt `system_state.content_revision`; der Trigger `system_state_notify` (0087) weckt damit alle Instanzen über denselben
-- Kanal. Je geänderter Zeile einmal (ein UPDATE ohne Treffer hebt nichts). Als Besitzerin mit festem `search_path`, wie jede Funktion,
-- die eine Basistabelle liest (`render-grants.test.ts`); aufrufen kann sie nur der Trigger.
CREATE OR REPLACE FUNCTION public.content_switch_bump() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE system_state SET content_revision = content_revision + 1 WHERE id = 1;
    RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.content_switch_bump() IS
    'WI-0127 SYS-10: hebt system_state.content_revision bei jeder Änderung an content_switch (weckt über avesmaps_system_changed).';

CREATE OR REPLACE TRIGGER content_switch_bump AFTER INSERT OR UPDATE OR DELETE ON content_switch
    FOR EACH ROW EXECUTE FUNCTION public.content_switch_bump();

-- Ein Inhaltsschalter ist keine Umschaltung des Betriebszustands: Ändert sich NUR `content_revision`, bleibt `revision` stehen, sonst
-- bekäme eine gleichzeitige Umschaltung im Betriebszustand ein falsches „Jemand hat das gerade geändert“ (409 `edit_conflict`).
CREATE OR REPLACE TRIGGER system_state_revision BEFORE UPDATE ON system_state
    FOR EACH ROW WHEN (OLD.content_revision IS NOT DISTINCT FROM NEW.content_revision)
    EXECUTE FUNCTION public.revision_bump();
