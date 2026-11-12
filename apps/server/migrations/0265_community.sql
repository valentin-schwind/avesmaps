-- Community-Modul, Datenkern (WI-0268 C1; Fachkonzept project-control/planning/community-fachkonzept.md §2 bis §12): Vorgänge von außen
-- (Meldung zur Karte, Anfrage) mit COM-Nummer, Melder, Bezug, Nachrichten, Notizen, Verknüpfungen und Verlauf.
--
-- Eigenes Schema `avesmaps_community` nach dem Muster des Betreiber-Kanals (0106). Im Schema gibt es KEINE Default-Privilegien; die Rechte
-- stehen in `apps/server/src/db/community-grants.psql`:
-- - die App liest die Tafeln und schreibt NUR über die Funktionen; die Übergänge prüft die Datenbank, nicht nur der Code.
-- - die Jobs-Rolle ruft nur die Aufbewahrung.
-- - Die öffentlichen Wege (Statusseite) lesen über `community_status_lesen`; diese Funktion fasst `notiz` nicht an. Notizen haben eine
--   eigene Tafel, damit ein Fehler an einem Merkmal nie eine interne Notiz nach außen gibt (Fachkonzept §2).
--
-- Fehler als eigene SQLSTATE der Klasse `KC` (die App bildet sie auf Fachcodes ab): KC404 nicht gefunden, KC409 Übergang oder Revision
-- (Text beginnt mit `community_conflict` bei veralteter Revision), KC422 ungültige Angabe.
--
-- Datensparsam (Fachkonzept §10.1): keine IP, kein User-Agent, keine Seitenadresse. Der Statuslink ist nur ein Hash. Fristen §10.2:
-- Kontaktdaten und Statuslink 90 Tage nach dem Abschluss, Papierkorb 30 Tage, Archiv 30 Tage nach dem Abschluss.
--
-- 🔴 REIN ADDITIV: ein neues Schema. Das vorige Release kennt es nicht.

CREATE SCHEMA IF NOT EXISTS avesmaps_community;
COMMENT ON SCHEMA avesmaps_community IS 'Community-Modul (WI-0263, WI-0268): Meldungen und Anfragen von außen.';

CREATE TABLE IF NOT EXISTS avesmaps_community.vorgang (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    art TEXT NOT NULL,
    kategorie TEXT NOT NULL,
    eingang TEXT NOT NULL,
    quelle TEXT,
    fehlt_art TEXT,
    zustand TEXT NOT NULL DEFAULT 'neu',
    ergebnis TEXT,
    prioritaet TEXT NOT NULL DEFAULT 'normal',
    zustaendig UUID REFERENCES avesmaps_auth.person (id),
    angelegt_von UUID REFERENCES avesmaps_auth.person (id),
    eingegangen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    aktiv_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rueckfrage_at TIMESTAMPTZ,
    abgeschlossen_at TIMESTAMPTZ,
    archiviert_at TIMESTAMPTZ,
    papierkorb_at TIMESTAMPTZ,
    revision INTEGER NOT NULL DEFAULT 1,
    operation_id UUID NOT NULL UNIQUE,
    CONSTRAINT vorgang_art CHECK (art IN ('meldung', 'anfrage')),
    CONSTRAINT vorgang_kategorie CHECK (
        (art = 'meldung' AND kategorie IN ('lage', 'name', 'angabe', 'fehlt', 'entfaellt', 'sonstiges'))
        OR (art = 'anfrage' AND kategorie IN ('frage', 'hinweis', 'mitmachen', 'rechte', 'datenschutz', 'sonstiges'))
    ),
    CONSTRAINT vorgang_eingang CHECK (eingang IN ('website', 'kontakt', 'mail', 'discord', 'redaktion')),
    CONSTRAINT vorgang_quelle CHECK (quelle IS NULL OR char_length(quelle) BETWEEN 1 AND 1000),
    CONSTRAINT vorgang_fehlt_art CHECK (
        fehlt_art IS NULL OR (kategorie = 'fehlt' AND fehlt_art IN ('ort', 'weg', 'fluss', 'gebirge', 'gewaesser', 'gebiet', 'anderes'))
    ),
    CONSTRAINT vorgang_zustand CHECK (zustand IN ('neu', 'in_arbeit', 'rueckfrage', 'abgeschlossen')),
    CONSTRAINT vorgang_ergebnis CHECK (ergebnis IS NULL OR ergebnis IN (
        'umgesetzt', 'bereits_richtig', 'abgelehnt', 'dublette', 'weitergereicht', 'beantwortet', 'erledigt', 'zurueckgezogen', 'spam'
    )),
    CONSTRAINT vorgang_ergebnis_art CHECK (
        ergebnis IS NULL
        OR (art = 'meldung' AND ergebnis NOT IN ('beantwortet', 'erledigt'))
        OR (art = 'anfrage' AND ergebnis NOT IN ('umgesetzt', 'bereits_richtig'))
    ),
    CONSTRAINT vorgang_abschluss CHECK (
        (zustand = 'abgeschlossen') = (ergebnis IS NOT NULL) AND (zustand = 'abgeschlossen') = (abgeschlossen_at IS NOT NULL)
    ),
    CONSTRAINT vorgang_archiv CHECK (archiviert_at IS NULL OR (zustand = 'abgeschlossen' AND papierkorb_at IS NULL)),
    CONSTRAINT vorgang_papierkorb CHECK ((papierkorb_at IS NOT NULL) = (ergebnis IS NOT DISTINCT FROM 'spam')),
    CONSTRAINT vorgang_prioritaet CHECK (prioritaet IN ('niedrig', 'normal', 'hoch', 'dringend'))
);
COMMENT ON TABLE avesmaps_community.vorgang IS 'Vorgänge des Community-Moduls; die Nummer ist COM- und die id mit sechs Stellen.';
CREATE INDEX IF NOT EXISTS vorgang_offen ON avesmaps_community.vorgang (zustand, zustaendig) WHERE zustand <> 'abgeschlossen';
CREATE INDEX IF NOT EXISTS vorgang_abgeschlossen ON avesmaps_community.vorgang (abgeschlossen_at) WHERE zustand = 'abgeschlossen';

-- Wer den Vorgang ausgelöst hat (Fachkonzept §2): je Vorgang höchstens einer. Kontaktdaten und Statuslink fallen nach der Frist weg
-- (`entfernt_at`); der Vorgang bleibt.
CREATE TABLE IF NOT EXISTS avesmaps_community.melder (
    vorgang_id BIGINT PRIMARY KEY REFERENCES avesmaps_community.vorgang (id) ON DELETE CASCADE,
    name TEXT,
    mail TEXT,
    discord_id TEXT,
    person_id UUID REFERENCES avesmaps_auth.person (id),
    -- sha256 des Schlüssels der Statusseite; der Schlüssel selbst steht nur beim Melder (Fragment der Adresse).
    schluessel_hash BYTEA UNIQUE,
    entfernt_at TIMESTAMPTZ,
    CONSTRAINT melder_name CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT melder_mail CHECK (mail IS NULL OR char_length(mail) BETWEEN 3 AND 254),
    CONSTRAINT melder_hash CHECK (schluessel_hash IS NULL OR octet_length(schluessel_hash) = 32),
    CONSTRAINT melder_entfernt CHECK (
        entfernt_at IS NULL OR (name IS NULL AND mail IS NULL AND discord_id IS NULL AND person_id IS NULL AND schluessel_hash IS NULL)
    )
);

-- Worauf sich ein Vorgang bezieht (Fachkonzept §6): ein Kartenobjekt mit Schnappschuss oder eine Stelle. Ein Vorschlag wird gezeigt, nie
-- angewandt. Lagen in Kartenkoordinaten (aventuria-v1).
CREATE TABLE IF NOT EXISTS avesmaps_community.bezug (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vorgang_id BIGINT NOT NULL REFERENCES avesmaps_community.vorgang (id) ON DELETE CASCADE,
    art TEXT NOT NULL,
    objekt_art TEXT,
    objekt_id UUID,
    name TEXT,
    typ TEXT,
    lage_x DOUBLE PRECISION,
    lage_y DOUBLE PRECISION,
    vorschlag_x DOUBLE PRECISION,
    vorschlag_y DOUBLE PRECISION,
    naechster_ort TEXT,
    CONSTRAINT bezug_art CHECK (art IN ('objekt', 'stelle')),
    CONSTRAINT bezug_objekt CHECK (
        (art = 'objekt') = (objekt_art IS NOT NULL AND objekt_id IS NOT NULL AND name IS NOT NULL)
    ),
    CONSTRAINT bezug_objekt_art CHECK (objekt_art IS NULL OR objekt_art IN ('place', 'path', 'area', 'territory', 'peak', 'powerline')),
    CONSTRAINT bezug_stelle CHECK (art <> 'stelle' OR (lage_x IS NOT NULL AND lage_y IS NOT NULL)),
    CONSTRAINT bezug_lage CHECK ((lage_x IS NULL) = (lage_y IS NULL)),
    CONSTRAINT bezug_vorschlag CHECK ((vorschlag_x IS NULL) = (vorschlag_y IS NULL) AND (vorschlag_x IS NULL OR art = 'objekt')),
    CONSTRAINT bezug_name CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT bezug_typ CHECK (typ IS NULL OR char_length(typ) BETWEEN 1 AND 80),
    CONSTRAINT bezug_naechster_ort CHECK (naechster_ort IS NULL OR char_length(naechster_ort) BETWEEN 1 AND 200)
);
CREATE INDEX IF NOT EXISTS bezug_vorgang ON avesmaps_community.bezug (vorgang_id);
CREATE INDEX IF NOT EXISTS bezug_objekt ON avesmaps_community.bezug (objekt_id) WHERE objekt_id IS NOT NULL;

-- Austausch nach außen (Fachkonzept §2): eingehend vom Melder, ausgehend an ihn. `text` NULL heißt: vom Personenbezug befreit.
CREATE TABLE IF NOT EXISTS avesmaps_community.nachricht (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vorgang_id BIGINT NOT NULL REFERENCES avesmaps_community.vorgang (id) ON DELETE CASCADE,
    richtung TEXT NOT NULL,
    weg TEXT NOT NULL,
    text TEXT,
    von_person UUID REFERENCES avesmaps_auth.person (id),
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    operation_id UUID NOT NULL UNIQUE,
    CONSTRAINT nachricht_richtung CHECK (richtung IN ('ein', 'aus')),
    CONSTRAINT nachricht_weg CHECK (weg IN ('formular', 'statusseite', 'mail', 'discord', 'redaktion')),
    CONSTRAINT nachricht_text CHECK (text IS NULL OR char_length(text) BETWEEN 1 AND 4000),
    CONSTRAINT nachricht_von CHECK (richtung = 'aus' OR von_person IS NULL)
);
CREATE INDEX IF NOT EXISTS nachricht_vorgang ON avesmaps_community.nachricht (vorgang_id, at);

-- Interner Text der Redaktion. Geht nie nach außen; keine öffentliche Funktion liest diese Tafel.
CREATE TABLE IF NOT EXISTS avesmaps_community.notiz (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vorgang_id BIGINT NOT NULL REFERENCES avesmaps_community.vorgang (id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    von_person UUID REFERENCES avesmaps_auth.person (id),
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    operation_id UUID NOT NULL UNIQUE,
    CONSTRAINT notiz_text CHECK (char_length(text) BETWEEN 1 AND 4000)
);
CREATE INDEX IF NOT EXISTS notiz_vorgang ON avesmaps_community.notiz (vorgang_id, at);

-- Ausdrückliche Beziehungen (Fachkonzept §2). Im ersten Schnitt die Dublette; Software-Issue, Korrektur und Herkunft folgen (C7, C8).
CREATE TABLE IF NOT EXISTS avesmaps_community.verknuepfung (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vorgang_id BIGINT NOT NULL REFERENCES avesmaps_community.vorgang (id) ON DELETE CASCADE,
    art TEXT NOT NULL,
    ziel_vorgang BIGINT REFERENCES avesmaps_community.vorgang (id) ON DELETE CASCADE,
    ziel TEXT,
    von_person UUID REFERENCES avesmaps_auth.person (id),
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT verknuepfung_art CHECK (art IN ('dublette_von', 'gehoert_zu', 'ops', 'korrektur', 'herkunft')),
    CONSTRAINT verknuepfung_ziel CHECK ((ziel_vorgang IS NULL) <> (ziel IS NULL)),
    CONSTRAINT verknuepfung_vorgang CHECK (art NOT IN ('dublette_von', 'gehoert_zu') OR ziel_vorgang IS NOT NULL),
    CONSTRAINT verknuepfung_nicht_selbst CHECK (ziel_vorgang IS DISTINCT FROM vorgang_id)
);
CREATE INDEX IF NOT EXISTS verknuepfung_vorgang ON avesmaps_community.verknuepfung (vorgang_id);

-- Wer wann was tat (Fachkonzept §11): nur anhängen. Eine Begründung ist ein Ereignis und bleibt unveränderlich im Verlauf.
CREATE TABLE IF NOT EXISTS avesmaps_community.ereignis (
    vorgang_id BIGINT NOT NULL REFERENCES avesmaps_community.vorgang (id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    art TEXT NOT NULL,
    von_person UUID REFERENCES avesmaps_auth.person (id),
    vom_melder BOOLEAN NOT NULL DEFAULT false,
    alt TEXT,
    neu TEXT,
    text TEXT,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    operation_id UUID UNIQUE,
    PRIMARY KEY (vorgang_id, seq),
    CONSTRAINT ereignis_art CHECK (art IN (
        'eingang', 'gesichtet', 'uebernommen', 'zustaendig', 'prioritaet', 'rueckfrage', 'antwort', 'abgeschlossen', 'wiedereroeffnet',
        'papierkorb', 'wiederhergestellt', 'archiviert', 'zurueckgezogen', 'personenbezug_geloescht', 'kontakt_abgelaufen'
    )),
    CONSTRAINT ereignis_text CHECK (text IS NULL OR char_length(text) BETWEEN 1 AND 2000)
);

-- --- Hilfen (nur intern; kein EXECUTE für irgendeine Rolle) ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION avesmaps_community._fehler(p_code TEXT, p_text TEXT) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION '%', p_text USING ERRCODE = p_code;
END;
$$;

CREATE OR REPLACE FUNCTION avesmaps_community._com(p_id BIGINT) RETURNS TEXT
    LANGUAGE sql
    IMMUTABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT 'COM-' || lpad(p_id::text, 6, '0');
$$;

-- Den Vorgang sperren und lesen; nicht gefunden → KC404.
CREATE OR REPLACE FUNCTION avesmaps_community._sperre(p_id BIGINT) RETURNS avesmaps_community.vorgang
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    SELECT * INTO v FROM avesmaps_community.vorgang WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM avesmaps_community._fehler('KC404', format('community_not_found: %s', avesmaps_community._com(p_id)));
    END IF;
    RETURN v;
END;
$$;

-- Sperren und die Revision prüfen: Wer mit einem veralteten Stand speichert, bekommt den Konflikt (Fachkonzept §4.5).
CREATE OR REPLACE FUNCTION avesmaps_community._pruefe(p_id BIGINT, p_revision INTEGER) RETURNS avesmaps_community.vorgang
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    v := avesmaps_community._sperre(p_id);
    IF v.revision <> p_revision THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_conflict: der Vorgang hat sich inzwischen geändert');
    END IF;
    RETURN v;
END;
$$;

-- Ein Ereignis anhängen; zählt die Revision hoch und setzt die letzte Aktivität.
CREATE OR REPLACE FUNCTION avesmaps_community._ereignis(
    p_vorgang BIGINT, p_art TEXT, p_person UUID, p_vom_melder BOOLEAN, p_alt TEXT, p_neu TEXT, p_text TEXT, p_operation UUID
) RETURNS INTEGER
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_seq INTEGER;
    v_revision INTEGER;
BEGIN
    SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM avesmaps_community.ereignis WHERE vorgang_id = p_vorgang;
    INSERT INTO avesmaps_community.ereignis (vorgang_id, seq, art, von_person, vom_melder, alt, neu, text, operation_id)
    VALUES (p_vorgang, v_seq, p_art, p_person, p_vom_melder, p_alt, p_neu, NULLIF(btrim(p_text), ''), p_operation);
    UPDATE avesmaps_community.vorgang SET revision = revision + 1, aktiv_at = now() WHERE id = p_vorgang
    RETURNING revision INTO v_revision;
    RETURN v_revision;
END;
$$;

-- Schon geschehen? Jede schreibende Funktion trägt eine `operation_id`; dieselbe noch einmal ist kein Fehler, sondern nichts.
CREATE OR REPLACE FUNCTION avesmaps_community._schon(p_operation UUID) RETURNS BOOLEAN
    LANGUAGE sql
    STABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT EXISTS (SELECT 1 FROM avesmaps_community.ereignis WHERE operation_id = p_operation)
        OR EXISTS (SELECT 1 FROM avesmaps_community.nachricht WHERE operation_id = p_operation)
        OR EXISTS (SELECT 1 FROM avesmaps_community.notiz WHERE operation_id = p_operation)
        OR EXISTS (SELECT 1 FROM avesmaps_community.vorgang WHERE operation_id = p_operation);
$$;

-- Der Vorgang zum Schlüssel der Statusseite; fehlt er, ist er im Papierkorb oder abgelaufen → KC404 ohne Hinweis, ob es ihn gab.
CREATE OR REPLACE FUNCTION avesmaps_community._zum_schluessel(p_hash BYTEA) RETURNS BIGINT
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    SELECT m.vorgang_id INTO v_id
      FROM avesmaps_community.melder m
      JOIN avesmaps_community.vorgang v ON v.id = m.vorgang_id
     WHERE m.schluessel_hash = p_hash AND v.papierkorb_at IS NULL;
    IF v_id IS NULL THEN
        PERFORM avesmaps_community._fehler('KC404', 'community_not_found: kein Vorgang zu diesem Schlüssel');
    END IF;
    RETURN v_id;
END;
$$;

-- Ein abgeschlossener Vorgang geht wieder in Arbeit (Wiedereröffnen, Antwort des Melders, Wiederherstellen).
CREATE OR REPLACE FUNCTION avesmaps_community._oeffnen(p_vorgang BIGINT) RETURNS void
    LANGUAGE sql
    SET search_path = pg_catalog, pg_temp
AS $$
    UPDATE avesmaps_community.vorgang
       SET zustand = 'in_arbeit', ergebnis = NULL, abgeschlossen_at = NULL, archiviert_at = NULL, papierkorb_at = NULL
     WHERE id = p_vorgang;
$$;

-- --- Öffentlich (die App hat Grenze, Honigtopf und Zeitfalle geprüft; der Melder ist niemand Angemeldetes) -----------------------------

-- Eine Meldung von der Website. `p_bezug`: {art, objektArt, objektId, name, typ, lage {x,y}, vorschlagLage {x,y}, naechsterOrt}.
CREATE OR REPLACE FUNCTION avesmaps_community.community_melden(
    p_operation UUID, p_kategorie TEXT, p_text TEXT, p_quelle TEXT, p_fehlt_art TEXT, p_name TEXT, p_schluessel_hash BYTEA, p_bezug JSONB
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_art TEXT := p_bezug->>'art';
BEGIN
    SELECT id INTO v_id FROM avesmaps_community.vorgang WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF char_length(btrim(COALESCE(p_text, ''))) NOT BETWEEN 10 AND 2000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Beschreibung braucht 10 bis 2000 Zeichen');
    END IF;
    IF p_schluessel_hash IS NULL OR v_art IS NULL OR v_art NOT IN ('objekt', 'stelle') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: Schlüssel und Bezug sind Pflicht');
    END IF;
    INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, quelle, fehlt_art, operation_id)
    VALUES ('meldung', p_kategorie, 'website', NULLIF(btrim(p_quelle), ''), p_fehlt_art, p_operation)
    RETURNING id INTO v_id;
    INSERT INTO avesmaps_community.melder (vorgang_id, name, schluessel_hash)
    VALUES (v_id, NULLIF(btrim(p_name), ''), p_schluessel_hash);
    INSERT INTO avesmaps_community.bezug (
        vorgang_id, art, objekt_art, objekt_id, name, typ, lage_x, lage_y, vorschlag_x, vorschlag_y, naechster_ort
    ) VALUES (
        v_id, v_art,
        CASE WHEN v_art = 'objekt' THEN p_bezug->>'objektArt' END,
        CASE WHEN v_art = 'objekt' THEN (p_bezug->>'objektId')::uuid END,
        CASE WHEN v_art = 'objekt' THEN NULLIF(btrim(p_bezug->>'name'), '') END,
        NULLIF(btrim(p_bezug->>'typ'), ''),
        (p_bezug->'lage'->>'x')::double precision, (p_bezug->'lage'->>'y')::double precision,
        (p_bezug->'vorschlagLage'->>'x')::double precision, (p_bezug->'vorschlagLage'->>'y')::double precision,
        NULLIF(btrim(p_bezug->>'naechsterOrt'), '')
    );
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, operation_id)
    VALUES (v_id, 'ein', 'formular', btrim(p_text), gen_random_uuid());
    PERFORM avesmaps_community._ereignis(v_id, 'eingang', NULL, true, NULL, 'neu', NULL, NULL);
    RETURN v_id;
END;
$$;

-- Was der Melder auf der Statusseite sieht (Bedienkonzept §5): nie Notizen, nie Namen der Redaktion, keine Begründung. NULL, wenn es zum
-- Schlüssel keinen Vorgang (mehr) gibt.
CREATE OR REPLACE FUNCTION avesmaps_community.community_status_lesen(p_hash BYTEA) RETURNS JSONB
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    SELECT g.* INTO v
      FROM avesmaps_community.melder m
      JOIN avesmaps_community.vorgang g ON g.id = m.vorgang_id
     WHERE m.schluessel_hash = p_hash AND g.papierkorb_at IS NULL;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    RETURN jsonb_build_object(
        'nummer', avesmaps_community._com(v.id),
        'art', v.art,
        'kategorie', v.kategorie,
        'zustand', v.zustand,
        'ergebnis', v.ergebnis,
        'eingegangenAt', v.eingegangen_at,
        'bezugName', (SELECT COALESCE(b.name, b.naechster_ort) FROM avesmaps_community.bezug b WHERE b.vorgang_id = v.id ORDER BY b.id LIMIT 1),
        'nachrichten', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('richtung', n.richtung, 'text', n.text, 'at', n.at) ORDER BY n.at, n.id)
              FROM avesmaps_community.nachricht n
             WHERE n.vorgang_id = v.id
        ), '[]'::jsonb)
    );
END;
$$;

-- Antwort oder Ergänzung des Melders über die Statusseite: aus der Rückfrage zurück in Arbeit; ein abgeschlossener Vorgang öffnet sich
-- wieder („durch Antwort wieder geöffnet“, Fachkonzept §4.2). Ein zurückgezogener bleibt zu.
CREATE OR REPLACE FUNCTION avesmaps_community.community_status_antworten(p_operation UUID, p_hash BYTEA, p_text TEXT) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    v := avesmaps_community._sperre(avesmaps_community._zum_schluessel(p_hash));
    IF avesmaps_community._schon(p_operation) THEN
        RETURN v.revision;
    END IF;
    IF v.ergebnis = 'zurueckgezogen' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: die Meldung ist zurückgezogen');
    END IF;
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, operation_id)
    VALUES (v.id, 'ein', 'statusseite', btrim(p_text), p_operation);
    IF v.zustand = 'abgeschlossen' THEN
        PERFORM avesmaps_community._oeffnen(v.id);
        PERFORM avesmaps_community._ereignis(v.id, 'wiedereroeffnet', NULL, true, v.ergebnis, 'in_arbeit', 'durch Antwort wieder geöffnet', NULL);
    ELSIF v.zustand = 'rueckfrage' THEN
        UPDATE avesmaps_community.vorgang SET zustand = 'in_arbeit', rueckfrage_at = NULL WHERE id = v.id;
    END IF;
    RETURN avesmaps_community._ereignis(v.id, 'antwort', NULL, true, v.zustand, NULL, NULL, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION avesmaps_community.community_status_zurueckziehen(p_operation UUID, p_hash BYTEA) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    v := avesmaps_community._sperre(avesmaps_community._zum_schluessel(p_hash));
    IF avesmaps_community._schon(p_operation) THEN
        RETURN v.revision;
    END IF;
    IF v.zustand = 'abgeschlossen' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: der Vorgang ist schon abgeschlossen');
    END IF;
    UPDATE avesmaps_community.vorgang
       SET zustand = 'abgeschlossen', ergebnis = 'zurueckgezogen', abgeschlossen_at = now(), rueckfrage_at = NULL
     WHERE id = v.id;
    RETURN avesmaps_community._ereignis(v.id, 'zurueckgezogen', NULL, true, v.zustand, 'zurueckgezogen', NULL, p_operation);
END;
$$;

-- --- Redaktion (die App hat die Person angemeldet und ihr Recht geprüft) ----------------------------------------------------------------

-- Sichten: aus „neu“ in Arbeit, ohne Zuständigkeit.
CREATE OR REPLACE FUNCTION avesmaps_community.community_sichten(p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    IF v.zustand <> 'neu' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur ein neuer Vorgang wird gesichtet');
    END IF;
    UPDATE avesmaps_community.vorgang SET zustand = 'in_arbeit' WHERE id = p_id;
    RETURN avesmaps_community._ereignis(p_id, 'gesichtet', p_person, false, 'neu', 'in_arbeit', NULL, p_operation);
END;
$$;

-- Übernehmen: sichtet und macht mich zuständig.
CREATE OR REPLACE FUNCTION avesmaps_community.community_uebernehmen(p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    IF v.zustand = 'abgeschlossen' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: ein abgeschlossener Vorgang wird erst wieder geöffnet');
    END IF;
    UPDATE avesmaps_community.vorgang
       SET zustaendig = p_person, zustand = CASE WHEN zustand = 'neu' THEN 'in_arbeit' ELSE zustand END
     WHERE id = p_id;
    RETURN avesmaps_community._ereignis(
        p_id, 'uebernommen', p_person, false, v.zustaendig::text, p_person::text, NULL, p_operation
    );
END;
$$;

-- Zuständigkeit setzen oder leeren. Wer andere einsetzt, braucht `moderate_community`; das prüft die Route.
CREATE OR REPLACE FUNCTION avesmaps_community.community_zustaendig(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_ziel UUID
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    UPDATE avesmaps_community.vorgang SET zustaendig = p_ziel WHERE id = p_id;
    RETURN avesmaps_community._ereignis(p_id, 'zustaendig', p_person, false, v.zustaendig::text, p_ziel::text, NULL, p_operation);
END;
$$;

CREATE OR REPLACE FUNCTION avesmaps_community.community_prioritaet(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_prioritaet TEXT
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    UPDATE avesmaps_community.vorgang SET prioritaet = p_prioritaet WHERE id = p_id;
    RETURN avesmaps_community._ereignis(p_id, 'prioritaet', p_person, false, v.prioritaet, p_prioritaet, NULL, p_operation);
END;
$$;

-- Notiz: hängt nur an, prüft keine Revision und zählt sie nicht hoch (niemand, der gerade etwas anderes tut, soll einen Konflikt sehen).
CREATE OR REPLACE FUNCTION avesmaps_community.community_notiz(p_operation UUID, p_id BIGINT, p_person UUID, p_text TEXT)
    RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_notiz BIGINT;
BEGIN
    SELECT id INTO v_notiz FROM avesmaps_community.notiz WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_notiz;
    END IF;
    PERFORM avesmaps_community._sperre(p_id);
    INSERT INTO avesmaps_community.notiz (vorgang_id, text, von_person, operation_id)
    VALUES (p_id, btrim(p_text), p_person, p_operation)
    RETURNING id INTO v_notiz;
    UPDATE avesmaps_community.vorgang SET aktiv_at = now() WHERE id = p_id;
    RETURN v_notiz;
END;
$$;

-- Rückfrage an den Melder (Statusseite; Mail folgt mit dem Mailweg C6). Ohne Rückweg gesperrt.
CREATE OR REPLACE FUNCTION avesmaps_community.community_rueckfrage(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_text TEXT
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    IF v.zustand = 'abgeschlossen' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: ein abgeschlossener Vorgang wird erst wieder geöffnet');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM avesmaps_community.melder WHERE vorgang_id = p_id AND (schluessel_hash IS NOT NULL OR mail IS NOT NULL)
    ) THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: kein Rückweg zum Melder');
    END IF;
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, von_person, operation_id)
    VALUES (p_id, 'aus', 'statusseite', btrim(p_text), p_person, p_operation);
    UPDATE avesmaps_community.vorgang SET zustand = 'rueckfrage', rueckfrage_at = now() WHERE id = p_id;
    RETURN avesmaps_community._ereignis(p_id, 'rueckfrage', p_person, false, v.zustand, 'rueckfrage', NULL, NULL);
END;
$$;

-- Abschließen mit Ergebnis und Begründung (Pflicht, bleibt im Verlauf); Nachricht an den Melder freiwillig; Dublette mit Verweis.
CREATE OR REPLACE FUNCTION avesmaps_community.community_abschliessen(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_ergebnis TEXT, p_begruendung TEXT, p_nachricht TEXT,
    p_dublette_von BIGINT
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    IF v.zustand = 'abgeschlossen' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: der Vorgang ist schon abgeschlossen');
    END IF;
    IF p_ergebnis IS NULL OR p_ergebnis IN ('spam', 'zurueckgezogen')
       OR (v.art = 'meldung' AND p_ergebnis IN ('beantwortet', 'erledigt'))
       OR (v.art = 'anfrage' AND p_ergebnis IN ('umgesetzt', 'bereits_richtig')) THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: dieses Ergebnis setzt man hier nicht beim Abschließen');
    END IF;
    IF char_length(btrim(COALESCE(p_begruendung, ''))) = 0 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Begründung ist Pflicht');
    END IF;
    IF (p_ergebnis = 'dublette') <> (p_dublette_von IS NOT NULL) THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: eine Dublette nennt den Vorgang, von dem sie eine ist');
    END IF;
    IF p_dublette_von IS NOT NULL THEN
        IF p_dublette_von = p_id OR NOT EXISTS (SELECT 1 FROM avesmaps_community.vorgang WHERE id = p_dublette_von) THEN
            PERFORM avesmaps_community._fehler('KC404', format('community_not_found: %s', avesmaps_community._com(p_dublette_von)));
        END IF;
        INSERT INTO avesmaps_community.verknuepfung (vorgang_id, art, ziel_vorgang, von_person)
        VALUES (p_id, 'dublette_von', p_dublette_von, p_person);
    END IF;
    IF NULLIF(btrim(p_nachricht), '') IS NOT NULL THEN
        INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, von_person, operation_id)
        VALUES (p_id, 'aus', 'statusseite', btrim(p_nachricht), p_person, gen_random_uuid());
    END IF;
    UPDATE avesmaps_community.vorgang
       SET zustand = 'abgeschlossen', ergebnis = p_ergebnis, abgeschlossen_at = now(), rueckfrage_at = NULL
     WHERE id = p_id;
    RETURN avesmaps_community._ereignis(p_id, 'abgeschlossen', p_person, false, v.zustand, p_ergebnis, p_begruendung, p_operation);
END;
$$;

-- Wiedereröffnen aus „abgeschlossen“ oder dem Archiv; Grund Pflicht; das Ergebnis bleibt im Verlauf (alt).
CREATE OR REPLACE FUNCTION avesmaps_community.community_wiedereroeffnen(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_grund TEXT
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    IF v.zustand <> 'abgeschlossen' OR v.papierkorb_at IS NOT NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur ein abgeschlossener Vorgang wird wieder geöffnet');
    END IF;
    IF char_length(btrim(COALESCE(p_grund, ''))) = 0 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Grund ist Pflicht');
    END IF;
    PERFORM avesmaps_community._oeffnen(p_id);
    RETURN avesmaps_community._ereignis(p_id, 'wiedereroeffnet', p_person, false, v.ergebnis, 'in_arbeit', p_grund, p_operation);
END;
$$;

-- Ins Archiv von Hand (sonst nach 30 Tagen von selbst).
CREATE OR REPLACE FUNCTION avesmaps_community.community_archivieren(p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    IF v.zustand <> 'abgeschlossen' OR v.papierkorb_at IS NOT NULL OR v.archiviert_at IS NOT NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: ins Archiv geht nur ein abgeschlossener Vorgang');
    END IF;
    UPDATE avesmaps_community.vorgang SET archiviert_at = now() WHERE id = p_id;
    RETURN avesmaps_community._ereignis(p_id, 'archiviert', p_person, false, NULL, NULL, NULL, p_operation);
END;
$$;

-- Spam: in den Papierkorb, keine Nachricht an den Absender; nach 30 Tagen weg. `moderate_community` prüft die Route.
CREATE OR REPLACE FUNCTION avesmaps_community.community_papierkorb(p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    IF v.papierkorb_at IS NOT NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: der Vorgang liegt schon im Papierkorb');
    END IF;
    UPDATE avesmaps_community.vorgang
       SET zustand = 'abgeschlossen', ergebnis = 'spam', abgeschlossen_at = now(), archiviert_at = NULL, papierkorb_at = now(),
           rueckfrage_at = NULL
     WHERE id = p_id;
    RETURN avesmaps_community._ereignis(p_id, 'papierkorb', p_person, false, v.zustand, 'spam', NULL, p_operation);
END;
$$;

CREATE OR REPLACE FUNCTION avesmaps_community.community_wiederherstellen(p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    IF v.papierkorb_at IS NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur aus dem Papierkorb wird wiederhergestellt');
    END IF;
    PERFORM avesmaps_community._oeffnen(p_id);
    RETURN avesmaps_community._ereignis(p_id, 'wiederhergestellt', p_person, false, 'spam', 'in_arbeit', NULL, p_operation);
END;
$$;

-- Personenbezug löschen (Fachkonzept §10.4, Datenschutzanfrage): Melderdaten und seine Texte weg, Sachinhalt bleibt, Ereignis ohne Inhalt.
-- `moderate_community` mit frischem Passkey prüft die Route.
CREATE OR REPLACE FUNCTION avesmaps_community.community_personenbezug_loeschen(p_operation UUID, p_id BIGINT, p_person UUID)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.vorgang WHERE id = p_id);
    END IF;
    PERFORM avesmaps_community._sperre(p_id);
    UPDATE avesmaps_community.melder
       SET name = NULL, mail = NULL, discord_id = NULL, person_id = NULL, schluessel_hash = NULL, entfernt_at = now()
     WHERE vorgang_id = p_id;
    UPDATE avesmaps_community.nachricht SET text = NULL WHERE vorgang_id = p_id AND richtung = 'ein';
    RETURN avesmaps_community._ereignis(p_id, 'personenbezug_geloescht', p_person, false, NULL, NULL, NULL, p_operation);
END;
$$;

-- --- Jobs: Aufbewahrung (Fachkonzept §10.2) ----------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION avesmaps_community.community_purge_expired() RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_archiviert INTEGER := 0;
    v_kontakt INTEGER := 0;
    v_geloescht INTEGER;
BEGIN
    -- Erledigt wandert nach 30 Tagen ins Archiv.
    FOR v_id IN
        SELECT id FROM avesmaps_community.vorgang
         WHERE zustand = 'abgeschlossen' AND papierkorb_at IS NULL AND archiviert_at IS NULL
           AND abgeschlossen_at < now() - interval '30 days'
         ORDER BY id
           FOR UPDATE
    LOOP
        UPDATE avesmaps_community.vorgang SET archiviert_at = now() WHERE id = v_id;
        PERFORM avesmaps_community._ereignis(v_id, 'archiviert', NULL, false, NULL, NULL, NULL, NULL);
        v_archiviert := v_archiviert + 1;
    END LOOP;
    -- Kontaktdaten und Statuslink 90 Tage nach dem Abschluss; Texte und Meldung bleiben im Archiv.
    FOR v_id IN
        SELECT m.vorgang_id FROM avesmaps_community.melder m
          JOIN avesmaps_community.vorgang v ON v.id = m.vorgang_id
         WHERE m.entfernt_at IS NULL AND v.zustand = 'abgeschlossen' AND v.abgeschlossen_at < now() - interval '90 days'
         ORDER BY m.vorgang_id
           FOR UPDATE OF v
    LOOP
        UPDATE avesmaps_community.melder
           SET name = NULL, mail = NULL, discord_id = NULL, person_id = NULL, schluessel_hash = NULL, entfernt_at = now()
         WHERE vorgang_id = v_id;
        PERFORM avesmaps_community._ereignis(v_id, 'kontakt_abgelaufen', NULL, false, NULL, NULL, NULL, NULL);
        v_kontakt := v_kontakt + 1;
    END LOOP;
    -- Papierkorb nach 30 Tagen endgültig weg (samt Melder, Bezug, Nachrichten, Notizen, Verlauf).
    DELETE FROM avesmaps_community.vorgang WHERE papierkorb_at < now() - interval '30 days';
    GET DIAGNOSTICS v_geloescht = ROW_COUNT;
    RETURN jsonb_build_object('archiviert', v_archiviert, 'kontakt', v_kontakt, 'geloescht', v_geloescht);
END;
$$;

-- Konto auflösen (WI-0120 A15, wie `redact_person_kanal`): Zuständigkeit, Verfasser und Melderkonto ohne die Person.
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
    RETURN v_summe;
END;
$$;

-- Keine Funktion des Schemas darf zunächst jeder aufrufen; wer was darf, steht in `community-grants.psql`.
DO $$
DECLARE
    f RECORD;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'avesmaps_community'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    END LOOP;
END;
$$;
