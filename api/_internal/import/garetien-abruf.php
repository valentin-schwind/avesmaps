<?php

declare(strict_types=1);

// Abruf und Staging der Avesmaps-Exportseiten von garetien.de und koschwiki.de.
// Entwurf: docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md §5.1
//
// 🔴 ZWEI GLEICHWERTIGE EINGAENGE (Owner 26.08.2026: "im Zweifelsfall lad ich die sachen von
// meinem PC zu dir hoch"):
//   1. Der Server holt selbst -- avesmapsGaretienHoleSeite() -> avesmapsGaretienStageSeite()
//   2. Eine Datei wird hochgeladen -- der Endpunkt reicht das HTML direkt weiter
// ⭐ Das kostet fast nichts, weil avesmapsGaretienStageSeite() HTML ENTGEGENNIMMT und nicht
// selbst abruft. Genau so ist es geschnitten, damit der Test ohne Netz laeuft; der zweite
// Eingang ist dieselbe Funktion mit einer anderen Quelle davor.
//
// ⚠️ Damit ist die STRATO-Frage kein Blocker, sondern eine Bequemlichkeit: kommt der Server
// nicht an garetien.de heran, wird hochgeladen. Alles ab dem Abgleich liest aus dem Staging
// und weiss nicht, wie die Zeilen dorthin kamen.

require_once __DIR__ . '/garetien-parser.php';

// Die 18 Exportseiten, die Volker am 26.08.2026 angelegt hat.
const AVESMAPS_GARETIEN_BASIS_GGP   = 'https://www.garetien.de/index.php?title=Benutzer:VolkoV/MapSVG/Avesmaps_';
const AVESMAPS_GARETIEN_BASIS_KOSCH = 'https://www.koschwiki.de/index.php?title=Benutzer:VolkoV/MapSVG/Avesmaps_';

const AVESMAPS_GARETIEN_EBENEN = [
    ['wiki' => 'ggp',   'ebene' => 'Gewaesser',     'url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Gewaesser'],
    ['wiki' => 'ggp',   'ebene' => 'Berge',         'url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Berge'],
    ['wiki' => 'ggp',   'ebene' => 'Grenzen',       'url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Grenzen'],
    ['wiki' => 'ggp',   'ebene' => 'Sonstiges',     'url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Sonstiges'],
    ['wiki' => 'ggp',   'ebene' => 'Waelder',       'url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Waelder'],
    ['wiki' => 'ggp',   'ebene' => 'Wege',          'url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Wege'],
    ['wiki' => 'ggp',   'ebene' => 'Ortschaften_1', 'url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Ortschaften_1'],
    ['wiki' => 'ggp',   'ebene' => 'Ortschaften_2', 'url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Ortschaften_2'],
    ['wiki' => 'ggp',   'ebene' => 'Ortschaften_3', 'url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Ortschaften_3'],
    ['wiki' => 'ggp',   'ebene' => 'Ortschaften_4', 'url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Ortschaften_4'],
    ['wiki' => 'ggp',   'ebene' => 'Detail_1',      'url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Detail_1'],
    ['wiki' => 'ggp',   'ebene' => 'Detail_2',      'url' => AVESMAPS_GARETIEN_BASIS_GGP . 'Detail_2'],
    ['wiki' => 'kosch', 'ebene' => 'Gewaesser',     'url' => AVESMAPS_GARETIEN_BASIS_KOSCH . 'Gewaesser'],
    ['wiki' => 'kosch', 'ebene' => 'Berge',         'url' => AVESMAPS_GARETIEN_BASIS_KOSCH . 'Berge'],
    ['wiki' => 'kosch', 'ebene' => 'Grenzen',       'url' => AVESMAPS_GARETIEN_BASIS_KOSCH . 'Grenzen'],
    ['wiki' => 'kosch', 'ebene' => 'Waelder',       'url' => AVESMAPS_GARETIEN_BASIS_KOSCH . 'Waelder'],
    ['wiki' => 'kosch', 'ebene' => 'Wege',          'url' => AVESMAPS_GARETIEN_BASIS_KOSCH . 'Wege'],
    ['wiki' => 'kosch', 'ebene' => 'Ortschaften_1', 'url' => AVESMAPS_GARETIEN_BASIS_KOSCH . 'Ortschaften_1'],
];

const AVESMAPS_GARETIEN_USER_AGENT = 'Avesmaps-Import/1.0 (+https://avesmaps.de)';
const AVESMAPS_GARETIEN_TIMEOUT_SECONDS = 60;
const AVESMAPS_GARETIEN_CONNECT_TIMEOUT_SECONDS = 15;

// 💣 Die Hoeflichkeitspause steht IM ABRUFER, nicht in der Schleife des Aufrufers. Es ist ein
// fremder Server, wir haben dort um Erlaubnis gefragt, und eine Pause, die in der Schleife
// steht, ueberspringt jeder zweite Erzeuger -- die Probe, ein Wiederholversuch, ein spaeterer
// Einzelabruf. Dieselbe Lehre wie bei der Wiki-Drossel, die genau deshalb aus `sync.php`
// herausgeloest wurde: eine Regel, die nur ein Teil der Erzeuger aufrufen KANN, ist keine.
// ⚠️ NICHT die Wiki-Drossel (`_internal/wiki/drossel.php`) -- die gehoert dem Wiki Aventurica
// und dessen Sperre; garetien.de ist ein anderer Wirt und teilt diese Warteschlange nicht.
const AVESMAPS_GARETIEN_PAUSE_MIKROSEKUNDEN = 1000000;

/** Wann zuletzt bei diesem Wirt abgerufen wurde -- je Prozess, mehr braucht es hier nicht. */
function &avesmapsGaretienLetzterAbruf(): array
{
    static $letzte = [];

    return $letzte;
}

/** Die Tabellen. Selbstheilend wie im Haus ueblich (AGENTS.md §5). */
function avesmapsGaretienEnsureTables(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS garetien_import_run ('
        . ' id INT AUTO_INCREMENT PRIMARY KEY,'
        . ' started_at DATETIME NOT NULL,'
        . ' finished_at DATETIME NULL,'
        . ' status VARCHAR(20) NOT NULL DEFAULT ' . "'running'" . ','
        . ' note TEXT NULL'
        . ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );
    // 💣 `geo` und `roh` sind MEDIUMTEXT, nicht VARCHAR. Die laengste Geometriezeile der
    // Gewaesserseite hat 4885 Zeichen (gemessen 26.08.2026), die laengste Grenzzeile mehr.
    // Eine stille MySQL-Kuerzung ist von "nichts gespeichert" nicht zu unterscheiden -- genau
    // die Falle, die `app_setting.setting_value` gekostet hat (AGENTS.md §10).
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS garetien_import_row ('
        . ' id INT AUTO_INCREMENT PRIMARY KEY,'
        . ' run_id INT NOT NULL,'
        . ' wiki VARCHAR(10) NOT NULL,'
        . ' ebene VARCHAR(40) NOT NULL,'
        . ' zeile_nr INT NOT NULL,'
        . ' typ VARCHAR(40) NOT NULL,'
        . ' namensraum VARCHAR(80) NOT NULL DEFAULT ' . "''" . ','
        . ' artikel VARCHAR(190) NOT NULL DEFAULT ' . "''" . ','
        . ' anzeige VARCHAR(190) NOT NULL DEFAULT ' . "''" . ','
        . ' lodmin VARCHAR(5) NOT NULL DEFAULT ' . "''" . ','
        . ' lodmax VARCHAR(5) NOT NULL DEFAULT ' . "''" . ','
        . ' extra VARCHAR(190) NOT NULL DEFAULT ' . "''" . ','
        . ' geo_art VARCHAR(12) NOT NULL,'
        . ' geo MEDIUMTEXT NOT NULL,'
        . ' roh MEDIUMTEXT NOT NULL,'
        . ' KEY (run_id, ebene),'
        . ' KEY (run_id, artikel)'
        . ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );
    avesmapsGaretienEnsureUrteilSpalten($pdo);
}

/**
 * Die Urteilsspalten selbstheilend nachziehen (27.08.2026, Aufgabe 6; `abschnitte_json` 28.08.2026,
 * Aufgabe 13b).
 *
 * 💣 Die Spalten kamen SPAETER dazu, und `CREATE TABLE IF NOT EXISTS` legt an einer
 * bestehenden Tabelle keine Spalte nach. Live steht `garetien_import_row` bereits, also muss der
 * Nachzug ein ALTER sein.
 * ⚠️ Kein information_schema-Test davor: genau diese Sonde auf einem haeufigen Pfad ist die
 * Last, vor der AGENTS.md §10 warnt. Der Duplikat-Fehler ist die Antwort "gibt es schon", und
 * die kostet einen Round-Trip statt einer Katalogabfrage.
 *
 * 🔴 RULING P1 (Auftraggeber, 27.08.2026): eine EIGENE Funktion, nicht im Rumpf von
 * `avesmapsGaretienEnsureTables` -- die ist MySQL-only (sie wirft unter SQLite an
 * `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`). Der `ALTER TABLE ... ADD COLUMN ... DEFAULT ''`
 * hier ist dagegen PORTABEL und laesst sich dadurch als eigene Funktion wirklich gegen SQLite
 * fahren und pruefen -- das waere unter `avesmapsGaretienEnsureTables` selbst nie moeglich
 * gewesen.
 */
function avesmapsGaretienEnsureUrteilSpalten(PDO $pdo): void
{
    foreach ([
        "ALTER TABLE garetien_import_row ADD COLUMN urteil VARCHAR(20) NOT NULL DEFAULT ''",
        "ALTER TABLE garetien_import_row ADD COLUMN grund VARCHAR(300) NOT NULL DEFAULT ''",
        // 💣 MEDIUMTEXT, NIE VARCHAR. Hier steht die ganze Trefferliste des Abgleichs samt
        // Geometrie -- 13 Abschnitte zu bis zu 64 Stuetzpunkten sprengen 255 Zeichen muehelos.
        // Eine stille MySQL-Kuerzung ist von "nichts wurde je gespeichert" NICHT zu unterscheiden
        // (AGENTS.md §10: `app_setting.setting_value` war aus genau diesem Grund vier Monate lang
        // wirkungslos), und ein mitten im Zeichen abgeschnittenes JSON ist kein JSON mehr --
        // `json_decode` gaebe `null` zurueck, und der Leseweg saehe aus wie "kein Treffer".
        // 🔴 NULL erlaubt: "diese Zeile wurde vor dem Nachzug gerechnet" ist eine eigene Auskunft
        // und darf nicht wie "der Abgleich fand nichts" aussehen.
        'ALTER TABLE garetien_import_row ADD COLUMN abschnitte_json MEDIUMTEXT NULL',
    ] as $sql) {
        try {
            $pdo->exec($sql);
        } catch (PDOException) {
            // Spalte steht schon -- der Normalfall ab dem zweiten Aufruf.
        }
    }
}

/** Einen neuen Lauf beginnen. Laeufe stehen nebeneinander, keiner ueberschreibt den anderen. */
function avesmapsGaretienStartRun(PDO $pdo): int
{
    $stmt = $pdo->prepare(
        'INSERT INTO garetien_import_run (started_at, status) VALUES (:jetzt, ' . "'running'" . ')'
    );
    $stmt->execute([':jetzt' => gmdate('Y-m-d H:i:s')]);

    return (int) $pdo->lastInsertId();
}

/** Einen Lauf schliessen. */
function avesmapsGaretienFinishRun(PDO $pdo, int $runId, string $status, ?string $note = null): void
{
    $stmt = $pdo->prepare(
        'UPDATE garetien_import_run SET finished_at = :jetzt, status = :status, note = :note WHERE id = :id'
    );
    $stmt->execute([
        ':jetzt' => gmdate('Y-m-d H:i:s'),
        ':status' => $status,
        ':note' => $note,
        ':id' => $runId,
    ]);
}

/**
 * Die letzten Laeufe, mit Zeilenzahl. Fuer den Endpunkt-Zweig `runs`.
 *
 * 🔴 DIESE FUNKTION IST DER GRUND, WARUM DER ENDPUNKT DIE TABELLENNAMEN NIE NENNEN MUSS --
 * `garetien_import_run`/`garetien_import_row` duerfen nur innerhalb von `api/_internal/import/`
 * vorkommen (Auftrag §5.5, Waechter `garetien-abbau-waechter-test.php`). Ein rohes SELECT direkt
 * im Endpunkt waere genau die Verdrahtung, die den Abbau spaeter Waisen zuruecklassen liesse.
 */
function avesmapsGaretienListeLaeufe(PDO $pdo, int $limit = 20): array
{
    $stmt = $pdo->prepare(
        'SELECT r.id, r.started_at, r.finished_at, r.status, r.note, COUNT(z.id) AS zeilen'
        . ' FROM garetien_import_run r LEFT JOIN garetien_import_row z ON z.run_id = r.id'
        . ' GROUP BY r.id, r.started_at, r.finished_at, r.status, r.note'
        . ' ORDER BY r.id DESC LIMIT ' . max(1, $limit)
    );
    $stmt->execute();

    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

/**
 * Eine Seite ins Staging legen. Nimmt HTML entgegen und ruft NICHT selbst ab -- das ist der
 * Schnitt, an dem die zwei Eingaenge zusammenlaufen. Gibt die Zahl gestagter Zeilen zurueck.
 */
function avesmapsGaretienStageSeite(PDO $pdo, int $runId, string $wiki, string $ebene, string $html): int
{
    $zeilen = explode("\n", avesmapsGaretienSeitentext($html));
    $stmt = $pdo->prepare(
        'INSERT INTO garetien_import_row'
        . ' (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige, lodmin, lodmax, extra, geo_art, geo, roh)'
        . ' VALUES (:run_id, :wiki, :ebene, :zeile_nr, :typ, :namensraum, :artikel, :anzeige, :lodmin, :lodmax, :extra, :geo_art, :geo, :roh)'
    );

    $nr = 0;
    foreach ($zeilen as $zeile) {
        $eintrag = avesmapsGaretienParseZeile($zeile);
        if ($eintrag === null) {
            continue;
        }
        $nr++;
        $stmt->execute([
            ':run_id' => $runId,
            ':wiki' => $wiki,
            ':ebene' => $ebene,
            ':zeile_nr' => $nr,
            ':typ' => $eintrag['typ'],
            ':namensraum' => $eintrag['namensraum'],
            ':artikel' => $eintrag['artikel'],
            ':anzeige' => $eintrag['anzeige'],
            ':lodmin' => $eintrag['lodmin'],
            ':lodmax' => $eintrag['lodmax'],
            ':extra' => $eintrag['extra'],
            ':geo_art' => $eintrag['geo_art'],
            ':geo' => $eintrag['geo'],
            ':roh' => $eintrag['roh'],
        ]);
    }

    return $nr;
}

/**
 * Eine Exportseite abrufen. Wirft bei allem, was kein HTTP 200 mit Rumpf ist.
 *
 * 🔴 Der Fehlerfall WIRFT und liefert nie einen leeren String: eine leere Seite wuerde
 * `avesmapsGaretienStageSeite()` klaglos mit null Zeilen durchlaufen, und ein Lauf mit null
 * Zeilen sieht genauso aus wie "die Seite ist leer" -- die Verwechslung, die im Haus schon
 * einmal einen Endpunkt `ok:true` mit leerem Inhalt antworten liess.
 */
function avesmapsGaretienHoleSeite(string $url): string
{
    $wirt = strtolower((string) parse_url($url, PHP_URL_HOST));
    $schema = strtolower((string) parse_url($url, PHP_URL_SCHEME));
    if ($wirt === '' || ($schema !== 'http' && $schema !== 'https')) {
        throw new RuntimeException('Keine abrufbare Adresse: ' . $url);
    }

    $letzte = &avesmapsGaretienLetzterAbruf();
    if (isset($letzte[$wirt])) {
        $seither = (int) ((microtime(true) - $letzte[$wirt]) * 1000000);
        if ($seither < AVESMAPS_GARETIEN_PAUSE_MIKROSEKUNDEN) {
            usleep(AVESMAPS_GARETIEN_PAUSE_MIKROSEKUNDEN - $seither);
        }
    }
    $letzte[$wirt] = microtime(true);

    $ch = curl_init($url);
    if ($ch === false) {
        throw new RuntimeException('curl konnte nicht gestartet werden.');
    }
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_TIMEOUT => AVESMAPS_GARETIEN_TIMEOUT_SECONDS,
        CURLOPT_CONNECTTIMEOUT => AVESMAPS_GARETIEN_CONNECT_TIMEOUT_SECONDS,
        CURLOPT_USERAGENT => AVESMAPS_GARETIEN_USER_AGENT,
        CURLOPT_ACCEPT_ENCODING => '',
    ]);
    $rumpf = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $fehler = (string) curl_error($ch);
    curl_close($ch);

    if (!is_string($rumpf) || $rumpf === '') {
        throw new RuntimeException('Abruf ohne Rumpf (HTTP ' . $status . '): ' . ($fehler !== '' ? $fehler : $url));
    }
    if ($status !== 200) {
        throw new RuntimeException('HTTP ' . $status . ' bei ' . $url);
    }

    return $rumpf;
}

/**
 * EINE Probe: kommt DIESER Server ueberhaupt an die Quelle heran?
 *
 * ⚠️ Sie ruft GENAU EINE Seite ab, nie 18 (Bauplan Aufgabe 3 Schritt 5). Wiki Aventurica
 * sperrt unsere STRATO-Ausgangs-IP (81.169.144.135); ob garetien.de das auch tut, ist
 * ungemessen -- und genau das ist die Frage, die diese Funktion beantwortet.
 *
 * 🔴 Sie schreibt in KEINE Tabelle. Eine Probe, die staget, ist keine Probe: sie liesse einen
 * halben Lauf zurueck, den danach niemand von einem echten unterscheiden kann.
 */
function avesmapsGaretienProbe(string $url): array
{
    $start = microtime(true);
    try {
        $html = avesmapsGaretienHoleSeite($url);
    } catch (Throwable $fehler) {
        return [
            'ok' => false,
            'url' => $url,
            'dauer_ms' => (int) round((microtime(true) - $start) * 1000),
            'grund' => $fehler->getMessage(),
        ];
    }

    $daten = 0;
    foreach (explode("\n", avesmapsGaretienSeitentext($html)) as $zeile) {
        if (avesmapsGaretienParseZeile($zeile) !== null) {
            $daten++;
        }
    }

    return [
        'ok' => true,
        'url' => $url,
        'dauer_ms' => (int) round((microtime(true) - $start) * 1000),
        'bytes' => strlen($html),
        'datenzeilen' => $daten,
    ];
}
