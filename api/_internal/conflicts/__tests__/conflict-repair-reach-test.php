<?php

declare(strict_types=1);

/**
 * Die REICHWEITE der Reparatur-Verben, an einer echten Datenbank. Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll \
 *       api/_internal/conflicts/__tests__/conflict-repair-reach-test.php
 *
 * Der reine Nachbartest (conflict-repair-test.php) sichert die WEICHE. Er kann aber nicht sehen, ob
 * ein Schreibweg sie ueberhaupt fragt -- und genau dort sass der Fehler: die Weiche war da, der
 * Verb "Artikel uebernehmen" fragte sie nicht. Deshalb hier eine SQLite-Karte mit echten Zeilen und
 * die Frage, wie viele davon ein Klick wirklich trifft. Hausform wie
 * api/_internal/map/__tests__/powerline-anchor-delete-test.php.
 *
 * 💣 Beide Knoepfe stehen am SELBEN Fall (wiki.missing_key, nach Namen zusammengefasst). Reichte
 * einer ueber die Linie und der andere ueber ein Segment, liesse sich eine Linie ganz loesen, aber
 * nur zu einem Sechstel verknuepfen -- und das saehe aus wie "der Link hat nicht gegriffen".
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../repair.php';

/**
 * Die EINZIGE MySQL-eigene Anweisung im Schreibpfad ist der Revisionszaehler
 * (avesmapsNextMapRevision, `ON DUPLICATE KEY UPDATE`). SQLite schreibt dasselbe als `ON CONFLICT`.
 * Uebersetzt wird an der Treiber-Naht statt die Funktion nachzubauen -- sonst prueft der Test eine
 * Kopie und nicht den Code, der live laeuft.
 */
final class AvesmapsConflictReachTestPdo extends PDO
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

$pdo = new AvesmapsConflictReachTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT,
    name TEXT,
    feature_type TEXT,
    is_active INTEGER DEFAULT 1,
    properties_json TEXT,
    revision INTEGER DEFAULT 0,
    updated_by INTEGER NULL
)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('CREATE TABLE map_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id INTEGER NULL,
    action TEXT,
    actor_user_id INTEGER,
    before_json TEXT,
    after_json TEXT
)');

$HEXENBAND_URL = 'https://de.wiki-aventurica.de/wiki/Hexenband';
$FREMD_URL = 'https://de.wiki-aventurica.de/wiki/Basiliuslinie';
$wikiTitles = [
    'hexenband' => ['url' => $HEXENBAND_URL],
    'auelsend' => ['url' => 'https://de.wiki-aventurica.de/wiki/Auelsend'],
];

/** Setzt die Karte auf den Ausgangszustand zurueck -- jede Probe faengt sauber an. */
$seed = static function (PDO $pdo, array $extraProperties = []): void {
    $pdo->exec('DELETE FROM map_features');
    $pdo->exec('DELETE FROM map_audit_log');
    $pdo->exec('DELETE FROM map_revision');
    $insert = $pdo->prepare(
        'INSERT INTO map_features (public_id, name, feature_type, is_active, properties_json)
         VALUES (?, ?, ?, ?, ?)'
    );
    // Die Linie unter Beobachtung: SECHS aktive Segmente, genau der Livebestandsfall.
    for ($i = 1; $i <= 6; $i++) {
        $props = $extraProperties['pl-' . $i] ?? [];
        $insert->execute(['pl-' . $i, 'Hexenband', 'powerline', 1, json_encode((object) $props)]);
    }
    // Ein stillgelegtes Segment desselben Namens -- es ist von der Karte weg und darf nicht mit.
    $insert->execute(['pl-tot', 'Hexenband', 'powerline', 0, json_encode((object) [])]);
    // Eine ANDERE Linie: sie beweist, dass die Gruppenabfrage am Namen haengt und nicht am Typ.
    $insert->execute(['bl-1', 'Basiliuslinie', 'powerline', 1, json_encode((object) [])]);
    $insert->execute(['bl-2', 'Basiliuslinie', 'powerline', 1, json_encode((object) [])]);
    // 🔴 ZWEI Doerfer mit demselben Namen. Fuer eine nicht-segmentierte Art ist eine Zeile ein
    // Objekt; wuerde hier nach Namen gefasst, traefe ein Klick beide.
    $insert->execute(['loc-1', 'Auelsend', 'location', 1, json_encode((object) [])]);
    $insert->execute(['loc-2', 'Auelsend', 'location', 1, json_encode((object) [])]);
};
/** Der gespeicherte Anspruch einer Zeile. */
$claimOf = static function (PDO $pdo, string $publicId): string {
    $stmt = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = ?');
    $stmt->execute([$publicId]);
    $props = json_decode((string) $stmt->fetchColumn(), true);

    return is_array($props) ? trim((string) ($props['wiki_url'] ?? '')) : '';
};
$hasNoArticleFlag = static function (PDO $pdo, string $publicId): bool {
    $stmt = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = ?');
    $stmt->execute([$publicId]);
    $props = json_decode((string) $stmt->fetchColumn(), true);

    return is_array($props) && !empty($props['wiki_no_article']);
};
$auditCount = static function (PDO $pdo, string $action): int {
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM map_audit_log WHERE action = ?');
    $stmt->execute([$action]);

    return (int) $stmt->fetchColumn();
};

// === 1) "Artikel uebernehmen" fasst die LINIE ==================================================
// 💣 DIE Zusicherung, die faellt, wenn jemand die Weiche fuer diesen Verb wieder eng zieht.
$seed($pdo);
$linked = avesmapsConflictLinkFeature($pdo, 'pl-3', $wikiTitles, 7);
assert($linked['ok'] === true);
assert($linked['written'] === 6, 'ein Klick verknuepft alle sechs Segmente, nicht eines');
for ($i = 1; $i <= 6; $i++) {
    assert($claimOf($pdo, 'pl-' . $i) === $HEXENBAND_URL, 'Segment pl-' . $i . ' traegt den Artikel');
}
// Die Raender: stillgelegt bleibt draussen, die Nachbarlinie unberuehrt, die Doerfer auch.
assert($claimOf($pdo, 'pl-tot') === '', 'ein stillgelegtes Segment ist von der Karte weg');
assert($claimOf($pdo, 'bl-1') === '' && $claimOf($pdo, 'bl-2') === '', 'die andere Linie bleibt unberuehrt');
assert($claimOf($pdo, 'loc-1') === '', 'und ein fremder Typ erst recht');
// Jede geschriebene Zeile bekommt ihren eigenen Protokolleintrag -- sonst waere die Haelfte der
// Aenderung unsichtbar und nicht rueckgaengig zu machen.
assert($auditCount($pdo, 'conflict_link') === 6, 'sechs Zeilen, sechs Protokolleintraege');

// === 2) Eine Geschwisterzeile mit eigenem Anspruch wird UEBERSPRUNGEN, nicht abgebrochen =======
$seed($pdo, ['pl-2' => ['wiki_url' => $FREMD_URL]]);
$partial = avesmapsConflictLinkFeature($pdo, 'pl-1', $wikiTitles, 7);
assert($partial['ok'] === true, 'der Vorgang bricht nicht ab');
assert($partial['written'] === 5, 'fuenf geschrieben, eine uebersprungen');
assert($claimOf($pdo, 'pl-2') === $FREMD_URL, 'die fremde Verknuepfung wird nicht ueberschrieben');
assert($claimOf($pdo, 'pl-5') === $HEXENBAND_URL, 'die uebrigen aber schon');

// === 3) Traegt die ZIELZEILE schon etwas, wird abgelehnt -- und nichts geschrieben =============
$seed($pdo, ['pl-1' => ['wiki_url' => $FREMD_URL]]);
$refused = avesmapsConflictLinkFeature($pdo, 'pl-1', $wikiTitles, 7);
assert($refused['ok'] === false);
assert(str_contains((string) $refused['reason'], 'bereits eine Verknüpfung'));
assert($claimOf($pdo, 'pl-4') === '', 'eine Ablehnung an der Zielzeile schreibt gar nichts');
assert($auditCount($pdo, 'conflict_link') === 0);

// === 4) Der Gedaechtnisstrich: zweites Segment derselben Linie im SELBEN Aufruf ================
// 💣 Ein geteilter Artikel wird nicht nach Namen zusammengefasst, "Behält den Link" schickt also
// alle Segmente einzeln. Ohne den Strich liefe die zweite Zeile in "traegt bereits eine
// Verknuepfung" -- die der erste Aufruf gerade selbst geschrieben hat.
$seed($pdo);
$handled = [];
$first = avesmapsConflictLinkFeature($pdo, 'pl-1', $wikiTitles, 7, $handled);
$second = avesmapsConflictLinkFeature($pdo, 'pl-2', $wikiTitles, 7, $handled);
assert($first['written'] === 6);
assert($second['ok'] === true, 'das zweite Ziel ist KEIN Fehler');
assert($second['written'] === 0 && $second['changed'] === false, 'und schreibt nicht noch einmal');
assert($auditCount($pdo, 'conflict_link') === 6, 'sechs Protokolleintraege, nicht zwoelf');

// === 5) Eine nicht-segmentierte Art fasst NUR ihre eigene Zeile ================================
// 🔴 Ohne diese Probe waere "fasst den Namensverbund" ein Freibrief, der von zwei gleichnamigen
// Doerfern beide traefe.
$seed($pdo);
$single = avesmapsConflictLinkFeature($pdo, 'loc-1', $wikiTitles, 7);
assert($single['written'] === 1, 'ein Ort ist eine Zeile');
assert($claimOf($pdo, 'loc-2') === '', 'das gleichnamige Nachbardorf bleibt unberuehrt');

// === 6) "Kein Wiki-Eintrag" fasst die Linie ebenso -- der Ausloeser des ganzen Umbaus ==========
$seed($pdo);
avesmapsConflictLinkFeature($pdo, 'pl-1', $wikiTitles, 7);
$marked = avesmapsConflictUnlinkFeature($pdo, 'pl-4', $HEXENBAND_URL, true, 7);
assert($marked['ok'] === true);
assert($marked['written'] === 6, 'der Merker gilt der Linie, nicht dem Segment');
for ($i = 1; $i <= 6; $i++) {
    assert($claimOf($pdo, 'pl-' . $i) === '', 'Segment pl-' . $i . ' ist geloest');
    assert($hasNoArticleFlag($pdo, 'pl-' . $i) === true, 'Segment pl-' . $i . ' traegt den Merker');
}
assert($hasNoArticleFlag($pdo, 'bl-1') === false, 'die andere Linie bekommt keinen Merker');
assert($auditCount($pdo, 'conflict_no_article') === 6);

// === 7) Und auch beim Trennen bleibt ein Ort eine Zeile ========================================
$seed($pdo);
avesmapsConflictLinkFeature($pdo, 'loc-1', $wikiTitles, 7);
avesmapsConflictLinkFeature($pdo, 'loc-2', $wikiTitles, 7);
$unlinkedOne = avesmapsConflictUnlinkFeature($pdo, 'loc-1', '', false, 7);
assert($unlinkedOne['written'] === 1);
assert($claimOf($pdo, 'loc-2') !== '', 'das gleichnamige Nachbardorf behaelt seinen Link');

fwrite(STDOUT, "conflict-repair-reach-test: alle Zusicherungen erfuellt\n");
