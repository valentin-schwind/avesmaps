<?php

declare(strict_types=1);

// Die Feldherkunft: welcher Wert eines Objekts kam aus dem WIKI und welchen haben WIR gesetzt.
//
// Entwurf: docs/superpowers/specs/2026-08-17-wiki-override-fuer-alle-design.md §2.1, §3.5
// Bauplan: docs/superpowers/plans/2026-08-17-wiki-override-ort.md, Aufgabe 3
//
// Der Owner, woertlich: „ich will sehen, was gesynct und was von uns editiert ist." Bis hierher war
// das nicht zu beantworten -- ein Kartenwert, der vom Wiki abweicht, konnte „bewusst geaendert" oder
// „nie gesynct" heissen, und beides sah gleich aus.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 DIE EINE REGEL
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
//   Beim Speichern bekommt jedes Feld, dessen Wert sich WIRKLICH AENDERT, eine Herkunft:
//   'wiki', wenn die Anfrage dieses Feld ausdruecklich als Wiki-Uebernahme nennt -- sonst 'manual'.
//   Ein Feld, das sich nicht aendert, wird NICHT ANGEFASST.
//
// 💣 „NUR WAS SICH AENDERT" IST DIE HAELFTE, AN DER ES SCHON EINMAL GESCHEITERT IST.
// `avesmapsUpsertGameLiterature` (api/_internal/app/game-literature.php) stempelt jedes
// MITGESCHICKTE Feld auf 'manual' -- und das Literatur-Formular schickt beim Speichern alle mit.
// Nach EINEM einzigen Speichern traegt dort jedes Feld „von Hand"; die Auskunft ist damit wertlos,
// obwohl die Spalte seit Monaten gepflegt aussieht. Wortgleiches Vorbild fuer die richtige Form:
// avesmapsWikiModelPlanOverrideSaves (js/review/wiki-model-override-save.js) -- „ein Feld, das der
// Benutzer nicht angefasst hat, loest gar nichts aus" (Fall #72).
//
// 💣 „IM ZWEIFEL 'manual'" IST DIE ANDERE HAELFTE, und die Richtung ist nicht beliebig: eine falsche
// 'wiki'-Angabe liesse einen spaeteren Abgleich eine Handarbeit ueberschreiben (Datenverlust), eine
// falsche 'manual'-Angabe schuetzt nur zu viel (Aergernis). Wer nichts sagt, hat von Hand
// geschrieben. ⚠️ Damit stempelt auch eine gecachte Oberflaeche, die den Payload-Schluessel noch
// nicht kennt (die Ladeluecke aus AGENTS.md §7), ihre Wiki-Uebernahmen als 'manual' -- die harmlose
// Richtung, und sie heilt sich bei der naechsten Uebernahme.
//
// 🔴 WARUM DER CLIENT SAGEN MUSS, WAS AUS DEM WIKI KAM, statt dass der Server es selbst vergleicht:
// drei der bearbeitbaren Felder sind ABGEBILDETE Werte -- freier Wikitext -> Schluesselvorrat
// (`feature_subtype` beim Ort und beim Weg, `region_type` bei der Landschaft). Die Abbildungen
// leben nur im Browser (avesmapsWikiAssignOrtOrtsgroesse, …WegWegtyp, …LandschaftArt), und die
// letzte traegt zusaetzlich die Ordnung „eigenes Vokabular vor Server-Synonymen". Sie hier
// nachzubauen waere die zweite Wahrheit, die AGENTS.md §5 verbietet. Der Client entscheidet also
// das WAS, dieser Rechner das OB.
//
// ⚠️ EIN FELD OHNE EINTRAG HEISST „NICHT BEKANNT", nie „vom Wiki" -- dieselbe Regel wie beim Merker
// `wiki_no_article`, der ebenfalls nur abgelegt wird, wenn er etwas aussagt. Am ersten Tag traegt
// deshalb kein Feld eine Herkunft, und alles verhaelt sich wie bisher.

// Die einzigen beiden Herkuenfte. 🔴 Die Werte sind ENGLISCH und heissen wie im Haus
// (`adventure.field_origins_json`, `lore_entry.field_origins_json`, `feature_sources.origin`) --
// AGENTS.md §8: Maschinenwerte werden nicht uebersetzt, und ein zweiter Name fuer dieselbe Sache
// ist genau das, was §5 verhindert.
const AVESMAPS_FIELD_ORIGIN_WIKI = 'wiki';
const AVESMAPS_FIELD_ORIGIN_MANUAL = 'manual';

/**
 * REIN: die Feldherkunft fortschreiben.
 *
 * @param array $bestand  die gespeicherte Karte `feld => 'wiki'|'manual'` (darf leer sein)
 * @param array $vorher   die Werte VOR dem Speichern, indiziert nach Feldname
 * @param array $nachher  die Werte NACH dem Speichern (bereits gekappt/normalisiert!)
 * @param array $ausWiki  Feldnamen, die diese Anfrage als Wiki-Uebernahme nennt
 * @return array die neue Karte -- nur geaenderte Felder sind angefasst
 *
 * 💣 `$nachher` MUSS DER GESPEICHERTE WERT SEIN, nicht der rohe aus der Anfrage. Die Textfelder des
 * Ortes werden auf 200/300/200 Zeichen gekappt (AVESMAPS_POINT_WIKI_TEXT_FIELDS); verglichen man
 * gegen den ungekappten, meldete ein Feld bei JEDEM Speichern „geaendert" -- und traegt danach ewig
 * eine Herkunft, die niemand gesetzt hat.
 */
function avesmapsFieldOriginsStempeln(array $bestand, array $vorher, array $nachher, array $ausWiki): array
{
    $karte = [];
    foreach ($bestand as $feld => $wert) {
        // Ein unbekannter Wert (etwa aus einer kuenftigen Fassung) faellt heraus, statt als Herkunft
        // durchgereicht zu werden -- dieselbe Strenge wie im Browser (js/ui/wiki-feld-herkunft.js).
        if ($wert === AVESMAPS_FIELD_ORIGIN_WIKI || $wert === AVESMAPS_FIELD_ORIGIN_MANUAL) {
            $karte[(string) $feld] = (string) $wert;
        }
    }

    $wikiFelder = [];
    foreach ($ausWiki as $feld) {
        $wikiFelder[(string) $feld] = true;
    }

    foreach ($nachher as $feld => $neu) {
        $feld = (string) $feld;
        $alt = avesmapsFieldOriginsNormalize($vorher[$feld] ?? null);
        if ($alt === avesmapsFieldOriginsNormalize($neu)) {
            continue; // 🔴 Fall #72: unveraendert heisst unangetastet.
        }
        $karte[$feld] = isset($wikiFelder[$feld])
            ? AVESMAPS_FIELD_ORIGIN_WIKI
            : AVESMAPS_FIELD_ORIGIN_MANUAL;
    }

    return $karte;
}

/**
 * REIN: Vergleichsform eines Werts. `null` und `''` sind dasselbe, Raender werden beschnitten --
 * wortgleich zu avesmapsWikiAssignDiffNormalize / avesmapsWikiFeldNormalize im Browser. Sonst
 * meldete ein `null` gegen ein `''` eine Aenderung, die niemand vorgenommen hat.
 */
function avesmapsFieldOriginsNormalize(mixed $wert): string
{
    return trim((string) ($wert ?? ''));
}

/**
 * REIN: die Feldliste aus einer Anfrage lesen -- gefiltert auf die erlaubten Felder.
 *
 * 💣 NIE ROH UEBERNEHMEN. Ein Client, der `"geometry"` oder `"is_hidden"` hineinschriebe, darf keine
 * Herkunft fuer etwas setzen, das gar kein Wiki-Feld ist -- die Karte waere danach mit Eintraegen
 * verstopft, die kein Leser je nachschlaegt, und ein spaeterer Leser haelt sie fuer eine Regel.
 *
 * ⚠️ Ein FEHLENDER Schluessel und eine LEERE Liste sind dasselbe: „nichts kam aus dem Wiki".
 */
function avesmapsFieldOriginsAusWikiLesen(array $payload, array $erlaubteFelder): array
{
    $roh = $payload['wiki_uebernommen'] ?? null;
    if (!is_array($roh)) {
        return [];
    }
    $erlaubt = [];
    foreach ($erlaubteFelder as $feld) {
        $erlaubt[(string) $feld] = true;
    }
    $liste = [];
    foreach ($roh as $feld) {
        $feld = (string) $feld;
        if (isset($erlaubt[$feld]) && !in_array($feld, $liste, true)) {
            $liste[] = $feld;
        }
    }
    return $liste;
}
