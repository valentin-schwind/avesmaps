<?php

declare(strict_types=1);

/**
 * DIE EDITOREN GEBEN KEINE WIKI-BILDADRESSE MEHR AUS. Kein Netz, keine DB. Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/editor-wappen-nur-lokal-test.php
 *
 * 🔴 Owner 24.08.2026, mit der Konsole von „Orte bearbeiten" voller 503er: "orte bearbeiten
 * versucht noch immer wappen aus dem wiki zu ziehen, obwohl wir das strengenstens untersagt
 * hatte ... BAU DAS AUS."
 *
 * 🪤 DIESER TEST EXISTIERT WEGEN EINER RUECKNAHME, DEREN BEGRUENDUNG FALSCH WAR. Am 23.08.2026
 * wurde `avesmapsCoatLokaleKopie` aus den Editor-Ausgaben wieder entfernt, weil sie angeblich
 * „jedes Wappen verschwinden laesst, das nur ueber den Zwischenspeicher (api/app/coat.php)
 * erreichbar ist". Solche Wappen gibt es nicht: coat.php beantwortet einen Cache-TREFFER aus
 * demselben Ordner, mit demselben sha1-Schluessel und derselben Endungsliste, in die diese
 * Funktion schaut. Abschnitt 1 rechnet das gegen den QUELLTEXT von coat.php nach, damit die
 * naechste Ruecknahme an einer Messung scheitert und nicht an einer Erinnerung.
 *
 * Abschnitt 2 prueft, dass jede Editor-AUSGABE die Funktion auch wirklich ruft. Zwei Vorkehrungen,
 * beide aus Schaden geboren:
 *   💣 gesucht wird im kommentarfreien Quelltext -- beide Dateikoepfe NENNEN die Funktion
 *      ausfuehrlich, ohne sie zu rufen (Hausrezept: sync-monitor-endpoint-chain-test.php);
 *   💣 gesucht wird im RUMPF DER GENANNTEN FUNKTION, und das Muster muss dort GENAU EINMAL
 *      vorkommen. Die erste Fassung dieses Tests suchte in der ganzen Datei und traf mit
 *      `'coat_url' =>` die falsche der vier Fundstellen -- eine Zusicherung, die auf den
 *      erstbesten Treffer zeigt, prueft irgendetwas, nur nicht ihr Subjekt.
 *
 * Abschnitt 3 mutiert den Quelltext und verlangt, dass Abschnitt 2 daran umfaellt.
 * Abschnitt 4 haelt fest, welche Stellen bewusst UNgefiltert bleiben: die Fuell- und
 * Schreibwege. Der Staging-Wert ist die Information „das Wiki nennt diese Datei" -- er wird beim
 * naechsten Abgleich gebraucht, gebunden ist nur die AUSGABE.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- "
        . "assert() waere ein No-Op und dieser Test meldete falsche Erfolge.\n"
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

$apiRoot = dirname(__DIR__, 3);          // …/api/_internal/wiki/__tests__ -> …/api
require $apiRoot . '/_internal/coat-url.php';

// ---------------------------------------------------------------------------------------------
// 1. DIE TRAGENDE BEHAUPTUNG: was coat.php aus dem Cache liefern koennte, findet die Funktion.
// ---------------------------------------------------------------------------------------------
$coatPhp = (string) file_get_contents($apiRoot . '/app/coat.php');
assert($coatPhp !== '', 'coat.php ist lesbar');

// Ordner und Schluessel ABGELESEN, nicht abgeschrieben -- eine abgeschriebene Erwartung bliebe
// gruen, wenn coat.php seinen Cache verlegt, und die Funktion faende danach lautlos nichts mehr.
assert(preg_match('/\$dir = \$docroot \. \'([^\']+)\';/', $coatPhp, $dirMatch) === 1,
    'coat.php nennt sein Cache-Verzeichnis in einer lesbaren Zeile');
$cacheDir = $dirMatch[1];
assert($cacheDir === '/uploads/wappen/cache', 'Cache-Verzeichnis unveraendert: ' . $cacheDir);
assert(str_contains($coatPhp, '$key = sha1($url);'),
    'coat.php bildet den Cache-Schluessel weiterhin als sha1($url)');

// Die Endungen, die coat.php im Cache SUCHT (AVESMAPS_COAT_EXT_TYPES, ohne den Alias 'jpeg' --
// gespeichert wird jpeg als jpg, siehe avesmapsCoatExtFromType).
assert(preg_match('/const AVESMAPS_COAT_EXT_TYPES = \[(.*?)\];/s', $coatPhp, $extMatch) === 1,
    'die Endungstabelle von coat.php ist lesbar');
preg_match_all("/'([a-z]+)' =>/", $extMatch[1], $extNames);
$coatExts = array_values(array_diff($extNames[1], ['jpeg']));
assert(count($coatExts) >= 5, 'die Endungsliste wurde gefunden (' . implode(',', $coatExts) . ')');

$root = sys_get_temp_dir() . '/avesmaps-editor-wappen-' . bin2hex(random_bytes(4));
@mkdir($root . $cacheDir, 0775, true);
$_SERVER['DOCUMENT_ROOT'] = $root;

// 💣 JEDE Endung einzeln: faende die Funktion nur vier der fuenf, verschwaende genau der Bestand
// mit der fuenften -- lautlos, ohne Fehler, und es saehe nach „das Wiki hat das Bild nicht" aus.
foreach ($coatExts as $ext) {
    $url = 'https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/Wappen%20Probe%20' . $ext . '.' . $ext;
    $key = sha1($url);
    assert(avesmapsCoatLokaleKopie($url) === '',
        "ohne Datei liefert die Funktion NICHTS -- nie die Wiki-Adresse ({$ext})");
    file_put_contents($root . $cacheDir . '/' . $key . '.' . $ext, 'BYTES');
    assert(avesmapsCoatLokaleKopie($url) === $cacheDir . '/' . $key . '.' . $ext,
        "ein Cache-TREFFER geht NIE verloren -- genau das war die falsche Begruendung der "
        . "Ruecknahme vom 23.08.2026 (Endung {$ext})");
}

// Und die Kehrseite: was sie liefert, ist statisch. Kein coat.php, also keine PHP-Anfrage je Bild.
$probe = avesmapsCoatLokaleKopie('https://de.wiki-aventurica.de/wiki/Spezial:Dateipfad/Wappen%20Probe%20png.png');
assert(!str_contains($probe, 'coat.php'), 'der Treffer wird statisch ausgeliefert');
assert(!str_contains($probe, 'wiki-aventurica'), 'und traegt die Wiki-Adresse nicht im Pfad');

echo "1) Cache-Treffer gehen nie verloren, Cache-Fehltreffer nennen das Wiki nicht ok\n";

// ---------------------------------------------------------------------------------------------
// 2. JEDE EDITOR-AUSGABE GEHT DURCH DIE FUNKTION.
// ---------------------------------------------------------------------------------------------
/**
 * Rumpf EINER Funktion, ohne Kommentare. Ueber die Tokenliste, nicht per Klammerzaehlung im
 * Rohtext: eine geschweifte Klammer in einer Zeichenkette wuerde die sonst mitzaehlen.
 */
$funktionsRumpf = static function (string $roh, string $name): string {
    $tokens = token_get_all($roh);
    $anzahl = count($tokens);
    for ($i = 0; $i < $anzahl; $i++) {
        $token = $tokens[$i];
        if (!is_array($token) || $token[0] !== T_FUNCTION) {
            continue;
        }
        // Der Name steht nach dem Schluesselwort, getrennt nur durch Leerraum.
        $j = $i + 1;
        while ($j < $anzahl && is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) {
            $j++;
        }
        if ($j >= $anzahl || !is_array($tokens[$j]) || $tokens[$j][0] !== T_STRING || $tokens[$j][1] !== $name) {
            continue;
        }
        $tiefe = 0;
        $rumpf = '';
        $offen = false;
        for ($k = $j; $k < $anzahl; $k++) {
            $t = $tokens[$k];
            if (is_array($t)) {
                if ($t[0] === T_COMMENT || $t[0] === T_DOC_COMMENT) {
                    continue;
                }
                // Interpolierte Klammern ({$x}) heben die Tiefe nicht -- sie kommen als
                // eigene Tokentypen, nicht als blankes '{'.
                if ($offen) {
                    $rumpf .= $t[1];
                }
                continue;
            }
            if ($t === '{') {
                $tiefe++;
                $offen = true;
                continue;
            }
            if ($t === '}') {
                $tiefe--;
                if ($tiefe === 0) {
                    return $rumpf;
                }
            }
            if ($offen) {
                $rumpf .= $t;
            }
        }
    }
    return '';
};

/**
 * Eine Ausgabestelle: Datei, Funktion, das Muster, an dem sie zu erkennen ist, und ihr Name.
 * ⚠️ Das Muster ist so gewaehlt, dass es OHNE den Funktionsaufruf ebenfalls dastuende -- sonst
 * prueft der Test nur, ob sein eigenes Suchmuster noch passt.
 */
// Felder: Datei · Funktion · Muster · erwartete Trefferzahl · was eine Zeile erfuellen darf · Name.
// 💣 „erwartete Trefferzahl" ist tragend: `'coat_url' =>` steht in avesmapsWikiSettlementEditorList
// ZWEIMAL (Kartenzeile und reine Registry-Zeile). Ohne die Zahl prueft der Test eine davon und
// laesst die andere ungesehen -- genau so ist diese Datei beim ersten Lauf gruen geworden, obwohl
// sie die falsche Stelle ansah.
// ⚠️ `$coatUrl` als erlaubte Erfuellung ist kein Schlupfloch: dass DIESE Variable gefiltert ist,
// steht als eigene Zeile eins darueber in der Liste.
$stellen = [
    ['wiki/settlements.php', 'avesmapsWikiSettlementEditorList', '$coatUrl = $hasCoat ?', 1,
        ['avesmapsCoatLokaleKopie('], 'Ortsliste: das uebernommene Wappen'],
    ['wiki/settlements.php', 'avesmapsWikiSettlementEditorList', "'coat_url' =>", 2,
        ['avesmapsCoatLokaleKopie(', '$coatUrl'], 'Ortsliste: beide Zeilenarten'],
    ['wiki/settlements.php', 'avesmapsWikiSettlementDetail', "\$properties['coat']['url'] =", 1,
        ['avesmapsCoatLokaleKopie('], 'Detailkopf: das uebernommene Wappen'],
    ['wiki/settlements.php', 'avesmapsWikiSettlementDetail', "\$properties['wiki_settlement']['wappen_url'] =", 1,
        ['avesmapsCoatLokaleKopie('], 'Detailkopf: der Rueckfall aufs Wiki-Nest'],
    ['wiki/sync-monitor-tree.php', 'avesmapsWikiSyncMonitorModelTree', "'coat_of_arms_url' =>", 1,
        ['avesmapsCoatLokaleKopie('], 'Territorienbaum (model_tree)'],
    ['wiki/sync-monitor-tree.php', 'avesmapsWikiSyncMonitorModelTree', "\$overrides['coat_of_arms_url'] =", 1,
        ['avesmapsCoatLokaleKopie('], 'Territorienbaum: der Override, der das Staging-Feld schlaegt'],
    ['wiki/sync-monitor-tree.php', 'avesmapsWikiSyncMonitorWikiRows', "'coat_of_arms_url' =>", 2,
        ['avesmapsCoatLokaleKopie('], 'Wiki-Zeilen-Ansicht: Staging und eigener Knoten'],
];

/** Prueft alle Stellen gegen einen (ggf. mutierten) Vorrat an Funktionsrumpfen. */
$pruefe = static function (array $rumpfe) use ($stellen): array {
    $fehler = [];
    foreach ($stellen as [$datei, $funktion, $nadel, $erwartet, $erlaubt, $name]) {
        $rumpf = $rumpfe[$datei . '::' . $funktion];
        $treffer = substr_count($rumpf, $nadel);
        if ($treffer !== $erwartet) {
            $fehler[] = "{$name}: das Muster kommt {$treffer}x in {$funktion}() vor, erwartet {$erwartet}x -- "
                . 'eine neue Ausgabe gehoert in diese Liste, eine verschwundene daraus entfernt.';
            continue;
        }
        $offset = 0;
        for ($n = 0; $n < $erwartet; $n++) {
            $pos = strpos($rumpf, $nadel, $offset);
            // Der Ausdruck endet am Zeilenende. Ein fester Zeichenabstand las am 23.08.2026 die
            // naechste Zeile mit und machte aus einer richtigen Regel einen Fehlalarm.
            $ende = strpos($rumpf, "\n", $pos);
            $zeile = substr($rumpf, $pos, ($ende === false ? strlen($rumpf) : $ende) - $pos);
            $offset = $pos + strlen($nadel);
            $ok = false;
            foreach ($erlaubt as $form) {
                if (str_contains($zeile, $form)) {
                    $ok = true;
                    break;
                }
            }
            if (!$ok) {
                $fehler[] = "{$name}: gibt die Adresse ungefiltert aus ({$datei}): " . trim($zeile);
            }
        }
    }
    return $fehler;
};

$rumpfe = [];
foreach ($stellen as [$datei, $funktion]) {
    $schluessel = $datei . '::' . $funktion;
    if (isset($rumpfe[$schluessel])) {
        continue;
    }
    $roh = (string) file_get_contents($apiRoot . '/_internal/' . $datei);
    assert($roh !== '', "{$datei} ist lesbar");
    $rumpf = $funktionsRumpf($roh, $funktion);
    assert($rumpf !== '', "{$funktion}() wurde in {$datei} gefunden");
    assert(!str_contains($rumpf, 'HIER STAND'),
        "{$funktion}(): die Kommentare sind wirklich weg -- sonst beantwortet ein Kommentar die Frage");
    $rumpfe[$schluessel] = $rumpf;
}

$fehler = $pruefe($rumpfe);
assert($fehler === [], "ungefilterte Wappen-Ausgabe:\n  - " . implode("\n  - ", $fehler));
$geprueft = array_sum(array_column($stellen, 3));
assert($geprueft === 9, 'neun Ausgabezeilen stehen unter Aufsicht, gezaehlt: ' . $geprueft);

echo "2) alle {$geprueft} Editor-Ausgabezeilen gehen durch avesmapsCoatLokaleKopie ok\n";

// ---------------------------------------------------------------------------------------------
// 3. GEGENPROBE: ohne den Aufruf muss Abschnitt 2 UMFALLEN -- je Funktion einzeln.
// ---------------------------------------------------------------------------------------------
foreach ($rumpfe as $schluessel => $rumpf) {
    $mutiert = $rumpfe;
    $mutiert[$schluessel] = str_replace('avesmapsCoatLokaleKopie(', 'avesmapsRohAusgabe(', $rumpf);
    assert($mutiert[$schluessel] !== $rumpf, "die Mutation ist in {$schluessel} ueberhaupt angekommen");
    $mutFehler = $pruefe($mutiert);
    assert($mutFehler !== [],
        "OHNE den Aufruf meldet Abschnitt 2 in {$schluessel} nichts -- die Zusicherung ist stumpf");
}

echo "3) die Zusicherung faellt ohne den Aufruf um ok\n";

// ---------------------------------------------------------------------------------------------
// 4. WAS BEWUSST UNGEFILTERT BLEIBT: die Fuell- und Schreibwege.
// ---------------------------------------------------------------------------------------------
// 🔴 Der Parser BAUT die Wiki-Adresse, der Anreicherungslauf SCHREIBT sie in die Registry. Beides
// muss roh bleiben: die gespeicherte Adresse ist die Information „das Wiki nennt diese Datei", und
// ohne sie koennte der Lokalisierer das Bild nie holen. Gebunden ist die AUSGABE, nicht der Wert.
// ⚠️ Diese Zusicherung ist absichtlich anders herum -- sie faellt um, wenn jemand aus lauter Eifer
// auch die Fuellstelle filtert und damit den Nachschub abschneidet.
$settlementsRoh = (string) file_get_contents($apiRoot . '/_internal/wiki/settlements.php');
$fuellRumpf = $funktionsRumpf($settlementsRoh, 'avesmapsWikiSettlementBuildEnrichment');
assert($fuellRumpf !== '', 'die Fuellstelle wurde gefunden');
assert(str_contains($fuellRumpf, 'avesmapsWikiSyncMonitorCoatOfArmsUrl('),
    'die Fuellstelle baut weiterhin die Wiki-Adresse');
assert(!str_contains($fuellRumpf, 'avesmapsCoatLokaleKopie('),
    'und filtert sie NICHT -- sonst stuende in der Registry nichts mehr, was der Lokalisierer holen koennte');

echo "4) Fuell- und Schreibweg bleiben roh ok\n";
echo "ALL OK\n";
