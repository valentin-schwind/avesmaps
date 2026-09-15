<?php

declare(strict_types=1);

// Way-naming rules for wiki-linked path features (R1/R2 rework 2026-07, see
// docs/refactoring-strassen-wiki-zuweisung.md):
//   R1  🔴 SEIT 15.09.2026 UMGEKEHRT: DER WEGNAME GEHOERT DEM EDITOR (Owner, am Gruppendialog „Bärenpfad":
//       „der wegname lässt sich nicht ändern. wenn ich umbenenne, soll das beim speichern für alle abschnitte
//       gelten"). ZUWEISEN (assign_to, avesmapsWikiPathAssignTo) setzt den Wiki-Namen wie bisher; danach
//       uebernimmt ihn nur noch „Sync" im Kasten „Wiki-Weg" auf Knopfdruck. Jedes Speichern -- Abschnitt
//       wie ganze Strasse -- schreibt den eingegebenen Namen, auch an einem zugewiesenen Abschnitt.
//       Bis dahin stand hier: „A segment with an assigned wiki way ALWAYS carries the wiki way name";
//       durchgesetzt hat das avesmapsWikiPathEffectiveEditName (gefallen, siehe unten).
//   R2  Clearing the assignment hands EACH segment its OWN fresh generic <Subtype>-<n>
//       name (amended 2026-07-05: one shared name glued cleared groups together and a
//       later assign dragged the whole bundle back in). -- unveraendert.
// Deliberately dependency-free: required by BOTH api/_internal/wiki/paths.php and
// api/_internal/map/features.php (the map lib must not pull the wiki-sync stack).

// Canonical way name of a wiki_path assign object: the staging name, else the decoded
// `/wiki/<Page>` segment of the wiki_url (underscores -> spaces). '' when unusable.
function avesmapsWikiPathCanonicalName(array $wikiPath): string {
    $name = trim((string) ($wikiPath['name'] ?? ''));
    if ($name !== '') {
        return $name;
    }
    $wikiUrl = trim((string) ($wikiPath['wiki_url'] ?? ''));
    if ($wikiUrl === '') {
        return '';
    }
    $pageSegment = '';
    if (preg_match('~/wiki/([^?#]+)~i', $wikiUrl, $match) === 1) {
        $pageSegment = $match[1];
    } else {
        $withoutQuery = explode('#', explode('?', $wikiUrl, 2)[0], 2)[0];
        $tailSegments = array_values(array_filter(explode('/', $withoutQuery), static fn(string $part): bool => $part !== ''));
        $tail = $tailSegments === [] ? '' : (string) end($tailSegments);
        // A bare scheme/host (no path) yields the host -- not a page name.
        $pageSegment = preg_match('~^https?:$~i', $tail) === 1 || str_contains($tail, '.') && count($tailSegments) <= 2 ? '' : $tail;
    }

    return trim(str_replace('_', ' ', rawurldecode($pageSegment)));
}

// 🔴 HIER STAND `avesmapsWikiPathEffectiveEditName` -- der R1-Riegel des Speicherns: „traegt der Weg eine
// Zuweisung, gewinnt der Wiki-Name bedingungslos". Gefallen am 15.09.2026 mit der Umkehr von R1 (Kopf dieser
// Datei). Seine Aufrufer waren die zwei Weg-Schreiber (avesmapsUpdatePathFeatureDetails,
// avesmapsUpdatePathGroupDetails) und zwei Vorabpruefungen des Garetien-Imports; alle vier sind mitgezogen.
// 💣 WER IHN ZURUECKHOLT, SPERRT DAS NAMENSFELD WIEDER -- und zwar lautlos: das Formular zeigt den getippten
// Namen, der Server schreibt den Wiki-Namen, die Antwort ist gueltig. Genau das war der Owner-Befund.
// Gewacht von api/_internal/map/__tests__/wegname-gehoert-dem-editor-test.php.

// R2 generic name: next free `<subtype>-<n>` over the supplied existing names (callers
// pass the DB `name` column of all active paths). Number-sensitive: only exact
// `^<subtype>-<digits>$` entries count -- no digit-strip collapsing (Reichsstrasse-1 vs -2).
function avesmapsWikiPathNextGenericName(string $subtype, array $existingNames): string {
    $subtype = trim($subtype);
    if ($subtype === '') {
        $subtype = 'Weg';
    }
    $pattern = '/^' . preg_quote($subtype, '/') . '-(\d+)$/';
    $highestNumber = 0;
    foreach ($existingNames as $existingName) {
        if (preg_match($pattern, trim((string) $existingName), $match) === 1) {
            $highestNumber = max($highestNumber, (int) $match[1]);
        }
    }

    return $subtype . '-' . ($highestNumber + 1);
}

// R2-Sequenz: EIGENER generischer Name je Segment (Phase-1-Schema, random-eindeutig). Die
// Weg-Gruppe loest sich beim Entfernen bewusst auf, damit selektives Neu-Zuweisen kein
// Alt-Buendel wieder einsammelt. Der Pool waechst mit, damit die Sequenz kollisionsfrei bleibt.
function avesmapsWikiPathNextGenericNameSequence(array $rowSubtypes, array $existingNames): array {
    $pool = $existingNames;
    $names = [];
    foreach ($rowSubtypes as $subtype) {
        $name = avesmapsWikiPathNextGenericName((string) $subtype, $pool);
        $pool[] = $name;
        $names[] = $name;
    }

    return $names;
}

// PATH_SUBTYPE_KEYS (js/config.js) fuer PHP. Hier, weil diese Datei die Wegenamen-Regeln
// traegt und abhaengigkeitsfrei ist -- die Konfliktzentrale las bis 01.09.2026 eine eigene
// Abschrift.
// ⚠️ Die Liste in avesmapsReadPathSubtype (api/_internal/map/features.php) ist bewusst NICHT
// dieselbe: das ist der SCHREIB-Riegel, und sein Kommentar begruendet, warum er eine eigene
// Kopie bleibt.
const AVESMAPS_PATH_SUBTYPE_KEYS = ['Reichsstrasse', 'Strasse', 'Weg', 'Pfad', 'Gebirgspass', 'Wuestenpfad', 'Flussweg', 'Seeweg'];

// Ist dieser Wegname MASCHINELL? Drei Muster, und alle drei muessen hier stehen:
//   1. der nackte Wegtyp ("Flussweg") -- kein Name, nur eine Art
//   2. `<Wegtyp>-<n>` -- genau das, was avesmapsWikiPathNextGenericName oben erzeugt
//   3. `<wort>-<zahl>` allgemein ("Meer-835") -- der Praefix muss nicht der Wegtyp sein
//
// 💣 DIE SPIEGELUNG IST TRAGEND: dies ist die PHP-Fassung von shouldShowRoutePathDisplayName
// (js/routing/route-node.js), und beide Seiten muessen dieselben drei Muster kennen. Der Server
// entscheidet, was die Kartensuche ANBIETET, der Browser, was er dazu im Index findet -- ist der
// Server grosszuegiger, faellt sein Treffer beim Aufloesen still weg (resolveBackendSpotlightEntries
// verwirft, was es lokal nicht gibt), und das sieht wie ein kaputter Klick aus, nicht wie eine Regel.
// ⚠️ Muster 3 ist der Grund, warum Muster 2 trotzdem einzeln dasteht: es faengt genau den Fall,
// den der Erzeuger oben baut, und stirbt nicht mit, wenn Muster 3 je enger gefasst wird.
//
// @param list<string>|null $subtypes die bekannten Wegarten; null = AVESMAPS_PATH_SUBTYPE_KEYS
function avesmapsWikiPathNameIsGeneric(string $name, ?array $subtypes = null): bool {
    $name = trim($name);
    if ($name === '') {
        return true; // kein Name ist auch keiner, den jemand nachschlagen kann
    }

    foreach ($subtypes ?? AVESMAPS_PATH_SUBTYPE_KEYS as $subtype) {
        $subtype = trim((string) $subtype);
        if ($subtype === '') {
            continue;
        }
        if ($name === $subtype) {
            return true;
        }
        if (preg_match('/^' . preg_quote($subtype, '/') . '-\d+$/u', $name) === 1) {
            return true;
        }
    }

    // Muster 3. `\S+` heisst: KEIN Leerzeichen -- "Weg-17 nach Gareth" ist ein Name, den jemand
    // getippt hat, und bleibt einer.
    return preg_match('/^\S+-\d+$/u', $name) === 1;
}

// Der ECHTE Name eines Wegabschnitts -- der, den ein Mensch ihm gegeben hat; '' fuer einen Maschinennamen oder gar keinen.
//
// 🔴 DIE PHP-FASSUNG VON getPathTitleName (js/map-features/map-features-path-domain.js), Feld fuer Feld: ERST der eigene Name,
// aber nur, wenn er kein maschineller ist; SONST der Name der Wiki-Zuweisung. „Eigener Name" ist, was normalizeRoutePathFeature
// (js/map-features/map-features-path-prepare.js) im Browser daraus macht: display_name, sonst original_name, sonst die Spalte.
// 🔴 Die Reihenfolge ist seit 15.09.2026 UMGEKEHRT (R1, Kopf dieser Datei: der Wegname gehoert dem Editor). Vorher gewann der
// Wiki-Name, und ein umbenannter zugewiesener Abschnitt hiesse auf Karte, Infobox und Suche weiter wie sein Artikel. Der Wiki-Name
// bleibt RUECKFALL: ein Altsegment, das noch „Reichsstrasse-16" heisst, zeigt weiter „Reichsstraße 2".
// 💣 DARAN HAENGT „GANZE STRASSE" (Owner 15.09.2026: „die selektion soll ausdrücklich über den namen - nicht über die
// wiki-zuweisung erfolgen"). Die Wege-Editor-Liste gruppiert mit DIESEM Namen, die Karte mit dem des Browsers (wpGroupKeyOf,
// js/pages/wege-editor-model.js) -- laufen die zwei auseinander, traegt derselbe Abschnitt auf der Karte eine andere Nummer als
// im Editor, und niemand sieht warum. js/pages/__tests__/wege-gruppe-gleicher-name.test.js faehrt beide gegen eine Tafel.
// ⚠️ Gegen die EIGENE Wegart geprueft, bei unbekannter gegen alle acht -- dieselbe Wahl wie api/app/map-search.php.
function avesmapsWikiPathEchterName(array $properties, string $rowName, string $featureSubtype): string {
    // Wie `||` im Browser: das erste NICHT LEERE Feld gewinnt -- auch eines aus Leerzeichen, das dann eben keinen Namen traegt.
    $eigener = '';
    foreach ([$properties['display_name'] ?? null, $properties['original_name'] ?? null, $rowName] as $feld) {
        $text = is_scalar($feld) ? (string) $feld : '';
        if ($text !== '') {
            $eigener = trim($text);
            break;
        }
    }
    $subtypes = in_array($featureSubtype, AVESMAPS_PATH_SUBTYPE_KEYS, true) ? [$featureSubtype] : AVESMAPS_PATH_SUBTYPE_KEYS;
    if ($eigener !== '' && !avesmapsWikiPathNameIsGeneric($eigener, $subtypes)) {
        return $eigener;
    }

    $wikiPath = is_array($properties['wiki_path'] ?? null) ? $properties['wiki_path'] : [];

    return trim(is_scalar($wikiPath['name'] ?? null) ? (string) $wikiPath['name'] : '');
}
