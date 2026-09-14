<?php

declare(strict_types=1);

// DER BESTAND: den Wiki-Schluessel an Flaechen nachziehen, die ein Garetien-Import angelegt hat, BEVOR
// die Uebernahme ihn selbst an die Region schrieb (Aufgabe 2 des Bauplans vom 14.09.2026).
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §7a.
// Owner 14.09.2026: „ja, wiki-schluessel nachziehen mit trockenlauf".
//
// 🔴 DER BEFUND: bis Aufgabe 2 landete der Wiki-Treffer eines Imports nur an der BESCHRIFTUNG
// (`properties.wiki_region`), die REGION blieb leer (`ecosystem_region.wiki_url`/`wiki_region_key`
// = NULL). Der Pruefhaken „Keine Wiki-Zuweisung" und der Statuskreis lesen die Flaeche -- fuer sie sind
// diese Landschaften unzugewiesen, die neu importierten daneben zugewiesen. Der Durchtrag des Hauses
// wandert nur ABWAERTS (Flaeche -> Beschriftung, avesmapsEcosystemPushWikiRegionToLabels) und heilt das
// nie von selbst.
//
// 🔴 KEIN ZWEITER SCHREIBWEG. Geschrieben wird ueber avesmapsAssignEcosystemWikiRegion -- denselben
// Hausschreiber wie der Panel-Knopf „Flaeche zuweisen". Er leitet den Schluessel aus der ADRESSE ab (nie
// aus einem hier gebauten Schluessel), schreibt die Protokollzeile `assign_wiki_region` (im Fenster
// „Aenderungen" je Flaeche zuruecknehmbar), fuehrt den Durchtrag an die Beschriftungen, stempelt die
// Landschaften-Revision -- und jede Region laeuft in SEINER eigenen Transaktion.
//
// 💣 DIESE DATEI OEFFNET KEINE TRANSAKTION UND RUFT KEINEN ENSURE-HELFER. Der Trockenlauf darf in keine
// Tabelle schreiben, und avesmapsEcosystemEnsureTables saet Artzeilen nach
// (avesmapsEcosystemSeedRegionTypes). Den Ensure macht im scharfen Lauf der Hausschreiber selbst, VOR
// seiner Transaktion -- in MySQL beendet DDL eine offene Transaktion mit einem impliziten COMMIT
// (AGENTS.md §11, der Sammel-Umzug der Beschriftungsquellen). Festgenagelt am Quelltext in
// garetien-wiki-nachzug-test.php, Abschnitt G, weil SQLite den impliziten COMMIT nicht kennt.
//
// ⚠️ KEIN EIGENER STEMPEL, AUCH NICHT AM ENDE. Der Hausschreiber hebt je Region `ecosystem_revision`
// Zeile 1 UND 2 (avesmapsNextEcosystemRevision, `$mapPayloadChanged = true`); Zeile 2 steckt ueber
// avesmapsClimateReadStamp im ETag der Kartennutzlast (api/app/map-features.php), Zeile 1 im ETag der
// Flaechen (api/app/ecosystem-areas.php). `map_revision` hebt er NICHT, und das mit Absicht (Kopf von
// avesmapsAssignEcosystemWikiRegion: „must never reach avesmapsNextMapRevision()") -- nur der Durchtrag
// tut es, und nur, wenn er wirklich eine Beschriftung schreibt. Ein zusaetzlicher map_revision-Stempel
// hier waere ein Stempel ohne Schreibvorgang auf map_features und entwertete die ~21 MB fuer nichts.
//
// 🔴 DER IMPORTER IST EIN GERUEST (Abbau-Vertrag, garetien-abbau-waechter-test.php). Diese Datei liegt
// deshalb unter api/_internal/import/ und verschwindet mit ihm. Sie liest sync_plan_*, ecosystem_region
// und map_features -- keine garetien_import-Tabelle.

require_once __DIR__ . '/garetien-uebernahme.php';
// ⚠️ avesmapsUserCan wohnt in auth.php. Der Endpunkt laedt auth.php BLANK in seiner ersten Zeile und
// diese Datei danach -- `require_once` erkennt die schon geladene Datei und laedt nichts zweimal. Die
// Falle waere die UMGEKEHRTE Reihenfolge (erst require_once, danach ein blankes require: „Cannot
// redeclare", 500 mit leerem Rumpf).
require_once __DIR__ . '/../auth.php';

/** Wie viele Regionen ein scharfer Lauf hoechstens anfasst, wenn der Aufrufer nichts sagt. */
const AVESMAPS_GARETIEN_WIKI_NACHZUG_DECKEL = 200;
/** Die harte Obergrenze je Aufruf -- ein `limit: 100000` aus der Konsole bleibt ein Block. */
const AVESMAPS_GARETIEN_WIKI_NACHZUG_DECKEL_MAX = 1000;
/** Wie viele Zeilen Stichprobe und Widersprueche hoechstens zeigen. Die ZAEHLUNG ist davon unberuehrt. */
const AVESMAPS_GARETIEN_WIKI_NACHZUG_STICHPROBE = 20;
/** Wie viele public_ids eine IN-Liste hoechstens traegt. */
const AVESMAPS_GARETIEN_WIKI_NACHZUG_IN_BLOCK = 500;
/**
 * Die Gruende, aus denen eine Region NICHT gesetzt wird -- in der Reihenfolge, in der das Urteil sie
 * prueft. Die Antwort traegt sie immer vollstaendig, auch mit 0: eine fehlende Zeile laese sich wie
 * „diesen Fall gibt es nicht".
 */
const AVESMAPS_GARETIEN_WIKI_NACHZUG_GRUENDE = [
    'region_inaktiv',
    'schon_gesetzt',
    'anderer_schluessel',
    'beschriftung_fehlt',
    'beschriftung_ohne_wiki',
    'adresse_passt_nicht',
];

/**
 * Das Urteil ueber EINE Region -- REIN, ohne Datenbank.
 *
 * 🔴 NIE UEBERSCHREIBEN. Traegt die Region schon einen Schluessel, ist sie fertig (`schon_gesetzt`) --
 * oder sie widerspricht ihrer Beschriftung (`anderer_schluessel`). Beides fasst dieser Lauf nicht an:
 * welcher von zwei Artikeln gilt, entscheidet ein Mensch.
 * 🔴 ZURUECKGENOMMEN ODER GELOESCHT HEISST NIE: eine inaktive Region wird nicht beschrieben.
 * 💣 DIE ADRESSE MUSS DENSELBEN SCHLUESSEL ERGEBEN, DEN DIE BESCHRIFTUNG TRAEGT. Der Hausschreiber leitet
 * den Schluessel der Region aus der Adresse ab, und sein Durchtrag vergleicht ihn danach mit der
 * Beschriftung: waeren sie verschieden, schriebe er der Beschriftung ein NEUES Nest -- gebaut aus dem
 * Staging unter dem abgeleiteten Schluessel oder, wenn es den dort nicht gibt, als nacktes
 * `{wiki_key, wiki_url}`. Aus einem Nachzug wuerde eine stille Umzuweisung. Deshalb wird eine solche
 * Region gar nicht erst angeboten (`adresse_passt_nicht`), ebenso eine Adresse, die der Hausschreiber
 * ablehnen wuerde (avesmapsNormalizeOptionalUrl: nur http/https).
 *
 * 🔴 W1 (Nachbesserung Runde 1, 14.09.2026): DER DURCHTRAG DES HAUSSCHREIBERS ERREICHT ALLE AN DIE
 * REGION GEBUNDENEN BESCHRIFTUNGEN, NICHT NUR DIE PRIMAERE. `avesmapsEcosystemPushWikiRegionToLabels`
 * (ueber `avesmapsEcosystemRegionLabelPublicIds`, ecosystem.php:3649/:3788) schreibt JEDE aktive,
 * per Zeiger (`ecosystem_region_public_id`) ODER primaer (`ecosystem_region.label_public_id`)
 * gebundene Beschriftung um, deren Schluessel vom neuen abweicht (ecosystem.php:3812) -- eine ZWEITE
 * Beschriftung mit einem ABWEICHENDEN, von Hand gesetzten Schluessel wuerde so STILL umgewiesen. Das
 * Urteil bezieht deshalb ALLE aktiven gebundenen Beschriftungen ein: `$andereLabels` sind die WEITEREN
 * (ausser der primaeren), ueber DENSELBEN Leser wie der Durchtrag ermittelt (den ruft der Aufrufer,
 * nicht diese reine Funktion -- siehe die Aufrufstelle in avesmapsGaretienWikiNachzug). Traegt eine
 * davon einen NICHT-LEEREN, abweichenden Schluessel, wird die Region `anderer_schluessel` -- wie beim
 * Widerspruch zwischen Region und primaerer Beschriftung, nur eine Ebene weiter. Eine Beschriftung
 * OHNE Schluessel bleibt unproblematisch: sie erbt weiter (Hausregel, AGENTS.md §11 „Die Beschriftung
 * erbt die Wiki-Landschaft ihrer Flaeche").
 *
 * @param array $region Zeile aus ecosystem_region (mindestens is_active, wiki_region_key).
 * @param ?array $label Die PRIMAERE gebundene Beschriftung (ecosystem_region.label_public_id) oder null.
 * @param list<array> $andereLabels Die WEITEREN aktiven, an die Region gebundenen Beschriftungen (ohne
 *   die primaere) -- Vorgabe `[]`, damit ein Aufruf ohne diese Kenntnis (z. B. ein reiner Grenzfalltest)
 *   sich wie zuvor verhaelt, solange es keine zweite Beschriftung gibt.
 * @return array{grund:string, wiki_key:string, wiki_url:string}
 */
function avesmapsGaretienWikiNachzugUrteil(array $region, ?array $label, array $andereLabels = []): array
{
    $raus = ['grund' => '', 'wiki_key' => '', 'wiki_url' => ''];
    if ((int) ($region['is_active'] ?? 0) !== 1) {
        $raus['grund'] = 'region_inaktiv';
        return $raus;
    }

    $labelAktiv = is_array($label)
        && (int) ($label['is_active'] ?? 0) === 1
        && (string) ($label['feature_type'] ?? '') === 'label';
    $nest = [];
    if ($labelAktiv) {
        $properties = json_decode((string) ($label['properties_json'] ?? ''), true);
        $nest = is_array($properties) && is_array($properties['wiki_region'] ?? null) ? $properties['wiki_region'] : [];
    }
    $labelSchluessel = trim((string) ($nest['wiki_key'] ?? ''));
    $raus['wiki_key'] = $labelSchluessel;

    if (trim((string) ($region['wiki_region_key'] ?? '')) !== '') {
        $raus['grund'] = ($labelSchluessel !== '' && $labelSchluessel !== trim((string) $region['wiki_region_key']))
            ? 'anderer_schluessel'
            : 'schon_gesetzt';
        return $raus;
    }
    if (!$labelAktiv) {
        $raus['grund'] = 'beschriftung_fehlt';
        return $raus;
    }
    if ($labelSchluessel === '') {
        $raus['grund'] = 'beschriftung_ohne_wiki';
        return $raus;
    }

    try {
        $adresse = avesmapsNormalizeOptionalUrl((string) ($nest['wiki_url'] ?? ''), 500, 'wiki_url');
    } catch (InvalidArgumentException) {
        $adresse = '';
    }
    if ($adresse === '' || avesmapsEcosystemWikiRegionKey($adresse) !== $labelSchluessel) {
        $raus['grund'] = 'adresse_passt_nicht';
        return $raus;
    }

    // W1: eine WEITERE gebundene Beschriftung mit einem NICHT-LEEREN, ABWEICHENDEN Schluessel blockt --
    // sonst ueberschriebe sie der Durchtrag des Hausschreibers gleich mit, sobald diese Region gesetzt
    // wird. `wiki_key` bleibt bewusst der der PRIMAEREN Beschriftung (unveraendert gegenueber oben) --
    // dieser Zweig aendert nur `grund`, keine zweite Bedeutung desselben Feldes.
    foreach ($andereLabels as $andere) {
        if ((int) ($andere['is_active'] ?? 0) !== 1 || (string) ($andere['feature_type'] ?? '') !== 'label') {
            continue;
        }
        $andereProperties = json_decode((string) ($andere['properties_json'] ?? ''), true);
        $andereNest = is_array($andereProperties) && is_array($andereProperties['wiki_region'] ?? null)
            ? $andereProperties['wiki_region'] : [];
        $andererSchluessel = trim((string) ($andereNest['wiki_key'] ?? ''));
        if ($andererSchluessel !== '' && $andererSchluessel !== $labelSchluessel) {
            $raus['grund'] = 'anderer_schluessel';
            return $raus;
        }
    }

    $raus['grund'] = 'setzen';
    $raus['wiki_url'] = $adresse;

    return $raus;
}

/**
 * Die Region hinter JEDEM uebernommenen Neu-Vermerk dieses Imports, ueber ALLE Laeufe.
 *
 * 🔴 ALLE VERMERKFORMEN, UND NUR UEBER DEN EINEN LESER: eine nackte public_id (der Live-Stand), `area:… |
 * region:…` ohne `verbund:` und `area:… | region:… | verbund:…` -- avesmapsGaretienVermerkLesen kennt
 * alle drei. Ein eigener Zerleger hier waere der vierte Leser desselben Formats.
 * 🔴 NUR `change_type = 'new'`: eine Ergaenzung ('changed') haengt eine Quelle an eine Region, die der
 * Import NICHT angelegt hat; ihr Schluessel gehoert dem, der sie gezeichnet hat.
 * ⚠️ Eine zurueckgenommene Zeile ist hier nicht mehr zu sehen (die Ruecknahme setzt apply_state und
 * apply_note auf NULL), eine abgelehnte war nie `done`.
 * ⚠️ Auch ein Vermerk eines Orts, Wegs oder Gipfels liefert eine „Region" -- die public_id seines
 * Kartenobjekts. Welche davon wirklich eine Landschaftsregion ist, entscheidet erst der Nachschlag.
 * ⚠️ Ein `nur_quelle:<siedlung> | angelegt:0|1`-Vermerk zeigt auf eine SIEDLUNG, nie auf eine Region --
 * avesmapsGaretienVermerkLesen kennt `nur_quelle`/`angelegt` nicht als eigene Felder und liefert dafuer
 * eine leere `region`. Der Aufrufer zaehlt eine leere Region als `andere_ziele`.
 *
 * @return list<string> je Vermerk die gelesene Region ('' ohne)
 */
function avesmapsGaretienWikiNachzugVermerkRegionen(PDO $pdo): array
{
    $stmt = $pdo->prepare(
        "SELECT i.apply_note FROM sync_plan_item i
           JOIN sync_plan_run r ON r.id = i.run_id
          WHERE r.kind = :k AND i.change_type = 'new' AND i.apply_state = 'done'
            AND i.apply_note IS NOT NULL AND i.apply_note <> ''
          ORDER BY i.id ASC"
    );
    $stmt->execute(['k' => AVESMAPS_GARETIEN_PLAN_KIND]);

    $raus = [];
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) ?: [] as $vermerk) {
        $raus[] = avesmapsGaretienVermerkLesen((string) $vermerk)['region'];
    }

    return $raus;
}

/**
 * Zeilen je public_id, in IN-Bloecken.
 *
 * ⚠️ `{ids}` ist KEIN PDO-Platzhalter, sondern die Stelle, an der die `?`-Liste eingesetzt wird.
 * 🪤 RICHTIGGESTELLT (G, Nachbesserung Runde 1, 14.09.2026): `(string) $zeile['public_id']` VERHINDERT
 * NICHT, dass PHP eine kanonische Ziffernkette als Array-Schluessel zu `int` macht -- das tut PHP bei
 * JEDEM Array-Schluessel, gecastet oder nicht (`$a["123"] = 1;` liegt intern unter dem Schluessel `123`,
 * nicht `"123"`). Der Cast schadet trotzdem nicht: SCHREIBEN hier und LESEN an jeder Aufrufstelle
 * (`isset($regionen[$regionId])`, `$labels[...] ?? null`) laufen beide ueber denselben Array-Zugriff
 * und werden von PHP GLEICH normalisiert -- eine numerische public_id findet sich so oder so wieder.
 * Tragend ist der Cast dort, wo wirklich zwei WERTE verglichen werden statt ein Array-Schluessel
 * nachgeschlagen wird -- etwa der `array_diff(avesmapsEcosystemRegionLabelPublicIds(...), [(string)
 * ($label['public_id'] ?? '')])` in avesmapsGaretienWikiNachzug (W1): `array_diff` vergleicht seine
 * Elemente als STRINGS, ohne PHPs Array-Schluessel-Umwandlung -- dort muss die primaere id also
 * wirklich als String vorliegen, sonst bliebe sie faelschlich in der Diff-Menge stehen.
 *
 * @param list<string> $ids
 * @return array<string, array>
 */
function avesmapsGaretienWikiNachzugZeilenJe(PDO $pdo, string $sql, array $ids): array
{
    $raus = [];
    $eindeutig = array_values(array_unique(array_filter(array_map('strval', $ids), static fn (string $id): bool => $id !== '')));
    foreach (array_chunk($eindeutig, AVESMAPS_GARETIEN_WIKI_NACHZUG_IN_BLOCK) as $block) {
        $stmt = $pdo->prepare(str_replace('{ids}', implode(', ', array_fill(0, count($block), '?')), $sql));
        $stmt->execute($block);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $zeile) {
            $raus[(string) $zeile['public_id']] = $zeile;
        }
    }

    return $raus;
}

/**
 * Der Lauf. Trockenlauf ist die VORGABE.
 *
 * Trockenlauf: zaehlt ueber den GANZEN Bestand, nennt je Grund, zeigt Stichprobe und Widersprueche,
 * schreibt in keine Tabelle. Scharf: nimmt die Kandidaten mit Region-id groesser `$abId` in
 * aufsteigender Reihenfolge, hoechstens `$deckel`, und reicht jede einzeln an den Hausschreiber.
 *
 * 🔴 DIE ZAEHLUNG IST IMMER DIE GANZE, `$abId` VERSCHIEBT NUR STICHPROBE, BLOCK UND `remaining` -- sonst
 * saehe man bei einer Fortsetzung eine kleinere Zahl und hielte sie fuer den Bestand.
 * 🔴 WIEDERHOLBAR: ein gesetzter Kandidat ist beim naechsten Lauf `schon_gesetzt`. Ein gescheiterter
 * bleibt Kandidat -- ein zweiter Trockenlauf ab 0 findet genau ihn.
 * 🪤 UNMITTELBAR VOR DEM SCHREIBEN WIRD DIE REGION NEU GELESEN. Zwischen Befund und Schreiben kann ein
 * Editor sie zugewiesen oder geloescht haben, und der Hausschreiber fragt das nicht -- er schriebe seine
 * Adresse ueber die des Editors. Ein solcher Fall zaehlt als `inzwischen_erledigt`. ⚠️ Das Fenster
 * dazwischen ist nicht null (read-then-write, dieselbe Klasse wie Entwurf §6.9), nur Millisekunden breit.
 *
 * @param array $user Der angemeldete Benutzer. 🔴 Nur `admin` -- auch fuer den Trockenlauf.
 * @return array<string, mixed>
 */
function avesmapsGaretienWikiNachzug(
    PDO $pdo,
    array $user,
    bool $trockenlauf = true,
    int $deckel = AVESMAPS_GARETIEN_WIKI_NACHZUG_DECKEL,
    int $abId = 0
): array {
    // 🔴 DER RIEGEL STEHT AUCH HIER, nicht nur am Endpunkt: ein kuenftiger zweiter Aufrufer erbt ihn,
    // statt ihn vergessen zu koennen.
    if (!avesmapsUserCan($user, 'admin')) {
        throw new RuntimeException('Das Nachziehen der Wiki-Schluessel ist Administratoren vorbehalten.');
    }
    $deckel = $deckel > 0 ? min(AVESMAPS_GARETIEN_WIKI_NACHZUG_DECKEL_MAX, $deckel) : AVESMAPS_GARETIEN_WIKI_NACHZUG_DECKEL;
    $abId = max(0, $abId);
    $userId = (int) ($user['id'] ?? 0);

    $vermerkRegionen = avesmapsGaretienWikiNachzugVermerkRegionen($pdo);
    $regionen = avesmapsGaretienWikiNachzugZeilenJe(
        $pdo,
        'SELECT id, public_id, name, is_active, wiki_region_key, wiki_url, label_public_id
           FROM ecosystem_region WHERE public_id IN ({ids})',
        $vermerkRegionen
    );
    $andereZiele = 0;
    foreach ($vermerkRegionen as $regionId) {
        if (!isset($regionen[$regionId])) {
            $andereZiele++;
        }
    }
    uasort($regionen, static fn (array $x, array $y): int => (int) $x['id'] <=> (int) $y['id']);

    $labels = avesmapsGaretienWikiNachzugZeilenJe(
        $pdo,
        "SELECT public_id, feature_type, is_active, properties_json
           FROM map_features WHERE feature_type = 'label' AND public_id IN ({ids})",
        array_map(static fn (array $r): string => (string) ($r['label_public_id'] ?? ''), $regionen)
    );

    $uebersprungen = array_fill_keys(AVESMAPS_GARETIEN_WIKI_NACHZUG_GRUENDE, 0);
    $kandidaten = [];
    $widersprueche = [];
    foreach ($regionen as $region) {
        $label = $labels[(string) ($region['label_public_id'] ?? '')] ?? null;
        $urteil = avesmapsGaretienWikiNachzugUrteil($region, $label);
        if ($urteil['grund'] === 'setzen') {
            // W1 (Nachbesserung Runde 1, 14.09.2026): NUR wenn die primaere Beschriftung allein schon
            // "setzen" ergeben haette, lohnt der zusaetzliche Lese-Aufwand -- "mindestens je Kandidat,
            // der sonst wuerde_setzen waere" (Ruling). DENSELBEN Leser wie der Durchtrag
            // (avesmapsEcosystemRegionLabelPublicIds, ecosystem.php:3649), mit denselben Parametern --
            // keine eigene Abfrage. Die primaere eigene id wird abgezogen, der Rest gebuendelt gelesen.
            $andereIds = array_values(array_diff(
                avesmapsEcosystemRegionLabelPublicIds($pdo, (string) $region['public_id'], (string) ($region['label_public_id'] ?? '')),
                [(string) ($label['public_id'] ?? '')]
            ));
            if ($andereIds !== []) {
                $andereLabels = avesmapsGaretienWikiNachzugZeilenJe(
                    $pdo,
                    "SELECT public_id, feature_type, is_active, properties_json
                       FROM map_features WHERE public_id IN ({ids})",
                    $andereIds
                );
                $urteil = avesmapsGaretienWikiNachzugUrteil($region, $label, array_values($andereLabels));
            }
        }
        if ($urteil['grund'] === 'setzen') {
            $kandidaten[] = [
                'region_id' => (int) $region['id'],
                'public_id' => (string) $region['public_id'],
                'name' => (string) $region['name'],
                'wiki_key' => $urteil['wiki_key'],
                'wiki_url' => $urteil['wiki_url'],
            ];
            continue;
        }
        $uebersprungen[$urteil['grund']]++;
        if ($urteil['grund'] === 'anderer_schluessel' && count($widersprueche) < AVESMAPS_GARETIEN_WIKI_NACHZUG_STICHPROBE) {
            $widersprueche[] = [
                'region_id' => (int) $region['id'],
                'public_id' => (string) $region['public_id'],
                'name' => (string) $region['name'],
                'region_schluessel' => (string) $region['wiki_region_key'],
                'beschriftung_schluessel' => $urteil['wiki_key'],
            ];
        }
    }

    $offen = array_values(array_filter($kandidaten, static fn (array $k): bool => $k['region_id'] > $abId));
    $ergebnis = [
        'dry_run' => $trockenlauf,
        'vermerke' => count($vermerkRegionen),
        'andere_ziele' => $andereZiele,
        'geprueft' => count($regionen),
        'wuerde_setzen' => count($kandidaten),
        'uebersprungen' => $uebersprungen,
        'stichprobe' => array_slice($offen, 0, AVESMAPS_GARETIEN_WIKI_NACHZUG_STICHPROBE),
        'widersprueche' => $widersprueche,
        'ab_id' => $abId,
        'deckel' => $deckel,
        'gesetzt' => 0,
        'inzwischen_erledigt' => 0,
        'fehler' => [],
        'cursor' => null,
        'remaining' => count($offen),
    ];
    if ($trockenlauf) {
        return $ergebnis;
    }

    $block = array_slice($offen, 0, $deckel);
    foreach ($block as $kandidat) {
        $ergebnis['cursor'] = $kandidat['region_id'];
        try {
            $jetzt = avesmapsGaretienWikiNachzugZeilenJe(
                $pdo,
                'SELECT public_id, is_active, wiki_region_key FROM ecosystem_region WHERE public_id IN ({ids})',
                [$kandidat['public_id']]
            )[$kandidat['public_id']] ?? null;
            if (!is_array($jetzt) || (int) $jetzt['is_active'] !== 1 || trim((string) ($jetzt['wiki_region_key'] ?? '')) !== '') {
                $ergebnis['inzwischen_erledigt']++;
                continue;
            }
            // Dieselben ZWEI Signale wie der Panel-Knopf (avesmapsEcosystemAssignIsDryRun): der
            // Hausschreiber geht nur mit `dry_run === false` UND `confirm === 'apply'` scharf.
            avesmapsAssignEcosystemWikiRegion($pdo, [
                'region_public_ids' => [$kandidat['public_id']],
                'wiki_url' => $kandidat['wiki_url'],
                'dry_run' => false,
                'confirm' => 'apply',
            ], $userId);
            $ergebnis['gesetzt']++;
        } catch (InvalidArgumentException $abbruch) {
            // Eigene Pruefung des Hausschreibers, benennt das Feld -- darf nach draussen.
            $ergebnis['fehler'][] = [
                'region_id' => $kandidat['region_id'],
                'public_id' => $kandidat['public_id'],
                'name' => $kandidat['name'],
                'grund' => mb_substr($abbruch->getMessage(), 0, 300, 'UTF-8'),
            ];
        } catch (Throwable $abbruch) {
            // 🔴 Gemeldet, nicht geschluckt -- aber der Datenbanktext geht ins Protokoll, nicht in die
            // Antwort (AGENTS.md §10, Meilenstein M1). Der Lauf geht mit der naechsten Region weiter.
            error_log('garetien-wiki-nachzug: Region ' . $kandidat['public_id'] . ': ' . $abbruch->getMessage());
            $ergebnis['fehler'][] = [
                'region_id' => $kandidat['region_id'],
                'public_id' => $kandidat['public_id'],
                'name' => $kandidat['name'],
                'grund' => 'Die Region konnte nicht geschrieben werden (Einzelheiten im Fehlerprotokoll).',
            ];
        }
    }
    $ergebnis['remaining'] = count($offen) - count($block);

    return $ergebnis;
}
