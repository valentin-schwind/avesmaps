-- A36 · Wie viele abgeleitete Objekte nehmen den Wiki-Zweig des Sammlers?
--
-- NUR LESEND. Keine Schreibvorgaenge, keine Tabellenaenderung, kein Massenlauf.
-- In phpMyAdmin ausfuehren und die Zahl aus Abfrage 1 melden.
--
-- WARUM DIE ZAHL ENTSCHEIDET: A20 hat den abgeleiteten Politik-Layer von 242 Abfragen je
-- Cache-Fehlschlag auf 2 gebracht. Was blieb, ist der Sammler: er laeuft weiter EINMAL JE OBJEKT,
-- und wo er auf `derived_wiki_id` zurueckfaellt, stellt er zwei weitere Abfragen
-- (avesmapsPoliticalFetchWikiById + die namensgleiche Nachfahren-Abfrage).
--
-- Aus dem oeffentlichen Kartenstand liess sich das nur EINGRENZEN, nicht bestimmen: 121 abgeleitete
-- Objekte, davon 109 mit einer Quellliste, die nach Zweig 1 aussieht, 12 nach Rueckfall. Bei 10 der
-- 12 ist eine `derived_wiki_id` gesetzt, der Wiki-Zweig lief dort also -- das sind 20 Abfragen.
-- Nach oben ist die Grenze aber 88 Objekte (176 Abfragen), weil ein Wiki-Treffer, der zufaellig das
-- eigene Territorium enthaelt, von aussen nicht von Zweig 1 zu unterscheiden ist. Der Payload kann
-- das nicht schaerfen: der Sammler arbeitet auf ALLEN aktiven Territorien, der Payload ist ein
-- Ausschnitt eines Zoombands.
--
-- 💣 Die Spanne ist der Punkt. Bei 20 ist A36 ein Rundungsfehler und nicht die Arbeit wert -- eine
-- Buendelung muesste ueber zwei weitere geteilte Dateien gehen (territories-read.php und
-- territories-derived-geometry.php), und die namensgleiche Abfrage muesste zusaetzlich den
-- getroffenen NAMEN zurueckgeben, damit sich die Treffer wieder den Objekten zuordnen lassen.
-- Bei 176 ist der Rest fast so gross wie das, was A20 entfernt hat, und die Arbeit lohnt sofort.

-- 1) Die Zahl, um die es geht: abgeleitete Objekte, deren Territorium KEINE aktiven Kinder hat
--    (dann liefert Zweig 1 nichts) und die eine wiki_id tragen (dann laeuft Zweig 2).
SELECT COUNT(*) AS objekte_mit_wiki_zweig,
       COUNT(*) * 2 AS zusaetzliche_abfragen_je_layer_aufbau
FROM political_territory_derived_geometry derived
INNER JOIN political_territory territory ON territory.id = derived.territory_id
WHERE derived.is_active = 1
  AND territory.is_active = 1
  AND territory.continent = 'Aventurien'
  AND territory.wiki_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM political_territory child
      WHERE child.parent_id = territory.id
        AND child.is_active = 1
        AND child.continent = 'Aventurien'
  );

-- 2) Zum Vergleich: wie viele abgeleitete Objekte es ueberhaupt gibt. Die Verhaeltniszahl sagt,
--    ob sich eine Buendelung lohnt.
SELECT COUNT(*) AS abgeleitete_objekte_gesamt
FROM political_territory_derived_geometry derived
INNER JOIN political_territory territory ON territory.id = derived.territory_id
WHERE derived.is_active = 1
  AND territory.is_active = 1
  AND territory.continent = 'Aventurien';

-- 3) ⚠️ Gegenprobe zur Vollstaendigkeit: Objekte OHNE Kinder und OHNE wiki_id. Bei denen laeuft
--    Zweig 2 gar nicht, sie fallen direkt auf das eigene Territorium zurueck und kosten nichts.
--    Aus dem Kartenstand waren das 2 -- stimmt die Zahl hier ungefaehr, passt das Modell.
SELECT COUNT(*) AS objekte_ohne_kinder_ohne_wiki
FROM political_territory_derived_geometry derived
INNER JOIN political_territory territory ON territory.id = derived.territory_id
WHERE derived.is_active = 1
  AND territory.is_active = 1
  AND territory.continent = 'Aventurien'
  AND territory.wiki_id IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM political_territory child
      WHERE child.parent_id = territory.id
        AND child.is_active = 1
        AND child.continent = 'Aventurien'
  );
