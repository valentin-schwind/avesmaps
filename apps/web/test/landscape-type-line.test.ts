import { describe, expect, it } from "vitest";
import { createPropertyExpression } from "@maplibre/maplibre-gl-style-spec";
import { composeView, labelFamily } from "@avesmaps3d/shared";
import { AREA_SELECTION_LABEL_LAYER_ID } from "../src/map/area-selection.ts";
import { landscapeRunLayerId, mapLabelLayerId } from "../src/map/landscape-layers.ts";
import { buildPlaceLayers } from "../src/map/place-layers.ts";
import { findLayer, propertySpec } from "./style-spec.ts";

/**
 * Die Art als zweite Zeile unter gleichnamigen Landschaftsnamen (WI-0135).
 *
 * Betreiber 2026-10-11: „nur bei landschaften, alle: oft hat man flächen gleicher art übereinander liegen. schön wärs wenn bei 2
 * flächen, die gleich heißen, in einer 2. zeile "steppe" oder "tiefebene" (klein, zentriert) unter dem name drunterstehen
 * könnte. das brauchen wir nur bei vegetation und topographie“. Ob es den Zwilling gibt, sagt die Kachel (`name_twin`,
 * Migration 0109, geprüft in `apps/server/test/label-name-twin.test.ts`); hier steht, was der Stil daraus macht.
 */

const ALLE = { labels: true, composition: composeView("landscapes", "alle") };

/** Der Text, den MapLibre aus `text-field` für diese Eigenschaften rechnet: Abschnitte samt Schriftfaktor. */
function textOf(
    layerId: string,
    properties: Record<string, unknown>,
    options: Parameters<typeof buildPlaceLayers>[0] = ALLE,
): { text: string; scale: number | null }[] {
    const layer = findLayer(buildPlaceLayers(options), layerId, "symbol");
    if (!layer) throw new Error(`${layerId} fehlt im Stil`);
    const compiled = createPropertyExpression(
        layer.layout?.["text-field"],
        "text-field",
        propertySpec("layout_symbol", "text-field"),
    );
    if (compiled.result !== "success")
        throw new Error(`${layerId}: text-field ungültig ${JSON.stringify(compiled.value)}`);
    const wert = compiled.value.evaluate({ zoom: 6 }, { type: "Point", properties } as never) as unknown;
    if (typeof wert === "string") return [{ text: wert, scale: null }];
    return (wert as { sections: { text: string; scale: number | null }[] }).sections.map((section) => ({
        text: section.text,
        scale: section.scale,
    }));
}

const steppe = { name: "Große Öde", name_twin: true, region_type: "steppe" };

describe("Art-Zeile unter gleichnamigen Landschaftsnamen (WI-0135)", () => {
    it("🔴 in „Alle“: ein Name der Vegetation mit Zwilling trägt seine Art klein in einer zweiten Zeile", () => {
        expect(textOf(mapLabelLayerId("vegetation"), steppe)).toEqual([
            { text: "Große Öde", scale: null },
            { text: "\n", scale: null },
            { text: "Steppe", scale: labelFamily("landscape").typeLineScale ?? null },
        ]);
    });

    it("🔴 ebenso die Topographie", () => {
        const sections = textOf(mapLabelLayerId("topographie"), { ...steppe, region_type: "tiefebene" });
        expect(sections.map((section) => section.text)).toEqual(["Große Öde", "\n", "Tiefebene"]);
    });

    it("ohne Zwilling steht der Name allein", () => {
        expect(textOf(mapLabelLayerId("vegetation"), { ...steppe, name_twin: false })).toEqual([
            { text: "Große Öde", scale: null },
        ]);
    });

    it("🪤 eine unbekannte Art hängt keine leere Zeile an (sie höbe den Namen an)", () => {
        expect(textOf(mapLabelLayerId("vegetation"), { ...steppe, region_type: "gibt-es-nicht" })).toEqual([
            { text: "Große Öde", scale: null },
        ]);
    });

    it("🔴 die Derographie bleibt einzeilig, auch mit Merker", () => {
        expect(textOf(mapLabelLayerId("derographisch"), steppe)).toEqual([{ text: "Große Öde", scale: null }]);
    });

    it("🔴 nur in „Alle“: in der Standardkarte und in einer einzelnen Ebene bleibt der Name einzeilig", () => {
        const standard = { labels: true, composition: composeView("standard", "alle") };
        const vegetation = { labels: true, composition: composeView("landscapes", "vegetation") };
        expect(textOf(mapLabelLayerId("vegetation"), steppe, standard)).toEqual([{ text: "Große Öde", scale: null }]);
        expect(textOf(mapLabelLayerId("vegetation"), steppe, vegetation)).toEqual([{ text: "Große Öde", scale: null }]);
    });

    it("🪤 die Kurvennamen bleiben einzeilig: ihre Läufe sind auf die Länge des Namens gerechnet", () => {
        expect(textOf(landscapeRunLayerId("vegetation"), steppe)).toEqual([{ text: "Große Öde", scale: null }]);
    });

    it("🔴 der Ersatzname der Auswahl zeigt die Art, wenn die Auswahl sie anlegt, und nur in „Alle“", () => {
        const auswahl = {
            kind: "landscape" as const,
            id: "oede-tief",
            name: "Große Öde",
            type: "tiefebene",
            anchor: { x: 508, y: 692 },
            label: "Große Öde",
        };
        const mitArt = { name: "Große Öde", type_line: "Tiefebene" };
        expect(
            textOf(AREA_SELECTION_LABEL_LAYER_ID, mitArt, { ...ALLE, areaSelection: auswahl }).map((s) => s.text),
        ).toEqual(["Große Öde", "\n", "Tiefebene"]);
        expect(
            textOf(AREA_SELECTION_LABEL_LAYER_ID, { name: "Große Öde" }, { ...ALLE, areaSelection: auswahl }),
        ).toEqual([{ text: "Große Öde", scale: null }]);
        const standard = { labels: true, composition: composeView("standard", "alle"), areaSelection: auswahl };
        expect(textOf(AREA_SELECTION_LABEL_LAYER_ID, mitArt, standard)).toEqual([{ text: "Große Öde", scale: null }]);
    });
});
