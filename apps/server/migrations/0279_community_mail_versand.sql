-- Community-Modul, Schritt C6a: Antworten und neue Mails gehen als echte Mail raus (WI-0268; Fachkonzept project-control/planning/community-fachkonzept.md §3.4, §5, §9, §10.2;
-- Bedienkonzept §3.3 bis §3.5; Handover project-control/handovers/2026-10-31-wi0268-c6-mailweg-an-claudio.md). Der Abruf aus dem Postfach (IMAP) ist C6b und kommt nicht hier.
--
-- Was hier entsteht:
--   1. `mail_ausgang`: je ausgehender Mail eine Zeile (Empfänger, Betreff, Message-ID, Zustellstand, Versuche). Die Nachricht selbst bleibt in `nachricht` (`weg = 'mail'`, 0265 kennt den Weg schon).
--   2. Die Funktionen der App: `community_anfrage_antworten_mail` (Antwort per Mail), `community_mail_neu` (neue Mail an eine freie Adresse), `community_mail_erneut` (Erneut senden).
--   3. Die Funktionen des Versandjobs (Jobs-Rolle): `community_mail_holen` (die Mail zum Senden reservieren), `community_mail_zustellung` (den Ausgang des Versuchs eintragen).
--   4. `job_enqueue` lernt die Jobart `community_mail_versand` (🪤 0239: eine Art im Katalog, die die Anwendung nicht einreihen darf, endet beim ersten Einreihen in 42501).
--   5. Die Aufbewahrung nimmt die Adresse der ausgehenden Mails mit: `mail_ausgang.an` fällt mit den Kontaktdaten nach 90 Tagen weg (`community_purge_expired`) und bei „Personenbezug
--      löschen“ (`community_personenbezug_loeschen`); beide Funktionen sind von ihrer GELTENDEN Fassung (0265) abgeschrieben und nur um diese eine Zeile erweitert.
--
-- 🔴 Der Empfänger einer Antwort ist die Adresse des Melders dieses Vorgangs, nie eine Angabe des Aufrufers: `community_anfrage_antworten_mail` hat keinen Parameter für eine Adresse. Nur
-- `community_mail_neu` nimmt eine, und deren Recht (`send_new_mail`) und Tagesgrenze (`p_grenze`, 429) prüft die Datenbank bzw. die Route. Jede Adresse prüft die Datenbank gegen EIN Muster
-- (`_mail_adresse`: genau eine Adresse, kein Komma, kein Strichpunkt, keine Klammern, keine Anführungszeichen), denn aus einer Adresse darf nie mehrere Empfänger werden.
--
-- 🔴 Zustand `wartet` heißt „wird gesendet“, `gesendet` „vom Mailserver angenommen“ (nicht: gelesen), `fehler` „nicht zugestellt“ mit kurzem Grund ohne Geheimnis. Ein Versuch reserviert die Mail
-- mit einer Frist (`reserviert_bis`), damit zwei Jobs sie nicht zugleich senden; stirbt ein Job mitten im Versand, läuft die Reservierung ab und der nächste sendet. Wiederholung derselben Kennung
-- legt nie eine zweite Mail an (`_schon`, wie 0265).
--
-- 🔴 „Antworten und ins Archiv“ (`danach_archiv`): Die Anfrage bleibt im Eingang (Zustand „wartet auf Antwort“), bis die Mail angenommen ist, und wandert dann ins Archiv (Ergebnis `beantwortet`,
-- nur wenn sie noch in der Rückfrage steht). Scheitert der Versand, bleibt sie im Eingang (Bedienkonzept §3.3).
--
-- 🔴 REIN ADDITIV: eine neue Tafel, neue Funktionen; `job_enqueue`, `community_purge_expired` und `community_personenbezug_loeschen` sind mit gleicher Signatur nur erweitert, `CREATE OR REPLACE`
-- behält Eigentümer und Rechte. Das vorige Release kennt die Tafel nie und reiht die Art nie ein. Fehler wie in 0265: KC404, KC409 (Übergang oder Revision), KC422 (ungültige Angabe), neu KC429
-- (Tagesgrenze der neuen Mails; die App bildet sie auf `community_mail_grenze` ab). Die Rechte stehen in `apps/server/src/db/community-grants.psql`.

-- 1. TAFEL -------------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS avesmaps_community.mail_ausgang (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nachricht_id BIGINT NOT NULL UNIQUE REFERENCES avesmaps_community.nachricht (id) ON DELETE CASCADE,
    -- Der Empfänger. NULL, sobald die Kontaktdaten abgelaufen sind (Fachkonzept §10.2); eine Mail, die dann noch wartet, wird `fehler`.
    an TEXT,
    -- Der Betreff, wie er hinausgeht: „Re: <Betreff> [COM-000123]“ bzw. bei einer neuen Mail „<Betreff> [COM-000123]“. Eine Zeile, keine Steuerzeichen.
    betreff TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    in_reply_to TEXT,
    zustand TEXT NOT NULL DEFAULT 'wartet',
    -- Der kurze Grund des letzten Fehlversuchs (Satz der Oberfläche, nie Nutzer oder Kennwort des Mailservers).
    fehler TEXT,
    versuche INTEGER NOT NULL DEFAULT 0,
    -- Zählt die Läufe von „Erneut senden“ (beginnt mit 1): Die Glocke meldet je Lauf einmal.
    serie INTEGER NOT NULL DEFAULT 1,
    -- „Antworten und ins Archiv“: nach der Annahme durch den Mailserver ins Archiv.
    danach_archiv BOOLEAN NOT NULL DEFAULT false,
    reserviert_bis TIMESTAMPTZ,
    angelegt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    gesendet_at TIMESTAMPTZ,
    CONSTRAINT mail_ausgang_an CHECK (
        an IS NULL OR (
            char_length(an) BETWEEN 3 AND 254
            AND an ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'
        )
    ),
    CONSTRAINT mail_ausgang_betreff CHECK (char_length(betreff) BETWEEN 1 AND 300 AND betreff !~ '[[:cntrl:]]'),
    CONSTRAINT mail_ausgang_message_id CHECK (message_id ~ '^<[A-Za-z0-9._-]{1,120}@[A-Za-z0-9.-]{1,253}>$'),
    CONSTRAINT mail_ausgang_in_reply_to CHECK (in_reply_to IS NULL OR in_reply_to ~ '^<[A-Za-z0-9._-]{1,120}@[A-Za-z0-9.-]{1,253}>$'),
    CONSTRAINT mail_ausgang_zustand CHECK (zustand IN ('wartet', 'gesendet', 'fehler')),
    CONSTRAINT mail_ausgang_fehler CHECK (fehler IS NULL OR char_length(fehler) BETWEEN 1 AND 300),
    CONSTRAINT mail_ausgang_versuche CHECK (versuche BETWEEN 0 AND 20 AND serie >= 1),
    CONSTRAINT mail_ausgang_gesendet CHECK ((zustand = 'gesendet') = (gesendet_at IS NOT NULL))
);
COMMENT ON TABLE avesmaps_community.mail_ausgang IS 'Ausgehende Mails des Community-Moduls (WI-0268 C6a): Zustellstand je Nachricht mit dem Weg mail. Die Adresse faellt mit den Kontaktdaten weg.';

-- 2. HILFEN (nur intern; kein EXECUTE für irgendeine Rolle) ---------------------------------------------------------------------------

-- Genau EINE Adresse? Dasselbe Muster wie `MAIL_ADRESSE_MUSTER` in `packages/shared/src/community.ts` und der CHECK oben.
CREATE OR REPLACE FUNCTION avesmaps_community._mail_adresse(p_text TEXT) RETURNS BOOLEAN
    LANGUAGE sql
    IMMUTABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT p_text IS NOT NULL AND char_length(p_text) BETWEEN 3 AND 254
       AND p_text ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$';
$$;

-- Die Message-ID einer ausgehenden Mail: <com-000123.<uuid>@<Domäne des Absenders>>. Die Domäne gibt die App aus `COMMUNITY_MAIL_FROM`; hier nur geprüft.
CREATE OR REPLACE FUNCTION avesmaps_community._mail_message_id(p_id BIGINT, p_domain TEXT) RETURNS TEXT
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF p_domain IS NULL OR p_domain !~ '^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Domäne des Absenders fehlt');
    END IF;
    RETURN '<' || lower(avesmaps_community._com(p_id)) || '.' || gen_random_uuid()::text || '@' || lower(p_domain) || '>';
END;
$$;

-- Der Betreff einer Antwort: „Re: <Betreff> [COM-000123]“. Der Betreff ist die erste Zeile der ersten Nachricht des Absenders (ohne Steuerzeichen, höchstens 120 Zeichen); bei einem Vorgang, den
-- die Redaktion begonnen hat, der Betreff der ersten Mail. Fehlt beides: „Ihre Nachricht“.
CREATE OR REPLACE FUNCTION avesmaps_community._mail_betreff_antwort(p_id BIGINT, p_eingang TEXT) RETURNS TEXT
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_ein TEXT;
    v_aus TEXT;
    v_basis TEXT;
BEGIN
    SELECT left(btrim(regexp_replace(split_part(btrim(n.text), chr(10), 1), '[[:cntrl:]]', ' ', 'g')), 120) INTO v_ein
      FROM avesmaps_community.nachricht n
     WHERE n.vorgang_id = p_id AND n.richtung = 'ein' AND n.text IS NOT NULL
     ORDER BY n.at, n.id LIMIT 1;
    SELECT regexp_replace(regexp_replace(a.betreff, ' \[COM-[0-9]+\]$', ''), '^Re: ', '') INTO v_aus
      FROM avesmaps_community.mail_ausgang a JOIN avesmaps_community.nachricht n ON n.id = a.nachricht_id
     WHERE n.vorgang_id = p_id
     ORDER BY n.at, n.id LIMIT 1;
    v_basis := COALESCE(NULLIF(CASE WHEN p_eingang = 'redaktion' THEN COALESCE(v_aus, v_ein) ELSE COALESCE(v_ein, v_aus) END, ''), 'Ihre Nachricht');
    RETURN 'Re: ' || left(v_basis, 150) || ' [' || avesmaps_community._com(p_id) || ']';
END;
$$;

-- Die Message-ID der jüngsten ausgehenden Mail dieses Vorgangs (für `In-Reply-To` der nächsten); NULL, wenn es noch keine gab.
CREATE OR REPLACE FUNCTION avesmaps_community._mail_letzte_id(p_id BIGINT) RETURNS TEXT
    LANGUAGE sql
    STABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT a.message_id
      FROM avesmaps_community.mail_ausgang a JOIN avesmaps_community.nachricht n ON n.id = a.nachricht_id
     WHERE n.vorgang_id = p_id
     ORDER BY n.at DESC, n.id DESC LIMIT 1;
$$;

-- 3. DIE APP (die App hat die Person angemeldet und ihr Recht geprüft) ---------------------------------------------------------------------

-- Antworten per Mail (Bedienkonzept §3.3): wie `community_anfrage_antworten` (0271), aber `weg = 'mail'` und mit einem Ausgang. Der Empfänger ist die Adresse des Melders dieses Vorgangs; hat er keine
-- (oder ist sie abgelaufen oder keine einzelne Adresse), KC409. `answer_community` prüft die Route. Mit `p_archivieren` wandert die Anfrage erst ins Archiv, wenn die Mail angenommen ist.
-- Gibt {revision, ausgang, neu} zurück; `neu` ist falsch bei einer Wiederholung derselben Kennung (dann reiht die App nichts ein).
CREATE OR REPLACE FUNCTION avesmaps_community.community_anfrage_antworten_mail(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_text TEXT, p_archivieren BOOLEAN, p_domain TEXT
) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
    v_mail TEXT;
    v_nachricht BIGINT;
    v_ausgang BIGINT;
    v_revision INTEGER;
BEGIN
    IF avesmaps_community._schon(p_operation) THEN
        SELECT a.id INTO v_ausgang
          FROM avesmaps_community.mail_ausgang a JOIN avesmaps_community.nachricht n ON n.id = a.nachricht_id
         WHERE n.operation_id = p_operation;
        SELECT g.revision INTO v_revision FROM avesmaps_community.vorgang g WHERE g.id = p_id;
        RETURN jsonb_build_object('revision', v_revision, 'ausgang', v_ausgang, 'neu', false);
    END IF;
    v := avesmaps_community._pruefe(p_id, p_revision);
    PERFORM avesmaps_community._nur_anfrage(v.art);
    IF v.papierkorb_at IS NOT NULL OR v.zustand = 'abgeschlossen' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: zum Antworten erst zurück in den Eingang holen');
    END IF;
    IF char_length(btrim(COALESCE(p_text, ''))) NOT BETWEEN 1 AND 4000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Antwort braucht 1 bis 4000 Zeichen');
    END IF;
    SELECT m.mail INTO v_mail FROM avesmaps_community.melder m WHERE m.vorgang_id = p_id AND m.entfernt_at IS NULL;
    IF NOT avesmaps_community._mail_adresse(v_mail) THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: keine Adresse zum Antworten per Mail');
    END IF;
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, von_person, operation_id)
    VALUES (p_id, 'aus', 'mail', btrim(p_text), p_person, p_operation)
    RETURNING id INTO v_nachricht;
    INSERT INTO avesmaps_community.mail_ausgang (nachricht_id, an, betreff, message_id, in_reply_to, danach_archiv)
    VALUES (
        v_nachricht, v_mail, avesmaps_community._mail_betreff_antwort(p_id, v.eingang), avesmaps_community._mail_message_id(p_id, p_domain),
        avesmaps_community._mail_letzte_id(p_id), COALESCE(p_archivieren, false)
    )
    RETURNING id INTO v_ausgang;
    -- Wie bei der Antwort auf die Statusseite: Wer antwortet, ist dran (die Erinnerung nach 30 Tagen geht an sie), der Zustand ist „wartet auf Antwort“.
    IF v.zustaendig IS NULL THEN
        UPDATE avesmaps_community.vorgang SET zustaendig = p_person WHERE id = p_id;
        PERFORM avesmaps_community._ereignis(p_id, 'uebernommen', p_person, false, NULL, p_person::text, NULL, NULL);
    END IF;
    UPDATE avesmaps_community.vorgang SET zustand = 'rueckfrage', rueckfrage_at = now() WHERE id = p_id;
    v_revision := avesmaps_community._ereignis(p_id, 'rueckfrage', p_person, false, v.zustand, 'rueckfrage', NULL, p_operation);
    RETURN jsonb_build_object('revision', v_revision, 'ausgang', v_ausgang, 'neu', true);
END;
$$;

-- Eine neue Mail an eine freie Adresse (Bedienkonzept §3.5, Fachkonzept §9): legt einen Vorgang an (Anfrage, Kategorie `sonstiges`, Eingang `redaktion`, Zustand „wartet auf Antwort“, zuständig die
-- schreibende Person), den Absender mit der Zieladresse, die ausgehende Nachricht und den Ausgang. `send_new_mail` prüft die Route. Höchstens `p_grenze` neue Mails je Person in 24 Stunden, sonst KC429.
-- Die Kennung der Operation ist die des Vorgangs. Gibt {id, ausgang, neu} zurück.
CREATE OR REPLACE FUNCTION avesmaps_community.community_mail_neu(
    p_operation UUID, p_person UUID, p_an TEXT, p_betreff TEXT, p_text TEXT, p_domain TEXT, p_grenze INTEGER
) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_ausgang BIGINT;
    v_an TEXT := btrim(COALESCE(p_an, ''));
    v_betreff TEXT := btrim(COALESCE(p_betreff, ''));
    v_text TEXT := btrim(COALESCE(p_text, ''));
    v_nachricht BIGINT;
    v_heute INTEGER;
BEGIN
    SELECT g.id INTO v_id FROM avesmaps_community.vorgang g WHERE g.operation_id = p_operation;
    IF FOUND THEN
        SELECT a.id INTO v_ausgang
          FROM avesmaps_community.mail_ausgang a JOIN avesmaps_community.nachricht n ON n.id = a.nachricht_id
         WHERE n.vorgang_id = v_id ORDER BY a.id LIMIT 1;
        RETURN jsonb_build_object('id', v_id, 'ausgang', v_ausgang, 'neu', false);
    END IF;
    IF p_person IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die schreibende Person fehlt');
    END IF;
    IF NOT avesmaps_community._mail_adresse(v_an) THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Adresse stimmt nicht');
    END IF;
    IF char_length(v_betreff) NOT BETWEEN 1 AND 150 OR v_betreff ~ '[[:cntrl:]]' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Betreff braucht 1 bis 150 Zeichen in einer Zeile');
    END IF;
    IF char_length(v_text) NOT BETWEEN 1 AND 4000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Nachricht braucht 1 bis 4000 Zeichen');
    END IF;
    -- Die Tagesgrenze je Person; die Sperre hält zwei gleichzeitige Mails hintereinander, damit die Grenze nicht umgangen wird.
    PERFORM pg_advisory_xact_lock(hashtext('community_mail_neu'), hashtext(p_person::text));
    SELECT count(*)::int INTO v_heute
      FROM avesmaps_community.vorgang g
     WHERE g.art = 'anfrage' AND g.eingang = 'redaktion' AND g.angelegt_von = p_person AND g.eingegangen_at > now() - interval '24 hours';
    IF v_heute >= GREATEST(COALESCE(p_grenze, 20), 1) THEN
        PERFORM avesmaps_community._fehler('KC429', 'community_mail_grenze: die Tagesgrenze für neue Mails ist erreicht');
    END IF;
    INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, zustand, rueckfrage_at, zustaendig, angelegt_von, operation_id)
    VALUES ('anfrage', 'sonstiges', 'redaktion', 'rueckfrage', now(), p_person, p_person, p_operation)
    RETURNING id INTO v_id;
    INSERT INTO avesmaps_community.melder (vorgang_id, mail) VALUES (v_id, v_an);
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, von_person, operation_id)
    VALUES (v_id, 'aus', 'mail', v_text, p_person, gen_random_uuid())
    RETURNING id INTO v_nachricht;
    INSERT INTO avesmaps_community.mail_ausgang (nachricht_id, an, betreff, message_id)
    VALUES (v_nachricht, v_an, v_betreff || ' [' || avesmaps_community._com(v_id) || ']', avesmaps_community._mail_message_id(v_id, p_domain))
    RETURNING id INTO v_ausgang;
    PERFORM avesmaps_community._ereignis(v_id, 'eingang', p_person, false, NULL, 'neu', NULL, NULL);
    PERFORM avesmaps_community._ereignis(v_id, 'uebernommen', p_person, false, NULL, p_person::text, NULL, NULL);
    PERFORM avesmaps_community._ereignis(v_id, 'rueckfrage', p_person, false, 'neu', 'rueckfrage', NULL, NULL);
    RETURN jsonb_build_object('id', v_id, 'ausgang', v_ausgang, 'neu', true);
END;
$$;

-- Erneut senden (Bedienkonzept §3.3): eine nicht zugestellte Mail geht zurück auf „wartet“ (neue Serie, Versuche von vorn). Nur aus `fehler`; in jedem anderen Zustand tut es nichts (`neu` falsch),
-- so wiederholt eine zweite Anfrage nichts. Nicht für einen Vorgang im Papierkorb. Gibt {ausgang, neu} zurück. `answer_community` prüft die Route.
CREATE OR REPLACE FUNCTION avesmaps_community.community_mail_erneut(p_operation UUID, p_id BIGINT, p_nachricht BIGINT, p_person UUID)
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
    a avesmaps_community.mail_ausgang;
BEGIN
    v := avesmaps_community._sperre(p_id);
    PERFORM avesmaps_community._nur_anfrage(v.art);
    IF v.papierkorb_at IS NOT NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: eine Anfrage im Papierkorb wird nicht gesendet');
    END IF;
    SELECT x.* INTO a
      FROM avesmaps_community.mail_ausgang x JOIN avesmaps_community.nachricht n ON n.id = x.nachricht_id
     WHERE n.id = p_nachricht AND n.vorgang_id = p_id
       FOR UPDATE OF x;
    IF NOT FOUND THEN
        PERFORM avesmaps_community._fehler('KC404', 'community_not_found: diese Mail gibt es nicht');
    END IF;
    IF a.zustand <> 'fehler' THEN
        RETURN jsonb_build_object('ausgang', a.id, 'neu', false);
    END IF;
    UPDATE avesmaps_community.mail_ausgang
       SET zustand = 'wartet', fehler = NULL, versuche = 0, serie = serie + 1, reserviert_bis = NULL
     WHERE id = a.id;
    RETURN jsonb_build_object('ausgang', a.id, 'neu', true);
END;
$$;

-- 4. DER VERSANDJOB (Jobs-Rolle) --------------------------------------------------------------------------------------------------------------

-- Die Mail zum Senden reservieren und alles liefern, was der Versand braucht. NULL, wenn sie nicht (mehr) wartet; {reserviert: true}, wenn gerade ein anderer Versuch läuft. Die Reservierung gilt drei Minuten: stirbt der
-- Job mitten im Versand, sendet der nächste danach; wer zugleich kommt, bekommt {reserviert: true} und sendet nicht doppelt. {ausgang, nummer, an, betreff, text, messageId, inReplyTo, references, person, versuche, serie}.
CREATE OR REPLACE FUNCTION avesmaps_community.community_mail_holen(p_ausgang BIGINT) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    a avesmaps_community.mail_ausgang;
    n avesmaps_community.nachricht;
    v_referenzen JSONB;
BEGIN
    UPDATE avesmaps_community.mail_ausgang x
       SET reserviert_bis = now() + interval '3 minutes'
     WHERE x.id = p_ausgang AND x.zustand = 'wartet' AND (x.reserviert_bis IS NULL OR x.reserviert_bis < now())
    RETURNING x.* INTO a;
    IF NOT FOUND THEN
        -- Wartet sie, aber hält ein anderer Versuch die Reservierung, sagt es der Marker (der Job sieht später noch einmal nach); sonst gibt es nichts zu tun.
        IF EXISTS (SELECT 1 FROM avesmaps_community.mail_ausgang x WHERE x.id = p_ausgang AND x.zustand = 'wartet') THEN
            RETURN jsonb_build_object('reserviert', true);
        END IF;
        RETURN NULL;
    END IF;
    SELECT * INTO n FROM avesmaps_community.nachricht WHERE id = a.nachricht_id;
    SELECT COALESCE(jsonb_agg(r.message_id ORDER BY r.at, r.nr), '[]'::jsonb) INTO v_referenzen
      FROM (
          SELECT y.message_id, m.at, m.id AS nr
            FROM avesmaps_community.mail_ausgang y JOIN avesmaps_community.nachricht m ON m.id = y.nachricht_id
           WHERE m.vorgang_id = n.vorgang_id AND y.id <> a.id AND (m.at, m.id) < (n.at, n.id)
           ORDER BY m.at DESC, m.id DESC LIMIT 10
      ) r;
    RETURN jsonb_build_object(
        'ausgang', a.id, 'nummer', avesmaps_community._com(n.vorgang_id), 'an', a.an, 'betreff', a.betreff, 'text', n.text,
        'messageId', a.message_id, 'inReplyTo', a.in_reply_to, 'references', v_referenzen, 'person', n.von_person::text,
        'versuche', a.versuche, 'serie', a.serie
    );
END;
$$;

-- Den Ausgang eines Versuchs eintragen. `p_ergebnis`: `gesendet` (vom Mailserver angenommen), `vorlaeufig` (vorübergehender Fehler: nach dem dritten Versuch wird es `fehler`) oder `fehler` (dauerhaft).
-- Gilt nur, solange die Mail wartet; sonst NULL. Bei `gesendet` und `danach_archiv` kommt die Anfrage ins Archiv, wenn sie noch in der Rückfrage steht. {zustand, versuche, serie, person, nummer}.
CREATE OR REPLACE FUNCTION avesmaps_community.community_mail_zustellung(p_ausgang BIGINT, p_ergebnis TEXT, p_grund TEXT) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    a avesmaps_community.mail_ausgang;
    n avesmaps_community.nachricht;
    v avesmaps_community.vorgang;
    v_grund TEXT := NULLIF(left(btrim(regexp_replace(COALESCE(p_grund, ''), '[[:cntrl:]]', ' ', 'g')), 300), '');
    v_zustand TEXT;
BEGIN
    IF p_ergebnis IS NULL OR p_ergebnis NOT IN ('gesendet', 'vorlaeufig', 'fehler') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: unbekanntes Ergebnis des Versands');
    END IF;
    SELECT x.* INTO a FROM avesmaps_community.mail_ausgang x WHERE x.id = p_ausgang AND x.zustand = 'wartet' FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO n FROM avesmaps_community.nachricht WHERE id = a.nachricht_id;
    IF p_ergebnis = 'gesendet' THEN
        v_zustand := 'gesendet';
    ELSIF p_ergebnis = 'fehler' OR a.versuche + 1 >= 3 THEN
        v_zustand := 'fehler';
    ELSE
        v_zustand := 'wartet';
    END IF;
    UPDATE avesmaps_community.mail_ausgang
       SET zustand = v_zustand, versuche = versuche + 1, reserviert_bis = NULL,
           fehler = CASE WHEN v_zustand = 'gesendet' THEN NULL ELSE COALESCE(v_grund, 'Die Mail konnte nicht gesendet werden') END,
           gesendet_at = CASE WHEN v_zustand = 'gesendet' THEN now() END
     WHERE id = a.id
    RETURNING * INTO a;
    IF v_zustand = 'gesendet' AND a.danach_archiv THEN
        SELECT * INTO v FROM avesmaps_community.vorgang WHERE id = n.vorgang_id FOR UPDATE;
        IF v.zustand = 'rueckfrage' AND v.papierkorb_at IS NULL AND v.archiviert_at IS NULL THEN
            PERFORM avesmaps_community._anfrage_beenden(v.id, n.von_person, 'beantwortet', NULL, NULL);
        END IF;
    END IF;
    RETURN jsonb_build_object(
        'zustand', a.zustand, 'versuche', a.versuche, 'serie', a.serie, 'person', n.von_person::text,
        'nummer', avesmaps_community._com(n.vorgang_id)
    );
END;
$$;

-- 5. DIE JOBART ----------------------------------------------------------------------------------------------------------------------------

-- Von der geltenden Fassung (0256) abgeschrieben und nur um die eine Art erweitert; die Signatur bleibt. Wer `job_enqueue` danach neu schreibt, nimmt `community_mail_versand` mit.
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
        'terrain_preview', 'path_profile', 'media_quarantine', 'kanal_bild', 'legacy_zug', 'production_pull',
        'land_smooth', 'label_runs', 'territory_derive', 'media_merge_all', 'path_label_runs', 'sea_derive',
        'map_series_tile', 'map_series_production', 'abzug_lokal',
        'wiki_dump_einlesen', 'wiki_vorschau', 'wiki_uebernehmen', 'wiki_zuruecknehmen', 'wiki_kategorien', 'wiki_artikel',
        'wiki_dump_holen', 'sprache_treffer', 'community_mail_versand'
    ) THEN
        RAISE EXCEPTION 'job_enqueue: Jobart % darf die Anwendung nicht einreihen', COALESCE(p_kind, '(leer)')
            USING ERRCODE = '42501';
    END IF;
    -- Ein Zug einer Kategorie nennt genau eine der drei. Herrschaftsgebiete gibt es hier nicht und nie (Betreiber 2026-10-13):
    -- Die Sperre steht in der Datenbank, nicht nur im Werkzeug, damit kein Aufrufer sie umgehen kann.
    IF p_kind = 'legacy_zug' AND COALESCE(p_input_ref->>'kategorie', '') NOT IN ('landschaften', 'wege', 'orte') THEN
        RAISE EXCEPTION 'job_enqueue: legacy_zug braucht die Kategorie landschaften, wege oder orte (nicht %)',
            COALESCE(p_input_ref->>'kategorie', '(leer)') USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT i.id, i.public_id FROM job_insert(
        p_kind, p_kind_version, p_map_domain_id, 'queued', p_actor_ref, NULL, NULL, p_input_ref, p_priority,
        p_not_before, p_scope_kind, p_scope_tiles, p_depends_on
    ) i;
END;
$$;

COMMENT ON FUNCTION job_enqueue IS
    'Einreihen durch einen Editor-Auslöser (Q10; WI-0068 P4a: media_settle; WI-0127 SYS-14: legacy_pull, legacy_media; WI-0141: legacy_zug mit Kategorie; WI-0144: production_pull; WI-0178 B3: land_smooth, label_runs; WI-0209 B3: territory_derive; WI-0068: media_merge_all; WI-0177: path_label_runs; WI-0153 7b: sea_derive; WI-0220 Schnitt 3: map_series_tile; WI-0220 Schnitt 4: map_series_production; WI-0251: abzug_lokal; WI-0253 D-1: wiki_vorschau, wiki_uebernehmen, wiki_zuruecknehmen; WI-0253 C-2: wiki_kategorien; WI-0253 D-2: wiki_artikel; WI-0253 B-1: wiki_dump_einlesen, erst mit 0239 erlaubt; WI-0253 §22: wiki_dump_holen; WI-0261 S4: sprache_treffer; WI-0268 C6a: community_mail_versand). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

-- 6. AUFBEWAHRUNG ----------------------------------------------------------------------------------------------------------------------------

-- Von der geltenden Fassung (0265) abgeschrieben; neu ist allein die Zeile „mail_ausgang.an“ in der Schleife der Kontaktdaten.
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
    -- Kontaktdaten und Statuslink 90 Tage nach dem Abschluss; Texte und Meldung bleiben im Archiv. Die Adresse der ausgehenden Mails zählt zu den Kontaktdaten (Fachkonzept §10.2).
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
        PERFORM avesmaps_community._ereignis(v_id, 'kontakt_abgelaufen', NULL, false, NULL, NULL, NULL, NULL);
        v_kontakt := v_kontakt + 1;
    END LOOP;
    -- Papierkorb nach 30 Tagen endgültig weg (samt Melder, Bezug, Nachrichten, Ausgängen, Notizen, Verlauf).
    DELETE FROM avesmaps_community.vorgang WHERE papierkorb_at < now() - interval '30 days';
    GET DIAGNOSTICS v_geloescht = ROW_COUNT;
    RETURN jsonb_build_object('archiviert', v_archiviert, 'kontakt', v_kontakt, 'geloescht', v_geloescht);
END;
$$;

-- Von der geltenden Fassung (0265) abgeschrieben; neu ist allein die Zeile „mail_ausgang.an“.
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
