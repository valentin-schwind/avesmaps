<?php

declare(strict_types=1);

function avesmapsDiscordEnsureCasesTable(PDO $pdo): void {
    $driver = (string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);

    if ($driver === 'mysql') {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS discord_cases (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                kind ENUM(\'bug\',\'idea\',\'question\') NOT NULL,
                title VARCHAR(300) NOT NULL,
                body TEXT NOT NULL,
                location VARCHAR(500) NULL,
                reporter VARCHAR(190) NOT NULL,
                reporter_id VARCHAR(40) NULL,
                channel_id VARCHAR(40) NULL,
                message_id VARCHAR(40) NULL,
                status ENUM(\'open\',\'solved\') NOT NULL DEFAULT \'open\',
                created_at DATETIME NOT NULL,
                solved_at DATETIME NULL,
                solved_by VARCHAR(190) NULL,
                INDEX idx_status_created (status, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
        );

        return;
    }

    // Portable variant (tests: SQLite). message_id is reserved for Phase 1b.
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS discord_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            location TEXT NULL,
            reporter TEXT NOT NULL,
            reporter_id TEXT NULL,
            channel_id TEXT NULL,
            message_id TEXT NULL,
            status TEXT NOT NULL DEFAULT \'open\',
            created_at TEXT NOT NULL,
            solved_at TEXT NULL,
            solved_by TEXT NULL
        )'
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_status_created ON discord_cases (status, created_at)');
}

function avesmapsDiscordInsertCase(PDO $pdo, array $case): int {
    $statement = $pdo->prepare(
        'INSERT INTO discord_cases (kind, title, body, location, reporter, reporter_id, channel_id, status, created_at)
         VALUES (:kind, :title, :body, :location, :reporter, :reporter_id, :channel_id, \'open\', :created_at)'
    );
    $statement->execute([
        ':kind' => (string) ($case['kind'] ?? ''),
        ':title' => (string) ($case['title'] ?? ''),
        ':body' => (string) ($case['body'] ?? ''),
        ':location' => ($case['location'] ?? '') !== '' ? (string) $case['location'] : null,
        ':reporter' => (string) ($case['reporter'] ?? ''),
        ':reporter_id' => ($case['reporter_id'] ?? '') !== '' ? (string) $case['reporter_id'] : null,
        ':channel_id' => ($case['channel_id'] ?? '') !== '' ? (string) $case['channel_id'] : null,
        ':created_at' => (string) ($case['created_at'] ?? ''),
    ]);

    return (int) $pdo->lastInsertId();
}

function avesmapsDiscordOpenCases(PDO $pdo): array {
    $statement = $pdo->query(
        'SELECT id, kind, title, body, location, reporter, created_at
         FROM discord_cases WHERE status = \'open\' ORDER BY created_at ASC, id ASC'
    );
    $rows = $statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];

    return array_map(static function (array $row): array {
        return [
            'id' => (int) $row['id'],
            'kind' => (string) $row['kind'],
            'title' => (string) $row['title'],
            'body' => (string) $row['body'],
            'location' => (string) ($row['location'] ?? ''),
            'reporter' => (string) $row['reporter'],
            'created_at' => (string) $row['created_at'],
        ];
    }, $rows);
}

function avesmapsDiscordCloseCase(PDO $pdo, int $id, string $solvedBy, string $solvedAt): bool {
    $statement = $pdo->prepare(
        'UPDATE discord_cases SET status = \'solved\', solved_at = :solved_at, solved_by = :solved_by
         WHERE id = :id AND status = \'open\''
    );
    $statement->execute([':solved_at' => $solvedAt, ':solved_by' => $solvedBy, ':id' => $id]);

    return $statement->rowCount() > 0;
}
