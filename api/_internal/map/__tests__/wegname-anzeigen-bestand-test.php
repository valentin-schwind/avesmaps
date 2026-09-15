<?php

declare(strict_types=1);

/**
 * Der Bestandslauf „Wegname anzeigen" der Wiki-Wege -- WIRKLICH GEFAHREN, nicht gelesen.
 *
 * 🔴 DER ANLASS (Owner-Entscheid „Bestand bleibt", 15.09.2026): das Haekchen „Wegname anzeigen" wirkt kuenftig auch an
 * Wiki-Wegen. Bis dahin beschriftete die Karte jeden Wiki-Weg als Ganzes und las `show_label` dort nie -- live trugen von
 * 1.949 zugewiesenen Abschnitten nur 540 das Haekchen. Ohne diesen Lauf verloeren rund 1.400 ihren Namen auf der Karte.
 *
 * Zugesichert wird, was im Kopf von avesmapsWegnameAnzeigenBestand (api/_internal/map/features.php) steht:
 *   A  die Auswahl: aktiv, Weg, `wiki_path.wiki_key` nicht leer, `show_label` nicht streng `true`
 *   B  Trockenlauf ist die Vorgabe und schreibt NICHTS, auch keine Revision
 *   C  scharf: gedeckelt, eine Revision je Lauf, alle Zeilen des Laufs tragen sie; der Rest des Nests bleibt
 *   D  `updated_at`, `updated_by` unangetastet, KEIN Protokolleintrag (die Personen-Kappung loeschte sonst Geschichte)
 *   E  wiederholbar: der zweite Lauf nimmt den Rest, der dritte findet nichts und hebt keine Revision
 *   F  EINE TRANSAKTION: scheitert eine Zeile, steht keine geschrieben da und die Revision ist nicht gehoben
 *   G  die Aktion am Endpunkt: nur Admins, scharf nur mit `apply === true`
 *
 * ⚠️ DER PDO-AUFSATZ UEBERSETZT NUR FUERS TESTEN (`ON DUPLICATE KEY UPDATE` von avesmapsNextMapRevision) -- dieselbe Bauform
 * wie kreuzungstyp-reparatur-test.php. Die Produktionsform bleibt unangetastet (AGENTS.md §9).
 *
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *     api/_internal/map/__tests__/wegname-anzeigen-bestand-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- dieser Test fuehrt den Lauf wirklich aus.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../features.php';

final class AvesmapsWegnameBestandTestPdo extends PDO
{
    /** Einmaliger Zwischenruf direkt VOR dem Schreib-UPDATE des Laufs -- ein fremdes Speichern zwischen Lesen und Schreiben. */
    public ?Closure $zwischenruf = null;

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        // `FOR UPDATE` kennt SQLite nicht -- dieselbe Uebersetzung wie wege-gruppe-schreiben-test.php. Die Sperre selbst sichert der
        // Quelltext-Abschnitt I unten; das Verhalten bei einem fremden Speichern der Revisionsriegel (Abschnitt H).
        $query = str_replace('FOR UPDATE', '', $query);
        if ($this->zwischenruf !== null && str_contains($query, 'UPDATE map_features') && str_contains($query, 'updated_at = updated_at')) {
            $ruf = $this->zwischenruf;
            $this->zwischenruf = null;
            $ruf($this);
        }

        return parent::prepare($query, $options);
    }

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
$pruefe = static function (bool $bedingung, string $meldung) use (&$checks): void {
    $checks++;
    assert($bedingung, $meldung);
};

$pdo = new AvesmapsWegnameBestandTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
    is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 1,
    updated_by INTEGER NULL, updated_at TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL
)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('CREATE TABLE map_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
    actor_user_id INTEGER, before_json TEXT, after_json TEXT
)');

$RS2 = ['wiki_key' => 'reichsstrasse-2', 'name' => 'Reichsstraße 2', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_2'];
$RS1 = ['wiki_key' => 'reichsstrasse-1', 'name' => 'Reichsstraße 1'];

/**
 * Der Bestand in klein -- jede Zeile ein Fall der Auswahl. Die Reihenfolge ist die der ids und damit die des Laufs.
 * @return array<string,int> Bezeichnung -> id
 */
$seed = static function (PDO $pdo) use ($RS2, $RS1): array {
    $pdo->exec('DELETE FROM map_features');
    $pdo->exec('DELETE FROM map_audit_log');
    $pdo->exec('DELETE FROM map_revision');
    $pdo->exec('INSERT INTO map_revision (id, revision) VALUES (1, 40)');
    $zeilen = [
        // Ziele
        'ohne_haken' => ['path', 1, ['wiki_path' => $RS2, 'allowed_transports' => ['groupFoot'], 'transport_domain' => 'land', 'display_name' => 'Reichsstraße 2']],
        'haken_false' => ['path', 1, ['wiki_path' => $RS2, 'show_label' => false, 'wiki_path_weitere' => []]],
        'haken_eins' => ['path', 1, ['wiki_path' => $RS1, 'show_label' => 1]],
        // keine Ziele
        'haken_true' => ['path', 1, ['wiki_path' => $RS2, 'show_label' => true]],
        'ohne_wiki' => ['path', 1, ['show_label' => false, 'display_name' => 'Goblinpfad']],
        'inaktiv' => ['path', 0, ['wiki_path' => $RS2]],
        'leerer_key' => ['path', 1, ['wiki_path' => ['wiki_key' => '  ', 'name' => 'Kaputt']]],
        'ort' => ['location', 1, ['wiki_settlement' => ['wiki_key' => 'gareth', 'name' => 'Gareth']]],
        'nur_weitere' => ['path', 1, ['wiki_path_weitere' => [['wiki_key' => 'baerenpfad', 'name' => 'Bärenpfad']]]],
    ];
    $ids = [];
    $einfuegen = $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json, is_active, revision, updated_by, updated_at)
        VALUES (:public_id, :name, :feature_type, :feature_subtype, :geometry_type, :geometry_json, :properties_json, :is_active, 7, 99, :updated_at)');
    foreach ($zeilen as $bezeichnung => [$typ, $aktiv, $nest]) {
        $einfuegen->execute([
            'public_id' => 'pid-' . $bezeichnung,
            'name' => $bezeichnung,
            'feature_type' => $typ,
            'feature_subtype' => $typ === 'path' ? 'Reichsstrasse' : 'stadt',
            'geometry_type' => $typ === 'path' ? 'LineString' : 'Point',
            'geometry_json' => '{}',
            'properties_json' => json_encode($nest, JSON_UNESCAPED_UNICODE),
            'is_active' => $aktiv,
            'updated_at' => '2026-01-02 03:04:05',
        ]);
        $ids[$bezeichnung] = (int) $pdo->lastInsertId();
    }
    // Eine Zeile mit kaputtem JSON, in der das Wort trotzdem steht -- das LIKE findet sie, das Nest nicht.
    $pdo->exec("INSERT INTO map_features (public_id, name, feature_type, properties_json, is_active, revision, updated_at)
        VALUES ('pid-kaputt', 'kaputt', 'path', '{\"wiki_path\":{\"wiki_key\":\"x\"', 1, 7, '2026-01-02 03:04:05')");
    $ids['kaputt'] = (int) $pdo->lastInsertId();

    return $ids;
};

$zeileLesen = static function (PDO $pdo, int $id): array {
    $s = $pdo->prepare('SELECT * FROM map_features WHERE id = :id');
    $s->execute(['id' => $id]);

    return $s->fetch(PDO::FETCH_ASSOC);
};
$alleZeilen = static fn(PDO $pdo): array => $pdo->query('SELECT * FROM map_features ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
$kartenRevision = static fn(PDO $pdo): int => (int) $pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn();

// ── A) die reine Auswahl ─────────────────────────────────────────────────────────────────────────────────────────
$pruefe(avesmapsWegnameAnzeigenBestandBetrifft(['wiki_path' => $RS2]) === true, 'A1: ohne Haekchen ist ein Ziel');
$pruefe(avesmapsWegnameAnzeigenBestandBetrifft(['wiki_path' => $RS2, 'show_label' => false]) === true, 'A2: false ist ein Ziel');
$pruefe(avesmapsWegnameAnzeigenBestandBetrifft(['wiki_path' => $RS2, 'show_label' => '1']) === true, 'A3: "1" wird zu true normalisiert');
$pruefe(avesmapsWegnameAnzeigenBestandBetrifft(['wiki_path' => $RS2, 'show_label' => true]) === false, 'A4: true ist fertig');
$pruefe(avesmapsWegnameAnzeigenBestandBetrifft(['show_label' => false]) === false, 'A5: ohne Zuweisung kein Ziel');
$pruefe(avesmapsWegnameAnzeigenBestandBetrifft(['wiki_path' => ['wiki_key' => '']]) === false, 'A6: leerer Schluessel ist keine Zuweisung');
$pruefe(avesmapsWegnameAnzeigenBestandBetrifft(['wiki_path' => ['wiki_key' => ['x']]]) === false, 'A7: ein Schluessel, der kein Wert ist, auch nicht');
$pruefe(avesmapsWegnameAnzeigenBestandBetrifft(['wiki_path' => 'kaputt']) === false, 'A8: ein Nest, das keins ist, auch nicht');

// ── B) Trockenlauf ───────────────────────────────────────────────────────────────────────────────────────────────
$ids = $seed($pdo);
$vorher = $alleZeilen($pdo);
$trocken = avesmapsWegnameAnzeigenBestand($pdo);
$pruefe($trocken['dry_run'] === true, 'B1: ohne Angabe ist es ein Trockenlauf');
$pruefe($trocken['gefunden'] === 3, 'B2: genau die drei Ziele gefunden: ' . json_encode($trocken));
$pruefe($trocken['strassen'] === 2, 'B3: zwei Strassen (reichsstrasse-2, reichsstrasse-1): ' . json_encode($trocken));
$pruefe($trocken['gesetzt'] === 0 && $trocken['verbleibend'] === 3 && $trocken['revision'] === 0, 'B4: nichts gesetzt, keine Revision');
$pruefe(array_column($trocken['stichprobe'], 'public_id') === ['pid-ohne_haken', 'pid-haken_false', 'pid-haken_eins'],
    'B5: die Stichprobe nennt die Ziele in Lauf-Reihenfolge: ' . json_encode($trocken['stichprobe']));
$pruefe(array_column($trocken['stichprobe'], 'show_label_vorher') === [null, false, 1], 'B6: und ihren Stand vorher');
$pruefe($alleZeilen($pdo) === $vorher, 'B7: der Trockenlauf hat eine Zeile veraendert');
$pruefe($kartenRevision($pdo) === 40, 'B8: der Trockenlauf hat die Kartenrevision gehoben');

// ── C/D) scharf, gedeckelt ───────────────────────────────────────────────────────────────────────────────────────
$scharf = avesmapsWegnameAnzeigenBestand($pdo, false, 2);
$pruefe($scharf['dry_run'] === false && $scharf['gesetzt'] === 2 && $scharf['verbleibend'] === 1, 'C1: der Deckel greift: ' . json_encode($scharf));
$pruefe($scharf['deckel'] === 2, 'C2: der Deckel steht in der Antwort');
$pruefe($kartenRevision($pdo) === 41 && $scharf['revision'] === 41, 'C3: GENAU eine Revision je Lauf: ' . $kartenRevision($pdo));
foreach (['ohne_haken', 'haken_false'] as $bezeichnung) {
    $z = $zeileLesen($pdo, $ids[$bezeichnung]);
    $nest = json_decode((string) $z['properties_json'], true);
    $pruefe(($nest['show_label'] ?? null) === true, "C4: {$bezeichnung} traegt das Haekchen");
    $pruefe((int) $z['revision'] === 41, "C5: {$bezeichnung} traegt die Revision des Laufs -- sonst holt der Live-Abgleich sie nie");
    $pruefe($z['updated_at'] === '2026-01-02 03:04:05', "D1: {$bezeichnung}: updated_at angefasst");
    $pruefe((int) $z['updated_by'] === 99, "D2: {$bezeichnung}: updated_by angefasst");
    $pruefe($z['name'] === $bezeichnung, "D3: {$bezeichnung}: der Name ist unberuehrt");
}
$nestEins = json_decode((string) $zeileLesen($pdo, $ids['ohne_haken'])['properties_json'], true);
$pruefe($nestEins['wiki_path'] === $RS2 && $nestEins['allowed_transports'] === ['groupFoot'] && $nestEins['display_name'] === 'Reichsstraße 2',
    'C6: der Rest des Nests bleibt Zeichen fuer Zeichen: ' . json_encode($nestEins, JSON_UNESCAPED_UNICODE));
$nestZwei = json_decode((string) $zeileLesen($pdo, $ids['haken_false'])['properties_json'], true);
$pruefe(array_key_exists('wiki_path_weitere', $nestZwei) && $nestZwei['wiki_path_weitere'] === [],
    'C7: eine leere Liste bleibt [] (Nachtrag §9.2), sie faellt nicht heraus');
$pruefe((int) $zeileLesen($pdo, $ids['haken_eins'])['revision'] === 7, 'C8: das Ziel jenseits des Deckels ist noch unberuehrt');
foreach (['haken_true', 'ohne_wiki', 'inaktiv', 'leerer_key', 'ort', 'nur_weitere', 'kaputt'] as $bezeichnung) {
    $z = $zeileLesen($pdo, $ids[$bezeichnung]);
    $pruefe((int) $z['revision'] === 7, "C9: {$bezeichnung} ist kein Ziel und wurde angefasst");
}
$pruefe((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0,
    'D4: der Lauf schreibt Protokollzeilen -- die Kappung je Person (200) loeschte damit echte Geschichte');

// ── E) wiederholbar ──────────────────────────────────────────────────────────────────────────────────────────────
$zweiter = avesmapsWegnameAnzeigenBestand($pdo, false, 500);
$pruefe($zweiter['gefunden'] === 1 && $zweiter['gesetzt'] === 1 && $zweiter['verbleibend'] === 0, 'E1: der zweite Lauf nimmt den Rest: ' . json_encode($zweiter));
$pruefe(json_decode((string) $zeileLesen($pdo, $ids['haken_eins'])['properties_json'], true)['show_label'] === true, 'E2: aus 1 wird true');
$pruefe($kartenRevision($pdo) === 42, 'E3: wieder genau eine Revision');
$dritter = avesmapsWegnameAnzeigenBestand($pdo, false, 500);
$pruefe($dritter['gefunden'] === 0 && $dritter['gesetzt'] === 0 && $dritter['revision'] === 0, 'E4: nichts mehr zu tun: ' . json_encode($dritter));
$pruefe($kartenRevision($pdo) === 42, 'E5: ein leerer Lauf hebt keine Revision -- sonst schickte er jedem warmen Browser 21 MB');
$pruefe(avesmapsWegnameAnzeigenBestand($pdo, false, 0)['deckel'] === 1 && avesmapsWegnameAnzeigenBestand($pdo, false, 99999)['deckel'] === AVESMAPS_WEGNAME_ANZEIGEN_BESTAND_DECKEL,
    'E6: der Deckel wird geklemmt');

// ── F) EINE Transaktion ──────────────────────────────────────────────────────────────────────────────────────────
$ids = $seed($pdo);
$vorher = $alleZeilen($pdo);
$pdo->exec('CREATE TRIGGER wegname_bestand_scheitert BEFORE UPDATE ON map_features WHEN NEW.id = ' . $ids['haken_eins']
    . " BEGIN SELECT RAISE(ABORT, 'absichtlich gescheitert'); END");
$geworfen = false;
try {
    avesmapsWegnameAnzeigenBestand($pdo, false, 500);
} catch (Throwable $fehler) {
    $geworfen = str_contains($fehler->getMessage(), 'absichtlich');
}
$pruefe($geworfen, 'F1: der Fehler der dritten Zeile kommt beim Aufrufer an');
$pruefe($alleZeilen($pdo) === $vorher, 'F2: nach dem Fehlschlag steht eine Zeile geschrieben da -- halber Bestand unter neuer Revision');
$pruefe($kartenRevision($pdo) === 40, 'F3: und die Revision ist gehoben -- ein warmer Browser holte den halben Stand und fragte nie wieder');
$pruefe(!$pdo->inTransaction(), 'F4: die Transaktion ist zurueckgerollt, nicht offen gelassen');
$pdo->exec('DROP TRIGGER wegname_bestand_scheitert');

// ── H) ein fremdes Speichern zwischen Lesen und Schreiben geht NICHT verloren (Review I1) ───────────────────────────
// 🔴 Der Lauf schreibt das GANZE properties_json zurueck. Liest er einen Abschnitt, und jemand speichert ihn, bevor der Lauf schreibt,
// ueberschriebe der Lauf das fremde Speichern mit dem alten Stand -- lautlos. Zwei Riegel: Lesen INNERHALB der Transaktion mit
// `FOR UPDATE` (MariaDB; Abschnitt I prueft den Quelltext) und ein Revisionsriegel im UPDATE, der hier wirklich gefahren wird.
$ids = $seed($pdo);
$fremd = ['wiki_path' => $RS2, 'show_label' => false, 'display_name' => 'Fremd gespeichert'];
$pdo->zwischenruf = static function (PDO $p) use ($ids, $fremd): void {
    $s = $p->prepare('UPDATE map_features SET properties_json = :pj, revision = 77 WHERE id = :id');
    $s->execute(['pj' => json_encode($fremd, JSON_UNESCAPED_UNICODE), 'id' => $ids['haken_false']]);
};
$gestoert = avesmapsWegnameAnzeigenBestand($pdo, false, 500);
$pruefe($pdo->zwischenruf === null, 'H0: Voraussetzung -- der Zwischenruf lief vor dem Schreiben');
$pruefe(($gestoert['gesetzt'] ?? null) === 2, 'H1: die zwei ungestoerten Ziele sind nicht gesetzt: ' . json_encode($gestoert));
$pruefe(($gestoert['uebersprungen'] ?? null) === ['pid-haken_false'], 'H2: der fremd gespeicherte Abschnitt wird nicht als uebersprungen gemeldet: '
    . json_encode($gestoert));
$pruefe(($gestoert['verbleibend'] ?? null) === 1, 'H3: der uebersprungene zaehlt nicht als verbleibend');
$zeileFremd = $zeileLesen($pdo, $ids['haken_false']);
$pruefe(json_decode((string) $zeileFremd['properties_json'], true) === $fremd,
    'H4: der Lauf hat das fremde Speichern ueberschrieben: ' . $zeileFremd['properties_json']);
$pruefe((int) $zeileFremd['revision'] === 77, 'H5: und dessen Revision');
$pruefe(json_decode((string) $zeileLesen($pdo, $ids['ohne_haken'])['properties_json'], true)['show_label'] === true, 'H6: die anderen sind gesetzt');
// Werden ALLE Ziele fremd gespeichert, hebt der Lauf keine Revision -- er hat nichts geschrieben.
$ids = $seed($pdo);
$pdo->zwischenruf = static function (PDO $p): void {
    $p->exec("UPDATE map_features SET revision = revision + 100 WHERE feature_type = 'path'");
};
$alleGestoert = avesmapsWegnameAnzeigenBestand($pdo, false, 500);
$pruefe(($alleGestoert['gesetzt'] ?? null) === 0 && count($alleGestoert['uebersprungen'] ?? []) === 3, 'H7: ' . json_encode($alleGestoert));
$pruefe(($alleGestoert['revision'] ?? null) === 0 && $kartenRevision($pdo) === 40,
    'H8: ein Lauf, der nichts geschrieben hat, hebt trotzdem die Kartenrevision');

// ── I) der Quelltext: gesperrtes Lesen in der Transaktion, der Riegel, updated_at (Review I1, M1) ────────────────────
// Kommentarfrei gelesen (Tokenizer) -- die Kommentare nennen genau diese Zeichenketten.
$funktionsRumpf = static function (string $quelle, string $name): string {
    $ohne = '';
    foreach (token_get_all($quelle) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $ohne .= is_array($token) ? $token[1] : $token;
    }
    $von = strpos($ohne, 'function ' . $name . '(');
    if ($von === false) {
        return '';
    }
    $bis = strpos($ohne, "\nfunction ", $von + 1);

    return $bis === false ? substr($ohne, $von) : substr($ohne, $von, $bis - $von);
};
$bibliothek = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../features.php'));
$lauf = $funktionsRumpf($bibliothek, 'avesmapsWegnameAnzeigenBestand');
$leser = $funktionsRumpf($bibliothek, 'avesmapsWegnameAnzeigenBestandLesen');
$pruefe($leser !== '' && str_contains($leser, 'FOR UPDATE'), 'I1: das Lesen des scharfen Laufs sperrt die Zeilen nicht (FOR UPDATE)');
$posTransaktion = strpos($lauf, '->beginTransaction()');
$posGesperrt = strpos($lauf, 'avesmapsWegnameAnzeigenBestandLesen($pdo, true)');
$pruefe($posTransaktion !== false && $posGesperrt !== false && $posTransaktion < $posGesperrt,
    'I2: der scharfe Lauf liest nicht INNERHALB der Transaktion gesperrt -- ein fremdes Speichern dazwischen ginge verloren');
$pruefe(preg_match("/UPDATE map_features\s+SET properties_json = :properties_json,\s+revision = :revision,\s+updated_at = updated_at\s+WHERE id = :id AND revision = :gelesen/", $lauf) === 1,
    'I3: das UPDATE traegt nicht `updated_at = updated_at` (MariaDB ON UPDATE) samt Revisionsriegel `AND revision = :gelesen`');
$pruefe(str_contains($lauf, '->rowCount()'), 'I4: der Lauf zaehlt die getroffenen Zeilen nicht -- ein uebersprungener Abschnitt gaelte als gesetzt');

// ── G) die Aktion am Endpunkt ────────────────────────────────────────────────────────────────────────────────────
// Quelltext ohne Kommentare (Tokenizer, nicht Regex -- AGENTS.md: ein Blockkommentar-Entferner frisst sonst Code).
$quelle = (string) file_get_contents(__DIR__ . '/../../../edit/map/features.php');
$ohneKommentare = '';
foreach (token_get_all($quelle) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $ohneKommentare .= is_array($token) ? $token[1] : $token;
}
$von = strpos($ohneKommentare, "'wegname_anzeigen_bestand' =>");
$pruefe($von !== false, 'G1: die Aktion wegname_anzeigen_bestand fehlt am Endpunkt');
$rumpf = $von === false ? '' : substr($ohneKommentare, $von, (int) strpos($ohneKommentare, '})()', $von) - $von);
$pruefe(str_contains($rumpf, "avesmapsUserCan(\$user, 'admin')") && str_contains($rumpf, 'avesmapsErrorResponse(403'),
    'G2: die Aktion ist nicht Admins vorbehalten');
$pruefe(preg_match('/\$scharf\s*=\s*\(\$payload\[\'apply\'\]\s*\?\?\s*false\)\s*===\s*true;/', $rumpf) === 1,
    'G3: scharf wird nicht streng an apply === true gebunden -- ein "true" als Text waere scharf');
$pruefe(str_contains($rumpf, 'avesmapsWegnameAnzeigenBestand($pdo, !$scharf,'), 'G4: die Aktion ruft den Lauf nicht mit dem Trockenlauf-Schalter');

fwrite(STDOUT, "wegname-anzeigen-bestand: {$checks} Zusicherungen erfuellt\n");
