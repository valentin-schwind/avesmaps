import { huellbox, punktInFlaeche, type Flaeche, type Huellbox, type Punkt } from "./geometrie.ts";

/**
 * Der Kontext eines Elements (WI-0280 K2), Portierung aus Legacys `svgxBuildContextIndex` und `svgxContextFor`.
 *
 * 🔴 DAS EIGENTLICHE ZIEL DER SEMANTIK (Owner 16.08.2026). Ein Waldpolygon allein sagt nur „Wald“. Was daraus im Bild wird,
 * entscheidet die ÜBERLAGERUNG: Wald × tropisch ist Dschungel und Palmen, Wald × boreal ist Nadelwald, Gebirge × polar ist
 * schneebedeckt. Also trägt jedes Element neben seinem Typ auch, in welcher Klimazone und über welchem Relief es liegt.
 *
 * 🔴 NUR FAKTEN, keine Deutung. Gerechnet wird in KARTENkoordinaten (y nach Norden), nicht in SVG-Koordinaten; wer hier spiegelte,
 * bekäme die Klimazonen von Nord nach Süd vertauscht.
 *
 * ⚠️ Die Hüllbox ist ein VORfilter, kein Treffer: Danach entscheidet der Punkttest (am Seepunkt lagen in Legacy 9 Gebiete in der
 * Box und 0 bestanden den Test).
 */

/** Die Landschaftsarten, die als Relief gelten. */
export const RELIEFARTEN = ["gebirge", "huegelland", "hochebene", "tiefebene", "tal", "schlucht", "wadi"] as const;

export interface KontextFlaeche {
    readonly typ: string;
    readonly ebene: string;
    readonly flaeche: Flaeche;
}

export interface KontextGipfel {
    readonly x: number;
    readonly y: number;
    readonly hoehe: number;
}

export interface KontextEintrag {
    readonly typ: string;
    readonly flaeche: Flaeche;
    readonly box: Huellbox;
    /** Die höchste Gipfelhöhe in diesem Relief, `null` ohne benannten Gipfel mit Höhe. */
    hoehe: number | null;
}

export interface KontextIndex {
    readonly klima: readonly KontextEintrag[];
    readonly relief: readonly KontextEintrag[];
}

function eintraege(flaechen: readonly KontextFlaeche[], passt: (flaeche: KontextFlaeche) => boolean): KontextEintrag[] {
    const gefunden: KontextEintrag[] = [];
    for (const flaeche of flaechen) {
        if (!passt(flaeche)) continue;
        const box = huellbox(flaeche.flaeche);
        if (!box) continue;
        gefunden.push({ typ: flaeche.typ, flaeche: flaeche.flaeche, box, hoehe: null });
    }
    return gefunden;
}

/**
 * Klimabänder und Reliefflächen mit Hüllbox als Vorfilter.
 *
 * 🔴 Die Gipfel. Das Höhenfeld der Karte wird im Browser aus benannten Gipfeln plus Rauschen gerechnet und hat keinen Endpunkt; also
 * wird hier nicht das Feld nachgebaut, sondern seine Quelle benutzt: die Gipfel selbst. Jede Reliefläche bekommt die höchste
 * Gipfelhöhe in ihr, ein Wald darin erbt sie. Die erste Reliefläche, die den Gipfel enthält, gewinnt, und das EINMAL, nicht je
 * Element. ⚠️ Eine fehlende Höhe ist eine Lücke in den Kartendaten und bleibt eine (nicht auf 0 setzen).
 */
export function baueKontextIndex(flaechen: readonly KontextFlaeche[], gipfel: readonly KontextGipfel[]): KontextIndex {
    const relief = eintraege(flaechen, (f) => (RELIEFARTEN as readonly string[]).includes(f.typ));
    for (const spitze of gipfel) {
        for (const eintrag of relief) {
            const { box } = eintrag;
            if (spitze.x < box.minX || spitze.x > box.maxX || spitze.y < box.minY || spitze.y > box.maxY) continue;
            if (!punktInFlaeche(spitze.x, spitze.y, eintrag.flaeche)) continue;
            if (eintrag.hoehe === null || eintrag.hoehe < spitze.hoehe) eintrag.hoehe = spitze.hoehe;
            break;
        }
    }
    return { klima: eintraege(flaechen, (f) => f.ebene === "klima"), relief };
}

function suche(liste: readonly KontextEintrag[], punkt: Punkt): KontextEintrag | null {
    const [x, y] = punkt;
    for (const eintrag of liste) {
        const { box } = eintrag;
        if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) continue;
        if (punktInFlaeche(x, y, eintrag.flaeche)) return eintrag;
    }
    return null;
}

export interface Kontext {
    /** Klimazone am Ort, leer wenn keine zutrifft (eine leere Angabe ist ehrlicher als eine geratene). */
    readonly klima: string;
    readonly relief: KontextEintrag | null;
}

export function kontextAm(index: KontextIndex | null, punkt: Punkt | null): Kontext {
    if (!index || !punkt) return { klima: "", relief: null };
    return { klima: suche(index.klima, punkt)?.typ ?? "", relief: suche(index.relief, punkt) };
}
