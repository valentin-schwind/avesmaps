<?php

declare(strict_types=1);

/**
 * 💣 Die RECHEN-Hälften hängen an einem anderen Endpunkt als die Ausführ-Hälften. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll \
 *       -d extension=php_openssl.dll api/_internal/wiki/__tests__/sync-monitor-endpoint-chain-test.php
 *
 * sync-plan-endpoint-chain-test.php bewacht `api/edit/wiki/sync-plan.php` -- den Endpunkt, der eine
 * Vorschau liest, häkelt und übernimmt. Gerechnet wird sie aber woanders: `build_territory_wiki_plan`
 * und `build_territory_plan` liegen an `api/edit/wiki/sync-monitor.php`, und der hat seine EIGENE
 * require-Kette. Sie ist in dieser Sitzung um vier Zeilen gewachsen, darunter eine für eine
 * KONSTANTE -- und eine fehlende Konstante ist ein Fatal, keine Warnung: `AVESMAPS_WIKI_DUMP_STEP_SECONDS`
 * steht in dump-reader.php, nicht in sync-constants.php, und beide Rechen-Schritte lesen sie in ihrer
 * ersten Zeile.
 *
 * ⚠️ EIGENE DATEI, nicht ein Abschnitt im Geschwister-Test, und das ist der Punkt: die zwei Ketten
 * überschneiden sich. In einem Prozess geladen, erfüllte die erste Kette die Prüfungen der zweiten, und
 * ein fehlender require im Monitor-Endpunkt bliebe grün. Ein Test, der sich selbst die Antwort
 * vorlegt, ist schlimmer als keiner.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

$apiRoot = dirname(__DIR__, 3); // …/api/_internal/wiki/__tests__ -> …/api
$endpoint = (string) file_get_contents($apiRoot . '/edit/wiki/sync-monitor.php');
assert($endpoint !== '', 'der Endpunkt ist lesbar');

// Die Kette, wie der Endpunkt sie selbst schreibt -- ABGELESEN, nicht abgeschrieben: eine
// abgeschriebene Liste bleibt grün, wenn im Endpunkt eine Zeile fehlt, und prüft dann nur sich selbst.
// bootstrap.php und auth.php bleiben draußen: sie senden Kopfzeilen und lesen die Konfiguration.
preg_match_all("/^require(?:_once)? __DIR__ \\. '([^']+)';/m", $endpoint, $matches);
$chain = array_values(array_filter(
    $matches[1],
    static fn(string $path): bool => !str_contains($path, 'bootstrap.php') && !str_contains($path, '/auth.php')
));
assert(count($chain) >= 8, 'die Kette wurde gefunden (' . count($chain) . ' Dateien)');
foreach ($chain as $relative) {
    $path = $apiRoot . '/edit/wiki/' . ltrim($relative, '/');
    assert(is_file($path), "die Kette verweist auf eine vorhandene Datei: {$relative}");
    require_once $path;
}

/** Kommentarfreier Quelltext: die Köpfe dieser Dateien NENNEN Funktionen, die sie gerade nicht rufen. */
$stripComments = static function (string $raw): string {
    $source = '';
    foreach (token_get_all($raw) as $token) {
        if (is_array($token)) {
            if ($token[0] === T_COMMENT || $token[0] === T_DOC_COMMENT) {
                continue;
            }
            $source .= $token[1];
            continue;
        }
        $source .= $token;
    }

    return $source;
};

// Die Rechen-Hälften. Wächst mit jeder Sitzung, die eine Vorschau an dieser Kachelreihe anhängt.
$computeFiles = ['territory-wiki-plan.php', 'territory-plan.php'];

$missing = [];
$missingConstants = [];
$checkedCalls = 0;
$checkedConstants = 0;
foreach ($computeFiles as $file) {
    $raw = (string) file_get_contents(dirname(__DIR__) . '/' . $file);
    assert($raw !== '', "{$file} ist lesbar");
    $source = $stripComments($raw);

    preg_match_all('/\bavesmaps[A-Za-z0-9_]+(?=\s*\()/', $source, $calls);
    preg_match_all('/^function\s+(avesmaps[A-Za-z0-9_]+)/m', $source, $defs);
    foreach (array_diff(array_unique($calls[0]), $defs[1]) as $function) {
        $checkedCalls++;
        if (!function_exists($function)) {
            $missing[] = $file . ': ' . $function;
        }
    }

    // 💣 UND DIE KONSTANTEN. Eine fehlende Funktion hinter function_exists() fällt lautlos aus; eine
    // fehlende Konstante ist ein Fatal auf der ERSTEN Zeile des Rechen-Schritts. Genau das war am 06.08.
    // der Fund: AVESMAPS_WIKI_DUMP_STEP_SECONDS wohnt in dump-reader.php, und die lud hier niemand.
    preg_match_all('/\bAVESMAPS_[A-Z0-9_]+\b/', $source, $constants);
    foreach (array_unique($constants[0]) as $constant) {
        $checkedConstants++;
        if (!defined($constant)) {
            $missingConstants[] = $file . ': ' . $constant;
        }
    }
}
assert($checkedCalls > 8, 'der Scan hat Aufrufe gefunden (' . $checkedCalls . ') -- sonst prüft er nichts');
assert($checkedConstants >= 4, 'und Konstanten (' . $checkedConstants . ')');
assert($missing === [], 'Not in the sync-monitor endpoint require chain: ' . implode(', ', $missing));
assert($missingConstants === [], 'Konstante fehlt in der Kette: ' . implode(', ', $missingConstants));

// Die eine, an der es schon einmal hing -- beim Namen genannt, damit ein Umbau die Absicht liest.
assert(defined('AVESMAPS_WIKI_DUMP_STEP_SECONDS'), '💣 das Zeitbudget beider Rechen-Schritte ist geladen');
assert(str_contains($endpoint, 'dump-reader.php'), 'und zwar über dump-reader.php, wo es wohnt');

// Und die zwei Aktionen, die der Endpunkt anbietet, haben ihre Funktion tatsächlich zur Hand.
foreach (['build_territory_wiki_plan' => 'avesmapsTerritoryWikiPlanStep',
    'build_territory_plan' => 'avesmapsTerritoryPlanStep'] as $action => $function) {
    assert(str_contains($endpoint, "'" . $action . "' =>"), "die Aktion {$action} steht im Dispatcher");
    assert(function_exists($function), "und {$function} ist geladen");
}

// Was die Rechen-Hälften nach getaner Arbeit noch anfassen: die Ablösung einer offenen Vorschau steht
// im Endpunkt selbst (nach rebuild_model), nicht in einer der beiden Dateien oben.
assert(function_exists('avesmapsSyncPlanSupersedeRuns'), 'und der Zurückzieher ebenso');

// 💣 DER EINZELPLATZ-RIEGEL. Genau die drei Aktionen, die einen offenen Plan ablösen, nehmen ihn --
// sonst bricht ein zweiter Editor mit einem Druck auf „2 · Hierarchie rechnen" eine laufende Übernahme
// mitten in einer Seite ab: der nächste Teilschritt bekommt 409 plan_not_open, der Lauf bleibt halb
// abgearbeitet stehen, ohne Abschluss, ohne Protokollzeile, ohne Entscheidungen. Erreichbar wurde das
// erst durch die Ablösung selbst.
assert(function_exists('avesmapsWikiDumpLockAcquireOrThrow'), 'der Riegel ist in der Kette');
assert(function_exists('avesmapsWikiDumpLockRelease'), 'und seine Freigabe');
assert(class_exists('WikiDumpLockBusyException'), 'und die Ausnahme, die er wirft');
assert(
    (bool) preg_match(
        "/in_array\(\\\$action, \['rebuild_model', 'build_territory_wiki_plan', 'build_territory_plan'\], true\)\)\s*\{\s*avesmapsWikiDumpLockAcquireOrThrow\(/s",
        $endpoint
    ),
    '💣 alle drei ablösenden Aktionen nehmen den Riegel, in EINER Prüfung'
);
// Und er wird wieder freigegeben -- vor der Antwort (die beendet den Prozess) und im Fehlerfall.
assert(
    (bool) preg_match('/if \(\$lockHeldByThisRequest\) \{\s*avesmapsWikiDumpLockRelease\(\$pdo, \$lockUserId\);/', $endpoint),
    'freigegeben wird auf dem Normalweg'
);
assert(
    (bool) preg_match('/catch \(WikiDumpLockBusyException \$busy\) \{.*?avesmapsErrorResponse\(409, \x27dump_locked\x27/s', $endpoint),
    "💣 ein zweiter Nutzer bekommt 409 dump_locked -- damit der Client-Ablauf stehenbleibt statt zu drehen"
);
assert(
    (bool) preg_match('/catch \(Throwable \$error\) \{.*?avesmapsWikiDumpLockRelease\(\$pdo, \$lockUserId\)/s', $endpoint),
    'und ein Absturz verkeilt die Pipeline nicht bis zur Stale-Übernahme'
);
$acquirePos = strpos($endpoint, 'avesmapsWikiDumpLockAcquireOrThrow(');
$matchPos = strpos($endpoint, '$response = match ($action) {');
assert($acquirePos !== false && $matchPos !== false && $acquirePos < $matchPos,
    '💣 der Riegel steht VOR dem Dispatcher, nicht dahinter');

echo 'sync-monitor-endpoint-chain ok (' . count($chain) . ' Dateien, ' . $checkedCalls . ' Aufrufe, '
    . $checkedConstants . " Konstanten)\n";
