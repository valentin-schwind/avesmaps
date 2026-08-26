<?php

declare(strict_types=1);

// Der Zeilen-Parser fuer die Exportseiten von garetien.de / koschwiki.de.
// Format: Typ:[Namensraum:]Artikel!Anzeige;lodmin!lodmax;extra;Geometrie
//
// 💣 Die Kopfvarianten sind KEIN Fehler (Volker, 26.08.2026): fehlt der Artikel, wurde die
// Zeile von Hand in die Vorlage geschrieben; fehlt der Namensraum, liegt der Artikel im
// Hauptnamensraum, weil das Objekt durch mehrere Provinzen laeuft.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 \
//           api/_internal/import/__tests__/garetien-parser-test.php

require_once __DIR__ . '/../garetien-parser.php';

$pruefungen = 0;

// --- Der Normalfall: 209 von 246 Zeilen der Gewaesserseite sehen so aus.
$e = avesmapsGaretienParseZeile('Sumpf:Garetien:Blutmoor!Blutmoor;5!14;;-81541 -34910, -82345 -34947');
assert($e !== null, 'Datenzeile darf nicht null sein');
assert($e['typ'] === 'Sumpf');
assert($e['namensraum'] === 'Garetien');
assert($e['artikel'] === 'Blutmoor');
assert($e['anzeige'] === 'Blutmoor');
assert($e['lodmin'] === '5' && $e['lodmax'] === '14');
assert($e['geo_art'] === 'koordinaten');
$pruefungen += 7;

// --- Steuerzeilen sind Kommentare der Vorlage.
assert(avesmapsGaretienParseZeile('K:BEGIN Vorlage:KarteGewaesser') === null);
$pruefungen++;

// --- 🪤 Und zwar am "K:", NICHT an der Feldzahl. Alle sechs Steuerzeilen der echten Seite
// haben heute genau EIN Feld, werden also zufaellig schon von der "weniger als vier
// Felder"-Schranke gefangen -- ein geloeschter K:-Riegel faellt daran nicht auf. Eine
// Steuerzeile mit Semikola wuerde dann als Datenzeile im Staging landen (Mutationsprobe
// 26.08.2026: genau diese Mutation ueberlebte den ganzen Test).
assert(avesmapsGaretienParseZeile('K:Abfrage Suempfe;5!14;;-1 -2, -3 -4') === null);
$pruefungen++;

// --- Kein Namensraum: der Darpat fliesst durch mehrere Provinzen.
$e = avesmapsGaretienParseZeile('Strom:Darpat!Darpat;1!14;;100 200, 300 400');
assert($e['namensraum'] === '', 'ohne Namensraum bleibt das Feld leer');
assert($e['artikel'] === 'Darpat');
$pruefungen += 2;

// --- Kein Artikel: von Hand in die Vorlage geschrieben.
$e = avesmapsGaretienParseZeile('Bach:Nebenfluss der Natter;6!9;;10 20, 30 40');
assert($e['artikel'] === '', 'ohne Artikel bleibt das Feld leer');
assert($e['anzeige'] === 'Nebenfluss der Natter', 'der Name wandert in die Anzeige');
$pruefungen += 2;

// --- 💣 Verweislisten trennen mit Komma ODER mit Schraegstrich. Mit nur Komma blieben
// 8 Flaechen unaufloesbar (gemessen 26.08.2026).
assert(avesmapsGaretienParseVerweise('A-B, C-D') === ['A-B', 'C-D']);
assert(avesmapsGaretienParseVerweise('A 1 / A 2 / A 3') === ['A 1', 'A 2', 'A 3']);
$pruefungen += 2;

// --- Das extra-Feld traegt nur bei politischen Flaechen etwas.
$e = avesmapsGaretienParseZeile('BaronieflaecheE:Garetien:Baronie Retogau!Baronie Retogau;6!10;pop=16000!level=Baron;Raulsmark-Retogau, Vierok-Retogau');
assert($e['extra'] === 'pop=16000!level=Baron');
assert($e['geo_art'] === 'verweise', 'eine Flaeche verweist, sie hat keine eigenen Koordinaten');
$pruefungen += 2;

// --- Koordinaten kommen als Zahlenpaare.
$p = avesmapsGaretienParseKoordinaten('-81541 -34910, -82345 -34947');
assert(count($p) === 2);
assert(abs($p[0][0] - (-81541.0)) < 0.001 && abs($p[0][1] - (-34910.0)) < 0.001);
$pruefungen += 2;

// --- Der HTML-Filter: div.mw-parser-output, <p>/<br> werden Zeilenumbrueche.
$text = avesmapsGaretienSeitentext(
    '<html><body><div class="mw-parser-output"><p>K:BEGIN</p><p>See:Garetien:Mühlsee!Mühlsee;4!14;;1 2</p></div></body></html>'
);
assert(str_contains($text, 'See:Garetien:Mühlsee'), 'Umlaute muessen erhalten bleiben');
assert(str_contains($text, "\n"), 'Absaetze werden zu Zeilen');
$pruefungen += 2;

// --- Gegenprobe an der echten Seite: 246 Datenzeilen, 6 Steuerzeilen, keine defekte.
// Gemessen 26.08.2026. Aendert sich die Zahl, hat Volker Daten ergaenzt -- das ist kein
// Testfehler, sondern die Nachricht, die dieser Test transportieren soll.
//
// ⚠️ Die Fixture ist die unveraenderte Exportseite von garetien.de: Kartengeometrie von
// Volker Strunk / Freundeskreis des phantastischen Briefspiels e.V., CC BY-NC-SA 3.0. Sie
// faellt damit unter die Nicht-MIT-Zeile "map, place, path, region and territory geometry"
// in LEGAL.md und NICHT unter die MIT-Deckung von api/ -- wer sie anfasst, liest das dort.
$html = file_get_contents(__DIR__ . '/fixtures/ggp-gewaesser.html');
$zeilen = array_filter(array_map('trim', explode("\n", avesmapsGaretienSeitentext($html))));
$daten = [];
$steuer = 0;
foreach ($zeilen as $z) {
    if (str_starts_with($z, 'K:')) { $steuer++; continue; }
    $e = avesmapsGaretienParseZeile($z);
    if ($e !== null) { $daten[] = $e; }
}
assert(count($daten) === 246, 'die Gewaesserseite hatte am 26.08.2026 246 Datenzeilen, jetzt ' . count($daten));
assert($steuer === 6);
$typen = array_count_values(array_column($daten, 'typ'));
assert($typen['Bach'] === 127 && $typen['See'] === 81 && $typen['Fluss'] === 20);
assert($typen['Sumpf'] === 15 && $typen['Strom'] === 2 && $typen['Meer'] === 1);
$pruefungen += 6;

// --- 💣 KEINE Zeile darf still verlorengehen. Ohne diese Zusicherung waere ein Parser, der
// die Haelfte verwirft, an den Zahlen oben nicht zu erkennen -- 246 von 492 sind auch 246.
assert(count($zeilen) === $steuer + count($daten), 'jede Zeile ist entweder Steuerzeile oder Datenzeile');
$pruefungen++;

// --- 💣 Die Kopfvarianten aus §1.2, an der echten Seite nachgezaehlt: 27 Zeilen ohne
// Artikel (von Hand geschrieben), 37 ohne Namensraum (Objekt laeuft durch mehrere
// Provinzen), und GENAU EINE ganz ohne Namen -- die wird spaeter uebersprungen und gemeldet.
assert(count(array_filter($daten, static fn(array $e): bool => $e['artikel'] === '')) === 27);
assert(count(array_filter($daten, static fn(array $e): bool => $e['namensraum'] === '')) === 37);
assert(count(array_filter($daten, static fn(array $e): bool => $e['anzeige'] === '')) === 1);
$pruefungen += 3;

// --- 🪤 Der Sammelartikel steht im ARTIKEL, nicht im Namensraum. "Fluss:Nachbarprovinzen!
// Llavari" hat gar keinen Namensraum -- der Text vor dem "!" IST der Artikelname. Wer ihn im
// Namensraum sucht, findet keine einzige der vier Zeilen und importiert sie alle.
$sammel = array_filter($daten, static fn(array $e): bool => in_array($e['artikel'], ['Nachbarprovinzen', 'Raschtulswall'], true));
assert(count($sammel) === 4, 'vier Sammelartikel-Zeilen auf dieser Seite, ' . count($sammel) . ' gefunden');
foreach ($sammel as $e) {
    assert($e['namensraum'] === '', 'der Sammelartikel liegt im Hauptnamensraum');
}
$pruefungen += 2;

// --- Die laengste Geometriezeile hat 4885 Zeichen. Das ist der Grund, warum die
// Staging-Spalten MEDIUMTEXT sind und nicht VARCHAR (Aufgabe 3).
$laengste = max(array_map(static fn(array $e): int => strlen($e['geo']), $daten));
assert($laengste > 3000, "laengste Geometrie {$laengste} Zeichen -- passt in kein VARCHAR(255)");
$pruefungen++;

// --- 💣 DAS KOSCHWIKI SCHREIBT KOORDINATEN MIT SEMIKOLON, und der Entwurf sagt das nicht.
// "x;y; x;y" statt "x y, x y" -- gemessen 26.08.2026 an zwei Zeilen der Kosch-Gewaesserseite.
// Der Fund ist teuer, weil er sich als NICHTS aeussert: die Zeile galt als Verweisliste, eine
// unaufloesbare Verweisliste ergibt keine Geometrie, und der Angbarer See -- der groesste See
// des Kosch -- waere ohne jede Fehlermeldung nicht importiert worden. Genau die Klasse Fehler,
// vor der der Entwurf bei "ok:true mit leerem Inhalt" warnt.
$p = avesmapsGaretienParseKoordinaten('-192685;63362; -194670;63829; -195603;64996');
assert(count($p) === 3, 'Semikolon-Schreibweise muss drei Punkte ergeben, ' . count($p) . ' gefunden');
assert(abs($p[0][0] - (-192685.0)) < 0.001 && abs($p[0][1] - 63362.0) < 0.001);
assert(abs($p[2][1] - 64996.0) < 0.001, 'auch der letzte Punkt, nicht nur der erste');
$pruefungen += 3;

// --- Und die Weiche muss sie als Koordinaten erkennen, sonst wird sie gar nicht erst gefragt.
$e = avesmapsGaretienParseZeile('Meer:Angbarer See;1!14;;-192685;63362; -194670;63829');
assert($e['geo_art'] === 'koordinaten', 'Semikolon-Koordinaten sind keine Verweisliste');
assert(count(avesmapsGaretienParseKoordinaten($e['geo'])) === 2, 'das Geometriefeld ueberlebt den Feldtrenner');
$pruefungen += 2;

// --- 🪤 Die Gegenrichtung: eine echte Verweisliste darf NICHT als Koordinaten durchgehen.
// Beide Trennzeichen der Verweislisten stehen hier, sonst prueft das nur die Haelfte.
assert(avesmapsGaretienParseZeile('BaronieflaecheA:Garetien:X!X;6!10;;Raulsmark-Retogau, Vierok-Retogau')['geo_art'] === 'verweise');
assert(avesmapsGaretienParseZeile('BaronieflaecheA:Garetien:X!X;6!10;;Ahorn 1 / Ahorn 2')['geo_art'] === 'verweise');
$pruefungen += 2;

// --- Gegenprobe an der echten Kosch-Seite: 43 Zeilen, davon GENAU ZWEI in Semikolonform,
// und keine einzige, die als Verweisliste liegenbleibt.
$koschHtml = file_get_contents(__DIR__ . '/fixtures/kosch-gewaesser.html');
$koschDaten = [];
foreach (explode("\n", avesmapsGaretienSeitentext($koschHtml)) as $z) {
    $e = avesmapsGaretienParseZeile($z);
    if ($e !== null) { $koschDaten[] = $e; }
}
assert(count($koschDaten) === 43, 'die Kosch-Gewaesserseite hatte am 26.08.2026 43 Zeilen, jetzt ' . count($koschDaten));
$semikolon = array_filter($koschDaten, static fn(array $e): bool => str_contains($e['geo'], ';'));
assert(count($semikolon) === 2, 'zwei Zeilen in Semikolonform, ' . count($semikolon) . ' gefunden');
foreach ($koschDaten as $e) {
    assert($e['geo_art'] === 'koordinaten', "'{$e['anzeige']}' gilt als Verweisliste -- ein Gewaesser hat immer Koordinaten");
    assert(count(avesmapsGaretienParseKoordinaten($e['geo'])) >= 2, "'{$e['anzeige']}' ergibt keine Linie");
}
$pruefungen += 3;

// --- Zusammen sind es die 289 Objekte, mit denen der Entwurf rechnet.
assert(count($daten) + count($koschDaten) === 289, 'Stufe 1 sind 289 Gewaesserobjekte');
$pruefungen++;

echo "OK: {$pruefungen} Pruefungen\n";
