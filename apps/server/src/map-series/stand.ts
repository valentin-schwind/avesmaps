import {
    AVENTURIA_SERIES,
    istKartenserieKennung,
    wirksamerKatalog,
    type KartenserieZeile,
    type MapSeriesCatalog,
    type MapSeriesTextsEn,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { isMissingTable } from "../system/state-row.ts";

/**
 * Die Kartenserien auf dem Server (WI-0220, Migration 0167): die Zeilen der Tafel `map_series` lesen und mit der Vorgabe aus der
 * JSON zum wirksamen Katalog zusammenrechnen (`wirksamerKatalog` im geteilten Paket, keine zweite Regel hier). Ohne Fastify, damit
 * Werkzeuge und Jobs es laden können.
 *
 * - **Fehlerrichtung:** Fehlt die Tafel (vor 0167) oder die Datenbank, gilt die Vorgabe (`unprovisioned`); die Karte startet wie
 *   bisher. Ein Fehler der Datenbank wird nie verschluckt.
 * - Eine Zeile mit einer Kennung, die das Muster nicht erfüllt, wird übergangen und gemeldet (`unknownKeys`).
 */

export interface Kartenserienstand {
    source: "database" | "unprovisioned";
    revision: number | null;
    zeilen: KartenserieZeile[];
    unknownKeys: string[];
}

interface Roh {
    series_id: string;
    label: string | null;
    description: string | null;
    visibility: "PUBLIC" | "EDITOR_ONLY" | null;
    labels_in_image: boolean | null;
    sort_order: number | null;
    thumb_x: number | null;
    thumb_y: number | null;
    author: string | null;
    origin: string | null;
    derivation: string | null;
    permission_statement: string | null;
    attribution: string | null;
    texts_en: Record<string, unknown> | null;
    source_pixels: number | null;
    max_native_zoom: number | null;
    is_default: boolean;
    status: "aktiv" | "papierkorb";
}

const EN_FELDER = ["origin", "derivation", "permission", "attribution"] as const;

function enAus(roh: Record<string, unknown> | null): Partial<MapSeriesTextsEn> | null {
    if (roh === null) return null;
    const en: Partial<MapSeriesTextsEn> = {};
    for (const feld of EN_FELDER) if (typeof roh[feld] === "string") en[feld] = roh[feld];
    return en;
}

export function zeileAus(roh: Roh): KartenserieZeile {
    return {
        id: roh.series_id,
        label: roh.label,
        description: roh.description,
        visibility: roh.visibility,
        labelsInImage: roh.labels_in_image,
        sortOrder: roh.sort_order,
        thumb: roh.thumb_x === null || roh.thumb_y === null ? null : { x: roh.thumb_x, y: roh.thumb_y },
        author: roh.author,
        origin: roh.origin,
        derivation: roh.derivation,
        permissionStatement: roh.permission_statement,
        attribution: roh.attribution,
        en: enAus(roh.texts_en),
        sourcePixels: roh.source_pixels,
        maxNativeZoom: roh.max_native_zoom,
        isDefault: roh.is_default,
        status: roh.status,
    };
}

const OHNE_TAFEL: Kartenserienstand = { source: "unprovisioned", revision: null, zeilen: [], unknownKeys: [] };

/** Liest die Zeilen und ihre Revision. Ohne Datenbank (Entwicklungsstart ohne `DATABASE_URL`) gilt die Vorgabe. */
export async function leseKartenserien(db: Queryable | undefined): Promise<Kartenserienstand> {
    if (db === undefined) return OHNE_TAFEL;
    let rows: Roh[];
    let revision: number | null;
    try {
        const [state] = await db<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM map_series_state WHERE id = 1`;
        revision = state?.revision ?? null;
        rows = await db<Roh[]>`
            SELECT series_id, label, description, visibility, labels_in_image, sort_order, thumb_x, thumb_y, author, origin,
                   derivation, permission_statement, attribution, texts_en, source_pixels, max_native_zoom, is_default, status
              FROM map_series
             ORDER BY series_id
        `;
    } catch (error) {
        if (isMissingTable(error)) return OHNE_TAFEL;
        throw error;
    }
    const zeilen: KartenserieZeile[] = [];
    const unknownKeys: string[] = [];
    for (const roh of rows) {
        if (istKartenserieKennung(roh.series_id)) zeilen.push(zeileAus(roh));
        else unknownKeys.push(roh.series_id);
    }
    return { source: "database", revision, zeilen, unknownKeys };
}

/** Der wirksame Katalog zu einem Stand: die Vorgabe der JSON, überschrieben von den Zeilen. */
export function kartenserienKatalog(stand: Kartenserienstand): MapSeriesCatalog {
    return wirksamerKatalog(AVENTURIA_SERIES, stand.zeilen);
}
