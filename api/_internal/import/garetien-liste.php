<?php

declare(strict_types=1);

// Die Arbeitsliste des Fensters -- der Leseweg fuer die kommende Oberflaeche (Aufgabe 8).
// Entwurf: .superpowers/sdd/2026-08-27-garetien-importer-fenster/task-8-brief.md
//
// 🔴 REIN LESEND, und OHNE die 200er-Deckelung von avesmapsSyncPlanItems -- "das ist ihr ganzer
// Zweck, und 259 Zeilen sind kein Mengenproblem" (Mockup §4).
//
// 🔴 SIE SITZT HIER UND NICHT AN sync-plan.php: sie liest garetien_import_row (die 49 + 6 Zeilen,
// die gar keinen Vorschlag erzeugen) -- und was diese Tabelle kennt, steht innerhalb des
// Importers (Auftrag §5.5). Ein `liste` an sync-plan.php muessten die anderen sieben Arten
// mittragen.

require_once __DIR__ . '/garetien-plan.php';

/** So viele Objekte je Antwort -- der Rest blaettert ueber `versatz`. */
const AVESMAPS_GARETIEN_LISTE_MAX = 500;

/**
 * Der Objekt-Schluessel EINES sync_plan_item -- alles vor dem ersten "|".
 *
 * 🔴 RULING P6 (Aufgabe 3, in garetien-plan.php): ein Abschnitts-Item traegt
 * `<basis>|<anlass>|<public_id>`, ein einfacher Neu-/Geaendert-Eintrag nur `<basis>` -- OHNE
 * Pipe. Am ersten "|" zu splitten liefert in beiden Faellen dieselbe Basis wie
 * avesmapsGaretienObjektSchluesselAusZeile, und das ist auch der einzige Ort, an dem diese
 * Formel entsteht -- hier wird sie nur benutzt, nie ein zweites Mal gebaut.
 */
function avesmapsGaretienObjektSchluessel(string $entityKey): string
{
    $pos = strpos($entityKey, '|');

    return $pos === false ? $entityKey : substr($entityKey, 0, $pos);
}

/** Die AEUSSERE Punktliste einer after.geometry -- LineString flach, Polygon sein erster Ring. */
function avesmapsGaretienListeGeometriePunkte(array $geometry): array
{
    $koordinaten = $geometry['coordinates'] ?? [];
    if (($geometry['type'] ?? '') === 'Polygon') {
        return (array) ($koordinaten[0] ?? []);
    }

    return (array) $koordinaten;
}

/**
 * Der Wiki-Link EINER Staging-Zeile -- fuer Objekte OHNE Item (Aufgabe 6: deckt_sich ohne
 * Ergaenzung, und uebersprungen). Ein Objekt mit Item liest seinen Link aus after.quelle.url;
 * diese kleine Formel deckt nur den Rest ab, der kein `after` hat.
 */
function avesmapsGaretienListeWikiUrlAusZeile(array $zeile): string
{
    $artikel = trim((string) ($zeile['artikel'] ?? ''));
    $namensraum = trim((string) ($zeile['namensraum'] ?? ''));
    $wiki = (string) ($zeile['wiki'] ?? 'ggp');
    $seite = ($namensraum !== '' ? $namensraum . ':' : '') . $artikel;
    $wirt = $wiki === 'kosch' ? 'https://www.koschwiki.de' : 'https://www.garetien.de';
    if ($seite === '') {
        return $wirt;
    }
    $basis = $wiki === 'kosch' ? AVESMAPS_GARETIEN_BASIS_KOSCH : AVESMAPS_GARETIEN_BASIS_GGP;

    return $basis . str_replace(' ', '_', $seite);
}

/**
 * Das FEINERE Urteil je Objekt (Brief Schritt 5). Feiner als der Staging-Wert: eine Zeile mit
 * `urteil='deckt_sich'` und Ergaenzungs-Items heisst hier 'ergaenzung' -- der Staging-Wert sagt,
 * was der Abgleich FAND, dieses Urteil sagt, was zu TUN ist.
 *
 * ⚠️ Reihenfolge ist eine PRIORITAET: der erste zutreffende Fall gewinnt, es wird nicht gezaehlt.
 *
 * @param list<array{anlass:?string, change_type:string}> $items
 */
function avesmapsGaretienListeObjektUrteil(array $items, string $stagingUrteil): string
{
    if ($items === []) {
        return $stagingUrteil;
    }
    foreach ($items as $item) {
        if (in_array($item['anlass'], ['ergaenzung', 'umbenennung', 'geometrie'], true)) {
            return 'ergaenzung';
        }
    }
    foreach ($items as $item) {
        if ($item['anlass'] === 'zufluss') {
            return 'zweifel';
        }
    }
    foreach ($items as $item) {
        if ($item['change_type'] === 'new') {
            return 'neu';
        }
    }
    foreach ($items as $item) {
        if ($item['change_type'] === 'changed' && in_array($item['anlass'], ['artikel_widerspruch', 'zufluss'], true)) {
            return 'widerspruch';
        }
    }

    return $stagingUrteil;
}

/**
 * Der Bearbeitungsstand je Objekt (Brief Schritt 6). Wieder eine Prioritaet: EIN uebernommenes
 * Item macht das GANZE Objekt uebernommen, egal was die uebrigen Items sagen.
 *
 * ⚠️ "declined" kommt aus sync_decision und ist fuer diesen Import heute nie erreichbar (der
 * Import erzeugt keine Loeschungen, und nur eine Loeschung wird dort dauerhaft abgelehnt) --
 * die Zeile steht trotzdem hier, wortgetreu nach Brief Schritt 6, fuer den Tag, an dem ein
 * Ablehnungsweg dazukommt.
 *
 * @param list<array{selected:int, apply_state:?string, declined:bool}> $items
 */
function avesmapsGaretienListeObjektStand(array $items): string
{
    if ($items === []) {
        return 'offen';
    }
    foreach ($items as $item) {
        if ($item['apply_state'] === 'done') {
            return 'uebernommen';
        }
    }
    $alleAbgelehnt = true;
    foreach ($items as $item) {
        if (!$item['declined']) {
            $alleAbgelehnt = false;
            break;
        }
    }
    if ($alleAbgelehnt) {
        return 'abgelehnt';
    }
    foreach ($items as $item) {
        if ((int) $item['selected'] === 1) {
            return 'vorgemerkt';
        }
    }

    return 'offen';
}

/**
 * Passt ein fertig gebautes Objekt auf den Filter? REIN -- kein I/O.
 *
 * 💣 `ebene`/`typ`/`urteil`/`wiki` sind LISTEN (Mehrfachauswahl): eine leere Liste heisst
 * "kein Filter", nicht "nichts passt".
 */
function avesmapsGaretienListeObjektPasstFilter(array $objekt, array $filter): bool
{
    foreach (['ebene', 'typ', 'urteil', 'wiki'] as $feld) {
        $erlaubt = (array) ($filter[$feld] ?? []);
        if ($erlaubt !== [] && !in_array($objekt[$feld], $erlaubt, true)) {
            return false;
        }
    }
    // ⚠️ Fehlt der Schluessel GANZ (kein 'stand' im Filter), gilt "alle Staende zeigen" -- der
    // Endpunkt schickt immer einen Reiter, ein direkter Aufruf (Test, spaeterer Leser) darf
    // trotzdem den ganzen Bestand sehen.
    if (isset($filter['stand'])) {
        $stand = trim((string) $filter['stand']);
        if ($stand !== '' && $objekt['stand'] !== $stand) {
            return false;
        }
    }
    if (($filter['nur_mehrteilig'] ?? false) === true && count($objekt['abschnitte']) <= 1) {
        return false;
    }
    if (($filter['nur_ungehakt'] ?? false) === true) {
        $hatUngehaktes = false;
        foreach ($objekt['items'] as $item) {
            if ((int) $item['selected'] === 0) {
                $hatUngehaktes = true;
                break;
            }
        }
        if (!$hatUngehaktes) {
            return false;
        }
    }
    $suche = trim(mb_strtolower((string) ($filter['suche'] ?? ''), 'UTF-8'));
    if ($suche !== '' && !str_contains(mb_strtolower((string) $objekt['name'], 'UTF-8'), $suche)) {
        return false;
    }

    return true;
}

/**
 * Die Arbeitsliste: EINE Zeile je Objekt, ihre Items daran -- und die Zeilen, die gar kein Item
 * erzeugen (Aufgabe 6: "deckt sich" ohne Ergaenzung, "uebersprungen"), trotzdem sichtbar.
 *
 * @param array{ebene?:list<string>, typ?:list<string>, urteil?:list<string>, wiki?:list<string>,
 *              suche?:string, nur_ungehakt?:bool, nur_mehrteilig?:bool, stand?:string,
 *              versatz?:int, anzahl?:int} $filter
 */
function avesmapsGaretienArbeitsliste(PDO $pdo, int $importRunId, array $filter): array
{
    $leer = [
        'ok' => true,
        'plan_run_id' => 0,
        'gesamt' => 0,
        'objekte' => [],
        'bilanz' => ['neu' => 0, 'ergaenzung' => 0, 'zweifel' => 0, 'widerspruch' => 0, 'deckt_sich' => 0, 'uebersprungen' => 0],
        'reiter' => ['offen' => 0, 'vorgemerkt' => 0, 'abgelehnt' => 0, 'uebernommen' => 0],
        'facetten' => ['ebene' => [], 'typ' => [], 'urteil' => [], 'wiki' => []],
        'angehakt' => ['new' => 0, 'changed' => 0],
    ];

    // 1. Der offene Vorschau-Lauf. Keiner da -> leere, aber gueltige Antwort (kein Fehler: das
    // ist der Normalfall vor dem ersten Rechnen).
    $lauf = avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND);
    if ($lauf === null) {
        return $leer;
    }
    $planRunId = (int) $lauf['id'];

    // 2. ALLE Items des Laufs -- OHNE LIMIT und NICHT ueber avesmapsSyncPlanItems (die deckelt
    // bei 200 je Gruppe, und genau das soll hier wegfallen).
    $itemStmt = $pdo->prepare(
        'SELECT id, entity_key, change_type, before_json, after_json, selected, apply_state'
        . ' FROM sync_plan_item WHERE run_id = :r ORDER BY id'
    );
    $itemStmt->execute([':r' => $planRunId]);
    $entscheidungen = avesmapsSyncPlanDecisions($pdo, AVESMAPS_GARETIEN_PLAN_KIND);

    $gruppen = [];              // Objektschluessel => Liste roher Items
    $angehaktNeu = 0;
    $angehaktGeaendert = 0;
    foreach ($itemStmt->fetchAll(PDO::FETCH_ASSOC) as $roh) {
        $entityKey = (string) $roh['entity_key'];
        $changeType = (string) $roh['change_type'];
        $after = json_decode((string) ($roh['after_json'] ?? ''), true);
        $before = json_decode((string) ($roh['before_json'] ?? ''), true);
        $entscheidungsSchluessel = avesmapsSyncPlanDecisionKey($entityKey, $changeType);

        $gruppen[avesmapsGaretienObjektSchluessel($entityKey)][] = [
            'id' => (int) $roh['id'],
            'change_type' => $changeType,
            'selected' => (int) $roh['selected'],
            'apply_state' => $roh['apply_state'] !== null ? (string) $roh['apply_state'] : null,
            'declined' => ($entscheidungen[$entscheidungsSchluessel]['declined_at'] ?? null) !== null,
            'after' => is_array($after) ? $after : [],
            'before' => is_array($before) ? $before : [],
        ];

        // `angehakt` zaehlt den GANZEN Lauf (fuer Aufgabe 16), nicht die gefilterte Sicht.
        if ((int) $roh['selected'] === 1) {
            if ($changeType === 'new') {
                $angehaktNeu++;
            } elseif ($changeType === 'changed') {
                $angehaktGeaendert++;
            }
        }
    }

    // 3. Die Staging-Zeilen dazuholen. RULING P1 (Aufgabe 6) hat urteil/grund an diese Tabelle
    // gehaengt -- genau die zwei Spalten, die diese Liste fuer die Zeilen OHNE Item braucht.
    $zeilenStmt = $pdo->prepare(
        'SELECT wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige, lodmin, lodmax, extra, geo_art, geo, urteil, grund'
        . ' FROM garetien_import_row WHERE run_id = :r ORDER BY id'
    );
    $zeilenStmt->execute([':r' => $importRunId]);
    $zeilenNachSchluessel = [];
    foreach ($zeilenStmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        // 💣 Derselbe Schluessel wie in garetien-plan.php -- eine zweite Formel liefe beim ersten
        // Sonderzeichen auseinander und stuende dasselbe Objekt zweimal in der Liste.
        $zeilenNachSchluessel[avesmapsGaretienObjektSchluesselAusZeile($zeile)] = $zeile;
    }

    // 4. Objekte MIT Item bauen -- Name/Typ/Wiki/Ebene/Geometrie/Wiki-Link aus dem after des
    // ERSTEN Items, das sie traegt; ihre Staging-Zeile liefert nur urteil/grund UND die Felder,
    // die kein `after` kennt (lodmin/lodmax/extra), nach.
    $objekte = [];
    foreach ($gruppen as $key => $items) {
        $zeile = $zeilenNachSchluessel[$key] ?? null;
        unset($zeilenNachSchluessel[$key]);   // was danach uebrig bleibt, hat KEIN Item

        $erstesAfter = $items[0]['after'];

        // ⚠️ Nicht jedes Item traegt after.name (ein reines Quellen- oder Geometrie-Item nicht) --
        // genommen wird das ERSTE, das ihn wirklich hat, sonst der Name aus der Staging-Zeile.
        $name = '';
        foreach ($items as $item) {
            $kandidat = trim((string) ($item['after']['name'] ?? ''));
            if ($kandidat !== '') {
                $name = $kandidat;
                break;
            }
        }
        if ($name === '' && $zeile !== null) {
            $name = trim((string) ($zeile['anzeige'] ?? ''));
        }

        $abschnitte = [];
        foreach ($items as $item) {
            $abschnitt = $item['after']['abschnitt'] ?? null;
            if (is_array($abschnitt) && ($abschnitt['public_id'] ?? null) !== null) {
                // Mehrere Items (Luecke, Umbenennung, Geometrie) koennen denselben Abschnitt
                // nennen -- ueber die public_id entdoppelt, sonst stuende er mehrfach da.
                $abschnitte[(string) $abschnitt['public_id']] = [
                    'public_id' => (string) $abschnitt['public_id'],
                    'name' => (string) ($abschnitt['name'] ?? ''),
                    'punkte' => (int) ($abschnitt['punkte'] ?? 0),
                    'geometrie' => $abschnitt['geometrie'] ?? [],
                ];
            }
        }

        $urteilEingaben = [];
        foreach ($items as $item) {
            $urteilEingaben[] = ['anlass' => $item['after']['anlass'] ?? null, 'change_type' => $item['change_type']];
        }

        $objekte[$key] = [
            'key' => $key,
            'name' => $name,
            'typ' => (string) ($erstesAfter['typ'] ?? ($zeile['typ'] ?? '')),
            'wiki' => (string) ($erstesAfter['wiki'] ?? ($zeile['wiki'] ?? '')),
            'ebene' => (string) ($erstesAfter['ebene'] ?? ($zeile['ebene'] ?? '')),
            'urteil' => avesmapsGaretienListeObjektUrteil($urteilEingaben, (string) ($zeile['urteil'] ?? '')),
            'grund' => (string) ($zeile['grund'] ?? ($erstesAfter['urteil'] ?? '')),
            'abschnitte' => array_values($abschnitte),
            'geometrie' => avesmapsGaretienListeGeometriePunkte((array) ($erstesAfter['geometry'] ?? [])),
            'wiki_url' => (string) ($erstesAfter['quelle']['url'] ?? ($zeile !== null ? avesmapsGaretienListeWikiUrlAusZeile($zeile) : '')),
            'lodmin' => (string) ($zeile['lodmin'] ?? ''),
            'lodmax' => (string) ($zeile['lodmax'] ?? ''),
            'extra' => (string) ($zeile['extra'] ?? ''),
            'items' => array_map(static function (array $item): array {
                return [
                    'id' => $item['id'],
                    'anlass' => $item['after']['anlass'] ?? null,
                    'felder' => $item['after']['felder'] ?? [],
                    'selected' => $item['selected'],
                    'apply_state' => $item['apply_state'],
                    'before_name' => $item['before']['name'] ?? null,
                    'after_name' => $item['after']['name'] ?? null,
                    'abschnitt' => $item['after']['abschnitt'] ?? null,
                ];
            }, $items),
            'stand' => avesmapsGaretienListeObjektStand(array_map(static fn(array $item): array => [
                'selected' => $item['selected'],
                'apply_state' => $item['apply_state'],
                'declined' => $item['declined'],
            ], $items)),
        ];
    }

    // 5. Was jetzt noch in $zeilenNachSchluessel steht, hat KEIN Item -- die Zeilen, um die es in
    // Aufgabe 6 ging ("deckt sich" ohne Ergaenzung, "uebersprungen").
    foreach ($zeilenNachSchluessel as $key => $zeile) {
        $objekte[$key] = [
            'key' => $key,
            'name' => trim((string) ($zeile['anzeige'] ?? '')),
            'typ' => (string) ($zeile['typ'] ?? ''),
            'wiki' => (string) ($zeile['wiki'] ?? ''),
            'ebene' => (string) ($zeile['ebene'] ?? ''),
            'urteil' => (string) ($zeile['urteil'] ?? ''),
            'grund' => (string) ($zeile['grund'] ?? ''),
            'abschnitte' => [],
            'geometrie' => avesmapsGaretienZeilePunkte($zeile),
            'wiki_url' => avesmapsGaretienListeWikiUrlAusZeile($zeile),
            'lodmin' => (string) ($zeile['lodmin'] ?? ''),
            'lodmax' => (string) ($zeile['lodmax'] ?? ''),
            'extra' => (string) ($zeile['extra'] ?? ''),
            'items' => [],
            'stand' => 'offen',
        ];
    }

    // 6. Facetten und Bilanz zaehlen den LAUF -- VOR dem Filtern. Sonst faellt nach dem ersten
    // Klick jeder andere Wert auf 0, und der Trichter laesst sich nicht mehr oeffnen.
    $facetten = ['ebene' => [], 'typ' => [], 'urteil' => [], 'wiki' => []];
    $bilanz = ['neu' => 0, 'ergaenzung' => 0, 'zweifel' => 0, 'widerspruch' => 0, 'deckt_sich' => 0, 'uebersprungen' => 0];
    $reiter = ['offen' => 0, 'vorgemerkt' => 0, 'abgelehnt' => 0, 'uebernommen' => 0];
    foreach ($objekte as $objekt) {
        foreach (['ebene', 'typ', 'urteil', 'wiki'] as $feld) {
            $wert = (string) $objekt[$feld];
            $facetten[$feld][$wert] = ($facetten[$feld][$wert] ?? 0) + 1;
        }
        if (isset($bilanz[$objekt['urteil']])) {
            $bilanz[$objekt['urteil']]++;
        }
        if (isset($reiter[$objekt['stand']])) {
            $reiter[$objekt['stand']]++;
        }
    }

    // 7. Objekte NACH dem Filtern schneiden -- die Facetten oben blieben unberuehrt davon.
    $gefiltert = array_values(array_filter(
        $objekte,
        static fn(array $objekt): bool => avesmapsGaretienListeObjektPasstFilter($objekt, $filter)
    ));

    $gesamt = count($gefiltert);
    $versatz = max(0, (int) ($filter['versatz'] ?? 0));
    $anzahl = (int) ($filter['anzahl'] ?? AVESMAPS_GARETIEN_LISTE_MAX);
    if ($anzahl <= 0 || $anzahl > AVESMAPS_GARETIEN_LISTE_MAX) {
        $anzahl = AVESMAPS_GARETIEN_LISTE_MAX;
    }

    return [
        'ok' => true,
        'plan_run_id' => $planRunId,
        'gesamt' => $gesamt,
        'objekte' => array_slice($gefiltert, $versatz, $anzahl),
        'bilanz' => $bilanz,
        'reiter' => $reiter,
        'facetten' => $facetten,
        'angehakt' => ['new' => $angehaktNeu, 'changed' => $angehaktGeaendert],
    ];
}
