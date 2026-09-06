<?php

declare(strict_types=1);

// DAS GETEILTE CRAWL-SKELETT DER DREI WIKI-SYNC-LIBS. sync-monitor.php ist das Original
// (`0945c2812`, 01.06.2026, „resumable enumeration engine"); regions.php kopierte daraus
// (`cc29579ef4`), paths.php aus regions (`fdcbfe33af`) -- im Rumpf zeichengleich bis auf die
// Queue-Tabelle (paths.php ohne den Erklaerkommentar und die zwei Leerzeilen).
// ⚠️ Ein Bugfix in einer Kopie LIEFE an den anderen vorbei -- eingetreten ist das nie: `git log -L`
// zeigt fuer alle drei Ruempfe nur ihren Erstcommit. Das Risiko ist real, der Praezedenzfall nicht.
// Der Masterplan nennt diese Datei seit M4 (`723aae060`). Die alten Namen bleiben als Weiterreicher.
// ⚠️ Diese Datei bindet NICHTS ein und kennt keine Konfiguration: PDO und Tabellenname kommen
// herein, `avesmapsWikiSyncMonitorNormalizeTitle` und `avesmapsPoliticalSlug` bringt der Wirt mit
// -- genau wie vorher, als die drei Ruempfe in den Wirtsdateien standen.

// INSERT IGNORE auf UNIQUE(run_id, dedup_key) = idempotentes Enqueue + Visited in einem.
function avesmapsWikiCrawlEnqueue(PDO $pdo, string $queueTable, string $runId, string $title, int $depth, string $role, string $source): int {
    // 💣 Der Tabellenname wandert in den SQL-TEXT, nicht in einen Platzhalter -- ein Platzhalter
    // kann keinen Bezeichner tragen. Solange er eine Konstante war, trug die Sprache den Riegel;
    // als Parameter braucht er einen eigenen. Fuer die drei Wirte ist er ein No-op, sie reichen
    // weiterhin ihre Konstante herein.
    if (preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $queueTable) !== 1) {
        throw new InvalidArgumentException('Unzulaessiger Queue-Tabellenname: ' . $queueTable);
    }

    $title = avesmapsWikiSyncMonitorNormalizeTitle($title);
    if ($title === '') {
        return 0;
    }

    $dedupKey = avesmapsPoliticalSlug($title);
    if ($dedupKey === '') {
        return 0;
    }

    $statement = $pdo->prepare(
        'INSERT IGNORE INTO ' . $queueTable . '
            (run_id, dedup_key, wiki_title, wiki_key, depth, role, source, status, created_at)
        VALUES (:run_id, :dedup_key, :wiki_title, :wiki_key, :depth, :role, :source, \'pending\', CURRENT_TIMESTAMP(3))'
    );
    $statement->execute([
        'run_id' => $runId,
        'dedup_key' => $dedupKey,
        'wiki_title' => mb_substr($title, 0, 255, 'UTF-8'),
        'wiki_key' => $role === 'page' ? $dedupKey : null,
        'depth' => $depth,
        'role' => $role,
        'source' => mb_substr($source, 0, 255, 'UTF-8'),
    ]);

    return $statement->rowCount();
}
