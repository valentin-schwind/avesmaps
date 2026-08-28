<?php

declare(strict_types=1);

// JEDER GETROFFENE ABSCHNITT REIST MIT -- auch der, der kein Item erzeugt (Aufgabe 13b).
//
// 💣 DER FALL, WEGEN DESSEN DER OWNER DIE EINZELANSICHT BESTELLT HAT. Ihre eine „Natter" laeuft
// ueber DREI unserer Abschnitte -- unsere Natter, den Gardel und einen namenlosen. Nur ZWEI davon
// erzeugen ein sync_plan_item: der Gardel traegt einen Namen, der weder leer noch gleich ist, und
// ihr Objekt laeuft ueber mehrere unserer (kein `einObjekt`) -- er bekommt konstruktionsbedingt
// weder ein Luecken- noch ein Umbenennungs-Item. Baut die Arbeitsliste ihre `abschnitte` allein
// aus den Items, kommt er nie an: ein DREIteiliger Fall sieht wie ein ZWEIteiliger aus, und der
// Zustand `is-full` („nichts zu ersetzen") der Einzelansicht ist unerreichbar.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-abschnitte-vollstaendig-test.php

require_once __DIR__ . '/../garetien-liste.php';

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$pruefungen = 0;

// ---------------------------------------------------------------------------------------------
// Der Pruefstand: die GETEILTE Fixture aus garetien-plan.php, um den Owner-Fall erweitert.
// ⚠️ Kein zweiter Pruefstand -- zwei Fassungen desselben Aufbaus laufen auseinander, und dann
// prueft der eine etwas anderes als der andere (die Begruendung steht an avesmapsGaretienPlanTestPdo).
// ---------------------------------------------------------------------------------------------

/**
 * Ihre Linie in Wagenhalt-Koordinaten: 16 Punkte, gleichmaessig. 💣 GENAU 16, damit
 * avesmapsGaretienProbepunkte() nichts ausduennt und jeder ihrer Punkte ein Probepunkt ist --
 * nur so ist die Verteilung 9/6/1 unten wirklich gerechnet und nicht zufaellig getroffen.
 */
function garetienTestNatterPunkte(): array
{
    $punkte = [];
    for ($i = 0; $i < 16; $i++) {
        $punkte[] = [40000 + (400 * $i), 20000 + (400 * $i)];
    }

    return $punkte;
}

/** Dieselben Punkte als `geo`-Zeichenkette der Staging-Zeile. */
function garetienTestNatterGeo(): string
{
    $teile = [];
    foreach (garetienTestNatterPunkte() as [$gx, $gy]) {
        $teile[] = $gx . ' ' . $gy;
    }

    return implode(', ', $teile);
}

function garetienTestPruefstand(): PDO
{
    $pdo = avesmapsGaretienPlanTestPdo();
    $alle = garetienTestNatterPunkte();

    // Unsere drei Abschnitte liegen GENAU auf ihren Punkten -- Abstand 0. Der Abgleich soll hier
    // nicht die Toleranz pruefen (das tut garetien-abgleich-test.php), sondern die Aufteilung.
    //   w-4471  „Natter"   traegt ihre Punkte 0..8   -> 9 Probepunkte
    //   w-5008  „Gardel"   traegt ihre Punkte 9..14  -> 6 Probepunkte, und KEIN Item
    //   w-6120  ohne Namen traegt ihren Punkt  15    -> 1 Probepunkt
    $abschnitte = [
        ['w-4471', 'Natter', array_slice($alle, 0, 9)],
        ['w-5008', 'Gardel', array_slice($alle, 9, 6)],
        ['w-6120', '', array_slice($alle, 15, 1)],
    ];
    $ins = $pdo->prepare(
        'INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json)'
        . ' VALUES (?,?,?,?,?,?)'
    );
    foreach ($abschnitte as [$publicId, $name, $punkte]) {
        $ins->execute([$publicId, $name, 'path', 'Flussweg', json_encode(
            ['type' => 'LineString', 'coordinates' => avesmapsGaretienLinieNachAvesmaps($punkte)],
            JSON_UNESCAPED_UNICODE
        ), '{}']);
    }

    // Ihre Zeile. `zeile_nr` 7 -- die geteilte Fixture belegt 1..6.
    $pdo->prepare(
        'INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige,'
        . ' lodmin, lodmax, extra, geo_art, geo, roh)'
        . " VALUES (1,'ggp','Gewaesser',7,'Fluss','Garetien','Natter','Natter','5','14','','koordinaten',?,'')"
    )->execute([garetienTestNatterGeo()]);

    // ---------------------------------------------------------------------------------------
    // 🔴 DREI WEITERE URTEILSARTEN, damit die Regel „wann reist die Trefferliste mit?" an JEDER
    // einzeln geprueft wird und nicht nur am Owner-Fall.
    //
    // 💣 Der Huellbox-Vorfilter in avesmapsGaretienDeckung ist KEINE Naehe-Pruefung: er
    // vergleicht Rechtecke, nicht Abstaende. Ein Objekt, dessen Huelle unsere ueberlappt, das
    // aber Dutzende Karteneinheiten entfernt liegt, bekommt trotzdem eine Trefferliste.
    // ---------------------------------------------------------------------------------------

    // (1) FERNFLUSS -- Urteil `neu`. Zwei weit auseinanderliegende Punkte, deren Huelle unseren
    // Bestand UMSCHLIESST, waehrend jeder einzelne Punkt rund 45 Karteneinheiten entfernt ist.
    $pdo->prepare(
        'INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige,'
        . ' lodmin, lodmax, extra, geo_art, geo, roh)'
        . " VALUES (1,'ggp','Gewaesser',10,'Fluss','Garetien','Fernfluss','Fernfluss','','','','koordinaten',"
        . "'-100000 100000, 120000 -80000','')"
    )->execute();

    // (2) NAHARTIKEL -- Urteil `deckt_sich` ueber den ARTIKELNAMEN, nicht ueber die Geometrie.
    // 🔴 Der Artikel steht in properties_json; avesmapsGaretienArtikelTrifft sucht ihn dort.
    $nah = [[600000, 600000], [601000, 601000], [602000, 602000]];
    $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json) VALUES (?,?,?,?,?,?)')
        ->execute(['w-nah', 'Nahfluss', 'path', 'Flussweg', json_encode(
            ['type' => 'LineString', 'coordinates' => avesmapsGaretienLinieNachAvesmaps($nah)], JSON_UNESCAPED_UNICODE),
            '{"wiki_url":"https://www.garetien.de/index.php?title=Garetien:Nahartikel"}']);
    $pdo->prepare(
        'INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige,'
        . ' lodmin, lodmax, extra, geo_art, geo, roh)'
        . " VALUES (1,'ggp','Gewaesser',11,'Fluss','Garetien','Nahartikel','Nahartikel','','','','koordinaten',"
        . "'600000 600000, 601000 601000, 602000 602000','')"
    )->execute();

    // (3) FERNARTIKEL -- Urteil `widerspricht`/`artikel_widerspruch`: derselbe Artikel behauptet
    // ZWEI Stellen. 💣 Genau dieser Fall MUSS seine Abschnitte behalten -- die weit entfernte
    // Stelle ist das, was ein Editor sehen soll. Eine Filterung auf die 2,0-Schwelle naehme sie ihm.
    $fern = [[300000, 300000], [301000, 301000]];
    $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json) VALUES (?,?,?,?,?,?)')
        ->execute(['w-fern', 'Fernartikelfluss', 'path', 'Flussweg', json_encode(
            ['type' => 'LineString', 'coordinates' => avesmapsGaretienLinieNachAvesmaps($fern)], JSON_UNESCAPED_UNICODE),
            '{"wiki_url":"https://www.garetien.de/index.php?title=Garetien:Fernartikel"}']);
    $pdo->prepare(
        'INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige,'
        . ' lodmin, lodmax, extra, geo_art, geo, roh)'
        . " VALUES (1,'ggp','Gewaesser',12,'Fluss','Garetien','Fernartikel','Fernartikel','','','','koordinaten',"
        . "'280000 280000, 320000 320000','')"
    )->execute();

    return $pdo;
}

/** Das Objekt „Natter" aus der Arbeitsliste. */
function garetienTestNatter(PDO $pdo): array
{
    foreach (avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte'] as $objekt) {
        if ($objekt['key'] === 'ggp:Gewaesser:Fluss:Garetien:Natter') {
            return $objekt;
        }
    }
    assert(false, 'die Natter fehlt in der Arbeitsliste -- der Pruefstand ist kaputt');

    return [];
}

$pdo = garetienTestPruefstand();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);
$objekt = garetienTestNatter($pdo);

// --- Die VORBEDINGUNG des Falls: genau ZWEI der drei Abschnitte erzeugen ein Item. Ohne sie
// belegt der Rest nichts -- eine Zusicherung ueber „der ohne Item kommt an" ist wertlos, wenn
// gar kein Abschnitt ohne Item existiert (die Vakuum-Falle dieses Vorhabens).
$itemIds = [];
foreach ($objekt['items'] as $item) {
    if (is_array($item['abschnitt'] ?? null)) {
        $itemIds[(string) $item['abschnitt']['public_id']] = true;
    }
}
assert(count($itemIds) === 2,
    'die Vorbedingung: genau ZWEI Abschnitte duerfen ein Item tragen, es sind '
    . count($itemIds) . ' (' . implode(', ', array_keys($itemIds)) . ')');
assert(!isset($itemIds['w-5008']),
    'der Gardel darf KEIN Item tragen -- sonst prueft dieser Test den Owner-Fall gar nicht');
$pruefungen += 2;

// --- 💣 Ihr EINES Objekt laeuft ueber DREI unserer Abschnitte, aber nur ZWEI erzeugen ein Item.
// Ohne die gespeicherte Trefferliste zeigt das Fenster zwei -- und der Editor haelt den Fall
// fuer zweiteilig. Genau diese Auskunft ist der Grund fuer die Einzelansicht.
assert(count($objekt['abschnitte']) === 3,
    'es kommen ' . count($objekt['abschnitte']) . ' Abschnitte an statt drei -- der ohne Item fehlt');
$ids = array_column($objekt['abschnitte'], 'public_id');
assert(in_array('w-5008', $ids, true), 'der getroffene Abschnitt OHNE Item fehlt');
$pruefungen += 2;

// --- Und er kommt VOLLSTAENDIG an, nicht als leere Huelse: sein Name und seine Deckung sind die
// Auskunft, an der ein Editor sieht, dass hier NICHTS zu ersetzen ist.
$nachId = [];
foreach ($objekt['abschnitte'] as $abschnitt) {
    $nachId[$abschnitt['public_id']] = $abschnitt;
}
assert($nachId['w-5008']['name'] === 'Gardel',
    'der Abschnitt ohne Item traegt seinen Namen: ' . json_encode($nachId['w-5008']['name']));
assert($nachId['w-5008']['punkte'] === 6,
    'der Abschnitt ohne Item traegt seine Deckung: ' . $nachId['w-5008']['punkte']);
assert(count((array) $nachId['w-5008']['geometrie']) > 0,
    'der Abschnitt ohne Item traegt seine Geometrie -- ohne sie kann ihn niemand auf der Karte zeigen');
$pruefungen += 3;

// --- Die Reihenfolge ist die des Abgleichs: der am meisten abdeckende zuerst (arsort in
// avesmapsGaretienDeckung). Ein Editor liest von oben.
assert(array_column($objekt['abschnitte'], 'punkte') === [9, 6, 1],
    'die Abschnitte stehen nicht nach Deckung absteigend: '
    . json_encode(array_column($objekt['abschnitte'], 'punkte')));
$pruefungen++;

// ---------------------------------------------------------------------------------------------
// ⚠️ DIE GEGENPROBE, die belegt, dass der Test nicht schon vorher gruen war. Dieselbe
// Zusicherung gegen einen Bestand OHNE gespeicherte Trefferliste muss ZWEI ergeben -- sonst ist
// nicht belegt, dass die neue Spalte ueberhaupt etwas bewirkt.
// 💣 `zeile_nr` ALLEIN ist kein Schluessel (Review C1, garetien-plan.php): sie beginnt je SEITE
// neu. Auch dieses UPDATE nennt deshalb `wiki` und `ebene`.
// ---------------------------------------------------------------------------------------------
$pdo->prepare('UPDATE garetien_import_row SET abschnitte_json = NULL'
    . ' WHERE run_id = 1 AND wiki = :w AND ebene = :e AND zeile_nr = 7')
    ->execute([':w' => 'ggp', ':e' => 'Gewaesser']);
$ohne = garetienTestNatter($pdo);
assert(count($ohne['abschnitte']) === 2,
    'die Gegenprobe belegt nichts: OHNE die gespeicherte Liste muessten ZWEI Abschnitte ankommen,'
    . ' es sind ' . count($ohne['abschnitte']) . ' -- dann war der Test oben auch vorher schon gruen');
assert(!in_array('w-5008', array_column($ohne['abschnitte'], 'public_id'), true),
    'ohne die gespeicherte Liste darf der Abschnitt OHNE Item gerade NICHT ankommen');
assert((int) $ohne['probepunkte'] === 0,
    'ohne die gespeicherte Liste gibt es keinen Nenner -- er faellt auf 0, und die Anzeige laesst'
    . ' „von N" dann weg statt eine falsche Zahl zu behaupten: ' . $ohne['probepunkte']);
$pruefungen += 3;

// --- Der Bestand OHNE die SPALTE (Laeufe von vor dem Nachzug) muss weiter funktionieren:
// derselbe Stand wie heute, kein Wurf. 💣 Die Spalte wirklich WEGNEHMEN, nicht nur leeren --
// nur so ist der offene Ausfall des Lesewegs belegt.
$ohneSpalte = garetienTestPruefstand();
avesmapsGaretienBaueSyncPlan($ohneSpalte, 1, 1);
$ohneSpalte->exec('ALTER TABLE garetien_import_row DROP COLUMN abschnitte_json');
$altbestand = garetienTestNatter($ohneSpalte);
assert(count($altbestand['abschnitte']) === 2,
    'ohne die Spalte gilt genau das heutige Verhalten (zwei Abschnitte aus den Items), es sind '
    . count($altbestand['abschnitte']));
assert($altbestand['grund'] !== '',
    'ohne die Spalte muessen die uebrigen Felder der Staging-Zeile weiter ankommen -- der Rueckfall'
    . ' darf nicht die ganze Zeile verlieren');
$pruefungen += 2;

// --- Und der Planbau HEILT einen Lauf, der die Spalte noch nicht traegt. 💣 Ohne den Nachzug
// im Planbau braeche das erste UPDATE den ganzen Lauf ab -- und zwar erst live, an einem Import,
// der vor dem 28.08.2026 abgerufen wurde und ohne neuen Abruf noch einmal gerechnet wird.
// 🪤 Die geteilte Fixture kann das NICHT zeigen: sie ruft avesmapsGaretienEnsureUrteilSpalten
// selbst. Die Spalte muss dafuer wirklich weggenommen werden.
$vorNachzug = garetienTestPruefstand();
$vorNachzug->exec('ALTER TABLE garetien_import_row DROP COLUMN abschnitte_json');
avesmapsGaretienBaueSyncPlan($vorNachzug, 1, 1);
$geheilt = garetienTestNatter($vorNachzug);
assert(count($geheilt['abschnitte']) === 3,
    'der Planbau muss die Spalte selbst nachziehen -- sonst bricht er an einem alten Lauf ab: '
    . count($geheilt['abschnitte']));
$pruefungen++;

// ---------------------------------------------------------------------------------------------
// VEREINIGEN, NICHT ERSETZEN -- und der ITEM-Abschnitt gewinnt Feld fuer Feld.
//
// 💣 Belegt an einer WIRKUNG, nicht an der Form: die gespeicherte Liste bekommt zwei
// Kennzeichen-Werte. Kommt bei w-4471 (MIT Item) die 9 an, hat wirklich das Item gewonnen; kommt
// bei w-5008 (OHNE Item) die 777 an, ist wirklich die gespeicherte Liste die Quelle. Eine
// Zusicherung, die nur „drei Abschnitte" zaehlt, koennte beides nicht unterscheiden.
// ---------------------------------------------------------------------------------------------
$gemischt = garetienTestPruefstand();
avesmapsGaretienBaueSyncPlan($gemischt, 1, 1);
$roh = $gemischt->query("SELECT abschnitte_json FROM garetien_import_row"
    . " WHERE run_id = 1 AND wiki = 'ggp' AND ebene = 'Gewaesser' AND zeile_nr = 7")->fetchColumn();
$gespeichert = json_decode((string) $roh, true);
assert(is_array($gespeichert) && isset($gespeichert['abschnitte']) && count($gespeichert['abschnitte']) === 3,
    'die gespeicherte Trefferliste traegt alle drei Abschnitte: ' . (string) $roh);
$pruefungen++;
foreach ($gespeichert['abschnitte'] as $i => $eintrag) {
    if ($eintrag['public_id'] === 'w-4471') {
        $gespeichert['abschnitte'][$i]['punkte'] = 999;
    }
    if ($eintrag['public_id'] === 'w-5008') {
        $gespeichert['abschnitte'][$i]['punkte'] = 777;
    }
}
$gemischt->prepare('UPDATE garetien_import_row SET abschnitte_json = :j'
    . " WHERE run_id = 1 AND wiki = 'ggp' AND ebene = 'Gewaesser' AND zeile_nr = 7")
    ->execute([':j' => json_encode($gespeichert, JSON_UNESCAPED_UNICODE)]);

$vereint = garetienTestNatter($gemischt);
$vereintNachId = [];
foreach ($vereint['abschnitte'] as $abschnitt) {
    $vereintNachId[$abschnitt['public_id']] = $abschnitt;
}
assert(count($vereint['abschnitte']) === 3, 'die Vereinigung darf keinen Abschnitt verlieren');
assert($vereintNachId['w-4471']['punkte'] === 9,
    'bei gleicher public_id gewinnt der ITEM-Abschnitt -- er ist der handlungsrelevante: '
    . $vereintNachId['w-4471']['punkte']);
assert($vereintNachId['w-5008']['punkte'] === 777,
    'der Abschnitt OHNE Item kommt wirklich aus der gespeicherten Liste: '
    . $vereintNachId['w-5008']['punkte']);
$pruefungen += 3;

// --- Und das Vereinigen ist FELDWEISE: `name_gleich` steht nur in der gespeicherten Liste (der
// Namensvergleich gehoert dem Abgleich, nicht dem Item) und muss ein Ersetzen ueberleben.
assert($vereintNachId['w-4471']['name_gleich'] === true,
    'der Namensbefund des Abgleichs geht beim Vereinigen verloren -- ein Ersetzen statt Vereinigen');
assert($vereintNachId['w-5008']['name_gleich'] === false,
    'der Gardel heisst anders als ihre Natter -- sein Namensbefund muss false sein');
$pruefungen += 2;

// ---------------------------------------------------------------------------------------------
// LUECKE 2: die Felder des Mockups §3 reisen mit.
// ---------------------------------------------------------------------------------------------

// --- Die Quelle, die mitreist. 🔴 Sie kommt als DATEN aus dem after_json (Lizenz und
// Namensnennung sind eine Owner-Entscheidung, keine Regel im Renderer).
assert(($objekt['quelle']['label'] ?? '') === 'Briefspiel (Garetien)',
    'die Beschriftung der Quelle fehlt: ' . json_encode($objekt['quelle'] ?? null));
assert(($objekt['quelle']['attribution'] ?? '') === 'VolkoV / garetien.de',
    'die Namensnennung fehlt: ' . json_encode($objekt['quelle'] ?? null));
assert(($objekt['quelle']['license'] ?? '') === 'cc-by-nc-sa-3.0',
    'die Lizenz fehlt: ' . json_encode($objekt['quelle'] ?? null));
$pruefungen += 3;

// --- Als WAS wir es anlegen wuerden. Ohne `subtyp` sagt der Kopf „Fluss" statt „Fluss → Flussweg".
assert($objekt['subtyp'] === 'Flussweg', 'der Zielsubtyp fehlt: ' . json_encode($objekt['subtyp']));
$pruefungen++;

// --- Der Artikelname am Link. 💣 Er wird NICHT neu gebildet: `avesmapsGaretienSeitenNameAusZeile`
// ist der eine Erzeuger, den auch der Objektschluessel und die Wiki-Adresse benutzen.
assert($objekt['seite'] === 'Garetien:Natter', 'der Artikelname fehlt: ' . json_encode($objekt['seite']));
assert($objekt['seite'] !== '' && str_contains($objekt['wiki_url'], 'Garetien:Natter'),
    'Artikelname und Adresse muessen dieselbe Seite nennen: ' . $objekt['wiki_url']);
$pruefungen += 2;

// --- Deckung und Nenner. 🔴 Beide kommen vom SERVER: der Deckungsgrad ist das Ergebnis des
// Abgleichs, und der Nenner ist die Zahl der wirklich verglichenen Probepunkte -- ihre
// Geometrielaenge ist es NICHT (avesmapsGaretienProbepunkte duennt auf hoechstens 16 aus).
assert(is_float($objekt['deckung']) && $objekt['deckung'] < 0.001,
    'unsere Abschnitte liegen genau auf ihren Punkten -- der Median muss 0 sein: '
    . json_encode($objekt['deckung']));
assert($objekt['probepunkte'] === 16,
    'der Nenner ist die Zahl der verglichenen Probepunkte: ' . $objekt['probepunkte']);
assert($objekt['probepunkte'] === array_sum(array_column($objekt['abschnitte'], 'punkte')),
    'der Nenner muss die Summe der Abschnittsdeckungen sein -- sonst stuende „9 von 16" ueber einer'
    . ' anderen Rechnung als die Zeilen darunter');
$pruefungen += 3;

// --- 💣 Und genau daran, dass der Nenner NICHT ihre Punktzahl ist: ihre Linie traegt 16 Punkte,
// aber die Karte darf laenger sein. Eine zweite Zeile mit 40 Punkten belegt, dass der Nenner bei
// 16 stehen bleibt -- `objekt.geometrie.length` waere hier 40 und „9 von 40" schlicht falsch.
$lang = avesmapsGaretienPlanTestPdo();
$langePunkte = [];
for ($i = 0; $i < 40; $i++) {
    $langePunkte[] = [40000 + (100 * $i), 20000 + (100 * $i)];
}
$lang->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json)'
    . ' VALUES (?,?,?,?,?,?)')
    ->execute(['w-lang', 'Langfluss', 'path', 'Flussweg', json_encode(
        ['type' => 'LineString', 'coordinates' => avesmapsGaretienLinieNachAvesmaps($langePunkte)],
        JSON_UNESCAPED_UNICODE
    ), '{}']);
$langGeo = [];
foreach ($langePunkte as [$gx, $gy]) {
    $langGeo[] = $gx . ' ' . $gy;
}
$lang->prepare(
    'INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige,'
    . ' lodmin, lodmax, extra, geo_art, geo, roh)'
    . " VALUES (1,'ggp','Gewaesser',8,'Fluss','Garetien','Langfluss','Langfluss','','','','koordinaten',?,'')"
)->execute([implode(', ', $langGeo)]);
avesmapsGaretienBaueSyncPlan($lang, 1, 1);
$langObjekt = null;
foreach (avesmapsGaretienArbeitsliste($lang, 1, [])['objekte'] as $o) {
    if ($o['key'] === 'ggp:Gewaesser:Fluss:Garetien:Langfluss') {
        $langObjekt = $o;
    }
}
assert($langObjekt !== null, 'der Langfluss fehlt in der Liste');
assert(count($langObjekt['geometrie']) === 40,
    'die Vorbedingung: ihre Geometrie traegt wirklich 40 Punkte, nicht 16: ' . count($langObjekt['geometrie']));
assert($langObjekt['probepunkte'] === 16,
    'der Nenner bleibt bei den 16 verglichenen Probepunkten, er folgt NICHT ihrer Punktzahl: '
    . $langObjekt['probepunkte']);
$pruefungen += 3;

// --- Die uebrigen Objekte des Laufs bleiben unberuehrt: ein Objekt OHNE Treffer traegt keine
// erfundenen Zahlen. ⚠️ Ein 0-Nenner ist die Auskunft „nicht gemessen", keine Deckung von 0.
$gardel = null;
foreach (avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte'] as $o) {
    if ($o['name'] === 'Gardel') {
        $gardel = $o;
    }
}
assert($gardel !== null, 'der Gardel der geteilten Fixture fehlt');
assert($gardel['abschnitte'] === [], 'ein Neuzugang ohne Treffer hat keine Abschnitte');
assert($gardel['probepunkte'] === 0 && $gardel['deckung'] === null,
    'ohne Treffer gibt es weder Nenner noch Deckung -- eine 0,00 laese sich als „perfekt" lesen: '
    . json_encode([$gardel['probepunkte'], $gardel['deckung']]));
$pruefungen += 3;

// ---------------------------------------------------------------------------------------------
// 🔴 WANN REIST DIE TREFFERLISTE MIT? Genau dann, wenn der Abgleich ein Objekt von uns BENANNT
// hat (`treffer_public_id`) -- nicht bei jedem Urteil.
//
// 💣 DER FEHLER, DEN DAS VERHINDERT: `avesmapsGaretienDeckung` filtert die Kandidaten ueber die
// HUELLBOX, nicht ueber die Trefferschwelle von 2,0 Karteneinheiten. Ein `neu` bekam dadurch
// Phantom-Abschnitte, und die Einzelansicht schrieb drei einander widersprechende Saetze in EINEN
// Kasten: "Deckung Median 42,79", "nichts zu ersetzen" und daneben den Grund "liegt 42.79
// Einheiten entfernt". Ohne sie steht dort "Zu diesem Objekt steht kein Abschnitt von uns im
// Vorschlag." -- das ist die richtige Auskunft.
//
// 🔴 JEDE Urteilsart einzeln, mit ihrer gemessenen Zahl. Eine Aufzaehlung von Urteilsnamen im
// Code waere bei der naechsten Urteilsart still falsch; deshalb fragt die Regel, was der Abgleich
// BEHAUPTET -- und deshalb wird sie hier an allen Arten belegt, die es heute gibt.
// ---------------------------------------------------------------------------------------------
$nachSchluessel = [];
foreach (avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte'] as $o) {
    $nachSchluessel[$o['key']] = $o;
}

// (a) `neu` mit ueberlappender Huelle, aber ohne Naehe -- der Fall, um den es geht.
// Gemessen: OHNE den Riegel 2 Abschnitte / Deckung 42,79 (das Einundzwanzigfache der Schwelle),
// MIT ihm 0.
$fern = $nachSchluessel['ggp:Gewaesser:Fluss:Garetien:Fernfluss'] ?? null;
assert($fern !== null, 'der Fernfluss fehlt im Pruefstand');
assert($fern['urteil'] === 'neu', 'die Vorbedingung: der Fernfluss ist ein Neuzugang, kein Treffer: ' . $fern['urteil']);
assert($fern['abschnitte'] === [],
    'ein `neu` darf KEINE Abschnitte tragen -- die Huellbox ist ein Vorfilter, keine Naehe. Es sind '
    . count($fern['abschnitte']) . ' (ohne den Riegel 2)');
assert($fern['deckung'] === null && $fern['probepunkte'] === 0,
    'ohne benannten Treffer reist auch keine Deckung mit -- eine "Deckung Median 42,79" ueber'
    . ' "0 Abschnitte" waere derselbe Widerspruch eine Zeile hoeher: '
    . json_encode([$fern['deckung'], $fern['probepunkte']]));
$pruefungen += 4;

// (b) 💣 `widerspricht` ueber den ARTIKEL behaelt seine Abschnitte -- und genau daran haette eine
// Filterung auf die 2,0-Schwelle das Werkzeug kaputtgemacht: derselbe Artikel behauptet zwei
// Stellen, und die weit entfernte ist das, was ein Editor sehen soll. Gemessen: 1 Abschnitt bei
// 8,95 Einheiten, mit und ohne Riegel.
$fernArtikel = $nachSchluessel['ggp:Gewaesser:Fluss:Garetien:Fernartikel'] ?? null;
assert($fernArtikel !== null, 'der Fernartikel fehlt im Pruefstand');
assert($fernArtikel['urteil'] === 'widerspruch',
    'die Vorbedingung: derselbe Artikel behauptet zwei Stellen: ' . $fernArtikel['urteil']);
assert(count($fernArtikel['abschnitte']) === 1 && $fernArtikel['deckung'] > AVESMAPS_GARETIEN_TREFFER_EINHEITEN,
    'ein Widerspruch MUSS seine weit entfernte Stelle behalten -- sonst sieht der Editor nicht, worueber'
    . ' er entscheidet: ' . count($fernArtikel['abschnitte']) . ' Abschnitte bei '
    . json_encode($fernArtikel['deckung']));
$pruefungen += 3;

// (c) `zufluss` (in der Liste `zweifel`) behaelt seine ebenfalls -- der Treffer ist echt (0,18).
$zufluss = $nachSchluessel['ggp:Gewaesser:Bach:Garetien:Seitenarm der Alke'] ?? null;
assert($zufluss !== null && $zufluss['urteil'] === 'zweifel', 'der Zufluss fehlt oder traegt ein anderes Urteil');
assert(count($zufluss['abschnitte']) === 1 && $zufluss['deckung'] < 1.0,
    'ein Zufluss liegt WIRKLICH auf seinem Hauptfluss und behaelt seinen Abschnitt: '
    . count($zufluss['abschnitte']) . ' bei ' . json_encode($zufluss['deckung']));
$pruefungen += 2;

// (d) `deckt_sich` ueber den ARTIKEL -- der zweite Zweig, der eine treffer_public_id setzt.
$nahArtikel = $nachSchluessel['ggp:Gewaesser:Fluss:Garetien:Nahartikel'] ?? null;
assert($nahArtikel !== null, 'der Nahartikel fehlt im Pruefstand');
assert(count($nahArtikel['abschnitte']) === 1,
    'ein Artikeltreffer mit passender Geometrie behaelt seinen Abschnitt: ' . count($nahArtikel['abschnitte']));
$pruefungen += 2;

// (e) `uebersprungen` hatte nie welche und bekommt auch keine.
$uebersprungen = $nachSchluessel['ggp:Gewaesser:Fluss:Nachbarprovinzen'] ?? null;
assert($uebersprungen !== null && $uebersprungen['urteil'] === 'uebersprungen', 'der Sammelartikel fehlt');
assert($uebersprungen['abschnitte'] === [] && $uebersprungen['deckung'] === null,
    'eine uebersprungene Zeile wurde nie abgeglichen und traegt nichts');
$pruefungen += 2;

// 🪤 UND DIE GEGENPROBE GEGEN EINE ZU SCHARFE REGEL: waeren alle Urteilsarten gleich behandelt,
// stuenden hier ueberall 0 Abschnitte. Belegt wird deshalb die DIFFERENZ -- die Regel nimmt
// GENAU EINEM Objekt die Liste und laesst die uebrigen unberuehrt.
$mitAbschnitten = [];
foreach ($nachSchluessel as $schluessel => $o) {
    if ($o['abschnitte'] !== []) {
        $mitAbschnitten[] = $schluessel;
    }
}
assert(count($mitAbschnitten) === 5,
    'die Regel darf nicht pauschal wirken: Alke, Seitenarm, Natter, Nahartikel und Fernartikel'
    . ' tragen weiter Abschnitte -- es sind ' . count($mitAbschnitten) . ': '
    . json_encode($mitAbschnitten, JSON_UNESCAPED_UNICODE));
$pruefungen++;

// ---------------------------------------------------------------------------------------------
// 💣 DIE SPALTE MUSS `MEDIUMTEXT` BLEIBEN, und das haelt nur eine Quelltext-Zusicherung fest.
//
// Ein spaeteres `VARCHAR(255)` waere unter SQLite UNSICHTBAR (SQLite kennt keine Laengengrenze
// und dieser Pruefstand bliebe gruen), unter MySQL aber kuerzte es still -- `json_decode` gaebe
// `null`, der Leseweg faellt offen aus, und der Abschnitt ohne Item fehlte wieder. Das waere
// Luecke 1 zurueck, ununterscheidbar von "nichts getroffen": genau die Fehlerklasse aus
// AGENTS.md §10, an der `app_setting.setting_value` vier Monate lang wirkungslos war.
// ⚠️ Gemessen wird die DDL-Zeile, nicht das Verhalten -- was dieser Test gegen SQLite gar nicht
// sehen kann, muss er am Quelltext festhalten. Zeilenendenneutral gesucht (AGENTS.md §9).
// 🪤 Kommentare zuerst strippen: die Datei erklaert in Prosa, WARUM sie MEDIUMTEXT nimmt, und ein
// ungestrippter Test schluege an seiner eigenen Warnung an.
$abrufRoh = (string) file_get_contents(__DIR__ . '/../garetien-abruf.php');
// 🪤 KEINE Zeilenenden-Ersetzung, und keine Zeichenklasse ueber ein Zeilenende: eine solche
//    Zeichenkette laesst sich in einem erzeugten Quelltext nicht zuverlaessig schreiben (hier
//    landete beim ersten Versuch eine ECHTE Zeilenschaltung statt der Escape-Folge -- es lief,
//    war aber nicht lesbar und der naechste Leser haette es "aufgeraeumt").
//    `//.*` braucht sie gar nicht: `.` ueberschreitet ohne `s` kein Zeilenende, und die
//    gesuchte Zeichenkette steht ohnehin INNERHALB einer Zeile -- damit ist der Test
//    zeilenendenneutral, ohne ein Zeilenende zu nennen (AGENTS.md §9).
$abruf = preg_replace('~//.*~', '', $abrufRoh) ?? '';
assert(str_contains($abruf, 'ADD COLUMN abschnitte_json MEDIUMTEXT'),
    'die Spalte abschnitte_json muss MEDIUMTEXT sein -- ein VARCHAR kuerzt unter MySQL still, und'
    . ' ein halbes JSON ist von "nichts getroffen" nicht zu unterscheiden');
assert(!preg_match('~ADD COLUMN abschnitte_json\s+VARCHAR~i', $abruf),
    'abschnitte_json darf kein VARCHAR sein');
// Gegenprobe, damit die zwei Zeilen kein Nulltest sind: an einer Zeichenkette, die es wirklich
// gibt, muss dasselbe Vorgehen ANSCHLAGEN -- sonst misst der Riegel eine leergestrippte Datei.
assert(str_contains($abruf, 'avesmapsGaretienEnsureUrteilSpalten'),
    'die Gegenprobe findet den gestrippten Quelltext selbst nicht mehr -- der Riegel misst nichts');
$pruefungen += 3;
echo "OK: {$pruefungen} Pruefungen\n";
