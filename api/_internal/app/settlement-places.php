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
 * Kartenposition, gehoert zu Stadt X"; der Garetien-Import ist heute ihr einziger Schreiber und
 * traegt das in `origin`. Sein Abbau-Vertrag verbietet ihm, in fremde Tabellen zu schreiben -- und
 * er verbietet fremden Modulen, seine zu kennen. Deshalb steht sie hier und nicht dort.
 *
 * 💣 DIE BINDUNG IST DIE public_id DES ORTES, NICHT SEIN NAME. Die abgeleiteten Zeilen tragen den
 * Stadt-NAMEN, weil es im Wiki keine id gibt, und der Browser faltet Namen aufeinander
 * (avesmapsStaettenSchluessel). Ein GESPEICHERTES Objekt darf sich darauf nicht verlassen: eine
 * umbenannte Stadt verloere sonst alle ihre Staetten, lautlos. Der Name reist trotzdem mit -- er
 * ist die Anzeige und der Schluessel, unter dem der bestehende Index sie einsortiert.
 *
 * 🔴 `is_active = 0` STATT `DELETE`, wie ueberall im Haus: eine Ruecknahme muss umkehrbar sein.
 */

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
            'UPDATE settlement_place SET is_active = 0 WHERE public_id = :pid AND is_active = 1'
        );
        $statement->execute(['pid' => $publicId]);

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
 * Die public_ids der AKTIVEN Staetten, als Menge (public_id => true) -- optional auf eine Herkunft
 * eingeschraenkt.
 *
 * Der Leser der Arbeitsliste des Garetien-Importers („uebernommen · innerorts", garetien-liste.php):
 * EINE Abfrage je Listenbau statt einer je Objekt, und die Antwort auf „liegt das als Staette?" kommt
 * aus der Tabelle, nicht aus einem zweiten Vermerk am Item.
 *
 * ⚠️ FAELLT STILL AUS: ohne Tabelle eine leere Menge -- dann ist nichts innerorts, und das stimmt.
 *
 * @return array<string,true>
 */
function avesmapsSettlementPlacePublicIds(PDO $pdo, ?string $origin = null): array
{
    try {
        if ($origin === null) {
            $statement = $pdo->query('SELECT public_id FROM settlement_place WHERE is_active = 1');
        } else {
            $statement = $pdo->prepare('SELECT public_id FROM settlement_place WHERE is_active = 1 AND origin = :origin');
            $statement->execute(['origin' => $origin]);
        }
        $ids = $statement->fetchAll(PDO::FETCH_COLUMN);
    } catch (PDOException) {
        return [];
    }

    $menge = [];
    foreach ((array) $ids as $id) {
        $id = trim((string) $id);
        if ($id !== '') {
            $menge[$id] = true;
        }
    }

    return $menge;
}
