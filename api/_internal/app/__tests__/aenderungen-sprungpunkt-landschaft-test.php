<?php

declare(strict_types=1);

/**
 * 💣 „OBJEKT IST NICHT MEHR AKTIV ODER WURDE NOCH NICHT NEU GELADEN." -- BEI JEDER LANDSCHAFTSZEILE.
 *
 * Der Landschafts-Verlauf schickte gar keinen Sprungpunkt mit, nur die Kennung der Flaeche. Der
 * Browser kann eine Flaechen-Kennung aber nicht nachschlagen -- er kennt Orte, Wege und Labels --
 * und antwortete deshalb mit einer Fehlermeldung ueber ein Objekt, das quicklebendig danebenlag.
 * Am Dump vom 04.09.2026 gezaehlt: von den juengsten 200 Zeilen fuehrten **109** in diese Meldung,
 * die uebrigen **91** trugen ueberhaupt keinen Knopf.
 *
 * 🔴 Gerechnet wird aus der bbox der FLAECHE, nicht aus ihrer Geometrie: `ecosystem_area` fuehrt
 * `min_x..max_y` und jeder Schreibweg zieht sie nach (anders als bei den Herrschaftsgebieten,
 * AGENTS.md §10). Die Geometrie einer Flaeche traegt bis zu 20.000 Positionen -- ueber 200 Zeilen
 * geholt waeren das Megabytes fuer vier Zahlen.
 *
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll \
 *       api/_internal/app/__tests__/aenderungen-sprungpunkt-landschaft-test.php
 * Exit 0 = alle Zusicherungen bestanden.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}

require_once __DIR__ . '/../ecosystem.php';

$checks = 0;

// ---- Eine Fixture, die wie der Livebestand aussieht ------------------------------------------------
// 🔴 Die Tabellen werden HIER angelegt, nicht von `avesmapsEcosystemEnsureTables`: das schreibt
// MySQL-DDL (`ENGINE=InnoDB`), das SQLite ablehnt. Genau deshalb ist der Lesepfad in zwei Teile
// geschnitten -- der Ensure oben, die Abfrage darunter, und die laesst sich wirklich fahren.

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
$pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT, name TEXT, kind TEXT)');
$pdo->exec('CREATE TABLE ecosystem_area (
    id INTEGER PRIMARY KEY, public_id TEXT, region_id INTEGER,
    min_x REAL, min_y REAL, max_x REAL, max_y REAL, is_active INTEGER
)');
$pdo->exec('CREATE TABLE ecosystem_geometry_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, actor_user_id INTEGER,
    area_public_id TEXT, region_public_id TEXT, before_json TEXT, after_json TEXT,
    created_at TEXT, undone_at TEXT, undone_by INTEGER, undo_audit_id INTEGER,
    operation_id TEXT, operation_label TEXT
)');
$pdo->exec("INSERT INTO users (id, username) VALUES (3, 'nics')");
$pdo->exec("INSERT INTO ecosystem_region (id, public_id, name, kind)
    VALUES (4, 'reg-grisvehn', 'Grisvehn', 'vegetation'), (5, 'reg-leer', 'Leere Landschaft', 'vegetation')");
// Zwei Flaechen derselben Region, eine davon weich geloescht.
$pdo->exec("INSERT INTO ecosystem_area (id, public_id, region_id, min_x, min_y, max_x, max_y, is_active) VALUES
    (11, 'area-nord', 4, 100.0, 200.0, 140.0, 260.0, 1),
    (12, 'area-sued', 4, 90.0, 150.0, 120.0, 190.0, 0)");

$schreibe = static function (PDO $pdo, array $zeile): void {
    $statement = $pdo->prepare(
        'INSERT INTO ecosystem_geometry_audit_log
            (action, actor_user_id, area_public_id, region_public_id, before_json, after_json,
             created_at, operation_id, operation_label)
         VALUES (:action, 3, :area, :region, \'[]\', \'[]\', :created_at, :op, :label)'
    );
    $statement->execute([
        'action' => $zeile['action'],
        'area' => $zeile['area'] ?? null,
        'region' => $zeile['region'] ?? null,
        'created_at' => $zeile['created_at'],
        'op' => $zeile['op'] ?? null,
        'label' => $zeile['label'] ?? null,
    ]);
};

$schreibe($pdo, ['action' => 'update_area_geometry', 'area' => 'area-nord', 'region' => 'reg-grisvehn', 'created_at' => '2026-09-05 04:34:00']);
$schreibe($pdo, ['action' => 'update_area_geometry', 'area' => 'area-sued', 'created_at' => '2026-09-05 04:33:00']);
$schreibe($pdo, ['action' => 'update_region', 'region' => 'reg-grisvehn', 'created_at' => '2026-09-05 04:29:00']);
$schreibe($pdo, ['action' => 'create_region', 'region' => 'reg-leer', 'created_at' => '2026-09-05 04:20:00']);

$antwort = avesmapsEcosystemReadChangeLog($pdo, true);
assert(($antwort['ok'] ?? false) === true, 'der Lesepfad antwortet');
assert(count($antwort['changes']) === 4, 'alle vier Zeilen kommen zurueck');
$nach = [];
foreach ($antwort['changes'] as $zeile) {
    $nach[$zeile['created_at']] = $zeile;
}
$checks += 2;

// ---- (1) Die Zusicherung, um die es geht ----------------------------------------------------------

$flaechenZeile = $nach['2026-09-05 04:34:00'];
assert(is_array($flaechenZeile['focus'] ?? null), 'eine Flaechenzeile traegt einen Sprungpunkt');
assert($flaechenZeile['focus']['type'] === 'bounds', 'und zwar ein Rechteck');
// 💣 [lat, lng] -- y zuerst, wie ueberall. Vertauscht fliegt die Karte an den gespiegelten Punkt.
assert($flaechenZeile['focus']['bounds'] === [[200.0, 100.0], [260.0, 140.0]], 'er ist die Huellbox DIESER Flaeche');
$checks += 3;

// ---- (2) Eine weich geloeschte Flaeche behaelt ihre Stelle -----------------------------------------
// 💣 Genau der Fall, der die falsche Meldung „nicht mehr aktiv" ausgeloest hat. Eine Flaeche wird
// weich geloescht (`is_active = 0`) und ihre Zeile bleibt stehen -- also gibt es die Stelle weiter,
// und der Editor will sie gerade dann sehen.
$geloescht = $nach['2026-09-05 04:33:00'];
assert(is_array($geloescht['focus'] ?? null), 'auch eine weich geloeschte Flaeche hat eine Stelle');
assert($geloescht['focus']['bounds'] === [[150.0, 90.0], [190.0, 120.0]], 'und es ist ihre eigene');
$checks += 2;

// ---- (3) Eine Zeile ohne Flaeche nimmt die Huelle IHRER REGION -------------------------------------
// „Region geaendert" (Umbenennen) nennt keine Flaeche. Ohne diesen zweiten Weg truege fast die
// Haelfte aller Zeilen kein Fadenkreuz -- am Dump gemessen 91 von 200.
$regionsZeile = $nach['2026-09-05 04:29:00'];
assert(is_array($regionsZeile['focus'] ?? null), 'eine Regionszeile traegt einen Sprungpunkt');
assert(
    $regionsZeile['focus']['bounds'] === [[150.0, 90.0], [260.0, 140.0]],
    'und er umschliesst ALLE Flaechen der Region, auch die weich geloeschte'
);
$checks += 2;

// ---- (4) Eine Region ohne jede Flaeche hat keine Stelle -- und sagt das ---------------------------
// 🔴 `null` schaltet im Browser das Fadenkreuz ab. Ein erfundener Nullpunkt floege in die Kartenecke,
// und der Editor haette keinen Anhalt, dass es die Stelle gar nicht gibt.
assert($nach['2026-09-05 04:20:00']['focus'] === null, 'eine Region ohne Flaeche hat keinen Sprungpunkt');
$checks += 1;

// ---- (4b) Eine geloeschte REGION behaelt ihre Stelle ----------------------------------------------
// 💣 `delete_region_cascade` ist der Fall, den ein Editor am dringendsten wiederfinden will -- und
// Regionen werden nur WEICH geloescht (`is_active = 0`, es gibt kein DELETE FROM ecosystem_region).
// Wer hier je einen `is_active = 1`-Filter einbaut, nimmt ausgerechnet den Loeschzeilen ihr
// Fadenkreuz, und niemand merkt es, weil alle anderen Zeilen weiter funktionieren.

$pdo->exec('ALTER TABLE ecosystem_region ADD COLUMN is_active INTEGER DEFAULT 1');
$pdo->exec("UPDATE ecosystem_region SET is_active = 0 WHERE public_id = 'reg-grisvehn'");
$pdo->exec('UPDATE ecosystem_area SET is_active = 0 WHERE region_id = 4');
$pdo->exec('DELETE FROM ecosystem_geometry_audit_log');
$schreibe($pdo, ['action' => 'delete_region_cascade', 'region' => 'reg-grisvehn', 'created_at' => '2026-09-05 04:40:00']);
$geloeschteRegion = avesmapsEcosystemReadChangeLog($pdo, true)['changes'][0];
assert(is_array($geloeschteRegion['focus'] ?? null), 'eine geloeschte Region hat weiterhin eine Stelle');
assert(
    $geloeschteRegion['focus']['bounds'] === [[150.0, 90.0], [260.0, 140.0]],
    'und es ist die Huelle ihrer -- ebenfalls geloeschten -- Flaechen'
);
$checks += 2;

// Fuer die folgenden Zusicherungen wieder aktiv, damit sie nicht an diesem Zustand haengen.
$pdo->exec('UPDATE ecosystem_region SET is_active = 1');
$pdo->exec("UPDATE ecosystem_area SET is_active = 1 WHERE public_id = 'area-nord'");

// ---- (5) Eine Geste nimmt die Stelle der Zeile, die eine hat --------------------------------------
// „Zerschneiden" ist create_region + create_area + update_area_geometry unter EINER Klammer. Die
// anfuehrende Zeile kann die sein, die keine Flaeche nennt -- die Gruppe darf ihre Stelle trotzdem
// finden, sonst haengt das Fadenkreuz einer ganzen Geste an der Reihenfolge ihrer Zeilen.
$pdo->exec('DELETE FROM ecosystem_geometry_audit_log');
$schreibe($pdo, ['action' => 'create_region', 'region' => 'reg-leer', 'op' => 'geste-1', 'label' => 'Zerschneiden', 'created_at' => '2026-09-05 05:00:02']);
$schreibe($pdo, ['action' => 'create_area', 'area' => 'area-nord', 'op' => 'geste-1', 'label' => 'Zerschneiden', 'created_at' => '2026-09-05 05:00:01']);

$geste = avesmapsEcosystemReadChangeLog($pdo, true)['changes'];
assert(count($geste) === 1, 'die Geste ist EINE Zeile');
assert($geste[0]['steps'] === 2, 'aus zwei Schritten');
assert(is_array($geste[0]['focus'] ?? null), 'und sie findet ihre Stelle');
assert($geste[0]['focus']['bounds'] === [[200.0, 100.0], [260.0, 140.0]], 'ueber die Zeile, die eine Flaeche nennt');
$checks += 4;

// ---- (6) Die Naht: der oeffentliche Einstieg legt nur noch die Tabellen an -------------------------
// 💣 `avesmapsListEcosystemChanges` ist die Tuer, die alle Aufrufer nehmen. Waere die Abfrage dort
// geblieben, liesse sich keine einzige Zusicherung oben wirklich fahren -- der MySQL-DDL davor
// verhindert es. Der Schnitt ist die Bedingung dafuer, dass dieser Test kein Quelltextleser ist.
$spiegel = new ReflectionFunction('avesmapsListEcosystemChanges');
$rumpf = implode('', array_slice(
    file($spiegel->getFileName()),
    $spiegel->getStartLine(),
    $spiegel->getEndLine() - $spiegel->getStartLine()
));
assert(str_contains($rumpf, 'avesmapsEcosystemEnsureTables'), 'die Tuer legt die Tabellen an');
assert(str_contains($rumpf, 'avesmapsEcosystemReadChangeLog'), 'und reicht an den gefahrenen Lesepfad weiter');
assert(!str_contains($rumpf, 'SELECT'), 'sie fuehrt selbst keine Abfrage mehr');
$checks += 3;

echo "OK -- {$checks} Zusicherungen bestanden.\n";
