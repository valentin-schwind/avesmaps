-- Der Grad des Polynomfits der Landschaftskurve, je Region (WI-0019, ADR-0007).
--
-- Betreiberentscheidung 2026-09-23: Editoren setzen den Grad je Region, erlaubt 2 bis 5. NULL heisst
-- 3 - Legacys Grad. Legacy fuehrt polyDegree im Fenster "Darstellung", der Wert erreicht den Rechner
-- aber nie; in der Produktion ist 3 hartcodiert (MCS-008).
--
-- 🔴 Keine Werte. Die Spalte bleibt leer, bis es den Editor gibt (Map Mutation Guard, Cutoff). Der
-- Regionsimport kennt sie nicht und ueberschreibt sie deshalb auch nicht.

ALTER TABLE region ADD COLUMN IF NOT EXISTS label_curve_degree SMALLINT
    CONSTRAINT region_label_curve_degree_range CHECK (label_curve_degree BETWEEN 2 AND 5);

COMMENT ON COLUMN region.label_curve_degree IS
    'Grad des Polynomfits der Landschaftskurve, 2..5. NULL = 3 wie Legacy. Setzen nur Editoren (WI-0019).';
