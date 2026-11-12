-- 0340: Besuche unter 10 Sekunden ausblendbar (OPS-000118; der Melder 2026-11-11: „Aufrufzahlen sind unplausibel“, viele Besuche unter
-- zehn Sekunden, ein Filter, der für alle Kennzahlen, Diagramme und Länder gilt).
--
-- Die Statistik hält nur Summen (`visitor_metric`), keine Zeile je Besuch. Deshalb lässt sich ein kurzer Besuch nicht nachträglich aus einer
-- Summe herausnehmen. Stattdessen zählt ein Besuch, der nach zehn Sekunden noch offen ist, ein zweites Mal in der eigenen Sorte `visitor_lang`:
-- Die Seite meldet sich nach zehn Sekunden mit allem, was sie bis dahin gemeldet hatte („Nachtrag“), danach zählt jede Meldung in beiden.
-- Der Filter liest `visitor_lang` statt `visitor`. Kein neues Feld, keine Kennung, nichts je Besuch.
--
-- 🔴 ERWEITERND: Die CHECK der Sorte nimmt ein Wort dazu und keines weg. Das vorige Release schreibt es nie und liest es nie.

ALTER TABLE visitor_metric DROP CONSTRAINT IF EXISTS visitor_metric_actor_type_check;
ALTER TABLE visitor_metric
    ADD CONSTRAINT visitor_metric_actor_type_check CHECK (actor_type IN ('visitor', 'editor', 'bot', 'visitor_lang'));

COMMENT ON COLUMN visitor_metric.actor_type IS
    'Sorte: visitor, editor, bot (Automat, nicht in den Besucherzahlen) und visitor_lang (dieselben Besucher, nur Besuche ab 10 s; OPS-000118).';
