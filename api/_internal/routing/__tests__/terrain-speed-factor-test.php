<?php
// api/_internal/routing/__tests__/terrain-speed-factor-test.php
declare(strict_types=1);

/**
 * Schritt 2 der Tempowerte: die Landschaftsfaktoren als eigene Spalte, der Byte-Maßstab und der Lader.
 * Entwurf: docs/superpowers/specs/2026-08-07-tempowerte-design.md §6, §7.
 *
 * 💣 DIE FAKTOREBENE TRÄGT EINEN FAKTOR ALS EIN BYTE. Bei Maßstab 50 liegt der Deckel bei 5,10 — und
 * der Sumpf ergibt in der Multiplikator-Lesart 0,75 ÷ 0,10 = 7,50. Er würde stillschweigend
 * gedeckelt und wäre 32 % zu schnell: kein Fehler, keine Warnung, nur eine falsche Reisezeit.
 * Dieser Test ist beim alten Maßstab rot.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/routing/__tests__/terrain-speed-factor-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../offroad-grid.php';

$nah = static fn(float $a, float $b, float $eps): bool => abs($a - $b) < $eps;

// ============================================================ A. Der Byte-Maßstab

// Die Kiste und EIN Rechteck, das sie ganz ausfüllt — die Ebene trägt dann überall denselben Faktor.
$box = avesmapsBuildOffroadBox(1.0, 1.0, 9.0, 9.0);
$feld = static function (float $factor) use ($box): array {
    $ring = [[-100.0, -100.0], [200.0, -100.0], [200.0, 200.0], [-100.0, 200.0], [-100.0, -100.0]];

    return [[
        'prepared' => avesmapsPrepareRouteAreas([[
            'geometry' => ['type' => 'Polygon', 'coordinates' => [$ring]],
            'min_x' => -100.0, 'min_y' => -100.0, 'max_x' => 200.0, 'max_y' => 200.0,
        ]]),
        'factor' => $factor,
    ]];
};

// Die Auflösung ist 1 ÷ Maßstab; ein Wert darf höchstens darum danebenliegen.
$aufloesung = 1.0 / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE;

// 🔴 DER SUMPF IST DER GRUND FÜR DIESEN GANZEN TEST. 0,75 ÷ 0,10 = 7,50.
$sumpf = avesmapsOffroadFactorAt($box, avesmapsOffroadRasteriseFactors($box, $feld(7.50)), 5.0, 5.0);
assert(
    $nah($sumpf, 7.50, $aufloesung),
    'Sumpf-Multiplikator 7,50 kommt aus der Faktorebene zurueck, bekommen: ' . $sumpf
    . ' -- bei Maszstab 50 ist der Deckel 5,10 und der Sumpf 32 % zu schnell'
);

// Die uebrigen GA-Landschaften, jede als Multiplikator 0,75 ÷ Faktor.
foreach ([
    'gebirge/dschungel 0,20' => 3.75,
    'wald/wueste 0,50'       => 1.50,
    'tundra 0,70'            => 1.0714285714,
    'schlucht (abgeleitet)'  => 2.604,
] as $name => $multiplikator) {
    $zurueck = avesmapsOffroadFactorAt($box, avesmapsOffroadRasteriseFactors($box, $feld($multiplikator)), 5.0, 5.0);
    assert($nah($zurueck, $multiplikator, $aufloesung), "$name: $multiplikator kam als $zurueck zurueck");
}

// Der Deckel selbst, als Aussage statt als Nebenwirkung: 255 Byte-Stufen mal die Auflösung.
$deckel = 255.0 / AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE;
assert($deckel >= 7.50, 'der Deckel der Faktorebene traegt den Sumpf: ' . $deckel);
// ⚠️ Und er ist nicht beliebig gross: ein Byte je Zelle ist die ganze Sparsamkeit dieser Ebene
// (33,2 gegen 1 Byte je Zelle), also wird der Maszstab nur so weit gesenkt, wie die Quelle es
// verlangt. Bei 25 bleibt die Aufloesung 0,04 -- fein genug fuer Faktoren zwischen 1,0 und 7,5.
assert($aufloesung <= 0.05, 'die Aufloesung bleibt feiner als 0,05: ' . $aufloesung);

// ============================================================ B. Der Plan der Migration (rein)

require_once __DIR__ . '/../travel-values-migration.php';

// Der Bezug, gegen den jeder Landschaftsfaktor gemessen wird: die GA-Zeile „offenes Gelaende".
$basis = avesmapsTravelValuesOffroadBaseFactor();
assert($basis === 0.75, 'die Basis ist die Querfeldein-Zeile der GA: ' . $basis);

// Die Arten, so wie sie live stehen: Schluessel, Ebene und der heute gesaete offroad_factor.
$arten = [
    ['topographie', 'gebirge', 2.20], ['topographie', 'see', 1.00], ['topographie', 'meer', 1.00],
    ['topographie', 'kueste', 1.00], ['topographie', 'huegelland', 1.30], ['topographie', 'wadi', 1.50],
    ['topographie', 'schlucht', 2.60], ['topographie', 'hochebene', 1.10], ['topographie', 'tiefebene', 1.00],
    ['topographie', 'tal', 1.00], ['topographie', 'flussdelta', 2.00], ['topographie', 'insel', 1.00],
    ['vegetation', 'wald', 1.40], ['vegetation', 'suempfe_moore', 3.00], ['vegetation', 'steppe', 1.10],
    ['vegetation', 'tundra', 1.30], ['vegetation', 'auenlandschaft', 1.30], ['vegetation', 'wueste', 1.60],
    ['vegetation', 'graslandschaft', 1.05], ['vegetation', 'flussland_flusstal', 1.00],
    ['vegetation', 'dschungel', 2.40], ['vegetation', 'wuestenoase', 1.00],
    // Die drei Ebenen, die KEINEN Bodenfaktor tragen -- sie duerfen im Plan nicht auftauchen.
    ['derographisch', 'region', 1.00], ['derographisch', 'kontinent', 1.00], ['klima', 'polar', 1.00],
];
$zeilen = array_map(
    static fn(array $a): array => ['kind' => $a[0], 'type_key' => $a[1], 'offroad_factor' => $a[2]],
    $arten
);

$plan = avesmapsTravelValuesMigrationPlan($zeilen, ['grid' => AVESMAPS_ROUTE_CLIENT_SPEED_TABLE]);
$faktoren = [];
foreach ($plan['factors'] as $eintrag) { $faktoren[$eintrag['type_key']] = $eintrag['factor']; }

// --- B1. Die NEUN mit Quellenzeile stehen auf ihrem GA-Wert, egal was ihr offroad_factor sagt.
foreach ([
    'wald' => 0.500, 'suempfe_moore' => 0.100, 'dschungel' => 0.200, 'wueste' => 0.500,
    'tundra' => 0.700, 'steppe' => 0.750, 'graslandschaft' => 0.750, 'gebirge' => 0.200,
    'huegelland' => 0.750,
] as $schluessel => $erwartet) {
    assert(isset($faktoren[$schluessel]), "$schluessel fehlt im Plan");
    assert($nah($faktoren[$schluessel], $erwartet, 0.0005), "$schluessel: {$faktoren[$schluessel]} statt $erwartet");
}

// 🪤 `graslandschaft`, NICHT `grasland`. Der Schluessel in der GA-Tafel hiess bis zum 14.08.2026
// `grasland` und traf damit keine einzige Zeile der Datenbank -- die Art waere still in den
// Verhaeltnis-Zweig gefallen (0,75 ÷ 1,05 = 0,714 statt 0,750). Ein Tippfehler, den nur diese
// Zusicherung sichtbar macht.
assert(isset(avesmapsTravelValuesSourceTable()['landscapes']['graslandschaft']),
    'die GA-Tafel kennt die Graslandschaft unter dem Schluessel der Datenbank');

// --- B2. Die ELF ohne Quellenzeile behalten ihr VERHAELTNIS, nicht ihre Geschwindigkeit.
foreach ([
    'wadi' => 0.500,        // 0,75 ÷ 1,50
    'schlucht' => 0.288,    // 0,75 ÷ 2,60
    'flussdelta' => 0.375,  // 0,75 ÷ 2,00
    'auenlandschaft' => 0.577,
    'hochebene' => 0.682,
    'kueste' => 0.750, 'tal' => 0.750, 'tiefebene' => 0.750, 'insel' => 0.750, 'wuestenoase' => 0.750,
] as $schluessel => $erwartet) {
    assert(isset($faktoren[$schluessel]), "$schluessel fehlt im Plan");
    assert($nah($faktoren[$schluessel], $erwartet, 0.0005), "$schluessel: {$faktoren[$schluessel]} statt $erwartet");
}

// 💣 DIE ZUSICHERUNG, WEGEN DER DIE REGEL „Verhaeltnis" UND NICHT „verhaltensgleich" HEISST.
// `flussland_flusstal` (15 Flaechen) steht auf offroad_factor 1,00, bremst also nicht. Wer seine
// heutige ABSOLUTE Geschwindigkeit einfroere, liesse es bei 0,96 Meilen/h stehen, waehrend der
// ungezeichnete Boden daneben auf 2,30 geht -- eine gezeichnete Aue waere ein Hindernis, WEIL
// jemand sie gezeichnet hat.
assert($nah($faktoren['flussland_flusstal'], 0.750, 0.0005),
    'eine Aue ohne Bremswirkung ist genau so schnell wie offener Boden: ' . $faktoren['flussland_flusstal']);

// --- B3. Wasser und die fremden Ebenen bekommen KEINE Zeile.
// 💣 Das Meer sperrt V13, es bremst nicht. Ein Bodenfaktor auf `meer` waere eine zweite, leisere
// Antwort auf dieselbe Frage -- und die beiden liefen auseinander.
foreach (['see', 'meer', 'region', 'kontinent', 'polar'] as $schluessel) {
    assert(!isset($faktoren[$schluessel]), "$schluessel darf keinen Bodenfaktor bekommen");
}
assert(count($plan['factors']) === 20,
    'zwanzig Landschaftsarten tragen einen Bodenfaktor, bekommen: ' . count($plan['factors'])
    . ' -- kommt eine Art dazu, ist das hier die Stelle, an der jemand ueber ihren Wert nachdenkt');

// --- B4. Das Raster: NUR die Querfeldein-Spalte wandert.
$raster = $plan['grid'];
// 🔴 Werte vom 16.08.2026: Reisetag an Land 8 statt 12 Stunden (WdE S. 160-162). Die Tagesleistung
// dahinter ist unveraendert (Fussgruppe 30 Meilen), nur der Nenner der Formel hat gewechselt.
foreach (['groupFoot' => 3.45, 'lightWalker' => 4.61, 'groupHorse' => 4.03,
          'lightRider' => 5.76, 'caravan' => 3.45, 'horseCarriage' => 5.76] as $mittel => $erwartet) {
    // ⚠️ Toleranz 0,02 statt 0,005: die Migration rechnet 0,75 x die GERUNDETE Strassenzelle, der
    // Ruecksetzer 0,75 x den ungerundeten Formelwert. Das trennt beide um bis zu einen Cent
    // (4,61 x 0,75 = 3,4575 -> 3,46 gegen 4,6053 x 0,75 = 3,4540 -> 3,45). Geprueft wird „0,75 der
    // Strasse", nicht die zweite Nachkommastelle -- die zu pruefen hiesse, eine Doppelrundung zur
    // Regel zu erklaeren.
    assert($nah((float) $raster[$mittel]['Querfeldein'], $erwartet, 0.02),
        "$mittel querfeldein: {$raster[$mittel]['Querfeldein']} statt $erwartet");
}
// ⚠️ Und sonst KEINE Zelle. „Ein Deploy, der jede Reisezeit auf jeder Strasse verschiebt, ist keine
// Nebenwirkung eines Wald-Features" (Entwurf §5). Die Wegtypen setzt erst ein Klick im Fenster zurueck.
foreach (AVESMAPS_ROUTE_CLIENT_SPEED_TABLE as $mittel => $zeile) {
    foreach ($zeile as $wegtyp => $wert) {
        if ($wegtyp === 'Querfeldein') { continue; }
        assert($raster[$mittel][$wegtyp] === $wert, "$mittel/$wegtyp wurde angefasst und durfte nicht");
    }
}

// ============================================================ C. Die Migration gegen sqlite

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: der pdo_sqlite-Treiber fehlt -- erneut mit -d extension=php_pdo_sqlite.dll\n");
    exit(2);
}

require_once __DIR__ . '/../../app/ecosystem.php';

// Die gesaeten offroad_factor-Werte, wortgleich aus avesmapsEcosystemEnsureTables (ecosystem.php).
$offroad = [
    'gebirge' => 2.20, 'huegelland' => 1.30, 'schlucht' => 2.60, 'wadi' => 1.50, 'hochebene' => 1.10,
    'flussdelta' => 2.00, 'wald' => 1.40, 'dschungel' => 2.40, 'suempfe_moore' => 3.00,
    'wueste' => 1.60, 'tundra' => 1.30, 'auenlandschaft' => 1.30, 'steppe' => 1.10,
    'graslandschaft' => 1.05,
];

$frischeAnlage = static function () use ($offroad): PDO {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE ecosystem_region_type (
        kind TEXT, type_key TEXT, label TEXT, sort_order INT, is_active INT DEFAULT 1,
        offroad_factor REAL NOT NULL DEFAULT 1.00, terrain_speed_factor REAL DEFAULT NULL)');
    $pdo->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT)');

    // „Leere Tabelle -> Saat": die echte Saatliste, damit eine neue Landschaftsart hier auftaucht.
    $insert = $pdo->prepare('INSERT INTO ecosystem_region_type
        (kind, type_key, label, sort_order, offroad_factor) VALUES (?, ?, ?, ?, ?)');
    foreach (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED as [$kind, $typeKey, $label, $sortOrder]) {
        $insert->execute([$kind, $typeKey, $label, $sortOrder, $offroad[$typeKey] ?? 1.00]);
    }

    return $pdo;
};

$spalte = static function (PDO $pdo): array {
    $werte = [];
    foreach ($pdo->query('SELECT type_key, terrain_speed_factor FROM ecosystem_region_type')
                 ->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $werte[(string) $zeile['type_key']] = $zeile['terrain_speed_factor'];
    }

    return $werte;
};

// --- C1. Saat -> Migration: die einundzwanzig bekommen ihren Wert, alles andere bleibt NULL.
$pdo = $frischeAnlage();
$plan = avesmapsTravelValuesPlanFromDatabase($pdo);
assert($plan !== null, 'auf einer gesaeten Tabelle findet die Migration ihre Arten');
$geschrieben = avesmapsTravelValuesWriteLandscapeFactors($pdo, $plan['factors']);
// 21 seit dem 16.08.2026: die Kulturlandschaft kam als elfte Vegetationsart dazu (Idee #77).
assert($geschrieben === 21, "einundzwanzig Zeilen geschrieben, bekommen: $geschrieben");

$nachher = $spalte($pdo);
assert($nah((float) $nachher['suempfe_moore'], 0.100, 0.0005), 'Sumpf 0,100: ' . $nachher['suempfe_moore']);
assert($nah((float) $nachher['wald'], 0.500, 0.0005), 'Wald 0,500: ' . $nachher['wald']);
assert($nah((float) $nachher['wadi'], 0.500, 0.0005), 'Wadi 0,500 (0,75 ÷ 1,50): ' . $nachher['wadi']);
assert($nah((float) $nachher['graslandschaft'], 0.750, 0.0005),
    'Graslandschaft 0,750 aus der Quelle, NICHT 0,714 aus dem Verhaeltnis: ' . $nachher['graslandschaft']);

// 🔴 DIE KULTURLANDSCHAFT BREMST NICHT, und zwar auf beiden Wegen dorthin (Owner 16.08.2026:
// „normal, querfeldein is immer bisschen langsamer … nur nicht so wie wald oder dschungel").
// Auf einer FRISCHEN Anlage laeuft die Migration und schreibt ihr genau die Basis 0,750: sie hat
// keine GA-Zeile, also greift der Verhaeltniszweig, und ihr offroad_factor ist die Vorgabe 1,00.
// Auf der LIVE-Datenbank ist die Migration laengst durch (Merker app_setting['travel_values_v1']),
// dort bleibt die Zeile NULL. Beides ist dasselbe Verhalten: avesmapsOffroadLoadFactorPlane laedt
// nur Arten mit `terrain_speed_factor IS NOT NULL AND < :base`, und 0,750 ist nicht kleiner als
// 0,750. Wer ihr spaeter einen offroad_factor gibt, macht sie hier lautlos zur Bremse -- diese
// Zusicherung ist die Stelle, die das meldet.
assert($nah((float) $nachher['kulturlandschaft'], 0.750, 0.0005),
    'Kulturlandschaft genau auf offenem Boden: ' . $nachher['kulturlandschaft']);

// 🔴 Wasser, Regionen und Klimabaender bleiben ohne Aussage.
foreach (['see', 'meer', 'region', 'kontinent', 'polar', 'tropisch'] as $schluessel) {
    assert($nachher[$schluessel] === null, "$schluessel bleibt NULL, steht aber auf " . var_export($nachher[$schluessel], true));
}

// --- C2. Ein von Hand nachgeschaerfter Wert ueberlebt einen zweiten Lauf.
// 💣 DAS IST DER GRUND FUER DEN EIGENEN MERKER. Wuerde die Migration an „wurde eine Spalte angelegt"
// haengen, faehre sie bei der naechsten Schemaaenderung ein zweites Mal ueber jede Entscheidung.
$pdo2 = $frischeAnlage();
$plan2 = avesmapsTravelValuesPlanFromDatabase($pdo2);
avesmapsTravelValuesWriteLandscapeFactors($pdo2, $plan2['factors']);
$pdo2->exec("UPDATE ecosystem_region_type SET terrain_speed_factor = 0.222 WHERE type_key = 'wald'");
$zweiterLauf = avesmapsTravelValuesWriteLandscapeFactors($pdo2, $plan2['factors']);
assert($zweiterLauf === 0, "ein zweiter Lauf schreibt nichts mehr, schrieb aber $zweiterLauf Zeilen");
assert($nah((float) $spalte($pdo2)['wald'], 0.222, 0.0005),
    'der Wert des Owners steht noch: ' . $spalte($pdo2)['wald']);

// --- C3. Der Merker riegelt die ganze Migration ab.
$pdo3 = $frischeAnlage();
$pdo3->prepare('INSERT INTO app_setting (setting_key, setting_value) VALUES (?, ?)')
    ->execute([AVESMAPS_TRAVEL_VALUES_MIGRATION_KEY, '1']);
assert(avesmapsTravelValuesMigrateOnce($pdo3) === false, 'bei gesetztem Merker laeuft sie nicht');
foreach ($spalte($pdo3) as $schluessel => $wert) {
    assert($wert === null, "$schluessel wurde trotz Merker beschrieben");
}

// --- C4. Eine leere Artentabelle setzt den Merker NICHT.
// 🔴 Befund A35, woertlich: liefe die Migration VOR der Saat, faende sie null Zeilen, setzte trotzdem
// ihren Merker und waere fuer immer erledigt, ohne je etwas getan zu haben.
$leer = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$leer->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, offroad_factor REAL, terrain_speed_factor REAL)');
$leer->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT)');
assert(avesmapsTravelValuesMigrateOnce($leer) === false, 'ohne Arten laeuft sie nicht');
$merkerZaehler = $leer->prepare('SELECT COUNT(*) FROM app_setting WHERE setting_key = ?');
$merkerZaehler->execute([AVESMAPS_TRAVEL_VALUES_MIGRATION_KEY]);
assert((int) $merkerZaehler->fetchColumn() === 0,
    'und sie setzt dabei keinen Merker -- sonst waere sie fuer immer erledigt, ohne etwas getan zu haben');

// ============================================================ D. Die Reihenfolge in EnsureTables

// 💣 DREI BEDINGUNGEN AUS BEFUND A35, UND ALLE DREI MUESSEN HALTEN. Sie stehen in der Reihenfolge von
// Anweisungen in einer Funktion, nicht in Daten -- pruefbar ist deshalb der Quelltext selbst. Genau
// so wurde die Falle „DDL committet still" schon einmal ohne Datenbank nachgewiesen: die Reihenfolge
// der Zeilennummern beantwortet die Frage.
$quelle = (string) file_get_contents(__DIR__ . '/../../app/ecosystem.php');
$start = strpos($quelle, 'function avesmapsEcosystemEnsureTables(PDO $pdo): void');
assert($start !== false, 'avesmapsEcosystemEnsureTables ist auffindbar');
// Bis zur naechsten Funktion auf Spaltenanfang -- das ist der Rumpf.
$ende = strpos($quelle, "\nfunction ", $start + 10);
$rumpf = substr($quelle, $start, ($ende === false ? strlen($quelle) : $ende) - $start);

$stelle = static function (string $nadel) use ($rumpf): int {
    $position = strpos($rumpf, $nadel);
    assert($position !== false, "in avesmapsEcosystemEnsureTables fehlt: $nadel");

    return (int) $position;
};

$saat = $stelle('avesmapsEcosystemSeedRegionTypes($pdo);');
$suedschluessel = $stelle("ALTER TABLE ecosystem_climate_divider ADD COLUMN south_type_key");
$spalteNeu = $stelle("ALTER TABLE ecosystem_region_type ADD COLUMN terrain_speed_factor");
$migration = $stelle('avesmapsTravelValuesMigrateOnce($pdo);');

// D1 -- der south_type_key-Nachtrag bleibt VOR der Saat.
assert($suedschluessel < $saat, 'der south_type_key-Nachtrag steht vor avesmapsEcosystemSeedRegionTypes()');
// D2 -- die Migration laeuft NACH der Saat, sonst trifft sie auf einer frischen Anlage null Zeilen.
assert($migration > $saat, 'die Tempowerte-Migration laeuft nach der Saat');
// D3 -- und nach dem ALTER, sonst schreibt sie in eine Spalte, die es nicht gibt.
assert($spalteNeu < $migration, 'die Spalte wird angelegt, bevor die Migration sie beschreibt');
// D4 -- 💣 DDL COMMITTET IMPLIZIT: in dieser Funktion darf keine Transaktion offen sein.
assert(strpos($rumpf, 'beginTransaction') === false,
    'avesmapsEcosystemEnsureTables oeffnet keine Transaktion -- ein ALTER darin committet sie still');

// ============================================================ E. Der Lader liest die neue Spalte

require_once __DIR__ . '/../offroad-data.php';

$flaeche = static function (float $x, float $y): string {
    return (string) json_encode(['type' => 'Polygon', 'coordinates' => [[
        [$x, $y], [$x + 10.0, $y], [$x + 10.0, $y + 10.0], [$x, $y + 10.0], [$x, $y],
    ]]]);
};

$ebene = static function (?float $faktor) use ($flaeche): string {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, region_type TEXT, kind TEXT, is_active INTEGER)');
    $pdo->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, offroad_factor REAL, terrain_speed_factor REAL)');
    $pdo->exec('CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY, region_id INTEGER, geometry_geojson TEXT,
        min_x REAL, min_y REAL, max_x REAL, max_y REAL, is_active INTEGER, is_trial INTEGER)');
    $pdo->exec("INSERT INTO ecosystem_region (id, region_type, kind, is_active) VALUES (1, 'gebirge', 'topographie', 1)");
    // 💣 offroad_factor steht bewusst auf 2,20 -- dem heutigen Gebirgswert. Liest der Lader noch die
    // alte Spalte, kommt hier 2,20 heraus statt des Werts, den terrain_speed_factor verlangt.
    $pdo->prepare('INSERT INTO ecosystem_region_type (kind, type_key, offroad_factor, terrain_speed_factor) VALUES (?, ?, ?, ?)')
        ->execute(['topographie', 'gebirge', 2.20, $faktor]);
    $pdo->prepare('INSERT INTO ecosystem_area (region_id, geometry_geojson, min_x, min_y, max_x, max_y, is_active, is_trial)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)')->execute([1, $flaeche(0.0, 0.0), 0.0, 0.0, 10.0, 10.0, 1, 0]);

    return avesmapsOffroadLoadFactorPlane($pdo, avesmapsBuildOffroadBox(1.0, 1.0, 9.0, 9.0));
};

$boxE = avesmapsBuildOffroadBox(1.0, 1.0, 9.0, 9.0);

// --- E1. Der GA-Wert des Gebirges wird zum Multiplikator Basis ÷ Faktor.
$gebirge = $ebene(0.200);
assert($gebirge !== '', 'ein Gebirge mit Bodenfaktor liefert eine Ebene');
$gemessen = avesmapsOffroadFactorAt($boxE, $gebirge, 5.0, 5.0);
assert($nah($gemessen, 3.75, $aufloesung), "Gebirge 0,200 -> 0,75 ÷ 0,20 = 3,75, bekommen: $gemessen");

// --- E2. Der Sumpf, der den Byte-Maszstab erzwungen hat, kommt heil durch den ganzen Weg.
$sumpfEbene = avesmapsOffroadFactorAt($boxE, $ebene(0.100), 5.0, 5.0);
assert($nah($sumpfEbene, 7.50, $aufloesung), "Sumpf 0,100 -> 7,50, bekommen: $sumpfEbene");

// --- E3. NULL faellt heraus wie heute die 1,00 -- „keine eigene Aussage" bremst nicht.
assert($ebene(null) === '', 'eine Art ohne eigene Aussage schreibt nichts in die Ebene');

// --- E4. Und was nicht langsamer ist als offener Boden, ebenfalls.
// 🔴 Der Filter ist „Faktor kleiner als die Basis", nicht „Faktor kleiner als 1". 0,750 IST offener
// Boden; eine Zelle dafuer zu schreiben hiesse, den Bezug gegen sich selbst zu rechnen.
assert($ebene(0.750) === '', 'genau offener Boden schreibt nichts in die Ebene');
assert($ebene(0.900) === '', 'schneller als offener Boden schreibt nichts in die Ebene');

// --- E5. 🔴 DIE UNGLEICHUNG, AUF DER ZWEI ANDERE DATEIEN STEHEN: der kleinste Faktor, den diese
// Ebene je liefert, ist EXAKT 1,0. Daraus begruenden `offroad-grid.php` die Zulaessigkeit der
// A*-Heuristik und `detour.php` seine Bestzeit-Schranke -- beide rechnen „Luftlinie ÷ Tempo" als
// untere Grenze, und ein Faktor unter 1,0 machte beide still falsch. Bis zum 14.08.2026 kam die
// Garantie aus `offroad_factor > 1.00`; seither aus `terrain_speed_factor < Basis`.
foreach ([0.749, 0.700, 0.500, 0.200, 0.100, 0.040] as $faktor) {
    $ebeneE5 = $ebene($faktor);
    if ($ebeneE5 === '') { continue; }
    $wert = avesmapsOffroadFactorAt($boxE, $ebeneE5, 5.0, 5.0);
    assert($wert >= 1.0, "Faktor $faktor ergab den Multiplikator $wert -- unter 1,0 wird die A*-Heuristik unzulaessig");
}

// ============================================================ F. Die Ablageform, einmal im Haus

// 💣 ZWEI SCHREIBER, EINE FORM. Der Endpunkt (api/edit/map/travel-values.php) und die Migration legen
// denselben Wert ab. Stuende die Sieben-Schluessel-Liste zweimal da, fehlte beim naechsten neuen
// Abschnitt genau einer der beiden -- und ein fehlender Schluessel ist im Leser kein Fehler, sondern
// ein stiller Rueckfall auf die Konstante.
// ⭐ GENAU DAS HAT DIESE ZEILE AM 15.08.2026 GELEISTET: `offroad_ramp` (der Laengenaufschlag)
// kam dazu, und der Waechter hat es gemeldet, statt es durchgehen zu lassen. Die Liste bleibt
// deshalb ausgeschrieben -- ein `count()` haette dasselbe gezaehlt und nichts benannt.
$abgelegt = avesmapsTravelValuesStorableShape(avesmapsTravelValuesRead(null));
assert(array_keys($abgelegt) === ['grid', 'day_miles', 'path_factors', 'ground_penalties',
    'river_ratio', 'calibration_target_miles', 'offroad_ramp'],
    'die Ablageform hat genau sieben Schluessel: ' . implode(', ', array_keys($abgelegt)));
// ⚠️ `source` sagt, WOHER die Werte kamen (Speicher oder Konstante). Mitgespeichert waere es beim
// naechsten Lesen eine Behauptung ueber sich selbst.
assert(!array_key_exists('source', $abgelegt), '`source` wird nicht mitgespeichert');

$endpunkt = (string) file_get_contents(__DIR__ . '/../../../edit/map/travel-values.php');
assert(strpos($endpunkt, 'avesmapsTravelValuesStorableShape(') !== false,
    'der Endpunkt legt ueber dieselbe Form ab wie die Migration');

$migrationQuelle = (string) file_get_contents(__DIR__ . '/../travel-values-migration.php');
assert(strpos($migrationQuelle, 'avesmapsTravelValuesStorableShape(') !== false,
    'und die Migration ebenso');
// Der Stempel, den der Routen-Endpunkt lesen soll: wer den Speicher aendert, hebt ihn -- sonst sieht
// eine Migration spaeter aus wie „nie etwas geaendert".
assert(strpos($migrationQuelle, "_stamp'") !== false || strpos($migrationQuelle, "_stamp\"") !== false
    || strpos($migrationQuelle, "SETTING_KEY . '_stamp'") !== false,
    'die Migration hebt den Tempo-Stempel mit');

// ============================================================ G. Der Speicher muss den Wert fassen

// 💣 GEMESSEN AM 14.08.2026 AN DER LIVE-ANLAGE, und es ist der Grund, warum Schritt 2 beim ersten
// Deploy nur zur Haelfte wirkte: `app_setting.setting_value` war VARCHAR(255), das Tempo-JSON ist
// ueber 1.400 Zeichen. MySQL schneidet ausserhalb des strikten Modus STILL ab, `json_decode` liefert
// danach NULL, und avesmapsTravelValuesRead faellt auf die Konstante zurueck -- ohne Fehler, ohne
// Warnung, und ununterscheidbar von „es wurde nie etwas gespeichert".
// 🔴 Das traf den Endpunkt genauso: der „Speichern"-Knopf des Fensters schrieb seit dem 14.08.2026
// denselben Wert in dieselbe Spalte und hat nie gewirkt. Dass niemandem etwas auffiel, liegt daran,
// dass „nichts aendert sich" der erwartete Zustand war.
$tempoJson = (string) json_encode(avesmapsTravelValuesStorableShape(avesmapsTravelValuesRead(null)), JSON_UNESCAPED_UNICODE);
assert(strlen($tempoJson) > 255,
    'das Tempo-JSON ist laenger als die alte Spalte -- Laenge: ' . strlen($tempoJson));
assert(json_decode(substr($tempoJson, 0, 255), true) === null,
    'und abgeschnitten ist es kein JSON mehr, sondern NULL -- genau der stille Rueckfall');

// 🔴 BEIDE SCHREIBER MUESSEN DIE PRUEFUNG ERREICHEN. Der Endpunkt bindet `travel-values.php` ein,
// aber NICHT `travel-values-migration.php` -- stuende die Rueckleseprobe dort, waere sie im Fenster
// ein Fatal statt einer Pruefung. Der Unterprozess beweist es ohne die Requires dieses Tests.
$travelValuesQuelle = (string) file_get_contents(__DIR__ . '/../travel-values.php');
assert(strpos($travelValuesQuelle, 'function avesmapsTravelValuesStoredMatches(') !== false,
    'die Rueckleseprobe wohnt in travel-values.php -- der Endpunkt bindet nur diese Datei ein');
assert(strpos($migrationQuelle, 'function avesmapsTravelValuesStoredMatches(') === false,
    'und nicht ein zweites Mal in der Migration');
assert(strpos($endpunkt, 'avesmapsTravelValuesStoredMatches(') !== false,
    'der Endpunkt prueft nach, ob sein Speichern angekommen ist');
assert(strpos($endpunkt, 'avesmapsAppSettingEnsureWideValue(') !== false,
    'und zieht die Spalte vorher nach');

require_once __DIR__ . '/../../app/app-setting.php';
$appSettingQuelle = (string) file_get_contents(__DIR__ . '/../../app/app-setting.php');
assert(strpos($appSettingQuelle, 'setting_value VARCHAR(255)') === false,
    'eine frische Anlage bekommt keine 255-Zeichen-Spalte mehr');
assert(function_exists('avesmapsAppSettingEnsureWideValue'),
    'und eine bestehende Anlage wird nachgezogen');

// --- G1. Die Rueckleseprobe: erst wenn der Wert WIRKLICH dasteht, gilt die Migration als gelaufen.
// 🔴 EIN SCHREIBVORGANG, DER STILL VERLORENGEHT, DARF KEINEN MERKER SETZEN. Sonst ist die Migration
// „erledigt", ohne dass ihr Ergebnis existiert -- und genau das ist am 14.08.2026 live passiert.
$probe = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$probe->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT)');
$vollstaendig = avesmapsTravelValuesStorableShape(avesmapsTravelValuesRead(null));

$setze = static function (PDO $pdo, string $wert): void {
    $pdo->exec("DELETE FROM app_setting WHERE setting_key = 'travel_values'");
    $pdo->prepare('INSERT INTO app_setting (setting_key, setting_value) VALUES (?, ?)')
        ->execute(['travel_values', $wert]);
};

assert(avesmapsTravelValuesStoredMatches($probe, $vollstaendig) === false,
    'ohne Zeile ist nichts gespeichert');
$setze($probe, substr($tempoJson, 0, 255));
assert(avesmapsTravelValuesStoredMatches($probe, $vollstaendig) === false,
    'ein abgeschnittener Wert gilt NICHT als gespeichert -- er ist der Fall, der es nie gemerkt hat');
$setze($probe, $tempoJson);
assert(avesmapsTravelValuesStoredMatches($probe, $vollstaendig) === true,
    'der vollstaendige Wert gilt als gespeichert');

// --- G2. Der Merker heisst v2: v1 steht live auf '1' aus dem Lauf, dessen Ergebnis verlorenging.
assert(AVESMAPS_TRAVEL_VALUES_MIGRATION_KEY === 'travel_values_v2',
    'der Merker ist travel_values_v2 -- v1 ist ein Grabstein, kein erledigter Lauf');

// ============================================================ H. Die Landschaften im Fenster

// Das Fenster zeigt die zwanzig Arten mit ihrem Wert, dem GA-Wert, der Wirkung und der Flaechenzahl
// (Entwurf §4.3). Diese drei Funktionen sind das, was der Endpunkt dafuer braucht.

$mitFlaechen = static function () use ($offroad): PDO {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE ecosystem_region_type (
        kind TEXT, type_key TEXT, label TEXT, sort_order INT, is_active INT DEFAULT 1,
        offroad_factor REAL NOT NULL DEFAULT 1.00, terrain_speed_factor REAL DEFAULT NULL)');
    $pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, kind TEXT, region_type TEXT, is_active INT DEFAULT 1)');
    $pdo->exec('CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY, region_id INT, is_active INT DEFAULT 1)');
    $insert = $pdo->prepare('INSERT INTO ecosystem_region_type (kind, type_key, label, sort_order, offroad_factor) VALUES (?, ?, ?, ?, ?)');
    foreach (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED as [$kind, $typeKey, $label, $sortOrder]) {
        $insert->execute([$kind, $typeKey, $label, $sortOrder, $offroad[$typeKey] ?? 1.00]);
    }
    // Drei Waldflaechen, eine davon still gelegt; eine Meerflaeche; ein stillgelegtes Gebirge.
    $regionen = [[1, 'vegetation', 'wald', 1], [2, 'topographie', 'meer', 1], [3, 'topographie', 'gebirge', 0]];
    foreach ($regionen as [$id, $kind, $typ, $aktiv]) {
        $pdo->prepare('INSERT INTO ecosystem_region (id, kind, region_type, is_active) VALUES (?, ?, ?, ?)')
            ->execute([$id, $kind, $typ, $aktiv]);
    }
    foreach ([[1, 1, 1], [2, 1, 1], [3, 1, 0], [4, 2, 1], [5, 3, 1]] as [$id, $region, $aktiv]) {
        $pdo->prepare('INSERT INTO ecosystem_area (id, region_id, is_active) VALUES (?, ?, ?)')
            ->execute([$id, $region, $aktiv]);
    }

    return $pdo;
};

$pdoH = $mitFlaechen();
$plan = avesmapsTravelValuesPlanFromDatabase($pdoH);
avesmapsTravelValuesWriteLandscapeFactors($pdoH, $plan['factors']);

$liste = avesmapsTravelValuesReadLandscapes($pdoH);
$nachSchluessel = [];
foreach ($liste as $zeile) { $nachSchluessel[$zeile['type_key']] = $zeile; }

// --- H1. Einundzwanzig Arten, jede mit dem, was die Zeile anzeigen soll.
// 21 seit dem 16.08.2026 (Kulturlandschaft, Idee #77). Die Liste kommt aus der Datenbank, eine neue
// Art steht also ohne eine Zeile Code im Fenster -- genau deshalb wandert die Zahl hier mit.
assert(count($liste) === 21, 'einundzwanzig Landschaftsarten im Fenster: ' . count($liste));
foreach (['kind', 'type_key', 'label', 'factor', 'source', 'area_count'] as $feld) {
    assert(array_key_exists($feld, $liste[0]), "jede Zeile traegt `$feld`");
}
assert($nachSchluessel['wald']['label'] === 'Wald', 'der Name kommt aus der Datenbank, nicht aus dem Browser');
assert($nah((float) $nachSchluessel['wald']['factor'], 0.500, 0.0005), 'Wald steht auf 0,500');
assert($nah((float) $nachSchluessel['wald']['source'], 0.500, 0.0005), 'und die Quelle sagt dasselbe');
// 🔴 Die ELF ohne Quellenzeile haben KEINEN GA-Wert -- `null`, nicht 0,75. Sonst behauptete das
// Fenster eine Quelle, die es fuer sie nicht gibt (Entwurf §4.3).
assert($nachSchluessel['wadi']['source'] === null, 'das Wadi hat keine Quellenzeile');
assert($nachSchluessel['kueste']['source'] === null, 'die Kueste ebenso wenig');
// Und die Kulturlandschaft schon gar nicht: sie ist eine Setzung des Owners (Idee #77), die GA kennt
// sie ueberhaupt nicht. Im Fenster steht in ihrer Quellenspalte darum „—".
assert($nachSchluessel['kulturlandschaft']['source'] === null,
    'die Kulturlandschaft steht in keiner Quelle');

// --- H2. Wasser und fremde Ebenen kommen gar nicht vor.
foreach (['see', 'meer', 'region', 'kontinent', 'polar'] as $schluessel) {
    assert(!isset($nachSchluessel[$schluessel]), "$schluessel gehoert nicht in die Liste");
}

// --- H3. Die Flaechenzahl ist die Zahl, die „ein Faktor ohne Flaeche ist eine Einstellung ohne
// Wirkung" ueberhaupt sichtbar macht -- und sie zaehlt nur, was aktiv ist.
assert($nachSchluessel['wald']['area_count'] === 2,
    'zwei aktive Waldflaechen (die dritte ist still gelegt): ' . $nachSchluessel['wald']['area_count']);
assert($nachSchluessel['gebirge']['area_count'] === 0,
    'die Flaeche einer stillgelegten Region zaehlt nicht mit: ' . $nachSchluessel['gebirge']['area_count']);
assert($nachSchluessel['tundra']['area_count'] === 0, 'Tundra hat live gar keine Flaeche -- und das soll man sehen');

// --- H4. Schreiben: nur bekannte Paare, nur positive Zahlen, auf drei Stellen.
$geschrieben = avesmapsTravelValuesWriteLandscapes($pdoH, [
    ['kind' => 'vegetation', 'type_key' => 'wald', 'factor' => 0.4444],
    ['kind' => 'vegetation', 'type_key' => 'gibtsnicht', 'factor' => 0.5],
    ['kind' => 'vegetation', 'type_key' => 'steppe', 'factor' => 0],
    ['kind' => 'vegetation', 'type_key' => 'tundra', 'factor' => -1],
]);
assert($geschrieben === 1, "nur die eine gueltige Zeile wird geschrieben: $geschrieben");
$liste2 = [];
foreach (avesmapsTravelValuesReadLandscapes($pdoH) as $z) { $liste2[$z['type_key']] = $z; }
assert($nah((float) $liste2['wald']['factor'], 0.444, 0.0005), 'auf drei Stellen gerundet: ' . $liste2['wald']['factor']);
// 💣 Eine 0 ist kein Wert, sondern eine Division durch null im Lader -- sie darf nie ankommen.
assert($nah((float) $liste2['steppe']['factor'], 0.750, 0.0005), 'die 0 wurde ausgelassen, nicht geschrieben');

// --- H5. Der Ruecksetzer zieht NUR die neun mit Quellenzeile.
// ⚠️ „Die GA nennt fuer Kuesten und Flusslandschaften ausdruecklich KEINEN Landfaktor. Diese Zeilen
// behalten den Wert des Owners, und der Ruecksetzer laesst sie stehen." (Entwurf §4.3)
avesmapsTravelValuesWriteLandscapes($pdoH, [['kind' => 'topographie', 'type_key' => 'wadi', 'factor' => 0.111]]);
$zurueckgesetzt = avesmapsTravelValuesResetLandscapes($pdoH);
assert($zurueckgesetzt === 9, "neun Arten haben eine Quellenzeile: $zurueckgesetzt");
$liste3 = [];
foreach (avesmapsTravelValuesReadLandscapes($pdoH) as $z) { $liste3[$z['type_key']] = $z; }
assert($nah((float) $liste3['wald']['factor'], 0.500, 0.0005), 'der Wald steht wieder auf der Quellenzeile');
assert($nah((float) $liste3['wadi']['factor'], 0.111, 0.0005),
    'das Wadi behaelt den Wert des Owners -- die Quelle sagt fuer es nichts: ' . $liste3['wadi']['factor']);

// ============================================================ I. Was das Fenster schicken darf

$basis = avesmapsTravelValuesRead(null);

// --- I1. Das Raster: nur vorhandene Zellen, nur positive Zahlen, Komma erlaubt, auf zwei Stellen.
$neu = avesmapsTravelValuesApplyIncoming($basis, ['grid' => [
    'groupFoot' => ['Strasse' => '3,456', 'Querfeldein' => 0, 'GibtsNicht' => 5.0],
    'gibtsNicht' => ['Strasse' => 9.9],
]]);
assert($nah($neu['grid']['groupFoot']['Strasse'], 3.46, 0.005), 'Komma gelesen, auf zwei Stellen: ' . $neu['grid']['groupFoot']['Strasse']);
// 💣 Eine 0 im Raster ist kein Fehler, sondern ein still uebersprungener Weg im Graphbau.
assert($neu['grid']['groupFoot']['Querfeldein'] === $basis['grid']['groupFoot']['Querfeldein'],
    'die 0 wurde ausgelassen, nicht geschrieben');
assert(!isset($neu['grid']['groupFoot']['GibtsNicht']), 'ein unbekannter Wegtyp kommt nicht dazu');
assert(!isset($neu['grid']['gibtsNicht']), 'ein unbekanntes Reisemittel ebenso wenig');

// --- I2. Boden nach Jahreszeit: die fuenf Abzuege sind NEGATIV, die Untergrenze ist POSITIV.
// 💣 EIN VORZEICHENDREHER MACHT TIEFSCHNEE ZUM RUECKENWIND. Die Zahl sieht danach voellig normal
// aus, und die Wirkung faellt erst jemandem auf, der im Winter eine Reisezeit nachrechnet.
$boden = avesmapsTravelValuesApplyIncoming($basis, ['ground_penalties' => [
    'tiefschnee' => -0.25, 'eis' => 0.20, 'untergrenze' => 0.08, 'aufgeweicht' => '-0,15',
    'gibtsnicht' => -0.5,
]]);
assert($nah($boden['ground_penalties']['tiefschnee'], -0.25, 0.0005), 'Tiefschnee angenommen');
assert($nah($boden['ground_penalties']['aufgeweicht'], -0.15, 0.0005), 'Komma gelesen: ' . $boden['ground_penalties']['aufgeweicht']);
assert($nah($boden['ground_penalties']['eis'], $basis['ground_penalties']['eis'], 0.0005),
    'ein positiver Abzug wird ABGELEHNT, nicht uebernommen -- er waere Rueckenwind');
assert($nah($boden['ground_penalties']['untergrenze'], 0.08, 0.0005), 'die Untergrenze darf positiv sein');
assert(!isset($boden['ground_penalties']['gibtsnicht']), 'ein unbekannter Bodenzustand kommt nicht dazu');

// --- I3. Fluss und Eichung: positiv, sonst bleibt der alte Wert stehen.
$misc = avesmapsTravelValuesApplyIncoming($basis, ['river_ratio' => '2,5', 'calibration_target_miles' => -1]);
assert($nah($misc['river_ratio'], 2.5, 0.0005), 'stromauf:stromab angenommen: ' . $misc['river_ratio']);
assert($nah($misc['calibration_target_miles'], $basis['calibration_target_miles'], 0.0005),
    'ein negatives Eichziel wird abgelehnt');

// --- I4. Ein leerer Rumpf aendert nichts. Das ist die Zusicherung fuer „Speichern" ohne Eingabe.
$leerRein = avesmapsTravelValuesApplyIncoming($basis, []);
assert($leerRein['grid'] == $basis['grid'], 'ohne Nutzlast bleibt das Raster, wie es war');
assert($leerRein['ground_penalties'] == $basis['ground_penalties'], 'und der Boden ebenso');

// ============================================================ J. Die Probe „findet der A* Boden?"

// 🔴 DER STILLE NOT-AUS. `avesmapsOffroadLoadFactorPlane` faellt bei JEDEM Fehler auf '' zurueck --
// fehlende Spalte, kaputte Geometrie, leergefilterte Abfrage sehen alle gleich aus, und der A*
// rechnet danach die ganze Welt als offenen Boden. Genau das ist am 30.07.2026 schon einmal
// passiert (alle 17 Gebirge trugen den Erprobungsstempel) und fiel wochenlang niemandem auf.
// Die Probe faehrt DENSELBEN Lader, den der A* faehrt -- nicht eine eigene Zaehlung, die gruen
// bleibt, waehrend der echte Weg leer zurueckkommt.

$mitGeometrie = static function (?float $waldFaktor): PDO {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, label TEXT, sort_order INT,
        is_active INT DEFAULT 1, offroad_factor REAL DEFAULT 1.0, terrain_speed_factor REAL DEFAULT NULL)');
    $pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, kind TEXT, region_type TEXT, is_active INT DEFAULT 1)');
    $pdo->exec('CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY, region_id INT, geometry_geojson TEXT,
        min_x REAL, min_y REAL, max_x REAL, max_y REAL, is_active INT DEFAULT 1, is_trial INT DEFAULT 0)');
    $pdo->prepare('INSERT INTO ecosystem_region_type (kind, type_key, label, sort_order, terrain_speed_factor) VALUES (?, ?, ?, ?, ?)')
        ->execute(['vegetation', 'wald', 'Wald', 10, $waldFaktor]);
    $pdo->exec("INSERT INTO ecosystem_region (id, kind, region_type, is_active) VALUES (1, 'vegetation', 'wald', 1)");
    $ring = json_encode(['type' => 'Polygon', 'coordinates' => [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]]);
    $pdo->prepare('INSERT INTO ecosystem_area (id, region_id, geometry_geojson, min_x, min_y, max_x, max_y, is_active)
        VALUES (1, 1, ?, 0, 0, 10, 10, 1)')->execute([$ring]);

    return $pdo;
};

// --- J1. Gezeichneter Wald mit Faktor: die Ebene traegt etwas, und die Probe sagt WOMIT.
$probe = avesmapsTravelValuesTerrainProbe($mitGeometrie(0.500));
assert($probe['checked'] === true, 'die Probe ist gelaufen');
assert($probe['known'] === true, 'sie hat Bodenfaktoren gefunden');
assert($probe['areas'] === 1, 'eine bremsende Flaeche: ' . $probe['areas']);
assert($probe['sample_label'] === 'Wald', 'und sie nennt, woran sie geprueft hat: ' . $probe['sample_label']);
// Der staerkste Multiplikator, den sie in der Ebene gemessen hat -- 0,75 ÷ 0,50 = 1,50.
assert($nah((float) $probe['max_factor'], 1.50, $aufloesung), 'staerkste Bremse 1,50: ' . $probe['max_factor']);

// --- J2. Kein Faktor gesetzt: die Ebene ist leer, und DAS ist die Meldung, die gefehlt hat.
$leer = avesmapsTravelValuesTerrainProbe($mitGeometrie(null));
assert($leer['checked'] === true, 'auch dann ist die Probe gelaufen');
assert($leer['known'] === false, 'aber sie hat nichts gefunden -- der A* rechnet mit offenem Boden');
assert($leer['areas'] === 0, 'keine bremsende Flaeche: ' . $leer['areas']);

// --- J3. Fehlende Spalte faellt INERT aus, nicht als 500 -- das Fenster soll trotzdem aufgehen.
$ohneSpalte = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$ohneSpalte->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT)');
$kaputt = avesmapsTravelValuesTerrainProbe($ohneSpalte);
assert($kaputt['checked'] === false, 'ohne Spalte gibt es nichts zu pruefen');
assert($kaputt['known'] === false, 'und schon gar nichts zu behaupten');

// ============================================================ K. Was die Eichung je Wegtyp sagt

// 🔴 DIE BRUECKE, DIE BISHER FEHLTE. Die Eichung misst an UNSERER Karte, die Tempowerte stehen auf
// der Quelle -- beide behaupten „eine Fussgruppe schafft 30 Meilen am Tag auf unseren Strassen",
// und niemand prueft, ob das aufgeht. Diese Funktion legt die gemessene Seite neben die gerechnete.

$eichung = [
    'by_subtype' => [
        'Strasse'       => ['mean_factor' => 1.032, 'ways' => 431, 'relative_to_reference' => 1.0],
        'Reichsstrasse' => ['mean_factor' => 1.021, 'ways' => 148, 'relative_to_reference' => 0.9893],
        'Gebirgspass'   => ['mean_factor' => 1.326, 'ways' => 113, 'relative_to_reference' => 1.2849],
        'Wuestenpfad'   => ['mean_factor' => 1.100, 'ways' => 0,   'relative_to_reference' => 1.066],
    ],
    'mean_reference_factor' => 1.032,
];
$gesamt = ['Strasse' => 1026, 'Reichsstrasse' => 352, 'Gebirgspass' => 201, 'Wuestenpfad' => 35, 'Pfad' => 1557];

$eich = avesmapsTravelValuesCalibrationBySubtype($eichung, $gesamt);

// --- K1. Ein gewoehnlicher Wegtyp: gemessener und wirksamer Faktor sind derselbe.
assert($nah($eich['Reichsstrasse']['mean_factor'], 1.021, 0.0005), 'Reichsstrasse gemessen');
assert($nah($eich['Reichsstrasse']['effective_factor'], 1.021, 0.0005), 'und wirksam dasselbe');
assert($eich['Reichsstrasse']['measured_ways'] === 148, 'vermessene Wege');
assert($eich['Reichsstrasse']['total_ways'] === 352, 'und wie viele es ueberhaupt gibt');

// --- K2. 💣 DER PASS TRAEGT ZWEI FAKTOREN, und beide gehoeren angezeigt. Der Wegtyp-Faktor 0,4
// enthaelt den Anstieg laut Quelle schon; ohne den Pass-Ausgleich braemste die Steigungsebene ein
// zweites Mal. Wer nur den gemessenen liest, haelt den Pass fuer doppelt bestraft.
assert($nah($eich['Gebirgspass']['mean_factor'], 1.326, 0.0005), 'Pass gemessen 1,326');
assert($nah($eich['Gebirgspass']['effective_factor'], 1.032, 0.002),
    'nach dem Ausgleich bleibt der Strassenmittelwert uebrig: ' . $eich['Gebirgspass']['effective_factor']);

// --- K3. 🔴 NULL VERMESSENE WEGE IST KEINE MESSUNG. Der Wuestenpfad traegt zwar eine Zeile, aber
// keinen einzigen vermessenen Weg -- ein Faktor daraus waere aus dem Nichts gerechnet.
assert($eich['Wuestenpfad']['effective_factor'] === null,
    'ohne vermessenen Weg gibt es keinen Faktor');
assert($eich['Wuestenpfad']['total_ways'] === 35, 'die Gesamtzahl steht trotzdem da');

// --- K4. Ein Wegtyp ohne Eichungszeile taucht mit seiner Gesamtzahl auf, ohne Faktor.
assert(isset($eich['Pfad']), 'der Pfad fehlt der Eichung, nicht dem Bestand');
assert($eich['Pfad']['effective_factor'] === null, 'und hat deshalb keinen Faktor');
assert($eich['Pfad']['total_ways'] === 1557, 'aber seine Wegzahl');

// --- K5. Ohne Eichung ueberhaupt: nur die Bestandszahlen, keine erfundene 1,0.
$ohne = avesmapsTravelValuesCalibrationBySubtype(null, $gesamt);
assert(count($ohne) === count($gesamt), 'alle Wegtypen des Bestands sind da');
foreach ($ohne as $typ => $zeile) {
    assert($zeile['effective_factor'] === null, "$typ hat ohne Eichung keinen Faktor");
    assert($zeile['measured_ways'] === 0, "$typ hat ohne Eichung keine vermessenen Wege");
}
// 💣 Und gar nichts liefert gar nichts -- keine Zeile mit Nullen, die wie eine Messung aussaehe.
assert(avesmapsTravelValuesCalibrationBySubtype(null, []) === [], 'ohne alles: leer');

echo "terrain-speed-factor-test: A (Maszstab) + B (Plan) + C (Migration) + D (Reihenfolge) + E (Lader) + F (Ablageform) + G (Speicherbreite) + H (Landschaften) + I (Annahme) + J (Bodenprobe) + K (Eichung je Wegtyp) bestanden\n";
