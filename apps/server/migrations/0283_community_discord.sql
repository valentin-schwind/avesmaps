-- Community-Modul, Schritt C8: „Mit Discord verbinden“ für Melder und die Production-Seite der Brücke für /offen und /erledigt (WI-0268; Fachkonzept
-- project-control/planning/community-fachkonzept.md §8.2 bis §8.5 und §8.3a, §10.2; Bedienkonzept §5; Handover
-- project-control/handovers/2026-10-31-wi0268-c8-discord-bruecke-an-claudio.md). Vali 2026-10-31: E5 „Mit Discord verbinden“ (OAuth) und auf die Frage „Sollen
-- Website-Meldungen auch in Discord unter /offen erscheinen?“ wörtlich „Ja, über Production (A)“.
--
-- Was hier entsteht:
--   1. `melder.discord_name`: der Anzeigename zur Verbindung (die Kennung `discord_id` gibt es seit 0265). Länge und Form prüft die Funktion, keine neue Prüfung auf der alten Tafel.
--   2. Der Weg über Discord kennt einen neuen Zweck `melder`: `avesmaps_auth.oauth_flow` lässt ihn zu und trägt dazu den HASH des Statusschlüssels (`melder_hash`; der Schlüssel selbst steht nie in der
--      Datenbank). Die Spalte wird geleert, sobald der Rückweg sie gelesen hat.
--   3. Vier Funktionen (SECURITY DEFINER, Muster 0265):
--      - `community_discord_verbinden(hash, kennung, name)`: setzt Kennung und Anzeigename am Melder des Vorgangs zu diesem Statusschlüssel (offen oder abgeschlossen, solange der Melder nicht entfernt ist).
--      - `community_discord_loesen(hash)`: entfernt die Kennung aus ALLEN Vorgängen, die dieselbe Kennung tragen wie der Vorgang des Schlüssels (Fachkonzept §8.4); liefert die Zahl.
--      - `community_discord_offen(kennung)`: die offenen Vorgänge dieser Kennung, die nicht im Papierkorb liegen: Nummer, Zustand, Kategorie, Bezugsname. Nie Text, Name, Adresse.
--      - `community_discord_zurueckziehen(operation, kennung, id)`: wie `community_status_zurueckziehen`, aber für die Kennung statt für den Schlüssel; Ergebnis `zurueckgezogen`, `nicht_gefunden` (auch für den
--        Vorgang einer anderen Kennung) oder `schon_abgeschlossen`.
--   4. Aufbewahrung: Der Anzeigename ist Kontaktdatum und fällt mit den übrigen (90 Tage nach Abschluss und bei „Personenbezug löschen“, Fachkonzept §10.2). Dafür sind `community_purge_expired` und
--      `community_personenbezug_loeschen` von ihrer GELTENDEN Fassung (0281) abgeschrieben und um eine Zuweisung erweitert. `community_status_lesen` (0265) liefert zusätzlich `discordName`, damit die Statusseite
--      „Mit Discord verbunden als …“ zeigen kann (nie die Kennung).
--
-- 🔴 Die Discord-Kennung verlässt die Datenbank nur im Vergleich: keine Funktion gibt sie zurück, `community_discord_offen` und `community_status_lesen` nennen sie nie.
-- 🔴 REIN ADDITIV: eine nullable Spalte je Tafel, eine gelockerte Liste der Zwecke (das vorige Release schreibt nur die vier bisherigen), vier neue Funktionen, drei mit gleicher Signatur nur erweitert (`CREATE OR REPLACE`
-- behält Eigentümer und Rechte). Die Rechte der neuen Funktionen stehen in `apps/server/src/db/community-grants.psql`.

-- 1. TAFELN ------------------------------------------------------------------------------------------------------------------------------------

ALTER TABLE avesmaps_community.melder ADD COLUMN IF NOT EXISTS discord_name TEXT;
COMMENT ON COLUMN avesmaps_community.melder.discord_name IS
    'Anzeigename der verbundenen Discord-Kennung (WI-0268 C8) zum Zeitpunkt der Verbindung; fällt mit den Kontaktdaten weg (Fachkonzept §10.2). Länge und Form prüft community_discord_verbinden.';

-- Der Zweck `melder`: nur gelockert (die bisherigen vier Zwecke bleiben). `melder_hash` ist sha256 des Statusschlüssels und nur für diesen Zweck gesetzt.
ALTER TABLE avesmaps_auth.oauth_flow ADD COLUMN IF NOT EXISTS melder_hash BYTEA
    CONSTRAINT oauth_flow_melder_hash CHECK (melder_hash IS NULL OR (purpose = 'melder' AND octet_length(melder_hash) = 32));
ALTER TABLE avesmaps_auth.oauth_flow DROP CONSTRAINT IF EXISTS oauth_flow_purpose_check;
ALTER TABLE avesmaps_auth.oauth_flow
    ADD CONSTRAINT oauth_flow_purpose_check CHECK (purpose IN ('login', 'link', 'invitation', 'confirm', 'melder'));

-- 2. NEUE FUNKTIONEN -------------------------------------------------------------------------------------------------------------------------------

-- Verbinden: Der Rückweg von Discord hat die Kennung geprüft (Discord bestätigt sie, der Zugangsschlüssel ist verworfen); hier wird sie an den Melder des Vorgangs gesetzt. Kein Vorgang zu diesem
-- Schlüssel (nie gewesen, abgelaufen, im Papierkorb) → KC404 ohne Hinweis, ob es ihn gab. Gibt die COM-Nummer zurück.
CREATE OR REPLACE FUNCTION avesmaps_community.community_discord_verbinden(p_hash BYTEA, p_discord_id TEXT, p_name TEXT) RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_name TEXT := btrim(COALESCE(p_name, ''));
BEGIN
    IF p_discord_id IS NULL OR p_discord_id !~ '^[0-9]{17,20}$' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Discord-Kennung hat die falsche Form');
    END IF;
    IF char_length(v_name) NOT BETWEEN 1 AND 80 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Anzeigename braucht 1 bis 80 Zeichen');
    END IF;
    v_id := avesmaps_community._zum_schluessel(p_hash);
    PERFORM avesmaps_community._sperre(v_id);
    UPDATE avesmaps_community.melder SET discord_id = p_discord_id, discord_name = v_name
     WHERE vorgang_id = v_id AND entfernt_at IS NULL;
    IF NOT FOUND THEN
        PERFORM avesmaps_community._fehler('KC404', 'community_not_found: kein Vorgang zu diesem Schlüssel');
    END IF;
    RETURN avesmaps_community._com(v_id);
END;
$$;

-- Lösen: aus ALLEN Vorgängen, die dieselbe Kennung tragen wie der Vorgang des Schlüssels (Fachkonzept §8.4). Ohne Verbindung ist es nichts (0). Liefert die Zahl der Vorgänge.
CREATE OR REPLACE FUNCTION avesmaps_community.community_discord_loesen(p_hash BYTEA) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_kennung TEXT;
    v_n INTEGER;
BEGIN
    v_id := avesmaps_community._zum_schluessel(p_hash);
    SELECT discord_id INTO v_kennung FROM avesmaps_community.melder WHERE vorgang_id = v_id;
    IF v_kennung IS NULL THEN
        RETURN 0;
    END IF;
    UPDATE avesmaps_community.melder SET discord_id = NULL, discord_name = NULL WHERE discord_id = v_kennung;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

-- Offen: die Vorgänge dieser Kennung, die noch nicht abgeschlossen sind und nicht im Papierkorb liegen; neueste zuerst, höchstens 20 (`COMMUNITY_DISCORD_ZEILEN_MAX`). Nur Nummer, Zustand, Kategorie und Bezugsname:
-- 🔴 nie Text, Name, Adresse oder die Kennung (Fachkonzept §8.3a). Der Bezugsname ist der Name des Kartenobjekts, nie eine Angabe des Melders über sich.
CREATE OR REPLACE FUNCTION avesmaps_community.community_discord_offen(p_discord_id TEXT)
    RETURNS TABLE (nummer TEXT, zustand TEXT, kategorie TEXT, bezug_name TEXT)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT avesmaps_community._com(v.id), v.zustand, v.kategorie,
           (SELECT COALESCE(b.name, b.naechster_ort) FROM avesmaps_community.bezug b WHERE b.vorgang_id = v.id ORDER BY b.id LIMIT 1)
      FROM avesmaps_community.melder m
      JOIN avesmaps_community.vorgang v ON v.id = m.vorgang_id
     WHERE m.discord_id = p_discord_id AND m.entfernt_at IS NULL AND v.zustand <> 'abgeschlossen' AND v.papierkorb_at IS NULL
     ORDER BY v.eingegangen_at DESC, v.id DESC
     LIMIT 20;
$$;

-- Zurückziehen aus Discord: wie `community_status_zurueckziehen` (0265), nur dass die Kennung statt des Statusschlüssels den Vorgang bestimmt. Ein Vorgang einer ANDEREN Kennung, ein unbekannter und einer im Papierkorb
-- sind alle `nicht_gefunden`; ein abgeschlossener `schon_abgeschlossen`. Dieselbe Kennung der Handlung noch einmal ist nichts (`zurueckgezogen`).
CREATE OR REPLACE FUNCTION avesmaps_community.community_discord_zurueckziehen(p_operation UUID, p_discord_id TEXT, p_id BIGINT) RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.vorgang;
BEGIN
    SELECT g.* INTO v
      FROM avesmaps_community.vorgang g
      JOIN avesmaps_community.melder m ON m.vorgang_id = g.id
     WHERE g.id = p_id AND m.discord_id = p_discord_id AND m.entfernt_at IS NULL AND g.papierkorb_at IS NULL
       FOR UPDATE OF g;
    IF NOT FOUND THEN
        RETURN 'nicht_gefunden';
    END IF;
    IF avesmaps_community._schon(p_operation) THEN
        RETURN 'zurueckgezogen';
    END IF;
    IF v.zustand = 'abgeschlossen' THEN
        RETURN 'schon_abgeschlossen';
    END IF;
    UPDATE avesmaps_community.vorgang
       SET zustand = 'abgeschlossen', ergebnis = 'zurueckgezogen', abgeschlossen_at = now(), rueckfrage_at = NULL
     WHERE id = v.id;
    PERFORM avesmaps_community._ereignis(v.id, 'zurueckgezogen', NULL, true, v.zustand, 'zurueckgezogen', NULL, p_operation);
    RETURN 'zurueckgezogen';
END;
$$;

-- 3. ERWEITERTE FUNKTIONEN ----------------------------------------------------------------------------------------------------------------

-- Von der geltenden Fassung (0265) abgeschrieben; neu ist allein der Schlüssel 'discordName' (der Anzeigename zur Verbindung, nie die Kennung; NULL ohne Verbindung).
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
        'discordName', (SELECT mm.discord_name FROM avesmaps_community.melder mm WHERE mm.vorgang_id = v.id AND mm.discord_id IS NOT NULL),
        'nachrichten', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('richtung', n.richtung, 'text', n.text, 'at', n.at) ORDER BY n.at, n.id)
              FROM avesmaps_community.nachricht n
             WHERE n.vorgang_id = v.id
        ), '[]'::jsonb)
    );
END;
$$;

-- Von der geltenden Fassung (0281) abgeschrieben; neu ist allein `discord_name = NULL` in der UPDATE-Anweisung der Kontaktdaten.
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
           SET name = NULL, mail = NULL, discord_id = NULL, discord_name = NULL, person_id = NULL, schluessel_hash = NULL, entfernt_at = now()
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

-- Von der geltenden Fassung (0281) abgeschrieben; neu ist allein `discord_name = NULL` in der UPDATE-Anweisung der Melderdaten.
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
       SET name = NULL, mail = NULL, discord_id = NULL, discord_name = NULL, person_id = NULL, schluessel_hash = NULL, entfernt_at = now()
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
