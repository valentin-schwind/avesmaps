<?php

declare(strict_types=1);

/**
 * Der gemeinsame Aufraeumer der Aenderungsprotokolle.
 *
 * Anlass (18.08.2026): die Datenbank lief in STRATOs 2-GB-Grenze und wurde schreibgesperrt. Nicht
 * die Inhalte hatten sie gefuellt -- die ganze Karte mit 14.256 Objekten sind 23 MB --, sondern die
 * Protokolle: `ecosystem_geometry_audit_log` allein 716 MB aus 18.375 Zeilen (~40 KB je
 * Editorschritt, jede Zeile traegt die Geometrie vorher UND nachher), `map_audit_log` 133 MB und
 * 696 neue Zeilen am Tag. Keines der beiden hatte je eine Grenze.
 *
 * 🔴 DIE UNTERGRENZE IST DIE ANZEIGEHOEHE, und sie ist nicht verhandelbar: beide Fenster zeigen
 * hoechstens 200 Zeilen (`api/edit/map/audit-log.php` und AVESMAPS_ECOSYSTEM_CHANGE_LOG_LIMIT), und
 * das Rueckgaengigmachen nimmt seine Zeile aus genau dieser Liste. Wer tiefer kappt, nimmt dem
 * Editor Schritte weg, die die Oberflaeche ihm noch anbietet. Ein zu kleiner Wert wird deshalb
 * hochgeklemmt, nicht befolgt.
 *
 * ⚠️ Vorbild ist avesmapsPoliticalPruneGeometryAuditLog (territories-audit.php) -- gleiche Idee,
 * zwei Unterschiede, beide gemessen:
 *   1. Die Unterabfrage laeuft NICHT im DELETE. Dort brauchte sie die doppelte Ableitungstabelle
 *      gegen MySQL-Fehler 1093; hier werden die zwei Grenzen vorher gelesen und als Zahl uebergeben.
 *      Damit gibt es kein 1093, kein `NOT IN` ueber tausende Werte und keinen Filesort -- nur zwei
 *      Indexgriffe auf den Primaerschluessel und ein Bereichs-DELETE.
 *   2. Ein Lauf hat einen DECKEL. Ohne ihn raeumt der erste Lauf auf der Livetabelle rund 61.000
 *      Zeilen -- in der Transaktion, in der ein Editor gerade gespeichert hat. Mit Deckel sind es
 *      viele kurze Schritte, die von selbst konvergieren.
 *
 * 💣 `id` ist AUTO_INCREMENT, „juengste N" heisst also „groesste N ids". Das ist der Grund, aus dem
 * hier nach `id` und nicht nach `created_at` geordnet wird: es trifft dieselbe Menge und liegt auf
 * dem Primaerschluessel. `map_audit_log` hat keinen Index auf `created_at`.
 */

/** Die Anzeigehoehe beider Aenderungsfenster. Tiefer darf keine Grenze gehen. */
const AVESMAPS_AUDIT_PRUNE_MIN_KEEP = 200;
/** Reine Unfallbremse gegen einen vertippten Riesenwert. */
const AVESMAPS_AUDIT_PRUNE_MAX_KEEP = 50000;
/** Hoechstens so viele Zeilen je Lauf -- siehe Punkt 2 oben. */
const AVESMAPS_AUDIT_PRUNE_DEFAULT_MAX_DELETE = 500;

/**
 * 💣 Ein Tabellenname kann kein Platzhalter sein, er wird in den SQL-Text interpoliert. Ohne diese
 * Liste waere der Parameter eine Injektionsstelle.
 */
const AVESMAPS_AUDIT_PRUNE_TABLES = [
    'map_audit_log',
    'ecosystem_geometry_audit_log',
];

/**
 * Kappt ein Protokoll auf die juengsten $keepRows Zeilen -- hoechstens $maxDelete je Lauf.
 *
 * @param string $table Muss in AVESMAPS_AUDIT_PRUNE_TABLES stehen.
 * @return int Wie viele Zeilen dieser Lauf geloescht hat (0 = nichts zu tun).
 * @throws InvalidArgumentException bei einer unbekannten Tabelle.
 */
function avesmapsPruneAuditLog(
    PDO $pdo,
    string $table,
    int $keepRows,
    int $maxDelete = AVESMAPS_AUDIT_PRUNE_DEFAULT_MAX_DELETE
): int {
    if (!in_array($table, AVESMAPS_AUDIT_PRUNE_TABLES, true)) {
        throw new InvalidArgumentException('Unbekanntes Protokoll: ' . $table);
    }

    $keepRows = max(AVESMAPS_AUDIT_PRUNE_MIN_KEEP, min(AVESMAPS_AUDIT_PRUNE_MAX_KEEP, $keepRows));
    $maxDelete = max(1, $maxDelete);

    // Die id der $keepRows-juengsten Zeile. Alles darunter ist Ueberhang. Gibt es so viele Zeilen
    // gar nicht, liefert OFFSET nichts -- dann ist nichts zu tun.
    $schwelle = $pdo->prepare(
        'SELECT id FROM ' . $table . ' ORDER BY id DESC LIMIT 1 OFFSET :offset'
    );
    $schwelle->bindValue('offset', $keepRows - 1, PDO::PARAM_INT);
    $schwelle->execute();
    $grenze = $schwelle->fetchColumn();
    if ($grenze === false || $grenze === null) {
        return 0;
    }
    $grenze = (int) $grenze;

    // Der Deckel: die id NACH den ersten $maxDelete Zeilen von unten. Gibt es so wenige, bleibt es
    // bei der Schwelle -- dann raeumt der Lauf den ganzen Ueberhang, und der ist klein.
    $deckel = $pdo->prepare(
        'SELECT id FROM ' . $table . ' ORDER BY id ASC LIMIT 1 OFFSET :offset'
    );
    $deckel->bindValue('offset', $maxDelete, PDO::PARAM_INT);
    $deckel->execute();
    $deckelId = $deckel->fetchColumn();
    if ($deckelId !== false && $deckelId !== null) {
        $grenze = min($grenze, (int) $deckelId);
    }

    $delete = $pdo->prepare('DELETE FROM ' . $table . ' WHERE id < :grenze');
    $delete->bindValue('grenze', $grenze, PDO::PARAM_INT);
    $delete->execute();

    return $delete->rowCount();
}
