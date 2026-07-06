<?php

declare(strict_types=1);

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
