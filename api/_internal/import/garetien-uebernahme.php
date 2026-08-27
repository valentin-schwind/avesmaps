<?php

declare(strict_types=1);

// Die Uebernahme -- der EINZIGE Schreibweg dieses Imports.
// Entwurf: docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md §5.3
//
// 🔴 GESCHRIEBEN WIRD NUR, WAS ANGEHAKT IST. Ein nicht genanntes Item bleibt unberuehrt --
// dieselbe Regel wie beim Sammel-Speichern der Weg-Ebene (AGENTS.md §11): "geschrieben wird
// NUR, was jemand angefasst hat".
//
// 🔴 UND ES WIRD KEIN ZWEITER SCHREIBER GEBAUT. Kartenobjekte legt avesmapsCreatePathFeature /
// avesmapsCreateLabelFeature an, Quellen avesmapsFeatureSourceUpsert / …Link -- mit ihrer
// Transaktion, ihrer Revision, ihrem Protokoll. Ein eigenes INSERT in map_features waere der
// zweite Erzeuger, und eine Regel, die einen von zwei Erzeugern bindet, ist keine.

require_once __DIR__ . '/garetien-plan.php';
require_once __DIR__ . '/../map/features.php';
require_once __DIR__ . '/../app/feature-sources.php';
require_once __DIR__ . '/../app/ecosystem.php';

// 🔴 ES IST EIN BRIEFSPIEL, KEIN EIGENER TYP (Owner 27.08.2026: „wichtig ist auch die kategorie
// der quelle ... beispiel Briefspiel (Weiden)"). garetien.de und koschwiki.de sind genau das --
// Briefspiele --, und das Haus fuehrt diese Form seit langem: die Beschriftung nennt das
// Briefspiel, die Adresse den Artikel. Live gemessen 27.08.2026: 96 Briefspiel-Quellen im
// Katalog, darunter „Briefspiel (Weiden)" -> herzogtum-weiden.net und „Albernisches Briefspiel"
// -> westlande.de. Ein eigener Typ waere eine achte Kategorie fuer etwas, das die siebte schon
// beschreibt -- und er haette in JEDER Whitelist nachgetragen werden muessen.
//
// ⚠️ Die Herkunft bleibt `garetien`: sie ist ein anderes Feld und beantwortet eine andere Frage
// -- nicht „was fuer eine Quelle ist das", sondern „wer hat diese Zeile geschrieben". Daran
// erkennt ein spaeterer Lauf seine eigenen Zeilen wieder und laesst Handarbeit stehen.
const AVESMAPS_GARETIEN_SOURCE_TYPE = 'briefspiel';
const AVESMAPS_GARETIEN_SOURCE_ORIGIN = 'garetien';

/**
 * Die public_id aus der Antwort eines Hausschreibers lesen.
 *
 * 🪤 DREI SCHREIBER, DREI ANTWORTFORMEN fuer dieselbe Frage -- gemessen 27.08.2026:
 *   avesmapsCreatePathFeature / …LabelFeature -> GeoJSON-Feature, id oben, public_id in properties
 *   avesmapsCreateEcosystemRegion             -> ['region' => ['public_id' => …], 'revision' => …]
 *   avesmapsCreateEcosystemArea               -> ['area'   => […], 'revision' => …]
 * Ein geratener Schluessel liefert '' -- und "ohne public_id angelegt" ist von "gar nicht
 * angelegt" nicht zu unterscheiden, obwohl das Objekt in der Tabelle steht. Deshalb EIN Leser,
 * der alle drei kennt, und ein lautes Werfen statt eines leeren Strings.
 */
function avesmapsGaretienPublicIdAus(array $antwort, string $was): string
{
    foreach ([
        $antwort['id'] ?? null,
        $antwort['public_id'] ?? null,
        $antwort['properties']['public_id'] ?? null,
        $antwort['region']['public_id'] ?? null,
        $antwort['area']['public_id'] ?? null,
    ] as $kandidat) {
        if (is_string($kandidat) && $kandidat !== '') {
            return $kandidat;
        }
    }

    throw new RuntimeException($was . ' wurde ohne public_id angelegt.');
}

/**
 * Der Mittelpunkt eines Rings -- der Punkt, an dem das Label der Flaeche sitzt.
 *
 * ⚠️ Ein Flaechenschwerpunkt, kein "Pol der Unzugaenglichkeit". Der waere schoener (polylabel
 * setzt ihn im Frontend), lebt aber im Browser; ihn hier in PHP nachzubauen waere eine zweite
 * Wahrheit ueber dieselbe Frage. Ein Editor kann das Label jederzeit verschieben.
 */
function avesmapsGaretienRingMittelpunkt(array $ring): array
{
    $n = count($ring);
    if ($n === 0) {
        return [0.0, 0.0];
    }
    $sx = 0.0;
    $sy = 0.0;
    foreach ($ring as $p) {
        $sx += (float) $p[0];
        $sy += (float) $p[1];
    }

    return [$sx / $n, $sy / $n];
}

/**
 * Die Quelle eines uebernommenen Objekts -- ueber das VORHANDENE System.
 *
 * 💣 DIE LIZENZ GEHOERT EINMAL AN DIE QUELLE, NICHT 289-MAL AN DIE OBJEKTE. `sources` hat keine
 * Lizenzspalte und bekommt auch keine: die Lizenz ist eine Eigenschaft von garetien.de, nicht
 * von jedem einzelnen Bach. Sie in jedes `label` zu schreiben waere exakt die Duplizierung, die
 * das Lore-Quellensystem eine Migration gekostet hat (AGENTS.md §5). Getragen wird sie vom
 * `source_type` -- die Infobox rendert dafuer EINMAL "Garetien.de, CC BY-NC-SA 3.0".
 */
function avesmapsGaretienQuelleAnlegen(PDO $pdo, string $entityType, string $publicId, array $quelle, int $userId): bool
{
    $url = trim((string) ($quelle['url'] ?? ''));
    if ($url === '') {
        return false;
    }
    // 🔴 Lizenz und Namensnennung kommen aus dem VORSCHLAG, nicht aus einer Konstanten hier.
    // Sie stehen im Plan, ein Mensch hat sie in der Vorschau gesehen, und sie landen als Daten
    // an der Quelle -- der Renderer kennt keinen Wirt und keinen Import mehr.
    $sourceId = avesmapsFeatureSourceUpsert(
        $pdo,
        $url,
        (string) ($quelle['label'] ?? $url),
        AVESMAPS_GARETIEN_SOURCE_TYPE,
        false,
        $userId,
        '',
        false,
        (string) ($quelle['license'] ?? ''),
        (string) ($quelle['attribution'] ?? '')
    );
    if ($sourceId <= 0) {
        return false;
    }
    avesmapsFeatureSourceLink($pdo, $entityType, $publicId, $sourceId, $userId, AVESMAPS_GARETIEN_SOURCE_ORIGIN);

    return true;
}

/**
 * Eine Flaeche anlegen: LABEL (Punkt) + ecosystem_region + ecosystem_area.
 *
 * 💣 DAS LABEL IST DAS TRAGENDE OBJEKT. Ein Label ist bei uns ein PUNKT, die Flaeche liegt in
 * `ecosystem_region` und haengt ueber `label_public_id` daran -- nach der Kaskadenregel nimmt
 * das Loeschen des letzten Labels Region UND Flaechen mit (AGENTS.md, Konfliktzentrum). Wer nur
 * die Flaeche anlegt, baut eine Region, die kein Mensch je wieder anfassen kann.
 *
 * @return array{public_id:string, entity_type:string}
 */
function avesmapsGaretienFlaecheAnlegen(PDO $pdo, array $nach, array $user, int $userId): array
{
    $ring = $nach['geometry']['coordinates'][0] ?? [];
    [$lx, $ly] = avesmapsGaretienRingMittelpunkt($ring);

    // 1. Das Label -- ein Punkt, und der Anker der ganzen Kaskade.
    // 💣 GETRENNTE lat/lng, UND SIE SIND VERTAUSCHT GEGENUEBER GeoJSON. Unsere Ringpunkte stehen
    // als [x, y] da, der Labelschreiber will `lat` (= y) und `lng` (= x) einzeln -- er baut daraus
    // selbst wieder [lng, lat]. Dieselbe Falle, vor der AGENTS.md §5 warnt (GeoJSON [x,y] gegen
    // Leaflet [lat,lng]); wer sie hier verwechselt, setzt jedes Label an eine gespiegelte Stelle
    // der Karte, und bei einem Punkt nahe der Diagonale faellt das nicht auf.
    // ⚠️ Der Subtyp des Labels IST der Art-Schluessel seiner Region -- so steht es an
    // avesmapsReadLabelSubtype, und 'see'/'meer'/'suempfe_moore' sind dort gueltig.
    $label = avesmapsCreateLabelFeature($pdo, [
        'text' => (string) $nach['name'],
        'feature_subtype' => (string) $nach['subtyp'],
        'lng' => $lx,
        'lat' => $ly,
    ], $user);
    $labelId = avesmapsGaretienPublicIdAus($label, 'Das Label der Flaeche');

    // 2. Region und Flaeche, ueber die Hausfunktionen der Landschaften-Ebene.
    // ⚠️ `auto_name` ausdruecklich false: der Name kommt aus Volkers Daten, nicht aus dem
    // Zeichengriff. Ohne das leitete der Dialog spaeter "automatisch benannt" ab und sperrte das
    // Namensfeld -- derselbe Merker, den auch der Zeichner mitschickt.
    $region = avesmapsCreateEcosystemRegion($pdo, [
        'name' => (string) $nach['name'],
        'auto_name' => false,
        'kind' => (string) $nach['kind'],
        'region_type' => (string) $nach['subtyp'],
        'label_public_id' => $labelId,
    ], $userId);
    $regionId = avesmapsGaretienPublicIdAus($region, 'Die Region');
    avesmapsCreateEcosystemArea($pdo, [
        'region_public_id' => $regionId,
        'geometry' => $nach['geometry'],
    ], $userId);

    return ['public_id' => $regionId, 'entity_type' => 'region', 'label_public_id' => $labelId];
}

/**
 * EIN Haeppchen der Uebernahme, fuer die vorhandene Vorschau (api/edit/wiki/sync-plan.php).
 *
 * 🔴 DAS IST DIE EINE TUER. Der Endpunkt des Imports hat bewusst KEIN eigenes `apply` mehr: die
 * Hausttuer traegt den Einzelflug-Riegel, die zweite Bestaetigung fuer Loeschungen, das Protokoll
 * und den Fortschritt. Zwei Tueren auf denselben Schreibweg waeren zwei Erzeuger, und eine Regel,
 * die einen von zweien bindet, ist keine.
 *
 * ⚠️ Die Form der Rueckgabe gehoert der Vorschau, nicht uns -- `done` beendet die Haeppchenkette,
 * `remaining` treibt den Fortschritt. Ein `done`, das nie true wird, dreht den Client im Kreis;
 * deshalb vermerkt die Uebernahme JEDE Zeile, auch die abgelehnte.
 */
function avesmapsGaretienApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array
{
    $budget = $budget ?? AVESMAPS_SYNC_PLAN_APPLY_BUDGET;
    // ⚠️ DDL oben, einmal, VOR jeder Transaktion: MySQL committet eine offene Transaktion, sobald
    // es DDL sieht.
    avesmapsEnsureSyncPlanTables($pdo);
    avesmapsEnsureFeatureSourceTables($pdo);

    $offen = avesmapsSyncPlanPendingItems($pdo, $runId, $budget);
    $ids = array_map(static fn(array $r): int => (int) $r['id'], $offen);
    $ergebnis = avesmapsGaretienUebernehmen($pdo, $runId, $ids, is_array($user) ? $user : ['id' => $userId]);
    $rest = avesmapsSyncPlanPendingCount($pdo, $runId);

    return [
        // Fertig, wenn nichts mehr offen ist.
        // 🪤 Hier stand „nicht, wenn dieses Haeppchen leer war" -- als waeren das zwei Dinge. Sind
        // sie nicht: `$ids` IST die (gedeckelte) Liste der offenen Zeilen, ein leeres Haeppchen
        // heisst also immer, dass nichts mehr offen ist. Die Mutationsprobe hat den Satz
        // widerlegt, und er blieb stehen, weil er plausibel klang. Der ECHTE Unterschied ist ein
        // anderer und kleiner: gezaehlt wird NACH dem Haeppchen, also sieht die Zahl auch, was
        // inzwischen woanders vermerkt wurde.
        'done' => $rest === 0,
        'applied' => $ergebnis['angelegt'],
        // Ein Import loescht nichts.
        'deleted' => 0,
        'stale' => 0,
        'processed' => count($ids),
        'remaining' => $rest,
        'skipped' => count($ergebnis['fehler']),
        'declined' => 0,
    ];
}

/**
 * Die angehakten Vorschlaege eines Vorschau-Laufs uebernehmen.
 *
 * @param list<int> $itemIds Nur diese Items -- alles andere bleibt unberuehrt.
 * @return array{angelegt:int, quellen:int, fehler:list<array{item:int, grund:string}>}
 */
function avesmapsGaretienUebernehmen(PDO $pdo, int $runId, array $itemIds, array $user = []): array
{
    if ($itemIds === []) {
        return ['angelegt' => 0, 'quellen' => 0, 'fehler' => []];
    }
    // ⚠️ Das selbstheilende DDL steht beim ENDPUNKT, nicht hier -- wie bei zoom-bands.php. Eine
    // Bibliothek, die beim Schreiben Tabellen anlegt, laesst sich gegen keine andere Datenbank
    // pruefen als die, fuer die ihr DDL geschrieben ist.

    $userId = (int) ($user['id'] ?? 0);
    $platzhalter = implode(',', array_fill(0, count($itemIds), '?'));
    $stmt = $pdo->prepare(
        'SELECT id, entity_key, change_type, label, after_json, apply_state'
        . ' FROM sync_plan_item WHERE run_id = ? AND id IN (' . $platzhalter . ') ORDER BY id'
    );
    $stmt->execute(array_merge([$runId], array_map('intval', $itemIds)));

    $angelegt = 0;
    $quellen = 0;
    $fehler = [];

    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $item) {
        // 🔴 Zweimal uebernehmen legt NICHT zweimal an. Der Vermerk steht am Item, nicht an einer
        // eigenen Liste -- eine zweite Buchhaltung darueber, was schon geschrieben wurde, liefe
        // beim ersten Abbruch auseinander.
        if (($item['apply_state'] ?? null) === 'done') {
            continue;
        }
        $nach = json_decode((string) $item['after_json'], true);
        if (!is_array($nach) || ($nach['herkunft'] ?? '') !== 'garetien') {
            // 💣 VERMERKEN, nicht nur melden. Ein abgelehntes Item ohne Vermerk bleibt "offen",
            // und der Uebernahme-Schritt der Vorschau arbeitet in Haeppchen, bis nichts mehr offen
            // ist -- er kaeme nie zum Ende und der Fortschritt draehte sich im Kreis.
            $fehler[] = ['item' => (int) $item['id'], 'grund' => 'kein Garetien-Vorschlag'];
            avesmapsSyncPlanMarkItem($pdo, (int) $item['id'], 'failed', 'kein Garetien-Vorschlag');
            continue;
        }
        // 🔴 Nur ANLEGEN. 'changed' heisst hier "Artikel trifft, Geometrie widerspricht" -- das
        // ist eine Frage an einen Menschen, keine Anweisung, unser Objekt zu ueberschreiben.
        // Stufe 1 schreibt an keinem vorhandenen Objekt.
        if ((string) $item['change_type'] !== 'new') {
            $grund = 'Stufe 1 legt nur an und aendert nichts Vorhandenes -- "'
                . $item['label'] . '" braucht eine Entscheidung von Hand';
            $fehler[] = ['item' => (int) $item['id'], 'grund' => $grund];
            // 💣 Auch hier ein Vermerk -- siehe oben. `stale` und nicht `failed`: es ist nichts
            // kaputt, die Zeile gehoert nur nicht in diese Stufe.
            avesmapsSyncPlanMarkItem($pdo, (int) $item['id'], 'stale', mb_substr($grund, 0, 300, 'UTF-8'));
            continue;
        }

        try {
            if (($nach['ziel'] ?? '') === 'path') {
                $feature = avesmapsCreatePathFeature($pdo, [
                    'name' => (string) $nach['name'],
                    'feature_subtype' => (string) $nach['subtyp'],
                    'coordinates' => $nach['geometry']['coordinates'],
                ], $user);
                $publicId = avesmapsGaretienPublicIdAus($feature, 'Der Weg');
                $entityType = 'path';
            } else {
                $ergebnis = avesmapsGaretienFlaecheAnlegen($pdo, $nach, $user, $userId);
                $publicId = $ergebnis['public_id'];
                $entityType = $ergebnis['entity_type'];
            }
            $angelegt++;
            if (avesmapsGaretienQuelleAnlegen($pdo, $entityType, $publicId, (array) ($nach['quelle'] ?? []), $userId)) {
                $quellen++;
            }
            avesmapsSyncPlanMarkItem($pdo, (int) $item['id'], 'done', $publicId);
        } catch (Throwable $abbruch) {
            // 🔴 Ein Fehlschlag bei EINEM Objekt haelt die uebrigen nicht auf, aber er wird
            // benannt. Ein stiller Ueberspringer waere von "wurde angelegt" nicht zu
            // unterscheiden -- und die Zahl im Ergebnis waere eine Behauptung.
            $fehler[] = ['item' => (int) $item['id'], 'grund' => $abbruch->getMessage()];
            avesmapsSyncPlanMarkItem($pdo, (int) $item['id'], 'failed', mb_substr($abbruch->getMessage(), 0, 300, 'UTF-8'));
        }
    }

    return ['angelegt' => $angelegt, 'quellen' => $quellen, 'fehler' => $fehler];
}
