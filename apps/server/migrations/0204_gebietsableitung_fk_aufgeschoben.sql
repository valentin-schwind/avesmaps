-- Die Ableitung der Herrschaftsgebiete hält das Speichern nicht mehr auf (WI-0229; Befund auf der Stage 2026-10-19, Claudio
-- `2026-10-19-gebiet-speichern-503-waehrend-ableitung-an-claudia.md` und die Hauptorchestrierung: „Kein Speichern im Editor darf hinter einer
-- Ableitung warten“).
--
-- Die Ableitung schreibt die vier abgeleiteten Tafeln in EINER Transaktion von bis zu 90 s. Jede eingefügte Zeile prüfte ihren Fremdschlüssel
-- sofort und nahm dafür `FOR KEY SHARE` auf die Zeile in `territory` bzw. `territory_area`, bis zum Commit, am Ende also auf praktisch jedes
-- Gebiet. Ein Schreibweg, der seine Gebietszeile mit `FOR UPDATE` sperrt, wartete darauf, nach `lock_timeout` (2 s) kam 503.
--
-- Hier werden diese Fremdschlüssel aufschiebbar (`DEFERRABLE INITIALLY IMMEDIATE`). Für jeden anderen Schreiber ändert sich nichts: Sie
-- prüfen weiter sofort. Nur die Ableitung schiebt die Prüfung mit `SET CONSTRAINTS ALL DEFERRED` an ihr Ende (`derive.ts`); ihre Sperren
-- auf die Gebietszeilen halten dann nur noch die Prüfung beim Commit lang. Die Löschregeln (`ON DELETE CASCADE`) bleiben sofort wirksam,
-- wie PostgreSQL es für Aktionen außer `NO ACTION` immer tut.
--
-- 🔴 REIN ADDITIV im Verhalten: keine Spalte, kein Recht, keine Daten; eine ältere Fassung ohne `SET CONSTRAINTS` prüft genau wie vorher.
-- Idempotent: Nur Fremdschlüssel, die noch nicht aufschiebbar sind, werden geändert.

DO $$
DECLARE
    fk RECORD;
BEGIN
    FOR fk IN
        SELECT c.conrelid::regclass AS tafel, c.conname AS name
          FROM pg_constraint c
         WHERE c.contype = 'f'
           AND NOT c.condeferrable
           AND c.conrelid IN (
               'public.territory_display_area'::regclass,
               'public.territory_shape'::regclass,
               'public.territory_border'::regclass,
               'public.territory_claim_shape'::regclass
           )
           AND c.confrelid IN ('public.territory'::regclass, 'public.territory_area'::regclass)
    LOOP
        EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE', fk.tafel, fk.name);
    END LOOP;
END
$$;
