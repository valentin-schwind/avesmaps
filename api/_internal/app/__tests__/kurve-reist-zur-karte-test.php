<?php

declare(strict_types=1);

// Die nachgerechnete Beschriftungskurve muss AUF DIE KARTE -- nicht nur in die Ablage.
//
// 🔴 DER BEFUND (14.09.2026, Rueckfrage der Handbuch-Routine: „Nach dem Verschieben von Ecken rechnet
// sich die Kurve NICHT von selbst neu"; Owner: „ja", sie soll es). Gemessen im echten Ablauf, an der
// Flaeche „Thasch" im angemeldeten Editor: Ecke gezogen, `update_area_geometry` 200 -- danach trug die
// Ablage `curve_label_baselines` die NEUE Linie mit passendem Fingerabdruck (avesmapsCurveRefreshStale
// hatte richtig nachgerechnet), aber `label.curveLine` auf der Karte war Zeichen fuer Zeichen die alte.
// Die Antwort trug die Linie nicht mit, und der Browser setzt sie nur beim Laden der Nutzlast.
// Beide Aussagen stimmten also: der Server rechnete, die Karte zeigte es nicht.
//
// Dieser Test FUEHRT avesmapsCurveNachSchreibvorgang aus -- den einen Weg, auf dem der Endpunkt nach
// jedem Schreibvorgang nachrechnet, die Kurven in die Antwort legt und den Stempel danach hebt.
// Die Uebernahme im Browser faehrt js/map-features/__tests__/kurve-folgt-dem-eckzug.test.js.

require_once __DIR__ . '/../app-setting.php';
require_once __DIR__ . '/../curve-label-store.php';

/**
 * SQLite spricht kein MySQL -- dieselbe Uebersetzung wie in kurve-folgt-der-geometrie-test.php.
 * Dazu `kuerzen`: das stille Abschneiden von MySQL ausserhalb des strict mode (AGENTS.md §10), damit
 * der Fall „Zuruecklesen scheitert" wirklich gefahren wird und nicht nur behauptet.
 */
final class AvesmapsKurveReistZurKartePdo extends PDO
{
    /** @var list<string> je Anwurf des Einzelrechners ein Eintrag */
    public array $gerechnetFuer = [];
    public bool $kuerzen = false;

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
        if ($this->kuerzen) {
            $query = str_replace('VALUES (:k, :v)', 'VALUES (:k, substr(:v, 1, 40))', $query);
        }
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

// Zwei Regionen, eine mit Kurvenbeschriftung, eine ohne -- wie in kurve-folgt-der-geometrie-test.php.
function fixture(): AvesmapsKurveReistZurKartePdo
{
    $pdo = new AvesmapsKurveReistZurKartePdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TEXT)');
    $pdo->exec('CREATE TABLE ecosystem_region (
        id INTEGER PRIMARY KEY, public_id TEXT, properties_json TEXT, is_active INT DEFAULT 1)');
    $pdo->exec('CREATE TABLE ecosystem_area (
        id INTEGER PRIMARY KEY, region_id INT, geometry_geojson TEXT,
        geometry_revision INT DEFAULT 1, is_active INT DEFAULT 1)');

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

// Genau das, was avesmapsUpdateEcosystemAreaGeometry an der Flaeche tut: neue Form, Revision + 1.
function eckzug(PDO $pdo): void
{
    $neu = json_encode(['type' => 'Polygon', 'coordinates' => [[
        [100.0, 100.0], [420.0, 100.0], [420.0, 190.0], [100.0, 170.0], [100.0, 100.0],
    ]]]);
    $pdo->exec("UPDATE ecosystem_area SET geometry_geojson = '{$neu}', geometry_revision = geometry_revision + 1 WHERE id = 1");
}

// Die Ablage steht aktuell da, als haette „Rechnen -> Kurven" gerade gelaufen.
function mitAktuellerAblage(): AvesmapsKurveReistZurKartePdo
{
    $pdo = fixture();
    avesmapsCurveRefreshStale($pdo);
    $pdo->gerechnetFuer = [];
    return $pdo;
}

// ---- A. `linien` ist GENAU das, was der Leser danach ausliefert ----------------------------------
// 🔴 Die Form ist die der Leseaktion `baselines` ({line, max}), weil der Browser beide mit DERSELBEN
// Funktion annimmt (avesmapsCurveBaselinesAufLabelsAnwenden). Eine eigene Form waere die zweite
// Fassung, an der sich die Karte und der naechste Neuladen irgendwann widersprechen.
{
    $pdo = mitAktuellerAblage();
    $altLinie = avesmapsCurveReadBaselines($pdo)['r-an']['line'] ?? null;
    eckzug($pdo);
    $e = avesmapsCurveRefreshStale($pdo);
    pruefe(array_keys($e['linien']) === ['r-an'],
        'die nachgerechnete Region reist nicht (oder eine fremde reist mit): ' . json_encode(array_keys($e['linien'])));
    pruefe(array_keys($e['linien']['r-an']) === ['line', 'max'],
        'die Form weicht von der Leseaktion `baselines` ab: ' . json_encode(array_keys($e['linien']['r-an'])));

    $gelesen = avesmapsCurveReadBaselines($pdo);
    pruefe($e['linien']['r-an']['line'] === $gelesen['r-an']['line'],
        'die mitgegebene Linie ist nicht die, die jeder Besucher nach dem Neuladen bekommt');
    pruefe($e['linien']['r-an']['max'] === 2 && (int) $gelesen['r-an']['max_labels'] === 2,
        'die Anzahl reist nicht mit (erwartet 2): ' . json_encode($e['linien']['r-an']['max']));
    pruefe($altLinie !== null && $e['linien']['r-an']['line'] !== $altLinie,
        'die Fixture taugt nicht: die Linie hat sich durch den Eckzug gar nicht geaendert');

    // Ein zweiter Lauf ohne Aenderung gibt NICHTS mit -- sonst zeichnete jedes Speichern die Karte nach.
    $zweiter = avesmapsCurveRefreshStale($pdo);
    pruefe($zweiter['linien'] === [], 'ein Lauf ohne Aenderung gibt trotzdem Linien mit');
}

// ---- B. Ohne `revision` in der Antwort: gar nichts ------------------------------------------------
// 🔴 Der Riegel, der jede Leseaktion kostenlos haelt. Die Fixture hat hier eine VERALTETE Region --
// wuerde der Riegel fehlen, liefe der Einzelrechner an, und genau das zaehlt die Attrappe.
{
    $pdo = fixture();
    $gerufen = 0;
    $antwort = ['regions' => [['public_id' => 'r-an']]];
    $r = avesmapsCurveNachSchreibvorgang($pdo, $antwort, function () use (&$gerufen): int {
        $gerufen++;
        return 99;
    });
    pruefe($r === $antwort, 'eine Leseantwort wird veraendert');
    pruefe($gerufen === 0, 'eine Leseaktion hebt den Stempel');
    pruefe($pdo->gerechnetFuer === [], 'eine Leseaktion wirft den Einzelrechner an');
}

// ---- C. Nach einem Eckzug: die Kurve reist mit, der Stempel kommt DANACH --------------------------
{
    $pdo = mitAktuellerAblage();
    eckzug($pdo);
    $gerufen = 0;
    $lagBeimStempel = null;
    $antwort = ['area' => ['public_id' => 'a-1', 'geometry_revision' => 2], 'revision' => 7];
    $r = avesmapsCurveNachSchreibvorgang($pdo, $antwort, function () use ($pdo, &$gerufen, &$lagBeimStempel): int {
        $gerufen++;
        // 💣 DIE REIHENFOLGE IST DER GANZE SINN DES ZWEITEN HUBS. Hebt er den ETag, BEVOR die Kurve in
        // der Ablage liegt, baut der naechste Besucher die Nutzlast ohne sie -- unter dem neuen ETag,
        // und danach bekommt er 304. Also muss der Leser in diesem Augenblick die Kurve schon liefern.
        $lagBeimStempel = array_keys(avesmapsCurveReadBaselines($pdo));
        return 8;
    });

    pruefe(isset($r['curve_labels']['r-an']['line']), 'die nachgerechnete Kurve reist nicht in der Antwort mit');
    pruefe(array_keys($r['curve_labels']) === ['r-an'], 'eine ausgeschaltete oder unveraenderte Region reist mit');
    pruefe($r['curve_labels']['r-an']['line'] === avesmapsCurveReadBaselines($pdo)['r-an']['line'],
        'die Antwort traegt eine andere Linie als die Ablage');
    pruefe($gerufen === 1, 'der Stempel wurde ' . $gerufen . 'x gehoben -- erwartet genau einmal');
    pruefe($lagBeimStempel === ['r-an'], 'der Stempel wurde gehoben, BEVOR die Kurve in der Ablage lag');
    pruefe($r['revision'] === 8, 'die Antwort nennt nicht die Revision NACH dem zweiten Hub');
    pruefe($r['area'] === $antwort['area'], 'der Rest der Handler-Antwort geht verloren');

    // Und so, wie der Endpunkt sie ausgibt: ein JSON-Objekt je Region, Punkte als [x, y].
    $json = json_decode((string) json_encode(['ok' => true] + $r), true);
    $erster = $json['curve_labels']['r-an']['line'][0] ?? null;
    pruefe(is_array($erster) && count($erster) === 2 && is_numeric($erster[0]) && is_numeric($erster[1]),
        'die Linie kommt nicht als Liste von [x, y] im JSON an');
}

// ---- D. Nichts veraltet: nichts reist, nichts wird gehoben -----------------------------------------
// ⚠️ Auch die ausgeschaltete Region 'r-aus' hat nie eine Ablage -- sie darf trotzdem nichts ausloesen.
{
    $pdo = mitAktuellerAblage();
    $gerufen = 0;
    $r = avesmapsCurveNachSchreibvorgang($pdo, ['revision' => 7], function () use (&$gerufen): int {
        $gerufen++;
        return 8;
    });
    pruefe(!array_key_exists('curve_labels', $r), 'ohne Aenderung reist trotzdem ein `curve_labels` mit');
    pruefe($r['revision'] === 7, 'ohne Aenderung wird die Revision umgeschrieben');
    pruefe($gerufen === 0, 'ohne neue Kurve wird der Stempel gehoben -- jeder Schreibvorgang kostete einen ETag-Wechsel');
    pruefe($pdo->gerechnetFuer === [], 'ohne Aenderung wird trotzdem gerechnet');
}

// ---- E. Der Stempel wirft: das Speichern bleibt gelungen -------------------------------------------
{
    $pdo = mitAktuellerAblage();
    eckzug($pdo);
    $r = avesmapsCurveNachSchreibvorgang($pdo, ['revision' => 7], static function (): int {
        throw new RuntimeException('The ecosystem revision could not be read.');
    });
    pruefe(isset($r['curve_labels']['r-an']), 'ein Wurf beim Stempel nimmt der Karte die Kurve');
    pruefe($r['revision'] === 7, 'ein Wurf beim Stempel verfaelscht die Revision');
}

// ---- F. Das Zuruecklesen scheitert: KEINE Linie auf die Karte ---------------------------------------
// 💣 Liegt die Kurve nicht wirklich in der Ablage (stilles Abschneiden), zeigte die Karte sie bis zum
// Neuladen -- und danach nicht mehr. Ein Marker darf bezeugen, was DA ist, nie was abgesetzt wurde.
{
    $pdo = mitAktuellerAblage();
    eckzug($pdo);
    $pdo->kuerzen = true;
    $gerufen = 0;
    $e = avesmapsCurveRefreshStale($pdo);
    pruefe($e['gerechnet'] === ['r-an'], 'die Fixture taugt nicht: der Einzelrechner lief gar nicht');
    pruefe($e['linien'] === [], 'eine Linie, deren Zuruecklesen scheiterte, reist trotzdem zur Karte');

    $pdo2 = mitAktuellerAblage();
    eckzug($pdo2);
    $pdo2->kuerzen = true;
    $r = avesmapsCurveNachSchreibvorgang($pdo2, ['revision' => 7], function () use (&$gerufen): int {
        $gerufen++;
        return 8;
    });
    pruefe(!array_key_exists('curve_labels', $r) && $gerufen === 0,
        'bei gescheitertem Zuruecklesen reist eine Kurve oder der Stempel wird gehoben');
}

// ---- G. Die Verdrahtung: der Endpunkt geht durch GENAU diesen Weg -----------------------------------
// ⚠️ Mit dem Tokenizer ohne Kommentare gelesen: der Kommentar ueber dem Aufruf nennt die Funktionen
// beim Namen, und ein Textsuchen fand sonst die Warnung statt des Codes.
{
    $quelle = (string) file_get_contents(__DIR__ . '/../../../edit/map/ecosystem.php');
    $code = '';
    foreach (token_get_all($quelle) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $code .= is_array($token) ? $token[1] : $token;
    }
    $posMatch = strpos($code, 'default => avesmapsErrorResponse(400');
    $posRuf = strpos($code, 'avesmapsCurveNachSchreibvorgang(');
    $posAntwort = strpos($code, "avesmapsJsonResponse(200, ['ok' => true] + \$result)");
    pruefe($posMatch !== false && $posRuf !== false && $posAntwort !== false,
        'der Endpunkt ruft avesmapsCurveNachSchreibvorgang nicht (oder Match/Antwort sind nicht mehr auffindbar)');
    // 🔴 NACH dem Handler (er committet selbst) und VOR der Antwort (sonst reist nichts mit).
    pruefe($posMatch < $posRuf && $posRuf < $posAntwort,
        'der Aufruf steht nicht zwischen Handler und Antwort');
    pruefe((bool) preg_match('/\$result\s*=\s*avesmapsCurveNachSchreibvorgang\(\s*\$pdo\s*,\s*\$result\s*,/', $code),
        'das Ergebnis des Aufrufs wird nicht in `$result` zurueckgeschrieben -- die Kurve reiste nie mit');
    pruefe(str_contains(substr($code, (int) $posRuf, (int) $posAntwort - (int) $posRuf), 'avesmapsNextEcosystemRevision($pdo)'),
        'der Endpunkt reicht nicht den echten Stempel herein');
    // Und kein zweiter, direkter Aufruf daneben: der rechnete dieselbe Region ein zweites Mal.
    pruefe(!str_contains($code, 'avesmapsCurveRefreshStale('),
        'der Endpunkt ruft avesmapsCurveRefreshStale zusaetzlich direkt -- doppelte Rechnung');
}

echo "kurve-reist-zur-karte: {$checks} checks passed\n";
