<?php

declare(strict_types=1);

/**
 * Conflict centre -- the repair verbs.
 * =========================================================================
 * P1 could only record a verdict; this is what actually changes the map. Every write goes through
 * the canonical revision bump and the map audit log, exactly like an editor's own edit, so nothing
 * here is invisible or unrevertable.
 *
 * TWO SAFETY RULES, both deliberate:
 *
 *  1. A claim that lives inside a wiki BLOCK (AVESMAPS_CONFLICT_CLAIM_BLOCKS in core.php) is never
 *     touched. Those blocks carry the whole infobox payload -- population, region, coat, course --
 *     and deleting one to drop an identity claim would throw away data the conflict never asked
 *     about. Such a party is refused with a message pointing at the editor that owns it.
 *  2. An unlink target must still claim the URL the conflict was about. Between listing and
 *     clicking, somebody else may have fixed it; without the check we would silently clear a link
 *     that has nothing to do with this case.
 */

require_once __DIR__ . '/core.php';
require_once __DIR__ . '/../map/features.php';
require_once __DIR__ . '/rules.php';

// Where a party's wiki claim is stored. Only the plain field is safely removable (rule 1 above).
const AVESMAPS_CONFLICT_CLAIM_FIELD = 'wiki_url';

/**
 * Mark "this object has no wiki article" -- the negative assertion Discord #38 was missing.
 *
 * Clearing a link is not enough on its own: the map-features enrichment cannot tell "deliberately
 * emptied" from "never set" and simply guesses a link back in. This flag is what makes a removal
 * stick, and avesmapsEnrichMapFeatureWikiUrl() honours it.
 */
const AVESMAPS_CONFLICT_NO_ARTICLE_FLAG = 'wiki_no_article';

/**
 * REIN: Wirkt ein Reparatur-Schreibvorgang auf den ganzen NAMENSVERBUND oder nur auf die eine Zeile?
 *
 * Bei den segmentierten Arten ist ein Fall im Konfliktzentrum eine LINIE, kein Segment:
 * avesmapsConflictRuleMissingKey wertet je Segment, und avesmapsConflictCollapseSegmentsByName fasst
 * danach nach Namen zusammen -- am Knopf steht also "6 Segmente". Traefe der Schreibvorgang trotzdem
 * nur das eine Segment, dessen public_id die zusammengefasste Zeile zufaellig mitfuehrt, bliebe der
 * Fall mit 5 Segmenten stehen. Genau der Livebestandsfall, der diesen Umbau ausgeloest hat.
 *
 * 🔴 DIES IST DIE EINE STELLE, an der sich die Reichweite wieder eng ziehen laesst -- ein `false`
 * hier macht ALLE Reparatur-Verben wieder einzeilig, ohne dass jemand eine zweite Abfrage im
 * Schreibpfad suchen muss. Die Liste selbst steht in core.php und NUR dort
 * (AVESMAPS_CONFLICT_SEGMENTED_TYPES).
 *
 * 💣 Sie heisst `Repair`, nicht `Unlink`: sie bedient BEIDE Knoepfe am selben Fall -- "Trennen" /
 * "Kein Wiki-Eintrag" und "Artikel uebernehmen". Zwei Knoepfe am selben Fall, die verschieden weit
 * reichen, sind schlimmer als zwei getrennte Fehler: eine Linie liesse sich ganz loesen, aber nur
 * zu einem Sechstel verknuepfen, und das saehe aus wie "der Link hat nicht gegriffen"
 * (Owner-Entscheid 15.08.2026).
 *
 * Ein Objekt ohne Namen faellt heraus: sein "Verbund" waere jedes andere namenlose Objekt seiner Art.
 */
function avesmapsConflictRepairSpansNameGroup(string $featureType, string $name): bool {
    return trim($name) !== '' && in_array($featureType, AVESMAPS_CONFLICT_SEGMENTED_TYPES, true);
}

/**
 * REIN: Der Verbund-Schluessel einer Zeile, oder '' wenn sie fuer sich allein steht.
 *
 * 💣 Gebraucht, weil ein einzelner Aufruf MEHRERE Segmente derselben Linie als Ziele bekommen kann:
 * ein geteilter Artikel wird NICHT nach Namen zusammengefasst (avesmapsConflictCollapseSegmentsByName
 * fasst nur Faelle mit genau einer Partei), also stehen die 26 Segmente der "Reichsstraße 1" dort
 * einzeln, und "Behält den Link" schickt sie alle. Ohne diesen Schluessel schriebe der erste Ziel-
 * aufruf den ganzen Verbund, und die 25 folgenden liefen in Sicherheitsregel 1 ("stammt aus der
 * Wiki-Zuordnung") -- 25 Fehlermeldungen fuer eine gelungene Reparatur. Beim Verknuepfen dasselbe:
 * dort liefe die zweite Zeile in "traegt bereits eine Verknuepfung", die der erste Aufruf gerade
 * selbst geschrieben hat.
 *
 * Kleingeschrieben, weil avesmapsConflictCollapseSegmentsByName ebenso zusammenfasst und MySQL
 * ohnehin ohne Ruecksicht auf Gross-/Kleinschreibung vergleicht.
 */
function avesmapsConflictRepairGroupKey(string $featureType, string $name): string {
    return avesmapsConflictRepairSpansNameGroup($featureType, $name)
        ? $featureType . '|' . mb_strtolower(trim($name), 'UTF-8')
        : '';
}

/**
 * REIN: Wer ist der BEHALTER dieses Aufrufs -- die Partei, die ihren Anspruch ausdruecklich behalten
 * soll? Und wissen wir das ueberhaupt sicher?
 *
 * 🔴 DER DATENVERLUST, DEN DAS VERHINDERT (gemessen 15.08.2026, live): „Behält den Link" ist im
 * Client als `run(keep, "unlink", others)` ausgedrueckt -- der Behalter steht NICHT in der Zielliste,
 * er wird dem Server gar nicht genannt. Solange jedes Ziel nur seine eigene Zeile traf, war das die
 * sicherste denkbare Form von „lass den in Ruhe". Seit ein Ziel den ganzen Namensverbund fasst, zieht
 * das erste Ziel den Behalter mit hinein: sechs Segmente, ein Klick, danach traegt NIEMAND mehr den
 * Artikel -- und es meldet Erfolg, weil der Fall danach aus der Liste verschwindet.
 *
 * Zwei Quellen, in dieser Reihenfolge:
 *   1. `keep` -- der Client sagt es ausdruecklich (Art + Kennung). Der vorgesehene Weg.
 *   2. `subject_id` -- ⚠️ der Rueckfall fuer AUSGELIEFERTE Clients, die `keep` noch nicht kennen.
 *      Der Client schickt seit jeher die Partei mit, an der der Knopf steht; beim Behalten ist das
 *      der Behalter, und er ist dann gerade NICHT unter den Zielen. Bei „Trennen" und „Kein
 *      Wiki-Eintrag" IST er unter den Zielen -- daran sind die Faelle zu unterscheiden, ohne dass
 *      irgendein Client sich aendern muss. Das ist wichtig: eine gecachte alte index.html haelt sich
 *      nicht daran, wann wir etwas Neues ausrollen (AGENTS.md §7).
 *
 * `known` = false heisst „diese Anfrage sagt gar nichts ueber einen Behalter". Dann wird beim
 * Trennen NICHT nach Verbund geschrieben (eng, wie vor der Reichweitenaenderung), statt blind zu
 * fassen -- lieber zu wenig getroffen als der Verlust oben.
 *
 * @param list<string> $targetPublicIds die Kennungen der Ziele dieses Aufrufs
 * @return array{keeper:string, known:bool}
 */
function avesmapsConflictResolveKeeper(array $input, array $targetPublicIds): array {
    $explicit = trim((string) ($input['keep']['id'] ?? ''));
    if ($explicit !== '') {
        return ['keeper' => $explicit, 'known' => true];
    }

    $subject = trim((string) ($input['subject_id'] ?? ''));
    if ($subject === '') {
        return ['keeper' => '', 'known' => false];
    }

    // Steht die handelnde Partei selbst unter den Zielen, ist sie kein Behalter, sondern das Opfer
    // des Klicks ("Trennen" / "Kein Wiki-Eintrag"). Dann gibt es keinen zu schuetzen.
    return ['keeper' => in_array($subject, $targetPublicIds, true) ? '' : $subject, 'known' => true];
}

/**
 * Die Zeilen, die dieser Aufruf NICHT anfassen darf: der Behalter und -- gehoert er zu einer
 * segmentierten Art -- sein GANZER Namensverbund.
 *
 * 💣 Der ganze Verbund, nicht nur die eine Zeile. Behielte nur das eine Segment seinen Anspruch,
 * staende eine Linie da, deren Segmente verschieden verlinkt sind -- genau der Zustand, den die
 * Verbund-Reichweite verhindern soll.
 *
 * @return array<int,bool> Menge von map_features.id
 */
function avesmapsConflictProtectedRowIds(PDO $pdo, string $keeperPublicId): array {
    $keeperPublicId = trim($keeperPublicId);
    if ($keeperPublicId === '') {
        return [];
    }

    $select = $pdo->prepare(
        "SELECT id, name, feature_type FROM map_features
         WHERE public_id = :p AND is_active = 1 LIMIT 1"
    );
    $select->execute(['p' => $keeperPublicId]);
    $row = $select->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return [];
    }

    $protected = [(int) $row['id'] => true];
    $groupKey = avesmapsConflictRepairGroupKey((string) ($row['feature_type'] ?? ''), (string) ($row['name'] ?? ''));
    if ($groupKey === '') {
        return $protected;
    }

    $group = $pdo->prepare(
        "SELECT id FROM map_features
         WHERE feature_type = :t AND name = :n AND is_active = 1"
    );
    $group->execute(['t' => (string) $row['feature_type'], 'n' => (string) $row['name']]);
    foreach ($group->fetchAll(PDO::FETCH_ASSOC) as $groupRow) {
        $protected[(int) $groupRow['id']] = true;
    }

    return $protected;
}

/**
 * REIN: Sicherheitsregel 1 und 2, je ZEILE. Leerer String = darf geschrieben werden, sonst die
 * Begruendung. Die Regeln gelten unveraendert -- neu ist nur, dass sie ueber mehrere Zeilen laufen
 * koennen und eine verletzende Zeile UEBERSPRUNGEN wird, statt den ganzen Vorgang abzubrechen.
 */
function avesmapsConflictUnlinkRowRefusal(array $properties, string $expectedUrl): string {
    // Welche Nester es gibt, steht in core.php und NUR dort (AVESMAPS_CONFLICT_CLAIM_BLOCKS) --
    // diese Liste war hier abgeschrieben, und die Abschrift kannte 'wiki_powerline' nicht.
    $claim = avesmapsConflictExtractClaim($properties);
    $plainClaim = $claim['claim_source'] === AVESMAPS_CONFLICT_CLAIM_FIELD ? $claim['wiki_url'] : '';
    $blockClaim = ($claim['claim_source'] !== '' && $claim['claim_source'] !== AVESMAPS_CONFLICT_CLAIM_FIELD)
        ? $claim['wiki_url']
        : '';

    // Safety rule 2: only touch a party that still claims the URL this conflict was about.
    if ($expectedUrl !== '' && $plainClaim !== '' && $plainClaim !== $expectedUrl) {
        return 'Der Link hat sich inzwischen geändert — bitte neu prüfen.';
    }

    // Safety rule 1: a block-borne claim belongs to its own editor, not to a blind unset here.
    if ($plainClaim === '' && $blockClaim !== '') {
        return 'Diese Verknüpfung stammt aus der Wiki-Zuordnung. Bitte im zuständigen Editor lösen — dort hängt die ganze Infobox dran.';
    }

    return '';
}

/**
 * Clear a feature's plain wiki claim, optionally recording that it has no article at all.
 *
 * Bei einer segmentierten Art (Weg, Kraftlinie) wirkt das auf ALLE aktiven Segmente desselben
 * Namens -- der Merker ist eine Aussage ueber die LINIE, und der Fall am Knopf ist die Linie
 * (avesmapsConflictRepairSpansNameGroup). Sonst wie bisher auf die eine Zeile.
 *
 * Die ZIELZEILE entscheidet ueber Annahme oder Ablehnung: sie ist die, auf die der Fall zeigt und
 * die der Editor gesehen hat. Geschwisterzeilen sind bestmoeglich -- eine, die Sicherheitsregel 1
 * oder 2 verletzt, wird uebersprungen. Jede geschriebene Zeile bekommt ihren eigenen
 * Protokolleintrag, wie bisher.
 *
 * $handledGroups ist der Gedaechtnisstrich EINES resolve-Aufrufs: welche Verbuende darin schon
 * geschrieben wurden (siehe avesmapsConflictRepairGroupKey).
 *
 * $protectedRowIds sind die Zeilen des BEHALTERS (avesmapsConflictProtectedRowIds) -- sie werden von
 * jedem Schreibvorgang ausgenommen, auch wenn ein Ziel sie ueber seinen Verbund mitfassen wuerde.
 * $maySpanNameGroup = false zieht den Verb auf die eine Zeile zurueck; siehe
 * avesmapsConflictResolveKeeper, warum das der sichere Rueckfall ist.
 *
 * @param array<int,bool> $protectedRowIds
 * @return array{ok:bool, public_id:string, changed:bool, written?:int, group?:string, protected?:bool, skipped?:list<array{public_id:string,reason:string}>, reason?:string}
 */
function avesmapsConflictUnlinkFeature(
    PDO $pdo,
    string $publicId,
    string $expectedUrl,
    bool $markNoArticle,
    int $userId,
    array &$handledGroups = [],
    array $protectedRowIds = [],
    bool $maySpanNameGroup = true
): array {
    $select = $pdo->prepare(
        "SELECT id, public_id, name, feature_type, properties_json FROM map_features
         WHERE public_id = :p AND is_active = 1 LIMIT 1"
    );
    $select->execute(['p' => $publicId]);
    $feature = $select->fetch(PDO::FETCH_ASSOC);
    if (!$feature) {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false, 'reason' => 'Objekt nicht gefunden.'];
    }

    $name = (string) ($feature['name'] ?? '');
    $featureType = (string) ($feature['feature_type'] ?? '');
    // 🔴 Die Zielzeile gehoert dem Behalter (oder seiner Linie): sie wird gar nicht angefasst. Das
    // ist keine Ablehnung -- der Aufrufer hat sie nur mitgeschickt, weil der Client den Behalter
    // als "alle anderen trennen" ausdrueckt und dabei nicht weiss, dass zwei Parteien zur selben
    // Linie gehoeren koennen.
    if (isset($protectedRowIds[(int) $feature['id']])) {
        return ['ok' => true, 'public_id' => $publicId, 'changed' => false, 'written' => 0,
            'protected' => true, 'name' => $name];
    }

    // ⚠️ Weiss diese Anfrage nichts ueber einen Behalter, faellt der Verb auf die eine Zeile
    // zurueck (avesmapsConflictResolveKeeper). Der leere Schluessel schaltet zugleich den
    // Gedaechtnisstrich ab -- ohne Verbund gibt es keinen zu merken.
    $groupKey = $maySpanNameGroup ? avesmapsConflictRepairGroupKey($featureType, $name) : '';

    // Ein zweites Segment DESSELBEN Verbundes im selben Aufruf: der erste hat ihn schon ganz
    // geschrieben. Das ist kein Fehler und darf keine Ablehnung ausloesen -- die Zeile stuende
    // danach nur noch mit ihrem Wiki-Nest da und liefe in Sicherheitsregel 1.
    if ($groupKey !== '' && isset($handledGroups[$groupKey])) {
        return ['ok' => true, 'public_id' => $publicId, 'changed' => false, 'written' => 0,
            'group' => $groupKey, 'name' => $name];
    }

    $targetProperties = json_decode((string) ($feature['properties_json'] ?? '{}'), true);
    if (!is_array($targetProperties)) {
        $targetProperties = [];
    }
    $targetRefusal = avesmapsConflictUnlinkRowRefusal($targetProperties, $expectedUrl);
    if ($targetRefusal !== '') {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false, 'reason' => $targetRefusal];
    }

    // Die Zeilen, auf die dieser Vorgang wirkt. Die Zielzeile ist bei der Verbund-Abfrage mit
    // dabei (gleiche Art, gleicher Name, aktiv), also wird sie nicht doppelt geschrieben.
    $rows = [$feature];
    if ($groupKey !== '') {
        $handledGroups[$groupKey] = true;
        $group = $pdo->prepare(
            "SELECT id, public_id, name, feature_type, properties_json FROM map_features
             WHERE feature_type = :t AND name = :n AND is_active = 1"
        );
        $group->execute(['t' => $featureType, 'n' => $name]);
        $groupRows = $group->fetchAll(PDO::FETCH_ASSOC);
        if ($groupRows !== []) {
            $rows = $groupRows;
        }
    }

    $revision = avesmapsNextMapRevision($pdo);
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev, updated_by = :by WHERE id = :id');
    $written = 0;
    // 🔴 Was der Vorgang AUSGELASSEN hat, samt Grund. Ohne diese Liste meldet ein Verbund-Schreiben
    // `ok:true`, obwohl eine Zeile stehen geblieben ist -- gemessen: ein Segment mit Wiki-Nest blieb
    // unangetastet, und der Editor sah nichts davon. Eine Antwort, die Vollzug meldet und dabei
    // etwas verschweigt, ist schlimmer als eine Fehlermeldung.
    $skipped = [];
    foreach ($rows as $row) {
        // ⚠️ ZWEITER GURT, und er ist mit Absicht redundant: da der Schutz den GANZEN Verbund
        // umfasst und die Verbund-Abfrage denselben Zuschnitt hat, ist eine geschuetzte Zeile hier
        // schon oben als Zielzeile abgefangen worden. Uebrig bleibt genau ein Fall, den der Test
        // NICHT nachstellen kann: eine Zeile, die zwischen der Schutz-Abfrage und dieser
        // Verbund-Abfrage entstanden ist (ein frisch angehaengtes Segment erbt den wiki_url seiner
        // Linie, koennte den Anspruch also bereits tragen). Eine Mutation dieser Zeile allein
        // ueberlebt den Test deshalb -- das ist benannt, nicht uebersehen.
        //
        // ⚠️ Eine geschuetzte Zeile ist KEINE ausgelassene: sie soll ihren Anspruch behalten, das
        // ist der ganze Sinn von "Behält den Link". Sie gehoert deshalb nicht in $skipped -- sonst
        // meldete jeder Behalten-Klick eine Warnung ueber genau das, was er bewirken sollte.
        if (isset($protectedRowIds[(int) $row['id']])) {
            continue;
        }
        $properties = json_decode((string) ($row['properties_json'] ?? '{}'), true);
        if (!is_array($properties)) {
            $properties = [];
        }
        $rowRefusal = avesmapsConflictUnlinkRowRefusal($properties, $expectedUrl);
        if ($rowRefusal !== '') {
            $skipped[] = ['public_id' => (string) ($row['public_id'] ?? ''), 'reason' => $rowRefusal];
            continue;
        }
        $before = json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        unset($properties[AVESMAPS_CONFLICT_CLAIM_FIELD]);
        if ($markNoArticle) {
            $properties[AVESMAPS_CONFLICT_NO_ARTICLE_FLAG] = true;
        } else {
            unset($properties[AVESMAPS_CONFLICT_NO_ARTICLE_FLAG]);
        }

        $update->execute([
            'pj' => json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'rev' => $revision,
            'by' => $userId > 0 ? $userId : null,
            'id' => (int) $row['id'],
        ]);
        $written++;

        avesmapsWriteMapAuditLog(
            $pdo,
            (int) $row['id'],
            $markNoArticle ? 'conflict_no_article' : 'conflict_unlink',
            $userId,
            (string) $before,
            (string) json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );
    }

    return ['ok' => true, 'public_id' => $publicId, 'changed' => $written > 0, 'written' => $written,
        'group' => $groupKey, 'name' => $name, 'skipped' => $skipped];
}

/**
 * REIN: Darf diese Zeile verknuepft werden? '' = ja, sonst die Begruendung.
 *
 * Verknuepfen ist fuer den LEEREN Fall; einen vorhandenen Anspruch still zu ueberschreiben ist,
 * wie falsche Links sich ueberhaupt erst ausbreiten. Je ZEILE geprueft, damit eine Geschwisterzeile
 * mit eigenem Anspruch uebersprungen wird, statt den ganzen Vorgang abzubrechen.
 *
 * 💣 Sicherheitsregel 1 gilt HIER GENAUSO. Bis 15.08.2026 fragte diese Pruefung nur das schlichte
 * Feld: eine Zeile, deren Anspruch im Wiki-Nest steckt, bekam ein `wiki_url` obendrauf -- und weil
 * avesmapsConflictExtractClaim das schlichte Feld gewinnen laesst, war das Nest damit lautlos
 * ueberstimmt. Beim Trennen ist genau das verboten (der Anspruch haengt an der ganzen Infobox und
 * gehoert seinem eigenen Editor); beim Verknuepfen darf es nicht erlaubt sein. Dieselbe Frage,
 * dieselbe Antwort, derselbe Wortlaut.
 */
function avesmapsConflictLinkRowRefusal(array $properties): string {
    $claim = avesmapsConflictExtractClaim($properties);
    if ($claim['claim_source'] === AVESMAPS_CONFLICT_CLAIM_FIELD) {
        return 'Dieses Objekt trägt bereits eine Verknüpfung — bitte erst trennen.';
    }
    if ($claim['claim_source'] !== '') {
        return 'Diese Verknüpfung stammt aus der Wiki-Zuordnung. Bitte im zuständigen Editor lösen — dort hängt die ganze Infobox dran.';
    }

    return '';
}

/**
 * Link an object to the wiki article that carries its exact name.
 *
 * The candidate is looked up HERE, from the object's own stored name -- never taken from the
 * request. A client-supplied URL would let anything set any link, and this endpoint writes real map
 * data; the client only says WHICH object to link, the server decides to what.
 *
 * Bei einer segmentierten Art (Weg, Kraftlinie) wirkt das auf ALLE aktiven Segmente desselben
 * Namens -- dieselbe Weiche und dieselbe Gruppenabfrage wie beim Trennen
 * (avesmapsConflictRepairSpansNameGroup). 🔴 Owner-Entscheid 15.08.2026, und der Grund ist die
 * ASYMMETRIE: "Artikel uebernehmen" steht an denselben nach Namen zusammengefassten
 * wiki.missing_key-Faellen wie "Kein Wiki-Eintrag". Reichte der eine Knopf ueber die Linie und der
 * andere ueber ein Segment, liesse sich eine Linie ganz loesen, aber nur zu einem Sechstel
 * verknuepfen -- und das saehe aus wie "der Link hat nicht gegriffen".
 *
 * ⚠️ Die Zuordnung bleibt dabei eindeutig: der Artikel wird ueber den EIGENEN Namen des Objekts
 * gesucht, und alle Segmente einer Linie tragen denselben. Es wird also nichts geraten, was nicht
 * schon fuer die Zielzeile galt.
 *
 * Refuses when the object already claims something: linking is for the empty case, and silently
 * overwriting an existing claim is how wrong links spread in the first place. Die ZIELZEILE
 * entscheidet ueber Annahme oder Ablehnung; eine Geschwisterzeile mit eigenem Anspruch wird
 * uebersprungen.
 *
 * @return array{ok:bool, public_id:string, changed:bool, written?:int, group?:string, reason?:string}
 */
function avesmapsConflictLinkFeature(PDO $pdo, string $publicId, array $wikiTitles, int $userId, array &$handledGroups = []): array {
    $select = $pdo->prepare(
        "SELECT id, public_id, name, feature_type, properties_json FROM map_features
         WHERE public_id = :p AND is_active = 1 LIMIT 1"
    );
    $select->execute(['p' => $publicId]);
    $feature = $select->fetch(PDO::FETCH_ASSOC);
    if (!$feature) {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false, 'reason' => 'Objekt nicht gefunden.'];
    }

    // 💣 ROH fuer die Gruppenabfrage (so steht der Name in der Spalte), GETRIMMT fuer die
    // Artikelsuche (so kommt er aus avesmapsConflictLoadWikiTitles). Die beiden zu vertauschen
    // hiesse: entweder findet die Abfrage die Geschwister nicht, oder der Artikel wird verfehlt.
    $name = (string) ($feature['name'] ?? '');
    $lookupName = trim($name);
    $featureType = (string) ($feature['feature_type'] ?? '');
    $groupKey = avesmapsConflictRepairGroupKey($featureType, $name);

    // Ein zweites Segment DESSELBEN Verbundes im selben Aufruf: der erste hat ihn schon ganz
    // verknuepft. Ohne diesen Halt liefe die Zeile in "traegt bereits eine Verknuepfung" -- die der
    // erste Aufruf gerade selbst geschrieben hat.
    if ($groupKey !== '' && isset($handledGroups[$groupKey])) {
        return ['ok' => true, 'public_id' => $publicId, 'changed' => false, 'written' => 0,
            'group' => $groupKey, 'name' => $lookupName];
    }

    $targetProperties = json_decode((string) ($feature['properties_json'] ?? '{}'), true);
    if (!is_array($targetProperties)) {
        $targetProperties = [];
    }
    $targetRefusal = avesmapsConflictLinkRowRefusal($targetProperties);
    if ($targetRefusal !== '') {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false, 'reason' => $targetRefusal];
    }

    $candidate = $wikiTitles[mb_strtolower($lookupName, 'UTF-8')] ?? null;
    if ($candidate === null || trim((string) ($candidate['url'] ?? '')) === '') {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false,
            'reason' => 'Zu diesem Namen gibt es im Wiki keinen exakt passenden Artikel (mehr).'];
    }
    $wikiUrl = (string) $candidate['url'];

    // Die Zeilen, auf die dieser Vorgang wirkt. Die Zielzeile ist bei der Verbund-Abfrage mit
    // dabei (gleiche Art, gleicher Name, aktiv), also wird sie nicht doppelt geschrieben.
    $rows = [$feature];
    if ($groupKey !== '') {
        $handledGroups[$groupKey] = true;
        $group = $pdo->prepare(
            "SELECT id, public_id, name, feature_type, properties_json FROM map_features
             WHERE feature_type = :t AND name = :n AND is_active = 1"
        );
        $group->execute(['t' => $featureType, 'n' => $name]);
        $groupRows = $group->fetchAll(PDO::FETCH_ASSOC);
        if ($groupRows !== []) {
            $rows = $groupRows;
        }
    }

    $revision = avesmapsNextMapRevision($pdo);
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev, updated_by = :by WHERE id = :id');
    $written = 0;
    // Was ausgelassen wurde, samt Grund -- siehe avesmapsConflictUnlinkFeature: eine Antwort, die
    // Vollzug meldet und dabei etwas verschweigt, ist schlimmer als eine Fehlermeldung.
    $skipped = [];
    foreach ($rows as $row) {
        $properties = json_decode((string) ($row['properties_json'] ?? '{}'), true);
        if (!is_array($properties)) {
            $properties = [];
        }
        $rowRefusal = avesmapsConflictLinkRowRefusal($properties);
        if ($rowRefusal !== '') {
            $skipped[] = ['public_id' => (string) ($row['public_id'] ?? ''), 'reason' => $rowRefusal];
            continue;
        }
        $before = json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $properties[AVESMAPS_CONFLICT_CLAIM_FIELD] = $wikiUrl;
        // Eine Verknüpfung widerlegt die Aussage "hat keinen Artikel" -- sonst blieben beide stehen.
        unset($properties[AVESMAPS_CONFLICT_NO_ARTICLE_FLAG]);

        $update->execute([
            'pj' => json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'rev' => $revision,
            'by' => $userId > 0 ? $userId : null,
            'id' => (int) $row['id'],
        ]);
        $written++;

        avesmapsWriteMapAuditLog(
            $pdo,
            (int) $row['id'],
            'conflict_link',
            $userId,
            (string) $before,
            (string) json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );
    }

    return ['ok' => true, 'public_id' => $publicId, 'changed' => $written > 0, 'written' => $written,
        'group' => $groupKey, 'name' => $lookupName, 'wiki_url' => $wikiUrl, 'skipped' => $skipped];
}

/**
 * REIN: Hat dieser Reparatur-Aufruf wirklich etwas repariert -- darf also „erledigt" verbucht werden?
 *
 * 💣 Der Endpunkt schrieb die Entscheidung bisher nach JEDEM `resolve`, auch nach einem, der nichts
 * geaendert hat. Damit verlaesst ein Fall die Liste „Offen" und steht unter „Archiviert" (der Status
 * faellt aus „Konflikt besteht weiter" + „jemand hat entschieden"), obwohl niemand ihn angefasst
 * hat. Bei den Wiki-Verben war das schwer zu bemerken; beim Loeschen ist es ein Loch mit Ansage:
 * eine flaechengebundene Beschriftung wird abgelehnt, der Editor sieht die Fehlermeldung -- und der
 * Fall waere trotzdem aus seiner Liste verschwunden.
 *
 * ⚠️ Das gilt fuer ALLE Verben, nicht nur fuer das neue. Eine Regel, die einen von vier Erzeugern
 * bindet, ist keine Regel (AGENTS.md §11) -- und „verbuche nur, was du getan hast" ist bei jedem
 * einzelnen richtig. Folge fuer die uebrigen: ein Klick, der auf Sicherheitsregel 1 laeuft und
 * nichts schreibt, laesst den Fall jetzt offen stehen, statt ihn stumm zu archivieren.
 */
function avesmapsConflictShouldRecordRepair(array $result): bool {
    return (int) ($result['applied'] ?? 0) > 0;
}

/**
 * REIN: Darf diese Beschriftung aus dem Konfliktzentrum GELOESCHT werden? '' = ja, sonst der Grund.
 *
 * 💣 DIE ZWEITE BEDINGUNG IST DER GANZE GRUND, WARUM ES DIESE FUNKTION GIBT. Eine Beschriftung zu
 * loeschen kann ihre ganze Landschaft mitnehmen: entfernt ein Loeschvorgang das LETZTE Label einer
 * Region, deaktiviert avesmapsEcosystemCascadeAfterRemoval die Region samt ihren gezeichneten
 * Flaechen (api/_internal/app/ecosystem.php, AVESMAPS_ECOSYSTEM_CASCADE_ENABLED = true). Am
 * Livebestand hat fast jede Region genau ein Label -- der Ausloesefall IST der Normalfall. Der
 * Auftrag lautet: ein Loeschknopf, der eine Dublette wegraeumt, darf unter keinen Umstaenden eine
 * Flaeche mitreissen. Also wird eine flaechengebundene Beschriftung hier gar nicht erst geloescht --
 * sie gehoert in den Landschaften-Editor, der die Folgen kennt und ankuendigt.
 *
 * 🔴 UND SIE SCHLAEGT FEHL IN RICHTUNG ABSAGE. `$regionLookupReady = false` heisst „ich konnte nicht
 * nachsehen", nicht „es haengt nichts dran". Ein Ausfall, der still in die gefaehrliche Richtung
 * kippt, ist genau die Bauart, an der das Projekt schon einmal Daten verloren hat (die stille
 * MySQL-Kuerzung, AGENTS.md §10).
 *
 * Die letzte Beschriftung eines Objekts bleibt stehen: „Dublette aufraeumen" darf einem Ding nicht
 * seinen Namen nehmen. Ein Fall in der Liste hat immer mindestens zwei Parteien, ueber die
 * Oberflaeche ist dieser Zustand also gar nicht erreichbar -- der Riegel gilt dem direkten Aufruf.
 *
 * @param string $featureType              map_features.feature_type der Zielzeile
 * @param bool   $regionLookupReady        stand die Landschaften-Pruefung ueberhaupt zur Verfuegung?
 * @param string $ecosystemRegionPublicId  '' = haengt an keiner Landschaftsflaeche
 * @param int    $twinsLeft                wie viele Beschriftungen desselben Dings danach bleiben
 */
function avesmapsConflictLabelDeleteRefusal(
    string $featureType,
    bool $regionLookupReady,
    string $ecosystemRegionPublicId,
    int $twinsLeft
): string {
    if ($featureType !== 'label') {
        return 'Hier lassen sich nur Beschriftungen löschen.';
    }
    if (!$regionLookupReady) {
        return 'Die Landschaften-Prüfung steht gerade nicht zur Verfügung — es wird nichts gelöscht.';
    }
    if (trim($ecosystemRegionPublicId) !== '') {
        return 'Diese Beschriftung gehört zu einer Landschaftsfläche. Wäre sie deren letzte, verschwände die ganze Fläche mit ihr — bitte im Landschaften-Editor lösen.';
    }
    if ($twinsLeft < 1) {
        return 'Das ist die letzte Beschriftung dieses Objekts — sie bleibt stehen.';
    }

    return '';
}

/**
 * REIN: Wie viele ANDERE aktive Beschriftungen meinen dasselbe Ding wie diese Zeile?
 *
 * Gerechnet ueber avesmapsConflictLabelIdentity, also mit derselben Regel, nach der der Erkenner
 * seine Faelle bildet -- eine zweite waere eine zweite Wahrheit. Eine Zeile ohne Identitaet (kein
 * Wiki-Schluessel) hat per Definition keine Zwillinge; sie wird vom Erkenner nie gemeldet und faellt
 * hier zusaetzlich in die Absage „letzte Beschriftung".
 *
 * @param list<array{public_id:string,name:string,feature_subtype:string,wiki_key:string}> $labels
 */
function avesmapsConflictLabelTwinsLeft(array $labels, string $publicId): int {
    $identityOf = static fn(array $row): string => avesmapsConflictLabelIdentity(
        (string) ($row['wiki_key'] ?? ''),
        (string) ($row['name'] ?? ''),
        (string) ($row['feature_subtype'] ?? '')
    );

    $own = '';
    foreach ($labels as $row) {
        if ((string) ($row['public_id'] ?? '') === $publicId) {
            $own = $identityOf($row);
            break;
        }
    }
    if ($own === '') {
        return 0;
    }

    $count = 0;
    foreach ($labels as $row) {
        if ((string) ($row['public_id'] ?? '') !== $publicId && $identityOf($row) === $own) {
            $count++;
        }
    }

    return $count;
}

/**
 * Alle aktiven Beschriftungen, so schlank wie der Zwillingszaehler sie braucht.
 *
 * @return list<array{public_id:string,name:string,feature_subtype:string,wiki_key:string}>
 */
function avesmapsConflictReadLabelIdentities(PDO $pdo): array {
    $statement = $pdo->query(
        "SELECT public_id, name, feature_subtype, properties_json FROM map_features
         WHERE feature_type = 'label' AND is_active = 1"
    );
    if ($statement === false) {
        return [];
    }

    $rows = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $properties = json_decode((string) ($row['properties_json'] ?? '{}'), true);
        $rows[] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'feature_subtype' => (string) ($row['feature_subtype'] ?? ''),
            'wiki_key' => is_array($properties) ? trim((string) ($properties['wiki_region']['wiki_key'] ?? '')) : '',
        ];
    }

    return $rows;
}

/**
 * Eine ueberzaehlige Beschriftung von der Karte nehmen -- das Verb, das Discord #83 braucht.
 *
 * 🔴 WARUM DAS UEBERHAUPT HIER STEHT UND NICHT AUF DER KARTE: eine Beschriftung, die die
 * Label-Kollision verliert, wird nicht gezeichnet, und was nicht gezeichnet ist, laesst sich nicht
 * anklicken -- kein Klick, kein Rechtsklick, kein Loeschen. Die Owner-Regel von den verwaisten
 * Aussenhuellen gilt hier genauso: „es darf doch auf der map keine elemente geben ueber die ich
 * keine kontrolle mehr habe."
 *
 * 🔴 UND DIE KASKADE WIRD NICHT UMGANGEN, SONDERN UNMOEGLICH GEMACHT. Gefragt wird
 * avesmapsEcosystemRegionPublicIdOfLabel() -- DIESELBE Funktion mit denselben Argumenten, an der
 * avesmapsDeleteMapFeature() selbst entscheidet, ob es die Kaskade anstoesst
 * (api/_internal/map/features.php: `if ($regionPublicId !== '') { $cascade = … }`). Liefert sie
 * hier den leeren Wert, kann der Kaskadenzweig dort nicht genommen werden; liefert sie einen Wert,
 * kommt es gar nicht erst zum Loeschen. Eine EIGENE, strengere oder mildere Rechnung waere genau
 * der Fehler, den avesmapsPoliticalDerivedHullIsSourceless bei den verwaisten Aussenhuellen
 * ausdruecklich vermeidet (AGENTS.md §11).
 *
 * ⚠️ `function_exists` statt `require`: dieselbe Bauform wie in avesmapsDeleteMapFeature, damit die
 * reinen Einheitentests dieses Verzeichnisses die Landschaften-Bibliothek nicht mitschleppen. Der
 * Endpunkt api/edit/map/conflicts.php zieht sie ausdruecklich herein, die Bedingung ist dort also
 * nie falsch. Fehlt sie doch, wird NICHT geloescht (avesmapsConflictLabelDeleteRefusal).
 *
 * Geloescht wird durch avesmapsDeleteMapFeature() -- die kanonische Strasse mit Revisionszaehler,
 * Sperrpruefung, Kraftlinien-Riegel und Protokollzeile. Umkehrbar wie jedes Loeschen im Editor.
 *
 * @return array{ok:bool, public_id:string, changed:bool, name?:string, reason?:string}
 */
function avesmapsConflictDeleteLabel(PDO $pdo, string $publicId, int $userId): array {
    // 🔴 Fuer avesmapsEcosystemRegionPublicIdOfLabel() -- den Riegel vor der Landschafts-Kaskade.
    // AUSDRUECKLICH hier und nicht beim Endpunkt: eine Verdrahtung, die jemand vergessen kann, waere
    // ein stiller Ausfall in der gefaehrlichen Richtung. Der `function_exists`-Gurt unten bleibt
    // trotzdem stehen -- er faengt ab, wenn diese Zeile eines Tages verschwindet.
    //
    // ⚠️ IM RUMPF, nicht im Dateikopf, und das ist der teure Teil: ecosystem.php zieht mit seinen
    // Nachbarn rund 292 KB Quelltext nach (gemessen 20.08.2026: repair.php-Kette 654 KB mit, 362 KB
    // ohne). Im Kopf zahlte das JEDE Aktion dieses Endpunkts, auch `list` -- und die ist ohnehin die
    // teuerste (voller Tabellenlauf ueber map_features, AGENTS.md §10 fuehrt sie als Hotspot).
    // Hausform: api/_internal/map/features.php bei avesmapsApplyPathWikiNoArticleToNameGroup.
    require_once __DIR__ . '/../app/ecosystem.php';

    $select = $pdo->prepare(
        "SELECT public_id, name, feature_type, properties_json FROM map_features
         WHERE public_id = :p AND is_active = 1 LIMIT 1"
    );
    $select->execute(['p' => $publicId]);
    $feature = $select->fetch(PDO::FETCH_ASSOC);
    if (!$feature) {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false, 'reason' => 'Objekt nicht gefunden.'];
    }

    $properties = json_decode((string) ($feature['properties_json'] ?? '{}'), true);
    if (!is_array($properties)) {
        $properties = [];
    }

    // ⚠️ DER `catch` MACHT AUS EINEM FEHLER EINE ABSAGE, NICHT EIN „ES HAENGT NICHTS DRAN".
    // avesmapsEcosystemRegionPublicIdOfLabel() fragt `ecosystem_region` ohne eigenes try/catch: auf
    // einer Installation ohne die Landschaften-Tabellen fliegt dort eine PDOException, und die kam
    // hier als HTTP 500 heraus. Ein 500 ist zwar die sichere Richtung -- geloescht wird nichts --,
    // aber der Editor liest daraus „kaputt" statt „geht hier nicht". Wichtig ist die Richtung: der
    // Fehler wird NICHT zu einem leeren Ergebnis (das hiesse „keine Flaeche daran" und gaebe den
    // Loeschknopf frei), sondern zu demselben `false`, das auch ein fehlendes function_exists setzt.
    // Protokolliert wird trotzdem -- ein stiller catch ist genau die Bauart, die AGENTS.md §11
    // als „verschluckt seither jeden SQL-Fehler" anschreibt.
    $regionLookupReady = function_exists('avesmapsEcosystemRegionPublicIdOfLabel');
    $regionPublicId = '';
    if ($regionLookupReady) {
        try {
            $regionPublicId = avesmapsEcosystemRegionPublicIdOfLabel($pdo, $publicId, $properties);
        } catch (Throwable $exception) {
            error_log('conflict label delete: Landschaften-Pruefung fehlgeschlagen: ' . $exception->getMessage());
            $regionLookupReady = false;
        }
    }

    // ⚠️ ZWEI DURCHGAENGE, damit der teure Zaehler nur laeuft, wenn er noch etwas entscheidet.
    // avesmapsConflictReadLabelIdentities liest ALLE aktiven Beschriftungen (live 909) und steht in
    // der Zielschleife von avesmapsConflictResolve -- eager ausgewertet lief er auch dann, wenn die
    // Absage laengst durch „ist keine Beschriftung" oder „haengt an einer Flaeche" feststand.
    //
    // 🔴 Die REIHENFOLGE der Riegel steht weiterhin NUR in der reinen Funktion, und dieser
    // Vorlauf schreibt sie nicht ab: er ruft sie mit „es gibt Zwillinge" auf und liest ab, ob einer
    // der davorstehenden Riegel schon greift. Wer die Ordnung dort aendert, aendert sie damit hier
    // mit -- eine zweite Abschrift der drei Bedingungen waere die zweite Wahrheit.
    $featureType = (string) ($feature['feature_type'] ?? '');
    $refusal = avesmapsConflictLabelDeleteRefusal($featureType, $regionLookupReady, $regionPublicId, 1);
    if ($refusal === '') {
        $refusal = avesmapsConflictLabelDeleteRefusal(
            $featureType,
            $regionLookupReady,
            $regionPublicId,
            avesmapsConflictLabelTwinsLeft(avesmapsConflictReadLabelIdentities($pdo), $publicId)
        );
    }
    if ($refusal !== '') {
        return ['ok' => false, 'public_id' => $publicId, 'changed' => false,
            'name' => (string) ($feature['name'] ?? ''), 'reason' => $refusal];
    }

    // 🔴 DIE FAHNE IST DER EIGENTLICHE RIEGEL. Die Pruefung oben ist BERATEND -- sie laeuft im
    // Autocommit, vor der Transaktion des Loeschwegs, und `ecosystem_region.label_public_id` kann
    // sich dazwischen aendern, ohne dass die Label-Zeile angefasst wird (das FOR UPDATE deckt sie
    // also nicht). Mit `refuse_ecosystem_cascade` steht die Regel INNERHALB der Transaktion, hinter
    // dem FOR UPDATE, und jeder kuenftige Erzeuger erbt sie -- statt sich daran erinnern zu muessen.
    // Sie wirft dann, statt zu kaskadieren; der Wurf rollt die Deaktivierung mit zurueck.
    // ⚠️ Der beratende Riegel bleibt trotzdem: er liefert die verstaendliche Absage im Normalfall
    // (und die Anzeige `deletable` haengt an derselben Frage). Der Wurf ist der seltene Rennfall.
    avesmapsDeleteMapFeature($pdo, ['public_id' => $publicId, 'refuse_ecosystem_cascade' => true], ['id' => $userId]);

    return ['ok' => true, 'public_id' => $publicId, 'changed' => true, 'name' => (string) ($feature['name'] ?? '')];
}

/**
 * Apply one resolution across a conflict's parties, in a transaction.
 *
 * mode 'unlink'   -- drop the claim on every target
 * mode 'no_wiki'  -- drop it AND record that there is no article (makes the removal stick)
 * mode 'link'     -- attach the article carrying the object's exact name (looked up server-side)
 * mode 'delete_label' -- eine ueberzaehlige Beschriftung von der Karte nehmen (Discord #83)
 *
 * "Behält den Link" is expressed by the caller as: unlink every party EXCEPT the keeper.
 *
 * 🔴 Das allein REICHT NICHT MEHR, und der Satz, der frueher hier stand ("the keeper is never
 * written to"), war seit der Reichweitenaenderung falsch. Solange jedes Ziel nur seine eigene Zeile
 * traf, genuegte es, den Behalter wegzulassen. Seit ein Ziel den ganzen Namensverbund fasst, zieht
 * ein Geschwistersegment ihn mit hinein -- gemessen: sechs Segmente, ein Klick, danach traegt
 * NIEMAND mehr den Artikel, und es meldete Erfolg. Der Behalter wird deshalb jetzt ausdruecklich
 * ermittelt (avesmapsConflictResolveKeeper) und samt seiner ganzen Linie von jedem Schreibvorgang
 * dieses Aufrufs ausgenommen (avesmapsConflictProtectedRowIds).
 *
 * @return array{ok:bool, applied:int, results:list<array<string,mixed>>}
 */
function avesmapsConflictResolve(PDO $pdo, array $input, int $userId): array {
    $mode = trim((string) ($input['mode'] ?? ''));
    if (!in_array($mode, ['unlink', 'no_wiki', 'link', 'delete_label'], true)) {
        throw new RuntimeException('Unbekannter Reparatur-Modus.');
    }
    $targets = is_array($input['targets'] ?? null) ? $input['targets'] : [];
    if ($targets === []) {
        throw new RuntimeException('Keine Ziele angegeben.');
    }

    // 🔴 EIGENE BAHN, VOR der gemeinsamen Transaktion. avesmapsDeleteMapFeature() oeffnet seine
    // eigene -- PDO kennt keine geschachtelten, ein beginTransaction() darum herum wuerde werfen.
    // Jede Beschriftung ist damit fuer sich atomar, und das genuegt: der Knopf steht an EINER Partei
    // und schickt genau eine. Der Verbund-Apparat der uebrigen Verben gilt hier ausdruecklich nicht
    // -- eine Beschriftung ist eine Zeile, kein Namensverbund (avesmapsConflictRepairSpansNameGroup
    // sagt fuer 'label' seit jeher false), und „alle gleichnamigen loeschen" waere das Gegenteil
    // dessen, was dieser Fall will.
    if ($mode === 'delete_label') {
        $results = [];
        $applied = 0;
        foreach ($targets as $target) {
            $publicId = trim((string) ($target['id'] ?? ''));
            if ($publicId === '') {
                continue;
            }
            $result = avesmapsConflictDeleteLabel($pdo, $publicId, $userId);
            $results[] = $result;
            if (!empty($result['changed'])) {
                $applied++;
            }
        }

        return ['ok' => true, 'applied' => $applied, 'results' => $results];
    }
    $expectedUrl = trim((string) ($input['wiki_url'] ?? ''));
    // Nur fuer 'link' gebraucht, und bewusst SERVERSEITIG geholt statt aus der Anfrage.
    $wikiTitles = $mode === 'link' ? avesmapsConflictLoadWikiTitles($pdo) : [];

    // Der Behalter und seine Linie -- die Zeilen, die dieser Aufruf unter keinen Umstaenden anfasst.
    // Beim Verknuepfen gibt es keinen Behalter: "Behält den Link" ist ein Trenn-Vorgang.
    $targetPublicIds = [];
    foreach ($targets as $target) {
        $targetPublicId = trim((string) ($target['id'] ?? ''));
        if ($targetPublicId !== '') {
            $targetPublicIds[] = $targetPublicId;
        }
    }
    $keeper = $mode === 'link' ? ['keeper' => '', 'known' => true] : avesmapsConflictResolveKeeper($input, $targetPublicIds);
    $protectedRowIds = $keeper['keeper'] !== '' ? avesmapsConflictProtectedRowIds($pdo, $keeper['keeper']) : [];
    // ⚠️ Sagt die Anfrage gar nichts ueber einen Behalter (ein Client, den wir nicht kennen), wird
    // beim Trennen NICHT nach Verbund geschrieben. Lieber zu wenig getroffen als der Datenverlust,
    // den avesmapsConflictResolveKeeper beschreibt.
    $maySpanNameGroup = $keeper['known'];

    $results = [];
    $applied = 0;
    // Welche Namensverbuende dieser EINE Aufruf schon geschrieben hat. Bei einer segmentierten Art
    // trifft ein Ziel den ganzen Verbund, und ein geteilter Artikel schickt dessen Segmente einzeln.
    // Gilt fuer BEIDE Verben -- `mode` ist je Aufruf einer, sie teilen sich den Strich also gefahrlos.
    $handledGroups = [];
    $pdo->beginTransaction();
    try {
        foreach ($targets as $target) {
            $publicId = trim((string) ($target['id'] ?? ''));
            if ($publicId === '') {
                continue;
            }
            $result = $mode === 'link'
                ? avesmapsConflictLinkFeature($pdo, $publicId, $wikiTitles, $userId, $handledGroups)
                : avesmapsConflictUnlinkFeature(
                    $pdo,
                    $publicId,
                    $expectedUrl,
                    $mode === 'no_wiki',
                    $userId,
                    $handledGroups,
                    $protectedRowIds,
                    $maySpanNameGroup
                );
            $results[] = $result;
            if (!empty($result['changed'])) {
                $applied++;
            }
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    return ['ok' => true, 'applied' => $applied, 'results' => $results];
}
