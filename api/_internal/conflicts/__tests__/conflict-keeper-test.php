<?php

declare(strict_types=1);

/**
 * "Behält den Link" darf den BEHALTER nicht mittrennen. Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll \
 *       api/_internal/conflicts/__tests__/conflict-keeper-test.php
 *
 * 🔴 DER DATENVERLUST, den dieser Test festnagelt (gemessen 15.08.2026, live): Der Client drueckt
 * "Behält den Link" als `run(keep, "unlink", others)` aus -- der Behalter steht NICHT in der
 * Zielliste. Solange jedes Ziel nur seine eigene Zeile traf, war das die sicherste Form von "lass
 * den in Ruhe". Seit ein Ziel den ganzen Namensverbund fasst, zieht das erste Ziel den Behalter mit
 * hinein: sechs Segmente, ein Klick, danach traegt NIEMAND mehr den Artikel -- und es meldet
 * Erfolg, weil der Fall danach aus der Liste verschwindet.
 *
 * 💣 GEPRUEFT WIRD UEBER avesmapsConflictResolve MIT EINER ECHTEN ZIELLISTE, nicht ueber die
 * Einzelverben. Genau durch diese Luecke ist der Fehler gefallen: jedes Verb fuer sich war richtig,
 * erst ihr Zusammenspiel ueber eine Zielliste war es nicht.
 *
 * ⚠️ GRENZE DIESES TESTS: SQLite vergleicht `name` BINAER. Live steht die Spalte in
 * utf8mb4_unicode_ci, vergleicht also ohne Ruecksicht auf Gross-/Kleinschreibung und mit ss = ß.
 * Die Verbund-Abfrage fasst live deshalb MEHR Zeilen als hier. Fuer die Aussagen dieses Tests
 * (der Behalter bleibt verschont) ist das die sichere Richtung; wer hier eine Zusicherung ueber
 * Namensgleichheit sucht, findet sie nicht -- die steht auf der PHP-Seite im Nachbartest
 * conflict-repair-test.php (avesmapsConflictRepairGroupKey).
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../repair.php';

/** Wie im Nachbartest: die einzige MySQL-eigene Anweisung im Schreibpfad an der Treiber-Naht. */
final class AvesmapsConflictKeeperTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }

        return parent::exec($statement);
    }
}

$ARTIKEL = 'https://de.wiki-aventurica.de/wiki/Hexenband';

$pdo = new AvesmapsConflictKeeperTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT, name TEXT, feature_type TEXT,
    is_active INTEGER DEFAULT 1, properties_json TEXT,
    revision INTEGER DEFAULT 0, updated_by INTEGER NULL
)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('CREATE TABLE map_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
    actor_user_id INTEGER, before_json TEXT, after_json TEXT
)');

/**
 * Der Livefall: EIN Artikel, beansprucht von sechs Segmenten EINER Kraftlinie und von einem Ort.
 * Genau diese Mischung erzeugt einen Konflikt mit sieben Parteien, von denen sechs zusammengehoeren.
 */
$seed = static function (PDO $pdo) use ($ARTIKEL): void {
    $pdo->exec('DELETE FROM map_features');
    $pdo->exec('DELETE FROM map_audit_log');
    $pdo->exec('DELETE FROM map_revision');
    $insert = $pdo->prepare(
        'INSERT INTO map_features (public_id, name, feature_type, is_active, properties_json) VALUES (?, ?, ?, ?, ?)'
    );
    for ($i = 1; $i <= 6; $i++) {
        $insert->execute(['pl-' . $i, 'Hexenband', 'powerline', 1, json_encode(['wiki_url' => $ARTIKEL])]);
    }
    $insert->execute(['loc-gareth', 'Gareth', 'location', 1, json_encode(['wiki_url' => $ARTIKEL])]);
};
$claimOf = static function (PDO $pdo, string $publicId): string {
    $stmt = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = ?');
    $stmt->execute([$publicId]);
    $props = json_decode((string) $stmt->fetchColumn(), true);

    return is_array($props) ? trim((string) ($props['wiki_url'] ?? '')) : '';
};
$segmentsWithClaim = static function (PDO $pdo) use ($claimOf): int {
    $count = 0;
    for ($i = 1; $i <= 6; $i++) {
        if ($claimOf($pdo, 'pl-' . $i) !== '') {
            $count++;
        }
    }

    return $count;
};
/** Genau die Form, die js/review/review-conflicts.js schickt. */
$party = static fn(string $type, string $id): array => ['type' => $type, 'id' => $id];

// === 1) Der Behalter IST ein Segment -- seine ganze Linie behaelt den Artikel ===================
// 💣 DIE Zusicherung, die vor der Reparatur fiel: vorher standen hier 0 von 6.
$seed($pdo);
avesmapsConflictResolve($pdo, [
    'mode' => 'unlink',
    'wiki_url' => $ARTIKEL,
    // Der Client laesst den Behalter aus den Zielen weg und nennt ihn in `keep` (und seit jeher
    // auch in subject_id).
    'targets' => [$party('powerline', 'pl-2'), $party('powerline', 'pl-3'), $party('powerline', 'pl-4'),
        $party('powerline', 'pl-5'), $party('powerline', 'pl-6'), $party('location', 'loc-gareth')],
    'keep' => $party('powerline', 'pl-1'),
    'subject_type' => 'powerline',
    'subject_id' => 'pl-1',
], 7);
assert($segmentsWithClaim($pdo) === 6, 'die ganze Linie des Behalters behaelt den Artikel');
assert($claimOf($pdo, 'pl-1') === $ARTIKEL, 'der Behalter selbst zuerst');
// 🔴 Nicht nur die eine Behalter-Zeile: eine Linie, deren Segmente verschieden verlinkt sind, ist
// genau der Zustand, den die Verbund-Reichweite verhindern soll.
assert($claimOf($pdo, 'pl-6') === $ARTIKEL, 'und jedes seiner Geschwistersegmente');
// Der Ort ist eine eigene Partei und wird getrennt -- sonst haette der Klick gar nichts getan.
assert($claimOf($pdo, 'loc-gareth') === '', 'die fremde Partei verliert den Artikel');

// === 2) Der Behalter ist der ORT -- dann verliert die ganze Linie =============================
$seed($pdo);
avesmapsConflictResolve($pdo, [
    'mode' => 'unlink',
    'wiki_url' => $ARTIKEL,
    'targets' => [$party('powerline', 'pl-1'), $party('powerline', 'pl-2'), $party('powerline', 'pl-3'),
        $party('powerline', 'pl-4'), $party('powerline', 'pl-5'), $party('powerline', 'pl-6')],
    'keep' => $party('location', 'loc-gareth'),
    'subject_type' => 'location',
    'subject_id' => 'loc-gareth',
], 7);
assert($segmentsWithClaim($pdo) === 0, 'die Linie wird ganz getrennt');
assert($claimOf($pdo, 'loc-gareth') === $ARTIKEL, 'der Ort behaelt ihn');

// === 3) ⚠️ AUSGELIEFERTE Clients ohne `keep` sind ebenso geschuetzt ============================
// Sie schicken seit jeher subject_id = die Partei am Knopf; beim Behalten steht sie gerade NICHT
// unter den Zielen. Eine gecachte alte index.html haelt sich nicht daran, wann wir etwas
// ausrollen (AGENTS.md §7) -- deshalb muss dieser Weg dieselbe Antwort geben.
$seed($pdo);
avesmapsConflictResolve($pdo, [
    'mode' => 'unlink',
    'wiki_url' => $ARTIKEL,
    'targets' => [$party('powerline', 'pl-2'), $party('powerline', 'pl-3'), $party('powerline', 'pl-4'),
        $party('powerline', 'pl-5'), $party('powerline', 'pl-6'), $party('location', 'loc-gareth')],
    'subject_type' => 'powerline',
    'subject_id' => 'pl-1',
], 7);
assert($segmentsWithClaim($pdo) === 6, 'auch ohne keep bleibt die Linie des Behalters verschont');
assert($claimOf($pdo, 'loc-gareth') === '');

// === 4) Sagt die Anfrage GAR NICHTS ueber einen Behalter, wird eng geschrieben =================
// Lieber zu wenig getroffen als der Verlust aus Fall 1.
$seed($pdo);
avesmapsConflictResolve($pdo, [
    'mode' => 'unlink',
    'wiki_url' => $ARTIKEL,
    'targets' => [$party('powerline', 'pl-2')],
], 7);
assert($claimOf($pdo, 'pl-2') === '', 'das genannte Ziel wird getrennt');
assert($segmentsWithClaim($pdo) === 5, 'aber NUR es -- ohne Behalter-Angabe keine Verbundschreibung');

// === 5) "Trennen" und "Kein Wiki-Eintrag" fassen weiter die Linie ==============================
// Dort steht die handelnde Partei SELBST unter den Zielen, es gibt also keinen Behalter -- die
// Reichweite aus W1 bleibt unangetastet. Ohne diese Probe koennte der Riegel oben sie stillegen.
$seed($pdo);
avesmapsConflictResolve($pdo, [
    'mode' => 'unlink',
    'wiki_url' => $ARTIKEL,
    'targets' => [$party('powerline', 'pl-3')],
    'subject_type' => 'powerline',
    'subject_id' => 'pl-3',
], 7);
assert($segmentsWithClaim($pdo) === 0, '"Trennen" an einem Segment trennt die ganze Linie');

$seed($pdo);
avesmapsConflictResolve($pdo, [
    'mode' => 'no_wiki',
    'wiki_url' => $ARTIKEL,
    'targets' => [$party('powerline', 'pl-3')],
    'keep' => null,
    'subject_type' => 'powerline',
    'subject_id' => 'pl-3',
], 7);
assert($segmentsWithClaim($pdo) === 0, '"Kein Wiki-Eintrag" ebenso -- der Ausloeser der ganzen Reichweite');
$stmt = $pdo->query("SELECT COUNT(*) FROM map_audit_log WHERE action = 'conflict_no_article'");
assert((int) $stmt->fetchColumn() === 6, 'und jede Zeile hat ihren Protokolleintrag');

// === 6) Die reine Haelfte: wer ist der Behalter? ===============================================
$explicit = avesmapsConflictResolveKeeper(['keep' => ['type' => 'powerline', 'id' => 'pl-1'], 'subject_id' => 'pl-9'], ['pl-2']);
assert($explicit === ['keeper' => 'pl-1', 'known' => true], 'die ausdrueckliche Angabe schlaegt den Rueckfall');

$derived = avesmapsConflictResolveKeeper(['subject_id' => 'pl-1'], ['pl-2', 'pl-3']);
assert($derived === ['keeper' => 'pl-1', 'known' => true], 'nicht unter den Zielen ⇒ Behalter');

$acting = avesmapsConflictResolveKeeper(['subject_id' => 'pl-3'], ['pl-3']);
assert($acting === ['keeper' => '', 'known' => true], 'unter den Zielen ⇒ kein Behalter, aber wir WISSEN es');

$blind = avesmapsConflictResolveKeeper([], ['pl-3']);
assert($blind === ['keeper' => '', 'known' => false], 'gar keine Angabe ⇒ nichts gewusst, also eng schreiben');

$blank = avesmapsConflictResolveKeeper(['keep' => null, 'subject_id' => ''], ['pl-3']);
assert($blank === ['keeper' => '', 'known' => false], 'leere Angaben sind keine Angaben');

fwrite(STDOUT, "conflict-keeper-test: alle Zusicherungen erfuellt\n");
