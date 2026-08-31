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
 *
 * 🔴 OWNER-ENTSCHEID (30.08.2026): seit `sources.url` der WIRT ist (garetien.de/koschwiki.de,
 * nicht mehr VolkoVs Export-Arbeitsseite, siehe die Begruendung an `avesmapsGaretienWirtAusZeile`
 * in garetien-plan.php), stand an einem uebernommenen Objekt nirgends mehr, VON WELCHER
 * Export-Seite es stammt. Der Owner, woertlich: "leg sie in feature_sources.note ab". `$seiteUrl`
 * ist deshalb `after.seite_url` aus dem Plan (nicht Teil von `$quelle` -- die beiden sind
 * Geschwister im selben `$nach`-Array, siehe die Aufrufer). ⭐ KEINE NEUE SPALTE, KEINE ZWEITE
 * TABELLE: `avesmapsFeatureSourceLink` traegt `note` bereits (AGENTS.md §5 fuehrt es neben
 * `origin`/`reference_kind`/`pages` als Teil der Herkunftsangabe des Quellensystems).
 *
 * ⚠️ ES IST EINE HERKUNFTSANGABE, KEIN ZWEITER QUELLENLINK -- `note` wird von KEINEM Renderer
 * angezeigt (weder `buildSourceListMarkup` noch der Quellen-Editor lesen das Feld; es reist nur
 * unbenutzt im map-features-Payload mit, siehe `avesmapsLoadFeatureSourceRefs`). Eine sichtbare
 * zweite Quelle war nicht der Auftrag.
 */
function avesmapsGaretienQuelleAnlegen(PDO $pdo, string $entityType, string $publicId, array $quelle, int $userId, string $seiteUrl = ''): bool
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
    $seiteUrl = trim($seiteUrl);
    avesmapsFeatureSourceLink(
        $pdo, $entityType, $publicId, $sourceId, $userId,
        AVESMAPS_GARETIEN_SOURCE_ORIGIN, null, null, $seiteUrl !== '' ? $seiteUrl : null
    );

    return true;
}

/**
 * Die Artikelquelle EINES Plan-Items -- aus dem Vorschlag, sonst aus seinem Schluessel.
 *
 * 🔴 ZWEI WEGE HINEIN, EIN BAUER (avesmapsGaretienArtikelQuelleAus, garetien-plan.php).
 * Der normale Weg ist `after.artikel_quelle`, seit dem 31.08.2026 vom Planbau gesetzt. Der zweite
 * ist der Rueckfall fuer Items, die VOR diesem Tag gebaut wurden: ihr `after` kennt das Feld
 * nicht, ihr `entity_key` traegt den Artikelnamen aber sehr wohl -- er ist Teil der Formel
 * `wiki:ebene:typ:<Namensraum:Artikel>` (avesmapsGaretienObjektSchluesselAusZeile).
 *
 * ⚠️ OHNE DEN RUECKFALL MUESSTE DER OWNER SEINEN LAUFENDEN LAUF NEU RECHNEN, um die
 * Artikelquelle zu bekommen -- 8213 Zeilen, und die Arbeitsliste faengt von vorn an. Er ist
 * deshalb kein Notnagel, sondern der Grund, warum die Aenderung ueberhaupt sofort wirkt.
 *
 * 💣 EIN OBJEKT OHNE ARTIKEL TRAEGT `#<Zeilennummer>` an dieser Stelle des Schluessels -- die
 * Formel setzt das ein, wenn es keinen Artikel gibt. Ohne diesen Riegel entstuende die Quelle
 * „#417 auf garetien.de", die auf `…/index.php/#417` zeigt.
 *
 * ⚠️ Der Wirt kommt aus `after.wiki`, wenn er dasteht -- der Schluessel traegt ihn zwar auch,
 * aber das `after` ist die Angabe, die der Planbau ausdruecklich gemacht hat.
 */
function avesmapsGaretienArtikelQuelleAusItem(array $nach, string $entityKey): ?array
{
    $fertig = $nach['artikel_quelle'] ?? null;
    if (is_array($fertig) && trim((string) ($fertig['url'] ?? '')) !== '') {
        return $fertig;
    }
    // Rueckfall ueber den Schluessel -- die Zerlegung steht in garetien-plan.php, direkt neben der
    // Formel, die ihn baut. Hier ein zweites Mal zu zerlegen waere ihre zweite Fassung.
    $seite = avesmapsGaretienArtikelNameAusSchluessel($entityKey);
    if ($seite === '') {
        return null;
    }
    $wiki = trim((string) ($nach['wiki'] ?? ''));
    if ($wiki === '') {
        $wiki = explode(':', $entityKey, 2)[0];
    }

    return avesmapsGaretienArtikelQuelleAus($wiki, $seite);
}

/**
 * BEIDE Quellen eines Objekts anhaengen: die Sammelquelle des Wirts und -- wenn die Zeile einen
 * Artikel nennt -- dessen eigene Seite.
 *
 * 🔴 DER EINE TRICHTER. Es gibt ZWEI Erzeuger von Quellen in dieser Datei (das Anlegen eines
 * neuen Objekts und die Ergaenzung eines vorhandenen), und beide gehen hier durch. Haengte die
 * Artikelquelle nur am Anlegepfad, bekaeme ausgerechnet die Ergaenzung sie nie -- „eine Regel, die
 * einen von zwei Erzeugern bindet, ist keine Regel" (AGENTS.md).
 *
 * ⚠️ Beide Verknuepfungen tragen DIESELBE `note` (die Export-Arbeitsseite): sie stammen aus
 * derselben Zeile, und die Notiz beantwortet „woher kommt diese Angabe", nicht „was ist das".
 *
 * @return int 0, 1 oder 2 -- wie viele Verknuepfungen wirklich entstanden sind.
 */
function avesmapsGaretienQuellenAnlegen(
    PDO $pdo,
    string $entityType,
    string $publicId,
    array $nach,
    int $userId,
    string $entityKey = ''
): int {
    // 💣 NEU GERECHNET, NICHT AUS `after.seite_url` GELESEN -- jedes vor dem 31.08.2026 gebaute
    // Item traegt dort die tote `…/Avesmaps_<Artikel>`-Adresse (siehe avesmapsGaretienArbeitsseiteAus).
    $seiteUrl = avesmapsGaretienArbeitsseiteAus($nach);
    $gezaehlt = 0;
    if (avesmapsGaretienQuelleAnlegen($pdo, $entityType, $publicId, (array) ($nach['quelle'] ?? []), $userId, $seiteUrl)) {
        $gezaehlt++;
    }
    $artikel = avesmapsGaretienArtikelQuelleAusItem($nach, $entityKey);
    if ($artikel !== null
        && avesmapsGaretienQuelleAnlegen($pdo, $entityType, $publicId, $artikel, $userId, $seiteUrl)) {
        $gezaehlt++;
    }

    return $gezaehlt;
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
 * Die Handeingabe des Kastens „Eingefügt wird" MIT der Vorgabe der Art zusammenfuehren -- eine
 * ausdrueckliche Handeingabe UEBERSTIMMT die Vorgabe (Owner 30.08.2026, nach dem Schadensfall
 * „3000 Labels ab Zoom 0": „WARUM DARF ICH DAS NICHT VERÄNDERN?" -- „einstellbar" heisst: hier,
 * im Kasten, vor dem Einfügen).
 *
 * 🔴 KEINE VALIDIERUNG HIER. Diese Funktion reicht Rohwerte unveraendert durch;
 * avesmapsCreateLabelFeature (ueber avesmapsReadLabelSize/…Zoom/…Priority) bleibt die LETZTE
 * INSTANZ und wirft bei einem unsinnigen Wert (z.B. `max_zoom < min_zoom`) -- ein Eingabefeld ist
 * die Anzeige, nicht der Riegel, dieselbe Trennung wie bei jedem gesperrten Knopf dieses Fensters.
 *
 * 🔴 `$einstellungen === null` HEISST „KEINE HANDEINGABE" (z.B. „Alle angezeigten einfügen" --
 * die Massenübernahme nimmt IMMER die Vorgabe der Art, nie die Handeingabe eines einzelnen
 * Objekts, siehe die Verdrahtung in review-garetien-importer.js). Das Ergebnis ist dann exakt
 * $vorgabeDerArt, unveraendert.
 *
 * @param ?array $einstellungen Rumpf aus dem Kasten (`size`/`priority`/`min_zoom`/`max_zoom`/
 *     `show_name`/`is_nodix`), oder null.
 * @param array $vorgabeDerArt avesmapsGaretienLabelVorgabeFuerArt(...)
 * @return array{size?:int, priority?:int, min_zoom?:int, max_zoom?:int, show_name?:bool, is_nodix?:bool}
 */
function avesmapsGaretienLabelUebersteuerung(?array $einstellungen, array $vorgabeDerArt): array
{
    $raus = $vorgabeDerArt;
    foreach (['size', 'priority', 'min_zoom', 'max_zoom'] as $feld) {
        if (is_array($einstellungen) && array_key_exists($feld, $einstellungen) && $einstellungen[$feld] !== null) {
            $raus[$feld] = $einstellungen[$feld];
        }
    }
    if (is_array($einstellungen) && array_key_exists('show_name', $einstellungen) && $einstellungen['show_name'] !== null) {
        $raus['show_name'] = (bool) $einstellungen['show_name'];
    }
    // 🔴 „Nodix" (Owner-Bestellung 30.08.2026, Bildschirmfoto „Beschriftung bearbeiten"): GENAU wie
    // is_locked/curve_label bei der Region hat auch dieses Feld KEINE Vorgabe der Art -- garetien.de
    // liefert nie eine Nodix-Aussage fuer ein Label, ihr Grundwert ist immer "aus". Eine Handeingabe
    // ist deshalb die EINZIGE Quelle, die es je auf "an" setzt.
    if (is_array($einstellungen) && array_key_exists('is_nodix', $einstellungen) && $einstellungen['is_nodix'] !== null) {
        $raus['is_nodix'] = (bool) $einstellungen['is_nodix'];
    }
    // 🔴 DIE HOEHE EINES BERGGIPFELS (Owner 31.08.2026: „die berggipfel brauchen eine höhe als
    // eigenschaft, gib ihnen das feld mit"). Sie reist NUR mit, wenn der Kasten sie ueberhaupt
    // nennt -- und der nennt sie nur, wenn ein Mensch etwas eingetippt hat.
    //
    // 💣 HIER STAND BIS HEUTE „KEINE height_schritt", und die Begruendung gilt unveraendert: ein
    // Gipfel ist ein STUETZPUNKT DES HOEHENFELDS (terrain-store.php liest is_active=1 +
    // height_schritt), und Volkers Daten tragen keine Hoehe. Was sich geaendert hat, ist die
    // QUELLE des Wertes: nicht mehr eine erfundene Vorgabe an jedem Gipfel, sondern eine Eingabe.
    // ⚠️ Leer bleibt leer: avesmapsReadOptionalPeakHeight macht daraus `null`, und
    // avesmapsCreateLabelFeature entfernt die Eigenschaft dann -- es gibt KEINE 0 als Vorgabe.
    // Wer hier je einen Rueckfallwert einbaut, veraendert das Gelaendemodell fuer jeden Gipfel,
    // den niemand angefasst hat, und es faellt an keiner Stelle auf.
    if (is_array($einstellungen) && array_key_exists('height_schritt', $einstellungen)
        && $einstellungen['height_schritt'] !== null && $einstellungen['height_schritt'] !== '') {
        $raus['height_schritt'] = $einstellungen['height_schritt'];
    }

    return $raus;
}

/**
 * Dieselbe Handeingabe, fuer die REGION (nur bei einer Flaeche gueltig -- ein Berggipfel haengt
 * an keiner ecosystem_region). „für Klicks gesperrt" (is_locked) und „Kurvenbeschreibung"
 * (curve_label/curve_label_max) haben KEINE Vorgabe der Art -- ihr Grundwert ist immer "aus", und
 * eine Handeingabe ist die einzige Quelle, die sie je auf "an" setzt.
 *
 * @param ?array $einstellungen Rumpf aus dem Kasten, oder null (keine Handeingabe).
 * @return array{is_locked?:bool, curve_label?:bool, curve_label_max?:int}
 */
function avesmapsGaretienRegionUebersteuerung(?array $einstellungen): array
{
    $raus = [];
    if (!is_array($einstellungen)) {
        return $raus;
    }
    if (array_key_exists('is_locked', $einstellungen) && $einstellungen['is_locked'] !== null) {
        $raus['is_locked'] = (bool) $einstellungen['is_locked'];
    }
    if (array_key_exists('curve_label', $einstellungen) && $einstellungen['curve_label'] !== null) {
        $raus['curve_label'] = (bool) $einstellungen['curve_label'];
    }
    if (array_key_exists('curve_label_max', $einstellungen) && $einstellungen['curve_label_max'] !== null) {
        $raus['curve_label_max'] = $einstellungen['curve_label_max'];
    }

    return $raus;
}



/**
 * Dieselbe Handeingabe, fuer den WEG (ziel='path'). Owner 30.08.2026: „dann weg bearbeiten".
 *
 * 🔴 GENAU ZWEI FELDER, und auch sie sind nicht frei gewaehlt: avesmapsCreatePathFeature
 * (api/_internal/map/features.php) liest aus dem Anfragerumpf nur `show_label` und
 * `allowed_transports`. `transport_seasons` steht ueberhaupt nicht in seinem $properties-Rumpf
 * (das setzt der Wege-Editor), `transport_domain` wird aus der Wegart abgeleitet, und die
 * Flussrichtung hat ihren eigenen Schreibweg. Ein Bedienelement dafuer waere eines, das nichts
 * tut -- und von einem, das wirkt, von aussen nicht zu unterscheiden.
 *
 * 🔴 EINE LEERE LISTE IST EINE AUSSAGE UND REIST MIT: sie heisst „kein Verkehrsmittel darf hier
 * fahren". Verschluckte man sie, fiele avesmapsReadAllowedTransports auf die Vorauswahl der Wegart
 * zurueck -- also auf das Gegenteil dessen, was der Editor abgehakt hat. Das Fenster warnt
 * sichtbar davor (garetienEingefuegtWirdWegMarkup), verhindert es aber nicht: derselbe Freiraum,
 * den der echte Dialog „Weg bearbeiten" auch hat.
 * ⚠️ Ein NICHT-Array wird dagegen verworfen statt durchgereicht. avesmapsReadAllowedTransports
 * faenge es zwar selbst ab, aber ein durchgereichter Unsinn saehe im Protokoll wie eine getroffene
 * Auswahl aus; „nicht genannt" ist hier die sichere Richtung, denn dann gilt die Vorauswahl.
 *
 * ⚠️ Die Werte der Liste bleiben UNGEPRUEFT -- avesmapsReadAllowedTransports ist die letzte Instanz
 * und wirft weg, was zur Domaene der Wegart nicht passt. Eine zweite Vertraeglichkeitspruefung hier
 * waere die zweite Wahrheit ueber dieselbe Verkehrsmittel-Tafel (AGENTS.md §5).
 *
 * @param ?array $einstellungen Rumpf aus dem Kasten, oder null (keine Handeingabe).
 * @return array{show_label?:bool, allowed_transports?:list<string>}
 */
function avesmapsGaretienWegUebersteuerung(?array $einstellungen): array
{
    $raus = [];
    if (!is_array($einstellungen)) {
        return $raus;
    }
    if (array_key_exists('show_label', $einstellungen) && $einstellungen['show_label'] !== null) {
        $raus['show_label'] = (bool) $einstellungen['show_label'];
    }
    if (array_key_exists('allowed_transports', $einstellungen) && is_array($einstellungen['allowed_transports'])) {
        $raus['allowed_transports'] = array_values($einstellungen['allowed_transports']);
    }

    return $raus;
}
/**
 * Dieselbe Handeingabe, fuer den ORT (ziel='location'). Owner 30.08.2026: „ja mach ort bearbeiten,
 * dann weg bearbeiten" -- der Kasten „Eingefuegt wird" zeigte diese Felder bis dahin nur an.
 *
 * 🔴 GENAU VIER FELDER, UND SIE SIND NICHT FREI GEWAEHLT: es sind die einzigen, die
 * avesmapsCreatePointFeature (api/_internal/map/features.php) beim Anlegen wirklich in
 * properties_json schreibt. is_nodix/is_ruined/is_hidden stehen fest in seinem $properties-Rumpf,
 * place_kind nur, wenn es nach avesmapsNormalizePlaceKind nicht leer ist. Alles andere aus dem
 * Dialog „Ort bearbeiten" (Einwohner, Lage, Herrscher) entsteht dort aus der WIKI-Zuweisung, nicht
 * aus dem Anfragerumpf -- ein Bedienelement dafuer waere eines, das nichts tut, und von einem, das
 * wirkt, von aussen nicht zu unterscheiden.
 *
 * 🔴 KEINE Vorgabe der Art, wie bei avesmapsGaretienRegionUebersteuerung: garetien.de trifft zu
 * keinem dieser vier eine Aussage, ihr Grundwert ist immer „aus" bzw. leer. Eine Handeingabe ist
 * die einzige Quelle, die sie je anders setzt.
 *
 * ⚠️ place_kind reist als ZEICHENKETTE durch, ungeprueft -- der Ortsarten-Katalog liegt in
 * api/_internal/wiki/place-kinds.php und wird von avesmapsCreatePointFeature befragt. Ihn hier ein
 * zweites Mal einzurasten waere die zweite Wahrheit ueber denselben Katalog (AGENTS.md §5); und
 * eine LEERE Art reist mit, statt weggelassen zu werden, damit "" nicht zwei Bedeutungen bekommt
 * („nicht genannt" gegen „ausdruecklich keine Art") -- der Anleger laesst den Schluessel dann weg.
 *
 * @param ?array $einstellungen Rumpf aus dem Kasten, oder null (keine Handeingabe).
 * @return array{is_nodix?:bool, is_ruined?:bool, is_hidden?:bool, place_kind?:string}
 */
function avesmapsGaretienOrtUebersteuerung(?array $einstellungen): array
{
    $raus = [];
    if (!is_array($einstellungen)) {
        return $raus;
    }
    foreach (['is_nodix', 'is_ruined', 'is_hidden'] as $feld) {
        if (array_key_exists($feld, $einstellungen) && $einstellungen[$feld] !== null) {
            $raus[$feld] = (bool) $einstellungen[$feld];
        }
    }
    if (array_key_exists('place_kind', $einstellungen) && $einstellungen['place_kind'] !== null) {
        $raus['place_kind'] = (string) $einstellungen['place_kind'];
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
 * @param ?array $einstellungen Handeingabe des Kastens „Eingefügt wird" (Owner 30.08.2026), oder
 *     null (keine -- z.B. „Alle angezeigten einfügen"). Siehe avesmapsGaretienLabelUebersteuerung
 *     / …RegionUebersteuerung.
 * @return array{public_id:string, entity_type:string, label_public_id:string}
 */
function avesmapsGaretienFlaecheAnlegen(PDO $pdo, array $nach, array $user, int $userId, ?array $einstellungen = null): array
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
        avesmapsGaretienLabelUebersteuerung($einstellungen, avesmapsGaretienLabelVorgabeFuerArt($pdo, (string) $nach['subtyp'])),
        $wikiZuweisung !== null ? ['wiki_region' => $wikiZuweisung] : []
    ), $user);
    $labelId = avesmapsGaretienPublicIdAus($label, 'Das Label der Flaeche');

    // 2. Region und Flaeche, ueber die Hausfunktionen der Landschaften-Ebene.
    // ⚠️ `auto_name` ausdruecklich false: der Name kommt aus Volkers Daten, nicht aus dem
    // Zeichengriff. Ohne das leitete der Dialog spaeter "automatisch benannt" ab und sperrte das
    // Namensfeld -- derselbe Merker, den auch der Zeichner mitschickt.
    // 🔴 „für Klicks gesperrt" / „Kurvenbeschreibung" (Owner 30.08.2026) -- avesmapsGaretienRegion
    // Uebersteuerung liefert nur, was der Kasten ausdruecklich setzt; ohne Handeingabe ein leeres
    // Array, unveraendert gegenueber dem bisherigen Verhalten.
    $region = avesmapsCreateEcosystemRegion($pdo, array_merge([
        'name' => (string) $nach['name'],
        'auto_name' => false,
        'kind' => (string) $nach['kind'],
        'region_type' => (string) $nach['subtyp'],
        'label_public_id' => $labelId,
    ], avesmapsGaretienRegionUebersteuerung($einstellungen)), $userId);
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
function avesmapsGaretienErgaenzungAnwenden(PDO $pdo, array $nach, string $publicId, array $user, string $entityKey = ''): array
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
    // 🔴 DER ZWEITE SCHREIBWEG FUER QUELLEN, und er ist der gefaehrlichere: hier bekommt ein
    // BESTEHENDES Objekt eine Quelle dazu. Er meldet die beruehrte Entitaet mit zurueck, damit der
    // Browser sie nachtragen kann (Owner-Meldung 31.08.2026) -- der Anlegeweg tut dasselbe an
    // seiner Stelle. Eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel.
    // ⚠️ Und aus demselben Grund geht er durch avesmapsGaretienQuellenAnlegen: die Artikelquelle
    // gehoert BEIDEN Wegen.
    $beruehrt = null;
    if (in_array('quelle', $felder, true)) {
        $quellen = avesmapsGaretienQuellenAnlegen($pdo, $entityType, $quellePublicId, $nach, $userId, $entityKey);
        if ($quellen > 0) {
            $geschrieben++;
            $beruehrt = ['entity_type' => $entityType, 'public_id' => $quellePublicId];
        }
    }

    return ['felder' => $geschrieben, 'quellen' => $quellen, 'quelle_an' => $beruehrt];
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
 * Die Handeingabe des Kastens „Eingefügt wird" aus dem Anfragerumpf lesen (Owner 30.08.2026).
 * Nur der EINZELKNOPF „Neu einfügen" schickt sie -- „Alle angezeigten einfügen" nennt den
 * Schluessel `einstellungen` im Rumpf nie (siehe die Verdrahtung in review-garetien-importer.js),
 * eine fehlende oder Nicht-Objekt-Angabe kommt deshalb als `null` zurueck: „keine Handeingabe",
 * nicht "alles auf 0/aus setzen".
 *
 * 🔴 KEINE VALIDIERUNG HIER -- nur die Form (ein assoziatives Array). Die Werte selbst reichen
 * unveraendert bis zu avesmapsCreateLabelFeature/avesmapsCreateEcosystemRegion durch, die als
 * letzte Instanz pruefen (AGENTS.md: der Server bleibt die letzte Instanz).
 *
 * @return ?array{size?:int, priority?:int, min_zoom?:int, max_zoom?:int, show_name?:bool,
 *     is_locked?:bool, curve_label?:bool, curve_label_max?:int}
 */
function avesmapsGaretienEinstellungenAusRumpf(array $payload): ?array
{
    $roh = $payload['einstellungen'] ?? null;

    return is_array($roh) ? $roh : null;
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
 * @param ?array $einstellungen Handeingabe des Kastens „Eingefügt wird" (Owner 30.08.2026), oder
 *     null. Gilt fuer ALLE 'new'-Items dieses Aufrufs -- das ist unbedenklich, weil der EINZIGE
 *     Aufrufer, der jemals eine Handeingabe mitschickt (der Einzelknopf „Neu einfügen"), $itemIds
 *     stets auf GENAU EIN Objekt skopiert (siehe garetienEinfuegenAusfuehren). Die Massenübernahme
 *     „Alle angezeigten einfügen" schickt NIE eine Handeingabe -- sie uebergibt hier immer null.
 */
function avesmapsGaretienApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null, ?array $itemIds = null, ?array $einstellungen = null): array
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
    $ergebnis = avesmapsGaretienUebernehmen($pdo, $runId, $ids, is_array($user) ? $user : ['id' => $userId], $einstellungen);
    $rest = $itemIds === null
        ? avesmapsSyncPlanPendingCount($pdo, $runId)
        : avesmapsGaretienPendingCountScoped($pdo, $runId, $itemIds);

    // 🔴 DER NACHZUG LAEUFT AM ENDE EINES ABGESCHLOSSENEN VORGANGS, nicht bei jedem Haeppchen.
    // Er traegt allem, was dieser Import je angelegt hat, seine Artikelquelle nach (Owner
    // 31.08.2026). Zwei Ausloeser hat er -- hier und in der `plan`-Aktion des Endpunkts; ein
    // verpasster Ausloeser verzoegert die Reparatur nur, er macht nichts inkonsistent.
    // ⚠️ Er ist hier bezahlbar, WEIL er ueberspringt, was die Quelle schon hat: nach dem ersten
    // Lauf kostet er zwei Abfragen und keinen Schreibvorgang.
    if ($rest === 0) {
        avesmapsGaretienArtikelQuellenNachtragen($pdo);
    }

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
        // Die Quellen der beruehrten Objekte, damit der Browser sie ohne Neuladen zeigen kann --
        // siehe die Begruendung am Ende von avesmapsGaretienUebernehmen.
        'quellen_neu' => $ergebnis['quellen_neu'] ?? [],
    ];
}

/**
 * DER NACHZUG: allem, was dieser Import schon angelegt hat, seine Artikelquelle nachtragen --
 * und dabei die tote Arbeitsseite in `feature_sources.note` heilen.
 *
 * Owner 31.08.2026: „go, und ja mach den nachzug". Ohne ihn bekaemen nur kuenftige Uebernahmen
 * die zweite Quelle, und alles bereits Importierte (darunter das Praioslob, an dem der Owner den
 * Artikel entdeckt hat) bliebe fuer immer ohne sie.
 *
 * 🔴 IDEMPOTENT DURCH DIE BAUFORM, nicht durch eine eigene Buchfuehrung.
 * `avesmapsFeatureSourceLink` ist ein `ON DUPLICATE KEY UPDATE` -- ein zweiter Lauf legt nichts
 * doppelt an, er schreibt dieselbe Zeile noch einmal. Eine eigene Liste „was habe ich schon
 * nachgetragen" waere die zweite Buchhaltung, die beim ersten Abbruch auseinanderlaeuft (dieselbe
 * Begruendung wie beim Item-Vermerk).
 *
 * ⚠️ ER SCHREIBT NUR AN OBJEKTE, DIE DIESER IMPORT ANGELEGT HAT: die Menge sind die Items mit
 * `apply_state='done'` in Laeufen der Art `garetien`. Ein von Hand gezeichnetes Objekt kann so
 * nicht getroffen werden -- und ein Objekt, das seine Artikelquelle laengst hat, bekommt sie
 * schlicht noch einmal geschrieben.
 *
 * 💣 DER TRICHTER IST DERSELBE (avesmapsGaretienQuellenAnlegen). Er entscheidet, WELCHE Quellen
 * ein Objekt bekommt; haette der Nachzug eine eigene Fassung, muesste jede kuenftige Aenderung an
 * zwei Stellen nachgezogen werden -- und die stille Abweichung waere „das Objekt von damals
 * bekommt etwas anderes als das von heute".
 *
 * ⚠️ `userId` 0 wie beim Uebernahme-Nachtrag daneben: wer es damals uebernommen hat, steht im
 * Item nicht, und eine erfundene Kennung waere schlimmer als keine.
 *
 * @return array{geprueft:int, geschrieben:int}
 */
function avesmapsGaretienArtikelQuellenNachtragen(PDO $pdo): array
{
    try {
        $stmt = $pdo->prepare(
            'SELECT i.entity_key, i.after_json, i.change_type, i.entity_public_id, i.apply_note
               FROM sync_plan_item i
               JOIN sync_plan_run r ON r.id = i.run_id
              WHERE r.kind = :k AND i.apply_state = :s'
        );
        $stmt->execute(['k' => AVESMAPS_GARETIEN_PLAN_KIND, 's' => 'done']);
    } catch (PDOException) {
        // Die Tabellen stehen noch nicht -- der Normalfall vor dem allerersten Lauf.
        return ['geprueft' => 0, 'geschrieben' => 0];
    }

    // 💣 WER SIE SCHON HAT, WIRD UEBERSPRUNGEN -- und das ist die Bedingung, unter der dieser
    // Nachzug ueberhaupt zweimal laufen darf. `avesmapsFeatureSourceLink` ist zwar idempotent,
    // schreibt aber jedes Mal; ohne diesen Riegel kostete jeder abgeschlossene Uebernahme-Vorgang
    // am Ende bis zu 8213 Schreibvorgaenge fuer nichts. Mit ihm sind es nach dem ersten Lauf ZWEI
    // Abfragen und null Schreibvorgaenge.
    // ⚠️ Erkannt an der ADRESSFORM (`/index.php/`), nicht an einer Zaehlung: „das Objekt hat zwei
    // garetien-Quellen" waere auch dann wahr, wenn jemand von Hand eine zweite angehaengt hat.
    $schon = [];
    try {
        $vorhanden = $pdo->prepare(
            "SELECT fs.entity_type, fs.entity_public_id
               FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
              WHERE fs.origin = :o AND s.url LIKE '%/index.php/%'"
        );
        $vorhanden->execute(['o' => AVESMAPS_GARETIEN_SOURCE_ORIGIN]);
        foreach ($vorhanden->fetchAll(PDO::FETCH_ASSOC) as $v) {
            $schon[$v['entity_type'] . ':' . $v['entity_public_id']] = true;
        }
    } catch (PDOException) {
        // Ohne die Quellentabellen gibt es nichts zu ueberspringen -- der Nachzug legt sie an.
    }

    $geprueft = 0;
    $geschrieben = 0;
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $nach = json_decode((string) ($zeile['after_json'] ?? ''), true);
        if (!is_array($nach) || ($nach['herkunft'] ?? '') !== 'garetien') {
            continue;
        }
        $entityKey = (string) ($zeile['entity_key'] ?? '');
        // ⚠️ Ohne Artikel gibt es nichts nachzutragen -- 42 % der Zeilen (Wege, Waelder). Der
        // Riegel steht VOR der Aufloesung, damit ein Lauf ohne Artikel keine Abfrage kostet.
        if (avesmapsGaretienArtikelQuelleAusItem($nach, $entityKey) === null) {
            continue;
        }
        $geprueft++;
        // 💣 DIE public_id STEHT AN ZWEI VERSCHIEDENEN STELLEN, je nach Art des Items -- und das
        // ist keine Wahl, sondern die Bauform der Uebernahme (siehe die zwei Zweige in
        // avesmapsGaretienRuecknahmeAusfuehren):
        //   · 'new'      -> die FRISCH ANGELEGTE id steht in `apply_note` (entity_public_id ist
        //                    bei einem Neuzugang von Anfang an NULL -- vor der Uebernahme gibt es
        //                    kein Ziel).
        //   · 'changed'  -> `entity_public_id` ist seit dem Planbau das ZIEL.
        // Wer nur eine der beiden liest, traegt die halbe Menge nach und merkt es nicht: die
        // andere Haelfte faellt still durch, weil eine leere id einfach uebersprungen wird.
        $objektId = trim((string) ($zeile['entity_public_id'] ?? ''));
        if ($objektId === '') {
            $objektId = trim((string) ($zeile['apply_note'] ?? ''));
        }
        if ($objektId === '') {
            continue;
        }
        try {
            [$entityType, $quellePublicId] = avesmapsGaretienQuelleZielAufloesen(
                $pdo,
                (string) ($nach['ziel'] ?? ''),
                $objektId
            );
        } catch (Throwable) {
            // 🔴 EIN OBJEKT, DAS ES NICHT MEHR GIBT, HAELT DEN NACHZUG NICHT AN. Zurueckgenommene
            // und von Hand geloeschte Objekte sind der Normalfall, kein Fehler.
            continue;
        }
        if ($entityType === '' || $quellePublicId === '') {
            continue;
        }
        if (isset($schon[$entityType . ':' . $quellePublicId])) {
            continue;
        }
        if (avesmapsGaretienQuellenAnlegen($pdo, $entityType, $quellePublicId, $nach, 0, $entityKey) > 0) {
            $geschrieben++;
            // ⚠️ Innerhalb EINES Laufs mitfuehren: mehrere Items koennen auf dasselbe Objekt
            // zeigen (eine Flaeche und ihre Beschriftung), und ohne das zaehlte der Lauf sie
            // doppelt -- und schriebe sie doppelt.
            $schon[$entityType . ':' . $quellePublicId] = true;
        }
    }

    // 💣 EIN STEMPEL, UND NUR WENN WIRKLICH ETWAS GESCHRIEBEN WURDE -- dieselbe Regel wie am
    // Ende von avesmapsGaretienUebernehmen: ein Stempel ohne Schreibvorgang entwertet die Kopie
    // JEDES Besuchers fuer nichts.
    if ($geschrieben > 0) {
        avesmapsNextMapRevision($pdo);
    }

    return ['geprueft' => $geprueft, 'geschrieben' => $geschrieben];
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
function avesmapsGaretienItemAbschliessen(PDO $pdo, int $itemId, string $applyState, string $note = '', int $userId = 0): void
{
    avesmapsSyncPlanMarkItem($pdo, $itemId, $applyState, $note);
    $pdo->prepare('UPDATE sync_plan_item SET selected = 0 WHERE id = :id')->execute(['id' => $itemId]);

    // 🔴 DER DAUERHAFTE VERMERK STEHT HIER UND NICHT AN DEN AUFRUFSTELLEN. `done` wird an ZWEI
    // Stellen gesetzt (die Ergaenzung und das Anlegen) -- eine Regel, die einen von zwei Erzeugern
    // bindet, ist keine Regel, und dieses Projekt hat das schon zweimal bezahlt. Wer einen dritten
    // Ausgang baut, erbt den Vermerk hier automatisch.
    //
    // 🔴 WOZU (Owner 30.08.2026): `apply_state` stirbt mit dem Lauf, `sync_decision` nicht. Ohne
    // diesen Vermerk faellt jede Uebernahme beim naechsten „Holen & Rechnen" auf „Offen" zurueck,
    // waehrend eine Ablehnung liegenbleibt -- und die Liste laesst sich nie leer arbeiten.
    // ⚠️ NUR bei 'done'. Ein 'failed' oder 'stale' ist keine Entscheidung, sondern ein Befund.
    if ($applyState !== 'done') {
        return;
    }
    $stmt = $pdo->prepare('SELECT entity_key, change_type FROM sync_plan_item WHERE id = :id');
    $stmt->execute(['id' => $itemId]);
    $zeile = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($zeile)) {
        return;
    }
    avesmapsSyncPlanRecordApplied(
        $pdo,
        AVESMAPS_GARETIEN_PLAN_KIND,
        (string) $zeile['entity_key'],
        $userId,
        (string) $zeile['change_type']
    );
}

/**
 * Die angehakten Vorschlaege eines Vorschau-Laufs uebernehmen.
 *
 * @param list<int> $itemIds Nur diese Items -- alles andere bleibt unberuehrt.
 * @param ?array $einstellungen Handeingabe des Kastens „Eingefügt wird" (Owner 30.08.2026,
 *     „warum darf ich das nicht verändern?"), oder null (keine -- der Grundfall, und IMMER der
 *     Fall bei „Alle angezeigten einfügen"). Wirkt nur auf 'new'-Items mit ziel 'region'/'label'
 *     -- ein Ort/Weg speichert keines dieser Felder, siehe avesmapsGaretienLabelUebersteuerung.
 * @return array{angelegt:int, quellen:int, fehler:list<array{item:int, grund:string}>}
 */
function avesmapsGaretienUebernehmen(PDO $pdo, int $runId, array $itemIds, array $user = [], ?array $einstellungen = null): array
{
    if ($itemIds === []) {
        return ['angelegt' => 0, 'quellen' => 0, 'fehler' => [], 'quellen_neu' => []];
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

    // 🔴 WAS DER BROWSER NACHTRAGEN MUSS (Owner-Meldung 31.08.2026: „ich hab ein moor importiert,
    // aber es fehlt die 'quelle, die mitreist', erst wenn ich die seite komplett neulade stehts
    // dran"). Die Infobox liest ihre Quellen aus zwei Globals, die GENAU EINMAL gefuellt werden --
    // beim Laden der Kartennutzlast (js/routing/routing.js). Ein Objekt, das waehrend der Sitzung
    // entsteht, stand dort nicht; seine Quelle ist in der Datenbank, der Browser weiss nur nichts
    // davon.
    // ⭐ Das Werkzeug dagegen gibt es laengst: syncFeatureSourcesToClientCache
    // (js/review/review-feature-sources.js), vom Quellen-Editor benutzt. Ihm fehlt nur die
    // `public_id` des frisch angelegten Objekts -- und die kennt nur der Server. Genau die reist
    // hier zurueck.
    $quellenNeu = [];
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
                    $pdo, $nach, (string) $item['entity_public_id'], $user, (string) $item['entity_key']
                );
                $angelegt += $ergebnis['felder'] > 0 ? 1 : 0;
                $quellen += $ergebnis['quellen'];
                if (is_array($ergebnis['quelle_an'] ?? null)) {
                    $quellenNeu[$ergebnis['quelle_an']['entity_type'] . ':' . $ergebnis['quelle_an']['public_id']]
                        = $ergebnis['quelle_an'];
                }
                avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'done', (string) $item['entity_public_id'], $userId);
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
                // 🔴 DIE HANDEINGABE DES KASTENS „Eingefuegt wird" (Owner 30.08.2026: „dann weg
                // bearbeiten"). Ohne sie ist das dritte Array LEER, und dann ist dieser Aufruf
                // zeichengleich mit dem von vorher -- „Alle angezeigten einfuegen" schickt nie
                // Einstellungen und legt Wege deshalb weiter genau wie bisher an.
                $feature = avesmapsCreatePathFeature($pdo, array_merge([
                    'name' => (string) $nach['name'],
                    'feature_subtype' => (string) $nach['subtyp'],
                    // 🔴 Das Bach-Haekchen der Zuordnung (AVESMAPS_GARETIEN_TYP_MAP['Bach']).
                    // avesmapsCreatePathFeature gibt es an avesmapsPathTransportRegel weiter, und
                    // die nimmt einem Bach jede Befahrbarkeit -- baulich, nicht per Bedingung.
                    'is_bach' => avesmapsGaretienNachIstBach($nach),
                    // 💣 GeoJSON [x,y] -> Hausvertrag, siehe avesmapsGaretienGeoJsonNachHausvertrag.
                    'coordinates' => avesmapsGaretienGeoJsonNachHausvertrag((array) $nach['geometry']['coordinates']),
                ], avesmapsGaretienWegUebersteuerung($einstellungen)), $user);
                $publicId = avesmapsGaretienPublicIdAus($feature, 'Der Weg');
                $entityType = 'path';
                $quellePublicId = $publicId;
            } elseif ($ziel === 'location') {
                // Ortschaften (Entwurf §3.1) -- ein Ort ist ein PUNKT, avesmapsCreatePointFeature
                // setzt feature_type='location' und liest settlement_class aus 'feature_subtype'.
                $punkt = avesmapsGaretienPunktAusGeometrie($nach);
                // 🔴 DIE HANDEINGABE DES KASTENS „Eingefuegt wird" (Owner 30.08.2026: „ja mach ort
                // bearbeiten"). Ohne sie ist das dritte Array LEER, und dann ist dieser Aufruf
                // zeichengleich mit dem von vorher -- „Alle angezeigten einfuegen" schickt nie
                // Einstellungen und legt Orte deshalb weiter genau wie bisher an.
                $feature = avesmapsCreatePointFeature($pdo, array_merge([
                    'name' => (string) $nach['name'],
                    'feature_subtype' => (string) $nach['subtyp'],
                    'lng' => $punkt['lng'],
                    'lat' => $punkt['lat'],
                ], avesmapsGaretienOrtUebersteuerung($einstellungen)), $user);
                $publicId = avesmapsGaretienPublicIdAus($feature, 'Der Ort');
                // 🔴 map-features.php:1228 ($entityTypeByFeatureType) bindet feature_type
                // 'location' an entity_type 'settlement' -- dieselbe Auskunft, an der der
                // Quellenkasten der Infobox seine Zeilen sucht. Ein anderer Wert liesse die
                // Quelle unauffindbar im Katalog liegen.
                $entityType = 'settlement';
                $quellePublicId = $publicId;
            } elseif ($ziel === 'label') {
                // 🔴 Der Berggipfel ist die EINZIGE Punkt-Ausnahme: ein Label OHNE Region/Flaeche
                // dahinter (Entwurf §3.4).
                // 💣 `height_schritt` KOMMT NUR AUS EINER EINGABE, nie aus einer Vorgabe. Ein
                // Gipfel ist ein Stuetzpunkt des Hoehenfelds (terrain-store.php liest is_active=1
                // + height_schritt), und Volkers Daten tragen keine Hoehe -- ein erfundener Wert
                // veraendert das Gelaendemodell lautlos falsch.
                // ⚠️ Bis zum 31.08.2026 stand hier „das Feld bleibt WEG". Seither hat der Kasten
                // „Eingefuegt wird" eine Hoehenzeile (Owner: „gib ihnen das feld mit") -- LEER
                // vorbelegt, und leer schickt den Schluessel gar nicht mit. Die Gefahr ist damit
                // dieselbe geblieben und nur ihre Quelle eine andere: solange niemand tippt,
                // passiert genau das, was vorher passierte.
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
                    avesmapsGaretienLabelUebersteuerung($einstellungen, avesmapsGaretienLabelVorgabeFuerArt($pdo, (string) $nach['subtyp'])),
                    $wikiZuweisung !== null ? ['wiki_region' => $wikiZuweisung] : []
                ), $user);
                $publicId = avesmapsGaretienPublicIdAus($feature, 'Der Gipfel');
                // 🔴 Dieselbe Bindung wie oben: feature_type 'label' -> entity_type 'region'
                // (map-features.php:1228), KEYED AN DER PUBLIC_ID DES LABELS SELBST -- es gibt
                // hier keine Region, an die die Quelle stattdessen haengen koennte.
                $entityType = 'region';
                $quellePublicId = $publicId;
            } else {
                $ergebnis = avesmapsGaretienFlaecheAnlegen($pdo, $nach, $user, $userId, $einstellungen);
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
            $neueQuellen = avesmapsGaretienQuellenAnlegen(
                $pdo, $entityType, $quellePublicId, $nach, $userId, (string) $item['entity_key']
            );
            if ($neueQuellen > 0) {
                $quellen += $neueQuellen;
                $quellenNeu[$entityType . ':' . $quellePublicId] = [
                    'entity_type' => $entityType,
                    'public_id' => $quellePublicId,
                ];
            }
            avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'done', $publicId, $userId);
        } catch (Throwable $abbruch) {
            // 🔴 Ein Fehlschlag bei EINEM Objekt haelt die uebrigen nicht auf, aber er wird
            // benannt. Ein stiller Ueberspringer waere von "wurde angelegt" nicht zu
            // unterscheiden -- und die Zahl im Ergebnis waere eine Behauptung.
            $fehler[] = ['item' => (int) $item['id'], 'grund' => $abbruch->getMessage()];
            avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'failed', mb_substr($abbruch->getMessage(), 0, 300, 'UTF-8'));
        }
    }

    // 💣 EIN STEMPEL FUER DEN GANZEN LAUF -- UND ER MUSS GANZ ANS ENDE.
    // avesmapsFeatureSourceLink hebt die Kartenrevision NICHT (es ist der reine Schreiber; alle vier
    // Hauspfade in api/_internal/app/feature-sources.php rufen avesmapsNextMapRevision selbst).
    // Dieser Import tat es nicht, und das kostete zweierlei:
    //
    //   · Ein Item, das NUR eine Quelle ergaenzt (der Normalfall bei Wegen und Orten, die es schon
    //     gibt), aenderte kein einziges Kartenobjekt. Die Revision blieb stehen, der ETag auch --
    //     jeder warme Browser bekam sein 304 samt alter Nutzlast und sah die Quelle NIE. Seit dem
    //     27.08.2026 legt der Client Nutzlast und Tag zusaetzlich in IndexedDB ab; es heilt also
    //     auch durch Neuladen nicht von selbst.
    //   · Beim ANLEGEN hob zwar die Objektanlage die Revision -- aber VOR dem Quellen-Link. Faellt
    //     dazwischen eine Kartenanfrage, schreibt der Ganzkoerper-Dateicache genau diese Revision
    //     OHNE die Quelle fest und liefert sie allen weiter aus. Genau so sah der Owner am
    //     30.08.2026 ein frisch importiertes Moor ohne jede Quellenangabe.
    //
    // 🔴 NUR WENN WIRKLICH ETWAS GESCHRIEBEN WURDE. Ein Stempel ohne Schreibvorgang entwertet die
    // Kopie JEDES Besuchers (rund 3 MB je Wiederbesuch) fuer nichts -- ein Lauf, der nur "stale"
    // und "failed" produziert hat, hat die Karte nicht angefasst.
    // ⚠️ Die Fehlerrichtung ist bewusst die teure: im Zweifel lieber ein Stempel zu viel als eine
    // Quellenangabe, die nie jemand zu sehen bekommt (dieselbe Wahl wie beim Klimastempel).
    if ($angelegt > 0 || $quellen > 0) {
        avesmapsNextMapRevision($pdo);
    }

    // 💣 DIE VOLLE LISTE, NICHT NUR UNSERE QUELLE -- und das ist die Falle dieser Aufgabe.
    // `syncFeatureSourcesToClientCache` (js/review/review-feature-sources.js) UEBERSCHREIBT die
    // Quellenliste einer Entitaet. Bei einem frisch angelegten Objekt ist unsere die einzige, da
    // waere der Unterschied unsichtbar. Bei einer ERGAENZUNG haengen wir eine Quelle an ein
    // BESTEHENDES Objekt -- schickten wir dort nur unsere, verschwaenden seine anderen Quellen aus
    // der Anzeige, bis jemand neu laedt. Genau der Fall, den der Owner gemeldet hat (Eupelmunder
    // Moor), nur andersherum.
    // ⚠️ EINE Abfrage je beruehrter Entitaet, nicht je Item: `$quellenNeu` ist ueber
    // "<typ>:<public_id>" entdoppelt.
    // ⚠️ avesmapsListFeatureSourcesForEdit ist nicht rein: es holt unterwegs eine alte
    // `properties.other_source` in die geteilte Tabelle nach (avesmapsFeatureSourcesTakeoverOtherSource).
    // Das ist gewollt und dieselbe Haustuer, die der Quellen-Editor beim Oeffnen benutzt -- ein
    // frisch angelegtes Objekt hat das Feld nie, ein ergaenztes altes wird dabei aufgeraeumt.
    $quellenRueck = [];
    foreach ($quellenNeu as $eintrag) {
        $quellenRueck[] = [
            'entity_type' => $eintrag['entity_type'],
            'public_id' => $eintrag['public_id'],
            // ⚠️ NUR die Liste, nicht die ganze Huelle: avesmapsListFeatureSourcesForEdit
            // liefert ['ok','sources','wiki_url','revision']. Der Browser erwartet die Liste.
            'sources' => avesmapsListFeatureSourcesForEdit(
                $pdo, $eintrag['entity_type'], $eintrag['public_id'], $userId
            )['sources'] ?? [],
        ];
    }

    return [
        'angelegt' => $angelegt, 'quellen' => $quellen, 'fehler' => $fehler,
        'quellen_neu' => $quellenRueck,
    ];
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
