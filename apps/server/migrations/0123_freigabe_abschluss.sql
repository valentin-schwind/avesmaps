-- 0123: Der Agent schließt eine Freigabe selbst ab (FREIGABE-0001 Stufe 1; Claudios Bitte vom 2026-10-13,
-- `2026-10-13-freigabe-abholer-gebaut-an-claudia.md` §2).
--
-- Drei Dinge, alle auf `art = 'freigabe'` begrenzt:
--   1 `kanal_nachweis` lässt für eine Freigabe auch `production_live` und `production_zurueck` zu — aber NUR dem Agenten
--     `claudio`, nur bei dieser Art, und nur mit Release.
--   2 Danach darf derselbe Agent den Vorgang abschließen (`kanal_freigabe_abschluss`). Abgenommen hat, wer freigegeben hat:
--     `abgenommen_von` wird `gemeldet_von` — der Betreiber, der den Passkey gedrückt hat. Der Agent bestätigt nur, dass es
--     getan ist.
--   3 `kanal_abholen` übergeht Freigabe-Vorgänge. Sonst legte die Kanal-Routine eine Lease von 45 Minuten darauf und der
--     Abholer käme nicht an seinen eigenen Auftrag.
--
-- 🔴 REIN ADDITIV: Zwei Funktionen werden ersetzt (gleiche Signatur, mehr erlaubt), eine kommt dazu. Das vorige Release
--    schreibt die neuen Stationen nie und kennt die Art `freigabe` nicht; für es ändert sich nichts.

-- 1 Nachweise: zwei Stationen mehr, eng gebunden.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_nachweis(
    p_operation UUID, p_vorgang BIGINT, p_station TEXT, p_commit TEXT, p_release TEXT, p_notiz TEXT, p_als TEXT DEFAULT NULL
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_agent TEXT := avesmaps_kanal._agent(p_als);
    v avesmaps_kanal.vorgang;
    v_id BIGINT;
BEGIN
    SELECT id INTO v_id FROM avesmaps_kanal.nachweis WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    v := avesmaps_kanal._sperre(p_vorgang);
    -- 🔴 Die zwei Production-Stationen gibt es nur für eine Freigabe und nur für Claudio: Er ist der Einzige, der am
    --    Production-Korridor steht. Für jede andere Art bleibt es bei den zwei Stationen von 0106.
    IF p_station IN ('production_live', 'production_zurueck') THEN
        IF v.art <> 'freigabe' OR v_agent <> 'claudio' THEN
            PERFORM avesmaps_kanal._fehler('KA403',
                'kanal_forbidden: diese Station gibt es nur für eine Production-Freigabe und nur für Claudio');
        END IF;
        IF p_release IS NULL OR btrim(p_release) = '' THEN
            PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: diese Station braucht das Release');
        END IF;
    ELSIF p_station NOT IN ('fix_committed', 'auf_stage') THEN
        PERFORM avesmaps_kanal._fehler('KA403', 'kanal_forbidden: diese Station setzt nicht der Agent (Nachprüfung, Abnahme)');
    END IF;
    IF v.status IN ('zur_abnahme', 'abgenommen') THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: der Vorgang wartet auf die Abnahme oder ist abgenommen');
    END IF;
    IF NOT (v.zustaendig = v_agent OR v_agent = 'claudia') THEN
        PERFORM avesmaps_kanal._fehler('KA403', format('kanal_forbidden: zuständig ist %s', v.zustaendig));
    END IF;
    IF p_station = 'fix_committed' AND NOT EXISTS (
        SELECT 1 FROM avesmaps_kanal.aenderung a
         WHERE a.vorgang_id = p_vorgang AND a.runde = v.runde AND a.commit_sha = lower(p_commit)
    ) THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: „Fix committed“ braucht zuerst einen Eintrag im Fix-Bericht mit derselben SHA');
    END IF;
    INSERT INTO avesmaps_kanal.nachweis (vorgang_id, runde, station, commit_sha, release, notiz, von_agent, operation_id)
    VALUES (p_vorgang, v.runde, p_station, lower(nullif(btrim(coalesce(p_commit, '')), '')), nullif(btrim(coalesce(p_release, '')), ''),
            nullif(btrim(coalesce(p_notiz, '')), ''), v_agent, p_operation)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- 2 Der Abschluss einer Freigabe durch den Agenten.
--   🔴 `abgenommen_von` ist der Melder, nicht der Agent: Abgenommen hat, wer in der Systemsteuerung den Passkey gedrückt
--      hat. Der Agent stellt nur fest, dass es getan ist — und er kann es erst, wenn der Nachweis dasteht.
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
    PERFORM avesmaps_kanal._eintrag(p_vorgang, 'status', NULL, NULL, NULL, v.status, 'abgenommen', NULL, p_operation);
    RETURN true;
END;
$$;

-- 3 Der Agentenweg übergeht Freigaben: Sie gehören dem Abholer, nicht der Kanal-Routine.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_abholen(p_limit INTEGER, p_alle BOOLEAN DEFAULT false, p_als TEXT DEFAULT NULL)
    RETURNS TABLE (
        id BIGINT, art TEXT, kategorie TEXT, prioritaet TEXT, status TEXT, zustaendig TEXT, titel TEXT, gemeldet_at TIMESTAMPTZ,
        neues_vom_betreiber BOOLEAN
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_agent TEXT := avesmaps_kanal._agent(p_als);
    v_ids BIGINT[];
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: höchstens 50 auf einmal');
    END IF;
    UPDATE avesmaps_kanal.agent SET zuletzt_abgeholt = now() WHERE name = v_agent;
    SELECT array_agg(x.id) INTO v_ids FROM (
        SELECT v.id
          FROM avesmaps_kanal.vorgang v
         WHERE v.status NOT IN ('zur_abnahme', 'abgenommen')
           -- 🔴 Eine Freigabe holt der Abholer selbst (FREIGABE-0001): Eine Lease von 45 min der Kanal-Routine hielte ihn
           --    von seinem eigenen Auftrag fern.
           AND v.art <> 'freigabe'
           -- Eine laufende Lease (auch die eigene) hält den Vorgang aus der nächsten Runde heraus: zwei Routinen nehmen nie denselben.
           AND (v.lease_bis IS NULL OR v.lease_bis < now())
           AND (v.zustaendig = v_agent OR (v_agent = 'claudia' AND (v.status = 'bei_claudia' OR p_alle)))
           AND NOT (v_agent = 'claudio' AND v.status = 'bei_claudia')
         ORDER BY (v.kategorie IN ('stoerung', 'wiederherstellung')) DESC,
                  array_position(ARRAY['dringend', 'hoch', 'normal', 'niedrig'], v.prioritaet),
                  v.gemeldet_at, v.id
         LIMIT p_limit
           FOR UPDATE OF v SKIP LOCKED
    ) x;
    UPDATE avesmaps_kanal.vorgang v SET lease_agent = v_agent, lease_bis = now() + interval '45 minutes' WHERE v.id = ANY (v_ids);
    RETURN QUERY
    SELECT v.id, v.art, v.kategorie, v.prioritaet, v.status, v.zustaendig, v.titel, v.gemeldet_at,
           COALESCE((
               SELECT e.von_person IS NOT NULL FROM avesmaps_kanal.eintrag e WHERE e.vorgang_id = v.id ORDER BY e.seq DESC LIMIT 1
           ), true)
      FROM avesmaps_kanal.vorgang v
     WHERE v.id = ANY (v_ids)
     ORDER BY (v.kategorie IN ('stoerung', 'wiederherstellung')) DESC,
              array_position(ARRAY['dringend', 'hoch', 'normal', 'niedrig'], v.prioritaet), v.gemeldet_at, v.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION avesmaps_kanal.kanal_freigabe_abschluss(UUID, BIGINT, TEXT) FROM PUBLIC;
