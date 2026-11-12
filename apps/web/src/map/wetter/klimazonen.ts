import { AVENTURIA_TRAVEL_MODEL, wetterKlimazonen } from "@avesmaps3d/shared";
import { leseMvtEbene } from "./wetter-mvt";

/**
 * Die Klimazonen als Raster (WI-0288 Stufe 5): eine Zelle je Karteneinheit (1024²), Wert 1 bis n in der Folge von `wetterKlimazonen`, 0
 * ohne Zone. Die Engine liest daraus die Schneefallgrenze der Wegfindung je Ort, der Wetter-Editor die in der Kartenmitte.
 *
 * - Nur lesend aus der Kachel der Klimabänder, dieselbe Adresse wie `climateUrl` in `app.vue` (Zoom 0 trägt die Bänder auf eine
 *   Viertel-Einheit genau). Eine Zelle gehört der Zone, die mehr als die Hälfte von ihr deckt.
 * - Einmal je Seite: Engine und Editor teilen sich die Anfrage.
 */

export const KLIMA_KACHEL = "/tiles/vector/climate_band_render/0/0/0?rev=1";
export const KLIMA_RASTER = 1024;

let laufend: Promise<Uint8Array> | undefined;

/** Malt die Bänder einer Kachel in das Raster, Zone für Zone. */
async function male(holen: typeof fetch): Promise<Uint8Array> {
    const antwort = await holen(KLIMA_KACHEL);
    if (!antwort.ok) throw new Error(`Klimakachel fehlt: ${antwort.status}`);
    const ebene = leseMvtEbene(new Uint8Array(await antwort.arrayBuffer()), "climate_band_render");
    const n = KLIMA_RASTER;
    const raster = new Uint8Array(n * n);
    if (!ebene) return raster;
    const leinwand = new OffscreenCanvas(n, n);
    const g = leinwand.getContext("2d", { willReadFrequently: true })!;
    wetterKlimazonen(AVENTURIA_TRAVEL_MODEL).forEach((zone, k) => {
        const baender = ebene.objekte.filter((objekt) => objekt.eigenschaften["type_key"] === zone);
        if (baender.length === 0) return;
        g.clearRect(0, 0, n, n);
        g.fillStyle = "#fff";
        g.beginPath();
        for (const band of baender)
            for (const ring of band.ringe) {
                ring.forEach((q, i) => {
                    const x = (q.x / ebene.extent) * n;
                    const y = (q.y / ebene.extent) * n;
                    if (i === 0) g.moveTo(x, y);
                    else g.lineTo(x, y);
                });
                g.closePath();
            }
        g.fill("evenodd");
        const d = g.getImageData(0, 0, n, n).data;
        for (let i = 0; i < n * n; i++) if (d[i * 4 + 3]! > 127) raster[i] = k + 1;
    });
    return raster;
}

/** Das Raster der Seite; ein Fehler gilt nur für diesen Versuch, der nächste fragt neu. */
export function klimaraster(holen: typeof fetch = (...a) => globalThis.fetch(...a)): Promise<Uint8Array> {
    laufend ??= male(holen).catch((fehler: unknown) => {
        laufend = undefined;
        throw fehler;
    });
    return laufend;
}

/** Der Wert der Zelle unter einem Ort (Karteneinheiten, z von Norden); 0 ohne Raster oder Zone. */
export function klimawertBei(raster: Uint8Array | undefined, x: number, z: number): number {
    if (!raster) return 0;
    const n = KLIMA_RASTER;
    const i = Math.min(n - 1, Math.max(0, Math.floor(x)));
    const j = Math.min(n - 1, Math.max(0, Math.floor(z)));
    return raster[j * n + i] ?? 0;
}

/** Die Klimazone unter einem Ort (`type_key`), oder `null`. */
export function klimazoneBei(raster: Uint8Array | undefined, x: number, z: number): string | null {
    const wert = klimawertBei(raster, x, z);
    return wert > 0 ? (wetterKlimazonen(AVENTURIA_TRAVEL_MODEL)[wert - 1] ?? null) : null;
}
