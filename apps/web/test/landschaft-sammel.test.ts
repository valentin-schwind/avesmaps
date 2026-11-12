import { describe, expect, it, vi } from "vitest";
import type { EditorLandscapeRow } from "@avesmaps3d/shared";
import { ueberAlle } from "../src/fenster/sammel";
import {
    artEbene,
    createLandschaftSammelArt,
    fehltArt,
    sammelAenderung,
    sammelZeilen,
} from "../src/landschaftseditor/landschaft-sammel";

/**
 * Die Mehrfachauswahl der Derographie (EDIT-0003 T57): was gemeinsam geht und was „Fertig“ schickt. Problemfälle: Eine leere Art geht als
 * Art zum Server; die Art wird aus einer gemischten Ebene gewählt; eine neue Ebene ohne Art bleibt unbemerkt; „Fertig“ schreibt je
 * Landschaft.
 */

const zeile = (id: string, layer: EditorLandscapeRow["layer"], type?: string, hidden?: true): EditorLandscapeRow =>
    ({ id, name: id, layer, type, hidden, circle: "voll", order: 1 }) as EditorLandscapeRow;

describe("Die Felder", () => {
    it("🔴 gemeinsam: Ebene, Art und verborgen je Zeile; gemischt, wo sie sich unterscheiden", () => {
        const art = createLandschaftSammelArt();
        const zeilen = [zeile("a", "vegetation", "wald"), zeile("b", "vegetation", "urwald", true)];
        expect(ueberAlle(zeilen, art.gemeinsam.ebene)).toEqual({ gleich: true, wert: "vegetation" });
        expect(ueberAlle(zeilen, art.gemeinsam.art)).toEqual({ gleich: false });
        expect(ueberAlle(zeilen, art.gemeinsam.verborgen)).toEqual({ gleich: false });
        expect(art.einzeln).toContain("name");
    });

    it("🔴 die Art kommt aus der neuen Ebene, sonst aus der gemeinsamen; gemischt ohne neue: keine", () => {
        const gemischt = [zeile("a", "vegetation"), zeile("b", "topographie")];
        expect(artEbene(gemischt, {})).toBeUndefined();
        expect(artEbene(gemischt, { ebene: "derographisch" })).toBe("derographisch");
        expect(artEbene([zeile("a", "vegetation"), zeile("b", "vegetation")], {})).toBe("vegetation");
    });

    it("🔴 eine neue Ebene ohne Art fällt auf; bleibt die Ebene für alle, nicht", () => {
        const zeilen = [zeile("a", "vegetation"), zeile("b", "vegetation")];
        expect(fehltArt(zeilen, { ebene: "topographie" })).toBe(true);
        expect(fehltArt(zeilen, { ebene: "topographie", art: "" })).toBe(true);
        expect(fehltArt(zeilen, { ebene: "topographie", art: "huegelland" })).toBe(false);
        expect(fehltArt(zeilen, { ebene: "vegetation" })).toBe(false);
    });
});

describe("„Fertig“", () => {
    it("🔴 EIN Schreibaufruf für alle mit nur den gesetzten Feldern; eine leere Art fehlt", async () => {
        expect(sammelAenderung({ ebene: "topographie", art: "", verborgen: false })).toEqual({
            layer: "topographie",
            hidden: false,
        });
        const fetcher = vi.fn(
            async () => new Response(JSON.stringify({ affected: [], warnings: [] }), { status: 200 }),
        );
        const art = createLandschaftSammelArt(fetcher as unknown as typeof fetch);
        await art.schreibe(["a", "b"], { felder: { verborgen: true }, wiki: [] }, "op-1");
        expect(fetcher).toHaveBeenCalledTimes(1);
        const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/editor/landscapes/batch");
        expect(JSON.parse(String(init.body))).toEqual({
            operationId: "op-1",
            ids: ["a", "b"],
            changes: { hidden: true },
        });
    });
});

describe("Gipfel in der Mehrfachauswahl (Stage-Fund 2026-10-19)", () => {
    it("🔴 angehakte Gipfel werden Zeilen der Sammelansicht, nicht übergangen", () => {
        const liste = {
            rows: [zeile("a", "vegetation", "wald")],
            peaks: [
                { id: "p1", name: "1. Vulkan", subtype: "vulkan", circle: "voll", position: [1, 2] },
                { id: "p2", name: "2. Vulkan", subtype: "vulkan", circle: "voll", hidden: true, position: [3, 4] },
            ],
        } as unknown as Parameters<typeof sammelZeilen>[0];
        expect(sammelZeilen(liste, ["gipfel:p1", "gipfel:p2", "a"])).toEqual([
            expect.objectContaining({ id: "a", layer: "vegetation" }),
            { id: "gipfel:p1", name: "1. Vulkan", layer: "topographie", type: "vulkan", hidden: false, gipfel: true },
            { id: "gipfel:p2", name: "2. Vulkan", layer: "topographie", type: "vulkan", hidden: true, gipfel: true },
        ]);
    });

    it("🔴 „Fertig“ schickt Landschaften und Gipfel getrennt in EINEM Aufruf", async () => {
        const fetcher = vi.fn(
            async () => new Response(JSON.stringify({ affected: [], warnings: [] }), { status: 200 }),
        );
        const art = createLandschaftSammelArt(fetcher as unknown as typeof fetch);
        await art.schreibe(["a", "gipfel:p1", "gipfel:p2"], { felder: { verborgen: true }, wiki: [] }, "op-2");
        expect(fetcher).toHaveBeenCalledTimes(1);
        const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(String(init.body))).toEqual({
            operationId: "op-2",
            ids: ["a"],
            peaks: ["p1", "p2"],
            changes: { hidden: true },
        });
    });
});
