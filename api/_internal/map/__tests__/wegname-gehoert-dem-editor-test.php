<?php

declare(strict_types=1);

/**
 * DER WEGNAME GEHOERT DEM EDITOR -- an einer echten (SQLite-)Karte, beide Schreibwege wirklich gefahren.
 *
 * 🔴 DER BEFUND (Owner 15.09.2026, mit Bild des Gruppendialogs „Weg bearbeiten" · „Bärenpfad" · Name grau gesperrt): „der wegname
 * lässt sich nicht ändern. wenn ich umbenenne, soll das beim speichern für alle abschnitte gelten." Auf Rueckfrage gewaehlt:
 * „Editor bestimmt" -- Umbenennen gilt beim Speichern (Abschnitt bzw. alle Abschnitte der Strasse), Zuweisen setzt den Wiki-Namen wie
 * bisher, danach holt ihn nur noch „Sync". Bis dahin erzwang R1 (avesmapsWikiPathEffectiveEditName) an jedem zugewiesenen Abschnitt
 * lautlos den Artikelnamen.
 *
 * Zugesichert:
 *   A  update_path_details: ein zugewiesener Abschnitt behaelt den getippten Namen (Spalte, name, display_name); die Zuweisung bleibt
 *   B  die Herkunft des Namens: `manual`, mit `wiki_uebernommen: ['name']` `wiki`, unveraendert unangetastet
 *   C  update_path_group_details mit `name`: ALLE genannten Abschnitte heissen danach so -- zugewiesene wie unzugewiesene
 *   D  ohne `name` in `fields` bleibt jeder Name, und es entsteht keine Namens-Herkunft (show_label wirkt an Wiki-Wegen)
 *   E  ZUWEISEN (assign_to) setzt weiterhin den Artikelnamen -- auch auf einen umbenannten Abschnitt
 *   F  und danach gilt wieder der getippte Name
 *
 * ⚠️ DER PDO-AUFSATZ UEBERSETZT NUR FUERS TESTEN (FOR UPDATE, NOW(3), ON DUPLICATE KEY, die Ensure-DDL) -- dieselbe Bauform wie
 * wege-gruppe-schreiben-test.php und wege-gruppe-wiki-public-ids-test.php. Die Produktionsform bleibt unangetastet (AGENTS.md §9).
 *
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll \
 *     api/_internal/map/__tests__/wegname-gehoert-dem-editor-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- dieser Test faehrt die Schreibwege wirklich.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../features.php';
require_once __DIR__ . '/../../wiki/sync.php';
require_once __DIR__ . '/../../wiki/locations.php';
require_once __DIR__ . '/../../wiki/paths.php';

final class AvesmapsWegnameEditorTestPdo extends PDO
{
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $query = str_replace('FOR UPDATE', '', $query);
        $query = str_replace('NOW(3)', "datetime('now')", $query);
        // avesmapsApplyTransportSeasonsToWikiSiblings sucht die Geschwister ueber JSON_UNQUOTE(JSON_EXTRACT(...)); SQLites
        // json_extract liefert Text schon ohne Anfuehrungszeichen, das Auspacken entfaellt.
        $query = str_replace('JSON_UNQUOTE(', '(', $query);
        if (stripos($query, 'information_schema') !== false) {
            return parent::prepare('SELECT 1');
        }

        return parent::prepare($query, $options);
    }

    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
    {
        if (stripos($query, 'information_schema') !== false) {
            return parent::query('SELECT 1');
        }

        return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$fetchModeArgs);
    }

    public function exec(string $statement): int|false
    {
        if (stripos($statement, 'CREATE TABLE IF NOT EXISTS') !== false || stripos($statement, 'ALTER TABLE') !== false) {
            return 0;
        }
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

$pdo = new AvesmapsWegnameEditorTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
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
    actor_user_id INTEGER, before_json TEXT, after_json TEXT, created_at TEXT NULL
)');
$pdo->exec('CREATE TABLE map_feature_locks (public_id TEXT PRIMARY KEY, user_id INTEGER, username TEXT, locked_until TEXT)');
$pdo->exec('CREATE TABLE wiki_path_staging (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT, kind TEXT, art TEXT,
    continent TEXT, lage TEXT, lage_raw TEXT, laenge TEXT, verlauf TEXT, description TEXT, synonyms_json TEXT,
    image_url TEXT, image_license_status TEXT, wiki_url TEXT, synced_at TEXT)');
$pdo->exec("INSERT INTO wiki_path_staging (wiki_key, name, kind, art, wiki_url, verlauf)
            VALUES ('baerenpfad', 'Bärenpfad', 'strasse', 'Pfad', 'https://de.wiki-aventurica.de/wiki/B%C3%A4renpfad', '')");

const AVESMAPS_WEGNAME_IDS = [
    'a' => '11111111-1111-4111-8111-111111111111',  // zugewiesen
    'b' => '22222222-2222-4222-8222-222222222222',  // zugewiesen
    'c' => '33333333-3333-4333-8333-333333333333',  // gleicher Name, OHNE Zuweisung
];
$BAERENPFAD = ['wiki_key' => 'baerenpfad', 'name' => 'Bärenpfad', 'kind' => 'strasse', 'art' => 'Pfad',
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/B%C3%A4renpfad', 'source' => 'editor'];
$user = ['id' => 5, 'username' => 'pruefer'];

$einfuegen = $pdo->prepare("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json, min_x, min_y, max_x, max_y)
    VALUES (:public_id, 'Bärenpfad', 'path', 'Pfad', 'LineString', :geometry_json, :properties_json, 0, 0, 1, 1)");
foreach (AVESMAPS_WEGNAME_IDS as $schluessel => $publicId) {
    $nest = ['name' => 'Bärenpfad', 'display_name' => 'Bärenpfad', 'feature_type' => 'path', 'feature_subtype' => 'Pfad',
        'show_label' => false, 'allowed_transports' => ['groupFoot'], 'transport_domain' => 'land'];
    if ($schluessel !== 'c') {
        $nest['wiki_path'] = $BAERENPFAD;
    }
    $einfuegen->execute([
        'public_id' => $publicId,
        'geometry_json' => json_encode(['type' => 'LineString', 'coordinates' => [[10.0, 20.0], [11.0, 21.0]]]),
        'properties_json' => json_encode($nest, JSON_UNESCAPED_UNICODE),
    ]);
}

$zeile = static function (string $publicId) use ($pdo): array {
    $s = $pdo->prepare('SELECT name, properties_json FROM map_features WHERE public_id = :p');
    $s->execute(['p' => $publicId]);
    $z = $s->fetch(PDO::FETCH_ASSOC);
    $z['props'] = json_decode((string) $z['properties_json'], true);

    return $z;
};
$einzeln = static function (string $publicId, string $name, array $extra = []) use ($pdo, $user): array {
    return avesmapsUpdatePathFeatureDetails($pdo, array_merge([
        'public_id' => $publicId,
        'name' => $name,
        'feature_subtype' => 'Pfad',
        'show_label' => true,
        'allowed_transports' => ['groupFoot'],
        'transport_seasons' => [],
        'wiki_uebernommen' => [],
    ], $extra), $user);
};

// ── A) Abschnitt: der getippte Name bleibt ───────────────────────────────────────────────────────────────────────
$antwort = $einzeln(AVESMAPS_WEGNAME_IDS['a'], 'Alter Bärenpfad');
$a = $zeile(AVESMAPS_WEGNAME_IDS['a']);
$pruefe($a['name'] === 'Alter Bärenpfad', 'A1: die Spalte traegt wieder den Artikelnamen -- R1 ist zurueck: ' . $a['name']);
$pruefe(($a['props']['name'] ?? '') === 'Alter Bärenpfad' && ($a['props']['display_name'] ?? '') === 'Alter Bärenpfad',
    'A2: name/display_name im Nest folgen nicht dem getippten Namen: ' . json_encode($a['props'], JSON_UNESCAPED_UNICODE));
$pruefe(($a['props']['wiki_path'] ?? null) === $BAERENPFAD, 'A3: die Zuweisung selbst bleibt unberuehrt');
$pruefe(($antwort['properties']['display_name'] ?? $antwort['name'] ?? '') === 'Alter Bärenpfad' || ($antwort['name'] ?? '') === 'Alter Bärenpfad',
    'A4: die Antwort nennt den getippten Namen: ' . json_encode($antwort, JSON_UNESCAPED_UNICODE));
$pruefe(($a['props']['show_label'] ?? null) === true, 'A5: „Wegname anzeigen“ wird an einem Wiki-Weg geschrieben');

// ── B) die Herkunft des Namens ───────────────────────────────────────────────────────────────────────────────────
$pruefe(($a['props']['field_origins']['name'] ?? null) === 'manual', 'B1: ein getippter Name traegt keine Herkunft manual: '
    . json_encode($a['props']['field_origins'] ?? null));
$einzeln(AVESMAPS_WEGNAME_IDS['a'], 'Bärenpfad', ['wiki_uebernommen' => ['name']]);
$pruefe(($zeile(AVESMAPS_WEGNAME_IDS['a'])['props']['field_origins']['name'] ?? null) === 'wiki',
    'B2: den von „Sync“ geholten Namen stempelt der Server nicht als wiki');
$einzeln(AVESMAPS_WEGNAME_IDS['a'], 'Bärenpfad');
$pruefe(($zeile(AVESMAPS_WEGNAME_IDS['a'])['props']['field_origins']['name'] ?? null) === 'wiki',
    'B3: ein unveraenderter Name hat seine Herkunft verloren (unveraendert heisst unangetastet)');

// ── C) die ganze Strasse ─────────────────────────────────────────────────────────────────────────────────────────
$gruppe = avesmapsUpdatePathGroupDetails($pdo, [
    'public_ids' => array_values(AVESMAPS_WEGNAME_IDS),
    'fields' => ['name'],
    'name' => 'Neuer Bärenpfad',
], $user);
$pruefe(($gruppe['written'] ?? 0) === 3, 'C1: nicht alle drei Abschnitte geschrieben: ' . json_encode($gruppe));
foreach (AVESMAPS_WEGNAME_IDS as $schluessel => $publicId) {
    $z = $zeile($publicId);
    $pruefe($z['name'] === 'Neuer Bärenpfad', "C2: Abschnitt {$schluessel} heisst nach dem Sammel-Speichern „{$z['name']}“");
    $pruefe(($z['props']['display_name'] ?? '') === 'Neuer Bärenpfad', "C3: Abschnitt {$schluessel}: display_name folgt nicht");
    $pruefe(($z['props']['field_origins']['name'] ?? null) === 'manual', "C4: Abschnitt {$schluessel}: keine Namens-Herkunft manual");
}
$pruefe(($zeile(AVESMAPS_WEGNAME_IDS['b'])['props']['wiki_path'] ?? null) === $BAERENPFAD, 'C5: die Zuweisung bleibt');
$pruefe(!array_key_exists('wiki_path', $zeile(AVESMAPS_WEGNAME_IDS['c'])['props']), 'C6: der unzugewiesene bekommt keine');

// ── D) ohne `name` bleibt jeder Name ─────────────────────────────────────────────────────────────────────────────
$pdo->exec("UPDATE map_features SET properties_json = json_remove(properties_json, '$.field_origins')");
// Abschnitt a traegt das Haekchen seit A schon; b (zugewiesen) und c (ohne Zuweisung) bekommen es jetzt.
$ohneName = avesmapsUpdatePathGroupDetails($pdo, [
    'public_ids' => array_values(AVESMAPS_WEGNAME_IDS),
    'fields' => ['show_label'],
    'name' => 'Darf nicht ankommen',
    'show_label' => true,
], $user);
$pruefe(($ohneName['written'] ?? 0) === 2, 'D1: das Haekchen wurde nicht genau auf b und c geschrieben: ' . json_encode($ohneName));
foreach (AVESMAPS_WEGNAME_IDS as $schluessel => $publicId) {
    $z = $zeile($publicId);
    $pruefe($z['name'] === 'Neuer Bärenpfad', "D2: Abschnitt {$schluessel}: ein nicht angefasster Name wurde geschrieben");
    $pruefe(($z['props']['show_label'] ?? null) === true, "D3: Abschnitt {$schluessel}: das Haekchen fehlt");
    $pruefe(!isset($z['props']['field_origins']['name']), "D4: Abschnitt {$schluessel}: Namens-Herkunft ohne Namensaenderung");
}

// ── E) ZUWEISEN setzt den Artikelnamen ───────────────────────────────────────────────────────────────────────────
$zuweisen = avesmapsWikiPathAssignTo($pdo, 'baerenpfad', AVESMAPS_WEGNAME_IDS['a'], false, 5, false, [],
    [AVESMAPS_WEGNAME_IDS['a'], AVESMAPS_WEGNAME_IDS['c']]);
$pruefe(($zuweisen['applied'] ?? 0) === 2 && ($zuweisen['type_ok'] ?? false) === true, 'E1: Zuweisen lief nicht: ' . json_encode($zuweisen, JSON_UNESCAPED_UNICODE));
foreach (['a', 'c'] as $schluessel) {
    $z = $zeile(AVESMAPS_WEGNAME_IDS[$schluessel]);
    $pruefe($z['name'] === 'Bärenpfad' && ($z['props']['display_name'] ?? '') === 'Bärenpfad',
        "E2: Zuweisen setzt den Artikelnamen nicht mehr (Abschnitt {$schluessel}: „{$z['name']}“)");
}
$pruefe($zeile(AVESMAPS_WEGNAME_IDS['b'])['name'] === 'Neuer Bärenpfad', 'E3: ein nicht genannter Abschnitt wurde mit umbenannt');

// ── F) und danach gilt wieder der getippte Name ──────────────────────────────────────────────────────────────────
$einzeln(AVESMAPS_WEGNAME_IDS['c'], 'Unterer Bärenpfad');
$pruefe($zeile(AVESMAPS_WEGNAME_IDS['c'])['name'] === 'Unterer Bärenpfad', 'F1: nach dem Zuweisen erzwingt das Speichern den Artikelnamen');
$pruefe(!function_exists('avesmapsWikiPathEffectiveEditName'), 'F2: der R1-Riegel ist zurueck');

fwrite(STDOUT, "wegname-gehoert-dem-editor: {$checks} Zusicherungen erfuellt\n");
