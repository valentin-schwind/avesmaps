<?php

declare(strict_types=1);

/**
 * DER SAMMEL-TAKEOVER DER ALTQUELLEN (Schritt 4 des Quellen-Umbaus, 03.09.2026).
 *
 * `properties.other_source` („Andere Quelle“) war die Parallel-Implementierung zum Katalog; der Einzel-Takeover
 * holte sie nur nach, wenn ein Editor die Quellenliste eines Objekts oeffnete. 314 Altquellen (168 Orte,
 * 30 Beschriftungen, 116 Wege) hingen so an einem `os:`-Erzeuger in der Kartennutzlast.
 *
 * Geprueft werden, gegen SQLite:
 *   1. die Auswahl: nur aktive Zeilen der drei Objektarten mit nichtleerer Adresse; Kreuzungen, Grabsteine und
 *      leere Adressen fallen heraus -- exakt die Auswahl des os:-Erzeugers
 *   2. der Trockenlauf zaehlt (je Objektart, Adressen, davon bekannt) und schreibt NICHTS
 *   3. der scharfe Lauf ruft je Zeile DEN Einzel-Takeover (Quelltext) und deckelt
 *   4. der Einzel-Takeover laesst „offiziell“ einer bekannten Zeile in Ruhe (Quelltext + Regel)
 *   5. der Endpunkt: Admin-Riegel, ohne entity_public_id, apply nur ausdruecklich
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/app/__tests__/quellen-altquellen-takeover-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$GLOBALS['avesmapsTestRevisionBumps'] = 0;
function avesmapsNextMapRevision(PDO $pdo): int
{
    $GLOBALS['avesmapsTestRevisionBumps']++;

    return $GLOBALS['avesmapsTestRevisionBumps'];
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../feature-sources.php';

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
avesmapsEnsureFeatureSourceTables($pdo);
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT, is_active INTEGER,
    properties_json TEXT, revision INTEGER)');
$ins = $pdo->prepare('INSERT INTO map_features (public_id, feature_type, is_active, properties_json, revision) VALUES (?, ?, ?, ?, 1)');
$os = static fn (string $url, string $label = 'Briefspiel'): string => json_encode(['name' => 'X', 'other_source' => ['url' => $url, 'label' => $label]]);
$ins->execute(['ort-1', 'location', 1, $os('https://wiki.punin.de/Baronie_Bitterbusch')]);
$ins->execute(['ort-2', 'location', 1, $os('https://herzogtum-weiden.net/wiki/Baronie_X')]);
$ins->execute(['weg-1', 'path', 1, $os('https://wiki.punin.de/Baronie_Bitterbusch')]);        // dieselbe Adresse wie ort-1
$ins->execute(['label-1', 'label', 1, $os('https://www.westlande.de/index.php?title=Ebene')]);
$ins->execute(['kreuzung-1', 'crossing', 1, $os('https://wiki.punin.de/Kreuzung')]);           // keine Quellenflaeche
$ins->execute(['ort-tot', 'location', 0, $os('https://wiki.punin.de/Tot')]);                    // Grabstein
$ins->execute(['ort-leer', 'location', 1, $os('   ')]);                                          // leere Adresse
$ins->execute(['ort-ohne', 'location', 1, json_encode(['name' => 'Ohne'])]);                    // kein other_source
// Eine der Adressen steht schon im Katalog -- offiziell.
$pdo->prepare('INSERT INTO sources (id, url, url_hash, label, source_type, is_official, license, attribution) VALUES (7, :u, :h, :l, :t, 1, :lic, :a)')
    ->execute(['u' => 'https://wiki.punin.de/Baronie_Bitterbusch', 'h' => avesmapsFeatureSourceHash('https://wiki.punin.de/Baronie_Bitterbusch'),
        'l' => 'Baronie Bitterbusch', 't' => 'briefspiel', 'lic' => '', 'a' => '']);

// ── 1 + 2) Der Trockenlauf ────────────────────────────────────────────────────────────────────
$trocken = avesmapsFeatureSourcesTakeoverAll($pdo, 1, true);
assert($trocken['ok'] === true && $trocken['dry_run'] === true, 'die Vorgabe ist der Trockenlauf');
$zaehl();
assert($trocken['total'] === 4, 'vier Kandidaten: zwei Orte, ein Weg, eine Beschriftung -- Kreuzung, Grabstein, leere Adresse und ohne Feld fallen heraus');
$zaehl();
assert($trocken['per_type'] === ['settlement' => 2, 'path' => 1, 'region' => 1], 'je Objektart, als Katalog-Objektart benannt: ' . json_encode($trocken['per_type']));
$zaehl();
assert($trocken['distinct_urls'] === 3 && $trocken['known_urls'] === 1, 'drei verschiedene Adressen, eine davon schon im Katalog');
$zaehl();
assert(count($trocken['sample']) === 4 && $trocken['sample'][0]['public_id'] === 'ort-1' && $trocken['sample'][0]['entity_type'] === 'settlement',
    'die Stichprobe nennt Objektart, Kennung, Adresse');
$zaehl();
assert($trocken['done'] === 0 && $trocken['remaining'] === 4 && $trocken['failed'] === [], 'nichts getan, alles bleibt');
$zaehl();
assert((int) $pdo->query('SELECT COUNT(*) FROM feature_sources')->fetchColumn() === 0, 'der Trockenlauf schreibt keine Verknuepfung');
$zaehl();
assert((int) $pdo->query('SELECT COUNT(*) FROM sources')->fetchColumn() === 1, '… und keine Katalogzeile');
$zaehl();
assert($GLOBALS['avesmapsTestRevisionBumps'] === 0, '… und bumpt keine Revision');
$zaehl();
assert(AVESMAPS_LEGACY_OTHER_SOURCE_ENTITY_TYPES === ['location' => 'settlement', 'label' => 'region', 'path' => 'path'],
    'die Abbildung ist die des os:-Erzeugers -- sonst holt der Lauf etwas anderes, als die Karte bisher zeigte');
$zaehl();

// ── 3) Der scharfe Lauf ruft DEN Einzel-Takeover, je Zeile, gedeckelt (Quelltext -- der Upsert ist MySQL) ──
// zeilenendenneutral (die Bibliothek ist CRLF, das Tor legt LF hin -- AGENTS.md §9)
$quelltext = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../feature-sources.php'));
$start = strpos($quelltext, 'function avesmapsFeatureSourcesTakeoverAll(');
$rumpf = substr($quelltext, $start, strpos($quelltext, "\nfunction ", $start + 10) - $start);
assert(str_contains($rumpf, "avesmapsFeatureSourcesTakeoverOtherSource(\$pdo, \$k['entity_type'], \$k['public_id'], \$userId);"),
    'der scharfe Lauf ruft den Einzel-Takeover -- keine zweite Fassung der Regeln');
$zaehl();
assert(str_contains($rumpf, 'foreach (array_slice($kandidaten, 0, $limit) as $k)'), 'gedeckelt: STRATO vertraegt keinen langen Lauf in einem Request');
$zaehl();
assert(str_contains($rumpf, "} catch (Throwable \$e) {") && str_contains($rumpf, "\$ergebnis['failed'][]"), 'eine kaputte Zeile wird gemeldet, nicht geschluckt');
$zaehl();
assert(str_contains($rumpf, "if (\$dryRun) {\n        return \$ergebnis;\n    }"), 'der Trockenlauf kehrt VOR der Schleife zurueck');
$zaehl();

// ── 4) Der Einzel-Takeover laesst „offiziell“ einer bekannten Zeile in Ruhe ──────────────────
$einzelStart = strpos($quelltext, 'function avesmapsFeatureSourcesTakeoverOtherSource(');
$einzel = substr($quelltext, $einzelStart, strpos($quelltext, "\nfunction ", $einzelStart + 10) - $einzelStart);
assert(str_contains($einzel, 'avesmapsSourceOfficialWriteAllowed(false, is_array($bestehend) ? $bestehend : null)'),
    'eine Altquelle ist keine Aussage ueber „offiziell“ -- der Riegel wird mit „nicht gewaehlt“ gefragt');
$zaehl();
assert(str_contains($einzel, "false, \$userId, '', false, '', '', false, \$setOfficial);"),
    'und die Antwort reicht bis in den Upsert');
$zaehl();
assert(avesmapsSourceOfficialWriteAllowed(false, ['id' => 7, 'wiki_key' => null]) === false, 'bekannt + keine Wahl = unberuehrt (50 der 102 Altadressen)');
$zaehl();

// ── 5) Der Endpunkt ───────────────────────────────────────────────────────────────────────────
$endpunkt = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../../../edit/map/feature-sources.php')) as $token) {
    if (is_array($token)) {
        if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $endpunkt .= $token[1];
    } else {
        $endpunkt .= $token;
    }
}
$arm = substr($endpunkt, strpos($endpunkt, "'takeover_other_sources' =>"));
$arm = substr($arm, 0, strpos($arm, "'remove' =>"));
assert(str_contains($arm, "avesmapsUserCan(\$user, 'admin')") && str_contains($arm, "avesmapsErrorResponse(403"), 'nur Admins -- sonst 403');
$zaehl();
assert(str_contains($arm, "(\$payload['apply'] ?? false) === true"), 'scharf nur mit apply: true, strikt');
$zaehl();
assert(str_contains($arm, 'avesmapsFeatureSourcesTakeoverAll($pdo, $userId, !$scharf,'), 'und die Vorgabe ist der Trockenlauf');
$zaehl();
assert(str_contains($endpunkt, "'corpus_titles_apply', 'takeover_other_sources'], true)"), 'die Aktion fragt nach ALLEN Objekten und steht deshalb ohne entity_public_id da');
$zaehl();

echo "quellen-altquellen-takeover: {$pruefungen} Pruefungen bestanden\n";
