<?php

declare(strict_types=1);

// Flora, Fauna, Spezies und Handelswaren aus dem Wiki-Dump -- PURE Parser-Kern.
// Siehe docs/flora-fauna-handelswaren-design.md.
//
// 💣 DIE ZENTRALE ERKENNTNIS (nicht neu herleiten, sie hat einen halben Tag gekostet):
// Die Wiki-Unterseiten "X/FloraFauna" und "X/Handelsware" sind LEER. Ihr kompletter
// Wikitext ist {{Liste FloraFauna}} bzw. {{Liste Handelsware}} -- DPL-Abfragen, die
// das Wiki bei jedem Seitenaufruf live rechnet. Im Dump steht dort NICHTS. Die Daten
// leben in den EINZELARTIKELN, in vier Infoboxen, deren Verbreitungsfelder die Orte
// als echte Wikilinks tragen:
//
//   Infobox Tierart            -> Verbreitung                (fauna)
//   Infobox Pflanzenart        -> Verbreitung                (flora)
//   Infobox Spezies            -> Regionen                   (spezies)
//   Infobox Gegenstandsgruppe  -> Herkunft, Verbreitung      (ware)
//
// ERKENNUNG NUR UEBER DEN INFOBOX-NAMEN (Invariante O4 aus dump-entity-scan.php).
// 🪤 NIE nach dem Feld "Art" filtern: dessen Werte sind wild ("Hirsch", "Gras",
// "profan"), und genau so eine Weiche hat bei den Abenteuern ~430 Eintraege
// verschluckt. Noetig ist sie hier ohnehin nicht -- jeder der vier Typen hat seine
// EIGENE Infobox.
//
// GEMESSEN (voller Dump-Scan 2026-07-21, 202.897 Seiten in ns 0): 5.104 Eintraege
// (1.382 fauna / 1.004 flora / 187 spezies / 2.531 ware), 7.748 Ortsverknuepfungen,
// 34.933 Quellenangaben. Bei ALLEN 5.104 ist die Lore-Infobox zugleich die ERSTE
// Infobox der Seite (0 Abweichungen) -- deshalb darf hier
// avesmapsWikiSyncMonitorInfoboxName/-ExtractInfoboxBlock verwendet werden, die
// jeweils die erste nehmen.
//
// 🪤 Diese Zahlen sind mit avesmapsWikiSyncMonitorParseTemplateParams gemessen, das
// ZEILENWEISE liest. Ein zeichenweiser Parser, der [[ ]]-Tiefe zaehlt, liefert 7.746:
// "Nagellack (profan)" schreibt "|Gegenstandstyp=[[Lack]]]]" mit vier schliessenden
// Klammern, worauf die Tiefe negativ wird und alle Folgefelder verschluckt werden.
// Der Hausparser ist dagegen immun -- genau deshalb wird hier keiner nachgebaut.
//
// ABNAHMETEST: Fuer Weiden muessen 19 fauna, 10 flora und 4 spezies herauskommen.
// Das Wiki nennt in seiner Ueberschrift "14 Artikel, 10 angezeigt" bzw. "7 / 4" --
// DPL zaehlt alle Artikel mit linksto, ZEIGT aber nur die mit Treffer im
// Verbreitungsfeld (includematch). Wir bilden die angezeigte Menge nach.
//
// I1 -- KEIN eigenes Feld-Parsing: Infobox-Block, Parameter, Feld-Normalisierung und
// der Publikations-Parser kommen ALLE aus den bestehenden Libraries. Diese Datei
// fuegt nur die Lore-spezifische Auswahl und die Link-Extraktion hinzu.
//
// Side-effect-free on include (nur const + function), damit
// __tests__/lore-parsing-test.php sie ohne MySQL `require`n kann.

require_once __DIR__ . '/publication-parsing.php'; // avesmapsWikiParsePublicationsSection
                                                   // + (transitiv) sync-monitor-parsing.php

// ===========================================================================
// 1. Konstanten
// ===========================================================================

/**
 * Infobox-Name OHNE das Praefix "Infobox", durch avesmapsWikiSyncMonitorFieldKey
 * normalisiert -> unser kind. EXAKTER Match, kein str_contains: ein Substring-Test
 * auf "art" wuerde mit halb Aventurien kollidieren.
 */
const AVESMAPS_LORE_INFOBOX_KINDS = [
    'tierart' => 'fauna',
    'pflanzenart' => 'flora',
    'spezies' => 'spezies',
    'gegenstandsgruppe' => 'ware',
];

/**
 * Je kind: normalisierter Feldname => relation. Aus DIESEN Feldern werden Ortslinks
 * gezogen -- und nur aus ihnen.
 *
 * ⚠️ "Vorkommen" ist NICHT dabei, obwohl es Wikilinks enthaelt: es traegt den
 * LEBENSRAUM ("[[Wald]], [[Eiche]]nwaelder"), also Landschaftstypen statt Orte. Es
 * wird als Textfeld uebernommen. Genau so filtert auch das Wiki selbst (includematch
 * laeuft ueber Verbreitung, nie ueber Vorkommen).
 *
 * Bei Waren ist die Trennung inhaltlich: Herkunft = "stammt von dort",
 * Verbreitung = "wird dort gehandelt".
 */
const AVESMAPS_LORE_PLACE_FIELDS = [
    'fauna' => ['verbreitung' => 'verbreitung'],
    'flora' => ['verbreitung' => 'verbreitung'],
    'spezies' => ['regionen' => 'regionen'],
    'ware' => ['herkunft' => 'herkunft', 'verbreitung' => 'verbreitung'],
];

/** Felder mit eigener Spalte -- alles Uebrige wandert nach merkmale_json. */
const AVESMAPS_LORE_CORE_FIELDS = [
    'name', 'bild', 'art', 'gegenstandstyp', 'vorkommen',
    'weiterenamen', 'beinamen',
];

/** Linkziele mit diesen Praefixen sind nie Orte. */
const AVESMAPS_LORE_LINK_SKIP_PREFIXES = ['kategorie:', 'datei:', 'bild:', 'vorlage:', 'category:', 'file:'];

// ===========================================================================
// 2. PURE Helfer
// ===========================================================================

/**
 * PURE: Infobox-Name (wie avesmapsWikiSyncMonitorInfoboxName ihn liefert, also ohne
 * "Infobox ") -> kind, oder '' wenn es keine Lore-Infobox ist.
 */
function avesmapsLoreKindForInfoboxName(string $infoboxName): string
{
    $key = avesmapsWikiSyncMonitorFieldKey($infoboxName);

    return AVESMAPS_LORE_INFOBOX_KINDS[$key] ?? '';
}

/**
 * PURE: alle Wikilink-ZIELE eines Feldwerts, in Reihenfolge und dedupliziert
 * (case-insensitiv). Anzeigetext hinter "|" und Anker hinter "#" fallen weg, das Ziel
 * ist der Wiki-Titel -- und damit derselbe Schluessel, den der Rest des Projekts nutzt.
 *
 * "[[Mittelaventurien]]s, vor allem [[Weiden|Weiden]]" -> ['Mittelaventurien', 'Weiden']
 *
 * 💣 Das Genitiv-s steht AUSSERHALB der Klammern und stoert nicht. Anders bei
 * "[[Schaf]]s[[wolle]]" (Infobox Staat, Feld Handelswaren): das ist EIN Wort aus ZWEI
 * Links und ergibt hier "Schaf" und "wolle". Fuer die vier Lore-Infoboxen ist das
 * unkritisch (dort steht je Link ein eigener Ort); wer das Staat-Feld auswertet, muss
 * es gesondert behandeln.
 *
 * @return list<string>
 */
function avesmapsLoreExtractPlaceLinks(string $value): array
{
    if (trim($value) === '' || !str_contains($value, '[[')) {
        return [];
    }
    if (preg_match_all('/\[\[\s*([^\]\|#<>\[]+?)\s*(?:#[^\]\|]*)?(?:\|[^\]]*)?\]\]/u', $value, $matches) < 1) {
        return [];
    }

    $out = [];
    $seen = [];
    foreach ($matches[1] as $target) {
        $title = trim(preg_replace('/\s+/u', ' ', str_replace('_', ' ', (string) $target)) ?? '');
        if ($title === '') {
            continue;
        }
        $lower = mb_strtolower($title, 'UTF-8');
        foreach (AVESMAPS_LORE_LINK_SKIP_PREFIXES as $prefix) {
            if (str_starts_with($lower, $prefix)) {
                continue 2;
            }
        }
        if (isset($seen[$lower])) {
            continue;
        }
        $seen[$lower] = true;
        $out[] = $title;
    }

    return $out;
}

// ===========================================================================
// 3. Seiten-Parser
// ===========================================================================

/**
 * PURE: eine Dump-Seite -> Lore-Datensatz, oder null wenn sie keine Lore-Infobox
 * traegt. Die SCHLUESSEL-BILDUNG (wiki_key/match_key) passiert bewusst NICHT hier,
 * sondern beim Aufrufer in lore-sync.php -- der hat die political/sync-Libraries
 * geladen, dieser Parser bleibt abhaengigkeitsarm und testbar.
 *
 * @return array{
 *   kind:string, title:string, name:string, gruppe:string, typ:string,
 *   lebensraum:string, synonyme:string, bild:string,
 *   merkmale:array<string,string>,
 *   places:list<array{title:string, relation:string}>,
 *   sources:list<array{title:string, reference_kind:string, pages:?string, note:?string}>
 * }|null
 */
function avesmapsLoreParsePage(string $title, string $wikitext): ?array
{
    $title = trim($title);
    if ($title === '' || !str_contains($wikitext, '{{')) {
        return null;
    }

    $kind = avesmapsLoreKindForInfoboxName(avesmapsWikiSyncMonitorInfoboxName($wikitext));
    if ($kind === '') {
        return null;
    }

    $block = avesmapsWikiSyncMonitorExtractInfoboxBlock($wikitext);
    if (trim($block) === '') {
        return null;
    }
    $params = avesmapsWikiSyncMonitorParseTemplateParams($block);
    $norm = avesmapsWikiSyncMonitorNormFields($params);

    // Der Anzeigename kommt aus |Name=, faellt aber auf den Seitentitel zurueck: bei
    // "Weidener Kettenhecht" traegt die Infobox nur "Kettenhecht".
    $name = trim(avesmapsWikiSyncMonitorField($norm, ['name']));
    if ($name === '') {
        $name = $title;
    }

    $places = [];
    foreach (AVESMAPS_LORE_PLACE_FIELDS[$kind] as $field => $relation) {
        foreach (avesmapsLoreExtractPlaceLinks(avesmapsWikiSyncMonitorField($norm, [$field])) as $placeTitle) {
            $places[] = ['title' => $placeTitle, 'relation' => $relation];
        }
    }

    // Alles, was keine eigene Spalte hat und nicht leer ist, wandert nach
    // merkmale_json -- typspezifisch (Bluetezeit nur bei Pflanzen, Waffengruppe nur
    // bei Waren), als Spalten waere das eine Tabelle mit 90 % NULL.
    $merkmale = [];
    foreach ($params as $key => $value) {
        $value = trim($value);
        if ($value === '' || in_array(avesmapsWikiSyncMonitorFieldKey($key), AVESMAPS_LORE_CORE_FIELDS, true)) {
            continue;
        }
        $merkmale[trim($key)] = $value;
    }

    return [
        'kind' => $kind,
        'title' => $title,
        'name' => $name,
        'gruppe' => trim(avesmapsWikiSyncMonitorField($norm, ['art'])),
        'typ' => trim(avesmapsWikiSyncMonitorField($norm, ['gegenstandstyp'])),
        'lebensraum' => trim(avesmapsWikiSyncMonitorField($norm, ['vorkommen'])),
        'synonyme' => trim(avesmapsWikiSyncMonitorField($norm, ['weiterenamen', 'beinamen'])),
        'bild' => trim(avesmapsWikiSyncMonitorField($norm, ['bild'])),
        'merkmale' => $merkmale,
        'places' => $places,
        // Der Publikations-Parser ist NICHT neu geschrieben: dieselbe Abschnittslogik
        // und dieselben reference_kind-Werte wie beim Mehrquellen-System, damit die
        // Quellen spaeter ohne Umweg als origin='wiki_publication' passen.
        'sources' => avesmapsWikiParsePublicationsSection($wikitext),
    ];
}
