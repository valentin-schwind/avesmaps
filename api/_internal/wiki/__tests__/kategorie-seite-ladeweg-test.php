<?php

declare(strict_types=1);

/**
 * Der LADEWEG von avesmapsWikiSyncFetchCategoryMemberPage() -- dem gemeinsamen Baustein
 * beider Kategorie-Crawls (seit 24.08.2026, als die zwei Online-Phasen des Dump-Laufs
 * unterbrechbar wurden).
 *
 * 💣 WORUM ES GEHT: den Baustein rufen ZWEI Dateien, die einander NICHT laden --
 * `locations.php` (avesmapsWikiSyncFetchCategoryMemberTitles) und `settlements.php`
 * (avesmapsWikiSettlementFetchSubcategories). Legt man ihn zu einer der beiden, ist er fuer
 * den jeweils anderen Aufrufer ein "undefined function" -- und zwar erst zur LAUFZEIT, in
 * genau dem Ladeweg, den kein anderer Test faehrt. Er gehoert deshalb nach `sync.php`: die
 * eine Datei, die beide schon immer brauchen, weil beide avesmapsWikiSyncApiRequest() rufen.
 *
 * ⭐ DER TEST HAT ZWEI HALBZEITEN, und das ist sein ganzer Sinn: er startet je einen EIGENEN
 * PHP-Prozess, der nur EINEN der beiden Wege laedt. In einem Prozess, der beide laedt, kann
 * dieser Fehler grundsaetzlich nicht auftreten -- ein Test in einem Prozess waere gruen und
 * wertlos.
 *
 * Kein HTTP, keine Datenbank: gerufen wird nichts, nur nachgesehen, ob es da waere.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/kategorie-seite-ladeweg-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- asserts waeren wirkungslos.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4); // __tests__ -> wiki -> _internal -> api -> <Repo>

/**
 * Einen frischen PHP-Prozess starten, der genau die angegebenen Dateien laedt, und melden,
 * welche der gesuchten Funktionen darin definiert sind.
 *
 * @param list<string> $dateien   Pfade relativ zur Repo-Wurzel
 * @param list<string> $funktionen
 * @return array<string, bool>
 */
$imEigenenProzess = static function (array $dateien, array $funktionen) use ($wurzel): array {
    $zeilen = ['<?php'];
    foreach ($dateien as $datei) {
        $zeilen[] = 'require ' . var_export($wurzel . '/' . $datei, true) . ';';
    }
    $zeilen[] = 'echo json_encode(array_map("function_exists", ' . var_export($funktionen, true) . '));';

    $skript = tempnam(sys_get_temp_dir(), 'avm_ladeweg_') ?: '';
    if ($skript === '') {
        fwrite(STDERR, "FATAL: keine temporaere Datei anlegbar.\n");
        exit(2);
    }
    file_put_contents($skript, implode("\n", $zeilen) . "\n");

    $befehl = escapeshellarg(PHP_BINARY)
        . ' -d extension=php_mbstring.dll'
        . ' ' . escapeshellarg($skript) . ' 2>&1';
    $ausgabe = (string) shell_exec($befehl);
    @unlink($skript);

    $entschluesselt = json_decode(trim($ausgabe), true);
    if (!is_array($entschluesselt)) {
        fwrite(STDERR, "FATAL: Unterprozess lieferte kein JSON. Ausgabe:\n" . $ausgabe . "\n");
        exit(2);
    }

    return array_combine($funktionen, array_map('boolval', $entschluesselt));
};

$gesucht = ['avesmapsWikiSyncFetchCategoryMemberPage', 'avesmapsWikiSyncStripCategoryPrefix'];

// -------------------------------------------------------------- HALBZEIT 1: Wege ---
// Der Ladeweg der Siedlungen: bootstrap + sync + settlements, OHNE locations.php.
// Genau dieser Weg existiert live (api/edit/wiki/settlement-images.php und Geschwister).
$halbzeitSettlements = $imEigenenProzess(
    ['api/_internal/bootstrap.php', 'api/_internal/wiki/sync.php', 'api/_internal/wiki/settlements.php'],
    $gesucht
);
foreach ($gesucht as $funktion) {
    assert(
        $halbzeitSettlements[$funktion] === true,
        $funktion . '() fehlt im Ladeweg settlements.php ohne locations.php -- avesmapsWikiSettlementFetchSubcategories() liefe dort in einen Fatal Error'
    );
}

// -------------------------------------------------------------- HALBZEIT 2: Orte ---
// Der Ladeweg der Orte: bootstrap + sync + locations, OHNE settlements.php.
$halbzeitLocations = $imEigenenProzess(
    ['api/_internal/bootstrap.php', 'api/_internal/wiki/sync.php', 'api/_internal/wiki/locations.php'],
    $gesucht
);
foreach ($gesucht as $funktion) {
    assert(
        $halbzeitLocations[$funktion] === true,
        $funktion . '() fehlt im Ladeweg locations.php ohne settlements.php'
    );
}

// ------------------------------------------------------- Und die Gegenprobe dazu ---
// 🪤 Ohne sie beweisen die zwei Halbzeiten nichts: waere der Baustein in BEIDEN Dateien
// definiert (oder in einer, die beide ohnehin ziehen), waeren sie ebenfalls gruen -- und der
// naechste Umzug zurueck nach locations.php fiele wieder niemandem auf. Diese Probe laedt
// NUR sync.php und verlangt, dass er schon dort steht.
$nurSync = $imEigenenProzess(
    ['api/_internal/bootstrap.php', 'api/_internal/wiki/sync.php'],
    $gesucht
);
foreach ($gesucht as $funktion) {
    assert(
        $nurSync[$funktion] === true,
        $funktion . '() steht nicht in sync.php -- der einzigen Datei, die BEIDE Kategorie-Crawls schon immer brauchen'
    );
}

echo "kategorie-seite-ladeweg: alle Zusicherungen erfuellt (2 Halbzeiten + Gegenprobe)\n";
