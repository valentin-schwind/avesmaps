import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { NO_CLIMATE } from "../src/routing/climate.ts";
import { NO_GROUND } from "../src/routing/ground.ts";
import { buildRouteNetwork, type RouteNetwork, type RouteNode } from "../src/routing/network.ts";
import type { RoutingDataRevision } from "../src/routing/revision.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { RouteService, type ReloadEvent, type RoutingSource } from "../src/routing/service.ts";
import { NO_WATER } from "../src/routing/water.ts";

/**
 * Ruhe abwarten (WI-0177, Thomas 2.3; Hauptorchestrierung 2026-10-19): Schreiben Editoren in kurzer Folge, ändert sich der Teil `map` alle
 * zwei Sekunden (so gemessen, als die Wegkurve jeden Handgriff schrieb; Rückbau 2026-10-31, EDIT-0003 G4). Der Worker prüft alle 5 s;
 * ohne Ruhe lud er dabei 5-mal in 20 s den ganzen Graphen (Messung in der Wegwerf-Welt).
 * Benannte Fälle: 10 Handgriffe in 20 s laden höchstens 2-mal; eine einzelne Änderung lädt nach der Ruhe; Gelände lädt sofort; ohne
 * `ruheMs` bleibt alles wie bisher.
 */
const ort = (id: string, x: number): RouteNode => ({ id, name: id, kind: "place", isHidden: false, x, y: 100 });
const netz = (): RouteNetwork =>
    buildRouteNetwork(
        [ort("a", 100), ort("b", 110)],
        [
            {
                public_id: "ab",
                name: "ab",
                subtype: "Strasse",
                coordinates: JSON.stringify({
                    type: "LineString",
                    coordinates: [
                        [100, 100],
                        [110, 100],
                    ],
                }),
                allowed_transports: null,
                transport_domain: null,
                flow_direction: null,
                flow_factor: null,
            },
        ],
    );
const BASIS: RoutingDataRevision = {
    map: "m0",
    travelModel: "modell",
    terrain: "t1",
    pathProfiles: "p1",
    seaGraph: "s1",
    climate: "c1",
    territories: "z1",
    settings: "e1",
    settingsLive: "l1",
};

function dienst(ruhe: { ruheMs: number; hoechstensMs: number } | undefined) {
    let jetzt = 0;
    let revision = BASIS;
    const geladen: ReloadEvent[] = [];
    const source: RoutingSource = {
        revision: async () => revision,
        load: async () => ({
            network: netz(),
            water: NO_WATER,
            land: NO_WATER,
            rivers: NO_RIVERS,
            ground: NO_GROUND,
            climate: NO_CLIMATE,
            revision,
        }),
    };
    const service = new RouteService({
        mapDomain: "aventuria",
        model: AVENTURIA_TRAVEL_MODEL,
        source,
        recheckMs: 5000,
        ...ruhe,
        now: () => jetzt,
        onReload: (event) => geladen.push(event),
    });
    return {
        service,
        geladen,
        /** Der Takt des Workers: Uhr auf `t`, dann prüfen (wie `setInterval(refresh, 5000)` in `worker.ts`). */
        async takt(t: number) {
            jetzt = t;
            await service.refresh();
        },
        setze(teil: Partial<RoutingDataRevision>) {
            revision = { ...revision, ...teil };
        },
    };
}

describe("Der Routingdienst wartet bei reinen Kartenänderungen auf Ruhe", () => {
    const RUHE = { ruheMs: 5000, hoechstensMs: 15_000 };

    it("🔴 10 Handgriffe in 20 s (alle 2 s eine neue Revision) laden höchstens 2-mal", async () => {
        const d = dienst(RUHE);
        await d.takt(0);
        expect(d.geladen).toHaveLength(1);
        // Handgriffe bei 1, 3, 5 … 19 s; der Worker prüft bei 5, 10, 15 … 40 s.
        let handgriff = 0;
        for (let t = 5000; t <= 40_000; t += 5000) {
            while (handgriff < 10 && 1000 + handgriff * 2000 <= t) d.setze({ map: `m${String(++handgriff)}` });
            await d.takt(t);
        }
        const nachher = d.geladen.slice(1);
        expect(nachher.length).toBeGreaterThanOrEqual(1);
        expect(nachher.length).toBeLessThanOrEqual(2);
        // Am Ende gilt der letzte Stand.
        expect(nachher.at(-1)?.revision).toBe(d.service["loaded"]?.key);
        expect(d.service["loaded"]?.data.revision.map).toBe("m10");
    });

    it("eine einzelne Änderung lädt, sobald die Revision einen Takt lang still stand", async () => {
        const d = dienst(RUHE);
        await d.takt(0);
        d.setze({ map: "m1" });
        await d.takt(5000);
        expect(d.geladen).toHaveLength(1);
        await d.takt(10_000);
        expect(d.geladen).toHaveLength(2);
        expect(d.geladen[1]?.changed).toEqual(["map"]);
    });

    it("🔴 spätestens nach hoechstensMs lädt er auch, wenn weiter Änderungen kommen", async () => {
        const d = dienst(RUHE);
        await d.takt(0);
        for (let t = 5000; t <= 20_000; t += 5000) {
            d.setze({ map: `m${String(t)}` });
            await d.takt(t);
        }
        // Gesehen ab 5 s, also geladen bei 20 s (15 s danach), obwohl die Revision eben noch wechselte.
        expect(d.geladen).toHaveLength(2);
        expect(d.geladen[1]?.revision).toBe(d.service["loaded"]?.key);
    });

    it("🔴 Gelände, Wegprofile und Einstellungen laden sofort, auch mitten in einer Folge von Kartenänderungen", async () => {
        const d = dienst(RUHE);
        await d.takt(0);
        d.setze({ map: "m1" });
        await d.takt(5000);
        expect(d.geladen).toHaveLength(1);
        d.setze({ map: "m2", terrain: "t2" });
        await d.takt(10_000);
        expect(d.geladen).toHaveLength(2);
        expect(d.geladen[1]?.changed).toEqual(["map", "terrain"]);
        d.setze({ pathProfiles: "p2" });
        await d.takt(15_000);
        expect(d.geladen).toHaveLength(3);
    });

    it("ohne ruheMs lädt jede neue Revision beim nächsten Takt (wie bisher)", async () => {
        const d = dienst(undefined);
        await d.takt(0);
        for (let t = 5000; t <= 20_000; t += 5000) {
            d.setze({ map: `m${String(t)}` });
            await d.takt(t);
        }
        expect(d.geladen).toHaveLength(5);
    });
});
