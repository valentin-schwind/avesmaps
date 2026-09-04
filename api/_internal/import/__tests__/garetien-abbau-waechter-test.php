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

// ⚠️ Nur ausfuehrbarer Code und Markup. Doku DARF die Tabellen nennen -- der Auftrag, der Bauplan
// und das Mockup tun es auf jeder zweiten Seite, und ein Waechter, der Prosa verbietet, wird
// abgeschaltet.
//
// 🔴 REVIEW-FUND I2 (27.08.2026): die ENDUNG ist dafuer das falsche Kriterium. `docs/
// garetien-importer-mockup.html` -- das freigegebene Mockup zu genau diesem Vorhaben -- nennt
// die Tabellennamen mehrfach und traegt `.html`, dieselbe Endung wie echtes Markup im Produkt.
// `.md` auszunehmen und `.html` nicht ist eine Unterscheidung ohne Unterschied: beide sind Doku,
// wenn sie unter `docs/` liegen. Solange das Mockup ungetrackt ist, rettet `git ls-files` den
// Waechter zufaellig -- eingecheckt (und es WIRD eingecheckt) waere er sonst grundlos rot, und
// ein Waechter, der grundlos rot wird, wird abgeschaltet und fehlt dann, wenn er gebraucht wird.
// Das richtige Kriterium ist das VERZEICHNIS, nicht die Endung.
//
// 🔴 NACHTRAG 04.09.2026: `sql/` gehoert zu DERSELBEN Klasse und kam am selben Tag dazu.
// `b60b4422a` checkte `sql/garetien-import-staging-bestand.sql` ein -- eine Bestandsabfrage zum
// Hineinkopieren in phpMyAdmin -- und legte damit das Deploy-Tor fuer ALLE lahm (Lauf
// 33898645595, Schritt "Run the unit tests"). Die Begruendung ist woertlich dieselbe wie bei
// `docs/`: nichts im Produkt liest `sql/` zur Laufzeit -- AGENTS.md §5 nennt es "a partial,
// partly-stale snapshot", und die einzigen Fundstellen im Code sind Kommentare. Eine Datei, die
// nur ein Mensch nach phpMyAdmin kopiert, kann den Importer nicht festwachsen lassen: sie hat
// keinen Fremdschluessel, keinen JOIN und keinen Aufrufer.
// ⚠️ Scharf bleibt der Waechter damit fuer alles, was WIRKLICH koppelt -- Code, Markup und
// Konfiguration ausserhalb von api/_internal/import/.
$dokuVerzeichnisse = ['docs/', 'sql/'];
$endungen = ['php', 'js', 'mjs', 'css', 'html', 'sql', 'yml', 'yaml'];
$treffer = [];
foreach ($verfolgt as $pfad) {
    $normal = str_replace('\\', '/', $pfad);
    $istDoku = false;
    foreach ($dokuVerzeichnisse as $dokuVerzeichnis) {
        if (str_starts_with($normal, $dokuVerzeichnis)) {
            $istDoku = true;
            break;
        }
    }
    if (str_starts_with($normal, $erlaubt) || $istDoku) {
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
