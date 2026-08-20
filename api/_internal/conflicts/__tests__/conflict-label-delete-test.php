<?php

declare(strict_types=1);

/**
 * Der LOESCHWEG des Konfliktzentrums, an einer echten Datenbank. Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll \
 *       api/_internal/conflicts/__tests__/conflict-label-delete-test.php
 *
 * 💣 DIE FALLE, DIE DIESEN TEST NOETIG MACHT: eine Beschriftung zu loeschen kann ihre ganze
 * Landschaft mitnehmen. AVESMAPS_ECOSYSTEM_CASCADE_ENABLED = true -- entfernt ein Loeschvorgang das
 * LETZTE Label einer Region, verschwindet die Region samt ihren gezeichneten Flaechen
 * (api/_internal/app/ecosystem.php, avesmapsEcosystemCascadeAfterRemoval). Am Livebestand hat fast
 * jede Region genau ein Label -- der Ausloesefall IST der Normalfall.
 *
 * 🔴 DESHALB FAENGT DIESER TEST MIT DEM ZEUGEN AN: er laesst die Kaskade in DIESER Fixture wirklich
 * zuschlagen, bevor er zusichert, dass der Konflikt-Loeschweg sie vermeidet. Ohne den Zeugen bewiese
 * „die Flaeche steht noch" gar nichts -- vielleicht kann sie in dieser Fixture ueberhaupt nicht
 * verschwinden.
 *
 * ⚠️ GRENZE DIESES TESTS: SQLite vergleicht `name` BINAER, live steht die Spalte in
 * utf8mb4_unicode_ci. Fuer die Aussagen hier ist das die sichere Richtung -- der Zwillingszaehler
 * findet hoechstens WENIGER Zwillinge als live, und weniger Zwillinge heisst frueher „das ist die
 * letzte Beschriftung", also frueher eine Absage. (Derselbe Vorbehalt wie in
 * conflict-repair-reach-test.php, dort mit der umgekehrten Richtung.)
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

// 🔴 NUR repair.php, und das ist eine Zusicherung fuer sich: der Riegel braucht
// avesmapsEcosystemRegionPublicIdOfLabel(), und repair.php muss sie selbst hereinziehen. Wer die
// Zeile dort entfernt, laesst diesen Test rot werden -- statt den Riegel lautlos in seinen
// `function_exists`-Rueckfall kippen zu lassen. Zugleich ist damit die ECHTE Kaskade geladen, nicht
// eine nachgebaute; nur so ist der Zeuge unten ein Beweis.
require __DIR__ . '/../repair.php';
assert(
    function_exists('avesmapsEcosystemRegionPublicIdOfLabel'),
    'repair.php zieht die Landschaften-Pruefung selbst herein'
);
assert(
    function_exists('avesmapsEcosystemCascadeAfterRemoval'),
    'und damit auch die Kaskade, die avesmapsDeleteMapFeature per function_exists sucht'
);

/**
 * Uebersetzt die drei MySQL-eigenen Wendungen des Schreibpfades an der TREIBER-NAHT, statt die
 * Funktionen nachzubauen -- sonst prueft der Test eine Kopie und nicht den Code, der live laeuft.
 * Hausform aus conflict-repair-reach-test.php, hier um zwei Wendungen erweitert:
 *   ON DUPLICATE KEY  -> ON CONFLICT           (avesmapsNextMapRevision)
 *   FOR UPDATE        -> entfaellt             (avesmapsFetchEditableFeature; SQLite sperrt ohnehin)
 *   NOW(3)            -> datetime('now')       (avesmapsAssertFeatureCanBeEdited, Sperrpruefung)
 */
final class AvesmapsLabelDeleteTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }

        return parent::exec($statement);
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $query = str_replace([' FOR UPDATE', 'NOW(3)'], ['', "datetime('now')"], $query);

        return parent::prepare($query, $options);
    }
}

$pdo = new AvesmapsLabelDeleteTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
    revision INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, updated_by INTEGER NULL,
    updated_at TEXT DEFAULT ""
)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('CREATE TABLE map_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
    actor_user_id INTEGER NULL, before_json TEXT, after_json TEXT
)');
$pdo->exec('CREATE TABLE map_feature_locks (public_id TEXT, user_id INTEGER, username TEXT, locked_until TEXT)');
$pdo->exec('CREATE TABLE ecosystem_region (
    id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, kind TEXT, region_type TEXT NULL,
    origin TEXT, wiki_region_key TEXT NULL, wiki_url TEXT NULL, label_public_id TEXT NULL,
    properties_json TEXT NULL, is_active INTEGER DEFAULT 1, updated_at TEXT DEFAULT "", updated_by INTEGER NULL
)');
$pdo->exec('CREATE TABLE ecosystem_area (
    id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, region_id INTEGER,
    geometry_geojson TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL,
    geometry_revision INTEGER DEFAULT 1, is_trial INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
    updated_at TEXT DEFAULT "", updated_by INTEGER NULL
)');
$pdo->exec('CREATE TABLE ecosystem_geometry_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, actor_user_id INTEGER NULL,
    area_public_id TEXT NULL, region_public_id TEXT NULL, before_json TEXT, after_json TEXT,
    operation_id TEXT NULL, operation_label TEXT NULL
)');

// 💣 Eine public_id ist eine UUID -- avesmapsReadMapFeaturePublicId() laesst nur 36 Zeichen aus
// [a-f0-9-] durch und wirft sonst. Sprechende Kuerzel taeten es hier NICHT.
$DS_A = '11111111-1111-4111-8111-111111111111';       // „Drei Schwestern“, die gepflegte
$DS_B = '22222222-2222-4222-8222-222222222222';       // „Drei Schwestern“, die Dublette
$FK_FLAECHE = '33333333-3333-4333-8333-333333333333'; // „Finsterkamm“, haengt an der Flaeche
$FK_FREI = '44444444-4444-4444-8444-444444444444';    // „Finsterkamm“, frei

// Das Wiki-Nest, wie ein Abgleich es hinterlaesst. Die Adresse steht MIT drin -- daran haengt der
// Nachweis unten, dass die Artikel-Regel denselben Fall nicht ein zweites Mal meldet.
$NEST = static fn(string $wikiKey): array => ['wiki_region' => [
    'wiki_key' => $wikiKey,
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/' . $wikiKey,
]];

/**
 * Die Karte im Ausgangszustand. Vier Beschriftungen und eine Landschaft:
 *   ds-a / ds-b  „Drei Schwestern", berggipfel, Schluessel `drei-schwestern`, BEIDE frei
 *                -> der gemeldete Fall aus Discord #83
 *   fk-flaeche   „Finsterkamm", gebirge, Schluessel `finsterkamm`, haengt an der Region r-fk
 *   fk-frei      „Finsterkamm", gebirge, derselbe Schluessel, frei
 *                -> die Lage „frei + flaechengebunden", live als „Schwarzer See" gemessen
 * r-fk traegt GENAU EINE Beschriftung (fk-flaeche) und EINE gezeichnete Flaeche -- also den
 * Livebestands-Normalfall, in dem die Kaskade zuschlaegt.
 */
$seed = static function (PDO $pdo) use ($NEST, $DS_A, $DS_B, $FK_FLAECHE, $FK_FREI): void {
    foreach (['map_features', 'map_audit_log', 'map_revision', 'map_feature_locks',
        'ecosystem_region', 'ecosystem_area', 'ecosystem_geometry_audit_log'] as $table) {
        $pdo->exec('DELETE FROM ' . $table);
    }
    $insert = $pdo->prepare(
        'INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json, style_json, is_active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)'
    );
    $punkt = static fn(float $x, float $y): string => json_encode(['type' => 'Point', 'coordinates' => [$x, $y]]);
    // 💣 DIE GEPFLEGTE traegt eine HOEHE, die andere nicht. Genau so liegt es live -- und das
// Hoehenfeld der Karte liest Gipfel-Labels als Stuetzpunkte (terrain-store.php). Wer hier die
// falsche loescht, nimmt der Karte einen Stuetzpunkt.
    $insert->execute([$DS_A, 'Drei Schwestern', 'label', 'berggipfel', 'Point', $punkt(525.9, 647.8),
        json_encode($NEST('drei-schwestern') + ['height_schritt' => 2100]), '{}', '2026-08-20 12:38:09']);
    $insert->execute([$DS_B, 'Drei Schwestern', 'label', 'berggipfel', 'Point', $punkt(524.1, 646.3), json_encode($NEST('drei-schwestern')), '{}', '2026-08-07 09:50:13']);
    $insert->execute([$FK_FLAECHE, 'Finsterkamm', 'label', 'gebirge', 'Point', $punkt(500.0, 600.0),
        json_encode($NEST('finsterkamm') + ['ecosystem_region_public_id' => 'r-fk']), '{}', '2026-08-01 00:00:00']);
    $insert->execute([$FK_FREI, 'Finsterkamm', 'label', 'gebirge', 'Point', $punkt(501.0, 601.0), json_encode($NEST('finsterkamm')), '{}', '2026-08-02 00:00:00']);

    $pdo->prepare('INSERT INTO ecosystem_region (public_id, name, kind, region_type, origin, label_public_id, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)')
        ->execute(['r-fk', 'Finsterkamm', 'topographie', 'gebirge', 'manual', $FK_FLAECHE]);
    $regionId = (int) $pdo->query("SELECT id FROM ecosystem_region WHERE public_id = 'r-fk'")->fetchColumn();
    $pdo->prepare('INSERT INTO ecosystem_area (public_id, region_id, geometry_geojson, min_x, min_y, max_x, max_y, is_active) VALUES (?, ?, ?, 0, 0, 1, 1, 1)')
        ->execute(['a-fk', $regionId, json_encode(['type' => 'Polygon', 'coordinates' => [[[0, 0], [1, 0], [1, 1], [0, 0]]]])]);
};

$aktiv = static function (PDO $pdo, string $table, string $publicId): int {
    $s = $pdo->prepare('SELECT is_active FROM ' . $table . ' WHERE public_id = :p');
    $s->execute(['p' => $publicId]);

    return (int) $s->fetchColumn();
};

// ================================================================================================
// 0. DER ZEUGE: in genau dieser Fixture NIMMT das Loeschen der Beschriftung die Flaeche mit.
// ================================================================================================
$seed($pdo);
assert($aktiv($pdo, 'ecosystem_area', 'a-fk') === 1, 'Ausgangszustand: die Flaeche ist da');
avesmapsDeleteMapFeature($pdo, ['public_id' => $FK_FLAECHE], ['id' => 7]);
assert($aktiv($pdo, 'map_features', $FK_FLAECHE) === 0, 'die Beschriftung ist weg');
assert(
    $aktiv($pdo, 'ecosystem_area', 'a-fk') === 0,
    '🔴 DER ZEUGE: der gewoehnliche Loeschweg nimmt die gezeichnete Flaeche mit -- die Falle ist in dieser Fixture echt'
);
assert($aktiv($pdo, 'ecosystem_region', 'r-fk') === 0, 'und die Region gleich mit');

// ================================================================================================
// 1. avesmapsConflictLabelDeleteRefusal -- die reine Weiche
// ================================================================================================
// Der Regelfall: eine freie Beschriftung mit mindestens einem Zwilling darf weg.
assert(avesmapsConflictLabelDeleteRefusal('label', true, '', 1) === '');

// 🔴 Flaechengebunden: NIE. Das ist der Riegel vor der Kaskade.
$wegenFlaeche = avesmapsConflictLabelDeleteRefusal('label', true, 'r-fk', 1);
assert($wegenFlaeche !== '', 'eine flaechengebundene Beschriftung wird abgelehnt');
assert(mb_stripos($wegenFlaeche, 'Landschaftsfläche') !== false, 'und der Grund sagt warum: ' . $wegenFlaeche);

// 🔴 FEHLT DIE PRUEFUNG, WIRD NICHT GELOESCHT. Ein `function_exists`, das faelschlich false liefert,
// darf nicht in „also gehoert sie zu keiner Flaeche" umschlagen -- das waere genau die Bauart, bei
// der ein stiller Ausfall die gefaehrliche Richtung nimmt.
assert(avesmapsConflictLabelDeleteRefusal('label', false, '', 1) !== '', 'ohne Landschaften-Pruefung: Absage');

// Die letzte ihres Namens bleibt stehen -- sonst nimmt „Dublette aufraeumen" dem Objekt seinen Namen.
assert(avesmapsConflictLabelDeleteRefusal('label', true, '', 0) !== '');

// Und nur Beschriftungen: dieser Weg ist kein allgemeiner Loeschknopf fuer Kartenobjekte.
assert(avesmapsConflictLabelDeleteRefusal('location', true, '', 1) !== '');
assert(avesmapsConflictLabelDeleteRefusal('path', true, '', 1) !== '');

// ================================================================================================
// 2. avesmapsConflictDeleteLabel -- flaechengebunden: Absage, und NICHTS bewegt sich
// ================================================================================================
$seed($pdo);
$abgelehnt = avesmapsConflictDeleteLabel($pdo, $FK_FLAECHE, 7);
assert($abgelehnt['ok'] === false, 'die flaechengebundene Beschriftung wird abgelehnt');
assert(mb_stripos((string) $abgelehnt['reason'], 'Landschaftsfläche') !== false, (string) $abgelehnt['reason']);
assert($aktiv($pdo, 'map_features', $FK_FLAECHE) === 1, 'die Beschriftung steht noch');
assert($aktiv($pdo, 'ecosystem_area', 'a-fk') === 1, '🔴 und ihre gezeichnete Flaeche auch');
assert($aktiv($pdo, 'ecosystem_region', 'r-fk') === 1, 'und die Region auch');
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0, 'eine Absage schreibt gar nichts');

// ================================================================================================
// 3. Der gemeldete Fall: genau EINE der beiden Beschriftungen verschwindet
// ================================================================================================
$seed($pdo);
$geloescht = avesmapsConflictDeleteLabel($pdo, $DS_B, 7);
assert($geloescht['ok'] === true, 'die freie Dublette darf weg');
assert($geloescht['changed'] === true);
assert($geloescht['public_id'] === $DS_B);
assert($aktiv($pdo, 'map_features', $DS_B) === 0, 'die Dublette ist weg');
assert($aktiv($pdo, 'map_features', $DS_A) === 1, '🔴 und ihr Zwilling steht noch -- GENAU EINE, nicht beide');
assert($aktiv($pdo, 'ecosystem_area', 'a-fk') === 1, 'die fremde Landschaft bleibt unberuehrt');
assert($aktiv($pdo, 'ecosystem_region', 'r-fk') === 1);
// Umkehrbar wie jedes Loeschen im Editor: eine Protokollzeile mit dem Zustand davor.
$protokoll = $pdo->query("SELECT action, before_json FROM map_audit_log")->fetchAll(PDO::FETCH_ASSOC);
assert(count($protokoll) === 1, 'genau eine Protokollzeile: ' . count($protokoll));
assert($protokoll[0]['action'] === 'delete_feature');
assert(str_contains((string) $protokoll[0]['before_json'], $DS_B));

// Und danach ist die verbliebene die LETZTE -- sie laesst sich nicht auch noch loeschen.
$letzte = avesmapsConflictDeleteLabel($pdo, $DS_A, 7);
assert($letzte['ok'] === false, 'die letzte Beschriftung des Objekts bleibt stehen');
assert($aktiv($pdo, 'map_features', $DS_A) === 1);

// ================================================================================================
// 4. Der Weg von aussen: avesmapsConflictResolve, mode 'delete_label'
// ================================================================================================
$seed($pdo);
$antwort = avesmapsConflictResolve($pdo, ['mode' => 'delete_label', 'targets' => [['type' => 'label', 'id' => $DS_B]]], 7);
assert($antwort['ok'] === true);
assert($antwort['applied'] === 1, 'eine Beschriftung wurde entfernt');
assert($aktiv($pdo, 'map_features', $DS_B) === 0);
assert($aktiv($pdo, 'map_features', $DS_A) === 1);

// Die Absage reist als `reason` mit, wie bei den uebrigen Verben -- der Client zeigt sie an.
$seed($pdo);
$abgelehntAussen = avesmapsConflictResolve($pdo, ['mode' => 'delete_label', 'targets' => [['type' => 'label', 'id' => $FK_FLAECHE]]], 7);
assert($abgelehntAussen['applied'] === 0);
assert($abgelehntAussen['results'][0]['ok'] === false);
assert(mb_stripos((string) $abgelehntAussen['results'][0]['reason'], 'Landschaftsfläche') !== false);
assert($aktiv($pdo, 'ecosystem_area', 'a-fk') === 1, '🔴 auch ueber den aeusseren Weg bleibt die Flaeche stehen');

// ================================================================================================
// 5. Eine ABGELEHNTE Reparatur darf nicht als „erledigt" verbucht werden
// ================================================================================================
// 💣 Der Endpunkt schrieb nach JEDEM `resolve` die Entscheidung „resolved" -- auch nach einem, der
// gar nichts geaendert hat. Bei den Wiki-Verben fiel das kaum auf; hier waere es ein Loch: der
// Editor klickt „Beschriftung loeschen", der Server lehnt wegen der Landschaftsflaeche ab, die
// Fehlermeldung kommt -- und der Fall verlaesst trotzdem die Liste „Offen" und steht unter
// „Archiviert". Ein Fall, den niemand repariert hat, sieht dann aus wie einer, den jemand bewusst
// so gelassen hat.
assert(avesmapsConflictShouldRecordRepair(['ok' => true, 'applied' => 1]) === true);
assert(avesmapsConflictShouldRecordRepair(['ok' => true, 'applied' => 0]) === false, 'nichts geaendert = nichts verbucht');
assert(avesmapsConflictShouldRecordRepair([]) === false, 'eine Antwort ohne Zahl gilt als „nichts geaendert"');

// Und dieselbe Frage an den echten Antworten von oben, damit die Zusicherung nicht bloss ueber
// erfundene Arrays laeuft.
$seed($pdo);
assert(avesmapsConflictShouldRecordRepair(
    avesmapsConflictResolve($pdo, ['mode' => 'delete_label', 'targets' => [['type' => 'label', 'id' => $FK_FLAECHE]]], 7)
) === false, 'die abgelehnte Loeschung wird nicht verbucht');
$seed($pdo);
assert(avesmapsConflictShouldRecordRepair(
    avesmapsConflictResolve($pdo, ['mode' => 'delete_label', 'targets' => [['type' => 'label', 'id' => $DS_B]]], 7)
) === true, 'die gelungene schon');

// ================================================================================================
// 6. Der ABLAUF: die ganze Erkennerkette gegen eine echte Datenbank
// ================================================================================================
// 🔴 Ein gruener Test ueber reine Funktionen beweist nichts darueber, ob sie jemand AUFRUFT. Hier
// laeuft avesmapsConflictDetectAll() -- Leser, Regel, Entdopplung -- auf derselben Karte, in der
// der Zeuge oben die Kaskade ausgeloest hat.
$seed($pdo);
$alleFaelle = avesmapsConflictDetectAll($pdo);

$dubletten = array_values(array_filter($alleFaelle, static fn(array $c): bool => $c['rule_id'] === 'label.duplicate'));
assert(count($dubletten) === 2, 'zwei Dubletten-Faelle: ' . count($dubletten));
$titel = array_map(static fn(array $c): string => (string) $c['title'], $dubletten);
sort($titel);
assert($titel === ['Drei Schwestern', 'Finsterkamm'], json_encode($titel));

// Und die Loeschbarkeit stimmt mit dem ueberein, was der Schreibpfad oben wirklich getan hat: beide
// „Drei Schwestern" liessen sich anbieten, beim Finsterkamm nur die freie.
$loeschbarJeFall = [];
foreach ($dubletten as $fall) {
    $loeschbarJeFall[$fall['title']] = count(array_filter($fall['parties'], static fn(array $p): bool => $p['deletable'] === true));
}
assert($loeschbarJeFall['Drei Schwestern'] === 2, json_encode($loeschbarJeFall));
assert($loeschbarJeFall['Finsterkamm'] === 1, json_encode($loeschbarJeFall));

// Der Stand reist bis hierher durch -- ohne ihn stuenden zwei ununterscheidbare Zeilen mit je einem
// Loeschknopf vor dem Editor.
$schwesternFall = $dubletten[array_search('Drei Schwestern', array_column($dubletten, 'title'), true)];
$staende = array_column($schwesternFall['parties'], 'updated_at', 'id');
assert($staende[$DS_A] === '2026-08-20 12:38:09', json_encode($staende));
// Und die Hoehe ebenso -- normalisiert zur Zahl, „nicht erfasst" bleibt null.
$hoehenDurchgereicht = array_column($schwesternFall['parties'], 'height_schritt', 'id');
assert($hoehenDurchgereicht[$DS_A] === 2100.0, json_encode($hoehenDurchgereicht));
assert($hoehenDurchgereicht[$DS_B] === null, json_encode($hoehenDurchgereicht));
assert($staende[$DS_B] === '2026-08-07 09:50:13', json_encode($staende));

// 💣 UND DERSELBE FALL STEHT NICHT ZWEIMAL DA. Beide Nester tragen dieselbe Wiki-Adresse, die
// Artikel-Regel wuerde sie also ebenfalls melden -- mit Knoepfen, die den doppelten Namen auf der
// Karte nicht loswerden. Die Entdopplung laeuft im echten Durchlauf, nicht nur im reinen Test.
$geteilteArtikel = array_values(array_filter($alleFaelle, static fn(array $c): bool => $c['rule_id'] === 'wiki.shared_article'));
assert($geteilteArtikel === [], 'die Artikel-Regel meldet dieselben Parteien nicht noch einmal: '
    . json_encode(array_map(static fn(array $c): string => (string) $c['title'], $geteilteArtikel)));

// ================================================================================================
// 7. Ohne Landschaften-Tabellen wird ABGELEHNT, nicht geworfen -- und schon gar nicht geloescht
// ================================================================================================
// ⚠️ avesmapsEcosystemRegionPublicIdOfLabel() fragt `ecosystem_region` OHNE try/catch. Auf einer
// Installation ohne die Landschaften-Tabellen fliegt dort eine PDOException -- der Listenpfad faengt
// das ab (avesmapsEcosystemReadLabelRegionMap), der Loeschpfad tat es nicht und antwortete mit 500.
// Ein 500 ist zwar die sichere Richtung (es wird nichts geloescht), aber der Editor liest daraus
// „kaputt" statt „geht hier nicht". Die Ausnahme heisst jetzt „ich konnte nicht nachsehen" und
// landet in derselben Absage wie ein fehlendes function_exists.
$ohneLandschaft = new AvesmapsLabelDeleteTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$ohneLandschaft->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
    revision INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, updated_by INTEGER NULL,
    updated_at TEXT DEFAULT ""
)');
$einfuegen = $ohneLandschaft->prepare(
    'INSERT INTO map_features (public_id, name, feature_type, feature_subtype, properties_json, is_active)
     VALUES (?, ?, ?, ?, ?, 1)'
);
$einfuegen->execute([$DS_A, 'Drei Schwestern', 'label', 'berggipfel', json_encode($NEST('drei-schwestern'))]);
$einfuegen->execute([$DS_B, 'Drei Schwestern', 'label', 'berggipfel', json_encode($NEST('drei-schwestern'))]);

// Das Protokoll wird UMGELENKT statt unterdrueckt: dass der Fehler ueberhaupt irgendwo landet,
// ist Teil der Zusicherung -- ein stiller catch waere die Bauart, die AGENTS.md anschreibt.
$protokollDatei = tempnam(sys_get_temp_dir(), 'avesmaps-konflikt-');
$altesProtokoll = ini_get('error_log');
ini_set('error_log', $protokollDatei);
$ohneAntwort = avesmapsConflictDeleteLabel($ohneLandschaft, $DS_B, 7);
ini_set('error_log', $altesProtokoll === false ? '' : $altesProtokoll);
$protokoll = (string) file_get_contents($protokollDatei);
@unlink($protokollDatei);
assert(mb_stripos($protokoll, 'ecosystem_region') !== false, 'der echte Grund steht im Fehlerprotokoll: ' . $protokoll);
assert($ohneAntwort['ok'] === false, 'ohne Landschaften-Tabellen: Absage statt Ausnahme');
assert(mb_stripos((string) $ohneAntwort['reason'], 'Landschaften') !== false, (string) $ohneAntwort['reason']);
assert(
    (int) $ohneLandschaft->query("SELECT is_active FROM map_features WHERE public_id = '" . $DS_B . "'")->fetchColumn() === 1,
    'und geloescht wird dabei nichts'
);

fwrite(STDOUT, "conflict-label-delete-test: OK\n");
