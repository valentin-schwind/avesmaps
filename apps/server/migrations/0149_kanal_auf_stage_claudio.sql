-- 0149: Den Nachweis „auf Stage“ darf auch Claudio setzen (WI-0124; Betreiber 2026-10-17 auf „Darf Claudio den Nachweis
-- „auf Stage“ im Kanal selbst setzen?“: Knopf „Ja, Claudio darf das“, Zeile in `project-control/state/entscheidungen.md`).
--
-- Anlass: OPS-000014, -000016 und -000018 warteten Stunden, weil die Stage-Kennung nur Claudio sieht, den Nachweis aber nur
-- die zuständige Agentin setzen durfte (`2026-10-17-ops-000016-release-fuer-auf-stage-an-claudia.md`).
--
-- 🔴 REIN ADDITIV: dieselbe Funktion wie 0123, gleiche Signatur, eine Bedingung mehr erlaubt. Alles andere bleibt: Claudio setzt
--    weiter keinen „Fix committed“ für einen Vorgang, der bei Claudia liegt, und keine Station der Nachprüfung oder Abnahme.
--    Das vorige Release ruft dieselbe Funktion und merkt den Unterschied nicht.

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
    -- 🔴 „auf Stage“ darf auch Claudio setzen, gleich wem der Vorgang gehört: eine reine Betriebsangabe (Betreiber 2026-10-17).
    IF NOT (v.zustaendig = v_agent OR v_agent = 'claudia' OR (p_station = 'auf_stage' AND v_agent = 'claudio')) THEN
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
