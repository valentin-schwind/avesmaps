<?php

declare(strict_types=1);

/**
 * Unit test for the source-catalog typeahead (docs/quellen-wiki-key-instruction.md section 5a).
 * No DB, no HTTP. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/app/__tests__/source-search-test.php
 * Exit 0 = all asserts passed.
 *
 * The load-bearing part is the LIKE escaping: a catalog full of titles with "%" or "_" in them is
 * unlikely, but a USER typing either is not, and an unescaped "%" would silently match everything --
 * turning "no suggestion" into "every suggestion" exactly when the editor is least able to tell.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../feature-sources.php';

// A Fake PDO/PDOStatement built WITHOUT a driver (empty constructor). It records every prepared
// query plus its bound parameters and replays scripted rows, so the SQL shape can be asserted with
// no MySQL anywhere. query() always reports "index/column already exists" so the self-healing DDL
// stays out of the way.
final class FakeSearchStmt extends PDOStatement
{
    public array $bound = [];
    public function __construct(private array $rows, private mixed $col = 1) {}
    public function execute(?array $params = null): bool
    {
        $this->bound = $params ?? [];
        return true;
    }
    public function fetchColumn(int $column = 0): mixed { return $this->col; }
    public function fetchAll(int $mode = PDO::FETCH_BOTH, mixed ...$args): array { return $this->rows; }
}
final class FakeSearchPdo extends PDO
{
    /** @var array<int,array{sql:string,stmt:FakeSearchStmt}> every prepared statement, in order */
    public array $prepared = [];
    /** @var string[] every exec()'d statement -- DDL must NOT fire when things already exist */
    public array $execs = [];
    /** rows returned by the 1st prepare (catalog hits) and the 2nd (use counts) */
    public function __construct(private array $catalogRows, private array $countRows = []) {}
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $isCount = str_contains($query, 'COUNT(*) AS uses');
        $stmt = new FakeSearchStmt($isCount ? $this->countRows : $this->catalogRows);
        $this->prepared[] = ['sql' => $query, 'stmt' => $stmt];
        return $stmt;
    }
    public function query(string $query, ?int $fetchMode = null, mixed ...$args): PDOStatement|false
    {
        return new FakeSearchStmt([], 1); // "already exists" -> no ALTER
    }
    public function exec(string $statement): int|false
    {
        $this->execs[] = $statement;
        return 0;
    }
}

$catalog = static fn(FakeSearchPdo $pdo): array => $pdo->prepared[0]['stmt']->bound;
$sqlOf = static fn(FakeSearchPdo $pdo, int $i): string => $pdo->prepared[$i]['sql'];

// ---- LIKE escaping: user wildcards are literals ------------------------------------------------
// "%" must arrive escaped, otherwise the query degenerates to "match everything".
$pdo = new FakeSearchPdo([]);
avesmapsSearchSourceCatalog($pdo, '50%', 8);
assert($catalog($pdo)['contains'] === '%50\%%', 'percent is escaped, then wrapped');
assert($catalog($pdo)['prefix'] === '50\%%', 'prefix keeps the trailing wildcard only');

$pdo = new FakeSearchPdo([]);
avesmapsSearchSourceCatalog($pdo, 'a_b', 8);
assert($catalog($pdo)['contains'] === '%a\_b%', 'underscore (single-char wildcard) is escaped');

// Backslash first: escaping "%" before "\" would double-escape the inserted backslashes.
$pdo = new FakeSearchPdo([]);
avesmapsSearchSourceCatalog($pdo, 'a\\b', 8);
assert($catalog($pdo)['contains'] === '%a\\\\b%', 'backslash is escaped exactly once');
echo "escaping ok\n";

// ---- ordinary term, ranking + limit ------------------------------------------------------------
$pdo = new FakeSearchPdo([]);
avesmapsSearchSourceCatalog($pdo, 'Blutmond', 8);
assert($catalog($pdo)['contains'] === '%Blutmond%', 'plain term is untouched');
assert(str_contains($sqlOf($pdo, 0), 'LIMIT 8'), 'limit is inlined after validation');
assert(str_contains($sqlOf($pdo, 0), 'label LIKE :prefix'), 'prefix hits rank above substring hits');
assert(str_contains($sqlOf($pdo, 0), 'is_official DESC'), 'official ranks above unofficial');
assert(str_contains($sqlOf($pdo, 0), 'url LIKE :contains_url'), 'a pasted URL finds its existing row');
// The two CREATE TABLE IF NOT EXISTS always fire (project idiom, self-healing DDL). What must NOT
// fire is an ALTER: when the index and columns already exist, a search is pure reads.
assert(count($pdo->execs) === 2, 'only the two idempotent CREATE TABLEs');
assert(!str_contains(implode(' ', $pdo->execs), 'ALTER'), 'no ALTER when the index already exists');

// The limit is clamped on BOTH ends -- it lands in the SQL string, so a hostile value must never
// reach it (and "limit=0" must not silently return nothing).
foreach ([[0, 1], [-5, 1], [999, 10], [3, 3]] as [$given, $expected]) {
    $pdo = new FakeSearchPdo([]);
    avesmapsSearchSourceCatalog($pdo, 'x', $given);
    assert(str_contains($sqlOf($pdo, 0), 'LIMIT ' . $expected), "limit $given clamps to $expected");
}
echo "ranking + limit ok\n";

// ---- empty result: no second query -------------------------------------------------------------
// Counting uses for an empty id list would build "IN ()" -- a syntax error, not an empty result.
$pdo = new FakeSearchPdo([]);
assert(avesmapsSearchSourceCatalog($pdo, 'nothing', 8) === [], 'no hits -> empty list');
assert(count($pdo->prepared) === 1, 'no hits -> the use-count query is never issued');
echo "empty result ok\n";

// ---- shape + use counts ------------------------------------------------------------------------
$pdo = new FakeSearchPdo(
    [
        ['id' => 7, 'url' => 'https://example.org/b1', 'label' => 'Blutmond I', 'source_type' => 'abenteuer', 'is_official' => 1],
        ['id' => 9, 'url' => '', 'label' => 'Blutmond II', 'source_type' => 'roman', 'is_official' => 0],
    ],
    [['source_id' => 7, 'uses' => 34]]
);
$result = avesmapsSearchSourceCatalog($pdo, 'Blutmond', 8);

assert(count($result) === 2, 'both hits come back');
assert($result[0] === [
    'source_id' => 7,
    'url' => 'https://example.org/b1',
    'label' => 'Blutmond I',
    'type' => 'abenteuer',
    'official' => true,
    'uses' => 34,
], 'row shape is the client contract');
assert($result[1]['official'] === false, 'is_official 0 -> false, not "0"');
// A source nobody cites yet is a legitimate hit -- it must appear with 0, not be dropped.
assert($result[1]['uses'] === 0, 'uncited source -> uses 0');

// The count query asks only about the ids actually returned, never the whole 55k-row table.
assert(str_contains($sqlOf($pdo, 1), 'IN (?,?)'), 'use counts are scoped to the returned ids');
assert($pdo->prepared[1]['stmt']->bound === [7, 9], 'exactly the returned ids are bound');
assert(str_contains($sqlOf($pdo, 1), "status = 'approved'"), 'suppressed links are not counted as uses');
echo "shape + use counts ok\n";

echo "ALL OK\n";
