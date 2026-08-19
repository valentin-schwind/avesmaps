<?php

declare(strict_types=1);

// „Regeln ableiten": aus den beiden Wiki-Infoboxfeldern eines Vorkommens einen Vorschlag fuer eine
// Lebensraum-Regel bauen. PURE -- kein PDO, kein DDL, keine Globals. Der Katalog kommt fertig herein,
// die Bewertung geht fertig heraus.
//
// 💣 ZWEI FELDER, NICHT EINES. `|Verbreitung=` (bzw. `|Herkunft=`/`|Regionen=`) traegt den ORT,
// `|Vorkommen=` -- im Editor „Lebensraum" -- traegt die LANDSCHAFTSART. Erst beide zusammen ergeben
// den Satz, den die Regelsprache spricht („Steppe innerhalb von Orkland"). Nur aus dem Ortsfeld
// abgeleitet waere der Knopf ein Dublettenerzeuger: die Ortszeile (`lore_place`) sagt dasselbe
// laengst. Gemessen 19.08.2026 an allen 5.116 Wiki-Seiten: das Ortsfeld traegt in 87 von 3.480
// Faellen (2,5 %) ueberhaupt eine Art, das Lebensraumfeld in 369 von 732 (50,4 %).
//
// 💣 DIE AEUSSEREN EBENEN EINER DOPPELPUNKT-KETTE SIND KONTEXT, KEINE BEDINGUNG. Von 719
// Doppelpunkt-Paaren halten nur 59,1 % geometrisch: das „Meer der Sieben Winde" liegt nicht in
// unserer Flaeche „Aventurien" (die ist das LAND), das „Regengebirge" nicht in „Suedaventurien".
// Wer die aeussere Ebene als zweite Bedingung schreibt, wirft 41 % der richtigen Faelle lautlos weg.
// Dieselbe Antwort kommt aus der Sprache selbst: avesmapsLoreRuleFlaecheErfuelltArtUndOrt kennt kein
// „[Name] innerhalb von [Name]" -- links vom „innerhalb" steht eine ART. Benutzt wird deshalb je
// Semikolon-Zweig ausschliesslich die INNERSTE Ebene.
//
// 💣 IM ZWEIFEL NICHT UEBERNEHMEN, und jedes Weglassen wird BENANNT. Ein uebersehener Fall kostet
// einen Klick, ein falsch uebernommener kostet das Vertrauen in den ganzen Lauf. Jedes verworfene
// Glied traegt seinen Grund bis in die Vorschau -- eine Zahl ohne Begruendung waere hier wertlos.
//
// 🪤 NIE RATEN, welche von zwei gleichnamigen Flaechen gemeint ist (13 doppelt vergebene Namen,
// 137 mehrdeutige Treffer live). Solche Glieder fallen mit Grund `mehrdeutig` heraus.
//
// Messberichte: .superpowers/sdd/2026-08-15-wiki-zuweisung-vereinheitlichung/
// verbreitung-aus-wiki-bericht.md (die Vormessung) und regeln-ableiten-bericht.md (der eigene Lauf
// mit genau diesem Code).

// avesmapsWikiSyncCreateMatchKey -- der Schluessel, auf den avesmapsWikiRegionArtLookupTable() bereits
// keyt. regions.php ruft sie zur Laufzeit auf, ohne sie selbst einzubinden; deshalb steht sie hier
// zuerst.
require_once __DIR__ . '/sync.php';
// avesmapsWikiRegionArtToSubtype samt AVESMAPS_WIKI_REGION_ART_TO_SUBTYPE -- die HAUSTABELLE der
// Wiki-Arten. Eine zweite, eigene Synonymliste waere die zweite Wahrheit, vor der AGENTS.md §5 warnt.
require_once __DIR__ . '/regions.php';
// avesmapsEcosystemWikiSlug -- die Form, in der `ecosystem_region.wiki_region_key` tatsaechlich in der
// Datenbank steht. Nachgebaut waere sie eine dritte Fassung derselben Ableitung (AGENTS.md §5).
require_once __DIR__ . '/../app/ecosystem.php';
// AVESMAPS_LORE_PLACE_FIELDS + avesmapsWikiSyncMonitorFieldKey -- welches Feld je Objektart der Ort ist.
require_once __DIR__ . '/lore-parsing.php';

/** Der Herkunftswert, den dieser Lauf schreibt -- und der EINZIGE, den er anfassen darf. */
const AVESMAPS_LORE_RULE_DERIVE_ORIGIN = 'wiki_verbreitung';

/**
 * Woerter, die neben einem Wikilink stehen duerfen, ohne dass sich aendert, WELCHE Flaeche gemeint ist.
 *
 * 🔴 Eine WEISSE Liste, keine schwarze -- die sichere Richtung. Gemessen 19.08.2026: von 5.423
 * Gliedern mit genau einem Link tragen 4.836 gar keinen Zusatztext; der Rest ist ein langer
 * Schwanz, in dem „ganz" (46) und „vor allem" (14) neben „noerdliches" (22), „Randgebiete der" (5)
 * und „Katakomben unter" stehen. Die erste Gruppe meint dieselbe Flaeche, die zweite einen Ausschnitt
 * davon -- und den kann eine Regel nicht ausdruecken.
 *
 * ⚠️ Mengen- und Haeufigkeitswoerter („nur", „selten", „vereinzelt") sind hier ABSICHTLICH harmlos:
 * sie sagen etwas ueber die Haeufigkeit, nichts ueber den Ort. Richtungswoerter („noerdlich",
 * „zentral") sind es NICHT -- sie benennen einen Teil der Flaeche.
 *
 * Die Eintraege stehen in der Form, die avesmapsLoreRuleDeriveWortform liefert (klein, Umlaute auf
 * ihren Grundbuchstaben, ohne Satzzeichen).
 */
const AVESMAPS_LORE_RULE_DERIVE_HARMLOSE_WOERTER = [
    // Mengen und Nachdruck
    'ganz', 'ganze', 'ganzen', 'ganzer', 'ganzes', 'fast', 'nahezu', 'annahernd',
    'alle', 'allen', 'aller', 'alles', 'allem', 'samtliche', 'samtlichen',
    'vor', 'insbesondere', 'besonders', 'hauptsachlich', 'uberwiegend', 'vorwiegend',
    'meist', 'meistens', 'haufig', 'selten', 'vereinzelt', 'gelegentlich', 'teilweise',
    'auch', 'nur', 'ua', 'va', 'zb', 'weit', 'verbreitet', 'weitverbreitet',
    'ehemals', 'ursprunglich', 'fruher', 'heute', 'noch', 'sowie', 'und',
    // Bindewoerter und Artikel
    'in', 'im', 'am', 'an', 'auf', 'aus', 'von', 'vom', 'der', 'die', 'das',
    'den', 'dem', 'des', 'ein', 'eine', 'einem', 'einen', 'einer',
    // Grammatik-Reste, die beim Entfernen des Links uebrig bleiben:
    // „[[Aventurien]]s", „alle [[Meer]]e", „[[Wald]]ern"
    's', 'n', 'e', 'r', 'en', 'es', 'er', 'ern', 'ns', 'em',
];

/**
 * Welten, die nicht auf dieser Karte liegen. Ein Glied, das eine von ihnen nennt, faellt ZU RECHT
 * heraus -- und sagt das auch, statt als „unbekannter Name" zu erscheinen.
 *
 * In der Form von avesmapsEcosystemWikiSlug (Umlaute fallen dabei weg: „Gueldenland" -> „g-ldenland").
 */
const AVESMAPS_LORE_RULE_DERIVE_FREMDE_WELTEN = [
    'myranor', 'uthuria', 'rakshazar', 'tharun', 'riesland', 'g-ldenland',
    'ehernes-schwert', 'dere', 'lorakis', 'arkania',
];

/** Hoechstzahl der Bedingungen einer abgeleiteten Regel -- derselbe Deckel wie AVESMAPS_LORE_RULE_MAX_TERMS. */
const AVESMAPS_LORE_RULE_DERIVE_MAX_TERMS = 25;

/** Die Gruende, aus denen eine Angabe nicht uebernommen wird -- Maschinenwert => deutscher Satz. */
const AVESMAPS_LORE_RULE_DERIVE_GRUENDE = [
    'verneinung' => 'Verneinung („außer …“) — nicht abbildbar',
    'freitext' => 'Freitext ohne Wikilink',
    'mehrere_links' => 'mehrere Wikilinks in einer Angabe',
    'zusatztext' => 'Zusatztext neben dem Link',
    'unsicher' => 'Fragezeichen — die Quelle ist selbst unsicher',
    'mehrdeutig' => 'Name zweimal vergeben — es wird nicht geraten',
    'fremde_welt' => 'andere Welt',
    'herrschaftsgebiet' => 'Herrschaftsgebiet, keine Landschaft',
    'unbekannt' => 'keine Landschaftsfläche dieses Namens',
    'zu_viele' => 'mehr Bedingungen, als eine Regel tragen darf',
];

// ===========================================================================
// 1. Wortformen und Schluessel
// ===========================================================================

/**
 * PURE: ein Text in seine Woerter, klein und ohne Satzzeichen -- fuer den Abgleich gegen
 * AVESMAPS_LORE_RULE_DERIVE_HARMLOSE_WOERTER.
 *
 * 💣 NICHT avesmapsFoldToAscii: die faltet Umlaute auf '?' und zerreisst damit jedes Wort, das einen
 * traegt („noerdliches" -> „n rdliches", zwei Woerter). Hier zaehlt das WORT, nicht der Schluessel --
 * also dieselbe Umschrift wie avesmapsWikiSyncMonitorFieldKey, nur mit erhaltenen Wortgrenzen.
 *
 * @return list<string>
 */
function avesmapsLoreRuleDeriveWortform(string $text): array
{
    $wert = mb_strtolower(trim($text), 'UTF-8');
    $wert = strtr($wert, [
        'ä' => 'a', 'ö' => 'o', 'ü' => 'u', 'ß' => 'ss',
        'á' => 'a', 'à' => 'a', 'â' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e',
        'î' => 'i', 'í' => 'i', 'ô' => 'o', 'ó' => 'o', 'û' => 'u', 'ú' => 'u',
    ]);
    $wert = preg_replace('/[^a-z0-9]+/u', ' ', $wert) ?? '';

    return array_values(array_filter(explode(' ', trim($wert)), static fn (string $w): bool => $w !== ''));
}

/**
 * PURE: der Schluessel, unter dem ein Wiki-Titel gegen `ecosystem_region.wiki_region_key` und gegen
 * die Flaechennamen gesucht wird. Ein Aufruf, keine Kopie -- siehe die require-Notiz oben.
 */
function avesmapsLoreRuleDeriveFlaechenSchluessel(string $titel): string
{
    return avesmapsEcosystemWikiSlug(trim($titel));
}

/** PURE: derselbe Titel ohne seinen Klammerzusatz („Thorwal (Region)" -> „Thorwal"). */
function avesmapsLoreRuleDeriveOhneKlammer(string $titel): string
{
    return trim(preg_replace('/\s*\([^)]*\)\s*$/u', '', trim($titel)) ?? $titel);
}

// ===========================================================================
// 2. Der Katalog
// ===========================================================================

/**
 * PURE: aus den gelesenen Zeilen den Nachschlage-Index bauen.
 *
 * @param list<array{public_id:string,name:string,kind:string,region_type:string,wiki_region_key:?string}> $regionen
 * @param list<array{kind:string,type_key:string,label:string}> $arten  ecosystem_region_type, klima faellt heraus
 * @param list<string> $territorienNamen  Namen der Herrschaftsgebiete -- NUR fuer die Begruendung
 * @return array<string,mixed>
 */
function avesmapsLoreRuleDeriveKatalog(array $regionen, array $arten, array $territorienNamen = []): array
{
    $nachSchluessel = [];
    $nachName = [];
    $ohneKlammer = [];
    $meta = [];

    foreach ($regionen as $zeile) {
        $publicId = trim((string) ($zeile['public_id'] ?? ''));
        if ($publicId === '') {
            continue;
        }
        $name = (string) ($zeile['name'] ?? '');
        $wikiKey = trim((string) ($zeile['wiki_region_key'] ?? ''));
        $meta[$publicId] = [
            'name' => $name,
            'kind' => (string) ($zeile['kind'] ?? ''),
            'region_type' => (string) ($zeile['region_type'] ?? ''),
            // 🔴 Die Frage, an der spaeter „sagt das etwas Neues?" haengt: eine Flaeche MIT
            // wiki_region_key erreicht der Namenspfad (`?place=`) laengst.
            'hat_wiki_key' => $wikiKey !== '',
        ];
        if ($wikiKey !== '') {
            $nachSchluessel[$wikiKey][] = $publicId;
        }
        $nameKey = avesmapsLoreRuleDeriveFlaechenSchluessel($name);
        if ($nameKey !== '') {
            $nachName[$nameKey][] = $publicId;
        }
        $kurzKey = avesmapsLoreRuleDeriveFlaechenSchluessel(avesmapsLoreRuleDeriveOhneKlammer($name));
        if ($kurzKey !== '' && $kurzKey !== $nameKey) {
            $ohneKlammer[$kurzKey][] = $publicId;
        }
    }

    // Die Arten: erst das eigene Vokabular der Ebene (die Beschriftung, exakt), dann die
    // Server-Synonyme -- die REIHENFOLGE ist die Regel aus AGENTS.md §11, und das Ergebnis muss ein
    // type_key DIESES Katalogs sein. Ein Synonym, das auf einen type_key zeigt, den es hier nicht
    // gibt (`tundra`, `berggipfel`, `vulkan`, `ebene` sind Label-Subtypen, keine Flaechenarten),
    // faellt damit von selbst heraus, statt eine Regel zu erzeugen, die nie etwas treffen kann.
    $artenNachWort = [];
    $artenMeta = [];
    $nachTypeKey = [];
    foreach ($arten as $art) {
        $kind = (string) ($art['kind'] ?? '');
        $typeKey = (string) ($art['type_key'] ?? '');
        if ($kind === '' || $typeKey === '' || $kind === 'klima') {
            continue;
        }
        $wert = $kind . '|' . $typeKey;
        $artenMeta[$wert] = (string) ($art['label'] ?? $typeKey);
        $nachTypeKey[$typeKey][] = $wert;
        $labelKey = avesmapsWikiSyncCreateMatchKey((string) ($art['label'] ?? ''));
        if ($labelKey !== '' && !isset($artenNachWort[$labelKey])) {
            $artenNachWort[$labelKey] = $wert;
        }
    }
    foreach (AVESMAPS_WIKI_REGION_ART_TO_SUBTYPE as $wort => $typeKey) {
        // 💣 Nur wenn der type_key in DIESEM Katalog genau EINMAL vorkommt. Zweimal hiesse raten.
        if (count($nachTypeKey[$typeKey] ?? []) !== 1) {
            continue;
        }
        $wortKey = avesmapsWikiSyncCreateMatchKey((string) $wort);
        if ($wortKey !== '' && !isset($artenNachWort[$wortKey])) {
            $artenNachWort[$wortKey] = $nachTypeKey[$typeKey][0];
        }
    }

    // Die Herrschaftsgebiete: NUR fuer die Begruendung. Sie entscheiden nie, ob etwas uebernommen
    // wird -- gefragt werden sie erst, wenn die Flaechensuche schon aufgegeben hat.
    //
    // 💣 Ein Herrschaftsgebiet heisst „<Rang> <Name>" („Herzogtum Tobrien", „Königreich Albernia"),
    // das Wiki nennt aber den nackten Namen. Ohne die Kuerzung um das erste Wort traegt der Grund
    // 156 Nennungen statt 543 -- der Rest stuende als „unbekannt" da und liesse den Editor einen
    // Datenfehler suchen, wo eine Objektart-Verwechslung ist. Gemessen 19.08.2026 an 970 Gebieten.
    // ⚠️ Das erste Wort wird ohne Rangliste abgeschnitten: eine Liste waere geraten und muesste bei
    // jedem neuen Rang („Beyrounat", „Radjarat", „Haranydad") nachgezogen werden.
    $territorien = [];
    foreach ($territorienNamen as $name) {
        $roh = trim((string) $name);
        if ($roh === '') {
            continue;
        }
        $voll = avesmapsLoreRuleDeriveFlaechenSchluessel($roh);
        if ($voll !== '') {
            $territorien[$voll] = true;
        }
        $woerter = preg_split('/\s+/u', $roh) ?: [];
        if (count($woerter) > 1) {
            array_shift($woerter);
            $kurz = avesmapsLoreRuleDeriveFlaechenSchluessel(implode(' ', $woerter));
            if ($kurz !== '') {
                $territorien[$kurz] = true;
            }
        }
    }

    return [
        'flaechen_nach_schluessel' => $nachSchluessel,
        'flaechen_nach_name' => $nachName,
        'flaechen_ohne_klammer' => $ohneKlammer,
        'flaechen_meta' => $meta,
        'arten_nach_wort' => $artenNachWort,
        'arten_meta' => $artenMeta,
        'territorien' => $territorien,
    ];
}

// ===========================================================================
// 3. Zerlegung
// ===========================================================================

/**
 * PURE: ein Rohfeld in Zweige (Semikolon) -> Ebenen (Doppelpunkt) -> Glieder (Komma).
 *
 * ⚠️ Das SEMIKOLON ist die versteckte dritte Ebene: es trennt in aller Regel WELTEN
 * („…; [[Myranor]]; [[Uthuria]]") und steht in 202 Eintraegen. Ein Ableiter, der es nicht kennt,
 * haengt Myranor als Geschwister an eine aventurische Kette.
 *
 * 💣 Komma und Doppelpunkt zaehlen nur AUSSERHALB von `[[…]]` und `(…)`: sonst zerreisst jedes
 * „[[Bornland (Region)|Bornland]]" an seiner eigenen Klammer.
 *
 * @return list<list<list<string>>>
 */
function avesmapsLoreRuleDeriveZerlege(string $roh): array
{
    $text = preg_replace('/<ref[^>]*>.*?<\/ref>/su', '', $roh) ?? $roh;
    $text = preg_replace('/<ref[^>]*\/>/su', '', $text) ?? $text;
    $text = preg_replace('/<!--.*?-->/su', '', $text) ?? $text;
    $text = preg_replace('/<[^>]+>/u', ' ', $text) ?? $text;
    $text = str_replace(["\n", "\r"], ' ', $text);

    $zweige = [];
    foreach (preg_split('/\s*;\s*/u', $text) ?: [] as $zweigText) {
        if (trim($zweigText) === '') {
            continue;
        }
        $ebenen = [];
        foreach (preg_split('/\s*:\s*/u', $zweigText) ?: [] as $ebenenText) {
            if (trim($ebenenText) === '') {
                continue;
            }
            $glieder = [];
            $puffer = '';
            $tiefeEckig = 0;
            $tiefeRund = 0;
            $laenge = mb_strlen($ebenenText, 'UTF-8');
            for ($i = 0; $i < $laenge; $i++) {
                $zeichen = mb_substr($ebenenText, $i, 1, 'UTF-8');
                if ($zeichen === '[') {
                    $tiefeEckig++;
                } elseif ($zeichen === ']') {
                    $tiefeEckig = max(0, $tiefeEckig - 1);
                } elseif ($zeichen === '(') {
                    $tiefeRund++;
                } elseif ($zeichen === ')') {
                    $tiefeRund = max(0, $tiefeRund - 1);
                }
                if ($zeichen === ',' && $tiefeEckig === 0 && $tiefeRund === 0) {
                    if (trim($puffer) !== '') {
                        $glieder[] = trim($puffer);
                    }
                    $puffer = '';
                    continue;
                }
                $puffer .= $zeichen;
            }
            if (trim($puffer) !== '') {
                $glieder[] = trim($puffer);
            }
            if ($glieder !== []) {
                $ebenen[] = $glieder;
            }
        }
        if ($ebenen !== []) {
            $zweige[] = $ebenen;
        }
    }

    return $zweige;
}

/**
 * PURE: die Wikilink-Ziele eines Gliedes, in Reihenfolge.
 *
 * Dieselbe Regex wie avesmapsLoreExtractPlaceLinks (lore-parsing.php) -- absichtlich, denn beide
 * beantworten dieselbe Frage; nur die Deduplizierung fehlt hier, weil ein Glied mit zwei gleichen
 * Links trotzdem ein Glied mit ZWEI Links ist und als solches herausfallen muss.
 *
 * @return list<string>
 */
function avesmapsLoreRuleDeriveLinks(string $glied): array
{
    if (!str_contains($glied, '[[')) {
        return [];
    }
    if (preg_match_all('/\[\[\s*([^\]\|#<>\[]+?)\s*(?:#[^\]\|]*)?(?:\|[^\]]*)?\]\]/u', $glied, $treffer) < 1) {
        return [];
    }

    $out = [];
    foreach ($treffer[1] as $ziel) {
        $titel = trim(preg_replace('/\s+/u', ' ', str_replace('_', ' ', (string) $ziel)) ?? '');
        if ($titel !== '') {
            $out[] = $titel;
        }
    }

    return $out;
}

/** PURE: was neben den Links stehen bleibt -- und ob es die Aussage veraendert. */
function avesmapsLoreRuleDeriveRestIstHarmlos(string $glied): bool
{
    $rest = preg_replace('/\[\[[^\]]*\]\]/u', '', $glied) ?? '';
    foreach (avesmapsLoreRuleDeriveWortform($rest) as $wort) {
        if (!in_array($wort, AVESMAPS_LORE_RULE_DERIVE_HARMLOSE_WOERTER, true)) {
            return false;
        }
    }

    return true;
}

/**
 * PURE: enthaelt das Rohfeld eine Verneinung?
 *
 * 💣 „ganz [[Aventurien]] außer im Hohen Norden" waere als „Aventurien" abgeleitet SCHLIMMER als gar
 * nicht abgeleitet: die Regel behauptete genau das, was der Satz einschraenkt. Der GANZE Eintrag
 * faellt deshalb heraus, nicht nur das Glied -- die Verneinung bezieht sich auf die Aussage, nicht auf
 * ein Komma-Glied.
 */
function avesmapsLoreRuleDeriveHatVerneinung(string $roh): bool
{
    return preg_match('/(?:^|[\s,;:(\[])(?:au(?:ss|ß)er|ausgenommen|nicht|ohne)(?:$|[\s,;:.)\]])/ui', $roh) === 1;
}

// ===========================================================================
// 4. Aufloesen
// ===========================================================================

/**
 * PURE: ein Wiki-Titel -> Flaeche, oder ein Grund, warum nicht.
 *
 * Drei Wege in dieser Reihenfolge: `wiki_region_key` (der echte JOIN) -> Flaechenname ->
 * Flaechenname ohne Klammerzusatz. 🪤 Der Klammerweg steht ZULETZT, weil er der unschaerfste ist:
 * „Thorwal (Region)" darf erst dann auf „Thorwal" fallen, wenn nichts Genaueres passt.
 *
 * @return array{status:string, public_id?:string, grund?:string, treffer?:int}
 */
function avesmapsLoreRuleDeriveFlaeche(string $titel, array $katalog): array
{
    $schluessel = avesmapsLoreRuleDeriveFlaechenSchluessel($titel);
    if ($schluessel === '') {
        return ['status' => 'nein', 'grund' => 'freitext'];
    }

    foreach (['flaechen_nach_schluessel', 'flaechen_nach_name', 'flaechen_ohne_klammer'] as $index) {
        $treffer = $katalog[$index][$schluessel] ?? [];
        if ($treffer === []) {
            continue;
        }
        // 💣 Zwei gleichnamige Flaechen: NICHT raten. 13 Namen sind live doppelt vergeben.
        if (count($treffer) > 1) {
            return ['status' => 'nein', 'grund' => 'mehrdeutig', 'treffer' => count($treffer)];
        }

        return ['status' => 'ja', 'public_id' => (string) $treffer[0]];
    }

    // Der Klammerweg ein zweites Mal, diesmal fuer den TITEL: „Thorwal (Region)" gegen eine Flaeche,
    // die schlicht „Thorwal" heisst.
    $kurz = avesmapsLoreRuleDeriveOhneKlammer($titel);
    if ($kurz !== trim($titel)) {
        $kurzSchluessel = avesmapsLoreRuleDeriveFlaechenSchluessel($kurz);
        foreach (['flaechen_nach_schluessel', 'flaechen_nach_name'] as $index) {
            $treffer = $katalog[$index][$kurzSchluessel] ?? [];
            if ($treffer === []) {
                continue;
            }
            if (count($treffer) > 1) {
                return ['status' => 'nein', 'grund' => 'mehrdeutig', 'treffer' => count($treffer)];
            }

            return ['status' => 'ja', 'public_id' => (string) $treffer[0]];
        }
    }

    if (in_array($schluessel, AVESMAPS_LORE_RULE_DERIVE_FREMDE_WELTEN, true)
        || preg_match('/\((?:Globule|Sph[äa]re)\)/ui', $titel) === 1) {
        return ['status' => 'nein', 'grund' => 'fremde_welt'];
    }
    if (isset($katalog['territorien'][$schluessel])) {
        return ['status' => 'nein', 'grund' => 'herrschaftsgebiet'];
    }

    return ['status' => 'nein', 'grund' => 'unbekannt'];
}

/**
 * PURE: die Landschaftsarten aus `|Vorkommen=`.
 *
 * ⚠️ Mehrere Arten in EINER Bedingung sind kein Widerspruch, sondern ihr ODER: die `types` einer
 * Bedingung prueft avesmapsLoreRuleFlaecheErfuelltArtUndOrt mit `foreach … break`. „Küste, Steppe"
 * wird deshalb eine Bedingung mit zwei Arten, nicht zwei Bedingungen.
 *
 * 💣 Die Mehrzahl wird VORSICHTIG abgeschnitten („Wälder" -> „wald", „Steppen" -> „steppe"), und nur
 * dann, wenn die volle Form nichts findet. Das gilt AUSSCHLIESSLICH hier -- auf einem Ortsnamen waere
 * dieselbe Kuerzung ein Namensrat.
 *
 * @return list<array{kind:string, region_type:string, label:string}>
 */
function avesmapsLoreRuleDeriveArten(string $lebensraum, array $katalog): array
{
    if (trim($lebensraum) === '') {
        return [];
    }

    $kandidaten = avesmapsLoreRuleDeriveLinks($lebensraum);
    if ($kandidaten === []) {
        // Kein Link: dann sind es die Woerter selbst („Wald, Steppe" ohne Klammern).
        $roh = preg_replace('/<[^>]+>/u', ' ', $lebensraum) ?? $lebensraum;
        foreach (preg_split('/[,;\/]|\bund\b|\boder\b/u', $roh) ?: [] as $stueck) {
            $stueck = trim($stueck);
            if ($stueck !== '') {
                $kandidaten[] = $stueck;
            }
        }
    }

    $out = [];
    $gesehen = [];
    foreach ($kandidaten as $wort) {
        $wert = avesmapsLoreRuleDeriveArtWert($wort, $katalog);
        if ($wert === '' || isset($gesehen[$wert])) {
            continue;
        }
        $gesehen[$wert] = true;
        [$kind, $typeKey] = explode('|', $wert, 2);
        $out[] = [
            'kind' => $kind,
            'region_type' => $typeKey,
            'label' => (string) ($katalog['arten_meta'][$wert] ?? $typeKey),
        ];
    }

    return $out;
}

/** PURE: EIN Wort -> "kind|type_key", oder '' wenn der Katalog es nicht kennt. */
function avesmapsLoreRuleDeriveArtWert(string $wort, array $katalog): string
{
    $index = $katalog['arten_nach_wort'] ?? [];
    $schluessel = avesmapsWikiSyncCreateMatchKey(trim($wort));
    if ($schluessel === '') {
        return '';
    }
    if (isset($index[$schluessel])) {
        return (string) $index[$schluessel];
    }
    foreach (['ern', 'er', 'en', 'n', 'e'] as $endung) {
        if (!str_ends_with($schluessel, $endung)) {
            continue;
        }
        $kurz = substr($schluessel, 0, -strlen($endung));
        if ($kurz !== '' && isset($index[$kurz])) {
            return (string) $index[$kurz];
        }
    }

    return '';
}

// ===========================================================================
// 5. Der Vorschlag
// ===========================================================================

/**
 * PURE: warum ein Glied gar nicht erst aufgeloest wird -- '' heisst „es darf".
 *
 * Die Reihenfolge ist die der Schaerfe: ein Fragezeichen schlaegt alles (die Quelle ist selbst
 * unsicher), dann die Zahl der Links, zuletzt der Text daneben.
 */
function avesmapsLoreRuleDeriveGliedGrund(string $glied): string
{
    if (str_contains($glied, '?')) {
        return 'unsicher';
    }
    $links = avesmapsLoreRuleDeriveLinks($glied);
    if ($links === []) {
        return 'freitext';
    }
    if (count($links) > 1) {
        // 💣 „[[Nordaventurien|Nord-]] und [[Mittelaventurien]]" ist EIN Wort aus ZWEI Links,
        // „[[Südaventurien]] ([[Wald]])" eine Flaeche mit ihrer Art, „Katakomben unter [[Gareth]]"
        // etwas Drittes. Welcher Fall vorliegt, kann hier niemand entscheiden -- also wird nicht
        // entschieden.
        return 'mehrere_links';
    }
    if (!avesmapsLoreRuleDeriveRestIstHarmlos($glied)) {
        return 'zusatztext';
    }

    return '';
}

/**
 * PURE: der Satz, den die Vorschau zeigt.
 *
 * ⚠️ Wortgleiche Umschrift von avesmapsLoreRuleTermSentence (js/review/review-lore-rule.js), nur ohne
 * Auszeichnung: „<Art> innerhalb von <Fläche>" bzw. „die Fläche <X> selbst". Zwei Formulierungen
 * fuer dieselbe Regel waeren die Divergenz, vor der AGENTS.md §12 bei Farben warnt -- hier gilt sie
 * fuer Woerter. Der Klimateil fehlt, weil dieser Lauf nie einen schreibt.
 */
function avesmapsLoreRuleDeriveSatz(array $terms, array $arten, array $katalog): string
{
    if ($terms === []) {
        return '';
    }
    $artText = implode(' oder ', array_map(static fn (array $a): string => (string) $a['label'], $arten));
    $saetze = [];
    foreach ($terms as $term) {
        $publicId = (string) ($term['area_public_id'] ?? '');
        $name = (string) ($katalog['flaechen_meta'][$publicId]['name'] ?? $publicId);
        $saetze[] = $artText === ''
            ? 'die Fläche ' . $name . ' selbst'
            : $artText . ' innerhalb von ' . $name;
    }

    return implode(' oder ', $saetze);
}

/**
 * PURE: aus Ortsfeld + Lebensraumfeld die Bedingungskette bauen.
 *
 * `abgelehnt` heisst: der GANZE Eintrag wird nicht vorgeschlagen (heute nur die Verneinung).
 * `verworfen` sind die einzelnen Angaben, die nicht mitkommen -- jede mit ihrem Grund.
 *
 * @return array{terms:list<array<string,mixed>>, satz:string, arten:list<array<string,string>>,
 *               verworfen:list<array{text:string,grund:string}>, neu:bool, abgelehnt:?string}
 */
function avesmapsLoreRuleDeriveVorschlag(string $ortsfeld, string $lebensraum, array $katalog): array
{
    $leer = [
        'terms' => [], 'satz' => '', 'arten' => [], 'verworfen' => [], 'neu' => false, 'abgelehnt' => null,
    ];
    if (trim($ortsfeld) === '') {
        return $leer;
    }
    if (avesmapsLoreRuleDeriveHatVerneinung($ortsfeld)) {
        $leer['abgelehnt'] = 'verneinung';
        $leer['verworfen'][] = ['text' => trim($ortsfeld), 'grund' => 'verneinung'];

        return $leer;
    }

    $arten = avesmapsLoreRuleDeriveArten($lebensraum, $katalog);
    $typen = array_map(
        static fn (array $art): array => ['kind' => $art['kind'], 'region_type' => $art['region_type']],
        $arten
    );

    $flaechen = [];
    $verworfen = [];
    foreach (avesmapsLoreRuleDeriveZerlege($ortsfeld) as $zweig) {
        // 🔴 NUR die innerste Ebene. Die aeusseren sind Kontext (siehe Kopf dieser Datei).
        foreach ($zweig[count($zweig) - 1] as $glied) {
            $grund = avesmapsLoreRuleDeriveGliedGrund($glied);
            if ($grund !== '') {
                $verworfen[] = ['text' => $glied, 'grund' => $grund];
                continue;
            }
            $titel = avesmapsLoreRuleDeriveLinks($glied)[0];
            $treffer = avesmapsLoreRuleDeriveFlaeche($titel, $katalog);
            if (($treffer['status'] ?? '') !== 'ja') {
                $verworfen[] = ['text' => $titel, 'grund' => (string) ($treffer['grund'] ?? 'unbekannt')];
                continue;
            }
            $publicId = (string) $treffer['public_id'];
            if (!in_array($publicId, $flaechen, true)) {
                $flaechen[] = $publicId;
            }
        }
    }

    if (count($flaechen) > AVESMAPS_LORE_RULE_DERIVE_MAX_TERMS) {
        $verworfen[] = [
            'text' => (count($flaechen) - AVESMAPS_LORE_RULE_DERIVE_MAX_TERMS) . ' weitere Flächen',
            'grund' => 'zu_viele',
        ];
        $flaechen = array_slice($flaechen, 0, AVESMAPS_LORE_RULE_DERIVE_MAX_TERMS);
    }

    $terms = [];
    $neu = false;
    foreach ($flaechen as $index => $publicId) {
        $terms[] = [
            // 🔴 ODER, und das ist die Lesart, die die Messung stuetzt: die Glieder nach dem Komma
            // sind STAERKER verschachtelt (74,1 %) als das erste nach dem Doppelpunkt (52,3 %) --
            // sie stehen auf derselben Ebene, nicht in einem eigenen Zweig. In der Regelsprache ist
            // „dieselbe Ebene" die Vereinigung.
            'join_op' => $index === 0 ? 'und' : 'oder',
            'area_public_id' => $publicId,
            // 🔴 Aus Verbreitung/Vorkommen laesst sich KEINE Klimazone ableiten. „Ewiges Eis -> polar"
            // waere geraten, und eine geratene Spanne sieht aus wie eine gepflegte.
            'climate_from' => null,
            'climate_to' => null,
            'types' => $typen,
        ];
        $hatWikiKey = (bool) ($katalog['flaechen_meta'][$publicId]['hat_wiki_key'] ?? false);
        // „Neu" heisst: die Bedingung sagt etwas, das der Namenspfad (`lore_place` -> `?place=`)
        // nicht schon sagt. Das ist genau dann der Fall, wenn sie eine ART traegt (eine Art kann nie
        // eine Ortszeile werden) oder wenn die Flaeche keinen `wiki_region_key` hat (dann erreicht
        // der Namenspfad sie ueberhaupt nicht).
        if ($typen !== [] || !$hatWikiKey) {
            $neu = true;
        }
    }

    return [
        'terms' => $terms,
        'satz' => avesmapsLoreRuleDeriveSatz($terms, $arten, $katalog),
        'arten' => $arten,
        'verworfen' => $verworfen,
        'neu' => $neu,
        'abgelehnt' => null,
    ];
}

/**
 * PURE: das Ortsfeld (bzw. die Ortsfelder) eines Eintrags aus seinen Merkmalen.
 *
 * ⚠️ Der Rohtext steht in `merkmale_json`, weil `verbreitung`/`herkunft`/`regionen` nicht in
 * AVESMAPS_LORE_CORE_FIELDS stehen. Wer diese Konstante „aufraeumt" und sie hineinnimmt, nimmt dem
 * Ableiter seine Quelle.
 *
 * 💣 Die Schluessel in `merkmale_json` sind die ROHEN Parameternamen der Wiki-Seite („Verbreitung",
 * „ Verbreitung ", „VERBREITUNG") -- gefaltet wird mit derselben Funktion, mit der sie geschrieben
 * wurden (avesmapsWikiSyncMonitorFieldKey).
 *
 * @return array<string,string> relation => Rohtext
 */
function avesmapsLoreRuleDeriveOrtsfelder(string $kind, ?string $merkmaleJson): array
{
    $felder = AVESMAPS_LORE_PLACE_FIELDS[$kind] ?? [];
    if ($felder === []) {
        return [];
    }
    $merkmale = json_decode((string) ($merkmaleJson ?? ''), true);
    if (!is_array($merkmale)) {
        return [];
    }

    $normal = [];
    foreach ($merkmale as $schluessel => $wert) {
        if (!is_string($wert)) {
            continue;
        }
        $normal[avesmapsWikiSyncMonitorFieldKey((string) $schluessel)] = $wert;
    }

    $out = [];
    foreach ($felder as $feld => $relation) {
        $roh = trim((string) ($normal[$feld] ?? ''));
        if ($roh !== '') {
            $out[(string) $relation] = $roh;
        }
    }

    return $out;
}
