<?php

declare(strict_types=1);

// Der Abgleich fuellt die VORHANDENE Uebernahme-Vorschau.
//
// 🔴 DIE ZUSICHERUNG, DIE DAS HAUS SCHUETZT: das Rechnen schreibt in KEINE Nutztabelle.
// Das gilt fuer jeden Sync-Lauf im Haus (sync-plan-purity-test.php) und der Import erbt es.
//
// 🪤 Der Bauplan schrieb diesen Test gegen `category` / `preselected` / `payload_json`. So heissen
// die Spalten NICHT -- `sync_plan_item` traegt `change_type`, `selected` und `after_json`. Der
// Plan verlangt an derselben Stelle "keine zweite Vorschau bauen"; dann gilt auch ihr Schema,
// nicht das erfundene. Mit den Namen aus dem Plan haette dieser Test eine zweite Tabelle
// beschrieben und waere gruen gewesen, waehrend die Vorschau leer bleibt.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-plan-test.php

require_once __DIR__ . '/../garetien-plan.php';

$pruefungen = 0;
$pdo = avesmapsGaretienPlanTestPdo();   // Staging + map_features + ecosystem_* + sync_plan_*

$vorherFeatures = (int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn();
$vorherRegionen = (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_region')->fetchColumn();
$vorherFlaechen = (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_area')->fetchColumn();

$anzahl = avesmapsGaretienBaueSyncPlan($pdo, 1);

// --- 🔴 Die Kernzusicherung: das Rechnen darf KEINE Nutztabelle anfassen.
assert($vorherFeatures === (int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn(),
    'das Rechnen darf map_features nicht anfassen');
assert($vorherRegionen === (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_region')->fetchColumn(),
    'und ecosystem_region auch nicht');
assert($vorherFlaechen === (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_area')->fetchColumn(),
    'und ecosystem_area auch nicht');
$pruefungen += 3;

// --- 💣 GEZAEHLT, NICHT NUR "GROESSER NULL". Der Pruefstand hat sechs Quellzeilen: Gardel und
// Muehlsee sind neu, der Seitenarm ist ein Zufluss (eigenes neues Objekt) -- macht drei. Die
// Alke deckt sich mit einem Bestandsfluss und bringt seit Aufgabe 3 (der vierte Ausgang) selbst
// ZWEI Eintraege: eine Quellen-Luecke (ihre Quelle liegt bei uns noch nicht) plus ein
// Geometrie-Angebot (genau EIN Abschnitt getroffen) -- macht fuenf. "Nachbarprovinzen" ist ein
// Sammelartikel, der Kontinent hat kein Gegenstueck. 🪤 Mit "> 0" ueberlebten drei Mutationen:
// uebersprungene Zeilen doch aufnehmen, deckende ganz verwerfen statt ueber den vierten Ausgang
// zu fuehren, und den Ueberspringen-Riegel ganz entfernen -- jedes Mal wurden es MEHR Eintraege,
// und mehr ist immer noch groesser als null.
assert($anzahl === 5, 'genau fuenf Vorschlaege aus sechs Quellzeilen, ' . $anzahl . ' gebaut');
$namen = $pdo->query('SELECT label FROM sync_plan_item ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
// 🔴 Review I1: die Beschriftung traegt seither den Anlass (sonst waeren die beiden Alke-Items
// nicht auseinanderzuhalten -- eines schreibt eine Quelle, das andere bietet nur die Geometrie an).
assert($namen === ['Alke → Alke · Quelle', 'Alke → Alke · Geometrie', 'Gardel (Fluss)', 'Mühlsee (See)', 'Seitenarm der Alke (Bach) · liegt auf "Alke"'],
    'die richtigen fuenf: ' . implode(' | ', $namen));
$pruefungen += 2;

// --- 🔴 Review I2: das Geometrie-Item ist IMMER ungehakt -- auch tatsaechlich in der Datenbank,
// nicht nur im rohen Item vor avesmapsSyncPlanAddItem. avesmapsSyncPlanDefaultSelected('changed', 0)
// gibt 1 zurueck; das `vorwahl_aus` in avesmapsGaretienErgaenzungsEintraege ist das EINZIGE, was
// ein vorangehaktes Geometrie-Ersetzen verhindert.
$geometrieZeilen = [];
foreach ($pdo->query('SELECT selected, after_json FROM sync_plan_item') as $zeile) {
    $nachDb = json_decode((string) $zeile['after_json'], true);
    if (($nachDb['anlass'] ?? null) === 'geometrie') {
        $geometrieZeilen[] = $zeile;
    }
}
assert(count($geometrieZeilen) === 1,
    'genau ein Geometrie-Item aus der deckenden Alke, ' . count($geometrieZeilen) . ' gefunden');
assert((int) $geometrieZeilen[0]['selected'] === 0,
    'ein Geometrie-Item darf nicht vorangehakt in der Datenbank landen');
$pruefungen += 2;

// --- 🔴 EIN ZUFLUSS IST EIN NEUES OBJEKT, KEINE AENDERUNG AN UNSEREM FLUSS (Owner 27.08.2026).
// Live sind das 34 der 37 Widersprueche. Als 'changed' mit unserem Fluss als Ziel wuerde die
// Uebernahme dessen Geometrie mit der des Seitenarms ueberschreiben -- und 'changed' kommt nach
// der Hausregel VORANGEHAKT, ein Klick auf "alle uebernehmen" waere destruktiv.
$seitenarm = $pdo->query("SELECT * FROM sync_plan_item WHERE label LIKE 'Seitenarm%'")->fetch(PDO::FETCH_ASSOC);
assert($seitenarm !== false, 'der Zufluss steht im Plan');
assert($seitenarm['change_type'] === 'new', 'er ist NEU, keine Aenderung an der Alke');
assert((int) $seitenarm['selected'] === 0, 'und er startet UNGEHAKT -- vorangehakt ist nur das Fuellen einer Luecke');
// 💣 Das entscheidende Feld: ein entity_public_id ist fuer die Uebernahme das ZIEL, nicht eine
// Bemerkung. Stuende die Alke hier, waere die Zeile trotz 'new' ein Schreibzugriff auf sie.
assert($seitenarm['entity_public_id'] === null, 'er zeigt auf NICHTS Vorhandenes');
assert($seitenarm['before_json'] === null, 'und er behauptet auch keinen Vorzustand');
// Der Grund steht sichtbar in der Beschriftung, nicht nur im JSON.
assert(str_contains((string) $seitenarm['label'], 'liegt auf'), 'der Grund steht in der Zeile');
$seitenarmNach = json_decode((string) $seitenarm['after_json'], true);
assert($seitenarmNach['anlass'] === 'zufluss', 'der Anlass ist ein FELD, kein deutscher Satz');
assert($seitenarmNach['nachbar'] === 'Alke', 'der Nachbar reist als Angabe mit');
$pruefungen += 8;

// --- Die Vorschlaege tragen die Kategorien, die die Vorschau kennt.
$kat = $pdo->query('SELECT DISTINCT change_type FROM sync_plan_item')->fetchAll(PDO::FETCH_COLUMN);
foreach ($kat as $k) {
    assert(in_array($k, AVESMAPS_SYNC_PLAN_CHANGE_TYPES, true), "unbekannte Kategorie {$k}");
}
$pruefungen++;

// --- 🔴 Es gibt KEINE Loeschungen: ein Import entfernt nichts von unserer Karte.
assert(!in_array('deleted', $kat, true), 'ein Import darf nichts loeschen');
$pruefungen++;

// --- Der Lauf gehoert der eigenen Art und ist fertig gebaut.
$lauf = avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND);
assert($lauf !== null, 'nach dem Bauen steht ein offener Lauf da');
assert((string) $lauf['kind'] === 'garetien');
$pruefungen += 2;

// --- Vorangehakt ist, was eine LUECKE fuellt; Geaendertes wird NICHT ungefragt ueberschrieben.
// ⚠️ Der Riegel steht im Haus (avesmapsSyncPlanDefaultSelected) und wird hier BENUTZT, nicht
// nachgebaut -- ein zweiter Vorwahl-Rechner waere genau die Divergenz, die diese Aufgabe
// vermeiden soll.
$neuGehakt = (int) $pdo->query("SELECT COUNT(*) FROM sync_plan_item WHERE change_type='new' AND selected=1")->fetchColumn();
assert($neuGehakt > 0, 'Neuzugaenge sind vorangehakt');
$pruefungen++;

// --- 🔴 Jeder Vorschlag traegt seine Quelle und seine Zielart mit, sonst kann die Uebernahme
// beides nicht setzen.
// 🪤 Am FELD geprueft, nicht per LIKE '%garetien%': das Wort steht auch in der Quelle
// (source_type, origin), also blieb der Test gruen, als die Herkunft aus dem Vorschlag fiel.
foreach ($pdo->query('SELECT label, after_json FROM sync_plan_item') as $zeile) {
    $nach = json_decode((string) $zeile['after_json'], true);
    assert(is_array($nach), 'after_json ist da: ' . $zeile['label']);
    assert(($nach['herkunft'] ?? null) === 'garetien', 'Herkunft fehlt bei ' . $zeile['label']);
    // 🔴 Es ist ein BRIEFSPIEL, kein eigener Typ (Owner 27.08.2026). garetien.de und koschwiki.de
    // sind genau das, und das Haus fuehrt diese Form seit langem -- 96 Briefspiel-Quellen im
    // Katalog, darunter "Briefspiel (Weiden)" und "Albernisches Briefspiel".
    assert(($nach['quelle']['source_type'] ?? null) === 'briefspiel', 'source_type fehlt bei ' . $zeile['label']);
    // Und die Beschriftung nennt das Briefspiel, waehrend die Adresse auf den Artikel zeigt.
    assert(in_array($nach['quelle']['label'] ?? null, ['Briefspiel (Garetien)', 'Briefspiel (Kosch)'], true),
        'die Beschriftung nennt das Briefspiel: ' . var_export($nach['quelle']['label'] ?? null, true));
    assert(str_contains((string) ($nach['quelle']['url'] ?? ''), 'title='),
        'und die Adresse zeigt auf den Artikel: ' . ($nach['quelle']['url'] ?? ''));
    assert(($nach['quelle']['origin'] ?? null) === 'garetien', 'origin fehlt bei ' . $zeile['label']);
    assert(str_contains((string) ($nach['quelle']['url'] ?? ''), '.de'), 'die Quelle zeigt auf ein Wiki');
}
$pruefungen += 5;

// --- 💣 EINE FLAECHE IST EIN RING, EINE LINIE NICHT. Bei GeoJSON liegt die Punktliste eines
// Polygons eine Ebene tiefer. Wer das gleichsetzt, schreibt einen See als Linienzug in die
// Karte -- und die Koordinaten sind dabei alle gueltig, es faellt also an keiner Schranke auf.
foreach ($pdo->query('SELECT label, after_json FROM sync_plan_item') as $zeile) {
    $nach = json_decode((string) $zeile['after_json'], true);
    $koord = $nach['geometry']['coordinates'];
    if ($nach['ziel'] === 'region') {
        assert($nach['geometry']['type'] === 'Polygon', 'eine Flaeche ist ein Polygon: ' . $zeile['label']);
        assert(is_array($koord[0][0] ?? null), 'und ihre Punkte liegen im RING: ' . $zeile['label']);
    } else {
        assert($nach['geometry']['type'] === 'LineString', 'ein Fluss ist eine Linie: ' . $zeile['label']);
        assert(is_float($koord[0][0] ?? null), 'und ihre Punkte liegen flach: ' . $zeile['label']);
    }
}
$pruefungen += 2;

// --- 💣 DIE GEOMETRIE IM VORSCHLAG STEHT IN UNSEREN KARTENEINHEITEN, nicht in Wagenhalt-Zahlen.
// Wagenhalt-Werte gehen bis in die Hunderttausende; unsere Karte ist 0..1024. Eine ungewandelte
// Geometrie faellt deshalb NICHT auf, wenn man nur "ist etwas da" prueft -- sie landet einfach
// weit ausserhalb, und niemand sieht das Objekt je wieder.
// 🪤 Die Ringe muessen MIT geprueft werden. Eine erste Fassung uebersprang jeden Punkt, dessen
// erstes Glied ein Array ist -- und damit ausgerechnet die Flaechen, also die Haelfte der
// Objekte. Ein Test, der die Haelfte ueberspringt, meldet trotzdem "geprueft".
$geprueft = 0;
$flach = static function (array $k) use (&$flach, &$geprueft): void {
    if (is_numeric($k[0] ?? null) && is_numeric($k[1] ?? null)) {
        assert($k[0] >= 0.0 && $k[0] <= 1024.0, "x={$k[0]} liegt ausserhalb der Karte -- nicht gewandelt?");
        assert($k[1] >= 0.0 && $k[1] <= 1024.0, "y={$k[1]} liegt ausserhalb der Karte -- nicht gewandelt?");
        $geprueft++;
        return;
    }
    foreach ($k as $kind) { if (is_array($kind)) { $flach($kind); } }
};
$mitFlaeche = 0;
foreach ($pdo->query('SELECT after_json FROM sync_plan_item') as $zeile) {
    $nach = json_decode((string) $zeile['after_json'], true);
    $flach((array) ($nach['geometry']['coordinates'] ?? []));
    if (($nach['ziel'] ?? '') === 'region') { $mitFlaeche++; }
}
assert($geprueft >= 7, 'alle Punkte beider Objekte geprueft, nur ' . $geprueft . ' gesehen');
assert($mitFlaeche === 1, 'und eine Flaeche war dabei -- sonst prueft das nur Linien');
$pruefungen += 3;

// --- Ein zweiter Bau verdraengt den ersten, statt zwei offene Laeufe stehenzulassen.
$zweiter = avesmapsGaretienBaueSyncPlan($pdo, 1);
$offene = (int) $pdo->query("SELECT COUNT(*) FROM sync_plan_run WHERE kind='garetien' AND state='open'")->fetchColumn();
assert($zweiter === $anzahl, 'derselbe Bestand ergibt dieselbe Zahl');
assert($offene === 1, 'genau EIN offener Lauf, ' . $offene . ' gefunden');
$pruefungen += 2;

// --- 🔴 Die Beschriftung der neuen Art steht im VORHANDENEN Bauteil, nicht in einem zweiten.
// Ohne Eintrag traegt das Blatt fuer diese Art keinen Titel und keine Ein-/Mehrzahl -- die
// zweite Bestaetigung saehe dann "3 undefined" (dieselbe Lehre wie bei der leeren Loeschgruppe).
$blatt = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../../../../js/review/sync-plan-sheet.js'));
foreach (['SYNC_PLAN_KIND_NOUNS', 'SYNC_PLAN_KIND_TITLES', 'SYNC_PLAN_KIND_DELETION', 'SYNC_PLAN_KIND_EMPTY_HINT'] as $tafel) {
    $von = strpos($blatt, 'const ' . $tafel);
    assert($von !== false, $tafel . ' gibt es');
    $bis = strpos($blatt, '};', $von);
    assert(str_contains(substr($blatt, $von, $bis - $von), 'garetien:'), $tafel . ' kennt die neue Art nicht');
    $pruefungen++;
}

// --- 🔴 Und sie loescht NICHTS: der Eintrag in der Loeschtafel ist `null`, kein Kasten.
// Eine rote, immer leere Loeschgruppe bringt einem Editor bei, sie zu ueberblaettern -- und dann
// ueberblaettert er sie auch dort, wo wirklich etwas verschwindet.
$von = strpos($blatt, 'const SYNC_PLAN_KIND_DELETION');
$loeschTafel = substr($blatt, $von, (int) strpos($blatt, "\n};", $von) - $von);
assert(preg_match('~garetien:\s*null~', $loeschTafel) === 1, 'der Import loescht nichts');
$pruefungen++;

// ---------------------------------------------------------------------------------------------
// DER VIERTE AUSGANG: "haben wir -- aber sie wissen mehr" (Auftrag §4).
//
// 🔴 Es gibt keinen vierten change_type. Es ist ein `changed` mit after.anlass.

// -- 🔴 Review C1: avesmapsGaretienQuellenBestand() darf NICHT nach `status` filtern -- der
// Hauswert ist 'approved', der einzige andere 'suppressed' ist der Grabstein einer von HAND
// entfernten Verknuepfung und zaehlt trotzdem als "die Quelle ist erledigt". Und der Schluessel
// traegt den Zieltyp, weil path UND region denselben public_id-Raum benutzen.
$pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin)
            VALUES ('path', 'quellen-genehmigt', 1, 'approved', 'garetien')");
$pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin)
            VALUES ('path', 'quellen-unterdrueckt', 2, 'suppressed', 'garetien')");
// Eine fremde Herkunft (nicht 'garetien') darf nicht mitgezaehlt werden.
$pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin)
            VALUES ('path', 'quellen-fremd', 3, 'approved', 'manual')");
$bestand = avesmapsGaretienQuellenBestand($pdo);
assert(isset($bestand['path|quellen-genehmigt']), 'eine genehmigte Garetien-Quelle muss im Bestand landen');
assert(isset($bestand['path|quellen-unterdrueckt']),
    'eine UNTERDRUECKTE Quelle zaehlt trotzdem -- Grabstein, kein Fehlen');
assert(!isset($bestand['path|quellen-fremd']), 'eine fremde Herkunft darf nicht mitgezaehlt werden');
$pruefungen += 3;

// -- Fall A/B: ein NAMENLOSER Abschnitt. Die Luecke wird gefuellt, also vorangehakt.
$urteilA = ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'w-1',
    'treffer_name' => '', 'grund' => 'Geometrie deckt sich', 'abstand' => 0.41,
    'abschnitte' => [['public_id' => 'w-1', 'name' => '', 'punkte' => 12, 'geometrie' => [[1.0, 2.0]]]]];
$zeileA = ['wiki' => 'ggp', 'ebene' => 'Gewaesser', 'zeile_nr' => 1, 'typ' => 'Bach',
    'namensraum' => 'Garetien', 'artikel' => 'Alke', 'anzeige' => 'Alke',
    'geo_art' => 'koordinaten', 'geo' => '20000 10000, 21000 11000'];
$a = avesmapsGaretienErgaenzungsEintraege($zeileA, avesmapsGaretienMappeTyp('Bach'), $urteilA, []);

$luecken = array_values(array_filter($a, static fn($e) => $e['after']['anlass'] === 'ergaenzung'));
assert(count($luecken) === 1, 'ein namenloser Abschnitt muss GENAU ein Luecken-Item ergeben');
assert($luecken[0]['change_type'] === 'changed', 'der vierte Ausgang ist ein changed');
assert($luecken[0]['entity_public_id'] === 'w-1', 'das Ziel ist der ABSCHNITT, nicht das Objekt');
assert(in_array('name', $luecken[0]['after']['felder'], true), 'der leere Name ist eine Luecke');
assert(in_array('quelle', $luecken[0]['after']['felder'], true), 'die fehlende Quelle ist eine Luecke');
assert($luecken[0]['vorwahl_aus'] === false, 'eine Luecke kommt VORANGEHAKT (Owner 16.08.2026)');
assert(array_filter($a, static fn($e) => $e['after']['anlass'] === 'umbenennung') === [],
    'ein LEERER Name wird gefuellt, nicht umbenannt');
$pruefungen += 7;

// -- 🔴 Review I2: das Geometrie-Item existiert POSITIV -- bislang sicherte kein Test zu, dass es
// bei einem einzelnen getroffenen Abschnitt wirklich entsteht, geschweige denn dass es ungehakt
// bleibt. Und Review I1: `after.name` gehoert NUR auf das Item, das den Namen wirklich schreibt.
$geometrieA = array_values(array_filter($a, static fn($e) => $e['after']['anlass'] === 'geometrie'));
assert(count($geometrieA) === 1, 'ein einzelner getroffener Abschnitt bekommt sein Geometrie-Angebot');
assert($geometrieA[0]['vorwahl_aus'] === true, 'ein Geometrie-Item ist IMMER ungehakt');
assert($geometrieA[0]['entity_public_id'] === 'w-1', 'und zielt auf denselben Abschnitt');
assert($luecken[0]['after']['name'] === 'Alke', 'das Luecken-Item TRAEGT den Namen -- er ist Teil seiner Luecke');
assert(!array_key_exists('name', $geometrieA[0]['after']), 'das Geometrie-Item verspricht keinen Namenswechsel');
assert(count($a) === 2, 'ein einzelner Abschnitt ergibt genau Luecke + Geometrie-Angebot, ' . count($a) . ' gefunden');
$pruefungen += 6;

// -- Fall C: ihr EINES Objekt laeuft ueber DREI unserer Fluesse.
// 💣 Der Gardel bekommt NICHTS. Ihn "Natter" zu nennen waere falsch, obwohl er getroffen ist.
$urteilC = ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'w-4471',
    'treffer_name' => 'Natter', 'grund' => 'Geometrie deckt sich', 'abstand' => 0.84,
    'abschnitte' => [
        ['public_id' => 'w-4471', 'name' => 'Natter', 'punkte' => 9, 'geometrie' => [[1.0, 1.0]]],
        ['public_id' => 'w-5008', 'name' => 'Gardel', 'punkte' => 6, 'geometrie' => [[2.0, 2.0]]],
        ['public_id' => 'w-6120', 'name' => '', 'punkte' => 1, 'geometrie' => [[3.0, 3.0]]],
    ]];
$zeileC = $zeileA;
$zeileC['artikel'] = 'Natter';
$zeileC['anzeige'] = 'Natter';
$c = avesmapsGaretienErgaenzungsEintraege($zeileC, avesmapsGaretienMappeTyp('Fluss'), $urteilC, []);

assert(avesmapsGaretienEinObjekt($urteilC['abschnitte']) === false,
    'drei Fluesse sind nicht EIN Objekt');
$zielIds = array_map(static fn($e) => $e['entity_public_id'], $c);
assert(!in_array('w-5008', $zielIds, true),
    'der Gardel traegt einen FREMDEN Namen und darf kein Angebot bekommen -- ihre Natter laeuft nur darueber');
$mitName = array_values(array_filter($c,
    static fn($e) => in_array('name', $e['after']['felder'], true)));
assert(count($mitName) === 1, 'genau EIN Abschnitt bekommt einen Namen: der namenlose 6120');
assert($mitName[0]['entity_public_id'] === 'w-6120', 'und zwar der namenlose');
// Der gleichnamige Abschnitt bekommt die Quelle, aber niemals einen neuen Namen.
// 🔴 Meldung A (30.08.2026): 'w-4471' traegt seither ZWEI Items (Quelle + Geometrie) -- der
// Filter braucht deshalb den Anlass, sonst faengt er beide statt der Quellen-Ergaenzung allein.
$natter = array_values(array_filter($c,
    static fn($e) => $e['entity_public_id'] === 'w-4471' && $e['after']['anlass'] === 'ergaenzung'));
assert(count($natter) === 1 && $natter[0]['after']['felder'] === ['quelle'],
    'ein gleichnamiger Abschnitt bekommt die Quelle -- und sonst nichts');
// Review I1: ein reines Quellen-Item verspricht keinen Namenswechsel.
assert(!array_key_exists('name', $natter[0]['after']), 'ein reines Quellen-Item darf keinen Namen versprechen');
$pruefungen += 6;

// -- Meldung A (30.08.2026): das Geometrie-Item entsteht jetzt JE LEGITIMEM Abschnitt, nicht mehr
// nur bei genau einem Treffer insgesamt. Natter (gleicher Name) und der namenlose 6120 (Luecke)
// sind legitim und bekommen je ein Geometrie-Angebot; der Gardel (fremder Name, kein gemeinsames
// Objekt) bleibt aussen vor -- dieselbe Ausschlussregel wie bei Luecke/Umbenennung.
$geometrieC = array_values(array_filter($c, static fn($e) => $e['after']['anlass'] === 'geometrie'));
$geometrieCZiele = array_map(static fn($e) => $e['entity_public_id'], $geometrieC);
assert(count($geometrieC) === 2,
    'Natter und der namenlose Abschnitt bekommen je ein Geometrie-Angebot, ' . count($geometrieC) . ' gefunden');
assert(in_array('w-4471', $geometrieCZiele, true) && in_array('w-6120', $geometrieCZiele, true),
    'die zwei Geometrie-Angebote zielen auf Natter und den namenlosen Abschnitt');
assert(!in_array('w-5008', $geometrieCZiele, true),
    'der Gardel bekommt KEIN Geometrie-Angebot -- fremder Name, kein gemeinsames Objekt');
assert($geometrieC[0]['vorwahl_aus'] === true, 'auch bei mehreren Abschnitten ist jedes Geometrie-Item IMMER ungehakt');
$pruefungen += 4;

// -- Fall D: ihre "Angbarer Reichsstrasse" trifft SECHSMAL unsere "Reichsstrasse 3".
// Ein Name -> es IST unser Objekt -> die Umbenennung ist eine sinnvolle Frage, aber UNGEHAKT.
$sechs = [];
foreach (range(2210, 2215) as $nr) {
    $sechs[] = ['public_id' => 'w-' . $nr, 'name' => 'Reichsstraße 3', 'punkte' => 3, 'geometrie' => [[1.0, 1.0]]];
}
$urteilD = ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'w-2210',
    'treffer_name' => 'Reichsstraße 3', 'grund' => 'Geometrie deckt sich', 'abstand' => 0.5,
    'abschnitte' => $sechs];
$zeileD = $zeileA;
$zeileD['artikel'] = 'Angbarer Reichsstraße';
$zeileD['anzeige'] = 'Angbarer Reichsstraße';
$d = avesmapsGaretienErgaenzungsEintraege($zeileD, avesmapsGaretienMappeTyp('Bach'), $urteilD, []);

assert(avesmapsGaretienEinObjekt($sechs) === true, 'sechsmal derselbe Name ist EIN Objekt');
$um = array_values(array_filter($d, static fn($e) => $e['after']['anlass'] === 'umbenennung'));
assert(count($um) === 6, 'jeder der sechs Abschnitte bekommt sein eigenes Umbenennungs-Item');
assert($um[0]['vorwahl_aus'] === true,
    'ein vorhandener Name wird NIE stillschweigend ueberschrieben -- ungehakt');
assert($um[0]['before']['name'] === 'Reichsstraße 3', 'alt -> neu im Klartext: das alt fehlt');
assert($um[0]['after']['name'] === 'Angbarer Reichsstraße', 'alt -> neu im Klartext: das neu fehlt');
$nurQuelle = array_values(array_filter($d, static fn($e) => $e['after']['anlass'] === 'ergaenzung'));
assert(count($nurQuelle) === 6,
    'daneben sechs reine Quellen-Items -- das ist der Knopf "Nur Quelle + Artikel (6)"');
assert($nurQuelle[0]['vorwahl_aus'] === false, 'die Quelle ist eine Luecke und kommt vorangehakt');
$pruefungen += 7;

// -- Meldung A (30.08.2026): alle sechs Abschnitte teilen EINEN Namen ($einObjekt), sind also
// alle legitim -- jeder bekommt jetzt sein eigenes Geometrie-Angebot.
$geometrieD = array_values(array_filter($d, static fn($e) => $e['after']['anlass'] === 'geometrie'));
assert(count($geometrieD) === 6, 'jeder der sechs Abschnitte bekommt sein eigenes Geometrie-Angebot');
assert(count(array_unique(array_map(static fn($e) => $e['entity_public_id'], $geometrieD))) === 6,
    'und zwar sechs VERSCHIEDENE Ziele');
assert(count(array_unique(array_map(static fn($e) => $e['label'], $geometrieD))) === 6,
    'sechs Geometrie-Items brauchen sechs unterscheidbare Beschriftungen');
$pruefungen += 3;

// -- 🔴 Review I1: sechs Abschnitte tragen alle DENSELBEN Namen "Reichsstraße 3" -- ohne Anlass
// UND Abschnitt in der Beschriftung waeren die sechs Umbenennungs-Items (und die sechs
// Quellen-Items) im Blatt nicht auseinanderzuhalten.
assert(count(array_unique(array_map(static fn($e) => $e['label'], $um))) === 6,
    'sechs Umbenennungs-Items brauchen sechs unterscheidbare Beschriftungen');
assert(count(array_filter($um, static fn($e) => str_contains((string) $e['label'], 'umbenennen'))) === 6,
    'jede Umbenennungs-Beschriftung nennt den Anlass');
assert(count(array_unique(array_map(static fn($e) => $e['label'], $nurQuelle))) === 6,
    'sechs Quellen-Items brauchen sechs unterscheidbare Beschriftungen');
// Und: das begleitende Quellen-Item verspricht -- anders als das Umbenennungs-Item -- keinen Namen.
assert(!array_key_exists('name', $nurQuelle[0]['after']), 'ein Quellen-Item neben der Umbenennung traegt keinen Namen');
$pruefungen += 4;

// -- Nichts zu ersetzen: gleicher Name, Quelle liegt schon -- NUR das Geometrie-Angebot bleibt.
// 🔴 Review I2 (nimmt M2 mit): eine leere array_filter-Zusicherung waere auch dann gruen, wenn
// gar nichts mehr entstuende. Hier wird POSITIV geprueft, was tatsaechlich uebrig bleibt.
$fertig = avesmapsGaretienErgaenzungsEintraege($zeileC, avesmapsGaretienMappeTyp('Fluss'),
    ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'w-4471',
     'treffer_name' => 'Natter', 'grund' => '', 'abstand' => 0.1,
     'abschnitte' => [['public_id' => 'w-4471', 'name' => 'Natter', 'punkte' => 9, 'geometrie' => []]]],
    ['path|w-4471' => true]);
assert(count($fertig) === 1,
    'gleicher Name plus vorhandene Quelle heisst: nur das Geometrie-Angebot bleibt, ' . count($fertig) . ' gefunden');
assert($fertig[0]['after']['anlass'] === 'geometrie', 'das einzige verbleibende Item ist das Geometrie-Angebot');
assert($fertig[0]['vorwahl_aus'] === true, 'und es ist -- wie jedes Geometrie-Item -- ungehakt');
assert(!array_key_exists('name', $fertig[0]['after']), 'und es verspricht keinen Namenswechsel');
$pruefungen += 4;

// -- 🔴 RULING R6 (Owner, nach R5 -- siehe Kommentar am Erzeuger): ein REGION-Ziel bekommt bei
// GENAU EINEM getroffenen Abschnitt GENAUSO ein Geometrie-Item wie ein Weg. Owner, woertlich:
// "geometrie ersetzen muss es fuer alle geometrien geben -- alle formen von flaechen UND
// wege/fluesse." (Die Reparatur der zwei echten Fehler -- falscher id-Raum, fehlende erwartete
// Revision -- sitzt im Anwender, nicht hier: der Plan-Bauer weiss nichts von ecosystem_area.)
$urteilSee = ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'r-1',
    'treffer_name' => 'Mühlsee', 'grund' => 'Geometrie deckt sich', 'abstand' => 0.2,
    'abschnitte' => [['public_id' => 'r-1', 'name' => 'Mühlsee', 'punkte' => 8, 'geometrie' => [[1.0, 1.0]]]]];
$zeileSee = $zeileA;
$zeileSee['artikel'] = 'Muehlsee';
$zeileSee['anzeige'] = 'Mühlsee';
$see = avesmapsGaretienErgaenzungsEintraege($zeileSee, avesmapsGaretienMappeTyp('See'), $urteilSee, []);
assert(avesmapsGaretienMappeTyp('See')['ziel'] === 'region', 'die Vorbedingung des Falls: See ist ein Landschafts-Ziel');
$geometrieSee = array_values(array_filter($see, static fn($e) => $e['after']['anlass'] === 'geometrie'));
assert(count($geometrieSee) === 1,
    'ein Landschafts-Ziel bekommt bei genau EINEM getroffenen Abschnitt sein Geometrie-Angebot');
assert($geometrieSee[0]['entity_public_id'] === 'r-1', 'und zielt auf denselben Abschnitt');
assert($geometrieSee[0]['vorwahl_aus'] === true, 'auch bei einer Region ist das Geometrie-Item IMMER ungehakt');
$pruefungen += 3;

// ---------------------------------------------------------------------------------------------
// AUFGABE 14: DER BESTANDSCHECK EINER FLAECHE MUSS DIE LABEL-ID PRUEFEN, NICHT DIE REGIONS-ID.
//
// Seit 367895a38 haengt die Quelle einer Landschaftsflaeche an ihrer BESCHRIFTUNG
// (map-features.php:1228, 'label' -> 'region', gekeyt an der public_id des LABELS), und
// avesmapsGaretienQuellenBestand liest `feature_sources` entsprechend. `$abschnitt['public_id']`
// ist bei einem Flaechenziel aber die REGIONS-id (avesmapsGaretienKandidaten waehlt
// `r.public_id`) -- vor dieser Reparatur verglich der Bestandscheck also dauerhaft die falsche
// id gegen den Bestand, und $hatQuelle war fuer jede Flaeche IMMER false.
//
// 🪤 Regions-id und Label-id sind hier ABSICHTLICH verschieden ('r-9' gegen 'lbl-9') -- mit
// gleichen ids haette der urspruengliche Fehler diesen Test unbemerkt ueberlebt.
$urteilSeeMitLabel = ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'r-9',
    'treffer_name' => 'Mühlsee', 'grund' => 'Geometrie deckt sich', 'abstand' => 0.2,
    'abschnitte' => [['public_id' => 'r-9', 'name' => 'Mühlsee', 'punkte' => 8,
        'geometrie' => [[1.0, 1.0]], 'label_public_id' => 'lbl-9']]];

// Die Quelle liegt bereits -- unter der LABEL-id, wie sie beim Schreiben angehaengt wird
// (avesmapsGaretienErgaenzungAnwenden, garetien-uebernahme.php).
$flaecheMitQuelle = avesmapsGaretienErgaenzungsEintraege(
    $zeileSee, avesmapsGaretienMappeTyp('See'), $urteilSeeMitLabel, ['region|lbl-9' => true]
);
$lueckeMitQuelle = array_values(array_filter($flaecheMitQuelle,
    static fn($e) => $e['after']['anlass'] === 'ergaenzung' && in_array('quelle', $e['after']['felder'], true)));
assert($lueckeMitQuelle === [],
    'eine Flaeche, deren Quelle am Label haengt, wird NICHT erneut als "Quelle fehlt" angeboten');
// Das Geometrie-Angebot ist vom Quellen-Bestand unabhaengig und bleibt bestehen.
assert(count(array_filter($flaecheMitQuelle, static fn($e) => $e['after']['anlass'] === 'geometrie')) === 1,
    'das Geometrie-Angebot bleibt davon unberuehrt');
$pruefungen += 2;

// Dieselbe Flaeche, aber die Quelle liegt (im Bestand) gar nicht -- die Luecke wird angeboten.
$flaecheOhneQuelle = avesmapsGaretienErgaenzungsEintraege(
    $zeileSee, avesmapsGaretienMappeTyp('See'), $urteilSeeMitLabel, []
);
$lueckeOhneQuelle = array_values(array_filter($flaecheOhneQuelle,
    static fn($e) => $e['after']['anlass'] === 'ergaenzung' && in_array('quelle', $e['after']['felder'], true)));
assert(count($lueckeOhneQuelle) === 1, 'eine Flaeche OHNE Quelle wird angeboten');
$pruefungen++;

// Gegenprobe zur Falle: der Bestand unter der REGIONS-id (der alte, falsche Schluessel) darf die
// Luecke nicht schliessen -- sonst pruefte dieser Test nur sich selbst.
$flaecheMitFalscherId = avesmapsGaretienErgaenzungsEintraege(
    $zeileSee, avesmapsGaretienMappeTyp('See'), $urteilSeeMitLabel, ['region|r-9' => true]
);
$lueckeBeiFalscherId = array_values(array_filter($flaecheMitFalscherId,
    static fn($e) => $e['after']['anlass'] === 'ergaenzung' && in_array('quelle', $e['after']['felder'], true)));
assert(count($lueckeBeiFalscherId) === 1,
    'ein Bestand unter der Regions-id (statt der Label-id) schliesst die Luecke NICHT -- sonst waere der Test blind');
$pruefungen++;

// -- Gegenprobe: fuer WEG und ORT bleibt es beim ALTEN Verhalten -- der Schluessel ist weiterhin
// die eigene public_id des Abschnitts, keine Label-Umschaltung. Der Weg-Fall steht schon oben
// ($fertig, Zeile "Nichts zu ersetzen"); hier zusaetzlich ein ORT, mit derselben Form.
$urteilOrtMitQuelle = ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'o-1',
    'treffer_name' => 'Alkwelt', 'grund' => 'Geometrie deckt sich', 'abstand' => 0.1,
    'abschnitte' => [['public_id' => 'o-1', 'name' => 'Alkwelt', 'punkte' => 1, 'geometrie' => [[1.0, 1.0]]]]];
$zeileOrt = $zeileA;
$zeileOrt['typ'] = 'Dorf';
$zeileOrt['artikel'] = 'Alkwelt';
$zeileOrt['anzeige'] = 'Alkwelt';
assert(avesmapsGaretienMappeTyp('Dorf')['ziel'] === 'location', 'die Vorbedingung des Falls: Dorf ist ein Ort-Ziel');
$ortMitQuelle = avesmapsGaretienErgaenzungsEintraege(
    $zeileOrt, avesmapsGaretienMappeTyp('Dorf'), $urteilOrtMitQuelle, ['location|o-1' => true]
);
$lueckeOrt = array_values(array_filter($ortMitQuelle,
    static fn($e) => $e['after']['anlass'] === 'ergaenzung' && in_array('quelle', $e['after']['felder'], true)));
assert($lueckeOrt === [], 'ein Ort, dessen Quelle unter seiner EIGENEN public_id liegt, bleibt unveraendert -- wie vor der Reparatur');
$pruefungen += 2;

// -- Der SCHLUESSEL je Item muss eindeutig sein, sonst treffen sich zwei Abschnitte in
// sync_decision und eine Ablehnung gilt fuer beide.
$schluessel = array_map(static fn($e) => $e['entity_key'], $d);
assert(count(array_unique($schluessel)) === count($schluessel),
    'zwei Items mit demselben entity_key teilen sich eine Entscheidung');
$pruefungen++;

// -- 🔴 RULING P6: der Schluessel entsteht in EINER Funktion, und `avesmapsGaretienPlanEintrag`
// benutzt sie nur -- eine spaetere Aufgabe (die Arbeitsliste des Fensters) baut denselben
// Schluessel aus einer Staging-Zeile nach und muss auf DASSELBE Ergebnis kommen.
$plan = avesmapsGaretienPlanEintrag($zeileD, avesmapsGaretienMappeTyp('Bach'), $urteilD);
assert($plan['entity_key'] === avesmapsGaretienObjektSchluesselAusZeile($zeileD),
    'der Schluessel aus avesmapsGaretienPlanEintrag muss verhaltensgleich zur ausgelagerten Formel sein');
$pruefungen++;

echo "OK: {$pruefungen} Pruefungen\n";
