<?php

declare(strict_types=1);

/**
 * Der ANSCHLUSS von „Innerorts" an die Schreibwege -- AUSGEFUEHRT, nicht gelesen.
 * ===========================================================================
 * Entwurf: docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md §3-§6
 * Plan:    docs/superpowers/plans/2026-09-27-innerorts-schritt-1.md, Task 2
 *
 *   A. update_point: das Feld (Rumpf ohne Felder = unveraendert, Ortsgroessenwechsel, manual, wiki/↺,
 *      Zielpruefung) -- die Regel allein UND durch avesmapsUpdatePointFeatureDetails hindurch
 *   B. die Kartenaktionen take_off_map / put_on_map (Sperre, Absage mit `reason`, Antwortform) und
 *      ihre Verdrahtung im Endpunkt
 *   C. der Staetten-Kasten: Punkte einer Stadt, „⇄" (samt Rueckgaengig), Editor-Stand, Sperre
 *   D. das Nachziehen nach einer Wiki-Zuweisung (manual bleibt, ein Fehler wird nicht geworfen)
 *   E. `settlement_detail` traegt den Editor-Stand (Verdrahtung)
 *
 * 🪤 SQLite kennt `FOR UPDATE`, `NOW(3)` und `ON DUPLICATE KEY UPDATE` nicht -- uebersetzt an der
 * TREIBER-NAHT wie in innerorts-test.php, keine Funktion nachgebaut.
 *
 * Lauf (aus der Wurzel):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/innerorts-anschluss-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../../map/features.php';
require_once __DIR__ . '/../innerorts-anschluss.php';

$pruefungen = 0;

final class AvesmapsInnerortsAnschlussTestPdo extends PDO
{
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $query = str_replace(['FOR UPDATE', 'NOW(3)', 'CURRENT_TIMESTAMP(3)'], ['', "datetime('now')", "datetime('now')"], $query);

        return parent::prepare($query, $options);
    }

    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
    {
        if (preg_match('/^SHOW COLUMNS FROM (\w+)$/i', trim($query), $m) === 1) {
            $query = "SELECT name AS Field FROM pragma_table_info('{$m[1]}')";
        }

        return parent::query($query, $fetchMode, ...$fetchModeArgs);
    }

    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }
        if (str_contains($statement, 'AUTO_INCREMENT') || str_contains($statement, 'ENGINE=InnoDB')) {
            return 0;
        }

        return parent::exec($statement);
    }
}

const IO_GARETH = 'aaaaaaaa-0000-4000-8000-000000000001';
const IO_PUNIN = 'aaaaaaaa-0000-4000-8000-000000000002';
const IO_NEUGARETH = 'aaaaaaaa-0000-4000-8000-000000000010';
const IO_TEMPEL = 'aaaaaaaa-0000-4000-8000-000000000011';
const IO_DORF = 'aaaaaaaa-0000-4000-8000-000000000012';
const IO_WEG = 'aaaaaaaa-0000-4000-8000-000000000013';
const IO_GELOESCHT = 'aaaaaaaa-0000-4000-8000-000000000014';
const IO_USER = ['id' => 7, 'username' => 'pruefer', 'role' => 'editor'];
const IO_NG_URL = 'https://de.wiki-aventurica.de/wiki/Neu-Gareth';

function ioPdo(): PDO
{
    $pdo = new AvesmapsInnerortsAnschlussTestPdo('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('CREATE TABLE map_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT, feature_subtype TEXT,
        name TEXT, geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
        min_x REAL, min_y REAL, max_x REAL, max_y REAL,
        is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 1,
        created_by INTEGER NULL, updated_by INTEGER NULL
    )');
    $pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
    $pdo->exec('CREATE TABLE map_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
        actor_user_id INTEGER, before_json TEXT, after_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        undone_at TEXT NULL, undone_by INTEGER NULL, undo_audit_id INTEGER NULL
    )');
    $pdo->exec('CREATE TABLE map_feature_locks (public_id TEXT PRIMARY KEY, user_id INTEGER, username TEXT, locked_until TEXT)');
    $pdo->exec('CREATE TABLE wiki_sync_pages (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, standort TEXT)');
    $pdo->exec('CREATE TABLE political_territory (name TEXT)');
    $pdo->exec("INSERT INTO wiki_sync_pages (title, standort) VALUES ('Neu-Gareth', 'ein Stadtteil [[Gareth]]s')");

    ioPunkt($pdo, IO_GARETH, 'Gareth', 'metropole', [], true, 30.0, 40.0);
    ioPunkt($pdo, IO_PUNIN, 'Punin', 'stadt', [], true, 60.0, 70.0);
    ioPunkt($pdo, IO_NEUGARETH, 'Neu-Gareth', 'stadtviertel', [
        'wiki_settlement' => ['title' => 'Neu-Gareth', 'wiki_url' => IO_NG_URL],
    ]);
    ioPunkt($pdo, IO_TEMPEL, 'Praios-Tempel', 'gebaeude', ['place_kind' => 'Tempel']);
    ioPunkt($pdo, IO_DORF, 'Kleindorf', 'dorf', []);

    return $pdo;
}

function ioPunkt(PDO $pdo, string $id, string $name, string $subtype, array $props, bool $aktiv = true, float $x = 31.0, float $y = 41.0): void
{
    $props += ['name' => $name, 'feature_type' => 'location', 'feature_subtype' => $subtype];
    $pdo->prepare(
        'INSERT INTO map_features (public_id, feature_type, feature_subtype, name, geometry_type, geometry_json,
            properties_json, min_x, min_y, max_x, max_y, is_active, revision)
         VALUES (:pid, \'location\', :sub, :name, \'Point\', :geo, :props, :x, :y, :x2, :y2, :aktiv, 1)'
    )->execute([
        'pid' => $id, 'sub' => $subtype, 'name' => $name,
        'geo' => json_encode(['type' => 'Point', 'coordinates' => [$x, $y]]),
        'props' => json_encode($props, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        'x' => $x, 'y' => $y, 'x2' => $x, 'y2' => $y, 'aktiv' => $aktiv ? 1 : 0,
    ]);
}

function ioProps(PDO $pdo, string $id): array
{
    $s = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = :p');
    $s->execute(['p' => $id]);

    return json_decode((string) $s->fetchColumn(), true);
}

function ioAktiv(PDO $pdo, string $id): int
{
    $s = $pdo->prepare('SELECT is_active FROM map_features WHERE public_id = :p');
    $s->execute(['p' => $id]);

    return (int) $s->fetchColumn();
}

function ioSetzeProps(PDO $pdo, string $id, array $props): void
{
    $pdo->prepare('UPDATE map_features SET properties_json = :j WHERE public_id = :p')
        ->execute(['j' => json_encode($props, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'p' => $id]);
}

/** Wirft der Aufruf die erwartete Ausnahme? Gibt sie zurueck. */
function ioWirft(callable $fn, string $klasse): Throwable
{
    try {
        $fn();
    } catch (Throwable $e) {
        assert($e instanceof $klasse, 'erwartet ' . $klasse . ', bekommen ' . get_class($e) . ': ' . $e->getMessage());

        return $e;
    }
    assert(false, 'erwartet ' . $klasse . ', aber nichts geworfen');
    throw new LogicException('unerreichbar');
}

// =============================================================================================
// A. update_point -- die Regel allein
// =============================================================================================
$pdo = ioPdo();
$basis = ['name' => 'Neu-Gareth', 'innerorts' => ['ort' => IO_PUNIN], 'field_origins' => ['innerorts' => 'manual', 'name' => 'wiki']];

// A1. Rumpf OHNE die zwei Felder -> unveraendert (alte, gecachte Clients).
assert(avesmapsInnerortsUpdatePointAnwenden($pdo, $basis, ['name' => 'x'], 'stadtviertel', IO_NEUGARETH) === $basis,
    'ein Rumpf ohne innerorts_ort/innerorts_wiki laesst das Feld unveraendert');
$pruefungen++;

// A2. Ortsgroesse weg von Stadtviertel/Bauwerk -> Feld + Herkunft weg, andere Herkunft bleibt.
$a2 = avesmapsInnerortsUpdatePointAnwenden($pdo, $basis, [], 'dorf', IO_NEUGARETH);
assert(!isset($a2['innerorts']) && ($a2['field_origins'] ?? null) === ['name' => 'wiki'],
    'Ortsgroesse Dorf: innerorts und seine Herkunft fallen, die uebrige Herkunft bleibt: ' . json_encode($a2));
$a2b = avesmapsInnerortsUpdatePointAnwenden($pdo, ['innerorts' => ['ort' => IO_PUNIN], 'field_origins' => ['innerorts' => 'manual']], [], 'stadt', IO_NEUGARETH);
assert(!isset($a2b['innerorts']) && !isset($a2b['field_origins']), 'eine dadurch leere Herkunftskarte faellt ganz weg');
$pruefungen += 2;

// A3. Von Hand gesetzt -> manual, nach Zielpruefung.
$a3 = avesmapsInnerortsUpdatePointAnwenden($pdo, ['name' => 'x'], ['innerorts_ort' => IO_GARETH], 'gebaeude', IO_TEMPEL);
assert(($a3['innerorts'] ?? null) === ['ort' => IO_GARETH] && $a3['field_origins']['innerorts'] === 'manual', json_encode($a3));
$pruefungen++;
foreach ([IO_TEMPEL => 'ein Bauwerk', IO_DORF . 'x' => 'eine unbekannte Kennung', IO_NEUGARETH => 'der Punkt selbst'] as $ziel => $was) {
    $e = ioWirft(static fn() => avesmapsInnerortsUpdatePointAnwenden($pdo, [], ['innerorts_ort' => (string) $ziel], 'stadtviertel', IO_NEUGARETH), InvalidArgumentException::class);
    assert($e->getMessage() === 'Das Ziel ist kein Ort auf der Karte.', "{$was} ist kein gueltiges Ziel");
    $pruefungen++;
}

// A4. '' = „gehoert zu keiner Stadt" -- ein Override (manual), kein Zuruecksetzen.
$a4 = avesmapsInnerortsUpdatePointAnwenden($pdo, ['innerorts' => ['ort' => IO_GARETH], 'field_origins' => ['innerorts' => 'wiki']], ['innerorts_ort' => ''], 'stadtviertel', IO_NEUGARETH);
assert(!isset($a4['innerorts']) && $a4['field_origins']['innerorts'] === 'manual', '„keiner" ist ein Override: ' . json_encode($a4));
$a4b = avesmapsInnerortsUpdatePointAnwenden($pdo, ['innerorts' => ['ort' => IO_GARETH]], ['innerorts_ort' => ['kaputt']], 'stadtviertel', IO_NEUGARETH);
assert(!isset($a4b['innerorts']), 'ein Nicht-String gilt als „keiner", nie als „Array"');
$pruefungen += 2;

// A5. ↺ / auf Wiki-Stand: der SERVER rechnet (Gareth aus „ein Stadtteil [[Gareth]]s"), Herkunft wiki.
$ngProps = ioProps($pdo, IO_NEUGARETH);
$a5 = avesmapsInnerortsUpdatePointAnwenden($pdo, $ngProps + ['innerorts' => ['ort' => IO_PUNIN], 'field_origins' => ['innerorts' => 'manual']],
    ['innerorts_wiki' => true, 'innerorts_ort' => IO_PUNIN], 'stadtviertel', IO_NEUGARETH);
assert(($a5['innerorts'] ?? null) === ['ort' => IO_GARETH] && $a5['field_origins']['innerorts'] === 'wiki',
    '↺ setzt den Wiki-Stand, innerorts_ort wird dann nicht gelesen: ' . json_encode($a5));
// 💣 ↺ auf einen Override, der zufaellig dem Wiki-Stand gleicht: die Herkunft MUSS trotzdem wiki werden.
$a5b = avesmapsInnerortsUpdatePointAnwenden($pdo, $ngProps + ['innerorts' => ['ort' => IO_GARETH], 'field_origins' => ['innerorts' => 'manual']],
    ['innerorts_wiki' => true], 'stadtviertel', IO_NEUGARETH);
assert($a5b['field_origins']['innerorts'] === 'wiki', '↺ hebt ein wertgleiches Override auf: ' . json_encode($a5b));
$a5c = avesmapsInnerortsUpdatePointAnwenden($pdo, $ngProps, ['innerorts_wiki' => false, 'innerorts_ort' => IO_PUNIN], 'stadtviertel', IO_NEUGARETH);
assert(($a5c['innerorts'] ?? null) === ['ort' => IO_PUNIN] && $a5c['field_origins']['innerorts'] === 'manual', 'innerorts_wiki:false = von Hand');
$pruefungen += 3;

// =============================================================================================
// A'. update_point -- durch avesmapsUpdatePointFeatureDetails hindurch (derselbe Weg wie der Endpunkt)
// =============================================================================================
$pdo = ioPdo();
ioSetzeProps($pdo, IO_NEUGARETH, ioProps($pdo, IO_NEUGARETH) + ['innerorts' => ['ort' => IO_PUNIN], 'field_origins' => ['innerorts' => 'manual']]);
$alterClient = ['public_id' => IO_NEUGARETH, 'name' => 'Neu-Gareth', 'feature_subtype' => 'stadtviertel'];
$antwort = avesmapsUpdatePointFeatureDetails($pdo, $alterClient, IO_USER);
assert((ioProps($pdo, IO_NEUGARETH)['innerorts'] ?? null) === ['ort' => IO_PUNIN], 'ein alter Client nimmt die Stadt beim Speichern NICHT zurueck');
assert(($antwort['innerorts'] ?? null) === ['ort' => IO_PUNIN], 'die Antwort traegt das Feld (der Marker-Eintrag wird daraus neu gebaut)');
$pruefungen += 2;
avesmapsUpdatePointFeatureDetails($pdo, $alterClient + ['innerorts_wiki' => true], IO_USER);
$nachWiki = ioProps($pdo, IO_NEUGARETH);
assert(($nachWiki['innerorts'] ?? null) === ['ort' => IO_GARETH] && $nachWiki['field_origins']['innerorts'] === 'wiki', 'neuer Client, ↺: ' . json_encode($nachWiki));
$pruefungen++;
$e = ioWirft(static fn() => avesmapsUpdatePointFeatureDetails($pdo, $alterClient + ['innerorts_ort' => IO_TEMPEL], IO_USER), InvalidArgumentException::class);
assert((ioProps($pdo, IO_NEUGARETH)['innerorts'] ?? null) === ['ort' => IO_GARETH], 'ein ungueltiges Ziel schreibt nichts (Rollback)');
$pruefungen++;
$antwortDorf = avesmapsUpdatePointFeatureDetails($pdo, ['public_id' => IO_NEUGARETH, 'name' => 'Neu-Gareth', 'feature_subtype' => 'dorf'], IO_USER);
assert(!isset(ioProps($pdo, IO_NEUGARETH)['innerorts']) && $antwortDorf['innerorts'] === null, 'Ortsgroesse Dorf nimmt das Feld mit -- auch vom alten Client');
$pruefungen++;

// =============================================================================================
// B. Kartenaktionen take_off_map / put_on_map
// =============================================================================================
$pdo = ioPdo();
ioSetzeProps($pdo, IO_NEUGARETH, ioProps($pdo, IO_NEUGARETH) + ['innerorts' => ['ort' => IO_GARETH], 'field_origins' => ['innerorts' => 'wiki']]);

// B1. Fremde Sperre -> 409 (AvesmapsConflictException), nichts geschrieben.
$pdo->exec("INSERT INTO map_feature_locks VALUES ('" . IO_NEUGARETH . "', 99, 'jemand', '2999-01-01 00:00:00')");
$e = ioWirft(static fn() => avesmapsTakeOffMapFeature($pdo, ['public_id' => IO_NEUGARETH], IO_USER), AvesmapsConflictException::class);
assert(str_contains($e->getMessage(), 'jemand') && ioAktiv($pdo, IO_NEUGARETH) === 1, 'fremde Sperre: Absage mit Namen, Punkt bleibt');
$pdo->exec('DELETE FROM map_feature_locks');
$pruefungen++;

// B2. Ohne Stadt -> 400 mit reason invalid_state (die Beilage der Fehlerhuelle).
$e = ioWirft(static fn() => avesmapsTakeOffMapFeature($pdo, ['public_id' => IO_TEMPEL], IO_USER), AvesmapsInnerortsZustandException::class);
assert(avesmapsMapFeatureErrorDetails($e) === ['reason' => 'invalid_state'], 'reason reist als Beilage: ' . json_encode(avesmapsMapFeatureErrorDetails($e)));
assert($e instanceof InvalidArgumentException, 'dieselbe 400 wie jede Absage des Endpunkts (ein catch, kein zweiter)');
$pruefungen += 2;
$e = ioWirft(static fn() => avesmapsTakeOffMapFeature($pdo, ['public_id' => 'aaaaaaaa-0000-4000-8000-0000000000ff'], IO_USER), AvesmapsInnerortsZustandException::class);
assert($e->reason === 'not_found', 'unbekannter Punkt: not_found');
$pruefungen++;

// B3. Erfolg: Antwort eines geloeschten Objekts + Merker + Stadt.
$ab = avesmapsTakeOffMapFeature($pdo, ['public_id' => IO_NEUGARETH], IO_USER);
assert(($ab['deleted'] ?? false) === true && ($ab['von_der_karte'] ?? false) === true
    && $ab['innerorts_ort'] === ['public_id' => IO_GARETH, 'name' => 'Gareth'] && $ab['name'] === 'Neu-Gareth',
    'take_off_map: ' . json_encode($ab));
assert(ioAktiv($pdo, IO_NEUGARETH) === 0 && ioProps($pdo, IO_NEUGARETH)['innerorts'] === ['ort' => IO_GARETH, 'von_der_karte' => true], 'Zeile inaktiv mit Merker');
$pruefungen += 2;

// B4. Zweimal nehmen -> invalid_state; Auf die Karte setzen -> ein normaler Punkt zurueck.
$e = ioWirft(static fn() => avesmapsTakeOffMapFeature($pdo, ['public_id' => IO_NEUGARETH], IO_USER), AvesmapsInnerortsZustandException::class);
assert($e->reason === 'invalid_state', 'ein schon genommener Punkt: invalid_state');
$drauf = avesmapsPutOnMapFeature($pdo, ['public_id' => IO_NEUGARETH], IO_USER);
assert(!isset($drauf['deleted']) && $drauf['public_id'] === IO_NEUGARETH && $drauf['lat'] === 41.0 && $drauf['lng'] === 31.0
    && $drauf['innerorts'] === ['ort' => IO_GARETH], 'put_on_map: der Punkt an alter Stelle, ohne Merker: ' . json_encode($drauf));
assert(ioAktiv($pdo, IO_NEUGARETH) === 1, 'wieder aktiv');
$e = ioWirft(static fn() => avesmapsPutOnMapFeature($pdo, ['public_id' => IO_NEUGARETH], IO_USER), AvesmapsInnerortsZustandException::class);
assert($e->reason === 'invalid_state', 'ein Punkt auf der Karte laesst sich nicht noch einmal setzen');
$pruefungen += 4;

// B5. Verdrahtung im Endpunkt: beide Aktionen im match, hinter der Faehigkeit `edit`.
$endpunkt = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../../../edit/map/features.php'));
$ohneKommentare = '';
foreach (token_get_all($endpunkt) as $t) {
    $ohneKommentare .= (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true)) ? '' : (is_array($t) ? $t[1] : $t);
}
$posEdit = strpos($ohneKommentare, "avesmapsRequireUserWithCapability('edit')");
foreach (["'take_off_map' => avesmapsTakeOffMapFeature(\$pdo, \$payload, \$user)", "'put_on_map' => avesmapsPutOnMapFeature(\$pdo, \$payload, \$user)"] as $zeile) {
    $pos = strpos($ohneKommentare, $zeile);
    assert($pos !== false && $posEdit !== false && $posEdit < $pos, "Endpunkt: {$zeile} steht hinter der Faehigkeit edit");
    $pruefungen++;
}

// =============================================================================================
// C. Staetten-Kasten
// =============================================================================================
$pdo = ioPdo();
ioSetzeProps($pdo, IO_NEUGARETH, ioProps($pdo, IO_NEUGARETH) + ['innerorts' => ['ort' => IO_GARETH], 'field_origins' => ['innerorts' => 'wiki']]);
ioPunkt($pdo, IO_WEG, 'Alter Hafen', 'gebaeude', ['place_kind' => 'Hafen', 'wiki_url' => 'https://example.org/hafen',
    'innerorts' => ['ort' => IO_GARETH, 'von_der_karte' => true]], false);
ioPunkt($pdo, IO_GELOESCHT, 'Geloeschtes Haus', 'gebaeude', ['innerorts' => ['ort' => IO_GARETH]], false);
ioSetzeProps($pdo, IO_TEMPEL, ioProps($pdo, IO_TEMPEL) + ['innerorts' => ['ort' => IO_PUNIN]]);

$liste = avesmapsInnerortsPunkteEinerStadt($pdo, IO_GARETH);
$nachName = array_column($liste, null, 'name');
assert(array_keys($nachName) === ['Alter Hafen', 'Neu-Gareth'], 'aktive UND genommene Punkte dieser Stadt, kein geloeschter, keiner aus Punin: ' . json_encode(array_keys($nachName)));
assert($nachName['Neu-Gareth'] === [
    'public_id' => IO_NEUGARETH, 'name' => 'Neu-Gareth', 'place_type' => 'Stadtviertel', 'wiki_url' => IO_NG_URL,
    'origin' => 'karte', 'art' => 'punkt', 'auf_der_karte' => true, 'gleichnamig_auf_der_karte' => false,
], 'Zeilenform (Brief): ' . json_encode($nachName['Neu-Gareth']));
assert($nachName['Alter Hafen']['auf_der_karte'] === false && $nachName['Alter Hafen']['place_type'] === 'Hafen'
    && $nachName['Alter Hafen']['wiki_url'] === 'https://example.org/hafen', 'der genommene Punkt, Art aus place_kind, flache Adresse als Rueckfall');
assert(avesmapsInnerortsPunkteEinerStadt($pdo, "x' OR 1=1 --") === [], 'eine Kennung mit fremden Zeichen liefert nichts');
$pruefungen += 4;

assert(avesmapsInnerortsIstPunkt($pdo, IO_NEUGARETH) && avesmapsInnerortsIstPunkt($pdo, IO_WEG), 'Punkte mit Stadt sind Punkte');
assert(!avesmapsInnerortsIstPunkt($pdo, IO_DORF) && !avesmapsInnerortsIstPunkt($pdo, IO_GARETH) && !avesmapsInnerortsIstPunkt($pdo, 'nix'), 'Dorf, Stadt, Unbekanntes nicht');
$pruefungen += 2;

// C2. „⇄": von Hand umsetzen -- Merker wandert mit, Herkunft manual, Protokoll + Rueckgaengig.
$um = avesmapsInnerortsOrtSpeichern($pdo, IO_WEG, IO_PUNIN, 7);
assert($um === ['ok' => true, 'public_id' => IO_WEG, 'name' => 'Alter Hafen', 'alter_ort' => IO_GARETH, 'ziel_name' => 'Punin'], json_encode($um));
$hafen = ioProps($pdo, IO_WEG);
assert($hafen['innerorts'] === ['ort' => IO_PUNIN, 'von_der_karte' => true] && $hafen['field_origins']['innerorts'] === 'manual', json_encode($hafen));
$audit = $pdo->query('SELECT * FROM map_audit_log ORDER BY id DESC LIMIT 1')->fetch();
assert($audit['action'] === 'set_innerorts' && avesmapsUndoColumnsForAuditAction('set_innerorts') === ['properties_json'], 'Protokoll set_innerorts, rueckgaengig ueber properties_json');
$pruefungen += 3;
avesmapsUndoAuditChange($pdo, ['audit_id' => (int) $audit['id']], IO_USER);
assert((ioProps($pdo, IO_WEG)['innerorts'] ?? null) === ['ort' => IO_GARETH, 'von_der_karte' => true] && ioAktiv($pdo, IO_WEG) === 0,
    'Rueckgaengig holt die alte Stadt zurueck, der genommene Punkt bleibt genommen: ' . json_encode(ioProps($pdo, IO_WEG)));
$pruefungen++;
foreach ([
    [IO_WEG, IO_GARETH, 'invalid_target', 'dieselbe Stadt'],
    [IO_WEG, IO_TEMPEL, 'invalid_target', 'ein Bauwerk als Ziel'],
    [IO_DORF, IO_GARETH, 'invalid_state', 'ein Dorf'],
    [IO_GELOESCHT, IO_PUNIN, 'invalid_state', 'ein geloeschter Punkt'],
    ['aaaaaaaa-0000-4000-8000-0000000000ff', IO_PUNIN, 'not_found', 'ein unbekannter'],
] as [$id, $ziel, $code, $was]) {
    $r = avesmapsInnerortsOrtSpeichern($pdo, $id, $ziel, 7);
    assert(($r['ok'] ?? null) === false && $r['code'] === $code, "{$was}: {$code} -- " . json_encode($r));
    $pruefungen++;
}

// C3. Editor-Stand: gespeicherter Ort mit Namen, Herkunft und Wiki-Stand zum Vergleich.
ioSetzeProps($pdo, IO_NEUGARETH, ['wiki_settlement' => ['title' => 'Neu-Gareth', 'wiki_url' => IO_NG_URL],
    'innerorts' => ['ort' => IO_PUNIN], 'field_origins' => ['innerorts' => 'manual']]);
$stand = avesmapsInnerortsEditorStand($pdo, ioProps($pdo, IO_NEUGARETH), 'stadtviertel');
assert($stand === [
    // 🔴 `feature_subtype` reist mit -- der Editor zeigt "Gareth · Metropole" (Beschriftung aus
    // derselben Tafel wie die Ortssuche), nicht nur den Namen.
    'wiki_stand' => ['public_id' => IO_GARETH, 'name' => 'Gareth', 'feature_subtype' => 'metropole'],
    'ort' => ['public_id' => IO_PUNIN, 'name' => 'Punin', 'feature_subtype' => 'stadt'],
    'herkunft' => 'manual',
    'von_der_karte' => false,
], 'Editor-Stand: ' . json_encode($stand));
assert(avesmapsInnerortsEditorStand($pdo, ioProps($pdo, IO_NEUGARETH), 'dorf') === ['wiki_stand' => null, 'ort' => null, 'herkunft' => '', 'von_der_karte' => false],
    'ein Dorf hat kein Feld');
$pruefungen += 2;

// Ein Ort, der nicht (mehr) aktiv ist, faellt auf '' zurueck -- Name UND Ortsklasse gemeinsam,
// nie eine Ortsklasse ohne Namen (die Zeile "gehoert zu <leer> · Metropole" waere unsinnig).
ioSetzeProps($pdo, IO_NEUGARETH, ['innerorts' => ['ort' => IO_GELOESCHT], 'field_origins' => ['innerorts' => 'manual']]);
$standInaktiv = avesmapsInnerortsEditorStand($pdo, ioProps($pdo, IO_NEUGARETH), 'stadtviertel');
assert($standInaktiv['ort'] === null, 'ein inaktiver Ort traegt weder Namen noch Ortsklasse: ' . json_encode($standInaktiv));
$pruefungen++;
// Zurueck auf den Stand vor diesem Einschub, damit die folgenden Abschnitte unveraendert bleiben.
ioSetzeProps($pdo, IO_NEUGARETH, ['wiki_settlement' => ['title' => 'Neu-Gareth', 'wiki_url' => IO_NG_URL],
    'innerorts' => ['ort' => IO_PUNIN], 'field_origins' => ['innerorts' => 'manual']]);

// C4. Sperre des Staetten-Kastens.
assert(avesmapsInnerortsSperreFehler($pdo, [], 'nix', IO_USER)['code'] === 'not_found', 'Sperre: unbekannt -> not_found');
$pdo->exec("INSERT INTO map_feature_locks VALUES ('" . IO_WEG . "', 99, 'jemand', '2999-01-01 00:00:00')");
assert(avesmapsInnerortsSperreFehler($pdo, [], IO_WEG, IO_USER)['code'] === 'conflict', 'Sperre: fremd -> conflict (auch am genommenen Punkt)');
assert(avesmapsInnerortsSperreFehler($pdo, [], IO_WEG, ['id' => 99, 'username' => 'jemand']) === null, 'die eigene Sperre haelt nicht auf');
$pruefungen += 3;

// =============================================================================================
// D. Nachziehen nach einer Wiki-Zuweisung
// =============================================================================================
$pdo = ioPdo();
ioSetzeProps($pdo, IO_NEUGARETH, ioProps($pdo, IO_NEUGARETH) + ['innerorts' => ['ort' => IO_PUNIN], 'field_origins' => ['innerorts' => 'wiki']]);
ioSetzeProps($pdo, IO_TEMPEL, ['wiki_settlement' => ['title' => 'Neu-Gareth'], 'innerorts' => ['ort' => IO_PUNIN], 'field_origins' => ['innerorts' => 'manual']]);
assert(avesmapsInnerortsNachZuweisung($pdo, [IO_NEUGARETH, IO_TEMPEL, IO_DORF, ''], 7) === 1, 'genau einer wurde geschrieben');
assert(ioProps($pdo, IO_NEUGARETH)['innerorts'] === ['ort' => IO_GARETH], 'ein wiki-stammender Wert folgt dem Artikel');
assert(ioProps($pdo, IO_TEMPEL)['innerorts'] === ['ort' => IO_PUNIN], '🔴 manual wird nie ueberschrieben');
$pruefungen += 3;
// Ein Fehlschlag wird protokolliert, nicht geworfen -- die Zuweisung davor ist ja committet.
$logDatei = tempnam(sys_get_temp_dir(), 'io-log');
$altesLog = ini_set('error_log', $logDatei);
$kaputt = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
assert(avesmapsInnerortsNachZuweisung($kaputt, [IO_NEUGARETH], 7) === 0, 'ohne Tabelle: 0, kein Wurf');
ini_set('error_log', (string) $altesLog);
assert(str_contains((string) file_get_contents($logDatei), IO_NEUGARETH), 'der Fehlschlag steht im Protokoll');
@unlink($logDatei);
$pruefungen += 2;

// =============================================================================================
// E. settlement_detail traegt den Editor-Stand (Verdrahtung, Tokenizer)
// =============================================================================================
$settlements = (string) file_get_contents(__DIR__ . '/../../wiki/settlements.php');
$ohne = '';
foreach (token_get_all($settlements) as $t) {
    $ohne .= (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true)) ? '' : (is_array($t) ? $t[1] : $t);
}
$ohne = str_replace("\r\n", "\n", $ohne);
$start = strpos($ohne, 'function avesmapsWikiSettlementDetail(');
$rumpf = substr($ohne, (int) $start, (int) strpos($ohne, "\n}\n", (int) $start) - (int) $start);
assert(preg_match("/'innerorts' => avesmapsInnerortsEditorStand\\(\\s*\\\$pdo,/", $rumpf) === 1, 'settlement_detail liefert den Editor-Stand unter `innerorts`');
$pruefungen++;

echo "innerorts-anschluss: alle {$pruefungen} Zusicherungen gruen\n";
