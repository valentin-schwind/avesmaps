<?php

declare(strict_types=1);

/**
 * In einem SQL-Literal kommt jeder benannte Platzhalter GENAU EINMAL vor.
 *
 * 🪤 WARUM ES DIESEN TEST GIBT — er ist am 20.08.2026 aus einem stillen Live-Ausfall entstanden.
 * `avesmapsLoreRuleDelete` (api/_internal/app/lore-rule-store.php) band `:id` zweimal im selben
 * Statement. `avesmapsCreatePdo` (api/_internal/bootstrap.php) setzt
 * PDO::ATTR_EMULATE_PREPARES => false, und bei NATIVEN Prepared Statements lehnt MySQL einen
 * doppelt verwendeten benannten Platzhalter mit SQLSTATE[HY093] ab: das Löschen einer
 * Vorkommen-Regel konnte auf der Live-Datenbank nie durchlaufen.
 *
 * 💣 UND DAS TESTFELD KONNTE ES NICHT SEHEN. Die Tests dieses Bereichs fahren SQLite, und SQLite
 * ERLAUBT denselben Platzhalter mehrfach — `lore-rule-store-test.php` prüft das Löschen sogar
 * ausdrücklich und blieb grün. Dieselbe Klasse wie die MySQL-Fehlermeldung 1093 aus AGENTS.md §9:
 * die Fixture kennt die Einschränkung der Produktionsdatenbank nicht. Ein Test, der die Abfrage
 * AUSFÜHRT, hilft hier also nicht — nur einer, der ihre FORM liest.
 *
 * 🔴 Dieselbe Falle war schon zweimal geschlossen worden (avesmapsWhatIsHereReadTerritories() und
 * -ReadAreas() in api/_internal/app/what-is-here.php, dort :x1/:x2 statt :x zweimal) und stand als
 * Hausregel in AGENTS.md §11. Sie ist trotzdem ein drittes Mal entstanden. Deshalb steht sie jetzt
 * nicht mehr nur als Satz da, sondern als Lauf über den Bestand.
 *
 * ⚠️ Geprüft wird das LITERAL, nicht der Aufruf. Zwei Zweige eines Ternärs sind zwei EIGENE
 * Statements, von denen nur eines vorbereitet wird — `api/edit/political/subtree-display.php` und
 * `api/edit/mail/mailbox.php` nennen denselben Platzhalter je Zweig einmal und sind in Ordnung.
 * Eine Prüfung über den ganzen prepare()-Aufruf meldete dort acht Fehltreffer.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/sql-platzhalter-einmalig-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$wurzel = str_replace('\\', '/', dirname(__DIR__, 4));

/**
 * Alle PHP-Dateien unter api/ und tools/.
 *
 * ⚠️ Anders als const-vor-benutzung-test.php laufen die `__tests__` MIT: eine Fixture in einer Form,
 * die live nie durchliefe, ist die Vorlage, aus der der nächste Schreibweg abgeschrieben wird
 * (genau so entstand der Fall in api/_internal/wiki/__tests__/sync-plan-test.php).
 *
 * @return list<string>
 */
function avesmapsPlatzhalterTestDateien(string $wurzel): array
{
    $treffer = [];
    foreach (['api', 'tools'] as $ordner) {
        $pfad = $wurzel . '/' . $ordner;
        if (!is_dir($pfad)) {
            continue;
        }
        $lauf = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($pfad, FilesystemIterator::SKIP_DOTS));
        foreach ($lauf as $datei) {
            $name = str_replace('\\', '/', (string) $datei);
            if (!str_ends_with($name, '.php')) {
                continue;
            }
            $treffer[] = $name;
        }
    }
    sort($treffer);

    return $treffer;
}

/**
 * REIN: der Wert eines PHP-Stringliterals, oder null, wenn die Form unbekannt ist.
 */
function avesmapsPlatzhalterTestLiteralWert(string $token): ?string
{
    $bs = chr(92);
    $anfang = $token[0] ?? '';
    if ($anfang === "'") {
        return str_replace([$bs . "'", $bs . $bs], ["'", $bs], substr($token, 1, -1));
    }
    if ($anfang === '"') {
        return stripcslashes(substr($token, 1, -1));
    }

    return null;
}

/**
 * REIN: alle Stringliterale einer PHP-Quelle, als [Text, Zeile].
 *
 * 💣 Benachbarte Literale werden über `.` zusammengezogen — ein Statement, das über zwei Zeilen
 * verkettet ist, ist EIN Statement. Zusammengezogen wird aber NUR Literal-Punkt-Literal: steht
 * etwas anderes dazwischen (eine Variable, ein Ternär), sind es zwei getrennte Texte, und genau
 * das hält die Ternär-Zweige auseinander.
 *
 * @return list<array{0: string, 1: int}>
 */
function avesmapsPlatzhalterTestLiterale(string $quelle): array
{
    $tokens = @token_get_all($quelle);
    $anzahl = count($tokens);
    $ueberspringen = [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT];
    $treffer = [];

    for ($i = 0; $i < $anzahl; $i++) {
        $token = $tokens[$i];

        if (is_array($token) && $token[0] === T_CONSTANT_ENCAPSED_STRING) {
            $text = avesmapsPlatzhalterTestLiteralWert($token[1]);
            if ($text === null) {
                continue;
            }
            $zeile = $token[2];
            $naechstes = $i + 1;
            while (true) {
                $punkt = $naechstes;
                while ($punkt < $anzahl && is_array($tokens[$punkt]) && in_array($tokens[$punkt][0], $ueberspringen, true)) {
                    $punkt++;
                }
                if ($punkt >= $anzahl || $tokens[$punkt] !== '.') {
                    break;
                }
                $folge = $punkt + 1;
                while ($folge < $anzahl && is_array($tokens[$folge]) && in_array($tokens[$folge][0], $ueberspringen, true)) {
                    $folge++;
                }
                if ($folge >= $anzahl || !is_array($tokens[$folge]) || $tokens[$folge][0] !== T_CONSTANT_ENCAPSED_STRING) {
                    break;
                }
                $zusatz = avesmapsPlatzhalterTestLiteralWert($tokens[$folge][1]);
                if ($zusatz === null) {
                    break;
                }
                $text .= $zusatz;
                $naechstes = $folge + 1;
            }
            $i = $naechstes - 1;
            $treffer[] = [$text, $zeile];
            continue;
        }

        if (is_array($token) && $token[0] === T_START_HEREDOC) {
            $zeile = $token[2];
            $text = '';
            for ($j = $i + 1; $j < $anzahl; $j++) {
                if (is_array($tokens[$j]) && $tokens[$j][0] === T_END_HEREDOC) {
                    $i = $j;
                    break;
                }
                $text .= is_array($tokens[$j]) ? $tokens[$j][1] : $tokens[$j];
            }
            $treffer[] = [$text, $zeile];
        }
    }

    return $treffer;
}

/**
 * REIN: sieht der Text nach einer SQL-Anweisung aus?
 */
function avesmapsPlatzhalterTestIstSql(string $text): bool
{
    return preg_match('~(SELECT|INSERT|UPDATE|DELETE|REPLACE)[ (\t\r\n]~i', $text) === 1;
}

/**
 * REIN: die benannten Platzhalter eines SQL-Literals, die MEHRFACH vorkommen — Name => Anzahl.
 *
 * ⚠️ Ein Platzhalter beginnt nie mit einer Ziffer, deshalb ist die Uhrzeit '12:30' keiner; ein
 * vorangehender Doppelpunkt oder ein Wortzeichen schließt `::` und `t:id` aus.
 *
 * @return array<string, int>
 */
function avesmapsPlatzhalterTestDoppelte(string $text): array
{
    if (!avesmapsPlatzhalterTestIstSql($text)) {
        return [];
    }
    if (preg_match_all('~(?<![:A-Za-z0-9_]):([A-Za-z_][A-Za-z0-9_]*)~', $text, $m) < 1) {
        return [];
    }

    return array_filter(array_count_values($m[1]), static fn (int $anzahl): bool => $anzahl > 1);
}

// ── Die Gegenprobe zuerst: sieht der Erkenner den echten Fall ueberhaupt? ─────────────────────
$fall = <<<'PHPQUELLE'
<?php
$pdo->prepare(
    'DELETE FROM lore_rule_term WHERE rule_id = :id
       AND rule_id IN (SELECT id FROM lore_rule WHERE id = :id AND entry_wiki_key = :wk)'
)->execute(['id' => $ruleId, 'wk' => $entryWikiKey]);
PHPQUELLE;
$fallLiterale = avesmapsPlatzhalterTestLiterale($fall);
assert($fallLiterale !== [], 'das Literal wird gar nicht erst gefunden');
assert(avesmapsPlatzhalterTestDoppelte($fallLiterale[0][0]) === ['id' => 2],
    'der Live-Ausfall vom 20.08.2026 wird nicht erkannt -- der Test ist wirkungslos');

// ⚠️ Zwei Ternaer-Zweige sind zwei Statements: kein Befund.
$ternaer = <<<'PHPQUELLE'
<?php
$statement = $pdo->prepare(
    $supportsUpdatedBy
        ? 'UPDATE political_territory SET color = :color, updated_by = :updated_by WHERE public_id = :public_id'
        : 'UPDATE political_territory SET color = :color WHERE public_id = :public_id'
);
PHPQUELLE;
foreach (avesmapsPlatzhalterTestLiterale($ternaer) as [$text, $zeile]) {
    assert(avesmapsPlatzhalterTestDoppelte($text) === [],
        "ein Ternaer-Zweig wird faelschlich gemeldet (Zeile $zeile)");
}

// ⚠️ Ueber einen Punkt verkettete Haelften sind EIN Statement: Befund.
$verkettet = <<<'PHPQUELLE'
<?php
$pdo->prepare('UPDATE t SET a = :v'
    . ' WHERE b = :v');
PHPQUELLE;
$verketteteLiterale = avesmapsPlatzhalterTestLiterale($verkettet);
assert(avesmapsPlatzhalterTestDoppelte($verketteteLiterale[0][0]) === ['v' => 2],
    'ein ueber einen Punkt verkettetes Statement wird nicht als eines gelesen');

// ⚠️ Eine Uhrzeit im SQL ist kein Platzhalter.
assert(avesmapsPlatzhalterTestDoppelte("SELECT * FROM t WHERE a = '12:30' AND b = '12:30'") === [],
    'eine Uhrzeit wird faelschlich als Platzhalter gelesen');

// ── Der Lauf ueber den Bestand ───────────────────────────────────────────────────────────────
$dateien = avesmapsPlatzhalterTestDateien($wurzel);
assert($dateien !== [], 'keine PHP-Dateien gefunden -- der Test prueft nichts');

// 💣 Diese Datei traegt die Gegenprobe oben IM Quelltext und meldete sich sonst selbst.
$selbst = str_replace('\\', '/', __FILE__);
$vorher = count($dateien);
$dateien = array_values(array_filter($dateien, static fn (string $d): bool => $d !== $selbst));
assert(count($dateien) === $vorher - 1, 'die eigene Datei wurde nicht gefunden -- die Ausnahme greift ins Leere');

$geprueft = 0;
$befunde = [];

foreach ($dateien as $datei) {
    foreach (avesmapsPlatzhalterTestLiterale((string) file_get_contents($datei)) as [$text, $zeile]) {
        if (!avesmapsPlatzhalterTestIstSql($text)) {
            continue;
        }
        $geprueft++;
        $doppelte = avesmapsPlatzhalterTestDoppelte($text);
        if ($doppelte === []) {
            continue;
        }
        $namen = [];
        foreach ($doppelte as $name => $anzahl) {
            $namen[] = ':' . $name . ' x' . $anzahl;
        }
        $befunde[] = sprintf(
            '%s:%d -- %s',
            str_replace($wurzel . '/', '', $datei),
            $zeile,
            implode(', ', $namen)
        );
    }
}

// 💣 Ohne diese Zusicherung koennte der Lauf null Literale sehen und trotzdem gruen melden.
assert($geprueft > 1000, "nur $geprueft SQL-Literale gefunden -- der Test sieht zu wenig");

assert($befunde === [], "Ein benannter Platzhalter steht MEHRFACH in einem SQL-Literal. MySQL lehnt "
    . "das bei nativen Prepared Statements mit SQLSTATE[HY093] ab (EMULATE_PREPARES => false); ein "
    . "SQLite-Test bleibt dabei gruen. Getrennt benennen (:id/:id2) und beide binden:\n  "
    . implode("\n  ", $befunde));

echo 'sql-platzhalter-einmalig-test.php: ' . count($dateien) . ' Dateien, ' . $geprueft
    . " SQL-Literale -- jeder benannte Platzhalter kommt genau einmal vor\n";
