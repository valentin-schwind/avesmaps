-- 0332: Kanal-Sichtung „An Community weiterleiten“ (WI-0297; Vali 2026-11-09 zu OPS-000097: „ist eigentlich eine communitymeldung und kein vorgang, der
-- an claudio oder claudia gehen sollte“). Handover `project-control/handovers/2026-11-09-kanal-an-community-weiterleiten-an-claudia.md`.
--
-- Der Kanal lebt auf der Stage, die Redaktion arbeitet in Production (Community-Fachkonzept §10.3). Die App der Stage schickt den Vorgang über die
-- vorhandene Brücke (WI-0268 C8, Dienstschlüssel) nach Production; dort legt `community_aus_discord` eine Anfrage an. Erst mit der COM-Nummer von dort
-- endet der Kanalvorgang hier (`kanal_an_community`). Beide Hälften stehen in dieser Migration, weil jede Umgebung dasselbe Release trägt.
--
-- KANAL (Stage):
--   - `abschluss` kennt zusätzlich `an_community` (0127: Woran ein Vorgang endete, steht dort, nicht im Status; jeder Filter auf `abgenommen` gilt also
--     von selbst: keine Abholung, Reiter „Archiv“, Aufbewahrung 90 Tage). Neue Spalte `community` mit der COM-Nummer, nur an solchen Vorgängen.
--   - 🔴 Verdeckt für die Agenten wie „zu sichten“: `kanal_lesen` gibt weder Titel noch Text, Melder, Verlauf noch die COM-Nummer heraus; die Auslöser
--     weisen jeden Eintrag, Nachweis und Fix-Bericht eines Agenten und jeden Statuswechsel aus `an_community` ab (auch „wieder öffnen“).
-- COMMUNITY (Production):
--   - `community_aus_discord`: eine Anfrage mit Eingang `discord`, Melder mit Discord-Kennung und Anzeigename (Rückweg `discord`: `/offen`, `/erledigt`),
--     Nachricht mit Weg `discord`, Bilder als Anhänge dieser Nachricht (Dateien in der Ablage `COMMUNITY_MAIL_ABLAGE`), Verknüpfung `herkunft` auf die
--     OPS-Nummer. Dieselbe Operation zweimal gibt denselben Vorgang zurück.
--
-- 🔴 ERWEITERND: eine nullable Spalte, ein CHECK geweitet (`vorgang_abschluss`), ein neuer CHECK, den das vorige Release nicht verletzen kann (es schreibt
-- weder `an_community` noch `community`), zwei neue Funktionen, `kanal_lesen` und zwei Auslöserfunktionen mit derselben Signatur neu geschrieben, ein neuer
-- Auslöser an `aenderung`. EXECUTE vergeben `kanal-grants.psql` und `community-grants.psql` an die App-Rolle, die Agentenrollen bekommen nichts Neues.

-- 1. KANAL ------------------------------------------------------------------------------------------------------------------------------------------

ALTER TABLE avesmaps_kanal.vorgang
    ADD COLUMN IF NOT EXISTS community TEXT
        CONSTRAINT vorgang_community CHECK (community IS NULL OR community ~ '^COM-[0-9]{6,12}$');
COMMENT ON COLUMN avesmaps_kanal.vorgang.community IS
    'Die COM-Nummer in Production, an die der Vorgang weitergeleitet wurde (WI-0297); nur mit abschluss = an_community. Den Agenten nie gezeigt.';

ALTER TABLE avesmaps_kanal.vorgang DROP CONSTRAINT IF EXISTS vorgang_abschluss;
ALTER TABLE avesmaps_kanal.vorgang ADD CONSTRAINT vorgang_abschluss
    CHECK (abschluss IS NULL OR abschluss IN ('abnahme', 'erledigt', 'abgebrochen', 'an_community'));
ALTER TABLE avesmaps_kanal.vorgang DROP CONSTRAINT IF EXISTS vorgang_an_community;
ALTER TABLE avesmaps_kanal.vorgang ADD CONSTRAINT vorgang_an_community CHECK (
    (abschluss IS NOT DISTINCT FROM 'an_community') = (community IS NOT NULL)
    AND (abschluss IS DISTINCT FROM 'an_community' OR status = 'abgenommen')
);

-- Ein Betreiber leitet einen Vorgang aus Discord an die Community weiter (die App hat Person und Recht geprüft und von Production die COM-Nummer
-- bekommen): `zu_sichten` → `abgenommen` mit Abschluss `an_community`. Dieselbe Nummer noch einmal (eine Wiederholung mit neuer Operation) ist nichts.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_an_community(
    p_operation UUID, p_vorgang BIGINT, p_person UUID, p_revision INTEGER, p_community TEXT
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_kanal.vorgang;
BEGIN
    IF avesmaps_kanal._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
    END IF;
    IF p_person IS NULL THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: weiterleiten braucht die Person');
    END IF;
    IF p_community IS NULL OR p_community !~ '^COM-[0-9]{6,12}$' THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: weitergeleitet wird an eine COM-Nummer');
    END IF;
    v := avesmaps_kanal._sperre(p_vorgang);
    IF v.abschluss = 'an_community' AND v.community = p_community THEN
        RETURN v.revision;
    END IF;
    IF v.revision <> p_revision THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_conflict: der Vorgang hat sich inzwischen geändert');
    END IF;
    IF v.status <> 'zu_sichten' OR v.quelle <> 'discord' THEN
        PERFORM avesmaps_kanal._fehler('KA409', format('kanal_transition: weiterleiten geht nur aus „zu sichten“, nicht aus %s', v.status));
    END IF;
    UPDATE avesmaps_kanal.vorgang SET status = 'abgenommen', abschluss = 'an_community', community = p_community, abgenommen_von = p_person,
        abgenommen_at = now(), lease_agent = NULL, lease_bis = NULL
     WHERE id = p_vorgang;
    PERFORM avesmaps_kanal._eintrag(p_vorgang, 'status', p_person, NULL, p_community, 'zu_sichten', 'abgenommen', NULL, p_operation);
    RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
END;
$$;

-- Die Sperre in der Datenbank wie 0231, dazu: Was an die Community ging, bleibt dort; kein Weg führt zurück zu den Agenten.
CREATE OR REPLACE FUNCTION avesmaps_kanal._zu_sichten_vorgang() RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF OLD.status = 'zu_sichten' AND NEW.status NOT IN ('zu_sichten', 'neu', 'abgenommen') THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: der Vorgang ist noch zu sichten');
    END IF;
    IF NEW.status = 'zu_sichten' AND NEW.lease_agent IS NOT NULL THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: der Vorgang ist noch zu sichten');
    END IF;
    IF OLD.abschluss = 'an_community'
       AND (NEW.status <> 'abgenommen' OR NEW.abschluss IS DISTINCT FROM 'an_community' OR NEW.community IS DISTINCT FROM OLD.community) THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: der Vorgang ist an die Community weitergeleitet');
    END IF;
    IF NEW.abschluss = 'an_community' AND NEW.lease_agent IS NOT NULL THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: der Vorgang ist an die Community weitergeleitet');
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION avesmaps_kanal._zu_sichten_agent() RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_status TEXT;
    v_abschluss TEXT;
BEGIN
    IF NEW.von_agent IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT v.status, v.abschluss INTO v_status, v_abschluss FROM avesmaps_kanal.vorgang v WHERE v.id = NEW.vorgang_id;
    IF v_status = 'zu_sichten' THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: der Vorgang ist noch zu sichten');
    END IF;
    IF v_abschluss = 'an_community' THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: der Vorgang ist an die Community weitergeleitet');
    END IF;
    RETURN NEW;
END;
$$;

-- Ein Fix-Bericht ist immer von einem Agenten (`aenderung.agent`); an einem verdeckten Vorgang gibt es keinen.
CREATE OR REPLACE FUNCTION avesmaps_kanal._zu_sichten_aenderung() RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.vorgang_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM avesmaps_kanal.vorgang v
         WHERE v.id = NEW.vorgang_id AND (v.status = 'zu_sichten' OR v.abschluss IS NOT DISTINCT FROM 'an_community')
    ) THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: an diesem Vorgang gibt es keinen Fix-Bericht');
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS zu_sichten ON avesmaps_kanal.aenderung;
CREATE TRIGGER zu_sichten BEFORE INSERT ON avesmaps_kanal.aenderung
    FOR EACH ROW EXECUTE FUNCTION avesmaps_kanal._zu_sichten_aenderung();

-- Lesen wie 0231, dazu: Was an die Community ging, liest kein Agent, und die COM-Nummer steht nie im Kopf.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_lesen(p_vorgang BIGINT, p_als TEXT DEFAULT NULL) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_agent TEXT := avesmaps_kanal._agent(p_als);
    v avesmaps_kanal.vorgang;
    v_kopf JSONB;
BEGIN
    SELECT * INTO v FROM avesmaps_kanal.vorgang WHERE id = p_vorgang;
    IF NOT FOUND THEN
        PERFORM avesmaps_kanal._fehler('KA404', format('kanal_not_found: OPS-%s', lpad(p_vorgang::text, 6, '0')));
    END IF;
    v_kopf := to_jsonb(v) - 'operation_id' - 'gemeldet_von' - 'abgenommen_von' - 'melder_name' - 'melder_kennung' - 'community';
    IF v.status = 'zu_sichten' OR v.abschluss IS NOT DISTINCT FROM 'an_community' THEN
        -- 🔴 Nicht vertrauenswürdig (zu sichten) oder nicht für die Agenten (an die Community): kein Satz davon in den Prompt einer Routine.
        RETURN jsonb_build_object(
            'agent', v_agent,
            'zuSichten', v.status = 'zu_sichten',
            'anCommunity', v.abschluss IS NOT DISTINCT FROM 'an_community',
            'vorgang', v_kopf || jsonb_build_object('titel', NULL, 'kurztitel', NULL, 'nachricht', NULL, 'schritte', NULL, 'kontext', '{}'::jsonb),
            'gemeldetVon', 'Discord',
            'eintraege', '[]'::jsonb, 'nachweise', '[]'::jsonb, 'aenderungen', '[]'::jsonb, 'bilder', '[]'::jsonb
        );
    END IF;
    RETURN jsonb_build_object(
        'agent', v_agent,
        'vorgang', v_kopf,
        'gemeldetVon', CASE
            WHEN v.quelle = 'discord' THEN 'Discord · ' || COALESCE(v.melder_name, '—')
            ELSE (SELECT p.display_name FROM avesmaps_auth.person p WHERE p.id = v.gemeldet_von)
        END,
        'eintraege', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'seq', e.seq, 'art', e.art, 'von', COALESCE(e.von_agent, (SELECT p.display_name FROM avesmaps_auth.person p WHERE p.id = e.von_person)),
                'text', e.text, 'statusVon', e.status_von, 'statusNach', e.status_nach, 'bild', e.bild_id, 'at', e.at
            ) ORDER BY e.seq) FROM avesmaps_kanal.eintrag e WHERE e.vorgang_id = v.id), '[]'::jsonb),
        'nachweise', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'runde', n.runde, 'station', n.station, 'commit', n.commit_sha, 'release', n.release, 'notiz', n.notiz, 'at', n.at
            ) ORDER BY n.id) FROM avesmaps_kanal.nachweis n WHERE n.vorgang_id = v.id), '[]'::jsonb),
        'aenderungen', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', a.id, 'runde', a.runde, 'agent', a.agent, 'klasse', a.klasse, 'art', a.art, 'was', a.was, 'commit', a.commit_sha,
                'release', a.release, 'nachpruefung', a.nachpruefung
            ) ORDER BY a.id) FROM avesmaps_kanal.aenderung a WHERE a.vorgang_id = v.id), '[]'::jsonb),
        'bilder', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', b.id, 'zustand', b.zustand, 'format', b.format, 'breite', b.breite, 'hoehe', b.hoehe)
                   ORDER BY b.at)
              FROM avesmaps_kanal.bild b WHERE b.vorgang_id = v.id AND b.entfernen_ab IS NULL), '[]'::jsonb)
    );
END;
$$;

REVOKE ALL ON FUNCTION avesmaps_kanal.kanal_an_community(UUID, BIGINT, UUID, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION avesmaps_kanal._zu_sichten_aenderung() FROM PUBLIC;

-- 2. COMMUNITY ----------------------------------------------------------------------------------------------------------------------------------------

-- Eine Meldung aus dem Betreiber-Kanal der Stage, weitergeleitet über die Brücke (die App hat die Signatur geprüft und die Bilder in die Ablage gelegt).
-- `p_bilder` ist eine Liste von `{ "datei": <SHA-256>, "name": <Dateiname>, "mime": "image/webp", "groesse": <Bytes> }`.
CREATE OR REPLACE FUNCTION avesmaps_community.community_aus_discord(
    p_operation UUID, p_kategorie TEXT, p_text TEXT, p_name TEXT, p_discord_id TEXT, p_ops TEXT, p_bilder JSONB
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_nachricht BIGINT;
    v_name TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
    v_bilder JSONB := COALESCE(p_bilder, '[]'::jsonb);
    b JSONB;
BEGIN
    SELECT id INTO v_id FROM avesmaps_community.vorgang WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF p_kategorie IS NULL OR p_kategorie NOT IN ('problem', 'hinweis', 'frage') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: aus Discord kommen Problem, Hinweis und Frage');
    END IF;
    IF char_length(btrim(COALESCE(p_text, ''))) NOT BETWEEN 1 AND 4000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Nachricht braucht 1 bis 4000 Zeichen');
    END IF;
    IF v_name IS NOT NULL AND char_length(v_name) > 80 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Name darf höchstens 80 Zeichen lang sein');
    END IF;
    IF p_discord_id IS NOT NULL AND p_discord_id !~ '^[0-9]{17,20}$' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Discord-Kennung hat die falsche Form');
    END IF;
    IF p_ops IS NULL OR p_ops !~ '^OPS-[0-9]{6,12}$' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Herkunft ist eine OPS-Nummer');
    END IF;
    IF jsonb_typeof(v_bilder) <> 'array' OR jsonb_array_length(v_bilder) > 10 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: höchstens zehn Bilder');
    END IF;
    INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, prioritaet, operation_id)
    VALUES ('anfrage', p_kategorie, 'discord', 'normal', p_operation)
    RETURNING id INTO v_id;
    -- Mit Kennung ist der Name der von Discord (wie „Mit Discord verbinden“); ohne Kennung bleibt er der Name des Melders.
    INSERT INTO avesmaps_community.melder (vorgang_id, name, discord_id, discord_name)
    VALUES (v_id, CASE WHEN p_discord_id IS NULL THEN v_name END, p_discord_id, CASE WHEN p_discord_id IS NOT NULL THEN v_name END);
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, operation_id)
    VALUES (v_id, 'ein', 'discord', btrim(p_text), gen_random_uuid())
    RETURNING id INTO v_nachricht;
    FOR b IN SELECT value FROM jsonb_array_elements(v_bilder) LOOP
        INSERT INTO avesmaps_community.mail_anhang (nachricht_id, dateiname, mime, groesse, datei)
        VALUES (v_nachricht, b ->> 'name', b ->> 'mime', (b ->> 'groesse')::bigint, b ->> 'datei');
    END LOOP;
    INSERT INTO avesmaps_community.verknuepfung (vorgang_id, art, ziel) VALUES (v_id, 'herkunft', p_ops);
    PERFORM avesmaps_community._ereignis(v_id, 'eingang', NULL, true, NULL, 'neu', p_ops, NULL);
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION avesmaps_community.community_aus_discord(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
