<?php

declare(strict_types=1);

// Pure, DB-free wikitext parsers for the wiki-publication-sources feature (see
// docs/wiki-publikations-quellen-design.md). These take raw wikitext strings and return plain
// arrays -- no PDO, no HTTP, no dump reads. The Task-4 sync phase feeds real dump wikitext
// into these and writes the results into wiki_publication_catalog / wiki_entity_publication
// (see api/_internal/wiki/publication-sync.php for the staging schema).
//
// Reuses the existing infobox/template-param helpers instead of re-parsing wikitext templates:
// avesmapsWikiSyncMonitorExtractInfoboxBlock() brace-matches the FIRST {{Infobox ...}} block
// (not name-filtered), avesmapsWikiSyncMonitorParseTemplateParams() splits it into raw,
// case-preserved |key=value params, and avesmapsWikiSyncMonitorFieldKey() folds a label to a
// lowercase/umlaut-stripped comparison key (used here for subsection-heading and Art matching).
require_once __DIR__ . '/sync-monitor-parsing.php';

// Parses a page/note fragment that trails a publication wikilink on an entity's
// "==Publikationen==" line, e.g. "Seite 54", "Seiten 40, '''145'''", or
// "Seite 176 <small>(Zerstörung)</small>". Bold markup ('''...''') is stripped as pure
// formatting noise. A <small>(...)</small> aside -- or, failing that, a bare (...) aside -- is
// pulled out as the free-text `note` (parens stripped). Every remaining digit run becomes one
// page number, normalized into a comma-space-joined list ("40, 145"); no digits left -> pages=null.
function avesmapsWikiParsePageRef(string $text): array {
    $clean = str_replace("'''", '', $text);

    $note = null;
    if (preg_match('/<small>\s*(.*?)\s*<\/small>/isu', $clean, $smallMatch) === 1) {
        $inner = trim((string) $smallMatch[1]);
        if (preg_match('/^\((.*)\)$/su', $inner, $parenMatch) === 1) {
            $inner = trim((string) $parenMatch[1]);
        }
        $note = $inner !== '' ? $inner : null;
        $clean = trim((string) preg_replace('/<small>.*?<\/small>/isu', ' ', $clean));
    } elseif (preg_match('/\(([^()]*)\)/u', $clean, $parenMatch) === 1) {
        $inner = trim((string) $parenMatch[1]);
        $note = $inner !== '' ? $inner : null;
        $clean = trim((string) preg_replace('/\([^()]*\)/u', ' ', $clean, 1));
    }

    $pages = null;
    if (preg_match_all('/\d+/u', $clean, $numberMatches) > 0) {
        $pages = implode(', ', $numberMatches[0]);
    }

    return ['pages' => $pages, 'note' => $note];
}

// Maps a "===Subsection===" heading under "==Publikationen==" to a reference_kind, or null for
// subsections that are ignored entirely (Elektronische Quellen/Bildquellen) or unrecognized.
// Matches tolerantly via avesmapsWikiSyncMonitorFieldKey() (lowercase + umlaut-folded + non-
// alnum-stripped), since real headings carry trailing words ("Ausführliche QUELLEN").
function avesmapsWikiPublicationSectionKind(string $heading): ?string {
    $key = avesmapsWikiSyncMonitorFieldKey($heading);
    if ($key === '' || str_starts_with($key, 'elektronisch') || str_starts_with($key, 'bildquell')) {
        return null;
    }
    if (str_starts_with($key, 'ausfuhrlich')) {
        return 'ausfuehrlich';
    }
    if (str_starts_with($key, 'erganzend')) {
        return 'ergaenzend';
    }
    if (str_starts_with($key, 'erwahnung')) {
        return 'erwaehnung';
    }

    return null;
}

// Parses an entity wiki page's "==Publikationen==" section into a flat reference list. Each
// "===Subsection===" determines the reference_kind for its "*[[Title]] Seite …" bullet lines
// (Elektronische Quellen/Bildquellen and unrecognized subsections are skipped entirely); the
// title is the first wikilink target on the line, the remainder feeds avesmapsWikiParsePageRef().
function avesmapsWikiParsePublicationsSection(string $wikitext): array {
    if (preg_match('/^==\s*Publikationen\s*==\s*$/imu', $wikitext, $headingMatch, PREG_OFFSET_CAPTURE) !== 1) {
        return [];
    }
    $bodyStart = $headingMatch[0][1] + strlen((string) $headingMatch[0][0]);
    $body = substr($wikitext, $bodyStart);
    // Bound the section at the next level-2 heading ("==Xyz=="), NOT at a level-3
    // "===Xyz===" subsection heading -- the [^=] right after "==" rules the latter out.
    if (preg_match('/^==[^=].*$/mu', $body, $nextSectionMatch, PREG_OFFSET_CAPTURE) === 1) {
        $body = substr($body, 0, $nextSectionMatch[0][1]);
    }

    $out = [];
    if (preg_match_all('/^===\s*(.+?)\s*===\s*$/mu', $body, $subsectionMatches, PREG_OFFSET_CAPTURE) < 1) {
        return $out;
    }
    $subsectionCount = count($subsectionMatches[0]);
    for ($i = 0; $i < $subsectionCount; $i++) {
        $kind = avesmapsWikiPublicationSectionKind((string) $subsectionMatches[1][$i][0]);
        $chunkStart = $subsectionMatches[0][$i][1] + strlen((string) $subsectionMatches[0][$i][0]);
        $chunkEnd = $i + 1 < $subsectionCount ? $subsectionMatches[0][$i + 1][1] : strlen($body);
        if ($kind === null) {
            continue; // ignored/unrecognized subsection (Elektronische Quellen, Bildquellen, …)
        }
        $chunk = substr($body, $chunkStart, $chunkEnd - $chunkStart);
        foreach (preg_split('/\R/u', $chunk) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] !== '*') {
                continue;
            }
            if (preg_match('/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*(.*)$/u', $line, $lineMatch) !== 1) {
                continue; // no wikilink on this bullet -- nothing to key a title off
            }
            $title = trim((string) $lineMatch[1]);
            if ($title === '') {
                continue;
            }
            $ref = avesmapsWikiParsePageRef((string) $lineMatch[2]);
            $out[] = [
                'title' => $title,
                'reference_kind' => $kind,
                'pages' => $ref['pages'],
                'note' => $ref['note'],
            ];
        }
    }

    return $out;
}

// Maps a publication's `Art` (and optionally `Unterkategorie`) infobox param to the 8-value
// source_type taxonomy (see api/_internal/app/feature-sources.php's whitelist). STARTER table
// only, per the brief -- covers the values named in the design doc. Fuzzy substring match (both
// directions) handles compound/qualified Art values (e.g. "Kaufabenteuer (limitiert)"); unknown
// -> 'sonstiges'.
// FOLLOW-UP (owner-triggered, not this task): pull the real `Art` value set from a dump run
// (SELECT DISTINCT-equivalent over publication pages during the Task-4 sync) and extend this
// table with anything that's still falling through to 'sonstiges'.
function avesmapsWikiMapArtToSourceType(string $art, string $unterkategorie = ''): string {
    static $table = [
        'abenteuer' => 'abenteuer',
        'kaufabenteuer' => 'abenteuer',
        'soloabenteuer' => 'abenteuer',
        'gruppenabenteuer' => 'abenteuer',
        'regionalspielhilfe' => 'regionalspielhilfe',
        'quellenband' => 'quellenband',
        'roman' => 'roman',
        'regelband' => 'regelbuch',
        'regelwerk' => 'regelbuch',
        'basisregelwerk' => 'regelbuch',
        'briefspiel' => 'briefspiel',
        'aventurischerbote' => 'aventurischer_bote',
    ];

    $key = avesmapsWikiSyncMonitorFieldKey($art);
    if ($key === '') {
        $key = avesmapsWikiSyncMonitorFieldKey($unterkategorie);
    }
    if ($key === '') {
        return 'sonstiges';
    }
    if (isset($table[$key])) {
        return $table[$key];
    }
    foreach ($table as $needle => $sourceType) {
        if (str_contains($key, $needle) || str_contains($needle, $key)) {
            return $sourceType;
        }
    }

    return 'sonstiges';
}

// ===========================================================================
// Adventure fields (Phase 4). A DSA adventure IS an {{Infobox Produkt}} page whose `Art` is an
// adventure/campaign type. The field NAMES below are the ones the LIVE template actually uses
// (verified against Vorlage:Infobox Produkt + a real adventure via action=raw, the allowed
// template/definition read): Ort / Genre / KompM / KompSp / Regeln / Bild -- NOT the guessed
// "Komplexität Spielleiter"/"Regelsystem". Pure, DB-free (mirrors the publication parsers).
// ===========================================================================

// True iff a product's `Art` marks it as an adventure or campaign (the two product families that
// carry an ordered "Ort" place list). Matches any *abenteuer (Gruppen-/Solo-/Kauf-/Kurz-…) plus
// the bare "Kampagne" (a campaign's source_type is not 'abenteuer', but it IS an adventure here).
function avesmapsWikiProductIsAdventure(string $art): bool {
    $key = avesmapsWikiSyncMonitorFieldKey($art);
    if ($key === '') {
        return false;
    }
    return str_contains($key, 'abenteuer') || $key === 'kampagne';
}

// Normalize an `Art` value to the adventure.product_type slug (lowercase, umlaut-folded, non-alnum
// stripped -- the SAME folding the seed data uses: "Gruppenabenteuer" -> "gruppenabenteuer").
function avesmapsWikiNormalizeAdventureProductType(string $art): string {
    return avesmapsWikiSyncMonitorFieldKey($art);
}

// Strip wiki inline markup to plain text: [[Target|Label]] -> Label, [[Target]] -> Target, and
// drop bold/italic apostrophes. Used for Genre/Autoren/series, which mix plain text and wikilinks.
function avesmapsWikiStripWikiInlineMarkup(string $text): string {
    $text = str_replace(["'''", "''"], '', $text);
    $text = preg_replace('/\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]/u', '$1', $text) ?? $text;
    return trim((string) preg_replace('/\s+/u', ' ', $text));
}

// Parse the ordered "Ort" place list: the wikilink TARGETS in source order (STRICT -- the first is
// the start place, role='start'; NEVER reorder). "[[Mittelreich]], [[Königreich Garetien]], …" ->
// ['Mittelreich','Königreich Garetien',…]. A bare (non-linked) comma list is a fallback.
function avesmapsWikiParseAdventurePlaceList(string $ort): array {
    $out = [];
    if (preg_match_all('/\[\[\s*([^\]|#]+?)\s*(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/u', $ort, $matches) > 0) {
        foreach ($matches[1] as $target) {
            $target = trim((string) $target);
            if ($target !== '') {
                $out[] = $target;
            }
        }
        return $out;
    }
    // No wikilinks -> treat a plain comma/newline list as raw names (best-effort).
    foreach (preg_split('/\s*[,;\n]\s*/u', trim($ort)) ?: [] as $name) {
        $name = trim((string) $name);
        if ($name !== '') {
            $out[] = $name;
        }
    }
    return $out;
}

// Extract the cover image FILE NAME from the `Bild`/`Cover` params. The live template wraps it as
// {{ProdCover|AB VA62.jpg}} (Bild); `Cover` is usually empty. Also tolerates [[Datei:…]] and a bare
// filename. Returns '' when no cover is set (space vs underscore is left as-is; the wiki treats them
// as equal, and avesmapsWikiSyncMonitorCoatOfArmsUrl normalizes them when building the image URL).
function avesmapsWikiParseProductCoverFile(string $bild, string $cover): string {
    foreach ([$bild, $cover] as $raw) {
        $raw = trim($raw);
        if ($raw === '') {
            continue;
        }
        if (preg_match('/\{\{\s*ProdCover\s*\|\s*(?:[^=|}]+=\s*)?([^|}]+?)\s*\}\}/iu', $raw, $m) === 1) {
            return trim((string) $m[1]);
        }
        if (preg_match('/\[\[\s*(?:Datei|Bild|File|Image)\s*:\s*([^\]|]+)/iu', $raw, $m) === 1) {
            return trim((string) $m[1]);
        }
        if (preg_match('/([^\s|{}\[\]]+\.(?:jpe?g|png|gif|webp))/iu', $raw, $m) === 1) {
            return trim((string) $m[1]);
        }
    }
    return '';
}

// Parses a publication wiki page's {{Infobox Produkt}} block. Reuses
// avesmapsWikiSyncMonitorExtractInfoboxBlock() (which is NOT name-filtered -- it returns
// whatever {{Infobox ...}} block it finds first) and GUARDS on the block actually being an
// "Infobox Produkt" via avesmapsWikiSyncMonitorInfoboxName() + avesmapsWikiSyncMonitorFieldKey()
// -- the same whitespace/newline-tolerant name match dump-entity-scan.php/paths.php/regions.php
// use, NOT a literal string-prefix check, so irregularly-spaced real wikitext like
// "{{Infobox  Produkt" (double space) or "{{Infobox\nProdukt" (newline) still match; returns null
// for pages with no infobox or a genuinely different infobox type.
// f_shop_pid/pdf_shop_id are not direct template params -- they're regexed out of the
// Direktlinks/Download param values ({{F-Shop|PID=…}} / {{PDF-Shop|ID=…}}).
function avesmapsWikiParseProductInfobox(string $wikitext): ?array {
    $block = avesmapsWikiSyncMonitorExtractInfoboxBlock($wikitext);
    $infoboxKey = avesmapsWikiSyncMonitorFieldKey(avesmapsWikiSyncMonitorInfoboxName($block));
    if ($block === '' || $infoboxKey !== 'produkt') {
        return null;
    }
    $params = avesmapsWikiSyncMonitorParseTemplateParams($block);

    $title = trim((string) ($params['Titel'] ?? ''));
    $art = trim((string) ($params['Art'] ?? ''));
    $isbn = trim((string) ($params['ISBN'] ?? ''));
    $unterkategorie = trim((string) ($params['Unterkategorie'] ?? ''));
    $direktlinks = (string) ($params['Direktlinks'] ?? '');
    $download = (string) ($params['Download'] ?? '');

    $fShopPid = null;
    if (preg_match('/\{\{\s*F-Shop\s*\|\s*PID\s*=\s*([^|}\s]+)/iu', $direktlinks, $pidMatch) === 1) {
        $fShopPid = trim((string) $pidMatch[1]);
    }
    $pdfShopId = null;
    if (preg_match('/\{\{\s*PDF-Shop\s*\|\s*ID\s*=\s*([^|}\s]+)/iu', $download, $idMatch) === 1) {
        $pdfShopId = trim((string) $idMatch[1]);
    }

    // Adventure sub-payload: present ONLY for adventure/campaign products (null otherwise, so the
    // publication catalog path is byte-for-byte unaffected). The Phase-4 adventure sync reads it;
    // publications ignore it. bf_year/bf_label are deliberately absent -- the infobox has no BF year.
    $adventure = null;
    if (avesmapsWikiProductIsAdventure($art)) {
        $adventure = [
            'product_type' => avesmapsWikiNormalizeAdventureProductType($art),
            'places' => avesmapsWikiParseAdventurePlaceList((string) ($params['Ort'] ?? '')),
            'genre' => avesmapsWikiStripWikiInlineMarkup((string) ($params['Genre'] ?? '')),
            'complexity_gm' => trim((string) ($params['KompM'] ?? '')),
            'complexity_pl' => trim((string) ($params['KompSp'] ?? '')),
            'edition' => trim((string) ($params['Regeln'] ?? '')),
            'authors' => avesmapsWikiStripWikiInlineMarkup((string) ($params['Autoren'] ?? '')),
            'series' => avesmapsWikiStripWikiInlineMarkup(
                trim((string) ($params['Teil von'] ?? '')) !== ''
                    ? (string) $params['Teil von']
                    : (string) ($params['Reihe'] ?? $params['Reihentitel'] ?? '')
            ),
            'cover_file' => avesmapsWikiParseProductCoverFile((string) ($params['Bild'] ?? ''), (string) ($params['Cover'] ?? '')),
        ];
    }

    return [
        'title' => $title,
        'art' => $art,
        'source_type' => avesmapsWikiMapArtToSourceType($art, $unterkategorie),
        'isbn' => $isbn,
        'f_shop_pid' => $fShopPid,
        'pdf_shop_id' => $pdfShopId,
        'adventure' => $adventure,
    ];
}

// Builds the canonical "buy" URL for a publication from its F-Shop/PDF-Shop template IDs
// (avesmapsWikiParseProductInfobox()'s f_shop_pid/pdf_shop_id). Link hierarchy (first hit wins,
// per docs/wiki-publikations-quellen-design.md §5): F-Shop -> PDF-Shop -> no link (empty
// chosen_url, has_link=false; the caller renders the publication as a name-only source).
//
// URL patterns are BELEGT (proven from the live template source), not guessed -- fetched via the
// wiki's own `?action=raw` API on 2026-07-09, which is a template-*definition* read, explicitly
// allowed by operator policy (NOT an HTML content crawl of article pages):
//
// F-Shop -- https://de.wiki-aventurica.de/wiki/Vorlage:F-Shop?action=raw (verification date 2026-07-09).
// Raw wikitext (verbatim):
//   {{#if:{{{PID|}}}|[https://www.f-shop.de/search?sSearch={{{PID}}} F-Shop] {{Vorlagenhilfehinweis|F-Shop}}
//   |{{#if:{{{ID|}}}|[https://www.f-shop.de/detail/index/sArticle/{{{ID}}} F-Shop] {{Vorlagenhilfehinweis|F-Shop}}}}}}
// Two branches: a PID branch (search URL) and an ID branch (detail-page URL). This function only
// ever receives a PID -- avesmapsWikiParseProductInfobox() regexes exclusively `{{F-Shop|PID=...}}`
// out of the Direktlinks param, never a bare `ID=` -- so only the PID branch applies:
// https://www.f-shop.de/search?sSearch=<PID>. Note this is a search-results URL, not a per-product
// detail page -- that is what the template itself renders for a PID, so it is the proven pattern
// even though "canonical" here means "what the wiki links to", not "shortest possible URL".
//
// PDF-Shop -- https://de.wiki-aventurica.de/wiki/Vorlage:PDF-Shop?action=raw (verification date 2026-07-09).
// Raw wikitext (verbatim, relevant branch):
//   {{#if:{{#dplreplace:{{{ID|}}}|\D}}|[https://www.ulisses-ebooks.de/product/{{{ID}}} PDF-Shop] ...|...}}
// The literal template target is https://www.ulisses-ebooks.de/product/<ID> (no locale segment, no
// trailing slash). Per the task brief this function instead emits the already-confirmed,
// community-observed pattern https://www.ulisses-ebooks.de/de/product/<ID>/ -- verified against a
// real browser URL for an existing catalog entry (".../product/100144/..."): the shop adds the
// /de/ locale segment and a trailing slash once the bare template link is actually followed
// (locale redirect + canonicalization), so that is the URL a buyer actually lands on. Kept exactly
// as mandated by the brief (see .superpowers/sdd/task-3-brief.md Step 1/2).
function avesmapsWikiBuildPublicationUrl(?string $fShopPid, ?string $pdfShopId): array {
    $fShopPid = trim((string) $fShopPid);
    $pdfShopId = trim((string) $pdfShopId);

    if ($fShopPid !== '') {
        return ['chosen_url' => 'https://www.f-shop.de/search?sSearch=' . rawurlencode($fShopPid), 'has_link' => true];
    }
    if ($pdfShopId !== '') {
        return ['chosen_url' => 'https://www.ulisses-ebooks.de/de/product/' . rawurlencode($pdfShopId) . '/', 'has_link' => true];
    }

    return ['chosen_url' => '', 'has_link' => false];
}
