<?php

declare(strict_types=1);

// Der MASSENLAUF der Kraftlinien-Wikizuweisung: jede Kraftlinie, deren NAME einen gestagten
// Wiki-Artikel trifft, bekommt dessen Adresse in `properties.wiki_url` -- und zwar auf ALLEN
// Segmenten ihrer Namensgruppe, so wie es der Editor auch tut (avesmapsUpdatePowerlineLine).
//
// Vierter seiner Art nach Weg (avesmapsWikiPathAssignAll), Landschaft
// (avesmapsWikiRegionAssignAll) und Karte (avesmapsCitymapAssignPublicationArticles); die
// Bedienung dazu ist unveraendert js/ui/wiki-massenzuweisung.js -- erst Vorschau mit Zahl, dann
// nach Zustimmung der scharfe Lauf, nie eine Schleife (AGENTS.md §9, STRATO).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 DERSELBE SCHLUESSEL WIE DER ABGLEICH -- avesmapsWikiSyncCreateMatchKey, KEIN ZWEITER
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Stufe 2 von avesmapsWikiPowerlineResolveSegment sucht den Artikel zu einem Linien-NAMEN ueber
// genau diesen Schluessel. Ein eigener, „grosszuegigerer" Abgleich hier faende Paare, die der
// naechste Sync nicht wiederfindet -- die Zuweisung staende dann auf einem Artikel, von dem der
// Abgleich nichts weiss, und die Linie bliebe fuer immer ohne Nest. Also: dieselbe Rechnung, oder
// gar keine.
//
// ⚠️ Damit weist dieser Lauf NUR wortgleiche Treffer zu. Der unscharfe Kandidat („Brücke nach
// Akrabaal" gegen den Artikel „Brücke von Akrabaal") gehoert bewusst NICHT dazu: ein Massenlauf,
// der raet, schreibt echte Daten nach einer Vermutung (die Fehlerklasse aus Discord #38). Solche
// Faelle bleiben dem Zuweisungskasten im Editor.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 💣 EIN ARTIKEL TRAEGT AM ENDE DES LAUFS GENAU EINEN ANSPRUCH
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Das ist die Falle, gegen die dieser Lauf ueberhaupt gebaut werden musste. Live gemessen am
// 18.08.2026 (oeffentliche Kartennutzlast, EIN Abruf): die Linie „Hexenband" traegt bereits
// https://de.wiki-aventurica.de/wiki/Hexenband, und daneben steht eine zweite Linie
// „Hexenband(-schleife)". Trifft deren Name denselben Artikel, legte ein Lauf ohne Riegel zwei
// Kartenobjekte auf EINEN Artikel -- und genau das meldet das Konfliktzentrum als Fall
// (avesmapsConflictFindSharedWikiUrls). Der Lauf erzeugte also die Arbeit, die er abnehmen soll.
//
// 🔴 Deshalb: ein Artikel, den schon eine Linie haelt, wird UEBERSPRUNGEN -- und die Vorschau nennt
// das als eigenen Grund, nicht stillschweigend. Dieselbe Rechnung deckt den zweiten Fall mit ab:
// konkurrieren ZWEI noch unzugewiesene Linien um denselben Artikel, bekommt ihn KEINE. „Lieber
// eine Luecke als eine falsche Identitaet" -- dieselbe sichere Richtung wie beim Kartenlauf.
//
// ⚠️ Verglichen wird ueber avesmapsConflictArticleKey, nicht ueber die rohe Adresse: derselbe
// Artikel steht mal als `/wiki/Madas_Kelch`, mal mit Leerzeichen oder Fragment da, und ein roher
// Stringvergleich liesse genau die Dublette durch, die hier verhindert werden soll. Es ist
// dieselbe Rechnung, mit der das Konfliktzentrum die Gruppen bildet -- also derselbe Massstab, an
// dem der Fall spaeter gemeldet wuerde.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 DER MERKER „KEIN WIKI-ARTIKEL VORHANDEN" WIRD NICHT NACHGEBAUT, SONDERN GEFRAGT
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Eine Zeile mit `properties.wiki_no_article` traegt die ENTSCHEIDUNG eines Menschen, dass es zu
// dieser Linie keinen Artikel gibt; eine Zuweisung widerspraeche ihr. Den Widerspruch entscheidet
// im Haus genau eine Stelle -- avesmapsAssertPowerlineWikiClaimNotContradictory -- und die wird
// hier GEFRAGT, statt die Bedingung ein zweites Mal hinzuschreiben: der Lauf haelt ihr den
// Zustand hin, den er schreiben wuerde, und ueberspringt die Linie, wenn sie ihn ablehnt. Aendert
// sich die Regel je, folgt der Lauf ihr von selbst.
//
// ⚠️ Ja, das benutzt eine Ausnahme als Weiche -- bewusst. Die Alternative waere ein `if
// (!empty($properties['wiki_no_article']))` hier, und damit die zweite Regel, vor der AGENTS.md §5
// warnt: sie ist am Tag ihrer Entstehung richtig und danach nur noch zufaellig.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠️ LAUFZEIT-ABHAENGIGKEITEN, DIE DER AUFRUFER LAEDT (api/edit/map/powerlines.php)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
//   avesmapsWikiSyncCreateMatchKey                    api/_internal/wiki/sync.php
//   avesmapsConflictArticleKey                        api/_internal/conflicts/core.php
//   avesmapsAssertPowerlineWikiClaimNotContradictory  api/_internal/map/features.php
//   avesmapsWikiPowerlineDesiredNestsByMatchKey       api/_internal/wiki/powerlines.php
//   avesmapsWikiDumpSyncKind*                         api/_internal/wiki/dump-sync-kind.php
//   avesmapsNextMapRevision / …EncodeJson / …WriteMapAuditLog / …DecodeJsonColumnForEdit
//                                                     api/_internal/map/features.php
//
// Beim Einbinden ohne Seiteneffekt (nur Funktions- und Konstantendefinitionen), damit
// __tests__/powerline-assign-test.php die reine Entscheidung ohne Datenbank laden kann.

/** Die Protokollzeile, die ein zugewiesenes Segment bekommt. VARCHAR(40) -- 25 Zeichen. */
const AVESMAPS_POWERLINE_ASSIGN_AUDIT_ACTION = 'assign_all_powerline_wiki';

/**
 * REIN: Was wuerde der Massenlauf tun?
 *
 * 🔴 ZWEI DURCHGAENGE, UND DER ZWEITE IST DER GRUND. Der erste sammelt nur VORSCHLAEGE, der zweite
 * entscheidet -- anders liesse sich „zwei unzugewiesene Linien wollen denselben Artikel" gar nicht
 * sehen: wer im ersten Durchgang schon schreibt, hat der zuerst gelesenen Linie den Artikel
 * gegeben, bevor die zweite ueberhaupt drankam. Die Reihenfolge waere dann die Entscheidung, und
 * die Reihenfolge ist die der Datenbank.
 *
 * ⚠️ Die Gruppen werden deshalb auch SORTIERT durchlaufen (ksort): zwei Laeufe auf demselben
 * Bestand muessen dieselbe Vorschau ergeben, sonst ist die Zahl, die der Editor sieht, nicht die
 * Zahl, die er drueckt.
 *
 * @param list<array{id:int, name:string, properties:array}> $segmentRows
 * @param array<string, array{name:string, nest:array}>      $stagedByMatchKey
 * @return array{
 *     writes: list<array{id:int, line:string, wiki_url:string}>,
 *     total_lines:int, lines_affected:int, segments_affected:int, articles_linked:int,
 *     skipped: array{no_match:int, no_article_flag:int, already_assigned:int, article_taken:int},
 *     taken: list<array{line:string, article:string, held_by:string}>
 * }
 */
function avesmapsWikiPowerlineDecideAssignAll(array $segmentRows, array $stagedByMatchKey): array
{
    // 1) Namensgruppen. 💣 Ein Segment OHNE Namen ist KEINE Kraftlinie und darf nicht mit den
    //    uebrigen namenlosen verschmelzen -- dieselbe Regel und derselbe Ersatzschluessel wie im
    //    Abgleich (avesmapsWikiPowerlineDecideSegments); ohne sie zoegen die namenlosen Segmente als
    //    eine einzige Riesenlinie durch die Rechnung.
    $gruppen = [];
    foreach ($segmentRows as $row) {
        $name = trim((string) ($row['name'] ?? ''));
        // 💣 DAS `n:` IST NICHT SCHMUCK. PHP macht aus einem Array-Schluessel, der wie eine ganze
        // Zahl aussieht, eine INT -- eine Kraftlinie namens „7" bekaeme also den Schluessel 7 und
        // nicht "7". Der Vergleich „bin das ich selbst?" in Durchgang zwei laeuft dann zwischen
        // einer int und einem string und ist IMMER wahr: die Linie wuerde ihr eigener Mitbewerber
        // und bliebe als „Artikel schon vergeben" liegen, obwohl niemand mit ihr streitet.
        // Gemessen beim Bau (18.08.2026) an den Namen „7" und „7.": beide wurden uebersprungen,
        // `held_by` nannte die Linie sich selbst. Live gibt es heute keinen solchen Namen -- der
        // Fehler waere also still gewesen und haette auf seinen ersten Namen gewartet.
        // ⚠️ Ein Praefix, nicht strengere Typen an den Closures: die ruft `array_filter` intern
        // auf, dort greift `declare(strict_types=1)` NICHT, und die int wuerde stumm zu "7"
        // gecastet -- genau das hat den Fehler ja erzeugt.
        $schluessel = $name !== '' ? ('n:' . $name) : ('#' . (int) ($row['id'] ?? 0));
        if (!isset($gruppen[$schluessel])) {
            $gruppen[$schluessel] = ['name' => $name, 'rows' => []];
        }
        $gruppen[$schluessel]['rows'][] = $row;
    }
    ksort($gruppen, SORT_STRING);

    // 2) Wer haelt heute schon welchen Artikel? ueber ALLE Linien, auch die, die gleich aus einem
    //    anderen Grund uebersprungen werden -- ein gehaltener Artikel ist gehalten, egal warum
    //    seine Linie nicht am Lauf teilnimmt.
    $gehalten = [];
    foreach ($gruppen as $schluessel => $gruppe) {
        foreach ($gruppe['rows'] as $row) {
            $vorhanden = trim((string) (($row['properties']['wiki_url'] ?? '')));
            if ($vorhanden === '') {
                continue;
            }
            $artikelKey = avesmapsConflictArticleKey($vorhanden);
            if ($artikelKey !== '' && !isset($gehalten[$artikelKey])) {
                // ⚠️ Der Rueckfall ist der SCHLUESSEL, nicht der leere Name: ein namenloses Segment
                // haelt seinen Artikel genauso, und „(hängt an „")" waere in der Rueckfrage keine
                // Auskunft. `#<id>` sagt wenigstens, welches Segment gemeint ist.
                $gehalten[$artikelKey] = $gruppe['name'] !== '' ? $gruppe['name'] : (string) $schluessel;
            }
        }
    }

    // 3) Durchgang eins: Vorschlaege sammeln.
    $skipped = ['no_match' => 0, 'no_article_flag' => 0, 'already_assigned' => 0, 'article_taken' => 0];
    $vorschlaege = [];
    $bewerberJeArtikel = [];
    foreach ($gruppen as $schluessel => $gruppe) {
        $matchKey = avesmapsWikiSyncCreateMatchKey($gruppe['name']);
        $eintrag = ($matchKey !== '' && isset($stagedByMatchKey[$matchKey])) ? $stagedByMatchKey[$matchKey] : null;
        $artikelUrl = $eintrag === null ? '' : trim((string) ($eintrag['nest']['wiki_url'] ?? ''));
        if ($artikelUrl === '') {
            // Kein wortgleicher Artikel im Katalog -- der haeufigste Fall und kein Mangel: die
            // automatisch benannten Linien („Aldyra - Kuslik") koennen gar keinen haben.
            $skipped['no_match']++;
            continue;
        }

        $merker = false;
        foreach ($gruppe['rows'] as $row) {
            if (!empty($row['properties']['wiki_no_article'])) {
                $merker = true;
                break;
            }
        }
        try {
            // Der Hausriegel, nicht seine Abschrift -- Begruendung im Kopf dieser Datei.
            avesmapsAssertPowerlineWikiClaimNotContradictory($artikelUrl, $merker);
        } catch (InvalidArgumentException) {
            $skipped['no_article_flag']++;
            continue;
        }

        $eigeneZuweisung = '';
        foreach ($gruppe['rows'] as $row) {
            $vorhanden = trim((string) (($row['properties']['wiki_url'] ?? '')));
            if ($vorhanden !== '') {
                $eigeneZuweisung = $vorhanden;
                break;
            }
        }
        if ($eigeneZuweisung !== '') {
            // 🔴 ER ERGAENZT NUR, ER ERSETZT NICHT (Owner-Regel 16.08.2026: vorangehakt ist nur das
            // Fuellen einer LUECKE) -- anders als der Wege-Nachbar, der bereits Verknuepftes
            // unbesehen neu schreibt. Auch eine ABWEICHENDE Zuweisung bleibt stehen: sie ist von
            // Hand gesetzt worden, und ein Massenlauf ueberstimmt keine Handarbeit.
            $skipped['already_assigned']++;
            continue;
        }

        $artikelKey = avesmapsConflictArticleKey($artikelUrl);
        $vorschlaege[$schluessel] = [
            'artikel' => trim((string) ($eintrag['name'] ?? '')),
            'wiki_url' => $artikelUrl,
            'artikel_key' => $artikelKey,
        ];
        $bewerberJeArtikel[$artikelKey][] = $schluessel;
    }

    // 4) Durchgang zwei: entscheiden.
    $writes = [];
    $taken = [];
    $artikelGeschrieben = [];
    $linienGeschrieben = 0;
    foreach ($vorschlaege as $schluessel => $vorschlag) {
        $artikelKey = $vorschlag['artikel_key'];
        $haelt = (string) ($gehalten[$artikelKey] ?? '');
        $mitbewerber = array_values(array_filter(
            $bewerberJeArtikel[$artikelKey] ?? [],
            static fn(string $anderer): bool => $anderer !== $schluessel
        ));
        if ($haelt !== '' || $mitbewerber !== []) {
            $skipped['article_taken']++;
            $taken[] = [
                'line' => $gruppen[$schluessel]['name'],
                'article' => $vorschlag['artikel'],
                // Wer haelt ihn? Entweder eine Linie mit fertiger Zuweisung, oder -- im
                // Mehrdeutigkeitsfall -- die Mitbewerber, die ihn ebenso beanspruchen.
                'held_by' => $haelt !== '' ? $haelt : implode(' · ', array_map(
                    static fn(string $anderer): string => $gruppen[$anderer]['name'],
                    $mitbewerber
                )),
            ];
            continue;
        }

        $linienGeschrieben++;
        $artikelGeschrieben[$artikelKey] = true;
        foreach ($gruppen[$schluessel]['rows'] as $row) {
            $writes[] = [
                'id' => (int) ($row['id'] ?? 0),
                'line' => $gruppen[$schluessel]['name'],
                'wiki_url' => $vorschlag['wiki_url'],
            ];
        }
    }

    return [
        'writes' => $writes,
        'total_lines' => count($gruppen),
        'lines_affected' => $linienGeschrieben,
        'segments_affected' => count($writes),
        'articles_linked' => count($artikelGeschrieben),
        'skipped' => $skipped,
        'taken' => $taken,
    ];
}

/**
 * Die Segmente, auf denen der Lauf rechnet. `$forUpdate` sperrt sie fuer den scharfen Lauf.
 *
 * @return list<array{id:int, public_id:string, name:string, properties:array, raw:array}>
 */
function avesmapsWikiPowerlineAssignReadSegments(PDO $pdo, bool $forUpdate): array
{
    $sql = "SELECT id, public_id, name, properties_json, revision
              FROM map_features
             WHERE feature_type = 'powerline' AND is_active = 1";
    $rows = $forUpdate
        ? $pdo->query($sql . ' FOR UPDATE')->fetchAll(PDO::FETCH_ASSOC)
        : $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);

    return array_map(static function (array $row): array {
        return [
            'id' => (int) ($row['id'] ?? 0),
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'properties' => avesmapsDecodeJsonColumnForEdit($row['properties_json'] ?? null),
            'raw' => $row,
        ];
    }, $rows ?: []);
}

/**
 * Der Lauf. ZWEI Aufrufe von aussen: erst `$dryRun = true` (Vorschau mit Zahl), dann nach
 * Zustimmung `$dryRun = false`. Nie eine Schleife ueber den Endpunkt (AGENTS.md §9, STRATO).
 *
 * 💣 DER SCHARFE LAUF RECHNET NEU, ER GLAUBT DER VORSCHAU NICHT. Zwischen beiden Aufrufen steht
 * eine Rueckfrage, also Zeit -- und in der Zeit kann ein zweiter Editor genau die Linie zuweisen,
 * die hier gleich geschrieben wuerde. Die Vorschau ist damit eine Aussage ueber die
 * Vergangenheit; geschrieben wird nach einer Entscheidung auf den mit `FOR UPDATE` gesperrten
 * Zeilen. Dieselbe Trennung wie beim Kartenlauf (dort: PHP-Schleife fuer die Zahlen,
 * WHERE-Klausel fuer die Wirkung) -- nur dass die Zuweisung hier in einem JSON-Feld steht und
 * keine WHERE-Klausel sie pruefen kann. Die zweite Schicht ist deshalb die zweite Rechnung.
 *
 * ⚠️ Die gemeldeten Zahlen des scharfen Laufs sind die der ZWEITEN Rechnung. Weichen sie von der
 * Vorschau ab, hat jemand dazwischen geschrieben -- und genau das soll sichtbar sein.
 *
 * @return array{dry_run:bool, staged:int, total_lines:int, lines_affected:int,
 *               segments_affected:int, articles_linked:int, applied:int, applied_segments:int,
 *               skipped:array, taken:list<array{line:string, article:string, held_by:string}>}
 */
function avesmapsWikiPowerlineAssignAll(PDO $pdo, bool $dryRun, int $userId): array
{
    // Derselbe Katalog wie der Abgleich und wie die Vorschlagsliste des Editors -- ein zweiter
    // Leseweg koennte anderes wissen als der Knopf daneben (siehe api/edit/map/powerlines.php §4).
    $runId = avesmapsWikiDumpSyncKindResolveDumpRunId($pdo);
    $sandboxRows = avesmapsWikiDumpSyncKindFetchRows($pdo, $runId, [AVESMAPS_WIKI_DUMP_ENTITY_POWERLINE], 0, 5000);
    $staged = avesmapsWikiPowerlineDesiredNestsByMatchKey($sandboxRows);

    if ($dryRun) {
        $entscheidung = avesmapsWikiPowerlineDecideAssignAll(
            avesmapsWikiPowerlineAssignReadSegments($pdo, false),
            $staged
        );

        return avesmapsWikiPowerlineAssignResult($entscheidung, count($staged), true, 0, 0);
    }

    $pdo->beginTransaction();
    try {
        $segmente = avesmapsWikiPowerlineAssignReadSegments($pdo, true);
        $entscheidung = avesmapsWikiPowerlineDecideAssignAll($segmente, $staged);
        if ($entscheidung['writes'] === []) {
            $pdo->commit();

            return avesmapsWikiPowerlineAssignResult($entscheidung, count($staged), false, 0, 0);
        }

        $nachId = [];
        foreach ($segmente as $segment) {
            $nachId[$segment['id']] = $segment;
        }

        // EINE Revision fuer den ganzen Lauf, wie avesmapsUpdatePowerlineLine eine je Linie nimmt:
        // der Zaehler ist die Cache-Marke der Kartennutzlast, und 40 Erhoehungen sagen nicht mehr
        // als eine.
        $revision = avesmapsNextMapRevision($pdo);
        $update = $pdo->prepare(
            'UPDATE map_features
                SET properties_json = :properties_json, revision = :revision, updated_by = :updated_by
              WHERE id = :id'
        );

        $geschriebeneSegmente = 0;
        foreach ($entscheidung['writes'] as $write) {
            $segment = $nachId[$write['id']] ?? null;
            if ($segment === null) {
                continue;
            }
            $properties = $segment['properties'];
            $properties['wiki_url'] = $write['wiki_url'];
            $update->execute([
                'id' => $write['id'],
                'properties_json' => avesmapsEncodeJson($properties),
                'revision' => $revision,
                'updated_by' => $userId,
            ]);
            $geschriebeneSegmente += $update->rowCount();
            avesmapsWriteMapAuditLog(
                $pdo,
                $write['id'],
                AVESMAPS_POWERLINE_ASSIGN_AUDIT_ACTION,
                $userId,
                avesmapsEncodeAuditJson($segment['raw']),
                avesmapsEncodeAuditJson([
                    'public_id' => $segment['public_id'],
                    'name' => $write['line'],
                    'wiki_url' => $write['wiki_url'],
                    'properties_json' => $properties,
                    'revision' => $revision,
                ])
            );
        }

        $pdo->commit();

        return avesmapsWikiPowerlineAssignResult(
            $entscheidung,
            count($staged),
            false,
            $entscheidung['lines_affected'],
            $geschriebeneSegmente
        );
    } catch (Throwable $fehler) {
        $pdo->rollBack();
        throw $fehler;
    }
}

/**
 * REIN: die Antwort, die der Endpunkt ausliefert.
 *
 * 🔴 FLACH, und die Schluesselnamen sind der Vertrag mit js/ui/wiki-massenzuweisung.js: `dry_run`
 * (der Rueckleser des scharfen Laufs), `lines_affected`/`articles_linked` (die zwei Zahlen im
 * Knopf) und `applied` (die Zahl in der Statuszeile). Dieselbe Form wie bei Weg, Landschaft und
 * Karte -- nur so faehrt das gemeinsame Bauteil sie unveraendert.
 */
function avesmapsWikiPowerlineAssignResult(
    array $entscheidung,
    int $staged,
    bool $dryRun,
    int $appliedLines,
    int $appliedSegments
): array {
    return [
        'dry_run' => $dryRun,
        'staged' => $staged,
        'total_lines' => (int) $entscheidung['total_lines'],
        'lines_affected' => (int) $entscheidung['lines_affected'],
        'segments_affected' => (int) $entscheidung['segments_affected'],
        'articles_linked' => (int) $entscheidung['articles_linked'],
        // `applied` zaehlt LINIEN -- die Einheit, in der ein Editor denkt und in der auch die
        // Vorschau gezaehlt hat. Die Segmente stehen daneben, weil geschrieben wird dort.
        'applied' => $appliedLines,
        'applied_segments' => $appliedSegments,
        'skipped' => $entscheidung['skipped'],
        'taken' => $entscheidung['taken'],
    ];
}
