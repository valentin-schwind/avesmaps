import { TREFFEN } from "@avesmaps3d/shared";
import type { StoredRaster } from "../dem-tiles.ts";
import { distanceTransform } from "../hydrology/water.ts";
import type { DomainInputs } from "./inputs.ts";
import type { LakeBody } from "./lake-bodies.ts";

/**
 * Das Becken um jeden See (OPS-000086; Thomas: „Seen sollen automatisch eine mindestens ebene Fläche um sich herum erhalten, die ihrer eigenen Höhe
 * entspricht“; Vali 2026-11-06: „seen mit und ohne eigene höhe sollen ein etwas weiteres becken bekommen“). Nur in einer Fassung mit
 * `generator.lakes.randBreite` (Fassung 19), nach Wasser, Deckel und eigenen Höhen, vor den Gipfeln.
 *
 * - **Der Boden:** Bis `breite` vom Ufer liegt er auf dem Spiegel, dahinter fällt er mit der Neigung `TREFFEN.steil`, höchstens `TREFFEN.rMaxE` weit. Wer tiefer
 *   liegt, hebt sich auf ihn; wer höher liegt, bleibt, denn das ist die Wand des Beckens. „Mindestens eben“ heißt: Vom See aus fällt nichts ab, steigen darf es.
 * - **Für jeden See,** mit und ohne eigene Höhe: Der Spiegel steht jetzt fest, er wird aus dem Raster gelesen (`flattenDomainLakes`).
 * - **Nur Land:** Das Meer samt Ufer, die Seen und die Flusskorridore bleiben (`seeUferMask`). Die Ufer der Seen gehören dazu: Sie wären sonst ein Graben zwischen
 *   See und Rand.
 * - **Was Vorrang hat:** Punkte mit eigener Höhe (Kämme, Nebengipfel, Mulden) tragen ihre Höhe, Flüsse mit eigenen Höhen ihr Umland (`treffen.ts`). Um sie blendet
 *   der Boden aus, wie die Träger dort.
 */

export interface BeckenSchutz {
    readonly punkte: readonly { readonly x: number; readonly y: number }[];
    readonly stuecke: readonly {
        readonly a: { readonly x: number; readonly y: number };
        readonly b: { readonly x: number; readonly y: number };
    }[];
}

/** Was Vorrang vor dem Boden hat: die Ziele der Gebirge, ohne das Ufer der Seen selbst. */
export function beckenSchutz(input: Pick<DomainInputs, "rueckennetz">): BeckenSchutz {
    const punkte: { x: number; y: number }[] = [];
    const stuecke: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
    for (const gebirge of input.rueckennetz ?? []) {
        const ziele = gebirge.ziele;
        if (ziele === undefined) continue;
        for (const p of ziele.punkte) if (p.wasser === undefined) punkte.push(p);
        for (const [a, b] of ziele.strecken) {
            const pa = ziele.punkte[a]!;
            const pb = ziele.punkte[b]!;
            if (pa.wasser === "fluss" || pb.wasser === "fluss") stuecke.push({ a: pa, b: pb });
        }
    }
    return { punkte, stuecke };
}

const glatt = (t: number): number => {
    const u = Math.max(0, Math.min(1, t));
    return u * u * (3 - 2 * u);
};

const abstandZurStrecke = (
    x: number,
    y: number,
    a: { readonly x: number; readonly y: number },
    b: { readonly x: number; readonly y: number },
): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ll = dx * dx + dy * dy;
    const t = ll === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / ll));
    return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
};

/**
 * Hebt das Land um die Seen auf ihren Boden (siehe Kopf). `erlaubt`: `seeUferMask`, Gitterausrichtung (Zeile 0 im Norden), wie `LakeBody.cells`. Gibt zurück, wie
 * viele Zellen sich geändert haben.
 */
export function hebeSeeRaender(
    raster: StoredRaster,
    seen: readonly LakeBody[],
    erlaubt: Uint8Array,
    breite: number,
    schutz: BeckenSchutz,
): number {
    const n = raster.width;
    const { cell } = raster;
    const hang = TREFFEN.steil * 3000;
    const reichweite = breite + TREFFEN.rMaxE;
    const zellen = Math.ceil(reichweite / cell);
    const kern = 1.5 * cell;
    const zeileSued = (gy: number): number => n - 1 - gy;
    let gehoben = 0;
    for (const see of seen) {
        if (see.cells.length === 0) continue;
        let i0 = n;
        let i1 = -1;
        let j0 = raster.height;
        let j1 = -1;
        const spiegelWerte = new Uint16Array(see.cells.length);
        see.cells.forEach((k, nr) => {
            const x = k % n;
            const gy = Math.floor(k / n);
            i0 = Math.min(i0, x);
            i1 = Math.max(i1, x);
            j0 = Math.min(j0, gy);
            j1 = Math.max(j1, gy);
            spiegelWerte[nr] = raster.samples[zeileSued(gy) * n + x]!;
        });
        const spiegel = spiegelWerte.sort()[spiegelWerte.length >> 1]!;
        const fx0 = Math.max(0, i0 - zellen);
        const fx1 = Math.min(n - 1, i1 + zellen);
        const fy0 = Math.max(0, j0 - zellen);
        const fy1 = Math.min(raster.height - 1, j1 + zellen);
        const breit = fx1 - fx0 + 1;
        const hoch = fy1 - fy0 + 1;
        const imSee = new Uint8Array(breit * hoch);
        for (const k of see.cells) imSee[(Math.floor(k / n) - fy0) * breit + (k % n) - fx0] = 1;
        const abstand = new Float32Array(breit * hoch);
        distanceTransform({ width: breit, height: hoch, cell, x0: fx0, y0: fy0 }, (w) => imSee[w] === 1, abstand);
        // Nur, was in Reichweite dieses Sees liegen kann, je Zelle zu prüfen.
        const xMin = raster.originX + fx0 * cell - 3 * kern;
        const xMax = raster.originX + fx1 * cell + 3 * kern;
        const yMin = raster.originY + zeileSued(fy1) * cell - 3 * kern;
        const yMax = raster.originY + zeileSued(fy0) * cell + 3 * kern;
        const inFenster = (p: { readonly x: number; readonly y: number }): boolean =>
            p.x >= xMin && p.x <= xMax && p.y >= yMin && p.y <= yMax;
        const punkte = schutz.punkte.filter(inFenster);
        const stuecke = schutz.stuecke.filter(({ a, b }) => inFenster(a) || inFenster(b));
        for (let gy = fy0; gy <= fy1; gy += 1)
            for (let x = fx0; x <= fx1; x += 1) {
                const d = abstand[(gy - fy0) * breit + (x - fx0)]! * cell;
                if (d === 0 || d > reichweite || erlaubt[gy * n + x] !== 1) continue;
                const k = zeileSued(gy) * n + x;
                const boden = spiegel - Math.max(0, d - breite) * hang;
                const hier = raster.samples[k]!;
                if (hier >= boden) continue;
                const wx = raster.originX + x * cell;
                const wy = raster.originY + zeileSued(gy) * cell;
                let w = 1;
                for (const p of punkte) w = Math.min(w, glatt((Math.hypot(wx - p.x, wy - p.y) - kern) / (2 * kern)));
                for (const { a, b } of stuecke)
                    w = Math.min(w, glatt((abstandZurStrecke(wx, wy, a, b) - 3 * kern) / (2 * kern)));
                if (w <= 0) continue;
                const neu = Math.min(65535, Math.round(hier + w * (boden - hier)));
                if (neu === hier) continue;
                raster.samples[k] = neu;
                gehoben += 1;
            }
    }
    return gehoben;
}
