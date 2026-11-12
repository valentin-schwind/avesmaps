import { createHash } from "node:crypto";
import { WIKISYNC_KLIMAZONEN, type WikisyncRegelGrund, type WikisyncRegelLage } from "@avesmaps3d/shared";
import { lageSchluessel, ruleKeyOf, type RuleTermKeyInput } from "../../migration/lore-keys.ts";
import { relationenDerArt } from "../abgleich/vorkommen.ts";
import type { VorkommenBeziehung } from "../infobox/vorkommen.ts";
import { grossraumWort, pillenGelesen } from "./begriffe.ts";
import {
    FAEHIGKEITEN,
    bewerteEintrag,
    leseLebensraum,
    leseOrtsfeld,
    type EintragBewertung,
    type GliedEintrag,
    type GliedErgebnis,
} from "./bewerten.ts";
import { QUAL_WOERTER, type Baustein, type Flaeche, type GliedAnalyse, type RegelWissen } from "./lesen.ts";

/**
 * Die Ableitung der Regelvorschläge eines Vorkommens (WI-0253 Scheibe Regelvorschläge, §24; Regelbuch `review/wi-0253/regelbuch/regelbuch.md`, Abschnitt 3): aus den Rohtexten der Infobox
 * (`Verbreitung`, `Herkunft`, `Regionen`, `Vorkommen`) je Beziehung eine Kette von Bedingungen und die Satzteile, die sich nicht abbilden lassen, mit ihrem Grund. REIN: keine Datenbank, nichts
 * wird geschrieben; die Bewertung (`bewerten.ts`) ist der Nachbau der Analyse, die Bedingungen entstehen aus denselben Urteilen.
 *
 * Eine Bedingung hat eine Fläche (höchstens eine), Landschaftsarten (untereinander ODER), eine Klimaspanne und, seit WI-0254, eine Lage zu einer Linie; die Verknüpfungen `und`/`oder`/`ohne` gelten strikt von
 * links nach rechts (F1: `ohne` heißt „bisher minus diese Bedingung“). Eine Lage („ganz Aventurien südlich von Festum“, „südlich der Linie Havena–Perricum“, „zwischen Riva und Al'Anfa“) liest `lage.ts`, wo jeder
 * Ort GENAU EINE aktive Siedlung der Karte ist; sie trägt immer die Rückfrage `lage`. „Zwischen A und B“ sind zwei Bedingungen mit UND (die zweite ohne Fläche) und rücken als Paar an den Anfang der Kette,
 * weil ein UND mit allem davor rechnet. Jede andere Richtung und jede Linie, die sich so nicht lesen lässt (F2): Der Satzteil steht als Teil mit Originaltext und Grund im Vorschlag. Eine Fläche, die es in der
 * Karte (noch) nicht gibt, steht als offene Bedingung (F4, „!“): Die Regel wartet und zählt nirgends, bis jede Fläche zugewiesen ist.
 *
 * **Großräume** (Vali 2026-10-27, Option A): Ein Artikel ohne Fläche, den die Begriffstafel als Großraum kennt („Hoher Norden“, „Ewiges Eis“, „Klirrfrostwüste“), ist keine offene Fläche, sondern eine
 * Klimaspanne INNERHALB einer umgebenden Fläche (Aventurien) mit der Rückfrage `grossraum`. Die Fläche der Karte mit dem Wiki-Schlüssel geht immer vor; leere Pillen in der Tafel schalten den Großraum ab.
 */

export const BEDINGUNGEN_MAX = 25;

export interface BedFlaeche {
    /** Der Name der Fläche; bei einer offenen der Name im Wiki. */
    name: string;
    /** `region.id` und `region.public_id`; `null` bei einer offenen Fläche. */
    id: string | null;
    kennung: string | null;
    /** F4: Es gibt (noch) keine Fläche mit diesem Wiki-Schlüssel. */
    offen: boolean;
    /** Der Titel des Wiki-Artikels, über den die Fläche gefunden wird. */
    titel: string | null;
    /** Bei einer offenen Fläche: eine Fläche gleichen Namens ohne Wiki-Schlüssel (nie geraten). */
    kandidat: string | null;
}

/**
 * Die Lage zu einer Linie einer Bedingung (WI-0254): Richtung und ein oder zwei Siedlungen der Karte mit Kennung (`place.public_id`), Name und Stelle; dieselbe Form wie im Vertrag
 * (`WikisyncRegelLage`), damit das Protokoll der Ableitung sie ohne Umbau trägt. Die Orte stehen in der Reihenfolge der Nennung im Wiki; der Fingerabdruck sortiert sie (A–B ist B–A).
 */
export type BedLage = WikisyncRegelLage;

export interface Bed {
    verknuepfung: "und" | "oder" | "ohne";
    flaeche: BedFlaeche | null;
    arten: { ebene: string; art: string }[];
    klima: { von: string; bis: string } | null;
    /** Die Lage zu einer Linie; fehlt, wo die Bedingung keine hat. Nur dann geht sie in `bedSchluessel` und `regelSchluessel` ein (ohne Lage bleiben beide byte-gleich, Goldtest in `lore.test.ts`). */
    lage?: BedLage;
    woerter: string[];
    rueckfragen: string[];
}

export interface Teil {
    beziehung: VorkommenBeziehung;
    text: string;
    grund: WikisyncRegelGrund;
    art: "nicht_abbildbar" | "rueckfrage";
}

export interface BeziehungsAbleitung {
    beziehung: VorkommenBeziehung;
    bedingungen: Bed[];
    teile: Teil[];
}

export type OriginalZustand = "ok" | "offen" | "fehler" | "neutral";
export interface OriginalFeld {
    feld: VorkommenBeziehung;
    teile: { text: string; zustand: OriginalZustand; trenner: string }[];
}

export interface Ableitung {
    bewertung: EintragBewertung;
    beziehungen: BeziehungsAbleitung[];
    original: OriginalFeld[];
    /** Die Wörter, die die Ableitung sah: Wort der Begriffstafel oder freier Rest, mit der Zahl; `tafel` sagt, ob das Wort in der Tafel steht. */
    woerter: Map<string, { n: number; tafel: boolean }>;
}

export interface EintragEingabe {
    art: string;
    /** Die Rohtexte: `roh_verbreitung`, `roh_herkunft`, `roh_regionen`, `roh_vorkommen`. */
    felder: Readonly<Record<string, string | undefined>>;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Klartext
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const LINK = /\[\[\s*([^\]|#<>[]*?)\s*(#[^\]|]*)?(?:\|([^\]]*))?\]\]([a-zäöüß]*)/gu;

/** Der Text mit Links durch ihre Anzeigeform ersetzt (Python `plain`). */
export function klartext(text: string): string {
    return text
        .replace(
            LINK,
            (_treffer, ziel: string, _anker: string | undefined, anzeige: string | undefined, endung: string) => {
                const z = ziel.trim();
                if (/^(?:kategorie|datei|bild|vorlage):/iu.test(z)) return "";
                return ((anzeige ?? "") !== "" ? (anzeige ?? "") : z).trim() + endung;
            },
        )
        .replace(/\s+/gu, " ")
        .trim();
}

const ZWISCHEN_MARKEN = /^(und|sowie|oder|&|\/|,)?$/u;

/** Python `koordiniert`: Stehen zwischen den Links nur „und“, „oder“, Komma … (eine Aufzählung)? */
function koordiniert(aussen: string): boolean {
    const teile = aussen.split(/§[\p{L}\p{N}_]*/u);
    return teile
        .slice(1, -1)
        .map((t) => t.trim().toLowerCase())
        .every((mitte) => ZWISCHEN_MARKEN.test(mitte));
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Gründe
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const GRUND_VON: Readonly<Record<string, WikisyncRegelGrund>> = {
    linie: "linie",
    teilflaeche: "teilflaeche",
    bezugspunkt: "bezugspunkt",
    historisch: "frueher",
    negation: "verneinung",
    nach_verneinung: "nach_verneinung",
    hoehe: "hoehe",
    unterwelt: "unterwelt",
    fluss: "fluss",
    gebiet: "gebiet_mit_art",
    siedlung: "siedlung",
    klima_vage: "klima_vage",
    klima: "klima_vage",
    volk: "volk",
    fehlt: "kein_artikel",
    sonstiges: "begriff_ohne_ort",
    freitext: "freitext",
    wort_offen: "wort_offen",
    gewaesser: "fluss",
};

const grundVon = (wort: string): WikisyncRegelGrund => GRUND_VON[wort] ?? "wort_luecke";

const RUECKFRAGE_QUALS: readonly (readonly [string, WikisyncRegelGrund])[] = [
    ["rand", "rand"],
    ["naehe", "naehe"],
    ["unsicher", "unsicher"],
    ["magisch", "magisch"],
];

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Bedingungen
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const flaecheAus = (f: Flaeche): BedFlaeche => ({
    name: f.name,
    id: f.id,
    kennung: f.kennung,
    offen: false,
    titel: f.titel,
    kandidat: null,
});

const offeneFlaeche = (titel: string, wissen: RegelWissen, kandidat?: string): BedFlaeche => ({
    name: titel,
    id: null,
    kennung: null,
    offen: true,
    titel,
    kandidat: kandidat ?? wissen.flaechenNamen().get(titel.toLowerCase())?.[0]?.name ?? null,
});

interface Pillen {
    arten: { ebene: string; art: string }[];
    klima: { von: string; bis: string } | null;
    woerter: string[];
}

/**
 * Wohin eine Bedingung zeigt: auf eine Fläche der Karte (`pillen: null`), auf eine offene Fläche (`pillen: null`, die Regel wartet) oder auf einen Großraum, der als Klimaspanne innerhalb einer
 * umgebenden Fläche gelesen wird (`pillen`: die Pillen des Großraums; `flaeche`: die umgebende Fläche, oder `null`, wo es keine gibt: dann gilt die Spanne überall).
 */
interface Ziel {
    flaeche: BedFlaeche | null;
    pillen: Pillen | null;
}

const mitFlaeche = (f: Flaeche): Ziel => ({ flaeche: flaecheAus(f), pillen: null });

/**
 * Das Ziel eines Artikels, der KEINE Fläche mit diesem Wiki-Schlüssel hat: ein Großraum der Begriffstafel (mit mindestens einer geltenden Pille) wird die umgebende Fläche mit der Klimaspanne,
 * sonst entsteht die offene Fläche (F4). Eine Fläche der Karte mit dem Schlüssel geht immer vor: Trägt eine den Artikel, gilt der Großraum nicht. Die EINE Stelle, an der eine offene Fläche entsteht.
 */
function zielDes(titel: string, wissen: RegelWissen, kandidat?: string): Ziel[] {
    const grossraum = wissen.flaechen(titel).length === 0 ? wissen.tafel.grossraum(titel) : undefined;
    if (grossraum === undefined) return [{ flaeche: offeneFlaeche(titel, wissen, kandidat), pillen: null }];
    const gelesen = pillenGelesen(grossraum.pillen);
    const pillen: Pillen = { arten: gelesen.arten, klima: gelesen.klima, woerter: [grossraum.wort] };
    const umgebung = grossraum.innerhalb === null ? [] : wissen.flaechen(grossraum.innerhalb);
    return umgebung.length === 0
        ? [{ flaeche: null, pillen }]
        : umgebung.map((f): Ziel => ({ flaeche: flaecheAus(f), pillen }));
}

/** Die Ziele eines Wiki-Titels: seine Flächen der Karte, sonst `zielDes`. */
function zieleVon(titel: string, wissen: RegelWissen): Ziel[] {
    const flaechen = wissen.flaechen(titel);
    return flaechen.length === 0 ? zielDes(titel, wissen) : flaechen.map(mitFlaeche);
}

/** Die Ziele eines Bausteins: eine Bedingung je Fläche, die den Artikel trägt; ohne Fläche ein Großraum oder eine offene Fläche. */
function flaechenDes(b: Baustein, wissen: RegelWissen): Ziel[] {
    if (b.art === "luecke_region_ohne_flaeche") return zielDes(b.wert, wissen);
    if (b.offen === true || (b.flaechen ?? []).length === 0) return zielDes(b.wert, wissen, b.kandidat);
    return (b.flaechen ?? []).map(mitFlaeche);
}

const zoneIndex = (zone: string): number => (WIKISYNC_KLIMAZONEN as readonly string[]).indexOf(zone);

/**
 * Die Pillen eines Glieds mit denen eines Großraums zusammengeführt: Arten des Glieds, wo es eigene hat, sonst die des Großraums. Hat nur eines eine Klimaspanne, gilt sie; haben beide eine, gilt die
 * Schnittmenge (von = die wärmere der beiden Untergrenzen, bis = die kältere der beiden Obergrenzen), und eine leere Schnittmenge fällt auf die Spanne des Großraums zurück. Die Wörter nennen beide Herkünfte.
 */
function mischeGrossraum(glied: Pillen, grossraum: Pillen): Pillen {
    let klima = glied.klima ?? grossraum.klima;
    if (glied.klima !== null && grossraum.klima !== null) {
        const von = Math.max(zoneIndex(glied.klima.von), zoneIndex(grossraum.klima.von));
        const bis = Math.min(zoneIndex(glied.klima.bis), zoneIndex(grossraum.klima.bis));
        klima =
            von <= bis
                ? { von: WIKISYNC_KLIMAZONEN[von] as string, bis: WIKISYNC_KLIMAZONEN[bis] as string }
                : grossraum.klima;
    }
    return {
        arten: glied.arten.length > 0 ? glied.arten : grossraum.arten,
        klima,
        woerter: [...new Set([...glied.woerter, ...grossraum.woerter])],
    };
}

/** Die Landschaftsarten und die Klimaspanne aus den Wörtern eines Bausteinsatzes. */
function pillenDer(bs: readonly Baustein[]): Pillen {
    const pillen: string[] = [];
    const woerter: string[] = [];
    for (const b of bs) {
        if (b.art !== "typ" && b.art !== "klima") continue;
        for (const pille of b.pillen ?? []) if (!pillen.includes(pille)) pillen.push(pille);
        if (!woerter.includes(b.wert.toLowerCase())) woerter.push(b.wert.toLowerCase());
    }
    const gelesen = pillenGelesen(pillen);
    return { arten: gelesen.arten, klima: gelesen.klima, woerter };
}

const bed = (
    flaeche: BedFlaeche | null,
    p: Pillen,
    rueckfragen: readonly string[],
    verknuepfung: Bed["verknuepfung"] = "oder",
): Bed => ({
    verknuepfung,
    flaeche,
    arten: p.arten,
    klima: p.klima,
    woerter: p.woerter,
    rueckfragen: [...new Set(rueckfragen)],
});

/** Eine Bedingung zu einem Ziel; bei einem Großraum mit den zusammengeführten Pillen und der Rückfrage `grossraum`. */
const bedZiel = (
    ziel: Ziel,
    p: Pillen,
    rueckfragen: readonly string[],
    verknuepfung: Bed["verknuepfung"] = "oder",
): Bed =>
    ziel.pillen === null
        ? bed(ziel.flaeche, p, rueckfragen, verknuepfung)
        : bed(ziel.flaeche, mischeGrossraum(p, ziel.pillen), [...rueckfragen, "grossraum"], verknuepfung);

const ohnePillen = (): Pillen => ({ arten: [], klima: null, woerter: [] });

/** Der Schlüssel einer Bedingung für Dubletten und Fingerabdruck. */
export function bedSchluessel(b: Bed): string {
    const flaeche =
        b.flaeche === null
            ? ""
            : b.flaeche.kennung !== null
              ? b.flaeche.kennung
              : `wiki:${(b.flaeche.titel ?? b.flaeche.name).toLowerCase()}`;
    return [
        b.verknuepfung === "ohne" ? "ohne" : "mit",
        flaeche,
        b.arten
            .map((a) => `${a.ebene}/${a.art}`)
            .sort()
            .join(","),
        b.klima === null ? "" : `${b.klima.von}-${b.klima.bis}`,
        // Die Lage nur, wo es eine gibt: ohne sie bleibt der Schlüssel (und mit ihm die Kennung der Kette) wie vor der Lage.
        ...(b.lage === undefined ? [] : [lageDerBedingung(b.lage)]),
    ].join("|");
}

/** Die Lage in der Form des Fingerabdrucks (`lageSchluessel`): Richtung und die Kennungen der Orte; die Namen und die Stelle gehören nicht zur Identität. */
const lageDerBedingung = (lage: BedLage): string =>
    lageSchluessel({ richtung: lage.richtung, orte: lage.orte.map((ort) => ort.kennung) });

/** Der Fingerabdruck einer Regel (`lore_rule.rule_key`) aus ihrer Kette; offene Flächen gehen mit ihrem Wiki-Titel hinein. */
export function regelSchluessel(eintragWikiKey: string, beziehung: string, kette: readonly Bed[]): string {
    const terme: RuleTermKeyInput[] = kette.map((b) => ({
        joinOp: b.verknuepfung as RuleTermKeyInput["joinOp"],
        areaPublicId:
            b.flaeche === null
                ? null
                : b.flaeche.kennung !== null
                  ? b.flaeche.kennung
                  : `wiki:${(b.flaeche.titel ?? b.flaeche.name).toLowerCase()}`,
        climateFrom: b.klima?.von ?? null,
        climateTo: b.klima?.bis ?? null,
        types: b.arten.map((a) => ({ layer: a.ebene, type: a.art })),
        ...(b.lage === undefined
            ? {}
            : { lage: { richtung: b.lage.richtung, orte: b.lage.orte.map((ort) => ort.kennung) } }),
    }));
    return ruleKeyOf(eintragWikiKey, beziehung, terme);
}

/** Eine kurze, stabile Kennung einer Kette (für Vergleiche ohne Eintragsschlüssel). */
export const ketteKennung = (kette: readonly Bed[]): string =>
    createHash("sha256")
        .update(kette.map((b) => `${b.verknuepfung}:${bedSchluessel(b)}`).join("\n"), "utf8")
        .digest("hex")
        .slice(0, 16);

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Ein Glied zu Bedingungen und Teilen
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface GliedWerk {
    bedingungen: Bed[];
    teile: Teil[];
    /** Bei „zwischen A und B“: die zweiten Bedingungen der Paare (verknüpft mit UND an die davor); das Glied gehört dann geschlossen an den Anfang der Kette. */
    undFolge?: Bed[];
}

interface Rahmen {
    beziehung: VorkommenBeziehung;
    /** Die Landschaftsarten (und Klimaspanne) des Lebensraums, die in jede Bedingung des Ortsfelds kommen, wo das Glied keine eigene Art nennt. */
    lebensraum: Pillen | null;
    wissen: RegelWissen;
}

function teilAus(beziehung: VorkommenBeziehung, text: string, gruende: readonly string[]): Teil[] {
    const gesehen = new Set<WikisyncRegelGrund>();
    const aus: Teil[] = [];
    for (const wort of gruende) {
        const grund = grundVon(wort);
        if (gesehen.has(grund)) continue;
        gesehen.add(grund);
        aus.push({ beziehung, text, grund, art: "nicht_abbildbar" });
    }
    return aus;
}

const IST_FLAECHE = (b: Baustein): boolean => b.art === "flaeche" || b.art === "luecke_region_ohne_flaeche";

/**
 * Ein Glied, das eine Lage zu einer Linie sagt (`urteil.lage`, immer mit Rückfrage `lage`): eine Bedingung je Ziel, mit Lage. Die Fläche steht im Vorsatz („ganz Aventurien südlich von …“), sonst ist es die der
 * Ebene davor („[[Aventurien]]: südlich von …“); ohne beides gilt die Lage überall. Landschaftsarten und Klimaspanne aus Vorsatz und Schluss gelten für alle Bedingungen wie bei jedem Glied. „Zwischen A und B“:
 * je Ziel die erste Lage mit Fläche und Arten, dahinter die zweite allein, mit UND (`undFolge`).
 */
function baueLageGlied(gl: GliedEintrag, urteil: GliedErgebnis, rahmen: Rahmen): GliedWerk {
    const { wissen } = rahmen;
    const lage = urteil.lage as NonNullable<GliedErgebnis["lage"]>;
    const rueck: string[] = [];
    for (const [merkmal, grund] of RUECKFRAGE_QUALS) if (lage.quals.has(merkmal)) rueck.push(grund);
    const positiv = urteil.bs;
    if (positiv.some((b) => b.freitext === true)) rueck.push("flaeche_name_im_text");
    if (positiv.some((b) => b.kandidat === "wort_am_link")) rueck.push("wort_am_link");
    if (positiv.some((b) => b.kandidat === "klammerzusatz")) rueck.push("klammerzusatz");
    if (positiv.some((b) => b.grund.includes("ganz Dere"))) rueck.push("ganz_dere");
    const eigene = pillenDer(positiv);
    const p: Pillen = {
        arten: eigene.arten.length > 0 ? eigene.arten : (rahmen.lebensraum?.arten ?? []),
        klima: eigene.klima ?? (eigene.arten.length > 0 ? null : (rahmen.lebensraum?.klima ?? null)),
        woerter: eigene.arten.length > 0 || eigene.klima !== null ? eigene.woerter : (rahmen.lebensraum?.woerter ?? []),
    };
    if (eigene.klima !== null) rueck.push("klima");
    rueck.push("lage");
    let ziele = positiv.filter((b) => IST_FLAECHE(b) && b.bezug !== true).flatMap((b) => flaechenDes(b, wissen));
    if (ziele.length === 0) {
        // Ohne Fläche im Vorsatz: die Fläche der Ebene davor; ohne Ebene davor gilt die Lage überall.
        const rahmenFlaeche = gl.kontext[gl.kontext.length - 1];
        ziele = rahmenFlaeche === undefined ? [{ flaeche: null, pillen: null }] : zieleVon(rahmenFlaeche, wissen);
    }
    const [erste, zweite] = lage.lesung.lagen;
    const bedingungen: Bed[] = [];
    const undFolge: Bed[] = [];
    for (const ziel of ziele) {
        bedingungen.push({ ...bedZiel(ziel, p, rueck), lage: erste as BedLage });
        if (zweite !== undefined) {
            const folge: Bed = { ...bed(null, ohnePillen(), ["lage"], "und"), lage: zweite };
            bedingungen.push(folge);
            undFolge.push(folge);
        }
    }
    return { bedingungen, teile: [], ...(undFolge.length > 0 ? { undFolge } : {}) };
}

/** Die Bedingungen und Teile EINES Glieds aus seinem Urteil. */
function baueGlied(gl: GliedEintrag, urteil: GliedErgebnis, rahmen: Rahmen): GliedWerk {
    const { beziehung, wissen } = rahmen;
    const text = klartext(gl.glied.text);
    const res = urteil.res;
    if (res === "fremd" || res === "je_nach_art" || res === "leer") return { bedingungen: [], teile: [] };
    if (res === "platzhalter") {
        // „[[Aventurien]]: ?“ mit Lebensraum ergibt „Art innerhalb Aventurien“ als Rückfrage (Regelbuch 3a, Punkt 8).
        const rahmenFlaeche = gl.kontext[gl.kontext.length - 1];
        if (rahmenFlaeche === undefined || rahmen.lebensraum === null || rahmen.lebensraum.arten.length === 0)
            return { bedingungen: [], teile: [] };
        return {
            bedingungen: zieleVon(rahmenFlaeche, wissen).map((z) =>
                bedZiel(z, rahmen.lebensraum as Pillen, ["platzhalter_art"]),
            ),
            teile: [],
        };
    }
    if (urteil.lage !== undefined) return baueLageGlied(gl, urteil, rahmen);
    const teile = teilAus(beziehung, text, urteil.gruende);
    if (res === "hand") {
        if (
            teile.length === 0 &&
            gl.negiert === null &&
            urteil.bs.some((b) => !["fremd", "mikro", "zusatz"].includes(b.art))
        )
            teile.push({ beziehung, text, grund: "freitext", art: "nicht_abbildbar" });
        return { bedingungen: [], teile };
    }

    if (urteil.ausnahme === true) {
        // Die Liste einer Verneinung geht weiter: Diese Flächen sind ebenfalls ausgenommen.
        const aus = urteil.bs.filter((b) => IST_FLAECHE(b) && b.bezug !== true).flatMap((b) => flaechenDes(b, wissen));
        return {
            bedingungen: aus.map((z) => bedZiel(z, ohnePillen(), ["ohne", "nach_verneinung"], "ohne")),
            teile,
        };
    }
    // Rückfragen, die für alle Bedingungen des Glieds gelten.
    const rueck: string[] = [];
    for (const [merkmal, grund] of RUECKFRAGE_QUALS) if (gl.glied.quals.has(merkmal)) rueck.push(grund);
    if (urteil.nachVerneinung) rueck.push("nach_verneinung");
    const positiv = urteil.bs;
    const flaechenBs = positiv.filter((b) => IST_FLAECHE(b) && b.bezug !== true);
    if (flaechenBs.length > 1 && !koordiniert(gl.glied.aussen)) rueck.push("mehrere_links");
    if (positiv.some((b) => b.freitext === true)) rueck.push("flaeche_name_im_text");
    if (positiv.some((b) => b.kandidat === "wort_am_link")) rueck.push("wort_am_link");
    if (positiv.some((b) => b.kandidat === "klammerzusatz")) rueck.push("klammerzusatz");
    if (positiv.some((b) => b.grund.includes("ganz Dere"))) rueck.push("ganz_dere");
    if (gl.bausteine.length === 0 && gl.glied.quals.has("ganz")) rueck.push("ueberall");
    const eigene = pillenDer(positiv);
    const p: Pillen = {
        arten: eigene.arten.length > 0 ? eigene.arten : (rahmen.lebensraum?.arten ?? []),
        klima: eigene.klima ?? (eigene.arten.length > 0 ? null : (rahmen.lebensraum?.klima ?? null)),
        woerter: eigene.arten.length > 0 || eigene.klima !== null ? eigene.woerter : (rahmen.lebensraum?.woerter ?? []),
    };
    if (eigene.klima !== null) rueck.push("klima");
    const bedingungen: Bed[] = [];
    const flaechen = flaechenBs.flatMap((b) => flaechenDes(b, wissen));
    if (flaechen.length > 0) {
        for (const z of flaechen) bedingungen.push(bedZiel(z, p, rueck));
    } else if (eigene.arten.length > 0 || eigene.klima !== null) {
        // Art ohne Fläche im Glied: Fläche aus der Ebene davor, sonst gilt die Art überall.
        const rahmenFlaeche = gl.kontext[gl.kontext.length - 1];
        if (rahmenFlaeche !== undefined) {
            for (const z of zieleVon(rahmenFlaeche, wissen)) bedingungen.push(bedZiel(z, p, rueck));
        } else {
            bedingungen.push(bed(null, p, rueck));
        }
    } else if (gl.bausteine.length === 0 && gl.glied.quals.has("ganz")) {
        for (const z of zieleVon("Aventurien", wissen)) bedingungen.push(bedZiel(z, p, [...rueck, "ueberall"]));
    }
    // Die Verneinung: „bisher minus diese Bedingung“, direkt hinter den Bedingungen, aus deren Glied sie stammt (F1).
    if (urteil.negBs !== null) {
        const neg = urteil.negBs;
        const negFlaechen = neg.filter((b) => IST_FLAECHE(b) && b.bezug !== true);
        const negArten = neg.filter((b) => b.art === "typ");
        const alleFlaechen = negFlaechen.flatMap((b) => flaechenDes(b, wissen));
        if (alleFlaechen.length === 1 && negArten.length > 0) {
            bedingungen.push(bedZiel(alleFlaechen[0] as Ziel, pillenDer(negArten), ["ohne"], "ohne"));
        } else {
            for (const z of alleFlaechen) bedingungen.push(bedZiel(z, ohnePillen(), ["ohne"], "ohne"));
            for (const b of negArten) bedingungen.push(bed(null, pillenDer([b]), ["ohne"], "ohne"));
        }
        if (negFlaechen.length === 0 && negArten.length === 0) {
            const stelle = gl.negiert === null ? text : klartext(gl.negiert.nach);
            teile.push({ beziehung, text: stelle, grund: "verneinung", art: "nicht_abbildbar" });
        }
    }
    return { bedingungen, teile };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Ein Eintrag
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ZUSTAND_VON: Readonly<Record<string, OriginalZustand>> = {
    auto: "ok",
    rueckfrage: "offen",
    teil: "offen",
    hand: "fehler",
    fremd: "neutral",
    platzhalter: "neutral",
    je_nach_art: "neutral",
    leer: "neutral",
};

/** Der Wortlaut eines Felds mit dem Zustand jedes Glieds. */
function originalAus(
    feld: VorkommenBeziehung,
    zweige: readonly (readonly (readonly GliedAnalyse[])[])[],
    zustand: ReadonlyMap<GliedAnalyse, OriginalZustand>,
): OriginalFeld {
    const teile: OriginalFeld["teile"] = [];
    zweige.forEach((zweig, zi) => {
        zweig.forEach((ebene, ei) => {
            ebene.forEach((glied, gi) => {
                const text = klartext(glied.text);
                if (text === "") return;
                const letzteImZweig = ei === zweig.length - 1 && gi === ebene.length - 1;
                const letzteImFeld = zi === zweige.length - 1 && letzteImZweig;
                const trenner = letzteImFeld ? "" : letzteImZweig ? "; " : gi === ebene.length - 1 ? ": " : ", ";
                teile.push({ text, zustand: zustand.get(glied) ?? "neutral", trenner });
            });
        });
    });
    return { feld, teile };
}

/**
 * Leitet die Regeln eines Eintrags ab. `f` sind die Fähigkeiten der Regelsprache (`FAEHIGKEITEN`; die Messung gegen die Stufe K der Analyse rechnet auch mit weniger).
 */
export function leiteAb(
    eingabe: EintragEingabe,
    wissen: RegelWissen,
    f: ReadonlySet<string> = FAEHIGKEITEN,
): Ableitung {
    const relationen = relationenDerArt(eingabe.art);
    const woerter = new Map<string, { n: number; tafel: boolean }>();
    const zaehle = (wort: string, tafel: boolean): void => {
        const bisher = woerter.get(wort);
        woerter.set(wort, { n: (bisher?.n ?? 0) + 1, tafel: tafel || bisher?.tafel === true });
    };
    const zaehleGlied = (g: GliedAnalyse): void => {
        for (const t of g.typen) zaehle(t.tafel, true);
        for (const k of g.klima) zaehle(k.tafel, true);
        // Ein Großraum zählt als Zeile der Begriffstafel, auch wo die Umgebung ihn abgeschaltet hat, solange keine Fläche der Karte den Artikel trägt (dann ist er kein Großraum, sondern die Fläche).
        for (const link of g.links)
            if (wissen.tafel.istGrossraum(link.ziel) && wissen.flaechen(link.ziel).length === 0)
                zaehle(grossraumWort(link.ziel), true);
        // Ein freies Wort zählt als gefundener Begriff, wenn es nicht nur einschränkt oder rahmt („südlich“, „selten“, „Art“).
        for (const r of g.rest) if (r.length > 2 && !QUAL_WOERTER.test(r)) zaehle(r, false);
    };

    // 1. Lesen.
    const ortsfelder = new Map<string, GliedEintrag[]>();
    const zweigeJeFeld = new Map<VorkommenBeziehung, GliedAnalyse[][][]>();
    for (const beziehung of relationen) {
        const roh = (eingabe.felder[`roh_${beziehung}`] ?? "").trim();
        if (roh === "") continue;
        const gelesen = leseOrtsfeld(roh, wissen);
        ortsfelder.set(beziehung, gelesen.eintraege);
        zweigeJeFeld.set(beziehung, gelesen.zweige);
        for (const zweig of gelesen.zweige) for (const ebene of zweig) for (const g of ebene) zaehleGlied(g);
    }
    const hatLebensraum = eingabe.art === "fauna" || eingabe.art === "flora";
    const lebensraumRoh = hatLebensraum ? (eingabe.felder["roh_vorkommen"] ?? "").trim() : "";
    const lebensraum = lebensraumRoh === "" ? null : leseLebensraum(lebensraumRoh, wissen);
    if (lebensraum !== null)
        for (const zweig of lebensraum.zweige) for (const ebene of zweig) for (const g of ebene) zaehleGlied(g);

    // 2. Bewerten.
    const bewertung = bewerteEintrag(ortsfelder, lebensraum?.glieder ?? null, f, wissen);

    // 3. Die Arten des Lebensraums: in jede Bedingung des Ortsfelds.
    let lebensraumPillen: Pillen | null = null;
    if (lebensraum !== null) {
        const brauchbar = bewertung.lebensraum.je.filter((j) => j.res !== "hand").flatMap((j) => j.glied.bausteine);
        const p = pillenDer(brauchbar);
        lebensraumPillen = p.arten.length > 0 || p.klima !== null ? p : null;
    }
    const rahmen = (beziehung: VorkommenBeziehung): Rahmen => ({ beziehung, lebensraum: lebensraumPillen, wissen });

    // 4. Die Ketten je Beziehung. „Zwischen A und B“ (Lage, zwei Bedingungen mit UND) steht VOR allem anderen: Ein UND rechnet mit der ganzen Kette davor; nur als erste Gruppe trifft es, was gemeint ist
    // (`bewerteEintrag` lässt das Paar nicht zu, wo eine Verneinung im Weg stünde, und nur einmal je Beziehung).
    const zustand = new Map<GliedAnalyse, OriginalZustand>();
    const beziehungen: BeziehungsAbleitung[] = [];
    /** Die Bedingungen eines Paares („zwischen“) und darunter die, die mit UND an die davor hängen, je Beziehung. */
    const paare = new Map<VorkommenBeziehung, { alle: Set<Bed>; undFolge: Set<Bed> }>();
    for (const beziehung of relationen) {
        const liste = bewertung.felder.get(beziehung);
        if (liste === undefined) continue;
        const roheKette: Bed[] = [];
        const vorn: Bed[] = [];
        const paar = { alle: new Set<Bed>(), undFolge: new Set<Bed>() };
        const teile: Teil[] = [];
        for (const { eintrag, urteil } of liste) {
            zustand.set(eintrag.glied, ZUSTAND_VON[urteil.res] ?? "neutral");
            const werk = baueGlied(eintrag, urteil, rahmen(beziehung));
            if (werk.undFolge !== undefined) {
                vorn.push(...werk.bedingungen);
                for (const b of werk.bedingungen) paar.alle.add(b);
                for (const b of werk.undFolge) paar.undFolge.add(b);
            } else roheKette.push(...werk.bedingungen);
            teile.push(...werk.teile);
        }
        paare.set(beziehung, paar);
        beziehungen.push({ beziehung, bedingungen: [...vorn, ...roheKette], teile });
    }
    // Der Lebensraum: eine Fläche IM Lebensraumfeld („ganz Aventurien in Steppen“) ist eine Bedingung mit Rückfrage; ein Glied, das sich nicht abbilden lässt, ein Teil.
    if (lebensraum !== null && beziehungen.length > 0) {
        const ziel = beziehungen[0] as BeziehungsAbleitung;
        for (const j of bewertung.lebensraum.je) {
            zustand.set(j.glied.glied, ZUSTAND_VON[j.res] ?? "neutral");
            const text = klartext(j.glied.glied.text);
            if (j.res === "hand" || j.res === "teil") ziel.teile.push(...teilAus(ziel.beziehung, text, j.gruende));
            if (j.res === "hand") continue;
            const flaechenBs = j.glied.bausteine.filter((b) => IST_FLAECHE(b) && b.bezug !== true);
            const eigene = pillenDer(j.glied.bausteine);
            if (flaechenBs.length > 0 && (eigene.arten.length > 0 || eigene.klima !== null)) {
                for (const z of flaechenBs.flatMap((b) => flaechenDes(b, wissen)))
                    ziel.bedingungen.push(bedZiel(z, eigene, ["ort_im_lebensraum"]));
            }
        }
    } else if (lebensraum !== null) {
        for (const j of bewertung.lebensraum.je) zustand.set(j.glied.glied, ZUSTAND_VON[j.res] ?? "neutral");
    }

    // 5. Ordnen: Dubletten weg, die erste positive Bedingung `und`, jede weitere `oder`, `ohne` bleibt; eine Kette beginnt nie mit `ohne`; höchstens 25.
    for (const b of beziehungen) {
        const gesehen = new Set<string>();
        const kette: Bed[] = [];
        const paar = paare.get(b.beziehung);
        for (const bedingung of b.bedingungen) {
            // Die Bedingungen eines Paares fallen nie als Dublette weg: Die zweite Lage gehört zur ersten, auch wo dieselbe Lage in einem anderen Paar steht.
            const imPaar = paar?.alle.has(bedingung) === true;
            const schluessel = bedSchluessel(bedingung);
            if (bedingung.verknuepfung !== "ohne" && !imPaar) {
                if (gesehen.has(schluessel)) continue;
                gesehen.add(schluessel);
            }
            if (bedingung.verknuepfung === "ohne" && !kette.some((k) => k.verknuepfung !== "ohne")) {
                b.teile.push({
                    beziehung: b.beziehung,
                    text: bedingung.flaeche?.name ?? bedingung.woerter.join(", "),
                    grund: "verneinung",
                    art: "nicht_abbildbar",
                });
                continue;
            }
            kette.push({
                ...bedingung,
                verknuepfung:
                    bedingung.verknuepfung === "ohne"
                        ? "ohne"
                        : paar?.undFolge.has(bedingung) === true
                          ? "und"
                          : kette.some((k) => k.verknuepfung !== "ohne")
                            ? "oder"
                            : "und",
            });
        }
        if (kette.length > BEDINGUNGEN_MAX) {
            b.teile.push({
                beziehung: b.beziehung,
                text: String(kette.length - BEDINGUNGEN_MAX),
                grund: "zu_viele",
                art: "nicht_abbildbar",
            });
            kette.length = BEDINGUNGEN_MAX;
        }
        if (kette[0] !== undefined) kette[0] = { ...kette[0], verknuepfung: "und" };
        b.bedingungen = kette;
    }

    const original: OriginalFeld[] = [];
    for (const beziehung of relationen) {
        const zweige = zweigeJeFeld.get(beziehung);
        if (zweige !== undefined) original.push(originalAus(beziehung, zweige, zustand));
    }
    if (lebensraum !== null) original.push(originalAus("vorkommen", lebensraum.zweige, zustand));
    return { bewertung, beziehungen, original, woerter };
}
