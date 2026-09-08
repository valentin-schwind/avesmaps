<?php

declare(strict_types=1);

// „Innerorts einfuegen" -- ein Bauwerk, das in eine Stadt gehoert, nicht auf die Karte.
// Entwurf: docs/superpowers/specs/2026-09-02-innerorts-import-design.md
//
// Vier Haelften, in der Reihenfolge des Datenwegs:
//   A. die reinen Namensregeln (Faltung, Stamm, Wortanfang)
//   B. der reine Kandidatenrechner (naechste Ortschaft MIT Namenstreffer)
//   C. der Befund mit Bestand (nur Bauwerke, ueber den Kandidatenspeicher)
//   D. Plan und Arbeitsliste (der Befund reist am `new`-Item und am Objekt; „uebernommen · innerorts")
//
// 🔴 D traegt die tragende Zusicherung dieses Umbaus: ein Bauwerk, das den Namen seiner Stadt
// TRAEGT („Wandlether Rondratempel" neben „Wandleth"), ist ein NEUZUGANG mit Innerorts-Angebot --
// nicht die Stadt selbst. Der Abgleich hielt es bis zum 05.09.2026 fuer die Stadt, weil
// avesmapsGaretienNamenAehnlich am WORTANFANG vergleicht („wandletherrondratempel" beginnt mit
// „wandleth") und die Bauwerks-Suchfamilie die Siedlungen enthaelt; damit haette genau der
// gemessene Innerorts-Fall (11 von 27, Entwurf §2d) nie einen Knopf bekommen, sondern seine
// Quelle an die Stadt gehaengt.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-innerorts-test.php

require_once __DIR__ . '/../garetien-liste.php';   // zieht garetien-plan.php, -abgleich.php, ortsklassen.php

$pruefungen = 0;

// =================================================================================================
// A. Die Namensregeln -- rein
// =================================================================================================
assert(avesmapsGaretienInnerortsFalten('Wandlether Baumeister-Zunft') === 'wandlether baumeister zunft',
    'Faltung: klein, alles Nicht-Buchstabige wird EIN Leerzeichen, die Wortgrenzen bleiben');
assert(avesmapsGaretienInnerortsFalten('Möhrenhof') === 'mohrenhof',
    'ein Umlaut faellt auf seinen Grundbuchstaben -- nicht auf ein Fragezeichen wie beim wiki_key');
assert(avesmapsGaretienInnerortsFalten('Táyârret') === 'tyrret',
    'was die Umlaut-Tafel nicht kennt, faellt ganz heraus -- auf beiden Seiten gleich');
assert(avesmapsGaretienInnerortsStamm('Auersberge') === 'auersberg', 'der Stamm verliert ein Schluss-e');
assert(avesmapsGaretienInnerortsStamm('Wandleth') === 'wandleth', 'und sonst nichts');
assert(avesmapsGaretienInnerortsStamm('Fuchsbau') === 'fuchsbau',
    'nur das Schluss-e, keine Endungslehre (kein Schluss-u, kein -en)');
$pruefungen += 6;

assert(avesmapsGaretienNameNenntOrt('Wandlether Baumeisterzunft', 'Wandleth') === true,
    'Eigenschaftswort am Wortanfang: „Wandlether" nennt Wandleth');
assert(avesmapsGaretienNameNenntOrt('Tempel zu Wandleth', 'Wandleth') === true,
    'auch mitten im Namen, solange ein WORT damit beginnt');
assert(avesmapsGaretienNameNenntOrt('Auersberger Hof', 'Auersberge') === true,
    'ueber den Stamm: „Auersberger" nennt Auersberge');
assert(avesmapsGaretienNameNenntOrt('Mohrenhof', 'Möhren') === true,
    'Umlaut auf der einen Seite, Grundbuchstabe auf der anderen -- derselbe Ort');
assert(avesmapsGaretienNameNenntOrt('Neuen Kalkspitzer Warte', 'Neuen Kalkspitze') === true,
    'ein mehrwortiger Ortsname wird als ganze Folge ab einem Wortanfang gesucht');
assert(avesmapsGaretienNameNenntOrt('Bauernhof', 'Aue') === false,
    '💣 WORTANFANG: „au" steckt in „Bauernhof", aber kein Wort beginnt damit -- kein Bauernhof liegt innerorts in Aue');
assert(avesmapsGaretienNameNenntOrt('Rondratempel', 'Wandleth') === false, 'ohne den Ortsnamen kein Treffer');
assert(avesmapsGaretienNameNenntOrt('', 'Wandleth') === false && avesmapsGaretienNameNenntOrt('Wandlether Hof', '') === false,
    'leer trifft nie');
$pruefungen += 8;

// =================================================================================================
// B. Die Kandidaten -- rein, nach Entfernung sortiert
// =================================================================================================
// 🔴 UMBAU 07.09.2026: aus dem EINEN Kandidaten wurde eine LISTE, und der Namenstreffer ist von der
// Bedingung zur Marke geworden. Die Begruendung samt der Messung, die dadurch umgedreht wird, steht
// an AVESMAPS_GARETIEN_INNERORTS_MEILEN.
$schwelle = AVESMAPS_GARETIEN_INNERORTS_MEILEN / AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT;   // 5 Meilen in Karteneinheiten
$ortschaften = [
    ['public_id' => 'dorf-aue', 'name' => 'Aue', 'punkte' => [[100.00, 100.0]]],
    ['public_id' => 'stadt-wandleth', 'name' => 'Wandleth', 'punkte' => [[100.10, 100.0]]],
];
$k = avesmapsGaretienInnerortsKandidaten([[100.02, 100.0]], 'Wandlether Baumeisterzunft', $ortschaften);
assert(count($k) === 2, 'beide Ortschaften liegen in Reichweite und stehen zur Wahl: ' . json_encode($k));
assert($k[0]['public_id'] === 'dorf-aue' && $k[1]['public_id'] === 'stadt-wandleth',
    '🔴 SORTIERT NACH ENTFERNUNG (Owner 07.09.2026) -- Aue liegt 0,02 weg, Wandleth 0,08: ' . json_encode($k));
assert($k[0]['nennt_name'] === false && $k[1]['nennt_name'] === true,
    '💣 der Namenstreffer ist die MARKE, nicht mehr die Bedingung -- er ordnet die Liste nicht, er beschriftet sie');
assert(abs($k[1]['abstand'] - 0.08) < 1e-9, 'und der Abstand ist der zu IHR: ' . json_encode($k));
// 💣 DIE GEGENPROBE ZUR UMKEHR, und sie ist die Zusicherung, an der ein Rueckbau auffliegt: bis zum
// 07.09.2026 gab ein Objektname OHNE Ortsnamen GAR KEINEN Kandidaten (Entwurf §2c, „Abstand allein
// trennt nicht"). Der Abstand entscheidet seither nichts mehr, er BEGRENZT nur, was zur Wahl steht.
$ohneNamen = avesmapsGaretienInnerortsKandidaten([[100.02, 100.0]], 'Rondratempel', $ortschaften);
assert(count($ohneNamen) === 2, 'ohne Namenstreffer stehen sie trotzdem zur Wahl: ' . json_encode($ohneNamen));
assert($ohneNamen[0]['nennt_name'] === false && $ohneNamen[1]['nennt_name'] === false, 'und beide ohne Marke');
// 🔴 DIE VORAUSWAHL FOLGT DER LISTE NICHT. Sie nimmt den Namenstreffer, sonst waere der Umbau eine
// Verschlechterung: der Knopf schluege „Aue" vor, waehrend „Wandleth" gemeint ist.
assert(avesmapsGaretienInnerortsVorauswahl($k)['public_id'] === 'stadt-wandleth',
    '💣 die Vorauswahl ist der naechste MIT Namenstreffer, nicht der naechste ueberhaupt');
assert(avesmapsGaretienInnerortsVorauswahl($ohneNamen)['public_id'] === 'dorf-aue',
    '...und ohne jeden Namenstreffer der naechste ueberhaupt');
$zweiMarken = [
    ['public_id' => 'w-fern', 'name' => 'Wandleth', 'meilen' => 0.4, 'nennt_name' => true],
    ['public_id' => 'w-nah', 'name' => 'Wandleth', 'meilen' => 0.1, 'nennt_name' => true],
];
assert(avesmapsGaretienInnerortsVorauswahl($zweiMarken)['public_id'] === 'w-fern',
    'bei mehreren Marken gewinnt die ERSTE der (nach Entfernung sortierten) Liste');
assert(avesmapsGaretienInnerortsKandidaten([[100.10 + $schwelle + 0.001, 100.0]], 'Wandlether Hof', $ortschaften) === [],
    'jenseits der Schwelle gibt es keinen Kandidaten');
assert(avesmapsGaretienInnerortsKandidaten([[100.10 + $schwelle - 0.001, 100.0]], 'Wandlether Hof', $ortschaften) !== [],
    'diesseits schon -- die Schwelle ist AVESMAPS_GARETIEN_INNERORTS_MEILEN, umgerechnet in Karteneinheiten');
// 🔴 Die Schwelle ist seit dem 07.09.2026 eine OWNER-ZAHL, keine gemessene (die 0,5 davor war an 27
// Faellen gemessen). Wer sie aendert, aendert eine Owner-Entscheidung; die zwei Vergleiche darueber
// allein wandern mit der Konstante mit und saehen eine Verschiebung nie (Mutationsprobe 05.09.2026).
assert(AVESMAPS_GARETIEN_INNERORTS_MEILEN === 5.0, 'die Innerorts-Schwelle sind fuenf Meilen');
assert(avesmapsGaretienInnerortsKandidaten([[100.10 + 4.0 / AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT, 100.0]], 'Wandlether Hof', $ortschaften) !== [],
    '4 Meilen: Kandidat');
assert(avesmapsGaretienInnerortsKandidaten([[100.10 + 6.0 / AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT, 100.0]], 'Wandlether Hof', $ortschaften) === [],
    '6 Meilen: keiner');
assert(avesmapsGaretienInnerortsKandidaten([], 'Wandlether Hof', $ortschaften) === [], 'ohne Punkte kein Kandidat');
$zweiTreffer = [
    ['public_id' => 'w-fern', 'name' => 'Wandleth', 'punkte' => [[100.12, 100.0]]],
    ['public_id' => 'w-nah', 'name' => 'Wandleth', 'punkte' => [[100.05, 100.0]]],
];
assert(avesmapsGaretienInnerortsKandidaten([[100.0, 100.0]], 'Wandlether Hof', $zweiTreffer)[0]['public_id'] === 'w-nah',
    'unter mehreren Treffern steht der naechste vorn -- auch wenn er im Bestand hinten stand');
assert(avesmapsGaretienInnerortsKandidaten([[100.02, 100.0]], 'Wandlether Hof',
    [['public_id' => '', 'name' => 'Wandleth', 'punkte' => [[100.0, 100.0]]]]) === [],
    'ohne public_id keine Bindung, also kein Kandidat');
// ⚠️ GEDECKELT WIRD NACH DEM SORTIEREN -- was wegfaellt, ist immer das Entfernteste. Ohne diese
// Reihenfolge zeigte das Auswahlfeld acht beliebige statt der acht naechsten Staedte.
$viele = [];
for ($i = 0; $i < AVESMAPS_GARETIEN_INNERORTS_KANDIDATEN + 4; $i++) {
    // Absichtlich in UMGEKEHRTER Reihenfolge angelegt: der entfernteste zuerst.
    $viele[] = ['public_id' => 'ort-' . $i, 'name' => 'Ort ' . $i,
        'punkte' => [[100.0 + 0.01 * (AVESMAPS_GARETIEN_INNERORTS_KANDIDATEN + 4 - $i), 100.0]]];
}
$gedeckelt = avesmapsGaretienInnerortsKandidaten([[100.0, 100.0]], 'Irgendein Hof', $viele);
assert(count($gedeckelt) === AVESMAPS_GARETIEN_INNERORTS_KANDIDATEN,
    'hoechstens AVESMAPS_GARETIEN_INNERORTS_KANDIDATEN stehen zur Wahl: ' . count($gedeckelt));
assert($gedeckelt[0]['public_id'] === 'ort-' . (AVESMAPS_GARETIEN_INNERORTS_KANDIDATEN + 3),
    'und der naechste steht vorn, nicht der erste des Bestands: ' . json_encode($gedeckelt[0]));
$pruefungen += 18;

// Der geteilte Umrechner -- EIN Erzeuger fuer Planbau und frischen Nachschlag.
$inMeilen = avesmapsGaretienInnerortsListeInMeilen([
    ['public_id' => 'a', 'name' => 'A', 'abstand' => 1.0, 'nennt_name' => true],
]);
assert(abs($inMeilen[0]['meilen'] - AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT) < 1e-9,
    'eine Karteneinheit sind AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT Meilen: ' . json_encode($inMeilen));
assert(!array_key_exists('abstand', $inMeilen[0]),
    'und die Karteneinheit verlaesst den Endpunkt NICHT -- zwei Masse in einer Zeile liest niemand richtig');
assert($inMeilen[0]['nennt_name'] === true, 'die Marke reist mit');
$pruefungen += 3;

$familie = array_column(avesmapsGaretienSiedlungsFamilie(), 1);
assert(!in_array('gebaeude', $familie, true) && !in_array('stadtviertel', $familie, true),
    '💣 kein Bauwerk ist ein Wirt -- sonst laege „Turm X" innerorts in „Burg X" nebenan');
assert(in_array('stadt', $familie, true) && in_array('dorf', $familie, true), 'die Siedlungen sind es');
assert(count($familie) === count(AVESMAPS_ORTSKLASSEN) - count(AVESMAPS_BAUWERKSKLASSEN),
    'ABGELEITET, nicht abgeschrieben: die Familie ist genau die Gegenmenge der Bauwerksklassen');
$pruefungen += 3;

// =================================================================================================
// C. Der Befund mit Bestand
// =================================================================================================
$pdo = avesmapsGaretienPlanTestPdo();
[$tx, $ty] = avesmapsGaretienLinieNachAvesmaps([[50000.0, -20000.0]])[0];
$ortAnlegen = $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json) VALUES (?,?,?,?,?,?)');
$punkt = static fn(float $x, float $y): string => json_encode(['type' => 'Point', 'coordinates' => [$x, $y]]);
// 0,09 Meilen (0,03 Einheiten) neben dem Tempel: die Stadt, deren Namen er traegt.
$ortAnlegen->execute(['stadt-wandleth', 'Wandleth', 'location', 'stadt', $punkt($tx + 0.03, $ty), '{}']);
// 0,03 Meilen daneben, also NAEHER: ein Dorf ohne Namenstreffer.
$ortAnlegen->execute(['dorf-aue', 'Aue', 'location', 'dorf', $punkt($tx + 0.01, $ty), '{}']);
// Ein Bauwerk von uns GENAU auf dem zweiten Tempel -- fuer den Ergaenzungsfall in D.
$ortAnlegen->execute(['geb-rahja', 'Wandlether Rahjatempel', 'location', 'gebaeude', $punkt($tx, $ty), '{}']);
$zeileAnlegen = $pdo->prepare("INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige, lodmin, lodmax, extra, geo_art, geo, roh)
                               VALUES (1,?,?,?,?,?,?,?,'','','',?,?,'')");
$zeileAnlegen->execute(['ggp', 'Bauwerke', 1, 'Tempel', 'Garetien', 'Wandlether Rondratempel', 'Wandlether Rondratempel', 'koordinaten', '50000 -20000']);
$zeileAnlegen->execute(['ggp', 'Bauwerke', 2, 'Tempel', 'Garetien', 'Wandlether Rahjatempel', 'Wandlether Rahjatempel', 'koordinaten', '50000 -20000']);
$zeileAnlegen->execute(['ggp', 'Bauwerke', 3, 'Tempel', 'Garetien', 'Ferner Tempel', 'Ferner Tempel', 'koordinaten', '70000 -20000']);
$zeileAnlegen->execute(['ggp', 'Bauwerke', 4, 'Dorf', 'Garetien', 'Wandlether Vorwerk', 'Wandlether Vorwerk', 'koordinaten', '50000 -20000']);
// 🔴 DER NAHT-FALL: ein Bauwerk, dessen NAECHSTER Kandidat die Stadt ist, deren Namen es traegt.
// (Beim Rondratempel oben ist das Dorf Aue naeher als Wandleth, und der Abgleich sagt schon deshalb
// „neu" -- die Wortanfang-Regel kommt dort gar nicht zum Zug.)
[$zx, $zy] = avesmapsGaretienLinieNachAvesmaps([[55000.0, -20000.0]])[0];
$ortAnlegen->execute(['stadt-hirschfurt', 'Hirschfurt', 'location', 'stadt', $punkt($zx + 0.005, $zy), '{}']);
$zeileAnlegen->execute(['ggp', 'Bauwerke', 5, 'Gebaeude', 'Garetien', 'Hirschfurter Zunfthaus', 'Hirschfurter Zunfthaus', 'koordinaten', '55000 -20000']);
avesmapsGaretienKandidatenVergessen();

$zielTempel = AVESMAPS_GARETIEN_TYP_MAP['Tempel'];
$zeileTempel = ['anzeige' => 'Wandlether Rondratempel', 'geo_art' => 'koordinaten', 'geo' => '50000 -20000'];
$befund = avesmapsGaretienInnerortsBefund($pdo, $zeileTempel, $zielTempel);
assert($befund !== null && $befund['public_id'] === 'stadt-wandleth' && $befund['name'] === 'Wandleth',
    'der Befund nennt die Stadt, deren Namen das Bauwerk traegt -- nicht das naehere Dorf: ' . json_encode($befund));
assert(abs($befund['meilen'] - 0.09) < 0.011, 'und den Abstand in MEILEN, gerundet: ' . json_encode($befund));
assert(avesmapsGaretienInnerortsBefund($pdo, $zeileTempel, AVESMAPS_GARETIEN_TYP_MAP['Dorf']) === null,
    '🔴 NUR BAUWERKE: ein Dorf neben einer Stadt ist ein Nachbardorf (die Kontrollgruppe aus Entwurf §2c)');
assert(avesmapsGaretienInnerortsBefund($pdo, $zeileTempel, ['ziel' => 'location', 'subtyp' => 'stadtviertel', 'kind' => null]) !== null,
    'und ein Stadtviertel IST ein Bauwerk -- gefragt wird avesmapsIstBauwerksklasse, nicht === gebaeude');
assert(avesmapsGaretienInnerortsBefund($pdo, ['anzeige' => 'Ferner Tempel', 'geo_art' => 'koordinaten', 'geo' => '70000 -20000'], $zielTempel) === null,
    'weit weg: kein Befund');
assert(avesmapsGaretienInnerortsBefund($pdo, $zeileTempel, null) === null, 'ohne Ziel kein Befund');
$befundZunft = avesmapsGaretienInnerortsBefund($pdo, ['anzeige' => 'Hirschfurter Zunfthaus', 'geo_art' => 'koordinaten', 'geo' => '55000 -20000'], AVESMAPS_GARETIEN_TYP_MAP['Gebaeude']);
assert(($befundZunft['name'] ?? null) === 'Hirschfurt', 'das Zunfthaus nennt Hirschfurt: ' . json_encode($befundZunft));
$pruefungen++;
assert(avesmapsGaretienInnerortsBefund($pdo, ['anzeige' => '', 'geo_art' => 'koordinaten', 'geo' => '50000 -20000'], $zielTempel) === null,
    'ohne Namen kein Befund');
$pruefungen += 7;

// =================================================================================================
// D. Plan und Arbeitsliste
// =================================================================================================
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 7);
$items = $pdo->query('SELECT id, label, change_type, after_json FROM sync_plan_item ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
$finde = static function (array $items, string $name): array {
    return array_values(array_filter($items, static fn(array $i): bool => str_starts_with((string) $i['label'], $name)));
};
$traegtInnerorts = static fn(array $item): bool => array_key_exists('innerorts', json_decode((string) $item['after_json'], true) ?: []);

$rondra = $finde($items, 'Wandlether Rondratempel');
assert(count($rondra) === 1 && $rondra[0]['change_type'] === 'new',
    'der Rondratempel (naechster Kandidat: das Dorf Aue, anderer Name) ist ein Neuzugang: '
    . json_encode(array_map(static fn(array $i): array => [$i['label'], $i['change_type']], $rondra)));
$rondraNach = json_decode((string) $rondra[0]['after_json'], true);
assert(($rondraNach['innerorts']['public_id'] ?? null) === 'stadt-wandleth' && ($rondraNach['innerorts']['name'] ?? null) === 'Wandleth',
    'und sein Vorschlag traegt den Befund: ' . json_encode($rondraNach['innerorts'] ?? null));
$pruefungen += 2;

$zunft = $finde($items, 'Hirschfurter Zunfthaus');
$zunftArten = array_map(static fn(array $i): array => [$i['label'], $i['change_type'], json_decode((string) $i['after_json'], true)['anlass'] ?? null], $zunft);
assert(count($zunft) === 1 && $zunft[0]['change_type'] === 'new' && (json_decode((string) $zunft[0]['after_json'], true)['anlass'] ?? null) !== 'zusatz',
    '🔴 DIE TRAGENDE ZUSICHERUNG: ein Bauwerk, dessen naechster Kandidat die Stadt ist, deren Namen es TRAEGT, ist ein'
    . ' NEUZUGANG -- nicht die Stadt. Bis zum 05.09.2026 galt es per Wortanfang als „gleicher Name", deckte sich mit'
    . ' Hirschfurt und bekam nur Ergaenzungsangebote (Quelle an die STADT, „trotzdem neu"): ' . json_encode($zunftArten));
$zunftNach = json_decode((string) $zunft[0]['after_json'], true);
assert(($zunftNach['innerorts']['name'] ?? null) === 'Hirschfurt',
    'und genau dieser Vorschlag traegt das Innerorts-Angebot: ' . json_encode($zunftNach['innerorts'] ?? null));
$pruefungen += 2;

$rahja = $finde($items, 'Wandlether Rahjatempel');
assert(count($rahja) >= 1, 'der Rahjatempel liegt bei uns schon (gleicher Name, gleicher Punkt) und bekommt seine Ergaenzungsangebote');
foreach ($rahja as $r) {
    assert(!$traegtInnerorts($r),
        '⚠️ eine ERGAENZUNG traegt keinen Befund -- unser Objekt liegt schon da, es gibt nichts innerorts anzulegen: ' . $r['label']);
}
$fern = $finde($items, 'Ferner Tempel');
assert(count($fern) === 1 && $fern[0]['change_type'] === 'new' && !$traegtInnerorts($fern[0]),
    'ein Neuzugang OHNE Befund traegt das Feld gar nicht -- die Abwesenheit ist die Aussage');
$vorwerk = $finde($items, 'Wandlether Vorwerk');
foreach ($vorwerk as $v) {
    assert(!$traegtInnerorts($v), '🔴 ein DORF bekommt nie ein Innerorts-Angebot, so nah es an Wandleth liegt: ' . $v['label']);
}
$pruefungen += 2 + count($rahja) + count($vorwerk);

// Die Arbeitsliste reicht den Befund am OBJEKT durch -- OHNE die Tabelle settlement_place, die
// es auf einer frischen Installation noch nicht gibt: der Leser faellt still auf „nichts" zurueck.
$nachName = static function (array $liste): array {
    $raus = [];
    foreach ($liste['objekte'] as $o) {
        $raus[(string) $o['name']] = $o;
    }

    return $raus;
};
$objekte = $nachName(avesmapsGaretienArbeitsliste($pdo, 1, []));
assert(($objekte['Wandlether Rondratempel']['innerorts']['name'] ?? null) === 'Wandleth',
    'die Arbeitsliste reicht den Befund am OBJEKT durch (die Item-Feldliste ist ausdruecklich, siehe `applied`): '
    . json_encode($objekte['Wandlether Rondratempel']['innerorts'] ?? null));
assert(($objekte['Ferner Tempel']['innerorts'] ?? null) === [], 'ohne Befund ein LEERES Feld, kein fehlendes');
assert(($objekte['Aventurien']['innerorts'] ?? null) === [], 'auch am zweiten Erzeuger (Zeile ohne Item) steht das Feld, leer');
assert(($objekte['Wandlether Rondratempel']['innerorts_uebernommen'] ?? null) === false,
    'vor der Uebernahme: nicht innerorts uebernommen -- `false`, nicht fehlend');
assert(($objekte['Aventurien']['innerorts_uebernommen'] ?? null) === false,
    'auch am zweiten Erzeuger steht das Feld -- `false`, nicht fehlend');
$pruefungen += 5;

// „uebernommen · innerorts": der Server sagt es -- ueber die TABELLE, nie ueber einen zweiten
// Vermerk am Item (die Ruecknahme fragt dieselbe Tabelle, garetien-uebernahme.php).
$pdo->exec('CREATE TABLE settlement_place (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, place_type TEXT,
    settlement_public_id TEXT, settlement_name TEXT, wiki_url TEXT, origin TEXT, is_active INTEGER DEFAULT 1,
    created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
$pdo->exec("INSERT INTO settlement_place (public_id, name, place_type, settlement_public_id, settlement_name, origin)
            VALUES ('staette-rondra', 'Wandlether Rondratempel', 'Tempel', 'stadt-wandleth', 'Wandleth', 'garetien')");
// Der Stand nach einer Uebernahme, so wie avesmapsGaretienItemAbschliessen ihn hinterlaesst:
// apply_state 'done' und die angelegte public_id als Vermerk.
$pdo->prepare("UPDATE sync_plan_item SET apply_state = 'done', apply_note = ? WHERE id = ?")
    ->execute(['staette-rondra', (int) $rondra[0]['id']]);
$pdo->prepare("UPDATE sync_plan_item SET apply_state = 'done', apply_note = ? WHERE id = ?")
    ->execute(['irgendein-kartenobjekt', (int) $fern[0]['id']]);
$objekte2 = $nachName(avesmapsGaretienArbeitsliste($pdo, 1, []));
assert($objekte2['Wandlether Rondratempel']['stand'] === 'uebernommen'
    && ($objekte2['Wandlether Rondratempel']['innerorts_uebernommen'] ?? null) === true,
    'die angelegte public_id steht in settlement_place -> „uebernommen · innerorts": '
    . json_encode([$objekte2['Wandlether Rondratempel']['stand'], $objekte2['Wandlether Rondratempel']['innerorts_uebernommen'] ?? null]));
assert($objekte2['Ferner Tempel']['stand'] === 'uebernommen'
    && ($objekte2['Ferner Tempel']['innerorts_uebernommen'] ?? null) === false,
    'ein auf die KARTE uebernommenes Objekt bleibt „uebernommen" ohne den Zusatz');
$pdo->exec('UPDATE settlement_place SET is_active = 0');
$objekte3 = $nachName(avesmapsGaretienArbeitsliste($pdo, 1, []));
assert(($objekte3['Wandlether Rondratempel']['innerorts_uebernommen'] ?? null) === false,
    'eine zurueckgenommene Staette (is_active = 0) zaehlt nicht mehr');
$pruefungen += 3;

// =================================================================================================
// F. Die Kandidatenliste -- im Plan, in der Arbeitsliste, und FRISCH nachgeschlagen
// =================================================================================================
// 🔴 Owner 07.09.2026: „sind in der Naehe mehrere soll ein dropdown Menue sortiert nach entfernung
// zur auswahl stehen". Die Liste reist IM Befund mit (ein Feld, nicht zwei -- die Begruendung steht
// an avesmapsGaretienInnerortsBefund), also kommt sie ohne eine einzige Aenderung an
// garetien-liste.php beim Client an. Genau das sichert dieser Abschnitt.
$rondraKandidaten = $rondraNach['innerorts']['kandidaten'] ?? null;
assert(is_array($rondraKandidaten) && count($rondraKandidaten) === 2,
    'der Vorschlag traegt BEIDE Ortschaften in Reichweite: ' . json_encode($rondraKandidaten));
assert($rondraKandidaten[0]['name'] === 'Aue' && $rondraKandidaten[1]['name'] === 'Wandleth',
    'nach Entfernung sortiert -- Aue (0,03 Meilen) vor Wandleth (0,09): ' . json_encode($rondraKandidaten));
assert($rondraKandidaten[0]['nennt_name'] === false && $rondraKandidaten[1]['nennt_name'] === true,
    'mit der Marke an der Stadt, deren Namen das Bauwerk traegt');
assert(($rondraNach['innerorts']['public_id'] ?? null) === 'stadt-wandleth',
    '💣 und die VORAUSWAHL ist trotzdem Wandleth -- der Knopf schlaegt nicht die naechste, sondern die '
    . 'wahrscheinliche Stadt vor (siehe avesmapsGaretienInnerortsVorauswahl)');
assert(count($objekte['Wandlether Rondratempel']['innerorts']['kandidaten'] ?? []) === 2,
    'und die Arbeitsliste reicht sie durch, ohne dass garetien-liste.php sie kennt: '
    . json_encode($objekte['Wandlether Rondratempel']['innerorts'] ?? null));
$pruefungen += 5;

// Der FRISCHE Nachschlag -- die Haelfte des Owner-Satzes, die der Planbau nicht kann („oder anderen
// importierten Siedlung"). Er rechnet gegen den HEUTIGEN Bestand, nicht gegen das `after_json`.
$schluesselRondra = $objekte['Wandlether Rondratempel']['key'];
$frisch = avesmapsGaretienInnerortsKandidatenFrisch($pdo, 1, $schluesselRondra);
assert(count($frisch) === 2 && $frisch[0]['name'] === 'Aue' && $frisch[1]['name'] === 'Wandleth',
    'derselbe Befund wie im Plan, nur eben gerade gerechnet: ' . json_encode($frisch));
// 💣 DIE PROBE AUF DEN OWNER-SATZ: eine Stadt, die es beim Planbau noch NICHT gab, steht sofort in
// der frischen Liste -- ohne ein zweites „Holen & Rechnen".
$ortAnlegen->execute(['stadt-neuling', 'Neuling', 'location', 'stadt', $punkt($tx + 0.02, $ty), '{}']);
avesmapsGaretienKandidatenVergessen();
$frisch2 = avesmapsGaretienInnerortsKandidatenFrisch($pdo, 1, $schluesselRondra);
assert(count($frisch2) === 3 && in_array('Neuling', array_column($frisch2, 'name'), true),
    '🔴 eine eben angelegte Siedlung steht sofort zur Wahl: ' . json_encode(array_column($frisch2, 'name')));
assert(count($objekte['Wandlether Rondratempel']['innerorts']['kandidaten']) === 2,
    '...waehrend der Befund im `after_json` unberuehrt bleibt -- er ist ein Schnappschuss des Planbaus');
assert(avesmapsGaretienInnerortsKandidatenFrisch($pdo, 1, 'gibtesnicht') === [],
    'ein unbekanntes Objekt: leere Liste, kein Fehler');
assert(avesmapsGaretienInnerortsKandidatenFrisch($pdo, 1, $objekte['Wandlether Vorwerk']['key']) === [],
    '🔴 NUR BAUWERKE -- ein Dorf neben einer Stadt ist ein Nachbardorf, auch im frischen Nachschlag');
$pruefungen += 5;

// =================================================================================================
// G. Die WAHL des Editors -- geprueft, nicht geglaubt
// =================================================================================================
require_once __DIR__ . '/../garetien-uebernahme.php';
$nachMitListe = $rondraNach;
assert((avesmapsGaretienInnerortsAusVorschlag($nachMitListe)['public_id'] ?? null) === 'stadt-wandleth',
    'ohne Wahl gilt die Vorauswahl -- wie vor dem 07.09.2026');
assert((avesmapsGaretienInnerortsAusVorschlag($nachMitListe, ['innerorts_public_id' => 'dorf-aue'])['name'] ?? null) === 'Aue',
    'eine Wahl aus der Liste gilt: der Editor entscheidet sich fuer das naehere Dorf');
// 💣 DER RIEGEL. Ohne ihn bände ein beliebiger Anfragerumpf eine Staette an eine beliebige
// public_id -- und weil settlement_place weich schreibt und die Staetten-Zeile nur einen Namen
// zeigt, faellt eine falsche Bindung niemandem auf.
assert((avesmapsGaretienInnerortsAusVorschlag($nachMitListe, ['innerorts_public_id' => 'stadt-erfunden'])['public_id'] ?? null) === 'stadt-wandleth',
    '💣 eine Stadt, die NICHT in den Kandidaten steht, faellt auf die Vorauswahl zurueck -- nie durch');
$ohneListe = ['innerorts' => ['public_id' => 'stadt-wandleth', 'name' => 'Wandleth', 'meilen' => 0.09]];
assert((avesmapsGaretienInnerortsAusVorschlag($ohneListe, ['innerorts_public_id' => 'dorf-aue'])['public_id'] ?? null) === 'stadt-wandleth',
    '🪤 ein Lauf VOR dem 07.09.2026 traegt keine `kandidaten` -- dort kann keine Wahl gelten');
assert(avesmapsGaretienInnerortsAusVorschlag(['innerorts' => []], ['innerorts_public_id' => 'dorf-aue']) === null,
    'und ohne Befund gibt es nichts zu waehlen');
$pruefungen += 5;

// =================================================================================================
// H. Der Umkreis-Spinner (Owner 08.09.2026) -- 0 bis 20 Meilen, geprueft am SERVER
// =================================================================================================
assert(AVESMAPS_GARETIEN_UMKREIS_MIN_MEILEN === 0.0 && AVESMAPS_GARETIEN_UMKREIS_MAX_MEILEN === 20.0,
    'die Grenzen sind die Owner-Zahlen: 0 bis 20 Meilen');
// 🔴 „NICHT GENANNT" UND „0" SIND VERSCHIEDENE ANTWORTEN -- ohne diese Trennung koennte man den
// Umkreis nie auf 0 stellen, oder ein alter Client suchte plötzlich mit 0.
assert(avesmapsGaretienUmkreisMeilen(null) === null, 'nicht genannt: null (die Funktion nimmt ihre eigene Vorgabe)');
assert(avesmapsGaretienUmkreisMeilen('') === null, 'leer: ebenso');
assert(avesmapsGaretienUmkreisMeilen('abc') === null, 'kein Zahlwert: ebenso');
assert(avesmapsGaretienUmkreisMeilen(0) === 0.0, '💣 eine ausdrueckliche 0 GILT -- sie ist der Rand des Bereichs, nicht „keine Angabe"');
assert(avesmapsGaretienUmkreisMeilen('7') === 7.0, 'eine Zahl als Zeichenkette (so kommt sie aus dem Rumpf)');
assert(avesmapsGaretienUmkreisMeilen(12.5) === 12.5, 'und als Zahl');
// 💣 GEKLEMMT, NICHT ABGELEHNT: ein `max="20"` im Markup ist eine Bitte an den Browser. Eine
// Umkreissuche mit 10.000 Meilen liefe gegen den ganzen Bestand -- die Schleife, die am 02.09.2026
// eine 502 erzeugt hat.
assert(avesmapsGaretienUmkreisMeilen(10000) === 20.0, 'ueber der Grenze wird geklemmt, nicht abgelehnt');
assert(avesmapsGaretienUmkreisMeilen(-5) === 0.0, 'unter der Grenze ebenso');
assert(avesmapsGaretienUmkreisMeilen(INF) === null, 'unendlich ist keine Zahl fuer diesen Zweck');
assert(avesmapsGaretienUmkreisMeilen(null, 5.0) === 5.0, 'mit ausdruecklicher Vorgabe faellt „nicht genannt" auf sie');
$pruefungen += 10;

// Die Reichweite wirkt WIRKLICH -- gemessen an derselben Fixture wie Abschnitt B.
$weit = [['public_id' => 'stadt-fern', 'name' => 'Fernstadt', 'punkte' => [[100.0 + 8.0 / AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT, 100.0]]]];
assert(avesmapsGaretienInnerortsKandidaten([[100.0, 100.0]], 'Irgendein Hof', $weit) === [],
    'mit der Vorgabe (5 Meilen) liegt eine Stadt in 8 Meilen ausserhalb');
assert(count(avesmapsGaretienInnerortsKandidaten([[100.0, 100.0]], 'Irgendein Hof', $weit, 12.0)) === 1,
    '🔴 mit 12 Meilen aus dem Spinner steht sie zur Wahl -- die Reichweite ist ein Parameter, keine Konstante mehr');
assert(avesmapsGaretienInnerortsKandidaten([[100.0, 100.0]], 'Irgendein Hof', $weit, 0.0) === [],
    '⚠️ und mit 0 findet sie nichts -- die 0 ist ein gueltiger Wert, kein „nimm die Vorgabe"');
assert(count(avesmapsGaretienInnerortsKandidaten([[100.02, 100.0]], 'Wandlether Baumeisterzunft', $ortschaften, null)) === 2,
    'null nimmt die Vorgabe AVESMAPS_GARETIEN_INNERORTS_MEILEN');
$pruefungen += 4;

// Und der Befund reicht sie durch, bis in den frischen Nachschlag.
$fernBefund = avesmapsGaretienInnerortsBefund($pdo, $zeileTempel, $zielTempel, 0.0);
assert($fernBefund === null, 'mit 0 Meilen gibt es keinen Befund, auch wo bei 5 einer war');
assert((avesmapsGaretienInnerortsBefund($pdo, $zeileTempel, $zielTempel, 12.0)['name'] ?? null) === 'Wandleth',
    'mit 12 Meilen weiterhin -- und die Vorauswahl bleibt die Stadt mit dem Namenstreffer');
assert(avesmapsGaretienInnerortsKandidatenFrisch($pdo, 1, $schluesselRondra, 0.0) === [],
    'der frische Nachschlag nimmt sie ebenso entgegen');
$pruefungen += 3;

echo "OK: {$pruefungen} Pruefungen\n";
