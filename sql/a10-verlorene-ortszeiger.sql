-- Wiederherstellung nach dem zurueckgenommenen A10-Versuch (Commit ae06f5dc, zurueckgenommen mit
-- 1ad11c54 am 05.08.2026).
--
-- WAS PASSIERT IST. Der Versuch setzte „tote" Ortszeiger auf 'unresolved' zurueck und suchte dafuer
-- jede target_public_id in map_features. target_kind hat aber SIEBEN Werte, nicht vier: 'lore' lebt in
-- lore_entry (Schluessel: wiki_key), 'ecosystem' in ecosystem_region. Beide wurden in map_features nie
-- gefunden -- und ihre Zeiger geloescht. Betroffen ist ausschliesslich `adventure_place`; nur der
-- Quellen-Verknuepfungsweg (avesmapsGameLiteratureLinkPlaceFromSource) schreibt diese beiden Arten, und der
-- schreibt nur in diese Tabelle.
--
-- ✅ DER SCHADEN IST VOLLSTAENDIG WIEDERHERSTELLBAR, und zwar aus der Zeile selbst.
-- avesmapsGameLiteraturePlaceNameFor (game-literature.php:1151) kennt fuer 'lore', 'ecosystem' und 'powerline'
-- keinen Namenszweig und gibt die public_id zurueck. `raw_name` ENTHAELT also genau die geloeschte
-- target_public_id -- und raw_name hat der Versuch stehen lassen.
--
-- ZEITFENSTER (UTC): ausgeliefert 16:09:25, zurueckgenommen 16:25:35, dazu je 2-4 Minuten
-- PHP-Verzoegerung. Ausgeloest wurde es nur, wenn in dieser Zeit jemand im Kartensammlungs-Editor
-- einen Ort hinzugefuegt oder ein Abenteuer-/Karten-Sync gelaufen ist.
-- ⚠️ Die Zeitspalten stehen in der SERVERzeit der Datenbank, nicht zwingend in UTC. Schritt 1 kommt
-- deshalb OHNE Zeitfilter aus -- er erkennt den Schaden an der Zeile selbst und ist damit unabhaengig
-- von jeder Zeitzone. Das Fenster steht nur in Schritt 3, als Gegenprobe.
--
-- ⚠️ Nur auf einer Datenbank ausfuehren, von der ein Backup existiert (Editor-Leiste → „💾 Datenbank-Backup").

-- ============================================================================
-- Schritt 1 -- DER SCHADEN, zeitzonenunabhaengig erkannt.
--
-- Eine Zeile mit created_from_source_id kann NICHT ohne Zeiger entstanden sein: der Einfuegepfad
-- (game-literature.php:1180) lehnt einen leeren publicId ab und schreibt kind und pid immer zusammen. Eine
-- solche Zeile OHNE target_public_id ist also zwangslaeufig beschaedigt.
-- Die letzte Spalte sagt zugleich, was wiederhergestellt gehoert.
-- ============================================================================
SELECT
    ap.id,
    ap.adventure_id,
    ap.raw_name                       AS verlorene_public_id,
    ap.created_from_source_id,
    ap.updated_at,
    CASE
        WHEN eco.public_id IS NOT NULL THEN 'ecosystem'
        WHEN lore.wiki_key IS NOT NULL THEN 'lore'
        WHEN mf.public_id  IS NOT NULL THEN 'map_features (settlement/region/path/powerline)'
        ELSE '?? nicht auffindbar -- von Hand pruefen'
    END                               AS gehoert_zu
FROM adventure_place ap
LEFT JOIN ecosystem_region eco ON eco.public_id = ap.raw_name COLLATE utf8mb4_unicode_ci
LEFT JOIN lore_entry      lore ON lore.wiki_key = ap.raw_name COLLATE utf8mb4_unicode_ci
LEFT JOIN map_features      mf ON mf.public_id  = ap.raw_name COLLATE utf8mb4_unicode_ci
WHERE ap.created_from_source_id IS NOT NULL
  AND ap.target_public_id IS NULL
ORDER BY ap.updated_at DESC, ap.id;

-- Erwartung, wenn nichts passiert ist: LEERE Ergebnismenge. Dann ist hier fertig.

-- ============================================================================
-- Schritt 2 -- WIEDERHERSTELLEN. Erst ausfuehren, wenn Schritt 1 Zeilen zeigt und die Spalte
-- `gehoert_zu` bei jeder davon eine der drei Tabellen nennt (nicht „??").
--
-- Drei getrennte UPDATEs, je Art eines. Absichtlich kein CASE-Sammel-UPDATE: so laesst sich nach jedem
-- einzeln zaehlen, und eine Art, die nicht betroffen war, bleibt unberuehrt.
-- ============================================================================
--
-- UPDATE adventure_place ap
--   JOIN ecosystem_region eco ON eco.public_id = ap.raw_name COLLATE utf8mb4_unicode_ci
--    SET ap.target_kind = 'ecosystem', ap.target_public_id = ap.raw_name
--  WHERE ap.created_from_source_id IS NOT NULL AND ap.target_public_id IS NULL;
--
-- UPDATE adventure_place ap
--   JOIN lore_entry lore ON lore.wiki_key = ap.raw_name COLLATE utf8mb4_unicode_ci
--    SET ap.target_kind = 'lore', ap.target_public_id = ap.raw_name
--  WHERE ap.created_from_source_id IS NOT NULL AND ap.target_public_id IS NULL;
--
-- UPDATE adventure_place ap
--   JOIN map_features mf ON mf.public_id = ap.raw_name COLLATE utf8mb4_unicode_ci
--    SET ap.target_kind = CASE mf.feature_type
--                             WHEN 'powerline' THEN 'powerline'
--                             WHEN 'label'     THEN 'region'
--                             ELSE mf.feature_type
--                         END,
--        ap.target_public_id = ap.raw_name
--  WHERE ap.created_from_source_id IS NOT NULL AND ap.target_public_id IS NULL;
--
-- ⚠️ target_wiki_key und target_territory_path bleiben leer -- die rechnet der naechste Auflaeufer von
-- selbst nach (avesmapsResolvePlacesInTable nimmt jede Zeile ohne target_territory_path wieder auf).
-- Genau deshalb muessen sie hier NICHT von Hand gesetzt werden.

-- ============================================================================
-- Schritt 3 -- Gegenprobe ueber die Zeit, falls Schritt 1 unerwartet leer bleibt und trotzdem etwas
-- fehlt. Zeigt ALLE Zeilen beider Tabellen, die im Fenster angefasst wurden -- auch die, die der
-- Versuch zu Recht zurueckgesetzt haette (ein stillgelegtes Ziel; die holt der naechste Auflaeufer
-- von selbst wieder ein).
-- ⚠️ Zeiten in Serverzeit. Grosszuegig gewaehlt; notfalls den ganzen Tag nehmen.
-- ============================================================================
SELECT 'adventure_place' AS tabelle, id, adventure_id AS gehoert_zu_id, raw_name, target_kind, target_public_id, origin, updated_at
  FROM adventure_place
 WHERE updated_at BETWEEN '2026-08-05 16:05:00' AND '2026-08-05 16:35:00'
UNION ALL
SELECT 'citymap_place', id, citymap_id, raw_name, target_kind, target_public_id, origin, updated_at
  FROM citymap_place
 WHERE updated_at BETWEEN '2026-08-05 16:05:00' AND '2026-08-05 16:35:00'
 ORDER BY updated_at, tabelle, id;
