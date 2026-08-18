<?php

declare(strict_types=1);

// Lesezugriff auf Flora, Fauna, Spezies und Handelswaren (Abschnitt 2).
// Design: docs/flora-fauna-handelswaren-design.md.
//
// WARUM NICHT WIE DIE ABENTEUER: der Abenteuerkatalog reist komplett zum Client und
// wird dort aggregiert. Das geht bei ~500 Zeilen; hier sind es 5.104 Eintraege,
// 7.748 Ortsverknuepfungen und 34.933 Quellen -- der gleiche Ansatz waere ein
// Payload, den jeder Besucher der Karte bezahlt, um ihn fast nie zu brauchen.
// Deshalb wird PRO ORT gelesen, erst wenn ein Infopanel ihn anfordert.
//
// Side-effect-free on include (nur const + function). Jede Funktion bekommt ihr PDO.

/**
 * Kontinente und Sammelbegriffe, die ueberall gelten und deshalb ZULETZT gereiht
 * werden. Sie werden NICHT verworfen: Wirselkraut steht als „ganz [[Aventurien]]"
 * und waechst damit tatsaechlich auch in Weiden -- wegzuwerfen waere schlicht falsch.
 * Es darf die Liste nur nicht anfuehren.
 */
const AVESMAPS_LORE_CONTINENT_KEYS = [
    'aventurien', 'myranor', 'uthuria', 'rakshazar', 'tharun', 'riesland',
    'guldenland', 'gueldenland', 'ehernes-schwert-kontinent',
];

/** Die vier Sektionen in Anzeigereihenfolge. */
const AVESMAPS_LORE_KINDS = ['flora', 'fauna', 'spezies', 'ware'];

/** Wie viele Eintraege je Sektion das Infopanel zeigt; der Rest liegt hinter „alle anzeigen". */
const AVESMAPS_LORE_PANEL_LIMIT = 10;

/**
 * Reine Torwaechter-Entscheidung des Lesepfads (api/app/lore.php): darf diese Anfrage
 * ueberhaupt bedient werden, oder verdient sie den 400 "place_invalid"? (Task 4b, Schritt 1;
 * territory dazugekommen in Task 9.)
 *
 * VIER bereits genormte Zeichenketten hinein -- der aus $placeKeys zusammengesetzte
 * Ortsschluessel-String, area, location, territory -- ein bool heraus. Keine Seiteneffekte, kein
 * PDO, kein $_GET-Zugriff: darum isoliert testbar ohne HTTP- oder DB-Fixture. Ein brauchbarer
 * Ortsschluessel ODER area ODER location ODER territory genuegt; nur wenn alle vier leer sind, darf
 * der Aufrufer den 400 werfen -- genau fuer Orte OHNE Wiki-Artikel (2.885 von 4.883 Siedlungen,
 * gemessen) ist area/location/territory der EINZIGE Anfragegrund.
 */
function avesmapsLoreRequestHasSubject(
    string $placeKeysJoined,
    string $areaParameter,
    string $locationParameter,
    string $territoryParameter = ''
): bool {
    return $placeKeysJoined !== '' || $areaParameter !== '' || $locationParameter !== '' || $territoryParameter !== '';
}

/**
 * Ist diese Art öffentlich sichtbar? Vier Schalter, einer je Art.
 *
 * Polarität wie bei citymaps_enabled/adventures_enabled: **Default AN**, nur ein
 * ausdrücklich gespeichertes '0' schaltet ab — ein nie geschriebenes Flag funktioniert
 * auf einem frischen Deploy also von selbst. AUSNAHME `spezies`: das Feld „Regionen" der
 * {{Infobox Spezies}} ist im Wiki zu schlecht gepflegt (Owner 2026-07-21), deshalb ist
 * diese eine Art per Default AUS. Vorher stand das als HTML-Kommentar im Markup — jetzt
 * ist es ein Schalter, den der Owner ohne Codeänderung umlegen kann.
 */
function avesmapsLoreKindDefaultEnabled(string $kind): bool
{
    return $kind !== 'spezies';
}

function avesmapsLoreKindSettingKey(string $kind): string
{
    return 'lore_kind_' . $kind . '_enabled';
}

function avesmapsLoreKindEnabled(PDO $pdo, string $kind): bool
{
    $default = avesmapsLoreKindDefaultEnabled($kind);
    if (!function_exists('avesmapsAppSettingGet')) {
        return $default;
    }
    try {
        $raw = trim((string) avesmapsAppSettingGet($pdo, avesmapsLoreKindSettingKey($kind), ''));
    } catch (Throwable) {
        return $default;
    }

    return $raw === '' ? $default : $raw !== '0';
}

/** Alle vier Schalter auf einmal — für den Editor und für das Gate im Lesepfad. */
function avesmapsLoreEnabledKinds(PDO $pdo): array
{
    $out = [];
    foreach (AVESMAPS_LORE_KINDS as $kind) {
        $out[$kind] = avesmapsLoreKindEnabled($pdo, $kind);
    }

    return $out;
}

/**
 * Wann „Natur & Waren syncen" zuletzt durchlief, oder null.
 *
 * Liest dieselbe app_setting-Zeile, die der Reconcile schreibt
 * (AVESMAPS_LORE_LAST_SYNCED_SETTING in wiki/lore-sync.php) -- aber OHNE die
 * Wiki-Bibliothek zu laden. Der öffentliche Lesepfad soll nicht die halbe Sync-Kette
 * mitziehen, nur um einen Zeitstempel anzuzeigen.
 */
function avesmapsLoreReadLastSynced(PDO $pdo): ?string
{
    if (!function_exists('avesmapsAppSettingGet')) {
        return null;
    }
    try {
        $value = trim((string) avesmapsAppSettingGet($pdo, 'lore_last_synced', ''));
    } catch (Throwable) {
        return null;
    }

    return $value === '' ? null : $value;
}

/**
 * Katalogliste für den Editor-Reiter: durchsuchbar, nach Art gefiltert, mit der Zahl
 * der zugeordneten Orte je Eintrag. Bewusst NICHT der Panel-Pfad -- der liest pro Ort,
 * hier will man den Bestand sehen.
 *
 * @return array{items:list<array<string,mixed>>, total:int}
 */
/**
 * Bestand je Art -- die Zahlen an den Unterreitern. Bewusst UNABHÄNGIG von Filter und
 * Suchbegriff: die Reiter sollen zeigen, wie viel es gibt, nicht wie viel gerade
 * gefiltert übrig bleibt. Sonst wandern die Zahlen bei jedem Tastendruck.
 *
 * @return array<string,int>
 */
function avesmapsLoreCountsByKind(PDO $pdo): array
{
    $counts = [];
    foreach (AVESMAPS_LORE_KINDS as $kind) {
        $counts[$kind] = 0;
    }
    try {
        $rows = $pdo->query(
            'SELECT kind, COUNT(*) AS n FROM lore_entry WHERE status = \'active\' GROUP BY kind'
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];
        foreach ($rows as $row) {
            $kind = (string) $row['kind'];
            if (array_key_exists($kind, $counts)) {
                $counts[$kind] = (int) $row['n'];
            }
        }
    } catch (Throwable) {
        // Tabelle fehlt (kein Sync) -> Nullen, keine Ausnahme.
    }

    return $counts;
}

/**
 * Selbstheilend die continent-Spalte auf lore_entry sicherstellen, BEVOR der Katalog sie liest
 * oder filtert. Der Sync legt sie ohnehin an; aber zwischen Deploy und dem ersten „Vorkommen
 * syncen" wuerde ein SELECT e.continent sonst die ganze Liste sprengen. Einmal je Request
 * (static), danach ein billiges SHOW COLUMNS -- und das nur auf dem Editor-Katalogpfad, nicht
 * im heissen ?place=-Pfad (der ruft diese Funktion nicht).
 */
function avesmapsLoreEnsureContinentColumn(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        $exists = $pdo->query("SHOW COLUMNS FROM lore_entry LIKE 'continent'")->fetchAll();
        if (!$exists) {
            $pdo->exec('ALTER TABLE lore_entry ADD COLUMN continent VARCHAR(120) NULL');
        }
    } catch (Throwable) {
        // lore_entry existiert evtl. noch nicht (nie gesynct) -- dann gibt es nichts zu lesen,
        // und avesmapsLoreReadCatalog faengt seinen eigenen Abfragefehler ohnehin ab.
    }
}

/**
 * @param list<string> $continents ausgewaehlte Kontinente ('Aventurien' schliesst leere mit ein)
 * @param list<string> $origins    ausgewaehlte Herkuenfte (wiki|manual|community|…)
 * @param int|null     $hasPlace   1 = nur mit Ortsangabe, 0 = nur ohne, null = egal
 * @param int|null     $hasSource  1 = nur mit Quelle, 0 = nur ohne, null = egal
 */
function avesmapsLoreReadCatalog(
    PDO $pdo,
    string $kind = '',
    string $query = '',
    int $limit = 200,
    int $offset = 0,
    array $continents = [],
    array $origins = [],
    ?int $hasPlace = null,
    ?int $hasSource = null
): array {
    avesmapsLoreEnsureContinentColumn($pdo);

    // BASIS: nur Art + Suche. Die Facetten kommen erst danach dazu -- so zaehlt der Trichter die
    // verfuegbaren Kontinente/Herkuenfte ueber die ganze (Art+Such-)Menge und nicht ueber die schon
    // gefilterte; sonst raeumte eine Auswahl ihre eigenen Alternativen aus der Liste.
    $baseWhere = ["e.status = 'active'"];
    $baseParams = [];
    if ($kind !== '' && in_array($kind, AVESMAPS_LORE_KINDS, true)) {
        $baseWhere[] = 'e.kind = :kind';
        $baseParams['kind'] = $kind;
    }
    $query = trim($query);
    if ($query !== '') {
        // Name ODER Gruppe ODER Synonym: „Hirsch" soll auch die Tiere finden, deren Art das ist.
        // 💣 DREI EIGENE PLATZHALTER, nicht dreimal derselbe: ohne Prepare-Emulation lehnt MySQL
        // einen mehrfach verwendeten benannten Parameter ab. Die erste Fassung tat genau das, der
        // Fehler wurde vom catch unten zu „0 Treffer" verschluckt, und jede Textsuche kam leer
        // zurück -- was aussah, als gäbe es den gesuchten Eintrag nicht.
        $baseWhere[] = '(e.name LIKE :q1 OR e.gruppe LIKE :q2 OR e.synonyme LIKE :q3)';
        $baseParams['q1'] = '%' . $query . '%';
        $baseParams['q2'] = '%' . $query . '%';
        $baseParams['q3'] = '%' . $query . '%';
    }

    // FACETTEN oben drauf: Kontinent / Herkunft / Ortsangabe / Quelle.
    $where = $baseWhere;
    $params = $baseParams;

    $continents = array_values(array_filter(array_map(static fn ($v) => trim((string) $v), $continents), static fn ($v) => $v !== ''));
    if ($continents !== []) {
        $placeholders = [];
        foreach ($continents as $i => $value) {
            $placeholders[] = ':cont' . $i;
            $params['cont' . $i] = $value;
        }
        $clause = 'e.continent IN (' . implode(', ', $placeholders) . ')';
        // „Aventurien" schliesst die (noch) leeren Kontinente ein -- vor dem ersten scharfen Sync
        // ist alles leer, und leer IST Aventurien (die Karten-Identitaet, wie ueberall).
        if (in_array('Aventurien', $continents, true)) {
            $clause = '(' . $clause . " OR e.continent IS NULL OR e.continent = '')";
        }
        $where[] = $clause;
    }

    $origins = array_values(array_filter(array_map(static fn ($v) => trim((string) $v), $origins), static fn ($v) => $v !== ''));
    if ($origins !== []) {
        $placeholders = [];
        foreach ($origins as $i => $value) {
            $placeholders[] = ':orig' . $i;
            $params['orig' . $i] = $value;
        }
        $where[] = 'e.origin IN (' . implode(', ', $placeholders) . ')';
    }

    if ($hasPlace !== null) {
        $existsPlace = 'EXISTS (SELECT 1 FROM lore_place lp'
            . ' WHERE lp.entry_wiki_key = e.wiki_key AND lp.status = \'active\')';
        $where[] = $hasPlace === 1 ? $existsPlace : 'NOT ' . $existsPlace;
    }

    if ($hasSource !== null) {
        // 💣 KEIN Spalten-zu-Spalten-Vergleich (fs.entity_public_id = e.wiki_key): feature_sources
        // traegt die utf8mb4-DEFAULT-Kollation, lore_entry explizit utf8mb4_unicode_ci -- ein direkter
        // Vergleich wirft „Illegal mix of collations", und der catch unten machte daraus stille 0
        // Treffer (has_place funktioniert, weil lore_place dieselbe Kollation wie lore_entry hat).
        // Ueber einen IN-Teilquery mit COLLATE im SELECT ist die Kollation eindeutig, und die
        // Unterabfrage wird EINMAL materialisiert statt je Zeile ausgewertet. entity_public_id ist
        // NOT NULL, also ist auch NOT IN gefahrlos (kein NULL-Fallstrick).
        $sourceSubquery = '(SELECT fs.entity_public_id COLLATE utf8mb4_unicode_ci FROM feature_sources fs'
            . ' WHERE fs.entity_type = \'lore\' AND fs.status = \'approved\')';
        $where[] = ($hasSource === 1 ? 'e.wiki_key IN ' : 'e.wiki_key NOT IN ') . $sourceSubquery;
    }

    $whereSql = implode(' AND ', $where);
    $baseWhereSql = implode(' AND ', $baseWhere);
    $limit = max(1, min(500, $limit));
    $offset = max(0, $offset);

    try {
        $countStatement = $pdo->prepare('SELECT COUNT(*) FROM lore_entry e WHERE ' . $whereSql);
        $countStatement->execute($params);
        $total = (int) $countStatement->fetchColumn();

        // 💣 KEINE korrelierten Unterabfragen je Zeile. Die erste Fassung hatte DREI --
        // bei 200 Zeilen also 600 Abfragen für eine Liste. Stattdessen: erst die
        // Einträge, dann Orte und Quellen für genau diese Schlüssel in je EINER
        // Abfrage. Drei Abfragen statt sechshundert, unabhängig von der Seitengröße.
        $statement = $pdo->prepare(
            'SELECT e.wiki_key, e.kind, e.name, e.wiki_url, e.gruppe, e.typ, e.lebensraum, e.origin, e.continent
             FROM lore_entry e
             WHERE ' . $whereSql . '
             ORDER BY e.name
             LIMIT ' . $limit . ' OFFSET ' . $offset
        );
        $statement->execute($params);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $keys = array_column($rows, 'wiki_key');
        $placesByEntry = [];
        $placeKeysByEntry = [];
        $allPlaceKeys = [];
        $sourceCounts = [];
        if ($keys !== []) {
            $in = implode(',', array_fill(0, count($keys), '?'));

            // Die Orte SELBST, nicht nur ihre Zahl: „Weiden, Kosch, Nordmarken" sagt
            // etwas, „3 Orte" nichts.
            // 💣 `place_wiki_key` reist seit 18.08.2026 mit, und zwar UNGEKAPPT -- die Titel
            //    daneben sind auf 6 gedeckelt (Zeile darunter), der Statuskreis darf das nicht
            //    sein: sein „voll" braucht EINEN verorteten Ort, und der kann der siebte sein.
            //    Deshalb wird der Kreis aus dieser vollständigen Schlüsselliste gerechnet und
            //    nicht aus `places`.
            $placeStatement = $pdo->prepare(
                'SELECT entry_wiki_key, place_title, place_wiki_key FROM lore_place
                 WHERE status = \'active\' AND entry_wiki_key IN (' . $in . ')
                 ORDER BY entry_wiki_key, sort_order'
            );
            $placeStatement->execute($keys);
            foreach ($placeStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                $entry = (string) $row['entry_wiki_key'];
                $placesByEntry[$entry][] = (string) $row['place_title'];
                $placeKey = avesmapsLoreStripKeyPrefix((string) $row['place_wiki_key']);
                $placeKeysByEntry[$entry][] = $placeKey;
                if ($placeKey !== '') {
                    $allPlaceKeys[$placeKey] = true;
                }
            }

            // Quellen aus dem GETEILTEN System (seit 2026-07-22, AGENTS.md §5): ein
            // Lore-Eintrag haengt dort als entity_type='lore' mit seinem wiki_key als
            // entity_public_id -- Lore hat keine eigene public_id, sein Schluessel IST sie.
            // Weiterhin EINE Abfrage fuer die ganze Seite, kein N+1.
            $sourceStatement = $pdo->prepare(
                'SELECT entity_public_id, COUNT(*) AS n FROM feature_sources
                 WHERE entity_type = \'lore\' AND status = \'approved\'
                   AND entity_public_id IN (' . $in . ')
                 GROUP BY entity_public_id'
            );
            $sourceStatement->execute($keys);
            foreach ($sourceStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                $sourceCounts[(string) $row['entity_public_id']] = (int) $row['n'];
            }
        }

        // Trichter-Optionen: verfuegbare Kontinente und Herkuenfte MIT Zaehlern -- ueber die BASIS
        // (Art+Suche), nicht ueber die Facetten, damit eine Auswahl ihre eigenen Alternativen nicht
        // aus dem Trichter raeumt. Nur beim Erst-Laden (offset 0): auf Scroll-Folgeseiten aendern
        // sie sich nicht und kosten dort nur zwei Aggregate umsonst.
        $continentOptions = [];
        $originOptions = [];
        if ($offset === 0) {
            $contStatement = $pdo->prepare(
                "SELECT COALESCE(NULLIF(e.continent, ''), 'Aventurien') AS value, COUNT(*) AS n
                 FROM lore_entry e WHERE " . $baseWhereSql . "
                 GROUP BY value ORDER BY (value = 'Aventurien') DESC, value"
            );
            $contStatement->execute($baseParams);
            foreach ($contStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $r) {
                $continentOptions[] = ['value' => (string) $r['value'], 'count' => (int) $r['n']];
            }
            $originStatement = $pdo->prepare(
                'SELECT e.origin AS value, COUNT(*) AS n FROM lore_entry e WHERE ' . $baseWhereSql . '
                 GROUP BY value ORDER BY n DESC'
            );
            $originStatement->execute($baseParams);
            foreach ($originStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $r) {
                $value = trim((string) ($r['value'] ?? ''));
                if ($value !== '') {
                    $originOptions[] = ['value' => $value, 'count' => (int) $r['n']];
                }
            }
        }
    } catch (Throwable $error) {
        // NICHT still auf 0 Treffer zurückfallen: ein Abfragefehler sieht dann exakt
        // aus wie „gibt es nicht", und man sucht ihn an der falschen Stelle. Genau das
        // ist mit dem mehrfach verwendeten Platzhalter oben passiert. Die Meldung geht
        // an den Aufrufer, nicht in die Antwort -- sie kann Schemadetails enthalten.
        error_log('lore catalog query failed: ' . $error->getMessage());

        return ['items' => [], 'total' => 0, 'failed' => true];
    }

    // Welche der genannten Orte liegen wirklich auf der Karte? Der Statuskreis der Vorkommen-Liste
    // hängt daran (siehe avesmapsLoreReadPlaceKeysOnMap). EINE Abfragegruppe für die ganze Seite,
    // nie eine je Zeile.
    // ⚠️ Ausserhalb des try/catch oben: der Leser fängt selbst und liefert im Zweifel weniger
    //    Schlüssel, und das ist die sichere Richtung -- ein Eintrag wird dann als „nicht verortet"
    //    gezeigt statt fälschlich als erledigt. Ein Fehler hier darf die Liste nicht kosten.
    $placeKeysOnMap = avesmapsLoreReadPlaceKeysOnMap($pdo, array_keys($allPlaceKeys));
    // Und die Regeln: eine Lebensraum-Regel mit Verbreitung ist ein gleichwertiges Vorkommen
    // (Owner 18.08.2026, siehe avesmapsLoreReadRuleCountsByEntry). Hat kein Eintrag dieser Seite
    // eine, kostet der Aufruf genau EINE indizierte Abfrage.
    $ruleCounts = avesmapsLoreReadRuleCountsByEntry($pdo, $keys);

    $items = [];
    foreach ($rows as $row) {
        $entryKey = (string) $row['wiki_key'];
        $mappedPlaces = 0;
        foreach ($placeKeysByEntry[$entryKey] ?? [] as $placeKey) {
            if ($placeKey !== '' && isset($placeKeysOnMap[$placeKey])) {
                $mappedPlaces++;
            }
        }
        $items[] = [
            'wiki_key' => (string) $row['wiki_key'],
            'kind' => (string) $row['kind'],
            'name' => (string) $row['name'],
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'gruppe' => (string) ($row['gruppe'] ?? ''),
            'typ' => (string) ($row['typ'] ?? ''),
            'lebensraum' => (string) ($row['lebensraum'] ?? ''),
            'origin' => (string) ($row['origin'] ?? 'wiki'),
            'continent' => (string) ($row['continent'] ?? ''),
            'place_count' => count($placesByEntry[(string) $row['wiki_key']] ?? []),
            // Auf 6 gekappt: eine Zeile soll die Gegend andeuten, nicht 40 Orte
            // ausbreiten. Der Rest steht als Zahl dahinter.
            'places' => array_slice($placesByEntry[(string) $row['wiki_key']] ?? [], 0, 6),
            // Wieviele der genannten Orte auf der Karte liegen. 🔴 Gerechnet über ALLE Ortszeilen,
            // nicht über die auf 6 gekappte Titelliste darüber.
            'place_mapped_count' => $mappedPlaces,
            // Regeln als Vorkommen: wie viele der Eintrag hat und wie viele davon etwas treffen.
            // 🔴 ZWEI EIGENE FELDER statt einer Addition auf `place_count` -- die Meta-Zeile der
            // Liste baut ihren „+N"-Zaehler daraus („Weiden, Kosch +3"), und eine Regel ist dort
            // kein Ortsname. Addiert wird erst im Zeilenbauer, fuer den Kreis.
            'rule_count' => (int) ($ruleCounts[$entryKey]['rules'] ?? 0),
            'rule_mapped_count' => (int) ($ruleCounts[$entryKey]['matched'] ?? 0),
            'source_count' => $sourceCounts[(string) $row['wiki_key']] ?? 0,
        ];
    }

    return [
        'items' => $items,
        'total' => $total,
        // Fuer den Trichter: verfuegbare Werte mit Zaehlern (nur bei offset 0 befuellt).
        'continents' => $continentOptions,
        'origins' => $originOptions,
    ];
}

/**
 * WELCHE ORTSSCHLÜSSEL LIEGEN AUF DER KARTE? Die Datengrundlage des Statuskreises der
 * Vorkommen-Liste (Owner 18.08.2026: „halbgefüllt, wenn sie vorkommen aber nicht mit einem ort
 * oder einer region auf der karte zugewiesen sind (z.b. schiff), voll wenn sie auf der karte
 * irgendwo vorkommen").
 *
 * 💣 EINE Ortszeile hat KEIN aufgelöstes Ziel. `lore_place` speichert nur `place_wiki_key` +
 *    `place_title`; die Verbindung zu einem Kartenobjekt entsteht erst beim Lesen, über den
 *    Wiki-Schlüssel des Objekts (siehe avesmapsLoreReadForPlaces und der Kopf von
 *    api/_internal/app/lore-search.php). Diese Funktion dreht genau diese Frage um.
 *
 * 🔴 VIER Familien, und genau die vier, die die Lore-Anfrage auch bedienen kann:
 *      Ort               `map_features.properties.wiki_settlement.wiki_key`   (blanker Slug)
 *      Landschaftslabel  `map_features.properties.wiki_region.wiki_key`       (blanker Slug)
 *      Landschaftsfläche `ecosystem_region.wiki_region_key`                   (blanker Slug)
 *      Herrschaftsgebiet `political_territory.wiki_key`                       (mit `wiki:`/`name:`)
 *    Alle vier stehen im SELBEN Schlüsselraum wie `lore_place.place_wiki_key`
 *    (avesmapsPoliticalSlug über avesmapsFoldToAscii, AGENTS.md §5) -- deshalb genügt ein
 *    Gleichheitsvergleich und es wird nirgends geraten.
 * 💣 GEMESSEN WIRD DAS ZUWEISUNGSFELD, nie das danebenstehende `properties.wiki_url`: der
 *    öffentliche Lesepfad füllt jenes bei Leere per Namensraten nach (99 Phantome bei den Orten,
 *    AGENTS.md §11). Der Nest-Schlüssel entsteht dagegen nur beim Zuweisen.
 * ⚠️ KEIN Namensvergleich und kein Abschneiden von Klammerzusätzen. Der Spotlight-Löser
 *    (`resolveSpotlightLorePlace`) kennt beides, weil er einen ANFLUGPUNKT sucht und ein
 *    Beinahe-Treffer dort besser ist als keiner. Hier steht die Frage „ist das zugewiesen?", und
 *    eine Vermutung wäre die falsche Antwort. Der Preis ist gemessen und klein: 8 Ortstitel im
 *    Livebestand tragen einen Klammerzusatz, den die Karte ohne führt („Aventurien (Kontinent)",
 *    „Nostria (Siedlung)"), und sie färben 3 von 5104 Einträgen halb statt voll (18.08.2026).
 * ⚠️ Wege sind NICHT dabei, und das ist kein Versehen: „Der Große Fluss" und „Szinto" liegen als
 *    `Flussweg` auf der Karte, sind aber weder Ort noch Region -- der Owner-Satz nennt genau die
 *    zwei. Ein Weg hat auch keine Vorkommen-Sektion in seiner Infobox.
 * ⚠️ PERF: die dritte Abfrage liest `properties_json` aller Orte und Labels (rund 6,7 MB
 *    Payload-Äquivalent, 18.08.2026 gemessen). Das ist der Preis dafür, dass die Zuweisung im JSON
 *    liegt und nicht in einer Spalte; `avesmapsWikiSettlementCollectConnectTargets`
 *    (api/_internal/wiki/settlements.php) zahlt ihn längst und dekodiert sogar in PHP. Sie läuft
 *    EINMAL je Katalogseite, nie je Zeile. 🔧 Bräuchte es je einen Cache, wäre `map_revision` sein
 *    Schlüssel.
 * 💣 MySQL-Form: `JSON_UNQUOTE(JSON_EXTRACT(...))` kennt SQLite nicht (dort liefert `json_extract`
 *    schon unquotiert). Verbogen wird nichts -- gilt MySQL (AGENTS.md §9); geprüft wird stattdessen
 *    die REGEL, die die Zahlen zu einem Zustand macht, und die ist rein.
 *
 * @param list<string> $placeKeys blanke Ortsschlüssel (ohne `wiki:`/`name:`)
 * @return array<string,true> die Teilmenge, die auf der Karte liegt
 */
function avesmapsLoreReadPlaceKeysOnMap(PDO $pdo, array $placeKeys): array
{
    $keys = [];
    foreach ($placeKeys as $key) {
        $key = avesmapsLoreStripKeyPrefix((string) $key);
        if ($key !== '' && mb_strlen($key, 'UTF-8') <= 190) {
            $keys[$key] = true;
        }
    }
    if ($keys === []) {
        return [];
    }
    $keys = array_keys($keys);
    $in = implode(',', array_fill(0, count($keys), '?'));
    $found = [];

    // (1) Herrschaftsgebiet. `political_territory.wiki_key` trägt ein Präfix
    // (avesmapsPoliticalBuildWikiKey: `wiki:` mit Artikel, `name:` ohne). BEIDE werden gefragt,
    // weil der Lesepfad des Panels sie ebenfalls beide strippt (avesmapsLoreStripKeyPrefix) -- ein
    // Gebiet ohne Wiki-Artikel zeigt seine Vorkommen genauso.
    $prefixed = [];
    foreach ($keys as $key) {
        $prefixed[] = 'wiki:' . $key;
        $prefixed[] = 'name:' . $key;
    }
    try {
        $statement = $pdo->prepare(
            'SELECT wiki_key FROM political_territory
             WHERE is_active = 1 AND wiki_key IN (' . implode(',', array_fill(0, count($prefixed), '?')) . ')'
        );
        $statement->execute($prefixed);
        foreach ($statement->fetchAll(PDO::FETCH_COLUMN) ?: [] as $value) {
            $found[avesmapsLoreStripKeyPrefix((string) $value)] = true;
        }
    } catch (Throwable) {
        // Tabelle fehlt (frische Installation) -> diese Familie trägt nichts bei.
    }

    // (2) Landschaftsfläche.
    try {
        $statement = $pdo->prepare(
            'SELECT DISTINCT wiki_region_key FROM ecosystem_region
             WHERE is_active = 1 AND wiki_region_key IN (' . $in . ')'
        );
        $statement->execute($keys);
        foreach ($statement->fetchAll(PDO::FETCH_COLUMN) ?: [] as $value) {
            $found[(string) $value] = true;
        }
    } catch (Throwable) {
    }

    // (3) Ort und (4) Landschaftslabel -- beide im `properties_json` von `map_features`, aber in
    // verschiedenen Nestern und auf verschiedenen `feature_type` (gemessen 18.08.2026: 1914 Orte
    // tragen `wiki_settlement`, 629 Labels `wiki_region`, und keins der beiden Nester steht je auf
    // dem anderen Typ).
    // 💣 Die Schreibweise ist die des Hauses, nicht erfunden: `place-kinds.php:58` und
    //    `features.php:2429` fragen `JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.…'))` genauso.
    //    Der Pfad ist ein Literal, keine Eingabe -- interpoliert wird hier nichts.
    // ⚠️ Und der Fehlschlag wird PROTOKOLLIERT, nicht bloss geschluckt: ein stiller `catch` macht
    //    aus einem SQL-Fehler eine Liste, in der jede Zeile „nicht verortet" sagt -- von einem
    //    echten Befund nicht zu unterscheiden. Genau diese Falle kostete am 15.08.2026 sechs
    //    grüne Prüfläufe („Was ist hier?", HY093).
    foreach ([
        ['location', "JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.wiki_settlement.wiki_key'))"],
        ['label', "JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.wiki_region.wiki_key'))"],
    ] as [$featureType, $expression]) {
        try {
            $statement = $pdo->prepare(
                'SELECT DISTINCT ' . $expression . ' AS wiki_key FROM map_features
                 WHERE is_active = 1 AND feature_type = ?
                   AND ' . $expression . ' IN (' . $in . ')'
            );
            $statement->execute(array_merge([$featureType], $keys));
            foreach ($statement->fetchAll(PDO::FETCH_COLUMN) ?: [] as $value) {
                $found[avesmapsLoreStripKeyPrefix((string) $value)] = true;
            }
        } catch (Throwable $error) {
            error_log('lore place-on-map lookup (' . $featureType . ') failed: ' . $error->getMessage());
        }
    }

    unset($found['']);

    return $found;
}

/**
 * WELCHE EINTRÄGE HABEN EINE REGEL -- UND TRIFFT SIE ETWAS?
 *
 * Owner 18.08.2026: „beachte auch, dass regeln (sofern vorhanden und mit verbreitung) gültige
 * vorkommen sind". Eine Lebensraum-Regel („alle Wälder der gemäßigten Zone") ist im Kasten
 * „Vorkommen" gleichberechtigt neben einer Ortszeile -- der zweite Knopf dort heißt „+ Regel".
 *
 * 🔴 SIE ÄNDERT NUR, WAS ALS VORKOMMEN ZÄHLT, NIE DIE DREI STUFEN. Der Zustand bleibt
 *    voll = mindestens eines liegt auf der Karte · halb = vorhanden, keines verortet ·
 *    leer = gar keines. Ein Eintrag ohne Ortszeile, aber mit Regel, ist damit mindestens HALB --
 *    nie mehr leer.
 * 💣 `relation = 'verbreitung'` ist die Bedingung des Owners („sofern vorhanden UND mit
 *    verbreitung"), und sie steht hier, obwohl der Regel-Editor heute gar nichts anderes
 *    schreiben kann: `avesmapsLoreRuleEditor.relation` startet auf `"verbreitung"` und keine
 *    Oberfläche ändert es (`js/review/review-lore-rule.js`). Die SPALTE kennt vier Werte
 *    (avesmapsLoreNormalizeRelation: verbreitung|vorkommen|herkunft|regionen) -- kommt je ein
 *    Wähler dazu, gilt die Regel des Owners von selbst weiter.
 *
 * 🔴 EIN Treffer IST auf der Karte, per Konstruktion -- hier wird nichts nachgeschlagen.
 *    `avesmapsLoreRuleReadAreas` liest `ecosystem_region WHERE is_active = 1 AND kind <> 'klima'`,
 *    also gezeichnete Landschaftsflächen. Das ist dieselbe Familie, gegen die
 *    avesmapsLoreReadPlaceKeysOnMap eine Ortszeile prüft -- nur kommt die Fläche hier schon als
 *    Objekt heraus statt als Schlüssel. ⚠️ Deshalb zählt ein Treffer auch OHNE
 *    `wiki_region_key`: live tragen 561 der 929 Flächen keinen, und sie liegen trotzdem auf der
 *    Karte (Alprutes Regel trifft 119 Wälder, davon viele namenlose „Wald-041").
 *
 * ⭐ DIE KETTENAUSWERTUNG WIRD NICHT NACHGEBAUT. `avesmapsLoreRuleChainMatchesSubject`
 *    (lore-rule-match.php) ist die einzige Stelle, an der die UND/ODER-Kette gelesen wird; diese
 *    Funktion ist ihr dritter AUFRUFER neben avesmapsLoreRuleEntriesForSubjects und
 *    avesmapsFetchLoreRulePlacesByEntry. Eine zweite Lesart der Präzedenz hätte Liste und
 *    Infobox lautlos auseinanderlaufen lassen -- der Grund, aus dem die Kette schon einmal
 *    zusammengezogen wurde.
 *
 * 💣 DER KURZSCHLUSS TRÄGT DIE KOSTEN. Die erste Abfrage ist indiziert
 *    (`idx_lore_rule_entry`) und winzig; hat KEIN Eintrag dieser Seite eine Regel, ist hier
 *    Schluss und nichts weiter wird gelesen. Live ist das der Normalfall: von 5104 Einträgen
 *    trägt am 18.08.2026 genau EINER eine Regel („Alprute"), gemessen über 24 Sonden
 *    `?area=<region_public_id>`, eine je Landschaftsart.
 *
 * ⚠️ Der Rechenstand (`ecosystem_assignment_stamp.completed`) gilt NUR für die zweite Zahl.
 *    Dass eine Regel DA ist, hängt an keinem Lauf -- dass sie etwas TRIFFT, sehr wohl: während
 *    „Zugehörigkeit rechnen" läuft, sind die Flächentabellen leer. Ein Eintrag fällt dann von
 *    voll auf halb, nie auf leer. Dieselbe Trennung wie in avesmapsFetchLoreRulePlacesByEntry
 *    (lore-search.php), wo die Zonen vor und die Flächen hinter dem Stempel stehen.
 *
 * @param list<string> $entryKeys
 * @return array<string, array{rules: int, matched: int}>
 */
function avesmapsLoreReadRuleCountsByEntry(PDO $pdo, array $entryKeys): array
{
    $keys = [];
    foreach ($entryKeys as $key) {
        $key = trim((string) $key);
        if ($key !== '') {
            $keys[$key] = true;
        }
    }
    if ($keys === []) {
        return [];
    }
    $keys = array_keys($keys);

    try {
        $statement = $pdo->prepare(
            "SELECT entry_wiki_key, COUNT(*) AS n FROM lore_rule
              WHERE status = 'active' AND relation = 'verbreitung'
                AND entry_wiki_key IN (" . implode(',', array_fill(0, count($keys), '?')) . ')
              GROUP BY entry_wiki_key'
        );
        $statement->execute($keys);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable) {
        return []; // Tabelle fehlt (Regeln nie benutzt) -> kein Regelzweig, kein Fehler
    }

    $out = [];
    foreach ($rows as $row) {
        $out[(string) $row['entry_wiki_key']] = ['rules' => (int) $row['n'], 'matched' => 0];
    }
    if ($out === []) {
        return []; // DER Kurzschluss: nichts weiter wird gelesen
    }

    // 🔴 Nackter SELECT, nie avesmapsEcosystemEnsureTables -- dessen information_schema-Sonden
    // sind die Last, die den PHP-Worker-Pool am 17.07.2026 erschöpft hat (AGENTS.md §10).
    try {
        $stampStatement = $pdo->query('SELECT completed FROM ecosystem_assignment_stamp WHERE id = 1');
        $stampValue = $stampStatement === false ? false : $stampStatement->fetchColumn();
        if ($stampValue === false || (int) $stampValue !== 1) {
            return $out; // Regeln da, Flächen (noch) nicht gerechnet -> halb, nicht leer
        }
    } catch (Throwable) {
        return $out;
    }

    $rules = avesmapsLoreRuleReadAllActive($pdo);
    if ($rules === []) {
        return $out;
    }
    $areas = avesmapsLoreRuleReadAreas($pdo);
    if ($areas === []) {
        return $out;
    }
    // Einmal je Aufruf, nie je Fläche und nie je Regel -- dieselbe Regel wie in den zwei
    // Geschwister-Aufrufern.
    $orderedZoneKeys = avesmapsLoreRuleOrderedZoneKeys($pdo);

    // Nur die Regeln der Einträge DIESER Seite, und nur mit Verbreitung.
    $relevant = [];
    foreach ($rules as $rule) {
        $entryKey = (string) ($rule['entry_wiki_key'] ?? '');
        if (isset($out[$entryKey]) && (string) ($rule['relation'] ?? '') === 'verbreitung') {
            $relevant[] = $rule;
        }
    }
    if ($relevant === []) {
        return $out;
    }

    // ⚠️ Gezählt werden die REGELN, die etwas treffen, nicht die getroffenen Flächen. Für den
    // Kreis genügt „mindestens eine" -- und eine Regel, die 119 Wälder trifft, ist EIN Vorkommen,
    // nicht 119. Sonst stünde in `place_mapped_count` eine Zahl, die niemand erklären kann.
    $matchedRuleIds = [];
    foreach ($areas as $area) {
        $subject = avesmapsLoreRuleSubjectFromArea($area);
        foreach ($relevant as $index => $rule) {
            if (isset($matchedRuleIds[$index])) {
                continue; // diese Regel trifft schon -- ein zweiter Treffer ändert nichts
            }
            if (avesmapsLoreRuleChainMatchesSubject($rule['terms'], $subject, $orderedZoneKeys)) {
                $matchedRuleIds[$index] = true;
                $out[(string) $rule['entry_wiki_key']]['matched']++;
            }
        }
    }

    return $out;
}

/**
 * Löst freie Warennamen gegen den Katalog auf: „Salz" -> Artikel, „Vieh" -> nichts.
 *
 * Wozu: die Infobox-Zeile „Handelswaren" ist FREITEXT aus {{Infobox Staat}}, und der
 * Wiki-Sync hat etwaige Links darin längst zu bloßem Text aufgelöst. Wer die Liste mit
 * den katalogisierten Waren zu EINER Zeile verschmelzen will, braucht für jeden Namen
 * die Antwort: gibt es dazu einen Artikel? Genau das liefert diese Funktion --
 * Gattungen wie „Vieh" oder „Holz" bleiben erwartungsgemäß ohne Treffer.
 *
 * @param list<string> $names
 * @return array<string,array{name:string,wiki_url:string,gruppe:string}> Eingabename => Treffer
 */
function avesmapsLoreResolveGoodsByName(PDO $pdo, array $names): array
{
    $clean = [];
    foreach ($names as $name) {
        $name = trim((string) $name);
        if ($name !== '' && mb_strlen($name, 'UTF-8') <= 190 && !in_array($name, $clean, true)) {
            $clean[] = $name;
        }
    }
    if ($clean === []) {
        return [];
    }
    $clean = array_slice($clean, 0, 60); // eine Infobox-Zeile ist nie länger

    try {
        $in = implode(',', array_fill(0, count($clean), '?'));
        // Über match_key vergleichen, nicht über name: der faltet Groß/Klein, Umlaute
        // und Sonderzeichen -- „Leinöl" trifft dann auch „Leinoel".
        $statement = $pdo->prepare(
            'SELECT name, match_key, wiki_url, gruppe FROM lore_entry
             WHERE kind = \'ware\' AND status = \'active\' AND match_key IN (' . $in . ')'
        );
        $keys = array_map(static fn(string $n): string => avesmapsLoreMatchKey($n), $clean);
        $statement->execute($keys);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $error) {
        error_log('lore goods resolve failed: ' . $error->getMessage());

        return [];
    }

    $byKey = [];
    foreach ($rows as $row) {
        $key = (string) $row['match_key'];
        if (!isset($byKey[$key])) {
            $byKey[$key] = [
                'name' => (string) $row['name'],
                'wiki_url' => (string) ($row['wiki_url'] ?? ''),
                'gruppe' => (string) ($row['gruppe'] ?? ''),
            ];
        }
    }

    $out = [];
    foreach ($clean as $name) {
        $hit = $byKey[avesmapsLoreMatchKey($name)] ?? null;
        if ($hit !== null) {
            $out[$name] = $hit;
        }
    }

    return $out;
}

/**
 * Vergleichsschlüssel eines Warennamens. Bildet avesmapsWikiSyncCreateMatchKey nach,
 * damit der Abgleich zu den beim Sync geschriebenen match_key-Werten passt.
 */
function avesmapsLoreMatchKey(string $value): string
{
    if (function_exists('avesmapsWikiSyncCreateMatchKey')) {
        return avesmapsWikiSyncCreateMatchKey($value);
    }
    $key = mb_strtolower(trim($value), 'UTF-8');
    $key = strtr($key, ['ä' => 'a', 'ö' => 'o', 'ü' => 'u', 'ß' => 'ss']);

    return (string) preg_replace('/[^a-z0-9]+/u', '', $key);
}

/** Normalisiert einen Server-wiki_key ('wiki:weiden') auf die Form in lore_place ('weiden'). */
function avesmapsLoreStripKeyPrefix(string $key): string
{
    $key = mb_strtolower(trim($key), 'UTF-8');
    foreach (['wiki:', 'name:'] as $prefix) {
        if (str_starts_with($key, $prefix)) {
            $key = substr($key, strlen($prefix));
        }
    }

    return trim($key);
}

/**
 * Wiki-Titel -> Ortsschlüssel. Bildet avesmapsPoliticalSlug nach (Umlaute werden
 * transliteriert), damit die Schlüssel zu denen aus lore-sync.php passen.
 */
function avesmapsLoreSlugForTitle(string $title): string
{
    if (function_exists('avesmapsPoliticalSlug')) {
        return avesmapsPoliticalSlug(trim($title));
    }
    $slug = mb_strtolower(trim($title), 'UTF-8');
    $slug = strtr($slug, ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss']);
    $slug = preg_replace('/[^a-z0-9]+/u', '-', $slug) ?? '';

    return trim((string) $slug, '-');
}

/**
 * Ortsschlüssel aus einem Feldwert.
 *
 * 💣 political_territory_wiki.geographic enthält KEIN Wiki-Markup mehr: der
 * Territorien-Parser (avesmapsPoliticalReadWikiString) hat die Links längst zu
 * Klartext aufgelöst. Gemessen 2026-07-21 steht dort schlicht "Albernia", nicht
 * "[[Albernia]]". Ein reiner Wikilink-Extraktor findet dort NICHTS -- genau daran
 * ist die erste Fassung der Aggregation gescheitert.
 *
 * Deshalb beide Formen: sind Links da, gewinnen sie (präziser, weil das Linkziel der
 * echte Seitentitel ist); sonst wird der Klartext an ;/, getrennt und geslugged.
 */
function avesmapsLoreKeysFromWikiField(string $value): array
{
    $value = trim($value);
    if ($value === '') {
        return [];
    }

    $out = [];
    $add = static function (string $title) use (&$out): void {
        $slug = avesmapsLoreSlugForTitle($title);
        if ($slug !== '' && !in_array($slug, $out, true)) {
            $out[] = $slug;
        }
    };

    if (str_contains($value, '[[')
        && preg_match_all('/\[\[\s*([^\]\|#<>\[]+?)\s*(?:#[^\]\|]*)?(?:\|[^\]]*)?\]\]/u', $value, $matches) >= 1) {
        foreach ($matches[1] as $title) {
            $add((string) $title);
        }

        return $out;
    }

    // Klartext: "Mittelaventurien; Weiden" -> zwei Schlüssel. Ein etwaiges
    // "Feldname:"-Präfix fällt weg, sonst wird die Beschriftung Teil des Ortsnamens.
    foreach (preg_split('/\s*[;,]\s*/u', $value) ?: [] as $part) {
        $part = trim((string) preg_replace('/^[^:]{0,24}:\s*/u', '', trim($part)));
        if ($part !== '') {
            $add($part);
        }
    }

    return $out;
}

/**
 * Erweitert EINEN Ortsschlüssel um alles, was inhaltlich dazugehört, mit Rang:
 *
 *   0  der Ort selbst
 *   1  ABWÄRTS -- Untergebiete. Werden Schilde in der Baronie Moosgrund gehandelt,
 *      gehören sie in Weidens Liste, weil Moosgrund in Weiden liegt.
 *   (Rang 2 gab es einmal für Obergebiete und ist bewusst entfallen -- siehe unten.)
 *
 * Zwei Bäume werden dafür verbunden, weil das Wiki zwei Achsen führt:
 *   - politisch:      wiki_territory_model.parent_wiki_key (⚠️ NIE affiliation_path)
 *   - derographisch:  political_territory_wiki.geographic nennt die Region eines
 *                     Territoriums -- das ist die Brücke zwischen beiden Achsen.
 *
 * Kontinente werden NICHT expandiert: „Aventurien" zöge sonst die halbe Welt herein.
 * Ihre Einträge kommen weiter über den direkten Treffer und landen auf Rang 3.
 *
 * @return array<string,int> Ortsschlüssel => Rang
 */
function avesmapsLoreExpandPlaceKeys(PDO $pdo, string $placeKey): array
{
    $root = avesmapsLoreStripKeyPrefix($placeKey);
    if ($root === '') {
        return [];
    }
    $ranks = [$root => 0];
    if (in_array($root, AVESMAPS_LORE_CONTINENT_KEYS, true)) {
        return $ranks; // ein Kontinent hat keine sinnvolle Ausweitung
    }

    // Die beiden Hierarchietabellen werden PRO ANFRAGE nur EINMAL gelesen, auch wenn
    // mehrere Orte expandiert werden. Sie ändern sich ausschließlich beim Sync, nie
    // während eines Aufrufs.
    static $parentOfCache = null;
    static $childrenOfCache = null;
    static $territoriesInRegionCache = null;

    if ($parentOfCache !== null) {
        $parentOf = $parentOfCache;
        $childrenOf = $childrenOfCache;
        $territoriesInRegion = $territoriesInRegionCache;

        return avesmapsLoreExpandFromMaps($root, $ranks, $parentOf, $childrenOf, $territoriesInRegion);
    }

    $parentOf = [];
    $childrenOf = [];
    try {
        $rows = $pdo->query('SELECT wiki_key, parent_wiki_key FROM wiki_territory_model') ?: [];
        foreach ($rows as $row) {
            $child = avesmapsLoreStripKeyPrefix((string) ($row['wiki_key'] ?? ''));
            $parent = avesmapsLoreStripKeyPrefix((string) ($row['parent_wiki_key'] ?? ''));
            if ($child !== '' && $parent !== '') {
                $parentOf[$child] = $parent;
                $childrenOf[$parent][] = $child;
            }
        }
    } catch (Throwable) {
        // Baum noch nicht gebaut -> nur direkte Treffer. Kein Grund für einen 500er.
    }

    $territoriesInRegion = [];
    try {
        $rows = $pdo->query(
            'SELECT wiki_key, geographic FROM political_territory_wiki
             WHERE geographic IS NOT NULL AND geographic <> \'\''
        ) ?: [];
        foreach ($rows as $row) {
            $territory = avesmapsLoreStripKeyPrefix((string) ($row['wiki_key'] ?? ''));
            if ($territory === '') {
                continue;
            }
            foreach (avesmapsLoreKeysFromWikiField((string) ($row['geographic'] ?? '')) as $regionKey) {
                $territoriesInRegion[$regionKey][] = $territory;
            }
        }
    } catch (Throwable) {
        // Wiki-Spiegel fehlt -> keine Regionsbrücke.
    }

    // 💣 KEINE VERERBUNG NACH UNTEN (Owner 2026-07-21). Information steigt AUF, sie
    // fällt nicht herab: Werden Schilde in der Baronie Moosgrund gehandelt, gehören sie
    // in Weidens Liste. Umgekehrt macht „Taschendrachen gibt es in Almada" die Stadt
    // Punin NICHT zum Drachenort -- Punin liegt nur zufällig darin.
    //
    // Die frühere Fassung sammelte auch die Vorfahren (Rang 2) ein. Ergebnis: Punin
    // zeigte 149 Einträge, praktisch alle von Almada geerbt, und las sich, als käme
    // das alles dort vor. Deshalb gibt es hier nur noch Rang 0 (der Ort selbst) und
    // Rang 1 (seine Untergebiete). Eine Stadt zeigt dann meist nichts -- das ist die
    // richtige Antwort, nicht eine fehlende.

    $parentOfCache = $parentOf;
    $childrenOfCache = $childrenOf;
    $territoriesInRegionCache = $territoriesInRegion;

    return avesmapsLoreExpandFromMaps($root, $ranks, $parentOf, $childrenOf, $territoriesInRegion);
}

/**
 * PURE: die eigentliche Ausweitung auf den bereits geladenen Hierarchie-Karten.
 * Getrennt, damit der zweite und jeder weitere Ort einer Anfrage sie ohne erneutes
 * Tabellenlesen durchlaufen kann.
 *
 * @param array<string,int> $ranks
 * @return array<string,int>
 */
function avesmapsLoreExpandFromMaps(
    string $root,
    array $ranks,
    array $parentOf,
    array $childrenOf,
    array $territoriesInRegion
): array {
    // ABWÄRTS EINSAMMELN: Nachfahren im politischen Baum + alle Territorien dieser Region.
    $queue = $childrenOf[$root] ?? [];
    foreach ($territoriesInRegion[$root] ?? [] as $territory) {
        $queue[] = $territory;
    }
    $seen = [];
    while ($queue !== []) {
        $node = array_shift($queue);
        if ($node === '' || isset($seen[$node]) || count($seen) > 5000) {
            continue;
        }
        $seen[$node] = true;
        if (!isset($ranks[$node])) {
            $ranks[$node] = 1;
        }
        foreach ($childrenOf[$node] ?? [] as $child) {
            $queue[] = $child;
        }
    }

    return $ranks;
}

/**
 * Bestandszahlen -- der Abnahmetest nach einem Sync. Erwartung aus dem verifizierten
 * Dump-Scan (2026-07-21): 5.104 Eintraege (1.382 fauna / 1.004 flora / 187 spezies /
 * 2.531 ware), 7.748 Ortsverknuepfungen, 34.933 Quellen.
 *
 * @return array<string,mixed>
 */
function avesmapsLoreReadStats(PDO $pdo): array
{
    $out = [
        'entries' => [], 'entries_total' => 0, 'places' => 0, 'sources' => 0, 'top_places' => [],
        // Wann „Natur & Waren syncen" zuletzt DURCHLIEF -- der Editor zeigt es neben dem
        // Knopf, wie bei Abenteuern und Kartensammlung.
        'last_synced' => avesmapsLoreReadLastSynced($pdo),
    ];

    try {
        $rows = $pdo->query(
            'SELECT kind, COUNT(*) AS n FROM lore_entry WHERE status = \'active\' GROUP BY kind'
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];
        foreach ($rows as $row) {
            $out['entries'][(string) $row['kind']] = (int) $row['n'];
            $out['entries_total'] += (int) $row['n'];
        }
        $out['places'] = (int) $pdo->query('SELECT COUNT(*) FROM lore_place WHERE status = \'active\'')->fetchColumn();
        // ⚠️ Diese Zahl IST kleiner als die alten ~34.933 aus lore_source, und das ist richtig:
        // dort war jede Nennung einer Publikation eine eigene Zeile, hier ist eine Publikation
        // je Eintrag EINE Verknuepfung. Wer gegen die alte Zahl vergleicht, haelt einen
        // korrekten Bestand fuer Datenverlust (Migrations-Spec §6.1).
        $out['sources'] = (int) $pdo->query(
            'SELECT COUNT(*) FROM feature_sources WHERE entity_type = \'lore\' AND status = \'approved\''
        )->fetchColumn();
        $out['top_places'] = $pdo->query(
            'SELECT place_title, COUNT(*) AS n FROM lore_place WHERE status = \'active\'
             GROUP BY place_title ORDER BY n DESC LIMIT 15'
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable) {
        // Tabellen noch nicht angelegt (kein Sync gelaufen) -> Nullen statt 500.
        return $out;
    }

    return $out;
}

/**
 * Alle Eintraege zu EINEM Ort, nach Sektion gruppiert.
 *
 * Reihung (Design §4): direkte Treffer zuerst, kontinentweite zuletzt, innerhalb
 * dessen alphabetisch. Die Abwaerts-/Aufwaertsaggregation ueber die Territorien-
 * hierarchie kommt in Abschnitt 3 dazu; diese Funktion liefert die DIREKTEN Treffer
 * und ist so gebaut, dass die Aggregation nur die Schluesselliste erweitern muss.
 *
 * @param list<string> $placeKeys ein oder mehrere Ortsschluessel (Region, Siedlung, Territorium)
 * @return array<string,mixed> { sections: {kind: [entry,...]}, counts: {kind: n}, total: n }
 */
function avesmapsLoreReadForPlaces(PDO $pdo, array $placeKeys, int $limit = AVESMAPS_LORE_PANEL_LIMIT, array $rankByKey = []): array
{
    $keys = [];
    foreach ($placeKeys as $key) {
        $key = trim((string) $key);
        if ($key !== '' && !in_array($key, $keys, true)) {
            $keys[] = $key;
        }
    }

    $empty = ['sections' => [], 'counts' => [], 'total' => 0];
    foreach (AVESMAPS_LORE_KINDS as $kind) {
        $empty['sections'][$kind] = [];
        $empty['counts'][$kind] = 0;
    }
    if ($keys === []) {
        return $empty;
    }

    // Abgeschaltete Arten fallen HIER raus, nicht erst im Client: sonst reisen sie im
    // Payload mit und ein „AUS" wäre nur eine Anzeigefrage, keine echte Abschaltung.
    // Sind alle vier aus, gibt es nichts zu holen -- ohne diesen Riegel würde ein leeres
    // IN () die Abfrage zerlegen.
    $activeKinds = array_keys(array_filter(avesmapsLoreEnabledKinds($pdo)));
    if ($activeKinds === []) {
        return $empty;
    }

    $placeholders = implode(',', array_fill(0, count($keys), '?'));
    $kindPlaceholders = implode(',', array_fill(0, count($activeKinds), '?'));
    $sql =
        'SELECT e.wiki_key, e.kind, e.name, e.wiki_url, e.gruppe, e.typ, e.lebensraum,
                p.place_wiki_key, p.place_title, p.relation
         FROM lore_place p
         JOIN lore_entry e ON e.wiki_key = p.entry_wiki_key AND e.status = \'active\'
         WHERE p.status = \'active\' AND p.place_wiki_key IN (' . $placeholders . ')
           AND e.kind IN (' . $kindPlaceholders . ')
         ORDER BY e.name';

    try {
        $statement = $pdo->prepare($sql);
        $statement->execute(array_merge($keys, $activeKinds));
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable) {
        return $empty; // Tabellen fehlen (kein Sync) -> leer statt 500
    }

    // Ein Eintrag kann ueber mehrere Relationen am selben Ort haengen (Ware: Herkunft
    // UND Verbreitung). Er soll EINMAL erscheinen, aber beide Relationen behalten.
    $byKind = [];
    $seen = [];
    foreach ($rows as $row) {
        $kind = (string) $row['kind'];
        $key = (string) $row['wiki_key'];
        if (!isset($byKind[$kind])) {
            $byKind[$kind] = [];
        }
        if (isset($seen[$kind][$key])) {
            $index = $seen[$kind][$key];
            $relation = (string) $row['relation'];
            if (!in_array($relation, $byKind[$kind][$index]['relations'], true)) {
                $byKind[$kind][$index]['relations'][] = $relation;
            }
            // Derselbe Eintrag kann über mehrere Orte hereinkommen (direkt UND über ein
            // Untergebiet). Der SPEZIFISCHSTE gewinnt, sonst sinkt ein direkter Treffer
            // ans Ende, nur weil er zufällig auch kontinentweit gelistet ist.
            if ($rank < $byKind[$kind][$index]['rank']) {
                $byKind[$kind][$index]['rank'] = $rank;
                $byKind[$kind][$index]['place_title'] = (string) $row['place_title'];
            }
            continue;
        }
        // Rang aus der Expansion (0 direkt, 1 Untergebiet); ohne Expansion
        // ist jeder Treffer direkt. Kontinente gehen IMMER auf 3 -- sie gelten überall
        // und sagen über diesen Ort am wenigsten aus.
        $placeKeyLower = mb_strtolower((string) $row['place_wiki_key'], 'UTF-8');
        $rank = in_array($placeKeyLower, AVESMAPS_LORE_CONTINENT_KEYS, true)
            ? 3
            : (int) ($rankByKey[$placeKeyLower] ?? 0);
        $seen[$kind][$key] = count($byKind[$kind]);
        $byKind[$kind][] = [
            'wiki_key' => $key,
            'name' => (string) $row['name'],
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'gruppe' => (string) ($row['gruppe'] ?? ''),
            'typ' => (string) ($row['typ'] ?? ''),
            'lebensraum' => (string) ($row['lebensraum'] ?? ''),
            'relations' => [(string) $row['relation']],
            'place_title' => (string) $row['place_title'],
            // 0 = direkt am Ort, 3 = kontinentweit. Abschnitt 3 fuellt 1 (Untergebiet)
            // nach; die Reihung steht dann schon.
            'rank' => $rank,
        ];
    }

    $out = ['sections' => [], 'counts' => [], 'total' => 0];
    foreach (AVESMAPS_LORE_KINDS as $kind) {
        $entries = $byKind[$kind] ?? [];
        usort($entries, static function (array $a, array $b): int {
            return $a['rank'] <=> $b['rank'] ?: strcasecmp($a['name'], $b['name']);
        });
        $out['counts'][$kind] = count($entries);
        $out['total'] += count($entries);
        $out['sections'][$kind] = $limit > 0 ? array_slice($entries, 0, $limit) : $entries;
    }

    return $out;
}

/**
 * Zwilling zu avesmapsLoreReadForPlaces, aber fuer REGELTREFFER statt genannte Orte
 * (Lebensraum-Regel, Sitzung 3): holt die Stammdaten (Name, wiki_url, gruppe, typ, lebensraum,
 * kind) zu einer Menge entry_wiki_key => relation, IN EINER Abfrage. Die Zeilenform ist
 * dieselbe wie in $byKind oben ('wiki_key', 'name', 'wiki_url', 'gruppe', 'typ', 'lebensraum',
 * 'relations', 'place_title', 'rank' -- plus 'kind' zum Einsortieren), damit der Aufrufer sie
 * mit demselben $seen/Rang-Verfahren einmischen kann, das dort schon fuer mehrfach hereinkommende
 * Eintraege steht (api/app/lore.php, ?place=-Zweig).
 *
 * Ein Regeltreffer hat KEINEN Ort -- 'place_title' bleibt leer. 'rank' ist immer 1: spezifischer
 * als "kontinentweit" (3), unspezifischer als "direkt am Ort" (0). Eine Regel sagt "hier passt
 * die Umgebung", keine Aussage ueber ein Untergebiet (dort ebenfalls 1) -- die Gleichstellung
 * mit Rang 1 ist Absicht, kein Zufall: beides ist ein indirekter, kein direkter Treffer.
 *
 * @param array<string,string> $ruleHits entry_wiki_key => relation (avesmapsLoreRuleEntriesForSubject)
 * @param list<string> $activeKinds
 * @return list<array{wiki_key:string, kind:string, name:string, wiki_url:string, gruppe:string, typ:string, lebensraum:string, relations:list<string>, place_title:string, rank:int}>
 */
function avesmapsLoreReadEntriesForRuleHits(PDO $pdo, array $ruleHits, array $activeKinds): array
{
    if ($ruleHits === [] || $activeKinds === []) {
        return [];
    }

    $keys = array_keys($ruleHits);
    $keyPlaceholders = implode(',', array_fill(0, count($keys), '?'));
    $kindPlaceholders = implode(',', array_fill(0, count($activeKinds), '?'));

    try {
        $statement = $pdo->prepare(
            'SELECT wiki_key, kind, name, wiki_url, gruppe, typ, lebensraum FROM lore_entry
              WHERE status = \'active\' AND wiki_key IN (' . $keyPlaceholders . ')
                AND kind IN (' . $kindPlaceholders . ')'
        );
        $statement->execute(array_merge($keys, $activeKinds));
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable) {
        return []; // lore_entry fehlt (nie gesynct) -> keine Regeltreffer, kein 500
    }

    $out = [];
    foreach ($rows as $row) {
        $key = (string) $row['wiki_key'];
        $out[] = [
            'wiki_key' => $key,
            'kind' => (string) $row['kind'],
            'name' => (string) $row['name'],
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'gruppe' => (string) ($row['gruppe'] ?? ''),
            'typ' => (string) ($row['typ'] ?? ''),
            'lebensraum' => (string) ($row['lebensraum'] ?? ''),
            'relations' => [(string) ($ruleHits[$key] ?? 'verbreitung')],
            'place_title' => '',
            'rank' => 1,
        ];
    }

    return $out;
}

/**
 * Mischt Regeltreffer (avesmapsLoreReadEntriesForRuleHits) in ein schon von
 * avesmapsLoreReadForPlaces gebautes Ergebnis -- dasselbe $seen/Rang-Verfahren, das dort fuer
 * mehrfach hereinkommende Eintraege steht (Duplikate ueber zwei Orte): ein Eintrag bleibt EINMAL
 * drin, der kleinere (spezifischere) Rang gewinnt, seine Relationen werden vereinigt.
 *
 * Nach dem Einmischen wird jede betroffene Sektion neu sortiert (Rang, dann Name) und die
 * Panel-Kappung erneut angewendet -- ohne Regeltreffer koennten sonst ueber dem Limit landen.
 *
 * @param array<string,mixed> $result wie von avesmapsLoreReadForPlaces zurueckgegeben
 * @param list<array<string,mixed>> $ruleRows wie von avesmapsLoreReadEntriesForRuleHits zurueckgegeben
 * @return array<string,mixed>
 */
function avesmapsLoreMergeRuleHitsIntoResult(array $result, array $ruleRows, bool $full): array
{
    if ($ruleRows === []) {
        return $result;
    }

    // Index der schon vorhandenen Eintraege je Sektion -- dasselbe Verfahren wie $seen in
    // avesmapsLoreReadForPlaces, nur ueber ein bereits fertiges Ergebnis statt roher Zeilen.
    $seen = [];
    foreach ($result['sections'] as $kind => $entries) {
        foreach ($entries as $index => $entry) {
            $seen[$kind][(string) ($entry['wiki_key'] ?? '')] = $index;
        }
    }

    foreach ($ruleRows as $row) {
        $kind = (string) $row['kind'];
        $key = (string) $row['wiki_key'];
        if (!isset($result['sections'][$kind])) {
            continue; // Art nicht in AVESMAPS_LORE_KINDS (kann nicht vorkommen) oder abgeschaltet
        }

        if (isset($seen[$kind][$key])) {
            $existingIndex = $seen[$kind][$key];
            if ((int) $row['rank'] < (int) $result['sections'][$kind][$existingIndex]['rank']) {
                $result['sections'][$kind][$existingIndex]['rank'] = $row['rank'];
            }
            foreach ($row['relations'] as $relation) {
                if (!in_array($relation, $result['sections'][$kind][$existingIndex]['relations'], true)) {
                    $result['sections'][$kind][$existingIndex]['relations'][] = $relation;
                }
            }
            continue;
        }

        unset($row['kind']);
        $seen[$kind][$key] = count($result['sections'][$kind]);
        $result['sections'][$kind][] = $row;
        $result['counts'][$kind] = ($result['counts'][$kind] ?? 0) + 1;
        $result['total']++;
    }

    foreach (AVESMAPS_LORE_KINDS as $kind) {
        $entries = $result['sections'][$kind] ?? [];
        usort($entries, static function (array $a, array $b): int {
            return $a['rank'] <=> $b['rank'] ?: strcasecmp($a['name'], $b['name']);
        });
        $result['sections'][$kind] = $full ? $entries : array_slice($entries, 0, AVESMAPS_LORE_PANEL_LIMIT);
    }

    return $result;
}
