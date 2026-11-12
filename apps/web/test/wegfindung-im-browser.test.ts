import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouteLandscapesResponse } from "@avesmaps3d/shared";
import { ladeStartansicht, wegfindungImBrowserWerte } from "../src/map/start-view.ts";
import { readPlannerLink } from "../src/route-planner/planner-link.ts";
import { DEFAULT_OPTIONS } from "../src/route-planner/planner-model.ts";
import { fetchRoute } from "../src/route-planner/route-client.ts";
import { landscapeLine } from "../src/route-planner/route-landscapes.ts";

vi.mock("../src/besuch/besuch-melden.ts", () => ({ melde: vi.fn(), meldeEinmal: vi.fn() }));

/**
 * Die Werte der Wegfindung, die der Planer selbst anwendet (WI-0214): Grenze der Wegpunkte, Grenze der Kartenpunkte und
 * kleinste genannte Landschaft. Vorher rechnete der Browser mit den Vorgaben, während die Systemsteuerung den eingestellten
 * Wert als geltend zeigte. Sie kommen mit `GET /api/map-settings` (Feld `wegfindung`), gelesen vor dem Start der Anwendung.
 *
 * 🪤 Die Reihenfolge der Fälle zählt: `start-view.ts` hält die Antwort im Modul, wie in der Anwendung.
 */

const server = (body: unknown) =>
    (async () =>
        new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
        })) as typeof fetch;

const label = (type: string): string => ({ wald: "Wald" })[type] ?? "";
const regions: RouteLandscapesResponse["regions"] = {
    gross: { name: "Großwald", type: "wald", target: null },
    klein: { name: "Winzling", type: "wald", target: null },
};
/** Eine Etappe: der Großwald trägt 60 %, der Winzling 4 % — unter der Vorgabe von 5 %. */
const etappe = [{ length: 100, in: [["gross", 60] as [string, number], ["klein", 4] as [string, number]] }];
const namen = (): string[] => landscapeLine(etappe, regions, label, "share").map((entry) => entry.name);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("ohne Antwort des Servers: die Vorgaben", () => {
    it("Grenzen und Anteil sind die des Registers", async () => {
        await ladeStartansicht((async () => {
            throw new Error("offline");
        }) as typeof fetch);
        expect(wegfindungImBrowserWerte()).toEqual({
            routeWaypointLimit: 100,
            routeMapPointLimit: 10,
            landscapeMinShare: 5,
        });
        expect(namen()).toEqual(["Großwald"]);
    });

    it("ein älterer Server ohne das Feld: die Vorgaben", async () => {
        await ladeStartansicht(server({ revision: null, startZoom: 3 }));
        expect(wegfindungImBrowserWerte().routeWaypointLimit).toBe(100);
    });
});

describe("mit den eingestellten Werten", () => {
    it("ein Wert außerhalb seiner Grenzen fällt auf die Vorgabe, die anderen gelten", async () => {
        await ladeStartansicht(
            server({ wegfindung: { routeWaypointLimit: 3, routeMapPointLimit: 9999, landscapeMinShare: 3 } }),
        );
        expect(wegfindungImBrowserWerte()).toEqual({
            routeWaypointLimit: 3,
            routeMapPointLimit: 10,
            landscapeMinShare: 3,
        });
    });

    it("`landscapeMinShare`: der Winzling mit 4 % steht jetzt in der Zeile", () => {
        expect(namen()).toEqual(["Großwald", "Winzling"]);
    });

    it("`routeWaypointLimit`: ein geteilter Link trägt höchstens so viele Orte", () => {
        expect(readPlannerLink("?route=A~B~C~D~E").names).toEqual(["A", "B", "C"]);
    });

    it("`routeMapPointLimit`: die Absage nennt die eingestellte Grenze, nicht eine feste 10", async () => {
        await ladeStartansicht(
            server({ wegfindung: { routeWaypointLimit: 100, routeMapPointLimit: 4, landscapeMinShare: 5 } }),
        );
        vi.stubGlobal(
            "fetch",
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ error: "too_many_map_points", detail: "5" }), {
                        status: 400,
                        headers: { "content-type": "application/json" },
                    }),
            ),
        );
        const outcome = await fetchRoute(["a", "b"], DEFAULT_OPTIONS);
        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? "" : outcome.message).toContain("4");
        expect(outcome.ok ? "" : outcome.message).not.toContain("10");
    });
});
