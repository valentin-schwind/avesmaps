import { describe, expect, it } from "vitest";
import type {
    EditorPlaceDetail,
    EditorPlaceRow,
    OperationReceipt,
    PlaceCreateBody,
    PlaceMoveBody,
} from "@avesmaps3d/shared";
import { anlegenAus, createOrtSetzen, setzbar, type SetzenApi } from "../src/ortseditor/ort-setzen";

/**
 * Einen Ort auf die Karte setzen, der noch nicht dort steht (WI-0128 E16; Betreiber 2026-10-11: Ziehen aus der Liste auf die Karte,
 * „natürlich darf man nur orte auf die karte ziehen, die noch nicht auf der karte sind“).
 *
 * Problemfälle: Ein Ort auf der Karte oder eine Stätte lässt sich ziehen; ein Wiki-Eintrag wird ohne seinen Artikel angelegt; ein Ort
 * ohne Lage wird mit falscher Revision gesetzt; ein Fehler verschwindet still; Esc lässt den Klickmodus stehen.
 */

const WIKI: EditorPlaceRow = {
    key: "wiki:wachturm",
    origin: "wiki",
    name: "Wachturm",
    circle: "leer",
    assignment: "none",
    subtype: "gebaeude",
    kind: "Turm",
};
const OHNE: EditorPlaceRow = {
    key: "e16e16e1-0000-4000-8000-000000000001",
    origin: "ohne-lage",
    name: "Weiler",
    circle: "leer",
    assignment: "none",
    subtype: "dorf",
};
const KARTE: EditorPlaceRow = { ...OHNE, key: "e16e16e1-0000-4000-8000-000000000002", origin: "karte", x: 1, y: 2 };
const STAETTE: EditorPlaceRow = {
    key: "staette:abc",
    origin: "wiki",
    name: "Praios-Tempel",
    circle: "leer",
    assignment: "none",
    within: "Gratenfels",
};

const quittung = (id: string, revision: number): OperationReceipt => ({
    operationId: "00000000-0000-4000-8000-000000000009",
    status: "applied",
    environment: "development",
    affected: [{ kind: "place", id, revision }],
    derivedWork: [],
    warnings: [],
    mapRevision: 57,
});

function aufbau(antwort: "ok" | "fehler" = "ok") {
    const gelegt: PlaceCreateBody[] = [];
    const verschoben: { id: string; body: PlaceMoveBody }[] = [];
    const api: SetzenApi = {
        ort: (id) => Promise.resolve({ publicId: id, revision: 4 } as EditorPlaceDetail),
        lege: (body) => {
            gelegt.push(body);
            return Promise.resolve(
                antwort === "ok"
                    ? { ok: true as const, quittung: quittung("neu-1", 1) }
                    : {
                          ok: false as const,
                          status: 400,
                          fehler: {
                              code: "validation_failed",
                              message: "Dieser Wiki-Eintrag steht schon auf der Karte.",
                          },
                      },
            );
        },
        verschiebe: (id, body) => {
            verschoben.push({ id, body });
            return Promise.resolve({ ok: true as const, quittung: quittung(id, 5) });
        },
    };
    const revisionen: (number | undefined)[] = [];
    let klick: ((punkt: { x: number; y: number }) => void) | undefined;
    let modusAus = 0;
    const geoeffnet: [string | undefined, string][] = [];
    const setzen = createOrtSetzen({
        api,
        ladefehler: "nicht geladen",
        neueKennung: () => "00000000-0000-4000-8000-0000000000aa",
        karte: {
            ein: (gesetzt) => {
                klick = gesetzt;
                return { aus: () => (modusAus += 1) };
            },
            geaendert: (revision) => revisionen.push(revision),
        },
        gesetzt: (fenster, id) => geoeffnet.push([fenster, id]),
    });
    return { setzen, gelegt, verschoben, revisionen, geoeffnet, klick: () => klick, modusAus: () => modusAus };
}

describe("Orte auf die Karte setzen (E16)", () => {
    it("🔴 nur, was noch nicht auf der Karte steht: Wiki-Eintrag mit Ortsgröße und Ort ohne Lage ja, Kartenort und Stätte nein", () => {
        expect(setzbar(WIKI)).toBe(true);
        expect(setzbar(OHNE)).toBe(true);
        expect(setzbar(KARTE)).toBe(false);
        expect(setzbar(STAETTE)).toBe(false);
        expect(setzbar({ ...WIKI, subtype: "unbekannt" })).toBe(false);
        expect(setzbar(undefined)).toBe(false);
    });

    it("ein Wiki-Eintrag wird mit Name, Ortsgröße, Art und seinem Key angelegt; eine zu lange Art bleibt weg", () => {
        expect(anlegenAus(WIKI, { x: 10, y: 20 }, "k")).toEqual({
            operationId: "k",
            name: "Wachturm",
            subtype: "gebaeude",
            kind: "Turm",
            position: { x: 10, y: 20 },
            wikiKey: "wiki:wachturm",
        });
        expect(anlegenAus({ ...WIKI, kind: "x".repeat(81) }, { x: 1, y: 1 }, "k")).not.toHaveProperty("kind");
    });

    it("🔴 Ablegen eines Wiki-Eintrags: EIN Anlegen, die Kacheln folgen, der neue Ort öffnet sich", async () => {
        const { setzen, gelegt, revisionen, geoeffnet } = aufbau();
        await setzen.setze(WIKI, { x: 431, y: 432 });
        expect(gelegt).toHaveLength(1);
        expect(gelegt[0]).toMatchObject({ wikiKey: "wiki:wachturm", position: { x: 431, y: 432 } });
        expect(revisionen).toEqual([57]);
        expect(geoeffnet).toEqual([[undefined, "neu-1"]]);
        expect(setzen.meldung.value).toEqual({
            art: "gesetzt",
            key: "wiki:wachturm",
            publicId: "neu-1",
            name: "Wachturm",
        });
    });

    it("🔴 ein Ort ohne Lage wird mit seiner gelesenen Revision gesetzt, dieselbe Kennung", async () => {
        const { setzen, verschoben, geoeffnet } = aufbau();
        await setzen.setze(OHNE, { x: 5, y: 6 }, "fenster-1");
        expect(verschoben).toEqual([
            {
                id: OHNE.key,
                body: {
                    operationId: "00000000-0000-4000-8000-0000000000aa",
                    baseRevision: 4,
                    to: { x: 5, y: 6 },
                    pathEnds: [],
                },
            },
        ]);
        expect(geoeffnet).toEqual([["fenster-1", OHNE.key]]);
    });

    it("ein Kartenort wird nicht gesetzt; ein abgelehntes Setzen steht als Meldung da", async () => {
        const nichts = aufbau();
        await nichts.setzen.setze(KARTE, { x: 1, y: 1 });
        expect(nichts.gelegt).toEqual([]);
        expect(nichts.verschoben).toEqual([]);

        const abgelehnt = aufbau("fehler");
        await abgelehnt.setzen.setze(WIKI, { x: 1, y: 1 });
        expect(abgelehnt.setzen.meldung.value).toEqual({
            art: "abgelehnt",
            key: "wiki:wachturm",
            satz: "Dieser Wiki-Eintrag steht schon auf der Karte.",
        });
        expect(abgelehnt.geoeffnet).toEqual([]);
    });

    it("🔴 „● Auf der Karte setzen“: der Modus wartet auf den Klick, der Klick setzt, Esc beendet ihn ohne zu senden", async () => {
        const { setzen, gelegt, klick, modusAus, geoeffnet } = aufbau();
        setzen.starte("fenster-2", WIKI);
        expect(setzen.laufend.value).toEqual({ fenster: "fenster-2", key: "wiki:wachturm", art: "wartet" });
        klick()!({ x: 7, y: 8 });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(gelegt).toHaveLength(1);
        expect(modusAus()).toBe(1);
        expect(geoeffnet).toEqual([["fenster-2", "neu-1"]]);
        expect(setzen.laufend.value).toBeUndefined();

        setzen.starte("fenster-2", OHNE);
        expect(setzen.abbrechen()).toBe(true);
        expect(setzen.laufend.value).toBeUndefined();
        expect(setzen.abbrechen()).toBe(false);
    });
});
