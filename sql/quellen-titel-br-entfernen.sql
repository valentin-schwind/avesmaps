-- Fünf Katalogtitel tragen ein <br> mitten im Namen (gemessen live am 01.09.2026).
-- Das Markup escapet korrekt — also steht in jeder Infobox wörtlich
-- „Landkartenset &lt;br /&gt;Das Dornenreich" statt eines Umbruchs.
--
-- 🔴 DIESE DATEI IST NUR DIE SOFORTKORREKTUR. Die dauerhafte Regel steht im Katalog-Upsert
-- (`avesmapsNormalizeSourceLabel` in api/_internal/app/feature-sources.php) und bindet damit ALLE
-- Schreiber — Publikations-Abgleich, Stadtkarten-Abgleich, Editor, Import. Ohne sie wäre diese
-- Korrektur zwecklos: `avesmapsPublicationReconcileEntity` schreibt mit `refreshLabel = true` und
-- hätte den alten Titel beim nächsten Lauf zurückgeholt.
--
-- ⚠️ Betroffen sind 32 Verknüpfungen (18 + 7 + 4 + 2 + 1). Die ids stammen aus der Messung; der
-- WHERE-Teil prüft zusätzlich den alten Titel, damit ein zwischenzeitlich geänderter Eintrag
-- unberührt bleibt statt überschrieben zu werden.
--
-- Ausführen: phpMyAdmin → SQL, oder  mysql < sql/quellen-titel-br-entfernen.sql

-- Vorher ansehen (sollte 5 Zeilen liefern):
SELECT id, label FROM sources WHERE label REGEXP '<br[[:space:]]*/?>';

UPDATE sources SET label = 'Havena-Fanfare Sonderausgabe'
 WHERE id = 7316      AND label = 'Havena-Fanfare<br/>Sonderausgabe';

UPDATE sources SET label = 'Meisterschirm des Schwarzen Auges'
 WHERE id = 12243     AND label = 'Meisterschirm<br/>des Schwarzen Auges';

-- ⚠️ Titel + Untertitel. Ein blosses Leerzeichen liest sich hier holprig
-- („Der Zug durch das Nebelmoor Die Sümpfe des Lebens"). Wer lieber einen Gedankenstrich will,
-- ändert diese eine Zeile — oder korrigiert sie nachträglich über das ✎ im Quellen-Editor.
UPDATE sources SET label = 'Der Zug durch das Nebelmoor Die Sümpfe des Lebens'
 WHERE id = 122127    AND label = 'Der Zug durch das Nebelmoor<br/>Die Sümpfe des Lebens';

UPDATE sources SET label = 'Landkartenset Das Dornenreich'
 WHERE id = 216214    AND label = 'Landkartenset <br />Das Dornenreich';

UPDATE sources SET label = 'Landkartenset Der Wolfsfrost'
 WHERE id = 976360    AND label = 'Landkartenset <br />Der Wolfsfrost';

-- Gegenprobe (sollte 0 Zeilen liefern):
SELECT id, label FROM sources WHERE label REGEXP '<br[[:space:]]*/?>';

-- 💣 UND DANACH DEN KARTENSTEMPEL ANSTOSSEN. Die Quellen reisen in der ETag-zwischengespeicherten
-- map-features-Nutzlast, und deren ETag hängt allein an `map_revision`. Ohne diesen Schritt
-- bekommt jeder warme Browser sein 304 und zeigt die alten Titel unbegrenzt weiter — dieselbe
-- Falle, die die Klimaebene und der Wappen-Notaus schon bezahlt haben (AGENTS.md §10).
INSERT INTO map_revision (id, revision) VALUES (1, 2)
  ON DUPLICATE KEY UPDATE revision = revision + 1;
