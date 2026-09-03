-- Einmal-Lauf, 03.09.2026: die ART aller Quellen von herzogtum-weiden.net wird "Briefspiel".
--
-- Owner: "kannst du die quellen bzw. den korpus von quellen, welche herzogtum-weiden.net in ihrer
-- URL haben alle zu 'Briefspiel' machen?" (mit Bild: Beilstett, Chip "INOFFIZIELL | Sonstiges"
-- sowohl im Objektkopf als auch im Quellenkasten).
--
-- Beide Chips im Bild kommen aus DEMSELBEN Feld -- `sources.source_type` der EINEN verknuepften
-- Zeile (Beilstett haengt an Katalogzeile 107847, "Baronie Beonspfort", heute `sonstiges`). Ein
-- UPDATE auf dieses Feld raeumt also beide Pfeile weg; im Code ist nichts anzufassen.
--
-- GEMESSEN AM LIVEBESTAND, 03.09.2026, aus EINER Anfrage an GET /api/app/map-features.php:
--   44 Katalogzeilen mit herzogtum-weiden.net -- 32 "sonstiges", 12 "briefspiel", 0 offiziell.
--   286 Kartenobjekte haengen daran: 267 Orte, 15 Wege, 4 Landschaftsflaechen.
--   Hosts: 40x www.herzogtum-weiden.net, 4x herzogtum-weiden.net. Alle 44 mit https und Schema.
--
-- ⚠️ Mehr als 44 ist KEIN Fehler: gezaehlt wurde aus der Kartennutzlast, und die traegt nur
-- Quellen, an denen ein Kartenobjekt haengt. Quellen an Herrschaftsgebieten (die ueber
-- territory-detail.php gelesen werden) und unverknuepfte Katalogzeilen fehlen darin -- dieser Lauf
-- erfasst sie trotzdem, weil er ueber die Adresse geht.
--
-- ✅ ANDERS ALS AM 01.09.2026 GIBT ES NUR NOCH EINE TABELLE. Damals lagen 169 der 201
-- Weiden-Quellen als ALTQUELLEN in `map_features.properties_json` -> `other_source`, und ein
-- UPDATE allein auf `sources` erwischte 26 von 190 Namen (sql/weiden-quellen-briefspiel-label.sql).
-- Der Sammel-Takeover vom 03.09.2026 hat sie in den Katalog geholt (`remaining 0`), der
-- `os:`-Erzeuger ist gefallen -- nachgeprueft: in der heutigen Nutzlast ist KEIN Katalogschluessel
-- mehr nicht-numerisch, also keine Altquelle mehr. Abschnitt 2 der alten Datei entfaellt ersatzlos.
--
-- Laufen lassen in phpMyAdmin (admin/phpMyAdmin), Anweisung fuer Anweisung, und jedes Mal die
-- gemeldete Zeilenzahl lesen -- SIE ist die Messung. Vorher links die Avesmaps-Datenbank anklicken.


-- =====================================================================================
-- 0) NUR LESEN: die Bestandsaufnahme. Sie beantwortet die drei Fragen, die dieser Lauf
--    nicht raten darf -- und kostet nichts.
--
--    💣 DIE ZWEITE SPALTE IST DER GRUND, WARUM ES DIESEN ABSCHNITT GIBT. Abschnitt 2 fasst die
--    Adresse ANGEHEFTET an (`LIKE 'https://www.herzogtum-weiden.net%'`), nicht als `%...%`
--    mittendrin: ein `%herzogtum-weiden.net%` traefe auch eine fremde Adresse, die den Namen bloss
--    im Pfad fuehrt (`fremd.example/artikel/herzogtum-weiden.net`), und waere eine ZWEITE Fassung
--    der Korpusregel (avesmapsSourceCorpusKey) -- genau die Divergenz, die dieses Haus schon
--    mehrfach bezahlt hat. Der Preis der engen Fassung: eine SUBDOMAIN (`wiki.herzogtum-weiden.net`)
--    faellt heraus, obwohl der Korpus sie einschliesst. Deshalb wird hier GEZAEHLT:
--    `abgedeckt` und `zeilen` muessen dieselbe Zahl ergeben. Tun sie es nicht, steht in der
--    Differenz eine Schreibweise, die Abschnitt 2 nicht sieht -- dann erst nachfragen.
--
--    ⚠️ `eigen` und `ohne_korpus` sind die zwei ausdruecklichen Ausnahmen des Hauses
--    (`sources.own_fields`, `sources.no_corpus`, beide seit 02.09.2026): eine Quelle, deren Art
--    ein Editor als EIGEN erklaert hat, und eine, die ausdruecklich zu keinem Korpus gehoert.
--    Der Korpus-Durchschrieb ueberspringt beide, und Abschnitt 2 tut es auch. Stehen dort 0/0
--    -- was zu erwarten ist, die Felder sind einen Tag alt --, trifft der Lauf wirklich ALLE.
--
--    🪤 Beide Spalten entstehen per selbstheilender DDL (avesmapsEnsureFeatureSourceTables,
--    api/_internal/app/feature-sources.php:187/195) und sind von aussen nicht nachweisbar -- die
--    oeffentliche Nutzlast liest sie nicht. Meldet phpMyAdmin hier "Unknown column 'own_fields'",
--    ist die DDL auf diesem Server noch nicht gelaufen: dann in Abschnitt 0 und 2 die beiden
--    Zeilen mit `own_fields` und `no_corpus` streichen. Es gibt dann auch nichts zu verschonen.
-- =====================================================================================
SELECT COUNT(*)                                                        AS zeilen,
       SUM(url LIKE 'https://herzogtum-weiden.net%'
        OR url LIKE 'https://www.herzogtum-weiden.net%'
        OR url LIKE 'http://herzogtum-weiden.net%'
        OR url LIKE 'http://www.herzogtum-weiden.net%'
        OR url LIKE 'herzogtum-weiden.net%'
        OR url LIKE 'www.herzogtum-weiden.net%')                       AS abgedeckt,
       SUM(source_type = 'sonstiges')                                  AS art_sonstiges,
       SUM(source_type = 'briefspiel')                                 AS art_briefspiel,
       SUM(source_type NOT IN ('sonstiges', 'briefspiel'))             AS art_andere,
       SUM(own_fields LIKE '%,source_type,%')                          AS eigen,
       SUM(no_corpus = 1)                                              AS ohne_korpus
FROM sources
WHERE url LIKE '%herzogtum-weiden.net%';


-- =====================================================================================
-- 1) DER KORPUS. ERWARTET: 0 oder 1 Zeile -- beides ist richtig.
--
--    0 heisst: er stand schon auf "briefspiel" (sql/quellen-korpora-anlegen.sql setzt ihn so).
--    1 heisst: er stand auf etwas anderem und steht jetzt richtig.
--
--    🔴 ER GEHOERT DAZU, AUCH WENN ER SCHON STIMMT. Der Korpus ist die Vorgabe fuer JEDE kuenftige
--    Quelle dieses Wirts (avesmapsFeatureSourceKorpusVorgaben) -- ohne ihn kaeme die naechste
--    Weiden-Quelle wieder als "Sonstiges" herein, und derselbe Lauf waere in vier Wochen faellig.
--
--    💣 UND DIESES UPDATE SCHREIBT NICHT DURCH. Das tut nur `avesmapsSourceCorpusSave` (der
--    Editor); reines SQL setzt die Korpuszeile und sonst nichts -- deshalb gibt es Abschnitt 2.
--    Genau davor warnt auch sql/quellen-korpora-anlegen.sql am Ende.
-- =====================================================================================
UPDATE source_corpus
SET source_type = 'briefspiel'
WHERE corpus_key = 'herzogtum-weiden.net'
  AND source_type <> 'briefspiel';


-- =====================================================================================
-- 2) DIE QUELLEN. ERWARTET: 32 Zeilen -- die aus Abschnitt 0 gelesene Zahl `art_sonstiges`
--    (plus `art_andere`, vermindert um `eigen` und `ohne_korpus`); moeglicherweise mehr,
--    siehe die Anmerkung zu den Herrschaftsgebieten oben.
--
--    ⚠️ `source_type <> 'briefspiel'` statt `= 'sonstiges'`: sollte in Abschnitt 0 `art_andere`
--    nicht 0 sein, ist auch das eine Nicht-Aussage dieses Wirts und gehoert mit. Steht dort 0,
--    ist die Bedingung wirkungsgleich mit der alten Fassung.
--
--    ⚠️ Ueber die Oberflaeche ginge das so nicht: das Umtypen einer BESTEHENDEN Katalogzeile darf
--    dort nur die Eingabezeile des Quellen-Editors (avesmapsSourceRetypeAllowed, AGENTS.md §11)
--    -- oder eben der Korpus, und der ruehrt sich nur bei einer ECHTEN Aenderung seines Feldes.
--    Steht der Korpus laengst auf "briefspiel", hat der Editor keinen Griff mehr: das Auswahlfeld
--    zeigt bereits Briefspiel, `speichereKorpusFeld` sieht `jetzt === vorher` und schickt nichts.
--    Hier wird dieser Riegel bewusst umgangen -- fuer einen Wirt, dessen Art zweifelsfrei ist.
-- =====================================================================================
UPDATE sources
SET source_type = 'briefspiel'
WHERE (   url LIKE 'https://herzogtum-weiden.net%'
       OR url LIKE 'https://www.herzogtum-weiden.net%'
       OR url LIKE 'http://herzogtum-weiden.net%'
       OR url LIKE 'http://www.herzogtum-weiden.net%'
       OR url LIKE 'herzogtum-weiden.net%'
       OR url LIKE 'www.herzogtum-weiden.net%')
  AND source_type <> 'briefspiel'
  AND own_fields NOT LIKE '%,source_type,%'
  AND no_corpus = 0;


-- =====================================================================================
-- 3) DER STEMPEL -- OHNE IHN SIEHT ES NIEMAND. Genau EINMAL, ganz zum Schluss.
--
--    💣 Das ETag der Kartennutzlast haengt an `map_revision` (avesmapsMapFeaturesETag: Revision +
--    Klima- + Tempostempel). Die Art einer Quelle zu aendern ruehrt keinen davon. Ohne diese Zeile
--    bekommt jeder warme Browser weiter ein 304 auf seine alte Kopie -- und seit dem 27.08.2026
--    liegt die Nutzlast zusaetzlich im IndexedDB des Besuchers (js/app/kartendaten-speicher.js),
--    der Chip bliebe also selbst nach einem Neuladen "Sonstiges". Es saehe aus, als haette das
--    UPDATE nichts getan, obwohl die Daten laengst stimmen. Dieselbe Falle hat der Wappen-Notaus
--    vier Monate lang getragen (AGENTS.md §10/§11).
-- =====================================================================================
UPDATE map_revision SET revision = revision + 1 WHERE id = 1;


-- =====================================================================================
-- 4) NUR LESEN: die Gegenprobe. ERWARTET danach GENAU EINE Zeile: briefspiel, 44 (oder mehr).
--    Steht dort noch "sonstiges", ist Abschnitt 2 nicht gelaufen -- oder die Zeile traegt eine
--    der zwei ausdruecklichen Ausnahmen aus Abschnitt 0, und dann ist sie so gewollt.
-- =====================================================================================
SELECT source_type, COUNT(*) AS zeilen
FROM sources
WHERE url LIKE '%herzogtum-weiden.net%'
GROUP BY source_type
ORDER BY zeilen DESC;

SELECT corpus_key, label, form, source_type
FROM source_corpus
WHERE corpus_key = 'herzogtum-weiden.net';
