-- Der Probestempel `region_area.is_trial` entfällt (WI-0048 Stufe 2, Betreiber 2026-09-27: „Können wir
-- das Feld nicht abschaffen, wenn es keine Bedeutung hat?“).
--
-- Legacy hat die Erprobung am 2026-08-01 abgeschafft (avesmaps@559320a, promote_trial keep, 133 Flächen).
-- Seitdem steht der Stempel dort überall auf 0, und kein Routing-Leser fragt ihn mehr ab. Seit Stufe 1
-- liest und schreibt auch hier kein Code die Spalte. Stage lief mit Stufe 1 (`097042e`), bevor diese
-- Migration kam; der Rückweg auf das vorige Release fragt die Spalte also nicht mehr ab.
--
-- 🔴 Wächter: Trägt doch eine Fläche den Stempel, bricht die Migration ab, statt ihn still zu verwerfen.
-- Die Abfrage läuft über EXECUTE, weil ein zweiter Lauf die Spalte nicht mehr findet und PL/pgSQL einen
-- festen Verweis schon beim Planen ablehnte.
DO $$
DECLARE
    stamped BIGINT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'region_area' AND column_name = 'is_trial'
    ) THEN
        EXECUTE 'SELECT count(*) FROM region_area WHERE is_trial' INTO stamped;
        IF stamped > 0 THEN
            RAISE EXCEPTION 'region_area.is_trial: % Flaeche(n) tragen den Probestempel; erst klaeren (WI-0048), dann migrieren', stamped;
        END IF;
    END IF;
END
$$;

ALTER TABLE region_area DROP COLUMN IF EXISTS is_trial;
