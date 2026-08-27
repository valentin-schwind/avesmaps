<?php

declare(strict_types=1);

// 🔴 DER IMPORTER IST EIN GERUEST UND WIRD WIEDER ABGEBAUT (Auftrag §5.5).
// Nichts ausserhalb von api/_internal/import/ darf `garetien_import_row` oder
// `garetien_import_run` kennen -- kein Fremdschluessel, kein JOIN, kein Filter, keine Anzeige,
// kein Test einer Nutzoberflaeche. Dasselbe Muster wie editor-row-single-source.test.js und
// sync-plan-purity-test.php; das Haus fuehrt solche Waechter bereits.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 api/_internal/import/__tests__/garetien-abbau-waechter-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4);
$erlaubt = 'api/_internal/import/';

// 💣 NUR VERFOLGTE DATEIEN. Ein repoweiter Verzeichnis-Scan liest die ungetrackte Sonde mit, die
// jemand gerade im Arbeitsbaum liegen hat -- der Test ist dann LOKAL rot und im Repo gruen, und
// die naechste Sitzung sucht einen Fehler, den es nicht gibt.
$verfolgt = [];
exec('git -C ' . escapeshellarg($wurzel) . ' ls-files -z', $roh, $code);
assert($code === 0, 'git ls-files ist fehlgeschlagen -- der Waechter kann so nichts belegen');
foreach (explode("\0", implode("\n", $roh)) as $pfad) {
    $pfad = trim($pfad);
    if ($pfad !== '') {
        $verfolgt[] = $pfad;
    }
}
assert(count($verfolgt) > 100, 'die Dateiliste ist unglaubwuerdig kurz: ' . count($verfolgt));

// ⚠️ Nur ausfuehrbarer Code und Markup. Doku DARF die Tabellen nennen -- der Auftrag und dieser
// Plan tun es auf jeder zweiten Seite, und ein Waechter, der Prosa verbietet, wird abgeschaltet.
$endungen = ['php', 'js', 'mjs', 'css', 'html', 'sql', 'yml', 'yaml'];
$treffer = [];
foreach ($verfolgt as $pfad) {
    $normal = str_replace('\\', '/', $pfad);
    if (str_starts_with($normal, $erlaubt)) {
        continue;
    }
    if (!in_array(strtolower(pathinfo($normal, PATHINFO_EXTENSION)), $endungen, true)) {
        continue;
    }
    $inhalt = @file_get_contents($wurzel . '/' . $normal);
    if ($inhalt !== false && str_contains($inhalt, 'garetien_import')) {
        $treffer[] = $normal;
    }
}

assert($treffer === [], "Der Importer ist festgewachsen. Diese Dateien ausserhalb von "
    . "{$erlaubt} kennen garetien_import_run/-row:\n  " . implode("\n  ", $treffer)
    . "\nDer Abbau (Auftrag §5.5) wuerde sie als Waisen zuruecklassen. Der richtige Griff fuer "
    . "\"woher kam das\" ist feature_sources.origin = 'garetien' -- der ueberlebt den Abbau.");

// 🪤 GEGENPROBE: ein Waechter, der nichts findet, weil er nichts SUCHT, ist gruen und wertlos.
// Genau daran ist am 26.08.2026 ein Testfeld-Lauf gescheitert (leere Ergebnisdatei, eine
// Sekunde Laufzeit, "null rot"). Deshalb wird hier belegt, dass der Scan die Dateien, in denen
// die Tabellen STEHEN DUERFEN, auch wirklich liest.
$drinnen = 0;
foreach ($verfolgt as $pfad) {
    $normal = str_replace('\\', '/', $pfad);
    if (str_starts_with($normal, $erlaubt) && str_ends_with($normal, '.php')
        && str_contains((string) @file_get_contents($wurzel . '/' . $normal), 'garetien_import')) {
        $drinnen++;
    }
}
assert($drinnen >= 3, 'der Waechter findet die Tabellen nicht einmal DORT, wo sie stehen duerfen '
    . "(gefunden: {$drinnen}) -- er sucht also gar nichts");

echo "OK: garetien_import steht in {$drinnen} Dateien, alle innerhalb von {$erlaubt}.\n";
