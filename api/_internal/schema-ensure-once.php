<?php
// api/_internal/schema-ensure-once.php

declare(strict_types=1);

// DER DDL-RIEGEL. Ein `CREATE TABLE IF NOT EXISTS` (oder SHOW COLUMNS + ALTER) laeuft je definierender
// Datei und Namen hoechstens einmal je Frist -- nicht bei jedem Aufruf eines Takt-Endpunkts.
//
// 💣 Gemessen 03.09.2026: die Meldungsliste fuhr je 45 s CREATE TABLE + 5x SHOW COLUMNS + SHOW TABLES,
// jeder Sperr-Wecker 2x CREATE TABLE IF NOT EXISTS, der politische Endpunkt 13 DDL-Statements je
// Nicht-Cache-Treffer. Alles idempotent -- und alles Metadaten-Arbeit auf dem heissen Pfad, die
// AGENTS.md §10 seit Monaten als Perf-Hotspot fuehrt.
//
// 🔴 DER SCHLUESSEL TRAEGT DIE MTIME DER DEFINIERENDEN DATEI. Ein Deploy, der eine Spalte ergaenzt,
// aendert die Datei, damit den Schluessel, und der Ensure laeuft sofort wieder. Ohne das stuende ein
// neuer ALTER TABLE bis zu eine Stunde aus, und jede Anfrage liefe in „Unknown column".
// ⚠️ Faellt OFFEN aus: ist das Temp-Verzeichnis nicht schreibbar, gibt es keine Marke, und der
// Ensure laeuft wie bisher jedes Mal -- langsamer, nie kaputt.
// ⚠️ Der Ensure selbst wirft weiter; nach einem Fehlschlag entsteht KEINE Marke.
// 💣 Nie innerhalb einer Transaktion rufen: DDL committet in MySQL implizit (AGENTS.md §11).

const AVESMAPS_SCHEMA_ENSURE_FRIST_SEKUNDEN = 3600;

function avesmapsSchemaEnsureMarkerDir(): string {
    $dir = sys_get_temp_dir() . '/avesmaps_schema_ensured';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

function avesmapsSchemaEnsureMarkerFile(string $name, string $definierendeDatei): string {
    clearstatcache(true, $definierendeDatei);
    $mtime = (string) @filemtime($definierendeDatei);
    return avesmapsSchemaEnsureMarkerDir() . '/' . sha1($name . '|' . $definierendeDatei . '|' . $mtime) . '.marker';
}

/**
 * @return bool true, wenn der Ensure in diesem Aufruf wirklich lief
 */
function avesmapsSchemaEnsureOnce(string $name, string $definierendeDatei, callable $ensure, int $frist = AVESMAPS_SCHEMA_ENSURE_FRIST_SEKUNDEN): bool {
    $marke = avesmapsSchemaEnsureMarkerFile($name, $definierendeDatei);
    clearstatcache(true, $marke);
    if ($frist > 0 && is_file($marke) && (time() - (int) @filemtime($marke)) < $frist) {
        return false;
    }
    $ensure();
    if (!@touch($marke)) {
        @file_put_contents($marke, '');
    }
    return true;
}
