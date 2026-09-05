<?php
declare(strict_types=1);

// Datenbankgebundener Nachweis statt Prozess-/Temp-Merker: ein Restore oder eine neue
// Datenbank muss die Migration erneut durchlaufen. Änderungen der Saat zählen mit.
function avesmapsEcosystemSchemaFingerprint(): string
{
    $files = [
        __DIR__ . '/ecosystem.php',
        __FILE__,
        __DIR__ . '/../routing/travel-values-migration.php',
        __DIR__ . '/../routing/travel-values.php',
    ];
    return hash('sha256', implode(':', array_map(static fn (string $file): string => hash_file('sha256', $file), $files)));
}

function avesmapsEcosystemSchemaCurrent(PDO $pdo, string $fingerprint): bool
{
    try {
        $statement = $pdo->query('SELECT fingerprint FROM ecosystem_schema_state WHERE id = 1');
        return $statement !== false && $statement->fetchColumn() === $fingerprint;
    } catch (PDOException $error) {
        if ($error->getCode() !== '42S02') {
            throw $error;
        }
        return false;
    }
}

function avesmapsEcosystemSchemaEnsure(PDO $pdo, callable $migrate): void
{
    // Der bestehende SQLite-Fixturepfad übersetzt selbst das MySQL-DDL.
    if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'mysql') {
        $migrate();
        return;
    }
    $fingerprint = avesmapsEcosystemSchemaFingerprint();
    if (avesmapsEcosystemSchemaCurrent($pdo, $fingerprint)) {
        return;
    }
    // MySQL-Migrationen enthalten DDL und können deshalb keine Transaktionssperre nutzen.
    // Höchstens zwei Sekunden warten; nie mehrere Selbstheilungen zugleich ausführen.
    $lock = 'avesmaps-ecosystem-' . substr(hash('sha256', (string) $pdo->query('SELECT DATABASE()')->fetchColumn()), 0, 32);
    $statement = $pdo->prepare('SELECT GET_LOCK(?, 2)');
    $statement->execute([$lock]);
    if ((int) $statement->fetchColumn() !== 1) {
        throw new RuntimeException('Die Landschaftsdaten werden gerade aktualisiert. Bitte erneut versuchen.');
    }
    try {
        if (avesmapsEcosystemSchemaCurrent($pdo, $fingerprint)) {
            return;
        }
        $migrate();
        $pdo->exec('CREATE TABLE IF NOT EXISTS ecosystem_schema_state (
            id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
            fingerprint CHAR(64) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        $statement = $pdo->prepare('INSERT INTO ecosystem_schema_state (id, fingerprint) VALUES (1, ?)
            ON DUPLICATE KEY UPDATE fingerprint = VALUES(fingerprint)');
        $statement->execute([$fingerprint]);
    } finally {
        $statement = $pdo->prepare('SELECT RELEASE_LOCK(?)');
        $statement->execute([$lock]);
    }
}
