<?php

declare(strict_types=1);

/**
 * 💣 Der Aussengrenzen-Hinweis: WAS ein Eltern-Umzug nebenbei bewirkt. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-plan-test.php
 *
 * Die abgeleitete Aussengrenze gehoert nur einem REINEN BEHAELTER (kein eigenes Polygon, aggregiert
 * Kinder) oder einer Wurzel. An genau diesem Praedikat hingen nacheinander vier Fehler. Diese Funktion
 * RECHNET NICHTS NACH und ruft NICHTS aus dem Aussengrenzen-System -- sie sagt einen Satz. Der Test
 * haelt beides fest: dass der Satz stimmt, und dass er ein Satz bleibt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../territory-plan.php';
require_once __DIR__ . '/../territory-plan-apply.php';

// counts[wiki_key] = ['name' => …, 'own_geometry' => int, 'children' => int]
$counts = [
    'wiki:grafschaft-ragath' => ['name' => 'Grafschaft Ragath', 'own_geometry' => 0, 'children' => 1],
    'wiki:f-rstentum-almada' => ['name' => 'Fürstentum Almada', 'own_geometry' => 0, 'children' => 4],
    'wiki:mark-ragathsquell' => ['name' => 'Mark Ragathsquell', 'own_geometry' => 1, 'children' => 1],
    'wiki:baronie-schwarztannen' => ['name' => 'Baronie Schwarztannen', 'own_geometry' => 1, 'children' => 0],
];

// --- Der alte Elternteil verliert sein letztes Kind ------------------------------------------------
$note = avesmapsTerritoryPlanRoleShift($counts, 'wiki:mark-ragathsquell', 'wiki:grafschaft-ragath', 'wiki:f-rstentum-almada');
assert($note !== '', 'ein Umzug, der eine Rolle kippt, sagt es');
assert(str_contains($note, 'Grafschaft Ragath'), 'der alte Elternteil wird benannt');
assert(str_contains($note, 'kein Behälter mehr'), 'und was mit ihm passiert');

// --- Der neue Elternteil wird zum Behaelter ---------------------------------------------------------
$note = avesmapsTerritoryPlanRoleShift($counts, 'wiki:baronie-schwarztannen', null, 'wiki:baronie-schwarztannen');
assert($note === '', 'ein Umzug auf sich selbst ist keiner');

$counts['wiki:neue-mark'] = ['name' => 'Neue Mark', 'own_geometry' => 0, 'children' => 0];
$note = avesmapsTerritoryPlanRoleShift($counts, 'wiki:baronie-schwarztannen', null, 'wiki:neue-mark');
assert(str_contains($note, 'Neue Mark'), 'der neue Elternteil wird benannt');
assert(str_contains($note, 'wird zum Behälter'));

// --- 💣 Der umgezogene Knoten selbst kann seine Rolle ebenso verlieren -------------------------------
//
// Eine Wurzel ist foerderberechtigt ALLEIN weil sie eine Wurzel ist (isRoot || isPureAggregate,
// isOwnDerivedBoundaryForbidden in territory-derived-geometry-editor.js) -- unabhaengig von ihrer
// Geometrie. Der Umzug oben (Baronie: eigenes Polygon, Wurzel -> Neue Mark) ist genau dieser Fall, und
// er ist der HAEUFIGE Weg in diesem Datenmodell: ein Territorium wird von Hand ohne Elternteil angelegt
// und erst danach eingehaengt -- derselbe $note wie eben, nur mit dem Blick auf die Baronie statt auf
// "Neue Mark".
assert(str_contains($note, 'Baronie Schwarztannen verliert'), '💣 der umgezogene Knoten selbst wird benannt');
assert(str_contains($note, 'Wurzelstatus'), 'und der Grund ist der Wurzelstatus, nicht die Geometrie');

// --- Ein reiner Behaelter bleibt foerderberechtigt, auch wenn er die Wurzel verliert -----------------
//
// Almada aggregiert Kinder (0 eigene Geometrie, 4 Kinder) -- seine eigenen Zahlen aendern sich durch
// einen Umzug NICHT, nur wessen Kind es ist. Ein Umzug von der Wurzel zu einem echten Elternteil darf
// ihm deshalb nichts nehmen: er bleibt Behaelter und damit foerderberechtigt, ganz ohne die Wurzel-Regel.
$note = avesmapsTerritoryPlanRoleShift($counts, 'wiki:f-rstentum-almada', null, 'wiki:grafschaft-ragath');
assert($note === '', 'ein reiner Behaelter verliert seine Berechtigung NICHT ueber die Wurzel-Regel');

// --- Ein Umzug ohne Rollenwechsel sagt nichts -------------------------------------------------------
//
// Almada hat vier Kinder und behaelt drei; Ragathsquell traegt ein eigenes Polygon und bleibt so oder
// so gesperrt. Ein Hinweis, der bei jeder Zeile steht, wird nicht gelesen.
$counts['wiki:grafschaft-ragath']['children'] = 5;
$note = avesmapsTerritoryPlanRoleShift($counts, 'wiki:mark-ragathsquell', 'wiki:grafschaft-ragath', 'wiki:f-rstentum-almada');
assert($note === '', 'kein Rollenwechsel => kein Hinweis');

// --- 💣 Und die Datei ruft nichts aus dem Aussengrenzen-System -------------------------------------
$source = (string) file_get_contents(__DIR__ . '/../territory-plan.php');
foreach (['DerivedGeometry', 'derived_geometry', 'GenerateOrUpdate', 'RecomputeDerived'] as $forbidden) {
    assert(!str_contains($source, $forbidden), "💣 die Rechen-Haelfte fasst {$forbidden} nicht an");
}

echo "territory-plan ok\n";

// =====================================================================================================
// TEIL 2 -- die drei read-only Quellen, auf sqlite
// =====================================================================================================
//
// Der Aussagewert eines Zwillings steht und faellt damit, dass er dieselben Zeilen liefert, die der
// Schreiber im Trockenlauf zaehlen wuerde -- Lesen des Quelltexts allein beweist das nicht. Dieser Teil
// baut denselben Bestand nach, den avesmapsWikiSyncMonitorApplyParentCache / …ApplyCustomNodes im
// Trockenlauf saehen, und prueft die zwei Zwillinge plus avesmapsTerritoryPlanNodeCounts dagegen.
//
// ⚠️ avesmapsTerritoryPlanStep bleibt hier AUSSEN VOR: es ruft avesmapsEnsureSyncPlanTables, deren DDL
// echtes MySQL ist (AUTO_INCREMENT, ENGINE=InnoDB, mehrspaltige KEY-Klauseln) -- sqlite lehnt das mit
// einem Syntaxfehler ab, empirisch geprueft. Dieselbe Grenze gilt schon fuer jeden Geschwister-Test
// (territory-wiki-plan-test.php, lore-plan-test.php): keiner von ihnen ruft seinen vollen *PlanStep
// gegen sqlite, aus demselben Grund.

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- part 2 would silently prove nothing.\n");
    exit(2);
}

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec(
    'CREATE TABLE political_territory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, wiki_id INTEGER, wiki_key TEXT,
        slug TEXT, name TEXT, short_name TEXT, type TEXT, continent TEXT, status TEXT, color TEXT,
        opacity REAL, coat_of_arms_url TEXT, wiki_url TEXT, valid_from_bf INTEGER, valid_to_bf INTEGER,
        valid_label TEXT, min_zoom INTEGER, max_zoom INTEGER, parent_id INTEGER, is_active INTEGER DEFAULT 1,
        editor_notes TEXT, sort_order INTEGER
    )'
);
$pdo->exec(
    'CREATE TABLE political_territory_geometry (
        id INTEGER PRIMARY KEY AUTOINCREMENT, territory_id INTEGER, is_active INTEGER DEFAULT 1
    )'
);
$pdo->exec(
    'CREATE TABLE wiki_territory_model (
        id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, parent_wiki_key TEXT,
        parent_locked INTEGER DEFAULT 0, excluded INTEGER DEFAULT 0, source_origin TEXT,
        metadata_overrides_json TEXT
    )'
);

// --- Bestand: eine Grafschaft (Behaelter, ein Kind), eine Baronie (Kind, eigenes Polygon), eine ------
// Mark ohne Zuhause im Modell (Wurzel bleibt sie live), und ein eigener Knoten, der noch nicht existiert.
$pdo->exec(
    "INSERT INTO political_territory (public_id, wiki_key, name, is_active, parent_id) "
    . "VALUES ('P-GR', 'wiki:grafschaft-ragath', 'Grafschaft Ragath', 1, NULL)"
);
$grafschaftId = (int) $pdo->lastInsertId();
$pdo->exec(
    "INSERT INTO political_territory (public_id, wiki_key, name, is_active, parent_id) "
    . "VALUES ('P-BA', 'wiki:baronie-schwarztannen', 'Baronie Schwarztannen', 1, NULL)"
);
$baronieId = (int) $pdo->lastInsertId();
$pdo->exec("INSERT INTO political_territory_geometry (territory_id, is_active) VALUES ({$baronieId}, 1)");

// Modell sagt: die Baronie soll unter die Grafschaft -- Live hat noch keinen Elternteil (NULL).
$pdo->exec(
    "INSERT INTO wiki_territory_model (wiki_key, parent_wiki_key, excluded) "
    . "VALUES ('wiki:baronie-schwarztannen', 'wiki:grafschaft-ragath', 0)"
);
// Ein eigener Knoten, platziert unter der Grafschaft, noch nicht auf der Karte.
$pdo->exec(
    "INSERT INTO wiki_territory_model (wiki_key, parent_wiki_key, excluded, source_origin, metadata_overrides_json) "
    . "VALUES ('eigener-knoten:knoten001', 'wiki:grafschaft-ragath', 0, 'custom', '{\"name\":\"Markgenossenschaft\"}')"
);
// Ein zweiter eigener Knoten ohne Namen -- der Schreiber uebergeht ihn (missing_name), der Zwilling auch.
$pdo->exec(
    "INSERT INTO wiki_territory_model (wiki_key, parent_wiki_key, excluded, source_origin, metadata_overrides_json) "
    . "VALUES ('eigener-knoten:knoten002', 'wiki:grafschaft-ragath', 0, 'custom', '{}')"
);
// Ein dritter, der schon auf der Karte existiert -- weder Schreiber noch Zwilling bieten ihn erneut an.
$pdo->exec(
    "INSERT INTO political_territory (public_id, wiki_key, name, is_active) "
    . "VALUES ('P-EX', 'eigener-knoten:knoten003', 'Schon da', 1)"
);
$pdo->exec(
    "INSERT INTO wiki_territory_model (wiki_key, parent_wiki_key, excluded, source_origin, metadata_overrides_json) "
    . "VALUES ('eigener-knoten:knoten003', NULL, 0, 'custom', '{\"name\":\"Schon da\"}')"
);

// --- avesmapsTerritoryPlanNodeCounts: zwei Sammelabfragen, keine je Zeile --------------------------
$nodeCounts = avesmapsTerritoryPlanNodeCounts($pdo);
assert($nodeCounts['wiki:grafschaft-ragath']['own_geometry'] === 0, 'die Grafschaft hat kein eigenes Polygon');
assert($nodeCounts['wiki:grafschaft-ragath']['children'] === 0, 'live hat die Grafschaft noch KEIN Kind -- der Umzug ist erst geplant');
assert($nodeCounts['wiki:baronie-schwarztannen']['own_geometry'] === 1, 'die Baronie hat ihr Polygon');
assert(isset($nodeCounts['eigener-knoten:knoten003']), 'der schon vorhandene eigene Knoten zaehlt mit, sobald er live ist');

// --- avesmapsTerritoryPlanParentMoves: derselbe Join wie ApplyParentCache im Trockenlauf ------------
$moves = avesmapsTerritoryPlanParentMoves($pdo);
assert(count($moves) === 1, 'genau ein divergentes Kind');
assert(isset($moves['wiki:baronie-schwarztannen']), 'die Baronie zieht um');
assert($moves['wiki:baronie-schwarztannen']['old_key'] === null, 'sie hatte noch keinen Elternteil');
assert($moves['wiki:baronie-schwarztannen']['old_name'] === '(keiner)');
assert($moves['wiki:baronie-schwarztannen']['was_root'] === true, 'kein parent_id => sie WAR eine Wurzel');
assert($moves['wiki:baronie-schwarztannen']['new_key'] === 'wiki:grafschaft-ragath');
assert($moves['wiki:baronie-schwarztannen']['new_name'] === 'Grafschaft Ragath');

// Modell und Live stimmen schon ueberein => kein Umzug mehr vorgeschlagen (dieselbe WHERE-Bedingung
// wie der Schreiber: child.parent_id IS NULL OR child.parent_id <> parent.id).
$pdo->exec("UPDATE political_territory SET parent_id = {$grafschaftId} WHERE id = {$baronieId}");
$movesAfter = avesmapsTerritoryPlanParentMoves($pdo);
assert($movesAfter === [], 'einmal angewendet, kein Vorschlag mehr');

// --- 💣 Der ZWEITE Teil der Bedingung: ein VORHANDENER, aber FALSCHER Elternteil --------------------
//
// Bisher wurde nur "child.parent_id IS NULL" geprueft (die Baronie hatte noch KEINEN Elternteil). Die
// echte WHERE-Bedingung hat ein zweites Disjunkt: "child.parent_id <> parent.id" -- ein Kind, das schon
// einen Elternteil hat, nur nicht den vom Modell gewollten, ist ebenso ein Umzug. Eine dritte,
// eigenstaendige Herrschaft spielt den falschen Elternteil.
$pdo->exec(
    "INSERT INTO political_territory (public_id, wiki_key, name, is_active, parent_id) "
    . "VALUES ('P-FA', 'wiki:freiherrschaft-anderswo', 'Freiherrschaft Anderswo', 1, NULL)"
);
$falscherElternteilId = (int) $pdo->lastInsertId();
$pdo->exec("UPDATE political_territory SET parent_id = {$falscherElternteilId} WHERE id = {$baronieId}");
$movesWrongParent = avesmapsTerritoryPlanParentMoves($pdo);
assert(isset($movesWrongParent['wiki:baronie-schwarztannen']), 'ein VORHANDENER, aber falscher Elternteil ist ebenso ein Umzug');
assert($movesWrongParent['wiki:baronie-schwarztannen']['old_key'] === 'wiki:freiherrschaft-anderswo', 'der alte (falsche) Elternteil wird benannt');
assert($movesWrongParent['wiki:baronie-schwarztannen']['old_name'] === 'Freiherrschaft Anderswo');
assert($movesWrongParent['wiki:baronie-schwarztannen']['new_key'] === 'wiki:grafschaft-ragath', 'der Zielelternteil bleibt der aus dem Modell');
assert($movesWrongParent['wiki:baronie-schwarztannen']['was_root'] === false, 'sie hatte einen Elternteil, also keine Wurzel');

// --- 💣 Ein vorhandener Elternteil OHNE wiki_key ist keine Wurzel ------------------------------------
//
// old_key ist dann null -- aber parent_id ist gesetzt, und old_name nennt den Elternteil. Wer beides in
// einen Topf wirft, schreibt „verliert seinen Wurzelstatus" direkt unter eine Zeile, die den alten
// Elternteil beim Namen nennt. Eigene Knoten und von Hand angelegte Gebiete haben regelmaessig keinen
// wiki_key, das ist also kein Sonderfall, sondern Bestand.
$pdo->exec(
    "INSERT INTO political_territory (public_id, wiki_key, name, is_active, parent_id) "
    . "VALUES ('P-OK', NULL, 'Herrschaft ohne Wiki', 1, NULL)"
);
$ohneKeyId = (int) $pdo->lastInsertId();
$pdo->exec("UPDATE political_territory SET parent_id = {$ohneKeyId} WHERE id = {$baronieId}");
$movesKeyless = avesmapsTerritoryPlanParentMoves($pdo);
assert($movesKeyless['wiki:baronie-schwarztannen']['old_key'] === null, 'der alte Elternteil hat keinen Schluessel');
assert($movesKeyless['wiki:baronie-schwarztannen']['old_name'] === 'Herrschaft ohne Wiki', 'aber sehr wohl einen Namen');
assert($movesKeyless['wiki:baronie-schwarztannen']['was_root'] === false,
    '💣 kein Schluessel heisst nicht „keine Eltern" -- parent_id entscheidet');
// Und der Hinweis, der daran haengt: mit was_root=false faellt der Wurzel-Satz weg, mit dem alten
// „old_key === null" stuende er da. Die Baronie traegt ein eigenes Polygon, ist also kein Behaelter.
$keylessCounts = [
    'wiki:baronie-schwarztannen' => ['name' => 'Baronie Schwarztannen', 'own_geometry' => 1, 'children' => 0],
    'wiki:grafschaft-ragath' => ['name' => 'Grafschaft Ragath', 'own_geometry' => 0, 'children' => 2],
];
assert(
    avesmapsTerritoryPlanRoleShift($keylessCounts, 'wiki:baronie-schwarztannen', null, 'wiki:grafschaft-ragath', false) === '',
    '💣 kein Wurzelstatus zu verlieren -- der Knoten hatte einen Elternteil'
);
assert(
    str_contains(
        avesmapsTerritoryPlanRoleShift($keylessCounts, 'wiki:baronie-schwarztannen', null, 'wiki:grafschaft-ragath', true),
        'Wurzelstatus'
    ),
    'und mit einer echten Wurzel steht der Satz sehr wohl da -- sonst prueft die Zeile darueber nichts'
);

$pdo->exec("UPDATE political_territory SET parent_id = NULL WHERE id = {$baronieId}"); // zurueck fuer den naechsten Teil

// --- avesmapsTerritoryPlanCustomNodesToCreate: derselbe Filter wie ApplyCustomNodes im Trockenlauf --
$toCreate = avesmapsTerritoryPlanCustomNodesToCreate($pdo);
$toCreateKeys = array_column($toCreate, 'wiki_key');
assert($toCreateKeys === ['eigener-knoten:knoten001'], 'nur der platzierte, benannte, noch nicht angelegte Knoten');
assert($toCreate[0]['name'] === 'Markgenossenschaft');
assert($toCreate[0]['parent_wiki_key'] === 'wiki:grafschaft-ragath');

// --- 💣 avesmapsTerritoryPlanCustomNodeParentName: ein VERKETTETER eigener Knoten zeigt einen Namen --
//
// Der Schreiber unterstuetzt custom->custom ausdruecklich ("funktioniert durch zwei Passes", sein
// eigener Kommentar auf ApplyCustomNodes) -- $nodeCounts kennt aber nur LIVE-Territorien. Der Elternteil
// eines verketteten, noch nicht angelegten Knotens muss deshalb aus der to-create-Liste selbst kommen,
// nicht aus dem rohen Schluessel. PURE -- keine Datenbank noetig, $nodeCounts von oben wird nur gelesen.
assert(
    avesmapsTerritoryPlanCustomNodeParentName($nodeCounts, ['eigener-knoten:knoten005' => 'Markgrafschaft Zwo'], 'eigener-knoten:knoten005') === 'Markgrafschaft Zwo',
    '💣 ein verketteter, noch nicht angelegter Elternteil zeigt seinen Namen, nicht seinen Schluessel'
);
assert(
    avesmapsTerritoryPlanCustomNodeParentName($nodeCounts, [], 'wiki:grafschaft-ragath') === 'Grafschaft Ragath',
    'ein LEBENDER Elternteil kommt weiterhin aus $nodeCounts'
);
assert(
    avesmapsTerritoryPlanCustomNodeParentName($nodeCounts, ['wiki:grafschaft-ragath' => 'Falschname'], 'wiki:grafschaft-ragath') === 'Grafschaft Ragath',
    'ein LEBENDER Elternteil hat Vorrang vor der to-create-Liste'
);
assert(
    avesmapsTerritoryPlanCustomNodeParentName($nodeCounts, [], null) === '(Wurzel)',
    'kein Elternteil bleibt die Wurzel'
);
assert(
    avesmapsTerritoryPlanCustomNodeParentName($nodeCounts, [], 'eigener-knoten:unbekannt') === 'eigener-knoten:unbekannt',
    'weder lebend noch in der Liste: der rohe Schluessel als letzter Ausweg, nicht verschluckt'
);

echo "territory-plan (sqlite) ok\n";

// =====================================================================================================
// TEIL 3 -- „Von Hand geändert": die provable-only Quelle, auf sqlite
// =====================================================================================================
//
// political_territory traegt keine "von Hand geaendert"-Spalte, also kann "live weicht von Wiki UND
// Override ab" einen Menschen-Edit nicht von einem Wert unterscheiden, den der Abgleich nur noch nicht
// erreicht hat. political_territory_identity_backup ist BEWEIS statt Vermutung: es haelt fest, was
// apply_identity zuletzt WIRKLICH geschrieben hat. avesmapsTerritoryPlanLastSyncWrote holt die neueste,
// nicht zurueckgenommene Zeile je Territorium (EINE gruppierte Abfrage, kein N+1);
// avesmapsTerritoryPlanHandEditedFields vergleicht live dagegen.

$pdo->exec(
    "CREATE TABLE political_territory_identity_backup (
        id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT, territory_id INTEGER, wiki_key TEXT,
        old_name TEXT, old_type TEXT, old_status TEXT, old_valid_from_bf INTEGER, old_valid_to_bf INTEGER,
        new_name TEXT, new_type TEXT, new_status TEXT, new_valid_from_bf INTEGER, new_valid_to_bf INTEGER,
        old_coat_of_arms_url TEXT, new_coat_of_arms_url TEXT, kind TEXT DEFAULT 'identity',
        reverted_at TEXT, created_at TEXT
    )"
);

// --- Drei weitere Territorien, eigens fuer dieses Kapitel (fruehere Zuordnungen bleiben unberuehrt) ---
$pdo->exec("INSERT INTO political_territory (public_id, wiki_key, name, is_active) "
    . "VALUES ('P-KU', 'wiki:freie-stadt-kuslik', 'Freie Stadt Kuslik', 1)");
$kuslikId = (int) $pdo->lastInsertId();
$pdo->exec("INSERT INTO political_territory (public_id, wiki_key, name, is_active) "
    . "VALUES ('P-TR', 'wiki:baronie-trallenwald', 'Baronie Trallenwald', 1)");
$trallenwaldId = (int) $pdo->lastInsertId();
$pdo->exec("INSERT INTO political_territory (public_id, wiki_key, name, is_active) "
    . "VALUES ('P-VL', 'wiki:grafschaft-verlassen', 'Grafschaft Verlassen', 1)");
$verlassenId = (int) $pdo->lastInsertId();

$insertBackup = static function (PDO $pdo, int $territoryId, string $newName, ?string $revertedAt, string $kind = 'identity'): void {
    $pdo->prepare(
        "INSERT INTO political_territory_identity_backup
            (batch_id, territory_id, new_name, new_type, new_status, new_valid_from_bf, new_valid_to_bf, kind, reverted_at)
         VALUES ('b1', :tid, :name, 'Freie Stadt', NULL, 900, 9999, :kind, :reverted)"
    )->execute(['tid' => $territoryId, 'name' => $newName, 'kind' => $kind, 'reverted' => $revertedAt]);
};

// Kuslik: eine AELTERE, dann eine NEUERE nicht-zurueckgenommene Zeile -- die neuere muss gewinnen.
$insertBackup($pdo, $kuslikId, 'Kuslik (alter Schreibstand)', null);
$insertBackup($pdo, $kuslikId, 'Freie Stadt Kuslik', null);
// Ein 'coat'-Eintrag fuer dieselbe Stadt, mit einer ANDEREN Schreibung -- darf nie einsickern.
$insertBackup($pdo, $kuslikId, 'Kuslik (Wappen-Backup, falsche Spur)', null, 'coat');

// Trallenwald: eine einzige, aktuelle Zeile, deckungsgleich mit "live".
$insertBackup($pdo, $trallenwaldId, 'Baronie Trallenwald', null);

// Verlassen: die EINZIGE Zeile ist zurueckgenommen -- "kein Beweis", nicht "so war es vorher".
$insertBackup($pdo, $verlassenId, 'Alter Name (durch Revert wiederhergestellt)', '2026-01-01 00:00:00');

$lastSyncWrote = avesmapsTerritoryPlanLastSyncWrote($pdo);
assert($lastSyncWrote[$kuslikId]['new_name'] === 'Freie Stadt Kuslik', 'die NEUERE nicht-zurueckgenommene Zeile gewinnt, nicht irgendeine');
assert($lastSyncWrote[$trallenwaldId]['new_name'] === 'Baronie Trallenwald');
assert(!isset($lastSyncWrote[$verlassenId]), '💣 eine zurueckgenommene Zeile zaehlt NICHT als Beweis');
assert(!isset($lastSyncWrote[$baronieId]), 'kein Backup fuer die Baronie -- sie bekommt keine Zeile');

// --- avesmapsTerritoryPlanHandEditedFields: die reine Vergleichslogik ------------------------------

// Kuslik: live weicht vom letzten Schreiben ab (jemand hat umbenannt) -- UND ein Kontinent-Wechsel
// steht ebenfalls zur Debatte, der aber NIE erscheinen darf (keine Beweisgrundlage im Backup).
$edited = avesmapsTerritoryPlanHandEditedFields(
    [
        'name' => ['from' => 'Kuslik (von Hand umbenannt)', 'to' => 'Freie Stadt Kuslik'],
        'continent' => ['from' => 'Aventurien', 'to' => 'Myranor'],
    ],
    $lastSyncWrote[$kuslikId]
);
assert($edited === ['name'], 'Kuslik: nur "name" ist belegt, "continent" hat keine Beweisgrundlage');

// Trallenwald: live stimmt fuer JEDES betroffene Feld mit dem letzten Schreiben ueberein -- die
// vorgeschlagene Aenderung kommt aus dem Wiki, nicht von einer Hand. valid_to_bf traegt zusaetzlich die
// 9999-Falle: live "besteht noch" (from = null), das Backup schrieb ebenfalls "besteht noch" (9999 roh).
$edited = avesmapsTerritoryPlanHandEditedFields(
    [
        'name' => ['from' => 'Baronie Trallenwald', 'to' => 'Baronie Trallenwald (neuer Name im Wiki)'],
        'status' => ['from' => '', 'to' => 'aufgelöst'],
        'valid_to_bf' => ['from' => null, 'to' => 1020],
    ],
    $lastSyncWrote[$trallenwaldId]
);
assert($edited === [], '💣 kein Feld ist von Hand geaendert -- insbesondere nicht ueber die 9999-Falle bei valid_to_bf');

// Verlassen: kein Beweis (die einzige Zeile ist zurueckgenommen) -- trotz klar abweichendem Namen.
$edited = avesmapsTerritoryPlanHandEditedFields(
    ['name' => ['from' => 'Grafschaft Verlassen', 'to' => 'Grafschaft Verlassen (Wiki-Update)']],
    $lastSyncWrote[$verlassenId] ?? null
);
assert($edited === [], '💣 eine zurueckgenommene Zeile beweist nichts -- keine Markierung');

// Baronie: kein Backup ueberhaupt -- "der Abgleich hat sie nie geschrieben" ist kein Beweis fuer eine Hand.
$edited = avesmapsTerritoryPlanHandEditedFields(
    ['type' => ['from' => 'Baronie', 'to' => 'Freiherrschaft']],
    $lastSyncWrote[$baronieId] ?? null
);
assert($edited === [], 'kein Backup ueberhaupt => keine Markierung, nicht geraten');

echo "territory-plan (hand-edited) ok\n";

// =====================================================================================================
// TEIL 4 -- die Ausführ-Hälfte: Reihenfolge und positive Auswahl
// =====================================================================================================
//
// 💣 Die Reihenfolge der drei Schreiber ist tragend --------------------------------------------------
//
// Eltern zuerst (Wiki-Knoten), dann die eigenen Knoten (die legen an UND haengen ein), dann die Daten.
// Umgekehrt zeigte eine Eltern-Zuweisung auf einen eigenen Knoten, den es noch nicht gibt -- sie
// landete stillschweigend in `unresolved` statt zu wirken.
$apply = (string) file_get_contents(__DIR__ . '/../territory-plan-apply.php');
$order = [];
foreach (['ApplyParentCache', 'ApplyCustomNodes', 'ApplyIdentity'] as $writer) {
    $position = strpos($apply, 'avesmapsWikiSyncMonitor' . $writer . '(');
    assert($position !== false, "die Ausfuehr-Haelfte ruft {$writer}");
    $order[] = $position;
}
assert($order === array_values(array_filter($order)) && $order[0] < $order[1] && $order[1] < $order[2],
    '💣 Eltern -> eigene Knoten -> Daten');

// Und sie ruft sie POSITIV: kein Aufruf ohne only-Liste.
assert(!preg_match('/ApplyParentCache\(\s*\$pdo\s*,\s*\[\]\s*,\s*false\s*\)/', $apply),
    '💣 kein Aufruf ohne only -- das schriebe jede Divergenz mit');

// 💣 Der Bug, den written_keys behebt: der Aufruf von ApplyIdentity muss seinen Rueckgabewert
// tatsaechlich AUFFANGEN -- ein Aufruf, dessen Ergebnis verworfen wird, koennte written_keys nie lesen
// und liesse jede reine Datenzeile ungeprueft als "applied" durch (siehe task-6-report.md).
assert(
    (bool) preg_match('/\$identityResult\s*=\s*avesmapsWikiSyncMonitorApplyIdentity\(/', $apply),
    '💣 der Rueckgabewert von ApplyIdentity wird aufgefangen, nicht verworfen'
);
assert(str_contains($apply, "['written_keys']"), '💣 written_keys wird tatsaechlich gelesen');

// Beide Bulk-Schreiber, die einen `only`-Schluessel brauchen, sind auf IHRE EIGENE Liste gegated
// (Quality-Review-Fund 2, 2026-08-07): [] heisst zwar korrekt "waehle nichts", aber eine Seite reiner
// 'new'-Zeilen (erreichbar, weil die Rechen-Haelfte erst alle 'changed'-, dann alle 'new'-Zeilen
// einfuegt und der Leser nach aufsteigender id geht) fuehrte sonst drei No-op-SELECTs und ein
// No-op-UPDATE fuer nichts aus -- auf STRATO nicht kostenlos.
// ⚠️ Der Eltern-Schreiber laeuft seit dem Abdrift-Fix gegen $parentCacheKeys (= changedKeys ohne die
// Zeilen, deren Baum sich bewegt hat) -- die Bedingung ist dieselbe, nur auf der richtigen Liste.
assert(
    (bool) preg_match('/if\s*\(\s*\$parentCacheKeys\s*!==\s*\[\]\s*\)\s*\{\s*avesmapsWikiSyncMonitorApplyParentCache\(/', $apply),
    '💣 ApplyParentCache laeuft nur, wenn es tatsaechlich Schluessel gibt'
);

// 💣 Der Riegel, ohne den [] wieder „alles" hiesse: ApplyIdentity liest seit 2026-08-07 null als
// „keine Einschraenkung" und [] als „nichts" -- dieselbe Bedeutung wie SelectionClause. Die if-Zeile
// darf trotzdem nicht wegfallen; sie ist der Grund, warum eine reine Neu-Seite den Schreiber gar nicht
// erst anfasst.
assert(
    (bool) preg_match('/if\s*\(\s*\$changedKeys\s*!==\s*\[\]\s*\)\s*\{\s*\$identityResult\s*=\s*avesmapsWikiSyncMonitorApplyIdentity\(/', $apply),
    '💣 ApplyIdentity laeuft nur mit einer nicht-leeren Schluesselliste'
);
$identityFn = (string) file_get_contents(__DIR__ . '/../sync-monitor-identity.php');
assert(
    str_contains($identityFn, 'function avesmapsWikiSyncMonitorApplyIdentity(PDO $pdo, array $skip, ?array $only,'),
    '💣 die only-Liste ist NULLBAR -- null = keine Einschraenkung, [] = nichts, wie bei den Nachbarn'
);
assert(
    str_contains($identityFn, '$onlySet = $only === null ? null :'),
    '💣 und [] wird nicht mehr als „alles" gelesen'
);

// 💣 Die eigenen Knoten bekommen die Schluessel des GANZEN LAUFS, nicht die der aktuellen Seite:
// ApplyCustomNodes loest custom->custom in zwei Durchlaeufen ueber die Zeilen auf, die es bekommt.
// Mit der Seite als Welt verliert ein Kind auf Seite 6 den Elternteil, der auf Seite 7 entsteht --
// gemeldet als „uebernommen", und kein spaeterer Plan bietet es wieder an.
assert(
    (bool) preg_match(
        '/avesmapsWikiSyncMonitorApplyCustomNodes\(\s*\$pdo\s*,\s*false\s*,\s*avesmapsSyncPlanSelectedKeys\(\s*\$pdo\s*,\s*\$runId\s*,\s*\x27new\x27\s*\)\s*\)/',
        $apply
    ),
    '💣 ApplyCustomNodes bekommt alle angehaekelten Neu-Schluessel des Laufs'
);
assert(
    !preg_match('/avesmapsWikiSyncMonitorApplyCustomNodes\(\s*\$pdo\s*,\s*false\s*,\s*\$newKeys\s*\)/', $apply),
    'und nicht mehr die Seitenliste'
);

echo "territory-plan-apply (Reihenfolge) ok\n";

// =====================================================================================================
// TEIL 5 -- avesmapsTerritoryApplyClassifyChangedRow: JEDER Teil einer Zeile muss gelandet sein
// =====================================================================================================
//
// 💣 Quality-Review-Fund 1 (2026-08-07): eine 'changed'-Zeile kann eine Datenaenderung, einen
// Eltern-Umzug oder beides tragen. Ein ODER ueber beide Haelften liesse eine Kombi-Zeile, deren Daten
// geschrieben wurden, aber deren Elternteil noch abweicht, als VOLLSTAENDIG uebernommen melden -- ihr
// Skip-Zaehler wuerde geloescht, und die offene Haelfte stuende nirgends, bis jemand den Plan von Hand
// neu rechnet. Design §6f verlangt die Pruefung je ANGEBOTENER Aenderung, nicht je Zeile als Ganzes:
// „was nicht mehr passt, wird stale, bleibt stehen und wird hinterher genannt" -- deshalb jetzt ein UND.

// --- reine Datenzeile (kein Eltern-Umzug im Plan) ---------------------------------------------------
$result = avesmapsTerritoryApplyClassifyChangedRow(false, false, true, true);
assert($result === ['applied' => true, 'note' => ''], 'Daten geschrieben, kein Eltern-Umzug geplant => applied');

$result = avesmapsTerritoryApplyClassifyChangedRow(false, false, true, false);
assert($result['applied'] === false, '💣 Daten NICHT geschrieben => stale, nicht applied (der behobene Fehler)');
assert($result['note'] === 'Der Stand hat sich seit der Vorschau geändert.');

// --- reine Eltern-Zeile (keine Datenaenderung im Plan) ----------------------------------------------
$result = avesmapsTerritoryApplyClassifyChangedRow(true, false, false, false);
assert($result === ['applied' => true, 'note' => ''], 'Eltern-Umzug aufgeloest, keine Datenaenderung geplant => applied');

$result = avesmapsTerritoryApplyClassifyChangedRow(true, true, false, false);
assert($result['applied'] === false);
assert($result['note'] === 'Der Elternteil war nicht auflösbar.');

// --- Kombi-Zeile, beide Haelften gelandet -----------------------------------------------------------
$result = avesmapsTerritoryApplyClassifyChangedRow(true, false, true, true);
assert($result === ['applied' => true, 'note' => ''], 'beide Haelften einer Kombi-Zeile gelandet => applied');

// --- 💣 Kombi-Zeile, Fall 1: Daten geschrieben, Elternteil haengt fest ------------------------------
//
// Der Fall, den die Quality-Review konkret nannte: unter dem alten ODER waere das "applied" gewesen.
$result = avesmapsTerritoryApplyClassifyChangedRow(true, true, true, true);
assert($result['applied'] === false, '💣 nur EINE Haelfte einer Kombi-Zeile ist NICHT applied');
assert(
    $result['note'] === 'Die Daten wurden geschrieben, der Elternteil ließ sich nicht auflösen.',
    '💣 die Notiz nennt die Haelfte, die NICHT gelandet ist -- die Daten liefen still durch'
);

// --- 💣 Kombi-Zeile, Fall 2 (Spiegelfall): Elternteil uebernommen, Daten sind seit der Vorschau weg --
$result = avesmapsTerritoryApplyClassifyChangedRow(true, false, true, false);
assert($result['applied'] === false);
assert(
    $result['note'] === 'Der Elternteil wurde übernommen, die Daten ließen sich nicht mehr schreiben.',
    '💣 Spiegelfall: diesmal nennt die Notiz die Daten, der Elternteil lief still durch'
);

// --- Kombi-Zeile, beide Haelften weg -- der generische Hinweis, nichts Erfundenes ------------------
$result = avesmapsTerritoryApplyClassifyChangedRow(true, true, true, false);
assert($result['applied'] === false);
assert($result['note'] === 'Der Stand hat sich seit der Vorschau geändert.');

echo "territory-plan-apply (Klassifizierung) ok\n";

// =====================================================================================================
// TEIL 6 -- die Folgekette einer stale Kombi-Zeile: weder Skip noch Clear-Skip, nachgelesen im Code
// =====================================================================================================
//
// avesmapsTerritoryApplyFinish laeuft nicht unter sqlite (avesmapsEnsureSyncPlanTables ist echtes
// MySQL-DDL -- AUTO_INCREMENT, ENGINE=InnoDB, mehrspaltige KEY-Klauseln -- dieselbe seit Task 5
// dokumentierte Grenze). Diese Zeilen halten die Behauptung stattdessen als Zusicherung UEBER DEN
// QUELLTEXT fest, nachgezaehlt an sync-plan.php: RecordSkip/RecordDecline/ClearSkip aendern
// AUSSCHLIESSLICH sync_decision, niemals sync_plan_item.selected oder .apply_state -- und
// avesmapsSyncPlanMarkItem aendert NIE `selected`. Zusammen heisst das: eine stale Zeile bleibt
// selected=1 UND apply_state='stale', trifft in avesmapsTerritoryApplyFinish's Schleife keinen der drei
// Zweige (weder "!isSelected" noch "applied"), und ihr Skip-Zaehler (falls vorhanden) bleibt unberuehrt
// stehen -- das naechste Mal rechnet die Rechen-Haelfte ohnehin frisch vom Live-Stand, also erscheint
// nur noch die tatsaechlich offene Haelfte wieder.
$syncPlanSource = (string) file_get_contents(__DIR__ . '/../sync-plan.php');
assert(
    (bool) preg_match(
        '/function avesmapsSyncPlanRecordSkip.*?INSERT INTO sync_decision/s',
        $syncPlanSource
    ),
    'RecordSkip schreibt in sync_decision'
);
foreach (['avesmapsSyncPlanRecordSkip', 'avesmapsSyncPlanRecordDecline', 'avesmapsSyncPlanClearSkip'] as $fn) {
    if (preg_match('/function ' . $fn . '\(.*?\n\}/s', $syncPlanSource, $m)) {
        assert(
            !str_contains($m[0], 'sync_plan_item'),
            "💣 {$fn} fasst sync_plan_item nicht an -- nur sync_decision"
        );
    } else {
        assert(false, "{$fn} nicht gefunden");
    }
}
if (preg_match('/function avesmapsSyncPlanMarkItem\(.*?\n\}/s', $syncPlanSource, $m)) {
    assert(!str_contains($m[0], 'selected'), '💣 avesmapsSyncPlanMarkItem aendert selected NIE');
} else {
    assert(false, 'avesmapsSyncPlanMarkItem nicht gefunden');
}

echo "territory-plan-apply (Folgekette) ok\n";

// =====================================================================================================
// TEIL 7 -- die zwei Rechen-Aktionen haengen am Monitor-Endpunkt, nicht am Vorschau-Endpunkt (Task 8)
// =====================================================================================================
//
// Gerechnet wird an Schritt 1 und Schritt 3 des Menuebands; der Vorschau-Endpunkt liest, haekelt und
// uebernimmt. Zwei Tueren fuer dasselbe waeren zwei Stellen, an denen ein Lauf beginnen kann.
$monitor = (string) file_get_contents(__DIR__ . '/../../../edit/wiki/sync-monitor.php');
assert(str_contains($monitor, "'build_territory_wiki_plan' =>"), 'die Kopie rechnet hier');
assert(str_contains($monitor, "'build_territory_plan' =>"), 'die Karte auch');
assert(str_contains($monitor, 'territory-wiki-plan.php'), 'und die Datei ist geladen');
assert(str_contains($monitor, 'territory-plan.php'), 'die zweite ebenso');

// 💣 Beide Aktionen sind auf 'edit' gegated, nicht nur auf das 'review' des gesamten Endpunkts: das
// Rechnen LOEST den offenen Plan derselben Art ab, und das Blatt, das einen Plan liest/haekelt/uebernimmt
// (sync-plan.php), verlangt bereits 'edit'. Ohne den staerkeren Riegel hier koennte ein reines
// Review-Konto die offene Vorschau eines anderen Editors wegrechnen -- und saehe das Blatt, das den
// Verlust zeigt, nicht einmal.
assert(
    str_contains($monitor, "avesmapsRequireUserWithCapability('edit')"),
    "💣 die beiden Rechen-Aktionen sind auf 'edit' gegated, nicht nur auf das 'review' des Endpunkts"
);
assert(
    str_contains($monitor, "in_array(\$action, ['build_territory_wiki_plan', 'build_territory_plan'], true)"),
    '💣 beide Aktionen stehen in EINER Pruefung, nicht in zwei getrennten'
);
$editGatePos = strpos($monitor, "avesmapsRequireUserWithCapability('edit')");
$wikiArmPos = strpos($monitor, "'build_territory_wiki_plan' =>");
$mapArmPos = strpos($monitor, "'build_territory_plan' =>");
assert($editGatePos !== false && $wikiArmPos !== false && $mapArmPos !== false, 'alle drei Stellen existieren');
assert($editGatePos < $wikiArmPos && $editGatePos < $mapArmPos, '💣 der edit-Riegel steht VOR beiden Armen, nicht dahinter');

echo "territory-plan (Monitor-Endpunkt, Task 8) ok\n";

// =====================================================================================================
// TEIL 8 -- wer die Fakten aendert, zieht die Vorschau zurueck (Gesamtpruefung 2026-08-07)
// =====================================================================================================
//
// 💣 Eine Karten-Vorschau ist vollstaendig aus dem Live-Stand gerechnet. Wer den Baum umschreibt, ohne
// sie zurueckzuziehen, laesst eine Liste stehen, die einen Eltern-Umzug ZEIGT und einen anderen
// SCHREIBT -- der Schreiber nimmt den Elternteil, den das Modell jetzt nennt, und die Zeile meldet
// „uebernommen". Zwei Tueren fuehren zum Neurechnen des Baums, und beide muessen zumachen: die Kachel
// „2 · Hierarchie rechnen" (sync-monitor.php) und das Ende von „1 · 🚨 Syncen" (dump.php).
assert(
    (bool) preg_match(
        "/\\\$action === 'rebuild_model'.*?avesmapsSyncPlanSupersedeRuns\(\\\$pdo, 'territory'\)/s",
        $monitor
    ),
    "💣 rebuild_model zieht die offene Karten-Vorschau zurueck"
);
$dump = (string) file_get_contents(__DIR__ . '/../../../edit/wiki/dump.php');
assert(
    (bool) preg_match(
        "/avesmapsWikiSyncMonitorRebuildModel\(\\\$pdo\).*?avesmapsSyncPlanSupersedeRuns\(\\\$pdo, 'territory'\)/s",
        $dump
    ),
    '💣 und das Modell-Neurechnen am Ende von „Syncen" ebenso'
);
// ⚠️ Serverseitig, nicht im Browser: eine Zurueckziehung im JavaScript liesse jeden anderen Weg
// (zweiter Reiter, Dump-Endpunkt, geplanter Lauf) die alte Liste behalten. In der Oberflaeche steht
// deshalb nur die Statusabfrage -- und der Zustandsname taucht dort nirgends auf.
$monitorPage = (string) file_get_contents(__DIR__ . '/../../../../html/wiki-sync-monitor.html');
assert(
    !str_contains($monitorPage, 'superseded'),
    '⚠️ die Oberflaeche zieht nichts selbst zurueck -- sie fragt nur den Stand ab'
);
assert(
    (bool) preg_match("/rebuild_model.*?await refreshPlanStatus\(\)/s", $monitorPage),
    'sie holt sich nach dem Hierarchie-Rechnen den neuen Stand'
);

echo "territory-plan (Vorschau zurueckziehen) ok\n";

// =====================================================================================================
// TEIL 9 -- „Werte festhalten": zwei Vokabulare fuer dieselben Felder
// =====================================================================================================
//
// 💣 Von jeder Seite allein ist der Bruch unsichtbar. pin_fields traegt die Schluessel des
// Identitaets-Vergleichs (Sprache von political_territory: valid_from_bf / valid_to_bf); die
// Override-Erlaubnisliste kennt die Schluessel des Wiki-Datensatzes (founded_start_bf /
// dissolved_end_bf). Ungemappt wirft set_field_override „Feld ... ist nicht editierbar." -- bei den
// haeufigsten Feldern dieses Bestands, und die Schleife schreibt der Reihe nach, also bliebe eine
// Zeile mit „name, valid_to_bf" halb festgehalten.
//
// Beide Listen werden GELESEN, nicht abgeschrieben: eine abgeschriebene Liste bleibt gruen, wenn eine
// der beiden Seiten ein Feld dazubekommt.
preg_match('/\$fieldCounts = \[([^\]]*)\]/', $identityFn, $fieldCountsMatch);
preg_match_all("/'([a-z_]+)' => 0/", $fieldCountsMatch[1] ?? '', $pinnableMatch);
$pinnable = $pinnableMatch[1] ?? [];
assert(count($pinnable) === 6, 'die sechs vergleichbaren Felder wurden gefunden (' . count($pinnable) . ')');
assert(in_array('valid_to_bf', $pinnable, true), 'darunter die Gueltigkeit -- der haeufigste Fall');

preg_match('/const PIN_FIELD_OVERRIDE_KEYS = \{([^}]*)\}/', $monitorPage, $pinMapMatch);
preg_match_all("/([a-z_]+)\s*:\s*'([a-z_]+)'/", $pinMapMatch[1] ?? '', $pinPairs, PREG_SET_ORDER);
$pinMap = [];
foreach ($pinPairs as $pair) {
    $pinMap[$pair[1]] = $pair[2];
}
assert($pinMap !== [], 'die Zuordnung der Oberflaeche wurde gefunden');

$editable = avesmapsWikiSyncMonitorEditableFields();
foreach ($pinnable as $field) {
    $target = $pinMap[$field] ?? $field;
    assert(
        isset($editable[$target]),
        "💣 Werte festhalten schickt {$field} als {$target} -- und set_field_override kennt das nicht"
    );
}
assert($pinMap['valid_from_bf'] === 'founded_start_bf', 'gegruendet heisst dort founded_start_bf');
assert($pinMap['valid_to_bf'] === 'dissolved_end_bf', 'und aufgeloest dissolved_end_bf');
// Gegenprobe zur Behauptung „die Werte passen ohne Umrechnung": '' liest der Override-Leser als
// „besteht" -- genau das, was die Vorschau aus dem 9999-Sentinel macht.
assert(
    str_contains($identityFn, "if (array_key_exists('dissolved_end_bf', \$ov)) {"),
    'der Override-Leser fragt genau diesen Schluessel'
);
assert(
    (bool) preg_match("/array_key_exists\('dissolved_end_bf', \\\$ov\).*?return \\\$t === '' \? null :/s", $identityFn),
    '💣 und liest die leere Zeichenkette als null = besteht -- deshalb braucht der Wert keine Umrechnung'
);

// Und der Aufrufer faengt seinen eigenen Wurf ab: api() antwortet nicht mit ok:false, es wirft.
preg_match('/async function pinValues\(.*?\n\}/s', $monitorPage, $pinFn);
assert(($pinFn[0] ?? '') !== '', 'pinValues wurde gefunden');
assert(str_contains($pinFn[0], 'try {') && str_contains($pinFn[0], 'catch(e)'),
    '💣 pinValues faengt den Wurf von api() ab -- sonst verlaesst er die async-Funktion wortlos');
assert(!str_contains($pinFn[0], 'result.ok === false'),
    'und prueft keinen Rueckgabewert mehr, den es nie gibt (toter Code)');

echo "territory-plan (Werte festhalten) ok\n";

// =====================================================================================================
// TEIL 10 -- der Baum kann sich unter einer offenen Vorschau bewegen (Nachpruefung 2026-08-07)
// =====================================================================================================
//
// 💣 Ein Zug im Baum schreibt wiki_territory_model.parent_wiki_key -- genau die Quelle, aus der
// avesmapsTerritoryPlanParentMoves die Zeile gerechnet hat. Zurueckgezogen wird die Vorschau dabei
// NICHT (Entwurf §9: die Kuratierung bleibt unangetastet, und ein Zug darf nicht die Haekchen eines
// ganzen Laufs vernichten). Also muss die UEBERNAHME pruefen -- und $parentStill kann das nicht: es
// fragt nur, OB noch eine Abweichung besteht, und nach dem Schreiben besteht keine, egal welcher
// Elternteil gesetzt wurde. Die Zeile sagte "A -> B", geschrieben wurde C, gemeldet wurde "applied".

// --- avesmapsTerritoryApplyParentDrift: versprochen gegen heute ------------------------------------
$drift = avesmapsTerritoryApplyParentDrift(
    ['wiki:baronie-a' => 'wiki:grafschaft-b', 'wiki:baronie-c' => 'wiki:grafschaft-d'],
    ['wiki:baronie-a' => 'wiki:grafschaft-b', 'wiki:baronie-c' => 'wiki:grafschaft-d']
);
assert($drift === [], 'unveraendertes Modell => kein Abdriften');

$drift = avesmapsTerritoryApplyParentDrift(
    ['wiki:baronie-a' => 'wiki:grafschaft-b'],
    ['wiki:baronie-a' => 'wiki:grafschaft-c']
);
assert($drift === ['wiki:baronie-a' => 'wiki:grafschaft-c'],
    '💣 gezogen seit der Vorschau -- und der Befund nennt, wohin');

$drift = avesmapsTerritoryApplyParentDrift(['wiki:baronie-a' => 'wiki:grafschaft-b'], []);
assert($drift === ['wiki:baronie-a' => ''], 'aus dem Modell genommen => Wurzel, und das ist auch ein Abdriften');

// ⚠️ Eine Zeile OHNE versprochenen Schluessel (ein Plan von vor dieser Pruefung) wird nicht markiert:
// ueber sie laesst sich nichts sagen, und erfundenes Abdriften strandete Zeilen, die niemand mehr
// uebernehmen kann.
$drift = avesmapsTerritoryApplyParentDrift(['wiki:baronie-a' => ''], ['wiki:baronie-a' => 'wiki:irgendwas']);
assert($drift === [], 'ohne versprochenen Schluessel keine Behauptung');

// --- Der Satz dazu --------------------------------------------------------------------------------
$note = avesmapsTerritoryApplyParentDriftNote(false, false, 'Grafschaft Ragath');
assert(str_contains($note, 'Grafschaft Ragath'), 'der Satz nennt den neuen Elternteil');
assert(str_contains($note, 'nicht gesetzt'), 'und sagt, dass nichts geschrieben wurde');
$note = avesmapsTerritoryApplyParentDriftNote(true, true, 'Grafschaft Ragath');
assert(str_contains($note, 'Daten wurden geschrieben'), '💣 die Datenhaelfte laeuft unabhaengig und wird genannt');
$note = avesmapsTerritoryApplyParentDriftNote(false, false, '');
assert(str_contains($note, 'keinen Elternteil mehr'), 'und die Wurzel wird als Wurzel benannt, nicht als leere Klammer');

// --- 💣 Und die Ausfuehr-Haelfte handelt danach ----------------------------------------------------
//
// Der Schreiber bekommt die BEREINIGTE Liste (Entwurf §6a: was nach der Vorschau entsteht, wird nicht
// geschrieben), und die Zeile wird davor als stale markiert -- nicht danach, wo sie schon geschrieben waere.
assert(
    (bool) preg_match('/if\s*\(\s*\$parentCacheKeys\s*!==\s*\[\]\s*\)\s*\{\s*avesmapsWikiSyncMonitorApplyParentCache\(\s*\$pdo\s*,\s*\[\]\s*,\s*false\s*,\s*\$parentCacheKeys\s*\)/', $apply),
    '💣 der Eltern-Schreiber bekommt die um die abgedrifteten Zeilen bereinigte Liste'
);
assert(
    !preg_match('/avesmapsWikiSyncMonitorApplyParentCache\(\s*\$pdo\s*,\s*\[\]\s*,\s*false\s*,\s*\$changedKeys\s*\)/', $apply),
    'und nicht mehr alle geaenderten Schluessel'
);
$driftPos = strpos($apply, 'avesmapsTerritoryApplyParentDrift($promisedParents, $modelParents)');
$writerPos = strpos($apply, 'avesmapsWikiSyncMonitorApplyParentCache($pdo, [], false, $parentCacheKeys)');
assert($driftPos !== false && $writerPos !== false, 'beide Stellen existieren');
assert($driftPos < $writerPos, '💣 gerechnet wird VOR dem Schreiben -- danach waere die Zeile schon geschrieben');
assert(
    (bool) preg_match('/if\s*\(\s*\$hasParentMove\s*&&\s*array_key_exists\(\$key, \$parentDrift\)\s*\)/', $apply),
    'und die Zeile wird als stale gemeldet'
);
// Der Schluessel muss auch tatsaechlich in der Planzeile stehen, sonst prueft das alles nichts.
$planSource = (string) file_get_contents(__DIR__ . '/../territory-plan.php');
assert(
    str_contains($planSource, "\$rows[\$wikiKey]['after']['parent_key'] = \$move['new_key'];"),
    '💣 die Rechen-Haelfte legt den Elternschluessel in die Zeile -- der NAME taugt nicht als Schluessel'
);
// Und im Bauteil ist er stumm, sonst stuende der rohe Schluessel als zweite Zeile in der Liste.
$sheet = (string) file_get_contents(__DIR__ . '/../../../../js/review/sync-plan-sheet.js');
assert(
    (bool) preg_match('/SYNC_PLAN_SILENT_FIELDS = \[[^\]]*"parent_key"/', $sheet),
    '💣 parent_key ist im Bauteil ein stummes Feld'
);

// --- Die Datenhaelfte haengt nicht mehr an pin_fields ----------------------------------------------
//
// 💣 Seit pin_fields gefiltert wird (Teil 11), ist seine Anwesenheit kein Beweis mehr fuer "diese Zeile
// schlaegt Datenaenderungen vor": eine Zeile, deren einzige Aenderung ein leeres Gruendungsjahr ist,
// traegt gar keine pin_fields. Sie faellt sonst still aus der written_keys-Pruefung.
assert(
    str_contains($apply, "\$hasDataChange = array_diff(array_keys(\$before), ['parent']) !== [];"),
    '💣 die Datenhaelfte kommt aus before_json, nicht aus pin_fields'
);

echo "territory-plan-apply (Baum-Abdriften) ok\n";

// =====================================================================================================
// TEIL 11 -- „festgehalten" muss stimmen
// =====================================================================================================
//
// 💣 Ein LEERES Gruendungsjahr laesst sich nicht festhalten: das effektive Jahr wird vererbt und faellt
// am Ende auf 0, waehrend live NULL steht -- kein Override-Wert stellt diese Zeile still. Der Knopf
// sagte trotzdem "festgehalten". Also wird das Feld gar nicht erst angeboten.
assert(
    avesmapsTerritoryPlanPinnableFields(['name' => 'Alt', 'valid_from_bf' => '']) === ['name'],
    '💣 ein leeres Gruendungsjahr wird nicht zum Festhalten angeboten'
);
assert(
    avesmapsTerritoryPlanPinnableFields(['name' => 'Alt', 'valid_from_bf' => '720']) === ['name', 'valid_from_bf'],
    '⚠️ ein GEFUELLTES sehr wohl -- die Ausnahme haengt am Wert, nicht am Feldnamen'
);
assert(
    avesmapsTerritoryPlanPinnableFields(['valid_to_bf' => '']) === ['valid_to_bf'],
    'das leere Aufloesungsjahr bleibt: dort ist "" = besteht, ein gueltiger eigener Wert'
);
assert(avesmapsTerritoryPlanPinnableFields([]) === [], 'nichts geaendert => nichts anzubieten');
// Und die Rechen-Haelfte benutzt den Filter auch.
assert(
    str_contains($planSource, "'pin_fields' => avesmapsTerritoryPlanPinnableFields(\$before),"),
    '💣 der Plan schreibt die gefilterte Liste, nicht array_keys($before)'
);

echo "territory-plan (nur Festhaltbares anbieten) ok\n";
