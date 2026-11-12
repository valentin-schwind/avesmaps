import { describe, expect, it, vi } from "vitest";
import type { EditorPlaceDetail, OperationReceipt, PlaceRemoval, PlaceSammelBody } from "@avesmaps3d/shared";
import {
    createOrtSammel,
    eigeneJeFeld,
    feldWert,
    nacheinander,
    sammelEntfernenStand,
    type SammelApi,
} from "../src/ortseditor/ort-sammel.ts";

/**
 * Die Mehrfachauswahl der Ortsliste (WI-0237, EDIT-0003 T57): Was die Sammelansicht liest, zählt und schreibt.
 *
 * Problemfälle: Die Ansicht schreibt gegen eine andere Revision als die gelesene; sie schreibt ein Feld, das nicht zurückgesetzt werden
 * sollte; „Speichern“ schickt etwas ohne ↺; ↺ zählt einen Ort als „eigener Wert“, der schon auf dem Wiki steht; ein Ort mit Kraftlinie
 * oder als innerorts-Punkt steht im Blatt nicht als gesperrt; das Lesen läuft ohne Grenze los.
 */

const A = "11111111-0000-4000-8000-000000000001";
const B = "11111111-0000-4000-8000-000000000002";

function ort(publicId: string, revision: number, ueber: Partial<EditorPlaceDetail> = {}): EditorPlaceDetail {
    return {
        publicId,
        revision,
        name: "Gratenfels",
        subtype: "stadt",
        kind: null,
        position: { x: 450, y: 535 },
        active: true,
        hidden: false,
        ruined: false,
        nodix: false,
        seaport: false,
        underground: false,
        withdrawn: false,
        approximate: false,
        sourceSystem: "legacy",
        fields: {
            description: { value: null, origin: null, wiki: "Am Fluss." },
            einwohner: { value: null, origin: null, wiki: "2.200" },
            lage: { value: "Kosch", origin: "wiki", wiki: "Kosch" },
            oberhaupt: { value: null, origin: null, wiki: null },
        },
        wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfels", title: "Gratenfels", state: "assigned" },
        nameWiki: "Gratenfels",
        pathEnds: [],
        ...ueber,
    };
}

const QUITTUNG: OperationReceipt = {
    operationId: "op",
    status: "applied",
    environment: "test",
    affected: [],
    derivedWork: [],
    warnings: [],
    mapRevision: 77,
};

function api(details: Record<string, EditorPlaceDetail>): SammelApi & { gesendet: PlaceSammelBody[] } {
    const gesendet: PlaceSammelBody[] = [];
    return {
        gesendet,
        ort: (id) => Promise.resolve(details[id] ?? null),
        entfernenVorschau: () => Promise.resolve(null),
        sammle: (body) => {
            gesendet.push(body);
            return Promise.resolve({ ok: true as const, quittung: QUITTUNG });
        },
        loescheAlle: () => Promise.resolve({ ok: true as const, quittung: QUITTUNG }),
    };
}

const warte = () => new Promise((fertig) => setTimeout(fertig, 0));

describe("Mehrfachauswahl der Orte (WI-0237)", () => {
    it("liest höchstens sechs zugleich und behält die Reihenfolge", async () => {
        let laufend = 0;
        let hoechstens = 0;
        const raus = await nacheinander([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], async (zahl) => {
            laufend += 1;
            hoechstens = Math.max(hoechstens, laufend);
            await warte();
            laufend -= 1;
            return zahl * 2;
        });
        expect(raus).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
        expect(hoechstens).toBe(6);
    });

    it("🔴 zählt je Wiki-Feld nur Orte mit eigenem Wert, wie einzeln", () => {
        const eigen = ort(A, 3, {
            name: "Eigenname",
            fields: { ...ort(A, 3).fields, einwohner: { value: "999", origin: "manual", wiki: "2.200" } },
        });
        const wiki = ort(B, 5);
        expect(eigeneJeFeld([eigen, wiki])).toMatchObject({
            name: 1,
            einwohner: 1,
            lage: 0,
            oberhaupt: 0,
            description: 0,
        });
        expect(feldWert(eigen, "einwohner")).toBe("999");
        expect(feldWert(wiki, "kind")).toBe("");
        // Ohne eigenen Wert zeigt das Feld den Wiki-Wert, wie das Fenster eines Orts.
        expect(feldWert(wiki, "einwohner")).toBe("2.200");
        expect(feldWert(wiki, "oberhaupt")).toBe("");
    });

    it("🔴 „Speichern“ schickt nur ↺, gegen die gelesenen Revisionen, als EINE Operation, und liest danach neu", async () => {
        const daten = api({ [A]: ort(A, 3), [B]: ort(B, 5) });
        const geschrieben = vi.fn();
        const sammel = createOrtSammel(daten, [A, B], { geschrieben, neueKennung: () => "op-1" });
        await warte();
        expect(sammel.details.value.size).toBe(2);
        await sammel.entwurf.fertig();
        expect(daten.gesendet).toEqual([]);
        sammel.entwurf.aufWiki("einwohner");
        sammel.entwurf.aufWiki("einwohner");
        sammel.entwurf.aufWiki("name");
        expect(sammel.entwurf.geaendert("einwohner")).toBe(true);
        await sammel.entwurf.fertig();
        expect(daten.gesendet).toEqual([
            {
                operationId: "op-1",
                orte: [
                    { id: A, baseRevision: 3 },
                    { id: B, baseRevision: 5 },
                ],
                wiki: ["einwohner", "name"],
            },
        ]);
        expect(geschrieben).toHaveBeenCalledWith(QUITTUNG);
        expect(sammel.entwurf.geaendert("einwohner")).toBe(false);
    });

    it("🔴 das Blatt „Entfernen …“ nennt jeden Ort, der sperrt, und zählt Stätten, Wegenden und Gebiete zusammen", () => {
        const vorschau = (ueber: Partial<PlaceRemoval>): PlaceRemoval => ({
            publicId: A,
            name: "Ort",
            revision: 1,
            onMap: true,
            subtype: "dorf",
            staetten: [],
            wegenden: [],
            gebiete: [],
            kraftlinien: [],
            bleibt: { wiki: false, bilder: 0, quellen: 0, stadtplaene: 0, abenteuer: 0, bewertungen: 0 },
            ...ueber,
        });
        const stand = sammelEntfernenStand([
            vorschau({ name: "Kraftort", kraftlinien: [{ name: "Ader" }] }),
            vorschau({ name: "Innen", innerortsVon: "Gareth" }),
            vorschau({
                name: "Burgau",
                staetten: [{ name: "Tempel" }, { name: "Markt" }],
                wegenden: ["Reichsstraße"],
                gebiete: [{ name: "Kosch", rolle: "hauptstadt" }],
            }),
            vorschau({ name: "Dorf", onMap: false, gebiete: [{ name: "Kosch", rolle: "sitz" }] }),
        ]);
        expect(stand.gesperrt.map((ort) => ort.name)).toEqual(["Kraftort", "Innen"]);
        expect(stand.staetten).toBe(2);
        expect(stand.wegenden).toBe(1);
        expect(stand.gebiete).toEqual(["Kosch"]);
        expect(stand.aufDerKarte).toBe(3);
    });
});
