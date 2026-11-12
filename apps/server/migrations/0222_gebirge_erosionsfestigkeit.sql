-- 0222: Erosionsfestigkeit je Gebirge (WI-0249; Betreiber 2026-10-25: „schön wärs, wenn ich jedem modellierten gebirge sagen könnte, wie stark es
-- von der hydraulischen erosion beeinflusst werden darf“, und: „pro gebirge, nach ‚Höhe‘ vor ‚Werte‘“).
--
--   `terrain_control.erosionsfestigkeit`: Prozent von 0 bis 100 (wie im Reiter). Leer und 0 heißen „wie die Landschaftsart des Gebirges“;
--   100 heißt: Die hydraulische Erosion der Landfläche (Einschneiden und die Rückverteilung des abgetragenen Stoffs) lässt das Gebirge
--   unberührt. Sie wirkt nur in Fassung 19 (Rückennetz-Gebirge im Gelände, `terrain/domain/formerhalt.ts`); in 17 und 18 bleibt sie ohne Wirkung
--   und ohne Einfluss auf den Fingerabdruck. Hangdiffusion und die Rinnen der Saat bleiben, wie sie sind.
--
-- 🔴 ADDITIV (`AGENTS.md`, „Migrationen: erst erweitern“): eine nullbare Spalte mit eigener Prüfung. Das vorige Release liest und schreibt sie
-- nicht; seine Zeilen bleiben gültig und gelten als 0 %. Der Trigger `terrain_control_revision` (0212) zählt die Revision auch bei ihr.

ALTER TABLE terrain_control ADD COLUMN IF NOT EXISTS erosionsfestigkeit DOUBLE PRECISION
    CHECK (erosionsfestigkeit BETWEEN 0 AND 100);

COMMENT ON COLUMN terrain_control.erosionsfestigkeit IS
    'Erosionsfestigkeit des Gebirges in Prozent (WI-0249, Fassung 19): 0 = wie die Landschaftsart, 100 = die hydraulische Erosion des Gelaendes laesst es unberuehrt; NULL = 0.';

CREATE OR REPLACE TRIGGER terrain_control_revision
    BEFORE UPDATE OF area_id, map_domain_id, koernung, stufen, erosion, plateau, hypsometrie, maximalhoehe, bergform, rauschen, sattel,
                     talbreite, einschnitt, kammlinie, beschriftungskurve, vorlage_morph, vorlage_hoehe, durchschnittshoehe, is_active,
                     source_system, gebirgstyp, muster, grat, grat_breite, talboden, erosionsfestigkeit, revision
    ON terrain_control
    FOR EACH ROW EXECUTE FUNCTION public.revision_bump();
