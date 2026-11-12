import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { EditorLandscapeDetail } from "@avesmaps3d/shared";
import type { AnlegenEingabe, AnlegenModus } from "../src/map/geometrie/anlegen";
import type { MapInteractionCoordinator } from "../src/map/interaction/types";

/**
 * „Zerschneiden“ (Werkzeug 5, Betreiber 2026-10-19): die Andockung an den Modus „Anlegen“. Problemfälle: Die Schnittlinie rastet nicht
 * an Ecken und Kanten der geschnittenen Teilfläche ein; geschrieben wird gegen eine geratene Revision oder mit anders gerundeten Punkten
 * (der Schnitt soll exakt an der gezeichneten Linie liegen); ein abgelehnter Schnitt beendet den Modus; Esc mit gezeichneter Linie
 * verwirft ohne Frage.
 */

const anlegen = vi.hoisted(() => ({ eingabe: undefined as AnlegenEingabe | undefined, modus: {} as AnlegenModus }));
vi.mock("../src/map/geometrie/anlegen-modus", () => ({
    installAnlegenModus: (_map: unknown, _interaction: unknown, eingabe: AnlegenEingabe) => {
        anlegen.eingabe = eingabe;
        return anlegen.modus;
    },
}));
const { createZerschneiden, SCHNITT_ANLEGEN, schnittZiele } = await import("../src/landschaftseditor/zerschneiden");

const WALD = "c5c5c5c5-0000-4000-8000-000000000001";
const TEIL = "c5c5c5c5-0000-4000-8000-0000000000a1";
const DETAIL: EditorLandscapeDetail = {
    id: WALD,
    name: "Wald",
    layer: "vegetation",
    circle: "halb-rechts",
    order: 1,
    clickLocked: false,
    areas: [
        {
            id: TEIL,
            polygons: [
                [
                    [
                        [0, 0],
                        [10, 0],
                        [10, 10],
                    ],
                ],
            ],
            affectsPaths: true,
            revision: 9,
        },
    ],
    labels: [],
    neighbors: [],
    revision: 2,
};

function aufbau(schreiben?: Response) {
    const aufrufe: { url: string; body: Record<string, unknown> }[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.method !== "POST") return new Response(JSON.stringify(DETAIL), { status: 200 });
        aufrufe.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return (
            schreiben ??
            new Response(
                JSON.stringify({
                    operationId: "op",
                    status: "applied",
                    environment: "test",
                    affected: [{ kind: "landscape", id: WALD, revision: 3 }],
                    derivedWork: [],
                    warnings: [],
                    name: "Wald",
                }),
                { status: 200 },
            )
        );
    });
    const map = {
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getLayer: () => ({}),
        removeLayer: vi.fn(),
        getSource: () => ({}),
        removeSource: vi.fn(),
    };
    const geschrieben = vi.fn();
    const melde = vi.fn();
    const modus = createZerschneiden({
        karte: () => ({ map: map as unknown as MapLibreMap, interaction: {} as MapInteractionCoordinator }),
        fangradius: () => 12,
        geschrieben,
        melde,
        fetcher: fetcher as unknown as typeof fetch,
    });
    return { modus, aufrufe, geschrieben, melde };
}

beforeEach(() => {
    // Die Tasten hängen am Dokument; die Unit-Tests laufen ohne DOM.
    vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    anlegen.eingabe = undefined;
    anlegen.modus = {
        aus: vi.fn(),
        sperre: vi.fn(),
        zurueck: vi.fn(),
        wieder: vi.fn(),
        verwerfen: vi.fn(),
        fertig: vi.fn(),
    } as unknown as AnlegenModus;
});

describe("„Zerschneiden“: die Schnittlinie", () => {
    it("gerade, ab zwei Punkten; rastet an jeder Ecke und Kante der Teilfläche ein", () => {
        expect(
            SCHNITT_ANLEGEN.rundung([
                { x: 0, y: 0 },
                { x: 5, y: 5 },
            ]),
        ).toEqual([
            { x: 0, y: 0 },
            { x: 5, y: 5 },
        ]);
        expect(SCHNITT_ANLEGEN.pruefe([{ x: 0, y: 0 }])).toBe("zuWenig");
        expect(
            SCHNITT_ANLEGEN.pruefe([
                { x: 0, y: 0 },
                { x: 1, y: 1 },
            ]),
        ).toBeUndefined();
        const ziele = schnittZiele(DETAIL.areas[0]!.polygons, TEIL, "Wald");
        expect(ziele.filter((z) => z.art === "ecke")).toHaveLength(3);
        expect(ziele.find((z) => z.art === "kante" && z.at.x === 10 && z.at.y === 10)?.bis).toEqual({ x: 0, y: 0 });
    });

    it("🔴 „Fertig“ schreibt EINE Operation mit der Linie, wie sie gezeichnet ist, gegen die Revision des Details", async () => {
        const t = aufbau();
        await t.modus.starte({ regionId: WALD, areaId: TEIL });
        expect(t.modus.laufend.value).toMatchObject({ name: "Wald", phase: "zeichnet" });
        expect(anlegen.eingabe?.ziele()).toHaveLength(6);
        anlegen.eingabe!.fertig([
            { at: { x: 5.123456789, y: -1 }, ziel: undefined },
            { at: { x: 5, y: 11 }, ziel: undefined },
        ]);
        await vi.waitFor(() => expect(t.geschrieben).toHaveBeenCalledOnce());
        expect(t.aufrufe[0]!.url).toContain(`/landscapes/${WALD}/split`);
        expect(t.aufrufe[0]!.body).toMatchObject({
            areaId: TEIL,
            baseRevision: 9,
            line: [
                [5.123456789, -1],
                [5, 11],
            ],
        });
        expect(t.modus.laufend.value).toBeUndefined();
        expect(t.melde).toHaveBeenCalledWith(expect.stringContaining("eigene Landschaft"), "success");
    });

    it("🔴 lehnt der Server ab, bleibt die Linie mit seinem Satz; Esc mit Linie fragt erst, das zweite Esc verwirft", async () => {
        const t = aufbau(
            new Response(JSON.stringify({ message: "Die Schnittlinie trennt die Fläche nicht vollständig." }), {
                status: 400,
            }),
        );
        await t.modus.starte({ regionId: WALD, areaId: TEIL });
        anlegen.eingabe!.stand({ punkte: 2, abschnitte: 1, zurueck: true, wieder: false, fertig: undefined });
        anlegen.eingabe!.fertig([
            { at: { x: 5, y: 2 }, ziel: undefined },
            { at: { x: 5, y: 8 }, ziel: undefined },
        ]);
        await vi.waitFor(() =>
            expect(t.melde).toHaveBeenCalledWith("Die Schnittlinie trennt die Fläche nicht vollständig.", "warning"),
        );
        expect(t.modus.laufend.value).toMatchObject({ phase: "zeichnet" });
        expect(anlegen.modus.sperre).toHaveBeenLastCalledWith(false);
        expect(t.modus.abbrechen()).toBe(true);
        expect(t.modus.laufend.value).toMatchObject({ frage: true });
        expect(t.modus.abbrechen()).toBe(true);
        expect(t.modus.laufend.value).toBeUndefined();
        expect(anlegen.modus.aus).toHaveBeenCalled();
        expect(t.geschrieben).not.toHaveBeenCalled();
    });

    it("🔴 an einer Sprache (WI-0261 Stufe 3): Lesen und Schreiben über die Quelle der Art, ihr Satz statt „eigene Landschaft“", async () => {
        const t = aufbau();
        const quittung = {
            operationId: "op",
            status: "applied",
            environment: "test",
            affected: [],
            derivedWork: [],
            warnings: [],
        };
        const quelle = {
            werkzeug: "spracheditor",
            lies: vi.fn(async () => ({
                ok: true as const,
                wert: { name: "Garethi · Teilfläche 2", teile: DETAIL.areas[0]!.polygons, revision: 4 },
            })),
            schneide: vi.fn(async () => ({ ok: true as const, wert: quittung })),
            geschrieben: vi.fn(),
            saetze: {
                herausgeloest: "spracheditor.unterflaechen.herausgeloest",
                geschnitten: "spracheditor.zerschneiden.geschnitten",
            },
        };
        await t.modus.starte({ regionId: "sprache", areaId: "teil" }, quelle as never);
        expect(t.modus.laufend.value).toMatchObject({ name: "Garethi · Teilfläche 2" });
        anlegen.eingabe!.fertig([
            { at: { x: 5, y: -1 }, ziel: undefined },
            { at: { x: 5, y: 11 }, ziel: undefined },
        ]);
        await vi.waitFor(() => expect(quelle.geschrieben).toHaveBeenCalledWith(quittung, "zerschneiden"));
        expect(quelle.schneide).toHaveBeenCalledWith("sprache", "teil", {
            operationId: expect.any(String),
            baseRevision: 4,
            line: [
                [5, -1],
                [5, 11],
            ],
        });
        expect(t.aufrufe).toHaveLength(0);
        expect(t.geschrieben).not.toHaveBeenCalled();
        expect(t.melde).toHaveBeenCalledWith(expect.not.stringContaining("Landschaft"), "success");
    });
});
