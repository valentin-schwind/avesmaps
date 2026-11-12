import { afterEach, describe, expect, it } from "vitest";
import { filtereOrtsarten, ladeOrtsarten, teileNachTreffer, vergissOrtsarten } from "../src/ortseditor/ortsarten";

/**
 * Das Feld „Art“ mit den Ortsarten aus dem Wiki (WI-0295; Legacy `filterPlaceKinds`). Problemfälle: „gut“ findet Gutshof nicht; Groß- und Kleinschreibung
 * entscheidet; ein gescheiterter Abruf sperrt die Liste für die ganze Sitzung; ein zweiter Fokus holt die Liste erneut.
 */
const ARTEN = [
    { kind: "Festung", count: 529 },
    { kind: "Festungsruine", count: 36 },
    { kind: "Gut", count: 27 },
    { kind: "Gutshof", count: 33 },
    { kind: "Historische Festung", count: 1 },
    { kind: "Oase", count: 0 },
];

describe("Ortsarten im Feld „Art“ (WI-0295)", () => {
    afterEach(() => vergissOrtsarten());

    it("🔴 leer heißt alles; Teilstück, Groß und Klein egal, Reihenfolge wie geliefert", () => {
        expect(filtereOrtsarten(ARTEN, "  ")).toHaveLength(6);
        expect(filtereOrtsarten(ARTEN, "gut").map((art) => art.kind)).toEqual(["Gut", "Gutshof"]);
        expect(filtereOrtsarten(ARTEN, "FESTUNG").map((art) => art.kind)).toEqual([
            "Festung",
            "Festungsruine",
            "Historische Festung",
        ]);
        expect(filtereOrtsarten(ARTEN, "Burg")).toEqual([]);
    });

    it("🔴 markiert jede Stelle des getippten Stücks und lässt den Namen sonst, wie er ist", () => {
        expect(teileNachTreffer("Historische Festung", "fest")).toEqual([
            { text: "Historische ", treffer: false },
            { text: "Fest", treffer: true },
            { text: "ung", treffer: false },
        ]);
        expect(teileNachTreffer("Gut", "")).toEqual([{ text: "Gut", treffer: false }]);
        expect(teileNachTreffer("Haha", "ha")).toEqual([
            { text: "Ha", treffer: true },
            { text: "ha", treffer: true },
        ]);
    });

    it("🔴 einmal je Seite geholt; ein Fehler gibt eine leere Liste und der nächste Fokus fragt neu", async () => {
        let aufrufe = 0;
        const gut = () => {
            aufrufe += 1;
            return Promise.resolve(new Response(JSON.stringify({ kinds: ARTEN }), { status: 200 }));
        };
        expect(await ladeOrtsarten(gut)).toHaveLength(6);
        expect(await ladeOrtsarten(gut)).toHaveLength(6);
        expect(aufrufe).toBe(1);

        vergissOrtsarten();
        aufrufe = 0;
        const kaputt = () => {
            aufrufe += 1;
            return Promise.reject(new Error("offline"));
        };
        expect(await ladeOrtsarten(kaputt)).toEqual([]);
        expect(await ladeOrtsarten(gut)).toHaveLength(6);
        expect(aufrufe).toBe(2);
    });
});
