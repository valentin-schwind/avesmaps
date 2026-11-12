-- Social Hub, Schritt C12b: die fremden Kanäle Facebook und Instagram (WI-0268/WI-0270, Fachkonzept project-control/planning/community-fachkonzept.md §15.4 bis §15.7, Recherche
-- project-control/discovery/social-zeichengrenzen-2026-10-31.md, Handover project-control/handovers/2026-11-01-wi0268-c12-meta-an-claudio.md). C12a (0285) hat den Weg für Mastodon gebaut: `kanal_stand`, `sendung`,
-- Freigeben/Erneut senden/Zurücknehmen je Kanal und die Funktionen des Auftrags `social_senden`. Hier kommen die beiden Kanäle von Meta dazu - ohne neue Tafel, ohne neue Jobart.
--
-- Was hier entsteht:
--   1. Die Funktionen von 0285 lernen die zwei Kanäle (jede ist von der geltenden Fassung aus 0285 abgeschrieben; Zeilenvergleich unten): `beitrag_freigeben`, `beitrag_erneut_senden`, `beitrag_kanal_zuruecknehmen`,
--      `social_senden_ergebnis`, `social_kanal_grenzen_setzen`, `social_kanal_notschalter`, `social_kanal_pruefung_eintragen`. Wo 0285 den Namen „mastodon“ fest eintrug, steht jetzt die Liste der drei Kanäle
--      mit Zugang; wo es „Mastodon“ in den Verlauf schrieb, steht der Name des Kanals (`_kanal_name`).
--   2. Zwei interne Hilfen: `_kanal_name` (der Eigenname des Kanals für den Verlauf) und `_instagram_bild_pruefen` (Instagram sendet NUR mit einem öffentlich veröffentlichten Bild).
--   3. `social_senden_ergebnis` kennt ein fünftes Ergebnis `zwischen`: Instagram sendet in zwei Schritten (Container anlegen, veröffentlichen). Meta kennt keinen Idempotenz-Kopf; damit ein Wiederholungsversuch nach einem
--      Fehler im zweiten Schritt keinen zweiten Container und keinen zweiten Beitrag anlegt, trägt der Auftrag die Kennung des Containers (`container:<Zahl>`) in `sendung.extern_id` ein, sobald Meta sie genannt hat.
--
-- Was NICHT hier entsteht (und warum):
--   - `social_senden_holen` und `job_enqueue` bleiben unverändert: Die Jobart `social_senden` gibt es seit 0285 und der Kanal ist ein Teil des Auftrags; `holen` liefert, was jeder Kanal braucht.
--   - Keine neuen Rechte: Alle Funktionen behalten Namen, Argumentliste und Rückgabetyp, also auch ihre Grants in `apps/server/src/db/community-grants.psql`. Die zwei neuen Hilfen sind intern (kein EXECUTE).
--
-- 🔴 REIN ADDITIV (docs/regeln/entwicklung.md „Migrationen: erst erweitern, dann umstellen, dann entfernen“; `migration-compat.test.ts`): Namen, Argumentlisten und Rückgabetypen bleiben; für Mastodon und die
-- Neuigkeiten tut jede Funktion genau, was sie in 0285 tat. Das vorige Release kennt Facebook und Instagram als Kanal eines Beitrags schon (0269: `beitrag.kanaele`, `beitrag_ziel.kanal`) und könnte nie einen davon
-- freigeben, ohne an `_kanal_bereit` zu scheitern (kein Eintrag in `kanal_stand`, nicht geprüft). Neue Verlaufsarten gibt es nicht.
--
-- 🔴 Freigegeben ist ein Kanal nur, wenn (a) die Umgebung ihn kennt (Konto und Zugangsschlüssel: Route und Auftrag prüfen es), (b) `kanal_stand.freigeschaltet_at` gesetzt ist (`social:pruefen`, JE KANAL; die drei
-- Prüfläufe machen Claudio und Vali nacheinander, bevor an einen der Kanäle gesendet wird), (c) der Notschalter aus ist und (d) die Grenzen gelesen sind. Die Datenbank prüft (b) bis (d) bei Freigeben und Erneut
-- senden (KC422, `_kanal_bereit`): Ein Kanal ohne Prüflauf kann nie erscheinen, auch wenn die Route umgangen wird. Vali 2026-11-01: „stopp nein wir machen alles auf einmal live“ - Mastodon, Instagram und Facebook gehen
-- gemeinsam live; einen Schalter dafür gibt es nicht, weil jeder Kanal erst nach SEINEM Prüflauf freigeschaltet wird.
--
-- 🔴 Bei Meta gelten Geschäftskonto, Bildpflicht (Instagram) und kein Ändern nach dem Senden (Fachkonzept §15.7). Zurücknehmen: Facebook löscht der Auftrag (`DELETE /{post-id}`); Instagram erlaubt kein Löschen über die
-- Schnittstelle, `beitrag_kanal_zuruecknehmen` weist es mit dem Satz ab, es in der App von Hand zu löschen.
--
-- Zeilenvergleich gegen 0285 (jede Funktion; nur Neues kommt dazu, sonst ändern sich nur die Stellen, die oben genannt sind):
--   beitrag_freigeben:          Kanalliste statt `k = 'mastodon'`; ein Zweig für Instagram (Bild); zwei weitere `_sendung_vormerken` für Facebook und Instagram.
--   beitrag_erneut_senden:      Kanalliste statt `p_kanal = 'mastodon'`; ein Zweig für Instagram (Bild); der Vermerk im Verlauf trägt `_kanal_name(p_kanal)`.
--   beitrag_kanal_zuruecknehmen: Kanalliste; ein Zweig für Instagram (kein Löschen); der Vermerk im Verlauf trägt `_kanal_name(p_kanal)`.
--   social_senden_ergebnis:     ein Ergebnis mehr (`zwischen`), der Vermerk „gesendet“ trägt `_kanal_name(p_kanal)`.
--   social_kanal_grenzen_setzen: Kanalliste; die Länge einer Adresse darf bei Meta 0 sein (Links zählen dort als Text).
--   social_kanal_notschalter, social_kanal_pruefung_eintragen: Kanalliste.
--
-- Schreiben NUR über die Funktionen des Schemas `avesmaps_community` (SECURITY DEFINER, Muster 0265 bis 0285). Fehler der Klasse `KC` (KC404 nicht gefunden, KC409 Übergang oder Revision, KC422 ungültige Angabe).

-- 1. HILFEN (nur intern; kein EXECUTE für irgendeine Rolle) ---------------------------------------------------------------------------

-- Der Eigenname eines Kanals mit Zugang, wie ihn der Verlauf nennt.
CREATE OR REPLACE FUNCTION avesmaps_community._kanal_name(p_kanal TEXT) RETURNS TEXT
    LANGUAGE sql
    IMMUTABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE p_kanal WHEN 'mastodon' THEN 'Mastodon' WHEN 'facebook' THEN 'Facebook' WHEN 'instagram' THEN 'Instagram' ELSE p_kanal END;
$$;

-- Instagram sendet nur mit Bild, und das Bild braucht eine öffentlich abrufbare Adresse (Meta holt es selbst ab): Es muss eine veröffentlichte Fassung in der Medienverwaltung haben. Ob seine Rechte geklärt sind,
-- prüft `_beitrag_bild_pruefen`; der Auftrag prüft beides vor dem Senden noch einmal.
CREATE OR REPLACE FUNCTION avesmaps_community._instagram_bild_pruefen(p_bild UUID) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF p_bild IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: Instagram sendet nur mit Bild');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.media_asset a JOIN public.media_file f ON f.media_asset_id = a.id
         WHERE a.public_id = p_bild AND f.storage_class = 'published'
    ) THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: Instagram braucht ein öffentlich veröffentlichtes Bild');
    END IF;
END;
$$;

-- 2. FREIGEBEN UND ERNEUT SENDEN (Fassung aus 0285, nur Neues kommt dazu) ---------------------------------------------------------------------

-- Freigeben und veröffentlichen (Freigebende, `manage_news`): vorgelegt → veröffentlicht; den EIGENEN Entwurf gibt ein Betreiber allein frei (E10), mit Vermerk „allein freigegeben“ im Verlauf. Einen fremden Entwurf nicht.
-- Neu seit C12b (von 0285 abgeschrieben): Facebook und Instagram sind Kanäle wie Mastodon, wenn sie bereit sind (`_kanal_bereit`); Instagram braucht außerdem ein öffentlich veröffentlichtes Bild. Ihr Ziel bleibt „wartet“
-- und die Sendung wird vorgemerkt.
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_freigeben(p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
    v_allein BOOLEAN;
    v_news BIGINT;
    k TEXT;
    v_revision INTEGER;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    v := avesmaps_community._beitrag_pruefe(p_id, p_revision);
    IF v.papierkorb_at IS NOT NULL OR v.zustand = 'veroeffentlicht' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: dieser Beitrag wird nicht (mehr) freigegeben');
    END IF;
    v_allein := v.verfasser IS NOT NULL AND v.verfasser = p_person;
    IF v.zustand = 'entwurf' AND NOT v_allein THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: der Beitrag ist noch nicht zur Freigabe vorgelegt');
    END IF;
    IF btrim(v.text) = '' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Text fehlt');
    END IF;
    PERFORM avesmaps_community._beitrag_bild_pruefen(v.bild_id, v.bild_beschreibung);
    FOREACH k IN ARRAY v.kanaele
    LOOP
        IF k IN ('mastodon', 'facebook', 'instagram') THEN
            PERFORM avesmaps_community._kanal_bereit(k);
            IF k = 'instagram' THEN
                PERFORM avesmaps_community._instagram_bild_pruefen(v.bild_id);
            END IF;
        ELSIF k <> 'neuigkeiten' THEN
            PERFORM avesmaps_community._fehler('KC422', 'community_invalid: dieser Kanal ist noch nicht verbunden');
        END IF;
    END LOOP;
    IF 'neuigkeiten' = ANY (v.kanaele) THEN
        -- Die Neuigkeit wird geschrieben, bevor der Beitrag als veröffentlicht gilt: Scheitert sie, scheitert die ganze Handlung (eine Transaktion).
        v_news := avesmaps_community._beitrag_neuigkeit_schreiben(v, p_person);
        UPDATE avesmaps_community.beitrag_ziel
           SET zustand = 'ok', adresse = 'news:' || v_news, fehler = NULL, versuche = versuche + 1, gesendet_at = now()
         WHERE beitrag_id = p_id AND kanal = 'neuigkeiten';
    END IF;
    UPDATE avesmaps_community.beitrag
       SET zustand = 'veroeffentlicht', vorgelegt_at = COALESCE(vorgelegt_at, now()), veroeffentlicht_at = now(), geaendert = false
     WHERE id = p_id;
    v_revision := avesmaps_community._beitrag_ereignis(
        p_id, 'freigegeben', p_person, CASE WHEN v_allein THEN 'allein freigegeben' ELSE NULL END, p_operation
    );
    IF 'neuigkeiten' = ANY (v.kanaele) THEN
        v_revision := avesmaps_community._beitrag_ereignis(p_id, 'gesendet', p_person, 'Neuigkeiten', NULL);
    END IF;
    -- Ein Kanal mit Zugang sendet im Auftrag `social_senden`: Hier wird die Sendung nur vorgemerkt (das Ziel bleibt „wartet“), die Route reiht den Auftrag in derselben Transaktion ein.
    IF 'mastodon' = ANY (v.kanaele) THEN
        PERFORM avesmaps_community._sendung_vormerken(p_id, 'mastodon', false);
    END IF;
    IF 'facebook' = ANY (v.kanaele) THEN
        PERFORM avesmaps_community._sendung_vormerken(p_id, 'facebook', false);
    END IF;
    IF 'instagram' = ANY (v.kanaele) THEN
        PERFORM avesmaps_community._sendung_vormerken(p_id, 'instagram', false);
    END IF;
    RETURN v_revision;
END;
$$;

-- Erneut senden, für diesen einen Kanal: bei einem Fehler oder nach dem Zurücknehmen. Dieselbe Neuigkeit, kein zweiter Eintrag (der Verweis `beitrag_id` ist eindeutig). Neu seit C12b (von 0285 abgeschrieben): auch
-- Facebook und Instagram merken die Sendung neu vor (Kennung gegen Doppeltes: bei einem Fehler dieselbe, nach dem Zurücknehmen eine neue); der Auftrag prüft vor jedem Versuch, ob Meta den Beitrag schon hat.
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_erneut_senden(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_kanal TEXT
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
    z avesmaps_community.beitrag_ziel;
    v_news BIGINT;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    v := avesmaps_community._beitrag_pruefe(p_id, p_revision);
    SELECT * INTO z FROM avesmaps_community.beitrag_ziel WHERE beitrag_id = p_id AND kanal = p_kanal FOR UPDATE;
    IF v.zustand <> 'veroeffentlicht' OR NOT FOUND OR z.zustand NOT IN ('fehler', 'zurueck') THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: erneut senden geht nur bei einem Fehler oder nach dem Zurücknehmen');
    END IF;
    IF p_kanal IN ('mastodon', 'facebook', 'instagram') THEN
        -- Dieselbe Kennung wie beim ersten Senden, damit nichts doppelt erscheint; nach dem Zurücknehmen eine neue.
        PERFORM avesmaps_community._kanal_bereit(p_kanal);
        PERFORM avesmaps_community._beitrag_bild_pruefen(v.bild_id, v.bild_beschreibung);
        IF p_kanal = 'instagram' THEN
            PERFORM avesmaps_community._instagram_bild_pruefen(v.bild_id);
        END IF;
        UPDATE avesmaps_community.beitrag_ziel SET zustand = 'wartet', fehler = NULL WHERE beitrag_id = p_id AND kanal = p_kanal;
        PERFORM avesmaps_community._sendung_vormerken(p_id, p_kanal, z.zustand = 'zurueck');
        RETURN avesmaps_community._beitrag_ereignis(p_id, 'erneut_gesendet', p_person, avesmaps_community._kanal_name(p_kanal), p_operation);
    END IF;
    IF p_kanal <> 'neuigkeiten' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: dieser Kanal ist noch nicht verbunden');
    END IF;
    PERFORM avesmaps_community._beitrag_bild_pruefen(v.bild_id, v.bild_beschreibung);
    v_news := avesmaps_community._beitrag_neuigkeit_schreiben(v, p_person);
    UPDATE avesmaps_community.beitrag_ziel
       SET zustand = 'ok', adresse = 'news:' || v_news, fehler = NULL, versuche = versuche + 1, gesendet_at = now()
     WHERE beitrag_id = p_id AND kanal = p_kanal;
    UPDATE avesmaps_community.beitrag SET geaendert = false WHERE id = p_id;
    RETURN avesmaps_community._beitrag_ereignis(p_id, 'erneut_gesendet', p_person, 'Neuigkeiten', p_operation);
END;
$$;

-- Zurücknehmen für EINEN Kanal mit Zugang (Fachkonzept §15.4: „Zurücknehmen je Kanal: Mastodon löschen“). Nur ein gesendetes Ziel; der Auftrag löscht den Beitrag beim Dienst und stellt das Ziel auf „zurückgenommen“.
-- Die Neuigkeiten nimmt weiter `beitrag_zuruecknehmen` zurück (0269). Ein zweiter Klick, solange der Auftrag läuft, ändert nichts. Der Notschalter hält das Zurücknehmen nicht an.
-- Neu seit C12b (von 0285 abgeschrieben): Facebook löscht der Auftrag wie Mastodon. 🔴 Instagram erlaubt kein Löschen über die Schnittstelle: Hier wird nichts vorgemerkt, die Antwort sagt, wie es geht.
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_kanal_zuruecknehmen(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_kanal TEXT
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
    z avesmaps_community.beitrag_ziel;
    s avesmaps_community.sendung;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    IF p_kanal = 'instagram' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: Instagram erlaubt kein Löschen über die Schnittstelle; bitte in der App löschen');
    END IF;
    IF p_kanal IS NULL OR p_kanal NOT IN ('mastodon', 'facebook') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: dieser Kanal wird nicht von hier zurückgenommen');
    END IF;
    v := avesmaps_community._beitrag_pruefe(p_id, p_revision);
    SELECT * INTO z FROM avesmaps_community.beitrag_ziel WHERE beitrag_id = p_id AND kanal = p_kanal FOR UPDATE;
    IF v.zustand <> 'veroeffentlicht' OR NOT FOUND OR z.zustand <> 'ok' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur ein gesendeter Beitrag wird zurückgenommen');
    END IF;
    SELECT * INTO s FROM avesmaps_community.sendung WHERE beitrag_id = p_id AND kanal = p_kanal FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: zu diesem Beitrag gibt es keine Sendung');
    END IF;
    -- Läuft das Zurücknehmen schon, ist ein zweiter Klick nichts (auch nicht im Verlauf).
    IF s.aufgabe = 'zuruecknehmen' THEN
        RETURN v.revision;
    END IF;
    UPDATE avesmaps_community.sendung
       SET aufgabe = 'zuruecknehmen', versuche = 0, serie = serie + 1, reserviert_bis = NULL
     WHERE beitrag_id = p_id AND kanal = p_kanal;
    UPDATE avesmaps_community.beitrag_ziel SET fehler = NULL WHERE beitrag_id = p_id AND kanal = p_kanal;
    RETURN avesmaps_community._beitrag_ereignis(p_id, 'zurueckgenommen', p_person, avesmaps_community._kanal_name(p_kanal), p_operation);
END;
$$;

-- 3. DER AUFTRAG (Jobs-Rolle) ----------------------------------------------------------------------------------------------------------------

-- Den Ausgang eines Versuchs eintragen. `p_ergebnis`: `gesendet` (der Dienst hat den Beitrag angenommen: Kennung und Adresse dort), `zurueckgenommen` (der Dienst hat ihn gelöscht), `vorlaeufig` (vorübergehender
-- Fehler: nach dem dritten Versuch wird es `fehler`), `fehler` (dauerhaft) oder - neu seit C12b - `zwischen` (ein Schritt von mehreren ist geschafft: Instagram hat den Container angelegt, `p_extern_id` ist
-- `container:<Zahl>`; die Sendung bleibt offen, die Reservierung wird verlängert, ein späterer Versuch legt keinen zweiten Container an). Gilt nur, solange eine Aufgabe aussteht; sonst NULL. Ein dauerhafter Fehler
-- beim Senden stellt das Ziel auf „Fehler“; scheitert das Zurücknehmen, bleibt das Ziel „gesendet“ und trägt den Grund. {zustand, aufgabe, versuche}.
CREATE OR REPLACE FUNCTION avesmaps_community.social_senden_ergebnis(
    p_beitrag BIGINT, p_kanal TEXT, p_ergebnis TEXT, p_extern_id TEXT, p_adresse TEXT, p_grund TEXT
) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    s avesmaps_community.sendung;
    z avesmaps_community.beitrag_ziel;
    v_grund TEXT := NULLIF(left(btrim(regexp_replace(COALESCE(p_grund, ''), '[[:cntrl:]]', ' ', 'g')), 300), '');
    v_endgueltig BOOLEAN;
BEGIN
    IF p_ergebnis IS NULL OR p_ergebnis NOT IN ('gesendet', 'zurueckgenommen', 'vorlaeufig', 'fehler', 'zwischen') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: unbekanntes Ergebnis der Sendung');
    END IF;
    -- Erst den Beitrag, dann Sendung und Ziel: dieselbe Reihenfolge der Sperren wie in den Funktionen der Redaktion.
    PERFORM 1 FROM avesmaps_community.beitrag WHERE id = p_beitrag FOR UPDATE;
    SELECT x.* INTO s FROM avesmaps_community.sendung x
     WHERE x.beitrag_id = p_beitrag AND x.kanal = p_kanal AND x.aufgabe IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO z FROM avesmaps_community.beitrag_ziel WHERE beitrag_id = p_beitrag AND kanal = p_kanal FOR UPDATE;
    IF p_ergebnis = 'gesendet' AND s.aufgabe = 'senden' THEN
        IF p_extern_id IS NULL OR char_length(p_extern_id) NOT BETWEEN 1 AND 200 OR p_adresse IS NULL OR char_length(p_adresse) > 1000 OR p_adresse !~ '^https://[^[:space:][:cntrl:]]+$' THEN
            PERFORM avesmaps_community._fehler('KC422', 'community_invalid: Kennung und Adresse des gesendeten Beitrags fehlen');
        END IF;
        UPDATE avesmaps_community.sendung
           SET aufgabe = NULL, extern_id = p_extern_id, versuche = versuche + 1, reserviert_bis = NULL
         WHERE beitrag_id = p_beitrag AND kanal = p_kanal;
        UPDATE avesmaps_community.beitrag_ziel
           SET zustand = 'ok', adresse = p_adresse, fehler = NULL, versuche = versuche + 1, gesendet_at = now()
         WHERE beitrag_id = p_beitrag AND kanal = p_kanal;
        PERFORM avesmaps_community._beitrag_ereignis_still(p_beitrag, 'gesendet', avesmaps_community._kanal_name(p_kanal));
    ELSIF p_ergebnis = 'zurueckgenommen' AND s.aufgabe = 'zuruecknehmen' THEN
        UPDATE avesmaps_community.sendung SET aufgabe = NULL, versuche = versuche + 1, reserviert_bis = NULL
         WHERE beitrag_id = p_beitrag AND kanal = p_kanal;
        UPDATE avesmaps_community.beitrag_ziel SET zustand = 'zurueck', fehler = NULL
         WHERE beitrag_id = p_beitrag AND kanal = p_kanal;
    ELSIF p_ergebnis = 'zwischen' AND s.aufgabe = 'senden' THEN
        IF p_extern_id IS NULL OR p_extern_id !~ '^container:[0-9]{1,40}$' THEN
            PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Kennung des Zwischenstands fehlt');
        END IF;
        UPDATE avesmaps_community.sendung SET extern_id = p_extern_id, reserviert_bis = now() + interval '3 minutes'
         WHERE beitrag_id = p_beitrag AND kanal = p_kanal;
    ELSIF p_ergebnis IN ('vorlaeufig', 'fehler') THEN
        v_endgueltig := p_ergebnis = 'fehler' OR s.versuche + 1 >= 3;
        IF NOT v_endgueltig THEN
            UPDATE avesmaps_community.sendung SET versuche = versuche + 1, reserviert_bis = NULL
             WHERE beitrag_id = p_beitrag AND kanal = p_kanal;
        ELSE
            UPDATE avesmaps_community.sendung SET aufgabe = NULL, versuche = versuche + 1, reserviert_bis = NULL
             WHERE beitrag_id = p_beitrag AND kanal = p_kanal;
            IF s.aufgabe = 'senden' THEN
                UPDATE avesmaps_community.beitrag_ziel
                   SET zustand = 'fehler', fehler = COALESCE(v_grund, 'Der Beitrag konnte nicht gesendet werden'), versuche = versuche + 1
                 WHERE beitrag_id = p_beitrag AND kanal = p_kanal;
            ELSE
                UPDATE avesmaps_community.beitrag_ziel SET fehler = COALESCE(v_grund, 'Das Zurücknehmen ist gescheitert')
                 WHERE beitrag_id = p_beitrag AND kanal = p_kanal;
            END IF;
        END IF;
    ELSE
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: das Ergebnis passt nicht zur Aufgabe');
    END IF;
    SELECT * INTO s FROM avesmaps_community.sendung WHERE beitrag_id = p_beitrag AND kanal = p_kanal;
    SELECT * INTO z FROM avesmaps_community.beitrag_ziel WHERE beitrag_id = p_beitrag AND kanal = p_kanal;
    RETURN jsonb_build_object('zustand', z.zustand, 'aufgabe', s.aufgabe, 'versuche', s.versuche);
END;
$$;

-- 4. VERWALTUNG DER KANÄLE -----------------------------------------------------------------------------------------------------------------

-- Die Grenzen eines Kanals eintragen (von 0285 abgeschrieben). Bei Mastodon sind es die Grenzen, die die Instanz nennt; bei Facebook und Instagram nennt Meta keine: Dort sind es die Zahlen des Hubs (Recherche §2),
-- die der tägliche Lauf zusammen mit der Prüfung des Zugangs einträgt - die Grenzen stehen dort, damit `_kanal_bereit` einen Kanal nur freigibt, dessen Zugang einmal gelesen wurde. Die Länge einer Adresse ist bei
-- Meta 0: Links zählen dort als Text. Wer das darf, prüft die Route (`manage_social_channels`); die tägliche Pflege der Jobs-Rolle und das Werkzeug `social:pruefen` rufen sie ebenfalls.
CREATE OR REPLACE FUNCTION avesmaps_community.social_kanal_grenzen_setzen(p_kanal TEXT, p_grenzen JSONB) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_grenzen JSONB;
    k TEXT;
    -- Die kleinste Länge einer Adresse: Mastodon nennt sie (mindestens 1), bei Meta zählen Links als Text (0). Außerhalb der Bedingung, denn plpgsql schneidet eine Bedingung am ersten THEN ab.
    v_adresse_min BIGINT := CASE WHEN p_kanal = 'mastodon' THEN 1 ELSE 0 END;
BEGIN
    IF p_kanal IS NULL OR p_kanal NOT IN ('mastodon', 'facebook', 'instagram') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: dieser Kanal hat keine Grenzen zu lesen');
    END IF;
    IF p_grenzen IS NULL OR jsonb_typeof(p_grenzen) <> 'object' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Grenzen fehlen');
    END IF;
    FOREACH k IN ARRAY ARRAY['zeichen', 'adresse', 'bilder', 'beschreibung', 'bildBytes']
    LOOP
        IF jsonb_typeof(p_grenzen -> k) IS DISTINCT FROM 'number' OR (p_grenzen ->> k) !~ '^[0-9]{1,12}$' THEN
            PERFORM avesmaps_community._fehler('KC422', 'community_invalid: eine Grenze ist keine ganze Zahl');
        END IF;
    END LOOP;
    IF (p_grenzen ->> 'zeichen')::bigint NOT BETWEEN 1 AND 100000
       OR (p_grenzen ->> 'adresse')::bigint NOT BETWEEN v_adresse_min AND 1000
       OR (p_grenzen ->> 'bilder')::bigint > 100 OR (p_grenzen ->> 'beschreibung')::bigint > 100000 OR (p_grenzen ->> 'bildBytes')::bigint > 1073741824 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: eine Grenze liegt außerhalb des Üblichen');
    END IF;
    IF jsonb_typeof(p_grenzen -> 'bildTypen') IS DISTINCT FROM 'array' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Bildformate fehlen');
    END IF;
    IF jsonb_array_length(p_grenzen -> 'bildTypen') > 50 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_grenzen -> 'bildTypen') AS t(wert)
         WHERE jsonb_typeof(t.wert) <> 'string' OR (t.wert #>> '{}') !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
    ) THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Bildformate stimmen nicht');
    END IF;
    v_grenzen := jsonb_build_object(
        'zeichen', (p_grenzen ->> 'zeichen')::bigint, 'adresse', (p_grenzen ->> 'adresse')::bigint, 'bilder', (p_grenzen ->> 'bilder')::bigint,
        'beschreibung', (p_grenzen ->> 'beschreibung')::bigint, 'bildBytes', (p_grenzen ->> 'bildBytes')::bigint, 'bildTypen', p_grenzen -> 'bildTypen'
    );
    INSERT INTO avesmaps_community.kanal_stand (kanal, grenzen, grenzen_at) VALUES (p_kanal, v_grenzen, now())
    ON CONFLICT (kanal) DO UPDATE SET grenzen = EXCLUDED.grenzen, grenzen_at = EXCLUDED.grenzen_at;
    RETURN v_grenzen;
END;
$$;

-- Der Notschalter eines Kanals (Fachkonzept §15.6; von 0285 abgeschrieben, die Kanalliste ist länger). `geaendert` sagt, ob sich etwas änderte: Die Route schreibt das Protokoll nur dann. Wer das darf, prüft die Route
-- (`manage_social_channels`, frischer Passkey).
CREATE OR REPLACE FUNCTION avesmaps_community.social_kanal_notschalter(p_kanal TEXT, p_an BOOLEAN) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_alt BOOLEAN;
BEGIN
    IF p_kanal IS NULL OR p_kanal NOT IN ('mastodon', 'facebook', 'instagram') OR p_an IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: dieser Kanal hat keinen Notschalter');
    END IF;
    SELECT notschalter INTO v_alt FROM avesmaps_community.kanal_stand WHERE kanal = p_kanal FOR UPDATE;
    INSERT INTO avesmaps_community.kanal_stand (kanal, notschalter) VALUES (p_kanal, p_an)
    ON CONFLICT (kanal) DO UPDATE SET notschalter = EXCLUDED.notschalter;
    RETURN jsonb_build_object('notschalter', p_an, 'geaendert', COALESCE(v_alt, false) IS DISTINCT FROM p_an);
END;
$$;

-- Das Ergebnis der Prüfung der Zählregel eintragen (Recherche §5, Fachkonzept §15.7; von 0285 abgeschrieben, die Kanalliste ist länger). Bei Übereinstimmung wird der Kanal freigeschaltet, sonst wieder gesperrt. Das
-- Werkzeug `social:pruefen --anwenden` ruft sie nach dem Zuruf des Betreibers, JE KANAL; die Route ruft sie nie. Die Grenzen müssen gelesen sein: Geprüft wird gegen den Zugang, dessen Grenzen die Zählung kennt.
CREATE OR REPLACE FUNCTION avesmaps_community.social_kanal_pruefung_eintragen(
    p_kanal TEXT, p_durch TEXT, p_ok BOOLEAN, p_pruefung JSONB
) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    s avesmaps_community.kanal_stand;
BEGIN
    IF p_kanal IS NULL OR p_kanal NOT IN ('mastodon', 'facebook', 'instagram') OR p_ok IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: dieser Kanal wird nicht geprüft');
    END IF;
    IF char_length(COALESCE(btrim(p_durch), '')) NOT BETWEEN 1 AND 80 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: es fehlt, wer geprüft hat');
    END IF;
    SELECT * INTO s FROM avesmaps_community.kanal_stand WHERE kanal = p_kanal FOR UPDATE;
    IF NOT FOUND OR s.grenzen IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: erst die Grenzen des Kanals lesen');
    END IF;
    UPDATE avesmaps_community.kanal_stand
       SET freigeschaltet_at = CASE WHEN p_ok THEN now() END, geprueft_durch = CASE WHEN p_ok THEN btrim(p_durch) END, pruefung = p_pruefung
     WHERE kanal = p_kanal;
    RETURN jsonb_build_object('freigeschaltet', p_ok);
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
