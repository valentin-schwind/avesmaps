-- 0339: Meldungen an Sonderrollen (WI-0279; Vali 2026-11-10/11, Entwurf „Meldungen an Rollen“ Fassung 3: „das alles bauen“). Eine Meldung hat neben der EINEN
-- zuständigen Person (`vorgang.zustaendig`) eine oder mehrere Sonderrollen; beim Eingang setzt der Server die passenden selbst (`community_rollen_eingang`), sonst setzt
-- jemand die ganze Menge (`community_rollen`).
--
-- 1. `vorgang_rolle`: je Vorgang und Rolle eine Zeile mit Absender (`person` oder `system` = Avesmaps beim Eingang) und Zeit. Die Rollen selbst stehen im Katalog
--    (`packages/shared/src/auth/sonderrollen.ts`), nicht als CHECK: Eine neue Rolle braucht keine Migration (wie die Arten der Glocke seit 0118).
-- 2. `vorgang_region`: die Regionen (Ebene `derographisch`) an der Stelle der Meldung, festgehalten, sobald sie das erste Mal gebraucht werden (beim Eingang oder beim
--    ersten Zuweisen einer Rolle), die kleinste zuerst (`rang`). Für „Meine“ bei regionalen Rollen (Ortskundiger, Regionalkanzler), ohne in der Liste je Zeile
--    Punkt-in-Fläche zu rechnen. Bestandsmeldungen brauchen keine: Sie haben noch keine Rolle. Keine Kartendaten: Die Tafel liest Regionen, sie schreibt keine.
-- 3. `ereignis_art` kennt zwei Arten mehr: `rollen` (eine Person setzte die Menge; `alt` die herausgenommenen, `neu` die hinzugekommenen Rollen, je mit Komma) und
--    `rollen_eingang` (Avesmaps beim Eingang; `neu` die Rollen).
-- 4. `redact_person_community`: Konto auflösen nimmt den Absender auch aus `vorgang_rolle` (gleiche Argumentliste wie 0269).
--
-- 🔴 ERWEITERND: zwei neue Tafeln, zwei neue Funktionen, eine geweitete CHECK (nimmt zwei Wörter dazu, keines weg; das vorige Release schreibt keines davon), eine
-- Funktion mit derselben Signatur neu geschrieben (sie tut eine Zeile mehr). Das vorige Release liest die neuen Tafeln nie. SELECT und EXECUTE vergibt
-- `community-grants.psql` an die App-Rolle; bis dahin fällt die App auf den Stand ohne Rollen zurück (`community/rollen.ts`, `rollenLesbar`).

CREATE TABLE IF NOT EXISTS avesmaps_community.vorgang_rolle (
    vorgang_id BIGINT NOT NULL REFERENCES avesmaps_community.vorgang (id) ON DELETE CASCADE,
    sonderrolle TEXT NOT NULL,
    von_art TEXT NOT NULL,
    von_person UUID REFERENCES avesmaps_auth.person (id),
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vorgang_id, sonderrolle),
    CONSTRAINT vorgang_rolle_name CHECK (sonderrolle ~ '^[a-z_]{1,40}$'),
    CONSTRAINT vorgang_rolle_von_art CHECK (von_art IN ('person', 'system')),
    -- Eine Person darf nach einer Kontoauflösung fehlen; das System hat nie eine.
    CONSTRAINT vorgang_rolle_von CHECK (von_art = 'person' OR von_person IS NULL)
);
COMMENT ON TABLE avesmaps_community.vorgang_rolle IS
    'Sonderrollen einer Meldung (WI-0279): neben der einen zuständigen Person. Schreiben nur über community_rollen und community_rollen_eingang.';
CREATE INDEX IF NOT EXISTS vorgang_rolle_rolle ON avesmaps_community.vorgang_rolle (sonderrolle);

CREATE TABLE IF NOT EXISTS avesmaps_community.vorgang_region (
    vorgang_id BIGINT NOT NULL REFERENCES avesmaps_community.vorgang (id) ON DELETE CASCADE,
    region_public_id UUID NOT NULL,
    rang SMALLINT NOT NULL DEFAULT 0,
    PRIMARY KEY (vorgang_id, region_public_id),
    CONSTRAINT vorgang_region_rang CHECK (rang BETWEEN 0 AND 99)
);
COMMENT ON TABLE avesmaps_community.vorgang_region IS
    'Regionen (derographisch) an der Stelle einer Meldung, die kleinste zuerst (WI-0279): fuer regionale Sonderrollen. Schreiben nur ueber community_rollen und community_rollen_eingang.';

ALTER TABLE avesmaps_community.ereignis DROP CONSTRAINT IF EXISTS ereignis_art;
ALTER TABLE avesmaps_community.ereignis ADD CONSTRAINT ereignis_art CHECK (art IN (
    'eingang', 'gesichtet', 'uebernommen', 'zustaendig', 'prioritaet', 'rueckfrage', 'antwort', 'abgeschlossen', 'wiedereroeffnet',
    'papierkorb', 'wiederhergestellt', 'archiviert', 'zurueckgezogen', 'personenbezug_geloescht', 'kontakt_abgelaufen',
    'rollen', 'rollen_eingang'
));

-- Hält die Regionen fest, wenn der Vorgang noch keine hat; die Reihenfolge der Liste ist der Rang (die kleinste Region zuerst).
CREATE OR REPLACE FUNCTION avesmaps_community._regionen_merken(p_id BIGINT, p_regionen UUID[]) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF COALESCE(cardinality(p_regionen), 0) = 0 OR cardinality(p_regionen) > 100
       OR EXISTS (SELECT 1 FROM avesmaps_community.vorgang_region WHERE vorgang_id = p_id) THEN
        RETURN;
    END IF;
    INSERT INTO avesmaps_community.vorgang_region (vorgang_id, region_public_id, rang)
    SELECT p_id, r.region, min(r.n - 1)::smallint
      FROM unnest(p_regionen) WITH ORDINALITY AS r(region, n)
     WHERE r.region IS NOT NULL
     GROUP BY r.region
    ON CONFLICT DO NOTHING;
END;
$$;

-- Prüft die Wörter einer Liste von Rollen (der Katalog steht in der App; hier nur die Form) und gibt sie ohne Doppelte, geordnet zurück.
CREATE OR REPLACE FUNCTION avesmaps_community._rollen_pruefen(p_rollen TEXT[]) RETURNS TEXT[]
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF COALESCE(cardinality(p_rollen), 0) > 40 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: zu viele Sonderrollen');
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_rollen, '{}'::text[])) r WHERE r IS NULL OR r !~ '^[a-z_]{1,40}$') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: unbekannte Sonderrolle');
    END IF;
    RETURN ARRAY(SELECT DISTINCT r FROM unnest(COALESCE(p_rollen, '{}'::text[])) r ORDER BY r);
END;
$$;

-- Eine Person setzt die ganze Menge der Rollen einer Meldung (hinzu und heraus) mit Revision und Kennung der Handlung, wie `community_zustaendig`. Ein Ereignis `rollen`,
-- wenn sich etwas ändert; sonst bleibt die Revision. Gibt `{revision, hinzu, heraus}` zurück (die Glocke geht an die Inhaber von `hinzu`); eine Wiederholung derselben
-- Kennung ändert nichts und meldet leere Listen. `p_regionen`: die Regionen an der Stelle, festgehalten, wenn der Vorgang noch keine hat.
CREATE OR REPLACE FUNCTION avesmaps_community.community_rollen(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_rollen TEXT[], p_regionen UUID[]
) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
    v_rollen TEXT[];
    v_hinzu TEXT[];
    v_heraus TEXT[];
    v_revision INTEGER;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN jsonb_build_object(
            'revision', (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id), 'hinzu', '[]'::jsonb, 'heraus', '[]'::jsonb
        );
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    IF v.art <> 'meldung' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: Sonderrollen gibt es nur an Meldungen');
    END IF;
    v_rollen := avesmaps_community._rollen_pruefen(p_rollen);
    v_hinzu := ARRAY(
        SELECT r FROM unnest(v_rollen) r
         WHERE NOT EXISTS (SELECT 1 FROM avesmaps_community.vorgang_rolle x WHERE x.vorgang_id = p_id AND x.sonderrolle = r)
         ORDER BY r
    );
    v_heraus := ARRAY(
        SELECT x.sonderrolle FROM avesmaps_community.vorgang_rolle x
         WHERE x.vorgang_id = p_id AND NOT (x.sonderrolle = ANY(v_rollen))
         ORDER BY x.sonderrolle
    );
    IF cardinality(v_hinzu) = 0 AND cardinality(v_heraus) = 0 THEN
        RETURN jsonb_build_object('revision', v.revision, 'hinzu', '[]'::jsonb, 'heraus', '[]'::jsonb);
    END IF;
    DELETE FROM avesmaps_community.vorgang_rolle WHERE vorgang_id = p_id AND sonderrolle = ANY(v_heraus);
    INSERT INTO avesmaps_community.vorgang_rolle (vorgang_id, sonderrolle, von_art, von_person)
    SELECT p_id, r, 'person', p_person FROM unnest(v_hinzu) r;
    IF cardinality(v_hinzu) > 0 THEN
        PERFORM avesmaps_community._regionen_merken(p_id, p_regionen);
    END IF;
    v_revision := avesmaps_community._ereignis(
        p_id, 'rollen', p_person, false, NULLIF(array_to_string(v_heraus, ','), ''), NULLIF(array_to_string(v_hinzu, ','), ''), NULL, p_operation
    );
    RETURN jsonb_build_object('revision', v_revision, 'hinzu', to_jsonb(v_hinzu), 'heraus', to_jsonb(v_heraus));
END;
$$;

-- Avesmaps setzt beim Eingang die Rollen, die passen und die jemand hat (das rechnet die App), und hält die Regionen fest. 🔴 Nur in der Transaktion, die die Meldung
-- anlegt (`eingegangen_at = now()`) und nur, solange sie keine Rolle hat: Eine Wiederholung derselben Meldung setzt nichts zweites, und niemand setzt so später Rollen am
-- Verlauf vorbei. Gibt die gesetzten Rollen zurück.
CREATE OR REPLACE FUNCTION avesmaps_community.community_rollen_eingang(p_id BIGINT, p_rollen TEXT[], p_regionen UUID[]) RETURNS TEXT[]
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
    v_rollen TEXT[];
BEGIN
    v := avesmaps_community._sperre(p_id);
    IF v.art <> 'meldung' OR v.eingegangen_at <> now()
       OR EXISTS (SELECT 1 FROM avesmaps_community.vorgang_rolle WHERE vorgang_id = p_id) THEN
        RETURN '{}'::text[];
    END IF;
    v_rollen := avesmaps_community._rollen_pruefen(p_rollen);
    PERFORM avesmaps_community._regionen_merken(p_id, p_regionen);
    IF cardinality(v_rollen) = 0 THEN
        RETURN v_rollen;
    END IF;
    INSERT INTO avesmaps_community.vorgang_rolle (vorgang_id, sonderrolle, von_art, von_person)
    SELECT p_id, r, 'system', NULL FROM unnest(v_rollen) r;
    PERFORM avesmaps_community._ereignis(p_id, 'rollen_eingang', NULL, false, NULL, array_to_string(v_rollen, ','), NULL, NULL);
    RETURN v_rollen;
END;
$$;

-- Konto auflösen (WI-0120 A15): wie 0269, dazu der Absender einer Rolle. Gleiche Argumentliste wie in 0265, 0266 und 0269.
CREATE OR REPLACE FUNCTION avesmaps_community.redact_person_community(p_person UUID) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_n INTEGER;
    v_summe INTEGER := 0;
BEGIN
    UPDATE avesmaps_community.vorgang SET zustaendig = NULL WHERE zustaendig = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.vorgang SET angelegt_von = NULL WHERE angelegt_von = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.melder SET person_id = NULL WHERE person_id = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.nachricht SET von_person = NULL WHERE von_person = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.notiz SET von_person = NULL WHERE von_person = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.verknuepfung SET von_person = NULL WHERE von_person = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.ereignis SET von_person = NULL WHERE von_person = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.bewertung_ereignis SET von_person = NULL WHERE von_person = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.beitrag SET verfasser = NULL WHERE verfasser = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.beitrag_ereignis SET von_person = NULL WHERE von_person = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.vorgang_rolle SET von_person = NULL WHERE von_person = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    RETURN v_summe;
END;
$$;

REVOKE ALL ON FUNCTION avesmaps_community._regionen_merken(BIGINT, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION avesmaps_community._rollen_pruefen(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION avesmaps_community.community_rollen(UUID, BIGINT, UUID, INTEGER, TEXT[], UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION avesmaps_community.community_rollen_eingang(BIGINT, TEXT[], UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION avesmaps_community.redact_person_community(UUID) FROM PUBLIC;
