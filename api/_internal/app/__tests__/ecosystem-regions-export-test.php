<?php

declare(strict_types=1);

/**
 * Die oeffentliche Regionsliste der Landschaften -- GET /api/app/ecosystem-regions.php und ihre
 * Bibliothek api/_internal/app/ecosystem-regions-export.php (Auftrag Avesmaps3D, 28.09.2026).
 *
 * Drei Zusagen, die der Auftrag verlangt, und eine, die er nur andeutet:
 *   1. Der Endpunkt liefert DIESELBEN Regionen wie `list_regions` (Abschnitte B, C, E).
 *   2. Er antwortet ohne Sitzung und schreibt nichts (Abschnitte D, F).
 *   3. Die zwei Staende stehen oben und beschreiben die Daten, die darunter stehen (Abschnitte C, D).
 *   4. 💣 Ein Feld, das kuenftig an `list_regions` haengt, geht NICHT still an die Oeffentlichkeit --
 *      Abschnitt B wird rot, bis jemand entschieden hat.
 *
 * 🪤 WARUM `list_regions` HIER NICHT WIRKLICH LAEUFT: `avesmapsListEcosystemRegions` faehrt als erste
 * Anweisung MySQL-DDL (ENGINE, AUTO_INCREMENT), und SQLite bricht dort ab -- dieselbe Grenze, die
 * ecosystem-field-origins-projektion-test.php begruendet. Deshalb ist Zusage 1 hier eine Aussage ueber die
 * BAUWEISE: der Endpunkt ruft genau diese Funktion (E), reicht jede Zeile unveraendert weiter, solange sie
 * nur freigegebene Felder traegt (C), und die freigegebenen Felder SIND die, die sie baut (B).
 * Den echten Vergleich gegen die Live-Datenbank leistet nur ein Abruf beider Wege (`list_regions` mit
 * Editor-Sitzung gegen diesen Endpunkt) -- kein Test hier ersetzt ihn.
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-regions-export-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- "
        . "assert() waere hier wirkungslos und die Probe meldete falsche Erfolge.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4);
require_once $wurzel . '/api/_internal/app/ecosystem-regions-export.php';

$endpunktDatei = $wurzel . '/api/app/ecosystem-regions.php';
$bibliothekDatei = $wurzel . '/api/_internal/app/ecosystem-regions-export.php';

// ---- Helfer ------------------------------------------------------------------------------------

// Quelltext ohne Kommentare. 🪤 Mit dem TOKENIZER, nie mit zwei preg_replace: ein `/*` in einem
// Zeilenkommentar fraesse sonst echten Code bis zum naechsten `*/` (AGENTS.md §11, sync-monitor.php).
function ohneKommentare(string $quelle): string
{
    $aus = '';
    foreach (token_get_all($quelle) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $aus .= is_array($token) ? $token[1] : $token;
    }

    return $aus;
}

function funktionsQuelle(string $name): string
{
    $spiegel = new ReflectionFunction($name);

    return implode('', array_slice(
        file((string) $spiegel->getFileName()),
        $spiegel->getStartLine() - 1,
        $spiegel->getEndLine() - $spiegel->getStartLine() + 1
    ));
}

// Die Schluessel der ERSTEN Ebene eines Array-Literals, das bei $tokens[$start] (einem `[`) beginnt.
// `$row['public_id']` und die Ecken von `bounds` liegen tiefer und zaehlen nicht.
function schluesselDesLiterals(array $tokens, int $start): array
{
    $schluessel = [];
    $tiefe = 0;
    $anzahl = count($tokens);
    for ($i = $start; $i < $anzahl; $i++) {
        $token = $tokens[$i];
        if ($token === '[') {
            $tiefe++;
        } elseif ($token === ']') {
            $tiefe--;
            if ($tiefe === 0) {
                break;
            }
        } elseif ($tiefe === 1 && is_array($token) && $token[0] === T_CONSTANT_ENCAPSED_STRING) {
            for ($j = $i + 1; $j < $anzahl && is_array($tokens[$j]) && in_array($tokens[$j][0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true); $j++) {
            }
            if (is_array($tokens[$j] ?? null) && $tokens[$j][0] === T_DOUBLE_ARROW) {
                $schluessel[] = substr($token[1], 1, -1);
            }
        }
    }

    return $schluessel;
}

// Index des naechsten bedeutungstragenden Tokens ab $i (Leerraum und Kommentare uebersprungen).
function naechstesToken(array $tokens, int $i): int
{
    while (isset($tokens[$i]) && is_array($tokens[$i]) && in_array($tokens[$i][0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
        $i++;
    }

    return $i;
}

// ---- A. Beide Dateien sind syntaktisch heil ----------------------------------------------------
foreach ([$endpunktDatei, $bibliothekDatei] as $pfad) {
    assert(is_file($pfad), "{$pfad} existiert");
    $ausgabe = [];
    $code = 0;
    exec(escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg($pfad) . ' 2>&1', $ausgabe, $code);
    assert($code === 0, "{$pfad} ist syntaktisch heil: " . implode(' ', $ausgabe));
}

// ---- B. 💣 DER WAECHTER: die Positivliste IST die Feldliste von list_regions ---------------------
// Wer an `list_regions` ein Feld haengt, landet hier. Die Frage, die dann zu beantworten ist: darf es
// an die Oeffentlichkeit? Ja -> in AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_REGION_FIELDS eintragen (an derselben
// Stelle wie in list_regions). Nein -> hier in $bewusstNichtOeffentlich eintragen, mit Grund.
// Editor- oder Personendaten gehoeren nie hinein (Auftrag Avesmaps3D, 28.09.2026).
$bewusstNichtOeffentlich = [];

$regionTokens = token_get_all('<?php ' . funktionsQuelle('avesmapsListEcosystemRegions'));
$literalStart = null;
foreach ($regionTokens as $i => $token) {
    if (is_array($token) && $token[0] === T_VARIABLE && $token[1] === '$regions') {
        $a = naechstesToken($regionTokens, $i + 1);
        $b = naechstesToken($regionTokens, $a + 1);
        $c = naechstesToken($regionTokens, $b + 1);
        $d = naechstesToken($regionTokens, $c + 1);
        if (($regionTokens[$a] ?? null) === '[' && ($regionTokens[$b] ?? null) === ']'
            && ($regionTokens[$c] ?? null) === '=' && ($regionTokens[$d] ?? null) === '[') {
            $literalStart = $d;
            break;
        }
    }
}
assert($literalStart !== null, 'list_regions baut seine Zeilen nicht mehr als `$regions[] = [ … ]` -- '
    . 'der Waechter findet die Feldliste nicht und muss nachgezogen werden, nicht stillgelegt');
$listRegionsFelder = array_values(array_diff(schluesselDesLiterals($regionTokens, $literalStart), $bewusstNichtOeffentlich));
// Gegenprobe gegen einen Waechter, der nichts findet: die siebzehn Felder aus dem Auftrag.
assert(count($listRegionsFelder) >= 17, 'der Waechter liest zu wenige Felder: ' . json_encode($listRegionsFelder));

$nurInListRegions = array_values(array_diff($listRegionsFelder, AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_REGION_FIELDS));
$nurImExport = array_values(array_diff(AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_REGION_FIELDS, $listRegionsFelder));
assert($nurInListRegions === [], 'list_regions traegt Felder, ueber deren Oeffentlichkeit niemand entschieden hat: '
    . json_encode($nurInListRegions) . ' -- oeffentlich? dann in AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_REGION_FIELDS '
    . '(api/_internal/app/ecosystem-regions-export.php); nicht? dann in $bewusstNichtOeffentlich dieses Tests.');
assert($nurImExport === [], 'der Export nennt Felder, die list_regions nicht mehr baut: ' . json_encode($nurImExport));
// ⚠️ Auch die REIHENFOLGE: „genau so wie list_regions" heisst, dass ein Vergleich Zeichen fuer Zeichen
// gelingt, nicht nur Menge fuer Menge.
assert($listRegionsFelder === AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_REGION_FIELDS,
    'die Felder stehen in anderer Reihenfolge als in list_regions: ' . json_encode($listRegionsFelder));

// Dasselbe eine Ebene tiefer: das Art-Vokabular (region_types), gebaut in avesmapsEcosystemReadRegionTypes.
$typTokens = token_get_all('<?php ' . funktionsQuelle('avesmapsEcosystemReadRegionTypes'));
$typStart = null;
foreach ($typTokens as $i => $token) {
    if (is_array($token) && $token[0] === T_FN) {
        for ($j = $i + 1; isset($typTokens[$j]); $j++) {
            if (is_array($typTokens[$j]) && $typTokens[$j][0] === T_DOUBLE_ARROW) {
                $k = naechstesToken($typTokens, $j + 1);
                $typStart = ($typTokens[$k] ?? null) === '[' ? $k : null;
                break;
            }
        }
        break;
    }
}
assert($typStart !== null, 'avesmapsEcosystemReadRegionTypes baut seine Zeilen nicht mehr als `fn(…) => [ … ]`');
$typFelder = schluesselDesLiterals($typTokens, $typStart);
assert($typFelder === AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_TYPE_FIELDS,
    'die Felder einer Art weichen vom Export ab -- neu: ' . json_encode(array_values(array_diff($typFelder, AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_TYPE_FIELDS)))
    . ', weg: ' . json_encode(array_values(array_diff(AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_TYPE_FIELDS, $typFelder)))
    . ' (Reihenfolge zaehlt mit). Oeffentlich oder nicht -- entscheiden und AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_TYPE_FIELDS nachziehen.');

// ---- C. Die Antwort: Staende oben, Zeilen unveraendert ------------------------------------------
$region = [
    'public_id' => 'r-1',
    'name' => 'Finsterkamm',
    'kind' => 'topographie',
    'region_type' => 'gebirge',
    'wiki_region_key' => 'finsterkamm',
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Finsterkamm',
    'area_count' => 1,
    'label_public_id' => 'l-1',
    'auto_name' => null,
    'field_origins' => ['name' => 'wiki'],
    'curve_label' => true,
    'curve_label_max' => 2,
    'stack_order' => 7,
    'is_locked' => false,
    'first_area_public_id' => 'a-1',
    'bounds' => ['min_x' => 1.5, 'min_y' => 2.0, 'max_x' => 3.25, 'max_y' => 4.0],
    'updated_at' => '2026-09-28 10:00:00',
];
$typ = [
    'kind' => 'topographie', 'type_key' => 'gebirge', 'label' => 'Gebirge',
    'terrain_grain' => null, 'terrain_levels' => 3, 'terrain_avg_height' => 1.5, 'terrain_mean_height' => null,
];
$antwort = avesmapsEcosystemRegionsExportAntwort(['regions' => [$region], 'region_types' => [$typ]], 812, 40);
assert(array_keys($antwort) === ['ok', 'map_revision', 'ecosystem_revision', 'regions', 'region_types'],
    'die Huelle stimmt nicht (Staende oben, dann regions, dann region_types): ' . json_encode(array_keys($antwort)));
assert($antwort['ok'] === true && $antwort['map_revision'] === 812 && $antwort['ecosystem_revision'] === 40,
    'die Staende kommen nicht durch');
// 🔴 Zeichen fuer Zeichen, samt Reihenfolge und Typen (=== auf Arrays prueft beides).
assert($antwort['regions'] === [$region], 'eine Region aus list_regions kommt veraendert heraus: ' . json_encode($antwort['regions']));
assert($antwort['region_types'] === [$typ], 'eine Art kommt veraendert heraus');
assert(json_encode($antwort['regions'][0]) === json_encode($region), 'und auch auf der Leitung nicht gleich');

// 💣 Ein Feld, das nicht auf der Liste steht, faellt heraus -- die sichere Richtung.
$mitPerson = $region + ['updated_by' => 17, 'editor_name' => 'jemand'];
$geschnitten = avesmapsEcosystemRegionsExportAntwort(['regions' => [$mitPerson], 'region_types' => [$typ + ['created_by' => 3]]], 1, 1);
assert(!array_key_exists('updated_by', $geschnitten['regions'][0]) && !array_key_exists('editor_name', $geschnitten['regions'][0]),
    'ein nicht freigegebenes Feld geht an die Oeffentlichkeit');
assert(!array_key_exists('created_by', $geschnitten['region_types'][0]), 'dito bei den Arten');
assert($geschnitten['regions'][0] === $region, 'das Schneiden veraendert die freigegebenen Felder');

// ⚠️ Ein fehlendes Feld wird nicht erfunden.
$ohneBounds = $region;
unset($ohneBounds['bounds']);
$luecke = avesmapsEcosystemRegionsExportAntwort(['regions' => [$ohneBounds], 'region_types' => []], 1, 1);
assert(!array_key_exists('bounds', $luecke['regions'][0]), 'ein fehlendes Feld wird als null erfunden');
// Leere Liste bleibt eine leere LISTE (JSON []), kein Objekt.
assert(json_encode(avesmapsEcosystemRegionsExportAntwort([], 0, 1)['regions']) === '[]', 'leer ist nicht []');

// ---- D. Die Leseschleife, wirklich gefahren ----------------------------------------------------
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}
$neuePdo = static function (?int $mapRevision): PDO {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)');
    $pdo->exec('CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)');
    if ($mapRevision !== null) {
        $pdo->exec("INSERT INTO map_revision (id, revision) VALUES (1, {$mapRevision})");
    }
    $pdo->exec('INSERT INTO ecosystem_revision (id, revision) VALUES (1, 40), (2, 39)');

    return $pdo;
};
$zustand = static fn(PDO $pdo): string => json_encode([
    $pdo->query('SELECT id, revision FROM map_revision ORDER BY id')->fetchAll(),
    $pdo->query('SELECT id, revision FROM ecosystem_revision ORDER BY id')->fetchAll(),
]);
$liste = ['regions' => [$region], 'region_types' => [$typ]];

// D1. Ruhiger Stand: ein Lauf, die Staende von davor und danach, und NICHTS geschrieben.
$pdo = $neuePdo(812);
$vorher = $zustand($pdo);
$rufe = [];
$ruhig = avesmapsEcosystemRegionsExportLesen($pdo, '', static function (PDO $p, array $rumpf) use (&$rufe, $liste): array {
    $rufe[] = $rumpf;
    return $liste;
});
assert(count($rufe) === 1, 'ein ruhiger Stand wird mehr als einmal gelesen: ' . count($rufe));
assert($rufe[0] === [], 'ohne kind bekommt list_regions einen leeren Rumpf -- wie die Editor-Aktion ohne Filter');
assert($ruhig['map_revision'] === 812 && $ruhig['ecosystem_revision'] === 40, 'falsche Staende: ' . json_encode($ruhig));
assert($ruhig['regions'] === [$region], 'die Schleife veraendert die Liste');
assert($zustand($pdo) === $vorher, 'der Lesepfad hat etwas geschrieben');

// D2. `kind` reist unveraendert als Rumpf zu list_regions -- dieselbe Pruefung (avesmapsEcosystemReadKind).
$rufe = [];
avesmapsEcosystemRegionsExportLesen($pdo, 'vegetation', static function (PDO $p, array $rumpf) use (&$rufe, $liste): array {
    $rufe[] = $rumpf;
    return $liste;
});
assert($rufe === [['kind' => 'vegetation']], 'kind kommt nicht als Rumpf an: ' . json_encode($rufe));

// D3. 💣 Jemand speichert WAEHREND des Lesens: die erste Antwort ist verworfen, gelesen wird neu, und
// die Staende sind die des zweiten, ruhigen Laufs -- nie die des ersten.
$pdo = $neuePdo(812);
$rufe = 0;
$bewegt = avesmapsEcosystemRegionsExportLesen($pdo, '', static function (PDO $p) use (&$rufe, $liste): array {
    $rufe++;
    if ($rufe === 1) {
        $p->exec('UPDATE ecosystem_revision SET revision = revision + 1 WHERE id = 1');
    }
    return $liste;
});
assert($rufe === 2, 'nach einer Bewegung wird nicht neu gelesen: ' . $rufe);
assert($bewegt['ecosystem_revision'] === 41, 'der Stand stammt nicht aus dem ruhigen Lauf: ' . json_encode($bewegt));

// D4. Dasselbe fuer die Kartenrevision -- sie gehoert genauso zum Stand (label_public_id zeigt auf
// map_features).
$pdo = $neuePdo(812);
$rufe = 0;
$kartenBewegt = avesmapsEcosystemRegionsExportLesen($pdo, '', static function (PDO $p) use (&$rufe, $liste): array {
    $rufe++;
    if ($rufe === 1) {
        $p->exec('UPDATE map_revision SET revision = revision + 1 WHERE id = 1');
    }
    return $liste;
});
assert($rufe === 2 && $kartenBewegt['map_revision'] === 813, 'eine Bewegung der Kartenrevision wird uebersehen');

// D5. Bewegt es sich bei JEDEM Versuch: nach genau drei Laeufen aufgeben, statt einen falschen Stand zu nennen.
$pdo = $neuePdo(812);
$rufe = 0;
$geworfen = false;
try {
    avesmapsEcosystemRegionsExportLesen($pdo, '', static function (PDO $p) use (&$rufe, $liste): array {
        $rufe++;
        $p->exec('UPDATE ecosystem_revision SET revision = revision + 1 WHERE id = 1');
        return $liste;
    });
} catch (AvesmapsEcosystemRegionsExportInBewegung) {
    $geworfen = true;
}
assert($geworfen, 'ein dauernd bewegter Stand wird trotzdem beantwortet');
assert($rufe === AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_VERSUCHE && $rufe === 3, 'falsche Zahl Versuche: ' . $rufe);

// D6. Keine Zeile in map_revision -> 0, wie avesmapsFetchMapRevision in map-features.php.
$pdo = $neuePdo(null);
$leer = avesmapsEcosystemRegionsExportLesen($pdo, '', static fn(): array => $liste);
assert($leer['map_revision'] === 0, 'eine fehlende Kartenrevision ist nicht 0');

// ---- E. Die Liste IST list_regions -------------------------------------------------------------
// E1. Die Vorgabe der Schleife ist genau die Funktion, die `list_regions` ruft.
$leserQuelle = ohneKommentare(funktionsQuelle('avesmapsEcosystemRegionsExportLesen'));
assert(str_contains($leserQuelle, "\$liste ??= 'avesmapsListEcosystemRegions';"),
    'die Leseschleife ruft nicht mehr avesmapsListEcosystemRegions -- dann ist „genau so wie list_regions" '
    . 'eine Behauptung ohne Grund');
$parameter = (new ReflectionFunction('avesmapsEcosystemRegionsExportLesen'))->getParameters();
assert(count($parameter) === 3 && $parameter[2]->getName() === 'liste' && $parameter[2]->isDefaultValueAvailable()
    && $parameter[2]->getDefaultValue() === null, 'der dritte Parameter ist nicht mehr die optionale Testnaht');

// E2. Der Endpunkt reicht KEINE eigene Liste hinein -- genau zwei Argumente.
$endpunkt = ohneKommentare((string) file_get_contents($endpunktDatei));
$endpunktTokens = token_get_all($endpunkt);
$aufrufe = 0;
foreach ($endpunktTokens as $i => $token) {
    if (!is_array($token) || $token[0] !== T_STRING || $token[1] !== 'avesmapsEcosystemRegionsExportLesen') {
        continue;
    }
    $aufrufe++;
    $k = naechstesToken($endpunktTokens, $i + 1);
    assert($endpunktTokens[$k] === '(', 'der Leser wird nicht aufgerufen');
    $tiefe = 0;
    $kommas = 0;
    for ($j = $k; isset($endpunktTokens[$j]); $j++) {
        $t = $endpunktTokens[$j];
        if ($t === '(' || $t === '[') {
            $tiefe++;
        } elseif ($t === ')' || $t === ']') {
            $tiefe--;
            if ($tiefe === 0) {
                break;
            }
        } elseif ($t === ',' && $tiefe === 1) {
            $kommas++;
        }
    }
    assert($kommas === 1, 'der Endpunkt reicht dem Leser mehr als ($pdo, $kind) -- eine eigene Liste waere eine zweite Wahrheit');
}
assert($aufrufe === 1, 'der Endpunkt ruft den Leser nicht genau einmal: ' . $aufrufe);

// E3. Und die Editor-Aktion ruft weiterhin dieselbe Funktion (unveraendert, Auftrag: „keine Aenderung an
// list_regions selbst").
$dispatcher = ohneKommentare((string) file_get_contents($wurzel . '/api/edit/map/ecosystem.php'));
assert(str_contains($dispatcher, "'list_regions' => avesmapsListEcosystemRegions(\$pdo, \$payload),"),
    'list_regions ruft nicht mehr dieselbe Funktion wie der oeffentliche Endpunkt');

// ---- F. Ohne Sitzung, ohne Schreibweg ----------------------------------------------------------
$bibliothek = ohneKommentare((string) file_get_contents($bibliothekDatei));
foreach (['Endpunkt' => $endpunkt, 'Bibliothek' => $bibliothek] as $wer => $quelle) {
    foreach (['auth.php', 'avesmapsRequireUser', 'avesmapsCurrentUser', 'session_start', 'avesmapsReadJsonRequest', 'avesmapsUserCan'] as $sitzung) {
        assert(!str_contains($quelle, $sitzung), "{$wer}: `{$sitzung}` -- der Endpunkt ist oeffentlich (Owner 28.09.2026)");
    }
    assert(stripos($quelle, 'csrf') === false, "{$wer}: kein CSRF auf einem Lesepfad");
    foreach (['/\bINSERT\b/i', '/\bUPDATE\b/i', '/\bDELETE\b/i', '/\bREPLACE\b/i', '/\bALTER\b/i', '/\bCREATE\b/i', '/\bDROP\b/i'] as $schreiben) {
        assert(!preg_match($schreiben, $quelle), "{$wer}: ein Schreibvorgang ({$schreiben})");
    }
    foreach (['NextEcosystemRevision', 'NextMapRevision', 'BumpMapRevision', 'beginTransaction', 'avesmapsCurveNachSchreibvorgang'] as $sprung) {
        assert(!str_contains($quelle, $sprung), "{$wer}: `{$sprung}` -- kein Revisionssprung aus einem Lesepfad");
    }
}
assert(str_contains($endpunkt, "\$requestMethod !== 'GET'") && str_contains($endpunkt, "405, 'method_not_allowed'"),
    'der Endpunkt lehnt andere Methoden als GET nicht ab');
assert(str_contains($endpunkt, "avesmapsCreatePdo(\$config['database'] ?? [])"), 'der Teilbaum, nicht die ganze Konfiguration');

// ---- G. Kopfzeilen wie map-features.php, und erst NACH der Arbeit ------------------------------
foreach (["header('ETag: ' . \$etag);", "header('X-Avesmaps-ETag: ' . \$etag);",
    "header('Cache-Control: no-cache, must-revalidate');", "header('Vary: Accept-Encoding', false);"] as $kopf) {
    assert(str_contains($endpunkt, $kopf), "die Kopfzeile fehlt: {$kopf}");
}
$posLesen = strpos($endpunkt, 'avesmapsEcosystemRegionsExportLesen(');
$posErsterKopf = strpos($endpunkt, "header('ETag");
assert($posLesen !== false && $posErsterKopf !== false && $posLesen < $posErsterKopf,
    'der ETag geht vor der Arbeit hinaus -- eine 500 truege dann einen gueltigen Tag');
assert(preg_match('/avesmapsETagMatches\(\$ifNoneMatch, \$etag\)\)\s*\{\s*http_response_code\(304\);\s*exit;/', $endpunkt) === 1,
    'die bedingte Anfrage beantwortet nicht mit 304');

$tagA = avesmapsEcosystemRegionsExportETag('{"a":1}');
assert($tagA === avesmapsEcosystemRegionsExportETag('{"a":1}'), 'derselbe Inhalt, verschiedene Tags');
assert($tagA !== avesmapsEcosystemRegionsExportETag('{"a":2}'), 'anderer Inhalt, derselbe Tag -- dann luegt die 304');
assert(preg_match('/^W\/"eco-regions-[0-9a-f]{16}"$/', $tagA) === 1, 'Form des Tags: ' . $tagA);
assert(avesmapsETagMatches($tagA, $tagA) && avesmapsETagMatches(substr($tagA, 2), $tagA), 'der Tag passt nicht auf sich selbst');

// ---- H. Die Fehlerwege -------------------------------------------------------------------------
$posBewegung = strpos($endpunkt, 'catch (AvesmapsEcosystemRegionsExportInBewegung)');
$posThrowable = strpos($endpunkt, 'catch (Throwable)');
assert($posBewegung !== false && $posThrowable !== false && $posBewegung < $posThrowable,
    'der Stand-in-Bewegung-Fall wird vom allgemeinen Fang geschluckt');
assert(preg_match("/503,\s*'data_changing'/", $endpunkt) === 1, 'ein bewegter Stand ist kein 503 data_changing');
// 🔴 Kein getMessage() hinter dem allgemeinen Fang (AGENTS.md §10).
assert(!str_contains(substr($endpunkt, $posThrowable), 'getMessage'), 'der allgemeine Fang reicht Ausnahmetext an die Oeffentlichkeit');

echo "ecosystem-regions-export: alle Zusicherungen gruen\n";
