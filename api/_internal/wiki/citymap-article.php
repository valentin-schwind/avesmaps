<?php

declare(strict_types=1);

// Die WIKI-SEITENREGISTRY als Trefferquelle der KARTEN-Zuweisung (Aufgabe 9 des Umbaus, Entwurf
// docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md §8).
//
// 🔴 EIGENE DATEI, NICHT EIN ANHANG AN citymap-sync.php -- und der Grund ist gemessen, nicht
// Ordnungsliebe. Jene Datei ist die DUMP-PIPELINE, und ihre Probe
// (__tests__/citymap-sync-test.php) verlangt, dass JEDE fremde Funktion, die sie ruft, in der
// require-Kette des Dump-Endpunkts steht. Die Suche braucht avesmapsWikiSettlementClassLabel
// (api/_internal/wiki/settlements.php), und die steht dort NICHT: der erste Anlauf hing sie an
// citymap-sync.php an und liess damit einen fremden Test umfallen, obwohl an der Funktion nichts
// falsch war. Genau die Lehre aus AGENTS.md §9 („die Datei, die bricht, gehoert jemand anderem").
// ⭐ Und sachlich gehoert sie ohnehin hierher: eine Picker-Suche ist kein Abgleich.
//
// Side-effect-free on include (function definitions only), damit
// __tests__/citymap-article-search-test.php sie ohne MySQL laden kann.
//
// 💣 WAS HIER NICHT GESUCHT WIRD -- die Falle dieser Objektart, ausgeschrieben an den Spalten in
// avesmapsCitymapsEnsureTables (api/_internal/app/citymaps.php):
//   `citymap.wiki_key` ist ein BAUSCHLUESSEL (`index:stadt:quelle:variante`), keine Seitenidentitaet.
//   `citymap.map_url`  zeigt bei einer Wiki-Karte auf die PUBLIKATION, in der die Karte steckt.
// Beide gehoeren dem laufenden Karten-Abgleich und bleiben unangetastet; gesucht wird der EIGENE
// Artikel der Karte (`citymap.article_url`).
//
// ⚠️ Laufzeit-Abhaengigkeiten, die der AUFRUFER laedt (api/edit/wiki/citymaps.php):
//   avesmapsPoliticalSlug          (api/_internal/political/territory.php)
//   avesmapsWikiSettlementClassLabel (api/_internal/wiki/settlements.php) -- weich abgefragt
/**
 * Die TREFFERQUELLE der Wiki-Zuweisung im Karten-Editor (Aufgabe 9 des Umbaus, Entwurf
 * docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md §8).
 *
 * 🔴 GESUCHT WIRD DER EIGENE ARTIKEL DER KARTE -- nicht ihr Bauschluessel und nicht ihre Publikation.
 * Die drei auseinanderzuhalten ist die ganze Falle dieser Objektart; die Messung steht an den Spalten
 * in avesmapsCitymapsEnsureTables (api/_internal/app/citymaps.php).
 *
 * 💣 ES GAB VORHER GAR KEINE SUCHE, UND ES GIBT AUCH KEINEN KATALOG VON KARTEN-ARTIKELN. Am
 * Livecode gemessen (16.08.2026): `wiki_citymap_catalog` traegt INDEXZEILEN, deren Schluessel
 * `index:stadt:quelle:variante` lautet -- keine Seite. `wiki_publication_catalog` traegt BUECHER (das
 * ist `map_url`). `wiki_adventure_catalog` traegt Werke. Die EINZIGE Tabelle im Haus, die einen
 * Seitentitel auf seine Adresse abbildet, ist `wiki_sync_pages`.
 *
 * ⚠️ UND SIE FUEHRT HEUTE NUR ORTS- UND BAUWERKSSEITEN. Das ist keine Nachlaessigkeit dieser
 * Funktion, sondern der Bestand: geschrieben wird die Registry von avesmapsWikiSyncUpsertPageCache
 * (locations-helpers.php:332) und avesmapsWikiDumpPersistSettlementRecords (dump-entity-scan.php),
 * beide ausschliesslich fuer Siedlungen und Bauwerke. Steht der Artikel einer Karte woanders im Wiki,
 * wird er hier NICHT gefunden -- dafuer sagt der Leerzustand im Kasten, was zu tun ist, und daneben
 * steht das Haekchen „Kein Wiki-Artikel vorhanden".
 * 🔴 Und deshalb traegt jeder Treffer seine SEITENART mit: „Stadt", „Dorf", „Gebäude". Weist ein
 * Editor eine Karte der Seite ihrer Stadt zu, ist das kein stiller Fehler mehr, sondern ein Fall im
 * Konfliktzentrum (avesmapsConflictLoadCitymapRows) -- die Suche bietet an, was da ist, und die
 * Kollisionsregel faengt den Missgriff.
 *
 * 💣 KEIN EIGENES DDL HIER: `wiki_sync_pages` und ihre nachgezogenen Spalten (`continent`) legt
 * avesmapsWikiSettlementEnsureSchema an, und das ist MySQL samt information_schema. Der Aufrufer
 * macht das (api/edit/wiki/citymaps.php) -- nur so bleibt diese Funktion gegen SQLite pruefbar,
 * dieselbe Trennung wie bei avesmapsWikiGameLiteratureSearch.
 *
 * @return array{ok:bool, query:string, rows:array<int, array<string, string>>}
 */
function avesmapsWikiCitymapArticleSearch(PDO $pdo, string $query, int $limit = 40): array
{
    $query = trim($query);
    // Dieselben Schranken wie bei den drei Schwestern: mindestens 1, hoechstens 80. Das Bauteil
    // schickt 40.
    $limit = max(1, min(80, $limit));

    $select = 'SELECT title, settlement_class, settlement_label, continent, wiki_url FROM wiki_sync_pages';
    if ($query === '') {
        $statement = $pdo->prepare($select . ' ORDER BY title ASC LIMIT :lim');
    } else {
        // 💣 `is_exact` zuerst, dann der KUERZESTE Titel -- wortgleich zu avesmapsWikiSettlementSearch
        // (api/_internal/wiki/settlements.php:710). Ohne die zweite Stufe steht „Gareth" hinter
        // „Garether Handelskontor", und der gesuchte Artikel ist der, dessen Name am wenigsten
        // Beiwerk traegt.
        $statement = $pdo->prepare(
            $select . ' WHERE title LIKE :like'
            . ' ORDER BY (title = :exact) DESC, LENGTH(title) ASC, title ASC LIMIT :lim'
        );
        $statement->bindValue(':exact', $query);
        $statement->bindValue(':like', '%' . $query . '%');
    }
    $statement->bindValue(':lim', $limit, PDO::PARAM_INT);
    $statement->execute();

    $rows = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $title = trim((string) ($row['title'] ?? ''));
        if ($title === '') {
            continue;
        }
        $class = (string) ($row['settlement_class'] ?? '');
        $label = trim((string) ($row['settlement_label'] ?? ''));
        if ($label === '' && $class !== '' && function_exists('avesmapsWikiSettlementClassLabel')) {
            $label = (string) avesmapsWikiSettlementClassLabel($class);
        }
        $rows[] = [
            // `name` ist der Anzeigename des Treffers, `title` derselbe Wert unter dem Namen der
            // Spalte -- das Bauteil liest `name`, die drei Schwestern geben beide heraus.
            'name' => $title,
            'title' => $title,
            // 🔴 Derselbe Schluessel, den das ganze Haus fuer eine Wiki-Seite bildet
            // (avesmapsPoliticalSlug, AGENTS.md §5). Nicht „huebscher" machen: die Faltung ist eine
            // feste Tabelle, keine Locale, und jede Aenderung daran waere eine Datenmigration.
            'wiki_key' => avesmapsPoliticalSlug($title),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'settlement_label' => $label,
            'continent' => trim((string) ($row['continent'] ?? '')),
        ];
    }

    return ['ok' => true, 'query' => $query, 'rows' => $rows];
}

/**
 * Die Registry-Zeile zu EINEM Seitentitel -- der Stand eines bereits zugewiesenen Artikels.
 *
 * 💣 WARUM ES DIESEN ARM GIBT, und warum ihn nicht jede Objektart braucht: Ort, Weg und Landschaft
 * legen die Wiki-Angaben im Nest `properties_json` ihres Kartenobjekts ab -- ein zugewiesener Artikel
 * ist dort ohne Rueckfrage lesbar. `citymap` hat kein solches Nest; gespeichert werden nur
 * article_url/article_key/article_title, also reine IDENTITAET. Die Anzeigewerte des Kastens
 * (Seitenart, Kontinent) stehen in der Registry, und ohne diesen Arm zeigte der Kasten sie genau
 * einmal -- direkt nach der Wahl -- und nach dem naechsten Oeffnen nicht mehr. Dieselbe Lage und
 * dieselbe Loesung wie bei der Literatur (avesmapsWikiGameLiteratureEntry).
 *
 * 🔴 GESUCHT WIRD UEBER DEN TITEL, nicht ueber `article_key`. Der Schluessel ist die ASCII-Faltung
 * (avesmapsPoliticalSlug) und in `wiki_sync_pages` steht KEINE Spalte, die ihn traegt --
 * `normalized_key` ist die WikiSync-Faltung und eine andere Rechnung. Ueber den Titel ist es ein
 * Gleichheitsvergleich auf dem UNIQUE-Schluessel der Tabelle.
 *
 * ⚠️ Kein Treffer ist KEIN Fehler: eine Karte kann einen Artikel tragen, den ein spaeterer Dump aus
 * der Registry genommen hat. Der Kasten zeigt dann Name, Adresse und Schluessel -- die zwei
 * Anzeigezeilen fallen weg, wie jede leere Zeile.
 *
 * @return array{ok:bool, query:string, rows:array<int, array<string, string>>}
 */
function avesmapsWikiCitymapArticleEntry(PDO $pdo, string $title): array
{
    $title = trim($title);
    if ($title === '') {
        return ['ok' => true, 'query' => '', 'rows' => []];
    }
    // 🔴 DIESELBE ZEILENFORM WIE DIE SUCHE, und zwar durch DENSELBEN Bauer -- zwei Umformungen fuer
    // dieselbe Zeile waeren die zweite Wahrheit, gegen die dieser ganze Umbau gebaut ist. Die Suche
    // sortiert den exakten Titel nach vorn; hier wird trotzdem noch einmal darauf geprueft, damit ein
    // blosser Teiltreffer („Gareth" fuer „Gareths Tor") nicht als DER Artikel durchgeht.
    $treffer = avesmapsWikiCitymapArticleSearch($pdo, $title, 1);
    $genau = array_values(array_filter(
        $treffer['rows'],
        static fn(array $zeile): bool => ($zeile['title'] ?? '') === $title
    ));

    return ['ok' => true, 'query' => $title, 'rows' => $genau];
}
