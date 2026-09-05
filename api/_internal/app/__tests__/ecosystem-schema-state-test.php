<?php
declare(strict_types=1);
require_once __DIR__ . '/../ecosystem-schema-state.php';
if (ini_get('zend.assertions') !== '1') { exit(2); }

final class EcosystemMissingTableTestException extends PDOException
{
    public function __construct()
    {
        parent::__construct('missing table');
        $this->code = '42S02';
    }
}

final class EcosystemSchemaTestPdo extends PDO
{
    public int $ddl = 0;
    public bool $locked = false;
    public function getAttribute(int $attribute): mixed
    {
        return $attribute === PDO::ATTR_DRIVER_NAME ? 'mysql' : parent::getAttribute($attribute);
    }
    public function query(string $query, ?int $fetchMode = null, mixed ...$args): PDOStatement|false
    {
        if ($query === 'SELECT DATABASE()') { return parent::query("SELECT 'fixture'"); }
        try {
            return parent::query($query, $fetchMode, ...$args);
        } catch (PDOException $error) {
            if (str_contains($error->getMessage(), 'no such table: ecosystem_schema_state')) {
                throw new EcosystemMissingTableTestException();
            }
            throw $error;
        }
    }
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if (str_contains($query, 'GET_LOCK')) {
            $this->locked = true;
            return parent::prepare('SELECT 1 WHERE ? IS NOT NULL');
        }
        if (str_contains($query, 'RELEASE_LOCK')) {
            $this->locked = false;
            return parent::prepare('SELECT 1 WHERE ? IS NOT NULL');
        }
        $query = str_replace('ON DUPLICATE KEY UPDATE fingerprint = VALUES(fingerprint)',
            'ON CONFLICT(id) DO UPDATE SET fingerprint = excluded.fingerprint', $query);
        return parent::prepare($query, $options);
    }
    public function exec(string $statement): int|false
    {
        if (str_starts_with($statement, 'CREATE TABLE')) {
            $this->ddl++;
            $statement = 'CREATE TABLE IF NOT EXISTS ecosystem_schema_state (id INTEGER PRIMARY KEY, fingerprint TEXT)';
        }
        return parent::exec($statement);
    }
}
$pdo = new EcosystemSchemaTestPdo('sqlite::memory:');
$runs = 0;
$migrate = static function () use (&$runs, $pdo): void {
    assert($pdo->locked, 'Migration ist serialisiert.');
    $runs++;
};
avesmapsEcosystemSchemaEnsure($pdo, $migrate);
assert($runs === 1 && !$pdo->locked);
$ddl = $pdo->ddl;
avesmapsEcosystemSchemaEnsure($pdo, $migrate);
assert($runs === 1 && $pdo->ddl === $ddl, 'Warmer Aufruf führt weder DDL noch Saat aus.');
$pdo->exec("UPDATE ecosystem_schema_state SET fingerprint = 'alt'");
try {
    avesmapsEcosystemSchemaEnsure($pdo, static function (): void { throw new RuntimeException('Migration fehlgeschlagen'); });
    assert(false);
} catch (RuntimeException $error) {
    assert($error->getMessage() === 'Migration fehlgeschlagen');
}
assert(!$pdo->locked);
assert(!avesmapsEcosystemSchemaCurrent($pdo, avesmapsEcosystemSchemaFingerprint()), 'Fehlschlag setzt keinen Erfolgsmerker.');
avesmapsEcosystemSchemaEnsure($pdo, $migrate);
assert($runs === 2, 'Nach Fehlschlag wird erneut migriert.');
echo "OK: Schema-Nachweis, warmer Pfad und Wiederanlauf.\n";
