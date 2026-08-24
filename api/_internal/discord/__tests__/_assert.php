<?php

declare(strict_types=1);

/**
 * KEIN Test, sondern der Zusicherungs-Helfer der Discord-Tests nebenan.
 *
 * ⚠️ Das Deploy-Tor faehrt JEDE `.php` unter einem `__tests__`-Pfad, also auch diese Datei.
 * Sie definiert nur Funktionen, laeuft ohne Ausgabe durch und endet mit 0 -- harmlos, aber sie
 * zaehlt als ein gruener "Test" mit. Bewusst so gelassen: der Unterschied zur Hauskonvention
 * (nacktes `assert()` mit `zend.assertions`-Wache) ist hier ein VORTEIL, denn `t_ok`/`t_eq`
 * wirken auch dann, wenn jemand die Wache vergisst, und melden erwartet/tatsaechlich im Klartext.
 */

$GLOBALS['t_failed'] = false;

function t_ok(bool $condition, string $message): void {
    if ($condition) {
        fwrite(STDOUT, "PASS: {$message}\n");
        return;
    }
    fwrite(STDERR, "FAIL: {$message}\n");
    $GLOBALS['t_failed'] = true;
}

function t_eq(mixed $actual, mixed $expected, string $message): void {
    if ($actual === $expected) {
        fwrite(STDOUT, "PASS: {$message}\n");
        return;
    }
    fwrite(STDERR, "FAIL: {$message}\n  expected: " . var_export($expected, true) . "\n  actual:   " . var_export($actual, true) . "\n");
    $GLOBALS['t_failed'] = true;
}

function t_done(): void {
    if ($GLOBALS['t_failed']) {
        fwrite(STDERR, "RESULT: FAILURES\n");
        exit(1);
    }
    fwrite(STDOUT, "RESULT: ALL PASS\n");
    exit(0);
}
