import {
    SPRACHE_NEUE_FARBE,
    SPRACHE_FARBE_MUSTER,
    SPRACHE_LEGENDE_MAX,
    SPRACHE_NAME_MAX,
    SPRACHE_WIKI_MAX,
    type SpracheEditorDetail,
} from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/i18n";

/**
 * Die Felder einer Sprache im Entwurf und was man mit ihnen tut (WI-0261 S5d2; Bauvorlage `fenster-sprachen.js`: Name, Wiki-Artikel als
 * Pillen, Farbe mit „Farben der Legende“). Reine Rechnung, ohne Vue und ohne Server, damit Vitest sie prüft.
 *
 * - **Farbe:** `#rrggbb` wie der Vertrag (`SPRACHE_FARBE_MUSTER`); gespeichert wird sie klein. Vorschläge sind die elf Farben der
 *   Legende der Referenzkarte (Farbtafel im Work Item, T-2), dazu das Violett der Vorlage für eine neue Sprache. „↺ Startwert“ ist die
 *   Legendenfarbe des eigenen Schlüssels; eine Sprache der Redaktion hat keinen.
 * - **Pillen:** die Kennungen der Wiki-Artikel in ihrer Folge (`wiki_sprache_artikel.public_id`). Dazu, weg, an eine andere Stelle; nie
 *   doppelt, höchstens `SPRACHE_WIKI_MAX`.
 */

export interface SpracheFelder {
    readonly name: string;
    /** Der Name der Legende; leer heißt: die Legende zeigt den Namen. */
    readonly legende: string;
    readonly farbe: string;
    /** Die Wiki-Artikel (Pillen) in ihrer Folge. */
    readonly wiki: readonly string[];
}

export function felderAus(d: Pick<SpracheEditorDetail, "name" | "legende" | "farbe" | "wiki">): SpracheFelder {
    return { name: d.name, legende: d.legende ?? "", farbe: d.farbe, wiki: d.wiki.map((pille) => pille.id) };
}

const FARBE = new RegExp(SPRACHE_FARBE_MUSTER, "u");

/** Ist der Text eine Farbe, wie der Server sie nimmt (`#rrggbb`)? */
export const farbeGueltig = (text: string): boolean => FARBE.test(text.trim());

/** Eine Farbe, wie sie gespeichert wird: ohne Rand, klein. Ohne `#` vorn wird es ergänzt („ffb901“ tippt sich schneller). */
export function farbeNormal(text: string): string {
    const roh = text.trim().toLowerCase();
    return /^[0-9a-f]{6}$/u.test(roh) ? `#${roh}` : roh;
}

/** Die Legendenfarben der Referenzkarte je Schlüssel (Farbtafel WI-0261, T-2: die Vorgabe der Farbe ist die Legendenfarbe). */
export const LEGENDENFARBEN: Readonly<Record<string, string>> = {
    thorwalsch: "#1baad4",
    nujuka: "#268170",
    isdira: "#789f2a",
    orkisch: "#604c34",
    goblinisch: "#c2771c",
    rogolan: "#7f7774",
    garethi: "#ffb901",
    tulamidya: "#da5a13",
    ferkina: "#a03813",
    rssahh: "#c40304",
    tahaya: "#78373d",
};

/**
 * Die Farbe einer neuen Sprache (Vorlage `farbeDekorieren`: das Violett, das keine Sprache der Legende trägt); im Vertrag, weil auch der Server sie nimmt
 * („Kopieren …“ in eine neue Sprache ohne Farbe, WI-0261 Stufe 3).
 */
export const NEUE_FARBE = SPRACHE_NEUE_FARBE;

/** Die Vorschläge der Farbwahl („Farben der Legende“), in der Folge der Vorlage, das Violett zuletzt. */
export const FARB_VORSCHLAEGE: readonly string[] = [
    LEGENDENFARBEN["garethi"]!,
    LEGENDENFARBEN["tulamidya"]!,
    LEGENDENFARBEN["thorwalsch"]!,
    LEGENDENFARBEN["nujuka"]!,
    LEGENDENFARBEN["isdira"]!,
    LEGENDENFARBEN["orkisch"]!,
    LEGENDENFARBEN["goblinisch"]!,
    LEGENDENFARBEN["rogolan"]!,
    LEGENDENFARBEN["ferkina"]!,
    LEGENDENFARBEN["rssahh"]!,
    LEGENDENFARBEN["tahaya"]!,
    NEUE_FARBE,
];

/** „↺ Startwert“: die Legendenfarbe des Schlüssels; `undefined` für eine Sprache, die nicht aus der Referenzkarte stammt. */
export const startfarbe = (schluessel: string): string | undefined => LEGENDENFARBEN[schluessel];

// --- Pillen ---

/** Der Artikel im Wiki Aventurica (die Pillen verweisen dorthin, Vorlage `wikiPillen`). */
export const wikiArtikelUrl = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replace(/ /gu, "_"))}`;

/** Einen Artikel ans Ende hängen; schon da oder voll: unverändert. */
export function pilleDazu(liste: readonly string[], id: string): readonly string[] {
    if (liste.includes(id) || liste.length >= SPRACHE_WIKI_MAX) return liste;
    return [...liste, id];
}

export const pilleWeg = (liste: readonly string[], id: string): readonly string[] =>
    liste.includes(id) ? liste.filter((x) => x !== id) : liste;

/** Eine Pille an eine andere Stelle (Ziehen, ↑ ↓): `nach` ist die Stelle in der Liste ohne sie; außerhalb wird geklemmt. */
export function pilleNach(liste: readonly string[], id: string, nach: number): readonly string[] {
    const von = liste.indexOf(id);
    if (von < 0) return liste;
    const ohne = liste.filter((x) => x !== id);
    const stelle = Math.max(0, Math.min(ohne.length, Math.round(nach)));
    if (stelle === von) return liste;
    return [...ohne.slice(0, stelle), id, ...ohne.slice(stelle)];
}

/** ↑ oder ↓: eine Stelle nach vorn oder hinten. */
export const pilleSchieben = (liste: readonly string[], id: string, richtung: -1 | 1): readonly string[] =>
    pilleNach(liste, id, liste.indexOf(id) + richtung);

export const gleicheFolge = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((x, i) => x === b[i]);

// --- Prüfen ---

/** Warum „Fertig“ diese Felder nicht schreibt; `undefined`: sie gehen. */
export function felderGrund(felder: SpracheFelder): MessageKey | undefined {
    const name = felder.name.trim();
    if (name === "") return "spracheditor.grund.name";
    if (name.length > SPRACHE_NAME_MAX) return "spracheditor.grund.nameLang";
    if (felder.legende.trim().length > SPRACHE_LEGENDE_MAX) return "spracheditor.grund.legendeLang";
    if (!farbeGueltig(felder.farbe)) return "spracheditor.grund.farbe";
    if (felder.wiki.length > SPRACHE_WIKI_MAX) return "spracheditor.grund.wiki";
    return undefined;
}

/** Was sich zwischen zwei Ständen der Felder unterscheidet, als Namen der Felder (wie das Protokoll sie führt). */
export function unterschiede(a: SpracheFelder, b: SpracheFelder): string[] {
    const raus: string[] = [];
    if (a.name.trim() !== b.name.trim()) raus.push("name");
    if (a.legende.trim() !== b.legende.trim()) raus.push("legende");
    if (farbeNormal(a.farbe) !== farbeNormal(b.farbe)) raus.push("farbe");
    if (!gleicheFolge(a.wiki, b.wiki)) raus.push("wiki");
    return raus;
}
