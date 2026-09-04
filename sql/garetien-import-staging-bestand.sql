-- Bestandsaufnahme des Garetien-Import-Stagings (04.09.2026)
-- In phpMyAdmin -> Reiter "SQL" einfuegen. REINES LESEN, aendert nichts.
--
-- Anlass: `SELECT * FROM garetien_import_row` liefert 99.280 Zeilen. Ein voller Import sind
-- 8.348 Zeilen -- es liegen also rund ein Dutzend Laeufe vollstaendig da. Es gibt in der
-- Codebasis KEINEN Loeschweg fuer diese Tabelle (nur INSERT/UPDATE), und jeder Lesezugriff
-- filtert auf EINEN `run_id`. Alles ausser dem juengsten Lauf ist Ballast.

-- (1) WIE VIEL PLATZ belegen die beiden Tabellen?
SELECT table_name                                            AS tabelle,
       table_rows                                            AS zeilen_ca,
       ROUND((data_length + index_length) / 1024 / 1024, 1)  AS mb_gesamt,
       ROUND(data_free / 1024 / 1024, 1)                     AS mb_luft
FROM information_schema.TABLES
WHERE table_schema = DATABASE()
  AND table_name IN ('garetien_import_row', 'garetien_import_run');

-- (2) WELCHE LAEUFE liegen da, wie gross ist jeder, und welcher ist der juengste?
--     `mb_nutzlast` ist die reine Textmenge in `geo` + `roh` -- ohne Index, aber belastbar.
SELECT r.id                                                       AS lauf,
       r.started_at,
       r.status,
       COUNT(z.id)                                                AS zeilen,
       ROUND(SUM(LENGTH(z.geo) + LENGTH(z.roh)) / 1024 / 1024, 1) AS mb_nutzlast
FROM garetien_import_run r
LEFT JOIN garetien_import_row z ON z.run_id = r.id
GROUP BY r.id, r.started_at, r.status
ORDER BY r.id DESC;

-- (3) WAISEN: Zeilen, deren Lauf-Zeile gar nicht mehr existiert.
--     Erwartung: 0. Kommt hier etwas, ist es in jedem Fall wegwerfbar.
SELECT COUNT(*) AS verwaiste_zeilen
FROM garetien_import_row z
LEFT JOIN garetien_import_run r ON r.id = z.run_id
WHERE r.id IS NULL;
