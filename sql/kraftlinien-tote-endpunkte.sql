-- Kraftlinien-Abschnitte, deren Endpunkt es nicht mehr gibt (Befund A9).
--
-- Der URSACHE ist mit Commit „fix(kraftlinien)" begegnet: das Stilllegen eines Punktes, an dem eine
-- aktive Kraftlinie haengt, wird verweigert.
--
-- ⚠️ An DREI Serverstellen, nicht an einer. Die erste Fassung deckte nur den Loeschweg ab -- aber
-- „Rueckgaengig" auf ein Anlegen setzt is_active = 0, ohne ihn zu beruehren, und die
-- Landschafts-Kaskade legt Label-Zeilen mit einem eigenen UPDATE um. Und der Riegel fragt nicht nach
-- dem feature_type: ein Endpunkt kann ein Nodix-Ort ('location'), eine Kreuzung ('junction', dazu 798
-- Altzeilen 'crossing') oder ein Nodix-Label ('label') sein.
--
-- Dieses Skript findet die BESTEHENDEN Waisen.
--
-- 🔧 Es raeumt NICHTS von selbst auf, und das ist Absicht: die 14 Abschnitte tragen Namen, Quellen und
-- eine Sortierung („Strick des Schwarzen Mannes", „Konzilslinie", „Nelkra-Linie", „Hexenband",
-- „Drachenblick"). Ob ein Abschnitt an einen anderen Endpunkt umgehaengt, stillgelegt oder gelassen
-- wird, ist eine inhaltliche Entscheidung, keine technische.
--
-- ⚠️ Nur auf einer Datenbank ausfuehren, von der ein Backup existiert (Editor-Leiste → „💾 Datenbank-Backup").
--
-- 💣 Die JSON-Seite traegt ueberall COLLATE utf8mb4_unicode_ci. JSON_UNQUOTE() gegen die Spalte
-- public_id ist ein SPALTENvergleich, und genau diese Form -- ohne COLLATE -- hat am 05.08.2026 zwei
-- oeffentliche Endpunkte auf 500 gelegt: „Illegal mix of collations", entschieden beim Planen, also bei
-- JEDER Zeile. Ob JSON_UNQUOTE hier tatsaechlich kollidiert, laesst sich ohne MySQL nicht entscheiden --
-- das COLLATE kostet nichts, falls nicht.

-- Schritt 1 -- Bestandsaufnahme. Zeigt je Abschnitt, WELCHER Endpunkt tot ist.
SELECT
    pl.public_id                                              AS abschnitt_public_id,
    pl.name                                                   AS abschnitt,
    JSON_UNQUOTE(JSON_EXTRACT(pl.properties_json, '$.from_public_id')) AS von_id,
    JSON_UNQUOTE(JSON_EXTRACT(pl.properties_json, '$.to_public_id'))   AS nach_id,
    CASE WHEN vonpunkt.id IS NULL THEN 'TOT' ELSE vonpunkt.name END    AS von_ort,
    CASE WHEN nachpunkt.id IS NULL THEN 'TOT' ELSE nachpunkt.name END  AS nach_ort
FROM map_features pl
LEFT JOIN map_features vonpunkt
       ON vonpunkt.public_id = JSON_UNQUOTE(JSON_EXTRACT(pl.properties_json, '$.from_public_id')) COLLATE utf8mb4_unicode_ci
      AND vonpunkt.is_active = 1
LEFT JOIN map_features nachpunkt
       ON nachpunkt.public_id = JSON_UNQUOTE(JSON_EXTRACT(pl.properties_json, '$.to_public_id')) COLLATE utf8mb4_unicode_ci
      AND nachpunkt.is_active = 1
WHERE pl.feature_type = 'powerline'
  AND pl.is_active = 1
  AND (vonpunkt.id IS NULL OR nachpunkt.id IS NULL)
ORDER BY pl.name, pl.public_id;

-- Schritt 2 -- die toten Ids allein, mit der Zahl der Abschnitte, die sie noch nennen.
-- (Im Systemtest: 6 Ids, 14 Abschnitte.) Ein Abschnitt mit ZWEI toten Enden erscheint unter beiden
-- Ids: Schritt 1 zaehlt Abschnitte, Schritt 2 zaehlt Nennungen -- die Summen muessen nicht gleich sein.
-- Sagt, ob der Ort nur stillgelegt (is_active = 0) oder ganz
-- fort ist -- ein stillgelegter laesst sich wieder aktivieren und repariert damit alles auf einmal.
SELECT
    tot.id                                        AS tote_id,
    COUNT(*)                                      AS genannt_von_abschnitten,
    MAX(inaktiv.name)                             AS name_falls_nur_stillgelegt,
    MAX(inaktiv.is_active)                        AS is_active
FROM (
    SELECT JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.from_public_id')) AS id
      FROM map_features WHERE feature_type = 'powerline' AND is_active = 1
    UNION ALL
    SELECT JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.to_public_id'))
      FROM map_features WHERE feature_type = 'powerline' AND is_active = 1
) AS tot
LEFT JOIN map_features lebend ON lebend.public_id = tot.id COLLATE utf8mb4_unicode_ci AND lebend.is_active = 1
LEFT JOIN map_features inaktiv ON inaktiv.public_id = tot.id COLLATE utf8mb4_unicode_ci
WHERE tot.id IS NOT NULL AND tot.id <> '' AND lebend.id IS NULL
GROUP BY tot.id
ORDER BY genannt_von_abschnitten DESC;

-- Schritt 3 -- der einfachste Fall zuerst. Steht in Schritt 2 ein Name und is_active = 0, dann wurde
-- der Ort nur stillgelegt: ihn zurueckzuholen repariert jeden Abschnitt, der ihn nennt, auf einmal.
-- Eine Zeile je Id, von Hand, nach Sichtprueng -- kein Sammel-UPDATE:
--
--   UPDATE map_features SET is_active = 1 WHERE public_id = '<tote_id>' AND is_active = 0;
--   UPDATE map_revision SET revision = revision + 1 WHERE id = 1;   -- EINMAL am Ende, nicht je Zeile
--
-- Ist der Ort dagegen wirklich fort, bleiben zwei Wege, und beide gehoeren dem Owner:
--   (a) den Abschnitt im Kraftlinien-Editor auf einen lebenden Nodix-Ort umhaengen, oder
--   (b) ihn stilllegen: UPDATE map_features SET is_active = 0 WHERE public_id = '<abschnitt_public_id>';
-- ⚠️ Bei (b) geht die Linie an dieser Stelle auseinander -- der Editor sortiert die Abschnitte einer
-- Linie ueber genau diese Kette.
