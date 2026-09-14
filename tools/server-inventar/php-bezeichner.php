<?php

declare(strict_types=1);

/*
 * Bezeichner aus PHP-Quelltext -- der Leseteil des Server-PHP-Inventars
 * (.github/workflows/server-php-inventar.yml, tools/server-inventar/php-inventar.py).
 *
 * 🔴 GIBT NIE DEN INHALT EINER ZEICHENKETTE ODER EINES KOMMENTARS AUS. Die Dateien kommen vom
 *    Webroot, und dort liegen auch Zugangsdaten; ins Artefakt duerfen nur Namen, Zeilennummern und
 *    Einbindungspfade. Zwei Ausnahmen, beide keine Geheimnisse: eine Zeichenkette, die selbst ein
 *    avesmaps-Funktionsname ist (Rueckruf per Name, `array_map('avesmapsX', …)`), und der Pfad
 *    hinter require/include.
 * 💣 Deshalb Tokenizer statt Regex: ein Regex sieht einen Aufruf im Kommentar oder in einer
 *    Zeichenkette genauso wie einen echten -- und meldete einen toten Aufrufer als lebend.
 * ⚠️ Ein ParseError wird nur mit seiner ZEILE gemeldet, nie mit seiner Meldung: PHP zitiert darin
 *    das unerwartete Token, und das kann eine Zeichenkette sein.
 *
 * Aufruf: php tools/server-inventar/php-bezeichner.php <verzeichnis>  -> JSON je .php-Datei
 */

function avesmapsInventarBezeichner(string $code): array
{
    $parseFehlerZeile = null;
    try {
        $tokens = token_get_all($code, TOKEN_PARSE);
    } catch (ParseError $fehler) {
        $parseFehlerZeile = $fehler->getLine();
        $tokens = token_get_all($code);
    }

    static $intern = null;
    $intern ??= array_fill_keys(array_map('strtolower', get_defined_functions()['internal']), true);

    $bedeutsam = [];
    foreach ($tokens as $token) {
        if (is_array($token) && in_array($token[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $bedeutsam[] = $token;
    }

    // 🪤 Seit PHP 8.1 ist `&` kein Zeichen-Token mehr, sondern eines von zwei benannten Tokens --
    //    ein Vergleich mit '&' uebersieht `function &name()` still.
    $undTokens = [T_AMPERSAND_FOLLOWED_BY_VAR_OR_VARARG, T_AMPERSAND_NOT_FOLLOWED_BY_VAR_OR_VARARG];
    $art = static function ($token) use ($undTokens) {
        if (!is_array($token)) {
            return $token;
        }
        return in_array($token[0], $undTokens, true) ? '&' : $token[0];
    };
    $namensTokens = [T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED];
    $einbindungsTokens = [
        T_REQUIRE => 'require', T_REQUIRE_ONCE => 'require_once',
        T_INCLUDE => 'include', T_INCLUDE_ONCE => 'include_once',
    ];

    $deklariert = [];
    $aufrufe = [];
    $rueckrufe = [];
    $einbindungen = [];
    $anzahl = count($bedeutsam);

    for ($i = 0; $i < $anzahl; $i++) {
        $token = $bedeutsam[$i];
        $typ = $art($token);

        if ($typ === T_FUNCTION) {
            $j = $i + 1;
            if ($j < $anzahl && $art($bedeutsam[$j]) === '&') {
                $j++;
            }
            if ($j < $anzahl && $art($bedeutsam[$j]) === T_STRING) {
                $deklariert[$bedeutsam[$j][1]] = $bedeutsam[$j][2];
            }
            continue;
        }

        if (in_array($typ, $namensTokens, true)) {
            $naechstes = $i + 1 < $anzahl ? $art($bedeutsam[$i + 1]) : null;
            $vorher = $i > 0 ? $art($bedeutsam[$i - 1]) : null;
            $vorVorher = $i > 1 ? $art($bedeutsam[$i - 2]) : null;
            $istDeklaration = $vorher === T_FUNCTION || ($vorher === '&' && $vorVorher === T_FUNCTION);
            $istMethodeOderKlasse = in_array(
                $vorher,
                [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON, T_NEW],
                true
            );
            if ($naechstes === '(' && !$istDeklaration && !$istMethodeOderKlasse) {
                $name = ltrim($token[1], '\\');
                if (!isset($intern[strtolower($name)])) {
                    $aufrufe[$name][$token[2]] = true;
                }
            }
            continue;
        }

        if ($typ === T_CONSTANT_ENCAPSED_STRING) {
            $wert = substr($token[1], 1, -1);
            if (preg_match('/^avesmaps[A-Za-z0-9_]*$/i', $wert) === 1) {
                $rueckrufe[$wert][$token[2]] = true;
            }
            continue;
        }

        if (isset($einbindungsTokens[$typ])) {
            $teile = [];
            for ($j = $i + 1; $j < $anzahl && $art($bedeutsam[$j]) !== ';'; $j++) {
                $teil = $bedeutsam[$j];
                $teilTyp = $art($teil);
                if ($teilTyp === T_DIR) {
                    $teile[] = '__DIR__';
                } elseif ($teilTyp === T_CONSTANT_ENCAPSED_STRING || $teilTyp === T_VARIABLE
                    || in_array($teilTyp, $namensTokens, true)) {
                    $teile[] = $teil[1];
                } elseif (in_array($teilTyp, ['.', '(', ')', ',', '[', ']'], true)) {
                    $teile[] = $teilTyp;
                } else {
                    // Alles andere (etwa eine Zeichenkette mit Variablen) zaehlt nur als Platzhalter.
                    $teile[] = '…';
                }
            }
            $einbindungen[] = [
                'zeile' => $token[2],
                'art' => $einbindungsTokens[$typ],
                'pfad' => substr(implode(' ', $teile), 0, 240),
            ];
        }
    }

    $zeilenListe = static function (array $tabelle): array {
        ksort($tabelle, SORT_STRING | SORT_FLAG_CASE);
        return array_map(static fn (array $zeilen) => array_keys($zeilen), $tabelle);
    };
    ksort($deklariert, SORT_STRING | SORT_FLAG_CASE);

    return [
        'parse_fehler_zeile' => $parseFehlerZeile,
        'deklariert' => $deklariert,
        'aufrufe' => $zeilenListe($aufrufe),
        'rueckrufe_als_zeichenkette' => $zeilenListe($rueckrufe),
        'einbindungen' => $einbindungen,
    ];
}

if (PHP_SAPI === 'cli' && isset($argv[0]) && realpath($argv[0]) === __FILE__) {
    $wurzel = rtrim((string) ($argv[1] ?? ''), '/\\');
    if ($wurzel === '' || !is_dir($wurzel)) {
        fwrite(STDERR, "Aufruf: php php-bezeichner.php <verzeichnis>\n");
        exit(2);
    }
    $ergebnis = [];
    $dateien = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($wurzel, FilesystemIterator::SKIP_DOTS));
    foreach ($dateien as $datei) {
        if (!$datei->isFile() || strtolower($datei->getExtension()) !== 'php') {
            continue;
        }
        $relativ = str_replace('\\', '/', substr($datei->getPathname(), strlen($wurzel) + 1));
        $ergebnis[$relativ] = avesmapsInventarBezeichner((string) file_get_contents($datei->getPathname()));
    }
    ksort($ergebnis);
    echo json_encode(
        $ergebnis,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
    ), "\n";
}
