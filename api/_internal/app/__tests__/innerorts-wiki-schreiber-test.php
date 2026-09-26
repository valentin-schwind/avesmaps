<?php

declare(strict_types=1);

/**
 * WAECHTER: jeder Schreiber von `properties.wiki_settlement` zieht „Innerorts" nach.
 * ===========================================================================
 * Spec §5, Schreiber 2 (docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md): wird einem
 * Stadtviertel/Bauwerk ein Wiki-Artikel zugewiesen (oder die Zuweisung geloest), muss der Wiki-Stand
 * von „Innerorts" nachgezogen werden -- sonst zeigt das Feld die Stadt eines Artikels, den der Punkt
 * gar nicht mehr traegt, und „gespeichert ist, was gilt" waere gelogen.
 *
 * 💣 DIE FALLE IST DER NAECHSTE SCHREIBER. Eine Regel, die zwei von drei Erzeugern bindet, ist keine
 * Regel (AGENTS.md §11, Verkehrsmittel-Sperre). Dieser Test ZAEHLT die Schreiber repoweit per
 * Tokenizer und verlangt je Schreiber den Aufruf -- ein neuer Schreiber ohne Aufruf, oder einer, der
 * weder hier als Schreiber noch als begruendete Ausnahme steht, macht ihn rot.
 *
 * ⚠️ Bewusst KEINE Zahl im Kommentar: die Listen unten SIND die Aufzaehlung.
 *
 * Ein „Schreiber" ist ein Token-Muster `[ 'wiki_settlement' ] ( [..] )* =` bzw. `??=`, oder
 * `'wiki_settlement'` in den Klammern eines `unset(...)`. Ein dynamischer Schluessel
 * (`$props[$nest] = …`) ist damit nicht zu sehen -- deshalb die Stichprobe in Abschnitt C, die den
 * bekannten dynamischen Leser (publication-sync.php) als Leser nachweist.
 *
 * Lauf (aus der Wurzel des Repos):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/innerorts-wiki-schreiber-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$wurzel = realpath(__DIR__ . '/../../../..');
assert(is_string($wurzel) && is_dir($wurzel . '/api'), 'die Repo-Wurzel ist gefunden');
$wurzel = str_replace('\\', '/', $wurzel);
$pruefungen = 0;

/**
 * Die Schreibstellen einer Quelle: Liste von [Funktionsname, Zeile, Art].
 *
 * @return list<array{0:string, 1:int, 2:string}>
 */
function innerortsSchreiberFinden(string $quelle): array
{
    $tokens = array_values(array_filter(
        token_get_all($quelle),
        static fn($t): bool => !is_array($t) || !in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)
    ));
    $anzahl = count($tokens);
    $text = static fn($t): string => is_array($t) ? $t[1] : $t;
    $zeile = static function (int $i) use ($tokens): int {
        for ($j = $i; $j >= 0; $j--) {
            if (is_array($tokens[$j])) {
                return (int) $tokens[$j][2];
            }
        }

        return 0;
    };
    $istSchluessel = static fn($t): bool => is_array($t) && $t[0] === T_CONSTANT_ENCAPSED_STRING
        && trim($t[1], '\'"') === 'wiki_settlement';

    // Funktionsgrenzen: Name ab `function NAME`, Tiefe ueber geschweifte Klammern.
    $funktionAn = [];
    $aktuell = '';
    $tiefe = 0;
    $startTiefe = -1;
    $wartetAufRumpf = false;
    for ($i = 0; $i < $anzahl; $i++) {
        $t = $tokens[$i];
        if (is_array($t) && $t[0] === T_FUNCTION && isset($tokens[$i + 1]) && is_array($tokens[$i + 1]) && $tokens[$i + 1][0] === T_STRING) {
            $aktuell = $tokens[$i + 1][1];
            $wartetAufRumpf = true;
        }
        $zeichen = $text($t);
        if ($zeichen === '{' || (is_array($t) && in_array($t[0], [T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true))) {
            if ($wartetAufRumpf) {
                $startTiefe = $tiefe;
                $wartetAufRumpf = false;
            }
            $tiefe++;
        } elseif ($zeichen === '}') {
            $tiefe--;
            if ($tiefe === $startTiefe) {
                $funktionAn[$i] = $aktuell;
                $aktuell = '';
                $startTiefe = -1;
            }
        }
        $funktionAn[$i] = $aktuell !== '' ? $aktuell : ($funktionAn[$i] ?? '');
    }

    $funde = [];
    for ($i = 0; $i < $anzahl; $i++) {
        // unset( … ['wiki_settlement'] … )
        if (is_array($tokens[$i]) && $tokens[$i][0] === T_UNSET) {
            $offen = 0;
            for ($j = $i + 1; $j < $anzahl; $j++) {
                $z = $text($tokens[$j]);
                if ($z === '(') {
                    $offen++;
                } elseif ($z === ')') {
                    $offen--;
                    if ($offen === 0) {
                        break;
                    }
                } elseif ($istSchluessel($tokens[$j]) && $text($tokens[$j - 1]) === '[') {
                    $funde[] = [$funktionAn[$i] ?? '', $zeile($i), 'unset'];
                    break;
                }
            }
            continue;
        }
        // [ 'wiki_settlement' ] ( [ … ] )* =
        if ($text($tokens[$i]) === '[' && isset($tokens[$i + 2]) && $istSchluessel($tokens[$i + 1]) && $text($tokens[$i + 2]) === ']') {
            $j = $i + 3;
            while (isset($tokens[$j]) && $text($tokens[$j]) === '[') {
                $offen = 0;
                for (; $j < $anzahl; $j++) {
                    $z = $text($tokens[$j]);
                    if ($z === '[') {
                        $offen++;
                    } elseif ($z === ']') {
                        $offen--;
                        if ($offen === 0) {
                            $j++;
                            break;
                        }
                    }
                }
            }
            $danach = $tokens[$j] ?? null;
            if ($danach !== null && ($text($danach) === '=' || (is_array($danach) && $danach[0] === T_COALESCE_EQUAL))) {
                $funde[] = [$funktionAn[$i] ?? '', $zeile($i), $j > $i + 3 ? 'feld' : 'nest'];
            }
        }
    }

    return $funde;
}

// ---- A. Der Detektor erkennt, was er erkennen soll -- und nur das ------------------------------
$probe = <<<'PHP'
<?php
function schreibtNest(array $p): array { $p['wiki_settlement'] = ['title' => 'x']; return $p; }
function loeschtNest(array $p): array { unset($p['description'], $p['wiki_settlement']); return $p; }
function schreibtFeld(array $p): array { $p['wiki_settlement']['wappen_url'] = ''; return $p; }
function liestNur(array $p): string { $x = $p['wiki_settlement'] ?? null; return (string) ($p['wiki_settlement']['title'] ?? ''); }
function vergleichtNur(array $p): bool { return $p['wiki_settlement'] == null; }
function schluesselImArray(): array { return ['wiki_settlement' => 1]; }
PHP;
$probeFunde = [];
foreach (innerortsSchreiberFinden($probe) as [$fn, , $art]) {
    $probeFunde[] = $fn . ':' . $art;
}
sort($probeFunde);
assert($probeFunde === ['loeschtNest:unset', 'schreibtFeld:feld', 'schreibtNest:nest'],
    'der Detektor findet genau die drei Schreibformen: ' . json_encode($probeFunde));
$pruefungen++;

// ---- B. Repoweit zaehlen -----------------------------------------------------------------------
$dateien = [];
foreach (['api', 'tools'] as $ordner) {
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($wurzel . '/' . $ordner, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $datei) {
        $pfad = str_replace('\\', '/', (string) $datei);
        if (!str_ends_with($pfad, '.php') || str_contains($pfad, '/__tests__/') || preg_match('~/test-[^/]*\.php$~', $pfad) === 1) {
            continue;
        }
        $dateien[] = $pfad;
    }
}
assert(count($dateien) > 100, 'der Scan sieht das Repo (' . count($dateien) . ' Dateien)');
$pruefungen++;

$schreiber = [];
foreach ($dateien as $pfad) {
    $relativ = substr($pfad, strlen($wurzel) + 1);
    foreach (innerortsSchreiberFinden((string) file_get_contents($pfad)) as [$fn, $zeileNr, $art]) {
        $schreiber[$relativ . '::' . $fn][] = $art . '@' . $zeileNr;
    }
}

// Die Schreiber, die eine ZUWEISUNG in die Datenbank schreiben -- sie muessen nachziehen.
$mussNachziehen = [
    'api/_internal/wiki/settlements.php::avesmapsWikiSettlementAssignTo',
    'api/_internal/wiki/settlements.php::avesmapsWikiSettlementClearAssign',
    'api/_internal/wiki/settlements.php::avesmapsWikiSettlementBulkConnect',
];
// Die begruendeten Ausnahmen: sie veraendern eine AUSGABE oder eine lokale Kopie, nie die Zeile.
$ausnahmen = [
    // Baut das GeoJSON der Kartennutzlast (Wappen-Riegel, Bauwerksarten) -- geschrieben wird nichts.
    'api/app/map-features.php::avesmapsMapFeatureRowToGeoJsonFeature' => 'Ausgabe der Kartennutzlast',
    // Der dritte Wappenzustand in der Ausgabe (coat_none) -- dieselbe Nutzlast.
    'api/app/map-features.php::avesmapsNormalizeLegacyMapFeatureProperties' => 'Ausgabe der Kartennutzlast',
    // Die Detailansicht des Ortseditors bindet die Wappen-Adresse in der ANTWORT.
    'api/_internal/wiki/settlements.php::avesmapsWikiSettlementDetail' => 'Ausgabe des Ortseditors',
    // Streicht das Nest aus einer Kopie fuer die Fall-Logik (stats_json-Groesse), liest die Zeile nur.
    'api/_internal/wiki/locations.php::avesmapsWikiSyncReadMapPlaces' => 'lokale Kopie, Lesepfad',
];

$gefunden = array_keys($schreiber);
sort($gefunden);
$erwartet = array_merge($mussNachziehen, array_keys($ausnahmen));
sort($erwartet);
assert($gefunden === $erwartet,
    "die Schreiber von `wiki_settlement` sind genau die bekannten -- ein neuer muss nachziehen oder begruendet\n"
    . 'gefunden: ' . json_encode($schreiber, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n"
    . 'erwartet: ' . json_encode($erwartet, JSON_UNESCAPED_SLASHES));
$pruefungen++;

// ---- C. Je Schreiber: der Aufruf steht da, NACH dem Schreiben ------------------------------------
/** Der kommentarfreie Rumpf einer Funktion. */
function innerortsFunktionsRumpf(string $quelle, string $name): string
{
    $ohne = '';
    foreach (token_get_all($quelle) as $t) {
        if (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $ohne .= is_array($t) ? $t[1] : $t;
    }
    $ohne = str_replace("\r\n", "\n", $ohne);
    $start = strpos($ohne, 'function ' . $name . '(');
    assert($start !== false, "Funktion {$name} gefunden");
    $ende = strpos($ohne, "\n}\n", (int) $start);

    return substr($ohne, (int) $start, ($ende === false ? strlen($ohne) : $ende) - (int) $start);
}

foreach ($mussNachziehen as $eintrag) {
    [$datei, $fn] = explode('::', $eintrag);
    $rumpf = innerortsFunktionsRumpf((string) file_get_contents($wurzel . '/' . $datei), $fn);
    $posAufruf = strpos($rumpf, 'avesmapsInnerortsNachZuweisung(');
    assert($posAufruf !== false, "{$fn} zieht Innerorts nach (avesmapsInnerortsNachZuweisung)");
    $pruefungen++;
    // NACH dem eigenen Schreiben: nach dem letzten `->execute(` bzw. dem Sammel-Commit davor.
    $posSchreiben = max(
        (int) strrpos(substr($rumpf, 0, (int) $posAufruf), '->execute('),
        (int) strrpos(substr($rumpf, 0, (int) $posAufruf), 'avesmapsWikiSettlementCommitLocationGroup(')
    );
    assert($posSchreiben > 0, "{$fn}: der Aufruf steht NACH dem Schreiben der Zuweisung");
    $pruefungen++;
    // Und NICHT im dry_run-Zweig: der kehrt vorher zurueck.
    $posDryRun = strpos($rumpf, 'if ($dryRun)');
    assert($posDryRun === false || $posDryRun < $posAufruf, "{$fn}: kein Nachziehen im Trockenlauf");
    $pruefungen++;
}

// Der Helfer selbst ruft wirklich die Bibliothek -- sonst waere jeder Aufruf oben ein Leerlauf.
$helfer = innerortsFunktionsRumpf(
    (string) file_get_contents($wurzel . '/api/_internal/app/innerorts-anschluss.php'),
    'avesmapsInnerortsNachZuweisung'
);
assert(str_contains($helfer, 'avesmapsInnerortsWikiNachziehen($pdo, $publicId, $userId)'),
    'avesmapsInnerortsNachZuweisung ruft avesmapsInnerortsWikiNachziehen');
$pruefungen++;

// Der bekannte DYNAMISCHE Zugriff (`$props[$propKey]`) ist ein Leser -- kein Schreiber, den das
// Token-Muster uebersieht.
$pubSync = innerortsFunktionsRumpf(
    (string) file_get_contents($wurzel . '/api/_internal/wiki/publication-sync.php'),
    'avesmapsPublicationFetchLiveEntityBatch'
);
assert(preg_match('/\$props\[\$propKey\]\s*=[^=]/', $pubSync) !== 1, 'publication-sync schreibt das Nest nie ueber einen dynamischen Schluessel');
$pruefungen++;

echo "innerorts-wiki-schreiber: alle {$pruefungen} Zusicherungen gruen\n";
