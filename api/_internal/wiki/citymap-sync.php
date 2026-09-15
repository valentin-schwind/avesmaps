<?php

declare(strict_types=1);

// avesmapsPublicationCatalogIsOfficial() -- der Kanon einer Publikation folgt ihrem Namensraum.
require_once __DIR__ . '/namespaces.php';

// Kartensammlung wiki sync -- the MISSING pipeline stages 1+2 for citymaps.
//
// The house pipeline is "Dump ziehen -> syncen (staging, override-safe) -> manuell pflegen". For the
// Kartensammlung stage 3 (html/citymap-editor.html) was built first; this file is stages 1+2. It mirrors
// api/_internal/wiki/game-literature-sync.php one-to-one: build STAGING during "Dump holen" (the citymaps
// phase, dryRun), then an owner-triggered `sync_citymaps` action reconciles staging into production.
//
// Side-effect-free on include (function definitions only -- NO top-level code, NO require of a
// side-effectful file), so __tests__/citymap-sync-test.php can `require` it with no MySQL. Every
// DB function takes its dependencies as arguments and calls the other libraries at RUNTIME (the dump
// endpoint loads that chain before dispatch).
//
// WHERE THE DATA COMES FROM (measured 2026-07-16, see docs/superpowers/specs/
// 2026-07-16-kartensammlung-wiki-sync-{recon,design}.md -- do not re-derive, it costs two hours):
//
//   Stadtplanindex -- a CONCORDANCE, not an image collection. TWO overlapping tables:
//     old: "Stadt | Stadtplan (Farbe) | Stadtplan (s/w) | Umgebungskarte", sources are WIKILINKS.
//     new: "Stadt | Quelle | Farbe | Format | Massstab | Notiz | Kuenstler", sources are PLAIN TEXT.
//   Kartenindex -- Regionalkartenwerk tables (file links naming a region) + continent-wide tables.
//
// THE THREE RULES THAT MATTER, each one measured rather than assumed:
//
//   1. IDENTITY COMES FROM THE OLD LIST. The new list names 66% of its sources differently ("IdDM"
//      for "In den Dschungeln Meridianas"), and those abbreviations are NOT in the page's Legende --
//      they are unresolvable. Worse, its source cells are not reliably splittable at all: titles
//      contain commas ("Fuersten, Haendler, Intriganten" is ONE work), the separator flips to a
//      semicolon, and 17% of cells have a separator with no parallel array to confirm the count.
//      So: for a city the old list knows, the old list is the SOLE source of card identity. The new
//      list may only enrich fields (where its source matches) -- never add a card. Otherwise Al'Anfa
//      gets both "(IdDM)" and "(In den Dschungeln Meridianas)": two entries, one publication.
//      Cities the old list does NOT know (69 of them) come wholly from the new list.
//
//   2. THE LINK TARGET IS ALREADY THE FULL TITLE. The Legende maps [[Full Title|Abbrev]] -> Full
//      Title, so reading the link TARGET (not the display text) resolves "VG2"/"G1"/"Land" for free.
//      No legend parser needed.
//
//   3. MYRANOR IS SKIPPED. 0 of 12 Myranor cities resolve -- that continent is not on our map, so
//      those sections would only produce cards that can never appear anywhere.
//
// ESCAPING: the new list really does write `Al\'Anfa` (byte-verified U+005C U+0027, 13 occurrences,
// every one before an apostrophe). This is COSMETIC ONLY: avesmapsPoliticalSlug collapses RUNS of
// non-alphanumerics, so slug("Al'Anfa") === slug("Al\'Anfa") === "al-anfa", and the match key drops
// them entirely. Identity and place resolution are immune; only raw_name/title would show the
// backslash. Unescaping is therefore a no-op on a clean dump and safe on an escaped one -- which is
// why we can ship it before ever seeing the real dump (it is basic-auth, server-only). The citymaps
// phase counts `escaped_names_seen` so the first real "Dump holen" answers that question with a number.

// ===========================================================================
// 1. PURE parser core (DB-free, dump-free -- unit-tested)
// ===========================================================================

/** The two index pages we read. Values are the wiki_key namespace prefix, so a key names its origin. */
const AVESMAPS_CITYMAP_INDEX_STADTPLAN = 'stadtplanindex';
const AVESMAPS_CITYMAP_INDEX_KARTEN = 'kartenindex';

/** Wiki page titles the citymaps dump phase picks up. */
const AVESMAPS_CITYMAP_INDEX_PAGES = ['Stadtplanindex', 'Kartenindex'];

/** Bounded reconcile work per request (STRATO: no server-side loop). Mirrors the adventure budget. */
const AVESMAPS_CITYMAP_RECONCILE_STEP_BUDGET = 40;

/**
 * Strip the new list's backslash-before-apostrophe escaping. Cosmetic only (see the header note):
 * every one of the 13 backslashes in the page sits in front of an apostrophe, so there is no
 * legitimate backslash this could damage, and a clean dump makes it a no-op.
 */
function avesmapsCitymapUnescapeApostrophes(string $value): string
{
    return str_replace("\\'", "'", $value);
}

/** True when the value carries the new list's escaping -- counted, so the first real dump run tells us. */
function avesmapsCitymapHasEscaping(string $value): bool
{
    return str_contains($value, "\\'");
}

/**
 * The stable identity of a wiki-born map: index + identity + source + variant.
 *
 * WHAT $identity IS DIFFERS PER INDEX, because the two pages are shaped differently:
 *
 *   Stadtplanindex -> the CITY. It has no map titles at all, only "city x source x column", and the
 *     new list gives Format/Massstab/Kuenstler PER SOURCE as parallel arrays ("A2/-") -- i.e. the wiki
 *     itself models "one map per source". The variant must be in the key because one source can hold
 *     both a Stadtplan and an Umgebungskarte for the same city.
 *
 *   Kartenindex -> the map TITLE. It names its maps, and one region+publication legitimately carries
 *     SEVERAL of them ("Detaillierte Karte der Streitenden Koenigreiche (A2)" and "Politische Karte der
 *     Streitenden Koenigreiche (A3)" both live in Landkartenset Die Streitenden Koenigreiche). Keying
 *     those on the region collapsed them into one key and the dedupe silently ate the survivors --
 *     measured: 3 of 48 regional rows vanished, and fixing the region extractor would have made it
 *     worse, since better extraction means MORE rows sharing a region. The title is what distinguishes
 *     them, so the title is the identity.
 *
 * Runs through avesmapsPoliticalSlug (the house scheme, cf. avesmapsPublicationCatalogWikiKeyForTitle),
 * which is why the escaping cannot split a key.
 */
function avesmapsCitymapWikiKey(string $index, string $identity, string $source, string $variant): string
{
    $parts = [
        $index,
        avesmapsPoliticalSlug(avesmapsCitymapUnescapeApostrophes($identity)),
        avesmapsPoliticalSlug(avesmapsCitymapUnescapeApostrophes($source)),
        $variant,
    ];

    // 190 = the wiki_key column width. Truncating blind would risk two long rows colliding into one
    // key, so a key that would overflow keeps a short hash of the full value instead.
    $key = implode(':', $parts);
    if (strlen($key) <= 190) {
        return $key;
    }

    return substr($key, 0, 181) . '-' . substr(sha1($key), 0, 8);
}

/**
 * Colour-agnostic identity token for a Stadtplanindex variant. The wiki lists the same city map in the
 * Farbe column AND the s/w column of one publication (and the new list adds a colour-unknown row); all
 * three carry the identical title "Stadtplan von X (Quelle)" -- they are ONE map to the collection, the
 * colour is data (color_mode), not identity. Folding stadtplan-farbe / stadtplan-sw / stadtplan onto a
 * single 'stadtplan' key lets avesmapsCitymapDedupeByWikiKey merge the twins (richer row wins, colour
 * kept); 'umgebung' is a DIFFERENT map and keeps its own key. Fixes the 23 same-title wiki duplicates
 * measured 2026-07-18. The stored `variant`/`color_mode` fields are untouched -- only the identity is.
 */
function avesmapsCitymapStadtplanIdentityVariant(string $variant): string
{
    return str_starts_with($variant, 'stadtplan') ? 'stadtplan' : $variant;
}

require_once __DIR__ . '/citymap-sync-parser.php';

// ===========================================================================
// 2. PURE reconcile core (DB-free -- the override-safety heart, unit-tested)
// ===========================================================================

/**
 * Decide what a single card's reconcile should do. PURE: no DB, no clock.
 *
 * The rules the owner set, and why each exists:
 *   - status 'suppressed' -> SKIP. The editor tombstoned this card; resurrecting it is exactly the
 *     bug the tombstone exists to prevent (cf. the 5a4ec69 fix to avesmapsSuppressCitymapPlace).
 *   - origin not 'wiki' -> SKIP. A manual/community card is not ours to touch. This is also how a
 *     hand edit protects itself: editing a wiki card adopts it to 'manual' (see the editor write),
 *     after which the sync lets it go.
 *   - no row yet -> CREATE.
 *   - origin 'wiki' -> UPDATE, but only the fields that actually differ, so a repeat sync is a
 *     true no-op (idempotency is the whole point: "zweiter Sync-Lauf legt KEINE Dubletten an").
 *
 * @param array<string,mixed>|null $current live citymap row (null = does not exist)
 * @param array<string,mixed>      $desired catalog row
 * @return array{action:string, set:array<string,mixed>}
 */
function avesmapsCitymapReconcilePlan(?array $current, array $desired): array
{
    // map_url is in here so a wiki card carries a link to its publication's wiki page (see
    // avesmapsCitymapWikiUrlForSource). It is still override-safe: the moment an editor touches the
    // card it becomes origin='manual' and this plan skips it entirely, so a hand-set link stands.
    // format/has_scale/publisher ride this list like every other field -- that is the whole reason they
    // live on the card rather than only on the publication: override-safety costs one entry each.
    // publisher is copied from the publication's {{Infobox Produkt}}|Verlag (see
    // avesmapsCitymapPublisherForSource) and is NOT the author: our own UI defines "Urheber" as who
    // DREW the map, and "Ulisses"/"Fanpro" is who printed the book it appeared in.
    $fields = ['title', 'map_url', 'art', 'color_mode', 'is_labeled', 'format', 'has_scale', 'author',
        'publisher', 'note'];

    if ($current === null) {
        $set = [];
        foreach ($fields as $field) {
            $set[$field] = $desired[$field] ?? null;
        }

        return ['action' => 'create', 'set' => $set];
    }

    if ((string) ($current['status'] ?? '') === 'suppressed') {
        return ['action' => 'skip', 'set' => []]; // editor tombstone -- never resurrect
    }
    if ((string) ($current['origin'] ?? '') !== 'wiki') {
        return ['action' => 'skip', 'set' => []]; // manual/community -- not ours
    }

    $set = [];
    foreach ($fields as $field) {
        $now = $current[$field] ?? null;
        $want = $desired[$field] ?? null;
        // '' and null both mean "unknown" in this schema -> not a change worth a write.
        if (($now === null || $now === '') && ($want === null || $want === '')) {
            continue;
        }
        if ((string) $now !== (string) $want) {
            $set[$field] = $want;
        }
    }

    return ['action' => $set === [] ? 'noop' : 'update', 'set' => $set];
}

/**
 * Decide what a card's WIKI place row needs. PURE: no DB, no clock.
 *
 * Why an UPDATE exists at all: this write used to be INSERT-only ("is there a wiki place? no -> add
 * one"), which quietly made every improvement to the title->place extraction unreachable for cards
 * that already had a row. The 7 cards whose place carried qualifier text ("geographischen Region
 * oestliches Wuestenreich", measured 2026-07-17) would have kept it forever: green parser, unchanged
 * map. A derived field needs a path to be re-derived.
 *
 * Override-safety, the same invariants avesmapsCitymapReconcilePlan uses:
 *   - no row -> CREATE.
 *   - origin not 'wiki' -> SKIP. avesmapsSetCitymapPlace stamps origin='manual' on EVERY editor write
 *     (api/_internal/app/citymaps.php), so 'wiki' provably means "no human has touched this name".
 *   - status 'suppressed' -> SKIP. The editor's tombstone outranks a better name.
 *   - target_kind not 'unresolved' -> SKIP. The name already found its place; re-deriving it could
 *     move a card that currently hangs on the right location. Only unresolved rows are ours to rename.
 *   - name unchanged -> NOOP, so a repeat sync stays a true no-op.
 *
 * @param array<string,mixed>|null $current live citymap_place row (null = does not exist)
 * @return array{action:string, raw_name:string}
 */
function avesmapsCitymapPlaceReconcilePlan(?array $current, string $desiredRaw): array
{
    if ($current === null) {
        return ['action' => 'create', 'raw_name' => $desiredRaw];
    }
    // Redundant against the caller's WHERE origin='wiki', deliberately: this function owns the
    // override-safety decision, and it must stay correct if a future caller loosens that query.
    if ((string) ($current['origin'] ?? '') !== 'wiki') {
        return ['action' => 'skip', 'raw_name' => $desiredRaw];
    }
    if ((string) ($current['status'] ?? '') === 'suppressed') {
        return ['action' => 'skip', 'raw_name' => $desiredRaw];
    }
    if ((string) ($current['target_kind'] ?? '') !== 'unresolved') {
        return ['action' => 'skip', 'raw_name' => $desiredRaw];
    }
    if ((string) ($current['raw_name'] ?? '') === $desiredRaw) {
        return ['action' => 'noop', 'raw_name' => $desiredRaw];
    }

    return ['action' => 'update', 'raw_name' => $desiredRaw];
}

/**
 * Which live wiki-origin cards must go, given the catalog. PURE.
 *
 * Removal is scoped to origin='wiki' AND status='approved': a manual card, a community card and a
 * suppressed tombstone are never deleted. A card the wiki dropped is a card we drop.
 *
 * @param array<int, array{wiki_key:string, origin:string, status:string}> $liveRows
 * @param array<int, string> $catalogKeys
 * @return array<int, string> wiki_keys to remove
 */
function avesmapsCitymapRemovableKeys(array $liveRows, array $catalogKeys): array
{
    if ($catalogKeys === []) {
        // Empty catalog = "Dump holen" never ran (or ran empty). Treating that as "the wiki dropped
        // everything" would wipe the whole wiki-born collection on a misfire. Refuse instead.
        return [];
    }
    $keep = array_flip($catalogKeys);
    $remove = [];
    foreach ($liveRows as $row) {
        if (($row['origin'] ?? '') !== 'wiki' || ($row['status'] ?? '') !== 'approved') {
            continue;
        }
        $key = (string) ($row['wiki_key'] ?? '');
        if ($key !== '' && !isset($keep[$key])) {
            $remove[] = $key;
        }
    }

    return $remove;
}

/**
 * ONE difference row for the Übernahme-Vorschau, or null when there is nothing to ask about. PURE.
 *
 * This is the compute half's whole judgement: it takes the SAME pure plans the writer uses
 * (avesmapsCitymapReconcilePlan, avesmapsCitymapPlaceReconcilePlan, avesmapsCitymapWikiLinkPlan) plus
 * two read-only probes the caller has already run, and turns them into a row an editor can tick.
 * Design: docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md §2/§7.
 *
 * 💣 A 'skip' from the reconcile plan becomes NO ROW AT ALL -- not a greyed-out one. Manual cards,
 * community cards and tombstones are not ours, and showing them would invite a tick that then does
 * nothing (or, worse, a tick somebody expects to work).
 *
 * 💣 The source and the Fundstellen have to be in here, even though neither is a citymap FIELD. Today
 * they are written on every reconciled card as a side effect; once writing needs a tick, a card whose
 * only difference is a missing source reference would have no row -- and would stay sourceless for
 * good. What the reader would never see is exactly what the preview must show.
 *
 * ⚠️ An override alone is not a row. A place a human pinned down produces `override`, which decorates
 * a row that exists for another reason; on its own there is nothing to apply and therefore nothing to
 * ask. The one exception the design allows itself for city maps -- everything else about a card is
 * override-protected as a WHOLE (origin='manual' -> skip above).
 *
 * @param array<string,mixed>|null $current      live citymap row (null = does not exist yet)
 * @param array<string,mixed>      $desired      catalog row, already enriched with map_url + publisher
 * @param array<string,mixed>|null $currentPlace live wiki citymap_place row
 * @param array{insert:array,update:array,delete:array} $linkPlan avesmapsCitymapWikiLinkPlan output
 * @param bool $sourceMissing avesmapsCitymapSourceLinkMissing -- would a source reference be written?
 * @return array{change_type:string, after:array<string,mixed>, before:array<string,mixed>,
 *               override:array<string,mixed>}|null
 */
function avesmapsCitymapPlanItem(
    ?array $current,
    array $desired,
    ?array $currentPlace,
    string $desiredPlaceRaw,
    array $linkPlan,
    bool $sourceMissing
): ?array {
    $plan = avesmapsCitymapReconcilePlan($current, $desired);
    if ($plan['action'] === 'skip') {
        return null;
    }
    $isNew = $plan['action'] === 'create';

    $after = [];
    $before = [];
    foreach ($plan['set'] as $field => $value) {
        // On a card nobody has ever seen, an unknown field is not news -- it would fill the row with
        // "Format: —" lines that say nothing. On an existing card every entry here IS a difference.
        if ($isNew && ($value === null || $value === '')) {
            continue;
        }
        $after[$field] = $value;
        if (!$isNew) {
            $before[$field] = $current[$field] ?? null;
        }
    }

    $override = [];
    $placePlan = avesmapsCitymapPlaceReconcilePlan($currentPlace, $desiredPlaceRaw);
    if ($placePlan['action'] === 'create' || $placePlan['action'] === 'update') {
        $after['place'] = $desiredPlaceRaw;
        if ($currentPlace !== null) {
            $before['place'] = (string) ($currentPlace['raw_name'] ?? '');
        }
    } elseif (
        $placePlan['action'] === 'skip'
        && $currentPlace !== null
        && (string) ($currentPlace['raw_name'] ?? '') !== $desiredPlaceRaw
    ) {
        $override['place'] = (string) ($currentPlace['raw_name'] ?? '');
    }

    if ($sourceMissing) {
        $after['source'] = 'wird verknüpft';
    }

    // German display text on purpose, like the Änderungsverlauf's entries (AGENTS.md §11): this value
    // is read by a person in the preview, and phrasing it here keeps the component free of arithmetic.
    $linkParts = [];
    foreach ([['insert', 'neu'], ['update', 'geändert'], ['delete', 'entfällt']] as [$bucket, $word]) {
        $n = count((array) ($linkPlan[$bucket] ?? []));
        if ($n > 0) {
            $linkParts[] = $n . ' ' . $word;
        }
    }
    if ($linkParts !== []) {
        $after['links'] = implode(', ', $linkParts);
    }

    if ($after === []) {
        return null; // nothing to write -> nothing to ask
    }

    return [
        'change_type' => $isNew ? 'new' : 'changed',
        'after' => $after,
        'before' => $isNew ? [] : $before,
        'override' => $override,
    ];
}

/**
 * The label of a publication's shop link: the FUNDSTELLE, not the publication.
 *
 * docs/superpowers/specs/2026-07-17-karten-mehrfachlinks-design.md §7 left this open ("Wiki-Aventurica
 * oder der Publikationstitel?") and answered it in the same breath: "Der Titel der Karte nennt die
 * Publikation bereits". Every wiki card is titled "Stadtplan von X (Publikation)", so a link labelled
 * with the publication would repeat the title one line below it and tell the reader nothing new. The
 * label names where the link LANDS instead.
 *
 * The two hosts are the whole domain, not a sample: avesmapsPublicationChosenUrl builds chosen_url from
 * exactly two templates -- {{F-Shop|PID}} -> f-shop.de and {{PDF-Shop|ID}} -> ulisses-ebooks.de. An
 * unrecognised host keeps a neutral label rather than inventing a shop name it cannot know.
 */
function avesmapsCitymapShopLabel(string $url): string
{
    $host = mb_strtolower((string) parse_url($url, PHP_URL_HOST));
    if (str_contains($host, 'ulisses-ebooks')) {
        return 'PDF-Shop';
    }
    if (str_contains($host, 'f-shop')) {
        return 'F-Shop';
    }

    return 'Shop';
}

/** Wiki-born Fundstellen sort AFTER the editor's own list, which numbers itself up from 0. */
const AVESMAPS_CITYMAP_WIKI_LINK_SORT = 500;

/**
 * What to do with one card's wiki-born Fundstellen. PURE: no DB, no clock.
 *
 * Identity is the URL. A card carries at most a couple of wiki links and the URL is what the reader
 * actually follows, so two rows sharing a URL are a duplicate by definition -- exactly the "dieselbe URL
 * ein zweites Mal" the multilink spec §6.6 refused to ship.
 *
 * The override rules mirror avesmapsCitymapReconcilePlan, for the same reasons:
 *   - status 'suppressed' -> LEAVE ALONE. An editor tombstoned this Fundstelle; re-inserting or
 *     rewriting it is precisely the bug the tombstone exists to prevent.
 *   - a link the wiki no longer offers -> DELETE, but only ours and only while approved.
 *   - label/is_paid drift -> UPDATE, so a repeat sync stays a true no-op.
 *
 * Only wiki-origin rows may be passed in: a manual or community Fundstelle is not ours to plan for.
 *
 * @param array<int, array{id:int, url:string, label:string, is_paid:?int, status:string}> $current wiki-origin rows ONLY
 * @param array<int, array{url:string, label:string, is_paid:?int}> $desired
 * @return array{insert:array<int,array<string,mixed>>, update:array<int,array<string,mixed>>, delete:array<int,int>}
 */
function avesmapsCitymapWikiLinkPlan(array $current, array $desired): array
{
    $byUrl = [];
    foreach ($current as $row) {
        $byUrl[(string) $row['url']] = $row;
    }

    $insert = [];
    $update = [];
    $keep = [];
    foreach ($desired as $want) {
        $url = (string) $want['url'];
        $keep[$url] = true;
        $have = $byUrl[$url] ?? null;
        if ($have === null) {
            $insert[] = $want;
            continue;
        }
        if ((string) $have['status'] === 'suppressed') {
            continue; // tombstone -- never resurrect, never rewrite
        }
        $paidNow = $have['is_paid'] === null ? null : (int) $have['is_paid'];
        $paidWant = $want['is_paid'] === null ? null : (int) $want['is_paid'];
        if ((string) $have['label'] !== (string) $want['label'] || $paidNow !== $paidWant) {
            $update[] = ['id' => (int) $have['id'], 'label' => $want['label'], 'is_paid' => $want['is_paid']];
        }
    }

    $delete = [];
    foreach ($current as $row) {
        if (isset($keep[(string) $row['url']]) || (string) $row['status'] !== 'approved') {
            continue; // still wanted, or a tombstone that stays one
        }
        $delete[] = (int) $row['id'];
    }

    return ['insert' => $insert, 'update' => $update, 'delete' => $delete];
}

// ===========================================================================
// 3. Staging schema + dump build (STAGE 1 -- the "citymaps" phase of "Dump holen")
// ===========================================================================

/**
 * Self-healing staging schema. ONE table, not two: unlike an adventure (an ordered list of places),
 * a map depicts exactly ONE place, so a separate wiki_citymap_place_staging would be an empty
 * analogy -- place_raw lives in the catalog row.
 *
 * DELIBERATELY NOT in avesmapsCitymapsEnsureTables(): that runs on EVERY public read, and this DDL
 * is only ever needed on the owner's sync path. Making every page view pay for it is the
 * territories-endpoint.php mistake (AGENTS.md §10). Also adds citymap.wiki_key, the identity anchor.
 */
function avesmapsEnsureCitymapStagingTables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_citymap_catalog (
            wiki_key VARCHAR(190) NOT NULL PRIMARY KEY,
            index_page VARCHAR(24) NOT NULL,
            title VARCHAR(300) NOT NULL,
            place_raw VARCHAR(300) NOT NULL,
            source_raw VARCHAR(300) NOT NULL,
            variant VARCHAR(24) NOT NULL,
            type_key VARCHAR(24) NOT NULL,
            art VARCHAR(24) NULL,
            color_mode VARCHAR(16) NULL,
            is_labeled TINYINT(1) NULL,
            format VARCHAR(120) NULL,
            has_scale TINYINT(1) NULL,
            author VARCHAR(300) NULL,
            note VARCHAR(2000) NULL,
            synced_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );

    // format/has_scale: self-healing ALTER for a staging table that already exists in production (the
    // CREATE above is a no-op there). No publisher column here on purpose -- it does not come from the
    // index pages at all; the reconcile looks it up per card from wiki_publication_catalog, exactly as
    // it already does for map_url.
    $stagingColumn = static function (PDO $pdo, string $column): bool {
        $stmt = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wiki_citymap_catalog'
                AND COLUMN_NAME = '" . $column . "'"
        );
        return $stmt !== false && (int) $stmt->fetchColumn() > 0;
    };
    if (!$stagingColumn($pdo, 'format')) {
        $pdo->exec('ALTER TABLE wiki_citymap_catalog ADD COLUMN format VARCHAR(120) NULL AFTER is_labeled');
    }
    if (!$stagingColumn($pdo, 'has_scale')) {
        $pdo->exec('ALTER TABLE wiki_citymap_catalog ADD COLUMN has_scale TINYINT(1) NULL AFTER format');
    }
    // color_mode loest is_color ab (Owner 07.09.2026, AVESMAPS_CITYMAP_COLOR_MODES).
    //
    // 🔴 NUR DAS ALTER, KEIN BACKFILL -- diese Funktion wird aus der RECHEN-Haelfte des Syncs erreicht,
    // und die schreibt in keine Nutztabelle (sync-plan-purity-test.php haelt das fest, mit genau einer
    // namentlichen Ausnahme, die eine Owner-Entscheidung war). Ein `UPDATE wiki_citymap_catalog` haette
    // hier gestanden, und der Waechter hat es beim ersten Lauf gefangen.
    // ⭐ Die Luecke, die der Backfill schliessen sollte, schliesst stattdessen ein LESER:
    // `avesmapsCitymapStagingColorMode` rechnet den Wert aus is_color, solange die neue Spalte leer ist.
    // 🪤 Ohne Klammern geschrieben -- der Walk jenes Waechters liest Kommentare mit und haelt `name(`
    // fuer einen Aufruf.
    // Eine Zahl, die man aus etwas anderem rechnen kann, wird nicht gepflegt (AGENTS.md Paragraph 10).
    if (!$stagingColumn($pdo, 'color_mode')) {
        $pdo->exec('ALTER TABLE wiki_citymap_catalog ADD COLUMN color_mode VARCHAR(16) NULL AFTER art');
    }

    // The live citymap/citymap_place tables (self-healing DDL in api/_internal/app/citymaps.php).
    if (function_exists('avesmapsCitymapsEnsureTables')) {
        avesmapsCitymapsEnsureTables($pdo);
    }

    // wiki_key: the identity anchor. Self-healing ALTER rather than part of the CREATE, because
    // `citymap` already exists in production where CREATE TABLE IF NOT EXISTS is a no-op (the same
    // reasoning as thumb_auto_url in citymaps.php). UNIQUE ignores NULLs in MySQL -> "unique once
    // set", so manual maps without a wiki page keep wiki_key = NULL (mirrors `adventure`).
    $stmt = $pdo->query(
        "SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'citymap' AND COLUMN_NAME = 'wiki_key'"
    );
    if ($stmt !== false && (int) $stmt->fetchColumn() === 0) {
        $pdo->exec('ALTER TABLE citymap ADD COLUMN wiki_key VARCHAR(190) NULL');
        $pdo->exec('ALTER TABLE citymap ADD UNIQUE KEY uq_citymap_wiki_key (wiki_key)');
    }
}

/** Test seam mirror of avesmapsGameLiteratureDefaultPageSource: (dumpPath, skipPages) => page rows. */
function avesmapsCitymapDefaultPageSource(): callable
{
    return static function (string $path, int $skip): iterable {
        $reader = avesmapsWikiDumpOpenReader($path);
        try {
            yield from avesmapsWikiDumpIteratePages($reader, max(0, $skip));
        } finally {
            $reader->close();
        }
    };
}

/**
 * ONE bounded catalog-build step: walk the dump, and when a page IS one of the two index pages,
 * parse it into card rows and mirror them into staging (delete+insert per index, so a card the wiki
 * dropped disappears from staging too). STAGING-only -> safe under the dry "Dump holen".
 *
 * Unlike the adventure build there is no infobox to detect: we are looking for two specific PAGES,
 * so the scan is a title match and the whole page is consumed at once.
 *
 * @param callable|null $pageSource test seam: (dumpPath, skipPages) => iterable of page rows
 * @return array{ok:bool, done:bool, nextCursor:int, pages_scanned:int, found_this_step:int, escaped_names_seen:int}
 */
function avesmapsCitymapBuildCatalogStep(PDO $pdo, string $dumpPath, int $cursor = 0, ?callable $pageSource = null): array
{
    avesmapsEnsureCitymapStagingTables($pdo);
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    $source = $pageSource ?? avesmapsCitymapDefaultPageSource();

    $pagesScanned = 0;
    $found = 0;
    $escapedSeen = 0;
    $streamExhausted = true;

    foreach ($source($dumpPath, max(0, $cursor)) as $page) {
        $pagesScanned++;

        $title = trim((string) ($page['title'] ?? ''));
        // ⭐ HIER BLEIBT `ns === 0`, und das ist kein vergessener Riegel. Gewacht wird eine FESTE
        // TITELLISTE (AVESMAPS_CITYMAP_INDEX_PAGES: „Stadtplanindex", „Kartenindex") -- Seiten, die
        // es nur im Hauptraum gibt. Der Namensraumvergleich ist hier Guertel zum Hosentraeger,
        // keine Auswahl. Ihn auf die Inhaltsraeume zu weiten wuerde nichts hereinlassen und nur
        // vortaeuschen, hier waere eine Entscheidung getroffen worden.
        if ((int) ($page['ns'] ?? 0) === 0 && ($page['redirect'] ?? null) === null
            && in_array($title, AVESMAPS_CITYMAP_INDEX_PAGES, true)) {
            $wikitext = (string) ($page['wikitext'] ?? '');
            $parsed = $title === 'Stadtplanindex'
                ? avesmapsCitymapParseStadtplanindex($wikitext)
                : avesmapsCitymapParseKartenindex($wikitext);
            $escapedSeen += (int) $parsed['escaped_names_seen'];
            $found += avesmapsCitymapWriteStaging($pdo, $parsed['cards']);
        }

        // Untergrenze wie in der Sammelphase -- siehe AVESMAPS_WIKI_DUMP_STEP_MIN_PAGES.
        if (avesmapsWikiDumpStepDarfAnhalten($pagesScanned, $deadline)) {
            $streamExhausted = false;
            break;
        }
    }

    return [
        'ok' => true,
        'done' => $streamExhausted,
        'nextCursor' => max(0, $cursor) + $pagesScanned,
        'pages_scanned' => $pagesScanned,
        'found_this_step' => $found,
        // Answers "does the real dump escape apostrophes like the API does?" on the first real run.
        'escaped_names_seen' => $escapedSeen,
    ];
}

/**
 * Mirror one index page's cards into staging: delete that index's rows, insert the parsed ones. The
 * delete is scoped by index_page so the two pages never clear each other.
 *
 * @param array<int, array<string, mixed>> $cards
 */
/**
 * Die Farbigkeit EINER Staging-Zeile, mit dem Uebergangs-Rueckfall auf die alte Spalte. REIN.
 *
 * 💣 SIE IST DER RIEGEL GEGEN EINEN STILLEN DATENVERLUST, kein Komfort. Zwischen dem Deploy und dem
 * naechsten „Dump holen" liegen Stunden bis Tage, und in diesem Fenster ist `color_mode` im Sandkasten
 * leer, waehrend `citymap.color_mode` schon migriert ist. Ohne diesen Rueckfall lieferte der Plan
 * „gewuenscht: unbekannt" und boete an, 298 wiki-eigenen Karten ihre Farbigkeit zu nehmen -- in der
 * Uebernahme-Vorschau vorangehakt, weil es wie eine echte Wiki-Aenderung aussieht.
 *
 * ⚠️ Der Rueckfall wird von selbst wirkungslos: der naechste Dump-Lauf schreibt `color_mode` echt, und
 * dann gewinnt er. Er darf trotzdem stehen bleiben, solange die alte Spalte existiert -- ihn zu
 * entfernen kostet nichts, ihn zu frueh zu entfernen kostet die 298 Karten.
 *
 * @param array<string, mixed> $row
 */
function avesmapsCitymapStagingColorMode(array $row): ?string
{
    $mode = $row['color_mode'] ?? null;
    if ($mode !== null && $mode !== '') {
        return (string) $mode;
    }
    $alt = $row['is_color'] ?? null;
    if ($alt === null || $alt === '') {
        return null;
    }

    return ((int) $alt === 1) ? 'farbig' : 'graustufen';
}

function avesmapsCitymapWriteStaging(PDO $pdo, array $cards): int
{
    if ($cards === []) {
        return 0;
    }
    $index = (string) $cards[0]['index'];

    $pdo->prepare('DELETE FROM wiki_citymap_catalog WHERE index_page = :ix')->execute(['ix' => $index]);
    $insert = $pdo->prepare(
        'INSERT INTO wiki_citymap_catalog
            (wiki_key, index_page, title, place_raw, source_raw, variant, type_key, art, color_mode,
             is_labeled, format, has_scale, author, note, synced_at)
         VALUES (:wk, :ix, :title, :place, :source, :variant, :tk, :art, :color, :labeled, :format, :scale,
                 :author, :note, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
            title = VALUES(title), place_raw = VALUES(place_raw), source_raw = VALUES(source_raw),
            variant = VALUES(variant), type_key = VALUES(type_key), art = VALUES(art),
            color_mode = VALUES(color_mode), is_labeled = VALUES(is_labeled), format = VALUES(format),
            has_scale = VALUES(has_scale), author = VALUES(author),
            note = VALUES(note), synced_at = CURRENT_TIMESTAMP(3)'
    );

    $written = 0;
    foreach ($cards as $card) {
        $insert->execute([
            'wk' => (string) $card['wiki_key'],
            'ix' => (string) $card['index'],
            'title' => mb_substr((string) $card['title'], 0, 300, 'UTF-8'),
            'place' => mb_substr((string) $card['place_raw'], 0, 300, 'UTF-8'),
            'source' => mb_substr((string) $card['source_raw'], 0, 300, 'UTF-8'),
            'variant' => (string) $card['variant'],
            'tk' => (string) $card['type_key'],
            'art' => $card['art'],
            'color' => $card['color_mode'],
            'labeled' => $card['is_labeled'],
            'format' => $card['format'] !== null ? mb_substr((string) $card['format'], 0, 120, 'UTF-8') : null,
            'scale' => $card['has_scale'],
            'author' => $card['author'] !== null ? mb_substr((string) $card['author'], 0, 300, 'UTF-8') : null,
            'note' => $card['note'] !== null ? mb_substr((string) $card['note'], 0, 2000, 'UTF-8') : null,
        ]);
        $written++;
    }

    return $written;
}

// ===========================================================================
// 4. Reconcile (STAGE 2 -- the owner-triggered `sync_citymaps` action)
// ===========================================================================

/** Total staged cards -- the progress denominator for the client loop. */
function avesmapsCitymapCountCatalog(PDO $pdo): int
{
    return (int) $pdo->query('SELECT COUNT(*) FROM wiki_citymap_catalog')->fetchColumn();
}

/** app_setting key holding the last completed sync_citymaps run (UTC 'Y-m-d H:i:s'). */
const AVESMAPS_CITYMAP_LAST_SYNCED_SETTING = 'citymaps_last_synced';

/**
 * When the owner last ran "Karten syncen" to completion, or null if never.
 *
 * A single app_setting row rather than a citymap.synced_at column, on purpose: a per-card timestamp
 * would have to be written on EVERY card on EVERY run to mean "when did the sync last run" -- 419
 * writes to answer one question, and it would destroy the property that a repeat sync is a true no-op.
 * (The adventure sync can use MAX(synced_at) because its table already carries the column.)
 *
 * Distinct from avesmapsCitymapLastStaged, and both are needed: this one answers "when did I last
 * sync?" (the ribbon button), that one answers "is there anything staged TO sync?" (the editor button).
 * Showing the dump time next to a "Syncen" button would be a quiet lie.
 */
function avesmapsCitymapLastSynced(PDO $pdo): ?string
{
    if (!function_exists('avesmapsAppSettingGet')) {
        return null;
    }
    try {
        $value = trim(avesmapsAppSettingGet($pdo, AVESMAPS_CITYMAP_LAST_SYNCED_SETTING, ''));
    } catch (Throwable) {
        return null;
    }

    return $value === '' ? null : $value;
}

/**
 * Record "the owner ran the Karten-Abgleich", now.
 *
 * 🔴 THE RUN STAMPS, NOT THE ÜBERNAHME (owner 2026-08-25, verbatim: "gesynct is gesynct, egal ob was
 * übernommen wurde"). Until 2026-08-06 this line sat at the end of the reconcile with exactly that
 * reasoning written above it -- "which is true the moment the catalog is drained, whether or not
 * anything changed". Cutting the sync into a compute and an apply half took the stamp along into the
 * apply half, and that half never runs when there is nothing to apply: the preview deliberately shows
 * no "Übernehmen" button at zero differences (syncPlanFooterState). So a daily "Karten syncen" that
 * found nothing left the rail standing on the last Übernahme -- measured live: eight days.
 *
 * Both halves stamp, and that is not two owners of one truth: it is the same event at a second
 * moment. A preview can lie around for days behind "Später", and applying it tomorrow is then the
 * most recent thing that happened to the maps. Both write gmdate() into the same row, so they cannot
 * diverge -- only move the value forward.
 *
 * ⚠️ Never throws. A missing timestamp is a cosmetic loss; an Abgleich that dies over one is not.
 * Guarded because a context without the app-setting library must still be able to sync.
 */
function avesmapsCitymapStampLastSynced(PDO $pdo): void
{
    if (!function_exists('avesmapsAppSettingSet')) {
        return;
    }
    try {
        avesmapsAppSettingSet($pdo, AVESMAPS_CITYMAP_LAST_SYNCED_SETTING, gmdate('Y-m-d H:i:s'));
    } catch (Throwable) {
        // See the docblock: cosmetic.
    }
}

/**
 * When the staging catalog was last filled by "Dump holen", or null if never.
 *
 * NB this is the DUMP time, not the reconcile time -- deliberately. Before pressing "Karten syncen"
 * the question that matters is "is there anything staged to sync?", and an editor staring at
 * "Letzte Sync: nie" cannot tell whether the sync failed or the dump was simply never fetched. The
 * editor labels it accordingly. Returns null when the table does not exist yet (fresh deploy).
 */
function avesmapsCitymapLastStaged(PDO $pdo): ?string
{
    try {
        $value = $pdo->query('SELECT MAX(synced_at) FROM wiki_citymap_catalog')->fetchColumn();
    } catch (Throwable) {
        return null; // staging not created yet -> "Dump holen" has never run
    }

    return $value !== false && $value !== null ? (string) $value : null;
}

/**
 * The wiki page URL of a card's source publication, or '' when the source is not a publication we know.
 *
 * The index gives no link to the MAP itself -- it is a book reference, not an image ("Stadtplan von
 * Al'Anfa, zu finden in: Al'Anfa und der tiefe Süden"). The useful link is therefore the publication's
 * wiki page, which answers the question the entry actually raises: where do I find this map? (Owner
 * 2026-07-17: "wenn aus dem wiki, will ich oben den wiki link".)
 *
 * The URL is built from source_raw, NOT from the catalog's title column: that column holds the
 * {{Infobox Produkt}} DISPLAY title, which is not necessarily the page name. source_raw is the wikilink
 * TARGET out of the index -- which is the page name, by definition of a wikilink.
 *
 * The catalog lookup is the GUARD, not the data source: it only answers "is this a real publication
 * page?". That keeps the new list's abbreviations ("IdDM") from becoming links to pages that do not
 * exist -- they resolve to no catalog row, so they get no link at all.
 */
function avesmapsCitymapWikiUrlForSource(PDO $pdo, string $sourceRaw): string
{
    $source = trim($sourceRaw);
    if ($source === '' || !function_exists('avesmapsPublicationCatalogWikiKeyForTitle')) {
        return '';
    }
    $key = avesmapsPublicationCatalogWikiKeyForTitle($source);
    if ($key === '') {
        return '';
    }

    try {
        $stmt = $pdo->prepare('SELECT 1 FROM wiki_publication_catalog WHERE wiki_key = :wk LIMIT 1');
        $stmt->execute(['wk' => $key]);
        if ($stmt->fetchColumn() === false) {
            return ''; // not a known publication page -> no invented link
        }
    } catch (Throwable) {
        return ''; // publication staging absent (site without WikiSync) -> no link, no failure
    }

    // rawurlencode, then put '/' back: a page title may legitimately contain one ("Der Ork/Mensch-Krieg")
    // and %2F would 404. Mirrors the adventure catalog's wiki_url build.
    $url = AVESMAPS_WIKI_PAGE_BASE_URL . str_replace('%2F', '/', rawurlencode($source));

    return strlen($url) <= AVESMAPS_CITYMAP_URL_MAX ? $url : '';
}

/**
 * The publisher of a card's source publication ("Erschienen bei"), or null when we cannot know it.
 *
 * Same shape as avesmapsCitymapWikiUrlForSource, and same reason: the value belongs to the BOOK, the
 * lookup needs a DB, and the plan stays pure. The wiki puts it in {{Infobox Produkt}}|Verlag on the
 * publication page, which the publication sync already parses (see publication-parsing.php) -- so this
 * costs no new crawl, exactly like the F-Shop link before it.
 *
 * ⛔ This is NOT the author. Our own UI defines "Urheber" as who DREW the map
 * (js/map-features/map-features-citymaps-suggest.js); "Ulisses"/"Fanpro" is who printed the book it
 * appeared in. Writing it to `author` would have filled 419 maps with a wrong attribution.
 *
 * It is worth a column of its own because it VARIES -- measured on real pages 2026-07-17:
 * Geographia Aventurica -> Fanpro, Abenteuer Ausbau-Spiel -> Schmidt Spiele & Droemer Knaur,
 * Die Dunklen Zeiten -> Ulisses. Not "always Ulisses".
 */
function avesmapsCitymapPublisherForSource(PDO $pdo, string $sourceRaw): ?string
{
    if (!function_exists('avesmapsPublicationCatalogWikiKeyForTitle')) {
        return null;
    }
    $key = avesmapsPublicationCatalogWikiKeyForTitle($sourceRaw);
    if ($key === '') {
        return null;
    }

    try {
        $stmt = $pdo->prepare('SELECT publisher FROM wiki_publication_catalog WHERE wiki_key = :wk LIMIT 1');
        $stmt->execute(['wk' => $key]);
        $value = $stmt->fetchColumn();
    } catch (Throwable) {
        // Publication staging absent (a site without WikiSync), or the column not yet migrated on a
        // half-deployed server. A missing publisher is unknown, never a failed sync.
        return null;
    }
    if ($value === false || $value === null) {
        return null;
    }
    $publisher = trim((string) $value);

    return $publisher === '' ? null : mb_substr($publisher, 0, 160, 'UTF-8');
}

/**
 * Link a card to its publication in the SHARED source catalogue, with the SAME identity the
 * publication sync uses -- so a map's source and a settlement's source are one `sources` row, not two.
 *
 * The identity rule is copied from avesmapsPublicationDesiredLinksForEntity: a publication with a shop
 * link is identified by that URL, one without by its wiki_key. Deviating here would silently fork the
 * catalogue. A source name that is not a known publication gets NO link -- the title already names it.
 *
 * origin='wiki_publication' is mandatory: avesmapsFeatureSourceLink then never demotes a manual row
 * and never revives a suppressed tombstone.
 */
function avesmapsCitymapLinkSource(PDO $pdo, string $citymapPublicId, string $sourceRaw, int $userId): bool
{
    if (!function_exists('avesmapsFeatureSourceUpsert') || !function_exists('avesmapsPublicationCatalogWikiKeyForTitle')) {
        return false; // publication layer absent -> the map still carries its source in the title
    }
    $sourceKey = avesmapsPublicationCatalogWikiKeyForTitle($sourceRaw);
    if ($sourceKey === '') {
        return false;
    }

    try {
        $stmt = $pdo->prepare('SELECT wiki_key, title, source_type, chosen_url, has_link, page_ns FROM wiki_publication_catalog WHERE wiki_key = :wk LIMIT 1');
        $stmt->execute(['wk' => $sourceKey]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            return false; // not a known publication -> no invented source row
        }

        $chosenUrl = (int) ($row['has_link'] ?? 0) === 1 ? (string) ($row['chosen_url'] ?? '') : '';
        $sourceId = avesmapsFeatureSourceUpsert(
            $pdo,
            $chosenUrl,
            (string) ($row['title'] ?? $sourceRaw),
            (string) ($row['source_type'] ?? 'sonstiges'),
            // 🔴 DER ZWEITE SCHREIBER DERSELBEN KATALOGZEILE, und er stand noch auf fest `true`.
            // `avesmapsFeatureSourceUpsert` schreibt `is_official = VALUES(is_official)`
            // BEDINGUNGSLOS (feature-sources.php, avesmapsSourceUpsertOnDuplicateSql) -- anders
            // als label, license und attribution, die „fuellen, nie leeren" folgen. Damit hob
            // dieser Aufruf ein `0`, das der Publikations-Abgleich gerade gesetzt hatte, beim
            // naechsten `sync_citymaps` wieder auf 1. Zwei Schreiber, eine Zeile, eine Regel.
            avesmapsPublicationCatalogIsOfficial($row['page_ns'] ?? null),
            $userId,
            (string) ($row['wiki_key'] ?? '') // URL-less identity fallback (has_link=0)
        );
        if ($sourceId <= 0) {
            return false;
        }
        avesmapsFeatureSourceLink($pdo, 'citymap', $citymapPublicId, $sourceId, $userId, 'wiki_publication');

        return true;
    } catch (PDOException $exception) {
        // 💣 SINCE A21 THIS RUNS INSIDE A TRANSACTION, and that changes what may be swallowed.
        // The documented reason for swallowing stays: the publication staging tables may not exist
        // on a site without WikiSync (SQLSTATE 42S02), and a missing source line must not fail the
        // whole card (same reasoning as the read side in citymaps.php).
        //
        // What must NOT be swallowed any more is everything that kills the transaction on the
        // server: a deadlock (40001), a lock-wait timeout, a lost connection. InnoDB rolls the whole
        // transaction back by itself in those cases -- so swallowing here would let the remaining
        // writes run OUTSIDE any transaction and the wrapper commit something that no longer exists.
        // Under autocommit, before this change, the same error was harmless. It is not any more.
        if ((string) $exception->getCode() !== '42S02') {
            throw $exception;
        }

        return false;
    } catch (Throwable) {
        // Non-database failures keep the old behaviour: a missing source line, not a failed card.
        return false;
    }
}

/**
 * The Fundstellen the wiki offers for a card BESIDES map_url, shaped for avesmapsCitymapWikiLinkPlan.
 *
 * Today that is exactly one: the publication's SHOP link -- the wiki's "Erhältlich bei" row, which
 * {{Infobox Produkt}} renders from |Direktlinks={{F-Shop|PID=…}} (verified against the template source
 * 2026-07-17). The publication sync has been parsing it into wiki_publication_catalog.chosen_url all
 * along (avesmapsPublicationChosenUrl), so this costs no new crawl and no policy question -- the answer
 * to "erhältlich bei" was already in our own DB, it just never reached the card.
 *
 * NOT the publication's wiki page: that IS map_url already (avesmapsCitymapWikiUrlForSource), and
 * listing it a second time is exactly the duplicate the multilink spec §6.6 refused to ship.
 *
 * is_paid = 1 is a fact here, not the invention the §3.1 unknown-rule forbids: chosen_url is only ever
 * built from {{F-Shop}} or {{PDF-Shop}}, and both are purchase links. A publication with no shop link
 * yields NO Fundstelle rather than one with an is_paid we would have to guess.
 *
 * @return array<int, array{url:string, label:string, is_paid:?int}>
 */
function avesmapsCitymapDesiredWikiLinks(PDO $pdo, string $sourceRaw): array
{
    if (!function_exists('avesmapsPublicationCatalogWikiKeyForTitle')) {
        return [];
    }
    $key = avesmapsPublicationCatalogWikiKeyForTitle($sourceRaw);
    if ($key === '') {
        return [];
    }

    try {
        $stmt = $pdo->prepare('SELECT chosen_url, has_link FROM wiki_publication_catalog WHERE wiki_key = :wk LIMIT 1');
        $stmt->execute(['wk' => $key]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return []; // publication staging absent (site without WikiSync) -> no Fundstelle, never a failure
    }
    if ($row === false || (int) ($row['has_link'] ?? 0) !== 1) {
        return []; // has_link=0 covers the {{F-Shop|PID=NUMMER}} placeholder the parser already rejects
    }
    $url = trim((string) ($row['chosen_url'] ?? ''));
    if ($url === '' || strlen($url) > 500) {
        return []; // 500 = the citymap_link.url column width
    }

    return [['url' => $url, 'label' => avesmapsCitymapShopLabel($url), 'is_paid' => 1]];
}

/**
 * Would a source reference be written for this card? READ-ONLY twin of avesmapsCitymapLinkSource.
 *
 * 💣 The compute half may not call the writer "just to find out": avesmapsCitymapLinkSource answers
 * the question BY upserting into `sources` and linking `feature_sources`. That is precisely the write
 * this whole change moves behind a tick.
 *
 * The identity must be the writer's identity, not "does this card have any source at all": a card can
 * already carry a hand-added source and still be missing its publication. So the same rule as
 * avesmapsFeatureSourceUpsert -- url_hash of the shop link, or of 'wikipub:<wiki_key>' when the
 * publication has none. Get this wrong in the loose direction and a card silently never gets its
 * source; get it wrong in the strict direction and every card shows a difference that applying does
 * not remove, so the preview never empties.
 *
 * A source name that is not a known publication yields false -- no invented source, exactly as the
 * writer refuses to invent one.
 */
function avesmapsCitymapSourceLinkMissing(PDO $pdo, ?string $publicId, string $sourceRaw): bool
{
    if (!function_exists('avesmapsPublicationCatalogWikiKeyForTitle')) {
        return false;
    }
    $sourceKey = avesmapsPublicationCatalogWikiKeyForTitle($sourceRaw);
    if ($sourceKey === '') {
        return false;
    }

    try {
        $stmt = $pdo->prepare('SELECT wiki_key, chosen_url, has_link FROM wiki_publication_catalog WHERE wiki_key = :wk LIMIT 1');
        $stmt->execute(['wk' => $sourceKey]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            return false;
        }
        // The card does not exist yet -> the link is missing by definition; no lookup can say more.
        if ($publicId === null || $publicId === '') {
            return true;
        }

        $chosenUrl = (int) ($row['has_link'] ?? 0) === 1 ? (string) ($row['chosen_url'] ?? '') : '';
        $wikiKey = (string) ($row['wiki_key'] ?? '');
        $hash = ($chosenUrl === '' && $wikiKey !== '')
            ? hash('sha256', 'wikipub:' . $wikiKey)
            : hash('sha256', $chosenUrl);

        $have = $pdo->prepare(
            "SELECT 1 FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
              WHERE fs.entity_type = 'citymap' AND fs.entity_public_id = :pid AND s.url_hash = :h
              LIMIT 1"
        );
        $have->execute(['pid' => $publicId, 'h' => $hash]);

        return $have->fetchColumn() === false;
    } catch (Throwable) {
        // Publication or source staging absent (a site without WikiSync): no source line, never a
        // failed preview -- the same trade the writer makes.
        return false;
    }
}

/**
 * What would happen to this card's wiki-born Fundstellen? READ-ONLY half of
 * avesmapsCitymapReconcileWikiLinks: the same two reads, the same pure plan, none of its three writes.
 *
 * @return array{insert:array<int,array<string,mixed>>, update:array<int,array<string,mixed>>, delete:array<int,int>}
 */
function avesmapsCitymapWikiLinkDiff(PDO $pdo, ?int $citymapId, string $sourceRaw): array
{
    $empty = ['insert' => [], 'update' => [], 'delete' => []];
    $desired = avesmapsCitymapDesiredWikiLinks($pdo, $sourceRaw);

    $current = [];
    if ($citymapId !== null && $citymapId > 0) {
        try {
            $stmt = $pdo->prepare("SELECT id, url, label, is_paid, status FROM citymap_link WHERE citymap_id = :id AND origin = 'wiki'");
            $stmt->execute(['id' => $citymapId]);
            $current = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (Throwable) {
            return $empty;
        }
    }
    if ($current === [] && $desired === []) {
        return $empty;
    }

    return avesmapsCitymapWikiLinkPlan(
        array_map(static fn(array $r): array => [
            'id' => (int) $r['id'],
            'url' => (string) $r['url'],
            'label' => (string) $r['label'],
            'is_paid' => $r['is_paid'] === null ? null : (int) $r['is_paid'],
            'status' => (string) $r['status'],
        ], $current),
        $desired
    );
}

/**
 * Write ONE card's wiki-born Fundstellen. Idempotent; returns the number of rows touched.
 *
 * Scoped to origin='wiki' at the SELECT and again at every write: a manual or community Fundstelle is
 * not ours. The editor cannot collide with this either -- set_links replaces the whole list but deletes
 * only its own 'manual' rows, and the detail read hands wiki rows to the read-only `foreign_links`
 * bucket, so they are shown but never posted back.
 */
function avesmapsCitymapReconcileWikiLinks(PDO $pdo, int $citymapId, string $sourceRaw): int
{
    $desired = avesmapsCitymapDesiredWikiLinks($pdo, $sourceRaw);

    $stmt = $pdo->prepare("SELECT id, url, label, is_paid, status FROM citymap_link WHERE citymap_id = :id AND origin = 'wiki'");
    $stmt->execute(['id' => $citymapId]);
    $current = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($current === [] && $desired === []) {
        return 0; // publication without a shop link: the common case, and it costs nothing
    }

    $plan = avesmapsCitymapWikiLinkPlan(
        array_map(static fn(array $r): array => [
            'id' => (int) $r['id'],
            'url' => (string) $r['url'],
            'label' => (string) $r['label'],
            'is_paid' => $r['is_paid'] === null ? null : (int) $r['is_paid'],
            'status' => (string) $r['status'],
        ], $current),
        $desired
    );

    $touched = 0;
    foreach ($plan['insert'] as $row) {
        $pdo->prepare(
            "INSERT INTO citymap_link (citymap_id, label, url, is_paid, sort_order, origin, status)
             VALUES (:id, :label, :url, :paid, :sort, 'wiki', 'approved')"
        )->execute([
            'id' => $citymapId,
            'label' => (string) $row['label'],
            'url' => (string) $row['url'],
            'paid' => $row['is_paid'],
            'sort' => AVESMAPS_CITYMAP_WIKI_LINK_SORT,
        ]);
        $touched++;
    }
    foreach ($plan['update'] as $row) {
        $pdo->prepare("UPDATE citymap_link SET label = :label, is_paid = :paid WHERE id = :id AND origin = 'wiki'")
            ->execute(['label' => (string) $row['label'], 'paid' => $row['is_paid'], 'id' => (int) $row['id']]);
        $touched++;
    }
    foreach ($plan['delete'] as $id) {
        $pdo->prepare("DELETE FROM citymap_link WHERE id = :id AND origin = 'wiki'")->execute(['id' => $id]);
        $touched++;
    }

    return $touched;
}

/**
 * Reconcile ONE staged card into the live tables. Idempotent; returns per-card counters.
 *
 * @param array<string,mixed> $catalog wiki_citymap_catalog row
 * @return array{created:int, updated:int, places_added:int, places_updated:int, sources_linked:int,
 *               links_written:int}
 */
// One transaction per reconciled city map (finding A21). Nothing here was atomic: the body below writes
// citymap, citymap_type, citymap_place, citymap_link, sources and feature_sources in sequence, and an abort in the middle -- on this host a
// real case, the FastCGI pool has already collapsed once during a dump run -- left the entity
// behind in half of them.
//
// ⚠️ Per ENTITY, not per step, and the difference is the whole point: the step cursor only moves
// past fully processed entities, so a restart re-runs the interrupted one. Until now that
// repaired the damage only because INSERT IGNORE and the upserts happen to tolerate it -- which
// is luck, not a guarantee. The transaction turns it into one.
//
// 💣 NO DDL BETWEEN begin AND commit. MySQL commits an open transaction implicitly the moment it
// sees DDL, even a no-op CREATE TABLE IF NOT EXISTS -- silently, with everything after it out of
// reach of the rollback. Every *EnsureTables call belongs OUTSIDE the transaction, and they are:
// the step function runs its EnsureTables once, before the loop over the entities. Not in an
// earlier step -- in the same one, ahead of the loop. Pinned by the test, which walks the whole
// call chain the transaction spans rather than just these ten lines.
//
// 💣 NO NETWORK AND NO FILE WRITES BETWEEN begin AND commit either. That is why the third
// reconciler named in the finding, avesmapsGameLiteratureReconcileEntity, is NOT wrapped: it fetches
// the wiki cover over HTTP and writes it to /uploads/questcovers in the middle of its writes. A
// transaction there would hold a connection open across unbounded network latency on a shared
// host, and could not roll the file back anyway.
//
// ⚠️ $ownsTransaction, not a bare beginTransaction: PDO has no nested transactions, and a caller
// that already opened one would get an exception. Same idiom as avesmapsCitymapRemoveVanished.
function avesmapsCitymapReconcileEntity(PDO $pdo, array $catalog, int $userId): array
{
    $ownsTransaction = !$pdo->inTransaction();
    if ($ownsTransaction) {
        $pdo->beginTransaction();
    }
    try {
        $counters = avesmapsCitymapReconcileEntityWrites($pdo, $catalog, $userId);
    } catch (Throwable $exception) {
        // 💣 The rollBack is itself wrapped. It throws when the connection is gone -- which is
        // exactly the abort this whole change is about -- and an unguarded one replaces the real
        // cause with "MySQL server has gone away", with no previous-chaining. The caller would then
        // be told the connection died and never that the entity failed.
        if ($ownsTransaction && $pdo->inTransaction()) {
            try {
                $pdo->rollBack();
            } catch (Throwable) {
                // Nothing to do: the server already discarded the transaction with the connection.
            }
        }
        throw $exception;
    }
    if ($ownsTransaction) {
        $pdo->commit();
    }

    return $counters;
}

// The writes themselves, unchanged. Split out so the transaction above needs no re-indentation
// of the body -- and so the test can assert that nothing between begin and commit is anything
// but this one call.
function avesmapsCitymapReconcileEntityWrites(PDO $pdo, array $catalog, int $userId): array
{
    $counters = ['created' => 0, 'updated' => 0, 'places_added' => 0, 'places_updated' => 0, 'sources_linked' => 0, 'links_written' => 0];
    $wikiKey = trim((string) ($catalog['wiki_key'] ?? ''));
    if ($wikiKey === '') {
        return $counters;
    }

    $find = $pdo->prepare(
        'SELECT id, public_id, origin, status, title, map_url, art, color_mode, is_labeled, format,
                has_scale, author, publisher, note
           FROM citymap WHERE wiki_key = :wk LIMIT 1'
    );
    $find->execute(['wk' => $wikiKey]);
    $current = $find->fetch(PDO::FETCH_ASSOC) ?: null;

    // The catalog has no map_url of its own (the index links no maps, only books) -- derive it from the
    // source here, where a DB lookup is allowed. The plan itself stays pure. The publisher rides the
    // same path for the same reason: it lives on the BOOK page, not in the index.
    $desired = $catalog;
    $desired['map_url'] = avesmapsCitymapWikiUrlForSource($pdo, (string) ($catalog['source_raw'] ?? ''));
    $desired['publisher'] = avesmapsCitymapPublisherForSource($pdo, (string) ($catalog['source_raw'] ?? ''));

    $plan = avesmapsCitymapReconcilePlan($current, $desired);
    if ($plan['action'] === 'skip') {
        return $counters;
    }

    if ($plan['action'] === 'create') {
        // avesmapsWikiSyncUuidV4 (wiki/sync.php), NOT avesmapsUuidV4 (map/features.php): three identical
        // UUID helpers exist in this codebase, and only this one is in the dump endpoint's require
        // chain. Calling the features.php one here was a fatal "undefined function" on the sync path --
        // invisible in unit tests, because they never load the endpoint's chain. game-literature-sync.php,
        // the template for this whole file, uses this same helper for exactly this reason.
        $publicId = avesmapsWikiSyncUuidV4();
        $pdo->prepare(
            "INSERT INTO citymap (public_id, wiki_key, title, map_url, art, color_mode, is_labeled, format,
                                  has_scale, author, publisher, note,
                                  origin, status, map_license, thumb_license, created_by)
             VALUES (:pid, :wk, :title, :url, :art, :color, :labeled, :format, :scale, :author, :publisher,
                     :note, 'wiki', 'approved', 'unknown_other', 'unknown_other', NULL)"
        )->execute([
            'pid' => $publicId,
            'wk' => $wikiKey,
            'title' => (string) $plan['set']['title'],
            // NOT NULL DEFAULT '' -- a source we cannot link to yields '', never null.
            'url' => (string) ($plan['set']['map_url'] ?? ''),
            'art' => $plan['set']['art'],
            'color' => $plan['set']['color_mode'],
            'labeled' => $plan['set']['is_labeled'],
            'format' => $plan['set']['format'],
            'scale' => $plan['set']['has_scale'],
            'author' => $plan['set']['author'],
            'publisher' => $plan['set']['publisher'],
            'note' => $plan['set']['note'],
        ]);
        $citymapId = (int) $pdo->lastInsertId();
        $counters['created'] = 1;

        // The type is a separate table (a map can carry several); the wiki gives exactly one.
        $pdo->prepare('INSERT IGNORE INTO citymap_type (citymap_id, type_key) VALUES (:id, :tk)')
            ->execute(['id' => $citymapId, 'tk' => (string) $catalog['type_key']]);
    } else {
        $citymapId = (int) $current['id'];
        $publicId = (string) $current['public_id'];
        if ($plan['action'] === 'update') {
            $sets = [];
            $params = ['id' => $citymapId];
            foreach ($plan['set'] as $field => $value) {
                $sets[] = $field . ' = :' . $field;
                $params[$field] = $value;
            }
            $pdo->prepare('UPDATE citymap SET ' . implode(', ', $sets) . ' WHERE id = :id')->execute($params);
            $counters['updated'] = 1;
        }
    }

    // The place. A map depicts exactly one, so this is an existence check rather than a list diff.
    // target_kind stays 'unresolved' with raw_name kept -- the shared resolver fills it in afterwards,
    // and a name we cannot resolve (Bosparan, or the placeless 'Aventurien') stays honestly unresolved.
    $placeRow = $pdo->prepare(
        "SELECT id, raw_name, target_kind, origin, status FROM citymap_place
         WHERE citymap_id = :id AND origin = 'wiki' LIMIT 1"
    );
    $placeRow->execute(['id' => $citymapId]);
    $currentPlace = $placeRow->fetch(PDO::FETCH_ASSOC) ?: null;
    $placePlan = avesmapsCitymapPlaceReconcilePlan(
        $currentPlace,
        mb_substr((string) $catalog['place_raw'], 0, 300, 'UTF-8')
    );
    if ($placePlan['action'] === 'create') {
        $pdo->prepare(
            "INSERT INTO citymap_place (citymap_id, sort_order, raw_name, target_kind, origin, status)
             VALUES (:id, 0, :rn, 'unresolved', 'wiki', 'approved')"
        )->execute(['id' => $citymapId, 'rn' => $placePlan['raw_name']]);
        $counters['places_added'] = 1;
    } elseif ($placePlan['action'] === 'update') {
        $pdo->prepare('UPDATE citymap_place SET raw_name = :rn WHERE id = :id')
            ->execute(['rn' => $placePlan['raw_name'], 'id' => (int) $currentPlace['id']]);
        $counters['places_updated'] = 1;
    }

    if (avesmapsCitymapLinkSource($pdo, $publicId, (string) $catalog['source_raw'], $userId)) {
        $counters['sources_linked'] = 1;
    }

    // The Fundstellen (citymap_link), which is a different question from the source above: a source says
    // WHICH publication vouches for the map, a Fundstelle says WHERE the reader can get at it. The same
    // F-Shop URL answers both, and they are stored apart on purpose (see avesmapsCitymapLinks).
    $counters['links_written'] = avesmapsCitymapReconcileWikiLinks($pdo, $citymapId, (string) $catalog['source_raw']);

    return $counters;
}

/**
 * The difference row for ONE staged card, reads included. READ-ONLY.
 *
 * 💣 BOTH HALVES CALL THIS ONE FUNCTION -- the compute half to build the plan, the apply half to
 * recompute it just before writing and see whether the world moved on (design §4a). Two copies of
 * "what would this card need" would drift, and the drift would show up as a plan that can never be
 * applied: every row would look stale forever, and nobody would know why.
 *
 * @param array<string,mixed> $catalog wiki_citymap_catalog row
 * @return array{item:?array<string,mixed>, current:?array<string,mixed>, desired:array<string,mixed>}
 */
function avesmapsCitymapPlanForCatalogRow(PDO $pdo, array $catalog): array
{
    $wikiKey = (string) ($catalog['wiki_key'] ?? '');
    $sourceRaw = (string) ($catalog['source_raw'] ?? '');

    $find = $pdo->prepare(
        'SELECT id, public_id, origin, status, title, map_url, art, color_mode, is_labeled, format,
                has_scale, author, publisher, note
           FROM citymap WHERE wiki_key = :wk LIMIT 1'
    );
    $find->execute(['wk' => $wikiKey]);
    $current = $find->fetch(PDO::FETCH_ASSOC) ?: null;

    // Exactly as avesmapsCitymapReconcileEntityWrites derives them: the catalog carries neither, both
    // live on the publication page, and both lookups are reads.
    $desired = $catalog;
    $desired['map_url'] = avesmapsCitymapWikiUrlForSource($pdo, $sourceRaw);
    $desired['publisher'] = avesmapsCitymapPublisherForSource($pdo, $sourceRaw);

    $currentPlace = null;
    if ($current !== null) {
        $placeRow = $pdo->prepare(
            "SELECT id, raw_name, target_kind, origin, status FROM citymap_place
             WHERE citymap_id = :id AND origin = 'wiki' LIMIT 1"
        );
        $placeRow->execute(['id' => (int) $current['id']]);
        $currentPlace = $placeRow->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    $item = avesmapsCitymapPlanItem(
        $current,
        $desired,
        $currentPlace,
        mb_substr((string) ($catalog['place_raw'] ?? ''), 0, 300, 'UTF-8'),
        avesmapsCitymapWikiLinkDiff($pdo, $current === null ? null : (int) $current['id'], $sourceRaw),
        avesmapsCitymapSourceLinkMissing($pdo, $current === null ? null : (string) $current['public_id'], $sourceRaw)
    );

    return ['item' => $item, 'current' => $current, 'desired' => $desired];
}

/**
 * ONE bounded COMPUTE step over the staging catalog, resumable via a wiki_key high-water cursor.
 *
 * 🔴 THIS IS THE HALF THAT DOES NOT WRITE. It has the shape of the reconcile step it replaces --
 * same budget, same deadline, same "done" derivation, same cursor -- and it calls the same pure
 * plans. The only difference is where the answer goes: into sync_plan_item, for a person to tick,
 * instead of into the live tables (design §7). api/_internal/wiki/__tests__/sync-plan-purity-test.php
 * asserts that property over everything this function reaches, at any depth.
 *
 * The three closing acts of the old step -- the last-synced stamp, the place resolver and the
 * map-features ETag bump -- moved to the apply half (citymap-plan-apply.php). They mark that
 * something was written, and nothing is written here.
 *
 * @return array{done:bool, nextCursor:string, run_id:int, planned:int, processed:int,
 *               counts:array{new:int,changed:int,deleted:int,total:int}}
 */
function avesmapsCitymapPlanStep(PDO $pdo, string $cursor, int $userId, ?int $budget = null): array
{
    $budget = $budget ?? AVESMAPS_CITYMAP_RECONCILE_STEP_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    // ⚠️ Both DDL calls up here, before anything else: MySQL commits an open transaction implicitly
    // when it sees DDL, and this step must be safe to call from anywhere.
    avesmapsEnsureCitymapStagingTables($pdo);
    avesmapsEnsureSyncPlanTables($pdo);

    // The run is derived from the cursor, never named by the client: an empty cursor means "from the
    // top" and opens a fresh run (retiring whatever was lying around), anything else belongs to the
    // build already in flight. A run id off the wire would let one editor write into another's plan.
    if ($cursor === '') {
        $runId = avesmapsSyncPlanStartRun($pdo, 'citymap', $userId, avesmapsCitymapLastStaged($pdo));
    } else {
        $building = avesmapsSyncPlanBuildingRun($pdo, 'citymap');
        $runId = (int) ($building['id'] ?? 0);
    }
    if ($runId <= 0) {
        // A second run replaced ours mid-build (design §6). Carrying on would silently produce a plan
        // that starts at the cursor and claims to be complete -- worse than stopping.
        throw new RuntimeException('Der Abgleich wurde von einem zweiten Lauf abgeloest. Bitte neu starten.');
    }

    // ONE read of the decision table per step, not one per card: this is the loop STRATO cannot take.
    $decisions = avesmapsSyncPlanDecisions($pdo, 'citymap');

    $select = $pdo->prepare('SELECT * FROM wiki_citymap_catalog WHERE wiki_key > :cur ORDER BY wiki_key ASC LIMIT :lim');
    $select->bindValue(':cur', $cursor, PDO::PARAM_STR);
    $select->bindValue(':lim', max(1, $budget), PDO::PARAM_INT);
    $select->execute();
    $catalogRows = $select->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $planned = 0;
    $processed = 0;
    $nextCursor = $cursor;
    $timedOut = false;

    foreach ($catalogRows as $catalog) {
        $nextCursor = (string) $catalog['wiki_key'];
        $processed++;
        // Uebergangs-Rueckfall auf die alte Spalte, solange der erste Dump-Lauf nach dem Umbau aussteht.
        // Die Begruendung steht bei avesmapsCitymapStagingColorMode -- ohne diese Zeile boete der Plan an,
        // 298 Karten ihre Farbigkeit zu nehmen.
        $catalog['color_mode'] = avesmapsCitymapStagingColorMode($catalog);

        $computed = avesmapsCitymapPlanForCatalogRow($pdo, $catalog);
        $item = $computed['item'];
        $current = $computed['current'];
        $desired = $computed['desired'];

        if ($item !== null) {
            $decision = $decisions[avesmapsSyncPlanDecisionKey($nextCursor, $item['change_type'])] ?? null;
            avesmapsSyncPlanAddItem($pdo, $runId, [
                'entity_key' => $nextCursor,
                'entity_public_id' => $current === null ? null : (string) $current['public_id'],
                'change_type' => $item['change_type'],
                'label' => (string) ($desired['title'] ?? ($current['title'] ?? $nextCursor)),
                'before' => $item['before'],
                'after' => $item['after'],
                'override' => $item['override'],
                'selected' => avesmapsSyncPlanDefaultSelected($item['change_type'], (int) ($decision['skipped_count'] ?? 0)),
            ]);
            $planned++;
        }

        if (microtime(true) >= $deadline) {
            $timedOut = true;
            break;
        }
    }

    $done = !$timedOut && count($catalogRows) < $budget;
    $counts = ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0];

    if ($done) {
        // The deletions come last, once, because they are the only question that needs the WHOLE
        // catalog to be answered -- and the empty-catalog gate lives inside them.
        foreach (avesmapsCitymapVanishedRows($pdo, avesmapsSyncPlanDeclinedKeys($pdo, 'citymap')) as $gone) {
            avesmapsSyncPlanAddItem($pdo, $runId, [
                'entity_key' => (string) $gone['wiki_key'],
                'entity_public_id' => (string) $gone['public_id'],
                'change_type' => 'deleted',
                'label' => (string) $gone['title'],
                'before' => [
                    'place_count' => (int) $gone['place_count'],
                    'link_count' => (int) $gone['link_count'],
                    'related_count' => (int) $gone['related_count'],
                    'source_count' => (int) $gone['source_count'],
                ],
                'after' => [],
                'override' => [],
                'selected' => avesmapsSyncPlanDefaultSelected('deleted', 0),
            ]);
            $planned++;
        }
        $counts = avesmapsSyncPlanFinishBuild($pdo, $runId);
    }

    return [
        'done' => $done,
        'nextCursor' => $nextCursor,
        'run_id' => $runId,
        'planned' => $planned,
        'processed' => $processed,
        'counts' => $counts,
    ];
}

/**
 * The wiki-origin cards the wiki no longer lists -- as ROWS TO SHOW, not as a deletion. READ-ONLY.
 *
 * This is what avesmapsCitymapRemoveVanished used to be, minus its DELETE (design §7): the sync now
 * proposes, and avesmapsCitymapDeleteWikiRow below executes what an editor ticked.
 *
 * 💣 The empty-catalog gate travels with it, untouched, inside avesmapsCitymapRemovableKeys (pure,
 * tested): an empty catalog means "Dump holen" never ran, not "the wiki dropped everything". The
 * damage it prevents changed shape rather than size -- it used to be a silent mass deletion, now it
 * would be a preview proposing 457 deletions, and sooner or later somebody clicks.
 *
 * 💣 And the declined ones never come back. A deletion an editor refused is a permanent decision
 * (design §2); the row stays origin='wiki' and carries on being maintained, only the question is
 * unsubscribed.
 *
 * The child counts say what would go WITH the card, in four grouped queries rather than four per
 * card: this list is short, but the loop it avoids is the one STRATO cannot take.
 *
 * @param array<int,string> $declinedKeys avesmapsSyncPlanDeclinedKeys
 * @return array<int, array{wiki_key:string, public_id:string, title:string, place_count:int,
 *                          link_count:int, related_count:int, source_count:int}>
 */
function avesmapsCitymapVanishedRows(PDO $pdo, array $declinedKeys): array
{
    $catalogKeys = $pdo->query('SELECT wiki_key FROM wiki_citymap_catalog')->fetchAll(PDO::FETCH_COLUMN) ?: [];
    $liveRows = $pdo->query("SELECT wiki_key, origin, status FROM citymap WHERE wiki_key IS NOT NULL")
        ->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $remove = avesmapsCitymapRemovableKeys(
        array_map(static fn(array $r): array => [
            'wiki_key' => (string) $r['wiki_key'],
            'origin' => (string) $r['origin'],
            'status' => (string) $r['status'],
        ], $liveRows),
        array_map('strval', $catalogKeys)
    );

    $declined = array_flip(array_map('strval', $declinedKeys));
    $remove = array_values(array_filter($remove, static fn(string $key): bool => !isset($declined[$key])));
    if ($remove === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($remove), '?'));
    $cards = $pdo->prepare(
        'SELECT id, public_id, wiki_key, title FROM citymap WHERE wiki_key IN (' . $placeholders . ')'
    );
    $cards->execute($remove);
    $rows = $cards->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($rows === []) {
        return [];
    }

    $ids = array_map(static fn(array $r): int => (int) $r['id'], $rows);
    $idPlaceholders = implode(',', array_fill(0, count($ids), '?'));
    $countBy = static function (PDO $pdo, string $sql, array $params): array {
        try {
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
        } catch (Throwable) {
            // A missing table (a site without the source system) is "nothing hangs off it", never a
            // failed preview: the numbers decorate the row, they do not decide anything.
            return [];
        }
        $counts = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $counts[(string) $row['k']] = (int) $row['n'];
        }

        return $counts;
    };

    $places = $countBy($pdo, 'SELECT citymap_id AS k, COUNT(*) AS n FROM citymap_place
        WHERE citymap_id IN (' . $idPlaceholders . ') GROUP BY citymap_id', $ids);
    $links = $countBy($pdo, 'SELECT citymap_id AS k, COUNT(*) AS n FROM citymap_link
        WHERE citymap_id IN (' . $idPlaceholders . ') GROUP BY citymap_id', $ids);
    // Both directions, like the child-row cleaner: citymap_related links maps both ways.
    $related = $countBy($pdo, 'SELECT citymap_id AS k, COUNT(*) AS n FROM citymap_related
        WHERE citymap_id IN (' . $idPlaceholders . ') GROUP BY citymap_id', $ids);
    $publicIds = array_map(static fn(array $r): string => (string) ($r['public_id'] ?? ''), $rows);
    $sources = $countBy(
        $pdo,
        "SELECT entity_public_id AS k, COUNT(*) AS n FROM feature_sources
          WHERE entity_type = 'citymap' AND entity_public_id IN ("
            . implode(',', array_fill(0, count($publicIds), '?')) . ') GROUP BY entity_public_id',
        $publicIds
    );

    $out = [];
    foreach ($rows as $row) {
        $id = (int) $row['id'];
        $publicId = (string) ($row['public_id'] ?? '');
        $out[] = [
            'wiki_key' => (string) $row['wiki_key'],
            'public_id' => $publicId,
            'title' => (string) ($row['title'] ?? ''),
            'place_count' => (int) ($places[(string) $id] ?? 0),
            'link_count' => (int) ($links[(string) $id] ?? 0),
            'related_count' => (int) ($related[(string) $id] ?? 0),
            'source_count' => (int) ($sources[$publicId] ?? 0),
        ];
    }

    return $out;
}

/**
 * Delete ONE wiki-origin card, children and all. Returns false when the origin guard refused.
 *
 * The body below is the loop body of the former avesmapsCitymapRemoveVanished, unchanged -- only the
 * loop is gone, because the selection is now made by a person in the preview rather than by the
 * catalog. Every invariant the delete-parity test names still lives here.
 */
function avesmapsCitymapDeleteWikiRow(PDO $pdo, string $wikiKey): bool
{
    $findId = $pdo->prepare('SELECT id, public_id FROM citymap WHERE wiki_key = :wk LIMIT 1');
    $delCard = $pdo->prepare("DELETE FROM citymap WHERE id = :id AND origin = 'wiki'");

    $findId->execute(['wk' => $wikiKey]);
    $card = $findId->fetch(PDO::FETCH_ASSOC);
    if ($card === false) {
        return false;
    }
    $id = (int) $card['id'];
    $publicId = (string) ($card['public_id'] ?? '');
    // 💣 EINE TRANSAKTION JE KARTE, KARTE ZUERST -- beides zusammen, keines allein.
    //
    // Der origin-Riegel an diesem DELETE ist die zweite Sicherung, und bis 2026-08-05 liefen
    // die Kind-Loeschungen DAVOR: griff der Riegel je, blieb die Karte stehen und hatte ihre
    // Orte und Arten verloren -- die Sicherung richtete genau den Schaden an, den sie
    // verhindern sollte. Ohne FK ist die Reihenfolge frei, also steht sie jetzt richtig herum.
    //
    // Die Reihenfolge allein taeuscht aber nur den Schaden um. Bricht der Lauf zwischen Karte
    // und Kindern ab -- und dieser Schritt steht unter einem 43-Sekunden-Zeitlimit auf einem
    // Host mit FastCGI-Abschuss-Geschichte --, ist die Karte weg und ihre Kinder sind FUER
    // IMMER verwaist: die Liste der zu Entfernenden wird aus LEBENDEN citymap-Zeilen gebildet,
    // diese id kann also nie wieder genannt werden. Andersherum war derselbe Abbruch heilbar,
    // kostete aber die Kinder. Erst die Transaktion macht aus beiden Uebeln keines -- der
    // Loeschweg von Hand fuehrt sie seit jeher.
    $ownsTransaction = !$pdo->inTransaction();
    if ($ownsTransaction) {
        $pdo->beginTransaction();
    }
    try {
        $delCard->execute(['id' => $id]);
        if ($delCard->rowCount() < 1) {
            if ($ownsTransaction) {
                $pdo->rollBack();
            }
            return false;
        }
        // 💣 Derselbe Raeumer wie beim Loeschen von Hand (api/_internal/app/citymaps.php).
        // Vorher raeumte dieser Weg nur place und type -- citymap_related und citymap_link
        // blieben als Waisen zurueck (Befund A8), und der Quellenverweis der Karte blieb sogar
        // im oeffentlichen Kartenpayload stehen.
        //
        // ⚠️ Laufzeit-Aufruf hinter function_exists, wie schon bei avesmapsCitymapsEnsureTables
        // weiter oben: diese Datei laedt absichtlich nichts nach, damit ihr Unit-Test ohne
        // MySQL laeuft. Der Riegel macht aus einer fehlenden Bibliothek KEIN Fatal, sondern
        // "nicht aufgeraeumt" -- entscheidend ist deshalb, DASS api/edit/wiki/dump.php
        // app/citymaps.php laedt. Die Reihenfolge der require-Zeilen ist dagegen egal: diese
        // Datei hat keine Anweisung auf oberster Ebene, der Riegel wird erst beim Dispatch
        // ausgewertet, lange nach jedem require.
        if (function_exists('avesmapsDeleteCitymapChildRows')) {
            avesmapsDeleteCitymapChildRows($pdo, $id, $publicId);
        }
        if ($ownsTransaction) {
            $pdo->commit();
        }
    } catch (Throwable $error) {
        if ($ownsTransaction && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }

    return true;
}
