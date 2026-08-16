<?php

declare(strict_types=1);

/**
 * JEDER Zuweiser einer Wiki-Landschaft an ein LABEL loescht den Merker „Kein Wiki-Artikel vorhanden".
 *
 * 💣 DIESE PROBE ZAEHLT, STATT EINER ZAHL IM KOMMENTAR ZU GLAUBEN. Genau daran ist am 16.08.2026 der
 * WEG gescheitert: dort stand „ZWEI Zuweiser" samt Namen, und es waren DREI -- gefunden von der
 * Konsistenz-Pruefung, nicht vom Test (AGENTS.md §11: eine Zahl liest sich wie eine vollstaendige
 * Liste, und niemand zaehlt nach). Beim Label sind es FUENF, verteilt auf ZWEI Dateien:
 *   api/_internal/map/features.php    -- avesmapsCreateLabelFeature, avesmapsUpdateLabelFeature
 *   api/_internal/wiki/regions.php    -- drei Zuweiser der Regionen-Sync
 * Die Probe sucht die Schreibstellen selbst; kommt ein sechster dazu, faellt sie um, bis er die
 * Zeile ebenfalls traegt.
 *
 * 🔴 WARUM DER MERKER AM LABEL UEBERHAUPT ZAEHLT: ein Label IST eine Konfliktpartei
 * (`feature_type='label'` -> Typ „Region/Landschaft", api/_internal/conflicts/rules.php), und die
 * Regel `wiki.missing_key` liest `properties.wiki_no_article` seit dem 15.08.2026. Es fehlte nur der
 * Schreibweg -- anders als bei der Landschaftsflaeche, die in gar keiner Konfliktliste steht.
 *
 * Run (Windows), vom Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/map/__tests__/label-wiki-no-article-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

$dateien = [
    __DIR__ . '/../features.php',
    __DIR__ . '/../../wiki/regions.php',
];

$schreibstellen = 0;
$ohneLoeschung = [];

foreach ($dateien as $datei) {
    $zeilen = preg_split('/\R/u', (string) file_get_contents($datei)) ?: [];
    foreach ($zeilen as $nummer => $zeile) {
        // Eine ZUWEISUNG ist `…['wiki_region'] = <etwas>` -- ein `unset` und ein Lesezugriff sind
        // keine. Der Variablenname wechselt je Datei ($properties / $props), deshalb offen gelassen.
        if (preg_match('/\$\w+\[\x27wiki_region\x27\]\s*=\s*[^=]/', $zeile) !== 1) {
            continue;
        }
        $schreibstellen++;
        // Die Loeschung steht unmittelbar daneben. ⚠️ ZEHN Zeilen Fenster, nicht fuenf: die
        // Begruendung gehoert ueber das `unset`, und an der laengsten Stelle sind das sieben
        // Kommentarzeilen (gemessen -- mit fuenf fiel genau diese Probe um). Zehn ist immer noch
        // kuerzer als jede Funktion hier, ein fremdes `unset` kann also nicht mitzaehlen.
        $fenster = implode("\n", array_slice($zeilen, $nummer, 11));
        if (preg_match('/unset\(\$\w+\[\x27wiki_no_article\x27\]\)/', $fenster) !== 1) {
            $ohneLoeschung[] = basename($datei) . ':' . ($nummer + 1) . '  ' . trim($zeile);
        }
    }
}

assert($ohneLoeschung === [],
    "Diese Zuweiser von properties.wiki_region loeschen den Merker NICHT:\n  " . implode("\n  ", $ohneLoeschung));

// 🔴 Und es sind wirklich mehrere -- faende das Muster nur eine Stelle, waere die Zusicherung oben
// leer und trotzdem gruen. Genau diese Blindheit hat der Weg-Test einmal gehabt.
assert($schreibstellen >= 5,
    'Es wurden nur ' . $schreibstellen . ' Zuweiser gefunden -- das Suchmuster greift nicht mehr.');

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

require __DIR__ . '/../wiki-claim.php';
$geworfen = false;
try {
    avesmapsAssertWikiClaimNotContradictory('wiki:gesetzt', true, 'Ein Label', 'Ausweg.');
} catch (InvalidArgumentException $exception) {
    $geworfen = true;
    assert(str_contains($exception->getMessage(), 'Ein Label'), $exception->getMessage());
}
assert($geworfen, 'der geteilte Riegel laesst den Widerspruch durch');

echo "label-wiki-no-article: " . $schreibstellen . " Zuweiser geprueft, alle loeschen den Merker\n";
