-- 0337: „Gefällt mir“ an Reisebildern (WI-0304), nach dem Vorbild der Bewertungen (0266, WI-0269 C10).
--
-- Eine neue Tafel und eine Funktion, beides nur Erweiterung (AGENTS.md „erst erweitern“): das vorige Release kennt weder die Tafel noch die Funktion und liest und
-- schreibt sie nie. Die öffentliche Antwort der Reisebilder trägt die Zahl als neues optionales Feld.
--
-- Warum eine eigene Tafel statt einer Spalte an `media_submission` oder `photobox_media`: Beide tragen den Auslöser `revision_bump` (ADR-0020). Jeder Handgriff eines
-- Besuchers hübe die Fachrevision der Einreichung und machte der Redaktion die `baseRevision` unter den Händen ungültig. Die Tafel hat keine Revision; die Zahl
-- zählt nirgends mit.
--
-- Die Zahl ist anonym: keine Liste, wer es war, keine Adresse, kein Zeitpunkt. „Einmal je Browser“ hält der Browser (`localStorage`), die Drossel je Adresse lebt nur im Speicher.

CREATE TABLE IF NOT EXISTS photobox_gefaellt (
    media_submission_id BIGINT PRIMARY KEY REFERENCES media_submission (id) ON DELETE CASCADE,
    gefaellt INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT photobox_gefaellt_zaehler CHECK (gefaellt >= 0)
);

COMMENT ON TABLE photobox_gefaellt IS
    'Anonyme Zahl „Gefällt mir“ je freigegebenem Reisebild (WI-0304). Geschrieben wird nur über public.photobox_gefaellt(uuid, integer); die App liest. Keine Liste, wer es war. Ohne Revision, damit ein Handgriff der Besucher die Redaktion nicht stört.';
COMMENT ON COLUMN photobox_gefaellt.media_submission_id IS 'Die Einreichung des Reisebildes. Fällt mit ihr (Aufbewahrung).';
COMMENT ON COLUMN photobox_gefaellt.gefaellt IS 'Anonyme Zahl „Gefällt mir“, nie unter 0. „Einmal je Browser“ hält der Browser.';

-- „Gefällt mir“ setzen (+1) oder zurücknehmen (-1): nur die Zahl, die Antwort ist der neue Stand. `p_id` ist die Kennung des Reisebildes auf der Karte (`media_asset.public_id`).
-- Nur an einem freigegebenen, noch nicht offline genommenen Reisebild (Einreichung `approved`, aktive Verwendung in `photobox_media`); sonst `photobox_unbekannt`
-- (SQLSTATE KC404, der Server übersetzt ihn in 404). Ob der Schalter der Rolle oder ein Notaus das Bild gerade verbirgt, entscheidet die Karte; die Zahl verrät nichts.
CREATE OR REPLACE FUNCTION public.photobox_gefaellt(p_id UUID, p_delta INTEGER) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
DECLARE
    v_einreichung BIGINT;
    v_zahl INTEGER;
BEGIN
    IF p_delta IS NULL OR p_delta NOT IN (-1, 1) THEN
        RAISE EXCEPTION 'photobox_ungueltig: Gefällt mir zählt um eins hoch oder runter' USING ERRCODE = 'KC422';
    END IF;
    SELECT s.id INTO v_einreichung
      FROM public.media_asset a
      JOIN public.photobox_media m ON m.media_asset_id = a.id AND m.retired_at IS NULL
      JOIN public.media_submission s ON s.id = m.media_submission_id AND s.state = 'approved'
     WHERE a.public_id = p_id;
    IF v_einreichung IS NULL THEN
        RAISE EXCEPTION 'photobox_unbekannt: dieses Reisebild gibt es nicht' USING ERRCODE = 'KC404';
    END IF;
    INSERT INTO public.photobox_gefaellt AS g (media_submission_id, gefaellt)
    VALUES (v_einreichung, greatest(0, p_delta))
    ON CONFLICT (media_submission_id) DO UPDATE SET gefaellt = greatest(0, g.gefaellt + p_delta)
    RETURNING g.gefaellt INTO v_zahl;
    RETURN v_zahl;
END;
$$;

REVOKE ALL ON FUNCTION public.photobox_gefaellt(UUID, INTEGER) FROM PUBLIC;

COMMENT ON FUNCTION public.photobox_gefaellt(UUID, INTEGER) IS
    '„Gefällt mir“ an einem freigegebenen Reisebild setzen (+1) oder zurücknehmen (-1), nie unter 0 (WI-0304). Nur die Zahl; wer es war, wird nie gespeichert. KC404 photobox_unbekannt, wenn es das Bild nicht (mehr) gibt. SECURITY DEFINER.';
