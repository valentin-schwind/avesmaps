import { describe, expect, it, vi } from "vitest";
import type { OperationReceipt, PlaceRemoval } from "@avesmaps3d/shared";
import { entferne, entfernenStand, stelleWiederHer, type EntfernenApi } from "../src/ortseditor/ort-entfernen.ts";

/**
 * „Ort entfernen“ (WI-0128 E22; Betreiber 2026-10-12: „ort-entfernen-konzept ist prima, genau das wollte ich“, Blatt
 * `review/wi-0128/ort-entfernen-blatt.png`): was das Blatt anbietet, was gesperrt ist und warum, welche Folgen es nennt, was der Knopf tut.
 *
 * Problemfälle: Der Gefahrknopf geht ohne Wahl; eine Kraftlinie am Ort lässt sich übergehen; „Ganz löschen“ einer Stadt nimmt ihre
 * Stätten still mit, obwohl E18 fehlt; „Von der Karte nehmen“ mit Stätten schickt kein „bleiben“ und scheitert am Server; die Folgen
 * nennen Bilder als „bleibt“, obwohl sie beim Löschen mit stillgelegt werden.
 */
const ALLE = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];

function ort(ueber: Partial<PlaceRemoval> = {}): PlaceRemoval {
    return {
        publicId: "e22e22e2-0000-4000-8000-000000000001",
        name: "Ferdok",
        revision: 7,
        onMap: true,
        subtype: "stadt",
        position: { x: 492, y: 524 },
        staetten: [],
        wegenden: ["Reichsstraße 6", "Der Große Fluss"],
        gebiete: [{ name: "Grafschaft Ferdok", rolle: "hauptstadt" }],
        kraftlinien: [],
        bleibt: { wiki: true, bilder: 3, quellen: 70, stadtplaene: 1, abenteuer: 0, bewertungen: 2 },
        ...ueber,
    };
}
const titel = (stand: ReturnType<typeof entfernenStand>) => stand.folgen.map((folge) => folge.titel);

describe("Das Blatt „Ort entfernen“", () => {
    it("🔴 ohne Wahl ist der Gefahrknopf gesperrt und heißt „Ort entfernen“; die Wahl gibt ihm ihre Handlung", () => {
        const ohne = entfernenStand(ort(), { ort: undefined, staetten: "bleiben" }, ALLE);
        expect(ohne.handlung).toBe("Ort entfernen");
        expect(ohne.grund).toBe("Erst eine Wahl treffen.");
        expect(ohne.zurueck).toBeUndefined();
        // Ohne Wahl nennt das Blatt, was sicher kommt (Wegenden, Gebiet), aber noch nicht, was bleibt.
        expect(titel(ohne)).toEqual(["Wegenden", "Hauptstadt"]);

        const ab = entfernenStand(ort(), { ort: "abnehmen", staetten: "bleiben" }, ALLE);
        expect(ab).toMatchObject({ handlung: "Von der Karte nehmen", grund: undefined });
        expect(ab.zurueck).toBe("Zurück mit „Auf der Karte setzen“.");
        expect(ab.folgen.find((folge) => folge.titel === "Bleibt am Ort")?.text).toBe(
            "Wiki-Artikel, 3 Bilder, 70 Quellen, 1 Stadtplan und 2 Bewertungen.",
        );
        expect(ab.folgen.find((folge) => folge.titel === "Hauptstadt")?.leise).toBe("Bleibt es, nur ohne Kartenpunkt.");

        const weg = entfernenStand(ort(), { ort: "loeschen", staetten: "bleiben" }, ALLE);
        expect(weg).toMatchObject({ handlung: "Ganz löschen", grund: undefined });
        expect(weg.zurueck).toBe("Unter „Änderungen“ zurücknehmbar.");
        // Beim Löschen bleibt nichts „am Ort“: Es wird mit ihm stillgelegt und kommt mit ihm zurück; der Wiki-Artikel wird wieder frei.
        expect(titel(weg)).toEqual(["Wegenden", "Hauptstadt", "Wiki-Artikel", "Mitgelöscht"]);
        expect(weg.folgen.find((folge) => folge.titel === "Hauptstadt")?.leise).toBe(
            "Das Gebiet hat danach keine Hauptstadt.",
        );
        expect(weg.folgen.find((folge) => folge.titel === "Mitgelöscht")?.text).not.toContain("Wiki");
    });

    it("🔴 eine Kraftlinie sperrt jede Wahl und den Knopf, oben steht der Satz, in den Folgen die Linie in Gefahrfarbe", () => {
        const stand = entfernenStand(
            ort({ kraftlinien: [{ name: "Hexenband", gegenueber: "Arras de Mott" }] }),
            { ort: "abnehmen", staetten: "bleiben" },
            ALLE,
        );
        expect(stand.sperre).toBe(
            "Am Ort endet die Kraftlinie Hexenband. Solange sie dort endet, lässt sich Ferdok nicht entfernen.",
        );
        expect(stand.grund).toBe("Erst die Kraftlinie lösen.");
        expect(Object.values(stand.orte).map((zeile) => zeile.grund)).toEqual([
            "Erst die Kraftlinie lösen.",
            "Erst die Kraftlinie lösen.",
            "Erst die Kraftlinie lösen.",
        ]);
        // Die Sperre steht EINMAL oben; die Zeilen behalten ihren Satz (Blatt, Fall c).
        expect(Object.values(stand.orte).map((zeile) => zeile.hinweis)).toEqual([undefined, undefined, undefined]);
        expect(stand.folgen[0]).toEqual({
            titel: "Kraftlinie",
            text: "Hexenband nach Arras de Mott.",
            leise: "Sperrt das Entfernen.",
            gefahr: true,
        });
    });

    it("🔴 Löschen geht seit E22 G2 auch mit Stätten; Stätte werden, umhängen und eigenständig warten weiter auf E10b", () => {
        const stadt = ort({ staetten: [{ name: "Ugdanhafen", art: "Hafen" }, { name: "Kosch-Kurier" }] });
        const stand = entfernenStand(stadt, { ort: undefined, staetten: "bleiben" }, ALLE);
        expect(stand.orte.abnehmen.grund).toBeUndefined();
        expect(stand.orte.staette.grund).toBe("Kommt mit der festen Bindung der Stätten.");
        // 🔴 Die Stätten gehen mit und kommen mit ↺ zurück (`place.restore`), also kein Grund mehr.
        expect(stand.orte.loeschen.grund).toBeUndefined();
        expect(stand.staetten?.namen).toEqual(["Ugdanhafen", "Kosch-Kurier"]);
        expect(stand.staetten?.optionen.bleiben).toMatchObject({ titel: "Bleiben bei Ferdok", grund: undefined });
        expect(stand.staetten?.optionen.anderer.grund).toBe("Kommt mit der festen Bindung der Stätten.");
        expect(stand.staetten?.optionen.eigenstaendig.grund).toBe("Kommt mit der festen Bindung der Stätten.");
        // Wer die Stätten anders wählen will, kommt nicht durch: Der Knopf nennt den Grund.
        expect(entfernenStand(stadt, { ort: "abnehmen", staetten: "anderer" }, ALLE).grund).toBe(
            "Kommt mit der festen Bindung der Stätten.",
        );
        // Beim Löschen heißt „bleiben“ „Mitlöschen“ (G2).
        expect(
            entfernenStand(stadt, { ort: "loeschen", staetten: "bleiben" }, ALLE).staetten?.optionen.bleiben.titel,
        ).toBe("Mitlöschen");

        const punkt = entfernenStand(
            ort({ innerortsVon: "Ferdok", name: "Flusswacht" }),
            { ort: "abnehmen", staetten: "bleiben" },
            ALLE,
        );
        expect(punkt.grund).toBe("Ein innerorts-Punkt von Ferdok; das kommt mit der festen Bindung der Stätten.");
    });

    it("ein Ort ohne Lage kann nur ganz gelöscht werden; ohne Recht an der Geometrie geht nur „Von der Karte nehmen“ nicht", () => {
        const ohneLage = entfernenStand(
            ort({ onMap: false, wegenden: [] }),
            { ort: undefined, staetten: "bleiben" },
            ALLE,
        );
        expect(ohneLage.orte.abnehmen.grund).toBe("Steht schon nicht auf der Karte.");
        expect(ohneLage.orte.loeschen.grund).toBeUndefined();
        const ohneGeometrie = entfernenStand(ort(), { ort: undefined, staetten: "bleiben" }, [
            "edit_map_objects",
            "edit_territories",
            "edit_landscapes",
        ]);
        expect(ohneGeometrie.orte.abnehmen.grund).toBe("Dafür fehlt das Recht.");
        expect(ohneGeometrie.orte.loeschen.grund).toBeUndefined();
    });
});

describe("Was der Knopf tut", () => {
    const quittung = { affected: [], derivedWork: [], warnings: [], mapRevision: 42 } as unknown as OperationReceipt;
    const api = (): EntfernenApi & Record<"nimmAb" | "loesche" | "stelleWiederHer", ReturnType<typeof vi.fn>> => ({
        entfernenVorschau: vi.fn(),
        nimmAb: vi.fn(async () => ({ ok: true as const, quittung })),
        loesche: vi.fn(async () => ({ ok: true as const, quittung })),
        stelleWiederHer: vi.fn(async () => ({
            ok: false as const,
            status: 400,
            fehler: { code: "validation_failed", message: "Ferdok ist schon wieder da." },
        })),
    });

    it("🔴 Abnehmen mit Stätten schickt „bleiben“, ohne Stätten nicht; Löschen schickt die gelesene Revision; ↺ meldet den Satz des Servers", async () => {
        const mit = api();
        await entferne(
            mit,
            ort({ staetten: [{ name: "Ugdanhafen" }] }),
            { ort: "abnehmen", staetten: "bleiben" },
            () => "k1",
        );
        expect(mit.nimmAb).toHaveBeenCalledWith(ort().publicId, {
            operationId: "k1",
            baseRevision: 7,
            staetten: "bleiben",
        });
        const ohne = api();
        await entferne(ohne, ort(), { ort: "abnehmen", staetten: "bleiben" }, () => "k2");
        expect(ohne.nimmAb).toHaveBeenCalledWith(ort().publicId, { operationId: "k2", baseRevision: 7 });
        const weg = api();
        expect(await entferne(weg, ort(), { ort: "loeschen", staetten: "bleiben" }, () => "k3")).toEqual({
            ok: true,
            weg: "loeschen",
            quittung,
        });
        expect(weg.loesche).toHaveBeenCalledWith(ort().publicId, { operationId: "k3", baseRevision: 7 });
        expect(await entferne(api(), ort(), { ort: "staette", staetten: "bleiben" })).toEqual({
            ok: false,
            satz: "Kommt mit der festen Bindung der Stätten.",
        });
        expect(await stelleWiederHer(api(), ort().publicId, "op-1", () => "k4")).toEqual({
            ok: false,
            satz: "Ferdok ist schon wieder da.",
        });
    });
});
