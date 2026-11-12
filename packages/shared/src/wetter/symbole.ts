import { WETTER_SYMBOL_GRENZEN, istWetterSymbolArt, type WetterSymbolArt } from "./arten.ts";

/**
 * Die Icons des Wetters (WI-0288 Stufe 2): Wind, Wirbel und Meeresströmung. Sie treiben Luft und Wasser an und gelten das ganze Jahr
 * (Betreiber 2026-11-07: „Icons je Preset oder ganzjährig? ganzjährig“).
 *
 * - **Ausgeblendet wirkt weiter** (Betreiber 2026-11-07: „ja, es ist nur unsichtbar“): `sichtbar` steuert nur die Karte.
 * - **Die Prototyp-Icons sind Beispielinhalt** (Map Mutation Guard): Eine leere Tafel zeigt `WETTER_SYMBOL_VORGABEN`; erst die erste Änderung
 *   eines Editors schreibt sie, samt ihrer festen Kennungen, und danach gilt allein die Tafel. Entfernen ist weich (`entfernt_at`), damit
 *   „alle entfernt“ nicht wieder als „leer, also Vorgaben“ gelesen wird.
 * - **Richtung in Grad nach der Windrose**: 0 ° ist Norden, 90 ° Osten, wie im Feld der Probierseite. Die Engine rechnet im Bogenmaß mit 0 =
 *   Osten und +z nach Süden (`wetterBogenAusGrad`). Wirbel haben keine Richtung, sondern einen Drehsinn (−1 gegen den Uhrzeigersinn).

 * - Die Arten und die Grenzen der Felder stehen in `arten.ts`: Das Startpaket des Browsers braucht sie, die Vorgaben und Prüfungen hier nicht.
 */

export interface WetterSymbolDaten {
    /** Die öffentliche Kennung (UUID). */
    readonly id: string;
    readonly art: WetterSymbolArt;
    /** Optional; `null` heißt ohne Namen. */
    readonly name: string | null;
    /** Den Namen auf der Karte beschriften. */
    readonly nameZeigen: boolean;
    /** Auf der Karte zeigen; ausgeblendet wirkt das Icon weiter. */
    readonly sichtbar: boolean;
    /** Lage in Karteneinheiten (0 bis 1024; 1 Einheit sind 3 km). */
    readonly x: number;
    readonly z: number;
    /** Reichweite in Karteneinheiten. */
    readonly reichweite: number;
    /** Stärke; bei Wirbeln mal der Sturmstärke der Jahreszeit (`stuerme`). */
    readonly staerke: number;
    /** Grad nach der Windrose, 0 ≤ Richtung < 360; nur Wind und Strömung, bei Wirbeln `null`. */
    readonly richtung: number | null;
    /** Nur Wirbel: 1 im Uhrzeigersinn, −1 dagegen; sonst `null`. */
    readonly drehsinn: 1 | -1 | null;
    /**
     * Der Titel des Wiki-Artikels, auf den das Icon verweist (Stufe 6); fehlt oder `null` ohne Verweis. Mit Verweis öffnet ein Klick eines Besuchers das Infopanel des
     * Icons (Subject `wetterSymbol`); die Engine liest das Feld nicht.
     */
    readonly wikiTitel?: string | null;
}

export type WetterSymbolZahl = "x" | "z" | "reichweite" | "staerke";

export function wetterSymbolZahlImRahmen(feld: WetterSymbolZahl, wert: unknown): wert is number {
    const g = WETTER_SYMBOL_GRENZEN[feld];
    return typeof wert === "number" && Number.isFinite(wert) && wert >= g.min && wert <= g.max;
}

export function wetterRichtungImRahmen(wert: unknown): wert is number {
    return typeof wert === "number" && Number.isFinite(wert) && wert >= 0 && wert < 360;
}

/** Der Name, wie er gespeichert wird: Ränder gekürzt, leer heißt ohne Namen; `undefined`, wenn er zu lang ist. */
export function wetterSymbolName(eingabe: string | null): string | null | undefined {
    if (eingabe === null) return null;
    const name = eingabe.trim();
    if (name === "") return null;
    return [...name].length <= WETTER_SYMBOL_GRENZEN.name.max ? name : undefined;
}

/** Grad nach der Windrose aus dem Bogenmaß der Engine (0 = Osten, +z nach Süden), auf [0, 360). */
export function wetterGradAusBogen(bogen: number): number {
    const grad = ((((bogen * 180) / Math.PI + 90) % 360) + 360) % 360;
    return grad === 360 ? 0 : grad;
}

/** Das Bogenmaß der Engine aus Grad nach der Windrose. */
export const wetterBogenAusGrad = (grad: number): number => ((grad - 90) * Math.PI) / 180;

/** Ein Wind oder eine Strömung des Prototyps: die Richtung im Bogenmaß, wie sie dort stand. */
const zug = (
    id: string,
    art: "wind" | "stroemung",
    name: string,
    x: number,
    z: number,
    bogen: number,
    staerke: number,
    reichweite: number,
): WetterSymbolDaten => ({
    id,
    art,
    name,
    nameZeigen: false,
    sichtbar: true,
    x,
    z,
    reichweite,
    staerke,
    richtung: wetterGradAusBogen(bogen),
    drehsinn: null,
});

const wirbel = (
    id: string,
    name: string,
    x: number,
    z: number,
    staerke: number,
    reichweite: number,
): WetterSymbolDaten => ({
    id,
    art: "wirbel",
    name,
    nameZeigen: false,
    sichtbar: true,
    x,
    z,
    reichweite,
    staerke,
    richtung: null,
    drehsinn: -1,
});

/**
 * Die Vorbelegung: die Icons des Prototyps (`wetter-symbole.ts` bis WI-0288 Stufe 1), Setzungen, keine Regelwerksangaben. Die Kennungen
 * sind fest, damit ein Editor ein Icon schon ändern kann, bevor es gespeichert ist; die erste Änderung legt alle mit genau diesen an.
 */
export const WETTER_SYMBOL_VORGABEN: readonly WetterSymbolDaten[] = Object.freeze([
    zug("02880000-0000-4000-8000-000000000001", "wind", "Westwinddrift", 341, 617, -0.153, 12.04, 150),
    zug("02880000-0000-4000-8000-000000000002", "wind", "Passat", 605, 798, 2.842, 9, 125),
    zug("02880000-0000-4000-8000-000000000003", "wind", "Polarwind", 430, 40, 0.6, 8, 120),
    wirbel("02880000-0000-4000-8000-000000000004", "Sturmtief im Meer der Sieben Winde", 282, 188, 4, 180),
    wirbel("02880000-0000-4000-8000-000000000005", "Wirbelsturm im Perlenmeer", 907, 659, 7.5, 135),
    wirbel("02880000-0000-4000-8000-000000000006", "Tief im Südmeer", 293, 825, 19, 170),
    wirbel("02880000-0000-4000-8000-000000000007", "Wirbel", 707, 886, 14, 130),
    wirbel("02880000-0000-4000-8000-000000000008", "Wirbel", 139, 357, 9, 195),
    zug(
        "02880000-0000-4000-8000-000000000009",
        "stroemung",
        "Strömung im Meer der Sieben Winde",
        60,
        430,
        1.571,
        6,
        130,
    ),
    zug("02880000-0000-4000-8000-00000000000a", "stroemung", "Strömung im Südwesten", 98, 740, 0.76, 12.45, 204),
    zug("02880000-0000-4000-8000-00000000000b", "stroemung", "Strömung im Südmeer", 480, 980, 0, 6, 130),
    zug("02880000-0000-4000-8000-00000000000c", "stroemung", "Strömung im Perlenmeer", 985, 760, -1.571, 6, 130),
    zug("02880000-0000-4000-8000-00000000000d", "stroemung", "Strömung im Golf von Riva", 460, 215, 2.6, 5, 90),
]);

/**
 * Ist das Icon in sich stimmig? Art bekannt, Zahlen in ihren Grenzen, Richtung nur bei Wind und Strömung, Drehsinn nur bei Wirbeln, Name
 * höchstens 120 Zeichen. Die Datenbank sichert dasselbe noch einmal (Migration 0326); hier steht es für Server und Browser.
 */
export function wetterSymbolStimmig(symbol: Omit<WetterSymbolDaten, "id">): boolean {
    if (!istWetterSymbolArt(symbol.art)) return false;
    for (const feld of ["x", "z", "reichweite", "staerke"] as const) {
        if (!wetterSymbolZahlImRahmen(feld, symbol[feld])) return false;
    }
    if (typeof symbol.nameZeigen !== "boolean" || typeof symbol.sichtbar !== "boolean") return false;
    if (symbol.name !== null && (typeof symbol.name !== "string" || wetterSymbolName(symbol.name) !== symbol.name))
        return false;
    if (symbol.art === "wirbel" || symbol.art === "mahlstrom")
        return symbol.richtung === null && (symbol.drehsinn === 1 || symbol.drehsinn === -1);
    return symbol.drehsinn === null && wetterRichtungImRahmen(symbol.richtung);
}
