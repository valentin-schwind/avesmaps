-- A29 · Sitzt bei STRATO ein Reverse-Proxy vor der Anwendung?
--
-- NUR LESEND. Keine Schreibvorgaenge, keine Tabellenaenderung, kein Massenlauf.
-- In phpMyAdmin ausfuehren und die beiden Ergebnisse melden.
--
-- WARUM DIE FRAGE ENTSCHEIDET: `avesmapsClientIpAddress()` (api/_internal/bootstrap.php:303)
-- nimmt das LINKESTE Element von `X-Forwarded-For` -- und genau das setzt der Aufrufer selbst.
-- Damit ist jede Drossel im Haus umgehbar (neuer Kopfwert = frischer Eimer), und umgekehrt
-- sperrt der Wert eines Fremden diesen aus. Der Ausweg haengt an der Topologie:
--
--   * KEIN Proxy  -> `REMOTE_ADDR` ist die Wahrheit. `X-Forwarded-For` gehoert ignoriert.
--   * MIT Proxy   -> `REMOTE_ADDR` ist fuer JEDEN Besucher dieselbe Proxy-Adresse. Wer dann
--                    einfach auf `REMOTE_ADDR` umstellt, steckt alle Besucher in EINEN Eimer --
--                    und die Stundengrenze von 5 sperrt nach fuenf Meldungen die ganze Seite
--                    aus. Dann braucht es stattdessen das RECHTESTE Element, das der Proxy
--                    selbst angehaengt hat.
--
-- Beide Wege sind einzeilig; nur die falsche Wahl ist teuer. Deshalb wird hier gemessen und
-- nicht geraten.

-- 1) Wie viele VERSCHIEDENE Absender-Adressen hat die Meldungstabelle gesehen?
--    Ein Ergebnis von 1 bei mehreren Zeilen aus verschiedenen Sitzungen = Proxy.
--    Deutlich mehr als 1 = kein gemeinsamer Proxy davor.
SELECT
    COUNT(*)                        AS zeilen_gesamt,
    COUNT(DISTINCT remote_ip)       AS verschiedene_adressen,
    COUNT(DISTINCT ip_hash)         AS verschiedene_hashes,
    MIN(created_at)                 AS aelteste,
    MAX(created_at)                 AS juengste
FROM map_reports;

-- 2) Die haeufigsten Absender, damit eine einzelne dominierende Adresse sichtbar wird.
--    ⚠️ Ein Teil dieser Zeilen stammt aus dem Systemtest selbst (siehe „Was der Test
--    hinterlassen hat") -- die zaehlen als EIN Absender und duerfen das Bild nicht kippen.
--    Interessant ist deshalb vor allem, ob es DANEBEN weitere Adressen gibt.
SELECT
    remote_ip,
    COUNT(*) AS anzahl,
    MIN(created_at) AS zuerst,
    MAX(created_at) AS zuletzt
FROM map_reports
GROUP BY remote_ip
ORDER BY anzahl DESC
LIMIT 20;
