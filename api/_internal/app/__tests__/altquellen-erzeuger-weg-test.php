<?php

declare(strict_types=1);

/**
 * DIE ALTQUELLEN SIND WEG -- und bleiben weg (Schritt 4 des Quellen-Umbaus, 03.09.2026).
 *
 * `properties.other_source` („Andere Quelle“) war die Parallel-Implementierung zum Katalog (AGENTS.md §5:
 * „Sources live in ONE place“). Am 03.09.2026 sind die 314 Altquellen per Sammel-Takeover in den Katalog
 * gewandert; seither darf es weder einen Schreiber noch einen Erzeuger in der Nutzlast geben.
 *
 * Geprueft werden, am Quelltext (kommentarfrei):
 *   1. die Kartennutzlast baut keine synthetischen `os:`-Zeilen mehr
 *   2. kein Schreibweg in api/_internal/map/features.php schreibt `properties.other_source`
 *   3. der Beschriftungsdialog traegt weder das Feld noch den Helfer; das Helfer-Skript ist nicht mehr geladen
 *   4. der Sicherheitsnetz-Takeover (je Objekt) und der Sammel-Takeover bleiben -- wer je wieder ein Feld
 *      schreibt, wird beim naechsten Oeffnen der Quellenliste eingesammelt
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/altquellen-erzeuger-weg-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$pruefungen = 0;
$zaehl = static function () use (&$pruefungen): void { $pruefungen++; };
$wurzel = dirname(__DIR__, 4);

$ohneKommentare = static function (string $pfad): string {
    $aus = '';
    foreach (token_get_all((string) file_get_contents($pfad)) as $token) {
        if (is_array($token)) {
            if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $aus .= $token[1];
        } else {
            $aus .= $token;
        }
    }
    return $aus;
};
$jsOhneKommentare = static fn (string $pfad): string => (string) preg_replace('#/\*[\s\S]*?\*/|(^|[^:\\\\"\'`])//[^\n]*#m', '$1', (string) file_get_contents($pfad));
$htmlOhneKommentare = static fn (string $pfad): string => (string) preg_replace('#<!--[\s\S]*?-->#', '', (string) file_get_contents($pfad));

// ── 1) Die Nutzlast ───────────────────────────────────────────────────────────────────────────
$nutzlast = $ohneKommentare($wurzel . '/api/app/map-features.php');
assert(!str_contains($nutzlast, 'avesmapsMapFeaturesMergeLegacyOtherSources'), 'der os:-Erzeuger ist weg -- Aufruf und Funktion');
$zaehl();
assert(!str_contains($nutzlast, "'os:'"), 'und keine synthetische Kennung mehr');
$zaehl();
assert(!str_contains($nutzlast, 'other_source'), 'die Nutzlast liest properties.other_source nirgends mehr');
$zaehl();

// ── 2) Kein Schreiber ─────────────────────────────────────────────────────────────────────────
$features = $ohneKommentare($wurzel . '/api/_internal/map/features.php');
assert(!str_contains($features, "\$properties['other_source'] ="), 'kein Schreibweg setzt properties.other_source');
$zaehl();
assert(!str_contains($features, 'avesmapsReadOptionalOtherSource'), 'der Leser des Rumpffelds ist weg -- mit ihm jeder Schreiber');
$zaehl();
assert(!str_contains($features, "'other_source'"), 'und kein Sammel-Speichern nennt das Feld');
$zaehl();

// ── 3) Der Beschriftungsdialog ────────────────────────────────────────────────────────────────
$index = $htmlOhneKommentare($wurzel . '/index.html');
assert(!str_contains($index, 'label-edit-other-source'), 'der Beschriftungsdialog traegt „Andere Quelle“ nicht mehr');
$zaehl();
assert(!str_contains($index, 'review-other-source.js'), 'das Helfer-Skript ist nicht mehr geladen');
$zaehl();
assert(str_contains($index, 'id="label-edit-feature-sources"'), '… der Kasten „Quellen“ (das EINE Bauteil) steht weiterhin da');
$zaehl();
assert(!is_file($wurzel . '/js/review/review-other-source.js'), 'und die Datei ist aus dem Repo -- der Deploy loescht nie, das Repo schon');
$zaehl();
$labels = $jsOhneKommentare($wurzel . '/js/review/review-labels.js');
assert(!str_contains($labels, 'OtherSourceToForm') && !str_contains($labels, 'OtherSourceFromForm') && !str_contains($labels, 'other_source:'),
    'review-labels.js liest und schreibt das Feld nicht mehr');
$zaehl();

// ── 4) Das Sicherheitsnetz bleibt ─────────────────────────────────────────────────────────────
$lib = $ohneKommentare($wurzel . '/api/_internal/app/feature-sources.php');
assert(str_contains($lib, 'function avesmapsFeatureSourcesTakeoverOtherSource('), 'der Einzel-Takeover bleibt als Sicherheitsnetz');
$zaehl();
assert(str_contains($lib, 'function avesmapsFeatureSourcesTakeoverAll('), 'der Sammel-Takeover bleibt (Trockenlauf-Vorgabe)');
$zaehl();

echo "altquellen-erzeuger-weg: {$pruefungen} Pruefungen bestanden\n";
