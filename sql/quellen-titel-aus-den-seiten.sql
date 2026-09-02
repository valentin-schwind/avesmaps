-- Die Titel der Belegstellen -- aus den Seiten gelesen, vom Owner am 02.09.2026 freigegeben.
--
-- Grundlage ist docs/quellen-mapping-tabelle.html: 133 Zeilen, jede Seite an diesem Tag wirklich
-- abgerufen. 🔴 Diese Datei schreibt GENAU DAS, was dort steht -- sie ruft nichts neu ab. Ein
-- zweiter Abruf koennte andere Titel liefern als die, die du gesehen und freigegeben hast, und
-- dann waere die Abnahme wertlos gewesen.
--
-- 117 Zeilen werden geaendert, 16 bleiben aussen vor (Begruendung je Zeile unten).
--
-- 💣 JEDES UPDATE PRUEFT DEN ALTEN TITEL MIT. Hat ihn jemand zwischenzeitlich von Hand
-- korrigiert, greift die Zeile nicht -- sie ueberschreibt die Handarbeit nicht. Die Gegenprobe
-- am Ende zeigt, wie viele wirklich gelaufen sind.
--
-- ⚠️ Der TITEL ist der Name DIESER SEITE. Der Name des Korpus ("Briefspiel (Weiden)",
-- "AlberniaWiki") ist etwas anderes und steht in `source_corpus` -- er wird hier NICHT gesetzt.
--
-- Ausfuehren: phpMyAdmin -> SQL, oder  mysql < sql/quellen-titel-aus-den-seiten.sql

-- Vorher ansehen (sollte 117 Zeilen liefern):
SELECT id, label FROM sources WHERE id IN (2, 53847, 53848, 53852, 53868, 107808, 107809, 107811, 107812, 107813, 107835, 107837, 107840, 107841, 107845, 107847, 107849, 107850, 107852, 107854, 161916, 161917, 161918, 273146, 381411, 381414, 381418, 381423, 381424, 381427, 381428, 381431, 381434, 588589, 711058, 711061, 711062, 887445, 887446, 887447, 887448, 887450, 887451, 887453, 887456, 956105, 956107, 956108, 956109, 956112, 956114, 956115, 956116, 956117, 956118, 956120, 956121, 956123, 956124, 956125, 956133, 956134, 956139, 956140, 956144, 956147, 1045782, 1045786, 1045787, 1045792, 1045793, 1045796, 1045800, 1045801, 1045802, 1045803, 1045804, 1045809, 1045811, 1045812, 1045819, 1045820, 1045824, 1045825, 1045830, 1045833, 1135282, 1135283, 1135284, 1224927, 1224928, 1224933, 1224934, 1314903, 1314904, 1314905, 1314906, 1314907, 1314908, 1314909, 1314910, 1314911, 1316297, 1316303, 1316304, 1316305, 1316309, 1318003, 1318004, 1318005, 1318006, 1318007, 1318010, 1325272, 1325295, 1325296, 1325297);


-- ══ westlande.de — 33 Zeilen  (die Seiten nennen sich „AlberniaWiki“)
UPDATE sources SET label = 'Falkenhain'
 WHERE id = 711058 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Greifenhorst'
 WHERE id = 711061 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Schloss Traviarim'
 WHERE id = 711062 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Beornfirn (Dorf)'
 WHERE id = 887445 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Sunderhof'
 WHERE id = 887446 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Grünengrund'
 WHERE id = 887447 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Bogenwacht (Dorf)'
 WHERE id = 887448 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Edlenherrschaft Kervenhir'
 WHERE id = 887451 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Orbatal (Gut)'
 WHERE id = 887453 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Moorburg'
 WHERE id = 956105 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Utengund (Dorf)'
 WHERE id = 956107 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Burg Utengund'
 WHERE id = 956108 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Gräflich Abagund'
 WHERE id = 956109 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Gräflich Abagund'
 WHERE id = 956112 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Tannwald'
 WHERE id = 956115 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Ailmswende (Dorf)'
 WHERE id = 956116 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Clachoven (Dorf)'
 WHERE id = 956117 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Nardesbroch (Dorf)'
 WHERE id = 956118 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Domhag (Dorf)'
 WHERE id = 956120 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Ritterherrschaft Finstertann'
 WHERE id = 956121 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Branfeld (Dorf)'
 WHERE id = 956123 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Ruthardt (Dorf)'
 WHERE id = 956124 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Datei : Tannwald IT.jpg'
 WHERE id = 956125 AND label = 'Albernisches Briefspiel';
UPDATE sources SET label = 'Datei : Baronie Hohenfels.jpg'
 WHERE id = 956133 AND label = '';   -- war leer
UPDATE sources SET label = 'Alvenhoven'
 WHERE id = 956134 AND label = '';   -- war leer
UPDATE sources SET label = 'Leinwig'
 WHERE id = 956139 AND label = '';   -- war leer
UPDATE sources SET label = 'Dornhag'
 WHERE id = 956140 AND label = '';   -- war leer
UPDATE sources SET label = 'Datei : Tannwald 1032.jpg'
 WHERE id = 956144 AND label = '';   -- war leer
UPDATE sources SET label = 'Meilersgrund'
 WHERE id = 1135284 AND label = '';   -- war leer
UPDATE sources SET label = 'Wehrhof Ibenwacht'
 WHERE id = 1224927 AND label = '';   -- war leer
UPDATE sources SET label = 'Turm Graustein'
 WHERE id = 1224928 AND label = '';   -- war leer
UPDATE sources SET label = 'Burg Meilerring'
 WHERE id = 1224933 AND label = '';   -- war leer
UPDATE sources SET label = 'Turm Hohenwacht'
 WHERE id = 1224934 AND label = '';   -- war leer

-- ══ herzogtum-weiden.net — 31 Zeilen
UPDATE sources SET label = 'Herzoglich Weiden'
 WHERE id = 2 AND label = 'Briefspiel';
UPDATE sources SET label = 'Gräflich Salthel'
 WHERE id = 53847 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Fuchshag'
 WHERE id = 53848 AND label = 'Briefspiel';
UPDATE sources SET label = 'Herzoglich Mauterndorf'
 WHERE id = 53852 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Hahnfels'
 WHERE id = 53868 AND label = '';   -- war leer
UPDATE sources SET label = 'Baronie Nordhag'
 WHERE id = 107808 AND label = '';   -- war leer
UPDATE sources SET label = 'Baronie Urkentrutz'
 WHERE id = 107809 AND label = 'Briefspiel';
UPDATE sources SET label = 'Pfalzgrafschaft Bibergau'
 WHERE id = 107812 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Zollhaus'
 WHERE id = 107841 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Östlingen'
 WHERE id = 107845 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Beonspfort'
 WHERE id = 107847 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Drachenstein'
 WHERE id = 107849 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Schwarzenstein'
 WHERE id = 107850 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Ingerimms Steg'
 WHERE id = 107852 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Uhdenwald'
 WHERE id = 107854 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Drachenstein'
 WHERE id = 161916 AND label = '';   -- war leer
UPDATE sources SET label = 'Herzoglich Waldleuen'
 WHERE id = 161917 AND label = '';   -- war leer
UPDATE sources SET label = 'Baronie Brachfelde'
 WHERE id = 161918 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Weidenhag'
 WHERE id = 273146 AND label = 'Briefspiel';
UPDATE sources SET label = 'Herzoglich Dornstein'
 WHERE id = 381423 AND label = 'Briefspiel';
UPDATE sources SET label = 'Gräflich Pallingen'
 WHERE id = 381424 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Mittenberge'
 WHERE id = 381427 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Adlerflug'
 WHERE id = 381431 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Schroffenfels'
 WHERE id = 381434 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Herzogenthal'
 WHERE id = 887450 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Rotenforst'
 WHERE id = 887456 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Hollerheide'
 WHERE id = 956147 AND label = 'Briefspiel';
UPDATE sources SET label = 'Kaiserlich Blaubinge'
 WHERE id = 1316303 AND label = 'Briefspiel';
UPDATE sources SET label = 'Hain der weißen Maid'
 WHERE id = 1316304 AND label = 'Briefspiel';
UPDATE sources SET label = 'Die Statue der Liebenden'
 WHERE id = 1316305 AND label = 'Briefspiel';
UPDATE sources SET label = 'Herzoglich Altentrallop'
 WHERE id = 1316309 AND label = 'Briefspiel (Weiden)';

-- ══ punin.de — 30 Zeilen  (die Seiten nennen sich „Almada Wiki“)
UPDATE sources SET label = 'Edlengut Deokrath'
 WHERE id = 107811 AND label = '';   -- war leer
UPDATE sources SET label = 'Baronie Taubental'
 WHERE id = 107835 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Junkergut Vivar'
 WHERE id = 107837 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Artésa'
 WHERE id = 107840 AND label = 'Briefspiel';
UPDATE sources SET label = 'Baronie Yasamir'
 WHERE id = 381411 AND label = 'Briefspiel';
UPDATE sources SET label = 'Gräflich Taladur'
 WHERE id = 381414 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Haffith'
 WHERE id = 381418 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Gräflich Thangolforst'
 WHERE id = 381428 AND label = 'Briefspiel';
UPDATE sources SET label = 'Castillo Wildenfest'
 WHERE id = 956114 AND label = 'wiki.punin.de - offizieller NSC';
UPDATE sources SET label = 'Baronie Bangour'
 WHERE id = 1045782 AND label = 'Almadawiki';
UPDATE sources SET label = 'Gräflich Taladur'
 WHERE id = 1045786 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Berggau Waldwacht'
 WHERE id = 1045787 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Jennbach'
 WHERE id = 1045792 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Flogglond'
 WHERE id = 1045793 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Rosenteich'
 WHERE id = 1045796 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Cres'
 WHERE id = 1045800 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Falado'
 WHERE id = 1045801 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Kaiserlich Selaque'
 WHERE id = 1045802 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Dubios'
 WHERE id = 1045803 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Schrotenstein'
 WHERE id = 1045804 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Mark Ragathsquell'
 WHERE id = 1045809 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Junkergut Alina'
 WHERE id = 1045811 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Königlich Kornhammer'
 WHERE id = 1045812 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Pfalzgrafschaft Geiersgau'
 WHERE id = 1045819 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Schelak'
 WHERE id = 1045820 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Pfalzgrafschaft Geiersgau'
 WHERE id = 1045824 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Brigellan'
 WHERE id = 1045825 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Culming'
 WHERE id = 1045830 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Inostal'
 WHERE id = 1045833 AND label = 'AlmadaWiki';
UPDATE sources SET label = 'Baronie Jurios'
 WHERE id = 1135283 AND label = 'AlmadaWiki';

-- ══ kahet-ni-kemi.de — 15 Zeilen  (die Seiten nennen sich „Káhet Ni Kemi“)
UPDATE sources SET label = 'Sssrah'
 WHERE id = 1314903 AND label = 'Briefspiel Káhet Ni Kemi';
UPDATE sources SET label = 'Tá\'akîb Câbas'
 WHERE id = 1314904 AND label = 'Briefspiel Káhet Ni Kemi';
UPDATE sources SET label = 'Tá\'akîb Irakema'
 WHERE id = 1314905 AND label = 'Briefspiel Kâhet Ni Kemi';
UPDATE sources SET label = 'Tá\'akîb Dju\'imen'
 WHERE id = 1314906 AND label = 'Briefspiel Kâhet Ni Kemi';
UPDATE sources SET label = 'Djerbyun Ujak'
 WHERE id = 1314907 AND label = 'Briefspiel Kâhet Ni Kemi';
UPDATE sources SET label = 'Tánedjeset Ynbeth'
 WHERE id = 1314908 AND label = 'Briefspiel Kâhet Ni Kemi';
UPDATE sources SET label = 'Tánedjeset Sendsh\'gerhi'
 WHERE id = 1314909 AND label = 'Briefspiel Kâhet Ni Kemi';
UPDATE sources SET label = 'Tá\'akîb Mergyan'
 WHERE id = 1314910 AND label = 'Briefspiel Kâhet Ni Kemi';
UPDATE sources SET label = 'Tá\'akîb Seku Kesen'
 WHERE id = 1314911 AND label = 'Briefspiel Kâhet Ni Kemi';
UPDATE sources SET label = 'Tá\'akîb Semjet Jábet'
 WHERE id = 1318003 AND label = 'Briefspiel Káhet Ni Kemi';
UPDATE sources SET label = 'Tá\'akîb Ahami Táheken'
 WHERE id = 1318004 AND label = 'Briefspiel Káhet Ni Kemi';
UPDATE sources SET label = 'Tá\'akîb Táîmen'
 WHERE id = 1318005 AND label = 'Briefspiel Káhet Ni Kemi';
UPDATE sources SET label = 'Tá\'akîbet Anûr'
 WHERE id = 1318006 AND label = 'Briefspiel Káhet Ni Kemi';
UPDATE sources SET label = 'Tá\'akîb Djerniako'
 WHERE id = 1318007 AND label = 'Briefspiel Káhet Ni Kemi';
UPDATE sources SET label = 'Djerbyun Schattenspin'
 WHERE id = 1318010 AND label = 'Briefspiel Káhet Ni Kemi';

-- ══ garetien.de — 5 Zeilen
UPDATE sources SET label = 'Garetien : Dorf Sellach'
 WHERE id = 1316297 AND label = 'https://www.garetien.de/index.php?title=Garetien:Dorf_Sellach';
UPDATE sources SET label = 'Garetien : Burg Gryffenwacht'
 WHERE id = 1325272 AND label = 'Burg Gryffenwacht auf garetien.de';
UPDATE sources SET label = 'Garetien : Hügel und Berge im Schlund'
 WHERE id = 1325295 AND label = 'Hügel und Berge im Schlund auf garetien.de';
UPDATE sources SET label = 'Garetien : Esenfelder Höhen'
 WHERE id = 1325296 AND label = 'Esenfelder Höhen auf garetien.de';
UPDATE sources SET label = 'Perricum : Firuns Thron'
 WHERE id = 1325297 AND label = 'Firuns Thron auf garetien.de';

-- ══ horaswiki.de — 2 Zeilen  (die Seiten nennen sich „Liebliches-Feld.net“)
UPDATE sources SET label = 'Irendor'
 WHERE id = 107813 AND label = 'Irendor-Beschreibung im Briefspiel';
UPDATE sources SET label = 'Feste Gugellabrück'
 WHERE id = 1135282 AND label = 'Briefspiel Liebliches Feld';

-- ══ liebliches-feld.net — 1 Zeilen
UPDATE sources SET label = 'Datei : Ponterra detailliert.jpg'
 WHERE id = 588589 AND label = 'Briefspiel Liebliches Feld';

-- ── Bewusst NICHT angefasst ──────────────────────────────────────────────────────────────
--   garetien.de · Briefspiel (Garetien)  ->  Startseite -- "Hauptseite" sagt weniger als heute
--   garetien.de · Retokuppe auf garetien.de  ->  HTTP 404
--   herzogtum-weiden.net · Briefspiel  ->  keine Ueberschrift (HTTP 200)
--   herzogtum-weiden.net · Herzogenstadt Trallop  ->  steht schon richtig
--   horaswiki.de · Der Preis der Macht  ->  steht schon richtig
--   kahet-ni-kemi.de · Briefspiel Káhet Ni Kemi  ->  Anker -- die Sprungmarke ist genauer
--   punin.de · Briefspiel  ->  Startseite -- "Hauptseite" sagt weniger als heute
--   punin.de · Briefspiel  ->  Startseite -- "Hauptseite" sagt weniger als heute
--   punin.de · Briefspiel  ->  Anker -- die Sprungmarke ist genauer
--   rommilyser-mark.de · Briefspiel Rommilyser Mark  ->  keine Ueberschrift (HTTP 200)
--   westlande.de · Albernisches Briefspiel  ->  Anker -- die Sprungmarke ist genauer
--   westlande.de · Albernisches Briefspiel  ->  Anker -- die Sprungmarke ist genauer
--   westlande.de · Albernisches Briefspiel  ->  Anker -- die Sprungmarke ist genauer
--   westlande.de · Albernisches Briefspiel  ->  Anker -- die Sprungmarke ist genauer
--   westlande.de · Albernia Wiki  ->  keine Ueberschrift (HTTP 200)
--   westlande.de · Apfeldorn  ->  steht schon richtig

-- Gegenprobe: sollte 0 Zeilen liefern (alle alten Titel sind weg).
SELECT id, label FROM sources WHERE id IN (2, 53847, 53848, 53852, 53868, 107808, 107809, 107811, 107812, 107813, 107835, 107837, 107840, 107841, 107845, 107847, 107849, 107850, 107852, 107854, 161916, 161917, 161918, 273146, 381411, 381414, 381418, 381423, 381424, 381427, 381428, 381431, 381434, 588589, 711058, 711061, 711062, 887445, 887446, 887447, 887448, 887450, 887451, 887453, 887456, 956105, 956107, 956108, 956109, 956112, 956114, 956115, 956116, 956117, 956118, 956120, 956121, 956123, 956124, 956125, 956133, 956134, 956139, 956140, 956144, 956147, 1045782, 1045786, 1045787, 1045792, 1045793, 1045796, 1045800, 1045801, 1045802, 1045803, 1045804, 1045809, 1045811, 1045812, 1045819, 1045820, 1045824, 1045825, 1045830, 1045833, 1135282, 1135283, 1135284, 1224927, 1224928, 1224933, 1224934, 1314903, 1314904, 1314905, 1314906, 1314907, 1314908, 1314909, 1314910, 1314911, 1316297, 1316303, 1316304, 1316305, 1316309, 1318003, 1318004, 1318005, 1318006, 1318007, 1318010, 1325272, 1325295, 1325296, 1325297)
   AND label IN ('Briefspiel', 'Irendor-Beschreibung im Briefspiel', 'AlmadaWiki', 'Briefspiel Liebliches Feld', 'Albernisches Briefspiel', 'wiki.punin.de - offizieller NSC', 'Almadawiki', 'Briefspiel Káhet Ni Kemi', 'Briefspiel Kâhet Ni Kemi', 'https://www.garetien.de/index.php?title=Garetien:Dorf_Sellach', 'Briefspiel (Weiden)', 'Burg Gryffenwacht auf garetien.de', 'Hügel und Berge im Schlund auf garetien.de', 'Esenfelder Höhen auf garetien.de', 'Firuns Thron auf garetien.de');

-- 💣 UND DANN DEN KARTENSTEMPEL. Die Titel reisen im `source_catalog` der ETag-zwischen-
-- gespeicherten map-features-Nutzlast, und deren ETag haengt allein an `map_revision`. Ohne
-- diesen Schritt bekommt jeder warme Browser sein 304 und zeigt die alten Titel unbegrenzt
-- weiter -- dieselbe Falle, die die Klimaebene und der Wappen-Notaus schon bezahlt haben.
INSERT INTO map_revision (id, revision) VALUES (1, 2)
  ON DUPLICATE KEY UPDATE revision = revision + 1;
