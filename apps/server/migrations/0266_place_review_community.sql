-- Bewertungen im Community-Modul (WI-0269 C10; Fachkonzept project-control/planning/community-fachkonzept.md §14, Bedienkonzept §6.1 bis §6.3):
-- Eine Bewertung kann jetzt von der Website kommen, hat einen Zustand (neu, gesichtet, zurückgehalten, verborgen), wird von der Redaktion
-- gesichtet, freigegeben, verborgen und eingeblendet, trägt eine anonyme Zahl „Gefällt mir“ und kann gemeldet werden.
--
-- 🔴 REIN ERWEITERND (docs/regeln/entwicklung.md „Migrationen: erst erweitern, dann umstellen, dann entfernen“; `migration-compat.test.ts`):
--   - Neue Spalten an `place_review` tragen alle eine Vorgabe oder sind nullable. Der Import des vorigen Releases legt Zeilen weiter ohne sie an
--     und bekommt `gesichtet` (Fachkonzept §14.3: Legacy-Zeilen standen dort öffentlich und wurden dort moderiert).
--   - `legacy_review_id` und `legacy_created_at` werden nullable (Website-Bewertungen haben sie nicht); der neue CHECK `place_review_herkunft`
--     verlangt sie weiter für die Herkunft `legacy`. Nichts wird entfernt, nichts umbenannt, keine Funktion ändert ihre Argumentliste.
--   - Der Import setzt den Zustand NUR beim Anlegen (die Vorgabe `gesichtet`); seine Spaltenliste (`REVIEW_COLUMNS`) nennt ihn nicht, ein Update
--     fasst ihn nie an. Eine Zeile mit gelöschtem Inhalt (`inhalt_geloescht_at`) fasst der Import gar nicht mehr an (`protectedWhere`).
--
-- Schreiben NUR über die Funktionen des Schemas `avesmaps_community` (SECURITY DEFINER, Muster 0265): Revision, Idempotenz je `operation_id`,
-- Fehler der Klasse `KC` (KC404 nicht gefunden, KC409 Übergang oder Revision, KC422 ungültige Angabe). Die Rechte der App-Rolle stehen in
-- `apps/server/src/db/community-grants.psql`: SELECT an der Tafel, EXECUTE an den Funktionen, kein INSERT, UPDATE oder DELETE mehr an `place_review`.
--
-- Datensparsam (Fachkonzept §14.4): KEINE IP, kein User-Agent, keine Seitenadresse, kein Adress-Hash. Die Zahl „Gefällt mir“ ist nur eine Zahl.
-- Der Statuslink ist nur der Hash eines Schlüssels (den Link verschickt erst der Mailweg C6; hier ist nur die Spalte da).
--
-- Bezug einer gemeldeten Bewertung: die Meldung ist ein normaler Vorgang mit Bezug auf den ORT (wie bisher) und zusätzlich auf die Bewertung
-- (`bezug.bewertung_id`, weich wie `objekt_id`, ohne Fremdschlüssel: `place_review` wandert mit dem Abzug, das Community-Schema nie, und ein
-- TRUNCATE der Tafel scheitert an einem Fremdschlüssel von außen). Die Meldung trägt KEINEN Schnappschuss des Inhalts: Wird der Inhalt gelöscht,
-- bleibt im Vorgang nichts davon zurück.

-- --- place_review ----------------------------------------------------------------------------------------------------------------------

ALTER TABLE place_review
    ADD COLUMN IF NOT EXISTS public_id UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS operation_id UUID,
    ADD COLUMN IF NOT EXISTS zustand TEXT NOT NULL DEFAULT 'gesichtet',
    ADD COLUMN IF NOT EXISTS eingang TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS grund TEXT,
    ADD COLUMN IF NOT EXISTS statuslink_hash BYTEA,
    ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS gefaellt INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS inhalt_geloescht_at TIMESTAMPTZ;

ALTER TABLE place_review ALTER COLUMN legacy_review_id DROP NOT NULL;
ALTER TABLE place_review ALTER COLUMN legacy_created_at DROP NOT NULL;

ALTER TABLE place_review DROP CONSTRAINT IF EXISTS place_review_herkunft;
ALTER TABLE place_review ADD CONSTRAINT place_review_herkunft CHECK (
    source_system <> 'legacy' OR (legacy_review_id IS NOT NULL AND legacy_created_at IS NOT NULL)
);
ALTER TABLE place_review DROP CONSTRAINT IF EXISTS place_review_zustand;
ALTER TABLE place_review ADD CONSTRAINT place_review_zustand CHECK (zustand IN ('neu', 'gesichtet', 'zurueckgehalten', 'verborgen'));
-- Der Grund gehört zum Zustand: bei „zurückgehalten“ der Verdacht (Adresse im Text, Wortliste), bei „verborgen“ der Grund der Redaktion
-- (Fachkonzept §14.3), sonst keiner.
ALTER TABLE place_review DROP CONSTRAINT IF EXISTS place_review_grund;
ALTER TABLE place_review ADD CONSTRAINT place_review_grund CHECK (
    (zustand = 'zurueckgehalten' AND grund IN ('adresse', 'wortliste'))
    OR (zustand = 'verborgen' AND grund IN ('beleidigend', 'spam', 'ort', 'person', 'sonstiges'))
    OR (zustand IN ('neu', 'gesichtet') AND grund IS NULL)
);
ALTER TABLE place_review DROP CONSTRAINT IF EXISTS place_review_zaehler;
ALTER TABLE place_review ADD CONSTRAINT place_review_zaehler CHECK (revision >= 1 AND gefaellt >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS place_review_public_id ON place_review (public_id);
CREATE UNIQUE INDEX IF NOT EXISTS place_review_operation ON place_review (operation_id) WHERE operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS place_review_statuslink ON place_review (statuslink_hash) WHERE statuslink_hash IS NOT NULL;
-- Die öffentliche Liste und der Schnitt je Ort: nur öffentliche Zeilen, neueste zuerst.
CREATE INDEX IF NOT EXISTS place_review_oeffentlich ON place_review (place_id, eingang DESC, id DESC) WHERE zustand IN ('neu', 'gesichtet');
-- Die Liste der Redaktion nach Zustand.
CREATE INDEX IF NOT EXISTS place_review_zustand_idx ON place_review (zustand, eingang DESC);

COMMENT ON COLUMN place_review.public_id IS 'Öffentliche Kennung (Teilen-Link, Gefällt mir, Meldung); die laufende Nummer `id` verlässt den Server nie.';
COMMENT ON COLUMN place_review.operation_id IS 'Kennung des Absendens im Browser: dasselbe Absenden zweimal legt nur eine Bewertung an. NULL bei Zeilen aus dem Import.';
COMMENT ON COLUMN place_review.zustand IS
    'neu (öffentlich, noch nicht gesichtet), gesichtet (öffentlich), zurueckgehalten (Spamverdacht, nicht öffentlich), verborgen (nicht öffentlich). Der Import setzt ihn nur beim Anlegen (Vorgabe gesichtet).';
COMMENT ON COLUMN place_review.eingang IS 'Echte Zeit des Eingangs; bei Zeilen aus Legacy ihre Legacy-Zeit (naiv, als UTC gelesen: nur für die Reihenfolge, die Zone des Legacy-Servers ist nicht belegt).';
COMMENT ON COLUMN place_review.grund IS 'Verdacht (zurückgehalten: adresse, wortliste) oder Grund der Redaktion (verborgen: beleidigend, spam, ort, person, sonstiges).';
COMMENT ON COLUMN place_review.statuslink_hash IS 'sha256 des Schlüssels zum Ändern oder Zurückziehen (Mailweg C6); nie der Schlüssel selbst. Beim Löschen des Inhalts geleert.';
COMMENT ON COLUMN place_review.revision IS 'Zählt jede Handlung der Redaktion (Konflikt bei veraltetem Stand); „Gefällt mir“ zählt nicht mit.';
COMMENT ON COLUMN place_review.gefaellt IS 'Anonyme Zahl „Gefällt mir“. Keine Liste, wer es war; „einmal je Browser“ hält der Browser.';
COMMENT ON COLUMN place_review.inhalt_geloescht_at IS 'Name, Text und Datum sind gelöscht (Datenschutz); die Zeile bleibt verborgen als Spur. Der Import fasst sie nicht mehr an.';

-- Wer eine Legacy-Zeit trägt, dessen Eingang ist diese Zeit (nur Zeilen aus Legacy tragen sie). Der Import kennt die Spalte nicht, also setzt sie
-- ein Trigger (auch beim Nachtragen); Website-Bewertungen haben keine Legacy-Zeit und behalten den echten Eingang.
-- Die Funktion liegt im Community-Schema (dort hat die App-Rolle keinen Zugriff, jede Funktion wird unten für PUBLIC gesperrt).
CREATE OR REPLACE FUNCTION avesmaps_community._place_review_eingang() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.legacy_created_at IS NOT NULL THEN
        NEW.eingang := NEW.legacy_created_at AT TIME ZONE 'UTC';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS place_review_eingang ON place_review;
CREATE TRIGGER place_review_eingang BEFORE INSERT OR UPDATE ON place_review
    FOR EACH ROW EXECUTE FUNCTION avesmaps_community._place_review_eingang();

-- Die vorhandenen Zeilen nachtragen (der Trigger setzt den Eingang beim Aktualisieren).
UPDATE place_review SET source_system = source_system WHERE legacy_created_at IS NOT NULL;

-- --- Community-Schema: Verlauf der Bewertungen, Bezug und Kategorie ------------------------------------------------------------------

-- Wer wann was mit einer Bewertung tat (Fachkonzept §14.8): nur anhängen, ohne Inhalt. `bewertung_id` ist `place_review.public_id` (weich, ohne
-- Fremdschlüssel, siehe Kopf).
CREATE TABLE IF NOT EXISTS avesmaps_community.bewertung_ereignis (
    bewertung_id UUID NOT NULL,
    seq INTEGER NOT NULL,
    art TEXT NOT NULL,
    von_person UUID REFERENCES avesmaps_auth.person (id),
    alt TEXT,
    neu TEXT,
    text TEXT,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    operation_id UUID UNIQUE,
    PRIMARY KEY (bewertung_id, seq),
    CONSTRAINT bewertung_ereignis_art CHECK (art IN (
        'gesichtet', 'freigegeben', 'verborgen', 'eingeblendet', 'inhalt_geloescht', 'gemeldet', 'geaendert', 'zurueckgezogen'
    )),
    CONSTRAINT bewertung_ereignis_text CHECK (text IS NULL OR char_length(text) <= 200)
);
COMMENT ON TABLE avesmaps_community.bewertung_ereignis IS 'Verlauf einer Bewertung (Fachkonzept §14.8). Nie Name, Text oder Datum der Bewertung.';

ALTER TABLE avesmaps_community.bezug
    ADD COLUMN IF NOT EXISTS bewertung_id UUID,
    ADD COLUMN IF NOT EXISTS bewertung_grund TEXT;
CREATE INDEX IF NOT EXISTS bezug_bewertung ON avesmaps_community.bezug (bewertung_id) WHERE bewertung_id IS NOT NULL;
ALTER TABLE avesmaps_community.bezug DROP CONSTRAINT IF EXISTS bezug_bewertung;
ALTER TABLE avesmaps_community.bezug ADD CONSTRAINT bezug_bewertung CHECK (
    (bewertung_id IS NULL) = (bewertung_grund IS NULL)
    AND (bewertung_id IS NULL OR (art = 'objekt' AND objekt_art = 'place'))
    AND (bewertung_grund IS NULL OR bewertung_grund IN ('beleidigend', 'spam', 'ort', 'person', 'sonstiges'))
);

-- Die Kategorie „bewertung“ (Meldung zu einer Bewertung, Fachkonzept §14.5) kommt GELOCKERT dazu; die bisherigen Kategorien bleiben.
ALTER TABLE avesmaps_community.vorgang DROP CONSTRAINT IF EXISTS vorgang_kategorie;
ALTER TABLE avesmaps_community.vorgang ADD CONSTRAINT vorgang_kategorie CHECK (
    (art = 'meldung' AND kategorie IN ('lage', 'name', 'angabe', 'fehlt', 'entfaellt', 'sonstiges', 'bewertung'))
    OR (art = 'anfrage' AND kategorie IN ('frage', 'hinweis', 'mitmachen', 'rechte', 'datenschutz', 'sonstiges'))
);

-- --- Hilfen (nur intern; kein EXECUTE für irgendeine Rolle) -----------------------------------------------------------------------------

-- Die Bewertung sperren und lesen; nicht gefunden → KC404.
CREATE OR REPLACE FUNCTION avesmaps_community._bewertung_sperre(p_id UUID) RETURNS public.place_review
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v public.place_review;
BEGIN
    SELECT * INTO v FROM public.place_review WHERE public_id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM avesmaps_community._fehler('KC404', 'community_not_found: diese Bewertung gibt es nicht');
    END IF;
    RETURN v;
END;
$$;

-- Sperren und die Revision prüfen (Konflikt wie bei den Vorgängen).
CREATE OR REPLACE FUNCTION avesmaps_community._bewertung_pruefe(p_id UUID, p_revision INTEGER) RETURNS public.place_review
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v public.place_review;
BEGIN
    v := avesmaps_community._bewertung_sperre(p_id);
    IF v.revision <> p_revision THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_conflict: die Bewertung hat sich inzwischen geändert');
    END IF;
    RETURN v;
END;
$$;

-- Ein Ereignis anhängen; zählt die Revision der Bewertung hoch.
CREATE OR REPLACE FUNCTION avesmaps_community._bewertung_ereignis(
    p_id UUID, p_art TEXT, p_person UUID, p_alt TEXT, p_neu TEXT, p_text TEXT, p_operation UUID
) RETURNS INTEGER
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_seq INTEGER;
    v_revision INTEGER;
BEGIN
    SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM avesmaps_community.bewertung_ereignis WHERE bewertung_id = p_id;
    INSERT INTO avesmaps_community.bewertung_ereignis (bewertung_id, seq, art, von_person, alt, neu, text, operation_id)
    VALUES (p_id, v_seq, p_art, p_person, p_alt, p_neu, NULLIF(btrim(p_text), ''), p_operation);
    UPDATE public.place_review SET revision = revision + 1, updated_at = now() WHERE public_id = p_id RETURNING revision INTO v_revision;
    RETURN v_revision;
END;
$$;

-- Schon geschehen? Jede Handlung der Redaktion trägt eine `operation_id`; dieselbe noch einmal ist kein Fehler, sondern nichts.
CREATE OR REPLACE FUNCTION avesmaps_community._bewertung_schon(p_operation UUID) RETURNS BOOLEAN
    LANGUAGE sql
    STABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT EXISTS (SELECT 1 FROM avesmaps_community.bewertung_ereignis WHERE operation_id = p_operation);
$$;

-- --- Öffentlich (die App hat Grenze, Honigtopf und Zeitfalle geprüft; die Wortliste hat sie auch gelesen und den Zustand gewählt) ----------

-- Eine Bewertung von der Website. `p_zustand` ist `neu` oder `zurueckgehalten` (dann mit Grund `adresse` oder `wortliste`); den Verdacht
-- wählt die App, die Datenbank prüft nur, dass das Paar gültig ist. Text, Name und Datum werden hier bereinigt: Leerraum zusammengezogen,
-- Länge geprüft, leer wird NULL. Das aventurische Datum setzt die App, wenn der Besucher keines nannte. Antwort: öffentliche Kennung und Zustand.
CREATE OR REPLACE FUNCTION avesmaps_community.bewertung_schreiben(
    p_operation UUID, p_ort UUID, p_sterne INTEGER, p_text TEXT, p_name TEXT, p_datum TEXT, p_zustand TEXT, p_grund TEXT,
    p_statuslink_hash BYTEA
) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_alt public.place_review;
    v_ort_id BIGINT;
    v_text TEXT := NULLIF(regexp_replace(btrim(COALESCE(p_text, '')), '\s+', ' ', 'g'), '');
    v_name TEXT := NULLIF(regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g'), '');
    v_datum TEXT := NULLIF(regexp_replace(btrim(COALESCE(p_datum, '')), '\s+', ' ', 'g'), '');
    v_neu public.place_review;
BEGIN
    SELECT * INTO v_alt FROM public.place_review WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN jsonb_build_object('id', v_alt.public_id, 'zustand', v_alt.zustand);
    END IF;
    IF p_sterne IS NULL OR p_sterne NOT BETWEEN 1 AND 5 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Wertung braucht 1 bis 5 Sterne');
    END IF;
    IF char_length(COALESCE(v_text, '')) > 200 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Text darf höchstens 200 Zeichen haben');
    END IF;
    IF char_length(COALESCE(v_name, '')) > 80 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Name darf höchstens 80 Zeichen haben');
    END IF;
    IF char_length(COALESCE(v_datum, '')) > 60 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: das Datum darf höchstens 60 Zeichen haben');
    END IF;
    IF p_statuslink_hash IS NOT NULL AND octet_length(p_statuslink_hash) <> 32 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Schlüssel des Statuslinks ist kein sha256');
    END IF;
    IF p_zustand IS NULL OR p_zustand NOT IN ('neu', 'zurueckgehalten')
       OR (p_zustand = 'neu') <> (p_grund IS NULL)
       OR (p_zustand = 'zurueckgehalten' AND p_grund NOT IN ('adresse', 'wortliste')) THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: Zustand und Grund passen nicht zusammen');
    END IF;
    SELECT id INTO v_ort_id FROM public.place WHERE public_id = p_ort AND is_active;
    IF NOT FOUND THEN
        PERFORM avesmaps_community._fehler('KC404', 'community_not_found: diesen Ort gibt es nicht');
    END IF;
    INSERT INTO public.place_review (
        operation_id, place_id, stars, author_name, body, dsa_date, source_system, zustand, grund, statuslink_hash
    ) VALUES (
        p_operation, v_ort_id, p_sterne, v_name, v_text, v_datum, 'website', p_zustand, p_grund, p_statuslink_hash
    )
    RETURNING * INTO v_neu;
    RETURN jsonb_build_object('id', v_neu.public_id, 'zustand', v_neu.zustand);
END;
$$;

-- „Gefällt mir“ setzen (+1) oder zurücknehmen (-1): nur die Zahl. Wer es war, wird nie gespeichert; „einmal je Browser“ hält der Browser. Nur an
-- einer öffentlichen Bewertung eines aktiven Orts. Zählt nicht in die Revision (ein Handgriff der Besucher stört die Redaktion nicht).
CREATE OR REPLACE FUNCTION avesmaps_community.bewertung_gefaellt(p_id UUID, p_delta INTEGER) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_zahl INTEGER;
BEGIN
    IF p_delta IS NULL OR p_delta NOT IN (-1, 1) THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: Gefällt mir zählt um eins hoch oder runter');
    END IF;
    UPDATE public.place_review r SET gefaellt = greatest(0, r.gefaellt + p_delta)
     WHERE r.public_id = p_id AND r.zustand IN ('neu', 'gesichtet') AND r.inhalt_geloescht_at IS NULL
       AND EXISTS (SELECT 1 FROM public.place p WHERE p.id = r.place_id AND p.is_active)
    RETURNING r.gefaellt INTO v_zahl;
    IF NOT FOUND THEN
        PERFORM avesmaps_community._fehler('KC404', 'community_not_found: diese Bewertung gibt es nicht');
    END IF;
    RETURN v_zahl;
END;
$$;

-- Eine Bewertung melden (Fachkonzept §14.5): ein normaler Vorgang (COM-…) der Kategorie `bewertung`, Bezug auf den Ort und auf die Bewertung,
-- der Grund im Bezug, die Beschreibung (freiwillig) als Nachricht des Melders, der Schlüssel der Statusseite wie bei jeder Meldung. Nur eine
-- öffentliche Bewertung kann gemeldet werden, denn nur die sieht ein Besucher. Die Bewertung bekommt „gemeldet: COM-…“ in ihren Verlauf.
CREATE OR REPLACE FUNCTION avesmaps_community.bewertung_melden(
    p_operation UUID, p_bewertung UUID, p_grund TEXT, p_text TEXT, p_schluessel_hash BYTEA
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    r public.place_review;
    o RECORD;
    v_text TEXT := NULLIF(btrim(COALESCE(p_text, '')), '');
BEGIN
    SELECT id INTO v_id FROM avesmaps_community.vorgang WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF p_grund IS NULL OR p_grund NOT IN ('beleidigend', 'spam', 'ort', 'person', 'sonstiges') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: bitte einen Grund wählen');
    END IF;
    IF char_length(COALESCE(v_text, '')) > 2000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Beschreibung darf höchstens 2000 Zeichen haben');
    END IF;
    IF p_schluessel_hash IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Schlüssel ist Pflicht');
    END IF;
    SELECT * INTO r FROM public.place_review WHERE public_id = p_bewertung FOR UPDATE;
    IF NOT FOUND OR r.zustand NOT IN ('neu', 'gesichtet') OR r.inhalt_geloescht_at IS NOT NULL THEN
        PERFORM avesmaps_community._fehler('KC404', 'community_not_found: diese Bewertung gibt es nicht');
    END IF;
    SELECT p.public_id, p.name, public.st_x(p.geom) AS x, public.st_y(p.geom) AS y INTO o
      FROM public.place p WHERE p.id = r.place_id AND p.is_active;
    IF NOT FOUND THEN
        PERFORM avesmaps_community._fehler('KC404', 'community_not_found: diese Bewertung gibt es nicht');
    END IF;
    INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, operation_id)
    VALUES ('meldung', 'bewertung', 'website', p_operation)
    RETURNING id INTO v_id;
    INSERT INTO avesmaps_community.melder (vorgang_id, schluessel_hash) VALUES (v_id, p_schluessel_hash);
    INSERT INTO avesmaps_community.bezug (
        vorgang_id, art, objekt_art, objekt_id, name, lage_x, lage_y, bewertung_id, bewertung_grund
    ) VALUES (
        v_id, 'objekt', 'place', o.public_id, o.name, o.x, o.y, p_bewertung, p_grund
    );
    IF v_text IS NOT NULL THEN
        INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, operation_id)
        VALUES (v_id, 'ein', 'formular', v_text, gen_random_uuid());
    END IF;
    PERFORM avesmaps_community._ereignis(v_id, 'eingang', NULL, true, NULL, 'neu', NULL, NULL);
    PERFORM avesmaps_community._bewertung_ereignis(p_bewertung, 'gemeldet', NULL, NULL, NULL, avesmaps_community._com(v_id), NULL);
    RETURN v_id;
END;
$$;

-- --- Redaktion (die App hat die Person angemeldet und ihr Recht geprüft) ------------------------------------------------------------------

-- Sichten: aus „neu“ zu „gesichtet“. Die Bewertung war schon öffentlich und bleibt es.
CREATE OR REPLACE FUNCTION avesmaps_community.bewertung_sichten(p_operation UUID, p_id UUID, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v public.place_review;
BEGIN
    IF avesmaps_community._bewertung_schon(p_operation) THEN
        RETURN (SELECT revision FROM public.place_review WHERE public_id = p_id);
    END IF;
    v := avesmaps_community._bewertung_pruefe(p_id, p_revision);
    IF v.zustand <> 'neu' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur eine neue Bewertung wird gesichtet');
    END IF;
    UPDATE public.place_review SET zustand = 'gesichtet' WHERE public_id = p_id;
    RETURN avesmaps_community._bewertung_ereignis(p_id, 'gesichtet', p_person, 'neu', 'gesichtet', NULL, p_operation);
END;
$$;

-- Freigeben: eine zurückgehaltene Bewertung wird öffentlich (und gilt als gesichtet).
CREATE OR REPLACE FUNCTION avesmaps_community.bewertung_freigeben(p_operation UUID, p_id UUID, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v public.place_review;
BEGIN
    IF avesmaps_community._bewertung_schon(p_operation) THEN
        RETURN (SELECT revision FROM public.place_review WHERE public_id = p_id);
    END IF;
    v := avesmaps_community._bewertung_pruefe(p_id, p_revision);
    IF v.zustand <> 'zurueckgehalten' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur eine zurückgehaltene Bewertung wird freigegeben');
    END IF;
    UPDATE public.place_review SET zustand = 'gesichtet', grund = NULL WHERE public_id = p_id;
    RETURN avesmaps_community._bewertung_ereignis(p_id, 'freigegeben', p_person, 'zurueckgehalten', 'gesichtet', v.grund, p_operation);
END;
$$;

-- Verbergen mit Grund (Pflicht). Mit `p_vorgaenge_abschliessen` werden die offenen Meldungen zu dieser Bewertung gleich mit dem Ergebnis
-- „umgesetzt“ abgeschlossen (Fachkonzept §14.5). Antwort: die neue Revision und die Nummern der abgeschlossenen Vorgänge (für das Protokoll).
CREATE OR REPLACE FUNCTION avesmaps_community.bewertung_verbergen(
    p_operation UUID, p_id UUID, p_person UUID, p_revision INTEGER, p_grund TEXT, p_vorgaenge_abschliessen BOOLEAN
) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v public.place_review;
    g RECORD;
    v_revision INTEGER;
    v_ids BIGINT[] := ARRAY[]::BIGINT[];
    v_name TEXT;
BEGIN
    IF avesmaps_community._bewertung_schon(p_operation) THEN
        RETURN jsonb_build_object('revision', (SELECT revision FROM public.place_review WHERE public_id = p_id), 'abgeschlossen', '[]'::jsonb);
    END IF;
    IF p_grund IS NULL OR p_grund NOT IN ('beleidigend', 'spam', 'ort', 'person', 'sonstiges') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: bitte einen Grund wählen');
    END IF;
    v := avesmaps_community._bewertung_pruefe(p_id, p_revision);
    IF v.zustand = 'verborgen' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: die Bewertung ist schon verborgen');
    END IF;
    UPDATE public.place_review SET zustand = 'verborgen', grund = p_grund WHERE public_id = p_id;
    v_revision := avesmaps_community._bewertung_ereignis(p_id, 'verborgen', p_person, v.zustand, 'verborgen', p_grund, p_operation);
    IF COALESCE(p_vorgaenge_abschliessen, false) THEN
        v_name := CASE p_grund
            WHEN 'beleidigend' THEN 'Beleidigend'
            WHEN 'spam' THEN 'Werbung oder Spam'
            WHEN 'ort' THEN 'Falscher Ort'
            WHEN 'person' THEN 'Persönliche Daten'
            ELSE 'Sonstiges'
        END;
        FOR g IN
            SELECT DISTINCT x.id, x.revision
              FROM avesmaps_community.vorgang x
              JOIN avesmaps_community.bezug b ON b.vorgang_id = x.id
             WHERE b.bewertung_id = p_id AND x.zustand <> 'abgeschlossen'
             ORDER BY x.id
        LOOP
            PERFORM avesmaps_community.community_abschliessen(
                gen_random_uuid(), g.id, p_person, g.revision, 'umgesetzt', 'Bewertung verborgen: ' || v_name, NULL, NULL
            );
            v_ids := v_ids || g.id;
        END LOOP;
    END IF;
    RETURN jsonb_build_object('revision', v_revision, 'abgeschlossen', to_jsonb(v_ids));
END;
$$;

-- Einblenden: eine verborgene Bewertung wird wieder öffentlich (gesichtet). Ohne Inhalt geht das nicht mehr.
CREATE OR REPLACE FUNCTION avesmaps_community.bewertung_einblenden(p_operation UUID, p_id UUID, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v public.place_review;
BEGIN
    IF avesmaps_community._bewertung_schon(p_operation) THEN
        RETURN (SELECT revision FROM public.place_review WHERE public_id = p_id);
    END IF;
    v := avesmaps_community._bewertung_pruefe(p_id, p_revision);
    IF v.zustand <> 'verborgen' OR v.inhalt_geloescht_at IS NOT NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur eine verborgene Bewertung mit Inhalt wird eingeblendet');
    END IF;
    UPDATE public.place_review SET zustand = 'gesichtet', grund = NULL WHERE public_id = p_id;
    RETURN avesmaps_community._bewertung_ereignis(p_id, 'eingeblendet', p_person, 'verborgen', 'gesichtet', v.grund, p_operation);
END;
$$;

-- Inhalt löschen (Fachkonzept §14.3, Datenschutz): Name, Text und Datum weg, die Zeile bleibt verborgen als Spur, ein Ereignis ohne Inhalt.
-- Nur aus „verborgen“. `moderate_community` mit frischem Passkey prüft die Route.
CREATE OR REPLACE FUNCTION avesmaps_community.bewertung_inhalt_loeschen(p_operation UUID, p_id UUID, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v public.place_review;
BEGIN
    IF avesmaps_community._bewertung_schon(p_operation) THEN
        RETURN (SELECT revision FROM public.place_review WHERE public_id = p_id);
    END IF;
    v := avesmaps_community._bewertung_pruefe(p_id, p_revision);
    IF v.zustand <> 'verborgen' OR v.inhalt_geloescht_at IS NOT NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur der Inhalt einer verborgenen Bewertung wird gelöscht');
    END IF;
    UPDATE public.place_review
       SET author_name = NULL, body = NULL, dsa_date = NULL, statuslink_hash = NULL, inhalt_geloescht_at = now()
     WHERE public_id = p_id;
    RETURN avesmaps_community._bewertung_ereignis(p_id, 'inhalt_geloescht', p_person, NULL, NULL, NULL, p_operation);
END;
$$;

-- --- Konto auflösen (WI-0120 A15): jetzt auch die Verfasser im Verlauf der Bewertungen. Gleiche Argumentliste wie in 0265. ---------------

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
