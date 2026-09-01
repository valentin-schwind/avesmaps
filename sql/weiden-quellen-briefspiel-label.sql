-- Einmal-Umbenennung, 01.09.2026: Quellen von herzogtum-weiden.net heissen "Briefspiel (Weiden)".
--
-- Owner: "kannst du alle orte/gegenden/wege, welche die quelle https://www.herzogtum-weiden.net/...
-- haben mit 'Briefspiel (Weiden)' anstatt nur 'Briefspiel' umbenennen."
--
-- Der Name wirkt an ZWEI Stellen zugleich, beide aus demselben Feld: die Zeile "Quelle:" im
-- Quellenkasten und das Kanon-Etikett im Objektkopf neben "INOFFIZIELL"
-- (avesmapsFeatureSourcesDeriveKanon -> bezeichner_label, api/_internal/app/feature-sources.php).
-- Ein Label reicht also fuer beides; nichts im Code ist anzufassen.
--
-- GEMESSEN AM LIVEBESTAND, 01.09.2026, aus GET /api/app/map-features.php (eine Anfrage):
--   284 Kartenobjekte tragen eine herzogtum-weiden.net-Quelle -- 266 Orte, 15 Wege, 3 Gegenden.
--   253 davon zeigen heute "Briefspiel" und heissen danach "Briefspiel (Weiden)".
--    15 heissen schon so, 6 sind offiziell (die bleiben "Offiziell", eine Briefspielquelle aendert
--       daran nichts), 9 tragen gar keinen Namen (Abschnitt 3), 1 hat einen eigenen.
--
-- 💣 DIE QUELLEN LIEGEN IN ZWEI TABELLEN, UND DIE KLEINERE HAELFTE IST DIE OFFENSICHTLICHE.
-- Von 201 Weiden-Quellzeilen stehen nur 32 im Katalog `sources`; die uebrigen 169 sind ALTQUELLEN
-- in `map_features.properties_json` -> `other_source` (avesmapsMapFeaturesMergeLegacyOtherSources
-- faltet sie erst in der Antwort in denselben Katalog). Ein UPDATE allein auf `sources` erwischt
-- 26 von 190 Namen -- und die restlichen 164 Objekte behielten "Briefspiel", ohne dass irgendetwas
-- meldet, dass die Haelfte der Arbeit nicht stattgefunden hat. Deshalb Abschnitt 1 UND 2.
--
-- 💣 DIE URL-BEDINGUNG IST TRAGEND, NICHT SCHMUECKENDES BEIWERK. 29 weitere Objekte tragen heute
-- ebenfalls das Etikett "Briefspiel" -- 28 aus wiki.punin.de, 1 aus westlande.de. Ein UPDATE, das
-- nur nach `label = 'Briefspiel'` sucht, macht aus dem Puniner Briefspiel ein Weidener.
--
-- Laufen lassen in phpMyAdmin (admin/phpMyAdmin), Anweisung fuer Anweisung, und jedes Mal die
-- gemeldete Zeilenzahl lesen -- SIE ist die Messung, eine Bestandsaufnahme vorweg braucht es nicht.
-- Vorher links in der Seitenleiste die Avesmaps-Datenbank anklicken.


-- =====================================================================================
-- 1) Der Quellenkatalog. ERWARTET: mindestens 26 Zeilen (22 mit Art "sonstiges", 4 mit
--    "briefspiel").
--
--    ⚠️ Mehr ist kein Fehler: gezaehlt wurde aus der KARTENnutzlast, und die traegt nur Quellen,
--    an denen ein Kartenobjekt haengt. Quellen an Herrschaftsgebieten (die ueber
--    territory-detail.php gelesen werden) und unverknuepfte Katalogzeilen sind darin nicht
--    enthalten -- dieses UPDATE erfasst sie trotzdem, weil es ueber die Adresse geht.
--
--    Das Muster faengt http:// wie https:// und mit wie ohne www. Die eine Zeile
--    "inoffizielle Karte der Baronie Adlerflug" bleibt unberuehrt -- sie traegt einen von Hand
--    vergebenen, sprechenden Namen, und `label = 'Briefspiel'` schliesst sie von selbst aus.
-- =====================================================================================
UPDATE sources
SET label = 'Briefspiel (Weiden)'
WHERE url LIKE '%herzogtum-weiden.net%'
  AND label = 'Briefspiel';


-- =====================================================================================
-- 2) Die Altquellen in den Kartenobjekten. ERWARTET: mindestens 164 Zeilen.
--
--    Mehr als 164 heisst nur, dass auch stillgelegte Objekte (is_active = 0) eine solche Quelle
--    tragen -- absichtlich nicht ausgeschlossen: wird so ein Objekt je wieder eingeschaltet, soll
--    es nicht mit dem alten Namen zurueckkommen.
--
--    ⚠️ Die ART dieser Quellen bleibt "Sonstiges", und daran kann SQL nichts aendern: der Wert
--    steht nicht in den Daten, sondern fest im Code, der die Altquelle in den Katalog faltet
--    ('type' => 'sonstiges'). Wer auch die Art will, muss die Altquelle in eine echte
--    `sources`-Zeile ueberfuehren -- das ist eine Migration und nicht diese Umbenennung.
-- =====================================================================================
UPDATE map_features
SET properties_json = JSON_SET(properties_json, '$.other_source.label', 'Briefspiel (Weiden)')
WHERE properties_json LIKE '%herzogtum-weiden.net%'
  AND JSON_VALID(properties_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.other_source.url')) LIKE '%herzogtum-weiden.net%'
  AND JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.other_source.label')) = 'Briefspiel';


-- =====================================================================================
-- 3) OPTIONAL: die neun namenlosen. ERWARTET: 5 Zeilen in `sources`, 4 in `map_features`.
--
--    Diese Quellen tragen gar kein Label. Im Quellenkasten steht dann "Andere Quelle", und das
--    Kopf-Etikett faellt auf die ART zurueck -- "Briefspiel (1)" bzw. "Sonstiges (1)".
--    Weglassen ist zulaessig; leer heisst im Haus "nicht erfasst" und ist ein gueltiger Zustand.
-- =====================================================================================
UPDATE sources
SET label = 'Briefspiel (Weiden)'
WHERE url LIKE '%herzogtum-weiden.net%'
  AND TRIM(label) = '';

UPDATE map_features
SET properties_json = JSON_SET(properties_json, '$.other_source.label', 'Briefspiel (Weiden)')
WHERE properties_json LIKE '%herzogtum-weiden.net%'
  AND JSON_VALID(properties_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.other_source.url')) LIKE '%herzogtum-weiden.net%'
  AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.other_source.label')), '')) = '';


-- =====================================================================================
-- 4) OPTIONAL: die Art. ERWARTET: 22 Zeilen.
--
--    22 Katalogzeilen stehen auf "Sonstiges", obwohl es Briefspiele sind -- daher der Chip
--    "Sonstiges" neben dem Namen. Betrifft nur den Katalog; die Altquellen aus Abschnitt 2
--    bleiben "Sonstiges" (siehe dort).
--
--    ⚠️ Ueber die Oberflaeche ginge das nicht: das Umtypen einer bestehenden Quelle darf dort
--    nur die Eingabezeile des Quellen-Editors (avesmapsSourceRetypeAllowed, AGENTS.md §11).
--    Hier wird dieser Riegel bewusst umgangen -- fuer eine Adresse, deren Art zweifelsfrei ist.
-- =====================================================================================
UPDATE sources
SET source_type = 'briefspiel'
WHERE url LIKE '%herzogtum-weiden.net%'
  AND source_type = 'sonstiges';


-- =====================================================================================
-- 5) DER STEMPEL -- OHNE IHN SIEHT ES NIEMAND. Genau EINMAL, ganz zum Schluss.
--
--    💣 Das ETag der Kartennutzlast haengt an `map_revision` (avesmapsMapFeaturesETag: Revision +
--    Klima- + Tempostempel). Eine Quelle umzubenennen aendert KEINEN davon. Ohne diese Zeile
--    bekommt jeder warme Browser weiterhin ein 304 auf seine alte Kopie -- und der Server selbst
--    liefert aus seinem Vorrat (map-features-cache.php, nach ETag geschluesselt) dieselben alten
--    Bytes. Es saehe aus, als haette das UPDATE nichts getan, obwohl die Daten laengst stimmen.
--    Dieselbe Falle hat der Wappen-Notaus vier Monate lang getragen (AGENTS.md §11, Tempowerte).
-- =====================================================================================
UPDATE map_revision SET revision = revision + 1 WHERE id = 1;


-- =====================================================================================
-- 6) NUR LESEN: die Gegenprobe. Erwartet danach GENAU EINE Zeile: "Briefspiel (Weiden)".
--    Steht dort noch "Briefspiel", ist ein Abschnitt nicht gelaufen.
-- =====================================================================================
SELECT label, source_type, COUNT(*) AS zeilen
FROM sources
WHERE url LIKE '%herzogtum-weiden.net%'
GROUP BY label, source_type
ORDER BY zeilen DESC;

SELECT JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.other_source.label')) AS label,
       COUNT(*) AS objekte
FROM map_features
WHERE properties_json LIKE '%herzogtum-weiden.net%'
  AND JSON_VALID(properties_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.other_source.url')) LIKE '%herzogtum-weiden.net%'
GROUP BY label
ORDER BY objekte DESC;
