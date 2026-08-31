<?php

declare(strict_types=1);

/**
 * Die ZWEITE Variante des Abzugs: die geglaettete Fassung (Bezier statt Stuetzpunkt-Polygone).
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/svg-export-glatt-test.php
 *
 * 🔴 PHP BAUT NICHT, ES LAGERT. Eine geglaettete Fassung kann kein Anfrageparameter erzeugen --
 * sie muss als eigene Datei hinterlegt werden. Geprueft wird deshalb genau das: dass zwei
 * Ablagen nebeneinander bestehen koennen, ohne sich gegenseitig wegzuraeumen.
 *
 * Der ECHTE HTTP-Ablauf (?smooth=1, 200/304/404) laeuft ueber
 * tools/svg-export/__tests__/endpunkt-ablauf.js gegen einen `php -S`.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../svg-export-ablage.php';
require __DIR__ . '/../svg-export-hinterlegen.php';

$ROH = AVESMAPS_SVG_EXPORT_VARIANTE_ROH;
$GLATT = AVESMAPS_SVG_EXPORT_VARIANTE_GLATT;

// ---- 1. Der Anfrageparameter -----------------------------------------------------------------
// ⚠️ Streng gelesen: nur `1` und `true` schalten um. Ein Tippfehler (`smooth=ja`, `smooth=yes`)
// darf nicht STILL die rohe Fassung liefern und dabei aussehen, als haette er gewirkt --
// aber er darf auch keinen 500 ausloesen. Er faellt auf `roh` zurueck, und die
// Wurzelattribute der Datei sagen dem Aufrufer dann die Wahrheit.
assert(avesmapsSvgExportVarianteAusAnfrage([]) === $ROH, 'ohne Parameter: roh');
assert(avesmapsSvgExportVarianteAusAnfrage(['smooth' => '1']) === $GLATT);
assert(avesmapsSvgExportVarianteAusAnfrage(['smooth' => 'true']) === $GLATT);
assert(avesmapsSvgExportVarianteAusAnfrage(['smooth' => 'TRUE']) === $GLATT, 'Gross/Klein egal');
assert(avesmapsSvgExportVarianteAusAnfrage(['smooth' => '0']) === $ROH);
assert(avesmapsSvgExportVarianteAusAnfrage(['smooth' => '']) === $ROH);
assert(avesmapsSvgExportVarianteAusAnfrage(['smooth' => 'ja']) === $ROH, 'unbekannt = roh');
// 💣 Ein Array als Parameter (`?smooth[]=1`) darf keinen TypeError werfen -- das waere ein 500
// auf einem Endpunkt, der eine Datei durchreicht.
assert(avesmapsSvgExportVarianteAusAnfrage(['smooth' => ['1']]) === $ROH, 'Array ist kein Ja');

// ---- 2. Zwei Ablagen, zwei Namen ---------------------------------------------------------------
assert(avesmapsSvgExportZeigerName($ROH) === 'aktuell.json',
    '🔴 der bestehende Zeiger heisst UNVERAENDERT aktuell.json -- jeder Client, der ihn kennt, '
    . 'und jede alte Ablage auf dem Server haengen daran');
assert(avesmapsSvgExportZeigerName($GLATT) === 'aktuell-glatt.json');

// 💣 GETRENNTE DATEINAMEN SIND TRAGEND, nicht Kosmetik: die Aufraeumung globt `abzug-*.svg`.
// Truege die glatte Fassung denselben Namensraum, raeumte die eine Variante die andere weg --
// und zwar genau dann, wenn beide frisch hinterlegt wurden.
assert(avesmapsSvgExportDateinameGueltig('abzug-0123456789abcdef.svg', $ROH) === true);
assert(avesmapsSvgExportDateinameGueltig('abzug-glatt-0123456789abcdef.svg', $GLATT) === true);
assert(avesmapsSvgExportDateinameGueltig('abzug-glatt-0123456789abcdef.svg', $ROH) === false,
    'die glatte Datei ist fuer die rohe Variante KEIN gueltiger Name');
assert(avesmapsSvgExportDateinameGueltig('abzug-0123456789abcdef.svg', $GLATT) === false,
    'und umgekehrt');
// Der Pfadschutz gilt unveraendert fuer beide.
foreach ([$ROH, $GLATT] as $v) {
    assert(avesmapsSvgExportDateinameGueltig('../../api/config.local.php', $v) === false, 'kein Aufstieg');
    assert(avesmapsSvgExportDateinameGueltig('abzug-glatt-0123456789ABCDEF.svg', $v) === false, 'Hex klein');
    assert(avesmapsSvgExportDateinameGueltig('abzug-glatt-0123.svg', $v) === false, '16 Stellen');
}
// 🔴 Der Vorgabewert ist `roh` -- jeder bestehende Aufrufer ohne Variante meint die alte Ablage.
assert(avesmapsSvgExportDateinameGueltig('abzug-0123456789abcdef.svg') === true, 'Vorgabe ist roh');

// ---- 3. Die Variante kommt aus dem INHALT, nie aus dem Rumpf ----------------------------------
// 🔴 Dieselbe Regel wie bei `X-Avesmaps-Quelle`: was der Aufrufer BEHAUPTET, entscheidet nicht.
// Der Owner haengt auf /edit/svg-export.php seine eigenen Regler an den Abzug; ein Handabzug
// koennte sich sonst als die glatte Routinefassung ausgeben (oder umgekehrt), und der Endpunkt
// lieferte unter `?smooth=1` etwas Eckiges aus.
$kopfRoh = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
    . '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="32768" height="32768"'
    . ' avm:einheit_px="32" avm:geglaettet="nein" avm:flaechen_geglaettet="nein">';
$kopfGlatt = str_replace(['"nein"', '"nein"'], ['"ja"', '"ja"'], $kopfRoh);
assert(avesmapsSvgExportVarianteAusInhalt($kopfRoh) === $ROH);
assert(avesmapsSvgExportVarianteAusInhalt($kopfGlatt) === $GLATT);
// ⚠️ Halb geglaettet (nur Linien, Flaechen roh) zaehlt als GLATT: der Abzug traegt dann
// Bezierkurven, und darum geht es dem Abrufer. Was genau geglaettet ist, sagen die
// Wurzelattribute der Datei selbst -- die Ablage ist eine Schublade, keine zweite Wahrheit.
$kopfHalb = str_replace('avm:geglaettet="nein"', 'avm:geglaettet="ja"', $kopfRoh);
assert(avesmapsSvgExportVarianteAusInhalt($kopfHalb) === $GLATT, 'Linien glatt genuegt');
$kopfNurFlaechen = str_replace('avm:flaechen_geglaettet="nein"', 'avm:flaechen_geglaettet="ja"', $kopfRoh);
assert(avesmapsSvgExportVarianteAusInhalt($kopfNurFlaechen) === $GLATT, 'Flaechen glatt genuegt');
// 💣 Ohne Angabe ist es die ROHE Fassung -- so hat es angefangen, und ein alter Abzug ohne
// Semantik traegt die Attribute gar nicht. Im Zweifel die Schublade, die es schon gab.
assert(avesmapsSvgExportVarianteAusInhalt('<?xml version="1.0"?><svg width="10">') === $ROH);
assert(avesmapsSvgExportVarianteAusInhalt('') === $ROH);
// 💣 GESUCHT WIRD NUR IM WURZELTAG. Ein `avm:geglaettet="ja"` irgendwo im Rumpf -- etwa in
// einem Kommentar oder einer eingebetteten Fremddatei -- darf die Einordnung nicht drehen.
$kopfFalle = $kopfRoh . "\n" . '<metadata>avm:geglaettet="ja"</metadata>';
assert(avesmapsSvgExportVarianteAusInhalt($kopfFalle) === $ROH,
    'nur das oeffnende <svg>-Tag zaehlt');

// ---- 4. Wie viele je Variante aufbewahrt werden -----------------------------------------------
// Owner 31.08.2026: „2 fassungen reichen" -- die geglaettete Datei ist rund 2,5-mal so gross in
// der Geometrie, und ein volles Webspace entzieht auf STRATO der Datenbank die Schreibrechte.
assert(avesmapsSvgExportKeepFiles($ROH) === 3);
assert(avesmapsSvgExportKeepFiles($GLATT) === 2);

// ---- 5. Die Aufraeumung der einen Variante fasst die andere NICHT an --------------------------
$lager = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'avm-glatt-' . bin2hex(random_bytes(5));
mkdir($lager, 0700, true);
$mach = static function (string $dir, string $name, int $alter) use ($lager): string {
    file_put_contents($dir . DIRECTORY_SEPARATOR . $name, 'x');
    touch($dir . DIRECTORY_SEPARATOR . $name, time() - $alter);
    return $name;
};
$r1 = $mach($lager, 'abzug-' . str_repeat('1', 16) . '.svg', 500);
$r2 = $mach($lager, 'abzug-' . str_repeat('2', 16) . '.svg', 400);
$r3 = $mach($lager, 'abzug-' . str_repeat('3', 16) . '.svg', 300);
$r4 = $mach($lager, 'abzug-' . str_repeat('4', 16) . '.svg', 200);
$g1 = $mach($lager, 'abzug-glatt-' . str_repeat('a', 16) . '.svg', 500);
$g2 = $mach($lager, 'abzug-glatt-' . str_repeat('b', 16) . '.svg', 400);
$g3 = $mach($lager, 'abzug-glatt-' . str_repeat('c', 16) . '.svg', 300);

// Die ROHE Aufraeumung: behaelt 3 rohe, ruehrt keine einzige glatte an.
$wegRoh = avesmapsSvgExportAufraeumen($lager, $r4, $ROH);
$uebrigRoh = array_map('basename', (array) glob($lager . DIRECTORY_SEPARATOR . 'abzug-[0-9a-f]*.svg'));
assert(count($uebrigRoh) === 3, 'drei rohe bleiben, gezaehlt: ' . count($uebrigRoh));
assert($wegRoh === [$r1], 'nur der aelteste rohe faellt: ' . json_encode($wegRoh));
foreach ([$g1, $g2, $g3] as $g) {
    assert(is_file($lager . DIRECTORY_SEPARATOR . $g),
        '💣 die glatte Fassung ' . $g . ' darf die rohe Aufraeumung NIE anfassen');
}

// Die GLATTE Aufraeumung: behaelt 2 glatte, ruehrt keine einzige rohe an.
$wegGlatt = avesmapsSvgExportAufraeumen($lager, $g3, $GLATT);
$uebrigGlatt = array_map('basename', (array) glob($lager . DIRECTORY_SEPARATOR . 'abzug-glatt-*.svg'));
assert(count($uebrigGlatt) === 2, 'zwei glatte bleiben, gezaehlt: ' . count($uebrigGlatt));
assert($wegGlatt === [$g1], 'nur die aelteste glatte faellt: ' . json_encode($wegGlatt));
foreach ([$r2, $r3, $r4] as $r) {
    assert(is_file($lager . DIRECTORY_SEPARATOR . $r),
        '💣 die rohe Fassung ' . $r . ' darf die glatte Aufraeumung NIE anfassen');
}

// 🔴 Der AKTUELLE faellt nie, auch als aeltester -- die Regel gilt in beiden Varianten.
$g4 = $mach($lager, 'abzug-glatt-' . str_repeat('d', 16) . '.svg', 100);
avesmapsSvgExportAufraeumen($lager, $g2, $GLATT);   // $g2 ist der aelteste der drei
assert(is_file($lager . DIRECTORY_SEPARATOR . $g2), 'der aktuelle glatte bleibt');

// ---- 6. Zwei Zeiger, zwei Abzuege, unabhaengig -------------------------------------------------
// ⚠️ Der Hash wird aus der ECHTEN Datei gebildet, nicht erfunden: die Ablage vergleicht die
// gemeldete Groesse mit der Datei und hasht im Streitfall neu -- eine Fixture mit erfundenem
// Hash pruefte am Ende nur sich selbst.
$schreibZeiger = static function (string $dir, string $variante, string $datei, int $bytes): void {
    $sha = (string) hash_file('sha256', $dir . DIRECTORY_SEPARATOR . $datei);
    $zeiger = [
        'datei' => $datei, 'dateiname' => 'avesmaps-karte.svg', 'bytes' => $bytes,
        'sha256' => $sha, 'etag' => '"' . $sha . '"',
        'kartenfassung' => '76178', 'landschaftsfassung' => '21358',
        'exportiert' => '2026-08-31T03:17:00.000Z', 'dialekt' => 'inkscape', 'quelle' => 'routine',
    ];
    file_put_contents($dir . DIRECTORY_SEPARATOR . avesmapsSvgExportZeigerName($variante),
        json_encode($zeiger, JSON_PRETTY_PRINT));
};

$zwei = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'avm-zwei-' . bin2hex(random_bytes(5));
mkdir($zwei, 0700, true);
$rohDatei = 'abzug-' . str_repeat('1', 16) . '.svg';
$glattDatei = 'abzug-glatt-' . str_repeat('a', 16) . '.svg';
file_put_contents($zwei . DIRECTORY_SEPARATOR . $rohDatei, 'MLZ');
file_put_contents($zwei . DIRECTORY_SEPARATOR . $glattDatei, 'MLCZ-laenger');
$schreibZeiger($zwei, $ROH, $rohDatei, 3);
$schreibZeiger($zwei, $GLATT, $glattDatei, 12);

$abzugRoh = avesmapsSvgExportAbzug($zwei, $ROH);
$abzugGlatt = avesmapsSvgExportAbzug($zwei, $GLATT);
assert($abzugRoh !== null && basename($abzugRoh['pfad']) === $rohDatei);
assert($abzugGlatt !== null && basename($abzugGlatt['pfad']) === $glattDatei);
assert($abzugRoh['sha256'] !== $abzugGlatt['sha256'],
    '💣 zwei Varianten, zwei Pruefsummen -- ein gemeinsamer ETag gaebe dem Client ein 304 auf '
    . 'die jeweils ANDERE Geometrie');
assert($abzugRoh['bytes'] === 3 && $abzugGlatt['bytes'] === 12);
// Der Vorgabewert bleibt die rohe Ablage.
$ohneAngabe = avesmapsSvgExportAbzug($zwei);
assert($ohneAngabe !== null && basename($ohneAngabe['pfad']) === $rohDatei, 'Vorgabe ist roh');

// 🔴 Fehlt die glatte Fassung, ist die Antwort NULL -- nie stillschweigend die rohe. Der
// Endpunkt macht daraus einen eigenen Fehlercode; eine Antwort, die anders aussieht als
// bestellt, ist schlimmer als keine.
$nurRoh = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'avm-nurroh-' . bin2hex(random_bytes(5));
mkdir($nurRoh, 0700, true);
file_put_contents($nurRoh . DIRECTORY_SEPARATOR . $rohDatei, 'MLZ');
$schreibZeiger($nurRoh, $ROH, $rohDatei, 3);
assert(avesmapsSvgExportAbzug($nurRoh, $ROH) !== null, 'die rohe liegt');
assert(avesmapsSvgExportAbzug($nurRoh, $GLATT) === null, 'die glatte fehlt und wird nicht ersetzt');

// 💣 Und ein Zeiger, der auf die FALSCHE Namensform zeigt, gilt nicht: sonst liesse sich ueber
// einen manipulierten glatten Zeiger die rohe Datei unter `?smooth=1` ausliefern.
$verdreht = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'avm-verdreht-' . bin2hex(random_bytes(5));
mkdir($verdreht, 0700, true);
file_put_contents($verdreht . DIRECTORY_SEPARATOR . $rohDatei, 'MLZ');
$schreibZeiger($verdreht, $GLATT, $rohDatei, 3);   // glatter Zeiger, roher Dateiname
assert(avesmapsSvgExportAbzug($verdreht, $GLATT) === null,
    'ein glatter Zeiger auf eine rohe Datei ist unbrauchbar');

// ---- aufraeumen --------------------------------------------------------------------------------
foreach ([$lager, $zwei, $nurRoh, $verdreht] as $dir) {
    foreach ((array) glob($dir . DIRECTORY_SEPARATOR . '*') as $f) {
        @unlink((string) $f);
    }
    @rmdir($dir);
}

echo "svg-export-glatt-test: ok\n";
