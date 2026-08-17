<?php

declare(strict_types=1);

// Der MASSENLAUF der Karten-Wikizuweisung: jede Stadtkarte bekommt die Wikiseite der PUBLIKATION,
// in der sie abgedruckt ist. Nachlauf zum Umbau vom 15.08.2026; Messung und Begruendung in
// .superpowers/sdd/2026-08-15-wiki-zuweisung-vereinheitlichung/nachlauf-kartenzuweisung-bericht.md.
//
// Anlass (Owner, viermal gefragt): im Karten-Editor stand jede Karte auf „keine Zuweisung". Die
// erste Antwort darauf war „Karten sind nicht zuweisbar, es gibt keine Artikelseiten fuer einzelne
// Karten" -- gemessen 11 von 521. 🪤 Das war die falsche Frage. Owner, woertlich: „karten sind in
// publikationen und publikationen haben einen wiki-artikel".
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 DIE QUELLE IST `map_url`, NICHT TEIL 3 DES BAUSCHLUESSELS -- UND DAS SPART DEN JOIN GANZ
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Der naheliegende Weg waere, Teil 3 von `citymap.wiki_key` (`index:stadt:quelle:variante`) gegen
// `wiki_publication_catalog` zu joinen. Der Join ist aber SCHON GELAUFEN, und sein Ergebnis steht
// bereits in der Zeile: avesmapsCitymapWikiUrlForSource (citymap-sync.php:1508) rechnet den
// Katalogschluessel, prueft ihn mit `SELECT 1 FROM wiki_publication_catalog` und schreibt `map_url`
// NUR bei Treffer („no invented link"). Eine `map_url` auf einer Wikiseite ist damit ein von
// Produktionscode gegen den Produktionskatalog geprueftes Ergebnis -- und sie traegt den Seitentitel
// im Klartext.
//
// 💣 UND DER RUECKWEG WAERE UNMOEGLICH: avesmapsPoliticalSlug ist verlustbehaftet, Umlaute fallen
// samt Grundbuchstabe weg (`Übersichtskarte` → `bersichtskarte`, AGENTS.md §5). Aus einem Slug einen
// Seitennamen zu rechnen geht nicht. Der Titel MUSS aus `map_url` kommen.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 DIE HERKUNFTSMARKE IST TRAGEND, NICHT BEIWERK
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// `citymap` steht NICHT in AVESMAPS_CONFLICT_SEGMENTED_TYPES (`['path','powerline']`). Ohne Marke
// legte dieser Lauf 363 Karten auf 140 Artikel und erzeugte im Konfliktzentrum **136 neue Gruppen
// mit 482 Objekten** -- 123 davon GEMISCHT (Karte + Literaturwerk auf einem Artikel), also in der
// schwersten Stufe. Live gemessen am 17.08.2026.
//
// Und das waere kein Werkzeuglaerm, sondern der Owner-Entscheid vom 20.07.2026 woertlich angewandt:
// „Greifenfurt Stadt" und „Greifenfurt Baronie" duerfen keine Identitaet teilen. Ein Stadtplan und
// das BUCH, in dem er abgedruckt ist, sind ebenfalls zwei Dinge -- und das Buch hat den Artikel
// bereits (123 der 140 gehoeren einem Literaturwerk).
//
// ⛔ Die Alternative -- das Paar `citymap|game_literature` pauschal freizugeben wie `path|path` --
// ist vom Owner VERWORFEN (17.08.2026): sie versteckt auch echte Fehlzuweisungen, und der Kasten
// gaebe die Publikation weiter als eigenen Artikel der Karte aus. Owner, woertlich: „weil ich sehen
// will, was gesynct und was von uns editiert ist."
//
// ⇒ `citymap.article_origin` traegt die Antwort, und avesmapsConflictLoadCitymapRows liest sie.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠️ LAUFZEIT-ABHAENGIGKEITEN, DIE DER AUFRUFER LAEDT (api/edit/map/citymaps.php)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
//   avesmapsPoliticalSlug                  api/_internal/political/territory.php
//   avesmapsWikiAventuricaPageTitleFromUrl api/_internal/wiki/publication-sync.php
//   avesmapsWikiSyncPageUrl                api/_internal/wiki/sync.php
//   AVESMAPS_CITYMAP_ARTICLE_ORIGIN_*      api/_internal/app/citymaps.php
//
// 🔴 UND DER AUFRUFER SCHULDET NOCH EINES: avesmapsCitymapsEnsureTables() VOR dem Lauf. Es legt die
// Spalte `article_origin` an, sein DDL ist MySQL samt information_schema, und deshalb steht es dort
// statt hier -- sonst waere diese Datei gegen SQLite nicht pruefbar.
//
// Side-effect-free on include (nur Funktions- und Konstantendefinitionen), damit
// __tests__/citymap-article-assign-test.php sie gegen SQLite laden kann.

// ⚠️ AVESMAPS_CITYMAP_ARTICLE_ORIGIN_{PUBLICATION,MANUAL} stehen NICHT hier, sondern bei der Spalte
// selbst (api/_internal/app/citymaps.php) -- dort steht die Begruendung, dort legt das self-healing
// DDL sie an, und dort setzt der Editor-Schreibweg sie auf 'manual'. Ein zweites Paar Konstanten
// waere die zweite Wahrheit, gegen die dieser ganze Umbau gebaut ist.

/** Spaltenbreiten, gegen die geprueft statt abgeschnitten wird (siehe avesmapsCitymapsEnsureTables). */
const AVESMAPS_CITYMAP_ARTICLE_URL_MAX = 500;
const AVESMAPS_CITYMAP_ARTICLE_KEY_MAX = 190;
const AVESMAPS_CITYMAP_ARTICLE_TITLE_MAX = 300;

/**
 * PURE: die Publikations-Wikiseite hinter einer `map_url`, oder null.
 *
 * 🔴 DER TITEL WIRD NORMALISIERT, NICHT ABGESCHRIEBEN. Am Livebestand tragen 15 Karten ihren
 * Seitennamen mit Unterstrichen (`Das_Land_des_Schwarzen_Auges_(Box)`), und DREI Artikel stehen in
 * ZWEI Rohformen nebeneinander -- `Die Helden des Schwarzen Auges (DSA3)` und
 * `Die_Helden_des_Schwarzen_Auges_(DSA3)` sind EINE Seite. Roh uebernommen bekaeme sie zwei
 * verschiedene `article_title`. avesmapsWikiAventuricaPageTitleFromUrl macht daraus Leerzeichen,
 * entfernt ein `#Fragment` und beherrscht beide URL-Formen (`/wiki/X` und `?title=X`).
 *
 * 🔴 DIE ADRESSE BAUT avesmapsWikiSyncPageUrl, UND ZWAR GENAU DIE. Sie ist der Bauer, aus dem auch
 * `wiki_sync_pages.wiki_url` entsteht (avesmapsWikiSyncUpsertPageCache) -- also das, was der Picker
 * ausliefert und was eine VON HAND gesetzte Zuweisung in die Spalte schreibt. Eine eigene Formel
 * (etwa `rawurlencode` mit Leerzeichen wie in citymap-sync.php:1531) ergaebe fuer dieselbe Seite
 * eine andere Adresse als der Handgriff daneben -- genau die Divergenz, gegen die dieser Umbau
 * gebaut ist.
 *
 * ⚠️ GEPRUEFT STATT ABGESCHNITTEN (AGENTS.md §10): ein still gekuerzter Schluessel ist von einem
 * falschen nicht zu unterscheiden. Passt ein Wert nicht in seine Spalte, gilt die Karte als nicht
 * zuweisbar -- lieber eine Luecke als eine falsche Identitaet.
 *
 * @return array{title:string, url:string, key:string}|null
 */
function avesmapsCitymapPublicationArticleFromMapUrl(string $mapUrl): ?array
{
    $title = avesmapsWikiAventuricaPageTitleFromUrl($mapUrl);
    if ($title === '') {
        return null; // keine Wiki-Aventurica-Seite -- Fankarte, Shoplink, oder gar kein Link
    }

    $key = avesmapsPoliticalSlug($title);
    if ($key === '') {
        return null; // ein Titel ganz ohne alphanumerische Zeichen ergaebe einen leeren Schluessel
    }

    $url = avesmapsWikiSyncPageUrl($title);
    if (mb_strlen($title) > AVESMAPS_CITYMAP_ARTICLE_TITLE_MAX
        || strlen($key) > AVESMAPS_CITYMAP_ARTICLE_KEY_MAX
        || strlen($url) > AVESMAPS_CITYMAP_ARTICLE_URL_MAX) {
        return null;
    }

    return ['title' => $title, 'url' => $url, 'key' => $key];
}

/**
 * PURE: Teil 3 („Quelle") aus einem Karten-Bauschluessel `index:stadt:quelle:variante`, oder ''.
 *
 * Gebraucht wird er ausschliesslich als RIEGEL (siehe avesmapsCitymapAssignPublicationArticles),
 * nie als Datenquelle -- aus ihm laesst sich kein Seitenname zurueckrechnen.
 *
 * ⚠️ NUR BEI GENAU VIER TEILEN. Kein Teil kann selbst einen Doppelpunkt tragen (avesmapsPoliticalSlug
 * faltet ihn zu `-`), aber avesmapsCitymapWikiKey kuerzt einen ueberlangen Schluessel auf 181 Zeichen
 * plus Hash und kann dabei mitten in einem Teil schneiden. Ein Schluessel in einer anderen Form wird
 * deshalb nicht geraten, sondern als „unbekannt" behandelt -- er nimmt dann nicht am Riegel teil.
 */
function avesmapsCitymapWikiKeySourceSlug(string $wikiKey): string
{
    $parts = explode(':', trim($wikiKey));
    if (count($parts) !== 4) {
        return '';
    }

    return $parts[2];
}

/**
 * Der Lauf. ZWEI Aufrufe von aussen: erst `$dryRun = true` (Vorschau mit Zahl), dann nach
 * Zustimmung `$dryRun = false`. Nie eine Schleife ueber den Endpunkt (AGENTS.md §9, STRATO).
 *
 * 🔴 GESCHRIEBEN WIRD NUR IN LUECKEN, und die Pruefung steht ZWEIMAL da -- in der PHP-Schleife UND
 * in der WHERE-Klausel. Das ist keine Doppelung aus Nachlaessigkeit, die beiden tun Verschiedenes:
 * die Schleife bestimmt die ZAHLEN, die der Vorschau-Kasten zeigt, die WHERE-Klausel bestimmt, was
 * WIRKLICH geschrieben wird. Gemessen beim Bau (17.08.2026): nimmt man je EINE der beiden weg,
 * bleiben alle Zeilen-Zusicherungen gruen -- jede Schicht allein schuetzt die Daten. Erst wenn
 * BEIDE fallen, wird eine fremde Zuweisung ueberfahren. Wer hier „vereinfacht", merkt es also nicht
 * am Testfeld, sondern erst an der Zahl im Kasten oder an einem verlorenen Datensatz.
 * ⚠️ Die WHERE-Haelfte ist die wichtigere: Zwischen Vorschau und scharfem Lauf liegt eine Rueckfrage, also Zeit, in der
 * ein zweiter Editor dieselbe Karte zuweisen kann; eine Zaehlung von vorhin ist dann eine Behauptung
 * ueber die Vergangenheit. Gemessen am 17.08.2026 trugen 0 von 529 Karten eine Zuweisung -- genau
 * darauf darf sich der Riegel NICHT verlassen.
 *
 * 🔴 DER RIEGEL: Teil 3 des Bauschluessels muss zum Slug des `map_url`-Seitennamens passen. Beide
 * entstehen aus DEMSELBEN `$source` (citymap-sync.php:103 und :1531), koennen also nur auseinander
 * laufen, wenn ein Mensch `map_url` von Hand geaendert hat -- dann wird die Karte `origin='manual'`
 * und der Abgleich fasst sie nie wieder an. Live gemessen: 22 solche Karten, alle `manual`.
 * ⇒ Eine Abweichung bei einer Karte, die NICHT `manual` ist, widerlegt diese Herleitung. Dann bricht
 * der Lauf ab und nennt die Zahl, statt 363 Zeilen nach einer falschen Annahme zu schreiben.
 * ⚠️ Der Riegel laeuft in BEIDEN Richtungen -- auch im Trockenlauf, sonst faende die Vorschau ihn nie.
 *
 * @return array{dry_run:bool, total:int, citymaps_affected:int, articles_linked:int, applied:int,
 *               skipped:array{already_assigned:int, no_article_flag:int, no_publication:int},
 *               key_mismatch:array{total:int, unexplained:int}}
 */
function avesmapsCitymapAssignPublicationArticles(PDO $pdo, bool $dryRun): array
{
    // 🔴 KEIN avesmapsCitymapsEnsureTables() HIER, obwohl die Spalte `article_origin` von dort
    // kommt. Jenes DDL ist MySQL samt information_schema; der AUFRUFER macht es
    // (api/edit/map/citymaps.php), und nur so bleibt diese Funktion gegen SQLite pruefbar --
    // dieselbe Trennung, die api/_internal/wiki/citymap-article.php schon vorzeichnet.
    // ⚠️ Und es MUSS vor dieser Funktion laufen, nicht nur irgendwann: DDL committet in MySQL
    // implizit, mitten in der Transaktion unten waere es ein aufgebrochener Schreiblauf.
    $rows = $pdo->query(
        "SELECT id, origin, wiki_key, map_url, article_url, no_article
           FROM citymap
          WHERE status = 'approved'"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $kandidaten = [];
    $artikel = [];
    $skipped = ['already_assigned' => 0, 'no_article_flag' => 0, 'no_publication' => 0];
    $mismatchTotal = 0;
    $mismatchUnexplained = 0;

    foreach ($rows as $row) {
        $treffer = avesmapsCitymapPublicationArticleFromMapUrl((string) ($row['map_url'] ?? ''));
        if ($treffer === null) {
            $skipped['no_publication']++;
            continue;
        }

        // Der Riegel zaehlt ueber ALLE Karten mit Publikationsseite -- auch ueber die, die gleich
        // uebersprungen werden. Eine gebrochene Annahme bleibt gebrochen, egal ob diese Zeile
        // geschrieben wuerde.
        $teil3 = avesmapsCitymapWikiKeySourceSlug((string) ($row['wiki_key'] ?? ''));
        if ($teil3 !== '' && $teil3 !== $treffer['key']) {
            $mismatchTotal++;
            if ((string) ($row['origin'] ?? '') !== AVESMAPS_CITYMAP_ARTICLE_ORIGIN_MANUAL) {
                $mismatchUnexplained++;
            }
        }

        if ((int) ($row['no_article'] ?? 0) === 1) {
            $skipped['no_article_flag']++;
            continue;
        }
        if (trim((string) ($row['article_url'] ?? '')) !== '') {
            $skipped['already_assigned']++;
            continue;
        }

        $kandidaten[] = ['id' => (int) $row['id']] + $treffer;
        $artikel[$treffer['key']] = true;
    }

    if ($mismatchUnexplained > 0) {
        // 💣 InvalidArgumentException, nicht RuntimeException: der Dispatcher macht daraus 400 mit
        // DIESEM Text (api/edit/map/citymaps.php), waehrend eine RuntimeException in den 500er-Zweig
        // faellt und der Editor nur „konnte nicht verarbeitet werden" saehe.
        throw new InvalidArgumentException(
            'Abgebrochen: bei ' . $mismatchUnexplained . ' Karten passt der Bauschlüssel nicht zur '
            . 'Publikation in „Karten-Link“, obwohl sie nicht von Hand bearbeitet wurden. '
            . 'Es wurde nichts geschrieben.'
        );
    }

    $ergebnis = [
        'dry_run' => $dryRun,
        'total' => count($rows),
        'citymaps_affected' => count($kandidaten),
        'articles_linked' => count($artikel),
        'applied' => 0,
        'skipped' => $skipped,
        'key_mismatch' => ['total' => $mismatchTotal, 'unexplained' => $mismatchUnexplained],
    ];

    if ($dryRun || $kandidaten === []) {
        return $ergebnis;
    }

    $statement = $pdo->prepare(
        'UPDATE citymap
            SET article_url = :url, article_key = :key, article_title = :title,
                article_origin = :origin
          WHERE id = :id
            AND (article_url IS NULL OR article_url = \'\')
            AND no_article = 0'
    );

    $pdo->beginTransaction();
    try {
        $applied = 0;
        foreach ($kandidaten as $kandidat) {
            $statement->execute([
                'url' => $kandidat['url'],
                'key' => $kandidat['key'],
                'title' => $kandidat['title'],
                'origin' => AVESMAPS_CITYMAP_ARTICLE_ORIGIN_PUBLICATION,
                'id' => $kandidat['id'],
            ]);
            $applied += $statement->rowCount();
        }
        $pdo->commit();
    } catch (Throwable $fehler) {
        $pdo->rollBack();
        throw $fehler;
    }

    $ergebnis['applied'] = $applied;

    return $ergebnis;
}
