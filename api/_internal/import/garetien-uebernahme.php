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
 * GeoJSON `[x, y]` -> die Reihenfolge, die die Hausschreiber erwarten.
 *
 * 💣 `avesmapsReadLineStringCoordinates` (api/_internal/map/features.php) liest Element 0 als
 * `lat` und gibt `[$lng, $lat]` zurueck -- sie TAUSCHT. Ihr Eingangsvertrag ist damit Leaflet-
 * Reihenfolge `[lat, lng]`, und fuer ihren Hauptaufrufer (den Kartenzeichner im Editor) ist das
 * richtig. Unsere Punkte kommen aus `avesmapsGaretienNachAvesmaps` und stehen als GeoJSON `[x, y]`
 * da. Ohne diesen Umsetzer landet jeder importierte Weg an der Diagonale GESPIEGELT.
 *
 * 🔴 DIE HAUSFUNKTION WIRD NICHT GEAENDERT. Sie hat andere Aufrufer, die auf dem heutigen
 * Vertrag stehen -- der Editor schickt Leaflet-Reihenfolge. Wer dort dreht, repariert den Import
 * und zerbricht das Zeichnen.
 *
 * ⚠️ NUR FUER WEGE. Flaechen (`avesmapsEcosystemNormalizeGeometry`) tauschen nicht, und das
 * Label bekommt `lat`/`lng` ohnehin getrennt uebergeben. Wer diesen Umsetzer dort einhaengt,
 * baut den Fehler an zwei neuen Stellen ein.
 */
function avesmapsGaretienGeoJsonNachHausvertrag(array $punkte): array
{
    $raus = [];
    foreach ($punkte as $punkt) {
        $raus[] = [(float) $punkt[1], (float) $punkt[0]];
    }

    return $raus;
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
 * Ein vorhandenes Objekt ERGAENZEN -- und zwar nur in den Feldern, die im Vorschlag stehen.
 *
 * 💣 avesmapsUpdatePathFeatureDetails IST KEIN TEIL-UPDATE. Es liest `allowed_transports`,
 * `transport_seasons`, `show_label` und `feature_subtype` aus dem RUMPF und schreibt sie alle.
 * Mit Vorgabewerten gerufen loescht es die Verkehrsmittel und die Saisonfenster eines Flusswegs
 * -- lautlos, mit gueltiger Antwort und gueltiger id. Deshalb wird der aktuelle Stand gelesen und
 * unveraendert zurueckgegeben; geraten wird nichts.
 * ⭐ avesmapsUpdateEcosystemRegion hat das Problem NICHT -- es liest nur mitgeschickte Felder
 * (avesmapsEcosystemReadRegionFields). Die Asymmetrie steht hier, damit sie niemand
 * "vereinheitlicht".
 *
 * 🔴 KEIN EIGENES UPDATE auf map_features oder ecosystem_*. Die Hausschreiber tragen
 * Transaktion, Revision, Sperrpruefung und Protokoll -- ein eigenes UPDATE waere der zweite
 * Erzeuger, und eine Regel, die einen von zwei Erzeugern bindet, ist keine.
 *
 * @return array{felder:int, quellen:int}
 */
function avesmapsGaretienErgaenzungAnwenden(PDO $pdo, array $nach, string $publicId, array $user): array
{
    $felder = (array) ($nach['felder'] ?? []);
    $userId = (int) ($user['id'] ?? 0);
    $geschrieben = 0;

    if (($nach['ziel'] ?? '') === 'path') {
        $zeile = $pdo->prepare('SELECT name, feature_subtype, properties_json FROM map_features WHERE public_id = :p');
        $zeile->execute([':p' => $publicId]);
        $vorher = $zeile->fetch(PDO::FETCH_ASSOC);
        if ($vorher === false) {
            throw new RuntimeException('Der Abschnitt ' . $publicId . ' existiert nicht mehr.');
        }
        $props = json_decode((string) ($vorher['properties_json'] ?? '{}'), true);
        $props = is_array($props) ? $props : [];

        if (in_array('name', $felder, true)) {
            $gewuenschterName = (string) $nach['name'];
            // ⚠️ JEDES Feld des Hausschreibers reist mit seinem ALTEN Wert mit -- siehe oben.
            avesmapsUpdatePathFeatureDetails($pdo, [
                'public_id' => $publicId,
                'name' => $gewuenschterName,
                'feature_subtype' => (string) ($vorher['feature_subtype'] ?? 'Flussweg'),
                'show_label' => (bool) ($props['show_label'] ?? false),
                'allowed_transports' => $props['allowed_transports'] ?? null,
                'transport_seasons' => $props['transport_seasons'] ?? null,
                'other_source' => $props['other_source'] ?? null,
            ], $user);
            // 🔴 RUECKLESEN, BEVOR DER SCHREIBVORGANG ALS ERLEDIGT GILT -- dieselbe Regel wie an
            // der stillen MySQL-Kuerzung von `app_setting.setting_value` (AGENTS.md §10): "ein
            // Schreiber, dessen Wert zaehlt, muss ihn ZURUECKLESEN, bevor er den Schreibvorgang
            // als erledigt behandelt." `avesmapsUpdatePathFeatureDetails` schiebt den Namen durch
            // `avesmapsWikiPathEffectiveEditName`: traegt der Weg ein `properties.wiki_path` mit
            // kanonischem Namen, wird der Garetien-Name VERWORFEN und der Wiki-Name geschrieben --
            // lautlos, mit gueltiger Antwort. Ohne diese Pruefung waere das Item 'done' und nie
            // wiederholbar.
            $tatsaechlich = $pdo->prepare('SELECT name FROM map_features WHERE public_id = :p');
            $tatsaechlich->execute([':p' => $publicId]);
            $geschriebenerName = (string) $tatsaechlich->fetchColumn();
            if ($geschriebenerName !== $gewuenschterName) {
                throw new RuntimeException(
                    'Der Name "' . $gewuenschterName . '" wurde nicht uebernommen -- der Weg '
                    . $publicId . ' traegt einen zugewiesenen Wiki-Artikel und behaelt dessen '
                    . 'Namen "' . $geschriebenerName . '".'
                );
            }
            $geschrieben++;
        }
        if (in_array('geometrie', $felder, true)) {
            avesmapsUpdatePathFeatureGeometry($pdo, [
                'public_id' => $publicId,
                // 💣 GeoJSON [x,y] -> Hausvertrag, siehe avesmapsGaretienGeoJsonNachHausvertrag.
                'coordinates' => avesmapsGaretienGeoJsonNachHausvertrag((array) $nach['geometry']['coordinates']),
            ], $user);
            $geschrieben++;
        }
        $entityType = 'path';
    } else {
        if (in_array('name', $felder, true)) {
            avesmapsUpdateEcosystemRegion($pdo, [
                'public_id' => $publicId,
                'name' => (string) $nach['name'],
                'auto_name' => false,
            ], $userId);
            $geschrieben++;
        }
        // 🔴 RULING R6 (Owner, nach R5): geometrie ersetzen gilt fuer ALLE Formen -- Flaechen
        // UND Wege/Fluesse. R5 hatte versucht, diesen Zweig fuer Regionen wegzudefinieren; der
        // Owner widersprach woertlich: "geometrie ersetzen muss es fuer alle geometrien geben --
        // alle formen von flaechen UND wege/fluesse." Zwei echte Fehler bleiben zu reparieren:
        //
        // 💣 FALSCHER ID-RAUM. `entity_public_id` ist hier die REGIONS-public_id
        // (garetien-abgleich.php waehlt `r.public_id`), aber `avesmapsUpdateEcosystemAreaGeometry`
        // liest `ecosystem_area WHERE public_id` -- ein anderer id-Raum. Geloest wird das HIER,
        // im Anwender, nicht im Abgleich: die Regions-ID ist fuer alles andere die richtige (die
        // Quelle haengt an der Region, `avesmapsUpdateEcosystemRegion` will sie, und der
        // Quellenbestand aus Aufgabe 3 ist auf `region|<regions-id>` aufgebaut) -- die Flaeche
        // wird deshalb hier ueber die Region nachgeschlagen.
        if (in_array('geometrie', $felder, true)) {
            $flaeche = $pdo->prepare(
                'SELECT a.public_id, a.geometry_revision
                   FROM ecosystem_area a
                   JOIN ecosystem_region r ON a.region_id = r.id
                  WHERE r.public_id = :p AND a.is_active = 1 AND a.is_trial = 0'
            );
            $flaeche->execute([':p' => $publicId]);
            $flaechenZeilen = $flaeche->fetchAll(PDO::FETCH_ASSOC);
            // 💣 Eine Region kann MEHRERE Flaechen haben -- dann ist "ersetze die Geometrie" so
            // unwohldefiniert wie bei einem Weg mit mehreren getroffenen Abschnitten (siehe die
            // Begruendung am Erzeuger in garetien-plan.php). Geraten wird nicht: laut ablehnen,
            // mit einem lesbaren Grund, statt eine der Flaechen zufaellig zu treffen.
            if (count($flaechenZeilen) !== 1) {
                throw new RuntimeException(
                    'Region ' . $publicId . ' hat ' . count($flaechenZeilen) . ' Flaechen -- welche?'
                );
            }
            // 💣 DIE ERWARTETE REVISION IST HIER EIN WIRKUNGSLOSES SCHLOSS, UND DAS IST
            // ABSICHTLICH SO: sie ist ein optimistisches Schloss gegen zwei GLEICHZEITIGE
            // Bearbeiter, wir lesen sie aber UNMITTELBAR VORHER selbst -- sie kann also nie
            // veraltet sein, wenn wir sie mitschicken. Vertretbar ist das nur, weil die
            // Uebernahme unter dem Einzelflug-Riegel der Vorschau laeuft
            // (avesmapsWikiDumpLockAcquireOrThrow, api/edit/wiki/sync-plan.php) -- es schreibt
            // also ohnehin niemand parallel. Ohne diesen Satz "vereinfacht" der naechste Leser
            // den Riegel weg.
            avesmapsUpdateEcosystemAreaGeometry($pdo, [
                'public_id' => (string) $flaechenZeilen[0]['public_id'],
                'expected_revision' => (int) $flaechenZeilen[0]['geometry_revision'],
                'geometry' => $nach['geometry'],
            ], $userId);
            $geschrieben++;
        }
        $entityType = 'region';
    }

    $quellen = 0;
    if (in_array('quelle', $felder, true)
        && avesmapsGaretienQuelleAnlegen($pdo, $entityType, $publicId, (array) ($nach['quelle'] ?? []), $userId)) {
        $quellen = 1;
        $geschrieben++;
    }

    return ['felder' => $geschrieben, 'quellen' => $quellen];
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
 * Ein Item abschliessen: Vermerk setzen UND das Haekchen wegnehmen.
 *
 * 🔴 DIE ZWEITE HAELFTE IST TRAGEND, und sie ist dieselbe Regel wie bei 'decline' zwei Faelle
 * weiter im selben Endpunkt (api/edit/wiki/sync-plan.php): dort wird eine abgelehnte Zeile
 * ausdruecklich mit abgehakt, weil sie sonst „abgelehnt aussaehe -- und `apply` schriebe sie
 * trotzdem". Hier ist es die Gegenrichtung desselben Auseinanderlaufens.
 *
 * 💣 Ein vermerktes Item ist fuer JEDEN weiteren Schritt tot: `avesmapsSyncPlanPendingItems`
 * verlangt `apply_state IS NULL`, geschrieben wird es also nie wieder -- und
 * `avesmapsSyncPlanSetSelection` verlangt DASSELBE, der Editor bekommt sein Haekchen also auch
 * nicht mehr weg. Bliebe `selected = 1` stehen, zaehlte der Fussknopf des Fensters die Zeile
 * weiter mit und das Uebernahme-Blatt versprraeche sie erneut („2 von 2 werden uebernommen",
 * danach „1 uebernommen") -- genau die Falschaussage ueber eine Uebernahme, gegen die das
 * Beschneiden der Blattanzeige gebaut wurde. Und sie waere unentfernbar bis zum naechsten
 * Plan-Lauf.
 *
 * 🔴 ALLE Vermerke gehen hier durch, nicht nur `done`. `stale` und `failed` machen die Zeile
 * genauso tot -- eine Regel, die einen von mehreren Erzeugern bindet, ist keine Regel
 * (AGENTS.md §11, die Verkehrsmittel-Sperre).
 *
 * ⚠️ Der Riegel `apply_state IS NULL` in `avesmapsSyncPlanSetSelection` wirkt nicht gegen uns:
 * hier wird direkt geschrieben, in derselben Reihenfolge wie der Vermerk.
 */
function avesmapsGaretienItemAbschliessen(PDO $pdo, int $itemId, string $applyState, string $note = ''): void
{
    avesmapsSyncPlanMarkItem($pdo, $itemId, $applyState, $note);
    $pdo->prepare('UPDATE sync_plan_item SET selected = 0 WHERE id = :id')->execute(['id' => $itemId]);
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
        // 🔴 entity_public_id MUSS mit: der vierte Ausgang (change_type 'changed') braucht ihn
        // als ZIEL fuer avesmapsGaretienErgaenzungAnwenden -- ohne die Spalte in der Liste waere
        // er hier immer NULL, und jede Ergaenzung schluege auf ein nicht existierendes Objekt fehl.
        'SELECT id, entity_key, entity_public_id, change_type, label, after_json, apply_state'
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
            avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'failed', 'kein Garetien-Vorschlag');
            continue;
        }
        $anlass = (string) ($nach['anlass'] ?? '');
        if ((string) $item['change_type'] === 'changed') {
            // 🔴 DER VIERTE AUSGANG. Bis zum 27.08.2026 stand hier "Stufe 1 legt nur an und
            // aendert nichts Vorhandenes" -- richtig, solange es den Ausgang nicht gab, und ab
            // dann genau die Stelle, an der ein angehaktes Item lautlos als `stale` verschwand.
            // ⚠️ `widerspruch` bleibt draussen: Artikel trifft, Geometrie nicht -- das ist eine
            // Frage an einen Menschen und keine Anweisung, unser Objekt zu ueberschreiben.
            if (!in_array($anlass, ['ergaenzung', 'umbenennung', 'geometrie'], true)) {
                $grund = '"' . $item['label'] . '" braucht eine Entscheidung von Hand';
                $fehler[] = ['item' => (int) $item['id'], 'grund' => $grund];
                avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'stale', mb_substr($grund, 0, 300, 'UTF-8'));
                continue;
            }
            try {
                $ergebnis = avesmapsGaretienErgaenzungAnwenden(
                    $pdo, $nach, (string) $item['entity_public_id'], $user
                );
                $angelegt += $ergebnis['felder'] > 0 ? 1 : 0;
                $quellen += $ergebnis['quellen'];
                avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'done', (string) $item['entity_public_id']);
            } catch (Throwable $abbruch) {
                $fehler[] = ['item' => (int) $item['id'], 'grund' => $abbruch->getMessage()];
                avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'failed', mb_substr($abbruch->getMessage(), 0, 300, 'UTF-8'));
            }
            continue;
        }
        // 🔴 Nur ANLEGEN, sonst. Stufe 1 schreibt an keinem vorhandenen Objekt -- dieser Zweig
        // ist heute nur ein Riegel gegen einen change_type, den avesmapsGaretienBaueSyncPlan nie
        // erzeugt (nur 'new' und 'changed', AGENTS.md: "Kein Löschweg"), aber ein Riegel gegen
        // das Anlegen ist billiger als eine stillschweigend falsche Aktion.
        if ((string) $item['change_type'] !== 'new') {
            $grund = 'Stufe 1 legt nur an und aendert nichts Vorhandenes -- "'
                . $item['label'] . '" braucht eine Entscheidung von Hand';
            $fehler[] = ['item' => (int) $item['id'], 'grund' => $grund];
            // 💣 Auch hier ein Vermerk -- siehe oben. `stale` und nicht `failed`: es ist nichts
            // kaputt, die Zeile gehoert nur nicht in diese Stufe.
            avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'stale', mb_substr($grund, 0, 300, 'UTF-8'));
            continue;
        }

        try {
            if (($nach['ziel'] ?? '') === 'path') {
                $feature = avesmapsCreatePathFeature($pdo, [
                    'name' => (string) $nach['name'],
                    'feature_subtype' => (string) $nach['subtyp'],
                    // 💣 GeoJSON [x,y] -> Hausvertrag, siehe avesmapsGaretienGeoJsonNachHausvertrag.
                    'coordinates' => avesmapsGaretienGeoJsonNachHausvertrag((array) $nach['geometry']['coordinates']),
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
            avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'done', $publicId);
        } catch (Throwable $abbruch) {
            // 🔴 Ein Fehlschlag bei EINEM Objekt haelt die uebrigen nicht auf, aber er wird
            // benannt. Ein stiller Ueberspringer waere von "wurde angelegt" nicht zu
            // unterscheiden -- und die Zahl im Ergebnis waere eine Behauptung.
            $fehler[] = ['item' => (int) $item['id'], 'grund' => $abbruch->getMessage()];
            avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'failed', mb_substr($abbruch->getMessage(), 0, 300, 'UTF-8'));
        }
    }

    return ['angelegt' => $angelegt, 'quellen' => $quellen, 'fehler' => $fehler];
}
