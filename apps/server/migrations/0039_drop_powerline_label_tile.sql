-- Die unbeschnittene Namenskachel der Kraftlinien entfällt (WI-0025).
--
-- Seit a240338 wiederholen sich die Namen entlang der Linie und kommen aus `powerline_render` selbst;
-- der Betreiber hat das am 2026-09-23 abgenommen: „namen wiederholen passt“. `powerline_label_tile`
-- (0036, Mittelstück seit 0037) fragt seitdem niemand mehr an.
--
-- 🔴 Martin veröffentlicht Funktionen beim Start. Nach dieser Migration neu starten, sonst steht die
-- Quelle weiter im Katalog und antwortet auf eine Anfrage mit einem Fehler.
DROP FUNCTION IF EXISTS powerline_label_tile(integer, integer, integer);
