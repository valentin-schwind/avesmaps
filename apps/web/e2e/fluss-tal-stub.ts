import { expect, type Page } from "@playwright/test";
import type { EditorGebirge, EditorGebirgeProfile } from "@avesmaps3d/shared";
import { probegebirge, type GebirgeStub } from "./gebirge-stub.ts";

/**
 * Ein Fluss als Tal im Kammeditor (WI-0259, OPS-071): das Probegebirge (440 … 466 × 502 … 538) mit einem Probefluss, der es von links nach
 * rechts quert, einen See durchläuft und beidseits die Fläche verlässt, samt Höhenprofil (Gefälle von 900 auf 300 Schritt). Alles aus Stubs;
 * nichts davon liegt in einer Datenbank.
 *
 * Punkte des Flusswegs (k): 0 und 7 liegen außerhalb der Fläche, 4 im See (455 … 461 × 507 … 512), die übrigen in der Fläche.
 */
export const FLUSS_P: [number, number][] = [
    [438, 512],
    [444, 511],
    [449, 510],
    [453, 509.5],
    [458, 509.5],
    [463, 510],
    [465, 512],
    [470, 514],
];
/** Der Platz des Sees: die Mitte seiner Eckpunkte. */
export const SEE_PLATZ = { x: 458, y: 509.5 };

const SEE = {
    n: "Probesee",
    g: {
        type: "Polygon" as const,
        coordinates: [
            [
                [455, 507],
                [461, 507],
                [461, 512],
                [455, 512],
                [455, 507],
            ] as [number, number][],
        ],
    },
};

/** Die Höhen des Probeflusses im Entwurf: von Punkt 1 bis 6 gleichmäßig fallend (2000 auf 600), also nirgends steigend. */
export const FLUSS_HOEHEN = [
    { x: 444, y: 511, h: 2000 },
    { x: 449, y: 510, h: 1800 },
    { x: 453, y: 509.5, h: 1600 },
    { x: 463, y: 510, h: 1000 },
    { x: 465, y: 512, h: 600 },
];

const KAMM = {
    punkte: [
        [445, 524],
        [450, 526],
        [460, 528],
    ] as [number, number][],
    rang: "haupt" as const,
};

/** Das Höhenprofil des Probeflusses: alle halbe E eine Probe, linear von 900 auf 300 Schritt. */
function profil(): EditorGebirgeProfile {
    const lauf = [0];
    for (let i = 1; i < FLUSS_P.length; i++)
        lauf.push(lauf[i - 1]! + Math.hypot(FLUSS_P[i]![0] - FLUSS_P[i - 1]![0], FLUSS_P[i]![1] - FLUSS_P[i - 1]![1]));
    const gesamt = lauf.at(-1)!;
    const at: number[] = [];
    for (let s = 0; s < gesamt; s += 0.5) at.push(Math.round(s * 1000) / 1000);
    at.push(gesamt);
    return {
        verfuegbar: true,
        fluesse: [{ at, h: at.map((s) => Math.round(900 - (600 * s) / gesamt)) }],
        paesse: [],
        objekte: { fluesse: [null], seen: [null], paesse: [] },
    };
}

/** Das Gebirge mit dem Probefluss; `hoehen` sind die eigenen Höhen des Flusses im Bestand (Vorgabe: die fallenden, `FLUSS_HOEHEN`). */
export function flussTalStub(
    hoehen: readonly { x: number; y: number; h: number }[] = FLUSS_HOEHEN,
    seeHoehen: readonly { x: number; y: number; h: number }[] = [],
): GebirgeStub {
    return probegebirge(
        {
            kaemme: [KAMM],
            nebengipfel: [],
            ...(hoehen.length > 0 ? { flussHoehen: hoehen.map((h) => ({ ...h })) } : {}),
            ...(seeHoehen.length > 0 ? { seeHoehen: seeHoehen.map((h) => ({ ...h })) } : {}),
        } as EditorGebirge["stand"]["netz"],
        { fluesse: [{ n: "Probefluss", bach: false, dir: "forward", p: FLUSS_P }], seen: [SEE] },
        profil(),
    );
}

/** Die Zeichen der Flüsse auf der Karte (Quelle der Ebenen `editor-gebirgsnetz-fluss-*`). */
export const flussZeichen = (page: Page): Promise<Record<string, unknown>[]> =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap! as unknown as {
            getSource(
                id: string,
            ): { serialize?(): { data?: { features?: { properties: Record<string, unknown> }[] } } } | undefined;
        };
        return (map.getSource("editor-gebirgsnetz-fluss")?.serialize?.().data?.features ?? []).map((f) => f.properties);
    });

/** Wie viele Zeichen einer Art die Karte zeigt (`punkt`, `warn`, `ende`, `see`). */
export const zahlZeichen = async (page: Page, art: string): Promise<number> =>
    (await flussZeichen(page)).filter((p) => p["art"] === art).length;

export async function erwarteZeichen(page: Page, art: string, zahl: number): Promise<void> {
    await expect.poll(() => zahlZeichen(page, art), { message: `Zeichen „${art}“ auf der Karte` }).toBe(zahl);
}
