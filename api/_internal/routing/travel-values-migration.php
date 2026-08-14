<?php

declare(strict_types=1);

// Die einmalige Migration der Tempowerte auf die GA-Zahlen — Schritt 2.
// Entwurf: docs/superpowers/specs/2026-08-07-tempowerte-design.md §6.3.
//
// PURITY CONTRACT: side-effect-free on include. Der Plan ist rein, die Schreibhälfte nimmt ihre PDO
// ausdrücklich entgegen.
//
// 🔴 SIE LÄUFT GENAU EINMAL, AN EINEM EIGENEN MERKER (`app_setting['travel_values_v1']`) — nicht an
// „wurde gerade eine Spalte angelegt". Die beiden Fragen sehen gleich aus und sind es nicht: ein
// gemeinsamer „war etwas neu?"-Schalter fährt die Saat ein zweites Mal über jeden Wert, den der Owner
// seither nachgeschärft hat. Genau davor warnt der Kommentar an `offroad_factor` in ecosystem.php.
//
// 💣 DDL COMMITTET IMPLIZIT. Das `ALTER TABLE` für die Spalte steht in avesmapsEcosystemEnsureTables()
// und läuft dort VOR jeder Transaktion; hier drin ist nichts als DML. Auch `avesmapsAppSettingSet`
// legt seine Tabelle an und ist damit DDL — deshalb wird diese Datei nur aus EnsureTables gerufen,
// nie aus einem Schreib-Handler zwischen beginTransaction() und commit().
//
// ⚠️ Was sie NICHT anfasst: die Wegtypen. Sie zieht die Querfeldein-Spalte und die Landschaftsspalte,
// sonst nichts. Ein Deploy, der jede Reisezeit auf jeder Straße verschiebt, ist keine Nebenwirkung
// eines Wald-Features — die sechs abweichenden Wegtypen setzt erst ein Klick im Fenster zurück.

require_once __DIR__ . '/travel-values.php';
require_once __DIR__ . '/../app/app-setting.php';

const AVESMAPS_TRAVEL_VALUES_MIGRATION_KEY = 'travel_values_v1';

// Die beiden Ebenen, deren Arten überhaupt Boden sind. `derographisch` benennt einen Landstrich
// („Kosch"), `klima` ein Band — keins von beidem sagt etwas darüber, wie es sich dort läuft.
const AVESMAPS_TRAVEL_VALUES_TERRAIN_KINDS = ['topographie', 'vegetation'];

// 💣 WASSER BEKOMMT KEINEN BODENFAKTOR. `see` und `meer` SPERREN (V13), sie bremsen nicht: eine
// Querfeldein-Kante entsteht dort gar nicht erst. Ein Faktor daneben wäre eine zweite, leisere
// Antwort auf dieselbe Frage, und die beiden liefen auseinander.
const AVESMAPS_TRAVEL_VALUES_WATER_TYPE_KEYS = ['see', 'meer'];

/**
 * PURE: was die Migration schreiben würde — je Landschaftsart ihr Faktor, dazu das neue Raster.
 *
 * Zwei Regeln, und der Unterschied zwischen ihnen ist der Kern dieser ganzen Migration:
 *
 * 1. **Die neun mit Quellenzeile** bekommen ihren GA-Wert, unverändert und ohne Rechnung.
 * 2. **Die elf ohne** behalten ihr VERHÄLTNIS zum offenen Boden: `Basis ÷ offroad_factor`.
 *
 * 💣 FÜR DIE ELF IST „VERHALTENSGLEICH" DIE FALSCHE REGEL, und das ist keine Feinheit. `offroad_factor`
 * misst gegen den Querfeldein-Bezug — und genau der wandert (0,31 → 0,75). Wer die heutige ABSOLUTE
 * Geschwindigkeit einfriert, bekommt eine Landschaft, die langsamer ist als gar keine:
 * `flussland_flusstal` (15 Flächen) steht auf 1,00, „bremst also nicht" — eingefroren bliebe es bei
 * 0,96 Meilen/h, während der ungezeichnete Boden daneben auf 2,30 geht. Eine gezeichnete Aue wäre dann
 * ein Hindernis, *weil* jemand sie gezeichnet hat.
 *
 * @param list<array{kind:string,type_key:string,offroad_factor:float|string|null}> $typeRows
 * @param array $values die geltenden Tempowerte (avesmapsTravelValuesRead)
 * @return array{factors:list<array{kind:string,type_key:string,factor:float}>,grid:array}
 */
function avesmapsTravelValuesMigrationPlan(array $typeRows, array $values): array
{
    $base = avesmapsTravelValuesOffroadBaseFactor();
    $sourceLandscapes = avesmapsTravelValuesSourceTable()['landscapes'];

    $factors = [];
    foreach ($typeRows as $row) {
        if (!is_array($row)) { continue; }
        $kind = (string) ($row['kind'] ?? '');
        $typeKey = (string) ($row['type_key'] ?? '');
        if (!in_array($kind, AVESMAPS_TRAVEL_VALUES_TERRAIN_KINDS, true)) { continue; }
        if (in_array($typeKey, AVESMAPS_TRAVEL_VALUES_WATER_TYPE_KEYS, true)) { continue; }

        if (isset($sourceLandscapes[$typeKey])) {
            $factor = (float) $sourceLandscapes[$typeKey];
        } else {
            // ⚠️ Ein fehlender oder unsinniger offroad_factor liest sich wie „bremst nicht", also wie
            // offener Boden. Eine Division durch null wäre hier ein 500 mitten in der Selbstheilung.
            $offroad = (float) ($row['offroad_factor'] ?? 1.0);
            if ($offroad <= 0.0) { $offroad = 1.0; }
            $factor = $base / $offroad;
        }

        // DECIMAL(4,3) — drei Nachkommastellen, und zwar hier gerundet statt von MySQL, damit der
        // gespeicherte Wert derselbe ist, den der Plan nennt.
        $factors[] = ['kind' => $kind, 'type_key' => $typeKey, 'factor' => round($factor, 3)];
    }

    return ['factors' => $factors, 'grid' => avesmapsTravelValuesMigrateOffroadColumn($values)];
}

/**
 * PURE: die Querfeldein-Spalte des Rasters auf `Straße × GA-Faktor` — und sonst keine Zelle.
 *
 * 🔴 GERECHNET AUS DER STRASSE DIESER ZEILE, nicht aus der GA-Tagesleistung. Damit trägt die neue
 * Zelle jede Anpassung mit, die der Owner an der Straße schon vorgenommen hat — und auf einem
 * unangetasteten Raster kommt dasselbe heraus (Fußgruppe 3,07 × 0,75 = 2,30).
 *
 * ⚠️ Die Kutsche bekommt ihre Zelle mit (5,12 × 0,75 = 3,84) und fährt trotzdem nie querfeldein: das
 * verbietet `avesmapsClientRouteTransportOptions('Querfeldein')`, eine Regel des Regelwerks, kein
 * Tempo. Die Zelle hier auszulassen hiesse, dieselbe Sperre ein zweites Mal zu behaupten.
 */
function avesmapsTravelValuesMigrateOffroadColumn(array $values): array
{
    $grid = is_array($values['grid'] ?? null) ? $values['grid'] : AVESMAPS_ROUTE_CLIENT_SPEED_TABLE;
    $base = avesmapsTravelValuesOffroadBaseFactor();

    foreach ($grid as $transport => $row) {
        if (!is_array($row) || !isset($row['Querfeldein'], $row['Strasse'])) { continue; }
        $road = (float) $row['Strasse'];
        if ($road <= 0.0) { continue; }
        $grid[$transport]['Querfeldein'] = round($road * $base, 2);
    }

    return $grid;
}

/**
 * Die Landschaftsfaktoren schreiben — NUR, wo noch nichts steht. Gibt die Zahl der Zeilen zurück.
 *
 * 🔴 `WHERE terrain_speed_factor IS NULL` ist der zweite Riegel neben dem Merker, und er ist billig.
 * `NULL` heißt „keine eigene Aussage", 0,750 heißt „der Owner hat ausdrücklich ‚wie offener Boden‘
 * gesagt" — dieselbe `null` ≠ `0`-Regel wie in V11. Nur so kann eine spätere Saat nachtragen, ohne
 * eine Entscheidung zu überschreiben.
 *
 * @param list<array{kind:string,type_key:string,factor:float}> $factors
 */
function avesmapsTravelValuesWriteLandscapeFactors(PDO $pdo, array $factors): int
{
    $statement = $pdo->prepare(
        'UPDATE ecosystem_region_type
            SET terrain_speed_factor = :f
          WHERE kind = :k AND type_key = :t AND terrain_speed_factor IS NULL'
    );

    $written = 0;
    foreach ($factors as $entry) {
        $statement->execute([
            'f' => $entry['factor'],
            'k' => $entry['kind'],
            't' => $entry['type_key'],
        ]);
        $written += $statement->rowCount();
    }

    return $written;
}

/**
 * Der Plan aus der Datenbank — `null`, wenn es nichts zu planen gibt.
 *
 * 🔴 EINE LEERE ARTENTABELLE IST KEIN PLAN, SONDERN EIN „NOCH NICHT". Sie ist der Zustand, in dem die
 * Migration vor der Saat liefe: sie fände nichts, setzte trotzdem ihren Merker und wäre für immer
 * erledigt, ohne je etwas getan zu haben. Das ist Befund A35, wörtlich.
 *
 * ⭐ Eigene Funktion, weil sie die HALBE Migration ist, die sich gegen sqlite prüfen lässt: sie liest
 * und rechnet nur, und beides in Standard-SQL. Was danach kommt (`avesmapsAppSettingSet`) ist MySQLs
 * `ON DUPLICATE KEY UPDATE` und läuft nur dort.
 */
function avesmapsTravelValuesPlanFromDatabase(PDO $pdo): ?array
{
    $statement = $pdo->query('SELECT kind, type_key, offroad_factor FROM ecosystem_region_type');
    if ($statement === false) { return null; }
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($rows === []) { return null; }

    // Die geltenden Werte reisen im Plan mit: der Schreiber braucht sie ganz (er legt EINE Zeile JSON
    // ab), und ein zweiter Aufruf waere eine zweite Abfrage auf dieselbe Antwort.
    $values = avesmapsTravelValuesRead($pdo);
    $plan = avesmapsTravelValuesMigrationPlan($rows, $values);
    $plan['values'] = $values;

    return $plan;
}

/**
 * Die Migration: Merker prüfen, lesen, planen, schreiben, Merker setzen. `true`, wenn sie lief.
 *
 * 🔴 SIE LÄUFT NACH DER SAAT. Vorher stünden auf einer frischen Datenbank null Zeilen in
 * `ecosystem_region_type` — sie fände nichts, setzte trotzdem ihren Merker und wäre damit für immer
 * erledigt, ohne je etwas getan zu haben. Das ist der Fehler aus Befund A35, wörtlich.
 *
 * ⚠️ Sie fällt INERT aus: kann sie nicht lesen oder nicht schreiben, bleibt der Merker ungesetzt und
 * der nächste Aufruf versucht es erneut. Ein halb migrierter Zustand ist dabei harmlos — der
 * Spaltenschreiber überspringt, was schon dasteht.
 */
function avesmapsTravelValuesMigrateOnce(PDO $pdo): bool
{
    if (avesmapsAppSettingGetWithoutDdl($pdo, AVESMAPS_TRAVEL_VALUES_MIGRATION_KEY, '') === '1') {
        return false;
    }

    $plan = avesmapsTravelValuesPlanFromDatabase($pdo);
    if ($plan === null) { return false; }

    $values = is_array($plan['values'] ?? null) ? $plan['values'] : avesmapsTravelValuesRead($pdo);
    avesmapsTravelValuesWriteLandscapeFactors($pdo, $plan['factors']);

    // 💣 EINE ZEILE JSON, ATOMAR. Ein halb gespeichertes Tempo-Raster ist ein kaputter Router
    // (Entwurf §6.2) — deshalb steht das Ganze in einem Wert und nicht in sechsundzwanzig Zeilen.
    $values['grid'] = $plan['grid'];
    $stored = avesmapsTravelValuesStorableShape($values);
    avesmapsAppSettingSet($pdo, AVESMAPS_TRAVEL_VALUES_SETTING_KEY, (string) json_encode($stored, JSON_UNESCAPED_UNICODE));

    // Derselbe Stempel, den der Endpunkt beim Speichern hebt. Ohne ihn sähe die Migration für jeden
    // späteren Leser aus wie „am Speicher wurde nie etwas geändert".
    avesmapsAppSettingSet($pdo, AVESMAPS_TRAVEL_VALUES_SETTING_KEY . '_stamp', (string) time());
    avesmapsAppSettingSet($pdo, AVESMAPS_TRAVEL_VALUES_MIGRATION_KEY, '1');

    return true;
}
