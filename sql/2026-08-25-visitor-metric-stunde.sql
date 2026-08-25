-- visitor_metric · Die Stundenspalte wird NOT NULL, der Bestand wird dabei zusammengefasst.
--
-- WAS KAPUTT WAR. `hour` stand als NULL-faehige Spalte im UNIQUE-Schluessel
-- uq_visitor_metric (day, hour, actor_type, metric, dimension). Nach dem SQL-Standard gelten zwei
-- NULL als VERSCHIEDEN, und MySQL erlaubt im UNIQUE-Index beliebig viele davon -- das
-- `ON DUPLICATE KEY UPDATE count = count + 1` des Schreibers konnte fuer diese Zeilen also NIE
-- greifen. Dreizehn der fuenfzehn Metriken schreiben ohne Stunde (nur `pageview` und `map_load`
-- tragen eine, siehe $hourly in api/app/track.php). Jedes einzelne Ereignis legte damit eine NEUE
-- Zeile mit count=1 an, statt eine vorhandene hochzuzaehlen. Bestand seit dem 28.06.2026.
--
-- WARUM ES NIEMANDEM AUFFIEL. Der Lesepfad rechnet ohnehin `SUM(count) ... GROUP BY dimension`.
-- Die angezeigten Zahlen waren also die ganze Zeit RICHTIG; falsch war nur die Zeilenzahl -- und
-- die steht ausgerechnet in der Karte "Speicher", wo sie niemand mit dieser Ursache verbindet.
--
-- 🔴 REIHENFOLGE, UND SIE IST NICHT VERHANDELBAR: ZUERST DER CODE, DANN DIESES SKRIPT.
-- Der neue Code schreibt 24 statt NULL und arbeitet mit der ALTEN Tabelle bereits richtig (in eine
-- NULL-faehige Spalte darf man 24 schreiben) -- die Blutung hoert also schon mit dem Deploy auf.
-- Umgekehrt waere es ein Schaden: liefe dieses Skript zuerst, schriebe der alte Code weiter NULL
-- in eine NOT-NULL-Spalte. Im strict mode gaebe das Fehler 1048, und api/app/track.php verschluckt
-- JEDEN Fehler (`catch` -> immer {"ok":true}) -- die Statistik stuende still, ohne dass irgendwo
-- etwas rot wird. Ausserhalb des strict mode -- und dieser Server laeuft ausserhalb, siehe die
-- stille Kuerzung von app_setting in AGENTS.md §10 -- macht MySQL daraus stillschweigend eine 0,
-- also MITTERNACHT. Das waere schlimmer als der Ausgangsfehler: falsche Zahlen statt zu vieler Zeilen.
--
-- 💣 VORHER EIN BACKUP: Edit-Huelle -> "💾 Datenbank-Backup" (edit/backup.php, nur Admin).
-- Schritt 3 unten ist ein RENAME; die alte Tabelle bleibt zwar als visitor_metric_alt_20260825
-- stehen, aber ein Backup kostet Minuten und ein Fehlgriff kostet die Besucherhistorie.


-- ============================================================================================
-- SCHRITT 1 · MESSEN, NICHT RATEN.  (nur lesend -- das hier veraendert nichts)
-- ============================================================================================
-- Erwartung, wenn der Befund stimmt: `groesster` ist DURCHWEG 1 und `zeilen` = `summe`.
-- Steht irgendwo ein `groesster` > 1, hat das UPSERT doch gegriffen -- dann NICHT weitermachen,
-- sondern melden: dann ist die Live-Tabelle nicht die aus der DDL, und dieses Skript passt nicht.

SELECT metric, COUNT(*) AS zeilen, SUM(count) AS summe, MAX(count) AS groesster
FROM visitor_metric
WHERE hour IS NULL
GROUP BY metric
ORDER BY zeilen DESC;

-- Zur Gegenprobe die Metriken MIT Stunde: dort hat das UPSERT immer funktioniert, `groesster`
-- sollte also deutlich ueber 1 liegen. Zeigt auch DIESE Abfrage nur Einsen, liegt der Fehler
-- woanders und die ganze Annahme ist falsch.
SELECT metric, COUNT(*) AS zeilen, SUM(count) AS summe, MAX(count) AS groesster
FROM visitor_metric
WHERE hour IS NOT NULL
GROUP BY metric
ORDER BY zeilen DESC;


-- ============================================================================================
-- SCHRITT 2 · Die Zielform anlegen (leer, neben der alten Tabelle).
-- ============================================================================================
-- Wortgleich mit der DDL in api/_internal/analytics/visitor-analytics.php -- die einzige
-- Aenderung ist `hour`. Bewusst ausgeschrieben statt `CREATE TABLE ... LIKE`: so steht die
-- Zielform hier lesbar da und laesst sich gegen den Code vergleichen.

CREATE TABLE visitor_metric_neu (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    day DATE NOT NULL,
    hour TINYINT UNSIGNED NOT NULL DEFAULT 24,
    actor_type ENUM('visitor','editor','bot') NOT NULL DEFAULT 'visitor',
    metric VARCHAR(40) NOT NULL,
    dimension VARCHAR(190) NOT NULL DEFAULT '',
    count INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_visitor_metric (day, hour, actor_type, metric, dimension),
    KEY idx_visitor_metric_metric (metric, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================================
-- SCHRITT 3 · Der Tausch. EIN Befehl, atomar.
-- ============================================================================================
-- ⭐ Der Tausch kommt VOR dem Umkopieren, nicht danach -- und das ist der Grund, warum kein
-- einziges Ereignis verloren geht. Ab dieser Sekunde schreibt der Zaehler in die neue, leere
-- Tabelle; an visitor_metric_alt_20260825 haengt danach kein Schreiber mehr, und der Bestand
-- laesst sich in Ruhe nachtragen. Andersherum (erst kopieren, dann tauschen) faehrt jedes Ereignis
-- zwischen den beiden Befehlen in die alte Tabelle und ist weg.

RENAME TABLE visitor_metric     TO visitor_metric_alt_20260825,
             visitor_metric_neu TO visitor_metric;


-- ============================================================================================
-- SCHRITT 4 · Den Bestand zusammengefasst nachtragen.
-- ============================================================================================
-- Hier passiert die eigentliche Reparatur: die vielen Einzeilen je (Tag, Metrik, Dimension) werden
-- per GROUP BY zu EINER Zeile mit der Summe. COALESCE(hour, 24) zieht die NULL auf den Platzhalter
-- und laesst die echten Stunden 0..23 unangetastet.
--
-- 💣 Ein blankes `UPDATE ... SET hour = 24` ginge NICHT: sobald zwei Zeilen dabei aufeinander
-- fallen -- und genau das ist ja der Bestand -- verletzt es den UNIQUE-Schluessel.
--
-- ⭐ Das `ON DUPLICATE KEY UPDATE` faengt den Verkehr ab, der seit Schritt 3 schon in die neue
-- Tabelle gelaufen ist: dessen Zeilen werden um den Bestand ERHOEHT statt ueberschrieben.
-- (`VALUES(count)` und nicht die neuere Alias-Schreibweise -- die gibt es erst ab MySQL 8.0.19,
-- und welche Fassung auf dem Server laeuft, ist nicht gemessen.)

INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count)
SELECT day, COALESCE(hour, 24), actor_type, metric, dimension, SUM(count)
FROM visitor_metric_alt_20260825
GROUP BY day, COALESCE(hour, 24), actor_type, metric, dimension
ON DUPLICATE KEY UPDATE count = count + VALUES(count);


-- ============================================================================================
-- SCHRITT 5 · Nachrechnen. (nur lesend)
-- ============================================================================================
-- 🔴 DIE EINE ZAHL, DIE STIMMEN MUSS: die Summe je Metrik ist unveraendert. Die Zeilenzahl soll
-- fallen -- das ist der Sinn der Uebung --, aber SUM(count) darf sich um keinen einzigen Zaehler
-- verschieben, sonst hat die Statistik einen Sprung.
--
-- Erwartung: jede Zeile zeigt `differenz` = 0. Die Spalte `zeilen_vorher` sollte deutlich ueber
-- `zeilen_nachher` liegen; genau diese Ersparnis war der Fehler.

SELECT
    COALESCE(a.metric, n.metric)                      AS metric,
    a.zeilen                                          AS zeilen_vorher,
    n.zeilen                                          AS zeilen_nachher,
    a.summe                                           AS summe_vorher,
    n.summe                                           AS summe_nachher,
    COALESCE(n.summe, 0) - COALESCE(a.summe, 0)       AS differenz
FROM      (SELECT metric, COUNT(*) AS zeilen, SUM(count) AS summe
           FROM visitor_metric_alt_20260825 GROUP BY metric) a
LEFT JOIN (SELECT metric, COUNT(*) AS zeilen, SUM(count) AS summe
           FROM visitor_metric GROUP BY metric) n ON n.metric = a.metric
ORDER BY differenz <> 0 DESC, a.zeilen DESC;

-- Und die Gegenprobe auf die Bauform selbst: `Null` muss 0 sein.
SELECT COUNT(*) AS `Null` FROM visitor_metric WHERE hour IS NULL;


-- ============================================================================================
-- SCHRITT 6 · Aufraeumen -- ERST NACH EIN PAAR TAGEN.
-- ============================================================================================
-- Nicht sofort. Solange visitor_metric_alt_20260825 steht, ist der Schritt umkehrbar; sie kostet
-- nur Platz. Wenn die Statistik im Panel ein paar Tage unauffaellig aussieht:
--
-- DROP TABLE visitor_metric_alt_20260825;
