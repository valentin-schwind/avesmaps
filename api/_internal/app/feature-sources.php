<?php
declare(strict_types=1);

// avesmapsWikiNamespaceIsOfficial() -- Rang 2 der Kanon-Ableitung.
require_once __DIR__ . '/../wiki/namespaces.php';

// Multi-source system (#1): catalog of distinct sources + element<->source links.
// Self-healing DDL (project idiom); dedup by url_hash so arbitrary-length URLs get a
// fixed-length UNIQUE index (avoids the utf8mb4 index-length limit on a long url column).
/**
 * Dieselben Tabellen fuer SQLite -- eine ZUSAETZLICHE Fassung, keine Umschrift der Produktionsform
 * (dasselbe Muster wie `avesmapsEnsureSyncPlanTablesSqlite`, und aus demselben Grund: die Lehre aus
 * dem 1093-Fall, AGENTS.md §9). Die MySQL-DDL darunter bleibt Zeichen fuer Zeichen, wie sie ist.
 *
 * ⚠️ Sie ist NUR fuer Tests da. Produktiv laeuft ausschliesslich MySQL; deshalb steht hier auch
 * kein `information_schema`-Nachziehen von Spalten -- eine frisch angelegte Testdatenbank hat sie
 * alle von Anfang an.
 * 🔴 Die Spaltenliste muss der MySQL-Fassung folgen. Fehlt hier eine, faellt sie nicht auf: der
 * Test schriebe gegen eine Tabelle ohne die Spalte und meldete einen SQL-Fehler, der wie ein
 * Fehler im Pruefling aussieht.
 */
function avesmapsEnsureFeatureSourceTablesSqlite(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL DEFAULT "",
            url_hash TEXT NOT NULL DEFAULT "",
            wiki_key TEXT NULL,
            label TEXT NOT NULL DEFAULT "",
            source_type TEXT NOT NULL DEFAULT "sonstiges",
            is_official INTEGER NOT NULL DEFAULT 0,
            license TEXT NOT NULL DEFAULT "",
            attribution TEXT NOT NULL DEFAULT "",
            created_by INTEGER NULL,
            created_at TEXT NOT NULL DEFAULT "2026-01-01 00:00:00"
        )'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS feature_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_public_id TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT "approved",
            origin TEXT NOT NULL DEFAULT "manual",
            reference_kind TEXT NULL,
            pages TEXT NULL,
            note TEXT NULL,
            created_by INTEGER NULL,
            created_at TEXT NOT NULL DEFAULT "2026-01-01 00:00:00",
            UNIQUE (entity_type, entity_public_id, source_id)
        )'
    );
}

/**
 * Der Treibername -- oder '' , wenn er sich nicht ermitteln laesst.
 *
 * 💣 DAS `try` IST NICHT ZIERDE. Mehrere Tests im Haus reichen eine PDO-Unterklasse herein, die
 * ihren Elternkonstruktor nie ruft (`FakeSearchPdo` in source-search-test.php ueberschreibt nur
 * `prepare`/`exec`); auf so einem Objekt wirft JEDER `getAttribute` mit „object is uninitialized".
 * Ohne den Riegel bricht eine blosse Treiberfrage einen fremden, seit Monaten gruenen Test --
 * genau so geschehen am 01.09.2026, und gefunden hat es der Lauf ueber das GANZE Testfeld, nicht
 * die eigenen Tests.
 * ⚠️ Der Rueckfall ist '' und fuehrt damit in den MySQL-Zweig -- also in genau das Verhalten, das
 * vor dieser Weiche galt.
 */
function avesmapsPdoDriverName(PDO $pdo): string
{
    try {
        return (string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    } catch (Throwable) {
        return '';
    }
}

function avesmapsEnsureFeatureSourceTables(PDO $pdo): void
{
    // 🔴 SQLite kommt ausschliesslich aus Tests. Die MySQL-DDL darunter ist unberuehrt -- hier wird
    // nichts fuer den Test verbogen, sondern eine zweite Fassung DANEBEN gestellt.
    if (avesmapsPdoDriverName($pdo) === 'sqlite') {
        avesmapsEnsureFeatureSourceTablesSqlite($pdo);

        return;
    }

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS sources (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            url TEXT NOT NULL,
            url_hash CHAR(64) NOT NULL,
            label VARCHAR(200) NOT NULL DEFAULT '',
            source_type VARCHAR(32) NOT NULL DEFAULT 'sonstiges',
            is_official TINYINT(1) NOT NULL DEFAULT 0,
            created_by INT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_sources_url_hash (url_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS feature_sources (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            entity_type VARCHAR(16) NOT NULL,
            entity_public_id VARCHAR(64) NOT NULL,
            source_id BIGINT UNSIGNED NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'approved',
            created_by INT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_feature_source (entity_type, entity_public_id, source_id),
            KEY idx_feature_lookup (entity_type, entity_public_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );

    // Self-healing column-adds (project idiom, see wiki/settlements.php:22-55): provenance +
    // reference-detail columns for the wiki-publication-sources feature. `status` already exists;
    // the new allowed value 'suppressed' (manual removal of a wiki-origin link, tombstoned so a
    // later reconcile does not resurrect it) is an application-level convention, no DDL needed.
    $columnExists = static function (PDO $pdo, string $table, string $column): bool {
        $stmt = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = '" . $table . "'
               AND COLUMN_NAME = '" . $column . "'"
        );
        return $stmt !== false && (int) $stmt->fetchColumn() > 0;
    };
    $addColumn = static function (string $column, string $definition) use ($pdo, $columnExists): void {
        if (!$columnExists($pdo, 'feature_sources', $column)) {
            $pdo->exec('ALTER TABLE feature_sources ADD COLUMN ' . $column . ' ' . $definition);
        }
    };
    // Who established this link: 'manual' (editor, default) vs 'wiki_publication' (reconcile) etc.
    $addColumn('origin', "VARCHAR(24) NOT NULL DEFAULT 'manual'");
    // How the source refers to the entity (e.g. wiki "Seite"/"Kapitel"), free-form pages/note.
    $addColumn('reference_kind', 'VARCHAR(16) NULL');
    $addColumn('pages', 'VARCHAR(120) NULL');
    $addColumn('note', 'VARCHAR(200) NULL');

    // Step 1 of docs/quellen-wiki-key-instruction.md: a source MAY carry the wiki key of the work
    // it IS. NULL means "no wiki reference known" and is a valid PERMANENT state -- most rows keep
    // it (the 539 shop-only sources are expected to, section 6).
    //
    // Column and index in ONE statement so a half-applied migration is impossible: the guard below
    // only checks the column, and a separate index ALTER could be skipped forever if it failed once.
    //
    // Plain index, deliberately NOT unique yet: the key only becomes the identity once step 5 has
    // folded the duplicates away, and today several rows still describe the same work. The UNIQUE
    // is the last step of the migration, not the first.
    // 🔴 DIE LIZENZ EINER QUELLE, UND WEN SIE NENNEN WILL (Owner 27.08.2026: "quellen fehlt das
    // lizenz-feld"). Zwei Spalten, nicht eine, weil CC zwei getrennte Dinge verlangt: WAS gilt
    // (`license`) und WEN man nennt (`attribution`). Ein Freitext fuer beides waere bei 239
    // Zeilen 239-mal derselbe Satz -- mit Tippfehlern und nicht auswertbar.
    //
    // ⚠️ LEER heisst "nicht erfasst", NIE "keine Lizenz". Die 1694 vorhandenen Quellen starten
    // leer und zeigen wie bisher nichts; wer "keine freie Lizenz" sagen will, sagt es mit dem
    // Schluessel `unfree`. Die beiden zu verwechseln waere eine Rechtsaussage, die niemand
    // getroffen hat.
    //
    // 💣 Und `license` ist ein SCHLUESSEL, kein Anzeigetext. Der Text steht in
    // js/ui/feature-source-markup.js -- dieselbe Trennung wie beim source_type, dessen Whitelist
    // hier steht und dessen Beschriftung dort. Wer den Anzeigetext speichert, kann ihn nie
    // uebersetzen und nie umformulieren, ohne den Bestand anzufassen.
    if (!$columnExists($pdo, 'sources', 'license')) {
        $pdo->exec("ALTER TABLE sources ADD COLUMN license VARCHAR(40) NOT NULL DEFAULT ''");
    }
    if (!$columnExists($pdo, 'sources', 'attribution')) {
        $pdo->exec("ALTER TABLE sources ADD COLUMN attribution VARCHAR(200) NOT NULL DEFAULT ''");
    }

    if (!$columnExists($pdo, 'sources', 'wiki_key')) {
        $pdo->exec(
            'ALTER TABLE sources
                ADD COLUMN wiki_key VARCHAR(190) NULL AFTER url_hash,
                ADD KEY idx_sources_wiki_key (wiki_key)'
        );
    }

    // entity_public_id must hold a LORE key (2026-07-22). Every other entity type carries a short
    // opaque public_id that fits in 64; lore has no public_id at all -- its identity IS its
    // wiki_key, a slug of the wiki article title, and those run past 64 characters.
    //
    // 💣 This is not cosmetic. MySQL would truncate the key silently, and two lore entries whose
    // titles agree in their first 64 slug characters would then collide on the UNIQUE index and
    // share each other's sources. Widening to 190 matches every wiki_key column in the schema.
    // Index length stays far inside the limit: 16*4 + 190*4 + 8 = 832 of 3072 bytes.
    $statement = $pdo->query(
        "SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'feature_sources'
            AND COLUMN_NAME = 'entity_public_id'"
    );
    $currentLength = $statement === false ? 0 : (int) $statement->fetchColumn();
    if ($currentLength > 0 && $currentLength < 190) {
        $pdo->exec('ALTER TABLE feature_sources MODIFY COLUMN entity_public_id VARCHAR(190) NOT NULL');
    }
}

// 💣 THE ENTITY TYPES THAT LIVE IN map_features AND ARE DELETED SOFTLY (is_active = 0).
// A source link is keyed by (entity_type, entity_public_id) with no foreign key, so nothing removes
// it when its element goes. On 2026-08-05 that was 216 elements with 4.714 links pointing at rows
// nobody can see any more -- and the public endpoint served them: delete a place, and an anonymous
// caller still got its sources (reproduced live in the system test, finding A6/A7).
//
// 💣 THE GUARD BELONGS ON THE READ, NOT ON THE DELETE, and that is the whole design. The delete is
// soft ON PURPOSE so undo can restore an element completely. If deleting also removed the links,
// undo would have to put them back -- a second piece of state to keep in sync, and the exact kind
// of bookkeeping that drifts. A live check follows the element for free: deleted hides the sources,
// undone shows them again, and there is nothing to remember.
//
// ⚠️ NOT every entity type belongs here. territory, citymap and lore keep their own tables and
// their own delete semantics; filtering them against map_features would hide every one of their
// sources (878 territory and 631 citymap links on the same day). The test asserts exactly that.
const AVESMAPS_FEATURE_SOURCE_SOFT_DELETED_ENTITY_TYPES = ['settlement', 'region', 'path', 'powerline'];

/**
 * SQL fragment for "the element this link points at is still alive". Written once and used by every
 * read, so the rule cannot drift between them. `$alias` is the feature_sources alias in the
 * surrounding query. The interpolated values are the code constant above -- never user input.
 *
 * 💣 THE `COLLATE` IS LOAD-BEARING, AND THIS TABLE IS THE HOUSE'S SCAR FOR FORGETTING IT.
 * `feature_sources` was created as `DEFAULT CHARSET=utf8mb4` with no COLLATE, so it carries the
 * SERVER default; `map_features` is explicitly `utf8mb4_unicode_ci`. A bare column-to-column
 * compare between the two throws „Illegal mix of collations" -- and MySQL decides that while
 * PLANNING, so it fires on every call regardless of the data and regardless of whether the OR
 * branch is ever reached. Shipped without it on 2026-08-05 and both public readers answered 500
 * within minutes. The same trap is documented at api/_internal/app/lore.php:241 and
 * api/_internal/app/ecosystem.php:230, the second of which names THIS table as the scar.
 *
 * ⚠️ It goes on the feature_sources side, not on map_features: collating a column makes it
 * unusable for its index, and `map_features.public_id` is the UNIQUE key this lookup rides on.
 *
 * ⚠️ sqlite has no collation clash, so no unit test on sqlite can catch a missing COLLATE here.
 * The test asserts the fragment CONTAINS it instead -- that is the only guard this line can have
 * short of a MySQL fixture.
 */
function avesmapsFeatureSourceLiveEntityClause(string $alias = 'fs'): string
{
    $types = "'" . implode("', '", AVESMAPS_FEATURE_SOURCE_SOFT_DELETED_ENTITY_TYPES) . "'";

    return " AND ({$alias}.entity_type NOT IN ({$types})"
        . " OR EXISTS (SELECT 1 FROM map_features mf"
        . " WHERE mf.public_id = {$alias}.entity_public_id COLLATE utf8mb4_unicode_ci"
        . " AND mf.is_active = 1))";
}

// The read used by the public endpoint: approved catalog links PLUS the element's legacy single
// properties.other_source (settlements/regions/paths keep that field per the owner decision),
// merged and deduped by URL (catalog wins). Official-first then insertion order. This makes the
// existing "Andere Quelle" show without any migration; if it is later also added to the catalog,
// the dedup prevents a double entry.
function avesmapsReadFeatureSources(PDO $pdo, string $entityType, string $entityPublicId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    // The legacy branch below has always checked is_active; the catalog branch never did. That
    // asymmetry inside one function is what leaked -- both halves now answer for the same element.
    $statement = $pdo->prepare(
        "SELECT s.url, s.label, s.source_type, s.is_official, s.license, s.attribution
           FROM feature_sources fs
           JOIN sources s ON s.id = fs.source_id
          WHERE fs.entity_type = :t AND fs.entity_public_id = :id AND fs.status = 'approved'"
        . avesmapsFeatureSourceLiveEntityClause('fs') .
        " ORDER BY s.is_official DESC, s.created_at ASC, s.id ASC"
    );
    $statement->execute(['t' => $entityType, 'id' => $entityPublicId]);
    $catalog = array_map(static fn(array $r): array => [
        'url' => (string) $r['url'],
        'label' => (string) $r['label'],
        'type' => (string) $r['source_type'],
        'official' => (int) $r['is_official'] === 1,
        // ⚠️ Leer heisst "nicht erfasst" und wird als leer weitergereicht, nicht weggelassen:
        // ein fehlender Schluessel und ein leerer sind fuer den Leser dasselbe, aber nur der
        // leere sagt, dass die Frage ueberhaupt gestellt wurde.
        'license' => (string) ($r['license'] ?? ''),
        'attribution' => (string) ($r['attribution'] ?? ''),
    ], $statement->fetchAll(PDO::FETCH_ASSOC) ?: []);

    // Legacy "Andere Quelle": settlement/region/path live in map_features.properties.other_source.
    $legacy = null;
    if (in_array($entityType, ['settlement', 'region', 'path'], true)) {
        $lookup = $pdo->prepare(
            "SELECT properties_json FROM map_features WHERE public_id = :id AND is_active = 1 LIMIT 1"
        );
        $lookup->execute(['id' => $entityPublicId]);
        $props = json_decode((string) ($lookup->fetchColumn() ?: ''), true);
        $other = is_array($props) ? ($props['other_source'] ?? null) : null;
        $otherUrl = is_array($other) ? trim((string) ($other['url'] ?? '')) : '';
        if ($otherUrl !== '') {
            $legacy = [
                'url' => $otherUrl,
                'label' => is_array($other) ? trim((string) ($other['label'] ?? '')) : '',
                'type' => 'sonstiges',
                'official' => false,
            ];
        }
    }

    if ($legacy === null) {
        return $catalog;
    }
    foreach ($catalog as $existing) {
        if ($existing['url'] === $legacy['url']) {
            return $catalog; // already curated in the catalog -> don't show it twice
        }
    }
    $catalog[] = $legacy;
    return $catalog;
}

// Dedup-Upsert einer Katalog-Quelle (url_hash = Identität). Gibt die sources.id zurück.
// $wikiKey: set only for URL-less publication sources (a wiki catalog entry without a shop
// link); the call contract is a URL-less source ALWAYS passes $wikiKey, otherwise leave it empty.
// The same read as avesmapsReadFeatureSources, but for EVERY entity of one type in ONE query:
// { entity_public_id => [ {url, label, type, official}, ... ] }. Mirrors the shape of
// avesmapsLinkCheckStatesByEntityType so a catalog endpoint can decorate its whole payload without an
// N+1 -- api/app/citymaps.php (Spec §3.5, "zwei Queries, kein N+1") is the first caller, and the reader
// dialog needs it because it filters by source.
//
// Deliberately does NOT merge the legacy properties.other_source the per-entity read adds for
// settlement/region/path: that merge is a per-element map_features lookup (an N+1 by construction) and it
// only exists for entity types that predate the catalog. An entity with no approved sources is simply
// absent from the map.
function avesmapsReadFeatureSourcesByEntityType(PDO $pdo, string $entityType): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    $statement = $pdo->prepare(
        "SELECT fs.entity_public_id, s.url, s.label, s.source_type, s.is_official, s.license, s.attribution
           FROM feature_sources fs
           JOIN sources s ON s.id = fs.source_id
          WHERE fs.entity_type = :t AND fs.status = 'approved'
          ORDER BY fs.entity_public_id ASC, s.is_official DESC, s.created_at ASC, s.id ASC"
    );
    $statement->execute(['t' => $entityType]);

    $byEntity = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $byEntity[(string) $row['entity_public_id']][] = [
            'url' => (string) $row['url'],
            'label' => (string) $row['label'],
            'type' => (string) $row['source_type'],
            'official' => (int) $row['is_official'] === 1,
            'license' => (string) ($row['license'] ?? ''),
            'attribution' => (string) ($row['attribution'] ?? ''),
        ];
    }
    return $byEntity;
}

// $refreshLabel: opt-in, used ONLY by the wiki-publication reconcile. The default keeps the
// historic write-once behaviour (a label is only filled when empty). The wiki catalog OWNS the
// canonical label of the rows it creates, so a corrected wiki title must be able to replace a
// stale one -- without it, a fixed catalog title never reaches the live row (Discord case #33:
// "Aventurien" stayed put instead of becoming "Aventurien - Das Lexikon des Schwarzen Auges").
// An EMPTY new label never overwrites a filled one, so a refresh can only ever add information.
/**
 * 🔴 DIE LIZENZSCHLUESSEL, die eine Quelle tragen darf. Leer = nicht erfasst.
 *
 * ⚠️ `unfree` ist eine AUSSAGE ("keine freie Lizenz"), leer ist keine. Die beiden zu
 * verwechseln hiesse, eine Rechtsaussage zu treffen, die niemand getroffen hat.
 * ⚠️ Die Beschriftungen stehen in js/ui/feature-source-markup.js -- dieselbe Trennung wie beim
 * source_type, dessen Whitelist hier steht und dessen Anzeigetext dort. Wer hier den Text
 * speichert, kann ihn nie umformulieren, ohne den Bestand anzufassen.
 */
const AVESMAPS_SOURCE_LICENSES = [
    'cc-by-sa-3.0',
    'cc-by-nc-sa-3.0',
    'cc-by-4.0',
    'cc-by-sa-4.0',
    'cc0-1.0',
    'public-domain',
    'unfree',
];

/**
 * Der TITEL einer Katalogquelle -- ohne Markup.
 *
 * 💣 WARUM ES DAS GIBT (gemessen 01.09.2026): fuenf Katalogzeilen tragen ein `<br>` MITTEN IM
 * TITEL, aus dem `{{Infobox Produkt}}`-Feld des Wikis mitgeschleppt -- „Landkartenset <br />Das
 * Dornenreich" (18 Karten), „Havena-Fanfare<br/>Sonderausgabe" (7), „Meisterschirm<br/>des
 * Schwarzen Auges" (4), zwei weitere. Das Markup escapet korrekt, also steht dort woertlich
 * „Landkartenset &lt;br /&gt;Das Dornenreich" statt eines Umbruchs.
 *
 * 🔴 DIE REGEL SITZT IM UPSERT, NICHT IM PARSER. Der Katalog hat mehrere Schreiber -- der
 * Publikations-Abgleich, der Stadtkarten-Abgleich, der Editor, der Import. Eine Regel, die einen
 * von ihnen bindet, ist keine Regel; und eine reine Datenkorrektur waere ohnehin zwecklos, weil
 * `avesmapsPublicationReconcileEntity` mit `refreshLabel = true` schreibt und den alten Titel beim
 * naechsten Lauf zurueckholte.
 *
 * ⚠️ Nur `<br>` wird zu einem Leerzeichen, kein allgemeines `strip_tags`: ein Titel darf durchaus
 * ein `<` tragen („Band <1>"), und was hier verschwindet, verschwindet katalogweit.
 */
function avesmapsNormalizeSourceLabel(mixed $value): string
{
    $label = preg_replace('#<br\s*/?>#i', ' ', (string) $value) ?? (string) $value;

    return avesmapsNormalizeSingleLine($label, 200);
}

/** Ein Lizenzschluessel, oder '' -- ein unbekannter wird zu '' und NICHT zu einem geratenen. */
function avesmapsNormalizeSourceLicense(mixed $value): string
{
    $key = strtolower(trim((string) $value));

    return in_array($key, AVESMAPS_SOURCE_LICENSES, true) ? $key : '';
}

/**
 * 🔴 DIE ACHT QUELLENARTEN -- und '' heisst „keine Aussage".
 *
 * 💣 Genau dieser leere Zustand fehlte, und daran haengt Meldung #105 (Nottel, 29.08.2026:
 * „Die Auswahl des Typs einer Quellenangabe wird auf ‚Regionalspielhilfe' gestellt, unabhaengig
 * von der Wahl des Benutzers"). Die Eingabezeile hatte keinen leeren Eintrag, also stand die
 * ERSTE Art vorausgewaehlt -- und die erste ist 'regionalspielhilfe'. Wer die Auswahl nie
 * anfasste, legte damit eine Behauptung an, die er nie getroffen hat; so kam „Briefspiel
 * Rommilyser Mark" (Quelle 1322115, live gemessen 29.08.2026) als Regionalspielhilfe in den
 * Katalog. Seither traegt die Zeile „Art …" und schickt '' -- eine Wahl ist erst eine Wahl,
 * wenn jemand sie trifft.
 *
 * ⚠️ Es gibt eine ZWEITE Liste derselben Werte in api/app/report-location.php:405 -- der Weg
 * der Gemeinschaftsmeldung, der diese Datei nicht laedt.
 */
const AVESMAPS_SOURCE_TYPES = [
    'regionalspielhilfe',
    'abenteuer',
    'aventurischer_bote',
    'quellenband',
    'roman',
    'briefspiel',
    'regelbuch',
    'sonstiges',
];

/** Eine Quellenart, oder '' fuer „keine Aussage" -- dieselbe Form wie beim Lizenzschluessel. */
function avesmapsNormalizeSourceType(mixed $value): string
{
    $key = strtolower(trim((string) $value));

    return in_array($key, AVESMAPS_SOURCE_TYPES, true) ? $key : '';
}

/**
 * Darf diese Wahl eine BEREITS BEKANNTE Katalogzeile umtypen?
 *
 * Zwei Bedingungen, und beide muessen stehen: der Aufrufer darf es ($callerMayRetype), UND die
 * Art ist ausdruecklich gewaehlt. Eine leere Wahl ist keine Aussage und aendert nie etwas --
 * ohne diese zweite Haelfte wuerde die Vorauswahl eines Formulars zur Behauptung, was genau der
 * Fehler ist, aus dem Meldung #105 entstand.
 */
function avesmapsSourceRetypeAllowed(mixed $type, bool $callerMayRetype): bool
{
    return $callerMayRetype && avesmapsNormalizeSourceType($type) !== '';
}

/**
 * Die IDENTITAET einer Quelle: der Hash, unter dem der Katalog sie kennt. EINE Regel, zwei Leser
 * -- der Upsert und der Blick darauf, was vorher dastand. Eine zweite Fassung dieser Zeile waere
 * die Divergenz, die den Katalog spaltet.
 */
function avesmapsFeatureSourceHash(string $url, string $wikiKey = ''): string
{
    // URL-less identity: synthesize the hash from the stable wiki key instead of the (missing) URL.
    return ($url === '' && $wikiKey !== '') ? hash('sha256', 'wikipub:' . $wikiKey) : hash('sha256', $url);
}

/**
 * Der ON-DUPLICATE-Teil des Katalog-Upserts als Text -- damit die EINE Entscheidung darin
 * pruefbar ist: wer darf eine bereits bekannte Zeile umschreiben?
 *
 * 🔴 `source_type = source_type` ist die Vorgabe und ein bewusster Leerlauf. Ein Aufrufer, der
 * nur verknuepfen will -- Wiki-Abgleich, Import, angenommene Gemeinschaftsmeldung -- aendert die
 * Art einer bekannten Quelle NIE. Nur die Eingabezeile des Editors setzt $retype, und auch sie
 * nur mit einer ausdruecklichen Wahl.
 */
function avesmapsSourceUpsertOnDuplicateSql(bool $refreshLabel, bool $retype): string
{
    return "label = " . ($refreshLabel ? "IF(VALUES(label) = '', label, VALUES(label))" : "IF(label = '', VALUES(label), label)") . ",
             is_official = VALUES(is_official),
             source_type = " . ($retype ? 'VALUES(source_type)' : 'source_type') . ",
             wiki_key = IF(VALUES(wiki_key) IS NULL, wiki_key, VALUES(wiki_key)),
             license = IF(VALUES(license) = '', license, VALUES(license)),
             attribution = IF(VALUES(attribution) = '', attribution, VALUES(attribution))";
}

/**
 * „ANGELEGT oder VERKNUEPFT?" — die Auskunft, die das Adressfeld bis zum 01.09.2026 verschwieg.
 *
 * 🔴 Der Katalog dedupliziert ueber `url_hash` (UNIQUE): eine schon bekannte Adresse verknuepft mit
 * der bestehenden Zeile, statt eine neue anzulegen. Das ist richtig und gewollt — es geschah nur
 * stumm, waehrend der NAMENS-Weg daneben eine Kachel „bestehende Quelle" zeigt. Owner-Frage:
 * „erkennt er die Quelle beim Einfuegen automatisch, und wenn nicht, legt er eine neue an?"
 *
 * ⚠️ `null` heisst „neu angelegt" und ist die SCHWEIGENDE Antwort: die frische Zeile zeigt genau
 * das Eingetippte, da gibt es nichts zu erklaeren. Gemeldet wird nur der ueberraschende Fall —
 * dieselbe Regel wie bei `retyped`.
 *
 * 💣 Rein und ohne PDO, weil `avesmapsFeatureSourceUpsert` mit `ON DUPLICATE KEY UPDATE` arbeitet
 * und damit gegen SQLite nicht fahrbar ist. Eine Regel, die kein Test ausfuehrt, ist keine.
 *
 * @param array|null $bestehend die Katalogzeile VOR dem Upsert (id/label/is_official), oder null
 */
function avesmapsFeatureSourceLinkedReport(?array $bestehend, string $label, bool $official): ?array
{
    if ($bestehend === null) {
        return null;
    }
    $gespeicherterTitel = trim((string) ($bestehend['label'] ?? ''));
    $eingetippt = trim($label);

    return [
        'source_id' => (int) ($bestehend['id'] ?? 0),
        // Der Titel, unter dem die Zeile im Katalog steht — er gewinnt, weil `label` beim
        // Verknuepfen nur eine Luecke FUELLT (avesmapsSourceUpsertOnDuplicateSql).
        'label' => $gespeicherterTitel !== '' ? $gespeicherterTitel : $eingetippt,
        // 🔴 Nur gesetzt, wenn der eingetippte Titel wirklich VERWORFEN wurde. Das ist der Fall,
        // der ohne Erklaerung wie ein Fehler aussieht: man tippt „X" und in der Liste steht „Y".
        // ⚠️ Nicht gesetzt, wenn die Katalogzeile gar keinen Titel hatte — dann gewinnt der
        // eingetippte, es wurde also nichts verworfen.
        'typed_label' => ($eingetippt !== '' && $gespeicherterTitel !== '' && $eingetippt !== $gespeicherterTitel)
            ? $eingetippt : '',
        // 💣 `is_official` ueberschreibt der Upsert UNBEDINGT. Hat der Haken den Katalogwert soeben
        // umgelegt, gehoert das gesagt: es gilt ueberall, wo die Quelle zitiert wird, und niemand
        // hat es bewusst getan.
        'official_changed' => ((int) ($bestehend['is_official'] ?? 0) === 1) !== $official,
        'official_now' => $official,
    ];
}

function avesmapsFeatureSourceUpsert(PDO $pdo, string $url, string $label, string $type, bool $official, int $userId, string $wikiKey = '', bool $refreshLabel = false, string $license = '', string $attribution = '', bool $retype = false): int
{
    // 💣 DIESE LISTE KUERZTE LAUTLOS. Was nicht darinsteht, wird zu 'sonstiges' -- kein Fehler,
    // keine Meldung, und der Aufrufer bekommt eine gueltige id zurueck. Wer hier einen neuen Typ
    // braucht, traegt ihn in AVESMAPS_SOURCE_TYPES ein; wer es vergisst, merkt es an nichts.
    //
    // 🪤 Der Garetien-Import (27.08.2026) war einen halben Tag lang dabei, genau das zu tun --
    // ein eigener Typ 'garetien', weil eine Lizenzangabe daran haengen sollte. Er brauchte
    // keinen: garetien.de und koschwiki.de SIND Briefspiele, und das Haus fuehrt diese Form
    // laengst ("Briefspiel (Weiden)", "Albernisches Briefspiel" -- 96 solche Quellen im
    // Katalog). Seine Lizenzangabe haengt seither am WIRT der Adresse, wo sie ohnehin
    // hingehoert: beide Wikis tragen denselben Typ, verschieden ist nur der Name, der genannt
    // werden muss. ⭐ Die Lehre ist die allgemeinere: eine neue Kategorie ist erst dann faellig,
    // wenn die vorhandene die Sache WIRKLICH nicht beschreibt.
    // ⚠️ Es gibt eine ZWEITE Liste derselben Werte in api/app/report-location.php:405.
    $gewaehlteArt = avesmapsNormalizeSourceType($type); // '' = keine Aussage
    // 🔴 NUR eine ausdrueckliche Wahl darf eine bestehende Zeile umtypen.
    $retype = avesmapsSourceRetypeAllowed($type, $retype);
    // Beim ANLEGEN braucht die Spalte trotzdem einen Wert; „keine Aussage" ist dort 'sonstiges'.
    $type = $gewaehlteArt !== '' ? $gewaehlteArt : 'sonstiges';
    $hash = avesmapsFeatureSourceHash($url, $wikiKey);
    // Step 2: the key is no longer just a hash ingredient -- it is STORED. Until now it was
    // computed here and thrown away because the column did not exist, which is the whole gap
    // section 1 of the instruction describes. Both wiki syncs already pass it, so they need no
    // change; the editor path passes the key avesmapsResolvePublicationIdentityFromUrl proved.
    //
    // Fill, never blank: a later caller without a key (an editor adding the same url by hand) must
    // not erase a key the wiki established. Same one-way rule the label refresh follows.
    // 💣 Lizenz und Namensnennung FUELLEN, nie leeren -- dieselbe Einbahnregel wie beim wiki_key
    // darueber. Ein spaeterer Aufrufer ohne Angabe (ein Editor, der dieselbe Adresse von Hand
    // nachtraegt) darf nicht loeschen, was einmal erfasst wurde. Wer sie AENDERN will, tut das im
    // Quellen-Editor, wo die Aenderung sichtbar ist.
    // 🔴 EIN Putzer fuer ALLE Schreiber -- siehe avesmapsNormalizeSourceLabel.
    $label = avesmapsNormalizeSourceLabel($label);
    $license = avesmapsNormalizeSourceLicense($license);
    $attribution = avesmapsNormalizeSingleLine($attribution, 200);
    $pdo->prepare(
        "INSERT INTO sources (url, url_hash, wiki_key, label, source_type, is_official, created_by, license, attribution)
         VALUES (:u, :h, :wk, :l, :t, :o, :cb, :lic, :attr)
         ON DUPLICATE KEY UPDATE
             " . avesmapsSourceUpsertOnDuplicateSql($refreshLabel, $retype)
    )->execute([
        'u' => $url, 'h' => $hash, 'wk' => $wikiKey !== '' ? $wikiKey : null,
        'l' => $label, 't' => $type, 'o' => $official ? 1 : 0, 'cb' => $userId > 0 ? $userId : null,
        'lic' => $license, 'attr' => $attribution,
    ]);
    return (int) $pdo->query('SELECT id FROM sources WHERE url_hash = ' . $pdo->quote($hash))->fetchColumn();
}

// Element <-> source link (idempotent). $origin/$refKind/$pages/$note are for the future
// wiki-publication reconcile task; existing callers (editor) omit them and keep origin='manual'
// with empty reference fields, unchanged from before.
// Re-linking (ON DUPLICATE KEY UPDATE) always refreshes reference_kind/pages/note. origin/status
// follow a two-caller contract:
//   - $origin='manual' (editor add/re-add, avesmapsAddFeatureSource): manual ALWAYS wins -- origin
//     is forced to 'manual' and status is resurrected to 'approved', even over an existing
//     'suppressed' wiki-origin tombstone, so a manual re-add of a previously-suppressed URL
//     becomes visible again instead of silently staying hidden (status='approved' reads).
//   - $origin='wiki_publication' (wiki reconcile, avesmapsPublicationReconcileEntity in
//     api/_internal/wiki/publication-sync.php): never demotes an existing 'manual' origin, and
//     never touches/resurrects status -- a 'suppressed' tombstone stays suppressed. (The
//     reconcile's diff already excludes suppressed rows from add/update; this is a second,
//     SQL-level guarantee of the same invariant.)
function avesmapsFeatureSourceLink(PDO $pdo, string $entityType, string $publicId, int $sourceId, int $userId, string $origin = 'manual', ?string $refKind = null, ?string $pages = null, ?string $note = null): void
{
    $pdo->prepare(
        "INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, created_by, origin, reference_kind, pages, note)
         VALUES (:t, :id, :sid, 'approved', :cb, :o, :rk, :pg, :nt)
         ON DUPLICATE KEY UPDATE
             reference_kind = VALUES(reference_kind),
             pages = VALUES(pages),
             note = VALUES(note),
             origin = IF(VALUES(origin) = 'manual' OR feature_sources.origin = 'manual', 'manual', VALUES(origin)),
             status = IF(VALUES(origin) = 'manual', 'approved', feature_sources.status)"
    )->execute([
        't' => $entityType,
        'id' => $publicId,
        'sid' => $sourceId,
        'cb' => $userId > 0 ? $userId : null,
        'o' => $origin,
        'rk' => $refKind,
        'pg' => $pages,
        'nt' => $note,
    ]);
}

// ATOMAR + verlustfrei: legacy properties.other_source -> Katalog + Verknüpfung, DANN Feld leeren.
// Nur map_features-Typen (settlement/region/path) tragen other_source. Idempotent (leer -> no-op).
function avesmapsFeatureSourcesTakeoverOtherSource(PDO $pdo, string $entityType, string $publicId, int $userId): void
{
    if (!in_array($entityType, ['settlement', 'region', 'path'], true)) {
        return;
    }
    $stmt = $pdo->prepare("SELECT id, properties_json FROM map_features WHERE public_id = :id AND is_active = 1 LIMIT 1");
    $stmt->execute(['id' => $publicId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return;
    }
    $props = json_decode((string) $row['properties_json'], true);
    if (!is_array($props)) {
        return;
    }
    $other = $props['other_source'] ?? null;
    $url = is_array($other) ? trim((string) ($other['url'] ?? '')) : '';
    if ($url === '') {
        return; // nichts zu übernehmen
    }
    $label = is_array($other) ? trim((string) ($other['label'] ?? '')) : '';
    $pdo->beginTransaction();
    try {
        $sourceId = avesmapsFeatureSourceUpsert($pdo, $url, $label, 'sonstiges', false, $userId); // Quelle ist jetzt sicher im Katalog
        avesmapsFeatureSourceLink($pdo, $entityType, $publicId, $sourceId, $userId);
        unset($props['other_source']); // ERST JETZT das alte Feld leeren
        $pdo->prepare("UPDATE map_features SET properties_json = :p, revision = :r WHERE id = :id")
            ->execute(['p' => avesmapsEncodeJson($props), 'r' => avesmapsNextMapRevision($pdo), 'id' => (int) $row['id']]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

// Liste FÜR DEN EDITOR: erst Takeover (konsolidiert other_source), dann alle Katalog-Quellen (mit source_id
// zum Löschen) + der feste Wiki-Link. Einheitlich -> keine Sonderfälle in der UI.
function avesmapsListFeatureSourcesForEdit(PDO $pdo, string $entityType, string $publicId, int $userId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    avesmapsFeatureSourcesTakeoverOtherSource($pdo, $entityType, $publicId, $userId);
    $stmt = $pdo->prepare(
        "SELECT s.id AS source_id, s.url, s.label, s.source_type, s.is_official, s.license, s.attribution,
                s.wiki_key,
                fs.origin, fs.reference_kind, fs.pages
           FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
          WHERE fs.entity_type = :t AND fs.entity_public_id = :id AND fs.status = 'approved'
          ORDER BY s.is_official DESC, s.created_at ASC, s.id ASC"
    );
    $stmt->execute(['t' => $entityType, 'id' => $publicId]);
    // 'origin' lets the editor UI (review-feature-sources.js) group wiki-derived rows
    // ('wiki_publication') under their own "automatisch" heading, separate from manual/community.
    // 'pages' surfaces a source's page citation so the editor row can show it (e.g. "S. 12").
    // 'reference_kind' surfaces a source's coverage classification (ausfuehrlich/ergaenzend/erwaehnung
    // or '') so the editor row can show + round-trip it, and syncFeatureSourcesToClientCache can fold it
    // into the popup globals -> a freshly classified source lands in the right tab without a reload.
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    // Wie viele Objekte zitieren jede dieser Katalogzeilen? Das Bearbeiten-Formular sagt es an der
    // Ueberschrift seiner Katalog-Haelfte und entscheidet daran, ob es nachfragt.
    // ⚠️ EINE gruppierte Abfrage, nicht eine je Zeile: `source_id` ist die DRITTE Spalte des UNIQUE
    // (entity_type, entity_public_id, source_id) und traegt keinen eigenen Index — je Zeile
    // korreliert waeren das bei zwanzig Quellen zwanzig Tabellendurchlaeufe statt einem. Die
    // Tabelle ist klein (59.538 Zeilen, gemessen 01.09.2026); wird das je ein Brennpunkt, ist ein
    // Index auf (source_id, status) die Antwort, nicht eine zweite Zaehlweise.
    $usage = [];
    $ids = array_values(array_unique(array_map(static fn(array $r): int => (int) $r['source_id'], $rows)));
    if ($ids !== []) {
        $platzhalter = implode(', ', array_fill(0, count($ids), '?'));
        $usageStmt = $pdo->prepare(
            "SELECT source_id, COUNT(*) AS n FROM feature_sources
              WHERE source_id IN ({$platzhalter}) AND status = 'approved' GROUP BY source_id"
        );
        $usageStmt->execute($ids);
        foreach ($usageStmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $usage[(int) $row['source_id']] = (int) $row['n'];
        }
    }

    $sources = array_map(static function (array $r) use ($usage): array {
        $id = (int) $r['source_id'];

        return [
            'source_id' => $id, 'url' => (string) $r['url'], 'label' => (string) $r['label'],
            'type' => (string) $r['source_type'], 'official' => (int) $r['is_official'] === 1,
            'origin' => (string) $r['origin'], 'pages' => (string) ($r['pages'] ?? ''),
            'reference_kind' => (string) ($r['reference_kind'] ?? ''),
            'license' => (string) ($r['license'] ?? ''),
            'attribution' => (string) ($r['attribution'] ?? ''),
            // Wie viele Objekte diese Katalogzeile zitieren — mindestens dieses eine.
            'usage_count' => $usage[$id] ?? 1,
            // 🔴 Pflegt der Wiki-Abgleich Titel und „offiziell" dieser Zeile? Gemessen am
            // gespeicherten `wiki_key`, nicht am `origin` der VERKNUEPFUNG: dieselbe Katalogzeile
            // kann an einem Objekt von Hand und an einem anderen vom Abgleich haengen — besitzen
            // tut sie der Abgleich in beiden Faellen.
            'wiki_owned' => trim((string) ($r['wiki_key'] ?? '')) !== '',
        ];
    }, $rows);
    return [
        'ok' => true,
        'sources' => $sources,
        'wiki_url' => avesmapsFeatureSourcesReadWikiUrl($pdo, $entityType, $publicId),
        // Post-takeover map_features.revision so an editor that guards its save with
        // expected_revision can refresh its cached token -- the takeover above bumps the
        // revision when it consolidates a legacy other_source (null for territory: no map row).
        'revision' => avesmapsFeatureSourcesReadRevision($pdo, $entityType, $publicId),
    ];
}

// Current optimistic-locking token (map_features.revision) for settlement/region/path; null for
// territory (no map_features row). Read AFTER the takeover in the list response so a caller learns
// the bumped value rather than a stale one.
function avesmapsFeatureSourcesReadRevision(PDO $pdo, string $entityType, string $publicId): ?int
{
    // Only the map_features-backed types have a revision. Territories and citymaps live in their own
    // tables, so their public_id must NEVER be looked up here: it would silently return ANOTHER feature's
    // revision on an id collision, rather than the "no revision" this returns.
    // A powerline IS a map_features row and has a revision, so it belongs here -- without it the
    // source editor would get a null locking token. It stays OUT of the two other_source lists
    // above: that legacy single-source field was never written for powerlines.
    if (!in_array($entityType, ['settlement', 'region', 'path', 'powerline'], true)) {
        return null;
    }
    $s = $pdo->prepare("SELECT revision FROM map_features WHERE public_id = :id AND is_active = 1 LIMIT 1");
    $s->execute(['id' => $publicId]);
    $value = $s->fetchColumn();
    return $value === false ? null : (int) $value;
}

// Der feste Wiki-Link (read-only): settlement/region/path aus properties.wiki_url; territory aus political_territory.wiki_url.
function avesmapsFeatureSourcesReadWikiUrl(PDO $pdo, string $entityType, string $publicId): string
{
    if ($entityType === 'territory') {
        $s = $pdo->prepare("SELECT wiki_url FROM political_territory WHERE public_id = :id LIMIT 1");
        $s->execute(['id' => $publicId]);
        return trim((string) ($s->fetchColumn() ?: ''));
    }
    // A lore entry lives in its own table and DOES have a wiki article -- that article is the whole
    // reason the entry exists. Its public id IS its wiki_key (see the entity_public_id note in
    // avesmapsEnsureFeatureSourceTables), so the lookup is by that key.
    if ($entityType === 'lore') {
        try {
            $s = $pdo->prepare('SELECT wiki_url FROM lore_entry WHERE wiki_key = :id LIMIT 1');
            $s->execute(['id' => $publicId]);

            return trim((string) ($s->fetchColumn() ?: ''));
        } catch (Throwable) {
            return ''; // no lore tables on this installation -> no wiki link, not a 500
        }
    }
    // A citymap is not a map_features row and has no wiki page of its own (Spec §3.1 gives it no
    // wiki_url column). Falling through to the lookup below would query map_features with a citymap id
    // and, on a collision, hand back an unrelated feature's wiki_url.
    if ($entityType === 'citymap') {
        return '';
    }
    $s = $pdo->prepare("SELECT properties_json FROM map_features WHERE public_id = :id AND is_active = 1 LIMIT 1");
    $s->execute(['id' => $publicId]);
    $props = json_decode((string) ($s->fetchColumn() ?: ''), true);
    return is_array($props) ? trim((string) ($props['wiki_url'] ?? '')) : '';
}

/**
 * $retype = „diese Wahl der Art gilt auch fuer eine BEREITS BEKANNTE Quelle" -- und die Vorgabe
 * ist nein.
 *
 * 🔴 Die Erlaubnis haengt am AUFRUFER, nicht am Wert. Genau EIN Aufrufer setzt sie: die
 * Eingabezeile des Quellen-Editors (api/edit/map/feature-sources.php), wo ein angemeldeter Editor
 * die Art ausdruecklich waehlt. Die angenommene Gemeinschaftsmeldung (api/edit/reports/locations.php)
 * setzt sie NICHT -- deren Art kommt aus einem fremden Formular und darf keine katalogweit
 * geteilte Zeile umschreiben.
 */
function avesmapsAddFeatureSource(PDO $pdo, string $entityType, string $publicId, string $url, string $label, string $type, bool $official, int $userId, string $pages = '', string $referenceKind = '', string $license = '', string $attribution = '', bool $retype = false): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    // Publication-link normalization (dedup): if the URL is a Wiki-Aventurica article for a KNOWN
    // publication, resolve it to the SAME identity the wiki reconcile uses (chosen_url or URL-less
    // wiki_key) so a manual/community link and the wiki-reconciled row become ONE feature_source (the
    // manual row then wins the override) instead of the same book appearing twice. Guarded so the app
    // layer still works when the wiki lib is not loaded (then: no normalization, prior behavior).
    $upsertUrl = $url;
    $upsertWikiKey = '';
    if (function_exists('avesmapsResolvePublicationIdentityFromUrl')) {
        $identity = avesmapsResolvePublicationIdentityFromUrl($pdo, $url);
        if (is_array($identity)) {
            $upsertUrl = (string) ($identity['url'] ?? '');
            $upsertWikiKey = (string) ($identity['wiki_key'] ?? '');
        }
    }
    // 🔴 Was VORHER dastand -- gelesen, BEVOR der Upsert es ueberschreibt, damit die Antwort die
    // Korrektur benennen kann. Eine stille Aenderung an einer katalogweit geteilten Zeile waere
    // dieselbe Falle wie die stille Nicht-Aenderung davor, nur in die andere Richtung.
    // ⚠️ Kein try/catch darum: die Tabellen stehen (avesmapsEnsureFeatureSourceTables lief oben),
    // und ein geschluckter SQL-Fehler saehe hier exakt aus wie „die Art war schon richtig".
    // 🔴 UNBEDINGT, nicht mehr nur bei $retype. Der Katalog dedupliziert ueber `url_hash` (UNIQUE):
    // eine schon bekannte Adresse VERKNUEPFT mit der bestehenden Zeile, statt eine neue anzulegen --
    // und das geschah bis zum 01.09.2026 voellig stumm. Die Kachel „bestehende Quelle" haengt an der
    // NAMENS-Vorschlagsliste (`pickedSourceId`), nicht am Adressfeld; wer eine Adresse einfuegt, sah
    // also nicht, welcher der beiden Faelle eingetreten war. Owner-Frage: „erkennt er die Quelle
    // beim Einfuegen automatisch, und wenn nicht, legt er eine neue an?" -- er tut beides, er sagt
    // es nur nicht.
    // 💣 Und die Verwechslung ist nicht folgenlos: `label` FUELLT beim Verknuepfen nur eine Luecke,
    // der eingetippte Titel wird also verworfen und die Zeile erscheint unter fremdem Namen.
    // `is_official` wird dagegen UNBEDINGT ueberschrieben -- ein Haken, den niemand bewusst gesetzt
    // hat, gilt danach katalogweit.
    $vorher = $pdo->prepare('SELECT id, label, source_type, is_official FROM sources WHERE url_hash = :h LIMIT 1');
    $vorher->execute(['h' => avesmapsFeatureSourceHash($upsertUrl, $upsertWikiKey)]);
    $bestehendeZeile = $vorher->fetch(PDO::FETCH_ASSOC);
    $bestehendeZeile = is_array($bestehendeZeile) ? $bestehendeZeile : null;
    $vorherigeArt = $retype ? (string) ($bestehendeZeile['source_type'] ?? '') : '';
    // ⚠️ Lizenz und Namensnennung reisen mit -- ohne sie kann ausser dem Import niemand etwas
    // eintragen, und das Feld waere Zierde (Owner 27.08.2026).
    $sourceId = avesmapsFeatureSourceUpsert($pdo, $upsertUrl, $label, $type, $official, $userId, $upsertWikiKey, false, $license, $attribution, $retype);
    // Manual/community add: origin stays 'manual'. reference_kind is OPTIONAL classification of how the
    // place is covered in this source -- ausfuehrlich/ergaenzend -> the "Offiziell" publication tab,
    // erwaehnung -> the "Erwähnt" tab, empty -> the flat "Quelle(n):" line (buildSourceListMarkup splits
    // purely on reference_kind presence). Stored so an editor- or community-classified source renders in
    // the matching tab exactly like a wiki-reconciled publication. An optional free-form page citation is
    // stored alongside. Both capped to their column widths (16 / 120). Unknown kinds fall back to null.
    $allowedKinds = ['ausfuehrlich', 'ergaenzend', 'erwaehnung'];
    $refKind = in_array($referenceKind, $allowedKinds, true) ? $referenceKind : null;
    $pagesValue = trim($pages);
    avesmapsFeatureSourceLink($pdo, $entityType, $publicId, $sourceId, $userId, 'manual', $refKind, $pagesValue !== '' ? mb_substr($pagesValue, 0, 120) : null);
    // Step 6: if this source IS an adventure, the place joins its "Abenteuer in …" list right away
    // -- no confirmation step (owner). Guarded because the adventure library is not loaded on every
    // surface that adds a source; without it the source link simply stands on its own, as before.
    if (function_exists('avesmapsGameLiteratureLinkPlaceFromSource')) {
        avesmapsGameLiteratureLinkPlaceFromSource($pdo, $sourceId, $entityType, $publicId, $userId);
    }
    // Cache invalidation (Fix #1): a new source link changes the element's rendered source list,
    // which rides in the ETag-cached map-features payload (W/"mf-<map_revision>-..."). Bump the SAME
    // global map_revision counter ordinary editor edits use so warm-cache clients don't keep a stale
    // 304. avesmapsNextMapRevision is available because api/edit/map/feature-sources.php loads
    // api/_internal/map/features.php (the same reason the other_source takeover below can call it).
    // The trailing list-for-edit's takeover only bumps when it consolidates a legacy other_source,
    // which in the normal editor flow already happened during the initial `list` -> single bump here.
    avesmapsNextMapRevision($pdo);
    $antwort = avesmapsListFeatureSourcesForEdit($pdo, $entityType, $publicId, $userId); // Takeover passiert hier drin
    // Die Korrektur wird BENANNT. Der Editor soll sehen, dass er soeben eine Zeile geaendert hat,
    // die ueberall zitiert wird -- und ohne diese Rueckmeldung waere die Aenderung genauso still
    // wie die verschluckte Wahl davor.
    $neueArt = avesmapsNormalizeSourceType($type);
    if ($retype && $neueArt !== '' && $vorherigeArt !== '' && $vorherigeArt !== $neueArt) {
        $antwort['retyped'] = [
            'source_id' => $sourceId,
            'from' => $vorherigeArt,
            'to' => $neueArt,
            'label' => $label,
        ];
    }

    // 🔴 „ANGELEGT oder VERKNUEPFT?" -- die Antwort auf die Frage, die das Adressfeld bis hierher
    // verschwiegen hat. Gemeldet wird nur der ueberraschende Fall: beim ANLEGEN zeigt die neue Zeile
    // genau das, was der Editor eingetippt hat, da gibt es nichts zu erklaeren. Beim VERKNUEPFEN
    // erscheint sie unter dem gespeicherten Titel -- und wer den nicht erwartet, haelt das fuer
    // einen Fehler. Dieselbe Logik wie bei `retyped` darueber: Schweigen auf dem erwarteten Weg,
    // Sprache auf dem ueberraschenden.
    $verknuepft = avesmapsFeatureSourceLinkedReport($bestehendeZeile, $label, $official);
    if ($verknuepft !== null) {
        $antwort['linked'] = $verknuepft;
    }

    return $antwort;
}

/**
 * ══ EINE QUELLENZEILE BEARBEITEN — UND SIE HAT ZWEI REICHWEITEN ═══════════════════════════════
 * Entwurf: docs/quellen-bearbeiten-mockup.html (Owner-GO 01.09.2026)
 *
 * 🔴 DAS IST DER GANZE GRUND, WARUM ES DIESE FUNKTION SO SPAET GIBT: `pages` und `reference_kind`
 * gehoeren der VERKNUEPFUNG und gelten nur an diesem einen Objekt. `label`, `source_type`,
 * `license`, `attribution` und `is_official` gehoeren der KATALOGZEILE und gelten ueberall, wo die
 * Quelle zitiert wird. Live gemessen am 01.09.2026 (map-features.php, eine Anfrage): 59.538
 * Verknuepfungen auf 1.561 zitierte Katalogzeilen — Median 6 Objekte je Zeile, p95 146, MAXIMUM
 * 1.549 („Aventurien – Das Lexikon des Schwarzen Auges"). Ein Formular, das beide Haelften in
 * einen Topf wirft, laesst einen Editor mit einem Klick 1.549 Infoboxen umschreiben, ohne dass er
 * es merkt — genau die Richtung, aus der Meldung #105 entstanden ist, nur groesser.
 */
const AVESMAPS_FEATURE_SOURCE_LINK_FIELDS = ['pages', 'reference_kind'];
/**
 * 🔴 `url` IST SEIT DEM 01.09.2026 DABEI (Owner: „mach auch, dass die URL korrigiert werden kann").
 * Hier stand vorher ausdruecklich das Gegenteil -- „die Adresse ist NICHT editierbar, url_hash IST
 * die Identitaet". Das Argument war richtig und ist es noch; die Folgerung war zu streng. Die
 * Verknuepfungen zeigen auf `sources.id`, nicht auf den Hash: eine Adresse laesst sich also samt
 * ihrem Hash umschreiben, und JEDES zitierende Objekt folgt von selbst.
 * 💣 Was NICHT geht, ist eine Adresse zu nehmen, die schon einer anderen Katalogzeile gehoert --
 * das waere ein ZUSAMMENLEGEN, und dafuer gibt es `avesmapsMergeSourceInto` samt Protokoll. Der
 * Upsert wuerde am UNIQUE scheitern; wir sagen es vorher und nennen die andere Zeile.
 */
const AVESMAPS_FEATURE_SOURCE_CATALOG_FIELDS = ['url', 'label', 'source_type', 'license', 'attribution', 'is_official'];

/**
 * 💣 DIE ZWEI FELDER, DIE DER WIKI-ABGLEICH SELBST PFLEGT — eine Handkorrektur daran waere eine
 * Luege. `avesmapsPublicationReconcileEntity` (api/_internal/wiki/publication-sync.php) ruft den
 * Katalog-Upsert mit `refreshLabel = true` und schreibt `is_official` unbedingt; an einer Zeile mit
 * gesetztem `wiki_key` stuende beim naechsten Lauf wieder der Wikiwert da. Wir bieten die Aenderung
 * deshalb gar nicht erst an, statt sie anzunehmen und still zuruecknehmen zu lassen.
 * ⚠️ `source_type`, `license` und `attribution` fasst der Abgleich NICHT an (retype-Vorgabe ist
 * nein, Lizenz und Namensnennung sind fuellend) — die bleiben auch dort aenderbar.
 *
 * 🔴 `url` steht aus einem ANDEREN Grund in derselben Liste: bei einer Wiki-Publikation gehoert die
 * IDENTITAET dem Abgleich. Er rechnet den Hash aus SEINER `chosen_url` (bzw. aus dem `wiki_key`,
 * wenn es keine gibt) — eine von Hand geaenderte Adresse fuehrt beim naechsten Lauf nicht zu einer
 * Korrektur, sondern zu einer ZWEITEN Katalogzeile fuer dasselbe Werk. Gleiche Sperre, anderer
 * Grund; wer die Liste einmal aufteilt, muss beide Gruende mitnehmen.
 */
const AVESMAPS_FEATURE_SOURCE_WIKI_OWNED_FIELDS = ['url', 'label', 'is_official'];

/**
 * Ab wie vielen zitierenden Objekten eine Katalogaenderung ausdruecklich bestaetigt werden muss.
 * 🔴 Darunter NICHT: 530 der 1.561 zitierten Zeilen (34 %) haengen an genau einem Objekt, und dort
 * waere eine Rueckfrage ein Klick fuer nichts.
 */
const AVESMAPS_FEATURE_SOURCE_CONFIRM_THRESHOLD = 10;

/** Welcher Haelfte gehoert ein Feld? 'link' | 'catalog' | '' fuer unbekannt. */
function avesmapsFeatureSourceFieldScope(string $field): string
{
    if (in_array($field, AVESMAPS_FEATURE_SOURCE_LINK_FIELDS, true)) {
        return 'link';
    }

    return in_array($field, AVESMAPS_FEATURE_SOURCE_CATALOG_FIELDS, true) ? 'catalog' : '';
}

/**
 * Wie viele Objekte zitieren diese Katalogzeile?
 *
 * ⚠️ BEWUSST OHNE `avesmapsFeatureSourceLiveEntityClause`. Die Zahl ist eine Warngroesse, keine
 * oeffentliche Angabe: sie entscheidet nur, ob gefragt wird. Der Live-Filter traegt ein
 * `COLLATE utf8mb4_unicode_ci` (MySQL-only, siehe die Narbe an der Klausel selbst) und waere gegen
 * SQLite nicht pruefbar; und eine Zeile, die auch auf weich geloeschte Objekte zeigt, faellt hier
 * zu GROSS aus — also in die fragende, sichere Richtung.
 */
function avesmapsFeatureSourceUsageCount(PDO $pdo, int $sourceId): int
{
    $statement = $pdo->prepare(
        "SELECT COUNT(*) FROM feature_sources WHERE source_id = :sid AND status = 'approved'"
    );
    $statement->execute(['sid' => $sourceId]);

    return (int) $statement->fetchColumn();
}

/** Der Fehlerumschlag dieser Funktion — der Endpunkt macht daraus seine HTTP-Antwort. */
function avesmapsFeatureSourceUpdateError(int $status, string $code, string $message, array $extra = []): array
{
    return array_merge(['ok' => false, 'error' => ['status' => $status, 'code' => $code, 'message' => $message]], $extra);
}

/**
 * Eine Quellenzeile aendern. `$fields` enthaelt NUR, was jemand angefasst hat.
 *
 * 💣 „NUR WAS ANGEFASST WURDE" IST DIE TRAGENDE REGEL, und sie ist im Haus schon einmal gebrochen
 * worden: `avesmapsUpsertGameLiterature` stempelte jedes MITGESCHICKTE Feld, und das Formular
 * schickt alle mit — nach EINEM Speichern trug dort jedes Feld „von Hand". Hier waere der Schaden
 * groesser: ein leer gelassenes Feld wuerde eine gepflegte Angabe an bis zu 1.549 Objekten
 * loeschen. Der Client schickt deshalb einen Schluessel nur, wenn sein Wert sich geaendert hat,
 * und der Server schreibt zusaetzlich nur, was sich WIRKLICH vom Bestand unterscheidet.
 *
 * ⚠️ Kein Protokoll (Owner-Entscheid 01.09.2026) — anders als beim Zusammenlegen, das
 * `source_merge_log` fuehrt. Die Aenderung ist in ihrer Wirkung sichtbar, nicht in ihrer Herkunft.
 */
function avesmapsUpdateFeatureSource(PDO $pdo, string $entityType, string $publicId, int $sourceId, array $fields, int $userId, bool $confirmCatalog = false): array
{
    avesmapsEnsureFeatureSourceTables($pdo);

    if ($fields === []) {
        return avesmapsFeatureSourceUpdateError(400, 'invalid_request', 'Es wurde kein Feld zum Aendern geschickt.');
    }
    // 🔴 Ein unbekanntes Feld ist ein FEHLER, kein stilles Ueberspringen. Ein Client, der ein Feld
    // schickt, das dieser Server nicht kennt, glaubt sonst, er habe es gespeichert.
    foreach (array_keys($fields) as $name) {
        if (avesmapsFeatureSourceFieldScope((string) $name) === '') {
            return avesmapsFeatureSourceUpdateError(400, 'unknown_field', 'Unbekanntes Feld: ' . (string) $name);
        }
    }

    $linkStatement = $pdo->prepare(
        "SELECT pages, reference_kind FROM feature_sources
          WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid AND status = 'approved' LIMIT 1"
    );
    $linkStatement->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $sourceId]);
    $link = $linkStatement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($link)) {
        return avesmapsFeatureSourceUpdateError(404, 'not_found', 'Diese Quelle haengt nicht an diesem Objekt.');
    }

    $catalogStatement = $pdo->prepare(
        'SELECT url, label, source_type, is_official, license, attribution, wiki_key FROM sources WHERE id = :sid LIMIT 1'
    );
    $catalogStatement->execute(['sid' => $sourceId]);
    $catalog = $catalogStatement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($catalog)) {
        return avesmapsFeatureSourceUpdateError(404, 'not_found', 'Die Quelle steht nicht im Katalog.');
    }

    // ---- Normalisieren, und dabei ABLEHNEN statt raten -------------------------------------------
    $neu = [];
    foreach ($fields as $name => $wert) {
        $name = (string) $name;
        switch ($name) {
            case 'pages':
                $neu[$name] = mb_substr(trim((string) $wert), 0, 120);
                break;
            case 'reference_kind':
                $kind = trim((string) $wert);
                if ($kind !== '' && !in_array($kind, ['ausfuehrlich', 'ergaenzend', 'erwaehnung'], true)) {
                    return avesmapsFeatureSourceUpdateError(400, 'invalid_request', 'Unbekannte Abdeckung: ' . $kind);
                }
                $neu[$name] = $kind;
                break;
            case 'url':
                // 🔴 http(s) UND SONST NICHTS. Die Adresse wird in jeder Infobox als `<a href>`
                // ausgegeben; ein `javascript:`-Schema waere von dort aus ausfuehrbar. ⚠️ Der
                // ANLEGE-Weg prueft das bis heute nicht -- das ist eine eigene, aeltere Luecke und
                // kein Grund, sie hier zu wiederholen.
                $adresse = trim((string) $wert);
                if ($adresse === '') {
                    // Eine leere Adresse ist keine Korrektur: der Hash fiele auf sha256('') und
                    // koennte mit jeder anderen leeren Zeile kollidieren. URL-lose Quellen entstehen
                    // ausschliesslich im Wiki-Abgleich, und der ist hier ohnehin gesperrt.
                    return avesmapsFeatureSourceUpdateError(400, 'invalid_request', 'Die Adresse darf nicht leer sein.');
                }
                if (!preg_match('#^https?://#i', $adresse)) {
                    return avesmapsFeatureSourceUpdateError(400, 'invalid_request', 'Die Adresse muss mit http:// oder https:// beginnen.');
                }
                $neu[$name] = $adresse;
                break;
            case 'label':
                $label = avesmapsNormalizeSingleLine((string) $wert, 200);
                // 🔴 Ein LEERER Titel ist keine Korrektur. Die Zeile wuerde in jeder Infobox auf
                // ihre nackte Adresse zurueckfallen, an bis zu 1.549 Stellen gleichzeitig.
                if ($label === '') {
                    return avesmapsFeatureSourceUpdateError(400, 'invalid_request', 'Der Titel darf nicht leer sein.');
                }
                $neu[$name] = $label;
                break;
            case 'source_type':
                // 🔴 Hier ist '' KEINE gueltige Eingabe — anders als beim Anlegen. Eine
                // Katalogzeile TRAEGT immer eine Art; „keine Aussage" hiesse hier, eine
                // vorhandene Angabe zu loeschen, und das ist keine Korrektur. Das Formular
                // bietet den leeren Eintrag deshalb gar nicht erst an.
                $art = avesmapsNormalizeSourceType($wert);
                if ($art === '') {
                    return avesmapsFeatureSourceUpdateError(400, 'invalid_request', 'Unbekannte Quellenart.');
                }
                $neu[$name] = $art;
                break;
            case 'license':
                // ⚠️ '' ist hier gueltig und heisst „nicht erfasst" — wer eine falsch eingetragene
                // Lizenz zuruecknehmen will, muss das koennen. Ein UNBEKANNTER Schluessel wird
                // aber abgelehnt statt auf '' normalisiert: sonst loescht ein Tippfehler die
                // Angabe, und zwar katalogweit.
                $lizenz = strtolower(trim((string) $wert));
                if ($lizenz !== '' && !in_array($lizenz, AVESMAPS_SOURCE_LICENSES, true)) {
                    return avesmapsFeatureSourceUpdateError(400, 'invalid_request', 'Unbekannte Lizenz: ' . $lizenz);
                }
                $neu[$name] = $lizenz;
                break;
            case 'attribution':
                $neu[$name] = avesmapsNormalizeSingleLine((string) $wert, 200);
                break;
            case 'is_official':
                $neu[$name] = $wert === true || $wert === 1 || $wert === '1' ? 1 : 0;
                break;
        }
    }

    // ---- Was aendert sich WIRKLICH? --------------------------------------------------------------
    $bestand = [
        'pages' => (string) ($link['pages'] ?? ''),
        'reference_kind' => (string) ($link['reference_kind'] ?? ''),
        'url' => (string) ($catalog['url'] ?? ''),
        'label' => (string) ($catalog['label'] ?? ''),
        'source_type' => (string) ($catalog['source_type'] ?? ''),
        'license' => (string) ($catalog['license'] ?? ''),
        'attribution' => (string) ($catalog['attribution'] ?? ''),
        'is_official' => (int) ($catalog['is_official'] ?? 0),
    ];
    $aenderungen = [];
    foreach ($neu as $name => $wert) {
        if ($name === 'is_official' ? (int) $bestand[$name] !== (int) $wert : (string) $bestand[$name] !== (string) $wert) {
            $aenderungen[$name] = $wert;
        }
    }

    $katalogAenderungen = array_intersect_key($aenderungen, array_flip(AVESMAPS_FEATURE_SOURCE_CATALOG_FIELDS));
    $linkAenderungen = array_intersect_key($aenderungen, array_flip(AVESMAPS_FEATURE_SOURCE_LINK_FIELDS));
    $usage = avesmapsFeatureSourceUsageCount($pdo, $sourceId);

    if ($katalogAenderungen !== []) {
        $wikiKey = trim((string) ($catalog['wiki_key'] ?? ''));
        if ($wikiKey !== '') {
            $gesperrt = array_intersect(array_keys($katalogAenderungen), AVESMAPS_FEATURE_SOURCE_WIKI_OWNED_FIELDS);
            if ($gesperrt !== []) {
                return avesmapsFeatureSourceUpdateError(
                    409,
                    'wiki_owned_field',
                    'Titel und „offiziell" pflegt der Wiki-Abgleich — von Hand geaendert stuende dort beim naechsten Lauf wieder der Wikiwert.',
                    ['fields' => array_values($gesperrt)]
                );
            }
        }
        // 🔴 DER RIEGEL STEHT HIER, NICHT NUR AM KNOPF. Der Client fragt vorher (er kennt die Zahl
        // aus der Liste), aber ein ausgegrauter Knopf ist kein Riegel — dieselbe Regel wie beim
        // Loeschriegel der Uebernahme-Vorschau, der serverseitig in `apply` steht.
        if ($usage > AVESMAPS_FEATURE_SOURCE_CONFIRM_THRESHOLD && !$confirmCatalog) {
            return avesmapsFeatureSourceUpdateError(
                409,
                'catalog_confirm_required',
                'Diese Aenderung gilt fuer ' . $usage . ' Objekte und muss bestaetigt werden.',
                ['usage_count' => $usage, 'fields' => array_keys($katalogAenderungen)]
            );
        }
    }

    if ($linkAenderungen !== []) {
        $setzen = [];
        $werte = ['t' => $entityType, 'id' => $publicId, 'sid' => $sourceId];
        foreach ($linkAenderungen as $name => $wert) {
            $setzen[] = $name . ' = :' . $name;
            // ⚠️ Leer wird zu NULL, nicht zu ''. Beide Spalten sind NULL-able und der Lesepfad
            // vergleicht gegen NULL; ein '' saehe wie eine gesetzte, leere Angabe aus.
            $werte[$name] = $wert === '' ? null : $wert;
        }
        $pdo->prepare(
            'UPDATE feature_sources SET ' . implode(', ', $setzen)
            . " WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid AND status = 'approved'"
        )->execute($werte);
    }

    if ($katalogAenderungen !== []) {
        $setzen = [];
        $werte = ['sid' => $sourceId];
        foreach ($katalogAenderungen as $name => $wert) {
            $setzen[] = $name . ' = :' . $name;
            $werte[$name] = $wert;
        }
        // 💣 EINE GEAENDERTE ADRESSE ZIEHT IHREN HASH MIT. `url_hash` ist die Identitaet der
        // Quelle (UNIQUE) und wird aus der Adresse gerechnet -- bliebe er stehen, faende der
        // naechste Upsert derselben Adresse die Zeile nicht und legte eine zweite an.
        // 🔴 Gerechnet wird mit `avesmapsFeatureSourceHash`, der EINEN Regel, die auch der Upsert
        // benutzt. Eine zweite Fassung dieser Zeile spaltet den Katalog.
        if (array_key_exists('url', $katalogAenderungen)) {
            $wikiKeyFuerHash = trim((string) ($catalog['wiki_key'] ?? ''));
            $neuerHash = avesmapsFeatureSourceHash((string) $katalogAenderungen['url'], $wikiKeyFuerHash);
            // ⚠️ ZUERST FRAGEN, DANN SCHREIBEN. Gehoert die Adresse schon einer anderen Zeile,
            // waere das ein ZUSAMMENLEGEN und kein Umschreiben -- dafuer gibt es
            // `avesmapsMergeSourceInto` samt `source_merge_log`. Ohne diese Frage schluege der
            // UNIQUE zu, und der Editor bekaeme einen nackten Serverfehler statt der Auskunft,
            // WELCHE Quelle die Adresse schon traegt.
            $belegt = $pdo->prepare('SELECT id, label FROM sources WHERE url_hash = :h AND id <> :sid LIMIT 1');
            $belegt->execute(['h' => $neuerHash, 'sid' => $sourceId]);
            $andere = $belegt->fetch(PDO::FETCH_ASSOC);
            if (is_array($andere)) {
                $andererName = trim((string) ($andere['label'] ?? '')) !== ''
                    ? (string) $andere['label'] : (string) $katalogAenderungen['url'];
                return avesmapsFeatureSourceUpdateError(
                    409,
                    'url_taken',
                    'Diese Adresse gehoert bereits zur Quelle „' . $andererName . '“. Zwei Quellen mit derselben Adresse '
                    . 'kann der Katalog nicht fuehren -- die beiden muessen zusammengelegt werden.',
                    ['conflict_source_id' => (int) $andere['id']]
                );
            }
            $setzen[] = 'url_hash = :url_hash';
            $werte['url_hash'] = $neuerHash;
        }
        $pdo->prepare('UPDATE sources SET ' . implode(', ', $setzen) . ' WHERE id = :sid')->execute($werte);
    }

    // 💣 DER STEMPEL IST TRAGEND. Die Quellen reisen in der ETag-zwischengespeicherten
    // map-features-Nutzlast, und deren ETag haengt allein an `map_revision`. Ohne den Bump
    // bekaeme jeder warme Browser sein 304 und zeigte die alte Angabe unbegrenzt weiter —
    // dieselbe Falle, die die Klimaebene und der Wappen-Notaus schon bezahlt haben. `add` und
    // `remove` bumpen aus genau diesem Grund ebenfalls.
    // ⚠️ Auch wenn NICHTS geschrieben wurde, kostet ein Bump nur einen Zaehlerschritt — er
    // unterbleibt hier trotzdem, damit ein wirkungsloses Speichern nicht die halbe Welt 3 MB
    // neu laden laesst.
    if ($aenderungen !== []) {
        avesmapsNextMapRevision($pdo);
    }

    $antwort = avesmapsListFeatureSourcesForEdit($pdo, $entityType, $publicId, $userId);
    $antwort['updated'] = [
        'source_id' => $sourceId,
        'fields' => array_keys($aenderungen),
        'catalog_fields' => array_keys($katalogAenderungen),
        'usage_count' => $usage,
    ];

    return $antwort;
}

// Removing a link is a SUPPRESSION for a wiki-derived row and a hard DELETE for everything else.
// A wiki-origin row is tombstoned (status='suppressed') instead of deleted so the next WikiSync
// publication reconcile's pure diff (avesmapsPublicationDiffLinks, api/_internal/wiki/publication-sync.php)
// sees status !== 'approved' and never re-adds it. Manual/community rows keep the prior hard-delete
// behaviour unchanged. The branch is keyed off the existing row's own origin (looked up by the
// entity_type+entity_public_id+source_id triple), not off any client-supplied flag.
function avesmapsRemoveFeatureSource(PDO $pdo, string $entityType, string $publicId, int $sourceId, int $userId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);

    $originStmt = $pdo->prepare(
        "SELECT origin FROM feature_sources
          WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid LIMIT 1"
    );
    $originStmt->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $sourceId]);
    $origin = $originStmt->fetchColumn();

    if ($origin === 'wiki_publication') {
        $pdo->prepare(
            "UPDATE feature_sources SET status = 'suppressed'
              WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid"
        )->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $sourceId]);
    } else {
        $pdo->prepare("DELETE FROM feature_sources WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid")
            ->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $sourceId]);
    }

    // Step 6, the reverse path: the place entry this source link created goes with it, immediately
    // and through the same door. An entry that was already there is untouched -- it carries no
    // created_from_source_id, and only rows carrying THIS source id are removed.
    if (function_exists('avesmapsGameLiteratureUnlinkPlaceFromSource')) {
        avesmapsGameLiteratureUnlinkPlaceFromSource($pdo, $sourceId, $entityType, $publicId);
    }
    // Cache invalidation (Fix #1): suppress OR hard-delete both change the element's rendered
    // source list -> bump the same global map_revision counter (ETag seed) ordinary edits use, so
    // warm-cache clients don't keep a stale 304. Same avesmapsNextMapRevision reuse as the add path.
    avesmapsNextMapRevision($pdo);
    return avesmapsListFeatureSourcesForEdit($pdo, $entityType, $publicId, $userId);
}

// Link an EXISTING catalog row to an element (instruction 5a: "Treffer -> direkte Zuweisung").
//
// Deliberately NOT routed through avesmapsAddFeatureSource: that one upserts a source FROM A URL,
// which cannot express "this exact row". A URL-less wiki publication (its url_hash is synthesized
// from the wiki key, see avesmapsFeatureSourceUpsert) has no URL to upsert by, so a pick sent
// through `add` would either be rejected outright or mint a second row for the same work -- which
// is the very thing 5a exists to stop.
//
// origin='manual' is the same contract as the editor add path: manual wins, and re-picking a
// previously suppressed source makes it visible again rather than silently staying hidden.
/**
 * $type ist die ausdrueckliche Wahl der Art aus derselben Eingabezeile, oder '' fuer „keine".
 *
 * 🔴 Die ZWEITE Tuer zum selben Katalogsatz. Wer eine bestehende Quelle aus der Vorschlagsliste
 * waehlt und dabei ihre Art richtigstellt, meint dasselbe wie einer, der sie ueber die URL
 * eintraegt. Eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel (AGENTS.md §11) --
 * und ohne diese Haelfte bliebe #105 fuer jeden bestehen, der den Titel tippt statt die Adresse.
 */
function avesmapsLinkExistingFeatureSource(PDO $pdo, string $entityType, string $publicId, int $sourceId, int $userId, string $pages = '', string $referenceKind = '', string $type = ''): array
{
    avesmapsEnsureFeatureSourceTables($pdo);

    // The id must name a real catalog row. A stale or invented id would otherwise produce a
    // feature_sources row joining to nothing, which surfaces as a source that silently disappeared.
    $exists = $pdo->prepare('SELECT COUNT(*) FROM sources WHERE id = :id');
    $exists->execute(['id' => $sourceId]);
    if ((int) $exists->fetchColumn() === 0) {
        throw new InvalidArgumentException('Diese Quelle gibt es nicht (mehr).');
    }

    // Die Art richtigstellen, falls eine ausdrueckliche Wahl vorliegt und sie abweicht.
    $gewaehlteArt = avesmapsNormalizeSourceType($type);
    $umgetypt = null;
    if ($gewaehlteArt !== '') {
        $art = $pdo->prepare('SELECT source_type, label FROM sources WHERE id = :id LIMIT 1');
        $art->execute(['id' => $sourceId]);
        $zeile = $art->fetch(PDO::FETCH_ASSOC) ?: [];
        $vorherigeArt = (string) ($zeile['source_type'] ?? '');
        if ($vorherigeArt !== '' && $vorherigeArt !== $gewaehlteArt) {
            $pdo->prepare('UPDATE sources SET source_type = :t WHERE id = :id')
                ->execute(['t' => $gewaehlteArt, 'id' => $sourceId]);
            $umgetypt = [
                'source_id' => $sourceId,
                'from' => $vorherigeArt,
                'to' => $gewaehlteArt,
                'label' => (string) ($zeile['label'] ?? ''),
            ];
        }
    }

    $allowedKinds = ['ausfuehrlich', 'ergaenzend', 'erwaehnung'];
    $refKind = in_array($referenceKind, $allowedKinds, true) ? $referenceKind : null;
    $pagesValue = trim($pages);
    avesmapsFeatureSourceLink(
        $pdo,
        $entityType,
        $publicId,
        $sourceId,
        $userId,
        'manual',
        $refKind,
        $pagesValue !== '' ? mb_substr($pagesValue, 0, 120) : null
    );
    // Step 6, same as the add path: picking an existing adventure source connects the place to it.
    if (function_exists('avesmapsGameLiteratureLinkPlaceFromSource')) {
        avesmapsGameLiteratureLinkPlaceFromSource($pdo, $sourceId, $entityType, $publicId, $userId);
    }
    // Same cache invalidation as the add path: the element's rendered source list changed.
    avesmapsNextMapRevision($pdo);
    $antwort = avesmapsListFeatureSourcesForEdit($pdo, $entityType, $publicId, $userId);
    if ($umgetypt !== null) {
        $antwort['retyped'] = $umgetypt;
    }

    return $antwort;
}

// The wiki key of a source, self-healing: reads the column, and when that is empty derives the key
// the way the reconcile would and WRITES IT BACK.
//
// The column alone is not enough, and the first live test of step 6 is how that surfaced. A
// publication reconcile only upserts the sources it is actively placing, so a publication the wiki
// lists no places for is never touched and keeps wiki_key NULL -- even though its identity is known
// beyond doubt (its url_hash IS the identity the reconcile computes). "Die Feuer von Gruuzash" is
// exactly such a case, which is why adding it to a place did nothing at all.
//
// Deriving without storing would leave the column permanently untrustworthy, and section 6 plans to
// put a UNIQUE index on it. So the lookup repairs the row it just read: the column converges on the
// truth through ordinary use, the same self-healing idiom as the other_source takeover.
function avesmapsSourceWikiKeyResolved(PDO $pdo, int $sourceId): string
{
    if ($sourceId <= 0) {
        return '';
    }
    $read = $pdo->prepare('SELECT url_hash, wiki_key FROM sources WHERE id = :id LIMIT 1');
    $read->execute(['id' => $sourceId]);
    $row = $read->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return '';
    }
    $stored = trim((string) ($row['wiki_key'] ?? ''));
    if ($stored !== '') {
        return $stored;
    }

    // Same identity the reconcile computes: sha256 of the chosen shop url, or of 'wikipub:'+key for
    // a publication that has no shop link at all. Matched in SQL so the catalog is scanned once.
    $derive = $pdo->prepare(
        "SELECT wiki_key FROM wiki_publication_catalog
          WHERE (has_link = 1 AND SHA2(chosen_url, 256) = :h1)
             OR (has_link = 0 AND SHA2(CONCAT('wikipub:', wiki_key), 256) = :h2)
          LIMIT 1"
    );
    try {
        $derive->execute(['h1' => (string) $row['url_hash'], 'h2' => (string) $row['url_hash']]);
        $derived = trim((string) ($derive->fetchColumn() ?: ''));
    } catch (Throwable) {
        return ''; // no WikiSync staging on this installation
    }
    if ($derived === '') {
        return '';
    }

    $pdo->prepare('UPDATE sources SET wiki_key = :k WHERE id = :id AND (wiki_key IS NULL OR wiki_key = :empty)')
        ->execute(['k' => $derived, 'id' => $sourceId, 'empty' => '']);
    return $derived;
}

// --- Step 4: work out which sources have a wiki key, WITHOUT writing anything -------------------

// Reads the wiki key a source WOULD get, rather than the one it has. sources.wiki_key is only
// filled by a publication reconcile (step 2), so a report keyed off the column would show nothing
// until after the very run it is supposed to inform. Deriving it from the freshly dumped catalog
// answers the useful question instead: what would the reconcile do, and what collides?
//
// Three routes, and the report says which one produced each key -- "woher" from step 4:
//   stored -- already on the row (a reconcile has run)
//   hash   -- the row IS a reconciled one: its url_hash equals the identity the reconcile computes
//             (sha256 of chosen_url, or of 'wikipub:'+key for a publication with no shop link)
//   url    -- the row points at a Wiki-Aventurica article that resolves to a known publication,
//             redirects included (avesmapsPublicationResolvePublicationKey walks the alias chain)
// No fourth route. Title similarity and shop ids are excluded by invariant 3 -- measured at 1 %.
function avesmapsSourceWikiKeyReport(PDO $pdo, int $sampleLimit = 50): array
{
    avesmapsEnsureFeatureSourceTables($pdo);

    // The identity map the reconcile itself uses, built once from the catalog: hash -> wiki_key.
    $identityByHash = [];
    $catalogTypeByKey = [];
    $catalogTitleByKey = [];
    try {
        $catalog = $pdo->query('SELECT wiki_key, chosen_url, has_link, source_type, title FROM wiki_publication_catalog');
        foreach ($catalog === false ? [] : $catalog->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $key = (string) $row['wiki_key'];
            $hash = (int) ($row['has_link'] ?? 0) === 1
                ? hash('sha256', (string) ($row['chosen_url'] ?? ''))
                : hash('sha256', 'wikipub:' . $key);
            $identityByHash[$hash] = $key;
            $catalogTypeByKey[$key] = (string) ($row['source_type'] ?? '');
            $catalogTitleByKey[$key] = (string) ($row['title'] ?? '');
        }
    } catch (Throwable) {
        // No WikiSync staging on this installation -> every source simply reports "no key".
    }

    $sources = $pdo->query('SELECT id, url, url_hash, wiki_key, label, source_type, is_official FROM sources')
        ?: null;
    $rows = $sources === null ? [] : $sources->fetchAll(PDO::FETCH_ASSOC);

    $byKey = [];
    $routes = ['stored' => 0, 'hash' => 0, 'url' => 0, 'none' => 0];
    foreach ($rows as $row) {
        $id = (int) $row['id'];
        $stored = trim((string) ($row['wiki_key'] ?? ''));
        $key = '';
        $route = 'none';

        if ($stored !== '') {
            $key = $stored;
            $route = 'stored';
        } elseif (isset($identityByHash[(string) $row['url_hash']])) {
            $key = $identityByHash[(string) $row['url_hash']];
            $route = 'hash';
        } elseif (function_exists('avesmapsResolvePublicationIdentityFromUrl')) {
            // Go through avesmapsResolvePublicationIdentityFromUrl rather than calling the key
            // resolver directly: it owns the lazy require chain (sync-monitor's alias-table constant
            // and the political slug helper). Calling past it throws on the first wiki url and the
            // failure lands in the catch below -- a route that silently reports zero instead of
            // saying it is broken. That happened; hence this note.
            //
            // It returns the reconcile's identity INPUTS, not the key, so the result is mapped back
            // through the same hash table the hash route uses -- one definition of identity, not two.
            try {
                $identity = avesmapsResolvePublicationIdentityFromUrl($pdo, (string) $row['url']);
                if (is_array($identity)) {
                    $identityUrl = (string) ($identity['url'] ?? '');
                    $identityKey = (string) ($identity['wiki_key'] ?? '');
                    $identityHash = ($identityUrl === '' && $identityKey !== '')
                        ? hash('sha256', 'wikipub:' . $identityKey)
                        : hash('sha256', $identityUrl);
                    if (isset($identityByHash[$identityHash])) {
                        $key = $identityByHash[$identityHash];
                        $route = 'url';
                    }
                }
            } catch (Throwable) {
                // A single unresolvable url must not sink the whole report.
            }
        }

        $routes[$route]++;
        if ($key === '') {
            continue;
        }
        $byKey[$key][] = [
            'source_id' => $id,
            'label' => (string) $row['label'],
            'type' => (string) $row['source_type'],
            'official' => (int) $row['is_official'] === 1,
            'route' => $route,
        ];
    }

    // How many place links hang on each source -- the number invariant 1 is about.
    $linkCounts = [];
    $countStmt = $pdo->query("SELECT source_id, COUNT(*) AS n FROM feature_sources WHERE status = 'approved' GROUP BY source_id");
    foreach ($countStmt === false ? [] : $countStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $linkCounts[(int) $row['source_id']] = (int) $row['n'];
    }

    // Which resolved keys are an adventure we already know? That is what step 6 will light up.
    $gameLiteratureKeys = [];
    try {
        $adv = $pdo->query("SELECT wiki_key FROM adventure WHERE wiki_key IS NOT NULL AND wiki_key <> ''");
        foreach ($adv === false ? [] : $adv->fetchAll(PDO::FETCH_COLUMN) as $key) {
            $gameLiteratureKeys[(string) $key] = true;
        }
    } catch (Throwable) {
        // adventure table absent -> the count stays 0, the rest of the report is unaffected.
    }

    $merges = [];
    $conflicts = [];
    $linksInMerges = 0;
    $keysHittingGameLiterature = 0;
    foreach ($byKey as $key => $group) {
        if (isset($gameLiteratureKeys[$key])) {
            $keysHittingGameLiterature++;
        }
        if (count($group) < 2) {
            continue;
        }
        $links = 0;
        foreach ($group as $entry) {
            $links += $linkCounts[$entry['source_id']] ?? 0;
        }
        $linksInMerges += $links;

        $types = array_values(array_unique(array_map(static fn(array $e): string => $e['type'], $group)));
        $officials = array_values(array_unique(array_map(static fn(array $e): bool => $e['official'], $group)));
        $entry = [
            'wiki_key' => $key,
            'catalog_title' => $catalogTitleByKey[$key] ?? '',
            'sources' => $group,
            'links_affected' => $links,
            'is_adventure' => isset($gameLiteratureKeys[$key]),
        ];
        $merges[] = $entry;
        // A conflict is a disagreement about WHAT THE WORK IS. Section 6 decided the wiki wins those,
        // but every one is listed so the override is visible rather than silent.
        if (count($types) > 1 || count($officials) > 1) {
            $conflicts[] = $entry + [
                'types' => $types,
                'officials' => $officials,
                'catalog_type' => $catalogTypeByKey[$key] ?? '',
            ];
        }
    }

    // Biggest first: those are the ones worth looking at by hand.
    usort($merges, static fn(array $a, array $b): int => $b['links_affected'] <=> $a['links_affected']);

    return [
        'sources_total' => count($rows),
        'by_route' => $routes,
        'with_key' => $routes['stored'] + $routes['hash'] + $routes['url'],
        'without_key' => $routes['none'],
        'distinct_keys' => count($byKey),
        'keys_matching_an_adventure' => $keysHittingGameLiterature,
        'merge_groups' => count($merges),
        'links_affected_by_merges' => $linksInMerges,
        'conflicts' => count($conflicts),
        // Full list of conflicts (step 4 requires each one named), merges capped to keep the
        // response readable -- the count above is the complete figure.
        'conflict_cases' => $conflicts,
        'merge_sample' => array_slice($merges, 0, max(1, $sampleLimit)),
    ];
}

// --- Source merge (instruction step 5: fold one catalog row into another) -----------------------

// Origin precedence when the SAME element is linked to both the old and the new source: the
// stronger origin wins (manual > community > wiki_publication) and a 'suppressed' status survives.
// Pure so it can be unit-tested without a database -- this rule decides data ownership, and getting
// it wrong silently demotes handwork to sync-owned, which the next reconcile would then overwrite.
function avesmapsMergeWinningLink(array $from, array $into): array
{
    $rank = ['wiki_publication' => 1, 'community' => 2, 'manual' => 3];
    $fromRank = $rank[(string) ($from['origin'] ?? '')] ?? 0;
    $intoRank = $rank[(string) ($into['origin'] ?? '')] ?? 0;
    $winner = $fromRank > $intoRank ? $from : $into;

    // Suppression is a deliberate act on either side and must not be undone by a merge.
    $suppressed = ((string) ($from['status'] ?? '')) === 'suppressed'
        || ((string) ($into['status'] ?? '')) === 'suppressed';

    return [
        'origin' => (string) ($winner['origin'] ?? 'manual'),
        'status' => $suppressed ? 'suppressed' : 'approved',
        // Reference details describe the citation, not the work: keep whichever side has them.
        'pages' => ($into['pages'] ?? null) !== null && (string) $into['pages'] !== ''
            ? $into['pages'] : ($from['pages'] ?? null),
        'reference_kind' => ($into['reference_kind'] ?? null) !== null && (string) $into['reference_kind'] !== ''
            ? $into['reference_kind'] : ($from['reference_kind'] ?? null),
    ];
}

// The alt->neu record demanded by invariant 4: without it, nothing is merged.
function avesmapsEnsureSourceMergeLog(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS source_merge_log (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            merged_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            merged_by INT NULL,
            from_source_id BIGINT UNSIGNED NOT NULL,
            into_source_id BIGINT UNSIGNED NOT NULL,
            entity_type VARCHAR(16) NOT NULL,
            entity_public_id VARCHAR(64) NOT NULL,
            prior_origin VARCHAR(24) NULL,
            prior_status VARCHAR(16) NULL,
            prior_pages VARCHAR(120) NULL,
            prior_reference_kind VARCHAR(16) NULL,
            prior_other_source_url VARCHAR(500) NULL,
            KEY idx_source_merge_from (from_source_id),
            KEY idx_source_merge_entity (entity_type, entity_public_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

// Fold $fromId into $intoId: every element citing the old row ends up citing the new one.
//
// $dryRun=true writes NOTHING and returns exactly what an apply would do -- the report from step 4.
//
// Two populations are folded, because a source reaches an element two ways:
//   1. feature_sources rows pointing at $fromId (the catalog links)
//   2. elements still carrying the old single properties.other_source with the SAME url -- those
//      have no feature_sources row at all. They are converted first via the existing atomic
//      takeover, which puts them into population 1 without a window where the source is nowhere.
//
// Order per element is invariant 5: write the new link, THEN drop the old one. Never the reverse.
function avesmapsMergeSourceInto(PDO $pdo, int $fromId, int $intoId, int $userId, bool $dryRun): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    if ($fromId === $intoId || $fromId <= 0 || $intoId <= 0) {
        throw new InvalidArgumentException('from_source_id und into_source_id muessen verschiedene, gueltige Quellen sein.');
    }

    $read = $pdo->prepare('SELECT id, url, label FROM sources WHERE id IN (:a, :b)');
    $read->execute(['a' => $fromId, 'b' => $intoId]);
    $rows = $read->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if (count($rows) !== 2) {
        throw new InvalidArgumentException('Mindestens eine der beiden Quellen gibt es nicht.');
    }
    $byId = [];
    foreach ($rows as $row) {
        $byId[(int) $row['id']] = $row;
    }
    $fromUrl = trim((string) ($byId[$fromId]['url'] ?? ''));

    // -- population 2: legacy other_source carriers ------------------------------------------------
    // map_features.feature_type is NOT the source system's entity_type: a settlement is stored as
    // 'location'. junction/powerline have no source surface at all and are skipped.
    $entityTypeOf = ['location' => 'settlement', 'path' => 'path', 'region' => 'region', 'label' => 'region'];

    $legacy = [];
    if ($fromUrl !== '') {
        // LIKE is only a coarse pre-filter (the url lives inside properties_json). Every hit is then
        // verified EXACTLY: the url must be this feature's other_source.url, not merely appear
        // somewhere in its JSON. Without that check a feature that cites the url in another field
        // would have its unrelated other_source taken over -- the wrong source, silently.
        $scan = $pdo->prepare(
            "SELECT public_id, feature_type, properties_json FROM map_features
              WHERE is_active = 1 AND properties_json LIKE :needle"
        );
        $scan->execute(['needle' => '%' . str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $fromUrl) . '%']);
        foreach ($scan->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $props = json_decode((string) $row['properties_json'], true);
            $other = is_array($props) ? ($props['other_source'] ?? null) : null;
            $otherUrl = is_array($other) ? trim((string) ($other['url'] ?? '')) : '';
            if ($otherUrl !== $fromUrl) {
                continue;
            }
            $entityType = $entityTypeOf[(string) $row['feature_type']] ?? null;
            if ($entityType === null) {
                continue;
            }
            $legacy[] = ['public_id' => (string) $row['public_id'], 'entity_type' => $entityType];
        }
    }

    if (!$dryRun) {
        avesmapsEnsureSourceMergeLog($pdo);
        foreach ($legacy as $entry) {
            // Atomic and loss-free: creates the catalog link for $fromId, THEN clears the old field.
            // After this the element is an ordinary population-1 row and folds like any other.
            avesmapsFeatureSourcesTakeoverOtherSource($pdo, $entry['entity_type'], $entry['public_id'], $userId);
        }
    }

    // -- population 1: the catalog links (now including everything just taken over) -----------------
    $linkStmt = $pdo->prepare(
        'SELECT entity_type, entity_public_id, origin, status, pages, reference_kind
           FROM feature_sources WHERE source_id = :id'
    );
    $linkStmt->execute(['id' => $fromId]);
    $fromLinks = $linkStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $moved = 0;
    $mergedWithExisting = 0;
    foreach ($fromLinks as $link) {
        $entityType = (string) $link['entity_type'];
        $publicId = (string) $link['entity_public_id'];

        $existing = $pdo->prepare(
            'SELECT origin, status, pages, reference_kind FROM feature_sources
              WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid LIMIT 1'
        );
        $existing->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $intoId]);
        $target = $existing->fetch(PDO::FETCH_ASSOC) ?: null;
        $winner = avesmapsMergeWinningLink($link, $target ?? []);
        if ($target !== null) {
            $mergedWithExisting++;
        }

        if ($dryRun) {
            $moved++;
            continue;
        }

        $pdo->beginTransaction();
        try {
            // 1. the new link FIRST (invariant 5) -- upsert so an existing one takes the winning values
            $pdo->prepare(
                "INSERT INTO feature_sources
                    (entity_type, entity_public_id, source_id, status, created_by, origin, reference_kind, pages)
                 VALUES (:t, :id, :sid, :st, :cb, :o, :rk, :pg)
                 ON DUPLICATE KEY UPDATE status = VALUES(status), origin = VALUES(origin),
                     reference_kind = VALUES(reference_kind), pages = VALUES(pages)"
            )->execute([
                't' => $entityType, 'id' => $publicId, 'sid' => $intoId,
                'st' => $winner['status'], 'cb' => $userId > 0 ? $userId : null,
                'o' => $winner['origin'], 'rk' => $winner['reference_kind'], 'pg' => $winner['pages'],
            ]);

            // 2. the reversal record BEFORE the old link disappears
            $pdo->prepare(
                'INSERT INTO source_merge_log
                    (merged_by, from_source_id, into_source_id, entity_type, entity_public_id,
                     prior_origin, prior_status, prior_pages, prior_reference_kind, prior_other_source_url)
                 VALUES (:by, :from, :into, :t, :id, :o, :st, :pg, :rk, :url)'
            )->execute([
                'by' => $userId > 0 ? $userId : null, 'from' => $fromId, 'into' => $intoId,
                't' => $entityType, 'id' => $publicId,
                'o' => $link['origin'], 'st' => $link['status'],
                'pg' => $link['pages'], 'rk' => $link['reference_kind'],
                'url' => $fromUrl !== '' ? mb_substr($fromUrl, 0, 500) : null,
            ]);

            // 3. only NOW the old link goes
            $pdo->prepare(
                'DELETE FROM feature_sources WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid'
            )->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $fromId]);

            $pdo->commit();
            $moved++;
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }
    }

    if (!$dryRun && $moved > 0) {
        avesmapsNextMapRevision($pdo); // one bump for the whole run, not one per element
    }

    // NOTE the asymmetry, or the two runs look like they disagree: on an APPLY the takeover has
    // already turned the legacy carriers into catalog links, so links_moved counts them too. On a
    // DRY RUN nothing was converted, so links_moved covers only the pre-existing catalog links and
    // the carriers are still listed separately. total_entities is the comparable number.
    return [
        'dry_run' => $dryRun,
        'from' => ['id' => $fromId, 'label' => (string) ($byId[$fromId]['label'] ?? ''), 'url' => $fromUrl],
        'into' => ['id' => $intoId, 'label' => (string) ($byId[$intoId]['label'] ?? '')],
        'legacy_other_source_carriers' => count($legacy),
        'total_entities' => $dryRun ? $moved + count($legacy) : $moved,
        'links_moved' => $moved,
        'merged_with_existing_link' => $mergedWithExisting,
        'entities' => array_map(static fn(array $l): array => [
            'entity_type' => (string) $l['entity_type'],
            'entity_public_id' => (string) $l['entity_public_id'],
            'origin' => (string) $l['origin'],
            'status' => (string) $l['status'],
        ], $fromLinks),
    ];
}

// --- Catalog search (instruction 5a: reference an EXISTING source instead of typing a new one) ---

// feature_sources has no key on source_id alone -- its unique key leads with entity_type, so
// counting how often a source is cited meant a full scan of ~55k rows. Added here and NOT in
// avesmapsEnsureFeatureSourceTables on purpose: that one runs on the map-features hot path
// (AGENTS.md §10) while the search endpoint is only hit while an editor types.
function avesmapsEnsureSourceSearchIndex(PDO $pdo): void
{
    $statement = $pdo->query(
        "SELECT COUNT(*) FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'feature_sources'
            AND INDEX_NAME = 'idx_feature_sources_source'"
    );
    if ($statement !== false && (int) $statement->fetchColumn() === 0) {
        try {
            $pdo->exec('ALTER TABLE feature_sources ADD KEY idx_feature_sources_source (source_id, status)');
        } catch (PDOException) {
            // Two searches racing on a cold table both pass the check above and both try the ALTER;
            // the loser gets "Duplicate key name". The index exists either way, which is all this
            // function promises -- so swallow it rather than turning one keystroke into a 500.
        }
    }
}

// Typeahead over the shared catalog. Matches label OR url, so pasting a link also finds the row
// that already holds it. Prefix hits rank above substring hits, official above unofficial.
// `uses` (how many elements already cite this source) is what tells an editor they picked the
// right row; it is counted only for the handful of rows actually returned, never catalog-wide.
//
// Returns a flat list; the ENDPOINT wraps it in a group. Once sources.wiki_key exists (steps 1+2)
// the adventure and citymap catalogues become a second group and the client renders them unchanged.
function avesmapsSearchSourceCatalog(PDO $pdo, string $query, int $limit): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    avesmapsEnsureSourceSearchIndex($pdo);

    // LIKE wildcards typed by a user are literals, not operators. Backslash first, then % and _.
    $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $query);
    $limit = max(1, min(10, $limit));

    // Distinct placeholder names: the same name twice is only safe under emulated prepares.
    $statement = $pdo->prepare(
        "SELECT id, url, label, source_type, is_official
           FROM sources
          WHERE label LIKE :contains ESCAPE '\\\\' OR url LIKE :contains_url ESCAPE '\\\\'
          ORDER BY (label LIKE :prefix ESCAPE '\\\\') DESC, is_official DESC, label ASC, id ASC
          LIMIT " . $limit
    );
    $statement->execute([
        'contains' => '%' . $escaped . '%',
        'contains_url' => '%' . $escaped . '%',
        'prefix' => $escaped . '%',
    ]);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($rows === []) {
        return [];
    }

    $ids = array_map(static fn(array $row): int => (int) $row['id'], $rows);
    // Same guard as the public read: a link whose element is deleted is not a use. Without it the
    // autocomplete told editors a source was still in use somewhere they could never find.
    $countStatement = $pdo->prepare(
        "SELECT fs.source_id, COUNT(*) AS uses FROM feature_sources fs
          WHERE fs.status = 'approved' AND fs.source_id IN (" . implode(',', array_fill(0, count($ids), '?')) . ")"
        . avesmapsFeatureSourceLiveEntityClause('fs') .
        " GROUP BY fs.source_id"
    );
    $countStatement->execute($ids);
    $uses = [];
    foreach ($countStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $uses[(int) $row['source_id']] = (int) $row['uses'];
    }

    return array_map(static fn(array $row): array => [
        'source_id' => (int) $row['id'],
        'url' => (string) $row['url'],
        'label' => (string) $row['label'],
        'type' => (string) $row['source_type'],
        'official' => (int) $row['is_official'] === 1,
        'uses' => $uses[(int) $row['id']] ?? 0,
    ], $rows);
}

// ---------------------------------------------------------------------------------------------
// DIE ZWEI SAMMLER DER KARTENNUTZLAST. Bis zum 30.08.2026 standen sie in api/app/map-features.php
// -- also in einer ENDPUNKTdatei, die sich nicht einbinden laesst, ohne die ganze Kartenantwort
// auszufuehren. Damit war der einzige Erzeuger der oeffentlichen Quellenliste der einzige, den
// kein Test je ausgefuehrt hat, und genau dort fehlte die Lizenz vier Tage lang unbemerkt.
// Sie gehoeren ohnehin hierher: beide rufen avesmapsFeatureSourceLiveEntityClause, und der
// per-Objekt-Leser darueber (avesmapsReadFeatureSources) ist ihr Geschwister.
// ⚠️ Der Umzug hat die Konstante mitgenommen -- sie hatte NUR diese zwei Leser. Ihre alte
// Warnung ("steht oben im Endpunkt, weil PHP const nicht hoistet") ist damit erledigt: eine
// require_once-Bibliothek wird ganz ausgefuehrt, bevor der Endpunkt seine erste Zeile tut.
// ---------------------------------------------------------------------------------------------

// Die entity_type, die die KARTE aufloest. renderFeatureSourceLine wird ausschliesslich mit
// diesen fuenf aufgerufen (map-features-labels.js, -location-marker-entry.js, -path-rendering.js,
// -powerlines.js, -region-info-markup.js, popups.js) -- alles andere laege im Payload, ohne dass
// es je jemand nachschlaegt. Gelesen von avesmapsLoadFeatureSourceRefs (weiter unten).
//
// 🪤 HIER STAND "STEHT HIER OBEN, NICHT BEI DER FUNKTION" -- die Warnung, dass PHP zwar
// Funktionen hoistet, aber KEINE const auf Dateiebene, und dass der try-Block des Endpunkts
// vorher in avesmapsMapFeaturesRespond() + exit endet (HTTP 500 am 2026-07-28, `php -l` findet
// es nicht). Sie galt der ENDPUNKTdatei. Hier ist sie erledigt: eine require_once-Bibliothek
// wird ganz ausgefuehrt, bevor der Endpunkt seine erste Zeile tut. Der Satz bleibt als Merkposten
// stehen, weil er fuer jede Konstante gilt, die jemand nach api/app/*.php zurueckschiebt.
//
// 'lore' gehoert NICHT dazu, und das ist der teure Teil: Vorkommen (Flora/Fauna/Waren) sind
// keine Kartenobjekte, sie haben ihren eigenen, seitenweise ladenden Endpunkt (api/app/lore.php,
// 200 von ~35.000 Zeilen). Ihre Quellen machten dennoch 3,03 MB von 8,2 MB dieses Blocks aus --
// 33.981 Referenzen ueber 5.087 Eintraege, allein "lore:ork" 19 KB. Wer hier einen Typ ergaenzt,
// muss ihn auf der JS-Seite auch wirklich aufloesen.
//
// 'citymap' bleibt bewusst drin: 631 Referenzen / 0,04 MB, und der Karteneditor schreibt in
// denselben Cache (review-feature-sources.js) -- der Gewinn waere Rauschen, das Risiko nicht.
const AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES = ['settlement', 'region', 'path', 'territory', 'powerline', 'citymap'];

// Shared catalog of every source that is actually linked to at least one element with an approved
// link: { <source_id> => {url,label,type,official[,license][,attribution]} }. One collect-query
// (EXISTS), deduped to one row per source so a source used by many elements is serialized once.
//
// 💣 LIZENZ UND NAMENSNENNUNG FEHLTEN HIER VIER TAGE LANG, UND DAS IST DIE HAELFTE MIT RECHTSFOLGE.
// Die zwei Spalten kamen am 27.08.2026 an `sources` (0c00f191, Owner: "quellen fehlt das
// lizenz-feld"), samt Anzeige im Quellen-Editor und im per-Objekt-Leser avesmapsReadFeatureSources
// darueber. Die KARTE liest ihre Quellen aber nicht ueber diesen Leser, sondern synchron aus der
// Nutzlast -- und dieser Sammler holte fuenf Spalten. Live gemessen am 30.08.2026: 0 von 1695
// Katalogeintraegen trugen eine Lizenz, die Infobox eines garetien.de-Objekts sagte nur "Quelle:
// Briefspiel (Garetien)" und verschwieg "CC BY-NC-SA 3.0 / VolkoV / garetien.de". CC verlangt
// beides an JEDER Kopie. Zwei Erzeuger derselben Quellenliste, und nur einer trug die Angabe --
// eine Regel, die einen von zweien bindet, ist keine Regel.
//
// 💣 UND SIE ERREICHT KEINEN WARMEN BROWSER OHNE EINEN STEMPEL. Der ETag haengt an
// map_revision + AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION; neue FELDER bewegen die Revision nicht.
// Ohne den Versionssprung bekaeme jeder Wiederbesucher sein 304 samt alter Nutzlast -- dieselbe
// Falle wie beim Klimastempel, den Tempowerten und dem Wappen-Notaus (AGENTS.md §10).
//
// ⚠️ LEER HEISST "NICHT ERFASST", NIE "KEINE LIZENZ" (AGENTS.md §11) -- ein leeres Feld wird
// deshalb WEGGELASSEN statt als "" mitgeschickt: 1694 der 1695 Quellen starten leer, und der
// Renderer zeigt fuer beides nichts. Das haelt die Nutzlast klein und trifft dieselbe Aussage.
//
// ⚠️ ZWEI ANLAEUFE, weil dieser Pfad KEIN DDL fahren darf (er ist die heisse Kartenantwort). Auf
// einer Datenbank ohne die zwei Spalten wuerde die Abfrage werfen -- und der Rueckfall des
// try-Blocks ist ein LEERER Katalog, also KEINE einzige Quelle mehr auf der ganzen Karte. Der
// zweite Anlauf ohne die Spalten faellt in die richtige Richtung: Quellen ohne Lizenzangabe.
function avesmapsLoadFeatureSourceCatalog(PDO $pdo): array {
    $abfrage = static function (string $spalten): string {
        return "SELECT s.id, s.url, s.label, s.source_type, s.is_official" . $spalten . "
               FROM sources s
              WHERE EXISTS (
                    SELECT 1 FROM feature_sources fs
                     WHERE fs.source_id = s.id AND fs.status = 'approved'"
            . avesmapsFeatureSourceLiveEntityClause('fs') . "  )";
    };
    $statement = false;
    try {
        // Same clause as the refs below: a source whose only links hang on deleted elements is
        // not in use and has no business in the shared catalog.
        $statement = $pdo->query($abfrage(", s.license, s.attribution"));
    } catch (Throwable $error) {
        try {
            $statement = $pdo->query($abfrage(""));
        } catch (Throwable $zweiter) {
            return [];
        }
    }
    if ($statement === false) {
        return [];
    }
    $catalog = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $eintrag = [
            'url' => (string) $row['url'],
            'label' => (string) $row['label'],
            'type' => (string) $row['source_type'],
            'official' => (int) $row['is_official'] === 1,
        ];
        $license = trim((string) ($row['license'] ?? ''));
        $attribution = trim((string) ($row['attribution'] ?? ''));
        if ($license !== '') {
            $eintrag['license'] = $license;
        }
        if ($attribution !== '') {
            $eintrag['attribution'] = $attribution;
        }
        $catalog[(int) $row['id']] = $eintrag;
    }
    return $catalog;
}

// Per-entity approved source references grouped in PHP (no N+1): { "<entity_type>:<public_id>" =>
// [ {source_id[, reference_kind][, pages][, note]} ] }. Ordered official-first then insertion order
// so buildSourceListMarkup keeps a stable within-group order. Null/empty detail fields are omitted
// to keep the payload compact. Try/catch -> [] (tables or the Task-1 detail columns may be absent).
function avesmapsLoadFeatureSourceRefs(PDO $pdo): array {
    $placeholders = implode(', ', array_fill(0, count(AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES), '?'));
    try {
        $statement = $pdo->prepare(
            // 💣 The live-entity clause is what keeps a DELETED element from shipping its sources.
            // The delete is soft, so the link outlives the element -- 216 elements with 4.714 links
            // on 2026-08-05. This is THE public path: sources travel in this payload, there is no
            // per-popup fetch any more. Cost is one unique-key lookup per link.
            "SELECT fs.entity_type, fs.entity_public_id, fs.source_id, fs.reference_kind, fs.pages, fs.note
               FROM feature_sources fs
               JOIN sources s ON s.id = fs.source_id
              WHERE fs.status = 'approved'
                AND fs.entity_type IN (" . $placeholders . ")"
            . avesmapsFeatureSourceLiveEntityClause('fs') .
            " ORDER BY fs.entity_type, fs.entity_public_id, s.is_official DESC, s.created_at ASC, s.id ASC"
        );
        $statement->execute(AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES);
    } catch (Throwable $error) {
        return [];
    }
    if ($statement === false) {
        return [];
    }
    $refs = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $key = (string) $row['entity_type'] . ':' . (string) $row['entity_public_id'];
        $ref = ['source_id' => (int) $row['source_id']];
        if (($row['reference_kind'] ?? '') !== '') {
            $ref['reference_kind'] = (string) $row['reference_kind'];
        }
        if (($row['pages'] ?? '') !== '') {
            $ref['pages'] = (string) $row['pages'];
        }
        if (($row['note'] ?? '') !== '') {
            $ref['note'] = (string) $row['note'];
        }
        $refs[$key][] = $ref;
    }
    return $refs;
}

// feature_type -> der entity_type, unter dem die Quellen dieses Objekts stehen. VIER Eintraege,
// nicht drei: `powerline` fehlte in der ersten Fassung, weil sie aus
// avesmapsMapFeaturesMergeLegacyOtherSources abgeschrieben wurde -- deren Kommentar „only these
// three feature types are in scope" galt fuer die ALTQUELLEN, nicht fuer den Kanon. Kraftlinien
// tragen `properties.wiki_url` (api/edit/map/powerlines.php:67), stehen in
// AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES oben und rendern eine Kanonzeile
// (js/map-features/map-features-powerlines.js). Eine geerbte Zuordnung erbt auch ihren blinden Fleck.
//
// ⚠️ 'territory' und 'citymap' stehen bewusst NICHT hier und KOENNEN es nicht: die Zuordnung
// uebersetzt `map_features.feature_type`, und dort gibt es keinen, der ein Territorium oder einen
// Stadtplan UNTER DESSEN EIGENER public_id fuehrt. Sie erreichen den Namensraum-Rang deshalb nie
// -- siehe den Absatz „NUR OBJEKTE MIT KARTENZEILE" im Kopf von avesmapsFeatureSourcesDeriveKanon.
// ⚠️ Praeziser als „Territorien haben hier gar keine Zeile", was hier zuerst stand: es gibt sehr
// wohl aktive Zeilen mit `feature_type = 'region'` aus dem alten Seed-Import, die
// Territoriumsflaechen tragen (api/_internal/political/territories-layer.php liest sie als
// Rueckfallgeometrie). Sie aendern am Ergebnis nichts -- ihre public_id ist nicht die des
// Territoriums, und 'region' schluesselt hierher als Landschaftslabel --, aber die Begruendung
// „gibt es nicht" waere falsch und faende beim naechsten Blick in die Tabelle ihren Widerspruch.
const AVESMAPS_MAP_FEATURES_KANON_ENTITY_TYPE_BY_FEATURE_TYPE = [
    'location' => 'settlement',
    'label' => 'region',
    'path' => 'path',
    'powerline' => 'powerline',
];

/**
 * Der Wiki-Namensraum je Objekt -- der dritte Eingang der Kanon-Ableitung darunter.
 *
 * 🔴 AUS `properties.wiki_url`, NICHT AUS EINER NEUEN SPALTE. Ein aus ns 222 uebernommenes
 * Objekt traegt keine eigene Katalogquelle; sein Artikel steckt in dieser Adresse und wird vom
 * Quellenkasten ohnehin als erste Zeile gerendert.
 *
 * 💣 NIMMT DIE FERTIGEN GeoJSON-OBJEKTE, NICHT DIE DATENBANKZEILEN. Die erste Fassung las
 * `$row['properties']` -- diese Spalte gibt es nicht, sie heisst `properties_json`, und die
 * Funktion gab in Produktion AUSNAHMSLOS `[]` zurueck. Kein Test schlug an, kein Fehler wurde
 * geworfen: „kein Etikett" ist ein gueltiger Zustand, also war der ganze ns-222-Rang wortlos tot.
 * Der Schluesseltausch allein haette es NICHT geheilt -- zwei weitere Gruende zwingen hierher:
 *
 * ⚠️ 1. DIE ADRESSE ENTSTEHT ERST SPAETER. `avesmapsEnrichMapFeatureWikiUrl` FUELLT `wiki_url`
 * ueberhaupt erst per Namensabgleich gegen `wiki_sync_pages`, wenn die gespeicherte leer ist, und
 * achtet dabei auf `wiki_no_article` und den Kraftlinien-Riegel. Aus der Rohzeile gelesen haette
 * das Etikett an einem ANDEREN Artikel gehangen als der Link daneben im selben Kasten.
 * ⚠️ 2. GRABSTEINE. Bei gesetztem `since_revision` laesst avesmapsBuildMapFeaturesQuery
 * `is_active = 1` fallen; geloeschte Objekte reisen als Grabstein mit. Deren GeoJSON traegt nur
 * `deleted`/`revision` und nie eine `wiki_url` -- der Riegel unten faellt hier von selbst, statt
 * als dritte handgeschriebene Kopie der `is_active`-Pruefung.
 *
 * ⚠️ Nur Objekte MIT erkennbarem Namensraum landen in der Karte. Der Hauptraum (ns 0) und alles
 * Unbekannte fehlen bewusst -- die Ableitung fragt mit `?? null` und darf keinen Unterschied
 * zwischen „Hauptraum" und „nicht nachgesehen" erfinden.
 *
 * @param list<array<string, mixed>> $features fertige GeoJSON-Objekte, NICHT die Rohzeilen
 * @return array<string, int> "typ:public_id" => Namensraum
 */
function avesmapsMapFeaturesWikiNamespaces(array $features): array
{
    $out = [];
    foreach ($features as $feature) {
        $properties = $feature['properties'] ?? null;
        if (!is_array($properties)) {
            continue;
        }
        $entityType = AVESMAPS_MAP_FEATURES_KANON_ENTITY_TYPE_BY_FEATURE_TYPE[
            (string) ($properties['feature_type'] ?? '')
        ] ?? '';
        $publicId = (string) ($properties['public_id'] ?? '');
        if ($entityType === '' || $publicId === '') {
            continue;
        }
        $wikiUrl = trim((string) ($properties['wiki_url'] ?? ''));
        if ($wikiUrl === '') {
            continue;
        }
        $ns = avesmapsWikiNamespaceFromWikiUrl($wikiUrl);
        if ($ns !== null) {
            $out[$entityType . ':' . $publicId] = $ns;
        }
    }

    return $out;
}

/**
 * DAS KANON-ETIKETT JE OBJEKT -- abgeleitet, nie getippt.
 * ---------------------------------------------------------------------------
 * Entwurf: docs/superpowers/specs/2026-08-27-kanon-etikett-design.md
 *
 * 🔴 DIE REGEL, in dieser Reihenfolge (Owner 27.-31.08.2026), Entwurf §2.1:
 *   1. mindestens EINE offizielle Quelle    -> 'offiziell'    (auch neben zehn inoffiziellen)
 *   2. sonst mindestens eine INOFFIZIELLE   -> 'inoffiziell' + dem GENAUEN Bezeichner
 *      Quelle                                  („Briefspiel (Garetien)")
 *   3. sonst inoffizieller WIKI-NAMENSRAUM  -> 'inoffiziell' + Bezeichner „Wiki Aventurica"
 *      (ns 222 Inoffiziell, ns 444 Ilaris)     -- auch ohne jede Quellzeile
 *   4. sonst                                -> gar kein Eintrag (der Besucher sieht nichts;
 *                                              „Ohne Quelle" ist eine reine Editorenanzeige)
 *
 * ⚠️ DIESE LISTE NANNTE EINEN TAG LANG NUR DREI RAENGE und liess den Namensraum ganz weg -- ihr
 * Punkt 3 sagte „gar keine Quelle -> gar kein Eintrag", und das ist seit dem ns-222-Umbau falsch:
 * ein Objekt aus ns 222 OHNE jede Quelle bekommt sehr wohl ein Etikett, das ist der Zweck des
 * Umbaus. Schlimmer noch hiess „Rang 2" oben und im Code darunter Verschiedenes. Wer eine
 * Rangliste in einem Docblock fuehrt, muss sie beim Einbau eines Rangs mitfuehren -- sonst
 * beschreibt sie die Fassung davor und liest sich trotzdem wie eine Zusage.
 * ⚠️ Die Nummern 2 und 3 stehen im CODE in umgekehrter Reihenfolge (der Namensraum wird vorher
 * berechnet, spricht aber nur, wenn keine inoffizielle Quelle da ist). Das Ergebnis ist dieses
 * hier; die Begruendung steht an der Stelle selbst.
 *
 * 🔴 EIN EINTRAG KANN NICHT OFFIZIELL UND INOFFIZIELL SEIN. „Offiziell schlaegt immer
 * inoffiziell": hat ein offizieller Ort zusaetzlich eine Briefspielquelle, bleibt er offiziell --
 * die inoffizielle Quelle aendert nichts daran, dass es ihn im gedruckten Aventurien gibt. Sie
 * bleibt an ihrer Zeile im Quellenkasten sichtbar, nur nicht am Kopf.
 *
 * 💣 HIER STEHT KEIN ANZEIGETEXT. Der Bezeichner faehrt als DATEN mit -- entweder als
 * `bezeichner_label` (alle inoffiziellen Quellen tragen denselben Namen; der haeufige Fall,
 * „Briefspiel (Garetien)") oder als `bezeichner_type` + `bezeichner_count`, aus denen die
 * Anzeige „Briefspiel (2)" baut. Dieselbe Trennung wie beim `source_type`, dessen Whitelist in
 * PHP steht und dessen Beschriftung in js/ui/feature-source-markup.js: wer den Text speichert,
 * kann ihn nie uebersetzen und nie umformulieren, ohne den Bestand anzufassen.
 *
 * 💣 NACH avesmapsMapFeaturesMergeLegacyOtherSources AUFRUFEN, nie davor. Die Altquellen aus
 * `properties.other_source` werden dort erst in Katalog und Verweise gefaltet; davor gerechnet
 * bekaeme jedes Objekt, dessen einzige Quelle eine Altquelle ist, gar kein Etikett.
 *
 * 🔴 DREI EINGAENGE, EINE ANTWORT. Der dritte ist der Wiki-Namensraum des Objekts: ein aus
 * ns 222 uebernommenes Objekt traegt keine eigene Katalogquelle -- sein Artikel steckt in
 * `properties.wiki_url` und wird vom Kasten als erste Zeile gerendert. Eine zusaetzliche
 * `sources`-Zeile dafuer anzulegen war der urspruengliche Plan und haette denselben Artikel
 * ZWEIMAL in den Kasten gestellt.
 *
 * ⚠️ NUR OBJEKTE MIT KARTENZEILE ERREICHEN DEN DRITTEN EINGANG -- eine Grenze des Entwurfs,
 * keine Luecke in der Zuordnung. `avesmapsMapFeaturesWikiNamespaces` uebersetzt
 * `map_features.feature_type`; TERRITORIEN und STADTPLAENE haben in dieser Tabelle gar keine
 * Zeile. Aus dem Dump vom 01.09.2026 gezaehlt (dewa_dump_small.xml.bz2, 252.902 Seiten, 6.457 in
 * ns 222): von 302 ns-222-Kartenentitaeten sind 69 TERRITORIEN. Sie rendern eine Kanonzeile
 * (js/map-features/map-features-region-info-markup.js), erreichen Rang 2 aber nie -- ohne eigene
 * Quelle bleiben sie „unbelegt" statt „inoffiziell". Die ersten beiden Eingaenge greifen bei
 * ihnen normal, ihre Quellen stehen ja im selben Katalog. Wer das aufheben will, braucht einen
 * VIERTEN Eingang aus der Territoriumstabelle, nicht einen fuenften Eintrag in der Zuordnung.
 *
 * @param array<int|string, array<string, mixed>> $catalog source_id => {label, type, official, …}
 * @param array<string, list<array{source_id:int}>> $refs  "typ:public_id" => Verweise
 * @param array<string, int> $wikiNamespaces "typ:public_id" => Namensraum des Wiki-Artikels
 * @return array<string, array<string, mixed>> "typ:public_id" => {kanon, bezeichner_*}
 */
function avesmapsFeatureSourcesDeriveKanon(array $catalog, array $refs, array $wikiNamespaces = []): array
{
    $out = [];
    // 💣 Objekte, deren einzige Herkunft ihr WIKI-ARTIKEL ist, haben gar keinen Verweis -- ueber
    // `$refs` allein waeren sie unerreichbar. Beide Mengen zusammen sind der Suchraum.
    $schluessel = array_unique(array_merge(array_keys($refs), array_keys($wikiNamespaces)));
    foreach ($schluessel as $key) {
        $liste = $refs[$key] ?? [];
        if (!is_array($liste)) {
            $liste = [];
        }
        $hatOffizielle = false;
        $labels = [];
        $typen = [];
        $inoffizielle = 0;
        foreach ($liste as $ref) {
            // 💣 NICHT NACH int WANDELN. Der Katalog traegt neben den echten `sources.id` auch
            // SYNTHETISCHE Schluessel fuer die Altquellen aus `properties.other_source`:
            // `'os:' . $publicId` (map-features.php, avesmapsMapFeaturesMergeLegacyOtherSources).
            // `(int) 'os:abc'` ist 0, der Verweis fand nie eine Katalogzeile und wurde als
            // „ohne Aussage" verworfen -- ausgerechnet der Fall, den der Docblock oben als
            // abgewendet beschreibt. Ein Objekt, dessen EINZIGE Quelle eine Altquelle ist, bekam
            // damit kein Etikett, und weil „kein Etikett" ein gueltiger Zustand ist, fiel es
            // nicht auf. Der Schluessel wird deshalb genommen, wie er ist.
            $id = $ref['source_id'] ?? null;
            $eintrag = (is_int($id) || is_string($id)) ? ($catalog[$id] ?? null) : null;
            if (!is_array($eintrag)) {
                // ⚠️ Ein Verweis ohne Katalogzeile ist KEINE Aussage. Er zaehlt weder als
                // offiziell noch als inoffiziell -- sonst entschiede eine Datenluecke ueber ein
                // Etikett. Der Quellenkasten laesst dieselbe Zeile ebenfalls weg.
                continue;
            }
            if (!empty($eintrag['official'])) {
                $hatOffizielle = true;
                continue;
            }
            $inoffizielle++;
            $label = trim((string) ($eintrag['label'] ?? ''));
            if ($label !== '') {
                $labels[$label] = true;
            }
            $typ = trim((string) ($eintrag['type'] ?? ''));
            if ($typ !== '') {
                $typen[$typ] = true;
            }
        }

        if ($hatOffizielle) {
            $out[$key] = ['kanon' => 'offiziell'];
            continue;
        }

        // 🔴 RANG 2: der Wiki-Namensraum des Objekts. Owner 31.08.2026: „gibt es was Offizielles,
        // ist uns ns 222 egal" -- deshalb steht dieser Zweig NACH der offiziellen Quelle und nicht
        // davor. Liegt der Artikel in einem inoffiziellen Raum, ist das Objekt inoffiziell, auch
        // wenn ihm sonst jede Quellzeile fehlt.
        // ⚠️ `avesmapsWikiNamespaceIsOfficial` gibt `null` fuer einen Raum, der kein Inhalt ist --
        // das ist KEINE Aussage und darf hier nichts ausloesen.
        $ns = $wikiNamespaces[$key] ?? null;
        $raumIstInoffiziell = $ns !== null && avesmapsWikiNamespaceIsOfficial((int) $ns) === false;

        if ($inoffizielle < 1) {
            // 🔴 RANG 2 SPRICHT NUR, WENN RANG 3 SCHWEIGT. Die erste Fassung liess ihn VOR den
            // Quellen entscheiden -- und weil beide Raenge auf dasselbe Urteil hinauslaufen
            // ('inoffiziell'), aenderte er nie den Kanon, sondern ueberschrieb nur den genaueren
            // Bezeichner: ein ns-222-Ort MIT Briefspielquelle stand als „Wiki Aventurica" statt
            // als „Briefspiel (Garetien)" da. Owner 27.08.2026, woertlich: „trotzdem find ichs
            // nett, wenn da briefspiel steht, wenns ein briefspiel-ort ist". Die Vorrangregel des
            // Owners galt „offiziell schlaegt inoffiziell", nicht „ungenau schlaegt genau".
            if ($raumIstInoffiziell) {
                $out[$key] = ['kanon' => 'inoffiziell', 'bezeichner_label' => 'Wiki Aventurica'];
            }
            continue; // sonst: keine verwertbare Quelle, kein inoffizieller Raum -- kein Etikett
        }

        $eintragOut = ['kanon' => 'inoffiziell'];
        if (count($labels) === 1) {
            $eintragOut['bezeichner_label'] = (string) array_key_first($labels);
        } else {
            if (count($typen) === 1) {
                $eintragOut['bezeichner_type'] = (string) array_key_first($typen);
            }
            $eintragOut['bezeichner_count'] = $inoffizielle;
        }
        $out[$key] = $eintragOut;
    }

    return $out;
}
