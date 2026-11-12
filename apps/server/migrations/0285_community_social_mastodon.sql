-- Social Hub, Schritt C12a: der fremde Kanal Mastodon (WI-0268, Fachkonzept project-control/planning/community-fachkonzept.md §15.4 bis §15.7, Recherche project-control/discovery/social-zeichengrenzen-2026-10-31.md,
-- Handover project-control/handovers/2026-10-31-wi0268-c12-mastodon-an-claudio.md). C11 (0269) kennt Mastodon schon als Kanal eines Beitrags (`beitrag.kanaele`, ein Ziel `beitrag_ziel`), sendet aber nur an die
-- Neuigkeiten. Hier kommt das Senden dazu.
--
-- Was hier entsteht:
--   1. `kanal_stand`: je Kanal mit Zugang EINE Zeile - die Grenzen, die der Dienst von sich nennt (Mastodon: `GET /api/v2/instance`) mit dem Tag des Lesens, der Notschalter und die Freischaltung. Frei geschaltet
--      wird ein Kanal erst, wenn seine Zählregel gegen ein Testkonto geprüft ist (Recherche §5; Werkzeug `social:pruefen`), nie von der App.
--   2. `sendung`: die Technik hinter einem Ziel (Kennung gegen Doppeltes, Kennung des Beitrags beim Dienst, was gerade aussteht, Reservierung). Den Stand (wartet, gesendet, Fehler, zurückgenommen) und die Adresse
--      des Beitrags beim Dienst führt WEITER das Ziel `beitrag_ziel` - keine zweite Wahrheit, keine Parallelstruktur.
--   3. Freigeben, Erneut senden und das Zurücknehmen je Kanal: `beitrag_freigeben` und `beitrag_erneut_senden` (von der geltenden Fassung aus 0269
--      abgeschrieben; Zeilenvergleich: `beitrag_erneut_senden` und `job_enqueue` bekommen nur Zeilen dazu, in `beitrag_freigeben` laufen die Schritte der Neuigkeiten unverändert, nur eingerückt
--      in ein `IF 'neuigkeiten' = ANY (v.kanaele)`, und der Verlaufseintrag „freigegeben“ setzt jetzt `v_revision`),
--      neu `beitrag_kanal_zuruecknehmen`. Sie MERKEN die Sendung vor; gesendet wird im Auftrag `social_senden` (Jobs-Rolle, Anwendung `jobs/social-senden-job.ts`), den die Route in derselben Transaktion einreiht.
--   4. Die Funktionen des Auftrags (Jobs-Rolle, kein Tafelrecht): `social_senden_holen` (reservieren und liefern, was zum Senden nötig ist), `social_senden_ergebnis` (den Ausgang eintragen).
--   5. Die Funktionen der Verwaltung: `social_kanal_grenzen_setzen` (App nach `manage_social_channels`, die Pflege der Jobs-Rolle, das Werkzeug), `social_kanal_notschalter` (App nach `manage_social_channels`
--      mit frischem Passkey), `social_kanal_pruefung_eintragen` (nur das Werkzeug `social:pruefen`, mit dem Zuruf des Betreibers; die Route ruft sie nie).
--   6. `job_enqueue` lernt die Jobart `social_senden` (🪤 0239: eine Art im Katalog, die die Anwendung nicht einreihen darf, endet beim ersten Einreihen in 42501).
--
-- 🔴 REIN ADDITIV (docs/regeln/entwicklung.md „Migrationen: erst erweitern, dann umstellen, dann entfernen“; `migration-compat.test.ts`): zwei neue Tafeln, neue Funktionen. `beitrag_freigeben`,
-- `beitrag_erneut_senden` und `job_enqueue` behalten Namen, Argumentliste und Rückgabetyp und tun für die Neuigkeiten genau, was sie taten; das vorige Release ruft sie weiter und kennt Mastodon als Kanal schon
-- (0269: `beitrag.kanaele`, `beitrag_ziel.kanal` nennen ihn). Eine Zeile `mastodon` in `beitrag.kanaele`, die das vorige Release schriebe, scheiterte dort beim Freigeben mit „noch nicht verbunden“ wie bisher.
-- Neue Verlaufsarten gibt es nicht (das vorige Release kennt die Arten von 0269 und fände eine fremde in seiner Antwort); der Verlauf nennt den Kanal im Vermerk.
--
-- 🔴 Mastodon ist freigegeben, wenn (a) die Umgebung ihn kennt (Adresse und Zugangsschlüssel: die Route und der Auftrag prüfen es, die Datenbank kennt beide nicht), (b) `kanal_stand.freigeschaltet_at` gesetzt ist
-- (`social:pruefen`), (c) `kanal_stand.notschalter` aus ist und (d) die Grenzen gelesen sind. Die Datenbank prüft (b) bis (d) bei Freigeben und Erneut senden (KC422); der Notschalter hält auch einen schon
-- vorgemerkten Beitrag am Senden (der Auftrag liest ihn frisch). Zurücknehmen geht auch bei gesetztem Notschalter: Er stoppt das Senden, nicht das Löschen.
--
-- 🔴 Kennung gegen Doppeltes: Jede Sendung trägt eine Kennung (`sendung.idempotenz`), die als `Idempotency-Key` zum Dienst geht. Dieselbe Serie sendet immer mit derselben Kennung, auch nach einem Fehler und beim
-- Erneut senden aus `fehler` (Fachkonzept §15.4: „mit derselben Kennung, damit nichts doppelt erscheint“); erst nach dem Zurücknehmen bekommt eine neue Serie eine neue Kennung (der Dienst kennt die alte als
-- gesendet und gäbe den gelöschten Beitrag zurück).
--
-- Schreiben NUR über die Funktionen des Schemas `avesmaps_community` (SECURITY DEFINER, Muster 0265 bis 0283). Rechte stehen in `apps/server/src/db/community-grants.psql`. Fehler der Klasse `KC`
-- (KC404 nicht gefunden, KC409 Übergang oder Revision, KC422 ungültige Angabe).

-- 1. TAFELN ------------------------------------------------------------------------------------------------------------------------------

-- Der Stand eines Kanals mit Zugang. Der Zugangsschlüssel und die Adresse der Instanz stehen NIE hier (Umgebung des Prozesses, Fachkonzept §15.7).
CREATE TABLE IF NOT EXISTS avesmaps_community.kanal_stand (
    kanal TEXT PRIMARY KEY,
    -- Die Grenzen, wie der Dienst sie nennt (Mastodon: zeichen, adresse, bilder, beschreibung, bildBytes, bildTypen). Die Zählung des Hubs nimmt sie statt fester Zahlen.
    grenzen JSONB,
    grenzen_at TIMESTAMPTZ,
    notschalter BOOLEAN NOT NULL DEFAULT false,
    -- Gesetzt erst nach der geprüften Zählregel (`social:pruefen`); `geprueft_durch` ist die Marke des Werkzeugs (`cli:<Benutzer>`), nie ein Konto der Anwendung.
    freigeschaltet_at TIMESTAMPTZ,
    geprueft_durch TEXT,
    -- Das Ergebnis der letzten Prüfung (Zahl der Fälle, Übereinstimmungen, Tag); ohne Text der Testbeiträge.
    pruefung JSONB,
    CONSTRAINT kanal_stand_kanal CHECK (kanal IN ('mastodon', 'bluesky', 'instagram', 'facebook', 'discord')),
    CONSTRAINT kanal_stand_grenzen CHECK (grenzen IS NULL OR (jsonb_typeof(grenzen) = 'object' AND grenzen_at IS NOT NULL)),
    CONSTRAINT kanal_stand_freigabe CHECK ((freigeschaltet_at IS NULL) = (geprueft_durch IS NULL)),
    CONSTRAINT kanal_stand_durch CHECK (geprueft_durch IS NULL OR char_length(geprueft_durch) BETWEEN 1 AND 80)
);
COMMENT ON TABLE avesmaps_community.kanal_stand IS
    'Stand der fremden Kanäle des Social Hubs (WI-0268 C12a): gelesene Grenzen, Notschalter, Freischaltung nach geprüfter Zählregel. Nie ein Zugangsschlüssel, nie die Adresse der Instanz.';

-- Die Technik hinter einem Ziel eines fremden Kanals. `aufgabe` sagt, was der Auftrag tun soll: senden oder zurücknehmen; NULL, wenn nichts aussteht. `serie` zählt Erneut senden und Zurücknehmen, `versuche` die
-- Versuche dieser Serie (höchstens drei, dann `fehler`). `reserviert_bis` hält zwei Aufträge am selben Beitrag auseinander.
CREATE TABLE IF NOT EXISTS avesmaps_community.sendung (
    beitrag_id BIGINT NOT NULL,
    kanal TEXT NOT NULL,
    idempotenz UUID NOT NULL DEFAULT gen_random_uuid(),
    extern_id TEXT,
    aufgabe TEXT,
    versuche INTEGER NOT NULL DEFAULT 0,
    serie INTEGER NOT NULL DEFAULT 1,
    reserviert_bis TIMESTAMPTZ,
    PRIMARY KEY (beitrag_id, kanal),
    CONSTRAINT sendung_ziel FOREIGN KEY (beitrag_id, kanal) REFERENCES avesmaps_community.beitrag_ziel (beitrag_id, kanal) ON DELETE CASCADE,
    CONSTRAINT sendung_idempotenz UNIQUE (idempotenz),
    CONSTRAINT sendung_aufgabe CHECK (aufgabe IS NULL OR aufgabe IN ('senden', 'zuruecknehmen')),
    CONSTRAINT sendung_extern CHECK (extern_id IS NULL OR char_length(extern_id) BETWEEN 1 AND 200),
    CONSTRAINT sendung_zaehler CHECK (versuche BETWEEN 0 AND 20 AND serie >= 1)
);
COMMENT ON TABLE avesmaps_community.sendung IS
    'Technik der Sendung an einen fremden Kanal (WI-0268 C12a): Kennung gegen Doppeltes, Kennung beim Dienst, ausstehende Aufgabe. Der Stand und die Adresse stehen im Ziel (`beitrag_ziel`).';

-- 2. HILFEN (nur intern; kein EXECUTE für irgendeine Rolle) ---------------------------------------------------------------------------

-- Darf an diesen Kanal gesendet werden? Die Zählregel muss geprüft (freigeschaltet), der Notschalter aus und die Grenzen gelesen sein. Sonst KC422 mit dem Grund.
CREATE OR REPLACE FUNCTION avesmaps_community._kanal_bereit(p_kanal TEXT) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    s avesmaps_community.kanal_stand;
BEGIN
    SELECT * INTO s FROM avesmaps_community.kanal_stand WHERE kanal = p_kanal;
    IF NOT FOUND OR s.freigeschaltet_at IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Zählregel dieses Kanals ist noch nicht geprüft');
    END IF;
    IF s.grenzen IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Grenzen dieses Kanals sind noch nicht gelesen');
    END IF;
    IF s.notschalter THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Notschalter dieses Kanals steht an');
    END IF;
END;
$$;

-- Eine Sendung vormerken (oder neu aufsetzen): Aufgabe „senden“, neue Serie, Versuche von vorn. Mit `p_neue_kennung` (nach dem Zurücknehmen) bekommt sie eine neue Kennung und vergisst die Kennung beim Dienst.
CREATE OR REPLACE FUNCTION avesmaps_community._sendung_vormerken(p_id BIGINT, p_kanal TEXT, p_neue_kennung BOOLEAN) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    INSERT INTO avesmaps_community.sendung (beitrag_id, kanal, aufgabe) VALUES (p_id, p_kanal, 'senden')
    ON CONFLICT (beitrag_id, kanal) DO UPDATE
       SET aufgabe = 'senden', versuche = 0, serie = avesmaps_community.sendung.serie + 1, reserviert_bis = NULL,
           idempotenz = CASE WHEN p_neue_kennung THEN gen_random_uuid() ELSE avesmaps_community.sendung.idempotenz END,
           extern_id = CASE WHEN p_neue_kennung THEN NULL ELSE avesmaps_community.sendung.extern_id END;
END;
$$;

-- Ein Ereignis in den Verlauf schreiben, ohne die Revision zu zählen: Was der Auftrag meldet, ändert nicht den Beitrag, den eine Person gerade offen hat. Der Vermerk nennt den Kanal.
CREATE OR REPLACE FUNCTION avesmaps_community._beitrag_ereignis_still(p_id BIGINT, p_art TEXT, p_text TEXT) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_seq INTEGER;
BEGIN
    SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM avesmaps_community.beitrag_ereignis WHERE beitrag_id = p_id;
    INSERT INTO avesmaps_community.beitrag_ereignis (beitrag_id, seq, art, von_person, text, operation_id)
    VALUES (p_id, v_seq, p_art, NULL, NULLIF(btrim(p_text), ''), NULL);
END;
$$;

-- 3. FREIGEBEN UND ERNEUT SENDEN (Fassung aus 0269, nur Neues kommt dazu) --------------------------------------------------------------------

-- Freigeben und veröffentlichen (Freigebende, `manage_news`): vorgelegt → veröffentlicht; den EIGENEN Entwurf gibt ein Betreiber allein frei (E10), mit
-- Vermerk „allein freigegeben“ im Verlauf. Einen fremden Entwurf nicht. Die Neuigkeiten schreibt diese Funktion selbst in `news_entry` und sagt dem Ziel die Adresse.
-- Neu seit C12a (von 0269 abgeschrieben): Mastodon ist ein Kanal, wenn er bereit ist (`_kanal_bereit`); sein Ziel bleibt „wartet“ und die Sendung wird vorgemerkt. Ein Beitrag ohne Neuigkeiten schreibt keinen Eintrag
-- und keinen Verlaufseintrag „gesendet Neuigkeiten“. Jeder andere Kanal ist (noch) nicht verbunden.
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
        IF k = 'mastodon' THEN
            PERFORM avesmaps_community._kanal_bereit(k);
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
    RETURN v_revision;
END;
$$;

-- Erneut senden, für diesen einen Kanal: bei einem Fehler oder nach dem Zurücknehmen. Dieselbe Neuigkeit, kein zweiter Eintrag (der Verweis `beitrag_id`
-- ist eindeutig). Neu seit C12a (von 0269 abgeschrieben): bei Mastodon wird die Sendung neu vorgemerkt (Kennung gegen Doppeltes: bei einem Fehler dieselbe, nach dem Zurücknehmen eine neue).
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
    IF p_kanal = 'mastodon' THEN
        -- Dieselbe Kennung wie beim ersten Senden, damit nichts doppelt erscheint; nach dem Zurücknehmen eine neue.
        PERFORM avesmaps_community._kanal_bereit(p_kanal);
        PERFORM avesmaps_community._beitrag_bild_pruefen(v.bild_id, v.bild_beschreibung);
        UPDATE avesmaps_community.beitrag_ziel SET zustand = 'wartet', fehler = NULL WHERE beitrag_id = p_id AND kanal = p_kanal;
        PERFORM avesmaps_community._sendung_vormerken(p_id, p_kanal, z.zustand = 'zurueck');
        RETURN avesmaps_community._beitrag_ereignis(p_id, 'erneut_gesendet', p_person, 'Mastodon', p_operation);
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
    IF p_kanal IS NULL OR p_kanal <> 'mastodon' THEN
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
    RETURN avesmaps_community._beitrag_ereignis(p_id, 'zurueckgenommen', p_person, 'Mastodon', p_operation);
END;
$$;

-- 4. DER AUFTRAG (Jobs-Rolle) ----------------------------------------------------------------------------------------------------------------

-- Die Sendung zum Ausführen reservieren und alles liefern, was der Auftrag braucht: Aufgabe, Text, Hashtags, Bild samt Beschreibung und Datei, Kennung gegen Doppeltes, Kennung beim Dienst, Notschalter, Grenzen.
-- NULL, wenn nichts aussteht; {reserviert: true}, wenn gerade ein anderer Versuch läuft (er hält die Sendung drei Minuten; stirbt er, sendet der nächste danach, mit derselben Kennung).
-- 🔴 Das Bild gibt es nur, wenn seine Rechte geklärt sind und es nicht ausgeblendet (Notaus) ist; die Datei ist die veröffentlichte WebP-Fassung, nie das Original.
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
        'aufgabe', s.aufgabe, 'nummer', avesmaps_community._soc(p_beitrag), 'text', b.text, 'hashtags', to_jsonb(b.hashtags),
        'bild', b.bild_id::text, 'bildBeschreibung', b.bild_beschreibung, 'bildFrei', COALESCE(v_frei, false), 'bildDatei', v_datei,
        'idempotenz', s.idempotenz::text, 'externId', s.extern_id, 'versuche', s.versuche, 'serie', s.serie,
        'notschalter', COALESCE(k.notschalter, false), 'freigeschaltet', k.freigeschaltet_at IS NOT NULL,
        'grenzen', k.grenzen, 'grenzenAt', k.grenzen_at
    );
END;
$$;

-- Den Ausgang eines Versuchs eintragen. `p_ergebnis`: `gesendet` (der Dienst hat den Beitrag angenommen: Kennung und Adresse dort), `zurueckgenommen` (der Dienst hat ihn gelöscht), `vorlaeufig` (vorübergehender
-- Fehler: nach dem dritten Versuch wird es `fehler`) oder `fehler` (dauerhaft). Gilt nur, solange eine Aufgabe aussteht; sonst NULL. Ein dauerhafter Fehler beim Senden stellt das Ziel auf „Fehler“; scheitert das
-- Zurücknehmen, bleibt das Ziel „gesendet“ und trägt den Grund. {zustand, aufgabe, versuche}.
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
    IF p_ergebnis IS NULL OR p_ergebnis NOT IN ('gesendet', 'zurueckgenommen', 'vorlaeufig', 'fehler') THEN
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
        PERFORM avesmaps_community._beitrag_ereignis_still(p_beitrag, 'gesendet', 'Mastodon');
    ELSIF p_ergebnis = 'zurueckgenommen' AND s.aufgabe = 'zuruecknehmen' THEN
        UPDATE avesmaps_community.sendung SET aufgabe = NULL, versuche = versuche + 1, reserviert_bis = NULL
         WHERE beitrag_id = p_beitrag AND kanal = p_kanal;
        UPDATE avesmaps_community.beitrag_ziel SET zustand = 'zurueck', fehler = NULL
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

-- 5. VERWALTUNG DER KANÄLE -----------------------------------------------------------------------------------------------------------------

-- Die Grenzen eines Kanals eintragen, wie der Dienst sie nennt (die Anwendung hat sie gelesen und bereinigt; hier stehen die harten Grenzen). Wer das darf, prüft die Route (`manage_social_channels`); die
-- tägliche Pflege der Jobs-Rolle und das Werkzeug `social:pruefen` rufen sie ebenfalls. Unbekannte Felder fallen weg. Gibt die gespeicherten Grenzen zurück.
CREATE OR REPLACE FUNCTION avesmaps_community.social_kanal_grenzen_setzen(p_kanal TEXT, p_grenzen JSONB) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_grenzen JSONB;
    k TEXT;
BEGIN
    IF p_kanal IS NULL OR p_kanal <> 'mastodon' THEN
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
    IF (p_grenzen ->> 'zeichen')::bigint NOT BETWEEN 1 AND 100000 OR (p_grenzen ->> 'adresse')::bigint NOT BETWEEN 1 AND 1000
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

-- Der Notschalter eines Kanals (Fachkonzept §15.6). `geaendert` sagt, ob sich etwas änderte: Die Route schreibt das Protokoll nur dann. Wer das darf, prüft die Route (`manage_social_channels`, frischer Passkey).
CREATE OR REPLACE FUNCTION avesmaps_community.social_kanal_notschalter(p_kanal TEXT, p_an BOOLEAN) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_alt BOOLEAN;
BEGIN
    IF p_kanal IS NULL OR p_kanal <> 'mastodon' OR p_an IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: dieser Kanal hat keinen Notschalter');
    END IF;
    SELECT notschalter INTO v_alt FROM avesmaps_community.kanal_stand WHERE kanal = p_kanal FOR UPDATE;
    INSERT INTO avesmaps_community.kanal_stand (kanal, notschalter) VALUES (p_kanal, p_an)
    ON CONFLICT (kanal) DO UPDATE SET notschalter = EXCLUDED.notschalter;
    RETURN jsonb_build_object('notschalter', p_an, 'geaendert', COALESCE(v_alt, false) IS DISTINCT FROM p_an);
END;
$$;

-- Das Ergebnis der Prüfung der Zählregel eintragen (Recherche §5, Fachkonzept §15.7). Bei Übereinstimmung wird der Kanal freigeschaltet, sonst wieder gesperrt. Das Werkzeug `social:pruefen --anwenden` ruft sie nach dem
-- Zuruf des Betreibers; die Route ruft sie nie. Die Grenzen müssen gelesen sein: Geprüft wird gegen die Instanz, deren Grenzen die Zählung kennt.
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
    IF p_kanal IS NULL OR p_kanal <> 'mastodon' OR p_ok IS NULL THEN
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

-- 6. DIE JOBART ----------------------------------------------------------------------------------------------------------------------------

-- Von der geltenden Fassung (0279) abgeschrieben und nur um die eine Art erweitert; die Signatur bleibt. Wer `job_enqueue` danach neu schreibt, nimmt `social_senden` mit.
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
        'wiki_dump_holen', 'sprache_treffer', 'community_mail_versand', 'social_senden'
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
    'Einreihen durch einen Editor-Auslöser (Q10; WI-0068 P4a: media_settle; WI-0127 SYS-14: legacy_pull, legacy_media; WI-0141: legacy_zug mit Kategorie; WI-0144: production_pull; WI-0178 B3: land_smooth, label_runs; WI-0209 B3: territory_derive; WI-0068: media_merge_all; WI-0177: path_label_runs; WI-0153 7b: sea_derive; WI-0220 Schnitt 3: map_series_tile; WI-0220 Schnitt 4: map_series_production; WI-0251: abzug_lokal; WI-0253 D-1: wiki_vorschau, wiki_uebernehmen, wiki_zuruecknehmen; WI-0253 C-2: wiki_kategorien; WI-0253 D-2: wiki_artikel; WI-0253 B-1: wiki_dump_einlesen, erst mit 0239 erlaubt; WI-0253 §22: wiki_dump_holen; WI-0261 S4: sprache_treffer; WI-0268 C6a: community_mail_versand; WI-0268 C12a: social_senden). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

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
