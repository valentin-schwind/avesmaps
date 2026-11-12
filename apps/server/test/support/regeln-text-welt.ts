import type { InhalteVorkommenArt, InhalteVorkommenBedingung } from "@avesmaps3d/shared";
import { eintragsSchluessel, schluesselAusVertrag } from "../../src/inhalte/regeln-text/schluessel.ts";
import {
    baueWelt,
    type Welt,
    type WeltDaten,
    type WeltEintrag,
    type WeltFlaeche,
    type WeltOrt,
    type WeltQuelle,
    type WeltRegel,
} from "../../src/inhalte/regeln-text/welt.ts";

/**
 * Eine kleine, erfundene Welt für die reinen Tests von „Regeln als Text“ (WI-0254 §13): Flächen mit gleichen Namen und Wiki-Titeln, Orte mit Akzenten, Einträge in zwei Kategorien, Quellen mit doppeltem Titel, vorhandene
 * Regeln (auch eine mit stillgelegter Fläche) und ein Eintrag, der auf einen Artikel wartet. Kennungen sind echte UUID-Formen, deren erste acht Zeichen sich unterscheiden (`[[#xxxxxxxx|Name]]`).
 */

/** Eine Kennung mit unterscheidbarem Anfang: `a0000001-0000-4000-8000-000000000000`. */
export const kennung = (n: number, kopf = "a"): string =>
    `${kopf}${n.toString(16).padStart(7, "0")}-0000-4000-8000-000000000000`;
/** Die ersten acht Zeichen, wie sie im Text stehen. */
export const anfang = (id: string): string => id.slice(0, 8);

const flaeche = (n: number, name: string, ebene: string, art: string, wikiTitel = "", aktiv = true): WeltFlaeche => ({
    id: kennung(n, "b"),
    name,
    ebene,
    art,
    aktiv,
    wikiTitel,
});
const ort = (n: number, name: string, art: string, x: number, y: number): WeltOrt => ({
    id: kennung(n, "c"),
    name,
    art,
    x,
    y,
});
const eintrag = (
    n: number,
    name: string,
    kind: InhalteVorkommenArt,
    titel = "",
    wikiKey: string | null = null,
): WeltEintrag => ({
    id: kennung(n, "d"),
    name,
    kind,
    titel,
    wikiKey: wikiKey ?? name.toLowerCase().replaceAll(" ", "-"),
});
const quelle = (n: number, titel: string, typ = "buch"): WeltQuelle => ({ id: kennung(n, "e"), titel, typ });

export const F = {
    aventurien: flaeche(1, "Aventurien", "derographisch", "region", "Aventurien"),
    meridiana: flaeche(2, "Meridiana", "derographisch", "region", "Meridiana"),
    orkland: flaeche(3, "Orkland", "derographisch", "region", "Orkland"),
    aelderwald: flaeche(4, "Aelderwald", "vegetation", "wald", "Aelderwald (Wald)"),
    khomWueste: flaeche(5, "Khôm", "vegetation", "wueste", "Khôm"),
    khomTiefebene: flaeche(6, "Khôm", "topographie", "tiefebene", "Khôm"),
    khomRegion: flaeche(7, "Khôm", "derographisch", "region", "Khôm"),
    aeltikanEbene: flaeche(8, "Aeltikan", "topographie", "tiefebene", "Aeltikan"),
    aeltikanInseln: flaeche(9, "Aeltikan", "derographisch", "inselgruppe", "Aeltikan"),
    meerNord: flaeche(10, "Meer", "topographie", "meer", "Perlenmeer"),
    meerSued: flaeche(11, "Meer", "topographie", "meer", "Südmeer"),
    see: flaeche(12, "See", "topographie", "see"),
    perlen1: flaeche(13, "Archipel der Perlen", "derographisch", "inselgruppe"),
    perlen2: flaeche(14, "Archipel der Perlen", "derographisch", "inselgruppe"),
    reichsforst: flaeche(15, "Reichsforst", "vegetation", "wald"),
    amboss: flaeche(16, "Amboss, Ost-Massiv", "topographie", "gebirge"),
    griff: flaeche(17, "Wald-925", "vegetation", "wald"),
    /** Stillgelegt: nur über die Kennung und nur, wo eine vorhandene Regel des Eintrags sie nennt. */
    altoum: {
        id: kennung(18, "b"),
        name: "Altoum",
        ebene: "",
        art: "",
        aktiv: false,
        wikiTitel: "",
        nurKennung: true,
    } satisfies WeltFlaeche,
} as const;

export const O = {
    gareth: ort(1, "Gareth", "metropole", 300, 300),
    havena: ort(2, "Havena", "grossstadt", 150, 300),
    perricum: ort(3, "Perricum", "stadt", 250, 100),
    calladun: ort(4, "Calladun", "dorf", 10, 10),
    calladunHut: ort(5, "Calladûn", "dorf", 20, 20),
    hotAlem: ort(6, "Hôt-Alem", "stadt", 400, 50),
    alAnfa: ort(7, "Al'Anfa", "grossstadt", 200, 20),
} as const;

export const E = {
    alprute: eintrag(1, "Alprute", "flora"),
    kajubo: eintrag(2, "Kajubo", "flora"),
    alantAlt: eintrag(3, "Alant", "flora", "Alant", "alant"),
    alantNeu: eintrag(4, "Alant", "flora", "Inoffiziell:Alant", "inoffiziell-alant"),
    aalFauna: eintrag(5, "Aal", "fauna", "Aal (Tier)"),
    aalFlora: eintrag(6, "Aal", "flora", "Aal (Pflanze)"),
    einbeere: eintrag(7, "Vierblättrige Einbeere", "flora"),
    bremse: eintrag(8, "Bremse", "fauna"),
    /** Ein Eintrag der Redaktion ohne Wiki-Artikel: seine Identität ist die Kennung. */
    moos: {
        id: kennung(9, "d"),
        name: "Redaktionsmoos",
        kind: "flora",
        titel: "",
        wikiKey: null,
    } satisfies WeltEintrag,
} as const;

export const Q = {
    geographia: quelle(1, "Geographia Aventurica"),
    zoo: quelle(2, "Zoo-Botanica Aventurica"),
    briefspiel1: quelle(3, "Albernisches Briefspiel", "briefspiel"),
    briefspiel2: quelle(4, "Albernisches Briefspiel", "briefspiel"),
};

/** Eine vorhandene Regel mit dem Fingerabdruck, den der Schreiber ihr gäbe. */
export function regel(
    e: WeltEintrag,
    relation: string,
    bedingungen: InhalteVorkommenBedingung[],
    ruleKey?: string,
): WeltRegel {
    return {
        relation,
        ruleKey: ruleKey ?? schluesselAusVertrag(eintragsSchluessel(e), relation, bedingungen),
        bedingungen,
    };
}

const fl = (f: WeltFlaeche): { kennung: string; name?: string } => ({ kennung: f.id, name: f.name });

/** Die Regeln, die es in der Testwelt schon gibt. */
export function vorhandeneRegeln(): Map<string, WeltRegel[]> {
    const regeln = new Map<string, WeltRegel[]>();
    // Einbeere: Wald, Klima boreal bis gemäßigt; und die Meridiana-Linie.
    regeln.set(E.einbeere.id, [
        regel(E.einbeere, "verbreitung", [
            {
                joinOp: "und",
                arten: [{ ebene: "vegetation", art: "wald" }],
                klima: { von: "boreal", bis: "gemaessigt" },
            },
        ]),
        regel(E.einbeere, "verbreitung", [{ joinOp: "und", flaeche: fl(F.meridiana), arten: [] }]),
    ]);
    // Kajubo: eine Regel mit der stillgelegten Fläche Altoum (lesbar nur über die Kennung) und, mit „oder“, dem Orkland.
    regeln.set(E.kajubo.id, [
        regel(E.kajubo, "verbreitung", [
            { joinOp: "und", flaeche: fl(F.altoum), arten: [] },
            { joinOp: "oder", flaeche: fl(F.orkland), arten: [] },
        ]),
    ]);
    // Alprute: wartet auf den Artikel „Kaiserwald“ (noch keine Fläche).
    regeln.set(E.alprute.id, [
        regel(E.alprute, "herkunft", [
            { joinOp: "und", wartetAuf: "Kaiserwald", arten: [{ ebene: "vegetation", art: "wald" }] },
        ]),
    ]);
    // Bremse: eine Regel aus Legacy, deren gespeicherter Fingerabdruck ein anderer ist (z. B. aus der alten Kennung); die aus der Kette gerechnete gilt trotzdem.
    regeln.set(E.bremse.id, [
        regel(E.bremse, "vorkommen", [{ joinOp: "und", flaeche: fl(F.aventurien), arten: [] }], "f".repeat(64)),
    ]);
    return regeln;
}

export interface TestWeltOptionen {
    /** Quellen, die ein Eintrag schon nennt (Eintrag → Quellen). */
    eintragsQuellen?: ReadonlyMap<string, ReadonlySet<string>>;
    /** Die Titel, auf die ein Eintrag wartet (Eintrag → `titelNorm` → Titel); Vorgabe: Alprute wartet auf „Kaiserwald“. */
    wartend?: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/** Die Testwelt. */
export function testWelt(optionen: TestWeltOptionen = {}): Welt {
    const flaechen: WeltFlaeche[] = Object.values(F);
    const daten: WeltDaten = {
        flaechen,
        orte: Object.values(O),
        eintraege: Object.values(E),
        quellen: Object.values(Q),
        regeln: vorhandeneRegeln(),
        eintragsQuellen: optionen.eintragsQuellen ?? new Map([[E.kajubo.id, new Set([Q.geographia.id])]]),
        wartendeTitel: optionen.wartend ?? new Map([[E.alprute.id, new Map([["kaiserwald", "Kaiserwald"]])]]),
        titelMitFlaeche: new Set(flaechen.filter((f) => f.wikiTitel !== "").map((f) => f.wikiTitel.toLowerCase())),
    };
    return baueWelt(daten);
}
