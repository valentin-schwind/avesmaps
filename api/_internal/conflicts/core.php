<?php

declare(strict_types=1);

/**
 * Conflict centre -- pure core (no DB, no HTTP, no globals).
 * =========================================================================
 * Design: docs/konfliktmanagement-design.md. Everything in this file is a pure function so the
 * two rules that decide whether the tool is usable at all can be unit-tested without a database:
 *
 *   1. WHICH SHARING IS LEGITIMATE (§6a). "Several objects claim one wiki article" matches 268
 *      groups / 1670 objects on live data -- but 215 groups (1547 objects) are the segments of ONE
 *      road, which is the design, not a defect. Flagging those would have opened the tool with
 *      1547 false positives.
 *   2. WHICH NAMES ARE MACHINE-MADE (§6b). Of 3721 ways without a wiki link, 2448 carry an
 *      auto-generated `<Subtype>-<n>` name and can never have a wiki counterpart. Listing them as
 *      "potential conflict" would have buried the 1178 hand-named ones that genuinely need review.
 *
 * Both numbers are measured (2026-07-20, live payload). Both mistakes are silent and in the
 * expensive direction -- the list still renders, it is just useless -- so they get tests, not
 * comments.
 */

// Die einzige Abhaengigkeit dieser Datei, und sie bricht die Reinheit nicht: path-naming.php ist
// selbst abhaengigkeitsfrei (kein PDO, kein HTTP, keine Globals) und traegt die Wegenamen-Regeln,
// darunter avesmapsWikiPathNameIsGeneric fuer avesmapsConflictPathNameIsAuto weiter unten.
require_once __DIR__ . '/../wiki/path-naming.php';

// Severity. Drives grouping and colour, never behaviour.
const AVESMAPS_CONFLICT_ERROR = 'error';            // provably wrong
const AVESMAPS_CONFLICT_DIVERGENCE = 'divergence';  // a decision is needed, not necessarily wrong
const AVESMAPS_CONFLICT_UNVERIFIED = 'unverified';  // plausible, never confirmed

// Decisions an editor can record. Stored verbatim in conflict_decision.decision.
const AVESMAPS_CONFLICT_DECISIONS = ['resolved', 'deferred', 'ignored', 'approved'];

// Derived status (§5a). NOT a stored column -- see avesmapsConflictStatus().
const AVESMAPS_CONFLICT_STATUS_OPEN = 'open';
const AVESMAPS_CONFLICT_STATUS_DEFERRED = 'deferred';
const AVESMAPS_CONFLICT_STATUS_ARCHIVED = 'archived';
const AVESMAPS_CONFLICT_STATUS_DONE = 'done';
// "Genehmigt": the finding is correct AND the situation is legitimate. Distinct from 'archived'
// ("still a conflict, left alone" ) -- owner 2026-07-21 on the Maraskansund, a sea made of two bays
// that each need their own label and therefore rightly share one article. Approving a single case
// is deliberately preferred over widening the legitimacy table (§6a) to all label|label pairs,
// which would blind the rule to the ones that ARE wrong.
const AVESMAPS_CONFLICT_STATUS_APPROVED = 'approved';

/**
 * Wo ein Wiki-Anspruch stehen darf, ausser im schlichten Feld properties.wiki_url.
 *
 * 💣 Diese Liste steht HIER und nirgends sonst. Sie stand vorher zweimal abgeschrieben da -- in
 * avesmapsConflictLoadMapRows() und in avesmapsConflictUnlinkFeature() -- und in beiden Abschriften
 * fehlte 'wiki_powerline'. Der Kraftlinien-Abgleich legt seinen Link ausschliesslich dort ab
 * (api/_internal/wiki/powerlines.php: "Touches ONLY properties.wiki_powerline"), also war die Regel
 * wiki.missing_key blind dafuer: am 15.08.2026 meldete sie live 144 Kraftlinien-Segmente als "kein
 * Wiki-Schluessel", 69 davon MIT gesetztem Link (Discord-Fall #71).
 *
 * Wer ein Feature mit eigenem Wiki-Nest baut, traegt es hier ein -- eine Zeile, und beide Leser
 * sehen es. Das ist derselbe Schnitt wie bei den Quellen (AGENTS.md §5): eine Liste, kein zweites
 * System.
 */
const AVESMAPS_CONFLICT_CLAIM_BLOCKS = ['wiki_settlement', 'wiki_region', 'wiki_path', 'wiki_powerline'];

/**
 * Partei-Typen, die als VIELE Zeilen mit EINEM Namen gespeichert sind: ein Weg und eine Kraftlinie.
 * Ort, Region, Territorium und Literatur gehoeren NICHT dazu -- dort ist eine Zeile ein Objekt.
 *
 * 💣 Diese eine Liste beantwortet ZWEI Fragen, und sie muessen dieselbe Antwort bekommen: ob die
 * Segmente einer Sache sich einen Artikel teilen duerfen (avesmapsConflictSharedWikiVerdict) und ob
 * sie zu EINEM Fall zusammengefasst werden (avesmapsConflictCollapseSegmentsByName). Wer nur die
 * zweite bedient, tauscht harmlose Beobachtungen gegen Meldungen in der schwersten Kategorie: am
 * 15.08.2026 waeren aus 69 falschen "kein Wiki-Schluessel" 13 Gruppen / 76 Objekte unter
 * "Mehrere Objekte beanspruchen denselben Wiki-Artikel" geworden.
 */
const AVESMAPS_CONFLICT_SEGMENTED_TYPES = ['path', 'powerline'];

/**
 * Der gespeicherte Wiki-Anspruch eines Objekts samt seiner HERKUNFT -- roh, ohne Anreicherung.
 *
 * Das schlichte Feld gewinnt: nur es darf aus dem Konfliktzentrum geleert werden. Ein Anspruch aus
 * einem Nest haengt an der ganzen Infobox und gehoert seinem eigenen Editor (repair.php,
 * Sicherheitsregel 1), deshalb reist die Quelle mit statt nur der URL.
 *
 * Ein Nest ohne `wiki_url` ist KEIN Anspruch: der Abgleich legt es auch dann an, wenn die Wiki-Seite
 * keine Adresse hergibt.
 *
 * @return array{wiki_url:string, claim_source:string} claim_source: '' | 'wiki_url' | einer aus
 *         AVESMAPS_CONFLICT_CLAIM_BLOCKS
 */
function avesmapsConflictExtractClaim(array $properties): array {
    $plain = trim((string) ($properties['wiki_url'] ?? ''));
    if ($plain !== '') {
        return ['wiki_url' => $plain, 'claim_source' => 'wiki_url'];
    }

    foreach (AVESMAPS_CONFLICT_CLAIM_BLOCKS as $block) {
        $nested = trim((string) ($properties[$block]['wiki_url'] ?? ''));
        if ($nested !== '') {
            return ['wiki_url' => $nested, 'claim_source' => $block];
        }
    }

    return ['wiki_url' => '', 'claim_source' => ''];
}

/**
 * The status is NOT stored. It falls out of two independent questions (owner definition, §5a):
 * does the conflict still exist right now, and has a human already decided?
 *
 *   present + no decision        -> open       "sollte gemacht werden"
 *   present + deferred           -> deferred   "zu wenig Information"
 *   present + resolved|ignored   -> archived   "bewusst so gelassen, Konflikt besteht weiter"
 *   gone    + any decision       -> done       "Daten repariert, der Fall bleibt als Historie"
 *   gone    + no decision        -> (not a case at all; never reaches here)
 *
 * Keeping this derived is what lets conflicts be COMPUTED instead of stored: a fixed conflict
 * disappears by itself, and a decision whose facts changed reopens by itself (the fingerprint no
 * longer matches, so the caller passes $decision = null).
 */
function avesmapsConflictStatus(bool $stillPresent, ?string $decision): string {
    if (!$stillPresent) {
        return AVESMAPS_CONFLICT_STATUS_DONE;
    }
    if ($decision === 'deferred') {
        return AVESMAPS_CONFLICT_STATUS_DEFERRED;
    }
    if ($decision === 'approved') {
        return AVESMAPS_CONFLICT_STATUS_APPROVED;
    }
    if ($decision === 'resolved' || $decision === 'ignored') {
        return AVESMAPS_CONFLICT_STATUS_ARCHIVED;
    }

    return AVESMAPS_CONFLICT_STATUS_OPEN;
}

/**
 * Stable identity of one conflict: sha256 over the rule plus everything the conflict is ABOUT.
 *
 * Both lists are sorted first, so a conflict does not reopen just because a query returned its
 * parties in a different order -- that would throw away every deferral on the next run. Anything
 * that IS a fact of the conflict (the shared url, the diverging values) belongs in $facts: when it
 * changes, the fingerprint changes, the stored decision no longer matches, and the case correctly
 * comes back as open.
 */
function avesmapsConflictFingerprint(string $ruleId, array $parties, array $facts = []): string {
    $partyKeys = [];
    foreach ($parties as $party) {
        $type = trim((string) ($party['type'] ?? ''));
        $id = trim((string) ($party['id'] ?? ''));
        if ($type === '' || $id === '') {
            continue;
        }
        $partyKeys[] = $type . ':' . $id;
    }
    sort($partyKeys, SORT_STRING);

    $factPairs = [];
    foreach ($facts as $key => $value) {
        $factPairs[] = (string) $key . '=' . (is_scalar($value) ? (string) $value : json_encode($value));
    }
    sort($factPairs, SORT_STRING);

    return hash('sha256', trim($ruleId) . '|' . implode(',', $partyKeys) . '|' . implode(',', $factPairs));
}

/**
 * Short, speakable case number derived from the fingerprint -- so editors can say "schau dir mal
 * K7M2QX an" instead of describing the case (owner 2026-07-21: they talk past each other).
 *
 * Derived, not stored: the fingerprint is already the stable identity of a conflict, so the number
 * is stable for free and needs no table. The flip side is honest rather than annoying -- when the
 * underlying facts change the fingerprint changes, and so does the number. That IS a different
 * case: it reopened for a reason.
 *
 * Crockford-style alphabet without I/L/O/U: those are the characters people mistype when reading a
 * code aloud, which is the entire purpose here. Six characters over 32 symbols leaves a ~1.5%
 * chance that ANY two of ~6000 conflicts collide -- and a collision costs nothing worse than the
 * search returning both.
 */
function avesmapsConflictShortId(string $fingerprint): string {
    $alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    $digest = hash('sha256', 'conflict-id|' . trim($fingerprint), true);
    $out = '';
    for ($i = 0; $i < 6; $i++) {
        $out .= $alphabet[ord($digest[$i]) % 32];
    }

    return $out;
}

/**
 * May these object types share one wiki article?
 *
 * Legitimate is exactly ONE shape: the segments of a single SEGMENTED object among themselves --
 * a road, and since Discord-Fall #71 a Kraftlinie. Everything else is a case -- owner ruling
 * 2026-07-20: "Greifenfurt Stadt" and "Greifenfurt Baronie" are a location and a territory, two
 * different things that must not carry one identity even when they share a name.
 *
 * 💣 Eine GEMISCHTE Gruppe bleibt ein Fall, auch wenn beide Seiten segmentiert sind: ein Weg und
 * eine Kraftlinie auf einem Artikel sind zwei Dinge. Deshalb wird auf die EINE verbliebene Art
 * geprueft, nicht auf "alle Arten sind segmentiert".
 *
 * @param list<string> $types the DISTINCT entity types among the parties
 */
function avesmapsConflictSharedWikiVerdict(array $types): string {
    $distinct = array_values(array_unique(array_filter(array_map('strval', $types), static fn(string $t): bool => $t !== '')));
    sort($distinct, SORT_STRING);

    // Only one segmented type among itself: "Reichsstraße 1" is one article across 26 segments
    // (§6a), und die "Basiliuslinie" ist einer ueber 16 (live gemessen 15.08.2026).
    if (count($distinct) === 1 && in_array($distinct[0], AVESMAPS_CONFLICT_SEGMENTED_TYPES, true)) {
        return 'legitimate';
    }

    return AVESMAPS_CONFLICT_ERROR;
}

/**
 * Is this path name machine-made?
 *
 * avesmapsWikiPathNextGenericName() (api/_internal/wiki/path-naming.php) hands a cleared segment a
 * fresh `<Subtype>-<n>`; the bare subtype word is the same thing without a counter. Such a name
 * cannot have a wiki counterpart, so it must never reach the watchlist -- 2448 of 3721 linkless
 * ways are exactly this.
 *
 * 💣 Die Regel steht NICHT mehr hier, sondern bei ihrem Erzeuger: avesmapsWikiPathNameIsGeneric()
 * in api/_internal/wiki/path-naming.php. Seit 01.09.2026 fragt die Kartensuche dieselbe Frage
 * ("hat diesen Weg ein Mensch benannt?"), und zwei Fassungen einer Frage in derselben Sprache sind
 * genau der Fehler, den dieses Haus mehrfach bezahlt hat. Diese Funktion bleibt als NAME der
 * Konfliktzentrale stehen -- §6b spricht von "auto-names", und ihre 2448 sind hier gemessen.
 *
 * ⚠️ Damit kennt die Beobachtungsliste seit 01.09.2026 ein drittes Muster: ein allgemeines
 * `<wort>-<zahl>` ohne Leerzeichen ("Meer-835") gilt jetzt ebenfalls als maschinell. Das ist
 * dieselbe Aussage, die §6b schon macht ("can never match a wiki page"), nur vollstaendiger --
 * die Liste wird dadurch kuerzer, nie laenger. Ungemessen am Livebestand (kein Zugriff von hier).
 *
 * @param list<string> $subtypes the known path subtypes (PATH_SUBTYPE_KEYS)
 */
function avesmapsConflictPathNameIsAuto(string $name, array $subtypes): bool {
    return avesmapsWikiPathNameIsGeneric($name, $subtypes);
}

/**
 * Comparison key for "is this the same wiki article?".
 *
 * The claim arrives in different shapes depending on where it is stored -- map features keep a URL,
 * territories and adventures keep a URL next to a slug, and the same page can be written with
 * underscores or percent-escapes. Comparing raw strings would let "Heldenweiler" and
 * "Heldenweiler" miss each other purely on spelling, which is the one thing this rule exists to
 * catch. So everything collapses to the decoded page title, case-folded.
 *
 * A non-wiki URL has no page title and keeps its full URL as its key -- two objects pointing at the
 * same foreign link are still the same claim.
 */
function avesmapsConflictArticleKey(string $wikiUrl): string {
    $wikiUrl = trim($wikiUrl);
    if ($wikiUrl === '') {
        return '';
    }
    if (preg_match('~/wiki/([^?#]+)~i', $wikiUrl, $match) === 1) {
        $title = str_replace('_', ' ', rawurldecode($match[1]));

        return mb_strtolower(trim($title), 'UTF-8');
    }

    return mb_strtolower(rtrim($wikiUrl, '/'), 'UTF-8');
}

/**
 * Group rows by the wiki article they claim and return only the groups that are a real conflict.
 *
 * A row is ['type' => 'location'|'path'|..., 'id' => string, 'label' => string, 'wiki_url' => string].
 * Rows without a url are ignored -- "has no wiki key" is a separate rule (§6b), not a collision.
 *
 * @return list<array{wiki_url:string, parties:list<array{type:string,id:string,label:string}>, severity:string}>
 */
function avesmapsConflictFindSharedWikiUrls(array $rows): array {
    $byArticle = [];
    $displayUrl = [];
    foreach ($rows as $row) {
        $url = trim((string) ($row['wiki_url'] ?? ''));
        $type = trim((string) ($row['type'] ?? ''));
        $id = trim((string) ($row['id'] ?? ''));
        $key = avesmapsConflictArticleKey($url);
        if ($key === '' || $type === '' || $id === '') {
            continue;
        }
        $byArticle[$key][] = ['type' => $type, 'id' => $id, 'label' => (string) ($row['label'] ?? '')];
        $displayUrl[$key] ??= $url;
    }

    $conflicts = [];
    foreach ($byArticle as $key => $parties) {
        if (count($parties) < 2) {
            continue;
        }
        $verdict = avesmapsConflictSharedWikiVerdict(array_column($parties, 'type'));
        if ($verdict === 'legitimate') {
            continue;
        }
        $conflicts[] = ['wiki_url' => (string) $displayUrl[$key], 'parties' => $parties, 'severity' => $verdict];
    }

    return $conflicts;
}

/**
 * Die IDENTITAET einer Beschriftung: „welches Ding beschriftet diese Zeile?" -- '' heisst „laesst
 * sich nicht sagen".
 *
 * Drei Stuecke, und alle drei sind noetig (gemessen am Livebestand, 20.08.2026):
 *   Wiki-Schluessel -- die EINZIGE gespeicherte Aussage „das hier ist jenes Ding". Ohne ihn bleibt
 *      nur der Name, und ein Name ist kein Schluessel: „Hexenwald" gibt es dreimal, zwei davon 158
 *      Karteneinheiten auseinander. Ohne Schluessel also keine Identitaet und kein Fall.
 *   Name -- 💣 sonst waeren die zehn Arme des Mhanadi-Deltas eine Dublette. Sie zeigen alle auf den
 *      Artikel „Mhanadi-Delta", heissen aber „Weisser Mhanadi", „Tiefer Mhanadi", … -- zehn echte
 *      Beschriftungen. Sie gehoeren in avesmapsConflictRuleSharedArticle, nicht hierher.
 *   Art -- 💣 „Grillenbusch" liegt zweimal auf einem Schluessel: als `graslandschaft` (Ebene
 *      Vegetation) und als `huegelland` (Ebene Topographie). Die vier Landschaften-Ebenen
 *      beschreiben denselben Fleck aus verschiedenen Blicken; das ist der Entwurf.
 *
 * Kleingeschrieben und getrimmt, damit ein Editor, der denselben Namen anders tippt, nicht zwei
 * Objekte daraus macht. 🪤 Hier stand als Begruendung „weil MySQL live ebenfalls ohne Ruecksicht auf
 * Gross-/Kleinschreibung vergleicht (utf8mb4_unicode_ci)" -- das traegt NICHT: verglichen wird ueber
 * PHP-Array-Schluessel, die Datenbank sieht diese Zeichenketten nie. (Bei
 * avesmapsConflictRepairGroupKey stimmt der Satz, dort steht daneben eine echte SQL-Abfrage ueber
 * `name`.) Die Faltung ist trotzdem richtig, nur aus dem anderen Grund.
 */
function avesmapsConflictLabelIdentity(string $wikiKey, string $name, string $subtype): string {
    $wikiKey = trim($wikiKey);
    $name = trim($name);
    if ($wikiKey === '' || $name === '') {
        return '';
    }

    return mb_strtolower($wikiKey, 'UTF-8')
        . "\0" . mb_strtolower($name, 'UTF-8')
        . "\0" . mb_strtolower(trim($subtype), 'UTF-8');
}

/**
 * Beschriftungen, die dasselbe Ding zweimal auf die Karte schreiben.
 *
 * 💣 DER RAUSCHFILTER IST DIE HALBE REGEL: eine Gruppe, deren Beschriftungen ALLE an DERSELBEN
 * Landschaftsflaeche haengen, ist KEIN Fall. Die Beziehung Flaeche->Label ist ausdruecklich 1:N
 * (docs/superpowers/specs/2026-07-28-landschaften-flaeche-label-kopplung-design.md) -- der
 * Finsterkamm ist 57 Karteneinheiten lang und traegt seinen Namen zweimal, das Ingvaltal dreimal.
 * Live gemessen (20.08.2026): ohne den Filter 10 Gruppen mit 22 Beschriftungen, davon sind 8
 * Gruppen mit 19 Beschriftungen genau diese Lage. Die Regel meldete also 8 Fehltreffer gegen 1
 * echten -- und boete an, Beschriftungen zu loeschen, an denen eine gezeichnete Flaeche haengt.
 *
 * ⚠️ VERSCHIEDENE Flaechen sind kein 1:N: zwei gleichnamige Regionen (live „Tulamidenlande", 120
 * Einheiten auseinander) bleiben ein Befund, auch wenn dort nichts geloescht werden darf.
 *
 * Eine Zeile ist ['id','label','subtype','wiki_key','region'] -- `region` ist die public_id der
 * Landschaftsflaeche oder ''. Sie reist bis in die Oberflaeche durch: dort entscheidet sie, ob der
 * Loeschknopf ueberhaupt angeboten wird.
 *
 * @param list<array{id:string,label:string,subtype:string,wiki_key:string,region:string}> $rows
 * @return list<array{identity:string, parties:list<array{id:string,label:string,subtype:string,region:string}>}>
 */
function avesmapsConflictFindDuplicateLabels(array $rows): array {
    $groups = [];
    foreach ($rows as $row) {
        $id = trim((string) ($row['id'] ?? ''));
        if ($id === '') {
            continue;
        }
        $identity = avesmapsConflictLabelIdentity(
            (string) ($row['wiki_key'] ?? ''),
            (string) ($row['label'] ?? ''),
            (string) ($row['subtype'] ?? '')
        );
        if ($identity === '') {
            continue;
        }
        $groups[$identity][] = [
            'id' => $id,
            'label' => trim((string) ($row['label'] ?? '')),
            'subtype' => (string) ($row['subtype'] ?? ''),
            'region' => trim((string) ($row['region'] ?? '')),
        ];
    }

    $duplicates = [];
    foreach ($groups as $identity => $parties) {
        if (count($parties) < 2) {
            continue;
        }
        $regions = array_unique(array_column($parties, 'region'));
        // Genau EINE Flaeche, und sie ist eine echte: das ist das 1:N und kein Fall. Ein leerer
        // Wert steht fuer „gehoert zu keiner Flaeche" -- zwei freie Beschriftungen teilen sich
        // damit zwar den leeren Wert, aber eben keine Flaeche.
        if (count($regions) === 1 && reset($regions) !== '') {
            continue;
        }
        $duplicates[] = ['identity' => (string) $identity, 'parties' => $parties];
    }

    return $duplicates;
}
