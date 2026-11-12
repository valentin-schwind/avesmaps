-- Woran jemand gerade sitzt (WI-0141b, Betreiber 2026-10-14: „bau die aktuelle ansicht in der sitzung mit ein“).
--
-- Rein additiv: Das vorige Release schreibt die Spalte nicht und liest sie nicht.
--
-- 🔴 AN DER SITZUNG, NICHT IN EINER TAFEL. Der Wert sagt „gerade offen“ und sonst nichts: Er wird überschrieben, nicht
-- angehängt, und verschwindet mit der Sitzung. Damit entsteht keine Historie darüber, wer wann woran gesessen hat — die
-- Statistik zählt weiter anonym und in Summen (BESUCH-0001 §4).
--
-- 🔴 DER INHALT IST EINE KENNUNG AUS EINER POSITIVLISTE (`SITZUNG_ANSICHTEN` im shared-Vertrag), nie Freitext: Der Wert
-- kommt aus dem Browser und wird anderen Editoren angezeigt. Die Länge begrenzt die Spalte zusätzlich.

ALTER TABLE avesmaps_auth.session
    ADD COLUMN IF NOT EXISTS view_key TEXT CHECK (view_key IS NULL OR char_length(view_key) <= 40);

COMMENT ON COLUMN avesmaps_auth.session.view_key IS
    'Woran die Sitzung gerade sitzt (WI-0141b): eine Kennung aus SITZUNG_ANSICHTEN, überschrieben statt angehängt.';
