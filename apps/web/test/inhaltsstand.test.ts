import { afterEach, describe, expect, it, vi } from "vitest";
import { sectionFetchUrl } from "../src/info-panel/panel-section-load";
import { loadTerrainPointer } from "../src/map/terrain/terrain-pointer";
import { DEFAULT_OPTIONS } from "../src/route-planner/planner-model";
import { fetchRoute } from "../src/route-planner/route-client";
import { createInhaltsstand } from "../src/system/inhaltsstand";
import { geradePausiert, pausiertSatz } from "../src/system/inhaltsstand-text";

/**
 * Der Stand der Inhaltsschalter im Browser (WI-0127 SYS-10): gelesen beim ersten Blick, mit ETag nachgefragt, bei Störung der letzte Stand;
 * dazu die Sätze für Besucher. Die Wirkung im Panel prüft `e2e/inhalte-besucher.spec.ts`, die Antworten des Servers
 * `apps/server/test/inhaltsschalter-wirkung.test.ts`.
 */

function antwort(status: number, body?: unknown, etag?: string): Response {
    return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: etag === undefined ? {} : { etag },
    });
}

describe("Inhaltsstand im Browser", () => {
    it("🔴 liest beim ersten Blick genau einmal, fragt danach mit ETag, und 304 lässt den Stand stehen", async () => {
        const anfragen: (string | undefined)[] = [];
        const antworten = [
            antwort(200, { revision: 4, off: ["panel.literature", "media.role.coat"] }, '"c4-database"'),
            antwort(304),
            antwort(500),
        ];
        let takt: (() => void) | undefined;
        const quelle = createInhaltsstand(
            (_url, init) => {
                anfragen.push((init?.headers as Record<string, string> | undefined)?.["if-none-match"]);
                return Promise.resolve(antworten.shift() ?? antwort(500));
            },
            (lies) => {
                takt = lies;
            },
        );
        const ruhe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));
        expect(quelle.ausgeblendet("panel.literature")).toBe(false);
        expect(quelle.aus().size).toBe(0);
        await ruhe();
        expect(anfragen).toEqual([undefined]);
        expect(quelle.ausgeblendet("panel.literature")).toBe(true);
        expect(quelle.ausgeblendet("panel.reviews")).toBe(false);
        expect(quelle.stand.value.revision).toBe(4);

        takt?.();
        await ruhe();
        await quelle.lies();
        expect(anfragen).toEqual([undefined, '"c4-database"', '"c4-database"']);
        // 304 und eine Störung lassen den letzten Stand stehen.
        expect([...quelle.aus()].sort()).toEqual(["media.role.coat", "panel.literature"]);
    });

    it("ohne Antwort gilt nichts als ausgeblendet", async () => {
        const quelle = createInhaltsstand(
            () => Promise.reject(new Error("weg")),
            () => undefined,
        );
        expect(quelle.ausgeblendet("panel.literature")).toBe(false);
        await quelle.lies();
        expect(quelle.aus().size).toBe(0);
    });
});

describe("Sätze für Besucher", () => {
    it("🔴 der Satz an der Stelle des Inhalts, wörtlich wie im Eintrag; Bilder haben keinen", () => {
        expect(pausiertSatz("panel.literature")).toBe("Die Literatur ist gerade ausgeblendet.");
        expect(pausiertSatz("panel.citymaps")).toBe("Die Kartensammlung ist gerade ausgeblendet.");
        expect(pausiertSatz("panel.reviews")).toBe("Bewertungen sind gerade ausgeblendet.");
        expect(pausiertSatz("panel.lore.fauna")).toBe("Fauna ist gerade ausgeblendet.");
        expect(pausiertSatz("media.role.literature_cover")).toBe("Buchumschläge zeigen wir gerade nicht.");
        expect(pausiertSatz("series")).toBe("Diese Kartenansicht ist gerade nicht verfügbar.");
        expect(pausiertSatz("media.role.coat")).toBeNull();
    });

    it("„Gerade pausiert: …“ in der Reihenfolge der Tafeln, Lizenzen und Serien danach", () => {
        expect(geradePausiert(new Set())).toBeNull();
        expect(geradePausiert(new Set(["panel.literature", "media.license.cc-by", "media.role.map_preview"]))).toBe(
            "Gerade pausiert: Kartenvorschauen, Literatur, CC BY.",
        );
    });
});

const pausiert = (feature: string): Response =>
    new Response(JSON.stringify({ error: { code: "feature_paused", message: "x", details: { feature } } }), {
        status: 503,
        headers: { "content-type": "application/json" },
    });

describe("SYS-11 im Browser: Reiseberechnung, Gelände, Editor-Sicht", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("🔴 die Reiseberechnung pausiert: der Satz des Planers, kein zweiter Versuch, kein Fehler des Routers", async () => {
        const fetch = vi.fn(() => Promise.resolve(pausiert("route")));
        vi.stubGlobal("fetch", fetch);
        await expect(fetchRoute(["a", "b"], DEFAULT_OPTIONS)).resolves.toEqual({
            ok: false,
            message: "Die Reiseberechnung ist gerade pausiert. Die Karte funktioniert weiter.",
        });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("das Gelände pausiert: kein Gelände (flach), kein Fehler; ein anderes 503 bleibt ein Fehler", async () => {
        await expect(loadTerrainPointer(() => Promise.resolve(pausiert("terrain3d")))).resolves.toBeUndefined();
        await expect(loadTerrainPointer(() => Promise.resolve(new Response("{}", { status: 503 })))).rejects.toThrow(
            /503/u,
        );
    });

    it("ein Editor fragt seine Abschnitte mit editor=true, ein Besucher ohne", () => {
        expect(sectionFetchUrl("/api/subjects/place/x/literature", true)).toBe(
            "/api/subjects/place/x/literature?editor=true",
        );
        expect(sectionFetchUrl("/api/subjects/path/a:b/lore?wiki=W", true)).toBe(
            "/api/subjects/path/a:b/lore?wiki=W&editor=true",
        );
        expect(sectionFetchUrl("/api/subjects/place/x/literature", false)).toBe("/api/subjects/place/x/literature");
    });
});
