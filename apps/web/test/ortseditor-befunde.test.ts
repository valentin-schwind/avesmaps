import { describe, expect, it } from "vitest";
import type { EditorPlaceDetail } from "@avesmaps3d/shared";
import { befunde } from "../src/ortseditor/befunde";
import { entwurfAus } from "../src/ortseditor/entwurf";

/**
 * Prüfen (WI-0128 E20; EDIT-0001 §7.1 E20: „jeder Befund aus WI-0126 §5.5 erscheint nach dem Loslassen einmal, nie währenddessen; kein
 * Befund sperrt das Speichern“). Problemfälle: ein verborgener Ort ohne Weg gilt als unverbunden; der Namensvorschlag ist selbst schon
 * vergeben; ein Seehafen am Meer meldet sich; ein Befund doppelt.
 */
const leer = { value: null, origin: null, wiki: null };
function ort(ueber: Partial<EditorPlaceDetail> = {}): EditorPlaceDetail {
    return {
        publicId: "e20e20e2-0000-4000-8000-000000000001",
        revision: 3,
        name: "Gratenfels",
        subtype: "stadt",
        kind: null,
        position: { x: 1, y: 2 },
        active: true,
        hidden: false,
        ruined: false,
        nodix: false,
        seaport: false,
        underground: false,
        withdrawn: false,
        approximate: false,
        waterNearby: true,
        sourceSystem: "legacy",
        fields: { description: leer, einwohner: leer, lage: leer, oberhaupt: leer },
        wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfels", title: "Gratenfels", state: "assigned" },
        pathEnds: [{ pathId: "w", name: "Weg", end: "start", revision: 1, x: 1, y: 2, neighbor: { x: 2, y: 2 } }],
        ...ueber,
    };
}
const arten = (liste: ReturnType<typeof befunde>) => liste.map((befund) => befund.art);

describe("Prüfen: Befunde, nie eine Sperre", () => {
    it("ein angebundener, zugewiesener Ort ohne Besonderheit hat keinen Befund", () => {
        expect(befunde(ort(), entwurfAus(ort()), { namen: new Set() })).toEqual([]);
    });

    it("🔴 unverbunden nur, wenn der Ort nicht verborgen ist (Legacy-Nachtrag 2026-10-09)", () => {
        const ohneWeg = ort({ pathEnds: [] });
        expect(arten(befunde(ohneWeg, entwurfAus(ohneWeg), { namen: new Set() }))).toEqual(["unverbunden"]);
        expect(befunde(ohneWeg, { ...entwurfAus(ohneWeg), hidden: true }, { namen: new Set() })).toEqual([]);
    });

    it("🔴 Name schon vergeben: Vorschlag „Name (Region)“, außer er ist selbst vergeben", () => {
        const entwurf = entwurfAus(ort());
        expect(befunde(ort(), entwurf, { namen: new Set(["gratenfels"]), region: "Kosch" })).toEqual([
            { art: "name", vorschlag: "Gratenfels (Kosch)" },
        ]);
        expect(
            befunde(ort(), entwurf, { namen: new Set(["gratenfels", "gratenfels (kosch)"]), region: "Kosch" }),
        ).toEqual([{ art: "name", vorschlag: undefined }]);
    });

    it("offene Wegenden nach Strg, Hauptstadt außerhalb, Seehafen ohne Wasser, kein Wiki-Artikel: je einmal", () => {
        const fern = ort({ waterNearby: false, capitalOutside: ["Grafschaft Gratenfels"], wiki: null });
        const liste = befunde(
            fern,
            { ...entwurfAus(fern), seaport: true },
            {
                namen: new Set(),
                liegen: { anzahl: 2, bei: { x: 1, y: 2 } },
            },
        );
        expect(arten(liste)).toEqual(["offeneWegenden", "gebiet", "wasser", "wiki"]);
        // Ein Seehafen am Meer ist kein Befund.
        expect(arten(befunde(ort(), { ...entwurfAus(ort()), seaport: true }, { namen: new Set() }))).toEqual([]);
    });
});
