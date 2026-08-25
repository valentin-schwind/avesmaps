<?php

declare(strict_types=1);

/**
 * „Zuletzt gesynct" gehoert dem LAUF, nicht der Uebernahme.
 * ===========================================================================
 * Owner 25.08.2026, woertlich: „gesynct is gesynct, egal ob was uebernommen wurde."
 *
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/wiki/__tests__/sync-lauf-stempel-test.php
 *
 * 💣 DIE REGRESSION, DIE DIESER TEST VERHINDERT. Bis zum 06.08.2026 (`45e9dca7`) stempelte der
 * Karten-Abgleich `citymaps_last_synced` am Ende seines eigenen Laufs, mit genau dieser Begruendung
 * darueber: „this records 'the owner ran a full sync', which is true the moment the catalog is
 * drained, WHETHER OR NOT ANYTHING CHANGED." Der Schnitt in Rechen- und Ausfuehrhaelfte nahm den
 * Stempel mit in die Ausfuehrhaelfte -- und die laeuft bei null Unterschieden NIE, weil das
 * Vorschau-Blatt dort absichtlich keinen „Uebernehmen"-Knopf zeigt
 * (`syncPlanFooterState`, `applyVisible: !nothingToDo`). Ergebnis live gemessen am 25.08.2026:
 * die Leiste stand acht Tage auf dem 17.08., waehrend der Abgleich taeglich lief und „0 Unterschiede"
 * meldete. Der Satz ist beim Umzug nicht mitgereist; die Zusicherung fiel lautlos weg.
 *
 * ⚠️ Die Begruendung stand sogar ZWEIMAL im Code und war an beiden Stellen still falsch geworden:
 * `avesmapsGameLiteratureLastSynced` behauptet bis heute „the reconcile stamps a run timestamp on
 * `$done` (whether or not anything changed)", und `avesmapsWikiDumpSyncKindLastSynced` beschreibt
 * `citymap` als „when 'Karten syncen' last completed". Ein Kommentar ist kein Riegel -- dieser Test
 * ist einer.
 *
 * 🔴 UND DER STEMPEL GEHOERT AN DEN ENDPUNKT, NICHT IN DIE RECHENFUNKTION. `sync-plan-purity-test.php`
 * laeuft den Aufrufbaum ab `avesmapsCitymapPlanStep` ab und beweist, dass die Rechenhaelfte in keine
 * Nutztabelle schreibt. `app_setting` steht nicht auf deren Verbotsliste, der Stempel waere dort also
 * durchgerutscht -- aber „der Test haette es erlaubt" ist kein Grund. Die Rechenhaelfte bleibt rein,
 * der Lauf-Stempel sitzt in `dump.php` neben der Freigabe des Laufsperre, wo „der Lauf ist fertig"
 * ohnehin schon entschieden wird. Der letzte Block hier nagelt genau das fest.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../../app/app-setting.php';
require_once __DIR__ . '/../citymap-sync.php';
require_once __DIR__ . '/../game-literature-sync.php';

/**
 * SQLite spricht kein MySQL. Zwei Stellen werden uebersetzt, sonst nichts -- dieselbe Bauart wie
 * api/_internal/app/__tests__/zoom-bands-test.php.
 */
final class AvesmapsSyncStempelTestPdo extends PDO
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

$pdo = new AvesmapsSyncStempelTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
avesmapsAppSettingEnsureTable($pdo);

// ===========================================================================
// 1. Der Stempel schreibt genau den Schluessel, den der Leser liest.
// ===========================================================================
//
// 💣 Getrennt geprueft, weil die zwei Seiten in verschiedenen Dateien stehen und nur ueber eine
// Konstante zusammenhaengen. Ein Stempel auf einem anderen Schluessel ist von „gar nicht gestempelt"
// nicht zu unterscheiden -- die Leiste zeigt in beiden Faellen den alten Stand.

assert(avesmapsCitymapLastSynced($pdo) === null, 'Karten: vor dem ersten Lauf gibt es keinen Stempel');

avesmapsCitymapStampLastSynced($pdo);
$kartenStempel = avesmapsCitymapLastSynced($pdo);
assert(is_string($kartenStempel) && $kartenStempel !== '', 'Karten: der Lauf-Stempel ist zurueckzulesen');
assert(
    preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $kartenStempel) === 1,
    'Karten: der Stempel hat die Form, die der Leser der Leiste parst (got ' . $kartenStempel . ')'
);

// 🔴 Der Leser der Leiste liest DENSELBEN Schluessel. Ohne diese Zusicherung koennte der Stempel
// in einer eigenen Zeile landen und alles waere gruen, ausser der Anzeige.
assert(
    trim(avesmapsAppSettingGet($pdo, AVESMAPS_CITYMAP_LAST_SYNCED_SETTING, '')) === $kartenStempel,
    'Karten: Stempel und Leser teilen den app_setting-Schluessel'
);

// Literatur, dieselbe Zusicherung. ⚠️ Ihr Leser faellt bei leerem Schluessel auf MAX(synced_at) der
// Tabelle `adventure` zurueck; die gibt es hier nicht, also ist der Rueckfall ein sauberes null.
assert(avesmapsGameLiteratureLastSynced($pdo) === null, 'Literatur: vor dem ersten Lauf gibt es keinen Stempel');

avesmapsGameLiteratureStampLastSynced($pdo);
$literaturStempel = avesmapsGameLiteratureLastSynced($pdo);
assert(is_string($literaturStempel) && $literaturStempel !== '', 'Literatur: der Lauf-Stempel ist zurueckzulesen');
assert(
    trim(avesmapsAppSettingGet($pdo, AVESMAPS_GAME_LITERATURE_LAST_SYNCED_SETTING, '')) === $literaturStempel,
    'Literatur: Stempel und Leser teilen den app_setting-Schluessel'
);

// Und die zwei Arten teilen den Schluessel NICHT -- sonst zeigte die Leiste zwei Zeilen mit
// derselben Zahl, und ein Karten-Lauf rueckte das Literatur-Datum mit vor.
assert(
    AVESMAPS_CITYMAP_LAST_SYNCED_SETTING !== AVESMAPS_GAME_LITERATURE_LAST_SYNCED_SETTING,
    'Karten und Literatur stempeln in getrennte Zeilen'
);

// ===========================================================================
// 2. Ein zweiter Lauf ueberschreibt -- der Stempel ist der LETZTE Lauf, keine Sammlung.
// ===========================================================================

avesmapsAppSettingSet($pdo, AVESMAPS_CITYMAP_LAST_SYNCED_SETTING, '2020-01-01 00:00:00');
assert(avesmapsCitymapLastSynced($pdo) === '2020-01-01 00:00:00', 'ein alter Stand laesst sich setzen');
avesmapsCitymapStampLastSynced($pdo);
assert(
    avesmapsCitymapLastSynced($pdo) !== '2020-01-01 00:00:00',
    'Karten: ein neuer Lauf ueberschreibt den alten Stempel'
);

// ===========================================================================
// 3. Der Stempel faellt NIE in den Aufrufer durch.
// ===========================================================================
//
// ⚠️ Ein fehlendes Datum ist ein Schoenheitsfehler; ein Abgleich, der daran abbricht, ist keiner.
// Dieselbe Haltung, die die alte Stelle in `citymap-sync.php` schon hatte („A missing timestamp is a
// cosmetic loss; it must never fail the reconcile itself"). Geprueft an einer PDO ohne app_setting.

$ohneTabelle = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$warf = false;
try {
    avesmapsCitymapStampLastSynced($ohneTabelle);
    avesmapsGameLiteratureStampLastSynced($ohneTabelle);
} catch (Throwable) {
    $warf = true;
}
assert($warf === false, 'ein misslungener Stempel bricht den Abgleich nicht ab');

// ===========================================================================
// 4. Beide Haelften stempeln -- der Lauf UND die Uebernahme.
// ===========================================================================
//
// 🔴 Der Lauf ist die Regel (Owner-Entscheid oben). Die Uebernahme behaelt ihren Stempel trotzdem,
// und das ist kein zweiter Wahrheitsbesitzer, sondern derselbe Vorgang zu einem zweiten Zeitpunkt:
// ein Blatt kann per „Spaeter" tagelang liegen bleiben, und die Uebernahme von morgen ist dann das
// juengste, was an den Karten geschah. Beide schreiben `gmdate('Y-m-d H:i:s')` in dieselbe Zeile,
// koennen also nicht auseinanderlaufen -- sie koennen den Wert nur vorruecken.
//
// Statisch geprueft, weil die Ausfuehrhaelfte ohne echte Tabellen nicht laeuft.

$quelle = static function (string $pfad): string {
    $inhalt = file_get_contents(dirname(__DIR__, 4) . '/' . $pfad);
    assert(is_string($inhalt) && $inhalt !== '', "{$pfad} ist lesbar");

    return $inhalt;
};

foreach ([
    'api/_internal/wiki/citymap-plan-apply.php' => 'avesmapsCitymapStampLastSynced(',
    'api/_internal/wiki/game-literature-plan-apply.php' => 'avesmapsGameLiteratureStampLastSynced(',
] as $pfad => $aufruf) {
    assert(
        str_contains($quelle($pfad), $aufruf),
        "die Uebernahme in {$pfad} stempelt weiter (ueber den geteilten Stempler)"
    );
}

// ===========================================================================
// 5. Der Lauf-Stempel sitzt am ENDPUNKT, und zwar im Fertig-Zweig.
// ===========================================================================
//
// 💣 Nicht in der Rechenfunktion: `sync-plan-purity-test.php` beweist ab `avesmapsCitymapPlanStep`,
// dass die Rechenhaelfte in keine Nutztabelle schreibt. Der Beweis lebt davon, dass niemand dort
// „nur schnell" einen Schreibvorgang unterbringt, auch keinen erlaubten.
//
// ⚠️ Und im FERTIG-Zweig, nicht am Anfang des Schritts: ein Lauf ueber ~530 Karten braucht mehrere
// Anfragen, und ein Stempel je Teilschritt hiesse „gesynct", sobald der erste Schritt lief -- auch
// wenn der Editor die Seite danach zuklappt. Gemessen wird an der Klammer des `if ($cmDone) {`-Blocks.

$dump = $quelle('api/edit/wiki/dump.php');

/** Den Rumpf eines `case '<name>':`-Zweiges bis zum naechsten `case ` herausschneiden. */
$zweig = static function (string $quelltext, string $name): string {
    $von = strpos($quelltext, "case '{$name}':");
    assert($von !== false, "der Zweig {$name} steht in dump.php");
    $bis = strpos($quelltext, "\n        case '", $von + 1);

    return substr($quelltext, $von, $bis === false ? null : $bis - $von);
};

/**
 * Den Block ab `<kopf>` bis zu seiner schliessenden Klammer herausschneiden.
 *
 * ⚠️ Roh gezaehlt, also nur fuer Koepfe brauchbar, deren Rumpf keine Klammer in einem Kommentar oder
 * String traegt -- hier sind es zwei Handvoll Zeilen, die alle im Blick sind. Wo das nicht mehr gilt,
 * nimmt das Haus `token_get_all` (sync-plan-purity-test.php sagt, warum).
 */
$block = static function (string $quelltext, string $kopf): string {
    $von = strpos($quelltext, $kopf);
    assert($von !== false, "`{$kopf}` steht da");
    $tiefe = 0;
    $laenge = strlen($quelltext);
    for ($i = $von; $i < $laenge; $i++) {
        if ($quelltext[$i] === '{') {
            $tiefe++;
        } elseif ($quelltext[$i] === '}') {
            $tiefe--;
            if ($tiefe === 0) {
                return substr($quelltext, $von, $i - $von + 1);
            }
        }
    }
    assert(false, "`{$kopf}` schliesst");

    return '';
};

foreach ([
    ['sync_citymaps', '$cmDone', 'avesmapsCitymapStampLastSynced(', 'avesmapsCitymapPlanStep', 'api/_internal/wiki/citymap-sync.php'],
    ['sync_adventures', '$advDone', 'avesmapsGameLiteratureStampLastSynced(', 'avesmapsGameLiteraturePlanStep', 'api/_internal/wiki/game-literature-sync.php'],
] as [$aktion, $bedingung, $aufruf, $rechner, $rechnerDatei]) {
    $rumpf = $zweig($dump, $aktion);
    assert(str_contains($rumpf, $aufruf), "{$aktion} stempelt den Lauf");
    assert(
        str_contains($block($rumpf, "if ({$bedingung}) {"), $aufruf),
        "{$aktion} stempelt erst, wenn der Lauf FERTIG ist -- nicht bei jedem Teilschritt"
    );
    // 💣 Die Gegenprobe, und sie misst den RUMPF der Rechenfunktion, nicht „alles danach": der
    // Stempler selbst steht in derselben Datei, und `function avesmapsCitymapStampLastSynced(`
    // enthaelt den gesuchten Text -- eine Suche ab der Fundstelle bis Dateiende waere immer rot.
    assert(
        !str_contains($block($quelle($rechnerDatei), "function {$rechner}("), $aufruf),
        "{$rechner} bleibt rein -- der Lauf-Stempel gehoert dem Endpunkt (sync-plan-purity-test.php)"
    );
}

fwrite(STDOUT, "OK sync-lauf-stempel-test\n");
