-- Social Hub: der Kanal Discord (WI-0268; Vali 2026-11-03: „schön wärs, wenn posts die da mit angehäkelt werden in unserem discord channel 1523841043890704534 (Neue Features) landen“; Handover
-- project-control/handovers/2026-11-03-social-hub-discord-kanal-an-claudia.md). C12a (0285) und C12b (0286) haben den Weg für Mastodon, Facebook und Instagram gebaut: `kanal_stand`, `sendung`, Freigeben/Erneut senden/
-- Zurücknehmen je Kanal und die Funktionen des Auftrags `social_senden`. Discord nimmt denselben Weg - ohne neue Tafel, ohne neue Jobart, ohne neue Rechte.
--
-- Was hier entsteht: Die Funktionen lernen den vierten Kanal (jede ist von ihrer geltenden Fassung abgeschrieben; Zeilenvergleich unten). `social_senden_holen` nennt zusätzlich die Titelzeile: Die Vorschau des Hubs zeigt
-- den Beitrag bei Discord als Einbettung mit Titelzeile, und so geht er auch hinaus. Die Kanalliste von `kanal_stand` und die von `beitrag.kanaele` kennen Discord schon seit 0285 und 0269.
--
-- 🔴 REIN ADDITIV (docs/regeln/entwicklung.md „Migrationen: erst erweitern, dann umstellen, dann entfernen“; `migration-compat.test.ts`): Namen, Argumentlisten und Rückgabetypen bleiben, darum auch die Grants in
-- `apps/server/src/db/community-grants.psql`; für die drei anderen Kanäle tut jede Funktion genau, was sie vorher tat. Das vorige Release kennt Discord als Kanal eines Beitrags schon und kann ihn nie freigeben: Ohne
-- Eintrag in `kanal_stand` (geprüft, Grenzen gelesen) scheitert es an `_kanal_bereit`. Das zusätzliche Feld in der Antwort von `social_senden_holen` übersieht es.
--
-- 🔴 Freigegeben ist auch Discord nur, wenn (a) die Umgebung den Webhook und den Kanal kennt (Route und Auftrag prüfen es), (b) `kanal_stand.freigeschaltet_at` gesetzt ist (`social:pruefen --kanal discord --anwenden`
-- mit dem Zitat des Betreibers), (c) der Notschalter aus ist und (d) die Grenzen eingetragen sind. Der Prüflauf schickt nichts: Einen Testkanal gibt es nicht, und eine Probe in den echten Kanal gibt es nur mit Valis Wort.
--
-- Zeilenvergleich (jede Funktion; sonst ändert sich nichts):
--   _kanal_name:                 ein Name mehr (Fassung 0286).
--   beitrag_freigeben:           Kanalliste; ein weiteres `_sendung_vormerken` für Discord (Fassung 0286).
--   beitrag_erneut_senden:       Kanalliste (Fassung 0286).
--   beitrag_kanal_zuruecknehmen: Kanalliste (Fassung 0286). Discord löscht der Auftrag wie Mastodon und Facebook.
--   social_senden_holen:         ein Feld mehr, `titel` (Fassung 0285).
--   social_kanal_grenzen_setzen, social_kanal_notschalter, social_kanal_pruefung_eintragen: Kanalliste (Fassung 0286).
--
-- Schreiben NUR über die Funktionen des Schemas `avesmaps_community` (SECURITY DEFINER, Muster 0265 bis 0286). Fehler der Klasse `KC`.

CREATE OR REPLACE FUNCTION avesmaps_community._kanal_name(p_kanal TEXT) RETURNS TEXT
    LANGUAGE sql
    IMMUTABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE p_kanal WHEN 'mastodon' THEN 'Mastodon' WHEN 'facebook' THEN 'Facebook' WHEN 'instagram' THEN 'Instagram' WHEN 'discord' THEN 'Discord' ELSE p_kanal END;
$$;

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
        IF k IN ('mastodon', 'facebook', 'instagram', 'discord') THEN
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
    IF 'discord' = ANY (v.kanaele) THEN
        PERFORM avesmaps_community._sendung_vormerken(p_id, 'discord', false);
    END IF;
    RETURN v_revision;
END;
$$;

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
    IF p_kanal IN ('mastodon', 'facebook', 'instagram', 'discord') THEN
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
    IF p_kanal IS NULL OR p_kanal NOT IN ('mastodon', 'facebook', 'discord') THEN
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

CREATE OR REPLACE FUNCTION avesmaps_community.social_senden_holen(p_beitrag BIGINT, p_kanal TEXT) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    s avesmaps_community.sendung;
    b avesmaps_community.beitrag;
    k avesmaps_community.kanal_stand;
    v_datei JSONB;
    v_frei BOOLEAN;
BEGIN
    UPDATE avesmaps_community.sendung x
       SET reserviert_bis = now() + interval '3 minutes'
     WHERE x.beitrag_id = p_beitrag AND x.kanal = p_kanal AND x.aufgabe IS NOT NULL AND (x.reserviert_bis IS NULL OR x.reserviert_bis < now())
    RETURNING x.* INTO s;
    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM avesmaps_community.sendung x WHERE x.beitrag_id = p_beitrag AND x.kanal = p_kanal AND x.aufgabe IS NOT NULL) THEN
            RETURN jsonb_build_object('reserviert', true);
        END IF;
        RETURN NULL;
    END IF;
    SELECT * INTO b FROM avesmaps_community.beitrag WHERE id = p_beitrag;
    SELECT * INTO k FROM avesmaps_community.kanal_stand WHERE kanal = p_kanal;
    IF b.bild_id IS NOT NULL THEN
        SELECT jsonb_build_object('schluessel', f.storage_key, 'mime', f.mime_type, 'bytes', f.byte_size) INTO v_datei
          FROM public.media_asset a JOIN public.media_file f ON f.media_asset_id = a.id
         WHERE a.public_id = b.bild_id AND f.storage_class = 'published'
         ORDER BY f.width DESC NULLS LAST, f.id
         LIMIT 1;
        v_frei := EXISTS (
                SELECT 1 FROM public.media_asset a JOIN public.media_rights r ON r.media_asset_id = a.id
                 WHERE a.public_id = b.bild_id AND r.clearance_state IN ('cleared', 'legacy_asserted')
            )
            AND NOT EXISTS (
                SELECT 1 FROM public.media_asset a
                  JOIN public.media_file q ON q.media_asset_id = a.id AND q.storage_class = 'private_source'
                  JOIN public.media_publication_suspension u ON u.source_sha256 = q.sha256 AND u.lifted_at IS NULL
                 WHERE a.public_id = b.bild_id
            );
    END IF;
    RETURN jsonb_build_object(
        'aufgabe', s.aufgabe, 'nummer', avesmaps_community._soc(p_beitrag), 'titel', b.titel, 'text', b.text, 'hashtags', to_jsonb(b.hashtags),
        'bild', b.bild_id::text, 'bildBeschreibung', b.bild_beschreibung, 'bildFrei', COALESCE(v_frei, false), 'bildDatei', v_datei,
        'idempotenz', s.idempotenz::text, 'externId', s.extern_id, 'versuche', s.versuche, 'serie', s.serie,
        'notschalter', COALESCE(k.notschalter, false), 'freigeschaltet', k.freigeschaltet_at IS NOT NULL,
        'grenzen', k.grenzen, 'grenzenAt', k.grenzen_at
    );
END;
$$;

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
    IF p_kanal IS NULL OR p_kanal NOT IN ('mastodon', 'facebook', 'instagram', 'discord') THEN
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

CREATE OR REPLACE FUNCTION avesmaps_community.social_kanal_notschalter(p_kanal TEXT, p_an BOOLEAN) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_alt BOOLEAN;
BEGIN
    IF p_kanal IS NULL OR p_kanal NOT IN ('mastodon', 'facebook', 'instagram', 'discord') OR p_an IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: dieser Kanal hat keinen Notschalter');
    END IF;
    SELECT notschalter INTO v_alt FROM avesmaps_community.kanal_stand WHERE kanal = p_kanal FOR UPDATE;
    INSERT INTO avesmaps_community.kanal_stand (kanal, notschalter) VALUES (p_kanal, p_an)
    ON CONFLICT (kanal) DO UPDATE SET notschalter = EXCLUDED.notschalter;
    RETURN jsonb_build_object('notschalter', p_an, 'geaendert', COALESCE(v_alt, false) IS DISTINCT FROM p_an);
END;
$$;

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
    IF p_kanal IS NULL OR p_kanal NOT IN ('mastodon', 'facebook', 'instagram', 'discord') OR p_ok IS NULL THEN
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
