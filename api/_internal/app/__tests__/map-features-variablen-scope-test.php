<?php

declare(strict_types=1);

/**
 * Benutzt eine Funktion in map-features.php eine Variable, die es in ihrem Scope gar nicht gibt?
 *   php -d zend.assertions=1 -d assert.exception=1 \
 *       api/_internal/app/__tests__/map-features-variablen-scope-test.php
 *
 * 🔴 AM 23.08.2026 HAT GENAU DAS DIE LIVE-KARTE ZWEIMAL GETROFFEN, in derselben Datei:
 *   (1) Die zwei Wappen-Schalter wurden im HAUPTSKRIPT gesetzt und in zwei FUNKTIONEN benutzt.
 *       Unter strict_types wurde aus dem `null` ein TypeError -- HTTP 500 fuer alle Besucher,
 *       35 Minuten lang, bei gruenem Deploy und gruenem Testfeld.
 *   (2) Ein `if (!$settlementCoatsEnabled && …)` stand in einer dritten Funktion, in der es die
 *       Variable ebenfalls nicht gab. Das warf NICHT -- `!null` ist `true`, der Zweig lief
 *       einfach immer. Solche Fehler haben kein spaetes Zeichen; sie sehen aus wie ein Feature.
 *
 * ⭐ Gelesen wird mit PHPs EIGENEM Tokenizer (`token_get_all`), nicht mit Mustern. Eine erste
 * Fassung arbeitete mit Regex und war zweimal falsch: erst hielt sie jedes ARGUMENT eines Aufrufs
 * fuer eine Parameterdeklaration (dann findet sie nie etwas), dann zerlegte ihre
 * Zeichenketten-Ersetzung die Signaturen (dann meldet sie alles). Wer Code parsen will, nimmt
 * einen Parser.
 *
 * ⚠️ Es bleibt eine Heuristik ueber DYNAMISCHES PHP (`extract`, variable Variablen, `global`).
 * Sie ist so gebaut, dass sie eher zu wenig meldet als falschen Alarm zu geben -- eine Pruefung,
 * die grundlos rot wird, schaltet man ab. Fuer die zwei echten Faelle reicht sie: dort war die
 * Variable im ganzen Rumpf nirgends gesetzt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'. Neu starten mit: "
        . "php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

/**
 * Sucht in PHP-Quelltext Funktionen, die eine Variable benutzen, ohne sie zu kennen.
 *
 * @return list<string> Fundstellen als "funktion(): $variable"
 */
function avesmapsScopeVerdacht(string $quelle): array {
    $token = token_get_all($quelle);
    $anzahl = count($token);
    $verdacht = [];

    // Superglobals und $this gelten ueberall.
    $immerBekannt = array_fill_keys(
        ['this', 'GLOBALS', '_GET', '_POST', '_SERVER', '_ENV', '_FILES', '_COOKIE', '_SESSION', '_REQUEST'],
        true
    );

    for ($i = 0; $i < $anzahl; $i++) {
        if (!is_array($token[$i]) || $token[$i][0] !== T_FUNCTION) {
            continue;
        }
        // Nur benannte Top-Level-Funktionen; Closures im Rumpf werden mitgelesen (siehe unten).
        $j = $i + 1;
        while ($j < $anzahl && is_array($token[$j]) && in_array($token[$j][0], [T_WHITESPACE, T_AMPERSAND_FOLLOWED_BY_VAR_OR_VARARG ?? -1], true)) {
            $j++;
        }
        if (!is_array($token[$j] ?? null) || $token[$j][0] !== T_STRING) {
            continue;
        }
        $name = (string) $token[$j][1];

        // --- Signatur: alles zwischen der ersten '(' und ihrer ')' ---------------------------
        $k = $j;
        while ($k < $anzahl && $token[$k] !== '(') {
            $k++;
        }
        $bekannt = $immerBekannt;
        $tiefe = 0;
        for (; $k < $anzahl; $k++) {
            if ($token[$k] === '(') {
                $tiefe++;
            } elseif ($token[$k] === ')') {
                $tiefe--;
                if ($tiefe === 0) {
                    break;
                }
            } elseif (is_array($token[$k]) && $token[$k][0] === T_VARIABLE) {
                $bekannt[ltrim((string) $token[$k][1], '$')] = true;
            }
        }

        // --- Rumpf: von '{' bis zur passenden '}' ---------------------------------------------
        while ($k < $anzahl && $token[$k] !== '{') {
            if ($token[$k] === ';') {
                break; // abstrakte Deklaration o.ae.
            }
            $k++;
        }
        if (($token[$k] ?? null) !== '{') {
            continue;
        }
        $tiefe = 0;
        $rumpf = [];
        for (; $k < $anzahl; $k++) {
            if ($token[$k] === '{') {
                $tiefe++;
            } elseif ($token[$k] === '}') {
                $tiefe--;
                if ($tiefe === 0) {
                    break;
                }
            }
            $rumpf[] = $token[$k];
        }

        // --- Was der Rumpf KENNT ---------------------------------------------------------------
        // ⚠️ Verschachtelte Closures und Arrow-Funktionen werden als DERSELBE Scope gelesen: ihre
        // Parameter und `use`-Variablen zaehlen mit. Das meldet im Zweifel zu wenig -- gewollt.
        //
        // 💣 EIN KOMMA BINDET NICHT. `foo($a, $b)` ist ein AUFRUF; wer `, $x` als Deklaration
        // liest, kennt jede Variable, die irgendwo uebergeben wird, und findet nie etwas. Genau
        // dieser Fehler steckte in beiden frueheren Fassungen dieses Tests -- einmal als Regex,
        // einmal als Token-Regel. Bindend ist nur, was einem SCHLUESSELWORT folgt oder links von
        // einer Zuweisung steht.
        $anzahlRumpf = count($rumpf);

        // (a) Klammern nach bindenden Schluesselwoertern: function(…) / fn(…) / use(…) / catch(…)
        //     / list(…). Alles darin ist eine Deklaration.
        for ($m = 0; $m < $anzahlRumpf; $m++) {
            $t = $rumpf[$m];
            if (!is_array($t) || !in_array($t[0], [T_FUNCTION, T_FN, T_USE, T_CATCH, T_LIST], true)) {
                continue;
            }
            $k2 = $m;
            while ($k2 < $anzahlRumpf && $rumpf[$k2] !== '(') {
                // Nicht ueber das Ende der Anweisung hinaus suchen.
                if ($rumpf[$k2] === ';' || $rumpf[$k2] === '{') {
                    break;
                }
                $k2++;
            }
            if (($rumpf[$k2] ?? null) !== '(') {
                continue;
            }
            $t2 = 0;
            for (; $k2 < $anzahlRumpf; $k2++) {
                if ($rumpf[$k2] === '(') {
                    $t2++;
                } elseif ($rumpf[$k2] === ')') {
                    $t2--;
                    if ($t2 === 0) {
                        break;
                    }
                } elseif (is_array($rumpf[$k2]) && $rumpf[$k2][0] === T_VARIABLE) {
                    $bekannt[ltrim((string) $rumpf[$k2][1], '$')] = true;
                }
            }
        }

        // (b) Zuweisungen, `as`, `global`, `static` -- und Destrukturierung `[$a, $b] = …`.
        for ($m = 0; $m < $anzahlRumpf; $m++) {
            $t = $rumpf[$m];
            if (!is_array($t) || $t[0] !== T_VARIABLE) {
                continue;
            }
            $varName = ltrim((string) $t[1], '$');

            $n = $m + 1;
            while ($n < $anzahlRumpf && is_array($rumpf[$n]) && $rumpf[$n][0] === T_WHITESPACE) {
                $n++;
            }
            $folgt = $rumpf[$n] ?? null;
            $istZuweisung = $folgt === '='
                || (is_array($folgt) && in_array($folgt[0], [
                    T_PLUS_EQUAL, T_MINUS_EQUAL, T_MUL_EQUAL, T_DIV_EQUAL, T_CONCAT_EQUAL,
                    T_MOD_EQUAL, T_AND_EQUAL, T_OR_EQUAL, T_XOR_EQUAL, T_SL_EQUAL, T_SR_EQUAL,
                    T_COALESCE_EQUAL, T_POW_EQUAL,
                ], true));

            $p = $m - 1;
            while ($p >= 0 && is_array($rumpf[$p]) && $rumpf[$p][0] === T_WHITESPACE) {
                $p--;
            }
            $davor = $rumpf[$p] ?? null;
            $bindend = is_array($davor)
                && in_array($davor[0], [T_AS, T_GLOBAL, T_STATIC, T_DOUBLE_ARROW], true);

            if ($istZuweisung || $bindend) {
                $bekannt[$varName] = true;
                continue;
            }

            // Destrukturierung: die Variable steht in einer eckigen Klammer, hinter deren Ende ein
            // `=` folgt. ⚠️ Ohne diese Pruefung waere `$liste[$i]` schon eine Deklaration.
            if ($davor === '[' || $davor === ',') {
                $auf = $m;
                $t3 = 0;
                while ($auf >= 0) {
                    if ($rumpf[$auf] === ']') {
                        $t3++;
                    } elseif ($rumpf[$auf] === '[') {
                        if ($t3 === 0) {
                            break;
                        }
                        $t3--;
                    }
                    $auf--;
                }
                if ($auf < 0) {
                    continue;
                }
                // Steht direkt VOR der oeffnenden Klammer eine Variable, ist es ein Indexzugriff.
                $vor = $auf - 1;
                while ($vor >= 0 && is_array($rumpf[$vor]) && $rumpf[$vor][0] === T_WHITESPACE) {
                    $vor--;
                }
                if (is_array($rumpf[$vor] ?? null) && $rumpf[$vor][0] === T_VARIABLE) {
                    continue;
                }
                // Ende der Klammer suchen und pruefen, ob ein `=` folgt.
                $zu = $auf;
                $t4 = 0;
                for (; $zu < $anzahlRumpf; $zu++) {
                    if ($rumpf[$zu] === '[') {
                        $t4++;
                    } elseif ($rumpf[$zu] === ']') {
                        $t4--;
                        if ($t4 === 0) {
                            break;
                        }
                    }
                }
                $nach = $zu + 1;
                while ($nach < $anzahlRumpf && is_array($rumpf[$nach]) && $rumpf[$nach][0] === T_WHITESPACE) {
                    $nach++;
                }
                if (($rumpf[$nach] ?? null) === '=') {
                    $bekannt[$varName] = true;
                    continue;
                }

                // ⚠️ `foreach (… as [$a, $b])` bindet ebenfalls -- nur folgt dort kein `=`, sondern
                // die schliessende Klammer des foreach. Genau diese Bauform war der EINZIGE
                // Fehlalarm der Pruefung an der echten Datei; sie steht hier, statt die Zusicherung
                // aufzuweichen. Eine Pruefung, die man wegen Fehlalarmen abschaltet, wacht nichts.
                $vorKlammer = $auf - 1;
                while ($vorKlammer >= 0 && is_array($rumpf[$vorKlammer]) && $rumpf[$vorKlammer][0] === T_WHITESPACE) {
                    $vorKlammer--;
                }
                if (is_array($rumpf[$vorKlammer] ?? null) && $rumpf[$vorKlammer][0] === T_AS) {
                    $bekannt[$varName] = true;
                }
            }
        }

        // --- Was er BENUTZT --------------------------------------------------------------------
        foreach ($rumpf as $t) {
            if (!is_array($t) || $t[0] !== T_VARIABLE) {
                continue;
            }
            $varName = ltrim((string) $t[1], '$');
            if (!isset($bekannt[$varName])) {
                $verdacht[] = $name . '(): $' . $varName;
            }
        }

        $i = $k;
    }

    return array_values(array_unique($verdacht));
}

// ---- DIE GEGENPROBE ZUERST ---------------------------------------------------------------------
// 💣 Sie steht VOR der eigentlichen Pruefung, weil eine Heuristik, die nie etwas findet, von einer
// bestandenen Pruefung nicht zu unterscheiden ist. Beide frueheren Fassungen dieses Tests waren
// genau so kaputt -- gruen, und blind.
$originalfehler = <<<'PHP'
<?php
function avesmapsBeispiel(array $row): string {
    return avesmapsIrgendwas($row, $coatsLocalEnabled, $coatsWikiEnabled);
}
PHP;
$gefunden = avesmapsScopeVerdacht($originalfehler);
sort($gefunden);
assert($gefunden === ['avesmapsBeispiel(): $coatsLocalEnabled', 'avesmapsBeispiel(): $coatsWikiEnabled'],
    'DIE GEGENPROBE: die Pruefung erkennt den Originalfehler vom 23.08.2026. Gefunden: '
    . (implode(', ', $gefunden) ?: '(nichts)'));

// Und der zweite Fall -- der, der NICHT wirft und deshalb der gefaehrlichere ist.
$stillerFehler = <<<'PHP'
<?php
function avesmapsBeispielZwei(array $properties): array {
    if (!$settlementCoatsEnabled) {
        $properties['x'] = '';
    }
    return $properties;
}
PHP;
assert(avesmapsScopeVerdacht($stillerFehler) === ['avesmapsBeispielZwei(): $settlementCoatsEnabled'],
    'DIE ZWEITE GEGENPROBE: auch ein `!$undefiniert` in einer Bedingung wird gefunden -- der Fall, '
    . 'der nicht wirft und deshalb monatelang unbemerkt laufen kann');

// ⚠️ Und sie darf gesunden Code NICHT melden, sonst wird sie abgeschaltet.
$gesund = <<<'PHP'
<?php
function avesmapsGesund(PDO $pdo, bool $an = true): array {
    static $memo = [];
    $liste = [];
    foreach ($pdo->query('SELECT 1') as $key => $row) {
        [$a, $b] = [$key, $row];
        $liste[] = $an ? $a : $b;
    }
    $filter = static fn (int $x): bool => $x > 0 && $an;
    $summe = array_filter($liste, $filter);
    try {
        $memo[] = $summe;
    } catch (Throwable $e) {
        unset($e);
    }
    return $memo;
}
PHP;
assert(avesmapsScopeVerdacht($gesund) === [],
    'gesunder Code wird nicht gemeldet, sonst schaltet die naechste Sitzung die Pruefung ab. '
    . 'Gemeldet: ' . implode(', ', avesmapsScopeVerdacht($gesund)));

// ---- DIE EIGENTLICHE PRUEFUNG ------------------------------------------------------------------
$WURZEL = dirname(__DIR__, 4);
$quelle = (string) file_get_contents($WURZEL . '/api/app/map-features.php');
assert($quelle !== '', 'map-features.php muss lesbar sein');

$verdacht = avesmapsScopeVerdacht($quelle);
assert($verdacht === [],
    "DER KERN: map-features.php benutzt Variablen ausserhalb ihres Scopes:\n  - "
    . implode("\n  - ", $verdacht)
    . "\n\nDas ist die Fehlerklasse, die am 23.08.2026 die Live-Karte lahmgelegt hat. Unter "
    . "strict_types wird daraus ein TypeError (HTTP 500); in einer Bedingung wie `!\$x` wird "
    . "daraus etwas Schlimmeres -- ein Zweig, der immer laeuft und nie auffaellt.");

echo "OK: map-features-variablen-scope-test -- keine Variable ausserhalb ihres Scopes\n";
