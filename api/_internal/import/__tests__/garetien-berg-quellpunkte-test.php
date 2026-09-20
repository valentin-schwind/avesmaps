<?php

declare(strict_types=1);

// Ein PUNKTZIEL MIT POLYGON muss seine rohe Punktliste bis in den Browser tragen (Discord #135).
//
// 🔴 DER BEFUND (Owner/Alrik 20.09.2026, nach dem Fix von 14:36): „Berge über Donfanger" blieb ein
// einzelner Gipfel. Die Vorbelegungsregel im Fenster (`garetienZielVorbelegung`) war richtig gebaut
// und konnte doch NIE greifen -- ihr fehlte die Fläche, aus der sie entscheidet.
//
// 💣 DIE FUGE WAR DER FEHLER, NICHT DIE REGEL. Die Arbeitsliste baute `geometrie` aus
// `after.geometry`, also der ZIEL-Geometrie. Ein `Berg` wird laut AVESMAPS_GARETIEN_TYP_MAP ein
// Punkt-Label, sein `after.geometry` ist deshalb ein GeoJSON-`Point` -- und
// `avesmapsGaretienListeGeometriePunkte` liefert dafür genau EINEN Punkt. Im Browser rechnet
// `garetienFlaecheMeilen2` daraus 0 (sie braucht drei), der Riegel `if (flaeche <= 0) return
// vorschlag;` greift, und die Aufwärtsregel läuft für JEDES der 78 `Berg`-Polygone ins Leere.
//
// 🔴 DIE PUNKTLISTE GAB ES SCHON -- sie kam nur nie an. `avesmapsGaretienBaueSyncPlan` legt sie als
// `after.punkte` ab, ausdrücklich für diesen Fall („wechselt ein Editor es spaeter auf Flaeche oder
// Weg, laesst sich daraus nichts zurueckrechnen"). In die Listen-Nutzlast wanderte sie nicht: das
// einzige `punkte` dort ist eine ANZAHL je Abschnitt.
//
// ⚠️ WARUM DER TEST DES FIXES GRÜN WAR: seine Fixture setzt `geometrie: quadrat(...)` -- ein Feld,
// das für ein Punktziel in der Realität nie ein Polygon trägt. Er prüfte die Regel, nicht die Fuge,
// durch die ihre Daten kommen müssten. Deshalb misst DIESER Test den Transport und
// js/review/__tests__/garetien-berg-vorbelegung-fuge.test.js die Fuge selbst.
//
// 🔴 `geometrie` BLEIBT UNANGETASTET. Sie gehört der Karte: zusammen mit `geometrie_typ` entscheidet
// sie, ob ein Objekt als Fläche oder als Linie gezeichnet wird. Trüge sie für einen Berg plötzlich
// 40 Punkte, zeichnete das Fenster jeden Gipfel als Umriss -- genau die Regression, die der
// Kommentar an `geometrie_typ` beschreibt (113 Flächen der Stufe 1). Die Quellpunkte reisen deshalb
// unter EIGENEM Namen.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-berg-quellpunkte-test.php

require_once __DIR__ . '/../garetien-liste.php';

$pruefungen = 0;

$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();

// Eine `Berg`-Zeile MIT Polygon -- die Bauart der 78 gemeldeten Zeilen. Sie wird zur Laufzeit
// eingefügt, nicht in die geteilte Fixture geschrieben: deren Zeilenzahl ist in fremden Tests
// festgenagelt, und ein Zuwachs dort hat in diesem Haus schon zweimal fremde Läufe gebrochen.
// ⚠️ Die Punkte liegen bewusst neben den bestehenden Fixture-Zeilen, damit
// `avesmapsGaretienLiegtAufDerKarte` sie nicht als kartenfern verwirft.
$ins = $pdo->prepare('INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige, lodmin, lodmax, extra, geo_art, geo, roh)
                      VALUES (1,?,?,?,?,?,?,?,\'\',\'\',\'\',?,?,\'\')');
$ins->execute(['ggp', 'Berge', 91, 'Berg', 'Garetien', 'Berge über Donfanger', 'Berge über Donfanger',
    'koordinaten', '20000 10300, 20800 10300, 20800 11100, 20000 11100']);

avesmapsGaretienBaueSyncPlan($pdo, 1, 1);

$liste = avesmapsGaretienArbeitsliste($pdo, 1, []);
$berg = null;
foreach ($liste['objekte'] as $o) {
    if ((string) ($o['name'] ?? '') === 'Berge über Donfanger') {
        $berg = $o;
        break;
    }
}

// --- Vorbedingungen: ohne sie prüfte der Rest gegen leere Werte -------------------------------
assert($berg !== null, 'die Vorbedingung: die Berg-Zeile steht in der Arbeitsliste');
$pruefungen++;
assert((string) ($berg['typ'] ?? '') === 'Berg', 'die Vorbedingung: sie trägt den Quelltyp Berg');
$pruefungen++;
assert((string) ($berg['ziel'] ?? '') === 'label' && (string) ($berg['subtyp'] ?? '') === 'berggipfel',
    'die Vorbedingung: die Zuordnungstabelle macht daraus bedingungslos ein Gipfel-Label');
$pruefungen++;

// --- Die Karte behält, was sie hatte ------------------------------------------------------------
// 🔴 EIN Punkt, und `geometrie_typ` sagt "Point". Wer hier mehr einträgt, zeichnet Gipfel als Umriss.
assert(count((array) ($berg['geometrie'] ?? [])) === 1,
    'geometrie bleibt die MITTE des Punktziels -- sie gehört der Karte, nicht der Vorbelegung');
$pruefungen++;
assert((string) ($berg['geometrie_typ'] ?? '') === 'Point',
    'und geometrie_typ bleibt Point');
$pruefungen++;

// --- Die eigentliche Zusicherung: die Quellpunkte reisen mit -------------------------------------
$quell = (array) ($berg['quellpunkte'] ?? []);
assert($quell !== [], 'DIE FUGE: das Punktziel trägt seine rohe Punktliste als `quellpunkte` mit (Discord #135)');
$pruefungen++;
assert(count($quell) >= 3,
    'und zwar vollständig genug für eine Fläche -- unter drei Punkten kann der Browser keine rechnen');
$pruefungen++;
foreach ($quell as $paar) {
    assert(is_array($paar) && count($paar) === 2 && is_numeric($paar[0]) && is_numeric($paar[1]),
        'jeder Eintrag ist ein [x,y]-Paar in Karteneinheiten -- dieselbe Form wie `geometrie`');
}
$pruefungen++;

// --- Und nur dort, wo sie sonst verloren ginge ----------------------------------------------------
// 🔴 Eine FLÄCHE trägt ihre Punkte schon in `geometrie`; ein zweites Mal wären sie nur Nutzlast.
// Dieselbe Bedingung, unter der der Planbau `after.punkte` überhaupt anlegt.
$flaeche = null;
foreach ($liste['objekte'] as $o) {
    if ((string) ($o['geometrie_typ'] ?? '') === 'Polygon') {
        $flaeche = $o;
        break;
    }
}
assert($flaeche !== null, 'die Vorbedingung: die Fixture enthält wenigstens eine Fläche');
$pruefungen++;
assert((array) ($flaeche['quellpunkte'] ?? []) === [],
    'eine Fläche trägt KEINE Quellpunkte -- ihre Liste steht bereits in `geometrie`');
$pruefungen++;

echo "OK -- {$pruefungen} Zusicherungen (Discord #135: die Quellpunkte eines Punktziels reisen mit)\n";
