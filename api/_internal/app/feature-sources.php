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
            own_fields TEXT NOT NULL DEFAULT "",
            no_corpus INTEGER NOT NULL DEFAULT 0,
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
    // ⚠️ LEER heisst "nicht erfasst", NIE "keine Lizenz". Die 1374 vorhandenen Quellen starten
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

    // 🔴 WELCHE FELDER DIESE ZEILE SELBST BESITZT — gegen den Korpus (Owner-Entscheid 02.09.2026:
    // „Quelle soll optional noch haben: Abweichende Lizenz, Abweichende Namensnennung", auf
    // Nachfrage auf alle vier korpuseigenen Felder erweitert).
    //
    // 💣 DER FALL IST NICHT HYPOTHETISCH. Live gemessen am 02.09.2026 stehen in den acht Korpora
    // drei Widersprueche, und keiner davon ist Lizenz oder Nennung: „Der Preis der Macht"
    // (horaswiki.de) ist ein Abenteuer und offiziell, waehrend sein Korpus „Briefspiel" und
    // „nicht offiziell" sagt. Ein Griff an die Art des Korpus buegelte ihn platt, ohne Meldung.
    //
    // ⚠️ EINE Spalte mit einer LISTE, nicht vier Flags: die Menge waechst mit
    // AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS mit, und vier Spalten waeren vier Migrationen.
    // 💣 Und sie ist BEIDSEITIG BEGRENZT gespeichert (",license,is_official," statt
    // "license,is_official"): nur so trifft ein `LIKE '%,license,%'` genau dieses Feld und nicht
    // zufaellig ein laengeres, das es enthaelt.
    if (!$columnExists($pdo, 'sources', 'own_fields')) {
        $pdo->exec("ALTER TABLE sources ADD COLUMN own_fields VARCHAR(190) NOT NULL DEFAULT ''");
    }

    // 🔴 „Kein Korpus verwenden" (Owner 02.09.2026). Eine Aussage ÜBER die Quelle, und sie
    // laesst sich NICHT ableiten: der Korpusschluessel entsteht aus der Domain und ist immer da.
    // Es gibt also keinen anderen Weg, „gehoert bewusst zu keinem Korpus" zu sagen.
    // ⚠️ Vorgabe 0 — der Bestand aendert sich durch die Spalte nicht.
    if (!$columnExists($pdo, 'sources', 'no_corpus')) {
        $pdo->exec("ALTER TABLE sources ADD COLUMN no_corpus TINYINT(1) NOT NULL DEFAULT 0");
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
/**
 * Die Felder, die eine einzelne Quelle GEGEN ihren Korpus behaupten kann.
 *
 * 🔴 Es ist dieselbe Menge wie AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS, und das ist die Regel:
 * „jedes Feld, das der Korpus vorgibt, darf die einzelne Quelle ueberschreiben." Eine Liste mit
 * Ausnahmen merkt sich niemand -- und ausgerechnet die zwei, die der Owner NICHT genannt hat
 * (Art und „offiziell"), sind die einzigen, die den Fall im Bestand heute schon haben.
 * ⚠️ Hier aufgeschrieben und nicht aus der Korpus-Konstante abgeleitet: `source-corpus.php` haengt
 * AN dieser Datei, nicht umgekehrt -- viele Oberflaechen laden nur die Quellen.
 * 💣 Seiten und Abdeckung stehen NICHT darin: die gehoeren der Verknuepfung, nie dem Katalog.
 */
const AVESMAPS_SOURCE_OWNABLE_FIELDS = ['source_type', 'license', 'attribution', 'is_official'];

/** Aus der gespeicherten Form eine Liste. Unbekannte Namen fallen weg. */
function avesmapsSourceOwnFieldsParse(?string $gespeichert): array
{
    $teile = array_filter(array_map('trim', explode(',', (string) $gespeichert)));
    return array_values(array_intersect(AVESMAPS_SOURCE_OWNABLE_FIELDS, $teile));
}

/**
 * Aus einer Liste die gespeicherte Form — beidseitig begrenzt.
 *
 * 💣 DIE FUEHRENDEN UND SCHLIESSENDEN KOMMATA SIND TRAGEND. Ohne sie traefe ein
 * `LIKE '%,license,%'` die erste und die letzte Angabe nicht, und eine Quelle, die als einziges
 * Feld ihre Lizenz besitzt, verloere sie beim naechsten Korpus-Speichern still.
 * ⚠️ Leere Liste heisst LEERE Zeichenkette, nicht "," -- sonst besitzt jede Zeile scheinbar etwas.
 */
function avesmapsSourceOwnFieldsFormat(array $felder): string
{
    $rein = array_values(array_intersect(AVESMAPS_SOURCE_OWNABLE_FIELDS, $felder));
    return $rein === [] ? '' : ',' . implode(',', $rein) . ',';
}

/**
 * Die SQL-Bedingung „diese Zeile besitzt das Feld NICHT" — der Riegel des Korpus-Durchschriebs.
 *
 * 🔴 Er gehoert in JEDEN Erzeuger, der ein korpuseigenes Feld schreibt, nicht nur in den Korpus:
 * der Upsert setzt `is_official` bedingungslos, und eine Regel, die einen von zwei Erzeugern
 * bindet, ist keine Regel (AGENTS.md §11, dreimal bezahlt).
 * ⚠️ Der Feldname wird gegen die Whitelist geprueft und NIE aus einer Anfrage in SQL gereicht.
 */
function avesmapsSourceOwnFieldsSqlGuard(string $feld): string
{
    if (!in_array($feld, AVESMAPS_SOURCE_OWNABLE_FIELDS, true)) {
        throw new InvalidArgumentException('Kein korpuseigenes Feld: ' . $feld);
    }
    return "own_fields NOT LIKE '%," . $feld . ",%'";
}

/**
 * @param bool $setOfficial darf dieser Aufruf `is_official` einer BESTEHENDEN Zeile schreiben? Vorgabe ja,
 *   weil der Wiki-Abgleich und die Importe das seit jeher tun und ihr Verhalten nicht still aendern
 *   duerfen; der EDITOR reicht die Antwort von avesmapsSourceOfficialWriteAllowed herein.
 */
function avesmapsSourceUpsertOnDuplicateSql(bool $refreshLabel, bool $retype, bool $setOfficial = true): string
{
    return "label = " . ($refreshLabel ? "IF(VALUES(label) = '', label, VALUES(label))" : "IF(label = '', VALUES(label), label)") . ",
             is_official = " . ($setOfficial ? 'IF(' . avesmapsSourceOwnFieldsSqlGuard('is_official') . ', VALUES(is_official), is_official)' : 'is_official') . ",
             source_type = " . ($retype ? 'IF(' . avesmapsSourceOwnFieldsSqlGuard('source_type') . ', VALUES(source_type), source_type)' : 'source_type') . ",
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
function avesmapsFeatureSourceLinkedReport(?array $bestehend, string $label, bool $official, bool $officialRefused = false): ?array
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
        // 🔴 Der Haken war AUSDRUECKLICH gesetzt, die Zeile pflegt aber der Wiki-Abgleich -- nicht
        // uebernommen, und das gehoert gesagt (dieselbe Verweigerung wie im ✎: wiki_owned_field).
        'official_refused' => $officialRefused,
    ];
}

/**
 * Darf dieses Eintragen „offiziell" einer BESTEHENDEN Katalogzeile umschreiben?
 *
 * 🔴 DIESELBE REGEL WIE avesmapsSourceRetypeAllowed (Meldung #105): nur eine AUSDRUECKLICHE Wahl, Vorgabe
 * nein. Bis zum 03.09.2026 schrieb der Upsert den Haken des Formulars bedingungslos in den Katalog --
 * ein Editor, der eine bekannte Adresse eintrug und den Haken nie anfasste, legte damit „offiziell = nein"
 * fest, katalogweit. Live an „Geographia Aventurica" (1.319 Objekte) ausgeloest, beim Abnahmelauf von
 * Schritt 3 des Quellen-Umbaus.
 * ⚠️ Und NIE bei einer wiki-gepflegten Zeile (wiki_key gesetzt): das ✎ verweigert genau das mit
 * `wiki_owned_field`, und der Abgleich stellte beim naechsten Lauf ohnehin den Wikiwert zurueck.
 * ⚠️ Eine NEUE Zeile (kein Bestand) braucht den Wert -- dort gilt der Haken, wie er steht.
 */
function avesmapsSourceOfficialWriteAllowed(bool $chosen, ?array $bestehend): bool
{
    if ($bestehend === null) {
        return true;
    }
    if (!$chosen) {
        return false;
    }

    return trim((string) ($bestehend['wiki_key'] ?? '')) === '';
}

function avesmapsFeatureSourceUpsert(PDO $pdo, string $url, string $label, string $type, bool $official, int $userId, string $wikiKey = '', bool $refreshLabel = false, string $license = '', string $attribution = '', bool $retype = false, bool $setOfficial = true): int
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
             " . avesmapsSourceUpsertOnDuplicateSql($refreshLabel, $retype, $setOfficial)
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
    // 🔴 Eine Altquelle sagt NICHTS ueber „offiziell“: steht ihre Adresse schon im Katalog, bleibt die Zeile
    // unberuehrt (avesmapsSourceOfficialWriteAllowed, 03.09.2026) -- 50 der 102 Altadressen sind bekannt,
    // und der Upsert haette ihnen sonst „nein“ aufgedrueckt.
    $bestand = $pdo->prepare('SELECT id, wiki_key FROM sources WHERE url_hash = :h LIMIT 1');
    $bestand->execute(['h' => avesmapsFeatureSourceHash($url)]);
    $bestehend = $bestand->fetch(PDO::FETCH_ASSOC);
    $setOfficial = avesmapsSourceOfficialWriteAllowed(false, is_array($bestehend) ? $bestehend : null);
    $pdo->beginTransaction();
    try {
        $sourceId = avesmapsFeatureSourceUpsert($pdo, $url, $label, 'sonstiges', false, $userId, '', false, '', '', false, $setOfficial); // Quelle ist jetzt sicher im Katalog
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

/** Welche `map_features.feature_type` eine Altquelle tragen koennen -- und als welche Objektart sie im Katalog haengt. */
const AVESMAPS_LEGACY_OTHER_SOURCE_ENTITY_TYPES = ['location' => 'settlement', 'label' => 'region', 'path' => 'path'];

/**
 * DER SAMMEL-TAKEOVER: alle noch gespeicherten `properties.other_source` in den Katalog -- Schritt 4 des
 * Quellen-Umbaus (03.09.2026). Gemessen davor: 314 Altquellen (168 Orte, 30 Beschriftungen, 116 Wege),
 * 102 verschiedene Adressen, 50 davon schon im Katalog.
 *
 * 🔴 TROCKENLAUF IST DIE VORGABE. Er zaehlt und zeigt, was der scharfe Lauf taete (je Objektart, Adressen,
 * davon bekannt, eine Stichprobe) und schreibt in KEINE Tabelle -- dieselbe Zweiteilung wie bei jeder
 * Uebernahme-Vorschau des Hauses (AGENTS.md §11).
 * 🔴 Der scharfe Lauf ruft je Zeile DEN Einzel-Takeover (`avesmapsFeatureSourcesTakeoverOtherSource`) -- keine
 * zweite Fassung der Regeln (Katalog-Upsert, Verknuepfung, Feld leeren, Revision), und je Zeile eine eigene
 * Transaktion: eine kaputte Zeile kostet nicht den ganzen Lauf, sie wird gemeldet.
 * ⚠️ Gedeckelt (`$limit`), weil STRATO keinen langen Lauf in einem Request vertraegt; der Aufrufer wiederholt,
 * bis `remaining` null ist -- was uebernommen ist, hat kein `other_source` mehr und faellt aus der Auswahl.
 * ⚠️ Nur die drei Objektarten mit Quellenflaeche (`AVESMAPS_LEGACY_OTHER_SOURCE_ENTITY_TYPES`), nur aktive
 * Zeilen, nur eine nichtleere Adresse -- exakt die Auswahl des `os:`-Erzeugers in api/app/map-features.php,
 * der nach diesem Lauf faellt.
 */
function avesmapsFeatureSourcesTakeoverAll(PDO $pdo, int $userId, bool $dryRun = true, int $limit = 400): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    $limit = max(1, min(2000, $limit));
    $typen = array_keys(AVESMAPS_LEGACY_OTHER_SOURCE_ENTITY_TYPES);
    $platzhalter = implode(', ', array_fill(0, count($typen), '?'));
    $stmt = $pdo->prepare(
        "SELECT id, public_id, feature_type, properties_json FROM map_features
          WHERE is_active = 1 AND feature_type IN ({$platzhalter}) AND properties_json LIKE '%\"other_source\"%'
          ORDER BY id ASC"
    );
    $stmt->execute($typen);
    $kandidaten = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $props = json_decode((string) $row['properties_json'], true);
        $other = is_array($props) ? ($props['other_source'] ?? null) : null;
        $url = is_array($other) ? trim((string) ($other['url'] ?? '')) : '';
        if ($url === '') {
            continue; // vorhanden, aber leer -- der os:-Erzeuger zeigt das auch nicht
        }
        $kandidaten[] = [
            'entity_type' => AVESMAPS_LEGACY_OTHER_SOURCE_ENTITY_TYPES[(string) $row['feature_type']],
            'public_id' => (string) $row['public_id'],
            'url' => $url,
            'label' => is_array($other) ? trim((string) ($other['label'] ?? '')) : '',
        ];
    }

    $jeTyp = [];
    $adressen = [];
    foreach ($kandidaten as $k) {
        $jeTyp[$k['entity_type']] = ($jeTyp[$k['entity_type']] ?? 0) + 1;
        $adressen[$k['url']] = true;
    }
    $bekannt = 0;
    if ($adressen !== []) {
        $hashes = array_map(static fn (string $u): string => avesmapsFeatureSourceHash($u), array_keys($adressen));
        $ph = implode(', ', array_fill(0, count($hashes), '?'));
        $s = $pdo->prepare("SELECT COUNT(*) FROM sources WHERE url_hash IN ({$ph})");
        $s->execute($hashes);
        $bekannt = (int) $s->fetchColumn();
    }

    $ergebnis = [
        'ok' => true,
        'dry_run' => $dryRun,
        'total' => count($kandidaten),
        'per_type' => $jeTyp,
        'distinct_urls' => count($adressen),
        'known_urls' => $bekannt,
        'sample' => array_slice($kandidaten, 0, 10),
        'done' => 0,
        'failed' => [],
        'remaining' => count($kandidaten),
    ];
    if ($dryRun) {
        return $ergebnis;
    }
    foreach (array_slice($kandidaten, 0, $limit) as $k) {
        try {
            avesmapsFeatureSourcesTakeoverOtherSource($pdo, $k['entity_type'], $k['public_id'], $userId);
            $ergebnis['done']++;
        } catch (Throwable $e) {
            // Gemeldet, nicht geschluckt: ein SQL-Fehler saehe sonst aus wie „nichts zu uebernehmen“.
            $ergebnis['failed'][] = ['entity_type' => $k['entity_type'], 'public_id' => $k['public_id'], 'error' => $e->getMessage()];
        }
    }
    $ergebnis['remaining'] = count($kandidaten) - $ergebnis['done'];

    return $ergebnis;
}

/**
 * Die Quellen einer Beschriftung zu ihrer Flaeche umziehen -- Schritt 5 des Quellen-Umbaus (03.09.2026).
 *
 * 🔴 Die Flaeche traegt die Quellen, die Beschriftung zeigt sie (Entwurf docs/superpowers/specs/
 * 2026-09-03-quellen-landschaften-design.md). Jede Zeile `(region, <label>)` wird zu `(ecosystem, <region>)`;
 * traegt die Flaeche eine Quelle schon, faellt die Zeile des Labels (Seiten und Abdeckung der Flaeche gewinnen).
 * 💣 DUBLETTEN PER DELETE, DANN GLATTES UPDATE -- kein `UPDATE IGNORE`, kein Upsert: die Syntax ist in MySQL und
 * SQLite verschieden, und ein SQLite-Test saehe die MySQL-Regression nicht (die Regel aus dem Eigene-Knoten-Umbau).
 * Der UNIQUE `uq_feature_source (entity_type, entity_public_id, source_id)` braeche sonst beim ersten Umzug einer
 * Quelle, die die Flaeche schon hat. Das `SELECT … FROM (SELECT …) x` erzwingt die Materialisierung, sonst
 * MySQL-Fehler 1093 (AGENTS.md §9).
 * ⚠️ Alle Zustaende wandern mit (auch `suppressed`-Grabsteine des Wiki-Abgleichs): sie gehoeren zur Landschaft.
 * ⚠️ Bumpt KEINE Kartenrevision -- das entscheiden die Aufrufer (der Bindungs-Schreiber bumpt ohnehin, der
 * Sammel-Umzug einmal am Ende).
 */
function avesmapsFeatureSourcesMoveLabelToRegion(PDO $pdo, string $labelPublicId, string $regionPublicId): array
{
    $labelPublicId = trim($labelPublicId);
    $regionPublicId = trim($regionPublicId);
    if ($labelPublicId === '' || $regionPublicId === '') {
        return ['moved' => 0, 'dropped' => 0];
    }
    // 💣 KEIN avesmapsEnsureFeatureSourceTables HIER. Die Aufrufer halten eine Transaktion (update_label, der
    // Sammel-Umzug je Beschriftung), und in MySQL ist `CREATE TABLE IF NOT EXISTS` DDL -- DDL beendet die
    // laufende Transaktion mit einem IMPLIZITEN COMMIT, auch wenn die Tabelle laengst existiert. Beim ersten
    // scharfen Lauf am 03.09.2026 liefen so DELETE und UPDATE im Autocommit, und `commit()` warf danach
    // „There is no active transaction": 489 Beschriftungen als „gescheitert" gemeldet, alle umgezogen, keine
    // Revision gebumpt -- die Nutzlast blieb fuer jeden Besucher alt. Die Tabellen stellt der Aufrufer sicher,
    // VOR seiner Transaktion.
    $dropped = $pdo->prepare(
        "DELETE FROM feature_sources
          WHERE entity_type = 'region' AND entity_public_id = :l
            AND source_id IN (SELECT source_id FROM (SELECT source_id FROM feature_sources
                                                     WHERE entity_type = 'ecosystem' AND entity_public_id = :r) x)"
    );
    $dropped->execute(['l' => $labelPublicId, 'r' => $regionPublicId]);
    $moved = $pdo->prepare(
        "UPDATE feature_sources SET entity_type = 'ecosystem', entity_public_id = :r
          WHERE entity_type = 'region' AND entity_public_id = :l"
    );
    $moved->execute(['r' => $regionPublicId, 'l' => $labelPublicId]);

    return ['moved' => $moved->rowCount(), 'dropped' => $dropped->rowCount()];
}

/**
 * DER SAMMEL-UMZUG: alle Quellen gebundener Beschriftungen zu ihren Flaechen (Schritt 5, 03.09.2026).
 *
 * Gemessen davor (Nutzlast 03.09.2026): 487 gebundene Beschriftungen mit Quellen -> 477 Flaechen, 6.976 Verweise,
 * 6.811 nach Zusammenfuehrung (165 Dubletten); 189 freie Beschriftungen mit Quellen bleiben, wo sie sind.
 * 🔴 TROCKENLAUF IST DIE VORGABE -- zaehlt und zeigt, schreibt in keine Tabelle. Scharf ruft er je Beschriftung
 * avesmapsFeatureSourcesMoveLabelToRegion in einer eigenen Transaktion, gedeckelt, Fehler gemeldet; die
 * Kartenrevision bumpt EINMAL am Ende (die Nutzlast aendert sich fuer jeden Besucher).
 * ⚠️ Die Bindung kommt aus dem EINEN Leser beider Richtungen (avesmapsEcosystemReadLabelRegionMap) -- derselbe,
 * der die Nutzlast fuellt; eine eigene Rechnung hier zoege andere Beschriftungen um, als die Karte fuer gebunden
 * haelt. Das require steht im Rumpf: diese Datei haengt am oeffentlichen Lesepfad.
 */
function avesmapsFeatureSourcesTakeoverLabelSources(PDO $pdo, int $userId, bool $dryRun = true, int $limit = 200): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    require_once __DIR__ . '/ecosystem-label-link.php';
    $limit = max(1, min(2000, $limit));
    $byLabel = avesmapsEcosystemReadLabelRegionMap($pdo)['by_label'] ?? [];
    $jeLabel = [];
    foreach ($pdo->query("SELECT entity_public_id, source_id FROM feature_sources WHERE entity_type = 'region'")->fetchAll(PDO::FETCH_ASSOC) ?: [] as $r) {
        $jeLabel[(string) $r['entity_public_id']][] = (int) $r['source_id'];
    }
    $jeFlaeche = [];
    foreach ($pdo->query("SELECT entity_public_id, source_id FROM feature_sources WHERE entity_type = 'ecosystem'")->fetchAll(PDO::FETCH_ASSOC) ?: [] as $r) {
        $jeFlaeche[(string) $r['entity_public_id']][(int) $r['source_id']] = true;
    }
    $kandidaten = [];
    $zeilen = 0;
    foreach ($jeLabel as $labelId => $sourceIds) {
        $regionId = (string) ($byLabel[(string) $labelId] ?? '');
        if ($regionId === '') {
            continue; // frei: bleibt bei der Beschriftung
        }
        $kandidaten[] = ['label_public_id' => (string) $labelId, 'region_public_id' => $regionId, 'rows' => count($sourceIds), 'source_ids' => $sourceIds];
        $zeilen += count($sourceIds);
    }
    $vereinigung = $jeFlaeche;
    $regionen = [];
    foreach ($kandidaten as $k) {
        $regionen[$k['region_public_id']] = true;
        foreach ($k['source_ids'] as $sid) {
            $vereinigung[$k['region_public_id']][$sid] = true;
        }
    }
    $neuAnFlaechen = 0;
    foreach (array_keys($regionen) as $rid) {
        $neuAnFlaechen += count($vereinigung[$rid] ?? []) - count($jeFlaeche[$rid] ?? []);
    }
    $ergebnis = [
        'ok' => true,
        'dry_run' => $dryRun,
        'labels' => count($kandidaten),
        'regions' => count($regionen),
        'rows' => $zeilen,
        'rows_after' => $neuAnFlaechen,
        'duplicates' => $zeilen - $neuAnFlaechen,
        'sample' => array_map(static fn (array $k): array => ['label_public_id' => $k['label_public_id'], 'region_public_id' => $k['region_public_id'], 'rows' => $k['rows']], array_slice($kandidaten, 0, 10)),
        'done' => 0,
        'moved' => 0,
        'dropped' => 0,
        'failed' => [],
        'remaining' => count($kandidaten),
    ];
    if ($dryRun) {
        return $ergebnis;
    }
    foreach (array_slice($kandidaten, 0, $limit) as $k) {
        try {
            $pdo->beginTransaction();
            $r = avesmapsFeatureSourcesMoveLabelToRegion($pdo, $k['label_public_id'], $k['region_public_id']);
            $pdo->commit();
            $ergebnis['done']++;
            $ergebnis['moved'] += $r['moved'];
            $ergebnis['dropped'] += $r['dropped'];
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            // Gemeldet, nicht geschluckt: ein SQL-Fehler saehe sonst aus wie „nichts umzuziehen".
            $ergebnis['failed'][] = ['label_public_id' => $k['label_public_id'], 'region_public_id' => $k['region_public_id'], 'error' => $e->getMessage()];
        }
    }
    $ergebnis['remaining'] = count($kandidaten) - $ergebnis['done'];
    if ($ergebnis['done'] > 0) {
        avesmapsNextMapRevision($pdo);
    }

    return $ergebnis;
}

/**
 * Die Namen zu einer Handvoll Nutzerkennungen — für „wer hat das eingetragen".
 *
 * 🔴 EINE EIGENE ABFRAGE, KEIN `LEFT JOIN users`. `sources` und `users` teilen sich `id` UND
 * `created_at`; ein Join machte jede unqualifizierte Spalte mehrdeutig. `api/edit/reports/locations.php`
 * hat genau das schon einmal mit einer 500 bezahlt und nennt es dort ausdrücklich.
 *
 * ⚠️ FÄLLT OFFEN AUS. Gibt es die Tabelle nicht (SQLite-Fixture) oder scheitert die Abfrage, bleibt
 * die Liste leer — dann steht nur das Datum da. Die Herkunftsangabe ist eine Auskunft, kein Riegel;
 * sie darf das Öffnen einer Quellenliste niemals verhindern.
 *
 * 💣 NUR FÜR DEN EDITOR-ENDPUNKT. Diese Namen dürfen nie in `api/app/…` oder in die Kartennutzlast
 * geraten — dort läsen sie sich für jeden Besucher. Der Riegel ist die Aufrufstelle: es gibt genau
 * eine, und die hängt hinter `avesmapsRequireUserWithCapability`.
 */
function avesmapsFeatureSourceEditorNames(PDO $pdo, array $ids): array
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids), static fn(int $i): bool => $i > 0)));
    if ($ids === []) {
        return [];
    }
    try {
        $platzhalter = implode(', ', array_fill(0, count($ids), '?'));
        $stmt = $pdo->prepare("SELECT id, username FROM users WHERE id IN ({$platzhalter})");
        $stmt->execute($ids);
        $namen = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $namen[(int) $row['id']] = (string) $row['username'];
        }
        return $namen;
    } catch (Throwable $e) {
        return [];
    }
}

/**
 * Wer und wann — als Paar, oder `null`, wenn beides fehlt.
 *
 * ⚠️ Ein Datum ohne Namen ist eine gültige Auskunft (der Bestand von vor der Anmeldepflicht trägt
 * `created_by = NULL`); ein Namen ohne Datum kann es nicht geben. Fehlt beides, steht `null` da —
 * die Oberfläche zeigt dann gar keine Zeile statt „unbekannt am unbekannt".
 */
function avesmapsFeatureSourceHerkunft(?string $wann, $wer, array $namen): ?array
{
    $wann = trim((string) $wann);
    if ($wann === '') {
        return null;
    }
    $id = (int) $wer;
    return ['at' => $wann, 'by' => $id > 0 ? ($namen[$id] ?? '') : ''];
}

// Liste FÜR DEN EDITOR: erst Takeover (konsolidiert other_source), dann alle Katalog-Quellen (mit source_id
// zum Löschen) + der feste Wiki-Link. Einheitlich -> keine Sonderfälle in der UI.
function avesmapsListFeatureSourcesForEdit(PDO $pdo, string $entityType, string $publicId, int $userId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    avesmapsFeatureSourcesTakeoverOtherSource($pdo, $entityType, $publicId, $userId);
    $stmt = $pdo->prepare(
        "SELECT s.id AS source_id, s.url, s.label, s.source_type, s.is_official, s.license, s.attribution,
                s.wiki_key, s.own_fields, s.created_by AS quelle_von, s.created_at AS quelle_am,
                fs.origin, fs.reference_kind, fs.pages,
                fs.created_by AS beleg_von, fs.created_at AS beleg_am
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
    $sources = avesmapsFeatureSourceEditorRows($pdo, $rows);
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

/**
 * Die Editor-Zeilen aus den rohen Verknuepfungszeilen -- Katalogfelder, Korpus, Reichweite, Herkunft.
 *
 * 🔴 EIN Bauer fuer die Liste eines Objekts UND fuer die Sammelliste ueber einen ganzen Weg
 * (avesmapsListFeatureSourcesForEditMany). Bis zum 03.09.2026 stand er als Rumpf in der Einzelliste;
 * die Sammelliste haette ihn abgeschrieben, und die naechste Spalte waere in einer der beiden
 * Abschriften vergessen worden -- dieselbe Falle wie bei den Listenzeilen (AGENTS.md §11).
 * ⚠️ `$rows` sind die Zeilen der Editor-Abfrage (Katalog JOIN Verknuepfung); die Sammelliste
 * reicht je Katalogzeile GENAU EINE davon herein.
 */
function avesmapsFeatureSourceEditorRows(PDO $pdo, array $rows): array
{
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

    // 🔴 DER KORPUS REIST MIT. Seit dem 02.09.2026 gehoeren Art, Lizenz und Nennung dem Wirt, nicht
    // der einzelnen Zeile -- der Bearbeiten-Kasten muss das SAGEN koennen, sonst verspricht seine
    // Ueberschrift „gilt fuer alle Objekte, die diese Quelle zitieren" eine kleinere Reichweite als
    // die Aenderung hat. Owner-Bild 02.09.2026: dort stand „zurzeit nur dieses Objekt", waehrend
    // ein Griff zur Lizenz 39 Quellen und 50 Objekte getroffen haette.
    // ⚠️ ZWEI Abfragen fuer ALLE Korpora (`…UsageAll`), nicht zwei je Wirt -- sonst zahlte jede
    // Liste mehrere Volldurchgaenge ueber `sources`. Und alles hinter `function_exists`: das
    // Korpus-Modul haengt AN dieser Datei, nicht umgekehrt.
    $korpora = [];
    $korpusReichweite = [];
    if (function_exists('avesmapsSourceCorpusReadAll')) {
        $korpora = avesmapsSourceCorpusReadAll($pdo);
        $korpusReichweite = avesmapsSourceCorpusUsageAll($pdo);
    }
    // Wer hat eingetragen? EINE Abfrage über beide Spalten zusammen — der Katalogeintrag und die
    // Verknüpfung stammen oft von verschiedenen Editoren, und genau das ist die Auskunft.
    $namen = avesmapsFeatureSourceEditorNames($pdo, array_merge(
        array_column($rows, 'quelle_von'),
        array_column($rows, 'beleg_von'),
        array_column($korpora, 'updated_by')
    ));
    return array_map(static function (array $r) use ($usage, $korpora, $korpusReichweite, $namen): array {
        $id = (int) $r['source_id'];
        $korpus = null;
        if ($korpora !== [] || $korpusReichweite !== []) {
            $key = avesmapsSourceCorpusKey((string) $r['url']);
            if ($key !== '') {
                $korpus = [
                    'corpus_key' => $key,
                    // ⚠️ Ohne Korpuszeile traegt der Schluessel sich selbst als Namen -- dieselbe
                    // Regel wie in `avesmapsSourceCorpusForUrl`, damit die Oberflaeche nie leer steht.
                    'label' => (string) ($korpora[$key]['label'] ?? $key),
                    'known' => isset($korpora[$key]),
                    'form' => (string) ($korpora[$key]['form'] ?? ''),
                    // ⚠️ Die korpuseigenen Werte reisen MIT: der Bearbeiten-Kasten zeigt sie in
                    // seiner Korpusgruppe, statt die Werte dieser einen Zeile zu zeigen und dabei
                    // Korpus-Reichweite zu behaupten (Owner 02.09.2026).
                    'source_type' => (string) ($korpora[$key]['source_type'] ?? ''),
                    'license' => (string) ($korpora[$key]['license'] ?? ''),
                    'attribution' => (string) ($korpora[$key]['attribution'] ?? ''),
                    'is_official' => ($korpora[$key]['is_official'] ?? false) === true,
                    // ⚠️ Die DRITTE Herkunft. Der Name kommt aus derselben Aufloesung wie die
                    // zwei anderen -- deshalb reist `updated_by` aus dem Korpus-Leser als ID
                    // und wird ERST HIER, im Editor-Endpunkt, zu einem Namen.
                    'updated' => avesmapsFeatureSourceHerkunft(
                        $korpora[$key]['updated_at'] ?? null,
                        $korpora[$key]['updated_by'] ?? null,
                        $namen
                    ),
                    'sources' => (int) ($korpusReichweite[$key]['sources'] ?? 0),
                    'objects' => (int) ($korpusReichweite[$key]['objects'] ?? 0),
                ];
            }
        }

        return [
            'corpus' => $korpus,
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
            // 🔴 WELCHE KORPUSFELDER DIESE ZEILE SELBST BESITZT. Als LISTE, nicht als gespeicherte
            // Zeichenkette: die begrenzenden Kommata sind eine SQL-Angelegenheit
            // (`avesmapsSourceOwnFieldsSqlGuard`) und haben in der Oberfläche nichts verloren.
            'own_fields' => avesmapsSourceOwnFieldsParse((string) ($r['own_fields'] ?? '')),
            // 🔴 ZWEI HERKÜNFTE, NICHT EINE — und sie fallen auf die zwei Reichweiten des ✎-Kastens:
            // `beleg` sagt, wer diese Quelle HIER angehängt hat, `quelle` sagt, wer sie überhaupt in
            // den Katalog gelegt hat. Bei einer Zeile mit 1.549 Objekten sind das fast nie dieselben.
            // ⚠️ Nur lesbar (Owner 02.09.2026) — es gibt keinen Schreibweg, und es soll keinen geben.
            'created' => [
                'link' => avesmapsFeatureSourceHerkunft($r['beleg_am'] ?? null, $r['beleg_von'] ?? null, $namen),
                'source' => avesmapsFeatureSourceHerkunft($r['quelle_am'] ?? null, $r['quelle_von'] ?? null, $namen),
            ],
        ];
    }, $rows);
}

/**
 * Die Kennungen, ueber die eine Aktion des Quellen-Editors VERTEILT wird -- oder [] fuer „nur das eine".
 *
 * 🔴 DER VERTEILER (Entwurf docs/superpowers/specs/2026-09-03-quellen-wege-design.md §2): ein Weg liegt
 * auf der Karte in Abschnitten, und die Quelle haengt am ABSCHNITT (map_features.public_id). Die Gruppe
 * ist ein Verteiler, keine Ablage: nennt der Rumpf `entity_public_ids`, wird die Aktion je Kennung
 * ausgefuehrt und die Antwort ist die Vereinigung ueber alle. Der Anker `entity_public_id` gehoert immer
 * dazu und steht vorn.
 * 🔴 NUR `path` verteilt. Bei jeder anderen Objektart waere eine Liste fremder Kennungen ein Schlupfloch,
 * um an Objekten zu schreiben, die der Dialog gar nicht zeigt -- deshalb ein Fehler, kein stilles Weglassen.
 * ⚠️ Gedeckelt wie das Sammel-Speichern der Weg-Ebene (AVESMAPS_PATH_GROUP_MAX_SEGMENTS, 250); die laengste
 * Namensgruppe im Bestand hat 57 Abschnitte („Reichsstraße 2").
 * ⚠️ Eine Liste, die nur den Anker nennt, verteilt nichts -- ein einteiliger Weg ist ein Objekt wie jedes.
 */
function avesmapsFeatureSourceDistributionIds(mixed $liste, string $anchor, string $entityType): array
{
    if (!is_array($liste)) {
        return [];
    }
    if ($entityType !== 'path') {
        throw new InvalidArgumentException('entity_public_ids gibt es nur fuer Wege (path).');
    }
    $deckel = defined('AVESMAPS_PATH_GROUP_MAX_SEGMENTS') ? (int) AVESMAPS_PATH_GROUP_MAX_SEGMENTS : 250;
    $ids = [];
    if ($anchor !== '') {
        $ids[] = $anchor;
    }
    foreach ($liste as $wert) {
        if (!is_string($wert) && !is_int($wert)) {
            throw new InvalidArgumentException('entity_public_ids muss eine Liste von Kennungen sein.');
        }
        $id = trim((string) $wert);
        if ($id !== '' && !in_array($id, $ids, true)) {
            $ids[] = $id;
        }
    }
    if (count($ids) > $deckel) {
        throw new InvalidArgumentException('entity_public_ids darf hoechstens ' . $deckel . ' Kennungen nennen.');
    }

    return count($ids) < 2 ? [] : $ids;
}

/**
 * Die Quellen ueber MEHRERE Kennungen derselben Objektart -- die Liste, die der Verteiler zurueckgibt.
 *
 * Je Katalogzeile EINE Editorzeile (die des Ankers gewinnt, sonst die erste gefundene), dazu der Zaehler
 * `segments` / `segments_of`: an wie vielen der Abschnitte sie haengt. Der Editor zeichnet daraus die Marke
 * „12 von 56 Abschnitten" -- NUR bei einer Teilmenge, denn „an allen" ist der Normalfall (2.347 von 2.511
 * Wegquellen, live gemessen 03.09.2026).
 * 🔴 `by_entity` traegt die Verweise JE KENNUNG (source_id, Seiten, Abdeckung): der Kartenspeicher im
 * Browser wird daraus je Abschnitt nachgezogen und bekommt nie die Vereinigung an alle gehaengt.
 * ⚠️ Der Takeover der Altquelle (`other_source`) laeuft je Kennung -- dieselbe Regel wie in der Einzelliste,
 * sonst zeigte die Weg-Ebene eine Altquelle nicht, die der Abschnittsdialog laengst konsolidiert haette.
 * ⚠️ `revision` ist null: ein Sperrtoken gehoert EINEM Kartenobjekt, und die Sammelliste hat viele.
 */
function avesmapsListFeatureSourcesForEditMany(PDO $pdo, string $entityType, array $publicIds, string $anchor, int $userId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    $ids = [];
    if ($anchor !== '') {
        $ids[] = $anchor;
    }
    foreach ($publicIds as $wert) {
        $id = trim((string) $wert);
        if ($id !== '' && !in_array($id, $ids, true)) {
            $ids[] = $id;
        }
    }
    foreach ($ids as $id) {
        avesmapsFeatureSourcesTakeoverOtherSource($pdo, $entityType, $id, $userId);
    }

    $rows = [];
    if ($ids !== []) {
        $platzhalter = implode(', ', array_fill(0, count($ids), '?'));
        $stmt = $pdo->prepare(
            "SELECT fs.entity_public_id, s.id AS source_id, s.url, s.label, s.source_type, s.is_official, s.license, s.attribution,
                    s.wiki_key, s.own_fields, s.created_by AS quelle_von, s.created_at AS quelle_am,
                    fs.origin, fs.reference_kind, fs.pages,
                    fs.created_by AS beleg_von, fs.created_at AS beleg_am
               FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
              WHERE fs.entity_type = ? AND fs.entity_public_id IN ({$platzhalter}) AND fs.status = 'approved'
              ORDER BY s.is_official DESC, s.created_at ASC, s.id ASC"
        );
        $stmt->execute(array_merge([$entityType], $ids));
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    $jeQuelle = [];
    $zaehler = [];
    $byEntity = [];
    foreach ($ids as $id) {
        $byEntity[$id] = [];
    }
    foreach ($rows as $r) {
        $sid = (int) $r['source_id'];
        $eid = (string) $r['entity_public_id'];
        $zaehler[$sid] = ($zaehler[$sid] ?? 0) + 1;
        // Die Zeile des Ankers gewinnt -- Seiten und Abdeckung sind Sache des Abschnitts, und der
        // Editor steht am Anker. Die Reihenfolge der Liste bleibt die der ersten Fundstelle.
        if (!isset($jeQuelle[$sid]) || $eid === $anchor) {
            $jeQuelle[$sid] = $r;
        }
        $byEntity[$eid][] = [
            'source_id' => $sid,
            'pages' => (string) ($r['pages'] ?? ''),
            'reference_kind' => (string) ($r['reference_kind'] ?? ''),
        ];
    }

    $sources = avesmapsFeatureSourceEditorRows($pdo, array_values($jeQuelle));
    foreach ($sources as &$source) {
        $source['segments'] = $zaehler[(int) $source['source_id']] ?? 0;
        $source['segments_of'] = count($ids);
    }
    unset($source);

    return [
        'ok' => true,
        'sources' => $sources,
        'segments_of' => count($ids),
        // ⚠️ Als Objekt, auch leer: der Browser liest `by_entity[id]`, und eine leere PHP-Liste
        // wuerde zu `[]` -- daran scheitert kein Leser, aber ein Test, der die Form prueft, schon.
        'by_entity' => (object) $byEntity,
        'wiki_url' => $anchor !== '' ? avesmapsFeatureSourcesReadWikiUrl($pdo, $entityType, $anchor) : '',
        'revision' => null,
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
    // Eine STAETTE (settlement_place, 02.09.2026 -- ein Objekt ohne Kartenposition, das zu einer Stadt
    // gehoert) ist keine map_features-Zeile; ihr Artikel steht in ihrer eigenen Tabelle. Fiele sie unten
    // in die map_features-Abfrage durch, lieferte eine id-Kollision die Adresse eines FREMDEN Objekts --
    // dieselbe Falle, vor der der citymap-Zweig darunter warnt. Ohne Tabelle: leer, kein 500.
    if ($entityType === 'settlement_place') {
        try {
            $s = $pdo->prepare('SELECT wiki_url FROM settlement_place WHERE public_id = :id LIMIT 1');
            $s->execute(['id' => $publicId]);

            return trim((string) ($s->fetchColumn() ?: ''));
        } catch (Throwable) {
            return '';
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
/**
 * Was ein bekannter Korpus einer NEUEN Katalogzeile vorgibt -- rein, damit die Regel ohne MySQL pruefbar ist.
 *
 * 🔴 GEFUELLT WIRD NUR LEERES: Art, Lizenz und Nennung, wo der Aufrufer nichts gesagt hat. „offiziell" kommt vom
 *   Korpus, wenn niemand den Haken ausdruecklich gesetzt hat ($officialChosen) -- dieselbe Lesart wie
 *   avesmapsSourceOfficialWriteAllowed, eine Stufe frueher.
 * ⚠️ Ein unbekannter Wirt (known=false) oder keine Adresse gibt nichts vor: die Zeile entsteht, wie sie
 *   gemeldet wurde, und die Redaktion sieht in der Vorbelegung „neuer Wirt".
 *
 * @return array{type:string,license:string,attribution:string,official:bool}
 */
function avesmapsFeatureSourceKorpusVorgaben(?array $korpus, string $type, string $license, string $attribution, bool $official, bool $officialChosen): array
{
    $aus = ['type' => $type, 'license' => $license, 'attribution' => $attribution, 'official' => $official];
    if (!is_array($korpus) || ($korpus['known'] ?? false) !== true) {
        return $aus;
    }
    if (avesmapsNormalizeSourceType($type) === '') {
        $aus['type'] = (string) ($korpus['source_type'] ?? '');
    }
    if (trim($license) === '') {
        $aus['license'] = (string) ($korpus['license'] ?? '');
    }
    if (trim($attribution) === '') {
        $aus['attribution'] = (string) ($korpus['attribution'] ?? '');
    }
    if (!$officialChosen) {
        $aus['official'] = ($korpus['is_official'] ?? false) === true;
    }

    return $aus;
}

function avesmapsAddFeatureSource(PDO $pdo, string $entityType, string $publicId, string $url, string $label, string $type, bool $official, int $userId, string $pages = '', string $referenceKind = '', string $license = '', string $attribution = '', bool $retype = false, bool $officialChosen = false): array
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
    $vorher = $pdo->prepare('SELECT id, label, source_type, is_official, wiki_key FROM sources WHERE url_hash = :h LIMIT 1');
    $vorher->execute(['h' => avesmapsFeatureSourceHash($upsertUrl, $upsertWikiKey)]);
    $bestehendeZeile = $vorher->fetch(PDO::FETCH_ASSOC);
    $bestehendeZeile = is_array($bestehendeZeile) ? $bestehendeZeile : null;
    $vorherigeArt = $retype ? (string) ($bestehendeZeile['source_type'] ?? '') : '';
    // ⚠️ Lizenz und Namensnennung reisen mit -- ohne sie kann ausser dem Import niemand etwas
    // eintragen, und das Feld waere Zierde (Owner 27.08.2026).
    // 🔴 Der Kanon-Haken schreibt eine BESTEHENDE Zeile nur bei ausdruecklicher Wahl, und nie eine
    // wiki-gepflegte -- siehe avesmapsSourceOfficialWriteAllowed.
    $setOfficial = avesmapsSourceOfficialWriteAllowed($officialChosen, $bestehendeZeile);
    // 🔴 DIE KORPUSWERTE FUER EINE NEUE ZEILE (Entwurf 2026-09-03-quellen-meldeformular §6.3): ist der Wirt ein
    // bekannter Korpus, bekommt eine NEUE Katalogzeile Art, Lizenz, Nennung und Kanon vom Korpus -- wo der
    // Aufrufer nichts gesagt hat. Bis dahin kannte die Regel nur die Eingabezeile des Editors (der Client
    // belegte die Felder vor); die angenommene Gemeinschaftsmeldung legte eine garetien.de-Zeile als
    // „Sonstiges, inoffiziell, ohne Lizenz" an. Eine BESTEHENDE Zeile bleibt unberuehrt (retype /
    // avesmapsSourceOfficialWriteAllowed gelten unveraendert).
    if ($bestehendeZeile === null && function_exists('avesmapsSourceCorpusForUrl')) {
        $vorgabe = avesmapsFeatureSourceKorpusVorgaben(
            avesmapsSourceCorpusForUrl(avesmapsSourceCorpusReadAll($pdo), $upsertUrl),
            $type, $license, $attribution, $official, $officialChosen
        );
        $type = $vorgabe['type'];
        $license = $vorgabe['license'];
        $attribution = $vorgabe['attribution'];
        $official = $vorgabe['official'];
    }
    $sourceId = avesmapsFeatureSourceUpsert($pdo, $upsertUrl, $label, $type, $official, $userId, $upsertWikiKey, false, $license, $attribution, $retype, $setOfficial);
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
    // Gemeldet wird, was WIRKLICH gespeichert ist: ohne Schreiberlaubnis der alte Katalogwert.
    $offiziellGespeichert = $setOfficial ? $official : ((int) ($bestehendeZeile['is_official'] ?? 0) === 1);
    $verknuepft = avesmapsFeatureSourceLinkedReport($bestehendeZeile, $label, $offiziellGespeichert,
        $bestehendeZeile !== null && $officialChosen && !$setOfficial);
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
 * Verknuepfungen auf 1.240 zitierte Katalogzeilen — Median 14 Objekte je Zeile, p95 171, MAXIMUM
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
const AVESMAPS_FEATURE_SOURCE_CATALOG_FIELDS = ['url', 'label', 'source_type', 'license',
    'attribution', 'is_official', 'own_fields', 'no_corpus'];

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

/**
 * Felder, die WEDER der Verknuepfung NOCH der Katalogzeile gehoeren, sondern dem KORPUS.
 *
 * 🔴 Sie haben in `sources` keine Spalte. Sie duerfen deshalb nie in `$katalogAenderungen` und
 * nie in den Bestandsvergleich -- sie nehmen im Schreibweg eine eigene Spur direkt zum Korpus.
 * 💣 Die Liste ist NICHT dieselbe wie AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS, und das ist der Punkt:
 * jene sagt „gehoert dem Korpus und wird auf seine Quellen DURCHGESCHRIEBEN", diese sagt „gehoert
 * dem Korpus und existiert nur dort". Wer sie zusammenlegt, schriebe `form` in eine Spalte, die
 * es nicht gibt.
 */
const AVESMAPS_FEATURE_SOURCE_CORPUS_ONLY_FIELDS = ['form'];

/**
 * Das Praefix, mit dem ein Feld AUSDRUECKLICH den Korpus meint.
 *
 * 💣 WARUM ES DAS BRAUCHT. Bis zum 03.09.2026 trugen der Korpuswert und die Abweichung
 * DENSELBEN Namen (`license`), und welche Tabelle getroffen wurde, entschied `own_fields`:
 * besitzt die Quelle das Feld, ging der Wert nach `sources`, sonst in den Korpus. Das reichte,
 * solange ein Formular immer nur eines von beiden zeigte. Seit dem Umbau zeigt der ✎ BEIDES
 * nebeneinander (Korpuswert im Korpusrahmen, Abweichung darunter) — mit einem Namen liessen sich
 * die zwei nicht in EINEM Speichern aendern.
 *
 * 🔴 `corpus_license` meint IMMER den Korpus, unabhaengig von `own_fields`. Der blanke Name
 * behaelt seine alte Bedeutung — das ist kein Schoenheitsfehler, sondern der Riegel gegen einen
 * alten, zwischengespeicherten Client: der schickt weiter `license` und trifft damit genau das,
 * was er immer getroffen hat. Wer die alte Spur entfernt, dreht fuer solche Clients die Bedeutung
 * einer Eingabe um, ohne dass jemand es merkt.
 */
const AVESMAPS_FEATURE_SOURCE_CORPUS_PREFIX = 'corpus_';

/** Der Feldname hinter dem Praefix -- oder '' , wenn es keins traegt oder der Rest unbekannt ist. */
function avesmapsFeatureSourceCorpusPrefixed(string $field): string
{
    if (strncmp($field, AVESMAPS_FEATURE_SOURCE_CORPUS_PREFIX, strlen(AVESMAPS_FEATURE_SOURCE_CORPUS_PREFIX)) !== 0) {
        return '';
    }
    $rest = substr($field, strlen(AVESMAPS_FEATURE_SOURCE_CORPUS_PREFIX));
    // ⚠️ NUR bekannte Korpusfelder. Ein `corpus_irgendwas` waere sonst eine Spalte, die es nicht
    // gibt -- und der Korpus-Schreiber bekaeme sie ungeprueft gereicht.
    $erlaubt = array_merge(AVESMAPS_FEATURE_SOURCE_CORPUS_ONLY_FIELDS,
        defined('AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS') ? AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS : []);

    return in_array($rest, $erlaubt, true) ? $rest : '';
}

/** Welcher Haelfte gehoert ein Feld? 'link' | 'catalog' | 'corpus' | '' fuer unbekannt. */
function avesmapsFeatureSourceFieldScope(string $field): string
{
    if (in_array($field, AVESMAPS_FEATURE_SOURCE_LINK_FIELDS, true)) {
        return 'link';
    }
    if (in_array($field, AVESMAPS_FEATURE_SOURCE_CORPUS_ONLY_FIELDS, true)) {
        return 'corpus';
    }
    // Ein ausdruecklich benanntes Korpusfeld (`corpus_license`) gehoert dem Korpus, immer.
    if (avesmapsFeatureSourceCorpusPrefixed($field) !== '') {
        return 'corpus';
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
        'SELECT url, label, source_type, is_official, license, attribution, wiki_key, own_fields FROM sources WHERE id = :sid LIMIT 1'
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
            case 'own_fields':
                // 🔴 DIE ABWEICHUNG: welche korpuseigenen Felder gehoeren AB JETZT dieser Zeile?
                // Der Client schickt die VOLLE Menge, nicht ein Delta -- ein Delta liesse offen,
                // ob ein fehlender Name „unveraendert" oder „zurueckgegeben" heisst.
                // ⚠️ Unbekannte Namen fallen weg (`…Format` schneidet gegen die Whitelist), ein
                // leeres Feld heisst „alles gehoert wieder dem Korpus" -- und das ist eine
                // gueltige Aussage, kein fehlender Wert.
                $neu[$name] = avesmapsSourceOwnFieldsFormat(is_array($wert)
                    ? $wert
                    : avesmapsSourceOwnFieldsParse((string) $wert));
                break;
            case 'no_corpus':
                // „Kein Korpus verwenden" — eine Aussage über die Quelle, nie ueber diese eine
                // Verknuepfung. ⚠️ Wie `is_official` gelesen: alles, was nicht ausdruecklich wahr
                // ist, heisst nein — ein unbekannter Wert darf eine Quelle nicht stillschweigend
                // aus ihrem Korpus nehmen.
                $neu[$name] = ($wert === true || $wert === 1 || $wert === '1') ? 1 : 0;
                break;
        }
    }

    // ---- Was aendert sich WIRKLICH? --------------------------------------------------------------
    $bestand = [
        'pages' => (string) ($link['pages'] ?? ''),
        'reference_kind' => (string) ($link['reference_kind'] ?? ''),
        'url' => (string) ($catalog['url'] ?? ''),
        'no_corpus' => (int) ($catalog['no_corpus'] ?? 0),
        'label' => (string) ($catalog['label'] ?? ''),
        'source_type' => (string) ($catalog['source_type'] ?? ''),
        'license' => (string) ($catalog['license'] ?? ''),
        'attribution' => (string) ($catalog['attribution'] ?? ''),
        'is_official' => (int) ($catalog['is_official'] ?? 0),
        'own_fields' => (string) ($catalog['own_fields'] ?? ''),
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

    // 🔴 WAS DEM KORPUS GEHOERT, WIRD AUCH HIER AM KORPUS GEAENDERT. Owner-Entscheid 02.09.2026:
    // „aender ich ART, LIZENZ, Namensnennung oder Name, aendert sich alles mit" -- und zwar
    // gleichgueltig, ob die Aenderung aus der Eingabezeile kommt oder aus dem ✎ dieser Liste.
    // Owner, direkt danach: „beachte, dass man auch quellen editieren will".
    //
    // 💣 OHNE DAS LIEFEN DIE ZWEI WEGE AUSEINANDER: die Eingabezeile schriebe die Art auf alle
    // 39 Zeilen von westlande.de durch, das ✎ auf genau eine -- und der Korpus behielte still
    // den alten Wert, den er beim naechsten Eintrag wieder vorgibt. Eine Regel, die einen von
    // zwei Erzeugern bindet, ist keine Regel.
    // ⚠️ Nur wenn der Korpus BEKANNT ist. Sonst waere jedes ✎ an einer beliebigen Adresse ein
    // stilles Anlegen -- Korpora entstehen beim Eintragen, nicht beim Korrigieren.
    // ⚠️ Und `label` ist ausgenommen (AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS): das ist der Titel
    // DIESER Seite, nicht der Name des Wirts.
    // 💣 DIE KORPUS-KONSTANTE STEHT INNERHALB DES RIEGELS, nicht davor. `source-corpus.php` haengt
    // AN dieser Datei, nicht umgekehrt (der Zirkel waere sonst da) -- viele Oberflaechen laden also
    // nur die Quellen und kennen `AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS` gar nicht. Ein Zugriff
    // davor waere ein Fatal Error mit LEEREM Rumpf, und der sieht fuer den Client aus wie ein
    // Netzfehler. Beim ersten Bau stand er genau eine Zeile zu hoch.
    $korpusDurchschrieb = null;
    // ⚠️ Die FORM oeffnet diesen Block MIT: sie hat in `sources` keine Spalte, steht also nie in
    // `$katalogAenderungen` -- und wer nur sie aendert, kaeme sonst nie hier an. Genau so waere
    // ein „Speichern", das den Knopf bewegt und nichts tut.
    $formGeschickt = array_key_exists('form', $fields);
    // 💣 UND DIE AUSDRUECKLICH BENANNTEN EBENSO. Wer im ✎ nur die Korpuslizenz aendert,
    // schickt `corpus_license` und sonst nichts -- ohne diese Zeile waere `$katalogAenderungen`
    // leer, `$formGeschickt` falsch, und der Block liefe nie. Ein „Speichern", das den Knopf
    // bewegt und nichts tut, ist genau die Falle, wegen der `$formGeschickt` schon dasteht.
    $ausdruecklich = [];
    foreach ($fields as $name => $wert) {
        $rest = avesmapsFeatureSourceCorpusPrefixed((string) $name);
        if ($rest !== '') {
            $ausdruecklich[$rest] = $wert;
        }
    }
    if (($katalogAenderungen !== [] || $formGeschickt || $ausdruecklich !== [])
        && function_exists('avesmapsSourceCorpusSave')) {
        $korpusFelder = array_intersect_key($katalogAenderungen, array_flip(AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS));
        // 🔴 DIE FORM IST EINE REINE KORPUS-SPALTE. Sie steht seit dem 02.09.2026 im ✎ (Owner:
        // „zieh die form ins ✎") und hat in `sources` KEINE Spalte -- sie darf deshalb weder in
        // `$katalogAenderungen` noch in den Bestandsvergleich, sondern nimmt eine eigene Spur.
        // 💣 Und sie wird NICHT durchgeschrieben: sie sagt, welcher der beiden Namen dem Besucher
        // vorn steht, und ist keine Eigenschaft einer einzelnen Quelle. `avesmapsSourceCorpusSave`
        // trennt das bereits (AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS enthaelt sie nicht) -- hier wird
        // sie nur DORTHIN gereicht.
        if (array_key_exists('form', $fields)) {
            $korpusFelder['form'] = avesmapsSourceCorpusNormalizeForm((string) $fields['form']);
        }
        // 🔴 WAS DIESE ZEILE SELBST BESITZT, GEHT NICHT AN DEN KORPUS (Owner 02.09.2026). Sonst
        // hiesse „weicht ab" nur, dass die Abweichung im selben Zug zur neuen Regel des ganzen
        // Wirts wird -- das genaue Gegenteil.
        // ⚠️ Gemessen am NEUEN Stand ($neu), nicht am gespeicherten: wer in einem Zug die Lizenz
        // aendert UND sie als eigen erklaert, meint beides zusammen.
        $besitz = avesmapsSourceOwnFieldsParse(
            array_key_exists('own_fields', $neu) ? (string) $neu['own_fields'] : (string) $bestand['own_fields']
        );
        $korpusFelder = array_diff_key($korpusFelder, array_flip($besitz));
        // 🔴 DIE AUSDRUECKLICHEN KOMMEN NACH DEM ABZUG DAZU, nicht davor. Sie sagen
        // „Korpus" unabhaengig davon, ob die Quelle das Feld besitzt -- genau dafuer gibt es sie.
        // Davor eingesetzt naehme `array_diff_key` sie gleich wieder heraus, und der ✎ koennte
        // die Korpuslizenz einer abweichenden Quelle nie aendern: der Rahmen „Gilt fuer den
        // ganzen Korpus" bewegte sich, und nichts geschaehe.
        // ⚠️ Sie ueberschreiben einen gleichnamigen Wert aus der alten Spur — wer beides
        // schickt, hat sich ausdruecklich entschieden.
        foreach ($ausdruecklich as $name => $wert) {
            $korpusFelder[$name] = $name === 'form'
                ? avesmapsSourceCorpusNormalizeForm((string) $wert)
                : $wert;
        }
        // 💣 EINE QUELLE OHNE KORPUS SCHREIBT KEINEN. `no_corpus` heisst, dass sie fuer sich
        // steht; ein Schreibvorgang auf den Wirt waere dann eine Aenderung an einem Korpus, zu dem
        // sie gar nicht gehoert -- und er traefe alle ANDEREN Quellen dieses Wirts.
        $ohneKorpus = array_key_exists('no_corpus', $neu)
            ? ((int) $neu['no_corpus'] === 1)
            : ((int) ($bestand['no_corpus'] ?? 0) === 1);
        $korpusKey = ($korpusFelder === [] || $ohneKorpus)
            ? ''
            : avesmapsSourceCorpusKey((string) ($catalog['url'] ?? ''));
        $bekannte = avesmapsSourceCorpusReadAll($pdo);
        if ($korpusKey !== '' && isset($bekannte[$korpusKey])) {
            $ergebnis = avesmapsSourceCorpusSave($pdo, $korpusKey, $korpusFelder, $userId, true);
            if (($ergebnis['ok'] ?? false) === true) {
                $korpusDurchschrieb = [
                    'corpus_key' => $korpusKey,
                    'label' => (string) ($ergebnis['corpus']['label'] ?? $korpusKey),
                    'objects' => (int) ($ergebnis['corpus']['objects'] ?? 0),
                    'fields' => array_keys($korpusFelder),
                ];
            }
        }
    }

    $antwort = avesmapsListFeatureSourcesForEdit($pdo, $entityType, $publicId, $userId);
    $antwort['updated'] = [
        'source_id' => $sourceId,
        'fields' => array_keys($aenderungen),
        'catalog_fields' => array_keys($katalogAenderungen),
        'usage_count' => $usage,
    ];
    // ⚠️ BENANNT, nicht verschwiegen: wer eine Zeile aendert und dabei 50 Objekte trifft, muss das
    // erfahren -- dieselbe Regel wie bei `retyped` und `linked`.
    if ($korpusDurchschrieb !== null) {
        $antwort['corpus_applied'] = $korpusDurchschrieb;
    }

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
// ⚠️ `ecosystem` seit dem 03.09.2026 (Schritt 5 des Quellen-Umbaus): die Flaeche traegt die Quellen einer Landschaft,
// die gebundene Beschriftung liest sie unter `ecosystem:<region_public_id>`. Ohne den Typ hier reisten die 6.811
// umgezogenen Verweise nie in die Nutzlast -- die Falle der leeren Flaechenkaesten vom 26.08.2026, andersherum.
const AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES = ['settlement', 'region', 'path', 'territory', 'powerline', 'citymap', 'ecosystem'];

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
/**
 * Hängt einer Katalogzeile ihren Korpusschlüssel an -- die EINE Stelle, die das tut.
 *
 * 💣 ES GAB ZWEI ERZEUGER VON KATALOGZEILEN (bis zum 03.09.2026), und dass nur einer den Schlüssel setzte, war am
 * 02.09.2026 live ein Fehler. Neben dieser Datei baute `avesmapsMapFeaturesMergeLegacyOtherSources`
 * (api/app/map-features.php) Zeilen unter synthetischen `os:`-Kennungen -- die Altquellen aus
 * `properties.other_source`, die nie in den Katalog übernommen wurden. Genau die tragen die
 * nichtssagenden Titel, um derentwillen es Variante A gibt: von 186 Zeilen mit dem Titel
 * „Briefspiel" kamen 182 von dort. Gemessen: 133 Zeilen mit Schlüssel, 290 ohne -- obwohl ihr
 * Wirt einen Korpus hat. Die Anzeige war damit zu knapp einem Drittel wirksam.
 * 🔴 Wer einen dritten Erzeuger anlegt, ruft DIESE Funktion. Die vier Zeilen abzuschreiben ist
 * genau der Weg, auf dem dieser Fehler entstanden ist (AGENTS.md, wieder und wieder: eine Regel,
 * die einen von mehreren Erzeugern bindet, ist keine Regel).
 *
 * ⚠️ Nur bei einem BEKANNTEN Korpus, und das kostet fast nichts: ein kurzer String je Zeile in
 * einer 3-MB-Nutzlast. Ein Schlüssel ohne Eintrag im Wörterbuch wäre im Browser ein Nachschlagen,
 * das nie trifft.
 * ⚠️ `$korpora === []` heißt: kein Korpus-Modul geladen oder keine Korpora erfasst. Dann bleibt
 * alles, wie es vor dem Umbau war -- Titel vorn. Der Rückfall ist nie ein leerer Name.
 *
 * @param array<string,mixed> $eintrag die fertige Katalogzeile
 * @param array<string,mixed> $korpora Schlüssel -> Korpus, EINMAL gelesen
 * @return array<string,mixed>
 */
function avesmapsFeatureSourceApplyCorpusKey(array $eintrag, string $url, array $korpora): array
{
    // Abkuerzung, kein Riegel: den traegt das `isset` unten. Eine Mutationsprobe laesst diese
    // Zeile durch, und das ist richtig so -- sie spart nur den Aufruf.
    if ($korpora === [] || !function_exists('avesmapsSourceCorpusKey')) {
        return $eintrag;
    }
    $key = avesmapsSourceCorpusKey($url);
    if ($key !== '' && isset($korpora[$key])) {
        $eintrag['corpus'] = $key;
    }

    return $eintrag;
}

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
    // EINMAL gelesen, nicht je Zeile -- sonst zahlte die Nutzlast 1.384 Volldurchgänge über eine
    // Tabelle mit acht Zeilen.
    $korpora = function_exists('avesmapsSourceCorpusReadAll') ? avesmapsSourceCorpusReadAll($pdo) : [];
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
        $eintrag = avesmapsFeatureSourceApplyCorpusKey($eintrag, (string) $row['url'], $korpora);
        $catalog[(int) $row['id']] = $eintrag;
    }
    return $catalog;
}

/**
 * Die Korpora für die Kartennutzlast: Schlüssel → Name und Form.
 *
 * 🔴 EIN WÖRTERBUCH, nicht der Name an jeder Zeile. Acht Einträge statt 133 Wiederholungen -- und
 * eine Umbenennung wirkt damit an genau einer Stelle.
 * 💣 NUR `label` und `form`. Art, Lizenz und Nennung stehen bereits AN DER QUELLE (der Korpus
 * schreibt sie durch), und `updated_by` ist eine Editorenkennung, die in einer öffentlichen
 * Nutzlast nichts verloren hat.
 * ⚠️ Fällt offen aus: ohne Korpus-Modul oder bei einem Fehler bleibt die Liste leer, und die
 * Anzeige verhält sich wie vor dem Umbau (Titel vorn).
 */
function avesmapsLoadSourceCorporaForPayload(PDO $pdo): array
{
    if (!function_exists('avesmapsSourceCorpusReadAll')) {
        return [];
    }
    $raus = [];
    foreach (avesmapsSourceCorpusReadAll($pdo) as $key => $korpus) {
        $raus[$key] = [
            'label' => (string) ($korpus['label'] ?? $key),
            'form' => (string) ($korpus['form'] ?? ''),
        ];
    }
    return $raus;
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
// dem frueheren os:-Erzeuger (avesmapsMapFeaturesMergeLegacyOtherSources, bis 03.09.2026) abgeschrieben wurde -- dessen Kommentar „only these
// three feature types are in scope" galt fuer die ALTQUELLEN, nicht fuer den Kanon. Kraftlinien
// tragen `properties.wiki_url` (api/edit/map/powerlines.php:67), stehen in
// AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES oben und rendern eine Kanonzeile
// (js/map-features/map-features-powerlines.js). Eine geerbte Zuordnung erbt auch ihren blinden Fleck.
//
// ⚠️ 'territory' und 'citymap' stehen bewusst NICHT hier und KOENNEN es nicht: die Zuordnung
// uebersetzt `map_features.feature_type`, und dort gibt es keinen, der ein Territorium oder einen
// Stadtplan UNTER DESSEN EIGENER public_id fuehrt.
// 🔴 FUER TERRITORIEN IST DAS SEIT DEM 02.09.2026 KEINE GRENZE MEHR, und hier stand bis dahin
// „Sie erreichen den Namensraum-Rang deshalb nie": sie erreichen ihn ueber einen ZWEITEN Leser,
// avesmapsPoliticalTerritoryWikiNamespaces, der `political_territory.wiki_url` abfragt statt
// `map_features`. Der Weg fuehrt also nicht durch diese Zuordnung -- deshalb bleibt sie unveraendert,
// und deshalb stimmt der erste Absatz weiter. STADTPLAENE bleiben aussen vor.
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

// Wo die ECHTE Wiki-Zuweisung eines Kartenobjekts steht -- das Nest, nicht `properties.wiki_url`.
// 💣 `powerline` fehlt hier ABSICHTLICH und ist kein vergessener vierter Eintrag: eine Kraftlinie
// hat kein Nest, ihre Adresse steht blank in `properties.wiki_url` und wird nie geraten
// (avesmapsEnrichMapFeatureWikiUrl steigt fuer sie aus). Der Leser behandelt genau diesen Fall
// eigens; wer hier `'powerline' => 'wiki_url'` ergaenzt, laesst ihn ins Leere greifen.
const AVESMAPS_MAP_FEATURES_KANON_WIKI_NEST_BY_FEATURE_TYPE = [
    'location' => 'wiki_settlement',
    'label' => 'wiki_region',
    'path' => 'wiki_path',
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
 * ⚠️ 1. DIE ADRESSE ENTSTEHT ERST SPAETER. `avesmapsEnrichMapFeatureWikiUrl` fuellt `wiki_url`
 * aus dem ZUWEISUNGSNEST, wenn die gespeicherte leer ist. Aus der Rohzeile gelesen haette das
 * Etikett an einem ANDEREN Artikel gehangen als der Link daneben im selben Kasten.
 * 🔴 ZWEI HALBSAETZE DIESER BEGRUENDUNG SIND UEBERHOLT, und beide in dieselbe Richtung: die
 * Anreicherung fuellte die Adresse einmal „per Namensabgleich gegen `wiki_sync_pages`" (das RATEN,
 * zurueckgebaut mit `420f12cfc` am 08.09.2026) und achtete dabei „auf `wiki_no_article` und den
 * Kraftlinien-Riegel" (beide gefallen am 09.09.2026 mit dem Merker, Owner-Entscheid). Der Grund,
 * hierher zu gehen statt in die Rohzeile, ist unveraendert richtig -- nur schmaler geworden.
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
        // 🔴 DAS ZUWEISUNGSNEST ZUERST, NIE NUR `properties.wiki_url` (Owner 08.09.2026: „ich will
        // eigentlich dass die 113 ihre wiki-zuweisung direkt und nicht aus den publikationen
        // bekommen"). Seit dem 08.09.2026 macht eine Zuweisung im Hauptraum das Objekt OFFIZIELL --
        // und `wiki_url` ist dafuer keine taugliche Grundlage: avesmapsEnrichMapFeatureWikiUrl RAET
        // sie bei Leere per Namensabgleich dazu. 99 Orte und 12 Wege tragen so einen Phantomlink
        // (AGENTS.md §11), und die haetten damit ein „offiziell" bekommen, das nie jemand gesetzt hat.
        // Gemessen am Dump vom 08.09.2026: 113 Objekte (Dommel, Barras, Grünau) haben GAR KEIN Nest
        // und ihre Publikationen als einzige Quelle -- sie brauchen eine echte Zuweisung, kein
        // geratenes Etikett.
        $nestSchluessel = AVESMAPS_MAP_FEATURES_KANON_WIKI_NEST_BY_FEATURE_TYPE[
            (string) ($properties['feature_type'] ?? '')
        ] ?? '';
        $nest = $nestSchluessel !== '' ? ($properties[$nestSchluessel] ?? null) : null;
        $zugewiesen = is_array($nest)
            && (trim((string) ($nest['wiki_key'] ?? '')) !== '' || trim((string) ($nest['wiki_url'] ?? '')) !== '');
        // ⚠️ Die Kraftlinie hat kein Nest: ihr `properties.wiki_url` ist explizit oder leer, nie
        // geraten (avesmapsEnrichMapFeatureWikiUrl steigt fuer sie aus). Dort IST die Adresse die
        // Zuweisung.
        if ($nestSchluessel === '' && trim((string) ($properties['wiki_url'] ?? '')) !== '') {
            $zugewiesen = true;
        }
        $wikiUrl = trim((string) ($properties['wiki_url'] ?? ''));
        if (is_array($nest) && trim((string) ($nest['wiki_url'] ?? '')) !== '') {
            $wikiUrl = trim((string) $nest['wiki_url']);
        }
        if ($wikiUrl === '') {
            continue;
        }
        if ($zugewiesen) {
            $ns = avesmapsWikiNamespaceFromWikiUrlMitHauptraum($wikiUrl);
            if ($ns !== null) {
                $out[$entityType . ':' . $publicId] = $ns;
            }
            continue;
        }
        // ⚠️ OHNE Zuweisung bleibt genau EINE Aussage moeglich, und sie ist die sichere Richtung:
        // ein erkennbar INOFFIZIELLER Raum. Der galt hier schon vor dem 08.09.2026 und darf durch
        // den Umbau nicht verlorengehen -- „offiziell" entsteht ohne Zuweisung dagegen nie.
        $ns = avesmapsWikiNamespaceFromWikiUrl($wikiUrl);
        if ($ns !== null && avesmapsWikiNamespaceIsOfficial($ns) === false) {
            $out[$entityType . ':' . $publicId] = $ns;
        }
    }

    return avesmapsMapFeaturesWegGruppeErbtZuweisung($features, $out);
}

/**
 * EIN WEG IST EIN DING, AUCH WENN ER IN ABSCHNITTEN AUF DER KARTE LIEGT.
 *
 * 🔴 Owner 08.09.2026: „segmente eines flusses, der gleich heisst, sollten gleich behandelt werden,
 * wenn wikisync was tut. und wenn wiki sync etwas offiziell oder inoffiziell macht oder entfernt,
 * muss das fuer alle segmente des flusses, die davor oder dahinter verlaufen auch gelten."
 *
 * 💣 OHNE DIESE ERBSCHAFT VERSCHIEBT DER KANON-UMBAU DEN FEHLER NUR. Seit dem 08.09.2026 macht die
 * Zuweisung offiziell -- und Zuweisungen haengen am ABSCHNITT. Am Dump desselben Tages gemessen:
 * von 350 mehrteiligen Wegen mit echtem Namen sind **16 nur teilweise zugewiesen** (Sichelstieg 1
 * von 6, Sieben-Baronien-Weg 27 von 31, Alte Strasse 12 von 15, Schattenbachpass 4 von 6). Dort
 * stuende derselbe Weg wieder mit zwei Aussagen da -- genau die Meldung, die den Umbau ausgeloest
 * hat, nur eine Ursache weiter.
 *
 * 🔴 DIE GRUPPE IST DER NAME, NICHT DER `wiki_key`. Ein unzugewiesenes Segment HAT keinen
 * `wiki_key` und faellt aus jeder Schluesselgruppe heraus -- die Erbschaft muss aber gerade IHN
 * erreichen. Gruppiert wird deshalb wie in `wpGroupKeyOf` (js/pages/wege-editor-model.js) auf
 * seiner Namensseite: Wegart + Name.
 *
 * 💣 ZWEI RIEGEL, JEDER EINZELN BEGRUENDET -- und hier steht bewusst KEINE Zahl mehr im Fliesstext
 * darunter, weil eine Zahl sich wie eine vollstaendige Liste liest:
 *   - UNEINIGE Gruppen erben nichts. Tragen die zugewiesenen Segmente verschiedene Namensraeume,
 *     ist nicht entscheidbar, welcher gilt -- und „im Zweifel offiziell" waere die unsichere
 *     Richtung. Lieber kein Etikett als ein erfundenes.
 *   - Ein Segment, das SELBST schon eine Aussage hat, wird nie ueberschrieben. Der Rueckfall fuer
 *     unzugewiesene ns-222-Objekte eine Funktion weiter oben ist eine solche Aussage.
 *
 * 🔴 EIN DRITTER RIEGEL IST AM 09.09.2026 GEFALLEN: `wiki_no_article` erbte NIE. Der Merker ist
 * global ausgebaut (Owner-Entscheid), sein Aequivalent ist die WIKI-ZUWEISUNG -- und die fragt der
 * Riegel daneben schon ab. Er kollabierte also NICHT, er fiel.
 * ⚠️ Wirkung am Bestand: KEINE. Diese Erbschaft gilt nur Wegen, und von den 10 Traegern des Merkers
 * ist keiner ein Weg (6 Orte, 5 Kraftliniensegmente) -- am Dump vom 08.09.2026 nachgezaehlt. Wer die
 * Begruendung von damals nachlesen will: sie war die Discord-#38-Falle, in der ein geratener Link zu
 * Daten wird; der Rateweg selbst ist mit `420f12cfc` gefallen.
 *
 * ⚠️ NUR WEGE. Orte und Beschriftungen liegen einmal auf der Karte; zwei gleichnamige Doerfer sind
 * zwei Doerfer, keine zwei Haelften desselben. Genau deshalb steht hier `path` und keine Liste.
 * ⚠️ Und es ist eine reine ANZEIGE-Erbschaft: in der Datenbank aendert sich nichts. Die Zuweisung
 * der fehlenden Segmente bleibt Editorenarbeit (der Pruefhaken „Keine Wiki-Zuweisung" zeigt sie);
 * bis dahin sagt der Kopf wenigstens fuer den ganzen Weg dasselbe.
 *
 * @param list<array<string, mixed>> $features fertige GeoJSON-Objekte
 * @param array<string, int> $namespaces was der Leser bisher gefunden hat
 * @return array<string, int> dasselbe, ergaenzt um die geerbten Segmente
 */
function avesmapsMapFeaturesWegGruppeErbtZuweisung(array $features, array $namespaces): array
{
    $gruppen = [];
    foreach ($features as $feature) {
        $properties = $feature['properties'] ?? null;
        if (!is_array($properties) || (string) ($properties['feature_type'] ?? '') !== 'path') {
            continue;
        }
        $publicId = (string) ($properties['public_id'] ?? '');
        $name = trim((string) ($properties['name'] ?? ''));
        if ($publicId === '' || $name === '') {
            continue;
        }
        $gruppe = ((string) ($properties['feature_subtype'] ?? '')) . '|' . $name;
        $schluessel = 'path:' . $publicId;
        if (array_key_exists($schluessel, $namespaces)) {
            // Eine eigene Aussage gewinnt -- gesammelt wird sie als Vorlage der Gruppe.
            $gruppen[$gruppe]['raeume'][$namespaces[$schluessel]] = true;
            continue;
        }
        // 🔴 HIER STAND DER `wiki_no_article`-RIEGEL. Gefallen am 09.09.2026 mit dem Merker; siehe
        // die Begruendung im Kopf dieser Funktion.
        $gruppen[$gruppe]['offen'][] = $schluessel;
    }

    foreach ($gruppen as $gruppe) {
        $raeume = array_keys($gruppe['raeume'] ?? []);
        $offen = $gruppe['offen'] ?? [];
        if ($offen === [] || count($raeume) !== 1) {
            continue; // nichts zu erben, oder die Gruppe ist uneinig
        }
        foreach ($offen as $schluessel) {
            $namespaces[$schluessel] = (int) $raeume[0];
        }
    }

    return $namespaces;
}

/**
 * DER VIERTE EINGANG: der Wiki-Namensraum der HERRSCHAFTSGEBIETE.
 *
 * 🔴 EIGENE ABFRAGE, WEIL EIN TERRITORIUM KEINE `map_features`-ZEILE HAT. Der Absatz „NUR OBJEKTE
 * MIT KARTENZEILE" unten beschrieb das bis zum 02.09.2026 als Grenze des Entwurfs -- gemessen am
 * Dump vom 01.09.2026 sind das **69 von 302** ns-222-Kartenentitaeten. Ein rein aus dem Raum
 * „Inoffiziell" stammendes Gebiet blieb damit unbeschriftet, obwohl sein Kopf die Kanonzeile
 * rendert (js/map-features/map-features-region-info-markup.js). Owner 02.09.2026, nachdem die
 * erste Bindung live war: „territorien muessen jetzt das label offiziell/inoffiziell bekommen".
 *
 * 💣 GEJOINT WIRD UEBER `wiki_key`, NICHT UEBER `wiki_id`. Ein frisch gebundener eigener Knoten
 * traegt seinen Schluessel sofort, seine `wiki_id` aber erst nach dem naechsten
 * avesmapsWikiSyncRelinkPoliticalTerritoryByWikiKey -- ueber die id gejoint bekaeme ausgerechnet
 * das eben gebundene Gebiet sein Etikett nicht.
 * ⚠️ `COALESCE`: die eigene Adresse gewinnt vor der des Wiki-Spiegels. Eine von Hand gesetzte
 * `wiki_url` ist eine Aussage; die des Spiegels ist die Vorgabe dahinter.
 * ⚠️ Nur aktive Gebiete -- eine Zeile im Papierkorb beschriftet nichts mehr.
 *
 * 💣 DAMIT HAENGT DIE KARTENNUTZLAST AN `political_territory.wiki_url`, und das war sie vorher
 * NICHT. Das ETag von `api/app/map-features.php` haengt an `map_revision`; wer diese Adresse
 * aendert, ohne sie anzustossen, laesst einen WARMEN Browser sein altes Etikett behalten (er
 * revalidiert nur ueber das ETag). Nachgezaehlt am 02.09.2026, welche Schreiber sie anfassen:
 *   ✅ territory-plan-apply.php und territory-wiki-plan-apply.php -- stossen an (die zwei
 *      Uebernehmen-Haelften, ueber die ein gesyncter Artikel seine Adresse bekommt);
 *   ✅ avesmapsEigenerKnotenBindungAnwenden -- stoesst an (api/edit/wiki/sync-monitor.php);
 *   ⚠️ `update_territory` (api/_internal/political/territories-write.php, der Wiki-Kasten des
 *      Kartendialogs) -- stoesst NICHT an. Eine dort von Hand gesetzte Adresse aendert das Etikett
 *      erst, wenn irgendein anderer Kartenschreiber die Revision hochzaehlt. Das passiert im
 *      Editierbetrieb staendig, ist also kurzlebig -- aber es ist eine Luecke und keine Zusage.
 *   ⚪ `apply_identity` und `apply_coats` schreiben `wiki_url` NICHT (nur name/type/status/BF bzw.
 *      coat_of_arms_url) -- sie koennen das Etikett gar nicht aendern.
 * 🔧 Wer die Luecke schliesst, stoesst in `update_territory` an, wenn sich `wiki_url` WIRKLICH
 * geaendert hat -- nicht bei jeder Territoriumsaenderung: die Nutzlast ist ~3 MB, und sie war bis
 * heute von Territoriumsbearbeitungen unabhaengig.
 *
 * @return array<string, int> "territory:public_id" => Namensraum
 */
function avesmapsPoliticalTerritoryWikiNamespaces(PDO $pdo): array
{
    try {
        $rows = $pdo->query(
            "SELECT pt.public_id, COALESCE(NULLIF(pt.wiki_url, ''), w.wiki_url) AS wiki_url
               FROM political_territory pt
               LEFT JOIN political_territory_wiki w ON w.wiki_key = pt.wiki_key
              WHERE pt.is_active = 1"
        )->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $fehler) {
        // ⚠️ Ein fehlgeschlagener Leser darf die Kartennutzlast nicht mitreissen -- „kein Etikett"
        // ist ein gueltiger Zustand. Er wird aber PROTOKOLLIERT, nicht geschluckt: sonst sieht ein
        // SQL-Fehler exakt aus wie „kein Gebiet ist inoffiziell" (die HY093-Falle von
        // „Was ist hier?", AGENTS.md §11).
        error_log('avesmapsPoliticalTerritoryWikiNamespaces: ' . $fehler->getMessage());
        return [];
    }

    $out = [];
    foreach ($rows as $row) {
        $publicId = (string) ($row['public_id'] ?? '');
        $wikiUrl = trim((string) ($row['wiki_url'] ?? ''));
        if ($publicId === '' || $wikiUrl === '') {
            continue;
        }
        // 🔴 HIER IST DIE ADRESSE DIE ZUWEISUNG: `political_territory.wiki_url` ist eine eigene
        // Spalte, die nur ein Schreibvorgang fuellt -- kein Namensraten wie bei den Kartenobjekten.
        // Deshalb zaehlt der Hauptraum hier genauso wie ns 222 (Owner-Regel vom 08.09.2026).
        $ns = avesmapsWikiNamespaceFromWikiUrlMitHauptraum($wikiUrl);
        if ($ns !== null) {
            $out['territory:' . $publicId] = $ns;
        }
    }

    return $out;
}

/**
 * DER FUENFTE EINGANG: DIE LANDSCHAFTSFLAECHE.
 *
 * 🚩 Owner-Meldung 10.09.2026 am Urwald „Altenforst", mit Bild: Kopf INOFFIZIELL │ Briefspiel,
 * darunter die Wiki-Zeile INOFFIZIELL │ Wiki-Artikel -- waehrend die Zuweisung stimmt und in den
 * HAUPTRAUM zeigt. „das ging mal alles richtig. jetzt ist es wieder kaputt sowas darf nicht
 * passieren."
 *
 * 💣 DIE ZUWEISUNG WURDE GELESEN UND UNTER EINEM SCHLUESSEL ABGELEGT, DEN NIEMAND FRAGT. Seit
 * Schritt 5 des Quellen-Umbaus (03.09.2026) traegt die FLAECHE die Quellen einer gebundenen
 * Beschriftung; `avesmapsLabelQuellenSchluessel` liefert dafuer `ecosystem:<region_public_id>`,
 * und derselbe Schluessel holt das Kanon-Etikett (map-features-labels.js). Der Namensraum
 * dagegen entsteht in avesmapsMapFeaturesWikiNamespaces als `region:<label_public_id>` -- richtig
 * gerechnet, nur am falschen Haken. Nachgestellt und gemessen:
 *
 *   dieselbe Beschriftung FREI     -> region:…    ns 0 -> „offiziell"       ✅
 *   dieselbe Beschriftung GEBUNDEN -> ecosystem:… kein ns -> Quellen allein -> „inoffiziell │ briefspiel"
 *
 * 🔴 UND ES GING IN BEIDE RICHTUNGEN FALSCH, die zweite ist die schlimmere: eine Flaeche aus
 * ns 222 MIT einer offiziellen Quelle stand als „offiziell" da -- Fanmaterial mit Kanon-Anspruch.
 * Rang 1 (ns 222 schlaegt die Quellenlage) war fuer sie genauso unerreichbar wie Rang 2.
 *
 * 💣 SICHTBAR WURDE ES ERST DURCH DIE QUELLEN, NICHT DURCH DEN UMBAU. Ohne Verweis gibt es gar
 * kein Etikett, mit Verweisen ohne Ableitung gilt die Vorgabe „offiziell" -- eine Flaeche sah also
 * so lange richtig aus, bis ihr jemand die erste INOFFIZIELLE Quelle eintrug. Genau das tut der
 * Garetien-Importer dieser Tage reihenweise.
 *
 * 🔴 HIER IST DIE ADRESSE DIE ZUWEISUNG -- wie bei `political_territory.wiki_url` und aus
 * demselben Grund: `ecosystem_region.wiki_url` fuellt nur ein Schreibvorgang, es wird nichts
 * geraten. `wiki_region_key` wird ausschliesslich DARAUS abgeleitet (avesmapsEcosystemReadRegionFields:
 * „the two must never drift apart"), die Spalte ist also da, wo eine Zuweisung ist.
 * ⚠️ Nur aktive Flaechen -- eine Zeile im Papierkorb beschriftet nichts mehr.
 *
 * ⚠️ DIE FLAECHE ENTSCHEIDET, NICHT DAS SCHILD. Die Beschriftung traegt eine KOPIE
 * (avesmapsEcosystemPushWikiRegionToLabels, Owner 01.09.2026); die Flaeche ist das Original und
 * bleibt es auch dann, wenn mehrere Beschriftungen an ihr haengen (1:N, 13 von 1026 Flaechen).
 * Ueber die Kopien gelesen braeuchte es eine Uneinigkeitsregel wie bei den Wegsegmenten -- ueber
 * das Original gibt es nichts zu entscheiden.
 * 🔧 OFFEN, dieselbe Luecke wie beim Territorium daneben: `assign_wiki_region` stoesst
 * `map_revision` nur an, wenn dabei wirklich eine Beschriftung nachgezogen wird. Traegt eine
 * Beschriftung die Adresse schon und bekommt die Flaeche sie erst jetzt, behaelt ein WARMER
 * Browser sein altes Etikett bis zum naechsten Kartenschreiber. Selten und kurzlebig -- aber eine
 * Luecke und keine Zusage.
 *
 * @return array<string, int> "ecosystem:public_id" => Namensraum
 */
function avesmapsEcosystemRegionWikiNamespaces(PDO $pdo): array
{
    try {
        $rows = $pdo->query(
            "SELECT public_id, wiki_url FROM ecosystem_region WHERE is_active = 1"
        )->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $fehler) {
        // ⚠️ Protokolliert, nicht geschluckt -- ein SQL-Fehler saehe sonst exakt aus wie „keine
        // Flaeche ist zugewiesen" (die HY093-Falle von „Was ist hier?", AGENTS.md §11). Die
        // Kartennutzlast darf er nicht mitreissen: „kein Etikett" ist ein gueltiger Zustand.
        error_log('avesmapsEcosystemRegionWikiNamespaces: ' . $fehler->getMessage());

        return [];
    }

    $out = [];
    foreach ($rows as $row) {
        $publicId = (string) ($row['public_id'] ?? '');
        $wikiUrl = trim((string) ($row['wiki_url'] ?? ''));
        if ($publicId === '' || $wikiUrl === '') {
            continue;
        }
        $ns = avesmapsWikiNamespaceFromWikiUrlMitHauptraum($wikiUrl);
        if ($ns !== null) {
            $out['ecosystem:' . $publicId] = $ns;
        }
    }

    return $out;
}

/**
 * DAS SCHILD SPRINGT EIN, WENN DIE FLAECHE SCHWEIGT.
 *
 * 🚩 Owner-Messung 10.09.2026, eine Stunde nach dem Dommel-Nachtrag. Von den **9**
 * Landschaftsflaechen, die seither `{kanon: ''}` bekamen, tragen **6** einen HAUPTRAUM-Artikel an
 * ihrer Beschriftung, waehrend `ecosystem_region.wiki_url` leer ist: Albernia, Moosgrunder Tann,
 * Madas Auge, Charyptik, Inirk (Artikel „Sorkten") und Dirak (Artikel „Dirad"). Sie muessten
 * „offiziell" sagen und sagten gar nichts.
 *
 * 💣 UND DAS WAR EINE REGRESSION DES DOMMEL-NACHTRAGS, keine alte Luecke. Vorher hatten sie
 * Verweise (Publikationen) und KEIN Etikett aus der Ableitung -- also griff im Browser die Vorgabe
 * „offiziell", und das war ZUFAELLIG richtig. Der ausdrueckliche Leer-Eintrag hat genau diesen
 * Zufall beseitigt und damit sichtbar gemacht, dass der Namensraum-Leser eine Haelfte der
 * Zuweisung nie gesehen hat. **Ein Zufall, der das Richtige tut, faellt erst auf, wenn man ihn
 * wegnimmt.**
 *
 * 🔴 DIE ORDNUNG BLEIBT: DIE FLAECHE ENTSCHEIDET. `ecosystem_region.wiki_url` ist das Original,
 * die Beschriftung traegt eine Kopie (avesmapsEcosystemPushWikiRegionToLabels, 01.09.2026). Dieser
 * Rueckfall greift AUSSCHLIESSLICH dort, wo die Flaeche gar nichts sagt -- er ueberstimmt nie.
 * Der Durchtrag heilt solche Paare von selbst, sobald jemand die Flaeche speichert; bis dahin
 * liest das Etikett den Artikel, den der Quellenkasten daneben ohnehin verlinkt.
 *
 * 💣 UNEINIGE SCHILDER ERBEN NICHTS -- dieselbe Regel wie bei den Wegsegmenten. Flaeche→Label ist
 * 1:N (13 von 1026 Flaechen tragen zwei oder drei Beschriftungen); tragen zwei davon verschiedene
 * Namensraeume, ist nicht entscheidbar, welcher gilt, und „im Zweifel offiziell" waere die
 * unsichere Richtung. Lieber kein Etikett als ein erfundenes.
 *
 * ⭐ ES ENTSTEHT KEINE ZUSAETZLICHE ABFRAGE. Die Namensraeume der Beschriftungen stehen bereits als
 * `region:<label_public_id>` in derselben Karte (avesmapsMapFeaturesWikiNamespaces), und die
 * Bindung liest die Kartennutzlast ohnehin (avesmapsEcosystemReadLabelRegionMap, beide
 * Richtungen). Diese Funktion uebersetzt nur -- sie ist rein und faehrt deshalb im Test wirklich.
 *
 * @param array<string, int>    $raeume   bereits gefundene Namensraeume, "typ:public_id" => ns
 * @param array<string, string> $byLabel  label public_id => region public_id
 * @return array<string, int>   die ZUSAETZLICHEN "ecosystem:<region>" => Namensraum
 */
/**
 * Derselbe Rueckfall fuer den SCHREIBPFAD -- er hat keine `$features` und muss die Beschriftungen
 * selbst holen.
 *
 * ⭐ Er baut dafuer KEINE eigene Namensraum-Rechnung: die Rohzeilen gehen durch
 * avesmapsMapFeaturesWikiNamespaces, also durch dieselbe Funktion wie im Lesepfad, und deren
 * Ergebnis durch dieselbe reine Uebersetzung. Eine zweite Fassung liefe beim naechsten Riegel
 * auseinander -- und der Kanon hat diese Divergenz schon einmal bezahlt.
 *
 * ⚠️ Zwei volle Lesevorgaenge (Bindung + Beschriftungszeilen), wie der Territorien-Leser daneben
 * und aus demselben Grund vertretbar: der Aufrufer ist eine EDITOR-Schreibaktion, nie der
 * oeffentliche Lesepfad.
 *
 * @param array<string, int> $flaechenRaeume was die Flaechen selbst schon gesagt haben
 * @return array<string, int> die ZUSAETZLICHEN "ecosystem:<region>" => Namensraum
 */
function avesmapsEcosystemRaeumeAusBeschriftungen(PDO $pdo, array $flaechenRaeume): array
{
    try {
        // ⚠️ Im RUMPF, nicht am Dateikopf: diese Datei haengt am oeffentlichen Lesepfad, und
        // dieselbe Regel steht schon an avesmapsFeatureSourcesTakeoverLabelSources.
        require_once __DIR__ . '/ecosystem-label-link.php';
        $bindung = avesmapsEcosystemReadLabelRegionMap($pdo);
        $byLabel = $bindung['by_label'] ?? [];
        if (!is_array($byLabel) || $byLabel === []) {
            return [];
        }
        $platzhalter = implode(', ', array_fill(0, count($byLabel), '?'));
        $statement = $pdo->prepare(
            "SELECT public_id, feature_type, name, properties_json
               FROM map_features
              WHERE is_active = 1 AND feature_type = 'label' AND public_id IN ($platzhalter)"
        );
        $statement->execute(array_map('strval', array_keys($byLabel)));
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $fehler) {
        // ⚠️ Protokolliert, nicht geschluckt -- sonst saehe ein SQL-Fehler aus wie „keine
        // Beschriftung ist zugewiesen".
        error_log('avesmapsEcosystemRaeumeAusBeschriftungen: ' . $fehler->getMessage());

        return [];
    }

    $features = [];
    foreach ($rows as $row) {
        $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
        if (!is_array($properties)) {
            $properties = [];
        }
        $properties['feature_type'] = (string) ($row['feature_type'] ?? '');
        $properties['public_id'] = (string) ($row['public_id'] ?? '');
        $features[] = ['properties' => $properties];
    }

    return avesmapsEcosystemNamespacesAusBeschriftungen(
        avesmapsMapFeaturesWikiNamespaces($features) + $flaechenRaeume,
        $byLabel
    );
}

function avesmapsEcosystemNamespacesAusBeschriftungen(array $raeume, array $byLabel): array
{
    $jeRegion = [];
    foreach ($byLabel as $labelId => $regionId) {
        $labelId = trim((string) $labelId);
        $regionId = trim((string) $regionId);
        if ($labelId === '' || $regionId === '') {
            continue;
        }
        // 🔴 Die Flaeche gewinnt: hat sie eine eigene Aussage, wird sie hier nie angefasst.
        if (array_key_exists('ecosystem:' . $regionId, $raeume)) {
            continue;
        }
        $ns = $raeume['region:' . $labelId] ?? null;
        if ($ns === null) {
            continue;
        }
        $jeRegion[$regionId][(int) $ns] = true;
    }

    $out = [];
    foreach ($jeRegion as $regionId => $raeumeDerSchilder) {
        if (count($raeumeDerSchilder) !== 1) {
            continue; // uneinig -- kein Etikett ist besser als ein erfundenes
        }
        $out['ecosystem:' . $regionId] = (int) array_key_first($raeumeDerSchilder);
    }

    return $out;
}

/**
 * DAS KANON-ETIKETT JE OBJEKT -- abgeleitet, nie getippt.
 * ---------------------------------------------------------------------------
 * Entwurf: docs/superpowers/specs/2026-08-27-kanon-etikett-design.md
 *
 * 🔴 DIE REGEL, in dieser Reihenfolge (Owner 08.09.2026), Entwurf §2.1:
 *   1. WIKI-ZUWEISUNG in inoffiziellem Raum -> 'inoffiziell' + Bezeichner „Wiki Aventurica"
 *      (ns 222 Inoffiziell, ns 444 Ilaris)     -- auch ohne jede Quellzeile
 *   2. WIKI-ZUWEISUNG im Hauptraum          -> 'offiziell'   (volle Pille, kein Bezeichner)
 *      (bzw. ns 218/220, ebenfalls offiziell)  -- die Quellen daneben aendern daran NICHTS
 *   3. ohne Zuweisung: offizielle Quelle    -> 'offiziell'
 *   4. ohne Zuweisung: inoffizielle Quelle  -> 'inoffiziell' + der ART („Briefspiel (2)")
 *   5. sonst                                -> gar kein Eintrag (der Besucher sieht nichts;
 *                                              „Ohne Quelle" ist eine reine Editorenanzeige)
 *
 * 💣 RANG 1 UND 2 SIND AM 08.09.2026 NACH VORN GEWANDERT, und das ist eine Umkehrung, keine
 * Ergaenzung. Bis dahin fragte die Ableitung ZUERST die Katalogquellen; fehlte die offizielle,
 * gewann eine beliebige inoffizielle. Ein Ort mit ganz normalem Hauptraum-Artikel UND einer
 * Briefspielquelle stand deshalb als „INOFFIZIELL │ Briefspiel" da. Owner an diesem Tag:
 *
 *   „also ‚offiziell' wenn ‚wiki-zuweisung = true'" und „wenn editoren weitere, inoffizielle
 *   quellen hinzufügen, dann stehn die als z.b. inoffiziell | briefspiel dran, aber das objekt
 *   bleibt offiziell. es darf dann oben kein inoffiziell stehen. […] es sei denn es verliert
 *   seine wiki-zuweisung (dann gilt inoffiziell)."
 *
 * 🚩 ANLASS war der Pergelbach: derselbe Fluss trug an einem Abschnitt „offiziell" und an zweien
 * „inoffiziell", weil seine offiziellen Publikationsquellen nur an EINEM seiner drei Abschnitte
 * hingen (Kaltwasser genauso). 41 Objekte im Bestand vom 08.09.2026 haben dadurch gekippt.
 *
 * 💣 PUBLIKATIONEN ZAEHLEN GAR NICHT MEHR MIT (Owner 08.09.2026: „publikationen sind übrigens
 * nicht wichtig - die werden einfach gelistet […] offiziell / inoffiziell machen es nur
 * quellen"). Erkannt am `reference_kind`; die Schleife unten ueberspringt sie.
 *
 * ⚠️ DIESE LISTE STAND SCHON ZWEIMAL FALSCH DA -- einmal mit drei statt vier Raengen, einmal mit
 * vertauschten Nummern 2 und 3. Wer eine Rangliste in einem Docblock fuehrt, muss sie beim
 * Umbau MITFUEHREN, sonst beschreibt sie die Fassung davor und liest sich trotzdem wie eine
 * Zusage. Die Reihenfolge hier ist die des Codes darunter, Zeile fuer Zeile.
 * 🔴 Rang 1 und 2 sind im Code EIN Block (`$wikiNamespaces[$key]`): die Anwesenheit des
 * Schluessels ist die Zuweisung, sein Wert entscheidet die Haelfte. Ein bloss GERATENER
 * `properties.wiki_url` kommt dort nie an -- siehe avesmapsMapFeaturesWikiNamespaces.
 *
 * 🔴 EIN EINTRAG KANN NICHT OFFIZIELL UND INOFFIZIELL SEIN, und seit dem 08.09.2026 entscheidet
 * das die ZUWEISUNG, nicht mehr „offiziell schlaegt immer inoffiziell": hat ein Objekt mit
 * Hauptraum-Artikel zusaetzlich eine Briefspielquelle, bleibt es offiziell -- die inoffizielle
 * Quelle bleibt an ihrer Zeile im Quellenkasten sichtbar, nur nicht am Kopf. Umgekehrt schlaegt
 * ein ns-222-Artikel jetzt auch eine offizielle Quellzeile (Owner: „wenn der zugewiesen is und
 * das ding is inoffiziell im wiki, gilt das"); bis zum 08.09.2026 war es andersherum.
 *
 * 💣 HIER STEHT KEIN ANZEIGETEXT. Der Bezeichner faehrt als DATEN mit -- als `bezeichner_type`
 * (+ `bezeichner_count` ab zwei Quellen), aus denen die Anzeige „Briefspiel" bzw. „Briefspiel (2)"
 * baut. Dieselbe Trennung wie beim `source_type`, dessen Whitelist in PHP steht und dessen
 * Beschriftung in js/ui/feature-source-markup.js: wer den Text speichert, kann ihn nie
 * uebersetzen und nie umformulieren, ohne den Bestand anzufassen.
 * 🔴 UND ER IST DIE ART, NIE EIN NAME (Owner 03.09.2026) -- die Begruendung steht an der Stelle
 * selbst. `bezeichner_label` bleibt als Feld bestehen, es setzt aber nur noch RANG 2 („Wiki
 * Aventurica"); aus dem Katalog kommt ausschliesslich die Art.
 *
 * 💣 (Bis zum 03.09.2026: NACH dem os:-Erzeuger avesmapsMapFeaturesMergeLegacyOtherSources aufrufen, nie
 * davor -- die Altquellen wurden dort erst in Katalog und Verweise gefaltet. Der Erzeuger ist mit Schritt 4
 * des Quellen-Umbaus gefallen; die Reihenfolgefalle bleibt fuer die uebrigen Anreicherungen lehrreich.)
 *
 * 🔴 DREI EINGAENGE, EINE ANTWORT (der dritte hat inzwischen DREI LESER, siehe unten). Der dritte
 * ist der Wiki-Namensraum des Objekts: ein aus
 * ns 222 uebernommenes Objekt traegt keine eigene Katalogquelle -- sein Artikel steckt in
 * `properties.wiki_url` und wird vom Kasten als erste Zeile gerendert. Eine zusaetzliche
 * `sources`-Zeile dafuer anzulegen war der urspruengliche Plan und haette denselben Artikel
 * ZWEIMAL in den Kasten gestellt.
 *
 * ✅ **DER FUENFTE LESER IST SEIT DEM 10.09.2026 GEBAUT, UND ER GILT DEN LANDSCHAFTSFLAECHEN**
 * (avesmapsEcosystemRegionWikiNamespaces). Eine an eine Flaeche gebundene Beschriftung fragt ihr
 * Etikett unter `ecosystem:<region>` ab -- dort liegen seit Schritt 5 des Quellen-Umbaus ihre
 * Quellen --, waehrend ihr Namensraum als `region:<label>` entstand. Die Zuweisung war also da,
 * gerechnet und richtig, nur unter einem Schluessel abgelegt, den niemand fragt. Siehe die
 * Begruendung an der Funktion selbst.
 *
 * ✅ **DER VIERTE EINGANG IST SEIT DEM 02.09.2026 GEBAUT, UND ER GILT DEN TERRITORIEN.**
 * Hier stand „NUR OBJEKTE MIT KARTENZEILE ERREICHEN DEN DRITTEN EINGANG" -- richtig gemessen,
 * aber nicht mehr wahr: `avesmapsMapFeaturesWikiNamespaces` uebersetzt weiterhin nur
 * `map_features.feature_type`, DANEBEN steht jetzt `avesmapsPoliticalTerritoryWikiNamespaces`,
 * die `political_territory.wiki_url` abfragt. `api/app/map-features.php` reicht BEIDE Mengen
 * herein. Der damalige Satz nannte auch schon den richtigen Weg: „einen VIERTEN Eingang aus der
 * Territoriumstabelle, nicht einen fuenften Eintrag in der Zuordnung" -- genau das ist es.
 * ⚠️ **STADTPLAENE bleiben aussen vor** und die Begruendung gilt fuer sie unveraendert.
 * 🚩 Die Zahl von damals bleibt als Mass des Zugewinns stehen: aus dem Dump vom 01.09.2026
 * gezaehlt (252.902 Seiten, 6.457 in ns 222) sind von 302 ns-222-Kartenentitaeten **69
 * TERRITORIEN** -- die bekamen ohne eigene Quelle gar kein Etikett, obwohl ihr Kopf die Kanonzeile
 * rendert (js/map-features/map-features-region-info-markup.js). Owner 02.09.2026, direkt nach der
 * ersten Bindung eines eigenen Knotens an einen ns-222-Artikel.
 *
 * @param array<int|string, array<string, mixed>> $catalog source_id => {label, type, official, …}
 * @param array<string, list<array{source_id:int}>> $refs  "typ:public_id" => Verweise
 * @param array<string, int> $wikiNamespaces "typ:public_id" => Namensraum des Wiki-Artikels
 * @return array<string, array<string, mixed>> "typ:public_id" => {kanon, bezeichner_*}
 */
/**
 * DAS KANON-ETIKETT EINES EINZELNEN OBJEKTS -- fuer die Antwort einer Schreibaktion.
 *
 * 🔴 WOFUER: nach einer Wiki-Zuweisung ist das Etikett des Objekts ein anderes, aber die Karte
 * traegt ihre Kanon-Tafel aus der Nutzlast (`feature_kanon`, einmal beim Laden). Ohne diese
 * Auskunft sieht der Editor sein eigenes Ergebnis erst nach F5 -- gemeldet 02.09.2026, und es ist
 * dieselbe Klasse Fehler, die `avesmapsRefreshInfopanel` am 17.07.2026 fuer die Kataloge geloest
 * hat.
 *
 * 💣 SIE LEITET NICHTS SELBST AB. Sie sammelt nur die drei Eingaben ein und reicht sie an
 * avesmapsFeatureSourcesDeriveKanon weiter -- dieselbe Funktion, die auch die Nutzlast fuellt. Eine
 * zweite Rechnung fuer denselben Wert waere genau die Divergenz, an der die Rangfolge schon einmal
 * auseinandergelaufen ist (ns 222 gegen Quellzeile, 31.08.-02.09.2026).
 *
 * ⚠️ Sie laedt Katalog UND Verweise VOLLSTAENDIG, statt eine engere Abfrage zu bauen. Das ist
 * Absicht: die engere Abfrage waere neues SQL neben zwei erprobten Ladern, und der einzige Aufrufer
 * ist eine EDITOR-Schreibaktion -- nicht der oeffentliche Lesepfad, den CLAUDE.md schuetzt. Wer sie
 * je in eine Schleife stellt, baut genau die Last, vor der dort gewarnt wird.
 *
 * ⚠️ Der Namensraum kommt aus der uebergebenen Adresse, nicht aus der Datenbank: der Aufrufer hat
 * sie gerade geschrieben und kennt sie genauer als ein zweiter Lesevorgang, der mit ihr um die
 * Reihenfolge konkurrierte.
 *
 * @return array{kanon:string, bezeichner_label?:string, bezeichner_type?:string, bezeichner_count?:int}|null
 *         `null` heisst „kein Etikett" -- ein gueltiger Zustand, kein Fehler.
 */
function avesmapsFeatureSourcesKanonFuerEines(
    PDO $pdo,
    string $entityType,
    string $publicId,
    string $wikiUrl
): ?array {
    $entityType = trim($entityType);
    $publicId = trim($publicId);
    if ($entityType === '' || $publicId === '') {
        return null;
    }

    // 💣 KEINE ZWEITE ABLEITUNG. Diese Funktion ist seit dem 09.09.2026 ein duenner Aufruf des
    // Mehrfach-Rechners darunter; ihre eigene Fassung stand ab dem 02.09.2026 daneben, und genau
    // deshalb wurde der QUELLEN-Weg uebersehen, als er dieselbe Auskunft brauchte.
    $tafel = avesmapsFeatureSourcesKanonFuerMehrere($pdo, $entityType, [$publicId], [$publicId => $wikiUrl]);

    return $tafel[$publicId] ?? null;
}

/**
 * DER WIKI-NAMENSRAUM EINZELNER OBJEKTE -- aus der Datenbank statt aus der fertigen Nutzlast.
 *
 * 🔴 SIE LEITET NICHTS SELBST AB. Sie holt die Rohzeilen, bringt sie in die Form, die
 * avesmapsMapFeaturesWikiNamespaces erwartet, und laesst DIESE Funktion entscheiden -- dieselbe,
 * die auch die Kartennutzlast fuellt. Eine zweite Lesart des Zuweisungsnests waere genau die
 * Divergenz, an der die Rangfolge zwischen ns 222 und Quellzeile schon einmal auseinandergelaufen
 * ist (31.08.-02.09.2026).
 *
 * 🔴 WOFUER: der Quellen-Endpunkt kennt die Wiki-Adresse NICHT -- anders als der Zuweisungsweg, der
 * sie gerade geschrieben hat. Ohne diesen Leser verloere ein ZUGEWIESENES Objekt sein „offiziell",
 * sobald ihm jemand eine inoffizielle Quelle eintraegt: eine neue Regression, schlimmer als die,
 * gegen die der Nachtrag gebaut wurde.
 *
 * ⚠️ AUS DER ROHZEILE, und das traegt: die Ableitung liest das ZUWEISUNGSNEST
 * (`properties.wiki_settlement` und Geschwister), nie die angereicherte `properties.wiki_url` --
 * und das Nest steht unveraendert im gespeicherten `properties_json`. Ein bloss GERATENER
 * `wiki_url` kommt hier deshalb nie an (99 Orte und 12 Wege tragen einen).
 *
 * ⚠️ Territorien haben kein `map_features`-Gegenstueck; fuer sie gilt der vorhandene Leser
 * avesmapsPoliticalTerritoryWikiNamespaces, aus dem hier nur die gefragten Kennungen genommen
 * werden. Er liest die ganze Tabelle -- derselbe Preis, den auch der Mehrfach-Rechner zahlt, und
 * aus demselben Grund vertretbar: die Aufrufer sind EDITOR-Schreibaktionen, nicht der oeffentliche
 * Lesepfad, den CLAUDE.md schuetzt.
 *
 * @param list<string> $publicIds
 * @return array<string, int> "<entityType>:<public_id>" => Namensraum
 */
function avesmapsFeatureSourcesWikiNamespacesFuerKennungen(
    PDO $pdo,
    string $entityType,
    array $publicIds
): array {
    $entityType = trim($entityType);
    $ids = avesmapsFeatureSourcesKanonKennungen($publicIds);
    if ($entityType === '' || $ids === []) {
        return [];
    }

    // 💣 ZWEI OBJEKTARTEN OHNE `map_features`-ZEILE, UND BEIDE MUESSEN HIER STEHEN. Territorien
    // haben nie eine; eine Landschaftsflaeche auch nicht -- ihre Zuweisung steht in
    // `ecosystem_region.wiki_url`. Fehlte eine von beiden, kippte das Etikett im Moment des
    // Speicherns: der Server rechnet richtig, die ANTWORT der Schreibaktion traegt aber kein
    // Etikett, der Client-Nachtrag schreibt es in die Kanon-Tafel, und es bleibt dort bis zum
    // Neuladen stehen. Genau dieser Fehler wurde am 09.09.2026 am „Schwanenbruch" gemeldet und
    // eine Objektart weiter (Wege) am selben Tag noch einmal.
    $tabellenLeser = [
        'territory' => 'avesmapsPoliticalTerritoryWikiNamespaces',
        'ecosystem' => 'avesmapsEcosystemRegionWikiNamespaces',
    ];
    if (isset($tabellenLeser[$entityType])) {
        $alle = $tabellenLeser[$entityType]($pdo);
        // 💣 DIE ZWEITE TUER BRAUCHT DENSELBEN RUECKFALL WIE DIE ERSTE. Traegt die Flaeche selbst
        // keine Adresse, springt ihre Beschriftung ein (siehe
        // avesmapsEcosystemNamespacesAusBeschriftungen). Ohne diesen Block saehe ein Editor sein
        // Etikett beim Seitenladen und verloere es in dem Moment, in dem er eine Quelle speichert
        // -- der Schwanenbruch-Fehler vom 09.09.2026, dritte Auflage. Gemessen am 10.09.2026:
        // 6 der 9 betroffenen Flaechen haengen an genau diesem Rueckfall.
        if ($entityType === 'ecosystem') {
            $alle += avesmapsEcosystemRaeumeAusBeschriftungen($pdo, $alle);
        }
        $out = [];
        foreach ($ids as $id) {
            $key = $entityType . ':' . $id;
            if (isset($alle[$key])) {
                $out[$key] = $alle[$key];
            }
        }

        return $out;
    }

    // Der Feature-Typ zu dieser Objektart -- dieselbe Tafel, nur andersherum gelesen.
    $featureType = array_search($entityType, AVESMAPS_MAP_FEATURES_KANON_ENTITY_TYPE_BY_FEATURE_TYPE, true);
    if ($featureType === false) {
        // ⚠️ citymap und lore: fuer sie kennt der Kanon-Leser kein Zuweisungsnest. Kein Namensraum
        // heisst „keine Aussage" -- dort entscheiden die Quellen allein, wie bisher. `ecosystem`
        // stand hier bis zum 10.09.2026 mit dabei und ist jetzt eine Zeile weiter oben zu Hause.
        return [];
    }

    $platzhalter = implode(', ', array_fill(0, count($ids), '?'));
    try {
        $statement = $pdo->prepare(
            "SELECT public_id, feature_type, name, properties_json
               FROM map_features
              WHERE is_active = 1 AND feature_type = ? AND public_id IN ($platzhalter)"
        );
        $statement->execute(array_merge([$featureType], $ids));
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        // 💣 EIN WEG BRAUCHT SEINE GESCHWISTER, sonst erbt er nicht -- und das ist keine Feinheit,
        // sondern eine gemeldete Fehlerklasse. avesmapsMapFeaturesWikiNamespaces ruft am Ende
        // avesmapsMapFeaturesWegGruppeErbtZuweisung, und die kann eine Zuweisung nur weitergeben,
        // wenn sie ALLE Segmente der Namensgruppe sieht. Mit nur der gefragten Zeile gibt es nie
        // ein Geschwister, die Erbschaft faellt aus, und ein unzugewiesenes Segment mit einer
        // inoffiziellen Quelle steht ploetzlich auf „inoffiziell │ Briefspiel", waehrend dasselbe
        // Segment beim Seitenladen „offiziell" ist. Reproduziert am 09.09.2026: das blosse OEFFNEN
        // des Quellenkastens eines Abschnitts im Wege-Editor kippte den Wert -- und weil der
        // Client-Nachtrag ihn in die Kanon-Tafel schreibt, blieb er dort bis zum Neuladen stehen.
        // Es ist der Pergelbach-Fehler („ein Weg, zwei Aussagen") in neuer Verkleidung.
        // ⚠️ Nur fuer Wege: nur sie kennen diese Erbschaft (zwei gleichnamige Doerfer sind zwei
        // Doerfer). Gruppiert wird nach feature_subtype + name -- dieselbe Regel wie dort.
        if ($featureType === 'path' && $rows !== []) {
            $rows = avesmapsFeatureSourcesWegGruppeNachladen($pdo, $rows);
        }
    } catch (Throwable $fehler) {
        // ⚠️ Protokolliert, nicht geschluckt: ein SQL-Fehler saehe sonst exakt aus wie „kein Objekt
        // ist zugewiesen" -- die HY093-Falle von „Was ist hier?" (AGENTS.md §11).
        error_log('avesmapsFeatureSourcesWikiNamespacesFuerKennungen: ' . $fehler->getMessage());

        return [];
    }

    $features = [];
    foreach ($rows as $row) {
        $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
        if (!is_array($properties)) {
            $properties = [];
        }
        // Die zwei Felder, an denen der geteilte Rechner das Objekt erkennt -- eine gespeicherte
        // Zeile fuehrt sie nicht zwingend im JSON.
        $properties['feature_type'] = (string) ($row['feature_type'] ?? '');
        $properties['public_id'] = (string) ($row['public_id'] ?? '');
        $features[] = ['properties' => $properties];
    }

    return avesmapsMapFeaturesWikiNamespaces($features);
}

/**
 * Die GESCHWISTER-SEGMENTE der gefragten Wege dazuladen -- Voraussetzung der Zuweisungs-Erbschaft.
 *
 * 🔴 Gruppiert wird nach `feature_subtype` + `name`, weil genau danach auch
 * avesmapsMapFeaturesWegGruppeErbtZuweisung gruppiert. Eine andere Gruppierung hier hiesse: die
 * Erbschaft sieht eine andere Menge als die, fuer die sie gedacht ist.
 * ⚠️ Ein Segment OHNE Namen kann weder erben noch vererben (die Erbschaft ueberspringt es) -- fuer
 * das muss auch nichts nachgeladen werden.
 * ⚠️ Die Zeilen kommen entdoppelt zurueck -- eine gefragte Kennung steht sonst zweimal darin.
 * 🪤 Diese zwei Feinheiten sind SAUBERKEIT, kein Riegel, und das steht hier, damit sie niemand fuer
 * tragend haelt: nachgemessen (09.09.2026, Mutationsprobe) ist die Erbschaft gegen Dubletten
 * unempfindlich -- sie sammelt Raeume in einem Set und weist idempotent zu -- und ein leerer Name
 * faende ohnehin nur namenlose Segmente, die nie erben. Eine Mutation an diesen beiden Zeilen laesst
 * die Tests deshalb zu Recht gruen. Tragend ist allein, DASS nachgeladen wird.
 *
 * @param list<array<string, mixed>> $rows die schon geladenen Zeilen der gefragten Kennungen
 * @return list<array<string, mixed>> dieselben Zeilen plus alle Geschwister ihrer Namensgruppen
 */
function avesmapsFeatureSourcesWegGruppeNachladen(PDO $pdo, array $rows): array
{
    // 💣 DER NAME WIRD AUS BEIDEN QUELLEN GESAMMELT -- Spalte UND `properties_json`. Gefiltert wird
    // ueber die SPALTE (nur die ist indiziert), gruppiert spaeter ueber das JSON
    // (avesmapsMapFeaturesWegGruppeErbtZuweisung liest `properties.name`). Laufen die beiden bei
    // einer Zeile auseinander -- oder ist eine von beiden leer --, faende ein Filter aus nur einer
    // Quelle die Geschwister nicht, und die Erbschaft fiele still wieder aus. Genau daran ist der
    // erste Bau am 09.09.2026 in der eigenen Probe gescheitert.
    $namen = [];
    foreach ($rows as $row) {
        $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
        foreach ([
            is_array($properties) ? ($properties['name'] ?? '') : '',
            $row['name'] ?? '',
        ] as $wert) {
            $name = trim((string) $wert);
            if ($name !== '') {
                $namen[$name] = true;
            }
        }
    }
    if ($namen === []) {
        return $rows;
    }

    // ⚠️ Gefiltert wird ueber die SPALTE `name` -- nur sie ist indiziert; die Wegart entscheidet
    // erst die Erbschaft selbst. Ein Name trifft im Regelfall die Segmente EINES Wegs.
    // 🚩 Am Dump vom 08.09.2026 nachgezaehlt: **8360 von 8360** Wegen tragen die Spalte gefuellt,
    // keiner leer. Das ist die Voraussetzung, unter der dieser Filter ueberhaupt wirkt -- eine
    // Wegwerf-Probe mit leerer Spalte lief beim Bau ins Leere und sah wie ein kaputter Fix aus.
    $liste = array_keys($namen);
    $platzhalter = implode(', ', array_fill(0, count($liste), '?'));
    $statement = $pdo->prepare(
        "SELECT public_id, feature_type, name, properties_json
           FROM map_features
          WHERE is_active = 1 AND feature_type = 'path' AND name IN ($platzhalter)"
    );
    $statement->execute($liste);

    $out = [];
    foreach (array_merge($rows, $statement->fetchAll(PDO::FETCH_ASSOC)) as $row) {
        $out[(string) ($row['public_id'] ?? '')] = $row;
    }

    return array_values($out);
}

/**
 * Die gefragten Kennungen, geputzt: getrimmt, ohne Leere, ohne Dubletten, Reihenfolge erhalten.
 *
 * ⚠️ Eine leere Kennung erzeugte sonst den Schluessel „path:" und damit eine Antwort ueber ein
 * Objekt, das es nicht gibt.
 *
 * @param list<mixed> $publicIds
 * @return list<string>
 */
function avesmapsFeatureSourcesKanonKennungen(array $publicIds): array
{
    $ids = [];
    foreach ($publicIds as $wert) {
        if (!is_string($wert) && !is_int($wert)) {
            continue;
        }
        $id = trim((string) $wert);
        if ($id !== '' && !in_array($id, $ids, true)) {
            $ids[] = $id;
        }
    }

    return $ids;
}

/**
 * DER REINE KERN DER KANON-AUSKUNFT -- ohne PDO, ohne Laden, ohne Datenbank.
 *
 * 💣 ER IST GESCHNITTEN, WEIL DIE FIXTURE ES SONST NICHT ZEIGEN KANN. Ein Test, der Katalog und
 * Verweise in SQLite aufbaut und den PDO-Weg ruft, ist WIRKUNGSLOS: avesmapsLoadFeatureSourceRefs
 * und avesmapsLoadFeatureSourceCatalog tragen beide avesmapsFeatureSourceLiveEntityClause mit
 * `COLLATE utf8mb4_unicode_ci`, das SQLite nicht kennt -- und fangen die Ausnahme ab. Gemessen am
 * 09.09.2026: beide geben dort still `[]` zurueck. Jede Zusicherung ueber ein abgeleitetes Etikett
 * liefe gegen eine leere Eingabe. Dasselbe Muster wie avesmapsEcosystemReadChangeLog (AGENTS.md §11).
 *
 * 🔴 JEDE ANGEFRAGTE KENNUNG STEHT IN DER TAFEL, und die zwei Antworten sind NICHT dasselbe:
 * `['kanon' => '']` heisst „nachgesehen, kein Etikett" und wird vom Client GESETZT; `null` heisst
 * „unbelegt" und LOESCHT seinen Eintrag. Ein FEHLENDER Schluessel hiesse „nicht gefragt". Genau an
 * dieser Unterscheidung haengt der Fehler vom 09.09.2026.
 *
 * @param list<string> $publicIds
 * @param array<int|string, array<string, mixed>> $catalog
 * @param array<string, list<array<string, mixed>>> $refs "typ:public_id" => Verweise
 * @param array<string, int> $wikiNamespaces "typ:public_id" => Namensraum
 * @return array<string, array{kanon:string, bezeichner_label?:string, bezeichner_type?:string, bezeichner_count?:int}|null>
 */
function avesmapsFeatureSourcesKanonAusEingaben(
    string $entityType,
    array $publicIds,
    array $catalog,
    array $refs,
    array $wikiNamespaces
): array {
    $entityType = trim($entityType);
    $ids = avesmapsFeatureSourcesKanonKennungen($publicIds);
    if ($entityType === '' || $ids === []) {
        return [];
    }

    // Nur die gefragten Kennungen. ⚠️ Das ist eine LAST-Massnahme, kein Korrektheitsriegel: die
    // Ausgabeschleife unten laeuft ohnehin nur ueber `$ids`, eine Mutation zu `$refs` ist an der
    // Antwort nicht messbar (nachgemessen 09.09.2026). Der Grund ist die Groesse -- der Vorrat
    // traegt rund 5000 Schluessel, gefragt sind hoechstens AVESMAPS_PATH_GROUP_MAX_SEGMENTS.
    $eigene = [];
    foreach ($ids as $id) {
        $key = $entityType . ':' . $id;
        if (isset($refs[$key])) {
            $eigene[$key] = $refs[$key];
        }
    }

    $kanon = avesmapsFeatureSourcesDeriveKanon($catalog, $eigene, $wikiNamespaces);

    $out = [];
    foreach ($ids as $id) {
        $key = $entityType . ':' . $id;
        if (isset($kanon[$key])) {
            $out[$id] = $kanon[$key];
            continue;
        }
        // 💣 „KEIN ETIKETT" WIRD AUSDRUECKLICH GEMELDET, wenn das Objekt Verweise hat -- sonst
        // loescht der Aufrufer seinen Abweichungseintrag und der Browser faellt auf die Vorgabe
        // „offiziell" zurueck. Dieselbe Falle wie in der Nutzlast (api/app/map-features.php), nur
        // eine Schreibaktion spaeter: wer eine Wiki-Zuweisung ENTFERNT, saehe sein Objekt sonst
        // weiterhin als offiziell, bis er die Seite neu laedt.
        $out[$id] = (isset($eigene[$key]) && $eigene[$key] !== []) ? ['kanon' => ''] : null;
    }

    return $out;
}

/**
 * DAS KANON-ETIKETT VIELER OBJEKTE -- fuer die Antwort einer Quellen-Schreibaktion.
 *
 * 🚩 Owner-Meldung 09.09.2026, mit Bild: die Landschaftsflaeche „Schwanenbruch" trug am Kopf
 * OFFIZIELL und darunter ihre einzige Quelle als „INOFFIZIELL │ Briefspiel". Der Client-Nachtrag
 * (syncFeatureSourcesToClientCache) schreibt die Verweise in den Kartenspeicher, und
 * resolveFeatureKanon (js/ui/popups.js) liest „Verweise da + keine Abweichung" als Vorgabe
 * „offiziell". Diese Funktion liefert die fehlende Haelfte.
 *
 * 💣 EIN RECHNER FUER VIELE KENNUNGEN, weil der Wege-Verteiler bis zu
 * AVESMAPS_PATH_GROUP_MAX_SEGMENTS Kennungen in EINER Anfrage schickt und der Garetien-Import viele
 * Objekte je Lauf anlegt. Katalog und Verweise werden EINMAL geladen. avesmapsFeatureSourcesKanonFuerEines
 * in eine Schleife zu stellen waere genau die Last, vor der CLAUDE.md warnt -- ihr eigener Docblock
 * sagt es, und seit heute ruft sie ohnehin hier herein.
 *
 * @param list<string> $publicIds
 * @param array<string, string> $wikiUrlJeKennung  Adressen, die der Aufrufer GERADE geschrieben hat.
 *        Sie schlagen die gespeicherten -- er kennt sie genauer als ein zweiter Lesevorgang, der mit
 *        ihm um die Reihenfolge konkurrierte. Eine ausdruecklich LEERE nimmt den gespeicherten Raum
 *        zurueck, sonst saehe der Editor sein eigenes Entfernen einer Zuweisung nicht.
 * @return array<string, array{kanon:string, bezeichner_label?:string, bezeichner_type?:string, bezeichner_count?:int}|null>
 */
function avesmapsFeatureSourcesKanonFuerMehrere(
    PDO $pdo,
    string $entityType,
    array $publicIds,
    array $wikiUrlJeKennung = []
): array {
    $entityType = trim($entityType);
    $ids = avesmapsFeatureSourcesKanonKennungen($publicIds);
    if ($entityType === '' || $ids === []) {
        return [];
    }

    $raeume = avesmapsFeatureSourcesWikiNamespacesFuerKennungen($pdo, $entityType, $ids);
    foreach ($wikiUrlJeKennung as $id => $wikiUrl) {
        $key = $entityType . ':' . trim((string) $id);
        // 🔴 MIT Hauptraum: der Aufrufer hat gerade eine Zuweisung GESCHRIEBEN, die Adresse ist also
        // per Konstruktion eine echte -- und eine Hauptraum-Zuweisung macht seit dem 08.09.2026
        // offiziell.
        $ns = avesmapsWikiNamespaceFromWikiUrlMitHauptraum(trim((string) $wikiUrl));
        if ($ns !== null) {
            $raeume[$key] = $ns;
        } else {
            unset($raeume[$key]);
        }
    }

    return avesmapsFeatureSourcesKanonAusEingaben(
        $entityType,
        $ids,
        avesmapsLoadFeatureSourceCatalog($pdo),
        avesmapsLoadFeatureSourceRefs($pdo),
        $raeume
    );
}

/**
 * „KEIN ETIKETT" ALS AUSDRUECKLICHE AUSKUNFT -- fuer die Objekte, die eine brauchen.
 *
 * 🚩 Owner 08.09.2026: „hm warte mal, Dommel ist nicht zugewiesen, aber es steht offiziell dran."
 * `resolveFeatureKanon` (js/ui/popups.js) faellt fuer ein Objekt MIT Verweisen auf die Vorgabe
 * „offiziell" zurueck -- ein FEHLENDER Eintrag heisst dort „offiziell", nicht „nichts". Seit
 * Publikationen keinen Kanon mehr machen, gibt es aber Objekte MIT Quellen und OHNE Etikett.
 *
 * 💣 UND SIE GILT NUR DEN BEDIENTEN OBJEKTARTEN. Der erste Anlauf schrieb den Leer-Eintrag fuer
 * JEDEN Schluessel aus `feature_sources` -- und traf damit **447 Landschaftsflaechen**
 * (`ecosystem`), um die es damals nicht ging; sie verloren so ihr bisheriges „offiziell" aus der
 * Vorgabe. Live gemessen am 08.09.2026: 591 Leer-Eintraege, davon 447 ecosystem, 107 path,
 * 23 settlement, 14 territory. Gemeint waren die 130 der letzten drei.
 *
 * 🔴 DIE BEGRUENDUNG VON DAMALS WAR FALSCH, UND ZWAR NACHWEISLICH. Hier stand, der Kanon-Leser
 * kenne `ecosystem` gar nicht, sie koennten „per Konstruktion nie ein Etikett bekommen". Das galt
 * nur fuer die RAENGE 1 UND 2 (die Wiki-Zuweisung); die Raenge 3 und 4 liefen fuer sie seit jeher,
 * weil avesmapsFeatureSourcesDeriveKanon ueber `array_keys($refs)` laeuft und keine Objektart
 * ausnimmt -- gemessen am 09.09.2026 waren es 40 Landschaftsflaechen mit „inoffiziell". Genau
 * dieser Satz hat den Altenforst-Fehler (10.09.2026) gedeckt: er las sich wie „hier ist nichts zu
 * holen", und deshalb hat niemand nachgezaehlt, dass die Haelfte der Regel dort fehlt.
 * ⭐ Seit dem 10.09.2026 ist `ecosystem` ueber avesmapsEcosystemRegionWikiNamespaces angeschlossen.
 * ✅ **UND SEIT DEMSELBEN TAG STEHT SIE DESHALB IN `$bedient`** (Owner: „fix dommel fall nach").
 * Eine Landschaftsflaeche OHNE Zuweisung, deren Verweise ausschliesslich PUBLIKATIONEN sind, bekommt
 * damit KEIN Etikett mehr statt des geerbten „offiziell" -- Rang 5 der Regel, und derselbe Entscheid,
 * den Dommel am 08.09.2026 fuer die uebrigen Objektarten ausgeloest hat.
 * 💣 UND ES HEILT EINEN WIDERSPRUCH, DEN NIEMAND GEMELDET HAT: die zweite Tuer
 * (avesmapsFeatureSourcesKanonAusEingaben, die Antwort einer Schreibaktion) meldet `['kanon' => '']`
 * seit jeher TYPUNABHAENGIG -- also auch fuer `ecosystem`. Dasselbe Objekt sagte deshalb „offiziell",
 * solange man nur die Seite lud, und verlor sein Etikett in dem Moment, in dem jemand eine Quelle
 * speicherte. Zwei Antworten auf dieselbe Frage, je nachdem, ob gerade geschrieben wurde.
 * ⚠️ WAS SICH DABEI NICHT AENDERT: eine Flaeche MIT Zuweisung (Rang 1/2) und eine mit einer echten
 * Quelle (Rang 3/4) bekommen ihr Etikett aus der Ableitung und kommen hier gar nicht an. Betroffen
 * ist ausschliesslich „nichts gesagt, nur gelistet".
 * 🔧 OFFEN, und die Richtung ist die sichere: traegt die FLAECHE keine Adresse, waehrend eine ihrer
 * Beschriftungen eine hat (moeglich fuer Zeilen aus der Zeit vor dem Durchtrag vom 01.09.2026),
 * bekommt sie hier „kein Etikett" statt des Etiketts ihrer Zuweisung. Sie behauptet dann zu wenig,
 * nie zu viel -- und der ns-222-Fall, der heute faelschlich „offiziell" sagt, wird dabei still statt
 * falsch. Geheilt wird das durch den Durchtrag selbst („Wiki & Art" im Landschaften-Editor), nicht
 * durch eine zweite Lesart hier.
 * ⚠️ Wer `citymap` oder `lore` je an den Kanon anschliesst, ergaenzt sie DORT und bekommt den
 * Leer-Eintrag von hier geschenkt -- nicht umgekehrt.
 *
 * @param array<string, list<array<string, mixed>>> $refs   "typ:public_id" => Verweise
 * @param array<string, array<string, mixed>> $kanon        was die Ableitung gefunden hat
 * @return array<string, array{kanon:string}> die zusaetzlichen Leer-Eintraege
 */
function avesmapsFeatureSourcesKanonLeerEintraege(array $refs, array $kanon): array
{
    // ⚠️ `territory` und `ecosystem` stehen hier von Hand, weil beide keine `map_features`-Zeile
    // haben und damit in der Tafel darueber nicht vorkommen koennen -- dieselben zwei, die auch
    // avesmapsFeatureSourcesWikiNamespacesFuerKennungen eigens auffuehrt. Die zwei Listen gehoeren
    // zusammen: eine Objektart, die ihren Namensraum aus einer eigenen Tabelle bekommt, braucht
    // hier den Leer-Eintrag, sonst faellt genau sie auf die Vorgabe „offiziell" zurueck.
    $bedient = array_flip(array_merge(
        array_values(AVESMAPS_MAP_FEATURES_KANON_ENTITY_TYPE_BY_FEATURE_TYPE),
        ['territory', 'ecosystem']
    ));

    $out = [];
    foreach (array_diff_key($refs, $kanon) as $schluessel => $verweise) {
        if ($verweise === []) {
            continue;
        }
        $typ = explode(':', (string) $schluessel, 2)[0];
        if (isset($bedient[$typ])) {
            $out[$schluessel] = ['kanon' => ''];
        }
    }

    return $out;
}

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
        $typen = [];
        $inoffizielle = 0;
        foreach ($liste as $ref) {
            // 💣 NICHT NACH int WANDELN. Der Katalog trug neben den echten `sources.id` bis zum 03.09.2026
            // SYNTHETISCHE Schluessel fuer die Altquellen aus `properties.other_source`:
            // `'os:' . $publicId` (der os:-Erzeuger, seit Schritt 4 des Quellen-Umbaus weg). Die Regel bleibt:
            // `(int) 'os:abc'` ist 0, der Verweis fand nie eine Katalogzeile und wurde als
            // „ohne Aussage" verworfen -- ausgerechnet der Fall, den der Docblock oben als
            // abgewendet beschreibt. Ein Objekt, dessen EINZIGE Quelle eine Altquelle ist, bekam
            // damit kein Etikett, und weil „kein Etikett" ein gueltiger Zustand ist, fiel es
            // nicht auf. Der Schluessel wird deshalb genommen, wie er ist.
            // 🔴 EINE PUBLIKATION MACHT WEDER OFFIZIELL NOCH INOFFIZIELL (Owner 08.09.2026:
            // „publikationen sind übrigens nicht wichtig - die werden einfach gelistet, was auch
            // immer da drin steht kann egal sein, offiziell / inoffiziell machen es nur quellen").
            // Erkannt am `reference_kind` -- genau daran trennt auch der Quellenkasten die Zeile
            // „Quelle(n):" von der Publikationstabelle (js/ui/feature-source-markup.js).
            // 💣 Ohne diese Zeile entschied die UNGLEICHE Verteilung der Publikationen ueber den
            // Kopf: der Pergelbach trug seine drei Publikationsquellen an EINEM seiner drei
            // Abschnitte, und derselbe Fluss stand dadurch einmal offiziell und zweimal
            // inoffiziell da (gemeldet 08.09.2026, ebenso Kaltwasser).
            if (trim((string) ($ref['reference_kind'] ?? '')) !== '') {
                continue;
            }
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
            $typ = trim((string) ($eintrag['type'] ?? ''));
            if ($typ !== '') {
                $typen[$typ] = true;
            }
        }

        // 🔴 RANG 1 SEIT DEM 08.09.2026: DIE WIKI-ZUWEISUNG ENTSCHEIDET, NICHT DIE QUELLEN.
        // Owner, wortwoertlich: „also ‚offiziell' wenn ‚wiki-zuweisung = true'" -- und davor:
        // „wenn es eine offizielle quelle gibt (normaler namensraum im wiki) und verbunden, ist es
        // offiziell (oben im header). wenn editoren weitere, inoffizielle quellen hinzufügen, dann
        // stehn die als z.b. inoffiziell | briefspiel dran, aber das objekt bleibt offiziell. […]
        // es sei denn es verliert seine wiki-zuweisung (dann gilt inoffiziell)."
        //
        // 💣 DAS KEHRT DIE ALTE RANGFOLGE UM, und der Grund ist ein gemeldeter Widerspruch: bis
        // hierher fragte die Ableitung ZUERST die Katalogquellen. Fehlte die offizielle Quelle,
        // gewann damit eine beliebige inoffizielle -- ein Ort mit Hauptraum-Artikel UND einer
        // Briefspielquelle stand als „INOFFIZIELL │ Briefspiel" da, obwohl er im Wiki ganz normal
        // verzeichnet ist. Gemeldet am 08.09.2026 am Pergelbach und am Kaltwasser: derselbe Fluss
        // trug an einem Abschnitt „offiziell" und an zweien „inoffiziell", weil seine
        // Publikationsquellen nur an einem der drei Abschnitte hingen. 41 Objekte im Livebestand.
        //
        // 🔴 DIE ZUWEISUNG IST DIE ANWESENHEIT DES SCHLUESSELS, nicht sein Wert. Der Leser
        // (avesmapsMapFeaturesWikiNamespaces) traegt ein Objekt nur ein, wenn es ein echtes
        // Zuweisungsnest hat -- der Hauptraum meldet sich dabei als `0`. Ein bloss GERATENER
        // `properties.wiki_url` kommt hier nie an; das ist die halbe Miete dieser Regel.
        // ⚠️ Die eine Ausnahme im Leser: ein UNzugewiesenes Objekt mit erkennbar inoffiziellem
        // Raum bleibt eingetragen. Es faellt hier in denselben Zweig und bleibt inoffiziell --
        // die sichere Richtung, und der Zustand von vor diesem Umbau.
        $ns = $wikiNamespaces[$key] ?? null;
        if ($ns !== null) {
            $raumOffiziell = avesmapsWikiNamespaceIsOfficial((int) $ns);
            if ($raumOffiziell === false) {
                // ns 222 / ns 444: „Inoffiziell │ Wiki Aventurica". Der Bezeichner ist hier
                // ausdruecklich der KORPUSNAME und nicht die Art -- Owner 02.09.2026, siehe die
                // Begruendung im Docblock oben.
                $out[$key] = ['kanon' => 'inoffiziell', 'bezeichner_label' => 'Wiki Aventurica'];
                continue;
            }
            if ($raumOffiziell === true) {
                // 🔴 OHNE BEZEICHNER: „offiziell" ist immer die ganze, runde Pille (Owner
                // 03.09.2026: „bei Offiziell will ich die volle pille"), und am 08.09.2026 an
                // zwei Screenshots (Salderkeim, Trallop) bestaetigt. Die Halbpille sagt, dass
                // etwas OFFEN ist; offiziell trennt nichts auf.
                $out[$key] = ['kanon' => 'offiziell'];
                continue;
            }
            // ⚠️ `null` heisst „Raum ist kein Inhaltsraum" (Kategorie, Vorlage, Datei). Das ist
            // KEINE Aussage und faellt bewusst durch zu den Quellen darunter.
        }

        // ---- Ohne Zuweisung entscheiden die Quellen, wie eh und je -----------------------------
        if ($hatOffizielle) {
            $out[$key] = ['kanon' => 'offiziell'];
            continue;
        }

        if ($inoffizielle < 1) {
            continue; // keine verwertbare Quelle, kein inoffizieller Raum -- kein Etikett
        }

        // 🔴 DER BEZEICHNER IST DIE ART, NIE DER NAME EINER QUELLE. Owner 03.09.2026: „da oben soll
        // immer Inoffiziell + Art stehen, also z.B. Inoffiziell | Briefspiel -- nicht der artikelname".
        //
        // 💣 BIS DAHIN GAB EINE EINZIGE INOFFIZIELLE QUELLE IHREN `label` HER, und das war als
        // KORPUSNAME gemeint („Briefspiel (Garetien)"). Mit dem Korpus-Modell ist `label` der
        // SEITENTITEL der Belegstelle: am Kopf stand „INOFFIZIELL │ Herzoglich Mauterndorf" -- der
        // Name EINES Artikels an der Stelle, an der die Herkunftsart hingehoert (Owner-Meldung mit
        // Bild, 03.09.2026). Es ist derselbe Befund wie bei ns 222 („INOFFIZIELL │ Apfeldorn",
        // 02.09.2026), damals ueber die Rangfolge geheilt -- hier an der Wurzel: ein Titel ist an
        // dieser Stelle nie die Auskunft, die gefragt ist, egal wie genau er ist.
        //
        // ⚠️ MEHRERE ARTEN BLEIBEN DIE GANZE PILLE. „Gemischt" ist keine Art, und eine
        // herausgegriffene waere eine Behauptung ueber die anderen. Vorher fiel dieser Fall auf den
        // gemeinsamen NAMEN zurueck, wenn es einen gab -- den gibt es hier nicht mehr.
        $eintragOut = ['kanon' => 'inoffiziell'];
        if (count($typen) === 1) {
            $eintragOut['bezeichner_type'] = (string) array_key_first($typen);
        }
        // Die Anzahl macht aus der Art „Briefspiel (2)". 💣 Gezaehlt werden QUELLEN, nicht Arten --
        // und erst ab zwei: eine „(1)" saegte nur Rauschen an die Art.
        if ($inoffizielle > 1) {
            $eintragOut['bezeichner_count'] = $inoffizielle;
        }
        $out[$key] = $eintragOut;
    }

    return $out;
}

/**
 * DIE QUELLEN EINES WEGS GEHOEREN ALLEN SEINEN ABSCHNITTEN -- der Nachziehlauf.
 * ---------------------------------------------------------------------------
 * 🔴 Owner 08.09.2026: „Quellen wirklich verteilen -> das wollen wir." Vorausgegangen war die
 * Meldung am Pergelbach (derselbe Fluss stand einmal offiziell und zweimal inoffiziell da) und
 * die Frage, ob der Kopf die Quellen der Nachbarabschnitte bloss MITLESEN soll. Nein: dann
 * truege Abschnitt 5 ein „INOFFIZIELL │ Briefspiel", waehrend sein Quellenkasten leer ist -- ein
 * Etikett, das die Liste darunter nicht deckt. Verteilt werden die Quellzeilen selbst.
 *
 * 🔴 VERTEILT WERDEN NUR ECHTE QUELLEN, NIE PUBLIKATIONEN (erkannt am `reference_kind`). Die
 * gehoeren dem Publikations-Abgleich, der sie an jedes ZUGEWIESENE Segment haengt und wieder
 * abraeumt, wenn sie aus dem Artikel verschwinden -- an ein unzugewiesenes Segment kopiert waeren
 * sie Waisen, die niemand mehr aufraeumt. Am Livebestand gemessen (08.09.2026): von 1070
 * fehlenden Verknuepfungen waren **1035 Publikationen** und 35 echte Quellen; der Sichelstieg
 * allein haette 285 bekommen. Fuer sie ist der richtige Weg die ZUWEISUNG der fehlenden Segmente.
 *
 * ⭐ DAS IST KEIN NEUER MECHANISMUS, sondern ein Nachzieher. Die Eingabezeile des Quellen-Editors
 * verteilt seit dem 03.09.2026 per VORGABE an „alle N Abschnitte dieses Weges" (2.347 von 2.511
 * Wegquellen haengen dadurch schon an allen). Nur der Altbestand hat das nie gesehen.
 *
 * 🔴 DIE GRUPPE IST DER NAME (Wegart + Name), NICHT DER `wiki_key` -- dieselbe Regel wie bei
 * avesmapsMapFeaturesWegGruppeErbtZuweisung, und aus demselben Grund: ein unzugewiesenes Segment
 * hat keinen Schluessel und faellt aus jeder Schluesselgruppe heraus, obwohl es gerade IHN
 * erreichen muss. Am Dump vom 08.09.2026 sind 16 von 350 mehrteiligen Wegen nur teilweise
 * zugewiesen.
 * 💣 UND DESHALB DER RIEGEL: eine Namensgruppe mit MEHREREN verschiedenen `wiki_key` ist NICHT
 * ein Weg, sondern zwei gleichnamige -- sie wird uebersprungen. Ohne diesen Riegel wanderten die
 * Quellen des einen Wegs an den anderen, und das faellt niemandem auf, weil beide gleich heissen.
 *
 * 💣 GESCHRIEBEN WIRD NUR, WAS FEHLT. Eine vorhandene Zeile wird NIE angefasst -- auch keine
 * `suppressed` (der Grabstein einer bewusst entfernten Quelle) und keine mit abweichenden
 * Seitenangaben. Der Lauf fuegt hinzu, er gleicht nicht ab. Ein Abgleich muesste entscheiden,
 * welche von zwei Seitenangaben gilt, und diese Entscheidung gehoert einem Menschen.
 * ⚠️ Damit ist er auch WIEDERHOLBAR: ein zweiter Lauf findet nichts mehr zu tun.
 *
 * 💣 KEIN UPSERT. `avesmapsFeatureSourceLink` ist ein MySQL-`ON DUPLICATE KEY UPDATE` und laeuft
 * auf SQLite nicht -- ein Test koennte den Schreibweg dann nur lesen statt fahren (AGENTS.md).
 * Hier wird geprueft und eingefuegt, portabel auf beiden.
 *
 * 🔴 Trockenlauf ist die Vorgabe, wie bei jedem Sammellauf des Hauses. Scharf nur mit
 * `apply: true`, gedeckelt, und je Gruppe eine eigene Transaktion -- ein Fehler nimmt nicht den
 * ganzen Lauf mit.
 * ⚠️ `avesmapsEnsureFeatureSourceTables` laeuft VOR der ersten Transaktion: DDL committet in
 * MySQL implizit, und innerhalb der Transaktion gerufen beendet es sie lautlos (die Falle, die
 * Schritt 5 des Quellen-Umbaus 489 falsche Fehlermeldungen gekostet hat).
 *
 * @param bool $trocken true = nur zaehlen, nichts schreiben
 * @param int  $limit   Hoechstzahl NEUER Verknuepfungen je Lauf
 * @return array{ok:bool, gruppen_geprueft:int, gruppen_betroffen:int, verknuepfungen_neu:int,
 *                uebersprungen_uneindeutig:int, offen:int, trocken:bool, stichprobe:list<string>}
 */
function avesmapsFeatureSourcesVerteileWegQuellen(
    PDO $pdo,
    int $userId,
    bool $trocken = true,
    int $limit = 500
): array {
    avesmapsEnsureFeatureSourceTables($pdo);

    // 1. Die Abschnitte. `properties_json` nur wegen des `wiki_key` -- er entscheidet den Riegel.
    $segmente = [];
    $statement = $pdo->query(
        "SELECT public_id, name, feature_subtype, properties_json
           FROM map_features
          WHERE is_active = 1 AND feature_type = 'path'"
    );
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $name = trim((string) ($row['name'] ?? ''));
        $publicId = trim((string) ($row['public_id'] ?? ''));
        if ($name === '' || $publicId === '') {
            continue; // ohne Namen keine Gruppe -- 101 solcher Stuecke im Bestand
        }
        $props = json_decode((string) ($row['properties_json'] ?? ''), true);
        $props = is_array($props) ? $props : [];
        $wikiKey = '';
        if (is_array($props['wiki_path'] ?? null)) {
            $wikiKey = trim((string) ($props['wiki_path']['wiki_key'] ?? ''));
        }
        $gruppe = trim((string) ($row['feature_subtype'] ?? '')) . '|' . $name;
        $segmente[$gruppe][] = ['public_id' => $publicId, 'wiki_key' => $wikiKey];
    }

    // 2. Die vorhandenen Verknuepfungen. ALLE Zustaende, nicht nur `approved`: ein Grabstein ist
    //    ein Beleg dafuer, dass diese Quelle an diesem Abschnitt NICHT stehen soll.
    $vorhanden = [];
    $vorlage = [];
    $statement = $pdo->query(
        "SELECT id, entity_public_id, source_id, status, origin, reference_kind, pages, note
           FROM feature_sources
          WHERE entity_type = 'path'
          ORDER BY id ASC"
    );
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $pid = (string) $row['entity_public_id'];
        $sid = (int) $row['source_id'];
        $vorhanden[$pid][$sid] = (string) $row['status'];
        // Die aelteste `approved`-Zeile je (Gruppe kommt spaeter) Quelle ist die Vorlage.
        if ((string) $row['status'] === 'approved' && !isset($vorlage[$pid . '|' . $sid])) {
            $vorlage[$pid . '|' . $sid] = $row;
        }
    }

    $gruppenGeprueft = 0;
    $gruppenBetroffen = 0;
    $neu = 0;
    $uneindeutig = 0;
    $offen = 0;
    $stichprobe = [];

    $einfuegen = $pdo->prepare(
        'INSERT INTO feature_sources
            (entity_type, entity_public_id, source_id, status, origin, reference_kind, pages, note, created_by)
         VALUES (:t, :pid, :sid, :st, :og, :rk, :pg, :nt, :by)'
    );

    foreach ($segmente as $gruppe => $liste) {
        if (count($liste) < 2) {
            continue; // ein einteiliger Weg hat nichts zu verteilen
        }
        $gruppenGeprueft++;

        // 💣 DER RIEGEL: zwei verschiedene wiki_key in einer Namensgruppe sind zwei Wege.
        $keys = [];
        foreach ($liste as $s) {
            if ($s['wiki_key'] !== '') {
                $keys[$s['wiki_key']] = true;
            }
        }
        if (count($keys) > 1) {
            $uneindeutig++;
            continue;
        }

        // Die Vereinigung: jede `approved` Quelle, die IRGENDEIN Abschnitt dieser Gruppe traegt.
        // 🔴 OHNE DIE PUBLIKATIONEN, und das ist die tragende Auswahl dieses Laufs. Owner
        // 08.09.2026: „publikationen sind übrigens nicht wichtig - die werden einfach gelistet."
        // 💣 GEMESSEN, NICHT GESCHAETZT: der erste Trockenlauf gegen die Live-Datenbank meldete
        // **1070** fehlende Verknuepfungen -- davon **1035 Publikationen** und 35 echte Quellen.
        // Der Sichelstieg allein haette 285 Publikationszeilen bekommen, der Rathilstieg 176.
        // 🔴 UND SIE GEHOEREN NICHT HIERHER: `origin = 'wiki_publication'` verwaltet der
        // Publikations-Abgleich (api/_internal/wiki/publication-sync.php). Er haengt sie an jedes
        // ZUGEWIESENE Segment und raeumt sie wieder ab, wenn sie aus dem Artikel verschwinden --
        // ueber `properties_json LIKE '%"wiki_path"%'`. Ein Segment OHNE Zuweisung findet er nie:
        // dorthin kopierte Publikationen waeren Waisen, die niemand mehr aufraeumt. Genau solche
        // liegen schon herum (Dommel, Barras -- siehe avesmapsMapFeaturesWikiNamespaces).
        // ⭐ Der richtige Weg fuer sie ist die ZUWEISUNG der fehlenden Segmente; danach verteilt
        // der Abgleich sie von selbst und haelt sie aktuell.
        $quellen = [];
        foreach ($liste as $s) {
            foreach ($vorhanden[$s['public_id']] ?? [] as $sid => $status) {
                if ($status !== 'approved' || isset($quellen[$sid])) {
                    continue;
                }
                $row = $vorlage[$s['public_id'] . '|' . $sid] ?? null;
                if ($row === null || trim((string) ($row['reference_kind'] ?? '')) !== '') {
                    continue; // eine Publikation -- der Wiki-Abgleich ist ihr Eigentuemer
                }
                $quellen[$sid] = $row;
            }
        }
        if ($quellen === []) {
            continue;
        }

        $fehlend = [];
        foreach ($liste as $s) {
            foreach ($quellen as $sid => $row) {
                if ($row === null || isset($vorhanden[$s['public_id']][$sid])) {
                    continue; // schon da -- in JEDEM Zustand, auch als Grabstein
                }
                $fehlend[] = ['pid' => $s['public_id'], 'sid' => (int) $sid, 'row' => $row];
            }
        }
        if ($fehlend === []) {
            continue;
        }
        $gruppenBetroffen++;
        if (count($stichprobe) < 12) {
            $stichprobe[] = str_replace('|', ' · ', (string) $gruppe)
                . ': ' . count($fehlend) . ' Verknuepfung(en) fehlen';
        }

        if ($neu >= $limit) {
            $offen += count($fehlend);
            continue;
        }

        if ($trocken) {
            $neu += count($fehlend);
            continue;
        }

        $pdo->beginTransaction();
        try {
            foreach ($fehlend as $f) {
                if ($neu >= $limit) {
                    $offen++;
                    continue;
                }
                $einfuegen->execute([
                    't' => 'path',
                    'pid' => $f['pid'],
                    'sid' => $f['sid'],
                    'st' => 'approved',
                    'og' => (string) ($f['row']['origin'] ?? 'manual'),
                    'rk' => ($f['row']['reference_kind'] ?? null) ?: null,
                    'pg' => ($f['row']['pages'] ?? null) ?: null,
                    'nt' => ($f['row']['note'] ?? null) ?: null,
                    'by' => $userId > 0 ? $userId : null,
                ]);
                $neu++;
            }
            $pdo->commit();
        } catch (Throwable $fehler) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            // ⚠️ Gemeldet, nicht geschluckt: ein stiller Fehlschlag saehe aus wie „nichts zu tun".
            $stichprobe[] = 'FEHLER in ' . str_replace('|', ' · ', (string) $gruppe)
                . ': ' . $fehler->getMessage();
        }
    }

    // 🔴 DER STEMPEL. Quellen reisen in der Kartennutzlast, deren ETag an `map_revision` haengt --
    // ohne Bump bekaeme jeder warme Browser sein 304 und saehe die alte Verteilung unbegrenzt
    // lange weiter. Dieselbe Regel wie beim Publikations-Abgleich.
    if (!$trocken && $neu > 0) {
        avesmapsNextMapRevision($pdo);
    }

    return [
        'ok' => true,
        'trocken' => $trocken,
        'gruppen_geprueft' => $gruppenGeprueft,
        'gruppen_betroffen' => $gruppenBetroffen,
        'verknuepfungen_neu' => $neu,
        'uebersprungen_uneindeutig' => $uneindeutig,
        'offen' => $offen,
        'stichprobe' => $stichprobe,
    ];
}
