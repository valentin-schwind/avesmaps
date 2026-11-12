-- Die Darstellungstafel der Landschaften kennt das Ziel bis Stufe 8 (WI-0129, Betreiber 2026-10-10 E2 A).
--
-- Legacy endet bei Stufe 7, und seine Tafel nimmt nur 0..7 an (`ecosystem-display.php`). Ein Legacy-`bis = 7` heißt deshalb
-- „bis ganz nah“; der Import schreibt es seit WI-0129 als Ziel 8 (`upperBandFromLegacy` in packages/shared/src/zoom-bands.ts),
-- damit die Namen auf der neuen Stufe 8 stehen bleiben, dauerhaft und bei jedem weiteren Zug gleich. `bis = -1` bleibt „aus“,
-- kleinere Werte und die Untergrenze bleiben, wie Legacy sie liefert. `map_label` erlaubt 0..8 schon seit 0010.
--
-- 🔴 NUR GELOCKERT: dieselben zwei Bedingungen unter demselben Namen, mit 8 statt 7 als Obergrenze. Das vorige Release schreibt
-- weiter höchstens 7 und erfüllt sie; nichts wird umgeschrieben. Die Bestandszeilen bringt erst der nächste freigegebene Import
-- in den Zielzustand (WI-0129 §8), keine Datenänderung in dieser Migration.
ALTER TABLE landscape_display_art DROP CONSTRAINT IF EXISTS landscape_display_art_band_from_check;
ALTER TABLE landscape_display_art
    ADD CONSTRAINT landscape_display_art_band_from_check CHECK (band_from BETWEEN 0 AND 8);
ALTER TABLE landscape_display_art DROP CONSTRAINT IF EXISTS landscape_display_art_band_to_check;
ALTER TABLE landscape_display_art
    ADD CONSTRAINT landscape_display_art_band_to_check CHECK (band_to BETWEEN -1 AND 8);

COMMENT ON COLUMN landscape_display_art.band_from IS
    'Untere Bandgrenze im Ziel 0..8. Aus Legacy unverändert übernommen (Legacy 0..7, WI-0129).';
COMMENT ON COLUMN landscape_display_art.band_to IS
    '-1 = aus (Legacy: bis < ab). Ziel 0..8; Legacys terminale 7 steht hier als 8, kleinere Werte unverändert (WI-0129).';
