<?php

declare(strict_types=1);

/**
 * Die Gipfelhoehen-Korrektur (avesmapsRepairPeakHeights) -- WIRKLICH GEFAHREN, nicht gelesen.
 *
 * Owner-Auftrag 27.09.2026, aus der Recherche "Gipfelhoehen-Pruefliste": 25 einzeln stehende
 * Berggipfel-Labels tragen die Platzhalterhoehe 5.000 Schritt oder gar keine. Diese Aktion schreibt
 * eine von Hand geprueften Korrekturtabelle ein -- Trockenlauf-Vorgabe, scharf erst mit `apply: true`.
 *
 * 🔴 GEMATCHT WIRD NUR (feature_type='label', feature_subtype='berggipfel', is_active=1, name=X).
 * Die Recherche warnt selbst vor Namens-Kollisionen (gleichnamiges Herrenhaus/Ort/Baronie/Schloss/
 * Siedlung) -- der Test haelt fest, dass so ein Nachbar (andere feature_type/subtype-Kombination)
 * unberuehrt bleibt, UND dass zwei gleichnamige Berggipfel-Labels als "mehrdeutig" uebersprungen
 * werden statt eine beliebige Zeile zu treffen.
 *
 * ⚠️ DER PDO-AUFSATZ UEBERSETZT NUR FUERS TESTEN. `avesmapsNextMapRevision` benutzt MySQLs
 * `ON DUPLICATE KEY UPDATE`, das SQLite nicht kennt. Die Produktionsform bleibt unangetastet und der
 * TEST passt sich an (AGENTS.md §9), dieselbe Bauform wie kreuzungstyp-reparatur-test.php.
 *
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *     api/_internal/map/__tests__/gipfelhoehen-korrektur-test.php
 * Exit 0 = alle Zusicherungen bestanden.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- dieser Test fuehrt den Schreibweg wirklich aus.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../features.php';

class AvesmapsGipfelTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }

        return parent::exec($statement);
    }
}

$checks = 0;
$user = ['id' => 15, 'username' => 'pruefer'];

$pdo = new AvesmapsGipfelTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
    is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 1,
    updated_by INTEGER NULL, min_x REAL, min_y REAL, max_x REAL, max_y REAL
)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('CREATE TABLE map_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
    actor_user_id INTEGER, before_json TEXT, after_json TEXT
)');

$punkt = json_encode(['type' => 'Point', 'coordinates' => [463.156, 451.156]]);

/**
 * Sechs der 25 Namen sind belegt, mit gezielt unterschiedlichem Ausgang:
 *  - Bassenhorn:      klarer Treffer, Hoehe 5000 -> 800, Art bleibt.
 *  - Chap Tabungapa:  klarer Treffer, Hoehe FEHLT nach der Korrektur (kein Quellenwert), Art -> vulkan.
 *  - Goldenhelm:      klarer Treffer, nur die Hoehe aendert sich (60), die Art bleibt bewusst offen.
 *  - Helmenstein:     klarer Treffer (Berggipfel) NEBEN einem gleichnamigen Ort (Herrenhaus) --
 *                      der Ort darf die Kollisionspruefung nicht ausloesen und bleibt unberuehrt.
 *  - Torbelstein:     ZWEI gleichnamige Berggipfel-Labels -> mehrdeutig, keins wird angefasst.
 *  - Zwanfirszahn:    ein aktiver Treffer (ohne Hoehenwert im Nest) PLUS ein inaktiver Namensvetter
 *                      im Papierkorb -- der inaktive darf weder mitzaehlen noch mitgeschrieben werden.
 *  - Ceälan:          bereits ein 'vulkan'-Label (NICHT mehr 'berggipfel') NEBEN einer gleichnamigen
 *                      Landschaftsflaeche (feature_type='region', eine Insel) -- der Live-Befund vom
 *                      27.09.2026: die Forschungsmomentaufnahme war fuer die ART schon ueberholt, nur
 *                      die Hoehe fehlte noch. Die Flaeche darf nie als Kollision zaehlen.
 * Die uebrigen 18 Namen der Tabelle bleiben ungesetzt und muessen als "nicht gefunden" zurueckkommen.
 */
$seed = static function (PDO $pdo) use ($punkt): void {
    $pdo->exec('DELETE FROM map_features');
    $pdo->exec('DELETE FROM map_audit_log');
    $pdo->exec('DELETE FROM map_revision');
    $insert = $pdo->prepare(
        'INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type,
             geometry_json, properties_json, is_active, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 3)'
    );

    $insert->execute(['11111111-1111-4111-8111-111111111111', 'Bassenhorn', 'label', 'berggipfel', 'Point', $punkt,
        json_encode(['name' => 'Bassenhorn', 'feature_type' => 'label', 'feature_subtype' => 'berggipfel', 'height_schritt' => 5000.0]), 1]);

    $insert->execute(['22222222-2222-4222-8222-222222222222', 'Chap Tabungapa', 'label', 'berggipfel', 'Point', $punkt,
        json_encode(['name' => 'Chap Tabungapa', 'feature_type' => 'label', 'feature_subtype' => 'berggipfel', 'height_schritt' => 5000.0]), 1]);

    $insert->execute(['33333333-3333-4333-8333-333333333333', 'Goldenhelm', 'label', 'berggipfel', 'Point', $punkt,
        json_encode(['name' => 'Goldenhelm', 'feature_type' => 'label', 'feature_subtype' => 'berggipfel', 'height_schritt' => 5000.0]), 1]);

    $insert->execute(['44444444-4444-4444-8444-444444444444', 'Helmenstein', 'label', 'berggipfel', 'Point', $punkt,
        json_encode(['name' => 'Helmenstein', 'feature_type' => 'label', 'feature_subtype' => 'berggipfel', 'height_schritt' => 5000.0]), 1]);
    // Das gleichnamige Herrenhaus -- ein ganz anderes Kartenobjekt, kein Label, kein Berggipfel.
    $insert->execute(['44444444-aaaa-4444-8444-444444444444', 'Helmenstein', 'location', 'gebaeude', 'Point', $punkt,
        json_encode(['name' => 'Helmenstein', 'feature_type' => 'location', 'feature_subtype' => 'gebaeude']), 1]);

    $insert->execute(['55555555-5555-4555-8555-555555555555', 'Torbelstein', 'label', 'berggipfel', 'Point', $punkt,
        json_encode(['name' => 'Torbelstein', 'feature_type' => 'label', 'feature_subtype' => 'berggipfel', 'height_schritt' => 5000.0]), 1]);
    $insert->execute(['55555555-bbbb-4555-8555-555555555555', 'Torbelstein', 'label', 'berggipfel', 'Point', $punkt,
        json_encode(['name' => 'Torbelstein', 'feature_type' => 'label', 'feature_subtype' => 'berggipfel', 'height_schritt' => 5000.0]), 1]);

    $insert->execute(['66666666-6666-4666-8666-666666666666', 'Zwanfirszahn', 'label', 'berggipfel', 'Point', $punkt,
        json_encode(['name' => 'Zwanfirszahn', 'feature_type' => 'label', 'feature_subtype' => 'berggipfel']), 1]);
    $insert->execute(['66666666-cccc-4666-8666-666666666666', 'Zwanfirszahn', 'label', 'berggipfel', 'Point', $punkt,
        json_encode(['name' => 'Zwanfirszahn', 'feature_type' => 'label', 'feature_subtype' => 'berggipfel', 'height_schritt' => 5000.0]), 0]);

    // Ceälan: bereits 'vulkan' (kein 'berggipfel' mehr) -- die Familie muss ueber avesmapsReadLabelSubtype()s
    // Berggipfel/Vulkan-Verwandtschaft gehen, nicht ueber 'berggipfel' allein.
    $insert->execute(['77777777-7777-4777-8777-777777777777', 'Ceälan', 'label', 'vulkan', 'Point', $punkt,
        json_encode(['name' => 'Ceälan', 'feature_type' => 'label', 'feature_subtype' => 'vulkan', 'height_schritt' => 5000.0]), 1]);
    // Die gleichnamige Landschaftsflaeche (Insel) -- ein REGION-Objekt, kein Label, traegt kein
    // height_schritt und darf nie als Kollision zaehlen.
    $insert->execute(['77777777-dddd-4777-8777-777777777777', 'Ceälan', 'region', 'insel', 'Polygon',
        json_encode(['type' => 'Polygon', 'coordinates' => [[[584.0, 680.0], [585.0, 680.0], [585.0, 682.0], [584.0, 682.0], [584.0, 680.0]]]]),
        json_encode(['name' => 'Ceälan', 'feature_type' => 'region', 'feature_subtype' => 'insel']), 1]);
};

$zeileVon = static function (PDO $pdo, string $publicId): array {
    $s = $pdo->prepare('SELECT * FROM map_features WHERE public_id = ?');
    $s->execute([$publicId]);
    $zeile = $s->fetch(PDO::FETCH_ASSOC);
    assert(is_array($zeile), 'Testfehler: Zeile nicht gefunden: ' . $publicId);

    return $zeile;
};

// ---- 0) Die Tabelle selbst: 25 Eintraege, eindeutige Namen, die dokumentierten Sonderfaelle -----

assert(count(AVESMAPS_GIPFELHOEHEN_KORREKTUREN) === 25, '0: die Liste hat 25 Eintraege (ist: ' . count(AVESMAPS_GIPFELHOEHEN_KORREKTUREN) . ')');
$checks++;
$namen = array_column(AVESMAPS_GIPFELHOEHEN_KORREKTUREN, 'name');
assert(count($namen) === count(array_unique($namen)), '0: kein Name doppelt in der Tabelle selbst');
$checks++;
$nachName = [];
foreach (AVESMAPS_GIPFELHOEHEN_KORREKTUREN as $eintrag) {
    $nachName[$eintrag['name']] = $eintrag;
}
assert($nachName['Chap Tabungapa']['height_schritt'] === null, '0: Chap Tabungapa hat KEINEN Hoehenwert -- der Platzhalter wird entfernt, nicht ersetzt');
$checks++;
assert($nachName['Chap Tabungapa']['feature_subtype'] === 'vulkan', '0: Chap Tabungapa wird zum Vulkan');
$checks++;
assert($nachName['Goldenhelm']['feature_subtype'] === null, '0: Goldenhelm behaelt seine Art -- Huegel/Vulkan ist nicht eindeutig');
$checks++;
assert($nachName['Goldenhelm']['height_schritt'] === 60.0, '0: Goldenhelms Hoehe ist belegt (60)');
$checks++;

// ---- 1) TROCKENLAUF: findet, meldet, schreibt aber nichts ---------------------------------------

$seed($pdo);
$trocken = avesmapsRepairPeakHeights($pdo, $user, true);

assert($trocken['dry_run'] === true, '1: der Trockenlauf meldet sich als solcher');
$checks++;
assert($trocken['gefunden'] === 6, '1: sechs eindeutige Treffer (ist: ' . $trocken['gefunden'] . ')');
$checks++;
assert($trocken['repariert'] === 0, '1: der Trockenlauf schreibt nichts');
$checks++;
assert($trocken['mehrdeutig'] === ['Torbelstein'], '1: Torbelstein ist als mehrdeutig gemeldet');
$checks++;
assert(count($trocken['nicht_gefunden']) === 18, '1: die uebrigen 18 Namen sind nicht gefunden (ist: ' . count($trocken['nicht_gefunden']) . ')');
$checks++;
assert(!in_array('Ceälan', $trocken['nicht_gefunden'], true), '1: Ceälan steht nicht unter "nicht gefunden" -- die Familie reicht ueber "berggipfel" hinaus');
$checks++;
assert(!in_array('Bassenhorn', $trocken['nicht_gefunden'], true), '1: Bassenhorn steht nicht unter "nicht gefunden"');
$checks++;
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0, '1: kein Protokolleintrag');
$checks++;
assert((int) $pdo->query('SELECT COUNT(*) FROM map_revision')->fetchColumn() === 0, '1: keine Revision gebumpt');
$checks++;
$zeile = $zeileVon($pdo, '11111111-1111-4111-8111-111111111111');
assert((float) json_decode((string) $zeile['properties_json'], true)['height_schritt'] === 5000.0, '1: Bassenhorn steht im Trockenlauf unveraendert da');
$checks++;

// ---- 2) SCHARF: repariert genau die sechs eindeutigen Treffer ------------------------------------

$seed($pdo);
$scharf = avesmapsRepairPeakHeights($pdo, $user, false);

assert($scharf['dry_run'] === false, '2: der scharfe Lauf meldet sich als solcher');
$checks++;
assert($scharf['repariert'] === 6, '2: sechs Zeilen repariert (ist: ' . $scharf['repariert'] . ')');
$checks++;

$bassenhorn = json_decode((string) $zeileVon($pdo, '11111111-1111-4111-8111-111111111111')['properties_json'], true);
assert((float) $bassenhorn['height_schritt'] === 800.0, '2: Bassenhorn traegt jetzt 800 Schritt');
$checks++;
assert($zeileVon($pdo, '11111111-1111-4111-8111-111111111111')['feature_subtype'] === 'berggipfel', '2: Bassenhorn bleibt ein Berggipfel');
$checks++;

$chap = $zeileVon($pdo, '22222222-2222-4222-8222-222222222222');
assert($chap['feature_subtype'] === 'vulkan', '2: Chap Tabungapa ist jetzt ein Vulkan');
$checks++;
$chapNest = json_decode((string) $chap['properties_json'], true);
assert(!array_key_exists('height_schritt', $chapNest), '2: Chap Tabungapa hat KEINEN Hoehenwert -- entfernt, nicht auf 0 gesetzt');
$checks++;

$goldenhelm = json_decode((string) $zeileVon($pdo, '33333333-3333-4333-8333-333333333333')['properties_json'], true);
assert((float) $goldenhelm['height_schritt'] === 60.0, '2: Goldenhelm traegt jetzt 60 Schritt');
$checks++;
assert($zeileVon($pdo, '33333333-3333-4333-8333-333333333333')['feature_subtype'] === 'berggipfel', '2: Goldenhelms Art bleibt unangetastet');
$checks++;

$helmensteinBerg = json_decode((string) $zeileVon($pdo, '44444444-4444-4444-8444-444444444444')['properties_json'], true);
assert((float) $helmensteinBerg['height_schritt'] === 800.0, '2: der Helmenstein-Berggipfel wird korrigiert');
$checks++;
// Die tragende Zusicherung: der gleichnamige ORT bleibt Zeichen fuer Zeichen unberuehrt.
$helmensteinOrt = $zeileVon($pdo, '44444444-aaaa-4444-8444-444444444444');
assert($helmensteinOrt['feature_type'] === 'location' && $helmensteinOrt['feature_subtype'] === 'gebaeude', '2: das gleichnamige Herrenhaus bleibt ein Ort');
$checks++;
assert((int) $helmensteinOrt['revision'] === 3, '2: und seine Revision aendert sich nicht (Ausgangswert 3)');
$checks++;

// Torbelstein: mehrdeutig -- BEIDE Zeilen bleiben unangetastet.
foreach (['55555555-5555-4555-8555-555555555555', '55555555-bbbb-4555-8555-555555555555'] as $id) {
    $nest = json_decode((string) $zeileVon($pdo, $id)['properties_json'], true);
    assert((float) $nest['height_schritt'] === 5000.0, '2: mehrdeutiges Torbelstein bleibt bei 5000 (id ' . $id . ')');
    $checks++;
}

// Zwanfirszahn: nur der AKTIVE Namensvetter wird angefasst.
$zwanfirszahnAktiv = json_decode((string) $zeileVon($pdo, '66666666-6666-4666-8666-666666666666')['properties_json'], true);
assert((float) $zwanfirszahnAktiv['height_schritt'] === 2000.0, '2: der aktive Zwanfirszahn traegt jetzt 2000 Schritt');
$checks++;
$zwanfirszahnInaktiv = $zeileVon($pdo, '66666666-cccc-4666-8666-666666666666');
$zwanfirszahnInaktivNest = json_decode((string) $zwanfirszahnInaktiv['properties_json'], true);
assert((float) $zwanfirszahnInaktivNest['height_schritt'] === 5000.0, '2: der inaktive Papierkorb-Namensvetter bleibt bei 5000');
$checks++;
assert((int) $zwanfirszahnInaktiv['is_active'] === 0, '2: und bleibt inaktiv');
$checks++;

// Ceälan: das bereits umgetypte Vulkan-Label bekommt seine Hoehe, die Art bleibt Vulkan (Vorschlag
// nennt keine Aenderung). Die gleichnamige Landschaftsflaeche bleibt Zeichen fuer Zeichen unberuehrt.
$ceaelan = $zeileVon($pdo, '77777777-7777-4777-8777-777777777777');
assert($ceaelan['feature_subtype'] === 'vulkan', '2: Ceälan bleibt ein Vulkan');
$checks++;
$ceaelanNest = json_decode((string) $ceaelan['properties_json'], true);
assert((float) $ceaelanNest['height_schritt'] === 300.0, '2: Ceälan traegt jetzt 300 Schritt');
$checks++;
$ceaelanFlaeche = $zeileVon($pdo, '77777777-dddd-4777-8777-777777777777');
assert($ceaelanFlaeche['feature_type'] === 'region' && $ceaelanFlaeche['feature_subtype'] === 'insel', '2: die gleichnamige Insel-Flaeche bleibt eine Region');
$checks++;
assert((int) $ceaelanFlaeche['revision'] === 3, '2: und ihre Revision aendert sich nicht (Ausgangswert 3)');
$checks++;

// ---- 3) Kartenrevision: EINMAL gebumpt, alle sechs reparierten Zeilen tragen sie ----------------

$revision = (int) $pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn();
assert($revision > 0, '3: die Kartenrevision wurde gebumpt');
$checks++;
assert($scharf['revision'] === $revision, '3: der Lauf meldet die Revision, die er gesetzt hat');
$checks++;
assert($revision === 2, '3: genau EIN Bump fuer alle sechs Zeilen (ist: ' . $revision . ')');
$checks++;
foreach (['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777'] as $id) {
    assert((int) $zeileVon($pdo, $id)['revision'] === $revision, '3: reparierte Zeile traegt die neue Revision (' . $id . ')');
    $checks++;
}
// Die Unbeteiligten behalten ihren Ausgangswert 3 -- eine Reparatur, die zu viel anfasst, ist
// schlimmer als der Fehler.
foreach (['55555555-5555-4555-8555-555555555555', '55555555-bbbb-4555-8555-555555555555', '66666666-cccc-4666-8666-666666666666', '77777777-dddd-4777-8777-777777777777'] as $id) {
    assert((int) $zeileVon($pdo, $id)['revision'] === 3, '3: unbeteiligte Zeile behaelt ihre alte Revision (' . $id . ')');
    $checks++;
}

// ---- 4) Das Protokoll: je reparierter Zeile ein Eintrag, mit dem Stand davor --------------------

$eintraege = $pdo->query("SELECT feature_id, action, actor_user_id, before_json, after_json FROM map_audit_log ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
assert(count($eintraege) === 6, '4: sechs Protokolleintraege (ist: ' . count($eintraege) . ')');
$checks++;
foreach ($eintraege as $eintrag) {
    assert($eintrag['action'] === 'repair_peak_heights', '4: unter eigenem Namen protokolliert');
    $checks++;
    assert((int) $eintrag['actor_user_id'] === 15, '4: mit der handelnden Person');
    $checks++;
}
$chapEintrag = null;
foreach ($eintraege as $eintrag) {
    $danach = json_decode((string) $eintrag['after_json'], true);
    if (($danach['public_id'] ?? '') === '22222222-2222-4222-8222-222222222222') {
        $chapEintrag = $eintrag;
    }
}
assert($chapEintrag !== null, '4: Chap Tabungapa hat einen Protokolleintrag');
$checks++;
$davor = json_decode((string) $chapEintrag['before_json'], true);
assert((float) json_decode((string) $davor['properties_json'], true)['height_schritt'] === 5000.0, '4: der Stand DAVOR (5000) ist festgehalten');
$checks++;
$danach = json_decode((string) $chapEintrag['after_json'], true);
assert($danach['feature_subtype'] === 'vulkan' && !array_key_exists('height_schritt', $danach['properties_json']), '4: und der Stand danach (Vulkan, keine Hoehe)');
$checks++;

// ---- 5) Anders als repair_crossing_type: diese Korrektur ist rueckgaengig zu machen -------------

assert(avesmapsUndoColumnsForAuditAction('repair_peak_heights') === ['feature_subtype', 'properties_json'], '5: die Undo-Spalten sind genau die, die das UPDATE schreibt');
$checks++;
assert(avesmapsCanUndoAuditAction('repair_peak_heights') === true, '5: und der Knopf bietet es an -- eine editorische Korrektur, keine Reparatur einer Beschaedigung');
$checks++;

fwrite(STDOUT, "OK -- {$checks} Zusicherungen bestanden.\n");
