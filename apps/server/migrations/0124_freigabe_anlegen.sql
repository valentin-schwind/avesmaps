-- 0124: Eine Production-Freigabe legt die App über eine Funktion an, nicht per INSERT (Claudios Befund vom 2026-10-14,
-- `2026-10-14-freigabe-knopf-permission-an-claudia.md`).
--
-- 🔴 **Der Fehler, den das behebt:** `routes/freigabe.ts` schrieb `INSERT INTO avesmaps_kanal.vorgang` als App-Rolle.
--    `kanal-grants.psql` gibt der App auf allen Kanal-Tafeln aber nur SELECT; geschrieben wird ausschließlich über die
--    `kanal_*`-Funktionen (0106, KANAL-0001 §4). Der Knopf „Alles nach Production“ konnte deshalb nie funktionieren — er
--    endete mit `permission denied for table vorgang`. Kein `GRANT INSERT` als Abkürzung: Die Regel ist richtig, der
--    Schreibweg war falsch.
--
-- 🔴 REIN ADDITIV: eine neue Funktion, sonst nichts. Das vorige Release ruft sie nie.

-- Die Freigabe als Vorgang im Betreiber-Kanal. Wie `kanal_melden` (0106): Die App hat die Person angemeldet und ihr Recht
-- geprüft (`release_to_production` mit frischem Passkey), die Datenbank prüft die Übergänge.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_freigabe_anlegen(
    p_operation UUID, p_environment TEXT, p_person UUID, p_art TEXT, p_titel TEXT, p_nachricht TEXT
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_titel TEXT;
BEGIN
    -- Derselbe Druck zweimal (Netz, Doppelklick) gibt denselben Vorgang zurück, wie bei jeder Operation.
    SELECT id INTO v_id FROM avesmaps_kanal.vorgang WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN v_id;
    END IF;
    IF p_art NOT IN ('release', 'rollback') THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: eine Freigabe ist „release“ oder „rollback“');
    END IF;
    IF p_person IS NULL THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: eine Freigabe braucht die Person, die sie gedrückt hat');
    END IF;
    -- 🔴 Eine nach der anderen. Die Route prüft das schon gegen die Statusdatei; hier prüft die Datenbank gegen die
    --    Wirklichkeit, und das hält auch, wenn zwei Drücke gleichzeitig ankommen.
    IF EXISTS (
        SELECT 1 FROM avesmaps_kanal.vorgang
         WHERE art = 'freigabe' AND environment = p_environment AND status NOT IN ('abgenommen', 'abgelehnt')
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
    INSERT INTO avesmaps_kanal.vorgang (
        environment, art, kategorie, prioritaet, status, zustaendig, titel, nachricht, gemeldet_von, operation_id
    ) VALUES (
        p_environment, 'freigabe', 'umbau', 'hoch', 'neu', 'claudio', v_titel,
        nullif(btrim(regexp_replace(coalesce(p_nachricht, ''), '[[:cntrl:]|]', '', 'g')), ''),
        p_person, p_operation
    ) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION avesmaps_kanal.kanal_freigabe_anlegen(UUID, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
