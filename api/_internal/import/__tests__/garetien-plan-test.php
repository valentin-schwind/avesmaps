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

// --- 💣 GEZAEHLT, NICHT NUR "GROESSER NULL". Der Pruefstand hat fuenf Quellzeilen, und
// GENAU ZWEI davon gehoeren in den Plan: der Gardel und der Muehlsee sind neu. Die Alke deckt
// sich mit einem Bestandsfluss, "Nachbarprovinzen" ist ein Sammelartikel, die Insel gehoert zu
// Stufe 3. 🪤 Mit "> 0" ueberlebten drei Mutationen: uebersprungene Zeilen doch aufnehmen,
// deckende doch aufnehmen, und den Ueberspringen-Riegel ganz entfernen -- jedes Mal wurden es
// MEHR Eintraege, und mehr ist immer noch groesser als null.
assert($anzahl === 3, 'genau drei Vorschlaege aus sechs Quellzeilen, ' . $anzahl . ' gebaut');
$namen = $pdo->query('SELECT label FROM sync_plan_item ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
assert($namen === ['Gardel (Fluss)', 'Mühlsee (See)', 'Seitenarm der Alke (Bach) · liegt auf "Alke"'],
    'die richtigen drei: ' . implode(' | ', $namen));
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

echo "OK: {$pruefungen} Pruefungen\n";
