import { leseParameter } from "./block.ts";
import { analysiere } from "./seite.ts";
import {
    LEER,
    LEER_FOLGE,
    ZEILENENDE,
    einzeilig,
    entschluesseleHtml,
    kuerze,
    phpTrim,
    schluesselform,
    titelOhneAuszeichnung,
} from "./text.ts";

/**
 * Die Publikationen eines Artikels und die Produktseiten, auf die sie zeigen (WI-0253, Scheibe Quellen), Zeichen für Zeichen nach Legacy (Mirror a7f2dac86,
 * `api/_internal/wiki/publication-parsing.php`):
 *
 * - `lesePublikationen` ← `avesmapsWikiParsePublicationsSection`: der erste Abschnitt `== Publikationen ==` bis zur nächsten Überschrift der Ebene 2; darin die
 *   Unterüberschriften der Ebene 3, deren Schlüsselform mit `ausfuhrlich`, `erganzend` oder `erwahnung` beginnt (andere fallen weg), darunter die Aufzählungszeilen
 *   `* [[Produktseite]] Seite 54 <small>(Notiz)</small>`. Die Zeile wird GENAU EINMAL entschlüsselt (`&#38;` im Titel ergäbe sonst einen anderen Schlüssel).
 * - `leseSeitenangabe` ← `avesmapsWikiParsePageRef`: Fett weg, die Notiz aus `<small>(…)</small>` oder der ersten Klammer, alle Ziffernfolgen als Seiten („40, 145“;
 *   ein Bereich „12–15“ wird „12, 15“).
 * - `leseProduktseite` ← der Katalogschritt (`avesmapsPublicationBuildCatalogStep`, `publication-sync.php`) mit `avesmapsWikiParseProductInfobox` und
 *   `avesmapsWikiBuildPublicationUrl`: Ist die Seite eine Produktseite (erste Infobox `Produkt`), welche Shop-Adresse hat sie (F-Shop vor PDF-Shop), und unter welchem
 *   Titel führt Legacy die Quelle (`avesmapsWikiPublicationDisplayTitle`, dann `avesmapsNormalizeSourceLabel`)?
 *
 * 🪤 PHPs `\s` und `\d` mit dem Modifikator `u` sind Unicode-Klassen (PCRE2_UCP): `LEER` und `\p{Nd}`.
 */

export const REFERENZ_ARTEN = ["ausfuehrlich", "ergaenzend", "erwaehnung"] as const;
export type ReferenzArt = (typeof REFERENZ_ARTEN)[number];

/** Legacy `avesmapsWikiPublicationSectionKind`: die Art einer Unterüberschrift, oder `null` (Elektronische Quellen, Bildquellen, Unbekanntes). */
export function abschnittsArt(ueberschrift: string): ReferenzArt | null {
    const schluessel = schluesselform(ueberschrift);
    if (schluessel === "" || schluessel.startsWith("elektronisch") || schluessel.startsWith("bildquell")) return null;
    if (schluessel.startsWith("ausfuhrlich")) return "ausfuehrlich";
    if (schluessel.startsWith("erganzend")) return "ergaenzend";
    if (schluessel.startsWith("erwahnung")) return "erwaehnung";
    return null;
}

export interface Seitenangabe {
    seiten: string | null;
    notiz: string | null;
}

const SMALL = new RegExp(`<small>${LEER}*([\\s\\S]*?)${LEER}*<\\/small>`, "iu");
const SMALL_ALLE = /<small>[\s\S]*?<\/small>/giu;

/** Legacy `avesmapsWikiParsePageRef`. */
export function leseSeitenangabe(text: string): Seitenangabe {
    let rein = text.replaceAll("'''", "");
    let notiz: string | null = null;
    const klein = SMALL.exec(rein);
    if (klein !== null) {
        let innen = phpTrim(klein[1] ?? "");
        const klammer = /^\(([\s\S]*)\)$/u.exec(innen);
        if (klammer !== null) innen = phpTrim(klammer[1] ?? "");
        notiz = innen !== "" ? innen : null;
        rein = phpTrim(rein.replace(SMALL_ALLE, " "));
    } else {
        const klammer = /\(([^()]*)\)/u.exec(rein);
        if (klammer !== null) {
            const innen = phpTrim(klammer[1] ?? "");
            notiz = innen !== "" ? innen : null;
            rein = phpTrim(rein.replace(/\([^()]*\)/u, " "));
        }
    }
    const ziffern = rein.match(/\p{Nd}+/gu);
    return { seiten: ziffern === null ? null : ziffern.join(", "), notiz };
}

export interface Zitat {
    /** Das Linkziel der Zeile (getrimmt), wie es im Artikel steht. */
    titel: string;
    art: ReferenzArt;
    seiten: string | null;
    notiz: string | null;
}

const KOPF = new RegExp(`^==${LEER}*Publikationen${LEER}*==${LEER}*$`, "imu");
const NAECHSTER_ABSCHNITT = /^==[^=].*$/mu;
const UNTERABSCHNITT = new RegExp(`^===${LEER}*(.+?)${LEER}*===${LEER}*$`, "gmu");
const ZITATZEILE = new RegExp(`\\[\\[([^\\]|#]+)(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]${LEER}*(.*)$`, "u");

/** Legacy `avesmapsWikiParsePublicationsSection`: alle Zitate des Abschnitts in ihrer Reihenfolge (auch doppelte; das erste gewinnt beim Abgleich). */
export function lesePublikationen(wikitext: string): Zitat[] {
    const kopf = KOPF.exec(wikitext);
    if (kopf === null) return [];
    let rumpf = wikitext.slice(kopf.index + kopf[0].length);
    const naechster = NAECHSTER_ABSCHNITT.exec(rumpf);
    if (naechster !== null) rumpf = rumpf.slice(0, naechster.index);

    const unter = [...rumpf.matchAll(UNTERABSCHNITT)];
    const aus: Zitat[] = [];
    for (const [i, treffer] of unter.entries()) {
        const art = abschnittsArt(treffer[1] ?? "");
        if (art === null) continue;
        const anfang = treffer.index + treffer[0].length;
        const ende = unter[i + 1]?.index ?? rumpf.length;
        for (const roh of rumpf.slice(anfang, ende).split(ZEILENENDE)) {
            const zeile = phpTrim(roh);
            if (zeile === "" || zeile.charAt(0) !== "*") continue;
            const link = ZITATZEILE.exec(entschluesseleHtml(zeile));
            if (link === null) continue;
            const titel = phpTrim(link[1] ?? "");
            if (titel === "") continue;
            const angabe = leseSeitenangabe(link[2] ?? "");
            aus.push({ titel, art, seiten: angabe.seiten, notiz: angabe.notiz });
        }
    }
    return aus;
}

/** PHPs `rawurlencode`: RFC 3986, nur Buchstaben, Ziffern und `-_.~` bleiben. */
export const rawurlencode = (text: string): string =>
    encodeURIComponent(text).replace(
        /[!'()*]/gu,
        (zeichen) => `%${(zeichen.codePointAt(0) ?? 0).toString(16).toUpperCase()}`,
    );

/** Legacy `avesmapsWikiBuildPublicationUrl`: F-Shop vor PDF-Shop; eine Kennung ohne Ziffer ist ein Platzhalter und ergibt keine Adresse. */
export function publikationsAdresse(fShopPid: string | null, pdfShopId: string | null): string | null {
    const fShop = phpTrim(fShopPid ?? "");
    const pdfShop = phpTrim(pdfShopId ?? "");
    // PHP `preg_match('/\d/', …)` ohne `u`: nur die ASCII-Ziffern.
    if (/[0-9]/u.test(fShop)) return `https://www.f-shop.de/search?sSearch=${rawurlencode(fShop)}`;
    if (/[0-9]/u.test(pdfShop)) return `https://www.ulisses-ebooks.de/de/product/${rawurlencode(pdfShop)}/`;
    return null;
}

const KLASSE = LEER.slice(1, -1);
const F_SHOP = new RegExp(`\\{\\{${LEER}*F-Shop${LEER}*\\|${LEER}*PID${LEER}*=${LEER}*([^|}${KLASSE}]+)`, "iu");
const PDF_SHOP = new RegExp(`\\{\\{${LEER}*PDF-Shop${LEER}*\\|${LEER}*ID${LEER}*=${LEER}*([^|}${KLASSE}]+)`, "iu");

export interface Produktseite {
    /** Die Shop-Adresse (Identität `url:<sha256>`); `null`: keine, die Publikation ist URL-los (`wikipub:<Schlüssel>`). */
    adresse: string | null;
    /** Der Titel, unter dem Legacy die Quelle führt (`feature_source.title`); ohne `Titel` in der Infobox der Seitenname. */
    titel: string;
    /** Die Art der Quelle, mit der Legacy sie anlegt (`feature_source.source_type`, eine der acht Arten): aus `Art`, sonst `Unterkategorie`. */
    quellenart: string;
}

/**
 * Legacy `avesmapsWikiMapArtToSourceType` (`publication-parsing.php`): die Schlüsselform von `Art` (sonst `Unterkategorie`) trifft einen Eintrag der Tafel genau oder, in der Reihenfolge
 * der Tafel, als Teilwort in der einen oder anderen Richtung; sonst `sonstiges`. Legacy setzt die Art nur beim Anlegen einer Quelle.
 */
const QUELLENARTEN: readonly (readonly [string, string])[] = [
    ["abenteuer", "abenteuer"],
    ["kaufabenteuer", "abenteuer"],
    ["soloabenteuer", "abenteuer"],
    ["gruppenabenteuer", "abenteuer"],
    ["szenario", "abenteuer"],
    ["anthologie", "abenteuer"],
    ["kampagnenband", "abenteuer"],
    ["metaband", "abenteuer"],
    ["kurzgeschichte", "roman"],
    ["regionalspielhilfe", "regionalspielhilfe"],
    ["quellenband", "quellenband"],
    ["roman", "roman"],
    ["regelband", "regelbuch"],
    ["regelwerk", "regelbuch"],
    ["basisregelwerk", "regelbuch"],
    ["briefspiel", "briefspiel"],
    ["aventurischerbote", "aventurischer_bote"],
];

export function quellenartAusArt(art: string, unterkategorie: string): string {
    let schluessel = schluesselform(art);
    if (schluessel === "") schluessel = schluesselform(unterkategorie);
    if (schluessel === "") return "sonstiges";
    const genau = QUELLENARTEN.find(([name]) => name === schluessel);
    if (genau !== undefined) return genau[1];
    for (const [name, quellenart] of QUELLENARTEN) {
        if (schluessel.includes(name) || name.includes(schluessel)) return quellenart;
    }
    return "sonstiges";
}

/**
 * Legacy `avesmapsWikiPublicationDisplayTitle`: der Titel der Infobox, außer die Seite heißt genau „Titel – Untertitel“ (Trennzeichen gefaltet: Bindestrich, Gedankenstriche,
 * Doppelpunkt): dann gehört der Untertitel zum Namen, und der Seitenname ist der ehrliche Titel. Ein bloß beschreibender Untertitel fällt weg. Ohne `Titel` gilt der Seitenname.
 */
export function anzeigeTitel(seitenTitel: string, titel: string, untertitel: string): string {
    const seite = phpTrim(seitenTitel);
    const kopf = phpTrim(titel);
    const unter = phpTrim(untertitel);
    if (kopf === "") return seite;
    if (unter === "" || seite === "") return kopf;
    const falte = (text: string): string =>
        phpTrim(
            text
                .replace(/[‐-―:]/gu, "-")
                .replace(new RegExp(`${LEER}*-${LEER}*`, "gu"), " - ")
                .replace(LEER_FOLGE, " "),
        ).toLowerCase();
    return falte(seite) === falte(`${kopf} - ${unter}`) ? seite : kopf;
}

/** Legacy `avesmapsNormalizeSourceLabel`: ohne Auszeichnung (`titelOhneAuszeichnung`), einzeilig, 200 Zeichen. So steht ein Titel in `feature_source.title`. */
export const quellenTitelBereinigt = (wert: string): string => einzeilig(titelOhneAuszeichnung(wert), 200);

/**
 * Ist die Seite eine Produktseite, die Legacys Katalog aufnimmt (Text nennt „Produkt“, erste Infobox `Produkt`)? Den Namensraum und die Weiterleitung prüft der Aufrufer
 * (`seiten-sammler.ts`); eine offene Klammer zählt wie in Legacy (`avesmapsWikiSyncMonitorExtractInfoboxBlock` liest dann bis zum Ende).
 */
export function leseProduktseite(titel: string, wikitext: string): Produktseite | null {
    if (!/produkt/iu.test(wikitext)) return null;
    const seite = analysiere(titel, wikitext);
    if (seite.block.block === "" || seite.infoboxSchluessel !== "produkt") return null;
    const parameter = new Map<string, string>();
    for (const [name, wert] of leseParameter(seite.block.block)) parameter.set(name, entschluesseleHtml(wert));
    const fShop = F_SHOP.exec(parameter.get("Direktlinks") ?? "");
    const pdfShop = PDF_SHOP.exec(parameter.get("Download") ?? "");
    // Der Katalogschritt kürzt den Titel auf 300 Zeichen, der Upsert der Quelle bereinigt ihn danach (200).
    const anzeige = anzeigeTitel(titel, parameter.get("Titel") ?? "", parameter.get("Untertitel") ?? "");
    return {
        adresse: publikationsAdresse(phpTrim(fShop?.[1] ?? ""), phpTrim(pdfShop?.[1] ?? "")),
        titel: quellenTitelBereinigt(kuerze(anzeige, 300)),
        quellenart: quellenartAusArt(
            phpTrim(parameter.get("Art") ?? ""),
            phpTrim(parameter.get("Unterkategorie") ?? ""),
        ),
    };
}
