import { describe, expect, it, vi } from "vitest";
import { derographieAndockung, zieleImKasten } from "../src/landschaftseditor/neue-flaeche-derographie.ts";

/**
 * Die Andockung der Derographie an „Neue Fläche“ (WI-0178 T47, C3): Ansicht der Ebene, Ziele derselben Ebene, `landscape.create`, danach
 * das Fenster. Ohne Karte und ohne Server.
 */
describe("„Neue Fläche“ der Derographie (T47, C3)", () => {
    const antwort = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

    it("🔴 je Ebene: Ansicht Derographie in dieser Ebene, Titel der Ebene, der Untergrund-Regler im Zusatz", () => {
        const regler = { name: "UntergrundRegler" };
        const andockung = derographieAndockung("vegetation", { zusatz: regler, geoeffnet: vi.fn() });
        expect(andockung).toMatchObject({
            id: "vegetation",
            ansicht: { view: "landscapes", layer: "vegetation" },
            titel: "layer.vegetation",
        });
        expect(andockung.art.teilart).toBe("ring");
        expect(andockung.zusatz).toBe(regler);
        expect(andockung.darf()).toBeUndefined();
    });

    it("🔴 Ziele: fragt den Kasten in der eigenen Ebene; Ecken und Kanten, Flusspunkte als Ecken, doppelte Ecken einmal", async () => {
        const fetcher = vi.fn(async () =>
            antwort(200, {
                margin: 0,
                neighbors: [],
                edges: [
                    { areaId: "a1", name: "Forst", a: [1, 1], b: [2, 1] },
                    { areaId: "a1", name: "Forst", a: [2, 1], b: [2, 2] },
                ],
                riverPoints: [{ pathId: "w1", name: "Fluss", x: 5, y: 5 }],
            }),
        );
        const andockung = derographieAndockung("topographie", {
            fetcher: fetcher as unknown as typeof fetch,
            geoeffnet: vi.fn(),
        });
        const ziele = await andockung.ziele({ x0: 0, y0: 0, x1: 10, y1: 10 }, undefined, new AbortController().signal);
        const url = new URL(String((fetcher.mock.calls[0] as unknown[])[0]), "http://x");
        expect(url.pathname).toBe("/api/editor/landscapes/targets");
        expect(Object.fromEntries(url.searchParams)).toEqual({
            layer: "topographie",
            x0: "0",
            y0: "0",
            x1: "10",
            y1: "10",
        });
        expect(ziele?.filter((z) => z.art === "ecke").map((z) => [z.at.x, z.at.y])).toEqual([
            [1, 1],
            [2, 1],
            [2, 2],
            [5, 5],
        ]);
        expect(ziele?.filter((z) => z.art === "kante")).toHaveLength(2);
        expect(zieleImKasten({ margin: 0, neighbors: [], edges: [], riverPoints: [] })).toEqual([]);
    });

    it("🔴 Schreiben: EINE Operation `landscape.create` mit der Ebene und dem Ring eckig; danach das Fenster", async () => {
        const gesendet: unknown[] = [];
        const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
            gesendet.push(JSON.parse(String(init?.body)));
            return antwort(200, {
                operationId: "op",
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [],
                warnings: [],
                mapRevision: 77,
                publicId: "neu-1",
                name: "Fläche-008",
            });
        });
        const geoeffnet = vi.fn();
        const andockung = derographieAndockung("derographisch", {
            fetcher: fetcher as unknown as typeof fetch,
            geoeffnet,
        });
        const ergebnis = await andockung.schreibe(
            [
                { x: 1, y: 1 },
                { x: 3, y: 1 },
                { x: 2, y: 3 },
            ],
            "op",
        );
        expect(gesendet).toEqual([
            {
                operationId: "op",
                layer: "derographisch",
                ring: [
                    [1, 1],
                    [3, 1],
                    [2, 3],
                ],
            },
        ]);
        expect(ergebnis).toEqual({ ok: true, publicId: "neu-1", name: "Fläche-008", mapRevision: 77 });
        andockung.geoeffnet({ publicId: "neu-1", name: "Fläche-008" });
        expect(geoeffnet).toHaveBeenCalledWith({ publicId: "neu-1", name: "Fläche-008" });
    });

    it("abgelehnt mit dem Satz des Servers, ein Serverfehler mit seinem Status; ohne Antwort Status 0", async () => {
        const fall = async (fetcher: () => Promise<Response>) =>
            derographieAndockung("vegetation", {
                fetcher: fetcher as unknown as typeof fetch,
                geoeffnet: vi.fn(),
            }).schreibe([{ x: 1, y: 1 }], "op");
        expect(
            await fall(async () =>
                antwort(400, {
                    error: { code: "validation_failed", message: "Aus dem Umriss entsteht keine Fläche." },
                }),
            ),
        ).toEqual({ ok: false, satz: "Aus dem Umriss entsteht keine Fläche." });
        expect(await fall(async () => antwort(503, { error: { code: "map_import_running", message: "…" } }))).toEqual({
            ok: false,
            status: 503,
        });
        expect(
            await fall(async () => {
                throw new TypeError("offline");
            }),
        ).toEqual({ ok: false, status: 0 });
    });
});
