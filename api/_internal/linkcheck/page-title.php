<?php

declare(strict_types=1);

/**
 * Titel und Wirtsname aus einer abgerufenen Seite lesen.
 *
 * Entwurf: docs/superpowers/specs/2026-09-01-bekannte-quellen-design.md §4
 *
 * 🔴 REIN: nimmt HTML entgegen, gibt Text zurueck. Kein Abruf, kein PDO, kein Zustand -- damit die
 * Regel ohne Netz pruefbar ist. Wer hier einen `curl`-Aufruf einbaut, macht aus einer pruefbaren
 * Regel eine, die nur gegen fremde Server laeuft.
 *
 * Gemessen an den echten Seiten (01.09.2026):
 *   herzogtum-weiden.net  <h1> Herzogenstadt Trallop   <title> Herzogenstadt Trallop
 *   westlande.de          <h1> Apfeldorn               <title> Apfeldorn – AlberniaWiki
 *   wiki.punin.de         <h1> Baronie Taubental       <title> Baronie Taubental – Almada Wiki
 */

/**
 * ⚠️ WIE VIEL VON DER SEITE GENUEGT. Gemessen 02.09.2026: der `<title>` steht bei Byte 64-459,
 * die `<h1>` bei 4.509-9.287. 128 KB sind also reichlich und decken auch eine Seite mit langer
 * Navigation ab -- ohne dass wir je eine ganze Seite herunterladen, nur um zwei Zeilen zu lesen.
 * 💣 Der Deckel schneidet MITTEN IM MARKUP. Beide Leser unten muessen mit einem abgeschnittenen
 * Rumpf zurechtkommen und im Zweifel '' liefern, statt an einem halben Tag zu ersticken.
 */
const AVESMAPS_PAGE_TITLE_MAX_BYTES = 131072;

/**
 * Ein Textstueck aus dem Markup zu lesbarem Text machen.
 *
 * 💣 `strip_tags` ALLEIN reicht nicht: MediaWiki setzt in die `<h1>` ein `<span>`, und ohne das
 * Zusammenziehen der Leerzeichen kaeme „Baronie   Taubental" heraus. Und ohne `html_entity_decode`
 * stuende „Gr&auml;flich Abagund" im Feld -- sichtbar falsch, aber erst, wenn es gespeichert ist.
 */
function avesmapsPageTitleCleanText(string $roh): string
{
    $text = preg_replace('/<[^>]*>/', ' ', $roh) ?? '';
    $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    // ⚠️ Auch das geschuetzte Leerzeichen (U+00A0), das MediaWiki gern setzt -- `\s` kennt es nicht.
    $text = preg_replace('/(?:\s|\x{00A0})+/u', ' ', $text) ?? $text;

    return trim($text);
}

/**
 * Die erste `<h1>` der Seite. '' wenn keine da ist.
 *
 * 🔴 DIE `<h1>` IST DIE BESSERE QUELLE ALS DER `<title>` -- gemessen: der `<title>` traegt bei
 * jedem Wiki einen Seitenzusatz („Baronie Taubental – Almada Wiki"), die `<h1>` ist sauber.
 *
 * ⚠️ Leer zurueck ist ein GUELTIGES Ergebnis und heisst „erreichbar, aber nichts zu lesen". Das
 * ist der mittlere der drei Zustaende und darf nie wie ein Fehlschlag aussehen: der Link ist gut,
 * nur der Titel muss von Hand kommen.
 */
function avesmapsPageTitleHeading(string $html): string
{
    if (preg_match('/<h1\b[^>]*>(.*?)<\/h1>/is', $html, $treffer) !== 1) {
        return '';
    }

    return avesmapsPageTitleCleanText($treffer[1]);
}

/** Der rohe `<title>` der Seite, aufgeraeumt. '' wenn keiner da ist. */
function avesmapsPageTitleDocumentTitle(string $html): string
{
    if (preg_match('/<title\b[^>]*>(.*?)<\/title>/is', $html, $treffer) !== 1) {
        return '';
    }

    return avesmapsPageTitleCleanText($treffer[1]);
}

/**
 * ⚠️ Die Trennzeichen, mit denen ein Wiki seinen Namen an den Seitentitel haengt. Der Halbgeviert-
 * strich (–) ist der haeufigste und NICHT dasselbe Zeichen wie der Bindestrich (-).
 */
const AVESMAPS_PAGE_TITLE_SEPARATORS = [' – ', ' — ', ' - ', ' | ', ' · ', ' :: '];

/**
 * Der Wirtsname aus dem Zusatz des `<title>`. '' wenn keiner zu erkennen ist.
 *
 * ⭐ DIE ENTDECKUNG, DIE DEN ABRUF DOPPELT WERTVOLL MACHT: der Zusatz NENNT DEN KORPUS. „Almada
 * Wiki", „AlberniaWiki", „Wiki Aventurica" sind genau die Namen, die die Editoren sonst selbst
 * erfinden. EIN Abruf liefert damit beide Haelften -- den Titel dieser Seite und einen Vorschlag
 * fuer den Korpusnamen.
 *
 * 💣 DER KOPF MUSS DER UEBERSCHRIFT ENTSPRECHEN, sonst wird geraten. Ein Seitentitel darf einen
 * Gedankenstrich selbst tragen („Nostria – die Stadt am Meer"); ohne diese Bedingung erklaerten wir
 * „die Stadt am Meer" zum Namen des Korpus und schrieben ihn allen seinen Quellen an. Gemessen
 * traegt jede der drei Wiki-Seiten ihren Kopf zeichengleich als `<h1>`; die Weiden-Seiten haben
 * ueberhaupt keinen Zusatz -- und bekommen damit korrekt KEINEN Vorschlag.
 *
 * ⚠️ Ohne `<h1>` gibt es keinen Vorschlag. Ohne den Vergleich waere jeder Titel mit einem Strich
 * darin eine Behauptung ueber den Korpusnamen.
 */
function avesmapsPageTitleSiteName(string $html): string
{
    $ueberschrift = avesmapsPageTitleHeading($html);
    $seitentitel = avesmapsPageTitleDocumentTitle($html);
    // 🪤 `$ueberschrift === ''` ist HEUTE unerreichbar, und das steht hier, damit es niemand
    // „aufraeumt": damit es wirkte, muesste `$kopf` leer sein, also muesste der Seitentitel mit
    // einem Trenner ANFANGEN -- und jeder Trenner beginnt mit einem Leerzeichen, das
    // `avesmapsPageTitleCleanText` vorher wegtrimmt. Die Bedingung ist die Versicherung gegen
    // genau eine kuenftige Aenderung: einen Trenner OHNE fuehrendes Leerzeichen. Dann waeren Kopf
    // und Ueberschrift beide leer, der Vergleich ginge durch, und ein fremdes „Wiki" wuerde zum
    // Namen unseres Korpus erklaert. Die Mutationsprobe weist sie deshalb als aequivalenten
    // Mutanten aus; `page-title-test.php` nagelt stattdessen die VORAUSSETZUNG fest.
    if ($ueberschrift === '' || $seitentitel === '') {
        return '';
    }
    foreach (AVESMAPS_PAGE_TITLE_SEPARATORS as $trenner) {
        $stelle = mb_strpos($seitentitel, $trenner);
        if ($stelle === false) {
            continue;
        }
        $kopf = trim(mb_substr($seitentitel, 0, $stelle));
        $rest = trim(mb_substr($seitentitel, $stelle + mb_strlen($trenner)));
        if ($kopf !== $ueberschrift || $rest === '') {
            continue;
        }
        // ⚠️ Ein Zusatz kann selbst noch einen Trenner tragen („Wiki Aventurica – das DSA-Lexikon").
        // Genommen wird das ERSTE Stueck: der Name, nicht der Werbespruch dahinter.
        foreach (AVESMAPS_PAGE_TITLE_SEPARATORS as $weiterer) {
            $zweite = mb_strpos($rest, $weiterer);
            if ($zweite !== false) {
                $rest = trim(mb_substr($rest, 0, $zweite));
            }
        }

        return $rest !== '' ? $rest : '';
    }

    return '';
}

/**
 * Beides auf einmal: { title, site }. Der Trichter, den der Endpunkt ruft.
 *
 * 🔴 EIN Leser fuer beide Werte, damit sie nie auseinanderlaufen -- der Wirtsname wird aus dem
 * Vergleich mit DERSELBEN Ueberschrift gewonnen, die als Titel herausgeht.
 */
function avesmapsPageTitleRead(string $html): array
{
    return [
        'title' => avesmapsPageTitleHeading($html),
        'site' => avesmapsPageTitleSiteName($html),
    ];
}
