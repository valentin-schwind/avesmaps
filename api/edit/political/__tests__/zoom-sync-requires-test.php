<?php

declare(strict_types=1);

/**
 * Jeder Endpunkt unter api/edit/political/ ruft nur Funktionen auf, die er auch LADEN kann.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *     api/edit/political/__tests__/zoom-sync-requires-test.php
 *
 * 💣 DER ANLASS: assignment-zoom-sync.php lud nur territory.php, rief aber
 * avesmapsPoliticalReadPublicId und avesmapsPoliticalReadOptionalZoom (territories-read.php) sowie
 * avesmapsPoliticalAssertZoomRange (territories-support.php) auf. "Call to undefined function" ist
 * eine blanke Error-Ausnahme; das catch(Throwable) des Endpunkts machte daraus einen allgemeinen
 * 500, und die Ursache stand nirgends. Gemeldet am 15.08.2026 als "irgendein 500 beim Speichern".
 *
 * ⚠️ Es fiel jahrelang nicht auf, weil die drei erst in der Nutzlast-Schleife stehen: ohne Eintraege
 * mit territoryPublicId kehrt der Endpunkt vorher zurueck und antwortet 200. Er sah gesund aus,
 * solange er nichts zu tun hatte.
 *
 * 🔴 GEPRUEFT WIRD MIT DEM PHP-TOKENIZER, NICHT MIT MUSTERSUCHE. Eine Regex-Sonde hat mir am
 * 16.08.2026 zwei FEHLBEFUNDE geliefert, und ich habe sie dem Owner als Befund gemeldet:
 *   - display-overrides.php definiert elf dieser Funktionen SELBST, eingerueckt in
 *     `if (!function_exists(...))`-Bloecken -- ein Muster auf `^function` sieht sie nicht.
 *   - subtree-display.php nennt avesmapsPoliticalInvalidateLayerCache() nur in einem KOMMENTAR.
 * Der Tokenizer kennt beides: er liefert Definitionen unabhaengig von der Einrueckung und
 * ueberspringt Kommentare. Wer hier auf Regex zurueckbaut, baut die zwei Fehlbefunde wieder ein.
 *
 * ⭐ Statisch, nicht ladend: die require-Ketten werden gelesen, nicht ausgefuehrt. So braucht der
 * Test keine Datenbank, keine Konfiguration und keine Erweiterungen -- und ein Endpunkt kann seine
 * Nachbarn nicht mit ihren Ladezeilen decken, was beim Laden in EINEM Prozess passieren wuerde.
 */

$verzeichnis = dirname(__DIR__);

// ---- Werkzeuge ---------------------------------------------------------------------------------

/** Alle in einer Datei DEFINIERTEN Funktionsnamen -- gleich auf welcher Einrueckung. */
function avesmapsTestSammleDefinitionen(string $datei): array {
    $namen = [];
    $tokens = token_get_all((string) file_get_contents($datei));
    for ($i = 0, $n = count($tokens); $i < $n; $i++) {
        if (!is_array($tokens[$i]) || $tokens[$i][0] !== T_FUNCTION) {
            continue;
        }
        for ($j = $i + 1; $j < $n; $j++) {
            if (is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) {
                continue;
            }
            if (is_array($tokens[$j]) && $tokens[$j][0] === T_STRING) {
                $namen[] = $tokens[$j][1];
            }
            break; // alles andere ist eine anonyme Funktion oder ein Rueckgabetyp-Pfeil
        }
    }
    return $namen;
}

/** Alle AUFGERUFENEN avesmaps-Funktionen -- ohne Kommentare, ohne Methoden, ohne Definitionen. */
function avesmapsTestSammleAufrufe(string $datei): array {
    $namen = [];
    $tokens = token_get_all((string) file_get_contents($datei));
    $letztesBedeutendes = null;
    foreach ($tokens as $index => $token) {
        if (is_array($token) && in_array($token[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        if (is_array($token) && $token[0] === T_STRING && str_starts_with($token[1], 'avesmaps')) {
            // Folgt eine oeffnende Klammer? Dann ist es ein Aufruf.
            for ($j = $index + 1, $n = count($tokens); $j < $n; $j++) {
                if (is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) {
                    continue;
                }
                if ($tokens[$j] === '(') {
                    // ⚠️ Nicht die Definition selbst, und keine Methode ($x->f(), Klasse::f()).
                    $davor = is_array($letztesBedeutendes) ? $letztesBedeutendes[0] : null;
                    if ($davor !== T_FUNCTION && $davor !== T_OBJECT_OPERATOR && $davor !== T_DOUBLE_COLON) {
                        $namen[] = $token[1];
                    }
                }
                break;
            }
        }
        $letztesBedeutendes = $token;
    }
    return $namen;
}

/** Die require-Kette einer Datei, rekursiv. Gibt [dateien, unaufloesbar] zurueck. */
function avesmapsTestSammleRequires(string $datei, array &$gesehen = []): array {
    $echt = realpath($datei);
    if ($echt === false || isset($gesehen[$echt])) {
        return [[], []];
    }
    $gesehen[$echt] = true;

    // 💣 Auch hier der Tokenizer, nicht die Mustersuche: das Wort "require" steht in dieser
    // Codebasis reichlich in Kommentaren ("required", "requires", Erklaertexte). Eine Regex
    // haelt jeden davon fuer eine unaufloesbare Ladezeile und ueberspringt den Endpunkt --
    // der Test meldete daraufhin "0 Endpunkte geprueft" und war damit gruen, ohne etwas zu tun.
    $tokens = token_get_all((string) file_get_contents($echt));
    $dateien = [];
    $unaufloesbar = [];

    for ($i = 0, $n = count($tokens); $i < $n; $i++) {
        if (!is_array($tokens[$i]) || !in_array($tokens[$i][0], [T_REQUIRE, T_REQUIRE_ONCE, T_INCLUDE, T_INCLUDE_ONCE], true)) {
            continue;
        }
        // ⚠️ `$config = require $pfad;` laedt DATEN, keinen Code -- die Datei gibt ein Array zurueck
        // und definiert nichts (bootstrap.php holt so config.local.php). Solche Zeilen duerfen die
        // Pruefung nicht als "unaufloesbar" lahmlegen; sonst uebersprang der Test JEDEN Endpunkt und
        // meldete "0 geprueft" -- gruen, ohne etwas zu tun.
        $davor = null;
        for ($k = $i - 1; $k >= 0; $k--) {
            if (is_array($tokens[$k]) && in_array($tokens[$k][0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $davor = $tokens[$k];
            break;
        }
        if ($davor === '=') {
            continue;
        }
        // Den Ausdruck bis zum Semikolon einsammeln (ohne Leerraum und Kommentare).
        $ausdruck = [];
        for ($j = $i + 1; $j < $n && $tokens[$j] !== ';'; $j++) {
            if (is_array($tokens[$j]) && in_array($tokens[$j][0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            $ausdruck[] = $tokens[$j];
        }
        // Erwartet wird genau __DIR__ . '<pfad>'.
        $istDirPfad = count($ausdruck) === 3
            && is_array($ausdruck[0]) && $ausdruck[0][0] === T_DIR
            && $ausdruck[1] === '.'
            && is_array($ausdruck[2]) && $ausdruck[2][0] === T_CONSTANT_ENCAPSED_STRING;
        if (!$istDirPfad) {
            $unaufloesbar[] = 'dynamisch';
            continue;
        }
        $ziel = realpath(dirname($echt) . trim($ausdruck[2][1], "'\""));
        if ($ziel === false) {
            $unaufloesbar[] = $ausdruck[2][1];
            continue;
        }
        $dateien[] = $ziel;
        [$tiefer, $tieferUnaufloesbar] = avesmapsTestSammleRequires($ziel, $gesehen);
        $dateien = array_merge($dateien, $tiefer);
        $unaufloesbar = array_merge($unaufloesbar, $tieferUnaufloesbar);
    }

    return [$dateien, $unaufloesbar];
}

// ---- Die Werkzeuge zuerst an den zwei Fehlbefunden pruefen --------------------------------------
// Ohne das ist der Test nur so gut wie sein Sammler -- und genau der lag daneben.
$definitionenOverrides = avesmapsTestSammleDefinitionen($verzeichnis . '/display-overrides.php');
assert(
    in_array('avesmapsPoliticalReadPublicId', $definitionenOverrides, true),
    'Eingerueckte Definitionen in function_exists-Bloecken werden gefunden (Fehlbefund 1).'
);
$aufrufeSubtree = avesmapsTestSammleAufrufe($verzeichnis . '/subtree-display.php');
assert(
    !in_array('avesmapsPoliticalInvalidateLayerCache', $aufrufeSubtree, true),
    'Ein Name im KOMMENTAR ist kein Aufruf (Fehlbefund 2).'
);
assert(
    in_array('avesmapsLoadApiConfig', $aufrufeSubtree, true),
    'Echte Aufrufe werden trotzdem gefunden -- sonst waere der Sammler nur blind.'
);

// ---- Und dann jeden Endpunkt des Verzeichnisses -------------------------------------------------
$endpunkte = glob($verzeichnis . '/*.php') ?: [];
assert($endpunkte !== [], 'Es gibt Endpunkte zu pruefen.');

$befunde = [];
$geprueft = 0;
foreach ($endpunkte as $endpunkt) {
    [$geladeneDateien, $unaufloesbar] = avesmapsTestSammleRequires($endpunkt);
    // ⚠️ Ein require, das der Test nicht aufloesen kann (Variable im Pfad), macht die Aussage
    // wertlos -- dann lieber ueberspringen als falsch gruen melden.
    if ($unaufloesbar !== []) {
        continue;
    }

    $verfuegbar = avesmapsTestSammleDefinitionen($endpunkt);
    foreach ($geladeneDateien as $geladen) {
        $verfuegbar = array_merge($verfuegbar, avesmapsTestSammleDefinitionen($geladen));
    }
    $verfuegbar = array_flip($verfuegbar);

    $fehlend = [];
    foreach (array_unique(avesmapsTestSammleAufrufe($endpunkt)) as $name) {
        if (!isset($verfuegbar[$name]) && !function_exists($name)) {
            $fehlend[] = $name;
        }
    }
    if ($fehlend !== []) {
        $befunde[] = basename($endpunkt) . ' -> ' . implode(', ', $fehlend);
    }
    $geprueft++;
}

assert(
    $befunde === [],
    "Endpunkte rufen Funktionen auf, die ihre require-Ketten nicht laden:\n  " . implode("\n  ", $befunde)
);

echo "zoom-sync-requires: {$geprueft} Endpunkte geprueft, alle Aufrufe gedeckt.\n";
