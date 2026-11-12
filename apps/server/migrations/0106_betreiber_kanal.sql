-- Der Betreiber-Kanal (WI-0124, Bauplan project-control/planning/KANAL-0001-betreiber-kanal-bauplan.md §3 bis §6): Vorgänge mit OPS-ID,
-- Verlauf, Nachweise je Runde, Claudios und Claudias Änderungsprotokoll („Fix-Bericht“, dauerhaft), Bilder (privat, MAM-Ablage
-- `private/kanal/<bild-id>/`), Aufbewahrung (Meldung und Bilder 90 Tage nach der Abnahme oder früher nach Wunsch, Betreiber 2026-10-11).
--
-- Eigenes Schema `avesmaps_kanal`, damit die Agentenrollen nichts außerhalb sehen (global-review §10.5). Im Schema gibt es KEINE
-- Default-Privilegien; die Rechte stehen in `apps/server/src/db/kanal-grants.psql`:
-- - die App liest die Tafeln und schreibt NUR über die Funktionen der Betreiber (melden, Nachricht, abnehmen, wieder öffnen, löschen,
--   Bilder, Wiederherstellung). Die Übergänge prüft die Datenbank, nicht nur der Code.
-- - die Agentenrollen (`avesmaps3d_<env>_claudio`, `avesmaps3d_<env>_claudia`, legt Claudio an, sobald der Betreiber die Claudio-Seite
--   freigibt) rufen NUR die Funktionen der Agenten; kein Recht an einer Tafel. Der Akteur folgt aus der Rolle (`_agent`), ein Agent kann
--   sich nicht als der andere ausgeben. Lokal und im Test ist der Besitzer des Schemas die einzige Rolle; er nennt den Agenten ausdrücklich.
-- - die Jobs-Rolle ruft nur die Funktionen der Bilder und der Aufbewahrung.
-- Abnehmen und wieder öffnen kann kein Agent.
--
-- Fehler als eigene SQLSTATE der Klasse `KA` (die App bildet sie auf Fachcodes ab): KA404 nicht gefunden, KA409 Übergang oder Revision,
-- KA403 nicht erlaubt, KA422 ungültige Angabe.
--
-- `job_enqueue` um die Jobart `kanal_bild` (Rendern eines Bildes, K4): Argumentliste aus der AKTUELLEN Fassung (0104) abgeschrieben und nur
-- erweitert. Wer `job_enqueue` nach dieser Migration neu schreibt, nimmt `kanal_bild` mit.
--
-- 🔴 REIN ADDITIV: ein neues Schema, eine erweiterte Positivliste. Das vorige Release kennt das Schema nicht.

CREATE SCHEMA IF NOT EXISTS avesmaps_kanal;
COMMENT ON SCHEMA avesmaps_kanal IS 'Betreiber-Kanal (WI-0124, KANAL-0001): Vorgänge, Verlauf, Nachweise, Fix-Berichte, Bilder.';

CREATE TABLE IF NOT EXISTS avesmaps_kanal.vorgang (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    environment TEXT NOT NULL,
    art TEXT NOT NULL DEFAULT 'meldung',
    kategorie TEXT NOT NULL,
    prioritaet TEXT NOT NULL,
    titel TEXT,
    nachricht TEXT,
    schritte TEXT,
    -- Feste Liste, serverseitig gefüllt (Umgebung, Release, Kartendaten, Ansicht, Objekt, Modus, Gerät, Anfrage); nie ein Geheimnis.
    kontext JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'neu',
    zustaendig TEXT NOT NULL,
    runde SMALLINT NOT NULL DEFAULT 1,
    folgt_auf BIGINT REFERENCES avesmaps_kanal.vorgang (id),
    -- Vom Agenten spätestens bei `zur_abnahme`: neutral, ohne Namen, ohne Zitat; bleibt nach dem Ablauf (§3.1).
    kurztitel TEXT,
    gemeldet_von UUID REFERENCES avesmaps_auth.person (id),
    gemeldet_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    abgenommen_von UUID REFERENCES avesmaps_auth.person (id),
    abgenommen_at TIMESTAMPTZ,
    -- Gesetzt: Meldung auf ihren Rest geleert (nach 90 Tagen oder nach Wunsch).
    abgelaufen_at TIMESTAMPTZ,
    von_hand_geloescht BOOLEAN NOT NULL DEFAULT false,
    -- Abholen der Agenten: wer bearbeitet gerade (45 min), damit zwei Routinen nie denselben Vorgang nehmen.
    lease_agent TEXT,
    lease_bis TIMESTAMPTZ,
    revision INTEGER NOT NULL DEFAULT 1,
    operation_id UUID NOT NULL UNIQUE,
    CONSTRAINT vorgang_art CHECK (art IN ('meldung', 'wiederherstellung')),
    CONSTRAINT vorgang_kategorie CHECK (kategorie IN (
        'feinjustierung', 'bug', 'stoerung', 'editor_optimierung', 'performance', 'idee', 'umbau', 'karteninhalt', 'nutzerfrage',
        'wiederherstellung'
    )),
    CONSTRAINT vorgang_art_kategorie CHECK ((art = 'wiederherstellung') = (kategorie = 'wiederherstellung')),
    CONSTRAINT vorgang_prioritaet CHECK (prioritaet IN ('niedrig', 'normal', 'hoch', 'dringend')),
    CONSTRAINT vorgang_status CHECK (status IN (
        'neu', 'angenommen', 'in_arbeit', 'bei_claudia', 'auf_stage', 'beantwortet', 'abgelehnt', 'zur_abnahme', 'abgenommen'
    )),
    CONSTRAINT vorgang_zustaendig CHECK (zustaendig IN ('claudio', 'claudia', 'betreiber')),
    CONSTRAINT vorgang_titel CHECK (titel IS NULL OR char_length(titel) BETWEEN 1 AND 120),
    CONSTRAINT vorgang_nachricht CHECK (nachricht IS NULL OR char_length(nachricht) BETWEEN 1 AND 8000),
    CONSTRAINT vorgang_schritte CHECK (schritte IS NULL OR char_length(schritte) <= 4000),
    CONSTRAINT vorgang_kurztitel CHECK (kurztitel IS NULL OR char_length(kurztitel) BETWEEN 1 AND 80),
    -- Titel, Nachricht und Meldende fehlen nur nach dem Ablauf (der Rest, §3.1).
    CONSTRAINT vorgang_rest CHECK (abgelaufen_at IS NOT NULL OR (titel IS NOT NULL AND nachricht IS NOT NULL AND gemeldet_von IS NOT NULL)),
    CONSTRAINT vorgang_ablauf_nach_abnahme CHECK (abgelaufen_at IS NULL OR status = 'abgenommen'),
    CONSTRAINT vorgang_abnahme CHECK ((status = 'abgenommen') = (abgenommen_at IS NOT NULL)),
    CONSTRAINT vorgang_lease CHECK ((lease_agent IS NULL) = (lease_bis IS NULL) AND (lease_agent IS NULL OR lease_agent IN ('claudio', 'claudia'))),
    CONSTRAINT vorgang_runde CHECK (runde >= 1)
);
COMMENT ON TABLE avesmaps_kanal.vorgang IS 'Vorgänge des Betreiber-Kanals (WI-0124); die OPS-ID ist OPS- und die id mit sechs Stellen.';
CREATE INDEX IF NOT EXISTS vorgang_offen ON avesmaps_kanal.vorgang (status, zustaendig) WHERE status <> 'abgenommen';
CREATE INDEX IF NOT EXISTS vorgang_ablauf ON avesmaps_kanal.vorgang (abgenommen_at) WHERE abgelaufen_at IS NULL AND status = 'abgenommen';

CREATE TABLE IF NOT EXISTS avesmaps_kanal.eintrag (
    vorgang_id BIGINT NOT NULL REFERENCES avesmaps_kanal.vorgang (id),
    seq INTEGER NOT NULL,
    art TEXT NOT NULL,
    von_person UUID REFERENCES avesmaps_auth.person (id),
    von_agent TEXT,
    text TEXT,
    status_von TEXT,
    status_nach TEXT,
    bild_id UUID,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    operation_id UUID NOT NULL UNIQUE,
    PRIMARY KEY (vorgang_id, seq),
    CONSTRAINT eintrag_art CHECK (art IN ('nachricht', 'rueckfrage', 'antwort', 'befund', 'status', 'einstufung', 'bild', 'bild_entfernt')),
    CONSTRAINT eintrag_von CHECK ((von_person IS NULL) <> (von_agent IS NULL)),
    CONSTRAINT eintrag_agent CHECK (von_agent IS NULL OR von_agent IN ('claudio', 'claudia')),
    CONSTRAINT eintrag_text CHECK (text IS NULL OR char_length(text) BETWEEN 1 AND 8000)
);
COMMENT ON TABLE avesmaps_kanal.eintrag IS 'Verlauf eines Vorgangs, nur anhängen; geht mit dem Ablauf der Meldung (§3.1).';

CREATE TABLE IF NOT EXISTS avesmaps_kanal.nachweis (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vorgang_id BIGINT NOT NULL REFERENCES avesmaps_kanal.vorgang (id),
    runde SMALLINT NOT NULL,
    station TEXT NOT NULL,
    commit_sha TEXT,
    release TEXT,
    notiz TEXT,
    von_agent TEXT,
    von_person UUID REFERENCES avesmaps_auth.person (id),
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    operation_id UUID NOT NULL UNIQUE,
    CONSTRAINT nachweis_station CHECK (station IN ('fix_committed', 'auf_stage', 'claudia_nachgeprueft', 'betreiber_abnahme')),
    CONSTRAINT nachweis_commit CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{40}$'),
    CONSTRAINT nachweis_commit_pflicht CHECK (station <> 'fix_committed' OR commit_sha IS NOT NULL),
    CONSTRAINT nachweis_release CHECK (release IS NULL OR char_length(release) BETWEEN 1 AND 120),
    CONSTRAINT nachweis_release_pflicht CHECK (station <> 'auf_stage' OR release IS NOT NULL),
    CONSTRAINT nachweis_notiz CHECK (notiz IS NULL OR char_length(notiz) <= 500),
    CONSTRAINT nachweis_agent CHECK (von_agent IS NULL OR von_agent IN ('claudio', 'claudia'))
);
COMMENT ON TABLE avesmaps_kanal.nachweis IS 'Die vier Stationen je Runde (Betreiber 2026-10-10 „3A“); bleiben dauerhaft.';

CREATE TABLE IF NOT EXISTS avesmaps_kanal.aenderung (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vorgang_id BIGINT REFERENCES avesmaps_kanal.vorgang (id),
    runde SMALLINT,
    agent TEXT NOT NULL,
    klasse TEXT NOT NULL,
    art TEXT NOT NULL,
    was TEXT NOT NULL,
    grund TEXT,
    dateien TEXT[] NOT NULL DEFAULT '{}',
    commit_sha TEXT,
    release TEXT,
    tests TEXT,
    ruecknahme TEXT,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    operation_id UUID NOT NULL UNIQUE,
    nachgeprueft_at TIMESTAMPTZ,
    nachpruefung TEXT,
    nachpruefung_notiz TEXT,
    CONSTRAINT aenderung_agent CHECK (agent IN ('claudio', 'claudia')),
    CONSTRAINT aenderung_klasse CHECK (klasse IN ('A', 'B', 'C')),
    CONSTRAINT aenderung_art CHECK (art IN ('code', 'betrieb', 'diagnose')),
    CONSTRAINT aenderung_was CHECK (char_length(was) BETWEEN 1 AND 2000),
    CONSTRAINT aenderung_grund CHECK (grund IS NULL OR char_length(grund) BETWEEN 1 AND 1000),
    CONSTRAINT aenderung_ohne_vorgang CHECK (vorgang_id IS NOT NULL OR grund IS NOT NULL),
    CONSTRAINT aenderung_runde CHECK ((vorgang_id IS NULL) = (runde IS NULL)),
    CONSTRAINT aenderung_commit CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{40}$'),
    CONSTRAINT aenderung_code_commit CHECK (art <> 'code' OR commit_sha IS NOT NULL),
    CONSTRAINT aenderung_release CHECK (release IS NULL OR char_length(release) BETWEEN 1 AND 120),
    CONSTRAINT aenderung_tests CHECK (tests IS NULL OR char_length(tests) <= 1000),
    CONSTRAINT aenderung_ruecknahme CHECK (ruecknahme IS NULL OR char_length(ruecknahme) <= 1000),
    CONSTRAINT aenderung_nachpruefung CHECK (
        (nachgeprueft_at IS NULL AND nachpruefung IS NULL AND nachpruefung_notiz IS NULL)
        OR (nachgeprueft_at IS NOT NULL AND nachpruefung IN ('ok', 'nachbessern'))
    ),
    CONSTRAINT aenderung_notiz CHECK (nachpruefung_notiz IS NULL OR char_length(nachpruefung_notiz) <= 1000)
);
COMMENT ON TABLE avesmaps_kanal.aenderung IS
    'Fix-Bericht: jede Änderung von Claudio und Claudia (Arbeitsanweisung §4, Pflicht); dauerhaft, ohne Meldungstext, Bild oder Person.';

CREATE TABLE IF NOT EXISTS avesmaps_kanal.beobachtung (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    aenderung_id BIGINT NOT NULL REFERENCES avesmaps_kanal.aenderung (id),
    ergebnis TEXT NOT NULL,
    text TEXT,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    operation_id UUID NOT NULL UNIQUE,
    CONSTRAINT beobachtung_ergebnis CHECK (ergebnis IN ('unauffaellig', 'fehler', 'fallback', 'rollback', 'offen')),
    CONSTRAINT beobachtung_text CHECK (text IS NULL OR char_length(text) BETWEEN 1 AND 2000)
);
COMMENT ON TABLE avesmaps_kanal.beobachtung IS 'Was nach dem Ausrollen einer Änderung beobachtet wurde; nur nachtragen, nie überschreiben.';

CREATE TABLE IF NOT EXISTS avesmaps_kanal.bild (
    id UUID PRIMARY KEY,
    vorgang_id BIGINT NOT NULL REFERENCES avesmaps_kanal.vorgang (id),
    eintrag_seq INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    format TEXT NOT NULL,
    breite INTEGER NOT NULL,
    hoehe INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    zustand TEXT NOT NULL DEFAULT 'wird_vorbereitet',
    abgewiesen_grund TEXT,
    hochgeladen_von UUID REFERENCES avesmaps_auth.person (id),
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Gesetzt: die Dateien sind beim nächsten Lauf der Aufbewahrung zu löschen (Ablauf, „Bild entfernen“, „Meldung jetzt löschen“).
    entfernen_ab TIMESTAMPTZ,
    geloescht_at TIMESTAMPTZ,
    operation_id UUID NOT NULL UNIQUE,
    CONSTRAINT bild_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT bild_format CHECK (format IN ('png', 'jpeg', 'gif', 'webp')),
    CONSTRAINT bild_masse CHECK (breite BETWEEN 1 AND 8192 AND hoehe BETWEEN 1 AND 8192 AND bytes > 0),
    CONSTRAINT bild_zustand CHECK (zustand IN ('wird_vorbereitet', 'bereit', 'abgewiesen')),
    CONSTRAINT bild_grund CHECK (abgewiesen_grund IS NULL OR char_length(abgewiesen_grund) <= 200),
    CONSTRAINT bild_geloescht_nach_entfernen CHECK (geloescht_at IS NULL OR entfernen_ab IS NOT NULL)
);
COMMENT ON TABLE avesmaps_kanal.bild IS 'Bildschirmfotos eines Vorgangs, privat unter MEDIA_ROOT/private/kanal/<id>/ (B1, KANAL-0001 §6).';

CREATE TABLE IF NOT EXISTS avesmaps_kanal.agent (
    name TEXT PRIMARY KEY,
    zuletzt_abgeholt TIMESTAMPTZ,
    CONSTRAINT agent_name CHECK (name IN ('claudio', 'claudia'))
);
INSERT INTO avesmaps_kanal.agent (name) VALUES ('claudio'), ('claudia') ON CONFLICT (name) DO NOTHING;

-- --- Hilfen (nur intern; kein EXECUTE für irgendeine Rolle) ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION avesmaps_kanal._fehler(p_code TEXT, p_text TEXT) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION '%', p_text USING ERRCODE = p_code;
END;
$$;

-- Der Agent aus der Rolle der Sitzung: `avesmaps3d_<env>_claudio` bzw. `_claudia`. Der Besitzer des Schemas (lokal, im Test, die
-- Migrationsrolle) nennt ihn ausdrücklich; jede andere Rolle ist kein Agent.
CREATE OR REPLACE FUNCTION avesmaps_kanal._agent(p_als TEXT) RETURNS TEXT
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_treffer TEXT[];
    v_besitzer TEXT;
BEGIN
    v_treffer := regexp_match(session_user::text, '^avesmaps3d_[a-z0-9]+_(claudia|claudio)$');
    IF v_treffer IS NOT NULL THEN
        IF p_als IS NOT NULL AND p_als <> v_treffer[1] THEN
            PERFORM avesmaps_kanal._fehler('KA403', format('kanal_forbidden: die Rolle %s handelt nicht als %s', session_user, p_als));
        END IF;
        RETURN v_treffer[1];
    END IF;
    SELECT pg_get_userbyid(n.nspowner) INTO v_besitzer FROM pg_namespace n WHERE n.nspname = 'avesmaps_kanal';
    IF session_user::text = v_besitzer THEN
        IF p_als IN ('claudio', 'claudia') THEN
            RETURN p_als;
        END IF;
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: ohne Agentenrolle muss der Agent genannt sein (claudio oder claudia)');
    END IF;
    PERFORM avesmaps_kanal._fehler('KA403', format('kanal_forbidden: %s ist keine Agentenrolle', session_user));
    RETURN NULL;
END;
$$;

-- Den Vorgang sperren und lesen; nicht gefunden → KA404.
CREATE OR REPLACE FUNCTION avesmaps_kanal._sperre(p_id BIGINT) RETURNS avesmaps_kanal.vorgang
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_kanal.vorgang;
BEGIN
    SELECT * INTO v FROM avesmaps_kanal.vorgang WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM avesmaps_kanal._fehler('KA404', format('kanal_not_found: OPS-%s', lpad(p_id::text, 6, '0')));
    END IF;
    RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION avesmaps_kanal._eintrag(
    p_vorgang BIGINT, p_art TEXT, p_person UUID, p_agent TEXT, p_text TEXT, p_status_von TEXT, p_status_nach TEXT, p_bild UUID,
    p_operation UUID
) RETURNS INTEGER
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_seq INTEGER;
BEGIN
    SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM avesmaps_kanal.eintrag WHERE vorgang_id = p_vorgang;
    INSERT INTO avesmaps_kanal.eintrag (vorgang_id, seq, art, von_person, von_agent, text, status_von, status_nach, bild_id, operation_id)
    VALUES (p_vorgang, v_seq, p_art, p_person, p_agent, NULLIF(btrim(p_text), ''), p_status_von, p_status_nach, p_bild, p_operation);
    UPDATE avesmaps_kanal.vorgang SET revision = revision + 1 WHERE id = p_vorgang;
    RETURN v_seq;
END;
$$;

-- Schon geschehen? Jede schreibende Funktion trägt eine `operation_id`; dieselbe noch einmal ist kein Fehler, sondern nichts.
CREATE OR REPLACE FUNCTION avesmaps_kanal._schon(p_operation UUID) RETURNS BOOLEAN
    LANGUAGE sql
    STABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT EXISTS (SELECT 1 FROM avesmaps_kanal.eintrag WHERE operation_id = p_operation)
        OR EXISTS (SELECT 1 FROM avesmaps_kanal.nachweis WHERE operation_id = p_operation)
        OR EXISTS (SELECT 1 FROM avesmaps_kanal.aenderung WHERE operation_id = p_operation)
        OR EXISTS (SELECT 1 FROM avesmaps_kanal.beobachtung WHERE operation_id = p_operation)
        OR EXISTS (SELECT 1 FROM avesmaps_kanal.bild WHERE operation_id = p_operation)
        OR EXISTS (SELECT 1 FROM avesmaps_kanal.vorgang WHERE operation_id = p_operation);
$$;

-- Eine Meldung auf ihren Rest leeren (§3.1): Freitexte, Kontext und Personen weg, Verlauf gelöscht, Bilder zum Löschen vorgemerkt.
CREATE OR REPLACE FUNCTION avesmaps_kanal._auf_rest(p_vorgang BIGINT, p_von_hand BOOLEAN) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    UPDATE avesmaps_kanal.bild SET entfernen_ab = COALESCE(entfernen_ab, now()) WHERE vorgang_id = p_vorgang AND geloescht_at IS NULL;
    DELETE FROM avesmaps_kanal.eintrag WHERE vorgang_id = p_vorgang;
    UPDATE avesmaps_kanal.nachweis SET von_person = NULL WHERE vorgang_id = p_vorgang;
    UPDATE avesmaps_kanal.vorgang SET
        titel = NULL, nachricht = NULL, schritte = NULL, kontext = '{}'::jsonb, gemeldet_von = NULL, abgenommen_von = NULL,
        abgelaufen_at = now(), von_hand_geloescht = p_von_hand, lease_agent = NULL, lease_bis = NULL, revision = revision + 1
     WHERE id = p_vorgang;
END;
$$;

-- --- Betreiber (die App; die Person hat sie angemeldet und ihr Recht geprüft) -----------------------------------------------------------

CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_melden(
    p_operation UUID, p_environment TEXT, p_person UUID, p_kategorie TEXT, p_prioritaet TEXT, p_titel TEXT, p_nachricht TEXT,
    p_schritte TEXT, p_kontext JSONB, p_folgt_auf BIGINT
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    SELECT id INTO v_id FROM avesmaps_kanal.vorgang WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF p_kategorie = 'wiederherstellung' THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: eine Wiederherstellung beantragt man unter „Backups“');
    END IF;
    IF p_folgt_auf IS NOT NULL AND NOT EXISTS (SELECT 1 FROM avesmaps_kanal.vorgang WHERE id = p_folgt_auf) THEN
        PERFORM avesmaps_kanal._fehler('KA404', format('kanal_not_found: OPS-%s', lpad(p_folgt_auf::text, 6, '0')));
    END IF;
    INSERT INTO avesmaps_kanal.vorgang (
        environment, art, kategorie, prioritaet, titel, nachricht, schritte, kontext, zustaendig, folgt_auf, gemeldet_von, operation_id
    ) VALUES (
        p_environment, 'meldung', p_kategorie, p_prioritaet, btrim(p_titel), btrim(p_nachricht), NULLIF(btrim(p_schritte), ''),
        COALESCE(p_kontext, '{}'::jsonb),
        -- Wer zuerst hinsieht (Arbeitsanweisung §2): Umbau und Karteninhalt Claudia, alles andere Claudio (Idee mit seiner Voranalyse).
        CASE WHEN p_kategorie IN ('umbau', 'karteninhalt') THEN 'claudia' ELSE 'claudio' END,
        p_folgt_auf, p_person, p_operation
    ) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_wiederherstellung(
    p_operation UUID, p_environment TEXT, p_person UUID, p_sicherung TEXT, p_umfang TEXT, p_grund TEXT
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    SELECT id INTO v_id FROM avesmaps_kanal.vorgang WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF p_umfang IS NULL OR p_umfang NOT IN ('datenbank', 'datenbank_medien', 'einstellungen') THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: Umfang datenbank, datenbank_medien oder einstellungen');
    END IF;
    IF p_sicherung IS NULL OR char_length(btrim(p_sicherung)) NOT BETWEEN 1 AND 120 THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: welche Sicherung fehlt');
    END IF;
    INSERT INTO avesmaps_kanal.vorgang (
        environment, art, kategorie, prioritaet, titel, nachricht, kontext, zustaendig, gemeldet_von, operation_id
    ) VALUES (
        p_environment, 'wiederherstellung', 'wiederherstellung', 'dringend', 'Wiederherstellung beantragt', btrim(p_grund),
        jsonb_build_object('sicherung', btrim(p_sicherung), 'umfang', p_umfang), 'claudio', p_person, p_operation
    ) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_nachricht(p_operation UUID, p_vorgang BIGINT, p_person UUID, p_text TEXT)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_kanal.vorgang;
BEGIN
    IF avesmaps_kanal._schon(p_operation) THEN
        RETURN NULL;
    END IF;
    v := avesmaps_kanal._sperre(p_vorgang);
    IF v.status = 'abgenommen' THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: der Vorgang ist abgenommen; „Neuer Vorgang dazu“ statt einer Nachricht');
    END IF;
    RETURN avesmaps_kanal._eintrag(p_vorgang, 'nachricht', p_person, NULL, p_text, NULL, NULL, NULL, p_operation);
END;
$$;

CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_abnehmen(p_operation UUID, p_vorgang BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
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
    v := avesmaps_kanal._sperre(p_vorgang);
    IF v.revision <> p_revision THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_conflict: der Vorgang hat sich inzwischen geändert');
    END IF;
    IF v.status <> 'zur_abnahme' THEN
        PERFORM avesmaps_kanal._fehler('KA409', format('kanal_transition: abnehmen geht nur aus „zur Abnahme“, nicht aus %s', v.status));
    END IF;
    UPDATE avesmaps_kanal.vorgang SET status = 'abgenommen', abgenommen_von = p_person, abgenommen_at = now(), lease_agent = NULL,
        lease_bis = NULL WHERE id = p_vorgang;
    INSERT INTO avesmaps_kanal.nachweis (vorgang_id, runde, station, von_person, operation_id)
    VALUES (p_vorgang, v.runde, 'betreiber_abnahme', p_person, gen_random_uuid());
    PERFORM avesmaps_kanal._eintrag(p_vorgang, 'status', p_person, NULL, NULL, 'zur_abnahme', 'abgenommen', NULL, p_operation);
    RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
END;
$$;

-- W2: aus „zur Abnahme“ zurück auf „in Arbeit“, beim selben Zuständigen, als neue Runde mit derselben OPS-ID.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_wieder_oeffnen(
    p_operation UUID, p_vorgang BIGINT, p_person UUID, p_revision INTEGER, p_kommentar TEXT
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
    IF p_kommentar IS NULL OR btrim(p_kommentar) = '' THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: wieder öffnen braucht einen Kommentar');
    END IF;
    v := avesmaps_kanal._sperre(p_vorgang);
    IF v.revision <> p_revision THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_conflict: der Vorgang hat sich inzwischen geändert');
    END IF;
    IF v.status <> 'zur_abnahme' THEN
        PERFORM avesmaps_kanal._fehler('KA409', format('kanal_transition: wieder öffnen geht nur aus „zur Abnahme“, nicht aus %s', v.status));
    END IF;
    UPDATE avesmaps_kanal.vorgang SET status = 'in_arbeit', runde = runde + 1 WHERE id = p_vorgang;
    PERFORM avesmaps_kanal._eintrag(p_vorgang, 'nachricht', p_person, NULL, p_kommentar, NULL, NULL, NULL, gen_random_uuid());
    PERFORM avesmaps_kanal._eintrag(p_vorgang, 'status', p_person, NULL, NULL, 'zur_abnahme', 'in_arbeit', NULL, p_operation);
    RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
END;
$$;

-- „Meldung jetzt löschen“ (§3.1, nach Wunsch): nur an abgenommenen Vorgängen; danach bleibt der Rest, wie nach dem Ablauf.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_loeschen(p_vorgang BIGINT, p_person UUID) RETURNS BOOLEAN
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_kanal.vorgang;
BEGIN
    v := avesmaps_kanal._sperre(p_vorgang);
    IF v.abgelaufen_at IS NOT NULL THEN
        RETURN false;
    END IF;
    IF v.status <> 'abgenommen' THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: löschen geht nur an abgenommenen Vorgängen');
    END IF;
    PERFORM avesmaps_kanal._auf_rest(p_vorgang, true);
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_bild_anlegen(
    p_operation UUID, p_vorgang BIGINT, p_person UUID, p_bild UUID, p_sha256 TEXT, p_format TEXT, p_breite INTEGER, p_hoehe INTEGER,
    p_bytes INTEGER
) RETURNS UUID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_kanal.vorgang;
    v_seq INTEGER;
BEGIN
    IF EXISTS (SELECT 1 FROM avesmaps_kanal.bild WHERE operation_id = p_operation) THEN
        RETURN (SELECT id FROM avesmaps_kanal.bild WHERE operation_id = p_operation);
    END IF;
    v := avesmaps_kanal._sperre(p_vorgang);
    IF v.status = 'abgenommen' THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: an einen abgenommenen Vorgang kommt kein Bild mehr');
    END IF;
    v_seq := avesmaps_kanal._eintrag(p_vorgang, 'bild', p_person, NULL, NULL, NULL, NULL, p_bild, gen_random_uuid());
    INSERT INTO avesmaps_kanal.bild (id, vorgang_id, eintrag_seq, sha256, format, breite, hoehe, bytes, hochgeladen_von, operation_id)
    VALUES (p_bild, p_vorgang, v_seq, p_sha256, p_format, p_breite, p_hoehe, p_bytes, p_person, p_operation);
    RETURN p_bild;
END;
$$;

-- „Bild entfernen“ (§3.1): jederzeit, auch in offenen Vorgängen; im Verlauf bleibt „Bild entfernt“.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_bild_entfernen(p_operation UUID, p_bild UUID, p_person UUID) RETURNS BOOLEAN
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_bild avesmaps_kanal.bild;
BEGIN
    IF avesmaps_kanal._schon(p_operation) THEN
        RETURN false;
    END IF;
    SELECT * INTO v_bild FROM avesmaps_kanal.bild WHERE id = p_bild FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM avesmaps_kanal._fehler('KA404', 'kanal_not_found: Bild');
    END IF;
    IF v_bild.entfernen_ab IS NOT NULL THEN
        RETURN false;
    END IF;
    PERFORM avesmaps_kanal._sperre(v_bild.vorgang_id);
    UPDATE avesmaps_kanal.bild SET entfernen_ab = now() WHERE id = p_bild;
    -- Ein abgelaufener Vorgang hat keinen Verlauf mehr; dann bleibt nur die Vormerkung.
    IF EXISTS (SELECT 1 FROM avesmaps_kanal.vorgang WHERE id = v_bild.vorgang_id AND abgelaufen_at IS NULL) THEN
        PERFORM avesmaps_kanal._eintrag(v_bild.vorgang_id, 'bild_entfernt', p_person, NULL, NULL, NULL, NULL, p_bild, p_operation);
    END IF;
    RETURN true;
END;
$$;

-- --- Agenten (Claudio auf Stage, Claudia lokal) ----------------------------------------------------------------------------------------

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

CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_lesen(p_vorgang BIGINT, p_als TEXT DEFAULT NULL) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_agent TEXT := avesmaps_kanal._agent(p_als);
    v avesmaps_kanal.vorgang;
BEGIN
    SELECT * INTO v FROM avesmaps_kanal.vorgang WHERE id = p_vorgang;
    IF NOT FOUND THEN
        PERFORM avesmaps_kanal._fehler('KA404', format('kanal_not_found: OPS-%s', lpad(p_vorgang::text, 6, '0')));
    END IF;
    RETURN jsonb_build_object(
        'agent', v_agent,
        'vorgang', to_jsonb(v) - 'operation_id' - 'gemeldet_von' - 'abgenommen_von',
        'gemeldetVon', (SELECT p.display_name FROM avesmaps_auth.person p WHERE p.id = v.gemeldet_von),
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

CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_eintragen(
    p_operation UUID, p_vorgang BIGINT, p_art TEXT, p_text TEXT, p_als TEXT DEFAULT NULL
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_agent TEXT := avesmaps_kanal._agent(p_als);
    v avesmaps_kanal.vorgang;
BEGIN
    IF avesmaps_kanal._schon(p_operation) THEN
        RETURN NULL;
    END IF;
    IF p_art NOT IN ('rueckfrage', 'antwort', 'befund') THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: Rückfrage, Antwort oder Befund');
    END IF;
    IF p_text IS NULL OR btrim(p_text) = '' THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: der Eintrag braucht einen Text');
    END IF;
    v := avesmaps_kanal._sperre(p_vorgang);
    IF v.status = 'abgenommen' THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: der Vorgang ist abgenommen');
    END IF;
    IF NOT (v.zustaendig = v_agent OR v_agent = 'claudia') THEN
        PERFORM avesmaps_kanal._fehler('KA403', format('kanal_forbidden: zuständig ist %s', v.zustaendig));
    END IF;
    RETURN avesmaps_kanal._eintrag(p_vorgang, p_art, NULL, v_agent, p_text, NULL, NULL, NULL, p_operation);
END;
$$;

-- Die Übergänge der Agenten (Arbeitsanweisung §7, KANAL-0001 §3). Abnehmen und wieder öffnen nur der Betreiber.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_status(
    p_operation UUID, p_vorgang BIGINT, p_nach TEXT, p_text TEXT, p_kurztitel TEXT DEFAULT NULL, p_als TEXT DEFAULT NULL
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_agent TEXT := avesmaps_kanal._agent(p_als);
    v avesmaps_kanal.vorgang;
    v_erlaubt TEXT[];
    v_zustaendig TEXT;
    v_kurztitel TEXT;
BEGIN
    IF avesmaps_kanal._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
    END IF;
    v := avesmaps_kanal._sperre(p_vorgang);
    IF NOT (v.zustaendig = v_agent OR v_agent = 'claudia') THEN
        PERFORM avesmaps_kanal._fehler('KA403', format('kanal_forbidden: zuständig ist %s', v.zustaendig));
    END IF;
    v_erlaubt := CASE v.status
        WHEN 'neu' THEN ARRAY['angenommen', 'in_arbeit', 'bei_claudia']
        WHEN 'angenommen' THEN ARRAY['in_arbeit', 'bei_claudia']
        WHEN 'in_arbeit' THEN ARRAY['bei_claudia', 'auf_stage', 'beantwortet', 'abgelehnt']
        WHEN 'bei_claudia' THEN ARRAY['in_arbeit']
        WHEN 'auf_stage' THEN ARRAY['zur_abnahme', 'in_arbeit']
        WHEN 'beantwortet' THEN ARRAY['zur_abnahme', 'in_arbeit']
        WHEN 'abgelehnt' THEN ARRAY['zur_abnahme', 'in_arbeit']
        ELSE ARRAY[]::TEXT[]
    END;
    IF p_nach IS NULL OR NOT (p_nach = ANY (v_erlaubt)) THEN
        PERFORM avesmaps_kanal._fehler('KA409', format('kanal_transition: von %s nicht nach %s', v.status, COALESCE(p_nach, '(leer)')));
    END IF;
    IF v.status = 'bei_claudia' AND v_agent <> 'claudia' THEN
        PERFORM avesmaps_kanal._fehler('KA403', 'kanal_forbidden: was bei Claudia liegt, nimmt nur Claudia zurück in Arbeit');
    END IF;
    IF p_nach IN ('bei_claudia', 'abgelehnt') AND (p_text IS NULL OR btrim(p_text) = '') THEN
        PERFORM avesmaps_kanal._fehler('KA422', format('kanal_invalid: %s braucht eine Begründung', p_nach));
    END IF;
    IF p_nach = 'auf_stage' AND NOT EXISTS (
        SELECT 1 FROM avesmaps_kanal.nachweis n WHERE n.vorgang_id = p_vorgang AND n.runde = v.runde AND n.station = 'auf_stage'
    ) THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: „auf Stage“ braucht zuerst den Nachweis mit Release');
    END IF;
    v_kurztitel := COALESCE(NULLIF(btrim(p_kurztitel), ''), v.kurztitel);
    IF p_nach = 'zur_abnahme' AND v_kurztitel IS NULL THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: zur Abnahme braucht einen Kurztitel (neutral, ohne Namen, ohne Zitat)');
    END IF;
    v_zustaendig := CASE
        WHEN p_nach = 'bei_claudia' THEN 'claudia'
        WHEN v.status = 'bei_claudia' THEN 'claudia'
        ELSE v.zustaendig
    END;
    UPDATE avesmaps_kanal.vorgang SET
        status = p_nach, zustaendig = v_zustaendig, kurztitel = v_kurztitel,
        lease_agent = CASE WHEN p_nach IN ('zur_abnahme', 'bei_claudia') THEN NULL ELSE lease_agent END,
        lease_bis = CASE WHEN p_nach IN ('zur_abnahme', 'bei_claudia') THEN NULL ELSE lease_bis END
     WHERE id = p_vorgang;
    PERFORM avesmaps_kanal._eintrag(p_vorgang, 'status', NULL, v_agent, p_text, v.status, p_nach, NULL, p_operation);
    RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
END;
$$;

-- Eskalation (Arbeitsanweisung §2): Kategorie mit Begründung ändern, Priorität nur hochstufen; herabstufen nie still.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_einstufen(
    p_operation UUID, p_vorgang BIGINT, p_kategorie TEXT, p_prioritaet TEXT, p_begruendung TEXT, p_als TEXT DEFAULT NULL
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_agent TEXT := avesmaps_kanal._agent(p_als);
    v avesmaps_kanal.vorgang;
    v_rang TEXT[] := ARRAY['niedrig', 'normal', 'hoch', 'dringend'];
BEGIN
    IF avesmaps_kanal._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
    END IF;
    IF p_begruendung IS NULL OR btrim(p_begruendung) = '' THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: einstufen braucht eine Begründung');
    END IF;
    v := avesmaps_kanal._sperre(p_vorgang);
    IF v.status = 'abgenommen' OR v.art = 'wiederherstellung' THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: dieser Vorgang wird nicht umgestuft');
    END IF;
    IF NOT (v.zustaendig = v_agent OR v_agent = 'claudia') THEN
        PERFORM avesmaps_kanal._fehler('KA403', format('kanal_forbidden: zuständig ist %s', v.zustaendig));
    END IF;
    IF p_kategorie = 'wiederherstellung' THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: keine Wiederherstellung über das Einstufen');
    END IF;
    IF p_prioritaet IS NOT NULL AND array_position(v_rang, p_prioritaet) < array_position(v_rang, v.prioritaet) THEN
        PERFORM avesmaps_kanal._fehler('KA403', 'kanal_forbidden: die Priorität des Betreibers wird nicht herabgesetzt; erst nachfragen');
    END IF;
    UPDATE avesmaps_kanal.vorgang SET
        kategorie = COALESCE(p_kategorie, kategorie), prioritaet = COALESCE(p_prioritaet, prioritaet)
     WHERE id = p_vorgang;
    PERFORM avesmaps_kanal._eintrag(
        p_vorgang, 'einstufung', NULL, v_agent,
        format('%s → %s, %s → %s: %s', v.kategorie, COALESCE(p_kategorie, v.kategorie), v.prioritaet, COALESCE(p_prioritaet, v.prioritaet),
               btrim(p_begruendung)),
        NULL, NULL, NULL, p_operation
    );
    RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
END;
$$;

-- Fix-Bericht (Arbeitsanweisung §4, Pflicht): je Änderung ein Eintrag; dauerhaft.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_aenderung(
    p_operation UUID, p_vorgang BIGINT, p_klasse TEXT, p_art TEXT, p_was TEXT, p_grund TEXT, p_dateien TEXT[], p_commit TEXT,
    p_release TEXT, p_tests TEXT, p_ruecknahme TEXT, p_als TEXT DEFAULT NULL
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
    SELECT id INTO v_id FROM avesmaps_kanal.aenderung WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF p_vorgang IS NOT NULL THEN
        v := avesmaps_kanal._sperre(p_vorgang);
    END IF;
    INSERT INTO avesmaps_kanal.aenderung (
        vorgang_id, runde, agent, klasse, art, was, grund, dateien, commit_sha, release, tests, ruecknahme, operation_id
    ) VALUES (
        p_vorgang, CASE WHEN p_vorgang IS NULL THEN NULL ELSE v.runde END, v_agent, p_klasse, p_art, btrim(p_was),
        NULLIF(btrim(p_grund), ''), COALESCE(p_dateien, '{}'), lower(p_commit), NULLIF(btrim(p_release), ''), NULLIF(btrim(p_tests), ''),
        NULLIF(btrim(p_ruecknahme), ''), p_operation
    ) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_beobachtung(
    p_operation UUID, p_aenderung BIGINT, p_ergebnis TEXT, p_text TEXT, p_als TEXT DEFAULT NULL
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_agent TEXT := avesmaps_kanal._agent(p_als);
    v_id BIGINT;
BEGIN
    SELECT id INTO v_id FROM avesmaps_kanal.beobachtung WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM avesmaps_kanal.aenderung a WHERE a.id = p_aenderung AND (a.agent = v_agent OR v_agent = 'claudia')) THEN
        PERFORM avesmaps_kanal._fehler('KA404', 'kanal_not_found: Änderung');
    END IF;
    INSERT INTO avesmaps_kanal.beobachtung (aenderung_id, ergebnis, text, operation_id)
    VALUES (p_aenderung, p_ergebnis, NULLIF(btrim(p_text), ''), p_operation) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- Nachweise der Agenten: „Fix committed“ nur mit einem Eintrag im Fix-Bericht derselben SHA, „auf Stage“ nur mit Release. „Claudia
-- nachgeprüft“ entsteht über `kanal_nachpruefen`, die Abnahme beim Betreiber.
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
    IF p_station NOT IN ('fix_committed', 'auf_stage') THEN
        PERFORM avesmaps_kanal._fehler('KA403', 'kanal_forbidden: diese Station setzt nicht der Agent (Nachprüfung, Abnahme)');
    END IF;
    v := avesmaps_kanal._sperre(p_vorgang);
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
    VALUES (p_vorgang, v.runde, p_station, lower(p_commit), NULLIF(btrim(p_release), ''), NULLIF(btrim(p_notiz), ''), v_agent, p_operation)
    RETURNING id INTO v_id;
    UPDATE avesmaps_kanal.vorgang SET revision = revision + 1 WHERE id = p_vorgang;
    RETURN v_id;
END;
$$;

-- Claudias Nachprüfung: ok setzt die Station „Claudia nachgeprüft“ der Runde; nachbessern schreibt einen Befund und holt den Vorgang,
-- solange er offen ist, zu Claudia.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_nachpruefen(
    p_operation UUID, p_aenderung BIGINT, p_ergebnis TEXT, p_notiz TEXT, p_als TEXT DEFAULT NULL
) RETURNS BOOLEAN
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_agent TEXT := avesmaps_kanal._agent(p_als);
    v_a avesmaps_kanal.aenderung;
    v avesmaps_kanal.vorgang;
BEGIN
    IF avesmaps_kanal._schon(p_operation) THEN
        RETURN false;
    END IF;
    IF v_agent <> 'claudia' THEN
        PERFORM avesmaps_kanal._fehler('KA403', 'kanal_forbidden: nachprüfen kann nur Claudia');
    END IF;
    IF p_ergebnis NOT IN ('ok', 'nachbessern') THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: ok oder nachbessern');
    END IF;
    SELECT * INTO v_a FROM avesmaps_kanal.aenderung WHERE id = p_aenderung FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM avesmaps_kanal._fehler('KA404', 'kanal_not_found: Änderung');
    END IF;
    UPDATE avesmaps_kanal.aenderung SET nachgeprueft_at = now(), nachpruefung = p_ergebnis, nachpruefung_notiz = NULLIF(btrim(p_notiz), '')
     WHERE id = p_aenderung;
    IF v_a.vorgang_id IS NULL THEN
        -- Eine Änderung ohne Vorgang: nur der Vermerk; die operation_id trägt eine Beobachtung, damit dieselbe Nachprüfung nicht doppelt zählt.
        INSERT INTO avesmaps_kanal.beobachtung (aenderung_id, ergebnis, text, operation_id)
        VALUES (p_aenderung, CASE WHEN p_ergebnis = 'ok' THEN 'unauffaellig' ELSE 'offen' END, 'nachgeprüft: ' || p_ergebnis, p_operation);
        RETURN true;
    END IF;
    v := avesmaps_kanal._sperre(v_a.vorgang_id);
    IF p_ergebnis = 'ok' THEN
        INSERT INTO avesmaps_kanal.nachweis (vorgang_id, runde, station, commit_sha, notiz, von_agent, operation_id)
        VALUES (v.id, v_a.runde, 'claudia_nachgeprueft', v_a.commit_sha, NULLIF(btrim(p_notiz), ''), 'claudia', p_operation);
        UPDATE avesmaps_kanal.vorgang SET revision = revision + 1 WHERE id = v.id;
    ELSIF v.abgelaufen_at IS NULL THEN
        PERFORM avesmaps_kanal._eintrag(v.id, 'befund', NULL, 'claudia', COALESCE(NULLIF(btrim(p_notiz), ''), 'nachbessern'),
                                        NULL, NULL, NULL, p_operation);
        IF v.status IN ('neu', 'angenommen', 'in_arbeit', 'auf_stage') THEN
            UPDATE avesmaps_kanal.vorgang SET status = 'bei_claudia', zustaendig = 'claudia', lease_agent = NULL, lease_bis = NULL
             WHERE id = v.id;
            PERFORM avesmaps_kanal._eintrag(v.id, 'status', NULL, 'claudia', 'Nachprüfung: nachbessern', v.status, 'bei_claudia', NULL,
                                            gen_random_uuid());
        END IF;
    ELSE
        INSERT INTO avesmaps_kanal.beobachtung (aenderung_id, ergebnis, text, operation_id)
        VALUES (p_aenderung, 'offen', 'nachgeprüft: nachbessern', p_operation);
    END IF;
    RETURN true;
END;
$$;

-- Was Claudia noch nachprüfen muss: Änderungen ohne Nachprüfung, solche mit Fehler, Fallback oder Rollback zuerst.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_aenderungen_offen(p_als TEXT DEFAULT NULL) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_agent TEXT := avesmaps_kanal._agent(p_als);
BEGIN
    IF v_agent <> 'claudia' THEN
        PERFORM avesmaps_kanal._fehler('KA403', 'kanal_forbidden: die offene Nachprüfung liest nur Claudia');
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(x.zeile ORDER BY x.ernst DESC, x.at)
          FROM (
            SELECT a.at,
                   COALESCE((SELECT max(CASE b.ergebnis WHEN 'rollback' THEN 3 WHEN 'fehler' THEN 3 WHEN 'fallback' THEN 2 ELSE 0 END)
                               FROM avesmaps_kanal.beobachtung b WHERE b.aenderung_id = a.id), 1) AS ernst,
                   jsonb_build_object(
                       'id', a.id, 'vorgang', a.vorgang_id, 'runde', a.runde, 'agent', a.agent, 'klasse', a.klasse, 'art', a.art,
                       'was', a.was, 'grund', a.grund, 'dateien', a.dateien, 'commit', a.commit_sha, 'release', a.release,
                       'tests', a.tests, 'ruecknahme', a.ruecknahme, 'at', a.at,
                       'beobachtungen', COALESCE((SELECT jsonb_agg(jsonb_build_object('ergebnis', b.ergebnis, 'text', b.text, 'at', b.at)
                                                                   ORDER BY b.id)
                                                    FROM avesmaps_kanal.beobachtung b WHERE b.aenderung_id = a.id), '[]'::jsonb)
                   ) AS zeile
              FROM avesmaps_kanal.aenderung a
             WHERE a.nachgeprueft_at IS NULL
          ) x
    ), '[]'::jsonb);
END;
$$;

-- --- Jobs-Rolle: Bilder und Aufbewahrung -----------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_bild_fertig(p_bild UUID, p_zustand TEXT, p_grund TEXT) RETURNS BOOLEAN
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF p_zustand NOT IN ('bereit', 'abgewiesen') THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: bereit oder abgewiesen');
    END IF;
    UPDATE avesmaps_kanal.bild SET zustand = p_zustand, abgewiesen_grund = CASE WHEN p_zustand = 'abgewiesen' THEN left(p_grund, 200) END
     WHERE id = p_bild AND zustand = 'wird_vorbereitet';
    RETURN FOUND;
END;
$$;

-- Die Bilder, deren Dateien jetzt zu löschen sind: vorgemerkt (entfernt, gelöscht, abgelaufen) oder 90 Tage nach der Abnahme.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_faellige_bilder() RETURNS TABLE (bild UUID)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    UPDATE avesmaps_kanal.bild b SET entfernen_ab = now()
      FROM avesmaps_kanal.vorgang v
     WHERE v.id = b.vorgang_id AND b.entfernen_ab IS NULL AND v.status = 'abgenommen' AND v.abgenommen_at < now() - interval '90 days';
    RETURN QUERY SELECT b.id FROM avesmaps_kanal.bild b WHERE b.entfernen_ab IS NOT NULL AND b.geloescht_at IS NULL ORDER BY b.entfernen_ab;
END;
$$;

CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_bild_geloescht(p_bild UUID) RETURNS BOOLEAN
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    UPDATE avesmaps_kanal.bild SET geloescht_at = now() WHERE id = p_bild AND entfernen_ab IS NOT NULL AND geloescht_at IS NULL;
    RETURN FOUND;
END;
$$;

-- Die Aufbewahrung (§3.1): Meldungen 90 Tage nach der Abnahme auf ihren Rest leeren; Bildzeilen, deren Dateien gelöscht sind, entfernen,
-- sobald ihr Vorgang abgelaufen ist. Fristen fest im Text; gelöscht wird nur hier und in `kanal_loeschen`.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_purge_expired() RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_meldungen INTEGER := 0;
    v_bildzeilen INTEGER;
BEGIN
    FOR v_id IN
        SELECT id FROM avesmaps_kanal.vorgang
         WHERE status = 'abgenommen' AND abgelaufen_at IS NULL AND abgenommen_at < now() - interval '90 days'
         ORDER BY id
           FOR UPDATE
    LOOP
        PERFORM avesmaps_kanal._auf_rest(v_id, false);
        v_meldungen := v_meldungen + 1;
    END LOOP;
    DELETE FROM avesmaps_kanal.bild b
     USING avesmaps_kanal.vorgang v
     WHERE v.id = b.vorgang_id AND v.abgelaufen_at IS NOT NULL AND b.geloescht_at IS NOT NULL;
    GET DIAGNOSTICS v_bildzeilen = ROW_COUNT;
    RETURN jsonb_build_object('meldungen', v_meldungen, 'bildzeilen', v_bildzeilen);
END;
$$;

-- Konto auflösen (WI-0120 A15): Namen zeigt der Kanal ohnehin nur über die Kennung (danach der Platzhalter); geleert wird hier die
-- Geräteangabe im Kontext ihrer Vorgänge, wie die Gerätebezeichnung in `redact_person_events`.
CREATE OR REPLACE FUNCTION avesmaps_kanal.redact_person_kanal(p_person UUID) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_n INTEGER;
BEGIN
    UPDATE avesmaps_kanal.vorgang SET kontext = kontext - 'geraet' WHERE gemeldet_von = p_person AND kontext ? 'geraet';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

-- Keine Funktion des Schemas darf zunächst jeder aufrufen; wer was darf, steht in `kanal-grants.psql`.
DO $$
DECLARE
    f RECORD;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'avesmaps_kanal'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION job_enqueue(
    p_kind TEXT,
    p_kind_version SMALLINT,
    p_map_domain_id TEXT,
    p_actor_ref TEXT,
    p_input_ref JSONB,
    p_priority SMALLINT DEFAULT 50,
    p_not_before TIMESTAMPTZ DEFAULT NULL,
    p_scope_kind TEXT DEFAULT 'domain',
    p_scope_tiles SMALLINT[] DEFAULT '{}',
    p_depends_on BIGINT[] DEFAULT '{}'
) RETURNS TABLE (id BIGINT, public_id UUID)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN (
        'terrain_local', 'dem_publish', 'display_heights', 'routing_reload', 'media_settle', 'legacy_pull', 'legacy_media',
        'terrain_preview', 'path_profile', 'media_quarantine', 'kanal_bild'
    ) THEN
        RAISE EXCEPTION 'job_enqueue: Jobart % darf die Anwendung nicht einreihen', COALESCE(p_kind, '(leer)')
            USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT i.id, i.public_id FROM job_insert(
        p_kind, p_kind_version, p_map_domain_id, 'queued', p_actor_ref, NULL, NULL, p_input_ref, p_priority,
        p_not_before, p_scope_kind, p_scope_tiles, p_depends_on
    ) i;
END;
$$;
