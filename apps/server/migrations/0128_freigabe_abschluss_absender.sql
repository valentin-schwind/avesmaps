-- 0128: kanal_freigabe_abschluss schreibt seinen Statuseintrag mit Absender (Befund Claudio 2026-10-14, Freigabe OPS-000006).
--
-- 0123 rief _eintrag(..., p_person NULL, p_agent NULL, ...). Die Tafel verlangt genau einen Absender
-- (CONSTRAINT eintrag_von: (von_person IS NULL) <> (von_agent IS NULL)); die Funktion brach mit 23514 ab, die Transaktion
-- rollte zurueck und der Freigabe-Vorgang blieb in_arbeit -- damit sperrte er jede weitere Freigabe („Es laeuft schon eine Freigabe“).
-- Fix: Absender ist der Agent (v_agent), wie in kanal_status. Sonst unveraendert (CREATE OR REPLACE, EXECUTE bleibt).

CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_freigabe_abschluss(
    p_operation UUID, p_vorgang BIGINT, p_als TEXT DEFAULT NULL
) RETURNS BOOLEAN
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_agent TEXT := avesmaps_kanal._agent(p_als);
    v avesmaps_kanal.vorgang;
BEGIN
    v := avesmaps_kanal._sperre(p_vorgang);
    IF v.art <> 'freigabe' THEN
        PERFORM avesmaps_kanal._fehler('KA403', 'kanal_forbidden: das ist keine Production-Freigabe');
    END IF;
    IF v_agent <> 'claudio' THEN
        PERFORM avesmaps_kanal._fehler('KA403', 'kanal_forbidden: eine Freigabe schließt nur Claudio ab');
    END IF;
    IF v.status = 'abgenommen' THEN
        RETURN false;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM avesmaps_kanal.nachweis n
         WHERE n.vorgang_id = p_vorgang AND n.station IN ('production_live', 'production_zurueck')
    ) THEN
        PERFORM avesmaps_kanal._fehler('KA409',
            'kanal_transition: ohne Nachweis production_live oder production_zurueck gibt es keinen Abschluss');
    END IF;
    UPDATE avesmaps_kanal.vorgang
       SET status = 'abgenommen', abgenommen_von = gemeldet_von, abgenommen_at = now(), lease_agent = NULL, lease_bis = NULL
     WHERE id = p_vorgang;
    PERFORM avesmaps_kanal._eintrag(p_vorgang, 'status', NULL, v_agent, NULL, v.status, 'abgenommen', NULL, p_operation);
    RETURN true;
END;
$$;
