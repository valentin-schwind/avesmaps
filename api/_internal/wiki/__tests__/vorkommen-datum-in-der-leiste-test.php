<?php

declare(strict_types=1);

/**
 * Die Leiste zeigt „Vorkommen" sein Datum beim LADEN -- aus derselben Serverkarte wie alle anderen.
 * ===========================================================================
 * Owner 06.09.2026 (mit Bild): „bei vorkommen steht nie dran wann gesynct wurde - nur wenn ich
 * paar mal drauf klickt kommt das datum".
 *
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll \
 *       api/_internal/wiki/__tests__/vorkommen-datum-in-der-leiste-test.php
 *
 * 💣 DER FEHLER: `avesmapsWikiDumpSyncKindLastSynced` -- die Karte hinter `dump.php?action=last_synced`,
 * die die Leiste beim Laden EINMAL holt -- kannte jede Art ausser `lore`. Literatur, Karten und
 * Kraftlinien sind ebenso wenig ein Dump-sync_kind und stehen trotzdem darin; Vorkommen fehlte.
 * Sein Datum kam nur mit der Antwort der Vorkommen-LISTE (`loadLoreList("panel")`): erst beim
 * Klick auf das Subjekt, asynchron, mit zwoelf Sekunden Frist -- und jeder weitere Klick verwarf
 * die laufende Antwort ueber das Staleness-Token der Liste. Fuer den Owner las sich das als
 * „nach ein paar Klicks kommt das Datum".
 *
 * ⭐ Zwei Naehte werden hier gehalten, weil beide Haelften fuer sich gruen waren:
 *   - Server↔Client: JEDER `syncKind` aus js/review/review-subjects.js ist ein Schluessel der
 *     Karte. Genau diese Zusicherung fehlte -- sie haette den Fehler am Tag seiner Entstehung
 *     gefunden und findet die naechste Objektart, die ein Datum verspricht und keins bekommt.
 *   - Stempel↔Leser: die Karte liest DENSELBEN app_setting-Schluessel, den die Uebernahme
 *     stempelt und den der oeffentliche Katalog liest (dieselbe Zusicherung wie in
 *     sync-lauf-stempel-test.php fuer Karten und Literatur).
 *
 * ⚠️ Die Karte wird AUSGEFUEHRT, nicht gelesen: ein Regex auf `$result['lore']` saehe nicht, ob der
 * `function_exists`-Riegel davor je wahr wird. Deshalb laedt dieser Test dieselbe Include-Kette
 * wie tools/wikidump/test-dump-sync-kind.php plus lore-sync.php -- so, wie dump.php sie laedt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring fehlt. Neu starten mit: php -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt. Neu starten mit: php -d extension=php_pdo_sqlite.dll " . __FILE__ . "\n");
    exit(2);
}

$repoRoot = dirname(__DIR__, 4);

// Dieselbe Kette wie tools/wikidump/test-dump-sync-kind.php (alle side-effect-frei beim Include),
// dazu app-setting.php + lore-sync.php: die Datei, die den Lore-Leser definiert -- genau wie
// api/edit/wiki/dump.php sie vor dem ersten Aufruf der Karte laedt.
require $repoRoot . '/api/_internal/bootstrap.php';
require_once $repoRoot . '/api/_internal/political/territory.php';
require_once $repoRoot . '/api/_internal/wiki/sync.php';
require_once $repoRoot . '/api/_internal/wiki/sync-constants.php';
require_once $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require_once $repoRoot . '/api/_internal/wiki/paths.php';
require_once $repoRoot . '/api/_internal/wiki/regions.php';
require_once $repoRoot . '/api/_internal/wiki/settlements.php';
require_once $repoRoot . '/api/_internal/wiki/locations.php';
require_once $repoRoot . '/api/_internal/wiki/settlement-conflicts-dryrun.php';
require_once $repoRoot . '/api/_internal/wiki/dump-reader.php';
require_once $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';
require_once $repoRoot . '/api/_internal/wiki/dump-sync-kind.php';
require_once $repoRoot . '/api/_internal/app/app-setting.php';
require_once $repoRoot . '/api/_internal/wiki/lore-sync.php';
// 🪤 Und die drei anderen Leser hinter einem `function_exists`-Riegel -- Kraftlinien, Karten,
// Literatur. Die Naht in Abschnitt 3 ist eine Aussage ueber den Include-Graphen von dump.php;
// laedt die Fixture weniger als er, misst der Test seine eigene Liste statt der Produktion. Genau
// so ist er beim Bau umgefallen: `powerline` fehlte -- in der FIXTURE, nicht auf dem Server.
require_once $repoRoot . '/api/_internal/wiki/powerlines.php';
require_once $repoRoot . '/api/_internal/wiki/citymap-sync.php';
require_once $repoRoot . '/api/_internal/wiki/game-literature-sync.php';

/**
 * SQLite spricht kein MySQL. Zwei Stellen werden uebersetzt, sonst nichts -- dieselbe Bauart wie
 * sync-lauf-stempel-test.php.
 */
final class AvesmapsVorkommenDatumTestPdo extends PDO
{
    public function exec($statement): int|false
    {
        if (str_contains((string) $statement, 'CREATE TABLE IF NOT EXISTS app_setting')) {
            return parent::exec(
                'CREATE TABLE IF NOT EXISTS app_setting (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL,
                    updated_at TEXT
                )'
            );
        }

        return parent::exec($statement);
    }

    public function prepare($query, $options = []): PDOStatement|false
    {
        $query = str_replace(
            'ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
            'ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value',
            (string) $query
        );

        return parent::prepare($query, $options);
    }
}

$pdo = new AvesmapsVorkommenDatumTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
avesmapsAppSettingEnsureTable($pdo);
// Die vier echten sync_kinds lesen ihre Tabellen; leer reicht -- hier geht es um den fuenften
// Schluessel, nicht um deren Werte.
$pdo->exec('CREATE TABLE wiki_sync_runs (id INTEGER PRIMARY KEY, status TEXT, sync_type TEXT, completed_at TEXT)');
$pdo->exec('CREATE TABLE ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' (synced_at TEXT)');
$pdo->exec('CREATE TABLE ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' (synced_at TEXT)');
$pdo->exec('CREATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' (synced_at TEXT)');

// ===========================================================================
// 1. Die Karte kennt `lore` -- und unterscheidet „nie gesynct" von „keine Antwort".
// ===========================================================================
//
// 💣 Ein FEHLENDER Schluessel heisst im Client „dazu kam keine Antwort" (leere Zelle,
// „Zuletzt gesynct: unbekannt"), ein null heisst „nachweislich nie gesynct" („nie"). Genau der
// fehlende Schluessel war der Fehler: die Zelle blieb leer, und nichts sagte, warum.

$karte = avesmapsWikiDumpSyncKindLastSynced($pdo);
assert(is_array($karte), 'die Karte ist ein Array');
assert(
    array_key_exists('lore', $karte),
    'die Serverkarte traegt den Schluessel `lore` -- ohne ihn zeigt die Leiste bei Vorkommen NIE ein Datum beim Laden'
);
assert($karte['lore'] === null, 'vor dem ersten Lauf ist Vorkommen „nie gesynct" (null), nicht „unbekannt"');

// ===========================================================================
// 2. Der Wert ist der Stempel der Uebernahme -- derselbe app_setting-Schluessel.
// ===========================================================================

avesmapsAppSettingSet($pdo, AVESMAPS_LORE_LAST_SYNCED_SETTING, '2026-09-05 12:00:00');
$karte = avesmapsWikiDumpSyncKindLastSynced($pdo);
assert(
    $karte['lore'] === '2026-09-05 12:00:00',
    'die Karte liest den Stempel der Uebernahme zurueck (got ' . var_export($karte['lore'] ?? null, true) . ')'
);

// Die vier echten sync_kinds bleiben unberuehrt -- der neue Schluessel kommt DAZU.
foreach (AVESMAPS_WIKI_DUMP_SYNC_KINDS as $kind) {
    assert(array_key_exists($kind, $karte), "der sync_kind `{$kind}` steht weiterhin in der Karte");
}

// ===========================================================================
// 3. Die NAHT zum Client: jeder syncKind der Registry bekommt eine Antwort.
// ===========================================================================
//
// ⭐ Das ist die Zusicherung, die gefehlt hat. js/review/review-subjects.js erklaert je Subjekt
// einen `syncKind`; die Leiste liest damit in der Serverkarte nach. Ein syncKind ohne Schluessel
// ist eine Zelle, die fuer immer leer bleibt -- und fuer sich sind beide Seiten gruen.

$quelle = static function (string $pfad) use ($repoRoot): string {
    $inhalt = file_get_contents($repoRoot . '/' . $pfad);
    assert(is_string($inhalt) && $inhalt !== '', "{$pfad} ist lesbar");

    return $inhalt;
};

$registry = $quelle('js/review/review-subjects.js');
$registryBlock = null;
assert(
    preg_match('/const WIKI_SYNC_SUBJECTS = \[(.*?)\n\];/s', $registry, $registryBlock) === 1,
    'die Registry WIKI_SYNC_SUBJECTS steht in review-subjects.js'
);
$syncKinds = [];
preg_match_all('/syncKind:\s*"([a-z_]+)"/', (string) $registryBlock[1], $syncKinds);
$syncKinds = array_values(array_unique($syncKinds[1]));
assert(count($syncKinds) >= 8, 'die Registry nennt mindestens acht syncKinds (got ' . count($syncKinds) . ')');
assert(in_array('lore', $syncKinds, true), 'Vorkommen traegt den syncKind `lore` -- ueber ihn liest die Leiste');

foreach ($syncKinds as $syncKind) {
    assert(
        array_key_exists($syncKind, $karte),
        "syncKind `{$syncKind}` aus review-subjects.js hat KEINEN Schluessel in avesmapsWikiDumpSyncKindLastSynced -- "
        . 'die Zelle dieses Subjekts bleibt beim Laden fuer immer leer'
    );
}

// ===========================================================================
// 4. Stempel, Katalog-Leser und Karte teilen den Schluessel.
// ===========================================================================
//
// Der oeffentliche Katalog (api/_internal/app/lore.php) liest den Schluessel als Literal, ohne
// die Wiki-Bibliothek zu laden -- das ist gewollt (der Lesepfad soll nicht die halbe Sync-Kette
// mitziehen). Also muss das Literal der Konstante entsprechen, sonst zeigen Knopf und Leiste
// zwei verschiedene Daten.

assert(
    str_contains($quelle('api/_internal/app/lore.php'), "'" . AVESMAPS_LORE_LAST_SYNCED_SETTING . "'"),
    'der Katalog-Leser liest dasselbe Literal wie AVESMAPS_LORE_LAST_SYNCED_SETTING'
);
assert(
    str_contains($quelle('api/_internal/wiki/lore-plan-apply.php'), 'AVESMAPS_LORE_LAST_SYNCED_SETTING'),
    'die Uebernahme stempelt ueber die Konstante'
);

// ===========================================================================
// 5. Der Riegel ist ein `function_exists` -- also muss dump.php die Datei auch laden.
// ===========================================================================
//
// 💣 Ohne das `require_once` waere der Riegel still falsch: kein Fehler, kein Schluessel, leere
// Zelle -- exakt das Bild, das dieser Test verhindert. Dieselbe Warnung steht am Kopf von
// lore-sync.php („ein Guard ohne require haette den Stempel still verschluckt").

$karteQuelle = $quelle('api/_internal/wiki/dump-sync-kind.php');
assert(
    str_contains($karteQuelle, "function_exists('avesmapsLoreLastSynced')"),
    'die Karte fragt den Lore-Leser hinter demselben Riegel wie Literatur, Karten und Kraftlinien'
);

// Fuer JEDEN Riegel der Karte, nicht nur den neuen: die Datei, die den Leser definiert, muss in
// dump.php stehen. Ein Riegel, dessen Datei niemand laedt, ist ein Schluessel, den es nie gibt.
$rumpf = null;
assert(
    preg_match('/function avesmapsWikiDumpSyncKindLastSynced\(.*?\n\}/s', $karteQuelle, $rumpf) === 1,
    'der Rumpf von avesmapsWikiDumpSyncKindLastSynced laesst sich ausschneiden'
);
$riegel = [];
preg_match_all("/function_exists\\('([A-Za-z0-9_]+)'\\)/", (string) $rumpf[0], $riegel);
$riegel = array_values(array_unique($riegel[1]));
assert(count($riegel) >= 4, 'die Karte traegt mindestens vier Riegel (got ' . count($riegel) . ')');
$dump = $quelle('api/edit/wiki/dump.php');
foreach ($riegel as $leser) {
    $treffer = [];
    foreach (['api/_internal/wiki', 'api/_internal/app'] as $ordner) {
        foreach (glob($repoRoot . '/' . $ordner . '/*.php') ?: [] as $datei) {
            if (str_contains((string) file_get_contents($datei), "function {$leser}(")) {
                $treffer[] = basename($datei);
            }
        }
    }
    assert(count($treffer) === 1, "der Leser {$leser} ist GENAU EINMAL definiert (got " . implode(', ', $treffer) . ')');
    assert(
        str_contains($dump, "/{$treffer[0]}'"),
        "dump.php laedt {$treffer[0]} -- sonst ist {$leser} beim Aufruf der Karte nicht definiert, und sein Schluessel fehlt still"
    );
}

fwrite(STDOUT, "OK vorkommen-datum-in-der-leiste-test\n");
