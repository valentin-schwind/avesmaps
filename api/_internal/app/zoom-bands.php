<?php

declare(strict_types=1);

// Die Zoombänder: Prüfung, Lesen, Schreiben, Zurücksetzen.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §4, §5.3
//
// 🔴 DER SERVER KENNT DIE VORGABEWERTE NICHT. Er speichert nur die Übersteuerung und gibt sie
// zurück; die Tafel steht im Browser (js/map-features/location-zoom-bands.js). Läge sie auch hier,
// gäbe es sie zweimal und sie liefen auseinander.
//
// 🔴 UND ER FÜHRT KEINE KLASSENLISTE. Die sechs Ortsklassen stehen im Server heute schon zweimal
// (api/edit/map/features.php, api/app/report-location.php); eine dritte Abschrift wäre genau die
// Divergenz, die dieser Umbau an anderer Stelle abbaut. Geprüft werden Form und Schranken; über
// die Klassennamen entscheidet der Browser, der sie ohnehin gegen seine Vorgabe abgleicht.

require_once __DIR__ . '/app-setting.php';

const AVESMAPS_ZOOM_BANDS_SETTING_KEY = 'location_zoom_bands';
const AVESMAPS_ZOOM_BANDS_STAMP_KEY = 'location_zoom_bands_stamp';
const AVESMAPS_ZOOM_BANDS_MAX_BYTES = 8192;
const AVESMAPS_ZOOM_BANDS_MAX_CELLS = 9;   // z0 bis z8
const AVESMAPS_ZOOM_BANDS_LIMITS = [
    'marker' => [0.5, 100.0],  // Außendurchmesser in px
    'label' => [4.0, 30.0],    // Schriftgröße in pt
];
// 🔴 AUFGABE 8B: GLOBALE Abstände (Spalt/Repel/Versatz/Drift) -- EIN Wert je Schlüssel, keine Zeile
// je Zoomstufe. EINE Schranke fuer alle, und sie ist die WEITESTE der im Browser gefuehrten:
// Spalt/Repel/Versatz gehen bis 20, der Drift-Deckel bis 90 (22.08.2026).
// ⚠️ Der Server fuehrt bewusst KEINE Schluesselliste (siehe unten) und kann deshalb nicht je
// Schluessel enger pruefen -- er prueft die FORM, der Browser die BEDEUTUNG und klemmt jeden Wert
// gegen seine eigene, engere Schranke (avesmapsLocationLabelSpacingLimits). Dieselbe Arbeitsteilung
// wie bei marker/label, wo der Server die Klassenliste ebenfalls nicht kennt.
const AVESMAPS_ZOOM_BANDS_SPACING_LIMITS = [0.0, 90.0];

/**
 * Prüft eine eingehende Tafel. Gibt die bereinigte Tafel zurück oder null, wenn sie abzulehnen ist.
 *
 * ⚠️ Sie normalisiert NICHT (kein Auffüllen, kein Vorwärtsfüllen) -- das tut der Browser gegen
 * seine eigene Vorgabe. Hier geht es nur darum, dass nichts Unsinniges in die Datenbank kommt.
 */
function avesmapsZoomBandsValidate(mixed $incoming): ?array
{
    if (!is_array($incoming)) {
        return null;
    }
    // 💣 ABWEICHUNG VOM ENTWURF: ohne diese Zeile kommt eine blanke JSON-Liste (`[1,2,3]`) glatt
    // durch -- `$incoming['marker'] ?? []` findet einfach keinen Schluessel und liefert leere
    // Zeilen, statt abzulehnen (Test A, "eine Liste ist keine Tafel", war damit ROT). KEIN
    // array_is_list() (siehe unten): der Schluessel-Vergleich von Hand ist PHP-7-tauglich. Eine
    // LEERE Tafel bleibt erlaubt -- JSON `{}` und `[]` sind nach json_decode(..., true)
    // ununterscheidbar, beide werden zu `[]`, und `{}` (nichts uebersteuert) ist ein gueltiger Fall.
    if ($incoming !== [] && array_keys($incoming) === range(0, count($incoming) - 1)) {
        return null;
    }

    $clean = ['version' => 1];
    foreach (['marker', 'label'] as $kind) {
        $rows = $incoming[$kind] ?? [];
        if (!is_array($rows)) {
            return null;
        }
        [$min, $max] = AVESMAPS_ZOOM_BANDS_LIMITS[$kind];
        $cleanRows = [];
        foreach ($rows as $locationType => $row) {
            // ⚠️ KEIN array_is_list(). Die Funktion gibt es erst ab PHP 8.1, und im ganzen Haus
            // benutzt sie bisher niemand -- diese Datei ist nicht der Ort, das als Erste zu tun,
            // solange die PHP-Fassung auf STRATO nicht nachgemessen ist. Sie wird auch nicht
            // gebraucht: ein JSON-Array käme hier mit GANZZAHLIGEN Schlüsseln an, und die fallen
            // an is_string() heraus.
            if (!is_string($locationType) || preg_match('/^[a-z_]{1,32}$/', $locationType) !== 1) {
                return null;
            }
            if (!is_array($row) || count($row) > AVESMAPS_ZOOM_BANDS_MAX_CELLS) {
                return null;
            }
            $cleanRow = [];
            $expectedIndex = 0;
            foreach ($row as $index => $cell) {
                // 💣 Eine Zeile ist eine LISTE: 0, 1, 2, … ohne Lücke. Ein Objekt `{"2": 5}` käme
                // sonst als Zeile durch, und der Browser läse den Wert an der falschen Zoomstufe.
                if ($index !== $expectedIndex) {
                    return null;
                }
                $expectedIndex += 1;
                if ($cell === null) {
                    $cleanRow[] = null;
                    continue;
                }
                // 💣 KEINE STRINGS. "5" sieht aus wie eine Zahl und ist keine; JSON kennt den
                // Unterschied, und der Browser prüft ihn ebenfalls (typeof raw === "number").
                if (!is_int($cell) && !is_float($cell)) {
                    return null;
                }
                $value = (float) $cell;
                if (!is_finite($value) || $value < $min || $value > $max) {
                    return null;
                }
                $cleanRow[] = $value;
            }
            $cleanRows[$locationType] = $cleanRow;
        }
        // ⚠️ Ist hier nichts drin, wird daraus beim Kodieren `[]` statt `{}`. Das ist unschädlich:
        // der Browser prüft `!Array.isArray(...)` und fällt dann auf die reine Vorgabe zurück --
        // genau die richtige Bedeutung für „nichts übersteuert".
        $clean[$kind] = $cleanRows;
    }

    // 🔴 AUFGABE 8B: die drei globalen Abstände -- EIN Wert je Schlüssel, keine Liste/Zeile.
    // ⚠️ Ein FEHLENDER Abschnitt ist gültig: eine vor diesem Umbau gespeicherte Tafel kennt ihn gar
    // nicht, und das ist ein Nichtwissen, keine Ablehnung (der Browser füllt dann seine Vorgabe).
    // Nur ein VORHANDENER, aber falsch geformter Abschnitt fliegt raus.
    if (array_key_exists('abstaende', $incoming)) {
        $abstaendeRaw = $incoming['abstaende'];
        if (!is_array($abstaendeRaw)) {
            return null;
        }
        [$spacingMin, $spacingMax] = AVESMAPS_ZOOM_BANDS_SPACING_LIMITS;
        $cleanAbstaende = [];
        foreach ($abstaendeRaw as $key => $value) {
            // ⚠️ Dieselbe Form wie ein Klassenschlüssel bei marker/label -- der Server führt auch
            // hier KEINE feste Liste (spalt/repel/versatz), das entscheidet der Browser gegen seine
            // eigene Vorgabetafel (§4.4 Punkt 1: unbekannte Schlüssel werden gespeichert, aber ignoriert).
            if (!is_string($key) || preg_match('/^[a-z_]{1,32}$/', $key) !== 1) {
                return null;
            }
            // 💣 KEIN `null`: anders als eine Zellenreihe hat ein globaler Abstand keine
            // "unsichtbar"-Aussage -- er ist immer eine Zahl. is_int()/is_float() lehnt null von
            // selbst ab (fällt ebenso wie ein String durch).
            if (!is_int($value) && !is_float($value)) {
                return null;
            }
            $floatValue = (float) $value;
            if (!is_finite($floatValue) || $floatValue < $spacingMin || $floatValue > $spacingMax) {
                return null;
            }
            $cleanAbstaende[$key] = $floatValue;
        }
        $clean['abstaende'] = $cleanAbstaende;
    }

    $encoded = json_encode($clean, JSON_UNESCAPED_UNICODE);
    if ($encoded === false || strlen($encoded) > AVESMAPS_ZOOM_BANDS_MAX_BYTES) {
        return null;
    }

    return json_decode($encoded, true);
}

/**
 * Liest Tafel und Stempel. EINE Abfrage, KEIN DDL -- diese Funktion sitzt auch hinter dem
 * öffentlichen Endpunkt, und avesmapsAppSettingGet legt bei jedem Aufruf die Tabelle an.
 *
 * @return array{bands: ?array, stamp: string}
 */
function avesmapsZoomBandsRead(PDO $pdo): array
{
    $rows = avesmapsAppSettingGetManyWithoutDdl(
        $pdo,
        [AVESMAPS_ZOOM_BANDS_SETTING_KEY, AVESMAPS_ZOOM_BANDS_STAMP_KEY]
    );

    $raw = $rows[AVESMAPS_ZOOM_BANDS_SETTING_KEY] ?? '';
    $bands = null;
    if ($raw !== '') {
        $decoded = json_decode($raw, true);
        // ⚠️ Unlesbares JSON gilt als "nichts gespeichert", nicht als Fehler: die Karte darf an
        // einem kaputten Einstellungswert nicht hängenbleiben.
        $bands = is_array($decoded) ? $decoded : null;
    }

    return ['bands' => $bands, 'stamp' => $rows[AVESMAPS_ZOOM_BANDS_STAMP_KEY] ?? ''];
}

/**
 * Schreibt die Tafel und LIEST SIE ZURÜCK.
 *
 * 💣 Ein Speichern, das nicht ankommt, meldet das. `setting_value` war einmal VARCHAR(255): MySQL
 * schnitt ausserhalb des strikten Modus STILL ab, json_decode lieferte danach NULL, und der Leser
 * fiel auf seine Konstante zurück -- von "es wurde nie etwas gespeichert" nicht zu unterscheiden.
 * ⚠️ EnsureWideValue ist DDL, also vor dem Schreiben und nie in einer Transaktion; und es gehört
 * NUR auf diesen kalten Pfad (seine information_schema-Sonde ist die Last aus AGENTS.md §10).
 */
function avesmapsZoomBandsWrite(PDO $pdo, array $bands): bool
{
    avesmapsAppSettingEnsureWideValue($pdo);
    $encoded = json_encode($bands, JSON_UNESCAPED_UNICODE);
    if ($encoded === false) {
        return false;
    }
    avesmapsAppSettingSet($pdo, AVESMAPS_ZOOM_BANDS_SETTING_KEY, $encoded);
    avesmapsAppSettingSet($pdo, AVESMAPS_ZOOM_BANDS_STAMP_KEY, (string) time());

    return avesmapsAppSettingGetWithoutDdl($pdo, AVESMAPS_ZOOM_BANDS_SETTING_KEY, '') === $encoded;
}

/**
 * 🔴 LÖSCHT die Zeile, statt die Vorgabewerte hineinzuschreiben. Ein Rücksetzer, der eine Kopie
 * hinterlässt, veraltet beim nächsten Mal, wenn jemand die Vorgabe im Browser ändert -- und niemand
 * merkt es, weil in der Datenbank etwas steht.
 */
function avesmapsZoomBandsReset(PDO $pdo): void
{
    $statement = $pdo->prepare('DELETE FROM app_setting WHERE setting_key = :k');
    $statement->execute(['k' => AVESMAPS_ZOOM_BANDS_SETTING_KEY]);
    avesmapsAppSettingSet($pdo, AVESMAPS_ZOOM_BANDS_STAMP_KEY, (string) time());
}
