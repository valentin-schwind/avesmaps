<?php

declare(strict_types=1);

/**
 * JEDER Zuweiser einer Wiki-Landschaft an ein LABEL loescht den Merker „Kein Wiki-Artikel vorhanden".
 *
 * 💣 DIESE PROBE ZAEHLT, STATT EINER ZAHL ZU GLAUBEN -- und in ihrer ersten Fassung tat sie genau
 * das doch. Sie lief ueber eine FEST VERDRAHTETE Zwei-Datei-Liste, und ein sechster Zuweiser in
 * api/_internal/conflicts/repair.php lief ungesehen durch: „5 Zuweiser geprueft, alle loeschen den
 * Merker", EXIT=0, das ganze PHP-Feld gruen. 🔴 DIE ZAHL WAR NICHT VERSCHWUNDEN, SIE WAR AUS DEM
 * KOMMENTAR IN EIN ARRAY GEWANDERT. Dieselbe Fehlerklasse wie „ERZEUGER 1 VON 2" (AGENTS.md §11),
 * nur als Datenstruktur getarnt. Seit dem 16.08.2026 laeuft sie ueber den GANZEN `api/`-Baum.
 *
 * 💣 UND SIE ERKENNT ZWEI SCHREIBWEISEN. `unset($x['wiki_no_article'])` ist die eine;
 * api/_internal/conflicts/repair.php loescht denselben Schluessel ueber die Konstante
 * AVESMAPS_CONFLICT_NO_ARTICLE_FLAG. Ein Muster, das nur das Literal kennt, haelt eine korrekte
 * Loeschung fuer eine fehlende -- oder, schlimmer, meldet einen Zuweiser als geprueft, weil er in
 * keiner der aufgezaehlten Dateien stand.
 *
 * 🔴 WARUM DER MERKER AM LABEL UEBERHAUPT ZAEHLT: ein Label IST eine Konfliktpartei
 * (`feature_type='label'` -> Typ „Region/Landschaft", api/_internal/conflicts/rules.php), und die
 * Regel `wiki.missing_key` liest `properties.wiki_no_article`. Es fehlte nur der Schreibweg --
 * anders als bei der Landschaftsflaeche, die in gar keiner Konfliktliste steht.
 *
 * Run (Windows), vom Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/map/__tests__/label-wiki-no-article-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

/**
 * Jede PHP-Datei unter `api/` -- ohne die Proben selbst, die absichtlich Beispielcode enthalten.
 * ⚠️ Der ganze Baum, keine Liste: eine Liste ist eine Zahl mit anderem Aussehen.
 */
function avesmapsLabelWikiPhpDateien(string $wurzel): array {
    $treffer = [];
    $lauf = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($wurzel, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($lauf as $eintrag) {
        $pfad = str_replace('\\', '/', (string) $eintrag);
        if (substr($pfad, -4) !== '.php' || str_contains($pfad, '/__tests__/')) {
            continue;
        }
        $treffer[] = $pfad;
    }
    sort($treffer);

    return $treffer;
}

$wurzel = str_replace('\\', '/', realpath(__DIR__ . '/../../..'));
$dateien = avesmapsLabelWikiPhpDateien($wurzel);
assert(count($dateien) > 100, 'Der api/-Baum wurde nicht gefunden -- nur ' . count($dateien) . ' Dateien.');

$schreibstellen = [];
$ohneLoeschung = [];

foreach ($dateien as $datei) {
    $zeilen = preg_split('/\R/u', (string) file_get_contents($datei)) ?: [];
    foreach ($zeilen as $nummer => $zeile) {
        // Eine ZUWEISUNG ist `…['wiki_region'] = <etwas>` -- ein `unset` und ein Lesezugriff sind
        // keine. Der Variablenname wechselt je Datei ($properties / $props), deshalb offen gelassen.
        if (preg_match('/\$\w+\[\x27wiki_region\x27\]\s*=\s*[^=]/', $zeile) !== 1) {
            continue;
        }
        $kurz = substr($datei, strlen($wurzel) + 1);
        $schreibstellen[] = $kurz . ':' . ($nummer + 1);
        // Die Loeschung steht unmittelbar daneben. ⚠️ ZEHN Zeilen Fenster, nicht fuenf: die
        // Begruendung gehoert ueber das `unset`, und an der laengsten Stelle sind das sieben
        // Kommentarzeilen (gemessen -- mit fuenf fiel genau diese Probe um). Zehn ist immer noch
        // kuerzer als jede Funktion hier, ein fremdes `unset` kann also nicht mitzaehlen.
        $fenster = implode("\n", array_slice($zeilen, $nummer, 11));
        // 💣 BEIDE Schreibweisen: das Literal UND die Konstante aus conflicts/repair.php.
        $literal = preg_match('/unset\(\$\w+\[\x27wiki_no_article\x27\]\)/', $fenster) === 1;
        $konstante = preg_match('/unset\(\$\w+\[AVESMAPS_CONFLICT_NO_ARTICLE_FLAG\]\)/', $fenster) === 1;
        if (!$literal && !$konstante) {
            $ohneLoeschung[] = $kurz . ':' . ($nummer + 1) . '  ' . trim($zeile);
        }
    }
}

assert($ohneLoeschung === [],
    "Diese Zuweiser von properties.wiki_region loeschen den Merker NICHT:\n  " . implode("\n  ", $ohneLoeschung));

// 🔴 Und es sind wirklich mehrere -- faende das Muster nur eine Stelle, waere die Zusicherung oben
// leer und trotzdem gruen. Genau diese Blindheit hat der Weg-Test einmal gehabt.
// ⚠️ KEINE Obergrenze: ein sechster Zuweiser ist erlaubt, er muss nur die Zeile tragen. Eine
// Gleichheitspruefung waere die Zahl wieder, nur an anderer Stelle.
assert(count($schreibstellen) >= 5,
    'Es wurden nur ' . count($schreibstellen) . ' Zuweiser gefunden -- das Suchmuster greift nicht mehr.');

// ⚠️ Und die Suche erreicht wirklich mehr als die zwei Dateien, an denen sie einmal haengenblieb:
// mindestens zwei verschiedene Verzeichnisse muessen dabei sein.
$verzeichnisse = array_unique(array_map(static fn(string $s): string => dirname($s), $schreibstellen));
assert(count($verzeichnisse) >= 2,
    'Alle Zuweiser stehen in EINEM Verzeichnis -- der Lauf ueber den Baum bringt dann nichts: '
    . implode(', ', $verzeichnisse));

// ---- Der Schreibweg selbst -----------------------------------------------------------------------
// ⚠️ Textprobe, und hier ist sie richtig: `avesmapsUpdateLabelFeature` braucht ein PDO und eine
// gueltige Feature-Zeile, laesst sich also lokal nicht fahren. Was sie beantworten kann, ist, ob der
// Schluessel ueberhaupt gelesen wird und ob er per array_key_exists gelesen wird -- ein `?? false`
// naehme die Entscheidung eines zweiten Editors bei jedem unbeteiligten Speichern still zurueck.
$features = (string) file_get_contents(__DIR__ . '/../features.php');
assert(str_contains($features, "array_key_exists('wiki_no_article', \$payload)"),
    'avesmapsUpdateLabelFeature liest den Merker nicht (oder nicht per array_key_exists)');
// 🔴 Der GETEILTE Riegel, nicht ein zweiter Satz: er steht in api/_internal/map/wiki-claim.php.
assert(str_contains($features, "'Ein Label',"),
    'der Widerspruchsriegel des Labels fehlt -- Zuweisung UND Merker zugleich waeren erlaubt');

// ⚠️ `require_once`, nicht `require`: die Datei traegt keinen function_exists-Schutz, und sobald
// diese Probe irgendwann features.php mitlaedt (das bindet sie ebenfalls ein), waere ein zweites
// Einlesen ein Redeclare-Fatal.
require_once __DIR__ . '/../wiki-claim.php';
$geworfen = false;
try {
    avesmapsAssertWikiClaimNotContradictory('wiki:gesetzt', true, 'Ein Label', 'Ausweg.');
} catch (InvalidArgumentException $exception) {
    $geworfen = true;
    assert(str_contains($exception->getMessage(), 'Ein Label'), $exception->getMessage());
}
assert($geworfen, 'der geteilte Riegel laesst den Widerspruch durch');

echo 'label-wiki-no-article: ' . count($schreibstellen) . " Zuweiser im ganzen api/-Baum geprueft, alle loeschen den Merker\n";
echo '  ' . implode("\n  ", $schreibstellen) . "\n";
