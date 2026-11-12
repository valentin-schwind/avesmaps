/**
 * Die Kachelrevisionen beim Start der Karte (WI-0283 H3): Für jede berührte Art das jüngste Ereignis `map.changed`. Damit tragen die
 * Kacheln von Anfang an dieselbe Adresse wie bei jedem anderen Besucher und bei jeder Karte, die das Ereignis über `/ws` gehört hat, und
 * Nginx darf sie zehn Minuten im Browser lassen und für alle zwischenspeichern (K1).
 *
 * Was die Arten für die Quellen der Karte heißen, weiß nur die Karte (`QUELLEN_NACH_ART` in `app.vue`), wie beim Ereignis selbst.
 */
export const TILE_REVISIONS_URL = "/api/map/tile-revisions";

export interface TileRevisions {
    readonly schemaVersion: 1;
    /** Das jüngste Ereignis, das keine Art nennt (ein Auftrag): Es betrifft alle Quellen. 0, wenn keines mehr aufbewahrt ist. */
    readonly ohneArt: number;
    /** Je Art (`affected[].kind`) das jüngste Ereignis, das sie berührt. */
    readonly arten: Readonly<Record<string, number>>;
}

/** Tolerant wie die übrigen Zeiger (WI-0075 R5b): Ein neues Feld wird ignoriert, was die Karte kennt, wird geprüft. */
export function readTileRevisions(body: unknown): TileRevisions | undefined {
    if (typeof body !== "object" || body === null) return undefined;
    const { schemaVersion, ohneArt, arten } = body as Record<string, unknown>;
    if (schemaVersion !== 1 || !Number.isSafeInteger(ohneArt) || (ohneArt as number) < 0) return undefined;
    if (typeof arten !== "object" || arten === null || Array.isArray(arten)) return undefined;
    const gelesen: Record<string, number> = {};
    for (const [art, seq] of Object.entries(arten)) {
        if (!Number.isSafeInteger(seq) || (seq as number) <= 0) return undefined;
        gelesen[art] = seq as number;
    }
    return { schemaVersion: 1, ohneArt: ohneArt as number, arten: gelesen };
}
