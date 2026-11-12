-- Notbremse der Routine im Social Hub (WI-0270): ein ganzer Lauf je Tag statt eines Beitrags je Tag. Vali 2026-10-31 auf „Wie viele
-- Routinevorschläge soll der Hub je Tag aufnehmen?“: „A: Alle aus dem Lauf“. Die Routine (`ops/news/neuigkeiten-routine.sh`) liefert
-- höchstens drei Einträge je Lauf; mit drei je Berliner Tag und Kanal steht jeder Vorschlag eines Laufs im Hub, und eine durchgehende Routine
-- flutet ihn trotzdem nicht. Der vierte am selben Tag bleibt wie bisher ein Entwurf allein in der Systemsteuerung.
--
-- 🔴 Nur der Körper der Funktion ändert sich, nicht ihre Signatur (Test `migration-compat`).

CREATE OR REPLACE FUNCTION avesmaps_community._routine_je_tag() RETURNS INTEGER
    LANGUAGE sql
    IMMUTABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT 3;
$$;

REVOKE ALL ON FUNCTION avesmaps_community._routine_je_tag() FROM PUBLIC;
