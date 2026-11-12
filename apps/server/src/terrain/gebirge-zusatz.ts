import {
    GEBIRGS_MODELL_SPALTE,
    GEBIRGS_MODELL_WERTE,
    linieMitHoehen,
    type EditorGebirge,
    type LinienRang,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Eine gelesene Linie: die Höhe je Stützpunkt (0219), sonst für den Übergang die Höhe je Linie (0216) an allen Punkten, sonst keine. Ohne
 * eigene Höhe genau `{ punkte, rang }` wie vor 0216, damit der Fingerabdruck der Saat gleich bleibt.
 */
function linieGelesen<R extends LinienRang>(
    punkte: [number, number][],
    rang: R,
    zeile: { hoehen: (number | null)[] | null; h: number | null },
) {
    // Nur endliche Zahlen sind eigene Höhen; alles andere ist die Vorgabe (eine NaN zählte sonst als eigene Höhe und vergiftete die Saat).
    const hoehen = zeile.hoehen?.map((h) => (typeof h === "number" && Number.isFinite(h) ? h : null));
    return linieMitHoehen(punkte, rang, hoehen ?? (zeile.h === null ? null : punkte.map(() => zeile.h)));
}

/**
 * Netz und Werte des Rückennetzes je Gebirgsfläche lesen (WI-0245): für den Reiter „Gebirge“ (`gebirge-editor.ts`), die Landschaften
 * und den Lader des Geländes (`inputs.ts`, WI-0247). Eigene Datei ohne Fastify: Der Lader läuft auch in Werkzeugen ohne Server.
 */

/** Was am Gebirge über die Werte der V12 hinaus gespeichert ist (WI-0245); ohne aktive Zeile in `terrain_control` die Revision 0. */
export type GebirgsZusatz = Pick<EditorGebirge["stand"], "modell" | "netz" | "revision">;

/** Netz, Rückennetz-Werte und Revision je Teilfläche (`region_area.id`), für Detail und Reiter, EINE Abfrage je Tafel. */
export async function leseGebirgsZusatz(
    database: Queryable,
    flaechen: readonly string[],
): Promise<Map<string, GebirgsZusatz>> {
    const zusatz = new Map<string, GebirgsZusatz>(
        flaechen.map((id) => [id, { modell: {}, netz: { kaemme: [], nebengipfel: [] }, revision: 0 }]),
    );
    if (flaechen.length === 0) return zusatz;
    const werte = await database<
        {
            area_id: string;
            grat: number | null;
            grat_breite: number | null;
            talboden: number | null;
            erosionsfestigkeit: number | null;
            revision: string;
        }[]
    >`
        SELECT area_id::text, grat, grat_breite, talboden, erosionsfestigkeit, revision::text
          FROM terrain_control WHERE area_id = ANY(${flaechen}::bigint[]) AND is_active
    `;
    for (const zeile of werte) {
        const eintrag = zusatz.get(zeile.area_id)!;
        eintrag.revision = Number(zeile.revision);
        for (const wert of GEBIRGS_MODELL_WERTE) {
            const zahl = zeile[GEBIRGS_MODELL_SPALTE[wert]];
            if (zahl !== null) eintrag.modell[wert] = Number(zahl);
        }
    }
    // Höhe je Stützpunkt (WI-0249 P9, 0219); fehlt sie, gilt für den Übergang die Höhe je Linie (0216) an allen Punkten.
    // 🪤 Als JSON gelesen: Der Treiber macht aus einem NULL-Element eines `integer[]` NaN statt null (gemessen am Wegwerf-Cluster).
    const kaemme = await database<
        {
            area_id: string;
            rang: "haupt" | "neben";
            punkte: [number, number][];
            hoehen: (number | null)[] | null;
            h: number | null;
        }[]
    >`
        SELECT area_id::text, rang, to_json(heights_schritt) AS hoehen, height_schritt AS h,
               (ST_AsGeoJSON(geom, 15)::json -> 'coordinates') AS punkte
          FROM terrain_ridge_edge WHERE area_id = ANY(${flaechen}::bigint[]) ORDER BY area_id, ordinal
    `;
    for (const kamm of kaemme) zusatz.get(kamm.area_id)!.netz.kaemme.push(linieGelesen(kamm.punkte, kamm.rang, kamm));
    const taeler = await database<
        { area_id: string; punkte: [number, number][]; hoehen: (number | null)[] | null; h: number | null }[]
    >`
        SELECT area_id::text, to_json(heights_schritt) AS hoehen, height_schritt AS h,
               (ST_AsGeoJSON(geom, 15)::json -> 'coordinates') AS punkte
          FROM terrain_valley_edge WHERE area_id = ANY(${flaechen}::bigint[]) ORDER BY area_id, ordinal
    `;
    for (const tal of taeler) zusatz.get(tal.area_id)!.netz.kaemme.push(linieGelesen(tal.punkte, "tal", tal));
    const punkte = await database<{ area_id: string; x: number; y: number; h: number | null }[]>`
        SELECT area_id::text, ST_X(geom) AS x, ST_Y(geom) AS y, height_schritt AS h
          FROM terrain_ridge_point WHERE area_id = ANY(${flaechen}::bigint[]) ORDER BY area_id, ordinal
    `;
    for (const punkt of punkte)
        zusatz.get(punkt.area_id)!.netz.nebengipfel.push({ x: punkt.x, y: punkt.y, h: punkt.h });
    const mulden = await database<{ area_id: string; x: number; y: number; h: number | null }[]>`
        SELECT area_id::text, ST_X(geom) AS x, ST_Y(geom) AS y, height_schritt AS h
          FROM terrain_hollow_point WHERE area_id = ANY(${flaechen}::bigint[]) ORDER BY area_id, ordinal
    `;
    for (const mulde of mulden) {
        const ziel = (zusatz.get(mulde.area_id)!.netz.mulden ??= []);
        ziel.push({ x: mulde.x, y: mulde.y, h: mulde.h });
    }
    // Eigene Höhen an Flüssen und Seen (WI-0249, 0230): nur wenn es welche gibt (sonst bleibt das Netz Zeichen für Zeichen, wie es war).
    const wasser = await database<{ area_id: string; art: "fluss" | "see"; x: number; y: number; h: number }[]>`
        SELECT area_id::text, art, ST_X(geom) AS x, ST_Y(geom) AS y, height_schritt AS h
          FROM terrain_water_height WHERE area_id = ANY(${flaechen}::bigint[]) ORDER BY area_id, art, ordinal
    `;
    for (const punkt of wasser) {
        const netz = zusatz.get(punkt.area_id)!.netz;
        const ziel = punkt.art === "fluss" ? (netz.flussHoehen ??= []) : (netz.seeHoehen ??= []);
        ziel.push({ x: punkt.x, y: punkt.y, h: punkt.h });
    }
    return zusatz;
}
