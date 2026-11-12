-- 0127: Der Betreiber schließt einen Vorgang selbst ab — „erledigt“ oder „abgebrochen“ (WI-0145).
--
-- Betreiber 2026-10-14: „die betreiber sollten die möglichkeit bekommen vorgänge abzubrechen und zu löschen und
-- erledigt markieren - kann ja sein, dass sich das problem anderweitig erledigt hat“.
--
-- 🔴 **Die Lücke, die das schließt:** `kanal_abnehmen` (0106) geht nur aus `zur_abnahme`, und `zur_abnahme` setzt nur ein
--    Agent. Ein Vorgang, der bloß eine Frage war oder sich anderweitig erledigt hat, kam ohne Agenten nie weg; aus
--    `bei_claudia` führt überhaupt nur ein Weg zurück, und den darf nur Claudia gehen. Der Betreiber hatte damit für seine
--    eigenen Vorgänge kein „erledigt“.
--
-- Der Endzustand bleibt `abgenommen` — Archiv, Aufbewahrung (`kanal_purge_expired`), Zähler, Reiter und die laufende
-- Production-Freigabe (`routes/freigabe.ts`: `status NOT IN ('abgenommen', 'abgelehnt')`) lesen ihn alle. Ein neuer Status
-- hätte jeden dieser Filter angefasst. Woran der Vorgang endete, steht stattdessen in der neuen Spalte `abschluss`.
--
-- 🔴 REIN ADDITIV: eine neue Spalte (nullable, alter Code schreibt sie nie), eine neue Funktion, und `kanal_abnehmen`
--    setzt die Spalte mit. Signaturen bleiben, das vorige Release läuft unverändert weiter.

ALTER TABLE avesmaps_kanal.vorgang ADD COLUMN IF NOT EXISTS abschluss TEXT;
ALTER TABLE avesmaps_kanal.vorgang DROP CONSTRAINT IF EXISTS vorgang_abschluss;
ALTER TABLE avesmaps_kanal.vorgang ADD CONSTRAINT vorgang_abschluss
    CHECK (abschluss IS NULL OR abschluss IN ('abnahme', 'erledigt', 'abgebrochen'));
COMMENT ON COLUMN avesmaps_kanal.vorgang.abschluss IS
    'Woran der Vorgang endete: abnahme (Weg der Agenten über zur_abnahme), erledigt oder abgebrochen (Betreiber selbst, 0127). NULL = offen.';

-- Was vor 0127 abgenommen wurde, war immer der Weg über zur_abnahme.
UPDATE avesmaps_kanal.vorgang SET abschluss = 'abnahme' WHERE status = 'abgenommen' AND abschluss IS NULL;

-- Die Abnahme am Ende des Agentenwegs: unverändert, nur mit dem Vermerk.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_abnehmen(p_operation UUID, p_vorgang BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_kanal.vorgang;
BEGIN
    IF avesmaps_kanal._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
    END IF;
    v := avesmaps_kanal._sperre(p_vorgang);
    IF v.revision <> p_revision THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_conflict: der Vorgang hat sich inzwischen geändert');
    END IF;
    IF v.status <> 'zur_abnahme' THEN
        PERFORM avesmaps_kanal._fehler('KA409', format('kanal_transition: abnehmen geht nur aus „zur Abnahme“, nicht aus %s', v.status));
    END IF;
    UPDATE avesmaps_kanal.vorgang SET status = 'abgenommen', abschluss = 'abnahme', abgenommen_von = p_person,
        abgenommen_at = now(), lease_agent = NULL, lease_bis = NULL WHERE id = p_vorgang;
    INSERT INTO avesmaps_kanal.nachweis (vorgang_id, runde, station, von_person, operation_id)
    VALUES (p_vorgang, v.runde, 'betreiber_abnahme', p_person, gen_random_uuid());
    PERFORM avesmaps_kanal._eintrag(p_vorgang, 'status', p_person, NULL, NULL, 'zur_abnahme', 'abgenommen', NULL, p_operation);
    RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
END;
$$;

-- Der kurze Weg des Betreibers: aus jedem offenen Status, ohne Agenten, ohne Kurztitel.
--   `erledigt`    — das Anliegen ist weg, egal wie. Braucht keine Begründung.
--   `abgebrochen` — wird nicht weiter verfolgt. Braucht eine Begründung, denn der Melder sieht den Vorgang.
-- Beides landet in `abgenommen`, mit Nachweis `betreiber_abnahme` und einem Statuseintrag im Verlauf. Eine laufende
-- Abholung (Lease) wird dabei freigegeben; was ein Agent danach noch schreiben will, läuft gegen „der Vorgang ist
-- abgenommen“ (`kanal_eintragen`, `kanal_status`) — gewollt, der Betreiber hat das letzte Wort.
CREATE OR REPLACE FUNCTION avesmaps_kanal.kanal_abschliessen(
    p_operation UUID, p_vorgang BIGINT, p_person UUID, p_revision INTEGER, p_art TEXT, p_text TEXT DEFAULT NULL
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_kanal.vorgang;
BEGIN
    IF avesmaps_kanal._schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
    END IF;
    IF p_art NOT IN ('erledigt', 'abgebrochen') THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: erledigt oder abgebrochen');
    END IF;
    IF p_art = 'abgebrochen' AND (p_text IS NULL OR btrim(p_text) = '') THEN
        PERFORM avesmaps_kanal._fehler('KA422', 'kanal_invalid: abbrechen braucht eine Begründung');
    END IF;
    v := avesmaps_kanal._sperre(p_vorgang);
    IF v.revision <> p_revision THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_conflict: der Vorgang hat sich inzwischen geändert');
    END IF;
    IF v.status = 'abgenommen' THEN
        PERFORM avesmaps_kanal._fehler('KA409', 'kanal_transition: der Vorgang ist schon abgeschlossen');
    END IF;
    UPDATE avesmaps_kanal.vorgang SET status = 'abgenommen', abschluss = p_art, abgenommen_von = p_person,
        abgenommen_at = now(), lease_agent = NULL, lease_bis = NULL WHERE id = p_vorgang;
    INSERT INTO avesmaps_kanal.nachweis (vorgang_id, runde, station, von_person, operation_id)
    VALUES (p_vorgang, v.runde, 'betreiber_abnahme', p_person, gen_random_uuid());
    PERFORM avesmaps_kanal._eintrag(p_vorgang, 'status', p_person, NULL, p_text, v.status, 'abgenommen', NULL, p_operation);
    RETURN (SELECT revision FROM avesmaps_kanal.vorgang WHERE id = p_vorgang);
END;
$$;
