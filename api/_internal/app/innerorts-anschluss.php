<?php

declare(strict_types=1);

/**
 * Innerorts -- der ANSCHLUSS der Bibliothek an Endpunkte, Kartennutzlast und Suche.
 * ===========================================================================
 * `api/_internal/app/innerorts.php` ist die Bibliothek (Feld, Gesten, Staettenquelle, Admin-Lauf).
 * Diese Datei verdrahtet sie: update_point, die Wiki-Zuweisungswege, die Editor-Endpunkte und die
 * Kartensuche. Sie steht getrennt, damit jede dieser Naehte OHNE einen Endpunkt pruefbar ist (ein
 * Endpunkt laesst sich nicht einbinden, ohne eine Anfrage auszufuehren).
 *
 * Entwurf: docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md §3-§7
 * Plan:    docs/superpowers/plans/2026-09-27-innerorts-schritt-1.md, Task 2
 *
 * 🔴 GESPEICHERT IST, WAS GILT (Spec §5). Die Leser hier (Staettenliste, Suche) lesen
 * `properties.innerorts`; den Wiki-Stand rechnen nur die SCHREIBER nach (update_point bei ↺, die
 * Zuweisungswege ueber avesmapsInnerortsNachZuweisung) und der Editor, der ihn zum Vergleich ZEIGT.
 */

require_once __DIR__ . '/innerorts.php';

/**
 * Eine gespeicherte Zeile vollstaendig lesen -- UNABHAENGIG von `is_active` und ohne Sperre (fuer
 * Vorpruefungen und fuer die Antwort NACH einer Geste). Faellt offen aus: null.
 */
function avesmapsInnerortsZeileLesen(PDO $pdo, string $publicId): ?array
{
    $publicId = trim($publicId);
    if ($publicId === '') {
        return null;
    }
    try {
        $statement = $pdo->prepare(
            'SELECT id, public_id, feature_type, feature_subtype, name, geometry_type, geometry_json,
                    properties_json, style_json, revision, is_active
               FROM map_features WHERE public_id = :pid LIMIT 1'
        );
        $statement->execute(['pid' => $publicId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return null;
    }

    return is_array($row) ? $row : null;
}

/**
 * Die Sperre eines Punktes pruefen, bevor eine Geste ihn anfasst -- dieselbe Pruefung wie beim
 * Loeschen (`avesmapsAssertFeatureCanBeEdited`: Revision und fremde Bearbeitungssperre).
 *
 * ⚠️ VOR der Transaktion der Bibliothek, nicht darin: die Gesten oeffnen ihre eigene Transaktion
 * (innerorts.php), eine zweite darum waere eine verschachtelte. Das Fenster zwischen Pruefung und
 * Schreiben ist dasselbe, das jeder Sperr-Wecker ohnehin hat -- die Sperre ist eine Absprache
 * zwischen Editoren, kein Datenbankriegel.
 *
 * @return array{ok:false, code:string, message:string}|null null = darf bearbeitet werden
 */
function avesmapsInnerortsSperreFehler(PDO $pdo, array $payload, string $publicId, array $user): ?array
{
    $zeile = avesmapsInnerortsZeileLesen($pdo, $publicId);
    if ($zeile === null) {
        return avesmapsInnerortsFehler('not_found', 'Das Kartenobjekt wurde nicht gefunden.');
    }
    if (!function_exists('avesmapsAssertFeatureCanBeEdited')) {
        throw new RuntimeException('avesmapsAssertFeatureCanBeEdited fehlt -- api/_internal/map/features.php'
            . ' muss vor dieser Datei geladen sein.');
    }
    try {
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $zeile, $user);
    } catch (AvesmapsConflictException $konflikt) {
        // Der Satz stammt aus unserer eigenen Pruefung („wird gerade von X bearbeitet") -- kein
        // Ausnahmetext eines Treibers.
        return avesmapsInnerortsFehler('conflict', $konflikt->getMessage());
    }

    return null;
}

/**
 * Name UND Ortsklasse zu einer public_id -- nur aktive Siedlungspunkte (Dorf...Metropole).
 * `''`/`''` = keiner (bzw. nicht mehr aktiv). EINE Abfrage fuer beide Werte, damit ein Leser, der
 * nur den Namen braucht (avesmapsInnerortsStadtName), keine zweite Rundreise kostet.
 *
 * @return array{name:string, feature_subtype:string}
 */
function avesmapsInnerortsStadtInfo(PDO $pdo, string $ortId): array
{
    $leer = ['name' => '', 'feature_subtype' => ''];
    $ortId = trim($ortId);
    if ($ortId === '') {
        return $leer;
    }
    $platzhalter = [];
    $werte = ['ort' => $ortId];
    foreach (AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES as $i => $subtype) {
        $platzhalter[] = ':sub' . $i;
        $werte['sub' . $i] = $subtype;
    }
    try {
        $statement = $pdo->prepare(
            "SELECT name, feature_subtype FROM map_features WHERE public_id = :ort AND feature_type = 'location'
              AND is_active = 1 AND feature_subtype IN (" . implode(', ', $platzhalter) . ')'
        );
        $statement->execute($werte);
        $zeile = $statement->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return $leer;
    }
    if (!is_array($zeile)) {
        return $leer;
    }

    return [
        'name' => is_string($zeile['name'] ?? null) ? $zeile['name'] : '',
        'feature_subtype' => is_string($zeile['feature_subtype'] ?? null) ? $zeile['feature_subtype'] : '',
    ];
}

/**
 * Der Stadtname zu einer public_id -- Ruecksicht auf die aelteren Aufrufer, die nur den Namen
 * brauchen (take_off_map-Antwort, `⇄` Umhaengen). '' = keiner.
 */
function avesmapsInnerortsStadtName(PDO $pdo, string $ortId): string
{
    return avesmapsInnerortsStadtInfo($pdo, $ortId)['name'];
}

/**
 * Die Anzeige-Art eines innerorts-Punkts -- dieselbe Regel wie in avesmapsInnerortsPunkteFuerStaetten
 * (Stadtviertel heisst „Stadtviertel", ein Bauwerk traegt seine Ortsart).
 */
function avesmapsInnerortsPunktArt(string $subtype, array $properties): string
{
    return $subtype === 'stadtviertel' ? 'Stadtviertel' : trim((string) ($properties['place_kind'] ?? ''));
}

/**
 * Die Wiki-Adresse eines Punkts -- die ZUWEISUNG zuerst, das flache Feld nur als Rueckfall.
 * 🔴 Dieselbe Reihenfolge wie avesmapsInnerortsPunkteFuerStaetten und wie die Karte
 * (avesmapsConflictExtractClaim, api/_internal/conflicts/core.php: „zuweisung im wiki gewinnt").
 * Nur so trifft der Artikel-Schluessel eines Punkts den der abgeleiteten Staette (deren Adresse
 * kommt aus derselben Registry wie die Zuweisung).
 */
function avesmapsInnerortsPunktWikiUrl(array $properties): string
{
    $wikiSettlement = is_array($properties['wiki_settlement'] ?? null) ? $properties['wiki_settlement'] : [];
    $url = trim((string) ($wikiSettlement['wiki_url'] ?? ''));

    return $url !== '' ? $url : trim((string) ($properties['wiki_url'] ?? ''));
}

// ============================================================================ update_point ===

/**
 * REIN bis auf die zwei Lesefragen (Zielpruefung, Wiki-Stand): das Feld „Innerorts" beim Speichern
 * eines Punktes (`update_point`) fortschreiben.
 *
 * Regeln (Spec §3, §5; Controller-Entscheid 27.09.2026):
 *   - Ortsgroesse NICHT gebaeude/stadtviertel -> `innerorts` (samt Herkunft) faellt weg. Das ist eine
 *     Invariante des Datenmodells und gilt auch fuer alte Clients, die das Feld nicht kennen: ein
 *     Dorf gehoert keiner Stadt an.
 *   - 🔴 Rumpf OHNE `innerorts_ort` UND OHNE `innerorts_wiki` -> Feld unveraendert. Ein alter,
 *     gecachter Client kennt das Feld nicht; mit `?? ''` nahme jedes Speichern die Zugehoerigkeit
 *     still zurueck (dieselbe Falle wie `is_seaport`, features.php).
 *   - `innerorts_wiki: true` („auf Wiki-Stand", ↺ oder unberuehrt) -> der SERVER rechnet den
 *     Wiki-Stand und setzt ihn mit Herkunft `wiki`. `innerorts_ort` wird dann nicht gelesen: der
 *     Wiki-Stand ist eine Aussage des Artikels, nicht des Formulars.
 *   - sonst `innerorts_ort` (''= keiner, auch jeder Nicht-String) mit Herkunft `manual`, nach
 *     Zielpruefung. „keiner" ist ein Override („gehoert zu keiner Stadt"), kein Zuruecksetzen.
 *
 * 💣 ↺ SETZT DIE HERKUNFT AUSDRUECKLICH AUF `wiki`, auch wenn sich der Wert nicht aendert. Der Stempler
 * fasst ein unveraendertes Feld nicht an (Fall #72) -- stimmte der Override zufaellig mit dem
 * Wiki-Stand ueberein, bliebe er `manual`, und kein spaeterer Wiki-Abgleich duerfte ihn je nachziehen.
 * Genau das ist aber die Bedeutung von ↺: „das Override ist aufgehoben".
 *
 * @throws InvalidArgumentException bei einem ungueltigen Ziel (Satz fuer den Editor)
 */
function avesmapsInnerortsUpdatePointAnwenden(PDO $pdo, array $properties, array $payload, string $subtype, string $publicId): array
{
    if (!avesmapsInnerortsIstKlasse($subtype)) {
        return avesmapsInnerortsFeldEntfernen($properties);
    }

    $wikiAngefragt = array_key_exists('innerorts_wiki', $payload) && avesmapsInnerortsWahr($payload['innerorts_wiki']);
    if (!$wikiAngefragt && !array_key_exists('innerorts_ort', $payload)) {
        return $properties;
    }

    if ($wikiAngefragt) {
        $wikiStand = avesmapsInnerortsWikiStand($pdo, $properties);
        $properties = avesmapsInnerortsSetzen($properties, $wikiStand, AVESMAPS_FIELD_ORIGIN_WIKI);
        $herkunft = is_array($properties['field_origins'] ?? null) ? $properties['field_origins'] : [];
        $herkunft['innerorts'] = AVESMAPS_FIELD_ORIGIN_WIKI;
        $properties['field_origins'] = $herkunft;

        return $properties;
    }

    $ortId = is_string($payload['innerorts_ort']) ? trim($payload['innerorts_ort']) : '';
    if ($ortId !== '') {
        $fehler = avesmapsInnerortsZielPruefen($pdo, $ortId, $publicId);
        if ($fehler !== null) {
            throw new InvalidArgumentException($fehler);
        }
    }

    return avesmapsInnerortsSetzen($properties, $ortId, AVESMAPS_FIELD_ORIGIN_MANUAL);
}

/**
 * REIN: `innerorts` samt seiner Herkunft entfernen (Ortsgroessenwechsel). Eine dadurch leere
 * Herkunftskarte faellt ganz weg -- was nichts aussagt, steht nicht drin (Hausregel).
 */
function avesmapsInnerortsFeldEntfernen(array $properties): array
{
    unset($properties['innerorts']);
    if (is_array($properties['field_origins'] ?? null)) {
        $herkunft = $properties['field_origins'];
        unset($herkunft['innerorts']);
        if ($herkunft === []) {
            unset($properties['field_origins']);
        } else {
            $properties['field_origins'] = $herkunft;
        }
    }

    return $properties;
}

/**
 * REIN: ein Wahrheitswert aus einem JSON-Rumpf -- `true`, 1, "1", "true" sind wahr, alles andere
 * nicht. Eine eigene Zeile statt avesmapsReadBoolean, damit diese Datei ohne features.php testbar ist.
 */
function avesmapsInnerortsWahr(mixed $wert): bool
{
    return $wert === true || $wert === 1 || $wert === '1' || $wert === 'true';
}

// ======================================================================= Wiki-Zuweisungen ===

/**
 * Schreiber 2 (Spec §5): nach einer Wiki-Zuweisung (oder ihrer Loesung) den Wiki-Stand von
 * „Innerorts" nachziehen -- fuer jeden genannten Punkt, NACH der Transaktion des Aufrufers.
 *
 * 🔴 JEDER SCHREIBER VON `properties.wiki_settlement` RUFT DAS. Welche das sind, zaehlt der Waechter
 * `api/_internal/app/__tests__/innerorts-wiki-schreiber-test.php` repoweit.
 *
 * ⚠️ Ein Fehlschlag hier nimmt die Zuweisung NICHT zurueck (die ist committet) und wird deshalb nicht
 * geworfen, sondern PROTOKOLLIERT -- ein 500 nach einer gelungenen Zuweisung liesse den Editor sie
 * wiederholen. Der naechste Admin-Lauf `innerorts_aus_wiki` holt ein verpasstes Nachziehen nach.
 *
 * @param list<string> $publicIds
 * @return int Zahl der Punkte, deren Feld wirklich geschrieben wurde
 */
function avesmapsInnerortsNachZuweisung(PDO $pdo, array $publicIds, int $userId): int
{
    $geschrieben = 0;
    foreach ($publicIds as $publicId) {
        $publicId = trim((string) $publicId);
        if ($publicId === '') {
            continue;
        }
        try {
            if (avesmapsInnerortsWikiNachziehen($pdo, $publicId, $userId)) {
                $geschrieben++;
            }
        } catch (Throwable $fehler) {
            error_log('avesmaps innerorts: Nachziehen nach Wiki-Zuweisung fehlgeschlagen fuer ' . $publicId
                . ' (' . get_class($fehler) . ')');
        }
    }

    return $geschrieben;
}

// ========================================================================= Editor-Stand ===

/**
 * Was der Editor fuer das Feld „Innerorts" braucht: den gespeicherten Ort (mit Namen), seine
 * Herkunft und den Wiki-Stand ZUM VERGLEICH (durchgestrichen neben einem Override, Spec §5).
 *
 * ⚠️ Der Wiki-Stand wird hier GERECHNET, nicht gelesen -- er ist die Antwort auf „was sagt der Artikel
 * heute?", die ein Override braucht, um sich neben ihm zu zeigen. Gespeichert wird er nur ueber die
 * Schreiber. Nur fuer die zwei Ortsgroessen; sonst gibt es kein Feld.
 *
 * 🔴 `feature_subtype` (Ortsklasse-SCHLUESSEL, z. B. "metropole") reist mit -- der Editor zeigt
 * daraus "Gareth · Metropole" (Beschriftung kommt clientseitig aus derselben Tafel wie die
 * Ortssuche, staettenKastenOrtsklassenLabel). Server sendet den Schluessel, nie den Anzeigetext --
 * dieselbe Regel wie bei jedem uebrigen Schluesselfeld dieses Hauses (AGENTS.md §12-Nachbarschaft:
 * Uebersetzung bleibt Sache des Lesers, nicht der Ablage).
 *
 * @return array{wiki_stand: ?array{public_id:string, name:string, feature_subtype:string}, ort: ?array{public_id:string, name:string, feature_subtype:string}, herkunft:string, von_der_karte:bool}
 */
function avesmapsInnerortsEditorStand(PDO $pdo, array $properties, string $subtype): array
{
    $leer = ['wiki_stand' => null, 'ort' => null, 'herkunft' => '', 'von_der_karte' => false];
    if (!avesmapsInnerortsIstKlasse($subtype)) {
        return $leer;
    }

    $wikiId = avesmapsInnerortsWikiStand($pdo, $properties);
    $wikiInfo = $wikiId !== '' ? avesmapsInnerortsStadtInfo($pdo, $wikiId) : ['name' => '', 'feature_subtype' => ''];
    $ortId = avesmapsInnerortsOrtVon($properties);
    // Der gespeicherte Ort wird auch dann genannt, wenn er nicht (mehr) aktiv ist -- Name UND
    // Ortsklasse fallen dann auf '' und der Editor sieht, dass die Zugehoerigkeit ins Leere zeigt.
    $ortInfo = $ortId !== '' ? avesmapsInnerortsStadtInfo($pdo, $ortId) : ['name' => '', 'feature_subtype' => ''];
    $herkunftKarte = is_array($properties['field_origins'] ?? null) ? $properties['field_origins'] : [];
    $herkunft = (string) ($herkunftKarte['innerorts'] ?? '');

    return [
        'wiki_stand' => $wikiInfo['name'] !== ''
            ? ['public_id' => $wikiId, 'name' => $wikiInfo['name'], 'feature_subtype' => $wikiInfo['feature_subtype']]
            : null,
        'ort' => $ortInfo['name'] !== ''
            ? ['public_id' => $ortId, 'name' => $ortInfo['name'], 'feature_subtype' => $ortInfo['feature_subtype']]
            : null,
        'herkunft' => in_array($herkunft, [AVESMAPS_FIELD_ORIGIN_WIKI, AVESMAPS_FIELD_ORIGIN_MANUAL], true) ? $herkunft : '',
        'von_der_karte' => avesmapsInnerortsVonDerKarte($properties),
    ];
}

// =================================================================== Staetten-Endpunkt ===

/**
 * Die innerorts-Punkte EINER Stadt fuer den Staetten-Kasten (Spec §6.3): aktive UND von der Karte
 * genommene; ein normal geloeschter (inaktiv ohne Merker) erscheint nicht.
 *
 * ⚠️ Der LIKE auf die public_id ist nur der Vorfilter (sie traegt keine LIKE-Sonderzeichen); die
 * Zugehoerigkeit entscheidet der dekodierte Wert.
 *
 * @return list<array{public_id:string, name:string, place_type:string, wiki_url:string, origin:string, art:string, auf_der_karte:bool, gleichnamig_auf_der_karte:bool}>
 */
function avesmapsInnerortsPunkteEinerStadt(PDO $pdo, string $ortId): array
{
    $ortId = trim($ortId);
    if ($ortId === '' || preg_match('/^[A-Za-z0-9-]+$/', $ortId) !== 1) {
        return [];
    }
    try {
        $statement = $pdo->prepare(
            "SELECT public_id, name, feature_subtype, properties_json, is_active FROM map_features
              WHERE feature_type = 'location' AND feature_subtype IN ('gebaeude', 'stadtviertel')
                AND properties_json LIKE :muster
              ORDER BY name"
        );
        $statement->execute(['muster' => '%' . $ortId . '%']);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }

    $raus = [];
    foreach ((array) $rows as $row) {
        $properties = avesmapsInnerortsPropertiesDekodieren($row['properties_json'] ?? null);
        if ($properties === null || avesmapsInnerortsOrtVon($properties) !== $ortId) {
            continue;
        }
        $aufDerKarte = (int) ($row['is_active'] ?? 0) === 1;
        if (!$aufDerKarte && !avesmapsInnerortsVonDerKarte($properties)) {
            continue;
        }
        $raus[] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'place_type' => avesmapsInnerortsPunktArt((string) ($row['feature_subtype'] ?? ''), $properties),
            'wiki_url' => avesmapsInnerortsPunktWikiUrl($properties),
            'origin' => 'karte',
            'art' => 'punkt',
            'auf_der_karte' => $aufDerKarte,
            // Der Hinweis gilt gespeicherten Staetten („vermutlich derselbe Ort wie ein Punkt") --
            // ein Punkt IST der Punkt.
            'gleichnamig_auf_der_karte' => false,
        ];
    }

    return $raus;
}

/**
 * Ist diese Kennung ein innerorts-Punkt (aktiv mit Ort, oder von der Karte genommen)? Die Frage
 * „Staette oder Punkt?" des Staetten-Endpunkts -- nach „ist es eine gespeicherte Staette?".
 */
function avesmapsInnerortsIstPunkt(PDO $pdo, string $publicId): bool
{
    $zeile = avesmapsInnerortsZeileLesen($pdo, $publicId);
    if ($zeile === null || (string) ($zeile['feature_type'] ?? '') !== 'location'
        || !avesmapsInnerortsIstKlasse((string) ($zeile['feature_subtype'] ?? ''))) {
        return false;
    }
    $properties = avesmapsInnerortsPropertiesDekodieren($zeile['properties_json'] ?? null) ?? [];

    return avesmapsInnerortsOrtVon($properties) !== '';
}

/**
 * Den Ort eines Punkts lesen ('' = keiner) -- fuer die Antwortliste NACH einer Geste.
 */
function avesmapsInnerortsOrtDesPunkts(PDO $pdo, string $publicId): string
{
    $zeile = avesmapsInnerortsZeileLesen($pdo, $publicId);
    if ($zeile === null) {
        return '';
    }

    return avesmapsInnerortsOrtVon(avesmapsInnerortsPropertiesDekodieren($zeile['properties_json'] ?? null) ?? []);
}

/**
 * „⇄" am Punkt (Staetten-Kasten, Spec §6.3): `innerorts.ort` von Hand umsetzen -- Herkunft `manual`,
 * ein vorhandener Merker `von_der_karte` wandert mit (avesmapsInnerortsSetzen).
 *
 * Protokoll `set_innerorts` mit Vorher-Schnappschuss; „Rueckgaengig" stellt `properties_json` wieder
 * her (Undo-Spalte in avesmapsUndoColumnsForAuditAction, api/_internal/map/features.php).
 *
 * @return array{ok:true, public_id:string, name:string, alter_ort:string, ziel_name:string}|array{ok:false, code:string, message:string}
 */
function avesmapsInnerortsOrtSpeichern(PDO $pdo, string $publicId, string $zielId, int $userId): array
{
    $publicId = trim($publicId);
    $zielId = trim($zielId);
    if ($publicId === '') {
        return avesmapsInnerortsFehler('not_found', 'Das Kartenobjekt wurde nicht gefunden.');
    }

    $pdo->beginTransaction();
    try {
        $feature = avesmapsInnerortsFetchFeature($pdo, $publicId);
        if ($feature === null) {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('not_found', 'Das Kartenobjekt wurde nicht gefunden.');
        }
        if (!avesmapsInnerortsIstKlasse((string) ($feature['feature_subtype'] ?? ''))) {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('invalid_state', 'Nur Stadtviertel und Bauwerke gehören einer Stadt an.');
        }
        $properties = avesmapsInnerortsPropertiesDekodieren($feature['properties_json'] ?? null) ?? [];
        $alterOrt = avesmapsInnerortsOrtVon($properties);
        // Ein inaktiver Punkt ohne Merker ist GELOESCHT -- ihm eine Stadt zu geben, machte ihn nicht
        // wieder sichtbar, nur zu einem Datensatz, den niemand mehr findet.
        if ((int) ($feature['is_active'] ?? 0) !== 1 && !avesmapsInnerortsVonDerKarte($properties)) {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('invalid_state', 'Dieser Punkt ist gelöscht.');
        }
        if ($zielId === '' || $zielId === $alterOrt) {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('invalid_target', 'Das Ziel ist kein Ort auf der Karte.');
        }
        $fehler = avesmapsInnerortsZielPruefen($pdo, $zielId, $publicId);
        if ($fehler !== null) {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('invalid_target', $fehler);
        }

        $neueProperties = avesmapsInnerortsSetzen($properties, $zielId, AVESMAPS_FIELD_ORIGIN_MANUAL);
        $revision = avesmapsInnerortsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features SET properties_json = :props, revision = :revision, updated_by = :updated_by WHERE id = :id'
        );
        $statement->execute([
            'props' => avesmapsInnerortsEncodeJson($neueProperties),
            'revision' => $revision,
            'updated_by' => $userId > 0 ? $userId : null,
            'id' => (int) $feature['id'],
        ]);
        avesmapsInnerortsWriteAuditLog($pdo, (int) $feature['id'], 'set_innerorts', $userId, $feature, [
            'public_id' => $publicId,
            // 💣 `is_active` GEHOERT IN DEN NACHHER-STAND, obwohl die Geste ihn nicht aendert: die
            // Undo-Pruefung vergleicht ihn immer mit, und ohne Angabe nimmt sie „1" an -- ein von der
            // Karte genommener Punkt (0) waere damit nie rueckgaengig zu machen.
            'is_active' => (int) ($feature['is_active'] ?? 1),
            'properties_json' => $neueProperties,
            'revision' => $revision,
        ]);
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    return [
        'ok' => true,
        'public_id' => $publicId,
        'name' => (string) ($feature['name'] ?? ''),
        'alter_ort' => $alterOrt,
        'ziel_name' => avesmapsInnerortsStadtName($pdo, $zielId),
    ];
}

// ================================================================================ Suche ===

/**
 * Die von der Karte genommenen innerorts-Punkte fuer die Kartensuche -- die aktiven hat die Suche
 * schon (avesmapsFetchMapSearchRows liest `is_active = 1`). Faellt offen aus: [].
 *
 * @return list<array{public_id:string, name:string, feature_subtype:string, properties_json:string}>
 */
function avesmapsFetchInnerortsVonDerKarteRows(PDO $pdo): array
{
    try {
        $statement = $pdo->query(
            "SELECT public_id, name, feature_subtype, properties_json FROM map_features
              WHERE feature_type = 'location' AND is_active = 0
                AND feature_subtype IN ('gebaeude', 'stadtviertel')
                AND properties_json LIKE '%von_der_karte%'"
        );
        $rows = $statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (Throwable) {
        return [];
    }

    $raus = [];
    foreach ((array) $rows as $row) {
        $properties = avesmapsInnerortsPropertiesDekodieren($row['properties_json'] ?? null);
        if ($properties === null || !avesmapsInnerortsVonDerKarte($properties) || avesmapsInnerortsOrtVon($properties) === '') {
            continue;
        }
        $raus[] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'feature_subtype' => (string) ($row['feature_subtype'] ?? ''),
            'properties_json' => (string) ($row['properties_json'] ?? ''),
        ];
    }

    return $raus;
}

/**
 * REIN: die aktiven Siedlungspunkte der Suche als public_id => Zeile (Name, Kasten, Subtyp).
 * ⚠️ Nach KENNUNG, nicht nach Namen -- die Zugehoerigkeit ist eine public_id (Spec §3); ein
 * doppelt vergebener Stadtname stoert hier also nicht.
 *
 * @param list<array<string,mixed>> $rows map_features-Zeilen der Suche
 * @return array<string, array<string,mixed>>
 */
function avesmapsInnerortsStaedteAusZeilen(array $rows): array
{
    $staedte = [];
    foreach ($rows as $row) {
        if ((string) ($row['feature_type'] ?? '') !== 'location'
            || !in_array((string) ($row['feature_subtype'] ?? ''), AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES, true)) {
            continue;
        }
        $publicId = (string) ($row['public_id'] ?? '');
        if ($publicId !== '') {
            $staedte[$publicId] = $row;
        }
    }

    return $staedte;
}

/**
 * REIN: die Artikel-Schluessel ALLER innerorts-Punkte der Suche (aktive aus $rows, von der Karte
 * genommene aus der eigenen Abfrage). Eine abgeleitete Staette desselben Artikels ist dasselbe
 * Objekt und faellt heraus (Spec §6.1/§7: ein Objekt, ein Treffer).
 *
 * @return array<string,true>
 */
function avesmapsInnerortsSuchArtikel(array $rows, array $vonDerKarteRows): array
{
    $menge = [];
    foreach (array_merge($rows, $vonDerKarteRows) as $row) {
        if (!avesmapsInnerortsIstKlasse((string) ($row['feature_subtype'] ?? ''))) {
            continue;
        }
        $roh = (string) ($row['properties_json'] ?? '');
        if (!str_contains($roh, 'innerorts')) {
            continue; // billiger Vorfilter: 1258 Bauwerke, die meisten ohne Feld
        }
        $properties = avesmapsInnerortsPropertiesDekodieren($roh) ?? [];
        if (avesmapsInnerortsOrtVon($properties) === '') {
            continue;
        }
        $schluessel = avesmapsInnerortsArtikelSchluessel(avesmapsInnerortsPunktWikiUrl($properties));
        if ($schluessel !== '') {
            $menge[$schluessel] = true;
        }
    }

    return $menge;
}

/**
 * REIN: die von der Karte genommenen Punkte als `in_settlement`-Treffer ihrer Stadt -- DIESELBE
 * Bauform wie avesmapsBuildInSettlementSearchEntries (Sprungziel = die Stadt, Spec §7).
 *
 * @param list<array<string,mixed>> $vonDerKarteRows avesmapsFetchInnerortsVonDerKarteRows
 * @param list<array<string,mixed>> $rows            map_features-Zeilen der Suche (fuer die Stadt)
 * @return list<array<string,mixed>>
 */
function avesmapsBuildInnerortsVonDerKarteSearchEntries(array $vonDerKarteRows, array $rows): array
{
    if ($vonDerKarteRows === []) {
        return [];
    }
    $staedte = avesmapsInnerortsStaedteAusZeilen($rows);

    $entries = [];
    foreach ($vonDerKarteRows as $row) {
        $name = trim((string) ($row['name'] ?? ''));
        $properties = avesmapsInnerortsPropertiesDekodieren($row['properties_json'] ?? null) ?? [];
        $stadt = $staedte[avesmapsInnerortsOrtVon($properties)] ?? null;
        if ($name === '' || $stadt === null) {
            continue; // Stadt nicht (mehr) auf der Karte -> nichts zum Anspringen
        }
        $stadtName = (string) ($stadt['name'] ?? '');
        $stadtId = (string) ($stadt['public_id'] ?? '');
        $art = avesmapsInnerortsPunktArt((string) ($row['feature_subtype'] ?? ''), $properties);
        $entries[] = [
            'kind' => 'in_settlement',
            'public_id' => $stadtId,
            'public_ids' => [$stadtId],
            'name' => $name,
            'type_label' => ($art !== '' ? $art : 'Bauwerk') . ' in ' . $stadtName,
            'feature_subtype' => (string) ($stadt['feature_subtype'] ?? ''),
            'settlement_name' => $stadtName,
            'settlement_public_id' => $stadtId,
            'wiki_url' => avesmapsInnerortsPunktWikiUrl($properties),
            'min_x' => (float) ($stadt['min_x'] ?? 0),
            'min_y' => (float) ($stadt['min_y'] ?? 0),
            'max_x' => (float) ($stadt['max_x'] ?? 0),
            'max_y' => (float) ($stadt['max_y'] ?? 0),
            'search_texts' => [$name],
        ];
    }

    return $entries;
}

/**
 * REIN: der Zusatz „in Gareth" an einem AKTIVEN innerorts-Punkt (Spec §7: ein normaler
 * Kartentreffer mit Zusatz). Ohne Feld oder ohne aktive Stadt bleibt der Treffer, wie er ist.
 *
 * @param array<string, array<string,mixed>>|null $staedte lazy: der Aufrufer baut die Tafel erst,
 *        wenn ein Punkt sie braucht (avesmapsInnerortsStaedteAusZeilen)
 */
function avesmapsInnerortsSuchZusatz(array $entry, array $row, array $staedte): array
{
    if (($entry['kind'] ?? '') !== 'location' || !avesmapsInnerortsIstKlasse((string) ($row['feature_subtype'] ?? ''))) {
        return $entry;
    }
    $properties = avesmapsInnerortsPropertiesDekodieren($row['properties_json'] ?? null) ?? [];
    $stadt = $staedte[avesmapsInnerortsOrtVon($properties)] ?? null;
    $stadtName = $stadt !== null ? trim((string) ($stadt['name'] ?? '')) : '';
    if ($stadtName !== '') {
        $entry['type_label'] = (string) ($entry['type_label'] ?? '') . ' in ' . $stadtName;
    }

    return $entry;
}
