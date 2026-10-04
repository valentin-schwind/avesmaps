<?php

declare(strict_types=1);

// Zwei lesende Exporte fuer Avesmaps3D -- Bibliothek zu
//   GET /api/app/wiki-linkziele-export.php   (X1: Linkziele je Objekt und Wiki-Feld)
//   GET /api/app/wiki-zuordnung-export.php   (X2: Zuordnungstafel wiki_key -> public_id)
//
// Auftrag von Avesmaps3D (05.10.2026): jedes Kartenobjekt, das in einem Wiki-Feld GENANNT wird, soll dort ueber
// seinen Wiki-Key verlinkt werden -- nie ueber den Namen (Owner-Entscheid 08.09.2026 „Zuweisung im Wiki
// gewinnt", kein Raten; docs/abenteuer-feature-design.md §5). Beispiel Gareth, Feld Verkehrswege:
//   „[[Reichsstrasse 2|Reichsstrassen 2]] und [[Reichsstrasse 3|3]], [[Gardel]]"
// -> drei Links, jeder mit seinem Ziel; das Ziel wird ueber X2 zum Kartenobjekt.
//
// 🔴 NUR LESEND. Kein Schreibweg, keine Schemaheilung, kein Revisionssprung, kein Live-Abruf am Wiki. Jede
// Abfrage in dieser Datei ist ein SELECT; die Test-Datei fuehrt beide Exporte gegen eine Datenbank aus, die
// jede nicht-lesende Anweisung mitprotokolliert, und haelt den Datenbankinhalt davor und danach gegeneinander.
// ⚠️ Auch die Tabellen werden NICHT angelegt: fehlt eine, ist das ein 500 -- kein stilles „nichts vorhanden",
// das wie ein leeres Ergebnis aussaehe (dieselbe Regel wie api/_internal/app/political-territories-export.php).
//
// 🔴 DER WIKITEXT KOMMT AUS DEM SANDKASTEN `wiki_dump_hybrid_state` (der Dump-Lauf, den „Dump holen" dort
// abgelegt hat), nie aus einem Abruf. Die Syncs schreiben nur ins Staging, und die Nester an den Kartenobjekten
// tragen nur Klartext -- `territories-parsing.php` wirft beim Bereinigen das Ziel weg („[[Ziel|Anzeige]]" -> „Anzeige").
// Der Sandkasten ist die einzige Stelle, an der das Ziel noch steht. Er haelt die Zeilen EINES abgeschlossenen
// Laufs (`cleanup_state` raeumt die uebrigen), und genau den liest der Export: den juengsten `dump_read` mit
// status = 'completed'. Dessen Kennung und Abschlusszeit stehen in der Antwort (`dump`).
// ⚠️ Was der Sandkasten nicht kennt, liefert KEINE Links, und das steht ausdruecklich in `ohne_wikitext`
// (Objekt zeigt auf eine Seite, die der Lauf nicht hat) -- nicht als leere Felder, die wie „keine Links" aussaehen.
//
// 🔴 SCHLUESSEL, EINE REGEL FUER BEIDE SEITEN: ein Titel wird zu einem kanonischen Wiki-Key
//   1. Titel normalisieren (Unterstrich -> Leerzeichen, „#Abschnitt" ab),
//   2. Weiterleitung: `wiki_redirect_alias.alias_slug` = Slug des Titels -> `canonical_wiki_key`,
//   3. sonst `avesmapsWikiDumpCanonicalWikiKeyForTitle` -> 'wiki:' . Slug (dieselbe Ableitung wie die Crawler).
// X1 (`ziel_key`) und X2 (`wiki_key`) laufen durch DIESELBE Funktion (avesmapsWikiLinkzieleKey) -- zwei Faelle
// derselben Frage sind genau so auseinandergelaufen, wie AGENTS.md §10 es beschreibt. Der Slug ist die feste
// Faltungstafel des Hauses (Umlaute -> '?' -> Bindestrich), NICHT „huebscher": Gareth ist 'wiki:gareth', Fuerstentum
// Kosch 'wiki:f-rstentum-kosch'. ⚠️ Die Faltung ist verlustbehaftet -- zwei verschiedene Titel koennen denselben Slug
// haben. Dafuer steht `seiten_schluesselkollision` im Kopf von X1; verglichen wird nie ein Name.
// 🔴 Aus der Tabelle `wiki_redirect_alias` wird NUR gelesen. Der Export der Weiterleitungen (E1++) ist eine andere
// Baustelle und wird hier nicht benutzt.
//
// ⚠️ Eine Vorlage wie {{Pol|Baronie Raulsmark}} im Feld Staat ist KEIN Link dieses Exports -- ob sie auf die Seite
// verweist, steht in der Vorlage, nicht im Quelltext (Kommentar in link-ziele.php). Gemessen am Dump vom
// 08.09.2026 betrifft das rund 1.045 von 2.827 Siedlungs-Staat-Feldern. Wie viele Felder solche Vorlagen statt Links
// tragen, steht im Kopf von X1 (`vorlagen_in_feldern`), damit die Luecke sichtbar ist, statt als „keine Links" zu gelten.
//
// ⚠️ Keine Drossel: wie map-features.php. Die Antworten sind gross (X1 mehrere hundert KB) -- ein Werkzeug holt sie auf
// Zuruf, nie in einer Schleife (CLAUDE.md, STRATO).

require_once __DIR__ . '/../political/territory.php';
require_once __DIR__ . '/../wiki/sync.php';
require_once __DIR__ . '/../wiki/sync-monitor.php';
require_once __DIR__ . '/../wiki/sync-monitor-parsing.php';
require_once __DIR__ . '/../wiki/dump-reader.php';
require_once __DIR__ . '/../wiki/link-ziele.php';
require_once __DIR__ . '/../wiki/namespaces.php';

// Die Wiki-Nester an den Kartenobjekten, in der Reihenfolge, in der der Lesepfad der Karte und das Konfliktzentrum
// sie fragen (api/_internal/conflicts/core.php AVESMAPS_CONFLICT_CLAIM_BLOCKS -- ein Test haelt beide Listen gleich).
// Paare [Nest, Art des Objekts]. 🔴 Gelesen wird NUR das Nest, nie das flache `wiki_url`: das raet der Lesepfad der Karte
// bei Leere per Namen nach (99 Phantome bei den Orten, 12 bei den Wegen, AGENTS.md §11) und ist keine Zuweisung.
// ⚠️ Als Paarliste und nicht als Tafel `'wiki_region' => 'region'`, mit Absicht: landschaft-wiki-schreiber-waechter-test.php
// zaehlt jeden Array-Schluessel `'wiki_region' =>` im api/-Baum als moeglichen zweiten SCHREIBER der Landschafts-Zuweisung.
// Diese Datei schreibt nichts -- die Paarform sagt es dem Waechter, ohne seine Liste zu veraendern.
const AVESMAPS_WIKI_LINKZIELE_NESTER = [
    ['wiki_settlement', 'siedlung'],
    ['wiki_region', 'region'],
    ['wiki_path', 'weg'],
    ['wiki_powerline', 'kraftlinie'],
];

// feature_type -> die Art, unter der unzugewiesene Objekte gezaehlt werden. Kreuzungen und Abzweige (crossing, junction)
// sind keine Wiki-Objekte und fehlen mit Absicht.
const AVESMAPS_WIKI_LINKZIELE_FEATURE_ARTEN = [
    'location' => 'siedlung',
    'path' => 'weg',
    'powerline' => 'kraftlinie',
    'label' => 'region',
];

// Die Arten der Antwort, in fester Reihenfolge. `landschaft` = Flaeche der Landschaftsebenen (ecosystem_region),
// `region` = Beschriftung mit Wiki-Zuweisung, `gebiet` = Herrschaftsgebiet.
const AVESMAPS_WIKI_LINKZIELE_ARTEN = ['siedlung', 'weg', 'region', 'kraftlinie', 'landschaft', 'gebiet'];

// 🔴 DIE POSITIVLISTE DER INFOBOX-FELDER, je Seitenart des Sandkastens (`entity_kind`). Ausgegeben wird NUR, was hier
// steht -- ein weiteres Infobox-Feld (und jede Wartungsvariable des Wikis) faellt STILL HERAUS statt still hinein.
// Der Schluessel ist der Ausgabename; die Aliase sind die normalisierten Feldschluessel des Legacy-Parsers
// (avesmapsWikiSyncMonitorFieldKey: klein, Umlaute gefaltet, nur a-z0-9), der erste nichtleere Alias gewinnt -- wie
// `avesmapsWikiSyncMonitorField`.
//   settlement: region, staat, oberhaupt/herrscher/herrschaft, bevoelkerungsmehrheit, handelszone, verkehrswege, tempel
//               -- genau die Felder, die avesmapsWikiSettlementParseInfobox liest -- plus die acht Nachbarn.
//   building:   standort (['standort','lage','ort'] wie avesmapsWikiDumpParseBuildingPage), verkehrswege, Nachbarn.
//   region:     region/regionen, staat (wie avesmapsWikiRegionParsePage), verkehrswege, Nachbarn.
//   path:       lage = regionen/region/lage, verlauf (wie avesmapsWikiPathParsePage).
//   powerline:  regionen = regionen/region/lage, verlauf (wie avesmapsWikiPowerlineParsePage).
// ⚠️ „derographie" steht nicht darin: kein Infobox-Parameter dieses Namens kommt im Dump vom 08.09.2026 vor.
// ⚠️ Das Verlaufsfeld nennt ALLE Links des Rohtexts in Quelltext-Reihenfolge -- auch Abzweig-, Querungs- und Zuflussziele
// fremder Wege. Die „Stationen dieses Weges" rechnet nur avesmapsWikiPathExtractVerlaufStations, und die gibt Anzeigetexte
// zurueck, keine Ziele. Wer die Strecke braucht, nimmt die ERSTE Position der Zeilenvorlagen -- das ist eine eigene Frage.
const AVESMAPS_WIKI_LINKZIELE_NACHBARN = [
    'nachbar_n' => ['nord'],
    'nachbar_no' => ['nordost'],
    'nachbar_o' => ['ost'],
    'nachbar_so' => ['sudost'],
    'nachbar_s' => ['sud'],
    'nachbar_sw' => ['sudwest'],
    'nachbar_w' => ['west'],
    'nachbar_nw' => ['nordwest'],
];

const AVESMAPS_WIKI_LINKZIELE_FELDER = [
    'settlement' => [
        'region' => ['region'],
        'staat' => ['staat'],
        'oberhaupt' => ['oberhaupt', 'herrscher', 'herrschaft'],
        'bevoelkerungsmehrheit' => ['bevolkerungsmehrheit', 'bevoelkerungsmehrheit', 'bevolkerung', 'bevoelkerung'],
        'handelszone' => ['handelszone'],
        'verkehrswege' => ['verkehrswege', 'verkehr'],
        'tempel' => ['tempel', 'geweihte', 'geweihtenschaft'],
    ] + AVESMAPS_WIKI_LINKZIELE_NACHBARN,
    'building' => [
        'standort' => ['standort', 'lage', 'ort'],
        'verkehrswege' => ['verkehrswege', 'verkehr'],
    ] + AVESMAPS_WIKI_LINKZIELE_NACHBARN,
    'region' => [
        'region' => ['region', 'regionen'],
        'staat' => ['staat'],
        'verkehrswege' => ['verkehrswege'],
    ] + AVESMAPS_WIKI_LINKZIELE_NACHBARN,
    'path' => [
        'lage' => ['regionen', 'region', 'lage'],
        'verlauf' => ['verlauf'],
    ],
    'powerline' => [
        'regionen' => ['regionen', 'region', 'lage'],
        'verlauf' => ['verlauf'],
    ],
];

// Wie oft gelesen wird, bevor der Endpunkt aufgibt, weil sich der Stand waehrend des Lesens bewegt.
const AVESMAPS_WIKI_LINKZIELE_VERSUCHE = 3;

// Wie viele Seiten-Zeilen je Abfrage mit Text geholt werden (Speicher: ein Wikitext kann hunderte KB tragen).
const AVESMAPS_WIKI_LINKZIELE_STAPEL = 150;

// Die haeufigsten Linkziele ohne Kartenobjekt, die der Kopf nennt.
const AVESMAPS_WIKI_LINKZIELE_TOP_OHNE_OBJEKT = 30;

// Der Stand hat sich bei jedem Versuch unter dem Lesen bewegt -- es wird gerade viel gespeichert.
final class AvesmapsWikiLinkzieleExportInBewegung extends RuntimeException
{
}

// ===========================================================================
// 1. REIN: Schluessel.
// ===========================================================================

/**
 * Die Weiterleitungstafel als Karte `alias_slug => canonical_wiki_key`. Eine einzige Abfrage (rund 26.000 Zeilen).
 *
 * 🔴 NUR LESEN. Die Tabelle legt der WikiSync-Monitor an; fehlt sie, ist das ein Fehler (500), keine leere Tafel --
 * eine leere Tafel hiesse „kein Titel ist eine Weiterleitung" und kanonisierte still falsch.
 *
 * @return array<string,string>
 */
function avesmapsWikiLinkzieleAliase(PDO $pdo): array
{
    $statement = $pdo->query('SELECT alias_slug, canonical_wiki_key FROM wiki_redirect_alias');
    $aliase = [];
    foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_NUM) : [] as $zeile) {
        $key = trim((string) $zeile[1]);
        if ($key !== '') {
            $aliase[(string) $zeile[0]] = $key;
        }
    }

    return $aliase;
}

/**
 * REIN: der kanonische Wiki-Key eines Seitentitels. Leer, wenn der Titel keinen Schluessel hergibt.
 *
 * 💣 `$aliase` ist ein PHP-Array, und PHP macht aus dem Schluessel „2026" einen Integer -- `isset($aliase[$slug])`
 * trifft ihn trotzdem, weil die Umwandlung auf beiden Seiten gleich ist. Nicht mit `array_key_exists($slug, …)` und
 * `===` auf dem Schluessel vergleichen.
 *
 * @param array<string,string> $aliase
 */
function avesmapsWikiLinkzieleKey(string $titel, array $aliase): string
{
    $titel = avesmapsWikiSyncMonitorNormalizeTitle($titel);
    if ($titel === '') {
        return '';
    }
    $slug = avesmapsPoliticalSlug($titel);
    if ($slug !== '' && isset($aliase[$slug]) && $aliase[$slug] !== '') {
        return $aliase[$slug];
    }

    return avesmapsWikiDumpCanonicalWikiKeyForTitle($titel);
}

/**
 * REIN: der Seitentitel hinter einer Wiki-Adresse („…/wiki/Havena_(Siedlung)" -> „Havena (Siedlung)"). Leer, wenn die
 * Adresse keinen `/wiki/`-Pfad traegt -- ein Schluessel wird aus einer fremden Adresse nicht geraten.
 */
function avesmapsWikiLinkzieleTitelAusUrl(string $url): string
{
    $pfad = parse_url(trim($url), PHP_URL_PATH);
    if (!is_string($pfad) || $pfad === '' || preg_match('#/wiki/(.+)$#u', rawurldecode($pfad), $treffer) !== 1) {
        return '';
    }

    return avesmapsWikiSyncMonitorNormalizeTitle(str_replace('_', ' ', (string) $treffer[1]));
}

/**
 * REIN: der Schluessel einer Zuordnung aus ihrer Wiki-Adresse -- dieselbe Regel wie fuer ein Linkziel.
 *
 * @param array<string,string> $aliase
 */
function avesmapsWikiLinkzieleKeyAusUrl(string $url, array $aliase): string
{
    return avesmapsWikiLinkzieleKey(avesmapsWikiLinkzieleTitelAusUrl($url), $aliase);
}

/**
 * REIN: der Schluessel aus einem GESPEICHERTEN Wiki-Key („wiki:slug" oder der blanke Slug der Landschaften), durch die
 * Weiterleitungstafel. Ein Schluessel mit anderem Praefix („name:", „eigener-knoten:") ist KEINE Wiki-Zuweisung und
 * ergibt ''.
 *
 * @param array<string,string> $aliase
 */
function avesmapsWikiLinkzieleKeyAusGespeichertem(string $gespeichert, array $aliase, bool $blankerSlugErlaubt): string
{
    $gespeichert = trim($gespeichert);
    if ($gespeichert === '') {
        return '';
    }
    if (str_starts_with($gespeichert, 'wiki:')) {
        $slug = substr($gespeichert, 5);
    } elseif ($blankerSlugErlaubt && !str_contains($gespeichert, ':')) {
        $slug = $gespeichert;
    } else {
        return '';
    }
    if ($slug === '') {
        return '';
    }

    return isset($aliase[$slug]) && $aliase[$slug] !== '' ? $aliase[$slug] : 'wiki:' . $slug;
}

/**
 * REIN: der Namensraum eines Seitentitels aus seinem PRAEFIX -- {ns:int, ns_name:string}. Hauptraum = 0 / ''.
 *
 * 🔴 Der Namensraum geht NIE verloren und wird NIE in den Namen hineingefaltet: „Dju'imen" (Hauptraum, offiziell) und
 * „Inoffiziell:Dju'imen" (ns 222) sind zwei Artikel, und der Slug hat sie schon getrennt ('wiki:dju-imen' gegen
 * 'wiki:inoffiziell-dju-imen'). `ns` benennt es zusaetzlich als Zahl, damit der Aufrufer es nicht aus dem Slug raten muss --
 * 'elf-volk' kann „Elf (Volk)" im Hauptraum oder „Elf:Volk" in ns 220 sein.
 * Tafel und Erkennung sind die des Hauses (avesmapsWikiTitleNamespace, AVESMAPS_WIKI_NAMESPACE_PREFIXES) -- keine zweite.
 * ⚠️ Ein Praefix, das die Tafel nicht kennt („Kategorie:", „Datei:"), gilt wie im Rest des Hauses als Hauptraum (0); ein
 * fuehrender Doppelpunkt (die MediaWiki-Linkschreibweise „[[:Inoffiziell:X]]") wird vorher abgeschnitten.
 *
 * @return array{ns:int, ns_name:string}
 */
function avesmapsWikiLinkzieleNamensraum(string $titel): array
{
    $titel = ltrim(trim($titel), ':');
    $ns = avesmapsWikiTitleNamespace($titel) ?? 0;

    return ['ns' => $ns, 'ns_name' => $ns === 0 ? '' : (string) array_search($ns, AVESMAPS_WIKI_NAMESPACE_PREFIXES, true)];
}

/**
 * REIN: Schluessel, Namensraum und -- falls eine Weiterleitung getroffen wurde -- das Weiterleitungsziel eines Titels.
 *
 * `weiterleitung_auf` steht NUR, wenn die Weiterleitungstafel den Schluessel gegenueber dem des Titels selbst veraendert hat.
 * Es nennt den Schluessel der Zielseite und -- soweit der Sandkasten sie kennt (`$index`) -- deren Titel und Namensraum;
 * so sind Weiterleitungen ueber Namensraeume hinweg („Dju'imen" -> „Inoffiziell:Dju'imen") an `ns` gegen
 * `weiterleitung_auf.ns` ablesbar. Kennt der Sandkasten die Zielseite nicht, fehlen Titel und Namensraum (`null`).
 *
 * @param array<string,string> $aliase
 * @param array<string,array{id:int, titel:string, art:string}> $index Schluessel => Seite des Sandkastens
 * @return array<string,mixed>
 */
function avesmapsWikiLinkzieleTitelDaten(string $titel, array $aliase, array $index): array
{
    $roh = avesmapsWikiSyncMonitorNormalizeTitle($titel);
    $key = avesmapsWikiLinkzieleKey($titel, $aliase);
    $daten = avesmapsWikiLinkzieleNamensraum($titel) + ['key' => $key];
    $eigen = $roh === '' ? '' : avesmapsWikiDumpCanonicalWikiKeyForTitle($roh);
    if ($key !== '' && $key !== $eigen) {
        $seite = $index[$key] ?? null;
        $daten['weiterleitung_auf'] = [
            'wiki_key' => $key,
            'titel' => $seite === null ? null : $seite['titel'],
            'ns' => $seite === null ? null : avesmapsWikiLinkzieleNamensraum($seite['titel'])['ns'],
            'ns_name' => $seite === null ? null : avesmapsWikiLinkzieleNamensraum($seite['titel'])['ns_name'],
        ];
    }

    return $daten;
}

// ===========================================================================
// 2. REIN: eine Seite -> ihre Linkfelder.
// ===========================================================================

/**
 * REIN: die Linkfelder einer Wiki-Seite -- ausschliesslich die der Positivliste ihrer Seitenart.
 *
 * Gelesen wird der ROHWERT des Infobox-Parameters (vor der Bereinigung, die das Ziel wegwirft) mit denselben
 * Infobox-Helfern wie die Parser des Haus (`ExtractInfoboxBlock`, `ParseTemplateParams`, `NormFields`, `Field`).
 *
 * @return array{felder: array<string, list<array{anzeige:string, ziel:string}>>, befuellt:int, vorlagen: array<string,int>, infobox:bool}
 *   `felder`   nur Felder mit mindestens einem Link, in der Reihenfolge der Positivliste
 *   `befuellt` Felder der Positivliste, die einen nichtleeren Wert tragen
 *   `vorlagen` {{Name|Text}} mit blankem Textargument in befuellten Feldern (Name => Anzahl) -- die sichtbare Luecke
 *   `infobox`  ob die Seite eine Infobox traegt
 */
function avesmapsWikiLinkzieleSeite(string $wikitext, string $seitenArt): array
{
    $ergebnis = ['felder' => [], 'befuellt' => 0, 'vorlagen' => [], 'infobox' => false];
    $liste = AVESMAPS_WIKI_LINKZIELE_FELDER[$seitenArt] ?? null;
    if ($liste === null) {
        return $ergebnis;
    }
    $block = avesmapsWikiSyncMonitorExtractInfoboxBlock($wikitext);
    if ($block === '') {
        return $ergebnis;
    }
    $ergebnis['infobox'] = true;
    $norm = avesmapsWikiSyncMonitorNormFields(avesmapsWikiSyncMonitorParseTemplateParams($block));

    foreach ($liste as $name => $aliase) {
        $roh = avesmapsWikiSyncMonitorField($norm, $aliase);
        if (trim($roh) === '') {
            continue;
        }
        $ergebnis['befuellt']++;
        $paare = avesmapsWikiLinkZielePaare($roh);
        if ($paare !== []) {
            $ergebnis['felder'][$name] = $paare;
        }
        // Vorlagen mit einem blanken Textargument ({{Pol|Baronie Raulsmark}}) -- der Fall, den dieser Export NICHT als Link
        // fuehrt. Gezaehlt wird in JEDEM befuellten Feld, auch dort, wo daneben echte Wikilinks stehen (Gareth: Staat traegt
        // „{{Pol|Baronie Raulsmark}}; [[Reichsstadt]]"). Zeilenvorlagen mit Link-Argument ({{Strasse|[[X]]|…}}) zaehlen nicht.
        // Das Verlaufsfeld ist per Bauart eine Kette von Zeilenvorlagen ({{Abzweigung links|Name}}) und waere reines Rauschen.
        if ($name !== 'verlauf' && preg_match_all('/\{\{\s*([^{}|]+?)\s*\|\s*([^{}|\[\]=]+?)\s*(?:\||\}\})/u', $roh, $vorlagen) >= 1) {
            foreach ($vorlagen[1] as $vorlage) {
                $vorlage = trim((string) $vorlage);
                $ergebnis['vorlagen'][$vorlage] = ($ergebnis['vorlagen'][$vorlage] ?? 0) + 1;
            }
        }
    }

    return $ergebnis;
}

/**
 * REIN: die Wiki-Angaben EINES Objekts -- Adresse, kanonischer Schluessel, Titel, Namensraum, Weiterleitungsziel.
 *
 * `$key` darf der gespeicherte Schluessel des Objekts sein (Herrschaftsgebiete, Landschaften ohne Adresse); fehlt er,
 * kommt er aus der Adresse -- durch dieselbe Regel wie jedes Linkziel. Der Namensraum kommt aus der ADRESSE (dort steht der
 * Titel mit Praefix) und ist `null`, wenn es keine Wiki-Aventurica-Adresse gibt: ein Namensraum wird nicht aus einem Slug geraten.
 *
 * @param array<string,string> $aliase
 * @param array<string,array{id:int, titel:string, art:string}> $index
 * @return array<string,mixed>
 */
function avesmapsWikiLinkzieleObjektWiki(string $adresse, string $key, array $aliase, array $index): array
{
    $titel = $adresse === '' ? '' : avesmapsWikiLinkzieleTitelAusUrl($adresse);
    $daten = $titel === '' ? [] : avesmapsWikiLinkzieleTitelDaten($titel, $aliase, $index);
    $schluessel = $key !== '' ? $key : (string) ($daten['key'] ?? '');
    $hauptraum = avesmapsWikiNamespaceFromWikiUrlMitHauptraum($adresse);
    $nsDaten = $hauptraum === null ? ['ns' => null, 'ns_name' => null] : avesmapsWikiLinkzieleNamensraum($titel);

    $ergebnis = [
        'wiki_url' => $adresse === '' ? null : $adresse,
        'wiki_key' => $schluessel === '' ? null : $schluessel,
        'wiki_titel' => $titel === '' ? null : $titel,
        'ns' => $nsDaten['ns'],
        'ns_name' => $nsDaten['ns_name'],
    ];
    if (isset($daten['weiterleitung_auf'])) {
        $ergebnis['weiterleitung_auf'] = $daten['weiterleitung_auf'];
    }

    return $ergebnis;
}

// ===========================================================================
// 3. Lesen: Zuordnung (X2).
// ===========================================================================

/**
 * Die Zuordnungstafel: jedes Objekt mit Wiki-Zuweisung samt kanonischem Key -- und die Zahl der Objekte OHNE Zuweisung
 * je Art. Nur lesend; nichts davon wird aus einem Namen abgeleitet.
 *
 * Quellen:
 *   map_features (is_active = 1)  Nest `wiki_settlement`/`wiki_region`/`wiki_path`/`wiki_powerline` mit `wiki_url`
 *   ecosystem_region (is_active = 1)  `wiki_url`, sonst `wiki_region_key` (blanker Slug); Klimazonen tragen keine
 *   political_territory (is_active = 1, Aventurien)  der gespeicherte `wiki_key` mit Praefix „wiki:"
 *
 * @param array<string,string> $aliase
 * @param array<string,array{id:int, titel:string, art:string}> $index
 * @return array{objekte: list<array<string,mixed>>, je_art: array<string,array{zugewiesen:int, ohne_zuweisung:int}>, ohne_schluessel:int}
 */
function avesmapsWikiLinkzieleZuordnung(PDO $pdo, array $aliase, array $index = []): array
{
    $objekte = [];
    $zugewiesen = array_fill_keys(AVESMAPS_WIKI_LINKZIELE_ARTEN, 0);
    $gesamt = array_fill_keys(AVESMAPS_WIKI_LINKZIELE_ARTEN, 0);
    $ohneSchluessel = 0;

    // --- Karte: Gesamtzahl je Art, dann die Zeilen MIT einem Nest -------------------------------------------------------
    $zaehlung = $pdo->query('SELECT feature_type, COUNT(*) FROM map_features WHERE is_active = 1 GROUP BY feature_type');
    foreach ($zaehlung !== false ? $zaehlung->fetchAll(PDO::FETCH_NUM) : [] as $zeile) {
        $art = AVESMAPS_WIKI_LINKZIELE_FEATURE_ARTEN[(string) $zeile[0]] ?? null;
        if ($art !== null) {
            $gesamt[$art] += (int) $zeile[1];
        }
    }

    $bedingungen = [];
    foreach (AVESMAPS_WIKI_LINKZIELE_NESTER as [$nest]) {
        $bedingungen[] = "properties_json LIKE '%\"" . $nest . "\"%'";
    }
    $statement = $pdo->query(
        'SELECT public_id, feature_type, feature_subtype, properties_json FROM map_features
          WHERE is_active = 1 AND (' . implode(' OR ', $bedingungen) . ')
          ORDER BY id ASC'
    );
    foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $zeile) {
        $eigenschaften = json_decode((string) ($zeile['properties_json'] ?? ''), true);
        if (!is_array($eigenschaften)) {
            continue;
        }
        foreach (AVESMAPS_WIKI_LINKZIELE_NESTER as [$nest, $art]) {
            $adresse = is_array($eigenschaften[$nest] ?? null) ? trim((string) ($eigenschaften[$nest]['wiki_url'] ?? '')) : '';
            if ($adresse === '') {
                continue;
            }
            $wiki = avesmapsWikiLinkzieleObjektWiki($adresse, '', $aliase, $index);
            $objekte[] = [
                'public_id' => (string) $zeile['public_id'],
                'art' => $art,
                'feature_type' => (string) $zeile['feature_type'],
                'feature_subtype' => (string) $zeile['feature_subtype'],
            ] + $wiki;
            $zugewiesen[$art]++;
            $ohneSchluessel += $wiki['wiki_key'] === null ? 1 : 0;
            break; // das erste Nest mit Adresse gilt -- Reihenfolge wie im Lesepfad der Karte
        }
    }

    // --- Landschaftsflaechen ---------------------------------------------------------------------------------------------
    // 🔴 Klimabaender tragen nie eine Wiki-Zuweisung (abgeleitet) und gehoeren nicht in die Zaehlung.
    $statement = $pdo->query(
        "SELECT public_id, kind, region_type, wiki_url, wiki_region_key FROM ecosystem_region
          WHERE is_active = 1 AND kind <> 'klima' ORDER BY id ASC"
    );
    foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $zeile) {
        $gesamt['landschaft']++;
        $adresse = trim((string) ($zeile['wiki_url'] ?? ''));
        $gespeichert = $adresse !== ''
            ? ''
            : avesmapsWikiLinkzieleKeyAusGespeichertem((string) ($zeile['wiki_region_key'] ?? ''), $aliase, true);
        if ($adresse === '' && $gespeichert === '') {
            continue;
        }
        $wiki = avesmapsWikiLinkzieleObjektWiki($adresse, $gespeichert, $aliase, $index);
        $objekte[] = [
            'public_id' => (string) $zeile['public_id'],
            'art' => 'landschaft',
            'kind' => (string) $zeile['kind'],
            'region_type' => (string) ($zeile['region_type'] ?? ''),
        ] + $wiki;
        $zugewiesen['landschaft']++;
        $ohneSchluessel += $wiki['wiki_key'] === null ? 1 : 0;
    }

    // --- Herrschaftsgebiete ----------------------------------------------------------------------------------------------
    // Zugewiesen heisst: der gespeicherte `wiki_key` ist ein „wiki:"-Schluessel. „name:"/„eigener-knoten:" sind Identitaeten
    // ohne Artikel und zaehlen als OHNE Zuweisung.
    $statement = $pdo->prepare(
        'SELECT public_id, type, wiki_key, wiki_url FROM political_territory
          WHERE is_active = 1 AND continent = :kontinent ORDER BY id ASC'
    );
    $statement->execute(['kontinent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT]);
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $gesamt['gebiet']++;
        $key = avesmapsWikiLinkzieleKeyAusGespeichertem((string) ($zeile['wiki_key'] ?? ''), $aliase, false);
        if ($key === '') {
            continue;
        }
        $adresse = trim((string) ($zeile['wiki_url'] ?? ''));
        $objekte[] = [
            'public_id' => (string) $zeile['public_id'],
            'art' => 'gebiet',
            'gebietsart' => (string) ($zeile['type'] ?? ''),
        ] + avesmapsWikiLinkzieleObjektWiki($adresse, $key, $aliase, $index);
        $zugewiesen['gebiet']++;
    }

    $jeArt = [];
    foreach (AVESMAPS_WIKI_LINKZIELE_ARTEN as $art) {
        $jeArt[$art] = [
            'zugewiesen' => $zugewiesen[$art],
            'ohne_zuweisung' => max(0, $gesamt[$art] - $zugewiesen[$art]),
        ];
    }

    return ['objekte' => $objekte, 'je_art' => $jeArt, 'ohne_schluessel' => $ohneSchluessel];
}

// ===========================================================================
// 4. Lesen: Wikitext aus dem Sandkasten (X1).
// ===========================================================================

/**
 * Der juengste ABGESCHLOSSENE Dump-Lauf, dessen Zeilen der Sandkasten haelt. Null, wenn es keinen gibt.
 *
 * Dieselbe Frage wie avesmapsWikiDumpSyncKindResolveDumpRunId (dump-sync-kind.php), nur ohne zu werfen und mit der
 * Abschlusszeit -- jene Datei zieht den halben Sync-Apparat nach, den ein lesender Endpunkt nicht braucht.
 *
 * @return array{id:int, completed_at:string}|null
 */
function avesmapsWikiLinkzieleDumpLauf(PDO $pdo): ?array
{
    $statement = $pdo->prepare(
        "SELECT id, completed_at FROM wiki_sync_runs
          WHERE sync_type = :typ AND status = 'completed'
          ORDER BY completed_at DESC, id DESC LIMIT 1"
    );
    $statement->execute(['typ' => AVESMAPS_WIKI_DUMP_SYNC_TYPE]);
    $zeile = $statement->fetch(PDO::FETCH_ASSOC);

    return is_array($zeile) ? ['id' => (int) $zeile['id'], 'completed_at' => (string) ($zeile['completed_at'] ?? '')] : null;
}

/**
 * Der Index des Sandkastens: Schluessel => {id, titel, art} -- jede Seite des Laufs, OHNE Wikitext (klein).
 *
 * Er dient zwei Fragen: welche Zeilen Text liefern muessen (avesmapsWikiLinkzieleSeiten) und wie die Zielseite einer
 * Weiterleitung heisst (avesmapsWikiLinkzieleTitelDaten). 🔴 Der Schluessel einer ECHTEN Seite kommt ohne die
 * Weiterleitungstafel -- eine echte Seite ist kein Alias von sich selbst.
 *
 * @return array{index: array<string,array{id:int, titel:string, art:string}>, kollisionen:int}
 */
function avesmapsWikiLinkzieleIndex(PDO $pdo, int $laufId): array
{
    $statement = $pdo->prepare(
        "SELECT id, normalized_title, entity_kind FROM wiki_dump_hybrid_state
          WHERE run_id = :lauf AND wikitext_found_at IS NOT NULL
            AND entity_kind IN ('settlement','building','region','path','powerline','territory')
          ORDER BY id ASC"
    );
    $statement->bindValue(':lauf', $laufId, PDO::PARAM_INT);
    $statement->execute();

    $index = [];
    $kollisionen = 0;
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $titel = (string) $zeile['normalized_title'];
        $key = avesmapsWikiDumpCanonicalWikiKeyForTitle($titel);
        if ($key === '') {
            continue;
        }
        if (isset($index[$key])) {
            // Die Faltung ist verlustbehaftet: zwei Titel, ein Slug. Die erste Zeile gilt, die Kollision wird gezaehlt.
            $kollisionen += $index[$key]['titel'] !== $titel ? 1 : 0;
            continue;
        }
        $index[$key] = ['id' => (int) $zeile['id'], 'titel' => $titel, 'art' => (string) $zeile['entity_kind']];
    }

    return ['index' => $index, 'kollisionen' => $kollisionen];
}

/**
 * Die Linkfelder aller Seiten, die ein Objekt der Zuordnung braucht -- der Text wird nur fuer diese Zeilen geholt, in kleinen
 * Stapeln (ein Wikitext kann hunderte KB tragen; nicht alle rund 12.000 laufen durch den Speicher).
 *
 * Jeder Link tragt: `anzeige`, `ziel` (roh, MIT Namensraum-Praefix), `ns`/`ns_name` (der Raum des Ziels), `ziel_key`
 * (kanonisch, ueber die Weiterleitungstafel) und -- nur bei einer getroffenen Weiterleitung -- `weiterleitung_auf`.
 * Herrschaftsgebiete werden hier nicht gelesen (X1 kennt Siedlung, Gebaeude, Region, Weg, Kraftlinie).
 *
 * @param array<string,true> $gebraucht Schluessel => true
 * @param array<string,array{id:int, titel:string, art:string}> $index
 * @param array<string,string> $aliase
 * @return array<string,array<string,mixed>> Schluessel => Seite
 */
function avesmapsWikiLinkzieleSeiten(PDO $pdo, array $index, array $gebraucht, array $aliase): array
{
    $zeilen = [];
    foreach ($index as $key => $seite) {
        if (isset($gebraucht[$key]) && isset(AVESMAPS_WIKI_LINKZIELE_FELDER[$seite['art']])) {
            $zeilen[$seite['id']] = $key;
        }
    }

    $seiten = [];
    foreach (array_chunk(array_keys($zeilen), AVESMAPS_WIKI_LINKZIELE_STAPEL) as $stapel) {
        $platzhalter = implode(',', array_fill(0, count($stapel), '?'));
        $abfrage = $pdo->prepare('SELECT id, wikitext FROM wiki_dump_hybrid_state WHERE id IN (' . $platzhalter . ')');
        foreach ($stapel as $nummer => $id) {
            $abfrage->bindValue($nummer + 1, (int) $id, PDO::PARAM_INT);
        }
        $abfrage->execute();
        foreach ($abfrage->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
            $key = $zeilen[(int) $zeile['id']];
            $eintrag = $index[$key];
            $seite = avesmapsWikiLinkzieleSeite((string) $zeile['wikitext'], $eintrag['art']);
            foreach ($seite['felder'] as $name => $paare) {
                foreach ($paare as $nummer => $paar) {
                    $daten = avesmapsWikiLinkzieleTitelDaten($paar['ziel'], $aliase, $index);
                    $link = $paar + ['ns' => $daten['ns'], 'ns_name' => $daten['ns_name'], 'ziel_key' => $daten['key']];
                    if (isset($daten['weiterleitung_auf'])) {
                        $link['weiterleitung_auf'] = $daten['weiterleitung_auf'];
                    }
                    $seite['felder'][$name][$nummer] = $link;
                }
            }
            $seite['seite_art'] = $eintrag['art'];
            $seite['titel'] = $eintrag['titel'];
            $seiten[$key] = $seite;
        }
    }

    return $seiten;
}

// ===========================================================================
// 5. Staende und Antworten.
// ===========================================================================

/**
 * Die Staende, die waehrend des Lesens stillstehen muessen.
 *
 *   map_revision / ecosystem_revision   dieselben Zahlen wie map-features.php / ecosystem-areas.php
 *   territories_revision                Fingerabdruck von `political_territory` (Politik-Schreibwege heben map_revision NICHT)
 *   aliase_stempel                      Fingerabdruck von `wiki_redirect_alias` (Zeilenzahl, juengster Zeitstempel)
 *   dump_lauf / dump_abgeschlossen      der Lauf, aus dem der Wikitext kommt
 *
 * 🔴 Nur SELECT. `ecosystem_revision` wird direkt gelesen (SELECT revision FROM ecosystem_revision WHERE id = 1, fehlend = 1,
 * wie avesmapsReadEcosystemRevision) -- ecosystem.php ziehen wir nicht nach, es haengt am oeffentlichen Lesepfad der Karte.
 *
 * @return array<string,int|string>
 */
function avesmapsWikiLinkzieleStaende(PDO $pdo): array
{
    $mapRevision = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $mapRevision = $mapRevision !== false ? $mapRevision->fetchColumn() : false;
    $ecoRevision = $pdo->query('SELECT revision FROM ecosystem_revision WHERE id = 1');
    $ecoRevision = $ecoRevision !== false ? $ecoRevision->fetchColumn() : false;

    $gebiete = $pdo->query('SELECT COUNT(*) AS anzahl, MAX(updated_at) AS neuester, MAX(id) AS hoechste FROM political_territory')
        ->fetch(PDO::FETCH_ASSOC);
    $aliase = $pdo->query('SELECT COUNT(*) AS anzahl, MAX(updated_at) AS neuester FROM wiki_redirect_alias')
        ->fetch(PDO::FETCH_ASSOC);
    $lauf = avesmapsWikiLinkzieleDumpLauf($pdo);

    return [
        'map_revision' => $mapRevision === false ? 0 : (int) $mapRevision,
        'ecosystem_revision' => $ecoRevision === false ? 1 : (int) $ecoRevision,
        'territories_revision' => 'pt-' . substr(hash('sha1', implode('|', [
            (int) ($gebiete['anzahl'] ?? 0), (string) ($gebiete['neuester'] ?? ''), (int) ($gebiete['hoechste'] ?? 0),
        ])), 0, 16),
        'aliase_stempel' => 'ra-' . substr(hash('sha1', (int) ($aliase['anzahl'] ?? 0) . '|' . (string) ($aliase['neuester'] ?? '')), 0, 16),
        'dump_lauf' => $lauf === null ? 0 : $lauf['id'],
        'dump_abgeschlossen' => $lauf === null ? '' : $lauf['completed_at'],
    ];
}

/**
 * REIN: der Kopf von X2.
 *
 * @param array{objekte: list<array<string,mixed>>, je_art: array<string,array<string,int>>, ohne_schluessel:int} $zuordnung
 * @return array<string,mixed>
 */
function avesmapsWikiLinkzieleZuordnungKopf(array $zuordnung): array
{
    $schluessel = [];
    foreach ($zuordnung['objekte'] as $objekt) {
        if (($objekt['wiki_key'] ?? null) !== null) {
            $schluessel[(string) $objekt['wiki_key']] = true;
        }
    }

    return [
        'objekte_mit_zuweisung' => count($zuordnung['objekte']),
        'objekte_ohne_schluessel' => $zuordnung['ohne_schluessel'],
        'verschiedene_schluessel' => count($schluessel),
        'je_art' => $zuordnung['je_art'],
    ];
}

/**
 * REIN: X2 -- die Zuordnungstafel.
 *
 * @param array<string,int|string> $staende
 * @param array{objekte: list<array<string,mixed>>, je_art: array<string,array<string,int>>, ohne_schluessel:int} $zuordnung
 */
function avesmapsWikiLinkzieleZuordnungAntwort(array $staende, array $zuordnung): array
{
    return [
        'ok' => true,
        'map_revision' => $staende['map_revision'],
        'ecosystem_revision' => $staende['ecosystem_revision'],
        'territories_revision' => $staende['territories_revision'],
        'aliase_stempel' => $staende['aliase_stempel'],
        'kopf' => avesmapsWikiLinkzieleZuordnungKopf($zuordnung),
        'objekte' => $zuordnung['objekte'],
    ];
}

/**
 * REIN: X1 -- die Linkziele je Objekt und Wiki-Feld, mit Zaehlern zur Gegenprobe.
 *
 * Zaehler (`kopf.artikel`) zaehlen je ARTIKEL (je Wiki-Seite), nicht je Objekt: ein Weg liegt in bis zu 57 Abschnitten,
 * und alle teilen denselben Artikel -- je Objekt gezaehlt waere jeder Link 57-mal in der Statistik. `objekte_je_art` zaehlt
 * je Objekt.
 *
 * @param array<string,int|string> $staende
 * @param array{objekte: list<array<string,mixed>>, je_art: array<string,array<string,int>>, ohne_schluessel:int} $zuordnung
 * @param array<string,array<string,mixed>> $seiten Schluessel => Seite (avesmapsWikiLinkzieleSeiten)
 * @param array<string,array{id:int, titel:string, art:string}> $index der Sandkasten (nur fuer den Grund in `ohne_wikitext`)
 */
function avesmapsWikiLinkzieleLinkAntwort(array $staende, array $zuordnung, array $seiten, int $kollisionen, array $index = []): array
{
    $objekte = [];
    $ohneWikitext = [];
    $jeArt = [];
    foreach (AVESMAPS_WIKI_LINKZIELE_ARTEN as $art) {
        if ($art !== 'gebiet') {
            $jeArt[$art] = ['mit_zuweisung' => 0, 'mit_wikitext' => 0, 'ohne_wikitext' => 0];
        }
    }
    foreach ($zuordnung['objekte'] as $objekt) {
        $art = (string) $objekt['art'];
        if ($art === 'gebiet') {
            continue; // X1 kennt Siedlung, Weg, Region, Kraftlinie, Landschaft -- Gebiete stehen in X2 (ihre Schluessel zaehlen unten trotzdem als Kartenobjekt)
        }
        $key = $objekt['wiki_key'] ?? null;
        $jeArt[$art]['mit_zuweisung']++;
        $seite = $key !== null ? ($seiten[$key] ?? null) : null;
        if ($seite === null) {
            $jeArt[$art]['ohne_wikitext']++;
            // Warum: die Seite fehlt im Dump-Lauf, oder sie steht darin, ist aber von einer Art (Herrschaftsgebiet), fuer die
            // dieser Export keine Felder fuehrt.
            $ohneWikitext[] = [
                'public_id' => $objekt['public_id'],
                'art' => $art,
                'wiki_key' => $key,
                'grund' => $key !== null && isset($index[$key]) ? 'seitenart_ohne_felder' : 'seite_nicht_im_dump',
            ];
            continue;
        }
        $jeArt[$art]['mit_wikitext']++;
        $objekte[] = [
            'public_id' => $objekt['public_id'],
            'art' => $art,
            'wiki_key' => $key,
            'ns' => avesmapsWikiLinkzieleNamensraum($seite['titel'])['ns'],
            'ns_name' => avesmapsWikiLinkzieleNamensraum($seite['titel'])['ns_name'],
            'seite_art' => $seite['seite_art'],
            'seite_titel' => $seite['titel'],
            'felder' => (object) $seite['felder'],
        ];
    }

    // --- Zaehler je Artikel -----------------------------------------------------------------------------------------
    $kartenSchluessel = [];
    foreach ($zuordnung['objekte'] as $objekt) {
        if (($objekt['wiki_key'] ?? null) !== null) {
            $kartenSchluessel[(string) $objekt['wiki_key']] = true;
        }
    }
    $felderBefuellt = 0;
    $felderMitLink = 0;
    $linksGesamt = 0;
    $linksPipe = 0;
    $zieleAnzahl = [];   // ziel_key => Anzahl der Links
    $zielTitel = [];     // ziel_key => erster Titel
    $vorlagen = [];
    foreach ($seiten as $seite) {
        $felderBefuellt += (int) $seite['befuellt'];
        foreach ($seite['vorlagen'] as $name => $anzahl) {
            $vorlagen[$name] = ($vorlagen[$name] ?? 0) + $anzahl;
        }
        foreach ($seite['felder'] as $paare) {
            $felderMitLink++;
            foreach ($paare as $paar) {
                $linksGesamt++;
                $linksPipe += $paar['anzeige'] !== $paar['ziel'] ? 1 : 0;
                $zielKey = (string) $paar['ziel_key'];
                $zieleAnzahl[$zielKey] = ($zieleAnzahl[$zielKey] ?? 0) + 1;
                $zielTitel[$zielKey] ??= $paar['ziel'];
            }
        }
    }
    $mit = 0;
    $ohne = [];
    foreach ($zieleAnzahl as $zielKey => $anzahl) {
        if (isset($kartenSchluessel[(string) $zielKey])) {
            $mit++;
        } else {
            $ohne[(string) $zielKey] = $anzahl;
        }
    }
    // Haeufigste zuerst, bei Gleichstand nach Schluessel -- eine feste Reihenfolge, damit der Inhalts-ETag nicht wackelt.
    uksort($ohne, static fn(string $a, string $b): int => ($ohne[$b] <=> $ohne[$a]) ?: strcmp($a, $b));
    $top = [];
    foreach (array_slice($ohne, 0, AVESMAPS_WIKI_LINKZIELE_TOP_OHNE_OBJEKT, true) as $zielKey => $anzahl) {
        $top[] = ['ziel_key' => $zielKey, 'ziel' => $zielTitel[$zielKey], 'links' => $anzahl];
    }
    arsort($vorlagen);
    ksort($vorlagen);
    uksort($vorlagen, static fn(string $a, string $b): int => ($vorlagen[$b] <=> $vorlagen[$a]) ?: strcmp($a, $b));

    return [
        'ok' => true,
        'map_revision' => $staende['map_revision'],
        'ecosystem_revision' => $staende['ecosystem_revision'],
        'territories_revision' => $staende['territories_revision'],
        'aliase_stempel' => $staende['aliase_stempel'],
        'dump' => ['run_id' => $staende['dump_lauf'], 'abgeschlossen' => $staende['dump_abgeschlossen']],
        'kopf' => [
            'objekte_je_art' => $jeArt,
            'artikel' => [
                'mit_wikitext' => count($seiten),
                'felder_befuellt' => $felderBefuellt,
                'felder_mit_link' => $felderMitLink,
                'links_gesamt' => $linksGesamt,
                'links_pipe' => $linksPipe,
                'ziele_verschieden' => count($zieleAnzahl),
                'ziele_mit_kartenobjekt' => $mit,
                'ziele_ohne_kartenobjekt' => count($ohne),
            ],
            'haeufigste_ziele_ohne_kartenobjekt' => $top,
            'vorlagen_in_feldern' => (object) array_slice($vorlagen, 0, 15, true),
            'seiten_schluesselkollision' => $kollisionen,
        ],
        'objekte' => $objekte,
        'ohne_wikitext' => $ohneWikitext,
    ];
}

/**
 * Lesen -- und die Staende nur nennen, wenn sie waehrend des Lesens stillstanden.
 *
 * 💣 Stand gelesen, dann Daten gelesen: speichert dazwischen jemand, nennt die Antwort einen Stand, der ihre Daten NICHT
 * beschreibt. Also vorher und nachher lesen, gleich = in diesem Fenster wurde nichts gespeichert (dieselbe Bauart wie
 * avesmapsPoliticalTerritoriesExportLesen). Nach AVESMAPS_WIKI_LINKZIELE_VERSUCHE Fehlschlaegen wird geworfen
 * (der Endpunkt macht daraus 503 `data_changing`).
 *
 * @param string $variante 'linkziele' (X1) oder 'zuordnung' (X2)
 */
function avesmapsWikiLinkzieleLesen(PDO $pdo, string $variante): array
{
    for ($versuch = 1; $versuch <= AVESMAPS_WIKI_LINKZIELE_VERSUCHE; $versuch++) {
        $vorher = avesmapsWikiLinkzieleStaende($pdo);
        $aliase = avesmapsWikiLinkzieleAliase($pdo);
        $sandkasten = (int) $vorher['dump_lauf'] > 0
            ? avesmapsWikiLinkzieleIndex($pdo, (int) $vorher['dump_lauf'])
            : ['index' => [], 'kollisionen' => 0];
        $zuordnung = avesmapsWikiLinkzieleZuordnung($pdo, $aliase, $sandkasten['index']);

        $seiten = [];
        if ($variante !== 'zuordnung') {
            $gebraucht = [];
            foreach ($zuordnung['objekte'] as $objekt) {
                if (($objekt['wiki_key'] ?? null) !== null) {
                    $gebraucht[(string) $objekt['wiki_key']] = true;
                }
            }
            $seiten = avesmapsWikiLinkzieleSeiten($pdo, $sandkasten['index'], $gebraucht, $aliase);
        }

        $nachher = avesmapsWikiLinkzieleStaende($pdo);
        if ($vorher !== $nachher) {
            continue;
        }

        return $variante === 'zuordnung'
            ? avesmapsWikiLinkzieleZuordnungAntwort($nachher, $zuordnung)
            : avesmapsWikiLinkzieleLinkAntwort($nachher, $zuordnung, $seiten, $sandkasten['kollisionen'], $sandkasten['index']);
    }

    throw new AvesmapsWikiLinkzieleExportInBewegung('Der Kartenstand hat sich waehrend des Lesens mehrfach geaendert.');
}

/**
 * REIN: der schwache ETag ueber den INHALT der Antwort.
 *
 * 🔴 BEWUSST KEIN STEMPEL-ETAG: ein Stempel ist nur so ehrlich wie die Zusage, dass JEDE Aenderung einen Stempel hebt, und
 * dieses Haus hat an genau dieser Zusage viermal bezahlt (AGENTS.md §11). Der Inhalt kann nicht luegen.
 */
function avesmapsWikiLinkzieleETag(string $rumpf, string $variante): string
{
    return 'W/"wiki-' . $variante . '-' . substr(hash('sha1', $rumpf), 0, 16) . '"';
}

/**
 * Der gemeinsame Rumpf beider Endpunkte (HTTP-Schicht): CORS, nur GET, lesen, Kopfzeilen NACH dem Aufbau, 304, 503, 500.
 *
 * 💣 Die Kopfzeilen gehen erst mit der Antwort hinaus, nie vor der Arbeit -- sonst truege eine 500 aus dem Lesen denselben
 * gueltigen Tag, und ein Aufrufer, der ablegt, bekaeme beim naechsten Mal „deine Kopie ist aktuell" fuer eine Fehlerseite.
 * `X-Avesmaps-ETag` zusaetzlich, weil STRATO den `ETag` aus Antworten mit Rumpf entfernt (AGENTS.md §10).
 */
function avesmapsWikiLinkzieleEndpunkt(string $variante): void
{
    $beschreibung = $variante === 'zuordnung' ? 'die Wiki-Zuordnung' : 'die Wiki-Linkziele';
    try {
        $config = avesmapsLoadApiConfig(avesmapsApiRoot());

        if (!avesmapsApplyCorsPolicy($config)) {
            avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf ' . $beschreibung . ' nicht laden.');
        }

        $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        if ($requestMethod === 'OPTIONS') {
            avesmapsJsonResponse(204);
        }
        if ($requestMethod !== 'GET') {
            avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer diesen Export erlaubt.');
        }

        $pdo = avesmapsCreatePdo($config['database'] ?? []);
        $antwort = avesmapsWikiLinkzieleLesen($pdo, $variante);

        $rumpf = json_encode($antwort, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $etag = avesmapsWikiLinkzieleETag($rumpf, $variante);
        header('ETag: ' . $etag);
        header('X-Avesmaps-ETag: ' . $etag);
        header('Cache-Control: no-cache, must-revalidate');
        header('Vary: Accept-Encoding', false);

        $ifNoneMatch = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
        if ($ifNoneMatch !== '' && avesmapsETagMatches($ifNoneMatch, $etag)) {
            http_response_code(304);
            exit;
        }

        avesmapsJsonResponse(200, $antwort);
    } catch (AvesmapsWikiLinkzieleExportInBewegung) {
        // Kein 500: es ist nichts kaputt, es wird nur gerade gespeichert. Ein erneuter Abruf hilft.
        header('Retry-After: 10');
        avesmapsErrorResponse(503, 'data_changing', 'Die Daten werden gerade bearbeitet; bitte in einigen Sekunden erneut abrufen.');
    } catch (Throwable) {
        // 🔴 Kein getMessage() an die Oeffentlichkeit (AGENTS.md §10, Meilenstein M1).
        avesmapsErrorResponse(500, 'server_error', ucfirst($beschreibung) . ' konnte nicht geladen werden.');
    }
}
