-- 0159: Herkunft des Obergebiets eines Herrschaftsgebiets (WI-0209 D1; EDIT-0003 F24, Ausnahme der Orchestrierung 2026-10-18).
--
--   `territory.parent_origin`: woher der Elter (`parent_id`) kommt. NULL heißt aus dem Gebietsimport (Legacy, dort aus dem Wiki);
--   'override' heißt im Editor umgehängt. Das Fenster zeigt dann am Feld „Obergebiet“ das „✎ Eigener Wert“ wie an den Detailfeldern
--   (`territory_detail_field_origin`, 0076). Die Detailtafel taugt dafür nicht: Ihre Herkunft gilt nur den 17 Detailfeldern und hängt an
--   einer Detailzeile, die ein Gebiet ohne Daten nicht hat.
--   Schreibt der Gebietsimport den Elter neu, setzt er die Herkunft zurück (`migration/territory-import.ts`). „Obergebiet halten“ und ↺
--   mit dem Wiki-Wert kommen mit G6 und WikiSync, nicht hier.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine Spalte ohne Vorgabe (nur ein Katalogeintrag), alle Zeilen NULL. Das vorige Release liest
-- und schreibt sie nie. Die Revision zählt sie nicht eigens: Sie ändert sich nur zusammen mit `parent_id`, und das zählt der Trigger
-- `territory_revision` (0145) schon. Die App-Rolle hat an `territory` UPDATE auf der ganzen Tafel (`apps/server/src/db/map-grants.psql`:
-- nur DELETE und TRUNCATE sind entzogen).

ALTER TABLE territory ADD COLUMN IF NOT EXISTS parent_origin TEXT;

DO $$
BEGIN
    ALTER TABLE territory
        ADD CONSTRAINT territory_parent_origin_known CHECK (parent_origin IS NULL OR parent_origin = 'override');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

COMMENT ON COLUMN territory.parent_origin IS
    'Herkunft des Obergebiets (WI-0209 D1): NULL aus dem Gebietsimport, override im Editor umgehaengt (territory.update). Der Gebietsimport setzt sie zurueck, wenn er parent_id schreibt.';
