<?php

declare(strict_types=1);

// Der Abgleich: welche Zeile aus dem Staging haben wir schon, welche ist neu?
// Entwurf: docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md §3 und §5.2
//
// 🔴 REIN LESEND. Diese Datei schreibt in KEINE Tabelle -- das gilt fuer jeden Sync-Lauf im
// Haus (sync-plan-purity-test.php), und der Import erbt es.

require_once __DIR__ . '/garetien-parser.php';
require_once __DIR__ . '/garetien-koordinaten.php';

/**
 * 🔴 DIE ZUORDNUNG IST DATEN, KEIN `if`-BAUM (Entwurf §3). Sie steht in EINER Tabelle und wird
 * von Abgleich und Uebernahme gemeinsam gelesen; ein Editor kann sie lesen und aendern.
 *
 * `ziel`   -- 'path' (map_features.path) · 'region' (ecosystem_region + ecosystem_area, mit
 *             tragendem Label) · 'location' (map_features.location, ein Ort) · 'label'
 *             (map_features.label OHNE Region dahinter, bislang nur der Berggipfel)
 * `subtyp` -- unser feature_subtype bzw. region_type bzw. settlement_class
 * `kind`   -- nur bei 'region': die Landschaften-Ebene
 *
 * 🔴 Owner 29.08.2026: „Stufen werden weder erklaert noch will ich, dass sie verhindern, dass
 * ich objekte importieren kann." Diese Tabelle setzt die Zuordnung aus Entwurf §3.1-§3.4
 * vollstaendig um -- nur Territorien (§3.5) bleiben draussen, siehe die Begruendung am Ende
 * dieser Konstante.
 */
const AVESMAPS_GARETIEN_TYP_MAP = [
    // Fliessgewaesser werden bei uns BEFAHREN: `Flussweg` ist eine Graph-Kante des Routings,
    // kein Dekor (Entwurf §3.3). Die Anbindung ans Wegenetz ist ausdruecklich nicht Teil dieses
    // Imports -- sie wird gemessen und berichtet, nicht gebaut.
    'Strom' => ['ziel' => 'path',   'subtyp' => 'Flussweg',      'kind' => null],
    'Fluss' => ['ziel' => 'path',   'subtyp' => 'Flussweg',      'kind' => null],
    'Bach'  => ['ziel' => 'path',   'subtyp' => 'Flussweg',      'kind' => null],

    // Stehende Gewaesser sind bei uns eine FLAECHE plus ein LABEL -- zwei Objekte, und das
    // Label ist das tragende (Entwurf §3.3).
    // 💣 `suchen` ist NICHT `subtyp`. Angelegt wird als das, was die Zuordnung sagt -- GESUCHT
    // wird in der ganzen Verwandtschaft, weil unsere Einordnung von ihrer abweichen darf.
    // 🔴 Der Fall, der das erzwungen hat: Volker fuehrt den ANGBARER SEE als `Meer` (er ist der
    // groesste Binnensee des Kosch), wir als `topographie/see`. Nur unter `meer` gesucht, findet
    // der Abgleich nichts -- und legt ihn ein zweites Mal an, vorangehakt. Gemessen 27.08.2026.
    // ⚠️ Der Sumpf bleibt allein: ein Moor ist kein See, und wer die Familien zu weit zieht,
    // erklaert am Ende jede Wasserflaeche zur selben Sache.
    'See'   => ['ziel' => 'region', 'subtyp' => 'see',           'kind' => 'topographie', 'suchen' => [['topographie', 'see'], ['topographie', 'meer']]],
    'Meer'  => ['ziel' => 'region', 'subtyp' => 'meer',          'kind' => 'topographie', 'suchen' => [['topographie', 'meer'], ['topographie', 'see']]],
    'Sumpf' => ['ziel' => 'region', 'subtyp' => 'suempfe_moore', 'kind' => 'vegetation',  'suchen' => [['vegetation', 'suempfe_moore']]],

    // Wege (Entwurf §3.2) -- ihre vier Typen heissen exakt wie unsere PATH_SUBTYPE_KEYS
    // (js/config.js), keine Uebersetzung noetig. 💣 Ein Weg ist eine Kante im Routing-Graphen:
    // anders als ein Bach (Transport-Domaene 'none') bekommt eine Strasse per
    // avesmapsDefaultTransportDomainForPathSubtype() die Domaene 'land' und ist damit ab dem
    // ersten Klick fuer JEDEN Reisenden nutzbar. Auch hier gilt Entwurf §3.3 sinngemaess: die
    // Anbindung ans bestehende Netz (Kreuzungs-Splits, Komponentenbruecken) wird NICHT gebaut,
    // nur gemessen und berichtet.
    'Reichsstrasse' => ['ziel' => 'path', 'subtyp' => 'Reichsstrasse', 'kind' => null],
    'Strasse'       => ['ziel' => 'path', 'subtyp' => 'Strasse',       'kind' => null],
    'Weg'           => ['ziel' => 'path', 'subtyp' => 'Weg',           'kind' => null],
    'Pfad'          => ['ziel' => 'path', 'subtyp' => 'Pfad',          'kind' => null],

    // Waelder (Entwurf §3.4) -- FLAECHE plus LABEL, wie die Gewaesserflaechen oben.
    'Wald'  => ['ziel' => 'region', 'subtyp' => 'wald',   'kind' => 'vegetation'],
    'Forst' => ['ziel' => 'region', 'subtyp' => 'wald',   'kind' => 'vegetation'],
    // 🔴 NEUE ART, Owner-Entscheid 2026-08-26: ein Urwald ist NICHT dasselbe wie ein Dschungel --
    // der Dschungel ist eine Klimaaussage (tropisch), der Urwald eine Aussage ueber den ZUSTAND
    // (nie gerodet). Begruendung an der Art selbst: AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED
    // (api/_internal/app/ecosystem.php).
    'Urwald' => ['ziel' => 'region', 'subtyp' => 'urwald', 'kind' => 'vegetation'],

    // Berge und Gelaendeformen (Entwurf §3.4) -- alle vier Arten gibt es bei uns schon
    // (`topographie/insel` und `/kueste`/`/huegelland`/`/gebirge`, nachgemessen), keine neue
    // Art noetig.
    'Gebirge' => ['ziel' => 'region', 'subtyp' => 'gebirge',    'kind' => 'topographie'],
    'Huegel'  => ['ziel' => 'region', 'subtyp' => 'huegelland', 'kind' => 'topographie'],
    'Insel'   => ['ziel' => 'region', 'subtyp' => 'insel',      'kind' => 'topographie'],
    'Kueste'  => ['ziel' => 'region', 'subtyp' => 'kueste',     'kind' => 'topographie'],

    // 🔴 Der Berg ist die EINZIGE Ausnahme von "Flaeche + Label": ein einzelner Gipfel ist bei
    // uns ein PUNKT, kein Umriss (Entwurf §3.4). 💣 `berggipfel` ist ein Stuetzpunkt des
    // Hoehenfelds (terrain-store.php liest is_active=1 + height_schritt) -- die Uebernahme legt
    // deshalb bewusst KEINE `height_schritt` an, ihre Daten tragen keine Hoehe.
    'Berg' => ['ziel' => 'label', 'subtyp' => 'berggipfel', 'kind' => null],

    // Ortschaften (Entwurf §3.1) -- map_features.location, `subtyp` ist unser settlement_class.
    'Kaiserstadt'  => ['ziel' => 'location', 'subtyp' => 'metropole',  'kind' => null],
    'Koenigsstadt' => ['ziel' => 'location', 'subtyp' => 'grossstadt', 'kind' => null],
    'Reichsstadt'  => ['ziel' => 'location', 'subtyp' => 'grossstadt', 'kind' => null],
    'Stadt'        => ['ziel' => 'location', 'subtyp' => 'stadt',      'kind' => null],
    'Markt'        => ['ziel' => 'location', 'subtyp' => 'kleinstadt', 'kind' => null],
    'Dorf'         => ['ziel' => 'location', 'subtyp' => 'dorf',       'kind' => null],
    // 🔴 Owner-Entscheid 2026-08-26: im Einklang mit den zwei Bingen, die wir schon als `dorf`
    // fuehren (Finsterkoppen, Antalorgol).
    'Binge'        => ['ziel' => 'location', 'subtyp' => 'dorf',       'kind' => null],
    // Einzelne Bauwerke -- bei uns eine Klasse, `gebaeude` (Entwurf §3.1).
    'Burg'        => ['ziel' => 'location', 'subtyp' => 'gebaeude', 'kind' => null],
    'Pfalz'       => ['ziel' => 'location', 'subtyp' => 'gebaeude', 'kind' => null],
    'Tempel'      => ['ziel' => 'location', 'subtyp' => 'gebaeude', 'kind' => null],
    'Kloster'     => ['ziel' => 'location', 'subtyp' => 'gebaeude', 'kind' => null],
    'Gutshof'     => ['ziel' => 'location', 'subtyp' => 'gebaeude', 'kind' => null],
    'Gebaeude'    => ['ziel' => 'location', 'subtyp' => 'gebaeude', 'kind' => null],
    'Akademie'    => ['ziel' => 'location', 'subtyp' => 'gebaeude', 'kind' => null],
    'Gasthaus'    => ['ziel' => 'location', 'subtyp' => 'gebaeude', 'kind' => null],
    'Magierturm'  => ['ziel' => 'location', 'subtyp' => 'gebaeude', 'kind' => null],

    // Politische Flaechen (Entwurf §3.5) -- hier ABSICHTLICH NICHT eingetragen. An
    // political_territory haengen BF-Zeitachse, abgeleitete Aussengrenzen, WikiSync und das
    // Konfliktzentrum; ein zweiter Datenlieferant dort ist ein eigenes Vorhaben, kein Anhaengsel
    // an diesen Import (Entwurf §7). Ihre Typen (Grafschafts-/Baronie-/Junkertumsflaeche[A-E])
    // fallen deshalb weiterhin unter avesmapsGaretienTypKategorie() === 'unbekannt'.
];

// 🔴 Owner 29.08.2026: „Stufen werden weder erklaert noch will ich, dass sie verhindern, dass ich
// objekte importieren kann." Bis zum 29.08.2026 stand hier `AVESMAPS_GARETIEN_SPAETERE_STUFEN` --
// eine dritte Kategorie 'spaetere_stufe' fuer Typen, die wir kennen, aber (noch) nicht anschliessen.
// Mit der vollstaendigen Zuordnung oben (Wege, Waelder, Berge, Ortschaften) wurde diese Liste LEER
// und die Kategorie damit UNERREICHBAR TOTER CODE -- eine leere Konstante mit einem beruhigenden
// Kommentar ist in diesem Projekt eine bekannte Falle (eine Zahl/ein Zustand im Kommentar liest
// sich wie eine gepflegte, vollstaendige Aussage, und niemand prueft nach). ENTFERNT, nicht nur
// geleert: `avesmapsGaretienTypKategorie()` kennt seither nur noch ZWEI Kategorien.
// Politische Flaechen (Grafschafts-/Baronie-/Junkertumsflaeche[A-E], Entwurf §3.5) -- der einzige
// heute bekannte Fall "wir kennen den Typ, schliessen ihn aber nicht an" -- fallen jetzt unter
// 'unbekannt': wir kennen ihre genauen Rohdaten-Typnamen nicht (ungemessen), eine geratene
// Schreibweise waere schlimmer als die ehrliche Kategorie.

/** Typen ohne jedes Gegenstueck -- die kommen nie (Entwurf §3.6). */
const AVESMAPS_GARETIEN_OHNE_GEGENSTUECK = ['Stadtviertel', 'Kontinent', 'Platz'];

/**
 * Sammelartikel: Objekte ausserhalb des gepflegten Gebiets, wo wir eigene Daten haben.
 *
 * 🪤 SIE STEHEN IM ARTIKEL, NICHT IM NAMENSRAUM. "Fluss:Nachbarprovinzen!Llavari" hat gar
 * keinen Namensraum -- der Text vor dem "!" IST der Artikelname. Der Bauplan suchte sie im
 * Namensraum; damit haette er keine der vier Zeilen der Gewaesserseite gefunden und alle vier
 * importiert. Geprueft werden deshalb BEIDE Felder.
 */
const AVESMAPS_GARETIEN_SAMMELARTIKEL = ['Nachbarprovinzen', 'Raschtulswall'];

/** Bis hierher gilt "an dieser Stelle liegt schon dasselbe". Startwert, in Karteneinheiten. */
const AVESMAPS_GARETIEN_TREFFER_EINHEITEN = 2.0;

/**
 * Die Kartengrenzen, gegen die "hat dieses Objekt ueberhaupt eine Position?" geprueft wird.
 * Unsere Karte ist 0..1024 (L.CRS.Simple, image bounds). Der Rand ist grosszuegig: verworfen
 * werden soll die MARKE, nicht ein Kuestenverlauf, der die Kante streift.
 */
const AVESMAPS_GARETIEN_KARTE_RAND = 64.0;

/** So viele Punkte der Importlinie werden verglichen -- gleichmaessig verteilt. */
const AVESMAPS_GARETIEN_PROBEPUNKTE = 16;

/** Die Zuordnung eines Quelltyps, oder null (= in dieser Stufe nicht importieren). */
function avesmapsGaretienMappeTyp(string $typ): ?array
{
    return AVESMAPS_GARETIEN_TYP_MAP[$typ] ?? null;
}

/**
 * Liegt wenigstens EIN Punkt auf der Karte?
 *
 * ⚠️ Ein leeres Ergebnis heisst NICHT "nein". Verweis-Objekte (Flaechen aus Grenzzuegen) haben
 * gar keine eigenen Koordinaten, und ein Riegel, der sie verwirft, naehme Stufe 5 mit.
 */
function avesmapsGaretienLiegtAufDerKarte(array $punkte): bool
{
    if ($punkte === []) {
        return true;
    }
    foreach ($punkte as [$x, $y]) {
        if ($x >= -AVESMAPS_GARETIEN_KARTE_RAND && $x <= 1024.0 + AVESMAPS_GARETIEN_KARTE_RAND
            && $y >= -AVESMAPS_GARETIEN_KARTE_RAND && $y <= 1024.0 + AVESMAPS_GARETIEN_KARTE_RAND) {
            return true;
        }
    }

    return false;
}

/**
 * Liefert dieser TYP grundsaetzlich nichts -- unabhaengig von einer einzelnen Zeile?
 *
 * 🔴 DIE EINE STELLE fuer die Typ-Frage: `avesmapsGaretienUeberspringGrund` (unten) UND der
 * Filter-Trichter des Fensters (garetien-liste.php baut daraus `facetten.typ_kategorie`, Owner-
 * Meldung 29.08.2026) lesen GENAU DIESE Funktion. Ein Nachbau der Liste
 * (AVESMAPS_GARETIEN_OHNE_GEGENSTUECK) oder der 'Klein'-Regel an einer zweiten Stelle waere die
 * zweite Wahrheit, vor der AGENTS.md §5 warnt.
 *
 * 🔴 ZWEI Kategorien, nicht drei: 'ohne_gegenstueck' ist eine ENTSCHEIDUNG ("raus damit", Owner
 * 29.08.2026 -- Beispiel BurgKlein), 'unbekannt' ist der Auffangfall fuer alles andere, das nicht
 * in AVESMAPS_GARETIEN_TYP_MAP steht. Bis zum 29.08.2026 gab es eine dritte, 'spaetere_stufe' --
 * ENTFERNT, seit die Zuordnung vollstaendig ist und ihre Liste (AVESMAPS_GARETIEN_SPAETERE_STUFEN)
 * leer wurde: der Owner wollte ausdruecklich keinen Begriff im Code, der zum erneuten Befuellen
 * einlaedt ("Stufen werden weder erklaert noch will ich, dass sie verhindern, dass ich objekte
 * importieren kann"). 'unbekannt' war genau dafuer schon da (bewusst vorsorglich gebaut) und ist
 * jetzt der einzige Auffangfall.
 *
 * @return 'ohne_gegenstueck'|'unbekannt'|'' ('' = der Typ liefert etwas)
 */
function avesmapsGaretienTypKategorie(string $typ): string
{
    if (in_array($typ, AVESMAPS_GARETIEN_OHNE_GEGENSTUECK, true) || str_ends_with($typ, 'Klein')) {
        return 'ohne_gegenstueck';
    }

    return avesmapsGaretienMappeTyp($typ) !== null ? '' : 'unbekannt';
}

/**
 * Warum wird diese Zeile uebersprungen? null = sie wird NICHT uebersprungen.
 *
 * 🔴 Immer mit Grund. "Uebersprungen" ohne Grund ist eine Zahl, die niemand pruefen kann.
 */
function avesmapsGaretienUeberspringGrund(array $zeile): ?string
{
    $typ = (string) ($zeile['typ'] ?? '');
    $artikel = trim((string) ($zeile['artikel'] ?? ''));
    $namensraum = trim((string) ($zeile['namensraum'] ?? ''));
    $anzeige = trim((string) ($zeile['anzeige'] ?? ''));

    if (in_array($artikel, AVESMAPS_GARETIEN_SAMMELARTIKEL, true)
        || in_array($namensraum, AVESMAPS_GARETIEN_SAMMELARTIKEL, true)) {
        return 'Sammelartikel "' . ($artikel !== '' ? $artikel : $namensraum)
            . '" -- ausserhalb des gepflegten Gebiets, dort haben wir eigene Daten';
    }

    if ($anzeige === '' && $artikel === '') {
        return 'Zeile ohne jeden Namen';
    }

    // 💣 360 Zeilen haben KEINE Position -- die Marke `2000000 2000000` wird zu (1222 / -115,6).
    // Alle 360 stehen im Kosch, 359 auf kosch/Ortschaften_1 (72 % dieser Seite). Volkers Ansage
    // heisst "das Objekt gibt es, auf der Karte liegt es noch nicht". Importiert waeren sie
    // unsichtbar UND unerreichbar -- nicht einmal von Hand zu reparieren.
    // ⚠️ DIE KOORDINATE IST DAS SIGNAL, nicht die LOD-Spanne (8 der 360 tragen eine andere,
    // und 375 platzierte Zeilen tragen `14!14`).
    if (!avesmapsGaretienLiegtAufDerKarte(avesmapsGaretienZeilePunkte($zeile))) {
        return 'Keine Position -- die Quelle setzt die Marke "noch nicht auf der Karte"';
    }

    // 🔴 Owner 29.08.2026: „Stufen werden weder erklaert noch will ich, dass sie verhindern, dass
    // ich objekte importieren kann." Keine der beiden Meldungen nennt eine Stufe oder eine Zahl --
    // ein Editor liest, WAS fehlt, nicht WANN es angeblich kommt.
    $typKategorie = avesmapsGaretienTypKategorie($typ);
    if ($typKategorie === 'ohne_gegenstueck') {
        return 'Typ "' . $typ . '" hat bei uns kein Gegenstueck';
    }
    if ($typKategorie === 'unbekannt') {
        return 'Typ "' . $typ . '" ist unbekannt -- weder zugeordnet noch vorgemerkt';
    }

    return null;
}

/** Kurzform fuer den Aufrufer, der nur die Weiche braucht. */
function avesmapsGaretienUeberspringen(array $zeile): bool
{
    return avesmapsGaretienUeberspringGrund($zeile) !== null;
}

/** Die Geometrie einer Staging-Zeile in UNSEREN Karteneinheiten. */
function avesmapsGaretienZeilePunkte(array $zeile): array
{
    if ((string) ($zeile['geo_art'] ?? '') !== 'koordinaten') {
        return [];
    }

    return avesmapsGaretienLinieNachAvesmaps(
        avesmapsGaretienParseKoordinaten((string) ($zeile['geo'] ?? ''))
    );
}

/**
 * Jede Geometrie -- Point, LineString, Polygon, Multi* -- als flache Eckpunktliste.
 *
 * ⚠️ Fuer den Abgleich genuegen die Eckpunkte: gefragt ist "liegt hier schon so etwas", nicht
 * "wie sieht es genau aus".
 */
function avesmapsGaretienGeoJsonPunkte(mixed $geometrie): array
{
    if (is_string($geometrie)) {
        $geometrie = json_decode($geometrie, true);
    }
    if (!is_array($geometrie)) {
        return [];
    }
    $koordinaten = $geometrie['coordinates'] ?? $geometrie;
    $punkte = [];
    $sammle = static function (mixed $knoten) use (&$sammle, &$punkte): void {
        if (!is_array($knoten) || $knoten === []) {
            return;
        }
        if (is_numeric($knoten[0] ?? null) && is_numeric($knoten[1] ?? null)) {
            $punkte[] = [(float) $knoten[0], (float) $knoten[1]];

            return;
        }
        foreach ($knoten as $kind) {
            $sammle($kind);
        }
    };
    $sammle($koordinaten);

    return $punkte;
}

/** Gleichmaessig ausgeduennt auf hoechstens `AVESMAPS_GARETIEN_PROBEPUNKTE` Punkte. */
function avesmapsGaretienProbepunkte(array $punkte): array
{
    $anzahl = count($punkte);
    if ($anzahl <= AVESMAPS_GARETIEN_PROBEPUNKTE) {
        return $punkte;
    }
    $raus = [];
    for ($i = 0; $i < AVESMAPS_GARETIEN_PROBEPUNKTE; $i++) {
        $raus[] = $punkte[(int) floor($i * ($anzahl - 1) / (AVESMAPS_GARETIEN_PROBEPUNKTE - 1))];
    }

    return $raus;
}

/**
 * Die Kandidaten unseres Bestands zu einem Ziel -- je Lauf einmal geladen.
 *
 * 💣 GERECHNET AUS DER GEOMETRIE, NIE AUS DEN GESPEICHERTEN bbox-SPALTEN. `map_features` und
 * `ecosystem_area` tragen min_x/min_y/max_x/max_y, und die waeren der billige Vorfilter -- aber
 * sie stehen unter Verdacht, veraltet zu sein: seit dem 18.08.2026 ist "Was ist hier?" um
 * Al'Anfa blind, obwohl die Flaeche gezeichnet ist, und der einzige Filter, den das Panel hat
 * und der Politik-Layer nicht, sind genau diese Spalten. Eine veraltete bbox liesse hier einen
 * VORHANDENEN Fluss als "neu" durchgehen -- und die Uebernahme legte ihn ein zweites Mal an.
 * Das ist genau der Fehler, den dieser Abgleich verhindern soll.
 */
function &avesmapsGaretienKandidatenSpeicher(): array
{
    static $zwischenspeicher = [];

    return $zwischenspeicher;
}

/**
 * Den Kandidatenspeicher leeren.
 *
 * 🪤 ER IST NICHT NUR TEST-ZUCKER. Der Speicher gilt fuer den ganzen Prozess, und waehrend
 * eines Abgleichs ist das richtig -- unser Bestand aendert sich dabei nicht. NACH einer
 * Uebernahme (Aufgabe 6) aendert er sich sehr wohl: wer im selben Prozess erst uebernimmt und
 * dann noch einmal abgleicht, bekaeme sonst den Stand von vorher und legte dieselben Objekte
 * ein zweites Mal an. Beim Bau ist genau diese Falle zweimal zugeschnappt -- in beiden Faellen
 * sah es aus wie ein falsches Urteil des Abgleichs und war ein veralteter Speicher.
 */
function avesmapsGaretienKandidatenVergessen(): void
{
    $speicher = &avesmapsGaretienKandidatenSpeicher();
    $speicher = [];
}

function avesmapsGaretienKandidaten(PDO $pdo, array $ziel): array
{
    $zwischenspeicher = &avesmapsGaretienKandidatenSpeicher();
    // Die Verwandtschaft, in der gesucht wird -- ohne Angabe nur die eigene Art.
    $familie = $ziel['suchen'] ?? [[$ziel['kind'] ?? '', $ziel['subtyp']]];
    $schluessel = $ziel['ziel'] . '|' . json_encode($familie);
    if (isset($zwischenspeicher[$schluessel])) {
        return $zwischenspeicher[$schluessel];
    }

    // 🔴 DREI ZIELE LIEGEN IN map_features, EINES IN ecosystem_region -- `ziel` ist hier direkt
    // der feature_type-Wert ('path'/'location'/'label'), 'subtyp' der feature_subtype. Ort und
    // Berggipfel (seit 29.08.2026, Entwurf §3.1/§3.4) teilen sich die Abfrage mit dem Weg statt
    // eine zweite, fast gleiche danebenzustellen.
    if (in_array($ziel['ziel'], ['path', 'location', 'label'], true)) {
        $stmt = $pdo->prepare(
            'SELECT public_id, name, geometry_json AS geo, properties_json AS props'
            . ' FROM map_features'
            . ' WHERE feature_type = :typ AND feature_subtype = :subtyp AND is_active = 1'
        );
        $stmt->execute([':typ' => $ziel['ziel'], ':subtyp' => $ziel['subtyp']]);
    } else {
        // ⚠️ Die Flaeche liegt in ecosystem_area, nicht in ecosystem_region -- die Region traegt
        // nur Name und Art. Probeflaechen (`is_trial`) bleiben draussen: sie sind Entwuerfe.
        // ⚠️ Ueber die ganze Familie: unsere Einordnung darf von ihrer abweichen (Angbarer See).
        $bedingungen = [];
        $werte = [];
        foreach ($familie as $i => [$kind, $typKey]) {
            $bedingungen[] = '(r.kind = :k' . $i . ' AND r.region_type = :t' . $i . ')';
            $werte[':k' . $i] = (string) $kind;
            $werte[':t' . $i] = (string) $typKey;
        }
        $stmt = $pdo->prepare(
            'SELECT r.public_id, r.name, r.region_type, a.geometry_geojson AS geo, r.wiki_url AS props'
            . ' FROM ecosystem_region r JOIN ecosystem_area a ON a.region_id = r.id'
            . ' WHERE (' . implode(' OR ', $bedingungen) . ')'
            . ' AND r.is_active = 1 AND a.is_active = 1 AND a.is_trial = 0'
        );
        $stmt->execute($werte);
    }

    $kandidaten = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $punkte = avesmapsGaretienGeoJsonPunkte($zeile['geo']);
        if ($punkte === []) {
            continue;
        }
        $xs = array_column($punkte, 0);
        $ys = array_column($punkte, 1);
        $kandidaten[] = [
            'public_id' => (string) $zeile['public_id'],
            'name' => (string) ($zeile['name'] ?? ''),
            'art' => (string) ($zeile['region_type'] ?? ''),
            'props' => (string) ($zeile['props'] ?? ''),
            'punkte' => $punkte,
            // 🔴 Die Praefixe sind Absicht: diese Huellbox ist GERECHNET. Ohne sie liest sich
            // der Vergleich unten wie ein Zugriff auf die gespeicherten Spalten min_x/max_x --
            // genau die, die hier nicht benutzt werden duerfen.
            'huelle_min_x' => min($xs), 'huelle_max_x' => max($xs),
            'huelle_min_y' => min($ys), 'huelle_max_y' => max($ys),
        ];
    }
    $zwischenspeicher[$schluessel] = $kandidaten;

    return $kandidaten;
}

/**
 * WIE GUT IST IHR OBJEKT VON UNSEREM BESTAND ABGEDECKT? Median ueber die Probepunkte.
 *
 * 💣 UEBER ALLE KANDIDATEN ZUSAMMEN, NICHT GEGEN JEDEN EINZELN -- und daran ist die erste
 * Fassung gescheitert. Unsere Fluesse liegen in ABSCHNITTEN: "Der Grosse Fluss" in 38, der
 * Yaquir in 28, der Mhanadi in 26; 158 der 526 Namensgruppen sind mehrteilig (gemessen
 * 27.08.2026). Volkers Fassung ist EINE Linie -- ihr Grosser Fluss hat 294 Stuetzpunkte ueber
 * 296 Karteneinheiten. Gegen einen einzelnen unserer Abschnitte gemessen liegen 15 von 16
 * Probepunkten weit weg, der Median wird riesig, und das Urteil lautet "neu".
 *
 * 🔴 Der Preis waere die schlimmste Dublette gewesen, die dieser Import anrichten kann: die
 * groessten Fluesse Aventuriens ein zweites Mal auf der Karte -- ausgerechnet die, die wir
 * ganz sicher schon haben. Und vorangehakt, weil "neu" vorangehakt kommt.
 *
 * ⚠️ GERICHTET bleibt es: gemessen wird von IHREN Punkten zum naechsten Eckpunkt von UNS. Die
 * Frage ist "ist ihr Objekt bei uns schon da", nicht umgekehrt.
 * ⚠️ Der Median statt des Mittels, damit ein einzelner ueberstehender Zipfel das Urteil nicht
 * kippt (eine Muendung, ein historischer Zeichenfehler -- Volker nennt beides selbst).
 *
 * 🔴 Seit dieser Fassung gibt die Funktion zusaetzlich `abschnitte` heraus: die ganze
 * `$treffer`-Liste, absteigend sortiert, statt nur des einen genannten `bester`. Begruendung
 * und Reihenfolge-Zusicherung stehen direkt bei ihrer Entstehung, kurz vor dem `return`.
 *
 * @return array{abstand:float, bester:?int, abschnitte:list<array{index:int, punkte:int}>}
 */
function avesmapsGaretienDeckung(array $probe, array $kandidaten): array
{
    if ($probe === [] || $kandidaten === []) {
        return ['abstand' => INF, 'bester' => null, 'abschnitte' => []];
    }
    // Der Huellbox-Vorfilter einmal je Kandidat, nicht je Punkt.
    $naheKandidaten = [];
    foreach ($kandidaten as $k => $kandidat) {
        if (avesmapsGaretienHuellenBeruehrenSich($probe, $kandidat)) {
            $naheKandidaten[$k] = $kandidat;
        }
    }
    if ($naheKandidaten === []) {
        return ['abstand' => INF, 'bester' => null, 'abschnitte' => []];
    }

    $abstaende = [];
    $treffer = [];   // wie oft war dieser Kandidat der naechste?
    foreach ($probe as [$px, $py]) {
        $beste = INF;
        $wer = null;
        foreach ($naheKandidaten as $k => $kandidat) {
            foreach ($kandidat['punkte'] as [$kx, $ky]) {
                $d = (($px - $kx) ** 2) + (($py - $ky) ** 2);
                if ($d < $beste) {
                    $beste = $d;
                    $wer = $k;
                }
            }
        }
        $abstaende[] = sqrt($beste);
        if ($wer !== null) {
            $treffer[$wer] = ($treffer[$wer] ?? 0) + 1;
        }
    }
    sort($abstaende);
    $mitte = (int) floor((count($abstaende) - 1) / 2);
    // Der GENANNTE Treffer ist der, der die meisten Punkte abdeckt -- ein Mensch soll einen Namen
    // sehen, nicht eine Liste von achtunddreissig.
    arsort($treffer);

    // 🔴 UND DIE LISTE DAHINTER, weil das Fenster sie braucht (Auftrag §4.1): unsere Fluesse
    // liegen in ABSCHNITTEN, ihre nicht. Ihre "Natter" trifft fuenf unserer Abschnitte auf DREI
    // verschiedenen Fluessen; gehakt wird je Abschnitt, nie je Objekt. Ohne diese Zeilen wuerde
    // dieselbe Rechnung im Browser ein zweites Mal gebaut -- die Grenze, die der Auftrag §5.4
    // ausdruecklich zieht.
    // ⚠️ ERGAENZUNG, KEIN ERSATZ: `bester` und `abstand` bleiben unangetastet -- sie haben
    // ihre eigenen Leser.
    // 💣 Hier stand eine ZAHL ("vier Aufrufer"), und sie war falsch: es ist genau einer.
    // Eine Zahl im Kommentar liest sich wie eine vollstaendige Liste, und niemand zaehlt nach --
    // genau daran ist am 14.08.2026 die Verkehrsmittel-Sperre gescheitert (AGENTS.md §11).
    $abschnitte = [];
    foreach ($treffer as $k => $anzahl) {
        $abschnitte[] = ['index' => (int) $k, 'punkte' => (int) $anzahl];
    }

    return [
        'abstand' => $abstaende[$mitte],
        'bester' => $treffer === [] ? null : (int) array_key_first($treffer),
        'abschnitte' => $abschnitte,
    ];
}

/**
 * Traegt dieser Kandidat den Wiki-Artikel der Importzeile?
 *
 * ⚠️ Er trifft in der Praxis selten, und das ist kein Fehler: unsere `wiki_url` zeigt fast immer
 * auf das Wiki Aventurica, Volkers Artikel liegen auf garetien.de und koschwiki.de. Der Weg
 * bleibt trotzdem drin -- er kostet nichts und ist der EINZIGE eindeutige: ein Wiki-Seitenname
 * ist eindeutig, eine Geometrie ist eine Schaetzung ueber zwei von Hand gemalte Karten.
 */
function avesmapsGaretienArtikelTrifft(array $zeile, array $kandidat): bool
{
    $artikel = trim((string) ($zeile['artikel'] ?? ''));
    if ($artikel === '' || $kandidat['props'] === '') {
        return false;
    }
    $namensraum = trim((string) ($zeile['namensraum'] ?? ''));
    $voll = ($namensraum !== '' ? $namensraum . ':' : '') . $artikel;

    // Der Artikelname steht in der Adresse mit Unterstrichen ODER mit Leerzeichen.
    foreach ([$voll, str_replace(' ', '_', $voll)] as $form) {
        if (str_contains($kandidat['props'], '=' . $form)
            || str_contains($kandidat['props'], '/' . $form)) {
            return true;
        }
    }

    return false;
}

/**
 * Die Ausdehnung einer Punktfolge: Streckenlaenge bei einer Linie, Umfang bei einem Ring.
 * Beides in Karteneinheiten, beides derselbe Rechenweg.
 */
function avesmapsGaretienAusdehnung(array $punkte): float
{
    $summe = 0.0;
    $anzahl = count($punkte);
    for ($i = 1; $i < $anzahl; $i++) {
        $summe += sqrt((($punkte[$i][0] - $punkte[$i - 1][0]) ** 2) + (($punkte[$i][1] - $punkte[$i - 1][1]) ** 2));
    }

    return $summe;
}

/**
 * 💣 EIN ZUFLUSS LIEGT AUF SEINEM HAUPTFLUSS, UND DER ABSTAND ALLEIN SIEHT DAS NICHT.
 *
 * Live gemessen am 26.08.2026 gegen 1108 Flusswege und 386 Gewaesserflaechen: von 76
 * Geometrietreffern hatten 25 auf beiden Seiten verschiedene Namen -- und die meisten davon
 * waren Zufluesse, die auf ihren Hauptfluss gefallen sind. "Seitenarm der Natter" traf
 * "Natter" auf 0,29 Einheiten, "Amaralyssee" traf den "Angbarer See" auf 1,75. Der Abstand war
 * winzig; der Zufluss laeuft eben neben dem Fluss her.
 *
 * 🔴 Und das ist der TEURE Fehler, nicht der harmlose: "deckt_sich" erzeugt KEINEN Vorschlag
 * (Aufgabe 5). Diese Baeche waeren also stillschweigend nicht importiert worden -- kein
 * Eintrag, keine Meldung, nichts zum Nachsehen. Genau die Klasse Ausfall, die dieses Projekt
 * schon beim leeren Quellenkasten und beim nie gespeicherten Tempowert bezahlt hat.
 *
 * ⭐ Die Ausdehnung trennt sie sauber: unterhalb dieser Schranke war jeder einzelne der 25
 * Faelle ein Zufluss oder Seitenarm, oberhalb jeder einzelne ein echtes gleiches Objekt. Die
 * naechsten Nachbarn der Schranke sind "Nebenarm des Grossen Flusses" (0,74, Seitenarm) und
 * "See SW vom Ochsenwasser" (0,82, echt).
 *
 * ⚠️ EINSEITIG, und das ist der Punkt. Geprueft wird nur, ob IHR Objekt viel KLEINER ist als
 * unseres. Die Gegenrichtung ist erlaubt und normal: unsere Wege liegen in Abschnitten
 * ("Reichsstrasse 2" in 57), ihr ganzer Fluss darf also ein Vielfaches unseres Abschnitts
 * sein. Eine symmetrische Schranke wuerde genau diese gesunden Treffer verwerfen.
 */
const AVESMAPS_GARETIEN_AUSDEHNUNG_MINDESTVERHAELTNIS = 0.75;

/**
 * So viele Stuetzpunkte je Abschnitt reisen mit. Sie sind fuer den goldenen SCHEIN unter unserem
 * Bestand gedacht, nicht fuer eine Vermessung -- und ein Schein braucht die Form, nicht jeden
 * Knick.
 *
 * ⚠️ Die Zahl ist eine NUTZLASTGRENZE, keine Genauigkeitsgrenze. Live gemessen: unsere laengsten
 * Flussabschnitte tragen dreistellige Stuetzpunktzahlen, und ein Objekt kann 13 Abschnitte
 * treffen (Der Grosse Fluss). Ungedeckelt waeren das im schlimmsten Fall einige tausend Paare in
 * EINER after_json -- fuer eine Liste, die 259 solcher Zeilen zeigt.
 */
const AVESMAPS_GARETIEN_ABSCHNITT_PUNKTE = 64;

/**
 * Die getroffenen Abschnitte, wie das Fenster sie braucht: Name (oder leer), Deckung, Geometrie.
 *
 * 🔴 KEINE ZWEITE RECHNUNG. Die Indizes kommen aus `avesmapsGaretienDeckung`, die Punkte aus dem
 * Kandidaten, der ohnehin geladen ist. Hier wird nur umgepackt.
 */
function avesmapsGaretienAbschnitte(array $deckung, array $kandidaten): array
{
    $raus = [];
    foreach ($deckung['abschnitte'] ?? [] as $eintrag) {
        $kandidat = $kandidaten[$eintrag['index']] ?? null;
        if ($kandidat === null) {
            continue;
        }
        $raus[] = [
            'public_id' => (string) $kandidat['public_id'],
            // ⚠️ Ein LEERER Name ist die Auskunft, nicht die Abwesenheit einer Auskunft: 25 von 76
            // Geometrietreffern trugen bei uns gar keinen Namen. Genau die sind der vierte Ausgang.
            'name' => (string) ($kandidat['name'] ?? ''),
            'punkte' => (int) $eintrag['punkte'],
            'geometrie' => avesmapsGaretienProbepunkteN(
                $kandidat['punkte'], AVESMAPS_GARETIEN_ABSCHNITT_PUNKTE
            ),
        ];
    }

    return $raus;
}

/** Gleichmaessig ausgeduennt auf hoechstens `$deckel` Punkte -- die Form von `avesmapsGaretienProbepunkte`, frei waehlbare Zahl. */
function avesmapsGaretienProbepunkteN(array $punkte, int $deckel): array
{
    $anzahl = count($punkte);
    if ($anzahl <= $deckel || $deckel < 2) {
        return $punkte;
    }
    $raus = [];
    for ($i = 0; $i < $deckel; $i++) {
        $raus[] = $punkte[(int) floor($i * ($anzahl - 1) / ($deckel - 1))];
    }

    return $raus;
}

/**
 * Der Abgleich einer Staging-Zeile gegen unseren Bestand.
 *
 * Reihenfolge (Entwurf §5.2): Artikelname -> Geometrie -> Name (nie allein).
 *
 * 💣 Namensgleichheit beweist nichts, und Namensungleichheit auch nicht: ein reiner
 * Namensvergleich meldete "Grosser Fluss" als neu, obwohl wir ihn als "Der Grosse Fluss"
 * fuehren -- und in Volkers eigenem Bestand gibt es "Aehrenfeld" dreimal.
 *
 * 🔴 `anlass` ist ein FELD, kein Text. Der Planbauer muss unterscheiden, WARUM etwas
 * widerspricht -- ein Zufluss ist ein eigenes neues Objekt, ein Artikelwiderspruch eine Frage
 * an denselben. Wer das aus `grund` herausliest, haengt eine Programmentscheidung an einen
 * deutschen Satz, den der naechste Leser umformuliert.
 *
 * @return array{status:string, anlass:?string, treffer_public_id:?string, treffer_name:?string, grund:string, abstand:?float, abschnitte:list<array{public_id:string, name:string, punkte:int, geometrie:array}>}
 */
function avesmapsGaretienFindeBestand(PDO $pdo, array $zeile, ?array $ziel): array
{
    if ($ziel === null) {
        return [
            'status' => 'uebersprungen',
            'anlass' => null,
            'treffer_public_id' => null,
            'treffer_name' => null,
            'grund' => (string) (avesmapsGaretienUeberspringGrund($zeile) ?? 'kein Ziel'),
            'abstand' => null,
            'abschnitte' => [],
        ];
    }

    $kandidaten = avesmapsGaretienKandidaten($pdo, $ziel);
    $punkte = avesmapsGaretienZeilePunkte($zeile);
    $probe = avesmapsGaretienProbepunkte($punkte);

    // 1. Der Artikelname -- eindeutig, weil Wiki-Seitenname.
    foreach ($kandidaten as $kandidat) {
        if (!avesmapsGaretienArtikelTrifft($zeile, $kandidat)) {
            continue;
        }
        $abstand = $probe === [] ? INF : avesmapsGaretienDeckung($probe, [$kandidat])['abstand'];
        // 🔴 Trifft der Artikel, liegt die Geometrie aber woanders, ist das ein WIDERSPRUCH und
        // kein Treffer: derselbe Artikel behauptet zwei Stellen. Das gehoert einem Menschen
        // vorgelegt, nicht stillschweigend entschieden.
        $passt = $abstand <= AVESMAPS_GARETIEN_TREFFER_EINHEITEN;

        return [
            'status' => $passt ? 'deckt_sich' : 'widerspricht',
            'anlass' => $passt ? 'artikel' : 'artikel_widerspruch',
            'treffer_public_id' => $kandidat['public_id'],
            'treffer_name' => $kandidat['name'],
            'grund' => $passt
                ? sprintf('Artikel trifft "%s", Geometrie %.2f Einheiten entfernt', $kandidat['name'], $abstand)
                : sprintf('Artikel trifft "%s", aber die Geometrie liegt %.2f Einheiten entfernt',
                    $kandidat['name'], $abstand),
            'abstand' => is_finite($abstand) ? $abstand : null,
            // Der Artikeltreffer wird gegen GENAU DIESEN EINEN Kandidaten gemessen, wie schon
            // der `abstand` darueber -- keine zweite Deckung ueber den ganzen Bestand.
            'abschnitte' => avesmapsGaretienAbschnitte(avesmapsGaretienDeckung($probe, [$kandidat]), [$kandidat]),
        ];
    }

    if ($probe === []) {
        return [
            'status' => 'neu',
            'anlass' => null,
            'treffer_public_id' => null,
            'treffer_name' => null,
            'grund' => 'keine vergleichbare Geometrie in der Quelle',
            'abstand' => null,
            'abschnitte' => [],
        ];
    }

    // 2. Die Geometrie -- der Arbeitsweg beim ersten Lauf.
    $deckung = avesmapsGaretienDeckung($probe, $kandidaten);
    $besterAbstand = $deckung['abstand'];
    $bester = $deckung['bester'] === null ? null : $kandidaten[$deckung['bester']];

    if ($bester !== null && $besterAbstand <= AVESMAPS_GARETIEN_TREFFER_EINHEITEN) {
        // 3. Der Name -- NUR als Zusatz zur Meldung, nie als Entscheidung.
        $gleicherName = avesmapsGaretienNamenAehnlich(
            (string) ($zeile['anzeige'] ?? ''),
            $bester['name']
        );

        // 💣 Die Ausdehnung -- der Riegel gegen den Zufluss auf seinem Hauptfluss.
        //
        // 🪤 GEGEN DEN EINEN Kandidaten, der am meisten abdeckt -- und NICHT gegen die Summe
        // aller beteiligten. Das stand hier einen Moment lang anders, mit der Begruendung, ein
        // ganzer Fluss saehe gegen ein einzelnes Stueck wie ein Zufluss aus. Das ist falsch
        // herum gerechnet: gegen ein KURZES Stueck gemessen wird ihr Fluss RELATIV GROSS
        // (296 gegen 8 ist Verhaeltnis 37), er faellt also gar nicht in den Riegel. Und der
        // Zufluss faellt weiter hinein (0,7 gegen 31 ist 0,02). Beide Faelle stimmen schon mit
        // der einfachen Regel.
        //
        // ⚠️ Die Summe waere sogar SCHAERFER und haette einen neuen Fehlalarm gebracht: ein
        // Objekt genau an der Grenze zweier unserer Abschnitte wird gegen BEIDE gehalten, sein
        // Verhaeltnis halbiert sich, und ein voellig normaler Treffer gilt als Zufluss.
        $ihre = avesmapsGaretienAusdehnung($punkte);
        $unsere = avesmapsGaretienAusdehnung($bester['punkte']);
        $verhaeltnis = $unsere > 0.0 ? $ihre / $unsere : 1.0;
        // 🔴 Der gleiche NAME an der gleichen STELLE hebt den Ausdehnungsriegel auf, und das ist
        // der Name als BESTAETIGENDES Zusatzsignal -- er entscheidet nichts allein, er rettet nur
        // einen Treffer, den die Geometrie schon gefunden hat. Live gemessen 27.08.2026: von 34
        // geflaggten Faellen tragen 2 denselben Namen ("Pilperbach", "Wirselbach"), und beide
        // sind offensichtlich dasselbe Gewaesser -- bei uns nur laenger gezeichnet. Ohne diese
        // Zeile stuenden sie als "vermutlich ein Zufluss" in der Liste, und eine Liste mit
        // offensichtlichem Unsinn darin bringt einem Editor bei, sie zu ueberfliegen.
        $vergleichbar = $verhaeltnis >= AVESMAPS_GARETIEN_AUSDEHNUNG_MINDESTVERHAELTNIS || $gleicherName;

        return [
            // 🔴 Nicht vergleichbar heisst NICHT "neu" und NICHT "deckt sich", sondern
            // "sieh es dir an": es liegt etwas an derselben Stelle, aber es ist kleiner --
            // vermutlich ein Zufluss. Als "neu" durchgewinkt legten wir eine Dublette an, als
            // "deckt sich" verschwaende der Bach stillschweigend.
            'status' => $vergleichbar ? 'deckt_sich' : 'widerspricht',
            'anlass' => $vergleichbar ? 'geometrie' : 'zufluss',
            'treffer_public_id' => $bester['public_id'],
            'treffer_name' => $bester['name'],
            // ⚠️ Weicht unsere ART von ihrer ab, gehoert das in den Grund. Sonst steht da nur
            // "gefunden", und niemand sieht, dass ihr `Meer` bei uns ein `see` ist -- die Zeile
            // saehe aus wie ein Treffer ohne Besonderheit, und die Frage, welche Einordnung
            // stimmt, wuerde nie gestellt.
            'grund' => sprintf(
                'Geometrie liegt %.2f Einheiten von "%s"%s%s%s',
                $besterAbstand,
                $bester['name'],
                ($bester['art'] ?? '') !== '' && $bester['art'] !== $ziel['subtyp']
                    ? ' [bei uns als ' . $bester['art'] . ', nicht ' . $ziel['subtyp'] . ']'
                    : '',
                $gleicherName ? ' (Name passt auch)' : ' (anderer Name)',
                $vergleichbar
                    ? ''
                    : sprintf(', aber nur %.0f %% seiner Ausdehnung -- vermutlich ein Zufluss oder Seitenarm',
                        $verhaeltnis * 100.0)
            ),
            'abstand' => $besterAbstand,
            'abschnitte' => avesmapsGaretienAbschnitte($deckung, $kandidaten),
        ];
    }

    return [
        'status' => 'neu',
        'anlass' => null,
        'treffer_public_id' => null,
        'treffer_name' => $bester === null ? null : $bester['name'],
        'grund' => $bester === null
            ? 'nichts desselben Typs in der Naehe'
            : sprintf('naechstes gleichartiges Objekt "%s" liegt %.2f Einheiten entfernt',
                $bester['name'], $besterAbstand),
        'abstand' => $bester === null ? null : $besterAbstand,
        // ⚠️ `$deckung` ist hier noch im Gueltigkeitsbereich -- sie wird VOR der if-Verzweigung
        // oben gerechnet und deckt auch den Fall ab, in dem kein Kandidat die Schwelle erreicht.
        'abschnitte' => avesmapsGaretienAbschnitte($deckung, $kandidaten),
    ];
}

/** Huellbox-Vorfilter, mit der Trefferschwelle als Rand. */
function avesmapsGaretienHuellenBeruehrenSich(array $probe, array $kandidat): bool
{
    $xs = array_column($probe, 0);
    $ys = array_column($probe, 1);
    $rand = AVESMAPS_GARETIEN_TREFFER_EINHEITEN;

    return min($xs) - $rand <= $kandidat['huelle_max_x']
        && max($xs) + $rand >= $kandidat['huelle_min_x']
        && min($ys) - $rand <= $kandidat['huelle_max_y']
        && max($ys) + $rand >= $kandidat['huelle_min_y'];
}

/**
 * Schwaches Namenssignal. NIE allein entscheidend (Entwurf §5.2).
 *
 * Unser "Der Grosse Fluss" und ihr "Grosser Fluss" sind dasselbe; Artikel und Endungen fallen
 * deshalb heraus. Das reicht fuer eine Bemerkung im Grund -- und fuer mehr wird es nicht benutzt.
 */
function avesmapsGaretienNamenAehnlich(string $a, string $b): bool
{
    $normalisiere = static function (string $s): string {
        $s = mb_strtolower(trim($s), 'UTF-8');
        $s = preg_replace('~^(der|die|das)\s+~u', '', $s) ?? $s;

        return preg_replace('~[^\p{L}\p{N}]+~u', '', $s) ?? $s;
    };
    $a = $normalisiere($a);
    $b = $normalisiere($b);
    if ($a === '' || $b === '') {
        return false;
    }

    return $a === $b || str_starts_with($a, $b) || str_starts_with($b, $a);
}
