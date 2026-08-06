<?php

declare(strict_types=1);

/**
 * 💣 Jede fremde Funktion, die eine Ausführ-Hälfte ruft, ist in der require-Kette von
 * api/edit/wiki/sync-plan.php. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll \
 *       -d extension=php_openssl.dll api/_internal/wiki/__tests__/sync-plan-endpoint-chain-test.php
 *
 * Dieselbe Falle, für die citymap-sync-test.php ihren „Not in the dump endpoint require chain"-Assert
 * hat: der Karten-Sync starb beim ersten echten Lauf mit einem 500, weil eine Funktion aus einer Datei
 * kam, die der Endpunkt nicht lädt -- und jeder Unit-Test war grün, weil ein Unit-Test die Kette eines
 * Endpunkts nie lädt. Der Vorschau-Endpunkt hat seine EIGENE Kette (er ist nicht dump.php), also
 * braucht er seine eigene Probe. Die Übernahme ist der einzige Weg, auf dem diese Dateien laufen, und
 * sie läuft nur mit Anmeldung -- ein fehlender require fällt sonst erst dem Betreiber auf.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

$apiRoot = dirname(__DIR__, 3); // …/api/_internal/wiki/__tests__ -> …/api
$endpoint = (string) file_get_contents($apiRoot . '/edit/wiki/sync-plan.php');
assert($endpoint !== '', 'der Endpunkt ist lesbar');

// Die Kette, wie der Endpunkt sie selbst schreibt -- ABGELESEN, nicht abgeschrieben: eine
// abgeschriebene Liste bleibt grün, wenn im Endpunkt eine Zeile fehlt, und prüft dann nur sich selbst.
// bootstrap.php und auth.php bleiben draußen: sie senden Kopfzeilen und lesen die Konfiguration.
preg_match_all("/^require(?:_once)? __DIR__ \\. '([^']+)';/m", $endpoint, $matches);
$chain = array_values(array_filter(
    $matches[1],
    static fn(string $path): bool => !str_contains($path, 'bootstrap.php') && !str_contains($path, '/auth.php')
));
assert(count($chain) >= 10, 'die Kette wurde gefunden (' . count($chain) . ' Dateien)');
foreach ($chain as $relative) {
    $path = $apiRoot . '/edit/wiki/' . ltrim($relative, '/');
    assert(is_file($path), "die Kette verweist auf eine vorhandene Datei: {$relative}");
    require_once $path;
}

// Die Ausführ-Hälften. Wächst mit jeder Sitzung um eine Datei.
$applyFiles = [
    'citymap-plan-apply.php',
    'adventure-plan-apply.php',
];

// Kommentare werden per TOKENIZER entfernt, nicht per Regex: die Dateien erklären in ihren Köpfen
// ausdrücklich, welche Funktionen sie NICHT rufen dürfen ("avesmapsAdventureSaveCoverLocal holt über
// HTTP …"), und ein Textscan meldete diese Warnung als Aufruf. Ein Test, der die eigene Dokumentation
// anzeigt, ist schlimmer als keiner -- er erzieht zum Wegsehen.
$missing = [];
$checked = 0;
foreach ($applyFiles as $file) {
    $raw = (string) file_get_contents(dirname(__DIR__) . '/' . $file);
    assert($raw !== '', "{$file} ist lesbar");
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
    preg_match_all('/\bavesmaps[A-Za-z0-9_]+(?=\s*\()/', $source, $calls);
    preg_match_all('/^function\s+(avesmaps[A-Za-z0-9_]+)/m', $source, $defs);
    foreach (array_diff(array_unique($calls[0]), $defs[1]) as $function) {
        $checked++;
        if (!function_exists($function)) {
            $missing[] = $file . ': ' . $function;
        }
    }
}
assert($checked > 20, 'der Scan hat etwas gefunden (' . $checked . ' Aufrufe) -- sonst prüft er nichts');
assert($missing === [], 'Not in the sync-plan endpoint require chain: ' . implode(', ', $missing));

// Und die Arten, die der Endpunkt annimmt, haben einen match-Arm: eine Art in der Liste ohne Arm ist
// ein UnhandledMatchError mitten in einer Übernahme, also ein 500 nach dem ersten Häkchen.
// ⚠️ Die Arten werden aus der Quelle GELESEN, nicht über die Konstante: der Endpunkt selbst wird hier
// nicht eingebunden (er sendet Kopfzeilen und beantwortet eine Anfrage), also gibt es die Konstante in
// diesem Prozess nicht.
preg_match('/AVESMAPS_SYNC_PLAN_KINDS = \[([^\]]*)\]/', $endpoint, $kindsMatch);
preg_match_all("/'([a-z_]+)'/", $kindsMatch[1] ?? '', $kindNames);
$kinds = $kindNames[1] ?? [];
assert($kinds !== [], 'die Artenliste des Endpunkts wurde gefunden');
foreach ($kinds as $kind) {
    assert(
        preg_match("/'" . preg_quote($kind, '/') . "' => avesmaps[A-Za-z0-9_]+ApplyStep\(/", $endpoint) === 1,
        "die Art {$kind} hat einen Ausführ-Arm im Endpunkt"
    );
}

echo 'sync-plan-endpoint-chain ok (' . count($chain) . ' Dateien, ' . $checked . " Aufrufe)\n";
