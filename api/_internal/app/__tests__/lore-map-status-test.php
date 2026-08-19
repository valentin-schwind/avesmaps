<?php

declare(strict_types=1);

// avesmapsLoreMapStatus + der Filter „Auf Karte" -- EINE Quelle, ZWEI Verbraucher.
//
// 🔴 DAS IST DIE TRAGENDE ZUSICHERUNG DIESER DATEI. Der Filter vergleicht das Ergebnis von
// avesmapsLoreMapStatus, und dasselbe Ergebnis reist als `map_status` in den Browser und malt dort
// den Kreis. Gaebe es zwei Bedingungen, koennte der Filter „offen" eine Zeile zeigen, deren Kreis
// voll ist -- und niemand fuende je heraus, welche der beiden luegt. Geprueft wird deshalb nicht
// nur die Regel, sondern dass Filter und `map_status` an DENSELBEN Daten dasselbe sagen.
//
// 🪤 Und die zweite Zusicherung ist gegen den Fehler von gestern gebaut: eine Filteroption, die NIE
// etwas trifft, sieht genauso aus wie eine, die richtig filtert. Deshalb sind die drei Optionen
// hier DISJUNKT und ergeben zusammen den ungefilterten Bestand -- eine tote Option faellt damit auf.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           -d extension=php_mbstring.dll api/_internal/app/__tests__/lore-map-status-test.php

require_once __DIR__ . '/../lore.php';

// Der Kartenschluessel-Leser fragt auch `map_features` ab, das es in dieser Fixture nicht gibt --
// er protokolliert das und macht weiter (dort ist die Meldung eine eigene Zusicherung,
// lore-orte-auf-der-karte-test.php). Hier waere sie nur Laerm.
ini_set('log_errors', '1');
ini_set('error_log', tempnam(sys_get_temp_dir(), 'lore-mapstatus-log'));

$pruefungen = 0;

// ── (1) DIE REGEL SELBST ───────────────────────────────────────────────────────────────────────
// Owner 18.08.2026, und die Beschriftungen des Filters daneben (19.08.2026).
foreach ([
    // gesamt, verortet, Zustand,  Filterwort
    [0, 0, 'leer', 'nicht zugewiesen'],
    [1, 0, 'halb', 'offen'],
    [1, 1, 'voll', 'auffindbar'],
    [3, 1, 'voll', 'auffindbar'],   // 💣 EIN Fundort genuegt -- gegenlaeufig zu Literatur/Karte,
    [3, 3, 'voll', 'auffindbar'],   //    wo dieselben Zahlen „halb" ergaeben (halb schlaegt voll).
] as [$gesamt, $verortet, $erwartet, $wort]) {
    assert(avesmapsLoreMapStatus($gesamt, $verortet) === $erwartet,
        "gesamt={$gesamt}, verortet={$verortet} muss „{$erwartet}“ ({$wort}) ergeben, ist "
        . avesmapsLoreMapStatus($gesamt, $verortet));
    $pruefungen++;
}
// 💣 Die Probe auf die Gegenlaeufigkeit: dieselben zwei Zahlen, zwei Objektarten, zwei
// entgegengesetzte Antworten. Bei einem WERK ist jeder unaufgeloeste Ort offene Arbeit, bei einer
// WARE genuegt ein Fundort. Wer die beiden Regeln je zusammenlegt, bricht genau das hier.
assert(avesmapsLoreMapStatus(3, 1) === 'voll',
    'Vorkommen: 3 genannt, 1 verortet ist VOLL. (Literatur/Karte sagen bei denselben Zahlen halb --'
    . ' avesmapsStatuskreisOrtsbezugZahlen, js/ui/listen-statuskreis.js.)');
$pruefungen++;
// ⚠️ Die drei Zustaende stehen auch als Liste da, und die Reihenfolge ist die des Filtermenues.
assert(AVESMAPS_LORE_MAP_STATUSES === ['voll', 'halb', 'leer'],
    'Die drei Zustaende und ihre Reihenfolge sind der Bauplan des Filtermenues.');
$pruefungen++;

// ── Fixture: derselbe Bestand fuer Regel, Filter und Kreis ─────────────────────────────────────
function avesmapsMapStatusTestPdo(): PDO
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec("CREATE TABLE lore_entry (wiki_key TEXT PRIMARY KEY, kind TEXT, name TEXT, wiki_url TEXT,
        gruppe TEXT, typ TEXT, lebensraum TEXT, synonyme TEXT, origin TEXT, status TEXT, continent TEXT)");
    $pdo->exec("CREATE TABLE lore_place (entry_wiki_key TEXT, place_wiki_key TEXT, place_title TEXT,
        relation TEXT, origin TEXT, status TEXT, sort_order INT)");
    $pdo->exec("CREATE TABLE lore_rule (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_wiki_key TEXT,
        relation TEXT, origin TEXT, status TEXT, sort_order INT DEFAULT 0)");
    $pdo->exec("CREATE TABLE lore_rule_term (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id INT, seq INT,
        join_op TEXT DEFAULT 'und', area_public_id TEXT NULL, climate_from TEXT NULL, climate_to TEXT NULL)");
    $pdo->exec('CREATE TABLE lore_rule_term_type (term_id INT, kind TEXT, region_type TEXT)');
    $pdo->exec('CREATE TABLE ecosystem_assignment_stamp (id INT PRIMARY KEY, completed INT)');
    $pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT,
        name TEXT, kind TEXT, region_type TEXT NULL, wiki_region_key TEXT NULL, is_active INT)');
    $pdo->exec('CREATE TABLE ecosystem_region_overlap (region_id INT, other_region_id INT, share REAL)');
    $pdo->exec('CREATE TABLE feature_sources (entity_type TEXT, entity_public_id TEXT, status TEXT)');
    $pdo->exec('INSERT INTO ecosystem_assignment_stamp (id, completed) VALUES (1, 1)');
    // Die Karte: eine Landschaftsflaeche „Weiden" und ein Wald (fuer die Regel).
    $pdo->exec("INSERT INTO ecosystem_region (public_id, name, kind, region_type, wiki_region_key, is_active) VALUES
        ('r-weiden', 'Weiden', 'derographisch', 'region', 'weiden', 1),
        ('r-wald',   'Alkrawald', 'vegetation', 'wald', 'alkrawald', 1)");

    // Vier Eintraege, einer je Fall -- und der fuenfte ist der Grenzfall „beides".
    $pdo->exec("INSERT INTO lore_entry (wiki_key, kind, name, status, origin, continent) VALUES
        ('aal',      'fauna', 'Aal',       'active', 'wiki', 'Aventurien'),
        ('schiffsw', 'ware',  'Schiffsau', 'active', 'wiki', 'Aventurien'),
        ('abakus',   'ware',  'Abakus',    'active', 'wiki', 'Aventurien'),
        ('alprute',  'flora', 'Alprute',   'active', 'wiki', 'Aventurien'),
        ('einbeere', 'flora', 'Einbeere',  'active', 'wiki', 'Aventurien')");
    // „Aal" liegt in Weiden (auf der Karte) -> voll. „Schiffsau" nur auf dem Schiff -> halb.
    // „Abakus" hat gar nichts -> leer.
    $pdo->exec("INSERT INTO lore_place (entry_wiki_key, place_wiki_key, place_title, relation, origin, status, sort_order) VALUES
        ('aal',      'weiden', 'Weiden', 'verbreitung', 'wiki', 'active', 0),
        ('schiffsw', 'schiff', 'Schiff', 'verbreitung', 'wiki', 'active', 0),
        ('einbeere', 'schiff', 'Schiff', 'verbreitung', 'wiki', 'active', 0)");
    // „Alprute" hat NUR eine Regel (der Livefall), „Einbeere" hat BEIDES (Ortszeile + Regel).
    foreach (['alprute', 'einbeere'] as $entry) {
        $pdo->prepare("INSERT INTO lore_rule (entry_wiki_key, relation, origin, status) VALUES (?,'verbreitung','manual','active')")
            ->execute([$entry]);
        $ruleId = (int) $pdo->lastInsertId();
        $pdo->prepare('INSERT INTO lore_rule_term (rule_id, seq, join_op) VALUES (?,0,?)')->execute([$ruleId, 'und']);
        $pdo->prepare('INSERT INTO lore_rule_term_type (term_id, kind, region_type) VALUES (?,?,?)')
            ->execute([(int) $pdo->lastInsertId(), 'vegetation', 'wald']);
    }

    return $pdo;
}

// ── (2) Der Zustand je Eintrag, ueber den ganzen Bestand ───────────────────────────────────────
$pdo = avesmapsMapStatusTestPdo();
$alle = ['aal', 'schiffsw', 'abakus', 'alprute', 'einbeere'];
$status = avesmapsLoreReadMapStatusByEntry($pdo, $alle);
assert($status['aal'] === 'voll', '„Aal" liegt in Weiden -- auffindbar.');
assert($status['schiffsw'] === 'halb', '„Schiffsau" liegt nur auf dem Schiff -- offen.');
assert($status['abakus'] === 'leer', '„Abakus" hat gar kein Vorkommen -- nicht zugewiesen.');
assert($status['alprute'] === 'voll', 'Eine Regel, die Waelder trifft, macht auffindbar -- ohne jede Ortszeile.');
assert($status['einbeere'] === 'voll',
    'Ortszeile ins Leere PLUS treffende Regel: EIN Fundort genuegt. Ohne die Regel waere es halb.');
$pruefungen += 5;

// ── (3) 🔴 EINE QUELLE, ZWEI VERBRAUCHER ───────────────────────────────────────────────────────
// Was der Filter auswaehlt, muss genau das sein, was der Kreis als diesen Zustand malt. Geprueft
// an DENSELBEN Daten: der Katalog liefert `map_status` je Zeile, der Filter liefert eine Auswahl --
// beide muessen sich decken. Waeren es zwei Bedingungen, ginge genau das hier auseinander.
$ungefiltert = avesmapsLoreReadCatalog($pdo, '', '', 500, 0);
$statusAusKatalog = [];
foreach ($ungefiltert['items'] as $item) {
    assert(array_key_exists('map_status', $item), 'Jede Katalogzeile traegt ihren Zustand mit.');
    $statusAusKatalog[$item['wiki_key']] = $item['map_status'];
}
$pruefungen++;
$vereinigung = [];
foreach (AVESMAPS_LORE_MAP_STATUSES as $wert) {
    $gefiltert = avesmapsLoreReadCatalog($pdo, '', '', 500, 0, [], [], null, null, $wert);
    foreach ($gefiltert['items'] as $item) {
        assert($item['map_status'] === $wert,
            "Der Filter „{$wert}“ liefert eine Zeile, deren Kreis „{$item['map_status']}“ zeigt. "
            . 'Das ist der Zustand, gegen den diese Datei gebaut ist: Filter und Kreis muessen '
            . 'DIESELBE Rechnung benutzen.');
        assert(!isset($vereinigung[$item['wiki_key']]),
            "„{$item['wiki_key']}“ erscheint in zwei der drei Filter -- die drei Zustaende sind disjunkt.");
        $vereinigung[$item['wiki_key']] = true;
    }
    // 🪤 Jede Option muss auch WIRKLICH etwas treffen. Eine tote Option sieht genauso aus wie eine,
    // die richtig filtert -- genau dieser Irrtum hat am 19.08.2026 eine Messrunde gekostet.
    assert($gefiltert['total'] > 0, "Der Filter „{$wert}“ trifft nichts. Tote Option?");
    assert($gefiltert['total'] === count($gefiltert['items']),
        "Bei „{$wert}“ stimmt die gemeldete Gesamtzahl nicht mit den gelieferten Zeilen ueberein -- "
        . 'daran haengt die Bilanzzeile unter der Suche.');
    $pruefungen += 2;
}
assert(count($vereinigung) === count($ungefiltert['items']),
    'Die drei Filter zusammen muessen den ganzen Bestand ergeben (' . count($ungefiltert['items'])
    . '), sind aber ' . count($vereinigung) . '. Eine Zeile faellt zwischen die Zustaende.');
$pruefungen++;

// ── (4) „Vorkommen ueber": alle · orte · regeln ────────────────────────────────────────────────
// 🔴 Ein Filter auf die HERKUNFT des Vorkommens, kein Entweder-Oder ueber den Eintrag: wer beides
// hat, erscheint in BEIDEN. Live betrifft das genau einen von 5.104 Eintraegen -- die Fixture
// bildet ihn als „Einbeere" ab, damit die Entscheidung nicht bloss im Kommentar steht.
$namen = static function (array $ergebnis): array {
    return array_map(static fn (array $i): string => (string) $i['wiki_key'], $ergebnis['items']);
};
$orte = $namen(avesmapsLoreReadCatalog($pdo, '', '', 500, 0, [], [], null, null, null, 'orte'));
$regeln = $namen(avesmapsLoreReadCatalog($pdo, '', '', 500, 0, [], [], null, null, null, 'regeln'));
sort($orte);
sort($regeln);
assert($orte === ['aal', 'einbeere', 'schiffsw'], '„ueber Orte" = hat mindestens eine Ortszeile. Ist: ' . implode(',', $orte));
assert($regeln === ['alprute', 'einbeere'], '„ueber Regeln" = hat mindestens eine Regel. Ist: ' . implode(',', $regeln));
assert(in_array('einbeere', $orte, true) && in_array('einbeere', $regeln, true),
    'Ein Eintrag mit Ortszeile UND Regel erscheint in BEIDEN Listen -- es ist ein Filter auf die '
    . 'Herkunft, kein Entweder-Oder ueber den Eintrag.');
assert(count($namen($ungefiltert)) === 5, '„alle" ist der ungefilterte Bestand.');
$pruefungen += 4;
// ⚠️ Eine stillgelegte Regel macht keinen Regel-Eintrag -- dieselbe Bedingung wie im Zaehler.
$pdo->exec("UPDATE lore_rule SET status = 'suppressed' WHERE entry_wiki_key = 'alprute'");
$regelnDanach = $namen(avesmapsLoreReadCatalog($pdo, '', '', 500, 0, [], [], null, null, null, 'regeln'));
assert(!in_array('alprute', $regelnDanach, true),
    'Eine stillgelegte Regel darf den Filter „ueber Regeln" nicht mehr treffen -- sonst meinen '
    . 'Filter und Zaehler Verschiedenes.');
$pruefungen++;

// ── (5) Beide Filter zusammen ──────────────────────────────────────────────────────────────────
$pdo = avesmapsMapStatusTestPdo();
$beides = avesmapsLoreReadCatalog($pdo, '', '', 500, 0, [], [], null, null, 'halb', 'orte');
assert($namen($beides) === ['schiffsw'],
    '„offen" UND „ueber Orte" muss sich schneiden, nicht vereinigen. Ist: ' . implode(',', $namen($beides)));
$pruefungen++;

// ── (6) Unbekannte Werte schraenken NICHT ein ──────────────────────────────────────────────────
// ⚠️ Die Liste ist ein Trichter, kein Vertrag: ein Wert, den es nicht gibt, darf sie nicht leeren.
$unsinn = avesmapsLoreReadCatalog($pdo, '', '', 500, 0, [], [], null, null, 'gibtesnicht', 'auchnicht');
assert(count($unsinn['items']) === 5, 'Ein unbekannter Filterwert schraenkt nicht ein.');
$pruefungen++;

echo "lore-map-status: {$pruefungen} Zusicherungen bestanden.\n";
