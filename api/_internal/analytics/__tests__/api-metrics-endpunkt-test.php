<?php

declare(strict_types=1);

/**
 * Der Leseendpunkt, am Quelltext geprueft.
 *
 * ⚠️ WARUM AM QUELLTEXT: der Endpunkt beendet sich selbst (avesmapsRequireUserWithCapability
 * EXITet, avesmapsJsonResponse ist `: never`) und braucht eine Sitzung samt Datenbank. Ein
 * Ausfuehren im Test ginge nicht. Geprueft wird deshalb, was ohne Sitzung pruefbar ist -- und das
 * sind genau die Fehler, die das Besucher-Modul zweimal gekostet haben.
 *
 * Entwurf: docs/superpowers/specs/2026-08-25-api-nutzung-design.md §5
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-endpunkt-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

$pfad = __DIR__ . '/../../../app/api-metrics.php';
$roh = file_get_contents($pfad);
assert(is_string($roh) && $roh !== '', 'api/app/api-metrics.php existiert');
$roh = str_replace("\r\n", "\n", $roh);

/**
 * 🪤 KOMMENTARE MUESSEN HERAUS, BEVOR AM CODE GEPRUEFT WIRD -- und das ist beim ersten Lauf
 * dieses Tests sofort aufgefallen: die Zusicherung „kein getMessage()" schlug an einem
 * Doc-Kommentar an, der genau diese Regel ERKLAERT. Ein Quelltexttest, der Kommentare mitliest,
 * bestraft das Aufschreiben der Regel.
 *
 * token_get_all() statt eines Regexes: ein Muster fuer PHP-Kommentare kommt an Zeichenketten mit
 * `//` darin (etwa einer URL) ins Straucheln, der Tokenizer nicht.
 */
$nurCode = static function (string $php): string {
    $stuecke = [];
    foreach (token_get_all($php) as $token) {
        if (is_array($token)) {
            if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $stuecke[] = $token[1];
            continue;
        }
        $stuecke[] = $token;
    }
    return implode('', $stuecke);
};
$quelle = $nurCode($roh);

// 🔴 Der Riegel. Ohne ihn stehen Betriebszahlen offen im Netz.
assert(str_contains($quelle, "avesmapsRequireUserWithCapability('edit')"), 'edit-Riegel vorhanden');

// 💣 Helfer brauchen ihre Argumente. Beim Besucher-Modul war genau das eine wiederkehrende
// Fehlerquelle, und `avesmapsCreatePdo($config)` statt `$config['database']` kostete dem
// Tempowerte-Fenster jede einzelne Ladung -- die Funktion nimmt ein Array, PHP beschwert sich
// nicht, und drinnen ist alles leer.
assert(str_contains($quelle, 'avesmapsApplyCorsPolicy($config)'), 'CORS mit Argument');
assert(preg_match('/avesmapsCreatePdo\(\s*\$config\[.database.\]/', $quelle) === 1, 'PDO mit Teilbaum');

// Der Notausschalter wird beachtet und das Abschalten GEMELDET, nicht verschwiegen -- sonst ist
// „aus" von „kaputt" nicht zu unterscheiden.
assert(str_contains($quelle, 'avesmapsApiMetricsAktiv($config)'), 'Notausschalter beachtet');
assert(str_contains($quelle, "'enabled' => false"), 'abgeschaltet wird gemeldet');

// 💣 Kein getMessage() nach draussen (Informationsabfluss, Meilenstein M1).
assert(!str_contains($quelle, 'getMessage()'), 'keine Ausnahmetexte an den Client');

// 🪤 `letzte_zaehlung` reist mit. Ohne sie ist „der Zaehler schreibt nicht mehr" von „es kamen
// keine Anfragen" nicht zu unterscheiden -- dieselbe Klasse wie die stille app_setting-Kuerzung.
assert(str_contains($quelle, 'letzte_zaehlung'), 'der Zaehlstand reist mit');

// Syntaktisch heil -- eine Endpunktdatei, die nicht laedt, antwortet mit leerem Rumpf.
$ausgabe = [];
$code = 0;
exec('php -l ' . escapeshellarg($pfad) . ' 2>&1', $ausgabe, $code);
assert($code === 0, 'php -l ist zufrieden: ' . implode(' ', $ausgabe));

// 💣 Und jede Konstante auf Dateiebene stuende VOR dem try -- hier gibt es keine, aber der
// repoweite const-vor-benutzung-test.php wacht ohnehin darueber.

echo "OK: api-metrics-endpunkt-test\n";
