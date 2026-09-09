<?php

declare(strict_types=1);

// Fall #118 (Discord, 09.09.2026, Tigersprung): „Das Untergraser Bogenhaus wird nur als
// ‚Untergras' erkannt bzw. als Ergaenzung zu ‚Untergras' angeboten. Es ist aber ein eigenes
// Gebaeude (ausserhalb der Stadt)."
//
// 🔴 DIE URSACHE WAR NICHT DER NAMENSVERGLEICH, SONDERN SEIN EINGABEWERT. garetien.de liefert je
// Objekt ZWEI Namen -- `artikel!anzeige` in der Rohzeile (garetien-parser.php) --, und der
// Importer las durchgehend die ANZEIGE. Fuer das Bogenhaus ist das „Untergras", also der Name
// eines ANDEREN Objekts; der Riegel „Bauwerk gegen Siedlung: nur der GANZE Name" (05.09.2026,
// avesmapsGaretienTrefferNameGleich) verglich damit „Untergras" gegen „Untergras", fand zu Recht
// „gleich" und meldete „deckt sich". Der Riegel ist heil -- er bekam den falschen Namen gereicht.
//
// Owner 09.09.2026, woertlich: „die Burg heisst auch Burg - verändere nicht die Namen, was soll
// der blödsinn."
//
// 💣 DIE NAHELIEGENDE REPARATUR WAERE FALSCH. Am Livebestand gemessen (Lauf 20, 8349 Zeilen):
// 2954 Zeilen (35,4 %) tragen abweichende Namen. Davon sind 2780 ein Artikel mit GENAU EINEM
// Objekt -- dort ist der Artikel der Wiki-Seitenname und damit der richtige Name. Die uebrigen
// 174 sind SAMMELARTIKEL: „Nachbarprovinzen" traegt 49 Objekte (Ochsenwasser, Neunaugensee,
// Oberer Yaquir …), „Raschtulswall" 29, „Huegel und Berge in Hartsteen" 14. Ein blindes „nimm den
// Artikel" haette die alle gleich benannt.
//
// 🔴 DIE REGEL IST DESHALB EINE ZAEHLUNG, KEINE TEXTHEURISTIK: traegt ein Artikel genau ein
// Objekt, ist er der Name; traegt er mehrere, ist die Anzeige der Name.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-objektname-test.php

require_once __DIR__ . '/../garetien-liste.php';   // zieht garetien-plan.php, -abgleich.php, ortsklassen.php

$pruefungen = 0;
function pruefe(bool $bedingung, string $was): void
{
    global $pruefungen;
    $pruefungen++;
    assert($bedingung, $was);
}

// =================================================================================================
// A. Die reine Regel
// =================================================================================================

$keine = [];   // kein Artikel dieses Laufs traegt mehrere Objekte

pruefe(avesmapsGaretienObjektName(
    ['artikel' => 'Untergraser Bogenhaus', 'anzeige' => 'Untergras'], $keine
) === 'Untergraser Bogenhaus', 'Fall #118: der Artikel ist der Name, nicht das Kartenlabel');

pruefe(avesmapsGaretienObjektName(
    ['artikel' => 'Burg Mardershöh', 'anzeige' => 'Mardershöh'], $keine
) === 'Burg Mardershöh', 'Owner 09.09.2026: „die Burg heisst auch Burg"');

pruefe(avesmapsGaretienObjektName(
    ['artikel' => 'Burg Finster', 'anzeige' => 'Finster'], $keine
) === 'Burg Finster', 'Owner 09.09.2026: „Burg Finster" bleibt „Burg Finster"');

// 🔴 Der Sammelartikel: MEHRERE Objekte unter einem Artikel -- dort ist die Anzeige der einzige
// Name, den das Objekt ueberhaupt hat.
$sammel = ['nachbarprovinzen' => true, 'raschtulswall' => true];
pruefe(avesmapsGaretienObjektName(
    ['artikel' => 'Nachbarprovinzen', 'anzeige' => 'Ochsenwasser'], $sammel
) === 'Ochsenwasser', 'Sammelartikel: die Anzeige gewinnt -- sonst hiessen 49 Objekte gleich');
pruefe(avesmapsGaretienObjektName(
    ['artikel' => 'Raschtulswall', 'anzeige' => 'See hoch im Raschtulswall'], $sammel
) === 'See hoch im Raschtulswall', 'Sammelartikel, zweiter Fall');

// ⚠️ Gleiche Namen, leere Felder, fehlende Felder -- die Regel darf nie einen leeren Namen liefern,
// wenn irgendwo einer steht.
pruefe(avesmapsGaretienObjektName(['artikel' => 'Alke', 'anzeige' => 'Alke'], $keine) === 'Alke',
    'gleich ist gleich');
pruefe(avesmapsGaretienObjektName(['artikel' => '', 'anzeige' => 'Aventurien'], $keine) === 'Aventurien',
    'ohne Artikel bleibt die Anzeige');
pruefe(avesmapsGaretienObjektName(['artikel' => 'Gut Zehntau', 'anzeige' => ''], $keine) === 'Gut Zehntau',
    'ohne Anzeige gilt der Artikel');
pruefe(avesmapsGaretienObjektName([], $keine) === '', 'ohne beides ein leerer Name, keine Ausnahme');
pruefe(avesmapsGaretienObjektName(['artikel' => '  Burg Finster  ', 'anzeige' => 'Finster'], $keine)
    === 'Burg Finster', 'der Name wird beschnitten');

// 💣 DER SCHLUESSEL DER SAMMELARTIKEL-MENGE IST GEFALTET, nicht roh. Der Zaehler baut ihn aus der
// Datenbank, die reine Funktion aus der Zeile -- laufen die zwei Schreibweisen auseinander, greift
// die Regel lautlos nie.
pruefe(avesmapsGaretienObjektName(
    ['artikel' => '  nachbarprovinzen ', 'anzeige' => 'Llavari'], $sammel
) === 'Llavari', 'die Faltung des Schluessels traegt Gross/Klein und Rand');

// =================================================================================================
// B. Die Zaehlung an einer echten Tabelle
// =================================================================================================

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE garetien_import_row (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT,
            wiki TEXT, ebene TEXT, zeile_nr INT, typ TEXT, namensraum TEXT, artikel TEXT, anzeige TEXT)');
$ins = $pdo->prepare('INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige)
                      VALUES (?,?,?,?,?,?,?,?)');
// Lauf 1: ein Sammelartikel (drei Objekte), ein 1:1-Artikel, und derselbe Artikel zweimal mit
// DEMSELBEN Namen -- das ist EIN Objekt auf zwei Ebenen und kein Sammelartikel.
$ins->execute([1, 'ggp', 'Gewaesser', 1, 'Fluss', '', 'Nachbarprovinzen', 'Llavari']);
$ins->execute([1, 'ggp', 'Gewaesser', 2, 'Fluss', '', 'Nachbarprovinzen', 'Oberer Yaquir']);
$ins->execute([1, 'ggp', 'Gewaesser', 3, 'Meer', '', 'Nachbarprovinzen', 'Ochsenwasser']);
$ins->execute([1, 'ggp', 'Ortschaften_3', 4, 'Gebaeude', 'Garetien', 'Untergraser Bogenhaus', 'Untergras']);
$ins->execute([1, 'ggp', 'Detail_2', 5, 'GebaeudeKlein', 'Garetien', 'Untergraser Bogenhaus', 'Untergras']);
// Lauf 2: derselbe Artikel, aber nur EIN Objekt -- die Zaehlung gilt je Lauf, nicht global.
$ins->execute([2, 'ggp', 'Gewaesser', 1, 'Fluss', '', 'Nachbarprovinzen', 'Llavari']);

avesmapsGaretienSammelartikelVergessen();
$s1 = avesmapsGaretienSammelartikel($pdo, 1);
pruefe(isset($s1['nachbarprovinzen']), 'drei Namen unter einem Artikel: Sammelartikel');
pruefe(!isset($s1['untergraser bogenhaus']),
    'zweimal derselbe Artikel mit DEMSELBEN Namen ist EIN Objekt auf zwei Ebenen, kein Sammelartikel');

// 🔴 Die Zaehlung gilt JE LAUF. Ohne das truege ein Artikel, der irgendwann einmal mehrere Objekte
// hatte, seine Sammel-Eigenschaft fuer immer mit sich.
$s2 = avesmapsGaretienSammelartikel($pdo, 2);
pruefe(!isset($s2['nachbarprovinzen']), 'im zweiten Lauf traegt derselbe Artikel nur ein Objekt');

// Die beiden Faelle zusammengesetzt -- so, wie der Planbau sie benutzt.
pruefe(avesmapsGaretienObjektName(['artikel' => 'Untergraser Bogenhaus', 'anzeige' => 'Untergras'], $s1)
    === 'Untergraser Bogenhaus', 'Lauf 1, 1:1-Artikel: der Artikel gewinnt');
pruefe(avesmapsGaretienObjektName(['artikel' => 'Nachbarprovinzen', 'anzeige' => 'Llavari'], $s1)
    === 'Llavari', 'Lauf 1, Sammelartikel: die Anzeige gewinnt');

// ⚠️ Der Speicher darf den Lauf nicht verwechseln -- zweimal gefragt, zweimal dasselbe.
pruefe(avesmapsGaretienSammelartikel($pdo, 1) === $s1, 'der Speicher liefert je Lauf denselben Stand');
pruefe(avesmapsGaretienSammelartikel($pdo, 2) === $s2, 'und verwechselt die Laeufe nicht');

// 🪤 Faellt OFFEN aus: ohne Tabelle keine Ausnahme, sondern „kein Sammelartikel bekannt". Ein
// werfender Zaehler haette den ganzen Planbau angehalten -- und der Preis eines leeren Ergebnisses
// ist ein Name zu viel, nicht ein Lauf zu wenig.
$leer = new PDO('sqlite::memory:');
$leer->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
avesmapsGaretienSammelartikelVergessen();
pruefe(avesmapsGaretienSammelartikel($leer, 1) === [], 'ohne Tabelle faellt die Zaehlung offen aus');
avesmapsGaretienSammelartikelVergessen();

// =================================================================================================
// C. Die Naht -- lesen die Entscheider wirklich den neuen Namen?
// =================================================================================================
// 💣 Diese Haelfte ist die eigentliche Zusicherung. A und B koennen gruen sein, waehrend der
// Abgleich weiter `anzeige` liest -- genau so war der Innerorts-Test vom 05.09.2026 gruen, obwohl
// sein Angebot in der Produktion nie erscheinen konnte („Rondratempel zu Uslenried" heisst als
// Anzeige nur „Rondratempel", und der Ortsbezug ist weg, bevor die Regel ihn prueft).

$zielGebaeude = ['ziel' => 'location', 'subtyp' => 'gebaeude'];
$dorf = ['art' => 'kleinstadt', 'name' => 'Untergras'];

pruefe(avesmapsGaretienTrefferNameGleich(
    $zielGebaeude, $dorf, avesmapsGaretienObjektName(
        ['artikel' => 'Untergraser Bogenhaus', 'anzeige' => 'Untergras'], $keine)
) === false, 'Fall #118: mit dem Artikelnamen ist das Bogenhaus NICHT die Kleinstadt');

// Gegenprobe: ihre Burg „Gryffenwacht" gegen unser gleichnamiges Dorf bleibt ein Treffer
// (Owner 31.08.2026: bei Punkten entscheidet der Name).
pruefe(avesmapsGaretienTrefferNameGleich(
    $zielGebaeude, ['art' => 'dorf', 'name' => 'Gryffenwacht'],
    avesmapsGaretienObjektName(['artikel' => 'Gryffenwacht', 'anzeige' => 'Gryffenwacht'], $keine)
) === true, 'gleicher Name, gleiche Stelle: weiterhin dasselbe Objekt');

// Das Innerorts-Angebot: mit der Anzeige verlor es seinen Ortsbezug.
pruefe(avesmapsGaretienNameNenntOrt(
    avesmapsGaretienObjektName(['artikel' => 'Rondratempel zu Uslenried', 'anzeige' => 'Rondratempel'], $keine),
    'Uslenried'
) === true, 'der Artikelname nennt seinen Ort -- die Anzeige tat es nicht mehr');

// =================================================================================================
// D. Der SCHLUESSEL bleibt, wie er war
// =================================================================================================
// 💣 TRAGEND. `avesmapsGaretienObjektSchluesselAusZeile` bildet den `entity_key`, an dem die
// dauerhaften Entscheidungen haengen (`sync_decision`: abgelehnt/uebernommen, 31.08.2026). Wandert
// der Name im Schluessel mit, verlieren ALLE gespeicherten Entscheidungen ihre Zuordnung und die
// Arbeitsliste faengt von vorn an -- genau der Zustand, den der Owner an diesem Tag beseitigen
// liess. Der Schluessel liest deshalb weiterhin `anzeige`, und das ist kein Versehen.
$zeile = ['wiki' => 'ggp', 'ebene' => 'Ortschaften_3', 'zeile_nr' => 177, 'typ' => 'Gebaeude',
          'namensraum' => 'Garetien', 'artikel' => 'Untergraser Bogenhaus', 'anzeige' => 'Untergras'];
pruefe(avesmapsGaretienObjektSchluesselAusZeile($zeile)
    === 'ggp:Ortschaften_3:Gebaeude:Garetien:Untergraser Bogenhaus!Untergras',
    'der Objektschluessel ist unveraendert -- sonst verlieren die gespeicherten Entscheidungen ihr Objekt');

// =================================================================================================
// E. Die Verdrahtung -- AUSGEFUEHRT, nicht gelesen
// =================================================================================================
// 💣 Ein Regex ueber den Quelltext haette hier nichts bewiesen. Die zwei Stellen, die Staging-Zeilen
// aus der Datenbank holen (Planbau und Arbeitsliste), muessen sie BENENNEN -- fehlt der Aufruf an
// einer, traegt dieselbe Zeile in der Liste einen anderen Namen als im Plan, und das faellt
// niemandem auf, weil beide Haelften fuer sich stimmen.

$prueflauf = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienSammelartikelVergessen();
avesmapsGaretienBaueSyncPlan($prueflauf, 1);

$labels = $prueflauf->query('SELECT label FROM sync_plan_item ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
$alle = implode(' | ', $labels);
// Der Pruefstand traegt `artikel='Muehlsee'` (ASCII) gegen `anzeige='Mühlsee'` -- ein 1:1-Artikel,
// also gewinnt der Artikel. Er ist damit der Zeuge dafuer, dass der PLANBAU wirklich benennt.
pruefe(str_contains($alle, 'Muehlsee (See)'),
    'der Planbau benennt seine Zeilen: der Artikelname steht am Item, nicht das Kartenlabel: ' . $alle);
pruefe(!str_contains($alle, 'Mühlsee (See)'), 'und das Kartenlabel eben NICHT: ' . $alle);
// 🔴 Und die Gegenprobe im selben Lauf: der Sammelartikel behaelt seine Anzeige.
pruefe(str_contains($alle, 'Llavari (Fluss)'),
    'der Sammelartikel „Nachbarprovinzen" behaelt die Anzeige „Llavari": ' . $alle);

// Der `after.name` ist der Name, der bei der Uebernahme auf die Karte kommt -- er haengt an
// derselben Benennung und wird hier eigens gemessen, weil ein Label auch aus einer anderen Quelle
// stammen koennte.
$nachJson = $prueflauf->query(
    "SELECT after_json FROM sync_plan_item WHERE label LIKE 'Muehlsee%'"
)->fetchColumn();
$nach = json_decode((string) $nachJson, true);
pruefe(($nach['name'] ?? '') === 'Muehlsee',
    'und `after.name` -- der Name, der auf die Karte kommt: ' . var_export($nach['name'] ?? null, true));

// Die Arbeitsliste, dieselbe Frage.
$liste = avesmapsGaretienArbeitsliste($prueflauf, 1, []);
$namen = array_column($liste['objekte'], 'name');
pruefe(in_array('Muehlsee', $namen, true),
    'die Arbeitsliste benennt ebenso -- sonst zeigt sie einen anderen Namen als der Plan: '
    . implode(' | ', $namen));
pruefe(in_array('Llavari', $namen, true),
    'und kennt den Sammelartikel genauso: ' . implode(' | ', $namen));
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienSammelartikelVergessen();

echo "OK garetien-objektname-test.php ({$pruefungen} Zusicherungen)\n";
