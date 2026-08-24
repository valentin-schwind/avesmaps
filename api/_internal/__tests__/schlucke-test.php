<?php

declare(strict_types=1);

/**
 * Der Diagnose-Trichter: `avesmapsSchlucke()` / `avesmapsSchluckProtokoll()`. Ausfuehren:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/schlucke-test.php
 * Rueckgabe 0 = alle Zusicherungen halten.
 *
 * 🪤 WARUM ES DIESEN TRICHTER GIBT — aus einem Live-Ausfall vom 24.08.2026. `map-features.php`
 * antwortete jedem Besucher mit HTTP 500, die Karte blieb leer, und die Revert-Botschaft (91587cd)
 * musste schreiben: „NICHT DIAGNOSTIZIERT, nur zurueckgebaut". Der Grund war nicht schwer zu
 * finden — er war UNAUFFINDBAR, weil der Endpunkt ihn in seinem eigenen `catch (Throwable)`
 * behielt. Am selben Tag gemessen: 289 von 621 catch-Bloecken unter `api/` tun das.
 *
 * 🔴 Der Trichter aendert das Verhalten NICHT. Das ist seine wichtigste Eigenschaft und die erste
 * Zusicherung hier: er liefert genau den Rueckfall, den der catch ohnehin geliefert haette. Nur so
 * darf er auf dem heissesten oeffentlichen Lesepfad ueberhaupt stehen.
 *
 * ⚠️ Geprueft wird gegen eine EIGENE Protokolldatei (`error_log` per ini umgebogen), nicht gegen
 * den Bestand des Systems — sonst haengt der Test daran, wohin PHP auf dem jeweiligen Rechner
 * schreibt, und das ist auf STRATO etwas anderes als hier.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Erneut starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../bootstrap.php';

$protokollDatei = tempnam(sys_get_temp_dir(), 'avesmaps-schluck-');
assert(is_string($protokollDatei), 'die Protokolldatei laesst sich anlegen');

// 🪤 ERST DAS, DANN DIE UMLEITUNG — beim Schreiben dieses Tests einmal andersherum gemacht und
// prompt hineingefallen: `ini_set('error_log', …)` faengt AUCH den eigenen Fehlschlag. Ein
// gerissener `assert()` ist eine unbehandelte AssertionError, die PHP ins error_log schreibt —
// also in die Wegwerfdatei. Der Test endete mit Rueckgabe 255 und KEINER Ausgabe, und im
// Deploy-Tor haette sein `tail -20` nichts anzuzeigen gehabt. Exakt die Fehlerklasse, gegen die
// dieser Trichter gebaut ist, im Werkzeug gegen sie selbst.
ini_set('display_errors', 'stderr');
ini_set('error_log', $protokollDatei);

$protokoll = static function () use ($protokollDatei): string {
    return (string) file_get_contents($protokollDatei);
};

// --- 1. Der Rueckfall kommt UNVERAENDERT zurueck ---------------------------------------------
//
// 💣 Das ist der ganze Vertrag gegenueber dem Aufrufer. Ein Trichter, der aus `[]` ein `null`
// macht oder aus `null` eine Ausnahme, waere kein Ersatz fuer ein `return []` — er waere ein
// zweiter Fehler an derselben Stelle.
$fehler = new RuntimeException('SQLSTATE[HY093]: Invalid parameter number');

assert(avesmapsSchlucke($fehler, 'test rueckfall liste', []) === [], 'die leere Liste kommt zurueck');
assert(avesmapsSchlucke($fehler, 'test rueckfall wahr', true) === true, 'ein bool kommt zurueck');
assert(avesmapsSchlucke($fehler, 'test rueckfall zahl', 0) === 0, 'die Null kommt zurueck, nicht null');
assert(avesmapsSchlucke($fehler, 'test rueckfall text', '') === '', 'der leere Text kommt zurueck');

// ⚠️ `null` ist ein gueltiger Rueckfall und wird NICHT umgedeutet. Genau die Umdeutung von „leer"
// zu „Fehler" ist das Problem, das der Trichter loest — er darf es nicht in die andere Richtung
// wiederholen.
assert(avesmapsSchlucke($fehler, 'test rueckfall null', null) === null, 'null bleibt null');
assert(avesmapsSchlucke($fehler, 'test ohne rueckfall') === null, 'ohne Angabe: null');

$verschachtelt = ['a' => [1, 2], 'b' => null];
assert(
    avesmapsSchlucke($fehler, 'test rueckfall verschachtelt', $verschachtelt) === $verschachtelt,
    'auch ein zusammengesetzter Wert bleibt unangetastet'
);

// --- 2. Der Fehler steht danach im Protokoll -------------------------------------------------
$inhalt = $protokoll();
assert(str_contains($inhalt, 'avesmaps geschluckt'), 'die Zeile ist als geschluckt erkennbar');
assert(str_contains($inhalt, 'test rueckfall liste'), 'der Kontext steht drin — er ist der Suchbegriff');
assert(str_contains($inhalt, 'RuntimeException'), 'die Klasse steht drin');
assert(
    str_contains($inhalt, 'SQLSTATE[HY093]'),
    'die MELDUNG steht drin — ohne sie waere die Zeile so stumm wie der catch davor'
);
assert(str_contains($inhalt, basename(__FILE__)), 'und die Fundstelle, sonst sucht man die Datei');

// --- 3. Derselbe Fall wird nur EINMAL geschrieben --------------------------------------------
//
// 💣 Ohne diesen Deckel schreibt eine dauerhaft fehlende Spalte auf dem meistgerufenen Endpunkt
// eine Zeile PRO ANFRAGE in das geteilte Protokoll von STRATO. Der erste Fall jeder Art soll
// verlaesslich sichtbar sein, der tausendste nicht noch einmal.
file_put_contents($protokollDatei, '');
$wiederholt = new LogicException('immer dieselbe Stelle');
for ($i = 0; $i < 50; $i++) {
    avesmapsSchlucke($wiederholt, 'test wiederholung', []);
}
assert(substr_count($protokoll(), 'avesmaps geschluckt') === 1, 'fuenfzig Aufrufe, eine Zeile');

// ⚠️ Ein ANDERER Kontext ist ein anderer Fall — sonst verdeckt der erste Schlucker eines Prozesses
// alle uebrigen, und man repariert den falschen.
file_put_contents($protokollDatei, '');
avesmapsSchlucke($wiederholt, 'test wiederholung zweiter kontext', []);
assert(substr_count($protokoll(), 'avesmaps geschluckt') === 1, 'derselbe Fehler unter neuem Kontext zaehlt neu');

// --- 4. Die Schreib-Haelfte ist einzeln benutzbar --------------------------------------------
//
// ⭐ Ein catch, der seinen Rueckfall selbst baut (oder gar keinen hat), soll den Trichter benutzen
// koennen, ohne einen Wert durchzureichen. Sonst schreibt er sich sein error_log daneben, und die
// Zeilen sehen dann nicht mehr gleich aus — womit die Suche nach „avesmaps geschluckt" wieder
// unvollstaendig waere.
file_put_contents($protokollDatei, '');
avesmapsSchluckProtokoll(new DomainException('nur schreiben'), 'test nur protokoll');
assert(str_contains($protokoll(), 'test nur protokoll'), 'die Schreib-Haelfte laeuft allein');

// --- 5. Die Konstante steht VOR der Funktion, die sie braucht --------------------------------
//
// 🪤 Die Falle vom 19.08.2026 (siehe const-vor-benutzung-test.php): PHP hoistet Funktionen, aber
// keine `const` auf Dateiebene. Steht die Konstante unter der Funktion, ist sie beim Aufruf aus
// einer frueheren Zeile nicht definiert — und ein Fatal antwortet mit einem LEEREN Rumpf.
$bootstrap = (string) file_get_contents(__DIR__ . '/../bootstrap.php');
$posKonstante = strpos($bootstrap, 'const AVESMAPS_SCHLUCK_LOG_MAX');
$posFunktion = strpos($bootstrap, 'function avesmapsSchluckProtokoll');
assert(is_int($posKonstante) && is_int($posFunktion), 'beide stehen in bootstrap.php');
assert($posKonstante < $posFunktion, 'die Konstante steht vor der Funktion, die sie liest');

// --- 6. Der Prozessdeckel greift -- UND DIESER ABSCHNITT STEHT ZULETZT ---------------------
//
// 🪤 DIE REIHENFOLGE IST TRAGEND, und sie hat beim Bau dieses Tests einmal zugeschlagen: der
// Deckel ist PROZESSWEIT, nicht je Kontext. Dieser Abschnitt erschoepft ihn, also schreibt danach
// nichts mehr — der Abschnitt „Schreib-Haelfte" stand zuerst dahinter und fiel um, obwohl an ihm
// nichts falsch war. Wer hier etwas ergaenzt, ergaenzt es DAVOR.
//
// ⚠️ Geprueft wird deshalb auch keine absolute Zahl, sondern nur, DASS der Deckel zuschlaegt:
// jeder zusaetzliche Fall weiter oben verschiebt sie, ohne dass an der Sache etwas dran waere.
file_put_contents($protokollDatei, '');
for ($i = 0; $i < AVESMAPS_SCHLUCK_LOG_MAX * 3; $i++) {
    avesmapsSchlucke(new RuntimeException('fall ' . $i), 'test deckel ' . $i, []);
}
$geschrieben = substr_count($protokoll(), 'avesmaps geschluckt');
assert($geschrieben > 0, 'der Deckel schluckt nicht ALLES — sonst waere der Trichter wirkungslos');
assert(
    $geschrieben < AVESMAPS_SCHLUCK_LOG_MAX * 3,
    'aber er begrenzt: ' . AVESMAPS_SCHLUCK_LOG_MAX * 3 . ' verschiedene Faelle geben nicht ' . AVESMAPS_SCHLUCK_LOG_MAX * 3 . ' Zeilen'
);

@unlink($protokollDatei);

echo "schlucke ok\n";
