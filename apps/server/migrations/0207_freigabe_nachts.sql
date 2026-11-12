-- „Für Production freigeben, nachts ausliefern“ (WI-0234; Betreiber 2026-10-19 in Claudios Sitzung, wörtlich zuerst „oder wir sagen
-- "Alles nach Production" ändert sich zu "Für Production freigegeben" und er prüft dann um 4:30“, dann „dann machen wir das "Für
-- Production freigeben, nachts ausliefern" ja“; Vertrag `2026-10-19-freigabe-nachts-ausliefern-vertrag-an-claudia.md`).
--
-- 1. `kanal_freigabe_anlegen` kennt die dritte Art `nacht`: ein Freigabe-Vorgang mit dem Titel „Für Production freigegeben: …“. Claudios
--    Nachtlauf prüft um 04:30 genau diesen Commit, sein Abholer liefert ihn im Nachtfenster aus, wenn das grün ist. Höchstens eine offene
--    Nacht-Freigabe: Jeder neue Druck (nacht, release, rollback) löst eine offene ab („Abgelöst durch …“). Eine offene Nacht-Freigabe
--    sperrt keinen neuen Druck, auch den Rückweg nicht; ein offener release oder rollback sperrt weiter alles, wie bisher.
-- 2. `kanal_freigabe_abbrechen`: Jeder aktive Betreiber darf eine offene Nacht-Freigabe abbrechen (die Route prüft das Recht), auch
--    während der Nachtlauf schon prüft; der Abholer sieht vor dem Ausliefern nach. Der Vorgang wird `abgelehnt`, der Verlauf nennt die
--    Person.
-- 3. `benachrichtigung_einreihen` nimmt `freigabe_erloschen` an: Claudios Nachtlauf und Abholer melden so, warum eine Freigabe erlosch.
--
-- 🔴 REIN ERWEITERND: beide bestehenden Funktionen mit derselben Signatur und Rückgabe; was sie annahmen, nehmen sie weiter an. Das
-- vorige Release ruft `nacht` nie. EXECUTE auf die neue Funktion vergibt `kanal-grants.psql` an die App-Rolle.

CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_freigabe_anlegen(
    p_operation UUID, p_environment TEXT, p_person UUID, p_art TEXT, p_titel TEXT, p_nachricht TEXT
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    c_nacht CONSTANT TEXT := 'Für Production freigegeben: %';
    v_id BIGINT;
    v_titel TEXT;
    v_alt avesmaps_kanal.vorgang;
BEGIN
    -- Derselbe Druck zweimal (Netz, Doppelklick) gibt denselben Vorgang zurück, wie bei jeder Operation.
    SELECT id INTO v_id FROM avesmaps_kanal.vorgang WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF p_art NOT IN ('release', 'rollback', 'nacht') THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: eine Freigabe ist „release“, „rollback“ oder „nacht“');
    END IF;
    IF p_person IS NULL THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: eine Freigabe braucht die Person, die sie gedrückt hat');
    END IF;
    -- 🔴 Eine nach der anderen. Die Route prüft das schon gegen die Statusdatei; hier prüft die Datenbank gegen die
    --    Wirklichkeit, und das hält auch, wenn zwei Drücke gleichzeitig ankommen. Eine Nacht-Freigabe zählt dabei nicht: Sie wird
    --    unten abgelöst.
    IF EXISTS (
        SELECT 1 FROM avesmaps_kanal.vorgang
         WHERE art = 'freigabe' AND environment = p_environment AND status NOT IN ('abgenommen', 'abgelehnt')
           AND coalesce(titel, '') NOT LIKE c_nacht
    ) THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: es läuft schon eine Freigabe');
    END IF;
    -- 🔴 Der Titel wandert auf den VPS und wird dort ZEILENWEISE gelesen, Felder mit `|`
    --    (`avesmaps3d-corridor-probe freigabe-auftraege`). Ein Zeilenumbruch oder ein `|` darin wäre dort eine zweite,
    --    erfundene Auftragszeile. Der Vertrag lässt beides nicht zu und die Route säubert; diese Zeile ist die dritte Lage
    --    und die einzige, die auch dann noch hält, wenn jemand einen neuen Schreibweg baut.
    v_titel := left(btrim(regexp_replace(coalesce(p_titel, ''), '[[:cntrl:]|]', '', 'g')), 200);
    IF v_titel = '' THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: eine Freigabe braucht einen Titel');
    END IF;
    -- Die Art steht im Titel; Claudios Probe liest sie dort. Eine Nacht-Freigabe, die anders hieße, wäre für den Abholer ein Release,
    -- das sofort hinausginge.
    IF (p_art = 'nacht') <> (v_titel LIKE c_nacht) THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: eine Nacht-Freigabe heißt „Für Production freigegeben: …“, nur sie');
    END IF;
    INSERT INTO avesmaps_kanal.vorgang (
        environment, art, kategorie, prioritaet, status, zustaendig, titel, nachricht, gemeldet_von, operation_id
    ) VALUES (
        p_environment, 'freigabe', 'umbau', 'hoch', 'neu', 'claudio', v_titel,
        nullif(btrim(regexp_replace(coalesce(p_nachricht, ''), '[[:cntrl:]|]', '', 'g')), ''),
        p_person, p_operation
    ) RETURNING id INTO v_id;
    -- Höchstens eine offene Nacht-Freigabe: Der neue Druck löst eine offene ab, damit nie zwei Stände nacheinander von selbst
    -- hinausgehen. Auch ein Rückweg löst sie ab: Nach einem Rückweg geht nichts von selbst wieder hinaus. Der Verlauf der alten nennt
    -- den neuen Vorgang.
    FOR v_alt IN
        SELECT * FROM avesmaps_kanal.vorgang
         WHERE art = 'freigabe' AND environment = p_environment AND status NOT IN ('abgenommen', 'abgelehnt')
           AND coalesce(titel, '') LIKE c_nacht AND id <> v_id
         ORDER BY id
           FOR UPDATE
    LOOP
        UPDATE avesmaps_kanal.vorgang SET status = 'abgelehnt', lease_agent = NULL, lease_bis = NULL WHERE id = v_alt.id;
        PERFORM avesmaps_kanal._eintrag(
            v_alt.id, 'status', p_person, NULL, format('Abgelöst durch OPS-%s', lpad(v_id::text, 6, '0')), v_alt.status, 'abgelehnt',
            NULL, gen_random_uuid()
        );
    END LOOP;
    RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION avesmaps_kanal.kanal_freigabe_anlegen(UUID, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_freigabe_abbrechen(
    p_operation UUID, p_environment TEXT, p_vorgang BIGINT, p_person UUID
) RETURNS BOOLEAN
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_kanal.vorgang;
BEGIN
    -- Derselbe Druck zweimal ist kein Fehler, sondern nichts.
    IF avesmaps_kanal._schon(p_operation) THEN
        RETURN false;
    END IF;
    IF p_person IS NULL THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: abbrechen braucht die Person');
    END IF;
    v := avesmaps_kanal._sperre(p_vorgang);
    IF v.art <> 'freigabe' OR v.environment <> p_environment OR coalesce(v.titel, '') NOT LIKE 'Für Production freigegeben: %' THEN
        PERFORM avesmaps_kanal._fehler('KA403', 'kanal_forbidden: abbrechen lässt sich nur eine Nacht-Freigabe dieser Umgebung');
    END IF;
    IF v.status IN ('abgenommen', 'abgelehnt') THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: die Freigabe ist schon erloschen');
    END IF;
    UPDATE avesmaps_kanal.vorgang SET status = 'abgelehnt', lease_agent = NULL, lease_bis = NULL WHERE id = p_vorgang;
    PERFORM avesmaps_kanal._eintrag(p_vorgang, 'status', p_person, NULL, 'Abgebrochen', v.status, 'abgelehnt', NULL, p_operation);
    RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION avesmaps_kanal.kanal_freigabe_abbrechen(UUID, TEXT, BIGINT, UUID) FROM PUBLIC;

COMMENT ON FUNCTION avesmaps_kanal.kanal_freigabe_abbrechen(UUID, TEXT, BIGINT, UUID) IS
    'WI-0234: eine offene Nacht-Freigabe nach Production abbrechen (jeder aktive Betreiber; die Route prueft das Recht). Status abgelehnt, Verlauf mit Person.';

-- Von der GELTENDEN Fassung (0140) abgeschrieben; anders sind nur die Artenliste, die Bezeichnung und der Kommentar.
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
    IF p_art IS NULL OR p_art NOT IN ('stage_neu', 'production_neu', 'pruefung_rot', 'pruefung_gruen', 'freigabe_erloschen') THEN
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
              WHEN 'freigabe_erloschen' THEN 'Meldung: Freigabe für Production erloschen'
              ELSE 'Meldung: Prüflauf nach dem Push wieder grün'
          END,
          jsonb_build_object('art', p_art, 'an', p_an, 'text', v_text, 'quelle', p_quelle),
          50::smallint, NULL, 'tiles', '{}'::smallint[], '{}'::bigint[]
      ) i;
    RETURN CASE WHEN v_neu THEN v_id ELSE NULL END;
END;
$$;

COMMENT ON FUNCTION benachrichtigung_einreihen(TEXT, JSONB, TEXT, TEXT) IS
    'Gemeinsame Warteschlange (WI-0163, Betreiber 2026-10-15; WI-0201; WI-0234): reiht eine Meldung der neuen Staende (stage_neu, production_neu), des Prueflaufs nach dem Push (pruefung_rot, pruefung_gruen) oder einer erloschenen Freigabe fuer Production (freigabe_erloschen) als Auftrag der Art benachrichtigung ein; einmal je Quelle, solange aktiv (NULL: schon eingereiht). Nur fuer die Jobs-Rolle.';

REVOKE ALL ON FUNCTION benachrichtigung_einreihen(TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
