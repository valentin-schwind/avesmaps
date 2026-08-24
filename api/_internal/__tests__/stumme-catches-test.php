<?php

declare(strict_types=1);

/**
 * Die Sperrklinke gegen stumme catch-Bloecke. Ausfuehren:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/stumme-catches-test.php
 *
 * 🔴 SIE VERLANGT KEINE VERBESSERUNG, SIE VERBIETET EINE VERSCHLECHTERUNG. Am 24.08.2026 waren
 * 310 von 621 catch-Bloecken unter `api/` stumm — sie schreiben nichts, werfen nichts und
 * antworten nicht. Die 310 an einem Tag abzuarbeiten ist weder noetig noch klug; sie duerfen nur
 * nicht 311 werden. Ein Aufraeumprojekt haette einen Anfang und ein Ende, diese Klinke hat nur
 * eine Richtung — und wirkt sofort.
 *
 * 🪤 WARUM DAS UEBERHAUPT ZAEHLT — Live-Ausfall vom 24.08.2026. `map-features.php` antwortete
 * jedem Besucher mit HTTP 500, die Karte blieb leer, Deploy und Testfeld waren gruen, und die
 * Revert-Botschaft (91587cd) musste schreiben: „NICHT DIAGNOSTIZIERT, nur zurueckgebaut". Der
 * Grund lag in einem `catch (Throwable)` desselben Endpunkts. Dieselbe Fehlerklasse steht in
 * AGENTS.md dreimal als eigene Lehre (HY093 bei „Was ist hier?", der inerte `catch { return []; }`
 * bei den Vorkommen, die stille MySQL-Kuerzung der Tempowerte). Es sind nicht drei Lehren.
 *
 * 💣 GEZAEHLT WIRD MIT `token_get_all`, NICHT MIT EINEM REGEX, und das ist beim Bau dieses Tests
 * teuer gelernt worden. Ein Regex sieht Kommentare und Zeichenketten als Code — in beide
 * Richtungen falsch: das Beispiel `} catch (Throwable) { return []; }` in einem Docblock zaehlte
 * als stummer Block, und umgekehrt galt jeder catch als behandelt, dessen KOMMENTAR das Wort
 * `throw` oder `error_log` enthielt. Die Regex-Fassung meldete 289 statt 310 — sie unterschaetzte
 * den Bestand um 21 und haette damit als Klinke 21 neue stumme Bloecke durchgelassen.
 *
 * ⚠️ „Behandelt" heisst hier bewusst wenig: irgendein `throw`, `echo`, `error_log`,
 * `trigger_error`, ein `avesmaps…Response` oder der Trichter `avesmapsSchluck…`. Der Test prueft
 * NICHT, ob die Behandlung gut ist — nur, ob der Block ueberhaupt eine Spur hinterlaesst. Mehr
 * kann er von aussen nicht wissen, und weniger waere wirkungslos.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Erneut starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

/**
 * 🔴 DIE OBERGRENZE. Sie darf nur SINKEN. Wer sie anhebt, macht die Diagnoselage schlechter als
 * am 24.08.2026 — und dann bitte mit einer Begruendung im Commit, nicht im Vorbeigehen.
 */
const AVESMAPS_STUMME_CATCHES_OBERGRENZE = 300;

// ⚠️ Zwei Ebenen: __DIR__ ist api/_internal/__tests__, gezaehlt wird ganz api/. Die erste
// Fassung nahm eine Ebene und pruefte damit nur api/_internal -- die Selbstprobe darunter hat
// genau das gefangen (345 statt 621 Bloecke).
$apiWurzel = dirname(__DIR__, 2);

/**
 * Zaehlt die catch-Bloecke einer Datei, die keinerlei Spur hinterlassen.
 *
 * @return array{gesamt:int, stumm:int}
 */
$zaehleDatei = static function (string $datei): array {
    $tokens = token_get_all((string) file_get_contents($datei));
    $anzahl = count($tokens);
    $gesamt = 0;
    $stumm = 0;

    for ($i = 0; $i < $anzahl; $i++) {
        if (!is_array($tokens[$i]) || $tokens[$i][0] !== T_CATCH) {
            continue;
        }
        $gesamt++;

        // Bis zur oeffnenden Klammer des Blocks. Dazwischen liegt nur die Typliste.
        $j = $i;
        while ($j < $anzahl && $tokens[$j] !== '{') {
            $j++;
        }
        if ($j >= $anzahl) {
            continue;
        }

        $tiefe = 1;
        $behandelt = false;
        for ($j++; $j < $anzahl && $tiefe > 0; $j++) {
            $token = $tokens[$j];

            if ($token === '{') {
                $tiefe++;
                continue;
            }
            if ($token === '}') {
                $tiefe--;
                continue;
            }
            if (!is_array($token)) {
                continue;
            }

            // ⚠️ T_THROW / T_ECHO als Token, nicht als Text -- ein `throw` im Kommentar ist
            // T_COMMENT und faellt hier heraus. Genau daran ist die Regex-Fassung gescheitert.
            if ($token[0] === T_THROW || $token[0] === T_ECHO) {
                $behandelt = true;
                continue;
            }
            if ($token[0] !== T_STRING) {
                continue;
            }

            $name = $token[1];
            if ($name === 'error_log'
                || $name === 'trigger_error'
                || str_starts_with($name, 'avesmapsSchluck')
                || preg_match('/^avesmaps\w*(Json|Error|ServerError)Response$/', $name) === 1
            ) {
                $behandelt = true;
            }
        }

        if (!$behandelt) {
            $stumm++;
        }
    }

    return ['gesamt' => $gesamt, 'stumm' => $stumm];
};

$gesamt = 0;
$stumm = 0;
$proDatei = [];

$dateien = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($apiWurzel));
foreach ($dateien as $datei) {
    if (!$datei->isFile() || $datei->getExtension() !== 'php') {
        continue;
    }
    $pfad = $datei->getPathname();

    // ⚠️ Testdateien bleiben draussen: ein Test DARF einen Fehler stumm schlucken, das ist dort
    // oft die Zusicherung selbst.
    if (str_contains($pfad, '__tests__')) {
        continue;
    }

    $ergebnis = $zaehleDatei($pfad);
    // Relativ zum Repo -- ein absoluter Pfad in der Fehlermeldung ist auf jedem Rechner ein anderer.
    $pfad = ltrim(substr($pfad, strlen(dirname($apiWurzel))), DIRECTORY_SEPARATOR);
    $gesamt += $ergebnis['gesamt'];
    $stumm += $ergebnis['stumm'];
    if ($ergebnis['stumm'] > 0) {
        $proDatei[$pfad] = $ergebnis['stumm'];
    }
}

// 💣 Die Selbstprobe: findet der Zaehler ueberhaupt noch etwas? Ein Zaehler, der durch einen
// verrutschten Pfad oder eine geaenderte Token-Konstante auf 0 faellt, ist gruen und wertlos --
// dieselbe Klasse wie ein Kreis, der nur leer sein kann.
assert($gesamt > 400, "der Zaehler findet catch-Bloecke (gefunden: {$gesamt}) -- sonst prueft er nichts");

if ($stumm > AVESMAPS_STUMME_CATCHES_OBERGRENZE) {
    arsort($proDatei);
    $spitze = '';
    foreach (array_slice($proDatei, 0, 5, true) as $pfad => $anzahl) {
        $spitze .= sprintf("    %3d  %s\n", $anzahl, $pfad);
    }

    fwrite(STDERR, sprintf(
        "\nSPERRKLINKE: stumme catch-Bloecke gestiegen -- %d, erlaubt sind %d.\n\n"
        . "Ein catch antwortet, wirft weiter, oder geht durch den Trichter:\n"
        . "    } catch (Throwable \$fehler) { return avesmapsSchlucke(\$fehler, 'kontext', []); }\n"
        . "    } catch (Throwable \$fehler) { avesmapsSchluckProtokoll(\$fehler, 'kontext'); … }\n\n"
        . "Einen vierten Fall gibt es nicht. Der Rueckfall bleibt derselbe -- es aendert sich nur,\n"
        . "dass die Absage ihren Grund nennt.\n\n"
        . "Die meisten stummen Bloecke stehen zurzeit in:\n%s\n"
        . "Die Obergrenze in %s darf SINKEN, nicht steigen.\n\n",
        $stumm,
        AVESMAPS_STUMME_CATCHES_OBERGRENZE,
        $spitze,
        basename(__FILE__)
    ));
}

assert(
    $stumm <= AVESMAPS_STUMME_CATCHES_OBERGRENZE,
    "stumme catch-Bloecke: {$stumm} (erlaubt: " . AVESMAPS_STUMME_CATCHES_OBERGRENZE . ')'
);

// ⭐ Der freundliche Teil: wer welche abgebaut hat, soll die Klinke nachziehen -- sonst erodiert
// sie lautlos und laesst irgendwann wieder Raum, den niemand beschlossen hat. Das ist bewusst ein
// Hinweis und kein Fehlschlag: in einem geteilten Arbeitsbaum soll niemandes Verbesserung rot sein.
if ($stumm < AVESMAPS_STUMME_CATCHES_OBERGRENZE) {
    echo sprintf(
        "Hinweis: nur noch %d stumme catch-Bloecke (Obergrenze %d). Bitte die Obergrenze in %s\n"
        . "         auf %d senken -- eine Klinke, die nicht nachgezogen wird, gibt den Gewinn zurueck.\n",
        $stumm,
        AVESMAPS_STUMME_CATCHES_OBERGRENZE,
        basename(__FILE__),
        $stumm
    );
}

echo "stumme-catches ok ({$stumm} von {$gesamt})\n";
