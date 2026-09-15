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
// ⚠️ NACH `../map/features.php`, und das ist tragend: `avesmapsSettlementPlaceAdd` braucht
// `avesmapsUuidV4`, und die wohnt dort (settlement-places.php bindet sie bewusst nicht selbst ein
// -- siehe den Kopf jener Datei). Umgedreht wirft die Staetten-Anlage beim ersten Klick.
require_once __DIR__ . '/../app/settlement-places.php';
// 🔴 „QUELLE UND NAMEN ERGAENZEN" (15.09.2026) fragt die Griff-Regel der Kartensuche
// (avesmapsLandscapeSearchAutoNamePattern). Die Datei ist rein -- kein DDL, nichts laeuft beim
// Einbinden --, und ihre drei Nachbarn holt sie selbst per require_once; ecosystem-naming.php und
// ecosystem-label-link.php sind ueber ../app/ecosystem.php ohnehin schon geladen.
require_once __DIR__ . '/../app/landscape-search.php';

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

// 🔴 avesmapsGaretienRingMittelpunkt IST UMGEZOGEN nach garetien-plan.php (01.09.2026).
// Der Planbau braucht ihn jetzt selbst -- ein Punktziel (Ort, freies Label) bekommt seit heute
// den Flaechenmittelpunkt statt der ersten Ringecke. Und die Abhaengigkeit laeuft nur in eine
// Richtung: uebernahme.php `require`t plan.php, nicht umgekehrt.

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
    // 🔴 EINE VERKNUEPFUNG, DIE EINEM ANDEREN GEHOERT, WIRD NICHT ANGEFASST.
    //
    // Gemessen am 01.09.2026: `avesmapsFeatureSourceLink` ist ein `ON DUPLICATE KEY UPDATE` und
    // setzt `note`, `pages` und `reference_kind` bei JEDEM Aufruf neu. Es schuetzt zwar `origin`
    // (ein `manual` bleibt `manual`) -- aber eine von Hand gesetzte Notiz wurde durch unsere
    // Export-Arbeitsseite ersetzt:
    //     vorher   origin=manual  note="von Hand geprueft"
    //     nachher  origin=manual  note="…/Avesmaps_Wege"
    //
    // 💣 Das ist derselbe stille Schreibzugriff auf fremde Arbeit, den der Owner am 31.08.2026
    // am OBJEKT abgeschaltet hat -- nur eine Etage tiefer, an der Verknuepfung. Die Quelle haengt
    // ja bereits; es gibt hier nichts zu gewinnen und eine Notiz zu verlieren.
    //
    // ⚠️ Gefragt wird nach `origin`, nicht nach „existiert schon": eine Verknuepfung, die noch
    // uns gehoert (`origin='garetien'`), darf ihre Notiz sehr wohl auffrischen -- sonst bliebe die
    // tote `…/Avesmaps_<Artikel>`-Adresse aus der Zeit vor dem 31.08.2026 fuer immer stehen.
    $bestand = $pdo->prepare(
        'SELECT origin FROM feature_sources
          WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid'
    );
    $bestand->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $sourceId]);
    $bisher = $bestand->fetchColumn();
    if ($bisher !== false && (string) $bisher !== AVESMAPS_GARETIEN_SOURCE_ORIGIN) {
        return false;   // haengt schon und gehoert jemand anderem
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

    // 🔴 DER ARTIKEL SCHLAEGT DIE SAMMELQUELLE, und diese Weiche entsteht NICHT hier: sie
    // steht in avesmapsGaretienQuellenAdressenAus, und der Planbau fragt dieselbe Funktion, um zu
    // wissen, ob an einem Objekt noch etwas fehlt.
    //
    // 💣 DAS IST DIE TRAGENDE ZEILE DIESER FUNKTION. Rechnete der Schreiber seine Adressen
    // selbst aus, waere die erwartete Menge des Planbaus eine BEHAUPTUNG ueber ihn -- und beim
    // ersten Auseinanderlaufen bietet der Planbau eine Quelle an, die nie kommt, oder der Nachzug
    // schreibt in jedem Lauf erneut. Genau das ist am 01.09.2026 schon einmal passiert (die
    // Liste nannte den Wirt IMMER, der Schreiber haengte ihn nicht immer an).
    $artikel = avesmapsGaretienArtikelQuelleAusItem($nach, $entityKey);
    $wirt = (array) ($nach['quelle'] ?? []);
    $adressen = avesmapsGaretienQuellenAdressenAus((string) ($wirt['url'] ?? ''), $artikel);

    $gezaehlt = 0;
    foreach ($adressen as $adresse) {
        // Welcher der beiden Beschreibungssaetze zu dieser Adresse gehoert -- Label, Lizenz und
        // Namensnennung stehen dort und nicht in der Adressliste.
        $quelle = ($artikel !== null && (string) ($artikel['url'] ?? '') === $adresse)
            ? $artikel
            : $wirt;
        if (avesmapsGaretienQuelleAnlegen($pdo, $entityType, $publicId, $quelle, $userId, $seiteUrl)) {
            $gezaehlt++;
        }
    }

    return $gezaehlt;
}


/**
 * Alle Adressen, die dieser Import (`origin='garetien'`) GERADE an dieser Entitaet haengen hat.
 * Ein Lesevorgang, keine Aenderung.
 *
 * 🔴 NACHBESSERUNG 3 (W1c). Der einzige verbleibende Rueckweg, der ALLE Adressen einer Entitaet
 * auf einmal braucht, ist der Regions-Rueckweg beim Wegfall der LETZTEN Flaeche
 * (avesmapsGaretienRuecknahmeAusfuehren, 'region'-Ziel): mehrere Fragment-Flaechen koennen ueber
 * die Zeit unterschiedliche Adressen an dieselbe Region gehaengt haben. Die beiden anderen
 * Rueckwege (Nur-Quelle, `changed`-Quelle) kennen immer nur die EINE Adresse, die SIE SELBST
 * getragen haben (avesmapsGaretienQuellenAdressenAus), und brauchen diese Funktion nicht.
 *
 * ⚠️ ERSETZT das fruehere avesmapsGaretienQuelleRuecknahmeLoesen (Nachbesserung 2 zog seinen
 * einzigen verbliebenen Aufrufer -- den `changed`-Quelle-Rueckweg -- bereits ab; Nachbesserung 3
 * entfernt die Funktion selbst, weil danach niemand mehr sie RUFT: repoweit gegengeprueft,
 * `grep -rn avesmapsGaretienQuelleRuecknahmeLoesen` findet danach nur noch ERKLAERENDE Kommentare
 * wie diesen -- keinen Aufruf mehr, keine Funktionsdefinition mehr.
 */
function avesmapsGaretienGaretienAdressenAn(PDO $pdo, string $entityType, string $entityPublicId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);

    $stmt = $pdo->prepare(
        'SELECT s.url FROM feature_sources fs JOIN sources s ON s.id = fs.source_id'
        . ' WHERE fs.entity_type = :t AND fs.entity_public_id = :id AND fs.origin = :o'
    );
    $stmt->execute(['t' => $entityType, 'id' => $entityPublicId, 'o' => AVESMAPS_GARETIEN_SOURCE_ORIGIN]);

    return array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

/**
 * Wie viele AKTIVE Flaechen traegt diese Region noch? 0 auch dann, wenn es die Region nicht (mehr) gibt.
 *
 * 🔴 EINE FRAGE, ZWEI LESER: die Anfuehrer-Suche (ein Teil haengt sich nie an eine leere Region) und
 * die Ruecknahme (die Quelle der Region faellt erst mit der letzten Flaeche). Gefragt wird die
 * TABELLE, nie eine Rueckgabe der Kaskade -- die ist abschaltbar (AVESMAPS_ECOSYSTEM_CASCADE_ENABLED).
 */
function avesmapsGaretienRegionAktiveFlaechen(PDO $pdo, string $regionPublicId): int
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM ecosystem_area a JOIN ecosystem_region r ON r.id = a.region_id'
        . ' WHERE r.public_id = :p AND a.is_active = 1'
    );
    $stmt->execute([':p' => $regionPublicId]);

    return (int) $stmt->fetchColumn();
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
 * 🔴 KEINE HANDEINGABE HEISST: WEDER `$einstellungen` NOCH EIN EIGENER EINTRAG IN `$jeItem`. Dann
 * ist das Ergebnis exakt $vorgabeDerArt, unveraendert.
 * 🪤 HIER STAND BIS ZUM 07.09.2026: „die Massenübernahme nimmt IMMER die Vorgabe der Art, nie die
 * Handeingabe eines einzelnen Objekts". Das galt fuer „Alle angezeigten einfügen" -- den Knopf gibt
 * es nicht mehr. Sein Nachfolger „Stage importieren" schickt seit dem 07.09.2026
 * `einstellungen_je_item` (garetienStageEinstellungenJeItem, review-garetien-importer.js): EINEN
 * Rumpf JE OBJEKT, und die Regel „ein gemeinsamer Rumpf fuer viele Objekte ist verboten" wird
 * genau dadurch gewahrt -- `$einstellungen` bleibt dort weiterhin `null`.
 * ⚠️ Wer den alten Satz liest, baut den Fehler wieder ein, der am 07.09.2026 gemessen wurde: der
 * Editor waehlte „Berggipfel", angelegt wurde ein Gebirge, und die Anzeige behauptete das Gegenteil.
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
 * Der Vermerk eines uebernommenen Verbund-Fragments.
 *
 * 🔴 ER IST DIE WAHRHEIT, NICHT DIE NAMENSREGEL. Wuerde der Reiter „Uebernommen" die Verbuende
 * beim Anzeigen neu ausrechnen, zeigte er nach jeder Aenderung der Erkennungsregel eine andere
 * Gruppierung als die, die tatsaechlich geschrieben wurde.
 */
function avesmapsGaretienVerbundVermerk(string $areaPublicId, string $regionPublicId, string $verbund): string
{
    return 'area:' . $areaPublicId . ' | region:' . $regionPublicId . ' | verbund:' . $verbund;
}

/**
 * Die Umkehrung.
 *
 * 💣 EIN ALTER VERMERK IST EINE NACKTE public_id. Jedes vor diesem Umbau importierte Objekt
 * traegt sie so, und die Ruecknahme liest genau dieses Feld -- ohne den Rueckfall verloere sie
 * ihr Ziel und boete eine Loeschung an, die nur noch scheitern kann.
 *
 * @return array{area:string,region:string,verbund:string}
 */
function avesmapsGaretienVermerkLesen(string $note): array
{
    $raus = ['area' => '', 'region' => '', 'verbund' => ''];
    $n = trim($note);
    if ($n === '') {
        return $raus;
    }
    if (!str_contains($n, ':')) {
        $raus['region'] = $n;   // der alte Vermerk
        return $raus;
    }
    foreach (explode('|', $n) as $stueck) {
        $stueck = trim($stueck);
        $pos = strpos($stueck, ':');
        if ($pos === false) {
            continue;
        }
        $feld = substr($stueck, 0, $pos);
        if (array_key_exists($feld, $raus)) {
            $raus[$feld] = trim(substr($stueck, $pos + 1));
        }
    }

    return $raus;
}

/**
 * Wie viele Kandidaten-Vermerke prueft die Anfuehrer-Suche hoechstens, bevor sie aufgibt?
 *
 * ⭐ KEINE OFFENE MENGE. Im Regelfall traegt praktisch jeder Vermerk desselben Verbund-Stamms
 * dieselbe Region -- alle Geschwister eines gesunden Verbunds fanden beim eigenen Import denselben
 * Anfuehrer und schrieben ihn unveraendert weiter. Mehrere VERSCHIEDENE Regionen fuer einen Stamm
 * entstehen nur in den zwei Fehlerfaellen, die diese Funktion abfaengt: eine von Hand geloeschte
 * Region (Befund D) oder ein Art-Wechsel zwischen zwei Laeufen (Befund E) -- beides seltene,
 * einstellige Vorkommnisse je Verbund, kein wiederkehrendes Muster. 20 deckt jeden bisher
 * beobachteten Fall um ein Vielfaches ab, ohne die `LIKE`-Ergebnisliste unbegrenzt abzuklappern.
 */
const AVESMAPS_GARETIEN_VERBUND_KANDIDATEN_DECKEL = 20;

/**
 * Hat dieser Verbund schon eine Region -- in DIESEM oder einem FRUEHEREN Lauf, noch AKTIV, und von
 * DERSELBEN ART wie das, was dieses Fragment anlegen wuerde? Dann ist ihr Anfuehrer schon durch.
 *
 * 🔴 LAUFUEBERGREIFEND, NICHT `run_id`-GEBUNDEN (Entwurf §6: "derselbe Weg, den die
 * laufuebergreifende Ruecknahme heute schon geht" -- avesmapsGaretienRuecknahmeAusfuehren sucht
 * bei fehlendem Vermerk ueber `r.kind`, nie ueber `run_id`). Ein "Holen & Rechnen" setzt den
 * alten Lauf nur auf `superseded`, loescht ihn aber NIE (avesmapsSyncPlanStartRun). Fragmente
 * desselben Verbunds, die in verschiedenen Laeufen ankommen (Item 1-2 in Lauf A, Item 3-4 nach
 * einem Neu-Rechnen in Lauf B), faenden ihren Anfuehrer sonst nie und legten eine ZWEITE Region
 * gleichen Namens an -- ohne jede Meldung.
 *
 * 🔴 FIXRUNDE 2, BEFUND D (wichtig): der ERSTE Treffer allein reicht nicht mehr -- eine von Hand im
 * Landschaften-Editor GELOESCHTE Region setzt nur `ecosystem_region.is_active = 0`; die Ruecknahme
 * (die den Vermerk auf NULL zuruecksetzt) ist ein ANDERER Pfad und wird davon nicht beruehrt. Ein
 * Nachzuegler faende sonst eine tote `region_public_id` und scheiterte an
 * `avesmapsCreateEcosystemArea` mit "The ecosystem region was not found." -- deshalb werden bis zu
 * `AVESMAPS_GARETIEN_VERBUND_KANDIDATEN_DECKEL` Vermerke (juengste zuerst) geprueft, bis einer
 * traegt; bleibt keiner uebrig, gibt es `null` zurueck und DIESES Fragment wird selbst zum neuen
 * Anfuehrer (siehe avesmapsGaretienFlaecheAnlegen).
 *
 * 🔴 FIXRUNDE 2, BEFUND E (wichtig): "passt zur Art" wird gegen die GESPEICHERTEN Spalten
 * `ecosystem_region.kind`/`region_type` der Kandidaten-Region gemessen -- dieselben zwei Spalten,
 * die `avesmapsGaretienFlaecheAnlegen` beim Anlegen aus `$nach['kind']`/`$nach['subtyp']` setzt.
 * Der Vermerk selbst traegt keine Art (nur Flaeche/Region/Verbund) und wird dafuer NICHT erweitert:
 * `avesmapsGaretienVermerkLesen` hat mit dem alten, nackten Vermerk und drei laufenden Lesern
 * (Ruecknahme, Artikel-Quellen-Nachtrag, diese Funktion) schon genug Formate zu tragen, und die
 * Art steht bereits verlaesslich in der Datenbank -- ein zweiter Ablageort waere die zweite
 * Wahrheit, vor der AGENTS.md §5 warnt. Zwei gleichnamige Verbuende verschiedener Art aus ZWEI
 * Laeufen (derselbe Stamm, z.B. "Silker Hain" einmal als Wald, einmal als Huegelland) duerfen sich
 * sonst dieselbe Region teilen -- die eine Haelfte bekaeme die Art der anderen. Der Kommentar am
 * Aufrufer behauptete bis zu diesem Fix, `avesmapsGaretienVerbuende` (garetien-verbund.php) habe
 * Ebene und Typ schon VOR der Gruppierung geprueft -- das stimmt nur INNERHALB eines einzelnen
 * Laufs (dort gruppiert `$schluessel = ebene|typ|stamm`); die laufuebergreifende Suche hier kennt
 * diese Gruppierung nicht und braucht deshalb ihre eigene Art-Pruefung.
 *
 * ⚠️ Von mehreren TRAGENDEN Treffern gilt die JUENGSTE (`ORDER BY i.id DESC`) -- dieselbe Regel,
 * aus demselben Grund wie bei der Ruecknahme ("Von mehreren gilt die JUENGSTE"). Weder ASC noch
 * DESC allein loesen Befund D/E; das tut erst die Existenz- und Art-Pruefung je Kandidat.
 *
 * ⚠️ Gefragt wird `sync_plan_item`, nicht ein zweiter Merker: die Uebernahme laeuft gestueckelt
 * (`$budget`), und ein Nachzuegler im naechsten Haeppchen muss den Anfuehrer wiederfinden.
 *
 * ⚠️ KEIN zweiter Index, keine zweite Abfrage fuer die LAUFZEIT der `LIKE`-Suche selbst -- das ist
 * gemessen und angenommen (hoechstens 115 Aufrufe je Vollimport). Die zusaetzliche Pruefung hier
 * ist ein `public_id`-Nachschlag ueber `uq_ecosystem_region_public_id` (bereits indiziert) je
 * Kandidat, gedeckelt auf `AVESMAPS_GARETIEN_VERBUND_KANDIDATEN_DECKEL` -- keine offene Schleife.
 *
 * @param string $kind Die Art-Familie, die DIESES Fragment anlegen wuerde ($nach['kind']).
 * @param string $regionType Der Art-Schluessel, den DIESES Fragment anlegen wuerde ($nach['subtyp']).
 */
function avesmapsGaretienVerbundRegion(PDO $pdo, string $verbund, string $kind, string $regionType): ?string
{
    // 💣 EIN VERBUND-STAMM IST FREIER TEXT, KEIN SQL-MUSTER -- ein "%" oder "_" darin (ein
    // Wiki-Artikelname kann beides tragen) waere sonst ein LIKE-Metazeichen, das den Anfuehrer
    // einer VOELLIG ANDEREN Gruppe trifft ("A_wald" faende ohne Maskierung "AXwald").
    // Dieselbe Maskierung wie avesmapsSearchSourceCatalog (api/_internal/app/feature-sources.php).
    $maskiert = str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $verbund);
    $stmt = $pdo->prepare(
        "SELECT i.apply_note FROM sync_plan_item i"
        . " JOIN sync_plan_run r ON r.id = i.run_id"
        . " WHERE r.kind = :k AND i.apply_state = 'done' AND i.apply_note LIKE :muster ESCAPE '\\\\'"
        . " ORDER BY i.id DESC LIMIT " . AVESMAPS_GARETIEN_VERBUND_KANDIDATEN_DECKEL
    );
    $stmt->execute([':k' => AVESMAPS_GARETIEN_PLAN_KIND, ':muster' => '%verbund:' . $maskiert]);
    $notizen = $stmt->fetchAll(PDO::FETCH_COLUMN);
    if ($notizen === false || $notizen === []) {
        return null;
    }

    $regionStmt = $pdo->prepare(
        'SELECT is_active, kind, region_type FROM ecosystem_region WHERE public_id = :p LIMIT 1'
    );
    $schonGeprueft = [];
    foreach ($notizen as $note) {
        $region = avesmapsGaretienVermerkLesen((string) $note)['region'];
        if ($region === '' || isset($schonGeprueft[$region])) {
            continue;
        }
        $schonGeprueft[$region] = true;

        $regionStmt->execute([':p' => $region]);
        $zeile = $regionStmt->fetch(PDO::FETCH_ASSOC);
        if ($zeile === false || (int) $zeile['is_active'] !== 1) {
            continue;   // Befund D: nicht (mehr) da -- geloescht oder nie angelegt.
        }
        if ((string) $zeile['kind'] !== $kind || (string) ($zeile['region_type'] ?? '') !== $regionType) {
            continue;   // Befund E: gleicher Stamm, andere Art -- kein Anfuehrer fuer DIESES Fragment.
        }
        // 🔴 EIN TEIL HAENGT SICH NIE AN EINE REGION OHNE AKTIVE FLAECHE (Entwurf 14.09.2026, §6.6).
        // Eine aktive, aber leere Region ist ein Rest -- ein abgebrochenes Aufraeumen oder ein
        // Handgriff an der Datenbank. Wer sich daran haengt, macht aus dem Rest einen Verbund, den
        // niemand gezeichnet hat; ohne Treffer wird dieses Fragment selbst Anfuehrer.
        if (avesmapsGaretienRegionAktiveFlaechen($pdo, $region) === 0) {
            continue;   // leer: kein Anfuehrer fuer DIESES Fragment.
        }

        return $region;
    }

    return null;
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
 * @param ?string $anRegionPublicId Nur bei einem VERBUND-Fragment gesetzt: die Region des schon
 *     angelegten Anfuehrers. Ist sie gesetzt, legt diese Funktion NUR eine weitere Flaeche an --
 *     Label und Region gehoeren dem Anfuehrer, siehe die Begruendung im Funktionsrumpf.
 * @return array{public_id:string, entity_type:string, label_public_id:string, area_public_id:string}
 */
function avesmapsGaretienFlaecheAnlegen(
    PDO $pdo,
    array $nach,
    array $user,
    int $userId,
    ?array $einstellungen = null,
    ?string $anRegionPublicId = null
): array {
    $ring = $nach['geometry']['coordinates'][0] ?? [];

    // 🔴 EIN TEIL EINES VERBUNDS LEGT NUR SEINE FLAECHE AN. Label und Region gehoeren dem
    // Anfuehrer; ein zweites Label waere ein zweiter Anker derselben Kaskade, und die Karte
    // zeigte den Namen doppelt.
    if ($anRegionPublicId !== null && $anRegionPublicId !== '') {
        $flaeche = avesmapsCreateEcosystemArea($pdo, [
            'region_public_id' => $anRegionPublicId,
            'geometry' => $nach['geometry'],
        ], $userId);

        return [
            'public_id' => $anRegionPublicId,
            'entity_type' => 'region',
            'label_public_id' => '',
            'area_public_id' => avesmapsGaretienPublicIdAus($flaeche, 'Die Flaeche des Verbunds'),
        ];
    }

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
    // 🔴 UND DER IMPORT WEIST DEN WIKI-ARTIKEL ZU (Owner-Entscheid 30.08.2026, siehe
    // avesmapsGaretienWikiLandschaftZuweisung): passt der Name (mit oder ohne passende Art) auf
    // GENAU eine Wiki-Landschaft, traegt die Landschaft sie sofort. Name und Art bleiben die des
    // Imports. Ohne sichere Zuordnung bleibt es schlicht leer (kein erfundener Schluessel).
    //
    // 💣 DAS LABEL WIRD OHNE NEST ANGELEGT, und das ist der Kern des Umbaus vom 15.09.2026 (Owner:
    // „dass der garetien importer fläche und label mit dem selben wiki eintrag versorgt, eine
    // inkonsistenz darf es hier nicht geben"). Bis dahin baute diese Stelle das Nest der Beschriftung
    // aus dem Staging und reichte die Adresse GETRENNT an die Region -- zwei Ableitungen desselben
    // Werts (Schluessel aus dem Seitentitel gegen Schluessel aus der Adresse), und `create_region` zog
    // das Label nicht nach. Jetzt gibt es EINE Quelle: die Adresse geht an die Region, und
    // avesmapsCreateEcosystemRegion gleicht die frisch gebundene Beschriftung aus der Region an
    // (api/_internal/app/landschaft-wiki.php). Der Schluessel des Nests IST danach der der Region.
    // ⚠️ Der Berggipfel weiter unten bleibt eine FREIE Beschriftung und traegt sein Nest selbst.
    $wikiZuweisung = avesmapsGaretienWikiLandschaftZuweisung($pdo, (string) $nach['name'], (string) $nach['subtyp']);
    $label = avesmapsCreateLabelFeature($pdo, array_merge(
        ['text' => (string) $nach['name'], 'feature_subtype' => (string) $nach['subtyp'], 'lng' => $lx, 'lat' => $ly],
        avesmapsGaretienLabelUebersteuerung($einstellungen, avesmapsGaretienLabelVorgabeFuerArt($pdo, (string) $nach['subtyp']))
    ), $user);
    $labelId = avesmapsGaretienPublicIdAus($label, 'Das Label der Flaeche');

    // 2. Region und Flaeche, ueber die Hausfunktionen der Landschaften-Ebene.
    // ⚠️ `auto_name` ausdruecklich false: der Name kommt aus Volkers Daten, nicht aus dem
    // Zeichengriff. Ohne das leitete der Dialog spaeter "automatisch benannt" ab und sperrte das
    // Namensfeld -- derselbe Merker, den auch der Zeichner mitschickt.
    // 🔴 „für Klicks gesperrt" / „Kurvenbeschreibung" (Owner 30.08.2026) -- avesmapsGaretienRegion
    // Uebersteuerung liefert nur, was der Kasten ausdruecklich setzt; ohne Handeingabe ein leeres
    // Array, unveraendert gegenueber dem bisherigen Verhalten.
    // 🔴 DER WIKI-ARTIKEL GEHOERT AN DIE REGION, UND NUR DORTHIN (Entwurf 14.09.2026, §6.6; seit dem
    // 15.09.2026 die EINZIGE Quelle, docs/superpowers/specs/2026-09-15-landschaft-wiki-eine-quelle-design.md).
    // Die Region traegt bei einem Verbund N Flaechen, an ihr haengen Kanon und Statuskreis, und
    // avesmapsCreateEcosystemRegion gibt ihn der eben angelegten Beschriftung weiter.
    // 💣 GEREICHT WIRD DIE ADRESSE, NIE EIN SCHLUESSEL: avesmapsCreateEcosystemRegion leitet
    // `wiki_region_key` selbst aus `wiki_url` ab (avesmapsEcosystemReadRegionFields), ueber die feste
    // Faltungstafel. Ein hier gebauter Schluessel waere die zweite Faltung (AGENTS.md §5).
    // ⚠️ Ohne Treffer bleibt das Feld WEG -- und die Beschriftung damit ebenfalls ohne Artikel.
    $wikiAdresse = trim((string) ($wikiZuweisung['wiki_url'] ?? ''));
    // 💣 SCHRITT 2 UND 3 SIND ZWEI TRANSAKTIONEN, NICHT EINE (Entwurf 14.09.2026, Fehler 7). Jede
    // Hausfunktion rollt nur SICH zurueck. Scheiterte die Flaeche, standen Beschriftung und eine
    // LEERE Region als Waise da -- an keinem `done`-Vermerk, also von keiner Ruecknahme erreichbar,
    // und der naechste Teil des Verbunds legte eine zweite Region desselben Namens an.
    // 🔴 Deshalb raeumt der Anfuehrer selbst auf, ueber DIESELBEN Hausfunktionen, die jede Ruecknahme
    // benutzt, und wirft den Fehler weiter: das Item bleibt `failed`, der Grund bleibt der echte.
    $regionId = '';
    try {
        $region = avesmapsCreateEcosystemRegion($pdo, array_merge([
            'name' => (string) $nach['name'],
            'auto_name' => false,
            'kind' => (string) $nach['kind'],
            'region_type' => (string) $nach['subtyp'],
            'label_public_id' => $labelId,
        ], $wikiAdresse !== '' ? ['wiki_url' => $wikiAdresse] : [], avesmapsGaretienRegionUebersteuerung($einstellungen)), $userId);
        $regionId = avesmapsGaretienPublicIdAus($region, 'Die Region');
        $flaeche = avesmapsCreateEcosystemArea($pdo, [
            'region_public_id' => $regionId,
            'geometry' => $nach['geometry'],
        ], $userId);
        $flaecheId = avesmapsGaretienPublicIdAus($flaeche, 'Die Flaeche');
    } catch (Throwable $abbruch) {
        avesmapsGaretienFlaecheAufraeumen($pdo, $user, $userId, $labelId, $regionId, $abbruch);
    }

    return [
        'public_id' => $regionId,
        'entity_type' => 'region',
        'label_public_id' => $labelId,
        'area_public_id' => $flaecheId,
    ];
}

/**
 * Was ein gescheiterter Anfuehrer schon angelegt hat, wieder wegnehmen -- und dann den Fehler werfen.
 *
 * 🔴 DIE HAUSFUNKTIONEN, KEIN EIGENES UPDATE. avesmapsDeleteEcosystemRegion nimmt die Region samt
 * ihren Beschriftungen in EINER Transaktion mit (dieselbe, die die Ruecknahme einer Einzelflaeche
 * nimmt); die Beschriftung allein -- Schritt 2 scheiterte, es gibt keine Region -- geht ueber
 * avesmapsDeleteMapFeature. Beide schreiben ihr Protokoll, beide heben die Revision.
 * ⚠️ Die Beschriftung wird NUR geloescht, wenn sie danach noch aktiv ist: die Regionsloeschung nimmt
 * sie ueber die Kaskade schon mit (AVESMAPS_ECOSYSTEM_CASCADE_ENABLED), und ein zweiter Loeschversuch
 * auf eine inaktive Zeile waere ein Fehler, der den echten Grund ueberdeckt.
 * 💣 KEINE OFFENE TRANSAKTION: jede der zwei Hausfunktionen oeffnet ihre eigene, und die gescheiterte
 * Anlage hat ihre bereits zurueckgerollt. Das Ensure-DDL darin laeuft deshalb ausserhalb jeder
 * Transaktion -- auf MySQL committete es eine offene sonst implizit (AGENTS.md §11, Quellen-Umbau).
 * 💣 Scheitert das Aufraeumen selbst, bleibt der ERSTE Fehler der Grund, und das Aufraeumen steht
 * dahinter -- ein Editor muss erfahren, dass eine Waise geblieben ist.
 */
function avesmapsGaretienFlaecheAufraeumen(PDO $pdo, array $user, int $userId, string $labelId, string $regionId, Throwable $abbruch): never
{
    $aufraeumFehler = [];
    if ($regionId !== '') {
        try {
            avesmapsDeleteEcosystemRegion($pdo, ['public_id' => $regionId], $userId);
        } catch (Throwable $fehler) {
            $aufraeumFehler[] = 'Region ' . $regionId . ': ' . $fehler->getMessage();
        }
    }
    if ($labelId !== '') {
        $aktiv = $pdo->prepare('SELECT is_active FROM map_features WHERE public_id = :p LIMIT 1');
        $aktiv->execute([':p' => $labelId]);
        if ((int) $aktiv->fetchColumn() === 1) {
            try {
                avesmapsDeleteMapFeature($pdo, ['public_id' => $labelId], $user);
            } catch (Throwable $fehler) {
                $aufraeumFehler[] = 'Beschriftung ' . $labelId . ': ' . $fehler->getMessage();
            }
        }
    }
    if ($aufraeumFehler === []) {
        throw $abbruch;
    }

    throw new RuntimeException(
        $abbruch->getMessage() . ' -- Aufraeumen unvollstaendig: ' . implode('; ', $aufraeumFehler),
        0,
        $abbruch
    );
}

// ---- „Quelle und Namen ergaenzen" (Owner 15.09.2026) ---------------------------------------------
//
// Owner, woertlich: „wenn ich "Quelle an „Wald-190" ergänzen" mach - ersetzt es dann auch den namen?
// … wenn nicht, kannst du - sofern solche fälle auftreten - die Option "Quelle und Namen ergänzen"
// machen?" Auf Rueckfrage zwei Entscheide: die Option erscheint NUR bei PLATZHALTERNAMEN, und ↩ nimmt
// Quelle UND Namen zurueck.
//
// 🔴 AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT BLEIBT AUS, UND DAS HIER IST KEINE AUFWEICHUNG. „es gibt neu
// oder nix - kein verändern, kein ersetzen" (31.08.2026) galt einem ECHTEN Namen: der Abgleich hatte
// unser Dorf „Valpolust" in „Gryffenwacht" umbenannt. Einen Griff wie „Wald-190" oder „Pfad-5372" hat
// niemand vergeben -- er ist Buchfuehrung der Anlage, die keinem Leser gezeigt wird
// (ecosystemRegionLeserName). Die Ausnahme ist deshalb ENG und dreifach verriegelt: `felder` ist genau
// ['quelle'], der Rumpf des Items traegt `name_ergaenzen: true`, und der SERVER prueft den AKTUELLEN
// Namen frisch gegen die Griff-Regel. Der Browser entscheidet nur, ob er die Wahl ANBIETET.
//
// ⚠️ EIN LEERER NAME IST KEIN PLATZHALTER. Das Luecken-Item fuellte ihn frueher, und genau das hat der
// Owner abgeschaltet („DER NAME BLEIBT DRAUSSEN, AUCH WENN UNSERER LEER IST", Kopf von
// AVESMAPS_GARETIEN_ERGAENZUNG_FELDER in garetien-plan.php). Zuruecknehmen liesse er sich ohnehin
// nicht: avesmapsReadFeatureName wirft auf einen leeren Namen.

/** Die Ziele, die einen Platzhalternamen tragen koennen -- Orte und Berggipfel haben keinen Griff. */
const AVESMAPS_GARETIEN_NAME_ERGAENZEN_ZIELE = ['path', 'region'];

/** Die Art des Vermerks in `apply_note` -- das Merkmal gegen das nackte public_id-Echo einer Ergaenzung. */
const AVESMAPS_GARETIEN_NAME_VERMERK_ART = 'name_ergaenzt';

/**
 * 💣 `sync_plan_item.apply_note` ist VARCHAR(300), und avesmapsSyncPlanMarkItem kappt still per
 * mb_substr. Ein gekappter JSON-Vermerk ist unlesbar -- und ohne Vermerk gibt ↩ den Namen nicht mehr
 * zurueck. Deshalb wird VOR dem ersten Schreibvorgang gemessen, nie danach.
 */
const AVESMAPS_GARETIEN_VERMERK_MAX_ZEICHEN = 300;

/**
 * 🔴 Der laengste Name, den ALLE beteiligten Hausschreiber unveraendert speichern: Weg und
 * Beschriftung kappen bei 160 (avesmapsReadFeatureName, avesmapsReadLabelText), die Landschaft erst
 * bei 190. Ein laengerer Name kaeme gekappt an -- das Ruecklesen schluege an, aber erst NACH dem
 * Schreiben. Also wird vorher abgewiesen.
 */
const AVESMAPS_GARETIEN_NAME_MAX_ZEICHEN = 160;

/**
 * REIN: ist dieser Name ein PLATZHALTER -- ein maschinell vergebener Griff statt eines Namens?
 *
 * 🔴 ZWEI BESTEHENDE REGELN, KEINE DRITTE.
 *   Weg:        avesmapsWikiPathNameIsGeneric (api/_internal/wiki/path-naming.php) -- dieselbe Antwort,
 *               die Kartensuche, Konfliktzentrum und Wiki-Abgleich geben („Pfad-5372", „Flussweg").
 *   Landschaft: avesmapsLandscapeSearchAutoNamePattern (api/_internal/app/landscape-search.php) --
 *               `<Artbezeichnung>-<Ziffern>` gegen JEDE Art des Katalogs, auch stillgelegte, plus den
 *               Rueckfall-Griff „Fläche".
 *
 * ⚠️ WARUM DIE LANDSCHAFTS-REGEL DER SUCHE UND NICHT DIE DES BROWSERS (ecosystemRegionNameIsGriff). Der
 * Browser kennt nur die JETZIGE Art der Zeile, weil er keinen Artenkatalog hat -- und ein Griff
 * ueberlebt jeden Artwechsel („Wald-190" an einer inzwischen als Urwald gefuehrten Region, 12 solche
 * am 14.09.2026 gemessen). Der Server hat den Katalog. Beide Regeln verlangen dieselbe Form
 * `^<Griff>-<Ziffern>$`; ein Name, den ein Mensch getippt hat („Wald der Wälder-2"), faellt bei beiden
 * heraus. Sicher ist sie, weil ein Treffer an ein ARTWORT gebunden ist -- kein Mensch nennt einen Wald
 * „Sümpfe und Moore-12".
 * 💣 NICHT avesmapsLandscapeSearchNameIsMachineGiven: die zaehlt einen gesetzten Auto-Name-Merker und
 * einen LEEREN Namen als maschinell -- fuer „verbergen" die sichere Richtung, fuer „ueberschreiben" die
 * gefaehrliche. Hier entscheidet NUR die Form des Namens.
 * ⚠️ Leer ist KEIN Platzhalter (Kopf dieses Abschnitts), und jedes andere Ziel auch nicht.
 *
 * @param list<string> $artBezeichnungen ecosystem_region_type.label (avesmapsGaretienArtBezeichnungen)
 */
function avesmapsGaretienNameIstPlatzhalter(string $ziel, string $name, array $artBezeichnungen = []): bool
{
    $name = trim($name);
    if ($name === '') {
        return false;
    }
    if ($ziel === 'path') {
        return avesmapsWikiPathNameIsGeneric($name);
    }
    if ($ziel === 'region') {
        // ⚠️ `=== 1`: ein Regex-Fehler (preg_match liefert false) ist KEIN Platzhalter.
        return preg_match(avesmapsLandscapeSearchAutoNamePattern($artBezeichnungen), $name) === 1;
    }

    return false;
}

/**
 * Die Artbezeichnungen des Landschaftskatalogs -- ALLE, auch stillgelegte (derselbe Grund wie in
 * avesmapsFetchLandscapeSearchRows: ein alter Griff bleibt ein Griff).
 *
 * ⚠️ FAELLT ENG AUS: ohne lesbaren Katalog bleibt nur der Rueckfall-Griff „Fläche", die Regel erkennt
 * WENIGER Platzhalter. Fuer eine Frage, deren Ja einen Namen ueberschreibt, ist das die sichere Richtung.
 * ⚠️ KEIN DDL -- die Liste ruft das bei jedem Filterklick (AGENTS.md §10).
 *
 * @return list<string>
 */
function avesmapsGaretienArtBezeichnungen(PDO $pdo): array
{
    try {
        $stmt = $pdo->query('SELECT label FROM ecosystem_region_type');
        $zeilen = $stmt !== false ? $stmt->fetchAll(PDO::FETCH_COLUMN) : [];
    } catch (Throwable) {
        return [];
    }
    $raus = [];
    foreach ($zeilen as $label) {
        $label = trim((string) $label);
        if ($label !== '' && !in_array($label, $raus, true)) {
            $raus[] = $label;
        }
    }

    return $raus;
}

/**
 * REIN: will der Rumpf dieses Items den Namen mitergaenzen?
 * 🔴 Nur ein echtes `true` -- "true" oder 1 kommen nicht aus der Zielwahl (dieselbe Regel wie beim
 * Riegel `beides`, avesmapsGaretienBeidesRiegel).
 */
function avesmapsGaretienNameErgaenzenGewuenscht(?array $einstellungen): bool
{
    return is_array($einstellungen) && ($einstellungen['name_ergaenzen'] ?? null) === true;
}

/**
 * REIN: der Fingerabdruck eines geschriebenen Namens, fuer den Vermerk.
 *
 * ⚠️ EIN FINGERABDRUCK, NICHT DER NAME: der neue Name darf 160 Zeichen lang sein, der Vermerk hat 300
 * (AVESMAPS_GARETIEN_VERMERK_MAX_ZEICHEN). Gebraucht wird nur die Frage „heisst das Objekt noch so, wie
 * der Import es genannt hat?" -- zurueckgeschrieben wird der ALTE Name, und der steht voll im Vermerk.
 */
function avesmapsGaretienNameFingerabdruck(string $name): string
{
    return substr(sha1($name), 0, 16);
}

/**
 * REIN: der Vermerk einer Namens-Ergaenzung, als Zeichenkette fuer `apply_note`.
 *
 * 🔴 JSON, UND ER BEGINNT MIT „{". Die uebrigen Leser von `apply_note` lesen dadurch nichts Falsches:
 * avesmapsGaretienVermerkLesen findet keines seiner Felder (area/region/verbund) am Stueckanfang, der
 * `nur_quelle:`-LIKE und der `%verbund:`-LIKE treffen nie, die Staetten-Menge der Liste kennt die
 * Zeichenkette nicht -- und Ruecknahme wie Artikel-Nachzug lesen das ZIEL eines 'changed'-Items aus
 * `entity_public_id`, nie aus diesem Feld.
 * ⚠️ `auto` steht NUR bei der Landschaft, dann auch als `null` („Merker nie angefasst"): ein fehlender
 * Schluessel und `null` sind zwei Aussagen -- avesmapsEcosystemApplyRegionAutoName liest `null` als
 * „zuruecksetzen auf ableiten".
 * 💣 WIRFT, wenn er nicht in die Spalte passt -- und wird deshalb VOR dem ersten Schreiben gebaut.
 *
 * @param list<string> $labels die Beschriftungen, deren Text mitgeschrieben wird
 */
function avesmapsGaretienNameVermerkBauen(string $alt, string $neu, bool $mitAuto, ?bool $auto, array $labels): string
{
    $daten = [
        'art' => AVESMAPS_GARETIEN_NAME_VERMERK_ART,
        'alt' => $alt,
        'neu' => avesmapsGaretienNameFingerabdruck($neu),
    ];
    if ($mitAuto) {
        $daten['auto'] = $auto;
    }
    if ($labels !== []) {
        $daten['labels'] = array_values(array_map('strval', $labels));
    }
    $vermerk = json_encode($daten, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    if (mb_strlen($vermerk, 'UTF-8') > AVESMAPS_GARETIEN_VERMERK_MAX_ZEICHEN) {
        throw new RuntimeException(
            'Der Vermerk fuer "' . $alt . '" passt nicht in ' . AVESMAPS_GARETIEN_VERMERK_MAX_ZEICHEN
            . ' Zeichen (' . count($labels) . ' Beschriftungen) -- ohne ihn liesse sich der Name nicht'
            . ' zuruecknehmen. Geschrieben wurde nichts.'
        );
    }

    return $vermerk;
}

/**
 * REIN: den Vermerk wieder lesen -- `null`, wenn `apply_note` gar kein Namens-Vermerk ist (das nackte
 * public_id-Echo einer reinen Quellen-Ergaenzung).
 *
 * 💣 EIN KAPUTTER VERMERK WIRFT, statt `null` zu sagen. `null` hiesse fuer die Ruecknahme „kein Name
 * zurueckzugeben" -- sie loeste die Quelle und liesse den importierten Namen stehen. Was mit „{"
 * beginnt, ist ein Namens-Vermerk oder ein Fehler, und eine halbe Ruecknahme ist schlimmer als keine.
 *
 * @return ?array{alt:string, neu:string, labels:list<string>, auto?:?bool}
 */
function avesmapsGaretienNameVermerkLesen(string $note): ?array
{
    $n = trim($note);
    if (!avesmapsGaretienTraegtNameVermerk($n)) {
        return null;
    }
    $unlesbar = new RuntimeException('Der Namens-Vermerk dieses Items ist unlesbar -- zurueckgenommen wurde nichts.');
    $daten = json_decode($n, true);
    if (!is_array($daten) || ($daten['art'] ?? null) !== AVESMAPS_GARETIEN_NAME_VERMERK_ART) {
        throw $unlesbar;
    }
    $alt = $daten['alt'] ?? null;
    $neu = $daten['neu'] ?? null;
    $labels = $daten['labels'] ?? [];
    if (!is_string($alt) || trim($alt) === '' || !is_string($neu) || $neu === '' || !is_array($labels)) {
        throw $unlesbar;
    }
    $raus = ['alt' => $alt, 'neu' => $neu, 'labels' => []];
    foreach ($labels as $label) {
        if (!is_string($label) || trim($label) === '') {
            throw $unlesbar;
        }
        $raus['labels'][] = $label;
    }
    if (array_key_exists('auto', $daten)) {
        if ($daten['auto'] !== null && !is_bool($daten['auto'])) {
            throw $unlesbar;
        }
        $raus['auto'] = $daten['auto'];
    }

    return $raus;
}

/**
 * REIN: traegt dieser `apply_note` einen Namens-Vermerk? Ohne zu werfen -- fuer die Liste, die dem
 * Browser sagt, dass ↩ an diesem Item auch einen Namen zurueckgibt (die Rueckfrage nennt es).
 */
function avesmapsGaretienTraegtNameVermerk(string $note): bool
{
    return str_starts_with(ltrim($note), '{');
}

/**
 * Der VOLLE Rumpf fuer avesmapsUpdatePathFeatureDetails -- jedes Feld mit seinem gespeicherten Wert.
 *
 * 💣 DIESER HAUSSCHREIBER IST KEIN TEIL-UPDATE (siehe avesmapsGaretienErgaenzungAnwenden): was im Rumpf
 * fehlt, schreibt er mit seiner Vorgabe.
 * 🔴 UND `is_bach` FEHLTE BIS ZUM 15.09.2026. Der Namenszweig der Ergaenzung schickte es nicht mit, und
 * avesmapsUpdatePathFeatureDetails ENTFERNT den Merker, sobald das Feld fehlt
 * (`$payload['is_bach'] ?? false`) -- ein umbenannter Bach waere lautlos ein Fluss geworden, samt anderer
 * Verkehrsmittel (avesmapsPathTransportRegel). Am SQLite-Pruefstand nachgemessen, bevor diese Zeile kam.
 * 🔴 EIN BAUER FUER ALLE DREI AUFRUFER (Ersetzen, Name ergaenzen, Name zuruecknehmen) -- der naechste
 * fehlende Schluessel fehlt sonst an einem von dreien.
 */
function avesmapsGaretienWegDetailsRumpf(string $publicId, array $zeile, string $name): array
{
    $props = json_decode((string) ($zeile['properties_json'] ?? '{}'), true);
    $props = is_array($props) ? $props : [];

    return [
        'public_id' => $publicId,
        'name' => $name,
        'feature_subtype' => (string) ($zeile['feature_subtype'] ?? 'Flussweg'),
        'show_label' => (bool) ($props['show_label'] ?? false),
        'is_bach' => (bool) ($props['is_bach'] ?? false),
        'allowed_transports' => $props['allowed_transports'] ?? null,
        'transport_seasons' => $props['transport_seasons'] ?? null,
        'other_source' => $props['other_source'] ?? null,
    ];
}

/**
 * Die Zeile, deren Namen „Quelle und Namen ergaenzen" anfasst -- FRISCH gelesen; `null`, wenn es sie
 * nicht (mehr) aktiv gibt.
 *
 * 💣 NIE aus `after.abschnitt.name`: der Plan ist ein Stichtag, und zwischen „Holen & Rechnen" und
 * „Stage importieren" kann jemand „Wald-190" von Hand benannt haben. Genau DIESEN Namen darf der Import
 * nicht ueberschreiben (Owner 31.08.2026).
 */
function avesmapsGaretienNameZeileLesen(PDO $pdo, string $ziel, string $publicId): ?array
{
    if ($ziel === 'path') {
        $stmt = $pdo->prepare(
            'SELECT name, feature_subtype, properties_json FROM map_features'
            . " WHERE public_id = :p AND feature_type = 'path' AND is_active = 1"
        );
    } elseif ($ziel === 'region') {
        $stmt = $pdo->prepare(
            'SELECT name, properties_json, label_public_id FROM ecosystem_region WHERE public_id = :p AND is_active = 1'
        );
    } else {
        return null;
    }
    $stmt->execute(['p' => $publicId]);
    $zeile = $stmt->fetch(PDO::FETCH_ASSOC);

    return is_array($zeile) ? $zeile : null;
}

/**
 * Eine aktive Beschriftung samt ihrem TEXT -- dieselbe Lesart wie avesmapsUpdateLabelFeature
 * (`properties.text`, sonst die Namensspalte). `null`, wenn es sie nicht (mehr) gibt.
 */
function avesmapsGaretienLabelZeileLesen(PDO $pdo, string $publicId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT name, feature_subtype, properties_json FROM map_features'
        . " WHERE public_id = :p AND feature_type = 'label' AND is_active = 1"
    );
    $stmt->execute(['p' => $publicId]);
    $zeile = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($zeile)) {
        return null;
    }
    $props = json_decode((string) ($zeile['properties_json'] ?? ''), true);
    $text = is_array($props) && is_string($props['text'] ?? null) ? $props['text'] : (string) ($zeile['name'] ?? '');
    $zeile['text'] = $text;

    return $zeile;
}

/**
 * Die Namens-Ergaenzung PRUEFEN und vorbereiten -- ohne einen einzigen Schreibvorgang.
 *
 * 🔴 ALLES, WAS VORHERSEHBAR SCHEITERT, SCHEITERT HIER: das Ziel ist kein Weg und keine Landschaft, der
 * Name fehlt oder ist zu lang, das Objekt ist weg, sein Name ist kein Platzhalter (mehr), der Weg traegt
 * einen Wiki-Artikel, dessen Name jeden getippten schlaegt (avesmapsWikiPathEffectiveEditName), oder der
 * Vermerk passt nicht in die Spalte. Was danach beim Schreiben noch scheitert, gibt
 * avesmapsGaretienNameErgaenzenAufraeumen zurueck.
 * 🔴 DIE BESCHRIFTUNGEN EINER LANDSCHAFT WERDEN HIER AUSGEWAEHLT -- nur die, deren Text GLEICH dem alten
 * Namen ist. Ein Schild mit eigenem Text („Alter Forst") hat jemand beschriftet; der Flaechendialog im
 * Browser zoege es mit (applyRegionToLabels), der Import nicht (Owner 31.08.2026: kein Ersetzen).
 * Gesucht wird ueber avesmapsEcosystemRegionLabelPublicIds -- beide Bindungsrichtungen, derselbe Leser
 * wie beim Durchtrag der Wiki-Landschaft.
 *
 * @return ?array null = nichts zu schreiben (unser Objekt heisst schon so)
 */
function avesmapsGaretienNameErgaenzenVorbereiten(PDO $pdo, array $nach, string $publicId): ?array
{
    $ziel = (string) ($nach['ziel'] ?? '');
    if (!in_array($ziel, AVESMAPS_GARETIEN_NAME_ERGAENZEN_ZIELE, true)) {
        throw new RuntimeException(
            '"Quelle und Namen ergaenzen" gibt es nur an Wegen und Landschaften, nicht am Ziel "' . $ziel
            . '" -- geschrieben wurde nichts.'
        );
    }
    // `$nach['name']` hat avesmapsGaretienNameUebersteuern aus dem Rumpf des Items gelegt -- DERSELBE
    // eine Ort, an dem jeder Anleger dieses Moduls seinen Namen liest.
    $neu = avesmapsNormalizeSingleLine((string) ($nach['name'] ?? ''), 190);
    if ($neu === '') {
        throw new RuntimeException('"Quelle und Namen ergaenzen" ohne Namen -- geschrieben wurde nichts.');
    }
    if (avesmapsNormalizeSingleLine($neu, AVESMAPS_GARETIEN_NAME_MAX_ZEICHEN) !== $neu) {
        throw new RuntimeException(
            'Der Name ist laenger als ' . AVESMAPS_GARETIEN_NAME_MAX_ZEICHEN . ' Zeichen und kaeme gekappt an'
            . ' -- geschrieben wurde nichts.'
        );
    }
    $zeile = avesmapsGaretienNameZeileLesen($pdo, $ziel, $publicId);
    if ($zeile === null) {
        throw new RuntimeException('Das Objekt ' . $publicId . ' existiert nicht mehr -- geschrieben wurde nichts.');
    }
    $alt = trim((string) ($zeile['name'] ?? ''));
    $arten = $ziel === 'region' ? avesmapsGaretienArtBezeichnungen($pdo) : [];
    if (!avesmapsGaretienNameIstPlatzhalter($ziel, $alt, $arten)) {
        throw new RuntimeException(
            ($alt === '' ? 'Das Objekt hat gar keinen Namen' : '"' . $alt . '" traegt inzwischen einen eigenen Namen')
            . ' -- kein Platzhalter, also wird kein Name ergaenzt. Geschrieben wurde nichts, auch die Quelle'
            . ' nicht; "Quelle ergaenzen" traegt sie allein nach.'
        );
    }
    if ($neu === $alt) {
        return null;
    }
    if ($ziel === 'path') {
        $props = json_decode((string) ($zeile['properties_json'] ?? ''), true);
        $wirksam = avesmapsWikiPathEffectiveEditName($neu, is_array($props) ? $props : []);
        if ($wirksam !== $neu) {
            throw new RuntimeException(
                'Der Weg ' . $publicId . ' traegt einen zugewiesenen Wiki-Artikel und behielte dessen Namen "'
                . $wirksam . '" -- geschrieben wurde nichts.'
            );
        }

        return [
            'ziel' => 'path', 'public_id' => $publicId, 'alt' => $alt, 'neu' => $neu, 'zeile' => $zeile,
            'labels' => [],
            'vermerk' => avesmapsGaretienNameVermerkBauen($alt, $neu, false, null, []),
        ];
    }

    $labels = [];
    foreach (avesmapsEcosystemRegionLabelPublicIds($pdo, $publicId, $zeile['label_public_id'] ?? null) as $labelId) {
        $label = avesmapsGaretienLabelZeileLesen($pdo, (string) $labelId);
        if ($label !== null && $label['text'] === $alt) {
            $labels[] = (string) $labelId;
        }
    }
    $auto = avesmapsEcosystemRegionAutoName($zeile['properties_json'] ?? null);

    return [
        'ziel' => 'region', 'public_id' => $publicId, 'alt' => $alt, 'neu' => $neu, 'zeile' => $zeile,
        'labels' => $labels,
        'vermerk' => avesmapsGaretienNameVermerkBauen($alt, $neu, true, $auto, $labels),
    ];
}

/**
 * Den Namen schreiben -- ueber die Hausschreiber, mit Ruecklesen, und bei einem Fehlschlag mittendrin
 * zurueck auf den alten Stand.
 *
 * 🔴 KEIN EIGENES UPDATE. Weg ueber avesmapsUpdatePathFeatureDetails (voller Rumpf,
 * avesmapsGaretienWegDetailsRumpf), Landschaft ueber avesmapsUpdateEcosystemRegion mit `auto_name: false`
 * (ab jetzt ein gewaehlter Name -- dieselbe Form wie der Namenszweig des Ersetzens), Beschriftung ueber
 * avesmapsUpdateLabelFeature mit `text` und unveraenderter Art (dort IST es ein Teil-Update).
 * 🔴 DIE BESCHRIFTUNG ZIEHT DER IMPORT SELBST NACH. avesmapsUpdateEcosystemRegion traegt Wiki-Zuweisung
 * und Art an die Labels durch, NIE den Namen -- das Umbenennen macht im Flaechendialog der Browser
 * (applyRegionToLabels). Ohne diese Zeilen hiesse die Landschaft „Alkenwald" und ihr Schild auf der
 * Karte weiter „Wald-190".
 * 🔴 RUECKLESEN, BEVOR ES ALS GESCHRIEBEN GILT (AGENTS.md §10, `app_setting`): ein Hausschreiber kann
 * einen Namen still verwerfen oder kappen.
 * 💣 KEINE GEMEINSAME TRANSAKTION: jeder der Hausschreiber oeffnet seine eigene, und PDO kennt keine
 * verschachtelten. Scheitert ein spaeterer Schritt, gibt avesmapsGaretienNameErgaenzenAufraeumen die
 * frueheren zurueck -- dieselbe Bauform wie avesmapsGaretienFlaecheAufraeumen, und aus demselben Grund:
 * ein halb umbenanntes Objekt ohne Vermerk koennte niemand mehr zuruecknehmen.
 */
function avesmapsGaretienNameErgaenzenSchreiben(PDO $pdo, array $vorhaben, array $user): void
{
    $ziel = (string) $vorhaben['ziel'];
    $publicId = (string) $vorhaben['public_id'];
    $neu = (string) $vorhaben['neu'];
    try {
        if ($ziel === 'path') {
            avesmapsUpdatePathFeatureDetails(
                $pdo, avesmapsGaretienWegDetailsRumpf($publicId, (array) $vorhaben['zeile'], $neu), $user
            );
        } else {
            avesmapsUpdateEcosystemRegion(
                $pdo, ['public_id' => $publicId, 'name' => $neu, 'auto_name' => false], (int) ($user['id'] ?? 0)
            );
        }
        $ist = (string) ((avesmapsGaretienNameZeileLesen($pdo, $ziel, $publicId) ?? [])['name'] ?? '');
        if ($ist !== $neu) {
            throw new RuntimeException(
                'Der Name "' . $neu . '" wurde nicht uebernommen -- das Objekt ' . $publicId . ' heisst "' . $ist . '".'
            );
        }
        foreach ((array) ($vorhaben['labels'] ?? []) as $labelId) {
            $label = avesmapsGaretienLabelZeileLesen($pdo, (string) $labelId);
            if ($label === null) {
                continue;   // inzwischen geloescht -- es gibt nichts mehr zu beschriften
            }
            avesmapsUpdateLabelFeature($pdo, [
                'public_id' => (string) $labelId,
                'text' => $neu,
                'feature_subtype' => (string) ($label['feature_subtype'] ?? '') ?: 'region',
            ], $user);
            $labelIst = avesmapsGaretienLabelZeileLesen($pdo, (string) $labelId);
            if ($labelIst === null || $labelIst['text'] !== $neu) {
                throw new RuntimeException('Die Beschriftung ' . $labelId . ' hat den Namen "' . $neu . '" nicht uebernommen.');
            }
        }
    } catch (Throwable $abbruch) {
        avesmapsGaretienNameErgaenzenAufraeumen($pdo, $vorhaben, $user, $abbruch);
    }
}

/**
 * Was eine gescheiterte Namens-Ergaenzung schon geschrieben hat, zurueckgeben -- und dann den Fehler
 * werfen. Dieselbe Bauform wie avesmapsGaretienFlaecheAufraeumen.
 *
 * 💣 Scheitert das Zuruecksetzen selbst, bleibt der ERSTE Fehler der Grund, und das Zuruecksetzen steht
 * dahinter -- ein Editor muss erfahren, dass ein Name haengengeblieben ist.
 */
function avesmapsGaretienNameErgaenzenAufraeumen(PDO $pdo, array $vorhaben, array $user, Throwable $abbruch): never
{
    try {
        avesmapsGaretienNameZuruecksetzen(
            $pdo,
            (string) $vorhaben['ziel'],
            (string) $vorhaben['public_id'],
            avesmapsGaretienNameVermerkLesen((string) $vorhaben['vermerk']) ?? [],
            $user
        );
    } catch (Throwable $fehler) {
        throw new RuntimeException(
            $abbruch->getMessage() . ' -- Zuruecksetzen unvollstaendig: ' . $fehler->getMessage(),
            0,
            $abbruch
        );
    }

    throw $abbruch;
}

/**
 * Den Platzhalter zurueckgeben -- an genau den Stellen, die noch so heissen, wie der Import sie genannt hat.
 *
 * 🔴 EINE SPAETERE HANDARBEIT GEHT NIE VERLOREN. Zurueckgeschrieben wird nur, wessen Name (bzw. Text)
 * noch den Fingerabdruck des geschriebenen traegt. Fuer das OBJEKT prueft die Ruecknahme das vorher und
 * weist dann GANZ ab (avesmapsGaretienNameRuecknahmePruefen); eine Beschriftung, die jemand seither
 * eigens beschriftet hat, bleibt still stehen -- die Landschaft bekommt ihren Griff zurueck, das Schild
 * behaelt, was ein Mensch daraufgeschrieben hat.
 * ⚠️ ZWEI AUFRUFER: die Ruecknahme (↩) und das Aufraeumen nach einem Fehlschlag mitten im Schreiben. Fuer
 * den zweiten ist genau diese Gleichheitspruefung der Grund, warum sie ohne eigenen Zustand auskommt: was
 * noch nicht geschrieben war, traegt den Fingerabdruck nicht und bleibt unberuehrt.
 * ⚠️ Der Merker „Auto-Name" geht mit zurueck, auch als `null` („nie angefasst") -- sonst stuende der Haken
 * nach ↩ auf „aus", obwohl die Landschaft wieder „Wald-190" heisst. Die Feldherkunft `name: manual`, die
 * der Hausschreiber stempelt, bleibt: avesmapsFieldOriginsStempeln setzt nur und loescht nie -- dieselbe
 * Lage wie nach jedem Umbenennen von Hand.
 * ⚠️ Erst die Beschriftungen, dann das Objekt: scheitert das Objekt, findet ein zweiter Klick die Schilder
 * schon zurueckgesetzt (Fingerabdruck passt nicht mehr) und versucht nur noch das Objekt.
 *
 * @return array{objekt:bool, labels:int}
 */
function avesmapsGaretienNameZuruecksetzen(PDO $pdo, string $ziel, string $publicId, array $vermerk, array $user): array
{
    $alt = (string) ($vermerk['alt'] ?? '');
    $neu = (string) ($vermerk['neu'] ?? '');
    $raus = ['objekt' => false, 'labels' => 0];
    if ($alt === '' || $neu === '') {
        return $raus;
    }
    foreach ((array) ($vermerk['labels'] ?? []) as $labelId) {
        $label = avesmapsGaretienLabelZeileLesen($pdo, (string) $labelId);
        if ($label === null || avesmapsGaretienNameFingerabdruck((string) $label['text']) !== $neu) {
            continue;
        }
        avesmapsUpdateLabelFeature($pdo, [
            'public_id' => (string) $labelId,
            'text' => $alt,
            'feature_subtype' => (string) ($label['feature_subtype'] ?? '') ?: 'region',
        ], $user);
        $raus['labels']++;
    }
    $zeile = avesmapsGaretienNameZeileLesen($pdo, $ziel, $publicId);
    if ($zeile === null || avesmapsGaretienNameFingerabdruck((string) ($zeile['name'] ?? '')) !== $neu) {
        return $raus;
    }
    if ($ziel === 'path') {
        avesmapsUpdatePathFeatureDetails($pdo, avesmapsGaretienWegDetailsRumpf($publicId, $zeile, $alt), $user);
    } else {
        $rumpf = ['public_id' => $publicId, 'name' => $alt];
        if (array_key_exists('auto', $vermerk)) {
            $rumpf['auto_name'] = $vermerk['auto'];
        }
        avesmapsUpdateEcosystemRegion($pdo, $rumpf, (int) ($user['id'] ?? 0));
    }
    $ist = (string) ((avesmapsGaretienNameZeileLesen($pdo, $ziel, $publicId) ?? [])['name'] ?? '');
    if ($ist !== $alt) {
        throw new RuntimeException(
            'Der Platzhalter "' . $alt . '" liess sich nicht zurueckschreiben -- das Objekt heisst "' . $ist . '".'
        );
    }
    $raus['objekt'] = true;

    return $raus;
}

/**
 * Darf ↩ den Namen zurueckgeben? Wirft, wenn nicht -- und zwar BEVOR die Ruecknahme irgendetwas anfasst.
 *
 * 🔴 HEISST DAS OBJEKT INZWISCHEN ANDERS, BLEIBT ALLES STEHEN, auch die Quelle. Der Kopf der Ruecknahme
 * sagt es: eine halb zurueckgenommene Uebernahme ist schlimmer als gar keine. Ein Name, den jemand nach
 * dem Import vergeben hat, ist Handarbeit -- ihn auf „Wald-190" zurueckzudrehen waere genau das
 * Ueberschreiben, das der Owner am 31.08.2026 abgeschaltet hat. Die Quelle laesst sich dann im
 * Quellenkasten loesen.
 * 💣 Und ein Weg, dem seither ein Wiki-Artikel zugewiesen wurde, nimmt den Platzhalter gar nicht mehr an
 * (avesmapsWikiPathEffectiveEditName) -- auch das wird VORHER gefragt, nicht erst am Ruecklesen.
 */
function avesmapsGaretienNameRuecknahmePruefen(PDO $pdo, string $ziel, string $publicId, array $vermerk): void
{
    $zeile = avesmapsGaretienNameZeileLesen($pdo, $ziel, $publicId);
    if ($zeile === null) {
        throw new RuntimeException(
            'Das Objekt ' . $publicId . ' existiert nicht mehr -- sein Name laesst sich nicht zurueckgeben,'
            . ' zurueckgenommen wurde nichts.'
        );
    }
    $ist = (string) ($zeile['name'] ?? '');
    if (avesmapsGaretienNameFingerabdruck($ist) !== (string) ($vermerk['neu'] ?? '')) {
        throw new RuntimeException(
            '"' . $ist . '" heisst inzwischen anders, als der Import es benannt hat -- der Name bleibt, und'
            . ' zurueckgenommen wurde nichts, auch die Quelle nicht. Sie laesst sich im Quellenkasten loesen.'
        );
    }
    if ($ziel === 'path') {
        $alt = (string) ($vermerk['alt'] ?? '');
        $props = json_decode((string) ($zeile['properties_json'] ?? ''), true);
        $wirksam = avesmapsWikiPathEffectiveEditName($alt, is_array($props) ? $props : []);
        if ($wirksam !== $alt) {
            throw new RuntimeException(
                'Der Weg ' . $publicId . ' traegt inzwischen einen Wiki-Artikel ("' . $wirksam . '") -- "' . $alt
                . '" laesst sich nicht zurueckschreiben, zurueckgenommen wurde nichts.'
            );
        }
    }
}

/**
 * Der Namens-Vermerk, der zu diesem Item gehoert: `[?vermerk, item_id_des_vermerks]`.
 *
 * 🔴 AM ITEM SELBST, SONST IM FRUEHEREN LAUF -- derselbe Rueckfall wie im 'new'-Zweig der Ruecknahme
 * (`$altItemId`): nach „Holen & Rechnen" steht das frische Item auf `apply_state = null`, der dauerhafte
 * Vermerk in `sync_decision` sagt trotzdem „uebernommen", und der Namens-Vermerk liegt am alten Item.
 * Von mehreren gilt das JUENGSTE uebernommene Item desselben Schluessels.
 * ⚠️ Traegt es KEINEN Namens-Vermerk (das public_id-Echo einer reinen Quellen-Ergaenzung), ist die
 * Antwort `[null, 0]` -- dann gibt es keinen Namen zurueckzugeben.
 *
 * @return array{0:?array, 1:int}
 */
function avesmapsGaretienNameVermerkZumItem(PDO $pdo, array $item): array
{
    if ((string) ($item['apply_state'] ?? '') === 'done') {
        $vermerk = avesmapsGaretienNameVermerkLesen((string) ($item['apply_note'] ?? ''));

        return [$vermerk, $vermerk === null ? 0 : (int) $item['id']];
    }
    $alt = $pdo->prepare(
        'SELECT i.id, i.apply_note FROM sync_plan_item i'
        . ' JOIN sync_plan_run r ON r.id = i.run_id'
        . " WHERE r.kind = :k AND i.entity_key = :e AND i.change_type = 'changed'"
        . " AND i.apply_state = 'done' AND i.apply_note IS NOT NULL AND i.apply_note <> ''"
        . ' ORDER BY i.id DESC LIMIT 1'
    );
    $alt->execute(['k' => AVESMAPS_GARETIEN_PLAN_KIND, 'e' => (string) ($item['entity_key'] ?? '')]);
    $treffer = $alt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($treffer)) {
        return [null, 0];
    }
    $vermerk = avesmapsGaretienNameVermerkLesen((string) ($treffer['apply_note'] ?? ''));

    return [$vermerk, $vermerk === null ? 0 : (int) $treffer['id']];
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
 * 🔴 SEIT DEM 15.09.2026 MIT EINER ENGEN AUSNAHME: `$einstellungen['name_ergaenzen'] === true` legt an einer
 * reinen Quellen-Ergaenzung den NAMEN dazu -- nur, wenn unser Objekt JETZT einen Platzhalternamen traegt
 * (Abschnitt „Quelle und Namen ergaenzen" oben). `vermerk` in der Antwort ist dann der Vermerk fuer
 * `apply_note`, sonst `null`.
 *
 * @param ?array $einstellungen der Rumpf DIESES Items (avesmapsGaretienUebernehmen, `$rumpfDesItems`)
 * @return array{felder:int, quellen:int, objekt_felder:int, vermerk:?string}
 */
function avesmapsGaretienErgaenzungAnwenden(PDO $pdo, array $nach, string $publicId, array $user, string $entityKey = '', ?array $einstellungen = null): array
{
    // 🔴 DER VERBINDLICHE RIEGEL (Owner 31.08.2026: „es gibt neu oder nix - kein verändern,
    // kein ersetzen"). Er steht HIER und nicht nur im Planbau: der laufende Lauf des Owners traegt
    // bereits fertige Ergaenzungs-Items in der Datenbank, und die liessen sich sonst weiterhin
    // uebernehmen. Ein Riegel, der nur verhindert, dass NEUE Angebote entstehen, ist keiner.
    // ⚠️ Er WIRFT, statt still nichts zu tun: der Aufrufer vermerkt das Item als 'failed' mit
    // diesem Grund, und der Editor sieht, warum. Ein stiller Leerlauf saehe aus wie „uebernommen".
    // 🔴 NUR DIE QUELLE DARF AN EIN BESTEHENDES OBJEKT (Owner 31.08.2026: „Garetien.de als
    // 'Quelle und Artikel ergänzen' soll erlaubt sein, aber nicht den namen verändern"). Sie ist
    // additiv, ueberschreibt nichts und ist exakt ruecknehmbar; Name und Geometrie sind es nicht.
    // ⚠️ Geprueft wird an den FELDERN, nicht am Anlass: der Anlass ist eine Beschriftung, die
    // Felder sind die Anweisung. Ein Item mit `['name','quelle']` faellt damit ganz heraus -- die
    // sichere Richtung.
    $angefragteFelder = array_values(array_unique(array_map('strval', (array) ($nach['felder'] ?? []))));
    sort($angefragteFelder);
    if (!AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT && $angefragteFelder !== AVESMAPS_GARETIEN_ERGAENZUNG_FELDER) {
        throw new RuntimeException(
            'Ersetzen ist abgeschaltet -- an einem bestehenden Objekt wird nur die Quelle ergaenzt, '
            . 'nicht "' . implode('", "', $angefragteFelder) . '".'
        );
    }
    // 🔴 „QUELLE UND NAMEN ERGAENZEN" (Owner 15.09.2026) -- GEPRUEFT, BEVOR IRGENDETWAS GESCHRIEBEN WIRD.
    // Die Ausnahme steht NEBEN dem Riegel darueber, nicht an seiner Stelle: `felder` bleibt ['quelle'],
    // der Name kommt allein ueber `name_ergaenzen` im Rumpf des Items herein, und nur, wenn der Name
    // unseres Objekts JETZT ein Platzhalter ist (avesmapsGaretienNameErgaenzenVorbereiten).
    // 💣 Ein Item, das ohnehin einen Namen schreibt (`felder` mit 'name' -- nur im Pruefstand der
    // Ersetzungs-Maschinerie denkbar), bekommt die Ausnahme NICHT dazu: zwei Namensschreiber an einem Item.
    $nameVorhaben = null;
    if (avesmapsGaretienNameErgaenzenGewuenscht($einstellungen)) {
        if ($angefragteFelder !== AVESMAPS_GARETIEN_ERGAENZUNG_FELDER) {
            throw new RuntimeException(
                '"Quelle und Namen ergaenzen" gilt nur an einer reinen Quellen-Ergaenzung, nicht an "'
                . implode('", "', $angefragteFelder) . '" -- geschrieben wurde nichts.'
            );
        }
        $nameVorhaben = avesmapsGaretienNameErgaenzenVorbereiten($pdo, $nach, $publicId);
    }

    $felder = (array) ($nach['felder'] ?? []);
    $userId = (int) ($user['id'] ?? 0);
    $geschrieben = 0;
    // 🔴 ZWEI PUBLIC-IDS, dieselbe Trennung wie im Anlegen (avesmapsGaretienUebernehmen): $publicId
    // ist das ZIEL des Update-Aufrufs -- bei einer Flaeche die REGION, die avesmapsUpdateEcosystemRegion
    // / …AreaGeometry auch tatsaechlich brauchen. Der ID-Raum, in dem die Karte die QUELLE
    // nachschlaegt, entsteht daraus erst am Ende dieser Funktion -- ueber
    // avesmapsGaretienQuellenZiel, die einzige Stelle, die das entscheidet. Seit Schritt 5 des
    // Quellen-Umbaus (03.09.2026) sind beide bei der Flaeche DIESELBE id: die Flaeche traegt
    // ihre Quellen selbst.

    if (($nach['ziel'] ?? '') === 'path') {
        $zeile = $pdo->prepare('SELECT name, feature_subtype, properties_json FROM map_features WHERE public_id = :p');
        $zeile->execute([':p' => $publicId]);
        $vorher = $zeile->fetch(PDO::FETCH_ASSOC);
        if ($vorher === false) {
            throw new RuntimeException('Der Abschnitt ' . $publicId . ' existiert nicht mehr.');
        }
        if (in_array('name', $felder, true)) {
            $gewuenschterName = (string) $nach['name'];
            // ⚠️ JEDES Feld des Hausschreibers reist mit seinem ALTEN Wert mit -- siehe oben. 🔴 Seit dem
            // 15.09.2026 aus EINEM Bauer (avesmapsGaretienWegDetailsRumpf), samt `is_bach`, das hier fehlte.
            avesmapsUpdatePathFeatureDetails($pdo, avesmapsGaretienWegDetailsRumpf($publicId, $vorher, $gewuenschterName), $user);
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
    } elseif (($nach['ziel'] ?? '') === 'location') {
        // 🔴 Ortschaften (Entwurf §3.1). 💣 avesmapsUpdatePointFeatureDetails IST GENAUSO WENIG
        // ein Teil-Update wie avesmapsUpdatePathFeatureDetails oben: is_nodix/is_ruined/
        // is_hidden/place_kind/description/wiki_url/other_source werden UNBEDINGT aus dem
        // Rumpf gelesen (`?? false`/`?? ''`/`?? null`) und wuerden ohne den vollstaendigen
        // aktuellen Bestand lautlos geloescht -- genau die Falle, deren Beleg oben schon steht.
        // Die drei Wiki-Textfelder (einwohner/lage/oberhaupt) bleiben dagegen unangetastet, wenn
        // sie im Rumpf FEHLEN (avesmapsApplyPointWikiFields prueft `array_key_exists`) -- sie
        // werden deshalb bewusst NICHT mitgeschickt.
        // ⚠️ `wiki_no_article` stand hier als vierter Fall derselben Regel. Der Merker ist am
        // 09.09.2026 global ausgebaut (Owner-Entscheid); der Rechner liest ihn nicht mehr, ein
        // Altbestand-Schluessel bleibt trotzdem unangetastet liegen -- geraeumt wird er einmalig
        // per Admin-Aktion, nicht von einem Import.
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
    }

    // 🔴 DER NAME VOR DER QUELLE, und das ist die sichere Reihenfolge: scheitert der Name, ist noch nichts
    // geschrieben (avesmapsGaretienNameErgaenzenSchreiben raeumt selbst auf); scheitert danach die Quelle,
    // gibt der Fang unten den Platzhalter zurueck. Umgekehrt stuende eine Quelle am Objekt, deren Item
    // 'failed' ist -- ein Zustand, den keine Ruecknahme mehr erreicht.
    $vermerk = null;
    if ($nameVorhaben !== null) {
        avesmapsGaretienNameErgaenzenSchreiben($pdo, $nameVorhaben, $user);
        $vermerk = (string) $nameVorhaben['vermerk'];
        $geschrieben++;
    }

    // 🔴 EINE ANTWORT FUER ALLE VIER ZIELARTEN, und sie steht NACH der Zweigkette -- nicht in
    // ihr. Vorher setzte jeder Zweig seinen eigenen `$entityType`, und der Flaechen-Zweig
    // schlug sich zusaetzlich das Label seiner Region nach. Genau so entstehen vier
    // Antwortgeber auf eine Frage (siehe avesmapsGaretienQuellenZiel).
    // ⚠️ $publicId ist bei einer Flaeche die REGION -- und das ist seit Schritt 5 des
    // Quellen-Umbaus genau die id, unter der die Quelle haengt. Der Nachschlag entfaellt
    // deshalb nicht aus Sparsamkeit, sondern weil er die falsche Frage stellte.
    [$entityType, $quellePublicId] = avesmapsGaretienQuellenZiel((string) ($nach['ziel'] ?? ''), $publicId);

    $quellen = 0;
    // 🔴 DER ZWEITE SCHREIBWEG FUER QUELLEN, und er ist der gefaehrlichere: hier bekommt ein
    // BESTEHENDES Objekt eine Quelle dazu. Er meldet die beruehrte Entitaet mit zurueck, damit der
    // Browser sie nachtragen kann (Owner-Meldung 31.08.2026) -- der Anlegeweg tut dasselbe an
    // seiner Stelle. Eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel.
    // ⚠️ Und aus demselben Grund geht er durch avesmapsGaretienQuellenAnlegen: die Artikelquelle
    // gehoert BEIDEN Wegen.
    $beruehrt = null;
    if (in_array('quelle', $felder, true)) {
        try {
            $quellen = avesmapsGaretienQuellenAnlegen($pdo, $entityType, $quellePublicId, $nach, $userId, $entityKey);
        } catch (Throwable $abbruch) {
            // ⚠️ Nur mit geschriebenem Namen gibt es etwas zurueckzugeben; sonst unveraendert weiter.
            if ($nameVorhaben !== null && $vermerk !== null) {
                avesmapsGaretienNameErgaenzenAufraeumen($pdo, $nameVorhaben, $user, $abbruch);
            }
            throw $abbruch;
        }
        if ($quellen > 0) {
            $geschrieben++;
            $beruehrt = ['entity_type' => $entityType, 'public_id' => $quellePublicId];
        }
    }

    // 🔴 ABGELEITET, NICHT MITGEFUEHRT (Ruecklauf des Koordinators, 06.09.2026): acht parallele
    // `$objektGeschrieben++`-Zeilen neben `$geschrieben++` waren eine von Hand gepflegte
    // Ableitung, die per Konstruktion IMMER `$geschrieben - ($quellen > 0 ? 1 : 0)` ergab -- die
    // Klasse Fehler, vor der AGENTS.md §10 an den bbox-Spalten warnt: eine Zahl, die man RECHNEN
    // kann, wird nicht gepflegt. Ein neunter Schreibpfad, der nur das erste `++` bekaeme, machte
    // `applied` still zu klein. `$geschrieben` zaehlt name+geometrie+quelle zusammen, und `quelle`
    // ist die einzige der drei, die NICHT zum Objekt selbst gehoert -- die Differenz IST
    // `objekt_felder`.
    $objektGeschrieben = $geschrieben - ($quellen > 0 ? 1 : 0);

    return [
        'felder' => $geschrieben, 'quellen' => $quellen, 'quelle_an' => $beruehrt, 'objekt_felder' => $objektGeschrieben,
        // 🔴 Der Namens-Vermerk fuer `apply_note` -- `null` ohne Namens-Ergaenzung (dann bleibt es beim Echo).
        'vermerk' => $vermerk,
    ];
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
 * Die Handeingaben JE ITEM aus dem Anfragerumpf (06.09.2026, Import-Stage).
 *
 * 🔴 EIN RUMPF JE ITEM, NICHT EINER FUER ALLE. Der alte Schluessel `einstellungen` galt fuer
 * saemtliche Items eines Aufrufs; das war unbedenklich, solange der einzige Aufrufer mit
 * Handeingabe („Neu einfuegen") auf GENAU EIN Objekt skopiert war. Die Stage schickt viele
 * Objekte auf einmal, jedes mit eigener Zielwahl — ein gemeinsamer Rumpf legte die Wahl des
 * zuletzt geoeffneten auf alle uebrigen.
 *
 * 💣 DIE SCHLUESSEL KOMMEN ALS ZEICHENKETTEN AN. JSON kennt keine Zahlen als Objektschluessel;
 * `json_decode(..., true)` liefert `"7" => [...]`. PHP wandelt numerische Zeichenketten beim
 * Array-Zugriff still um — aber `array_key_exists(7, $roh)` waere `false`, wenn wir es nicht
 * ausdruecklich normalisierten. Genau daran scheitert sonst der Abgleich mit `(int) $item['id']`.
 *
 * ⚠️ KEINE VALIDIERUNG DER WERTE, nur der Form — wie beim Geschwister
 * avesmapsGaretienEinstellungenAusRumpf. Der Server bleibt an seiner gewohnten Stelle die letzte
 * Instanz (avesmapsGaretienZielUebersteuern wirft bei einem unmoeglichen Ziel).
 *
 * @return ?array<int, array>
 */
function avesmapsGaretienEinstellungenJeItemAusRumpf(array $payload): ?array
{
    $roh = $payload['einstellungen_je_item'] ?? null;
    if (!is_array($roh) || $roh === []) {
        return null;
    }
    $raus = [];
    foreach ($roh as $schluessel => $rumpf) {
        $id = (int) $schluessel;
        if ($id > 0 && is_array($rumpf)) {
            $raus[$id] = $rumpf;
        }
    }

    return $raus === [] ? null : $raus;
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
 *     null. Gilt fuer ALLE 'new'-Items dieses Aufrufs, DIE KEINEN EIGENEN EINTRAG in `$jeItem`
 *     tragen -- der Rueckfall auf „ein Rumpf fuer alle", unbedenklich, weil der EINZIGE Aufrufer,
 *     der jemals eine Handeingabe OHNE `$jeItem` mitschickt (der Einzelknopf „Neu einfügen"),
 *     $itemIds stets auf GENAU EIN Objekt skopiert (siehe garetienEinfuegenAusfuehren). Die
 *     Massenübernahme „Alle angezeigten einfügen" schickt NIE eine Handeingabe -- sie uebergibt
 *     hier immer null.
 * @param ?array<int, array> $jeItem Die Handeingaben JE ITEM der Stage (06.09.2026,
 *     avesmapsGaretienEinstellungenJeItemAusRumpf) -- schlaegt `$einstellungen` fuer jedes Item mit
 *     eigenem Eintrag, siehe avesmapsGaretienUebernehmen.
 */
function avesmapsGaretienApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null, ?array $itemIds = null, ?array $einstellungen = null, ?array $jeItem = null): array
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
    $ergebnis = avesmapsGaretienUebernehmen($pdo, $runId, $ids, is_array($user) ? $user : ['id' => $userId], $einstellungen, $jeItem);
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
        // 🔴 DIE GRUENDE, NICHT NUR IHRE ZAHL (06.09.2026). `skipped` sagt „zwei sind nicht
        // durchgekommen"; welche und warum, stand bisher ausschliesslich in `apply_note` in der
        // Datenbank und erreichte keinen Browser. Die Statuszeile des Fensters nennt sie jetzt
        // beim Namen -- dieselbe Regel wie ueberall im Haus: eine stille Ausnahme ist von „hat
        // funktioniert" nicht zu unterscheiden.
        'fehler' => $ergebnis['fehler'],
        'angelegt_je_form' => $ergebnis['angelegt_je_form'],
        // 🔴 NACHBESSERUNG 1 (W1/G3-2): nicht-fatale Hinweise durchreichen -- „Quelle war schon
        // vorhanden" ist kein Fehler und gehoert nicht in `fehler`, aber `applied` allein sagt
        // nicht, warum ein Item ohne neue Quelle trotzdem `done` steht.
        'hinweise' => $ergebnis['hinweise'] ?? [],
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
 * @return array{geprueft:int, geschrieben:int, aufgeraeumt:int}
 */
/**
 * DIE DOPPELT HAENGENDE SAMMELQUELLE WEGRAEUMEN -- dort, wo ein Artikel danebensteht.
 *
 * 🔴 Owner 01.09.2026: „ja, räum die doppelten quellen weg." Zwischen dem 31.08. und dem
 * 01.09.2026 hat der Import BEIDE Adressen an ein Objekt gehaengt -- den Wirt (`garetien.de`) und
 * den eigenen Wiki-Artikel. Gleiche Domain, gleiche Namensnennung, gleiche Lizenz; in der Infobox
 * standen sie als zwei Zeilen untereinander, von denen die eine in der anderen steckt.
 *
 * 💣 SIE LOESCHT NUR DIE VERKNUEPFUNG, NIEMALS DIE `sources`-ZEILE. Der Quellenkatalog ist
 * geteilt (AGENTS.md §5): dieselbe Adresse kann an tausend anderen Objekten haengen, auch an
 * solchen, die mit diesem Import nichts zu tun haben.
 *
 * 🔴 DREI BEDINGUNGEN, UND JEDE EINZELNE IST EIN RIEGEL:
 *   · `origin = 'garetien'` -- was ein Mensch uebernommen hat, gehoert ihm. Dieselbe Regel wie
 *     in avesmapsGaretienQuelleAnlegen, wo eine fremde Notiz stehenbleibt.
 *   · die Adresse ist GENAU der Wirt -- kein `LIKE`, keine Praefixsuche; sonst traefe es die
 *     Artikeladresse gleich mit, und das Objekt stuende ohne jede Quelle da.
 *   · am SELBEN Objekt haengt eine Artikeladresse DESSELBEN Wirts, ebenfalls aus unserer Hand.
 *     Ohne sie waere die Sammelquelle die einzige Angabe, die es gibt -- knapp die Haelfte der
 *     Zeilen nennt keinen Artikel.
 *
 * ⚠️ Ein `suppressed`-Grabstein bleibt liegen: er BEDEUTET „hier soll nichts haengen", und
 * ihn zu loeschen hiesse, die Entscheidung dahinter zu vergessen.
 *
 * ⚠️ Zwei Anweisungen, eine je Wirt -- die Adressform wird nicht in SQL zusammengesetzt
 * (`CONCAT` kennt SQLite nicht, `||` liest MySQL als ODER). Die Wirte kommen aus
 * avesmapsGaretienWirtAusZeile, damit die beiden Hosts nicht ein zweites Mal im Repo stehen.
 *
 * @return int Zahl der geloesten Verknuepfungen
 */
function avesmapsGaretienDoppelteSammelquellenLoesen(PDO $pdo): int
{
    $geloest = 0;
    foreach (['ggp', 'kosch'] as $wiki) {
        $wirt = avesmapsGaretienWirtAusZeile(['wiki' => $wiki]);
        try {
            // 💣 Die doppelte Ableitungstabelle ist Pflicht, nicht Stil: MySQL lehnt eine
            // Unterabfrage auf die GELOESCHTE Tabelle mit Fehler 1093 ab, SQLite nicht -- ein Test
            // gegen SQLite wuerde die Regression also nicht sehen (AGENTS.md §9).
            $stmt = $pdo->prepare(
                'DELETE FROM feature_sources WHERE id IN (SELECT id FROM ('
                . '  SELECT fs.id FROM feature_sources fs'
                . '    JOIN sources s ON s.id = fs.source_id'
                . "   WHERE fs.origin = :o AND fs.status <> 'suppressed' AND s.url = :wirt"
                . '     AND EXISTS ('
                . '       SELECT 1 FROM feature_sources fa JOIN sources sa ON sa.id = fa.source_id'
                . '        WHERE fa.entity_type = fs.entity_type'
                . '          AND fa.entity_public_id = fs.entity_public_id'
                . '          AND fa.origin = :o2 AND sa.url LIKE :artikel'
                . '     )'
                . ') x)'
            );
            $stmt->execute([
                'o' => AVESMAPS_GARETIEN_SOURCE_ORIGIN,
                'o2' => AVESMAPS_GARETIEN_SOURCE_ORIGIN,
                'wirt' => $wirt,
                'artikel' => $wirt . '/index.php/%',
            ]);
            $geloest += $stmt->rowCount();
        } catch (PDOException) {
            // Ohne die Quellentabellen gibt es nichts aufzuraeumen.
        }
    }

    return $geloest;
}

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
        return ['geprueft' => 0, 'geschrieben' => 0, 'aufgeraeumt' => 0];
    }

    // 💣 WER SIE SCHON HAT, WIRD UEBERSPRUNGEN -- und das ist die Bedingung, unter der dieser
    // Nachzug ueberhaupt zweimal laufen darf. `avesmapsFeatureSourceLink` ist zwar idempotent,
    // schreibt aber jedes Mal; ohne diesen Riegel kostete jeder abgeschlossene Uebernahme-Vorgang
    // am Ende bis zu 8213 Schreibvorgaenge fuer nichts. Mit ihm sind es nach dem ersten Lauf ZWEI
    // Abfragen und null Schreibvorgaenge.
    // ⚠️ Erkannt an der ADRESSFORM (`/index.php/`), nicht an einer Zaehlung: „das Objekt hat zwei
    // garetien-Quellen" waere auch dann wahr, wenn jemand von Hand eine zweite angehaengt hat.
    // 🔴 DIESELBE FRAGE WIE DER PLANBAU, DERSELBE ERZEUGER (01.09.2026). Hier stand ein
    // zweiter, groeberer Scan (`s.url LIKE '%/index.php/%'`) -- eine Frage mit zwei
    // Antwortgebern, und die feinere von beiden kannte er nicht. Jetzt fragen beide
    // avesmapsGaretienQuellenBestand, das je (Objekt, ADRESSE) antwortet.
    $bestand = avesmapsGaretienQuellenBestand($pdo);

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
            // 🔴 FIXRUNDE 1, BEFUND A: seit Aufgabe 6 traegt JEDE 'region'-Zeile den
            // strukturierten Vermerk ("area:<a> | region:<r> | verbund:<v>"), auch OHNE Verbund
            // (dann bleibt das dritte Feld leer) -- nicht mehr die nackte public_id. Ein alter
            // Vermerk (vor Aufgabe 6 geschrieben) hat kein ':' und laeuft durch
            // avesmapsGaretienVermerkLesen unveraendert in den "alter Vermerk"-Zweig, der ihn
            // 1:1 als 'region' zurueckgibt -- diese eine Zeile deckt also BEIDE Formen ab, ohne
            // den `ziel`-Wert dieses Items selbst zu pruefen.
            //
            // 🔴 GEBRAUCHT WIRD DIE REGION, NICHT DIE FLAECHE: avesmapsGaretienQuellenZiel
            // erwartet laut seinem Docblock "bei 'region' die [public_id] der REGION, nicht die
            // ihrer Beschriftung" -- seit Schritt 5 des Quellen-Umbaus (03.09.2026) traegt die
            // FLAECHE ihre Quellen unter `ecosystem:<region_public_id>`, keine eigene Kennung.
            //
            // 💣 OHNE DIESE ZEILE bekommt avesmapsEcosystemLabelSourceTarget (rein, wirft nie)
            // den GANZEN Vermerk-String als "Region" und liefert klaglos
            // ['ecosystem', '<der ganze Vermerk>'] zurueck -- eine feature_sources-Zeile, die
            // kein Leser je findet, plus ein Revisions-Bump fuer NICHTS.
            $objektId = avesmapsGaretienVermerkLesen((string) ($zeile['apply_note'] ?? ''))['region'];
        }
        if ($objektId === '') {
            continue;
        }
        try {
            [$entityType, $quellePublicId] = avesmapsGaretienQuellenZiel(
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
        // ⚠️ Uebersprungen wird, wem BEIDE Adressen schon haengen -- dieselbe Rechnung wie im
        // Planbau. Fehlt eine, wird geschrieben; `avesmapsGaretienQuelleAnlegen` ist dabei
        // idempotent und fasst eine fremde Verknuepfung nicht an.
        $erwartet = avesmapsGaretienQuellenAdressenAus(
            (string) ($nach['quelle']['url'] ?? ''),
            avesmapsGaretienArtikelQuelleAusItem($nach, $entityKey)
        );
        $fehlt = false;
        foreach ($erwartet as $adresse) {
            if (!isset($bestand[avesmapsGaretienQuellenSchluessel($entityType, $quellePublicId, $adresse)])) {
                $fehlt = true;
                break;
            }
        }
        if (!$fehlt) {
            continue;
        }
        if (avesmapsGaretienQuellenAnlegen($pdo, $entityType, $quellePublicId, $nach, 0, $entityKey) > 0) {
            $geschrieben++;
            // ⚠️ Innerhalb EINES Laufs mitfuehren: mehrere Items koennen auf dasselbe Objekt
            // zeigen (eine Flaeche und ihre Beschriftung), und ohne das zaehlte der Lauf sie
            // doppelt -- und schriebe sie doppelt.
            foreach ($erwartet as $adresse) {
                $bestand[avesmapsGaretienQuellenSchluessel($entityType, $quellePublicId, $adresse)] = true;
            }
        }
    }

    // 💣 EIN STEMPEL, UND NUR WENN WIRKLICH ETWAS GESCHRIEBEN WURDE -- dieselbe Regel wie am
    // Ende von avesmapsGaretienUebernehmen: ein Stempel ohne Schreibvorgang entwertet die Kopie
    // JEDES Besuchers fuer nichts.
    if ($geschrieben > 0) {
        avesmapsNextMapRevision($pdo);
    }

    // 🔴 ZULETZT, NIE DAVOR. Erst haengt der Artikel, dann faellt die Sammelquelle -- in der
    // anderen Reihenfolge stuende ein Objekt zwischen den beiden Anweisungen ohne jede Quelle da,
    // und ein Abbruch dazwischen liesse es so.
    // 💣 UND SIE SITZT IM NACHZUG, nicht an seinen zwei Aufrufern (Planbau-Endpunkt und
    // Ende eines Uebernahme-Vorgangs). An den Aufrufstellen waere sie beim naechsten vergessen --
    // die Falle, die dieser Importer schon dreimal bezahlt hat.
    $geloest = avesmapsGaretienDoppelteSammelquellenLoesen($pdo);

    return ['geprueft' => $geprueft, 'geschrieben' => $geschrieben, 'aufgeraeumt' => $geloest];
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

// 🔴 DIE SIEBEN FORMEN, GENAU EINMAL -- die frisch angelegten Objekte lesbar aufgeschluesselt
// statt einer nackten Zahl (06.09.2026, Import-Stage). `bach` ist die TEILMENGE von `path`, kein
// eigener Topf: ein Bach IST ein Flussweg mit Haekchen (AVESMAPS_GARETIEN_TYP_MAP). `quelle`
// zaehlt den ERGAENZUNGS-Zweig (ein bestehendes Objekt bekommt eine Quelle dazu, siehe
// avesmapsGaretienErgaenzungAnwenden) -- dort entsteht kein neues Kartenobjekt, nur ein Verweis.
// ⚠️ EINE Konstante fuer beide Stellen, die diese Form kennen (der frueh verlassene Leerlauf unten
// und der echte Zaehler im Rumpf): zwei Array-Literale liefen beim naechsten neuen Schluessel
// auseinander, und der Leerlauf haette einen Schluessel weniger gehabt als die echte Zaehlung.
const AVESMAPS_GARETIEN_JE_FORM_LEER = [
    'path' => 0, 'bach' => 0, 'region' => 0, 'label' => 0,
    'location' => 0, 'settlement_place' => 0, 'quelle' => 0,
];

/**
 * Die angehakten Vorschlaege eines Vorschau-Laufs uebernehmen.
 *
 * @param list<int> $itemIds Nur diese Items -- alles andere bleibt unberuehrt.
 * @param ?array $einstellungen Handeingabe des Kastens „Eingefügt wird" (Owner 30.08.2026,
 *     „warum darf ich das nicht verändern?"), oder null (keine -- der Grundfall, und IMMER der
 *     Fall bei „Alle angezeigten einfügen"). Wirkt nur auf 'new'-Items mit ziel 'region'/'label'
 *     -- ein Ort/Weg speichert keines dieser Felder, siehe avesmapsGaretienLabelUebersteuerung.
 *     🔴 DER RUECKFALL, WENN `$jeItem` NULL IST -- ein Item mit eigenem Eintrag in `$jeItem`
 *     sieht diesen Parameter nie.
 * @param ?array<int, array> $jeItem Die Handeingaben JE ITEM (06.09.2026, Import-Stage,
 *     avesmapsGaretienEinstellungenJeItemAusRumpf). `null` heisst „kein Aufrufer dieser Aufgabe" --
 *     dann gilt `$einstellungen` fuer alle Items wie bisher. Ist `$jeItem` gesetzt, bekommt JEDES
 *     Item NUR seinen eigenen Eintrag oder gar keine Handeingabe -- nie den gemeinsamen Rumpf,
 *     auch dann nicht, wenn das Item selbst fehlt (siehe die Begruendung an `$rumpfDesItems`
 *     unten).
 * @return array{angelegt:int, quellen:int, fehler:list<array{item:int, grund:string}>,
 *     angelegt_je_form:array{path:int,bach:int,region:int,label:int,location:int,
 *     settlement_place:int,quelle:int}}
 */
function avesmapsGaretienUebernehmen(PDO $pdo, int $runId, array $itemIds, array $user = [], ?array $einstellungen = null, ?array $jeItem = null): array
{
    if ($itemIds === []) {
        return [
            'angelegt' => 0, 'quellen' => 0, 'fehler' => [], 'quellen_neu' => [],
            'angelegt_je_form' => AVESMAPS_GARETIEN_JE_FORM_LEER, 'hinweise' => [],
        ];
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
    // 🔴 NACHBESSERUNG 1 (W1/G3-2): NICHT-FATALE HINWEISE, GETRENNT VON `fehler`. Ein „Nur
    // Quelle"-Item, dessen Adresse schon haengt, ist kein Fehlschlag (das Item bleibt `done`,
    // das Ziel -- die Quelle steht am Ort -- ist erfuellt) -- aber „1 Quelle ergaenzt" waere hier
    // eine Falschaussage. Die Meldung sagt stattdessen die Wahrheit.
    $hinweise = [];
    // 🔴 DIE FORMZAEHLUNG DIESES LAUFS -- siehe AVESMAPS_GARETIEN_JE_FORM_LEER oben. Sie gehoert in
    // den RUMPF der Funktion, nicht in eine Signatur oder einen globalen Zustand: eine spaetere
    // Erweiterung (Aufgabe 4, `$jeItem`) darf diese Zaehlung unveraendert lassen.
    $jeForm = AVESMAPS_GARETIEN_JE_FORM_LEER;

    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $item) {
        // 🔴 Zweimal uebernehmen legt NICHT zweimal an. Der Vermerk steht am Item, nicht an einer
        // eigenen Liste -- eine zweite Buchhaltung darueber, was schon geschrieben wurde, liefe
        // beim ersten Abbruch auseinander.
        if (($item['apply_state'] ?? null) === 'done') {
            continue;
        }
        // 🔴 DIE WAHL DIESES EINEN ITEMS SCHLAEGT DEN GEMEINSAMEN RUMPF -- und ein Item OHNE
        // Eintrag bekommt KEINEN: `null` heisst „keine Handeingabe", nicht „nimm die des
        // Nachbarn". Fiele es auf `$einstellungen` zurueck, truege ein Objekt die Wahl eines
        // anderen, und das ist genau der Fehler, den diese Erweiterung behebt.
        $rumpfDesItems = ($jeItem !== null && array_key_exists((int) $item['id'], $jeItem))
            ? $jeItem[(int) $item['id']]
            : ($jeItem === null ? $einstellungen : null);
        $nach = json_decode((string) $item['after_json'], true);
        // 🔴 DIE WAHL DES EDITORS LEGT SICH AUF DEN VORSCHLAG -- HIER UND NUR HIER.
        // `$nach` entsteht an genau dieser Stelle; jeder Leser weiter unten fragt `ziel`/`subtyp`
        // daraus. Wuerde die Wahl daneben als zweiter Wert gereicht, muesste JEDER dieser Leser
        // sie kennen, und der naechste vergisst sie (die Falle, die dieses Modul dreimal bezahlt
        // hat). ⚠️ Vor der Herkunftspruefung waere sie falsch platziert: ein fremder Vorschlag
        // soll gar nicht erst umgeformt werden.
        if (is_array($nach) && ($nach['herkunft'] ?? '') === 'garetien') {
            try {
                $nach = avesmapsGaretienZielUebersteuern($nach, $rumpfDesItems);
                // 🔴 DERSELBE EINE ORT (Owner 09.09.2026). Der Name legt sich hier auf den
                // Vorschlag, und jeder Anleger weiter unten liest ihn aus `$nach['name']` --
                // die Flaeche UND ihr Label. Ein zweiter Weg waere die Divergenz, vor der der
                // Absatz darueber warnt.
                $nach = avesmapsGaretienNameUebersteuern($nach, $rumpfDesItems);
            } catch (Throwable $abbruch) {
                // ⚠️ LAUT, nicht still: eine verworfene Zielwahl waere von „hat funktioniert"
                // nicht zu unterscheiden, und das Objekt laege danach in der falschen Form auf der
                // Karte.
                // 🔴 GEKAPPT WIE `apply_note` ZWEI ZEILEN DARUNTER (Ruecklauf des Koordinators,
                // 06.09.2026): `fehler[].grund` reist seit dem 06.09.2026 bis in die Antwort von
                // sync-plan.php und damit zu JEDEM Editor mit Faehigkeit `edit` -- nicht nur zum
                // Admin, wie beim Fetch-Fehler in garetien-import.php (AGENTS.md §10: "several
                // edit endpoints leak getMessage() to clients", Meilenstein M1). Ein ungekapptes
                // `getMessage()` waere genau dieser Mangel, neu aufgemacht.
                $fehler[] = ['item' => (int) $item['id'], 'grund' => mb_substr($abbruch->getMessage(), 0, 300, 'UTF-8')];
                avesmapsGaretienItemAbschliessen(
                    $pdo,
                    (int) $item['id'],
                    'failed',
                    mb_substr($abbruch->getMessage(), 0, 300, 'UTF-8')
                );
                continue;
            }
        }
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
                $fehler[] = ['item' => (int) $item['id'], 'grund' => mb_substr($grund, 0, 300, 'UTF-8')];
                avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'stale', mb_substr($grund, 0, 300, 'UTF-8'));
                continue;
            }
            try {
                // 🔴 DER RUMPF DIESES ITEMS REIST MIT (15.09.2026): an ihm haengt `name_ergaenzen`
                // („Quelle und Namen ergaenzen"). Er ist derselbe `$rumpfDesItems`, den Ziel- und
                // Namensuebersteuerung oben schon gelesen haben -- kein zweiter Weg zur Wahl des Editors.
                $ergebnis = avesmapsGaretienErgaenzungAnwenden(
                    $pdo, $nach, (string) $item['entity_public_id'], $user, (string) $item['entity_key'], $rumpfDesItems
                );
                // 🔴 NUR DAS OBJEKT SELBST ZAEHLT ALS `applied` (06.09.2026, Nachtrag auf
                // Rueckfrage): name/geometrie-Aenderungen sind ein wirklich veraendertes
                // Kartenobjekt, eine Quelle ist ein additiver Verweis an einem BESTEHENDEN --
                // `objekt_felder` haelt das auseinander, `felder` (das GANZE, quelle inklusive)
                // bleibt fuer Rueckwaertskompatibilitaet stehen.
                // 🔴 DIE ECHTE BEGRUENDUNG STEHT IN DER STATUSZEILE, NICHT IN EINER SUMMEN-
                // INVARIANTE (die es zwischen 'new' und 'changed' NICHT gibt -- siehe
                // schritt4/schritt6/schritt7 in garetien-uebernahme-test.php, alle mit
                // objekt_felder > 0 und trotzdem ohne diese Aussage). `garetienImportMeldung`
                // (js/review/review-garetien-importer.js, Aufgabe 3) baut aus `applied` den Satz
                // "N Objekte importiert" und aus `angelegt_je_form.quelle` GETRENNT den Satz
                // "N Quellen ergaenzt". Zaehlte eine reine Quellen-Ergaenzung in BEIDEN mit, laese
                // ein Editor fuer EINE Handlung "3 Objekte importiert · 3 Quellen ergaenzt" --
                // drei erfundene Kartenobjekte, die es nie gab.
                $angelegt += ($ergebnis['objekt_felder'] ?? 0) > 0 ? 1 : 0;
                $quellen += $ergebnis['quellen'];
                // 🔴 DER ERGAENZUNGSZWEIG ZAEHLT ALS `quelle`, NIE ALS EINE DER FUENF FORMEN --
                // hier entsteht kein neues Kartenobjekt, nur ein Verweis an einem BESTEHENDEN.
                // „3 Wege" wuerde sonst behaupten, drei neue Wege liegen auf der Karte, waehrend
                // in Wahrheit ein alter drei Quellen dazubekommen hat.
                // ⚠️ GEZAEHLT WIRD AN `quellen` (WIRKLICH HINZUGEFUEGT), NICHT AN `felder`: ein
                // Ergaenzungsversuch OHNE gefundene Adresse (kein Artikel, kein Wirt -- knapp die
                // Haelfte der Zeilen) laeuft ohne Fehler durch, haette aber NICHTS ergaenzt.
                // Ungeprueft mitgezaehlt behauptete "3 Quellen ergaenzt", waehrend real vielleicht
                // keine einzige neue Zeile entstanden ist -- dieselbe stille Ausnahme, vor der
                // dieses Haus ueberall warnt.
                if ($ergebnis['quellen'] > 0) {
                    $jeForm['quelle']++;
                }
                if (is_array($ergebnis['quelle_an'] ?? null)) {
                    $quellenNeu[$ergebnis['quelle_an']['entity_type'] . ':' . $ergebnis['quelle_an']['public_id']]
                        = $ergebnis['quelle_an'];
                }
                // 🔴 DER VERMERK: sonst das public_id-Echo wie eh und je, mit Namens-Ergaenzung der JSON-Vermerk,
                // aus dem ↩ den Platzhalter zurueckholt (avesmapsGaretienNameVermerkBauen).
                avesmapsGaretienItemAbschliessen(
                    $pdo, (int) $item['id'], 'done', (string) ($ergebnis['vermerk'] ?? $item['entity_public_id']), $userId
                );
            } catch (Throwable $abbruch) {
                // 🔴 GEKAPPT WIE `apply_note` -- siehe die Begruendung am ersten Fehlschlagfang
                // dieser Funktion.
                $fehler[] = ['item' => (int) $item['id'], 'grund' => mb_substr($abbruch->getMessage(), 0, 300, 'UTF-8')];
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
            $fehler[] = ['item' => (int) $item['id'], 'grund' => mb_substr($grund, 0, 300, 'UTF-8')];
            // 💣 Auch hier ein Vermerk -- siehe oben. `stale` und nicht `failed`: es ist nichts
            // kaputt, die Zeile gehoert nur nicht in diese Stufe.
            avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'stale', mb_substr($grund, 0, 300, 'UTF-8'));
            continue;
        }

        try {
            $ziel = (string) ($nach['ziel'] ?? '');
            // 🔴 DER VERMERK DIESES ITEMS -- Vorgabe die schlichte public_id, wie eh und je. NUR
            // der Flaechen-Zweig (ganz unten) setzt ihn auf den strukturierten Verbund-Vermerk
            // um; jeder andere Zweig laesst diese Vorgabe stehen. Frisch je Durchlauf, damit kein
            // Wert der VORIGEN Schleifenrunde stehenbleibt.
            $vermerk = null;
            // 🔴 „INNERORTS EINFUEGEN" IST EINE EIGENE HANDLUNG, kein anderes Kartenziel. Sie legt
            // eine STAETTE an (settlement_place) und ruehrt `map_features` nicht an -- ein Objekt
            // ohne Weltkarten-Position kann dort nicht liegen, die Geometrie ist Pflicht.
            // 💣 UND SIE FAELLT NIE STILL AUF DIE KARTE ZURUECK. Wer den Knopf drueckt, will KEINEN
            // Kartenpunkt; ein Rueckfall waere von aussen nicht von „hat funktioniert" zu
            // unterscheiden -- und das Objekt laege danach an einer Stelle, an die es niemand
            // gesetzt hat. Fehlt der Befund, bricht das Item ab und sagt warum.
            $innerortsOrt = null;
            // 🔴 „NUR QUELLE + ARTIKEL AN X" (Entwurf 14.09.2026, §5): derselbe Befund, die kleinere
            // Antwort -- keine Staette, keine neue Zeile, nur die Quelle an der Siedlung.
            $nurQuelle = false;
            if (avesmapsGaretienInnerortsGewuenscht($rumpfDesItems)) {
                // 🔴 NACHBESSERUNG 1 (G3): DIE WAHL GILT NUR AN EINEM ITEM, DAS SELBST EIN BAUWERK
                // IST -- dieselbe Klassenregel, die avesmapsGaretienInnerortsBefund schon beim
                // Planbau benutzt (`$ziel === 'location' && avesmapsIstBauwerksklasse(subtyp)`),
                // keine neue Rechnung. Ohne dieses Tor band ein Rumpf {innerorts:true,
                // innerorts_public_id:…} an einem WEG- oder FLAECHEN-Item eine Staette bzw. eine
                // Quelle an eine Siedlung -- fuer ein Objekt, das gar keine Innerorts-Lage hat.
                // Vorher sperrten das die `kandidaten` des Befunds stillschweigend (ein Weg-Item
                // hatte nie einen Innerorts-Befund im `after_json`); seit avesmapsGaretienInnerortsSiedlung
                // die Wahl auch AUSSERHALB der Kandidaten annimmt, entfaellt diese stille Sperre.
                if ($ziel !== 'location' || !avesmapsIstBauwerksklasse((string) ($nach['subtyp'] ?? ''))) {
                    throw new RuntimeException(
                        '"' . $item['label'] . '" ist kein Bauwerk -- Innerorts-Einstellungen'
                        . ' ("Auf die Karte -- innerorts" bzw. "Nur Quelle") gelten nur fuer Bauwerke.'
                    );
                }
                $nurQuelle = avesmapsGaretienInnerortsNurQuelle($rumpfDesItems);
                // 🔴 WELCHE SIEDLUNG, ENTSCHEIDET EINE STELLE (avesmapsGaretienInnerortsSiedlung): die
                // ausdrueckliche Wahl, wenn es eine gibt -- sonst die Vorauswahl des Laufs. Sie WIRFT,
                // statt auf eine andere Siedlung auszuweichen. „Nur Quelle" verlangt zusaetzlich, dass
                // auch die Vorauswahl noch auf der Karte liegt (die Quelle haette sonst kein Ziel).
                $innerortsOrt = avesmapsGaretienInnerortsSiedlung($pdo, $nach, $rumpfDesItems, (string) $item['label'], $nurQuelle);
            }
            // 🔴 ZWEI PUBLIC-IDS, NICHT EINE. $publicId ist das angelegte Objekt (steht als
            // Vermerk im Item, und bei einer Flaeche ist das die REGION -- die Ruecknahme loescht
            // darueber via avesmapsDeleteEcosystemRegion). $quellePublicId ist der ID-Raum, in dem
            // die Karte Quellen NACHSCHLAEGT (map-features.php:1228,
            // $entityTypeByFeatureType['label'] = 'region', keyed an der public_id des LABELS,
            // nicht der Region) -- fuer Weg/Ort/Gipfel sind beide gleich, nur bei der Flaeche
            // (See/Meer/Sumpf/…) laufen sie auseinander.
            $quellePublicId = null;
            // 🔴 NACHBESSERUNG 1 (W1): VORHER gelesen, NICHT aus dem Upsert geschlossen -- siehe
            // avesmapsGaretienQuelleHaengtSchonAn. Ausserhalb des `if ($nurQuelle)`-Zweigs
            // initialisiert, weil der Zaehlblock nach dem Anlege-Verteiler beide Werte braucht.
            $nurQuelleWarNeu = false;
            $nurQuelleArtikelUrl = '';
            if ($nurQuelle) {
                // 🔴 „NUR QUELLE + ARTIKEL AN X": die Quelle geht an die SIEDLUNG, ueber dieselbe
                // Weiche wie bei einem Ort (avesmapsGaretienQuellenZiel, `settlement`), und es
                // entsteht KEINE Zeile. Die Siedlung kommt aus DERSELBEN Pruefung wie bei der Staette
                // (avesmapsGaretienInnerortsSiedlung, oben): aktiv auf der Karte, eine Siedlung -- bei
                // „Nur Quelle" auch dann, wenn es die Vorauswahl des Laufs ist.
                [$entityType, $quellePublicId] = avesmapsGaretienQuellenZiel('location', (string) $innerortsOrt['public_id']);
                $publicId = $quellePublicId;
                // 🔴 NACHBESSERUNG 1 (W1): „neu entstanden" wird VOR avesmapsGaretienQuellenAnlegen
                // gelesen -- ein Sammelartikel zweier Bauwerke oder die eigene Adresse der Stadt
                // liessen avesmapsGaretienQuelleAnlegen `true` zurueckgeben, obwohl NICHTS Neues
                // hing (es haengte schon uns und wurde nur aufgefrischt). Ohne diese Unterscheidung
                // konnte die Ruecknahme des ZWEITEN Bauwerks die Quelle des ERSTEN mitreissen.
                $nurQuelleArtikel = avesmapsGaretienArtikelQuelleAusItem($nach, (string) $item['entity_key']);
                $nurQuelleArtikelUrl = trim((string) ($nurQuelleArtikel['url'] ?? ''));
                $nurQuelleWarNeu = $nurQuelleArtikelUrl !== ''
                    && !avesmapsGaretienQuelleHaengtSchonAn($pdo, $entityType, $quellePublicId, $nurQuelleArtikelUrl);
                // 💣 NIE die nackte public_id als Vermerk -- die Ruecknahme loeschte sonst die Stadt.
                // Das zweite Feld (`angelegt:0/1`) traegt die eben gelesene Wahrheit weiter --
                // avesmapsGaretienRuecknahmeAusfuehren entscheidet nur damit, ob sie loesen darf.
                $vermerk = avesmapsGaretienNurQuelleVermerk($quellePublicId, $nurQuelleWarNeu);
            } elseif ($innerortsOrt !== null) {
                // 🔴 DER TYP IST IHR QUELLTYP, nicht unser Subtyp. Die Staetten-Zeile der Infobox
                // gruppiert nach dem Vokabular des Wikis („Tempel", „Gasthaus", „Burg") -- unser
                // `gebaeude` waere dort eine Gruppe, in der alles liegt. `typ` steht seit dem
                // Planbau im Vorschlag und ist genau dieses Wort.
                $publicId = avesmapsSettlementPlaceAdd($pdo, [
                    'name' => (string) $nach['name'],
                    'place_type' => (string) ($nach['typ'] ?? ''),
                    'settlement_public_id' => (string) $innerortsOrt['public_id'],
                    'settlement_name' => (string) $innerortsOrt['name'],
                    // ⚠️ Der eigene Artikel, nicht die Export-Arbeitsseite: die Staetten-Zeile
                    // verlinkt ihn, und ein Leser soll auf garetien.de landen.
                    'wiki_url' => (string) ($nach['artikel_quelle']['url'] ?? ''),
                    'origin' => 'garetien',
                ], $userId);
                // 🔴 DIE QUELLE HAENGT AUCH AN EINER STAETTE. Sie traegt die RECHTSFOLGE (Lizenz
                // cc-by-nc-sa-3.0, Namensnennung „VolkoV / garetien.de") und darf nicht davon
                // abhaengen, in welcher Tabelle das Objekt gelandet ist. `settlement_place` ist
                // deshalb ein `entity_type` der GETEILTEN Quellentabelle -- die zwei Zeilen, die
                // AGENTS.md §5 dafuer vorsieht, statt einer zweiten Quellenverwaltung.
                // 🔧 Angezeigt wird sie heute nirgends: die Staetten-Zeile der Infobox kennt nur
                // Name, Art und Artikel-Link. Aufgezeichnet ist sie trotzdem.
                $entityType = 'settlement_place';
                $quellePublicId = $publicId;
                $jeForm['settlement_place']++;
            } elseif ($ziel === 'path') {
                // 🔴 DIE HANDEINGABE DES KASTENS „Eingefuegt wird" (Owner 30.08.2026: „dann weg
                // bearbeiten"). Ohne sie ist das dritte Array LEER, und dann ist dieser Aufruf
                // zeichengleich mit dem von vorher -- „Alle angezeigten einfuegen" schickt nie
                // Einstellungen und legt Wege deshalb weiter genau wie bisher an.
                $flussrichtung = avesmapsGaretienFlussrichtungAus($nach, $rumpfDesItems);
                $feature = avesmapsCreatePathFeature($pdo, array_merge([
                    'name' => (string) $nach['name'],
                    'feature_subtype' => (string) $nach['subtyp'],
                    // 🔴 Die Stroemungsrichtung reist MIT dem Anlegen (02.09.2026) -- nur bei einem
                    // Flussweg; `null` faellt hier heraus, statt als `flow: null` mitzureisen.
                    ...($flussrichtung !== null ? ['flow' => $flussrichtung] : []),
                    // 🔴 Das Bach-Haekchen der Zuordnung (AVESMAPS_GARETIEN_TYP_MAP['Bach']).
                    // avesmapsCreatePathFeature gibt es an avesmapsPathTransportRegel weiter, und
                    // die nimmt einem Bach jede Befahrbarkeit -- baulich, nicht per Bedingung.
                    'is_bach' => avesmapsGaretienNachIstBach($nach),
                    // 💣 GeoJSON [x,y] -> Hausvertrag, siehe avesmapsGaretienGeoJsonNachHausvertrag.
                    'coordinates' => avesmapsGaretienGeoJsonNachHausvertrag((array) $nach['geometry']['coordinates']),
                ], avesmapsGaretienWegUebersteuerung($rumpfDesItems)), $user);
                $publicId = avesmapsGaretienPublicIdAus($feature, 'Der Weg');
                [$entityType, $quellePublicId] = avesmapsGaretienQuellenZiel('path', $publicId);
                $jeForm['path']++;
                // 🔴 `bach` ist die TEILMENGE von `path`, kein eigener Topf: ein Bach IST ein
                // Flussweg mit Haekchen (AVESMAPS_GARETIEN_TYP_MAP). Zaehlte er nur hier, ergaeben
                // die Formzahlen zusammen weniger als `applied`, und die Statuszeile behauptete,
                // ein Objekt sei verschwunden.
                if (avesmapsGaretienNachIstBach($nach)) {
                    $jeForm['bach']++;
                }
                // 🔴 KREUZUNGEN AN BEIDE ENDEN, Vorgabe JA (Owner 02.09.2026). Ohne sie haengt der
                // Weg im Routennetz an nichts -- die Begruendung steht an
                // avesmapsGaretienSetztEndkreuzungen.
                if (avesmapsGaretienSetztEndkreuzungen($rumpfDesItems)) {
                    avesmapsGaretienEndkreuzungenAnlegen(
                        $pdo,
                        (array) $nach['geometry']['coordinates'],
                        $user
                    );
                }
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
                ], avesmapsGaretienOrtUebersteuerung($rumpfDesItems)), $user);
                $publicId = avesmapsGaretienPublicIdAus($feature, 'Der Ort');
                // 🔴 Die Bindung 'location' -> 'settlement' steht in avesmapsGaretienQuellenZiel,
                // nicht hier -- ein anderer Wert liesse die Quelle unauffindbar im Katalog liegen.
                [$entityType, $quellePublicId] = avesmapsGaretienQuellenZiel('location', $publicId);
                $jeForm['location']++;
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
                // ⚠️ `array_merge` mit bedingt leerem drittem Array statt einer Feldzuweisung auf
                // eigener Zeile -- siehe die ausfuehrliche Begruendung an
                // avesmapsGaretienFlaecheAnlegen oben. Der Scanner, der diese Form einmal erzwang,
                // ist am 09.09.2026 mit dem Merker gefallen; die Form bleibt, der Zwang nicht.
                $wikiZuweisung = avesmapsGaretienWikiLandschaftZuweisung($pdo, (string) $nach['name'], (string) $nach['subtyp']);
                $feature = avesmapsCreateLabelFeature($pdo, array_merge(
                    ['text' => (string) $nach['name'], 'feature_subtype' => (string) $nach['subtyp'],
                        'lng' => $punkt['lng'], 'lat' => $punkt['lat']],
                    avesmapsGaretienLabelUebersteuerung($rumpfDesItems, avesmapsGaretienLabelVorgabeFuerArt($pdo, (string) $nach['subtyp'])),
                    $wikiZuweisung !== null ? ['wiki_region' => $wikiZuweisung] : []
                ), $user);
                $publicId = avesmapsGaretienPublicIdAus($feature, 'Der Gipfel');
                // 🔴 Ein Berggipfel ist ein FREIES Label -- es gibt hier keine Region, an die die
                // Quelle stattdessen haengen koennte. Die Weiche sagt dafuer 'region' + eigene id.
                [$entityType, $quellePublicId] = avesmapsGaretienQuellenZiel('label', $publicId);
                $jeForm['label']++;
            } else {
                // 🔴 DER SERVER GRUPPIERT UEBER STAMM **UND ART**, NICHT NUR DEN CLIENT-SCHLUESSEL
                // -- `garetienVerbundSchluessel` (js/review/review-garetien-importer.js) haengt
                // Ebene und Typ an, um zwei gleichnamige Verbuende unterschiedlicher Art INNERHALB
                // EINES LAUFS auseinanderzuhalten (`avesmapsGaretienVerbuende`, garetien-verbund.php,
                // prueft das schon VOR der Gruppierung). Das gilt nur laufINTERN: die Anfuehrer-Suche
                // hier ist laufUEBERGREIFEND (Befund C) und kennt jene Gruppierung nicht -- sie
                // prueft deshalb selbst, ob eine gefundene Region noch aktiv UND von derselben Art
                // ist (`kind`/`region_type`), sonst koennten zwei gleichnamige Verbuende
                // verschiedener Art aus ZWEI Laeufen sich faelschlich dieselbe Region teilen
                // (Fixrunde 2, Befund E).
                $verbund = trim((string) ($rumpfDesItems['verbund'] ?? ''));
                $anRegion = $verbund === ''
                    ? null
                    : avesmapsGaretienVerbundRegion($pdo, $verbund, (string) $nach['kind'], (string) $nach['subtyp']);
                $ergebnis = avesmapsGaretienFlaecheAnlegen($pdo, $nach, $user, $userId, $rumpfDesItems, $anRegion);
                $publicId = $ergebnis['public_id'];
                // 🔴 SEIT SCHRITT 5 DES QUELLEN-UMBAUS (03.09.2026) TRAEGT DIE FLAECHE IHRE
                // QUELLEN SELBST -- $publicId ist die REGION, und genau das ist die id, unter der
                // die Karte sie nachschlaegt ('ecosystem'). Bis dahin stand hier
                // $ergebnis['label_public_id'] mit der Begruendung "die Quellen einer Landschaft
                // liegen an ihrer BESCHRIFTUNG"; ab jenem Tag las das niemand mehr, und Lizenz
                // wie Namensnennung waeren unsichtbar geworden.
                // ⚠️ $ergebnis['label_public_id'] wird fuer die Quellenfrage NICHT mehr gebraucht
                // -- die Beschriftung LIEST die Quellen der Flaeche, sie traegt sie nicht.
                [$entityType, $quellePublicId] = avesmapsGaretienQuellenZiel('region', $publicId);
                $jeForm['region']++;
                // 🔴 DER VERMERK TRAEGT AB HIER FLAECHE, REGION UND VERBUND -- auch OHNE Verbund
                // (dann bleibt der dritte Teil leer). Aufgabe 7 liest daran ab, ob die Ruecknahme
                // nur DIESE Flaeche oder die ganze Region wegnehmen darf; ein Fragment, dessen
                // Ruecknahme die Region loescht, risse die Geschwister-Flaechen mit.
                $vermerk = avesmapsGaretienVerbundVermerk(
                    (string) ($ergebnis['area_public_id'] ?? ''),
                    (string) $publicId,
                    $verbund
                );
            }
            // 🔴 „NUR QUELLE" LEGT NICHTS AN -- es zaehlt wie eine Ergaenzung: als `quelle`, nie als
            // `applied`. „1 Objekt importiert" behauptete sonst ein Kartenobjekt, das es nicht gibt.
            if (!$nurQuelle) {
                $angelegt++;
            }
            $neueQuellen = avesmapsGaretienQuellenAnlegen(
                $pdo, $entityType, $quellePublicId, $nach, $userId, (string) $item['entity_key']
            );
            // 🔴 NACHBESSERUNG 1 (W1/G3-2): NUR bei einer WIRKLICH NEUEN Verknuepfung zaehlt es als
            // `quelle` -- `$neueQuellen > 0` allein sagt nur „avesmapsGaretienQuelleAnlegen hat
            // ja geantwortet", nicht „es ist etwas Neues entstanden" (Sonde a/b des Nachtrags:
            // ein Sammelartikel oder die eigene Adresse der Stadt liessen es sonst je Bauwerk neu
            // zaehlen, obwohl real nur EINE Verknuepfung existiert). „1 Quelle ergaenzt" waere
            // sonst eine Falschaussage -- der Hinweis traegt stattdessen die Wahrheit.
            if ($nurQuelle) {
                if ($nurQuelleWarNeu) {
                    $jeForm['quelle']++;
                } elseif ($nurQuelleArtikelUrl !== '') {
                    $hinweise[] = [
                        'item' => (int) $item['id'],
                        'text' => 'Quelle an "' . (string) ($innerortsOrt['name'] ?? $quellePublicId) . '" war schon vorhanden.',
                    ];
                }
            }
            if ($neueQuellen > 0) {
                $quellen += $neueQuellen;
                $quellenNeu[$entityType . ':' . $quellePublicId] = [
                    'entity_type' => $entityType,
                    'public_id' => $quellePublicId,
                ];
            }
            avesmapsGaretienItemAbschliessen($pdo, (int) $item['id'], 'done', $vermerk ?? $publicId, $userId);
        } catch (Throwable $abbruch) {
            // 🔴 Ein Fehlschlag bei EINEM Objekt haelt die uebrigen nicht auf, aber er wird
            // benannt. Ein stiller Ueberspringer waere von "wurde angelegt" nicht zu
            // unterscheiden -- und die Zahl im Ergebnis waere eine Behauptung.
            // 🔴 GEKAPPT WIE `apply_note` -- siehe die Begruendung am ersten Fehlschlagfang
            // dieser Funktion.
            $fehler[] = ['item' => (int) $item['id'], 'grund' => mb_substr($abbruch->getMessage(), 0, 300, 'UTF-8')];
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
    $quellenRueck = avesmapsGaretienQuellenNachtrag($pdo, $quellenNeu, $userId);

    return [
        'angelegt' => $angelegt, 'quellen' => $quellen, 'fehler' => $fehler,
        'quellen_neu' => $quellenRueck, 'angelegt_je_form' => $jeForm, 'hinweise' => $hinweise,
    ];
}

/**
 * EIN Item zurueck auf „offen" -- der EINE Weg, und er ist es seit dem 31.08.2026.
 *
 * 🔴 ZWEI DINGE, NICHT EINES. Das Haekchen und der Lauf-Vermerk stehen an `sync_plan_item`, der
 * DAUERHAFTE Uebernahme-Vermerk an `sync_decision.applied_at`. Wer nur das erste zuruecksetzt,
 * nimmt das Objekt von der Karte und laesst es trotzdem im Reiter „Uebernommen" stehen --
 * `avesmapsGaretienListeObjektStand` liest beide („zwei Wege zu uebernommen") und der zweite
 * gewinnt. Genau so war es vom 30.08. bis zum 31.08.2026: die Ruecknahme sah aus, als haette sie
 * nicht gewirkt.
 *
 * 💣 UND SIE STEHT HIER, NICHT AN DEN AUFRUFSTELLEN. `avesmapsGaretienRuecknahmeAusfuehren`
 * setzt an ZWEI Stellen zurueck (der 'quelle'-only-Zweig und der 'new'-Zweig) -- dieselbe
 * Bauform und derselbe Grund wie bei `avesmapsGaretienItemAbschliessen`, das den Vermerk SETZT.
 * Eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel.
 */
/**
 * Hat der Editor „Innerorts einfuegen" gedrueckt? REIN, kein I/O.
 */
function avesmapsGaretienInnerortsGewuenscht(?array $einstellungen): bool
{
    // 🔴 NUR AUF AUSDRUECKLICHEN WUNSCH. „Alle angezeigten einfuegen" schickt gar keine
    // Einstellungen -- ein Sammellauf legt also NIE eine Staette an, sondern immer das, was er
    // bisher angelegt hat. Der Knopf „Innerorts einfuegen (X)" ist eine Einzelhandlung, und das
    // ist der Owner-Entscheid: der Importer schlaegt vor, er entscheidet nicht.
    // 🔴 „NUR QUELLE + ARTIKEL AN X" IST EBENFALLS EIN INNERORTS-WUNSCH (Entwurf 14.09.2026, §5).
    // Stuende `innerorts_nur_quelle` allein im Rumpf und zaehlte hier nicht, fiele das Objekt still
    // auf die KARTE zurueck -- genau der Rueckfall, den der Innerorts-Zweig ausdruecklich verbietet.
    return is_array($einstellungen)
        && (($einstellungen['innerorts'] ?? false) === true || ($einstellungen['innerorts_nur_quelle'] ?? false) === true);
}

/**
 * Soll der Innerorts-Befund NUR Quelle und Artikel an die Siedlung haengen -- ohne Staette? REIN.
 *
 * 🔴 Die kleinere Antwort auf denselben Befund (Workflow-Owner 12.09.2026/7): keine neue Zeile,
 * weder in `settlement_place` noch in `map_features`. ⚠️ Nur ein echtes `true` zaehlt.
 */
function avesmapsGaretienInnerortsNurQuelle(?array $einstellungen): bool
{
    return is_array($einstellungen) && ($einstellungen['innerorts_nur_quelle'] ?? false) === true;
}

/**
 * Der Vermerk eines „Nur Quelle"-Items. 💣 NIE DIE NACKTE public_id DER SIEDLUNG: die Ruecknahme
 * eines 'new'-Items mit Ziel `location` loescht die public_id aus dem Vermerk ueber
 * avesmapsDeleteMapFeature -- sie naehme die STADT von der Karte, an die nur eine Quelle gehaengt
 * wurde. Das Praefix macht den Vermerk fuer jeden Loeschweg unverwechselbar.
 * ⚠️ avesmapsGaretienVermerkLesen liest ihn als „kein Verbund, keine Region" (unbekanntes Feld) --
 * der Artikel-Nachzug und der Verbund-Leser gehen damit an ihm vorbei, wie gewollt.
 *
 * 🔴 NACHBESSERUNG 1 (14.09.2026, W1): TRAEGT SEITHER EIN ZWEITES FELD, `| angelegt:0` oder
 * `| angelegt:1`. Zwei Bauwerke koennen dieselbe Artikeladresse an dieselbe Siedlung haengen (ein
 * Sammelartikel), und avesmapsGaretienQuelleAnlegen gibt fuer BEIDE `true` zurueck -- fuer das
 * erste, weil die Verknuepfung neu entsteht, fuer das zweite, weil sie schon UNS gehoert und nur
 * ihre Notiz aufgefrischt wird. Ohne dieses Feld war nicht zu unterscheiden, welches Item die
 * Verknuepfung wirklich angelegt hat: die Ruecknahme des ERSTEN loeschte sie fuer BEIDE, das
 * zweite Item blieb `done` und zeigte auf eine Quelle, die es nicht mehr gab.
 * ⚠️ `angelegt` wird VORHER gelesen (avesmapsGaretienQuelleHaengtSchonAn), nicht aus dem
 * Rueckgabewert des Upserts geschlossen -- der kennt den Unterschied nicht.
 */
const AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK = 'nur_quelle:';
const AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK_TRENNER = ' | angelegt:';

function avesmapsGaretienNurQuelleVermerk(string $siedlungPublicId, bool $warNeu): string
{
    return AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK . $siedlungPublicId
        . AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK_TRENNER . ($warNeu ? '1' : '0');
}

/**
 * Die Siedlung aus einem „Nur Quelle"-Vermerk, sonst ''. REIN.
 *
 * 🔴 SCHNEIDET DAS `| angelegt:N`-FELD AB (seit Nachbesserung 1), das
 * avesmapsGaretienNurQuelleVermerk anhaengt -- ohne den Schnitt truege die "Siedlung" den Rest
 * des Vermerks als vermeintliche public_id mit. Ein alter, nackter Vermerk ohne dieses Feld
 * (Bestand VOR Nachbesserung 1 -- live gibt es keinen, weil Aufgabe 8 nie live war) bleibt
 * unveraendert lesbar.
 */
function avesmapsGaretienNurQuelleAusVermerk(string $note): string
{
    $n = trim($note);
    if (!str_starts_with($n, AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK)) {
        return '';
    }
    $rest = substr($n, strlen(AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK));
    $trennPos = strpos($rest, AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK_TRENNER);

    return trim($trennPos === false ? $rest : substr($rest, 0, $trennPos));
}

/**
 * Wurde die Verknuepfung dieses „Nur Quelle"-Items WIRKLICH neu angelegt? `null`, wenn der
 * Vermerk kein `angelegt`-Feld traegt (ein Vermerk von VOR Nachbesserung 1). REIN.
 *
 * 💣 `null` IST NICHT `false`: ein alter, nackter Vermerk ohne dieses Feld ist ein UNBEKANNTER
 * Zustand, kein „nicht angelegt" -- die Ruecknahme muss beide Faelle unterscheiden koennen. Die
 * sichere Richtung gilt: bei `null` wird NICHTS geloest (siehe avesmapsGaretienRuecknahmeAusfuehren).
 */
function avesmapsGaretienNurQuelleAngelegtAusVermerk(string $note): ?bool
{
    $n = trim($note);
    $pos = strpos($n, AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK_TRENNER);
    if ($pos === false) {
        return null;
    }

    return trim(substr($n, $pos + strlen(AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK_TRENNER))) === '1';
}

/**
 * Ein Ort der Karte, so wie er JETZT dasteht -- oder null, wenn es ihn nicht gibt.
 *
 * 💣 Der Innerorts-Befund ist ein SCHNAPPSCHUSS des Planbaus. Eine seither geloeschte Stadt bekaeme
 * sonst eine Staette oder eine Verknuepfung, die kein Leser je findet -- und die Quelle mit ihrer
 * Lizenzangabe waere verloren, ohne dass es jemand merkt.
 * ⚠️ Gelesen wird OHNE `is_active`-Filter: ein geloeschter Ort soll im Abbruchgrund beim NAMEN
 * genannt werden, nicht als nackte public_id.
 *
 * @return ?array{name:string, klasse:string, aktiv:bool}
 */
function avesmapsGaretienSiedlungLesen(PDO $pdo, string $publicId): ?array
{
    $stmt = $pdo->prepare(
        "SELECT name, feature_subtype, is_active FROM map_features WHERE public_id = :p AND feature_type = 'location' LIMIT 1"
    );
    $stmt->execute([':p' => $publicId]);
    $zeile = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($zeile)) {
        return null;
    }

    return [
        'name' => (string) ($zeile['name'] ?? ''),
        'klasse' => (string) ($zeile['feature_subtype'] ?? ''),
        'aktiv' => (int) ($zeile['is_active'] ?? 0) === 1,
    ];
}

/**
 * Ist diese Ortsklasse eine SIEDLUNG? Die POSITIVE Frage, nicht die Verneinung von
 * avesmapsIstBauwerksklasse. REIN.
 *
 * 🔴 NACHBESSERUNG 1 (G2). `!avesmapsIstBauwerksklasse($klasse)` beantwortet „ist es KEIN
 * Bauwerk", nicht „ist es eine Siedlung" -- eine leere, unbekannte oder Kreuzungs-Klasse ist
 * beides nicht und kam durch die Verneinung trotzdem als „Siedlung" durch. Diese Funktion baut
 * KEINE zweite Liste: sie iteriert avesmapsGaretienSiedlungsFamilie() (garetien-abgleich.php),
 * dieselbe Liste, die auch die Innerorts-Kandidatensuche benutzt (`AVESMAPS_ORTSKLASSEN` ohne die
 * Bauwerksklassen) -- nur eine Siedlungsklasse aus DIESER Liste zaehlt.
 */
function avesmapsGaretienIstSiedlungsklasse(string $klasse): bool
{
    foreach (avesmapsGaretienSiedlungsFamilie() as $eintrag) {
        if (($eintrag[1] ?? null) === $klasse) {
            return true;
        }
    }

    return false;
}

/**
 * Haengt diese Adresse (mit `origin='garetien'`) SCHON an diesem Objekt? Reiner Lese-Check, kein
 * Schreibvorgang.
 *
 * 🔴 NACHBESSERUNG 1 (W1): GERUFEN, BEVOR avesmapsGaretienQuellenAnlegen laeuft -- „neu entstanden"
 * muss VORHER gelesen werden, nicht aus dem Rueckgabewert des Upserts GESCHLOSSEN werden.
 * avesmapsGaretienQuelleAnlegen gibt `true` in ZWEI Faellen zurueck: die Verknuepfung entsteht neu,
 * ODER sie gehoert schon uns (`origin='garetien'`) und wird nur aufgefrischt -- von aussen nicht zu
 * unterscheiden. Zwei Bauwerke mit demselben Sammelartikel, oder ein Bauwerk, dessen Artikel die
 * eigene Adresse der Siedlung ist, lieferten sonst fuer BEIDE (bzw. fuer das zweite) `true`, obwohl
 * real nichts Neues hinzukam.
 * ⚠️ KEIN EIGENES ENSURE: erreicht wird diese Funktion nur innerhalb einer laufenden Uebernahme
 * (avesmapsGaretienApplyStep ruft avesmapsEnsureFeatureSourceTables an seinem Kopf, VOR
 * avesmapsGaretienUebernehmen), bzw. in Tests, deren Pruefstand die Tabellen schon traegt --
 * dieselbe Voraussetzung wie bei avesmapsGaretienQuelleAnlegen selbst, die ebenfalls kein eigenes
 * Ensure ruft.
 */
function avesmapsGaretienQuelleHaengtSchonAn(PDO $pdo, string $entityType, string $entityPublicId, string $url): bool
{
    $url = trim($url);
    if ($url === '') {
        return false;
    }
    $stmt = $pdo->prepare(
        'SELECT 1 FROM feature_sources fs JOIN sources s ON s.id = fs.source_id'
        . ' WHERE fs.entity_type = :t AND fs.entity_public_id = :id AND fs.origin = :o AND s.url_hash = :h LIMIT 1'
    );
    $stmt->execute([
        't' => $entityType,
        'id' => $entityPublicId,
        'o' => AVESMAPS_GARETIEN_SOURCE_ORIGIN,
        'h' => avesmapsFeatureSourceHash($url),
    ]);

    return $stmt->fetchColumn() !== false;
}

/**
 * Ein Wert, SQL-sicher fuer eine LIKE-Anfrage escaped (`\`, `%`, `_`). REIN.
 *
 * 🔴 NACHBESSERUNG 2 (G-Perf): eine public_id ist nicht garantiert frei von `%`/`_` -- ungeschuetzt
 * wuerden diese Zeichen als LIKE-Platzhalter gelesen und das Muster koennte fremde Zeilen treffen.
 * `ESCAPE '\'` an der Aufrufstelle macht `\` zum Fluchtzeichen, ein vorhandenes `\` muss deshalb
 * zuerst selbst escaped werden -- sonst entkommt das naechste Zeichen versehentlich mit.
 */
function avesmapsGaretienLikeEscape(string $wert): string
{
    return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $wert);
}

/**
 * Traegt DIESE sync_plan_item-Zeile (aus einer Traeger-Abfrage, mit `after_json`+`entity_key`)
 * die genannte Adresse? REIN.
 *
 * 🔴 NACHBESSERUNG 2 (Ruling 4): „UNBEKANNTE ADRESSE = TRAEGER" -- kann die Adresse dieser Zeile
 * NICHT bestimmt werden (kein lesbares `after_json`, oder avesmapsGaretienQuellenAdressenAus
 * liefert nichts), zaehlt sie als Traeger JEDER Adresse an dieser Entitaet: geloest wird dann
 * nichts, was sie tragen koennte. Nur eine ERFOLGREICH bestimmte, ANDERE Adresse gilt als „kein
 * Traeger dieser Adresse".
 * ⭐ DIESELBE ADRESSRECHNUNG WIE BEIM SCHREIBEN (avesmapsGaretienQuellenAnlegen via
 * avesmapsGaretienQuellenAdressenAus): der Artikel schlaegt die Sammelquelle, nie beide
 * gleichzeitig -- ein Item traegt hoechstens EINE Adresse.
 */
function avesmapsGaretienItemTraegtAdresse(array $zeile, string $url): bool
{
    $nach = json_decode((string) ($zeile['after_json'] ?? ''), true);
    if (!is_array($nach)) {
        return true; // unbekannt -- sichere Richtung
    }
    $wirt = (array) ($nach['quelle'] ?? []);
    $artikel = avesmapsGaretienArtikelQuelleAusItem($nach, (string) ($zeile['entity_key'] ?? ''));
    $adressen = avesmapsGaretienQuellenAdressenAus((string) ($wirt['url'] ?? ''), $artikel);
    if ($adressen === []) {
        return true; // unbekannt -- sichere Richtung
    }

    return in_array($url, $adressen, true);
}

/**
 * Traegt noch ein ANDERES `done`-Item DIESELBE ADRESSE AN DERSELBEN ENTITAET? Vereinigt BEIDE
 * Rueckwege, die eine garetien-Verknuepfung teilen koennen (Nachbesserung 2, Pruefer-Befund gegen
 * `5397ce079`):
 *   · „Nur Quelle"-Geschwister (Vermerk `nur_quelle:<siedlung>`, immer entity_type='settlement')
 *   · eigene `changed`-Quelle-Items DERSELBEN Entitaet (die die Quelle an SICH SELBST ergaenzt
 *     haben -- `change_type='changed'`, `after.felder === ['quelle']`)
 *
 * 🔴 EINE Traegerfunktion, ZWEI Aufrufer -- keine zweite Fassung (avesmapsGaretienRuecknahmeAusfuehren,
 * `new`-Zweig fuer „Nur Quelle" UND `changed`-Zweig fuer die eigene Ergaenzung). Eine Siedlung ist
 * seit „Nur Quelle" KEIN alleiniger Besitzer ihrer garetien-Verknuepfungen mehr: sie teilt sie mit
 * jedem Bauwerk, das per „Nur Quelle" an sie gehaengt hat -- und umgekehrt kann ihr eigenes
 * `changed`-Quelle-Item dieselbe Adresse tragen wie ein Bauwerk. Vorher kannte die Nur-Quelle-Suche
 * nur Nur-Quelle-Geschwister: die Ruecknahme von Wandlethes EIGENEM `changed`-Quelle-Item loeschte
 * darum jede Bauwerks-Verknuepfung mit (der alte, blinde `avesmapsGaretienQuelleRuecknahmeLoesen`),
 * und umgekehrt sah die Bauwerks-Ruecknahme Wandlethes eigenes Item nicht als Traeger.
 *
 * 💣 DIE GRUPPE UEBERLEBT EINE RUECKNAHME NICHT (avesmapsGaretienItemZurueckAufOffen loescht
 * `apply_note`) -- diese Funktion entscheidet deshalb nur ZUM ZEITPUNKT der Anfrage, nie rueckwirkend.
 *
 * 🔴 REIHENFOLGE-UNABHAENGIG INNERHALB EINES MENGENAUFRUFS: `$ausgenommeneItemIds` nimmt die GANZE
 * angefragte id-Liste (nicht nur das eine gerade gepruefte Item). Ohne das saehe ein spaeter in
 * DERSELBEN Schleife verarbeitetes Geschwister das FRUEHER schon zurueckgenommene (und damit nicht
 * mehr `done`) nicht mehr als Traeger -- das Ergebnis haenge dann von der zufaelligen `id`-Reihenfolge
 * der Batch-Verarbeitung ab, nicht vom tatsaechlichen Bestand vor dem Aufruf.
 *
 * ⚠️ SQL-EINGRENZUNG AUF DIE ENTITAET (G-Perf): Gruppe 1 filtert per `LIKE` (escaped,
 * `ESCAPE '\'`) auf den Vermerk-Praefix DIESER Siedlung, Gruppe 2 per Gleichheit auf
 * `entity_public_id` -- dekodiert wird nur, was danach uebrig bleibt, nicht mehr JEDES `done`-Item
 * des ganzen Imports ueber alle Laeufe.
 * ⚠️ KEINE DOPPELTEN PLATZHALTER (MySQL, ATTR_EMULATE_PREPARES=false).
 *
 * @param list<int> $ausgenommeneItemIds
 */
function avesmapsGaretienAndererTraegerVorhanden(PDO $pdo, string $entityType, string $entityPublicId, string $url, array $ausgenommeneItemIds): bool
{
    $entityPublicId = trim($entityPublicId);
    $url = trim($url);
    if ($entityPublicId === '' || $url === '') {
        return false;
    }
    $ausschluss = array_map('intval', $ausgenommeneItemIds);

    // Gruppe 1: „Nur Quelle"-Geschwister -- nur relevant, wenn diese Entitaet eine Siedlung ist
    // (Nur Quelle bindet ausschliesslich an entity_type='settlement', avesmapsGaretienQuellenZiel).
    if ($entityType === 'settlement') {
        $muster = AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK . avesmapsGaretienLikeEscape($entityPublicId) . '%';
        // 🔴 SCHLUSSPRUEFUNG, BEFUND W1: HAUS-IDIOM `ESCAPE '\\\\'` (vier Backslash im PHP-
        // Doppelstring), NICHT `'\\'`. MySQL liest zwei Backslash im SQL-Literal selbst als EIN
        // maskiertes Backslash-Zeichen -- mit nur zwei Backslash im PHP-Quelltext kaeme dort ein
        // Literal mit einem einzigen Backslash an, der seine eigene schliessende Anfuehrung
        // verschluckt (unterminiertes Literal, MySQL Error 1064; jede Ruecknahme an einer Siedlung
        // waere davon betroffen). SQLite verlangt umgekehrt genau EIN Zeichen fuer ESCAPE und wird
        // darum in den Tests eigens auf `ESCAPE '\\'` uebersetzt (AGENTS.md §9 „Ein SQLite-Test
        // kann eine MySQL-Regression ERZWINGEN"). Dasselbe Idiom in
        // api/_internal/app/feature-sources.php:2657 und in dieser Datei am Verbund-Anfuehrer.
        $stmt = $pdo->prepare(
            'SELECT i.id, i.apply_note, i.after_json, i.entity_key FROM sync_plan_item i'
            . ' JOIN sync_plan_run r ON r.id = i.run_id'
            . " WHERE r.kind = :k AND i.apply_state = 'done' AND i.apply_note LIKE :m ESCAPE '\\\\'"
        );
        $stmt->execute(['k' => AVESMAPS_GARETIEN_PLAN_KIND, 'm' => $muster]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
            if (in_array((int) $zeile['id'], $ausschluss, true)) {
                continue;
            }
            if (avesmapsGaretienNurQuelleAusVermerk((string) ($zeile['apply_note'] ?? '')) !== $entityPublicId) {
                continue; // ein LIKE-Treffer, der nach dem Dekodieren doch eine ANDERE Siedlung meint
            }
            if (avesmapsGaretienItemTraegtAdresse($zeile, $url)) {
                return true;
            }
        }
    }

    // Gruppe 2: eigene `changed`-Quelle-Items DERSELBEN Entitaet.
    $stmt = $pdo->prepare(
        'SELECT i.id, i.after_json, i.entity_key FROM sync_plan_item i'
        . ' JOIN sync_plan_run r ON r.id = i.run_id'
        . " WHERE r.kind = :k AND i.apply_state = 'done' AND i.change_type = 'changed'"
        . ' AND i.entity_public_id = :e'
    );
    $stmt->execute(['k' => AVESMAPS_GARETIEN_PLAN_KIND, 'e' => $entityPublicId]);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        if (in_array((int) $zeile['id'], $ausschluss, true)) {
            continue;
        }
        $nach = json_decode((string) ($zeile['after_json'] ?? ''), true);
        if (!is_array($nach)) {
            return true; // unbekannt -- sichere Richtung
        }
        $felder = (array) ($nach['felder'] ?? []);
        if (count($felder) !== 1 || $felder[0] !== 'quelle') {
            continue; // kein reines Quelle-Ergaenzungsitem -- betrifft diese Frage nicht
        }
        // 🔴 NACHBESSERUNG 3 (G-a): avesmapsGaretienQuellenZiel WIRFT bei leerem/unbekanntem `ziel`
        // (siehe dessen eigener Docblock, garetien-plan.php) -- eine FREMDE, kaputte Zeile liesse
        // sonst die Ruecknahme eines voellig unbeteiligten Items scheitern. Dieselbe sichere
        // Richtung wie „unbekannte Adresse = Traeger": ein unaufloesbares Ziel wird als Traeger
        // gezaehlt, statt die Anfrage zu Fall zu bringen.
        try {
            [$rowEntityType] = avesmapsGaretienQuellenZiel((string) ($nach['ziel'] ?? ''), $entityPublicId);
        } catch (Throwable) {
            return true; // unbekannt -- sichere Richtung
        }
        if ($rowEntityType !== $entityType) {
            continue; // Gleichstand der rohen id, aber ein anderer Zielraum -- kein echter Treffer
        }
        if (avesmapsGaretienItemTraegtAdresse($zeile, $url)) {
            return true;
        }
    }

    return false;
}

/**
 * Die Garetien-Verknuepfung EINER Adresse an EINEM Objekt loesen -- nicht alle des Objekts.
 *
 * 🔴 AN EINER ENTITAET HAENGEN MEHRERE GARETIEN-QUELLEN: an einer Siedlung ihre eigene und die
 * jedes Bauwerks, das „Nur Quelle + Artikel" an sie gehaengt hat; an einer Region die jedes
 * Fragments UND die eines eigenstaendigen `changed`-Quelle-Items (Nachbesserung 3). Ein blindes
 * „loesche alles mit `origin = 'garetien'`" (das fruehere avesmapsGaretienQuelleRuecknahmeLoesen,
 * seit Nachbesserung 3 entfernt, weil niemand mehr rief) naehme der Entitaet so die Verknuepfungen
 * ALLER anderen Traeger mit (dieselbe Klasse wie Fehler 9 des Entwurfs vom 14.09.2026).
 * 🔴 SIE WIRD NUR NOCH GERUFEN, WENN KEIN ANDERER TRAEGER MEHR ANSPRUCH HAT -- alle drei
 * Rueckwege (Nur-Quelle-Item, eigenstaendiges `changed`-Quelle-Item, letzte-Flaeche-einer-Region)
 * fragen vorher dieselbe Traegerfunktion (avesmapsGaretienAndererTraegerVorhanden). Diese Funktion
 * selbst bleibt EIN reiner Loeschweg fuer GENAU eine Adresse an GENAU einem Objekt -- sie kennt die
 * Traegerregel nicht, das ist Absicht des jeweiligen Aufrufers.
 * ⚠️ Verglichen wird ueber `url_hash` (avesmapsFeatureSourceHash), dieselbe Kennung, unter der der
 * Katalog die Adresse beim Anlegen abgelegt hat. NUR die Verknuepfung faellt, nie die `sources`-Zeile.
 *
 * @return int Zahl der geloesten Verknuepfungen
 */
function avesmapsGaretienQuelleRuecknahmeLoesenFuerAdresse(PDO $pdo, string $entityType, string $entityPublicId, string $url, int $userId): int
{
    $url = trim($url);
    if ($url === '') {
        return 0;
    }
    // 🔴 NACHBESSERUNG 1 (G9): KEIN EIGENES ENSURE MEHR -- geprueft am Code:
    // avesmapsRemoveFeatureSource (api/_internal/app/feature-sources.php) ruft
    // avesmapsEnsureFeatureSourceTables an seinem eigenen Kopf. Diese Funktion wird ausserdem nur
    // erreicht, nachdem eine echte Uebernahme (avesmapsGaretienApplyStep, das ebenfalls ganz am
    // Kopf ensured) den `nur_quelle:`-Vermerk ueberhaupt erst geschrieben hat -- die Tabellen
    // stehen zu diesem Zeitpunkt also in jedem Fall schon.

    $stmt = $pdo->prepare(
        'SELECT fs.source_id FROM feature_sources fs JOIN sources s ON s.id = fs.source_id'
        . ' WHERE fs.entity_type = :t AND fs.entity_public_id = :id AND fs.origin = :o AND s.url_hash = :h'
    );
    $stmt->execute([
        't' => $entityType,
        'id' => $entityPublicId,
        'o' => AVESMAPS_GARETIEN_SOURCE_ORIGIN,
        'h' => avesmapsFeatureSourceHash($url),
    ]);

    $geloest = 0;
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $sourceId) {
        avesmapsRemoveFeatureSource($pdo, $entityType, $entityPublicId, (int) $sourceId, $userId);
        $geloest++;
    }

    return $geloest;
}

/**
 * DER RIEGEL „BEIDES" -- REIN (Entwurf 2026-09-14-garetien-import-vereint-design.md §5).
 *
 * 💣 Ein `apply` mit einem Neu-Item (`change_type = 'new'`, auch das Zusatz-Item „trotzdem neu") UND
 * einem Ergaenzungs-Item (`changed`) DESSELBEN Objekts legt eine Dublette an UND haengt die
 * Garetien-Quelle an den Bestand (K6: „Neu einfuegen" schaltete `quelle` zwangsweise mit an). Das ist
 * nur als ausdrueckliche Wahl „Auf die Karte -- zusaetzlich zu X" erlaubt, und die steht als
 * `beides: true` im Rumpf JEDES beteiligten Items.
 * ⚠️ Ohne die Ausnahme wiese der Riegel genau die Wahl ab, die ihn braucht.
 * 🔴 „Dasselbe Objekt" ist die Objektbasis (avesmapsGaretienObjektSchluessel) -- dieselbe Formel, an
 * der Arbeitsliste und Rueckfall-Suche ein Objekt erkennen, keine zweite.
 * ⚠️ Nur ein echtes `true` bestaetigt: "true" oder 1 kommen nicht aus der Zielwahl.
 *
 * @param list<array{id:int|string, entity_key:string, change_type:string, label?:string}> $items
 * @param array<int, array> $jeItem die Handeingaben je Item (avesmapsGaretienEinstellungenJeItemAusRumpf)
 * @return ?string der Grund der Absage, oder null
 */
function avesmapsGaretienBeidesRiegel(array $items, array $jeItem): ?string
{
    $jeBasis = [];
    foreach ($items as $item) {
        $basis = avesmapsGaretienObjektSchluessel((string) ($item['entity_key'] ?? ''));
        $jeBasis[$basis]['arten'][(string) ($item['change_type'] ?? '')] = true;
        $jeBasis[$basis]['ids'][] = (int) ($item['id'] ?? 0);
        if (!isset($jeBasis[$basis]['label'])) {
            $jeBasis[$basis]['label'] = (string) ($item['label'] ?? '');
        }
    }
    foreach ($jeBasis as $basis => $gruppe) {
        if (!isset($gruppe['arten']['new'], $gruppe['arten']['changed'])) {
            continue;
        }
        foreach ($gruppe['ids'] as $id) {
            if ((($jeItem[$id] ?? [])['beides'] ?? null) === true) {
                continue;
            }
            $name = avesmapsGaretienAnzeigeNameAusSchluessel((string) $basis);
            if ($name === '') {
                $name = $gruppe['label'] !== '' ? $gruppe['label'] : (string) $basis;
            }

            return 'Fuer "' . $name . '" stehen ein neues Objekt UND eine Aenderung am bestehenden im selben Import'
                . ' -- das braucht die ausdrueckliche Wahl "Auf die Karte -- zusaetzlich" (beides).';
        }
    }

    return null;
}

/**
 * Der Riegel „beides" an der Tuer: die Zeilen dieses Laufs selbst lesen, dann rein pruefen.
 *
 * 🔴 GEZAEHLT WIRD NUR, WAS DIESES `apply` SCHREIBEN WUERDE -- dieselbe Menge wie
 * avesmapsGaretienPendingItemsScoped (`selected = 1 AND apply_state IS NULL`). Eine ABGELEHNTE Zeile
 * (die Tuer 'decline' hakt sie ab) bleibt abgelehnt und macht kein Paar; ein in einem frueheren
 * Haeppchen schon uebernommenes Item ebenso wenig.
 * 💣 Gefiltert wird auf den LAUF -- eine fremde id koennte sonst ein Paar vortaeuschen.
 * ⚠️ KEIN DDL: die Tuer hat den Lauf gerade gelesen, die Tabelle steht.
 *
 * @param list<int> $itemIds
 * @param ?array<int, array> $jeItem
 */
function avesmapsGaretienBeidesPruefen(PDO $pdo, int $runId, array $itemIds, ?array $jeItem): ?string
{
    $itemIds = array_values(array_unique(array_filter(
        array_map('intval', $itemIds),
        static fn(int $id): bool => $id > 0
    )));
    if ($runId <= 0 || $itemIds === []) {
        return null;
    }
    $platzhalter = implode(',', array_fill(0, count($itemIds), '?'));
    $stmt = $pdo->prepare(
        'SELECT id, entity_key, change_type, label FROM sync_plan_item'
        . ' WHERE run_id = ? AND id IN (' . $platzhalter . ') AND selected = 1 AND apply_state IS NULL'
    );
    $stmt->execute(array_merge([$runId], $itemIds));

    return avesmapsGaretienBeidesRiegel($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [], $jeItem ?? []);
}

/**
 * Der Innerorts-Befund EINES Vorschlags -- oder null. REIN, kein I/O.
 *
 * 💣 GELESEN, NICHT GERECHNET. Der Befund entsteht im Planbau ueber den ganzen Ortsbestand
 * (avesmapsGaretienInnerortsBefund, garetien-abgleich.php); ihn hier noch einmal zu rechnen waere
 * eine zweite Wahrheit darueber, zu welcher Stadt ein Objekt gehoert -- und der Editor hat den
 * Ortsnamen auf dem Knopf gelesen, den DIESER Befund beschriftet hat. Ein zweiter Rechner koennte
 * eine andere Stadt liefern als die, die im Knopf stand.
 *
 * ⚠️ Beides muss da sein: ohne `public_id` gaebe es keine Bindung, ohne Namen keine Anzeige.
 *
 * 🔴 SEIT DEM 14.09.2026 IST DAS NUR NOCH DIE VORAUSWAHL DES LAUFS. Die Wahl des Editors
 * (`innerorts_public_id`) prueft avesmapsGaretienInnerortsSiedlung gegen die KARTE, nicht mehr
 * gegen die `kandidaten` dieses Vorschlags -- siehe die Begruendung dort.
 *
 * @return array{public_id:string, name:string}|null
 */
function avesmapsGaretienInnerortsAusVorschlag(array $nach): ?array
{
    $befund = $nach['innerorts'] ?? null;
    if (!is_array($befund)) {
        return null;
    }

    $publicId = trim((string) ($befund['public_id'] ?? ''));
    $name = trim((string) ($befund['name'] ?? ''));

    return ($publicId !== '' && $name !== '') ? ['public_id' => $publicId, 'name' => $name] : null;
}

/**
 * IN WELCHE SIEDLUNG gehoert die Staette bzw. die Quelle? Die EINE Stelle, die das entscheidet.
 *
 * 🔴 EINE AUSDRUECKLICHE WAHL GILT (Entwurf 2026-09-14-garetien-import-vereint-design.md §5). Steht
 * `innerorts_public_id` im Rumpf, wird GENAU diese Siedlung genommen -- auch wenn sie nicht in den
 * `kandidaten` des Laufs steht. Das ist der Normalfall des Umkreis-Spinners: er findet Siedlungen,
 * die der Planbau (5 Meilen) nie gesehen hat, und die frische Kandidatenliste
 * (avesmapsGaretienInnerortsKandidatenFrisch) kennt Siedlungen, die es beim Planbau noch nicht gab.
 * 💣 BIS ZUM 14.09.2026 FIEL EINE SOLCHE WAHL STILL AUF DIE VORAUSWAHL ZURUECK. Die Zielwahl haette
 * „Staette in Rallerfurt" gezeigt, angelegt worden waere sie in Wandleth -- eine Handlung, die etwas
 * anderes tut, als sie sagt.
 * 💣 GEPRUEFT WIRD SIE TROTZDEM, NUR AN DER KARTE: der Ort muss existieren, AKTIV sein und eine
 * SIEDLUNG sein -- gefragt wird die POSITIVE Liste avesmapsGaretienSiedlungsFamilie()
 * (avesmapsGaretienIstSiedlungsklasse), nicht die Verneinung von avesmapsIstBauwerksklasse.
 * 🔴 NACHBESSERUNG 1 (G2): `!avesmapsIstBauwerksklasse($klasse)` liess eine LEERE, UNBEKANNTE oder
 * Kreuzungs-Klasse durchgehen -- keine davon ist ein Bauwerk, keine davon ist eine Siedlung. Die
 * positive Liste kennt nur die Klassen aus AVESMAPS_ORTSKLASSEN, alles andere faellt heraus.
 * Sonst bricht das Item LAUT ab, mit einem Satz, der die Wahl beim Namen nennt -- und es wird NIE
 * eine andere Siedlung genommen.
 * ⚠️ OHNE WAHL (alter Client, Bestand, Sammellauf) gilt die Vorauswahl des Laufs wie bisher. Sie wird
 * nur bei „Nur Quelle" an der Karte geprueft (`$mussAufDerKarteLiegen`): eine Staette legt
 * avesmapsSettlementPlaceAdd seit jeher auch an einer Vorauswahl an, und das bleibt fuer den Bestand
 * so.
 *
 * @return array{public_id:string, name:string}
 * @throws RuntimeException wenn es keine gueltige Siedlung gibt
 */
function avesmapsGaretienInnerortsSiedlung(PDO $pdo, array $nach, ?array $einstellungen, string $label, bool $mussAufDerKarteLiegen = false): array
{
    $gewaehlt = trim((string) ($einstellungen['innerorts_public_id'] ?? ''));
    if ($gewaehlt !== '') {
        $siedlung = avesmapsGaretienSiedlungLesen($pdo, $gewaehlt);
        $genannt = ($siedlung !== null && $siedlung['name'] !== '') ? $siedlung['name'] : $gewaehlt;
        if ($siedlung === null || !$siedlung['aktiv']) {
            throw new RuntimeException(
                'Die gewaehlte Siedlung "' . $genannt . '" fuer "' . $label . '" liegt nicht (mehr) auf der Karte'
                . ' -- es wird keine andere genommen. Die Zielwahl muss neu gesetzt werden.'
            );
        }
        if (!avesmapsGaretienIstSiedlungsklasse($siedlung['klasse'])) {
            throw new RuntimeException(
                'Die gewaehlte Siedlung "' . $genannt . '" fuer "' . $label . '" ist keine Siedlung'
                . ' (Bauwerk oder unbekannte Art) -- es wird keine andere genommen.'
                . ' Die Zielwahl muss neu gesetzt werden.'
            );
        }

        return ['public_id' => $gewaehlt, 'name' => $siedlung['name']];
    }

    $vorauswahl = avesmapsGaretienInnerortsAusVorschlag($nach);
    if ($vorauswahl === null) {
        throw new RuntimeException(
            'Fuer "' . $label . '" gibt es keinen Innerorts-Befund'
            . ' -- der Vorschlag stammt aus einem Lauf vor dem 02.09.2026 oder es liegt'
            . ' keine Ortschaft innerhalb von '
            . rtrim(rtrim(number_format(AVESMAPS_GARETIEN_INNERORTS_MEILEN, 1, ',', ''), '0'), ',')
            . ' Meilen. Ein "Holen & Rechnen" rechnet den Befund neu.'
        );
    }
    if ($mussAufDerKarteLiegen) {
        $siedlung = avesmapsGaretienSiedlungLesen($pdo, $vorauswahl['public_id']);
        if ($siedlung === null || !$siedlung['aktiv']) {
            throw new RuntimeException(
                'Die Siedlung "' . $vorauswahl['name'] . '" liegt nicht mehr auf der Karte'
                . ' -- die Quelle von "' . $label . '" haette kein Ziel.'
            );
        }
    }

    return $vorauswahl;
}

/**
 * Die STROEMUNGSRICHTUNG, die dieser Vorschlag mitbringt -- oder `null`. REIN, kein I/O.
 *
 * 🔴 NUR EIN FLUSSWEG HAT EINE. Eine Reichsstrasse mit `flow.dir` waere kein harmloser Zusatz: die
 * Reisezeit liest den Stroemungsfaktor (avesmapsPathFlowNormalize setzt 2,0 als Vorgabe), und ein
 * gerichteter Landweg waere in einer Richtung doppelt so teuer.
 *
 * ⚠️ DER EDITOR ENTSCHEIDET, NICHT DER IMPORT. Ohne Handeingabe steht `forward` -- die Richtung, in
 * der die Quelle ihre Punkte aufzaehlt. Das ist eine ANNAHME, und genau deshalb zeigt das Fenster
 * sie als Dreiecke an und laesst sie drehen (Owner 02.09.2026: „wobei der editor die richtung
 * korrigieren können sollte").
 */
function avesmapsGaretienFlussrichtungAus(array $nach, ?array $einstellungen): ?array
{
    if ((string) ($nach['subtyp'] ?? '') !== 'Flussweg') {
        return null;
    }
    $dir = trim((string) ($einstellungen['flow_dir'] ?? ''));
    if ($dir !== 'forward' && $dir !== 'reverse') {
        $dir = 'forward';
    }

    return ['dir' => $dir, 'source' => 'editor'];
}

/**
 * Setzt dieser Vorschlag Kreuzungen an seine beiden Enden?
 *
 * 🔴 VORGABE JA (Owner 02.09.2026: „ein haekchen (standard: an) … dass an dessen anfang und ende je
 * eine neue kreuzung platziert"). Ein importierter Weg ohne Endknoten haengt im Routennetz an
 * nichts: `avesmapsAddClientCompatiblePathConnection` (api/_internal/routing/client-graph.php)
 * verwirft jeden Weg, dessen Endpunkt auf keinem bekannten Ort und keiner Kreuzung liegt -- der Weg
 * waere gezeichnet und fuer die Routenfindung nicht vorhanden.
 *
 * ⚠️ Der Riegel faellt im Zweifel auf JA, nicht auf nein: „Alle angezeigten einfuegen" schickt keine
 * Einstellungen, und dort ist der Anschluss ans Netz genau das, was man will.
 */
function avesmapsGaretienSetztEndkreuzungen(?array $einstellungen): bool
{
    if (!is_array($einstellungen) || !array_key_exists('endpoint_crossings', $einstellungen)) {
        return true;
    }

    return $einstellungen['endpoint_crossings'] !== false;
}

/**
 * Legt an den ZWEI Enden einer frisch importierten Linie je eine Kreuzung an.
 *
 * 💣 SIE LIEGEN AUF DEM ENDPUNKT, NICHT DANEBEN. `avesmapsAddClientCompatiblePathConnection` rundet
 * Endpunkt und Knoten auf 5 Stellen und vergleicht sie EXAKT -- eine Kreuzung einen Hauch neben dem
 * Ende verbindet nichts und sieht trotzdem richtig aus. Deshalb bekommt sie zeichengleich dieselbe
 * Koordinate.
 *
 * ⚠️ Der Anleger oeffnet je Kreuzung seine EIGENE Transaktion und hebt die Kartenrevision -- ein
 * importierter Weg kostet damit drei Revisionen statt einer. Das ist der Preis dafuer, den
 * Hausanleger zu benutzen statt hier ein zweites INSERT zu schreiben; die Alternative waere eine
 * zweite Wahrheit ueber die Form einer Kreuzung.
 *
 * ⚠️ Eine Linie, deren Enden ZUSAMMENFALLEN (ein Ring), bekommt nur EINE -- zwei Kreuzungen auf
 * demselben Punkt waeren eine Dublette, die niemand mehr auseinanderhaelt.
 *
 * @param list<array{0:float,1:float}> $punkte GeoJSON [x, y]
 * @return list<string> die angelegten public_ids
 */
function avesmapsGaretienEndkreuzungenAnlegen(PDO $pdo, array $punkte, array $user): array
{
    $n = count($punkte);
    if ($n < 2) {
        return [];
    }
    $enden = [$punkte[0], $punkte[$n - 1]];
    if (round((float) $enden[0][0], 5) === round((float) $enden[1][0], 5)
        && round((float) $enden[0][1], 5) === round((float) $enden[1][1], 5)) {
        $enden = [$enden[0]];
    }

    $ids = [];
    foreach ($enden as $ende) {
        // 💣 GETRENNTE lat/lng, UND SIE SIND VERTAUSCHT GEGENUEBER GeoJSON -- dieselbe Falle wie an
        // jedem anderen Punktschreiber dieses Moduls (AGENTS.md §5).
        $feature = avesmapsCreateCrossingFeature($pdo, [
            'lng' => (float) $ende[0],
            'lat' => (float) $ende[1],
        ], $user);
        $id = trim((string) ($feature['public_id'] ?? ($feature['feature']['public_id'] ?? '')));
        if ($id !== '') {
            $ids[] = $id;
        }
    }

    return $ids;
}

function avesmapsGaretienItemZurueckAufOffen(PDO $pdo, int $itemId): void
{
    $pdo->prepare(
        'UPDATE sync_plan_item SET apply_state = NULL, apply_note = NULL, selected = 1 WHERE id = :id'
    )->execute(['id' => $itemId]);

    $stmt = $pdo->prepare('SELECT entity_key, change_type FROM sync_plan_item WHERE id = :id');
    $stmt->execute(['id' => $itemId]);
    $zeile = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($zeile)) {
        return;
    }
    avesmapsSyncPlanForgetApplied(
        $pdo,
        AVESMAPS_GARETIEN_PLAN_KIND,
        (string) $zeile['entity_key'],
        (string) $zeile['change_type']
    );
}

/**
 * ZURUECK NACH „OFFEN" -- nur die Buchfuehrung, kein Kartenobjekt wird angefasst.
 *
 * Owner 31.08.2026: „die hier sollen zurück nach 'offen' wandern" und, nach der Frage nach den
 * Geometrien: „ich glaube geometrien haben sich nicht verändert wir wollen aber 'Übernommen'
 * zurück nach 'Offen' verschieben können."
 *
 * 🔴 DER UNTERSCHIED ZUR RUECKNAHME IST DAS OBJEKT. Die Ruecknahme LOESCHT, was der Import
 * angelegt hat; diese Funktion loescht nichts. Sie setzt `apply_state`, das Haekchen und den
 * dauerhaften Vermerk zurueck -- mehr nicht. Genau das ist der Fall, den der Owner hat: seine
 * Zeilen haben ein BESTEHENDES Objekt beschriftet oder ihm dieselbe Geometrie noch einmal
 * zugewiesen, und die Objekte sollen bleiben, wo sie sind.
 *
 * 💣 DESHALB GILT SIE NUR FUER 'changed'-ITEMS. Ein 'new'-Item hat ein Objekt ANGELEGT; es
 * einfach nach „Offen" zurueckzuschieben liesse das Objekt auf der Karte und boete an, es ein
 * zweites Mal anzulegen -- eine Dublette, und zwar eine, die niemand mehr als solche erkennt.
 * Fuer die gibt es die Ruecknahme, die beides zusammen tut.
 *
 * ⚠️ Ein Item, das nie uebernommen wurde, ist kein Fehler, sondern schon dort, wo es hin soll --
 * es wird uebersprungen, nicht beanstandet.
 *
 * @return array{verschoben:int, fehler:list<array{item:int, grund:string}>}
 */
function avesmapsGaretienZurueckAufOffen(PDO $pdo, int $runId, array $itemIds, array $user): array
{
    if ($itemIds === []) {
        return ['verschoben' => 0, 'fehler' => []];
    }
    avesmapsEnsureSyncPlanTables($pdo);

    $platzhalter = implode(',', array_fill(0, count($itemIds), '?'));
    $stmt = $pdo->prepare(
        'SELECT id, entity_key, change_type, apply_state FROM sync_plan_item'
        . ' WHERE run_id = ? AND id IN (' . $platzhalter . ') ORDER BY id'
    );
    $stmt->execute(array_merge([$runId], array_map('intval', $itemIds)));

    // 💣 „UEBERNOMMEN" HAT ZWEI QUELLEN. `apply_state = 'done'` gilt nur fuer den GERADE
    // laufenden Lauf; der dauerhafte Vermerk in `sync_decision` ueberlebt ein „Holen & Rechnen".
    // Nach einem neuen Lauf stehen die Items auf `apply_state = null` und das Objekt trotzdem in
    // „Uebernommen" -- wer nur die erste Quelle liest, verschiebt dann NICHTS und meldet Erfolg.
    $entscheidungen = avesmapsSyncPlanDecisions($pdo, AVESMAPS_GARETIEN_PLAN_KIND);

    $verschoben = 0;
    $fehler = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $item) {
        $itemId = (int) $item['id'];
        $schluessel = avesmapsSyncPlanDecisionKey(
            (string) $item['entity_key'],
            (string) $item['change_type']
        );
        $uebernommen = (string) ($item['apply_state'] ?? '') === 'done'
            || ($entscheidungen[$schluessel]['applied_at'] ?? null) !== null;
        if (!$uebernommen) {
            continue;   // steht schon offen -- kein Fehler
        }
        if ((string) $item['change_type'] !== 'changed') {
            // 🔴 Der Grund wird BENANNT und nennt den richtigen Weg. „geht nicht" allein liesse
            // den Editor raten, warum ausgerechnet dieses Objekt nicht mitkommt.
            $fehler[] = [
                'item' => $itemId,
                'grund' => 'hat ein Objekt ANGELEGT -- dafuer gibt es "Zuruecknehmen", '
                    . 'das auch das Objekt von der Karte nimmt',
            ];
            continue;
        }
        avesmapsGaretienItemZurueckAufOffen($pdo, $itemId);
        $verschoben++;
    }

    return ['verschoben' => $verschoben, 'fehler' => $fehler];
}

/**
 * Der Quellen-Nachtrag fuer den Browser: je beruehrter Entitaet die VOLLE Liste plus Etikett.
 *
 * 🔴 EIN BAUER FUER UEBERNAHME **UND** RUECKNAHME. Er stand bis zum 09.09.2026 als Rumpf in
 * avesmapsGaretienUebernehmen, und genau deshalb raeumte die Ruecknahme den Kartenspeicher NICHT
 * auf: der Owner nahm eine Uebernahme zurueck, und die Infobox zeigte die entfernten Quellen
 * weiter, bis er neu lud (gemeldet 09.09.2026 an „Burg Mardershoeh“). Serverseitig war alles
 * sauber -- es fehlte nur die Gegenrichtung dieses Nachtrags.
 *
 * 💣 DIE VOLLE LISTE, NICHT NUR UNSERE QUELLE. `syncFeatureSourcesToClientCache`
 * UEBERSCHREIBT die Quellenliste einer Entitaet. Bei einem frisch angelegten Objekt ist unsere
 * die einzige, da waere der Unterschied unsichtbar; bei einer ERGAENZUNG an einem BESTEHENDEN
 * Objekt verschwaenden dessen andere Quellen aus der Anzeige. Nach einer RUECKNAHME gilt
 * dasselbe andersherum: die Liste ist dann die VERBLIEBENE, oft leer.
 *
 * 💣 DAS KANON-ETIKETT GEHOERT DAZU (Owner-Meldung 09.09.2026, mit Bild: eine importierte
 * Landschaft trug am Kopf OFFIZIELL, waehrend ihre einzige Quelle „INOFFIZIELL │ Briefspiel“ war).
 * Ohne das Etikett faellt resolveFeatureKanon auf die Vorgabe „offiziell“ zurueck. Gebuendelt je
 * Objektart, nie je Eintrag -- avesmapsFeatureSourcesKanonFuerEines laedt Katalog UND Verweise
 * vollstaendig, in der Schleife eines Massenlaufs waere das genau die Last, vor der CLAUDE.md warnt.
 *
 * ⚠️ avesmapsListFeatureSourcesForEdit ist nicht rein: es holt unterwegs eine alte
 * `properties.other_source` in die geteilte Tabelle nach. Das ist gewollt und dieselbe Haustuer,
 * die der Quellen-Editor beim Oeffnen benutzt.
 *
 * @param list<array{entity_type:string, public_id:string}> $beruehrt entdoppelt vom Aufrufer
 */
function avesmapsGaretienQuellenNachtrag(PDO $pdo, array $beruehrt, int $userId): array
{
    $raus = [];
    foreach ($beruehrt as $eintrag) {
        $art = (string) ($eintrag['entity_type'] ?? '');
        $id = (string) ($eintrag['public_id'] ?? '');
        if ($art === '' || $id === '') {
            continue;
        }
        $raus[] = [
            'entity_type' => $art,
            'public_id' => $id,
            // ⚠️ NUR die Liste, nicht die ganze Huelle: avesmapsListFeatureSourcesForEdit
            // liefert ['ok','sources','wiki_url','revision']. Der Browser erwartet die Liste.
            'sources' => avesmapsListFeatureSourcesForEdit($pdo, $art, $id, $userId)['sources'] ?? [],
        ];
    }
    $kennungenJeArt = [];
    foreach ($raus as $eintrag) {
        $kennungenJeArt[(string) $eintrag['entity_type']][] = (string) $eintrag['public_id'];
    }
    $kanonJeArt = [];
    foreach ($kennungenJeArt as $art => $kennungen) {
        $kanonJeArt[$art] = avesmapsFeatureSourcesKanonFuerMehrere($pdo, (string) $art, $kennungen);
    }
    foreach ($raus as $i => $eintrag) {
        // 🔴 AUSDRUECKLICH gesetzt, auch als `null`: der Client loescht darauf seinen
        // Tafeleintrag. Ein FEHLENDER Schluessel hiesse dort „nicht gefragt“.
        $raus[$i]['kanon'] = $kanonJeArt[(string) $eintrag['entity_type']][(string) $eintrag['public_id']] ?? null;
    }

    return $raus;
}

/**
 * Welchen Loeschweg nimmt die Ruecknahme eines 'region'-Items?
 *
 * 🔴 EIN VERBUND-FRAGMENT GEHT UEBER SEINE FLAECHE. avesmapsDeleteEcosystemArea (api/_internal/
 * app/ecosystem.php) traegt die Kaskade schon in sich: nimmt eine Flaeche die LETZTE einer
 * Region, gehen Region und Beschriftung von selbst mit ("Was that the region's last area? Then
 * the region and its labels go with it."). Damit gibt es KEINEN Anfuehrer-Sonderfall -- das
 * letzte Fragment nimmt Region und Beschriftung von selbst mit, egal welches es ist (Entwurf §8).
 * ⚠️ OHNE VERBUND (drittes Feld leer) bleibt alles wie bisher: der ganze Regionsweg, wie vor
 * diesem Umbau.
 *
 * ⚠️ DER PARAMETER MUSS DER AUFGELOESTE VERMERK SEIN, NICHT `$item['apply_note']` ROH.
 * `avesmapsGaretienRuecknahmeAusfuehren` fuellt `$publicId` schon vor diesem Aufruf mit dem
 * RICHTIGEN Wert -- entweder dem Vermerk des aktuellen Items, oder, wenn der leer ist (ein
 * frisches Item nach einem erneuten „Holen & Rechnen", das den Vorlauf nur auf `superseded`
 * setzt, siehe avesmapsSyncPlanStartRun), dem Vermerk der AELTEREN Zeile ueber denselben
 * laufuebergreifenden Rueckfall (Suche ueber `entity_key` + `change_type = 'new'`), der auch das
 * `'path'/'location'/'label'`-Ziel schon bedient. Wer hier stattdessen `$item['apply_note']`
 * neu einliest, ignoriert genau diesen Rueckfall: das frische Item traegt dort IMMER einen
 * leeren Vermerk, `avesmapsGaretienVermerkLesen('')` liefert ueberall '', und die Weiche wirft
 * "kein Loeschziel im Vermerk" fuer einen Fall, der ohne Verbuende laengst funktionierte.
 *
 * 💣 FIXRUNDE 1, BEFUND 1: EIN VERBUND OHNE FLAECHE WIRFT, ER FAELLT NICHT AUF DEN REGIONSWEG
 * ZURUECK. `avesmapsGaretienVerbundVermerk` schreibt Flaeche, Region UND Verbund immer gemeinsam
 * -- ein Vermerk mit gesetztem `verbund`, aber leerem `area` ist heute unerreichbar (der Schreiber
 * bei avesmapsGaretienUebernehmen nutzt zwar `?? ''` ueber `$ergebnis['area_public_id']`, aber
 * `avesmapsGaretienFlaecheAnlegen` wirft vorher ueber das werfende `avesmapsGaretienPublicIdAus`,
 * statt eine leere id durchzureichen). "Heute unerreichbar" ist auf einem LOESCHWEG kein
 * Argument -- es ist die Beschreibung eines Riegels, den vorher niemand gebaut hatte. Ein
 * stummes Zurueckfallen auf `['region', $teile['region']]` waere GENAU der breite Loeschweg, den
 * dieser ganze Umbau vermeiden soll: Region, Beschriftung und ALLE Geschwister-Flaechen, obwohl
 * der Vermerk ausdruecklich einen Verbund nennt. Im Zweifel wird geworfen, nicht geraten.
 *
 * @return array{0:string,1:string} ['flaeche'|'region', public_id]
 * @throws RuntimeException wenn der Vermerk einen Verbund nennt, aber keine Flaeche
 */
function avesmapsGaretienRuecknahmeWeg(string $applyNote): array
{
    $teile = avesmapsGaretienVermerkLesen($applyNote);
    if ($teile['verbund'] !== '') {
        if ($teile['area'] === '') {
            throw new RuntimeException(
                'Verbund-Vermerk ohne Flaeche -- Ruecknahme abgebrochen, statt versehentlich die'
                . ' ganze Region samt allen Geschwister-Flaechen zu loeschen'
            );
        }

        return ['flaeche', $teile['area']];
    }

    return ['region', $teile['region']];
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
 * Die Ruecknahme entfernt hier NICHT das Objekt, sondern loest nur die EIGENE feature_sources-
 * Verknuepfung dieses Items (avesmapsGaretienQuelleRuecknahmeLoesenFuerAdresse, seit Nachbesserung
 * 2 adressgenau -- nie mehr blind alles mit origin='garetien', siehe
 * avesmapsGaretienAndererTraegerVorhanden), ueber dieselbe enge Zielauflösung wie beim Anlegen
 * (avesmapsGaretienQuellenZiel), NIEMALS die geteilte `sources`-Zeile selbst.
 *
 * 🔴 „QUELLE UND NAMEN ERGAENZEN" (Owner 15.09.2026): ↩ NIMMT BEIDES ZURUECK. Traegt das Item einen
 * Namens-Vermerk, bekommt das Objekt seinen Platzhalter zurueck (avesmapsGaretienNameZuruecksetzen) -- aber
 * nur, wenn es noch so heisst, wie der Import es genannt hat. Sonst bleibt ALLES stehen, auch die Quelle
 * (avesmapsGaretienNameRuecknahmePruefen): eine spaetere Handarbeit geht nie verloren. Die Felder bleiben
 * dabei ['quelle'] -- der Riegel oben gilt unveraendert.
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
        return ['zurueckgenommen' => 0, 'fehler' => [], 'quellen_neu' => []];
    }
    // ⚠️ avesmapsDeleteMapFeature fragt map_feature_locks direkt ab, ohne die Tabelle selbst
    // sicherzustellen (nur avesmapsAcquireMapFeatureLock tut das) -- und dieser Endpunkt laeuft
    // NICHT durch den Editor-Dispatcher, der das sonst uebernimmt (api/edit/map/features.php).
    // Idempotent, kostet also nichts, wenn sie schon da ist.
    avesmapsEnsureMapFeatureLocksTable($pdo);

    $platzhalter = implode(',', array_fill(0, count($itemIds), '?'));
    $stmt = $pdo->prepare(
        'SELECT id, entity_key, change_type, entity_public_id, after_json, apply_state, apply_note'
        . ' FROM sync_plan_item WHERE run_id = ? AND id IN (' . $platzhalter . ') ORDER BY id'
    );
    $stmt->execute(array_merge([$runId], array_map('intval', $itemIds)));

    // 🔴 „UEBERNOMMEN" HAT ZWEI QUELLEN, UND DIE RUECKNAHME KANNTE NUR EINE.
    // `apply_state = 'done'` stirbt mit dem Lauf; `sync_decision.applied_at` nicht. Nach einem
    // „Holen & Rechnen" standen die frischen Items also auf `apply_state = null`, waehrend das
    // Objekt weiter in „Uebernommen" stand -- und JEDER der drei Knoepfe verweigerte:
    // „Zuruecknehmen" und „Ablehnen" wegen dieser Pruefung, „Zurueck nach Offen" weil es nur
    // 'changed'-Items bedient. Owner 01.09.2026: „ich seh keine buttons, die so heissen."
    $entscheidungen = avesmapsSyncPlanDecisions($pdo, AVESMAPS_GARETIEN_PLAN_KIND);

    $zurueckgenommen = 0;
    // 🔴 WAS DER BROWSER NACHTRAGEN MUSS. Ohne diese Liste bleiben die entfernten Quellen
    // in der offenen Karte stehen (Owner-Meldung 09.09.2026) -- der Kartenspeicher ist eine
    // EINMALIGE Aufnahme vom Seitenstart, und die Uebernahme pflegt ihn laengst.
    // ⚠️ Entdoppelt ueber "<typ>:<id>": zwei Items koennen dasselbe Objekt beruehren.
    $beruehrt = [];
    $fehler = [];
    $istUebernommen = static function (array $item) use ($entscheidungen): bool {
        if ((string) ($item['apply_state'] ?? '') === 'done') {
            return true;
        }
        $schluessel = avesmapsSyncPlanDecisionKey(
            (string) $item['entity_key'],
            (string) $item['change_type']
        );

        return ($entscheidungen[$schluessel]['applied_at'] ?? null) !== null;
    };
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
            if (!$istUebernommen($item)) {
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
                [$entityType, $quellePublicId] = avesmapsGaretienQuellenZiel($ziel, $entityPublicId);
                if ($quellePublicId === '') {
                    throw new RuntimeException('keine Beschriftung fuer die Quellen-Verknuepfung gefunden');
                }
                // 🔴 „QUELLE UND NAMEN ERGAENZEN" (15.09.2026): der Namens-Vermerk wird VOR dem Loesen der
                // Quelle geprueft. Heisst das Objekt inzwischen anders, wirft die Pruefung, und dieses Item
                // bleibt unangetastet auf 'done' (Kopf dieser Funktion).
                [$nameVermerk, $vermerkItemId] = avesmapsGaretienNameVermerkZumItem($pdo, $item);
                if ($nameVermerk !== null) {
                    avesmapsGaretienNameRuecknahmePruefen($pdo, $ziel, $entityPublicId, $nameVermerk);
                }
                // 🔴 NACHBESSERUNG 2 (W1b, Ruling 3): NICHT MEHR BLIND ALLES MIT origin='garetien'.
                // Diese Entitaet ist seit „Nur Quelle" kein alleiniger Besitzer ihrer garetien-
                // Verknuepfungen mehr -- an ihr kann auch die Quelle eines Bauwerks haengen.
                // Geloest wird deshalb nur die EINE Adresse, die DIESES Item selbst getragen hat
                // (dieselbe Rechnung wie beim Schreiben, avesmapsGaretienQuellenAdressenAus -- der
                // Artikel schlaegt die Sammelquelle, hoechstens eine Adresse je Item), und auch die
                // nur, wenn kein anderer `done`-Traeger derselben Entitaet (Nur-Quelle-Geschwister
                // ODER ein weiteres eigenes changed-Quelle-Item) sie noch braucht.
                $wirt = is_array($nach) ? (array) ($nach['quelle'] ?? []) : [];
                $artikel = is_array($nach) ? avesmapsGaretienArtikelQuelleAusItem($nach, (string) $item['entity_key']) : null;
                $eigeneAdresse = avesmapsGaretienQuellenAdressenAus((string) ($wirt['url'] ?? ''), $artikel)[0] ?? '';
                if ($eigeneAdresse !== '') {
                    // ⚠️ Das fruehere Item, das den Namens-Vermerk traegt, ist KEIN anderer Traeger: es ist
                    // genau die Uebernahme, die hier zurueckgeht.
                    $andereTragenSieNoch = avesmapsGaretienAndererTraegerVorhanden(
                        $pdo, $entityType, $quellePublicId, $eigeneAdresse,
                        $vermerkItemId > 0 ? array_merge($itemIds, [$vermerkItemId]) : $itemIds
                    );
                    if (!$andereTragenSieNoch) {
                        avesmapsGaretienQuelleRuecknahmeLoesenFuerAdresse($pdo, $entityType, $quellePublicId, $eigeneAdresse, (int) ($user['id'] ?? 0));
                        $beruehrt[$entityType . ':' . $quellePublicId] = ['entity_type' => $entityType, 'public_id' => $quellePublicId];
                    }
                }
                // 💣 KEINE ADRESSE BESTIMMBAR: nichts wird geloest -- die sichere Richtung (siehe
                // avesmapsGaretienItemTraegtAdresse); das Item geht trotzdem zurueck auf 'offen'.

                // 🔴 DER NAME NACH DER QUELLE: scheitert er, bleibt das Item auf 'done', und ein zweiter Klick
                // findet die Quelle schon geloest und versucht nur noch den Namen.
                if ($nameVermerk !== null) {
                    avesmapsGaretienNameZuruecksetzen($pdo, $ziel, $entityPublicId, $nameVermerk, $user);
                }

                // Zurueck auf 'offen' -- derselbe Riegel wie im 'new'-Zweig unten (dieselbe
                // Bedeutung von "Ruecknahme": zurueck in GENAU den Stand vor der Uebernahme).
                avesmapsGaretienItemZurueckAufOffen($pdo, $itemId);
                // ⚠️ UND DAS FRUEHERE ITEM MIT, wenn der Namens-Vermerk von dort kam -- sonst faende der
                // naechste Rueckfall denselben Vermerk noch einmal (dieselbe Begruendung wie `$altItemId`
                // im 'new'-Zweig unten).
                if ($vermerkItemId > 0 && $vermerkItemId !== $itemId) {
                    avesmapsGaretienItemZurueckAufOffen($pdo, $vermerkItemId);
                }
                $zurueckgenommen++;
            } catch (Throwable $abbruch) {
                // 🔴 GEKAPPT WIE `apply_note` IN avesmapsGaretienUebernehmen (Ruling 13, 06.09.2026
                // nachgezogen): die Ruecknahme laeuft ueber DIESELBE Tuer wie die Uebernahme
                // (api/edit/map/garetien-import.php, Aktion 'ruecknahme') und ist NICHT admin-only --
                // dieselbe Editor-Population, die dort schon geschuetzt ist. Ein ungekapptes
                // `getMessage()` waere hier genau der Mangel, vor dem AGENTS.md §10/M1 warnt, nur an
                // der einen Stelle, die zuerst durchgerutscht war.
                $fehler[] = ['item' => $itemId, 'grund' => mb_substr($abbruch->getMessage(), 0, 300, 'UTF-8')];
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
        if (!$istUebernommen($item)) {
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
        // 💣 UND NACH EINEM NEUEN LAUF STEHT SIE IM ALTEN. `sync_plan_run` wird beim
        // naechsten „Holen & Rechnen" nur auf `superseded` gesetzt, nie geloescht
        // (avesmapsSyncPlanStartRun) -- die Zeile, die das Objekt angelegt hat, liegt also noch
        // da, samt ihrem Vermerk. Das frische Item kennt ihn nicht: es ist eine neue Zeile mit
        // leerem `apply_note`.
        //
        // 🔴 GESUCHT WIRD UEBER (kind, entity_key, change_type) UND `apply_state = 'done'`,
        // und das ist der ganze Riegel gegen ein falsches Loeschziel: eine Ruecknahme setzt
        // `apply_state` der alten Zeile auf NULL (avesmapsGaretienItemZurueckAufOffen), ein
        // bereits zurueckgenommener Lauf kann hier also nicht mehr gefunden werden. Von mehreren
        // gilt die JUENGSTE.
        //
        // ⚠️ EHRLICH GESAGT ist `apply_state = 'done'` hier Guertel UND Hosentraeger: die
        // Sortierung nach `id DESC` deckt jede Reihenfolge ab, die im Betrieb entstehen kann, und
        // eine Mutationsprobe am 01.09.2026 konnte die Bedingung deshalb folgenlos entfernen. Sie
        // bleibt trotzdem stehen -- sie kostet nichts, und hier wird GELOESCHT. Wer sie streicht,
        // streicht keinen toten Code, sondern die letzte Zusicherung gegen einen Vermerk, der auf
        // ein laengst entferntes Objekt zeigt.
        //
        // ⚠️ Nur wenn der dauerhafte Vermerk sagt, dass wirklich uebernommen wurde -- der
        // Riegel oben hat das schon geprueft. Findet sich nichts, wird NICHT geraten: hier wird
        // geloescht, und ein falsches Ziel ist teurer als eine Fehlermeldung.
        $altItemId = 0;
        if ($publicId === '') {
            $alt = $pdo->prepare(
                'SELECT i.id, i.apply_note FROM sync_plan_item i'
                . ' JOIN sync_plan_run r ON r.id = i.run_id'
                . " WHERE r.kind = :k AND i.entity_key = :e AND i.change_type = 'new'"
                . " AND i.apply_state = 'done' AND i.apply_note IS NOT NULL AND i.apply_note <> ''"
                . ' ORDER BY i.id DESC LIMIT 1'
            );
            $alt->execute([
                'k' => AVESMAPS_GARETIEN_PLAN_KIND,
                'e' => (string) $item['entity_key'],
            ]);
            $treffer = $alt->fetch(PDO::FETCH_ASSOC);
            if (is_array($treffer)) {
                $publicId = trim((string) ($treffer['apply_note'] ?? ''));
                $altItemId = (int) $treffer['id'];
            }
        }
        if ($publicId === '') {
            $fehler[] = ['item' => $itemId, 'grund' => 'keine angelegte public_id hinterlegt'];
            continue;
        }
        $nach = json_decode((string) $item['after_json'], true);
        $ziel = is_array($nach) ? (string) ($nach['ziel'] ?? '') : '';

        try {
            // 🔴 ZUERST NACHSEHEN, WO DAS OBJEKT WIRKLICH LIEGT. Ein innerorts eingefuegtes Objekt
            // traegt `ziel = 'location'` wie jedes andere Bauwerk -- aber es steht in
            // `settlement_place` und nicht in `map_features`; der generische Loeschweg darunter
            // faende es nie und meldete „Objekt nicht gefunden" fuer etwas, das sehr wohl da ist.
            // 💣 Gefragt wird die TABELLE, nicht ein zweiter Vermerk am Item: ein Marker in
            // `apply_note` waere eine zweite Buchfuehrung darueber, was schon geschrieben wurde --
            // genau die, die dieses Modul beim Uebernahme-Vermerk ausdruecklich vermeidet.
            // ⚠️ WEICH: `is_active = 0`, kein DELETE. Ein erneutes „Innerorts einfuegen" belebt
            // dieselbe Zeile wieder (avesmapsSettlementPlaceAdd), samt ihrer Quellenverknuepfung.
            //
            // 🔴 FIXRUNDE 1, BEFUND 2: `$ziel !== 'region'` IST HIER PFLICHT. Seit Aufgabe 6/7
            // traegt $publicId bei `ziel = 'region'` keine nackte public_id mehr, sondern den
            // strukturierten Verbund-Vermerk ("area:<a> | region:<r> | verbund:<v>") -- eine
            // Staette wird aber NIE unter `ziel = 'region'` angelegt (die Innerorts-Handlung ist
            // eine eigene Abzweigung VOR der ziel-Weiche, ihr Objekt traegt immer `ziel =
            // 'location'`). Ohne den Riegel bekaeme avesmapsSettlementPlaceExists() fuer jedes
            // 'region'-Item den ganzen Vermerkstring als vermeintliche public_id -- er trifft nie
            // (kein Staetten-Datensatz traegt Pipe- und Doppelpunkt-Zeichen als id), aber die
            // Abfrage misst dann etwas, das nie eine public_id war.
            // 🔴 „NUR QUELLE + ARTIKEL AN X" ZUERST (Entwurf 14.09.2026, §5). Der Vermerk nennt die
            // SIEDLUNG, an die nur eine Quelle gehaengt wurde -- sie darf von keinem Loeschweg
            // darunter erreicht werden (`location` fuehrte sonst zu avesmapsDeleteMapFeature).
            // 🔴 GELOEST WIRD NUR DER ARTIKEL DIESES OBJEKTS (avesmapsGaretienQuelleRuecknahmeLoesenFuerAdresse):
            // an der Stadt haengen auch ihre eigene Quelle und die anderer Bauwerke.
            // ⚠️ Ohne eigenen Artikel hing die Sammelquelle des Wirts -- dieselbe Adresse, die die Stadt
            // selbst tragen kann. Sie bleibt stehen: lieber eine Quelle zu viel als die Lizenzangabe
            // der Stadt genommen.
            $nurQuelleSiedlung = avesmapsGaretienNurQuelleAusVermerk($publicId);
            if ($nurQuelleSiedlung !== '') {
                // 🔴 NACHBESSERUNG 1 (W1): DIE VERKNUEPFUNG GEHOERT DER GRUPPE, NICHT DEM EINZELNEN
                // ITEM. Zwei Bauwerke koennen dieselbe Artikeladresse an dieselbe Siedlung haengen
                // (ein Sammelartikel) oder ein Bauwerk kann die EIGENE Adresse der Siedlung tragen
                // -- in beiden Faellen legte NICHT DIESES Item die Verknuepfung an, und ihre
                // Ruecknahme darf sie nicht mitreissen. Zwei Bedingungen, beide muessen zutreffen:
                //   1. NUR das Item mit `angelegt:1` darf ueberhaupt loesen (`angelegt:0`/`null`
                //      heisst „diese Verknuepfung gehoert mir nicht" -- sichere Richtung: eine
                //      stehengebliebene Quelle kostet eine Handloeschung, eine faelschlich
                //      geloeschte kostet lautlos Daten samt Lizenzangabe).
                //   2. UND nur, wenn kein anderes `done`-Item DERSELBEN Gruppe (Siedlung +
                //      Artikeladresse, laufuebergreifend) noch Anspruch darauf hat.
                // 💣 `avesmapsGaretienItemZurueckAufOffen` LOESCHT `apply_note` bei jeder
                // Ruecknahme -- der Vermerk „angelegt:1" ueberlebt eine Ruecknahme also NICHT.
                // Beide Pruefungen muessen deshalb VOR diesem Aufruf laufen, mit dem Vermerk, den
                // das Item JETZT noch traegt (siehe avesmapsGaretienAndererTraegerVorhanden
                // fuer die daraus folgende moegliche Waise).
                // 🔴 NACHBESSERUNG 2: DIE TRAEGERMENGE IST JETZT DIE GANZE, nicht nur Nur-Quelle-
                // Geschwister -- Wandlethes eigenes `changed`-Quelle-Item zaehlt seither mit.
                $nurQuelleWarNeu = avesmapsGaretienNurQuelleAngelegtAusVermerk($publicId);
                if ($nurQuelleWarNeu === true) {
                    $artikel = avesmapsGaretienArtikelQuelleAusItem(is_array($nach) ? $nach : [], (string) $item['entity_key']);
                    if ($artikel !== null) {
                        $nurQuelleArtikelUrl = trim((string) ($artikel['url'] ?? ''));
                        [$quellArt, $quellId] = avesmapsGaretienQuellenZiel('location', $nurQuelleSiedlung);
                        $andereTragenSieNoch = avesmapsGaretienAndererTraegerVorhanden(
                            $pdo, $quellArt, $quellId, $nurQuelleArtikelUrl, $itemIds
                        );
                        if (!$andereTragenSieNoch) {
                            avesmapsGaretienQuelleRuecknahmeLoesenFuerAdresse($pdo, $quellArt, $quellId, $nurQuelleArtikelUrl, (int) ($user['id'] ?? 0));
                            $beruehrt[$quellArt . ':' . $quellId] = ['entity_type' => $quellArt, 'public_id' => $quellId];
                        }
                    }
                }
                // 💣 $nurQuelleWarNeu === false ODER null: NICHTS wird geloest -- weder die Adresse
                // war je „unser" Neuzugang (false), noch weiss dieser alte Vermerk es ueberhaupt
                // (null, altes Format ohne `angelegt`-Feld). Das Item geht trotzdem zurueck auf
                // 'offen' (unten, gemeinsamer Code) -- „Ruecknahme" heisst hier nur „dieses Item
                // beansprucht die Verknuepfung nicht mehr", nicht zwingend „sie verschwindet".
            } elseif ($ziel !== 'region' && avesmapsSettlementPlaceExists($pdo, $publicId)) {
                avesmapsSettlementPlaceDeactivate($pdo, $publicId, (int) ($user['id'] ?? 0));
            } elseif ($ziel === 'path' || $ziel === 'location' || $ziel === 'label') {
                // Strom/Fluss/Bach, Reichsstrasse/Strasse/Weg/Pfad, Ortschaften, Berggipfel: je
                // EINE map_features-Zeile (avesmapsCreatePathFeature/…PointFeature/…LabelFeature
                // oben) -- derselbe generische Loeschweg fuer alle vier, weil keins davon eine
                // Kaskade traegt (ein frisch importierter Berggipfel haengt an KEINER Region,
                // avesmapsGaretienUebernehmen legt ihn nie als `label_public_id` einer Flaeche an).
                avesmapsDeleteMapFeature($pdo, ['public_id' => $publicId], $user);
            } elseif ($ziel === 'region') {
                // 🔴 AUFGABE 7: $publicId TRAEGT HIER KEINE NACKTE public_id MEHR, SONDERN DEN
                // STRUKTURIERTEN VERMERK ("area:<a> | region:<r> | verbund:<v>") -- seit Aufgabe 6
                // schreibt jedes 'region'-Item ihn, auch OHNE Verbund (dann bleibt das dritte
                // Feld leer). Dieselbe Variable traegt oben fuer path/location/label weiterhin
                // eine nackte id; nur hier ist sie ein Vermerk zum Zerlegen.
                //
                // ⚠️ GELESEN WIRD $publicId, NICHT NOCH EINMAL `$item['apply_note']`: $publicId
                // ist zu diesem Zeitpunkt schon der RICHTIGE Wert -- entweder aus der aktuellen
                // Zeile, oder (bei einer frischen Zeile nach einem erneuten „Holen & Rechnen")
                // aus dem laufuebergreifenden Rueckfall wenige Zeilen weiter oben. Ein erneutes
                // `$item['apply_note']` uebersaehe genau diesen Rueckfall.
                [$loeschweg, $zielId] = avesmapsGaretienRuecknahmeWeg($publicId);
                if ($zielId === '') {
                    throw new RuntimeException('kein Loeschziel im Vermerk');
                }
                if ($loeschweg === 'flaeche') {
                    // Nur DIESE Flaeche eines Verbunds. avesmapsDeleteEcosystemArea traegt die
                    // Kaskade schon in sich: nimmt eine Flaeche die letzte einer Region, gehen
                    // Region und Beschriftung von selbst mit (Entwurf §8) -- kein
                    // Anfuehrer-Sonderfall noetig.
                    //
                    // 💣 `expected_revision` ist bei dieser Funktion PFLICHT (anders als bei
                    // avesmapsDeleteMapFeature, wo es optional ist) -- ohne sie wirft
                    // avesmapsEcosystemReadExpectedRevision sofort. Es ist keine
                    // Nebenlaeufigkeitspruefung wie im Editor (dort liest der Client seinen
                    // zuletzt gesehenen Stand); hier gibt es keinen Client -- gelesen wird der
                    // AKTUELLE Stand direkt vor dem Loeschen.
                    $revisionStmt = $pdo->prepare(
                        'SELECT geometry_revision FROM ecosystem_area WHERE public_id = :p AND is_active = 1 LIMIT 1'
                    );
                    $revisionStmt->execute([':p' => $zielId]);
                    $geometryRevision = $revisionStmt->fetchColumn();
                    if ($geometryRevision === false) {
                        throw new RuntimeException('Die Flaeche ' . $zielId . ' existiert nicht mehr.');
                    }
                    avesmapsDeleteEcosystemArea(
                        $pdo,
                        ['public_id' => $zielId, 'expected_revision' => (int) $geometryRevision],
                        (int) ($user['id'] ?? 0)
                    );
                } else {
                    // See/Meer/Sumpf ohne Verbund: Label + Region + Flaeche (avesmapsGaretien
                    // FlaecheAnlegen oben, in genau dieser Reihenfolge angelegt).
                    // avesmapsDeleteEcosystemRegion (api/_internal/app/ecosystem.php) nimmt die
                    // Flaeche(n) UND alle Labels der Region in EINER Transaktion mit -- das ist
                    // die UMGEKEHRTE Reihenfolge in EINER Funktion, nicht der allgemeine
                    // Feature-Loeschweg mit seinem `refuse_ecosystem_cascade`-Riegel: der ist
                    // gebaut, um die Kaskade beim Loeschen EINER Beschriftung zu VERHINDERN
                    // (AGENTS.md §11, Konfliktzentrum, Regel label.duplicate); hier wird sie
                    // gewollt und vollstaendig ausgefuehrt.
                    avesmapsDeleteEcosystemRegion($pdo, ['public_id' => $zielId], (int) ($user['id'] ?? 0));
                }
                // 🔴 DIE GARETIEN-QUELLE DER REGION FAELLT ERST MIT DER LETZTEN FLAECHE (Entwurf
                // 14.09.2026, Fehler 9). Alle Fragmente eines Verbunds haengen sie an DIESELBE Stelle
                // (`ecosystem:<region>`) -- die Ruecknahme EINES darf sie den uebrigen nicht nehmen.
                // Gezaehlt werden die aktiven Flaechen NACH dem Loeschen, nie der Rueckgabewert der
                // Kaskade: die ist abschaltbar (AVESMAPS_ECOSYSTEM_CASCADE_ENABLED), die Frage nicht.
                // ⚠️ NACH dem Loeschen, nicht davor: scheiterte das Loeschen nach dem Loesen, stuende
                // eine sichtbare Landschaft ohne ihre Lizenzangabe da -- die teurere Richtung.
                // ⚠️ In einem EIGENEN Fang: das Objekt ist zu diesem Zeitpunkt schon weg. Ein Fehler
                // beim Loesen wird benannt, haelt das Item aber nicht auf „done" fest -- sonst boete
                // die Liste eine Ruecknahme an, die nur noch an „Flaeche existiert nicht mehr" scheitert.
                $regionDerFlaeche = avesmapsGaretienVermerkLesen($publicId)['region'];
                try {
                    if ($regionDerFlaeche !== '' && avesmapsGaretienRegionAktiveFlaechen($pdo, $regionDerFlaeche) === 0) {
                        [$quellArt, $quellId] = avesmapsGaretienQuellenZiel('region', $regionDerFlaeche);
                        // 🔴 NACHBESSERUNG 3 (W1c, Ruling-Punkt 5): NICHT MEHR BLIND ALLES. Ein
                        // EIGENSTAENDIGES `changed`-Quelle-Item DERSELBEN Region (Gruppe 2 von
                        // avesmapsGaretienAndererTraegerVorhanden -- avesmapsGaretienErgaenzungsEintraege
                        // bietet genau so ein Item fuer ziel='region' an, garetien-plan.php:1023) kann
                        // dieselbe Adresse noch brauchen, auch wenn keine Fragment-Flaeche mehr aktiv
                        // ist. Jede DERZEIT haengende Adresse wird einzeln geprueft und nur geloest,
                        // wenn kein anderer `done`-Traeger sie noch haelt.
                        foreach (avesmapsGaretienGaretienAdressenAn($pdo, $quellArt, $quellId) as $regionAdresse) {
                            $andereTragenSieNoch = avesmapsGaretienAndererTraegerVorhanden(
                                $pdo, $quellArt, $quellId, $regionAdresse, $itemIds
                            );
                            if (!$andereTragenSieNoch) {
                                avesmapsGaretienQuelleRuecknahmeLoesenFuerAdresse($pdo, $quellArt, $quellId, $regionAdresse, (int) ($user['id'] ?? 0));
                            }
                        }
                        $beruehrt[$quellArt . ':' . $quellId] = ['entity_type' => $quellArt, 'public_id' => $quellId];
                    }
                } catch (Throwable $quellFehler) {
                    $fehler[] = [
                        'item' => $itemId,
                        'grund' => mb_substr('zurueckgenommen, aber die Quelle der Region blieb haengen: '
                            . $quellFehler->getMessage(), 0, 300, 'UTF-8'),
                    ];
                }
            } else {
                throw new RuntimeException('unbekanntes Ziel "' . $ziel . '" -- keine Ruecknahme moeglich');
            }

            // Zurueck auf 'offen': derselbe Riegel, den avesmapsSyncPlanPendingItems verlangt
            // (apply_state IS NULL) -- und `selected = 1`, der Stand UNMITTELBAR VOR dem Klick auf
            // „Neu einfuegen" (der Vorschlag stand vorangehakt da, sonst waere er nie uebernommen
            // worden -- avesmapsSyncPlanPendingItems verlangt selected=1). „Ruecknahme" heisst:
            // zurueck in GENAU diesen Stand, nicht in einen neuen.
            avesmapsGaretienItemZurueckAufOffen($pdo, $itemId);
            // ⚠️ UND DIE ALTE ZEILE MIT, wenn die public_id von dort kam. Bliebe sie auf
            // `apply_state = 'done'` stehen, faende die Suche oben beim naechsten Mal denselben
            // Vermerk -- der dann auf ein geloeschtes Objekt zeigt. Ein Geist, der eine
            // Ruecknahme anbietet, die nur noch scheitern kann.
            if ($altItemId > 0) {
                avesmapsGaretienItemZurueckAufOffen($pdo, $altItemId);
            }
            $zurueckgenommen++;
        } catch (Throwable $abbruch) {
            // 🔴 GEKAPPT WIE `apply_note` IN avesmapsGaretienUebernehmen (Ruling 13, 06.09.2026
            // nachgezogen): die Ruecknahme laeuft ueber DIESELBE Tuer wie die Uebernahme
            // (api/edit/map/garetien-import.php, Aktion 'ruecknahme') und ist NICHT admin-only --
            // dieselbe Editor-Population, die dort schon geschuetzt ist. Ein ungekapptes
            // `getMessage()` waere hier genau der Mangel, vor dem AGENTS.md §10/M1 warnt, nur an
            // der einen Stelle, die zuerst durchgerutscht war.
            $fehler[] = ['item' => $itemId, 'grund' => mb_substr($abbruch->getMessage(), 0, 300, 'UTF-8')];
        }
    }

    return [
        'zurueckgenommen' => $zurueckgenommen,
        'fehler' => $fehler,
        // 🔴 DERSELBE SCHLUESSEL WIE BEI DER UEBERNAHME, und das ist Absicht: der Browser
        // hat dafuer schon einen Trichter (garetienQuellenNachtragen). Ein eigener Name
        // haette dort einen zweiten Leser gebraucht, der dasselbe tut.
        'quellen_neu' => avesmapsGaretienQuellenNachtrag(
            $pdo, array_values($beruehrt), (int) ($user['id'] ?? 0)
        ),
    ];
}
