<?php

declare(strict_types=1);

// Owner-Auftrag A (30.08.2026), Knopf "Imports in der Naehe markieren": weitere Objekte DES
// IMPORTS im groben Umkreis um ein bereits geladenes Objekt.
//
// Geprueft wird ueberwiegend die REINE Rechnung (avesmapsGaretienNaeheAusObjekten) -- sie braucht
// keine Datenbank und keine echten garetien.de-Koordinaten samt Affintransformation, nur
// handgewaehlte Karteneinheiten. Der PDO-Zwilling (avesmapsGaretienNaehe) bekommt einen eigenen,
// kleinen Ablauf am Ende, der die Verdrahtung mit avesmapsGaretienArbeitslisteObjekte belegt.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-naehe-test.php

require_once __DIR__ . '/../garetien-liste.php';

$pruefungen = 0;

// =================================================================================================
// 1. Fuer einen PUNKT ist der Radius schlicht der Zuschlag -- Auftrag woertlich:
//    "Fuer einen Punkt (Ort, Gipfel) ist das schlicht 5."
// =================================================================================================
$punktObjekte = [
    'p:ziel' => ['key' => 'p:ziel', 'name' => 'Zielpunkt', 'geometrie' => [[100.0, 100.0]]],
    // Genau auf dem Rand (Abstand 5,0) -- <= zaehlt als "im Kreis".
    'p:rand' => ['key' => 'p:rand', 'name' => 'Randpunkt', 'geometrie' => [[105.0, 100.0]]],
    // Ein Hauch dahinter (Abstand 5,000001).
    'p:knappRaus' => ['key' => 'p:knappRaus', 'name' => 'Knapp draussen', 'geometrie' => [[105.000001, 100.0]]],
    // Deutlich innerhalb (Abstand 4,9).
    'p:nah' => ['key' => 'p:nah', 'name' => 'Nah', 'geometrie' => [[104.9, 100.0]]],
];

$ergebnisPunkt = avesmapsGaretienNaeheAusObjekten($punktObjekte, 'p:ziel');
assert(abs($ergebnisPunkt['radius'] - AVESMAPS_GARETIEN_NAEHE_ZUSCHLAG) < 1e-9,
    'ein Punkt ohne eigene Ausdehnung traegt genau den Zuschlag als Radius: ' . $ergebnisPunkt['radius']);
$gefundenSchluessel = array_column($ergebnisPunkt['gefunden'], 'key');
sort($gefundenSchluessel);
assert($gefundenSchluessel === ['p:nah', 'p:rand'],
    'gefunden werden Rand (genau 5,0, <=) und Nah -- Knapp-draussen (5,000001) faellt heraus: '
    . implode(',', $gefundenSchluessel));
$pruefungen += 2;

// =================================================================================================
// 2. Miss die DIFFERENZ: EIN Objekt innerhalb, eines KNAPP ausserhalb -- ohne den zweiten Fall
//    prueft der Test nichts (Auftrag, Zusicherungen).
// =================================================================================================
// Bereits oben belegt (p:rand innerhalb, p:knappRaus ausserhalb, identische Richtung, nur 2 Millionstel
// Karteneinheiten auseinander) -- hier zusaetzlich mit einem GROBEN Abstand in einer anderen Richtung,
// damit die Differenz nicht an einer einzigen Achse haengt.
$diffObjekte = [
    'd:ziel' => ['key' => 'd:ziel', 'geometrie' => [[0.0, 0.0]]],
    'd:innen' => ['key' => 'd:innen', 'geometrie' => [[3.0, 4.0]]],   // Abstand genau 5,0 -> innen
    'd:aussen' => ['key' => 'd:aussen', 'geometrie' => [[3.0, 4.1]]],  // Abstand > 5,0 -> aussen
];
$ergebnisDiff = avesmapsGaretienNaeheAusObjekten($diffObjekte, 'd:ziel');
$diffSchluessel = array_column($ergebnisDiff['gefunden'], 'key');
assert($diffSchluessel === ['d:innen'], 'nur das innere Objekt wird gefunden, das aeussere nicht: ' . implode(',', $diffSchluessel));
$pruefungen++;

// =================================================================================================
// 3. Eine FLAECHE hat einen GROESSEREN Umkreis als ein PUNKT an derselben Stelle (Auftrag,
//    Zusicherungen) -- am selben Kandidaten gemessen: er liegt im Umkreis der Flaeche, aber
//    ausserhalb des Umkreises eines Punkts an derselben Mitte.
// =================================================================================================
// Ein Quadrat, Mittelpunkt (100,100), Halbdiagonale 20*sqrt(2) ~= 28,28 -- Radius also ~33,28.
$flaechenPunkte = [[80.0, 80.0], [120.0, 80.0], [120.0, 120.0], [80.0, 120.0]];
$kandidatMittelweit = [30.0 + 100.0, 100.0];   // (130, 100): Abstand zur Mitte (100,100) = 30
$flaecheObjekte = [
    'f:ziel' => ['key' => 'f:ziel', 'geometrie' => $flaechenPunkte],
    'f:mittelweit' => ['key' => 'f:mittelweit', 'geometrie' => [$kandidatMittelweit]],
];
$punktGleicheMitte = [
    'p2:ziel' => ['key' => 'p2:ziel', 'geometrie' => [[100.0, 100.0]]],
    'p2:mittelweit' => ['key' => 'p2:mittelweit', 'geometrie' => [$kandidatMittelweit]],
];
$ergebnisFlaeche = avesmapsGaretienNaeheAusObjekten($flaecheObjekte, 'f:ziel');
$ergebnisPunkt2 = avesmapsGaretienNaeheAusObjekten($punktGleicheMitte, 'p2:ziel');
assert($ergebnisFlaeche['radius'] > $ergebnisPunkt2['radius'],
    'die Flaeche traegt einen groesseren Radius als der Punkt an derselben Mitte: '
    . $ergebnisFlaeche['radius'] . ' gegen ' . $ergebnisPunkt2['radius']);
assert(count($ergebnisFlaeche['gefunden']) === 1 && $ergebnisFlaeche['gefunden'][0]['key'] === 'f:mittelweit',
    'der 30 Einheiten entfernte Kandidat liegt im (groesseren) Umkreis der Flaeche');
assert($ergebnisPunkt2['gefunden'] === [],
    'derselbe Kandidat liegt AUSSERHALB des (kleineren) Umkreises des Punkts an derselben Mitte');
$pruefungen += 3;

// =================================================================================================
// 4. Das Ziel selbst ist niemals sein eigener Nachbar, auch wenn es sich selbst beruehrt.
// =================================================================================================
assert(!in_array('f:ziel', array_column($ergebnisFlaeche['gefunden'], 'key'), true),
    'das Ziel darf nicht als sein eigener Nachbar erscheinen');
$pruefungen++;

// =================================================================================================
// 5. Volle Objekte, keine blossen Schluessel -- der Client kann direkt markieren UND anzeigen.
// =================================================================================================
$vollesObjekt = ['key' => 'v:nah', 'name' => 'Voller Nachbar', 'urteil' => 'neu', 'geometrie' => [[1.0, 0.0]]];
$vollObjekte = [
    'v:ziel' => ['key' => 'v:ziel', 'geometrie' => [[0.0, 0.0]]],
    'v:nah' => $vollesObjekt,
];
$ergebnisVoll = avesmapsGaretienNaeheAusObjekten($vollObjekte, 'v:ziel');
assert(count($ergebnisVoll['gefunden']) === 1 && $ergebnisVoll['gefunden'][0] === $vollesObjekt,
    'das gefundene Objekt reist VOLLSTAENDIG mit -- Name, Urteil und alles andere, nicht nur der Schluessel');
$pruefungen++;

// =================================================================================================
// 6. Randfaelle, die nichts werfen duerfen: unbekanntes Ziel, Ziel ohne Geometrie, Kandidat ohne
//    Geometrie.
// =================================================================================================
$leer1 = avesmapsGaretienNaeheAusObjekten(['x:a' => ['key' => 'x:a', 'geometrie' => [[0.0, 0.0]]]], 'x:unbekannt');
assert($leer1 === ['gefunden' => [], 'radius' => 0.0], 'ein unbekanntes Ziel liefert eine leere, aber gueltige Antwort');

$leer2 = avesmapsGaretienNaeheAusObjekten(
    ['x:ohneGeo' => ['key' => 'x:ohneGeo', 'geometrie' => []]],
    'x:ohneGeo'
);
assert($leer2 === ['gefunden' => [], 'radius' => 0.0], 'ein Ziel ohne eigene Geometrie hat weder Mittelpunkt noch Radius');

$mitLeeremKandidat = avesmapsGaretienNaeheAusObjekten([
    'x:ziel' => ['key' => 'x:ziel', 'geometrie' => [[0.0, 0.0]]],
    'x:ohneGeo2' => ['key' => 'x:ohneGeo2', 'geometrie' => []],
], 'x:ziel');
assert($mitLeeremKandidat['gefunden'] === [], 'ein Kandidat ohne Geometrie wird uebersprungen, nicht geworfen');
$pruefungen += 3;

// =================================================================================================
// 7. Der Huellbox-Vorfilter darf keinen echten Treffer verschlucken -- ein Kandidat, dessen
//    Huellbox das Suchquadrat nur an einer Ecke beruehrt, muss trotzdem gefunden werden, wenn
//    einer seiner PUNKTE wirklich im Kreis liegt.
// =================================================================================================
// Ziel bei (0,0), Radius 5 (Punkt). Kandidat ist eine Linie von (10,10) nach (3,4) -- ihre Huellbox
// reicht bis (3,4), und (3,4) selbst liegt exakt auf dem Rand (Abstand 5,0).
$eckfallObjekte = [
    'e:ziel' => ['key' => 'e:ziel', 'geometrie' => [[0.0, 0.0]]],
    'e:kandidat' => ['key' => 'e:kandidat', 'geometrie' => [[10.0, 10.0], [3.0, 4.0]]],
];
$ergebnisEck = avesmapsGaretienNaeheAusObjekten($eckfallObjekte, 'e:ziel');
assert(array_column($ergebnisEck['gefunden'], 'key') === ['e:kandidat'],
    'ein Kandidat mit nur EINEM Punkt im Kreis wird trotz weit entfernter Huellbox-Ecken gefunden');
$pruefungen++;

// =================================================================================================
// 8. Der PDO-Zwilling: avesmapsGaretienNaehe baut auf avesmapsGaretienArbeitslisteObjekte auf und
//    sucht ueber den GANZEN Lauf -- am geteilten Pruefstand (avesmapsGaretienPlanTestPdo) belegt.
// =================================================================================================
$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);

// Ohne offenen Lauf: leere, aber gueltige Antwort -- derselbe leere Zustand wie vor dem ersten Rechnen.
$leererPdo = avesmapsGaretienPlanTestPdo();
$ohneLauf = avesmapsGaretienNaehe($leererPdo, 1, 'irgendein:schluessel');
assert($ohneLauf === ['gefunden' => [], 'radius' => 0.0], 'ohne offenen Lauf liefert der PDO-Zwilling dieselbe leere Antwort');

// Der Gardel ist ein bekanntes Objekt aus dem geteilten Pruefstand -- sein Schluessel entsteht aus
// wiki:ebene:typ:seite. Der Pruefstand traegt keinen Wiki-Artikel fuer ihn, die Seite ist deshalb
// die Export-Arbeitsseite (avesmapsGaretienSeitenNameAusZeile faellt auf `#<zeile_nr>` zurueck).
$basis = avesmapsGaretienArbeitslisteObjekte($pdo, 1);
$gardelSchluessel = null;
foreach ($basis['objekte'] as $schluessel => $objekt) {
    if ($objekt['name'] === 'Gardel') {
        $gardelSchluessel = $schluessel;
        break;
    }
}
assert($gardelSchluessel !== null, 'der Gardel muss im Pruefstand vorkommen');
$ergebnisPdo = avesmapsGaretienNaehe($pdo, 1, (string) $gardelSchluessel);
assert($ergebnisPdo['radius'] > 0.0, 'der PDO-Zwilling liefert einen echten, aus der Geometrie gerechneten Radius');
assert(!in_array($gardelSchluessel, array_column($ergebnisPdo['gefunden'], 'key'), true),
    'auch ueber den PDO-Weg ist der Gardel nicht sein eigener Nachbar');
$pruefungen += 3;

echo "OK: {$pruefungen} Pruefungen (garetien-naehe-test)\n";
