import type { HinweisBlock, HinweiseDokument } from "@avesmaps3d/shared";

/**
 * Der Aufbau der Hinweise (`LEGAL_NOTICES.hinweise`), rein: welche Kennungen es gibt, zu welchem Abschnitt sie gehören und wie die Blöcke gegliedert stehen.
 */

/** Die Kennungen im Bauteil der Bedienung (`hinweise-bedienung.vue`): Dieser Abschnitt hat keine Blöcke. */
const KENNUNGEN_DER_BEDIENUNG = ["discord"] as const;

const ABSCHNITT_DER_BEDIENUNG = "bedienung";

export function istBedienung(abschnitt: { id: string }): boolean {
    return abschnitt.id === ABSCHNITT_DER_BEDIENUNG;
}

/** Die Kennungen eines Blocks, in ihrer Reihenfolge. */
export function kennungenVon(block: HinweisBlock): string[] {
    switch (block.art) {
        case "h3":
        case "h4":
        case "frage":
            return [block.id];
        case "fakten":
        case "tafel":
            return block.zeilen.map((zeile) => zeile.id);
        default:
            return [];
    }
}

/** Jede Kennung des Dokuments mit dem Abschnitt, der sie trägt; der Abschnitt selbst zählt mit. Eine doppelte Kennung gewinnt nicht still: Das prüft `alleKennungen`. */
export function abschnittJeKennung(dokument: HinweiseDokument): Map<string, string> {
    const karte = new Map<string, string>();
    for (const kennung of alleKennungen(dokument)) karte.set(kennung.kennung, kennung.abschnitt);
    return karte;
}

export function alleKennungen(dokument: HinweiseDokument): { kennung: string; abschnitt: string }[] {
    return dokument.abschnitte.flatMap((abschnitt) => [
        { kennung: abschnitt.id, abschnitt: abschnitt.id },
        ...(istBedienung(abschnitt) ? KENNUNGEN_DER_BEDIENUNG : abschnitt.bloecke.flatMap(kennungenVon)).map(
            (kennung) => ({ kennung, abschnitt: abschnitt.id }),
        ),
    ]);
}

type H4Block = Extract<HinweisBlock, { art: "h4" }>;

/** Ein Block im Lesefluss, oder eine Unterüberschrift mit dem, was zu ihr gehört. */
export type HinweisGlied =
    { art: "block"; block: HinweisBlock } | { art: "gruppe"; kopf: H4Block; rumpf: HinweisBlock[] };

/** Was unter einer Unterüberschrift steht, bis zur nächsten Überschrift, gehört zu ihr: Es steht enger beisammen als der Rest. */
export function gliedereBloecke(bloecke: readonly HinweisBlock[]): HinweisGlied[] {
    const glieder: HinweisGlied[] = [];
    let gruppe: Extract<HinweisGlied, { art: "gruppe" }> | undefined;
    for (const block of bloecke) {
        if (block.art === "h4") {
            gruppe = { art: "gruppe", kopf: block, rumpf: [] };
            glieder.push(gruppe);
        } else if (block.art === "h3" || gruppe === undefined) {
            gruppe = undefined;
            glieder.push({ art: "block", block });
        } else {
            gruppe.rumpf.push(block);
        }
    }
    return glieder;
}
