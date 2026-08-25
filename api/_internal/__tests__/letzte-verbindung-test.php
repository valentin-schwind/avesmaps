<?php

declare(strict_types=1);

/**
 * avesmapsCreatePdo merkt sich ihre Rueckgabe, damit die Abschlussroutine in bootstrap.php nicht
 * eine ZWEITE Verbindung je Anfrage aufmachen muss.
 *
 * Entwurf: docs/superpowers/specs/2026-08-25-api-nutzung-design.md §3.2
 *
 * 🪤 WARUM DIESER TEST ZWEIGETEILT IST -- der erste Entwurf war falsch und ist beim ersten Lauf
 * aufgeflogen. Er wollte avesmapsCreatePdo mit `driver => 'sqlite'` fahren, um die Merkstelle
 * behavioral zu pruefen. Die Funktion kennt aber nur mysql/mariadb/pgsql/postgres/postgresql und
 * wirft bei allem anderen „Der Datenbank-Treiber wird nicht unterstuetzt." -- sie ist ohne eine
 * echte MySQL ueberhaupt nicht ausfuehrbar.
 *
 * Also: der LESER wird ausgefuehrt (er ist reiner Zustand und braucht keine Datenbank), und die
 * Verdrahtung im SCHREIBER wird am Quelltext festgehalten. Ein Test, der so tut, als pruefe er
 * mehr, waere schlimmer als einer, der seine Grenze benennt.
 *
 * ⚠️ Die Signatur von avesmapsCreatePdo bleibt unangetastet -- create-pdo-argument-test.php haelt
 * fest, dass jeder Aufrufer den Datenbank-TEILBAUM uebergibt.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/__tests__/letzte-verbindung-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../bootstrap.php';

// --- Der Leser, ausgefuehrt -------------------------------------------------------------------
unset($GLOBALS['avesmapsLetztePdo']);
assert(avesmapsLetzteDatenbankverbindung() === null, 'ohne Verbindung: null');

// 🔴 Nichts anderes als eine PDO darf durchkommen. Die Abschlussroutine ruft darauf `prepare()`
// auf; ein durchgereichter Fremdwert wuerde dort erst sterben, mitten im Aufraeumen.
$GLOBALS['avesmapsLetztePdo'] = 'keine Verbindung';
assert(avesmapsLetzteDatenbankverbindung() === null, 'ein Fremdwert zaehlt als keine Verbindung');

$GLOBALS['avesmapsLetztePdo'] = null;
assert(avesmapsLetzteDatenbankverbindung() === null, 'null bleibt null');

if (in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    $echte = new PDO('sqlite::memory:');
    $GLOBALS['avesmapsLetztePdo'] = $echte;
    // Dieselbe INSTANZ, keine Kopie -- eine zweite Verbindung waere genau das, was das hier
    // vermeiden soll.
    assert(avesmapsLetzteDatenbankverbindung() === $echte, 'gemerkt wird die Instanz selbst');
    unset($GLOBALS['avesmapsLetztePdo']);
}

// --- Die Verdrahtung im Schreiber, am Quelltext -----------------------------------------------
$quelle = file_get_contents(__DIR__ . '/../bootstrap.php');
assert(is_string($quelle) && $quelle !== '');

// 💣 Zeilenenden vereinheitlichen, BEVOR am Text geschnitten wird. Der Arbeitsbaum steht unter
// Windows und `.gitattributes` setzt `text=auto`, die Datei hat hier also CRLF -- ein Muster mit
// "\n}\n" findet die schliessende Klammer dann NIE, und der Test faellt mit einer Meldung um, die
// nach einem fehlenden Feature aussieht statt nach einem Zeilenende. Genau so ist er beim ersten
// Lauf umgefallen.
$quelle = str_replace("\r\n", "\n", $quelle);

$erzeuger = substr($quelle, strpos($quelle, 'function avesmapsCreatePdo'));
$erzeuger = substr($erzeuger, 0, strpos($erzeuger, "\n}\n") + 3);

assert(
    str_contains($erzeuger, "\$GLOBALS['avesmapsLetztePdo'] = \$verbindung;"),
    'avesmapsCreatePdo hinterlegt die erzeugte Verbindung'
);
// 💣 Und sie wird HINTERLEGT, BEVOR sie zurueckgegeben wird. Stuende die Zeile hinter dem return,
// waere sie toter Code -- und der Zaehler machte fuer jede Anfrage eine zweite Verbindung auf,
// ohne dass irgendetwas kaputt aussaehe.
$stelleHinterlegen = strpos($erzeuger, "\$GLOBALS['avesmapsLetztePdo']");
$stelleRueckgabe = strpos($erzeuger, 'return $verbindung;');
assert($stelleHinterlegen !== false && $stelleRueckgabe !== false);
assert($stelleHinterlegen < $stelleRueckgabe, 'hinterlegen VOR dem return');

echo "OK: letzte-verbindung-test\n";
