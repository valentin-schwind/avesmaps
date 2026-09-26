<?php

declare(strict_types=1);

/**
 * Innerorts-Objekte, die WIR gespeichert haben.
 * ===========================================================================
 * Ein Objekt, das in einer Stadt liegt, hat keine Weltkarten-Position und steht deshalb NICHT in
 * `map_features` -- dort ist die Geometrie Pflicht, und alles darunter zeichnet sie. Bis zum
 * 02.09.2026 gab es solche Objekte nur als ABLEITUNG aus der Wiki-Aventurica-Registry
 * (`avesmapsFetchInSettlementSearchRows`, drei Quellen); gespeichert wurde nichts.
 *
 * 🔴 DIESE TABELLE GEHOERT NICHT DEM IMPORTER. Sie ist der allgemeine Platz fuer „Objekt ohne
 * Kartenposition, gehoert zu Stadt X"; der Garetien-Import war ihr erster Schreiber und trug das
 * in `origin` -- seit dem Rueckbau (26.09.2026) hat sie keinen; ein Bearbeitungsweg ist offen.
 *
 * 💣 DIE BINDUNG IST DIE public_id DES ORTES, NICHT SEIN NAME. Die abgeleiteten Zeilen tragen den
 * Stadt-NAMEN, weil es im Wiki keine id gibt, und der Browser faltet Namen aufeinander
 * (avesmapsStaettenSchluessel). Ein GESPEICHERTES Objekt darf sich darauf nicht verlassen: eine
 * umbenannte Stadt verloere sonst alle ihre Staetten, lautlos. Der Name reist trotzdem mit -- er
 * ist die Anzeige und der Schluessel, unter dem der bestehende Index sie einsortiert.
 *
 * 🔴 `is_active = 0` STATT `DELETE`, wie ueberall im Haus: eine Ruecknahme muss umkehrbar sein.
 */

// Fuer AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES (Dorf...Metropole) -- rein (Konstanten +
// Funktionen ohne Seiteneffekte), per require_once ueberall im Haus geladen (git grep
// "place-scope.php" -- keine blanke require, kein doppeltes Laden moeglich).
require_once __DIR__ . '/../wiki/place-scope.php';

/**
 * Karteneinheiten, innerhalb derer ein gleichnamiger Kartenpunkt als „Namensnachbar" gilt --
 * die Regel „Kartenpunkt schlaegt Innerorts" braucht das, um eine Staette vor einer NAMENSGLEICHEN
 * aber andernorts liegenden Karte zu schuetzen (AGENTS.md, Coordinate convention: 1 Karteneinheit
 * = 3 Meilen, hier also 15 Meilen).
 */
const AVESMAPS_STAETTEN_NAMENSNACHBAR_RADIUS = 5.0;

// ⚠️ `avesmapsUuidV4` wohnt in api/_internal/map/features.php -- es gibt keine eigene
// uuid.php. Kein `require` hier: diese Datei wird aus Pfaden geladen, die features.php
// ohnehin schon haben (der Kartenendpunkt und die Uebernahme), und ein `require` auf die
// grosse Datei aus einem reinen Lesepfad waere teurer als die Abhaengigkeit wert ist.
// 💣 Die Schreibfunktion prueft es deshalb selbst, statt beim ersten Aufruf zu sterben.

/**
 * Die Tabelle sicherstellen. Selbstheilend wie der Rest des Hauses (AGENTS.md §5).
 *
 * ⚠️ NICHT im heissen Lesepfad rufen. `avesmapsSettlementPlaceRows` faellt bei fehlender Tabelle
 * still auf eine leere Liste zurueck; das DDL gehoert in den SCHREIBweg (AGENTS.md §10,
 * Pool-Vorfall 17.07.2026).
 */
function avesmapsSettlementPlaceEnsureSchema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS settlement_place (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            public_id CHAR(36) NOT NULL,
            name VARCHAR(190) NOT NULL,
            place_type VARCHAR(80) NULL,
            settlement_public_id VARCHAR(64) NOT NULL,
            settlement_name VARCHAR(190) NOT NULL,
            wiki_url VARCHAR(500) NULL,
            origin VARCHAR(20) NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_by INT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_settlement_place (settlement_public_id, name),
            KEY idx_settlement (settlement_public_id, is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );
}

/**
 * Eine Staette anlegen -- oder eine zurueckgenommene wiederbeleben.
 *
 * 💣 KEIN `INSERT ... ON DUPLICATE KEY`: die Syntax ist in MySQL und SQLite verschieden
 * (`ON DUPLICATE KEY` / `ON CONFLICT`), und ein Test gegen SQLite saehe die MySQL-Regression nicht
 * (AGENTS.md §9, Fehler 1093). Stattdessen gelesen, dann geschrieben -- portabel und hier
 * bezahlbar: es ist ein Editor-Klick, kein Massenlauf.
 *
 * ⚠️ Eine bestehende Zeile wird WIEDERBELEBT, nicht verdoppelt. Der UNIQUE-Schluessel ist
 * (settlement_public_id, name), und eine zurueckgenommene Staette traegt `is_active = 0` --
 * derselbe Name in derselben Stadt ist dieselbe Staette.
 *
 * @return string die public_id
 */
function avesmapsSettlementPlaceAdd(PDO $pdo, array $daten, int $userId): string
{
    avesmapsSettlementPlaceEnsureSchema($pdo);

    $name = trim((string) ($daten['name'] ?? ''));
    $ortId = trim((string) ($daten['settlement_public_id'] ?? ''));
    if ($name === '' || $ortId === '') {
        throw new RuntimeException('Eine Staette braucht einen Namen und einen Ort.');
    }

    $vorhanden = $pdo->prepare(
        'SELECT public_id FROM settlement_place
          WHERE settlement_public_id = :ort AND name = :name'
    );
    $vorhanden->execute(['ort' => $ortId, 'name' => $name]);
    $publicId = trim((string) ($vorhanden->fetchColumn() ?: ''));

    if ($publicId !== '') {
        $pdo->prepare(
            'UPDATE settlement_place
                SET is_active = 1, place_type = :typ, settlement_name = :ortname,
                    wiki_url = :wiki, origin = :origin
              WHERE public_id = :pid'
        )->execute([
            'typ' => ($daten['place_type'] ?? '') !== '' ? (string) $daten['place_type'] : null,
            'ortname' => (string) ($daten['settlement_name'] ?? ''),
            'wiki' => ($daten['wiki_url'] ?? '') !== '' ? (string) $daten['wiki_url'] : null,
            'origin' => (string) ($daten['origin'] ?? 'manual'),
            'pid' => $publicId,
        ]);

        return $publicId;
    }

    if (!function_exists('avesmapsUuidV4')) {
        // 🔴 LAUT, nicht still: ohne die Funktion entstuende eine Staette ohne id, und
        // die faende danach niemand wieder.
        throw new RuntimeException('avesmapsUuidV4 fehlt -- api/_internal/map/features.php'
            . ' muss vor dieser Datei geladen sein.');
    }
    $publicId = avesmapsUuidV4();
    $pdo->prepare(
        'INSERT INTO settlement_place
            (public_id, name, place_type, settlement_public_id, settlement_name, wiki_url,
             origin, is_active, created_by)
         VALUES (:pid, :name, :typ, :ort, :ortname, :wiki, :origin, 1, :user)'
    )->execute([
        'pid' => $publicId,
        'name' => $name,
        'typ' => ($daten['place_type'] ?? '') !== '' ? (string) $daten['place_type'] : null,
        'ort' => $ortId,
        'ortname' => (string) ($daten['settlement_name'] ?? ''),
        'wiki' => ($daten['wiki_url'] ?? '') !== '' ? (string) $daten['wiki_url'] : null,
        'origin' => (string) ($daten['origin'] ?? 'manual'),
        'user' => $userId > 0 ? $userId : null,
    ]);

    return $publicId;
}

/**
 * Gibt es zu dieser public_id eine Staette -- gleich ob aktiv oder zurueckgenommen?
 *
 * 💣 DAS IST DIE FRAGE „IN WELCHER TABELLE LIEGT DIESES OBJEKT?", und sie muss vor jedem Loeschweg
 * stehen. Der Import vermerkt beim Uebernehmen nur die angelegte public_id; ob daraus ein
 * Kartenobjekt oder eine Staette wurde, steht nirgends. Nachzusehen ist billiger und ehrlicher als
 * ein zweiter Zustand daneben, der auseinanderlaufen kann.
 *
 * ⚠️ AUCH DIE ZURUECKGENOMMENE ZAEHLT. Sonst faellt eine zweite Ruecknahme in den Kartenpfad und
 * scheitert dort mit „Objekt nicht gefunden" -- eine Fehlermeldung fuer etwas, das laengst getan ist.
 */
function avesmapsSettlementPlaceExists(PDO $pdo, string $publicId): bool
{
    $publicId = trim($publicId);
    if ($publicId === '') {
        return false;
    }
    try {
        $statement = $pdo->prepare('SELECT 1 FROM settlement_place WHERE public_id = :pid LIMIT 1');
        $statement->execute(['pid' => $publicId]);

        return $statement->fetchColumn() !== false;
    } catch (PDOException) {
        // Ohne Tabelle gibt es keine Staetten -- und der Aufrufer nimmt seinen bisherigen Weg.
        return false;
    }
}

/**
 * Eine Staette zuruecknehmen -- weich, wie ueberall im Haus.
 *
 * @return bool ob wirklich eine Zeile betroffen war
 */
function avesmapsSettlementPlaceDeactivate(PDO $pdo, string $publicId, int $userId): bool
{
    $publicId = trim($publicId);
    if ($publicId === '') {
        return false;
    }
    try {
        $statement = $pdo->prepare(
            'UPDATE settlement_place SET is_active = 0, updated_at = :t WHERE public_id = :pid AND is_active = 1'
        );
        $statement->execute([
            'pid' => $publicId,
            // ⚠️ Gleiches Format wie beim Umhaengen (Y-m-d H:i:s.v, Millisekunden fuer DATETIME(3))
            // -- sonst wuerde ein Umhaengen kurz nach einem Loeschen denselben Wert schreiben und
            // die Messung "hat sich das geaendert?" liefe leer.
            't' => (new DateTimeImmutable())->format('Y-m-d H:i:s.v'),
        ]);

        return $statement->rowCount() > 0;
    } catch (PDOException) {
        // Ohne Tabelle gibt es nichts zurueckzunehmen.
        return false;
    }
}

/**
 * Die aktiven Staetten in der Form, die `in_settlement_places` traegt.
 *
 * 🔴 SIE SIND SCHON AUFGELOEST. Die drei abgeleiteten Quellen gehen durch den Scope-Klassifikator
 * (avesmapsPlaceScopeClassifyWithIndex) -- eine gespeicherte Zeile hat ihren Ort dagegen von einem
 * Menschen bekommen und braucht keine Vermutung.
 *
 * ⚠️ FAELLT STILL AUS. Fehlt die Tabelle (frische Installation), kommt eine leere Liste -- die
 * Karte darf deswegen nicht ausfallen, dieselbe Regel wie bei den drei anderen Quellen.
 *
 * @return list<array{name:string, settlement:string, type:string, wiki_url:string}>
 */
function avesmapsSettlementPlaceRows(PDO $pdo): array
{
    try {
        $rows = $pdo->query(
            'SELECT name, place_type, settlement_name, wiki_url
               FROM settlement_place WHERE is_active = 1 ORDER BY settlement_name, name'
        )->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        return [];
    }

    $raus = [];
    foreach ((array) $rows as $row) {
        $name = trim((string) ($row['name'] ?? ''));
        $ort = trim((string) ($row['settlement_name'] ?? ''));
        if ($name === '' || $ort === '') {
            continue;
        }
        $raus[] = [
            'name' => $name,
            'settlement' => $ort,
            'type' => (string) ($row['place_type'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
        ];
    }

    return $raus;
}

/**
 * Der Stempel fuer das ETag der Kartennutzlast.
 *
 * 💣 OHNE IHN SIEHT NIEMAND EINE NEUE STAETTE. Das ETag haengt an `map_revision`, und eine Zeile in
 * `settlement_place` bewegt kein Kartenobjekt -- jeder warme Browser bekaeme sein 304 samt alter
 * Nutzlast. Dieselbe Falle, die Klimazonen, Tempowerte und der Wappen-Notaus schon bezahlt haben.
 *
 * ⚠️ Ein LEERER Stempel (Lesevorgang ausgefallen) haelt den Keim zeichengleich, damit nicht die
 * halbe Welt 21 MB neu laedt, weil einmal eine Abfrage nicht durchging.
 */
function avesmapsSettlementPlaceReadStamp(PDO $pdo): string
{
    try {
        $row = $pdo->query(
            'SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), MAX(created_at)) AS t
               FROM settlement_place WHERE is_active = 1'
        )->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        return '';
    }
    if (!is_array($row)) {
        return '';
    }

    return (string) ($row['n'] ?? '0') . '|' . (string) ($row['t'] ?? '');
}

/**
 * Die Regel „Kartenpunkt schlaegt Innerorts".
 * ===========================================================================
 * Ein Wiki-Artikel, den ein Redakteur bereits als KARTENPUNKT platziert hat (properties.
 * wiki_settlement.wiki_url zeigt drauf), erscheint nicht zusaetzlich als Innerorts-Objekt seiner
 * Stadt -- weder in den drei abgeleiteten Quellen (avesmapsFetchInSettlementSearchRows) noch in
 * einer gespeicherten `settlement_place`-Zeile. Owner 26.09.2026: „Orte, die auf der Karte
 * platziert sind, sind nicht innerorts".
 *
 * 🔴 DER VERGLEICH IST DIE WIKI-ADRESSE, NIE DER NAME. Zwei Objekte koennen denselben Namen
 * tragen (eine Burg auf der Karte, eine andere gleichnamige Innerorts-Staette in einer anderen
 * Stadt) -- nur die Adresse identifiziert den EINEN Wiki-Artikel.
 */

/**
 * Der Vergleichsschluessel einer Wiki-Adresse fuer „ist dieser Artikel einem Kartenpunkt zugewiesen?".
 * Wirt ohne www., Pfad dekodiert, Leerzeichen = Unterstrich, klein. Kein mb_*: beide Seiten gehen
 * hier durch, ein nicht gefaltetes Umlaut-Grossbuchstabe trifft sich also selbst.
 */
function avesmapsInnerortsArtikelSchluessel(string $url): string
{
    $url = trim($url);
    if ($url === '') {
        return '';
    }
    $teile = parse_url($url);
    if (!is_array($teile) || empty($teile['host'])) {
        return '';
    }
    $wirt = strtolower((string) preg_replace('~^www\.~i', '', (string) $teile['host']));
    $pfad = rawurldecode((string) ($teile['path'] ?? ''));
    $abfrage = isset($teile['query']) ? '?' . rawurldecode((string) $teile['query']) : '';

    return strtolower($wirt . str_replace(' ', '_', $pfad . $abfrage));
}

/**
 * properties_json robust dekodieren -- die Spalte traegt mal schon ein Array (Tests, Aufrufer, die
 * bereits dekodiert haben), mal eine JSON-Zeichenkette (die Spalte in echt).
 *
 * @return array<string,mixed>|null null bei kaputtem JSON -- der Aufrufer entscheidet, ob das die
 *     Zeile ueberspringt oder nur ein leeres Ergebnis bedeutet.
 */
function avesmapsInnerortsPropertiesDekodieren(mixed $rohwert): ?array
{
    if (is_array($rohwert)) {
        return $rohwert;
    }
    if (!is_string($rohwert) || trim($rohwert) === '') {
        return [];
    }
    $dekodiert = json_decode($rohwert, true);
    if (!is_array($dekodiert)) {
        return null;
    }

    return $dekodiert;
}

/**
 * Die Menge der Wiki-Artikel, die schon einem KARTENPUNKT zugewiesen sind -- aus bereits
 * geladenen `map_features`-Zeilen (Array je Zeile, wie z.B. der Kartenendpunkt sie ohnehin haelt).
 *
 * @param list<array<string,mixed>> $rows
 * @return array<string,true>
 */
function avesmapsInnerortsKartenArtikelAusZeilen(array $rows): array
{
    $menge = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        if ((string) ($row['feature_type'] ?? '') !== 'location') {
            continue;
        }
        // ⚠️ FEHLT der Schluessel im Array, gilt die Zeile als aktiv -- dieselbe Regel wie bei
        // `avesmapsInnerortsKartenArtikel`s SQL-Pfad (WHERE is_active = 1), nur PHP-seitig.
        if (array_key_exists('is_active', $row) && (int) $row['is_active'] === 0) {
            continue;
        }
        $eigenschaften = avesmapsInnerortsPropertiesDekodieren($row['properties_json'] ?? null);
        if ($eigenschaften === null) {
            // Kaputtes JSON -- wird uebersprungen, nicht als Fehler behandelt.
            continue;
        }
        $wikiSettlement = is_array($eigenschaften['wiki_settlement'] ?? null) ? $eigenschaften['wiki_settlement'] : [];
        $schluessel = avesmapsInnerortsArtikelSchluessel((string) ($wikiSettlement['wiki_url'] ?? ''));
        if ($schluessel !== '') {
            $menge[$schluessel] = true;
        }
    }

    return $menge;
}

/**
 * Der Rohwert aus `JSON_EXTRACT(...)` einer Zeichenkette zu Text -- MariaDB liefert ihn
 * JSON-QUOTIERT inklusive Escapes wie `\/`, SQLite liefert ihn schon entpackt. Nur quotiert wird
 * dekodiert (das loest `\/` u.ae. sauber auf); unquotiert bleibt der Wert unveraendert.
 */
function avesmapsInnerortsJsonExtractText(string $rohwert): string
{
    $rohwert = trim($rohwert);
    if ($rohwert === '') {
        return '';
    }
    if (strlen($rohwert) >= 2 && $rohwert[0] === '"' && substr($rohwert, -1) === '"') {
        $dekodiert = json_decode($rohwert);
        if (is_string($dekodiert)) {
            return $dekodiert;
        }

        return trim($rohwert, '"');
    }

    return $rohwert;
}

/**
 * Dieselbe Menge wie `…AusZeilen`, direkt aus der Datenbank -- fuer Aufrufer, die die
 * `map_features`-Zeilen NICHT schon geladen haben (z.B. der Suchendpunkt).
 *
 * ⚠️ FAELLT OFFEN AUS: ein werfender Zugriff (Tabelle/Spalte fehlt, DB nicht erreichbar) liefert
 * `[]` -- dann zeigt die Innerorts-Liste wie bisher alles, nie WENIGER als vorher.
 *
 * @return array<string,true>
 */
function avesmapsInnerortsKartenArtikel(PDO $pdo): array
{
    try {
        $rows = $pdo->query(
            "SELECT JSON_EXTRACT(properties_json, '\$.wiki_settlement.wiki_url') AS u FROM map_features
              WHERE feature_type = 'location' AND is_active = 1 AND properties_json LIKE '%wiki_settlement%'"
        )->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }

    $menge = [];
    foreach ((array) $rows as $row) {
        $text = avesmapsInnerortsJsonExtractText((string) ($row['u'] ?? ''));
        $schluessel = avesmapsInnerortsArtikelSchluessel($text);
        if ($schluessel !== '') {
            $menge[$schluessel] = true;
        }
    }

    return $menge;
}

/**
 * Zeilen mit `wiki_url`, deren Artikel NICHT schon einem Kartenpunkt zugewiesen ist.
 *
 * 🔴 Geprueft wird ausschliesslich die Adresse -- eine namensgleiche Zeile mit einer ANDEREN
 * Adresse (oder ganz ohne Adresse) bleibt stehen.
 *
 * @param list<array{wiki_url?:string}> $zeilen
 * @param array<string,true> $kartenArtikel
 * @return list<array{wiki_url?:string}>
 */
function avesmapsInnerortsOhneKartenpunkte(array $zeilen, array $kartenArtikel): array
{
    return array_values(array_filter($zeilen, static function (array $zeile) use ($kartenArtikel): bool {
        $schluessel = avesmapsInnerortsArtikelSchluessel((string) ($zeile['wiki_url'] ?? ''));

        return $schluessel === '' || !isset($kartenArtikel[$schluessel]);
    }));
}

/**
 * Gespeicherte Staetten eines Ortes -- fuer den Editor-Endpunkt.
 *
 * ⚠️ FAELLT STILL AUS: fehlt die Tabelle, kommt eine leere Liste.
 *
 * @return list<array{public_id:string, name:string, place_type:string, wiki_url:string, origin:string}>
 */
function avesmapsSettlementPlaceListForSettlement(PDO $pdo, string $ortId): array
{
    $ortId = trim($ortId);
    if ($ortId === '') {
        return [];
    }
    try {
        $statement = $pdo->prepare(
            'SELECT public_id, name, place_type, wiki_url, origin FROM settlement_place
              WHERE settlement_public_id = :ort AND is_active = 1 ORDER BY name'
        );
        $statement->execute(['ort' => $ortId]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        return [];
    }

    $raus = [];
    foreach ((array) $rows as $row) {
        $raus[] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'place_type' => (string) ($row['place_type'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'origin' => (string) ($row['origin'] ?? ''),
        ];
    }

    return $raus;
}

/**
 * Eine einheitliche Fehler-Antwort fuer `avesmapsSettlementPlaceMove`.
 *
 * @return array{ok:false, code:string, message:string}
 */
function avesmapsSettlementPlaceMoveFehler(string $code, string $message): array
{
    return ['ok' => false, 'code' => $code, 'message' => $message];
}

/**
 * Eine Staette an einen anderen Ort haengen.
 *
 * Ablauf: Schema sicherstellen (VOR jeder Transaktion, AGENTS.md §10) -- Staette lesen (nur aktiv)
 * -- Zielpunkt lesen (nur aktive Siedlungsklassen; „gleich dem eigenen Ort" wird davor schon
 * verworfen) -- Namenskollision am Ziel pruefen -- schreiben.
 *
 * @return array{ok:true, ziel_name:string, alter_ort:string}|array{ok:false, code:string, message:string}
 */
function avesmapsSettlementPlaceMove(PDO $pdo, string $publicId, string $zielId, int $userId): array
{
    $publicId = trim($publicId);
    $zielId = trim($zielId);

    avesmapsSettlementPlaceEnsureSchema($pdo);

    if ($publicId === '') {
        return avesmapsSettlementPlaceMoveFehler('not_found', 'Die Stätte gibt es nicht (mehr).');
    }

    $staetteStmt = $pdo->prepare(
        'SELECT public_id, name, settlement_public_id FROM settlement_place
          WHERE public_id = :pid AND is_active = 1'
    );
    $staetteStmt->execute(['pid' => $publicId]);
    $staette = $staetteStmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($staette)) {
        return avesmapsSettlementPlaceMoveFehler('not_found', 'Die Stätte gibt es nicht (mehr).');
    }

    // 💣 „gleich dem eigenen Ort" wird VOR der Zielpunkt-Abfrage entschieden -- der eigene Ort ist
    // per Definition eine gueltige Siedlung, die Abfrage koennte das also nie von selbst verwerfen.
    if ($zielId === '' || $zielId === (string) $staette['settlement_public_id']) {
        return avesmapsSettlementPlaceMoveFehler('invalid_target', 'Das Ziel ist kein Ort auf der Karte.');
    }

    $platzhalter = [];
    $werte = ['ziel' => $zielId];
    foreach (AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES as $index => $subtype) {
        $schluessel = 'sub' . $index;
        $platzhalter[] = ':' . $schluessel;
        $werte[$schluessel] = $subtype;
    }
    $zielStmt = $pdo->prepare(
        "SELECT name FROM map_features WHERE public_id = :ziel AND feature_type = 'location' AND is_active = 1
          AND feature_subtype IN (" . implode(', ', $platzhalter) . ')'
    );
    $zielStmt->execute($werte);
    $zielName = $zielStmt->fetchColumn();
    if ($zielName === false) {
        // Deckt Kreuzung/gebaeude (falsche Klasse), inaktiv und unbekannt gleichermassen ab --
        // die Abfrage liefert in allen drei Faellen keine Zeile.
        return avesmapsSettlementPlaceMoveFehler('invalid_target', 'Das Ziel ist kein Ort auf der Karte.');
    }
    $zielName = (string) $zielName;
    $eigenerName = (string) $staette['name'];

    $kollisionStmt = $pdo->prepare(
        'SELECT is_active FROM settlement_place WHERE settlement_public_id = :ziel AND name = :name'
    );
    $kollisionStmt->execute(['ziel' => $zielId, 'name' => $eigenerName]);
    $kollision = $kollisionStmt->fetchColumn();
    if ($kollision !== false) {
        if ((int) $kollision === 1) {
            return avesmapsSettlementPlaceMoveFehler(
                'name_taken',
                sprintf('In %s gibt es schon eine Stätte „%s". Nichts wurde geändert.', $zielName, $eigenerName)
            );
        }

        return avesmapsSettlementPlaceMoveFehler(
            'name_taken_deleted',
            sprintf('In %s gab es schon eine gelöschte Stätte „%s". Nichts wurde geändert.', $zielName, $eigenerName)
        );
    }

    $alterOrt = (string) $staette['settlement_public_id'];
    $jetzt = (new DateTimeImmutable())->format('Y-m-d H:i:s.v');

    try {
        $pdo->beginTransaction();
        $pdo->prepare(
            'UPDATE settlement_place SET settlement_public_id = :ziel, settlement_name = :zielname, updated_at = :t
              WHERE public_id = :pid'
        )->execute(['ziel' => $zielId, 'zielname' => $zielName, 't' => $jetzt, 'pid' => $publicId]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    return ['ok' => true, 'ziel_name' => $zielName, 'alter_ort' => $alterOrt];
}

/**
 * Orte auf der Karte suchen -- fuer den Umhaengen-Dialog (Typeahead).
 *
 * ⚠️ `< 2` Zeichen liefert `[]`, wie jede andere Typeahead-Suche im Haus. `%`/`_` im Suchwort
 * werden woertlich gesucht (ESCAPE '!'), sonst koennte ein Editor mit „gar_strich" versehentlich
 * jeden Namen treffen, der ein beliebiges Zeichen an der Stelle traegt.
 *
 * @return list<array{public_id:string, name:string, subtype:string, lage:string}>
 */
function avesmapsSettlementPlaceOrteSuchen(PDO $pdo, string $q, int $limit = 12): array
{
    $q = trim($q);
    if (strlen($q) < 2) {
        return [];
    }

    $maskiert = str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q);
    $platzhalter = [];
    $werte = ['m' => '%' . $maskiert . '%'];
    foreach (AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES as $index => $subtype) {
        $schluessel = 'sub' . $index;
        $platzhalter[] = ':' . $schluessel;
        $werte[$schluessel] = $subtype;
    }

    try {
        $statement = $pdo->prepare(
            "SELECT public_id, name, feature_subtype, properties_json FROM map_features
              WHERE feature_type = 'location' AND is_active = 1
                AND feature_subtype IN (" . implode(', ', $platzhalter) . ")
                AND name LIKE :m ESCAPE '!'
              LIMIT 60"
        );
        $statement->execute($werte);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        return [];
    }

    $qKlein = strtolower($q);
    $qLaenge = strlen($qKlein);
    $praefix = [];
    $innen = [];
    foreach ((array) $rows as $row) {
        $name = (string) ($row['name'] ?? '');
        $eigenschaften = avesmapsInnerortsPropertiesDekodieren($row['properties_json'] ?? null) ?? [];
        $wikiSettlement = is_array($eigenschaften['wiki_settlement'] ?? null) ? $eigenschaften['wiki_settlement'] : [];
        $eintrag = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => $name,
            'subtype' => (string) ($row['feature_subtype'] ?? ''),
            'lage' => (string) ($wikiSettlement['region'] ?? ''),
        ];
        if (strtolower(substr($name, 0, $qLaenge)) === $qKlein) {
            $praefix[] = $eintrag;
        } else {
            $innen[] = $eintrag;
        }
    }

    return array_slice(array_merge($praefix, $innen), 0, $limit);
}

/**
 * Namensgleiche Kartenpunkte in der Naehe eines Ortes -- die zweite Haelfte der Regel
 * „Kartenpunkt schlaegt Innerorts": eine gespeicherte Staette, deren Name auf einen NAHEN
 * Kartenpunkt gleichen Namens trifft, ist vermutlich derselbe Ort, nur (noch) ohne Wiki-Adresse.
 *
 * @return array<string,true> kleingeschriebene, getrimmte Namen
 */
function avesmapsSettlementPlaceNamensnachbarn(PDO $pdo, string $ortId): array
{
    $ortId = trim($ortId);
    if ($ortId === '') {
        return [];
    }

    try {
        $ortStmt = $pdo->prepare(
            "SELECT min_x, min_y FROM map_features WHERE public_id = :ort AND feature_type = 'location' AND is_active = 1"
        );
        $ortStmt->execute(['ort' => $ortId]);
        $ort = $ortStmt->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        return [];
    }
    if (!is_array($ort) || $ort['min_x'] === null || $ort['min_y'] === null) {
        return [];
    }

    $x = (float) $ort['min_x'];
    $y = (float) $ort['min_y'];
    $radius = AVESMAPS_STAETTEN_NAMENSNACHBAR_RADIUS;

    try {
        $statement = $pdo->prepare(
            "SELECT name, min_x, min_y FROM map_features
              WHERE feature_type = 'location' AND is_active = 1 AND public_id <> :ort
                AND min_x BETWEEN :x0 AND :x1 AND min_y BETWEEN :y0 AND :y1"
        );
        $statement->execute([
            'ort' => $ortId,
            'x0' => $x - $radius,
            'x1' => $x + $radius,
            'y0' => $y - $radius,
            'y1' => $y + $radius,
        ]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        return [];
    }

    $menge = [];
    foreach ((array) $rows as $row) {
        if ($row['min_x'] === null || $row['min_y'] === null) {
            continue;
        }
        $dx = (float) $row['min_x'] - $x;
        $dy = (float) $row['min_y'] - $y;
        // 💣 Die bbox-Vorfilterung im SQL ist ein Quadrat, der Radius ist ein KREIS -- die echte
        // Distanz entscheidet, sonst zaehlen die vier Ecken des Quadrats faelschlich mit.
        if (sqrt($dx * $dx + $dy * $dy) > $radius) {
            continue;
        }
        $name = strtolower(trim((string) ($row['name'] ?? '')));
        if ($name !== '') {
            $menge[$name] = true;
        }
    }

    return $menge;
}
