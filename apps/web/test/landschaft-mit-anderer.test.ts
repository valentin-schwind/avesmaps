import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { LandscapeBooleanPreview } from "@avesmaps3d/shared";
import { createMitAnderer } from "../src/landschaftseditor/mit-anderer-flaeche";
import type { InteractionOwner, MapInteractionCoordinator } from "../src/map/interaction/types";
import { flaechenEbenenImStil, WATER_FILL_LAYER_ID, WATER_SEA_FILL_LAYER_ID } from "../src/map/landscape-layers";

/**
 * „Mit anderer Fläche ›“: die Wahl auf der Karte (Werkzeug 1, Plan der Editor-Orchestrierung 2026-10-19, Thomas 4.1; Legacy
 * `geometry-ops.js#L400-L546`). Problemfälle: Die eigene Teilfläche wird Ziel; eine für Klicks gesperrte wird Ziel; der erste Klick auf
 * ein Ziel schreibt schon (statt erst zu zeigen); geschrieben wird gegen eine geratene Revision statt gegen die der Vorschau; ein Fehler
 * des Servers beendet den Modus; Esc schreibt etwas; zwei Modi zugleich.
 */

const QUELLE = "a1a1a1a1-0000-4000-8000-0000000000a1";
const ZIEL = "a1a1a1a1-0000-4000-8000-0000000000a2";
const GESPERRT = "a1a1a1a1-0000-4000-8000-0000000000a3";
const WALD = "a1a1a1a1-0000-4000-8000-000000000001";

const VORSCHAU: LandscapeBooleanPreview = {
    polygons: [
        [
            [
                [0, 0],
                [10, 0],
                [10, 10],
            ],
        ],
    ],
    targetPolygons: [
        [
            [
                [5, 0],
                [10, 0],
                [10, 5],
            ],
        ],
    ],
    areaRevision: 4,
    targetAreaRevision: 7,
    targetName: "Hain",
    consumesTarget: true,
    targetLandscapeGoes: true,
};

function aufbau(antworten: { vorschau?: Response; schreiben?: Response } = {}) {
    let owner: InteractionOwner | undefined;
    const interaction = {
        register: (o: InteractionOwner) => {
            owner = o;
            return () => {
                owner = undefined;
            };
        },
    } as unknown as MapInteractionCoordinator;
    const quellen = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    const map = {
        addSource: (id: string) => quellen.set(id, { setData: vi.fn() }),
        getSource: (id: string) => quellen.get(id),
        removeSource: (id: string) => quellen.delete(id),
        addLayer: vi.fn(),
        getLayer: () => ({}),
        removeLayer: vi.fn(),
    } as unknown as MapLibreMap;
    const aufrufe: { url: string; body: Record<string, unknown> }[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        aufrufe.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        if (String(url).endsWith("/boolean-preview"))
            return antworten.vorschau ?? new Response(JSON.stringify(VORSCHAU), { status: 200 });
        return (
            antworten.schreiben ??
            new Response(
                JSON.stringify({
                    operationId: "op",
                    status: "applied",
                    environment: "test",
                    affected: [{ kind: "landscape", id: WALD, revision: 3 }],
                    derivedWork: [],
                    warnings: [],
                    mapRevision: 12,
                }),
                { status: 200 },
            )
        );
    });
    const geschrieben = vi.fn();
    const melde = vi.fn();
    const modus = createMitAnderer({
        karte: () => ({ map, interaction }),
        flaechenEbenen: () => ["landscape-fill-vegetation"],
        geschrieben,
        melde,
        fetcher: fetcher as unknown as typeof fetch,
    });
    /** Der Zeiger über diesen Teilflächen (oberste zuerst). */
    const unter = (...ids: string[]) =>
        ({
            features: () => ids.map((id) => ({ properties: { public_id: id, is_locked: id === GESPERRT } })),
        }) as never;
    const warte = () => new Promise((fertig) => setTimeout(fertig, 0));
    return { modus, owner: () => owner, aufrufe, geschrieben, melde, unter, warte };
}

const START = { regionId: WALD, areaId: QUELLE, name: "Wald", operation: "vereinigen" as const };

describe("„Mit anderer Fläche“: Wahl auf der Karte", () => {
    it("🔴 die eigene und eine gesperrte Teilfläche sind nie Ziel; die nächste darunter schon, mit Vorschau", async () => {
        const t = aufbau();
        t.modus.starte(START);
        t.owner()!.apply("hover", {}, t.unter(QUELLE, GESPERRT, ZIEL));
        await t.warte();
        await t.warte();
        expect(t.modus.laufend.value?.ziel).toMatchObject({ areaId: ZIEL, vorschau: { targetName: "Hain" } });
        expect(t.aufrufe[0]?.body).toEqual({ operation: "vereinigen", areaId: QUELLE, targetAreaId: ZIEL });
        // Nur die eigene darunter: kein Ziel.
        expect(t.owner()!.hit(t.unter(QUELLE, GESPERRT))).toEqual({});
        // Der Modus belegt das Geometrie-Modul der ganzen Seite: wieder freigeben.
        t.modus.abbrechen();
    });

    it("🔴 erst zeigen, dann bestätigt der Klick auf dasselbe Ziel: EINE Operation gegen die Revisionen der Vorschau", async () => {
        const t = aufbau();
        t.modus.starte(START);
        t.owner()!.apply("click", {}, t.unter(ZIEL));
        await t.warte();
        await t.warte();
        expect(t.aufrufe.filter((a) => a.url.endsWith("/boolean"))).toHaveLength(0);
        t.owner()!.apply("click", {}, t.unter(ZIEL));
        await t.warte();
        await t.warte();
        const schreiben = t.aufrufe.find((a) => a.url.endsWith("/boolean"));
        expect(schreiben?.body).toMatchObject({
            operation: "vereinigen",
            areaId: QUELLE,
            baseRevision: 4,
            targetAreaId: ZIEL,
            targetBaseRevision: 7,
        });
        expect(t.geschrieben).toHaveBeenCalledOnce();
        expect(t.modus.laufend.value).toBeUndefined();
        expect(t.owner()).toBeUndefined();
    });

    it("🔴 zeigen, dann klicken wie im Browser: Der Koordinator beendet vor dem Klick das Zeigen, der Klick bestätigt trotzdem", async () => {
        const t = aufbau();
        t.modus.starte(START);
        t.owner()!.apply("hover", {}, t.unter(ZIEL));
        await t.warte();
        await t.warte();
        t.owner()!.lost?.("hover-ended");
        t.owner()!.apply("click", {}, t.unter(ZIEL));
        await t.warte();
        await t.warte();
        expect(t.aufrufe.filter((a) => a.url.endsWith("/boolean"))).toHaveLength(1);
        expect(t.geschrieben).toHaveBeenCalledOnce();
    });

    it("lehnt der Server ab, bleibt der Modus mit seinem Satz; Esc bricht ab, ohne zu schreiben, und gibt die Karte frei", async () => {
        const t = aufbau({
            schreiben: new Response(JSON.stringify({ message: "Hain bearbeitet gerade Anna." }), { status: 409 }),
        });
        t.modus.starte(START);
        t.owner()!.apply("hover", {}, t.unter(ZIEL));
        await t.warte();
        await t.warte();
        await t.modus.bestaetige();
        expect(t.melde).toHaveBeenCalledWith("Hain bearbeitet gerade Anna.", "warning");
        expect(t.modus.laufend.value).toMatchObject({ phase: "waehlt" });
        expect(t.modus.abbrechen()).toBe(true);
        expect(t.modus.laufend.value).toBeUndefined();
        expect(t.owner()).toBeUndefined();
        expect(t.geschrieben).not.toHaveBeenCalled();
        // Danach ist das Geometrie-Modul wieder frei: Ein neuer Modus beginnt.
        t.modus.starte(START);
        expect(t.modus.laufend.value).toBeDefined();
        t.modus.abbrechen();
    });
});

describe("Die Füllebenen, aus denen die Werkzeuge der Form lesen (OPS-000087)", () => {
    const stil = [
        "basiskarte",
        WATER_SEA_FILL_LAYER_ID,
        "landscape-fill-topographie",
        "landscape-line-topographie",
        WATER_FILL_LAYER_ID,
        "gewaesser-kueste",
    ];

    it("🔴 in Topographie und „Alle“ gehören See und Meer dazu, in dieser Reihenfolge der Karte", () => {
        const erwartet = [WATER_SEA_FILL_LAYER_ID, "landscape-fill-topographie", WATER_FILL_LAYER_ID];
        expect(flaechenEbenenImStil(stil, ["topographie"])).toEqual(erwartet);
        expect(flaechenEbenenImStil(stil, undefined)).toEqual(erwartet);
    });

    it("🔴 in der Vegetation ist Wasser zu sehen, aber kein Ziel", () => {
        expect(flaechenEbenenImStil(stil, ["vegetation"])).toEqual(["landscape-fill-topographie"]);
    });

    it("was der Stil nicht trägt, steht nicht in der Liste: Die Karte fragte sonst eine fehlende Ebene ab", () => {
        expect(flaechenEbenenImStil(["landscape-fill-vegetation"], ["topographie"])).toEqual([
            "landscape-fill-vegetation",
        ]);
    });
});
