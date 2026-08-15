<?php

declare(strict_types=1);

/**
 * Gemeinsame Einordnung eines Throwable aus einem PDO-Aufruf: bedeutet das einen echten Fehler,
 * oder einen bekannten, hinnehmbaren Zustand (eine Tabelle, die noch nicht angelegt ist)?
 *
 * 🔴 Fix-Runde 7 (Schlussprüfung), C2: hierher verschoben aus api/_internal/map/editor-activity.php,
 * wo es der einzige Ort war -- api/_internal/wiki/sync-plan.php hatte sich eine EIGENE, schmalere
 * Kopie gebaut (nur 42S02 + "no such table", ohne die beiden Textformen), statt diese Funktion zu
 * benutzen. Jeder catch-Block, der "Tabelle fehlt" von "es ist wirklich etwas kaputt" unterscheiden
 * muss, gehört hierher -- keine dritte Kopie.
 */

// True, wenn die Ausnahme heisst „die Tabelle gibt es noch nicht" -- ueber MySQL (SQLSTATE 42S02 /
// „doesn't exist" / „base table or view not found") UND SQLite („no such table", vom Test-Unterbau
// benutzt). Jede andere Ausnahme ist ein echter Fehler und muss weitergeworfen werden.
function avesmapsIsMissingTableError(Throwable $exception): bool
{
    if ((string) $exception->getCode() === '42S02') {
        return true;
    }
    $message = strtolower($exception->getMessage());

    return str_contains($message, "doesn't exist")
        || str_contains($message, 'base table or view not found')
        || str_contains($message, 'no such table');
}
