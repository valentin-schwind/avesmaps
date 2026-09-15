<?php

declare(strict_types=1);

// DIE WIKI-LANDSCHAFT EINER BESCHRIFTUNG -- die EINE Stelle, an der `properties.wiki_region` geschrieben
// wird. Entwurf: docs/superpowers/specs/2026-09-15-landschaft-wiki-eine-quelle-design.md
//
// 🔴 DIE REGEL (Owner 15.09.2026: „eine inkonsistenz darf es hier nicht geben"). Eine Landschaft ist EINE
// Region (`ecosystem_region`) mit N Beschriftungen und M Flaechen. Fuer den Wiki-Artikel gibt es EINE
// Quelle, die Region. Fuer jede aktive Beschriftung, die an eine aktive Region gebunden ist, gilt:
// `properties.wiki_region.wiki_key` = `ecosystem_region.wiki_region_key` -- beide leer oder beide gleich.
// Freie Beschriftungen (Berggipfel, Fluesse, Ebenen) behalten ihr eigenes Nest.
//
// 💣 WARUM EINE DATEI. Bis zum 15.09.2026 schrieben NEUN Stellen dieses Nest, und nur zwei davon (Durchtrag
// und Ruecknahme) fragten, ob die Beschriftung an einer Flaeche haengt: der Garetien-Import (Nest per Name an
// das Schild, Adresse getrennt an die Region), `create_label`, `update_label`, drei WikiSync-Abgleiche und das
// Rueckgaengig der Karte. Dazu kamen Wege, die eine Bindung oder die Region aenderten, OHNE die Beschriftung
// nachzuziehen: `create_region` mit Label, das Rueckgaengig einer Regionszuweisung und das Zurueckholen einer
// geloeschten Region. Jeder davon konnte Schild und Flaeche auseinanderbringen, und live standen am 15.09.2026
// vier solche Paare (Blauer See, Erlensee, Weydenauer See, Hexenhain). Seither geht jeder dieser Wege durch
// diese Datei; der Waechter api/_internal/app/__tests__/landschaft-wiki-schreiber-waechter-test.php zaehlt die
// Schreiber repoweit.
//
// 🔴 GEBUNDEN HEISST, WAS DER LESEPFAD SAGT: der eigene Zeiger der Beschriftung gewinnt, sonst der primaere
// Zeiger der Region (avesmapsEcosystemLabelRegionMap, ecosystem-label-link.php). Eine zweite Aufloesung
// hier waere genau die Divergenz, die diese Datei beseitigen soll.
//
// ⚠️ KEINE require AM DATEIKOPF, und features.php wird NIE von hier geladen. Diese Datei haengt ueber
// ecosystem.php am oeffentlichen Lesepfad; die Schreibfunktionen darunter brauchen avesmapsNextMapRevision,
// avesmapsWriteMapAuditLog und avesmapsBuildFeatureResponseFromStoredFeature, und die laedt der AUFRUFER --
// jeder Schreib-Endpunkt laedt features.php zuerst, und die Tests tragen Doppel dafuer, die ein require
// hier als Redeklaration zerschiesse.

/** Wie viele Regionen der Bestandslauf hoechstens auflistet. Gezaehlt wird immer alles. */
const AVESMAPS_LANDSCHAFT_WIKI_BESTAND_LISTE = 500;

/** Die Entscheidungen, die der Bestandslauf annimmt -- je Region genau eine. */
const AVESMAPS_LANDSCHAFT_WIKI_BESTAND_AKTIONEN = ['region_gewinnt', 'heben', 'entfernen'];

/**
 * REIN: das Nest setzen oder entfernen. Die EINZIGE Zeile im api/-Baum, die `properties.wiki_region`
 * schreibt -- jeder andere Schreiber ruft sie (oder eine Funktion darunter).
 */
function avesmapsLandschaftWikiNestSetzen(array $properties, ?array $nest): array
{
    if ($nest === null) {
        unset($properties['wiki_region']);

        return $properties;
    }
    $properties['wiki_region'] = $nest;

    return $properties;
}

/** REIN: der Schluessel des Nests, '' ohne Nest. Ein Nest, das kein Objekt ist, zaehlt als keines. */
function avesmapsLandschaftWikiNestSchluessel(array $properties): string
{
    $nest = $properties['wiki_region'] ?? null;

    return is_array($nest) ? trim((string) ($nest['wiki_key'] ?? '')) : '';
}

/**
 * Fehlt eine Tabelle? Eine Installation ohne Landschaften hat keine gebundenen Beschriftungen -- das ist
 * ein bekannter Zustand. Jeder ANDERE Fehler wird geworfen: als „frei" gelesen, schriebe ein SQL-Fehler das
 * Nest wieder an der Region vorbei.
 */
function avesmapsLandschaftWikiTabelleFehlt(PDOException $fehler): bool
{
    $text = $fehler->getMessage();

    return (string) $fehler->getCode() === '42S02'
        || str_contains($text, 'no such table')
        || str_contains($text, "doesn't exist");
}

/**
 * Die aktive Region, an der diese Beschriftung haengt -- oder null, wenn sie frei ist.
 *
 * 🔴 DIE AUFLOESUNG DES LESEPFADS: nennt die Beschriftung selbst eine Region, gilt NUR diese (auch wenn
 * sie stillgelegt ist -- dann ist die Beschriftung frei, und kein primaerer Zeiger einer anderen Region
 * springt ein). Sonst die Region, die sie als primaere Beschriftung nennt.
 */
function avesmapsLandschaftWikiRegionDerBeschriftung(PDO $pdo, string $labelPublicId, array $properties): ?array
{
    $eigener = trim((string) ($properties['ecosystem_region_public_id'] ?? ''));
    $labelPublicId = trim($labelPublicId);
    try {
        if ($eigener !== '') {
            $statement = $pdo->prepare('SELECT * FROM ecosystem_region WHERE public_id = :p AND is_active = 1 LIMIT 1');
            $statement->execute(['p' => $eigener]);
        } elseif ($labelPublicId !== '') {
            $statement = $pdo->prepare(
                'SELECT * FROM ecosystem_region WHERE label_public_id = :l AND is_active = 1 ORDER BY id ASC LIMIT 1'
            );
            $statement->execute(['l' => $labelPublicId]);
        } else {
            return null;
        }
        $zeile = $statement->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException $fehler) {
        if (avesmapsLandschaftWikiTabelleFehlt($fehler)) {
            return null;
        }
        throw $fehler;
    }

    return is_array($zeile) ? $zeile : null;
}

// Der Wiki-Datensatz, den eine Beschriftung von ihrer Region traegt.
//
// ⭐ GEBAUT MIT avesmapsWikiRegionBuildAssignObject() -- derselben Funktion, die auch der Label-Picker und
// der Wiki-Abgleich benutzen. Eine abgespeckte zweite Form desselben Datensatzes waere die zweite Wahrheit
// aus AGENTS.md §5.
//
// 🔴 DER SCHLUESSEL DES NESTS IST DER SCHLUESSEL DER REGION (15.09.2026). Die Region leitet ihren
// Schluessel aus der ADRESSE ab (avesmapsEcosystemWikiRegionKey), das Staging aus dem Seitentitel
// (avesmapsPoliticalSlug). Heute ergeben beide dasselbe (gemessen 15.09.2026: 662 von 662 Nestern der
// Live-Karte), aber zwei Ableitungen desselben Werts sind eine eingebaute Inkonsistenz. Deshalb wird die
// Staging-Zeile erst per Schluessel, dann per Adresse gesucht, und das Nest traegt IMMER den Schluessel der
// Region -- nie den der Staging-Zeile.
//
// 💣 DIE ZWEI require STEHEN IM RUMPF, NICHT AM DATEIKOPF: diese Datei haengt am oeffentlichen Lesepfad
// (api/app/ecosystem-areas.php, api/app/map-features.php), und die Wiki-Bibliotheken gehoeren nicht in jeden
// anonymen Kartenaufruf. ⚠️ api/edit/wiki/dump.php laedt wiki/regions.php mit einem BLANKEN `require`
// -- ein require_once hier erkennt die schon geladene Datei.
//
// 🔴 KEIN WURF, WENN DAS STAGING DIE SEITE NICHT KENNT. Eine Region darf auf einen Artikel zeigen, den noch
// kein Crawl geholt hat. Dann reist, was sicher bekannt ist: Schluessel und Adresse.
function avesmapsEcosystemWikiRegionAssignObject(PDO $pdo, string $wikiKey, string $wikiUrl): array
{
    require_once __DIR__ . '/../wiki/sync.php';
    require_once __DIR__ . '/../wiki/regions.php';

    $wikiKey = trim($wikiKey);
    $wikiUrl = trim($wikiUrl);
    $zeile = false;
    try {
        $statement = $pdo->prepare(
            'SELECT * FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' WHERE wiki_key = :wiki_key LIMIT 1'
        );
        $statement->execute(['wiki_key' => $wikiKey]);
        $zeile = $statement->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        // Die Staging-Tabelle entsteht erst mit dem ersten WikiSync-Lauf; ihr Fehlen ist ein bekannter
        // Zustand. Der Rueckfall darunter ist die sichere Richtung.
        $zeile = false;
    }
    if (!is_array($zeile) && $wikiUrl !== '') {
        try {
            $statement = $pdo->prepare(
                'SELECT * FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' WHERE wiki_url = :wiki_url LIMIT 1'
            );
            $statement->execute(['wiki_url' => $wikiUrl]);
            $zeile = $statement->fetch(PDO::FETCH_ASSOC);
        } catch (PDOException) {
            $zeile = false;
        }
    }

    if (is_array($zeile)) {
        $nest = avesmapsWikiRegionBuildAssignObject($zeile);
        $nest['wiki_key'] = $wikiKey;
        // Die Adresse der Region gewinnt nur, wo das Staging keine hat -- dieselbe Seite, aber das Staging
        // traegt die kanonische Schreibweise.
        if (trim((string) ($nest['wiki_url'] ?? '')) === '' && $wikiUrl !== '') {
            $nest['wiki_url'] = $wikiUrl;
        }

        return $nest;
    }

    return ['wiki_key' => $wikiKey, 'wiki_url' => $wikiUrl];
}

/**
 * Die aktiven Beschriftungen, die an DIESER Region haengen -- als ganze Zeilen.
 *
 * 🔴 Gesammelt ueber avesmapsEcosystemRegionLabelPublicIds (beide Zeigerrichtungen), dann nach der Regel
 * des Lesepfads gefiltert: eine Beschriftung, die die Region als primaere nennt, die aber SELBST auf eine
 * andere Region zeigt, gehoert jener anderen. Ohne diesen Filter schriebe der Durchtrag ihr den Artikel
 * einer Flaeche, zu der sie auf der Karte gar nicht gehoert.
 *
 * @return list<array<string, mixed>>
 */
function avesmapsLandschaftWikiBeschriftungenDerRegion(PDO $pdo, string $regionPublicId, ?string $primaryLabelPublicId): array
{
    $ids = avesmapsEcosystemRegionLabelPublicIds($pdo, $regionPublicId, $primaryLabelPublicId);
    if ($ids === []) {
        return [];
    }

    $platzhalter = implode(', ', array_fill(0, count($ids), '?'));
    $lesen = $pdo->prepare(
        "SELECT * FROM map_features
          WHERE public_id IN ({$platzhalter}) AND feature_type = 'label' AND is_active = 1"
    );
    $lesen->execute(array_values($ids));
    $zeilen = [];
    foreach ($lesen->fetchAll(PDO::FETCH_ASSOC) ?: [] as $zeile) {
        $properties = json_decode((string) ($zeile['properties_json'] ?? ''), true);
        $eigener = is_array($properties) ? trim((string) ($properties['ecosystem_region_public_id'] ?? '')) : '';
        if ($eigener !== '' && $eigener !== $regionPublicId) {
            continue;
        }
        $zeilen[] = $zeile;
    }

    return $zeilen;
}

// ---- Was eine Anfrage an Beschriftungen mitgezogen hat --------------------------------------------------
//
// 🔴 DER BROWSER HOLT DIE KARTENNUTZLAST NACH EINEM SPEICHERN NICHT NEU. Zieht `update_label` die
// Geschwister einer Beschriftung ueber die Region mit, muessen sie in der Antwort stehen, sonst zeigt deren
// Infobox bis zum naechsten Live-Abgleich den alten Artikel. Der Endpunkt holt sie hier ab.
// ⚠️ Anfragebezogen: PHP beginnt jede Anfrage mit einem leeren Speicher; Abholen leert ihn.

/** @return array<string, array> */
function &avesmapsLandschaftWikiMitgezogeneSpeicher(): array
{
    static $speicher = [];

    return $speicher;
}

function avesmapsLandschaftWikiMitgezogeneMerken(array $features): void
{
    $speicher = &avesmapsLandschaftWikiMitgezogeneSpeicher();
    foreach ($features as $feature) {
        $id = is_array($feature) ? (string) ($feature['id'] ?? '') : '';
        if ($id !== '') {
            $speicher[$id] = $feature;
        }
    }
}

/** @return list<array> */
function avesmapsLandschaftWikiMitgezogeneAbholen(): array
{
    $speicher = &avesmapsLandschaftWikiMitgezogeneSpeicher();
    $raus = array_values($speicher);
    $speicher = [];

    return $raus;
}

/**
 * DER EINE SCHREIBER fuer alle gebundenen Beschriftungen einer Region: die Region gewinnt.
 *
 * 🔴 Traegt die Region einen Schluessel, bekommt jede Beschriftung mit einem anderen (oder keinem) das Nest
 * der Region. Ist die Region LEER, loescht er nur, wo `$leerLoescht` es sagt:
 *   * `true`  -- alle (das ausdrueckliche Entfernen, Owner 03.09.2026, und jedes Umhaengen);
 *   * `false` -- keine (ein blosses Speichern der Region nimmt nichts zurueck, Owner 01.09.2026);
 *   * Liste   -- nur diese Beschriftungen (die in diesem Schreibvorgang frisch gebundenen).
 *
 * 💣 GESCHRIEBEN WIRD NUR, WAS SICH WIRKLICH AENDERT. Ein Label-Save bumpt `map_revision` und macht die
 * Kartennutzlast fuer JEDEN Besucher ungueltig; eine Revision je Lauf, geholt beim ersten Schreibvorgang.
 * Jede geschriebene Beschriftung bekommt eine `update_label`-Protokollzeile mit Grund, damit sie im
 * Aenderungslog nachvollziehbar steht.
 * ⚠️ Das Rueckgaengig einer SOLCHEN Zeile nimmt den Artikel nicht zurueck: die Region gewinnt
 * (avesmapsLandschaftWikiRueckgaengigAngleichen). Zurueckgenommen wird die Zuweisung an der REGION -- im Fenster
 * „Aenderungen" der Landschaften, Zeile `assign_wiki_region`.
 *
 * @param string|null $auslassen eine Beschriftung, die der Aufrufer selbst schreibt (update_label)
 * @return array{labels:int, applied:int, revision:?int, features:list<array>}
 */
function avesmapsLandschaftWikiBeschriftungenAngleichen(
    PDO $pdo,
    string $regionPublicId,
    ?string $primaryLabelPublicId,
    string $sollKey,
    string $sollUrl,
    bool|array $leerLoescht,
    int $userId,
    string $grund,
    ?string $auslassen = null
): array {
    $regionPublicId = trim($regionPublicId);
    $sollKey = trim($sollKey);
    $sollUrl = trim($sollUrl);
    $leer = ['labels' => 0, 'applied' => 0, 'revision' => null, 'features' => []];
    if ($regionPublicId === '' || ($sollKey === '' && ($leerLoescht === false || $leerLoescht === []))) {
        return $leer;
    }

    $zeilen = avesmapsLandschaftWikiBeschriftungenDerRegion($pdo, $regionPublicId, $primaryLabelPublicId);
    if ($zeilen === []) {
        return $leer;
    }

    $update = $pdo->prepare(
        'UPDATE map_features SET properties_json = :properties_json, revision = :revision, updated_by = :updated_by
          WHERE id = :id'
    );
    $sollNest = null;
    $revision = null;
    $applied = 0;
    $features = [];
    foreach ($zeilen as $zeile) {
        $labelPublicId = (string) $zeile['public_id'];
        if ($auslassen !== null && $labelPublicId === $auslassen) {
            continue;
        }
        $properties = json_decode((string) ($zeile['properties_json'] ?? ''), true);
        $properties = is_array($properties) ? $properties : [];

        if ($sollKey !== '') {
            if (avesmapsLandschaftWikiNestSchluessel($properties) === $sollKey) {
                continue;
            }
            $sollNest ??= avesmapsEcosystemWikiRegionAssignObject($pdo, $sollKey, $sollUrl);
            $properties = avesmapsLandschaftWikiNestSetzen($properties, $sollNest);
        } else {
            $darfLoeschen = $leerLoescht === true
                || (is_array($leerLoescht) && in_array($labelPublicId, $leerLoescht, true));
            // 💣 GELOESCHT WIRD NUR, WO ETWAS STEHT: „entfernt" heisst „nicht zugewiesen", und eine
            // Beschriftung ohne Nest ist schon so.
            if (!$darfLoeschen || !array_key_exists('wiki_region', $properties)) {
                continue;
            }
            $properties = avesmapsLandschaftWikiNestSetzen($properties, null);
        }

        $revision ??= avesmapsNextMapRevision($pdo);
        $encoded = json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $propertiesJson = $encoded === false ? (string) $zeile['properties_json'] : $encoded;
        $update->execute([
            'properties_json' => $propertiesJson,
            'revision' => $revision,
            'updated_by' => $userId > 0 ? $userId : null,
            'id' => (int) $zeile['id'],
        ]);
        avesmapsWriteMapAuditLog(
            $pdo,
            (int) $zeile['id'],
            'update_label',
            $userId,
            avesmapsEncodeAuditJson($zeile),
            avesmapsEncodeAuditJson([
                'public_id' => $labelPublicId,
                'properties_json' => $propertiesJson,
                'revision' => $revision,
                'reason' => $grund,
            ])
        );
        $features[] = avesmapsEcosystemLabelFeatureNachSchreiben($zeile, $propertiesJson, $revision);
        $applied++;
    }
    avesmapsLandschaftWikiMitgezogeneMerken($features);

    return ['labels' => count($zeilen), 'applied' => $applied, 'revision' => $revision, 'features' => $features];
}

/**
 * Nach einem WECHSEL der Zuweisung einer Region: alle Beschriftungen folgen in BEIDE Richtungen, und die
 * Kartenrevision wird gehoben, wenn der Schluessel wirklich wechselt.
 *
 * 🔴 Die Stelle fuer jeden Weg, der `wiki_url`/`wiki_region_key` einer Region AUSDRUECKLICH setzt:
 * avesmapsLandschaftWikiRegionSetzen und das Rueckgaengig einer Zuweisung (avesmapsEcosystemRestoreAuditRow).
 * Bis zum 15.09.2026 stellte jenes Rueckgaengig nur die Region zurueck -- die Beschriftungen trugen danach
 * den Artikel, den die Region gerade wieder verloren hatte.
 *
 * @return array{labels:int, applied:int, revision:?int, features:list<array>, map_revision:?int}
 */
function avesmapsLandschaftWikiNachRegionsWechsel(
    PDO $pdo,
    array $vorher,
    array $nachher,
    int $userId,
    ?string $auslassen = null
): array {
    $schluessel = trim((string) ($nachher['wiki_region_key'] ?? ''));
    $durchtrag = ['labels' => 0, 'applied' => 0, 'revision' => null, 'features' => []];
    if ((int) ($nachher['is_active'] ?? 1) === 1) {
        $durchtrag = avesmapsLandschaftWikiBeschriftungenAngleichen(
            $pdo,
            (string) ($nachher['public_id'] ?? ''),
            ($nachher['label_public_id'] ?? null) === null ? null : (string) $nachher['label_public_id'],
            $schluessel,
            (string) ($nachher['wiki_url'] ?? ''),
            true,
            $userId,
            $schluessel === '' ? 'ecosystem_wiki_region_clear' : 'ecosystem_wiki_region_push',
            $auslassen
        );
    }
    $durchtrag['map_revision'] = avesmapsEcosystemBumpMapRevisionBeiWikiWechsel(
        $pdo,
        $vorher,
        $nachher,
        $durchtrag['revision']
    );

    return $durchtrag;
}

/**
 * Eine REAKTIVIERTE Region gleicht ihre Beschriftungen an -- die Region gewinnt, auch leer.
 *
 * 🔴 Befund des Pruefagenten (15.09.2026): waehrend eine Region stillgelegt ist, gilt ihre Beschriftung als
 * frei. Wird in dieser Zeit die Zuweisung der Region zurueckgenommen (das Rueckgaengig schreibt auch an eine
 * inaktive Region, und avesmapsLandschaftWikiNachRegionsWechsel gleicht dann nichts an) oder bekommt ein
 * Schild ein eigenes Nest, stehen beide nach dem Zurueckholen auseinander. Gerufen von JEDEM Weg, der eine
 * Region wieder aktiv setzt (avesmapsEcosystemRestoreAuditRow, beide Zweige).
 * ⚠️ Still, wenn die Region nicht aktiv ist oder keine Beschriftung traegt.
 */
function avesmapsLandschaftWikiNachReaktivierung(PDO $pdo, string $regionPublicId, int $userId): array
{
    $leer = ['labels' => 0, 'applied' => 0, 'revision' => null, 'features' => []];
    $statement = $pdo->prepare('SELECT * FROM ecosystem_region WHERE public_id = :p AND is_active = 1 LIMIT 1');
    $statement->execute(['p' => trim($regionPublicId)]);
    $region = $statement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($region)) {
        return $leer;
    }

    return avesmapsLandschaftWikiBeschriftungenAngleichen(
        $pdo,
        (string) $region['public_id'],
        ($region['label_public_id'] ?? null) === null ? null : (string) $region['label_public_id'],
        (string) ($region['wiki_region_key'] ?? ''),
        (string) ($region['wiki_url'] ?? ''),
        true,
        $userId,
        'ecosystem_wiki_region_reaktiviert'
    );
}

/**
 * Den Artikel an die REGION schreiben und alle Beschriftungen folgen lassen.
 *
 * 🔴 DIE ADRESSE, NIE EIN SCHLUESSEL: `wiki_region_key` wird aus `wiki_url` abgeleitet
 * (avesmapsEcosystemWikiRegionKey), wie in jedem Schreibweg der Region. Eine leere Adresse ist das
 * ausdrueckliche Entfernen.
 * ⚠️ KEINE Transaktion und KEIN DDL -- der Aufrufer haelt beides (DDL committet in MySQL implizit,
 * AGENTS.md §11). Die Landschaften-Revision hebt ebenfalls der Aufrufer, EINMAL je Transaktion, wenn
 * `geschrieben` wahr ist.
 * ⚠️ Die Protokollzeile heisst `assign_wiki_region` wie beim Panel-Knopf -- das Fenster „Aenderungen"
 * nimmt sie damit mit demselben Weg zurueck.
 *
 * @return array{region:array, geschrieben:bool, labels:int, applied:int, revision:?int, features:list<array>, map_revision:?int}
 */
function avesmapsLandschaftWikiRegionSetzen(
    PDO $pdo,
    array $region,
    string $wikiUrl,
    int $userId,
    ?string $auslassen = null
): array {
    $wikiUrl = avesmapsNormalizeOptionalUrl($wikiUrl, 500, 'wiki_url');
    $wikiKey = (string) (avesmapsEcosystemWikiRegionKey($wikiUrl) ?? '');
    $publicId = (string) $region['public_id'];
    $nachher = $region;
    $geschrieben = false;

    if (trim((string) ($region['wiki_region_key'] ?? '')) !== $wikiKey
        || trim((string) ($region['wiki_url'] ?? '')) !== $wikiUrl) {
        $pdo->prepare(
            'UPDATE ecosystem_region
                SET wiki_url = :wiki_url, wiki_region_key = :wiki_region_key, updated_by = :user_id
              WHERE public_id = :public_id AND is_active = 1'
        )->execute([
            'wiki_url' => $wikiUrl === '' ? null : $wikiUrl,
            'wiki_region_key' => $wikiKey === '' ? null : $wikiKey,
            'user_id' => $userId > 0 ? $userId : null,
            'public_id' => $publicId,
        ]);
        $nachher = avesmapsEcosystemRegionRow($pdo, $publicId);
        avesmapsEcosystemWriteAuditLog(
            $pdo,
            'assign_wiki_region',
            $userId,
            null,
            $publicId,
            avesmapsEcosystemRegionSnapshot($region),
            avesmapsEcosystemRegionSnapshot($nachher)
        );
        $geschrieben = true;
    }

    return ['region' => $nachher, 'geschrieben' => $geschrieben]
        + avesmapsLandschaftWikiNachRegionsWechsel($pdo, $region, $nachher, $userId, $auslassen);
}

/**
 * Die Adresse eines Nests, das an die Region weitergereicht wird. `null` ist das Entfernen ('').
 *
 * 💣 Ohne Adresse laesst sich kein Regionsschluessel ableiten -- und einen aus dem Nest abzuschreiben waere
 * die zweite Ableitung. Fehlt sie im Nest, wird das Staging unter dem Schluessel gefragt; hat auch das
 * keine, wird abgelehnt statt still nichts zu tun.
 */
function avesmapsLandschaftWikiAdresseDesNests(PDO $pdo, ?array $nest): string
{
    if ($nest === null) {
        return '';
    }
    $adresse = trim((string) ($nest['wiki_url'] ?? ''));
    if ($adresse !== '') {
        return $adresse;
    }
    $schluessel = trim((string) ($nest['wiki_key'] ?? ''));
    if ($schluessel !== '') {
        require_once __DIR__ . '/../wiki/sync.php';
        require_once __DIR__ . '/../wiki/regions.php';
        try {
            $statement = $pdo->prepare(
                'SELECT wiki_url FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' WHERE wiki_key = :k LIMIT 1'
            );
            $statement->execute(['k' => $schluessel]);
            $adresse = trim((string) ($statement->fetchColumn() ?: ''));
        } catch (PDOException) {
            $adresse = '';
        }
        if ($adresse !== '') {
            return $adresse;
        }
    }

    throw new InvalidArgumentException(
        'Diese Wiki-Landschaft traegt keine Adresse -- die Flaeche der Beschriftung kann sie nicht uebernehmen.'
    );
}

/**
 * DIE ENTSCHEIDUNG FUER EINE EINZELNE BESCHRIFTUNG, die gerade angelegt, geaendert oder wiederhergestellt
 * wird -- die Eigenschaften, mit denen sie gespeichert werden muss.
 *
 * Frei: das Nest wie gewuenscht (oder unveraendert, wenn der Rumpf keines nennt).
 * Gebunden:
 *   * `anlegen` (Duplizieren, Zeichnen) und `wiederherstellen` (Rueckgaengig): das Nest der Region, auch
 *     leer. Ein mitgeschicktes Nest wird verworfen -- beim Duplizieren ist es die Kopie des Originals und
 *     keine Entscheidung.
 *   * `aendern` MIT Wunsch: der Wunsch geht an die REGION (Leitplanke des Owners: der Kasten der
 *     Beschriftung ist dort ausgeblendet, „es gewinnt die Flaeche"), und alle Beschriftungen folgen.
 *   * `aendern` OHNE Wunsch: traegt die Region einen Artikel, wird er nachgezogen. Ist sie leer, loescht
 *     nur ein UMHAENGEN (`$regionVorher` war eine andere); ein blosses Speichern nimmt nichts zurueck.
 *
 * @param array|false|null $wunsch false = der Rumpf nennt `wiki_region` nicht; null = entfernen; array = Nest
 * @param string $modus 'anlegen' | 'aendern' | 'wiederherstellen'
 */
function avesmapsLandschaftWikiBeschriftungFestlegen(
    PDO $pdo,
    string $labelPublicId,
    array $properties,
    string $regionVorher,
    array|false|null $wunsch,
    string $modus,
    int $userId
): array {
    $region = avesmapsLandschaftWikiRegionDerBeschriftung($pdo, $labelPublicId, $properties);
    if ($region === null) {
        return $wunsch === false ? $properties : avesmapsLandschaftWikiNestSetzen($properties, $wunsch);
    }

    $weitergereicht = false;
    if ($modus === 'aendern' && $wunsch !== false) {
        $ergebnis = avesmapsLandschaftWikiRegionSetzen(
            $pdo,
            $region,
            avesmapsLandschaftWikiAdresseDesNests($pdo, $wunsch),
            $userId,
            $labelPublicId
        );
        if ($ergebnis['geschrieben']) {
            avesmapsNextEcosystemRevision($pdo);
        }
        $region = $ergebnis['region'];
        $weitergereicht = true;
    }

    $sollKey = trim((string) ($region['wiki_region_key'] ?? ''));
    if ($sollKey !== '') {
        if (avesmapsLandschaftWikiNestSchluessel($properties) === $sollKey) {
            return $properties;
        }

        return avesmapsLandschaftWikiNestSetzen(
            $properties,
            avesmapsEcosystemWikiRegionAssignObject($pdo, $sollKey, (string) ($region['wiki_url'] ?? ''))
        );
    }

    $loescht = $modus !== 'aendern'
        || $weitergereicht
        || (string) $region['public_id'] !== trim($regionVorher);

    return ($loescht && array_key_exists('wiki_region', $properties))
        ? avesmapsLandschaftWikiNestSetzen($properties, null)
        : $properties;
}

/**
 * Das Rueckgaengig einer Beschriftung (Aenderungsprotokoll der Karte): die Region gewinnt, auch leer.
 *
 * 💣 Ohne das stellte das Rueckgaengig `properties_json` samt ALTEM Nest zurueck -- ein Artikel, den die
 * Region inzwischen gewechselt oder verloren hat, stuende wieder am Schild. Angeglichen wird in den
 * `$updates` selbst, damit es EIN Schreibvorgang und EINE Protokollzeile bleibt.
 */
function avesmapsLandschaftWikiRueckgaengigAngleichen(PDO $pdo, array $feature, array $updates, int $userId): array
{
    if ((string) ($feature['feature_type'] ?? '') !== 'label') {
        return $updates;
    }
    if ((int) ($updates['is_active'] ?? $feature['is_active'] ?? 1) !== 1) {
        return $updates;
    }
    $roh = array_key_exists('properties_json', $updates) ? $updates['properties_json'] : ($feature['properties_json'] ?? null);
    $properties = is_array($roh) ? $roh : json_decode((string) ($roh ?? ''), true);
    if (!is_array($properties)) {
        return $updates;
    }

    $festgelegt = avesmapsLandschaftWikiBeschriftungFestlegen(
        $pdo,
        (string) ($feature['public_id'] ?? ''),
        $properties,
        '',
        false,
        'wiederherstellen',
        $userId
    );
    if ($festgelegt === $properties) {
        return $updates;
    }
    $updates['properties_json'] = avesmapsEncodeJson($festgelegt);

    return $updates;
}

/**
 * Welche aktiven Beschriftungen an einer aktiven Region haengen: Beschriftung => Region.
 *
 * ⭐ EIN Durchgang ueber alle Beschriftungen, nicht eine Abfrage je Label -- der Namensabgleich des WikiSync
 * laeuft ueber den ganzen Bestand. Die Aufloesung ist die reine des Lesepfads.
 *
 * @return array<string, string>
 */
function avesmapsLandschaftWikiGebundeneBeschriftungen(PDO $pdo): array
{
    require_once __DIR__ . '/ecosystem-label-link.php';
    try {
        $regionen = $pdo->query(
            'SELECT public_id, label_public_id FROM ecosystem_region WHERE is_active = 1'
        )->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (PDOException $fehler) {
        if (avesmapsLandschaftWikiTabelleFehlt($fehler)) {
            return [];
        }
        throw $fehler;
    }
    $labels = $pdo->query(
        "SELECT public_id, properties_json FROM map_features WHERE feature_type = 'label' AND is_active = 1"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    return avesmapsLandschaftWikiBindungRechnen($regionen, $labels);
}

/**
 * REIN: die Bindung nach der Regel des Lesepfads, beschraenkt auf AKTIVE Regionen (eine Beschriftung, deren
 * eigener Zeiger auf eine stillgelegte Region zeigt, ist frei).
 *
 * @param list<array{public_id:string,label_public_id:?string}> $regionen aktive Regionen
 * @param list<array{public_id:string,properties_json:?string}> $labels aktive Beschriftungen
 * @return array<string, string>
 */
function avesmapsLandschaftWikiBindungRechnen(array $regionen, array $labels): array
{
    $aktiv = [];
    foreach ($regionen as $region) {
        $aktiv[(string) $region['public_id']] = true;
    }
    $zeiger = [];
    $ids = [];
    foreach ($labels as $label) {
        $id = (string) $label['public_id'];
        $ids[] = $id;
        $properties = json_decode((string) ($label['properties_json'] ?? ''), true);
        $eigener = is_array($properties) ? trim((string) ($properties['ecosystem_region_public_id'] ?? '')) : '';
        if ($eigener !== '') {
            $zeiger[] = ['public_id' => $id, 'region_public_id' => $eigener];
        }
    }

    $bindung = [];
    foreach (avesmapsEcosystemLabelRegionMap($regionen, $zeiger, $ids)['by_label'] as $labelId => $regionId) {
        if (isset($aktiv[(string) $regionId])) {
            $bindung[(string) $labelId] = (string) $regionId;
        }
    }

    return $bindung;
}

// ---- Der Bestand: messen, auflisten, einzeln entscheiden ---------------------------------------------------

/**
 * REIN: der Befund ueber gegebene Zeilen -- dieselben Zahlen wie die Messung des Auftrags, und je Region, an
 * der Beschriftung und Region verschiedene Artikel tragen, ein Fall zur Entscheidung.
 *
 * @param list<array> $regionen aktive Regionen (public_id, name, kind, wiki_region_key, wiki_url, label_public_id)
 * @param list<array> $labels aktive Beschriftungen (public_id, name, properties_json)
 */
function avesmapsLandschaftWikiBefundRechnen(array $regionen, array $labels): array
{
    $regionJeId = [];
    foreach ($regionen as $region) {
        $regionJeId[(string) $region['public_id']] = $region;
    }
    $bindung = avesmapsLandschaftWikiBindungRechnen($regionen, $labels);

    $zaehler = [
        'beschriftungen' => count($labels),
        'gebunden' => 0,
        'frei' => 0,
        'beide_leer' => 0,
        'gleich' => 0,
        'nur_beschriftung' => 0,
        'nur_region' => 0,
        'verschieden' => 0,
    ];
    $abweichend = [];
    foreach ($labels as $label) {
        $labelId = (string) $label['public_id'];
        $regionId = $bindung[$labelId] ?? '';
        if ($regionId === '') {
            $zaehler['frei']++;
            continue;
        }
        $zaehler['gebunden']++;
        $properties = json_decode((string) ($label['properties_json'] ?? ''), true);
        $properties = is_array($properties) ? $properties : [];
        $labelKey = avesmapsLandschaftWikiNestSchluessel($properties);
        $regionKey = trim((string) ($regionJeId[$regionId]['wiki_region_key'] ?? ''));

        if ($labelKey === $regionKey) {
            $zaehler[$labelKey === '' ? 'beide_leer' : 'gleich']++;
            continue;
        }
        $zaehler[$regionKey === '' ? 'nur_beschriftung' : ($labelKey === '' ? 'nur_region' : 'verschieden')]++;
        $nest = is_array($properties['wiki_region'] ?? null) ? $properties['wiki_region'] : [];
        $abweichend[$regionId][] = [
            'public_id' => $labelId,
            'name' => (string) ($label['name'] ?? $properties['name'] ?? ''),
            'wiki_key' => $labelKey,
            'wiki_url' => trim((string) ($nest['wiki_url'] ?? '')),
            'wiki_name' => trim((string) ($nest['name'] ?? '')),
        ];
    }

    $faelle = [];
    foreach ($abweichend as $regionId => $beschriftungen) {
        $region = $regionJeId[$regionId];
        $faelle[] = [
            'region_public_id' => (string) $regionId,
            'name' => (string) ($region['name'] ?? ''),
            'kind' => (string) ($region['kind'] ?? ''),
            'region_schluessel' => trim((string) ($region['wiki_region_key'] ?? '')),
            'region_adresse' => trim((string) ($region['wiki_url'] ?? '')),
            'beschriftungen' => $beschriftungen,
        ];
    }
    usort($faelle, static fn (array $a, array $b): int => strcmp($a['name'], $b['name']));

    return [
        'zaehler' => $zaehler,
        'regionen_betroffen' => count($faelle),
        'faelle' => array_slice($faelle, 0, AVESMAPS_LANDSCHAFT_WIKI_BESTAND_LISTE),
        'faelle_gekappt' => count($faelle) > AVESMAPS_LANDSCHAFT_WIKI_BESTAND_LISTE,
    ];
}

/**
 * Der Befund ueber den GANZEN Bestand. Ein Fehler wird geworfen, nie als „alles in Ordnung" gemeldet --
 * ein leerer Befund aus einem geschluckten SQL-Fehler saehe genau so aus wie ein sauberer Bestand.
 */
function avesmapsLandschaftWikiBefund(PDO $pdo): array
{
    require_once __DIR__ . '/ecosystem-label-link.php';
    $regionen = $pdo->query(
        'SELECT public_id, name, kind, wiki_region_key, wiki_url, label_public_id
           FROM ecosystem_region WHERE is_active = 1'
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $labels = $pdo->query(
        "SELECT public_id, name, properties_json FROM map_features WHERE feature_type = 'label' AND is_active = 1"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    return avesmapsLandschaftWikiBefundRechnen($regionen, $labels);
}

/**
 * Der Bestandslauf. TROCKENLAUF IST DIE VORGABE; scharf nur mit `dry_run: false`, `confirm: 'apply'` und
 * einer Entscheidung JE Region (`entscheidungen: [{region_public_id, aktion, wiki_key?}]`).
 *
 * 🔴 NICHTS OHNE ENTSCHEIDUNG. Welcher von zwei Artikeln gilt, entscheidet ein Mensch -- auch der Fall
 * „nur an der Beschriftung" ist kein Automat: der Garetien-Import hat dort per NAMEN zugewiesen, und beim
 * Blauen See war genau das der falsche Artikel.
 * 🔴 Jede Region in ihrer eigenen Transaktion, unmittelbar davor neu gelesen; ist sie inzwischen stimmig,
 * zaehlt sie als `inzwischen_erledigt`.
 * 💣 Der Ensure-Helfer laeuft VOR den Transaktionen, nie darin (DDL committet in MySQL implizit).
 */
function avesmapsLandschaftWikiBestand(PDO $pdo, array $user, array $payload): array
{
    if (!avesmapsUserCan($user, 'admin')) {
        throw new RuntimeException('Der Abgleich von Beschriftung und Flaeche ist Administratoren vorbehalten.');
    }
    $userId = (int) ($user['id'] ?? 0);

    if (avesmapsEcosystemAssignIsDryRun($payload)) {
        return ['dry_run' => true] + avesmapsLandschaftWikiBefund($pdo);
    }

    $entscheidungen = is_array($payload['entscheidungen'] ?? null) ? $payload['entscheidungen'] : [];
    avesmapsEcosystemEnsureTables($pdo);

    $ergebnisse = [];
    $landschaftRevision = null;
    foreach ($entscheidungen as $entscheidung) {
        $regionId = is_array($entscheidung) ? trim((string) ($entscheidung['region_public_id'] ?? '')) : '';
        $aktion = is_array($entscheidung) ? trim((string) ($entscheidung['aktion'] ?? '')) : '';
        $eintrag = ['region_public_id' => $regionId, 'aktion' => $aktion, 'status' => '', 'grund' => ''];
        if ($regionId === '' || !in_array($aktion, AVESMAPS_LANDSCHAFT_WIKI_BESTAND_AKTIONEN, true)) {
            $ergebnisse[] = ['status' => 'abgelehnt', 'grund' => 'Unbekannte Region oder Aktion.'] + $eintrag;
            continue;
        }

        $pdo->beginTransaction();
        try {
            $region = avesmapsEcosystemRegionRow($pdo, $regionId);
            $primaer = ($region['label_public_id'] ?? null) === null ? null : (string) $region['label_public_id'];
            $zeilen = avesmapsLandschaftWikiBeschriftungenDerRegion($pdo, $regionId, $primaer);
            $fall = avesmapsLandschaftWikiBefundRechnen([$region], $zeilen)['faelle'][0] ?? null;
            if ($fall === null) {
                $pdo->commit();
                $ergebnisse[] = ['status' => 'inzwischen_erledigt'] + $eintrag;
                continue;
            }

            if ($aktion === 'region_gewinnt') {
                avesmapsLandschaftWikiBeschriftungenAngleichen(
                    $pdo,
                    $regionId,
                    $primaer,
                    (string) ($region['wiki_region_key'] ?? ''),
                    (string) ($region['wiki_url'] ?? ''),
                    true,
                    $userId,
                    'landschaft_wiki_bestand'
                );
            } else {
                $adresse = '';
                if ($aktion === 'heben') {
                    $gesucht = trim((string) ($entscheidung['wiki_key'] ?? ''));
                    foreach ($fall['beschriftungen'] as $beschriftung) {
                        if ($gesucht !== '' && $beschriftung['wiki_key'] === $gesucht && $beschriftung['wiki_url'] !== '') {
                            $adresse = $beschriftung['wiki_url'];
                            break;
                        }
                    }
                    if ($adresse === '') {
                        throw new InvalidArgumentException('Keine Beschriftung dieser Region traegt den genannten Artikel mit Adresse.');
                    }
                }
                $gesetzt = avesmapsLandschaftWikiRegionSetzen($pdo, $region, $adresse, $userId);
                if ($gesetzt['geschrieben']) {
                    $landschaftRevision = avesmapsNextEcosystemRevision($pdo);
                }
            }
            $pdo->commit();
            $ergebnisse[] = ['status' => 'erledigt'] + $eintrag;
        } catch (Throwable $fehler) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log('avesmapsLandschaftWikiBestand ' . $regionId . ': ' . $fehler->getMessage());
            $ergebnisse[] = [
                'status' => 'fehler',
                'grund' => $fehler instanceof InvalidArgumentException
                    ? $fehler->getMessage()
                    : 'Die Region konnte nicht geschrieben werden (Einzelheiten im Fehlerprotokoll).',
            ] + $eintrag;
        }
    }

    return ['dry_run' => false, 'ergebnisse' => $ergebnisse]
        + ($landschaftRevision === null ? [] : ['revision' => $landschaftRevision])
        + avesmapsLandschaftWikiBefund($pdo);
}
