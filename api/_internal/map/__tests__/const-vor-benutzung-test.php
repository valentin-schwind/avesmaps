<?php

declare(strict_types=1);

/**
 * In einer Endpunktdatei steht JEDE Konstante auf Dateiebene VOR dem `try`-Block, der die Anfrage
 * beantwortet.
 *
 * 🪤 WARUM ES DIESEN TEST GIBT — er ist am 19.08.2026 aus einem Live-Ausfall entstanden.
 * PHP hoistet FUNKTIONEN, aber KEINE `const` auf Dateiebene: eine Konstante wird erst definiert,
 * wenn der Interpreter ihre Zeile erreicht. `AVESMAPS_PATH_GROUP_DETAIL_MAX` stand unten bei ihrer
 * Funktion (Zeile 279 von api/edit/map/paths-editor.php), und der `try`-Block darüber (Zeile 45–81)
 * rief genau diese Funktion. Beim ersten echten Klick lief der Aufruf in einen Fatal Error.
 *
 * 💣 UND EIN FATAL ERROR ANTWORTET MIT EINEM LEEREN RUMPF. Im Browser stand „Failed to execute
 * 'json' on 'Response': Unexpected end of JSON input" — das liest sich wie ein Netzfehler und ist
 * keiner. Gefunden hat es der Owner beim ersten Handgriff, nicht das Testfeld: `php -l` prüft nur
 * die Syntax, und kein Test hatte den neuen Endpunkt je angefasst.
 *
 * 🔴 WARUM DIE REGEL SO GROB IST („vor dem try", nicht „vor der ersten Benutzung"): der Fehler ist
 * TRANSITIV. Im Top-Level-Code steht der Name der Konstante gar nicht — dort steht nur der Aufruf
 * einer Funktion, die sie benutzt. Eine Prüfung auf „wird der Name vorher genannt" sieht davon
 * nichts (die erste Fassung dieses Tests tat genau das und blieb bei der Mutationsprobe grün).
 * Alles, was der try-Block erreicht, kann jede Konstante der Datei brauchen — also müssen sie alle
 * vorher stehen.
 *
 * ⚠️ Am Bestand gemessen, bevor die Regel scharf gestellt wurde: 95 Dateien haben einen
 * Top-Level-`try`, und NULL davon verletzen sie. Der Test verlangt also nichts, was das Haus nicht
 * ohnehin täte — er hält es fest.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/map/__tests__/const-vor-benutzung-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$wurzel = str_replace('\\', '/', dirname(__DIR__, 4));

/**
 * Alle PHP-Dateien unter api/ und tools/ -- ohne die Tests selbst (die laufen als Skript und haben
 * keinen Endpunkt-Aufbau).
 *
 * @return list<string>
 */
function avesmapsConstTestDateien(string $wurzel): array
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
            if (!str_ends_with($name, '.php') || str_contains($name, '__tests__')) {
                continue;
            }
            $treffer[] = $name;
        }
    }
    sort($treffer);

    return $treffer;
}

/**
 * REIN: die Zeile des ausführenden `try`-Blocks einer Datei -- oder null, wenn sie keinen hat
 * (Bibliotheken haben keinen).
 *
 * ⚠️ Nur auf SPALTE 0: ein eingerücktes `try` steht in einer Funktion und ist nicht der Aufbau der
 * Anfrage.
 */
function avesmapsConstTestTryZeile(array $zeilen): ?int
{
    foreach ($zeilen as $index => $zeile) {
        if (preg_match('/^try\s*\{/', (string) $zeile) === 1) {
            return $index + 1;
        }
    }

    return null;
}

/**
 * REIN: die Zeilennummern aller Konstanten auf Dateiebene.
 *
 * @return array<string, int> Name => Zeile
 */
function avesmapsConstTestKonstanten(array $zeilen): array
{
    $treffer = [];
    foreach ($zeilen as $index => $zeile) {
        if (preg_match('/^const\s+([A-Z][A-Z0-9_]*)\s*=/', (string) $zeile, $m) === 1) {
            $treffer[(string) $m[1]] = $index + 1;
        }
    }

    return $treffer;
}

// ── Die Gegenprobe zuerst: sieht der Erkenner den Fall ueberhaupt? ────────────────────────────
$probe = preg_split('/\n/', "<?php\n\ntry {\n    echo f();\n} catch (Throwable) {\n}\n\nconst FOO = 1;\n\nfunction f(): int { return FOO; }\n");
assert(avesmapsConstTestTryZeile($probe) === 3, 'der try-Block wird nicht erkannt');
assert(avesmapsConstTestKonstanten($probe) === ['FOO' => 8], 'die Konstante wird nicht erkannt');
// ⚠️ Ein eingerücktes `try` ist KEIN Endpunkt-Aufbau.
$probe2 = preg_split('/\n/', "<?php\nfunction f(): void {\n    try {\n        g();\n    } catch (Throwable) {}\n}\nconst BAR = 1;\n");
assert(avesmapsConstTestTryZeile($probe2) === null, 'ein try INNERHALB einer Funktion wird faelschlich erkannt');

// ── Der Lauf ueber den Bestand ────────────────────────────────────────────────────────────────
$dateien = avesmapsConstTestDateien($wurzel);
assert($dateien !== [], 'keine PHP-Dateien gefunden -- der Test prueft nichts');

$mitTry = 0;
$befunde = [];

foreach ($dateien as $datei) {
    $zeilen = preg_split('/\r\n|\n|\r/', (string) file_get_contents($datei)) ?: [];
    $tryZeile = avesmapsConstTestTryZeile($zeilen);
    if ($tryZeile === null) {
        continue;
    }
    $mitTry++;

    foreach (avesmapsConstTestKonstanten($zeilen) as $name => $zeile) {
        if ($zeile > $tryZeile) {
            $befunde[] = sprintf(
                '%s: %s steht in Zeile %d, der try-Block beginnt in Zeile %d',
                str_replace($wurzel . '/', '', $datei),
                $name,
                $zeile,
                $tryZeile
            );
        }
    }
}

// 💣 Ohne diese Zusicherung koennte der Lauf null Dateien sehen und trotzdem gruen melden.
assert($mitTry > 50, "nur $mitTry Dateien mit Top-Level-try gefunden -- der Test sieht zu wenig");

assert($befunde === [], "Eine Konstante steht HINTER dem try-Block, der sie braucht -- PHP hoistet "
    . "sie nicht, der Endpunkt antwortet mit einem leeren Rumpf:\n  " . implode("\n  ", $befunde));

echo "const-vor-benutzung-test.php: " . count($dateien) . " Dateien, " . $mitTry
    . " mit Top-Level-try -- jede Konstante steht davor\n";
