<?php

declare(strict_types=1);

// Der eigene Wiki-Artikel eines importierten Objekts als ZWEITE Quelle.
//
// Owner 31.08.2026, nachdem er beim Import von Praioslob zufaellig
// https://www.garetien.de/index.php/Garetien:Stadt_Praioslob gefunden hatte: „ist es möglich
// rauszufinden, ob die objekte, die wir importieren so einen eintrag haben - und wenn ja kann man
// den artikel dann als zusätzliche quelle angeben? 'Stadt Praioslob auf garetien.de' (Link)".
//
// 🔴 DIE ANTWORT WAR: WIR HABEN ES LAENGST. Der Kopf einer Exportzeile hat die Form
// `Typ:[Namensraum:]Artikel!Anzeige`, der Parser zerlegt sie seit der ersten Fassung, und
// `garetien_import_row` traegt `namensraum`/`artikel` als eigene Spalten. Es braucht keine Abfrage
// bei garetien.de -- was fehlte, war die Adresse und die Quelle daraus.
//
// 🔴 DREI ADRESSEN AUS DERSELBEN ZEILE, und ihre Verwechslung ist der Fehler, der hier mit
// repariert wird:
//   · der WIRT            `https://www.garetien.de`                  -- die zitierte Sammelquelle
//   · die ARBEITSSEITE    `…/Avesmaps_<Ebene>`                       -- woher die Zeile stammt
//   · der ARTIKEL         `…/index.php/<Namensraum:Artikel>`         -- die eigene Seite des Objekts
// Bis zum 31.08.2026 baute die Arbeitsseite `…/Avesmaps_<ARTIKELNAME>` -- eine Seite, die es nicht
// gibt. Live gemessen an diesem Tag: 404 gegen 200 fuer die Ebenenform.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 \
//           api/_internal/import/__tests__/garetien-artikel-quelle-test.php

require_once __DIR__ . '/../garetien-plan.php';

$pruefungen = 0;

// =================================================================================================
// 1. Die Artikeladresse -- die GEMESSENE Form
// =================================================================================================
assert(
    avesmapsGaretienArtikelUrlAus('ggp', 'Garetien:Stadt Praioslob')
        === 'https://www.garetien.de/index.php/Garetien:Stadt_Praioslob',
    'genau die Adresse, die der Owner gefunden hat'
);
$pruefungen++;

// 💣 DER DOPPELPUNKT BLEIBT STEHEN. Er trennt den Namensraum und ist Struktur, kein Inhalt --
// `rawurlencode` macht daraus `%3A`, und MediaWiki liest den Titel dann als einen einzigen Namen
// im Hauptnamensraum. Der Schraegstrich (Unterseiten) ebenso.
assert(!str_contains(avesmapsGaretienArtikelUrlAus('ggp', 'Garetien:Stadt Praioslob'), '%3A'),
    'der Doppelpunkt wird nicht kodiert');
assert(str_ends_with(avesmapsGaretienArtikelUrlAus('ggp', 'Garetien:A/B'), 'Garetien:A/B'),
    'und der Schraegstrich einer Unterseite auch nicht');
$pruefungen += 2;

// 💣 UMLAUTE ABER SCHON -- sie muessen kodiert werden, sonst ist die Adresse keine gueltige URL.
// ⚠️ Genau hier lief die erste Messung dieses Vorhabens ins Leere: eine Stichprobe von 20 Artikeln
// meldete 20 von 20 als 404, weil der Messcode die HTML-Seiten mit `errors='replace'` gelesen und
// jeden Umlaut durch U+FFFD ersetzt hatte. Der Befund war ein MESSFEHLER, kein Ergebnis -- richtig
// gemessen waren es 20 von 20 VORHANDEN.
$mitUmlaut = avesmapsGaretienArtikelUrlAus('ggp', 'Garetien:Grünwarte');
assert(str_contains($mitUmlaut, '%C3%BC'), 'der Umlaut ist kodiert: ' . $mitUmlaut);
assert(!str_contains($mitUmlaut, 'ü'), 'und steht nicht mehr roh da');
$pruefungen += 2;

// --- Leerzeichen werden Unterstriche (MediaWiki-Titelform).
assert(str_contains(avesmapsGaretienArtikelUrlAus('ggp', 'Garetien:Stadt Praioslob'), 'Stadt_Praioslob'),
    'Leerzeichen werden Unterstriche');
// --- Kosch zeigt auf koschwiki.de.
assert(str_starts_with(avesmapsGaretienArtikelUrlAus('kosch', 'Kosch:Bodrin'), 'https://www.koschwiki.de/'),
    'ein Kosch-Objekt zeigt auf koschwiki.de');
// --- 🔴 OHNE ARTIKEL DER WIRT ALLEIN, nie `…/index.php/` mit leerem Namen.
assert(avesmapsGaretienArtikelUrlAus('ggp', '') === 'https://www.garetien.de',
    'ohne Artikel bleibt der Wirt allein');
assert(avesmapsGaretienArtikelUrlAus('ggp', '   ') === 'https://www.garetien.de',
    'auch bei reinem Leerraum');
$pruefungen += 4;

// =================================================================================================
// 2. 🔴 DIE ARBEITSSEITE HEISST NACH DER EBENE -- der reparierte Fehler
// =================================================================================================
$zeile = ['wiki' => 'ggp', 'ebene' => 'Ortschaften_1', 'namensraum' => 'Garetien', 'artikel' => 'Stadt Praioslob'];
assert(
    avesmapsGaretienSeitenUrlAusZeile($zeile) === AVESMAPS_GARETIEN_BASIS_GGP . 'Ortschaften_1',
    'die Arbeitsseite ist die Exportseite der EBENE: ' . avesmapsGaretienSeitenUrlAusZeile($zeile)
);
// 💣 UND SIE DARF DEN ARTIKELNAMEN NICHT MEHR ENTHALTEN. Das ist die eigentliche Zusicherung:
// `…/Avesmaps_Garetien:Stadt_Praioslob` war live eine 404, und dieselbe tote Adresse stand als
// „Artikel"-Link im Importer-Fenster UND in `feature_sources.note` an jedem uebernommenen Objekt.
assert(!str_contains(avesmapsGaretienSeitenUrlAusZeile($zeile), 'Praioslob'),
    'der Artikelname gehoert NICHT in die Arbeitsseite: ' . avesmapsGaretienSeitenUrlAusZeile($zeile));
// ⚠️ Ohne Ebene der Wirt allein -- nie ein `Avesmaps_` ohne Namen.
assert(avesmapsGaretienSeitenUrlAusZeile(['wiki' => 'ggp']) === 'https://www.garetien.de',
    'ohne Ebene der Wirt allein');
// --- Die drei Adressen sind wirklich drei.
assert(count(array_unique([
    avesmapsGaretienWirtAusZeile($zeile),
    avesmapsGaretienSeitenUrlAusZeile($zeile),
    avesmapsGaretienArtikelUrlAusZeile($zeile),
])) === 3, 'Wirt, Arbeitsseite und Artikel sind drei verschiedene Adressen');
$pruefungen += 4;

// =================================================================================================
// 3. Die Quelle selbst -- Beschriftung nach Owner-Wortlaut
// =================================================================================================
$q = avesmapsGaretienArtikelQuelleAus('ggp', 'Garetien:Stadt Praioslob');
assert(is_array($q), 'eine Zeile mit Artikel liefert eine Quelle');
assert($q['label'] === 'Stadt Praioslob auf garetien.de',
    'der Owner-Wortlaut, Artikelname OHNE Namensraum: ' . $q['label']);
assert($q['url'] === 'https://www.garetien.de/index.php/Garetien:Stadt_Praioslob', 'und die volle Adresse');
assert($q['source_type'] === 'briefspiel', 'derselbe Typ wie die Sammelquelle');
assert($q['origin'] === 'garetien',
    'dieselbe Herkunft -- daran haengt die Ruecknahme (avesmapsGaretienQuelleRuecknahmeLoesen loest '
    . 'ALLES mit origin=garetien) und die Wiedererkennung durch einen spaeteren Lauf');
assert($q['license'] === 'cc-by-nc-sa-3.0' && $q['attribution'] === 'VolkoV / garetien.de',
    'Lizenz und Namensnennung wie bei der Sammelquelle -- derselbe Wirt, derselbe Autor');
$pruefungen += 6;

// --- Kosch: anderer Wirt, andere Namensnennung.
$qk = avesmapsGaretienArtikelQuelleAus('kosch', 'Kosch:Bodrin');
assert($qk['label'] === 'Bodrin auf koschwiki.de', 'Kosch-Beschriftung: ' . $qk['label']);
assert($qk['attribution'] === 'VolkoV / koschwiki.de', 'und die Kosch-Namensnennung');
$pruefungen += 2;

// --- 🔴 OHNE ARTIKEL GAR KEINE QUELLE, nie eine leere. 42 % der Zeilen haben keinen (vor allem
// Wege und Waelder, live gemessen 7 % bzw. 8 % Abdeckung).
assert(avesmapsGaretienArtikelQuelleAus('ggp', '') === null, 'ohne Artikel gibt es keine Artikelquelle');
$pruefungen++;

// --- Ein Artikel im HAUPTNAMENSRAUM hat keinen Namensraum, den man abschneiden koennte.
assert(avesmapsGaretienArtikelQuelleAus('ggp', 'Nachbarprovinzen')['label'] === 'Nachbarprovinzen auf garetien.de',
    'ein Artikel ohne Namensraum behaelt seinen vollen Namen');
// ⚠️ 1014 Artikel tragen mehr als ein Objekt (Spitze: „Nachbarprovinzen" mit 7). Das ist gewollt:
// die Beschriftung nennt den ARTIKEL, nicht das Objekt, und ist damit auch dort eine wahre Aussage.
$pruefungen++;

// =================================================================================================
// 4. 💣 DER ARTIKELNAME AUS EINEM SCHLUESSEL -- der Rueckfall fuer alte Items
// =================================================================================================
// Ohne ihn muesste der Owner seinen laufenden Lauf (8213 Zeilen) neu rechnen, um die Artikelquelle
// zu bekommen. Er ist die Umkehrung von avesmapsGaretienObjektSchluesselAusZeile.
assert(avesmapsGaretienArtikelNameAusSchluessel('ggp:Ortschaften_3:Stadt:Garetien:Stadt Praioslob!Stadt Praioslob')
    === 'Garetien:Stadt Praioslob', 'der vierte Teil des Schluessels IST der Artikelname');
// 💣 DER SUFFIX HINTER `|` MUSS HERAUSFALLEN -- ein Ergaenzungs-Item traegt ihn.
assert(avesmapsGaretienArtikelNameAusSchluessel('ggp:Gewaesser:Fluss:Garetien:Natter!Natter|ergaenzung|abc-123')
    === 'Garetien:Natter', 'der Suffix hinter | gehoert nicht zum Artikelnamen');
// 💣 UND EIN OBJEKT OHNE ARTIKEL TRAEGT `#<Zeilennummer>` -- daraus darf keine Quelle „#417 auf
// garetien.de" werden, die auf `…/index.php/#417` zeigt.
assert(avesmapsGaretienArtikelNameAusSchluessel('ggp:Wege:Pfad:#417') === '',
    'eine Zeilennummer ist kein Artikelname');
// --- Ein zu kurzer Schluessel liefert nichts, statt zu raten.
assert(avesmapsGaretienArtikelNameAusSchluessel('ggp:Wege') === '', 'ein unvollstaendiger Schluessel ergibt nichts');
$pruefungen += 4;

// --- 🔴 DIE RUNDREISE: bauen und wieder zerlegen ergibt denselben Namen. Ohne sie belegt der
// Abschnitt oben nur, dass eine Zeichenkette zerlegt wird -- nicht, dass es DIE Formel ist.
$rundreiseZeile = ['wiki' => 'ggp', 'ebene' => 'Ortschaften_3', 'typ' => 'Stadt',
    'namensraum' => 'Garetien', 'artikel' => 'Stadt Praioslob', 'zeile_nr' => 12];
assert(
    avesmapsGaretienArtikelNameAusSchluessel(avesmapsGaretienObjektSchluesselAusZeile($rundreiseZeile))
        === avesmapsGaretienSeitenNameAusZeile($rundreiseZeile),
    'die Zerlegung ist die Umkehrung des Bauers'
);
// --- Und fuer eine Zeile OHNE Artikel ergibt die Rundreise nichts (der Bauer setzt dort `#nr`).
$ohne = ['wiki' => 'ggp', 'ebene' => 'Wege', 'typ' => 'Pfad', 'namensraum' => '', 'artikel' => '', 'zeile_nr' => 417];
assert(avesmapsGaretienArtikelNameAusSchluessel(avesmapsGaretienObjektSchluesselAusZeile($ohne)) === '',
    'eine Zeile ohne Artikel ergibt auch nach der Rundreise keinen');
$pruefungen += 2;

// =================================================================================================
// 5. 💣 DIE ARBEITSSEITE WIRD NEU GERECHNET, NICHT AUS `after` GEGLAUBT
// =================================================================================================
// Jedes vor dem 31.08.2026 gebaute Item traegt in `after.seite_url` die tote Form. Der laufende
// Lauf des Owners besteht ausschliesslich aus solchen Items -- wuerde die Uebernahme das Feld
// glauben, schriebe sie die 404-Adresse weiter in jede neue `feature_sources.note`.
$altesAfter = [
    'wiki' => 'ggp',
    'ebene' => 'Ortschaften_3',
    'seite_url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Garetien:Stadt_Praioslob', // die tote Form
];
assert(avesmapsGaretienArbeitsseiteAus($altesAfter) === AVESMAPS_GARETIEN_BASIS_GGP . 'Ortschaften_3',
    'die Arbeitsseite wird aus wiki+ebene neu gerechnet: ' . avesmapsGaretienArbeitsseiteAus($altesAfter));
assert(avesmapsGaretienArbeitsseiteAus($altesAfter) !== $altesAfter['seite_url'],
    'und weicht damit ausdruecklich vom gespeicherten Feld ab -- sonst prueft die Zeile darueber nichts');
// ⚠️ Fehlt die Ebene (ein von Hand gebautes Item), gilt weiterhin das gespeicherte Feld.
assert(avesmapsGaretienArbeitsseiteAus(['seite_url' => 'https://beispiel.de/x']) === 'https://beispiel.de/x',
    'ohne Ebene bleibt das gespeicherte Feld gueltig');
$pruefungen += 3;

// =================================================================================================
// 6. Der Planeintrag traegt sie -- und nur, wenn es einen Artikel gibt
// =================================================================================================
$ziel = ['ziel' => 'location', 'subtyp' => 'stadt', 'kind' => null];
$urteil = ['status' => 'neu', 'grund' => 'Test', 'anlass' => null, 'treffer_public_id' => null, 'treffer_name' => null];
$mitArtikel = avesmapsGaretienPlanEintrag(
    ['wiki' => 'ggp', 'ebene' => 'Ortschaften_3', 'typ' => 'Stadt', 'zeile_nr' => 3,
     'namensraum' => 'Garetien', 'artikel' => 'Stadt Praioslob', 'anzeige' => 'Praioslob',
     'geo_art' => 'koordinaten', 'geo' => '500000 500000'],
    $ziel,
    $urteil
);
// ⚠️ Die Beschriftung nennt den ARTIKEL („Stadt Praioslob"), nicht die ANZEIGE („Praioslob").
// Das ist die Seite, die verlinkt wird, und ihr Name steht so im Wiki.
assert(($mitArtikel['after']['artikel_quelle']['label'] ?? '') === 'Stadt Praioslob auf garetien.de',
    'der Planeintrag traegt die Artikelquelle: ' . json_encode($mitArtikel['after']['artikel_quelle'] ?? null));
assert(($mitArtikel['after']['artikel_quelle']['url'] ?? '')
    === 'https://www.garetien.de/index.php/Garetien:Stadt_Praioslob', 'mit der richtigen Adresse');
// 🔴 UND DIE SAMMELQUELLE BLEIBT DANEBEN STEHEN -- „zusaetzlich, nicht statt" (Owner).
assert(($mitArtikel['after']['quelle']['url'] ?? '') === 'https://www.garetien.de',
    'die Sammelquelle auf den Wirt bleibt unveraendert');
assert(($mitArtikel['after']['quelle']['label'] ?? '') === 'Briefspiel (Garetien)', 'samt ihrer Beschriftung');
$pruefungen += 4;

// --- 🔴 OHNE ARTIKEL FEHLT DER SCHLUESSEL GANZ. Ein leeres `artikel_quelle` an jeder Planzeile
// waere eine Behauptung ueber etwas, das es nicht gibt -- dieselbe Regel wie bei `is_bach`.
$ohneArtikel = avesmapsGaretienPlanEintrag(
    ['wiki' => 'ggp', 'ebene' => 'Wege', 'typ' => 'Pfad', 'zeile_nr' => 417,
     'namensraum' => '', 'artikel' => '', 'anzeige' => 'Unbenannt',
     'geo_art' => 'koordinaten', 'geo' => '500000 500000, 500100 500100'],
    ['ziel' => 'path', 'subtyp' => 'Pfad', 'kind' => null],
    $urteil
);
assert(!array_key_exists('artikel_quelle', $ohneArtikel['after']),
    'ohne Artikel steht der Schluessel gar nicht da: ' . json_encode(array_keys($ohneArtikel['after'])));
assert(($ohneArtikel['after']['quelle']['url'] ?? '') === 'https://www.garetien.de',
    'die Sammelquelle bekommt es trotzdem -- sie haengt am Wirt, nicht am Artikel');
$pruefungen += 2;

echo 'OK: garetien-artikel-quelle, ' . $pruefungen . ' Pruefungen.' . PHP_EOL;
