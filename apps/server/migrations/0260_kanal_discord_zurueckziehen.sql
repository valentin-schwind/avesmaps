-- 0260: `/erledigt` aus Discord (WI-0255 Paket 2; Handover `project-control/handovers/2026-10-30-discord-offen-erledigt-an-claudia.md`). Vali 2026-10-30:
-- „a: melder und betreiber, deren discord konto mit avesmaps verknüpft ist“. Community-Fachkonzept §8.1: Der Melder vergleicht seine Kennung mit
-- `melder_kennung` (0231), keine neue Verknüpfung.
--
-- Der Betreiber schließt über `kanal_abschliessen` (0127) ab, als Person, die die App über `discord_login` findet. Der Melder ist keine Person der
-- App: Für ihn gibt es diese eine Funktion, die nur SEINE Meldung aus Discord schließt, aus jedem offenen Status, auch `zu_sichten`. Sie endet wie
-- ein „erledigt“ des Betreibers (`abgenommen`, `abschluss = 'erledigt'`), ohne Person, und schreibt einen Statuseintrag „aus Discord“ in den Verlauf.
--
-- 🔴 ERWEITERND: eine Spalte mit Vorgabe (`eintrag.von_discord`), ein CHECK geweitet (`eintrag_von` lässt zusätzlich einen Eintrag aus Discord ohne
-- Person und Agent zu), eine neue Funktion. Das vorige Release schreibt `von_discord` nie und erfüllt den geweiteten CHECK wie bisher. EXECUTE vergibt
-- `kanal-grants.psql` an die App-Rolle.

ALTER TABLE avesmaps_kanal.eintrag ADD COLUMN IF NOT EXISTS von_discord BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN avesmaps_kanal.eintrag.von_discord IS
    'Der Eintrag kam vom Melder aus Discord (0260, /erledigt); dann ohne Person und ohne Agent. Wer es war, sagt melder_name am Vorgang.';

ALTER TABLE avesmaps_kanal.eintrag DROP CONSTRAINT IF EXISTS eintrag_von;
ALTER TABLE avesmaps_kanal.eintrag ADD CONSTRAINT eintrag_von CHECK (
    ((von_person IS NULL) <> (von_agent IS NULL) AND NOT von_discord)
    OR (von_discord AND von_person IS NULL AND von_agent IS NULL)
);

-- Der Melder schließt seine Meldung aus Discord selbst. Antwort statt Fehler, damit die App einen Satz wählen kann, ohne etwas preiszugeben:
--   `erledigt`     geschlossen (oder dieselbe Operation schon einmal)
--   `geschlossen`  war schon abgeschlossen, abgelehnt oder beantwortet
--   `fremd`        gibt es nicht, nicht in dieser Umgebung, nicht aus Discord, abgelaufen oder von jemand anderem gemeldet
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_discord_zurueckziehen(
    p_operation UUID, p_environment TEXT, p_vorgang BIGINT, p_melder_kennung TEXT
) RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_kanal.vorgang;
    v_seq INTEGER;
BEGIN
    IF p_melder_kennung IS NULL OR p_melder_kennung !~ '^[0-9]{17,20}$' THEN
        RETURN 'fremd';
    END IF;
    IF avesmaps_kanal._schon(p_operation) THEN
        RETURN 'erledigt';
    END IF;
    SELECT * INTO v FROM avesmaps_kanal.vorgang WHERE id = p_vorgang FOR UPDATE;
    IF NOT FOUND OR v.environment <> p_environment OR v.quelle <> 'discord' OR v.abgelaufen_at IS NOT NULL
       OR v.melder_kennung IS DISTINCT FROM p_melder_kennung THEN
        RETURN 'fremd';
    END IF;
    IF v.status IN ('abgenommen', 'abgelehnt', 'beantwortet') THEN
        RETURN 'geschlossen';
    END IF;
    UPDATE avesmaps_kanal.vorgang SET status = 'abgenommen', abschluss = 'erledigt', abgenommen_von = NULL, abgenommen_at = now(),
        lease_agent = NULL, lease_bis = NULL WHERE id = p_vorgang;
    SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM avesmaps_kanal.eintrag WHERE vorgang_id = p_vorgang;
    INSERT INTO avesmaps_kanal.eintrag (vorgang_id, seq, art, von_discord, text, status_von, status_nach, operation_id)
    VALUES (p_vorgang, v_seq, 'status', true, 'In Discord zurückgezogen (/erledigt).', v.status, 'abgenommen', p_operation);
    UPDATE avesmaps_kanal.vorgang SET revision = revision + 1 WHERE id = p_vorgang;
    RETURN 'erledigt';
END;
$$;

REVOKE ALL ON FUNCTION avesmaps_kanal.kanal_discord_zurueckziehen(UUID, TEXT, BIGINT, TEXT) FROM PUBLIC;
