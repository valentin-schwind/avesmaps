<?php

declare(strict_types=1);

/**
 * Die Server-Bibliothek fuer „Innerorts als eigenes Praedikat" -- das Feld selbst (Wiki-Stand,
 * Override, Zielpruefung), „Von der Karte nehmen"/„Auf die Karte setzen"/„Endgueltig entfernen"
 * samt Kraftlinien-Riegel und Rueckgaengig, die Staettenliste und der Admin-Lauf.
 *
 * Entwurf: docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md §3-§6
 * Plan:    docs/superpowers/plans/2026-09-27-innerorts-schritt-1.md, Task 1
 *
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll \
 *       api/_internal/app/__tests__/innerorts-test.php
 * Exit 0 = alle Zusicherungen bestanden.
 *
 * 🪤 SQLite kennt weder `FOR UPDATE` noch `NOW(3)`/`CURRENT_TIMESTAMP(3)` noch
 * `INSERT ... ON DUPLICATE KEY UPDATE` noch `SHOW COLUMNS FROM` -- alles Formen, die die echte
 * Undo-Maschinerie (`avesmapsUndoAuditChange`, api/_internal/map/features.php) benutzt. Wie in
 * `api/_internal/map/__tests__/weg-merker-reichweite-test.php` werden sie an der TREIBER-NAHT
 * uebersetzt, nicht die Funktionen nachgebaut -- sonst prueft der Test eine Kopie und nicht den
 * Code, der live laeuft.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

// ⚠️ Reihenfolge wie im Betrieb: bootstrap.php zuerst (avesmapsNormalizeSingleLine, von
// features.php gebraucht), dann die grosse Editor-Bibliothek (liefert
// avesmapsWriteMapAuditLog/avesmapsNextMapRevision/avesmapsAssertNoPowerlineAnchoredAt/
// avesmapsUndoAuditChange per function_exists an unsere Bibliothek durch), dann unsere.
require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../../map/features.php';
require_once __DIR__ . '/../innerorts.php'; // require_once: features.php laedt sie seit Task 2 schon (innerorts-anschluss.php)
require __DIR__ . '/../../ortsklassen.php';

$pruefungen = 0;

/**
 * Die Treiber-Naht: MySQL-eigene Formen auf SQLite uebersetzt, keine Funktion nachgebaut.
 */
class AvesmapsInnerortsTestPdo extends PDO
{
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $query = str_replace('FOR UPDATE', '', $query);
        $query = str_replace('NOW(3)', "datetime('now')", $query);
        $query = str_replace('CURRENT_TIMESTAMP(3)', "datetime('now')", $query);

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
            return 0; // MySQL-eigenes DDL -- unsere Tabellen stehen unten schon in SQLite-Form.
        }

        return parent::exec($statement);
    }
}

function avesmapsInnerortsTestPdo(): PDO
{
    $pdo = new AvesmapsInnerortsTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE map_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT, feature_subtype TEXT,
        name TEXT, geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
        min_x REAL, min_y REAL, max_x REAL, max_y REAL,
        is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 1,
        updated_by INTEGER NULL
    )');
    $pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
    $pdo->exec('CREATE TABLE map_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
        actor_user_id INTEGER, before_json TEXT, after_json TEXT,
        undone_at TEXT NULL, undone_by INTEGER NULL, undo_audit_id INTEGER NULL
    )');
    $pdo->exec('CREATE TABLE map_feature_locks (public_id TEXT PRIMARY KEY, user_id INTEGER, username TEXT, locked_until TEXT)');
    $pdo->exec('CREATE TABLE wiki_sync_pages (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, standort TEXT)');
    $pdo->exec('CREATE TABLE political_territory (name TEXT)');

    return $pdo;
}

/**
 * Einen Kartenpunkt einfuegen -- mit gueltiger Point-Geometrie (die generische Undo-Maschinerie
 * braucht sie fuer ihre Antwort, auch wenn unsere eigene Bibliothek Geometrie nie anfasst).
 */
function avesmapsInnerortsTestPunktEinfuegen(
    PDO $pdo,
    string $publicId,
    string $name,
    string $subtype,
    array $properties = [],
    bool $aktiv = true,
    array $geometrie = ['type' => 'Point', 'coordinates' => [10.0, 20.0]]
): int {
    $pdo->prepare(
        'INSERT INTO map_features
            (public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json, is_active, revision)
         VALUES (:pid, :type, :subtype, :name, :gtype, :gjson, :props, :aktiv, 1)'
    )->execute([
        'pid' => $publicId,
        'type' => 'location',
        'subtype' => $subtype,
        'name' => $name,
        'gtype' => (string) ($geometrie['type'] ?? 'Point'),
        'gjson' => json_encode($geometrie, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        'props' => json_encode($properties, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        'aktiv' => $aktiv ? 1 : 0,
    ]);

    return (int) $pdo->lastInsertId();
}

function avesmapsInnerortsTestZeile(PDO $pdo, string $publicId): array
{
    $statement = $pdo->prepare('SELECT * FROM map_features WHERE public_id = :pid');
    $statement->execute(['pid' => $publicId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    assert(is_array($row), "Testzeile {$publicId} existiert");

    return $row;
}

function avesmapsInnerortsTestLetzterAudit(PDO $pdo): array
{
    $row = $pdo->query('SELECT * FROM map_audit_log ORDER BY id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
    assert(is_array($row), 'es gibt eine Audit-Log-Zeile');

    return $row;
}

const AVESMAPS_INNERORTS_TEST_USER = 7;
// Fuer avesmapsUndoAuditChange(), das einen vollen Nutzer-Datensatz erwartet (nicht nur die id).
$user = ['id' => AVESMAPS_INNERORTS_TEST_USER, 'username' => 'pruefer'];

// ============================================================================================
// 1) Konstante und IstKlasse -- deckungsgleich mit AVESMAPS_BAUWERKSKLASSEN
// ============================================================================================
assert(
    AVESMAPS_INNERORTS_KLASSEN === AVESMAPS_BAUWERKSKLASSEN,
    'AVESMAPS_INNERORTS_KLASSEN darf nie von AVESMAPS_BAUWERKSKLASSEN abweichen: '
    . json_encode(AVESMAPS_INNERORTS_KLASSEN) . ' vs ' . json_encode(AVESMAPS_BAUWERKSKLASSEN)
);
$pruefungen++;
assert(avesmapsInnerortsIstKlasse('gebaeude') === true, 'gebaeude ist eine Innerorts-Klasse');
assert(avesmapsInnerortsIstKlasse('stadtviertel') === true, 'stadtviertel ist eine Innerorts-Klasse');
assert(avesmapsInnerortsIstKlasse('dorf') === false, 'dorf ist keine Innerorts-Klasse');
assert(avesmapsInnerortsIstKlasse('metropole') === false, 'metropole ist keine Innerorts-Klasse');
assert(avesmapsInnerortsIstKlasse('') === false, 'leer ist keine Innerorts-Klasse');
$pruefungen += 5;

// ============================================================================================
// 2) OrtVon / VonDerKarte -- reine Leser
// ============================================================================================
assert(avesmapsInnerortsOrtVon([]) === '', 'kein innerorts-Schluessel -> keiner');
assert(avesmapsInnerortsOrtVon(['innerorts' => ['ort' => 'stadt-1']]) === 'stadt-1', 'ort kommt mit');
assert(avesmapsInnerortsOrtVon(['innerorts' => 'kaputt']) === '', 'innerorts ist kein Array -> keiner (kein Fehler)');
assert(avesmapsInnerortsVonDerKarte([]) === false, 'kein innerorts -> nicht von der Karte genommen');
assert(avesmapsInnerortsVonDerKarte(['innerorts' => ['ort' => 'x']]) === false, 'ort ohne Merker -> auf der Karte');
assert(avesmapsInnerortsVonDerKarte(['innerorts' => ['ort' => 'x', 'von_der_karte' => true]]) === true, 'Merker gesetzt');
$pruefungen += 6;

// ============================================================================================
// 3) Setzen -- rein
// ============================================================================================
// -- Neu setzen, Herkunft manual.
$p1 = avesmapsInnerortsSetzen([], 'stadt-1', 'manual');
assert($p1['innerorts'] === ['ort' => 'stadt-1'], 'Setzen ohne vorherigen Merker: nur ort: ' . json_encode($p1));
assert($p1['field_origins']['innerorts'] === 'manual', 'Herkunft manual gestempelt');
$pruefungen += 2;

// -- Neu setzen, Herkunft wiki.
$p2 = avesmapsInnerortsSetzen([], 'stadt-1', 'wiki');
assert($p2['field_origins']['innerorts'] === 'wiki', 'Herkunft wiki gestempelt');
$pruefungen += 1;

// -- Ein vorhandener von_der_karte-Merker WANDERT MIT (Staetten-Kasten „⇄").
$p3 = avesmapsInnerortsSetzen(
    ['innerorts' => ['ort' => 'stadt-alt', 'von_der_karte' => true], 'field_origins' => ['innerorts' => 'manual']],
    'stadt-neu',
    'manual'
);
assert(
    $p3['innerorts'] === ['ort' => 'stadt-neu', 'von_der_karte' => true],
    'der Merker bleibt beim Stadtwechsel erhalten: ' . json_encode($p3['innerorts'])
);
$pruefungen += 1;

// -- Loesen ('' als ortId): das ganze Feld faellt, auch ein vorhandener Merker.
$p4 = avesmapsInnerortsSetzen(
    ['innerorts' => ['ort' => 'stadt-alt', 'von_der_karte' => true]],
    '',
    'manual'
);
assert(!array_key_exists('innerorts', $p4), 'Loesen entfernt das ganze Feld: ' . json_encode($p4));
assert($p4['field_origins']['innerorts'] === 'manual', 'auch das Loesen bekommt eine Herkunft gestempelt');
$pruefungen += 2;

// -- Unveraendert (derselbe Ort erneut gesetzt) ruehrt die Herkunft nicht an (Fall #72).
$p5a = avesmapsInnerortsSetzen([], 'stadt-1', 'wiki');
$p5b = avesmapsInnerortsSetzen($p5a, 'stadt-1', 'manual');
assert(
    $p5b['field_origins']['innerorts'] === 'wiki',
    'unveraendert bleibt unangetastet -- eine erneute Nennung mit ANDERER Herkunft aendert nichts, weil sich der WERT nicht geaendert hat: '
    . json_encode($p5b)
);
$pruefungen += 1;

// -- Andere Felder in field_origins bleiben erhalten (Setzen darf sie nicht verschlucken).
$p6 = avesmapsInnerortsSetzen(['field_origins' => ['name' => 'manual']], 'stadt-1', 'wiki');
assert($p6['field_origins']['name'] === 'manual' && $p6['field_origins']['innerorts'] === 'wiki',
    'fremde Herkunftsfelder bleiben erhalten: ' . json_encode($p6['field_origins']));
$pruefungen += 1;

// ============================================================================================
// 4) WikiStand
// ============================================================================================
$pdoWiki = avesmapsInnerortsTestPdo();
// Gareth als aktiver Kartenpunkt einer Siedlungsklasse.
avesmapsInnerortsTestPunktEinfuegen($pdoWiki, 'stadt-gareth', 'Gareth', 'metropole');
// Eine Stadt, deren Standort-Feld auf sie selbst zeigt, aber deren Klassifikator "outside" liefert.
avesmapsInnerortsTestPunktEinfuegen($pdoWiki, 'stadt-punin', 'Punin', 'stadt');

$pdoWiki->exec("INSERT INTO wiki_sync_pages (title, standort) VALUES ('Neu-Gareth', '[[Gareth]]')");
$pdoWiki->exec("INSERT INTO wiki_sync_pages (title, standort) VALUES ('Aussenposten', 'östlich von [[Punin]]')");
$pdoWiki->exec("INSERT INTO wiki_sync_pages (title, standort) VALUES ('Ohne Standort', '')");

// -- Stadtteil-Fall: [[Gareth]] -> genau ein Treffer.
$standGareth = avesmapsInnerortsWikiStand($pdoWiki, ['wiki_settlement' => ['title' => 'Neu-Gareth']]);
assert($standGareth === 'stadt-gareth', "Stadtteil-Fall: [[Gareth]] -> stadt-gareth, war: '{$standGareth}'");
$pruefungen++;

// -- Standort ausserhalb (Praefix "östlich von") -> '' (Klassifikator liefert 'outside').
$standAussen = avesmapsInnerortsWikiStand($pdoWiki, ['wiki_settlement' => ['title' => 'Aussenposten']]);
assert($standAussen === '', "ausserhalb -> '': war '{$standAussen}'");
$pruefungen++;

// -- Kein Standort-Feld -> ''.
$standLeer = avesmapsInnerortsWikiStand($pdoWiki, ['wiki_settlement' => ['title' => 'Ohne Standort']]);
assert($standLeer === '', 'leeres Standort-Feld -> ""');
$pruefungen++;

// -- Titel aus properties.name, wenn wiki_settlement.title fehlt.
$pdoWiki->exec("INSERT INTO wiki_sync_pages (title, standort) VALUES ('Namensfall', '[[Gareth]]')");
$standNamensfall = avesmapsInnerortsWikiStand($pdoWiki, ['name' => 'Namensfall']);
assert($standNamensfall === 'stadt-gareth', 'Titel faellt auf properties.name zurueck: ' . $standNamensfall);
$pruefungen++;

// -- Doppeldeutige Stadt: ein zweiter Punkt, dessen gefalteter Name den ersten spiegelt.
$pdoDoppelt = avesmapsInnerortsTestPdo();
avesmapsInnerortsTestPunktEinfuegen($pdoDoppelt, 'stadt-a', 'Perricum', 'stadt');
avesmapsInnerortsTestPunktEinfuegen($pdoDoppelt, 'stadt-b', 'perricum', 'dorf'); // gefaltet identisch
$pdoDoppelt->exec("INSERT INTO wiki_sync_pages (title, standort) VALUES ('Hafenviertel', '[[Perricum]]')");
$standDoppelt = avesmapsInnerortsWikiStand($pdoDoppelt, ['wiki_settlement' => ['title' => 'Hafenviertel']]);
assert($standDoppelt === '', "doppeldeutige Stadt -> '': war '{$standDoppelt}'");
$pruefungen++;

// -- Unbekannter Titel (keine Zeile in wiki_sync_pages) -> ''.
$standUnbekannt = avesmapsInnerortsWikiStand($pdoWiki, ['wiki_settlement' => ['title' => 'Gibt es nicht']]);
assert($standUnbekannt === '', 'unbekannter Titel -> ""');
$pruefungen++;

// -- Kein Titel und kein Name -> '' (keine Datenbankabfrage noetig).
assert(avesmapsInnerortsWikiStand($pdoWiki, []) === '', 'weder Titel noch Name -> ""');
$pruefungen++;

// -- Fehlende Tabelle/Spalte faellt offen aus: ''.
$pdoOhneWiki = new AvesmapsInnerortsTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdoOhneWiki->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT, feature_subtype TEXT, name TEXT,
    properties_json TEXT, is_active INTEGER DEFAULT 1)');
$standOhneTabelle = avesmapsInnerortsWikiStand($pdoOhneWiki, ['wiki_settlement' => ['title' => 'Irgendwas']]);
assert($standOhneTabelle === '', 'fehlende wiki_sync_pages-Tabelle faellt offen aus: ""');
$pruefungen++;

// -- Die Tabelle existiert, aber die Spalte `standort` fehlt (eine frische Installation VOR dem
// naechsten „Siedlungen syncen", siehe die Kopf-Notiz an der ALTER-TABLE-Stelle in
// api/_internal/wiki/settlements.php) -- faellt ebenso offen aus: ''.
$pdoOhneSpalte = new AvesmapsInnerortsTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdoOhneSpalte->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT, feature_subtype TEXT, name TEXT,
    properties_json TEXT, is_active INTEGER DEFAULT 1)');
$pdoOhneSpalte->exec('CREATE TABLE wiki_sync_pages (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT)');
$pdoOhneSpalte->exec("INSERT INTO wiki_sync_pages (title) VALUES ('Irgendwas')");
$standOhneSpalte = avesmapsInnerortsWikiStand($pdoOhneSpalte, ['wiki_settlement' => ['title' => 'Irgendwas']]);
assert($standOhneSpalte === '', 'fehlende Spalte standort faellt offen aus: ""');
$pruefungen++;

// ============================================================================================
// 5) ZielPruefen
// ============================================================================================
$pdoZiel = avesmapsInnerortsTestPdo();
avesmapsInnerortsTestPunktEinfuegen($pdoZiel, 'ziel-stadt', 'Zielstadt', 'kleinstadt');
avesmapsInnerortsTestPunktEinfuegen($pdoZiel, 'ziel-kreuzung', 'Kreuzung-1', 'crossing');
avesmapsInnerortsTestPunktEinfuegen($pdoZiel, 'ziel-gebaeude', 'Irgendein Gebaeude', 'gebaeude');
avesmapsInnerortsTestPunktEinfuegen($pdoZiel, 'ziel-inaktiv', 'Inaktive Stadt', 'dorf', [], false);

assert(avesmapsInnerortsZielPruefen($pdoZiel, 'ziel-stadt', 'eigene-id') === null, 'gueltiges Ziel -> null');
assert(avesmapsInnerortsZielPruefen($pdoZiel, '', 'eigene-id') !== null, 'leeres Ziel -> Fehler');
assert(avesmapsInnerortsZielPruefen($pdoZiel, 'ziel-stadt', 'ziel-stadt') !== null, 'Ziel = der Punkt selbst -> Fehler');
assert(avesmapsInnerortsZielPruefen($pdoZiel, 'ziel-kreuzung', 'x') !== null, 'Kreuzung ist kein gueltiges Ziel');
assert(avesmapsInnerortsZielPruefen($pdoZiel, 'ziel-gebaeude', 'x') !== null, 'ein Gebaeude ist kein gueltiges Ziel');
assert(avesmapsInnerortsZielPruefen($pdoZiel, 'ziel-inaktiv', 'x') !== null, 'ein inaktives Ziel ist ungueltig');
assert(avesmapsInnerortsZielPruefen($pdoZiel, 'gibt-es-nicht', 'x') !== null, 'ein unbekanntes Ziel ist ungueltig');
$pruefungen += 7;

// ============================================================================================
// 6) WikiNachziehen
// ============================================================================================
$pdoWn = avesmapsInnerortsTestPdo();
avesmapsInnerortsTestPunktEinfuegen($pdoWn, 'wn-stadt-gareth', 'Gareth', 'metropole');
$pdoWn->exec("INSERT INTO wiki_sync_pages (title, standort) VALUES ('Wn-Artikel', '[[Gareth]]')");

// -- Falsche Klasse (dorf) -> false, kein Schreiben.
$idKeineKlasse = avesmapsInnerortsTestPunktEinfuegen($pdoWn, 'wn-dorf', 'Irgendein Dorf', 'dorf',
    ['wiki_settlement' => ['title' => 'Wn-Artikel']]);
assert(avesmapsInnerortsWikiNachziehen($pdoWn, 'wn-dorf', AVESMAPS_INNERORTS_TEST_USER) === false,
    'falsche Ortsgroesse -> false');
$pruefungen++;

// -- Unbekannter Punkt -> false.
assert(avesmapsInnerortsWikiNachziehen($pdoWn, 'gibt-es-nicht', AVESMAPS_INNERORTS_TEST_USER) === false,
    'unbekannter Punkt -> false');
$pruefungen++;

// -- manual wird NIE ueberschrieben.
avesmapsInnerortsTestPunktEinfuegen($pdoWn, 'wn-manual', 'Handbau', 'gebaeude', [
    'wiki_settlement' => ['title' => 'Wn-Artikel'],
    'innerorts' => ['ort' => 'stadt-von-hand'],
    'field_origins' => ['innerorts' => 'manual'],
]);
$vorherManual = avesmapsInnerortsTestZeile($pdoWn, 'wn-manual');
$geschriebenManual = avesmapsInnerortsWikiNachziehen($pdoWn, 'wn-manual', AVESMAPS_INNERORTS_TEST_USER);
assert($geschriebenManual === false, 'manuelle Zuordnung wird nie ueberschrieben -> false');
$nachherManual = avesmapsInnerortsTestZeile($pdoWn, 'wn-manual');
assert($vorherManual['properties_json'] === $nachherManual['properties_json'], 'manuelle Properties bleiben byte-gleich');
$pruefungen += 2;

// -- Echte Aenderung: keine Zuordnung bisher, Wiki-Stand vorhanden -> schreibt, Herkunft 'wiki'.
avesmapsInnerortsTestPunktEinfuegen($pdoWn, 'wn-neu', 'Neu-Gareth', 'stadtviertel', [
    'wiki_settlement' => ['title' => 'Wn-Artikel'],
]);
$audAnzahlVor = (int) $pdoWn->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();
$revisionVor = (int) avesmapsInnerortsTestZeile($pdoWn, 'wn-neu')['revision'];
$geschriebenNeu = avesmapsInnerortsWikiNachziehen($pdoWn, 'wn-neu', AVESMAPS_INNERORTS_TEST_USER);
assert($geschriebenNeu === true, 'eine echte Aenderung schreibt -> true');
$nachherNeu = avesmapsInnerortsTestZeile($pdoWn, 'wn-neu');
$propsNeu = json_decode((string) $nachherNeu['properties_json'], true);
assert($propsNeu['innerorts']['ort'] === 'wn-stadt-gareth', 'der Wiki-Stand wurde eingetragen: ' . json_encode($propsNeu));
assert($propsNeu['field_origins']['innerorts'] === 'wiki', 'Herkunft ist wiki');
assert((int) $nachherNeu['revision'] > $revisionVor, 'die Revision wurde weitergeschaltet');
$audAnzahlNach = (int) $pdoWn->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();
assert($audAnzahlNach === $audAnzahlVor + 1, 'genau ein Protokolleintrag entstand');
$letzterAuditNeu = avesmapsInnerortsTestLetzterAudit($pdoWn);
assert($letzterAuditNeu['action'] === 'wiki_sync_update_point', 'die Aktion heisst wiki_sync_update_point');
$pruefungen += 5;

// -- Keine echte Aenderung (Wiki-Stand entspricht bereits dem gespeicherten Wert) -> false, kein
// weiterer Protokolleintrag.
$audAnzahlVorNochmal = (int) $pdoWn->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();
$geschriebenNochmal = avesmapsInnerortsWikiNachziehen($pdoWn, 'wn-neu', AVESMAPS_INNERORTS_TEST_USER);
assert($geschriebenNochmal === false, 'unveraendert -> false');
$audAnzahlNachNochmal = (int) $pdoWn->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();
assert($audAnzahlNachNochmal === $audAnzahlVorNochmal, 'kein zusaetzlicher Protokolleintrag bei Unveraendertheit');
$pruefungen += 2;

// -- Dissolving: der Artikel nennt jetzt keine Stadt mehr -> ein bisher wiki-stammender Wert wird
// entfernt -- UND field_origins.innerorts faellt mit weg (kein totes Nest fuer ein Feld, das es
// nicht mehr gibt; anders als beim MANUELLEN Loesen, das als Override 'manual' stehen bleibt).
avesmapsInnerortsTestPunktEinfuegen($pdoWn, 'wn-loesen', 'Wird geloest', 'gebaeude', [
    'wiki_settlement' => ['title' => 'Wn-Artikel-Weg'],
    'innerorts' => ['ort' => 'wn-stadt-gareth'],
    'field_origins' => ['innerorts' => 'wiki'],
]);
// Kein Eintrag in wiki_sync_pages fuer 'Wn-Artikel-Weg' -> WikiStand liefert '' -> Aenderung.
$geschriebenLoesen = avesmapsInnerortsWikiNachziehen($pdoWn, 'wn-loesen', AVESMAPS_INNERORTS_TEST_USER);
assert($geschriebenLoesen === true, 'Loesen ist eine echte Aenderung -> true');
$nachherLoesen = json_decode((string) avesmapsInnerortsTestZeile($pdoWn, 'wn-loesen')['properties_json'], true);
assert(!array_key_exists('innerorts', $nachherLoesen), 'der wiki-stammende Wert wurde entfernt: ' . json_encode($nachherLoesen));
assert(
    !array_key_exists('field_origins', $nachherLoesen) || !array_key_exists('innerorts', $nachherLoesen['field_origins']),
    'field_origins.innerorts faellt beim Wiki-Loesen mit weg: ' . json_encode($nachherLoesen)
);
$pruefungen += 3;

// -- Ein Feld, das NEBEN innerorts in field_origins steht, bleibt beim Wiki-Loesen unberuehrt.
avesmapsInnerortsTestPunktEinfuegen($pdoWn, 'wn-loesen-fremdfeld', 'Wird auch geloest', 'gebaeude', [
    'wiki_settlement' => ['title' => 'Wn-Artikel-Weg-2'],
    'innerorts' => ['ort' => 'wn-stadt-gareth'],
    'field_origins' => ['innerorts' => 'wiki', 'name' => 'manual'],
]);
avesmapsInnerortsWikiNachziehen($pdoWn, 'wn-loesen-fremdfeld', AVESMAPS_INNERORTS_TEST_USER);
$nachherFremdfeld = json_decode((string) avesmapsInnerortsTestZeile($pdoWn, 'wn-loesen-fremdfeld')['properties_json'], true);
assert(
    ($nachherFremdfeld['field_origins'] ?? null) === ['name' => 'manual'],
    'nur innerorts faellt weg, ein fremdes Herkunftsfeld bleibt: ' . json_encode($nachherFremdfeld['field_origins'] ?? null)
);
$pruefungen++;

// -- M3 (Controller-Fix): Nachziehen an einem INAKTIVEN, von der Karte genommenen Punkt bleibt
// rueckgaengig zu machen. Ohne den `is_active`-Schluessel im Nachher-Schnappschuss faellt
// `avesmapsAssertUndoPatchStillCurrent` auf die blinde Annahme „is_active=1" zurueck und wirft
// faelschlich „wurde inzwischen erneut geaendert".
avesmapsInnerortsTestPunktEinfuegen($pdoWn, 'wn-inaktiv', 'Von der Karte genommen', 'gebaeude', [
    'wiki_settlement' => ['title' => 'Wn-Artikel'],
    'innerorts' => ['ort' => 'x-alte-stadt', 'von_der_karte' => true],
], false);
$vorherInaktiv = avesmapsInnerortsTestZeile($pdoWn, 'wn-inaktiv');
$geschriebenInaktiv = avesmapsInnerortsWikiNachziehen($pdoWn, 'wn-inaktiv', AVESMAPS_INNERORTS_TEST_USER);
assert($geschriebenInaktiv === true, 'der Wiki-Stand aendert sich auch an einem inaktiven Punkt -> true');
$nachherInaktiv = avesmapsInnerortsTestZeile($pdoWn, 'wn-inaktiv');
assert((int) $nachherInaktiv['is_active'] === 0, 'bleibt inaktiv');
$letzterAuditInaktiv = avesmapsInnerortsTestLetzterAudit($pdoWn);
assert($letzterAuditInaktiv['action'] === 'wiki_sync_update_point', 'Aktion heisst wiki_sync_update_point');
$rueckgaengigInaktiv = avesmapsUndoAuditChange($pdoWn, ['audit_id' => (int) $letzterAuditInaktiv['id']], $user);
assert(is_array($rueckgaengigInaktiv), 'Rueckgaengig gelingt an einem inaktiven Punkt: ' . json_encode($rueckgaengigInaktiv));
$zeileNachUndoInaktiv = avesmapsInnerortsTestZeile($pdoWn, 'wn-inaktiv');
assert((int) $zeileNachUndoInaktiv['is_active'] === 0, 'is_active bleibt unveraendert (0)');
assert(
    $zeileNachUndoInaktiv['properties_json'] === $vorherInaktiv['properties_json'],
    'die Properties sind wieder wie vor dem Nachziehen: ' . $zeileNachUndoInaktiv['properties_json']
);
$pruefungen += 6;

// ============================================================================================
// 7) VonDerKarteNehmen
// ============================================================================================
$pdoVdk = avesmapsInnerortsTestPdo();

// -- unbekannter Punkt -> not_found.
$ergVdkUnbekannt = avesmapsInnerortsVonDerKarteNehmen($pdoVdk, 'gibt-es-nicht', AVESMAPS_INNERORTS_TEST_USER);
assert($ergVdkUnbekannt === ['ok' => false, 'code' => 'not_found', 'message' => 'Das Kartenobjekt wurde nicht gefunden.'],
    json_encode($ergVdkUnbekannt));
$pruefungen++;

// -- bereits inaktiv -> invalid_state.
avesmapsInnerortsTestPunktEinfuegen($pdoVdk, 'vdk-inaktiv', 'Schon weg', 'gebaeude',
    ['innerorts' => ['ort' => 'irgendeine-stadt']], false);
$ergVdkInaktiv = avesmapsInnerortsVonDerKarteNehmen($pdoVdk, 'vdk-inaktiv', AVESMAPS_INNERORTS_TEST_USER);
assert($ergVdkInaktiv['ok'] === false && $ergVdkInaktiv['code'] === 'invalid_state', json_encode($ergVdkInaktiv));
$pruefungen++;

// -- aktiv, aber ohne innerorts.ort -> invalid_state.
avesmapsInnerortsTestPunktEinfuegen($pdoVdk, 'vdk-ohne-ort', 'Ohne Stadt', 'gebaeude', []);
$ergVdkOhneOrt = avesmapsInnerortsVonDerKarteNehmen($pdoVdk, 'vdk-ohne-ort', AVESMAPS_INNERORTS_TEST_USER);
assert($ergVdkOhneOrt['ok'] === false && $ergVdkOhneOrt['code'] === 'invalid_state', json_encode($ergVdkOhneOrt));
$pruefungen++;

// -- Kraftlinien-Riegel: eine Kraftlinie haengt am Punkt -> wirft, keine Aenderung.
avesmapsInnerortsTestPunktEinfuegen($pdoVdk, 'vdk-kraftlinie', 'Kraftlinienanker', 'gebaeude',
    ['innerorts' => ['ort' => 'irgendeine-stadt']]);
$pdoVdk->prepare(
    "INSERT INTO map_features (public_id, feature_type, feature_subtype, name, properties_json, is_active, revision)
     VALUES ('kraftlinie-1', 'powerline', 'powerline', 'Testlinie', :props, 1, 1)"
)->execute(['props' => json_encode(['from_public_id' => 'vdk-kraftlinie', 'to_public_id' => 'irgendwo'])]);
$audVorRiegel = (int) $pdoVdk->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();
$geworfen = false;
try {
    avesmapsInnerortsVonDerKarteNehmen($pdoVdk, 'vdk-kraftlinie', AVESMAPS_INNERORTS_TEST_USER);
} catch (InvalidArgumentException $exception) {
    $geworfen = true;
    assert(str_contains($exception->getMessage(), 'Testlinie'), 'die Meldung nennt die Kraftlinie: ' . $exception->getMessage());
}
assert($geworfen, 'eine angehaengte Kraftlinie verhindert das Von-der-Karte-Nehmen');
$pruefungen += 2;
assert((int) avesmapsInnerortsTestZeile($pdoVdk, 'vdk-kraftlinie')['is_active'] === 1,
    'der Punkt bleibt bei einem Kraftlinien-Wurf aktiv (die Transaktion wurde zurueckgerollt)');
$audNachRiegel = (int) $pdoVdk->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();
assert($audNachRiegel === $audVorRiegel, 'kein Protokolleintrag bei einem Kraftlinien-Wurf');
assert($pdoVdk->inTransaction() === false, 'die Transaktion ist nach dem Wurf sauber zurueckgerollt');
$pruefungen += 3;

// -- Erfolg: is_active=0, Merker gesetzt, Ort unveraendert, ein Protokolleintrag 'take_off_map'.
avesmapsInnerortsTestPunktEinfuegen($pdoVdk, 'vdk-erfolg', 'Neu-Gareth', 'stadtviertel',
    ['innerorts' => ['ort' => 'vdk-stadt-gareth'], 'field_origins' => ['innerorts' => 'wiki']]);
avesmapsInnerortsTestPunktEinfuegen($pdoVdk, 'vdk-stadt-gareth', 'Gareth', 'metropole');
$audAnzahlVorErfolg = (int) $pdoVdk->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();
$ergVdkErfolg = avesmapsInnerortsVonDerKarteNehmen($pdoVdk, 'vdk-erfolg', AVESMAPS_INNERORTS_TEST_USER);
assert($ergVdkErfolg === ['ok' => true, 'public_id' => 'vdk-erfolg', 'name' => 'Neu-Gareth'], json_encode($ergVdkErfolg));
$zeileVdkErfolg = avesmapsInnerortsTestZeile($pdoVdk, 'vdk-erfolg');
assert((int) $zeileVdkErfolg['is_active'] === 0, 'ist inaktiv');
$propsVdkErfolg = json_decode((string) $zeileVdkErfolg['properties_json'], true);
assert(
    $propsVdkErfolg['innerorts'] === ['ort' => 'vdk-stadt-gareth', 'von_der_karte' => true],
    'Merker gesetzt, Ort unveraendert: ' . json_encode($propsVdkErfolg['innerorts'])
);
assert($propsVdkErfolg['field_origins']['innerorts'] === 'wiki', 'die Herkunft bleibt unangetastet');
$audAnzahlNachErfolg = (int) $pdoVdk->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();
assert($audAnzahlNachErfolg === $audAnzahlVorErfolg + 1, 'genau ein neuer Protokolleintrag');
$letzterAuditVdk = avesmapsInnerortsTestLetzterAudit($pdoVdk);
assert($letzterAuditVdk['action'] === 'take_off_map', 'die Aktion heisst take_off_map');
$pruefungen += 6;

// ============================================================================================
// 8) Rueckgaengig ueber die echte Undo-Maschinerie (avesmapsUndoAuditChange)
// ============================================================================================
$auditIdVdk = (int) $letzterAuditVdk['id'];
$rueckgaengig = avesmapsUndoAuditChange($pdoVdk, ['audit_id' => $auditIdVdk], $user);
assert(is_array($rueckgaengig), 'Rueckgaengig liefert eine Antwort: ' . json_encode($rueckgaengig));
$zeileNachRueckgaengig = avesmapsInnerortsTestZeile($pdoVdk, 'vdk-erfolg');
assert((int) $zeileNachRueckgaengig['is_active'] === 1, 'Rueckgaengig stellt is_active wieder her');
$propsNachRueckgaengig = json_decode((string) $zeileNachRueckgaengig['properties_json'], true);
assert(
    $propsNachRueckgaengig['innerorts'] === ['ort' => 'vdk-stadt-gareth'],
    'Rueckgaengig stellt die Properties her -- der Merker ist wieder weg: ' . json_encode($propsNachRueckgaengig)
);
assert($propsNachRueckgaengig['field_origins']['innerorts'] === 'wiki', 'die Herkunft bleibt beim Rueckgaengig erhalten');
$auditNachUndo = avesmapsInnerortsTestLetzterAudit($pdoVdk);
assert($auditNachUndo['action'] === 'undo_take_off_map', 'der Undo-Eintrag heisst undo_take_off_map');
$pruefungen += 5;

// ============================================================================================
// 9) AufDieKarteSetzen
// ============================================================================================
$pdoAdk = avesmapsInnerortsTestPdo();

$ergAdkUnbekannt = avesmapsInnerortsAufDieKarteSetzen($pdoAdk, 'gibt-es-nicht', AVESMAPS_INNERORTS_TEST_USER);
assert($ergAdkUnbekannt['ok'] === false && $ergAdkUnbekannt['code'] === 'not_found', json_encode($ergAdkUnbekannt));
$pruefungen++;

avesmapsInnerortsTestPunktEinfuegen($pdoAdk, 'adk-aktiv', 'Ist schon da', 'gebaeude',
    ['innerorts' => ['ort' => 'x']], true);
$ergAdkAktiv = avesmapsInnerortsAufDieKarteSetzen($pdoAdk, 'adk-aktiv', AVESMAPS_INNERORTS_TEST_USER);
assert($ergAdkAktiv['ok'] === false && $ergAdkAktiv['code'] === 'invalid_state', json_encode($ergAdkAktiv));
$pruefungen++;

// -- inaktiv, aber OHNE Merker (regulaer geloescht) -> invalid_state.
avesmapsInnerortsTestPunktEinfuegen($pdoAdk, 'adk-ohne-merker', 'Normal geloescht', 'gebaeude',
    ['innerorts' => ['ort' => 'x']], false);
$ergAdkOhneMerker = avesmapsInnerortsAufDieKarteSetzen($pdoAdk, 'adk-ohne-merker', AVESMAPS_INNERORTS_TEST_USER);
assert($ergAdkOhneMerker['ok'] === false && $ergAdkOhneMerker['code'] === 'invalid_state', json_encode($ergAdkOhneMerker));
$pruefungen++;

// -- Erfolg: is_active=1, Merker weg, Ort bleibt.
avesmapsInnerortsTestPunktEinfuegen($pdoAdk, 'adk-erfolg', 'Kommt zurueck', 'stadtviertel',
    ['innerorts' => ['ort' => 'adk-stadt', 'von_der_karte' => true], 'field_origins' => ['innerorts' => 'manual']],
    false);
$audAnzahlVorAdk = (int) $pdoAdk->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();
$ergAdkErfolg = avesmapsInnerortsAufDieKarteSetzen($pdoAdk, 'adk-erfolg', AVESMAPS_INNERORTS_TEST_USER);
assert($ergAdkErfolg === ['ok' => true, 'public_id' => 'adk-erfolg', 'name' => 'Kommt zurueck'], json_encode($ergAdkErfolg));
$zeileAdkErfolg = avesmapsInnerortsTestZeile($pdoAdk, 'adk-erfolg');
assert((int) $zeileAdkErfolg['is_active'] === 1, 'wieder aktiv');
$propsAdkErfolg = json_decode((string) $zeileAdkErfolg['properties_json'], true);
assert($propsAdkErfolg['innerorts'] === ['ort' => 'adk-stadt'], 'Merker weg, Ort bleibt: ' . json_encode($propsAdkErfolg['innerorts']));
$audAnzahlNachAdk = (int) $pdoAdk->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();
assert($audAnzahlNachAdk === $audAnzahlVorAdk + 1, 'genau ein Protokolleintrag');
assert(avesmapsInnerortsTestLetzterAudit($pdoAdk)['action'] === 'put_on_map', 'die Aktion heisst put_on_map');
$pruefungen += 5;

// ============================================================================================
// 10) EndgueltigEntfernen
// ============================================================================================
$pdoEe = avesmapsInnerortsTestPdo();

$ergEeUnbekannt = avesmapsInnerortsEndgueltigEntfernen($pdoEe, 'gibt-es-nicht', AVESMAPS_INNERORTS_TEST_USER);
assert($ergEeUnbekannt['ok'] === false && $ergEeUnbekannt['code'] === 'not_found', json_encode($ergEeUnbekannt));
$pruefungen++;

avesmapsInnerortsTestPunktEinfuegen($pdoEe, 'ee-aktiv', 'Noch da', 'gebaeude', ['innerorts' => ['ort' => 'x']], true);
$ergEeAktiv = avesmapsInnerortsEndgueltigEntfernen($pdoEe, 'ee-aktiv', AVESMAPS_INNERORTS_TEST_USER);
assert($ergEeAktiv['ok'] === false && $ergEeAktiv['code'] === 'invalid_state', json_encode($ergEeAktiv));
$pruefungen++;

avesmapsInnerortsTestPunktEinfuegen($pdoEe, 'ee-ohne-merker', 'Normal geloescht', 'gebaeude',
    ['innerorts' => ['ort' => 'x']], false);
$ergEeOhneMerker = avesmapsInnerortsEndgueltigEntfernen($pdoEe, 'ee-ohne-merker', AVESMAPS_INNERORTS_TEST_USER);
assert($ergEeOhneMerker['ok'] === false && $ergEeOhneMerker['code'] === 'invalid_state', json_encode($ergEeOhneMerker));
$pruefungen++;

avesmapsInnerortsTestPunktEinfuegen($pdoEe, 'ee-erfolg', 'Geht ganz weg', 'gebaeude',
    ['innerorts' => ['ort' => 'ee-stadt', 'von_der_karte' => true], 'field_origins' => ['innerorts' => 'manual']],
    false);
$ergEeErfolg = avesmapsInnerortsEndgueltigEntfernen($pdoEe, 'ee-erfolg', AVESMAPS_INNERORTS_TEST_USER);
assert($ergEeErfolg === ['ok' => true, 'public_id' => 'ee-erfolg', 'name' => 'Geht ganz weg'], json_encode($ergEeErfolg));
$zeileEeErfolg = avesmapsInnerortsTestZeile($pdoEe, 'ee-erfolg');
assert((int) $zeileEeErfolg['is_active'] === 0, 'bleibt inaktiv');
$propsEeErfolg = json_decode((string) $zeileEeErfolg['properties_json'], true);
assert(!array_key_exists('innerorts', $propsEeErfolg), 'innerorts ist ganz weg: ' . json_encode($propsEeErfolg));
$letzterAuditEe = avesmapsInnerortsTestLetzterAudit($pdoEe);
assert($letzterAuditEe['action'] === 'innerorts_endgueltig_entfernen', 'Protokolleintrag geschrieben');
$pruefungen += 4;

// -- Umkehrbar wie jedes Loeschen (Controller-Entscheid, 2. Runde): „endgueltig" heisst „loescht
// den Punkt auch als Staette", nicht „unumkehrbar" -- ueber Rueckgaengig im Aenderungsverlauf
// kommt der Merker zurueck, der Punkt bleibt inaktiv.
assert(
    avesmapsUndoColumnsForAuditAction('innerorts_endgueltig_entfernen') === ['properties_json'],
    'die Aktion ist rueckgaengig zu machen -- nur properties_json, is_active aendert sich hier nie: '
    . json_encode(avesmapsUndoColumnsForAuditAction('innerorts_endgueltig_entfernen'))
);
$pruefungen++;

$rueckgaengigEe = avesmapsUndoAuditChange($pdoEe, ['audit_id' => (int) $letzterAuditEe['id']], $user);
assert(is_array($rueckgaengigEe), 'Rueckgaengig liefert eine Antwort: ' . json_encode($rueckgaengigEe));
$zeileNachRueckgaengigEe = avesmapsInnerortsTestZeile($pdoEe, 'ee-erfolg');
assert((int) $zeileNachRueckgaengigEe['is_active'] === 0, 'bleibt inaktiv (is_active hat sich nie geaendert)');
$propsNachRueckgaengigEe = json_decode((string) $zeileNachRueckgaengigEe['properties_json'], true);
assert(
    $propsNachRueckgaengigEe['innerorts'] === ['ort' => 'ee-stadt', 'von_der_karte' => true],
    'der Merker ist wieder da: ' . json_encode($propsNachRueckgaengigEe)
);
assert(
    avesmapsInnerortsTestLetzterAudit($pdoEe)['action'] === 'undo_innerorts_endgueltig_entfernen',
    'der Undo-Eintrag heisst undo_innerorts_endgueltig_entfernen'
);
$pruefungen += 3;

// ============================================================================================
// 11) PunkteFuerStaetten
// ============================================================================================
$pdoPfs = avesmapsInnerortsTestPdo();
avesmapsInnerortsTestPunktEinfuegen($pdoPfs, 'pfs-stadt', 'Gareth', 'metropole');
avesmapsInnerortsTestPunktEinfuegen($pdoPfs, 'pfs-stadt-tot', 'Untergegangen', 'dorf', [], false);

// aktiver Punkt mit ort, place_kind gesetzt, wiki_settlement.wiki_url vorhanden.
avesmapsInnerortsTestPunktEinfuegen($pdoPfs, 'pfs-aktiv', 'Zwiebelturm', 'gebaeude', [
    'innerorts' => ['ort' => 'pfs-stadt'],
    'place_kind' => 'Turm',
    'wiki_settlement' => ['wiki_url' => 'https://x/turm'],
]);
// inaktiver Punkt MIT Merker -> kommt mit, auf_der_karte = false.
avesmapsInnerortsTestPunktEinfuegen($pdoPfs, 'pfs-genommen', 'Alte Schmiede', 'gebaeude', [
    'innerorts' => ['ort' => 'pfs-stadt', 'von_der_karte' => true],
    'wiki_url' => 'https://y/schmiede',
], false);
// inaktiver Punkt OHNE Merker (regulaer geloescht) -> faellt raus.
avesmapsInnerortsTestPunktEinfuegen($pdoPfs, 'pfs-geloescht', 'Weg damit', 'gebaeude', [
    'innerorts' => ['ort' => 'pfs-stadt'],
], false);
// aktiver Punkt, dessen Stadt nicht mehr existiert/aktiv ist -> faellt raus.
avesmapsInnerortsTestPunktEinfuegen($pdoPfs, 'pfs-verwaist', 'Verwaistes Haus', 'gebaeude', [
    'innerorts' => ['ort' => 'pfs-stadt-tot'],
]);
// stadtviertel -> type = "Stadtviertel", unabhaengig von place_kind.
avesmapsInnerortsTestPunktEinfuegen($pdoPfs, 'pfs-viertel', 'Neu-Gareth', 'stadtviertel', [
    'innerorts' => ['ort' => 'pfs-stadt'],
]);
// ein Punkt, der GAR KEIN innerorts traegt -- taucht nicht auf (die LIKE-Vorfilterung UND die
// Ort-Pruefung muessen ihn beide ausschliessen).
avesmapsInnerortsTestPunktEinfuegen($pdoPfs, 'pfs-ohne', 'Unbeteiligt', 'gebaeude', []);

$staetten = avesmapsInnerortsPunkteFuerStaetten($pdoPfs);
$nachName = [];
foreach ($staetten as $eintrag) {
    $nachName[$eintrag['name']] = $eintrag;
}

assert(count($staetten) === 3, 'genau drei Eintraege (aktiv, genommen, viertel): ' . json_encode(array_keys($nachName)));
$pruefungen++;
assert(isset($nachName['Zwiebelturm']) && isset($nachName['Alte Schmiede']) && isset($nachName['Neu-Gareth']),
    'die drei richtigen Namen kommen mit: ' . json_encode(array_keys($nachName)));
$pruefungen++;
assert(!isset($nachName['Weg damit']), 'regulaer geloescht (ohne Merker) erscheint nicht');
assert(!isset($nachName['Verwaistes Haus']), 'die Stadt ist nicht mehr aktiv -> der Eintrag entfaellt');
assert(!isset($nachName['Unbeteiligt']), 'ein Punkt ohne innerorts erscheint nicht');
$pruefungen += 3;

$zwiebel = $nachName['Zwiebelturm'];
assert($zwiebel['settlement'] === 'Gareth', 'Stadtname kommt vom Stadtpunkt: ' . json_encode($zwiebel));
assert($zwiebel['type'] === 'Turm', 'type = place_kind: ' . json_encode($zwiebel));
assert($zwiebel['wiki_url'] === 'https://x/turm', 'wiki_url aus wiki_settlement: ' . json_encode($zwiebel));
assert($zwiebel['public_id'] === 'pfs-aktiv', 'public_id kommt mit');
assert($zwiebel['auf_der_karte'] === true, 'aktiver Punkt -> auf_der_karte = true');
$pruefungen += 5;

$schmiede = $nachName['Alte Schmiede'];
assert($schmiede['auf_der_karte'] === false, 'genommener Punkt -> auf_der_karte = false');
assert($schmiede['wiki_url'] === 'https://y/schmiede', 'wiki_url faellt auf properties.wiki_url zurueck (kein wiki_settlement)');
assert($schmiede['type'] === '', 'kein place_kind -> leerer Typ: ' . json_encode($schmiede));
$pruefungen += 3;

$viertel = $nachName['Neu-Gareth'];
assert($viertel['type'] === 'Stadtviertel', 'stadtviertel bekommt den festen Typ: ' . json_encode($viertel));
$pruefungen++;

// -- Fehlende Tabelle faellt offen aus: [].
$pdoOhneKarte = new AvesmapsInnerortsTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
assert(avesmapsInnerortsPunkteFuerStaetten($pdoOhneKarte) === [], 'fehlende map_features-Tabelle -> []');
$pruefungen++;

// ============================================================================================
// 12) AusWikiLauf
// ============================================================================================
$pdoLauf = avesmapsInnerortsTestPdo();
avesmapsInnerortsTestPunktEinfuegen($pdoLauf, 'lauf-stadt', 'Gareth', 'metropole');
$pdoLauf->exec("INSERT INTO wiki_sync_pages (title, standort) VALUES ('Lauf-Artikel-1', '[[Gareth]]')");
$pdoLauf->exec("INSERT INTO wiki_sync_pages (title, standort) VALUES ('Lauf-Artikel-2', '[[Gareth]]')");
$pdoLauf->exec("INSERT INTO wiki_sync_pages (title, standort) VALUES ('Lauf-Artikel-3', '[[Gareth]]')");

// Kandidat 1+2: wiki-zugewiesen, kein bisheriger Ort -> aendern sich.
avesmapsInnerortsTestPunktEinfuegen($pdoLauf, 'lauf-1', 'Kandidat Eins', 'gebaeude',
    ['wiki_settlement' => ['title' => 'Lauf-Artikel-1']]);
avesmapsInnerortsTestPunktEinfuegen($pdoLauf, 'lauf-2', 'Kandidat Zwei', 'stadtviertel',
    ['wiki_settlement' => ['title' => 'Lauf-Artikel-2']]);
// manuell zugeordnet -> wird NIE angefasst, auch nicht gezaehlt.
avesmapsInnerortsTestPunktEinfuegen($pdoLauf, 'lauf-manual', 'Handbau', 'gebaeude', [
    'wiki_settlement' => ['title' => 'Lauf-Artikel-3'],
    'innerorts' => ['ort' => 'woanders'],
    'field_origins' => ['innerorts' => 'manual'],
]);
// keine Wiki-Zuweisung -> zaehlt nicht.
avesmapsInnerortsTestPunktEinfuegen($pdoLauf, 'lauf-ohne-wiki', 'Ohne Wiki', 'gebaeude', []);
// schon auf dem aktuellen Wiki-Stand -> keine echte Aenderung, zaehlt nicht.
avesmapsInnerortsTestPunktEinfuegen($pdoLauf, 'lauf-schon-aktuell', 'Schon aktuell', 'gebaeude', [
    'wiki_settlement' => ['title' => 'Lauf-Artikel-1'],
    'innerorts' => ['ort' => 'lauf-stadt'],
    'field_origins' => ['innerorts' => 'wiki'],
]);

// -- Trockenlauf: zaehlt, schreibt aber NICHTS.
$vorherJsonLauf1 = avesmapsInnerortsTestZeile($pdoLauf, 'lauf-1')['properties_json'];
$audVorTrocken = (int) $pdoLauf->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();
$trockenlauf = avesmapsInnerortsAusWikiLauf($pdoLauf, false, 10, AVESMAPS_INNERORTS_TEST_USER);
assert($trockenlauf['ok'] === true && $trockenlauf['apply'] === false, json_encode($trockenlauf));
assert($trockenlauf['count'] === 2, 'genau zwei echte Kandidaten (lauf-1, lauf-2): ' . json_encode($trockenlauf));
assert($trockenlauf['written'] === 0, 'ein Trockenlauf schreibt nichts');
assert(count($trockenlauf['sample']) === 2, 'die Stichprobe zeigt beide (unter dem Deckel von 5)');
$namenInStichprobe = array_column($trockenlauf['sample'], 'name');
assert(in_array('Kandidat Eins', $namenInStichprobe, true) && in_array('Kandidat Zwei', $namenInStichprobe, true),
    json_encode($trockenlauf['sample']));
foreach ($trockenlauf['sample'] as $probeEintrag) {
    assert($probeEintrag['stadt'] === 'Gareth', 'Stichprobe nennt Name -> Stadt: ' . json_encode($probeEintrag));
}
$nachherJsonLauf1 = avesmapsInnerortsTestZeile($pdoLauf, 'lauf-1')['properties_json'];
assert($vorherJsonLauf1 === $nachherJsonLauf1, 'der Trockenlauf ruehrt die Properties nicht an');
$audNachTrocken = (int) $pdoLauf->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();
assert($audNachTrocken === $audVorTrocken, 'der Trockenlauf schreibt keinen Protokolleintrag');
$pruefungen += 8;

// -- Scharf, gedeckelt auf 1: schreibt genau EINEN der zwei Kandidaten.
$scharf = avesmapsInnerortsAusWikiLauf($pdoLauf, true, 1, AVESMAPS_INNERORTS_TEST_USER);
assert($scharf['apply'] === true && $scharf['count'] === 2 && $scharf['written'] === 1,
    'gedeckelt auf 1: count bleibt 2 (das ist die volle Zahl), written ist 1: ' . json_encode($scharf));
$pruefungen++;
$lauf1Danach = json_decode((string) avesmapsInnerortsTestZeile($pdoLauf, 'lauf-1')['properties_json'], true);
$lauf2Danach = json_decode((string) avesmapsInnerortsTestZeile($pdoLauf, 'lauf-2')['properties_json'], true);
$geschriebenAnzahl = (int) (avesmapsInnerortsOrtVon($lauf1Danach) === 'lauf-stadt')
    + (int) (avesmapsInnerortsOrtVon($lauf2Danach) === 'lauf-stadt');
assert($geschriebenAnzahl === 1, 'genau einer der beiden Kandidaten wurde tatsaechlich geschrieben');
$pruefungen++;

// -- manuell zugeordneter Punkt bleibt in JEDEM Lauf unberuehrt.
$manualVorLauf = avesmapsInnerortsTestZeile($pdoLauf, 'lauf-manual')['properties_json'];
avesmapsInnerortsAusWikiLauf($pdoLauf, true, 10, AVESMAPS_INNERORTS_TEST_USER);
$manualNachLauf = avesmapsInnerortsTestZeile($pdoLauf, 'lauf-manual')['properties_json'];
assert($manualVorLauf === $manualNachLauf, 'die manuelle Zuordnung bleibt byte-gleich');
$pruefungen++;

// -- Nach einem zweiten scharfen Lauf ohne Deckelbeschraenkung: der verbleibende Kandidat greift,
// „lauf-schon-aktuell" bleibt unberuehrt, der Bestand ist danach leer.
avesmapsInnerortsAusWikiLauf($pdoLauf, true, 10, AVESMAPS_INNERORTS_TEST_USER);
$abschluss = avesmapsInnerortsAusWikiLauf($pdoLauf, false, 10, AVESMAPS_INNERORTS_TEST_USER);
assert($abschluss['count'] === 0, 'nach zwei Laeufen gibt es keine echten Kandidaten mehr: ' . json_encode($abschluss));
$pruefungen++;

// ============================================================================================
// 13) M2 (Controller-Fix): der Admin-Lauf laedt Scope-Index UND Siedlungsliste GENAU EINMAL --
// nicht je Kandidat (N+1). Belegt per Zaehler in einer PDO-Unterklasse: die beiden teuren
// Abfragen (`avesmapsPlaceScopeLoadIndex`s Siedlungs-Abfrage mit `?`-Platzhaltern,
// `avesmapsInnerortsSiedlungsListeLaden`s eigene Abfrage mit `:subN`-Platzhaltern) muessen bei
// VIER echten Kandidaten trotzdem genau je einmal laufen.
// ============================================================================================
final class AvesmapsInnerortsZaehlPdo extends AvesmapsInnerortsTestPdo
{
    public int $scopeIndexAbfragen = 0;
    public int $siedlungsListeAbfragen = 0;

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        // avesmapsPlaceScopeLoadIndex() ohne vorgeladene Zeilen (Admin-Lauf uebergibt keine):
        // positionelle Platzhalter, nur die Spalte `name`.
        if (str_contains($query, "feature_type = ? AND is_active = 1 AND feature_subtype IN")) {
            $this->scopeIndexAbfragen++;
        }
        // avesmapsInnerortsSiedlungsListeLaden(): benannte Platzhalter, public_id UND name.
        if (str_contains($query, 'SELECT public_id, name FROM map_features WHERE feature_type')) {
            $this->siedlungsListeAbfragen++;
        }

        return parent::prepare($query, $options);
    }
}

function avesmapsInnerortsZaehlPdo(): AvesmapsInnerortsZaehlPdo
{
    $pdo = new AvesmapsInnerortsZaehlPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE map_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT, feature_subtype TEXT,
        name TEXT, geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
        min_x REAL, min_y REAL, max_x REAL, max_y REAL,
        is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 1,
        updated_by INTEGER NULL
    )');
    $pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
    $pdo->exec('CREATE TABLE map_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
        actor_user_id INTEGER, before_json TEXT, after_json TEXT,
        undone_at TEXT NULL, undone_by INTEGER NULL, undo_audit_id INTEGER NULL
    )');
    $pdo->exec('CREATE TABLE map_feature_locks (public_id TEXT PRIMARY KEY, user_id INTEGER, username TEXT, locked_until TEXT)');
    $pdo->exec('CREATE TABLE wiki_sync_pages (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, standort TEXT)');
    $pdo->exec('CREATE TABLE political_territory (name TEXT)');

    return $pdo;
}

$pdoN1 = avesmapsInnerortsZaehlPdo();
avesmapsInnerortsTestPunktEinfuegen($pdoN1, 'n1-stadt', 'Gareth', 'metropole');
for ($i = 1; $i <= 4; $i++) {
    $pdoN1->exec("INSERT INTO wiki_sync_pages (title, standort) VALUES ('N1-Artikel-{$i}', '[[Gareth]]')");
    avesmapsInnerortsTestPunktEinfuegen($pdoN1, "n1-{$i}", "Kandidat {$i}", 'gebaeude',
        ['wiki_settlement' => ['title' => "N1-Artikel-{$i}"]]);
}

$ergN1 = avesmapsInnerortsAusWikiLauf($pdoN1, false, 10, AVESMAPS_INNERORTS_TEST_USER);
assert($ergN1['count'] === 4, 'vier echte Kandidaten fuer die N+1-Probe: ' . json_encode($ergN1));
$pruefungen++;
assert(
    $pdoN1->scopeIndexAbfragen === 1,
    "der Scope-Index wird GENAU EINMAL geladen, nicht je Kandidat: {$pdoN1->scopeIndexAbfragen} von 4 Kandidaten"
);
$pruefungen++;
assert(
    $pdoN1->siedlungsListeAbfragen === 1,
    "die Siedlungsliste wird GENAU EINMAL geladen, nicht je Kandidat: {$pdoN1->siedlungsListeAbfragen} von 4 Kandidaten"
);
$pruefungen++;

echo "OK: {$pruefungen} Pruefungen\n";
