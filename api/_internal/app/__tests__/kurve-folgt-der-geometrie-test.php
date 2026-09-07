<?php

declare(strict_types=1);

// Eine GEOMETRIEAENDERUNG nimmt dem Label seine Kurve -- und niemand rechnete sie nach.
//
// 🔴 DER BEFUND (07.09.2026, Owner: „setzen sich kurvenlabels immer wieder zurueck zu normalen
// labels ... die option Kurvenbeschriftung ist bei den faellen aktiv"). Die Kurve steht NICHT am
// Label: sie wird abgeleitet und liegt je Region im Zwischenspeicher `curve_label_baselines`,
// gestempelt mit dem Fingerabdruck (SUM(geometry_revision), COUNT(*)) ihrer aktiven Flaechen. Jede
// Geometrieaenderung macht `geometry_revision + 1`, jede neue oder geloeschte Flaeche aendert die
// Anzahl -- der Fingerabdruck passt nicht mehr, avesmapsCurveBaselinesFromCache ueberspringt die
// Region, und die Nutzlast liefert das Label OHNE Kurve. Es wird waagerecht gezeichnet, waehrend
// `curve_label` in properties_json weiter `true` sagt. Genau das war zu sehen.
//
// Nachgerechnet wurde bis dahin nur an zwei Stellen: update_region (und auch nur, wenn
// `curve_label`/`curve_label_max` im Rumpf steht) und der Menuepunkt „Labelkurve aktualisieren".
// Der normale Weg „Flaeche aendern" rief keinen von beiden.
//
// 💣 UND DESHALB HAENGT DIE REGEL AM FINGERABDRUCK, NICHT AN EINER LISTE VON SCHREIBERN. Vier
// Funktionen aendern ihn heute (Anlegen, Geometrie aendern, Loeschen, Rueckgaengig), und eine Regel,
// die drei davon bindet, ist keine Regel -- dieselbe Falle, die AGENTS.md §11 an der
// Verkehrsmittel-Sperre und an der Ausstiegsregel je einmal anschreibt. `avesmapsCurveRefreshStale`
// fragt stattdessen die Datenbank, WELCHE eingeschaltete Region gerade einen anderen Fingerabdruck
// traegt als ihre abgelegte Kurve. Damit erbt jeder kuenftige Schreiber die Regel, ohne sie zu kennen.

require_once __DIR__ . '/../app-setting.php';
require_once __DIR__ . '/../curve-label-store.php';

/**
 * SQLite spricht kein MySQL. Dieselbe Uebersetzung wie in curve-label-run-test.php und
 * zoom-bands-test.php: `ON DUPLICATE KEY UPDATE ... VALUES(...)` gibt es dort nicht.
 * Die Flaechentabellen legt die Fixture direkt in SQLite-Syntax an -- der Lese- und der
 * Rechenpfad setzen sie als vorhanden voraus und machen kein DDL.
 */
final class AvesmapsKurveFolgtGeometriePdo extends PDO
{
    /** @var list<string> die public_ids, fuer die der EINZELRECHNER angeworfen wurde */
    public array $gerechnetFuer = [];

    public function exec($statement): int|false
    {
        if (str_contains((string) $statement, 'CREATE TABLE IF NOT EXISTS app_setting')) {
            return parent::exec(
                'CREATE TABLE IF NOT EXISTS app_setting (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL,
                    updated_at TEXT
                )'
            );
        }
        return parent::exec($statement);
    }

    public function prepare($query, $options = []): PDOStatement|false
    {
        $query = str_replace(
            'ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
            'ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value',
            (string) $query
        );
        // 💣 DIE TEURE STELLE MITZAEHLEN. avesmapsCurveRefreshCacheForRegion holt je Region ihre
        // Geometrien mit genau dieser Abfrage und rechnet dann 165-796 ms je Flaeche. Ob eine
        // ausgeschaltete Region uebersprungen wird, ist an der ANTWORT nicht zu sehen (der
        // Einzelrechner meldet fuer sie ohnehin „nicht gerechnet") -- nur daran, ob er ueberhaupt
        // angeworfen wurde. Ohne diesen Zaehler ist der Riegel, der den Normalfall billig macht,
        // unbeobachtet; die Mutationsprobe hat genau das gefunden.
        if (str_contains($query, 'AND r.public_id = :pid')) {
            $this->gerechnetFuer[] = 'ABFRAGE';
        }
        return parent::prepare($query, $options);
    }
}

$checks = 0;
function pruefe(bool $bedingung, string $text): void
{
    global $checks;
    if (!$bedingung) {
        fwrite(STDERR, "FEHLGESCHLAGEN: {$text}\n");
        exit(1);
    }
    $checks++;
}

// ---- Eine Fixture mit zwei Regionen: eine eingeschaltet, eine nicht --------------------------------
function fixture(): PDO
{
    $pdo = new AvesmapsKurveFolgtGeometriePdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TEXT)');
    $pdo->exec('CREATE TABLE ecosystem_region (
        id INTEGER PRIMARY KEY, public_id TEXT, properties_json TEXT, is_active INT DEFAULT 1)');
    $pdo->exec('CREATE TABLE ecosystem_area (
        id INTEGER PRIMARY KEY, region_id INT, geometry_geojson TEXT,
        geometry_revision INT DEFAULT 1, is_active INT DEFAULT 1)');

    // Ein Rechteck, gross genug, dass avesmapsCurveBaseline eine Achse findet.
    $geom = json_encode(['type' => 'Polygon', 'coordinates' => [[
        [100.0, 100.0], [300.0, 100.0], [300.0, 160.0], [100.0, 160.0], [100.0, 100.0],
    ]]]);

    $pdo->exec("INSERT INTO ecosystem_region (id, public_id, properties_json, is_active)
                VALUES (1, 'r-an', '" . json_encode(['curve_label' => true, 'curve_label_max' => 2]) . "', 1)");
    $pdo->exec("INSERT INTO ecosystem_region (id, public_id, properties_json, is_active)
                VALUES (2, 'r-aus', NULL, 1)");
    $pdo->exec("INSERT INTO ecosystem_area (id, region_id, geometry_geojson, geometry_revision, is_active)
                VALUES (1, 1, '{$geom}', 1, 1)");
    $pdo->exec("INSERT INTO ecosystem_area (id, region_id, geometry_geojson, geometry_revision, is_active)
                VALUES (2, 2, '{$geom}', 1, 1)");

    return $pdo;
}

// ---- 1. Ohne Ablage rechnet er die eingeschaltete Region -- und NUR sie ----------------------------
{
    $pdo = fixture();
    $ergebnis = avesmapsCurveRefreshStale($pdo);
    pruefe($ergebnis['gerechnet'] === ['r-an'],
        'die eingeschaltete Region wird nicht (oder die ausgeschaltete faelschlich) gerechnet: '
        . json_encode($ergebnis['gerechnet']));

    $abgelegt = json_decode((string) $pdo->query("SELECT setting_value FROM app_setting WHERE setting_key='curve_label_baselines'")->fetchColumn(), true);
    pruefe(isset($abgelegt['regions']['r-an']['line']), 'die Kurve liegt danach nicht in der Ablage');
    pruefe(!isset($abgelegt['regions']['r-aus']), 'eine ausgeschaltete Region gehoert nicht in die Ablage');
    // ⚠️ Die Anzahl kommt aus der Einstellung, nicht aus der Geometrie.
    pruefe((int) $abgelegt['regions']['r-an']['max'] === 2, 'curve_label_max wandert nicht mit');
    // 💣 UND DIE AUSGESCHALTETE WIRD NICHT EINMAL ANGEFASST. Das ist der Riegel, an dem die Kosten
    // haengen: der Einzelrechner braucht 165-796 ms je Flaeche, und er darf nur fuer Regionen laufen,
    // die eine Kurve WOLLEN (live 82 von 1463). Am Ergebnis ist das nicht zu sehen -- er meldete fuer
    // eine ausgeschaltete Region ohnehin „nicht gerechnet".
    pruefe(count($pdo->gerechnetFuer) === 1,
        'der Einzelrechner lief ' . count($pdo->gerechnetFuer) . 'x -- erwartet: nur fuer die eingeschaltete Region');
}

// ---- 2. Ein zweiter Lauf ohne Aenderung rechnet NICHTS ---------------------------------------------
// 💣 Das ist die Zusicherung, an der die Kosten haengen. Der Aufruf sitzt hinter JEDEM Schreibvorgang
// des Landschafts-Endpunkts; wuerde er jedes Mal rechnen, kostete das Ziehen einer Ecke 165-796 ms je
// Flaeche zusaetzlich, obwohl sich an der Kurve nichts geaendert hat.
{
    $pdo = fixture();
    avesmapsCurveRefreshStale($pdo);
    $zweiter = avesmapsCurveRefreshStale($pdo);
    pruefe($zweiter['gerechnet'] === [], 'ein Lauf ohne Aenderung rechnet trotzdem: ' . json_encode($zweiter['gerechnet']));
}

// ---- 3. Eine GEOMETRIEAENDERUNG loest die Neuberechnung aus -- der eigentliche Befund ---------------
{
    $pdo = fixture();
    avesmapsCurveRefreshStale($pdo);
    $vorher = (string) $pdo->query("SELECT setting_value FROM app_setting WHERE setting_key='curve_label_baselines'")->fetchColumn();

    // Genau das, was avesmapsUpdateEcosystemAreaGeometry tut: neue Geometrie, geometry_revision + 1.
    $neu = json_encode(['type' => 'Polygon', 'coordinates' => [[
        [100.0, 100.0], [400.0, 100.0], [400.0, 170.0], [100.0, 170.0], [100.0, 100.0],
    ]]]);
    $pdo->exec("UPDATE ecosystem_area SET geometry_geojson = '{$neu}', geometry_revision = geometry_revision + 1 WHERE id = 1");

    // Ohne Neuberechnung waere die Region jetzt „veraltet" und der Leser liesse sie weg --
    // das Label verlore seine Kurve.
    pruefe(avesmapsCurveReadBaselines($pdo) === [],
        'der Leser liefert die Kurve trotz veraltetem Fingerabdruck -- dann gaebe es den Befund gar nicht');

    $ergebnis = avesmapsCurveRefreshStale($pdo);
    pruefe($ergebnis['gerechnet'] === ['r-an'], 'die geaenderte Region wird nicht nachgerechnet');
    $nachher = (string) $pdo->query("SELECT setting_value FROM app_setting WHERE setting_key='curve_label_baselines'")->fetchColumn();
    pruefe($nachher !== $vorher, 'die Ablage steht nach der Neuberechnung unveraendert da');
    pruefe(array_keys(avesmapsCurveReadBaselines($pdo)) === ['r-an'],
        'nach dem Nachrechnen liefert der Leser die Kurve nicht wieder aus -- das Label bliebe waagerecht');
}

// ---- 4. Eine NEUE Flaeche aendert die Anzahl und loest ebenso aus -----------------------------------
// 🔴 Der Fingerabdruck ist das PAAR aus Revisionssumme UND Flaechenzahl. Eine zweite Flaeche mit
// Revision 1 laesst die Summe steigen -- aber es gibt Faelle, in denen nur die Anzahl wandert
// (Stilllegen einer Flaeche der Revision 0). Geprueft wird deshalb der Weg ueber die ANZAHL.
{
    $pdo = fixture();
    avesmapsCurveRefreshStale($pdo);
    $pdo->exec("UPDATE ecosystem_area SET is_active = 0 WHERE id = 1");
    $pdo->exec("INSERT INTO ecosystem_area (id, region_id, geometry_geojson, geometry_revision, is_active)
                SELECT 3, 1, geometry_geojson, 1, 1 FROM ecosystem_area WHERE id = 1");
    // Summe bleibt 1, die Flaechenzahl bleibt 1 -- aber es ist eine ANDERE Flaeche. Genau dafuer traegt
    // der Fingerabdruck beide Zahlen; hier bleibt er zufaellig gleich, und das ist bekannt und in Kauf
    // genommen (avesmapsCurveBaselinesFromCache, Befund 8). Der Test haelt nur fest, dass ein
    // ECHTER Anzahlwechsel greift:
    $pdo->exec("INSERT INTO ecosystem_area (id, region_id, geometry_geojson, geometry_revision, is_active)
                SELECT 4, 1, geometry_geojson, 5, 1 FROM ecosystem_area WHERE id = 3");
    $ergebnis = avesmapsCurveRefreshStale($pdo);
    pruefe($ergebnis['gerechnet'] === ['r-an'], 'eine zusaetzliche Flaeche loest keine Neuberechnung aus');
}

// ---- 4b. NUR die Anzahl wandert -- die Revisionssumme bleibt gleich ---------------------------------
// 💣 Beide Haelften des Fingerabdrucks werden gebraucht, und diese Zusicherung ist die einzige, die
// die ANZAHL allein prueft: eine zusaetzliche Flaeche mit geometry_revision 0 laesst die Summe
// unveraendert. Ohne den cnt-Vergleich bliebe die Region „aktuell", ihre Kurve kennte die neue
// Flaeche nicht, und sie liefe still an der halben Landschaft vorbei. Test 4 daneben aendert BEIDE
// Zahlen und haette die Luecke nie gezeigt -- die Mutationsprobe hat sie gefunden.
{
    $pdo = fixture();
    avesmapsCurveRefreshStale($pdo);
    $geom = (string) $pdo->query('SELECT geometry_geojson FROM ecosystem_area WHERE id = 1')->fetchColumn();
    $pdo->exec("INSERT INTO ecosystem_area (id, region_id, geometry_geojson, geometry_revision, is_active)
                VALUES (7, 1, '{$geom}', 0, 1)");
    $summe = (int) $pdo->query('SELECT SUM(geometry_revision) FROM ecosystem_area WHERE region_id = 1 AND is_active = 1')->fetchColumn();
    pruefe($summe === 1, 'die Fixture taugt nicht: die Revisionssumme hat sich mitgeaendert (' . $summe . ')');
    $ergebnis = avesmapsCurveRefreshStale($pdo);
    pruefe($ergebnis['gerechnet'] === ['r-an'],
        'eine zusaetzliche Flaeche mit Revision 0 wird uebersehen -- der cnt-Teil des Fingerabdrucks fehlt');
}

// ---- 5. Der Deckel schuetzt vor einem Massenlauf ----------------------------------------------------
// ⚠️ Ein einzelner Handgriff beruehrt EINE Region (ein Verschmelzen zwei). Sind mehr veraltet, hat ein
// Sammellauf oder ein Import gearbeitet -- und dann gehoert das Nachrechnen dorthin, nicht an eine
// einzelne Speicherung. Der Rest bleibt liegen, bis „Rechnen -> Kurven" laeuft; das ist der Zustand
// von vorher, also nie schlechter.
{
    $pdo = fixture();
    $geom = (string) $pdo->query('SELECT geometry_geojson FROM ecosystem_area WHERE id = 1')->fetchColumn();
    $props = json_encode(['curve_label' => true]);
    for ($i = 10; $i < 15; $i++) {
        $pdo->exec("INSERT INTO ecosystem_region (id, public_id, properties_json, is_active) VALUES ({$i}, 'r{$i}', '{$props}', 1)");
        $pdo->exec("INSERT INTO ecosystem_area (id, region_id, geometry_geojson, geometry_revision, is_active) VALUES ({$i}, {$i}, '{$geom}', 1, 1)");
    }
    $ergebnis = avesmapsCurveRefreshStale($pdo, 2);
    pruefe(count($ergebnis['gerechnet']) === 2,
        'der Deckel greift nicht -- gerechnet wurden ' . count($ergebnis['gerechnet']));
    pruefe($ergebnis['offen'] >= 4, 'die uebrigen werden nicht als offen gemeldet: ' . $ergebnis['offen']);
}

// ---- 6. Er faellt weich aus ------------------------------------------------------------------------
// 💣 Er haengt hinter JEDEM Schreibvorgang. Ein Wurf hier machte aus einem gelungenen Speichern einen
// Fehlschlag, und der Editor haette seine Aenderung verloren geglaubt, obwohl sie steht -- dieselbe
// Begruendung wie beim Nachrechnen in avesmapsUpdateEcosystemRegion.
{
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    // Keine einzige Tabelle -- jede Abfrage wirft.
    $ergebnis = avesmapsCurveRefreshStale($pdo);
    pruefe($ergebnis['gerechnet'] === [], 'ein Fehlschlag meldet gerechnete Regionen');
    pruefe(($ergebnis['fehler'] ?? '') !== '', 'ein Fehlschlag wird nicht benannt -- er waere unauffindbar');
}

// ---- 7. UND DIE VERDRAHTUNG: der Landschafts-Endpunkt ruft ihn -------------------------------------
// 💣 Ohne diese Zusicherung sind die sechs oben gruen und die Kurve springt trotzdem weiter zurueck.
{
    $endpunkt = (string) file_get_contents(__DIR__ . '/../../../edit/map/ecosystem.php');
    pruefe(str_contains($endpunkt, 'avesmapsCurveRefreshStale('),
        'der Landschafts-Endpunkt rechnet die Kurve nach einer Geometrieaenderung nicht nach');
    pruefe(str_contains($endpunkt, "curve-label-store.php"),
        'der Endpunkt bindet die Kurven-Bibliothek nicht ein');
    // 🔴 NACH dem Handler, nie darin: die Handler committen selbst, und avesmapsCurveRefreshCacheForRegion
    // schreibt in app_setting -- das gehoert nicht in eine offene Transaktion auf ecosystem_region.
    $posMatch = strpos($endpunkt, 'default => avesmapsErrorResponse(400');
    $posRuf = strpos($endpunkt, 'avesmapsCurveRefreshStale(');
    pruefe($posMatch !== false && $posRuf !== false && $posRuf > $posMatch,
        'das Nachrechnen steht nicht NACH dem Handler -- es liefe in dessen Transaktion');

    // ⚠️ UND NUR NACH EINEM SCHREIBVORGANG. Ohne den Riegel zahlte jede Statusabfrage die
    // Aggregatabfrage mit -- `assignment_status`, `list_changes` und der 45-s-Takt laufen ueber
    // denselben Endpunkt. Erkannt wird der Schreibvorgang an der `revision` in der Antwort: die setzt
    // jeder Schreibweg ueber avesmapsNextEcosystemRevision, und kein Lesepfad.
    $ab = substr($endpunkt, (int) $posMatch, max(0, (int) $posRuf - (int) $posMatch) + 200);
    pruefe((bool) preg_match('/if \(\s*array_key_exists\(\s*[\'"]revision[\'"]\s*,\s*\$result\s*\)\s*\)\s*\{\s*\R?\s*avesmapsCurveRefreshStale\(/u', $ab),
        'das Nachrechnen haengt nicht an der `revision` -- es liefe auch bei jeder Leseaktion');
}

echo "kurve-folgt-der-geometrie: {$checks} checks passed\n";
