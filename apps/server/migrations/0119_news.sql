-- 0119: Neuigkeiten (WI-0139; Betreiber 2026-10-13, wörtlich: „es wird auch zeit bei "Production" den "Neuigkeiten-Kanal" fürs
-- frontend freizuschalten. in legacy hatten wir dazu eine tägliche routine von claudia, die das nochmal zusammengefasst hat.
-- das war für "normale" nutzer erklärt, was gerade auf avesmaps.de passiert").
--
-- 🔴 REIN ADDITIV: eine neue Tabelle und eine neue Funktion. Das vorige Release kennt beide nicht und ändert sich nicht.
--
-- 🔴 Rubrik und Zustand stehen NICHT als CHECK auf `rubrik` in der Datenbank, sondern im Katalog
--    `packages/shared/src/news.ts` (`NEWS_RUBRIKEN`) — dieselbe Lehre wie bei den Jobarten und den Benachrichtigungsarten
--    (0118): Eine fünfte Rubrik wäre sonst ein `DROP CONSTRAINT` mitten im Blue/Green-Wechsel. Der **Zustand** bekommt
--    einen CHECK, denn er ist keine Liste, die wächst, sondern die Mechanik selbst (entwurf → sichtbar → versteckt).

CREATE TABLE IF NOT EXISTS public.news_entry (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Der Tag, auf den sich der Eintrag bezieht (Legacys `date`), nicht der Zeitpunkt des Schreibens.
    datum DATE NOT NULL,
    titel TEXT NOT NULL,
    text TEXT NOT NULL,
    -- Legacys `category`; ein unbekannter Name steht in der Anzeige ohne Marke da (siehe oben).
    rubrik TEXT NOT NULL,
    -- Legacys `sort_order` innerhalb eines Tages; die Routine zählt hoch, der Startbestand bringt seine Reihe mit.
    reihe INTEGER NOT NULL DEFAULT 0,
    zustand TEXT NOT NULL DEFAULT 'entwurf',
    -- Woher der Eintrag stammt: 'routine' (Claudios Lauf), 'legacy' (Startbestand) oder die Kennung der Person.
    herkunft TEXT NOT NULL,
    von_person UUID,
    -- Der Stand, aus dem die Routine geschrieben hat (Release oder Commit); von Hand angelegt NULL.
    quelle TEXT,
    erstellt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    freigegeben_at TIMESTAMPTZ,
    freigegeben_von UUID,
    CONSTRAINT news_zustand CHECK (zustand IN ('entwurf', 'sichtbar', 'versteckt')),
    CONSTRAINT news_titel CHECK (char_length(btrim(titel)) BETWEEN 1 AND 200),
    CONSTRAINT news_text CHECK (char_length(btrim(text)) BETWEEN 1 AND 4000),
    CONSTRAINT news_rubrik CHECK (char_length(btrim(rubrik)) BETWEEN 1 AND 40),
    CONSTRAINT news_herkunft CHECK (char_length(btrim(herkunft)) BETWEEN 1 AND 80),
    -- Freigegeben heißt: mit Zeitpunkt. Wer freigab, darf fehlen (der Startbestand hat keine Person).
    CONSTRAINT news_freigegeben CHECK ((zustand = 'entwurf') = (freigegeben_at IS NULL)),
    -- 🔴 Derselbe Stand legt nichts zweimal an: Ein zweiter Lauf der Routine zum selben `quelle` fällt still weg.
    CONSTRAINT news_quelle_einmal UNIQUE (quelle, titel)
);
CREATE INDEX IF NOT EXISTS news_sichtbar ON public.news_entry (zustand, datum DESC, reihe DESC, id DESC);
COMMENT ON TABLE public.news_entry IS
    'Neuigkeiten für Besucher (WI-0139); anlegen durch die Routine nur über news_add(), nie mit INSERT.';

-- Der schmale Schreibweg der Routine (WI-0139 §3). 🔴 Die Routine bekommt EXECUTE auf diese eine Funktion, nie INSERT auf
-- die Tabelle: Dann kann sie genau eine Sache — einen Entwurf anlegen. Kein Ändern, kein Löschen, kein Schreiben in
-- `zustand`, `freigegeben_at` oder in fremde Zeilen. „Nur anlegen" ist damit eine Eigenschaft des Rechts, keine
-- Verabredung im Prompt.
--
-- Gibt die Kennung des neuen Eintrags zurück, oder NULL, wenn es ihn zu dieser Quelle schon gibt.
CREATE OR REPLACE FUNCTION public.news_add(
    p_datum DATE, p_titel TEXT, p_text TEXT, p_rubrik TEXT, p_quelle TEXT
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_reihe INTEGER;
BEGIN
    IF p_quelle IS NULL OR btrim(p_quelle) = '' THEN
        RAISE EXCEPTION 'news_add: quelle ist Pflicht (der Stand, aus dem der Eintrag kommt)' USING ERRCODE = '22023';
    END IF;
    -- Die Reihe innerhalb des Tages: hinter das, was schon da ist.
    SELECT COALESCE(max(reihe) + 1, 0) INTO v_reihe FROM public.news_entry WHERE datum = p_datum;
    INSERT INTO public.news_entry (datum, titel, text, rubrik, reihe, zustand, herkunft, quelle)
    VALUES (p_datum, btrim(p_titel), btrim(p_text), btrim(p_rubrik), v_reihe, 'entwurf', 'routine', btrim(p_quelle))
    ON CONFLICT (quelle, titel) DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- 🔴 PUBLIC bekommt die Funktion nie. Welche Rolle sie ausführen darf, steht in `apps/server/src/db/news-grants.psql`:
--    allein die News-Rolle, mit der Claudios Routine schreibt. Die App-Rolle braucht sie nicht — sie legt von Hand
--    angelegte Einträge direkt mit INSERT an (sie darf ohnehin mehr, weil ein Mensch dahintersteht).
REVOKE EXECUTE ON FUNCTION public.news_add(DATE, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
