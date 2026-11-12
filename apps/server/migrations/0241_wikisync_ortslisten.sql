-- 0241: Der WikiSync gleicht die Ortslisten der Literatur ab (WI-0253, Scheibe Ortslisten; Vali 2026-10-26: „alles über WikiSync, zuerst Gipfel, dann Literatur, …“).
--
--   Ein Werk der Spielliteratur trägt seine Orte in `adventure_place` (Migration 0068). Gehört die Literatur in einer Umgebung dem WikiSync, fährt der Legacy-Zug sie
--   nicht mehr (Schritt I20 lässt sie aus); die Ortsliste folgt dann dem Wiki-Artikel des Werks (`Ort` oder `Thema`): Ein Ort, den das Wiki nicht mehr nennt, wird still
--   gelegt, ein neuer angelegt, ein umbenannter ersetzt – nur an Zeilen des Wikis (`legacy_origin = 'wiki'`), nie an Zeilen der Redaktion, nie an Tombstones.
--
--   Wer eine Zeile still gelegt hat, steht in `retired_origin` (`import`: der Legacy-Zug, `editor`: die Redaktion). Der WikiSync ist ein Dritter und bekommt sein Wort:
--   `wikisync`. Die Rücknahme einer Übernahme belebt genau die Zeilen wieder, die der WikiSync still gelegt hat.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine gelockerte Prüfung, jedes bisherige Wort bleibt erlaubt; das vorige Release schreibt das neue nie. Keine Tafel, keine
-- Spalte, keine Datenänderung. Die Rechte der Jobs-Rolle an `adventure_place` stehen in `apps/server/src/db/system-grants.psql` (hinter JEDE Migration).

ALTER TABLE adventure_place DROP CONSTRAINT IF EXISTS adventure_place_retired_consistent;
ALTER TABLE adventure_place
    ADD CONSTRAINT adventure_place_retired_consistent CHECK (
        (is_active AND retired_at IS NULL AND retired_origin IS NULL)
        OR (NOT is_active AND retired_at IS NOT NULL AND retired_origin IN ('import', 'editor', 'wikisync'))
    );

COMMENT ON COLUMN adventure_place.retired_origin IS
    'Wer die Zeile still gelegt hat: import (der Legacy-Zug nennt sie nicht mehr) | editor (die Redaktion) | wikisync (der Wiki-Artikel des Werks nennt sie nicht mehr, WI-0253, 0241).';
