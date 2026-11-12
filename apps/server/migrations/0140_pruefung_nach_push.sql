-- Der Prüflauf nach dem Push meldet sich in der Glocke (WI-0201; Betreiber 2026-10-16, Review-Frage 2, wörtlich: „nein die
-- prüfung geschieht auf dem server, aber sie muss stattfinden und als ergebnis an die glocke gehen“).
--
-- Claudios Lauf auf dem VPS prüft jeden neuen master-Stand und reiht sein Ergebnis wie `stage_neu` über die Warteschlange ein
-- (Entscheidung 2026-10-15: Meldungen kommen über die Warteschlange in die richtige Umgebung). Die Tür dafür,
-- `benachrichtigung_einreihen` (0133), nimmt bisher nur die neuen Stände an. Hier lernt sie die zwei Arten des Prüflaufs,
-- `pruefung_rot` und `pruefung_gruen` (Katalog `BENACHRICHTIGUNG_ARTEN`), jede mit eigener Bezeichnung des Auftrags.
--
-- 🔴 REIN ERWEITERND: `CREATE OR REPLACE` mit derselben Signatur und derselben Rückgabe; was 0133 annahm, nimmt sie weiter an, mit
-- derselben Bezeichnung. Das vorige Release ruft die Funktion nie mit den neuen Arten; reiht Claudio sie ein, während noch das
-- vorige Release läuft, scheitert der Auftrag dort an der Eingabeprüfung der Jobart (`input_invalid`, nicht wiederholbar), und
-- niemand bekommt etwas. `CREATE OR REPLACE` behält Eigentümer und Rechte: EXECUTE weiter nur die Jobs-Rolle
-- (`apps/server/src/db/jobs-grants.psql`), kein neuer Lauf von `db-grants` nötig.
--
-- Von der GELTENDEN Fassung (0133) abgeschrieben; anders sind nur die Artenliste, die Bezeichnung und der Kommentar.

CREATE OR REPLACE FUNCTION benachrichtigung_einreihen(p_art TEXT, p_an JSONB, p_text TEXT, p_quelle TEXT)
    RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    c_uuid CONSTANT TEXT := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    v_text TEXT := btrim(p_text);
    v_ziele INTEGER;
    v_id BIGINT;
    v_neu BOOLEAN;
BEGIN
    IF p_art IS NULL OR p_art NOT IN ('stage_neu', 'production_neu', 'pruefung_rot', 'pruefung_gruen') THEN
        RAISE EXCEPTION 'benachrichtigung_einreihen: % ist keine Art, die über die Warteschlange kommt', COALESCE(p_art, '(leer)')
            USING ERRCODE = '22023';
    END IF;
    -- Das Ziel: genau eines von person, rolle, alle; dazu höchstens ausser; kein anderer Schlüssel.
    IF p_an IS NULL OR jsonb_typeof(p_an) <> 'object' THEN
        RAISE EXCEPTION 'benachrichtigung_einreihen: an braucht genau eines von "person", "rolle" oder "alle"' USING ERRCODE = '22023';
    END IF;
    v_ziele := (p_an ? 'person')::int + (p_an ? 'rolle')::int + (p_an ? 'alle')::int;
    IF v_ziele <> 1
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_an) k WHERE k NOT IN ('person', 'rolle', 'alle', 'ausser'))
       OR (p_an ? 'person' AND NOT COALESCE(jsonb_typeof(p_an -> 'person') = 'string' AND p_an ->> 'person' ~ c_uuid, false))
       OR (p_an ? 'rolle' AND NOT COALESCE(jsonb_typeof(p_an -> 'rolle') = 'string' AND p_an ->> 'rolle' ~ '^[a-z_]{1,40}$', false))
       OR (p_an ? 'alle' AND p_an -> 'alle' <> 'true'::jsonb)
       OR (p_an ? 'ausser' AND NOT COALESCE(jsonb_typeof(p_an -> 'ausser') = 'string' AND p_an ->> 'ausser' ~ c_uuid, false)) THEN
        RAISE EXCEPTION 'benachrichtigung_einreihen: an braucht genau eines von "person", "rolle" oder "alle" (dazu höchstens "ausser")'
            USING ERRCODE = '22023';
    END IF;
    IF v_text IS NULL OR char_length(v_text) NOT BETWEEN 1 AND 300 THEN
        RAISE EXCEPTION 'benachrichtigung_einreihen: Text braucht 1 bis 300 Zeichen' USING ERRCODE = '22023';
    END IF;
    IF p_quelle IS NULL OR p_quelle !~ '^[a-z][a-z0-9_-]{0,39}:\S{1,159}$' THEN
        RAISE EXCEPTION 'benachrichtigung_einreihen: Quelle % hat nicht die Form art:kennung', COALESCE(p_quelle, '(leer)')
            USING ERRCODE = '22023';
    END IF;
    SELECT i.id, i.created INTO v_id, v_neu
      FROM job_insert(
          'benachrichtigung', 1::smallint, 'aventuria', 'queued', 'korridor', 'benachrichtigung:' || p_quelle,
          CASE p_art
              WHEN 'stage_neu' THEN 'Meldung: Neu auf der Stage'
              WHEN 'production_neu' THEN 'Meldung: Neu auf avesmaps.de'
              WHEN 'pruefung_rot' THEN 'Meldung: Prüflauf nach dem Push rot'
              ELSE 'Meldung: Prüflauf nach dem Push wieder grün'
          END,
          jsonb_build_object('art', p_art, 'an', p_an, 'text', v_text, 'quelle', p_quelle),
          50::smallint, NULL, 'tiles', '{}'::smallint[], '{}'::bigint[]
      ) i;
    RETURN CASE WHEN v_neu THEN v_id ELSE NULL END;
END;
$$;

COMMENT ON FUNCTION benachrichtigung_einreihen(TEXT, JSONB, TEXT, TEXT) IS
    'Gemeinsame Warteschlange (WI-0163, Betreiber 2026-10-15; WI-0201): reiht eine Meldung der neuen Staende (stage_neu, production_neu) oder des Prueflaufs nach dem Push (pruefung_rot, pruefung_gruen) als Auftrag der Art benachrichtigung ein; einmal je Quelle, solange aktiv (NULL: schon eingereiht). Nur fuer die Jobs-Rolle.';

-- Wiederholt aus 0133, damit die Migration für sich allein stimmt; `CREATE OR REPLACE` hat die Rechte ohnehin behalten.
REVOKE ALL ON FUNCTION benachrichtigung_einreihen(TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
