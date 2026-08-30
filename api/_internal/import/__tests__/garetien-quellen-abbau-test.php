<?php

declare(strict_types=1);

// Aufraeumen nach einem Fehlimport -- die feature_sources-VERKNUEPFUNGEN mit
// origin='garetien' zaehlen und entfernen, NIEMALS die sources-Zeilen selbst.
//
// Miss-die-DIFFERENZ, nicht nur "es ist weniger geworden": eine Verknuepfung mit
// origin='garetien' verschwindet, eine mit origin='manual'/'wiki_publication' AM
// SELBEN OBJEKT bleibt unberuehrt stehen -- und die sources-Zeile selbst bleibt in
// jedem Fall bestehen, auch wenn danach niemand mehr auf sie zeigt.
//
// 💣 avesmapsNextMapRevision benutzt MySQLs ON DUPLICATE KEY UPDATE, das SQLite nicht
// kennt -- die Naht liegt im TREIBER (wie in garetien-uebernahme-test.php vorgemacht),
// der Produktivcode wird NICHT fuer den Test verbogen.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-quellen-abbau-test.php

require_once __DIR__ . '/../garetien-quellen-abbau.php';

$pruefungen = 0;

/** Die einzige MySQL-eigene Anweisung im Schreibpfad dieser Datei, an der Treiber-Naht uebersetzt. */
final class AvesmapsGaretienQuellenAbbauTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'INTO map_revision') && str_contains($statement, 'ON DUPLICATE KEY UPDATE')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }
        // Das selbstheilende DDL des Hauses ist MySQL-eigen (AUTO_INCREMENT, ENGINE=InnoDB) und
        // laeuft hier nicht -- das Schema steht unten von Hand vollstaendig da; ein ALTER TABLE
        // (dieselbe selbstheilende Routine legt origin/reference_kind/pages/note nach) wird
        // ebenso geschluckt, nicht uebersetzt, aus demselben Grund.
        if (str_contains($statement, 'AUTO_INCREMENT')
            || str_contains($statement, 'ENGINE=InnoDB')
            || str_starts_with(ltrim($statement), 'ALTER TABLE')) {
            return 0;
        }

        return parent::exec($statement);
    }

    /**
     * avesmapsEnsureFeatureSourceTables fragt information_schema.COLUMNS, ob eine Spalte schon
     * existiert -- die gibt es unter SQLite nicht. Das Schema unten traegt alle nachgeruesteten
     * Spalten schon von Hand, die Antwort ist also immer "ja, gibt es schon".
     */
    public function query(string $query, ?int $fetchMode = null, mixed ...$args): PDOStatement|false
    {
        if (str_contains($query, 'information_schema')) {
            return parent::query('SELECT 1 AS n');
        }

        return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$args);
    }
}

function avesmapsGaretienQuellenAbbauTestPdo(): PDO
{
    $pdo = new AvesmapsGaretienQuellenAbbauTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec("CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, url_hash TEXT UNIQUE,
        wiki_key TEXT NULL, label TEXT, source_type TEXT, is_official INTEGER DEFAULT 0, created_by INTEGER NULL,
        license TEXT NOT NULL DEFAULT '', attribution TEXT NOT NULL DEFAULT '')");
    $pdo->exec("CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
        entity_public_id TEXT NOT NULL, source_id INTEGER NOT NULL, status TEXT DEFAULT 'approved',
        created_by INTEGER NULL, origin TEXT DEFAULT 'manual', reference_kind TEXT NULL, pages TEXT NULL,
        note TEXT NULL, UNIQUE(entity_type, entity_public_id, source_id))");
    $pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
    $pdo->exec('INSERT INTO map_revision (id, revision) VALUES (1, 41)');

    return $pdo;
}

function avesmapsGaretienQuellenAbbauTestQuelle(PDO $pdo, string $url): int
{
    // 💣 ZWEI Platzhalter fuer denselben Wert, nicht einer doppelt gebunden -- ein MySQL mit
    // ATTR_EMULATE_PREPARES => false (Hausstandard, avesmapsCreatePdo) lehnt einen mehrfach
    // verwendeten benannten Platzhalter mit SQLSTATE[HY093] ab; ein SQLite-Test bliebe dabei
    // gruen und wuerde die Falle verstecken statt sie zu zeigen (sql-platzhalter-einmalig-test.php).
    $pdo->prepare('INSERT INTO sources (url, url_hash, label, source_type) VALUES (:u, :h, :l, \'briefspiel\')')
        ->execute(['u' => $url, 'h' => sha1($url), 'l' => $url]);

    return (int) $pdo->lastInsertId();
}

function avesmapsGaretienQuellenAbbauTestLink(PDO $pdo, string $entityType, string $publicId, int $sourceId, string $origin): void
{
    $pdo->prepare(
        'INSERT INTO feature_sources (entity_type, entity_public_id, source_id, origin) VALUES (:t, :p, :s, :o)'
    )->execute(['t' => $entityType, 'p' => $publicId, 's' => $sourceId, 'o' => $origin]);
}

function avesmapsGaretienQuellenAbbauTestOrigin(PDO $pdo, string $entityType, string $publicId, int $sourceId): ?string
{
    $stmt = $pdo->prepare(
        'SELECT origin FROM feature_sources WHERE entity_type = :t AND entity_public_id = :p AND source_id = :s'
    );
    $stmt->execute(['t' => $entityType, 'p' => $publicId, 's' => $sourceId]);
    $wert = $stmt->fetchColumn();

    return $wert === false ? null : (string) $wert;
}

// --- Aufbau: drei vom Fehlimport betroffene Objekte, DREI verschont gebliebene Verknuepfungen an
// ZWEI von ihnen (dieselbe Objekt-Identitaet, andere Herkunft), plus ein voellig unbeteiligtes
// Objekt. Absichtlich ueber DREI entity_type gestreut (settlement/region/path) -- die Loeschung
// darf sich an keinem einzelnen ID-Raum festhalten (AGENTS.md: "verlass dich beim Loeschen NICHT
// auf eine Objektliste und nicht auf einen bestimmten ID-Raum").
$pdo = avesmapsGaretienQuellenAbbauTestPdo();

$quelleA = avesmapsGaretienQuellenAbbauTestQuelle($pdo, 'https://www.garetien.de/fluss-a');
$quelleB = avesmapsGaretienQuellenAbbauTestQuelle($pdo, 'https://www.garetien.de/wald-b');
$quelleC = avesmapsGaretienQuellenAbbauTestQuelle($pdo, 'https://www.koschwiki.de/ort-c');
$quelleF = avesmapsGaretienQuellenAbbauTestQuelle($pdo, 'https://de.wiki-aventurica.de/manuell-f');
$quelleG = avesmapsGaretienQuellenAbbauTestQuelle($pdo, 'https://de.wiki-aventurica.de/wiki-g');
$quelleD = avesmapsGaretienQuellenAbbauTestQuelle($pdo, 'https://de.wiki-aventurica.de/unbeteiligt-d');

// Drei Fehlimport-Verknuepfungen -- der eigentliche Schaden.
avesmapsGaretienQuellenAbbauTestLink($pdo, 'settlement', 'loc-1', $quelleA, 'garetien');
avesmapsGaretienQuellenAbbauTestLink($pdo, 'region', 'reg-2', $quelleB, 'garetien');
avesmapsGaretienQuellenAbbauTestLink($pdo, 'path', 'path-3', $quelleC, 'garetien');
// Zwei davon tragen an DEMSELBEN Objekt zusaetzlich eine Verknuepfung anderer Herkunft --
// die miss-die-Differenz-Zusicherung.
avesmapsGaretienQuellenAbbauTestLink($pdo, 'settlement', 'loc-1', $quelleF, 'manual');
avesmapsGaretienQuellenAbbauTestLink($pdo, 'region', 'reg-2', $quelleG, 'wiki_publication');
// Ein voellig unbeteiligtes Objekt, nie vom Import beruehrt.
avesmapsGaretienQuellenAbbauTestLink($pdo, 'region', 'reg-4', $quelleD, 'manual');

$featureSourcesVorher = (int) $pdo->query('SELECT COUNT(*) FROM feature_sources')->fetchColumn();
$sourcesVorher = (int) $pdo->query('SELECT COUNT(*) FROM sources')->fetchColumn();
assert($featureSourcesVorher === 6, '6 Verknuepfungen im Aufbau, ' . $featureSourcesVorher . ' gezaehlt');
assert($sourcesVorher === 6, '6 Katalogeintraege im Aufbau, ' . $sourcesVorher . ' gezaehlt');
$pruefungen += 2;

// --- 1) Zaehlen VOR jeder Loeschung -- die Zahl, die die Rueckfrage im Fenster traegt.
$zaehlung = avesmapsGaretienQuellenAbbauZaehlen($pdo);
assert($zaehlung['verknuepfungen'] === 3, '3 Fehlimport-Verknuepfungen gezaehlt, ' . $zaehlung['verknuepfungen']);
assert($zaehlung['objekte'] === 3, '3 betroffene Objekte gezaehlt, ' . $zaehlung['objekte']);
// ⚠️ Reihenfolgeunabhaengig verglichen (ksort auf beiden Seiten): GROUP BY gibt keine
// zugesicherte Reihenfolge, und PHPs `===` auf Arrays vergleicht auch die Reihenfolge.
$erwarteteNachTyp = ['settlement' => 1, 'region' => 1, 'path' => 1];
$gemesseneNachTyp = $zaehlung['nach_typ'];
ksort($erwarteteNachTyp);
ksort($gemesseneNachTyp);
assert($gemesseneNachTyp === $erwarteteNachTyp,
    'Aufschluesselung nach entity_type stimmt: ' . json_encode($zaehlung['nach_typ']));
$pruefungen += 3;

// --- 2) Zaehlen ist REIN LESEND -- "ohne Bestaetigung passiert nichts" gilt auch am Zaehl-Schritt
// selbst: er darf keine einzige Zeile anfassen.
$nachZaehlung = (int) $pdo->query('SELECT COUNT(*) FROM feature_sources')->fetchColumn();
assert($nachZaehlung === $featureSourcesVorher, 'Zaehlen hat nichts veraendert: ' . $nachZaehlung);
$pruefungen++;

// --- 3) Loeschen -- die Zaehlung von vorher MUSS mit der Zahl der wirklich geloeschten
// uebereinstimmen (die Zusicherung aus dem Auftrag: "die Zaehlung ... stimmt mit der Zahl der
// wirklich geloeschten ueberein").
$ergebnis = avesmapsGaretienQuellenAbbauAusfuehren($pdo);
assert($ergebnis['entfernt'] === $zaehlung['verknuepfungen'],
    'entfernt (' . $ergebnis['entfernt'] . ') === vorher gezaehlt (' . $zaehlung['verknuepfungen'] . ')');
$pruefungen++;

// --- 4) Die drei Fehlimport-Zeilen sind weg -- gezielt geprueft, nicht nur an der Gesamtzahl.
assert(avesmapsGaretienQuellenAbbauTestOrigin($pdo, 'settlement', 'loc-1', $quelleA) === null,
    'settlement/loc-1 <- Quelle A (garetien) ist weg');
assert(avesmapsGaretienQuellenAbbauTestOrigin($pdo, 'region', 'reg-2', $quelleB) === null,
    'region/reg-2 <- Quelle B (garetien) ist weg');
assert(avesmapsGaretienQuellenAbbauTestOrigin($pdo, 'path', 'path-3', $quelleC) === null,
    'path/path-3 <- Quelle C (garetien) ist weg');
$pruefungen += 3;

// --- 5) Miss die DIFFERENZ: die andersherkuenftigen Verknuepfungen an DENSELBEN Objekten
// ueberleben unveraendert -- das ist der Fall, den ein bloßes "weniger Zeilen" nicht sieht.
assert(avesmapsGaretienQuellenAbbauTestOrigin($pdo, 'settlement', 'loc-1', $quelleF) === 'manual',
    'settlement/loc-1 <- Quelle F (manual) bleibt');
assert(avesmapsGaretienQuellenAbbauTestOrigin($pdo, 'region', 'reg-2', $quelleG) === 'wiki_publication',
    'region/reg-2 <- Quelle G (wiki_publication) bleibt');
assert(avesmapsGaretienQuellenAbbauTestOrigin($pdo, 'region', 'reg-4', $quelleD) === 'manual',
    'region/reg-4 <- Quelle D (unbeteiligt) bleibt');
$pruefungen += 3;

$featureSourcesNachher = (int) $pdo->query('SELECT COUNT(*) FROM feature_sources')->fetchColumn();
assert($featureSourcesNachher === 3, 'genau 3 Verknuepfungen bleiben stehen, ' . $featureSourcesNachher);
$pruefungen++;

// --- 6) Die sources-Zeilen selbst bleiben bestehen -- AUCH die drei, auf die jetzt niemand mehr
// zeigt (A, B, C). "Nur die Verknuepfungen, niemals die sources-Zeilen selbst" ist die wichtigste
// Regel des Auftrags; ein Test, der nur feature_sources zaehlt, wuerde eine geloeschte
// Katalogzeile nicht bemerken.
$sourcesNachher = (int) $pdo->query('SELECT COUNT(*) FROM sources')->fetchColumn();
assert($sourcesNachher === $sourcesVorher, 'kein Katalogeintrag verschwunden: ' . $sourcesNachher);
foreach (['A' => $quelleA, 'B' => $quelleB, 'C' => $quelleC, 'F' => $quelleF, 'G' => $quelleG, 'D' => $quelleD] as $name => $id) {
    $existiert = (int) $pdo->query('SELECT COUNT(*) FROM sources WHERE id = ' . (int) $id)->fetchColumn() === 1;
    assert($existiert, 'Quelle ' . $name . ' (id ' . $id . ') steht weiter im Katalog -- auch verwaist');
    $pruefungen++;
}
$pruefungen++;

// --- 7) Zaehlung danach ist Null -- nichts Fehlimportiertes bleibt uebrig.
$zaehlungDanach = avesmapsGaretienQuellenAbbauZaehlen($pdo);
assert($zaehlungDanach['verknuepfungen'] === 0, 'nach der Bereinigung: 0 Verknuepfungen');
assert($zaehlungDanach['objekte'] === 0, 'nach der Bereinigung: 0 Objekte');
assert($zaehlungDanach['nach_typ'] === [], 'nach der Bereinigung: keine Aufschluesselung mehr');
$pruefungen += 3;

// --- 8) IDEMPOTENT: ein zweiter Lauf loescht nichts mehr und wirft nicht.
$zweiterLauf = avesmapsGaretienQuellenAbbauAusfuehren($pdo);
assert($zweiterLauf['entfernt'] === 0, 'ein zweiter Lauf entfernt nichts mehr: ' . $zweiterLauf['entfernt']);
$pruefungen++;

// --- 9) map_revision wurde GENAU EINMAL angestossen (beim wirklichen Loeschen), nicht beim
// wirkungslosen zweiten Lauf und nicht beim blossen Zaehlen.
$revision = (int) $pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn();
assert($revision === 42, 'map_revision genau einmal erhoeht (41 -> 42), gemessen ' . $revision);
$pruefungen++;

echo "OK: {$pruefungen} Pruefungen\n";
