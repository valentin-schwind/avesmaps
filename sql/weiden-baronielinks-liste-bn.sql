-- Einmal-Reparatur, 18.08.2026: herzogtum-weiden.net hat seine Baronie-Adressen umbenannt.
--
--   ALT  https://www.herzogtum-weiden.net/politik/liste-baronien/baronien/gfl-salthel   -> 404
--   NEU  https://www.herzogtum-weiden.net/politik/liste-bn/baronien/gfl-salthel         -> 200
--
-- Gemessen am 18.08.2026 per HTTP: die alte Adresse liefert 404 OHNE Weiterleitung, die neue 200.
-- Es gibt also keine Gnadenfrist -- jeder gespeicherte Link ist ab sofort tot. Geaendert hat sich
-- ausschliesslich das Pfadsegment `liste-baronien` -> `liste-bn`; die 43 Baronie-Slugs dahinter sind
-- Zeichen fuer Zeichen dieselben geblieben (gegen die Linkliste unter /politik/liste-bn geprueft).
-- Deshalb reicht ein REPLACE auf dem Segment und es braucht keine Zuordnungstabelle. Das Muster
-- `liste-baronien` faengt zugleich http:// wie https:// und mit wie ohne www.
--
-- ⚠️ ICH KONNTE NICHT ZAEHLEN. Von der Entwicklungsmaschine gibt es keine Verbindung zur Live-Datenbank
-- (api/config.local.php liegt nur auf dem Server). Anders als die Schwesterdateien in diesem Ordner
-- nennt diese hier deshalb KEINE erwarteten Zeilenzahlen -- Abschnitt 1 misst sie. Bitte das Ergebnis
-- von Abschnitt 1 ansehen, BEVOR Abschnitt 3 laeuft.
--
-- Laufen lassen in phpMyAdmin (admin/phpMyAdmin), Anweisung fuer Anweisung, und jedes Mal die
-- gemeldete Zeilenzahl lesen.
--
-- 💣 VORHER links in der Seitenleiste die Avesmaps-Datenbank anklicken, und nach Abschnitt 1 NOCH
-- EINMAL. Abschnitt 1 fragt information_schema ab, und phpMyAdmin bleibt danach dort stehen; jede
-- folgende Anweisung nennt ihre Tabellen unqualifiziert und liefe sonst in
-- "#1109 - Unknown table 'sources' in information_schema".


-- =====================================================================================
-- 0) NUR LESEN: taugt SHA2 auf diesem Server?
--    Abschnitt 3 berechnet sources.url_hash mit SHA2 neu. Muss genau 64 Hex-Zeichen liefern.
--    Kommt hier NULL oder eine leere Zelle, ist MySQL ohne SSL-Unterstuetzung gebaut -- dann
--    Abschnitt 3 NICHT laufen lassen (url_hash ist NOT NULL, die Anweisung braeche ab).
-- =====================================================================================
SELECT SHA2('https://www.herzogtum-weiden.net/politik/liste-bn/baronien/gfl-salthel', 256) AS probe,
       LENGTH(SHA2('x', 256)) AS muss_64_sein;


-- =====================================================================================
-- 1) NUR LESEN: wo stecken die Links ueberhaupt?
--
--    Statt zu raten, welche Tabelle sie traegt, laesst dieser Schritt die Datenbank die Suche
--    selbst zusammenbauen: er durchsucht jede Text-/JSON-Spalte, deren NAME nach einer Adresse
--    aussieht (url, link, source, *_json). Das deckt auch Tabellen ab, die dieses Repo gar nicht
--    kennt -- der Server traegt Dateien, die hier nie lagen (AGENTS.md §10).
--
--    💣 SET SESSION group_concat_max_len ist NICHT schmueckendes Beiwerk: die Voreinstellung ist
--    1024 Zeichen. Ohne die Zeile wird das erzeugte SQL stumm mitten im Wort abgeschnitten und man
--    haelt die halbe Suche fuer die ganze.
--
--    💣 UND: dieser Abschnitt fragt information_schema ab -- phpMyAdmin SPRINGT daraufhin in genau
--    diese Datenbank. Die erste Fassung filterte mit `TABLE_SCHEMA = DATABASE()`; wer den Abschnitt
--    ein zweites Mal laufen liess (oder ihn als erstes ueberhaupt), suchte damit IN information_schema
--    und bekam ein leeres Feld -- ununterscheidbar von "es gibt keine Treffer". Am 18.08.2026 sofort
--    passiert. Deshalb steht hier kein DATABASE() mehr, sondern der Ausschluss der System-Schemata,
--    und das erzeugte SQL nennt die Datenbank VOLL QUALIFIZIERT (`schema`.`tabelle`) -- es laeuft
--    dann aus jedem Kontext heraus richtig.
--
--    ⚠️ Fuer alle UEBRIGEN Abschnitte gilt das nicht: die schreiben `sources`, `map_features` usw.
--    unqualifiziert. Vor Abschnitt 2 also links in der Seitenleiste die Avesmaps-Datenbank
--    anklicken, sonst antwortet MySQL mit "#1109 - Unknown table 'sources' in information_schema".
-- =====================================================================================
--    ⭐ Die Datenbank fuehrt die erzeugte Abfrage GLEICH SELBST aus (PREPARE/EXECUTE), statt sie zum
--    Kopieren hinzulegen. Die erste Fassung gab sie als Zelle zurueck -- und phpMyAdmin schneidet eine
--    lange Zelle im Raster ab ("SELECT 'dbs…adventure.cover_source' AS ste..."), man haette sie also
--    erst muehsam wieder herausklauben muessen. PREPARE/EXECUTE braucht kein besonderes Recht.
SET SESSION group_concat_max_len = 1000000;

SET @sql = CONCAT('SELECT stelle, treffer FROM (', (
    SELECT GROUP_CONCAT(
               CONCAT('SELECT ''', TABLE_SCHEMA, '.', TABLE_NAME, '.', COLUMN_NAME,
                      ''' AS stelle, COUNT(*) AS treffer FROM `', TABLE_SCHEMA, '`.`', TABLE_NAME,
                      '` WHERE CAST(`', COLUMN_NAME, '` AS CHAR) LIKE ''%liste-baronien%''')
               ORDER BY TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
               SEPARATOR ' UNION ALL '
           )
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
      AND DATA_TYPE IN ('char', 'varchar', 'text', 'mediumtext', 'longtext', 'json')
      AND (COLUMN_NAME LIKE '%url%' OR COLUMN_NAME LIKE '%link%'
           OR COLUMN_NAME LIKE '%source%' OR COLUMN_NAME LIKE '%json%')
), ') x ORDER BY treffer DESC, stelle LIMIT 40');

-- Sagt, ob ueberhaupt etwas zu suchen war. NULL oder 0 heisst: der Generator hat nichts gebaut, die
-- Suche lief nie -- und eine leere Trefferliste waere dann keine Aussage ueber die Daten.
SELECT LENGTH(@sql) AS sql_laenge_muss_gross_sein;

PREPARE stmt FROM @sql;
EXECUTE stmt;
-- 💣 KEIN `DEALLOCATE PREPARE` hinterher. phpMyAdmin zeigt bei mehreren Anweisungen das Ergebnis der
-- LETZTEN, und DEALLOCATE liefert keins -- die Suche laeuft, man sieht nur nichts ("passiert nix",
-- 18.08.2026). Die Anweisung MUSS als letzte stehen. Der Handle wird mit der Sitzung ohnehin frei.
-- ⚠️ Aus demselben Grund NICHT `WHERE treffer > 0` filtern: null Zeilen sehen genauso aus wie eine
-- Abfrage, die gar nicht angezeigt wird. Lieber alles sortiert zeigen -- oben stehen die Treffer.

-- Das Ergebnis IST die Antwort: welche Spalten tragen die toten Links, und wie viele. Es sagt zugleich,
-- welche der Abschnitte 3-5 ueberhaupt gebraucht werden.
--
-- Steht ueberall treffer = 0, obwohl auf der Karte tote Weiden-Links stehen, dann steckt die Adresse in
-- einer Spalte mit unauffaelligem Namen. Dann dasselbe noch einmal OHNE die letzte AND-Zeile -- es
-- durchsucht dann jede Textspalte der Datenbank und laeuft entsprechend laenger.
-- ⚠️ Der Lauf scannt einige grosse Tabellen. Das ist harmlos: es belastet MySQL, nicht die
-- PHP-Worker, um die sich AGENTS.md §9 sorgt.


-- =====================================================================================
-- 2) NUR LESEN: die Stellen, die vor dem Schreiben eine Antwort brauchen.
-- =====================================================================================

-- 2a) Der Quellenkatalog -- die wahrscheinlichste Heimat dieser Links (Baronien sind Territorien,
--     ihre Belege haengen als feature_sources-Verknuepfung am gemeinsamen sources-Katalog).
--     Die Spalte haengt_an sagt, an wie vielen Objekten die Quelle haengt.
SELECT s.id, s.url, s.label, s.source_type,
       (SELECT COUNT(*) FROM feature_sources fs WHERE fs.source_id = s.id) AS haengt_an
FROM sources s
WHERE s.url LIKE '%liste-baronien%'
ORDER BY s.id;

-- 2b) 💣 DIE KOLLISIONSPRUEFUNG. sources.url_hash traegt einen UNIQUE-Schluessel und IST die
--     Identitaet einer Quelle. Hat jemand die NEUE Adresse laengst von Hand angelegt, waehrend die
--     alte noch danebensteht, dann bricht das UPDATE aus Abschnitt 3a mit "Duplicate entry" ab --
--     und zwar erst mittendrin.
--     ⚠️ MUSS 0 ZEILEN liefern. Kommt hier etwas zurueck, gilt Abschnitt 3b statt 3a.
SELECT alt.id AS alte_id, alt.url AS alte_url,
       neu.id AS neue_id, neu.url AS neue_url
FROM sources alt
JOIN sources neu
  ON neu.url_hash = SHA2(REPLACE(alt.url, 'liste-baronien', 'liste-bn'), 256)
WHERE alt.url LIKE '%liste-baronien%';

-- 2c) Die Alt-"Andere Quelle" liegt als JSON in den Kartenobjekten. Diese Abfrage zeigt, WO im JSON
--     die Adresse sitzt -- Abschnitt 4 fasst ausschliesslich $.other_source.url an. Steht die
--     Adresse laut dieser Ausgabe woanders im JSON, dann taugt Abschnitt 4 dafuer nicht.
--
--     💣 Das IF(JSON_VALID(...)) ist kein Zierrat. properties_json ist eine TEXT-Spalte, keine
--     JSON-Spalte -- niemand haelt dort gueltiges JSON fest. Trifft JSON_EXTRACT auf eine leere oder
--     kaputte Zelle, bricht MySQL die GANZE Anweisung mit Fehler 3141 ab, und zwar mitten im Lauf.
--     Als Argument der Funktion wird das IF garantiert zuerst ausgewertet; ein AND JSON_VALID(...)
--     im WHERE waere das NICHT, dort steht die Auswertungsreihenfolge nicht fest.
SELECT public_id, feature_type, name,
       JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(properties_json), properties_json, '{}'),
                                 '$.other_source.url')) AS other_source_url,
       properties_json
FROM map_features
WHERE properties_json LIKE '%liste-baronien%';


-- =====================================================================================
-- 3) SCHREIBEN: der Quellenkatalog sources.
--    Nur EINEN der beiden Wege fahren -- 3a wenn 2b leer war, sonst 3b.
-- =====================================================================================

-- 3a) Der Normalfall (2b lieferte 0 Zeilen).
--     💣 REPLACE steht ABSICHTLICH zweimal da. MySQL wertet eine SET-Liste von links nach rechts aus,
--     url traegt in der zweiten Zeile also schon den neuen Wert -- ein blosses SHA2(url, 256) waere
--     hier zwar zufaellig richtig, aber nur solange niemand die Reihenfolge umstellt. Die doppelte
--     Schreibweise stimmt unter beiden Lesarten (REPLACE auf einer bereits ersetzten Adresse findet
--     nichts mehr) und macht die Anweisung zugleich wiederholbar.
UPDATE sources
SET url      = REPLACE(url, 'liste-baronien', 'liste-bn'),
    url_hash = SHA2(REPLACE(url, 'liste-baronien', 'liste-bn'), 256)
WHERE url LIKE '%liste-baronien%';

-- 3b) Der Kollisionsfall (2b lieferte Zeilen) -- NUR dann, und dann STATT 3a. Zum Ausfuehren die
--     drei Anweisungen entkommentieren, in dieser Reihenfolge.
--     Die neue Adresse existiert bereits als eigene Katalogzeile. Die alte kann nicht umbenannt
--     werden, sie muss VERSCHMOLZEN werden: erst alle Verknuepfungen auf die neue Zeile umhaengen,
--     dann die alte Zeile samt ihrer uebrig gebliebenen Verknuepfungen entfernen.
--     💣 UPDATE IGNORE ist tragend: uq_feature_source (entity_type, entity_public_id, source_id)
--     verbietet, dass ein Objekt zweimal auf dieselbe Quelle zeigt. Haengt eine Baronie bereits an
--     BEIDEN Zeilen, laeuft das Umhaengen genau dort in den Doppelschluessel; IGNORE laesst diese
--     eine Verknuepfung stehen, und der zweite Schritt raeumt sie weg.
--
-- UPDATE IGNORE feature_sources fs
--   JOIN sources alt ON alt.id = fs.source_id
--   JOIN sources neu ON neu.url_hash = SHA2(REPLACE(alt.url, 'liste-baronien', 'liste-bn'), 256)
--    SET fs.source_id = neu.id
--  WHERE alt.url LIKE '%liste-baronien%';
--
-- DELETE fs FROM feature_sources fs
--   JOIN sources alt ON alt.id = fs.source_id
--  WHERE alt.url LIKE '%liste-baronien%';
--
-- DELETE FROM sources WHERE url LIKE '%liste-baronien%';


-- =====================================================================================
-- 4) SCHREIBEN: die Alt-"Andere Quelle" in den Kartenobjekten (nur falls 2c Zeilen zeigte).
--
--    Nur Ort/Region/Weg tragen properties.other_source. Die Zeile bekommt zugleich die naechste
--    Kartenrevision -- ohne sie zeigt ein Client mit warmem Cache weiter die tote Adresse.
--    💣 Kein @variable fuer die Revision: map_features.revision ist BIGINT UNSIGNED NOT NULL, eine
--    leere Sitzungsvariable laesst die Anweisung scheitern und in einer Transaktion zurueckrollen --
--    genau daran ist sql/pfad-kutsche-entfernen.sql schon einmal lautlos gescheitert. Die
--    Unterabfrage liest map_revision direkt (map_revision ist eine ANDERE Tabelle als map_features,
--    also kein MySQL-Fehler 1093).
--    💣 IF(JSON_VALID(...)) an JEDER Stelle, aus dem Grund unter 2c.
--    ⚠️ JSON_SET schreibt das JSON neu -- Schluesselreihenfolge und Leerzeichen werden dabei
--    normalisiert. Das ist hier bereits Hausbrauch (sql/pfad-kutsche-entfernen.sql tut dasselbe mit
--    JSON_REMOVE) und fuer die Leser des Feldes bedeutungslos.
-- =====================================================================================
UPDATE map_features
SET properties_json = JSON_SET(
        IF(JSON_VALID(properties_json), properties_json, '{}'),
        '$.other_source.url',
        REPLACE(JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(properties_json), properties_json, '{}'),
                                          '$.other_source.url')),
                'liste-baronien', 'liste-bn')
    ),
    revision = (SELECT revision + 1 FROM map_revision WHERE id = 1)
WHERE JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(properties_json), properties_json, '{}'),
                                '$.other_source.url')) LIKE '%liste-baronien%';


-- =====================================================================================
-- 5) SCHREIBEN: political_territory.wiki_url (nur falls Abschnitt 1 dort Treffer meldete).
--
--    ⚠️ Diese Spalte ist eigentlich fuer den Wiki-Aventurica-Artikel gedacht. Steht dort eine
--    herzogtum-weiden.net-Adresse, ist das der Fall "gueltige Quelle im falschen Feld", den
--    docs/konfliktmanagement-design.md §5 beschreibt (Verb "Umhaengen", Owner-Entscheid 20.07.2026:
--    solche Links gehoeren nach sources/feature_sources). Diese Datei repariert nur die Adresse und
--    laesst sie stehen, wo sie steht -- ein funktionierender Link im falschen Feld ist besser als ein
--    toter, und das Umhaengen ist eine eigene, redaktionelle Handlung im Konfliktzentrum.
-- =====================================================================================
UPDATE political_territory
SET wiki_url = REPLACE(wiki_url, 'liste-baronien', 'liste-bn')
WHERE wiki_url LIKE '%liste-baronien%';


-- =====================================================================================
-- 6) NICHT SCHREIBEN -- was bewusst ungeaendert bleibt:
--
--    * political_territory_wiki (und jede andere wiki_*-Tabelle): das ist der Spiegel des Wikis,
--      nicht unser Bestand. Der naechste Abgleich ueberschreibt eine Handkorrektur ohnehin wieder.
--    * map_reports / location_reports: eingereichte Meldungen sind ein PROTOKOLL dessen, was jemand
--      damals geschickt hat. Eine nachtraegliche Korrektur wuerde behaupten, die Person haette etwas
--      anderes eingereicht.
--    * link_status / link_ref: reine Messergebnisse des Linkcheckers, ueber url_hash verkettet.
--      Sie heilen sich selbst -- siehe Abschnitt 8c.
-- =====================================================================================


-- =====================================================================================
-- 7) SCHREIBEN: eine einzige Kartenrevision fuer die ganze Reparatur.
--
--    💣 Das ist nicht optional, sobald Abschnitt 3 etwas geaendert hat. Die Quellen reisen im Payload
--    von api/app/map-features.php mit (gemeinsamer source_catalog), aber der ETag wird aus
--    map_revision gebildet -- eine Aenderung an sources allein aendert ihn NICHT, und jeder Besucher
--    mit warmem Cache bekommt weiter ein 304 mit der toten Adresse darin.
--    Ein Bump fuer alles, nicht einer je Zeile, und keine Protokollzeilen: Dutzende Eintraege wuerden
--    die Historie der Editoren zuschuetten (Strg+Z laeuft das Protokoll abwaerts).
-- =====================================================================================
UPDATE map_revision SET revision = revision + 1 WHERE id = 1;


-- =====================================================================================
-- 8) BEWEIS -- und die Nacharbeit.
-- =====================================================================================

-- 8a) Das erzeugte SQL aus Abschnitt 1 noch einmal ausfuehren. Ausser den unter Abschnitt 6 bewusst
--     ausgenommenen Stellen MUSS ueberall treffer = 0 stehen.

-- 8b) Stichprobe: die Adressen muessen jetzt liste-bn tragen, und der Hash muss zur Adresse passen.
--     passt MUSS ueberall 1 sein -- eine 0 hiesse, dass Adresse und Identitaet auseinanderlaufen,
--     und dann findet der Dedup-Upsert die Quelle nie wieder und legt sie beim naechsten Speichern
--     ein zweites Mal an (avesmapsFeatureSourceUpsert hasht die Adresse ROH, ohne trim oder
--     Kleinschreibung -- deshalb passt SHA2(url, 256) hier exakt).
--     ⚠️ Diesen Vergleich NICHT auf alle sources ausweiten: eine Quelle OHNE Adresse leitet ihre
--     Identitaet aus 'wikipub:' + wiki_key ab und meldete dann faelschlich 0. Der WHERE-Filter auf
--     herzogtum-weiden.net haelt sie draussen.
SELECT id, url, (url_hash = SHA2(url, 256)) AS passt
FROM sources
WHERE url LIKE '%herzogtum-weiden.net%'
ORDER BY id;

-- 8c) Nacharbeit im Editor, nicht in SQL: den Linkchecker EINMAL vollstaendig laufen lassen (ohne
--     Einschraenkung auf einen Reiter). Erst der ungeteilte Lauf raeumt auf --
--     avesmapsLinkCheckPruneOrphans entfernt die link_status-Zeilen der alten 404er, und die neuen
--     Adressen werden frisch geprueft. Ein auf einen Reiter eingeschraenkter Lauf darf das NICHT tun
--     (siehe den Kommentar an der Funktion) und laesst die Leichen stehen.
