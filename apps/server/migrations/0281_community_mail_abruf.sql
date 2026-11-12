-- Community-Modul, Schritt C6b: das bestehende Postfach wird lesend abgeholt (WI-0268; Fachkonzept project-control/planning/community-fachkonzept.md §3.4, §4.2, §10.2;
-- Bedienkonzept §3.1, §3.2, §3.4; Handover project-control/handovers/2026-10-31-wi0268-c6-mailweg-an-claudio.md). Der Versand ist C6a (0279).
--
-- Was hier entsteht:
--   1. `mail_eingang`: je eingehender Mail eine Zeile (Message-ID, Fadenkopfzeilen, Absender, Betreff, voller Text, BEREITS BEREINIGTES HTML, Zahl der blockierten Bilder, Verweis auf die Rohmail in der Ablage).
--      Die Nachricht selbst bleibt in `nachricht` (`richtung = 'ein'`, `weg = 'mail'`, 0265 kennt den Weg schon); sie trägt nur die ersten 4000 Zeichen des Textes.
--   2. `mail_anhang`: je Anhang eine Zeile (Name, Art, Größe, Verweis auf die Datei in der Ablage; gesperrte Anhänge nur mit Name, Größe und Grund, ohne Datei).
--   3. `mail_abruf_stand`: je Ordner `UIDVALIDITY` und die letzte gelesene UID (der Abruf liest weiter, wo er aufhörte; wechselt `UIDVALIDITY`, liest er von vorn, die Message-ID überspringt Bekanntes).
--   4. Die Funktionen des Abrufjobs (Jobs-Rolle, kein Tafelrecht): `community_mail_eingang` (eine Mail aufnehmen: Faden suchen, anhängen oder neuen Vorgang anlegen), `community_mail_abruf_stand`,
--      `community_mail_abruf_setzen`, `community_mail_dateien_behalten` (Abgleich der Ablage: welche Dateien kennt die Datenbank noch).
--   5. Die Aufbewahrung nimmt die neuen Spalten mit, nach Fachkonzept §10.2: mit den Kontaktdaten (90 Tage nach Abschluss, `community_purge_expired`) fallen Absender (`von_adresse`, `von_name`) und die Rohmail
--      (`roh_datei`) weg; **Text, bereinigtes HTML und Anhänge (samt eingebetteten Bildern) bleiben im Archiv**. Anhänge gehen erst bei „Personenbezug löschen“ (`community_personenbezug_loeschen`, Datenschutzanfrage)
--      und mit dem Papierkorb (endgültig nach 30 Tagen, samt Vorgang, Kaskade). Beide Funktionen sind von ihrer GELTENDEN Fassung (0279) abgeschrieben und nur um diese Zeilen erweitert.
--
-- 🔴 Den Faden findet die Datenbank, nicht der Code: erst über `In-Reply-To` und `References` gegen die Message-IDs der eigenen Ausgänge (`mail_ausgang`, 0279) und der früheren Eingänge, dann über
-- `[COM-000123]` im Betreff. Der Treffer über den Betreff gilt nur, wenn die Mail von der Adresse des Melders dieses Vorgangs kommt (sonst könnte jeder, der eine Nummer errät, eine Nachricht in
-- fremde Vorgänge setzen und geschlossene wieder öffnen); ohne Treffer entsteht ein neuer Vorgang. Beides nur für Anfragen.
--
-- 🔴 Dieselbe Message-ID zweimal legt nichts Neues an (UNIQUE, dazu eine Sperre je Message-ID): die Funktion gibt den vorhandenen Vorgang zurück.
--
-- 🔴 Eine Mail im Papierkorb bleibt dort (Spam kommt nicht zurück in den Eingang); jede andere geschlossene Anfrage öffnet sich von selbst wieder („durch neue Nachricht wieder geöffnet“, Bedienkonzept §3.4).
--
-- 🔴 REIN ADDITIV: neue Tafeln, neue Funktionen; `community_purge_expired` und `community_personenbezug_loeschen` sind mit gleicher Signatur nur erweitert, `CREATE OR REPLACE` behält Eigentümer und Rechte.
-- `job_enqueue` bleibt unverändert: Den Abruf reiht allein die Pflege der Jobs-Rolle ein (`job_insert`), die App nie. Die Rechte stehen in `apps/server/src/db/community-grants.psql`.

-- 1. TAFELN ------------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS avesmaps_community.mail_eingang (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nachricht_id BIGINT NOT NULL UNIQUE REFERENCES avesmaps_community.nachricht (id) ON DELETE CASCADE,
    -- In Kleinschrift gespeichert und verglichen (Message-IDs unterscheiden Groß- und Kleinschreibung in der Praxis nicht).
    message_id TEXT NOT NULL UNIQUE,
    in_reply_to TEXT,
    verweise TEXT[] NOT NULL DEFAULT '{}',
    -- Absender: fallen mit den Kontaktdaten weg (Fachkonzept §10.2).
    von_adresse TEXT,
    von_name TEXT,
    betreff TEXT NOT NULL DEFAULT '',
    -- Der volle Text (`nachricht.text` trägt nur die ersten 4000 Zeichen) und das HTML, schon nach der Positivliste bereinigt (`community/mail/html.ts`); nie die Rohfassung.
    text TEXT,
    html TEXT,
    -- Wie viele Bilder aus dem Netz die Bereinigung blockiert hat („Einmal laden“ in der Oberfläche).
    extern_bilder INTEGER NOT NULL DEFAULT 0,
    -- `zu_gross`: die Mail liegt über der Grenze und wurde nicht übernommen (nur die Kopfzeilen); `unlesbar`: der Parser verstand sie nicht (Kopfzeilen und Rohmail bleiben).
    hinweis TEXT,
    -- Name (SHA-256) der Rohmail in der Ablage `COMMUNITY_MAIL_ABLAGE`; NULL mit den Kontaktdaten (90 Tage nach Abschluss) und beim Personenbezug löschen.
    roh_datei TEXT,
    groesse BIGINT NOT NULL DEFAULT 0,
    uid BIGINT NOT NULL,
    uidvalidity BIGINT NOT NULL,
    abgerufen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mail_eingang_message_id CHECK (char_length(message_id) BETWEEN 3 AND 998 AND message_id !~ '[[:cntrl:]]'),
    CONSTRAINT mail_eingang_in_reply_to CHECK (in_reply_to IS NULL OR (char_length(in_reply_to) BETWEEN 3 AND 998 AND in_reply_to !~ '[[:cntrl:]]')),
    CONSTRAINT mail_eingang_verweise CHECK (cardinality(verweise) <= 50),
    CONSTRAINT mail_eingang_von_adresse CHECK (von_adresse IS NULL OR (char_length(von_adresse) BETWEEN 3 AND 254 AND von_adresse !~ '[[:cntrl:][:space:]]')),
    CONSTRAINT mail_eingang_von_name CHECK (von_name IS NULL OR (char_length(von_name) BETWEEN 1 AND 200 AND von_name !~ '[[:cntrl:]]')),
    CONSTRAINT mail_eingang_betreff CHECK (char_length(betreff) <= 998 AND betreff !~ '[[:cntrl:]]'),
    CONSTRAINT mail_eingang_text CHECK (text IS NULL OR char_length(text) <= 1000000),
    CONSTRAINT mail_eingang_html CHECK (html IS NULL OR char_length(html) <= 2000000),
    CONSTRAINT mail_eingang_extern CHECK (extern_bilder BETWEEN 0 AND 100000),
    CONSTRAINT mail_eingang_hinweis CHECK (hinweis IS NULL OR hinweis IN ('zu_gross', 'unlesbar')),
    CONSTRAINT mail_eingang_roh_datei CHECK (roh_datei IS NULL OR roh_datei ~ '^[0-9a-f]{64}$'),
    CONSTRAINT mail_eingang_zahlen CHECK (groesse >= 0 AND uid >= 0 AND uidvalidity >= 0)
);
COMMENT ON TABLE avesmaps_community.mail_eingang IS 'Eingehende Mails des Community-Moduls (WI-0268 C6b): Fadenkopfzeilen, Absender, voller Text und bereinigtes HTML. Absender und Rohmail fallen mit den Kontaktdaten weg.';

CREATE TABLE IF NOT EXISTS avesmaps_community.mail_anhang (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nachricht_id BIGINT NOT NULL REFERENCES avesmaps_community.nachricht (id) ON DELETE CASCADE,
    dateiname TEXT NOT NULL,
    mime TEXT NOT NULL,
    groesse BIGINT NOT NULL,
    -- Name (SHA-256) der Datei in der Ablage. NULL, wenn gesperrt oder mit dem Personenbezug entfernt; die Kontaktfrist (90 Tage) lässt Anhänge stehen.
    datei TEXT,
    -- Die Content-ID, unter der das HTML das Bild einbettet (`cid:`); nur bei übernommenen Bildern.
    cid TEXT,
    gesperrt BOOLEAN NOT NULL DEFAULT false,
    -- `typ` (Dateityp gesperrt, nicht übernommen), `grenze` (über der Grenze je Mail, nicht übernommen) oder `entfernt` (Datei mit dem Personenbezug entfernt).
    grund TEXT,
    CONSTRAINT mail_anhang_dateiname CHECK (char_length(dateiname) BETWEEN 1 AND 200 AND dateiname !~ '[[:cntrl:]]'),
    CONSTRAINT mail_anhang_mime CHECK (char_length(mime) BETWEEN 3 AND 127 AND mime ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'),
    CONSTRAINT mail_anhang_groesse CHECK (groesse >= 0),
    CONSTRAINT mail_anhang_datei CHECK (datei IS NULL OR datei ~ '^[0-9a-f]{64}$'),
    CONSTRAINT mail_anhang_cid CHECK (cid IS NULL OR (char_length(cid) BETWEEN 1 AND 200 AND cid ~ '^[A-Za-z0-9._~@+=%-]+$')),
    CONSTRAINT mail_anhang_grund CHECK (grund IS NULL OR grund IN ('typ', 'grenze', 'entfernt')),
    CONSTRAINT mail_anhang_gesperrt CHECK (gesperrt = COALESCE(grund IN ('typ', 'grenze'), false) AND (NOT gesperrt OR datei IS NULL))
);
COMMENT ON TABLE avesmaps_community.mail_anhang IS 'Anhaenge eingehender Mails (WI-0268 C6b): Name, Art, Groesse und Verweis auf die Datei in der Ablage; gesperrte nur mit Name, Groesse und Grund.';
CREATE INDEX IF NOT EXISTS mail_anhang_nachricht ON avesmaps_community.mail_anhang (nachricht_id);
CREATE INDEX IF NOT EXISTS mail_anhang_datei ON avesmaps_community.mail_anhang (datei) WHERE datei IS NOT NULL;
CREATE INDEX IF NOT EXISTS mail_eingang_roh_datei ON avesmaps_community.mail_eingang (roh_datei) WHERE roh_datei IS NOT NULL;

CREATE TABLE IF NOT EXISTS avesmaps_community.mail_abruf_stand (
    ordner TEXT PRIMARY KEY,
    uidvalidity BIGINT NOT NULL,
    letzte_uid BIGINT NOT NULL DEFAULT 0,
    abgerufen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mail_abruf_stand_ordner CHECK (char_length(ordner) BETWEEN 1 AND 200),
    CONSTRAINT mail_abruf_stand_zahlen CHECK (uidvalidity >= 0 AND letzte_uid >= 0)
);
COMMENT ON TABLE avesmaps_community.mail_abruf_stand IS 'Wo der Mailabruf aufgehoert hat (WI-0268 C6b): UIDVALIDITY und letzte gelesene UID je Ordner.';

-- 2. DER ABRUFJOB (Jobs-Rolle, kein Tafelrecht) ------------------------------------------------------------------------------------

-- Eine Mail aufnehmen. `p_mail`: {messageId, inReplyTo, verweise[], vonAdresse, vonName, betreff, text, html, externBilder, hinweis, rohDatei, groesse, uid, uidvalidity};
-- `p_anhaenge`: [{dateiname, mime, groesse, datei, cid, grund}]. Gibt {id, nummer, nachricht, ergebnis, vorgangNeu, wiedergeoeffnet, zustaendig, papierkorb} zurück; `ergebnis` ist `neu` (neuer Vorgang),
-- `angehaengt` (im Faden) oder `doppelt` (die Message-ID kennt die Datenbank schon: nichts Neues).
CREATE OR REPLACE FUNCTION avesmaps_community.community_mail_eingang(p_mail JSONB, p_anhaenge JSONB DEFAULT '[]'::jsonb) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_mid TEXT := lower(btrim(COALESCE(p_mail->>'messageId', '')));
    v_re TEXT := NULLIF(lower(btrim(COALESCE(p_mail->>'inReplyTo', ''))), '');
    v_verweise TEXT[];
    v_kandidaten TEXT[] := '{}';
    v_kandidat TEXT;
    v_adresse TEXT := NULLIF(btrim(COALESCE(p_mail->>'vonAdresse', '')), '');
    v_name TEXT := NULLIF(left(btrim(regexp_replace(COALESCE(p_mail->>'vonName', ''), '[[:cntrl:]]', ' ', 'g')), 200), '');
    v_betreff TEXT := left(btrim(regexp_replace(COALESCE(p_mail->>'betreff', ''), '[[:cntrl:]]', ' ', 'g')), 998);
    v_text TEXT := p_mail->>'text';
    v_html TEXT := p_mail->>'html';
    v_hinweis TEXT := NULLIF(p_mail->>'hinweis', '');
    v_kurz TEXT;
    v_id BIGINT;
    v_nachricht BIGINT;
    v_nummer TEXT;
    v_neu BOOLEAN := false;
    v_wieder BOOLEAN := false;
    v_papierkorb BOOLEAN := false;
    v_zustaendig UUID;
    v_nr BIGINT;
    vg avesmaps_community.vorgang;
    va RECORD;
    v_anhang JSONB;
    i INTEGER;
BEGIN
    IF char_length(v_mid) NOT BETWEEN 3 AND 998 OR v_mid ~ '[[:cntrl:]]' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Mail hat keine brauchbare Message-ID');
    END IF;
    IF jsonb_typeof(COALESCE(p_anhaenge, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_anhaenge, '[]'::jsonb)) > 200 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Anhänge sind keine Liste von höchstens 200');
    END IF;
    -- Zwei gleichzeitige Aufnahmen derselben Message-ID gehen hintereinander.
    PERFORM pg_advisory_xact_lock(hashtextextended('community_mail_eingang:' || v_mid, 0));
    SELECT n.vorgang_id, n.id INTO v_id, v_nachricht
      FROM avesmaps_community.mail_eingang e JOIN avesmaps_community.nachricht n ON n.id = e.nachricht_id
     WHERE e.message_id = v_mid;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'id', v_id, 'nummer', avesmaps_community._com(v_id), 'nachricht', v_nachricht, 'ergebnis', 'doppelt',
            'vorgangNeu', false, 'wiedergeoeffnet', false, 'zustaendig', NULL, 'papierkorb', false
        );
    END IF;

    -- Eine Adresse, die nicht genau eine einfache Adresse ist, speichert die Datenbank gar nicht (der Melder bleibt dann ohne Adresse).
    IF NOT avesmaps_community._mail_adresse(v_adresse) THEN
        v_adresse := NULL;
    END IF;
    v_verweise := ARRAY(
        SELECT lower(btrim(r.wert))
          FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(p_mail->'verweise') = 'array' THEN p_mail->'verweise' ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS r(wert, nr)
         WHERE char_length(btrim(r.wert)) BETWEEN 3 AND 998 AND r.wert !~ '[[:cntrl:]]'
         ORDER BY r.nr
         LIMIT 50
    );

    -- Der Faden, 1. Weg: die Kopfzeilen. Zuerst die Antwort-auf-Kennung, dann die Verweise vom jüngsten zum ältesten.
    IF v_re IS NOT NULL AND char_length(v_re) BETWEEN 3 AND 998 AND v_re !~ '[[:cntrl:]]' THEN
        v_kandidaten := array_append(v_kandidaten, v_re);
    END IF;
    FOR i IN REVERSE COALESCE(cardinality(v_verweise), 0) .. 1 LOOP
        v_kandidaten := array_append(v_kandidaten, v_verweise[i]);
    END LOOP;
    FOREACH v_kandidat IN ARRAY v_kandidaten LOOP
        SELECT n.vorgang_id INTO v_id
          FROM avesmaps_community.mail_ausgang a
          JOIN avesmaps_community.nachricht n ON n.id = a.nachricht_id
          JOIN avesmaps_community.vorgang g ON g.id = n.vorgang_id
         WHERE a.message_id = v_kandidat AND g.art = 'anfrage';
        EXIT WHEN v_id IS NOT NULL;
        SELECT n.vorgang_id INTO v_id
          FROM avesmaps_community.mail_eingang e
          JOIN avesmaps_community.nachricht n ON n.id = e.nachricht_id
          JOIN avesmaps_community.vorgang g ON g.id = n.vorgang_id
         WHERE e.message_id = v_kandidat AND g.art = 'anfrage';
        EXIT WHEN v_id IS NOT NULL;
    END LOOP;

    -- 2. Weg: „[COM-000123]“ im Betreff, aber nur von der Adresse des Melders dieses Vorgangs.
    IF v_id IS NULL AND v_adresse IS NOT NULL THEN
        v_nr := NULLIF(substring(v_betreff FROM '\[COM-([0-9]{1,12})\]'), '')::bigint;
        IF v_nr IS NOT NULL THEN
            SELECT g.id INTO v_id
              FROM avesmaps_community.vorgang g JOIN avesmaps_community.melder m ON m.vorgang_id = g.id
             WHERE g.id = v_nr AND g.art = 'anfrage' AND m.mail IS NOT NULL AND lower(m.mail) = lower(v_adresse);
        END IF;
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, operation_id)
        VALUES ('anfrage', 'sonstiges', 'mail', gen_random_uuid())
        RETURNING id INTO v_id;
        INSERT INTO avesmaps_community.melder (vorgang_id, name, mail)
        VALUES (
            v_id, left(v_name, 80),
            v_adresse
        );
        v_neu := true;
    ELSE
        PERFORM avesmaps_community._sperre(v_id);
    END IF;
    v_nummer := avesmaps_community._com(v_id);

    -- Die Nachricht trägt die ersten 4000 Zeichen; der volle Text steht in `mail_eingang`.
    v_kurz := left(btrim(COALESCE(v_text, '')), 4000);
    IF v_hinweis = 'zu_gross' THEN
        v_kurz := 'Mail über der Grenze von 30 MB, nicht übernommen.';
    ELSIF v_hinweis = 'unlesbar' THEN
        v_kurz := 'Mail nicht lesbar, nicht übernommen.';
    ELSIF v_kurz = '' THEN
        v_kurz := '(ohne Text)';
    END IF;
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, operation_id)
    VALUES (v_id, 'ein', 'mail', v_kurz, gen_random_uuid())
    RETURNING id INTO v_nachricht;

    INSERT INTO avesmaps_community.mail_eingang (
        nachricht_id, message_id, in_reply_to, verweise, von_adresse, von_name, betreff, text, html, extern_bilder, hinweis, roh_datei, groesse, uid, uidvalidity
    ) VALUES (
        v_nachricht, v_mid, v_re, v_verweise, v_adresse, v_name, v_betreff, v_text, v_html,
        COALESCE((p_mail->>'externBilder')::integer, 0), v_hinweis, NULLIF(p_mail->>'rohDatei', ''),
        COALESCE((p_mail->>'groesse')::bigint, 0), COALESCE((p_mail->>'uid')::bigint, 0), COALESCE((p_mail->>'uidvalidity')::bigint, 0)
    );

    FOR v_anhang IN SELECT value FROM jsonb_array_elements(COALESCE(p_anhaenge, '[]'::jsonb)) LOOP
        INSERT INTO avesmaps_community.mail_anhang (nachricht_id, dateiname, mime, groesse, datei, cid, gesperrt, grund)
        VALUES (
            v_nachricht, v_anhang->>'dateiname', v_anhang->>'mime', COALESCE((v_anhang->>'groesse')::bigint, 0), NULLIF(v_anhang->>'datei', ''), NULLIF(v_anhang->>'cid', ''),
            COALESCE(v_anhang->>'grund', '') IN ('typ', 'grenze'), NULLIF(v_anhang->>'grund', '')
        );
    END LOOP;

    -- Eingebettete Bilder: `src="cid:…"` im bereinigten HTML zeigt auf die App (der Browser lädt sie nur mit `read_mailbox`).
    IF v_html IS NOT NULL THEN
        FOR va IN SELECT ma.id AS anhang_id, ma.cid AS anhang_cid FROM avesmaps_community.mail_anhang ma WHERE ma.nachricht_id = v_nachricht AND ma.cid IS NOT NULL AND ma.datei IS NOT NULL LOOP
            v_html := replace(v_html, 'src="cid:' || va.anhang_cid || '"', 'src="/api/community/vorgaenge/' || v_nummer || '/anhaenge/' || va.anhang_id::text || '"');
        END LOOP;
        UPDATE avesmaps_community.mail_eingang SET html = v_html WHERE nachricht_id = v_nachricht;
    END IF;

    IF v_neu THEN
        PERFORM avesmaps_community._ereignis(v_id, 'eingang', NULL, true, NULL, 'neu', NULL, NULL);
    ELSE
        SELECT * INTO vg FROM avesmaps_community.vorgang WHERE id = v_id;
        v_zustaendig := vg.zustaendig;
        IF vg.papierkorb_at IS NOT NULL THEN
            -- Spam kommt nicht zurück in den Eingang; die Nachricht steht im Verlauf, bis der Papierkorb geleert wird.
            v_papierkorb := true;
        ELSIF vg.zustand = 'abgeschlossen' THEN
            PERFORM avesmaps_community._oeffnen(vg.id);
            PERFORM avesmaps_community._ereignis(vg.id, 'wiedereroeffnet', NULL, true, vg.ergebnis, 'in_arbeit', 'durch neue Nachricht wieder geöffnet', NULL);
            v_wieder := true;
        ELSIF vg.zustand = 'rueckfrage' THEN
            UPDATE avesmaps_community.vorgang SET zustand = 'in_arbeit', rueckfrage_at = NULL WHERE id = vg.id;
        END IF;
        PERFORM avesmaps_community._ereignis(vg.id, 'antwort', NULL, true, vg.zustand, NULL, NULL, NULL);
    END IF;

    RETURN jsonb_build_object(
        'id', v_id, 'nummer', v_nummer, 'nachricht', v_nachricht, 'ergebnis', CASE WHEN v_neu THEN 'neu' ELSE 'angehaengt' END,
        'vorgangNeu', v_neu, 'wiedergeoeffnet', v_wieder, 'zustaendig', v_zustaendig::text, 'papierkorb', v_papierkorb
    );
END;
$$;

-- Wo der Abruf aufgehört hat: {uidValidity, letzteUid}, oder NULL, wenn dieser Ordner noch nie gelesen wurde.
CREATE OR REPLACE FUNCTION avesmaps_community.community_mail_abruf_stand(p_ordner TEXT) RETURNS JSONB
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT jsonb_build_object('uidValidity', s.uidvalidity, 'letzteUid', s.letzte_uid)
      FROM avesmaps_community.mail_abruf_stand s WHERE s.ordner = p_ordner;
$$;

-- Den Stand eintragen. Bei gleicher `UIDVALIDITY` rückt die letzte UID nur vor; wechselt sie, beginnt der Ordner von vorn.
CREATE OR REPLACE FUNCTION avesmaps_community.community_mail_abruf_setzen(p_ordner TEXT, p_uidvalidity BIGINT, p_letzte_uid BIGINT) RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF p_ordner IS NULL OR char_length(p_ordner) NOT BETWEEN 1 AND 200 OR p_uidvalidity IS NULL OR p_uidvalidity < 0 OR p_letzte_uid IS NULL OR p_letzte_uid < 0 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Stand des Abrufs ist unbrauchbar');
    END IF;
    INSERT INTO avesmaps_community.mail_abruf_stand (ordner, uidvalidity, letzte_uid)
    VALUES (p_ordner, p_uidvalidity, p_letzte_uid)
    ON CONFLICT (ordner) DO UPDATE
       SET letzte_uid = CASE WHEN avesmaps_community.mail_abruf_stand.uidvalidity = excluded.uidvalidity
                             THEN greatest(avesmaps_community.mail_abruf_stand.letzte_uid, excluded.letzte_uid) ELSE excluded.letzte_uid END,
           uidvalidity = excluded.uidvalidity,
           abgerufen_at = now();
END;
$$;

-- Der Abgleich der Ablage: von den Namen (SHA-256) welche die Datenbank noch kennt (als Rohmail oder Anhang). Alles andere in der Ablage ist verwaist (Rohmail nach der Kontaktfrist, Personenbezug, Papierkorb) und darf
-- weg; das Löschen selbst macht der Abruf, die Datenbank kennt das Dateisystem nicht.
CREATE OR REPLACE FUNCTION avesmaps_community.community_mail_dateien_behalten(p_namen TEXT[]) RETURNS TEXT[]
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF p_namen IS NULL OR cardinality(p_namen) > 2000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: höchstens 2000 Namen je Abgleich');
    END IF;
    RETURN COALESCE((
        SELECT array_agg(DISTINCT n ORDER BY n) FROM unnest(p_namen) AS n
         WHERE EXISTS (SELECT 1 FROM avesmaps_community.mail_eingang e WHERE e.roh_datei = n)
            OR EXISTS (SELECT 1 FROM avesmaps_community.mail_anhang a WHERE a.datei = n)
    ), '{}'::text[]);
END;
$$;

-- 3. AUFBEWAHRUNG ----------------------------------------------------------------------------------------------------------------------------

-- Von der geltenden Fassung (0279) abgeschrieben; neu ist allein die UPDATE-Anweisung „mail_eingang“ in der Schleife der Kontaktdaten (Anhänge bleiben).
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
    -- Kontaktdaten und Statuslink 90 Tage nach dem Abschluss; Texte und Meldung bleiben im Archiv. Die Adresse der ausgehenden Mails zählt zu den Kontaktdaten (Fachkonzept §10.2), ebenso Absender und
    -- Rohmail der eingehenden (die Datei der Rohmail löscht der Abruf aus der Ablage, sobald die Datenbank sie nicht mehr kennt). Anhänge und eingebettete Bilder bleiben (§10.2: „bleiben im Archiv“).
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
        UPDATE avesmaps_community.mail_ausgang a SET an = NULL
          FROM avesmaps_community.nachricht n
         WHERE a.nachricht_id = n.id AND n.vorgang_id = v_id AND a.an IS NOT NULL;
        UPDATE avesmaps_community.mail_eingang e SET von_adresse = NULL, von_name = NULL, roh_datei = NULL
          FROM avesmaps_community.nachricht n
         WHERE e.nachricht_id = n.id AND n.vorgang_id = v_id
           AND (e.von_adresse IS NOT NULL OR e.von_name IS NOT NULL OR e.roh_datei IS NOT NULL);
        PERFORM avesmaps_community._ereignis(v_id, 'kontakt_abgelaufen', NULL, false, NULL, NULL, NULL, NULL);
        v_kontakt := v_kontakt + 1;
    END LOOP;
    -- Papierkorb nach 30 Tagen endgültig weg (samt Melder, Bezug, Nachrichten, Ausgängen, Eingängen, Anhängen, Notizen, Verlauf).
    DELETE FROM avesmaps_community.vorgang WHERE papierkorb_at < now() - interval '30 days';
    GET DIAGNOSTICS v_geloescht = ROW_COUNT;
    RETURN jsonb_build_object('archiviert', v_archiviert, 'kontakt', v_kontakt, 'geloescht', v_geloescht);
END;
$$;

-- Von der geltenden Fassung (0279) abgeschrieben; neu sind allein die zwei UPDATE-Anweisungen „mail_eingang“ und „mail_anhang“.
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
    UPDATE avesmaps_community.mail_ausgang a SET an = NULL
      FROM avesmaps_community.nachricht n
     WHERE a.nachricht_id = n.id AND n.vorgang_id = p_id AND a.an IS NOT NULL;
    -- Eingehende Mails: Absender, Betreff, Text, HTML und Rohmail weg; von den Anhängen bleibt höchstens, dass es sie gab (Name, Art und Größe sind personenbezogen: nur ein Platzhalter).
    UPDATE avesmaps_community.mail_eingang e
       SET von_adresse = NULL, von_name = NULL, betreff = '', text = NULL, html = NULL, extern_bilder = 0, roh_datei = NULL
      FROM avesmaps_community.nachricht n
     WHERE e.nachricht_id = n.id AND n.vorgang_id = p_id;
    UPDATE avesmaps_community.mail_anhang x
       SET datei = NULL, cid = NULL, dateiname = 'Anhang', grund = CASE WHEN x.gesperrt THEN x.grund ELSE 'entfernt' END
      FROM avesmaps_community.nachricht n
     WHERE x.nachricht_id = n.id AND n.vorgang_id = p_id;
    RETURN avesmaps_community._ereignis(p_id, 'personenbezug_geloescht', p_person, false, NULL, NULL, NULL, p_operation);
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
