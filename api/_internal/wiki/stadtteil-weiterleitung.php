<?php

declare(strict_types=1);

/**
 * Die Stadtteilweiterleitungen im STAGING -- und warum sie NICHT in wiki_sync_pages stehen.
 * ===========================================================================================
 * Gegenstueck zu stadtteil-kategorie.php (dort die reine Entscheidung, hier alles mit Datenbank).
 * Dieselbe Arbeitsteilung wie organisation-seats.php / organisation-sync.php.
 *
 * 💣 EINE WEITERLEITUNG IST KEIN ARTIKEL, UND wiki_sync_pages IST EINE ARTIKELTABELLE. Jeder Leser
 * dort nimmt eine Zeile als Seite, die man zuweisen, verlinken oder als Beleg zeigen kann:
 *   - die Wiki-Zuweisung eines Ortes (avesmapsWikiSettlementSearch) boete „Yol-Fessar" an, und
 *     avesmapsWikiSettlementBuildFromTitle holt die Seite mit redirects=1 -- die Karte bekaeme die
 *     Infobox von FASAR unter dem Titel „Yol-Fessar";
 *   - das Konfliktzentrum (avesmapsConflictLoadWikiTitles) meldete „eigener Wiki-Artikel vorhanden"
 *     fuer einen Namen, dessen „Artikel" die Stadt ist -- genau die Verwechslung aus Discord #38;
 *   - die Kartenartikel-Suche (avesmapsWikiCitymapArticleSearch) boete sie als Artikel an.
 * Gefunden von einer Gegenpruefung, BEVOR es live ging. Jeden dieser Leser einzeln abzudichten waere
 * die Falle „eine Regel, die einen von vier Lesern bindet". Deshalb bekommen die Weiterleitungen
 * ihren eigenen Ort, und es gibt genau EINEN Leser: die Innerorts-Liste, fuer die sie da sind.
 *
 * ⭐ STAGING ONLY: Suffix `_staging` -- die Tabelle ist aus dem Dump wieder aufbaubar und laeuft
 * deshalb nicht mit ins Datenbank-Backup (AVESMAPS_DB_BACKUP_TRANSIENT_SUFFIX).
 *
 * ⚠️ Eine Weiterleitung, die im Wiki geloescht wird, bleibt hier stehen -- wie jede Bauwerkszeile in
 * wiki_sync_pages auch. Der Sync schreibt je Zeile, er kennt den Gesamtbestand nicht.
 */

// AVESMAPS_WIKI_STADTTEIL_ART (die Art in der Innerorts-Zeile). Rein, nichts laeuft beim Einbinden.
require_once __DIR__ . '/stadtteil-kategorie.php';

const AVESMAPS_WIKI_STADTTEIL_WEITERLEITUNG_TABLE = 'wiki_stadtteil_weiterleitung_staging';

/**
 * PURE: die Datensaetze ohne Stadtteilweiterleitungen -- fuer jeden, der Bauwerks-Datensaetze gegen
 * wiki_sync_pages haelt (scripts/wikidump-compare.php). Dort stehen sie nicht, und ohne diesen Filter
 * meldete der Vergleich 294 fehlende Bauwerke, die gar keine sein sollen.
 *
 * @param list<array<string,mixed>> $records
 * @return list<array<string,mixed>>
 */
function avesmapsWikiStadtteilWeiterleitungenAussortieren(array $records): array
{
    return array_values(array_filter(
        $records,
        static fn($record): bool => !(is_array($record) && !empty($record['stadtteil_weiterleitung']))
    ));
}

/**
 * Selbstheilende DDL. ⚠️ NUR aus dem Sync-Pfad aufrufen, VOR jeder Transaktion und nie aus einem
 * Lesepfad (AGENTS.md §10). Gerufen dort, wo der Sync auch avesmapsWikiSettlementEnsureSchema ruft.
 */
function avesmapsWikiStadtteilWeiterleitungEnsureTable(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_STADTTEIL_WEITERLEITUNG_TABLE . ' (
            title VARCHAR(255) NOT NULL PRIMARY KEY,
            standort VARCHAR(300) NOT NULL,
            wiki_url VARCHAR(500) NULL,
            synced_at DATETIME(3) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );
}

/**
 * EINE Stadtteilweiterleitung schreiben. Ein erneuter Sync zieht Standort und Adresse nach -- ein
 * Umzug im Wiki soll ankommen, und niemand pflegt diese Zeilen von Hand.
 */
function avesmapsWikiStadtteilWeiterleitungUpsert(PDO $pdo, string $title, string $standort, string $wikiUrl): int
{
    $title = trim($title);
    $standort = trim($standort);
    if ($title === '' || $standort === '') {
        return 0;
    }

    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_STADTTEIL_WEITERLEITUNG_TABLE . '
            (title, standort, wiki_url, synced_at)
         VALUES (:title, :standort, :wiki_url, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
            standort = VALUES(standort),
            wiki_url = VALUES(wiki_url),
            synced_at = VALUES(synced_at)'
    );
    $statement->execute([
        'title' => mb_substr($title, 0, 255, 'UTF-8'),
        'standort' => mb_substr($standort, 0, 300, 'UTF-8'),
        'wiki_url' => $wikiUrl !== '' ? mb_substr($wikiUrl, 0, 500, 'UTF-8') : null,
    ]);

    return $statement->rowCount();
}

/**
 * Die Stadtteilweiterleitungen fuer die Innerorts-Liste -- in DERSELBEN Zeilenform wie ein Bauwerk,
 * damit Suche und Infobox-Zeile „Staetten" sie ohne Sonderfall lesen. Der Standort bleibt roh; die
 * Aufloesung gegen die Karte macht place-scope.php beim Lesen, wie bei jedem |Standort=.
 *
 * ⚠️ Fehlt die Tabelle (Sync nie gelaufen, frische Installation), liefert das eine LEERE Liste und
 * NICHT den Ausfall der uebrigen Innerorts-Objekte (die Lehre vom 15.08.2026). Kein DDL hier.
 *
 * @return list<array{title:string, raw:string, type_label:string, deity:string, wiki_url:string}>
 */
function avesmapsWikiStadtteilWeiterleitungFetchInSettlementRows(PDO $pdo): array
{
    try {
        $statement = $pdo->query(
            'SELECT title, standort, wiki_url FROM ' . AVESMAPS_WIKI_STADTTEIL_WEITERLEITUNG_TABLE . ' ORDER BY title'
        );
    } catch (Throwable) {
        return [];
    }
    if ($statement === false) {
        return [];
    }

    $rows = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $rows[] = [
            'title' => (string) ($row['title'] ?? ''),
            'raw' => (string) ($row['standort'] ?? ''),
            'type_label' => AVESMAPS_WIKI_STADTTEIL_ART,
            'deity' => '',
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
        ];
    }

    return $rows;
}
