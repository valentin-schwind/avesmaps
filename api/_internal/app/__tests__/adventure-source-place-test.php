<?php

declare(strict_types=1);

/**
 * Unit test for step 6 of docs/quellen-wiki-key-instruction.md: a source that IS an adventure
 * connects its place, and removing that source takes the connection with it -- but ONLY the one it
 * created. No DB, no HTTP. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/app/__tests__/adventure-source-place-test.php
 * Exit 0 = all asserts passed.
 *
 * The load-bearing rule is the reverse path. The instruction is explicit that removal must not take
 * a connection that already existed ("es zählt, was diese Eingabe erzeugt hat -- nicht, was
 * zufällig dasselbe Paar beschreibt"), and that a forward action without an equally immediate
 * reverse "wäre eine Falle". Both halves are asserted against the SQL that actually runs.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../adventures.php';

// Fake PDO/statement built WITHOUT a driver: records every statement and its bound parameters, and
// replays scripted column values, so the exact SQL can be asserted with no MySQL anywhere.
final class FakeAdvStmt extends PDOStatement
{
    public array $bound = [];
    public int $rows = 0;
    // The PDO itself, not its log array: PHP arrays are VALUE types, so recording into a copy
    // handed over at construction time never reaches the recorder. (It did not, at first.)
    public function __construct(private mixed $col, private FakeAdvPdo $pdo, private string $sql) {}
    public function execute(?array $params = null): bool
    {
        $this->bound = $params ?? [];
        $this->pdo->record($this->sql, $this->bound);
        return true;
    }
    public function fetchColumn(int $column = 0): mixed { return $this->col; }
    public function fetchAll(int $mode = PDO::FETCH_BOTH, mixed ...$args): array { return []; }
    public function fetch(int $mode = PDO::FETCH_BOTH, int $cursor = PDO::FETCH_ORI_NEXT, int $offset = 0): mixed { return false; }
    public function rowCount(): int { return $this->rows; }
}
final class FakeAdvPdo extends PDO
{
    /** @var list<array{sql:string,params:array}> every statement that actually executed, in order */
    public array $log = [];
    /** column value per SQL fragment, first match wins */
    public array $columns = [];
    public int $deleteRows = 1;
    public function __construct() {}
    public function record(string $sql, array $params): void
    {
        $this->log[] = ['sql' => $sql, 'params' => $params];
    }
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $col = false;
        foreach ($this->columns as $needle => $value) {
            if (str_contains($query, $needle)) { $col = $value; break; }
        }
        $stmt = new FakeAdvStmt($col, $this, $query);
        if (str_contains($query, 'DELETE')) { $stmt->rows = $this->deleteRows; }
        return $stmt;
    }
    public function query(string $query, ?int $fetchMode = null, mixed ...$args): PDOStatement|false
    {
        return new FakeAdvStmt(1, $this, $query); // "column/table already exists" -> no DDL
    }
    public function exec(string $statement): int|false { return 0; }
    /** every statement that ran, in order */
    public function statements(): array { return $this->log; }
    public function ran(string $needle): array
    {
        return array_values(array_filter($this->statements(), static fn(array $s): bool => str_contains($s['sql'], $needle)));
    }
}

$fresh = static function (array $columns = []): FakeAdvPdo {
    $pdo = new FakeAdvPdo();
    // Order matters: first match wins, so the SPECIFIC needles come before the general ones --
    // "FROM adventure_place" also occurs in the MAX(sort_order) query.
    $pdo->columns = $columns + [
        'wiki_key FROM sources' => 'die-feuer-von-gruuzash',
        'FROM adventure WHERE wiki_key' => 7,
        'MAX(sort_order)' => 3,
        'SELECT id FROM adventure_place' => false,   // no existing pair
        'FROM map_features' => 'Der Schläfer',
    ];
    return $pdo;
};

// ---- forward: a source carrying an adventure key connects the place -----------------------------
$pdo = $fresh();
$made = avesmapsAdventureLinkPlaceFromSource($pdo, 107810, 'settlement', 'schlaefer-id', 42);
assert($made === true, 'ein Abenteuer-Key erzeugt die Ortszuordnung');
$inserts = $pdo->ran('INSERT INTO adventure_place');
assert(count($inserts) === 1, 'genau eine Zeile');
$params = $inserts[0]['params'];
assert($params['aid'] === 7, 'an das Abenteuer mit diesem Key');
assert($params['kind'] === 'settlement' && $params['pid'] === 'schlaefer-id', 'an diesen Ort');
assert($params['name'] === 'Der Schläfer', 'mit dem echten Ortsnamen, nicht der id');
assert($params['ord'] === 3, 'ans Ende der Reihenfolge');
assert($params['src'] === 107810, 'mit der Herkunftsnotiz -- ohne sie ist der Rueckweg blind');
// role/origin/status are literals in the SQL: 'play' = "spielt hier" (Spoiler), and 'manual' is what
// keeps sync_adventures off it (it writes and deletes only origin='wiki').
assert(str_contains($inserts[0]['sql'], "'play'"), 'Rolle spielt hier');
assert(str_contains($inserts[0]['sql'], "'manual'"), "origin manual -> kein Reconcile fasst es an");
echo "hinweg ok\n";

// ---- the three silent no-ops -------------------------------------------------------------------
$pdo = $fresh(['wiki_key FROM sources' => '']);
assert(avesmapsAdventureLinkPlaceFromSource($pdo, 1, 'settlement', 'x') === false, 'ohne Wiki-Key passiert nichts');
assert($pdo->ran('INSERT INTO adventure_place') === [], 'und es wird nichts geschrieben');

$pdo = $fresh(['FROM adventure WHERE wiki_key' => false]);
assert(avesmapsAdventureLinkPlaceFromSource($pdo, 1, 'settlement', 'x') === false, 'Key ist kein Abenteuer (Karte, Quellenband)');
assert($pdo->ran('INSERT INTO adventure_place') === [], 'und es wird nichts geschrieben');

// "Beide Tueren, ein Ergebnis": wer Quelle UND Ort von Hand pflegt, bekommt trotzdem EINE Verbindung.
$pdo = $fresh(['FROM adventure_place' => 55]);
assert(avesmapsAdventureLinkPlaceFromSource($pdo, 1, 'settlement', 'x') === false, 'Paar existiert -> zweite Eingabe aendert nichts');
assert($pdo->ran('INSERT INTO adventure_place') === [], 'keine Dublette');

// A citymap source is the OTHER feature (Fundort) and must not fall through to the adventure path.
$pdo = $fresh();
assert(avesmapsAdventureLinkPlaceFromSource($pdo, 1, 'citymap', 'x') === false, 'citymap gehoert nicht hierher');
echo "no-ops ok\n";

// ---- reverse: takes what it made, leaves what it found ------------------------------------------
$pdo = $fresh();
$pdo->deleteRows = 1;
$removed = avesmapsAdventureUnlinkPlaceFromSource($pdo, 107810, 'settlement', 'schlaefer-id');
assert($removed === 1, 'die selbst erzeugte Zuordnung verschwindet mit der Quelle');
$deletes = $pdo->ran('DELETE FROM adventure_place');
assert(count($deletes) === 1, 'genau ein DELETE');
// THE assertion of this file: scoped by created_from_source_id, so a hand-made entry (NULL there)
// can never match. Drop this condition and removing a source silently destroys older work.
assert(str_contains($deletes[0]['sql'], 'created_from_source_id = :src'), 'nur was DIESE Quelle erzeugt hat');
assert($deletes[0]['params']['src'] === 107810, 'und zwar genau diese');
assert($deletes[0]['params']['pid'] === 'schlaefer-id', 'an diesem Ort');
assert(!str_contains($deletes[0]['sql'], 'adventure_id'), 'nicht ueber das Abenteuer -- das traefe auch fremde Zeilen');

// Nothing of ours there: a pre-existing entry survives, and the caller learns nothing was removed.
$pdo = $fresh();
$pdo->deleteRows = 0;
assert(avesmapsAdventureUnlinkPlaceFromSource($pdo, 107810, 'settlement', 'schlaefer-id') === 0, 'fremde Eintragung bleibt stehen');
echo "rueckweg ok\n";

// ---- defensive ---------------------------------------------------------------------------------
$pdo = $fresh();
assert(avesmapsAdventureLinkPlaceFromSource($pdo, 0, 'settlement', 'x') === false, 'ohne source_id');
assert(avesmapsAdventureLinkPlaceFromSource($pdo, 1, 'settlement', '') === false, 'ohne public_id');
assert(avesmapsAdventureUnlinkPlaceFromSource($pdo, 0, 'settlement', 'x') === 0, 'Rueckweg ohne source_id');
assert($pdo->ran('DELETE') === [], 'und dann auch kein DELETE');
echo "defensiv ok\n";

echo "ALL OK\n";
