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
require_once __DIR__ . '/garetien-wiki-landschaft.php';
require_once __DIR__ . '/../map/features.php';
require_once __DIR__ . '/../app/feature-sources.php';
require_once __DIR__ . '/../app/ecosystem.php';
require_once __DIR__ . '/../app/ecosystem-display.php';

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
 * Ein GeoJSON-Point `[x, y]` -> `['lng' => x, 'lat' => y]`, die Form, die
 * avesmapsCreatePointFeature/…LabelFeature/avesmapsMovePointFeature/…LabelFeature einzeln
 * verlangen (Entwurf §3.1/§3.4: Ort und Berggipfel sind bei uns PUNKTE, keine Flaeche/Linie).
 *
 * 💣 GETRENNTE lat/lng, UND SIE SIND VERTAUSCHT GEGENUEBER GeoJSON -- dieselbe Falle wie am
 * Flaechen-Mittelpunkt in avesmapsGaretienFlaecheAnlegen weiter unten (AGENTS.md §5: GeoJSON
 * [x,y] gegen Leaflet [lat,lng]). `$nach['geometry']['coordinates']` ist ein flaches [x,y]-Paar
 * (garetien-plan.php baut es fuer 'location'/'label' als `$punkte[0] ?? [0.0, 0.0]`), kein Ring.
 */
function avesmapsGaretienPunktAusGeometrie(array $nach): array
{
    $punkt = (array) ($nach['geometry']['coordinates'] ?? [0.0, 0.0]);

    return ['lng' => (float) ($punkt[0] ?? 0.0), 'lat' => (float) ($punkt[1] ?? 0.0)];
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
 * Das Gegenstueck zu avesmapsGaretienQuelleAnlegen: entity_type + die public_id, an der eine
 * 'quelle'-Verknuepfung WIRKLICH haengt -- fuer die Ruecknahme EINES 'quelle'-Items (Meldung,
 * 30.08.2026). Spiegelt DIESELBE Bindung wie avesmapsGaretienErgaenzungAnwenden weiter unten,
 * keine zweite Fassung derselben Entscheidung:
 *   ziel 'path'      -> entity_type 'path',      dieselbe public_id
 *   ziel 'location'  -> entity_type 'settlement', dieselbe public_id
 *   ziel 'label'     -> entity_type 'region',     dieselbe public_id (das Label TRAEGT die id)
 *   sonst (Flaeche)  -> entity_type 'region',     die public_id des LABELS der Region -- NICHT
 *                       der Region selbst (AGENTS.md §11: "die Quellen einer Landschaft liegen …
 *                       an ihrer BESCHRIFTUNG").
 *
 * @return array{0:string,1:string} [entity_type, quelle_public_id] -- die zweite ist '' bei
 *   einer Flaeche ohne Label (dieselbe "lieber laut als falsch"-Lage wie beim Anlegen).
 */
function avesmapsGaretienQuelleZielAufloesen(PDO $pdo, string $ziel, string $publicId): array
{
    if ($ziel === 'path') {
        return ['path', $publicId];
    }
    if ($ziel === 'location') {
        return ['settlement', $publicId];
    }
    if ($ziel === 'label') {
        return ['region', $publicId];
    }
    // Flaeche: $publicId ist die REGION, die Quelle haengt an ihrem LABEL.
    $labelDerRegion = $pdo->prepare('SELECT label_public_id FROM ecosystem_region WHERE public_id = :p');
    $labelDerRegion->execute([':p' => $publicId]);
    $labelId = trim((string) $labelDerRegion->fetchColumn());

    return ['region', $labelId];
}

/**
 * Die Verknuepfung LOESEN, die avesmapsGaretienQuelleAnlegen fuer EIN Objekt angelegt hat --
 * das Gegenstueck zum Anlegen, fuer die Ruecknahme eines 'quelle'-Items.
 *
 * 🔴 NUR feature_sources, NIE sources: eine geteilte Adresse darf durch die Ruecknahme
 * EINES Objekts nicht anderen Objekten ihre Quelle nehmen.
 *
 * ⭐ WIEDERVERWENDET avesmapsRemoveFeatureSource (api/_internal/app/feature-sources.php) statt
 * eines eigenen DELETE -- dieselbe Funktion, die der Quellen-Editor benutzt: sie bumpt
 * avesmapsNextMapRevision (die Karte liefert Quellen SYNCHRON mit der Nutzlast, AGENTS.md §5/§7)
 * und haengt am Grabstein-Riegel fuer origin='wiki_publication', der hier ohnehin nie greift
 * (eine garetien-Zeile traegt immer origin='garetien').
 *
 * ⚠️ ORIGIN WIRD VORHER GEPRUEFT, NICHT NACHHER VERTRAUT: geloescht werden nur die
 * source_id(s), deren FEATURE_SOURCES-ZEILE origin='garetien' traegt -- eine `manual`- oder
 * `wiki_publication`-Verknuepfung DERSELBEN oder einer ANDEREN Quelle am selben Objekt bleibt
 * unangetastet (eine der Zusicherungen des Auftrags).
 *
 * ⚠️ KEIN FEHLER, WENN NICHTS DA IST: eine bereits entfernte Verknuepfung macht die
 * Ruecknahme nicht ungueltig -- das Item faellt trotzdem zurueck nach 'offen'.
 *
 * @return int Anzahl der geloesten Verknuepfungen (0 oder mehr).
 */
function avesmapsGaretienQuelleRuecknahmeLoesen(PDO $pdo, string $entityType, string $entityPublicId, int $userId): int
{
    avesmapsEnsureFeatureSourceTables($pdo);

    $stmt = $pdo->prepare(
        'SELECT source_id FROM feature_sources WHERE entity_type = :t AND entity_public_id = :id AND origin = :o'
    );
    $stmt->execute(['t' => $entityType, 'id' => $entityPublicId, 'o' => AVESMAPS_GARETIEN_SOURCE_ORIGIN]);
    $sourceIds = $stmt->fetchAll(PDO::FETCH_COLUMN);

    $geloest = 0;
    foreach ($sourceIds as $sourceId) {
        avesmapsRemoveFeatureSource($pdo, $entityType, $entityPublicId, (int) $sourceId, $userId);
        $geloest++;
    }

    return $geloest;
}

// 🔴 DER Z5-INDEX -- dieselbe Stelle, an der js/map-features/ecosystem-display.js die
// "Grundgroesse" einer Art abliest (avesmapsEcosystemDisplayBasisGroesse: "bei z5 ist der
// Zoomfaktor der Groessenrechnung genau 1,0 ... die Grundgroesse IST also per Konstruktion der
// z5-Wert"). Keine eigene Zahl, dieselbe Stelle der Zeile.
const AVESMAPS_GARETIEN_LABEL_VORGABE_GROESSE_INDEX = 5;

/**
 * Die vom ADMIN gesetzte Uebersteuerung einer Landschaftsart lesen (Fenster „Landschaften ->
 * Darstellung") und in die Form von avesmapsCreateLabelFeature() bringen: size/priority/
 * min_zoom/max_zoom (Owner-Nachtrag 30.08.2026: „DOCH DER IMPORT SOLL SIE SETZEN!!!").
 *
 * 🔴 NUR DIE UEBERSTEUERUNG AUS avesmapsEcosystemDisplayRead(), NIE DIE GEMESSENE BASISTAFEL.
 * AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART (js/map-features/ecosystem-display.js) ist ein
 * Client-Schnappschuss ohne PHP-Gegenstueck -- ihn hier nachzubauen waere die zweite Wahrheit,
 * die AGENTS.md §5 verbietet ("eine abgeschriebene Vorgabetafel ... die teuerste Fehlerklasse
 * dieses Projekts"). avesmapsEcosystemDisplayRead() ist die einzige Quelle, die der Server
 * ueberhaupt kennt: exakt das, was ein Admin im Fenster tatsaechlich gespeichert hat.
 *
 * ⚠️ FEHLT FUER DIESE ART EINE UEBERSTEUERUNG, BLEIBT ES BEIM HEUTIGEN GRUNDWERT -- ausdruecklich,
 * nicht zufaellig: das jeweilige Feld fehlt dann im Rueckgabearray ganz, und
 * avesmapsCreateLabelFeature faellt auf seine eigenen Vorgaben zurueck (size=18, min_zoom=0,
 * max_zoom=5, priority=3) -- dieselben vier Zahlen, die AVESMAPS_GARETIEN_LABEL_ECHT im Fenster
 * „Eingefuegt wird" bisher als „der Import setzt sie nicht" zeigte.
 *
 * ⚠️ EIN GESPEICHERTER WERT KANN AUSSERHALB DESSEN LIEGEN, WAS EIN LABEL TRAGEN DARF. Die
 * Darstellungstafel prueft nur gegen ihre EIGENEN, weiteren Schranken (Groesse 4..30 pt, Zoomband
 * -1(=„aus")..7); avesmapsReadLabelSize/…Zoom/…Priority pruefen gegen ihre eigenen (Groesse
 * 10..56, Zoom 0..7). Ein dort gueltiger, hier ungueltiger Wert wuerde avesmapsCreateLabelFeature
 * zum Werfen bringen und den ganzen Uebernahme-Schritt fuer ein Objekt abbrechen -- fuer eine
 * reine Anzeige-Einstellung. Er wird deshalb VORAB gegen dieselben Schranken geprueft und im
 * Zweifel weggelassen (= Grundwert), nie ungeprueft durchgereicht.
 *
 * @return array{size?:int, priority?:int, min_zoom?:int, max_zoom?:int}
 */
function avesmapsGaretienLabelVorgabeFuerArt(PDO $pdo, string $subtyp): array
{
    $display = avesmapsEcosystemDisplayRead($pdo)['display'] ?? null;
    if (!is_array($display)) {
        return [];
    }

    $raus = [];
    $vorgabe = $display['vorgabe'][$subtyp] ?? null;
    if (is_array($vorgabe)) {
        if (isset($vorgabe['ab']) && is_int($vorgabe['ab']) && $vorgabe['ab'] >= 0 && $vorgabe['ab'] <= 7) {
            $raus['min_zoom'] = $vorgabe['ab'];
        }
        if (isset($vorgabe['bis']) && is_int($vorgabe['bis']) && $vorgabe['bis'] >= 0 && $vorgabe['bis'] <= 7) {
            $raus['max_zoom'] = $vorgabe['bis'];
        }
        if (isset($vorgabe['prio']) && is_int($vorgabe['prio']) && $vorgabe['prio'] >= 1 && $vorgabe['prio'] <= 5) {
            $raus['priority'] = $vorgabe['prio'];
        }
    }
    // 💣 EIN HALBES ZOOMBAND WAERE EINE ERFUNDENE AUSSAGE. `bis < ab` kodiert in der
    // Darstellungstafel "aus" (z.B. bis=-1) -- fuer ein NEUES Label, das ohnehin erscheinen soll,
    // ist das keine gueltige Angabe. avesmapsCreateLabelFeature wirft ausserdem hart bei
    // max_zoom < min_zoom; beide Enden werden deshalb zusammen verworfen, nicht nur eines.
    if (isset($raus['min_zoom'], $raus['max_zoom']) && $raus['max_zoom'] < $raus['min_zoom']) {
        unset($raus['min_zoom'], $raus['max_zoom']);
    }

    $groesseZeile = $display['groesse'][$subtyp] ?? null;
    if (is_array($groesseZeile) && array_key_exists(AVESMAPS_GARETIEN_LABEL_VORGABE_GROESSE_INDEX, $groesseZeile)) {
        $z5 = $groesseZeile[AVESMAPS_GARETIEN_LABEL_VORGABE_GROESSE_INDEX];
        if ((is_int($z5) || is_float($z5)) && $z5 >= 10 && $z5 <= 56) {
            $raus['size'] = (int) round($z5);
        }
    }

    return $raus;
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
    // 🔴 DER IMPORT SETZT DIE VORGABE DER ART (Owner-Nachtrag 30.08.2026) -- siehe
    // avesmapsGaretienLabelVorgabeFuerArt oben. Fehlt eine Uebersteuerung fuer diese Art, liefert
    // sie ein leeres Array, und avesmapsCreateLabelFeature faellt auf seine eigenen Vorgaben
    // zurueck -- der bisherige Zustand bleibt fuer eine unberuehrte Art also unveraendert.
    //
    // 🔴 UND DER IMPORT WEIST DEN WIKI-SCHLUESSEL ZU (Owner-Entscheid 30.08.2026, siehe
    // avesmapsGaretienWikiLandschaftZuweisung): passt der Name (mit oder ohne passende Art) auf
    // GENAU eine Wiki-Landschaft, traegt das frisch angelegte Label sie sofort -- ohne einen
    // zweiten, spaeteren Handgriff im Editor. Name und Art bleiben die des Imports; nur der
    // Schluessel kommt vom Wiki. Ohne sichere Zuordnung bleibt das Feld schlicht WEG (kein
    // erfundener Schluessel).
    // ⚠️ `array_merge` mit einem dritten, bedingt LEEREN Array haengt den Schluessel an --
    // absichtlich KEINE Feldzuweisung auf einer eigenen Zeile hier: label-wiki-no-article-test.php
    // scannt den GANZEN api/-Baum nach genau dieser Schreibweise und verlangt daneben ein Loeschen
    // des Merkers "kein Wiki-Artikel" (AGENTS.md §11: "FUENF Schreiber von properties.wiki_region,
    // jeder loescht den Merker"). Hier gibt es diesen Merker nicht zu loeschen: das Ergebnis dieser
    // Suche ist die EINGABE fuer avesmapsCreateLabelFeature() an einem noch gar nicht existierenden
    // Label, kein direkter Schreibzugriff auf eine bestehende Feature-Zeile -- die Loeschung
    // passiert bereits DORT (features.php, im selben Atemzug wie die eigentliche Zuweisung).
    $wikiZuweisung = avesmapsGaretienWikiLandschaftZuweisung($pdo, (string) $nach['name'], (string) $nach['subtyp']);
    $label = avesmapsCreateLabelFeature($pdo, array_merge(
        ['text' => (string) $nach['name'], 'feature_subtype' => (string) $nach['subtyp'], 'lng' => $lx, 'lat' => $ly],
        avesmapsGaretienLabelVorgabeFuerArt($pdo, (string) $nach['subtyp']),
        $wikiZuweisung !== null ? ['wiki_region' => $wikiZuweisung] : []
    ), $user);
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
    // 🔴 ZWEI PUBLIC-IDS, dieselbe Trennung wie im Anlegen (avesmapsGaretienUebernehmen): $publicId
    // ist das ZIEL des Update-Aufrufs -- bei einer Flaeche die REGION, die avesmapsUpdateEcosystemRegion
    // / …AreaGeometry auch tatsaechlich brauchen. $quellePublicId ist der ID-Raum, in dem die Karte
    // Quellen NACHSCHLAEGT (map-features.php:1228, 'label' -> 'region', gekeyt an der public_id des
    // LABELS) -- fuer Weg/Ort/Gipfel identisch mit $publicId, bei der Flaeche NICHT (siehe unten).
    $quellePublicId = $publicId;

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
    } elseif (($nach['ziel'] ?? '') === 'location') {
        // 🔴 Ortschaften (Entwurf §3.1). 💣 avesmapsUpdatePointFeatureDetails IST GENAUSO WENIG
        // ein Teil-Update wie avesmapsUpdatePathFeatureDetails oben: is_nodix/is_ruined/
        // is_hidden/place_kind/description/wiki_url/other_source werden UNBEDINGT aus dem
        // Rumpf gelesen (`?? false`/`?? ''`/`?? null`) und wuerden ohne den vollstaendigen
        // aktuellen Bestand lautlos geloescht -- genau die Falle, deren Beleg oben schon steht.
        // Die drei Wiki-Textfelder (einwohner/lage/oberhaupt) und `wiki_no_article` bleiben
        // dagegen unangetastet, wenn sie im Rumpf FEHLEN (avesmapsApplyPointWikiFields prueft
        // `array_key_exists`) -- sie werden deshalb bewusst NICHT mitgeschickt.
        $zeile = $pdo->prepare('SELECT name, feature_subtype, properties_json FROM map_features WHERE public_id = :p');
        $zeile->execute([':p' => $publicId]);
        $vorher = $zeile->fetch(PDO::FETCH_ASSOC);
        if ($vorher === false) {
            throw new RuntimeException('Der Ort ' . $publicId . ' existiert nicht mehr.');
        }
        $props = json_decode((string) ($vorher['properties_json'] ?? '{}'), true);
        $props = is_array($props) ? $props : [];

        if (in_array('name', $felder, true)) {
            avesmapsUpdatePointFeatureDetails($pdo, [
                'public_id' => $publicId,
                'name' => (string) $nach['name'],
                'feature_subtype' => (string) ($vorher['feature_subtype'] ?? 'dorf'),
                'description' => (string) ($props['description'] ?? ''),
                'wiki_url' => (string) ($props['wiki_url'] ?? ''),
                'is_nodix' => (bool) ($props['is_nodix'] ?? false),
                'is_ruined' => (bool) ($props['is_ruined'] ?? false),
                'is_hidden' => (bool) ($props['is_hidden'] ?? false),
                'place_kind' => (string) ($props['place_kind'] ?? ''),
                'other_source' => $props['other_source'] ?? null,
            ], $user);
            $geschrieben++;
        }
        if (in_array('geometrie', $felder, true)) {
            $punkt = avesmapsGaretienPunktAusGeometrie($nach);
            avesmapsMovePointFeature($pdo, [
                'public_id' => $publicId,
                'lng' => $punkt['lng'],
                'lat' => $punkt['lat'],
            ], $user);
            $geschrieben++;
        }
        $entityType = 'settlement';
    } elseif (($nach['ziel'] ?? '') === 'label') {
        // 🔴 Der Berggipfel (Entwurf §3.4). ⭐ avesmapsUpdateLabelFeature IST ein Teil-Update fuer
        // alles ausser `text`/`feature_subtype` (beide `array_key_exists`-gated: size, rotation,
        // is_nodix, is_hidden, wiki_region, other_source, height_schritt, …) -- NUR diese zwei
        // reisen deshalb mit dem aktuellen Bestand, der Rest bleibt unberuehrt, weil er im Rumpf
        // gar nicht erst steht.
        $zeile = $pdo->prepare("SELECT name, feature_subtype FROM map_features WHERE public_id = :p AND feature_type = 'label'");
        $zeile->execute([':p' => $publicId]);
        $vorher = $zeile->fetch(PDO::FETCH_ASSOC);
        if ($vorher === false) {
            throw new RuntimeException('Der Gipfel ' . $publicId . ' existiert nicht mehr.');
        }

        if (in_array('name', $felder, true)) {
            avesmapsUpdateLabelFeature($pdo, [
                'public_id' => $publicId,
                'text' => (string) $nach['name'],
                'feature_subtype' => (string) ($vorher['feature_subtype'] ?? 'berggipfel'),
            ], $user);
            $geschrieben++;
        }
        if (in_array('geometrie', $felder, true)) {
            $punkt = avesmapsGaretienPunktAusGeometrie($nach);
            avesmapsMoveLabelFeature($pdo, [
                'public_id' => $publicId,
                'lng' => $punkt['lng'],
                'lat' => $punkt['lat'],
            ], $user);
            $geschrieben++;
        }
        // 🔴 Dieselbe Bindung wie beim Anlegen: feature_type 'label' -> entity_type 'region'
        // (map-features.php:1228), keyed an der public_id des Labels selbst.
        $entityType = 'region';
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
        // im Anwender, nicht im Abgleich: die Regions-ID ist fuer alles andere die richtige
        // (`avesmapsUpdateEcosystemRegion` will sie) -- die Flaeche wird deshalb hier ueber die
        // Region nachgeschlagen.
        // 🔴 KORRIGIERT (Aufgabe 13): hier stand "die Quelle haengt an der Region" -- das ist
        // FALSCH und war der Rechtsfolgenfehler dieser Aufgabe. map-features.php:1228 bindet
        // entity_type 'region' an feature_type 'label', keyed an der public_id des LABELS, nicht
        // der Region -- dieselbe Bindung wie beim 'label'-Zweig oben und beim Anlegen
        // (avesmapsGaretienFlaecheAnlegen). Die Quellen-Verknuepfung schlaegt deshalb weiter unten
        // das Label der Region eigens nach ($quellePublicId), statt $publicId zu benutzen.
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
        if (in_array('quelle', $felder, true)) {
            // 💣 DIE QUELLE HAENGT AN DER BESCHRIFTUNG, NICHT AN DER REGION -- siehe die
            // korrigierte Begruendung oben. $publicId ist hier absichtlich die Regions-id (fuer
            // avesmapsUpdateEcosystemRegion und die Flaechen-Suche richtig); fuer die
            // Quellen-Verknuepfung wird deshalb ihr Label nachgeschlagen.
            // ⭐ DIESELBE Bindung entscheidet auch den BESTANDSCHECK beim Planbau
            // (avesmapsGaretienErgaenzungsEintraege, garetien-plan.php) -- dort reist die
            // Label-id als DATEN mit statt eines eigenen Nachschlags (die Funktion ist REIN).
            // Aendert sich diese Bindung, muss die dortige Umschaltung mitziehen.
            $labelDerRegion = $pdo->prepare('SELECT label_public_id FROM ecosystem_region WHERE public_id = :p');
            $labelDerRegion->execute([':p' => $publicId]);
            $labelId = trim((string) $labelDerRegion->fetchColumn());
            if ($labelId === '') {
                throw new RuntimeException('Region ' . $publicId . ' hat kein Label -- keine Quelle anhaengbar.');
            }
            $quellePublicId = $labelId;
        }
    }

    $quellen = 0;
    if (in_array('quelle', $felder, true)
        && avesmapsGaretienQuelleAnlegen($pdo, $entityType, $quellePublicId, (array) ($nach['quelle'] ?? []), $userId)) {
        $quellen = 1;
        $geschrieben++;
    }

    return ['felder' => $geschrieben, 'quellen' => $quellen];
}

/**
 * Wie avesmapsSyncPlanPendingItems (api/_internal/wiki/sync-plan.php), aber SKOPIERT auf eine
 * ausdrueckliche id-Menge -- nie auf den ganzen Lauf.
 *
 * 🔴 SCHADENSFALL 30.08.2026 (Owner: „hat unsere ganze karte zerstoert"). „Alle angezeigten
 * einfuegen" haengte die ids der ANGEZEIGTEN Objekte per `select` an
 * (garetienEinfuegenAusfuehren, review-garetien-importer.js), rief `apply` aber OHNE sie -- und
 * die geteilte avesmapsSyncPlanPendingItems liest ALLE `selected = 1`-Zeilen des LAUFS, Altbestand
 * aus frueheren Klicks und die Vorbelegung eingeschlossen (neue/geaenderte Vorschlaege starten
 * beim Planbau vorangehaehkelt). Rund 100 angezeigte Objekte uebernahmen dadurch 3007. Diese
 * Funktion ist seither die einzige Stelle, an der der Garetien-Zweig noch offene Zeilen liest, und
 * sie kennt NUR die ids, die der Aufrufer ausdruecklich benennt (siehe avesmapsGaretienApplyStep).
 */
function avesmapsGaretienPendingItemsScoped(PDO $pdo, int $runId, array $itemIds, int $limit): array
{
    $itemIds = array_values(array_unique(array_map('intval', $itemIds)));
    if ($itemIds === []) {
        return [];
    }
    $platzhalter = implode(',', array_fill(0, count($itemIds), '?'));
    $stmt = $pdo->prepare(
        'SELECT id, entity_key, entity_public_id, change_type, label, before_json, after_json'
        . ' FROM sync_plan_item'
        . ' WHERE run_id = ? AND id IN (' . $platzhalter . ') AND selected = 1 AND apply_state IS NULL'
        . ' ORDER BY id ASC LIMIT ' . max(1, $limit)
    );
    $stmt->execute(array_merge([$runId], $itemIds));

    return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

/** Wie avesmapsSyncPlanPendingCount, aber SKOPIERT auf dieselbe id-Menge -- siehe oben. */
function avesmapsGaretienPendingCountScoped(PDO $pdo, int $runId, array $itemIds): int
{
    $itemIds = array_values(array_unique(array_map('intval', $itemIds)));
    if ($itemIds === []) {
        return 0;
    }
    $platzhalter = implode(',', array_fill(0, count($itemIds), '?'));
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM sync_plan_item'
        . ' WHERE run_id = ? AND id IN (' . $platzhalter . ') AND selected = 1 AND apply_state IS NULL'
    );
    $stmt->execute(array_merge([$runId], $itemIds));

    return (int) $stmt->fetchColumn();
}

/**
 * Die `ids` aus dem Anfragerumpf lesen und saeubern -- fuer den Garetien-Zweig von `apply` in
 * api/edit/wiki/sync-plan.php PFLICHT (siehe avesmapsGaretienApplyStep und der Schadensfall oben).
 * Eine fehlende, nicht-Array- oder leere Angabe kommt als leere Liste zurueck; der Aufrufer lehnt
 * die Anfrage dann ab, statt still auf den ganzen Lauf zurueckzufallen -- GENAU DER Rueckfall war
 * der Schaden.
 *
 * @return list<int>
 */
function avesmapsGaretienApplyIdsAusRumpf(array $payload): array
{
    $roh = $payload['ids'] ?? null;
    if (!is_array($roh)) {
        return [];
    }

    return array_values(array_unique(array_filter(
        array_map('intval', $roh),
        static fn(int $id): bool => $id > 0
    )));
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
 *
 * @param ?list<int> $itemIds SCHADENSFALL 30.08.2026: `null` ist der ALTE, ungeskopierte Weg (der
 *     ganze Lauf) -- er bleibt nur fuer die bestehenden Tests dieser Datei stehen, die die
 *     Kernmechanik unabhaengig von der Anzeige pruefen. Der EINZIGE Produktionsaufrufer
 *     (api/edit/wiki/sync-plan.php, kind='garetien') gibt seit diesem Fund IMMER eine
 *     nicht-leere Liste mit -- ohne sie lehnt der Endpunkt die Anfrage ab, bevor sie hier ankommt.
 */
function avesmapsGaretienApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null, ?array $itemIds = null): array
{
    $budget = $budget ?? AVESMAPS_SYNC_PLAN_APPLY_BUDGET;
    // ⚠️ DDL oben, einmal, VOR jeder Transaktion: MySQL committet eine offene Transaktion, sobald
    // es DDL sieht.
    avesmapsEnsureSyncPlanTables($pdo);
    avesmapsEnsureFeatureSourceTables($pdo);

    $offen = $itemIds === null
        ? avesmapsSyncPlanPendingItems($pdo, $runId, $budget)
        : avesmapsGaretienPendingItemsScoped($pdo, $runId, $itemIds, $budget);
    $ids = array_map(static fn(array $r): int => (int) $r['id'], $offen);
    $ergebnis = avesmapsGaretienUebernehmen($pdo, $runId, $ids, is_array($user) ? $user : ['id' => $userId]);
    $rest = $itemIds === null
        ? avesmapsSyncPlanPendingCount($pdo, $runId)
        : avesmapsGaretienPendingCountScoped($pdo, $runId, $itemIds);

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
            $ziel = (string) ($nach['ziel'] ?? '');
            // 🔴 ZWEI PUBLIC-IDS, NICHT EINE. $publicId ist das angelegte Objekt (steht als
            // Vermerk im Item, und bei einer Flaeche ist das die REGION -- die Ruecknahme loescht
            // darueber via avesmapsDeleteEcosystemRegion). $quellePublicId ist der ID-Raum, in dem
            // die Karte Quellen NACHSCHLAEGT (map-features.php:1228,
            // $entityTypeByFeatureType['label'] = 'region', keyed an der public_id des LABELS,
            // nicht der Region) -- fuer Weg/Ort/Gipfel sind beide gleich, nur bei der Flaeche
            // (See/Meer/Sumpf/…) laufen sie auseinander.
            $quellePublicId = null;
            if ($ziel === 'path') {
                $feature = avesmapsCreatePathFeature($pdo, [
                    'name' => (string) $nach['name'],
                    'feature_subtype' => (string) $nach['subtyp'],
                    // 💣 GeoJSON [x,y] -> Hausvertrag, siehe avesmapsGaretienGeoJsonNachHausvertrag.
                    'coordinates' => avesmapsGaretienGeoJsonNachHausvertrag((array) $nach['geometry']['coordinates']),
                ], $user);
                $publicId = avesmapsGaretienPublicIdAus($feature, 'Der Weg');
                $entityType = 'path';
                $quellePublicId = $publicId;
            } elseif ($ziel === 'location') {
                // Ortschaften (Entwurf §3.1) -- ein Ort ist ein PUNKT, avesmapsCreatePointFeature
                // setzt feature_type='location' und liest settlement_class aus 'feature_subtype'.
                $punkt = avesmapsGaretienPunktAusGeometrie($nach);
                $feature = avesmapsCreatePointFeature($pdo, [
                    'name' => (string) $nach['name'],
                    'feature_subtype' => (string) $nach['subtyp'],
                    'lng' => $punkt['lng'],
                    'lat' => $punkt['lat'],
                ], $user);
                $publicId = avesmapsGaretienPublicIdAus($feature, 'Der Ort');
                // 🔴 map-features.php:1228 ($entityTypeByFeatureType) bindet feature_type
                // 'location' an entity_type 'settlement' -- dieselbe Auskunft, an der der
                // Quellenkasten der Infobox seine Zeilen sucht. Ein anderer Wert liesse die
                // Quelle unauffindbar im Katalog liegen.
                $entityType = 'settlement';
                $quellePublicId = $publicId;
            } elseif ($ziel === 'label') {
                // 🔴 Der Berggipfel ist die EINZIGE Punkt-Ausnahme: ein Label OHNE Region/Flaeche
                // dahinter (Entwurf §3.4). 💣 KEINE `height_schritt` -- ein Gipfel ist ein
                // Stuetzpunkt des Hoehenfelds (terrain-store.php liest is_active=1 +
                // height_schritt), und Volkers Daten tragen keine Hoehe. Ein erfundener Wert
                // veraendert das Gelandemodell lautlos falsch; das Feld bleibt deshalb WEG, nicht
                // auf 0 oder null gesetzt (avesmapsCreateLabelFeature schreibt es nur, wenn der
                // Schluessel ueberhaupt im Payload steht).
                $punkt = avesmapsGaretienPunktAusGeometrie($nach);
                // 🔴 DER IMPORT SETZT DIE VORGABE DER ART (Owner-Nachtrag 30.08.2026) -- siehe
                // avesmapsGaretienLabelVorgabeFuerArt oben, dieselbe Regel wie bei der Flaeche.
                // 🔴 UND DENSELBEN WIKI-SCHLUESSEL WIE BEI DER FLAECHE (Owner-Entscheid 30.08.2026,
                // avesmapsGaretienWikiLandschaftZuweisung) -- "Landschaft" meint hier BEIDE Formen,
                // Flaeche UND Berggipfel (AVESMAPS_WIKI_REGION_ART_TO_SUBTYPE kennt 'Berggipfel'
                // gleichberechtigt neben 'See'/'Wald'/…). Name und Art bleiben die des Imports.
                // ⚠️ `array_merge` mit bedingt leerem drittem Array, absichtlich keine Feldzuweisung
                // auf einer eigenen Zeile -- siehe die ausfuehrliche Begruendung an
                // avesmapsGaretienFlaecheAnlegen oben (label-wiki-no-article-test.php scannt genau
                // diese Schreibweise repoweit).
                $wikiZuweisung = avesmapsGaretienWikiLandschaftZuweisung($pdo, (string) $nach['name'], (string) $nach['subtyp']);
                $feature = avesmapsCreateLabelFeature($pdo, array_merge(
                    ['text' => (string) $nach['name'], 'feature_subtype' => (string) $nach['subtyp'],
                        'lng' => $punkt['lng'], 'lat' => $punkt['lat']],
                    avesmapsGaretienLabelVorgabeFuerArt($pdo, (string) $nach['subtyp']),
                    $wikiZuweisung !== null ? ['wiki_region' => $wikiZuweisung] : []
                ), $user);
                $publicId = avesmapsGaretienPublicIdAus($feature, 'Der Gipfel');
                // 🔴 Dieselbe Bindung wie oben: feature_type 'label' -> entity_type 'region'
                // (map-features.php:1228), KEYED AN DER PUBLIC_ID DES LABELS SELBST -- es gibt
                // hier keine Region, an die die Quelle stattdessen haengen koennte.
                $entityType = 'region';
                $quellePublicId = $publicId;
            } else {
                $ergebnis = avesmapsGaretienFlaecheAnlegen($pdo, $nach, $user, $userId);
                $publicId = $ergebnis['public_id'];
                $entityType = $ergebnis['entity_type'];
                // 💣 HIER laufen $publicId (Region, fuer den Item-Vermerk/die Ruecknahme) und die
                // Quellen-id auseinander: die Quelle haengt an der BESCHRIFTUNG
                // ($ergebnis['label_public_id']), nicht an der Region -- siehe die Begruendung an
                // avesmapsGaretienFlaecheAnlegen und die Bindung im 'label'-Zweig oben. Wer hier
                // $publicId einsetzt, verknuepft die Quelle in einem ID-Raum, den die Karte nie
                // ausliest (AGENTS.md §11: "die Quellen einer Landschaft liegen … an ihrer
                // BESCHRIFTUNG").
                $quellePublicId = $ergebnis['label_public_id'];
            }
            $angelegt++;
            if (avesmapsGaretienQuelleAnlegen($pdo, $entityType, $quellePublicId, (array) ($nach['quelle'] ?? []), $userId)) {
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

/**
 * Die Ruecknahme: umkehren, was EINE Uebernahme angelegt hat -- das Item faellt zurueck auf
 * 'offen'. Aufgabe 9 (.superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-9-brief.md).
 *
 * 🔴 DIE EINZIGE STELLE DES FENSTERS, DIE ETWAS AUS UNSERER DATENBANK ENTFERNT -- und sie lebt
 * deshalb VOLLSTAENDIG hier (api/_internal/import/) und im Fenster
 * (js/review/review-garetien-importer.js). Der Auftrag (§5.5) verbietet einen Loeschweg in einer
 * geteilten Oberflaeche, weil er nach dem Abbau des Importers als Waise zurueckbliebe -- die
 * Begruendung ist die Waise, nicht das Loeschen (Owner 29.08.2026: „solang der importer nicht
 * zurueckgebaut wurde"). Kein Griff auf api/edit/wiki/sync-plan.php (die geteilte Tuer fuer acht
 * Objektarten) und nichts in api/app/. Verschwindet restlos mit dem Abbau
 * (garetien-abbau-waechter-test.php).
 *
 * 🔴 OWNER-ENTSCHEID 1 (29.08.2026): ein 'changed'-Item bekommt GAR KEINE Ruecknahme -- es hat ein
 * BESTEHENDES Objekt veraendert, das uns schon vor dem Import gehoerte, und sein Loeschen waere
 * Datenverlust an fremder Arbeit. Ein echtes Zuruecksetzen ist ausserdem gar nicht moeglich: `before`
 * traegt nur `public_id`/`name` (garetien-plan.php), keine Geometrie. Das Fenster bietet fuer solche
 * Objekte schon keinen Knopf an; der Riegel steht hier ein zweites Mal, weil eine Sperre nur im
 * Browser keine ist.
 *
 * 🔴 MELDUNG (30.08.2026): DIE ENGE AUSNAHME. Ein 'changed'-Item, dessen `felder` GENAU `['quelle']`
 * ist, hat NICHTS Unwiederbringliches veraendert -- avesmapsGaretienErgaenzungAnwenden tut in
 * diesem Fall ausschliesslich avesmapsGaretienQuelleAnlegen, keinen einzigen Update-Aufruf an Name
 * oder Geometrie. Owner-Entscheid 1 bleibt fuer alles andere unveraendert (sobald 'name' oder
 * 'geometrie' mit in `felder` steht); der Riegel wird dadurch ENGER formuliert, nicht aufgehoben.
 * Die Ruecknahme entfernt hier NICHT das Objekt, sondern loest nur die feature_sources-Verknuepfung
 * mit origin='garetien' (avesmapsGaretienQuelleRuecknahmeLoesen) -- dieselbe enge Zielauflösung wie
 * beim Anlegen (avesmapsGaretienQuelleZielAufloesen), NIEMALS die geteilte `sources`-Zeile selbst.
 *
 * 🔴 OWNER-ENTSCHEID 2 (29.08.2026): eine nachtraegliche Bearbeitung SPERRT die Ruecknahme NICHT --
 * kein Zeitstempel-Vergleich, keine neue Zustandshaltung. Die Rueckfrage im Fenster nennt das beim
 * Namen; hier wird deshalb bewusst KEIN `expected_revision` mitgeschickt.
 *
 * 💣 EIN FEHLER MITTENDRIN WIRFT UND WIRD BENANNT -- das Item bleibt dann unangetastet auf 'done'
 * stehen ("eine halb zurueckgenommene Flaeche ist schlimmer als gar keine Ruecknahme"). Sowohl
 * avesmapsDeleteMapFeature als auch avesmapsDeleteEcosystemRegion laufen selbst je in EINER eigenen
 * Transaktion -- ein Abbruch dort rollt sich selbst zurueck und hinterlaesst nie eine HALB
 * geloeschte Flaeche (Region ohne Label, oder umgekehrt). Der Item-Vermerk unten laeuft deshalb NUR
 * im Erfolgsfall.
 *
 * @param list<int> $itemIds
 * @return array{zurueckgenommen:int, fehler:list<array{item:int, grund:string}>}
 */
function avesmapsGaretienRuecknahmeAusfuehren(PDO $pdo, int $runId, array $itemIds, array $user): array
{
    if ($itemIds === []) {
        return ['zurueckgenommen' => 0, 'fehler' => []];
    }
    // ⚠️ avesmapsDeleteMapFeature fragt map_feature_locks direkt ab, ohne die Tabelle selbst
    // sicherzustellen (nur avesmapsAcquireMapFeatureLock tut das) -- und dieser Endpunkt laeuft
    // NICHT durch den Editor-Dispatcher, der das sonst uebernimmt (api/edit/map/features.php).
    // Idempotent, kostet also nichts, wenn sie schon da ist.
    avesmapsEnsureMapFeatureLocksTable($pdo);

    $platzhalter = implode(',', array_fill(0, count($itemIds), '?'));
    $stmt = $pdo->prepare(
        'SELECT id, change_type, entity_public_id, after_json, apply_state, apply_note'
        . ' FROM sync_plan_item WHERE run_id = ? AND id IN (' . $platzhalter . ') ORDER BY id'
    );
    $stmt->execute(array_merge([$runId], array_map('intval', $itemIds)));

    $zurueckgenommen = 0;
    $fehler = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $item) {
        $itemId = (int) $item['id'];
        $changeType = (string) $item['change_type'];

        // MELDUNG (30.08.2026): die enge Ausnahme fuer 'quelle'-only 'changed'-Items -- geprueft
        // VOR der generischen OWNER-ENTSCHEID-1-Sperre, sonst wuerde diese jedes 'changed'-Item
        // ausnahmslos ablehnen. Server prueft dasselbe wie der Browser
        // (garetienItemIstQuelleNur) -- eine Sperre nur im Browser ist keine.
        if ($changeType === 'changed') {
            $nach = json_decode((string) $item['after_json'], true);
            $felder = is_array($nach) ? (array) ($nach['felder'] ?? []) : [];
            if (count($felder) !== 1 || $felder[0] !== 'quelle') {
                $fehler[] = ['item' => $itemId, 'grund' => 'veraendert ein bestehendes Objekt -- nicht ruecknehmbar'];
                continue;
            }
            if ((string) ($item['apply_state'] ?? '') !== 'done') {
                $fehler[] = ['item' => $itemId, 'grund' => 'dieses Item wurde nie uebernommen'];
                continue;
            }
            // ⚠️ entity_public_id, NICHT apply_note -- bei einem 'changed'-Item ist sie von Anfang
            // an (Planbau) das ZIEL des Update-Aufrufs (avesmapsGaretienUebernehmen liest genau
            // diese Spalte fuer avesmapsGaretienErgaenzungAnwenden); apply_note traegt nach dem
            // Erfolg zwar denselben Wert, ist aber nur ein Echo davon.
            $entityPublicId = trim((string) ($item['entity_public_id'] ?? ''));
            if ($entityPublicId === '') {
                $fehler[] = ['item' => $itemId, 'grund' => 'kein Ziel-Objekt hinterlegt'];
                continue;
            }
            $ziel = is_array($nach) ? (string) ($nach['ziel'] ?? '') : '';
            try {
                [$entityType, $quellePublicId] = avesmapsGaretienQuelleZielAufloesen($pdo, $ziel, $entityPublicId);
                if ($quellePublicId === '') {
                    throw new RuntimeException('keine Beschriftung fuer die Quellen-Verknuepfung gefunden');
                }
                avesmapsGaretienQuelleRuecknahmeLoesen($pdo, $entityType, $quellePublicId, (int) ($user['id'] ?? 0));

                // Zurueck auf 'offen' -- derselbe Riegel wie im 'new'-Zweig unten (dieselbe
                // Bedeutung von "Ruecknahme": zurueck in GENAU den Stand vor der Uebernahme).
                $pdo->prepare(
                    'UPDATE sync_plan_item SET apply_state = NULL, apply_note = NULL, selected = 1 WHERE id = :id'
                )->execute(['id' => $itemId]);
                $zurueckgenommen++;
            } catch (Throwable $abbruch) {
                $fehler[] = ['item' => $itemId, 'grund' => $abbruch->getMessage()];
            }
            continue;
        }

        // OWNER-ENTSCHEID 1: nur ein 'new'-Item hat wirklich etwas ANGELEGT (der 'changed'-Zweig
        // von avesmapsGaretienUebernehmen AENDERT ein bestehendes Objekt ueber
        // avesmapsGaretienErgaenzungAnwenden, legt aber nie eine Zeile an).
        if ($changeType !== 'new') {
            $fehler[] = ['item' => $itemId, 'grund' => 'veraendert ein bestehendes Objekt -- nicht ruecknehmbar'];
            continue;
        }
        if ((string) ($item['apply_state'] ?? '') !== 'done') {
            $fehler[] = ['item' => $itemId, 'grund' => 'dieses Item wurde nie uebernommen'];
            continue;
        }
        // 💣 DIE ANGELEGTE public_id STEHT IM VERMERK, NICHT IN entity_public_id. Bei einem echten
        // 'new'-Item ist entity_public_id von Anfang an NULL (garetien-plan.php: es gibt vor der
        // Uebernahme noch kein Ziel) und bleibt es -- avesmapsGaretienItemAbschliessen($pdo, id,
        // 'done', $publicId) schreibt die FRISCH ANGELEGTE public_id als `$note` in `apply_note`
        // (avesmapsSyncPlanMarkItem), genau an der Stelle, an der avesmapsGaretienUebernehmen sie
        // fuer den 'new'-Zweig uebergibt. Wer stattdessen entity_public_id liest, findet dort fuer
        // JEDES 'new'-Item eine leere Spalte.
        $publicId = trim((string) ($item['apply_note'] ?? ''));
        if ($publicId === '') {
            $fehler[] = ['item' => $itemId, 'grund' => 'keine angelegte public_id hinterlegt'];
            continue;
        }
        $nach = json_decode((string) $item['after_json'], true);
        $ziel = is_array($nach) ? (string) ($nach['ziel'] ?? '') : '';

        try {
            if ($ziel === 'path' || $ziel === 'location' || $ziel === 'label') {
                // Strom/Fluss/Bach, Reichsstrasse/Strasse/Weg/Pfad, Ortschaften, Berggipfel: je
                // EINE map_features-Zeile (avesmapsCreatePathFeature/…PointFeature/…LabelFeature
                // oben) -- derselbe generische Loeschweg fuer alle vier, weil keins davon eine
                // Kaskade traegt (ein frisch importierter Berggipfel haengt an KEINER Region,
                // avesmapsGaretienUebernehmen legt ihn nie als `label_public_id` einer Flaeche an).
                avesmapsDeleteMapFeature($pdo, ['public_id' => $publicId], $user);
            } elseif ($ziel === 'region') {
                // See/Meer/Sumpf: Label + Region + Flaeche (avesmapsGaretienFlaecheAnlegen oben,
                // in genau dieser Reihenfolge angelegt). avesmapsDeleteEcosystemRegion (api/_internal/
                // app/ecosystem.php) nimmt die Flaeche(n) UND alle Labels der Region in EINER
                // Transaktion mit -- das ist die UMGEKEHRTE Reihenfolge in EINER Funktion, nicht der
                // allgemeine Feature-Loeschweg mit seinem `refuse_ecosystem_cascade`-Riegel: der ist
                // gebaut, um die Kaskade beim Loeschen EINER Beschriftung zu VERHINDERN (AGENTS.md
                // §11, Konfliktzentrum, Regel label.duplicate); hier wird sie gewollt und
                // vollstaendig ausgefuehrt.
                avesmapsDeleteEcosystemRegion($pdo, ['public_id' => $publicId], (int) ($user['id'] ?? 0));
            } else {
                throw new RuntimeException('unbekanntes Ziel "' . $ziel . '" -- keine Ruecknahme moeglich');
            }

            // Zurueck auf 'offen': derselbe Riegel, den avesmapsSyncPlanPendingItems verlangt
            // (apply_state IS NULL) -- und `selected = 1`, der Stand UNMITTELBAR VOR dem Klick auf
            // „Neu einfuegen" (der Vorschlag stand vorangehakt da, sonst waere er nie uebernommen
            // worden -- avesmapsSyncPlanPendingItems verlangt selected=1). „Ruecknahme" heisst:
            // zurueck in GENAU diesen Stand, nicht in einen neuen.
            $pdo->prepare(
                'UPDATE sync_plan_item SET apply_state = NULL, apply_note = NULL, selected = 1 WHERE id = :id'
            )->execute(['id' => $itemId]);
            $zurueckgenommen++;
        } catch (Throwable $abbruch) {
            $fehler[] = ['item' => $itemId, 'grund' => $abbruch->getMessage()];
        }
    }

    return ['zurueckgenommen' => $zurueckgenommen, 'fehler' => $fehler];
}
