<?php

declare(strict_types=1);

// Owner-Meldung 30.08.2026 ("da kam ploetzlich diese wirre rosa linie"): UNSERE Geometrie verlor
// auf dem Weg ins Importfenster ihre RINGSTRUKTUR. avesmapsGaretienGeoJsonPunkte sammelt jede
// Geometrie rekursiv in EINE flache Punktliste, avesmapsGaretienProbepunkteN duennt die auf 64
// aus -- und der Zeichner zieht durch diese 64 Punkte EINE Linie. Bei einem MultiPolygon springt
// sie zwischen den Teilen hin und her.
//
// Live nachgerechnet (GET /api/app/ecosystem-areas.php, 30.08.2026): "Reichsforst" ist ein
// MultiPolygon aus 12 Teilen / 20 Ringen / 1727 Punkten. Die daraus gezeichnete Linie ist 567
// Karteneinheiten lang in einer Huellbox mit 79 Einheiten Diagonale -- sie kreuzt sich selbst
// mehrfach. 113 von 520 Vegetationsflaechen (21,7 %) sind mehrteilig, es ist also rund jede
// fuenfte Flaeche.
//
// Geprueft wird die REINE Umformung (avesmapsGaretienGeoJsonTeile) -- keine Datenbank, keine
// Karte. Der Beleg ist ueberall die DIFFERENZ zur alten Rechnung, nicht ein Vorhandensein.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-ringe-test.php

// garetien-liste.php zieht garetien-plan.php und darueber garetien-abgleich.php nach -- so steht
// der ganze Weg vom Kandidaten bis in die Arbeitsliste zur Verfuegung, ohne eine Datei zweimal
// einzubinden.
require_once __DIR__ . '/../garetien-liste.php';

$pruefungen = 0;

/** Aus welchem Teil stammt dieser Punkt? -1 = aus keinem. */
function ringeTestTeilVon(array $punkt, array $teile): int
{
    foreach ($teile as $i => $teil) {
        foreach ($teil as $p) {
            if (abs($p[0] - $punkt[0]) < 1e-9 && abs($p[1] - $punkt[1]) < 1e-9) {
                return $i;
            }
        }
    }

    return -1;
}

/** Alle Blatt-Punktlisten eines verschachtelten Ergebnisses, in Reihenfolge. */
function ringeTestBlaetter(array $baum): array
{
    if (isset($baum[0]) && is_numeric($baum[0][0] ?? null)) {
        return [$baum];
    }
    $raus = [];
    foreach ($baum as $kind) {
        foreach (ringeTestBlaetter((array) $kind) as $blatt) {
            $raus[] = $blatt;
        }
    }

    return $raus;
}

/** Ein geschlossener Ring aus `$len` Punkten um `$mitteX`. */
function ringeTestKreis(int $len, float $mitteX): array
{
    $r = [];
    for ($i = 0; $i < $len - 1; $i++) {
        $w = 2 * M_PI * $i / ($len - 1);
        $r[] = [round($mitteX + cos($w), 6), round(sin($w), 6)];
    }
    $r[] = $r[0];

    return $r;
}

// =================================================================================================
// 1. DER KERN: zwei getrennte Teile bleiben getrennt -- gemessen an der DIFFERENZ zur alten Rechnung
// =================================================================================================
// Zwei Quadrate, weit auseinander. Die alte Rechnung reiht ihre Punkte hintereinander; jede Linie
// durch diese Reihe muss von einem Quadrat zum anderen springen. Die neue darf das nie.
$quadratA = [[0.0, 0.0], [0.0, 10.0], [10.0, 10.0], [10.0, 0.0], [0.0, 0.0]];
$quadratB = [[100.0, 100.0], [100.0, 110.0], [110.0, 110.0], [110.0, 100.0], [100.0, 100.0]];
$zweiTeile = ['type' => 'MultiPolygon', 'coordinates' => [[$quadratA], [$quadratB]]];

// Die ALTE Rechnung ist der ZEUGE, nicht die Vorgabe. Ohne sie belegt nichts darunter, dass sich
// ueberhaupt etwas geaendert hat -- und sie bleibt im Haus, weil der Abgleich sie weiter braucht.
$altFlach = avesmapsGaretienProbepunkteN(avesmapsGaretienGeoJsonPunkte($zweiTeile), 64);
$altSpruenge = 0;
for ($i = 0; $i < count($altFlach) - 1; $i++) {
    if (ringeTestTeilVon($altFlach[$i], [$quadratA, $quadratB])
        !== ringeTestTeilVon($altFlach[$i + 1], [$quadratA, $quadratB])) {
        $altSpruenge++;
    }
}
assert($altSpruenge > 0,
    'Zeuge: die ALTE flache Rechnung springt zwischen den Teilen -- sonst misst nichts darunter etwas');
$pruefungen++;

$neu = avesmapsGaretienGeoJsonTeile($zweiTeile, 64, 16);
$blaetter = ringeTestBlaetter($neu['geometrie']);
assert(count($blaetter) === 2, 'zwei Teile muessen zwei getrennte Punktlisten ergeben, nicht eine');
$pruefungen++;
foreach ($blaetter as $blatt) {
    $teil = ringeTestTeilVon($blatt[0], [$quadratA, $quadratB]);
    assert($teil !== -1, 'jede Punktliste muss aus einem der beiden Quadrate stammen');
    $pruefungen++;
    foreach ($blatt as $punkt) {
        assert(ringeTestTeilVon($punkt, [$quadratA, $quadratB]) === $teil,
            'kein Punkt darf in der Liste eines FREMDEN Teils stehen -- genau das ist das Gespinst');
    }
}
$pruefungen++;

// =================================================================================================
// 2. Die Verschachtelung bleibt die des GeoJSON -- Leaflet liest sie unveraendert
// =================================================================================================
// Punkt -> EINE Punktliste mit einem Punkt (der Zeichner macht daraus einen circleMarker; eine
// leere oder tiefer verschachtelte Antwort naehme ihm diesen Zweig).
$punkt = avesmapsGaretienGeoJsonTeile(['type' => 'Point', 'coordinates' => [3.0, 4.0]], 64, 16);
assert($punkt['geometrie'] === [[3.0, 4.0]], 'ein Point bleibt eine Liste mit GENAU einem Punktpaar');
$pruefungen++;

// LineString -> FLACH (Tiefe 1). Ein Weg hat keine Ringe, und eine zusaetzliche Ebene machte aus
// ihm eine Mehrfachlinie mit einem Glied.
$linie = avesmapsGaretienGeoJsonTeile(
    ['type' => 'LineString', 'coordinates' => [[1.0, 1.0], [2.0, 2.0], [3.0, 3.0]]], 64, 16
);
assert($linie['geometrie'] === [[1.0, 1.0], [2.0, 2.0], [3.0, 3.0]], 'ein LineString bleibt flach');
$pruefungen++;

// Polygon -> Tiefe 2 (Ringe), MultiPolygon -> Tiefe 3 (Teile aus Ringen).
$polygon = avesmapsGaretienGeoJsonTeile(['type' => 'Polygon', 'coordinates' => [$quadratA]], 64, 16);
assert(is_array($polygon['geometrie'][0][0]) && is_numeric($polygon['geometrie'][0][0][0]),
    'ein Polygon liefert eine Liste von RINGEN (Tiefe 2)');
$pruefungen++;
assert(is_array($neu['geometrie'][0][0][0]) && is_numeric($neu['geometrie'][0][0][0][0]),
    'ein MultiPolygon liefert eine Liste von TEILEN aus Ringen (Tiefe 3)');
$pruefungen++;

// =================================================================================================
// 3. Ein LOCH reist mit -- sonst deckt die Fuellung die Lichtung zu
// =================================================================================================
$loch = [[2.0, 2.0], [2.0, 4.0], [4.0, 4.0], [4.0, 2.0], [2.0, 2.0]];
$mitLoch = avesmapsGaretienGeoJsonTeile(
    ['type' => 'Polygon', 'coordinates' => [$quadratA, $loch]], 64, 16
);
assert(count($mitLoch['geometrie']) === 2, 'Aussenring und Loch sind ZWEI Ringe desselben Teils');
$pruefungen++;

// =================================================================================================
// 4. Jeder Ring bleibt GESCHLOSSEN -- die Ausduennung behaelt Anfang und Ende
// =================================================================================================
$grosserRing = ringeTestKreis(300, 50.0);
$gross = avesmapsGaretienGeoJsonTeile(['type' => 'Polygon', 'coordinates' => [$grosserRing]], 64, 16);
$ring = $gross['geometrie'][0];
assert(count($ring) < 300, 'ein 300-Punkte-Ring MUSS ausgeduennt werden, sonst ist das Budget wirkungslos');
$pruefungen++;
assert($ring[0] === $ring[count($ring) - 1],
    'der ausgeduennte Ring muss geschlossen bleiben -- sonst klafft die Flaeche auf');
$pruefungen++;

// =================================================================================================
// 5. Das Budget haelt -- und kein Ring faellt unter die Mindestzahl
// =================================================================================================
// Zwoelf Teile mit den Ringlaengen des ECHTEN Reichsforst (800 / 313 / 214 / Rest klein).
$vieleTeile = [];
$laengen = [800, 313, 214, 77, 60, 58, 36, 28, 21, 18, 17, 14];
foreach ($laengen as $nr => $len) {
    $vieleTeile[] = [ringeTestKreis($len, $nr * 1000.0)];
}
$reich = avesmapsGaretienGeoJsonTeile(['type' => 'MultiPolygon', 'coordinates' => $vieleTeile], 64, 16);
$reichBlaetter = ringeTestBlaetter($reich['geometrie']);
assert(count($reichBlaetter) === 12, 'alle zwoelf Teile bleiben -- der Deckel liegt bei 16');
$pruefungen++;
assert($reich['verworfene_teile'] === 0, 'unter dem Deckel wird nichts verworfen');
$pruefungen++;
$summe = 0;
foreach ($reichBlaetter as $blatt) {
    $summe += count($blatt);
    assert(count($blatt) >= AVESMAPS_GARETIEN_ABSCHNITT_RING_MINDEST,
        'kein Ring faellt unter die Mindestzahl -- ein Ring aus zwei Punkten ist keine Flaeche mehr');
}
$pruefungen++;
// Der groesste Ring muss den groessten Anteil bekommen -- eine Gleichverteilung machte aus dem
// 800-Punkte-Umriss eine Raute und blaehte die 14-Punkte-Insel auf.
assert(count($reichBlaetter[0]) > count($reichBlaetter[11]),
    'das Budget wird nach der GROESSE verteilt, nicht gleichmaessig');
$pruefungen++;
// Die Obergrenze bindet die Nutzlast: Budget + Mindestzahl je Ring.
$obergrenze = 64 + count($reichBlaetter) * AVESMAPS_GARETIEN_ABSCHNITT_RING_MINDEST;
assert($summe <= $obergrenze,
    'die Punktzahl bleibt unter Budget + Mindestzahl je Ring (ist ' . $summe . ', erlaubt ' . $obergrenze . ')');
$pruefungen++;

// =================================================================================================
// 6. Mehr Teile als der Deckel: die GROESSTEN ueberleben, und die Kappung wird GEMELDET
// =================================================================================================
// AGENTS.md §9, "No silent caps": eine stille Kappung liest sich wie "das ist alles".
$zwanzig = [];
for ($nr = 0; $nr < 20; $nr++) {
    // Der letzte ist der groesste -- so belegt der Test auch, dass NICHT einfach vorn abgeschnitten wird.
    $zwanzig[] = [ringeTestKreis(4 + $nr * 3, $nr * 1000.0)];
}
$gekappt = avesmapsGaretienGeoJsonTeile(['type' => 'MultiPolygon', 'coordinates' => $zwanzig], 64, 16);
assert(count($gekappt['geometrie']) === 16,
    'ueber dem Deckel bleiben genau so viele Teile wie der Deckel erlaubt');
$pruefungen++;
assert($gekappt['verworfene_teile'] === 4, 'die Zahl der verworfenen Teile wird GENANNT, nie verschwiegen');
$pruefungen++;
// Der groesste Teil (nr = 19, x um 19000) muss dabei sein, der kleinste (nr = 0, x um 0) nicht.
$xWerte = [];
foreach (ringeTestBlaetter($gekappt['geometrie']) as $blatt) {
    $xWerte[] = round($blatt[0][0] / 1000);
}
assert(in_array(19.0, $xWerte, true), 'der GROESSTE Teil ueberlebt die Kappung');
$pruefungen++;
assert(!in_array(0.0, $xWerte, true), 'der kleinste Teil faellt heraus');
$pruefungen++;
// Die Reihenfolge der Ueberlebenden bleibt die der Eingabe -- sonst zeichnete jeder Lauf anders.
$sortiert = $xWerte;
sort($sortiert);
assert($xWerte === $sortiert, 'die Ueberlebenden behalten die Reihenfolge der Eingabe');
$pruefungen++;

// =================================================================================================
// 7. Unfug faellt leer aus, statt zu werfen
// =================================================================================================
assert(avesmapsGaretienGeoJsonTeile(null, 64, 16) === ['geometrie' => [], 'verworfene_teile' => 0],
    'null ergibt eine leere Geometrie, keine Ausnahme');
$pruefungen++;
assert(avesmapsGaretienGeoJsonTeile('kein json', 64, 16)['geometrie'] === [],
    'kaputtes JSON ergibt eine leere Geometrie');
$pruefungen++;
// Aus einer Zeichenkette gelesen -- so liegt die Geometrie in der Datenbank.
$ausText = avesmapsGaretienGeoJsonTeile(json_encode($zweiTeile), 64, 16);
assert(count(ringeTestBlaetter($ausText['geometrie'])) === 2, 'auch als JSON-Zeichenkette');
$pruefungen++;

// =================================================================================================
// 8. DIE VERDRAHTUNG: der Abschnitt im Fenster traegt die Ringe, nicht die flache Liste
// =================================================================================================
// 💣 Ohne diesen Abschnitt belegt der ganze Test nur, dass eine Funktion existiert, die niemand
// ruft -- genau die Vakuum-Zusicherung, an der dieses Vorhaben schon mehrfach vorbeigeschrammt
// ist. Gemessen wird deshalb an avesmapsGaretienAbschnitte, dem einzigen Erzeuger der Geometrie,
// die ins Fenster reist.
$kandidatMulti = [
    'public_id' => 'eco-1',
    'name' => 'Reichsforst',
    'geo' => json_encode($zweiTeile),
    'punkte' => avesmapsGaretienGeoJsonPunkte($zweiTeile),
    'label_public_id' => 'lbl-1',
];
$ausAbschnitt = avesmapsGaretienAbschnitte(
    ['abschnitte' => [['index' => 0, 'punkte' => 7]]],
    [$kandidatMulti]
);
assert(count($ausAbschnitt) === 1, 'ein getroffener Kandidat ergibt einen Abschnitt');
$pruefungen++;
assert(count(ringeTestBlaetter($ausAbschnitt[0]['geometrie'])) === 2,
    'der Abschnitt traegt ZWEI getrennte Ringe -- nicht eine flache Liste');
$pruefungen++;
assert($ausAbschnitt[0]['verworfene_teile'] === 0,
    'die Zahl der verworfenen Teile reist mit, damit eine Kappung im Fenster nennbar ist');
$pruefungen++;
// Die alte Form darf NICHT mehr herauskommen -- sonst waere oben alles gruen und live nichts anders.
assert(!avesmapsGaretienGeoJsonIstPunktliste($ausAbschnitt[0]['geometrie']),
    'die Geometrie des Abschnitts ist keine flache Punktliste mehr');
$pruefungen++;

// =================================================================================================
// 9. Die Auskunft ueberlebt den Weg ins Fenster -- BEIDE Zweige der Vereinigung
// =================================================================================================
// 💣 avesmapsGaretienListeAbschnitteVereinen legt die Item-Fassung UEBER die gespeicherte. Traegt
// die Item-Fassung das Feld nicht, gewinnt zwar im ersten Zweig noch der gespeicherte Wert
// (array_merge) -- im ZWEITEN Zweig (ein Abschnitt, den nur ein Item nennt) faellt er ersatzlos
// weg. Eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel.
$vereint = avesmapsGaretienListeAbschnitteVereinen(
    [['public_id' => 'a', 'name' => 'A', 'punkte' => 3, 'geometrie' => [], 'verworfene_teile' => 4]],
    [
        'a' => ['public_id' => 'a', 'name' => 'A', 'punkte' => 3, 'geometrie' => [], 'verworfene_teile' => 4],
        'b' => ['public_id' => 'b', 'name' => 'B', 'punkte' => 1, 'geometrie' => [], 'verworfene_teile' => 7],
    ]
);
$nachId = [];
foreach ($vereint as $eintrag) {
    $nachId[$eintrag['public_id']] = $eintrag;
}
assert(($nachId['a']['verworfene_teile'] ?? null) === 4,
    'die Kappung ueberlebt die Vereinigung eines gespeicherten mit einem Item-Abschnitt');
$pruefungen++;
assert(($nachId['b']['verworfene_teile'] ?? null) === 7,
    'und auch bei einem Abschnitt, den NUR ein Item nennt -- der zweite Zweig');
$pruefungen++;

echo "OK -- garetien-ringe-test.php, {$pruefungen} Zusicherungen\n";
