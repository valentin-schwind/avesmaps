<?php

declare(strict_types=1);

// Die Tempowerte an EINER Stelle — die GA-Zahlen, der Speicher und der Rücksetzer.
// Entwurf: docs/superpowers/specs/2026-08-07-tempowerte-design.md
//
// PURITY CONTRACT: side-effect-free on include. Ohne PDO liefert alles hier die heutigen
// Konstanten — dieselbe gewollte Ausfallart wie beim A* ohne Landschaftsdaten.
//
// 💣 DIE QUELLE NENNT NIE EINE GESCHWINDIGKEIT, IMMER NUR EINE TAGESLEISTUNG (GA S. 118 · 123 ·
// 129 · 131). Darum sind unsere Tabellenwerte krumm — 3,07 statt 3,0, 9,92 statt 10 —, und wer eine
// Zahl „glattzieht", bricht die Zuordnung zur Quelle. Der Bauplan steht in
// avesmapsTravelValuesSpeedFromDayMiles() und nirgends sonst.
//
// 🔴 DIE GA-TAFEL STEHT IM SERVER, NICHT IM BROWSER. Der Rücksetzer rechnet hier; gäbe es sie auch
// im Fenster, gäbe es sie zweimal und sie liefen auseinander.

require_once __DIR__ . '/client-graph.php';

// Unsere eigene Skalierung — steht NICHT in der GA und ist im Fenster gesperrt.
// mean_G gleicht allein unsere Steigungsebene aus (die Quelle kennt auf der Straße keine Steigung,
// ihr Straßenfaktor ist glatt 1,0); Wasser trägt kein Gelände und bekommt ihn deshalb nicht.
const AVESMAPS_TRAVEL_MEAN_G = 1.032;
const AVESMAPS_TRAVEL_TIME_SCALE = 1.19;
const AVESMAPS_TRAVEL_DEFAULT_HOURS = 12.0;
// 🔴 Das EINE Schiff mit Nachtfahrt (S. 131). Die Ausnahme hängt am TRANSPORTMITTEL, nie am Wegtyp
// — am Wegtyp gehängt bekämen alle drei Schiffe den 24-Stunden-Tag.
const AVESMAPS_TRAVEL_NIGHT_TRAVEL_TRANSPORT = 'fastShip';

const AVESMAPS_TRAVEL_VALUES_SETTING_KEY = 'travel_values';

/**
 * Der aktive Tempo-Speicher DIESER Anfrage.
 *
 * 💣 SIEBEN LESESTELLEN IN FÜNF DATEIEN, UND KEINE HAT EINEN PDO. Die Tabelle wird tief im Graphbau
 * gelesen (`avesmapsAddClientCompatiblePathToGraph`, die beiden Querfeldein-Erzeuger, der
 * Umweg-Auslöser, der A* und die Sehnen-Verfeinerung). Sie alle mit einer Verbindung zu versorgen
 * hieße, sieben Signaturen und jeden ihrer Aufrufer zu ändern — für einen Wert, der sich während
 * einer Anfrage nie ändert. Also: EINMAL füllen (`avesmapsTravelValuesPrime` in response.php),
 * danach lesen.
 *
 * 🔴 Ungefüllt gilt die Konstante. Eine frische Anlage, jede Diagnose ohne PDO und jeder Unit-Test
 * bekommen damit exakt das heutige Verhalten — der bloße Einbau verschiebt keine einzige Reisezeit.
 */
function &avesmapsTravelValuesActiveRef(): ?array
{
    static $active = null;

    return $active;
}

/** Den Speicher dieser Anfrage füllen — einmal, aus der Datenbank. */
function avesmapsTravelValuesPrime(?PDO $pdo): void
{
    $values = avesmapsTravelValuesRead($pdo);
    avesmapsTravelValuesPrimeGrid(is_array($values['grid'] ?? null) ? $values['grid'] : []);
}

/** Denselben Speicher direkt setzen — für Tests und für den Endpunkt nach dem Schreiben. */
function avesmapsTravelValuesPrimeGrid(array $grid): void
{
    $active = &avesmapsTravelValuesActiveRef();
    $active = $grid === [] ? null : $grid;
}

/** Zurück auf die Konstante. */
function avesmapsTravelValuesResetActive(): void
{
    $active = &avesmapsTravelValuesActiveRef();
    $active = null;
}

/**
 * Das Tempo einer Zelle — der EINZIGE Leser, den der Router benutzen soll.
 *
 * ⚠️ Eine unbekannte Zelle ist `null`, nie 0. Die Aufrufer prüfen alle auf null und überspringen den
 * Weg; eine 0 wäre dort keine Ausnahme, sondern eine Division durch null.
 */
function avesmapsTravelValuesSpeed(string $transport, string $pathType): ?float
{
    $active = &avesmapsTravelValuesActiveRef();
    $grid = is_array($active) ? $active : AVESMAPS_ROUTE_CLIENT_SPEED_TABLE;
    $speed = $grid[$transport][$pathType] ?? null;
    if (!is_numeric($speed) || (float) $speed <= 0.0) { return null; }

    return (float) $speed;
}

/**
 * PURE: die Zahlen, die aus der *Geographia Aventurica* stammen — und nur die.
 *
 * ⚠️ Was aus einer Messung oder unserer Skalierung kommt (mean_G, Zeitmaßstab, Pass-Normalisierer,
 * der ×25 der Reparaturkanten), steht bewusst NICHT hier: das Fenster zeigt es gesperrt daneben,
 * damit der Unterschied zwischen „Quelle" und „unsere Rechnung" sichtbar bleibt.
 */
function avesmapsTravelValuesSourceTable(): array
{
    return [
        // GA S. 118 · 123 · 129 · 131 — Tagesleistung in Meilen.
        // ⚠️ „berittene Gruppe 35" ist die TABELLE S. 123. Der Fließtext S. 118 sagt „kaum mehr als
        // 40"; die Quelle widerspricht sich und löst es nie auf. Wir nehmen die Tabelle — als
        // Entscheidung, nicht als Auflösung. Folge: beritten ist nur 16 % schneller als zu Fuß.
        'day_miles' => [
            'groupFoot' => 30.0, 'lightWalker' => 40.0, 'groupHorse' => 35.0, 'lightRider' => 50.0,
            'caravan' => 30.0, 'horseCarriage' => 50.0,
            'riverBarge' => 40.0, 'riverSailer' => 60.0,
            'cargoShip' => 120.0, 'galley' => 100.0, 'fastShip' => 250.0,
        ],
        // GA S. 120–123 — Geländefaktor je Wegtyp, Straße = 1,0.
        'path_factors' => [
            'Reichsstrasse' => 1.10, 'Strasse' => 1.00, 'Weg' => 0.80, 'Pfad' => 0.80,
            'Gebirgspass' => 0.40, 'Wuestenpfad' => 0.50, 'Querfeldein' => 0.75,
        ],
        // GA S. 120–123 — Geländefaktor je Landschaftsart, für alles Querfeldein.
        // ⚠️ Hügelland stammt aus der STEIGUNGStabelle (S. 122 f.), nicht aus der Geländetabelle.
        'landscapes' => [
            'wald' => 0.50, 'suempfe_moore' => 0.10, 'dschungel' => 0.20, 'wueste' => 0.50,
            'tundra' => 0.70, 'steppe' => 0.75, 'grasland' => 0.75, 'gebirge' => 0.20,
            'huegelland' => 0.75,
        ],
        // GA S. 122 f. — Abzug auf den Boden nach Jahreszeit.
        'ground_penalties' => [
            'aufgeweicht' => -0.10, 'tauboden' => -0.10, 'leichter_schnee' => -0.10,
            'tiefschnee' => -0.20, 'eis' => -0.20, 'untergrenze' => 0.05,
        ],
        // GA S. 123 · 129.
        'river_ratio' => 2.0,
        'calibration_target_miles' => 30.0,
    ];
}

/**
 * PURE: Tagesleistung der Quelle -> unsere Geschwindigkeit in Meilen/h.
 *
 * 💣 DER EINZIGE ORT, AN DEM DIESE FORMEL STEHT. Sie ist der Grund für jede krumme Zahl in der
 * Tabelle, und eine zweite Abschrift wäre die Divergenz, die niemand bemerkt.
 */
function avesmapsTravelValuesSpeedFromDayMiles(float $dayMiles, bool $isLand, float $hours): float
{
    if ($hours <= 0.0) { return 0.0; }
    $meanG = $isLand ? AVESMAPS_TRAVEL_MEAN_G : 1.0;

    return $dayMiles * $meanG * AVESMAPS_TRAVEL_TIME_SCALE / $hours;
}

/** PURE: Reist dieses Mittel an Land? Wasser trägt kein Gelände und keinen mean_G. */
function avesmapsTravelValuesIsLandTransport(string $transport): bool
{
    return !in_array($transport, ['riverBarge', 'riverSailer', 'cargoShip', 'galley', 'fastShip'], true);
}

/** PURE: der Reisetag dieses Mittels — 12 Stunden, außer beim einen Schiff mit Nachtfahrt. */
function avesmapsTravelValuesHoursFor(string $transport): float
{
    return $transport === AVESMAPS_TRAVEL_NIGHT_TRAVEL_TRANSPORT ? 24.0 : AVESMAPS_TRAVEL_DEFAULT_HOURS;
}

/**
 * Die geltenden Werte: aus dem Speicher, sonst aus der Konstante.
 *
 * 🔴 KEIN GERATENER WERT, WENN DIE DATENBANK SCHWEIGT. Eine frische Anlage und jede Diagnose ohne
 * PDO bekommen exakt das heutige Raster — sonst verschöbe der bloße Einbau Reisezeiten, ohne dass
 * jemand etwas eingestellt hat.
 */
function avesmapsTravelValuesRead(?PDO $pdo): array
{
    $fallback = [
        'grid' => AVESMAPS_ROUTE_CLIENT_SPEED_TABLE,
        'day_miles' => avesmapsTravelValuesSourceTable()['day_miles'],
        'path_factors' => avesmapsTravelValuesSourceTable()['path_factors'],
        'ground_penalties' => avesmapsTravelValuesSourceTable()['ground_penalties'],
        'river_ratio' => avesmapsTravelValuesSourceTable()['river_ratio'],
        'calibration_target_miles' => avesmapsTravelValuesSourceTable()['calibration_target_miles'],
        'source' => 'constant',
    ];
    if (!$pdo instanceof PDO) { return $fallback; }

    try {
        require_once __DIR__ . '/../app/app-setting.php';
        $raw = avesmapsAppSettingGetWithoutDdl($pdo, AVESMAPS_TRAVEL_VALUES_SETTING_KEY, '');
    } catch (Throwable) {
        // Der Speicher ist eine Zutat, kein Tor: fehlt er, rechnet der Router mit der Konstante
        // weiter, statt eine Route zu verweigern.
        return $fallback;
    }
    if (trim($raw) === '') { return $fallback; }

    $stored = json_decode($raw, true);
    if (!is_array($stored) || !is_array($stored['grid'] ?? null)) { return $fallback; }

    // 💣 ZELLE FÜR ZELLE ÜBER DIE KONSTANTE GELEGT, nie ersetzt. Ein Reisemittel oder ein Wegtyp,
    // der nach dem Speichern dazukam, fehlte sonst im Raster — und eine fehlende Zelle ist im
    // Graphbau kein Fehler, sondern ein still übersprungener Weg.
    $grid = AVESMAPS_ROUTE_CLIENT_SPEED_TABLE;
    foreach ($stored['grid'] as $transport => $row) {
        if (!isset($grid[$transport]) || !is_array($row)) { continue; }
        foreach ($row as $pathType => $speed) {
            if (!isset($grid[$transport][$pathType]) || !is_numeric($speed) || (float) $speed <= 0.0) { continue; }
            $grid[$transport][$pathType] = (float) $speed;
        }
    }

    return [
        'grid' => $grid,
        'day_miles' => is_array($stored['day_miles'] ?? null) ? $stored['day_miles'] : $fallback['day_miles'],
        'path_factors' => is_array($stored['path_factors'] ?? null) ? $stored['path_factors'] : $fallback['path_factors'],
        'ground_penalties' => is_array($stored['ground_penalties'] ?? null) ? $stored['ground_penalties'] : $fallback['ground_penalties'],
        'river_ratio' => (float) ($stored['river_ratio'] ?? $fallback['river_ratio']),
        'calibration_target_miles' => (float) ($stored['calibration_target_miles'] ?? $fallback['calibration_target_miles']),
        'source' => 'stored',
    ];
}

/**
 * PURE: was heute von der Quelle abweicht — die Zahl, die als Unterzeile in der Kachel steht.
 *
 * ⭐ Status gehört in den Knopf (AGENTS.md §12): „6 Werte weichen von der GA ab" ist die
 * Information, wegen der man das Fenster überhaupt öffnet.
 */
function avesmapsTravelValuesDeviations(array $values): array
{
    $source = avesmapsTravelValuesSourceTable();
    $grid = is_array($values['grid'] ?? null) ? $values['grid'] : [];
    $reference = (float) ($grid['groupFoot']['Strasse'] ?? 0.0);

    $pathFactors = ['count' => 0, 'values' => []];
    if ($reference > 0.0) {
        foreach ($source['path_factors'] as $pathType => $expected) {
            $ours = isset($grid['groupFoot'][$pathType]) ? (float) $grid['groupFoot'][$pathType] / $reference : null;
            if ($ours === null) { continue; }
            // Die Straße IST der Bezug und kann nicht abweichen; sie taucht deshalb nie auf.
            if (abs($ours - $expected) < 0.005) { continue; }
            $pathFactors['values'][$pathType] = ['ours' => $ours, 'source' => $expected];
            $pathFactors['count']++;
        }
    }

    $dayMiles = ['count' => 0, 'values' => []];
    foreach ($source['day_miles'] as $transport => $expected) {
        $isLand = avesmapsTravelValuesIsLandTransport($transport);
        $column = $isLand ? 'Strasse' : (isset($grid[$transport]['Flussweg']) ? 'Flussweg' : 'Seeweg');
        if (!isset($grid[$transport][$column])) { continue; }
        $ours = avesmapsTravelValuesDayMilesFromSpeed((float) $grid[$transport][$column], $isLand, avesmapsTravelValuesHoursFor($transport));
        if (abs($ours - $expected) < 0.5) { continue; }
        $dayMiles['values'][$transport] = ['ours' => $ours, 'source' => $expected];
        $dayMiles['count']++;
    }

    return [
        'path_factors' => $pathFactors,
        'day_miles' => $dayMiles,
        'total' => $pathFactors['count'] + $dayMiles['count'],
    ];
}

/** PURE: die Umkehrung von avesmapsTravelValuesSpeedFromDayMiles — für die Anzeige „unser Wert". */
function avesmapsTravelValuesDayMilesFromSpeed(float $speed, bool $isLand, float $hours): float
{
    $meanG = $isLand ? AVESMAPS_TRAVEL_MEAN_G : 1.0;
    if ($meanG <= 0.0 || AVESMAPS_TRAVEL_TIME_SCALE <= 0.0) { return 0.0; }

    return $speed * $hours / ($meanG * AVESMAPS_TRAVEL_TIME_SCALE);
}

/**
 * Einen Abschnitt auf die GA-Werte zurücksetzen.
 *
 * 💣 DER RÜCKSETZER IST DAS EINZIGE, WAS DAS RASTER AUF DAS PRODUKT ZIEHT (Entwurf §5). Gespeichert
 * wird das Raster Reisemittel × Wegtyp, so wie es heute ist — ein Fenster, das die rund 60 Zellen
 * ständig aus 18 Zahlen ableitete, schriebe beim ersten Speichern etwa 40 Werte still um. Gemessen:
 * das Verhältnis Pfad zu Straße schwankt je Reisemittel zwischen 0,545 und 0,799.
 */
function avesmapsTravelValuesResetSection(array $values, string $section): array
{
    $source = avesmapsTravelValuesSourceTable();
    $grid = is_array($values['grid'] ?? null) ? $values['grid'] : AVESMAPS_ROUTE_CLIENT_SPEED_TABLE;

    if ($section === 'path_factors' || $section === 'day_miles' || $section === 'all') {
        foreach ($grid as $transport => $row) {
            if (!avesmapsTravelValuesIsLandTransport($transport)) {
                // ⚠️ Wasser hat keine Geländespalte. Der Wegtyp-Rücksetzer lässt es unberührt; nur
                // ein Tagesleistungs-Rücksetzer fasst seine eine Zelle an.
                if ($section === 'path_factors') { continue; }
                $dayMiles = (float) ($source['day_miles'][$transport] ?? 0.0);
                if ($dayMiles <= 0.0) { continue; }
                $speed = avesmapsTravelValuesSpeedFromDayMiles($dayMiles, false, avesmapsTravelValuesHoursFor($transport));
                foreach (array_keys($row) as $pathType) { $grid[$transport][$pathType] = round($speed, 2); }
                continue;
            }
            $dayMiles = (float) ($source['day_miles'][$transport] ?? 0.0);
            if ($dayMiles <= 0.0) { continue; }
            $road = avesmapsTravelValuesSpeedFromDayMiles($dayMiles, true, AVESMAPS_TRAVEL_DEFAULT_HOURS);
            foreach (array_keys($row) as $pathType) {
                $factor = (float) ($source['path_factors'][$pathType] ?? 0.0);
                if ($factor <= 0.0) { continue; }
                $grid[$transport][$pathType] = round($road * $factor, 2);
            }
        }
        $grid = avesmapsTravelValuesApplyCarriageRule($grid);
    }

    $values['grid'] = $grid;
    if ($section === 'ground' || $section === 'all') { $values['ground_penalties'] = $source['ground_penalties']; }
    if ($section === 'misc' || $section === 'all') {
        $values['river_ratio'] = $source['river_ratio'];
        $values['calibration_target_miles'] = $source['calibration_target_miles'];
    }

    return $values;
}

/**
 * PURE: die Kutschenregel wieder aufsetzen.
 *
 * 💣 SIE IST EINE REGEL, KEIN GELÄNDE. S. 123: „auf Karrenwegen und Pässen nur halbe
 * Geschwindigkeit" — „Karrenweg" ist unser `Weg`, den die Quelle mit dem Weg in EINER Kategorie
 * führt (Faktor 0,8, „Kutsche riskant"). Ohne diesen Nachlauf führe die Kutsche nach jedem
 * Rücksetzen auf dem Karrenweg wie ein Reiter.
 * ⚠️ Und NUR auf diesen beiden. Pfad und Wüstenpfad sind nicht betroffen.
 */
function avesmapsTravelValuesApplyCarriageRule(array $grid): array
{
    if (!isset($grid['horseCarriage'])) { return $grid; }
    foreach (['Weg', 'Gebirgspass'] as $pathType) {
        if (!isset($grid['horseCarriage'][$pathType])) { continue; }
        $grid['horseCarriage'][$pathType] = round((float) $grid['horseCarriage'][$pathType] * 0.5, 2);
    }

    return $grid;
}
