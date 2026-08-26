<?php

declare(strict_types=1);

/**
 * Der Import-Endpunkt: am Quelltext geprueft UND ausgefuehrt.
 *
 * ⚠️ WARUM BEIDES: der Endpunkt beendet sich selbst (avesmapsRequireUserWithCapability EXITet,
 * avesmapsJsonResponse ist `: never`) und braucht Sitzung und Datenbank. Ein vollstaendiger
 * Ablauf geht im Test nicht. Geprueft wird deshalb, was ohne Sitzung pruefbar ist -- und das
 * sind genau die Fehler, die in diesem Haus schon zweimal einen Endpunkt tot ausgeliefert haben.
 *
 * Entwurf: docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md §5.1
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/import/__tests__/garetien-endpunkt-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

$pfad = __DIR__ . '/../../../edit/map/garetien-import.php';
$roh = file_get_contents($pfad);
assert(is_string($roh) && $roh !== '', 'api/edit/map/garetien-import.php existiert');
$roh = str_replace("\r\n", "\n", $roh);

/**
 * 🪤 Kommentare muessen heraus, bevor am Code geprueft wird -- sonst schlaegt die Zusicherung
 * „kein getMessage()" an dem Kommentar an, der genau diese Regel erklaert, und der naechste
 * Leser loescht den Kommentar statt des Fehlers.
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

// 🔴 DER RIEGEL, und er steht VOR der Weiche. Eine Importquelle, die jeder befuellen kann, ist
// eine Schreibberechtigung auf die Karte -- der Upload-Weg braucht ihn genauso wie der Abruf.
assert(str_contains($quelle, "avesmapsRequireUserWithCapability('admin')"), 'admin-Riegel vorhanden');
$vorDerWeiche = substr($quelle, 0, strpos($quelle, "\$action ==="));
assert(
    str_contains($vorDerWeiche, "avesmapsRequireUserWithCapability('admin')"),
    'der Riegel steht VOR der ersten Aktionsweiche, nicht in einzelnen Zweigen'
);
assert(substr_count($quelle, 'avesmapsRequireUserWithCapability') === 1, 'genau EIN Riegel, nicht je Zweig einer');

// 💣 Helfer brauchen ihre Argumente. `avesmapsCreatePdo($config)` statt `$config['database']`
// kostete dem Tempowerte-Fenster jede einzelne Ladung -- die Funktion nimmt ein Array, PHP
// beschwert sich nicht, und drinnen ist alles leer.
assert(str_contains($quelle, 'avesmapsApplyCorsPolicy($config)'), 'CORS mit Argument');
assert(preg_match('/avesmapsCreatePdo\(\s*\$config\[.database.\]/', $quelle) === 1, 'PDO mit Teilbaum');

// 💣 Kein getMessage() an den Client (Informationsabfluss, Meilenstein M1).
// ⚠️ Die Ausnahme des Abrufs ist KEINE: die wandert in `fehler[].grund` der eigenen Antwort und
// sagt dem Admin, warum garetien.de nicht erreichbar war -- deshalb wird hier nur der
// Auffang-catch am Dateiende geprueft.
$letzterCatch = substr($quelle, (int) strrpos($quelle, 'catch (Throwable $error)'));
assert(!str_contains($letzterCatch, 'getMessage()'), 'der Auffang-catch gibt keinen Ausnahmetext heraus');

// 🔴 DIE ADRESSE KOMMT AUS DER FESTEN LISTE, NIE AUS DEM ANFRAGERUMPF. Ein Endpunkt, der eine
// beliebige URL entgegennimmt und abruft, ist ein SSRF-Werkzeug -- auch mit Admin-Riegel, denn
// er laeuft aus unserem Netz heraus. Der Aufrufer waehlt aus der Liste, er diktiert sie nicht.
assert(
    preg_match('/avesmapsGaretienHoleSeite\(\s*\$payload/', $quelle) !== 1,
    'die abgerufene Adresse darf nicht aus dem Anfragerumpf stammen'
);
assert(
    preg_match('/avesmapsGaretienProbe\(\s*\$payload/', $quelle) !== 1,
    'auch die Probe ruft keine Adresse aus dem Anfragerumpf ab'
);
assert(substr_count($quelle, 'avesmapsGaretienEndpunktEbene(') >= 3, 'jeder Weg schlaegt die Ebene in der Liste nach');

// 🔴 Null gestagte Zeilen sind ein FEHLER, keine Nachricht. Ein Upload, der nichts ergibt, ist
// fast immer die falsche Datei -- und ein Lauf mit null Zeilen sieht hinterher genauso aus wie
// eine leere Quelle. Genau diese Verwechslung ist im Haus schon als „ok:true mit leerem Inhalt"
// aufgetreten und war vom Betrachter nicht von „hier liegt nichts" zu unterscheiden.
assert(str_contains($quelle, "'no_rows'"), 'ein Upload ohne Datenzeilen wird abgelehnt');

// 🔴 DER ENDPUNKT WIRD AUSGEFUEHRT, NICHT NUR GELESEN -- die wichtigste Zusicherung hier.
//
// 🪤 Live gemessen am 25.08.2026 an einem anderen Endpunkt: HTTP 500 mit LEEREM Rumpf, weil ein
// blankes `require` eine Bibliothek erneut lud, die bootstrap.php schon mit `require_once`
// hatte -- die Einmal-Liste gilt nur fuer require_once selbst. „Cannot redeclare function …",
// ein Fatal Error VOR jeder Ausgabe. 💣 `php -l` findet das NIE: eine Redeklaration ist ein
// Laufzeitfehler, keine Syntaxfrage. Ausfuehren ist der einzige Beweis.
//
// ⚠️ Ohne config.local.php faellt der Endpunkt in seinen eigenen catch und antwortet mit einem
// JSON-Fehler. Das ist genau richtig: geprueft wird nicht, WAS er antwortet, sondern DASS er
// ueberhaupt antwortet.
$ausgabe = [];
$code = 0;
exec('php ' . escapeshellarg($pfad) . ' 2>&1', $ausgabe, $code);
$rumpf = trim(implode("\n", $ausgabe));

assert($rumpf !== '', 'der Endpunkt antwortet ueberhaupt (leerer Rumpf = Fatal Error)');
assert(
    !preg_match('/(Fatal error|Cannot redeclare|Uncaught \w*Error)/i', $rumpf),
    'kein Fatal Error beim Ausfuehren: ' . substr($rumpf, 0, 300)
);
assert(
    str_contains($rumpf, '{') && str_contains($rumpf, '"ok"'),
    'die Antwort ist JSON mit einem ok-Feld: ' . substr($rumpf, 0, 300)
);

// 💣 Und die Ursache selbst festgenagelt: was bootstrap.php laedt, laedt ein Endpunkt NIE selbst.
// Die Importbibliothek gehoert IHM (bootstrap kennt sie nicht), also muss sie hier stehen -- aber
// mit require_once, damit ein spaeterer zweiter Lader nicht zur Redeklaration fuehrt.
assert(
    preg_match('/require_once[^;]*import\/garetien-abruf\.php/', $quelle) === 1,
    'die Importbibliothek wird mit require_once geladen, nicht blank'
);

echo "OK: garetien-endpunkt-test\n";
