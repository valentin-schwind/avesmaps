-- 0335: Eine Kartenserie mit Beschriftung im Bild darf für alle sichtbar sein (Betreiber 2026-11-10: „Ich möchte, dass du unter dem
-- Reiter "Nur Karte" die Karte "Old" auch für Frontendnutzer freischaltest.“).
--
--   Besucher sehen so eine Serie nur unter „Nur Karte“, das keine Namen von uns zeichnet (`nurUnterNurKarte` in `@avesmaps3d/shared`);
--   in den anderen Ansichten stünde jeder Name doppelt. Die Prüfung aus 0167 (`labels_in_image` heißt nie `PUBLIC`, Betreiberregel
--   2026-09-21) fällt deshalb weg. Was stattdessen gilt, prüft der Schreibweg (`apps/server/src/map-series/schreiben.ts`): Vorgabe
--   wird so eine Serie nie, und für „mindestens eine bleibt für alle sichtbar“ zählt sie nicht.
--
-- 🔴 NUR GELOCKERT (AGENTS.md, „erst erweitern“): Keine Spalte, keine Zeile ändert sich, und was vorher erlaubt war, bleibt erlaubt. Das
-- vorige Release schreibt die Kombination nie (sein Schreibweg weist „Alle“ mit Beschriftung im Bild ab) und liest eine solche Zeile als
-- „nur für Editoren“ (`wirksamerKatalog` erzwang das): Im Fenster und nach einem Rückweg sehen Besucher sie also nicht, mehr nicht.
--
-- Die Prüfung hat keinen eigenen Namen (in 0167 ohne `CONSTRAINT …` angelegt); sie wird über ihre Definition gefunden.

DO $$
DECLARE
    pruefung TEXT;
BEGIN
    FOR pruefung IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'map_series'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%labels_in_image%'
           AND pg_get_constraintdef(oid) LIKE '%visibility%'
    LOOP
        EXECUTE format('ALTER TABLE map_series DROP CONSTRAINT %I', pruefung);
    END LOOP;
END
$$;
