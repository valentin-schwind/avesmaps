-- Community-Modul, Schritt C6c: das Panel „Mailpostfach“ der Systemsteuerung (WI-0268; Handover project-control/handovers/2026-11-01-wi0268-mail-panel-an-claudia.md; Vorbild: die Routine des Discord-Tagesberichts, 0221).
-- Abruf (IMAP, 0281) und Versand (SMTP, 0279) bekommen je einen Schalter in der Datenbank, zusätzlich zur Konfiguration in der `.env`: Die `.env` bleibt das erste Tor (fehlt eine Angabe, ist der Weg aus), der Schalter
-- das zweite, das die Betreiber im Panel mit Passkey umlegen, ohne auf den Server zu müssen.
--
-- Was hier entsteht:
--   1. `mail_routine`: je Art (`abruf`, `versand`) EINE Zeile - der Schalter, wer ihn wann umlegte, und was der letzte Lauf ergab (Code aus festem Wortschatz, bei Erfolg zusätzlich Zahlen).
--   2. Die Funktionen der Jobs-Rolle: `community_mail_routinen` (beide Schalter lesen) und `community_mail_lauf` (den Ausgang eines Laufs eintragen). Die Pflege liest den Schalter des Abrufs, der Abrufjob und der Versandjob
--      prüfen ihn beim Start und tragen jeden Lauf ein.
--   3. Die Funktionen der App: `community_mail_routine_setzen` (der Schalter; Recht `manage_system_settings` mit frischem Passkey prüft die Route), `community_mail_uebersicht` (alles für das Panel in einer Antwort) und
--      `community_mail_wartende` (die Kennungen der wartenden Mails, die die Route beim Wiedereinschalten des Versands nachreiht).
--
-- 🔴 Vorgabe AN: Production läuft schon (Abruf seit 01.11. am Netz). Beide Zeilen entstehen mit `aktiv = true`; der Schalter darf beim Release nichts abschalten. Wer abschalten will, tut es im Panel.
-- 🔴 Der Versand hält nur zurück: Ist er aus, reserviert der Job nichts und zählt keinen Versuch, die Mail bleibt `wartet`. Erst das Wiedereinschalten reiht für jede wartende Mail einen Auftrag nach (die App, in derselben
-- Transaktion wie der Schalter; ein doppelter Auftrag ist harmlos, `community_mail_holen` reserviert nur einmal).
-- 🔴 Nie Roh-Texte von Servern, nie Adresse, Nutzer oder Kennwort in `mail_routine`: Der Lauf ist ein Wort aus einer festen Liste (die Funktion lehnt jedes andere mit KC422 ab), die Zahlen sind ganze Zahlen.
--
-- 🔴 REIN ADDITIV: eine neue Tafel, neue Funktionen; keine bestehende Funktion und Tafel wird angefasst, `job_enqueue` bleibt unverändert. Das vorige Release kennt die Tafel nie. Fehler wie in 0265: KC404 (gibt es nicht),
-- KC422 (ungültige Angabe). Die Rechte stehen in `apps/server/src/db/community-grants.psql`.

-- 1. TAFEL -------------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS avesmaps_community.mail_routine (
    art TEXT PRIMARY KEY,
    -- Vorgabe AN: Die Routine ist der Normalzustand; ausgeschaltet wird sie im Panel.
    aktiv BOOLEAN NOT NULL DEFAULT true,
    geaendert_at TIMESTAMPTZ,
    -- Die Person, die den Schalter zuletzt umlegte. Verschwindet die Person (hartes Löschen, nur in Tests), bleibt die Zeile.
    geaendert_von UUID REFERENCES avesmaps_auth.person (id) ON DELETE SET NULL,
    letzter_lauf_at TIMESTAMPTZ,
    -- Der Ausgang des letzten Laufs als Wort aus der festen Liste (`community_mail_lauf`), nie ein Text eines Servers.
    letzter_lauf TEXT,
    letzter_erfolg_at TIMESTAMPTZ,
    -- Die Zahlen des letzten Erfolgs (Abruf: neu, angehaengt, unlesbar, zu_gross; Versand: keine).
    letzter_erfolg JSONB,
    CONSTRAINT mail_routine_art CHECK (art IN ('abruf', 'versand')),
    CONSTRAINT mail_routine_lauf CHECK (letzter_lauf IS NULL OR (char_length(letzter_lauf) <= 300 AND letzter_lauf ~ '^[a-z_]+$')),
    CONSTRAINT mail_routine_lauf_zeit CHECK ((letzter_lauf IS NULL) = (letzter_lauf_at IS NULL)),
    CONSTRAINT mail_routine_erfolg CHECK (letzter_erfolg IS NULL OR (jsonb_typeof(letzter_erfolg) = 'object' AND letzter_erfolg_at IS NOT NULL))
);
COMMENT ON TABLE avesmaps_community.mail_routine IS
    'Schalter und letzter Lauf des Mailabrufs und des Mailversands (WI-0268 C6c; Vorgabe an). Die App liest sie nur ueber community_mail_uebersicht, die Jobs-Rolle nur ueber community_mail_routinen und community_mail_lauf.';

INSERT INTO avesmaps_community.mail_routine (art) VALUES ('abruf'), ('versand') ON CONFLICT (art) DO NOTHING;

-- 2. DIE JOBS-ROLLE (kein Tafelrecht) ----------------------------------------------------------------------------------------------

-- Beide Schalter, wie die Jobs sie brauchen: {abruf, versand}. Fehlt eine Zeile (sie entsteht mit dieser Migration), gilt die Vorgabe AN.
CREATE OR REPLACE FUNCTION avesmaps_community.community_mail_routinen() RETURNS JSONB
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT jsonb_build_object(
        'abruf', COALESCE((SELECT r.aktiv FROM avesmaps_community.mail_routine r WHERE r.art = 'abruf'), true),
        'versand', COALESCE((SELECT r.aktiv FROM avesmaps_community.mail_routine r WHERE r.art = 'versand'), true)
    );
$$;

-- Den Ausgang eines Laufs eintragen. `p_ergebnis` ist ein Wort aus der festen Liste der Art; `p_zahlen` ein Objekt aus Zahlen (oder NULL); `p_erfolg` sagt, ob der Lauf gelungen ist (dann steht er auch als `letzter_erfolg`
-- mit seinen Zahlen). Jeder andere Wert ist KC422: In die Tafel gelangt nie ein Text des Mailservers.
CREATE OR REPLACE FUNCTION avesmaps_community.community_mail_lauf(p_art TEXT, p_ergebnis TEXT, p_zahlen JSONB, p_erfolg BOOLEAN) RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_ok TEXT[];
    v_erfolg TEXT;
    v_zahlen JSONB := COALESCE(p_zahlen, '{}'::jsonb);
BEGIN
    IF p_art = 'abruf' THEN
        v_ok := ARRAY['gelesen', 'anmeldung_abgelehnt', 'ordner_fehlt', 'gestoert', 'zugang_fehlt', 'ausgeschaltet'];
        v_erfolg := 'gelesen';
    ELSIF p_art = 'versand' THEN
        v_ok := ARRAY['gesendet', 'anmeldung_abgelehnt', 'adresse_abgelehnt', 'gestoert', 'zugang_fehlt', 'zurueckgehalten'];
        v_erfolg := 'gesendet';
    ELSE
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: unbekannte Art der Routine');
    END IF;
    IF p_ergebnis IS NULL OR NOT (p_ergebnis = ANY (v_ok)) OR p_erfolg IS NULL OR p_erfolg IS DISTINCT FROM (p_ergebnis = v_erfolg) THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: unbekanntes Ergebnis des Laufs');
    END IF;
    -- Nur ganze Zahlen unter kurzen Namen: kein Text, keine Verschachtelung.
    IF jsonb_typeof(v_zahlen) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(v_zahlen)) > 12
       OR EXISTS (SELECT 1 FROM jsonb_each(v_zahlen) e WHERE e.key !~ '^[a-z_]{1,30}$' OR jsonb_typeof(e.value) <> 'number') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Zahlen des Laufs sind unbrauchbar');
    END IF;
    UPDATE avesmaps_community.mail_routine
       SET letzter_lauf = p_ergebnis, letzter_lauf_at = now(),
           letzter_erfolg = CASE WHEN p_erfolg THEN v_zahlen ELSE letzter_erfolg END,
           letzter_erfolg_at = CASE WHEN p_erfolg THEN now() ELSE letzter_erfolg_at END
     WHERE art = p_art;
    IF NOT FOUND THEN
        PERFORM avesmaps_community._fehler('KC404', 'community_not_found: diese Routine gibt es nicht');
    END IF;
END;
$$;

-- 3. DIE APP -----------------------------------------------------------------------------------------------------------------------

-- Den Schalter setzen. Gleicher Zustand wie schon: nichts ändert sich (auch `geaendert_at` und `geaendert_von` nicht, „seit“ gilt dem Zustand). Gibt {art, vorher, nachher, geaendert} zurück. Das Recht
-- (`manage_system_settings`, frischer Passkey) und die Kennung der Handlung prüft die Route.
CREATE OR REPLACE FUNCTION avesmaps_community.community_mail_routine_setzen(p_art TEXT, p_aktiv BOOLEAN, p_person UUID) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_alt BOOLEAN;
BEGIN
    IF p_art IS NULL OR p_art NOT IN ('abruf', 'versand') OR p_aktiv IS NULL OR p_person IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: Art, Zustand und Person der Routine sind nötig');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM avesmaps_auth.person WHERE id = p_person) THEN
        PERFORM avesmaps_community._fehler('KC404', 'community_not_found: diese Person gibt es nicht');
    END IF;
    SELECT aktiv INTO v_alt FROM avesmaps_community.mail_routine WHERE art = p_art FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM avesmaps_community._fehler('KC404', 'community_not_found: diese Routine gibt es nicht');
    END IF;
    IF v_alt IS DISTINCT FROM p_aktiv THEN
        UPDATE avesmaps_community.mail_routine SET aktiv = p_aktiv, geaendert_at = now(), geaendert_von = p_person WHERE art = p_art;
    END IF;
    RETURN jsonb_build_object('art', p_art, 'vorher', v_alt, 'nachher', p_aktiv, 'geaendert', v_alt IS DISTINCT FROM p_aktiv);
END;
$$;

-- Alles für das Panel in einer Antwort (die App sieht die Tafeln nicht): beide Routinezeilen mit dem Namen der Person, der Startpunkt des Ordners `p_ordner` (UIDVALIDITY, letzte UID; `mail_abruf_stand` sieht die App nicht),
-- die Zahl der wartenden Mails, die Zahl der Fehler an Mails der letzten 7 Tage (die Tafel kennt nur die Zeit des Anlegens) und die Zeit der letzten angenommenen Mail. Zeiten als Zeitstempel; die Route macht ISO daraus.
CREATE OR REPLACE FUNCTION avesmaps_community.community_mail_uebersicht(p_ordner TEXT) RETURNS JSONB
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT jsonb_build_object(
        'routinen', COALESCE((
            SELECT jsonb_object_agg(r.art, jsonb_build_object(
                'aktiv', r.aktiv,
                'geaendertAt', r.geaendert_at,
                'geaendertVon', NULLIF(left(btrim(p.display_name), 80), ''),
                'letzterLauf', CASE WHEN r.letzter_lauf_at IS NULL THEN NULL
                                    ELSE jsonb_build_object('at', r.letzter_lauf_at, 'ergebnis', r.letzter_lauf) END,
                'letzterErfolg', CASE WHEN r.letzter_erfolg_at IS NULL THEN NULL
                                      ELSE jsonb_build_object('at', r.letzter_erfolg_at, 'zahlen', COALESCE(r.letzter_erfolg, '{}'::jsonb)) END
            ))
              FROM avesmaps_community.mail_routine r
              LEFT JOIN avesmaps_auth.person p ON p.id = r.geaendert_von
        ), '{}'::jsonb),
        'startpunkt', (
            SELECT jsonb_build_object('uidValidity', s.uidvalidity, 'letzteUid', s.letzte_uid)
              FROM avesmaps_community.mail_abruf_stand s WHERE s.ordner = p_ordner
        ),
        'wartend', (SELECT count(*) FROM avesmaps_community.mail_ausgang WHERE zustand = 'wartet'),
        'fehler7Tage', (SELECT count(*) FROM avesmaps_community.mail_ausgang WHERE zustand = 'fehler' AND angelegt_at >= now() - interval '7 days'),
        'letzteMailAt', (SELECT max(abgerufen_at) FROM avesmaps_community.mail_eingang)
    );
$$;

-- Die Kennungen der wartenden Mails (älteste zuerst, höchstens `p_grenze`, nie mehr als 1000) als Liste von Zahlen. Die Route reiht beim Wiedereinschalten des Versands für jede einen Auftrag nach. Nur Kennungen: weder
-- Adresse noch Betreff noch Text.
CREATE OR REPLACE FUNCTION avesmaps_community.community_mail_wartende(p_grenze INTEGER DEFAULT 1000) RETURNS JSONB
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT COALESCE(jsonb_agg(w.id ORDER BY w.id), '[]'::jsonb)
      FROM (
          SELECT a.id FROM avesmaps_community.mail_ausgang a
           WHERE a.zustand = 'wartet' ORDER BY a.id LIMIT greatest(1, least(COALESCE(p_grenze, 1000), 1000))
      ) w;
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
