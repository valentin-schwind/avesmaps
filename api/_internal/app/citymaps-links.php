<?php

declare(strict_types=1);

// A map's link list and its places -- the set_links gate, the community fundort report, the tombstone
// rules for links and places, and the public_id -> id lookup (citymaps.php calls it too). Split out of citymaps.php,
// which requires this file at the point the block used to sit; the three constants it reads
// (AVESMAPS_CITYMAP_LINK_LABEL_MAX, _LINK_ROWS_MAX, _NOTE_MAX) stay there and are defined first.

// The gate between the editor and citymap_link. Takes the WHOLE list as displayed and returns it as
// storable rows; sort_order is the array position, so the editor's ▲▼ is a plain array move and no id ever
// has to be renumbered. Pure (no PDO) -> unit-tested in __tests__/citymap-links-test.php.
//
// Mirrors avesmapsNormalizeGameLiteratureLinkRows, plus is_paid. An all-blank row is a trailing empty line in a
// row editor, not an error -- skipped. A HALF-filled row is an error rather than a silent drop: dropping
// loses what the editor typed, and storing it would render an anchor with no text (avesmapsCitymapLinks
// only skips on an empty url, never on an empty label).
function avesmapsNormalizeCitymapLinkRows(array $rows): array
{
    $normalized = [];
    foreach ($rows as $row) {
        $label = trim((string) (is_array($row) ? ($row['label'] ?? '') : ''));
        $url = trim((string) (is_array($row) ? ($row['url'] ?? '') : ''));
        // A touched tri-state alone does not make a row: nobody typed a link, they clicked a control and
        // moved on. Only label/url decide whether a row exists.
        if ($label === '' && $url === '') {
            continue;
        }
        if ($label === '') {
            throw new InvalidArgumentException('Ein Link braucht einen Titel: ' . $url);
        }
        if ($url === '') {
            throw new InvalidArgumentException('Ein Link braucht eine URL: ' . $label);
        }
        if (mb_strlen($label) > AVESMAPS_CITYMAP_LINK_LABEL_MAX) {
            throw new InvalidArgumentException('Der Link-Titel ist zu lang (max. ' . AVESMAPS_CITYMAP_LINK_LABEL_MAX . ' Zeichen): ' . $label);
        }
        // 💣 DER DECKEL AUF DIE ZEILENZAHL. Er fehlte, und die Fundort-Meldung ist der Weg, auf dem eine
        // ANMELDEFREIE Meldung ihn erreicht: report_mode wird unabhaengig von report_type gelesen,
        // ein report_type=fundort mit report_mode=change bekommt also die grosse Nutzlast UND die
        // Befreiung von der Stundengrenze. Ohne Deckel fuellen rund 85 Zeilen maximaler Groesse die
        // TEXT-Spalte (65.535 Bytes) -- ~80 KB je Meldung, und der Pruefbildschirm laedt bis zu 500
        // davon (Befund A30).
        //
        // ⚠️ Die 20 ist gemessen, nicht geraten: live sind es 456 Karten mit hoechstens 2 Fundorten. Zurueckgewiesen wird,
        // nicht abgeschnitten -- das ist die Hausform (siehe Titel-/URL-Laengen darueber), und ein
        // still gekuerzter Vorschlag ist eine Behauptung ueber etwas, das der Melder nicht gesagt hat.
        if (count($normalized) >= AVESMAPS_CITYMAP_LINK_ROWS_MAX) {
            throw new InvalidArgumentException('Zu viele Links (max. ' . AVESMAPS_CITYMAP_LINK_ROWS_MAX . ').');
        }
        $normalized[] = [
            'label' => $label,
            // http/https + length, the same gate map_url passes through.
            'url' => avesmapsCitymapNormalizeUrl($url, 'Link „' . $label . '“'),
            'is_paid' => avesmapsCitymapTriBool(is_array($row) ? ($row['is_paid'] ?? null) : null),
            'sort_order' => count($normalized),
        ];
    }
    return $normalized;
}

// Replace a map's whole link list atomically (spec §6.1 `set_links`, mirroring the adventure side). Delete
// + re-insert rather than diffing: these are leaf rows with nothing to protect, and link_status keys on
// url_hash, so an unchanged URL keeps its probe history across the rewrite regardless of its new row id.
//
// Scoped to origin='manual': a wiki-born link is the sync's to own (spec §6.6) and a community link is a
// reader's, so neither is the editor's list to replace. Today the editor is the only writer and every row
// is 'manual', which makes this scoping inert -- it is here so that the wiki sync landing next cannot have
// its rows silently deleted by the first editor who saves an unrelated field.
function avesmapsSetCitymapLinks(PDO $pdo, string $publicId, array $links): array
{
    avesmapsCitymapsEnsureTables($pdo);
    $citymapId = avesmapsCitymapIdByPublicId($pdo, $publicId);

    // Validate the WHOLE list before touching a row: a partial save would leave the editor showing a list
    // that no longer matches what is stored.
    $rows = avesmapsNormalizeCitymapLinkRows($links);

    $pdo->beginTransaction();
    try {
        $pdo->prepare("DELETE FROM citymap_link WHERE citymap_id = :id AND origin = 'manual'")
            ->execute(['id' => $citymapId]);
        $insert = $pdo->prepare(
            "INSERT INTO citymap_link (citymap_id, label, url, is_paid, sort_order, origin, status)
             VALUES (:id, :label, :url, :is_paid, :sort_order, 'manual', 'approved')"
        );
        foreach ($rows as $row) {
            $insert->execute([
                'id' => $citymapId,
                'label' => $row['label'],
                'url' => $row['url'],
                'is_paid' => $row['is_paid'],
                'sort_order' => $row['sort_order'],
            ]);
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }
    return ['public_id' => $publicId, 'links' => count($rows)];
}

// ---- community fundort report (Spec 2026-07-17-community-fundorte §3.2) -------------------------------
// PURE (no PDO, no HTTP) -> unit-tested in __tests__/citymap-link-report-test.php.
//
// Runs on the PUBLIC endpoint (api/app/report-location.php) with capability NONE, so its output is
// untrusted input that has passed a whitelist -- and anything it does not return can never reach a column.
// An ALLOWLIST by construction: it returns {citymap_public_id, links[], note} and nothing else.
//
// `origin` and `status` are absent ON PURPOSE, and that is the whole point of the function. They are OUR
// bookkeeping: a report that could name its own origin would write itself in as 'manual' and the editor
// would take it for his own work; a status='approved' would publish it without anyone looking. Because the
// keys are never read, the INSERT never names the columns -- the defaults simply stand, and the approval
// stamps 'community' itself.
//
// The ROW rules are avesmapsNormalizeCitymapLinkRows' -- the very gate the editor's set_links passes
// through. A community row can therefore never be shaped differently from an editor's, and the http/https
// check, the length limits and the "half-filled row is an error" rule hold identically on both doors.
function avesmapsNormalizeCitymapLinkReportPayload(mixed $raw): array
{
    $data = is_array($raw) ? $raw : [];

    // Without a map the proposal has no target -- "another place to find THIS map" is the entire idea.
    $citymapPublicId = avesmapsCitymapReportText($data['citymap_public_id'] ?? '', 64, 'Die Karten-ID');
    if ($citymapPublicId === '') {
        throw new InvalidArgumentException('Zu welcher Karte gehoert der Fundort?');
    }

    $links = avesmapsNormalizeCitymapLinkRows(is_array($data['links'] ?? null) ? $data['links'] : []);
    if ($links === []) {
        throw new InvalidArgumentException('Bitte mindestens einen Fundort angeben.');
    }

    return [
        'citymap_public_id' => $citymapPublicId,
        'links' => $links,
        // Free text to a human. Refused when too long rather than truncated (avesmapsCitymapReportText):
        // a note cut mid-sentence changes what the reporter said, and this one is addressed to an editor
        // deciding whether to trust them.
        'note' => avesmapsCitymapReportText($data['note'] ?? '', AVESMAPS_CITYMAP_NOTE_MAX, 'Die Notiz'),
    ];
}

// Append ONE fundort. Deliberately NOT avesmapsSetCitymapLinks: that one replaces the whole list, so a
// community report routed through it would silently delete every fundort an editor had entered. This is the
// one write on this table that must only ever add.
//
// $origin is stamped by the CALLER, never taken from the row: 'community' from the report approval,
// 'wiki' from the sync (Mehrfachlink-Spec §6.6). Its default 'manual' keeps the signature honest for a
// hand-written call, and avesmapsCitymapNormalizeOrigin turns anything unrecognised into 'manual' -- the
// conservative answer, since 'manual' is exactly what the wiki sync refuses to touch.
function avesmapsAddCitymapLink(PDO $pdo, string $citymapPublicId, array $row, string $origin = 'manual'): array
{
    avesmapsCitymapsEnsureTables($pdo);
    $citymapId = avesmapsCitymapIdByPublicId($pdo, $citymapPublicId);

    // Through the same gate as everything else on this table, even though the report path already ran it:
    // this function is callable from anywhere, and a URL is not a thing to take on trust twice.
    $normalized = avesmapsNormalizeCitymapLinkRows([$row]);
    if ($normalized === []) {
        throw new InvalidArgumentException('Der Fundort ist leer.');
    }
    $link = $normalized[0];

    // Append: sort_order continues the list rather than restarting at 0 (the normalizer stamps positions
    // per CALL, which is right for a whole-list replace and wrong here).
    $max = $pdo->prepare('SELECT MAX(sort_order) FROM citymap_link WHERE citymap_id = :id');
    $max->execute(['id' => $citymapId]);
    $next = $max->fetchColumn();
    $sortOrder = ($next === null || $next === false) ? 0 : ((int) $next) + 1;

    $pdo->prepare(
        "INSERT INTO citymap_link (citymap_id, label, url, is_paid, sort_order, origin, status)
         VALUES (:id, :label, :url, :is_paid, :sort_order, :origin, 'approved')"
    )->execute([
        'id' => $citymapId,
        'label' => $link['label'],
        'url' => $link['url'],
        'is_paid' => $link['is_paid'],
        'sort_order' => $sortOrder,
        'origin' => avesmapsCitymapNormalizeOrigin($origin),
    ]);
    return ['link_id' => (int) $pdo->lastInsertId()];
}

// Removing a fundort the editor does not own: TOMBSTONE, never DELETE. A deleted wiki row is one the next
// sync digs straight back up -- the exact bug avesmapsSuppressCitymapPlace got its rule for. The rule is
// phrased the same way here ("whatever we did not author") so the next origin does not have to remember to
// come back and edit this function. A 'manual' row has nothing to protect and is really deleted -- but the
// editor never reaches this path for one of those anyway: it removes those by leaving them out of set_links.
function avesmapsSuppressCitymapLink(PDO $pdo, int $linkId): array
{
    avesmapsCitymapsEnsureTables($pdo);

    $find = $pdo->prepare('SELECT origin FROM citymap_link WHERE id = :id LIMIT 1');
    $find->execute(['id' => $linkId]);
    $origin = $find->fetchColumn();
    if ($origin === false) {
        avesmapsErrorResponse(404, 'not_found', 'Der Fundort wurde nicht gefunden.');
    }

    if ((string) $origin !== 'manual') {
        $pdo->prepare("UPDATE citymap_link SET status = 'suppressed' WHERE id = :id")->execute(['id' => $linkId]);
        return ['link_id' => $linkId, 'suppressed' => true];
    }

    $pdo->prepare('DELETE FROM citymap_link WHERE id = :id')->execute(['id' => $linkId]);
    return ['link_id' => $linkId, 'suppressed' => false];
}

function avesmapsCitymapIdByPublicId(PDO $pdo, string $publicId): int
{
    $statement = $pdo->prepare('SELECT id FROM citymap WHERE public_id = :pid LIMIT 1');
    $statement->execute(['pid' => $publicId]);
    $id = $statement->fetchColumn();
    if ($id === false) {
        avesmapsErrorResponse(404, 'not_found', 'Die Karte wurde nicht gefunden.');
    }
    return (int) $id;
}

// ---- places (Spec §3.1, 1:1 with adventure_place) ----------------------------------------------------
// Deliberate copies of avesmapsAddGameLiteraturePlace & co rather than a shared generic: the two tables differ
// (no `role` here) and the adventure versions are load-bearing for a shipped feature. What IS shared is
// the part that matters -- the resolver (avesmapsResolvePlacesInTable) and the wiki-key lookup
// (avesmapsGameLiteratureWikiKeyByPublicId), so a place resolves identically on both surfaces.

// $origin mirrors avesmapsUpsertCitymap's: 'community' when the place came from an approved reader
// suggestion (Spec §3.8), 'manual' when an editor added it. Not cosmetic in two ways -- the editor prints
// it per place (html/citymap-editor.html:775 renders "Community" vs "manuell"), so a hardcoded 'manual'
// would credit a reader's suggestion to an editor, right next to a map badged "Community"; and
// avesmapsSuppressCitymapPlace tombstones every non-'manual' place instead of deleting it, a rule
// commit 579d21c2 widened from 'community' to "not manual" for exactly this origin.
function avesmapsAddCitymapPlace(PDO $pdo, string $citymapPublicId, array $data, string $origin = 'manual'): array
{
    avesmapsCitymapsEnsureTables($pdo);
    $citymapId = avesmapsCitymapIdByPublicId($pdo, $citymapPublicId);

    $rawName = trim((string) ($data['raw_name'] ?? ''));
    if ($rawName === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'Ein Ortsname (raw_name) ist erforderlich.');
    }

    $targetKind = trim((string) ($data['target_kind'] ?? 'unresolved'));
    if ($targetKind === '') {
        $targetKind = 'unresolved';
    }
    $targetPublicId = trim((string) ($data['target_public_id'] ?? ''));
    $targetWikiKey = trim((string) ($data['target_wiki_key'] ?? ''));

    if (array_key_exists('sort_order', $data) && $data['sort_order'] !== null && $data['sort_order'] !== '') {
        $sortOrder = (int) $data['sort_order'];
    } else {
        $maxStatement = $pdo->prepare('SELECT MAX(sort_order) FROM citymap_place WHERE citymap_id = :id');
        $maxStatement->execute(['id' => $citymapId]);
        $max = $maxStatement->fetchColumn();
        $sortOrder = ($max === null || $max === false) ? 0 : ((int) $max) + 1;
    }

    $pdo->prepare(
        "INSERT INTO citymap_place
            (citymap_id, sort_order, raw_name, target_kind, target_public_id, target_wiki_key, origin, status)
         VALUES (:id, :sort_order, :raw_name, :target_kind, :target_public_id, :target_wiki_key, :origin, 'approved')"
    )->execute([
        'id' => $citymapId,
        'sort_order' => $sortOrder,
        'raw_name' => $rawName,
        'target_kind' => $targetKind,
        'target_public_id' => $targetPublicId === '' ? null : $targetPublicId,
        'target_wiki_key' => $targetWikiKey === '' ? null : $targetWikiKey,
        'origin' => avesmapsCitymapNormalizeOrigin($origin),
    ]);
    $placeId = (int) $pdo->lastInsertId();

    // P3 pick-by-public_id: the editor picked an EXACT entity but sent no wiki_key -> derive it from the
    // id. No wiki link (e.g. "Thalhaus") -> leave NULL; the editor shows "ohne Wiki-Eintrag", a valid
    // state, not an error.
    if ($targetPublicId !== '' && $targetWikiKey === ''
        && in_array($targetKind, ['settlement', 'territory', 'region', 'path'], true)) {
        $derivedKey = avesmapsGameLiteratureWikiKeyByPublicId($pdo, $targetKind, $targetPublicId);
        if ($derivedKey !== '') {
            $pdo->prepare('UPDATE citymap_place SET target_wiki_key = :wk WHERE id = :id')
                ->execute(['wk' => $derivedKey, 'id' => $placeId]);
        }
    }

    // Resolve in the same call rather than leaving it to the editor. The pass only touches rows that are
    // 'unresolved' OR still missing a territory_path, so an EXACT pick keeps its target and merely gets
    // its path filled -- while a free-text name gets resolved. Both matter:
    //   - without the path, getCityMapsForTerritory() would never find this map. byTerritoryPath is the
    //     only subtree axis, and a fresh row has target_territory_path = NULL.
    //   - a caller that forgets the follow-up call would silently produce a place that resolves to nothing.
    // Bounded work (one candidate load, no HTTP) and adding a place is not a hot path.
    avesmapsResolvePlacesInTable($pdo, 'citymap_place');
    return ['place_id' => $placeId];
}

function avesmapsSetCitymapPlace(PDO $pdo, int $placeId, array $data): array
{
    avesmapsCitymapsEnsureTables($pdo);

    $find = $pdo->prepare('SELECT id FROM citymap_place WHERE id = :id LIMIT 1');
    $find->execute(['id' => $placeId]);
    if ($find->fetchColumn() === false) {
        avesmapsErrorResponse(404, 'not_found', 'Der Ort wurde nicht gefunden.');
    }

    // origin is always stamped 'manual' so a re-resolve leaves the now manually chosen target alone.
    $setClauses = ["origin = 'manual'"];
    $params = ['id' => $placeId];

    if (array_key_exists('raw_name', $data)) {
        $rawName = trim((string) $data['raw_name']);
        if ($rawName === '') {
            avesmapsErrorResponse(400, 'invalid_request', 'raw_name darf nicht leer sein.');
        }
        $setClauses[] = 'raw_name = :raw_name';
        $params['raw_name'] = $rawName;
    }
    if (array_key_exists('target_kind', $data)) {
        $kind = trim((string) $data['target_kind']);
        $setClauses[] = 'target_kind = :target_kind';
        $params['target_kind'] = $kind === '' ? 'unresolved' : $kind;
    }
    if (array_key_exists('target_public_id', $data)) {
        $value = trim((string) $data['target_public_id']);
        $setClauses[] = 'target_public_id = :target_public_id';
        $params['target_public_id'] = $value === '' ? null : $value;
    }
    if (array_key_exists('target_wiki_key', $data)) {
        $value = trim((string) $data['target_wiki_key']);
        $setClauses[] = 'target_wiki_key = :target_wiki_key';
        $params['target_wiki_key'] = $value === '' ? null : $value;
    }
    if (array_key_exists('sort_order', $data)) {
        $setClauses[] = 'sort_order = :sort_order';
        $params['sort_order'] = (int) $data['sort_order'];
    }

    $pdo->prepare('UPDATE citymap_place SET ' . implode(', ', $setClauses) . ' WHERE id = :id')->execute($params);
    return ['place_id' => $placeId];
}

// Removing a place: anything NOT authored in this editor is TOMBSTONED (status='suppressed') so a later
// import cannot resurrect it; only a 'manual' place -- one an editor typed here -- has nothing to protect
// and is really deleted.
//
// The rule is deliberately "not manual" rather than a list of external origins. The first version named
// 'community' explicitly, reasoning that maps have no wiki origin (Spec §6: "kein Wiki-Sync für Karten").
// That was true when written and is now on its way out: §6 always said "später möglich, das origin-Feld
// ist da", and the owner has since asked for exactly that. A wiki-origin place under the old rule would
// have been hard-deleted and resurrected by the very next sync -- the bug the tombstone exists to
// prevent. Phrasing it as "whatever we did not author here" means the next origin does not need to
// remember to come back and edit this function.
function avesmapsSuppressCitymapPlace(PDO $pdo, int $placeId): array
{
    avesmapsCitymapsEnsureTables($pdo);

    $find = $pdo->prepare('SELECT origin FROM citymap_place WHERE id = :id LIMIT 1');
    $find->execute(['id' => $placeId]);
    $origin = $find->fetchColumn();
    if ($origin === false) {
        avesmapsErrorResponse(404, 'not_found', 'Der Ort wurde nicht gefunden.');
    }

    if ((string) $origin !== 'manual') {
        $pdo->prepare("UPDATE citymap_place SET status = 'suppressed' WHERE id = :id")->execute(['id' => $placeId]);
        return ['place_id' => $placeId, 'suppressed' => true];
    }

    $pdo->prepare('DELETE FROM citymap_place WHERE id = :id')->execute(['id' => $placeId]);
    return ['place_id' => $placeId, 'suppressed' => false];
}
