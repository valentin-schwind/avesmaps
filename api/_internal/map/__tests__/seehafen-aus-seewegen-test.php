<?php

declare(strict_types=1);

/**
 * Der Lauf „Seehafen aus Seewegen" -- WIRKLICH GEFAHREN, nicht gelesen.
 *
 * 🔴 DER ANLASS (Owner 26.09.2026): „kannst du jetzt alle orte automatisch anhaekeln, die derzeit eine seewege
 * anbindung haben?" Zugesichert wird, was im Kopf von avesmapsSeehafenAusSeewegen (api/_internal/map/features.php) steht:
 *   A  die Auswahl ist die des ROUTERS: Seeweg-Ende (Toleranz) ODER innerer Stuetzpunkt (round-5); Strassen zaehlen nicht
 *   B  nur Orte -- eine Kreuzung am Seeweg bekommt kein Haekchen, auch wenn der Router sie als seegebunden fuehrt
 *   C  Trockenlauf ist die Vorgabe und schreibt NICHTS, auch keine Revision
 *   D  scharf: eine Revision je Lauf, der Rest des Nests bleibt, `updated_at`/`updated_by` bleiben, KEIN Protokolleintrag
 *   E  nur anhaekeln: wer das Haekchen schon traegt, ist kein Ziel; wiederholt findet der Lauf nichts und hebt keine Revision
 *   F  Revisionsriegel: ein Ort, der zwischen Lesen und Schreiben gespeichert wurde, wird uebersprungen, nicht ueberschrieben
 *   G  die Namens-Fassung des Routers (avesmapsCollectClientSeaBoundLocationNames) liefert unveraendert dieselben Namen
 *   H  die Aktion am Endpunkt: nur Admins, scharf nur mit `apply === true`
 *
 * ⚠️ Der PDO-Aufsatz uebersetzt nur fuers Testen (`FOR UPDATE`, `ON DUPLICATE KEY UPDATE`) -- dieselbe Bauform wie
 * kreuzungstyp-reparatur-test.php. Die Produktionsform bleibt unangetastet (AGENTS.md §9).
 *
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll \
 *     api/_internal/map/__tests__/seehafen-aus-seewegen-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- dieser Test fuehrt den Lauf wirklich aus.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../features.php';

final class AvesmapsSeehafenTestPdo extends PDO
{
    /** Einmaliger Zwischenruf direkt VOR dem Schreib-UPDATE -- ein fremdes Speichern zwischen Lesen und Schreiben. */
    public ?Closure $zwischenruf = null;

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $query = str_replace('FOR UPDATE', '', $query);
        if ($this->zwischenruf !== null && str_contains($query, 'UPDATE map_features') && str_contains($query, 'updated_at = updated_at')) {
            $ruf = $this->zwischenruf;
            $this->zwischenruf = null;
            $ruf($this);
        }

        return parent::prepare($query, $options);
    }

    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }

        return parent::exec($statement);
    }
}

$checks = 0;
$pruefe = static function (bool $bedingung, string $meldung) use (&$checks): void {
    $checks++;
    assert($bedingung, $meldung);
};

$baueDatenbank = static function (): AvesmapsSeehafenTestPdo {
    $pdo = new AvesmapsSeehafenTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE map_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
        geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
        is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 1,
        updated_by INTEGER NULL, updated_at TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL
    )');
    $pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
    $pdo->exec('INSERT INTO map_revision (id, revision) VALUES (1, 40)');
    $pdo->exec('CREATE TABLE map_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
        actor_user_id INTEGER, before_json TEXT, after_json TEXT
    )');

    $zeile = $pdo->prepare('INSERT INTO map_features
        (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json, is_active, revision, updated_by, updated_at)
        VALUES (:public_id, :name, :feature_type, :feature_subtype, :geometry_type, :geometry_json, :properties_json, :is_active, 7, 99, :updated_at)');
    $ort = static function (string $id, string $name, float $x, float $y, array $nest = [], string $typ = 'location', string $subtyp = 'stadt', int $aktiv = 1) use ($zeile): void {
        $zeile->execute([
            'public_id' => $id, 'name' => $name, 'feature_type' => $typ, 'feature_subtype' => $subtyp,
            'geometry_type' => 'Point',
            'geometry_json' => json_encode(['type' => 'Point', 'coordinates' => [$x, $y]]),
            'properties_json' => json_encode($nest + ['name' => $name, 'feature_type' => $typ, 'feature_subtype' => $subtyp]),
            'is_active' => $aktiv, 'updated_at' => '2026-09-01 12:00:00',
        ]);
    };
    $weg = static function (string $id, string $subtyp, array $punkte) use ($zeile): void {
        $zeile->execute([
            'public_id' => $id, 'name' => $subtyp . '-' . $id, 'feature_type' => 'path', 'feature_subtype' => $subtyp,
            'geometry_type' => 'LineString',
            'geometry_json' => json_encode(['type' => 'LineString', 'coordinates' => $punkte]),
            'properties_json' => json_encode(['feature_type' => 'path', 'feature_subtype' => $subtyp]),
            'is_active' => 1, 'updated_at' => '2026-09-01 12:00:00',
        ]);
    };

    $ort('ort-hafen', 'Hafenstadt', 10.0, 10.0, ['is_nodix' => true, 'description' => 'bleibt stehen']);
    $ort('ort-insel', 'Inselort', 20.0, 20.0, [], 'location', 'dorf');
    $ort('ort-zwischen', 'Zwischenhalt', 15.0, 30.0);
    $ort('ort-kap', 'Kap', 15.0, 40.0, [], 'location', 'gebaeude');
    $ort('ort-binnen', 'Binnenstadt', 50.0, 50.0);
    $ort('ort-schon', 'Schonhafen', 60.0, 60.0, ['is_seaport' => true]);
    $ort('kreuzung-see', 'Kreuzung-77', 30.0, 10.0, [], 'junction', 'crossing');
    $ort('ort-alt', 'Altort', 80.0, 80.0, [], 'location', 'dorf', 0);

    $weg('see-1', 'Seeweg', [[10.0, 10.0], [20.0, 20.0]]);                    // zwei Enden
    $weg('see-2', 'Seeweg', [[15.0, 25.0], [15.0, 30.0], [15.0, 40.0]]);      // innerer Stuetzpunkt + Ende
    $weg('see-3', 'Seeweg', [[10.0, 10.0], [30.0, 10.0]]);                    // endet an einer Kreuzung
    $weg('see-4', 'Seeweg', [[60.0, 60.0], [70.0, 70.0]]);                    // traegt das Haekchen schon
    $weg('see-5', 'Seeweg', [[80.0, 80.0], [90.0, 90.0]]);                    // der Ort daran ist inaktiv
    $weg('land-1', 'Strasse', [[10.0, 10.0], [50.0, 50.0]]);                   // Strasse zaehlt nicht

    return $pdo;
};

$nest = static function (PDO $pdo, string $id): array {
    $statement = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = :id');
    $statement->execute(['id' => $id]);
    return json_decode((string) $statement->fetchColumn(), true);
};
$feld = static function (PDO $pdo, string $id, string $spalte): mixed {
    $statement = $pdo->prepare('SELECT ' . $spalte . ' FROM map_features WHERE public_id = :id');
    $statement->execute(['id' => $id]);
    return $statement->fetchColumn();
};
$kartenRevision = static fn (PDO $pdo): int => (int) $pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn();

// ===== A/B) Die Auswahl -- die reine Rechnung ueber die Kartenobjekte ============================
require_once __DIR__ . '/../../routing/map-data.php';
require_once __DIR__ . '/../../routing/network-data.php';
require_once __DIR__ . '/../../routing/client-graph.php';
$pdo = $baueDatenbank();
$haefen = avesmapsSeehafenOrteAusKarte(avesmapsFetchRouteMapFeatures($pdo));
$ids = array_keys($haefen);
sort($ids);
$pruefe($ids === ['ort-hafen', 'ort-insel', 'ort-kap', 'ort-schon', 'ort-zwischen'],
    'A: genau die Orte an Seewegen -- Enden und innerer Stuetzpunkt, ohne Strasse, ohne inaktiven Ort: ' . json_encode($ids));
$pruefe(!isset($haefen['kreuzung-see']), 'B: eine Kreuzung am Seeweg ist kein Seehafen');
$pruefe(!isset($haefen['ort-binnen']), 'A: eine Strasse macht keinen Seehafen');
$pruefe(($haefen['ort-kap']['subtype'] ?? '') === 'gebaeude', 'A: auch ein Gebaeude am Seeweg gilt als Ort');

// ===== G) Die Namens-Fassung des Routers ist unveraendert =========================================
$netz = avesmapsBuildRouteNetworkData(['features' => avesmapsFetchRouteMapFeatures($pdo)]);
$orte = [];
foreach ($netz['locations'] as $o) {
    $o = avesmapsClientRouteLocationWithCoordinates($o);
    if ($o !== null) $orte[] = $o;
}
$namen = array_keys(avesmapsCollectClientSeaBoundLocationNames(
    $netz, $orte, avesmapsBuildClientLocationCoordinateIndex($orte), avesmapsBuildClientLocationCellIndex($orte)
));
sort($namen);
$pruefe($namen === ['Hafenstadt', 'Inselort', 'Kap', 'Kreuzung-7', 'Schonhafen', 'Zwischenhalt'],
    'G: der Router fuehrt weiter JEDEN beruehrten Knoten als seegebunden, Kreuzungen eingeschlossen (Platzhaltername wird Kreuzung-<Zeilen-Id>): ' . json_encode($namen));

// ===== C) Trockenlauf ============================================================================
$vorher = $kartenRevision($pdo);
$trocken = avesmapsSeehafenAusSeewegen($pdo);
$pruefe($trocken['dry_run'] === true, 'C: ohne Angabe ist es ein Trockenlauf');
$pruefe($trocken['seehaefen'] === 5 && $trocken['neu'] === 4 && $trocken['gesetzt'] === 0, 'C: zaehlt, schreibt nicht: ' . json_encode($trocken));
$pruefe($trocken['orte'] === ['Hafenstadt', 'Inselort', 'Kap', 'Zwischenhalt'], 'C: die Liste nennt die neuen Haefen, sortiert');
$pruefe($kartenRevision($pdo) === $vorher && $trocken['revision'] === 0, 'C: der Trockenlauf hebt keine Revision');
$pruefe(!isset($nest($pdo, 'ort-hafen')['is_seaport']), 'C: der Trockenlauf schreibt kein Nest');

// ===== D) Scharf ================================================================================
$scharf = avesmapsSeehafenAusSeewegen($pdo, false);
$pruefe($scharf['gesetzt'] === 4 && $scharf['uebersprungen'] === [], 'D: vier Orte angehaekelt: ' . json_encode($scharf));
$pruefe($kartenRevision($pdo) === $vorher + 1 && $scharf['revision'] === $vorher + 1, 'D: genau EINE Revision je Lauf');
foreach (['ort-hafen', 'ort-insel', 'ort-zwischen', 'ort-kap'] as $id) {
    $pruefe(($nest($pdo, $id)['is_seaport'] ?? null) === true, 'D: ' . $id . ' traegt den Seehafen');
    $pruefe((int) $feld($pdo, $id, 'revision') === $scharf['revision'], 'D: ' . $id . ' traegt die Revision des Laufs');
    $pruefe($feld($pdo, $id, 'updated_at') === '2026-09-01 12:00:00' && (int) $feld($pdo, $id, 'updated_by') === 99,
        'D: updated_at und updated_by bleiben stehen (' . $id . ')');
}
$hafen = $nest($pdo, 'ort-hafen');
$pruefe(($hafen['is_nodix'] ?? null) === true && ($hafen['description'] ?? null) === 'bleibt stehen', 'D: der Rest des Nests bleibt');
$pruefe(!isset($nest($pdo, 'ort-binnen')['is_seaport']) && !isset($nest($pdo, 'kreuzung-see')['is_seaport']),
    'D: Binnenstadt und Kreuzung bleiben unberuehrt');
$pruefe((int) $feld($pdo, 'ort-schon', 'revision') === 7, 'E: wer das Haekchen schon traegt, wird nicht geschrieben');
$pruefe((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0, 'D: kein Protokolleintrag je Ort');

// ===== E) Wiederholt: nichts zu tun, keine Revision =============================================
$nochmal = avesmapsSeehafenAusSeewegen($pdo, false);
$pruefe($nochmal['neu'] === 0 && $nochmal['gesetzt'] === 0 && $nochmal['revision'] === 0, 'E: der zweite Lauf findet nichts');
$pruefe($kartenRevision($pdo) === $vorher + 1, 'E: ein leerer Lauf hebt keine Revision');

// ===== E) Nur anhaekeln, nie abhaekeln ==========================================================
$pdo->exec("UPDATE map_features SET is_active = 0 WHERE public_id = 'see-1'");
$ohneWeg = avesmapsSeehafenAusSeewegen($pdo, false);
$pruefe($ohneWeg['gesetzt'] === 0 && ($nest($pdo, 'ort-insel')['is_seaport'] ?? null) === true,
    'E: ein Ort, dessen Seeweg verschwand, behaelt sein Haekchen');

// ===== F) Revisionsriegel =======================================================================
$pdo2 = $baueDatenbank();
$pdo2->zwischenruf = static function (PDO $pdo): void {
    $pdo->exec("UPDATE map_features SET revision = 555, properties_json = '{\"name\":\"Kap\",\"description\":\"frisch gespeichert\"}' WHERE public_id = 'ort-kap'");
};
$riegel = avesmapsSeehafenAusSeewegen($pdo2, false);
$pruefe($riegel['gesetzt'] === 3 && $riegel['uebersprungen'] === ['ort-kap'], 'F: der zwischendurch gespeicherte Ort wird uebersprungen: ' . json_encode($riegel));
$pruefe(($nest($pdo2, 'ort-kap')['description'] ?? null) === 'frisch gespeichert', 'F: das fremde Speichern bleibt stehen');

// ===== H) Der Endpunkt ==========================================================================
$endpunkt = (string) file_get_contents(__DIR__ . '/../../../edit/map/features.php');
$pruefe(preg_match("/'seehafen_aus_seewegen' => \\(static function \\(\\) use \\(\\\$pdo, \\\$payload, \\\$user\\): array \\{\\s*if \\(!avesmapsUserCan\\(\\\$user, 'admin'\\)\\)/", $endpunkt) === 1,
    'H: die Aktion steht am Endpunkt und prueft zuerst das Admin-Recht');
$pruefe(str_contains($endpunkt, "avesmapsSeehafenAusSeewegen(\$pdo, (\$payload['apply'] ?? false) !== true)"),
    'H: scharf nur mit apply === true -- alles andere ist ein Trockenlauf');

echo "seehafen-aus-seewegen-test: {$checks} Zusicherungen erfuellt\n";
