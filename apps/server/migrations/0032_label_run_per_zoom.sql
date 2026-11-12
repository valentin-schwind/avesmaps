-- Ein Schriftlauf je Namensinstanz UND Zoomstufe (WI-0018, ADR-0007 Fassung 5).
--
-- 💣 Bisher trug ein Instanzsatz EINEN Lauf fuer sein ganzes Band, gewaehlt auf der untersten
-- Stufe. Farlornschwelle hat gezeigt, was das kostet: auf z3 war der Name laenger als die ganze
-- Kurve, die Ableitung beruhigte die ganze Kurve zur Sehne - und die lief ueber den Blauen See. Die
-- Kachel schnitt fuer jede hoehere Stufe die Mitte dieses Laufs heraus, der Name stand bei z5 neben
-- der Flaeche. Jetzt wird das Fenster je Stufe gewaehlt, wie Legacy es beim Zeichnen tut (MCS-008).
--
-- Dafuer reicht der alte Schluessel nicht mehr: dieselbe Instanz steht jetzt einmal je Stufe da.
-- Die Kachelfunktion bleibt, wie sie ist - sie waehlt schon ueber run_min_zoom/run_max_zoom.
--
-- 🔴 Abgeleitete Daten, keine Kartenmutation. Nach dieser Migration `npm run derive:runs`
-- (Algorithmusversion 4 entwertet jeden alten Lauf) und Martin neu starten.

ALTER TABLE landscape_label_run DROP CONSTRAINT IF EXISTS landscape_label_run_instance_unique;
ALTER TABLE landscape_label_run
    ADD CONSTRAINT landscape_label_run_instance_unique UNIQUE (region_id, instance_count, instance, run_min_zoom);

COMMENT ON TABLE landscape_label_run IS
    'Abgeleitete Schriftlaeufe der Landschaftsnamen (ADR-0007). Eine Zeile ist eine Namensinstanz auf einer Zoomstufe. Niemals Source of Truth.';
