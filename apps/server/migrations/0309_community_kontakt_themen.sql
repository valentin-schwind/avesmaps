-- Die Themen des Kontaktformulars (WI-0268, Betreiber 2026-11-04): Frage, Hinweis, Mitmachen, Lob und Kritik, Allgemein, Problem.
-- Nur erweitert: `rechte`, `datenschutz` und `sonstiges` bleiben gültig (Bestand, altes Fenster im Browser), das vorige Release läuft unverändert weiter.
-- Wiederholbar: Der CHECK wird gelockert, die Funktion behält ihre Signatur und damit ihre Rechte.

ALTER TABLE avesmaps_community.vorgang DROP CONSTRAINT IF EXISTS vorgang_kategorie;
ALTER TABLE avesmaps_community.vorgang ADD CONSTRAINT vorgang_kategorie CHECK (
    (art = 'meldung' AND kategorie IN ('lage', 'name', 'angabe', 'fehlt', 'entfaellt', 'sonstiges', 'bewertung'))
    OR (art = 'anfrage' AND kategorie IN ('frage', 'hinweis', 'mitmachen', 'lob', 'allgemein', 'problem', 'rechte', 'datenschutz', 'sonstiges'))
);

CREATE OR REPLACE FUNCTION avesmaps_community.community_anfragen(
    p_operation UUID, p_kategorie TEXT, p_text TEXT, p_name TEXT, p_mail TEXT, p_schluessel_hash BYTEA
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_name TEXT := NULLIF(btrim(p_name), '');
    v_mail TEXT := NULLIF(btrim(p_mail), '');
BEGIN
    SELECT id INTO v_id FROM avesmaps_community.vorgang WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF char_length(btrim(COALESCE(p_text, ''))) NOT BETWEEN 10 AND 2000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Nachricht braucht 10 bis 2000 Zeichen');
    END IF;
    IF p_schluessel_hash IS NULL THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Schlüssel ist Pflicht');
    END IF;
    IF p_kategorie IS NULL OR p_kategorie NOT IN ('frage', 'hinweis', 'mitmachen', 'lob', 'allgemein', 'problem', 'rechte', 'datenschutz', 'sonstiges') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: unbekannte Kategorie');
    END IF;
    IF v_name IS NOT NULL AND char_length(v_name) > 80 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Name darf höchstens 80 Zeichen lang sein');
    END IF;
    IF v_mail IS NOT NULL AND (char_length(v_mail) NOT BETWEEN 3 AND 254 OR v_mail !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Adresse stimmt nicht');
    END IF;
    INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, prioritaet, operation_id)
    VALUES ('anfrage', p_kategorie, 'kontakt', CASE WHEN p_kategorie IN ('rechte', 'datenschutz') THEN 'hoch' ELSE 'normal' END, p_operation)
    RETURNING id INTO v_id;
    INSERT INTO avesmaps_community.melder (vorgang_id, name, mail, schluessel_hash)
    VALUES (v_id, v_name, v_mail, p_schluessel_hash);
    INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, operation_id)
    VALUES (v_id, 'ein', 'formular', btrim(p_text), gen_random_uuid());
    PERFORM avesmaps_community._ereignis(v_id, 'eingang', NULL, true, NULL, 'neu', NULL, NULL);
    RETURN v_id;
END;
$$;
