<?php

declare(strict_types=1);

// Die Feldherkunft (Aufgabe 3, docs/superpowers/plans/2026-08-17-wiki-override-ort.md).
//
// Run: php -d zend.assertions=1 -d assert.exception=1 api/_internal/map/__tests__/field-origins-test.php

require_once __DIR__ . '/../field-origins.php';

// 🔴 DIE FUENF FELDER DES ORTES, hier eigens genannt und NICHT aus features.php geholt: jene Datei
// zieht ein gutes Dutzend weiterer Bibliotheken nach sich, und dieser Test soll den reinen Rechner
// pruefen, nicht den halben Kartenstapel. Dass die beiden Listen sich decken, prueft die
// Verdrahtungs-Zusicherung ganz unten -- an der echten Datei, nicht an dieser Kopie.
const AVESMAPS_TEST_ORT_FELDER = ['name', 'feature_subtype', 'einwohner', 'lage', 'oberhaupt'];

$fehler = 0;
$pruefe = static function (bool $bedingung, string $was) use (&$fehler): void {
    if (!$bedingung) {
        $fehler++;
        fwrite(STDERR, "ROT: {$was}\n");
    }
};

// ══ 1) 🔴 FALL #72: EIN UNVERAENDERTES FELD WIRD NICHT ANGEFASST ═══════════════════════════════
// Das ist die Haelfte, an der es bei der Literatur schon einmal gescheitert ist: dort stempelt
// avesmapsUpsertGameLiterature jedes MITGESCHICKTE Feld, und das Formular schickt alle mit -- nach
// einem Speichern traegt jedes Feld „von Hand". Ein Formular, das alle fuenf Felder unveraendert
// zurueckschickt, darf hier NICHTS bewirken.
$bestand = ['einwohner' => 'wiki'];
$gleich = avesmapsFieldOriginsStempeln(
    $bestand,
    ['name' => 'Ferdok', 'einwohner' => '5.900', 'lage' => 'Kosch'],
    ['name' => 'Ferdok', 'einwohner' => '5.900', 'lage' => 'Kosch'],
    []
);
$pruefe($gleich === $bestand,
    'ein Speichern ohne Aenderung hat die Herkunft veraendert: ' . json_encode($gleich));

// ══ 2) EINE AENDERUNG OHNE `wiki_uebernommen` IST VON UNS ══════════════════════════════════════
$vonHand = avesmapsFieldOriginsStempeln([], ['einwohner' => '5.900'], ['einwohner' => '6.100'], []);
$pruefe($vonHand === ['einwohner' => 'manual'],
    'eine Aenderung ohne Wiki-Angabe gilt nicht als von Hand: ' . json_encode($vonHand));

// ══ 3) EINE AENDERUNG MIT `wiki_uebernommen` KAM AUS DEM WIKI ══════════════════════════════════
$ausWiki = avesmapsFieldOriginsStempeln([], ['einwohner' => '6.100'], ['einwohner' => '5.900'], ['einwohner']);
$pruefe($ausWiki === ['einwohner' => 'wiki'],
    'eine genannte Wiki-Uebernahme wurde nicht als solche gestempelt: ' . json_encode($ausWiki));

// ══ 4) 💣 DIE SICHERE RICHTUNG: FEHLT DER SCHLUESSEL, IST ALLES VON UNS ════════════════════════
// Eine falsche 'wiki'-Angabe liesse einen spaeteren Abgleich eine Handarbeit ueberschreiben
// (Datenverlust); eine falsche 'manual'-Angabe schuetzt nur zu viel. Genau das trifft die
// Ladeluecke aus AGENTS.md §7: eine gecachte Oberflaeche, die den Schluessel noch nicht kennt.
$ohneSchluessel = avesmapsFieldOriginsAusWikiLesen(['name' => 'Ferdok'], AVESMAPS_TEST_ORT_FELDER);
$pruefe($ohneSchluessel === [], 'ein fehlender Schluessel liefert keine leere Liste');
$leerGestempelt = avesmapsFieldOriginsStempeln([], ['name' => 'Alt'], ['name' => 'Neu'], $ohneSchluessel);
$pruefe($leerGestempelt === ['name' => 'manual'],
    'ohne Wiki-Angabe wurde nicht auf „von uns" zurueckgefallen: ' . json_encode($leerGestempelt));

// ══ 5) 💣 `$ausWiki` WIRD GEFILTERT, NIE ROH UEBERNOMMEN ═══════════════════════════════════════
// Ein Client, der ein fremdes Feld hineinschriebe, darf keine Herkunft fuer etwas setzen, das gar
// kein Wiki-Feld ist -- die Karte waere danach mit Eintraegen verstopft, die kein Leser
// nachschlaegt, und der naechste Leser haelt sie fuer eine Regel.
$gefiltert = avesmapsFieldOriginsAusWikiLesen(
    ['wiki_uebernommen' => ['einwohner', 'geometry', 'is_hidden', 'einwohner']],
    AVESMAPS_TEST_ORT_FELDER
);
$pruefe($gefiltert === ['einwohner'],
    'die Feldliste wurde nicht gefiltert/entdoppelt: ' . json_encode($gefiltert));

// Kein Array -> leere Liste, kein Werfen.
$pruefe(avesmapsFieldOriginsAusWikiLesen(['wiki_uebernommen' => 'einwohner'], AVESMAPS_TEST_ORT_FELDER) === [],
    'ein nicht-Array in wiki_uebernommen wird nicht verworfen');

// ══ 6) `null` UND `''` SIND DASSELBE ═══════════════════════════════════════════════════════════
// Sonst meldete ein frisch angelegter Ort bei jedem Speichern Aenderungen, die niemand vorgenommen
// hat -- wortgleich zur Normalisierung im Browser (avesmapsWikiAssignDiffNormalize).
$leerGleich = avesmapsFieldOriginsStempeln([], ['oberhaupt' => null], ['oberhaupt' => ''], []);
$pruefe($leerGleich === [], 'null gegen "" wurde als Aenderung gewertet: ' . json_encode($leerGleich));
$raender = avesmapsFieldOriginsStempeln([], ['einwohner' => '  5.900 '], ['einwohner' => '5.900'], []);
$pruefe($raender === [], 'die Raender werden beim Vergleich nicht beschnitten: ' . json_encode($raender));

// ══ 7) EIN UNBEKANNTER HERKUNFTSWERT IM BESTAND FAELLT HERAUS ══════════════════════════════════
// Dieselbe Strenge wie im Browser: eine kuenftige dritte Herkunft darf weder sperren noch vorhaken.
$fremd = avesmapsFieldOriginsStempeln(['einwohner' => 'community', 'lage' => 'wiki'], [], [], []);
$pruefe($fremd === ['lage' => 'wiki'], 'ein unbekannter Herkunftswert wurde durchgereicht: ' . json_encode($fremd));

// ══ 8) EIN GELEERTES FELD IST EINE AENDERUNG ═══════════════════════════════════════════════════
// „Der Herrscher ist nicht mehr im Amt" ist eine Entscheidung wie jede andere und muss festgehalten
// werden -- sonst behielte das Feld die Herkunft seines geloeschten Werts.
$geleert = avesmapsFieldOriginsStempeln(['oberhaupt' => 'wiki'], ['oberhaupt' => 'Growin'], ['oberhaupt' => ''], []);
$pruefe($geleert === ['oberhaupt' => 'manual'],
    'das Leeren eines Feldes wurde nicht gestempelt: ' . json_encode($geleert));

// ══ 9) 💣 DIE VERDRAHTUNG -- ZUR LAUFZEIT GEZAEHLT, OHNE ZAHL IM KOMMENTAR ═════════════════════
// Die Falle vom 14.08.2026 (Verkehrsmittel-Sperre in zwei von vier Erzeugern) und ihre Lehre: „die
// ZAHL im Kommentar war das Problem" -- sie liest sich wie eine vollstaendige Liste, also sucht
// niemand weiter. Hier steht deshalb KEINE Zahl. Gesucht wird jede Funktion im api/-Baum, die
// avesmapsApplyPointWikiFields ruft (die EINZIGE Stelle, die die Wiki-Textfelder eines Ortes
// kennt); jede von ihnen muss auch stempeln.
//
// ⚠️ UND DAS IST EINE TEXTPROBE, mit allem was das heisst: sie misst die FORM des Codes, nicht sein
// Verhalten -- ein Aufruf in einem `try { … } catch { }` erfuellt sie und tut nichts. Was sie
// wirklich faengt, ist der Fall, um den es geht: ein NEUER Schreibweg, der den Stempel schlicht
// vergisst. Das Verhalten selbst haengt am Ablauf in der Oberflaeche (Abnahmeschritt 4 im Entwurf).
$wurzel = dirname(__DIR__, 4);
$dateien = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($wurzel, FilesystemIterator::SKIP_DOTS));
$schreibwege = [];
foreach ($dateien as $datei) {
    if ($datei->getExtension() !== 'php' || str_contains($datei->getPathname(), '__tests__')) {
        continue;
    }
    $quelle = (string) file_get_contents($datei->getPathname());
    if (!str_contains($quelle, 'avesmapsApplyPointWikiFields(')) {
        continue;
    }
    // Die Funktion, in der der Aufruf steht -- die letzte `function …` davor.
    foreach (explode("\n", $quelle) as $nr => $zeile) {
        if (!str_contains($zeile, 'avesmapsApplyPointWikiFields(') || str_contains($zeile, 'function avesmapsApplyPointWikiFields')) {
            continue;
        }
        $kopf = '';
        $zeilen = explode("\n", $quelle);
        for ($i = $nr; $i >= 0; $i--) {
            if (preg_match('/^function\s+(\w+)/', $zeilen[$i], $treffer) === 1) {
                $kopf = $treffer[1];
                break;
            }
        }
        if ($kopf !== '') {
            $schreibwege[$kopf] = $datei->getPathname();
        }
    }
}
$pruefe($schreibwege !== [], 'kein einziger Schreibweg gefunden -- die Probe misst nichts');
foreach ($schreibwege as $funktion => $pfad) {
    $quelle = (string) file_get_contents($pfad);
    $von = strpos($quelle, "function {$funktion}(");
    $rumpf = $von === false ? '' : substr($quelle, $von, 12000);
    $pruefe(str_contains($rumpf, 'avesmapsFieldOriginsStempeln('),
        "der Schreibweg {$funktion} schreibt Wiki-Felder eines Ortes, stempelt aber keine Herkunft");
}

// ══ 11) 🔴 DIE LITERATUR: WAS DIE REPARATUR TUT -- UND WAS SIE NICHT TUT ══════════════════════
// avesmapsUpsertGameLiterature stempelte bis zum 17.08.2026 JEDES mitgeschickte Feld auf 'manual',
// und das Formular schickt alle mit. Diese zwei Zusicherungen halten beide Haelften fest.
$literaturFelder = ['title', 'genre', 'authors'];
// (a) Ein Speichern, das nur den Titel aendert, laesst die uebrigen Felder in Ruhe.
$literatur = avesmapsFieldOriginsStempeln(
    [],
    ['title' => 'Madas Kelch', 'genre' => 'Mystik', 'authors' => 'Anton Weste'],
    ['title' => 'Madas Kelch (neu)', 'genre' => 'Mystik', 'authors' => 'Anton Weste'],
    []
);
$pruefe($literatur === ['title' => 'manual'],
    'ein Speichern stempelt weiterhin alle mitgeschickten Felder: ' . json_encode($literatur));

// (b) 💣 UND SIE HEILT NICHT RUECKWIRKEND. Eine Zeile, die heute ueberall 'manual' traegt, behaelt
// das -- der Stempler SETZT nur, er loescht nie. Das ist gewollt: eine stille Massen-Entsperrung
// liesse den naechsten Abgleich ueber Werte laufen, die jemand fuer geschuetzt hielt. Der Weg
// zurueck ist das ↺ an der Feldzeile, und der ist eine Entscheidung, kein Nebeneffekt.
$altbestand = ['title' => 'manual', 'genre' => 'manual', 'authors' => 'manual'];
$nachSpeichern = avesmapsFieldOriginsStempeln(
    $altbestand,
    ['title' => 'A', 'genre' => 'Mystik', 'authors' => 'X'],
    ['title' => 'B', 'genre' => 'Mystik', 'authors' => 'X'],
    []
);
$pruefe($nachSpeichern === $altbestand,
    'die Reparatur hat rueckwirkend entsperrt -- der naechste Abgleich liefe ueber geschuetzte Werte: '
    . json_encode($nachSpeichern));
// Und das ↺ ist der Weg zurueck: das Feld wird als Wiki-Uebernahme genannt -> Herkunft 'wiki'.
$mitReset = avesmapsFieldOriginsStempeln($altbestand,
    ['genre' => 'Krimi'], ['genre' => 'Mystik'], ['genre']);
$pruefe(($mitReset['genre'] ?? '') === 'wiki',
    'das ↺ befreit ein handgesetztes Feld nicht: ' . json_encode($mitReset));

// ══ 10) 🔴 DIE FELDLISTE DECKT SICH MIT DER DES BROWSERS ══════════════════════════════════════
// Weichen sie ab, zeigt der Editor eine Zeile, deren Herkunft niemand fortschreibt -- oder der
// Server fuehrt eine Herkunft fuer ein Feld, das keine Zeile hat. Verglichen wird gegen die ECHTEN
// Dateien, nicht gegen die Kopie oben.
$leseListe = static function (string $pfad, string $muster): array {
    $quelle = (string) file_get_contents($pfad);
    if (preg_match($muster, $quelle, $treffer) !== 1) {
        return [];
    }
    preg_match_all('/["\']([a-z_]+)["\']/', $treffer[1], $namen);
    return $namen[1];
};
$serverFelder = $leseListe($wurzel . '/api/_internal/map/features.php',
    '/const AVESMAPS_POINT_WIKI_ORIGIN_FIELDS\s*=\s*\[(.*?)\];/s');
$browserFelder = $leseListe($wurzel . '/js/ui/wiki-assign-ort.js',
    '/const AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER\s*=\s*\[(.*?)\];/s');
sort($serverFelder);
sort($browserFelder);
$pruefe($serverFelder !== [] && $serverFelder === $browserFelder,
    'Server- und Browser-Feldliste des Ortes weichen ab: '
    . json_encode($serverFelder) . ' gegen ' . json_encode($browserFelder));
$erwartet = AVESMAPS_TEST_ORT_FELDER;
sort($erwartet);
$pruefe($serverFelder === $erwartet,
    'die Feldliste dieses Tests ist veraltet: ' . json_encode($serverFelder));

if ($fehler > 0) {
    fwrite(STDERR, "field-origins: {$fehler} Zusicherung(en) verletzt\n");
    exit(1);
}
echo 'field-origins: alle Zusicherungen erfuellt (' . count($schreibwege) . " Schreibweg(e) gezaehlt)\n";
