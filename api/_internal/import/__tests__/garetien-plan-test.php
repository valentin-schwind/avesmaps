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
// Geometrie-Angebot (genau EIN Abschnitt getroffen) -- macht fuenf. Seit Meldung B (30.08.2026)
// bringt JEDE deckt_sich-Zeile zusaetzlich das Zusatz-Item ("trotzdem neu anlegen") mit -- macht
// sechs. Der Kontinent hat kein Gegenstueck und faellt weiter heraus.
// 🔴 SIEBEN SEIT 30.08.2026, NICHT SECHS: "Nachbarprovinzen" war ein Sammelartikel und wurde
// uebersprungen -- der Riegel ist auf Owner-Entscheid gefallen („warum sollte ich sagen nicht
// importieren können nur weil sie außerhalb von irgendwas sind?"), die Zeile bringt jetzt ihren
// eigenen Vorschlag mit. Die Zahl ist damit der Zeuge dafuer, dass sie wirklich durchkommt.
// 🪤 Mit "> 0" ueberlebten drei Mutationen: uebersprungene Zeilen doch aufnehmen, deckende ganz
// verwerfen statt ueber den vierten Ausgang zu fuehren, und den Ueberspringen-Riegel ganz
// entfernen -- jedes Mal wurden es MEHR Eintraege, und mehr ist immer noch groesser als null.
//
// 🔴 SECHS SEIT 31.08.2026, NICHT SIEBEN (Owner: „es gibt kein ersetzen ... aber Quelle und Artikel
// ergänzen soll erlaubt sein"). Die Alke deckt sich und brachte bis dahin DREI Items mit:
// Quellen-Luecke, Geometrie-Angebot und Zusatz. Das GEOMETRIE-Angebot ueberschreibt einen
// gezeichneten Verlauf und entsteht nicht mehr -- die Zahl faellt um genau eins.
// ⚠️ Die Quellen-Luecke BLEIBT: sie ist additiv, ueberschreibt nichts und traegt die Rechtsfolge.
assert($anzahl === 6, 'genau sechs Vorschlaege aus den Quellzeilen, ' . $anzahl . ' gebaut');
$namen = $pdo->query('SELECT label FROM sync_plan_item ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
// 🔴 SEIT 31.08.2026 OHNE DIE ZWEI ALKE-ERSETZUNGEN („Alke → Alke · Quelle" und
// „… · Geometrie"). Beide schrieben an unserem Bestandsfluss; der Owner hat das Ersetzen ganz
// abgeschaltet. ⚠️ Die Alke ist damit NICHT verschwunden -- sie steht weiter da, aber nur noch
// mit dem Ausgang „trotzdem neu anlegen". Das ist die ganze Aussage von „neu oder nix".
assert($namen === ['Alke → Alke · Quelle',
    'Alke (Bach) · trotz Nähe zu "Alke" zusätzlich anlegen', 'Gardel (Fluss)', 'Mühlsee (See)',
    'Llavari (Fluss)', 'Seitenarm der Alke (Bach) · liegt auf "Alke"'],
    'die richtigen sechs: ' . implode(' | ', $namen));
// 💣 UND KEIN EINZIGES ITEM SCHREIBT MEHR AN EINEM BESTEHENDEN OBJEKT. Das ist die
// eigentliche Zusicherung -- die Namensliste darueber ist nur ihr Abbild, und ein neuer Anlass
// koennte sich daran vorbeischmuggeln.
// 💣 UND JEDER VORSCHLAG, DER AUF EIN BESTEHENDES OBJEKT ZEIGT, SCHREIBT NUR DIE QUELLE. Das ist
// die eigentliche Zusicherung -- die Namensliste darueber ist nur ihr Abbild, und ein neuer Anlass
// koennte sich daran vorbeischmuggeln.
$aufBestand = $pdo->query(
    "SELECT after_json FROM sync_plan_item WHERE entity_public_id IS NOT NULL"
)->fetchAll(PDO::FETCH_COLUMN);
foreach ($aufBestand as $rumpf) {
    $felder = (array) (json_decode((string) $rumpf, true)['felder'] ?? []);
    assert($felder === ['quelle'],
        '🔴 ein Vorschlag auf ein bestehendes Objekt darf NUR die Quelle schreiben: '
        . implode(', ', $felder));
}
assert(count($aufBestand) === 1, 'genau einer zeigt auf Bestand (die Quellen-Luecke der Alke): '
    . count($aufBestand));
$pruefungen += 4;

// --- 🔴 UND DIE DREI ERSETZUNGS-ANLAESSE ENTSTEHEN GAR NICHT MEHR (Owner 31.08.2026).
// Hier stand bis dahin die Gegenprobe, dass ein Geometrie-Item wenigstens nicht VORANGEHAKT in der
// Datenbank landet. Die Frage stellt sich nicht mehr: es entsteht keines.
$ersetzendeAnlaesse = [];
foreach ($pdo->query('SELECT after_json FROM sync_plan_item') as $zeile) {
    $nachDb = json_decode((string) $zeile['after_json'], true);
    if (in_array($nachDb['anlass'] ?? null, ['umbenennung', 'geometrie'], true)) {
        $ersetzendeAnlaesse[] = (string) $nachDb['anlass'];
    }
}
assert($ersetzendeAnlaesse === [],
    'kein Umbenennungs- oder Geometrie-Item mehr: ' . implode(', ', $ersetzendeAnlaesse));
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
    // Und die Beschriftung nennt das Briefspiel, waehrend die Adresse auf den WIRT zeigt.
    assert(in_array($nach['quelle']['label'] ?? null, ['Briefspiel (Garetien)', 'Briefspiel (Kosch)'], true),
        'die Beschriftung nennt das Briefspiel: ' . var_export($nach['quelle']['label'] ?? null, true));
    // 🔴 MELDUNG (30.08.2026, Owner: „ich glaube https://www.garetien.de reicht"): die ZITIERTE
    // Quelle ist der Wirt, NICHT VolkoVs Export-Arbeitsseite (die trug bis dahin ein `title=` und
    // landete unveraendert in `sources.url` -- ein Leser der Infobox waere auf einer internen
    // Arbeitsseite gelandet statt beim zitierten Werk).
    assert(!str_contains((string) ($nach['quelle']['url'] ?? ''), 'title='),
        'die Quellenadresse zeigt NICHT mehr auf die Export-Arbeitsseite: ' . ($nach['quelle']['url'] ?? ''));
    assert(
        in_array($nach['quelle']['url'] ?? null, ['https://www.garetien.de', 'https://www.koschwiki.de'], true),
        'sondern auf den Wirt allein: ' . var_export($nach['quelle']['url'] ?? null, true)
    );
    assert(($nach['quelle']['origin'] ?? null) === 'garetien', 'origin fehlt bei ' . $zeile['label']);
    // Die Export-Arbeitsseite geht dabei nicht verloren -- sie bleibt separat erhalten, fuer den
    // Editor, der beim Review nachsehen will, VON WELCHER Seite eine Zeile stammt
    // (garetien-liste.php liest sie als `wiki_url` fuer den Artikel-Link im Review-Fenster).
    assert(str_contains((string) ($nach['seite_url'] ?? ''), 'title='),
        'die Export-Arbeitsseite bleibt als seite_url erhalten: ' . ($nach['seite_url'] ?? ''));
    assert(str_contains((string) ($nach['seite_url'] ?? ''), '.de'), 'auch sie zeigt auf ein Wiki');
}
$pruefungen += 6;

// --- 🔴 MELDUNG (30.08.2026): FUER EIN KOSCH-OBJEKT koschwiki.de, NICHT garetien.de. Die Fixture
// oben hat keine gueltige Kosch-Zeile (ihre einzige, 'Kontinent', ist 'uebersprungen' und erreicht
// nie ein after.quelle) -- reine Funktionspruefung, unabhaengig vom Sync-Lauf.
assert(avesmapsGaretienWirtAusZeile(['wiki' => 'ggp']) === 'https://www.garetien.de',
    'ggp zeigt auf garetien.de');
assert(avesmapsGaretienWirtAusZeile(['wiki' => 'kosch']) === 'https://www.koschwiki.de',
    'kosch zeigt auf koschwiki.de');
// ⚠️ MIT `ebene` -- seit dem 31.08.2026 heisst die Export-Arbeitsseite nach der EBENE, nicht
// nach dem Artikel (die alte Form `…/Avesmaps_Kosch:Bodrin` gibt es auf koschwiki.de so wenig
// wie ihr garetien.de-Gegenstueck, live gemessen HTTP 404).
$koschZeile = ['wiki' => 'kosch', 'ebene' => 'Gewaesser', 'namensraum' => 'Kosch', 'artikel' => 'Bodrin'];
assert(avesmapsGaretienSeitenUrlAusZeile($koschZeile) !== avesmapsGaretienWirtAusZeile($koschZeile),
    'die Export-Arbeitsseite bleibt von der zitierten Quelle unterschieden');
assert(str_starts_with(avesmapsGaretienSeitenUrlAusZeile($koschZeile), AVESMAPS_GARETIEN_BASIS_KOSCH),
    'und die Export-Arbeitsseite eines Kosch-Objekts nutzt die Kosch-Basis');
$pruefungen += 4;

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
// 🔴 SEIT 01.09.2026 TRAEGT DER SCHLUESSEL DIE ADRESSE (Owner: eine Frage statt zwei
// Mechanismen). Vorher lautete er `typ|id` und beantwortete nur „haengt IRGENDEINE garetien-Quelle
// dran?" -- damit bekam ein Objekt, das nur die Sammelquelle trug, seine Artikelquelle NIE
// angeboten, und ein zweiter Mechanismus (der Nachzug) musste das heilen.
// ⚠️ Die Abfrage JOINt seither `sources`; die Fixture braucht deshalb echte Katalogzeilen.
$pdo->exec("INSERT INTO sources (id, url, url_hash, label, source_type, is_official)
            VALUES (1, 'https://www.garetien.de', 'h1', 'Briefspiel (Garetien)', 'briefspiel', 0)");
$pdo->exec("INSERT INTO sources (id, url, url_hash, label, source_type, is_official)
            VALUES (2, 'https://www.garetien.de/index.php/Garetien:Unterdrueckt', 'h2', 'x', 'briefspiel', 0)");
$pdo->exec("INSERT INTO sources (id, url, url_hash, label, source_type, is_official)
            VALUES (3, 'https://www.beispiel.de/fremd', 'h3', 'Fremd', 'sonstiges', 0)");
$pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin)
            VALUES ('path', 'quellen-genehmigt', 1, 'approved', 'garetien')");
$pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin)
            VALUES ('path', 'quellen-unterdrueckt', 2, 'suppressed', 'garetien')");
// Eine fremde Herkunft (nicht 'garetien') darf nicht mitgezaehlt werden.
$pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin)
            VALUES ('path', 'quellen-fremd', 3, 'approved', 'manual')");
$bestand = avesmapsGaretienQuellenBestand($pdo);
assert(isset($bestand[avesmapsGaretienQuellenSchluessel('path', 'quellen-genehmigt', 'https://www.garetien.de')]),
    'eine genehmigte Garetien-Quelle muss im Bestand landen');
// 💣 UND SIE STEHT NUR UNTER IHRER EIGENEN ADRESSE. Das ist der ganze Punkt: dasselbe Objekt
// gilt fuer eine ANDERE Adresse weiterhin als unversorgt -- genau so bekommt ein vor dem
// 31.08.2026 importiertes Objekt seine Artikelquelle noch angeboten.
assert(!isset($bestand[avesmapsGaretienQuellenSchluessel(
    'path', 'quellen-genehmigt', 'https://www.garetien.de/index.php/Garetien:Irgendwas'
)]), '🔴 fuer eine andere Adresse gilt dasselbe Objekt als unversorgt');
$pruefungen++;
assert(isset($bestand[avesmapsGaretienQuellenSchluessel(
    'path', 'quellen-unterdrueckt', 'https://www.garetien.de/index.php/Garetien:Unterdrueckt'
)]),
    'eine UNTERDRUECKTE Quelle zaehlt trotzdem -- Grabstein, kein Fehlen');
assert(!isset($bestand[avesmapsGaretienQuellenSchluessel(
    'path', 'quellen-fremd', 'https://www.beispiel.de/fremd'
)]), 'eine fremde Herkunft darf nicht mitgezaehlt werden');
$pruefungen += 3;

// =================================================================================================
// 🔴 KEIN ERSETZEN MEHR -- avesmapsGaretienErgaenzungsEintraege liefert NUR NOCH DAS ZUSATZ-ITEM
// =================================================================================================
// Owner 31.08.2026, woertlich: „ich will dass du alle 'ersetzungsfunktionen' des importers
// augenblicklich deaktivierst. es gibt kein ersetzen. es gibt neu oder nix - kein verändern, kein
// ersetzen."
//
// Hier standen bis dahin die Faelle A/B/C/D dieser Funktion -- Luecken-Item, Umbenennung,
// Geometrie-Angebot je Abschnitt, der Bestandscheck der Flaechen-Label-id. Alle vier bauten
// Vorschlaege, die an einem BESTEHENDEN Objekt schreiben; sie entstehen nicht mehr. Wer die
// Einzelfaelle je wieder braucht, findet sie in der Geschichte dieser Datei (Stand 30.08.2026).
//
// 🔴 GEPRUEFT WIRD JETZT DAS GEGENTEIL, und zwar ueber DIESELBEN vier Konstellationen: egal wie
// die Lage aussieht, es kommt genau EIN Eintrag heraus, und der legt etwas NEUES an.
// ⚠️ Das ist die Zusicherung, die den Schalter festnagelt: wer
// AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT zurueckdreht, macht diesen Abschnitt rot und trifft damit
// eine bewusste Entscheidung, statt eine stille.

$ersetzungsProbe = static function (array $zeile, array $ziel, array $urteil, array $quellen, string $fall) use (&$pruefungen): void {
    $eintraege = avesmapsGaretienErgaenzungsEintraege($zeile, $ziel, $urteil, $quellen);
    // 🔴 KEIN Eintrag darf mehr etwas ANDERES als die Quelle an ein bestehendes Objekt schreiben.
    // Gemessen an den FELDERN, nicht am Anlass: der Anlass ist eine Beschriftung, die Felder sind
    // die Anweisung -- genau dort stand bis zum 31.08.2026 zusaetzlich `name`.
    foreach ($eintraege as $eintrag) {
        if ($eintrag['entity_public_id'] === null) {
            continue;   // ein Neuzugang schreibt an gar nichts Bestehendem
        }
        $felder = (array) ($eintrag['after']['felder'] ?? []);
        assert($felder === ['quelle'],
            $fall . ': ein Eintrag auf Bestand darf NUR die Quelle schreiben -- ' . implode(', ', $felder));
        $pruefungen++;
    }
    // 🔴 UND DAS ZUSATZ-ITEM IST IMMER DABEI: eine Zeile mit Treffer bleibt als EIGENES Objekt
    // anlegbar. Ohne es waere sie ueberhaupt nicht mehr importierbar.
    $zusatz = array_values(array_filter($eintraege,
        static fn(array $e): bool => ($e['after']['anlass'] ?? '') === 'zusatz'));
    assert(count($zusatz) === 1, $fall . ': genau EIN Zusatz-Item');
    assert($zusatz[0]['change_type'] === 'new', $fall . ': es legt NEU an');
    assert($zusatz[0]['entity_public_id'] === null, $fall . ': und zeigt auf NICHTS Vorhandenes');
    // 🔴 Owner: „darf niemals vorangehakt sein" -- eine Dublette ist die begruendete Ausnahme.
    assert($zusatz[0]['vorwahl_aus'] === true, $fall . ': und startet ungehakt');
    $pruefungen += 4;
};

// -- Fall A: ein NAMENLOSER Abschnitt (bisher: Luecken-Item mit Name UND Quelle, vorangehakt).
$urteilA = ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'w-1',
    'treffer_name' => '', 'grund' => 'Geometrie deckt sich', 'abstand' => 0.4,
    'abschnitte' => [['public_id' => 'w-1', 'name' => '', 'punkte' => 12]]];
$zeileA = ['wiki' => 'ggp', 'ebene' => 'Gewaesser', 'zeile_nr' => 1, 'typ' => 'Bach',
    'namensraum' => 'Garetien', 'artikel' => 'Aalgrund', 'anzeige' => 'Aalgrund',
    'geo_art' => 'koordinaten', 'geo' => '70000 30000, 70100 30100'];
$ersetzungsProbe($zeileA, avesmapsGaretienMappeTyp('Bach'), $urteilA, [], 'namenloser Abschnitt');

// -- Fall B: unser Abschnitt traegt einen ANDEREN Namen (bisher: Umbenennungs-Item).
// 💣 GENAU DIESER FALL hat am 31.08.2026 unser Dorf „Valpolust" in „Gryffenwacht" umbenannt.
$urteilB = $urteilA;
$urteilB['treffer_name'] = 'Valpolust';
$urteilB['abschnitte'] = [['public_id' => 'w-1', 'name' => 'Valpolust', 'punkte' => 12]];
$ersetzungsProbe($zeileA, avesmapsGaretienMappeTyp('Bach'), $urteilB, [], 'anderer Name');

// -- Fall C: GLEICHER Name, Quelle liegt schon (bisher: nur Geometrie-Angebot).
$urteilC = $urteilA;
$urteilC['treffer_name'] = 'Aalgrund';
$urteilC['abschnitte'] = [['public_id' => 'w-1', 'name' => 'Aalgrund', 'punkte' => 12]];
$ersetzungsProbe($zeileA, avesmapsGaretienMappeTyp('Bach'), $urteilC,
    ['path|w-1' => true], 'gleicher Name, Quelle liegt');

// -- Fall D: MEHRERE getroffene Abschnitte (bisher: ein Angebot je legitimem Abschnitt).
$urteilD = $urteilA;
$urteilD['treffer_name'] = 'Aalgrund';
$urteilD['abschnitte'] = [
    ['public_id' => 'w-1', 'name' => 'Aalgrund', 'punkte' => 12],
    ['public_id' => 'w-2', 'name' => 'Aalgrund', 'punkte' => 9],
    ['public_id' => 'w-3', 'name' => '', 'punkte' => 4],
];
$ersetzungsProbe($zeileA, avesmapsGaretienMappeTyp('Bach'), $urteilD, [], 'drei Abschnitte');

// -- Und eine FLAECHE: sie ging ueber einen eigenen Zweig (Label-id statt Regions-id).
$urteilSee = ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'r-9',
    'treffer_name' => 'Mühlsee', 'grund' => 'Geometrie deckt sich', 'abstand' => 0.2,
    'abschnitte' => [['public_id' => 'r-9', 'name' => 'Mühlsee', 'punkte' => 8,
        'label_public_id' => 'lbl-9']]];
$zeileSee = ['wiki' => 'ggp', 'ebene' => 'Gewaesser', 'zeile_nr' => 2, 'typ' => 'See',
    'namensraum' => 'Garetien', 'artikel' => 'Mühlsee', 'anzeige' => 'Mühlsee',
    'geo_art' => 'koordinaten', 'geo' => '70000 30000, 70100 30100, 70000 30100'];
$ersetzungsProbe($zeileSee, avesmapsGaretienMappeTyp('See'), $urteilSee, [], 'Landschaftsflaeche');

// -- ⚠️ OHNE getroffene Abschnitte gibt es gar nichts, wie bisher: der vierte Ausgang
// existiert nur, wenn der Abgleich wirklich etwas gefunden hat.
$urteilLeer = $urteilA;
$urteilLeer['abschnitte'] = [];
assert(avesmapsGaretienErgaenzungsEintraege($zeileA, avesmapsGaretienMappeTyp('Bach'), $urteilLeer, []) === [],
    'ohne getroffene Abschnitte entsteht auch kein Zusatz-Item');
$pruefungen++;

// 💣 Fuer die Zeilen darunter, die noch mit $d rechnen: die letzte Probe liefert das
// Zusatz-Item, und dessen Schluessel ist der des Objekts.
$d = avesmapsGaretienErgaenzungsEintraege($zeileA, avesmapsGaretienMappeTyp('Bach'), $urteilD, []);
$zeileD = $zeileA;
$urteilD_alt = $urteilD;


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


// --- 🔴 DAS BACH-HAEKCHEN REIST IM PLAN MIT (Owner 30.08.2026). Ein Bach ist bei uns ein
// `Flussweg` mit `is_bach`; faellt das Feld hier heraus, legt JEDER echte Lauf Baeche als
// befahrbare Fluesse an -- und ein Ablauftest, der seinen `after`-Satz von Hand baut, saehe das
// nie. Genau diese Luecke hat eine Mutationsprobe am 30.08.2026 aufgedeckt.
$bachZeile = $pdo->query("SELECT after_json FROM sync_plan_item WHERE label LIKE '%Seitenarm der Alke%' ORDER BY id DESC LIMIT 1")->fetchColumn();
assert($bachZeile !== false && $bachZeile !== null, 'die Bach-Zeile der Fixture muss im Plan stehen');
$bachAfter = json_decode((string) $bachZeile, true);
assert(($bachAfter['subtyp'] ?? '') === 'Flussweg',
    'ein Bach wird als Flussweg geplant, nicht als eigene Wegart: ' . json_encode($bachAfter, JSON_UNESCAPED_UNICODE));
assert(($bachAfter['is_bach'] ?? null) === true,
    'und der Plan traegt das Haekchen: ' . json_encode($bachAfter, JSON_UNESCAPED_UNICODE));
$pruefungen += 3;

// ⚠️ GEGENPROBE: eine Zeile, die KEIN Bach ist, traegt das Feld gar nicht -- die Abwesenheit ist
// die Aussage. Ohne sie belegt die Zeile darueber nur, dass irgendwo ein `true` steht.
// 🪤 Gesucht wird ueber den TYP, nicht ueber das Label: die Bach-Zeile der Fixture ist eine
// Ergaenzung an der „Alke" und traegt deren Namen -- eine Label-Suche nach „Seitenarm" haette
// ausgerechnet sie als Gegenbeispiel gewaehlt (beim ersten Bau genau so passiert).
$andere = $pdo->query("SELECT after_json FROM sync_plan_item WHERE after_json LIKE '%\"ziel\":\"path\"%' AND after_json NOT LIKE '%\"typ\":\"Bach\"%' ORDER BY id LIMIT 1")->fetchColumn();
assert($andere !== false && $andere !== null,
    'die Fixture muss mindestens einen Weg enthalten, der KEIN Bach ist -- sonst misst diese Gegenprobe nichts');
$andereAfter = json_decode((string) $andere, true);
assert(!array_key_exists('is_bach', $andereAfter),
    'ein anderer Weg traegt GAR KEIN is_bach: ' . json_encode($andereAfter, JSON_UNESCAPED_UNICODE));
$pruefungen += 2;


// =================================================================================================
// 🔴 „HAT SCHON EINE QUELLE" IST EINE FRAGE JE ADRESSE, NICHT JE OBJEKT
// =================================================================================================
// Owner 01.09.2026, auf die Frage „was ist wenn ein objekt … Quelle + Artikel bereits hat?": „ja
// mach beides" -- eine Frage statt zwei Mechanismen.
//
// 💣 Bis dahin lautete sie „haengt IRGENDEINE garetien-Quelle an diesem Objekt?". Ein Objekt,
// das vor dem 31.08.2026 importiert wurde und nur die Sammelquelle traegt, bekam seine
// ARTIKELQUELLE damit nie angeboten -- geheilt hat das ein zweiter Mechanismus (der Nachzug), und
// eine Frage mit zwei Antwortgebern ist genau die Divergenz, die dieses Projekt schon mehrfach
// bezahlt hat. Beide gehen jetzt durch avesmapsGaretienQuellenBestand.
$urteilQ = ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'w-1',
    'treffer_name' => 'Alke', 'grund' => 'Test', 'abstand' => 0.1,
    'abschnitte' => [['public_id' => 'w-1', 'name' => 'Alke', 'punkte' => 12]]];
$zeileQ = ['wiki' => 'ggp', 'ebene' => 'Gewaesser', 'zeile_nr' => 1, 'typ' => 'Bach',
    'namensraum' => 'Garetien', 'artikel' => 'Alke', 'anzeige' => 'Alke',
    'geo_art' => 'koordinaten', 'geo' => '70000 30000, 70100 30100'];
$anlaesseQ = static fn(array $quellen): array => array_map(
    static fn(array $e): string => (string) ($e['after']['anlass'] ?? ''),
    avesmapsGaretienErgaenzungsEintraege($zeileQ, avesmapsGaretienMappeTyp('Bach'), $urteilQ, $quellen)
);

$adressenQ = avesmapsGaretienQuellenAdressenAus('https://www.garetien.de',
    avesmapsGaretienArtikelQuelleAus('ggp', 'Garetien:Alke'));
// 🔴 SEIT 01.09.2026 IST ES EINE ADRESSE, NICHT ZWEI (Owner: „nur noch den artikel als
// quelle"). Hier stand `count(...) === 2`, und genau die zweite Zeile hat der Owner an „Stadt
// Praioslob" als Dublette gesehen.
assert($adressenQ === ['https://www.garetien.de/index.php/Garetien:Alke'],
    '🔴 mit Artikel haengt NUR der Artikel: ' . implode(', ', $adressenQ));
$pruefungen++;

$nurWirtQ = ['path|w-1|https://www.garetien.de' => true];
$beideQ = [];
foreach ($adressenQ as $u) {
    $beideQ[avesmapsGaretienQuellenSchluessel('path', 'w-1', $u)] = true;
}

assert(in_array('ergaenzung', $anlaesseQ([]), true), 'ohne Quelle wird eine angeboten');
// 🔴 DAS IST DIE REPARATUR VOM 01.09.2026: ein Objekt, das vor diesem Tag importiert wurde
// und nur die SAMMELQUELLE traegt, bekommt seinen Artikel noch angeboten. Vorher war „hat schon
// eine Quelle" eine Ja/Nein-Frage ueber alle garetien-Quellen zusammen, und ein zweiter
// Mechanismus (der Nachzug) musste das heilen.
assert(in_array('ergaenzung', $anlaesseQ($nurWirtQ), true),
    '🔴 haengt nur die Sammelquelle, fehlt der Artikel -- und das wird angeboten: '
    . implode(', ', $anlaesseQ($nurWirtQ)));
// ⚠️ Haengt der Artikel, gibt es nichts mehr zu ergaenzen -- sonst waere die Zeile darueber
// nur „bietet immer etwas an".
assert(!in_array('ergaenzung', $anlaesseQ($beideQ), true),
    'haengt der Artikel, ist nichts mehr offen: ' . implode(', ', $anlaesseQ($beideQ)));
$pruefungen += 3;

// 💣 UND DIE LISTE MUSS ZEICHENGLEICH DAS SEIN, WAS DER SCHREIBER ANHAENGT. Beim Bau nannte
// sie den Wirt IMMER -- ein Item ohne `after.quelle` bekommt ihn aber nie, und der Nachzug hielt
// es fuer ewig unvollstaendig und schrieb bei JEDEM Lauf erneut. Gefunden hat das der
// Ablauftest der Uebernahme, nicht diese Zeile; sie haelt es fest.
assert(avesmapsGaretienQuellenAdressenAus('', avesmapsGaretienArtikelQuelleAus('ggp', 'Garetien:Alke'))
    === ['https://www.garetien.de/index.php/Garetien:Alke'],
    'ohne Wirt-Adresse steht sie nicht in der Liste');
assert(avesmapsGaretienQuellenAdressenAus('https://www.garetien.de', null)
    === ['https://www.garetien.de'], 'und ohne Artikel nur der Wirt');
assert(avesmapsGaretienQuellenAdressenAus('', null) === [], 'und ohne beides gar nichts');
$pruefungen += 3;

// =================================================================================================
// 🔴 DER ANZEIGENAME GEHOERT IN DEN SCHLUESSEL -- SONST VERSCHLUCKT EIN SAMMELARTIKEL SEINE ZEILEN
// =================================================================================================
// Owner 01.09.2026: „Kahler Schirch fehlt … ist der nicht in den daten?" Er WAR in den Daten:
//   Gebirge:Garetien:Hügel und Berge in Hartsteen!Kahler Schirch;5!14;; 65258 -25547, …
// Nur teilte er sich seinen Sammelartikel mit „Grafenhaupt", und der Schluessel endete beim
// ARTIKEL -- beide fielen zu EINEM Listeneintrag zusammen, gezeigt wurde „Grafenhaupt".
//
// Live gemessen ueber alle 18 Ebenen: 8348 Zeilen, 8213 Objekte, 25 Schluessel mit mehreren
// Zeilen, 135 unerreichbare Namen (1,6 %). In KEINEM Fall trug ein Schluessel zwei GLEICHE Namen
// -- der Name legt also nichts zusammen, was zusammengehoert, er trennt nur, was getrennt gehoert.
$zeileA = ['wiki' => 'ggp', 'ebene' => 'Berge', 'zeile_nr' => 41, 'typ' => 'Gebirge',
    'namensraum' => 'Garetien', 'artikel' => 'Hügel und Berge in Hartsteen',
    'anzeige' => 'Kahler Schirch'];
$zeileB = $zeileA;
$zeileB['anzeige'] = 'Grafenhaupt';
$zeileB['zeile_nr'] = 42;

$kA = avesmapsGaretienObjektSchluesselAusZeile($zeileA);
$kB = avesmapsGaretienObjektSchluesselAusZeile($zeileB);
assert($kA !== $kB,
    '🔴 zwei Namen unter EINEM Sammelartikel sind zwei Objekte: ' . $kA . ' / ' . $kB);
assert($kA === 'ggp:Berge:Gebirge:Garetien:Hügel und Berge in Hartsteen!Kahler Schirch',
    'und der Schluessel ist die Schreibweise des Exports selbst: ' . $kA);
$pruefungen += 2;

// 💣 UND DER ARTIKELNAME MUSS WEITER SAUBER HERAUSKOMMEN. Ohne den Schnitt am „!" entstuende
// aus dem Schluessel eine Quellenadresse auf einen Artikel, den es nicht gibt -- ein 404 in der
// Infobox, und zwar einer, der wie eine gepflegte Quelle aussieht.
assert(avesmapsGaretienArtikelNameAusSchluessel($kA) === 'Garetien:Hügel und Berge in Hartsteen',
    '💣 der Artikel bleibt der Artikel: ' . avesmapsGaretienArtikelNameAusSchluessel($kA));
assert(avesmapsGaretienAnzeigeNameAusSchluessel($kA) === 'Kahler Schirch',
    'und der Anzeigename ist lesbar: ' . avesmapsGaretienAnzeigeNameAusSchluessel($kA));
// ⚠️ Auch mit Item-Suffix, und auch bei einer Zeile OHNE Artikel (`#<nr>`).
assert(avesmapsGaretienArtikelNameAusSchluessel($kA . '|ergaenzung|w-1') === 'Garetien:Hügel und Berge in Hartsteen',
    'der Suffix stoert nicht');
$ohne = avesmapsGaretienObjektSchluesselAusZeile(
    ['wiki' => 'ggp', 'ebene' => 'Wege', 'zeile_nr' => 417, 'typ' => 'Pfad',
     'namensraum' => '', 'artikel' => '', 'anzeige' => 'Namenloser Pfad']);
assert(avesmapsGaretienArtikelNameAusSchluessel($ohne) === '',
    'eine Zeile ohne Artikel liefert weiter KEINEN Artikelnamen: ' . $ohne);
$pruefungen += 4;

// =================================================================================================
// 🔴 DIE WANDERUNG DER ALTSCHLUESSEL
// =================================================================================================
// 💣 `entity_key` IST die Identitaet in `sync_decision`. Ohne Wanderung staende jede
// Uebernahme schlagartig wieder auf „Offen" und boete ein bereits angelegtes Objekt ein zweites
// Mal an -- die Dublette, gegen die dieser Importer seit dem 31.08.2026 gebaut ist.
$pdoW = avesmapsGaretienPlanTestPdo();
$altAlke = 'ggp:Gewaesser:Bach:Garetien:Alke';
$pdoW->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, applied_at, applied_by)"
    . " VALUES ('garetien', ?, 'new', '2026-08-31 10:00:00', 7)")->execute([$altAlke]);
// Ein Altschluessel, unter dem MEHRERE Namen lagen -- der darf NICHT wandern.
$altSammel = 'ggp:Gewaesser:Fluss:Nachbarprovinzen';
$pdoW->prepare("INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum,"
    . " artikel, anzeige, lodmin, lodmax, extra, geo_art, geo, roh)"
    . " VALUES (1,'ggp','Gewaesser',44,'Fluss','','Nachbarprovinzen','Zweitname','','','','koordinaten','5 6, 7 8','')")
    ->execute();
$pdoW->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, declined_at, declined_by)"
    . " VALUES ('garetien', ?, 'new', '2026-08-31 10:00:00', 7)")->execute([$altSammel]);

$gewandert = avesmapsGaretienSchluesselWanderung($pdoW, 1);
$neuAlke = (string) $pdoW->query(
    "SELECT entity_key FROM sync_decision WHERE applied_at IS NOT NULL"
)->fetchColumn();
assert($neuAlke === $altAlke . '!Alke',
    '🔴 ein eindeutiger Altschluessel wandert samt seinem Vermerk: ' . $neuAlke);
assert($gewandert >= 1, 'und die Wanderung sagt, dass sie etwas getan hat: ' . $gewandert);
$pruefungen += 2;

$sammelDanach = (string) $pdoW->query(
    "SELECT entity_key FROM sync_decision WHERE declined_at IS NOT NULL"
)->fetchColumn();
assert($sammelDanach === $altSammel,
    '⚠️ ein MEHRDEUTIGER Altschluessel bleibt liegen -- welchem der Namen der Vermerk galt, '
    . 'ist nicht entscheidbar, und Raten waere hier ein falscher Grabstein: ' . $sammelDanach);
$pruefungen++;

// 🔴 UND SIE IST IDEMPOTENT: ein zweiter Lauf fasst nichts mehr an.
$nochmal = avesmapsGaretienSchluesselWanderung($pdoW, 1);
assert($nochmal === 0, '🔴 der zweite Lauf wandert nichts mehr: ' . $nochmal);
assert((string) $pdoW->query("SELECT entity_key FROM sync_decision WHERE applied_at IS NOT NULL")->fetchColumn()
    === $altAlke . '!Alke', 'und laesst den gewanderten Schluessel in Ruhe');
$pruefungen += 2;

// =================================================================================================
// 🔴 NUR NOCH DER ARTIKEL ALS QUELLE
// =================================================================================================
// Owner 01.09.2026 zum Bild von „Stadt Praioslob", das beide nebeneinander zeigte: „jetzt hast du
// genau gemacht was ich befuerchtet hatte und 2x die quelle hinzufuegt" → „nur noch den artikel
// als quelle". Gleiche Domain, gleiche Namensnennung, gleiche Lizenz -- der Artikel sagt dasselbe
// genauer, und zwei Zeilen, von denen die eine in der anderen steckt, liest ein Besucher als
// Dublette.
$artikelQ = avesmapsGaretienArtikelQuelleAus('ggp', 'Garetien:Stadt Praioslob');
assert(avesmapsGaretienQuellenAdressenAus('https://www.garetien.de', $artikelQ)
    === ['https://www.garetien.de/index.php/Garetien:Stadt_Praioslob'],
    '🔴 mit Artikel haengt NUR der Artikel: '
    . json_encode(avesmapsGaretienQuellenAdressenAus('https://www.garetien.de', $artikelQ)));
// ⚠️ Ohne Artikel bleibt die Sammelquelle die einzige Angabe, die es gibt -- knapp die
// Haelfte der Zeilen nennt keinen (4311 von 8348 tragen einen, live gemessen).
assert(avesmapsGaretienQuellenAdressenAus('https://www.garetien.de', null)
    === ['https://www.garetien.de'], 'ohne Artikel traegt die Sammelquelle: ');
assert(avesmapsGaretienQuellenAdressenAus('', null) === [], 'und ohne beides gar nichts');
$pruefungen += 3;

// 💣 UND DER PLANBAU RUFT SIE WIRKLICH. Die Zusicherungen oben fahren die Wanderung DIREKT
// an -- eine Mutationsprobe am 01.09.2026 hat den Aufruf aus avesmapsGaretienBaueSyncPlan entfernt
// und ist unbemerkt durchgelaufen. Ein Bauteil, das niemand ruft, ist kein Bauteil; genau diese
// Luecke hat dieses Projekt schon mehrfach bezahlt.
$pdoV = avesmapsGaretienPlanTestPdo();
$pdoV->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, applied_at, applied_by)"
    . " VALUES ('garetien', 'ggp:Gewaesser:Fluss:Garetien:Gardel', 'new', '2026-08-31 10:00:00', 7)")
    ->execute();
avesmapsGaretienBaueSyncPlan($pdoV, 1, 1);
$nachBau = (string) $pdoV->query(
    "SELECT entity_key FROM sync_decision WHERE kind = 'garetien' AND applied_at IS NOT NULL"
)->fetchColumn();
assert($nachBau === 'ggp:Gewaesser:Fluss:Garetien:Gardel!Gardel',
    '💣 der Planbau zieht Altschluessel selbst mit -- nicht nur der direkte Aufruf: ' . $nachBau);
$pruefungen++;

// =================================================================================================
// 🔴 EIN PUNKTZIEL BEKOMMT DIE MITTE DER FLAECHE, NICHT DIE ERSTE ECKE
// =================================================================================================
// Owner 01.09.2026: „Bei Flaechen, die zu Punkten (label, orte, …) werden, soll der
// Flaechenmittelpunkt genommen werden."
//
// 💣 Vorher stand dort `$punkte[0]` -- die erste Ecke des Rings. Gemessen am Livebestand:
// von den 79 `Berg`-Zeilen des Exports tragen 78 ein POLYGON (bis 211 Punkte), also sassen
// praktisch alle importierten Berggipfel am RAND ihrer Bergflaeche. Es fiel nie auf, weil ein
// Gipfel am Rand immer noch wie ein Gipfel aussieht -- und KEIN Test hat die Aenderung bemerkt,
// als sie gemacht wurde. Diese Zusicherung ist die Antwort darauf.
$quadrat = [[10.0, 10.0], [30.0, 10.0], [30.0, 30.0], [10.0, 30.0]];
assert(avesmapsGaretienRingMittelpunkt($quadrat) === [20.0, 20.0],
    'die Mitte eines Quadrats: ' . json_encode(avesmapsGaretienRingMittelpunkt($quadrat)));
// ⚠️ Und sie ist NICHT die erste Ecke -- ohne diese Zeile waere die obige auch fuer ein
// Quadrat wahr, dessen erste Ecke zufaellig in der Mitte laege.
assert(avesmapsGaretienRingMittelpunkt($quadrat) !== $quadrat[0],
    '💣 und ausdruecklich nicht die erste Ecke');
// ⚠️ Bei EINEM Punkt ist sie dieser Punkt -- jeder Ort mit einer einzigen Koordinate (alle
// Burgen, Doerfer, Tempel) wandert durch diese Aenderung um keinen Pixel.
assert(avesmapsGaretienRingMittelpunkt([[7.5, 3.25]]) === [7.5, 3.25],
    'ein einzelner Punkt bleibt, wo er ist');
assert(avesmapsGaretienRingMittelpunkt([]) === [0.0, 0.0], 'und eine leere Liste faellt nicht um');
$pruefungen += 4;

// 🔴 UND DER PLANBAU BENUTZT SIE WIRKLICH. Ein Rechner, den niemand ruft, ist kein Rechner
// -- genau diese Luecke ist am selben Tag bei der Schluesselwanderung aufgetreten.
$pdoM = avesmapsGaretienPlanTestPdo();
$pdoM->prepare("INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum,"
    . " artikel, anzeige, lodmin, lodmax, extra, geo_art, geo, roh)"
    . " VALUES (1,'ggp','Berge',77,'Berg','Garetien','Mittelprobe','Mittelprobe','','','','koordinaten',"
    . "'10000 -10000, 30000 -10000, 30000 -30000, 10000 -30000','')")->execute();
avesmapsGaretienBaueSyncPlan($pdoM, 1, 1);
$bergZeile = $pdoM->query("SELECT after_json FROM sync_plan_item WHERE label LIKE 'Mittelprobe%'")
    ->fetchColumn();
$bergNach = json_decode((string) $bergZeile, true);
assert(is_array($bergNach) && ($bergNach['ziel'] ?? '') === 'label',
    'die Vorbedingung: ein Berg wird ein freies Label: ' . json_encode($bergNach['ziel'] ?? null));

// Die vier Ecken in UNSEREN Einheiten -- und die erwartete Mitte daraus, gerechnet mit demselben
// Wandler wie der Planbau (keine abgeschriebene Zahl).
$eckenM = avesmapsGaretienLinieNachAvesmaps(
    [[10000.0, -10000.0], [30000.0, -10000.0], [30000.0, -30000.0], [10000.0, -30000.0]]
);
$mitteM = avesmapsGaretienRingMittelpunkt($eckenM);
assert($bergNach['geometry']['coordinates'] === $mitteM,
    '🔴 der Planbau setzt den Punkt in die Mitte: '
    . json_encode([$bergNach['geometry']['coordinates'], $mitteM]));
// 💣 UND MESSBAR NICHT AUF DIE ERSTE ECKE. Ohne diese Zeile waere der Test auch dann gruen,
// wenn Mitte und erste Ecke zufaellig zusammenfielen.
assert($bergNach['geometry']['coordinates'] !== $eckenM[0],
    '💣 und nicht auf die erste Ecke: ' . json_encode($eckenM[0]));
$pruefungen += 3;

// =================================================================================================
// 💣 DIE WANDERUNG FASST NUR AN, WAS EINEN LAUF UEBERLEBT
// =================================================================================================
// Live am 01.09.2026: „Holen & Rechnen" antwortete mit 502 und einer HTML-Fehlerseite (im Browser
// „Unexpected token '<'"). Die erste Fassung sammelte JEDEN `entity_key` aus `sync_plan_item` --
// 8213 je Lauf -- und fuhr fuer jeden zwei UPDATEs. Das ist genau die Last, vor der CLAUDE.md
// warnt, und sie stand im haeufigsten Pfad des Fensters.
//
// 🔴 Gebraucht wird nur, was einen Lauf ueberlebt: die Vermerke in `sync_decision` und die
// Items mit `apply_state = 'done'` (nur die findet die laufuebergreifende Ruecknahme). Alles
// uebrige baut der naechste Planbau ohnehin neu -- und zwar schon in der neuen Form.
$pdoK = avesmapsGaretienPlanTestPdo();
$laufK = avesmapsSyncPlanStartRun($pdoK, AVESMAPS_GARETIEN_PLAN_KIND, 7, null);
$altAlkeK = 'ggp:Gewaesser:Bach:Garetien:Alke';
$altGardelK = 'ggp:Gewaesser:Fluss:Garetien:Gardel';

$setzK = static function (PDO $p, int $lauf, string $key, ?string $stand): void {
    $p->prepare('INSERT INTO sync_plan_item (run_id, entity_key, change_type, label, before_json,'
        . ' after_json, override_json, selected, apply_state)'
        . " VALUES (?,?, 'new', ?, '{}', '{}', '{}', 1, ?)")
        ->execute([$lauf, $key, 'L-' . $key, $stand]);
};
$setzK($pdoK, $laufK, $altAlkeK, 'done');    // uebernommen -> muss wandern
$setzK($pdoK, $laufK, $altGardelK, null);    // nur geplant -> wird ohnehin neu gebaut

avesmapsGaretienSchluesselWanderung($pdoK, 1);

$standK = static fn(PDO $p, string $key): int => (int) $p->query(
    "SELECT COUNT(*) FROM sync_plan_item WHERE entity_key = '$key'"
)->fetchColumn();

assert($standK($pdoK, $altAlkeK . '!Alke') === 1,
    '🔴 ein UEBERNOMMENES Item wandert mit -- sonst findet die laufuebergreifende Ruecknahme '
    . 'seine angelegte public_id nie wieder');
assert($standK($pdoK, $altAlkeK) === 0, 'und steht nicht mehr unter dem alten Schluessel');
$pruefungen += 2;

// ⚠️ Das nur GEPLANTE Item bleibt liegen -- und das ist keine Nachlaessigkeit, sondern der
// ganze Punkt: es wird beim naechsten Planbau ersetzt. Es zu wandern waere Arbeit fuer eine
// Zeile, die zwei Zeilen spaeter verschwindet -- und mal 8213 genommen war es der 502.
assert($standK($pdoK, $altGardelK) === 1,
    '💣 ein nur geplantes Item wird NICHT angefasst: ' . $standK($pdoK, $altGardelK));
assert($standK($pdoK, $altGardelK . '!Gardel') === 0, 'es entsteht auch kein neuer Schluessel dafuer');
$pruefungen += 2;

// =================================================================================================
// 🔴 DAS ZIEL LAESST SICH WECHSELN -- UND DIE GEOMETRIE WIRD MITGEFORMT
// =================================================================================================
// Owner 01.09.2026: „die editoren wollen dass man bestimmen kann, welchen typ das ziel haben soll
// … auch von flaeche auf berg … er soll den vorschlag nehmen, den er gerade hat, aber mann will
// auch aendern koennen."
$ringZ = [[10.0, 10.0], [30.0, 10.0], [30.0, 30.0], [10.0, 30.0]];
$flaecheZ = [
    'herkunft' => 'garetien', 'ziel' => 'region', 'subtyp' => 'suempfe_moore',
    'kind' => 'vegetation', 'name' => 'Lilienmoor',
    'geometry' => avesmapsGaretienZielGeometrie($ringZ, 'region'),
];

// --- Ohne Wahl bleibt alles, wie es war. „Alle angezeigten einfuegen" schickt keine.
assert(avesmapsGaretienZielUebersteuern($flaecheZ, null) === $flaecheZ, 'ohne Wahl unveraendert');
assert(avesmapsGaretienZielUebersteuern($flaecheZ, ['size' => 17]) === $flaecheZ,
    'und eine Handeingabe ohne Zielwahl ebenso');
$pruefungen += 2;

// --- 🔴 FLAECHE -> BERG: aus dem Polygon wird ein PUNKT, und zwar die Mitte.
$bergZ = avesmapsGaretienZielUebersteuern($flaecheZ, ['ziel' => 'label', 'subtyp' => 'berggipfel']);
assert($bergZ['ziel'] === 'label' && $bergZ['subtyp'] === 'berggipfel', 'das Ziel wandert');
assert($bergZ['geometry']['type'] === 'Point',
    '💣 und die GEOMETRIE mit -- sonst laege ein Ring im Point-Feld: '
    . $bergZ['geometry']['type']);
assert($bergZ['geometry']['coordinates'] === [20.0, 20.0],
    'auf der Mitte der Flaeche: ' . json_encode($bergZ['geometry']['coordinates']));
// 🔴 `kind` faellt weg -- ein Label hat keine Landschaftsebene.
assert($bergZ['kind'] === null, 'ein Label traegt kein `kind`: ' . json_encode($bergZ['kind']));
// ⚠️ Und die rohe Liste reist mit, sonst waere der Wechsel eine Einbahnstrasse.
assert(($bergZ['punkte'] ?? null) === $ringZ, 'die rohe Punktliste bleibt erhalten');
$pruefungen += 5;

// --- ⚠️ UND ZURUECK. Genau dafuer traegt das Punktziel seine Liste.
$zurueckZ = avesmapsGaretienZielUebersteuern($bergZ, ['ziel' => 'region', 'subtyp' => 'gebirge',
    'kind' => 'topographie']);
assert($zurueckZ['geometry']['type'] === 'Polygon' && $zurueckZ['geometry']['coordinates'] === [$ringZ],
    '⚠️ der Weg zurueck zur Flaeche steht offen: ' . json_encode($zurueckZ['geometry']));
assert($zurueckZ['kind'] === 'topographie', 'und die Flaeche bekommt ihre Ebene wieder');
assert(!isset($zurueckZ['punkte']), 'die Liste steht jetzt wieder in der Geometrie selbst');
$pruefungen += 3;

// --- 💣 WAS DIE GEOMETRIE NICHT HERGIBT, WIRD ABGELEHNT. Aus EINER Koordinate laesst sich
// keine Flaeche bauen -- und alle Burgen, Doerfer und Tempel des Exports haben genau eine.
$ortZ = [
    'herkunft' => 'garetien', 'ziel' => 'location', 'subtyp' => 'dorf', 'kind' => null,
    'name' => 'Einpunkt', 'geometry' => avesmapsGaretienZielGeometrie([[5.0, 5.0]], 'location'),
];
assert(avesmapsGaretienMoeglicheZiele([[5.0, 5.0]]) === ['location', 'label'],
    'ein einzelner Punkt traegt nur Punktziele: '
    . json_encode(avesmapsGaretienMoeglicheZiele([[5.0, 5.0]])));
assert(avesmapsGaretienMoeglicheZiele([[1.0, 1.0], [2.0, 2.0]]) === ['location', 'label', 'path'],
    'zwei Punkte tragen zusaetzlich eine Linie');
assert(avesmapsGaretienMoeglicheZiele($ringZ) === ['location', 'label', 'path', 'region'],
    'ab drei Punkten geht alles');
$gefangen = false;
try {
    avesmapsGaretienZielUebersteuern($ortZ, ['ziel' => 'region', 'subtyp' => 'wald',
        'kind' => 'vegetation']);
} catch (RuntimeException $e) {
    $gefangen = str_contains($e->getMessage(), 'kein Ziel');
}
assert($gefangen, '💣 eine Flaeche aus einem einzigen Punkt wird LAUT abgelehnt');
// ⚠️ Aber ein Ort darf sehr wohl ein Label werden -- die Ablehnung ist keine Sperre gegen
// jeden Wechsel.
$labelZ = avesmapsGaretienZielUebersteuern($ortZ, ['ziel' => 'label', 'subtyp' => 'felsformation']);
assert($labelZ['subtyp'] === 'felsformation' && $labelZ['geometry']['coordinates'] === [5.0, 5.0],
    'ein Ort wird ein freies Label, ohne dass sich der Punkt bewegt');
$pruefungen += 5;

// --- 🔴 DER PLANBAU LEGT DIE ROHE LISTE NUR DORT AB, WO SIE SONST VERLOREN GINGE.
$pdoZ = avesmapsGaretienPlanTestPdo();
$pdoZ->prepare("INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum,"
    . " artikel, anzeige, lodmin, lodmax, extra, geo_art, geo, roh)"
    . " VALUES (1,'ggp','Berge',78,'Berg','Garetien','Listenprobe','Listenprobe','','','','koordinaten',"
    . "'10000 -10000, 30000 -10000, 30000 -30000, 10000 -30000','')")->execute();
avesmapsGaretienBaueSyncPlan($pdoZ, 1, 1);
$mitListe = json_decode((string) $pdoZ->query(
    "SELECT after_json FROM sync_plan_item WHERE label LIKE 'Listenprobe%'")->fetchColumn(), true);
assert(count((array) ($mitListe['punkte'] ?? [])) === 4,
    '🔴 ein Punktziel mit mehreren Quellpunkten traegt seine Liste: '
    . json_encode(array_keys($mitListe)));
// ⚠️ Eine FLAECHE traegt sie NICHT -- sie steht schon in der Geometrie, und ein zweites Mal
// kostet bei 8213 Vorschlaegen echten Platz.
$flaecheDb = null;
foreach ($pdoZ->query('SELECT after_json FROM sync_plan_item') as $zeileZ) {
    $n = json_decode((string) $zeileZ['after_json'], true);
    if (($n['ziel'] ?? '') === 'region') { $flaecheDb = $n; }
}
assert($flaecheDb !== null, 'die Vorbedingung: eine Flaeche ist im Pruefstand');
assert(!isset($flaecheDb['punkte']),
    '⚠️ eine Flaeche traegt die Liste NICHT doppelt: ' . json_encode(array_keys($flaecheDb)));
$pruefungen += 3;

echo "OK: {$pruefungen} Pruefungen\n";
