<?php

declare(strict_types=1);

// Die Darstellungstafel der Landschaften: Pruefung, Lesen, Schreiben, Zuruecksetzen, Median.
// Entwurf: docs/superpowers/specs/2026-08-24-landschaften-darstellung-design.md §8
// Vorbild in Form und Reihenfolge: api/_internal/app/zoom-bands.php
//
// 🔴 DER SERVER KENNT DIE VORGABEWERTE NICHT. Er speichert nur die Uebersteuerung und gibt sie
// zurueck; die Tafel steht im Browser (js/map-features/ecosystem-display.js). Laege sie auch hier,
// gaebe es sie zweimal und sie liefen auseinander.
//
// 🔴 UND ER FUEHRT KEINE ARTENLISTE. 33 Flaechenarten und 31 Namensarten stehen im Haus bereits
// mehrfach; eine weitere Abschrift waere genau die Divergenz, die dieser Umbau abbaut. Geprueft
// werden FORM und SCHRANKEN; ueber die Namen entscheidet der Browser, der sie ohnehin gegen seine
// eigene Vorgabe abgleicht.

require_once __DIR__ . '/app-setting.php';

const AVESMAPS_ECOSYSTEM_DISPLAY_SETTING_KEY = 'ecosystem_display';
const AVESMAPS_ECOSYSTEM_DISPLAY_STAMP_KEY = 'ecosystem_display_stamp';

// ⚠️ Groesser als der Deckel der Zoombaender (8 KB): dort sind es sechs Ortsklassen, hier 33
// Flaechenarten plus 31 Namensarten plus je neun Groessen. Gemessen an einer voll besetzten Tafel
// bleiben rund 10 KB; 24 KB laesst Luft, ohne eine Tafel zu erlauben, die niemand von Hand erzeugt.
const AVESMAPS_ECOSYSTEM_DISPLAY_MAX_BYTES = 24576;

// Neun Stufen: z0 bis z8.
const AVESMAPS_ECOSYSTEM_DISPLAY_MAX_CELLS = 9;

// Die Schranken. 🔴 Sie pruefen, ob ein Wert UEBERHAUPT sein kann -- nicht, ob er sinnvoll ist.
// Das entscheidet der Browser gegen seine Vorgabe (dieselbe Arbeitsteilung wie bei den Zoombaendern).
const AVESMAPS_ECOSYSTEM_DISPLAY_OPACITY_LIMITS = [0.0, 1.0];
const AVESMAPS_ECOSYSTEM_DISPLAY_SIZE_LIMITS = [4.0, 30.0];   // Schriftgroesse in pt
// 💣 `bis` darf -1 sein: so ist „aus" kodiert (bis < ab), und das ist ein gueltiger Zustand, kein
// Fehler. Ein eigener Schalter daneben waere eine dritte Wahrheit ueber dieselbe Sache.
const AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_LIMITS = [
    'ab' => [0, 7],
    'bis' => [-1, 7],
    'curveMax' => [1, 3],
    'prio' => [1, 5],
];

/**
 * Ist `$x` ein JSON-OBJEKT (und keine Liste)?
 *
 * 💣 Ohne diese Wache kommt eine blanke JSON-Liste (`[1,2,3]`) glatt durch: `$x['farbe'] ?? []`
 * findet einfach keinen Schluessel und liefert leere Zeilen, statt abzulehnen. Genau dieser Test
 * war bei den Zoombaendern ROT.
 * ⚠️ KEIN array_is_list() -- die Funktion gibt es erst ab PHP 8.1, und im ganzen Haus benutzt sie
 * bisher niemand; diese Datei ist nicht der Ort, damit anzufangen, solange die PHP-Fassung auf
 * STRATO nicht nachgemessen ist.
 */
function avesmapsEcosystemDisplayIsObject(mixed $x): bool
{
    if (!is_array($x)) {
        return false;
    }

    return $x === [] || array_keys($x) !== range(0, count($x) - 1);
}

/** Ein Artenschluessel: `wald`, `suempfe_moore`. */
function avesmapsEcosystemDisplayIsArtKey(mixed $k): bool
{
    return is_string($k) && preg_match('/^[a-z_]{1,32}$/', $k) === 1;
}

/**
 * Ein Schluessel der Kurvenfeinheiten: `polyDegree`, `trackingMaxPerGapEm`.
 *
 * 🪤 EIGENE Form, nicht die der Artenschluessel. Die zwoelf Werte heissen camelCase (sie kommen aus
 * AVESMAPS_CURVE_LABEL_DEFAULTS in js/map-features/curve-label-fit.js), und `/^[a-z_]+$/` lehnt
 * jeden davon ab -- die erste Fassung tat genau das, und der Test hat es sofort gefunden.
 */
function avesmapsEcosystemDisplayIsKurvenKey(mixed $k): bool
{
    return is_string($k) && preg_match('/^[a-zA-Z]{1,40}$/', $k) === 1;
}

/** Ein Flaechenschluessel: `vegetation:wald` -- Ebene UND Art, weil `insel` in zweien vorkommt. */
function avesmapsEcosystemDisplayIsFlaechenKey(mixed $k): bool
{
    return is_string($k) && preg_match('/^[a-z]{1,20}:[a-z_]{1,32}$/', $k) === 1;
}

/** Ein Farbwert. 💣 Nur die Sechsstellen-Form -- `#fff` liest jeder Browser, aber nicht jeder gleich. */
function avesmapsEcosystemDisplayIsFarbe(mixed $v): bool
{
    return is_string($v) && preg_match('/^#[0-9a-f]{6}$/', $v) === 1;
}

/**
 * Eine Zahl innerhalb ihrer Schranke.
 *
 * 💣 KEINE STRINGS. "0.5" sieht aus wie eine Zahl und ist keine; JSON kennt den Unterschied, und
 * der Browser prueft ihn ebenfalls (typeof raw === "number").
 */
function avesmapsEcosystemDisplayZahlInSchranke(mixed $v, float $min, float $max): ?float
{
    if (!is_int($v) && !is_float($v)) {
        return null;
    }
    $f = (float) $v;

    return (is_finite($f) && $f >= $min && $f <= $max) ? $f : null;
}

/**
 * Prueft eine eingehende Tafel. Gibt die bereinigte Tafel zurueck oder null, wenn sie abzulehnen ist.
 *
 * ⚠️ Sie normalisiert NICHT (kein Auffuellen, kein Vorwaertsfuellen) -- das tut der Browser gegen
 * seine eigene Vorgabe. Hier geht es nur darum, dass nichts Unsinniges in die Datenbank kommt.
 */
function avesmapsEcosystemDisplayValidate(mixed $incoming): ?array
{
    if (!avesmapsEcosystemDisplayIsObject($incoming)) {
        return null;
    }

    $clean = ['version' => 1];

    // ---- Farben: Namenstoene (je Art) und Flaechentoene (je Ebene:Art) -------------------------
    foreach ([['farbe', false], ['flaeche', true]] as [$feld, $mitEbene]) {
        if (!array_key_exists($feld, $incoming)) {
            continue;
        }
        if (!avesmapsEcosystemDisplayIsObject($incoming[$feld])) {
            return null;
        }
        $rein = [];
        foreach ($incoming[$feld] as $k => $v) {
            $keyOk = $mitEbene
                ? avesmapsEcosystemDisplayIsFlaechenKey($k)
                : avesmapsEcosystemDisplayIsArtKey($k);
            if (!$keyOk || !avesmapsEcosystemDisplayIsFarbe($v)) {
                return null;
            }
            $rein[$k] = $v;
        }
        $clean[$feld] = $rein;
    }

    // ---- Deckkraft je Flaechenart --------------------------------------------------------------
    if (array_key_exists('deckkraft', $incoming)) {
        if (!avesmapsEcosystemDisplayIsObject($incoming['deckkraft'])) {
            return null;
        }
        [$min, $max] = AVESMAPS_ECOSYSTEM_DISPLAY_OPACITY_LIMITS;
        $rein = [];
        foreach ($incoming['deckkraft'] as $k => $v) {
            $wert = avesmapsEcosystemDisplayZahlInSchranke($v, $min, $max);
            if (!avesmapsEcosystemDisplayIsFlaechenKey($k) || $wert === null) {
                return null;
            }
            $rein[$k] = $wert;
        }
        $clean['deckkraft'] = $rein;
    }

    // ---- Die globale Deckkraft je EBENE --------------------------------------------------------
    // 🔴 „Global" heisst FUER DIESE EBENE, nicht fuer alle vier (Entwurf §5.2). Die vier Vorgaben
    // sagen Verschiedenes (0,16 / 0,72 / 0,72 / 0,30); eine Zahl ueber alle vier zoege sie zusammen.
    if (array_key_exists('global', $incoming)) {
        if (!avesmapsEcosystemDisplayIsObject($incoming['global'])) {
            return null;
        }
        [$min, $max] = AVESMAPS_ECOSYSTEM_DISPLAY_OPACITY_LIMITS;
        $rein = [];
        foreach ($incoming['global'] as $k => $eintrag) {
            if (!avesmapsEcosystemDisplayIsArtKey($k) || !avesmapsEcosystemDisplayIsObject($eintrag)) {
                return null;
            }
            $satz = [];
            if (array_key_exists('an', $eintrag)) {
                if (!is_bool($eintrag['an'])) {
                    return null;
                }
                $satz['an'] = $eintrag['an'];
            }
            if (array_key_exists('wert', $eintrag)) {
                $wert = avesmapsEcosystemDisplayZahlInSchranke($eintrag['wert'], $min, $max);
                if ($wert === null) {
                    return null;
                }
                $satz['wert'] = $wert;
            }
            $rein[$k] = $satz;
        }
        $clean['global'] = $rein;
    }

    // ---- Groessenzeilen je Art -----------------------------------------------------------------
    if (array_key_exists('groesse', $incoming)) {
        if (!avesmapsEcosystemDisplayIsObject($incoming['groesse'])) {
            return null;
        }
        [$min, $max] = AVESMAPS_ECOSYSTEM_DISPLAY_SIZE_LIMITS;
        $rein = [];
        foreach ($incoming['groesse'] as $k => $zeile) {
            if (!avesmapsEcosystemDisplayIsArtKey($k) || !is_array($zeile)) {
                return null;
            }
            if (count($zeile) > AVESMAPS_ECOSYSTEM_DISPLAY_MAX_CELLS) {
                return null;
            }
            $reineZeile = [];
            $erwartet = 0;
            foreach ($zeile as $index => $zelle) {
                // 💣 Eine Zeile ist eine LISTE: 0, 1, 2, … ohne Luecke. Ein Objekt `{"2": 12}` kaeme
                // sonst als Zeile durch, und der Browser laese den Wert an der falschen Zoomstufe --
                // er zaehlt den INDEX, nicht einen Schluessel.
                if ($index !== $erwartet) {
                    return null;
                }
                $erwartet += 1;
                $wert = avesmapsEcosystemDisplayZahlInSchranke($zelle, $min, $max);
                if ($wert === null) {
                    return null;
                }
                $reineZeile[] = $wert;
            }
            $rein[$k] = $reineZeile;
        }
        $clean['groesse'] = $rein;
    }

    // ---- Vorgaben je Art: Band, max. Namen, Prioritaet -----------------------------------------
    if (array_key_exists('vorgabe', $incoming)) {
        if (!avesmapsEcosystemDisplayIsObject($incoming['vorgabe'])) {
            return null;
        }
        $rein = [];
        foreach ($incoming['vorgabe'] as $k => $satz) {
            if (!avesmapsEcosystemDisplayIsArtKey($k) || !avesmapsEcosystemDisplayIsObject($satz)) {
                return null;
            }
            $reinerSatz = [];
            foreach ($satz as $feld => $wert) {
                if (!isset(AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_LIMITS[$feld])) {
                    return null;
                }
                [$min, $max] = AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_LIMITS[$feld];
                // ⚠️ Ganze Zahlen: eine halbe Zoomstufe gibt es nicht, und eine Prioritaet 2,5
                // liesse sich auf keinen Regler setzen.
                if (!is_int($wert) || $wert < $min || $wert > $max) {
                    return null;
                }
                $reinerSatz[$feld] = $wert;
            }
            $rein[$k] = $reinerSatz;
        }
        $clean['vorgabe'] = $rein;
    }

    // ---- Die Kurvenfeinheiten -------------------------------------------------------------------
    // ⚠️ Der Server fuehrt auch hier KEINE Schluesselliste: die zwoelf Werte stehen in
    // js/map-features/curve-label-fit.js (AVESMAPS_CURVE_LABEL_DEFAULTS), und eine Abschrift hier
    // waere die zweite Wahrheit. Geprueft wird, dass es Zahlen sind.
    if (array_key_exists('kurve', $incoming)) {
        if (!avesmapsEcosystemDisplayIsObject($incoming['kurve'])) {
            return null;
        }
        $rein = [];
        foreach ($incoming['kurve'] as $k => $v) {
            if (!avesmapsEcosystemDisplayIsKurvenKey($k)) {
                return null;
            }
            // Eine grosszuegige, aber endliche Spanne -- der Browser klemmt je Wert enger.
            $wert = avesmapsEcosystemDisplayZahlInSchranke($v, -1000.0, 1000.0);
            if ($wert === null) {
                return null;
            }
            $rein[$k] = $wert;
        }
        $clean['kurve'] = $rein;
    }

    // 💣 JSON_PRESERVE_ZERO_FRACTION. Ohne das Flag macht json_encode aus 9.0 eine 9, und beim
    // Zuruecklesen ist der Wert ein int -- der Schaden entsteht nicht beim Speichern, sondern beim
    // VERGLEICH: `=== 9.0` ist dann falsch, obwohl die Zahl stimmt. Dieselbe Falle steht als
    // Hauslehre fest, und dieser Test hat sie sofort wieder gefunden.
    $encoded = json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    if ($encoded === false || strlen($encoded) > AVESMAPS_ECOSYSTEM_DISPLAY_MAX_BYTES) {
        return null;
    }

    return json_decode($encoded, true);
}

/**
 * Liest Tafel und Stempel. EINE Abfrage, KEIN DDL -- diese Funktion sitzt auch hinter dem
 * oeffentlichen Endpunkt, und avesmapsAppSettingGet legt bei jedem Aufruf die Tabelle an.
 *
 * @return array{display: ?array, stamp: string}
 */
function avesmapsEcosystemDisplayRead(PDO $pdo): array
{
    $rows = avesmapsAppSettingGetManyWithoutDdl(
        $pdo,
        [AVESMAPS_ECOSYSTEM_DISPLAY_SETTING_KEY, AVESMAPS_ECOSYSTEM_DISPLAY_STAMP_KEY]
    );

    $raw = $rows[AVESMAPS_ECOSYSTEM_DISPLAY_SETTING_KEY] ?? '';
    $display = null;
    if ($raw !== '') {
        $decoded = json_decode($raw, true);
        // ⚠️ Unlesbares JSON gilt als „nichts gespeichert", nicht als Fehler: die Karte darf an
        // einem kaputten Einstellungswert nicht haengenbleiben.
        $display = is_array($decoded) ? $decoded : null;
    }

    return ['display' => $display, 'stamp' => $rows[AVESMAPS_ECOSYSTEM_DISPLAY_STAMP_KEY] ?? ''];
}

/**
 * Schreibt die Tafel und LIEST SIE ZURUECK.
 *
 * 💣 Ein Speichern, das nicht ankommt, meldet das. `setting_value` war einmal VARCHAR(255): MySQL
 * schnitt ausserhalb des strikten Modus STILL ab, json_decode lieferte danach NULL, und der Leser
 * fiel auf seine Konstante zurueck -- von „es wurde nie etwas gespeichert" nicht zu unterscheiden.
 * Genau so tat der Speichern-Knopf der Tempowerte wochenlang gar nichts (AGENTS.md §10).
 * ⚠️ EnsureWideValue ist DDL, also vor dem Schreiben und nie in einer Transaktion; und es gehoert
 * NUR auf diesen kalten Pfad -- seine information_schema-Sonde ist die Last aus AGENTS.md §10.
 */
function avesmapsEcosystemDisplayWrite(PDO $pdo, array $display): bool
{
    avesmapsAppSettingEnsureWideValue($pdo);
    // 💣 Dasselbe Flag wie in der Pruefung -- sonst schriebe der Schreiber eine ANDERE Zeichenkette
    // als die gepruefte, und der Rueckleser unten verglich zwei verschieden kodierte Fassungen
    // derselben Tafel.
    $encoded = json_encode($display, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    if ($encoded === false) {
        return false;
    }
    avesmapsAppSettingSet($pdo, AVESMAPS_ECOSYSTEM_DISPLAY_SETTING_KEY, $encoded);
    avesmapsAppSettingSet($pdo, AVESMAPS_ECOSYSTEM_DISPLAY_STAMP_KEY, (string) time());

    return avesmapsAppSettingGetWithoutDdl($pdo, AVESMAPS_ECOSYSTEM_DISPLAY_SETTING_KEY, '') === $encoded;
}

/**
 * 🔴 LOESCHT die Zeile, statt die Vorgabewerte hineinzuschreiben. Ein Ruecksetzer, der eine Kopie
 * hinterlaesst, veraltet beim naechsten Mal, wenn jemand die Vorgabe im Browser aendert -- und
 * niemand merkt es, weil in der Datenbank etwas steht.
 */
function avesmapsEcosystemDisplayReset(PDO $pdo): void
{
    $statement = $pdo->prepare('DELETE FROM app_setting WHERE setting_key = :k');
    $statement->execute(['k' => AVESMAPS_ECOSYSTEM_DISPLAY_SETTING_KEY]);
    avesmapsAppSettingSet($pdo, AVESMAPS_ECOSYSTEM_DISPLAY_STAMP_KEY, (string) time());
}

/**
 * Der Median je Namensart ueber die aktiven Beschriftungen.
 *
 * 🔴 DER MEDIAN IST UNSER WERKZEUG, nicht das der Editoren (Entwurf §5.4). Er wandert nie in den
 * Beschriftungsdialog -- dort steht die Vorgabe. Eine Median-Marke beim Editor hiesse „richte dich
 * nach dem Durchschnitt", und das ist das Gegenteil einer Vorgabe: sie zementierte den Bestand,
 * statt ihn zu lenken.
 *
 * ⚠️ EINE Abfrage, keine je Art. `feature_subtype` ist eine SPALTE auf map_features; min_zoom,
 * max_zoom, curve_label_max und priority liegen in properties_json.
 * 🔴 Fehlt ein Wert an einer Zeile, zaehlt diese Zeile fuer dieses Feld einfach NICHT mit. Eine
 * Vorgabe einzusetzen faelschte den Median in ihre Richtung -- und genau die Frage, ob die Vorgabe
 * stimmt, soll er ja beantworten.
 *
 * @return array<string, array{n:int, ab?:int, bis?:int, curveMax?:int, prio?:int}>
 */
function avesmapsEcosystemDisplayMedians(PDO $pdo): array
{
    $statement = $pdo->query(
        "SELECT feature_subtype, properties_json FROM map_features
          WHERE feature_type = 'label' AND is_active = 1"
    );
    if ($statement === false) {
        return [];
    }

    $felder = ['ab' => 'min_zoom', 'bis' => 'max_zoom', 'curveMax' => 'curve_label_max', 'prio' => 'priority'];
    $eimer = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $art = trim((string) ($zeile['feature_subtype'] ?? ''));
        if ($art === '') {
            continue;
        }
        $p = json_decode((string) ($zeile['properties_json'] ?? ''), true);
        if (!is_array($p)) {
            continue;
        }
        $eimer[$art]['n'] = ($eimer[$art]['n'] ?? 0) + 1;
        foreach ($felder as $feld => $schluessel) {
            if (isset($p[$schluessel]) && is_numeric($p[$schluessel])) {
                $eimer[$art][$feld][] = (int) $p[$schluessel];
            }
        }
    }

    $raus = [];
    foreach ($eimer as $art => $gesammelt) {
        $eintrag = ['n' => (int) ($gesammelt['n'] ?? 0)];
        foreach (array_keys($felder) as $feld) {
            $werte = $gesammelt[$feld] ?? [];
            if ($werte === []) {
                continue;
            }
            sort($werte);
            // Bei gerader Anzahl der UNTERE der beiden mittleren -- eine ganze Zoomstufe, keine
            // halbe. Ein Median von 3,5 liesse sich auf keinen Regler setzen.
            $eintrag[$feld] = $werte[intdiv(count($werte) - 1, 2)];
        }
        $raus[$art] = $eintrag;
    }

    return $raus;
}
