<?php

declare(strict_types=1);

/**
 * Ein Dump-Schritt muss VORANKOMMEN -- die Untergrenze gegen den Stillstand am Dump-Ende.
 *
 * 💣 DER FALL, DEN DIESER TEST HAELT (gemeldet 01.09.2026: „Apfeldorn laesst sich im Wiki nicht
 * zuweisen, er wird nicht gefunden"). Jeder Dump-Schritt zieht den Leser NEU auf und ueberspringt
 * alles, was fruehere Schritte verbraucht haben -- bz2 ist nicht springbar. Die Zeitpruefung stand
 * HINTER der ersten Seite, also verarbeitete ein Schritt genau EINE Seite, sobald das blosse
 * Ueberspringen das Budget aufgebraucht hatte. Kein Fehler, keine Meldung -- nur Stillstand.
 * Und er trifft ausgerechnet den Namensraum 222: 61 % dieser Seiten liegen im letzten Zehntel des
 * Dumps, „Inoffiziell:Apfeldorn" auf Platz 251.382 von 252.902.
 *
 * ⚠️ Was dieser Test NICHT kann: die echten Schleifen ausfuehren -- die brauchen eine 47-MB-Datei
 * und eine Datenbank. Er prueft die REGEL scharf und ihre VERDRAHTUNG am Quelltext. Die Kette
 * selbst wurde am Livedump gemessen (siehe AVESMAPS_WIKI_DUMP_STEP_MIN_PAGES).
 *
 * Lauf: php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/dump-schritt-fortschritt-test.php
 */

require_once __DIR__ . '/../dump-reader.php';

$geprueft = 0;
$pruefe = static function (bool $bedingung, string $was) use (&$geprueft): void {
    if (!$bedingung) {
        fwrite(STDERR, "FEHLGESCHLAGEN: {$was}\n");
        exit(1);
    }
    $geprueft++;
};

// --- A. Die Regel selbst ------------------------------------------------------------------------
$vorbei = microtime(true) - 10.0;   // Frist laengst abgelaufen
$offen  = microtime(true) + 3600.0; // Frist weit weg

$pruefe(
    avesmapsWikiDumpStepDarfAnhalten(AVESMAPS_WIKI_DUMP_STEP_MIN_PAGES, $vorbei),
    'Zeit um UND Untergrenze erreicht -> anhalten'
);
$pruefe(
    !avesmapsWikiDumpStepDarfAnhalten(AVESMAPS_WIKI_DUMP_STEP_MIN_PAGES - 1, $vorbei),
    '🔴 Zeit um, aber Untergrenze NICHT erreicht -> WEITERMACHEN (das ist der ganze Riegel)'
);
$pruefe(
    !avesmapsWikiDumpStepDarfAnhalten(0, $vorbei),
    'null Seiten trotz abgelaufener Frist -> weitermachen'
);
$pruefe(
    !avesmapsWikiDumpStepDarfAnhalten(1, $vorbei),
    'EINE Seite trotz abgelaufener Frist -> weitermachen (genau der alte Stillstand)'
);
$pruefe(
    !avesmapsWikiDumpStepDarfAnhalten(AVESMAPS_WIKI_DUMP_STEP_MIN_PAGES * 100, $offen),
    'Untergrenze weit ueberschritten, aber Zeit noch da -> weitermachen'
);

// 🔴 DIE UNTERGRENZE MUSS UNTER DEM SEITENBUDGET LIEGEN -- und das ist keine Kosmetik. Zwei der
// fuenf Schleifen fuehren beide Grenzen. Waeren sie gleich, faenden beide Bedingungen zur selben
// Seitenzahl statt: die Zeitpruefung waere wirkungslos, ein Schritt liefe IMMER bis zum Budget, und
// das 28-Sekunden-Ventil waere ausgebaut. Aus dem Stillstand wuerde ein harter Abbruch in
// max_execution_time -- schlimmer, weil der Cursor danach da steht, wo er vorher stand.
$pruefe(
    AVESMAPS_WIKI_DUMP_STEP_MIN_PAGES < AVESMAPS_WIKI_DUMP_STEP_PAGE_BUDGET,
    'Untergrenze < Seitenbudget (sonst ist die Zeitpruefung in Pass A/B wirkungslos)'
);
// ⚠️ Und sie muss deutlich ueber 1 liegen -- sonst ist sie der alte Stillstand mit neuem Namen.
$pruefe(AVESMAPS_WIKI_DUMP_STEP_MIN_PAGES >= 100, 'die Untergrenze traegt wirklich (>= 100 Seiten)');

// --- B. Die Verdrahtung: ALLE FUENF Dump-Schleifen -----------------------------------------------
// 💣 Eine Regel, die einen von fuenf Erzeugern bindet, ist in diesem Haus keine Regel. Alle fuenf
// ziehen den Dump per Seiten-Cursor neu auf und trugen denselben Stillstand.
//
// 🔴 GEPRUEFT WIRD JE SCHLEIFE, NICHT JE DATEI -- und das hat dieser Test sich selbst beigebracht.
// Die erste Fassung suchte den blanken Frist-Abbruch in der GANZEN Datei und schlug bei
// citymap-sync.php an: dort steht eine ZWEITE Schleife (der Planschritt), die ueber DATENBANKZEILEN
// laeuft, nichts neu aufzieht und den Stillstand darum gar nicht haben kann. Ein Riegel, der eine
// gesunde Stelle anzeigt, wird beim naechsten Mal weggeklickt.
$schleifen = [
    ['dump-hybrid-read.php',   'avesmapsWikiDumpHybridWikitextCollectStep', 'die Sammelphase -- hier wurde es gemeldet'],
    ['dump-hybrid-driver.php', 'avesmapsWikiDumpHybridRedirectAliasStep',   'die Weiterleitungs-Phase'],
    ['citymap-sync.php',       'avesmapsCitymapBuildCatalogStep',           'der Kartenindex-Scan'],
    ['dump-entity-scan.php',   'avesmapsWikiDumpRunPassBStep',              'Pass B'],
    ['dump-reader.php',        'avesmapsWikiDumpRunPassAStep',              'Pass A im Leser selbst'],
];

// 🪤 KOMMENTARE RAUS, BEVOR GEMESSEN WIRD. Der Name der Funktion steht in mehreren Begruendungen;
// ein Test, der Fliesstext liest, ist gruen, sobald jemand sie nur ERWAEHNT.
$ohneKommentare = static function (string $text): string {
    $text = preg_replace('~/\*.*?\*/~s', '', $text) ?? $text;
    $zeilen = preg_split('/\R/', $text) ?: [];
    $rein = [];
    foreach ($zeilen as $zeile) {
        $rein[] = preg_replace('~(^|[^:])//.*$~', '$1', $zeile) ?? $zeile;
    }

    return implode("\n", $rein);
};

// Den Rumpf EINER Funktion herausschneiden -- bis zur naechsten Funktion auf Dateiebene.
$rumpf = static function (string $code, string $name): string {
    $ab = strpos($code, 'function ' . $name . '(');
    if ($ab === false) {
        return '';
    }
    $bis = strpos($code, "\nfunction ", $ab + 1);

    return $bis === false ? substr($code, $ab) : substr($code, $ab, $bis - $ab);
};

foreach ($schleifen as [$datei, $funktion, $rolle]) {
    $pfad = __DIR__ . '/../' . $datei;
    $pruefe(is_file($pfad), "{$datei} existiert");
    $code = $ohneKommentare((string) file_get_contents($pfad));
    $block = $rumpf($code, $funktion);
    $pruefe($block !== '', "{$funktion} gefunden ({$datei})");

    $pruefe(
        str_contains($block, 'avesmapsWikiDumpStepDarfAnhalten('),
        "{$rolle}: {$funktion} ruft die Untergrenze"
    );

    // 🔴 UND DIE ALTE FORM DARF NICHT DANEBEN STEHENBLEIBEN. Ein blanker Frist-Abbruch neben dem
    // neuen Aufruf waere der Stillstand, nur eine Zeile weiter oben.
    $pruefe(
        preg_match('/if\s*\(\s*microtime\(true\)\s*>=\s*\$deadline\s*\)/', $block) !== 1,
        "{$rolle}: {$funktion} hat KEINEN blanken Frist-Abbruch mehr"
    );

    // ⚠️ Und sie zaehlt wirklich mit -- eine undefinierte Zaehlvariable waere 0, die Untergrenze
    // nie erreicht, und der Schritt hoerte NIE auf. Das waere schlimmer als der Stillstand.
    $trefferVariable = preg_match('/avesmapsWikiDumpStepDarfAnhalten\(\$([A-Za-z_]+),/', $block, $m) === 1;
    $pruefe($trefferVariable, "{$rolle}: die Untergrenze bekommt eine Variable uebergeben");
    $pruefe(
        preg_match('/\$' . preg_quote($m[1], '/') . '\+\+/', $block) === 1,
        "{$rolle}: die uebergebene Zaehlvariable (\${$m[1]}) wird in derselben Schleife hochgezaehlt"
    );
}

// --- C. Die Untergrenze steht nur an EINER Stelle ------------------------------------------------
// ⚠️ Ihr Wert darf nirgends abgeschrieben sein -- sonst laufen die Schleifen beim naechsten
// Nachjustieren auseinander.
$leser = $ohneKommentare((string) file_get_contents(__DIR__ . '/../dump-reader.php'));
$pruefe(
    substr_count($leser, 'const AVESMAPS_WIKI_DUMP_STEP_MIN_PAGES') === 1,
    'die Untergrenze ist genau einmal definiert'
);
$pruefe(
    substr_count($leser, 'function avesmapsWikiDumpStepDarfAnhalten') === 1,
    'die Regel ist genau einmal definiert'
);

// --- D. Der Beleg, warum die Untergrenze nichts kostet -------------------------------------------
// ⭐ Am Livedump gemessen (Sprung auf Seite 240.000, dann N Seiten klassifizieren):
//    N=0 8,64 s | N=500 8,83 s | N=2000 8,77 s | N=5000 8,88 s -- rund 0,05 ms je Seite.
// Der Test kann die Messung nicht wiederholen (47-MB-Datei), aber er haelt fest, dass sie in der
// Begruendung STEHT: eine Zahl ohne Messung daneben wird beim naechsten Mal geraten.
$leserRoh = (string) file_get_contents(__DIR__ . '/../dump-reader.php');
$pruefe(
    str_contains($leserRoh, '8,64 s') && str_contains($leserRoh, '251.382'),
    'die Messung und der Fundort stehen bei der Konstante'
);

echo "dump-schritt-fortschritt-test.php: {$geprueft} Pruefungen erfuellt\n";
